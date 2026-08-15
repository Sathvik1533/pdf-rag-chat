"""
Application Configuration Settings.
Loads settings from environment variables and .env file.
"""

import os
from pydantic import BaseModel
from dotenv import load_dotenv

# Load local environment variables from .env if present
load_dotenv()


class Settings(BaseModel):
    APP_NAME: str = "PDF RAG Assistant"
    APP_VERSION: str = "1.0.0"
    
    # Embedding & Text Processing Settings
    EMBEDDING_MODEL: str = os.getenv("EMBEDDING_MODEL", "all-MiniLM-L6-v2")
    CHUNK_SIZE: int = int(os.getenv("CHUNK_SIZE", "500"))
    CHUNK_OVERLAP: int = int(os.getenv("CHUNK_OVERLAP", "50"))
    TOP_K: int = int(os.getenv("TOP_K", "4"))
    
    # Grounding Threshold Floor
    # Any query with max cosine similarity below this value will be refused in code
    GROUNDING_THRESHOLD: float = float(os.getenv("GROUNDING_THRESHOLD", "0.35"))
    
    # LLM Settings
    GROQ_API_KEY: str = os.getenv("GROQ_API_KEY", "")
    GROQ_MODEL: str = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")


settings = Settings()
