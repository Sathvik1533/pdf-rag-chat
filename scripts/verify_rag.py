#!/usr/bin/env python3
"""
End-to-End Verification Script for Verifiable PDF RAG System
============================================================
This script validates the complete RAG lifecycle:
1. Synthesizes a real multi-page PDF document on disk.
2. Uploads and indexes the document through the RAG pipeline.
3. Executes an IN-SCOPE question -> verifies grounded answer with page citations.
4. Executes an OUT-OF-SCOPE question -> verifies deterministic refusal in code.
5. Outputs raw JSON request and response payloads for verification inspection.
"""

import os
import sys
import json
import io
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient
from app.main import app, pipeline
from app.core.pipeline import GROUNDING_REFUSAL_MESSAGE


def generate_sample_pdf_bytes() -> bytes:
    """
    Generate a 3-page valid PDF with distinct technical content across pages.
    """
    # Raw minimal PDF stream format for multi-page documents
    # Page 1: Overview
    # Page 2: Financials & Deadlines
    # Page 3: Technical Specifications
    
    # We construct standard valid PDF content
    pdf_content = (
        b"%PDF-1.4\n"
        b"1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n"
        b"2 0 obj << /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >> endobj\n"
        # Page 1
        b"3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 6 0 R /Resources << /Font << /F1 9 0 R >> >> >> endobj\n"
        # Page 2
        b"4 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 7 0 R /Resources << /Font << /F1 9 0 R >> >> >> endobj\n"
        # Page 3
        b"5 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 8 0 R /Resources << /Font << /F1 9 0 R >> >> >> endobj\n"
        # Stream 1
        b"6 0 obj << /Length 270 >> stream\n"
        b"BT /F1 12 Tf 50 720 Td (Project Orion: Autonomous High-Altitude Weather Monitoring System) Tj\n"
        b"0 -30 Td (Document Overview: Project Orion is an initiative led by Chief Engineer Dr. Sophia Chen.) Tj\n"
        b"0 -20 Td (The mission is designed to deploy high-altitude solar-powered gliders across the Pacific basin.) Tj ET\n"
        b"endstream endobj\n"
        # Stream 2
        b"7 0 obj << /Length 310 >> stream\n"
        b"BT /F1 12 Tf 50 720 Td (Financial Budget and Target Launch Milestones) Tj\n"
        b"0 -30 Td (The total approved capital budget for Project Orion is $4.85 million USD for Phase 1.) Tj\n"
        b"0 -20 Td (The strict commercial deployment deadline is scheduled for December 18, 2026.) Tj\n"
        b"0 -20 Td (Operations will be based in Honolulu, Hawaii with secondary telemetry in San Diego.) Tj ET\n"
        b"endstream endobj\n"
        # Stream 3
        b"8 0 obj << /Length 300 >> stream\n"
        b"BT /F1 12 Tf 50 720 Td (Propulsion and Sensor Architecture) Tj\n"
        b"0 -30 Td (Each Orion glider features dual brushless electric motors powered by gallium-arsenide solar arrays.) Tj\n"
        b"0 -20 Td (The sensory payload includes infrared atmospheric spectrometers and multispectral imaging cameras.) Tj ET\n"
        b"endstream endobj\n"
        # Font object
        b"9 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n"
        b"xref\n"
        b"0 10\n"
        b"0000000000 65535 f \n"
        b"0000000009 00000 n \n"
        b"0000000058 00000 n \n"
        b"0000000133 00000 n \n"
        b"0000000257 00000 n \n"
        b"0000000381 00000 n \n"
        b"0000000505 00000 n \n"
        b"0000000827 00000 n \n"
        b"0000001189 00000 n \n"
        b"0000001541 00000 n \n"
        b"trailer << /Size 10 /Root 1 0 R >>\n"
        b"startxref\n"
        b"1615\n"
        b"%%EOF\n"
    )
    return pdf_content


def main():
    print("=" * 80)
    print("  VERIFIABLE PDF RAG SYSTEM — END-TO-END VERIFICATION RUN")
    print("=" * 80)
    
    client = TestClient(app)

    # -------------------------------------------------------------------------
    # TEST 1: PDF Upload & Indexing
    # -------------------------------------------------------------------------
    print("\n[STEP 1] Generating and Uploading 3-Page Sample PDF ('project_orion_spec.pdf')...")
    pdf_bytes = generate_sample_pdf_bytes()
    
    # Save a copy locally for reference
    sample_path = Path(__file__).resolve().parent.parent / "sample_project_orion.pdf"
    with open(sample_path, "wb") as f:
        f.write(pdf_bytes)
    print(f"  ✓ Saved test PDF to: {sample_path}")

    upload_response = client.post(
        "/upload",
        files={"file": ("project_orion_spec.pdf", io.BytesIO(pdf_bytes), "application/pdf")}
    )
    
    print(f"  Upload HTTP Status: {upload_response.status_code}")
    print("  Raw /upload Response Payload:")
    print("  " + json.dumps(upload_response.json(), indent=4).replace("\n", "\n  "))
    
    assert upload_response.status_code == 200, "Upload failed"
    upload_data = upload_response.json()
    assert upload_data["total_pages"] == 3, f"Expected 3 pages, got {upload_data['total_pages']}"
    assert upload_data["total_chunks"] >= 3, "Expected at least 3 chunks"

    # -------------------------------------------------------------------------
    # TEST 2: In-Scope Grounded Query
    # -------------------------------------------------------------------------
    in_scope_question = "What is the total approved capital budget and what is the launch deadline for Project Orion?"
    print("\n" + "-" * 80)
    print(f"[STEP 2] Testing IN-SCOPE Question (Should be Grounded with Page 2 Citations):")
    print(f"  Question: '{in_scope_question}'")
    
    chat_payload_1 = {
        "question": in_scope_question,
        "threshold": 0.35
    }
    
    print("\n  Raw /chat Request Payload:")
    print("  " + json.dumps(chat_payload_1, indent=4).replace("\n", "\n  "))
    
    chat_response_1 = client.post("/chat", json=chat_payload_1)
    chat_data_1 = chat_response_1.json()
    
    print(f"\n  Chat HTTP Status: {chat_response_1.status_code}")
    print("  Raw /chat Response Payload:")
    print("  " + json.dumps(chat_data_1, indent=4).replace("\n", "\n  "))
    
    # Assertions for In-Scope
    assert chat_data_1["grounded"] is True, "Expected query to be grounded!"
    assert chat_data_1["top_similarity"] >= 0.35, f"Expected top_similarity >= 0.35, got {chat_data_1['top_similarity']}"
    assert len(chat_data_1["citations"]) > 0, "Expected at least one citation"
    
    # Verify Page 2 is present in citations
    citation_pages = [c["page"] for c in chat_data_1["citations"]]
    print(f"  ✓ Verified citations present for pages: {citation_pages}")
    assert 2 in citation_pages, "Expected citation to reference Page 2 (Budget/Deadline page)"

    # -------------------------------------------------------------------------
    # TEST 3: Out-of-Scope Query (Mandatory Code-Level Grounding Refusal)
    # -------------------------------------------------------------------------
    out_of_scope_question = "How do antimatter warp engines navigate through wormhole gravitational anomalies?"
    print("\n" + "-" * 80)
    print(f"[STEP 3] Testing OUT-OF-SCOPE Question (Must Return Fixed Refusal String):")
    print(f"  Question: '{out_of_scope_question}'")
    
    chat_payload_2 = {
        "question": out_of_scope_question,
        "threshold": 0.35
    }
    
    print("\n  Raw /chat Request Payload:")
    print("  " + json.dumps(chat_payload_2, indent=4).replace("\n", "\n  "))
    
    chat_response_2 = client.post("/chat", json=chat_payload_2)
    chat_data_2 = chat_response_2.json()
    
    print(f"\n  Chat HTTP Status: {chat_response_2.status_code}")
    print("  Raw /chat Response Payload:")
    print("  " + json.dumps(chat_data_2, indent=4).replace("\n", "\n  "))
    
    # Critical Assertions for Grounding Refusal
    assert chat_data_2["grounded"] is False, "Expected query to be ungrounded (refused)!"
    assert chat_data_2["answer"] == GROUNDING_REFUSAL_MESSAGE, f"Expected exact refusal '{GROUNDING_REFUSAL_MESSAGE}', got '{chat_data_2['answer']}'"
    assert len(chat_data_2["citations"]) == 0, "Expected 0 citations on refused query"
    assert chat_data_2["top_similarity"] < 0.35, f"Expected similarity < 0.35, got {chat_data_2['top_similarity']}"

    print("\n" + "=" * 80)
    print("  ✓ ALL VERIFICATION TESTS PASSED SUCCESSFULLY!")
    print("  ✓ In-scope query returned grounded evidence and page citations.")
    print("  ✓ Out-of-scope query was rejected by the code-level grounding enforcer.")
    print("=" * 80)


if __name__ == "__main__":
    main()
