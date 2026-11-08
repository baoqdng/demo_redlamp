import os
import glob
import math
import pandas as pd
from typing import Dict, List, Any, Optional

def calc_mean_std(vals: List[float]):
    if not vals:
        return 0.0, 0.0
    mean = sum(vals) / len(vals)
    if len(vals) == 1:
        return mean, 0.0
    var = sum((x - mean) ** 2 for x in vals) / len(vals)
    return mean, math.sqrt(var)

class RedLampIndexer:
    def __init__(self, result_dir: str):
        self.result_dir = os.path.abspath(result_dir)
        self.index_cache: Dict[str, List[Dict[str, Any]]] = {}
        self.scan()

    def scan(self):
        datasets: Dict[str, List[Dict[str, Any]]] = {}

        # 1. Parse CSV metrics
        iops_metrics = self._parse_seeds_csv(os.path.join(self.result_dir, "metrics_iops.csv"))
        smd_metrics = self._parse_seeds_csv(os.path.join(self.result_dir, "metrics_smd.csv"))
        msl_metrics = self._parse_seeds_csv(os.path.join(self.result_dir, "metrics_msl.csv"))
        smap_metrics = self._parse_seeds_csv(os.path.join(self.result_dir, "metrics_smap.csv"))
        aa_metrics = self._parse_anomaly_archive_csv(os.path.join(self.result_dir, "anomaly_archive_per_entity.csv"))

        # 2. iops / aiops
        aiops_dir = os.path.join(self.result_dir, "aiops")
        aiops_entities = []
        if os.path.exists(aiops_dir):
            for ent_name in sorted(os.listdir(aiops_dir)):
                if "stock" in ent_name.lower():
                    continue
                ent_path = os.path.join(aiops_dir, ent_name)
                if os.path.isdir(ent_path):
                    seeds, model_path = self._find_seeds_and_model(ent_path)
                    ent_m = iops_metrics.get(ent_name, {})
                    stats = self._compute_stats(ent_m)
                    aiops_entities.append({
                        "dataset": "iops",
                        "entity": ent_name,
                        "seeds": seeds if seeds else [0, 1, 2, 3, 4],
                        "default_seed": 0,
                        "n_features": 1,
                        "window_size": 100,
                        "window_step": 10,
                        "embedding_dim": 128,
                        "has_model": bool(model_path),
                        "model_path": model_path,
                        "is_multi_seed": True,
                        "per_seed_metrics": ent_m,
                        "aggregate_metrics": stats,
                        "single_metrics": None,
                    })
        datasets["iops"] = aiops_entities

        # 3. smd
        smd_dir = os.path.join(self.result_dir, "smd")
        smd_entities = []
        if os.path.exists(smd_dir):
            for ent_name in sorted(os.listdir(smd_dir)):
                if "stock" in ent_name.lower():
                    continue
                ent_path = os.path.join(smd_dir, ent_name)
                if os.path.isdir(ent_path):
                    seeds, model_path = self._find_seeds_and_model(ent_path)
                    ent_m = smd_metrics.get(ent_name, {})
                    stats = self._compute_stats(ent_m)
                    smd_entities.append({
                        "dataset": "smd",
                        "entity": ent_name,
                        "seeds": seeds if seeds else [0, 1, 2, 3, 4],
                        "default_seed": 0,
                        "n_features": 38,
                        "window_size": 100,
                        "window_step": 10,
                        "embedding_dim": 128,
                        "has_model": bool(model_path),
                        "model_path": model_path,
                        "is_multi_seed": True,
                        "per_seed_metrics": ent_m,
                        "aggregate_metrics": stats,
                        "single_metrics": None,
                    })
        datasets["smd"] = smd_entities

        # 4. msl
        msl_dir = os.path.join(self.result_dir, "msl")
        msl_entities = []
        if os.path.exists(msl_dir):
            seeds, model_path = self._find_seeds_and_model(msl_dir)
            test_each_dir = os.path.join(msl_dir, "d1_b128_w100_s10", "0", "test_each")
            channels = []
            if os.path.exists(test_each_dir):
                channels = [c for c in sorted(os.listdir(test_each_dir)) if "stock" not in c.lower() and os.path.isdir(os.path.join(test_each_dir, c))]
            if not channels:
                channels = sorted([k for k in msl_metrics.keys() if k != "msl" and "stock" not in k.lower()])
            for chan in channels:
                ent_m = msl_metrics.get(chan, {})
                stats = self._compute_stats(ent_m)
                msl_entities.append({
                    "dataset": "msl",
                    "entity": chan,
                    "seeds": seeds if seeds else [0, 1, 2, 3, 4],
                    "default_seed": 0,
                    "n_features": 55,
                    "window_size": 100,
                    "window_step": 10,
                    "embedding_dim": 128,
                    "has_model": bool(model_path),
                    "model_path": model_path,
                    "is_multi_seed": True,
                    "per_seed_metrics": ent_m,
                    "aggregate_metrics": stats,
                    "single_metrics": None,
                })
        datasets["msl"] = msl_entities

        # 5. smap
        smap_dir = os.path.join(self.result_dir, "smap")
        smap_entities = []
        if os.path.exists(smap_dir):
            seeds, model_path = self._find_seeds_and_model(smap_dir)
            test_each_dir = os.path.join(smap_dir, "d1_b128_w100_s10", "0", "test_each")
            channels = []
            if os.path.exists(test_each_dir):
                channels = [c for c in sorted(os.listdir(test_each_dir)) if "stock" not in c.lower() and os.path.isdir(os.path.join(test_each_dir, c))]
            if not channels:
                channels = sorted([k for k in smap_metrics.keys() if k != "smap" and "stock" not in k.lower()])
            for chan in channels:
                ent_m = smap_metrics.get(chan, {})
                stats = self._compute_stats(ent_m)
                smap_entities.append({
                    "dataset": "smap",
                    "entity": chan,
                    "seeds": seeds if seeds else [0, 1, 2, 3, 4],
                    "default_seed": 0,
                    "n_features": 25,
                    "window_size": 100,
                    "window_step": 10,
                    "embedding_dim": 128,
                    "has_model": bool(model_path),
                    "model_path": model_path,
                    "is_multi_seed": True,
                    "per_seed_metrics": ent_m,
                    "aggregate_metrics": stats,
                    "single_metrics": None,
                })
        datasets["smap"] = smap_entities

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

    def _compute_stats(self, seed_map: Dict[int, Dict[str, float]]) -> Dict[str, float]:
        roc = [v["vus_roc"] for v in seed_map.values()]
        pr = [v["vus_pr"] for v in seed_map.values()]
        rf = [v["rf"] for v in seed_map.values()]
        r_m, r_s = calc_mean_std(roc)
        p_m, p_s = calc_mean_std(pr)
        f_m, f_s = calc_mean_std(rf)
        return {
            "vus_roc_mean": r_m,
            "vus_roc_std": r_s,
            "vus_pr_mean": p_m,
            "vus_pr_std": p_s,
            "rf_mean": f_m,
            "rf_std": f_s,
        }

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
