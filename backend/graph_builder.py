import json
import os
import logging
from typing import List, Dict, Optional

logger = logging.getLogger(__name__)

GRAPH_DIR = "data/graphs"
os.makedirs(GRAPH_DIR, exist_ok=True)


class GraphBuilder:
    def build_graph(self, file_id: str, entities: List[Dict], relationships: List[Dict]) -> Dict:
        node_ids: Dict[str, str] = {}
        nodes: List[Dict] = []
        edges: List[Dict] = []

        for ent in entities:
            nid = f"n{len(nodes)}"
            node_ids[ent["text"]] = nid
            nodes.append({
                "id": nid,
                "label": ent["text"],
                "type": ent.get("type", "entity"),
                "entity_type": ent.get("label", "ENTITY"),
            })

        for rel in relationships:
            src = node_ids.get(rel["source"])
            tgt = node_ids.get(rel["target"])
            if src and tgt and src != tgt:
                edges.append({
                    "source": src,
                    "target": tgt,
                    "relation": rel["relation"],
                    "context": rel.get("context", "")[:100],
                })

        graph = {
            "file_id": file_id,
            "nodes": nodes,
            "edges": edges,
            "stats": {"node_count": len(nodes), "edge_count": len(edges)},
        }

        with open(f"{GRAPH_DIR}/{file_id}_graph.json", "w") as f:
            json.dump(graph, f)

        return graph

    def get_graph(self, file_ids: Optional[List[str]] = None) -> Dict:
        all_nodes: List[Dict] = []
        all_edges: List[Dict] = []

        if not os.path.exists(GRAPH_DIR):
            return {"nodes": [], "edges": [], "stats": {"node_count": 0, "edge_count": 0}}

        for fname in os.listdir(GRAPH_DIR):
            if not fname.endswith("_graph.json"):
                continue
            fid = fname.replace("_graph.json", "")
            if file_ids and fid not in file_ids:
                continue
            try:
                with open(os.path.join(GRAPH_DIR, fname)) as f:
                    g = json.load(f)
                prefix = fid[:8]
                for node in g.get("nodes", []):
                    n = dict(node)
                    n["id"] = f"{prefix}_{n['id']}"
                    n["file_id"] = fid
                    all_nodes.append(n)
                for edge in g.get("edges", []):
                    e = dict(edge)
                    e["source"] = f"{prefix}_{e['source']}"
                    e["target"] = f"{prefix}_{e['target']}"
                    e["file_id"] = fid
                    all_edges.append(e)
            except Exception as ex:
                logger.error(f"Failed to load graph {fname}: {ex}")

        return {
            "nodes": all_nodes,
            "edges": all_edges,
            "stats": {"node_count": len(all_nodes), "edge_count": len(all_edges)},
        }

    def get_relations(self, entity_texts: List[str], file_ids: Optional[List[str]] = None) -> List[Dict]:
        graph = self.get_graph(file_ids)
        matching = {
            n["id"]
            for n in graph["nodes"]
            if any(et.lower() in n["label"].lower() for et in entity_texts)
        }
        return [
            e for e in graph["edges"]
            if e["source"] in matching or e["target"] in matching
        ][:20]
