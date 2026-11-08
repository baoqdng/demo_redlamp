/**
 * RedLamp Canvas Charting Engine
 * 100% Offline, Zero external dependencies.
 * Respects strict visualization constraints:
 * - Minimum 24px font size for labels and key annotations.
 * - Colors: Original (#334155), Reconstructed (#2563eb), Anomaly/Peak (#dc2626), Excluded (#cbd5e1).
 * - Max 3 lines per line chart.
 * - Export to PNG.
 */

class SimpleCanvasChart {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    // Set actual canvas pixels for sharp retina rendering
    this.canvas.width = (rect.width || 600) * dpr;
    this.canvas.height = (rect.height || 300) * dpr;
    this.dpr = dpr;
    this.width = this.canvas.width;
    this.height = this.canvas.height;
  }

  clear() {
    this.ctx.clearRect(0, 0, this.width, this.height);
    this.ctx.fillStyle = '#ffffff';
    this.ctx.fillRect(0, 0, this.width, this.height);
  }

  exportPNG(filename = 'chart.png') {
    const link = document.createElement('a');
    link.download = filename;
    link.href = this.canvas.toDataURL('image/png');
    link.click();
  }

  /**
   * Draw Line Chart
   * lines: Array of { label, data: number[], color, width, dashed }
   * options: { title, xLabel, yLabel, yMin, yMax, highlightWindow: [start, end], thresholdLine: val, badgeText: str }
   */
  drawLineChart(lines, options = {}) {
    this.resize();
    this.clear();
    const ctx = this.ctx;
    const dpr = this.dpr;

    // Font size >= 24px per requirement
    const FONT_TITLE = `bold ${Math.round(24 * dpr)}px var(--font-family, sans-serif)`;
    const FONT_LABEL = `${Math.round(24 * dpr)}px var(--font-family, sans-serif)`;
    const FONT_BADGE = `bold ${Math.round(24 * dpr)}px var(--font-family, sans-serif)`;

    const padLeft = 85 * dpr;
    const padRight = 35 * dpr;
    const padTop = options.title ? 60 * dpr : 40 * dpr;
    const padBottom = 65 * dpr;

    const plotW = this.width - padLeft - padRight;
    const plotH = this.height - padTop - padBottom;

    if (plotW <= 0 || plotH <= 0) return;

    // Determine Y range
    let allVals = [];
    lines.forEach(l => {
      if (l.data) allVals = allVals.concat(l.data);
    });
    if (options.thresholdLine !== undefined) allVals.push(options.thresholdLine);

    let yMin = options.yMin !== undefined ? options.yMin : (allVals.length ? Math.min(...allVals) : 0);
    let yMax = options.yMax !== undefined ? options.yMax : (allVals.length ? Math.max(...allVals) : 1);
    if (yMin === yMax) {
      yMin -= 0.1;
      yMax += 0.1;
    }
    const yMargin = (yMax - yMin) * 0.08;
    yMin -= yMargin;
    yMax += yMargin;

    const maxLen = Math.max(...lines.map(l => (l.data ? l.data.length : 0)), 1);

    // Coordinate conversion
    const getX = (idx) => padLeft + (idx / (maxLen - 1 || 1)) * plotW;
    const getY = (val) => padTop + plotH - ((val - yMin) / (yMax - yMin)) * plotH;

    // 1. Draw Highlight Window if specified (e.g. 100 points window in red/pink area)
    if (options.highlightWindow && options.highlightWindow.length === 2) {
      const [hStart, hEnd] = options.highlightWindow;
      const x1 = Math.max(padLeft, getX(hStart));
      const x2 = Math.min(padLeft + plotW, getX(hEnd));
      ctx.fillStyle = 'rgba(220, 38, 38, 0.18)'; // transparent red
      ctx.fillRect(x1, padTop, x2 - x1, plotH);
      ctx.strokeStyle = '#dc2626';
      ctx.lineWidth = 2 * dpr;
      ctx.setLineDash([4 * dpr, 4 * dpr]);
      ctx.strokeRect(x1, padTop, x2 - x1, plotH);
      ctx.setLineDash([]);
    }

    // 2. Draw Axes and Grid
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1 * dpr;
    ctx.beginPath();
    // 4 horizontal grid lines
    for (let i = 0; i <= 4; i++) {
      const v = yMin + (i / 4) * (yMax - yMin);
      const y = getY(v);
      ctx.moveTo(padLeft, y);
      ctx.lineTo(padLeft + plotW, y);

      // Y-axis label (>= 24px)
      ctx.fillStyle = '#64748b';
      ctx.font = FONT_LABEL;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(v.toFixed(2), padLeft - 10 * dpr, y);
    }
    ctx.stroke();

    // 3. Threshold Line if specified (Dashed Red Line)
    if (options.thresholdLine !== undefined) {
      const ty = getY(options.thresholdLine);
      ctx.strokeStyle = '#dc2626';
      ctx.lineWidth = 2.5 * dpr;
      ctx.setLineDash([6 * dpr, 6 * dpr]);
      ctx.beginPath();
      ctx.moveTo(padLeft, ty);
      ctx.lineTo(padLeft + plotW, ty);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = '#dc2626';
      ctx.font = FONT_BADGE;
      ctx.textAlign = 'left';
      ctx.fillText(`Ngưỡng: ${options.thresholdLine.toFixed(3)}`, padLeft + 10 * dpr, ty - 10 * dpr);
    }

    // 4. Draw Lines (Max 3 lines: e.g. dark gray, blue, red)
    lines.slice(0, 3).forEach((line) => {
      if (!line.data || line.data.length === 0) return;
      ctx.strokeStyle = line.color || '#334155';
      ctx.lineWidth = (line.width || 2) * dpr;
      if (line.dashed) {
        ctx.setLineDash([5 * dpr, 5 * dpr]);
      } else {
        ctx.setLineDash([]);
      }

      ctx.beginPath();
      for (let i = 0; i < line.data.length; i++) {
        const x = getX(i);
        const y = getY(line.data[i]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    });

    // 5. Draw Title & Labels
    if (options.title) {
      ctx.fillStyle = '#0f172a';
      ctx.font = FONT_TITLE;
      ctx.textAlign = 'center';
      ctx.fillText(options.title, padLeft + plotW / 2, 32 * dpr);
    }

    if (options.xLabel) {
      ctx.fillStyle = '#64748b';
      ctx.font = FONT_LABEL;
      ctx.textAlign = 'center';
      ctx.fillText(options.xLabel, padLeft + plotW / 2, this.height - 15 * dpr);
    }

    // 6. Draw Key Value Badge on Chart (e.g. "MSE = 0,043")
    if (options.badgeText) {
      ctx.font = FONT_BADGE;
      const bText = options.badgeText;
      const bMetrics = ctx.measureText(bText);
      const bPadX = 12 * dpr;
      const bPadY = 6 * dpr;
      const bW = bMetrics.width + bPadX * 2;
      const bH = 34 * dpr;
      const bx = padLeft + plotW - bW - 10 * dpr;
      const by = padTop + 10 * dpr;

      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.strokeStyle = '#dc2626';
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(bx, by, bW, bH, 4 * dpr) : ctx.rect(bx, by, bW, bH);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#dc2626';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(bText, bx + bW / 2, by + bH / 2);
    }

    // 6.5. Draw Point Marker if specified (e.g. injected point at t=99)
    if (options.pointMarker) {
      const pIdx = options.pointMarker.index !== undefined ? options.pointMarker.index : (maxLen - 1);
      const px = getX(pIdx);
      const py = getY(options.pointMarker.value !== undefined ? options.pointMarker.value : 0);
      
      // Outer glow
      ctx.fillStyle = 'rgba(220, 38, 38, 0.3)';
      ctx.beginPath();
      ctx.arc(px, py, 15 * dpr, 0, Math.PI * 2);
      ctx.fill();

      // Solid core
      ctx.fillStyle = '#dc2626';
      ctx.beginPath();
      ctx.arc(px, py, 6 * dpr, 0, Math.PI * 2);
      ctx.fill();

      // Label text
      const markerLabel = options.pointMarker.label || 'Điểm nạp mới';
      ctx.fillStyle = '#dc2626';
      ctx.font = `bold ${Math.round(22 * dpr)}px var(--font-family, sans-serif)`;
      ctx.textAlign = (px > padLeft + plotW - 140 * dpr) ? 'right' : 'left';
      ctx.fillText(markerLabel, px + ((px > padLeft + plotW - 140 * dpr) ? -14 * dpr : 14 * dpr), py - 12 * dpr);
    }

    // 7. Legend
    let legX = padLeft + 10 * dpr;
    const legY = padTop + 20 * dpr;
    ctx.font = FONT_LABEL;
    lines.slice(0, 3).forEach((line) => {
      ctx.fillStyle = line.color;
      ctx.fillRect(legX, legY - 6 * dpr, 14 * dpr, 14 * dpr);
      ctx.fillStyle = '#1e293b';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(line.label, legX + 20 * dpr, legY);
      legX += ctx.measureText(line.label).width + 35 * dpr;
    });
  }

  /**
   * Draw Bar Chart
   * bars: Array of { label, value, color, isExcluded, isTop }
   * options: { title, xLabel, yLabel, yMax, badgeText }
   */
  drawBarChart(bars, options = {}) {
    this.resize();
    this.clear();
    const ctx = this.ctx;
    const dpr = this.dpr;

    const FONT_TITLE = `bold ${Math.round(24 * dpr)}px var(--font-family, sans-serif)`;
    const FONT_LABEL = `${Math.round(24 * dpr)}px var(--font-family, sans-serif)`;
    const FONT_BAR_LABEL = `${Math.round(20 * dpr)}px var(--font-family, sans-serif)`;
    const FONT_BADGE = `bold ${Math.round(24 * dpr)}px var(--font-family, sans-serif)`;

    const padLeft = 80 * dpr;
    const padRight = 25 * dpr;
    const padTop = options.title ? 60 * dpr : 40 * dpr;
    const padBottom = 80 * dpr;

    const plotW = this.width - padLeft - padRight;
    const plotH = this.height - padTop - padBottom;
    if (plotW <= 0 || plotH <= 0 || !bars || bars.length === 0) return;

    let yMax = options.yMax !== undefined ? options.yMax : Math.max(...bars.map(b => b.value || 0), 0.1);
    yMax *= 1.15; // margin

    const n = bars.length;
    const barStep = plotW / n;
    const barWidth = Math.max(4 * dpr, barStep * 0.7);

    // 1. Draw Grid
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1 * dpr;
    ctx.beginPath();
    for (let i = 0; i <= 4; i++) {
      const v = (i / 4) * yMax;
      const y = padTop + plotH - (v / yMax) * plotH;
      ctx.moveTo(padLeft, y);
      ctx.lineTo(padLeft + plotW, y);

      ctx.fillStyle = '#64748b';
      ctx.font = FONT_LABEL;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(v.toFixed(2), padLeft - 10 * dpr, y);
    }
    ctx.stroke();

    // 2. Draw Bars
    bars.forEach((bar, i) => {
      const val = Math.max(0, bar.value || 0);
      const bH = (val / yMax) * plotH;
      const bx = padLeft + i * barStep + (barStep - barWidth) / 2;
      const by = padTop + plotH - bH;

      // Color rules:
      // Excluded classes: light gray (#cbd5e1)
      // Top class: red (#dc2626)
      // Normal/other: blue (#2563eb) or custom
      let barColor = bar.color || '#2563eb';
      if (bar.isExcluded) {
        barColor = '#cbd5e1'; // light gray
      } else if (bar.isTop) {
        barColor = '#dc2626'; // red for top anomaly class
      }

      ctx.fillStyle = barColor;
      ctx.fillRect(bx, by, barWidth, bH);

      // Label below bar (rotated if needed)
      ctx.save();
      ctx.translate(bx + barWidth / 2, padTop + plotH + 12 * dpr);
      ctx.rotate(n > 8 ? -Math.PI / 4 : 0);
      ctx.fillStyle = bar.isExcluded ? '#94a3b8' : '#1e293b';
      ctx.font = FONT_BAR_LABEL;
      ctx.textAlign = n > 8 ? 'right' : 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(bar.label, 0, 0);
      ctx.restore();

      // Top label for top class
      if (bar.isTop && val > 0.02) {
        ctx.fillStyle = '#dc2626';
        ctx.font = `bold ${Math.round(20 * dpr)}px var(--font-family, sans-serif)`;
        ctx.textAlign = 'center';
        ctx.fillText(`${(val * 100).toFixed(1)}%`, bx + barWidth / 2, by - 6 * dpr);
      }
    });

    // 3. Title & Badge
    if (options.title) {
      ctx.fillStyle = '#0f172a';
      ctx.font = FONT_TITLE;
      ctx.textAlign = 'center';
      ctx.fillText(options.title, padLeft + plotW / 2, 32 * dpr);
    }

    if (options.badgeText) {
      ctx.font = FONT_BADGE;
      const bText = options.badgeText;
      const bMetrics = ctx.measureText(bText);
      const bPadX = 12 * dpr;
      const bPadY = 6 * dpr;
      const bW = bMetrics.width + bPadX * 2;
      const bH = 34 * dpr;
      const bx = padLeft + plotW - bW - 10 * dpr;
      const by = padTop + 10 * dpr;

      ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
      ctx.strokeStyle = '#2563eb';
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(bx, by, bW, bH, 4 * dpr) : ctx.rect(bx, by, bW, bH);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#1e3a8a';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(bText, bx + bW / 2, by + bH / 2);
    }
  }
}
window.SimpleCanvasChart = SimpleCanvasChart;

