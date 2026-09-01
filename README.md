<div align="center">

# ⚡ VERITAS — Grounded Document AI & RAG Studio

### *Sub-Millisecond Multi-Format Document Intelligence with Verifiable Page Citations, Zero-Hallucination Guardrails, Disk-Backed Vector Persistence, and Multi-Tenant Isolation*

[![FastAPI](https://img.shields.io/badge/FastAPI-0.110+-009688.svg?style=for-the-badge&logo=FastAPI&logoColor=white)](https://fastapi.tiangolo.com)
[![Python](https://img.shields.io/badge/Python-3.11+-3776AB.svg?style=for-the-badge&logo=Python&logoColor=white)](https://python.org)
[![Groq LLaMA 3.3](https://img.shields.io/badge/Groq-LLaMA_3.3_70B-F55036.svg?style=for-the-badge&logo=fastly&logoColor=white)](https://groq.com)
[![FAISS](https://img.shields.io/badge/FAISS-Dense_Search-0080FF.svg?style=for-the-badge&logo=meta&logoColor=white)](https://github.com/facebookresearch/faiss)
[![License](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](LICENSE)
[![Tests](https://img.shields.io/badge/Tests-16%2F16_Passing-brightgreen.svg?style=for-the-badge)](tests/)
[![Status](https://img.shields.io/badge/Production-Live-success.svg?style=for-the-badge)](https://pdf-rag-chat-nylf.onrender.com)

---

## 🔗 Quick Links

| | |
|:---:|:---:|
| [🌐 **Live Demo** — Try it now](https://pdf-rag-chat-nylf.onrender.com) | [💻 **GitHub Repo** — View Source](https://github.com/Sathvik1533/pdf-rag-chat) |

---

</div>

---

## 🌟 Executive Summary

**Veritas** is a deterministic **Retrieval-Augmented Generation (RAG)** platform built to reduce hallucinations in document Q&A. By enforcing a **cosine similarity grounding floor** prior to LLM synthesis, Veritas anchors every generated response to verifiable source passages with exact page-level citations.

Engineered with a lightweight memory footprint (~0.2MB delta per ingestion), Veritas achieves **sub-millisecond vector retrieval (0.305ms avg)** across 9 distinct file formats, delivers **disk-serialized vector persistence across container restarts**, provides **per-user multi-tenant isolation**, and features an **exponential backoff circuit breaker** with grounded extractive fallback.

---

## 💎 Core Capabilities
