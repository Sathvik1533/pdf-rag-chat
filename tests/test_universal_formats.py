"""
Unit test suite for Universal Multi-Format Document and Data Extractors.
Tests PDF, CSV, JSON, Markdown, Plain Text, Code, and Office formats.
"""

import pytest
from app.core.extractors import (
    extract_universal,
    extract_csv,
    extract_json,
    extract_code,
    extract_plain_text,
    SUPPORTED_EXTENSIONS
)
from app.core.pipeline import RAGPipeline


def test_supported_extensions():
    """Verify that all major data and document extensions are in the supported registry."""
    assert ".pdf" in SUPPORTED_EXTENSIONS
    assert ".docx" in SUPPORTED_EXTENSIONS
    assert ".pptx" in SUPPORTED_EXTENSIONS
    assert ".xlsx" in SUPPORTED_EXTENSIONS
    assert ".csv" in SUPPORTED_EXTENSIONS
    assert ".json" in SUPPORTED_EXTENSIONS
    assert ".py" in SUPPORTED_EXTENSIONS
    assert ".md" in SUPPORTED_EXTENSIONS
    assert ".txt" in SUPPORTED_EXTENSIONS


def test_csv_extraction_and_table_formatting():
    """Verify CSV data is parsed into clean Markdown tables."""
    csv_bytes = b"Product,Q1_Revenue,Q2_Revenue,Growth\nOrion Glider,500000,750000,50%\nSolar Panel,120000,180000,50%\nTelemetry Box,80000,95000,18.7%"
    units = extract_csv(csv_bytes, "finance_data.csv")
    
    assert len(units) >= 1
    assert "Orion Glider" in units[0].text
    assert "| Product | Q1_Revenue |" in units[0].text
    assert units[0].label.startswith("Rows")


def test_json_extraction():
    """Verify JSON structures are parsed into clean structured records."""
    json_bytes = b'''[
        {"satellite": "Orion-1", "altitude_km": 20.5, "status": "Operational"},
        {"satellite": "Orion-2", "altitude_km": 21.2, "status": "In Orbit"}
    ]'''
    units = extract_json(json_bytes, "fleet.json")
    
    assert len(units) >= 1
    assert "Orion-1" in units[0].text
    assert "Operational" in units[0].text


def test_code_extraction_with_line_numbers():
    """Verify Python code files are split into line-number blocks."""
    code_bytes = b'''import math

def calculate_orbital_velocity(altitude_km):
    """Calculate speed for circular orbit."""
    G = 6.67430e-11
    M = 5.972e24
    r = (6371 + altitude_km) * 1000
    return math.sqrt(G * M / r)
'''
    units = extract_code(code_bytes, "orbit.py")
    
    assert len(units) >= 1
    assert "calculate_orbital_velocity" in units[0].text
    assert units[0].label.startswith("Lines")


def test_markdown_and_plain_text_extraction():
    """Verify markdown and plain text files are segmented into logical pages."""
    md_bytes = b'''# Project Nebula Specification

## Overview
Project Nebula is an autonomous constellation of deep-space optical transmitters.

## Launch Date
Scheduled for October 15, 2028 from Kennedy Space Center.
'''
    units = extract_plain_text(md_bytes, "nebula_spec.md")
    
    assert len(units) >= 1
    assert "Project Nebula" in units[0].text
    assert "October 15, 2028" in units[0].text


def test_universal_pipeline_indexing_with_csv():
    """Test full RAG pipeline indexing a CSV file and querying it."""
    csv_bytes = b"Team_Member,Role,Email\nDr. Sophia Chen,Lead Engineer,chen@orion.org\nMarcus Vance,Flight Operations,vance@orion.org\nElena Rostova,Sensor Array Lead,rostova@orion.org"
    
    pipeline = RAGPipeline()
    res = pipeline.index_document(csv_bytes, filename="team_directory.csv")
    
    assert res["status"] == "ready"
    assert res["total_chunks"] >= 1
    assert len(pipeline.chunks) >= 1
    assert pipeline.chunks[0].unit_label.startswith("Rows")

    # Test retrieval
    retrieved = pipeline.retrieve("Who is the Lead Engineer?")
    assert len(retrieved) > 0
    top_chunk, score = retrieved[0]
    assert "Dr. Sophia Chen" in top_chunk.text


def test_binary_doc_extraction():
    """Verify legacy binary .doc containers (or files with binary headers) are extracted safely."""
    # Simulate a binary Word 97-2004 document stream containing UTF-16LE text and OLE headers
    fake_ole_header = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1Root Entry\x00\x00WordDocument\x00"
    content_utf16 = "This is a confidential knowledge transfer document outlining the deployment steps for Veritas API.".encode("utf-16le")
    raw_doc_bytes = fake_ole_header + content_utf16 + b"\x00\x00\x00\x00"

    units = extract_universal(raw_doc_bytes, "Knowledge transfer doc.doc")
    assert len(units) >= 1
    assert "knowledge transfer document" in units[0][2].lower()


def test_truncated_pdf_stream_recovery():
    """Verify that truncated or damaged PDF streams recover text without crashing."""
    # Construct a deliberately broken / truncated PDF stream with unclosed objects
    truncated_pdf = (
        b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n"
        b"2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n"
        b"3 0 obj\n<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>\nendobj\n"
        b"4 0 obj\n<< /Length 120 >>\nstream\nBT\n/F1 12 Tf\n(Critical knowledge transfer guidelines for project operations) Tj\nET\nendstream\n"
        # Truncated without xref table or trailer
    )
    units = extract_universal(truncated_pdf, "Knowledge transfer.pdf")
    assert len(units) >= 1
    assert "knowledge transfer guidelines" in units[0][2].lower()


