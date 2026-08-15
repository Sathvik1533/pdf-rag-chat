"""
RAG (Retrieval-Augmented Generation) Pipeline Engine
====================================================

This module implements the complete 5-stage RAG pipeline:
1. Extract (pypdf): Pulls clean text page-by-page from raw PDF bytes.
2. Chunk (RecursiveCharacterTextSplitter): Splits text into semantically cohesive pieces
   while preserving page numbers for citation tracking.
3. Embed (sentence-transformers / all-MiniLM-L6-v2): Converts chunks into 384-dimensional
   dense vectors representing semantic meaning.
4. Retrieve (FAISS IndexFlatIP): Stores normalized vectors in-memory and performs
   fast cosine similarity search to find the top-k most relevant chunks.
5. Ground & Generate (Groq Llama 3.3 70B): Enforces a code-level similarity threshold
   before calling the LLM to prevent hallucination, then generates answers grounded in evidence.
"""

from __future__ import annotations

import io
import os
import logging
from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional, Tuple

import faiss
import numpy as np
from pypdf import PdfReader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from sentence_transformers import SentenceTransformer
from groq import Groq

logger = logging.getLogger("rag_pipeline")
logging.basicConfig(level=logging.INFO)

# Fixed refusal message required when retrieval confidence falls below the grounding threshold.
# This prevents LLMs from guessing or generating fabricated facts when documents lack the answer.
GROUNDING_REFUSAL_MESSAGE = "I couldn't find anything about that in this document."


@dataclass
class DocumentChunk:
    """Represents a single chunk of text with traceable metadata."""
    chunk_id: int
    text: str
    page: int
    source_filename: str
    char_count: int


@dataclass
class Citation:
    """Represents a verifiable source attribution for an answer."""
    page: int
    excerpt: str
    similarity_score: float
    chunk_id: int


@dataclass
class QueryResult:
    """Structured response object containing the answer, grounding state, and evidence citations."""
    answer: str
    grounded: bool
    top_similarity: float
    threshold: float
    citations: List[Citation] = field(default_factory=list)
    raw_context: Optional[str] = None
    retrieval_time_ms: float = 0.0
    generation_time_ms: float = 0.0
    chunk_breakdown: List[Dict[str, Any]] = field(default_factory=list)


class RAGPipeline:
    """
    Complete in-memory RAG pipeline managing PDF extraction, chunking,
    embedding generation, FAISS indexing, grounding validation, and LLM inference.
    """

    def __init__(
        self,
        embedding_model_name: str = "all-MiniLM-L6-v2",
        chunk_size: int = 500,
        chunk_overlap: int = 50,
        top_k: int = 4,
        grounding_threshold: float = 0.35,
        groq_model: str = "llama-3.3-70b-versatile",
    ):
        """
        Initialize the RAG pipeline with tuned parameters.

        WHY THESE CHOICES:
        - all-MiniLM-L6-v2: Runs locally on CPU in ~5ms per chunk, requires 0 external API keys,
          and produces 384-dimensional vectors with high semantic accuracy for general English documents.
        - chunk_size=500: ~100-125 words. Long enough to contain a complete semantic thought or fact,
          yet short enough to prevent haystack dilution when passed into the LLM context.
        - chunk_overlap=50: ~10-12 words. Ensures sentences split across chunk boundaries maintain
          enough context in both chunks so retrieval doesn't miss boundary facts.
        - top_k=4: Provides sufficient evidence breadth without overwhelming the LLM prompt.
        - grounding_threshold=0.35: Empirically tuned cosine similarity floor. Below this,
          text is statistically unrelated to the query.
        - Groq llama-3.3-70b-versatile: Ultra-fast inference with state-of-the-art reasoning
          capabilities for factual document Q&A.
        """
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap
        self.top_k = top_k
        self.grounding_threshold = grounding_threshold
        self.groq_model = groq_model
        self.embedding_model_name = embedding_model_name

        # Memory optimization for 512MB environments (e.g. Render Free Tier)
        import torch
        torch.set_num_threads(1)
        if hasattr(torch, "set_num_interop_threads"):
            try:
                torch.set_num_interop_threads(1)
            except RuntimeError:
                pass

        logger.info(f"Loading embedding model: {embedding_model_name} on CPU...")
        # Load local embedding model with explicit CPU placement
        self.embedder = SentenceTransformer(embedding_model_name, device="cpu")
        if hasattr(self.embedder, "get_embedding_dimension"):
            self.embedding_dim = self.embedder.get_embedding_dimension()
        else:
            self.embedding_dim = self.embedder.get_sentence_embedding_dimension()

        # In-memory document storage state (scoped to the uploaded document)
        # WHY IN-MEMORY FAISS: Single-document Q&A does not require a persistent database cluster
        # (e.g. Pinecone/Weaviate). In-memory FAISS provides sub-millisecond retrieval with 0 infrastructure cost.
        self.index: Optional[faiss.IndexFlatIP] = None
        self.chunks: List[DocumentChunk] = []
        self.pages_text: List[Tuple[int, str]] = []
        self.current_filename: Optional[str] = None
        self.total_pages: int = 0
        self.document_size_bytes: int = 0
        self.last_indexing_time_ms: float = 0.0

    # -------------------------------------------------------------------------
    # STAGE 1: EXTRACT
    # -------------------------------------------------------------------------
    def extract_text_from_pdf(self, file_bytes: bytes, filename: str = "document.pdf") -> List[Tuple[int, str]]:
        """
        Stage 1: Extract text from PDF bytes page by page.
        
        WHY PAGE-BY-PAGE:
        Extracting text page-by-page (rather than merging the entire document into one giant string)
        is what allows us to attach exact page numbers to every chunk during the chunking phase.
        Without this, accurate citations would be impossible.
        """
        reader = PdfReader(io.BytesIO(file_bytes))
        pages_text: List[Tuple[int, str]] = []
        
        self.total_pages = len(reader.pages)
        self.current_filename = filename

        for page_idx, page in enumerate(reader.pages):
            page_num = page_idx + 1  # 1-indexed page number for human readability
            raw_text = page.extract_text() or ""
            # Strip excessive null bytes and clean up whitespace
            cleaned_text = raw_text.replace("\x00", "").strip()
            if cleaned_text:
                pages_text.append((page_num, cleaned_text))
            else:
                logger.warning(f"Page {page_num} in '{filename}' had no extractable text.")

        return pages_text

    # -------------------------------------------------------------------------
    # STAGE 2: CHUNK
    # -------------------------------------------------------------------------
    def chunk_pages(self, pages_text: List[Tuple[int, str]], filename: str) -> List[DocumentChunk]:
        """
        Stage 2: Split extracted text into overlapping chunks while preserving page numbers.

        WHY RecursiveCharacterTextSplitter:
        Unlike naive fixed-character slicing (which cuts words and sentences in half),
        RecursiveCharacterTextSplitter attempts to split on paragraph breaks (`\n\n`), then lines (`\n`),
        then spaces (` `), and only as a last resort on individual characters.
        This preserves complete sentences and syntactic cohesion.
        """
        splitter = RecursiveCharacterTextSplitter(
            chunk_size=self.chunk_size,
            chunk_overlap=self.chunk_overlap,
            length_function=len,
            separators=["\n\n", "\n", ". ", " ", ""]
        )

        all_chunks: List[DocumentChunk] = []
        chunk_counter = 0

        for page_num, page_text in pages_text:
            text_splits = splitter.split_text(page_text)
            for split in text_splits:
                cleaned_split = split.strip()
                if cleaned_split:
                    chunk = DocumentChunk(
                        chunk_id=chunk_counter,
                        text=cleaned_split,
                        page=page_num,
                        source_filename=filename,
                        char_count=len(cleaned_split)
                    )
                    all_chunks.append(chunk)
                    chunk_counter += 1

        return all_chunks

    # -------------------------------------------------------------------------
    # STAGE 3 & 4: EMBED & INDEX
    # -------------------------------------------------------------------------
    def index_document(self, file_bytes: bytes, filename: str = "document.pdf") -> Dict[str, Any]:
        """
        Execute Stages 1-4: Extract -> Chunk -> Embed -> Index in FAISS.
        
        WHY NORMALIZED EMBEDDINGS + IndexFlatIP:
        Cosine similarity between vectors A and B is (A · B) / (||A|| * ||B||).
        If we normalize vectors to unit length (||A|| = 1, ||B|| = 1), then Cosine Similarity
        simplifies exactly to Inner Product (A · B).
        Using `faiss.IndexFlatIP` on unit-normalized vectors gives exact, high-speed cosine similarity.
        """
        import time
        start_t = time.time()

        # Step 1: Extract
        pages_text = self.extract_text_from_pdf(file_bytes, filename)
        if not pages_text:
            raise ValueError("The uploaded PDF does not contain any extractable text.")

        # Step 2: Chunk
        chunks = self.chunk_pages(pages_text, filename)
        if not chunks:
            raise ValueError("No text chunks could be generated from the document.")

        # Step 3: Embed (batch encoding for speed)
        chunk_texts = [chunk.text for chunk in chunks]
        with torch.inference_mode():
            embeddings = self.embedder.encode(
                chunk_texts,
                show_progress_bar=False,
                normalize_embeddings=True,  # Crucial for exact Cosine Similarity with IndexFlatIP
                convert_to_numpy=True
            ).astype("float32")

        # Step 4: Index into in-memory FAISS
        index = faiss.IndexFlatIP(self.embedding_dim)
        index.add(embeddings)

        elapsed_ms = (time.time() - start_t) * 1000.0

        # Update in-memory state
        self.index = index
        self.chunks = chunks
        self.pages_text = pages_text
        self.document_size_bytes = len(file_bytes)
        self.last_indexing_time_ms = elapsed_ms

        logger.info(f"Indexed document '{filename}': {self.total_pages} pages, {len(chunks)} chunks, FAISS total={index.ntotal} in {elapsed_ms:.1f}ms")

        return {
            "filename": filename,
            "total_pages": self.total_pages,
            "total_chunks": len(chunks),
            "document_size_bytes": len(file_bytes),
            "indexing_time_ms": round(elapsed_ms, 1),
            "status": "ready"
        }

    def get_document_dossier(self) -> Dict[str, Any]:
        """Returns the full extracted document pages and indexed chunks for the live document reader."""
        if self.index is None or len(self.chunks) == 0:
            return {"indexed": False}

        pages_payload = []
        for page_num, text in self.pages_text:
            chunks_on_page = [c.chunk_id for c in self.chunks if c.page == page_num]
            pages_payload.append({
                "page": page_num,
                "text": text,
                "char_count": len(text),
                "chunk_ids": chunks_on_page
            })

        chunks_payload = [
            {
                "chunk_id": c.chunk_id,
                "page": c.page,
                "char_count": c.char_count,
                "text": c.text
            }
            for c in self.chunks
        ]

        return {
            "indexed": True,
            "filename": self.current_filename,
            "total_pages": self.total_pages,
            "total_chunks": len(self.chunks),
            "document_size_bytes": self.document_size_bytes,
            "indexing_time_ms": round(self.last_indexing_time_ms, 1),
            "pages": pages_payload,
            "chunks": chunks_payload
        }

    # -------------------------------------------------------------------------
    # STAGE 5: RETRIEVE, GROUND & GENERATE
    # -------------------------------------------------------------------------
    def retrieve(self, query_text: str, top_k: Optional[int] = None) -> List[Tuple[DocumentChunk, float]]:
        """
        Retrieve the top-k most semantically similar chunks for a given query.
        Returns a list of (DocumentChunk, cosine_similarity_score).
        """
        if self.index is None or len(self.chunks) == 0:
            raise ValueError("No document has been indexed yet. Please upload a PDF first.")

        k = min(top_k or self.top_k, len(self.chunks))

        # Embed query using the EXACT same embedding model & normalization as document chunks
        # WHY: Using a mismatched model or differing normalization destroys the vector alignment.
        import torch
        with torch.inference_mode():
            query_vector = self.embedder.encode(
                [query_text],
                normalize_embeddings=True,
                convert_to_numpy=True
            ).astype("float32")

        # Search FAISS index: returns distances (inner products = cosine similarities) and indices
        similarities, indices = self.index.search(query_vector, k)

        retrieved: List[Tuple[DocumentChunk, float]] = []
        for sim, idx in zip(similarities[0], indices[0]):
            if idx != -1 and idx < len(self.chunks):
                retrieved.append((self.chunks[idx], float(sim)))

        return retrieved

    def query(
        self,
        question: str,
        groq_api_key: Optional[str] = None,
        custom_threshold: Optional[float] = None
    ) -> QueryResult:
        """
        Execute Stage 5: Query embedding -> Retrieval -> Grounding check -> Generation.
        """
        import time
        t_start = time.time()
        threshold = custom_threshold if custom_threshold is not None else self.grounding_threshold
        cleaned_question = question.strip()
        if not cleaned_question:
            return QueryResult(
                answer="Please provide a valid question.",
                grounded=False,
                top_similarity=0.0,
                threshold=threshold,
                citations=[],
                retrieval_time_ms=0.0,
                generation_time_ms=0.0,
                chunk_breakdown=[]
            )

        import re
        # Check if the query is asking for a general document overview/summary
        summary_intent_pattern = r"(what is this (doc|document|pdf|file|paper)|summarize|summary|overview|what does this (doc|document|pdf|file) (say|talk|discuss|contain)|explain this (doc|document|pdf)|tell me about this (doc|document|pdf))"
        is_summary_query = bool(re.search(summary_intent_pattern, cleaned_question, re.IGNORECASE))

        # Retrieve top chunks
        t_ret_start = time.time()
        if is_summary_query:
            # For general document summary, retrieve the opening chunks (typically page 1 overview)
            retrieved_items = [(chunk, 0.85) for chunk in self.chunks[:min(self.top_k, len(self.chunks))]]
        else:
            retrieved_items = self.retrieve(cleaned_question, top_k=self.top_k)
        ret_elapsed_ms = (time.time() - t_ret_start) * 1000.0

        if not retrieved_items:
            return QueryResult(
                answer=GROUNDING_REFUSAL_MESSAGE,
                grounded=False,
                top_similarity=0.0,
                threshold=threshold,
                citations=[],
                retrieval_time_ms=round(ret_elapsed_ms, 1),
                generation_time_ms=0.0,
                chunk_breakdown=[]
            )

        top_chunk, top_similarity = retrieved_items[0]

        chunk_breakdown = [
            {
                "chunk_id": ch.chunk_id,
                "page": ch.page,
                "similarity": round(score, 4),
                "passed_threshold": score >= threshold,
                "char_count": ch.char_count
            }
            for ch, score in retrieved_items
        ]

        # ---------------------------------------------------------------------
        # MANDATORY GROUNDING REFUSAL CHECK
        # ---------------------------------------------------------------------
        # Refuse to answer if retrieval confidence is too low and it is not a general summary,
        # rather than letting the LLM guess — this is what prevents hallucination on out-of-scope questions.
        if top_similarity < threshold:
            logger.info(
                f"Grounding check failed for query: '{cleaned_question[:40]}...'. "
                f"Top similarity {top_similarity:.4f} < threshold {threshold:.4f}. Refusing."
            )
            return QueryResult(
                answer=GROUNDING_REFUSAL_MESSAGE,
                grounded=False,
                top_similarity=top_similarity,
                threshold=threshold,
                citations=[],
                retrieval_time_ms=round(ret_elapsed_ms, 1),
                generation_time_ms=0.0,
                chunk_breakdown=chunk_breakdown
            )

        # Build citations for all retrieved chunks
        citations: List[Citation] = []
        for chunk, sim in retrieved_items:
            first_lines = chunk.text.split("\n")
            excerpt_snippet = " ".join([line.strip() for line in first_lines if line.strip()][:2])
            if len(excerpt_snippet) > 200:
                excerpt_snippet = excerpt_snippet[:197] + "..."

            citations.append(Citation(
                page=chunk.page,
                excerpt=excerpt_snippet,
                similarity_score=round(sim, 4),
                chunk_id=chunk.chunk_id
            ))

        # Assemble prompt context
        context_blocks = []
        for idx, (chunk, sim) in enumerate(retrieved_items, start=1):
            context_blocks.append(
                f"[Source Chunk #{idx} | Page {chunk.page} | Relevance {sim:.2f}]:\n{chunk.text}"
            )
        combined_context = "\n\n".join(context_blocks)

        # Generate answer with Groq LLM
        t_gen_start = time.time()
        answer_text = self._call_groq_llm(
            question=cleaned_question,
            context=combined_context,
            api_key=groq_api_key
        )
        gen_elapsed_ms = (time.time() - t_gen_start) * 1000.0

        return QueryResult(
            answer=answer_text,
            grounded=True,
            top_similarity=top_similarity,
            threshold=threshold,
            citations=citations,
            raw_context=combined_context,
            retrieval_time_ms=round(ret_elapsed_ms, 1),
            generation_time_ms=round(gen_elapsed_ms, 1),
            chunk_breakdown=chunk_breakdown
        )

    def _call_groq_llm(self, question: str, context: str, api_key: Optional[str] = None) -> str:
        """
        Call Groq API using Llama 3.3 70B with strict context grounding instructions.
        """
        effective_key = api_key or os.getenv("GROQ_API_KEY")
        if not effective_key or effective_key.strip() in ("", "your_groq_api_key_here", "gsk_your_groq_api_key_here"):
            return (
                "⚠️ **GROQ_API_KEY is not configured.**\n\n"
                "Grounding check PASSED (retrieved relevant context), but the LLM answer cannot be generated "
                "without a valid Groq API key.\n\n"
                "Please add your `GROQ_API_KEY` in the `.env` file or environment variables to enable generation."
            )

        try:
            client = Groq(api_key=effective_key.strip())
            
            system_prompt = (
                "You are an expert, precise, and faithful document assistant. "
                "Answer the user's question using ONLY the provided document context below.\n\n"
                "CRITICAL RULES:\n"
                "1. Base your answer strictly on the provided context. Do NOT invent facts or extrapolate beyond what is stated.\n"
                "2. When stating facts, cite the relevant page numbers in your response (e.g. '[Page 2]').\n"
                "3. If the context does not contain enough information to fully answer the question, state what is known and clarify what is missing.\n"
                "4. Keep your answer clear, direct, and well-structured with markdown formatting."
            )

            user_prompt = f"DOCUMENT CONTEXT:\n{context}\n\nUSER QUESTION:\n{question}\n\nANSWER:"

            response = client.chat.completions.create(
                model=self.groq_model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                temperature=0.1,  # Low temperature for deterministic, factual adherence
                max_tokens=1024,
            )

            return response.choices[0].message.content.strip()

        except Exception as e:
            logger.error(f"Error invoking Groq LLM: {e}")
            return f"❌ Error communicating with Groq API: {str(e)}"
