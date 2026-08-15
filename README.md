# Verifiable PDF RAG Assistant

A fast, lightweight, and verifiable **Retrieval-Augmented Generation (RAG)** application that allows users to upload PDF documents, ask questions, receive grounded answers with exact page citations, and enforce a deterministic code-level refusal mechanism on out-of-scope queries.

---

## Key Features

- **Page-Preserving PDF Parsing**: Extracts text page-by-page using `pypdf` to maintain exact source attribution.
- **Syntactic Chunking**: Splits documents with `RecursiveCharacterTextSplitter` (`chunk_size=500`, `chunk_overlap=50`).
- **Zero-Cost Local Embeddings**: Employs `sentence-transformers` (`all-MiniLM-L6-v2`) for local 384-dimensional vector representations.
- **In-Memory FAISS Retrieval**: Uses `faiss.IndexFlatIP` on unit-normalized vectors for exact cosine similarity nearest-neighbor lookup.
- **Code-Level Grounding Enforcer**: Deterministically blocks hallucinations by checking maximum similarity before invoking the LLM. If confidence is below threshold (`0.35`), returns fixed refusal `"I couldn't find anything about that in this document."`
- **Fast Generation via Groq**: Powers synthesis with `llama-3.3-70b-versatile` for high-accuracy answers.
- **Verifiable Citations**: Every answer includes page numbers, similarity scores, and source text snippets.
- **Clean Single-Page UI**: Drag-and-drop PDF upload with real-time stats and interactive citation cards.

---

## Architecture Overview

```
[ PDF Upload ]
      │
      ▼
1. Extract (pypdf) ─── Page-by-page text extraction with page metadata
      │
      ▼
2. Chunk (RecursiveCharacterTextSplitter) ─── chunk_size=500, chunk_overlap=50
      │
      ▼
3. Embed (sentence-transformers / all-MiniLM-L6-v2) ─── 384-dim normalized vectors
      │
      ▼
4. Store (FAISS In-Memory IndexFlatIP) ─── Fast cosine similarity lookup
      │
      ▼
[ User Question ] ─── Embed with same model ─── Top-4 Nearest Neighbors retrieval
      │
      ▼
  ┌────────────────────────────────────────────────────────┐
  │ 5. Code-Level Grounding Check                          │
  │    Max Cosine Similarity >= 0.35?                      │
  └──────────────┬─────────────────────────┬───────────────┘
                 │ NO                      │ YES
                 ▼                         ▼
   Return Fixed Refusal:             6. Generate (Groq Llama 3.3 70B)
   "I couldn't find anything         Build prompt with context + question
   about that in this document."     Return Answer + Page Citations & Excerpts
```

---

## Quickstart

### 1. Clone & Install
```bash
git clone https://github.com/Sathvik1533/pdf-rag-chat.git
cd pdf-rag-chat
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 2. Configure Environment
Create a `.env` file (or copy `.env.example`):
```bash
cp .env.example .env
```
Add your Groq API key:
```env
GROQ_API_KEY=gsk_your_groq_api_key_here
```

### 3. Run Locally
```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```
Open [http://localhost:8000](http://localhost:8000) in your browser.

---

## API Endpoints

### `POST /upload`
Uploads and indexes a PDF document into in-memory FAISS.
- **Payload:** `multipart/form-data` with `file: <pdf-binary>`
- **Response:**
  ```json
  {
    "filename": "annual_report.pdf",
    "total_pages": 4,
    "total_chunks": 12,
    "status": "ready",
    "message": "Successfully indexed 'annual_report.pdf' (4 pages, 12 chunks)."
  }
  ```

### `POST /chat`
Asks a question against the currently indexed document.
- **Request Body:**
  ```json
  {
    "question": "What is the total quarterly revenue?",
    "threshold": 0.35
  }
  ```
- **Response (Grounded in-scope question):**
  ```json
  {
    "answer": "The total quarterly revenue reached $4.2 million in Q3 [Page 2].",
    "grounded": true,
    "top_similarity": 0.7642,
    "threshold": 0.35,
    "citations": [
      {
        "page": 2,
        "excerpt": "Total quarterly revenue reached $4.2 million in Q3, representing a 14% year-over-year growth...",
        "similarity_score": 0.7642,
        "chunk_id": 3
      }
    ],
    "document_name": "annual_report.pdf"
  }
  ```
- **Response (Out-of-scope question):**
  ```json
  {
    "answer": "I couldn't find anything about that in this document.",
    "grounded": false,
    "top_similarity": 0.1834,
    "threshold": 0.35,
    "citations": [],
    "document_name": "annual_report.pdf"
  }
  ```

### `GET /status`
Returns indexing status, active document details, and configuration.

### `GET /health`
Returns health check status for deployment monitors.

---

## Running Verification Tests

Run the automated test suite:
```bash
pytest tests/
```

Run the end-to-end live verification script:
```bash
python scripts/verify_rag.py
```

---

## Deploy to Render

This repository includes a [`render.yaml`](./render.yaml) blueprint:
1. Push this repository to GitHub.
2. Go to [Render Dashboard](https://dashboard.render.com/) -> **New** -> **Blueprint**.
3. Select this repository.
4. Add the `GROQ_API_KEY` secret in the environment settings.
5. Click **Apply** to deploy.
