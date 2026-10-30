import test from 'node:test';
import assert from 'node:assert/strict';
import { createArrivalField, revealOpacity, REVEAL_DURATION } from '../forbidden-city/wash-reveal.js';
import { palace, faceColor, forbiddenCitySite, perspCam, orderScene } from '../forbidden-city/art.js';
import { dragon } from '../forbidden-city/drawing-motifs.js';

test('the same palace page produces a stable watercolour reveal', () => {
  const first = createArrivalField(2400, 1350, 80, 45, 23);
  const second = createArrivalField(2400, 1350, 80, 45, 23);
  const other = createArrivalField(2400, 1350, 80, 45, 24);
  assert.deepEqual(first, second);
  assert.notDeepEqual(first, other);
  assert.ok(first.every(Number.isFinite));
});

test('each watercolour pixel starts clear and finishes visible', () => {
  for (let page = 1; page <= 16; page++) {
    const field = createArrivalField(2400, 1350, 80, 45, 17 + page);
    assert.ok(field.every(arrival => revealOpacity(0, arrival) === 0));
    assert.ok(field.every(arrival => revealOpacity(REVEAL_DURATION, arrival) === 255));
    const middle = [...field].map(arrival => revealOpacity(.8, arrival));
    assert.ok(middle.some(value => value > 0));
    assert.ok(middle.some(value => value < 255));
  }
});

test('pigment never disappears while a page is unfolding', () => {
  const field = createArrivalField(2400, 1350, 32, 18);
  for (const arrival of field) {
    let previous = 0;
    for (let time = 0; time <= REVEAL_DURATION + .01; time += .1) {
      const opacity = revealOpacity(time, arrival);
      assert.ok(opacity >= previous && opacity <= 255);
      previous = opacity;
    }
  }
});

test('palace walls retain their red pigment and roofs respond to snow', () => {
  const building = palace(0, 0, 50, 26, 4, 9.2, 15, 'hip');
  const wall = building.faces.find(face => face.kind === 'wall');
  const roof = building.faces.find(face => face.kind === 'roof');
  const red = faceColor(building, wall, 'day'), gold = faceColor(building, roof, 'day');
  const snow = faceColor(building, roof, 'snow');
  assert.notDeepEqual(red, gold);
  assert.ok(red[0] > red[1] * 1.5);
  assert.ok(snow.every(channel => channel > 230));
  assert.notDeepEqual(snow, gold);
});

test('a double-eaved hall has two separate levels of roof geometry', () => {
  const single = palace(0, 0, 50, 26, 4, 9.2, 15, 'hip');
  const double = palace(0, 0, 50, 26, 4, 9.2, 15, 'hip', { double: true });
  const roofFaces = building => building.faces.filter(face => face.kind === 'roof');
  assert.ok(roofFaces(double).length > roofFaces(single).length);
  const levels = new Set(roofFaces(double).map(face => Math.min(...face.pts.map(point => point.y))));
  assert.ok(levels.size >= 2);
});

test('ground and water are painted behind buildings regardless of camera depth', () => {
  const objects = forbiddenCitySite();
  const camera = perspCam({ x: -320, y: 440, z: -650 }, { x: 0, y: 0, z: 0 }, 40, 1900, 1500);
  const ordered = orderScene(objects, camera);
  const firstBuilding = ordered.findIndex(item => item.ob.kind !== 'plane');
  assert.ok(firstBuilding > 0);
  assert.ok(ordered.slice(firstBuilding).every(item => item.ob.kind !== 'plane'));
  const solids = ordered.slice(firstBuilding);
  assert.ok(solids.slice(1).every((item, index) => item.d <= solids[index].d));
});

test('expanded palace geometry has only finite vertices in all three seasons', () => {
  for (const season of ['day', 'snow', 'sunset']) {
    const objects = forbiddenCitySite(season);
    assert.ok(objects.some(object => object.kind === 'urn'));
    for (const object of objects) for (const face of object.faces ?? []) {
      assert.ok(face.pts.length >= 3);
      assert.ok(face.pts.every(point => [point.x, point.y, point.z].every(Number.isFinite)));
    }
  }
});


test('imperial dragon motif renders ascending, descending and coiled postures cleanly', () => {
  const drawOps = [];
  const mockCtx = {
    beginPath: () => drawOps.push('begin'),
    moveTo: (x, y) => { assert.ok(Number.isFinite(x) && Number.isFinite(y)); drawOps.push('move'); },
    lineTo: (x, y) => { assert.ok(Number.isFinite(x) && Number.isFinite(y)); drawOps.push('line'); },
    quadraticCurveTo: () => {},
    bezierCurveTo: () => {},
    arc: (x, y, r) => { assert.ok(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(r)); },
    closePath: () => drawOps.push('close'),
    fill: () => drawOps.push('fill'),
    stroke: () => drawOps.push('stroke'),
    save: () => {},
    restore: () => {},
    setLineDash: () => {},
    translate: () => {},
    rotate: () => {},
    scale: () => {},
  };
  for (const seed of [1310, 1311, 1314]) {
    dragon(mockCtx, 600, 400, 0.58, '#d8b764', 1, seed);
  }
  assert.ok(drawOps.length > 500);
});
