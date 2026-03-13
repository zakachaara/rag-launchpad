from pydantic import BaseModel, Field
from typing import Optional, Literal


class PipelineConfig(BaseModel):
    model: str = Field(..., description="Ollama model name for chat")
    chunk_strategy: Literal["fixed", "recursive", "semantic"] = "recursive"
    chunk_size: int = Field(500, gt=0)
    chunk_overlap: int = Field(50, ge=0)
    embedding_model: str = "nomic-embed-text"
    data_folder: str = Field(..., description="Absolute path to documents folder")


class TaskStatus(BaseModel):
    step: str
    message: str
    progress: int = 0
    url: Optional[str] = None
    error: Optional[str] = None
