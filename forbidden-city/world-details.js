import { rng, lerp } from './art.js?v=20261030-dragon2';
import { pen, tint, P } from './drawing-kit.js?v=20261030-dragon2';

const project = (camera, points) => points.map(point => camera.p(point)).filter(Boolean).map(point => [point.x, point.y]);
const point = (x, y, z) => ({ x, y, z });
function visible(face, camera) {
  const [a, b, c] = face.pts;
  const u = point(b.x - a.x, b.y - a.y, b.z - a.z), v = point(c.x - a.x, c.y - a.y, c.z - a.z);
  const n = point(u.y * v.z - u.z * v.y, u.z * v.x - u.x * v.z, u.x * v.y - u.y * v.x);
  return n.x * (camera.eye.x - a.x) + n.y * (camera.eye.y - a.y) + n.z * (camera.eye.z - a.z) > 0;
}
function clipped(ctx, camera, face, draw) {
  const poly = project(camera, face.pts);
  if (poly.length < 3) return;
  ctx.save(); ctx.beginPath(); ctx.moveTo(...poly[0]); poly.slice(1).forEach(p => ctx.lineTo(...p)); ctx.closePath(); ctx.clip(); draw(); ctx.restore();
}
function surfaceLine(ctx, camera, points, width = .9, alpha = .5) {
  const line = project(camera, points);
  if (line.length === points.length) pen(ctx, line, width, alpha);
}
function planeDetails(ctx, object, camera) {
  const face = object.faces[0], x0 = Math.min(...face.pts.map(p => p.x)), x1 = Math.max(...face.pts.map(p => p.x));
  const z0 = Math.min(...face.pts.map(p => p.z)), z1 = Math.max(...face.pts.map(p => p.z)), y = face.pts[0].y + .01;
  clipped(ctx, camera, face, () => {
    if (['water', 'moat'].includes(face.kind)) {
      const random = rng(Math.round(x0 * 7 + z0 * 11));
      for (let i = 0; i < 65; i++) {
        const x = lerp(x0, x1, random()), z = lerp(z0, z1, random());
        surfaceLine(ctx, camera, [point(x, y, z), point(x + 2 + random() * 4, y, z)], .7, .3);
      }
    } else {
      for (let x = x0; x < x1; x += 6) surfaceLine(ctx, camera, [point(x, y, z0), point(x, y, z1)], .65, .14);
      for (let z = z0; z < z1; z += 5) surfaceLine(ctx, camera, [point(x0, y, z), point(x1, y, z)], .65, .14);
    }
  });
}
function palaceDetails(ctx, object, camera, season) {
  for (const face of object.faces) {
    if (!visible(face, camera)) continue;
    if (face.kind === 'wall') clipped(ctx, camera, face, () => {
      const xs = face.pts.map(p => p.x), zs = face.pts.map(p => p.z), ys = face.pts.map(p => p.y);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      const isFront = x1 - x0 > z1 - z0;
      const at = (u, v) => point(isFront ? lerp(x0, x1, u) : x0, lerp(y0, y1, v), isFront ? z0 : lerp(z0, z1, u));
      const bays = Math.max(3, Math.min(11, Math.round((isFront ? object.o.w : object.o.d) / 4.8)));
      const top = object.o.double ? .56 : .78;
      for (let i = 0; i < bays; i++) {
        const a = (i + .17) / bays, b = (i + .83) / bays;
        const window = project(camera, [at(a, .16), at(b, .16), at(b, top), at(a, top)]);
        tint(ctx, window, '#526b5e', .57, .25);
        pen(ctx, [...window, window[0]], .9, .76);
        for (let k = 1; k < 4; k++) {
          surfaceLine(ctx, camera, [at(lerp(a, b, k / 4), .16), at(lerp(a, b, k / 4), top)], .6, .65);
          surfaceLine(ctx, camera, [at(a, lerp(.16, top, k / 4)), at(b, lerp(.16, top, k / 4))], .6, .65);
        }
        surfaceLine(ctx, camera, [at(i / bays, 0), at(i / bays, top + .12)], 1.8, .78);
      }
      tint(ctx, project(camera, [at(0, top + .05), at(1, top + .05), at(1, top + .13), at(0, top + .13)]), P.blue, .6, .25);
      for (let i = 0; i <= bays; i++) surfaceLine(ctx, camera, [at(i / bays - .02, top + .13), at(i / bays, top + .04), at(i / bays + .02, top + .13)], 1, .75);
    });
    if (face.kind === 'roof') clipped(ctx, camera, face, () => {
      const minY = Math.min(...face.pts.map(p => p.y)), maxY = Math.max(...face.pts.map(p => p.y));
      const eaves = face.pts.filter(p => Math.abs(p.y - minY) < .01), ridge = face.pts.filter(p => Math.abs(p.y - maxY) < .01);
      if (eaves.length !== 2 || !ridge.length) return;
      const span = p => p.x + p.z * .02;
      eaves.sort((a, b) => span(a) - span(b)); ridge.sort((a, b) => span(a) - span(b));
      const mix = (a, b, u) => point(lerp(a.x, b.x, u), lerp(a.y, b.y, u), lerp(a.z, b.z, u));
      for (let i = 0; i <= 35; i++) {
        const u = i / 35, a = mix(eaves[0], eaves[1], u), b = mix(ridge[0], ridge.at(-1), u);
        surfaceLine(ctx, camera, [a, mix(a, b, .45), b], .75, season === 'snow' ? .22 : .43);
      }
      for (let i = 1; i < 5; i++) {
        const u = i / 5;
        surfaceLine(ctx, camera, [mix(eaves[0], ridge[0], u), mix(eaves[1], ridge.at(-1), u)], .6, .3);
      }
    });
  }
}
function stoneDetails(ctx, object, camera) {
  const { w, d } = object.fp;
  if (!w || !d) return;
  const y = object.y1, posts = Math.min(22, Math.max(4, Math.round(w / 3.5)));
  for (const z of [object.cz - d / 2, object.cz + d / 2]) {
    for (let i = 0; i <= posts; i++) {
      const x = object.cx - w / 2 + w * i / posts;
      surfaceLine(ctx, camera, [point(x, y, z), point(x, y + 1.2, z)], 1.1, .65);
    }
    surfaceLine(ctx, camera, [point(object.cx - w / 2, y + 1, z), point(object.cx + w / 2, y + 1, z)], .85, .6);
    surfaceLine(ctx, camera, [point(object.cx - w / 2, y + .55, z), point(object.cx + w / 2, y + .55, z)], .6, .5);
  }
  if (w > 40 && d > 20) for (let i = 0; i < 10; i++) {
    const z = object.cz - d / 2 - i * .35;
    surfaceLine(ctx, camera, [point(object.cx - 4, y * (1 - i / 10), z), point(object.cx + 4, y * (1 - i / 10), z)], .7, .6);
  }
}
export function drawWorldDetails(ctx, object, camera, { season }) {
  if (object.kind === 'plane') { planeDetails(ctx, object, camera); return; }
  if (object.kind === 'palace') { palaceDetails(ctx, object, camera, season); return; }
  if (object.kind === 'plinth') { stoneDetails(ctx, object, camera); return; }
  if (object.kind === 'bridge') {
    for (const side of [-1, 1]) {
      const points = [];
      for (let i = 0; i <= 9; i++) {
        const u = i / 9, z = object.cz + (u - .5) * object.fp.d, y = .35 + Math.sin(u * Math.PI) * (object.y1 - .8);
        const x = object.cx + side * object.fp.w / 2;
        surfaceLine(ctx, camera, [point(x, y, z), point(x, y + 1.3, z)], 1.1, .7);
        points.push(point(x, y + 1.1, z));
      }
      surfaceLine(ctx, camera, points, .95, .68);
    }
  }
  if (object.kind === 'cypress') {
    const { cx, cz, h } = object.trunk;
    for (let i = 0; i < 6; i++) {
      const x = cx + (i - 2.5) * .11;
      surfaceLine(ctx, camera, [point(x, .1, cz), point(x + .17 * Math.sin(i), h * .5, cz), point(x, h, cz)], .65, .55);
    }
  }
  if (object.kind === 'wall' && object.fp && Math.max(object.fp.w, object.fp.d) > 60) {
    for (const face of object.faces) if (face.kind === 'wall' && visible(face, camera)) clipped(ctx, camera, face, () => {
      const x0 = Math.min(...face.pts.map(p => p.x)), x1 = Math.max(...face.pts.map(p => p.x));
      const z0 = Math.min(...face.pts.map(p => p.z)), z1 = Math.max(...face.pts.map(p => p.z));
      const y0 = Math.min(...face.pts.map(p => p.y)), y1 = Math.max(...face.pts.map(p => p.y));
      for (let y = y0 + .55; y < y1; y += .55) surfaceLine(ctx, camera, [point(x0, y, z0), point(x1, y, z1)], .55, .25);
    });
  }
}
