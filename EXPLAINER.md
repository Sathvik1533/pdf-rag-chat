# Understanding Retrieval-Augmented Generation (RAG)

*A practical, under-5-minute explainer on how this system works, why each component exists, and what separates real grounding from fluent guessing.*

---

## 1. The Five-Stage RAG Pipeline

Every RAG system follows this five-step sequence. Here is what each stage accomplishes and what breaks if you remove it:

```
[ PDF Document ]
       │
       ▼
 1. EXTRACT   ──► Extracts page-by-page text with metadata.
       │          (Without it: Machine has no text to read.)
       ▼
  2. CHUNK    ──► Splits text into 500-char blocks with 50-char overlap.
       │          (Without it: Context window overflows or haystack dilution destroys accuracy.)
       ▼
  3. EMBED    ──► all-MiniLM-L6-v2 transforms text into 384-dim semantic vectors.
       │          (Without it: Search is restricted to brittle keyword matching.)
       ▼
 4. RETRIEVE  ──► FAISS cosine similarity finds top-4 nearest chunks.
       │          (Without it: LLM has no relevant facts to answer from.)
       ▼
 5. GENERATE  ──► Groq Llama 3.3 70B synthesizes answer with page citations.
                  (Without it: User gets raw disjointed chunks instead of a coherent answer.)
```

### Stage Breakdown & Failure Modes

1. **Extract (`pypdf`)**: Reads raw PDF bytes and extracts text page-by-page.
   - *If removed:* You cannot process PDFs at all. If you extract without page numbers, you lose the ability to provide verifiable page citations.
2. **Chunk (`RecursiveCharacterTextSplitter`)**: Splits text into 500-character segments with a 50-character overlap along natural paragraph and sentence boundaries.
   - *If removed:* If you feed the entire document to the LLM, you hit token limits on large documents. Even on short ones, "needle-in-a-haystack" dilution causes the model to miss critical details or degrade in reasoning quality.
3. **Embed (`sentence-transformers / all-MiniLM-L6-v2`)**: Converts text strings into 384-dimensional dense vectors where spatial proximity reflects semantic meaning.
   - *If removed:* You would have to use exact keyword matching (like SQL `LIKE` or basic grep). If a user asks *"What is the cost?"* and the document says *"The pricing fee is $500"*, keyword search finds nothing; semantic embeddings understand that "cost" and "pricing fee" are near-identical in vector space.
4. **Retrieve (`faiss-cpu`)**: Calculates cosine similarity between the question vector and stored chunk vectors, returning the top-4 closest matches.
   - *If removed:* There is no mechanism to quickly locate relevant knowledge from thousands of chunks.
5. **Ground & Generate (`Groq Llama 3.3 70B`)**: Enforces the confidence check and feeds the retrieved facts into the prompt for answer generation.
   - *If removed:* The user would only see disconnected text fragments rather than a clear, synthesised answer.

---

## 2. Why the Grounding Check Must Live in Code (Not Just in the Prompt)

### The Hallucination Vulnerability
Large Language Models are probabilistic next-token predictors. When given a question that has no answer in the document, an LLM has no innate consciousness of "I don't know." Its mathematical objective is simply to generate the most plausible-sounding sequence of words.

If you prompt an LLM: *"Answer only from context, say 'I don't know' if missing"*, the model will **frequently ignore the instruction** and fabricate a fluent, highly confident answer using its pre-training weights.

### The Code-Level Solution
In this project, grounding is enforced deterministically in Python **before the LLM is ever invoked**:

```python
# app/core/pipeline.py
top_chunk, top_similarity = retrieved_items[0]

# Refuse to answer if retrieval confidence is too low, rather than letting
# the LLM guess — this is what prevents hallucination on out-of-scope questions.
if top_similarity < 0.35:
    return QueryResult(
        answer="I couldn't find anything about that in this document.",
        grounded=False,
        citations=[]
    )
```

If the highest cosine similarity score among the top chunks is below `0.35`, the system **aborts the LLM call entirely** and returns a fixed refusal string. This converts grounding from an unreliable prompt suggestion into an unbreakable mathematical guarantee.

---

## 3. Chunking & Retrieval Parameters: The Core Tradeoffs

| Parameter | Value in this Build | What it Controls | Tradeoff |
| :--- | :--- | :--- | :--- |
| **`chunk_size`** | `500` chars (~100 words) | Length of each document slice | **Too large:** Irrelevant filler dilutes relevance.<br>**Too small:** Sentences lose surrounding context. |
| **`chunk_overlap`** | `50` chars (~10 words) | Shared text between adjacent slices | **Too low:** Facts split across chunk boundaries are lost.<br>**Too high:** Redundant duplicate text wastes context space. |
| **`top_k`** | `4` chunks | Number of evidence chunks retrieved | **Too low:** Misses multi-part answers across pages.<br>**Too high:** Distracts the LLM with marginal matches. |
| **`grounding_threshold`** | `0.35` cosine similarity | Confidence cutoff for answering | **Too high:** False refusals on slightly rephrased queries.<br>**Too low:** Hallucinations on irrelevant questions. |

---

## 4. Production-Grade Gap (What Was Deliberately Not Built)

To maintain strict scope and verify core mechanics, this project deliberately avoids unnecessary complexity. For an enterprise production deployment, the following would be required:

1. **Persistent Vector Database**: Replacing in-memory FAISS with a managed cluster (e.g., Qdrant, Pinecone, pgvector) so indexed documents persist across server restarts.
2. **Multi-Tenancy & Auth**: User authentication, role-based access control, and workspace-isolated indexes.
3. **Cross-Encoder Reranking**: Adding a secondary reranker (e.g., `bge-reranker-large`) on top of initial FAISS retrieval to re-score top-20 chunks for higher precision on 500+ page documents.
4. **Rate Limiting & Cost Guardrails**: Token throttling, abuse prevention, and request quota management.
5. **Observability & Evaluation**: Tracing latency with OpenTelemetry and scoring retrieval faithfulness with Ragas or TruLens.
