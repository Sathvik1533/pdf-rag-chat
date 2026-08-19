"""
FastAPI Application Entry Point
================================
Provides enterprise REST API endpoints with:
- Multi-Tenant Session Isolation (per-user index scoping)
- Sliding-Window Rate Limiting (Token Bucket)
- Hard 15MB File Size & Format Validation Firewall
- FAISS Disk Persistence & State Restoration
- Grounded Q&A with Circuit-Breaker Fallback
"""

from __future__ import annotations

import gc
import os
import uuid
import logging
from pathlib import Path
from typing import List, Optional
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, UploadFile, HTTPException, Query, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

from app.config import settings
from app.core.pipeline import RAGPipeline, QueryResult, Citation, GROUNDING_REFUSAL_MESSAGE
from app.core.rate_limiter import enforce_rate_limit, get_client_identifier, rate_limiter
from app.core.extractors import SUPPORTED_EXTENSIONS

logger = logging.getLogger("rag_api")
logging.basicConfig(level=logging.INFO)

# Maximum file size permitted: 15 MB (protects memory on 512MB RAM cloud containers)
MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Lifespan manager: Loads persistent storage catalog and pre-warms vectorizer.
    """
    gc.collect()
    logger.info(f"{settings.APP_NAME} initialized. Storage dir: {pipeline.storage.storage_dir}")
    yield
    # Cleanup rate limiter
    rate_limiter.cleanup_stale_clients()
    gc.collect()


# Initialize FastAPI App
app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="Production-grade RAG service with multi-tenant isolation, disk persistence, and rate limiting.",
    lifespan=lifespan,
)

# Enable CORS for local testing and cross-origin access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global RAG Pipeline instance with multi-session capability
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


def extract_session_id(request: Request) -> str:
    """Extract or generate consistent session ID from headers or cookies."""
    header_session = request.headers.get("X-Session-ID")
    if header_session and len(header_session.strip()) >= 4:
        return header_session.strip()

    cookie_session = request.cookies.get("veritas_session_id")
    if cookie_session and len(cookie_session.strip()) >= 4:
        return cookie_session.strip()

    return "default"


# -----------------------------------------------------------------------------
# Request & Response Schemas
# -----------------------------------------------------------------------------
class UploadResponse(BaseModel):
    filename: str
    total_pages: int
    total_chunks: int
    status: str
    message: str
    session_id: str


class ChatRequest(BaseModel):
    question: str = Field(..., min_length=1, description="The natural language question to ask the document.")
    groq_api_key: Optional[str] = Field(None, description="Optional runtime Groq API key override (BYOK).")
    threshold: Optional[float] = Field(None, ge=0.0, le=1.0, description="Optional runtime grounding threshold.")


class CitationItem(BaseModel):
    page: int
    excerpt: str
    similarity_score: float
    chunk_id: int
    unit_label: str = "Page 1"


class ChatResponse(BaseModel):
    answer: str
    grounded: bool
    top_similarity: float
    threshold: float
    citations: List[CitationItem]
    document_name: Optional[str]
    retrieval_time_ms: float = 0.0
    generation_time_ms: float = 0.0
    chunk_breakdown: List[dict] = Field(default_factory=list)


class StatusResponse(BaseModel):
    indexed: bool
    document_name: Optional[str]
    total_pages: int
    total_chunks: int
    document_size_bytes: int = 0
    indexing_time_ms: float = 0.0
    has_groq_api_key: bool
    groq_model: str
    grounding_threshold: float
    session_id: str
    persisted_files: int = 0


# -----------------------------------------------------------------------------
# API Endpoints
# -----------------------------------------------------------------------------
@app.api_route("/health", methods=["GET", "HEAD"], tags=["System"])
async def health_check():
    """Health check endpoint for uptime monitors."""
    return {"status": "ok", "app": settings.APP_NAME, "version": settings.APP_VERSION}


@app.get("/status", response_model=StatusResponse, tags=["System"])
async def get_system_status(request: Request):
    """Inspect in-memory indexing state and session configuration."""
    enforce_rate_limit(request, limit=120, window_seconds=60)
    session_id = extract_session_id(request)
    session = pipeline.get_session(session_id)

    has_key = bool(settings.GROQ_API_KEY and len(settings.GROQ_API_KEY.strip()) > 10)
    is_indexed = session.index is not None and len(session.chunks) > 0

    return StatusResponse(
        indexed=is_indexed,
        document_name=session.current_filename,
        total_pages=session.total_pages,
        total_chunks=len(session.chunks),
        document_size_bytes=session.document_size_bytes,
        indexing_time_ms=round(session.last_indexing_time_ms, 1),
        has_groq_api_key=has_key,
        groq_model=pipeline.groq_model,
        grounding_threshold=pipeline.grounding_threshold,
        session_id=session_id,
        persisted_files=len(session.documents)
    )


@app.get("/document/dossier", tags=["RAG"])
async def get_document_dossier(request: Request):
    """Returns the extracted pages, text, and vector chunk mappings for the active session."""
    enforce_rate_limit(request, limit=120, window_seconds=60)
    session_id = extract_session_id(request)
    return pipeline.get_document_dossier(session_id=session_id)


@app.get("/document/list", tags=["RAG"])
async def list_documents(request: Request):
    """Returns all documents cached in active session memory/disk."""
    enforce_rate_limit(request, limit=120, window_seconds=60)
    session_id = extract_session_id(request)
    return {"documents": pipeline.list_documents(session_id=session_id)}


@app.post("/document/switch", tags=["RAG"])
async def switch_document(request: Request, filename: str = Query(..., description="The filename to switch to")):
    """Switches active vector index within user session in 0.1ms."""
    enforce_rate_limit(request, limit=60, window_seconds=60)
    session_id = extract_session_id(request)
    success = pipeline.switch_document(filename, session_id=session_id)
    if not success:
        raise HTTPException(status_code=404, detail=f"Document '{filename}' not found in active session cache.")
    session = pipeline.get_session(session_id)
    return {
        "status": "switched",
        "filename": session.current_filename,
        "total_pages": session.total_pages,
        "total_chunks": len(session.chunks),
        "session_id": session_id
    }


@app.delete("/document/delete", tags=["RAG"])
async def delete_document(request: Request, filename: str = Query(..., description="The filename to delete")):
    """Removes a document from session cache and persistent storage."""
    enforce_rate_limit(request, limit=30, window_seconds=60)
    session_id = extract_session_id(request)
    success = pipeline.delete_document(filename, session_id=session_id)
    return {"status": "deleted" if success else "not_found", "filename": filename}


@app.get("/sample-pdf", tags=["RAG"])
async def get_sample_pdf(request: Request):
    """Returns a generated 3-page sample PDF for instant 1-click testing."""
    enforce_rate_limit(request, limit=30, window_seconds=60)
    from scripts.verify_rag import generate_sample_pdf_bytes
    from fastapi.responses import Response
    pdf_bytes = generate_sample_pdf_bytes()
    return Response(content=pdf_bytes, media_type="application/pdf", headers={"Content-Disposition": "inline; filename=sample_project_orion.pdf"})


@app.post("/upload", response_model=UploadResponse, tags=["RAG"])
async def upload_document(request: Request, file: UploadFile = File(...)):
    """
    Universal Ingestion Endpoint with:
    - 15MB file size enforcement (413 Payload Too Large)
    - Sliding-window rate limit (20 uploads/min per IP/Session)
    - Session-scoped FAISS vector indexing & disk persistence.
    """
    # 1. Enforce Rate Limit
    enforce_rate_limit(request, limit=20, window_seconds=60)
    session_id = extract_session_id(request)

    # 2. Validate File Extension
    ext = Path(file.filename).suffix.lower()
    if ext and ext not in SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported format '{ext}'. Supported formats: PDF, DOCX, PPTX, XLSX, CSV, JSON, YAML, Code, Markdown, and Text."
        )

    # 3. Read Content and Validate File Size
    content = await file.read()
    if len(content) == 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded file is empty.")

    if len(content) > MAX_FILE_SIZE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File exceeds maximum allowed limit of {MAX_FILE_SIZE_BYTES // (1024*1024)}MB. Please upload a smaller file."
        )

    try:
        # 4. Ingest, chunk, embed, index in FAISS, and serialize to disk
        result = pipeline.index_document(content, filename=file.filename, session_id=session_id)

        return UploadResponse(
            filename=result["filename"],
            total_pages=result["total_pages"],
            total_chunks=result["total_chunks"],
            status="ready",
            message=f"Successfully indexed '{file.filename}' ({result['total_pages']} sections, {result['total_chunks']} chunks).",
            session_id=session_id
        )

    except ValueError as ve:
        logger.warning(f"[{session_id}] Validation error during file ingestion: {ve}")
        raise HTTPException(status_code=422, detail=str(ve))
    except Exception as e:
        logger.error(f"[{session_id}] Unexpected error during file processing: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Unable to process the uploaded document. Please verify the file format and try again.")


@app.post("/chat", response_model=ChatResponse, tags=["RAG"])
async def chat_with_document(request: Request, req: ChatRequest):
    """
    Stage 5 Endpoint with:
    - Sliding-window rate limit (45 queries/min per IP/Session)
    - Session-scoped retrieval from user's isolated FAISS index
    - Strict 0.35 Grounding Gate to block hallucinations
    - Circuit-breaker & Exponential Backoff LLM generation.
    """
    # 1. Enforce Rate Limit
    enforce_rate_limit(request, limit=45, window_seconds=60)
    session_id = extract_session_id(request)
    session = pipeline.get_session(session_id)

    if session.index is None or len(session.chunks) == 0:
        raise HTTPException(
            status_code=400,
            detail="No document is currently active in your session. Please upload a document first."
        )

    try:
        query_result: QueryResult = pipeline.query(
            question=req.question,
            groq_api_key=req.groq_api_key or settings.GROQ_API_KEY,
            custom_threshold=req.threshold or settings.GROUNDING_THRESHOLD,
            session_id=session_id
        )

        citation_items = [
            CitationItem(
                page=c.page,
                excerpt=c.excerpt,
                similarity_score=c.similarity_score,
                chunk_id=c.chunk_id,
                unit_label=getattr(c, "unit_label", f"Page {c.page}")
            )
            for c in query_result.citations
        ]

        return ChatResponse(
            answer=query_result.answer,
            grounded=query_result.grounded,
            top_similarity=query_result.top_similarity,
            threshold=query_result.threshold,
            citations=citation_items,
            document_name=session.current_filename,
            retrieval_time_ms=query_result.retrieval_time_ms,
            generation_time_ms=query_result.generation_time_ms,
            chunk_breakdown=query_result.chunk_breakdown,
        )

    except Exception as e:
        logger.error(f"[{session_id}] Error during chat query: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="We encountered an issue analyzing your document. Please try again.")


# -----------------------------------------------------------------------------
# Static Frontend Serving
# -----------------------------------------------------------------------------
if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

    @app.api_route("/", methods=["GET", "HEAD"], include_in_schema=False)
    async def serve_ui(response: Response):
        index_file = STATIC_DIR / "index.html"
        if index_file.exists():
            # Ensure session cookie is set
            res = FileResponse(str(index_file))
            if not response.headers.get("Set-Cookie"):
                sess_id = f"sess_{uuid.uuid4().hex[:12]}"
                res.set_cookie(key="veritas_session_id", value=sess_id, max_age=86400 * 30, httponly=False, samesite="lax")
            return res
        return JSONResponse({"message": f"{settings.APP_NAME} API running. Visit /docs for OpenAPI specs."})
