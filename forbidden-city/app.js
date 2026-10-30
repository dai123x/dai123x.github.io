import {
  clamp, lerp, ss, TAU, perspCam, forbiddenCitySite, renderScene,
  palaceSound,
} from './art.js?v=20261030-official-beasts';
import { SPOTS } from './spots.js?v=20261030-official-beasts';
import { preparePlate, renderPlate, resetPlate, REVEAL_DURATION } from './wash-reveal.js?v=20261030-official-beasts';
import { routeMap } from './map-art.js?v=20261030-official-beasts';
import { drawWorldDetails } from './world-details.js?v=20261030-official-beasts';

const $ = id => document.getElementById(id);
const canvas = $('c');
const ctx = canvas.getContext('2d');
const stage = $('stage');
const directory = $('directory');
const search = $('spot-search');
const help = $('help-dialog');
const narrow = matchMedia('(max-width: 960px)');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const spots = SPOTS.map(spot => ({ ...spot, wx: 0, wy: 0 }));
const tourSpots = ['wumen', 'jinshui', 'taihemen', 'taihedian', 'zhonghedian', 'baohedian', 'qianqinggong', 'jiaotaidian', 'yuhuayuan']
  .map(id => spots.find(spot => spot.id === id));
const seasons = ['day', 'snow', 'sunset'];
const seasonNames = { day: '晴日金碧', snow: '雪霁紫禁', sunset: '暮霞沉金' };
const seasonSymbols = { day: '☼', snow: '❄', sunset: '◐' };
const state = { mode: 'world', season: 'day', spot: null, tour: false, tourIndex: 0, directoryOpen: false };
const view = { x: 0, y: 0, zoom: 1 };
const flat = { zoom: 1, x: 0, y: 0 };
const world = document.createElement('canvas');
const plateCache = new Map();
const pointers = new Map();
const spotButtons = new Map();
let worldBounds;
let mapImage;
let plateImage;
let width = 0, height = 0, dpr = 1, homeScale = 1;
let origin = { x: 0, y: 0 };
let hover = null;
let transition = null;
let pendingFrame = 0;
let tourTimer;
let gesture = null;
let flatRect;
let returnFocus;
let ready = false;
let portraitArtwork = false;
let worldQuality = 0;
let plateStarted = 0;
let returnPaper = 0;

function announce(message) {
  $('live-status').textContent = message;
  $('current-status').textContent = message;
}

function requestRender() {
  if (!pendingFrame && !document.hidden) pendingFrame = requestAnimationFrame(render);
}

function buildWorld() {
  // A fixed artwork surface is reused across viewport changes; only its fit changes.
  const quality = narrow.matches ? 1 : 1.45;
  worldQuality = quality;
  world.width = Math.round(1900 * quality);
  world.height = Math.round(1500 * quality);
  portraitArtwork = narrow.matches && width < 600 && height > width;
  const eye = portraitArtwork ? { x: -60, y: 900, z: -280 } : { x: -320, y: 440, z: -650 };
  const camera = perspCam(eye, { x: 0, y: 0, z: 0 }, 40, 1900, 1500);
  const objects = forbiddenCitySite(state.season);
  const worldContext = world.getContext('2d');
  worldContext.setTransform(quality, 0, 0, quality, 0, 0);
  renderScene(worldContext, objects, camera, 999, 1900, 1500, { season: state.season, detail: drawWorldDetails });
  const projected = objects.flatMap(object => (object.faces ?? []).flatMap(face => face.pts.map(point => camera.p(point)))).filter(Boolean);
  worldBounds = {
    left: Math.min(...projected.map(point => point.x)) - 25,
    right: Math.max(...projected.map(point => point.x)) + 25,
    top: Math.min(...projected.map(point => point.y)) - 25,
    bottom: Math.max(...projected.map(point => point.y)) + 25,
  };
  for (const spot of spots) {
    const point = camera.p({ x: spot.x, y: spot.y, z: spot.z });
    spot.wx = point.x;
    spot.wy = point.y;
  }
  fitWorld();
}

function fitWorld() {
  if (!worldBounds || !width || !height) return;
  const top = height < 400 ? 88 : 138;
  const bottom = narrow.matches ? 117 : 88;
  const room = Math.max(110, height - top - bottom);
  homeScale = Math.min((width - (narrow.matches ? 32 : 60)) / (worldBounds.right - worldBounds.left), room / (worldBounds.bottom - worldBounds.top));
  origin = { x: width / 2, y: top + room / 2 };
  if (view.zoom === 1 && !transition) resetWorld();
}

function resetWorld() {
  view.x = (worldBounds.left + worldBounds.right) / 2;
  view.y = (worldBounds.top + worldBounds.bottom) / 2;
  view.zoom = 1;
}

function resize() {
  const rect = stage.getBoundingClientRect();
  const nextWidth = Math.round(rect.width), nextHeight = Math.round(rect.height);
  const nextDpr = Math.min(devicePixelRatio || 1, 1.75);
  if (width === nextWidth && height === nextHeight && dpr === nextDpr) return;
  width = nextWidth;
  height = nextHeight;
  dpr = nextDpr;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  if (ready && (portraitArtwork !== (narrow.matches && width < 600 && height > width) || worldQuality !== (narrow.matches ? 1 : 1.45))) {
    view.zoom = 1;
    buildWorld();
  } else fitWorld();
  flatRect = null;
  flat.x = flat.y = 0;
  requestRender();
}

function pointForSpot(spot) {
  const scale = homeScale * view.zoom;
  return { x: (spot.wx - view.x) * scale + origin.x, y: (spot.wy - view.y) * scale + origin.y };
}

function markerRadius() { return narrow.matches ? 10 : 12; }

function drawWorld() {
  const scale = homeScale * view.zoom;
  ctx.save();
  ctx.translate(origin.x, origin.y);
  ctx.scale(scale, scale);
  ctx.translate(-view.x, -view.y);
  ctx.drawImage(world, 0, 0, 1900, 1500);
  ctx.restore();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  spots.forEach((spot, index) => {
    const point = pointForSpot(spot);
    if (point.x < -25 || point.y < -25 || point.x > width + 25 || point.y > height + 25) return;
    const active = hover === spot;
    ctx.beginPath();
    ctx.arc(point.x, point.y, markerRadius() + (active ? 3 : 0), 0, TAU);
    ctx.fillStyle = active ? '#963f32' : '#fffaf0';
    ctx.fill();
    ctx.strokeStyle = active ? '#752d24' : '#a9604a';
    ctx.lineWidth = active ? 1.8 : 1;
    ctx.stroke();
    ctx.fillStyle = active ? '#fffaf0' : '#843c2c';
    ctx.font = `${narrow.matches ? 10 : 11}px Georgia, serif`;
    ctx.fillText(String(index + 1), point.x, point.y + .5);
  });
}

function imageArea() {
  if (state.mode === 'plate') {
    const cardHeight = $('reading').getBoundingClientRect().height;
    return { x: 20, y: 75, width: Math.max(40, width - 40), height: Math.max(50, height - cardHeight - (narrow.matches ? 114 : 130)) };
  }
  return { x: 20, y: height < 400 ? 80 : 128, width: Math.max(40, width - 40), height: Math.max(80, height - (height < 400 ? 136 : 244)) };
}

function drawFlat(image) {
  const area = imageArea();
  const scale = Math.min(area.width / image.width, area.height / image.height) * flat.zoom;
  const w = image.width * scale, h = image.height * scale;
  flat.x = clamp(flat.x, -Math.max(0, (w - area.width) / 2), Math.max(0, (w - area.width) / 2));
  flat.y = clamp(flat.y, -Math.max(0, (h - area.height) / 2), Math.max(0, (h - area.height) / 2));
  flatRect = { x: area.x + area.width / 2 + flat.x, y: area.y + area.height / 2 + flat.y, width: w, height: h };
  ctx.save();
  ctx.beginPath();
  ctx.rect(area.x, area.y, area.width, area.height);
  ctx.clip();
  ctx.drawImage(image, flatRect.x - w / 2, flatRect.y - h / 2, w, h);
  ctx.restore();
}

function render(now) {
  pendingFrame = 0;
  if (!ready || !ctx || !width || !height) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#f5eede';
  ctx.fillRect(0, 0, width, height);
  if (transition) {
    const tween = transition;
    const progress = clamp((now - tween.started) / tween.duration);
    const eased = ss(progress);
    view.x = lerp(tween.from.x, tween.to.x, eased);
    view.y = lerp(tween.from.y, tween.to.y, eased);
    view.zoom = lerp(tween.from.zoom, tween.to.zoom, eased);
    drawWorld();
    const paperAmount = ss(clamp((progress - .55) / .45));
    ctx.fillStyle = `rgba(245,238,222,${paperAmount})`;
    ctx.fillRect(0, 0, width, height);
    if (progress >= 1) {
      transition = null;
      showPlate();
    }
    requestRender();
    return;
  }
  if (state.mode === 'map') drawFlat(mapImage);
  else if (state.mode === 'plate') {
    const elapsed = reducedMotion.matches ? REVEAL_DURATION : (now - plateStarted) / 1000;
    drawFlat(renderPlate(plateImage, elapsed));
    if (elapsed < REVEAL_DURATION) requestRender();
  }
  else drawWorld();
  if (returnPaper) {
    const progress = clamp((now - returnPaper) / 450);
    ctx.fillStyle = `rgba(245,238,222,${1 - ss(progress)})`;
    ctx.fillRect(0, 0, width, height);
    if (progress < 1) requestRender();
    else returnPaper = 0;
  }
  updateZoomButtons();
}

function setHash(value) {
  const next = value ? `#${value}` : location.pathname + location.search;
  if (location.hash !== (value ? `#${value}` : '')) history.replaceState(null, '', next);
}

function syncUI() {
  stage.dataset.mode = state.mode;
  $('back').hidden = state.mode === 'world';
  $('reading').hidden = state.mode !== 'plate';
  $('hover-label').hidden = true;
  $('hint').hidden = state.mode === 'plate' || state.mode === 'fly';
  $('zoom-controls').hidden = state.mode === 'fly';
  $('hint').textContent = state.mode === 'map'
    ? '滚轮或双指放大舆图 · 放大后拖拽查看 · Esc 返回全景'
    : narrow.matches ? '轻触编号看一景 · 双指缩放 · 下方目录可直达十六景' : '点选编号，翻阅一景 · 拖拽移动 · 滚轮缩放';
  $('stage-title').textContent = state.mode === 'map' ? '宫城经纬，尽在一卷。' : '一城宫阙，一卷光阴。';
  $('stage-lead').textContent = state.mode === 'map' ? '从中轴到东西宫苑，循着舆图辨认宫城。' : '循中轴，过红墙。在十六景里，慢慢读紫禁城。';
  for (const id of ['world-btn', 'mobile-world']) $(id).setAttribute('aria-pressed', String(state.mode === 'world'));
  for (const id of ['route-btn', 'mobile-map']) $(id).setAttribute('aria-pressed', String(state.mode === 'map'));
  for (const [id, button] of spotButtons) {
    if (id === state.spot?.id) button.setAttribute('aria-current', 'true');
    else button.removeAttribute('aria-current');
  }
  $('tour-btn').setAttribute('aria-pressed', String(state.tour));
  $('tour-btn').setAttribute('aria-label', state.tour ? '暂停中轴漫游' : '开始中轴漫游');
  $('tour-label').textContent = state.tour ? '暂停漫游' : '中轴漫游';
  $('tour-icon').textContent = state.tour ? 'Ⅱ' : '▷';
  $('tour-status').hidden = !state.tour;
  if (state.tour) {
    $('tour-step').textContent = `中轴巡礼 ${state.tourIndex + 1} / ${tourSpots.length}`;
    $('tour-progress').value = state.tourIndex + 1;
  }
  canvas.setAttribute('aria-label', state.mode === 'plate'
    ? `${state.spot.title}水墨册页。可用左右方向键翻阅。`
    : state.mode === 'map' ? '紫禁城平面舆图，可用加减按钮放大查看。' : '紫禁城水墨全景。可点击编号或使用景点目录探索十六景。');
  requestRender();
}

function stopTour() {
  clearTimeout(tourTimer);
  tourTimer = undefined;
  state.tour = false;
  syncUI();
}

function resetFlat() {
  flat.zoom = 1;
  flat.x = flat.y = 0;
  flatRect = null;
}

function getPlate(spot) {
  if (plateCache.has(spot.id)) return plateCache.get(spot.id);
  const image = preparePlate(spot.page);
  plateCache.set(spot.id, image);
  if (plateCache.size > 2) plateCache.delete(plateCache.keys().next().value);
  return image;
}

function showPlate() {
  state.mode = 'plate';
  plateImage = getPlate(state.spot);
  resetPlate(plateImage);
  plateStarted = performance.now();
  resetFlat();
  const index = spots.indexOf(state.spot);
  $('reading-title').textContent = state.spot.title;
  $('reading-line').textContent = state.spot.line;
  $('reading-number').textContent = `第 ${String(index + 1).padStart(2, '0')} 景 / 共十六景`;
  $('reading-category').textContent = tourSpots.includes(state.spot) ? '中轴巡礼' : '宫城拾趣';
  $('reading-counter').textContent = `${String(index + 1).padStart(2, '0')} / 16`;
  announce(`正在阅览：${state.spot.name}`);
  syncUI();
  if (state.tour) {
    tourTimer = setTimeout(() => {
      if (!state.tour) return;
      if (state.tourIndex === tourSpots.length - 1) {
        stopTour();
        announce('中轴九景巡礼已完成，可继续自由翻阅。');
      } else {
        state.tourIndex++;
        visit(tourSpots[state.tourIndex], true);
      }
    }, 5200);
  }
}

function visit(spot, fromTour = false, updateHash = true) {
  if (!spot) return;
  if (!fromTour) stopTour();
  clearTimeout(tourTimer);
  const fly = state.mode === 'world' && !reducedMotion.matches;
  transition = null;
  returnPaper = 0;
  hover = null;
  setDirectoryOpen(false);
  state.spot = spot;
  if (updateHash) setHash(spot.id);
  if (fly) {
    state.mode = 'fly';
    transition = {
      from: { x: view.x, y: view.y, zoom: view.zoom },
      to: { x: spot.wx, y: spot.wy, zoom: 2.4 },
      started: performance.now(), duration: 650,
    };
    syncUI();
  } else showPlate();
  palaceSound.playChime(880, 2, .04);
}

function showWorld(updateHash = true) {
  const returning = state.mode === 'plate' || state.mode === 'fly';
  stopTour();
  transition = null;
  state.mode = 'world';
  state.spot = null;
  hover = null;
  setDirectoryOpen(false);
  resetWorld();
  returnPaper = returning && !reducedMotion.matches ? performance.now() : 0;
  if (updateHash) setHash('');
  announce('紫禁城全景 · 可探索十六景');
  syncUI();
}

function showMap(updateHash = true) {
  stopTour();
  transition = null;
  returnPaper = 0;
  state.mode = 'map';
  state.spot = null;
  hover = null;
  setDirectoryOpen(false);
  if (!mapImage) mapImage = routeMap();
  resetFlat();
  if (updateHash) setHash('map');
  announce('正在阅览：紫禁城全域舆图');
  syncUI();
}

function stepSpot(direction) {
  if (state.mode !== 'plate') return;
  const index = spots.indexOf(state.spot);
  visit(spots[(index + direction + spots.length) % spots.length]);
}

function toggleTour() {
  if (state.tour) { stopTour(); announce('漫游已暂停，可自由翻阅。'); return; }
  transition = null;
  state.tour = true;
  state.tourIndex = 0;
  visit(tourSpots[0], true);
}

function toggleAudio() {
  const on = palaceSound.toggle();
  $('audio-btn').setAttribute('aria-pressed', String(on));
  $('audio-btn').setAttribute('aria-label', on ? '关闭雅乐风铃' : '开启雅乐风铃');
  $('audio-label').textContent = on ? '风铃已开' : '雅乐风铃';
  if (!palaceSound.ctx) announce('当前浏览器暂不支持风铃音效。');
}

function cycleSeason() {
  state.season = seasons[(seasons.indexOf(state.season) + 1) % seasons.length];
  $('season-label').textContent = seasonNames[state.season];
  $('season-icon').textContent = seasonSymbols[state.season];
  $('season-btn').setAttribute('aria-label', `当前${seasonNames[state.season]}，点击切换光影`);
  buildWorld();
  announce(`光影已切换为${seasonNames[state.season]}`);
  requestRender();
}

function renderDirectory() {
  for (const [index, spot] of spots.entries()) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'spot-button';
    button.dataset.spot = spot.id;
    button.innerHTML = `<span class="spot-number">${String(index + 1).padStart(2, '0')}</span><span class="spot-copy"><span class="spot-name">${spot.name}</span><span class="spot-subtitle">${spot.title.split(' · ')[1]}</span></span><span class="spot-arrow" aria-hidden="true">↗</span>`;
    button.setAttribute('aria-label', `第${index + 1}景，${spot.title}`);
    button.addEventListener('click', () => {
      visit(spot);
      canvas.focus({ preventScroll: true });
    });
    button.addEventListener('pointerenter', () => { if (state.mode === 'world') setHover(spot); });
    button.addEventListener('pointerleave', () => setHover(null));
    button.addEventListener('focus', () => { if (state.mode === 'world') setHover(spot); });
    button.addEventListener('blur', () => setHover(null));
    item.appendChild(button);
    $('legend').appendChild(item);
    spotButtons.set(spot.id, button);
  }
}

function filterDirectory() {
  const query = search.value.trim().toLowerCase().replace(/\s+/g, '');
  let count = 0;
  for (const spot of spots) {
    const matches = (spot.title + spot.name + spot.line).toLowerCase().includes(query);
    spotButtons.get(spot.id).parentElement.hidden = !matches;
    if (matches) count++;
  }
  $('result-count').textContent = query ? `找到 ${count} 景` : '十六景 · 点击翻阅';
  $('empty-results').hidden = count > 0;
  $('clear-search').hidden = !search.value;
}

function setDirectoryOpen(open) {
  if (narrow.matches && open && state.tour) stopTour();
  state.directoryOpen = narrow.matches && open;
  directory.classList.toggle('is-open', state.directoryOpen);
  $('directory-scrim').hidden = !state.directoryOpen;
  $('directory-toggle').setAttribute('aria-expanded', String(state.directoryOpen));
  stage.inert = state.directoryOpen;
  $('masthead').inert = state.directoryOpen;
  if (state.directoryOpen) {
    directory.setAttribute('role', 'dialog');
    directory.setAttribute('aria-modal', 'true');
    directory.setAttribute('aria-labelledby', 'directory-heading');
    $('directory-close').focus({ preventScroll: true });
  } else {
    directory.removeAttribute('role');
    directory.removeAttribute('aria-modal');
    directory.removeAttribute('aria-labelledby');
    if (narrow.matches && directory.contains(document.activeElement)) $('directory-toggle').focus({ preventScroll: true });
  }
}

function setHover(spot) {
  if (hover === spot) return;
  hover = spot;
  $('hover-label').hidden = !spot;
  if (spot && state.mode === 'world' && !state.directoryOpen) {
    const point = pointForSpot(spot);
    $('hover-label').textContent = spot.name;
    $('hover-label').style.left = `${clamp(point.x + 18, 8, Math.max(8, width - 145))}px`;
    $('hover-label').style.top = `${clamp(point.y - 34, 8, Math.max(8, height - 40))}px`;
  }
  canvas.style.cursor = spot ? 'pointer' : 'grab';
  requestRender();
}

function hitTest(point) {
  let found = null, nearest = narrow.matches ? 23 : 24;
  for (const spot of spots) {
    const screen = pointForSpot(spot);
    const distance = Math.hypot(screen.x - point.x, screen.y - point.y);
    if (distance < nearest) { found = spot; nearest = distance; }
  }
  return found;
}

function localPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function zoomAt(factor, x = origin.x, y = origin.y) {
  if (state.mode === 'fly') return;
  if (state.mode === 'world') {
    const oldScale = homeScale * view.zoom;
    const zoom = clamp(view.zoom * factor, .75, 4.5);
    const newScale = homeScale * zoom;
    view.x += (x - origin.x) * (1 / oldScale - 1 / newScale);
    view.y += (y - origin.y) * (1 / oldScale - 1 / newScale);
    view.zoom = zoom;
  } else {
    const oldZoom = flat.zoom;
    flat.zoom = clamp(flat.zoom * factor, 1, 5);
    if (flatRect) {
      flat.x += (x - flatRect.x) * (1 - flat.zoom / oldZoom);
      flat.y += (y - flatRect.y) * (1 - flat.zoom / oldZoom);
    }
  }
  setHover(null);
  requestRender();
}

function updateZoomButtons() {
  const zoom = state.mode === 'world' ? view.zoom : flat.zoom;
  $('zoom-in').disabled = zoom >= (state.mode === 'world' ? 4.5 : 5) - .001;
  $('zoom-out').disabled = zoom <= (state.mode === 'world' ? .75 : 1) + .001;
}

function pinchMetrics() {
  const [first, second] = [...pointers.values()];
  return { distance: Math.hypot(first.x - second.x, first.y - second.y), x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}

canvas.addEventListener('pointerdown', event => {
  if (state.mode === 'fly' || !ready || (event.pointerType === 'mouse' && event.button !== 0)) return;
  const point = localPoint(event);
  canvas.setPointerCapture(event.pointerId);
  pointers.set(event.pointerId, point);
  setHover(null);
  if (pointers.size === 1) gesture = { start: point, last: point, moved: false, multi: false };
  else {
    gesture.multi = true;
    gesture.pinch = pinchMetrics();
  }
});

canvas.addEventListener('pointermove', event => {
  const point = localPoint(event);
  if (!pointers.has(event.pointerId)) {
    if (state.mode === 'world' && event.pointerType !== 'touch') setHover(hitTest(point));
    return;
  }
  pointers.set(event.pointerId, point);
  if (pointers.size >= 2) {
    const metrics = pinchMetrics();
    if (gesture.pinch?.distance > 0) zoomAt(metrics.distance / gesture.pinch.distance, metrics.x, metrics.y);
    gesture.pinch = metrics;
    return;
  }
  if (gesture.multi) return;
  if (Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y) > 6) gesture.moved = true;
  if (!gesture.moved) return;
  const dx = point.x - gesture.last.x, dy = point.y - gesture.last.y;
  if (state.mode === 'world') {
    view.x -= dx / (homeScale * view.zoom);
    view.y -= dy / (homeScale * view.zoom);
    view.x = clamp(view.x, worldBounds.left, worldBounds.right);
    view.y = clamp(view.y, worldBounds.top, worldBounds.bottom);
  } else {
    flat.x += dx;
    flat.y += dy;
  }
  gesture.last = point;
  canvas.style.cursor = 'grabbing';
  requestRender();
});

function finishPointer(event, canceled = false) {
  if (!pointers.has(event.pointerId)) return;
  const point = localPoint(event);
  const tap = !canceled && !gesture.moved && !gesture.multi && Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y) <= 6;
  pointers.delete(event.pointerId);
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  if (!pointers.size) {
    gesture = null;
    canvas.style.cursor = 'grab';
    if (tap && state.mode === 'world') visit(hitTest(point));
  }
}
canvas.addEventListener('pointerup', event => finishPointer(event));
canvas.addEventListener('pointercancel', event => finishPointer(event, true));
canvas.addEventListener('lostpointercapture', event => {
  if (pointers.has(event.pointerId)) {
    pointers.delete(event.pointerId);
    if (!pointers.size) gesture = null;
  }
});
canvas.addEventListener('pointerleave', () => { if (!pointers.size) setHover(null); });
canvas.addEventListener('wheel', event => {
  event.preventDefault();
  const point = localPoint(event);
  zoomAt(Math.exp(-clamp(event.deltaY, -100, 100) * .002), point.x, point.y);
}, { passive: false });

$('zoom-in').addEventListener('click', () => zoomAt(1.25));
$('zoom-out').addEventListener('click', () => zoomAt(.8));
$('reset-view').addEventListener('click', () => { resetWorld(); resetFlat(); setHover(null); requestRender(); });
$('back').addEventListener('click', () => showWorld());
for (const id of ['world-btn', 'mobile-world']) $(id).addEventListener('click', () => showWorld());
for (const id of ['route-btn', 'mobile-map']) $(id).addEventListener('click', () => showMap());
$('previous-spot').addEventListener('click', () => stepSpot(-1));
$('next-spot').addEventListener('click', () => stepSpot(1));
$('detail-plate').addEventListener('click', () => {
  if (state.mode !== 'plate') return;
  const focus = {
    wumen: [1290, 510, 2.3], jinshui: [1270, 1000, 2.4], wuying: [710, 840, 3],
    wenhua: [1260, 560, 2.1], taihemen: [730, 930, 2.8], taihedian: [1300, 580, 2.3],
    zhonghedian: [1280, 530, 2.4], baohedian: [1280, 910, 2.5], tonggang: [1260, 790, 2.5],
    yangxin: [1450, 840, 2.6], qianqinggong: [1350, 800, 2.5], jiaotaidian: [1190, 850, 2.8],
    ningshou: [1320, 675, 3.2], yuhuayuan: [1420, 850, 2.3], jiaolou: [1350, 560, 2.2], cat: [1070, 940, 2.9],
  }[state.spot.id];
  stopTour();
  const area = imageArea(), image = plateImage.surface;
  const scale = Math.min(area.width / image.width, area.height / image.height) * focus[2];
  flat.zoom = focus[2];
  flat.x = (image.width / 2 - focus[0]) * scale;
  flat.y = (image.height / 2 - focus[1]) * scale;
  plateStarted = Math.min(plateStarted, performance.now() - REVEAL_DURATION * 1000);
  announce(`正在查看${state.spot.name}的绘图细部，点复位可查看整幅。`);
  requestRender();
});
$('replay-plate').addEventListener('click', () => {
  if (state.mode !== 'plate') return;
  stopTour();
  resetPlate(plateImage);
  plateStarted = performance.now();
  announce(`重新展开：${state.spot.name}`);
  requestRender();
});
$('season-btn').addEventListener('click', cycleSeason);
$('audio-btn').addEventListener('click', toggleAudio);
$('tour-btn').addEventListener('click', toggleTour);
search.addEventListener('input', filterDirectory);
$('clear-search').addEventListener('click', () => { search.value = ''; filterDirectory(); search.focus(); });
$('directory-toggle').addEventListener('click', () => setDirectoryOpen(!state.directoryOpen));
$('directory-close').addEventListener('click', () => setDirectoryOpen(false));
$('directory-scrim').addEventListener('click', () => setDirectoryOpen(false));
$('help-btn').addEventListener('click', () => {
  stopTour();
  returnFocus = document.activeElement;
  help.showModal();
});
$('help-close').addEventListener('click', () => help.close());
help.addEventListener('close', () => returnFocus?.focus({ preventScroll: true }));
help.addEventListener('click', event => {
  if (event.target !== help) return;
  const rect = help.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) help.close();
});

window.addEventListener('keydown', event => {
  if (help.open || event.ctrlKey || event.metaKey || event.altKey) return;
  if (state.directoryOpen) {
    if (event.key === 'Escape') { event.preventDefault(); setDirectoryOpen(false); }
    else if (event.key === 'Tab') {
      const focusables = [...directory.querySelectorAll('button:not([hidden]), input, a[href]')].filter(element => element.getClientRects().length && !element.disabled);
      const first = focusables[0], last = focusables.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    return;
  }
  if (event.target.matches('input, textarea, select, [contenteditable="true"]')) {
    if (event.key === 'Escape' && event.target === search) { search.value = ''; filterDirectory(); }
    return;
  }
  if (event.repeat) return;
  const key = event.key.toLowerCase();
  if (key === 'escape') { event.preventDefault(); showWorld(); }
  else if (key === 'r') { event.preventDefault(); state.mode === 'map' ? showWorld() : showMap(); }
  else if (key === 's') cycleSeason();
  else if (key === 'm') toggleAudio();
  else if (event.code === 'Space' && !event.target.closest('button, a')) { event.preventDefault(); toggleTour(); }
  else if (key === '+' || key === '=') { event.preventDefault(); zoomAt(1.25); }
  else if (key === '-') { event.preventDefault(); zoomAt(.8); }
  else if (state.mode === 'plate' && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
    event.preventDefault(); stepSpot(event.key === 'ArrowLeft' ? -1 : 1);
  }
});

function openHash() {
  const id = location.hash.slice(1);
  if (id === 'map') showMap(false);
  else {
    const spot = spots.find(item => item.id === id);
    if (spot) visit(spot, false, false);
    else showWorld(false);
  }
}
window.addEventListener('hashchange', openHash);
narrow.addEventListener('change', () => { setDirectoryOpen(false); resize(); syncUI(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopTour();
    if (palaceSound.enabled) toggleAudio();
    if (pendingFrame) cancelAnimationFrame(pendingFrame);
    pendingFrame = 0;
    pointers.clear();
    gesture = null;
  } else requestRender();
});
new ResizeObserver(resize).observe(stage);

renderDirectory();
filterDirectory();
requestAnimationFrame(() => {
  try {
    if (!ctx) throw new Error('Canvas unavailable');
    resize();
    buildWorld();
    ready = true;
    $('loading').hidden = true;
    openHash();
  } catch (error) {
    $('loading').innerHTML = '<div class="error-message"><p>图卷暂未展开，请刷新重试。</p><a href="/">返回戴璇主页</a></div>';
    console.error('Palace atlas initialization failed', error);
  }
});
