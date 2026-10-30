import { ellipse, rng, lerp, sealStamp } from './art.js?v=20261030-dragon2';
import { P, pen, tint, rect, outline, oval, lattice, brickwork } from './drawing-kit.js?v=20261030-dragon2';

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
  const s = size, d = direction;

  // 1. Classical Imperial Posture Curves (升龙 / 降龙 / 盘龙正龙)
  // Determine pose archetype:
  // - 0: 升龙 (Ascending dragon soaring through clouds)
  // - 1: 降龙 (Descending dragon swooping down)
  // - 2: 盘龙 / 正龙 (Imperial coiled dragon, especially majestic for center Nine Dragon Wall seed 1314 or throne seed 1120)
  const poseType = (seed === 1314 || seed === 1120) ? 2 : Math.abs(seed) % 3;

  let curves;
  if (poseType === 0) {
    // 升龙 (Ascending): Head vaults high up and forward, body arches dynamically with deep S-curve
    curves = [
      [[-155, 95], [-165, -30], [-100, -75], [-45, 10]],
      [[-45, 10], [5, 90], [55, 60], [30, -25]],
      [[30, -25], [10, -95], [85, -90], [130, -45]],
    ];
  } else if (poseType === 1) {
    // 降龙 (Descending): Body arches high from top, head swoops down and forward
    curves = [
      [[-150, -65], [-120, -115], [-50, -95], [-20, -25]],
      [[-20, -25], [10, 50], [-70, 95], [15, 80]],
      [[15, 80], [90, 65], [80, -15], [125, 25]],
    ];
  } else {
    // 盘龙 / 正龙 (Majestic Coiled Dragon): Grand concentric loops, imperial poise
    curves = [
      [[-140, 60], [-175, -20], [-95, -95], [-20, -70]],
      [[-20, -70], [60, -45], [95, 60], [10, 85]],
      [[10, 85], [-65, 105], [55, 20], [115, -20]],
    ];
  }

  // Generate smooth spine points along cubic Beziers
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

  // Calculate normals and body contours with organic anatomical thickness
  const left = [], right = [], belly = [];
  const normals = [];
  points.forEach(([x, y], i) => {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const u = i / (points.length - 1);
    // Radius: starts slender at tail (3.5*s), thickens at hindquarters (11*s), broad powerful chest (16*s), flexible neck (8*s)
    const r = (3.5 + 12.5 * Math.sin(Math.pow(u, 0.68) * Math.PI)) * s;
    const nx = -(b[1] - a[1]) / len * r, ny = (b[0] - a[0]) / len * r;
    normals.push([nx / r, ny / r, r]);
    left.push([x + nx, y + ny]);
    right.push([x - nx, y - ny]);
    // Inner underbelly contour (35% offset toward right edge)
    belly.push([x - nx * 0.4, y - ny * 0.4]);
  });

  // 2. Body Wash & Shading (双层水彩生宣晕染)
  tint(ctx, [...left, ...right.toReversed()], color, .78, 1.2, seed);
  tint(ctx, [...belly, ...right.toReversed()], '#fff4dc', .36, .8, seed + 2);

  // 3. Ventral Cross-Plates (腹甲横纹)
  for (let i = 8; i < points.length - 6; i += 3) {
    const [x, y] = points[i];
    const [bx, by] = right[i];
    pen(ctx, [[x, y], [bx, by]], 0.8 * s, 0.45);
  }

  // 4. Dorsal Spine Fins (火焰背脊棘刺 / 龙脊刀鳍)
  for (let i = 10; i < points.length - 6; i += 3) {
    const [lx, ly] = left[i];
    const [nx, ny] = normals[i];
    const finLen = (7 + (i % 6 === 0 ? 5 : 2)) * s;
    const finTip = [lx + nx * finLen, ly + ny * finLen];
    const nextLeft = left[Math.min(points.length - 1, i + 2)];
    tint(ctx, [[lx, ly], finTip, nextLeft], '#e5b244', .62, .5, seed + i);
    pen(ctx, [[lx, ly], finTip, nextLeft], .9 * s, .78, true);
  }

  // 5. Overlapping Fish Scales (层叠金鳞纹)
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

  // Body Outlines (双钩墨线)
  pen(ctx, left, 1.45 * s, .82, true);
  pen(ctx, right, 1.45 * s, .82, true);

  // 6. Magnificent Flaming Tail Fin (火焰龙尾 / 卷云鱼尾)
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
  const tailPoly = [[tx, ty], ...tailPlumes.map(([px, py]) => [tx + px, ty + py])];
  tint(ctx, tailPoly, color, .75, 1.2, seed + 3);
  for (const [px, py] of tailPlumes) {
    pen(ctx, [
      [tx, ty],
      [tx + px * .55 + tnx * 6 * s, ty + py * .55 + tny * 6 * s],
      [tx + px, ty + py],
    ], 1.2 * s, .8, true);
    spiral(ctx, tx + px, ty + py, 4.5 * s, .65, .9 * s);
  }

  // 7. Five Imperial Dragon Claws (严格五爪金龙与肘部云焰)
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

      const legPoly = [
        [lx - 4 * s, ly],
        [kneeX - 3 * s, kneeY],
        [wristX, wristY],
        [kneeX + 4 * s, kneeY],
        [lx + 6 * s, ly],
      ];
      tint(ctx, legPoly, color, .78, .8, seed + at);
      pen(ctx, [[lx, ly], [kneeX, kneeY], [wristX, wristY]], 2.4 * s, .82, true);

      // Elbow Flame Wisps (肘毛/云焰)
      for (let f = 0; f < 3; f++) {
        const flameOffset = (f - 1) * 6 * s;
        pen(ctx, [
          [kneeX, kneeY],
          [kneeX - d * (14 + f * 5) * s, kneeY - side * (8 + flameOffset) * s],
          [kneeX - d * (24 + f * 7) * s, kneeY - side * (4 + flameOffset) * s],
        ], .85 * s, .7, true);
      }

      // Palm Pad
      oval(ctx, wristX, wristY, 5 * s, 4 * s, color, .85, true);

      // FIVE TALONS (五爪: 4 fan claws + 1 rear thumb claw)
      const baseAngle = Math.atan2(wristY - kneeY, wristX - kneeX);
      for (let claw = 0; claw < 4; claw++) {
        const spreadAngle = baseAngle + (claw - 1.5) * 0.38;
        const knuckle = [
          wristX + Math.cos(spreadAngle) * 11 * s,
          wristY + Math.sin(spreadAngle) * 11 * s,
        ];
        const hookAngle = spreadAngle + (side > 0 ? 0.35 : -0.35);
        const clawTip = [
          knuckle[0] + Math.cos(hookAngle) * 8 * s,
          knuckle[1] + Math.sin(hookAngle) * 8 * s,
        ];
        pen(ctx, [[wristX, wristY], knuckle, clawTip], 1.25 * s, .88, true);
        pen(ctx, [knuckle, clawTip], .8 * s, .95);
      }
      const thumbAngle = baseAngle + Math.PI * 0.75 * (side > 0 ? -1 : 1);
      const thumbKnuckle = [
        wristX + Math.cos(thumbAngle) * 8 * s,
        wristY + Math.sin(thumbAngle) * 8 * s,
      ];
      const thumbTip = [
        thumbKnuckle[0] + Math.cos(thumbAngle - 0.4) * 6 * s,
        thumbKnuckle[1] + Math.sin(thumbAngle - 0.4) * 6 * s,
      ];
      pen(ctx, [[wristX, wristY], thumbKnuckle, thumbTip], 1.2 * s, .88, true);
    }
  }

  // 8. Regal Dragon Head (威严神骏之龙首)
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
    [hx - d * 12 * s, hy - 14 * s],
    crown,
    brow,
    noseTip,
    upperLip,
    mouthCorner,
    lowerJaw,
    chin,
    throat,
    [hx - d * 14 * s, hy + 12 * s],
  ];
  tint(ctx, headContour, color, .84, 1.2, seed + 1);
  outline(ctx, headContour, 1.7 * s, .88);

  // Upturned Nostril (朝天隆鼻与鼻孔)
  oval(ctx, hx + d * 44 * s, hy - 8 * s, 3.2 * s, 2.2 * s, P.dark, .9, false);

  // Sharp White Fangs & Teeth (上下獠牙利齿)
  pen(ctx, [[hx + d * 42 * s, hy + 1 * s], [hx + d * 44 * s, hy + 8 * s], [hx + d * 46 * s, hy + 1 * s]], 1.1 * s, .9, true);
  pen(ctx, [[hx + d * 28 * s, hy + 2 * s], [hx + d * 30 * s, hy + 7 * s], [hx + d * 32 * s, hy + 2 * s]], 1 * s, .9, true);
  pen(ctx, [[hx + d * 38 * s, hy + 16 * s], [hx + d * 40 * s, hy + 9 * s], [hx + d * 42 * s, hy + 16 * s]], 1.1 * s, .9, true);

  // Flaming Vermilion Tongue (朱砂吐珠龙舌)
  const tongue = [
    [hx + d * 26 * s, hy + 6 * s],
    [hx + d * 42 * s, hy + 8 * s],
    [hx + d * 56 * s, hy + 5 * s],
    [hx + d * 64 * s, hy + 12 * s],
  ];
  tint(ctx, tongue, P.red, .85, .5, seed + 4);
  pen(ctx, tongue, 1.6 * s, .85, true);

  // Dragon Eye & Arched Brow (怒目圆睁与突隆龙眉)
  pen(ctx, [
    [hx + d * 12 * s, hy - 12 * s],
    [hx + d * 22 * s, hy - 19 * s],
    [hx + d * 34 * s, hy - 13 * s],
  ], 2.8 * s, .9, true);
  oval(ctx, hx + d * 22 * s, hy - 10 * s, 4.2 * s, 3.4 * s, '#fff8e2', .95, true);
  oval(ctx, hx + d * (22 + 1.2) * s, hy - 10 * s, 2.1 * s, 2.4 * s, P.dark, .95, false);
  oval(ctx, hx + d * (22 + 0.6) * s, hy - 11 * s, 0.8 * s, 0.8 * s, '#ffffff', .9, false);

  // Branched Deer Antlers (雄浑双杈鹿角)
  for (const [hornRootX, hornRootY, spread] of [
    [hx + d * 4 * s, hy - 20 * s, 0],
    [hx + d * 12 * s, hy - 22 * s, 8 * s],
  ]) {
    const tip = [hx - d * (36 + spread) * s, hy - (58 + spread * 0.8) * s];
    const mid = [hx - d * (18 + spread * 0.5) * s, hy - (38 + spread * 0.4) * s];
    pen(ctx, [[hornRootX, hornRootY], mid, tip], 2.2 * s, .86, true);
    pen(ctx, [mid, [mid[0] + d * 8 * s, mid[1] - 18 * s]], 1.5 * s, .82, true);
    pen(ctx, [tip, [tip[0] - d * 14 * s, tip[1] + 8 * s]], 1.3 * s, .8, true);
  }

  // Flowing Long Whiskers & Beard (飘逸双长须与下颌龙髯)
  const whiskerOrigin = [hx + d * 46 * s, hy - 3 * s];
  pen(ctx, [
    whiskerOrigin,
    [hx + d * 70 * s, hy - 16 * s],
    [hx + d * 92 * s, hy - 4 * s],
    [hx + d * 82 * s, hy + 18 * s],
    [hx + d * 52 * s, hy + 38 * s],
    [hx + d * 28 * s, hy + 46 * s],
  ], 1.3 * s, .82, true);

  pen(ctx, [
    [hx + d * 42 * s, hy + 3 * s],
    [hx + d * 64 * s, hy + 15 * s],
    [hx + d * 78 * s, hy + 28 * s],
    [hx + d * 58 * s, hy + 44 * s],
  ], 1.1 * s, .75, true);

  for (let i = 0; i < 6; i++) {
    pen(ctx, [
      [hx + d * (24 + i * 4) * s, hy + 20 * s],
      [hx + d * (14 + i * 3) * s, hy + (36 + i * 3) * s],
      [hx - d * (4 - i * 3) * s, hy + (52 + i * 2) * s],
    ], 1.0 * s, .68, true);
  }

  // Cascading Mane (飞扬奔腾龙鬃)
  for (let i = 0; i < 9; i++) {
    const maneRoot = [hx - d * (6 + i * 4) * s, hy - (16 - i * 3) * s];
    const maneTip = [hx - d * (36 + i * 6) * s, hy - (34 - i * 2) * s];
    pen(ctx, [
      maneRoot,
      [maneRoot[0] - d * 18 * s, maneRoot[1] - 12 * s],
      maneTip,
    ], 1.4 * s, .78, true);
  }

  // 9. Sacred Flaming Pearl (赤金火焰神珠 / 游龙戏珠)
  if (s >= 0.34) {
    const pearlX = hx + d * (78 + (seed % 14)) * s;
    const pearlY = hy + (poseType === 1 ? 40 : -20) * s;
    const pearlRadius = 9.5 * s;

    oval(ctx, pearlX, pearlY, pearlRadius, pearlRadius, '#f6c744', .86, true);
    oval(ctx, pearlX, pearlY, pearlRadius * .65, pearlRadius * .65, '#fff5cb', .95, false);

    for (let f = 0; f < 4; f++) {
      const flameAngle = (f / 4) * Math.PI * 2 + (seed % 7) * 0.3;
      const fx = pearlX + Math.cos(flameAngle) * pearlRadius * 1.1;
      const fy = pearlY + Math.sin(flameAngle) * pearlRadius * 1.1;
      const flameTip = [
        pearlX + Math.cos(flameAngle + 0.6) * pearlRadius * 2.1,
        pearlY + Math.sin(flameAngle + 0.6) * pearlRadius * 2.1,
      ];
      pen(ctx, [[fx, fy], flameTip], 1.2 * s, .78, true);
      spiral(ctx, flameTip[0], flameTip[1], 3.8 * s, .6, .85 * s);
    }
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
