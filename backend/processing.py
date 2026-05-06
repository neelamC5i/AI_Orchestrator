import json
import os
import re
import time
import logging
from typing import List, Dict, Optional

from ingestion import extract_text
from entity_extraction import extract_entities, extract_relationships
from graph_builder import GraphBuilder

logger = logging.getLogger(__name__)

PROCESSED_DIR = "data/processed"
_graph_builder = GraphBuilder()


def clean_text(text: str) -> str:
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r" {2,}", " ", text)
    text = re.sub(r"[\x00-\x08\x0b-\x0c\x0e-\x1f\x7f]", "", text)
    return text.strip()


def chunk_text(text: str, size: int = 400, overlap: int = 60) -> List[Dict]:
    words = text.split()
    chunks: List[Dict] = []
    start = 0
    idx = 0
    while start < len(words):
        end = min(start + size, len(words))
        chunks.append({"idx": idx, "text": " ".join(words[start:end])})
        start += size - overlap
        idx += 1
    return chunks


def _write_status(file_id: str, updates: Dict):
    path = f"{PROCESSED_DIR}/{file_id}_status.json"
    try:
        with open(path) as f:
            data = json.load(f)
        data.update(updates)
        with open(path, "w") as f:
            json.dump(data, f)
    except Exception as e:
        logger.error(f"Status write failed for {file_id}: {e}")


def get_file_status(file_id: str) -> Optional[Dict]:
    path = f"{PROCESSED_DIR}/{file_id}_status.json"
    if not os.path.exists(path):
        return None
    with open(path) as f:
        return json.load(f)


def get_all_statuses() -> List[Dict]:
    out: List[Dict] = []
    if not os.path.exists(PROCESSED_DIR):
        return out
    for fname in os.listdir(PROCESSED_DIR):
        if fname.endswith("_status.json"):
            try:
                with open(f"{PROCESSED_DIR}/{fname}") as f:
                    out.append(json.load(f))
            except Exception:
                pass
    out.sort(key=lambda x: x.get("uploaded_at", 0), reverse=True)
    return out


def process_file_pipeline(file_id: str, file_path: str, ext: str, embedding_store):
    try:
        logger.info(f"Pipeline start: {file_id}")
        _write_status(file_id, {"status": "processing"})

        # 1. Extract
        text = extract_text(file_path, ext)
        if not text.strip():
            _write_status(file_id, {"status": "failed", "error": "No text could be extracted"})
            return

        # 2. Clean
        text = clean_text(text)
        _write_status(file_id, {
            "status": "cleaned",
            "pipeline_steps": {
                "cleaned": True, "chunked": False,
                "entities_extracted": False, "graph_built": False, "indexed": False,
            },
        })
        time.sleep(0.3)

        # 3. Chunk
        chunks = chunk_text(text)
        _write_status(file_id, {
            "status": "chunked",
            "chunks_count": len(chunks),
            "pipeline_steps": {
                "cleaned": True, "chunked": True,
                "entities_extracted": False, "graph_built": False, "indexed": False,
            },
        })
        time.sleep(0.3)

        # 4. Entity extraction
        entities = extract_entities(text)
        relationships = extract_relationships(text, entities)
        _write_status(file_id, {
            "status": "entities_extracted",
            "entities_count": len(entities),
            "relations_count": len(relationships),
            "pipeline_steps": {
                "cleaned": True, "chunked": True,
                "entities_extracted": True, "graph_built": False, "indexed": False,
            },
        })
        time.sleep(0.3)

        # 5. Build graph
        _graph_builder.build_graph(file_id, entities, relationships)
        _write_status(file_id, {
            "status": "graph_built",
            "pipeline_steps": {
                "cleaned": True, "chunked": True,
                "entities_extracted": True, "graph_built": True, "indexed": False,
            },
        })
        time.sleep(0.3)

        # 6. Embed & index
        embedding_store.add_chunks(file_id, chunks)

        # 7. Save processed preview
        with open(f"{PROCESSED_DIR}/{file_id}_data.json", "w") as f:
            json.dump({
                "file_id": file_id,
                "text_preview": text[:500],
                "chunks_count": len(chunks),
                "entities": entities[:50],
                "relationships": relationships[:100],
            }, f)

        _write_status(file_id, {
            "status": "completed",
            "completed_at": time.time(),
            "pipeline_steps": {
                "cleaned": True, "chunked": True,
                "entities_extracted": True, "graph_built": True, "indexed": True,
            },
        })
        logger.info(f"Pipeline complete: {file_id}")

    except Exception as e:
        logger.error(f"Pipeline failed for {file_id}: {e}", exc_info=True)
        _write_status(file_id, {"status": "failed", "error": str(e)})


def retry_indexing_pipeline(file_id: str, file_path: str, ext: str, embedding_store):
    """Re-run only the embed & index stage for a file whose graph was already built."""
    try:
        logger.info(f"Retry indexing: {file_id}")
        _write_status(file_id, {"status": "processing", "error": None})

        text = extract_text(file_path, ext)
        if not text.strip():
            _write_status(file_id, {"status": "failed", "error": "No text could be extracted"})
            return

        text = clean_text(text)
        chunks = chunk_text(text)

        embedding_store.add_chunks(file_id, chunks)

        entities = []
        relationships = []
        data_path = f"{PROCESSED_DIR}/{file_id}_data.json"
        if os.path.exists(data_path):
            with open(data_path) as f:
                saved = json.load(f)
            entities = saved.get("entities", [])
            relationships = saved.get("relationships", [])
        else:
            entities = extract_entities(text)
            relationships = extract_relationships(text, entities)
            with open(data_path, "w") as f:
                json.dump({
                    "file_id": file_id,
                    "text_preview": text[:500],
                    "chunks_count": len(chunks),
                    "entities": entities[:50],
                    "relationships": relationships[:100],
                }, f)

        _write_status(file_id, {
            "status": "completed",
            "completed_at": time.time(),
            "chunks_count": len(chunks),
            "pipeline_steps": {
                "cleaned": True, "chunked": True,
                "entities_extracted": True, "graph_built": True, "indexed": True,
            },
        })
        logger.info(f"Retry indexing complete: {file_id}")

    except Exception as e:
        logger.error(f"Retry indexing failed for {file_id}: {e}", exc_info=True)
        _write_status(file_id, {"status": "failed", "error": str(e)})
