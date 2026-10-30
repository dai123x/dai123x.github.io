import { capturePlate, drawPen, handwrite, sealStamp, clamp, ss, fbm } from './art.js?v=20261030-official-beasts';
import { decoratePlate } from './plate-details.js?v=20261030-official-beasts';

export const REVEAL_DURATION = 3.2;

// Like the supplied reference's arrival field, every pixel receives pigment at a
// deterministic time. A small mask is enough; the finished drawing stays sharp.
export function createArrivalField(width, height, columns = 240, rows = 135, seed = 17) {
  const field = new Float32Array(columns * rows);
  const sources = [
    { x: width * .38, y: height * .56, time: .35 },
    { x: width * .74, y: height * .39, time: .61 },
  ];
  for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
    const px = (x + .5) / columns * width, py = (y + .5) / rows * height;
    const noise = (fbm(px * .003, py * .003, seed, 3) - .5) * .38;
    field[y * columns + x] = Math.max(.12, Math.min(...sources.map(source => source.time + Math.hypot(px - source.x, (py - source.y) * 1.1) / (width * .55))) + noise);
  }
  return field;
}

export function revealOpacity(time, arrival) {
  return Math.round(255 * ss(clamp((time - arrival) / .22)));
}

function surface(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  return canvas;
}

export function preparePlate(page) {
  const layers = capturePlate(page, decoratePlate);
  const width = layers.color.width, height = layers.color.height;
  const mask = surface(240, 135);
  return {
    ...layers,
    surface: surface(width, height),
    ink: surface(width, height),
    mask,
    maskPixels: mask.getContext('2d').createImageData(mask.width, mask.height),
    field: createArrivalField(width, height, mask.width, mask.height, 17 + page),
    lastTime: -1,
  };
}

export function resetPlate(plate) {
  plate.ink.getContext('2d').clearRect(0, 0, plate.ink.width, plate.ink.height);
  for (const stroke of plate.strokes) stroke.complete = false;
  plate.lastTime = -1;
}

export function renderPlate(plate, elapsed) {
  const time = Math.min(REVEAL_DURATION, Math.max(0, elapsed));
  if (time === plate.lastTime) return plate.surface;
  if (time < plate.lastTime) resetPlate(plate);
  const output = plate.surface.getContext('2d');
  const ink = plate.ink.getContext('2d');
  const pixels = plate.maskPixels.data;
  for (let i = 0; i < plate.field.length; i++) {
    pixels[i * 4] = pixels[i * 4 + 1] = pixels[i * 4 + 2] = 255;
    pixels[i * 4 + 3] = revealOpacity(time, plate.field[i]);
  }
  plate.mask.getContext('2d').putImageData(plate.maskPixels, 0, 0);
  output.clearRect(0, 0, plate.surface.width, plate.surface.height);
  output.globalCompositeOperation = 'source-over';
  output.drawImage(plate.color, 0, 0);
  output.globalCompositeOperation = 'destination-in';
  output.drawImage(plate.mask, 0, 0, plate.surface.width, plate.surface.height);
  output.globalCompositeOperation = 'source-over';
  const active = [];
  for (const [index, stroke] of plate.strokes.entries()) {
    if (stroke.complete) continue;
    const start = .05 + index / Math.max(1, plate.strokes.length) * 1.55;
    const duration = clamp(stroke.st.L / 1500, .07, .65);
    const progress = clamp((time - start) / duration);
    if (progress >= 1) {
      drawPen(ink, stroke.st, 1, stroke.col, stroke.alpha);
      stroke.complete = true;
    } else if (progress > 0) active.push({ stroke, progress });
  }
  output.drawImage(plate.ink, 0, 0);
  for (const { stroke, progress } of active) drawPen(output, stroke.st, progress, stroke.col, stroke.alpha);
  plate.texts.forEach(({ tx }, index) => handwrite(output, tx, clamp((time - 1.15 - index * .04) / .85)));
  plate.seals.forEach(({ text, x, y, size, o }, index) => sealStamp(output, text, x, y, size, { ...o, p: clamp((time - 2.1 - index * .1) / .4) }));
  plate.lastTime = time;
  return plate.surface;
}
