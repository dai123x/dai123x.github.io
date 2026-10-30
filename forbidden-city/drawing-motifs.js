import { ellipse, rng, lerp, sealStamp } from './art.js?v=20261030-drawing3';
import { P, pen, tint, rect, outline, oval, lattice, brickwork } from './drawing-kit.js?v=20261030-drawing3';

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

export function dragon(ctx, cx, cy, size = 1, color = P.gold, direction = 1, seed = 35) {
  const curves = [
    [[-155, 70], [-170, -50], [-40, -75], [15, 0]],
    [[15, 0], [95, 120], [-130, 95], [-65, -15]],
    [[-65, -15], [-10, -110], [90, -65], [125, -30]],
  ];
  const s = size, points = Array.from({ length: 73 }, (_, i) => {
    const segment = Math.min(2, Math.floor(i / 24)), t = (i - segment * 24) / 24, q = 1 - t;
    const [a, b, c, d] = curves[segment];
    const x = q ** 3 * a[0] + 3 * q * q * t * b[0] + 3 * q * t * t * c[0] + t ** 3 * d[0];
    const y = q ** 3 * a[1] + 3 * q * q * t * b[1] + 3 * q * t * t * c[1] + t ** 3 * d[1];
    return [cx + direction * x * s, cy + y * s];
  });
  const left = [], right = [];
  points.forEach(([x, y], i) => {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const r = (7 + 11 * Math.sin(i / (points.length - 1) * Math.PI)) * s;
    const nx = -(b[1] - a[1]) / len * r, ny = (b[0] - a[0]) / len * r;
    left.push([x + nx, y + ny]); right.push([x - nx, y - ny]);
  });
  tint(ctx, [...left, ...right.toReversed()], color, .78, 1.2, seed);
  pen(ctx, left, 1.45 * s, .8, true); pen(ctx, right, 1.45 * s, .8, true);
  for (let i = 4; i < points.length - 5; i += 2) {
    const [x, y] = points[i];
    pen(ctx, [[x - 5 * s, y - 3 * s], [x, y + 4 * s], [x + 5 * s, y - 3 * s]], .85 * s, .8, true);
    if (i % 4 === 0) pen(ctx, [[x - 5 * s, y - 15 * s], [x, y - 8 * s], [x + 5 * s, y - 15 * s]], .7 * s, .7, true);
  }
  for (const at of [25, 54]) {
    const [x, y] = points[at];
    for (const side of [-1, 1]) {
      pen(ctx, [[x, y], [x + 17 * s * direction, y + side * 28 * s], [x - 2 * s * direction, y + side * 46 * s]], 2.3 * s, .8, true);
      for (let claw = 0; claw < 4; claw++) pen(ctx, [[x - 2 * s * direction, y + side * 46 * s], [x + (claw - 2) * 9 * s * direction, y + side * (52 + Math.abs(claw - 2) * 4) * s]], .9 * s, .8);
    }
  }
  const [hx, hy] = points.at(-1), d = direction;
  const head = [[hx - d * 15 * s, hy - 18 * s], [hx + d * 10 * s, hy - 27 * s], [hx + d * 30 * s, hy - 15 * s], [hx + d * 55 * s, hy - 10 * s], [hx + d * 53 * s, hy + 7 * s], [hx + d * 26 * s, hy + 10 * s], [hx + d * 6 * s, hy + 24 * s], [hx - d * 18 * s, hy + 13 * s]];
  tint(ctx, head, color, .8, 1.5, seed + 1); outline(ctx, head, 1.6 * s, .85);
  oval(ctx, hx + d * 19 * s, hy - 10 * s, 3 * s, 3.4 * s, P.dark, .95, false);
  for (const offset of [-11, 6]) {
    pen(ctx, [[hx + d * offset * s, hy - 17 * s], [hx + d * (offset - 5) * s, hy - 42 * s], [hx + d * (offset + 7) * s, hy - 58 * s]], 1.8 * s, .85, true);
    pen(ctx, [[hx + d * (offset - 4) * s, hy - 39 * s], [hx + d * (offset - 18) * s, hy - 48 * s]], 1.2 * s, .8);
  }
  pen(ctx, [[hx + d * 42 * s, hy + 7 * s], [hx + d * 70 * s, hy + 22 * s], [hx + d * 74 * s, hy + 5 * s]], 1.1 * s, .8, true);
  pen(ctx, [[hx - d * 10 * s, hy - 4 * s], [hx - d * 35 * s, hy - 35 * s], [hx - d * 48 * s, hy - 23 * s]], 1.1 * s, .7, true);
  for (let i = 0; i < 7; i++) pen(ctx, [[hx - d * (13 + i * 3) * s, hy + (12 - i * 5) * s], [hx - d * (32 + i * 5) * s, hy + (22 - i * 6) * s]], 1 * s, .6, true);
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
