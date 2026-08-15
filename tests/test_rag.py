"""
Unit and Integration Tests for PDF RAG Pipeline and FastAPI Endpoints
=====================================================================
"""

import io
import pytest
from pypdf import PdfWriter
from fastapi.testclient import TestClient

from app.main import app, pipeline
from app.core.pipeline import RAGPipeline, GROUNDING_REFUSAL_MESSAGE


def create_sample_pdf_bytes() -> bytes:
    """Helper to generate a multi-page PDF in memory for testing."""
    writer = PdfWriter()
    
    # Page 1: Overview
    writer.add_blank_page(width=612, height=792)
    
    # We can write text streams onto blank pages or create a simple valid PDF stream
    # Using pypdf's low-level annotation/page content or basic text streams
    return None


@pytest.fixture(scope="module")
def initialized_pipeline():
    """Create and return a configured pipeline instance with sample data."""
    pipe = RAGPipeline(
        chunk_size=300,
        chunk_overlap=30,
        top_k=3,
        grounding_threshold=0.35
    )
    
    # Simulate page-by-page extracted text for Project Alpha
    pages_text = [
        (1, "Project Alpha Overview: Project Alpha is an autonomous drone delivery initiative designed for urban environments. The project is led by Dr. Evelyn Reed and began in January 2026."),
        (2, "Budget and Deadlines: The total approved capital expenditure for Project Alpha is $3.5 million USD. The targeted commercial launch deadline is set for November 15, 2026."),
        (3, "Technical Architecture: The drone fleet utilizes lithium-sulfur battery packs offering a 45-minute maximum flight time with a 5kg payload capacity. Navigation uses dual GPS and LiDAR sensors.")
    ]
    
    chunks = pipe.chunk_pages(pages_text, filename="project_alpha_spec.pdf")
    pipe.chunks = chunks
    
    # Build FAISS index
    import faiss
    chunk_texts = [c.text for c in chunks]
    embeddings = pipe.embedder.encode(chunk_texts, normalize_embeddings=True, convert_to_numpy=True).astype("float32")
    
    index = faiss.IndexFlatIP(pipe.embedding_dim)
    index.add(embeddings)
    pipe.index = index
    pipe.total_pages = 3
    pipe.current_filename = "project_alpha_spec.pdf"
    
    return pipe


def test_chunking_preserves_page_numbers(initialized_pipeline):
    """Verify that chunks accurately retain their original 1-indexed page numbers."""
    pipe = initialized_pipeline
    assert len(pipe.chunks) > 0
    pages_found = set(c.page for c in pipe.chunks)
    assert 1 in pages_found
    assert 2 in pages_found
    assert 3 in pages_found


def test_in_scope_retrieval(initialized_pipeline):
    """Verify that an in-scope question retrieves relevant chunks with high similarity."""
    pipe = initialized_pipeline
    query = "What is the budget and deadline for the project?"
    retrieved = pipe.retrieve(query, top_k=2)
    
    assert len(retrieved) > 0
    top_chunk, top_sim = retrieved[0]
    
    # Check that it retrieved Page 2 (which discusses budget and deadline)
    assert top_chunk.page == 2
    assert "3.5 million" in top_chunk.text
    assert top_sim >= 0.35


def test_grounding_refusal_for_out_of_scope_query(initialized_pipeline):
    """
    CRITICAL TEST: Verify that out-of-scope queries fail the code-level
    similarity threshold and return the exact fixed refusal message.
    """
    pipe = initialized_pipeline
    query = "What are the rules of medieval jousting tournaments in 14th century France?"
    
    # Query without LLM call to test the grounding filter deterministically
    result = pipe.query(query)
    
    assert result.grounded is False
    assert result.answer == GROUNDING_REFUSAL_MESSAGE
    assert len(result.citations) == 0
    assert result.top_similarity < 0.35


def test_fastapi_health_endpoint():
    """Verify the /health endpoint returns 200 OK."""
    client = TestClient(app)
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"


def test_fastapi_status_endpoint():
    """Verify the /status endpoint returns valid system information."""
    client = TestClient(app)
    response = client.get("/status")
    assert response.status_code == 200
    data = response.json()
    assert "grounding_threshold" in data
    assert "groq_model" in data
