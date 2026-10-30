import { ink, wash, ellipse, hex, v, rng, handwrite, dab } from './art.js';

// Architectural study details: fine hatching, reserved paper and marginal notes,
// adapted to the palace drawings rather than importing the reference's subject.
function line(ctx, points, seed, width = 1.5, alpha = .65, smooth = false) {
  ink(ctx, points.map(([x, y]) => v(x, y, 0)), { w: width, wob: .55, over: 2, seed, smooth }, alpha);
}

function roof(ctx, x0, x1, top, bottom, inset, seed) {
  const left = x0 + inset, right = x1 - inset;
  line(ctx, [[x0, bottom], [left, top], [right, top], [x1, bottom]], seed, 2.2, .8);
  line(ctx, [[x0 - 14, bottom - 12], [x0 + 100, bottom + 14], [x1 - 100, bottom + 14], [x1 + 14, bottom - 12]], seed + 1, 2.3, .8, true);
  for (let i = 0; i <= 55; i++) {
    const u = i / 55;
    const x = left + (right - left) * u, bx = x0 + (x1 - x0) * u;
    line(ctx, [[x, top + 3], [(x + bx) / 2, (top + bottom) / 2 - 6], [bx, bottom - 8]], seed + 10 + i, .85, .42, true);
  }
  wash(ctx, [[x0 + 12, bottom + 12], [x1 - 12, bottom + 12], [x1 - 27, bottom + 30], [x0 + 27, bottom + 30]], hex('#4a3327'), { a: .25, j: 3, seed, edge: 0 });
}

function lattice(ctx, x, y, w, h, seed, columns = 5, rows = 4) {
  wash(ctx, [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], hex('#263e3a'), { a: .25, j: 2, seed, edge: 0 });
  line(ctx, [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]], seed, 1.8, .8);
  for (let i = 1; i < columns; i++) line(ctx, [[x + w * i / columns, y], [x + w * i / columns, y + h]], seed + i, 1, .6);
  for (let i = 1; i < rows; i++) line(ctx, [[x, y + h * i / rows], [x + w, y + h * i / rows]], seed + 10 + i, 1, .6);
}

function facade(ctx, x, y, w, h, bays, seed) {
  for (let i = 0; i <= bays; i++) {
    const px = x + w * i / bays;
    line(ctx, [[px, y], [px, y + h]], seed + i, 4, .75);
    if (i < bays) lattice(ctx, px + w / bays * .2, y + h * .22, w / bays * .6, h * .55, seed + 30 + i, 4, 3);
  }
  line(ctx, [[x - 10, y + 12], [x + w + 10, y + 12]], seed + 20, 2, .8);
  line(ctx, [[x - 20, y + h], [x + w + 20, y + h]], seed + 21, 2, .7);
}

function railing(ctx, x0, x1, y, seed) {
  line(ctx, [[x0, y], [x1, y]], seed, 2, .62);
  line(ctx, [[x0, y + 24], [x1, y + 24]], seed + 1, 1.2, .45);
  for (let i = 0; i <= 24; i++) {
    const x = x0 + (x1 - x0) * i / 24;
    line(ctx, [[x, y - 12], [x, y + 42]], seed + i + 2, 1.9, .6);
  }
}

function note(ctx, text, anchor, at, seed) {
  const direction = at[0] > anchor[0] ? -1 : 1;
  line(ctx, [anchor, [(anchor[0] + at[0]) / 2, at[1] + 18], [at[0] + direction * 12, at[1] + 10]], seed, 1.1, .5);
  handwrite(ctx, { text, x: at[0], y: at[1], size: 22, alpha: .6 }, 1);
}

export function decoratePlate(ctx, page) {
  const seed = 7000 + page * 100;
  const random = rng(seed);
  const frame = [[50, 60], [2350, 60], [2350, 1290], [50, 1290], [50, 60]];
  for (let i = 0; i < 4; i++) line(ctx, [frame[i], frame[i + 1]], seed + i, 1.15, .3);
  for (let i = 0; i < 70; i++) {
    const x = 60 + random() * 2280, y = random() < .5 ? 90 + random() * 70 : 1200 + random() * 70;
    line(ctx, [[x, y], [x + random() * 5, y + 1]], seed + i + 8, .65, .3);
  }

  if (page === 1) {
    roof(ctx, 540, 1860, 340, 520, 200, seed + 100);
    facade(ctx, 650, 555, 1100, 65, 9, seed + 170);
    for (let i = 0; i < 12; i++) line(ctx, [[390, 720 + i * 30], [2010, 720 + i * 30]], seed + 230 + i, .7, .15);
    note(ctx, '瓦面与檐口', [1740, 490], [1880, 330], seed + 260);
    note(ctx, '城台与门洞', [1460, 1050], [1750, 1210], seed + 261);
  } else if (page === 2) {
    for (let i = 0; i < 5; i++) railing(ctx, 390 + i * 340, 650 + i * 340, 485, seed + i * 40);
    note(ctx, '石栏映水', [1300, 510], [1730, 310], seed + 250);
  } else if (page === 3) {
    roof(ctx, 480, 1920, 240, 480, 140, seed + 100);
    facade(ctx, 630, 510, 1140, 110, 7, seed + 180);
    railing(ctx, 790, 1610, 640, seed + 250);
    note(ctx, '石桥栏板', [1430, 700], [1790, 1050], seed + 300);
  } else if (page === 4) {
    roof(ctx, 440, 1960, 260, 540, 100, seed + 100);
    facade(ctx, 545, 600, 1310, 340, 7, seed + 180);
    line(ctx, [[530, 760], [1870, 760]], seed + 220, 3, .75);
    note(ctx, '黑瓦 · 绿剪边', [1830, 555], [1780, 1120], seed + 300);
  } else if (page === 5) {
    roof(ctx, 380, 2020, 240, 520, 100, seed + 100);
    facade(ctx, 510, 550, 1380, 240, 9, seed + 180);
    note(ctx, '门前铜狮', [800, 800], [1460, 1070], seed + 300);
  } else if (page === 6) {
    roof(ctx, 420, 1980, 200, 440, 200, seed + 100);
    facade(ctx, 555, 520, 1290, 150, 11, seed + 180);
    railing(ctx, 465, 1935, 710, seed + 280);
    railing(ctx, 375, 2025, 840, seed + 320);
    note(ctx, '层叠台基', [1840, 1020], [1830, 1220], seed + 380);
  } else if (page === 7) {
    for (let i = 0; i < 30; i++) line(ctx, [[1200, 270], [680 + i / 29 * 1040, 510]], seed + 100 + i, .9, .4);
    facade(ctx, 760, 550, 880, 210, 5, seed + 180);
    railing(ctx, 650, 1750, 825, seed + 250);
    note(ctx, '攒尖轮廓', [1200, 250], [1790, 330], seed + 300);
  } else if (page === 8) {
    for (let i = 0; i < 60; i++) {
      const x = 720 + random() * 920, y = 430 + random() * 660;
      line(ctx, [[x, y], [x + 16, y - 8], [x + 30, y + 2]], seed + 100 + i, .8, .35, true);
    }
    note(ctx, '石上云纹', [1610, 640], [1810, 840], seed + 300);
  } else if (page === 9) {
    line(ctx, ellipse(1200, 635, 210, 36, 30), seed + 100, 2, .8, true);
    line(ctx, ellipse(1200, 640, 180, 20, 30), seed + 101, 1.1, .55, true);
    for (let i = 0; i < 24; i++) {
      const x = 1000 + random() * 390, y = 710 + random() * 170;
      line(ctx, [[x, y], [x + 10, y - 4]], seed + 120 + i, 1, .4);
    }
    note(ctx, '铜色与岁痕', [1420, 780], [1660, 1080], seed + 300);
  } else if (page === 10) {
    lattice(ctx, 470, 330, 220, 650, seed + 100, 5, 12);
    lattice(ctx, 1710, 330, 220, 650, seed + 150, 5, 12);
    for (let i = 0; i < 18; i++) line(ctx, [[720, 930 + i * 6], [1680, 925 + i * 6]], seed + 220 + i, .7, .25);
    note(ctx, '窗棂与书案', [1680, 970], [1770, 1200], seed + 300);
  } else if (page === 11) {
    lattice(ctx, 475, 355, 235, 630, seed + 100, 6, 10);
    lattice(ctx, 1690, 355, 235, 630, seed + 150, 6, 10);
    for (const x of [785, 1615]) line(ctx, [[x, 270], [x, 1080]], seed + x, 10, .55);
    note(ctx, '匾额与座屏', [1540, 410], [1720, 1170], seed + 300);
  } else if (page === 12) {
    for (let i = 0; i < 20; i++) line(ctx, [[660, 940 + i * 5], [1720, 943 + i * 5]], seed + 100 + i, .8, .26);
    line(ctx, [[1110, 900], [1110, 920], [1320, 920], [1320, 900]], seed + 150, 2, .7);
    note(ctx, '宝玺意象', [1260, 670], [1770, 420], seed + 300);
  } else if (page === 13) {
    for (let i = 0; i < 9; i++) {
      const x = 460 + i * 180, y = 660 + Math.sin(i * .9) * 60;
      line(ctx, [[x - 55, y + 35], [x - 25, y - 15], [x + 10, y + 20], [x + 45, y - 35]], seed + 100 + i, 3, .8, true);
      line(ctx, [[x + 45, y - 35], [x + 30, y - 55], [x + 55, y - 50], [x + 68, y - 28]], seed + 120 + i, 1.5, .8);
      line(ctx, [[x, y + 12], [x - 5, y + 50], [x + 20, y + 43]], seed + 140 + i, 1.3, .7);
    }
    for (let i = 0; i < 14; i++) line(ctx, [[390 + i * 115, 885], [425 + i * 115, 865], [465 + i * 115, 885]], seed + 180 + i, 1.2, .6, true);
    note(ctx, '琉璃色与云水纹', [1800, 900], [1690, 1170], seed + 300);
  } else if (page === 14) {
    for (const [x, y] of [[640, 690], [1760, 670]]) {
      for (let i = 0; i < 120; i++) {
        const angle = random() * Math.PI * 2, radius = Math.sqrt(random()) * 145;
        dab(ctx, x + Math.cos(angle) * radius, y + Math.sin(angle) * radius * .65, 5 + random() * 10, random() * 6, hex(i % 3 ? '#506548' : '#9aa273'), .3, seed + i);
      }
      line(ctx, [[x, y + 410], [x - 14, y + 145], [x + 10, y + 15]], seed + x, 2.2, .7, true);
    }
    note(ctx, '古柏与叠石', [1660, 740], [1810, 1150], seed + 300);
  } else if (page === 15) {
    roof(ctx, 880, 1520, 480, 600, 120, seed + 100);
    roof(ctx, 960, 1440, 370, 480, 100, seed + 170);
    facade(ctx, 970, 635, 460, 150, 5, seed + 240);
    for (let i = 0; i < 25; i++) {
      const x = 600 + random() * 1200, y = 900 + random() * 300;
      line(ctx, [[x, y], [x + 60 + random() * 100, y + 2]], seed + 290 + i, .8, .35);
    }
    note(ctx, '层檐与倒影', [1470, 570], [1740, 1000], seed + 350);
  } else if (page === 16) {
    line(ctx, [[1050, 798], [1065, 790], [1077, 795]], seed + 100, 2.8, .85, true);
    line(ctx, [[1104, 794], [1114, 790], [1125, 798]], seed + 101, 2.8, .85, true);
    line(ctx, [[1085, 810], [1094, 813], [1089, 820], [1085, 810]], seed + 102, 2, .8);
    line(ctx, [[1089, 820], [1080, 830], [1067, 825]], seed + 103, 1.5, .7, true);
    for (let i = 0; i < 6; i++) line(ctx, [[1160 + i * 22, 825], [1175 + i * 22, 848]], seed + 110 + i, 4, .45);
    line(ctx, [[1110, 925], [1150, 934], [1190, 926]], seed + 130, 2, .6, true);
    note(ctx, '红墙下的小憩', [1370, 850], [1650, 1100], seed + 300);
  }
}
