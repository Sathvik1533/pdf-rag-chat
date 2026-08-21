"""
Veritas Production Information Retrieval (IR) Evaluation Suite
=============================================================
Evaluates Dense Semantic, BM25 Lexical, and Hybrid RRF Retrieval
against Information Retrieval Industry Standards:
- Precision@K (P@K)
- Recall@K (R@K)
- Mean Reciprocal Rank (MRR)
- Normalized Discounted Cumulative Gain (NDCG@K)
"""

import math
import time
import sys
from pathlib import Path
from typing import List, Set, Dict, Any, Tuple

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.pipeline import RAGPipeline, DocumentChunk


class IREvaluator:
    """
    Computes precision, recall, MRR, and NDCG metrics for RAG retrieval engines.
    """

    @staticmethod
    def precision_at_k(retrieved_chunk_ids: List[str], ground_truth_ids: Set[str], k: int) -> float:
        top_k = retrieved_chunk_ids[:k]
        if not top_k:
            return 0.0
        hits = sum(1 for cid in top_k if cid in ground_truth_ids)
        return hits / float(k)

    @staticmethod
    def recall_at_k(retrieved_chunk_ids: List[str], ground_truth_ids: Set[str], k: int) -> float:
        if not ground_truth_ids:
            return 0.0
        top_k = retrieved_chunk_ids[:k]
        hits = sum(1 for cid in top_k if cid in ground_truth_ids)
        return hits / float(len(ground_truth_ids))

    @staticmethod
    def mrr(retrieved_chunk_ids: List[str], ground_truth_ids: Set[str]) -> float:
        for rank, cid in enumerate(retrieved_chunk_ids, start=1):
            if cid in ground_truth_ids:
                return 1.0 / float(rank)
        return 0.0

    @staticmethod
    def ndcg_at_k(retrieved_chunk_ids: List[str], ground_truth_ids: Set[str], k: int) -> float:
        top_k = retrieved_chunk_ids[:k]
        dcg = 0.0
        for i, cid in enumerate(top_k):
            rel = 1.0 if cid in ground_truth_ids else 0.0
            dcg += rel / math.log2(i + 2)

        ideal_hits = min(len(ground_truth_ids), k)
        idcg = sum(1.0 / math.log2(i + 2) for i in range(ideal_hits))
        if idcg == 0.0:
            return 0.0
        return dcg / idcg


def run_benchmark():
    print("===============================================================")
    print("🚀 Running Veritas Production Hybrid RAG Evaluation Benchmark")
    print("===============================================================")

    pipeline = RAGPipeline()

    sample_doc = """
    # Project Orion Technical Architecture Specification
    
    ## Section 1: Executive Overview
    Project Orion is an enterprise data reconciliation platform built with PyTorch and FastAPI.
    The primary goal is real-time anomaly detection with sub-5ms latencies.
    
    ## Section 2: Budget and Financial Allocations
    The total Phase 1 budget allocated is $4.85 Million USD.
    Infrastructure costs account for $1.2M, while research and compute receive $2.65M.
    
    ## Section 3: Vector Indexing & FAISS Engine
    Vector embeddings are generated using a 384-dimensional dense semantic encoder.
    FAISS IndexFlatIP is utilized for in-memory inner product similarity calculations.
    The mathematical grounding firewall enforces a minimum cosine threshold of 0.35.
    
    ## Section 4: Security and Multi-Tenant Isolation
    All sessions are partitioned with X-Session-ID tokens.
    Rate limiting is enforced with a sliding-window token bucket algorithm.
    """

    session_id = "benchmark-session"
    pipeline.index_document(sample_doc.encode("utf-8"), filename="Project_Orion_Spec.md", session_id=session_id)

    session = pipeline.get_session(session_id)
    print(f"✅ Indexed {len(session.chunks)} chunks for evaluation.")

    # Define test queries with Ground Truth target chunk indices
    test_suite = [
        {
            "query": "What is the total Phase 1 budget?",
            "target_keywords": ["$4.85 Million", "budget"],
        },
        {
            "query": "How are vector embeddings generated and indexed in FAISS?",
            "target_keywords": ["384-dimensional", "IndexFlatIP", "FAISS"],
        },
        {
            "query": "What security mechanisms handle multi-tenant isolation?",
            "target_keywords": ["X-Session-ID", "token bucket", "rate limiting"],
        },
        {
            "query": "What is the core latency target of Project Orion?",
            "target_keywords": ["sub-5ms", "real-time anomaly detection"],
        }
    ]

    evaluator = IREvaluator()
    p1_scores, p3_scores, r3_scores, mrr_scores, ndcg_scores = [], [], [], [], []

    for test in test_suite:
        q = test["query"]
        # Determine ground truth chunk ids containing target keywords
        gt_ids = set()
        for c in session.chunks:
            if any(kw.lower() in c.text.lower() for kw in test["target_keywords"]):
                gt_ids.add(c.chunk_id)

        t0 = time.perf_counter()
        results = pipeline.retrieve(q, top_k=3, session_id=session_id)
        latency_ms = (time.perf_counter() - t0) * 1000.0

        retrieved_ids = [c.chunk_id for c, _ in results]

        p1 = evaluator.precision_at_k(retrieved_ids, gt_ids, k=1)
        p3 = evaluator.precision_at_k(retrieved_ids, gt_ids, k=3)
        r3 = evaluator.recall_at_k(retrieved_ids, gt_ids, k=3)
        mrr = evaluator.mrr(retrieved_ids, gt_ids)
        ndcg = evaluator.ndcg_at_k(retrieved_ids, gt_ids, k=3)

        p1_scores.append(p1)
        p3_scores.append(p3)
        r3_scores.append(r3)
        mrr_scores.append(mrr)
        ndcg_scores.append(ndcg)

        print(f"\nQuery: '{q}'")
        print(f"  Latency: {latency_ms:.2f}ms | Top Cosine: {results[0][1]:.3f}")
        print(f"  P@1: {p1:.2f} | P@3: {p3:.2f} | R@3: {r3:.2f} | MRR: {mrr:.2f} | NDCG@3: {ndcg:.2f}")

    print("\n---------------------------------------------------------------")
    print("📊 Aggregate Information Retrieval Benchmark Metrics:")
    print(f"  • Mean Precision@1 (P@1):  {sum(p1_scores)/len(p1_scores)*100:.1f}%")
    print(f"  • Mean Precision@3 (P@3):  {sum(p3_scores)/len(p3_scores)*100:.1f}%")
    print(f"  • Mean Recall@3 (R@3):     {sum(r3_scores)/len(r3_scores)*100:.1f}%")
    print(f"  • Mean Reciprocal Rank:    {sum(mrr_scores)/len(mrr_scores):.3f}")
    print(f"  • Mean NDCG@3:             {sum(ndcg_scores)/len(ndcg_scores):.3f}")
    print("===============================================================")


if __name__ == "__main__":
    run_benchmark()
