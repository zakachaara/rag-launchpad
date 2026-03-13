"""
main.py – Orchestrator API for RAG LaunchPad.

Run with:
    uvicorn main:app --reload --port 8000
"""

import uuid
import asyncio
from typing import Any, Dict

from fastapi import FastAPI, BackgroundTasks, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from logger import setup_logging, get_logger
from config import PipelineConfig, TaskStatus
from tasks import run_pipeline, task_store
from utils import get_ollama_models, pull_ollama_model

setup_logging()
log = get_logger("main")

app = FastAPI(
    title="RAG LaunchPad – Orchestrator API",
    version="1.0.0",
    description="Configures and launches a local RAG pipeline in one click.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def _on_startup():
    log.info("Orchestrator API started and ready to accept requests")


# ---------------------------------------------------------------------------
# GET /health
# ---------------------------------------------------------------------------

@app.get("/health", summary="Health check")
def health():
    log.debug("Health check requested")
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# GET /models  — returns locally installed models
# ---------------------------------------------------------------------------

@app.get("/models", summary="List installed Ollama models")
def list_models():
    log.info("Fetching installed Ollama models")
    models = get_ollama_models()
    log.info("Found %d installed model(s)", len(models))
    return {"models": models}


# ---------------------------------------------------------------------------
# POST /models/pull  — pull a model by name
# ---------------------------------------------------------------------------

class PullRequest(BaseModel):
    model: str


@app.post("/models/pull", summary="Pull an Ollama model from the registry")
def pull_model(req: PullRequest):
    log.info("Pull request received for model='%s'", req.model)
    success = pull_ollama_model(req.model)
    if not success:
        log.error("Failed to pull model '%s'", req.model)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to pull model '{req.model}'. Check that Ollama is running and the model name is valid.",
        )
    log.info("Model '%s' is now available", req.model)
    return {"status": "ok", "model": req.model}


# ---------------------------------------------------------------------------
# POST /start
# ---------------------------------------------------------------------------

class StartResponse(BaseModel):
    task_id: str


@app.post("/start", response_model=StartResponse, summary="Start a new RAG pipeline")
async def start_pipeline(config: PipelineConfig, background_tasks: BackgroundTasks):
    task_id = str(uuid.uuid4())
    log.info(
        "New pipeline request  task_id=%s  model=%s  strategy=%s  "
        "chunk_size=%d  overlap=%d  embedding=%s  folder=%s",
        task_id,
        config.model,
        config.chunk_strategy,
        config.chunk_size,
        config.chunk_overlap,
        config.embedding_model,
        config.data_folder,
    )

    task_store[task_id] = {
        "step": "queued",
        "message": "Pipeline queued",
        "progress": 0,
        "url": None,
        "error": None,
    }

    background_tasks.add_task(_run_async_pipeline, task_id, config)
    log.debug("Background task scheduled for task_id=%s", task_id)

    return StartResponse(task_id=task_id)


def _run_async_pipeline(task_id: str, config: PipelineConfig) -> None:
    asyncio.run(run_pipeline(task_id, config))


# ---------------------------------------------------------------------------
# GET /status/{task_id}
# ---------------------------------------------------------------------------

@app.get(
    "/status/{task_id}",
    response_model=TaskStatus,
    summary="Poll the status of a pipeline task",
)
def get_status(task_id: str):
    status: Dict[str, Any] | None = task_store.get(task_id)
    if status is None:
        log.warning("Status requested for unknown task_id=%s", task_id)
        raise HTTPException(status_code=404, detail=f"Task '{task_id}' not found.")

    log.debug(
        "Status poll  task_id=%s  step=%s  progress=%s%%",
        task_id,
        status["step"],
        status["progress"],
    )
    return TaskStatus(**status)
