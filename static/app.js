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
  let currentOverviewFeature = 'max_dev';
  let currentOverviewMetric = 'vus_pr';
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

  function closeEntityPicker() {
    const btn = document.getElementById('btn-entity-picker');
    const pop = document.getElementById('popover-entity-picker');
    if (btn) btn.classList.remove('open');
    if (pop) pop.style.display = 'none';
  }

  function syncEntityPickerDisplay() {
    const lbl = document.getElementById('lbl-entity-picker');
    const btnAll = document.getElementById('btn-entity-pick-all');
    const grid = document.getElementById('grid-entity-picker');
    const ents = getEntitiesWithAll(currentDataset);
    const curObj = ents.find(e => e.entity === currentEntity);

    if (lbl) {
      if (currentEntity === 'ALL') {
        lbl.textContent = 'ALL';
      } else if (curObj && !curObj.has_model) {
        lbl.textContent = `${currentEntity} (chỉ có số liệu)`;
      } else {
        lbl.textContent = currentEntity || 'ALL';
      }
    }
    if (btnAll) {
      btnAll.classList.toggle('active', currentEntity === 'ALL');
    }
    if (grid) {
      grid.querySelectorAll('[data-ent]').forEach(el => {
        el.classList.toggle('active', el.dataset.ent === currentEntity);
      });
    }
  }

  function renderEntityPickerGrid(filterQuery = '') {
    const grid = document.getElementById('grid-entity-picker');
    const countLbl = document.getElementById('lbl-entity-picker-count');
    if (!grid) return;

    const realEnts = getEntitiesWithAll(currentDataset).filter(e => e.entity !== 'ALL');
    const q = filterQuery.toLowerCase().trim();
    const filtered = q
      ? realEnts.filter(e => e.entity.toLowerCase().includes(q))
      : realEnts;

    const colClass = currentDataset === 'iops'
      ? 'cols-2'
      : (currentDataset === 'smd' ? 'cols-3' : 'cols-5');
    grid.className = `ep-chip-grid ${colClass}`;

    if (countLbl) {
      countLbl.textContent = q
        ? `Kết quả lọc: ${filtered.length} / ${realEnts.length} thực thể`
        : `Chọn thực thể cụ thể (${realEnts.length} thực thể)`;
    }

    if (filtered.length === 0) {
      grid.innerHTML = '<div class="ep-empty">Không tìm thấy thực thể phù hợp</div>';
      return;
    }

    let html = '';
    filtered.forEach(e => {
      const isAct = e.entity === currentEntity;
      const chipText = e.entity.startsWith('KPI-') ? `${e.entity.slice(0, 14)}…` : e.entity;
      const tipText = e.has_model ? e.entity : `${e.entity} (chỉ có chỉ số kiểm nghiệm)`;
      html += `<button type="button" class="ep-chip ${isAct ? 'active' : ''} ${!e.has_model ? 'metrics-only' : ''}" data-ent="${e.entity}" title="${tipText}">${chipText}</button>`;
    });
    grid.innerHTML = html;

    grid.querySelectorAll('[data-ent]').forEach(el => {
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const chosen = el.dataset.ent;
        closeEntityPicker();
        selectSpecificEntity(chosen);
      });
    });
  }

  function positionEntityPickerPopover(btn, pop) {
    const bRect = btn.getBoundingClientRect();
    pop.style.width = `${Math.round(Math.max(bRect.width, 350))}px`;
    const pRect = pop.getBoundingClientRect();
    let left = bRect.left;
    if (left + pRect.width > window.innerWidth - 10) {
      left = window.innerWidth - pRect.width - 10;
    }
    if (left < 10) left = 10;
    let top = bRect.bottom + 6;
    if (top + pRect.height > window.innerHeight - 10) {
      top = Math.max(10, bRect.top - pRect.height - 6);
    }
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(top)}px`;
  }

  function setupDatasetDropdown() {
    const sel = document.getElementById('select-dataset');
    sel.addEventListener('change', (e) => {
      closeEntityPicker();
      currentDataset = e.target.value;
      updateEntityDropdown();
    });

    const entSel = document.getElementById('select-entity');
    if (entSel) {
      entSel.addEventListener('change', (e) => {
        currentEntity = e.target.value;
        syncEntityPickerDisplay();
        onEntityChanged();
      });
    }

    const btnEnt = document.getElementById('btn-entity-picker');
    const popEnt = document.getElementById('popover-entity-picker');
    const wrapEnt = document.getElementById('wrap-entity-picker');
    const searchInp = document.getElementById('input-entity-picker-search');
    const btnAll = document.getElementById('btn-entity-pick-all');

    if (btnEnt && popEnt) {
      btnEnt.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = popEnt.style.display !== 'none';
        if (isOpen) {
          closeEntityPicker();
        } else {
          closeFeaturePicker();
          if (searchInp) searchInp.value = '';
          renderEntityPickerGrid('');
          syncEntityPickerDisplay();
          popEnt.style.display = 'block';
          btnEnt.classList.add('open');
          positionEntityPickerPopover(btnEnt, popEnt);
          if (searchInp) searchInp.focus();
          const actEl = popEnt.querySelector('.ep-chip.active');
          if (actEl) actEl.scrollIntoView({ block: 'nearest' });
        }
      });
    }

    if (searchInp) {
      searchInp.addEventListener('click', (e) => e.stopPropagation());
      searchInp.addEventListener('input', (e) => {
        renderEntityPickerGrid(e.target.value);
      });
      searchInp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const q = searchInp.value.toLowerCase().trim();
          if (q === 'all') {
            closeEntityPicker();
            selectSpecificEntity('ALL');
            return;
          }
          const firstChip = popEnt && popEnt.querySelector('.ep-chip[data-ent]');
          if (firstChip) {
            closeEntityPicker();
            selectSpecificEntity(firstChip.dataset.ent);
          }
        } else if (e.key === 'Escape') {
          closeEntityPicker();
        }
      });
    }

    if (btnAll) {
      btnAll.addEventListener('click', (e) => {
        e.stopPropagation();
        closeEntityPicker();
        selectSpecificEntity('ALL');
      });
    }

    document.addEventListener('click', (e) => {
      if (wrapEnt && !wrapEnt.contains(e.target)) {
        closeEntityPicker();
      }
    });

    document.getElementById('select-seed').addEventListener('change', (e) => {
      closeEntityPicker();
      currentSeed = parseInt(e.target.value, 10);
      onEntityChanged();
    });
  }

  function getEntitiesWithAll(ds) {
    const raw = indexData[ds] || [];
    if (raw.length > 0 && raw[0].entity !== 'ALL') {
      const rep = raw[0];
      return [{
        ...rep,
        entity: 'ALL',
        display_name: 'ALL',
        representative_entity: rep.entity,
        num_entities: raw.length,
      }, ...raw];
    }
    return raw.map(e => (e.entity === 'ALL' ? { ...e, display_name: 'ALL' } : e));
  }

  function updateEntityDropdown(autoLoad = true) {
    const ents = getEntitiesWithAll(currentDataset);
    const sel = document.getElementById('select-entity');
    if (sel) {
      sel.innerHTML = '';
      ents.forEach(e => {
        const opt = document.createElement('option');
        opt.value = e.entity;
        const label = e.display_name || e.entity;
        opt.textContent = label + (e.has_model ? '' : ' (chỉ có số liệu)');
        sel.appendChild(opt);
      });
    }

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
      if (sel) sel.value = currentEntity;
      renderEntityPickerGrid('');
      syncEntityPickerDisplay();
      if (autoLoad) {
        return onEntityChanged();
      }
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
      const baseModelPath = currentEntityMeta.model_path || '(Chưa tải mô hình cục bộ)';
      document.getElementById('cfg-path').textContent =
        (currentEntity === 'ALL' && currentEntityMeta.representative_entity)
          ? `${baseModelPath} (Mẫu đại diện: ${currentEntityMeta.representative_entity})`
          : baseModelPath;

      // Update 3 Metrics
      updateMetricsDisplay();

      // Setup Point Inputs & Overview Controls
      setupPointInputs(currentEntityMeta.n_features);
      setupOverviewControls(currentEntityMeta.n_features);

      // Load Overview Chart & Explain Data
      if (currentEntityMeta.has_model) {
        if (isAllComparisonMode()) {
          renderOverviewChart();
          await loadExplainData(null, false);
        } else {
          await Promise.all([
            loadSeriesOverview(),
            loadExplainData(null, false),
          ]);
        }
        if (st) {
          st.innerHTML = '<span class="badge badge-success">Model đã nạp trong bộ nhớ</span>';
        }
      } else {
        if (isAllComparisonMode()) {
          renderOverviewChart();
        }
        if (st) {
          st.innerHTML = '<span class="badge badge-danger">Chỉ có chỉ số kiểm nghiệm</span>';
        }
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

      if (currentEntity === 'ALL') {
        const nEnt = meta.num_entities || '';
        subTitle.textContent = `Trung bình toàn tập (${nEnt} thực thể — Đang chọn Seed ${currentSeed}):`;
        rocEl.textContent = seedVal.vus_roc.toFixed(4);
        rocSub.textContent = `Trung bình 5 seed: ${agg.vus_roc_mean.toFixed(3)} ± ${agg.vus_roc_std.toFixed(3)}`;

        prEl.textContent = seedVal.vus_pr.toFixed(4);
        prSub.textContent = `Trung bình 5 seed: ${agg.vus_pr_mean.toFixed(3)} ± ${agg.vus_pr_std.toFixed(3)}`;

        rfEl.textContent = seedVal.rf.toFixed(4);
        rfSub.textContent = `Trung bình 5 seed: ${agg.rf_mean.toFixed(3)} ± ${agg.rf_std.toFixed(3)}`;
      } else {
        subTitle.textContent = `Thực thể ${currentEntity} (Đang chọn Seed ${currentSeed}):`;
        rocEl.textContent = seedVal.vus_roc.toFixed(4);
        rocSub.textContent = `Trung bình 5 seed: ${agg.vus_roc_mean.toFixed(3)} ± ${agg.vus_roc_std.toFixed(3)}`;

        prEl.textContent = seedVal.vus_pr.toFixed(4);
        prSub.textContent = `Trung bình 5 seed: ${agg.vus_pr_mean.toFixed(3)} ± ${agg.vus_pr_std.toFixed(3)}`;

        rfEl.textContent = seedVal.rf.toFixed(4);
        rfSub.textContent = `Trung bình 5 seed: ${agg.rf_mean.toFixed(3)} ± ${agg.rf_std.toFixed(3)}`;
      }
    } else if (meta.single_metrics) {
      if (currentEntity === 'ALL') {
        subTitle.textContent = `Trung bình toàn tập (${meta.num_entities || 250} thực thể — Đánh giá chuẩn):`;
      } else {
        subTitle.textContent = `Thực thể ${currentEntity} (Đánh giá chuẩn):`;
      }
      rocEl.textContent = meta.single_metrics.vus_roc.toFixed(4);
      rocSub.textContent = 'Giá trị chuẩn từ thực nghiệm';

      prEl.textContent = meta.single_metrics.vus_pr.toFixed(4);
      prSub.textContent = 'Giá trị chuẩn từ thực nghiệm';

      rfEl.textContent = meta.single_metrics.rf.toFixed(4);
      rfSub.textContent = 'Giá trị chuẩn từ thực nghiệm';
    } else {
      rocEl.textContent = '--';
      prEl.textContent = '--';
      rfEl.textContent = '--';
    }
  }

  // 3. Overview Controls: All-Entities Comparison (ALL) vs Single-Entity Time Series
  function isAllComparisonMode() {
    return Boolean(currentEntity === 'ALL' && currentEntityMeta && currentEntityMeta.is_multi_seed);
  }

  function selectSpecificEntity(entName) {
    if (!entName) return;
    SimpleCanvasChart.hideTooltip();
    closeEntityPicker();
    const sel = document.getElementById('select-entity');
    if (sel) {
      const hasOpt = Array.from(sel.options).some(o => o.value === entName);
      if (!hasOpt) {
        updateEntityDropdown(false);
      }
      sel.value = entName;
    }
    currentEntity = entName;
    syncEntityPickerDisplay();
    onEntityChanged();
  }

  function compactEntityLabel(name) {
    if (!name) return '';
    if (name.startsWith('machine-')) return 'm' + name.slice('machine-'.length);
    if (name.startsWith('KPI-')) return name.slice(0, 8);
    return name.length > 10 ? name.slice(0, 9) + '…' : name;
  }

  function closeFeaturePicker() {
    const btn = document.getElementById('btn-feature-picker');
    const pop = document.getElementById('popover-feature-picker');
    if (btn) btn.classList.remove('open');
    if (pop) pop.style.display = 'none';
  }

  function formatFeaturePickerLabel(val, nFeatures) {
    if (val === 'max_dev') return `Độ lệch Max (${nFeatures} kênh)`;
    if (val === 'mean') return `Trung bình (${nFeatures} kênh)`;
    const idx = parseInt(val, 10) || 0;
    return `Đặc trưng D${idx + 1}`;
  }

  function positionFeaturePickerPopover(btn, pop) {
    const bRect = btn.getBoundingClientRect();
    const pRect = pop.getBoundingClientRect();
    let left = bRect.right - pRect.width;
    if (left < 10) left = 10;
    if (left + pRect.width > window.innerWidth - 10) {
      left = window.innerWidth - pRect.width - 10;
    }
    let top = bRect.bottom + 6;
    if (top + pRect.height > window.innerHeight - 10) {
      top = Math.max(10, bRect.top - pRect.height - 6);
    }
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(top)}px`;
  }

  let featurePickerEventsBound = false;
  function bindFeaturePickerGlobalEvents() {
    if (featurePickerEventsBound) return;
    featurePickerEventsBound = true;

    const btn = document.getElementById('btn-feature-picker');
    const pop = document.getElementById('popover-feature-picker');
    const wrap = document.getElementById('wrap-feature-picker');

    if (btn && pop) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = pop.style.display !== 'none';
        if (isOpen) {
          closeFeaturePicker();
        } else {
          closeEntityPicker();
          pop.style.display = 'block';
          btn.classList.add('open');
          positionFeaturePickerPopover(btn, pop);
        }
      });
    }

    document.addEventListener('click', (e) => {
      if (wrap && !wrap.contains(e.target)) {
        closeFeaturePicker();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeFeaturePicker();
        closeEntityPicker();
      }
    });
  }

  function setupOverviewControls(nFeatures) {
    bindFeaturePickerGlobalEvents();
    closeFeaturePicker();

    const titleEl = document.getElementById('overview-card-title');
    const grpMetric = document.getElementById('group-overview-metric');
    const selMetric = document.getElementById('select-overview-metric');
    const grpFeat = document.getElementById('group-overview-feature');
    const lblFeat = document.getElementById('lbl-feature-picker');
    const popFeat = document.getElementById('popover-feature-picker');

    const allComp = isAllComparisonMode();

    if (titleEl) {
      titleEl.textContent = allComp
        ? 'So sánh chỉ số đánh giá giữa các thực thể trong tập dữ liệu'
        : `Tổng quan toàn bộ chuỗi thời gian của Entity (${currentEntity === 'ALL' && currentEntityMeta?.representative_entity ? currentEntityMeta.representative_entity : currentEntity})`;
    }

    if (grpMetric && selMetric) {
      grpMetric.style.display = allComp ? 'flex' : 'none';
      selMetric.value = currentOverviewMetric;
      selMetric.onchange = (e) => {
        currentOverviewMetric = e.target.value;
        renderOverviewChart();
      };
    }

    if (!grpFeat || !lblFeat || !popFeat) return;
    if (allComp || nFeatures <= 1) {
      grpFeat.style.display = 'none';
      if (nFeatures <= 1) currentOverviewFeature = '0';
      return;
    }

    grpFeat.style.display = 'flex';
    const prevVal = currentOverviewFeature;
    const parsedPrev = parseInt(prevVal, 10);
    const validNumeric = !isNaN(parsedPrev) && parsedPrev >= 0 && parsedPrev < nFeatures;
    const validSummary = prevVal === 'max_dev' || prevVal === 'mean';
    currentOverviewFeature = validSummary ? prevVal : (validNumeric ? String(parsedPrev) : 'max_dev');
    lblFeat.textContent = formatFeaturePickerLabel(currentOverviewFeature, nFeatures);

    let chipsHtml = '';
    for (let i = 0; i < nFeatures; i++) {
      const valStr = String(i);
      const isAct = currentOverviewFeature === valStr;
      chipsHtml += `<button type="button" class="fp-chip ${isAct ? 'active' : ''}" data-feat="${valStr}">D${i + 1}</button>`;
    }

    popFeat.innerHTML = `
      <div class="fp-section-title">Tổng hợp đa kênh (${nFeatures} đặc trưng)</div>
      <div class="fp-summary-list">
        <button type="button" class="fp-summary-btn ${currentOverviewFeature === 'max_dev' ? 'active' : ''}" data-feat="max_dev">
          <span>Độ lệch lớn nhất</span>
          <span class="fp-summary-tag">Max |x - med|</span>
        </button>
        <button type="button" class="fp-summary-btn ${currentOverviewFeature === 'mean' ? 'active' : ''}" data-feat="mean">
          <span>Trung bình cộng</span>
          <span class="fp-summary-tag">Mean D1..D${nFeatures}</span>
        </button>
      </div>
      <div class="fp-section-title">Chọn đặc trưng riêng lẻ (D1 – D${nFeatures})</div>
      <div class="fp-chip-grid">${chipsHtml}</div>
    `;

    popFeat.querySelectorAll('[data-feat]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const chosen = el.dataset.feat;
        currentOverviewFeature = chosen;
        lblFeat.textContent = formatFeaturePickerLabel(chosen, nFeatures);
        popFeat.querySelectorAll('[data-feat]').forEach(item => {
          item.classList.toggle('active', item.dataset.feat === chosen);
        });
        closeFeaturePicker();
        loadSeriesOverview();
      });
    });
  }

  async function loadSeriesOverview() {
    try {
      const featParam = (currentEntityMeta && currentEntityMeta.n_features > 1)
        ? currentOverviewFeature
        : '0';
      const data = await fetchJSON(
        `/api/series?dataset=${currentDataset}&entity=${currentEntity}&seed=${currentSeed}&feature=${encodeURIComponent(featParam)}`
      );
      seriesOverviewData = data;
      renderOverviewChart();
    } catch (e) {
      console.warn('Overview not available:', e);
    }
  }

  function jumpToExplainAt(realT) {
    if (typeof realT !== 'number' || isNaN(realT)) return;
    SimpleCanvasChart.hideTooltip();
    document.querySelectorAll('.tab-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === 'tab-explain');
    });
    document.querySelectorAll('.tab-content').forEach(c => {
      c.classList.toggle('active', c.id === 'tab-explain');
    });
    isCustomPointExplain = false;
    loadExplainData(realT, true);
  }

  function renderAllEntitiesComparisonChart() {
    if (!chartOverview) return;
    const realEnts = (indexData[currentDataset] || []).filter(e => e.entity !== 'ALL');
    if (realEnts.length === 0) return;

    const metricInfoMap = {
      vus_pr: { label: 'VUS-PR', meanKey: 'vus_pr_mean', stdKey: 'vus_pr_std' },
      vus_roc: { label: 'VUS-ROC', meanKey: 'vus_roc_mean', stdKey: 'vus_roc_std' },
      rf: { label: 'RF (Range F-score)', meanKey: 'rf_mean', stdKey: 'rf_std' },
    };
    const mInfo = metricInfoMap[currentOverviewMetric] || metricInfoMap.vus_pr;
    const dsLabelMap = {
      smd: 'SMD',
      iops: 'AIOps / IOPS',
      msl: 'MSL',
      smap: 'SMAP',
      anomaly_archive: 'UCR',
    };
    const dsTitle = dsLabelMap[currentDataset] || currentDataset.toUpperCase();

    const vals = realEnts.map(e => {
      const sm = e.per_seed_metrics && e.per_seed_metrics[currentSeed];
      return sm ? (sm[currentOverviewMetric] ?? 0) : 0;
    });
    const datasetMean = (currentEntityMeta && currentEntityMeta.per_seed_metrics && currentEntityMeta.per_seed_metrics[currentSeed])
      ? (currentEntityMeta.per_seed_metrics[currentSeed][currentOverviewMetric] ?? 0)
      : (vals.reduce((a, b) => a + b, 0) / vals.length);

    let bestIdx = 0;
    for (let i = 1; i < vals.length; i++) {
      if (vals[i] > vals[bestIdx]) bestIdx = i;
    }

    const bars = realEnts.map((e, i) => {
      const v = vals[i];
      return {
        label: compactEntityLabel(e.entity),
        clickValue: e.entity,
        value: v,
        isTop: i === bestIdx,
        topColor: '#15803d',
        color: v >= datasetMean ? '#2563eb' : '#93c5fd',
      };
    });

    chartOverview.drawBarChart(bars, {
      title: `Phân bố ${mInfo.label} trên ${realEnts.length} thực thể tập ${dsTitle} (Seed ${currentSeed})`,
      xLabel: 'Thực thể (Entity)',
      valueFormat: 'decimal',
      meanLine: {
        value: datasetMean,
        label: `Trung bình toàn tập (${dsTitle}): ${datasetMean.toFixed(4)}`,
        color: '#dc2626',
      },
      badgeText: `Cao nhất: ${compactEntityLabel(realEnts[bestIdx].entity)} (${vals[bestIdx].toFixed(3)})`,
      onPointClick: (_idx, entName) => selectSpecificEntity(entName),
      tooltipFormatter: (idx) => {
        const e = realEnts[idx];
        if (!e) return '';
        const sm = (e.per_seed_metrics && e.per_seed_metrics[currentSeed]) || { vus_roc: 0, vus_pr: 0, rf: 0 };
        const agg = e.aggregate_metrics || {};
        const curVal = sm[currentOverviewMetric] ?? 0;
        const mean5 = agg[mInfo.meanKey] ?? curVal;
        const std5 = agg[mInfo.stdKey] ?? 0;
        const isAbove = curVal >= datasetMean;
        const pill = idx === bestIdx
          ? '<span class="tt-pill ok">★ Cao nhất tập</span>'
          : (isAbove ? '<span class="tt-pill info">≥ Trung bình tập</span>' : '<span class="tt-pill muted">&lt; Trung bình tập</span>');
        return `
          <div class="tt-header"><span>Entity: ${e.entity}</span>${pill}</div>
          <div class="tt-row">
            <span class="tt-label"><span class="tt-dot" style="background:${idx === bestIdx ? '#15803d' : (isAbove ? '#2563eb' : '#93c5fd')}"></span>${mInfo.label} (Seed ${currentSeed})</span>
            <span class="tt-val">${curVal.toFixed(4)}</span>
          </div>
          <div class="tt-row">
            <span class="tt-label">Trung bình 5 seed</span>
            <span class="tt-val">${mean5.toFixed(3)} ± ${std5.toFixed(3)}</span>
          </div>
          <div class="tt-row">
            <span class="tt-label">Đủ 3 chỉ số (Seed ${currentSeed})</span>
            <span class="tt-val">ROC ${sm.vus_roc.toFixed(3)} · PR ${sm.vus_pr.toFixed(3)} · RF ${sm.rf.toFixed(3)}</span>
          </div>
          <div class="tt-hint">🖱️ Double-click cột này để xem chuỗi thời gian của ${e.entity}</div>
        `;
      },
    });
  }

  function renderOverviewChart() {
    if (!chartOverview) return;
    if (isAllComparisonMode()) {
      renderAllEntitiesComparisonChart();
      return;
    }
    if (!seriesOverviewData) return;
    const nFeat = (currentEntityMeta && currentEntityMeta.n_features) ? currentEntityMeta.n_features : 1;
    let inputLabel = 'Tín hiệu chuỗi thời gian gốc';
    let shortFeatLabel = 'Tín hiệu gốc';
    if (nFeat > 1) {
      if (currentOverviewFeature === 'max_dev') {
        inputLabel = `Độ lệch lớn nhất trên ${nFeat} đặc trưng (Max |x - median|)`;
        shortFeatLabel = `Độ lệch lớn nhất (${nFeat} kênh)`;
      } else if (currentOverviewFeature === 'mean') {
        inputLabel = `Tín hiệu trung bình ${nFeat} đặc trưng (Mean D1..D${nFeat})`;
        shortFeatLabel = `Trung bình ${nFeat} kênh`;
      } else {
        const idx = parseInt(currentOverviewFeature, 10) || 0;
        inputLabel = `Tín hiệu gốc (Đặc trưng D${idx + 1} / ${nFeat} đặc trưng)`;
        shortFeatLabel = `Tín hiệu gốc (D${idx + 1})`;
      }
    }
    const inputLine = {
      label: inputLabel,
      data: seriesOverviewData.input_first_feature,
      color: '#334155', // dark slate blue
      width: 2,
    };
    const scoreLine = {
      label: 'Điểm bất thường tương đối',
      data: seriesOverviewData.anomaly_score,
      color: '#dc2626', // red
      width: 2,
    };
    const chartEntityLabel =
      (currentEntity === 'ALL' && currentEntityMeta && currentEntityMeta.representative_entity)
        ? `ALL — Chuỗi mẫu đại diện: ${currentEntityMeta.representative_entity}`
        : currentEntity;
    const indices = seriesOverviewData.indices || [];
    const domFeats = seriesOverviewData.dominant_feature || null;
    const th = seriesOverviewData.threshold;

    chartOverview.drawLineChart([inputLine, scoreLine], {
      title: `Chuỗi dữ liệu & Điểm bất thường (${chartEntityLabel})`,
      xLabel: 'Chỉ số thời gian (t)',
      xValues: indices,
      onPointClick: (_idx, realT) => jumpToExplainAt(realT),
      tooltipFormatter: (idx) => {
        const realT = indices[idx] !== undefined ? indices[idx] : idx;
        const sigVal = seriesOverviewData.input_first_feature[idx];
        const relVal = seriesOverviewData.anomaly_score[idx];
        const rawVal = seriesOverviewData.raw_score ? seriesOverviewData.raw_score[idx] : null;
        const domCh = (domFeats && domFeats[idx]) ? ` (tại D${domFeats[idx]})` : '';
        const isAnom = (rawVal !== null && th !== undefined) ? (rawVal > th) : (relVal > 0.5);
        const pill = isAnom
          ? '<span class="tt-pill anom">⚠️ Bất thường (&gt; P99.5)</span>'
          : '<span class="tt-pill ok">✓ Bình thường</span>';
        const rawRow = (rawVal !== null && th !== undefined)
          ? `
            <div class="tt-row">
              <span class="tt-label">Raw Combined / P99.5</span>
              <span class="tt-val">${rawVal.toFixed(4)} / ${th.toFixed(4)}</span>
            </div>
          `
          : '';
        return `
          <div class="tt-header"><span>Vị trí t = ${realT}</span>${pill}</div>
          <div class="tt-row">
            <span class="tt-label"><span class="tt-dot" style="background:#334155"></span>${shortFeatLabel}</span>
            <span class="tt-val">${sigVal !== undefined ? sigVal.toFixed(4) + domCh : '--'}</span>
          </div>
          <div class="tt-row">
            <span class="tt-label"><span class="tt-dot" style="background:#dc2626"></span>Điểm tương đối [0, 1]</span>
            <span class="tt-val">${relVal !== undefined ? relVal.toFixed(4) : '--'}</span>
          </div>
          ${rawRow}
          <div class="tt-hint">🖱️ Double-click để mở Giải thích mô hình tại t = ${realT}</div>
        `;
      },
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
        badge.textContent = 'BẤT THƯỜNG';
        desc.textContent = `Raw Combined (${res.raw_combined.toFixed(4)}) > Threshold (${res.threshold.toFixed(4)})`;
      } else {
        badge.className = 'conclusion-badge normal';
        badge.textContent = 'BÌNH THƯỜNG';
        desc.textContent = `Raw Combined (${res.raw_combined.toFixed(4)}) < Threshold (${res.threshold.toFixed(4)})`;
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
          <div class="top3-item-info">
            <strong>${c.name_vi || c.label}</strong>
            <div class="prob-bar" style="width: ${Math.max(5, pct * 2)}px;"></div>
          </div>
          <div class="top3-item-pct"><strong>${pct}%</strong></div>
        `;
        top3Container.appendChild(item);
      });

      // Excluded classes
      const exContainer = document.getElementById('table-excluded-classes');
      let exHTML = '<table class="info-table"><tr><th>Lớp</th><th>Lý do lọc bởi FAA</th></tr>';
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
          pseudoBadge.textContent = `${pg.name_vi} (${(pg.prob * 100).toFixed(1)}%)`;
          pseudoDesc.innerHTML = `<strong>Hình thái:</strong> ${pg.desc_vi}<br><span style="color:#b91c1c; font-weight:600;">Cơ sở:</span> ${pg.reason}`;
        } else {
          pseudoBadge.style.background = '#16a34a';
          pseudoBadge.style.color = '#ffffff';
          pseudoBadge.textContent = `${pg.name_vi} (${(pg.prob * 100).toFixed(1)}%)`;
          pseudoDesc.innerHTML = `<strong>Trạng thái:</strong> ${pg.desc_vi}<br><span style="color:#15803d;">Cơ sở:</span> ${pg.reason}`;
        }
      }

      // Enable Sync Button
      const btnSync = document.getElementById('btn-sync-explain-point');
      if (btnSync) {
        btnSync.disabled = false;
        btnSync.style.boxShadow = '0 0 0 3px rgba(37, 99, 235, 0.35)';
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
      'Đang trích xuất đặc trưng Encoder, tái tạo Decoder và phân loại 12 lớp tại t=100'
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
      modeText.innerHTML = `Điểm nạp: <strong>t = 100</strong>`;
      modeText.title = 'Đang giải thích điểm nạp thủ công tại t = 100';
      if (modeBadge) {
        modeBadge.style.display = 'inline-block';
        modeBadge.style.background = '#dc2626';
        modeBadge.textContent = explainData?.winner_group?.name_vi || 'Điểm nạp mới';
      }
      if (btnBack) btnBack.style.display = 'inline-block';
      if (metaControls) metaControls.style.opacity = '0.35';
    } else {
      banner.style.background = '#e0f2fe';
      banner.style.borderColor = '#7dd3fc';
      modeText.style.color = '#0c4a6e';
      const isAll = currentEntity === 'ALL' && currentEntityMeta && currentEntityMeta.representative_entity;
      const fullEnt = isAll ? currentEntityMeta.representative_entity : currentEntity;
      modeText.innerHTML = isAll
        ? `Mẫu (ALL): <strong>${fullEnt}</strong>`
        : `Entity: <strong>${fullEnt}</strong>`;
      modeText.title = isAll
        ? `Mẫu đại diện khi chọn ALL: ${fullEnt}`
        : `Chuỗi kiểm thử của Entity: ${fullEnt}`;
      if (modeBadge) modeBadge.style.display = 'none';
      if (btnBack) btnBack.style.display = 'none';
      if (metaControls) metaControls.style.opacity = '1.0';
    }
  }

  function renderPredictWindowChart(windowIn, windowRec, mseVal) {
    if (!chartPredict || !windowIn) return;
    const nFeat = (windowIn[0] && windowIn[0].length) ? windowIn[0].length : 1;
    let featIdx = 0;
    if (nFeat > 1 && windowRec && windowRec.length === windowIn.length) {
      const lastRow = windowIn.length - 1;
      let maxErr = -1;
      for (let f = 0; f < nFeat; f++) {
        const diff = (windowIn[lastRow][f] ?? 0) - (windowRec[lastRow][f] ?? 0);
        const sq = diff * diff;
        if (sq > maxErr) {
          maxErr = sq;
          featIdx = f;
        }
      }
      if (maxErr <= 1e-4) featIdx = 0;
    }
    const origData = windowIn.map(p => p[featIdx] ?? p[0]);
    const recData = windowRec.map(p => p[featIdx] ?? p[0]);
    const featTag = nFeat > 1 ? ` — D${featIdx + 1}` : '';
    const xSteps = Array.from({ length: origData.length }, (_, i) => i + 1);
    const lastIdx = origData.length - 1;

    chartPredict.drawLineChart([
      { label: `Đầu vào (kèm t=100${featTag})`, data: origData, color: '#334155', width: 2 },
      { label: `Tái tạo Autoencoder${featTag}`, data: recData, color: '#2563eb', width: 2 },
    ], {
      title: `Cửa sổ 100 điểm & chuỗi tái tạo${featTag}`,
      xLabel: 'Thời gian trong cửa sổ (1 -> 100)',
      xValues: xSteps,
      badgeText: `MSE = ${mseVal.toFixed(4)}`,
      pointMarker: lastIdx >= 0 ? { index: lastIdx, value: origData[lastIdx], label: 'Điểm mới (t=100)' } : undefined,
      tooltipFormatter: (idx) => {
        const stepNum = idx + 1;
        const vOrig = origData[idx] ?? 0;
        const vRec = recData[idx] ?? 0;
        const sqErr = (vOrig - vRec) * (vOrig - vRec);
        const pill = idx === lastIdx
          ? '<span class="tt-pill anom">Điểm nạp mới (t=100)</span>'
          : '<span class="tt-pill muted">Ngữ cảnh lịch sử</span>';
        return `
          <div class="tt-header"><span>Bước t = ${stepNum} / ${origData.length}</span>${pill}</div>
          <div class="tt-row">
            <span class="tt-label"><span class="tt-dot" style="background:#334155"></span>Tín hiệu gốc</span>
            <span class="tt-val">${vOrig.toFixed(4)}</span>
          </div>
          <div class="tt-row">
            <span class="tt-label"><span class="tt-dot" style="background:#2563eb"></span>Tái tạo Decoder</span>
            <span class="tt-val">${vRec.toFixed(4)}</span>
          </div>
          <div class="tt-row">
            <span class="tt-label">Sai số bình phương (x - x̂)²</span>
            <span class="tt-val">${sqErr.toFixed(5)}</span>
          </div>
        `;
      },
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
    SimpleCanvasChart.hideTooltip();
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
        const fIdx = explainData.plot_feature_idx ?? 0;
        const featSuffix = explainData.n_features > 1 ? ` — D${fIdx + 1}` : '';
        chartSlide1.drawLineChart([
          { label: `Cửa sổ 100 điểm (99 ngữ cảnh + điểm nạp${featSuffix})`, data: explainData.input_slice, color: '#334155', width: 2 }
        ], {
          title: `Cửa sổ 100 điểm & điểm nạp mới (t=100${featSuffix})`,
          xLabel: 'Bước thời gian trong cửa sổ (1 -> 100)',
          xValues: explainData.time_slice,
          highlightWindow: [88, 99],
          badgeText: `Điểm nạp = ${ptVal.toFixed(3)}`,
          pointMarker: { index: lastIdx, value: ptVal, label: 'Điểm nạp mới (t=100)' },
          tooltipFormatter: (idx) => {
            const stepNum = idx + 1;
            const val = explainData.input_slice[idx] ?? 0;
            const pill = idx === lastIdx
              ? '<span class="tt-pill anom">Điểm nạp mới</span>'
              : '<span class="tt-pill muted">99 điểm ngữ cảnh</span>';
            return `
              <div class="tt-header"><span>Bước cửa sổ t = ${stepNum} / 100</span>${pill}</div>
              <div class="tt-row">
                <span class="tt-label"><span class="tt-dot" style="background:#334155"></span>Giá trị đầu vào</span>
                <span class="tt-val">${val.toFixed(4)}</span>
              </div>
            `;
          },
        });
      } else {
        // Step 1: Input series slice with window highlighted
        const t = explainData.t;
        const winStartT = Math.max(0, t - 99);
        const sliceStart = explainData.time_slice[0];
        const winStartRel = t - sliceStart - 99;
        const winEndRel = t - sliceStart;

        chartSlide1.drawLineChart([
          { label: 'Chuỗi dữ liệu gốc', data: explainData.input_slice, color: '#334155', width: 2 }
        ], {
          title: `Chuỗi thời gian & vùng cửa sổ khảo sát tại t=${t}`,
          xLabel: 'Thời gian (t)',
          xValues: explainData.time_slice,
          highlightWindow: [winStartRel, winEndRel],
          badgeText: `Cửa sổ [${winStartT}, ${t}]`,
          onPointClick: (_idx, realT) => loadExplainData(realT, true),
          tooltipFormatter: (idx) => {
            const realT = explainData.time_slice[idx] !== undefined ? explainData.time_slice[idx] : idx;
            const val = explainData.input_slice[idx] ?? 0;
            const inWin = realT >= winStartT && realT <= t;
            const pill = realT === t
              ? '<span class="tt-pill anom">Đầu cửa sổ (t)</span>'
              : (inWin ? '<span class="tt-pill info">Trong Input Window</span>' : '<span class="tt-pill muted">Ngoài cửa sổ</span>');
            return `
              <div class="tt-header"><span>t = ${realT}</span>${pill}</div>
              <div class="tt-row">
                <span class="tt-label"><span class="tt-dot" style="background:#334155"></span>Chuỗi dữ liệu gốc</span>
                <span class="tt-val">${val.toFixed(4)}</span>
              </div>
              <div class="tt-hint">🖱️ Double-click để dời cửa sổ khảo sát về t = ${realT}</div>
            `;
          },
        });
      }
      document.getElementById('exp-text-1').textContent = explainData.explanations[0];
    } else if (currentStep === 1) {
      // Step 2: Encoder visual funnel pipeline & 128-D Signed Embedding chart
      const pipelineEl = document.getElementById('pipeline-shapes');
      pipelineEl.innerHTML = '';
      const maxTime = explainData.window_size || 100;

      explainData.conv_shapes.forEach((n, idx) => {
        const role = n.role || (idx === 0 ? 'input' : (idx === explainData.conv_shapes.length - 1 ? 'bottleneck' : 'conv'));
        const timeLen = n.time_len || 1;
        const timePct = Math.max(5, Math.round((timeLen / maxTime) * 100));

        let energyBadgeHTML = '';
        if (typeof n.energy === 'number') {
          const ratio = (n.energy_normal && n.energy_normal > 1e-6) ? (n.energy / n.energy_normal) : 1.0;
          const isHot = ratio > 1.25;
          energyBadgeHTML = `<span class="energy-pill ${isHot ? 'hot' : ''}" title="Năng lượng kích hoạt trung bình |h| (Chuẩn: ${(n.energy_normal || 0).toFixed(3)})">E=${n.energy.toFixed(3)}</span>`;
        }

        const div = document.createElement('div');
        div.className = `pipeline-node role-${role}`;
        div.innerHTML = `
          <div class="node-rail">
            <span class="node-dot"></span>
          </div>
          <div class="node-main">
            <div class="node-top-row">
              <span class="layer-name">${n.layer}</span>
              <div class="node-badges">
                ${energyBadgeHTML}
                <span class="layer-shape">${n.shape}</span>
              </div>
            </div>
            <div class="node-bottom-row">
              <div class="temporal-bar-track" title="Độ dài trục thời gian: ${timeLen}/${maxTime}">
                <div class="temporal-bar-fill" style="width: ${timePct}%;"></div>
              </div>
              <span class="layer-sub">${n.sub || ''}</span>
            </div>
          </div>
        `;
        pipelineEl.appendChild(div);
      });

      // Update KPI Badges on Right Header
      const distBadge = document.getElementById('badge-emb-dist');
      const cosBadge = document.getElementById('badge-emb-cos');
      const l2Dist = typeof explainData.embedding_l2_dist === 'number' ? explainData.embedding_l2_dist : 0;
      const cosSim = typeof explainData.embedding_cosine === 'number' ? explainData.embedding_cosine : 1;
      const isAnomWin = explainData.winner_group && explainData.winner_group.is_anomaly;

      if (distBadge) {
        distBadge.textContent = `Δz = ${l2Dist.toFixed(2)}`;
        distBadge.title = 'Khoảng cách L2 so với Vector Embedding cửa sổ chuẩn';
        distBadge.style.background = isAnomWin ? '#fee2e2' : (l2Dist < 0.01 ? '#dcfce7' : '#f1f5f9');
        distBadge.style.color = isAnomWin ? '#b91c1c' : (l2Dist < 0.01 ? '#15803d' : '#0f172a');
      }
      if (cosBadge) {
        cosBadge.textContent = `Cosine = ${cosSim.toFixed(3)}`;
        cosBadge.title = 'Độ tương đồng Cosine với cửa sổ chuẩn';
      }

      // Render 128-D Signed Latent Embedding (Dual Heatmap + Zero-Centered Diverging Bars)
      const targetTag = explainData.is_custom_point ? 'Điểm nạp' : `t=${explainData.t}`;
      chartSlide2.drawEmbeddingChart(
        explainData.embedding,
        explainData.embedding_normal || null,
        {
          title: explainData.is_custom_point
            ? `Phân bố Vector Embedding 128 chiều (Điểm nạp vs. Chuẩn t=${explainData.normal_t})`
            : `Phân bố Vector Embedding 128 chiều (${targetTag} vs. Chuẩn t=${explainData.normal_t})`,
          targetLabel: targetTag,
          normalLabel: 'Normal',
          xLabel: `Latent Dimension (d0 → d${explainData.embedding.length - 1})`,
        }
      );
      document.getElementById('exp-text-2').textContent = explainData.explanations[1];
    } else if (currentStep === 2) {
      // Step 3: Decoder Target vs Normal (Synced Crosshair)
      const isCustom = explainData.is_custom_point;
      const lastIdx = explainData.win_target.length - 1;
      const winSteps = Array.from({ length: explainData.win_target.length }, (_, i) => i + 1);
      const fIdx = explainData.plot_feature_idx ?? 0;
      const featSuffix = (isCustom && explainData.n_features > 1) ? ` — D${fIdx + 1}` : '';

      const makeStep3Tooltip = (isTargetChart) => (idx) => {
        const stepNum = idx + 1;
        const pillLabel = isTargetChart
          ? (isCustom ? (idx === lastIdx ? 'Điểm nạp (t=100)' : 'Ngữ cảnh') : `t = ${Math.max(0, explainData.t - 99 + idx)}`)
          : `Chuẩn t = ${Math.max(0, explainData.normal_t - 99 + idx)}`;
        const origVal = isTargetChart ? explainData.win_target[idx] : explainData.win_normal[idx];
        const recVal = isTargetChart ? explainData.rec_target[idx] : explainData.rec_normal[idx];
        const errT = explainData.err_sq_target[idx] ?? 0;
        const errN = explainData.err_sq_normal[idx] ?? 0;
        return `
          <div class="tt-header"><span>Bước cửa sổ ${stepNum}/100</span><span class="tt-pill ${isTargetChart ? 'anom' : 'info'}">${pillLabel}</span></div>
          <div class="tt-row">
            <span class="tt-label"><span class="tt-dot" style="background:#334155"></span>Gốc</span>
            <span class="tt-val">${(origVal ?? 0).toFixed(4)}</span>
          </div>
          <div class="tt-row">
            <span class="tt-label"><span class="tt-dot" style="background:#2563eb"></span>Tái tạo</span>
            <span class="tt-val">${(recVal ?? 0).toFixed(4)}</span>
          </div>
          <div class="tt-row">
            <span class="tt-label">MSE bước này (Khảo sát)</span>
            <span class="tt-val">${errT.toFixed(5)}</span>
          </div>
          <div class="tt-row">
            <span class="tt-label">MSE bước này (Chuẩn)</span>
            <span class="tt-val">${errN.toFixed(5)}</span>
          </div>
        `;
      };

      chartSlide3Target.drawLineChart([
        { label: isCustom ? `Gốc (kèm t=100${featSuffix})` : 'Gốc', data: explainData.win_target, color: '#334155', width: 2 },
        { label: `Tái tạo${featSuffix}`, data: explainData.rec_target, color: '#2563eb', width: 2 },
      ], {
        title: isCustom ? `Cửa sổ điểm nạp (t=100${featSuffix})` : `Cửa sổ khảo sát (t=${explainData.t})`,
        xLabel: 'Thời gian trong cửa sổ (1 -> 100)',
        xValues: winSteps,
        syncCharts: [chartSlide3Normal],
        tooltipFormatter: makeStep3Tooltip(true),
        badgeText: `MSE = ${explainData.mse_target.toFixed(4)}`,
        pointMarker: isCustom ? { index: lastIdx, value: explainData.win_target[lastIdx], label: 'Điểm nạp (t=100)' } : undefined,
      });
      document.getElementById('badge-mse-target').textContent = `MSE = ${explainData.mse_target.toFixed(4)}`;

      chartSlide3Normal.drawLineChart([
        { label: 'Gốc', data: explainData.win_normal, color: '#334155', width: 2 },
        { label: 'Tái tạo', data: explainData.rec_normal, color: '#2563eb', width: 2 },
      ], {
        title: `Cửa sổ chuẩn đối chứng (t=${explainData.normal_t})`,
        xLabel: 'Thời gian trong cửa sổ (1 -> 100)',
        xValues: winSteps,
        syncCharts: [chartSlide3Target],
        tooltipFormatter: makeStep3Tooltip(false),
        badgeText: `MSE = ${explainData.mse_normal.toFixed(4)}`,
      });
      document.getElementById('badge-mse-normal').textContent = `MSE = ${explainData.mse_normal.toFixed(4)}`;

      document.getElementById('exp-text-3').textContent = explainData.explanations[2];
    } else if (currentStep === 3) {
      // Step 4: Classifier 12 Classes Target vs Normal (Synced Bar Highlight)
      const isCustom = explainData.is_custom_point;
      const targetBars = explainData.classes_target.map((c) => ({
        label: c.label,
        name_vi: c.name_vi,
        desc_vi: c.desc_vi,
        reason: c.reason,
        value: c.prob,
        isExcluded: c.excluded,
        isTop: c.is_winner,
      }));
      const normalBars = explainData.classes_normal.map((c) => ({
        label: c.label,
        name_vi: c.name_vi,
        desc_vi: c.desc_vi,
        reason: c.reason,
        value: c.prob,
        isExcluded: c.excluded,
        isTop: c.is_winner,
      }));

      const makeStep4Tooltip = (idx) => {
        const cT = explainData.classes_target[idx];
        const cN = explainData.classes_normal[idx];
        if (!cT) return '';
        const pill = cT.excluded
          ? '<span class="tt-pill muted">Đã lọc FAA</span>'
          : (cT.is_winner ? '<span class="tt-pill anom">Top Class</span>' : '<span class="tt-pill info">Hợp lệ</span>');
        const noteHtml = cT.excluded
          ? `<div class="tt-sub">Lý do loại trừ FAA: ${cT.reason || 'Mean Prob > 0.05'}</div>`
          : (cT.desc_vi ? `<div class="tt-sub">${cT.desc_vi}</div>` : '');
        return `
          <div class="tt-header"><span>#${idx} · ${cT.name_vi || cT.label}</span>${pill}</div>
          <div class="tt-row">
            <span class="tt-label"><span class="tt-dot" style="background:${cT.excluded ? '#94a3b8' : (cT.is_winner ? '#dc2626' : '#2563eb')}"></span>Cửa sổ khảo sát</span>
            <span class="tt-val">${(cT.prob * 100).toFixed(2)}%</span>
          </div>
          <div class="tt-row">
            <span class="tt-label"><span class="tt-dot" style="background:#64748b"></span>Cửa sổ chuẩn (t=${explainData.normal_t})</span>
            <span class="tt-val">${cN ? (cN.prob * 100).toFixed(2) + '%' : '--'}</span>
          </div>
          ${noteHtml}
        `;
      };

      const topTargetLabel = explainData.winner_group?.name_vi || targetBars.find(b => b.isTop)?.label || 'normal';
      const topNormalBar = normalBars.find(b => b.isTop) || normalBars[0];
      const topNormalLabel = topNormalBar ? (topNormalBar.name_vi || topNormalBar.label) : 'normal';

      const badgeTopT = document.getElementById('badge-top-class-target');
      const badgeTopN = document.getElementById('badge-top-class-normal');
      if (badgeTopT) badgeTopT.textContent = `Top: ${topTargetLabel}`;
      if (badgeTopN) badgeTopN.textContent = `Top: ${topNormalLabel}`;

      chartSlide4Target.drawBarChart(targetBars, {
        title: isCustom ? 'Cửa sổ điểm nạp (t=100)' : `Cửa sổ khảo sát (t=${explainData.t})`,
        badgeText: `Top: ${topTargetLabel}`,
        syncCharts: [chartSlide4Normal],
        tooltipFormatter: makeStep4Tooltip,
      });

      chartSlide4Normal.drawBarChart(normalBars, {
        title: `Cửa sổ chuẩn đối chứng (t=${explainData.normal_t})`,
        badgeText: `Top: ${topNormalLabel}`,
        syncCharts: [chartSlide4Target],
        tooltipFormatter: makeStep4Tooltip,
      });

      document.getElementById('exp-text-4').textContent = explainData.explanations[3];
    } else if (currentStep === 4) {
      // Step 5: Combined score over time
      const isCustom = explainData.is_custom_point;
      const n5 = explainData.raw_comb_slice.length;
      const step5X = isCustom
        ? Array.from({ length: n5 }, (_, i) => (i === n5 - 1 ? 't=100 (Điểm nạp)' : `Lịch sử -${n5 - 1 - i}`))
        : explainData.time_slice;
      const curSliceIdx = !isCustom ? explainData.time_slice.indexOf(explainData.t) : (n5 - 1);

      chartSlide5.drawLineChart([
        { label: 'Raw MSE', data: explainData.score_rec_slice, color: '#334155', width: 2 },
        { label: 'Raw CE', data: explainData.score_ce_slice, color: '#2563eb', width: 2 },
        { label: 'Raw Combined Score', data: explainData.raw_comb_slice, color: '#dc2626', width: 2.5 },
      ], {
        title: isCustom ? 'Raw Combined Score của điểm nạp so với lịch sử' : 'Biến thiên Raw MSE, Raw CE & Raw Combined Score',
        xLabel: isCustom ? '50 bước lịch sử cuối & điểm nạp mới' : 'Chỉ số thời gian (t)',
        xValues: step5X,
        thresholdLine: explainData.threshold,
        badgeText: `Combined = ${explainData.raw_combined.toFixed(3)}`,
        pointMarker: curSliceIdx >= 0
          ? {
              index: curSliceIdx,
              value: explainData.raw_comb_slice[curSliceIdx],
              label: isCustom ? 'Điểm nạp mới' : `t=${explainData.t}`,
            }
          : undefined,
        onPointClick: !isCustom ? (_idx, realT) => loadExplainData(realT, true) : undefined,
        tooltipFormatter: (idx) => {
          const xTitle = isCustom ? step5X[idx] : `t = ${step5X[idx]}`;
          const rMse = explainData.score_rec_slice[idx] ?? 0;
          const rCe = explainData.score_ce_slice[idx] ?? 0;
          const rComb = explainData.raw_comb_slice[idx] ?? 0;
          const isAnom = rComb > explainData.threshold;
          const pill = isAnom
            ? '<span class="tt-pill anom">⚠️ BẤT THƯỜNG</span>'
            : '<span class="tt-pill ok">✓ BÌNH THƯỜNG</span>';
          const hint = !isCustom
            ? `<div class="tt-hint">🖱️ Double-click để xem giải thích chi tiết tại t = ${step5X[idx]}</div>`
            : '';
          return `
            <div class="tt-header"><span>${xTitle}</span>${pill}</div>
            <div class="tt-row">
              <span class="tt-label"><span class="tt-dot" style="background:#334155"></span>Raw MSE</span>
              <span class="tt-val">${rMse.toFixed(4)}</span>
            </div>
            <div class="tt-row">
              <span class="tt-label"><span class="tt-dot" style="background:#2563eb"></span>Raw CE</span>
              <span class="tt-val">${rCe.toFixed(4)}</span>
            </div>
            <div class="tt-row">
              <span class="tt-label"><span class="tt-dot" style="background:#dc2626"></span>Raw Combined Score</span>
              <span class="tt-val">${rComb.toFixed(4)}</span>
            </div>
            <div class="tt-row">
              <span class="tt-label">Threshold P99.5</span>
              <span class="tt-val">${explainData.threshold.toFixed(4)}</span>
            </div>
            ${hint}
          `;
        },
      });

      // Update Formula Card
      const eqEl = document.getElementById('formula-equation');
      const conclusionBadge = explainData.raw_combined > explainData.threshold 
        ? '<span style="color:#dc2626; font-weight:bold;">BẤT THƯỜNG</span>' 
        : '<span style="color:#16a34a; font-weight:bold;">BÌNH THƯỜNG</span>';
      eqEl.innerHTML = `
        (MSE + CE) / 2
        = (${explainData.raw_mse.toFixed(4)} + ${explainData.raw_ce.toFixed(4)}) / 2 
        = <strong>${explainData.raw_combined.toFixed(4)}</strong>
        (P99.5 = ${explainData.threshold.toFixed(4)} &rArr; ${conclusionBadge})
      `;

      document.getElementById('exp-text-5').textContent = explainData.explanations[4];
    }
  }

  // 6. Navigation Tabs
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      SimpleCanvasChart.hideTooltip();
      closeFeaturePicker();
      closeEntityPicker();
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
    SimpleCanvasChart.hideTooltip();
    closeFeaturePicker();
    closeEntityPicker();
    const activeTab = document.querySelector('.tab-content.active');
    if (!activeTab) return;
    if (activeTab.id === 'tab-pretrain') renderOverviewChart();
    else if (activeTab.id === 'tab-predict' && lastPredictedResult) {
      renderPredictWindowChart(lastPredictedResult.window_input, lastPredictedResult.reconstructed, lastPredictedResult.raw_mse);
    } else if (activeTab.id === 'tab-explain') renderCurrentStep();
  });

  // Export PNG buttons (use live chart instances so offscreen snapshot is preserved)
  document.getElementById('btn-export-overview').onclick = () => chartOverview && chartOverview.exportPNG(`overview_${currentEntity}.png`);
  document.getElementById('btn-export-predict-chart').onclick = () => chartPredict && chartPredict.exportPNG(`predict_${currentEntity}.png`);
  const exportChartMap = {
    'canvas-slide-1': () => chartSlide1,
    'canvas-slide-2': () => chartSlide2,
    'canvas-slide-3-target': () => chartSlide3Target,
    'canvas-slide-4-target': () => chartSlide4Target,
    'canvas-slide-5': () => chartSlide5,
  };
  document.querySelectorAll('.btn-export').forEach(btn => {
    btn.onclick = () => {
      const cid = btn.dataset.canvas;
      const getter = exportChartMap[cid];
      const inst = getter ? getter() : null;
      if (inst) inst.exportPNG(`${cid}_${currentEntity}.png`);
    };
  });

  // Init
  initCharts();
  setupWalkthroughControls();
  loadIndex();
});

