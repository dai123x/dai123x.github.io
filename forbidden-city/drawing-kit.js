import { ink, wash, hex, v, ellipse, rng, dab, lerp, clamp, handwrite, paper, sealStamp } from './art.js?v=20261030-drawing3';

export const P = {
  red: '#a54432', redDark: '#703728', redLight: '#c27155', gold: '#d5a64b', goldLight: '#ecd28a',
  goldDark: '#a6762e', stone: '#e8dfc8', stoneDark: '#aea58e', green: '#62765b', greenLight: '#a0aa79',
  water: '#92b2a5', waterDark: '#587e76', ink: '#45453b', wood: '#a17b53', woodDark: '#66513a',
  blue: '#527d80', jade: '#729187', paper: '#f5eede', dark: '#343e38', sky: '#b8c7c4',
};
export const col = value => typeof value === 'string' ? hex(value) : value;
export function pen(ctx, points, w = 1.6, alpha = .7, smooth = false, seed) {
  if (points.length < 2) return;
  const s = seed ?? Math.round(points[0][0] * 7 + points[0][1] * 13 + w * 41);
  ink(ctx, points.map(([x, y]) => v(x, y, 0)), { w, wob: Math.min(.8, w * .28), over: w * .65, gap: .13, smooth, seed: s }, alpha);
}
export function tint(ctx, points, color, alpha = .5, jitter = 3, seed = 7) {
  wash(ctx, points, col(color), { a: alpha, j: jitter, layers: 2, edge: .18, seed });
}
export const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
export function outline(ctx, points, w = 1.6, alpha = .65) { pen(ctx, [...points, points[0]], w, alpha); }
export function oval(ctx, x, y, rx, ry, color, alpha = .5, line = true) {
  const points = ellipse(x, y, rx, ry, 28);
  tint(ctx, points, color, alpha, Math.max(1, Math.min(rx, ry) * .025), Math.round(x + y));
  if (line) pen(ctx, [...points, points[0]], 1.6, .62, true);
}
export function text(ctx, value, x, y, size = 22, alpha = .72, gold = false) {
  handwrite(ctx, { text: value, x, y, size, alpha, gold }, 1);
}
export function plaque(ctx, value, cx, y, w, h = 63) {
  tint(ctx, rect(cx - w / 2, y, w, h), '#334a48', .94, 1.5);
  outline(ctx, rect(cx - w / 2, y, w, h), 2.7, .85);
  outline(ctx, rect(cx - w / 2 + 7, y + 7, w - 14, h - 14), 1, .65);
  const font = Math.min(h * .62, w / (value.length + 1));
  text(ctx, value, cx - value.length * font * .52, y + h * .73, font, 1, true);
}
export function ground(ctx, top = 1020, bottom = 1255, left = 330, right = 2260) {
  tint(ctx, [[left + 170, top], [right - 170, top], [right, bottom], [left, bottom]], '#d1c5aa', .24, 10);
  for (let i = 0; i < 20; i++) {
    const x = lerp(left, right, i / 19);
    pen(ctx, [[lerp(1250, x, .2), top], [x, bottom]], .95, .25);
  }
  for (let i = 1; i < 10; i++) {
    const t = Math.pow(i / 10, 1.5), y = lerp(top, bottom, t);
    pen(ctx, [[lerp(1250, left, .25 + t * .75), y], [lerp(1250, right, .25 + t * .75), y]], .8, .25);
  }
}
export function water(ctx, x, y, w, h, seed = 12, tone = P.water) {
  tint(ctx, [[x, y], [x + w, y + 9], [x + w, y + h], [x, y + h]], tone, .43, 15, seed);
  const random = rng(seed);
  for (let i = 0; i < 120; i++) {
    const px = x + random() * w, py = y + random() * h, len = 12 + random() * 90;
    pen(ctx, [[px, py], [px + len * .4, py - 2], [px + len, py + 1]], .75 + random() * .65, .18 + random() * .24, true);
  }
}
export function brickwork(ctx, x, y, w, h, size = 53, alpha = .3) {
  const rows = Math.ceil(h / (size * .42));
  for (let j = 0; j < rows; j++) {
    const py = y + j * size * .42;
    pen(ctx, [[x, py], [x + w, py]], .8, alpha);
    for (let i = 0; i <= Math.ceil(w / size); i++) {
      const px = x + i * size + (j % 2 ? size / 2 : 0);
      if (px < x + w) pen(ctx, [[px, py], [px, Math.min(y + h, py + size * .42)]], .7, alpha * .85);
    }
  }
}
export function lattice(ctx, x, y, w, h, ornate = false) {
  tint(ctx, rect(x, y, w, h), '#465a51', .49, 1.3);
  outline(ctx, rect(x, y, w, h), 2.3, .85);
  outline(ctx, rect(x + 5, y + 5, w - 10, h - 10), .9, .6);
  const step = ornate ? 19 : 26;
  for (let px = x + step; px < x + w - 3; px += step) pen(ctx, [[px, y + 7], [px, y + h - 7]], .8, .65);
  for (let py = y + step; py < y + h - 3; py += step) pen(ctx, [[x + 7, py], [x + w - 7, py]], .8, .65);
  if (ornate) for (let px = x + step; px < x + w - step; px += step * 2) {
    for (let py = y + step; py < y + h - step; py += step * 2) outline(ctx, [[px, py - 7], [px + 7, py], [px, py + 7], [px - 7, py]], .7, .65);
  }
}
export function door(ctx, x, y, w, h, studs = true) {
  tint(ctx, rect(x, y, w, h), P.redDark, .82, 1.5);
  outline(ctx, rect(x, y, w, h), 2, .75);
  pen(ctx, [[x + w / 2, y + 3], [x + w / 2, y + h - 3]], 2, .8);
  for (const offset of [.38, .62]) oval(ctx, x + w * offset, y + h * .53, 4.5, 7, P.gold, .9);
  if (studs) for (let i = 0; i < 6; i++) for (let j = 0; j < 7; j++) {
    const px = x + 9 + i / 5 * (w - 18), py = y + 13 + j / 6 * (h - 26);
    oval(ctx, px, py, 1.9, 2.1, P.goldLight, .85, false);
  }
}
function bracket(ctx, x, y, s = 1) {
  const shapes = [[-12, 9, 24, 5], [-18, 1, 36, 5], [-24, -7, 48, 5]];
  for (const [dx, dy, w, h] of shapes) {
    tint(ctx, rect(x + dx * s, y + dy * s, w * s, h * s), P.blue, .55, .5);
    pen(ctx, [[x + dx * s, y + dy * s], [x + (dx + w) * s, y + dy * s]], 1.2, .65);
  }
  pen(ctx, [[x - 15 * s, y - 10 * s], [x - 8 * s, y + 17 * s], [x + 8 * s, y + 17 * s], [x + 15 * s, y - 10 * s]], 1.5, .7);
}
export function fascia(ctx, x, y, w, h, bays = 9) {
  tint(ctx, rect(x, y, w, h), P.blue, .64, 1.5);
  for (const dy of [2, h * .27, h * .75, h - 2]) pen(ctx, [[x, y + dy], [x + w, y + dy]], 1.4, .8);
  for (let i = 0; i < bays; i++) {
    const cx = x + w * (i + .5) / bays, cy = y + h * .5;
    const radius = Math.min(15, w / bays * .25);
    outline(ctx, [[cx - radius, cy], [cx, cy - h * .19], [cx + radius, cy], [cx, cy + h * .19]], .9, .9);
    bracket(ctx, x + w * i / bays, y + h + 2, Math.min(1, w / bays / 72));
  }
}
export function facade(ctx, x, y, w, h, bays = 9, options = {}) {
  tint(ctx, rect(x, y, w, h), options.color ?? P.red, .7, 3);
  tint(ctx, rect(x + 8, y + 16, w - 16, h * .14), P.redDark, .38, 1);
  const bw = w / bays;
  for (let i = 0; i < bays; i++) {
    const bx = x + i * bw;
    if (Math.abs(i - (bays - 1) / 2) < (options.doors ?? 1.4)) door(ctx, bx + bw * .18, y + h * .27, bw * .64, h * .69, options.studs ?? false);
    else {
      lattice(ctx, bx + bw * .14, y + h * .28, bw * .72, h * .43, options.ornate ?? false);
      outline(ctx, rect(bx + bw * .14, y + h * .75, bw * .72, h * .17), 1, .5);
    }
    const px = bx + 2;
    tint(ctx, rect(px - 4, y + 8, 9, h - 8), P.redDark, .7, .7);
    pen(ctx, [[px - 3, y + 8], [px - 3, y + h]], 1.2, .7);
    oval(ctx, px, y + h, 8, 3.5, P.stoneDark, .55, false);
    if (i === bays - 1) pen(ctx, [[x + w - 2, y + 6], [x + w - 2, y + h]], 3.3, .7);
  }
  fascia(ctx, x - 7, y - 2, w + 14, Math.min(34, h * .22), bays);
  pen(ctx, [[x - 8, y + h], [x + w + 8, y + h]], 2.5, .8);
}
export function roof(ctx, x, y, w, h, options = {}) {
  const tone = options.color ?? P.gold;
  const inset = options.type === 'pyramid' ? w * .5 : w * (options.type === 'gable' ? .1 : .23);
  const ridgeL = x + inset, ridgeR = x + w - inset;
  const eaveY = t => y + h * (.8 + .2 * Math.sin(Math.PI * t));
  const edge = [[x - 20, y + h * .77], [x + w * .07, y + h * .95], [x + w * .5, y + h], [x + w * .93, y + h * .95], [x + w + 20, y + h * .77]];
  const polygon = [[ridgeL, y], [ridgeR, y], ...edge.toReversed()];
  tint(ctx, polygon, tone, .68, 4, Math.round(x + y));
  tint(ctx, [[ridgeL, y], [x + w * .48, y + h * .97], [x + 20, y + h * .8]], options.dark ?? P.goldDark, .19, 4);
  pen(ctx, [[ridgeL - 8, y - 5], [ridgeL + 20, y + 2], [ridgeR - 20, y + 2], [ridgeR + 8, y - 5]], 3, .84, true);
  pen(ctx, edge, 2.8, .9, true);
  pen(ctx, edge.map(([px, py]) => [px, py + 9]), 1.4, .7, true);
  const count = clamp(Math.round(w / 18), 18, 98);
  for (let i = 0; i <= count; i++) {
    const t = i / count, topX = lerp(ridgeL, ridgeR, t), bottomX = x + w * t;
    const ey = eaveY(t);
    pen(ctx, [[topX, y + 5], [lerp(topX, bottomX, .4), y + h * .32], [lerp(topX, bottomX, .75), y + h * .66], [bottomX, ey]], 1.05, .55, true);
    if (i % 2 === 0) for (let row = 1; row < 6; row++) {
      const q = row / 6, px = lerp(topX, bottomX, q), py = lerp(y, ey, q * q * .4 + q * .6);
      pen(ctx, [[px - 4, py], [px, py + 1.5], [px + 4, py]], .6, .27, true);
    }
    if (i < count) oval(ctx, bottomX + w / count / 2, ey + 3, Math.min(4.4, w / count * .23), 2.2, tone, .48, false);
  }
  for (const side of [-1, 1]) {
    const tip = side < 0 ? ridgeL : ridgeR;
    pen(ctx, [[tip, y + 3], [tip + side * 13, y - 21], [tip + side * 27, y - 27], [tip + side * 25, y - 7]], 2.3, .85, true);
    const beasts = options.beasts ?? 4;
    for (let j = 0; j < beasts; j++) {
      const t = (j + 1) / (beasts + 3), px = side < 0 ? lerp(x - 4, ridgeL, t * .65) : lerp(x + w + 4, ridgeR, t * .65);
      const py = y + h * (.82 - t * .53);
      pen(ctx, [[px - 5, py], [px - 5, py - 9], [px + 1, py - 15], [px + 6, py - 8], [px + 8, py]], 1.35, .8);
    }
  }
}
export function hall(ctx, { x, y, w, h, bays = 9, double = false, type = 'hip', color = P.gold, title, ornate = false }) {
  const bodyTop = y + h * (double ? .54 : .48), bodyBottom = y + h;
  facade(ctx, x + w * .08, bodyTop, w * .84, bodyBottom - bodyTop, bays, { ornate });
  if (double) {
    facade(ctx, x + w * .13, y + h * .28, w * .74, h * .23, bays, { doors: 0, color: P.redDark });
    roof(ctx, x, y + h * .33, w, h * .23, { type, color, beasts: 4 });
    roof(ctx, x + w * .07, y, w * .86, h * .3, { type, color, beasts: 7 });
  } else roof(ctx, x, y, w, h * .5, { type, color });
  if (title) plaque(ctx, title, x + w / 2, bodyTop + 3, Math.min(220, w * .2), Math.max(35, Math.min(58, h * .11)));
}
export function railing(ctx, x0, x1, y, h = 55, posts = 20) {
  for (const dy of [0, h * .35, h]) pen(ctx, [[x0, y + dy], [x1, y + dy]], 1.15, .65);
  for (let i = 0; i <= posts; i++) {
    const x = lerp(x0, x1, i / posts);
    tint(ctx, rect(x - 4, y - 7, 8, h + 9), P.stone, .78, .5);
    outline(ctx, rect(x - 4, y - 7, 8, h + 9), 1, .65);
    oval(ctx, x, y - 8, 7, 5, P.stone, .8);
    if (i < posts) {
      const cx = x + (x1 - x0) / posts / 2;
      outline(ctx, [[cx - 12, y + h * .55], [cx, y + h * .42], [cx + 12, y + h * .55], [cx, y + h * .8]], .8, .52);
    }
  }
}
export function terrace(ctx, cx, y, width, height = 170, tiers = 3) {
  for (let i = tiers - 1; i >= 0; i--) {
    const yy = y + (tiers - 1 - i) * height / tiers, ww = width + (tiers - 1 - i) * 88;
    const points = [[cx - ww / 2, yy], [cx + ww / 2, yy], [cx + ww / 2 + 24, yy + height / tiers], [cx - ww / 2 - 24, yy + height / tiers]];
    tint(ctx, points, P.stone, .66, 3, i + 700);
    outline(ctx, points, 1.8, .55);
    railing(ctx, cx - ww / 2 + 10, cx - 145, yy - 43, 42, Math.max(3, Math.round(ww / 110)));
    railing(ctx, cx + 145, cx + ww / 2 - 10, yy - 43, 42, Math.max(3, Math.round(ww / 110)));
  }
  const topW = 135, bottomW = 200;
  tint(ctx, [[cx - topW, y], [cx + topW, y], [cx + bottomW, y + height + 8], [cx - bottomW, y + height + 8]], '#d3c8b1', .55, 2);
  for (let i = 0; i < 16; i++) {
    const u = i / 15, w = lerp(topW, bottomW, u), yy = y + u * height;
    pen(ctx, [[cx - w, yy], [cx - 38, yy]], .9, .52);
    pen(ctx, [[cx + 38, yy], [cx + w, yy]], .9, .52);
  }
  pen(ctx, [[cx - 38, y], [cx - 55, y + height]], 1.2, .6);
  pen(ctx, [[cx + 38, y], [cx + 55, y + height]], 1.2, .6);
}
export function tree(ctx, x, bottom, height, seed = 19, crownWidth = height * .4) {
  const random = rng(seed), trunkTop = bottom - height * .66;
  const trunk = [[x - 15, bottom], [x - 9, trunkTop + 70], [x + 1, trunkTop - 30], [x + 17, trunkTop + 15], [x + 12, bottom]];
  tint(ctx, trunk, P.woodDark, .66, 2, seed);
  outline(ctx, trunk, 2.1, .72);
  for (let i = 0; i < 15; i++) {
    const bx = x - 11 + random() * 22;
    pen(ctx, [[bx, bottom - random() * 100], [bx + random() * 12 - 6, trunkTop + 30 + random() * 120]], .85, .5, true);
  }
  for (let k = 0; k < 8; k++) {
    const cx = x + (random() - .5) * crownWidth * 1.25, cy = bottom - height * (.58 + random() * .35);
    const rx = crownWidth * (.28 + random() * .2), ry = height * (.08 + random() * .07);
    tint(ctx, ellipse(cx, cy, rx, ry, 18), k % 2 ? P.greenLight : P.green, .4, 8, seed + k);
    pen(ctx, [[x, trunkTop + 80], [cx, cy + ry * .6]], 1.8, .55, true);
    for (let i = 0; i < 110; i++) {
      const angle = random() * Math.PI * 2, radius = Math.sqrt(random());
      const px = cx + Math.cos(angle) * radius * rx, py = cy + Math.sin(angle) * radius * ry;
      const tone = ['#b2bb80', '#819b65', '#486f50', '#90aa78'][i % 4];
      dab(ctx, px, py, 2 + random() * 6, angle, hex(tone), .4 + random() * .2, seed * 100 + i + k * 1000);
    }
  }
}
export function rock(ctx, x, y, w, h, seed = 12) {
  const random = rng(seed);
  const points = Array.from({ length: 9 }, (_, i) => {
    const angle = i / 9 * Math.PI * 2;
    return [x + Math.cos(angle) * w * (.7 + random() * .3), y + Math.sin(angle) * h * (.7 + random() * .3)];
  });
  tint(ctx, points, '#aaa995', .5, 5, seed);
  outline(ctx, points, 1.9, .65);
  tint(ctx, [points[2], points[3], [x + 8, y + 9], points[5], points[6]], '#6e7c70', .23, 4, seed + 1);
  for (let i = 0; i < 12; i++) {
    const px = x + (random() - .5) * w, py = y + (random() - .5) * h;
    pen(ctx, [[px, py], [px + random() * 25, py - 7], [px + random() * 40, py + 10]], .85, .33, true);
  }
}
export function cloud(ctx, x, y, w, h, seed = 3) {
  for (let i = 0; i < 4; i++) tint(ctx, ellipse(x + i * w * .22, y + Math.sin(i) * h * .3, w * .27, h * .5, 18), '#e8e4d7', .4, 12, seed + i);
  pen(ctx, [[x - w * .2, y + h * .4], [x + w * .2, y + h * .56], [x + w * .65, y + h * .4]], .8, .2, true);
}
export function annotation(ctx, value, anchor, target) {
  pen(ctx, [anchor, [(anchor[0] + target[0]) / 2, target[1] + 17], [target[0] - 8, target[1] + 10]], 1.2, .55);
  text(ctx, value, target[0], target[1], 22, .7);
}
export function openPage(ctx, page, copy) {
  paper(ctx, 2400, 1350);
  const frame = [[48, 60], [2352, 60], [2352, 1290], [48, 1290]];
  outline(ctx, frame, .9, .27);
  handwrite(ctx, { text: copy.title, x: 185, y: 155, size: 43, vertical: true }, 1);
  handwrite(ctx, { text: copy.poem, x: 110, y: 170, size: 20, vertical: true, alpha: .75 }, 1);
  sealStamp(ctx, copy.seal, 185, 1015, 58, { baiwen: copy.baiwen, seed: 100 + page });
  text(ctx, `故宫十六景 · 第${String(page).padStart(2, '0')}卷`, 1760, 1252, 21, .52);
}
