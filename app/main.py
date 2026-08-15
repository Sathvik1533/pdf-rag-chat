"""
FastAPI Application Entry Point
================================
Provides REST API endpoints for PDF upload, grounded document Q&A, system status, and UI serving.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, File, UploadFile, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

from app.config import settings
from app.core.pipeline import RAGPipeline, QueryResult, Citation, GROUNDING_REFUSAL_MESSAGE

logger = logging.getLogger("rag_api")
logging.basicConfig(level=logging.INFO)

# Initialize FastAPI App
app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="Production-grade RAG service with code-level grounding and verifiable citations.",
)

# Enable CORS for local testing and cross-origin access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global singleton RAG Pipeline instance
# WHY GLOBAL SINGLETON: Keeps the embedding model and in-memory FAISS index hot in RAM
pipeline = RAGPipeline(
    embedding_model_name=settings.EMBEDDING_MODEL,
    chunk_size=settings.CHUNK_SIZE,
    chunk_overlap=settings.CHUNK_OVERLAP,
    top_k=settings.TOP_K,
    grounding_threshold=settings.GROUNDING_THRESHOLD,
    groq_model=settings.GROQ_MODEL,
)

# Static files directory
STATIC_DIR = Path(__file__).resolve().parent / "static"


# -----------------------------------------------------------------------------
# Request & Response Schemas
# -----------------------------------------------------------------------------
class UploadResponse(BaseModel):
    filename: str
    total_pages: int
    total_chunks: int
    status: str
    message: str


class ChatRequest(BaseModel):
    question: str = Field(..., min_length=1, description="The natural language question to ask the document.")
    groq_api_key: Optional[str] = Field(None, description="Optional runtime Groq API key override.")
    threshold: Optional[float] = Field(None, ge=0.0, le=1.0, description="Optional runtime grounding threshold.")


class CitationItem(BaseModel):
    page: int
    excerpt: str
    similarity_score: float
    chunk_id: int


class ChatResponse(BaseModel):
    answer: str
    grounded: bool
    top_similarity: float
    threshold: float
    citations: List[CitationItem]
    document_name: Optional[str]


class StatusResponse(BaseModel):
    indexed: bool
    document_name: Optional[str]
    total_pages: int
    total_chunks: int
    has_groq_api_key: bool
    groq_model: str
    grounding_threshold: float


# -----------------------------------------------------------------------------
# API Endpoints
# -----------------------------------------------------------------------------
@app.get("/health", tags=["System"])
async def health_check():
    """Health check endpoint for Render and uptime monitoring."""
    return {"status": "ok", "app": settings.APP_NAME, "version": settings.APP_VERSION}


@app.get("/status", response_model=StatusResponse, tags=["System"])
async def get_system_status():
    """Inspect current in-memory indexing state and configuration."""
    has_key = bool(settings.GROQ_API_KEY and len(settings.GROQ_API_KEY.strip()) > 10)
    is_indexed = pipeline.index is not None and len(pipeline.chunks) > 0
    return StatusResponse(
        indexed=is_indexed,
        document_name=pipeline.current_filename,
        total_pages=pipeline.total_pages,
        total_chunks=len(pipeline.chunks),
        has_groq_api_key=has_key,
        groq_model=pipeline.groq_model,
        grounding_threshold=pipeline.grounding_threshold,
    )


@app.post("/upload", response_model=UploadResponse, tags=["RAG"])
async def upload_pdf(file: UploadFile = File(...)):
    """
    Stage 1-4 Endpoint: Accepts a PDF file, extracts text page-by-page,
    chunks it, computes dense embeddings, and indexes them into in-memory FAISS.
    """
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(
            status_code=400,
            detail="Invalid file format. Only PDF (.pdf) documents are supported."
        )

    try:
        content = await file.read()
        if len(content) == 0:
            raise HTTPException(status_code=400, detail="Uploaded file is empty.")

        # Run extraction, chunking, embedding, and FAISS indexing
        result = pipeline.index_document(content, filename=file.filename)

        return UploadResponse(
            filename=result["filename"],
            total_pages=result["total_pages"],
            total_chunks=result["total_chunks"],
            status="ready",
            message=f"Successfully indexed '{file.filename}' ({result['total_pages']} pages, {result['total_chunks']} chunks)."
        )

    except ValueError as ve:
        logger.warning(f"Validation error during PDF processing: {ve}")
        raise HTTPException(status_code=422, detail=str(ve))
    except Exception as e:
        logger.error(f"Unexpected error during PDF processing: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to process PDF: {str(e)}")


@app.post("/chat", response_model=ChatResponse, tags=["RAG"])
async def chat_with_document(req: ChatRequest):
    """
    Stage 5 Endpoint: Accepts a question, retrieves the top-4 nearest chunks from FAISS,
    enforces the code-level grounding check, and returns an answer with page citations.
    """
    if pipeline.index is None or len(pipeline.chunks) == 0:
        raise HTTPException(
            status_code=400,
            detail="No document has been uploaded yet. Please upload a PDF to `/upload` first."
        )

    try:
        query_result: QueryResult = pipeline.query(
            question=req.question,
            groq_api_key=req.groq_api_key or settings.GROQ_API_KEY,
            custom_threshold=req.threshold or settings.GROUNDING_THRESHOLD,
        )

        citation_items = [
            CitationItem(
                page=c.page,
                excerpt=c.excerpt,
                similarity_score=c.similarity_score,
                chunk_id=c.chunk_id
            )
            for c in query_result.citations
        ]

        return ChatResponse(
            answer=query_result.answer,
            grounded=query_result.grounded,
            top_similarity=query_result.top_similarity,
            threshold=query_result.threshold,
            citations=citation_items,
            document_name=pipeline.current_filename,
        )

    except Exception as e:
        logger.error(f"Error during chat query: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Query failed: {str(e)}")


# -----------------------------------------------------------------------------
# Static Frontend Serving
# -----------------------------------------------------------------------------
if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

    @app.get("/", include_in_schema=False)
    async def serve_ui():
        index_file = STATIC_DIR / "index.html"
        if index_file.exists():
            return FileResponse(str(index_file))
        return JSONResponse({"message": f"{settings.APP_NAME} API running. Visit /docs for OpenAPI specs."})
