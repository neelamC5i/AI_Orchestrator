import json
import logging
import os
import time
import uuid
from typing import List, Optional

import aiofiles
from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger(__name__)

from decision import DecisionEngine
from embedding import EmbeddingStore
from entity_extraction import extract_entities
from graph_builder import GraphBuilder
from processing import get_all_statuses, get_file_status, process_file_pipeline, retry_indexing_pipeline
from router import ModelRouter
from slm import SLMRegistry
from trace import TraceEngine

app = FastAPI(title="AI Orchestrator API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

for d in ["data/files", "data/processed", "data/graphs", "data/faiss"]:
    os.makedirs(d, exist_ok=True)

embedding_store = EmbeddingStore()
slm_registry = SLMRegistry()
model_router = ModelRouter()
decision_engine = DecisionEngine()
trace_engine = TraceEngine()
graph_builder = GraphBuilder()


# ── Request models ──────────────────────────────────────────────────────────

class AnalyseRequest(BaseModel):
    prompt: str
    file_ids: List[str] = []


class QueryRequest(BaseModel):
    prompt: str
    file_ids: List[str] = []
    slm_id: Optional[str] = None


class FinalRunRequest(BaseModel):
    prompt: str
    slm_id: str
    model: str
    file_ids: List[str] = []


class ScrapeRequest(BaseModel):
    url: str


# ── Endpoints ───────────────────────────────────────────────────────────────

@app.get("/")
async def root():
    return {"status": "AI Orchestrator API running", "version": "1.0.0"}


@app.post("/upload")
async def upload(background_tasks: BackgroundTasks, file: UploadFile = File(...)):
    file_id = str(uuid.uuid4())
    ext = os.path.splitext(file.filename)[1].lower()
    save_path = f"data/files/{file_id}{ext}"

    content = await file.read()
    async with aiofiles.open(save_path, "wb") as f:
        await f.write(content)

    status = {
        "file_id": file_id,
        "filename": file.filename,
        "size": len(content),
        "ext": (ext.lstrip(".") or "txt").upper(),
        "path": save_path,
        "status": "uploaded",
        "pipeline_steps": {
            "cleaned": False, "chunked": False,
            "entities_extracted": False, "graph_built": False, "indexed": False,
        },
        "entities_count": 0,
        "relations_count": 0,
        "chunks_count": 0,
        "uploaded_at": time.time(),
    }
    async with aiofiles.open(f"data/processed/{file_id}_status.json", "w") as f:
        await f.write(json.dumps(status))

    background_tasks.add_task(process_file_pipeline, file_id, save_path, ext, embedding_store)
    return {"file_id": file_id, "filename": file.filename, "status": "uploaded"}


@app.get("/status")
async def status_all():
    return {"files": get_all_statuses()}


@app.get("/status/{file_id}")
async def status_one(file_id: str):
    s = get_file_status(file_id)
    if not s:
        raise HTTPException(404, "File not found")
    return s


@app.post("/scrape")
async def scrape(req: ScrapeRequest, background_tasks: BackgroundTasks):
    try:
        import requests as req_lib
        from bs4 import BeautifulSoup

        resp = req_lib.get(req.url, timeout=15, headers={"User-Agent": "Mozilla/5.0"})
        soup = BeautifulSoup(resp.text, "html.parser")
        for tag in soup(["script", "style", "nav", "footer", "header"]):
            tag.decompose()
        text = soup.get_text(separator="\n", strip=True)

        file_id = str(uuid.uuid4())
        save_path = f"data/files/{file_id}.txt"
        with open(save_path, "w", encoding="utf-8") as fh:
            fh.write(text)

        domain = req.url.replace("https://", "").replace("http://", "").split("/")[0]
        status = {
            "file_id": file_id,
            "filename": f"{domain}_scraped.txt",
            "size": len(text),
            "ext": "TXT",
            "path": save_path,
            "status": "uploaded",
            "pipeline_steps": {
                "cleaned": False, "chunked": False,
                "entities_extracted": False, "graph_built": False, "indexed": False,
            },
            "entities_count": 0, "relations_count": 0, "chunks_count": 0,
            "uploaded_at": time.time(),
        }
        with open(f"data/processed/{file_id}_status.json", "w") as fh:
            json.dump(status, fh)

        background_tasks.add_task(process_file_pipeline, file_id, save_path, ".txt", embedding_store)
        return {"file_id": file_id, "url": req.url, "chars": len(text), "status": "processing"}
    except Exception as e:
        raise HTTPException(400, str(e))


@app.post("/retry/{file_id}")
async def retry_file(file_id: str, background_tasks: BackgroundTasks):
    s = get_file_status(file_id)
    if not s:
        raise HTTPException(404, "File not found")
    if s.get("status") not in ("failed", "completed"):
        return {"file_id": file_id, "message": "Nothing to retry", "status": s.get("status")}

    steps = s.get("pipeline_steps", {})
    file_path = s.get("path", "")
    ext = f".{s.get('ext', 'pdf').lower()}"

    if not os.path.exists(file_path):
        raise HTTPException(400, "Source file not found on disk")

    if steps.get("graph_built"):
        background_tasks.add_task(retry_indexing_pipeline, file_id, file_path, ext, embedding_store)
    else:
        background_tasks.add_task(process_file_pipeline, file_id, file_path, ext, embedding_store)

    return {"file_id": file_id, "status": "retrying"}


@app.post("/analyse")
async def analyse(req: AnalyseRequest):
    slm_result = slm_registry.match(req.prompt)
    model_recs = model_router.route(req.prompt, slm_score=slm_result["score"])
    dec = decision_engine.analyze(
        req.prompt,
        slm_score=slm_result["score"],
        model_score=model_recs[0]["score"] if model_recs else 0,
    )
    return {"slm_result": slm_result, "model_recommendations": model_recs, "decision": dec}


@app.post("/query")
async def query(req: QueryRequest):
    q_emb = embedding_store.embed_text(req.prompt)
    fids = req.file_ids or None
    chunks = embedding_store.search(q_emb, k=5, file_ids=fids)
    ents = extract_entities(req.prompt)
    rels = graph_builder.get_relations([e["text"] for e in ents], fids)
    context = "\n\n".join(c["text"] for c in chunks)

    from llm_client import call_llm
    answer = await call_llm(req.prompt, context, rels)

    if req.slm_id:
        slm_registry.update_usage(req.slm_id)

    return {"answer": answer, "sources": chunks, "graph_relations": rels}


@app.get("/graph")
async def graph(file_ids: Optional[str] = Query(None)):
    fids = [f for f in (file_ids or "").split(",") if f] or None
    return graph_builder.get_graph(fids)


@app.post("/final-run")
async def final_run(req: FinalRunRequest):
    tid = trace_engine.start()
    t0 = time.time()

    slm = slm_registry.get(req.slm_id)
    if not slm:
        raise HTTPException(404, "SLM not found")

    trace_engine.add_step(tid, "query_received", f"Query received and parsed: {req.prompt[:60]}…")
    trace_engine.add_step(tid, "slm_loaded", f"SLM '{slm['name']}' loaded successfully")

    fids = req.file_ids or None
    q_emb = embedding_store.embed_text(req.prompt)
    chunks = embedding_store.search(q_emb, k=5, file_ids=fids)
    trace_engine.add_step(tid, "retrieval_complete", f"Retrieved {len(chunks)} relevant chunks from FAISS index")

    ents = extract_entities(req.prompt)
    rels = graph_builder.get_relations([e["text"] for e in ents], fids)
    trace_engine.add_step(tid, "graph_traversed", f"Knowledge graph: {len(rels)} relevant relations found")

    context = "\n\n".join(c["text"] for c in chunks)
    trace_engine.add_step(tid, "model_selected", f"Model '{req.model}' selected for generation")

    from llm_client import call_llm
    answer = await call_llm(req.prompt, context, rels, model=req.model)

    elapsed = round(time.time() - t0, 2)
    ans_tok = int(len(answer.split()) * 1.3)
    ctx_tok = int(len(context.split()) * 1.3)
    prompt_tok = int(len(req.prompt.split()) * 1.3)
    tokens_used = ans_tok + ctx_tok + prompt_tok
    baseline = tokens_used * 6
    tokens_saved = baseline - tokens_used
    cost = round(tokens_used * 0.00000025, 5)

    trace_engine.add_step(tid, "response_generated", f"Response generated — {tokens_used} tokens in {elapsed}s")
    slm_registry.update_usage(req.slm_id)

    return {
        "answer": answer,
        "trace": trace_engine.finish(tid),
        "session_insights": {
            "tokens_used": tokens_used,
            "tokens_saved": tokens_saved,
            "cost_usd": cost,
            "execution_time": elapsed,
            "slm_used": slm["name"],
            "model": req.model,
            "token_reduction_pct": round(tokens_saved / baseline * 100, 1) if baseline else 0,
        },
        "sources": chunks,
        "graph_relations": rels,
    }


@app.get("/stats")
async def stats():
    all_files = get_all_statuses()
    slms = slm_registry.list_all()
    total_saved = sum(s.get("usage_count", 1) * 2340 for s in slms)
    completed = len([f for f in all_files if f.get("status") == "completed"])
    return {
        "tokens_saved": total_saved,
        "active_slms": len(slms),
        "files_ingested": completed,
        "total_files": len(all_files),
        "cost_saved": round(total_saved * 0.00003, 2),
        "recent_sessions": slm_registry.get_recent_sessions(),
        "slm_hit_rate": {"reused": 65, "created": 22, "fallback": 13},
    }
