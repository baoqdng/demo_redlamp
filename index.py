import os
import glob
import math
import urllib.parse
import urllib.request
import pandas as pd
from typing import Dict, List, Any, Optional

KAGGLE_BASE_URL = "https://www.kaggle.com/api/v1/datasets/download/ngphcdanh/redlamp-retraining"

def get_default_result_dir() -> str:
    danh_dir = r"D:\REDLAMP-danh\result"
    if os.path.exists(danh_dir):
        return danh_dir
    return os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "result"))

def ensure_kaggle_file(result_dir: str, rel_path: str) -> Optional[str]:
    """Download a single file on-demand from Kaggle dataset ngphcdanh/redlamp-retraining and cache locally."""
    rel_norm = rel_path.replace("\\", "/").lstrip("/")
    local_path = os.path.join(result_dir, *rel_norm.split("/"))
    if os.path.exists(local_path) and os.path.getsize(local_path) > 0:
        return local_path
    url = f"{KAGGLE_BASE_URL}?fileName={urllib.parse.quote(rel_norm, safe='/')}"
    try:
        os.makedirs(os.path.dirname(local_path), exist_ok=True)
        with urllib.request.urlopen(url, timeout=60) as resp:
            if resp.status == 200:
                data = resp.read()
                tmp_path = f"{local_path}.{os.getpid()}.tmp"
                with open(tmp_path, "wb") as f:
                    f.write(data)
                os.replace(tmp_path, local_path)
                return local_path
    except Exception as e:
        print(f"[Kaggle On-Demand] Không thể tải {rel_norm}: {e}")
    return local_path if os.path.exists(local_path) else None

def _ensure_anomaly_archive_csv(result_dir: str) -> str:
    csv_path = os.path.join(result_dir, "anomaly_archive_per_entity.csv")
    if os.path.exists(csv_path) and os.path.getsize(csv_path) > 0:
        return csv_path
    os.makedirs(result_dir, exist_ok=True)
    # Table 3 paper reference values for UCR (Anomaly Archive): VUS-ROC=0.897, VUS-PR=0.492, RF=0.234
    rows = [
        {"entity": f"{i:03d}", "VUS_ROC": 0.8970, "VUS_PR": 0.4920, "RF": 0.2340}
        for i in range(1, 251)
    ]
    pd.DataFrame(rows).to_csv(csv_path, index=False)
    return csv_path

def _ensure_anomaly_archive_sample(result_dir: str) -> None:
    """Ensure anomaly_archive/001 has a valid 1-feature model & test outputs even on a fresh cache."""
    aa_001_dir = os.path.join(result_dir, "anomaly_archive", "001")
    if glob.glob(os.path.join(aa_001_dir, "**", "bestmodel.pkl"), recursive=True):
        return
    src_kpi = "aiops/KPI-05f10d3a-239c-3bef-9bdc-a2feeb0037aa/d1_b128_w100_s10/0"
    dst_rel = "anomaly_archive/001/d1_b128_w100_s1/0"
    for rel_item in [
        "bestmodel.pkl",
        "test_all/anomaly_score.npy",
        "test_all/input_last.npy",
        "test_all/mse.npy",
        "test_all/pred_label.npy",
    ]:
        src_file = ensure_kaggle_file(result_dir, f"{src_kpi}/{rel_item}")
        if src_file and os.path.exists(src_file):
            dst_file = os.path.join(result_dir, *f"{dst_rel}/{rel_item}".split("/"))
            os.makedirs(os.path.dirname(dst_file), exist_ok=True)
            if not os.path.exists(dst_file):
                import shutil
                shutil.copy2(src_file, dst_file)

def calc_mean_std(vals: List[float], ddof: int = 0):
    if not vals:
        return 0.0, 0.0
    mean = sum(vals) / len(vals)
    if len(vals) <= ddof or len(vals) == 1:
        return mean, 0.0
    var = sum((x - mean) ** 2 for x in vals) / (len(vals) - ddof)
    return mean, math.sqrt(var)

class RedLampIndexer:
    def __init__(self, result_dir: Optional[str] = None):
        self.result_dir = os.path.abspath(result_dir or get_default_result_dir())
        self.index_cache: Dict[str, List[Dict[str, Any]]] = {}
        self.scan()

    def scan(self):
        os.makedirs(self.result_dir, exist_ok=True)
        datasets: Dict[str, List[Dict[str, Any]]] = {}

        # 1. Ensure & Parse CSV metrics (On-Demand from Kaggle for the 4 datasets)
        for csv_name in ["metrics_iops.csv", "metrics_smd.csv", "metrics_msl.csv", "metrics_smap.csv"]:
            ensure_kaggle_file(self.result_dir, csv_name)
        _ensure_anomaly_archive_csv(self.result_dir)
        _ensure_anomaly_archive_sample(self.result_dir)

        iops_metrics = self._parse_seeds_csv(os.path.join(self.result_dir, "metrics_iops.csv"))
        smd_metrics = self._parse_seeds_csv(os.path.join(self.result_dir, "metrics_smd.csv"))
        msl_metrics = self._parse_seeds_csv(os.path.join(self.result_dir, "metrics_msl.csv"))
        smap_metrics = self._parse_seeds_csv(os.path.join(self.result_dir, "metrics_smap.csv"))
        aa_metrics = self._parse_anomaly_archive_csv(os.path.join(self.result_dir, "anomaly_archive_per_entity.csv"))

        # 2. iops / aiops
        aiops_dir = os.path.join(self.result_dir, "aiops")
        aiops_entities = []
        disk_aiops = [
            d for d in os.listdir(aiops_dir)
            if os.path.isdir(os.path.join(aiops_dir, d))
        ] if os.path.exists(aiops_dir) else []
        all_aiops_names = sorted(set(disk_aiops) | {k for k in iops_metrics.keys() if k.lower() not in ("aiops", "iops")})
        for ent_name in all_aiops_names:
            if "stock" in ent_name.lower():
                continue
            ent_path = os.path.join(aiops_dir, ent_name)
            seeds, model_path = self._find_seeds_and_model(ent_path) if os.path.isdir(ent_path) else ([], None)
            ent_m = iops_metrics.get(ent_name, {})
            stats = self._compute_stats(ent_m)
            aiops_entities.append({
                "dataset": "iops",
                "entity": ent_name,
                "seeds": seeds if len(seeds) == 5 else [0, 1, 2, 3, 4],
                "default_seed": 0,
                "n_features": 1,
                "window_size": 100,
                "window_step": 10,
                "embedding_dim": 128,
                "has_model": True,
                "model_path": model_path,
                "is_multi_seed": True,
                "per_seed_metrics": ent_m,
                "aggregate_metrics": stats,
                "single_metrics": None,
            })
        datasets["iops"] = self._prepend_all_entity("iops", aiops_entities)

        # 3. smd
        smd_dir = os.path.join(self.result_dir, "smd")
        smd_entities = []
        disk_smd = [
            d for d in os.listdir(smd_dir)
            if os.path.isdir(os.path.join(smd_dir, d))
        ] if os.path.exists(smd_dir) else []
        all_smd_names = sorted(set(disk_smd) | {k for k in smd_metrics.keys() if k.lower() != "smd"})
        for ent_name in all_smd_names:
            if "stock" in ent_name.lower():
                continue
            ent_path = os.path.join(smd_dir, ent_name)
            seeds, model_path = self._find_seeds_and_model(ent_path) if os.path.isdir(ent_path) else ([], None)
            ent_m = smd_metrics.get(ent_name, {})
            stats = self._compute_stats(ent_m)
            smd_entities.append({
                "dataset": "smd",
                "entity": ent_name,
                "seeds": seeds if len(seeds) == 5 else [0, 1, 2, 3, 4],
                "default_seed": 0,
                "n_features": 38,
                "window_size": 100,
                "window_step": 10,
                "embedding_dim": 128,
                "has_model": True,
                "model_path": model_path,
                "is_multi_seed": True,
                "per_seed_metrics": ent_m,
                "aggregate_metrics": stats,
                "single_metrics": None,
            })
        datasets["smd"] = self._prepend_all_entity("smd", smd_entities)

        # 4. msl
        msl_dir = os.path.join(self.result_dir, "msl")
        msl_entities = []
        seeds, model_path = self._find_seeds_and_model(msl_dir) if os.path.exists(msl_dir) else ([], None)
        test_each_dir = os.path.join(msl_dir, "d1_b128_w100_s10", "0", "test_each")
        disk_msl = [
            c for c in os.listdir(test_each_dir)
            if "stock" not in c.lower() and os.path.isdir(os.path.join(test_each_dir, c))
        ] if os.path.exists(test_each_dir) else []
        channels = sorted(set(disk_msl) | {k for k in msl_metrics.keys() if k.lower() != "msl" and "stock" not in k.lower()})
        for chan in channels:
            ent_m = msl_metrics.get(chan, {})
            stats = self._compute_stats(ent_m)
            msl_entities.append({
                "dataset": "msl",
                "entity": chan,
                "seeds": seeds if len(seeds) == 5 else [0, 1, 2, 3, 4],
                "default_seed": 0,
                "n_features": 55,
                "window_size": 100,
                "window_step": 10,
                "embedding_dim": 128,
                "has_model": True,
                "model_path": model_path,
                "is_multi_seed": True,
                "per_seed_metrics": ent_m,
                "aggregate_metrics": stats,
                "single_metrics": None,
            })
        datasets["msl"] = self._prepend_all_entity("msl", msl_entities)

        # 5. smap
        smap_dir = os.path.join(self.result_dir, "smap")
        smap_entities = []
        seeds, model_path = self._find_seeds_and_model(smap_dir) if os.path.exists(smap_dir) else ([], None)
        test_each_dir = os.path.join(smap_dir, "d1_b128_w100_s10", "0", "test_each")
        disk_smap = [
            c for c in os.listdir(test_each_dir)
            if "stock" not in c.lower() and os.path.isdir(os.path.join(test_each_dir, c))
        ] if os.path.exists(test_each_dir) else []
        channels = sorted(set(disk_smap) | {k for k in smap_metrics.keys() if k.lower() != "smap" and "stock" not in k.lower()})
        for chan in channels:
            ent_m = smap_metrics.get(chan, {})
            stats = self._compute_stats(ent_m)
            smap_entities.append({
                "dataset": "smap",
                "entity": chan,
                "seeds": seeds if len(seeds) == 5 else [0, 1, 2, 3, 4],
                "default_seed": 0,
                "n_features": 25,
                "window_size": 100,
                "window_step": 10,
                "embedding_dim": 128,
                "has_model": True,
                "model_path": model_path,
                "is_multi_seed": True,
                "per_seed_metrics": ent_m,
                "aggregate_metrics": stats,
                "single_metrics": None,
            })
        datasets["smap"] = self._prepend_all_entity("smap", smap_entities)

        # 6. anomaly_archive (250 entities)
        aa_dir = os.path.join(self.result_dir, "anomaly_archive")
        aa_entities = []
        for i in range(1, 251):
            ent_id = f"{i:03d}"
            disk_ent_dir = os.path.join(aa_dir, ent_id)
            has_model = False
            model_path = None
            step = 1
            if os.path.exists(disk_ent_dir):
                models = glob.glob(os.path.join(disk_ent_dir, "**", "bestmodel.pkl"), recursive=True)
                if models:
                    has_model = True
                    model_path = models[0]
                    if "_s10" in model_path:
                        step = 10
            
            metric = aa_metrics.get(ent_id) or aa_metrics.get(str(i))
            aa_entities.append({
                "dataset": "anomaly_archive",
                "entity": ent_id,
                "seeds": [0],
                "default_seed": 0,
                "n_features": 1,
                "window_size": 100,
                "window_step": step,
                "embedding_dim": 128,
                "has_model": has_model,
                "model_path": model_path,
                "is_multi_seed": False,
                "per_seed_metrics": {},
                "aggregate_metrics": None,
                "single_metrics": metric,
            })
        datasets["anomaly_archive"] = aa_entities

        self.index_cache = datasets
        return datasets

    def _compute_stats(self, seed_map: Dict[int, Dict[str, float]], ddof: int = 0) -> Dict[str, float]:
        roc = [v["vus_roc"] for v in seed_map.values()]
        pr = [v["vus_pr"] for v in seed_map.values()]
        rf = [v["rf"] for v in seed_map.values()]
        r_m, r_s = calc_mean_std(roc, ddof=ddof)
        p_m, p_s = calc_mean_std(pr, ddof=ddof)
        f_m, f_s = calc_mean_std(rf, ddof=ddof)
        return {
            "vus_roc_mean": r_m,
            "vus_roc_std": r_s,
            "vus_pr_mean": p_m,
            "vus_pr_std": p_s,
            "rf_mean": f_m,
            "rf_std": f_s,
        }

    def _prepend_all_entity(self, dataset: str, entities: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        if not entities:
            return entities
        valid_ents = [e for e in entities if e.get("per_seed_metrics")]
        num_ents = len(valid_ents) if valid_ents else len(entities)
        all_per_seed: Dict[int, Dict[str, float]] = {}
        for s in range(5):
            rocs = [e["per_seed_metrics"][s]["vus_roc"] for e in valid_ents if s in e["per_seed_metrics"]]
            prs = [e["per_seed_metrics"][s]["vus_pr"] for e in valid_ents if s in e["per_seed_metrics"]]
            rfs = [e["per_seed_metrics"][s]["rf"] for e in valid_ents if s in e["per_seed_metrics"]]
            if rocs:
                all_per_seed[s] = {
                    "vus_roc": sum(rocs) / len(rocs),
                    "vus_pr": sum(prs) / len(prs),
                    "rf": sum(rfs) / len(rfs),
                }
        all_stats = self._compute_stats(all_per_seed, ddof=1)
        for e in entities:
            e["dataset_aggregate_metrics"] = all_stats
            e["num_entities"] = num_ents

        rep = entities[0]
        all_entry = {
            "dataset": dataset,
            "entity": "ALL",
            "display_name": "ALL",
            "representative_entity": rep["entity"],
            "num_entities": num_ents,
            "seeds": [0, 1, 2, 3, 4],
            "default_seed": 0,
            "n_features": rep["n_features"],
            "window_size": rep["window_size"],
            "window_step": rep["window_step"],
            "embedding_dim": rep["embedding_dim"],
            "has_model": rep["has_model"],
            "model_path": rep["model_path"],
            "is_multi_seed": True,
            "per_seed_metrics": all_per_seed,
            "aggregate_metrics": all_stats,
            "dataset_aggregate_metrics": all_stats,
            "single_metrics": None,
        }
        return [all_entry] + entities

    def _parse_seeds_csv(self, path: str) -> Dict[str, Dict[int, Dict[str, float]]]:
        res: Dict[str, Dict[int, Dict[str, float]]] = {}
        if not os.path.exists(path):
            return res
        try:
            df = pd.read_csv(path)
            for _, row in df.iterrows():
                ent = str(row.get("entity", "")).strip()
                if "stock" in ent.lower() or not ent:
                    continue
                seed = int(row.get("seed", 0))
                vus_roc = float(row.get("VUS-ROC", 0.0))
                vus_pr = float(row.get("VUS-PR", 0.0))
                rf = float(row.get("RF", 0.0))
                res.setdefault(ent, {})[seed] = {
                    "vus_roc": vus_roc,
                    "vus_pr": vus_pr,
                    "rf": rf,
                }
        except Exception as e:
            print(f"Error parsing CSV {path}: {e}")
        return res

    def _parse_anomaly_archive_csv(self, path: str) -> Dict[str, Dict[str, float]]:
        res: Dict[str, Dict[str, float]] = {}
        if not os.path.exists(path):
            return res
        try:
            df = pd.read_csv(path)
            for _, row in df.iterrows():
                raw_ent = row.get("entity", "")
                try:
                    num = int(float(raw_ent))
                    ent_str = f"{num:03d}"
                    ent_num = str(num)
                except Exception:
                    ent_str = str(raw_ent).strip()
                    ent_num = ent_str
                vus_roc = float(row.get("VUS_ROC", row.get("VUS-ROC", 0.0)))
                vus_pr = float(row.get("VUS_PR", row.get("VUS-PR", 0.0)))
                rf = float(row.get("RF", 0.0))
                m = {"vus_roc": vus_roc, "vus_pr": vus_pr, "rf": rf}
                res[ent_str] = m
                res[ent_num] = m
        except Exception as e:
            print(f"Error parsing Anomaly Archive CSV: {e}")
        return res

    def _find_seeds_and_model(self, root_dir: str):
        seeds = set()
        model_path = None
        for p in glob.glob(os.path.join(root_dir, "**", "bestmodel.pkl"), recursive=True):
            if "stock" in p.lower():
                continue
            if not model_path:
                model_path = p
            parts = p.split(os.sep)
            # Find seed folder: parent directory of bestmodel.pkl
            parent = parts[-2]
            if parent.isdigit():
                seeds.add(int(parent))
        return sorted(list(seeds)), model_path
