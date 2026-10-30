// ============================================================
// 故宫水墨淡彩引擎 (Forbidden City Pen & Wash Watercolour Engine)
// ============================================================

const INK = [43, 37, 32];             // 仿古徽墨浓赭黑 #2b2520
const PAPER = [245, 238, 222];        // 仿古冷压生宣纸 / 水彩纸 #f5eede
const SEAL_RED = [178, 48, 36];       // 乾隆朱砂印泥红 #b23024
const GOLD_LEAF = [224, 182, 68];     // 皇家泥金描金 #e0b644

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const ss = t => { t = clamp(t); return t * t * (3 - 2 * t); };
const TAU = Math.PI * 2;
let activePlateCapture = null;
let paperGrain;

// ---------- 随机与噪声 ----------
function rng(seed) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => {
    s |= 0; s = s + 0x6D2B79F5 | 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function h2(x, y, s) {
  let n = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453;
  return n - Math.floor(n);
}

function n2(x, y, s = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = h2(xi, yi, s), b = h2(xi + 1, yi, s), c = h2(xi, yi + 1, s), d = h2(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x, y, s = 0, o = 4) {
  let a = 0, w = 0.5, f = 1, n = 0;
  for (let i = 0; i < o; i++) {
    a += w * n2(x * f, y * f, s + i * 13);
    n += w; w *= 0.5; f *= 2.03;
  }
  return a / n;
}

const rgba = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

// ---------- 曲线与多边形处理 ----------
function resample(pts, step) {
  const out = [pts[0]];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    const L = Math.hypot(x1 - x0, y1 - y0);
    if (L === 0) continue;
    let d = step - carry;
    while (d <= L) {
      out.push([x0 + (x1 - x0) * d / L, y0 + (y1 - y0) * d / L]);
      d += step;
    }
    carry = L - (d - step);
  }
  const last = pts[pts.length - 1], pl = out[out.length - 1];
  if (Math.hypot(last[0] - pl[0], last[1] - pl[1]) > step * 0.3) out.push(last);
  return out;
}

function spline(pts, n = 8, closed = false) {
  const P = pts, out = [], N = P.length;
  if (N < 3) return P.slice();
  const g = i => closed ? P[(i + N) % N] : P[clamp(i, 0, N - 1)];
  const segs = closed ? N : N - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = g(i - 1), p1 = g(i), p2 = g(i + 1), p3 = g(i + 2);
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map(j => 0.5 * ((2 * p1[j]) + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3)));
    }
  }
  if (!closed) out.push(P[N - 1]);
  return out;
}

const ellipse = (cx, cy, rx, ry, n = 28, a0 = 0) => [...Array(n)].map((_, i) => {
  const a = a0 + i / n * TAU;
  return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry];
});

function rough(poly, amp, seed, step = 9, freq = 0.02) {
  const P = resample([...poly, poly[0]], step);
  P.pop();
  const n = P.length, out = [];
  for (let i = 0; i < n; i++) {
    const a = P[(i - 1 + n) % n], b = P[(i + 1) % n], [x, y] = P[i];
    let nx = -(b[1] - a[1]), ny = b[0] - a[0];
    const l = Math.hypot(nx, ny) || 1;
    nx /= l; ny /= l;
    const d = (fbm(x * freq, y * freq, seed, 3) - 0.5) * 2 * amp + (n2(x * 0.15, y * 0.15, seed + 9) - 0.5) * amp * 0.35;
    out.push([x + nx * d, y + ny * d]);
  }
  return out;
}

function pathPoly(ctx, poly) {
  if (!poly || poly.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(poly[0][0], poly[0][1]);
  for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1]);
  ctx.closePath();
}

// ---------- 钢笔线条（微颤、过冲、粗细变化、断线） ----------
function penStroke(pts, o = {}) {
  const w = o.w ?? 2.4, wob = o.wob ?? 1.1, seed = o.seed ?? 1, r = rng(seed);
  let P = pts.length > 2 && o.smooth !== false ? spline(pts, 6) : pts;
  const step = o.step ?? Math.max(2, w * 1.4);
  P = resample(P, step);
  if (P.length < 2) P = [pts[0], pts[pts.length - 1]];

  // 过冲（建筑速写的出头角线）
  const over = (o.over ?? 4) * (0.4 + r());
  const ext = (a, b, d) => {
    const l = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
    return [a[0] + (a[0] - b[0]) / l * d, a[1] + (a[1] - b[1]) / l * d];
  };
  P.unshift(ext(P[0], P[1], over * 0.5));
  P.push(ext(P[P.length - 1], P[P.length - 2], over));

  const n = P.length, out = [], W = [], S = [0];
  const ph = r() * 100, f = (o.freq ?? 0.018) * (0.7 + r() * 0.6);
  for (let i = 0; i < n; i++) {
    const a = P[Math.max(0, i - 1)], b = P[Math.min(n - 1, i + 1)];
    let nx = -(b[1] - a[1]), ny = b[0] - a[0];
    const l = Math.hypot(nx, ny) || 1;
    nx /= l; ny /= l;
    const s = i * step;
    const d = (n2(s * f + ph, 0, seed) - 0.5) * 2 * wob + (n2(s * f * 5 + ph, 3, seed) - 0.5) * wob * 0.35;
    out.push([P[i][0] + nx * d, P[i][1] + ny * d]);
    const u = i / (n - 1);
    W.push(w * (0.6 + 0.4 * Math.pow(Math.sin(Math.PI * clamp(u * 1.1 - 0.02)), 0.35)) * (0.85 + 0.3 * n2(s * 0.01 + 5, ph, seed)));
    if (i) S.push(S[i - 1] + Math.hypot(out[i][0] - out[i - 1][0], out[i][1] - out[i - 1][1]));
  }
  const gaps = [];
  if (o.gap && S[n - 1] > 60 && r() < o.gap) {
    const g0 = 0.25 + r() * 0.5;
    gaps.push([g0, g0 + (3 + r() * 6) / S[n - 1]]);
  }
  return { P: out, W, S, L: S[n - 1], gaps, alpha: o.alpha ?? 1 };
}

const inGap = (st, u) => st.gaps.some(g => u > g[0] && u < g[1]);

function drawPen(ctx, st, p = 1, col = INK, alpha = 1, from = 0) {
  if (activePlateCapture?.ctx === ctx) {
    activePlateCapture.strokes.push({ st, col, alpha, progress: 0 });
    return;
  }
  if (p <= 0 || from >= p) return;
  const end = st.L * clamp(p), beg = st.L * clamp(from);
  ctx.strokeStyle = rgba(col, alpha * st.alpha);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let i = 1; i < st.P.length; i++) {
    if (st.S[i - 1] > end) break;
    if (st.S[i] < beg) continue;
    const u = st.S[i] / st.L;
    if (inGap(st, u)) continue;
    let [x1, y1] = st.P[i];
    if (st.S[i] > end) {
      const k = (end - st.S[i - 1]) / (st.S[i] - st.S[i - 1] || 1);
      x1 = lerp(st.P[i - 1][0], x1, k);
      y1 = lerp(st.P[i - 1][1], y1, k);
    }
    ctx.lineWidth = st.W[i];
    ctx.beginPath();
    ctx.moveTo(st.P[i - 1][0], st.P[i - 1][1]);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }
}

// ---------- 水彩淡彩（多层叠加透叠 + 边缘收缩水渍） ----------
function wash(ctx, poly, col, o = {}) {
  if (!poly || poly.length < 3) return;
  const a = o.a ?? 0.5, j = o.j ?? 6, L = o.layers ?? 3, seed = o.seed ?? 7, dx = o.dx ?? 0, dy = o.dy ?? 0;
  const P0 = (dx || dy) ? poly.map(p => [p[0] + dx, p[1] + dy]) : poly;
  ctx.save();
  ctx.globalCompositeOperation = o.op ?? 'multiply';
  let last;
  for (let l = 0; l < L; l++) {
    last = rough(P0, j * (1 + l * 0.35), seed + l * 31, o.step ?? Math.max(5, j * 1.4), o.freq ?? 0.02);
    ctx.fillStyle = rgba(col, a / L * (1.25 - l * 0.15));
    pathPoly(ctx, last);
    ctx.fill();
  }
  const e = o.edge ?? 0.3;
  if (e > 0) {
    ctx.strokeStyle = rgba(mix3(col, [50, 42, 35], 0.2), a * e);
    ctx.lineWidth = o.edgeW ?? 1.8;
    ctx.lineJoin = 'round';
    pathPoly(ctx, last);
    ctx.stroke();
  }
  ctx.restore();
}

// ---------- 树冠与松柏针叶 ----------
function dab(ctx, x, y, r, ang, col, a, seed) {
  const R = rng(seed), n = 5 + (R() * 3 | 0), el = 1.15 + R() * 0.5, P = [];
  for (let i = 0; i < n; i++) {
    const t = i / n * TAU + R() * 0.5, rr = r * (0.6 + R() * 0.55);
    const lx = Math.cos(t) * rr * el, ly = Math.sin(t) * rr;
    P.push([x + lx * Math.cos(ang) - ly * Math.sin(ang), y + lx * Math.sin(ang) + ly * Math.cos(ang)]);
  }
  ctx.fillStyle = rgba(col, a);
  ctx.beginPath();
  ctx.moveTo(P[0][0], P[0][1]);
  for (let i = 0; i < n; i++) {
    const p = P[i], q = P[(i + 1) % n];
    ctx.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
  }
  ctx.fill();
}

// ---------- 宣纸底色与雪花/颗粒 ----------
function paper(ctx, W, H, tint = 0, snow = 0) {
  ctx.fillStyle = '#f5eede';
  ctx.fillRect(0, 0, W, H);
  if (!paperGrain) {
    const grain = document.createElement('canvas');
    grain.width = grain.height = 160;
    const gx = grain.getContext('2d');
    const pixels = gx.createImageData(160, 160);
    const random = rng(20261030);
    for (let i = 0; i < pixels.data.length; i += 4) {
      pixels.data[i] = 82; pixels.data[i + 1] = 64; pixels.data[i + 2] = 43;
      pixels.data[i + 3] = random() * 12;
    }
    gx.putImageData(pixels, 0, 0);
    paperGrain = grain;
  }
  ctx.fillStyle = ctx.createPattern(paperGrain, 'repeat');
  ctx.fillRect(0, 0, W, H);

  // 生宣纸自然沉淀的云斑水渍
  for (let i = 0; i < 6; i++) {
    const R = rng(700 + i);
    wash(ctx, ellipse(R() * W, R() * H, 300 + R() * 400, 180 + R() * 260, 18), mix3(PAPER, [226, 214, 196], 0.55), { a: 0.1, j: 45, layers: 2, seed: 700 + i, freq: 0.0035 });
  }

  // 暮霞色温或微冷宣纸
  if (tint !== 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    if (tint > 0) {
      // 暮霞暖金
      ctx.fillStyle = `rgba(225, 120, 70, ${0.18 * tint})`;
    } else {
      // 雪霁微青
      ctx.fillStyle = `rgba(74, 98, 130, ${0.14 * Math.abs(tint)})`;
    }
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  // 飘雪效果（雪霁紫禁模式）
  if (snow > 0) {
    ctx.save();
    const R = rng(101);
    const snowCount = Math.round(180 * snow);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    for (let i = 0; i < snowCount; i++) {
      const sx = R() * W, sy = (R() * H + Date.now() * 0.02 * (0.8 + R() * 0.4)) % H;
      const sr = 1.2 + R() * 2.8;
      ctx.beginPath();
      ctx.arc(sx, sy, sr, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }
}

// ---------- 传统朱砂印章（朱文 / 白文印） ----------
function sealStamp(ctx, text, x, y, size = 48, o = {}) {
  if (activePlateCapture?.ctx === ctx) {
    activePlateCapture.seals.push({ text, x, y, size, o });
    return;
  }
  const p = clamp(o.p ?? 1);
  if (p <= 0) return;
  const isBaiwen = !!o.baiwen;
  const r = rng(o.seed ?? 88);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((r() - 0.5) * 0.035);

  const w = size, h = size;
  const poly = [
    [-w/2, -h/2], [w/2, -h/2], [w/2, h/2], [-w/2, h/2]
  ];
  const rpoly = rough(poly, 1.8, o.seed ?? 88, 5, 0.12);

  if (isBaiwen) {
    // 白文印：红色实底，镂空出白字
    ctx.fillStyle = rgba(SEAL_RED, 0.88 * p);
    pathPoly(ctx, rpoly);
    ctx.fill();
    ctx.fillStyle = rgba(PAPER, 0.96 * p);
  } else {
    // 朱文印：红边框红字，底色透纸
    ctx.strokeStyle = rgba(SEAL_RED, 0.9 * p);
    ctx.lineWidth = 2.4;
    pathPoly(ctx, rpoly);
    ctx.stroke();
    ctx.fillStyle = rgba(SEAL_RED, 0.88 * p);
  }

  ctx.font = `bold ${Math.round(size * 0.36)}px "STKaiti","KaiTi","SimSun",serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  if (text.length === 4) {
    // 四字传统回文排列：右上一、右下二、左上一、左下二
    const off = size * 0.22;
    ctx.fillText(text[0], off, -off);
    ctx.fillText(text[1], off, off);
    ctx.fillText(text[2], -off, -off);
    ctx.fillText(text[3], -off, off);
  } else if (text.length === 2) {
    const off = size * 0.22;
    ctx.fillText(text[0], 0, -off);
    ctx.fillText(text[1], 0, off);
  } else {
    ctx.fillText(text, 0, 0);
  }
  ctx.restore();
}

// ---------- 传统楷体书法笔画绘制（逐字浮现与轻微运笔抖动） ----------
function handwrite(ctx, tx, p) {
  if (activePlateCapture?.ctx === ctx) {
    activePlateCapture.texts.push({ tx });
    return;
  }
  const { text, size, x, y, rot = 0, alpha = 1, vertical = false, gold = false } = tx;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.font = size + 'px "KaiTi","楷体","STKaiti","SimSun",serif';
  ctx.fillStyle = gold ? `rgba(214,175,55,${0.95 * alpha})` : `rgba(43,37,32,${0.92 * alpha})`;

  const R = rng((x | 0) * 31 + (y | 0) * 7 + size);
  const chars = [...text];

  if (vertical) {
    for (let i = 0; i < chars.length; i++) {
      const u = chars.length > 1 ? i / (chars.length - 1) : 0;
      if (u > p) break;
      ctx.save();
      ctx.translate((R() - 0.5) * size * 0.05, i * size * 1.08 + size * 0.8);
      ctx.rotate((R() - 0.5) * 0.02);
      ctx.globalAlpha = 0.85 + R() * 0.15;
      ctx.fillText(chars[i], 0, 0);
      ctx.restore();
    }
  } else {
    const ws = chars.map(c => ctx.measureText(c).width);
    const total = ws.reduce((a, b) => a + b, 0);
    ctx.beginPath();
    ctx.rect(-size * 0.3, -size * 1.2, total * p + size * 0.3, size * 2.2);
    ctx.clip();
    let cx = 0;
    for (let i = 0; i < chars.length; i++) {
      ctx.save();
      ctx.translate(cx, (R() - 0.5) * size * 0.05);
      ctx.rotate((R() - 0.5) * 0.02);
      ctx.globalAlpha = 0.82 + R() * 0.18;
      ctx.fillText(chars[i], 0, 0);
      ctx.restore();
      cx += ws[i];
    }
  }
  ctx.restore();
}

// ---------- Web Audio API: 宫廷雅乐合成器（微风声 + 铜铃风铃 + 远方编钟） ----------
class PalaceAudio {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.timer = null;
  }
  init() {
    if (this.ctx) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();
    } catch (e) {
      console.warn('Web Audio not supported');
    }
  }
  toggle() {
    this.init();
    if (!this.ctx) return false;
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    this.enabled = !this.enabled;
    if (this.enabled) {
      this.scheduleChimes();
    } else {
      if (this.timer) clearTimeout(this.timer);
    }
    return this.enabled;
  }
  playChime(freq = 1175, dur = 2.5, vol = 0.06) {
    if (!this.ctx || !this.enabled) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    // 编钟与风铃的清越泛音
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.998, now + dur);

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(vol, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + dur);
  }
  scheduleChimes() {
    if (!this.enabled) return;
    // 五声音阶宫商角徵羽
    const pentatonic = [587.33, 659.25, 783.99, 880.00, 1046.50, 1174.66, 1318.51];
    const f = pentatonic[Math.floor(Math.random() * pentatonic.length)];
    this.playChime(f, 3.2, 0.05 + Math.random() * 0.03);

    // 下一次风铃声
    const nextInterval = 2800 + Math.random() * 4200;
    this.timer = setTimeout(() => this.scheduleChimes(), nextInterval);
  }
}
const palaceSound = new PalaceAudio();


// ============================================================
// 紫禁城 1:1 空间规制三维建筑群与光栅渲染 (Forbidden City 1:1 3D Site)
// 依据故宫实测数据：南北 961 米，东西 753 米，筒子河宽 52 米
// 坐标系统：1 单位 ≈ 2.5 米。Z 轴由南向北，X 轴由西向东，中轴线 X = 0
// ============================================================

const v = (x, y, z) => ({ x, y, z });
const sub = (a, b) => v(a.x - b.x, a.y - b.y, a.z - b.z);
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const crossv = (a, b) => v(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const len = a => Math.hypot(a.x, a.y, a.z);
const nrm = a => { const l = len(a) || 1; return v(a.x / l, a.y / l, a.z / l); };
const add = (a, b) => v(a.x + b.x, a.y + b.y, a.z + b.z);

// ---------- 透视相机 ----------
function perspCam(eye, target, fov, W, H, roll = 0) {
  const up = v(Math.sin(roll), Math.cos(roll), 0);
  const f = nrm(sub(target, eye));
  const r = nrm(crossv(up, f));
  const u = crossv(f, r);
  const focal = (H / 2) / Math.tan(fov * Math.PI / 360);
  return {
    eye, f, r, u, focal, W, H, ortho: 0,
    p(p) {
      const d = sub(p, eye), z = dot(d, f);
      if (z <= 0.08) return null;
      return { x: W / 2 + dot(d, r) / z * focal, y: H / 2 - dot(d, u) / z * focal, z };
    },
    depth(p) { return dot(sub(p, eye), f); }
  };
}

// ---------- 几何基元构建 ----------
function face(pts, kind, shade = 1) { return { pts, kind, shade }; }

function box(cx, cz, w, d, y0, y1, o = {}) {
  const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
  const P = v, f = [];
  f.push(face([P(x0, y1, z0), P(x0, y1, z1), P(x1, y1, z1), P(x1, y1, z0)], 'top', 1));
  f.push(face([P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)], 'wall', 0.95));
  f.push(face([P(x0, y0, z0), P(x0, y1, z0), P(x1, y1, z0), P(x1, y0, z0)], 'wall', 0.72));
  f.push(face([P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1), P(x0, y1, z0)], 'wall', 0.8));
  f.push(face([P(x1, y0, z1), P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1)], 'wall', 0.88));
  return { kind: o.kind ?? 'box', cx, cz, y1, faces: f, o, col: o.col, fp: { w, d }, t0: o.t0 ?? 0 };
}

function plane(x0, z0, x1, z1, y, col, kind = 'ground', t0 = 0, o = {}) {
  return {
    kind: 'plane', cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, col, t0,
    alpha: o.alpha ?? 0.45,
    faces: [face([v(x0, y, z0), v(x1, y, z0), v(x1, y, z1), v(x0, y, z1)], kind, 1)]
  };
}

// 宫殿建筑：支持庑殿顶 (hip), 歇山顶 (gableHip), 攒尖顶 (pyramid), 悬山/硬山 (gable), 重檐
function palace(cx, cz, w, d, y0, eavesY, ridgeY, roofType = 'hip', o = {}) {
  const P = v, f = [];
  const body = box(cx, cz, w * 0.9, d * 0.9, y0, eavesY, { kind: 'wall', col: o.wallCol ?? C.wallRed });
  const walls = body.faces.filter(x => x.kind !== 'top');

  const over = o.over ?? (w * 0.08 + 0.6);
  const ex0 = cx - w / 2 - over, ex1 = cx + w / 2 + over;
  const ez0 = cz - d / 2 - over, ez1 = cz + d / 2 + over;

  // 若为黑琉璃瓦绿剪边（如文渊阁）
  const roofCol = o.roofCol ?? C.roofGold;

  if (roofType === 'hip') {
    // 庑殿顶（四坡五脊）
    const rw = Math.max(1, w * 0.52);
    const rx0 = cx - rw / 2, rx1 = cx + rw / 2;
    f.push(face([P(ex0, eavesY, ez1), P(ex1, eavesY, ez1), P(rx1, ridgeY, cz), P(rx0, ridgeY, cz)], 'roof', 0.95)); // 南坡
    f.push(face([P(ex0, eavesY, ez0), P(rx0, ridgeY, cz), P(rx1, ridgeY, cz), P(ex1, eavesY, ez0)], 'roof', 0.68)); // 北坡
    f.push(face([P(ex0, eavesY, ez0), P(ex0, eavesY, ez1), P(rx0, ridgeY, cz)], 'roof', 0.82)); // 西坡
    f.push(face([P(ex1, eavesY, ez1), P(ex1, eavesY, ez0), P(rx1, ridgeY, cz)], 'roof', 0.88)); // 东坡
  } else if (roofType === 'pyramid') {
    // 攒尖顶（四角四坡，聚于宝顶）
    f.push(face([P(ex0, eavesY, ez1), P(ex1, eavesY, ez1), P(cx, ridgeY, cz)], 'roof', 0.95));
    f.push(face([P(ex1, eavesY, ez1), P(ex1, eavesY, ez0), P(cx, ridgeY, cz)], 'roof', 0.88));
    f.push(face([P(ex1, eavesY, ez0), P(ex0, eavesY, ez0), P(cx, ridgeY, cz)], 'roof', 0.68));
    f.push(face([P(ex0, eavesY, ez0), P(ex0, eavesY, ez1), P(cx, ridgeY, cz)], 'roof', 0.82));
  } else if (roofType === 'gableHip') {
    // 歇山顶（带山花与正脊）
    const rw = Math.max(1, w * 0.66);
    const rx0 = cx - rw / 2, rx1 = cx + rw / 2;
    f.push(face([P(ex0, eavesY, ez1), P(ex1, eavesY, ez1), P(rx1, ridgeY, cz), P(rx0, ridgeY, cz)], 'roof', 0.95));
    f.push(face([P(ex0, eavesY, ez0), P(rx0, ridgeY, cz), P(rx1, ridgeY, cz), P(ex1, eavesY, ez0)], 'roof', 0.68));
    f.push(face([P(ex0, eavesY, ez0), P(ex0, eavesY, ez1), P(rx0, ridgeY, cz)], 'roof', 0.82));
    f.push(face([P(ex1, eavesY, ez1), P(ex1, eavesY, ez0), P(rx1, ridgeY, cz)], 'roof', 0.88));
    f.push(face([P(rx0, (eavesY + ridgeY) * 0.5, ez0 + over), P(rx0, (eavesY + ridgeY) * 0.5, ez1 - over), P(rx0, ridgeY, cz)], 'gable', 0.8));
    f.push(face([P(rx1, (eavesY + ridgeY) * 0.5, ez1 - over), P(rx1, (eavesY + ridgeY) * 0.5, ez0 + over), P(rx1, ridgeY, cz)], 'gable', 0.85));
  } else if (roofType === 'round') {
    // 万春亭圆攒尖
    const n = 16;
    for (let i = 0; i < n; i++) {
      const a0 = i / n * TAU, a1 = (i + 1) / n * TAU;
      f.push(face([
        P(cx + Math.cos(a0) * (w / 2 + over), eavesY, cz + Math.sin(a0) * (d / 2 + over)),
        P(cx + Math.cos(a1) * (w / 2 + over), eavesY, cz + Math.sin(a1) * (d / 2 + over)),
        P(cx, ridgeY, cz)
      ], 'roof', 0.75 + 0.22 * Math.cos(a0 - 0.8)));
    }
  }

  if (o.double) {
    const lower = palace(cx, cz, w * 1.1, d * 1.14, y0, eavesY - 1.2, eavesY + .45, roofType, { ...o, double: false, over: over * .7 });
    f.push(...lower.faces.filter(item => item.kind === 'roof' || item.kind === 'gable'));
  }
  return {
    kind: 'palace', cx, cz, y1: ridgeY, faces: [...walls, ...f],
    o: { ...o, w, d, y0, eavesY, ridgeY, roofType, roofCol },
    col: roofCol,
    fp: { w: w + over * 2, d: d + over * 2 },
    t0: o.t0 ?? 0
  };
}

// 汉白玉台基
function marblePlinth(cx, cz, w, d, y0, y1, tiers = 1, o = {}) {
  const f = [];
  const h = (y1 - y0) / tiers;
  for (let i = 0; i < tiers; i++) {
    const inset = (tiers - 1 - i) * 0.8;
    const b = box(cx, cz, w - inset * 2, d - inset * 2, y0 + i * h, y0 + (i + 1) * h, { kind: 'plinth', col: C.marble });
    f.push(...b.faces);
  }
  return { kind: 'plinth', cx, cz, y1, faces: f, fp: { w, d }, t0: o.t0 ?? 0, o };
}

// 汉白玉拱桥
function marbleBridge(cx, cz, w, span, o = {}) {
  const seg = 10, f = [], P = v;
  const rise = o.rise ?? 1.1;
  for (let i = 0; i < seg; i++) {
    const u0 = i / seg, u1 = (i + 1) / seg;
    const y0 = 0.35 + Math.sin(u0 * Math.PI) * rise;
    const y1 = 0.35 + Math.sin(u1 * Math.PI) * rise;
    const zA0 = cz - span / 2 + span * u0, zA1 = cz - span / 2 + span * u1;
    f.push(face([P(cx - w / 2, y0, zA0), P(cx + w / 2, y0, zA0), P(cx + w / 2, y1, zA1), P(cx - w / 2, y1, zA1)], 'deck', 0.96));
    f.push(face([P(cx - w / 2, 0, zA0), P(cx - w / 2, 0, zA1), P(cx - w / 2, y1, zA1), P(cx - w / 2, y0, zA0)], 'bridgeSide', 0.78));
    f.push(face([P(cx + w / 2, 0, zA1), P(cx + w / 2, 0, zA0), P(cx + w / 2, y0, zA0), P(cx + w / 2, y1, zA1)], 'bridgeSide', 0.88));
  }
  return { kind: 'bridge', cx, cz, y1: 0.8 + rise, t0: o.t0 ?? 0, faces: f, fp: { w, d: span } };
}

// 皇家古柏
function imperialCypress(cx, cz, h, cr, seed, o = {}) {
  return {
    kind: 'cypress', cx, cz, y1: h + cr, t0: o.t0 ?? 0, fp: { w: cr * 1.6, d: cr * 1.6 },
    trunk: { cx, cz, h: h * 0.75, r: h * 0.045 },
    crowns: Array.from({ length: o.crowns ?? 3 }, (_, i) => {
      const R = rng(seed + i * 37), a = i / (o.crowns ?? 3) * TAU + R() * 0.6;
      return {
        x: cx + Math.cos(a) * cr * 0.35,
        z: cz + Math.sin(a) * cr * 0.35,
        y: h * (0.75 + R() * 0.2),
        r: cr * (0.75 + R() * 0.3),
        seed: seed + i * 11
      };
    })
  };
}

// 凸包算法
function convexHull(pts) {
  if (pts.length <= 2) return pts;
  const p0 = pts.slice().sort((a, b) => a[1] === b[1] ? a[0] - b[0] : a[1] - b[1])[0];
  const sorted = pts.slice().filter(p => p !== p0).sort((a, b) => {
    const angA = Math.atan2(a[1] - p0[1], a[0] - p0[0]);
    const angB = Math.atan2(b[1] - p0[1], b[0] - p0[0]);
    return angA === angB ? Math.hypot(a[0] - p0[0], a[1] - p0[1]) - Math.hypot(b[0] - p0[0], b[1] - p0[1]) : angA - angB;
  });
  const stack = [p0, sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const p = sorted[i];
    while (stack.length > 1) {
      const q = stack[stack.length - 1], r = stack[stack.length - 2];
      const cross = (q[0] - r[0]) * (p[1] - r[1]) - (q[1] - r[1]) * (p[0] - r[0]);
      if (cross <= 0) stack.pop(); else break;
    }
    stack.push(p);
  }
  return stack;
}

// 色彩定义
const C = {
  roofGold: hex('#d49726'),
  roofLight: hex('#ebb448'),
  roofDark: hex('#a66e16'),
  roofBlack: hex('#24292e'), // 文渊阁黑琉璃瓦
  roofGreen: hex('#2a5a4c'),
  wallRed: hex('#9e2d22'),
  wallRedLight: hex('#b8382c'),
  wallRedDark: hex('#781e16'),
  marble: hex('#ebe5d8'),
  marbleDark: hex('#c8bea8'),
  pave: hex('#d4cbba'),
  pavePlaza: hex('#c4b9a2'),
  water: hex('#649a90'),
  waterMoat: hex('#4e7d74'),
  woodDark: hex('#5c3e28'),
  leafL: hex('#789c4a'),
  leaf: hex('#486c32'),
  leafD: hex('#2c4620'),
  bronze: hex('#385244'),
  gold: hex('#d4af37')
};
const C3COOL = [55, 68, 92];

function faceColor(ob, f, season) {
  if (season === 'snow') {
    if (f.kind === 'roof' || f.kind === 'deck' || f.kind === 'top') return hex('#f2efe8');
    if (f.kind === 'ground' || f.kind === 'path') return hex('#ded8cb');
  }
  if (ob.kind === 'palace') {
    if (f.kind === 'roof') return ob.o.roofCol ?? C.roofGold;
    if (f.kind === 'wall' || f.kind === 'gable') return ob.o.wallCol ?? C.wallRed;
  }
  if (ob.col) return ob.col;
  if (f.kind === 'roof') return C.roofGold;
  if (f.kind === 'wall') return C.wallRed;
  if (f.kind === 'gable') return C.wallRedDark;
  if (f.kind === 'plinth' || f.kind === 'deck' || f.kind === 'bridgeSide') return C.marble;
  if (f.kind === 'water') return C.water;
  if (f.kind === 'moat') return C.waterMoat;
  if (f.kind === 'plaza') return C.pavePlaza;
  return C.pave;
}

function revealClip(ctx, c, r, seed) {
  if (r >= 4000) return;
  const R = rng(seed), pts = [];
  for (let i = 0; i < 18; i++) {
    const a = i / 18 * TAU, rr = r * (0.86 + R() * 0.28);
    pts.push([c.x + Math.cos(a) * rr, c.y + Math.sin(a) * rr * 0.92]);
  }
  ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath(); ctx.clip();
}

function ink(ctx, pts, o, alpha) {
  const st = penStroke(pts.map(p => [p.x, p.y]), {
    w: o.w ?? 2.3, wob: o.wob ?? 1.1, over: o.over ?? 5, seed: o.seed ?? 4, gap: o.gap ?? 0.4, smooth: o.smooth ?? (pts.length > 7)
  });
  drawPen(ctx, st, clamp(o.p ?? 1), INK, alpha ?? 1);
}

// ============================================================
// 紫禁城 1:1 完整建筑群建模 (Forbidden City Site Assembly)
// ============================================================
function forbiddenCitySite(season = 'day') {
  const O = [];

  // ----------------------------------------------------------
  // 1. 大地与基准面 (长 961 米 -> Z: -192 到 +192; 宽 753 米 -> X: -150 到 +150)
  // ----------------------------------------------------------
  O.push(plane(-190, -240, 190, 240, 0, C.pavePlaza, 'ground', 0, { alpha: 0.24 }));

  // ----------------------------------------------------------
  // 2. 筒子河（护城河）：宽 52 米（21 坐标单位）环绕外城
  // ----------------------------------------------------------
  const MW_OUT = 182, MW_IN = 158;
  const ML_OUT = 224, ML_IN = 200;
  O.push(plane(-MW_OUT, -ML_OUT, -MW_IN, ML_OUT, 0.02, C.waterMoat, 'moat', 0.2, { alpha: 0.75 })); // 西筒子河
  O.push(plane(MW_IN, -ML_OUT, MW_OUT, ML_OUT, 0.02, C.waterMoat, 'moat', 0.2, { alpha: 0.75 }));  // 东筒子河
  O.push(plane(-MW_OUT, -ML_OUT, MW_OUT, -ML_IN, 0.02, C.waterMoat, 'moat', 0.2, { alpha: 0.75 })); // 南外金水河
  O.push(plane(-MW_OUT, ML_IN, MW_OUT, ML_OUT, 0.02, C.waterMoat, 'moat', 0.2, { alpha: 0.75 }));  // 北筒子河

  // ----------------------------------------------------------
  // 3. 四大角楼（西南、东南、西北、东北）
  // ----------------------------------------------------------
  const corners = [
    [-MW_IN, -ML_IN, 41], [MW_IN, -ML_IN, 42],
    [-MW_IN, ML_IN, 43], [MW_IN, ML_IN, 44]
  ];
  for (const [cx, cz, sd] of corners) {
    O.push(box(cx, cz, 13, 13, 0, 4.4, { kind: 'wall', col: C.wallRedDark, t0: 0.5 }));
    O.push(palace(cx, cz, 12, 12, 4.4, 6.6, 8.4, 'gableHip', { t0: 0.8, over: 0.9 }));
    O.push(palace(cx, cz, 8, 8, 8.4, 10.4, 12.2, 'pyramid', { t0: 1.1, over: 0.6 }));
  }

  // ----------------------------------------------------------
  // 4. 紫禁城外城垣（高 9.9 米 -> Y: 4.0）与四门
  // ----------------------------------------------------------
  O.push(box(-MW_IN, 0, 2.2, ML_IN * 2, 0, 4.0, { kind: 'wall', col: C.wallRed, t0: 0.6 })); // 西城墙
  O.push(box(MW_IN, 0, 2.2, ML_IN * 2, 0, 4.0, { kind: 'wall', col: C.wallRed, t0: 0.6 }));  // 东城墙
  O.push(box(0, ML_IN, MW_IN * 2, 2.2, 0, 4.0, { kind: 'wall', col: C.wallRed, t0: 0.6 }));  // 北城墙

  // 东华门 (东城垣中偏南 X: +158, Z: -80)
  O.push(box(MW_IN, -80, 5, 26, 0, 5.8, { kind: 'wall', col: C.wallRedDark, t0: 0.8 }));
  O.push(palace(MW_IN, -80, 7, 24, 5.8, 8.2, 11.2, 'gableHip', { t0: 0.9 }));

  // 西华门 (西城垣中偏南 X: -158, Z: -80)
  O.push(box(-MW_IN, -80, 5, 26, 0, 5.8, { kind: 'wall', col: C.wallRedDark, t0: 0.8 }));
  O.push(palace(-MW_IN, -80, 7, 24, 5.8, 8.2, 11.2, 'gableHip', { t0: 0.9 }));

  // ----------------------------------------------------------
  // 5. 【午门广场与午门城台五凤楼】(Z: -188 到 -150)
  // ----------------------------------------------------------
  // 凹字形巨大红墙城台（通高 37.95 米 -> Y: 15.2）
  O.push(box(0, -162, 78, 16, 0, 7.2, { kind: 'wall', col: C.wallRedDark, t0: 0.8 }));
  O.push(box(-34, -178, 12, 34, 0, 7.2, { kind: 'wall', col: C.wallRedDark, t0: 0.9 })); // 西雁翅楼城台
  O.push(box(34, -178, 12, 34, 0, 7.2, { kind: 'wall', col: C.wallRedDark, t0: 0.9 }));  // 东雁翅楼城台
  // 午门正殿（重檐庑殿顶）
  O.push(palace(0, -162, 48, 14, 7.2, 10.4, 14.5, 'hip', { t0: 1.2, over: 1.4, double: true }));
  // 雁翅楼四座重檐小楼
  O.push(palace(-34, -190, 10, 9, 7.2, 9.4, 11.6, 'hip', { t0: 1.3 }));
  O.push(palace(34, -190, 10, 9, 7.2, 9.4, 11.6, 'hip', { t0: 1.3 }));
  O.push(palace(-34, -166, 10, 9, 7.2, 9.4, 11.6, 'hip', { t0: 1.3 }));
  O.push(palace(34, -166, 10, 9, 7.2, 9.4, 11.6, 'hip', { t0: 1.3 }));

  // ----------------------------------------------------------
  // 6. 【内金水河与五座内金水桥】(Z: -136 到 -118)
  // ----------------------------------------------------------
  O.push(plane(-72, -132, 72, -118, 0.03, C.water, 'water', 1.0, { alpha: 0.75 }));
  // 五座汉白玉如意桥（御路桥居中，两旁宗室桥、品官桥）
  const bridgeX = [-24, -12, 0, 12, 24];
  for (let i = 0; i < 5; i++) {
    const isCenter = i === 2;
    O.push(marbleBridge(bridgeX[i], -125, isCenter ? 6.2 : 4.4, 15, {
      rise: isCenter ? 1.6 : 1.2, t0: 1.4 + i * 0.08
    }));
  }

  // ----------------------------------------------------------
  // 7. 【西路南翼：武英殿区】(X: -92, Z: -128)
  // ----------------------------------------------------------
  O.push(box(-92, -128, 52, 38, 0, 1.2, { kind: 'plinth', col: C.marble, t0: 1.5 }));
  O.push(palace(-92, -128, 42, 18, 1.2, 4.6, 7.8, 'gableHip', { t0: 1.6, over: 1.0 })); // 武英殿主殿
  O.push(palace(-92, -145, 32, 12, 1.2, 3.8, 6.2, 'gableHip', { t0: 1.7 }));             // 敬思殿

  // ----------------------------------------------------------
  // 8. 【东路南翼：文华殿与文渊阁】(X: +92, Z: -128)
  // ----------------------------------------------------------
  O.push(box(92, -128, 52, 38, 0, 1.2, { kind: 'plinth', col: C.marble, t0: 1.5 }));
  O.push(palace(92, -128, 42, 18, 1.2, 4.6, 7.8, 'gableHip', { t0: 1.6, over: 1.0 }));  // 文华殿
  // 文渊阁 (独特的黑琉璃瓦绿剪边)
  O.push(palace(92, -108, 34, 14, 0, 4.2, 7.4, 'gableHip', {
    roofCol: C.roofBlack, t0: 1.8, over: 0.9
  }));

  // ----------------------------------------------------------
  // 9. 【太和门广场与太和门】(Z: -95 到 -75)
  // ----------------------------------------------------------
  O.push(marblePlinth(0, -82, 68, 22, 0, 2.0, 1, { t0: 1.8 }));
  O.push(palace(0, -82, 58, 16, 2.0, 6.2, 10.4, 'gableHip', { t0: 2.0, over: 1.3, double: true })); // 太和门
  // 昭德门 (东) 与 贞度门 (西)
  O.push(palace(48, -82, 15, 10, 0, 3.8, 6.2, 'hip', { t0: 2.1 }));
  O.push(palace(-48, -82, 15, 10, 0, 3.8, 6.2, 'hip', { t0: 2.1 }));
  // 太和门广场两侧千步廊阁：体仁阁 (东) 与 弘义阁 (西)
  O.push(palace(64, -38, 14, 52, 0, 4.8, 7.8, 'hip', { t0: 2.2 })); // 体仁阁
  O.push(palace(-64, -38, 14, 52, 0, 4.8, 7.8, 'hip', { t0: 2.2 })); // 弘义阁

  // ----------------------------------------------------------
  // 10. 【外朝三大殿工字形三层大石台基】(长 232 米 -> Z: -62 到 +42; 宽 130 米 -> X: -36 到 +36)
  // ----------------------------------------------------------
  // 三台第一层
  O.push(marblePlinth(0, -10, 72, 110, 0, 1.4, 1, { t0: 2.3 }));
  // 三台第二层
  O.push(marblePlinth(0, -10, 64, 102, 1.4, 2.7, 1, { t0: 2.4 }));
  // 三台第三层
  O.push(marblePlinth(0, -10, 56, 94, 2.7, 4.0, 1, { t0: 2.5 }));

  // ----------------------------------------------------------
  // 11. 【太和殿（金銮殿）】：天下第一殿 (Z: -42)
  // 实测面阔十一间 64m，进深五间 37m，通高 35.05m
  // ----------------------------------------------------------
  O.push(palace(0, -42, 50, 26, 4.0, 9.2, 15.0, 'hip', { t0: 2.7, over: 1.6, double: true }));
  // 殿前御道九龙丹陛石
  O.push(box(0, -60, 7.5, 12, 0, 4.0, { kind: 'plinth', col: C.marbleDark, t0: 2.9 }));

  // ----------------------------------------------------------
  // 12. 【中和殿】：四角攒尖方殿 (Z: -8)
  // 实测面阔 24.15m，高 19m
  // ----------------------------------------------------------
  O.push(palace(0, -8, 20, 20, 4.0, 7.8, 11.6, 'pyramid', { t0: 3.1, over: 1.1 }));

  // ----------------------------------------------------------
  // 13. 【保和殿与度九龙大石雕】(Z: +26)
  // 实测面阔九间 44m，进深 25m，高 29.5m
  // ----------------------------------------------------------
  O.push(palace(0, 26, 44, 22, 4.0, 8.4, 13.2, 'gableHip', { t0: 3.3, over: 1.4, double: true }));
  // 保和殿后单块汉白玉“度九龙”大石雕 (长 16.57m，重逾两百吨)
  O.push(box(0, 41, 8.0, 10, 0, 4.0, { kind: 'plinth', col: C.marbleDark, t0: 3.4 }));

  // ----------------------------------------------------------
  // 14. 【乾清门广场与乾清门红墙】(Z: +58)
  // 高 3 米红墙分隔外朝与内廷
  // ----------------------------------------------------------
  O.push(box(0, 58, 154, 1.8, 0, 4.2, { kind: 'wall', col: C.wallRed, t0: 3.5 }));
  O.push(palace(0, 58, 36, 12, 0, 4.6, 7.6, 'hip', { t0: 3.6, over: 1.0 })); // 乾清门
  // 景运门 (东) 与 隆宗门 (西)
  O.push(palace(62, 58, 14, 9, 0, 3.6, 5.8, 'hip', { t0: 3.7 }));
  O.push(palace(-62, 58, 14, 9, 0, 3.6, 5.8, 'hip', { t0: 3.7 }));
  for (const cx of [-20, 20]) {
    const faces = [], cz = 56, radius = 2.1, height = 2.8;
    for (let i = 0; i < 18; i++) {
      const a = i / 18 * TAU, b = (i + 1) / 18 * TAU;
      faces.push(face([v(cx + Math.cos(a) * radius, .4, cz + Math.sin(a) * radius), v(cx + Math.cos(b) * radius, .4, cz + Math.sin(b) * radius), v(cx + Math.cos(b) * radius, height, cz + Math.sin(b) * radius), v(cx + Math.cos(a) * radius, height, cz + Math.sin(a) * radius)], 'wall', .65 + .25 * Math.cos(a)));
    }
    faces.push(face(Array.from({ length: 18 }, (_, i) => v(cx + Math.cos(-i / 18 * TAU) * radius, height, cz + Math.sin(-i / 18 * TAU) * radius)), 'top'));
    O.push({ kind: 'urn', cx, cz, y1: height, col: C.gold, faces, fp: { w: 4.2, d: 4.2 }, t0: 3.7 });
  }

  // ----------------------------------------------------------
  // 15. 【西路中翼：养心殿与西六宫、慈宁宫区】
  // ----------------------------------------------------------
  // 养心殿 (雍正以降帝王寝宫 X: -54, Z: +86)
  O.push(box(-54, 86, 32, 28, 0, 1.0, { kind: 'plinth', col: C.marble, t0: 3.8 }));
  O.push(palace(-54, 86, 26, 14, 1.0, 4.6, 7.6, 'gableHip', { t0: 3.9 })); // 养心殿主殿

  // 西六宫院落群 (永寿、翊坤、储秀、太极、长春、咸福 X: -68, Z: +104 到 +154)
  const westSix = [
    [-68, 104, '永寿宫'], [-68, 124, '翊坤宫'], [-68, 144, '储秀宫'],
    [-92, 104, '太极殿'], [-92, 124, '长春宫'], [-92, 144, '咸福宫']
  ];
  for (const [px, pz] of westSix) {
    O.push(plane(px - 11, pz - 9, px + 11, pz + 9, .02, C.pave, 'plaza', 4));
    O.push(palace(px, pz + 4, 16, 7, 0, 2.6, 4.6, 'gableHip', { t0: 4.1 }));
    for (const side of [-1, 1]) {
      O.push(box(px + side * 11, pz, .8, 18, 0, 1.5, { kind: 'wall', col: C.wallRed }));
      O.push(palace(px + side * 8.5, pz - 2, 3.5, 9, 0, 1.9, 3.2, 'hip', { t0: 4.1 }));
    }
    O.push(palace(px, pz - 8, 5, 3, 0, 1.8, 3.1, 'hip', { t0: 4.1 }));
  }

  // 慈宁宫与寿康宫区 (X: -110, Z: +40 到 +80)
  O.push(palace(-110, 52, 38, 16, 0, 4.8, 7.8, 'gableHip', { t0: 4.2 })); // 慈宁宫大殿
  O.push(palace(-110, 78, 28, 14, 0, 4.2, 6.8, 'gableHip', { t0: 4.3 })); // 寿康宫

  // ----------------------------------------------------------
  // 16. 【内廷后三宫：乾清宫、交泰殿、坤宁宫】(Z: +78 到 +142)
  // ----------------------------------------------------------
  O.push(marblePlinth(0, 110, 46, 76, 0, 1.8, 1, { t0: 4.4 }));
  // 乾清宫 (面阔九间 54m，进深 27m，高 20m)
  O.push(palace(0, 86, 42, 22, 1.8, 7.2, 11.8, 'hip', { t0: 4.5, over: 1.3, double: true }));
  // 交泰殿 (方形攒尖顶)
  O.push(palace(0, 110, 18, 18, 1.8, 5.8, 9.2, 'pyramid', { t0: 4.6, over: 1.0 }));
  // 坤宁宫 (后廷中宫正寝)
  O.push(palace(0, 134, 38, 20, 1.8, 6.4, 10.4, 'gableHip', { t0: 4.7, over: 1.2 }));

  // ----------------------------------------------------------
  // 17. 【东路中翼：东六宫与宁寿宫区（乾隆小紫禁城）】
  // ----------------------------------------------------------
  // 东六宫院落群 (景仁、承乾、钟粹、延禧、永和、景阳 X: +54 到 +78, Z: +104 到 +154)
  const eastSix = [
    [54, 104, '景仁宫'], [54, 124, '承乾宫'], [54, 144, '钟粹宫'],
    [78, 104, '延禧宫'], [78, 124, '永和宫'], [78, 144, '景阳宫']
  ];
  for (const [px, pz] of eastSix) {
    O.push(plane(px - 11, pz - 9, px + 11, pz + 9, .02, C.pave, 'plaza', 4.8));
    O.push(palace(px, pz + 4, 16, 7, 0, 2.6, 4.6, 'gableHip', { t0: 4.9 }));
    for (const side of [-1, 1]) {
      O.push(box(px + side * 11, pz, .8, 18, 0, 1.5, { kind: 'wall', col: C.wallRed }));
      O.push(palace(px + side * 8.5, pz - 2, 3.5, 9, 0, 1.9, 3.2, 'hip', { t0: 4.9 }));
    }
    O.push(palace(px, pz - 8, 5, 3, 0, 1.8, 3.1, 'hip', { t0: 4.9 }));
  }

  // 宁寿宫区（乾隆归政太上皇宫殿：皇极门、皇极殿、九龙壁、畅音阁 X: +118, Z: +50 到 +160）
  // 皇极殿
  O.push(marblePlinth(118, 86, 44, 24, 0, 1.6, 1, { t0: 5.0 }));
  O.push(palace(118, 86, 38, 18, 1.6, 6.6, 10.8, 'hip', { t0: 5.1, over: 1.2 }));
  // 宁寿宫后寝
  O.push(palace(118, 116, 32, 16, 0, 5.2, 8.4, 'gableHip', { t0: 5.2 }));
  // 畅音阁三层大戏台
  O.push(palace(118, 146, 20, 20, 0, 7.8, 12.8, 'gableHip', { t0: 5.3 }));

  // ----------------------------------------------------------
  // 18. 【御花园】：苍劲古木、万春千秋、堆秀叠石 (Z: +154 到 +192)
  // ----------------------------------------------------------
  O.push(plane(-46, 152, 46, 192, 0.02, C.pave, 'garden', 5.3, { alpha: 0.4 }));
  // 钦安殿（御花园正中，供奉真武大帝）
  O.push(palace(0, 172, 22, 16, 0, 4.8, 7.8, 'gableHip', { t0: 5.4 }));
  // 万春亭 (西侧圆攒尖殿)
  O.push(palace(-22, 168, 13, 13, 0, 4.8, 8.2, 'round', { t0: 5.5 }));
  // 千秋亭 (东侧圆攒尖殿)
  O.push(palace(22, 168, 13, 13, 0, 4.8, 8.2, 'round', { t0: 5.5 }));
  // 堆秀山假山与御景亭 (东北角太湖石叠嶂)
  O.push(box(24, 184, 18, 14, 0, 6.5, { kind: 'wall', col: hex('#525e4e'), t0: 5.6 }));
  O.push(palace(24, 184, 9, 9, 6.5, 9.4, 11.8, 'pyramid', { t0: 5.7 }));

  // 御花园百年连理古柏树群
  const gardenPines = [
    [-32, 160, 5.5, 3.2, 12], [-14, 182, 6.0, 3.6, 15],
    [10, 162, 5.6, 3.4, 18], [34, 172, 5.2, 3.0, 21]
  ];
  for (const [px, pz, ph, pr, sd] of gardenPines) {
    O.push(imperialCypress(px, pz, ph, pr, sd, { crowns: 3, t0: 5.8 }));
  }

  // ----------------------------------------------------------
  // 19. 【神武门与景山风水靠山】(Z: +200 到 +240)
  // ----------------------------------------------------------
  // 神武门城台与城楼
  O.push(box(0, 200, 64, 14, 0, 6.6, { kind: 'wall', col: C.wallRedDark, t0: 5.9 }));
  O.push(palace(0, 200, 46, 14, 6.6, 9.8, 13.8, 'gableHip', { t0: 6.0, over: 1.2 }));

  // 景山五峰（紫禁城正北风水靠山，海拔 88 米，俯瞰紫禁城全貌）
  const ridge = [[-70, 1], [-36, 8], [0, 12], [36, 8], [70, 1]], hillFaces = [];
  for (let i = 0; i < ridge.length - 1; i++) {
    const [x0, y0] = ridge[i], [x1, y1] = ridge[i + 1];
    hillFaces.push(face([v(x0, 0, 226), v(x0, y0, 238), v(x1, y1, 238), v(x1, 0, 226)], 'terrain', .9));
    hillFaces.push(face([v(x1, 0, 250), v(x1, y1, 238), v(x0, y0, 238), v(x0, 0, 250)], 'terrain', .72));
  }
  O.push({ kind: 'hill', cx: 0, cz: 238, y1: 12, col: hex('#879b72'), faces: hillFaces, t0: 6.1 });
  O.push(palace(0, 238, 18, 18, 12.0, 15.6, 19.4, 'round', { t0: 6.2 })); // 景山顶万春亭

  return O;
}

function orderScene(objs, cam) {
  return objs.map((ob, index) => ({ ob, index, d: cam.depth(v(ob.cx, (ob.y1 ?? 2) * .5, ob.cz)) })).sort((a, b) => {
    const ap = a.ob.kind === 'plane', bp = b.ob.kind === 'plane';
    if (ap !== bp) return ap ? -1 : 1;
    return ap ? a.index - b.index : b.d - a.d;
  });
}

// ---------- 场景光栅与水墨渲染 ----------
function renderScene(ctx, objs, cam, t, W, H, o = {}) {
  const season = o.season ?? 'day';
  const tint = season === 'sunset' ? 1.0 : (season === 'snow' ? -1.0 : 0);
  const snow = season === 'snow' ? 1.0 : 0;

  paper(ctx, W, H, tint, snow);

  const list = orderScene(objs, cam);

  for (const { ob } of list) {
    const start = ob.t0 ?? 0;
    if (t < start) continue;
    const rev = ss(clamp((t - start) / 1.5));

    // 平面类（水体、地面、广场）
    if (ob.kind === 'plane') {
      const pts = ob.faces[0].pts.map(p => cam.p(p));
      if (pts.some(p => !p)) continue;
      const poly = pts.map(p => [p.x, p.y]);
      ctx.save();
      if (rev < 1) {
        const cx0 = poly.reduce((s, p) => s + p[0], 0) / poly.length;
        const cy0 = poly.reduce((s, p) => s + p[1], 0) / poly.length;
        revealClip(ctx, { x: cx0, y: cy0 }, 80 + rev * 3000, (ob.cx | 0) + 7);
      }
      const col = ob.col ?? faceColor(ob, ob.faces[0], season);
      wash(ctx, poly, season === 'sunset' ? mix3(col, C3COOL, 0.3) : col, {
        a: ob.alpha ?? 0.45, j: 22, layers: 3, seed: 11 + (ob.cx | 0), freq: 0.005
      });
      ctx.restore();
      o.detail?.(ctx, ob, cam, { season });
      continue;
    }

    // 阴影投射：下午阳照，向右前方拉出淡墨长影
    if (ob.fp && o.shadows !== false && season !== 'snow') {
      const tall = ob.kind === 'cypress' ? 2.4 : 1.3;
      const ox = 0.5 * tall, oz = 0.45 * tall;
      const w2 = ob.fp.w * 0.45, d2 = ob.fp.d * 0.45;
      const q = [[-w2, -d2], [w2, -d2], [w2, d2], [-w2, d2]].map(([dx, dz]) => cam.p(v(ob.cx + dx + ox, 0.012, ob.cz + dz + oz)));
      if (q.every(Boolean)) {
        ctx.save();
        ctx.globalCompositeOperation = 'multiply';
        const g = ctx.createLinearGradient(q[0].x, q[0].y, q[2].x, q[2].y);
        g.addColorStop(0, 'rgba(92, 82, 68, 0.22)');
        g.addColorStop(0.6, 'rgba(92, 82, 68, 0.12)');
        g.addColorStop(1, 'rgba(92, 82, 68, 0.01)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(q[0].x, q[0].y);
        for (let i = 1; i < 4; i++) ctx.lineTo(q[i].x, q[i].y);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }

    // 古柏树木
    if (ob.kind === 'cypress') {
      const a = cam.p(v(ob.trunk.cx, 0, ob.trunk.cz)), b = cam.p(v(ob.trunk.cx, ob.trunk.h, ob.trunk.cz));
      if (a && b) {
        ctx.save();
        const w = cam.ortho ? Math.max(5, 2.6 * cam.ortho) : Math.max(5, 340 / Math.max(1, a.z));
        wash(ctx, [[a.x - w / 2, a.y], [a.x + w / 2, a.y], [b.x + w * 0.3, b.y], [b.x - w * 0.3, b.y]], C.woodDark, { a: 0.55, j: 3, layers: 2, seed: 13 });
        ink(ctx, [v(a.x - w / 2, a.y, 0), v(b.x - w * 0.3, b.y, 0)], { w: 2.2, seed: 31, p: clamp((t - start) / 1.2) });
        ink(ctx, [v(a.x + w / 2, a.y, 0), v(b.x + w * 0.3, b.y, 0)], { w: 2.2, seed: 32, p: clamp((t - start) / 1.2) });
        ctx.restore();
      }
      for (const cr of ob.crowns) {
        const c = cam.p(v(cr.x, cr.y, cr.z));
        if (!c) continue;
        const R = cam.ortho ? Math.max(6, cr.r * cam.ortho) : Math.max(8, cr.r * cam.focal / c.z);
        ctx.save();
        const pal = season === 'snow' ? [mix3(C.leafL, PAPER, .58), mix3(C.leaf, PAPER, .35), C.leafD] : [C.leafL, C.leaf, C.leafD];
        for (let k = 0; k < 3; k++) {
          wash(ctx, ellipse(c.x + (k - 1) * R * 0.24, c.y - R * 0.2 + k * R * 0.2, R * (0.8 + k * 0.05), R * (0.6 + k * 0.05), 14), pal[k], { a: 0.32, j: R * 0.2, layers: 2, seed: 90 + k + (cr.seed | 0) });
        }
        const rr = rng(cr.seed);
        const N = Math.round(clamp(R * 1.1, 35, 120));
        for (let i = 0; i < N; i++) {
          const ang = rr() * TAU, dd = Math.sqrt(rr()) * R;
          dab(ctx, c.x + Math.cos(ang) * dd, c.y + Math.sin(ang) * dd * 0.85, 1.2 + rr() * R * 0.07, rr() * TAU, pal[(rr() * 3) | 0], 0.26 + rr() * 0.28, (cr.seed * 7 + i) | 0);
        }
        ctx.restore();
      }
      o.detail?.(ctx, ob, cam, { season });
      continue;
    }

    // 多面体建筑：计算遮挡留白、水彩分色与墨线勾勒
    const fs = ob.faces.map(f => {
      const c = f.pts.reduce((s, p) => add(s, p), v(0, 0, 0));
      const cc = v(c.x / f.pts.length, c.y / f.pts.length, c.z / f.pts.length);
      return { f, cc, d: cam.depth(cc) };
    }).sort((a, b) => b.d - a.d);

    // 建筑遮挡留白（Paper occlusion）
    if (ob.kind === 'palace' || ob.kind === 'wall' || ob.kind === 'bridge' || ob.kind === 'urn') {
      const all = [];
      for (const { f } of fs) for (const p of f.pts) { const q = cam.p(p); if (q) all.push([q.x, q.y]); }
      if (all.length > 3) {
        const hull = convexHull(all);
        if (hull && hull.length > 2) {
          ctx.save();
          ctx.globalAlpha = 0.92 * rev;
          ctx.fillStyle = '#f5eede';
          ctx.beginPath(); ctx.moveTo(hull[0][0], hull[0][1]);
          for (let i = 1; i < hull.length; i++) ctx.lineTo(hull[i][0], hull[i][1]);
          ctx.closePath(); ctx.fill();
          ctx.restore();
        }
      }
    }

    const drawnEdges = new Set();
    for (const { f, cc } of fs) {
      const n = nrm(crossv(sub(f.pts[1], f.pts[0]), sub(f.pts[2], f.pts[0])));
      const twoSided = f.kind === 'water' || f.kind === 'ground' || f.kind === 'plaza';
      if (!twoSided && dot(n, nrm(sub(cam.eye, cc))) <= 0) continue;

      const pts = f.pts.map(p => cam.p(p));
      if (pts.some(p => !p)) continue;
      const poly = pts.map(p => [p.x, p.y]);
      const baseCol = faceColor(ob, f, season);
      const lit = clamp(0.55 + 0.45 * Math.max(0, dot(n, nrm(v(-0.45, 0.8, 0.5)))), 0.35, 1);

      ctx.save();
      const fa = (f.shade ?? 1) * 0.67;
      wash(ctx, poly, mix3(baseCol, C3COOL, (1 - lit) * 0.35), {
        a: fa, j: 4.5, layers: 2, seed: 40 + ((ob.cx | 0) * 3 + (ob.cz | 0))
      });
      ctx.restore();

      // 墨线勾勒
      const ip = clamp((t - start - 0.2) / 1.1);
      if (ip > 0) {
        for (let i = 0; i < poly.length; i++) {
          const a = poly[i], b = poly[(i + 1) % poly.length];
          if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 4) continue;
          const edgeKey = [a, b].map(point => point.map(value => Math.round(value * 10)).join(',')).sort().join('|');
          if (drawnEdges.has(edgeKey)) continue;
          drawnEdges.add(edgeKey);
          ink(ctx, [v(a[0], a[1], 0), v(b[0], b[1], 0)], {
            w: f.kind === 'roof' ? 1.25 : 1.45, wob: .45, over: 1.8, seed: 50 + i + (ob.cx | 0) * 3, p: ip
          }, .76);
        }
      }
      if (f.kind === 'roof' && f.pts.length === 4 && ob.kind === 'palace') {
        const count = clamp(Math.round(ob.o.w * .6), 6, 34);
        for (let i = 1; i < count; i++) {
          const u = i / count;
          const blend = (a, b) => v(lerp(a.x, b.x, u), lerp(a.y, b.y, u), lerp(a.z, b.z, u));
          const a = cam.p(blend(f.pts[0], f.pts[1]));
          const b = cam.p(blend(f.pts[3], f.pts[2]));
          if (a && b) ink(ctx, [v(a.x, a.y, 0), v(b.x, b.y, 0)], { w: .85, wob: .35, over: 1, seed: 300 + i }, .33);
        }
      }
    }
    if (ob.kind === 'palace') {
      const count = clamp(Math.round(ob.o.w / 5), 3, 11);
      const z = ob.cz - ob.o.d * .45;
      if (cam.eye.z < z) for (let i = 0; i <= count; i++) {
        const x = ob.cx + ob.o.w * .84 * (i / count - .5);
        const a = cam.p(v(x, ob.o.y0, z));
        const b = cam.p(v(x, ob.o.eavesY, z));
        if (a && b) ink(ctx, [v(a.x, a.y, 0), v(b.x, b.y, 0)], { w: 1.5, wob: .4, over: 1, seed: 500 + i }, .64);
      }
    }
    o.detail?.(ctx, ob, cam, { season });
  }
}


// Capture the new plate artwork in independent colour, pen, lettering and seal layers.
function capturePlate(page, draw) {
  if (!Number.isInteger(page) || page < 1 || page > 16 || typeof draw !== 'function') {
    throw new RangeError('A palace plate number from 1 to 16 and a drawing function are required');
  }
  const color = document.createElement('canvas');
  color.width = 2400; color.height = 1350;
  const ctx = color.getContext('2d');
  const capture = { ctx, strokes: [], texts: [], seals: [] };
  activePlateCapture = capture;
  try {
    draw(ctx, page);
    return { color, strokes: capture.strokes, texts: capture.texts, seals: capture.seals };
  } finally {
    activePlateCapture = null;
  }
}

export {
  clamp, lerp, ss, TAU, perspCam, forbiddenCitySite, renderScene, palaceSound,
  capturePlate, drawPen, handwrite, sealStamp, rng, fbm, ink, wash, ellipse, hex, v, dab,
  paper, pathPoly, palace, faceColor, orderScene,
};
