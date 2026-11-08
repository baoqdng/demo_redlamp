import os
import sys
import numpy as np
import pytest
from fastapi.testclient import TestClient

CURRENT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if CURRENT_DIR not in sys.path:
    sys.path.insert(0, CURRENT_DIR)

from server import app
from index import RedLampIndexer
from engine import RedLampEngine

client = TestClient(app)
RESULT_DIR = r"D:\REDLAMP-danh\result"

def test_index_five_datasets_and_no_stock():
    indexer = RedLampIndexer(RESULT_DIR)
    datasets = indexer.index_cache

    # 1. Must contain all 5 datasets
    expected_ds = ["anomaly_archive", "iops", "smd", "smap", "msl"]
    for ds in expected_ds:
        assert ds in datasets, f"Missing dataset {ds}"
        assert len(datasets[ds]) > 0, f"Dataset {ds} is empty"

    # 2. Must NOT contain "stock" (case-insensitive)
    assert "stock" not in datasets, "Found dataset 'stock'"
    for ds_name, entities in datasets.items():
        assert "stock" not in ds_name.lower(), f"Dataset name contains stock: {ds_name}"
        for e in entities:
            assert "stock" not in e["entity"].lower(), f"Entity name contains stock: {e['entity']}"

    # 3. Multi-seed datasets must have seeds 0..4
    for ds in ["iops", "smd", "msl", "smap"]:
        ents = datasets[ds]
        for e in ents:
            assert set(e["seeds"]) == {0, 1, 2, 3, 4}, f"Entity {e['entity']} in {ds} seeds mismatch: {e['seeds']}"

    # 4. Anomaly archive has 250 entities
    aa_ents = datasets["anomaly_archive"]
    assert len(aa_ents) == 250, f"Anomaly archive expected 250 entities, found {len(aa_ents)}"

def test_api_entity_endpoint():
    # Test SMD machine-1-1
    resp = client.get("/api/entity?dataset=smd&entity=machine-1-1&seed=0")
    assert resp.status_code == 200
    data = resp.json()
    assert data["meta"]["n_features"] == 38
    assert data["meta"]["window_size"] == 100
    assert data["meta"]["is_multi_seed"] is True
    assert "aggregate_metrics" in data["meta"]
    assert "per_seed_metrics" in data["meta"]
    assert data["detail"]["default_threshold"] > 0

    # Test Anomaly archive 001
    resp_aa = client.get("/api/entity?dataset=anomaly_archive&entity=001&seed=0")
    assert resp_aa.status_code == 200
    data_aa = resp_aa.json()
    assert data_aa["meta"]["n_features"] == 1
    assert data_aa["meta"]["has_model"] is True
    assert data_aa["meta"]["single_metrics"]["vus_roc"] > 0.8

def test_predict_point_stability():
    # Test manual point prediction on SMD
    pt = [0.1] * 38
    resp1 = client.post("/api/predict_point", json={
        "dataset": "smd",
        "entity": "machine-1-1",
        "seed": 0,
        "point": pt,
        "context_type": "sample_last"
    })
    assert resp1.status_code == 200
    r1 = resp1.json()
    assert "conclusion" in r1
    assert "raw_mse" in r1
    assert "top3" in r1
    assert len(r1["top3"]) == 3
    assert "predicted_group" in r1
    assert "name_vi" in r1["predicted_group"]
    assert "desc_vi" in r1["predicted_group"]
    assert "prob" in r1["predicted_group"]
    assert "custom_window" in r1
    assert len(r1["custom_window"]) == 100
    assert "all_classes" in r1
    assert len(r1["all_classes"]) == 12

    # Repeat with identical input to verify stability
    resp2 = client.post("/api/predict_point", json={
        "dataset": "smd",
        "entity": "machine-1-1",
        "seed": 0,
        "point": pt,
        "context_type": "sample_last"
    })
    assert resp2.status_code == 200
    r2 = resp2.json()
    assert abs(r1["raw_mse"] - r2["raw_mse"]) < 1e-7
    assert r1["conclusion"] == r2["conclusion"]
    assert r1["predicted_group"]["index"] == r2["predicted_group"]["index"]

def test_explain_endpoint_and_sentences():
    # Test standard explain mode
    resp = client.post("/api/explain", json={
        "dataset": "smd",
        "entity": "machine-1-1",
        "seed": 0,
    })
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["explanations"]) == 5
    for i, exp_str in enumerate(data["explanations"]):
        words = exp_str.split()
        assert len(words) <= 20, f"Step {i+1} explanation exceeds 20 words: '{exp_str}' (words: {len(words)})"
    assert "mse_target" in data
    assert "conv_shapes" in data
    assert len(data["embedding"]) == 128
    assert len(data["classes_target"]) == 12

    # Test sync explain mode with custom injected point
    pt = [3.0] * 38 # clear anomaly spike/wander
    p_resp = client.post("/api/predict_point", json={
        "dataset": "smd",
        "entity": "machine-1-1",
        "seed": 0,
        "point": pt,
        "context_type": "sample_last"
    })
    p_data = p_resp.json()
    assert p_data["conclusion"] == "BẤT THƯỜNG"

    exp_custom_resp = client.post("/api/explain", json={
        "dataset": "smd",
        "entity": "machine-1-1",
        "seed": 0,
        "custom_window": p_data["custom_window"],
        "point": pt,
        "is_custom_point": True,
    })
    assert exp_custom_resp.status_code == 200
    c_data = exp_custom_resp.json()
    assert c_data["is_custom_point"] is True
    assert len(c_data["explanations"]) == 5
    for i, exp_str in enumerate(c_data["explanations"]):
        words = exp_str.split()
        assert len(words) <= 20, f"Custom Step {i+1} explanation exceeds 20 words: '{exp_str}' (words: {len(words)})"
    assert "winner_group" in c_data
    assert c_data["winner_group"]["index"] == p_data["predicted_group"]["index"]

def test_numerical_accuracy_against_saved_test_output():
    """Verify numerical precision of model inference against saved outputs on 1 entity per dataset."""
    eng = RedLampEngine(RESULT_DIR)

    test_cases = [
        ("smd", "machine-1-1", 0),
        ("iops", "KPI-05f10d3a-239c-3bef-9bdc-a2feeb0037aa", 0),
        ("msl", "C-1", 0),
        ("smap", "A-1", 0),
        ("anomaly_archive", "001", 0),
    ]

    for ds, ent, seed in test_cases:
        model, _ = eng.load_model(ds, ent, seed)
        data = eng.load_entity_data(ds, ent, seed)
        
        # Take window at t = 200
        t = 200
        win = eng.get_window(data, t)
        import torch
        win_t = torch.tensor(win, dtype=torch.float32).unsqueeze(0)
        with torch.no_grad():
            x_hat, x_out, _ = model(win_t)
        
        calc_mse = float(torch.nn.functional.mse_loss(win_t, x_hat).item())
        saved_mse = float(data["mse"][t])

        # Saved MSE vs calculated MSE must be within small tolerance (< 1e-4)
        diff = abs(calc_mse - saved_mse)
        assert diff < 1e-4, f"Dataset {ds} entity {ent} MSE mismatch at t={t}: calc={calc_mse}, saved={saved_mse}, diff={diff}"

