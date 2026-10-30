import { rng, ellipse, dab, hex, lerp } from './art.js?v=20261030-detail4';
import { SPOTS } from './spots.js?v=20261030-detail4';
import { PLATE_COPY } from './plate-copy.js?v=20261030-detail4';
import {
  P, pen, tint, rect, outline, oval, text, plaque, ground, water, brickwork, lattice,
  facade, roof, hall, railing, terrace, tree, rock, cloud, annotation, openPage,
} from './drawing-kit.js?v=20261030-detail4';
import { bridge, lion, dragon, bronzeVessel, jadeSeal, book, desk, scroll, incense, sealPrint } from './drawing-motifs.js?v=20261030-detail4';

function sky(ctx, color = '#c2d0ca', seed = 2) {
  tint(ctx, [[320, 150], [2280, 150], [2250, 580], [340, 560]], color, .21, 42, seed);
  cloud(ctx, 660, 235, 340, 45, seed);
  cloud(ctx, 1750, 310, 280, 38, seed + 4);
  for (let i = 0; i < 6; i++) {
    const x = 700 + i * 175, y = 185 + Math.sin(i * 2) * 35;
    pen(ctx, [[x - 8, y - 4], [x, y], [x + 8, y - 4]], 1.3, .48, true);
  }
}
function wall(ctx, x, y, w, h, seed = 3) {
  tint(ctx, rect(x, y, w, h), '#b7604d', .43, 7, seed, true);
  brickwork(ctx, x + 3, y + 4, w - 6, h - 8, 65, .17);
  pen(ctx, [[x - 8, y], [x + w + 8, y]], 2.2, .65);
  for (let i = 0; i < Math.floor(w / 16); i++) {
    const px = x + i * 16;
    pen(ctx, [[px, y - 6], [px + 7, y - 13], [px + 15, y - 6]], 1, .5, true);
  }
}
function arch(ctx, cx, y, w, h) {
  const pts = Array.from({ length: 23 }, (_, i) => [cx + Math.cos(Math.PI + i / 22 * Math.PI) * w / 2, y + h * .3 + Math.sin(Math.PI + i / 22 * Math.PI) * w * .44]);
  pts.push([cx + w / 2, y + h], [cx - w / 2, y + h]);
  tint(ctx, pts, '#3c4036', .88, 1.5, 7, true); outline(ctx, pts, 2.2, .8);
  for (let i = 0; i < 10; i++) {
    const angle = Math.PI + i / 9 * Math.PI;
    pen(ctx, [[cx + Math.cos(angle) * w * .52, y + h * .3 + Math.sin(angle) * w * .46], [cx + Math.cos(angle) * w * .63, y + h * .3 + Math.sin(angle) * w * .58]], .9, .4);
  }
}

function wumen(ctx) {
  sky(ctx);
  ground(ctx, 1060, 1250);
  wall(ctx, 470, 760, 1650, 345, 101);
  tint(ctx, [[430, 755], [470, 760], [470, 1110], [430, 1190], [350, 1190], [350, 810]], P.redDark, .58, 4);
  tint(ctx, [[2120, 760], [2210, 810], [2210, 1190], [2120, 1110]], P.redDark, .58, 4);
  brickwork(ctx, 365, 845, 64, 320, 40, .3);
  for (const x of [970, 1290, 1610]) arch(ctx, x, 865, 125, 232);
  for (const x of [585, 1995]) arch(ctx, x, 938, 72, 160);
  hall(ctx, { x: 690, y: 265, w: 1190, h: 490, bays: 9, double: true });
  for (const [x, yy] of [[360, 610], [1930, 610], [350, 780], [1940, 780]]) hall(ctx, { x, y: yy - 210, w: 280, h: 210, bays: 3 });
  railing(ctx, 500, 690, 728, 32, 5); railing(ctx, 1880, 2090, 728, 32, 5);
  annotation(ctx, '重檐 · 层层出挑', [1810, 485], [1920, 270]);
  annotation(ctx, '城台的砖缝与门洞', [1660, 1045], [1800, 1205]);
}
function jinshui(ctx) {
  sky(ctx, '#c3d5d0', 201);
  wall(ctx, 390, 380, 1820, 160, 202);
  hall(ctx, { x: 900, y: 200, w: 800, h: 330, bays: 9, double: true });
  water(ctx, 350, 690, 1900, 495, 203);
  for (const [x, yy, w, h] of [[590, 695, 370, 180], [1010, 665, 370, 190], [1430, 665, 370, 190], [1850, 695, 370, 180]]) bridge(ctx, x, yy, w, h, x);
  bridge(ctx, 1270, 910, 1040, 225, 208);
  for (let i = 0; i < 14; i++) {
    const x = 760 + i * 78;
    pen(ctx, [[x, 1160], [x + 29, 1175], [x + 58, 1162]], 1, .32, true);
  }
  annotation(ctx, '望柱 · 栏板 · 拱券', [1450, 955], [1760, 1230]);
  annotation(ctx, '桥下水光', [680, 1065], [405, 1225]);
}
function wuying(ctx) {
  sky(ctx, '#cbd5cb', 301);
  ground(ctx, 1020, 1240);
  tree(ctx, 2020, 920, 580, 303, 255);
  hall(ctx, { x: 680, y: 290, w: 1290, h: 470, bays: 7, type: 'hip', title: '武英殿' });
  terrace(ctx, 1325, 760, 1160, 100, 1);
  water(ctx, 360, 920, 1650, 280, 304);
  bridge(ctx, 1120, 870, 1120, 250, 305);
  lion(ctx, 690, 896, .48, '#b1b2a0', 306);
  book(ctx, 1840, 1050, 245, 72, '#718d88');
  book(ctx, 1860, 994, 235, 65, '#9b9373');
  annotation(ctx, '石狮与桥栏', [710, 835], [390, 710]);
  annotation(ctx, '线装书页的层叠', [1990, 1085], [1780, 1220]);
}
function wenhua(ctx) {
  sky(ctx, '#c2d3ce', 401);
  tree(ctx, 2090, 1020, 680, 403, 205);
  tint(ctx, rect(610, 615, 1270, 310), '#9a6a4d', .6, 3);
  facade(ctx, 620, 625, 1250, 290, 7, { ornate: true, color: '#9b6649' });
  facade(ctx, 645, 365, 1200, 175, 7, { ornate: true, doors: 0, color: '#806b51' });
  roof(ctx, 490, 470, 1510, 150, { color: '#465552', dark: '#263d3e', type: 'gable' });
  tint(ctx, [[475, 610], [2010, 610], [1985, 634], [500, 634]], '#609577', .8, 1.5);
  roof(ctx, 550, 175, 1390, 205, { color: '#465552', dark: '#263d3e', type: 'gable' });
  plaque(ctx, '文渊阁', 1240, 630, 170, 48);
  terrace(ctx, 1250, 925, 1260, 82, 1);
  water(ctx, 580, 1040, 1440, 170, 405, '#9eb9a6');
  for (let i = 0; i < 24; i++) pen(ctx, [[700 + i * 49, 1060], [680 + i * 50, 1190]], 1.2, .14, true);
  annotation(ctx, '黑瓦上的绿剪边', [1830, 620], [1870, 1180]);
  annotation(ctx, '层阁与菱花窗棂', [740, 790], [350, 1120]);
}
function taihemen(ctx) {
  sky(ctx, '#cbd1c1', 501); ground(ctx, 900, 1250);
  hall(ctx, { x: 560, y: 220, w: 1480, h: 570, bays: 9, double: true, title: '太和门' });
  terrace(ctx, 1300, 790, 1390, 170, 2);
  lion(ctx, 710, 1090, .72, '#688576', 505);
  lion(ctx, 1880, 1090, .72, '#688576', 506);
  annotation(ctx, '铜狮的鬃卷与足爪', [660, 965], [350, 1220]);
  annotation(ctx, '斗拱与彩绘梁枋', [1860, 590], [1970, 420]);
}
function taihedian(ctx) {
  sky(ctx, '#e3d3ab', 601); ground(ctx, 1120, 1250);
  hall(ctx, { x: 490, y: 210, w: 1610, h: 610, bays: 11, double: true, ornate: true, title: '太和殿' });
  terrace(ctx, 1295, 820, 1530, 325, 3);
  dragon(ctx, 1295, 1005, .35, '#c3baa1', -1, 608);
  for (const x of [690, 1910]) {
    tint(ctx, rect(x - 22, 783, 44, 37), '#9d997c', .6, 1);
    incense(ctx, x, 767, .7);
  }
  annotation(ctx, '琉璃瓦垄与脊饰', [1840, 400], [1900, 185]);
  annotation(ctx, '三层石台 · 雕栏与丹陛', [1790, 1060], [1800, 1230]);
}
function zhonghedian(ctx) {
  sky(ctx, '#d6d8c4', 701); ground(ctx, 1050, 1250);
  terrace(ctx, 1280, 900, 1080, 220, 2);
  facade(ctx, 830, 630, 900, 270, 5, { ornate: true });
  roof(ctx, 680, 295, 1200, 350, { type: 'pyramid', beasts: 3 });
  oval(ctx, 1280, 278, 18, 32, '#c5a65a', .84);
  pen(ctx, [[1280, 237], [1280, 213]], 3, .8);
  plaque(ctx, '中和殿', 1280, 658, 195, 48);
  incense(ctx, 733, 915, 1.1); incense(ctx, 1820, 915, 1.1);
  annotation(ctx, '四角汇于宝顶', [1280, 275], [1750, 220]);
  annotation(ctx, '方殿与石栏', [1740, 945], [1840, 1190]);
}
function baohedian(ctx) {
  sky(ctx, '#d0d7c8', 801);
  hall(ctx, { x: 760, y: 180, w: 1050, h: 345, bays: 9, double: true, title: '保和殿' });
  const stone = [[985, 575], [1560, 575], [1730, 1180], [815, 1180]];
  tint(ctx, stone, '#dcd4bd', .72, 3); outline(ctx, stone, 2.6, .76);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    dragon(ctx, 1080 + i * 195 + (j - 1) * 8, 680 + j * 170, .42 + j * .08, '#b4b69f', i % 2 ? -1 : 1, 810 + i + j * 10);
  }
  for (let i = 0; i < 24; i++) {
    const y = 590 + i * 25, spread = (y - 575) * .3;
    pen(ctx, [[680 - spread, y], [970 - spread, y]], 1, .55);
    pen(ctx, [[1575 + spread, y], [1860 + spread, y]], 1, .55);
  }
  railing(ctx, 570, 920, 620, 58, 12); railing(ctx, 1630, 1970, 620, 58, 12);
  annotation(ctx, '云龙纹在石面间起伏', [1510, 1000], [1840, 1090]);
  annotation(ctx, '御路旁的级级石阶', [740, 1000], [350, 1210]);
}
function tonggang(ctx) {
  ground(ctx, 1020, 1250); wall(ctx, 370, 300, 1880, 600, 901);
  tree(ctx, 2120, 1120, 620, 903, 230);
  tint(ctx, [[820, 1020], [1710, 1020], [1770, 1140], [760, 1140]], P.stone, .76, 3);
  outline(ctx, [[820, 1020], [1710, 1020], [1770, 1140], [760, 1140]], 1.9, .6);
  bronzeVessel(ctx, 1260, 790, 825, 500, 906);
  for (let i = 0; i < 11; i++) {
    const x = 950 + i * 57;
    pen(ctx, [[x, 1015], [x + 11, 1035], [x + 23, 1015]], .9, .5, true);
  }
  annotation(ctx, '兽面衔环 · 岁月留痕', [1640, 850], [1740, 1190]);
  annotation(ctx, '铜口内外的明暗', [1180, 665], [410, 560]);
}
function yangxin(ctx) {
  tint(ctx, rect(360, 170, 1880, 990), '#d7c6a6', .41, 8);
  tint(ctx, [[360, 1010], [2240, 1010], [2270, 1215], [330, 1215]], '#b9a48a', .38, 6);
  for (const x of [410, 2110]) {
    tint(ctx, rect(x, 210, 38, 920), P.woodDark, .65, 2);
    for (let i = 0; i < 8; i++) pen(ctx, [[x + 4 + i * 4, 240], [x + 9 + i * 3, 1110]], .75, .42, true);
  }
  lattice(ctx, 480, 290, 375, 560, true);
  tint(ctx, [[490, 295], [845, 295], [845, 540], [490, 700]], '#d9d9ab', .2, 8);
  plaque(ctx, '三希堂', 1350, 240, 420, 105);
  desk(ctx, 920, 845, 1010, 300);
  scroll(ctx, 1070, 804, 555, 128);
  text(ctx, '快雪时晴', 1170, 870, 40, .85);
  book(ctx, 1710, 784, 180, 52, '#738d7f'); book(ctx, 1730, 742, 160, 48, '#a49368');
  tint(ctx, rect(915, 480, 360, 250), '#a88760', .42, 2); lattice(ctx, 935, 505, 320, 200, true);
  for (let i = 0; i < 24; i++) {
    const x = 1785 + i * 12;
    pen(ctx, [[x, 380], [x, 790]], .85, .46);
    for (let j = 0; j < 18; j++) oval(ctx, x, 395 + j * 20, 2.7, 4.5, '#b48c45', .55, false);
  }
  oval(ctx, 1015, 836, 40, 14, '#3e4d42', .72);
  for (let i = 0; i < 5; i++) pen(ctx, [[1780 + i * 14, 832], [1790 + i * 11, 666 - i * 3]], 2.1, .8);
  annotation(ctx, '书卷 · 笔架 · 木纹', [1690, 900], [1760, 1220]);
  annotation(ctx, '窗光落在细密格心', [650, 600], [400, 1030]);
}
function qianqing(ctx) {
  tint(ctx, rect(350, 175, 1900, 1020), '#d2b995', .43, 8);
  ground(ctx, 1015, 1240);
  for (const x of [500, 2020]) lattice(ctx, x, 350, 230, 655, true);
  for (const x of [770, 1910]) {
    tint(ctx, rect(x, 250, 45, 885), P.red, .8, 2);
    for (const y of [280, 1030, 1095]) tint(ctx, rect(x - 2, y, 49, 14), P.goldDark, .65, .5);
    pen(ctx, [[x + 8, 270], [x + 8, 1110]], 1.3, .8);
  }
  plaque(ctx, '正大光明', 1350, 245, 540, 110);
  tint(ctx, rect(940, 435, 820, 465), '#be9b54', .64, 3);
  for (let i = 0; i < 7; i++) {
    outline(ctx, rect(957 + i * 112, 460, 94, 405), 1.4, .75);
    dragon(ctx, 1003 + i * 112, 680, .28, '#b08b43', i % 2 ? -1 : 1, 1110 + i);
  }
  terrace(ctx, 1350, 1000, 870, 155, 2);
  tint(ctx, [[1120, 880], [1570, 880], [1620, 1030], [1070, 1030]], '#b0924a', .76, 2);
  tint(ctx, rect(1160, 750, 370, 150), '#c6ab5d', .76, 2);
  outline(ctx, rect(1160, 750, 370, 150), 2.7, .8);
  dragon(ctx, 1340, 820, .56, '#d6bc72', 1, 1120);
  for (const x of [1100, 1560]) pen(ctx, [[x, 835], [x - 17, 910], [x + 22, 940]], 5, .8, true);
  incense(ctx, 900, 1050, 1.2); incense(ctx, 1795, 1050, 1.2);
  annotation(ctx, '座屏的金色纹样', [1640, 780], [1800, 1205]);
}
function jiaotai(ctx) {
  tint(ctx, rect(370, 200, 1850, 960), '#d5c3a2', .32, 8);
  lattice(ctx, 1830, 300, 290, 640, true);
  tint(ctx, rect(560, 265, 1160, 385), '#9a7c58', .55, 3);
  for (let row = 0; row < 5; row++) for (let column = 0; column < 5; column++) {
    const x = 655 + column * 215, y = 318 + row * 68;
    tint(ctx, rect(x - 43, y - 8, 85, 43), '#526e61', .65, 1);
    outline(ctx, rect(x - 43, y - 8, 85, 43), .9, .65);
    oval(ctx, x, y - 16, 20, 12, '#849c80', .7);
    pen(ctx, [[x - 11, y - 22], [x, y - 32], [x + 13, y - 21]], 1.1, .7, true);
  }
  desk(ctx, 620, 850, 1180, 300);
  jadeSeal(ctx, 1140, 885, 470, 1212);
  scroll(ctx, 1670, 905, 260, 170);
  sealPrint(ctx, '受命之宝', 1800, 989, 116);
  annotation(ctx, '盘曲龙钮 · 玉色层次', [1340, 725], [1510, 770]);
  annotation(ctx, '二十五方宝玺的意象', [1400, 450], [1840, 230]);
}
function ningshou(ctx) {
  sky(ctx, '#d6d5bf', 1301); ground(ctx, 1110, 1240);
  const x = 390, y = 460, w = 1850, h = 540;
  tint(ctx, rect(x, y, w, h), '#b87042', .64, 3);
  roof(ctx, x - 45, 340, w + 90, 125, { type: 'gable', beasts: 3 });
  tint(ctx, rect(x + 20, y + 18, w - 40, h - 36), '#b6a66e', .48, 3);
  for (let i = 0; i <= 9; i++) pen(ctx, [[x + i * w / 9, y + 12], [x + i * w / 9, y + h - 12]], 1.2, .48);
  const tones = ['#ddd1a7', '#6b9c9a', '#bda34e', '#789a9b', '#d8b764', '#9ab18e', '#d9d8c3', '#b07c55', '#7d9e9a'];
  for (let i = 0; i < 9; i++) {
    const cx = x + (i + .5) * w / 9, cy = 675 + Math.sin(i * 1.2) * 40;
    const dir = i < 4 ? 1 : (i > 4 ? -1 : 1);
    dragon(ctx, cx, cy, .58, tones[i], dir, 1310 + i);
    cloud(ctx, cx - 70, cy - 105, 140, 28, 1350 + i);
  }
  for (let row = 0; row < 3; row++) for (let i = 0; i < 36; i++) {
    const px = x + 20 + i * 50, py = 875 + row * 31;
    pen(ctx, [[px, py], [px + 11, py - 13], [px + 23, py], [px + 37, py - 13], [px + 49, py]], 1.1, .58, true);
  }
  tint(ctx, rect(x - 14, 1000, w + 28, 85), '#b7aa8e', .65, 2);
  brickwork(ctx, x - 14, 1000, w + 28, 85, 71, .36);
  annotation(ctx, '龙鳞 · 须爪 · 云水', [1980, 725], [1800, 1220]);
}
function yuhuayuan(ctx) {
  sky(ctx, '#c9d7c7', 1401); ground(ctx, 1110, 1260);
  tree(ctx, 660, 1120, 850, 1402, 420); tree(ctx, 1990, 1120, 850, 1403, 390);
  for (let tier = 0; tier < 5; tier++) for (let i = 0; i < 4 + tier; i++) {
    const spread = 230 + tier * 130, cx = 1300 - spread / 2 + i / (3 + tier) * spread;
    rock(ctx, cx, 600 + tier * 110, 92 + tier * 4, 75, 1410 + tier * 20 + i);
  }
  hall(ctx, { x: 1090, y: 305, w: 420, h: 290, bays: 3, type: 'pyramid' });
  for (const [x, y] of [[920, 1120], [1740, 1080], [760, 1190]]) rock(ctx, x, y, 85, 55, x);
  for (let i = 0; i < 50; i++) {
    const x = 850 + i * 22, y = 1190 + Math.sin(i * .3) * 24;
    oval(ctx, x, y, 7 + i % 3, 4.5, '#a6a78b', .35);
  }
  for (let i = 0; i < 35; i++) {
    const random = rng(1470 + i), x = 420 + random() * 1700, y = 1130 + random() * 110;
    pen(ctx, [[x, y], [x + 5, y - 18]], .9, .55);
    for (let j = 0; j < 5; j++) oval(ctx, x + Math.cos(j * 1.26) * 5, y - 20 + Math.sin(j * 1.26) * 5, 3.5, 3.5, j % 2 ? '#bf9d81' : '#d7c6a5', .45, false);
  }
  annotation(ctx, '古柏的枝干与针叶', [690, 660], [350, 1180]);
  annotation(ctx, '叠石的孔隙与皴纹', [1620, 965], [1820, 1210]);
}
function jiaolou(ctx) {
  sky(ctx, '#dcc7b2', 1501); water(ctx, 335, 940, 1940, 280, 1502, '#88a7a0');
  tint(ctx, [[480, 1000], [1420, 890], [2210, 1010], [2210, 1090], [1420, 985], [480, 1095]], P.redDark, .62, 3);
  brickwork(ctx, 515, 1003, 1640, 73, 52, .3);
  hall(ctx, { x: 810, y: 560, w: 1080, h: 380, bays: 7, type: 'gable', title: '角楼' });
  hall(ctx, { x: 1040, y: 330, w: 650, h: 315, bays: 5, type: 'gable' });
  roof(ctx, 1190, 175, 340, 210, { type: 'pyramid' });
  oval(ctx, 1360, 160, 13, 19, P.goldDark, .85);
  roof(ctx, 610, 590, 430, 200, { type: 'gable' });
  roof(ctx, 1650, 590, 430, 200, { type: 'gable' });
  facade(ctx, 675, 780, 335, 160, 3, { ornate: true }); facade(ctx, 1690, 780, 335, 160, 3, { ornate: true });
  for (let i = 0; i < 23; i++) {
    const yy = 1080 + i * 5;
    tint(ctx, [[1000 - i * 3, yy], [1650 + i * 3, yy], [1630 + i * 3, yy + 3], [1015 - i * 3, yy + 3]], i % 3 ? '#b39362' : '#785c4c', .08, 4, 1510 + i);
  }
  annotation(ctx, '复合屋顶的层层转折', [1710, 515], [1830, 270]);
  annotation(ctx, '墙根与水中碎影', [1830, 1080], [1820, 1240]);
}
function cat(ctx) {
  wall(ctx, 340, 250, 1930, 650, 1601); ground(ctx, 920, 1250);
  const random = rng(1602);
  for (let i = 0; i < 50; i++) {
    const x = 390 + random() * 1750, y = 345 + random() * 500;
    tint(ctx, [[x, y], [x + 15 + random() * 30, y - 4], [x + 22, y + 8]], '#d7b197', .22, 3, 1610 + i);
  }
  oval(ctx, 1280, 1105, 530, 55, '#8b947f', .15, false);
  oval(ctx, 1320, 965, 385, 210, '#e1c08d', .82);
  oval(ctx, 1440, 965, 245, 152, '#d19b5b', .42, false);
  const tail = Array.from({ length: 45 }, (_, i) => {
    const angle = -.2 + i / 44 * Math.PI * 1.66;
    return [1520 + Math.cos(angle) * (195 - i * 1.7), 1000 + Math.sin(angle) * (135 - i * 1.1)];
  });
  const ribbon = [...tail.map(([x, y]) => [x, y - 21]), ...tail.toReversed().map(([x, y]) => [x, y + 21])];
  tint(ctx, ribbon, '#c18d51', .8, 3, 1630); pen(ctx, tail, 2.5, .55, true);
  oval(ctx, 1040, 924, 166, 148, '#e4cfab', .86);
  for (const ear of [[[900, 850], [908, 711], [1008, 797]], [[1080, 788], [1187, 715], [1195, 865]]]) {
    tint(ctx, ear, '#cfaa78', .8, 2); outline(ctx, ear, 2.2, .8);
    tint(ctx, ear.map(([x, y]) => [lerp(x, 1040, .15), lerp(y, 860, .15)]), '#bd8c7b', .3, 2);
  }
  for (const cx of [988, 1100]) {
    pen(ctx, [[cx - 28, 925], [cx, 939], [cx + 29, 924]], 3.6, .9, true);
    for (let i = 0; i < 4; i++) pen(ctx, [[cx - 12 + i * 8, 932], [cx - 19 + i * 11, 943]], 1.5, .8);
  }
  oval(ctx, 1043, 982, 65, 41, '#eee0be', .6, false);
  tint(ctx, [[1028, 968], [1056, 966], [1042, 986]], '#a87465', .8, 1);
  pen(ctx, [[1042, 986], [1040, 1001], [1024, 1009]], 1.8, .75, true);
  pen(ctx, [[1040, 1001], [1059, 1008]], 1.8, .75, true);
  for (const side of [-1, 1]) for (let i = 0; i < 6; i++) pen(ctx, [[1043 + side * 32, 981 + i * 6], [1043 + side * 160, 949 + i * 19]], 1.15, .74, true);
  for (let i = 0; i < 16; i++) {
    const x = 1160 + i * 29, y = 835 + Math.sin(i * .55) * 25;
    pen(ctx, [[x, y], [x - 12, y + 54], [x + 15, y + 94]], 5 + i % 4, .4, true);
  }
  for (let i = 0; i < 230; i++) {
    const angle = random() * Math.PI * 2, radius = Math.sqrt(random()), x = 1300 + Math.cos(angle) * radius * 345, y = 965 + Math.sin(angle) * radius * 175;
    pen(ctx, [[x, y], [x + 8 + random() * 10, y + (random() - .5) * 9]], .8, .2 + random() * .17, true);
  }
  oval(ctx, 1120, 1090, 110, 42, '#e9d6ad', .84);
  for (let i = 0; i < 5; i++) pen(ctx, [[1050 + i * 29, 1072], [1045 + i * 31, 1107]], 1.6, .55, true);
  pen(ctx, [[1170, 975], [1160, 1040]], 7, .65, true);
  oval(ctx, 1165, 1049, 21, 25, P.goldDark, .8);
  pen(ctx, [[1164, 1045], [1164, 1061]], 1.3, .7);
  for (let i = 0; i < 13; i++) {
    const x = 450 + random() * 1500, y = 1150 + random() * 90;
    tint(ctx, [[x - 12, y], [x, y - 11], [x + 16, y + 3], [x, y + 9]], '#b5a46c', .5, 1.5);
    pen(ctx, [[x - 6, y], [x + 7, y + 2]], .8, .5);
  }
  annotation(ctx, '须梢 · 细毛 · 蜷起的尾巴', [1670, 1030], [1670, 1215]);
}

const DRAWERS = [wumen, jinshui, wuying, wenhua, taihemen, taihedian, zhonghedian, baohedian, tonggang, yangxin, qianqing, jiaotai, ningshou, yuhuayuan, jiaolou, cat];
export const PLATE_ART_IDS = SPOTS.map(spot => spot.id);
export function drawPalacePlate(ctx, page) {
  if (!DRAWERS[page - 1]) throw new RangeError('Unknown palace plate');
  const copy = { ...PLATE_COPY[page - 1], title: SPOTS[page - 1].title };
  openPage(ctx, page, copy);
  DRAWERS[page - 1](ctx);
}
