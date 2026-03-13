// API layer — connects to the RAG LaunchPad Orchestrator backend.
const BASE_URL = "http://127.0.0.1:8000";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface RAGConfig {
  model: string;
  chunkingStrategy: string;
  chunkSize: number;
  chunkOverlap: number;
  embeddingModel: string;
  dataFolderPath: string;
}

export type StepStatus = "pending" | "in_progress" | "completed" | "error";

export interface PipelineStep {
  id: string;
  label: string;
  status: StepStatus;
  message?: string;
}

export interface PipelineStatus {
  steps: PipelineStep[];
  currentStepIndex: number;
  chatUrl?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Ollama model registry
// A curated list of popular pullable models with all their variants.
// Shown in the frontend model selector even before they're installed.
// ---------------------------------------------------------------------------

export interface OllamaModelEntry {
  name: string;      // e.g. "llama3.2"
  tag: string;       // e.g. "llama3.2:3b"  (the pullable identifier)
  family: string;    // e.g. "Llama"
  size: string;      // e.g. "3B"
  description: string;
  installed?: boolean;
}

export const OLLAMA_REGISTRY: OllamaModelEntry[] = [
  // ── Llama ────────────────────────────────────────────────────────────────
  { name:"llama3.2", tag:"llama3.2:1b",   family:"Llama",      size:"1B",   description:"Meta Llama 3.2 — ultra-lightweight" },
  { name:"llama3.2", tag:"llama3.2:3b",   family:"Llama",      size:"3B",   description:"Meta Llama 3.2 — fast & capable" },
  { name:"llama3.1", tag:"llama3.1:8b",   family:"Llama",      size:"8B",   description:"Meta Llama 3.1 — strong general model" },
  { name:"llama3.1", tag:"llama3.1:70b",  family:"Llama",      size:"70B",  description:"Meta Llama 3.1 — high accuracy" },
  // ── Mistral ──────────────────────────────────────────────────────────────
  { name:"mistral",  tag:"mistral:7b",    family:"Mistral",    size:"7B",   description:"Mistral 7B v0.3 — fast instruction model" },
  { name:"mistral-nemo", tag:"mistral-nemo:12b", family:"Mistral", size:"12B", description:"Mistral Nemo — 128k context window" },
  // ── Qwen ─────────────────────────────────────────────────────────────────
  { name:"qwen2.5",  tag:"qwen2.5:0.5b",  family:"Qwen",      size:"0.5B", description:"Qwen 2.5 — smallest, on-device" },
  { name:"qwen2.5",  tag:"qwen2.5:1.5b",  family:"Qwen",      size:"1.5B", description:"Qwen 2.5 — very lightweight" },
  { name:"qwen2.5",  tag:"qwen2.5:3b",    family:"Qwen",      size:"3B",   description:"Qwen 2.5 — balanced" },
  { name:"qwen2.5",  tag:"qwen2.5:7b",    family:"Qwen",      size:"7B",   description:"Qwen 2.5 — strong multilingual" },
  { name:"qwen2.5",  tag:"qwen2.5:14b",   family:"Qwen",      size:"14B",  description:"Qwen 2.5 — high accuracy" },
  { name:"qwen2.5",  tag:"qwen2.5:32b",   family:"Qwen",      size:"32B",  description:"Qwen 2.5 — near-frontier" },
  { name:"qwen2.5",  tag:"qwen2.5:72b",   family:"Qwen",      size:"72B",  description:"Qwen 2.5 — top of family" },
  // ── Gemma ────────────────────────────────────────────────────────────────
  { name:"gemma3",   tag:"gemma3:1b",     family:"Gemma",      size:"1B",   description:"Google Gemma 3 — tiny, fast" },
  { name:"gemma3",   tag:"gemma3:4b",     family:"Gemma",      size:"4B",   description:"Google Gemma 3 — efficient" },
  { name:"gemma3",   tag:"gemma3:12b",    family:"Gemma",      size:"12B",  description:"Google Gemma 3 — balanced" },
  { name:"gemma3",   tag:"gemma3:27b",    family:"Gemma",      size:"27B",  description:"Google Gemma 3 — powerful" },
  // ── Phi ──────────────────────────────────────────────────────────────────
  { name:"phi4",     tag:"phi4:14b",      family:"Phi",        size:"14B",  description:"Microsoft Phi-4 — state-of-the-art small model" },
  { name:"phi3.5",   tag:"phi3.5:3.8b",   family:"Phi",        size:"3.8B", description:"Microsoft Phi-3.5 Mini — fast reasoning" },
  { name:"phi3",     tag:"phi3:3.8b",     family:"Phi",        size:"3.8B", description:"Microsoft Phi-3 Mini" },
  { name:"phi3",     tag:"phi3:14b",      family:"Phi",        size:"14B",  description:"Microsoft Phi-3 Medium" },
  // ── DeepSeek ─────────────────────────────────────────────────────────────
  { name:"deepseek-r1", tag:"deepseek-r1:1.5b", family:"DeepSeek", size:"1.5B", description:"DeepSeek R1 — reasoning model" },
  { name:"deepseek-r1", tag:"deepseek-r1:7b",   family:"DeepSeek", size:"7B",   description:"DeepSeek R1 — reasoning model" },
  { name:"deepseek-r1", tag:"deepseek-r1:14b",  family:"DeepSeek", size:"14B",  description:"DeepSeek R1 — reasoning model" },
  { name:"deepseek-r1", tag:"deepseek-r1:32b",  family:"DeepSeek", size:"32B",  description:"DeepSeek R1 — reasoning model" },
  { name:"deepseek-r1", tag:"deepseek-r1:70b",  family:"DeepSeek", size:"70B",  description:"DeepSeek R1 — reasoning model" },
  // ── Code ─────────────────────────────────────────────────────────────────
  { name:"codellama", tag:"codellama:7b",  family:"Code",      size:"7B",   description:"Meta CodeLlama — code generation" },
  { name:"codellama", tag:"codellama:13b", family:"Code",      size:"13B",  description:"Meta CodeLlama — code generation" },
  { name:"codegemma", tag:"codegemma:7b",  family:"Code",      size:"7B",   description:"Google CodeGemma — code tasks" },
  // ── Embedding (for reference, not chat) ──────────────────────────────────
  { name:"nomic-embed-text", tag:"nomic-embed-text", family:"Embedding", size:"137M", description:"Nomic text embeddings — use as embedding model" },
  { name:"mxbai-embed-large", tag:"mxbai-embed-large", family:"Embedding", size:"334M", description:"MixedBread large embeddings" },
];

/**
 * Filter the registry by a search string (matches name, family, size, description).
 * Returns all entries if query is empty.
 */
export function searchRegistry(query: string): OllamaModelEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return OLLAMA_REGISTRY;
  return OLLAMA_REGISTRY.filter(
    (m) =>
      m.tag.toLowerCase().includes(q) ||
      m.family.toLowerCase().includes(q) ||
      m.size.toLowerCase().includes(q) ||
      m.description.toLowerCase().includes(q)
  );
}

/**
 * Merge the registry with the locally installed models so each entry knows
 * whether it's already on disk.
 */
export function mergeWithInstalled(
  installedNames: string[]
): OllamaModelEntry[] {
  const installedSet = new Set(installedNames.map((n) => n.toLowerCase()));
  return OLLAMA_REGISTRY.map((m) => ({
    ...m,
    installed:
      installedSet.has(m.tag.toLowerCase()) ||
      installedSet.has(m.name.toLowerCase()),
  }));
}

// ---------------------------------------------------------------------------
// Step definitions — mirrors the backend step names (including pulling_model)
// ---------------------------------------------------------------------------

const STEPS: { id: string; label: string }[] = [
  { id: "pulling_model",     label: "Pulling model" },
  { id: "loading_documents", label: "Loading documents" },
  { id: "chunking",          label: "Chunking" },
  { id: "embedding",         label: "Generating embeddings" },
  { id: "indexing",          label: "Indexing" },
  { id: "launching_chat",    label: "Launching chat server" },
  { id: "ready",             label: "Ready" },
];

const STEP_INDEX: Record<string, number> = Object.fromEntries(
  STEPS.map((s, i) => [s.id, i])
);

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let currentTaskId: string | null = null;
let pollingTimer: ReturnType<typeof setTimeout> | null = null;
let cachedStatus: PipelineStatus | null = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.detail ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

function backendStatusToUI(
  backendStep: string,
  message: string,
  chatUrl: string | null,
  error: string | null,
  progress: number
): PipelineStatus {
  const isError = backendStep === "error";

  const activeIndex = isError
    ? inferStepIndexFromProgress(progress)
    : (STEP_INDEX[backendStep] ?? 0);

  const steps: PipelineStep[] = STEPS.map((s, i) => {
    let status: StepStatus = "pending";
    if (isError) {
      if (i < activeIndex) status = "completed";
      else if (i === activeIndex) status = "error";
    } else if (i < activeIndex) {
      status = "completed";
    } else if (i === activeIndex) {
      status = backendStep === "ready" ? "completed" : "in_progress";
    }

    return {
      id: s.id,
      label: s.label,
      status,
      message: i === activeIndex ? message : undefined,
    };
  });

  return {
    steps,
    currentStepIndex: activeIndex,
    chatUrl: chatUrl ?? undefined,
    error: error ?? undefined,
  };
}

function inferStepIndexFromProgress(progress: number): number {
  if (progress >= 90) return STEP_INDEX["launching_chat"] ?? 5;
  if (progress >= 80) return STEP_INDEX["indexing"] ?? 4;
  if (progress >= 60) return STEP_INDEX["embedding"] ?? 3;
  if (progress >= 30) return STEP_INDEX["chunking"] ?? 2;
  if (progress >= 10) return STEP_INDEX["loading_documents"] ?? 1;
  return STEP_INDEX["pulling_model"] ?? 0;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns installed Ollama models from the backend, merged with the full
 * registry so the frontend can show all pullable options.
 */
export async function getAvailableModels(): Promise<OllamaModelEntry[]> {
  try {
    const data = await apiFetch<{ models: { name: string }[] }>("/models");
    const installedNames = data.models.map((m) => m.name);
    return mergeWithInstalled(installedNames);
  } catch {
    // If Ollama is unreachable just return the registry with nothing installed
    return mergeWithInstalled([]);
  }
}

/**
 * Pull a model from the Ollama registry via the backend.
 * Blocks until the pull is complete (can take minutes for large models).
 */
export async function pullModel(tag: string): Promise<void> {
  await apiFetch("/models/pull", {
    method: "POST",
    body: JSON.stringify({ model: tag }),
  });
}

/** Sends config to the backend, starts the pipeline, begins polling. */
export async function launchPipeline(
  config: RAGConfig
): Promise<{ sessionId: string }> {
  const payload = {
    model: config.model,
    chunk_strategy: config.chunkingStrategy,
    chunk_size: config.chunkSize,
    chunk_overlap: config.chunkOverlap,
    embedding_model: config.embeddingModel,
    data_folder: config.dataFolderPath,
  };

  const data = await apiFetch<{ task_id: string }>("/start", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  currentTaskId = data.task_id;
  cachedStatus = null;
  _schedulePoll();

  return { sessionId: data.task_id };
}

/** Returns the latest pipeline status (null if no pipeline has been started). */
export async function getPipelineStatus(): Promise<PipelineStatus | null> {
  if (!currentTaskId) return null;

  try {
    const raw = await apiFetch<{
      step: string;
      message: string;
      progress: number;
      url: string | null;
      error: string | null;
    }>(`/status/${currentTaskId}`);

    cachedStatus = backendStatusToUI(raw.step, raw.message, raw.url, raw.error, raw.progress);
    return { ...cachedStatus, steps: cachedStatus.steps.map((s) => ({ ...s })) };
  } catch {
    return cachedStatus ? { ...cachedStatus } : null;
  }
}

/** Stops polling and clears all state. */
export function resetPipeline(): void {
  if (pollingTimer) clearTimeout(pollingTimer);
  pollingTimer = null;
  currentTaskId = null;
  cachedStatus = null;
}

// ---------------------------------------------------------------------------
// Internal polling loop
// ---------------------------------------------------------------------------

function _schedulePoll(): void {
  if (pollingTimer) clearTimeout(pollingTimer);

  pollingTimer = setTimeout(async () => {
    if (!currentTaskId) return;

    try {
      const raw = await apiFetch<{
        step: string;
        message: string;
        progress: number;
        url: string | null;
        error: string | null;
      }>(`/status/${currentTaskId}`);

      cachedStatus = backendStatusToUI(raw.step, raw.message, raw.url, raw.error, raw.progress);

      if (raw.step !== "ready" && raw.step !== "error") {
        _schedulePoll();
      } else if (raw.step === "error") {
        console.error("[RAG] Pipeline failed:", raw.error);
      }
    } catch {
      _schedulePoll(); // network hiccup — retry
    }
  }, 1500);
}

// ---------------------------------------------------------------------------
// Project history (localStorage)
// ---------------------------------------------------------------------------

export interface SavedProject {
  id: string;
  name: string;
  config: RAGConfig;
  createdAt: string;
}

export function getSavedProjects(): SavedProject[] {
  try {
    return JSON.parse(localStorage.getItem("rag-projects") ?? "[]");
  } catch {
    return [];
  }
}

export function saveProject(name: string, config: RAGConfig): SavedProject {
  const projects = getSavedProjects();
  const project: SavedProject = {
    id: "proj-" + Date.now(),
    name,
    config,
    createdAt: new Date().toISOString(),
  };
  projects.unshift(project);
  localStorage.setItem("rag-projects", JSON.stringify(projects));
  return project;
}

export function deleteProject(id: string): void {
  const updated = getSavedProjects().filter((p) => p.id !== id);
  localStorage.setItem("rag-projects", JSON.stringify(updated));
}
