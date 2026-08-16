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


def test_document_history_and_clean_context_switching():
    """Verify multiple documents can be indexed in a session, switched, and retrieved with zero cross-talk."""
    client = TestClient(app)
    session_id = "test_switching_sess_99"

    # 1. Upload Doc A (Markdown)
    doc_a_content = b"# Falcon Architecture\nFalcon is a 2026 supersonic aircraft designed for rapid transatlantic transit."
    res_a = client.post(
        "/upload",
        files={"file": ("falcon_spec.md", io.BytesIO(doc_a_content), "text/markdown")},
        headers={"X-Session-ID": session_id}
    )
    assert res_a.status_code == 200
    assert res_a.json()["filename"] == "falcon_spec.md"

    # 2. Upload Doc B (CSV)
    doc_b_content = b"Satellite,Orbit,Band\nOrion-1,LEO,Ku\nOrion-2,GEO,Ka\n"
    res_b = client.post(
        "/upload",
        files={"file": ("satellites.csv", io.BytesIO(doc_b_content), "text/csv")},
        headers={"X-Session-ID": session_id}
    )
    assert res_b.status_code == 200
    assert res_b.json()["filename"] == "satellites.csv"

    # 3. List documents - both should be in the user's library
    res_list = client.get("/document/list", headers={"X-Session-ID": session_id})
    assert res_list.status_code == 200
    docs = [d["filename"] for d in res_list.json()["documents"]]
    assert "falcon_spec.md" in docs
    assert "satellites.csv" in docs

    # 4. Active document is now Doc B (satellites.csv)
    # Retrieving from Doc B should match satellites
    session = pipeline.get_session(session_id)
    assert session.current_filename == "satellites.csv"
    retrieved_b = pipeline.retrieve("Which band does Orion-2 use?", session_id=session_id)
    assert len(retrieved_b) > 0
    assert "Orion-2" in retrieved_b[0][0].text

    # 5. Switch back to Doc A (falcon_spec.md)
    res_switch = client.post(
        "/document/switch?filename=falcon_spec.md",
        headers={"X-Session-ID": session_id}
    )
    assert res_switch.status_code == 200
    assert res_switch.json()["filename"] == "falcon_spec.md"

    # 6. Retrieving from Doc A now retrieves falcon details, not satellite rows
    retrieved_a = pipeline.retrieve("What is Falcon?", session_id=session_id)
    assert len(retrieved_a) > 0
    assert "supersonic aircraft" in retrieved_a[0][0].text


def test_per_session_history_isolation():
    """Verify that User 1's saved files/history are completely invisible to User 2."""
    client = TestClient(app)
    sess_user_1 = "sess_user_alpha_01"
    sess_user_2 = "sess_user_beta_02"

    # User 1 uploads proprietary doc
    content_user_1 = b"Confidential financial records for User 1 only."
    client.post(
        "/upload",
        files={"file": ("secret_user1.txt", io.BytesIO(content_user_1), "text/plain")},
        headers={"X-Session-ID": sess_user_1}
    )

    # User 2 lists documents - should NOT see User 1's doc
    res_user_2 = client.get("/document/list", headers={"X-Session-ID": sess_user_2})
    assert res_user_2.status_code == 200
    user_2_docs = [d["filename"] for d in res_user_2.json()["documents"]]
    assert "secret_user1.txt" not in user_2_docs

