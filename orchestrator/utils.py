import subprocess
import json
from typing import List, Dict

from logger import get_logger

log = get_logger("utils")


def get_ollama_models() -> List[Dict]:
    """
    Call `ollama list` and return a list of dicts with name + installed=True.
    These are models already present on the local machine.
    """
    log.debug("Running `ollama list`")
    try:
        result = subprocess.run(
            ["ollama", "list"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        lines = result.stdout.strip().splitlines()
        models = []
        for line in lines[1:]:  # skip header row
            parts = line.split()
            if parts:
                name = parts[0]
                size = parts[2] + " " + parts[3] if len(parts) > 3 else ""
                models.append({"name": name, "size": size, "installed": True})
        log.info("ollama list returned %d installed model(s)", len(models))
        return models
    except FileNotFoundError:
        log.warning("ollama binary not found — returning empty model list")
        return []
    except subprocess.TimeoutExpired:
        log.warning("ollama list timed out — returning empty model list")
        return []
    except Exception as exc:
        log.error("Unexpected error calling ollama list: %s", exc)
        return []


def pull_ollama_model(model: str) -> bool:
    """
    Pull a model via `ollama pull <model>`. Blocks until complete.
    Returns True on success, False on failure.
    """
    log.info("Pulling model '%s' via ollama pull...", model)
    try:
        result = subprocess.run(
            ["ollama", "pull", model],
            capture_output=True,
            text=True,
            timeout=600,  # 10 min — large models take time
        )
        if result.returncode == 0:
            log.info("Model '%s' pulled successfully", model)
            return True
        else:
            log.error("ollama pull failed for '%s': %s", model, result.stderr.strip())
            return False
    except FileNotFoundError:
        log.error("ollama binary not found — cannot pull model")
        return False
    except subprocess.TimeoutExpired:
        log.error("ollama pull timed out for model '%s'", model)
        return False
    except Exception as exc:
        log.error("Unexpected error pulling model '%s': %s", model, exc)
        return False


def is_model_installed(model: str) -> bool:
    """Check whether a model is already present locally."""
    installed = {m["name"] for m in get_ollama_models()}
    # also check base name without tag
    base = model.split(":")[0]
    result = model in installed or any(n.startswith(base + ":") or n == base for n in installed)
    log.debug("is_model_installed('%s') -> %s  (installed=%s)", model, result, installed)
    return result


def derive_port(task_id: str) -> int:
    """Derive a unique port from a task_id."""
    port = 8001 + (hash(task_id) % 1000)
    log.debug("Derived port %d for task_id=%s", port, task_id[:8])
    return port


def write_config(task_id: str, model: str, embedding_model: str, port: int) -> str:
    """Write config.json for the chat server and return the path."""
    import os

    task_dir = f"./projects/{task_id}"
    os.makedirs(task_dir, exist_ok=True)
    config = {
        "model": model,
        "embedding_model": embedding_model,
        "vector_store_path": f"./projects/{task_id}/chroma_db",
        "port": port,
    }
    config_path = f"{task_dir}/config.json"
    with open(config_path, "w") as f:
        json.dump(config, f, indent=2)
    log.info("Config written to '%s'  model=%s  embedding=%s  port=%d",
             config_path, model, embedding_model, port)
    return config_path
