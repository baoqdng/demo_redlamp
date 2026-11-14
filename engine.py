import os
import sys
import glob
import numpy as np
import torch
import torch.nn as nn
from typing import Dict, Any, List, Optional, Tuple

# Add REDLAMP-main / RedLamp to sys.path
_DANH_REDLAMP_PATH = r"D:\REDLAMP-danh\REDLAMP-main"
REDLAMP_PATH = (
    _DANH_REDLAMP_PATH
    if os.path.exists(_DANH_REDLAMP_PATH)
    else os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "RedLamp"))
)
if REDLAMP_PATH not in sys.path:
    sys.path.insert(0, REDLAMP_PATH)

from index import ensure_kaggle_file, get_default_result_dir
import utils
from models.meta import ConvAEC

ANOMALY_TYPES = [
    'normal', 'spike', 'flip', 'speedup', 'noise', 'cutoff',
    'average', 'scale', 'wander', 'contextual', 'upsidedown', 'mixture'
]

PSEUDO_ANOMALY_INFO = {
    0: {
        "name": "normal",
        "name_vi": "Normal (Bình thường)",
        "desc_vi": "Tín hiệu hoạt động ổn định, không có biến dạng Pseudo-Anomaly."
    },
    1: {
        "name": "spike",
        "name_vi": "Spike (Đột biến đỉnh nhọn)",
        "desc_vi": "Biến động tăng/giảm biên độ đột biến cục bộ tại 1–2 bước thời gian."
    },
    2: {
        "name": "flip",
        "name_vi": "Flip (Đảo chiều đoạn sóng)",
        "desc_vi": "Thứ tự thời gian của phân đoạn tín hiệu bị đảo ngược so với chuẩn."
    },
    3: {
        "name": "speedup",
        "name_vi": "Speedup (Biến đổi tần số)",
        "desc_vi": "Chu kỳ hoặc tần số dao động của chuỗi tăng/giảm đột ngột."
    },
    4: {
        "name": "noise",
        "name_vi": "Noise (Nhiễu Gaussian)",
        "desc_vi": "Biên độ bị xáo trộn bởi nhiễu trắng ngẫu nhiên cường độ lớn."
    },
    5: {
        "name": "cutoff",
        "name_vi": "Cutoff (Chặn ngưỡng biên độ)",
        "desc_vi": "Tín hiệu bị giữ phẳng ở mức cố định (Clipping / Saturation)."
    },
    6: {
        "name": "average",
        "name_vi": "Average (Moving Average)",
        "desc_vi": "Tín hiệu bị làm trơn quá mức, mất dao động chi tiết."
    },
    7: {
        "name": "scale",
        "name_vi": "Scale (Co giãn biên độ)",
        "desc_vi": "Biên độ phân đoạn bị phóng đại hoặc thu nhỏ bất thường."
    },
    8: {
        "name": "wander",
        "name_vi": "Wander (Baseline Drift)",
        "desc_vi": "Đường nền (Baseline) trôi lệch dần khỏi mức cân bằng chuẩn."
    },
    9: {
        "name": "contextual",
        "name_vi": "Contextual (Bất thường ngữ cảnh)",
        "desc_vi": "Giá trị vẫn trong dải cho phép nhưng lệch pha so với ngữ cảnh xung quanh."
    },
    10: {
        "name": "upsidedown",
        "name_vi": "Upside-down (Đảo ngược biên độ)",
        "desc_vi": "Đỉnh và đáy sóng bị lật đối xứng qua giá trị trung bình của đoạn."
    },
    11: {
        "name": "mixture",
        "name_vi": "Mixture (Ghép trộn phân đoạn)",
        "desc_vi": "Phân đoạn tín hiệu từ thời điểm khác bị chèn lệch pha vào cửa sổ hiện tại."
    }
}

class RedLampEngine:
    def __init__(self, result_dir: Optional[str] = None):
        self.result_dir = os.path.abspath(result_dir or get_default_result_dir())
        self.model_cache: Dict[Tuple[str, str, int], Any] = {}
        self.data_cache: Dict[Tuple[str, str, int], Dict[str, Any]] = {}

    def _resolve_entity(self, dataset: str, entity: str) -> str:
        if entity and entity.upper() != "ALL":
            return entity
        defaults = {
            "smd": "machine-1-1",
            "iops": "KPI-05f10d3a-239c-3bef-9bdc-a2feeb0037aa",
            "aiops": "KPI-05f10d3a-239c-3bef-9bdc-a2feeb0037aa",
            "msl": "C-1",
            "smap": "A-1",
            "anomaly_archive": "001",
        }
        return defaults.get(dataset, entity)

    def get_model_path(self, dataset: str, entity: str, seed: int) -> Optional[str]:
        entity = self._resolve_entity(dataset, entity)
        if dataset in ["msl", "smap"]:
            rel = f"{dataset}/d1_b128_w100_s10/{seed}/bestmodel.pkl"
            p = ensure_kaggle_file(self.result_dir, rel)
            if p and os.path.exists(p):
                return p
        elif dataset in ["iops", "aiops"]:
            rel = f"aiops/{entity}/d1_b128_w100_s10/{seed}/bestmodel.pkl"
            p = ensure_kaggle_file(self.result_dir, rel)
            if p and os.path.exists(p):
                return p
        elif dataset == "smd":
            rel = f"smd/{entity}/d1_b128_w100_s10/{seed}/bestmodel.pkl"
            p = ensure_kaggle_file(self.result_dir, rel)
            if p and os.path.exists(p):
                return p
        elif dataset == "anomaly_archive":
            # Search under anomaly_archive/entity/.../0/bestmodel.pkl
            pattern = os.path.join(self.result_dir, "anomaly_archive", entity, "**", "bestmodel.pkl")
            matches = glob.glob(pattern, recursive=True)
            if matches:
                return matches[0]
        return None

    def _ensure_test_files(self, rel_dir: str) -> Optional[str]:
        required_files = ["anomaly_score.npy", "input_last.npy", "mse.npy", "pred_label.npy"]
        local_dir = os.path.join(self.result_dir, *rel_dir.split("/"))
        for fname in required_files:
            fpath = os.path.join(local_dir, fname)
            if not os.path.exists(fpath) or os.path.getsize(fpath) == 0:
                ensure_kaggle_file(self.result_dir, f"{rel_dir}/{fname}")
        if os.path.exists(os.path.join(local_dir, "anomaly_score.npy")):
            return local_dir
        return None

    def get_test_dir(self, dataset: str, entity: str, seed: int) -> Optional[str]:
        entity = self._resolve_entity(dataset, entity)
        if dataset in ["msl", "smap"]:
            rel_dir = f"{dataset}/d1_b128_w100_s10/{seed}/test_each/{entity}/test_all"
            d = self._ensure_test_files(rel_dir)
            if d and os.path.exists(d):
                return d
            d_all = os.path.join(self.result_dir, dataset, "d1_b128_w100_s10", str(seed), "test_all")
            if os.path.exists(d_all):
                return d_all
        elif dataset in ["iops", "aiops"]:
            rel_dir = f"aiops/{entity}/d1_b128_w100_s10/{seed}/test_all"
            d = self._ensure_test_files(rel_dir)
            if d and os.path.exists(d):
                return d
        elif dataset == "smd":
            rel_dir = f"smd/{entity}/d1_b128_w100_s10/{seed}/test_all"
            d = self._ensure_test_files(rel_dir)
            if d and os.path.exists(d):
                return d
        elif dataset == "anomaly_archive":
            pattern = os.path.join(self.result_dir, "anomaly_archive", entity, "**", "test_all")
            matches = glob.glob(pattern, recursive=True)
            if matches:
                return matches[0]
        return None

    def load_model(self, dataset: str, entity: str, seed: int) -> Tuple[ConvAEC, utils.AttrDict]:
        entity = self._resolve_entity(dataset, entity)
        key = (dataset, entity, seed)
        if key in self.model_cache:
            return self.model_cache[key]

        model_path = self.get_model_path(dataset, entity, seed)
        if not model_path or not os.path.exists(model_path):
            raise FileNotFoundError(f"Model file not found for {dataset}/{entity}/seed {seed}")

        # Determine n_features & step
        n_features = 1
        if dataset == "smd":
            n_features = 38
        elif dataset == "smap":
            n_features = 25
        elif dataset == "msl":
            n_features = 55

        params = utils.AttrDict(
            name='ConvAEC',
            n_features=n_features,
            n_time=100,
            num_filters=[128, 128, 256, 256],
            embedding_dim=128,
            kernel_size=4,
            dropout=0.2,
            normalization='batch',
            stride=2,
            padding=2,
            anomaly_types=ANOMALY_TYPES,
            classes=12,
            classifier_dim=32,
            c_loss_ratio=0.1,
            apply_anomaly_mask=True,
            label_smoothing=True,
            alpha=0.1,
            beta=0.01,
            fix_double_softmax=False,
            epoch=100,
            lr=0.001,
        )

        model = ConvAEC(params)
        state_dict = torch.load(model_path, map_location='cpu', weights_only=False)
        model.load_state_dict(state_dict)
        model.eval()

        self.model_cache[key] = (model, params)
        return model, params

    def load_entity_data(self, dataset: str, entity: str, seed: int) -> Dict[str, Any]:
        entity = self._resolve_entity(dataset, entity)
        key = (dataset, entity, seed)
        if key in self.data_cache:
            return self.data_cache[key]

        test_dir = self.get_test_dir(dataset, entity, seed)
        if not test_dir or not os.path.exists(test_dir):
            raise FileNotFoundError(f"Test directory not found for {dataset}/{entity}/seed {seed}")

        # Load arrays
        anomaly_score = np.load(os.path.join(test_dir, "anomaly_score.npy"))
        
        # input_last or input
        inp_last = None
        input_3d = None
        if os.path.exists(os.path.join(test_dir, "input_last.npy")):
            inp_last = np.load(os.path.join(test_dir, "input_last.npy"))
        if os.path.exists(os.path.join(test_dir, "input.npy")):
            input_3d = np.load(os.path.join(test_dir, "input.npy"))
            if inp_last is None:
                inp_last = input_3d[:, -1, :]

        # mse
        if os.path.exists(os.path.join(test_dir, "mse.npy")):
            mse = np.load(os.path.join(test_dir, "mse.npy"))
        elif input_3d is not None and os.path.exists(os.path.join(test_dir, "pred.npy")):
            pred_3d = np.load(os.path.join(test_dir, "pred.npy"))
            mse = np.mean((input_3d - pred_3d) ** 2, axis=(1, 2))
        else:
            mse = anomaly_score.copy()

        # pred_label
        pred_label = np.load(os.path.join(test_dir, "pred_label.npy"))

        # Ground truth label if present
        label = None
        if os.path.exists(os.path.join(test_dir, "label.npy")):
            label = np.load(os.path.join(test_dir, "label.npy"))

        # Scoring parameters calculation as in main.py
        mean_label = np.mean(pred_label, axis=0)
        indices = np.where(mean_label > 0.05)[0]
        if 0 not in indices:
            indices = np.insert(indices, 0, 0)
        
        # CE raw score
        l_copy = np.copy(pred_label)
        l_copy[:, indices] = 0
        ce_score = np.sum(l_copy, axis=1)

        # Raw combined score: (mse + ce_score) / 2
        raw_score = (mse + ce_score) / 2.0

        # Percentile thresholds on raw scores
        th_995 = float(np.percentile(raw_score, 99.5))
        th_990 = float(np.percentile(raw_score, 99.0))
        th_950 = float(np.percentile(raw_score, 95.0))

        # Find peak anomaly window and normal window
        max_idx = int(np.argmax(anomaly_score))
        # Find a clean normal window (e.g. at 20th percentile)
        low_score_indices = np.where(anomaly_score < np.percentile(anomaly_score, 10))[0]
        normal_idx = int(low_score_indices[len(low_score_indices) // 2]) if len(low_score_indices) > 0 else 0

        # Statistics of features
        feat_min = np.min(inp_last, axis=0).tolist()
        feat_max = np.max(inp_last, axis=0).tolist()
        feat_median = np.median(inp_last, axis=0).tolist()

        data_dict = {
            "test_dir": test_dir,
            "length": len(anomaly_score),
            "anomaly_score": anomaly_score,
            "mse": mse,
            "pred_label": pred_label,
            "inp_last": inp_last,
            "input_3d": input_3d,
            "label": label,
            "indices": indices.tolist(),
            "mean_label": mean_label.tolist(),
            "raw_score": raw_score,
            "threshold_995": th_995,
            "threshold_990": th_990,
            "threshold_950": th_950,
            "default_threshold": th_995,
            "max_anomaly_idx": max_idx,
            "normal_idx": normal_idx,
            "feat_min": feat_min,
            "feat_max": feat_max,
            "feat_median": feat_median,
        }
        self.data_cache[key] = data_dict
        return data_dict

    def get_window(self, data_dict: Dict[str, Any], t: int) -> np.ndarray:
        """Returns window of shape (100, n_features) at time index t."""
        if data_dict["input_3d"] is not None:
            t_clamped = max(0, min(t, len(data_dict["input_3d"]) - 1))
            return data_dict["input_3d"][t_clamped]
        
        inp_last = data_dict["inp_last"]
        N, D = inp_last.shape
        t_clamped = max(0, min(t, N - 1))
        start = t_clamped - 99
        if start >= 0:
            return inp_last[start : t_clamped + 1]
        else:
            pad_count = -start
            pad = np.tile(inp_last[0:1], (pad_count, 1))
            actual = inp_last[0 : t_clamped + 1]
            return np.vstack([pad, actual])

    def predict_point(
        self,
        dataset: str,
        entity: str,
        seed: int,
        point: List[float],
        context_type: str = "sample_last",
        custom_history: Optional[List[List[float]]] = None,
        threshold_override: Optional[float] = None,
    ) -> Dict[str, Any]:
        model, params = self.load_model(dataset, entity, seed)
        data_dict = self.load_entity_data(dataset, entity, seed)

        D = params.n_features
        pt = np.array(point, dtype=np.float32).reshape(1, D)

        if context_type == "sample_last":
            # Last 99 points from entity
            if data_dict["input_3d"] is not None:
                context = data_dict["input_3d"][-1, 1:, :]
            else:
                context = data_dict["inp_last"][-99:, :]
                if len(context) < 99:
                    pad = np.tile(context[0:1], (99 - len(context), 1))
                    context = np.vstack([pad, context])
        elif context_type == "median":
            median = np.array(data_dict["feat_median"], dtype=np.float32).reshape(1, D)
            context = np.tile(median, (99, 1))
        elif context_type == "custom" and custom_history is not None:
            c_arr = np.array(custom_history, dtype=np.float32)
            if len(c_arr) >= 99:
                context = c_arr[-99:]
            else:
                pad = np.tile(c_arr[0:1], (99 - len(c_arr), 1))
                context = np.vstack([pad, c_arr])
        else:
            median = np.array(data_dict["feat_median"], dtype=np.float32).reshape(1, D)
            context = np.tile(median, (99, 1))

        window = np.vstack([context, pt]) # (100, D)
        window_tensor = torch.tensor(window, dtype=torch.float32).unsqueeze(0)

        with torch.no_grad():
            x_hat, x_out, _ = model(window_tensor)

        reconstructed = x_hat.squeeze(0).cpu().numpy()
        pred_probs = x_out.squeeze(0).cpu().numpy()

        # Raw MSE
        raw_mse = float(np.mean((window - reconstructed) ** 2))

        # Raw CE (exclude classes in indices)
        indices = set(data_dict["indices"])
        raw_ce = float(sum(pred_probs[j] for j in range(12) if j not in indices))
        raw_combined = float((raw_mse + raw_ce) / 2.0)

        # Threshold
        th = threshold_override if threshold_override is not None else data_dict["default_threshold"]
        is_anomaly = raw_combined > th

        # Top-3 labels from allowed classes (excluding indices)
        allowed_classes = [
            {"index": j, "label": ANOMALY_TYPES[j], "name_vi": PSEUDO_ANOMALY_INFO[j]["name_vi"], "prob": float(pred_probs[j])}
            for j in range(12) if j not in indices
        ]
        allowed_classes.sort(key=lambda x: x["prob"], reverse=True)
        top3 = allowed_classes[:3]

        # Determine winner pseudo anomaly group
        if is_anomaly:
            winner_idx = allowed_classes[0]["index"] if allowed_classes else int(np.argmax(pred_probs))
        else:
            winner_idx = 0
        winner_meta = PSEUDO_ANOMALY_INFO[winner_idx]
        predicted_group = {
            "index": winner_idx,
            "name": winner_meta["name"],
            "name_vi": winner_meta["name_vi"],
            "desc_vi": winner_meta["desc_vi"],
            "prob": float(pred_probs[winner_idx]),
            "is_anomaly": is_anomaly,
            "reason": (
                f"Đạt xác suất cao nhất ({pred_probs[winner_idx]*100:.1f}%) trong các lớp bất thường hợp lệ"
                if is_anomaly else "Điểm kết hợp thô nằm dưới ngưỡng phân vị 99,5%, tín hiệu ổn định."
            ),
        }

        # All 12 classes summary
        all_classes = []
        for j in range(12):
            meta = PSEUDO_ANOMALY_INFO[j]
            is_ex = j in indices
            r_str = ""
            if is_ex:
                r_str = "Lớp bình thường (luôn loại trừ)" if j == 0 else f"Xác suất trung bình toàn chuỗi ({data_dict['mean_label'][j]:.3f}) > ngưỡng 0,05"
            all_classes.append({
                "index": j,
                "name": meta["name"],
                "name_vi": meta["name_vi"],
                "desc_vi": meta["desc_vi"],
                "prob": float(pred_probs[j]),
                "excluded": is_ex,
                "reason": r_str,
                "is_winner": (j == winner_idx),
            })

        # Excluded classes explanation
        excluded_info = []
        for idx in sorted(list(indices)):
            label_name = ANOMALY_TYPES[idx]
            if idx == 0:
                reason = "Lớp bình thường (luôn loại trừ)"
            else:
                m_val = data_dict["mean_label"][idx]
                reason = f"Xác suất trung bình toàn chuỗi ({m_val:.3f}) > ngưỡng 0,05"
            excluded_info.append({
                "index": idx,
                "label": label_name,
                "prob": float(pred_probs[idx]),
                "reason": reason,
            })

        return {
            "raw_mse": raw_mse,
            "raw_ce": raw_ce,
            "raw_combined": raw_combined,
            "threshold": th,
            "is_anomaly": is_anomaly,
            "conclusion": "BẤT THƯỜNG" if is_anomaly else "BÌNH THƯỜNG",
            "predicted_group": predicted_group,
            "all_classes": all_classes,
            "top3": top3,
            "excluded_classes": excluded_info,
            "window_input": window.tolist(),
            "custom_window": window.tolist(),
            "reconstructed": reconstructed.tolist(),
            "new_point": point,
            "explanation": f"MSE đạt {raw_mse:.4f}, điểm phân loại {raw_ce:.4f}, ngưỡng {th:.4f} (phân vị 99,5).",
        }

    def explain(
        self,
        dataset: str,
        entity: str,
        seed: int,
        t: Optional[int] = None,
        custom_window: Optional[List[List[float]]] = None,
        point: Optional[List[float]] = None,
        is_custom_point: bool = False,
    ) -> Dict[str, Any]:
        model, params = self.load_model(dataset, entity, seed)
        data_dict = self.load_entity_data(dataset, entity, seed)
        indices = set(data_dict["indices"])

        # Comparison normal window
        normal_t = data_dict["normal_idx"]
        win_normal = self.get_window(data_dict, normal_t)

        if is_custom_point and custom_window is not None:
            win_target = np.array(custom_window, dtype=np.float32)
            t = 100
        else:
            if t is None:
                t = data_dict["max_anomaly_idx"]
            t = max(0, min(t, data_dict["length"] - 1))
            win_target = self.get_window(data_dict, t)

        # Forward hooks for intermediate activations (separate target vs normal)
        activations_target = {}
        activations_normal = {}
        hook_target_dict = [activations_target]
        hooks = []
        for i, blk in enumerate(model.encoder.network):
            def make_hook(name):
                def hook(m, inp, outp):
                    hook_target_dict[0][name] = outp.detach().cpu().numpy()
                return hook
            hooks.append(blk.register_forward_hook(make_hook(f"conv_{i}")))

        win_t_tensor = torch.tensor(win_target, dtype=torch.float32).unsqueeze(0)
        win_n_tensor = torch.tensor(win_normal, dtype=torch.float32).unsqueeze(0)

        with torch.no_grad():
            hook_target_dict[0] = activations_target
            x_hat_t, x_out_t, x_enc_t = model(win_t_tensor)
            hook_target_dict[0] = activations_normal
            x_hat_n, x_out_n, x_enc_n = model(win_n_tensor)

        for h in hooks:
            h.remove()

        rec_target = x_hat_t.squeeze(0).cpu().numpy()
        rec_normal = x_hat_n.squeeze(0).cpu().numpy()
        probs_target = x_out_t.squeeze(0).cpu().numpy()
        probs_normal = x_out_n.squeeze(0).cpu().numpy()
        emb_t_np = x_enc_t.squeeze().cpu().numpy()
        emb_n_np = x_enc_n.squeeze().cpu().numpy()
        embedding_target = emb_t_np.tolist()
        embedding_normal = emb_n_np.tolist()
        emb_l2_dist = float(np.linalg.norm(emb_t_np - emb_n_np))
        emb_denom = float(np.linalg.norm(emb_t_np) * np.linalg.norm(emb_n_np))
        emb_cosine = float(np.dot(emb_t_np, emb_n_np) / emb_denom) if emb_denom > 1e-8 else 1.0

        conv_energies_target = [
            float(np.mean(np.abs(activations_target.get(f"conv_{i}", np.zeros(1)))))
            for i in range(4)
        ]
        conv_energies_normal = [
            float(np.mean(np.abs(activations_normal.get(f"conv_{i}", np.zeros(1)))))
            for i in range(4)
        ]

        # Step 2: Conv shapes & Embedding
        conv_shapes = [
            {
                "layer": "Input Window",
                "sub": f"{params.n_features} channels × {params.n_time} steps",
                "shape": f"[1, {params.n_features}, {params.n_time}]",
                "raw_shape": f"[1, {params.n_time}, {params.n_features}]",
                "channels": params.n_features,
                "time_len": params.n_time,
                "role": "input",
            },
            {
                "layer": "ConvBlock 0 (k=4, s=2)",
                "sub": "128 channels × 51 steps",
                "shape": "[1, 128, 51]",
                "channels": 128,
                "time_len": 51,
                "role": "conv",
                "energy": round(conv_energies_target[0], 4),
                "energy_normal": round(conv_energies_normal[0], 4),
            },
            {
                "layer": "ConvBlock 1 (k=4, s=2)",
                "sub": "128 channels × 26 steps",
                "shape": "[1, 128, 26]",
                "channels": 128,
                "time_len": 26,
                "role": "conv",
                "energy": round(conv_energies_target[1], 4),
                "energy_normal": round(conv_energies_normal[1], 4),
            },
            {
                "layer": "ConvBlock 2 (k=4, s=2)",
                "sub": "256 channels × 14 steps",
                "shape": "[1, 256, 14]",
                "channels": 256,
                "time_len": 14,
                "role": "conv",
                "energy": round(conv_energies_target[2], 4),
                "energy_normal": round(conv_energies_normal[2], 4),
            },
            {
                "layer": "ConvBlock 3 (k=4, s=2)",
                "sub": "256 channels × 8 steps",
                "shape": "[1, 256, 8]",
                "channels": 256,
                "time_len": 8,
                "role": "conv",
                "energy": round(conv_energies_target[3], 4),
                "energy_normal": round(conv_energies_normal[3], 4),
            },
            {
                "layer": "MaxPool1D (8 → 1)",
                "sub": "Global Max Pooling",
                "shape": "[1, 256, 1]",
                "channels": 256,
                "time_len": 1,
                "role": "pool",
            },
            {
                "layer": "Conv1x1 → Embedding z",
                "sub": "Bottleneck → Decoder & Classifier",
                "shape": "[1, 128, 1]",
                "channels": 128,
                "time_len": 1,
                "role": "bottleneck",
            },
        ]
        conv_heatmap_summary = {}
        for k, v in activations_target.items():
            conv_heatmap_summary[k] = np.mean(np.abs(v[0]), axis=1).tolist()[:32]

        # Step 3: Decoder error per point
        err_sq_target = np.mean((win_target - rec_target) ** 2, axis=1).tolist()
        err_sq_normal = np.mean((win_normal - rec_normal) ** 2, axis=1).tolist()
        mse_target = float(np.mean(err_sq_target))
        mse_normal = float(np.mean(err_sq_normal))

        # Raw scores for target
        raw_mse_val = mse_target
        raw_ce_val = float(sum(probs_target[j] for j in range(12) if j not in indices))
        raw_comb_val = float((raw_mse_val + raw_ce_val) / 2.0)
        th = data_dict["default_threshold"]
        is_anomaly = raw_comb_val > th

        # Determine winner pseudo anomaly class
        if is_anomaly:
            allowed_cand = [j for j in range(12) if j not in indices]
            winner_idx = max(allowed_cand, key=lambda j: probs_target[j]) if allowed_cand else int(np.argmax(probs_target))
        else:
            winner_idx = 0
        winner_meta = PSEUDO_ANOMALY_INFO[winner_idx]

        # Step 4: Classifier
        classes_target = []
        classes_normal = []
        for j in range(12):
            is_ex = j in indices
            r_str = ""
            if is_ex:
                r_str = "Lớp bình thường" if j == 0 else f"Trung bình chuỗi ({data_dict['mean_label'][j]:.3f}) > 0.05"
            classes_target.append({
                "label": ANOMALY_TYPES[j],
                "name_vi": PSEUDO_ANOMALY_INFO[j]["name_vi"],
                "desc_vi": PSEUDO_ANOMALY_INFO[j]["desc_vi"],
                "prob": float(probs_target[j]),
                "excluded": is_ex,
                "reason": r_str,
                "is_winner": (j == winner_idx),
            })
            classes_normal.append({
                "label": ANOMALY_TYPES[j],
                "name_vi": PSEUDO_ANOMALY_INFO[j]["name_vi"],
                "desc_vi": PSEUDO_ANOMALY_INFO[j]["desc_vi"],
                "prob": float(probs_normal[j]),
                "excluded": is_ex,
                "reason": r_str,
                "is_winner": (j == 0),
            })

        plot_feat_idx = 0
        if is_custom_point and params.n_features > 1:
            last_sq_err = (win_target[-1] - rec_target[-1]) ** 2
            if float(np.max(last_sq_err)) > 1e-4:
                plot_feat_idx = int(np.argmax(last_sq_err))

        if is_custom_point:
            # Custom point mode: 100 points (1..100)
            time_axis = list(range(1, 101))
            input_slice = win_target[:, plot_feat_idx].tolist()
            # Step 5 slice: last 50 points of dataset + custom point
            history_len = min(50, len(data_dict["raw_score"]))
            score_slice_rec = data_dict["mse"][-history_len:].tolist() + [raw_mse_val]
            l_sub = np.copy(data_dict["pred_label"][-history_len:])
            l_sub[:, list(indices)] = 0
            score_slice_ce = np.sum(l_sub, axis=1).tolist() + [raw_ce_val]
            raw_slice_combined = data_dict["raw_score"][-history_len:].tolist() + [raw_comb_val]
            score_slice_final = data_dict["anomaly_score"][-history_len:].tolist() + [min(1.0, raw_comb_val / max(1e-5, th * 1.5))]
            final_rel_val = score_slice_final[-1]

            explanations = [
                f"Input Window 100 bước với điểm mới tại t=100 được đưa vào phân tích.",
                f"Bottleneck Embedding 128 chiều nén cửa sổ, L2 Distance Δz = {emb_l2_dist:.2f} (Cosine = {emb_cosine:.2f}).",
                f"Sai số tái tạo Decoder tại điểm nạp MSE = {mse_target:.4f} (chuẩn đối chứng: {mse_normal:.4f}).",
                f"Classifier phân loại điểm nạp vào lớp '{winner_meta['name_vi']}' với xác suất {probs_target[winner_idx]*100:.1f}%.",
                f"Combined Score = {raw_comb_val:.3f} ({'vượt ngưỡng ' + f'{th:.3f} -> Bất thường' if is_anomaly else 'dưới ngưỡng ' + f'{th:.3f} -> Bình thường'})."
            ]
        else:
            # Entity series mode
            slice_start = max(0, t - 150)
            slice_end = min(data_dict["length"], t + 150)
            time_axis = list(range(slice_start, slice_end))
            input_slice = data_dict["inp_last"][slice_start:slice_end, 0].tolist()

            score_slice_rec = data_dict["mse"][slice_start:slice_end].tolist()
            l_sub = np.copy(data_dict["pred_label"][slice_start:slice_end])
            l_sub[:, list(indices)] = 0
            score_slice_ce = np.sum(l_sub, axis=1).tolist()
            score_slice_final = data_dict["anomaly_score"][slice_start:slice_end].tolist()
            raw_slice_combined = data_dict["raw_score"][slice_start:slice_end].tolist()
            final_rel_val = float(data_dict["anomaly_score"][t])

            explanations = [
                f"Input Window 100 bước tại vị trí t={t} được tô sáng trên chuỗi dữ liệu gốc.",
                f"Bottleneck Embedding 128 chiều tại t={t}, L2 Distance so với chuẩn Δz = {emb_l2_dist:.2f} (Cosine = {emb_cosine:.2f}).",
                f"Sai số tái tạo Decoder MSE = {mse_target:.4f} ở cửa sổ khảo sát (cửa sổ chuẩn: {mse_normal:.4f}).",
                f"Classifier dự đoán xác suất 12 lớp Pseudo-Anomaly, lọc bỏ lớp Normal và FAA (> 0.05).",
                f"Combined Score = ({raw_mse_val:.3f} + {raw_ce_val:.3f})/2 = {raw_comb_val:.3f}, {'vượt' if is_anomaly else 'dưới'} ngưỡng P99.5 ({th:.3f})."
            ]

        return {
            "t": t,
            "normal_t": normal_t,
            "is_custom_point": is_custom_point,
            "plot_feature_idx": plot_feat_idx,
            "new_point": point,
            "winner_group": {
                "index": winner_idx,
                "name": winner_meta["name"],
                "name_vi": winner_meta["name_vi"],
                "desc_vi": winner_meta["desc_vi"],
                "prob": float(probs_target[winner_idx]),
                "is_anomaly": is_anomaly,
            },
            "window_size": params.n_time,
            "n_features": params.n_features,
            "time_slice": time_axis,
            "input_slice": input_slice,
            "win_target": win_target[:, plot_feat_idx].tolist(),
            "win_normal": win_normal[:, plot_feat_idx].tolist(),
            "rec_target": rec_target[:, plot_feat_idx].tolist(),
            "rec_normal": rec_normal[:, plot_feat_idx].tolist(),
            "err_sq_target": err_sq_target,
            "err_sq_normal": err_sq_normal,
            "mse_target": mse_target,
            "mse_normal": mse_normal,
            "conv_shapes": conv_shapes,
            "conv_heatmap": conv_heatmap_summary,
            "embedding": embedding_target,
            "embedding_normal": embedding_normal,
            "embedding_l2_dist": emb_l2_dist,
            "embedding_cosine": emb_cosine,
            "classes_target": classes_target,
            "classes_normal": classes_normal,
            "score_rec_slice": score_slice_rec,
            "score_ce_slice": score_slice_ce,
            "score_final_slice": score_slice_final,
            "raw_comb_slice": raw_slice_combined,
            "threshold": th,
            "raw_mse": float(raw_mse_val),
            "raw_ce": raw_ce_val,
            "raw_combined": raw_comb_val,
            "final_relative": final_rel_val,
            "explanations": explanations,
        }
