"""
logger.py – Centralised logging configuration for RAG LaunchPad.

Every module gets its own named logger (e.g. "rag.tasks", "rag.loaders") so
log lines are easy to filter.  A single call to `setup_logging()` at startup
configures the format and level for the whole application.
"""

import logging
import sys


def setup_logging(level: int = logging.DEBUG) -> None:
    """Call once at application startup (main.py / chat_server.py)."""
    fmt = (
        "%(asctime)s  %(levelname)-8s  %(name)-22s  %(message)s"
    )
    logging.basicConfig(
        level=level,
        format=fmt,
        datefmt="%H:%M:%S",
        handlers=[logging.StreamHandler(sys.stdout)],
        force=True,
    )
    # Quiet down noisy third-party loggers
    for noisy in ("httpx", "httpcore", "chromadb", "uvicorn.access"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def get_logger(name: str) -> logging.Logger:
    """Return a logger namespaced under 'rag.*'."""
    return logging.getLogger(f"rag.{name}")
