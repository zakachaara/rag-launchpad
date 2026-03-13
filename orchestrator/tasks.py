"""
tasks.py – Background pipeline that runs all RAG steps for a given task_id.
"""

import os
import sys
import subprocess
import asyncio
import time
from typing import Dict, Any

from logger import get_logger
from config import PipelineConfig, TaskStatus
from document_loaders import load_documents_from_folder, Document
from utils import derive_port, write_config, is_model_installed, pull_ollama_model

log = get_logger("tasks")

# In-memory task store: task_id -> dict matching TaskStatus fields
task_store: Dict[str, Dict[str, Any]] = {}


# ---------------------------------------------------------------------------
# Status helpers
# ---------------------------------------------------------------------------

def _update(task_id: str, step: str, message: str, progress: int,
            url: str | None = None, error: str | None = None) -> None:
    task_store[task_id] = {
        "step": step,
        "message": message,
        "progress": progress,
        "url": url,
        "error": error,
    }
    log.info("[%s] %-20s  %3d%%  %s", task_id[:8], step, progress, message)


# ---------------------------------------------------------------------------
# Chunking
# ---------------------------------------------------------------------------

def _chunk_documents(docs: list, config: PipelineConfig) -> list:
    """Return a list of LangChain-compatible chunk objects with page_content."""
    try:
        from langchain_text_splitters import CharacterTextSplitter, RecursiveCharacterTextSplitter
    except ImportError:
        from langchain.text_splitter import CharacterTextSplitter, RecursiveCharacterTextSplitter  # type: ignore

    log.debug(
        "Chunking %d doc(s) — strategy=%s  size=%d  overlap=%d",
        len(docs), config.chunk_strategy, config.chunk_size, config.chunk_overlap,
    )

    class _LC:
        def __init__(self, doc: Document):
            self.page_content = doc.page_content
            self.metadata = doc.metadata

    lc_docs = [_LC(d) for d in docs]

    if config.chunk_strategy == "fixed":
        log.debug("Using CharacterTextSplitter (fixed)")
        splitter = CharacterTextSplitter(
            separator="\n\n",
            chunk_size=config.chunk_size,
            chunk_overlap=config.chunk_overlap,
        )
    else:
        log.debug("Using RecursiveCharacterTextSplitter (%s)", config.chunk_strategy)
        splitter = RecursiveCharacterTextSplitter(
            chunk_size=config.chunk_size,
            chunk_overlap=config.chunk_overlap,
        )

    chunks = splitter.split_documents(lc_docs)  # type: ignore[arg-type]
    log.info("Chunking produced %d chunk(s) from %d doc(s)", len(chunks), len(docs))
    return chunks


# ---------------------------------------------------------------------------
# Embeddings
# ---------------------------------------------------------------------------

_OLLAMA_EMBEDDING_MODELS = {
    "nomic-embed-text",
    "mxbai-embed-large",
    "all-minilm",
}


def _get_embeddings(embedding_model: str):
    model_lower = embedding_model.lower()
    use_ollama = any(m in model_lower for m in _OLLAMA_EMBEDDING_MODELS)

    if use_ollama:
        log.info("Loading Ollama embeddings — model=%s", embedding_model)
        from langchain_community.embeddings import OllamaEmbeddings  # type: ignore
        return OllamaEmbeddings(model=embedding_model)
    else:
        log.info("Loading HuggingFace embeddings — model=%s", embedding_model)
        from langchain_community.embeddings import HuggingFaceEmbeddings  # type: ignore
        return HuggingFaceEmbeddings(model_name=embedding_model)


# ---------------------------------------------------------------------------
# Chat server launch + health poll
# ---------------------------------------------------------------------------

def _launch_chat_server(task_id: str, config_path: str, port: int) -> subprocess.Popen:
    log.info("Launching chat server — port=%d  config=%s", port, config_path)
    env = os.environ.copy()
    env["CONFIG_PATH"] = config_path
    process = subprocess.Popen(
        [
            sys.executable, "-m", "uvicorn", "chat_server:app",
            "--host", "127.0.0.1",
            "--port", str(port),
        ],
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    log.debug("Chat server process started — pid=%d", process.pid)
    return process


async def _wait_for_server(port: int, timeout: int = 30) -> bool:
    import httpx

    url = f"http://127.0.0.1:{port}/health"
    log.debug("Polling chat server health at %s (timeout=%ds)", url, timeout)
    deadline = time.monotonic() + timeout
    attempt = 0
    async with httpx.AsyncClient() as client:
        while time.monotonic() < deadline:
            attempt += 1
            try:
                r = await client.get(url, timeout=2.0)
                if r.status_code == 200:
                    log.info("Chat server is healthy after %d attempt(s)", attempt)
                    return True
            except Exception as exc:
                log.debug("Health check attempt %d failed: %s", attempt, exc)
            await asyncio.sleep(1)

    log.error("Chat server did not respond within %ds (%d attempts)", timeout, attempt)
    return False


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------

async def run_pipeline(task_id: str, config: PipelineConfig) -> None:
    log.info("=== Pipeline START  task_id=%s ===", task_id)
    t_start = time.monotonic()

    try:
        # ---- Step 0: Pull model if not installed ---------------------------
        _update(task_id, "pulling_model", f"Checking model '{config.model}'...", 5)
        if not is_model_installed(config.model):
            log.info("Model '%s' not found locally — pulling now", config.model)
            _update(task_id, "pulling_model", f"Pulling '{config.model}' from Ollama registry...", 5)
            success = pull_ollama_model(config.model)
            if not success:
                raise RuntimeError(
                    f"Could not pull model '{config.model}'. "
                    "Make sure Ollama is running and the model name is correct."
                )
            log.info("Model '%s' is ready", config.model)
        else:
            log.info("Model '%s' is already installed — skipping pull", config.model)

        # ---- Step 1: Load documents ----------------------------------------
        _update(task_id, "loading_documents", "Loading files...", 10)
        t0 = time.monotonic()
        docs = load_documents_from_folder(config.data_folder)
        log.info(
            "Loaded %d document(s) from '%s' in %.2fs",
            len(docs), config.data_folder, time.monotonic() - t0,
        )
        if not docs:
            raise ValueError(f"No supported documents found in {config.data_folder}")

        # ---- Step 2: Chunking -----------------------------------------------
        _update(task_id, "chunking", "Splitting text...", 30)
        t0 = time.monotonic()
        chunks = _chunk_documents(docs, config)
        log.info("Chunking finished in %.2fs — %d chunk(s)", time.monotonic() - t0, len(chunks))
        if not chunks:
            raise ValueError("Chunking produced no text chunks.")

        # ---- Step 3: Embeddings ---------------------------------------------
        _update(task_id, "embedding", "Generating embeddings...", 60)
        t0 = time.monotonic()
        embeddings = _get_embeddings(config.embedding_model)
        log.info("Embeddings model ready in %.2fs", time.monotonic() - t0)

        # ---- Step 4: Index into Chroma --------------------------------------
        _update(task_id, "indexing", "Storing vectors...", 80)
        persist_dir = f"./projects/{task_id}/chroma_db"
        os.makedirs(persist_dir, exist_ok=True)
        log.info("Indexing %d chunk(s) into Chroma at '%s'", len(chunks), persist_dir)

        t0 = time.monotonic()
        from langchain_community.vectorstores import Chroma  # type: ignore
        Chroma.from_documents(
            documents=chunks,
            embedding=embeddings,
            persist_directory=persist_dir,
        )
        log.info("Chroma indexing complete in %.2fs", time.monotonic() - t0)

        # ---- Step 5: Launch chat server -------------------------------------
        _update(task_id, "launching_chat", "Starting chat server...", 90)
        port = derive_port(task_id)
        config_path = write_config(task_id, config.model, config.embedding_model, port)
        _launch_chat_server(task_id, config_path, port)

        ready = await _wait_for_server(port, timeout=30)
        if not ready:
            raise TimeoutError(
                f"Chat server did not become ready on port {port} within 30s."
            )

        # ---- Step 6: Ready --------------------------------------------------
        elapsed = time.monotonic() - t_start
        _update(
            task_id,
            "ready",
            "Chat server is running",
            100,
            url=f"http://127.0.0.1:{port}",
        )
        log.info(
            "=== Pipeline COMPLETE  task_id=%s  url=http://127.0.0.1:%d  total=%.2fs ===",
            task_id, port, elapsed,
        )

    except Exception as exc:
        log.error(
            "=== Pipeline FAILED  task_id=%s  error=%s ===",
            task_id, exc, exc_info=True,
        )
        _update(task_id, "error", "An error occurred", 0, error=str(exc))
