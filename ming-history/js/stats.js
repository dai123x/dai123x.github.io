/* 明史资料平台 · 统计引擎（纯计算，无依赖，不碰 DOM）
   ------------------------------------------------------------------
   为什么单独放一个文件：这里的每个函数都是「给定数组 → 给定数字」的纯函数，
   可以脱离页面用 node 直接验算。统计最怕的是「算错了却看不出来」——
   图表会照着一张错的数字画得很好看。所以这个文件的首要设计目标是**可被独立验证**：
   不依赖 MING_CORE、不依赖页面、不读全局状态，全部输入靠参数传入。

   命名约定：
     - 一律用「样本」口径（方差除以 n-1），因为面对的都是抽样数据而非总体。
     - 偏度/峰度用 Fisher–Pearson 的**校正**形式（G1/G2），与 R 的 e1071、SPSS 一致，
       不用矩估计的 g1/g2（小样本下偏差大）。
     - 峰度报**超额**峰度（正态 = 0），不报原始峰度（正态 = 3），免得读者还要自己减 3。

   实现来源：概率分布函数（erfc / 不完全伽马 / 不完全贝塔 / 正态分位数）
   用 Numerical Recipes 与 Acklam 的经典算法，不引入任何库。
   ------------------------------------------------------------------ */
window.MING_STATS = (function () {
  "use strict";

  /* ==================== 0. 基础工具 ==================== */

  const sum = (a) => a.reduce((s, x) => s + x, 0);
  const round = (x, d) => {
    if (!isFinite(x)) return x;
    const m = Math.pow(10, d == null ? 2 : d);
    return Math.round(x * m) / m;
  };
  /** 排序副本。注意：下面凡是要「排序后取值」的函数都不改原数组。 */
  const sorted = (a) => a.slice().sort((x, y) => x - y);

  const mean = (a) => (a.length ? sum(a) / a.length : NaN);

  const median = (a) => quantile(a, 0.5);

  /** 分位数：线性插值（与 R 的 type 7 / numpy 默认一致）。
      之所以要写明口径，是因为「中位数」在不同软件里对偶数长度样本的处理可能不同，
      报数时必须能说清自己用的是哪一种。 */
  function quantile(a, p) {
    const v = sorted(a), n = v.length;
    if (!n) return NaN;
    if (n === 1) return v[0];
    const h = (n - 1) * p, lo = Math.floor(h), hi = Math.ceil(h);
    return lo === hi ? v[lo] : v[lo] + (h - lo) * (v[hi] - v[lo]);
  }

  /** 样本方差（除以 n-1） */
  function variance(a) {
    const n = a.length;
    if (n < 2) return NaN;
    const m = mean(a);
    return a.reduce((s, x) => s + (x - m) * (x - m), 0) / (n - 1);
  }
  const sd = (a) => Math.sqrt(variance(a));

  /** 变异系数：标准差 / 均值。均值接近 0 时无意义，故加保护并返回 NaN。 */
  const cv = (a) => {
    const m = mean(a);
    return Math.abs(m) < 1e-12 ? NaN : sd(a) / Math.abs(m);
  };

  /** 均值的标准误（样本口径） */
  const seMean = (a) => sd(a) / Math.sqrt(a.length);

  /* ==================== 1. 概率分布函数（算 p 值用） ==================== */

  /** Lanczos 近似的 ln Γ(x)，用于不完全伽马/贝塔 */
  function gammaln(x) {
    const cof = [76.18009172947146, -86.50532032941677, 24.01409824083091,
      -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
    let y = x;
    let tmp = x + 5.5;
    tmp -= (x + 0.5) * Math.log(tmp);
    let ser = 1.000000000190015;
    for (let j = 0; j < 6; j++) ser += cof[j] / ++y;
    return -tmp + Math.log(2.5066282746310005 * ser / x);
  }

  /** 互补误差函数 erfc，相对精度约 1e-7（Chebyshev 拟合，NR 版）。
      用它而不是 erf：尾部（大 |z|）算 p 值时 erfc 更稳。 */
  function erfcc(x) {
    const cof = [-1.3026537197817094, 6.4196979235649026e-1, 1.9476473204185836e-2,
      -9.561514786808631e-3, -9.46595344482036e-4, 3.66839497852761e-4,
      4.2523324806907e-5, -2.0278578112534e-5, -1.624290004647e-6,
      1.303655835580e-6, 1.5626441722e-8, -8.5238095915e-8,
      6.529054439e-9, 5.059343495e-9, -9.91364156e-10, -2.27365122e-10,
      9.6467911e-11, 2.394038e-12, -6.886027e-12, 8.94487e-13,
      3.13092e-13, -1.12708e-13, 3.81e-16, 7.106e-15];
    const z = Math.abs(x), t = 2 / (2 + z), ty = 4 * t - 2;
    let d = 0, dd = 0;
    for (let j = cof.length - 1; j > 0; j--) { const tmp = d; d = ty * d - dd + cof[j]; dd = tmp; }
    const ans = t * Math.exp(-z * z + 0.5 * (cof[0] + ty * d) - dd);
    return x >= 0 ? ans : 2 - ans;
  }
  const normCdf = (z) => 0.5 * erfcc(-z / Math.SQRT2);
  /** 双侧正态尾概率 */
  const normTwoTail = (z) => erfcc(Math.abs(z) / Math.SQRT2);

  /** 标准正态分位数（Acklam 有理逼近，|误差| < 1.15e-9）。
      做 QQ 图要用它把「第 i 个顺序统计量的理论位置」换算成 z 值。 */
  function normInv(p) {
    if (p <= 0) return -Infinity;
    if (p >= 1) return Infinity;
    const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
      1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
      6.680131188771972e+01, -1.328068155288572e+01];
    const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
      -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
      3.754408661907416e+00];
    const pl = 0.02425, ph = 1 - pl;
    let q, r;
    if (p < pl) {
      q = Math.sqrt(-2 * Math.log(p));
      return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5])
        / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    if (p > ph) {
      q = Math.sqrt(-2 * Math.log(1 - p));
      return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5])
        / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    q = p - 0.5; r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q
      / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }

  /** 下不完全伽马的级数展开（x < a+1 时收敛快） */
  function gser(a, x) {
    let ap = a, del = 1 / a, s = del;
    for (let n = 1; n < 300; n++) {
      ap++; del *= x / ap; s += del;
      if (Math.abs(del) < Math.abs(s) * 1e-15) break;
    }
    return s * Math.exp(-x + a * Math.log(x) - gammaln(a));
  }
  /** 上不完全伽马的连分式（x >= a+1 时收敛快） */
  function gcf(a, x) {
    const FPMIN = 1e-300;
    let b = x + 1 - a, c = 1 / FPMIN, d = 1 / b, h = d;
    for (let i = 1; i < 300; i++) {
      const an = -i * (i - a);
      b += 2;
      d = an * d + b; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = b + an / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d;
      const del = d * c; h *= del;
      if (Math.abs(del - 1) < 1e-15) break;
    }
    return Math.exp(-x + a * Math.log(x) - gammaln(a)) * h;
  }
  /** 上不完全伽马 Q(a,x) = 1 - P(a,x)，卡方分布的上尾概率就用它 */
  function gammaQ(a, x) {
    if (!(a > 0) || x < 0) return NaN;
    if (x === 0) return 1;
    return x < a + 1 ? 1 - gser(a, x) : gcf(a, x);
  }
  /** 卡方上尾 p 值 */
  const chi2P = (chi2, df) => (df > 0 ? gammaQ(df / 2, chi2 / 2) : NaN);

  /** 不完全贝塔的连分式 */
  function betacf(a, b, x) {
    const FPMIN = 1e-300, EPS = 1e-14;
    const qab = a + b, qap = a + 1, qam = a - 1;
    let c = 1, d = 1 - qab * x / qap;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    d = 1 / d;
    let h = d;
    for (let m = 1; m <= 300; m++) {
      const m2 = 2 * m;
      let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d; h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d;
      const del = d * c; h *= del;
      if (Math.abs(del - 1) < EPS) break;
    }
    return h;
  }
  /** 正则化不完全贝塔 I_x(a,b)，t 分布的上尾概率用它 */
  function betai(a, b, x) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    const bt = Math.exp(gammaln(a + b) - gammaln(a) - gammaln(b) + a * Math.log(x) + b * Math.log(1 - x));
    return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b;
  }
  /** t 分布双侧 p 值 */
  const tTwoTail = (t, df) => (df > 0 ? betai(df / 2, 0.5, df / (df + t * t)) : NaN);

  /* ==================== 2. 描述统计 ==================== */

  /** 一次性把一组数的描述统计算全，避免各处重复写、口径不一致。 */
  function describe(a) {
    const v = sorted(a), n = v.length;
    const m = mean(v);
    return {
      n,
      mean: m,
      median: median(v),
      sd: sd(v),
      se: seMean(v),
      cv: cv(v),
      min: n ? v[0] : NaN,
      q1: quantile(v, 0.25),
      q3: quantile(v, 0.75),
      max: n ? v[n - 1] : NaN,
      iqr: quantile(v, 0.75) - quantile(v, 0.25),
      skew: skewness(v),
      kurt: kurtosis(v),
    };
  }

  /** Fisher–Pearson 校正偏度 G1。>0 右偏（长尾在右），<0 左偏。
      判读经验：|G1| 与 2*sqrt(6/n) 比较，小于它基本可视为对称。 */
  function skewness(a) {
    const n = a.length;
    if (n < 3) return NaN;
    const m = mean(a);
    let m2 = 0, m3 = 0;
    for (const x of a) { const d = x - m; m2 += d * d; m3 += d * d * d; }
    m2 /= n; m3 /= n;
    if (m2 === 0) return 0;
    const g1 = m3 / Math.pow(m2, 1.5);
    return g1 * Math.sqrt(n * (n - 1)) / (n - 2);
  }

  /** Fisher 校正**超额**峰度 G2。正态 = 0；>0 尖峰厚尾，<0 平顶。
      判读经验：|G2| 与 2*2*sqrt(6/n) 比较。 */
  function kurtosis(a) {
    const n = a.length;
    if (n < 4) return NaN;
    const m = mean(a);
    let m2 = 0, m4 = 0;
    for (const x of a) { const d = x - m; m2 += d * d; m4 += d * d * d * d; }
    m2 /= n; m4 /= n;
    if (m2 === 0) return 0;
    const g2 = m4 / (m2 * m2) - 3;
    return ((n + 1) * g2 + 6) * (n - 1) / ((n - 2) * (n - 3));
  }

  /** 偏度/峰度的「大致显著」阈值，用来判断要不要提醒读者分布不对称 */
  const skewSE = (n) => Math.sqrt(6 * n * (n - 1) / ((n - 2) * (n + 1) * (n + 3)));
  const kurtSE = (n) => 2 * Math.sqrt(6 * n * (n - 1) / ((n - 2) * (n + 1) * (n + 3)));

  /** 直方图。默认分箱用 Freedman–Diaconis（2·IQR·n^(-1/3)），
      IQR 为 0（大量重复值）时退回 Sturges，否则会除零或分出一堆空箱。 */
  function hist(data, opts) {
    const o = opts || {};
    const v = sorted(data), n = v.length;
    const lo = o.lo != null ? o.lo : v[0];
    const hi = o.hi != null ? o.hi : v[n - 1];
    let bins = o.bins;
    if (!bins) {
      const iqr = quantile(v, 0.75) - quantile(v, 0.25);
      const h = 2 * iqr / Math.cbrt(n);
      bins = h > 0 ? Math.ceil((hi - lo) / h) : Math.ceil(Math.log2(n)) + 1;
      bins = Math.max(3, Math.min(o.maxBins || 12, bins));
    }
    const w = (hi - lo) / bins || 1;
    const out = [];
    for (let i = 0; i < bins; i++) out.push({ lo: lo + i * w, hi: lo + (i + 1) * w, n: 0 });
    for (const x of v) {
      let i = Math.floor((x - lo) / w);
      if (i < 0) i = 0;
      if (i >= bins) i = bins - 1;
      out[i].n++;
    }
    return { bins: out, width: w, lo, hi, n };
  }

  /** QQ 图数据：样本顺序统计量 vs 正态理论分位数。
      位置用 Hazen 公式 (i+0.5)/n —— 比 (i)/(n+1) 在两端更稳。
      返回对 z 回归 x 的 R²：越接近 1 越像正态。注意这是**描述性**指标，
      不是正态性检验（真正的检验要 Shapiro–Wilk / Anderson–Darling）。 */
  function qqNorm(data) {
    const v = sorted(data), n = v.length;
    const pts = v.map((x, i) => ({ z: normInv((i + 0.5) / n), x }));
    const fit = ols(pts.map((d) => d.z), pts.map((d) => d.x));
    return { pts, r2: fit.r2, slope: fit.slope, intercept: fit.intercept, mean: mean(v), sd: sd(v) };
  }

  /** 正态密度，用来在直方图上叠一条理论曲线 */
  const normPdf = (x, m, s) => Math.exp(-0.5 * Math.pow((x - m) / s, 2)) / (s * Math.sqrt(2 * Math.PI));

  /* ==================== 3. 集中度与多样性 ==================== */

  /** 基尼系数。0 = 完全平均，(n-1)/n = 一个单位独占全部。
      注意：基尼对「项数 n」敏感，小样本的基尼天然偏低，跨不同 n 的组比基尼是不严谨的。 */
  function gini(values) {
    const v = values.filter((x) => x >= 0).slice().sort((a, b) => a - b);
    const n = v.length, s = sum(v);
    if (!n || s <= 0) return 0;
    let cum = 0;
    for (let i = 0; i < n; i++) cum += (i + 1) * v[i];
    return (2 * cum) / (n * s) - (n + 1) / n;
  }

  /** 洛伦兹曲线点列。横轴是按从小到大累计的「项数占比」，纵轴是「总量占比」。
      起点 (0,0) 与终点 (1,1) 都补上，画图时不用再拼。 */
  function lorenz(values) {
    const v = values.slice().sort((a, b) => a - b);
    const n = v.length, s = sum(v);
    const pts = [{ p: 0, L: 0 }];
    let cum = 0;
    for (let i = 0; i < n; i++) {
      cum += v[i];
      pts.push({ p: (i + 1) / n, L: s > 0 ? cum / s : 0 });
    }
    return pts;
  }

  /** 赫芬达尔指数 HHI = Σ share²。范围 1/n ~ 1。
      另返回归一化值（0 = 完全均匀，1 = 完全独占），因为原始 HHI 同样受 n 影响。 */
  function hhi(values) {
    const v = values.filter((x) => x > 0);
    const s = sum(v), n = v.length;
    if (!n || s <= 0) return { hhi: 0, norm: 0, n: 0 };
    const raw = v.reduce((acc, x) => acc + Math.pow(x / s, 2), 0);
    return { hhi: raw, norm: n > 1 ? (raw - 1 / n) / (1 - 1 / n) : 1, n };
  }

  /** 头部集中度：最大的 k 项占总量的比例。比基尼直观得多，适合写进正文。 */
  function topShare(values, k) {
    const v = values.slice().sort((a, b) => b - a), s = sum(v);
    if (!s) return 0;
    return sum(v.slice(0, k)) / s;
  }

  /** 香农熵（自然对数）与均匀度。均匀度 = H / ln(n)，1 表示各类完全等量。 */
  function shannon(counts) {
    const v = counts.filter((x) => x > 0);
    const s = sum(v);
    if (!s) return { h: 0, hmax: 0, evenness: 0, n: 0 };
    const h = -v.reduce((acc, x) => { const p = x / s; return acc + p * Math.log(p); }, 0);
    const hmax = v.length > 1 ? Math.log(v.length) : 0;
    return { h, hmax, evenness: hmax > 0 ? h / hmax : 0, n: v.length };
  }

  /* ==================== 4. 相关与回归 ==================== */

  /** 皮尔逊相关系数。同时给出 t 检验的 p（df = n-2）。 */
  function pearson(x, y) {
    const n = Math.min(x.length, y.length);
    if (n < 3) return { r: NaN, n, p: NaN };
    const mx = mean(x.slice(0, n)), my = mean(y.slice(0, n));
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) {
      const dx = x[i] - mx, dy = y[i] - my;
      sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
    }
    if (!sxx || !syy) return { r: NaN, n, p: NaN };
    const r = sxy / Math.sqrt(sxx * syy);
    const t = r * Math.sqrt((n - 2) / (1 - r * r));
    return { r, n, t, p: tTwoTail(t, n - 2) };
  }

  /** 秩变换：并列值取平均秩。斯皮尔曼相关必须用平均秩，否则并列会引入虚假相关。 */
  function rank(a) {
    const idx = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]);
    const r = new Array(a.length);
    let i = 0;
    while (i < idx.length) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
      i = j + 1;
    }
    return r;
  }

  /** 斯皮尔曼等级相关：先取秩再算皮尔逊。对非线性单调关系也有效，且不受极端值支配。 */
  const spearman = (x, y) => pearson(rank(x), rank(y));

  /** 最小二乘直线拟合 y = a + b·x，附 R²、斜率标准误与 p。
      报 p 时务必说明前提：残差独立同分布且近似正态。小样本 + 非随机抽样下，p 只能当参考。 */
  function ols(x, y) {
    const n = Math.min(x.length, y.length);
    const mx = mean(x), my = mean(y);
    let sxx = 0, sxy = 0, syy = 0;
    for (let i = 0; i < n; i++) {
      const dx = x[i] - mx, dy = y[i] - my;
      sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
    }
    const slope = sxx ? sxy / sxx : 0;
    const intercept = my - slope * mx;
    const r = (sxx && syy) ? sxy / Math.sqrt(sxx * syy) : 0;
    const df = n - 2;
    let seSlope = NaN, t = NaN, p = NaN;
    if (df > 0 && sxx > 0) {
      const sse = Math.max(0, syy - slope * sxy);
      seSlope = Math.sqrt((sse / df) / sxx);
      t = seSlope > 0 ? slope / seSlope : NaN;
      p = tTwoTail(t, df);
    }
    return { slope, intercept, r, r2: r * r, n, df, seSlope, t, p, sse: Math.max(0, syy - slope * sxy) };
  }

  /* ==================== 5. 推断检验 ==================== */

  /** 卡方拟合优度。expected 省略时按「各项相等」。
      返回 minExpected —— 期望频数 < 5 的格子超过两成时，卡方近似就不可靠了，
      必须把这件事写出来，而不是照报 p 值。 */
  function chi2Gof(observed, expected) {
    const k = observed.length;
    const total = sum(observed);
    const e = (expected && expected.length) ? expected : observed.map(() => total / k);
    let chi2 = 0;
    const cells = observed.map((o, i) => {
      const ee = e[i];
      const r = ee > 0 ? (o - ee) * (o - ee) / ee : 0;
      chi2 += r;
      return { o, e: ee, r };
    });
    const df = k - 1;
    const low = e.filter((x) => x < 5).length;
    return {
      chi2, df, p: chi2P(chi2, df), cells, n: total,
      minExpected: Math.min.apply(null, e),
      lowCells: low,
      /* Cochran 经验规则：期望频数 <5 的格子不应超过 20% */
      reliable: low <= Math.max(0, Math.floor(k * 0.2)),
    };
  }

  /** 列联表独立性检验 + Cramér's V（效应量）。
      只看 p 是不够的：样本一大，再弱的关联也会「显著」，所以必须同时给效应量。 */
  function chi2Indep(table) {
    const R = table.length, C = table[0] ? table[0].length : 0;
    const rs = table.map(sum);
    const cs = [];
    for (let j = 0; j < C; j++) {
      let s = 0;
      for (let i = 0; i < R; i++) s += table[i][j];
      cs.push(s);
    }
    const tot = sum(rs);
    let chi2 = 0, minE = Infinity, low = 0;
    const expected = [];
    for (let i = 0; i < R; i++) {
      const row = [];
      for (let j = 0; j < C; j++) {
        const e = tot ? rs[i] * cs[j] / tot : 0;
        row.push(e);
        if (e < 5) low++;
        if (e < minE) minE = e;
        chi2 += e > 0 ? (table[i][j] - e) * (table[i][j] - e) / e : 0;
      }
      expected.push(row);
    }
    const df = (R - 1) * (C - 1);
    const cells = R * C;
    return {
      chi2, df, p: chi2P(chi2, df), n: tot, expected,
      cramersV: (tot && df > 0) ? Math.sqrt(chi2 / (tot * Math.min(R - 1, C - 1))) : NaN,
      minExpected: minE, lowCells: low, cells,
      reliable: low <= Math.max(0, Math.floor(cells * 0.2)),
    };
  }

  /** 游程检验（Wald–Wolfowitz）：把序列按中位数（或给定阈值）二分，
      数「连续同侧段」的个数。游程远少于期望 → 成簇；远多于期望 → 交替得太规律。
      与阈值相等的值会被剔除（否则归哪边都是主观的），所以要把剔除数报出来。 */
  function runsTest(values, opts) {
    const o = opts || {};
    const cut = o.cut != null ? o.cut : median(values);
    const kept = values.filter((v) => v !== cut);
    const dropped = values.length - kept.length;
    const b = kept.map((v) => (v > cut ? 1 : 0));
    const n1 = b.filter((x) => x === 1).length, n0 = b.length - n1, n = b.length;
    let runs = 0;
    for (let i = 0; i < n; i++) if (i === 0 || b[i] !== b[i - 1]) runs++;
    if (!n0 || !n1 || n < 2) {
      return { runs, n1, n0, n, dropped, cut, exp: NaN, sd: NaN, z: NaN, p: NaN };
    }
    const exp = 2 * n1 * n0 / n + 1;
    const varr = (2 * n1 * n0 * (2 * n1 * n0 - n)) / (n * n * (n - 1));
    const s = Math.sqrt(varr);
    const z = (runs - exp) / s;
    return { runs, n1, n0, n, dropped, cut, exp, sd: s, z, p: normTwoTail(z) };
  }

  /* ==================== 6. 不确定性 ==================== */

  /** 确定性伪随机数（mulberry32）。**必须可复现**：
      同一份数据每次刷新要得到同一个区间，否则页面上的数字会自己变，
      测试也没法断言。 */
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Bootstrap 百分位区间。
      为什么不用 t 区间：t 区间假设总体近似正态，而这里最关心的恰恰是
      「分布偏不偏」；bootstrap 不依赖正态假设，且 n=20 上下也能用。
      代价是它假设样本能代表总体 —— 而本站样本是人工选的，这个假设并不成立，
      所以区间只描述「这 20 个数的抽样波动」，不能外推成「明代的真实范围」。 */
  function bootstrapCI(data, statFn, opts) {
    const o = opts || {};
    const reps = o.reps || 2000, level = o.level || 0.95, seed = o.seed || 20261011;
    const fn = statFn || mean;
    const n = data.length;
    if (n < 2) return { lo: NaN, hi: NaN, reps: 0, level, stat: fn(data) };
    const r = rng(seed);
    const out = new Array(reps);
    const buf = new Array(n);
    for (let k = 0; k < reps; k++) {
      for (let i = 0; i < n; i++) buf[i] = data[(r() * n) | 0];
      out[k] = fn(buf);
    }
    out.sort((a, b) => a - b);
    const a = (1 - level) / 2;
    return {
      lo: quantile(out, a), hi: quantile(out, 1 - a),
      reps, level, stat: fn(data), seed,
    };
  }

  /* ==================== 7. 序列 ==================== */

  /** 居中移动平均。窗口两侧不足处返回 null（不硬凑），
      因为「边缘被拉平」的曲线会被误读成趋势变缓。 */
  function movingAverage(series, w) {
    const half = Math.floor(w / 2);
    return series.map((_, i) => {
      if (i < half || i >= series.length - half) return null;
      let s = 0;
      for (let k = i - half; k <= i + half; k++) s += series[k];
      return s / (2 * half + 1);
    });
  }

  /** 分箱聚合：把 [{y}] 之类按固定年份宽度归并，用于时间密度 */
  function binBy(items, valOf, binWidth, opts) {
    const o = opts || {};
    const ys = items.map(valOf);
    const lo = o.lo != null ? o.lo : Math.floor(Math.min.apply(null, ys) / binWidth) * binWidth;
    const hi = o.hi != null ? o.hi : Math.ceil((Math.max.apply(null, ys) + 1) / binWidth) * binWidth;
    const bins = [];
    for (let y = lo; y < hi; y += binWidth) bins.push({ from: y, to: y + binWidth - 1, n: 0, items: [] });
    for (const it of items) {
      const i = Math.floor((valOf(it) - lo) / binWidth);
      if (i >= 0 && i < bins.length) { bins[i].n++; bins[i].items.push(it); }
    }
    return bins;
  }

  return {
    // 基础
    sum, round, mean, median, quantile, variance, sd, cv, seMean, sorted,
    // 分布
    describe, skewness, kurtosis, skewSE, kurtSE, hist, qqNorm, normPdf,
    // 概率函数（测试与画图会用到）
    erfcc, normCdf, normTwoTail, normInv, gammaln, gammaQ, chi2P, betai, tTwoTail,
    // 集中度与多样性
    gini, lorenz, hhi, topShare, shannon,
    // 相关回归
    pearson, spearman, rank, ols,
    // 推断
    chi2Gof, chi2Indep, runsTest,
    // 不确定性
    rng, bootstrapCI,
    // 序列
    movingAverage, binBy,
  };
})();
