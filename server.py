import os
import sys
import numpy as np
from typing import Optional, List, Dict, Any
from fastapi import FastAPI, Query, HTTPException, Body
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
if CURRENT_DIR not in sys.path:
    sys.path.insert(0, CURRENT_DIR)

from engine import RedLampEngine
from index import RedLampIndexer, get_default_result_dir

RESULT_DIR = get_default_result_dir()

app = FastAPI(title="RedLamp Web Demo", description="Hệ thống demo phát hiện bất thường chuỗi thời gian không giám sát")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

indexer = RedLampIndexer(RESULT_DIR)
engine = RedLampEngine(RESULT_DIR)

class PredictPointRequest(BaseModel):
    dataset: str
    entity: str
    seed: int = 0
    point: List[float]
    context_type: str = "sample_last" # sample_last, custom, median
    custom_history: Optional[List[List[float]]] = None
    threshold_override: Optional[float] = None

class ExplainRequest(BaseModel):
    dataset: str
    entity: str
    seed: int = 0
    t: Optional[int] = None
    custom_window: Optional[List[List[float]]] = None
    point: Optional[List[float]] = None
    is_custom_point: bool = False

@app.get("/api/index")
def get_index():
    return indexer.index_cache

@app.get("/api/entity")
def get_entity(dataset: str = Query(...), entity: str = Query(...), seed: int = Query(0)):
    if "stock" in dataset.lower() or "stock" in entity.lower():
        raise HTTPException(status_code=400, detail="Stock dataset is excluded.")
    
    # Find entity in index
    ent_list = indexer.index_cache.get(dataset, [])
    target = next((e for e in ent_list if e["entity"] == entity), None)
    if not target and entity.upper() == "ALL" and ent_list:
        rep = ent_list[0]
        target = {
            **rep,
            "entity": "ALL",
            "display_name": "ALL",
            "representative_entity": rep["entity"],
            "num_entities": len(ent_list),
        }
    if not target:
        raise HTTPException(status_code=404, detail=f"Entity {entity} not found in {dataset}")

    # Check if model exists
    has_model = target["has_model"]
    extra_data = {}
    if has_model:
        try:
            d = engine.load_entity_data(dataset, entity, seed)
            if not target.get("model_path"):
                target["model_path"] = engine.get_model_path(dataset, entity, seed)
            extra_data = {
                "length": d["length"],
                "default_threshold": d["default_threshold"],
                "threshold_995": d["threshold_995"],
                "threshold_990": d["threshold_990"],
                "threshold_950": d["threshold_950"],
                "max_anomaly_idx": d["max_anomaly_idx"],
                "normal_idx": d["normal_idx"],
                "feat_min": d["feat_min"],
                "feat_max": d["feat_max"],
                "feat_median": d["feat_median"],
            }
        except Exception as e:
            extra_data = {"error": str(e)}

    return {
        "meta": target,
        "selected_seed": seed,
        "detail": extra_data,
    }

@app.post("/api/predict_point")
def predict_point(req: PredictPointRequest):
    if "stock" in req.dataset.lower() or "stock" in req.entity.lower():
        raise HTTPException(status_code=400, detail="Stock dataset is excluded.")
    try:
        return engine.predict_point(
            dataset=req.dataset,
            entity=req.entity,
            seed=req.seed,
            point=req.point,
            context_type=req.context_type,
            custom_history=req.custom_history,
            threshold_override=req.threshold_override,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/explain")
def explain(req: ExplainRequest):
    if "stock" in req.dataset.lower() or "stock" in req.entity.lower():
        raise HTTPException(status_code=400, detail="Stock dataset is excluded.")
    try:
        return engine.explain(
            dataset=req.dataset,
            entity=req.entity,
            seed=req.seed,
            t=req.t,
            custom_window=req.custom_window,
            point=req.point,
            is_custom_point=req.is_custom_point,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/series")
def get_series(
    dataset: str = Query(...),
    entity: str = Query(...),
    seed: int = Query(0),
    feature: str = Query("0"),
    max_points: int = Query(2000),
):
    if "stock" in dataset.lower() or "stock" in entity.lower():
        raise HTTPException(status_code=400, detail="Stock dataset is excluded.")
    try:
        d = engine.load_entity_data(dataset, entity, seed)
        N = d["length"]
        anom_arr = d["anomaly_score"]
        # Peak-preserving downsampling so every anomaly spike & exact peak t is preserved on hover/click
        step = max(1, N // max_points)
        if step == 1:
            indices = list(range(N))
        else:
            idx_set = {0, N - 1, int(d["max_anomaly_idx"]), int(d["normal_idx"])}
            for b in range(0, N, step):
                bucket = anom_arr[b : min(N, b + step)]
                peak_offset = int(bucket.argmax()) if len(bucket) > 0 else 0
                idx_set.add(b + peak_offset)
            indices = sorted(i for i in idx_set if 0 <= i < N)
        inp = d["inp_last"]
        D = inp.shape[1] if inp.ndim > 1 else 1
        f_key = str(feature).strip().lower()
        dominant_feat: Optional[List[int]] = None
        if D == 1:
            feat_vals = [float(inp[i, 0]) for i in indices]
        elif f_key == "max_dev":
            med = np.median(inp, axis=0)
            abs_dev = np.abs(inp - med)
            feat_vals = [float(abs_dev[i].max()) for i in indices]
            dominant_feat = [int(abs_dev[i].argmax()) + 1 for i in indices]
        elif f_key == "mean":
            feat_vals = [float(inp[i].mean()) for i in indices]
        elif f_key == "max":
            feat_vals = [float(inp[i].max()) for i in indices]
        else:
            try:
                f_idx = max(0, min(int(f_key), D - 1))
            except ValueError:
                f_idx = 0
            feat_vals = [float(inp[i, f_idx]) for i in indices]
        return {
            "indices": indices,
            "anomaly_score": [float(d["anomaly_score"][i]) for i in indices],
            "raw_score": [float(d["raw_score"][i]) for i in indices],
            "input_first_feature": feat_vals,
            "dominant_feature": dominant_feat,
            "max_anomaly_idx": d["max_anomaly_idx"],
            "normal_idx": d["normal_idx"],
            "threshold": d["default_threshold"],
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Mount static files
static_dir = os.path.join(CURRENT_DIR, "static")
if os.path.exists(static_dir):
    app.mount("/static", StaticFiles(directory=static_dir), name="static")

@app.get("/")
def serve_index():
    index_file = os.path.join(static_dir, "index.html")
    if os.path.exists(index_file):
        return FileResponse(index_file)
    return {"message": "RedLamp Demo API running. Static index.html not found."}

if __name__ == "__main__":
    import uvicorn
    print("Khởi động RedLamp Web Demo tại http://127.0.0.1:8001")
    uvicorn.run("server:app", host="127.0.0.1", port=8001, reload=False)

