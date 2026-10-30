import { forbiddenCitySite, rng, ellipse, dab, hex, paper } from './art.js?v=20261030-official-dragon';
import { SPOTS } from './spots.js?v=20261030-official-dragon';
import { P, pen, tint, rect, outline, text } from './drawing-kit.js?v=20261030-official-dragon';

const mx = x => 1400 + x * 3.6;
const my = z => 1120 - z * 3.6;
function area(ctx, x0, z0, x1, z1, color, alpha = .5) {
  const points = [[mx(x0), my(z1)], [mx(x1), my(z1)], [mx(x1), my(z0)], [mx(x0), my(z0)]];
  tint(ctx, points, color, alpha, 2, Math.round(x0 + z0));
  return points;
}
function roofPlan(ctx, object) {
  const { cx, cz, o } = object, x = mx(cx - o.w / 2), y = my(cz + o.d / 2), w = o.w * 3.6, h = o.d * 3.6;
  tint(ctx, rect(x + 4, y + 5, w, h), '#a39276', .27, 1.5);
  const color = o.roofCol?.[0] < 70 ? '#4f665d' : '#d3ab5e';
  tint(ctx, rect(x, y, w, h), color, .72, 1);
  outline(ctx, rect(x - 2, y - 2, w + 4, h + 4), 1.6, .8);
  if (o.roofType === 'pyramid' || o.roofType === 'round') {
    for (const [px, py] of [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]) pen(ctx, [[px, py], [x + w / 2, y + h / 2]], 1.3, .7);
    ovalDot(ctx, x + w / 2, y + h / 2, 3, '#8f783e');
  } else {
    const inset = w * .2;
    pen(ctx, [[x + inset, y + h / 2], [x + w - inset, y + h / 2]], 2.2, .8);
    for (const [px, py, rx] of [[x, y, x + inset], [x, y + h, x + inset], [x + w, y, x + w - inset], [x + w, y + h, x + w - inset]]) pen(ctx, [[px, py], [rx, y + h / 2]], 1.2, .72);
    for (let i = 1; i < w / 6; i++) {
      const px = x + i * 6;
      pen(ctx, [[px, y + 3], [Math.max(x + inset, Math.min(x + w - inset, px)), y + h / 2 - 2]], .65, .42);
      pen(ctx, [[px, y + h - 3], [Math.max(x + inset, Math.min(x + w - inset, px)), y + h / 2 + 2]], .65, .42);
    }
  }
  if (o.double) outline(ctx, rect(x - 7, y - 6, w + 14, h + 12), .9, .6);
}
function ovalDot(ctx, x, y, radius, color) { tint(ctx, ellipse(x, y, radius, radius, 16), color, .85, .2); }
function garden(ctx, seed = 1) {
  const random = rng(seed);
  for (let i = 0; i < 42; i++) {
    const x = mx(-42 + random() * 84), y = my(155 + random() * 36);
    const radius = 7 + random() * 11;
    tint(ctx, ellipse(x, y, radius, radius * .8, 12), '#81936a', .38, 2, seed + i);
    for (let k = 0; k < 8; k++) dab(ctx, x + (random() - .5) * radius * 1.5, y + (random() - .5) * radius, 2 + random() * 3, random() * 6, hex(k % 2 ? '#61765a' : '#a2ae82'), .4, seed + i * 9 + k);
  }
}
function callout(ctx, spot, index, left, y) {
  const x = left ? 122 : 2160, width = 520, anchor = [mx(spot.x), my(spot.z)];
  const cardEdge = left ? x + width : x;
  const elbowX = left ? 735 : 2075;
  pen(ctx, [anchor, [elbowX, anchor[1]], [elbowX, y + 30], [cardEdge, y + 30]], 1.05, .3);
  tint(ctx, rect(x, y - 6, width, 100), '#eee5d1', .38, 2);
  pen(ctx, [[x, y + 93], [x + width, y + 93]], .9, .38);
  text(ctx, String(index + 1).padStart(2, '0'), x + 18, y + 34, 27, .82);
  text(ctx, spot.name, x + 85, y + 33, 31, .93);
  text(ctx, spot.title.split(' · ')[1], x + 86, y + 70, 21, .62);
}

export function routeMap() {
  const canvas = document.createElement('canvas');
  canvas.width = 2800; canvas.height = 2200;
  const ctx = canvas.getContext('2d');
  paper(ctx, canvas.width, canvas.height);
  outline(ctx, rect(62, 55, 2676, 2090), 1.4, .35);
  text(ctx, '紫禁城全域舆图', 1030, 112, 52, .95);
  text(ctx, '以院落辨宫城 · 以十六景读细节', 1130, 162, 23, .6);
  area(ctx, -196, -228, 196, 226, '#d9cfb6', .2);
  for (const [x0, z0, x1, z1] of [[-182, -224, -158, 224], [158, -224, 182, 224], [-182, -224, 182, -200], [-182, 200, 182, 224]]) {
    const poly = area(ctx, x0, z0, x1, z1, '#90b3a9', .65);
    ctx.save(); ctx.beginPath(); ctx.moveTo(...poly[0]); poly.slice(1).forEach(p => ctx.lineTo(...p)); ctx.closePath(); ctx.clip();
    const random = rng(Math.abs(x0 + z0) + 1);
    for (let i = 0; i < 70; i++) {
      const x = mx(x0) + random() * (mx(x1) - mx(x0)), y = my(z1) + random() * (my(z0) - my(z1));
      pen(ctx, [[x, y], [x + 10 + random() * 30, y]], .65, .27);
    }
    ctx.restore();
  }
  area(ctx, -157, -200, 157, 200, '#e4d9c1', .28);
  area(ctx, -72, -132, 72, -118, '#86a99e', .6);
  area(ctx, -42, 152, 42, 192, '#b4bd8e', .4);
  const random = rng(20261030);
  for (let i = 0; i < 90; i++) {
    const z = -191 + i * 4.25;
    pen(ctx, [[mx(-150), my(z)], [mx(150), my(z)]], .55, .13);
  }
  for (let x = -145; x <= 145; x += 7) pen(ctx, [[mx(x), my(-194)], [mx(x), my(194)]], .55, .1);
  for (const [x, z, w, d] of [[-92, -126, 56, 55], [92, -126, 56, 55], [-54, 86, 34, 31], [-111, 62, 51, 68], [118, 118, 50, 138]]) {
    outline(ctx, area(ctx, x - w / 2, z - d / 2, x + w / 2, z + d / 2, '#d9cbb0', .22), 1.5, .62);
  }
  area(ctx, -36, -65, 36, 45, P.stone, .45);
  for (const dy of [0, 5, 10]) outline(ctx, [[mx(-36) - dy, my(45) - dy], [mx(36) + dy, my(45) - dy], [mx(36) + dy, my(-65) + dy], [mx(-36) - dy, my(-65) + dy]], .85, .55);
  for (const x of [-24, -12, 0, 12, 24]) {
    const xx = mx(x), yy = my(-125);
    tint(ctx, rect(xx - 9, yy - 33, 18, 66), '#eee8d9', .85, .5);
    outline(ctx, rect(xx - 9, yy - 33, 18, 66), 1.1, .7);
    for (let i = 0; i < 7; i++) pen(ctx, [[xx - 11, yy - 30 + i * 10], [xx + 11, yy - 30 + i * 10]], .75, .5);
  }
  garden(ctx, 2001);
  tint(ctx, ellipse(mx(0), my(238), 270, 72, 24), '#a9b690', .4, 6, 2010);
  const site = forbiddenCitySite();
  for (const object of site) {
    if (object.kind === 'wall' && object.fp) {
      const { w, d } = object.fp;
      if (w < 4 || d < 4 || object.cz === -162 || Math.abs(object.cx) === 34) {
        const poly = area(ctx, object.cx - w / 2, object.cz - d / 2, object.cx + w / 2, object.cz + d / 2, '#b7755c', .66);
        outline(ctx, poly, .9, .68);
      }
    }
  }
  for (const object of site) if (object.kind === 'palace') roofPlan(ctx, object);
  for (const [name, x, z] of [['神武门', 0, 210], ['西六宫', -83, 158], ['东六宫', 66, 158], ['慈宁宫', -111, 43], ['坤宁宫', 0, 147], ['景山', 0, 260], ['西华门', -159, -93], ['东华门', 159, -93]]) {
    const px = mx(x), py = my(z);
    tint(ctx, rect(px - name.length * 10 - 5, py - 21, name.length * 20 + 10, 26), '#f5eede', .7, .3);
    text(ctx, name, px - name.length * 10, py, 20, .85);
  }
  for (const side of [-1, 1]) {
    for (let i = 0; i < 17; i++) {
      const x = mx(side * (138 + random() * 8)), y = my(-160 + i * 19);
      ovalDot(ctx, x, y, 4 + random() * 4, '#98a27b');
    }
  }
  const axis = [[0, -187], [0, -162], [0, -125], [0, -82], [0, -42], [0, -8], [0, 26], [0, 86], [0, 110], [0, 172], [0, 200]];
  ctx.save(); ctx.strokeStyle = '#984e3b'; ctx.lineWidth = 2.2; ctx.setLineDash([8, 9]); ctx.beginPath();
  axis.forEach(([x, z], i) => i ? ctx.lineTo(mx(x), my(z)) : ctx.moveTo(mx(x), my(z))); ctx.stroke(); ctx.restore();
  const leftIds = ['jiaolou', 'yuhuayuan', 'yangxin', 'tonggang', 'wuying', 'jinshui', 'wumen'];
  const rightIds = ['ningshou', 'jiaotaidian', 'qianqinggong', 'baohedian', 'zhonghedian', 'taihedian', 'cat', 'wenhua', 'taihemen'];
  leftIds.forEach((id, i) => { const index = SPOTS.findIndex(spot => spot.id === id); callout(ctx, SPOTS[index], index, true, 360 + i * 222); });
  rightIds.forEach((id, i) => { const index = SPOTS.findIndex(spot => spot.id === id); callout(ctx, SPOTS[index], index, false, 315 + i * 176); });
  for (const [index, spot] of SPOTS.entries()) {
    const x = mx(spot.x), y = my(spot.z);
    ovalDot(ctx, x, y, 14, '#f7efdc');
    pen(ctx, [...ellipse(x, y, 14, 14, 24), [x + 14, y]], 1.3, .8, true);
    text(ctx, String(index + 1), x - (index > 8 ? 9 : 5), y + 5, 15, .94);
  }
  const cpX = 2480, cpY = 1940;
  outline(ctx, [[cpX, cpY - 66], [cpX + 28, cpY], [cpX, cpY + 66], [cpX - 28, cpY]], 1.5, .8);
  tint(ctx, [[cpX, cpY - 66], [cpX, cpY], [cpX - 28, cpY]], '#a46d55', .6, .5);
  text(ctx, '北', cpX - 12, cpY - 84, 24, .85); text(ctx, '南', cpX - 12, cpY + 102, 24, .85);
  for (const [i, label, tone] of [[0, '朱墙', '#b7755c'], [1, '黄瓦', '#d3ab5e'], [2, '水系', '#90b3a9'], [3, '宫苑', '#b4bd8e']]) {
    tint(ctx, rect(980 + i * 220, 2040, 33, 22), tone, .7, .8);
    text(ctx, label, 1030 + i * 220, 2061, 24, .75);
  }
  text(ctx, '中轴巡礼示意 · 艺术化空间图 · 非实地测绘', 970, 2120, 22, .58);
  return canvas;
}
