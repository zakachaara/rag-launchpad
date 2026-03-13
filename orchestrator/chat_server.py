"""
chat_server.py – Standalone Chat Server for RAG LaunchPad.

Reads CONFIG_PATH env variable (set by the orchestrator) and loads:
  - The persisted Chroma vector store
  - The specified Ollama chat model

Run standalone (for testing):
    CONFIG_PATH=./projects/<task_id>/config.json \\
      uvicorn chat_server:app --host 127.0.0.1 --port 8001
"""

import os
import json
import time

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from logger import setup_logging, get_logger

setup_logging()
log = get_logger("chat_server")

# ---------------------------------------------------------------------------
# Load config
# ---------------------------------------------------------------------------

_CONFIG_PATH = os.environ.get("CONFIG_PATH", "config.json")
log.info("Loading chat server config from '%s'", _CONFIG_PATH)

try:
    with open(_CONFIG_PATH) as f:
        _cfg = json.load(f)
    log.info(
        "Config loaded — model=%s  embedding=%s  store=%s  port=%s",
        _cfg.get("model"), _cfg.get("embedding_model"),
        _cfg.get("vector_store_path"), _cfg.get("port"),
    )
except FileNotFoundError:
    log.critical("Config file not found at '%s'. Set CONFIG_PATH env var.", _CONFIG_PATH)
    raise RuntimeError(
        f"Chat server config not found at {_CONFIG_PATH}. "
        "Set the CONFIG_PATH environment variable."
    )

_MODEL: str = _cfg["model"]
_EMBEDDING_MODEL: str = _cfg["embedding_model"]
_VECTOR_STORE_PATH: str = _cfg["vector_store_path"]

# ---------------------------------------------------------------------------
# Load embeddings + vector store
# ---------------------------------------------------------------------------

_OLLAMA_EMBEDDING_MODELS = {
    "nomic-embed-text",
    "mxbai-embed-large",
    "all-minilm",
}


def _load_embeddings(embedding_model: str):
    model_lower = embedding_model.lower()
    use_ollama = any(m in model_lower for m in _OLLAMA_EMBEDDING_MODELS)
    if use_ollama:
        log.info("Initialising Ollama embeddings — model=%s", embedding_model)
        from langchain_community.embeddings import OllamaEmbeddings  # type: ignore
        return OllamaEmbeddings(model=embedding_model)
    else:
        log.info("Initialising HuggingFace embeddings — model=%s", embedding_model)
        from langchain_community.embeddings import HuggingFaceEmbeddings  # type: ignore
        return HuggingFaceEmbeddings(model_name=embedding_model)


log.info("Loading embedding model...")
t0 = time.monotonic()
_embeddings = _load_embeddings(_EMBEDDING_MODEL)
log.info("Embeddings ready in %.2fs", time.monotonic() - t0)

log.info("Loading Chroma vector store from '%s'...", _VECTOR_STORE_PATH)
t0 = time.monotonic()
from langchain_community.vectorstores import Chroma  # type: ignore
_vector_store = Chroma(
    persist_directory=_VECTOR_STORE_PATH,
    embedding_function=_embeddings,
)
log.info("Vector store loaded in %.2fs", time.monotonic() - t0)

_READY = True

# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(title="RAG LaunchPad – Chat Server")


@app.on_event("startup")
async def _on_startup():
    log.info("Chat server ready — model=%s  store=%s", _MODEL, _VECTOR_STORE_PATH)


# GET /health ----------------------------------------------------------------

@app.get("/health")
def health():
    if not _READY:
        log.warning("Health check called but server not ready")
        raise HTTPException(status_code=503, detail="Server not ready")
    log.debug("Health check OK")
    return {"status": "ok"}


# POST /chat -----------------------------------------------------------------

class ChatRequest(BaseModel):
    query: str
    stream: bool = False


_PROMPT_TEMPLATE = """\
You are a knowledgeable assistant helping a user understand a document collection.
The following excerpts have been retrieved from those documents to help you answer.

Use the excerpts as your primary source. Synthesize across all of them to give a
complete, fluent answer. If a question is broad (e.g. "what are these documents about?"),
summarise the key themes you can infer from the excerpts rather than refusing to answer.
Only say you don't know if the excerpts contain truly no relevant information at all.

Retrieved excerpts:
{context}

User question: {question}

Answer:"""


def _build_prompt(context_docs: list, question: str) -> str:
    # Include source filename so the model can reference where info came from
    parts = []
    for i, doc in enumerate(context_docs, 1):
        source = doc.metadata.get("source", "unknown")
        filename = source.split("/")[-1]
        parts.append(f"[Excerpt {i} — {filename}]\n{doc.page_content}")
    context = "\n\n---\n\n".join(parts)
    return _PROMPT_TEMPLATE.format(context=context, question=question)


@app.post("/chat")
def chat(request: ChatRequest):
    log.info("Chat request — query='%.80s'  stream=%s", request.query, request.stream)
    t_start = time.monotonic()

    # k=8 gives broader coverage for summary questions while staying within context limits
    log.debug("Running similarity search (k=8)")
    t0 = time.monotonic()
    relevant_docs = _vector_store.similarity_search(request.query, k=8)
    log.info(
        "Retrieved %d chunk(s) in %.2fs — sources: %s",
        len(relevant_docs),
        time.monotonic() - t0,
        [d.metadata.get("source", "?") for d in relevant_docs],
    )

    prompt = _build_prompt(relevant_docs, request.query)
    log.debug("Prompt length: %d chars", len(prompt))

    try:
        import ollama  # type: ignore

        if request.stream:
            log.info("Starting streaming response — model=%s", _MODEL)
            def generate():
                for chunk in ollama.chat(
                    model=_MODEL,
                    messages=[{"role": "user", "content": prompt}],
                    stream=True,
                ):
                    yield chunk["message"]["content"]
            return StreamingResponse(generate(), media_type="text/plain")

        log.debug("Calling ollama.chat — model=%s", _MODEL)
        t0 = time.monotonic()
        response = ollama.chat(
            model=_MODEL,
            messages=[{"role": "user", "content": prompt}],
        )
        answer = response["message"]["content"]
        log.info(
            "Ollama responded in %.2fs — answer length=%d chars  total=%.2fs",
            time.monotonic() - t0, len(answer), time.monotonic() - t_start,
        )
        return {"answer": answer}

    except Exception as exc:
        log.error("Ollama call failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc))


# GET / – simple HTML chat UI -----------------------------------------------

_HTML_UI = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>RAG LaunchPad – Chat</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --crimson:      #c30434;
      --crimson-dim:  #8f0325;
      --crimson-glow: rgba(195, 4, 52, 0.18);
      --crimson-mist: rgba(195, 4, 52, 0.07);
      --bg:           #0e0b0c;
      --surface:      #160d0f;
      --surface2:     #1e1114;
      --border:       rgba(195, 4, 52, 0.18);
      --border-soft:  rgba(255,255,255,0.06);
      --text:         #f0e8e9;
      --text-dim:     #9e8e90;
      --user-bg:      #c30434;
      --user-text:    #fff;
      --bot-bg:       #1e1114;
      --bot-border:   rgba(195, 4, 52, 0.22);
    }

    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Syne', sans-serif;
      background: var(--bg);
      color: var(--text);
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
    }

    /* subtle grid texture */
    body::before {
      content: '';
      position: fixed;
      inset: 0;
      background-image:
        linear-gradient(rgba(195,4,52,.03) 1px, transparent 1px),
        linear-gradient(90deg, rgba(195,4,52,.03) 1px, transparent 1px);
      background-size: 40px 40px;
      pointer-events: none;
      z-index: 0;
    }

    /* ── Header ─────────────────────────────────────────────── */
    header {
      position: relative;
      z-index: 10;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: .9rem 1.75rem;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      box-shadow: 0 1px 24px rgba(195,4,52,.08);
    }

    .header-left { display: flex; align-items: center; gap: .85rem; }

    .logo-mark {
      width: 34px; height: 34px;
      border-radius: 8px;
      background: var(--crimson);
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 0 16px rgba(195,4,52,.55);
      flex-shrink: 0;
    }
    .logo-mark svg { width: 18px; height: 18px; fill: #fff; }

    header h1 {
      font-size: 1.05rem;
      font-weight: 700;
      letter-spacing: .01em;
      color: var(--text);
    }

    .header-badge {
      font-family: 'JetBrains Mono', monospace;
      font-size: .68rem;
      padding: .2rem .55rem;
      border-radius: 999px;
      background: var(--crimson-mist);
      border: 1px solid var(--border);
      color: var(--crimson);
      letter-spacing: .04em;
    }

    /* ── Messages ───────────────────────────────────────────── */
    #messages {
      position: relative;
      z-index: 1;
      flex: 1;
      overflow-y: auto;
      padding: 1.75rem 1.5rem;
      display: flex;
      flex-direction: column;
      gap: 1.1rem;
      scroll-behavior: smooth;
    }

    #messages::-webkit-scrollbar { width: 4px; }
    #messages::-webkit-scrollbar-track { background: transparent; }
    #messages::-webkit-scrollbar-thumb { background: var(--border); border-radius: 99px; }

    /* row wrappers for alignment */
    .row { display: flex; gap: .65rem; align-items: flex-end; }
    .row.user-row { flex-direction: row-reverse; }

    /* avatar circles */
    .avatar {
      width: 28px; height: 28px; border-radius: 50%;
      flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
      font-size: .65rem; font-weight: 700; letter-spacing: .04em;
    }
    .avatar.bot-av  { background: var(--surface2); border: 1px solid var(--border); color: var(--crimson); }
    .avatar.user-av { background: var(--crimson); color: #fff; box-shadow: 0 0 10px rgba(195,4,52,.4); }

    .msg {
      max-width: 68%;
      padding: .75rem 1.1rem;
      border-radius: 1.1rem;
      line-height: 1.65;
      font-size: .93rem;
      font-family: 'Syne', sans-serif;
      animation: pop .18s ease;
    }

    @keyframes pop {
      from { opacity: 0; transform: translateY(6px) scale(.98); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }

    .msg.user {
      background: var(--crimson);
      color: var(--user-text);
      border-bottom-right-radius: .3rem;
      box-shadow: 0 4px 20px rgba(195,4,52,.3);
    }

    .msg.bot {
      background: var(--bot-bg);
      color: var(--text);
      border: 1px solid var(--bot-border);
      border-bottom-left-radius: .3rem;
      box-shadow: 0 2px 12px rgba(0,0,0,.3);
    }

    /* thinking animation */
    .msg.bot.thinking {
      display: flex;
      align-items: center;
      gap: .35rem;
      padding: .65rem 1rem;
      color: var(--text-dim);
      font-style: normal;
    }
    .dot {
      width: 6px; height: 6px; border-radius: 50%;
      background: var(--crimson);
      animation: bounce 1.2s infinite ease-in-out;
    }
    .dot:nth-child(2) { animation-delay: .2s; }
    .dot:nth-child(3) { animation-delay: .4s; }
    @keyframes bounce {
      0%, 80%, 100% { transform: translateY(0); opacity: .4; }
      40%            { transform: translateY(-5px); opacity: 1; }
    }

    /* empty state */
    #empty {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: .75rem;
      color: var(--text-dim);
      pointer-events: none;
      user-select: none;
    }
    #empty .big-icon {
      width: 52px; height: 52px; border-radius: 14px;
      background: var(--crimson-mist);
      border: 1px solid var(--border);
      display: flex; align-items: center; justify-content: center;
    }
    #empty .big-icon svg { width: 26px; height: 26px; stroke: var(--crimson); fill: none; stroke-width: 1.6; }
    #empty p { font-size: .88rem; }

    /* ── Input area ─────────────────────────────────────────── */
    #form {
      position: relative;
      z-index: 10;
      display: flex;
      align-items: center;
      gap: .65rem;
      padding: .9rem 1.25rem;
      background: var(--surface);
      border-top: 1px solid var(--border);
    }

    #input {
      flex: 1;
      padding: .7rem 1.1rem;
      border-radius: .85rem;
      border: 1px solid var(--border-soft);
      background: var(--surface2);
      color: var(--text);
      font-family: 'Syne', sans-serif;
      font-size: .92rem;
      outline: none;
      transition: border-color .2s, box-shadow .2s;
    }
    #input::placeholder { color: var(--text-dim); }
    #input:focus {
      border-color: var(--crimson);
      box-shadow: 0 0 0 3px var(--crimson-glow);
    }

    #send {
      flex-shrink: 0;
      width: 40px; height: 40px;
      border-radius: .75rem;
      background: var(--crimson);
      border: none;
      cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      transition: background .2s, box-shadow .2s, transform .1s;
      box-shadow: 0 0 14px rgba(195,4,52,.4);
    }
    #send svg { width: 17px; height: 17px; stroke: #fff; fill: none; stroke-width: 2.2; }
    #send:hover { background: var(--crimson-dim); box-shadow: 0 0 20px rgba(195,4,52,.6); }
    #send:active { transform: scale(.93); }
    #send:disabled { opacity: .35; cursor: not-allowed; box-shadow: none; }
  </style>
</head>
<body>
  <header>
    <div class="header-left">
      <div class="logo-mark">
        <!-- document search icon -->
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/>
          <line x1="16" y1="17" x2="8" y2="17"/>
          <polyline points="10 9 9 9 8 9"/>
        </svg>
      </div>
      <h1>RAG LaunchPad</h1>
    </div>
    <span class="header-badge">CHAT</span>
  </header>

  <div id="messages">
    <div id="empty">
      <div class="big-icon">
        <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      </div>
      <p>Ask anything about your documents</p>
    </div>
  </div>

  <div id="form">
    <input id="input" type="text" placeholder="Ask a question…" autocomplete="off" />
    <button id="send" title="Send">
      <svg viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
    </button>
  </div>

  <script>
    const msgsEl  = document.getElementById('messages');
    const emptyEl = document.getElementById('empty');
    const inputEl = document.getElementById('input');
    const sendBtn = document.getElementById('send');

    function removeEmpty() {
      if (emptyEl && emptyEl.parentNode) emptyEl.remove();
    }

    function addUserMessage(text) {
      removeEmpty();
      const row = document.createElement('div');
      row.className = 'row user-row';
      row.innerHTML = `
        <div class="avatar user-av">YOU</div>
        <div class="msg user"></div>`;
      row.querySelector('.msg').textContent = text;
      msgsEl.appendChild(row);
      msgsEl.scrollTop = msgsEl.scrollHeight;
    }

    function addThinking() {
      removeEmpty();
      const row = document.createElement('div');
      row.className = 'row';
      row.innerHTML = `
        <div class="avatar bot-av">AI</div>
        <div class="msg bot thinking">
          <span class="dot"></span><span class="dot"></span><span class="dot"></span>
        </div>`;
      msgsEl.appendChild(row);
      msgsEl.scrollTop = msgsEl.scrollHeight;
      return row;
    }

    function replaceThinking(thinkingRow, text) {
      const msgEl = thinkingRow.querySelector('.msg');
      msgEl.classList.remove('thinking');
      msgEl.innerHTML = '';
      // Render newlines as <br>
      text.split('\\n').forEach((line, i, arr) => {
        msgEl.appendChild(document.createTextNode(line));
        if (i < arr.length - 1) msgEl.appendChild(document.createElement('br'));
      });
      msgsEl.scrollTop = msgsEl.scrollHeight;
    }

    async function send() {
      const query = inputEl.value.trim();
      if (!query) return;
      inputEl.value = '';
      sendBtn.disabled = true;

      addUserMessage(query);
      const thinkingRow = addThinking();

      try {
        const res = await fetch('/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query })
        });
        const data = await res.json();
        replaceThinking(thinkingRow, data.answer || data.detail || 'No answer returned.');
      } catch (e) {
        replaceThinking(thinkingRow, 'Error: ' + e.message);
      }

      sendBtn.disabled = false;
      inputEl.focus();
    }

    sendBtn.addEventListener('click', send);
    inputEl.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) send(); });
  </script>
</body>
</html>"""


@app.get("/", response_class=None)
def chat_ui():
    from fastapi.responses import HTMLResponse
    log.debug("Serving chat UI")
    return HTMLResponse(content=_HTML_UI)
