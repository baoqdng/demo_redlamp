// RedLamp Web Demo - Frontend Controller
document.addEventListener('DOMContentLoaded', () => {
  // App State
  let indexData = {};
  let currentDataset = 'smd';
  let currentEntity = '';
  let currentSeed = 0;
  let currentEntityMeta = null;
  let currentEntityDetail = null;
  let explainData = null;
  let currentStep = 0; // 0..4
  let seriesOverviewData = null;
  let lastPredictedWindow = null;
  let lastPredictedPoint = null;
  let lastPredictedResult = null;
  let isCustomPointExplain = false;

  // Charts
  let chartOverview = null;
  let chartPredict = null;
  let chartSlide1 = null;
  let chartSlide2 = null;
  let chartSlide3Target = null;
  let chartSlide3Normal = null;
  let chartSlide4Target = null;
  let chartSlide4Normal = null;
  let chartSlide5 = null;

  function initCharts() {
    chartOverview = new SimpleCanvasChart('canvas-overview');
    chartPredict = new SimpleCanvasChart('canvas-predict-window');
    chartSlide1 = new SimpleCanvasChart('canvas-slide-1');
    chartSlide2 = new SimpleCanvasChart('canvas-slide-2');
    chartSlide3Target = new SimpleCanvasChart('canvas-slide-3-target');
    chartSlide3Normal = new SimpleCanvasChart('canvas-slide-3-normal');
    chartSlide4Target = new SimpleCanvasChart('canvas-slide-4-target');
    chartSlide4Normal = new SimpleCanvasChart('canvas-slide-4-normal');
    chartSlide5 = new SimpleCanvasChart('canvas-slide-5');
  }

  // Loading Indicator Helpers
  let loadingCount = 0;
  function showLoading(title = 'Đang xử lý dữ liệu...', subtitle = 'Hệ thống đang nạp mô hình và tính toán, vui lòng chờ trong giây lát') {
    loadingCount++;
    const overlay = document.getElementById('app-loading-overlay');
    const titleEl = document.getElementById('loading-title');
    const subEl = document.getElementById('loading-subtitle');
    if (titleEl) titleEl.textContent = title;
    if (subEl) subEl.textContent = subtitle;
    if (overlay) overlay.style.display = 'flex';
  }

  function hideLoading() {
    loadingCount = Math.max(0, loadingCount - 1);
    if (loadingCount === 0) {
      const overlay = document.getElementById('app-loading-overlay');
      if (overlay) overlay.style.display = 'none';
    }
  }

  // API Call Helpers
  async function fetchJSON(url, options = {}) {
    try {
      const resp = await fetch(url, options);
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: resp.statusText }));
        throw new Error(err.detail || 'Lỗi kết nối máy chủ');
      }
      return await resp.json();
    } catch (e) {
      console.error('Fetch error:', e);
      throw e;
    }
  }

  // 1. Initial Load: /api/index
  async function loadIndex() {
    showLoading('Đang khởi tạo danh mục Dataset...', 'Đang đọc chỉ số đánh giá của 5 bộ dữ liệu chuẩn');
    try {
      indexData = await fetchJSON('/api/index');
      setupDatasetDropdown();
      // Select default dataset
      if (indexData['smd']) {
        currentDataset = 'smd';
      } else {
        currentDataset = Object.keys(indexData)[0];
      }
      document.getElementById('select-dataset').value = currentDataset;
      await updateEntityDropdown();
    } catch (e) {
      alert('Không thể nạp danh mục dataset: ' + e.message);
    } finally {
      hideLoading();
    }
  }

  function setupDatasetDropdown() {
    const sel = document.getElementById('select-dataset');
    sel.addEventListener('change', (e) => {
      currentDataset = e.target.value;
      updateEntityDropdown();
    });

    const searchInput = document.getElementById('input-search-entity');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        filterEntities(e.target.value);
      });
    }

    document.getElementById('select-entity').addEventListener('change', (e) => {
      currentEntity = e.target.value;
      onEntityChanged();
    });

    document.getElementById('select-seed').addEventListener('change', (e) => {
      currentSeed = parseInt(e.target.value, 10);
      onEntityChanged();
    });
  }

  function updateEntityDropdown(autoLoad = true) {
    const ents = indexData[currentDataset] || [];
    const sel = document.getElementById('select-entity');
    sel.innerHTML = '';
    ents.forEach(e => {
      const opt = document.createElement('option');
      opt.value = e.entity;
      opt.textContent = e.entity + (e.has_model ? '' : ' (chỉ có số liệu)');
      sel.appendChild(opt);
    });

    // Check multi-seed
    const isMultiSeed = ents.length > 0 ? ents[0].is_multi_seed : false;
    const seedGroup = document.getElementById('group-seed');
    if (isMultiSeed) {
      seedGroup.style.display = 'block';
    } else {
      seedGroup.style.display = 'none';
      currentSeed = 0;
    }

    if (ents.length > 0) {
      currentEntity = ents[0].entity;
      sel.value = currentEntity;
      if (autoLoad) {
        return onEntityChanged();
      }
    }
  }

  function filterEntities(query) {
    const q = query.toLowerCase().trim();
    const ents = indexData[currentDataset] || [];
    const sel = document.getElementById('select-entity');
    sel.innerHTML = '';
    const filtered = ents.filter(e => e.entity.toLowerCase().includes(q));
    filtered.forEach(e => {
      const opt = document.createElement('option');
      opt.value = e.entity;
      opt.textContent = e.entity + (e.has_model ? '' : ' (chỉ có số liệu)');
      sel.appendChild(opt);
    });
    if (filtered.length > 0) {
      currentEntity = filtered[0].entity;
      sel.value = currentEntity;
      onEntityChanged();
    }
  }

  // 2. Load Entity Details: /api/entity
  async function onEntityChanged() {
    if (!currentEntity) return;
    const st = document.getElementById('cfg-status');
    if (st) {
      st.innerHTML = '<span class="badge badge-loading">⏳ Đang tải &amp; nạp mô hình...</span>';
    }
    showLoading(
      `Đang nạp thực thể ${currentEntity} (Seed ${currentSeed})...`,
      'Đang tải dữ liệu chuỗi thời gian, checkpoint mô hình ConvAEC và tính toán giải thích'
    );
    try {
      const data = await fetchJSON(`/api/entity?dataset=${currentDataset}&entity=${currentEntity}&seed=${currentSeed}`);
      currentEntityMeta = data.meta;
      currentEntityDetail = data.detail;

      // Update Config UI
      document.getElementById('cfg-features').textContent = currentEntityMeta.n_features;
      document.getElementById('cfg-window').textContent = currentEntityMeta.window_size;
      document.getElementById('cfg-step').textContent = currentEntityMeta.window_step;
      document.getElementById('cfg-embedding').textContent = currentEntityMeta.embedding_dim;
      document.getElementById('cfg-path').textContent = currentEntityMeta.model_path || '(Chưa tải mô hình cục bộ)';

      // Update 3 Metrics
      updateMetricsDisplay();

      // Setup Point Inputs
      setupPointInputs(currentEntityMeta.n_features);

      // Load Overview Series Chart & Explain Data
      if (currentEntityMeta.has_model) {
        await Promise.all([
          loadSeriesOverview(),
          loadExplainData(null, false),
        ]);
        if (st) {
          st.innerHTML = '<span class="badge badge-success">Model đã nạp trong bộ nhớ</span>';
        }
      } else if (st) {
        st.innerHTML = '<span class="badge badge-danger">Chỉ có chỉ số kiểm nghiệm</span>';
      }
    } catch (e) {
      console.error(e);
      if (st) {
        st.innerHTML = '<span class="badge badge-danger">Lỗi nạp dữ liệu</span>';
      }
    } finally {
      hideLoading();
    }
  }

  function updateMetricsDisplay() {
    const meta = currentEntityMeta;
    if (!meta) return;

    const rocEl = document.getElementById('metric-vus-roc');
    const rocSub = document.getElementById('metric-vus-roc-sub');
    const prEl = document.getElementById('metric-vus-pr');
    const prSub = document.getElementById('metric-vus-pr-sub');
    const rfEl = document.getElementById('metric-rf');
    const rfSub = document.getElementById('metric-rf-sub');
    const subTitle = document.getElementById('metrics-subtitle');

    if (meta.is_multi_seed && meta.aggregate_metrics) {
      const agg = meta.aggregate_metrics;
      const seedVal = meta.per_seed_metrics[currentSeed] || { vus_roc: 0, vus_pr: 0, rf: 0 };

      subTitle.textContent = `Thực thể ${currentEntity} (Đang chọn Seed ${currentSeed}):`;
      rocEl.textContent = seedVal.vus_roc.toFixed(4);
      rocSub.textContent = `Trung bình 5 seed: ${agg.vus_roc_mean.toFixed(3)} ± ${agg.vus_roc_std.toFixed(3)}`;

      prEl.textContent = seedVal.vus_pr.toFixed(4);
      prSub.textContent = `Trung bình 5 seed: ${agg.vus_pr_mean.toFixed(3)} ± ${agg.vus_pr_std.toFixed(3)}`;

      rfEl.textContent = seedVal.rf.toFixed(4);
      rfSub.textContent = `Trung bình 5 seed: ${agg.rf_mean.toFixed(3)} ± ${agg.rf_std.toFixed(3)}`;
    } else if (meta.single_metrics) {
      subTitle.textContent = `Thực thể ${currentEntity} (Đánh giá chuẩn):`;
      rocEl.textContent = meta.single_metrics.vus_roc.toFixed(4);
      rocSub.textContent = 'Giá trị đơn từ thực nghiệm';

      prEl.textContent = meta.single_metrics.vus_pr.toFixed(4);
      prSub.textContent = 'Giá trị đơn từ thực nghiệm';

      rfEl.textContent = meta.single_metrics.rf.toFixed(4);
      rfSub.textContent = 'Giá trị đơn từ thực nghiệm';
    } else {
      rocEl.textContent = '--';
      prEl.textContent = '--';
      rfEl.textContent = '--';
    }
  }

  // 3. Load Series Overview
  async function loadSeriesOverview() {
    try {
      const data = await fetchJSON(`/api/series?dataset=${currentDataset}&entity=${currentEntity}&seed=${currentSeed}`);
      seriesOverviewData = data;
      renderOverviewChart();
    } catch (e) {
      console.warn('Overview not available:', e);
    }
  }

  function renderOverviewChart() {
    if (!chartOverview || !seriesOverviewData) return;
    const inputLine = {
      label: 'Chuỗi đo lường (Chiều 1)',
      data: seriesOverviewData.input_first_feature,
      color: '#334155', // dark gray
      width: 2,
    };
    const scoreLine = {
      label: 'Điểm bất thường tương đối',
      data: seriesOverviewData.anomaly_score,
      color: '#dc2626', // red
      width: 2,
    };
    chartOverview.drawLineChart([inputLine, scoreLine], {
      title: `Chuỗi dữ liệu & Điểm bất thường (${currentEntity})`,
      xLabel: 'Chỉ số thời gian (t)',
    });
  }

  // 4. Manual Point Prediction
  function setupPointInputs(nFeatures) {
    const container = document.getElementById('container-point-inputs');
    container.innerHTML = '';
    
    // Check if 1 feature or multi
    if (nFeatures === 1) {
      const inp = document.createElement('input');
      inp.type = 'number';
      inp.step = 'any';
      inp.className = 'form-control';
      inp.id = 'pt-feat-0';
      inp.placeholder = 'Ví dụ: 0.35';
      if (currentEntityDetail && currentEntityDetail.feat_median) {
        inp.value = parseFloat(currentEntityDetail.feat_median[0].toFixed(4));
      } else {
        inp.value = 0.5;
      }
      container.appendChild(inp);
    } else {
      const grid = document.createElement('div');
      grid.style.display = 'grid';
      grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(72px, 1fr))';
      grid.style.gap = '6px';
      grid.style.padding = '6px';
      grid.style.border = '1px solid #e2e8f0';
      grid.style.borderRadius = '6px';

      for (let i = 0; i < nFeatures; i++) {
        const wrap = document.createElement('div');
        wrap.innerHTML = `<small style="font-size:12px; font-weight:700; color:#334155;">D${i+1}</small>`;
        const inp = document.createElement('input');
        inp.type = 'number';
        inp.step = 'any';
        inp.className = 'form-control pt-feat';
        inp.dataset.idx = i;
        inp.style.fontSize = '14px';
        inp.style.height = '32px';
        inp.style.padding = '4px 6px';
        if (currentEntityDetail && currentEntityDetail.feat_median) {
          inp.value = parseFloat(currentEntityDetail.feat_median[i].toFixed(3));
        } else {
          inp.value = 0.1;
        }
        wrap.appendChild(inp);
        grid.appendChild(wrap);
      }
      container.appendChild(grid);
    }

    // Update threshold slider
    const slider = document.getElementById('slider-threshold');
    const valTh = document.getElementById('val-threshold');
    if (currentEntityDetail && currentEntityDetail.default_threshold) {
      const th = currentEntityDetail.default_threshold;
      slider.min = (th * 0.1).toFixed(4);
      slider.max = (th * 3.0).toFixed(4);
      slider.step = ((slider.max - slider.min) / 100).toFixed(5);
      slider.value = th.toFixed(4);
      valTh.textContent = th.toFixed(4) + ' (P99.5)';
    }

    slider.oninput = (e) => {
      valTh.textContent = parseFloat(e.target.value).toFixed(4);
    };

    document.getElementById('btn-reset-threshold').onclick = () => {
      if (currentEntityDetail && currentEntityDetail.default_threshold) {
        slider.value = currentEntityDetail.default_threshold.toFixed(4);
        valTh.textContent = slider.value + ' (P99.5)';
      }
    };

    document.getElementById('btn-fill-point-sample').onclick = () => {
      if (!currentEntityDetail || !currentEntityDetail.feat_median) return;
      if (nFeatures === 1) {
        document.getElementById('pt-feat-0').value = parseFloat(currentEntityDetail.feat_median[0].toFixed(4));
      } else {
        const inputs = document.querySelectorAll('.pt-feat');
        inputs.forEach(inp => {
          const idx = parseInt(inp.dataset.idx, 10);
          inp.value = parseFloat(currentEntityDetail.feat_median[idx].toFixed(3));
        });
      }
    };
  }

  // Radio toggle for context
  document.querySelectorAll('input[name="context-src"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      const customGroup = document.getElementById('group-custom-history');
      if (e.target.value === 'custom') {
        customGroup.style.display = 'block';
      } else {
        customGroup.style.display = 'none';
      }
    });
  });

  // Run Prediction
  document.getElementById('btn-run-predict').addEventListener('click', async () => {
    if (!currentEntityMeta.has_model) {
      alert('Entity này chưa có checkpoint model được tải về.');
      return;
    }

    const nFeatures = currentEntityMeta.n_features;
    let point = [];
    if (nFeatures === 1) {
      point = [parseFloat(document.getElementById('pt-feat-0').value || '0')];
    } else {
      const inputs = document.querySelectorAll('.pt-feat');
      inputs.forEach(inp => point.push(parseFloat(inp.value || '0')));
    }

    const contextType = document.querySelector('input[name="context-src"]:checked').value;
    let customHistory = null;
    if (contextType === 'custom') {
      const rawText = document.getElementById('textarea-custom-history').value.trim();
      const lines = rawText.split('\n');
      customHistory = lines.map(line => line.split(/[,\s]+/).map(v => parseFloat(v)).filter(v => !isNaN(v)));
    }

    const thOverride = parseFloat(document.getElementById('slider-threshold').value);
    const btnPredict = document.getElementById('btn-run-predict');
    const origBtnText = btnPredict.textContent;
    btnPredict.disabled = true;
    btnPredict.textContent = '⏳ Đang suy luận bất thường...';
    showLoading(
      'Đang dự đoán điểm dữ liệu mới...',
      `Đang chạy cửa sổ 100 điểm qua ConvAEC cho ${currentEntity} (Seed ${currentSeed})`
    );

    try {
      const res = await fetchJSON('/api/predict_point', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dataset: currentDataset,
          entity: currentEntity,
          seed: currentSeed,
          point: point,
          context_type: contextType,
          custom_history: customHistory,
          threshold_override: thOverride,
        }),
      });

      // Display results
      const badge = document.getElementById('badge-conclusion');
      const desc = document.getElementById('desc-conclusion');
      if (res.is_anomaly) {
        badge.className = 'conclusion-badge abnormal';
        badge.textContent = 'PHÁT HIỆN BẤT THƯỜNG';
        desc.textContent = `Điểm kết hợp thô (${res.raw_combined.toFixed(4)}) vượt ngưỡng quy định (${res.threshold.toFixed(4)}).`;
      } else {
        badge.className = 'conclusion-badge normal';
        badge.textContent = 'TRẠNG THÁI BÌNH THƯỜNG';
        desc.textContent = `Điểm kết hợp thô (${res.raw_combined.toFixed(4)}) nằm dưới ngưỡng an toàn (${res.threshold.toFixed(4)}).`;
      }

      document.getElementById('res-raw-mse').textContent = res.raw_mse.toFixed(4);
      document.getElementById('res-raw-ce').textContent = res.raw_ce.toFixed(4);
      document.getElementById('res-raw-comb').textContent = res.raw_combined.toFixed(4);
      document.getElementById('res-threshold').textContent = res.threshold.toFixed(4);

      // Top 3 classes
      const top3Container = document.getElementById('list-top3');
      top3Container.innerHTML = '';
      res.top3.forEach(c => {
        const pct = (c.prob * 100).toFixed(1);
        const item = document.createElement('div');
        item.className = 'top3-item';
        item.innerHTML = `
          <div>
            <strong>${c.label}</strong> (loại bất thường giả)
            <div class="prob-bar" style="width: ${Math.max(5, pct * 2)}px;"></div>
          </div>
          <div><strong>${pct}%</strong></div>
        `;
        top3Container.appendChild(item);
      });

      // Excluded classes
      const exContainer = document.getElementById('table-excluded-classes');
      let exHTML = '<table class="info-table"><tr><th>Lớp</th><th>Lý do loại khỏi CE score</th></tr>';
      res.excluded_classes.forEach(ex => {
        exHTML += `<tr><td><strong>${ex.label}</strong></td><td>${ex.reason}</td></tr>`;
      });
      exHTML += '</table>';
      exContainer.innerHTML = exHTML;

      // Save last prediction for Explainable Sync
      lastPredictedWindow = res.custom_window || res.window_input;
      lastPredictedPoint = res.new_point;
      lastPredictedResult = res;

      // Update 12 Pseudo Anomaly Classification Card
      const pseudoBadge = document.getElementById('badge-pseudo-winner');
      const pseudoDesc = document.getElementById('desc-pseudo-winner');
      if (res.predicted_group) {
        const pg = res.predicted_group;
        if (pg.is_anomaly) {
          pseudoBadge.style.background = '#dc2626';
          pseudoBadge.style.color = '#ffffff';
          pseudoBadge.textContent = `${pg.name_vi} (${pg.name}) - ${(pg.prob * 100).toFixed(1)}%`;
          pseudoDesc.innerHTML = `<strong>Dạng biến dạng giả lập:</strong> ${pg.desc_vi}<br><span style="color:#b91c1c; font-weight:600;">Lý do phân loại:</span> ${pg.reason}`;
        } else {
          pseudoBadge.style.background = '#16a34a';
          pseudoBadge.style.color = '#ffffff';
          pseudoBadge.textContent = `Bình thường (normal) - ${(pg.prob * 100).toFixed(1)}%`;
          pseudoDesc.innerHTML = `<strong>Trạng thái:</strong> ${pg.desc_vi}<br><span style="color:#15803d;">Lý do:</span> ${pg.reason}`;
        }
      }

      // Enable Sync Button
      const btnSync = document.getElementById('btn-sync-explain-point');
      if (btnSync) {
        btnSync.disabled = false;
        btnSync.style.boxShadow = '0 0 0 3px rgba(37, 99, 235, 0.4)';
      }

      // Draw Predict window reconstruction chart
      renderPredictWindowChart(res.window_input, res.reconstructed, res.raw_mse);
    } catch (e) {
      alert('Lỗi dự đoán: ' + e.message);
    } finally {
      btnPredict.disabled = false;
      btnPredict.textContent = origBtnText;
      hideLoading();
    }
  });

  // Sync Button Listener
  document.getElementById('btn-sync-explain-point').addEventListener('click', async () => {
    if (!lastPredictedWindow) return;
    // Switch to tab-explain
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === 'tab-explain'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === 'tab-explain'));

    isCustomPointExplain = true;
    await loadExplainCustomPoint();
  });

  async function loadExplainCustomPoint() {
    if (!lastPredictedWindow) return;
    showLoading(
      'Đang đồng bộ giải thích 5 bước cho điểm mới...',
      'Đang trích xuất đặc trưng Encoder, tái tạo Decoder và phân loại 12 lớp tại t=99'
    );
    try {
      explainData = await fetchJSON('/api/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dataset: currentDataset,
          entity: currentEntity,
          seed: currentSeed,
          custom_window: lastPredictedWindow,
          point: lastPredictedPoint,
          is_custom_point: true,
        }),
      });

      updateExplainModeBanner();
      goToStep(0);
    } catch (e) {
      alert('Không thể giải thích điểm này: ' + e.message);
    } finally {
      hideLoading();
    }
  }

  function updateExplainModeBanner() {
    const banner = document.getElementById('explain-mode-banner');
    const modeText = document.getElementById('explain-mode-text');
    const modeBadge = document.getElementById('explain-mode-badge');
    const btnBack = document.getElementById('btn-explain-back-to-series');
    const metaControls = document.querySelector('.step-meta-controls');

    if (!banner) return;
    if (isCustomPointExplain) {
      banner.style.background = '#fef2f2';
      banner.style.borderColor = '#fecaca';
      modeText.style.color = '#991b1b';
      modeText.innerHTML = `Đang giải thích: <strong>Điểm nạp thủ công (t=99)</strong>`;
      modeBadge.style.background = '#dc2626';
      modeBadge.textContent = explainData?.winner_group?.name_vi || 'Điểm nạp mới';
      if (btnBack) btnBack.style.display = 'inline-block';
      if (metaControls) metaControls.style.opacity = '0.35';
    } else {
      banner.style.background = '#e0f2fe';
      banner.style.borderColor = '#7dd3fc';
      modeText.style.color = '#0c4a6e';
      modeText.innerHTML = `Chuỗi dữ liệu mẫu của Entity <strong>${currentEntity}</strong>`;
      modeBadge.style.background = '#0284c7';
      modeBadge.textContent = 'Mẫu kiểm thử';
      if (btnBack) btnBack.style.display = 'none';
      if (metaControls) metaControls.style.opacity = '1.0';
    }
  }

  function renderPredictWindowChart(windowIn, windowRec, mseVal) {
    if (!chartPredict || !windowIn) return;
    const origData = windowIn.map(p => p[0]);
    const recData = windowRec.map(p => p[0]);

    chartPredict.drawLineChart([
      { label: 'Cửa sổ đầu vào (kèm điểm mới tại t=100)', data: origData, color: '#334155', width: 2 },
      { label: 'Chuỗi tái tạo Autoencoder', data: recData, color: '#2563eb', width: 2 },
    ], {
      title: 'Tái tạo cửa sổ 100 điểm & Điểm mới',
      xLabel: 'Thời gian trong cửa sổ (1 -> 100)',
      badgeText: `MSE = ${mseVal.toFixed(4)}`,
    });
  }

  // 5. Explainable 5-minute Mode
  async function loadExplainData(t = null, showOverlay = true) {
    if (!currentEntityMeta || !currentEntityMeta.has_model) return;
    if (showOverlay) {
      showLoading(
        t !== null ? `Đang tính toán giải thích tại cửa sổ t = ${t}...` : `Đang tải giải thích cho ${currentEntity}...`,
        'Đang trích xuất kích hoạt trung gian qua 4 khối ConvBlock, Decoder và Classifier'
      );
    }
    try {
      isCustomPointExplain = false;
      explainData = await fetchJSON('/api/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dataset: currentDataset,
          entity: currentEntity,
          seed: currentSeed,
          t: t,
        }),
      });

      // Update T slider
      const sliderT = document.getElementById('slider-explain-t');
      const lblT = document.getElementById('lbl-explain-t');
      sliderT.max = currentEntityDetail.length - 1;
      sliderT.value = explainData.t;
      lblT.textContent = explainData.t;

      updateExplainModeBanner();
      renderCurrentStep();
    } catch (e) {
      console.warn('Explain load failed:', e);
    } finally {
      if (showOverlay) hideLoading();
    }
  }

  function setupWalkthroughControls() {
    document.getElementById('btn-step-prev').onclick = () => {
      if (currentStep > 0) goToStep(currentStep - 1);
    };
    document.getElementById('btn-step-next').onclick = () => {
      if (currentStep < 4) goToStep(currentStep + 1);
    };

    document.querySelectorAll('.step-pill').forEach(pill => {
      pill.onclick = () => {
        goToStep(parseInt(pill.dataset.step, 10));
      };
    });

    const btnBackToSeries = document.getElementById('btn-explain-back-to-series');
    if (btnBackToSeries) {
      btnBackToSeries.onclick = () => {
        isCustomPointExplain = false;
        loadExplainData();
      };
    }

    // Keyboard navigation
    window.addEventListener('keydown', (e) => {
      const activeTab = document.querySelector('.tab-content.active');
      if (activeTab && activeTab.id === 'tab-explain') {
        if (e.key === 'ArrowRight' && currentStep < 4) {
          goToStep(currentStep + 1);
        } else if (e.key === 'ArrowLeft' && currentStep > 0) {
          goToStep(currentStep - 1);
        }
      }
    });

    // Slider T
    const sliderT = document.getElementById('slider-explain-t');
    sliderT.addEventListener('change', (e) => {
      loadExplainData(parseInt(e.target.value, 10));
    });

    document.getElementById('btn-explain-normal').onclick = () => {
      if (explainData) loadExplainData(explainData.normal_t);
    };

    document.getElementById('btn-explain-abnormal').onclick = () => {
      if (currentEntityDetail) loadExplainData(currentEntityDetail.max_anomaly_idx);
    };
  }

  function goToStep(stepIndex) {
    currentStep = stepIndex;
    document.querySelectorAll('.step-pill').forEach((p, idx) => {
      p.classList.toggle('active', idx === currentStep);
    });
    document.querySelectorAll('.explain-slide').forEach((s, idx) => {
      s.classList.toggle('active', idx === currentStep);
    });
    renderCurrentStep();
  }

  function renderCurrentStep() {
    if (!explainData) return;

    if (currentStep === 0) {
      if (explainData.is_custom_point) {
        const lastIdx = explainData.input_slice.length - 1;
        const ptVal = explainData.input_slice[lastIdx];
        chartSlide1.drawLineChart([
          { label: 'Cửa sổ 100 điểm (99 ngữ cảnh + 1 điểm nạp)', data: explainData.input_slice, color: '#334155', width: 2 }
        ], {
          title: 'Bước 1: Cửa sổ dữ liệu 100 điểm với Điểm nạp mới tại t=99',
          xLabel: 'Chỉ số bước thời gian trong cửa sổ (0 -> 99)',
          highlightWindow: [88, 99],
          badgeText: `Điểm nạp = ${ptVal.toFixed(3)}`,
          pointMarker: { index: lastIdx, value: ptVal, label: 'Điểm nạp mới (t=99)' },
        });
      } else {
        // Step 1: Input series slice with window highlighted
        const t = explainData.t;
        const sliceStart = explainData.time_slice[0];
        const winStartRel = t - sliceStart - 99;
        const winEndRel = t - sliceStart;

        chartSlide1.drawLineChart([
          { label: 'Chuỗi dữ liệu gốc', data: explainData.input_slice, color: '#334155', width: 2 }
        ], {
          title: `Bước 1: Chuỗi thời gian & Vùng cửa sổ 100 điểm khảo sát tại t=${t}`,
          xLabel: 'Thời gian (t)',
          highlightWindow: [winStartRel, winEndRel],
          badgeText: `Cửa sổ [${Math.max(0, t - 99)}, ${t}]`,
        });
      }
      document.getElementById('exp-text-1').textContent = explainData.explanations[0];
    } else if (currentStep === 1) {
      // Step 2: Encoder pipeline & Embedding bar chart
      const pipelineEl = document.getElementById('pipeline-shapes');
      pipelineEl.innerHTML = '';
      explainData.conv_shapes.forEach(n => {
        const div = document.createElement('div');
        div.className = 'pipeline-node';
        div.innerHTML = `<span class="layer-name">${n.layer}</span><span class="layer-shape">${n.shape}</span>`;
        pipelineEl.appendChild(div);
      });

      // Technical details
      const techEl = document.getElementById('conv-activation-summary');
      let techHTML = 'Năng lượng kích hoạt trung bình (Mean Activation Energy):<br>';
      for (const [k, v] of Object.entries(explainData.conv_heatmap)) {
        const avg = (v.reduce((a, b) => a + b, 0) / v.length).toFixed(4);
        techHTML += `<strong>${k}</strong>: ${avg} | `;
      }
      techEl.innerHTML = techHTML;

      // Embedding Bar Chart (10 bars)
      const embBars = explainData.embedding.map((val, i) => ({
        label: `d${i}`,
        value: val,
        color: val >= 0 ? '#2563eb' : '#dc2626',
      }));
      chartSlide2.drawBarChart(embBars, {
        title: explainData.is_custom_point ? 'Bước 2: Đặc trưng nén Embedding (Điểm nạp)' : 'Bước 2: Đặc trưng nén Embedding 10 chiều',
        xLabel: 'Chiều đặc trưng (0 -> 9)',
      });
      document.getElementById('exp-text-2').textContent = explainData.explanations[1];
    } else if (currentStep === 2) {
      // Step 3: Decoder Target vs Normal
      const isCustom = explainData.is_custom_point;
      const lastIdx = explainData.win_target.length - 1;
      chartSlide3Target.drawLineChart([
        { label: isCustom ? 'Gốc (kèm điểm nạp)' : 'Gốc', data: explainData.win_target, color: '#334155', width: 2 },
        { label: 'Tái tạo', data: explainData.rec_target, color: '#2563eb', width: 2 },
      ], {
        title: isCustom ? `Cửa sổ điểm nạp (MSE = ${explainData.mse_target.toFixed(4)})` : `Cửa sổ khảo sát (t=${explainData.t})`,
        xLabel: 'Thời gian cửa sổ',
        badgeText: `MSE = ${explainData.mse_target.toFixed(4)}`,
        pointMarker: isCustom ? { index: lastIdx, value: explainData.win_target[lastIdx], label: 'Điểm nạp' } : undefined,
      });
      document.getElementById('badge-mse-target').textContent = `MSE = ${explainData.mse_target.toFixed(4)}`;

      chartSlide3Normal.drawLineChart([
        { label: 'Gốc', data: explainData.win_normal, color: '#334155', width: 2 },
        { label: 'Tái tạo', data: explainData.rec_normal, color: '#2563eb', width: 2 },
      ], {
        title: `Cửa sổ bình thường đối chứng (t=${explainData.normal_t})`,
        xLabel: 'Thời gian cửa sổ',
        badgeText: `MSE = ${explainData.mse_normal.toFixed(4)}`,
      });
      document.getElementById('badge-mse-normal').textContent = `MSE = ${explainData.mse_normal.toFixed(4)}`;

      document.getElementById('exp-text-3').textContent = explainData.explanations[2];
    } else if (currentStep === 3) {
      // Step 4: Classifier 12 Classes Target vs Normal
      const isCustom = explainData.is_custom_point;
      const targetBars = explainData.classes_target.map((c, i) => {
        return {
          label: c.label,
          value: c.prob,
          isExcluded: c.excluded,
          isTop: c.is_winner,
        };
      });
      chartSlide4Target.drawBarChart(targetBars, {
        title: isCustom ? 'Phân loại 12 lớp (Cửa sổ điểm nạp)' : `Phân loại cửa sổ khảo sát (t=${explainData.t})`,
        badgeText: `Top: ${explainData.winner_group?.name_vi || targetBars.find(b => b.isTop)?.label || 'none'}`,
      });

      const normalBars = explainData.classes_normal.map((c, i) => {
        return {
          label: c.label,
          value: c.prob,
          isExcluded: c.excluded,
          isTop: c.is_winner,
        };
      });
      chartSlide4Normal.drawBarChart(normalBars, {
        title: `Phân loại cửa sổ bình thường đối chứng (t=${explainData.normal_t})`,
        badgeText: `Top: ${normalBars.find(b => b.isTop)?.label || 'none'}`,
      });

      document.getElementById('exp-text-4').textContent = explainData.explanations[3];
    } else if (currentStep === 4) {
      // Step 5: Combined score over time
      const isCustom = explainData.is_custom_point;
      chartSlide5.drawLineChart([
        { label: 'Điểm tái tạo (MSE)', data: explainData.score_rec_slice, color: '#334155', width: 2 },
        { label: 'Điểm phân loại (CE)', data: explainData.score_ce_slice, color: '#2563eb', width: 2 },
        { label: 'Điểm thô kết hợp', data: explainData.raw_comb_slice, color: '#dc2626', width: 2.5 },
      ], {
        title: isCustom ? 'Bước 5: Điểm kết hợp của điểm nạp so với lịch sử & Ngưỡng' : 'Bước 5: Điểm kết hợp theo thời gian (Reconstruction + Classification)',
        xLabel: 'Chỉ số mẫu thời gian',
        thresholdLine: explainData.threshold,
        badgeText: `Điểm nạp = ${explainData.raw_combined.toFixed(3)}`,
        pointMarker: isCustom ? { index: explainData.raw_comb_slice.length - 1, value: explainData.raw_combined, label: 'Điểm nạp mới' } : undefined,
      });

      // Update Formula Card
      const eqEl = document.getElementById('formula-equation');
      const conclusionBadge = explainData.raw_combined > explainData.threshold 
        ? '<span style="color:#dc2626; font-weight:bold;">BẤT THƯỜNG</span>' 
        : '<span style="color:#16a34a; font-weight:bold;">BÌNH THƯỜNG</span>';
      eqEl.innerHTML = `
        Điểm cuối = (Điểm tái tạo + Điểm phân loại) / 2
        = (${explainData.raw_mse.toFixed(4)} + ${explainData.raw_ce.toFixed(4)}) / 2 
        = <strong>${explainData.raw_combined.toFixed(4)}</strong>
        (Ngưỡng P99.5 = ${explainData.threshold.toFixed(4)} &rArr; ${conclusionBadge})
      `;

      document.getElementById('exp-text-5').textContent = explainData.explanations[4];
    }
  }

  // 6. Navigation Tabs
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      const targetId = btn.dataset.tab;
      document.getElementById(targetId).classList.add('active');

      // Trigger redraw of charts on tab display
      setTimeout(() => {
        if (targetId === 'tab-pretrain') renderOverviewChart();
        else if (targetId === 'tab-predict') {
          if (lastPredictedResult) {
            renderPredictWindowChart(lastPredictedResult.window_input, lastPredictedResult.reconstructed, lastPredictedResult.raw_mse);
          } else if (explainData && explainData.win_normal) {
            renderPredictWindowChart(
              explainData.win_normal.map(v => [v]),
              explainData.rec_normal.map(v => [v]),
              explainData.mse_normal
            );
          }
        }
        else if (targetId === 'tab-explain') renderCurrentStep();
      }, 50);
    });
  });

  window.addEventListener('resize', () => {
    const activeTab = document.querySelector('.tab-content.active');
    if (!activeTab) return;
    if (activeTab.id === 'tab-pretrain') renderOverviewChart();
    else if (activeTab.id === 'tab-predict' && lastPredictedResult) {
      renderPredictWindowChart(lastPredictedResult.window_input, lastPredictedResult.reconstructed, lastPredictedResult.raw_mse);
    } else if (activeTab.id === 'tab-explain') renderCurrentStep();
  });

  // Export PNG buttons
  document.getElementById('btn-export-overview').onclick = () => chartOverview && chartOverview.exportPNG(`overview_${currentEntity}.png`);
  document.getElementById('btn-export-predict-chart').onclick = () => chartPredict && chartPredict.exportPNG(`predict_${currentEntity}.png`);
  document.querySelectorAll('.btn-export').forEach(btn => {
    btn.onclick = () => {
      const cid = btn.dataset.canvas;
      const c = new SimpleCanvasChart(cid);
      c.exportPNG(`${cid}_${currentEntity}.png`);
    };
  });

  // Init
  initCharts();
  setupWalkthroughControls();
  loadIndex();
});

