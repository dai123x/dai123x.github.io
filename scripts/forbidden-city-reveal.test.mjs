import test from 'node:test';
import assert from 'node:assert/strict';
import { createArrivalField, revealOpacity, REVEAL_DURATION } from '../forbidden-city/wash-reveal.js';

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
