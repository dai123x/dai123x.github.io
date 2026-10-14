/* ==========================================================================
   daixuan.cloud · 数据实验室 (stats-lab) · js/lab.js
   零依赖。四个实验全部在浏览器里现场模拟：中心极限定理 / Bootstrap 置信区间 /
   均值 vs 中位数 / 辛普森悖论。随机数可播种 → 深链可复现。
   ========================================================================== */
(function () {
  'use strict';

  /* ======================================================================
     0 · 基础工具
     ====================================================================== */
  var $ = function (id) { return document.getElementById(id); };
  var clamp = function (v, a, b) { return Math.min(b, Math.max(a, v)); };
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* 文案全部走 js/i18n.js（同为 defer，且排在前面，所以此刻已就绪）。
     取不到就返回 key —— 宁可显眼地坏掉，也不要静默混语种。
     注意公开 API 叫 SL_I18N.t，本文件内部的短名才叫 tr —— 别把两者混为一谈。 */
  function tr(key, vars) {
    var I = window.SL_I18N;
    return (I && typeof I.t === 'function') ? I.t(key, vars) : key;
  }

  /* 可播种伪随机数（mulberry32）—— 同一个种子必然重现同一张图 */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* 标准正态（Marsaglia 极坐标法，带缓存的对偶值） */
  function makeGauss(rng) {
    var spare = null;
    return function () {
      if (spare !== null) { var s0 = spare; spare = null; return s0; }
      var u, v, s;
      do { u = rng() * 2 - 1; v = rng() * 2 - 1; s = u * u + v * v; } while (s === 0 || s >= 1);
      var f = Math.sqrt(-2 * Math.log(s) / s);
      spare = v * f;
      return u * f;
    };
  }

  function mean(a) {
    var n = a.length, s = 0;
    if (!n) return NaN;
    for (var i = 0; i < n; i++) s += a[i];
    return s / n;
  }
  /* 样本标准差，分母 n−1（无偏） */
  function sd(a) {
    var n = a.length;
    if (n < 2) return 0;
    var m = mean(a), s = 0, d;
    for (var i = 0; i < n; i++) { d = a[i] - m; s += d * d; }
    return Math.sqrt(s / (n - 1));
  }
  /* Fisher–Pearson 标准化矩偏度 G1 */
  function skewness(a) {
    var n = a.length;
    if (n < 3) return 0;
    var m = mean(a), m2 = 0, m3 = 0, d;
    for (var i = 0; i < n; i++) { d = a[i] - m; m2 += d * d; m3 += d * d * d; }
    m2 /= n; m3 /= n;
    var s = Math.sqrt(m2);
    return s === 0 ? 0 : m3 / (s * s * s);
  }
  /* 分位数（R 的 type-7 / numpy 默认，线性插值）。sorted 必须已升序 */
  function quantile(sorted, p) {
    var n = sorted.length;
    if (!n) return NaN;
    if (n === 1) return sorted[0];
    var idx = (n - 1) * p, lo = Math.floor(idx), hi = Math.ceil(idx);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  }
  function asc(a) { return a.slice().sort(function (x, y) { return x - y; }); }

  /* 标准正态分位数（Acklam 有理逼近，绝对误差 < 1.15e-9） */
  function invNorm(p) {
    if (p <= 0) return -Infinity;
    if (p >= 1) return Infinity;
    var a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
             1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    var b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
             6.680131188771972e+01, -1.328068155288572e+01];
    var c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
             -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    var d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
    var pl = 0.02425, q, r;
    if (p < pl) {
      q = Math.sqrt(-2 * Math.log(p));
      return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
             ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    if (p <= 1 - pl) {
      q = p - 0.5; r = q * q;
      return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
             (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
    }
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
            ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }

  function fmt(v, d) {
    if (!isFinite(v)) return '—';
    return v.toFixed(d === undefined ? 3 : d);
  }
  function pct(v, d) { return isFinite(v) ? (v * 100).toFixed(d === undefined ? 1 : d) + '%' : '—'; }
  function signedPct(v) { return (v >= 0 ? '+' : '−') + Math.abs(v * 100).toFixed(1) + 'pp'; }

  /* ======================================================================
     1 · 分布库
     每个分布：sample(rng,gauss) / mu / sigma（理论值）/ 展示名
     ====================================================================== */
  var LOGN_S = 0.6;                                   /* bootstrap 用的对数正态 */
  var LOGN_MU = Math.exp(LOGN_S * LOGN_S / 2);        /* = 1.19722 */
  var LOGN_SD = Math.sqrt((Math.exp(LOGN_S * LOGN_S) - 1) * Math.exp(LOGN_S * LOGN_S));

  var DISTS = {
    /* —— CLT 用的四种总体 —— */
    uniform: {
      nameKey: 'js.dist.uniform',
      mu: 0.5, sigma: Math.sqrt(1 / 12),
      sample: function (r) { return r(); }
    },
    exponential: {
      nameKey: 'js.dist.exponential',
      mu: 1, sigma: 1,
      sample: function (r) { return -Math.log(1 - r()); }
    },
    bimodal: {
      nameKey: 'js.dist.bimodal',
      mu: 2, sigma: Math.sqrt(5),
      sample: function (r, g) { return r() < 0.5 ? g() : 4 + g(); }
    },
    lognormal: {
      nameKey: 'js.dist.lognormal',
      mu: Math.exp(0.8 * 0.8 / 2), sigma: Math.sqrt((Math.exp(0.64) - 1) * Math.exp(0.64)),
      sample: function (r, g) { return Math.exp(0.8 * g()); }
    },
    /* —— 实验 03 追加 —— */
    normal: {
      nameKey: 'js.dist.normal',
      mu: 0, sigma: 1,
      sample: function (r, g) { return g(); }
    },
    t3: {
      nameKey: 'js.dist.t3',
      mu: 0, sigma: Math.sqrt(3),
      sample: function (r, g) {
        var a = g(), b = g(), c = g();
        return g() / Math.sqrt((a * a + b * b + c * c) / 3);
      }
    },
    contaminated: {
      nameKey: 'js.dist.contaminated',
      /* mu=0；sigma 依赖 ε，由 sigmaFor 计算 */
      mu: 0, sigma: 1,
      sigmaFor: function (eps) { return Math.sqrt((1 - eps) * 1 + eps * 36); },
      sample: function (r, g, eps) { return (r() < eps ? 6 : 1) * g(); }
    }
  };

  function distName(key) { return tr(DISTS[key].nameKey); }

  function distSample(key, rng, gauss, eps) {
    var d = DISTS[key];
    if (key === 'contaminated') return d.sample(rng, gauss, eps);
    return d.sample(rng, gauss);
  }
  function distSigma(key, eps) {
    var d = DISTS[key];
    return d.sigmaFor ? d.sigmaFor(eps) : d.sigma;
  }

  /* ======================================================================
     2 · 主题色 / Canvas 基础设施
     ====================================================================== */
  var C = {};
  function readColors() {
    var cs = getComputedStyle(document.documentElement);
    var g = function (k, fb) { var v = (cs.getPropertyValue(k) || '').trim(); return v || fb; };
    C = {
      c1: g('--sl-c1', '#818cf8'), c2: g('--sl-c2', '#ec4899'), c3: g('--sl-c3', '#22d3ee'),
      ok: g('--sl-ok', '#34d399'), bad: g('--sl-bad', '#f87171'),
      grid: g('--sl-grid', 'rgba(148,163,184,.16)'), axis: g('--sl-axis', '#94a3b8'),
      text: g('--sl-text', '#f8fafc'), text2: g('--sl-text-2', '#94a3b8'),
      band: g('--sl-band', 'rgba(129,140,248,.18)'), panel: g('--sl-panel-2', '#111827')
    };
  }

  function fitCanvas(canvas) {
    if (!canvas) return null;
    var w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return null;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var W = Math.round(w * dpr), H = Math.round(h * dpr);
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx: ctx, w: w, h: h };
  }

  function niceTicks(min, max, target) {
    var span = (max - min) || 1;
    var raw = span / Math.max(1, target);
    var mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var norm = raw / mag, step;
    if (norm <= 1) step = 1; else if (norm <= 2) step = 2; else if (norm <= 2.5) step = 2.5;
    else if (norm <= 5) step = 5; else step = 10;
    step *= mag;
    var start = Math.ceil(min / step) * step;
    var out = [];
    for (var v = start; v <= max + step * 1e-6; v += step) out.push(v);
    return { ticks: out, step: step };
  }
  function tickLabeler(step) {
    if (step >= 1) return function (v) { return v.toFixed(0); };
    if (step >= 0.1) return function (v) { return v.toFixed(1); };
    if (step >= 0.01) return function (v) { return v.toFixed(2); };
    return function (v) { return v.toFixed(3); };
  }

  var PAD = { l: 46, r: 14, t: 16, b: 28 };

  /* 画坐标系 + 网格，返回绘图区与比例函数。
     opts: { yLabel, xTicks:false, yTicks:false, yFormat(v), xFormat(v) } */
  function drawFrame(ctx, w, h, xr, yr, opts) {
    opts = opts || {};
    var plot = { x: PAD.l, y: PAD.t, w: w - PAD.l - PAD.r, h: h - PAD.t - PAD.b };
    var sx = function (v) { return plot.x + (v - xr[0]) / (xr[1] - xr[0]) * plot.w; };
    var sy = function (v) { return plot.y + plot.h - (v - yr[0]) / (yr[1] - yr[0]) * plot.h; };

    ctx.save();
    ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 1;
    ctx.fillStyle = C.axis;

    if (opts.yTicks !== false) {
      var yt = niceTicks(yr[0], yr[1], 4);
      var ly = opts.yFormat || tickLabeler(yt.step);
      ctx.textBaseline = 'middle';
      for (var i = 0; i < yt.ticks.length; i++) {
        var v = yt.ticks[i];
        if (v < yr[0] - 1e-9 || v > yr[1] + 1e-9) continue;
        var py = Math.round(sy(v)) + 0.5;
        ctx.beginPath(); ctx.moveTo(plot.x, py); ctx.lineTo(plot.x + plot.w, py); ctx.stroke();
        ctx.textAlign = 'right';
        ctx.fillText(ly(v), plot.x - 7, py);
      }
    }

    if (opts.xTicks !== false) {
      var xt = niceTicks(xr[0], xr[1], 6);
      var lx = opts.xFormat || tickLabeler(xt.step);
      ctx.textBaseline = 'top';
      for (var j = 0; j < xt.ticks.length; j++) {
        var xv = xt.ticks[j];
        if (xv < xr[0] - 1e-9 || xv > xr[1] + 1e-9) continue;
        var px = Math.round(sx(xv)) + 0.5;
        ctx.beginPath(); ctx.moveTo(px, plot.y); ctx.lineTo(px, plot.y + plot.h); ctx.stroke();
        ctx.textAlign = 'center';
        ctx.fillText(lx(xv), px, plot.y + plot.h + 7);
      }
    }

    /* 轴框 */
    ctx.strokeStyle = C.grid;
    ctx.beginPath();
    ctx.moveTo(plot.x + 0.5, plot.y);
    ctx.lineTo(plot.x + 0.5, plot.y + plot.h + 0.5);
    ctx.lineTo(plot.x + plot.w, plot.y + plot.h + 0.5);
    ctx.stroke();

    if (opts.yLabel) {
      ctx.save();
      ctx.translate(11, plot.y + plot.h / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = C.axis;
      ctx.fillText(opts.yLabel, 0, 0);
      ctx.restore();
    }
    ctx.restore();
    noteContrast('坐标轴刻度 / 轴标题', C.panel, C.axis);
    return { plot: plot, sx: sx, sy: sy, xr: xr, yr: yr };
  }

  function annotate(ctx, w, text, color) {
    ctx.save();
    ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillStyle = color || C.axis;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText(text, w - PAD.r, 2);
    ctx.restore();
    noteContrast('图内注记（右上角）', C.panel, color || C.axis);
  }

  function legend(ctx, x, y, items) {
    ctx.save();
    ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    var cx = x;
    for (var i = 0; i < items.length; i++) {
      ctx.fillStyle = items[i].c;
      ctx.fillRect(cx, y - 4, 9, 8);
      ctx.fillStyle = C.text2;
      ctx.fillText(items[i].t, cx + 13, y);
      cx += 13 + ctx.measureText(items[i].t).width + 14;
    }
    ctx.restore();
    noteContrast('图例文字', C.panel, C.text2);
  }

  /* 直方图（counts 与 edges 由 hist() 产出） */
  function hist(data, x0, x1, nbins) {
    var counts = new Array(nbins).fill(0);
    var bw = (x1 - x0) / nbins;
    var under = 0, over = 0;
    for (var i = 0; i < data.length; i++) {
      var v = data[i];
      if (v < x0) { under++; continue; }
      if (v >= x1) { over++; continue; }
      var b = Math.floor((v - x0) / bw);
      if (b >= nbins) b = nbins - 1;
      counts[b]++;
    }
    return { counts: counts, bw: bw, x0: x0, x1: x1, under: under, over: over };
  }

  function drawHist(ctx, sx, sy, H, color, baseline) {
    ctx.save();
    ctx.fillStyle = color;
    var y0 = sy(baseline || 0);
    for (var i = 0; i < H.counts.length; i++) {
      if (!H.counts[i]) continue;
      var xa = sx(H.x0 + i * H.bw), xb = sx(H.x0 + (i + 1) * H.bw);
      var yv = sy(H.counts[i]);
      var wbar = Math.max(1, xb - xa - 0.6);
      ctx.fillRect(xa + 0.3, yv, wbar, y0 - yv);
    }
    ctx.restore();
  }

  /* 正态密度曲线，按「期望计数」缩放后叠加在直方图上。
     frame 由 drawFrame 返回，用它自己的 sx/sy 反解横坐标，保证与柱子在同一个坐标系里。 */
  function drawNormalCurve(ctx, frame, mu, sigma, N, binW, color, dash) {
    if (!(sigma > 0)) return;
    var plot = frame.plot, xr = frame.xr;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    if (dash) ctx.setLineDash(dash);
    ctx.beginPath();
    var first = true;
    for (var px = plot.x; px <= plot.x + plot.w; px += 1) {
      var x = xr[0] + (px - plot.x) / plot.w * (xr[1] - xr[0]);
      var z = (x - mu) / sigma;
      var dens = Math.exp(-0.5 * z * z) / (sigma * Math.sqrt(2 * Math.PI));
      var yv = dens * N * binW;
      if (yv > frame.yr[1]) yv = frame.yr[1];
      if (first) { ctx.moveTo(px, frame.sy(yv)); first = false; } else ctx.lineTo(px, frame.sy(yv));
    }
    ctx.stroke();
    ctx.restore();
  }

  function vline(ctx, frame, x, color, dash, label) {
    if (x < frame.xr[0] || x > frame.xr[1]) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;
    if (dash) ctx.setLineDash(dash);
    var px = Math.round(frame.sx(x)) + 0.5;
    ctx.beginPath(); ctx.moveTo(px, frame.plot.y); ctx.lineTo(px, frame.plot.y + frame.plot.h); ctx.stroke();
    if (label) {
      ctx.setLineDash([]);
      ctx.font = 'bold 10px ui-monospace, monospace';
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(label, px, frame.plot.y - 3);
      noteContrast('参考线标签（μ / x̄）', C.panel, color);
    }
    ctx.restore();
  }

  /* 稳健取值范围：用分位数截断长尾，返回 [lo,hi] 与是否发生截断 */
  function robustRange(arr, pLo, pHi) {
    var s = asc(arr);
    var lo = quantile(s, pLo), hi = quantile(s, pHi);
    if (!(hi > lo)) { hi = lo + 1; }
    var span = hi - lo;
    lo -= span * 0.06; hi += span * 0.06;
    var clipped = s[0] < lo - 1e-12 || s[s.length - 1] > hi + 1e-12;
    return { lo: lo, hi: hi, clipped: clipped };
  }

  /* ---- 颜色工具：Canvas 里的文字也必须过 WCAG AA，不能想当然用灰色 ---- */
  function parseColor(c) {
    c = String(c).trim();
    var m;
    if ((m = /^#([0-9a-f]{3})$/i.exec(c))) {
      return [parseInt(m[1][0] + m[1][0], 16), parseInt(m[1][1] + m[1][1], 16), parseInt(m[1][2] + m[1][2], 16)];
    }
    if ((m = /^#([0-9a-f]{6})$/i.exec(c))) {
      return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)];
    }
    if ((m = /rgba?\(([^)]+)\)/.exec(c))) {
      var p = m[1].split(',').map(function (x) { return parseFloat(x); });
      return [p[0], p[1], p[2]];
    }
    return [128, 128, 128];
  }
  function relLum(rgb) {
    var f = rgb.map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
  }
  /* 半透明色叠在底色上，得到实际渲染色（用不透明色画，读数才准） */
  function composite(fg, alpha, bg) {
    var a = parseColor(fg), b = parseColor(bg);
    return 'rgb(' + a.map(function (v, i) { return Math.round(v * alpha + b[i] * (1 - alpha)); }).join(',') + ')';
  }
  /* 在给定底色上挑一个真的读得清的文字色（对比度取高者） */
  function readableOn(bgColor) {
    var L = relLum(parseColor(bgColor));
    var wWhite = 1.05 / (L + 0.05);
    var wDark = (L + 0.05) / 0.0556;   /* #0b1220 的相对亮度 ≈ 0.0056 */
    return wWhite >= wDark ? '#ffffff' : '#0b1220';
  }

  /* Canvas 里的文字 DOM 审计看不见 —— 所以每次画文字都记一笔 (底色, 字色)，
     暴露成 window.__slContrastLog，由外部测试断言每一对都 ≥ 4.5。 */
  var contrastLog = {};
  function noteContrast(where, bg, fg) {
    var lb = relLum(parseColor(bg)), lf = relLum(parseColor(fg));
    var hi = Math.max(lb, lf), lo = Math.min(lb, lf);
    contrastLog[where] = { where: where, bg: bg, fg: fg, ratio: +((hi + 0.05) / (lo + 0.05)).toFixed(2) };
  }
  window.__slContrastLog = contrastLog;

  /* ======================================================================
     3 · 全局状态
     ====================================================================== */
  var DEF = {
    clt: { dist: 'exponential', n: 2, sims: 2000, seed: 20261013 },
    bootstrap: { n: 25, B: 2000, conf: 0.95, seed: 19700101 },
    robust: { dist: 'normal', n: 25, sims: 2000, eps: 10, seed: 31415926 },
    simpson: { light: 90, sev: 30, margin: 5, aSev: 70, bSev: 20 }
  };
  var S = JSON.parse(JSON.stringify(DEF));

  /* 深链参数的合法区间（也是滑块的真实区间，保证状态与控件不会各说各话） */
  var RANGE = {
    'clt.n': [1, 100], 'clt.sims': [200, 5000],
    'bootstrap.n': [5, 200], 'bootstrap.B': [200, 5000],
    'robust.n': [5, 100], 'robust.sims': [200, 5000], 'robust.eps': [0, 30],
    'simpson.light': [50, 95], 'simpson.sev': [5, 60], 'simpson.margin': [0, 15],
    'simpson.aSev': [0, 100], 'simpson.bSev': [0, 100]
  };
  function clampKey(exp, key) {
    var r = RANGE[exp + '.' + key];
    if (!r) return;
    S[exp][key] = clamp(Math.round(S[exp][key]), r[0], r[1]);
  }

  /* 缓存：主题/尺寸变化时只重绘，不重算 */
  var cache = { clt: null, bootstrap: null, robust: null, coverage: null };

  /* ======================================================================
     4 · URL 深链
     ====================================================================== */
  var KEYS = {
    clt: [['dist', 'dist', 's'], ['n', 'n', 'i'], ['sims', 'sims', 'i'], ['seed', 'seed', 'i']],
    bootstrap: [['n', 'bsn', 'i'], ['B', 'bsB', 'i'], ['conf', 'conf', 'f'], ['seed', 'bseed', 'i']],
    robust: [['dist', 'rdist', 's'], ['n', 'rn', 'i'], ['sims', 'rsims', 'i'], ['eps', 'reps', 'i'], ['seed', 'rseed', 'i']],
    simpson: [['light', 'light', 'i'], ['sev', 'sev', 'i'], ['margin', 'margin', 'i'], ['aSev', 'asev', 'i'], ['bSev', 'bsev', 'i']]
  };

  /* 语种是否要写进 URL —— 由 i18n.js 决定（中文保持地址栏干净） */
  function langParam() {
    var I = window.SL_I18N;
    if (!I || !I.queryParam) return null;
    var lp = I.queryParam();
    return lp ? [lp.k, lp.v] : null;
  }

  function paramsFor(exp, subset) {    var p = new URLSearchParams();
    KEYS[exp].forEach(function (k) {
      if (subset && !subset[k[0]]) return;
      var v = S[exp][k[0]];
      p.set(k[1], k[2] === 'f' ? String(v) : String(v));
    });
    return p;
  }
  function fullQuery() {
    var p = new URLSearchParams();
    Object.keys(KEYS).forEach(function (exp) {
      paramsFor(exp).forEach(function (v, k) { p.set(k, v); });
    });
    /* lang 不是实验参数，但地址栏里既然有了就得留住 ——
       否则拖一次滑块就会把 ?lang=en 抹掉，分享出去变成中文版。 */
    var lp = langParam();
    if (lp) p.set(lp[0], lp[1]);
    return p.toString();
  }
  function syncUrl() {
    if (!history.replaceState) return;
    try {
      history.replaceState(null, '', location.pathname + '?' + fullQuery() + location.hash);
    } catch (e) { /* file:// 或隐私模式下忽略 */ }
  }
  function readUrl() {
    var p = new URLSearchParams(location.search);
    var got = false;
    Object.keys(KEYS).forEach(function (exp) {
      KEYS[exp].forEach(function (k) {
        var raw = p.get(k[1]);
        if (raw === null) return;
        var v;
        if (k[2] === 'i') v = parseInt(raw, 10);
        else if (k[2] === 'f') v = parseFloat(raw);
        else v = raw;
        if (k[2] !== 's' && !isFinite(v)) return;
        S[exp][k[0]] = v;
        got = true;
      });
    });
    /* 合法性收口：任何越界值都夹回滑块的真实区间，避免深链把页面搞崩 */
    ['n', 'sims'].forEach(function (k) { clampKey('clt', k); });
    S.clt.seed = (S.clt.seed | 0) || DEF.clt.seed;
    if (['uniform', 'exponential', 'bimodal', 'lognormal'].indexOf(S.clt.dist) < 0) S.clt.dist = DEF.clt.dist;

    ['n', 'B'].forEach(function (k) { clampKey('bootstrap', k); });
    if ([0.8, 0.9, 0.95, 0.99].indexOf(S.bootstrap.conf) < 0) S.bootstrap.conf = DEF.bootstrap.conf;
    S.bootstrap.seed = (S.bootstrap.seed | 0) || DEF.bootstrap.seed;

    ['n', 'sims', 'eps'].forEach(function (k) { clampKey('robust', k); });
    S.robust.seed = (S.robust.seed | 0) || DEF.robust.seed;
    if (['normal', 't3', 'contaminated', 'lognormal'].indexOf(S.robust.dist) < 0) S.robust.dist = DEF.robust.dist;

    ['light', 'sev', 'margin', 'aSev', 'bSev'].forEach(function (k) { clampKey('simpson', k); });
    return got;
  }

  /* ======================================================================
     5 · 实验 01 · 中心极限定理
     ====================================================================== */
  var POP_N = 30000;
  var popCache = {};

  function strHash(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  function population(key) {
    if (popCache[key]) return popCache[key];
    var rng = mulberry32(0x5EED ^ strHash(key));
    var g = makeGauss(rng);
    var d = new Array(POP_N);
    for (var i = 0; i < POP_N; i++) d[i] = distSample(key, rng, g, 0.1);
    popCache[key] = d;
    return d;
  }

  function computeClt(lowRes) {
    var key = S.clt.dist, n = S.clt.n;
    var sims = lowRes ? Math.min(S.clt.sims, 1200) : S.clt.sims;
    var rng = mulberry32(S.clt.seed), g = makeGauss(rng);
    var means = new Array(sims);
    for (var i = 0; i < sims; i++) {
      var s = 0;
      for (var j = 0; j < n; j++) s += distSample(key, rng, g, 0.1);
      means[i] = s / n;
    }
    var pop = population(key);
    var sigma = DISTS[key].sigma, mu = DISTS[key].mu;
    var rr = robustRange(means, 0.005, 0.995);
    var H = hist(means, rr.lo, rr.hi, 56);
    return {
      dist: key, n: n, sims: sims, means: means, pop: pop, H: H, range: rr,
      mu: mu, sigma: sigma, seTheory: sigma / Math.sqrt(n),
      seObs: sd(means), skew: skewness(means), meanOfMeans: mean(means)
    };
  }

  function drawClt(R) {
    /* —— 图 A：总体分布 —— */
    var cvA = $('clt-pop');
    var fA = fitCanvas(cvA);
    if (fA) {
      var p = R.pop;
      var pr = robustRange(p, 0.002, 0.985);
      var HA = hist(p, pr.lo, pr.hi, 60);
      var yMaxA = Math.max.apply(null, HA.counts) || 1;
      var frameA = drawFrame(fA.ctx, fA.w, fA.h, [pr.lo, pr.hi], [0, yMaxA * 1.12], { yLabel: tr('js.axis.count') });
      drawHist(fA.ctx, frameA.sx, frameA.sy, HA, C.c3);
      annotate(fA.ctx, fA.w, tr('js.clt.annotA', {
        mu: fmt(R.mu, 2), sigma: fmt(R.sigma, 2),
        clip: pr.clipped ? tr('js.clip.tail') : ''
      }));
      if (cvA.setAttribute) {
        cvA.setAttribute('aria-label', tr('js.clt.ariaA', {
          dist: distName(R.dist), mu: fmt(R.mu, 2), sigma: fmt(R.sigma, 2),
          lo: fmt(pr.lo, 2), hi: fmt(pr.hi, 2)
        }));
      }
    }

    /* —— 图 B：样本均值的抽样分布 —— */
    var cvB = $('clt-samp');
    var fB = fitCanvas(cvB);
    if (fB) {
      var H = R.H;
      var yMax = Math.max.apply(null, H.counts) || 1;
      var frameB = drawFrame(fB.ctx, fB.w, fB.h, [R.range.lo, R.range.hi], [0, yMax * 1.18], { yLabel: tr('js.axis.count') });
      drawHist(fB.ctx, frameB.sx, frameB.sy, H, C.c1);
      drawNormalCurve(fB.ctx, frameB, R.mu, R.seTheory, R.sims, H.bw, C.c2, [5, 4]);
      vline(fB.ctx, frameB, R.mu, C.ok, null, 'μ');
      annotate(fB.ctx, fB.w, tr('js.clt.annotB', {
        lo: fmt(R.range.lo, 2), hi: fmt(R.range.hi, 2), se: fmt(R.seTheory, 3),
        clip: R.range.clipped ? tr('js.clip.plain') : ''
      }));
      legend(fB.ctx, PAD.l + 4, fB.h - 8, [
        { c: C.c1, t: tr('js.clt.legend.obs', { sims: R.sims }) },
        { c: C.c2, t: tr('js.clt.legend.theory') }
      ]);
      if (cvB.setAttribute) {
        cvB.setAttribute('aria-label', tr('js.clt.ariaB', {
          sims: R.sims, n: R.n, seObs: fmt(R.seObs, 3),
          seTheory: fmt(R.seTheory, 3), skew: fmt(R.skew, 2)
        }));
      }
    }
  }

  function readoutClt(R) {
    $('clt-mu').textContent = fmt(R.mu, 3);
    $('clt-sigma').textContent = fmt(R.sigma, 3);
    $('clt-se-theory').textContent = fmt(R.seTheory, 4);
    $('clt-se-obs').textContent = fmt(R.seObs, 4);
    $('clt-skew').textContent = fmt(R.skew, 3);
    $('clt-pop-name').textContent = distName(R.dist);

    var a = Math.abs(R.skew), verdict;
    if (a < 0.15) verdict = tr('js.clt.v.near', { skew: fmt(R.skew, 2) });
    else if (a < 0.4) verdict = tr('js.clt.v.mid', { skew: fmt(R.skew, 2) });
    else verdict = tr('js.clt.v.far', { skew: fmt(R.skew, 2) });
    verdict += tr('js.clt.v.se', { seObs: fmt(R.seObs, 3), seTheory: fmt(R.seTheory, 3) });
    if (R.sims < S.clt.sims) verdict += tr('js.clt.v.live', { sims: R.sims });
    setVerdict('clt-verdict', verdict, false, R.liveOk);
  }

  function renderClt(lowRes) {
    var R = computeClt(lowRes);
    R.liveOk = !lowRes;
    cache.clt = R;
    drawClt(R);
    readoutClt(R);
  }

  /* ======================================================================
     6 · 实验 02 · Bootstrap 置信区间
     ====================================================================== */
  function drawBootstrap(R) { drawBootstrapImpl(R); }

  function computeBootstrap(lowRes) {
    var n = S.bootstrap.n;
    var B = lowRes ? Math.min(S.bootstrap.B, 900) : S.bootstrap.B;
    var rng = mulberry32(S.bootstrap.seed), g = makeGauss(rng);
    var sample = new Array(n);
    for (var i = 0; i < n; i++) sample[i] = Math.exp(LOGN_S * g());
    var xbar = mean(sample), s = sd(sample);

    var bmeans = new Array(B);
    var idx;
    for (var b = 0; b < B; b++) {
      var sum = 0;
      for (var j = 0; j < n; j++) {
        idx = (rng() * n) | 0;
        if (idx >= n) idx = n - 1;
        sum += sample[idx];
      }
      bmeans[b] = sum / n;
    }
    var sorted = asc(bmeans);
    var al = (1 - S.bootstrap.conf) / 2;
    var pLo = quantile(sorted, al), pHi = quantile(sorted, 1 - al);
    var z = invNorm(1 - al);
    var seBoot = sd(bmeans);
    var nLo = xbar - z * s / Math.sqrt(n), nHi = xbar + z * s / Math.sqrt(n);

    var rr = robustRange(bmeans.concat([nLo, nHi, xbar]), 0.004, 0.996);
    var H = hist(bmeans, rr.lo, rr.hi, 56);
    return {
      n: n, B: B, conf: S.bootstrap.conf, sample: sample, bmeans: bmeans, H: H, range: rr,
      xbar: xbar, s: s, seBoot: seBoot,
      pLo: pLo, pHi: pHi, nLo: nLo, nHi: nHi, z: z,
      trueMu: LOGN_MU, seed: S.bootstrap.seed
    };
  }

  function drawBootstrapImpl(R) {
    /* —— 图 A：原始样本 —— */
    var cvA = $('bs-sample');
    var fA = fitCanvas(cvA);
    if (fA) {
      var s = R.sample, sa = asc(s);
      var lo = Math.min(sa[0], R.trueMu, R.xbar), hi = Math.max(sa[sa.length - 1], R.trueMu, R.xbar);
      var pad = (hi - lo) * 0.08 || 1;
      lo -= pad; hi += pad;
      var frameA = drawFrame(fA.ctx, fA.w, fA.h, [lo, hi], [0, 1], { yTicks: false, xTicks: true });
      var ctx = fA.ctx, plot = frameA.plot;
      var yBase = plot.y + plot.h * 0.62;
      ctx.save();
      /* 抖动：同一值附近的点错开，避免叠成一团 */
      var jr = mulberry32(7);
      for (var i = 0; i < s.length; i++) {
        var px = frameA.sx(s[i]);
        var py = yBase - (jr() - 0.5) * plot.h * 0.42;
        ctx.beginPath();
        ctx.fillStyle = C.c1;
        ctx.globalAlpha = 0.72;
        ctx.arc(px, py, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      /* 样本均值与真实 μ */
      var mx = Math.round(frameA.sx(R.xbar)) + 0.5;
      ctx.strokeStyle = C.c2; ctx.lineWidth = 2; ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(mx, plot.y); ctx.lineTo(mx, plot.y + plot.h); ctx.stroke();
      var tx = Math.round(frameA.sx(R.trueMu)) + 0.5;
      ctx.strokeStyle = C.ok; ctx.lineWidth = 1.6; ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(tx, plot.y); ctx.lineTo(tx, plot.y + plot.h); ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = '10px ui-monospace, monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillStyle = C.c2; ctx.fillText('x̄', mx, plot.y + 2);
      ctx.fillStyle = C.ok; ctx.fillText('μ', tx, plot.y + 16);
      ctx.restore();
      noteContrast('样本散点图 · x̄ 标记', C.panel, C.c2);
      noteContrast('样本散点图 · μ 标记', C.panel, C.ok);
      annotate(ctx, fA.w, tr('js.bs.annotA', { n: R.n, s: fmt(R.s, 3) }));
      if (cvA.setAttribute) cvA.setAttribute('aria-label', tr('js.bs.ariaA', {
        n: R.n, xbar: fmt(R.xbar, 3), s: fmt(R.s, 3), trueMu: fmt(R.trueMu, 3)
      }));
    }

    /* —— 图 B：bootstrap 分布 + 区间 —— */
    var cvB = $('bs-dist');
    var fB = fitCanvas(cvB);
    if (fB) {
      var H = R.H, ctxB = fB.ctx;
      var yMax = Math.max.apply(null, H.counts) || 1;
      var frameB = drawFrame(ctxB, fB.w, fB.h, [R.range.lo, R.range.hi], [0, yMax * 1.16], { yLabel: tr('js.axis.count') });
      /* 百分位区间阴影 */
      var xa = frameB.sx(R.pLo), xb = frameB.sx(R.pHi);
      ctxB.save();
      ctxB.fillStyle = C.band;
      ctxB.fillRect(xa, frameB.plot.y, Math.max(1, xb - xa), frameB.plot.h);
      ctxB.restore();
      drawHist(ctxB, frameB.sx, frameB.sy, H, C.c1);
      vline(ctxB, frameB, R.pLo, C.c1, [4, 3], null);
      vline(ctxB, frameB, R.pHi, C.c1, [4, 3], null);
      vline(ctxB, frameB, R.xbar, C.c2, null, 'x̄');
      vline(ctxB, frameB, R.trueMu, C.ok, [5, 4], 'μ');
      legend(ctxB, PAD.l + 4, fB.h - 8, [
        { c: C.band, t: tr('js.bs.legend.band', { conf: pct(R.conf, 0) }) },
        { c: C.c1, t: tr('js.bs.legend.boot', { B: R.B }) }
      ]);
      annotate(ctxB, fB.w, tr('js.bs.annotB', { lo: fmt(R.pLo, 3), hi: fmt(R.pHi, 3) }));
      if (cvB.setAttribute) cvB.setAttribute('aria-label', tr('js.bs.ariaB', {
        B: R.B, conf: pct(R.conf, 0), pLo: fmt(R.pLo, 3), pHi: fmt(R.pHi, 3),
        nLo: fmt(R.nLo, 3), nHi: fmt(R.nHi, 3)
      }));
    }

    /* —— 图 C：覆盖率元实验 —— */
    var figC = $('bs-cov-fig');
    if (!figC) return;
    /* 模拟进行中绝不动这块图的可见性：否则 ResizeObserver 触发的一次重绘
       会在模拟途中把它重新 hidden，等模拟跑完画布已是 0 宽，白算一场。 */
    if (covRunning) return;
    if (cache.coverage && cache.coverage.n === R.n && cache.coverage.conf === R.conf) {
      figC.hidden = false;
      drawCoverage(cache.coverage);
    }
    /* 参数失效时的隐藏统一交给 invalidateCoverage()，这里不做「否则就隐藏」 */
  }

  function readoutBootstrap(R) {
    $('bs-sample-note').textContent = tr('js.bs.sampleNote', { n: R.n });
    $('bs-mean').textContent = fmt(R.xbar, 3);
    $('bs-sd').textContent = fmt(R.s, 3);
    $('bs-perc').textContent = '[' + fmt(R.pLo, 3) + ', ' + fmt(R.pHi, 3) + ']';
    $('bs-norm').textContent = '[' + fmt(R.nLo, 3) + ', ' + fmt(R.nHi, 3) + ']';
    $('bs-width').textContent = fmt(R.pHi - R.pLo, 3);
    $('bs-true').textContent = fmt(R.trueMu, 3);

    var covers = R.pLo <= R.trueMu && R.trueMu <= R.pHi;
    var v = tr('js.bs.v.head', { conf: pct(R.conf, 0), pLo: fmt(R.pLo, 3), pHi: fmt(R.pHi, 3) }) +
      (covers
        ? tr('js.bs.v.cover', { trueMu: fmt(R.trueMu, 3) })
        : tr('js.bs.v.miss', { trueMu: fmt(R.trueMu, 3), miss: pct(1 - R.conf, 0) }));
    var ratio = (R.pHi - R.pLo) / Math.max(1e-9, R.nHi - R.nLo);
    v += tr(ratio > 1.12 ? 'js.bs.v.wide' : 'js.bs.v.sym', { ratio: fmt(ratio, 2) });
    setVerdict('bs-verdict', v, false, R.liveOk);
  }

  function renderBootstrap(lowRes) {
    var R = computeBootstrap(lowRes);
    R.liveOk = !lowRes;
    cache.bootstrap = R;
    drawBootstrap(R);
    readoutBootstrap(R);
  }

  /* —— 覆盖率元实验：分帧跑，避免卡住主线程 —— */
  var covRunning = false;
  function runCoverage() {
    if (covRunning) return;
    var n = S.bootstrap.n, conf = S.bootstrap.conf;
    var M = 200, Bc = Math.min(S.bootstrap.B, 600);
    var al = (1 - conf) / 2;
    var rng = mulberry32(S.bootstrap.seed ^ 0x9E3779B9), g = makeGauss(rng);
    var covers = new Array(M), los = new Array(M), his = new Array(M);
    var btn = $('bs-cover'), figC = $('bs-cov-fig');
    covRunning = true;
    btn.disabled = true;
    btn.textContent = tr('js.bs.run.start', { M: M });
    figC.hidden = false;

    var done = 0;
    function chunk() {
      var end = Math.min(M, done + 5);
      for (; done < end; done++) {
        var sample = new Array(n), i;
        for (i = 0; i < n; i++) sample[i] = Math.exp(LOGN_S * g());
        var bm = new Array(Bc);
        for (var b = 0; b < Bc; b++) {
          var sum = 0;
          for (i = 0; i < n; i++) { var k = (rng() * n) | 0; if (k >= n) k = n - 1; sum += sample[k]; }
          bm[b] = sum / n;
        }
        var srt = asc(bm);
        los[done] = quantile(srt, al);
        his[done] = quantile(srt, 1 - al);
        covers[done] = (los[done] <= LOGN_MU && LOGN_MU <= his[done]);
      }
      var cov = covers.slice(0, done).filter(Boolean).length / done;
      btn.textContent = tr('js.bs.run.progress', { done: done, M: M, cov: pct(cov, 1) });
      if (done < M) { requestAnimationFrame(chunk); return; }

      cache.coverage = { n: n, conf: conf, M: M, B: Bc, covers: covers, los: los, his: his, rate: cov, trueMu: LOGN_MU };
      covRunning = false;
      btn.disabled = false;
      btn.textContent = tr('js.bs.run.again');
      drawCoverage(cache.coverage);
      /* 覆盖率本身也是估计：M 份样本的标准误约 sqrt(p(1-p)/M)，不拿它当精确值 */
      var se = Math.sqrt(conf * (1 - conf) / M);
      var dev = (cov - conf) * 100;
      var band = 2 * se;
      var tail = cov < conf - band
        ? tr('js.bs.meta.under', { dev: Math.abs(dev).toFixed(1), band: pct(band, 1), n: n })
        : (cov > conf + band
          ? tr('js.bs.meta.over', { dev: dev.toFixed(1), band: pct(band, 1) })
          : tr('js.bs.meta.ok', { dev: (dev >= 0 ? '+' : '−') + Math.abs(dev).toFixed(1), band: pct(band, 1) }));
      setVerdict('bs-verdict',
        tr('js.bs.meta.head', { M: M, cov: pct(cov, 1), conf: pct(conf, 0) }) + tail +
        tr('js.bs.meta.foot', { B: Bc }), false, true);
    }
    requestAnimationFrame(chunk);
  }

  function drawCoverage(cov) {
    var cv = $('bs-cov');
    var f = fitCanvas(cv);
    if (!f) return;
    var ctx = f.ctx;
    var all = cov.los.concat(cov.his, [cov.trueMu]);
    var rr = robustRange(all, 0.01, 0.99);
    var frame = drawFrame(ctx, f.w, f.h, [rr.lo, rr.hi], [0, cov.M], { yLabel: tr('js.axis.sampleIndex') });
    var plot = frame.plot;
    /* 200 条区间：从下往上排，与纵轴一致 */
    var rowH = plot.h / cov.M;
    for (var i = 0; i < cov.M; i++) {
      var y = plot.y + plot.h - (i + 0.5) * rowH;
      var xa = frame.sx(clamp(cov.los[i], rr.lo, rr.hi));
      var xb = frame.sx(clamp(cov.his[i], rr.lo, rr.hi));
      ctx.save();
      ctx.strokeStyle = cov.covers[i] ? C.ok : C.bad;
      ctx.lineWidth = Math.max(1, rowH * 0.72);
      ctx.beginPath(); ctx.moveTo(xa, y); ctx.lineTo(xb, y); ctx.stroke();
      ctx.restore();
    }
    /* 真值竖线画在区间之上，确保可见 */
    vline(ctx, frame, cov.trueMu, C.ok, [5, 4], 'μ');
    annotate(ctx, f.w, tr('js.bs.annotC', {
      rate: pct(cov.rate, 1), conf: pct(cov.conf, 0), M: cov.M
    }));
    if (cv.setAttribute) cv.setAttribute('aria-label', tr('js.bs.ariaC', {
      M: cov.M, rate: pct(cov.rate, 1), trueMu: fmt(cov.trueMu, 3), conf: pct(cov.conf, 0)
    }));
  }

  /* ======================================================================
     7 · 实验 03 · 均值 vs 中位数
     ====================================================================== */
  function medianOf(a) {
    var s = asc(a), n = s.length;
    if (!n) return NaN;
    return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  }

  function computeRobust(lowRes) {
    var key = S.robust.dist, n = S.robust.n, eps = S.robust.eps / 100;
    var sims = lowRes ? Math.min(S.robust.sims, 1200) : S.robust.sims;
    var rng = mulberry32(S.robust.seed), g = makeGauss(rng);
    var means = new Array(sims), meds = new Array(sims);
    var buf = new Array(n);
    for (var i = 0; i < sims; i++) {
      for (var j = 0; j < n; j++) buf[j] = distSample(key, rng, g, eps);
      means[i] = mean(buf);
      meds[i] = medianOf(buf);
    }
    var pop = (function () {
      var r2 = mulberry32(0xB0B0 ^ strHash('pop:' + key)), g2 = makeGauss(r2);
      var d = new Array(POP_N);
      for (var k = 0; k < POP_N; k++) d[k] = distSample(key, r2, g2, eps);
      return d;
    })();

    var all = means.concat(meds);
    var rr = robustRange(all, 0.008, 0.992);
    var Hm = hist(means, rr.lo, rr.hi, 48);
    var Hd = hist(meds, rr.lo, rr.hi, 48);
    var seM = sd(means), seD = sd(meds);
    return {
      dist: key, n: n, sims: sims, eps: eps, means: means, meds: meds, pop: pop,
      Hm: Hm, Hd: Hd, range: rr, seMean: seM, seMed: seD,
      skewMean: skewness(means), skewMed: skewness(meds),
      sigma: distSigma(key, eps), mu: DISTS[key].mu
    };
  }

  function drawRobust(R) {
    var cvA = $('rb-pop'), fA = fitCanvas(cvA);
    if (fA) {
      var pr = robustRange(R.pop, 0.005, 0.985);
      var HA = hist(R.pop, pr.lo, pr.hi, 60);
      var yMaxA = Math.max.apply(null, HA.counts) || 1;
      var frameA = drawFrame(fA.ctx, fA.w, fA.h, [pr.lo, pr.hi], [0, yMaxA * 1.12], { yLabel: tr('js.axis.count') });
      drawHist(fA.ctx, frameA.sx, frameA.sy, HA, C.c3);
      annotate(fA.ctx, fA.w, tr('js.rb.annotA', {
        sigma: fmt(R.sigma, 2),
        eps: R.dist === 'contaminated' ? '  ε=' + pct(R.eps, 0) : '',
        clip: pr.clipped ? tr('js.clip.tail') : ''
      }));
      if (cvA.setAttribute) cvA.setAttribute('aria-label', tr('js.rb.ariaA', {
        dist: distName(R.dist), sigma: fmt(R.sigma, 2)
      }));
    }

    var cvB = $('rb-samp'), fB = fitCanvas(cvB);
    if (fB) {
      var yMax = Math.max(Math.max.apply(null, R.Hm.counts), Math.max.apply(null, R.Hd.counts)) || 1;
      var frameB = drawFrame(fB.ctx, fB.w, fB.h, [R.range.lo, R.range.hi], [0, yMax * 1.16], { yLabel: tr('js.axis.count') });
      /* 两个直方图半透明叠加，重叠处能看出谁更瘦 */
      fB.ctx.save();
      fB.ctx.globalAlpha = 0.62;
      drawHist(fB.ctx, frameB.sx, frameB.sy, R.Hm, C.c1);
      drawHist(fB.ctx, frameB.sx, frameB.sy, R.Hd, C.c2);
      fB.ctx.restore();
      vline(fB.ctx, frameB, R.mu, C.ok, [5, 4], 'μ');
      legend(fB.ctx, PAD.l + 4, fB.h - 8, [
        { c: C.c1, t: tr('js.rb.legend.mean', { se: fmt(R.seMean, 3) }) },
        { c: C.c2, t: tr('js.rb.legend.med', { se: fmt(R.seMed, 3) }) }
      ]);
      annotate(fB.ctx, fB.w, tr('js.rb.annotB', {
        r: fmt(R.seMed / R.seMean, 3),
        clip: R.range.clipped ? tr('js.clip.plain') : ''
      }));
      if (cvB.setAttribute) cvB.setAttribute('aria-label', tr('js.rb.ariaB', {
        seMean: fmt(R.seMean, 4), seMed: fmt(R.seMed, 4), ratio: fmt(R.seMed / R.seMean, 3)
      }));
    }
  }

  function readoutRobust(R) {
    var ratio = R.seMed / R.seMean;
    $('rb-pop-name').textContent = distName(R.dist) +
      (R.dist === 'contaminated' ? tr('js.rb.nameEps', { eps: pct(R.eps, 0) }) : '');
    $('rb-se-mean').textContent = fmt(R.seMean, 4);
    $('rb-se-med').textContent = fmt(R.seMed, 4);
    $('rb-eff').textContent = fmt(ratio, 3);
    $('rb-skew-mean').textContent = fmt(R.skewMean, 3);
    $('rb-skew-med').textContent = fmt(R.skewMed, 3);

    var v;
    if (ratio > 1.06) {
      v = tr('js.rb.v.mean', { ratio: fmt(ratio, 2), sq: fmt(ratio * ratio, 2) }) +
        (R.dist === 'normal' ? tr('js.rb.v.meanNormal') : '');
    } else if (ratio < 0.94) {
      v = tr('js.rb.v.med', { ratio: fmt(ratio, 2), skew: fmt(R.skewMean, 2) });
    } else {
      v = tr('js.rb.v.tie', { ratio: fmt(ratio, 2) });
    }
    v += tr('js.rb.v.foot', { n: R.n, sims: R.sims });
    setVerdict('rb-verdict', v, false, R.liveOk);
  }

  function renderRobust(lowRes) {
    var R = computeRobust(lowRes);
    R.liveOk = !lowRes;
    cache.robust = R;
    drawRobust(R);
    readoutRobust(R);
  }

  /* ======================================================================
     8 · 实验 04 · 辛普森悖论
     ====================================================================== */
  var SP_N = 1000; /* 每组固定 1000 名病例，数字干净好读 */

  function computeSimpson() {
    var p = S.simpson;
    var lightB = p.light / 100, sevB = p.sev / 100, margin = p.margin / 100;
    var lightA = Math.min(1, lightB + margin), sevA = Math.min(1, sevB + margin);
    var aSevShare = p.aSev / 100, bSevShare = p.bSev / 100;

    var aSevN = Math.round(SP_N * aSevShare), aLightN = SP_N - aSevN;
    var bSevN = Math.round(SP_N * bSevShare), bLightN = SP_N - bSevN;

    var cells = {
      lightA: { n: aLightN, rate: lightA }, lightB: { n: bLightN, rate: lightB },
      sevA: { n: aSevN, rate: sevA }, sevB: { n: bSevN, rate: sevB }
    };
    Object.keys(cells).forEach(function (k) { cells[k].succ = Math.round(cells[k].n * cells[k].rate); });

    var aAll = { n: SP_N, succ: cells.lightA.succ + cells.sevA.succ };
    var bAll = { n: SP_N, succ: cells.lightB.succ + cells.sevB.succ };
    aAll.rate = aAll.succ / aAll.n; bAll.rate = bAll.succ / bAll.n;

    var withinWin = (lightA > lightB) && (sevA > sevB);
    var paradox = withinWin && (aAll.rate < bAll.rate);
    return {
      lightA: lightA, lightB: lightB, sevA: sevA, sevB: sevB,
      cells: cells, aAll: aAll, bAll: bAll,
      aSevShare: aSevShare, bSevShare: bSevShare,
      withinWin: withinWin, paradox: paradox, margin: margin
    };
  }

  function barChart(canvas, groups, colors, yLabel, opts) {
    var f = fitCanvas(canvas);
    if (!f) return;
    var ctx = f.ctx;
    var frame = drawFrame(ctx, f.w, f.h, [0, groups.length], [0, 1], {
      yLabel: yLabel, xTicks: false,
      yFormat: function (v) { return (v * 100).toFixed(0) + '%'; }
    });
    var plot = frame.plot;
    var n = groups.length;
    var slot = plot.w / n;
    var bw = Math.min(46, slot * 0.6);

    /* 分组标签 + 组间虚线：把「同一层内比较」这层结构画出来 */
    if (opts && opts.groupLabels) {
      ctx.save();
      ctx.font = 'bold 10px ui-monospace, monospace';
      ctx.fillStyle = C.text2;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      opts.groupLabels.forEach(function (label, gi) {
        ctx.fillText(label, plot.x + slot * (gi * 2 + 1), plot.y - 4);
      });
      ctx.restore();
    }
    if (opts && opts.separatorAfter != null) {
      var sx = Math.round(plot.x + slot * (opts.separatorAfter + 1)) + 0.5;
      ctx.save();
      ctx.strokeStyle = C.grid; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(sx, plot.y); ctx.lineTo(sx, plot.y + plot.h); ctx.stroke();
      ctx.restore();
    }

    for (var i = 0; i < n; i++) {
      var g = groups[i];
      var cx = plot.x + slot * (i + 0.5);
      var yv = frame.sy(g.value);
      ctx.save();
      ctx.fillStyle = colors[i % colors.length];
      ctx.fillRect(cx - bw / 2, yv, bw, frame.sy(0) - yv);
      ctx.font = 'bold 11px ui-monospace, monospace';
      ctx.fillStyle = C.text;
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText((g.value * 100).toFixed(1) + '%', cx, yv - 4);
      ctx.font = '10px ui-monospace, monospace';
      ctx.fillStyle = C.text2;
      ctx.textBaseline = 'top';
      ctx.fillText(g.label, cx, plot.y + plot.h + 7);
      if (g.sub) {
        ctx.fillStyle = C.axis;
        ctx.fillText(g.sub, cx, plot.y + plot.h + 19);
      }
      ctx.restore();
    }
    noteContrast('柱值标签', C.panel, C.text);
    noteContrast('柱下分组名', C.panel, C.text2);
    if (opts && opts.groupLabels) noteContrast('分组标题', C.panel, C.text2);
  }

  function mixChart(canvas, rows) {
    var f = fitCanvas(canvas);
    if (!f) return;
    var ctx = f.ctx;
    var plot = { x: PAD.l, y: PAD.t + 8, w: f.w - PAD.l - PAD.r, h: f.h - PAD.t - PAD.b - 8 };
    var rowH = plot.h / rows.length;
    var bh = Math.min(36, rowH * 0.54);
    /* 段色先合成成不透明色：既避免叠加误差，也让「该用深字还是浅字」算得准 */
    var lightFill = composite(C.c1, 0.42, C.panel);
    var sevFill = composite(C.c3, 1, C.panel);

    ctx.save();
    ctx.font = '10px ui-monospace, monospace';
    ctx.fillStyle = C.axis;
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 1;
    for (var t = 0; t <= 4; t++) {
      var v = t / 4;
      var px = Math.round(plot.x + v * plot.w) + 0.5;
      ctx.beginPath(); ctx.moveTo(px, plot.y); ctx.lineTo(px, plot.y + plot.h); ctx.stroke();
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText((v * 100).toFixed(0) + '%', px, plot.y + plot.h + 5);
    }
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var cy = plot.y + rowH * i + rowH / 2;
      var y = cy - bh / 2;
      var wSev = r.sevShare * plot.w;
      var wLight = plot.w - wSev;
      ctx.fillStyle = lightFill;
      ctx.fillRect(plot.x, y, wLight, bh);
      ctx.fillStyle = sevFill;
      ctx.fillRect(plot.x + wLight, y, wSev, bh);
      ctx.strokeStyle = C.grid;
      ctx.strokeRect(plot.x + 0.5, y + 0.5, plot.w - 1, bh - 1);
      /* 组名 */
      ctx.fillStyle = C.text;
      ctx.font = 'bold 11px ui-monospace, monospace';
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText(r.label, plot.x - 7, cy);
      /* 段内标签：文字色由段底色亮度决定，不是固定灰 */
      ctx.font = '10px ui-monospace, monospace';
      ctx.textAlign = 'center';
      if (wSev > 48) {
        ctx.fillStyle = readableOn(sevFill);
        ctx.fillText(tr('js.sp.mix.severe', { p: (r.sevShare * 100).toFixed(0) + '%' }), plot.x + wLight + wSev / 2, cy);
        noteContrast('构成条 · 重症段内标签', sevFill, readableOn(sevFill));
      }
      if (wLight > 58) {
        ctx.fillStyle = readableOn(lightFill);
        ctx.fillText(tr('js.sp.mix.mild', { p: ((1 - r.sevShare) * 100).toFixed(0) + '%' }), plot.x + wLight / 2, cy);
        noteContrast('构成条 · 轻症段内标签', lightFill, readableOn(lightFill));
      }
    }
    ctx.restore();
    noteContrast('构成条 · 轴标签', C.panel, C.axis);
    noteContrast('构成条 · 组名', C.panel, C.text);
  }

  function drawSimpson(R) {
    barChart($('sp-strata'), [
      { label: tr('js.sp.mildA'), value: R.lightA },
      { label: tr('js.sp.mildB'), value: R.lightB },
      { label: tr('js.sp.sevA'), value: R.sevA },
      { label: tr('js.sp.sevB'), value: R.sevB }
    ], [C.c1, C.c2, C.c1, C.c2], tr('js.axis.successRate'), {
      separatorAfter: 1,
      groupLabels: [tr('js.sp.group.mild'), tr('js.sp.group.sev')]
    });
    barChart($('sp-pooled'), [
      { label: tr('js.sp.pooledA'), value: R.aAll.rate },
      { label: tr('js.sp.pooledB'), value: R.bAll.rate }
    ], [C.c1, C.c2], tr('js.axis.successRate'));
    mixChart($('sp-mix'), [
      { label: tr('js.sp.armA'), sevShare: R.aSevShare },
      { label: tr('js.sp.armB'), sevShare: R.bSevShare }
    ]);

    var cvS = $('sp-strata');
    if (cvS && cvS.setAttribute) cvS.setAttribute('aria-label', tr('js.sp.ariaA', {
      la: pct(R.lightA, 1), lb: pct(R.lightB, 1), sa: pct(R.sevA, 1), sb: pct(R.sevB, 1)
    }));
    var cvP = $('sp-pooled');
    if (cvP && cvP.setAttribute) cvP.setAttribute('aria-label', tr('js.sp.ariaB', {
      a: pct(R.aAll.rate, 1), b: pct(R.bAll.rate, 1)
    }));
    var cvM = $('sp-mix');
    if (cvM && cvM.setAttribute) cvM.setAttribute('aria-label', tr('js.sp.ariaC', {
      a: pct(R.aSevShare, 0), b: pct(R.bSevShare, 0)
    }));
  }

  function readoutSimpson(R) {
    var c = R.cells;
    var set = function (id, cell) {
      $(id).textContent = cell.succ + '/' + cell.n + ' = ' + pct(cell.rate, 1);
    };
    set('sp-t-light-a', c.lightA); set('sp-t-light-b', c.lightB);
    set('sp-t-sev-a', c.sevA); set('sp-t-sev-b', c.sevB);
    set('sp-t-all-a', R.aAll); set('sp-t-all-b', R.bAll);
    var diff = function (id, a, b) {
      var d = a - b;
      var el = $(id);
      el.textContent = signedPct(d);
      el.className = d >= 0 ? 'is-win' : 'is-lose';
    };
    diff('sp-t-light-d', R.lightA, R.lightB);
    diff('sp-t-sev-d', R.sevA, R.sevB);
    diff('sp-t-all-d', R.aAll.rate, R.bAll.rate);

    var v;
    if (R.paradox) {
      v = tr('js.sp.v.paradox', {
        la: pct(R.lightA, 1), lb: pct(R.lightB, 1), sa: pct(R.sevA, 1), sb: pct(R.sevB, 1),
        pa: pct(R.aAll.rate, 1), pb: pct(R.bAll.rate, 1),
        aShare: pct(R.aSevShare, 0), bShare: pct(R.bSevShare, 0)
      });
    } else if (R.withinWin) {
      v = tr('js.sp.v.gone', {
        pa: pct(R.aAll.rate, 1), pb: pct(R.bAll.rate, 1),
        gap: Math.abs(R.aSevShare - R.bSevShare) * 100
      });
    } else {
      v = tr('js.sp.v.none');
    }
    setVerdict('sp-verdict', v, R.paradox, true);
  }

  function renderSimpson() {
    var R = computeSimpson();
    cache.simpson = R;
    drawSimpson(R);
    readoutSimpson(R);
  }

  /* ======================================================================
     9 · 通用：verdict 写入 + 节流渲染
     ====================================================================== */
  function setVerdict(id, html, flip, live) {
    var el = $(id);
    if (!el) return;
    var wasLive = el.getAttribute('aria-live');
    /* 拖动中先摘掉 aria-live，避免屏幕阅读器被高频更新淹没 */
    if (live === false) el.setAttribute('aria-live', 'off');
    else el.setAttribute('aria-live', 'polite');
    el.innerHTML = html;
    if (live === false && wasLive !== 'off') el.setAttribute('aria-live', 'polite');
    if (flip) el.classList.add('is-flip'); else el.classList.remove('is-flip');
  }

  var pending = {};
  /* 节流：同一帧内 input 与 change 会连着来。若只保留「第一个」回调，
     change 带来的「提交态」会被吞掉（URL 不同步、低精度预览变终态）。
     所以这里用「最新的回调覆盖旧的」——提交态永远赢。 */
  function schedule(name, fn) {
    var slot = pending[name];
    if (slot) { slot.fn = fn; return; }
    slot = pending[name] = { fn: fn };
    requestAnimationFrame(function () {
      var f = pending[name] && pending[name].fn;
      delete pending[name];
      if (f) f();
    });
  }

  /* ======================================================================
     10 · 控件绑定
     ====================================================================== */
  function bindRange(id, outId, onInput, fmtFn) {
    var el = $(id), out = $(outId);
    if (!el) return;
    var paint = function () {
      if (out) out.textContent = fmtFn ? fmtFn(el.value) : el.value;
      el.setAttribute('aria-valuetext', fmtFn ? fmtFn(el.value) : el.value);
    };
    paint();
    el.addEventListener('input', function () { paint(); onInput(false); });
    el.addEventListener('change', function () { paint(); onInput(true); });
  }

  function bindSelect(id, onChange) {
    var el = $(id);
    if (!el) return;
    el.addEventListener('change', function () { onChange(true); });
  }

  function bindButton(id, fn) {
    var el = $(id);
    if (el) el.addEventListener('click', fn);
  }

  function wireClt() {
    bindSelect('clt-dist', function () { schedule('clt', function () { renderClt(false); syncUrl(); }); });
    bindRange('clt-n', 'clt-n-out', function (commit) {
      S.clt.n = parseInt($('clt-n').value, 10);
      schedule('clt', function () { renderClt(!commit); if (commit) syncUrl(); });
    });
    bindRange('clt-sims', 'clt-sims-out', function (commit) {
      S.clt.sims = parseInt($('clt-sims').value, 10);
      schedule('clt', function () { renderClt(!commit); if (commit) syncUrl(); });
    });
    bindButton('clt-reseed', function () {
      S.clt.seed = (Math.random() * 0x7fffffff) | 0;
      renderClt(false); syncUrl();
    });
    bindButton('clt-converge', function () { runConvergence(); });
  }

  /* —— 收敛动画：让 n 从 1 走到 60，直观看到「变正态」 —— */
  var converging = false;
  function runConvergence() {
    if (converging) return;
    var btn = $('clt-converge');
    var steps = [1, 2, 3, 4, 5, 7, 9, 12, 15, 20, 26, 34, 44, 60];
    if (reduceMotion) { steps = [1, 60]; }
    converging = true;
    btn.disabled = true;
    var i = 0, t0 = performance.now(), dur = reduceMotion ? 400 : 3200;
    function step(now) {
      var k = Math.min(1, (now - t0) / dur);
      var target = Math.floor(k * (steps.length - 1));
      if (target >= i) {
        i = target + 1;
        S.clt.n = steps[Math.min(target, steps.length - 1)];
        $('clt-n').value = S.clt.n;
        $('clt-n-out').textContent = S.clt.n;
        $('clt-n').setAttribute('aria-valuetext', String(S.clt.n));
        renderClt(false);
        setVerdict('clt-verdict', $('clt-verdict').innerHTML, false, false);
      }
      if (k < 1) { requestAnimationFrame(step); return; }
      converging = false;
      btn.disabled = false;
      S.clt.n = steps[steps.length - 1];
      $('clt-n').value = S.clt.n;
      $('clt-n-out').textContent = S.clt.n;
      renderClt(false);
      syncUrl();
    }
    requestAnimationFrame(step);
  }

  function wireBootstrap() {
    bindRange('bs-n', 'bs-n-out', function (commit) {
      S.bootstrap.n = parseInt($('bs-n').value, 10);
      invalidateCoverage();
      schedule('bs', function () { renderBootstrap(!commit); if (commit) syncUrl(); });
    });
    bindRange('bs-B', 'bs-B-out', function (commit) {
      S.bootstrap.B = parseInt($('bs-B').value, 10);
      invalidateCoverage();
      schedule('bs', function () { renderBootstrap(!commit); if (commit) syncUrl(); });
    });
    bindSelect('bs-conf', function () {
      S.bootstrap.conf = parseFloat($('bs-conf').value);
      invalidateCoverage();
      renderBootstrap(false); syncUrl();
    });
    bindButton('bs-reseed', function () {
      S.bootstrap.seed = (Math.random() * 0x7fffffff) | 0;
      invalidateCoverage();
      renderBootstrap(false); syncUrl();
    });
    bindButton('bs-cover', runCoverage);
  }

  function invalidateCoverage() {
    cache.coverage = null;
    var figC = $('bs-cov-fig');
    if (figC) figC.hidden = true;
    var btn = $('bs-cover');
    if (btn && !covRunning) btn.textContent = tr('lab2.btn.cover');
  }

  function wireRobust() {
    bindSelect('rb-dist', function () {
      syncRobustEpsVisibility();
      schedule('rb', function () { renderRobust(false); syncUrl(); });
    });
    bindRange('rb-eps', 'rb-eps-out', function (commit) {
      S.robust.eps = parseInt($('rb-eps').value, 10);
      schedule('rb', function () { renderRobust(!commit); if (commit) syncUrl(); });
    }, function (v) { return v + '%'; });
    bindRange('rb-n', 'rb-n-out', function (commit) {
      S.robust.n = parseInt($('rb-n').value, 10);
      schedule('rb', function () { renderRobust(!commit); if (commit) syncUrl(); });
    });
    bindRange('rb-sims', 'rb-sims-out', function (commit) {
      S.robust.sims = parseInt($('rb-sims').value, 10);
      schedule('rb', function () { renderRobust(!commit); if (commit) syncUrl(); });
    });
    bindButton('rb-reseed', function () {
      S.robust.seed = (Math.random() * 0x7fffffff) | 0;
      renderRobust(false); syncUrl();
    });
  }

  function syncRobustEpsVisibility() {
    var ctrl = $('rb-eps-ctrl');
    if (ctrl) ctrl.hidden = S.robust.dist !== 'contaminated';
  }

  function wireSimpson() {
    var ids = ['sp-light', 'sp-sev', 'sp-margin', 'sp-a-sev', 'sp-b-sev'];
    var map = { 'sp-light': ['light', function (v) { return v + '%'; }],
                'sp-sev': ['sev', function (v) { return v + '%'; }],
                'sp-margin': ['margin', function (v) { return tr('js.ppPlus', { v: v }); }],
                'sp-a-sev': ['aSev', function (v) { return v + '%'; }],
                'sp-b-sev': ['bSev', function (v) { return v + '%'; }] };
    ids.forEach(function (id) {
      bindRange(id, id + '-out', function (commit) {
        S.simpson[map[id][0]] = parseInt($(id).value, 10);
        schedule('sp', function () { renderSimpson(); if (commit) syncUrl(); });
      }, map[id][1]);
    });
    bindButton('sp-fix', function () {
      var avg = Math.round((S.simpson.aSev + S.simpson.bSev) / 2);
      S.simpson.aSev = avg; S.simpson.bSev = avg;
      $('sp-a-sev').value = avg; $('sp-a-sev-out').textContent = avg + '%';
      $('sp-b-sev').value = avg; $('sp-b-sev-out').textContent = avg + '%';
      renderSimpson(); syncUrl();
    });
    bindButton('sp-reset', function () {
      S.simpson = JSON.parse(JSON.stringify(DEF.simpson));
      applySimpsonInputs();
      renderSimpson(); syncUrl();
    });
  }

  function applySimpsonInputs() {
    var m = { 'sp-light': 'light', 'sp-sev': 'sev', 'sp-margin': 'margin', 'sp-a-sev': 'aSev', 'sp-b-sev': 'bSev' };
    var suffix = { 'sp-light': '%', 'sp-sev': '%', 'sp-margin': tr('js.ppSuffix'), 'sp-a-sev': '%', 'sp-b-sev': '%' };
    var prefix = { 'sp-margin': '+' };
    Object.keys(m).forEach(function (id) {
      var el = $(id);
      if (!el) return;
      el.value = S.simpson[m[id]];
      var out = $(id + '-out');
      if (out) {
        var txt = (prefix[id] || '') + S.simpson[m[id]] + suffix[id];
        out.textContent = txt;
        el.setAttribute('aria-valuetext', txt);
      }
    });
  }

  /* ======================================================================
     11 · 分享
     ====================================================================== */
  function shareLink(exp) {
    var p = paramsFor(exp);
    /* 语种跟着链接走：对方打开就是同一种语言、同一组参数、同一张图 */
    var lp = langParam();
    if (lp) p.set(lp[0], lp[1]);
    return location.origin + location.pathname + '?' + p.toString() + '#' + exp;
  }

  function wireShare() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-share]'), function (btn) {
      btn.addEventListener('click', function () {
        var exp = btn.getAttribute('data-share');
        var url = shareLink(exp);
        var status = btn.parentNode.querySelector('.sl-share-status');
        var done = function (ok) {
          if (!status) return;
          status.classList.toggle('is-error', !ok);
          status.textContent = tr(ok ? 'js.share.ok' : 'js.share.fail');
          setTimeout(function () { status.textContent = ''; }, 5000);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(function () { done(true); }, function () { done(legacyCopy(url)); });
        } else {
          done(legacyCopy(url));
        }
      });
    });
  }
  function legacyCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }

  /* ======================================================================
     12 · 主题
     ====================================================================== */
  function updateThemeIcon(theme) {
    var box = $('theme-icon');
    if (!box) return;
    box.innerHTML = theme === 'light'
      ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>'
      : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>';
  }

  function initTheme() {
    var btn = $('theme-toggle');
    var sys = window.matchMedia('(prefers-color-scheme: dark)');
    var readSaved = function () {
      try { var s = localStorage.getItem('dx_theme'); return (s === 'dark' || s === 'light') ? s : null; } catch (e) { return null; }
    };
    var explicit = readSaved();
    var current = document.documentElement.getAttribute('data-theme');
    var apply = function (theme) {
      document.documentElement.setAttribute('data-theme', theme);
      document.documentElement.style.colorScheme = theme;
      updateThemeIcon(theme);
      if (btn) {
        btn.setAttribute('aria-label', tr(theme === 'dark' ? 'js.theme.toLight' : 'js.theme.toDark'));
        btn.setAttribute('aria-pressed', String(theme === 'dark'));
      }
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.content = theme === 'dark' ? '#0a0e17' : '#f8fafc';
      /* 主题真的变了才重绘图表（只重绘，不重算），避免首屏白跑一遍 */
      if (theme === current) return;
      current = theme;
      readColors();
      repaintAll();
    };
    apply(explicit || (sys.matches ? 'dark' : 'light'));
    if (sys.addEventListener) sys.addEventListener('change', function () { if (!explicit) apply(sys.matches ? 'dark' : 'light'); });
    window.addEventListener('storage', function (e) {
      if (e.key === 'dx_theme' || e.key === null) { explicit = readSaved(); apply(explicit || (sys.matches ? 'dark' : 'light')); }
    });
    if (!btn) return;
    btn.addEventListener('click', function () {
      var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      explicit = next;
      try { localStorage.setItem('dx_theme', next); } catch (e) { /* 忽略 */ }
      apply(next);
    });
  }

  function repaintAll() {
    if (cache.clt) { drawClt(cache.clt); }
    if (cache.bootstrap) { drawBootstrap(cache.bootstrap); }
    if (cache.robust) { drawRobust(cache.robust); }
    if (cache.simpson) { drawSimpson(cache.simpson); }
    if (cache.coverage && $('bs-cov-fig') && !$('bs-cov-fig').hidden) drawCoverage(cache.coverage);
  }

  /* ======================================================================
     13 · 章节导航高亮 + 页脚年份
     ====================================================================== */
  function initNavHighlight() {
    var links = {};
    Array.prototype.forEach.call(document.querySelectorAll('.sl-nav-link'), function (a) {
      links[a.getAttribute('data-nav')] = a;
    });
    if (!('IntersectionObserver' in window)) return;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        var id = e.target.getAttribute('data-lab');
        var a = links[id];
        if (!a) return;
        if (e.isIntersecting) {
          Object.keys(links).forEach(function (k) { links[k].classList.remove('is-active'); });
          a.classList.add('is-active');
        }
      });
    }, { rootMargin: '-30% 0px -60% 0px', threshold: 0 });
    Array.prototype.forEach.call(document.querySelectorAll('.sl-lab'), function (sec) { io.observe(sec); });
  }

  /* ======================================================================
     14 · 启动
     ====================================================================== */
  function syncInputsFromState() {
    $('clt-dist').value = S.clt.dist;
    $('clt-n').value = S.clt.n; $('clt-n-out').textContent = S.clt.n;
    $('clt-sims').value = S.clt.sims; $('clt-sims-out').textContent = S.clt.sims;
    $('bs-n').value = S.bootstrap.n; $('bs-n-out').textContent = S.bootstrap.n;
    $('bs-B').value = S.bootstrap.B; $('bs-B-out').textContent = S.bootstrap.B;
    $('bs-conf').value = parseFloat(S.bootstrap.conf).toFixed(2);
    $('rb-dist').value = S.robust.dist;
    $('rb-n').value = S.robust.n; $('rb-n-out').textContent = S.robust.n;
    $('rb-sims').value = S.robust.sims; $('rb-sims-out').textContent = S.robust.sims;
    $('rb-eps').value = S.robust.eps; $('rb-eps-out').textContent = S.robust.eps + '%';
    applySimpsonInputs();
    syncRobustEpsVisibility();
  }

  function safe(label, fn) {
    try { fn(); } catch (e) {
      /* 单个实验出错不影响其他实验；把原因写在读数里而不是静默吞掉 */
      if (window.console && console.error) console.error('[stats-lab] ' + label + ' 渲染失败', e);
      var map = { clt: 'clt-verdict', bootstrap: 'bs-verdict', robust: 'rb-verdict', simpson: 'sp-verdict' };
      var el = $(map[label]);
      if (el) el.textContent = tr('js.err.prefix') + (e && e.message ? e.message : String(e));
    }
  }

  /* ======================================================================
     15 · 语种切换
     静态文案由 i18n.js 负责；这里只管「JS 生成的那部分」——
     控件输出后缀、按钮文案、读数句子、以及画布里的轴标签与 aria-label。
     ====================================================================== */
  function onLangChange() {
    /* 滑块的 output 后缀（"+5 个百分点" / "+5 pp"）与 aria-valuetext 都在这里重写 */
    syncInputsFromState();

    if (cache.clt) readoutClt(cache.clt);
    if (cache.bootstrap) readoutBootstrap(cache.bootstrap);
    if (cache.robust) readoutRobust(cache.robust);
    if (cache.simpson) readoutSimpson(cache.simpson);

    /* 覆盖率模拟进行中别碰按钮文案 —— 进度回调正在写它 */
    var coverBtn = $('bs-cover');
    if (coverBtn && !covRunning) {
      coverBtn.textContent = cache.coverage ? tr('js.bs.run.again') : tr('lab2.btn.cover');
    }

    /* 主题按钮的 aria-label 也带语种，但它的状态存在 initTheme 的闭包里，
       这里直接读 DOM 上的 data-theme 反推，避免再开一条状态通道 */
    var themeBtn = $('theme-toggle');
    if (themeBtn) {
      themeBtn.setAttribute('aria-label',
        tr(document.documentElement.getAttribute('data-theme') === 'dark' ? 'js.theme.toLight' : 'js.theme.toDark'));
    }

    repaintAll();
  }

  function boot() {
    /* i18n.js 是 defer 且排在前面，此刻必然已执行完 —— 缺了就是真的加载失败，
       与其让图表显示一堆 key，不如立刻显式报错 */
    if (!window.SL_I18N || typeof window.SL_I18N.t !== 'function') {
      if (window.console && console.error) {
        console.error('[stats-lab] js/i18n.js 未就绪（缺 SL_I18N.t），文案将退化为 key。请检查 <script> 顺序与 ?v= 版本号。');
      }
    }

    readColors();
    readUrl();
    syncInputsFromState();

    safe('clt', function () { wireClt(); renderClt(false); });
    safe('bootstrap', function () { wireBootstrap(); renderBootstrap(false); });
    safe('robust', function () { wireRobust(); renderRobust(false); });
    safe('simpson', function () { wireSimpson(); renderSimpson(); });

    initTheme();
    initNavHighlight();
    wireShare();
    document.addEventListener('sl:langchange', onLangChange);
    var y = $('sl-year');
    if (y) y.textContent = String(new Date().getFullYear());

    /* 尺寸变化 → 只重绘 */
    if ('ResizeObserver' in window) {
      var t = null;
      var ro = new ResizeObserver(function () {
        if (t) clearTimeout(t);
        t = setTimeout(function () { t = null; readColors(); repaintAll(); }, 140);
      });
      Array.prototype.forEach.call(document.querySelectorAll('.sl-canvas-wrap'), function (el) { ro.observe(el); });
    } else {
      window.addEventListener('resize', function () { readColors(); repaintAll(); });
    }

    /* 地址栏保持干净：只有用户真的动过参数，URL 才带上完整状态（由 syncUrl 在各控件里写入） */

    /* 深链带锚点时，等布局稳定后再滚动一次（避免图表撑开导致落点偏移） */
    if (location.hash) {
      var target = location.hash.slice(1);
      if (document.getElementById(target)) {
        setTimeout(function () {
          var el = document.getElementById(target);
          if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start' });
        }, 260);
      }
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
