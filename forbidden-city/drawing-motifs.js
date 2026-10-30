import { ellipse, rng, lerp, sealStamp } from './art.js?v=20261030-official-dragon';
import { P, pen, tint, rect, outline, oval, lattice, brickwork } from './drawing-kit.js?v=20261030-official-dragon';

export function bridge(ctx, cx, top, w, h, seed = 12) {
  const x0 = cx - w / 2, x1 = cx + w / 2;
  const curve = Array.from({ length: 33 }, (_, i) => [lerp(x0, x1, i / 32), top + h * .25 * (1 - Math.sin(i / 32 * Math.PI))]);
  tint(ctx, [...curve, [x1 + 12, top + h], [x0 - 12, top + h]], P.stone, .84, 2, seed);
  pen(ctx, curve, 2.6, .8, true);
  const arch = Array.from({ length: 25 }, (_, i) => {
    const angle = Math.PI + i / 24 * Math.PI;
    return [cx + Math.cos(angle) * w * .34, top + h + Math.sin(angle) * h * .65];
  });
  tint(ctx, [...arch, [cx + w * .34, top + h + 6], [cx - w * .34, top + h + 6]], P.waterDark, .66, 2, seed + 1);
  pen(ctx, arch, 2.2, .8, true);
  for (let i = 0; i < 16; i++) {
    const angle = Math.PI + i / 15 * Math.PI;
    const a = [cx + Math.cos(angle) * w * .35, top + h + Math.sin(angle) * h * .67];
    const b = [cx + Math.cos(angle) * w * .41, top + h + Math.sin(angle) * h * .88];
    pen(ctx, [a, b], 1, .48);
  }
  for (const offset of [-52, -28, -3]) pen(ctx, curve.map(([x, y]) => [x, y + offset]), 1.4, .65, true);
  for (let i = 0; i <= 18; i++) {
    const [x, y] = curve[Math.round(i / 18 * 32)];
    tint(ctx, rect(x - 4, y - 64, 8, 68), P.stone, .82, .5, seed + i);
    outline(ctx, rect(x - 4, y - 64, 8, 68), 1.05, .68);
    oval(ctx, x, y - 66, 6.5, 5, P.stoneDark, .38);
  }
  for (let j = 1; j < 5; j++) {
    const yy = top + h * j / 5;
    const side = w * (.48 - j * .025);
    pen(ctx, [[cx - side, yy], [cx - w * .35, yy]], .75, .35);
    pen(ctx, [[cx + w * .35, yy], [cx + side, yy]], .75, .35);
  }
}

function spiral(ctx, x, y, radius, alpha = .6, width = 1.1) {
  const points = Array.from({ length: 22 }, (_, i) => {
    const u = i / 21, angle = u * Math.PI * 3.5;
    return [x + Math.cos(angle) * radius * (1 - u * .8), y + Math.sin(angle) * radius * (1 - u * .8)];
  });
  pen(ctx, points, width, alpha, true);
}

export function lion(ctx, cx, bottom, scale = 1, color = '#667e69', seed = 30) {
  const s = scale, y = bottom - 210 * s, random = rng(seed);
  tint(ctx, [[cx - 105 * s, bottom], [cx + 115 * s, bottom], [cx + 130 * s, bottom + 85 * s], [cx - 115 * s, bottom + 85 * s]], P.stoneDark, .65, 2, seed);
  outline(ctx, [[cx - 105 * s, bottom], [cx + 115 * s, bottom], [cx + 130 * s, bottom + 85 * s], [cx - 115 * s, bottom + 85 * s]], 1.8, .6);
  brickwork(ctx, cx - 95 * s, bottom + 15 * s, 200 * s, 55 * s, 46 * s, .27);
  oval(ctx, cx + 8 * s, y + 120 * s, 83 * s, 105 * s, color, .73);
  oval(ctx, cx + 15 * s, y + 17 * s, 81 * s, 76 * s, color, .78);
  for (let i = 0; i < 26; i++) {
    const a = i / 26 * Math.PI * 2, px = cx + 15 * s + Math.cos(a) * 71 * s, py = y + 17 * s + Math.sin(a) * 65 * s;
    spiral(ctx, px, py, 9 * s, .7, 1.3 * s);
  }
  for (const side of [-1, 1]) {
    oval(ctx, cx + (15 + side * 73) * s, y - 12 * s, 15 * s, 21 * s, color, .7);
    pen(ctx, [[cx + (15 + side * 40) * s, y + 10 * s], [cx + (15 + side * 22) * s, y + 3 * s], [cx + (15 + side * 8) * s, y + 12 * s]], 2.5 * s, .85, true);
    oval(ctx, cx + (15 + side * 27) * s, y + 15 * s, 4 * s, 4.5 * s, P.dark, .9, false);
    oval(ctx, cx + side * 50 * s, bottom - 8 * s, 32 * s, 16 * s, color, .8);
    for (let claw = 0; claw < 4; claw++) pen(ctx, [[cx + (side * 50 - 19 + claw * 12) * s, bottom - 6 * s], [cx + (side * 50 - 20 + claw * 12) * s, bottom + 5 * s]], 1.5 * s, .8);
  }
  oval(ctx, cx + 15 * s, y + 38 * s, 38 * s, 25 * s, color, .72);
  tint(ctx, [[cx + 2 * s, y + 24 * s], [cx + 29 * s, y + 24 * s], [cx + 17 * s, y + 37 * s]], P.dark, .8, .5);
  pen(ctx, [[cx - 10 * s, y + 48 * s], [cx + 15 * s, y + 59 * s], [cx + 43 * s, y + 46 * s]], 2 * s, .8, true);
  for (let i = 0; i < 28; i++) spiral(ctx, cx + (random() - .5) * 100 * s, y + (80 + random() * 90) * s, (4 + random() * 6) * s, .5, .9 * s);
  oval(ctx, cx + 65 * s, bottom - 44 * s, 29 * s, 27 * s, color, .65);
  for (let i = 0; i < 6; i++) pen(ctx, [[cx + (45 + i * 7) * s, bottom - 63 * s], [cx + (65 + i * 4) * s, bottom - 24 * s]], .85 * s, .5, true);
}

// --- Official Imperial Dragon (故宫官式龙纹：正龙/坐龙、升龙、降龙) ---

function fiveClaws(ctx, wx, wy, angle, s, color, side) {
  // 掌心虎掌肉垫
  oval(ctx, wx, wy, 5.2 * s, 4.2 * s, color, 0.85, true);
  // 4 根前屈鹰爪（带双指节与钢钩内扣爪尖）
  for (let i = 0; i < 4; i++) {
    const spread = angle + (i - 1.5) * 0.36;
    const mid = [wx + Math.cos(spread) * 11 * s, wy + Math.sin(spread) * 11 * s];
    const hookAngle = spread + (side > 0 ? 0.38 : -0.38);
    const tip = [mid[0] + Math.cos(hookAngle) * 8 * s, mid[1] + Math.sin(hookAngle) * 8 * s];
    pen(ctx, [[wx, wy], mid, tip], 1.35 * s, 0.9, true);
    pen(ctx, [mid, tip], 0.85 * s, 0.95);
  }
  // 第 5 爪：向后反扣的后指大拇爪（大趾，皇家五爪定式）
  const thumbAngle = angle + (side > 0 ? -1 : 1) * Math.PI * 0.72;
  const thumbMid = [wx + Math.cos(thumbAngle) * 8.5 * s, wy + Math.sin(thumbAngle) * 8.5 * s];
  const thumbTip = [thumbMid[0] + Math.cos(thumbAngle - 0.45) * 6.5 * s, thumbMid[1] + Math.sin(thumbAngle - 0.45) * 6.5 * s];
  pen(ctx, [[wx, wy], thumbMid, thumbTip], 1.3 * s, 0.9, true);
}

function flamePearl(ctx, px, py, radius, s, seed) {
  // 宝珠金色光晕
  oval(ctx, px, py, radius * 1.35, radius * 1.35, '#f4ba3e', 0.42, false);
  // 赤金宝珠主体
  oval(ctx, px, py, radius, radius, '#f7ca45', 0.88, true);
  // 核心白金珠光高光
  oval(ctx, px, py, radius * 0.58, radius * 0.58, '#fffdf2', 0.96, false);
  // 四道旋转太阳神火火舌（游龙戏珠烈焰）
  for (let f = 0; f < 4; f++) {
    const theta = f * Math.PI / 2 + (seed % 7) * 0.25;
    const fx = px + Math.cos(theta) * radius * 0.9;
    const fy = py + Math.sin(theta) * radius * 0.9;
    const flameTip = [px + Math.cos(theta + 0.65) * radius * 2.2, py + Math.sin(theta + 0.65) * radius * 2.2];
    pen(ctx, [[fx, fy], flameTip], 1.25 * s, 0.85, true);
    spiral(ctx, flameTip[0], flameTip[1], radius * 0.38, 0.65, 0.9 * s);
  }
}

// 1. 皇家正龙（坐龙 / 盘龙）：故宫九龙壁正中金龙、皇帝宝座金龙屏风之最高规制
function drawZhengLong(ctx, cx, cy, s, color, seed) {
  // (1) 盘龙身段：大圆同心环抱
  const bodyLoop = [
    [cx, cy - 82 * s],
    [cx - 52 * s, cy - 88 * s], [cx - 95 * s, cy - 55 * s], [cx - 105 * s, cy - 12 * s],
    [cx - 108 * s, cy + 35 * s], [cx - 82 * s, cy + 82 * s], [cx - 42 * s, cy + 102 * s],
    [cx, cy + 108 * s],
    [cx + 42 * s, cy + 102 * s], [cx + 82 * s, cy + 82 * s], [cx + 108 * s, cy + 35 * s],
    [cx + 105 * s, cy - 12 * s], [cx + 95 * s, cy - 55 * s], [cx + 52 * s, cy - 88 * s],
  ];

  // 计算环抱身躯法线与内外轮廓
  const outer = [], inner = [], belly = [];
  const loopPts = [...bodyLoop, bodyLoop[0]];
  for (let i = 0; i < bodyLoop.length; i++) {
    const prev = loopPts[Math.max(0, i - 1)], next = loopPts[i + 1];
    const dx = next[0] - prev[0], dy = next[1] - prev[1];
    const len = Math.hypot(dx, dy) || 1;
    const r = (11 + Math.sin(i / bodyLoop.length * Math.PI) * 4) * s;
    const nx = -dy / len * r, ny = dx / len * r;
    outer.push([bodyLoop[i][0] + nx, bodyLoop[i][1] + ny]);
    inner.push([bodyLoop[i][0] - nx, bodyLoop[i][1] - ny]);
    belly.push([bodyLoop[i][0] - nx * 0.35, bodyLoop[i][1] - ny * 0.35]);
  }

  // 龙身矿物颜料与暖白蚌腹双层水彩晕染
  tint(ctx, [...outer, ...inner.toReversed()], color, .8, 1.2, seed);
  tint(ctx, [...belly, ...inner.toReversed()], '#fff5de', .38, .8, seed + 2);

  // 腹部横纹（蜃腹甲板）
  for (let i = 0; i < bodyLoop.length; i += 2) {
    pen(ctx, [bodyLoop[i], inner[i]], 0.85 * s, 0.45);
  }

  // 背脊外轮廓锯齿放射火焰背鳍（刀鳍刺）
  for (let i = 0; i < outer.length; i += 2) {
    const [ox, oy] = outer[i];
    const next = outer[(i + 1) % outer.length];
    const finDx = (ox - cx), finDy = (oy - (cy + 10 * s));
    const finLen = Math.hypot(finDx, finDy) || 1;
    const finTip = [ox + (finDx / finLen) * 9 * s, oy + (finDy / finLen) * 9 * s];
    tint(ctx, [[ox, oy], finTip, next], '#e5b244', .65, .5, seed + i);
    pen(ctx, [[ox, oy], finTip, next], .9 * s, .8, true);
  }

  // 交错覆瓦金鳞
  for (let i = 0; i < bodyLoop.length; i++) {
    const [bx, by] = bodyLoop[i];
    pen(ctx, [
      [bx - 5 * s, by - 2 * s],
      [bx, by + 3.5 * s],
      [bx + 5 * s, by - 2 * s],
    ], 0.75 * s, 0.65, true);
  }

  // 双钩墨线轮廓
  pen(ctx, [...outer, outer[0]], 1.5 * s, .84, true);
  pen(ctx, [...inner, inner[0]], 1.3 * s, .75, true);

  // 翻卷烈焰尾鳍（右侧向上冲起）
  const tailBase = [cx + 105 * s, cy - 12 * s];
  const tailPlumes = [
    [cx + 138 * s, cy - 48 * s],
    [cx + 124 * s, cy - 65 * s],
    [cx + 105 * s, cy - 78 * s],
    [cx + 145 * s, cy - 28 * s],
  ];
  tint(ctx, [tailBase, ...tailPlumes], color, .78, 1.2, seed + 5);
  for (const tp of tailPlumes) {
    pen(ctx, [tailBase, [lerp(tailBase[0], tp[0], .5) + 6 * s, lerp(tailBase[1], tp[1], .5)], tp], 1.2 * s, .82, true);
    spiral(ctx, tp[0], tp[1], 4.2 * s, .65, .85 * s);
  }

  // (2) 左右四肢五爪金龙（上双前爪抱珠，下双后爪踏波）
  for (const side of [-1, 1]) {
    const shoulder = [cx + side * 34 * s, cy + 2 * s];
    const elbow = [cx + side * 62 * s, cy + 18 * s];
    const wrist = [cx + side * 42 * s, cy + 42 * s];
    tint(ctx, [shoulder, [elbow[0] + side * 4 * s, elbow[1]], wrist, [elbow[0] - side * 4 * s, elbow[1]]], color, .78, 1, seed);
    pen(ctx, [shoulder, elbow, wrist], 2.4 * s, .85, true);

    for (let f = 0; f < 3; f++) {
      pen(ctx, [elbow, [elbow[0] + side * (14 + f * 5) * s, elbow[1] - (8 + f * 4) * s]], .85 * s, .7, true);
    }
    const clawAngle = Math.atan2(cy + 42 * s - elbow[1], (cx + side * 15 * s) - elbow[0]);
    fiveClaws(ctx, wrist[0], wrist[1], clawAngle, s, color, side);
  }

  for (const side of [-1, 1]) {
    const hip = [cx + side * 48 * s, cy + 85 * s];
    const knee = [cx + side * 76 * s, cy + 102 * s];
    const ankle = [cx + side * 88 * s, cy + 128 * s];
    pen(ctx, [hip, knee, ankle], 2.2 * s, .85, true);
    fiveClaws(ctx, ankle[0], ankle[1], Math.PI * 0.5 + side * 0.35, s, color, side);
  }

  // (3) 居中端坐之威严正面龙头
  const headY = cy - 24 * s;
  const crown = [cx, headY - 42 * s];
  const browL = [cx - 28 * s, headY - 18 * s], browR = [cx + 28 * s, headY - 18 * s];
  const cheekL = [cx - 42 * s, headY + 4 * s], cheekR = [cx + 42 * s, headY + 4 * s];
  const jawL = [cx - 32 * s, headY + 24 * s], jawR = [cx + 32 * s, headY + 24 * s];
  const chin = [cx, headY + 28 * s];

  const headFace = [crown, [cx - 16 * s, headY - 32 * s], browL, cheekL, jawL, chin, jawR, cheekR, browR, [cx + 16 * s, headY - 32 * s]];
  tint(ctx, headFace, color, .86, 1.2, seed + 1);
  outline(ctx, headFace, 1.8 * s, .88);

  // 正面狮鼻与鼻孔
  oval(ctx, cx, headY - 5 * s, 14 * s, 9 * s, color, .85, true);
  oval(ctx, cx - 6 * s, headY - 4 * s, 2.8 * s, 2.2 * s, P.dark, .95, false);
  oval(ctx, cx + 6 * s, headY - 4 * s, 2.8 * s, 2.2 * s, P.dark, .95, false);

  // 正面怒目金睛
  for (const side of [-1, 1]) {
    const ex = cx + side * 18 * s, ey = headY - 18 * s;
    pen(ctx, [[ex - side * 12 * s, ey - 2 * s], [ex, ey - 7 * s], [ex + side * 14 * s, ey - 12 * s]], 2.6 * s, .92, true);
    oval(ctx, ex, ey, 4.8 * s, 4 * s, '#fff8e2', .96, true);
    oval(ctx, ex, ey, 2.4 * s, 2.6 * s, P.dark, .95, false);
    oval(ctx, ex + side * 0.8 * s, ey - 0.8 * s, 0.9 * s, 0.9 * s, '#ffffff', .92, false);
  }

  // 阔口獠牙与朱砂龙舌
  pen(ctx, [[cx - 26 * s, headY + 8 * s], [cx - 24 * s, headY + 21 * s], [cx - 22 * s, headY + 8 * s]], 1.25 * s, .95, true);
  pen(ctx, [[cx + 26 * s, headY + 8 * s], [cx + 24 * s, headY + 21 * s], [cx + 22 * s, headY + 8 * s]], 1.25 * s, .95, true);
  for (let t = -3; t <= 3; t++) {
    pen(ctx, [[cx + t * 5 * s, headY + 7 * s], [cx + (t + 0.5) * 5 * s, headY + 12 * s]], 0.9 * s, .88);
  }
  tint(ctx, [[cx - 8 * s, headY + 10 * s], [cx, headY + 27 * s], [cx + 8 * s, headY + 10 * s]], P.red, .86, .5, seed);
  pen(ctx, [[cx, headY + 9 * s], [cx, headY + 28 * s]], 1.6 * s, .9, true);

  // 对称雄浑鹿角
  for (const side of [-1, 1]) {
    const hornRoot = [cx + side * 12 * s, headY - 38 * s];
    const hornMid = [cx + side * 34 * s, headY - 65 * s];
    const hornTip = [cx + side * 56 * s, headY - 96 * s];
    pen(ctx, [hornRoot, hornMid, hornTip], 2.2 * s, .88, true);
    pen(ctx, [hornMid, [hornMid[0] + side * 12 * s, hornMid[1] - 16 * s]], 1.5 * s, .84, true);
    pen(ctx, [hornTip, [hornTip[0] - side * 10 * s, hornTip[1] + 8 * s]], 1.2 * s, .8, true);
  }

  // 对称修长龙须
  for (const side of [-1, 1]) {
    pen(ctx, [
      [cx + side * 14 * s, headY - 4 * s],
      [cx + side * 48 * s, headY - 14 * s],
      [cx + side * 78 * s, headY - 4 * s],
      [cx + side * 85 * s, headY + 22 * s],
      [cx + side * 56 * s, headY + 48 * s],
      [cx + side * 28 * s, headY + 58 * s],
    ], 1.35 * s, .86, true);
  }

  // 下颌浓密墨髯
  for (let i = -3; i <= 3; i++) {
    pen(ctx, [
      [cx + i * 6 * s, headY + 26 * s],
      [cx + i * 4 * s, headY + 44 * s],
    ], 1.1 * s, .72);
  }

  // 脑后两侧翻飞龙鬃
  for (const side of [-1, 1]) {
    for (let f = 0; f < 6; f++) {
      const maneRoot = [cx + side * 22 * s, headY - (28 - f * 6) * s];
      const maneTip = [cx + side * (52 + f * 6) * s, headY - (42 - f * 3) * s];
      pen(ctx, [maneRoot, [lerp(maneRoot[0], maneTip[0], .5) + side * 8 * s, maneRoot[1] - 8 * s], maneTip], 1.3 * s, .78, true);
    }
  }

  // (4) 正胸前赤金火焰宝珠（神龙护珠）
  if (s >= 0.32) {
    flamePearl(ctx, cx, cy + 42 * s, 11 * s, s, seed);
  }
}

// 2. 皇家行龙（升龙与降龙）：金龙和玺枋心、九龙壁左右拱卫诸龙之经典动势
function drawXingLong(ctx, cx, cy, s, color, direction, seed, isDescending) {
  const d = direction;

  let curves;
  if (!isDescending) {
    // 升龙：昂首长啸、穿云跃起、龙尾在下
    curves = [
      [[-155, 95], [-165, -30], [-100, -75], [-45, 10]],
      [[-45, 10], [5, 90], [55, 60], [30, -25]],
      [[30, -25], [10, -95], [85, -90], [130, -45]],
    ];
  } else {
    // 降龙：高拱九霄、倒挂金钩、龙首俯冲向下扑浪
    curves = [
      [[-150, -65], [-120, -115], [-50, -95], [-20, -25]],
      [[-20, -25], [10, 50], [-70, 95], [15, 80]],
      [[15, 80], [90, 65], [80, -15], [125, 25]],
    ];
  }

  const numPoints = 79;
  const points = Array.from({ length: numPoints }, (_, i) => {
    const segment = Math.min(curves.length - 1, Math.floor(i / (numPoints / curves.length)));
    const segSteps = numPoints / curves.length;
    const t = (i - segment * segSteps) / segSteps, q = 1 - t;
    const [a, b, c, dPt] = curves[segment];
    const x = q ** 3 * a[0] + 3 * q * q * t * b[0] + 3 * q * t * t * c[0] + t ** 3 * dPt[0];
    const y = q ** 3 * a[1] + 3 * q * q * t * b[1] + 3 * q * t * t * c[1] + t ** 3 * dPt[1];
    return [cx + d * x * s, cy + y * s];
  });

  const left = [], right = [], belly = [];
  const normals = [];
  points.forEach(([x, y], i) => {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const u = i / (points.length - 1);
    const r = (3.5 + 12.5 * Math.sin(Math.pow(u, 0.68) * Math.PI)) * s;
    const nx = -(b[1] - a[1]) / len * r, ny = (b[0] - a[0]) / len * r;
    normals.push([nx / r, ny / r, r]);
    left.push([x + nx, y + ny]);
    right.push([x - nx, y - ny]);
    belly.push([x - nx * 0.4, y - ny * 0.4]);
  });

  // 双层水彩晕染与腹甲横纹
  tint(ctx, [...left, ...right.toReversed()], color, .78, 1.2, seed);
  tint(ctx, [...belly, ...right.toReversed()], '#fff4dc', .36, .8, seed + 2);

  for (let i = 8; i < points.length - 6; i += 3) {
    pen(ctx, [points[i], right[i]], 0.8 * s, 0.45);
  }

  // 锯齿火焰背脊刀鳍
  for (let i = 10; i < points.length - 6; i += 3) {
    const [lx, ly] = left[i];
    const [nx, ny] = normals[i];
    const finLen = (7 + (i % 6 === 0 ? 5 : 2)) * s;
    const finTip = [lx + nx * finLen, ly + ny * finLen];
    const nextLeft = left[Math.min(points.length - 1, i + 2)];
    tint(ctx, [[lx, ly], finTip, nextLeft], '#e5b244', .62, .5, seed + i);
    pen(ctx, [[lx, ly], finTip, nextLeft], .9 * s, .78, true);
  }

  // 覆瓦金鳞
  for (let i = 8; i < points.length - 7; i += 2) {
    const [x, y] = points[i];
    const [nx, ny, r] = normals[i];
    for (const offset of [-0.28, 0.28]) {
      const sx = x + nx * r * offset, sy = y + ny * r * offset;
      const scaleW = 4.2 * s, scaleH = 3.6 * s;
      pen(ctx, [
        [sx - ny * scaleW - nx * scaleH * .6, sy + nx * scaleW - ny * scaleH * .6],
        [sx + nx * scaleH * .6, sy + ny * scaleH * .6],
        [sx + ny * scaleW - nx * scaleH * .6, sy - nx * scaleW - ny * scaleH * .6],
      ], .75 * s, .68, true);
    }
  }

  // 双钩墨线轮廓
  pen(ctx, left, 1.45 * s, .82, true);
  pen(ctx, right, 1.45 * s, .82, true);

  // 卷云火焰尾鳍
  const [tx, ty] = points[0];
  const tailDirX = (points[0][0] - points[3][0]) || -1;
  const tailDirY = (points[0][1] - points[3][1]) || 0;
  const tailLen = Math.hypot(tailDirX, tailDirY) || 1;
  const tdx = tailDirX / tailLen, tdy = tailDirY / tailLen;
  const tnx = -tdy, tny = tdx;

  const tailPlumes = [
    [tdx * 48 * s, tdy * 48 * s],
    [tdx * 38 * s + tnx * 22 * s, tdy * 38 * s + tny * 22 * s],
    [tdx * 38 * s - tnx * 22 * s, tdy * 38 * s - tny * 22 * s],
    [tdx * 24 * s + tnx * 34 * s, tdy * 24 * s + tny * 34 * s],
    [tdx * 24 * s - tnx * 34 * s, tdy * 24 * s - tny * 34 * s],
  ];
  tint(ctx, [[tx, ty], ...tailPlumes.map(([px, py]) => [tx + px, ty + py])], color, .75, 1.2, seed + 3);
  for (const [px, py] of tailPlumes) {
    pen(ctx, [[tx, ty], [tx + px * .55 + tnx * 6 * s, ty + py * .55 + tny * 6 * s], [tx + px, ty + py]], 1.2 * s, .8, true);
    spiral(ctx, tx + px, ty + py, 4.5 * s, .65, .9 * s);
  }

  // 四肢五爪（前爪胸部，后爪腰部）
  const limbIndices = [
    { at: Math.round(numPoints * 0.72), reach: 1 },
    { at: Math.round(numPoints * 0.32), reach: -0.6 },
  ];

  for (const { at, reach } of limbIndices) {
    const [lx, ly] = points[at];
    for (const side of [-1, 1]) {
      const kneeX = lx + (d * 18 * reach + side * 12) * s;
      const kneeY = ly + side * 28 * s;
      const wristX = kneeX + (d * 12 * reach - side * 4) * s;
      const wristY = kneeY + side * 18 * s;

      tint(ctx, [[lx - 4 * s, ly], [kneeX - 3 * s, kneeY], [wristX, wristY], [kneeX + 4 * s, kneeY], [lx + 6 * s, ly]], color, .78, .8, seed + at);
      pen(ctx, [[lx, ly], [kneeX, kneeY], [wristX, wristY]], 2.4 * s, .82, true);

      // 肘后火云
      for (let f = 0; f < 3; f++) {
        pen(ctx, [[kneeX, kneeY], [kneeX - d * (14 + f * 5) * s, kneeY - side * (8 + f * 6) * s]], .85 * s, .7, true);
      }

      // 五爪金龙爪掌
      const clawAngle = Math.atan2(wristY - kneeY, wristX - kneeX);
      fiveClaws(ctx, wristX, wristY, clawAngle, s, color, side);
    }
  }

  // 侧首七分面龙首
  const [hx, hy] = points.at(-1);
  const crown = [hx + d * 12 * s, hy - 24 * s];
  const brow = [hx + d * 28 * s, hy - 18 * s];
  const noseTip = [hx + d * 52 * s, hy - 8 * s];
  const upperLip = [hx + d * 54 * s, hy + 2 * s];
  const mouthCorner = [hx + d * 22 * s, hy + 4 * s];
  const lowerJaw = [hx + d * 48 * s, hy + 18 * s];
  const chin = [hx + d * 26 * s, hy + 20 * s];
  const throat = [hx + d * 8 * s, hy + 22 * s];

  const headContour = [
    [hx - d * 12 * s, hy - 14 * s], crown, brow, noseTip, upperLip, mouthCorner, lowerJaw, chin, throat, [hx - d * 14 * s, hy + 12 * s]
  ];
  tint(ctx, headContour, color, .84, 1.2, seed + 1);
  outline(ctx, headContour, 1.7 * s, .88);

  // 朝天鼻孔
  oval(ctx, hx + d * 44 * s, hy - 8 * s, 3.2 * s, 2.2 * s, P.dark, .9, false);

  // 上下利齿白獠牙
  pen(ctx, [[hx + d * 42 * s, hy + 1 * s], [hx + d * 44 * s, hy + 8 * s], [hx + d * 46 * s, hy + 1 * s]], 1.1 * s, .9, true);
  pen(ctx, [[hx + d * 28 * s, hy + 2 * s], [hx + d * 30 * s, hy + 7 * s], [hx + d * 32 * s, hy + 2 * s]], 1 * s, .9, true);
  pen(ctx, [[hx + d * 38 * s, hy + 16 * s], [hx + d * 40 * s, hy + 9 * s], [hx + d * 42 * s, hy + 16 * s]], 1.1 * s, .9, true);

  // 朱砂龙舌
  tint(ctx, [[hx + d * 26 * s, hy + 6 * s], [hx + d * 42 * s, hy + 8 * s], [hx + d * 56 * s, hy + 5 * s], [hx + d * 64 * s, hy + 12 * s]], P.red, .85, .5, seed + 4);
  pen(ctx, [[hx + d * 26 * s, hy + 6 * s], [hx + d * 42 * s, hy + 8 * s], [hx + d * 56 * s, hy + 5 * s], [hx + d * 64 * s, hy + 12 * s]], 1.6 * s, .85, true);

  // 剑眉与圆目
  pen(ctx, [[hx + d * 12 * s, hy - 12 * s], [hx + d * 22 * s, hy - 19 * s], [hx + d * 34 * s, hy - 13 * s]], 2.8 * s, .9, true);
  oval(ctx, hx + d * 22 * s, hy - 10 * s, 4.2 * s, 3.4 * s, '#fff8e2', .95, true);
  oval(ctx, hx + d * (22 + 1.2) * s, hy - 10 * s, 2.1 * s, 2.4 * s, P.dark, .95, false);
  oval(ctx, hx + d * (22 + 0.6) * s, hy - 11 * s, 0.8 * s, 0.8 * s, '#ffffff', .9, false);

  // 分杈鹿角
  for (const [hornRootX, hornRootY, spread] of [[hx + d * 4 * s, hy - 20 * s, 0], [hx + d * 12 * s, hy - 22 * s, 8 * s]]) {
    const tip = [hx - d * (36 + spread) * s, hy - (58 + spread * 0.8) * s];
    const mid = [hx - d * (18 + spread * 0.5) * s, hy - (38 + spread * 0.4) * s];
    pen(ctx, [[hornRootX, hornRootY], mid, tip], 2.2 * s, .86, true);
    pen(ctx, [mid, [mid[0] + d * 8 * s, mid[1] - 18 * s]], 1.5 * s, .82, true);
    pen(ctx, [tip, [tip[0] - d * 14 * s, tip[1] + 8 * s]], 1.3 * s, .8, true);
  }

  // 飘逸长须
  pen(ctx, [[hx + d * 46 * s, hy - 3 * s], [hx + d * 70 * s, hy - 16 * s], [hx + d * 92 * s, hy - 4 * s], [hx + d * 82 * s, hy + 18 * s], [hx + d * 52 * s, hy + 38 * s]], 1.3 * s, .82, true);
  pen(ctx, [[hx + d * 42 * s, hy + 3 * s], [hx + d * 64 * s, hy + 15 * s], [hx + d * 78 * s, hy + 28 * s], [hx + d * 58 * s, hy + 44 * s]], 1.1 * s, .75, true);

  // 下颌龙髯
  for (let i = 0; i < 6; i++) {
    pen(ctx, [[hx + d * (24 + i * 4) * s, hy + 20 * s], [hx + d * (14 + i * 3) * s, hy + (36 + i * 3) * s]], 1.0 * s, .68, true);
  }

  // 脑后飞扬长鬃
  for (let i = 0; i < 9; i++) {
    const maneRoot = [hx - d * (6 + i * 4) * s, hy - (16 - i * 3) * s];
    const maneTip = [hx - d * (36 + i * 6) * s, hy - (34 - i * 2) * s];
    pen(ctx, [maneRoot, [maneRoot[0] - d * 18 * s, maneRoot[1] - 12 * s], maneTip], 1.4 * s, .78, true);
  }

  // 神龙戏珠（前方赤金火焰神珠）
  if (s >= 0.32) {
    const pearlX = hx + d * (78 + (seed % 14)) * s;
    const pearlY = hy + (!isDescending ? -25 : 35) * s;
    flamePearl(ctx, pearlX, pearlY, 9.5 * s, s, seed);
  }
}

// 导出统一接口：根据规制精准分流正龙、升龙、降龙
export function dragon(ctx, cx, cy, size = 1, color = P.gold, direction = 1, seed = 35) {
  const s = size, d = direction;
  // 官方规制判断：
  // 1. 宁寿宫九龙壁正中央主龙 (seed === 1314) -> 严格官方正龙（正面坐龙）
  // 2. 乾清宫宝座正中五爪金龙 (seed === 1120) -> 严格官方正龙（正面坐龙）
  // 3. 其它适中或特大尺寸且种子命中者 (如特定正中屏风位) 均依规制分流
  const isZheng = (seed === 1314 || seed === 1120 || (Math.abs(seed) % 5 === 2 && s >= 0.52));
  if (isZheng) {
    drawZhengLong(ctx, cx, cy, s, color, seed);
  } else {
    // 升龙 (偶数种子) 与 降龙 (奇数种子)
    const isDescending = Math.abs(seed) % 2 === 1;
    drawXingLong(ctx, cx, cy, s, color, d, seed, isDescending);
  }
}


export function bronzeVessel(ctx, cx, cy, w = 600, h = 400, seed = 42) {
  const random = rng(seed), rx = w / 2;
  const body = [[cx - rx, cy - h * .25], [cx - rx * .92, cy + h * .23], [cx - rx * .65, cy + h * .48], [cx, cy + h * .55], [cx + rx * .65, cy + h * .48], [cx + rx * .92, cy + h * .23], [cx + rx, cy - h * .25]];
  tint(ctx, body, '#b38c3d', .82, 5, seed);
  tint(ctx, [[cx - rx * .8, cy - h * .24], [cx - rx * .2, cy - h * .18], [cx + rx * .1, cy + h * .47], [cx - rx * .6, cy + h * .32]], '#e6c772', .5, 12, seed + 1);
  pen(ctx, body, 2.8, .85, true);
  oval(ctx, cx, cy - h * .25, rx, h * .16, '#b99546', .86);
  oval(ctx, cx, cy - h * .26, rx * .88, h * .12, '#526350', .65);
  pen(ctx, ellipse(cx, cy - h * .25, rx * .94, h * .14, 32), 1.6, .8, true);
  for (const side of [-1, 1]) {
    const x = cx + side * rx * .88;
    oval(ctx, x, cy + h * .02, 39, 49, '#897037', .75);
    for (let j = 0; j < 9; j++) spiral(ctx, x + Math.sin(j * .8) * 26, cy - 25 + j * 7, 7, .65);
    pen(ctx, [[x - 14, cy + 7], [x, cy + 17], [x + 14, cy + 7]], 2, .85, true);
    pen(ctx, ellipse(x, cy + h * .16, 34, 53, 34), 4, .88, true);
    pen(ctx, ellipse(x, cy + h * .16, 27, 45, 34), 1, .7, true);
  }
  for (let i = 0; i < 180; i++) {
    const x = cx + (random() - .5) * w * .8, y = cy - h * .05 + random() * h * .43;
    pen(ctx, [[x, y], [x + random() * 13, y - 5 - random() * 11]], .7, .2 + random() * .2);
  }
}

export function jadeSeal(ctx, cx, y, w, seed = 12, tone = P.jade) {
  const h = w * .36, depth = w * .2;
  const front = rect(cx - w / 2, y, w, h);
  tint(ctx, front, tone, .74, 2, seed); outline(ctx, front, 2, .8);
  const top = [[cx - w / 2, y], [cx - w / 2 + depth, y - depth], [cx + w / 2 + depth, y - depth], [cx + w / 2, y]];
  tint(ctx, top, '#a2b5a1', .72, 2, seed + 1); outline(ctx, top, 1.5, .7);
  const side = [[cx + w / 2, y], [cx + w / 2 + depth, y - depth], [cx + w / 2 + depth, y + h - depth], [cx + w / 2, y + h]];
  tint(ctx, side, '#486f67', .64, 2, seed + 2); outline(ctx, side, 1.5, .7);
  dragon(ctx, cx + depth * .3, y - depth - w * .08, w / 460, '#82957b', 1, seed);
  for (let i = 0; i < 12; i++) pen(ctx, [[cx - w * .4 + i * w / 14, y + h * .12], [cx - w * .36 + i * w / 14, y + h * .78]], .7, .23, true);
}

export function book(ctx, x, y, w, h, tone = '#718d8a', pages = 8) {
  tint(ctx, [[x, y], [x + w, y - 8], [x + w + 16, y + h], [x + 12, y + h + 10]], '#e4d6b8', .8, 1);
  for (let i = 0; i < pages; i++) pen(ctx, [[x + 12, y + h * .4 + i * h * .6 / pages], [x + w + 12, y + h * .4 + i * h * .6 / pages - 8]], .65, .5);
  tint(ctx, [[x - 5, y - 7], [x + w, y - 15], [x + w + 15, y + h * .23], [x + 8, y + h * .23 + 10]], tone, .7, 1.5);
  outline(ctx, [[x - 5, y - 7], [x + w, y - 15], [x + w + 15, y + h * .23], [x + 8, y + h * .23 + 10]], 1.3, .7);
  for (let i = 0; i < 5; i++) pen(ctx, [[x + 16 + i * 5, y - 6], [x + 23 + i * 5, y + h * .23 + 6]], .9, .7);
}
export function desk(ctx, x, y, w, h) {
  const top = [[x, y], [x + w, y], [x + w + 45, y + h * .2], [x - 35, y + h * .2]];
  tint(ctx, top, P.wood, .77, 2); outline(ctx, top, 2.2, .8);
  tint(ctx, rect(x - 22, y + h * .2, w + 54, h * .14), P.woodDark, .8, 1);
  for (const px of [x + 10, x + w - 30]) {
    const leg = [[px, y + h * .28], [px + 28, y + h * .28], [px + 18, y + h], [px - 16, y + h]];
    tint(ctx, leg, P.woodDark, .76, 1); outline(ctx, leg, 1.5, .8);
  }
  for (let i = 0; i < 30; i++) pen(ctx, [[x + 20, y + 7 + i * h * .005], [x + w - 20, y + 4 + i * h * .005]], .55, .32);
  for (let i = 0; i < 11; i++) spiral(ctx, x + (i + .5) / 11 * w, y + h * .27, h * .035, .65, 1.2);
}
export function scroll(ctx, x, y, w, h) {
  tint(ctx, [[x, y], [x + w, y - 4], [x + w, y + h], [x, y + h + 6]], '#f3e9d0', .86, 2);
  for (const px of [x, x + w]) {
    tint(ctx, rect(px - 5, y - 10, 10, h + 24), P.woodDark, .65, 1);
    oval(ctx, px, y - 11, 8, 5, P.goldDark, .7);
  }
  outline(ctx, [[x, y], [x + w, y - 4], [x + w, y + h], [x, y + h + 6]], 1.2, .55);
}
export function incense(ctx, x, y, scale = 1) {
  const s = scale;
  oval(ctx, x, y, 40 * s, 28 * s, '#8c967c', .65);
  pen(ctx, [[x - 26 * s, y + 19 * s], [x - 21 * s, y + 46 * s]], 3 * s, .75);
  pen(ctx, [[x + 26 * s, y + 19 * s], [x + 21 * s, y + 46 * s]], 3 * s, .75);
  oval(ctx, x, y - 12 * s, 42 * s, 9 * s, '#788573', .65);
  for (const side of [-1, 1]) pen(ctx, [[x + side * 31 * s, y - 6 * s], [x + side * 54 * s, y - 25 * s], [x + side * 50 * s, y - 41 * s]], 2 * s, .72, true);
  for (let i = 0; i < 3; i++) pen(ctx, [[x + (i - 1) * 5 * s, y - 21 * s], [x + (i - 1) * 10 * s, y - 70 * s], [x + (i - 1) * 20 * s, y - 113 * s]], .7, .19, true);
}
export function sealPrint(ctx, label, x, y, size = 125) { sealStamp(ctx, label, x, y, size, { baiwen: true, seed: 123, p: 1 }); }
