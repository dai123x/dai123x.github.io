/* ============================================================
 * 长春工业大学 · 全景立体地图 —— 3D 引擎
 * 依赖：js/three.min.js (r128), js/OrbitControls.js, js/campus-data.js
 * 楼宇布局与配色依据《北湖/南湖校区校园平面图》绘制
 * ============================================================ */
(function () {
'use strict';

/* ---------------- 基础常量 ---------------- */
var DAY_SKY    = { top: '#8ec9f2', mid: '#bfe0f5', bot: '#e8f3fb', fog: '#d8ecf8' };
var SUNSET_SKY = { top: '#2e3a59', mid: '#cf6b4c', bot: '#f5b47a', fog: '#cf7b5c' };
var NIGHT_SKY  = { top: '#050a18', mid: '#0b1830', bot: '#17294a', fog: '#0b1626' };
var GRASS      = 0x6f9e55;
var GRASS2     = 0x679451;
var ROAD       = '#454c54';
var PAVE       = 0xc9c2b2;   // 广场铺装

/* ---------------- 全局状态 ---------------- */
var scene, camera, renderer, controls, raycaster, pointer, composer, bloomPass;
var dirLight, hemiLight, ambientLight, stars;
var pmremGenerator = null;
var campusGroup = null;
var labelGroup = null;
var routeGroup = null;
var cloudGroup = null;
var cloudMats = [];
var riverMesh = null;
var riverTex = null;
var routeTex = null;
var pickables = [];
var buildingEntries = []; // { id, cat, group, originalMats }
var currentCampus = null;
var currentKey = null;
var buildingMats = [];
var lampMats = [];
var haloMats = [];
var neonMats = [];
var selRing = null;
var selBeacon = null;
var selected = null;
var snowPoints = null;
var groundMesh = null;
var weatherMode = 'summer'; // 'summer' | 'autumn' | 'snow'
var timeMode = 'day'; // 'day' | 'sunset' | 'night'
var isSatellite = false; // 卫星影像模式
var satGroup = null;
var isNight = false;
var needleEl = null;
var radarEl = null;
var activeCategory = 'all';
var showGuideRoute = false;
var tour = { on: false, t: 0, curve: null };
var fly = null;
var texCache = {};
var UI = {};

/* ---------------- 受控调试接口（性能面板 / 自动化测量） ---------------- */
/* 仅暴露读取器，不对外开放写入，避免外部脚本篡改渲染状态 */
try {
  window.__CCUT = {
    get renderer() { return renderer; },
    get scene() { return scene; },
    get camera() { return camera; },
    get controls() { return controls; },
    get info() { return renderer ? renderer.info : null; },
    get state() {
      return {
        campus: currentKey,
        weather: weatherMode,
        time: timeMode,
        satellite: isSatellite,
        buildings: buildingEntries.length
      };
    }
  };
} catch (e) { /* 忽略：无 window 环境 */ }

/* ---------------- 共享单例材质与性能优化缓存 ---------------- */
var sharedNeonMaterial = null;
function getSharedNeonMaterial() {
  if (!sharedNeonMaterial) {
    sharedNeonMaterial = new THREE.LineBasicMaterial({
      color: 0x00ffff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    sharedNeonMaterial._shared = true;
  }
  return sharedNeonMaterial;
}

var sharedRoadMat = null;
function getSharedRoadMaterial() {
  if (!sharedRoadMat) {
    var tex = roadTexture();
    sharedRoadMat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.1, map: tex });
    sharedRoadMat._shared = true;
  }
  return sharedRoadMat;
}

// 漫游模式零GC分配工作向量与邻近检测缓存
var _fpsMoveVec = new THREE.Vector3();
var _fpsCamEulerY = new THREE.Euler(0, 0, 0, 'YXZ');
var _fpsDownRayDir = new THREE.Vector3(0, -1, 0);
var _fpsDownRayPos = new THREE.Vector3();
var _nearbyPickables = [];

function getNearbyPickables(px, pz, radius) {
  _nearbyPickables.length = 0;
  var r2 = radius * radius;
  for (var i = 0; i < pickables.length; i++) {
    var p = pickables[i];
    var dx = p.position.x - px;
    var dz = p.position.z - pz;
    if (dx * dx + dz * dz < r2) {
      _nearbyPickables.push(p);
    }
  }
  return _nearbyPickables;
}

/* 由 canvas 生成颜色贴图（统一补上 sRGB 标记与各向异性过滤） */
function canvasTex(canvas) {
  return markSRGB(new THREE.CanvasTexture(canvas));
}

/* 各向异性过滤上限（renderer 就绪后取硬件最大值，显著改善斜视角地面/立面清晰度） */
function maxAniso() {
  try { return renderer ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 4; }
  catch (e) { return 4; }
}

/* 颜色贴图 sRGB 标记。
 * renderer 使用 outputEncoding = sRGBEncoding，颜色贴图必须标记为 sRGB，
 * 否则着色器会把 sRGB 数据当线性值采样、在输出时再编码一次，整体发灰发白。
 * 注意：roughnessMap / metalnessMap 等数据贴图绝不能标记。
 * 若需要回到旧的（偏灰）观感，把 SRGB_PIPELINE 改为 false 即可。 */
var SRGB_PIPELINE = true;
function markSRGB(tex) {
  if (!tex || !SRGB_PIPELINE) return tex;
  if (THREE.sRGBEncoding) tex.encoding = THREE.sRGBEncoding;
  else if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ============================================================
 * 静态合批工具（Draw Call 优化）
 * 场景绝大多数零件是静止的，且大量重复('台阶/立柱/座椅/道路分段')。
 * 这里把「外观完全一致的材质」所对应的网格几何体合并成单个 Mesh，
 * 视觉 100% 等效，但可把上千次 draw call 压缩到几百次。
 * ============================================================ */
var _bm4A = new THREE.Matrix4();
var _bm4B = new THREE.Matrix4();

function copyAttrInto(attr, dst, offset, itemSize, count) {
  if (attr.isInterleavedBufferAttribute) {
    for (var i = 0; i < count; i++) {
      for (var c = 0; c < itemSize; c++) dst[offset + i * itemSize + c] = attr.getComponent(i, c);
    }
    return;
  }
  var src = attr.array;
  if (src.length >= count * itemSize) dst.set(src.subarray(0, count * itemSize), offset);
  else for (var j = 0; j < count * itemSize; j++) dst[offset + j] = src[j];
}

/* 合并若干已烘焙好变换的 BufferGeometry（position + normal + uv） */
function mergeSimpleGeometries(geos) {
  var i, g, total = 0;
  for (i = 0; i < geos.length; i++) {
    g = geos[i];
    // 缺法线的几何体不参与合批，避免合并后光照失真
    if (!g || !g.attributes.position || !g.attributes.normal) return null;
    total += g.attributes.position.count;
  }
  if (!total) return null;

  var pos = new Float32Array(total * 3);
  var nor = new Float32Array(total * 3);
  var uv = new Float32Array(total * 2);
  var o3 = 0, o2 = 0;
  for (i = 0; i < geos.length; i++) {
    g = geos[i];
    var cnt = g.attributes.position.count;
    copyAttrInto(g.attributes.position, pos, o3, 3, cnt);
    copyAttrInto(g.attributes.normal, nor, o3, 3, cnt);
    if (g.attributes.uv) copyAttrInto(g.attributes.uv, uv, o2, 2, cnt);
    o3 += cnt * 3; o2 += cnt * 2;
  }
  var out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.computeBoundingSphere();
  return out;
}

/* 合并线段（仅 position），用于霓虹描边 */
function mergeLineGeometries(geos) {
  var i, g, total = 0;
  for (i = 0; i < geos.length; i++) {
    if (!geos[i] || !geos[i].attributes.position) return null;
    total += geos[i].attributes.position.count;
  }
  if (!total) return null;
  var pos = new Float32Array(total * 3);
  var o3 = 0;
  for (i = 0; i < geos.length; i++) {
    g = geos[i];
    copyAttrInto(g.attributes.position, pos, o3, 3, g.attributes.position.count);
    o3 += g.attributes.position.count * 3;
  }
  var out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.computeBoundingSphere();
  return out;
}

/* 取相对 root 的世界变换矩阵 */
function relativeGeometry(root, invRoot, obj) {
  _bm4B.multiplyMatrices(invRoot, obj.matrixWorld);
  var g = obj.geometry.index ? obj.geometry.toNonIndexed() : obj.geometry.clone();
  g.applyMatrix4(_bm4B);
  return g;
}

/* ============================================================
 * 建筑标签图集（55 个 Sprite → 1 个实例化批次）
 * 每个标签原本是一张独立 CanvasTexture + 一个 Sprite，产生数十次 draw call。
 * 这里把所有标签画布打包进一张 2048² 图集，用一个 billboard 实例化网格渲染。
 * ============================================================ */
var LABEL_ATLAS_SIZE = 2048;

function bakeLabelsToAtlas(group, parent) {
  if (!group || !THREE.InstancedBufferGeometry) return null;
  var sprites = [];
  group.children.forEach(function (s) {
    if (s.isSprite && s.material && s.material.map && s.material.map.image) sprites.push(s);
  });
  if (sprites.length < 4) return null;

  var pad = 2, W = LABEL_ATLAS_SIZE, H = LABEL_ATLAS_SIZE;
  var need = 0, k;
  for (k = 0; k < sprites.length; k++) {
    var im = sprites[k].material.map.image;
    need += (im.width + pad) * (im.height + pad);
  }
  if (need > W * H * 0.9) return null;   // 装不下就保持原方案的 Sprite

  var canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  var ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  var x = pad, y = pad, rowH = 0;
  var items = [];
  for (k = 0; k < sprites.length; k++) {
    var sp = sprites[k];
    var img = sp.material.map.image;
    var w = img.width, h = img.height;
    if (x + w + pad > W) { x = pad; y += rowH + pad; rowH = 0; }
    if (y + h + pad > H) return null;    // 图集溢出，整体放弃
    ctx.drawImage(img, x, y);
    items.push({
      pos: sp.position.clone(),
      baseW: sp.userData.baseW || 1,
      baseH: sp.userData.baseH || 1,
      priority: sp.userData.priority || 2,
      bid: sp.userData.bid,
      cat: sp.userData.cat,
      visible: true,
      u0: x / W, v0: 1 - (y + h) / H, u1: (x + w) / W, v1: 1 - y / H
    });
    x += w + pad;
    if (h > rowH) rowH = h;
  }
  if (items.length < 4) return null;

  var tex = canvasTex(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  if (renderer && renderer.capabilities) tex.anisotropy = maxAniso();
  if (THREE.sRGBEncoding) tex.encoding = THREE.sRGBEncoding;
  else if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;

  var n = items.length;
  var off = new Float32Array(n * 3);
  var size = new Float32Array(n * 2);
  var uvr = new Float32Array(n * 4);
  for (k = 0; k < n; k++) {
    var it = items[k];
    off[k * 3] = it.pos.x; off[k * 3 + 1] = it.pos.y; off[k * 3 + 2] = it.pos.z;
    size[k * 2] = it.baseW; size[k * 2 + 1] = it.baseH;
    uvr[k * 4] = it.u0; uvr[k * 4 + 1] = it.v0; uvr[k * 4 + 2] = it.u1; uvr[k * 4 + 3] = it.v1;
  }

  var base = new THREE.PlaneGeometry(1, 1);
  var geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.attributes.position);
  geo.setAttribute('uv', base.attributes.uv);
  geo.setAttribute('iOffset', new THREE.InstancedBufferAttribute(off, 3));
  geo.setAttribute('iSize', new THREE.InstancedBufferAttribute(size, 2));
  geo.setAttribute('iUvRect', new THREE.InstancedBufferAttribute(uvr, 4));
  geo.instanceCount = n;

  var mat = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: tex } },
    vertexShader: [
      'attribute vec3 iOffset;',
      'attribute vec2 iSize;',
      'attribute vec4 iUvRect;',
      'varying vec2 vUv;',
      'void main() {',
      '  vUv = mix(iUvRect.xy, iUvRect.zw, uv);',
      '  vec4 mv = modelViewMatrix * vec4(iOffset, 1.0);',
      '  mv.xy += position.xy * iSize;',
      '  gl_Position = projectionMatrix * mv;',
      '}'
    ].join('\n'),
    fragmentShader: [
      // r128 会自动注入 tonemapping/encodings 的 pars，这里只挂应用层 chunk
      'uniform sampler2D uMap;',
      'varying vec2 vUv;',
      'void main() {',
      '  vec4 t = texture2D(uMap, vUv);',
      '  if (t.a < 0.02) discard;',
      '  gl_FragColor = t;',
      '  #include <tonemapping_fragment>',
      '  #include <encodings_fragment>',
      '}'
    ].join('\n'),
    transparent: true,
    depthTest: false,
    depthWrite: false
  });

  var mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'labelAtlas';
  mesh.frustumCulled = false;
  mesh.renderOrder = 999;
  parent.add(mesh);

  // 释放原 Sprite 的独立贴图与材质，并从场景移除
  sprites.forEach(function (sp) {
    if (sp.material.map) sp.material.map.dispose();
    if (sp.material) sp.material.dispose();
    if (sp.parent) sp.parent.remove(sp);
  });

  // 用轻量代理替换 buildingEntries 中的 label，保持 .visible 语义
  for (var e = 0; e < buildingEntries.length; e++) {
    var ent = buildingEntries[e];
    if (!ent.label || !ent.label.isSprite) continue;
    for (var q = 0; q < n; q++) {
      if (items[q].bid === ent.id) { ent.label = items[q]; break; }
    }
  }

  group.userData.atlas = { mesh: mesh, items: items, sizeAttr: geo.getAttribute('iSize') };
  return group.userData.atlas;
}

/* 每帧刷新标签图集实例（LOD 缩放 + 分类过滤可见性） */
function updateLabelAtlas(atlas) {
  if (!atlas || !atlas.sizeAttr) return;
  var arr = atlas.sizeAttr.array;
  var items = atlas.items;
  var camDist = camera.position.distanceTo(controls.target);
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    var vis = it.visible;
    if (!vis) { arr[i * 2] = 0; arr[i * 2 + 1] = 0; continue; }
    if (activeCategory === 'all' && it.priority === 2 && camDist >= 780) {
      arr[i * 2] = 0; arr[i * 2 + 1] = 0; continue;
    }
    var dist = camera.position.distanceTo(it.pos);
    var fs = clamp(dist / 520, 0.32, 1.0);
    arr[i * 2] = it.baseW * fs;
    arr[i * 2 + 1] = it.baseH * fs;
  }
  atlas.sizeAttr.needsUpdate = true;
}

/* 合并带顶点色的几何体（position + normal + uv + color） */
function mergeColoredGeometries(geos) {
  var i, g, total = 0;
  for (i = 0; i < geos.length; i++) {
    g = geos[i];
    if (!g || !g.attributes.position || !g.attributes.normal || !g.attributes.color) return null;
    total += g.attributes.position.count;
  }
  if (!total) return null;

  var pos = new Float32Array(total * 3);
  var nor = new Float32Array(total * 3);
  var uv = new Float32Array(total * 2);
  var col = new Float32Array(total * 3);
  var o3 = 0, o2 = 0;
  for (i = 0; i < geos.length; i++) {
    g = geos[i];
    var cnt = g.attributes.position.count;
    copyAttrInto(g.attributes.position, pos, o3, 3, cnt);
    copyAttrInto(g.attributes.normal, nor, o3, 3, cnt);
    copyAttrInto(g.attributes.color, col, o3, 3, cnt);
    if (g.attributes.uv) copyAttrInto(g.attributes.uv, uv, o2, 2, cnt);
    o3 += cnt * 3; o2 += cnt * 2;
  }
  var out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}

/* 表面档位：把 roughness / metalness 量化到 3 档，档内差异肉眼不可辨，
 * 从而允许把「外观接近但材质不同」的零件也合并进同一批次 */
var _surfR = [0.25, 0.58, 0.86];
var _surfM = [0.08, 0.42, 0.85];
function surfaceBucket(m) {
  var r = (m.roughness == null) ? 0.8 : m.roughness;
  var t = (m.metalness == null) ? 0.1 : m.metalness;
  var rb = r < 0.34 ? 0 : (r < 0.72 ? 1 : 2);
  var tb = t < 0.25 ? 0 : (t < 0.62 ? 1 : 2);
  return { key: rb + '_' + tb + '_' + (m.flatShading ? 1 : 0), r: _surfR[rb], t: _surfM[tb], flat: !!m.flatShading };
}

/* 跨材质顶点色合批：一栋楼内所有无贴图不透明零件按表面档位合并成 1~3 个网格 */
function batchBuildingGroupVertex(root) {
  if (!root) return 0;
  var victims = [];
  root.updateMatrixWorld(true);
  root.traverse(function (o) {
    if (o === root || !o.isMesh || o.isInstancedMesh) return;
    if (Array.isArray(o.material)) return;
    if (!o.geometry || !o.geometry.attributes.normal) return;
    if (!canBatchMaterial(o.material)) return;
    victims.push(o);
  });
  if (victims.length < 2) return 0;

  var invRoot = _bm4A.copy(root.matrixWorld).invert();
  var buckets = {}, keys = [];
  victims.forEach(function (o) {
    var s = surfaceBucket(o.material);
    if (!buckets[s.key]) { buckets[s.key] = { s: s, items: [] }; keys.push(s.key); }
    buckets[s.key].items.push(o);
  });

  var saved = 0;
  keys.forEach(function (k) {
    var b = buckets[k];
    if (b.items.length < 2) return;
    var geos = [], cast = false, recv = false;
    for (var i = 0; i < b.items.length; i++) {
      var o = b.items[i];
      var g = relativeGeometry(root, invRoot, o);
      var cnt = g.attributes.position.count;
      var carr = new Float32Array(cnt * 3);
      var c = o.material.color;
      for (var v = 0; v < cnt; v++) { carr[v * 3] = c.r; carr[v * 3 + 1] = c.g; carr[v * 3 + 2] = c.b; }
      g.setAttribute('color', new THREE.BufferAttribute(carr, 3));
      geos.push(g);
      if (o.castShadow) cast = true;
      if (o.receiveShadow) recv = true;
    }
    var merged = mergeColoredGeometries(geos);
    if (!merged) return;
    var mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: b.s.r,
      metalness: b.s.t,
      flatShading: b.s.flat
    });
    var mesh = new THREE.Mesh(merged, mat);
    mesh.name = 'batchedVC';
    mesh.castShadow = cast;
    mesh.receiveShadow = recv;
    mesh.userData.bid = b.items[0].userData.bid;
    mesh.userData.cat = b.items[0].userData.cat;
    root.add(mesh);
    for (var j = 0; j < b.items.length; j++) {
      if (b.items[j].parent) b.items[j].parent.remove(b.items[j]);
    }
    saved += b.items.length - 1;
  });
  return saved;
}

/* 把 list 中的网格合并为一个使用 material 的网格，挂到 root 下 */
function mergeMeshList(root, list, material, name) {
  if (!list || list.length < 2 || !material) return null;
  root.updateMatrixWorld(true);
  var invRoot = _bm4A.copy(root.matrixWorld).invert();
  var geos = [], cast = false, recv = false, bid = null, cat = null;
  for (var i = 0; i < list.length; i++) {
    var o = list[i];
    if (!o.geometry || !o.geometry.attributes.normal) return null;
    geos.push(relativeGeometry(root, invRoot, o));
    if (o.castShadow) cast = true;
    if (o.receiveShadow) recv = true;
    if (bid === null && o.userData.bid) { bid = o.userData.bid; cat = o.userData.cat; }
  }
  var merged = mergeSimpleGeometries(geos);
  if (!merged) return null;
  var mesh = new THREE.Mesh(merged, material);
  mesh.name = name || 'batched';
  mesh.castShadow = cast;
  mesh.receiveShadow = recv;
  if (bid !== null) { mesh.userData.bid = bid; mesh.userData.cat = cat; }
  root.add(mesh);
  for (var j = 0; j < list.length; j++) {
    if (list[j].parent) list[j].parent.remove(list[j]);
  }
  return mesh;
}

function mergeLineSegmentsList(root, list, material, name) {
  if (!list || list.length < 2 || !material) return null;
  root.updateMatrixWorld(true);
  var invRoot = _bm4A.copy(root.matrixWorld).invert();
  var geos = [];
  for (var i = 0; i < list.length; i++) geos.push(relativeGeometry(root, invRoot, list[i]));
  var merged = mergeLineGeometries(geos);
  if (!merged) return null;
  var seg = new THREE.LineSegments(merged, material);
  seg.name = name || 'batchedLines';
  root.add(seg);
  for (var j = 0; j < list.length; j++) {
    if (list[j].parent) list[j].parent.remove(list[j]);
  }
  return seg;
}

/* 材质签名：完全一致才可安全合批 */
function materialSignature(m) {
  return [
    m.type,
    m.color.getHexString(),
    (+m.roughness).toFixed(3),
    (+m.metalness).toFixed(3),
    m.emissive ? m.emissive.getHexString() : '-',
    (+m.emissiveIntensity).toFixed(3),
    m.flatShading ? '1' : '0'
  ].join('|');
}

/* 是否允许参与合批 */
function canBatchMaterial(m) {
  if (!m || Array.isArray(m)) return false;
  if (m._shared || m._dynamic) return false;
  // 带贴图的材质需要独立 UV 空间，不合批
  if (m.map || m.emissiveMap || m.roughnessMap || m.metalnessMap || m.normalMap || m.aoMap) return false;
  // 半透明 / 双面 / 夜景会动态改属性的材质，保持独立
  if (m.transparent !== false || m.opacity !== 1 || m.visible === false) return false;
  if (m.side !== THREE.FrontSide) return false;
  if (buildingMats.indexOf(m) >= 0) return false;
  return true;
}

/* 对单个建筑分组做「同材质」合批，返回省下的 draw call 数 */
function batchBuildingGroup(root) {
  if (!root) return 0;
  var victims = [];
  root.updateMatrixWorld(true);
  root.traverse(function (o) {
    if (o === root || !o.isMesh || o.isInstancedMesh) return;
    if (Array.isArray(o.material)) return;
    if (!o.geometry || !o.geometry.attributes.normal) return;
    if (!canBatchMaterial(o.material)) return;
    victims.push(o);
  });
  if (victims.length < 2) return 0;

  var invRoot = _bm4A.copy(root.matrixWorld).invert();
  var buckets = {}, keys = [];
  victims.forEach(function (o) {
    var k = materialSignature(o.material);
    if (!buckets[k]) { buckets[k] = { mat: o.material, items: [] }; keys.push(k); }
    buckets[k].items.push(o);
  });

  var saved = 0;
  keys.forEach(function (k) {
    var b = buckets[k];
    if (b.items.length < 2) return;
    var geos = [], cast = false, recv = false;
    for (var i = 0; i < b.items.length; i++) {
      geos.push(relativeGeometry(root, invRoot, b.items[i]));
      if (b.items[i].castShadow) cast = true;
      if (b.items[i].receiveShadow) recv = true;
    }
    var merged = mergeSimpleGeometries(geos);
    if (!merged) return;
    var mesh = new THREE.Mesh(merged, b.mat);
    mesh.name = 'batched';
    mesh.castShadow = cast;
    mesh.receiveShadow = recv;
    mesh.userData.bid = b.items[0].userData.bid;
    mesh.userData.cat = b.items[0].userData.cat;
    root.add(mesh);
    for (var j = 0; j < b.items.length; j++) {
      if (b.items[j].parent) b.items[j].parent.remove(b.items[j]);
    }
    saved += b.items.length - 1;
  });
  return saved;
}

/* ---------------- 原生 Web Audio 交互音效 ---------------- */
var audioCtx = null;
var soundEnabled = true;
try { soundEnabled = window.localStorage.getItem('ccut_map_sound') !== '0'; } catch (e) { /* storage may be unavailable */ }

function playSound(type) {
  if (!soundEnabled) return;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    var osc = audioCtx.createOscillator();
    var gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    var t = audioCtx.currentTime;
    if (type === 'select') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, t); // D5
      osc.frequency.exponentialRampToValueAtTime(880, t + 0.08); // A5
      gain.gain.setValueAtTime(0.08, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
      osc.start(t);
      osc.stop(t + 0.14);
    } else if (type === 'click') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(440, t);
      gain.gain.setValueAtTime(0.05, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      osc.start(t);
      osc.stop(t + 0.05);
    } else if (type === 'switch') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(523.25, t); // C5
      osc.frequency.exponentialRampToValueAtTime(659.25, t + 0.12); // E5
      gain.gain.setValueAtTime(0.09, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      osc.start(t);
      osc.stop(t + 0.18);
    }
  } catch (e) {}
}

/* ---------------- 拼音与模糊缩写检索词典 ---------------- */
var PINYIN_DICT = {
  '图书馆': ['tsg', 'tushuguan', 'lib', 'library'],
  '郭力楼': ['gll', 'guolilou', 'gl'],
  '数学与统计': ['sxtj', 'shuxueyutongji', 'math', 'stat', 'tongji', 'tj'],
  '数统': ['st', 'shutong', 'sxtj', 'math', 'stat', 'stats'],
  '数学与统计学院': ['sxtjxy', 'shuxueyutongjixueyuan', 'sxtj', 'math', 'stat', 'stats', 'doctor'],
  '统计学': ['tjx', 'tongjixue', 'stat', 'stats'],
  '大数据': ['dsj', 'dashuju', 'bigdata'],
  '西区教学主楼': ['xqjxzjl', 'xiquzhujiaoxuelou', 'xqzl', 'kjdl', 'kejidalou'],
  '东区主教学楼': ['dqzjxl', 'dongquzhujiaoxuelou', 'dqzl', 'sxtj'],
  '教学主楼': ['jxzjl', 'zhujiaoxuelou', 'zjl'],
  '主教学楼': ['zjxl', 'zhujiaoxuelou', 'zjl'],
  '科技大楼': ['kjdl', 'kejidalou', 'xqzl'],
  '教学科研楼': ['jxkyl', 'jiaoxuekeyanlou', 'kjdl', 'kejidalou'],
  '计算机': ['jsj', 'jisuanji', 'cs'],
  '化学工程': ['hxgc', 'huaxuegongcheng', 'hg'],
  '生命科学': ['smkx', 'shengmingkexue', 'hs'],
  '材料': ['cl', 'cailiao'],
  '轨道交通': ['gdjt', 'guidaojiaotong'],
  '高等研究院': ['gdy', 'gaodengyanjiuyuan'],
  '应用技术': ['yyjs', 'yingyongjishu'],
  '科技园': ['kjy', 'kejiyuan'],
  '艺术设计': ['yssj', 'yishusheji', 'ys'],
  '新闻传播': ['xwcb', 'xinwenchuanbo', 'xw'],
  '马克思': ['mks', 'makesi'],
  '统计': ['tj', 'tongji'],
  '食堂': ['st', 'shitang', 'canteen'],
  '服务中心': ['fwzx', 'fuwuzhongxin'],
  '大学生服务中心': ['dxsfwzx', 'fuwuzhongxin', 'kudi', 'cotti', 'shitang', 'canteen'],
  '库迪咖啡': ['kdkf', 'kudi', 'cotti', 'coffee', 'cafe'],
  '咖啡': ['kf', 'kafei', 'coffee', 'cotti'],
  '湖畔社区': ['hpsq', 'hupan', 'hupanshequ'],
  '浴池': ['yc', 'yuchi'],
  '体育馆': ['tyg', 'tiyuguan', 'gym'],
  '体育场': ['tyc', 'tiyuchang', 'track'],
  '篮球场': ['lqc', 'lanqiuchang'],
  '活动中心': ['hdzx', 'huodongzhongxin'],
  '寝': ['qin', 'qinshi'],
  '男寝': ['nq', 'nanqin'],
  '女寝': ['nq', 'nvqin'],
  '公寓': ['gy', 'gongyu', 'dorm'],
  '知理苑': ['zly', 'zhiliyuan'],
  '知行苑': ['zxy', 'zhixingyuan'],
  '知义苑': ['zyy', 'zhiyiyuan'],
  '雅逸苑': ['yyy', 'yayiyuan'],
  '知远苑': ['zyy', 'zhiyuanyuan'],
  '知信苑': ['zxy', 'zhixinyuan'],
  '雅馨苑': ['yxy', 'yaxinyuan'],
  '雅慧苑': ['yhy', 'yahuiyuan'],
  '校医院': ['xyy', 'xiaoyiyuan', 'hospital'],
  '正门': ['zm', 'zhengmen'],
  '西区南门': ['xqnm', 'nanmen', 'nm', 'zhengmen'],
  '西区东门': ['xqdm', 'dongmen', 'dm'],
  '西区北门': ['xqbm', 'beimen', 'bm'],
  '东区西门': ['dqxm', 'ximen', 'xm'],
  '东区南门': ['dqnm', 'nanmen', 'nm'],
  '东区北门': ['dqbm', 'beimen', 'bm'],
  '东区西北门': ['dqxbm', 'xibeimen', 'xbm'],
  '延安大街': ['yadj', 'yanandajie', 'zhengmen', 'zm'],
  '宽平大路': ['kpdl', 'kuanpingdalu', 'ceimen', 'cm'],
  '国防生': ['gfs', 'guofangsheng', 'dfsg'],
  '东门': ['dm', 'dongmen'],
  '西门': ['xm', 'ximen'],
  '北门': ['bm', 'beimen'],
  '南门': ['nm', 'nanmen'],
  '综合楼': ['zhl', 'zonghelou'],
  '工程训练': ['gcxl', 'gongchengxunlian'],
  '礼堂': ['lt', 'litang'],
  '电教楼': ['djl', 'dianjiaolou'],
  '科教楼': ['kjl', 'kejiaolou'],
  '南湖': ['nh', 'nanhu'],
  '北湖': ['bh', 'beihu'],
  '博厚': ['bh', 'bohou'],
  '东区': ['dq', 'dongqu'],
  '西区': ['xq', 'xiqu'],
  '操场': ['cc', 'caochang', 'track'],
  '门': ['m', 'men', 'gate'],
  '栋': ['d', 'dong', '#']
};

function matchSearch(bName, q) {
  if (!q) return true;
  q = (q + '').trim().toLowerCase();
  if (!q) return true;
  var nameLower = (bName + '').toLowerCase();
  if (nameLower.indexOf(q) >= 0) return true;
  for (var key in PINYIN_DICT) {
    if (nameLower.indexOf(key.toLowerCase()) >= 0) {
      var aliases = PINYIN_DICT[key];
      for (var ai = 0; ai < aliases.length; ai++) {
        if (aliases[ai].toLowerCase().indexOf(q) >= 0) return true;
      }
    }
  }
  return false;
}

/* ---------------- 新生距离估算（使用模型内校门点，不是路网导航） ---------------- */
function calcGateDistance(b, campusKey) {
  if (!b || !b.pos || !currentCampus || currentKey !== campusKey) return null;
  var gates = Array.isArray(currentCampus.gates) ? currentCampus.gates : [];
  var eligibleGates = gates.filter(function(gate) {
    return gate && Array.isArray(gate.pos) && gate.pos.length >= 2 &&
      (gate.desc || '').indexOf('消防通道') === -1;
  });
  if (!eligibleGates.length) eligibleGates = gates.filter(function(gate) {
    return gate && Array.isArray(gate.pos) && gate.pos.length >= 2;
  });
  if (!eligibleGates.length) return null;

  var gate = eligibleGates.reduce(function(nearest, candidate) {
    var candidateDistance = Math.hypot(b.pos[0] - candidate.pos[0], b.pos[1] - candidate.pos[1]);
    var nearestDistance = Math.hypot(b.pos[0] - nearest.pos[0], b.pos[1] - nearest.pos[1]);
    return candidateDistance < nearestDistance ? candidate : nearest;
  });
  var gatePos = gate.pos.slice(0, 2);
  var straight = Math.hypot(b.pos[0] - gatePos[0], b.pos[1] - gatePos[1]);
  var distM = Math.round(straight * 1.22);
  var walkMin = Math.max(1, Math.round(distM / 72));
  return { dist: distM, min: walkMin, gateName: gate.name, gatePos: gatePos };
}

/* ---------------- 小工具 ---------------- */
function $(id) { return document.getElementById(id); }
function rand(a, b) { return a + Math.random() * (b - a); }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function easeInOut(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
function shade(hex, f) {
  var r = clamp(Math.round(((hex >> 16) & 255) * f), 0, 255);
  var g = clamp(Math.round(((hex >> 8) & 255) * f), 0, 255);
  var b = clamp(Math.round((hex & 255) * f), 0, 255);
  return (r << 16) | (g << 8) | b;
}

function showToast(msg) {
  var t = document.querySelector('.snap-toast');
  if (!t) {
    t = document.createElement('div');
    t.className = 'snap-toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(function () { t.classList.remove('show'); }, 2400);
}

/* ============================================================
 * 纹理生成
 * ============================================================ */

/* 白天立面（带窗框）+ 夜间发光贴图 + 物理材质贴图 */
function facadeTextures(wallHex, floors, cols) {
  var key = 'f_' + wallHex + '_' + floors + '_' + cols;
  if (texCache[key]) return texCache[key];

  var cw = 26, ch = 20;
  var W = cols * cw, H = floors * ch;
  var day = document.createElement('canvas'); day.width = W; day.height = H;
  var d = day.getContext('2d');
  var night = document.createElement('canvas'); night.width = W; night.height = H;
  var n = night.getContext('2d');
  
  var phys = document.createElement('canvas'); phys.width = W; phys.height = H;
  var p = phys.getContext('2d');

  var wall = '#' + ('00000' + wallHex.toString(16)).slice(-6);
  d.fillStyle = wall; d.fillRect(0, 0, W, H);
  d.fillStyle = 'rgba(0,0,0,0.04)';
  for (var s = 0; s < W * H / 300; s++) d.fillRect(Math.random() * W, Math.random() * H, 2, 2);
  n.fillStyle = '#000'; n.fillRect(0, 0, W, H);

  // 物理贴图：G通道为 Roughness，B通道为 Metalness
  // 墙面：高粗糙度(G=230), 低金属度(B=0) -> rgb(0, 230, 0)
  p.fillStyle = 'rgb(0,230,0)'; p.fillRect(0, 0, W, H);

  d.fillStyle = 'rgba(0,0,0,0.13)';
  for (var f = 0; f < floors; f++) d.fillRect(0, f * ch + ch - 2, W, 2);
  d.fillStyle = 'rgba(0,0,0,0.16)';
  d.fillRect(0, H - 4, W, 4);

  for (var f2 = 0; f2 < floors; f2++) {
    for (var c = 0; c < cols; c++) {
      var x = c * cw + 4, y = f2 * ch + 4, w = cw - 8, h = ch - 10;
      d.fillStyle = 'rgba(238,236,230,0.92)';
      d.fillRect(x, y, w, h);
      
      // 玻璃
      d.fillStyle = 'rgba(118,148,172,0.92)';
      d.fillRect(x + 1.5, y + 1.5, w - 3, h - 3);
      d.fillStyle = 'rgba(255,255,255,0.38)';
      d.fillRect(x + 1.5, y + 1.5, w - 3, Math.max(1, (h - 3) * 0.3));
      
      // 玻璃物理材质：低粗糙度(G=38), 高金属度(B=204) -> rgb(0, 38, 204)
      p.fillStyle = 'rgb(0,38,204)';
      p.fillRect(x + 1.5, y + 1.5, w - 3, h - 3);

      d.fillStyle = 'rgba(238,236,230,0.9)';
      d.fillRect(x + w / 2 - 0.8, y + 1.5, 1.6, h - 3);
      if (Math.random() < 0.55) {
        var warm = Math.random() < 0.8 ? '#ffd27a' : '#bfe4ff';
        n.fillStyle = warm;
        n.fillRect(x, y, w, h);
      }
    }
  }
  var tDay = canvasTex(day);
  var tNight = canvasTex(night);
  var tPhys = new THREE.CanvasTexture(phys);
  tDay.wrapS = tNight.wrapS = tPhys.wrapS = THREE.RepeatWrapping;
  var aniso = maxAniso();
  tDay.anisotropy = tNight.anisotropy = tPhys.anisotropy = aniso;
  tDay._cached = tNight._cached = tPhys._cached = true;
  return (texCache[key] = { day: tDay, night: tNight, phys: tPhys });
}

/* 道路纹理：沥青 + 中央虚线 */

function grassTexture(hexColor) {
  if (texCache['grass_'+hexColor]) return texCache['grass_'+hexColor];
  var c = document.createElement('canvas'); c.width = 512; c.height = 512;
  var g = c.getContext('2d');
  g.fillStyle = '#' + ('00000' + hexColor.toString(16)).slice(-6);
  g.fillRect(0, 0, 512, 512);
  for (var i = 0; i < 16000; i++) {
    var x = Math.random() * 512;
    var y = Math.random() * 512;
    g.fillStyle = Math.random() > 0.5 ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.03)';
    g.fillRect(x, y, Math.random() * 3, Math.random() * 3);
  }
  var tex = canvasTex(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(180, 180);
  if (typeof THREE.SRGBColorSpace !== 'undefined') tex.colorSpace = THREE.SRGBColorSpace;
  tex._cached = true;
  texCache['grass_'+hexColor] = tex;
  return tex;
}

function roadTexture() {
  if (texCache.road) return texCache.road;
  var c = document.createElement('canvas'); c.width = 128; c.height = 128;
  var g = c.getContext('2d');
  g.fillStyle = ROAD; g.fillRect(0, 0, 128, 128);
  g.fillStyle = 'rgba(255,255,255,0.06)';
  for (var i = 0; i < 40; i++) g.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
  g.fillStyle = 'rgba(255,255,255,0.75)';
  g.fillRect(62, 8, 4, 44); g.fillRect(62, 76, 4, 44);
  var t = canvasTex(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t._cached = true;
  return (texCache.road = t);
}

/* 天空渐变 */
function skyTexture(set) {
  var key = 'sky_' + set.top;
  if (texCache[key]) return texCache[key];
  var c = document.createElement('canvas'); c.width = 16; c.height = 256;
  var g = c.getContext('2d');
  var gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, set.top); gr.addColorStop(0.55, set.mid); gr.addColorStop(1, set.bot);
  g.fillStyle = gr; g.fillRect(0, 0, 16, 256);
  var tex = canvasTex(c);
  tex._cached = true;
  return (texCache[key] = tex);
}

/* 校门牌匾 */
function gateSignTexture(text) {
  var key = 'gate_' + text;
  if (texCache[key]) return texCache[key];
  var c = document.createElement('canvas'); c.width = 1024; c.height = 128;
  var g = c.getContext('2d');
  g.fillStyle = '#7a1f1f'; g.fillRect(0, 0, 1024, 128);
  g.strokeStyle = '#c9a227'; g.lineWidth = 8; g.strokeRect(10, 10, 1004, 108);
  g.fillStyle = '#f4d97c';
  g.font = 'bold 78px "Microsoft YaHei", sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 512, 70);
  var tex = canvasTex(c);
  tex._cached = true;
  return (texCache[key] = tex);
}

/* 水面微波流光纹理 */
function waterTexture() {
  if (texCache.water) return texCache.water;
  var c = document.createElement('canvas'); c.width = 256; c.height = 256;
  var g = c.getContext('2d');
  g.fillStyle = '#4a95cc'; g.fillRect(0, 0, 256, 256);
  g.fillStyle = 'rgba(255,255,255,0.22)';
  for (var i = 0; i < 60; i++) {
    var y = Math.random() * 256;
    var x = Math.random() * 256;
    g.beginPath();
    g.ellipse(x, y, 14 + Math.random() * 18, 3.5, 0, 0, Math.PI * 2);
    g.fill();
  }
  var tex = canvasTex(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 2);
  tex._cached = true;
  return (texCache.water = tex);
}

/* 路线动态流光箭头纹理 */
function routeTextureFunc() {
  if (texCache.route) return texCache.route;
  var c = document.createElement('canvas'); c.width = 128; c.height = 32;
  var g = c.getContext('2d');
  g.clearRect(0, 0, 128, 32);
  g.fillStyle = 'rgba(255, 255, 255, 0.95)';
  g.beginPath();
  g.moveTo(20, 4); g.lineTo(36, 16); g.lineTo(20, 28); g.lineTo(12, 28); g.lineTo(26, 16); g.lineTo(12, 4); g.fill();
  g.beginPath();
  g.moveTo(76, 4); g.lineTo(92, 16); g.lineTo(76, 28); g.lineTo(68, 28); g.lineTo(82, 16); g.lineTo(68, 4); g.fill();
  var tex = canvasTex(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(12, 1);
  tex._cached = true;
  return (texCache.route = tex);
}

/* 路灯地面暖光晕纹理 */
function lampHaloTexture() {
  if (texCache.lampHalo) return texCache.lampHalo;
  var c = document.createElement('canvas'); c.width = 64; c.height = 64;
  var g = c.getContext('2d');
  var gr = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255, 230, 140, 0.85)');
  gr.addColorStop(0.35, 'rgba(255, 210, 100, 0.4)');
  gr.addColorStop(0.7, 'rgba(255, 180, 70, 0.12)');
  gr.addColorStop(1, 'rgba(255, 180, 70, 0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  var tex = canvasTex(c);
  tex._cached = true;
  return (texCache.lampHalo = tex);
}

/* 通用文字画布 */
function textCanvas(text, opts) {
  opts = opts || {};
  var fs = opts.fs || 42;
  var c = document.createElement('canvas');
  var g = c.getContext('2d');
  g.font = 'bold ' + fs + 'px "Microsoft YaHei", sans-serif';
  var tw = g.measureText(text).width;
  c.width = Math.ceil(tw + fs * 0.9); c.height = Math.ceil(fs * 1.7);
  g = c.getContext('2d');
  if (opts.bg) {
    g.fillStyle = opts.bg;
    roundRect(g, 1, 1, c.width - 2, c.height - 2, opts.br != null ? opts.br : 18);
    g.fill();
    if (opts.border) {
      g.strokeStyle = opts.border; g.lineWidth = 3;
      roundRect(g, 1, 1, c.width - 2, c.height - 2, opts.br != null ? opts.br : 18);
      g.stroke();
    }
  }
  g.fillStyle = opts.color || '#f2f7fd';
  g.font = 'bold ' + fs + 'px "Microsoft YaHei", sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, c.width / 2, c.height / 2 + 2);
  return c;
}

/* 3D 标注（Sprite）带 LOD 优先级 */
function makeLabel(text, catColor, ls, priority) {
  ls = ls || 1;
  var c = textCanvas(text, { fs: 42, bg: 'rgba(6,14,26,0.80)', border: catColor || '#ffd54d', br: 20 });
  var g = c.getContext('2d');
  g.fillStyle = catColor || '#ffd54d';
  g.beginPath(); g.arc(24, c.height / 2, 9, 0, Math.PI * 2); g.fill();
  var t = canvasTex(c);
  // 标签贴图随校区销毁释放（不进全局缓存），避免反复切换校区时显存持续增长
  t._cached = false;
  var m = new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true });
  var s = new THREE.Sprite(m);
  var k = 0.30 * ls;
  s.scale.set(c.width * k, c.height * k, 1);
  s.userData.baseW = c.width * k;
  s.userData.baseH = c.height * k;
  s.userData.priority = priority || 2; // 1: 核心地标, 2: 常规
  s.renderOrder = 999;
  return s;
}
function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/* ============================================================
 * 建筑构建
 * ============================================================ */
/* 本地参考图片贴图（官方效果图/实景图，本地 img/ 目录） */
var photoLoader = new THREE.TextureLoader();
var photoCache = {};
var photoPending = {};
window.__photos = photoCache; // 调试：检查贴图加载
function photoTexture(url, onReady) {
  if (photoCache[url]) { if (photoCache[url].image) onReady(photoCache[url]); return; }
  if (photoPending[url]) { photoPending[url].push(onReady); return; }
  photoPending[url] = [onReady];
  photoLoader.load(url, function (tex) {
    tex.anisotropy = maxAniso();
    markSRGB(tex);            // 实景照片同样是 sRGB 数据，必须标记否则建筑立面泛白
    tex._cached = true;
    photoCache[url] = tex;
    var callbacks = photoPending[url] || [];
    delete photoPending[url];
    callbacks.forEach(function (callback) { callback(tex); });
  }, undefined, function () {
    delete photoPending[url]; // 失败后允许后续重试，保留程序化立面
  });
}

function makeFacadeMaterial(b) {
  var floors = b.floors || Math.max(2, Math.round(b.h / 6.5));
  var w = b.size[0], dd = b.size[1];
  var colsLong = Math.max(3, Math.round(Math.max(w, dd) / 9));
  var colsShort = Math.max(2, Math.round(Math.min(w, dd) / 9));
  var texL = facadeTextures(b.color, floors, colsLong);
  var texS = facadeTextures(b.color, floors, colsShort);
  var roof = b.roof || (b.photo ? 0x6e6055 : shade(b.color, 0.62));
  
  // 立面不用 MeshPhysicalMaterial：transmission/clearcoat 全程为 0，
  // 却让所有建筑走进最贵的物理着色路径；Standard 外观相同、shader 便宜得多
  var mL = new THREE.MeshStandardMaterial({
    map: texL.day, emissiveMap: texL.night, emissive: 0xffffff, emissiveIntensity: 0,
    roughnessMap: texL.phys, metalnessMap: texL.phys,
    roughness: 1.0, metalness: 1.0
  });
  var mS = new THREE.MeshStandardMaterial({
    map: texS.day, emissiveMap: texS.night, emissive: 0xffffff, emissiveIntensity: 0,
    roughnessMap: texS.phys, metalnessMap: texS.phys,
    roughness: 1.0, metalness: 1.0
  });
  var mR = new THREE.MeshStandardMaterial({
    roughness: 0.9, metalness: 0.1, color: roof
  });
  
  buildingMats.push(mL, mS);
  if (b.photo) {
    photoTexture(b.photo, function (tex) {
      mL.map = tex; mL.needsUpdate = true;
      mS.map = tex; mS.needsUpdate = true;
    });
  }
  // BoxGeometry: 0/1 are +X/-X (span dd), 2/3 are +Y/-Y (top/bottom), 4/5 are +Z/-Z (span w)
  var mX = (w >= dd) ? mS : mL;
  var mZ = (w >= dd) ? mL : mS;
  return [mX, mX, mR, mR, mZ, mZ];
}

function addTrim(grp, w, d, y, color) {
  var trim = new THREE.Mesh(
    new THREE.BoxGeometry(w + 2.4, 1.6, d + 2.4),
    new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.1, color: color })
  );
  trim.position.y = y;
  trim.castShadow = true;
  grp.add(trim);
}

function buildBox(b) {
  var grp = new THREE.Group();
  var mesh;
  var boxGeo;
  
  if (b.pts && b.pts.length >= 3) {
    var shape = new THREE.Shape();
    // b.pos is the center of the bounding box. b.pts is in absolute coordinates.
    // We want the mesh position to be at b.pos, so we subtract b.pos from pts.
    shape.moveTo(b.pts[0][0] - b.pos[0], -(b.pts[0][1] - b.pos[1]));
    for (var i = 1; i < b.pts.length; i++) {
      shape.lineTo(b.pts[i][0] - b.pos[0], -(b.pts[i][1] - b.pos[1]));
    }
    
    var extrudeSettings = { depth: b.h, bevelEnabled: false };
    boxGeo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    boxGeo.rotateX(-Math.PI / 2);
    
    // Fix wall UVs for ExtrudeGeometry (group 1 is the sides)
    var pos = boxGeo.attributes.position.array;
    var uv = boxGeo.attributes.uv.array;
    var groups = boxGeo.groups;
    var sideGroup = groups.length > 1 ? groups[1] : null;
    if (sideGroup) {
      for (var i = sideGroup.start; i < sideGroup.start + sideGroup.count; i++) {
        var vx = pos[i * 3], vz = pos[i * 3 + 2];
        uv[i * 2] = (vx + vz) / 9; // simple mapping for walls
      }
    }
    
    // ExtrudeGeometry materials: [roof/bottom, sides]
    var mats = makeFacadeMaterial(b);
    mesh = new THREE.Mesh(boxGeo, [mats[2], mats[0]]);
    mesh.position.set(0, 0, 0); // 几何体以局部原点构建，按模型坐标置于 b.pos
    
    // 现代平屋顶女儿墙边框结构（凸起 0.8 米）
    var parapetGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.8, bevelEnabled: false });
    parapetGeo.rotateX(-Math.PI / 2);
    var parapetMesh = new THREE.Mesh(parapetGeo, new THREE.MeshStandardMaterial({ color: shade(b.color, 0.72), roughness: 0.85 }));
    parapetMesh.position.set(0, b.h, 0);
    parapetMesh.castShadow = true;
    grp.add(parapetMesh);

    // 卫星遥感地图可辨识的楼顶电梯机房与暖通排气设施
    if (b.h >= 14 && b.size && b.size[0] > 24) {
      var pw = Math.min(16, b.size[0] * 0.26);
      var pd = Math.min(12, b.size[1] * 0.26);
      var ph = 3.0;
      var pentMesh = new THREE.Mesh(
        new THREE.BoxGeometry(pw, ph, pd),
        new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.8 })
      );
      pentMesh.position.set(0, b.h + ph / 2, 0);
      pentMesh.castShadow = true;
      grp.add(pentMesh);
    }
  } else {
    boxGeo = new THREE.BoxGeometry(b.size[0], b.h, b.size[1]);
    mesh = new THREE.Mesh(boxGeo, makeFacadeMaterial(b));
    mesh.position.set(0, b.h / 2, 0);
    addTrim(grp, b.size[0], b.size[1], b.h + 0.8, b.roof || shade(b.color, 0.62));
  }
  
  mesh.castShadow = mesh.receiveShadow = true;
  
  var edgeLines = new THREE.LineSegments(new THREE.EdgesGeometry(boxGeo, 40), getSharedNeonMaterial());
  mesh.add(edgeLines);
  
  grp.add(mesh);
  return grp;
}

function buildMulti(b) {
  var grp = new THREE.Group();
  b.parts.forEach(function (p) {
    var partColor = p.color || b.color;
    var partRoof = p.roof || b.roof || shade(partColor, 0.62);
    var tmp = { color: partColor, roof: partRoof, size: [p.w, p.d], h: p.h, floors: p.floors || b.floors, photo: b.photo };
    var boxGeo = new THREE.BoxGeometry(p.w, p.h, p.d);
    var mesh = new THREE.Mesh(boxGeo, makeFacadeMaterial(tmp));
    mesh.position.set(p.dx, p.h / 2, p.dz);
    mesh.castShadow = mesh.receiveShadow = true;
    
    var edgeLines = new THREE.LineSegments(new THREE.EdgesGeometry(boxGeo), getSharedNeonMaterial());
    mesh.add(edgeLines);
    
    grp.add(mesh);
    if (!p.noTrim) {
      var trim = new THREE.Mesh(
        new THREE.BoxGeometry(p.w + 2.0, 1.4, p.d + 2.0),
        new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.1, color: partRoof })
      );
      trim.position.set(p.dx, p.h + 0.7, p.dz);
      trim.castShadow = true;
      grp.add(trim);
    }
  });
  return grp;
}

function buildDome(b) {
  var grp = new THREE.Group();
  var baseGeo = new THREE.CylinderGeometry(b.r, b.r * 1.06, b.h * 0.55, 32);
  var base = new THREE.Mesh(baseGeo, new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.1, color: 0xe9e2d2 }));
  base.position.y = b.h * 0.275; base.castShadow = base.receiveShadow = true;
  
  var edgeLines = new THREE.LineSegments(new THREE.EdgesGeometry(baseGeo, 30), getSharedNeonMaterial());
  base.add(edgeLines);
  
  grp.add(base);
  var dome = new THREE.Mesh(new THREE.SphereGeometry(b.r * 0.92, 32, 18, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.1, color: 0x9fb7c9 }));
  dome.position.y = b.h * 0.55; dome.castShadow = true;
  grp.add(dome);
  var spire = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 6, 8), new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.1, color: 0xcfd8e0 }));
  spire.position.y = b.h * 0.55 + b.r * 0.92 + 2.4;
  grp.add(spire);
  return grp;
}

/* 白色弧顶场馆（南湖体育馆风格） */
function buildArena(b) {
  var grp = new THREE.Group();
  var baseGeo = new THREE.BoxGeometry(b.size[0], b.h * 0.55, b.size[1]);
  var base = new THREE.Mesh(
    baseGeo,
    new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.1, color: b.color || 0xe6e2d8 })
  );
  base.position.y = b.h * 0.275;
  base.castShadow = base.receiveShadow = true;
  
  var edgeLines = new THREE.LineSegments(new THREE.EdgesGeometry(baseGeo), getSharedNeonMaterial());
  base.add(edgeLines);
  
  grp.add(base);
  var roof = new THREE.Mesh(
    new THREE.CylinderGeometry(b.size[1] * 0.5, b.size[1] * 0.5, b.size[0] * 0.98, 24, 1, false, 0, Math.PI),
    new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.1, color: 0xf2f2ee })
  );
  roof.rotation.z = Math.PI / 2;
  roof.scale.y = 0.55;
  roof.position.y = b.h * 0.55;
  roof.castShadow = true;
  grp.add(roof);
  return grp;
}

/* ============================================================
 * 重点建筑示意建模（参考可获得的公开资料与影像）
 * ============================================================ */

/* 辅助：修复 ExtrudeGeometry 侧立面 UV 贴图与楼层高度比例 */
function fixExtrudeUVs(geo, height) {
  if (!geo || !geo.attributes || !geo.attributes.position || !geo.attributes.uv) return;
  var pos = geo.attributes.position.array;
  var uv = geo.attributes.uv.array;
  var count = pos.length / 3;
  for (var i = 0; i < count; i++) {
    var vx = pos[i * 3], vy = pos[i * 3 + 1], vz = pos[i * 3 + 2];
    uv[i * 2] = (vx + vz) / 8.0;
    uv[i * 2 + 1] = vy / (height || 18.0);
  }
  geo.attributes.uv.needsUpdate = true;
}

/* 1. 北湖校区西区标志：西区教学主楼（西区主楼 · 12层41米主塔 + 5层裙楼） */
function buildXiQuZhuJiao(b, campus) {
  var grp = new THREE.Group();

  // ① 轮廓基座裙楼示意（5层，高 18 米）
  var baseShape = new THREE.Shape();
  baseShape.moveTo(b.pts[0][0] - b.pos[0], -(b.pts[0][1] - b.pos[1]));
  for (var i = 1; i < b.pts.length; i++) {
    baseShape.lineTo(b.pts[i][0] - b.pos[0], -(b.pts[i][1] - b.pos[1]));
  }
  var baseGeo = new THREE.ExtrudeGeometry(baseShape, { depth: 18, bevelEnabled: false });
  baseGeo.rotateX(-Math.PI / 2);
  fixExtrudeUVs(baseGeo, 18);
  var mats = makeFacadeMaterial({ color: 0x9fb4c7, floors: 5, size: b.size, h: 18, photo: b.photo });
  var baseMesh = new THREE.Mesh(baseGeo, [mats[2], mats[0]]);
  baseMesh.position.set(0, 0, 0);
  baseMesh.castShadow = baseMesh.receiveShadow = true;
  grp.add(baseMesh);

  var baseEdge = new THREE.LineSegments(new THREE.EdgesGeometry(baseGeo, 40), getSharedNeonMaterial());
  baseMesh.add(baseEdge);

  // ② 核心主塔楼（12层，制高点 41 米，现代深蓝反射Low-E玻璃幕墙）
  var towerW = 58, towerD = 32, towerH = 41;
  var towerGeo = new THREE.BoxGeometry(towerW, towerH, towerD);
  var glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x1e3a5f,
    emissive: (timeMode === 'night' ? 0x0f2744 : 0x000000),
    emissiveIntensity: (timeMode === 'night' ? 0.75 : 0),
    metalness: 0.85,
    roughness: 0.15,
    clearcoat: 0.9,
    clearcoatRoughness: 0.1
  });
  buildingMats.push(glassMat);

  var towerRoofMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.8 });
  var towerMesh = new THREE.Mesh(towerGeo, [glassMat, glassMat, towerRoofMat, towerRoofMat, glassMat, glassMat]);
  towerMesh.position.set(0, towerH / 2, 0);
  towerMesh.castShadow = towerMesh.receiveShadow = true;
  grp.add(towerMesh);

  var towerEdge = new THREE.LineSegments(new THREE.EdgesGeometry(towerGeo), getSharedNeonMaterial());
  towerMesh.add(towerEdge);

  // ③ 塔楼顶层机房层与长春工业大学夜景发光标识
  var crownGeo = new THREE.BoxGeometry(26, 4.2, 18);
  var crownMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.7 });
  var crownMesh = new THREE.Mesh(crownGeo, crownMat);
  crownMesh.position.set(0, towerH + 2.1, 0);
  crownMesh.castShadow = true;
  grp.add(crownMesh);

  var signCanvas = textCanvas('长春工业大学 · 西区教学主楼', { fs: 38, color: '#fef08a', bg: 'rgba(15,23,42,0.88)', border: '#38bdf8' });
  var signTex = canvasTex(signCanvas);
  var signMat = new THREE.MeshBasicMaterial({ map: signTex, transparent: true, side: THREE.DoubleSide });
  var signMesh = new THREE.Mesh(new THREE.PlaneGeometry(24, 3.4), signMat);
  signMesh.position.set(0, towerH + 2.1, 9.1);
  grp.add(signMesh);

  // 通讯避雷天线主针（主峰塔尖高度 51 米）
  var mastGeo = new THREE.CylinderGeometry(0.3, 0.6, 10, 8);
  var mastMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.95, roughness: 0.1 });
  var mastMesh = new THREE.Mesh(mastGeo, mastMat);
  mastMesh.position.set(0, towerH + 9, 0);
  grp.add(mastMesh);

  // ④ 南正门玻璃大堂与出挑采光雨棚（按模型坐标近似放置）
  var lobbyMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.72, roughness: 0.1, metalness: 0.25 });
  var lobbyMesh = new THREE.Mesh(new THREE.BoxGeometry(26, 5.8, 3.5), lobbyMat);
  lobbyMesh.position.set(0, 2.9, 27.5);
  lobbyMesh.castShadow = true;
  grp.add(lobbyMesh);

  var canopyW = 32, canopyD = 10, canopyH = 6.2;
  var canopyGeo = new THREE.BoxGeometry(canopyW, 0.8, canopyD);
  var canopyMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.8, roughness: 0.2, transparent: true, opacity: 0.88 });
  var canopyMesh = new THREE.Mesh(canopyGeo, canopyMat);
  canopyMesh.position.set(0, canopyH, 30.5);
  canopyMesh.castShadow = true;
  grp.add(canopyMesh);

  // 雨棚迎宾门头标识
  var doorSignCanvas = textCanvas('长春工业大学教学主楼', { fs: 34, color: '#fef08a', bg: 'rgba(15,23,42,0.88)', border: '#38bdf8' });
  var doorSignMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 2.6),
    new THREE.MeshBasicMaterial({ map: canvasTex(doorSignCanvas), transparent: true, side: THREE.DoubleSide })
  );
  doorSignMesh.position.set(0, canopyH + 1.1, 35.6);
  grp.add(doorSignMesh);

  [-12, 12].forEach(function(cx) {
    var colGeo = new THREE.CylinderGeometry(0.5, 0.5, canopyH, 12);
    var colMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.7, roughness: 0.3 });
    var colMesh = new THREE.Mesh(colGeo, colMat);
    colMesh.position.set(cx, canopyH / 2, 34.5);
    colMesh.castShadow = true;
    grp.add(colMesh);
  });

  // 汉白玉迎宾四级大台阶
  for (var st = 0; st < 4; st++) {
    var stepMesh = new THREE.Mesh(
      new THREE.BoxGeometry(canopyW + 4 - st * 1.5, 0.4, 3 + st * 1.2),
      new THREE.MeshStandardMaterial({ color: 0xd1d5db, roughness: 0.8 })
    );
    stepMesh.position.set(0, (4 - st) * 0.2, 31 + st * 1.5);
    stepMesh.receiveShadow = true;
    grp.add(stepMesh);
  }

  // ⑤ 正南广场：三联升旗台（中央五星红旗 + 两侧长春工业大学校旗）
  var flagPlaza = new THREE.Group();
  flagPlaza.position.set(0, 0, 54);
  
  var basePlaza = new THREE.Mesh(
    new THREE.BoxGeometry(18, 0.6, 8),
    new THREE.MeshStandardMaterial({ color: 0xe5e7eb, roughness: 0.7 })
  );
  basePlaza.position.set(0, 0.3, 0);
  basePlaza.receiveShadow = true;
  flagPlaza.add(basePlaza);

  [-5, 0, 5].forEach(function(fx, idx) {
    var fHeight = (idx === 1 ? 12 : 10);
    var pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.18, fHeight, 12),
      new THREE.MeshStandardMaterial({ color: 0xf8fafc, metalness: 0.95, roughness: 0.1 })
    );
    pole.position.set(fx, fHeight / 2 + 0.6, 0);
    pole.castShadow = true;
    flagPlaza.add(pole);

    var flagMat = new THREE.MeshBasicMaterial({ 
      color: (idx === 1 ? 0xde2910 : 0x0284c7), 
      side: THREE.DoubleSide 
    });
    var flagPlane = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.6), flagMat);
    flagPlane.position.set(fx + 1.2, fHeight + 0.6 - 0.9, 0);
    flagPlane.rotation.y = 0.2;
    flagPlaza.add(flagPlane);
  });
  grp.add(flagPlaza);

  return grp;
}

/* 2. 北湖校区标志文化地标：博厚图书馆（3.3万㎡全省高校单体最大图书馆 · 挑高中庭玻璃采光顶） */
function buildBohouLibrary(b, campus) {
  var grp = new THREE.Group();

  // ① 142m x 53m 宏伟主体
  var shape = new THREE.Shape();
  shape.moveTo(b.pts[0][0] - b.pos[0], -(b.pts[0][1] - b.pos[1]));
  for (var i = 1; i < b.pts.length; i++) {
    shape.lineTo(b.pts[i][0] - b.pos[0], -(b.pts[i][1] - b.pos[1]));
  }
  var baseGeo = new THREE.ExtrudeGeometry(shape, { depth: 18, bevelEnabled: false });
  baseGeo.rotateX(-Math.PI / 2);
  fixExtrudeUVs(baseGeo, 18);

  var mats = makeFacadeMaterial({ color: 0xdecbb7, floors: 5, size: b.size, h: 18, photo: b.photo });
  var baseMesh = new THREE.Mesh(baseGeo, [mats[2], mats[0]]);
  baseMesh.position.set(0, 0, 0);
  baseMesh.castShadow = baseMesh.receiveShadow = true;
  grp.add(baseMesh);

  var edgeLines = new THREE.LineSegments(new THREE.EdgesGeometry(baseGeo, 40), getSharedNeonMaterial());
  baseMesh.add(edgeLines);

  // 屋顶女儿墙
  var parapetGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.9, bevelEnabled: false });
  parapetGeo.rotateX(-Math.PI / 2);
  var parapetMesh = new THREE.Mesh(parapetGeo, new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.8 }));
  parapetMesh.position.set(0, 18, 0);
  grp.add(parapetMesh);

  // ② 标志性中央挑高中庭采光玻璃天幕穹顶（48m x 20m 采光中庭天窗）
  var atriumW = 48, atriumD = 20, atriumH = 4.5;
  var atriumGeo = new THREE.BoxGeometry(atriumW, atriumH, atriumD);
  var atriumGlassMat = new THREE.MeshPhysicalMaterial({
    color: 0x7dd3fc,
    emissive: (timeMode === 'night' || timeMode === 'sunset' ? 0xffbb55 : 0x000000),
    emissiveIntensity: (timeMode === 'night' ? 0.75 : (timeMode === 'sunset' ? 0.45 : 0)),
    metalness: 0.3,
    roughness: 0.1,
    transmission: 0.8,
    transparent: true,
    opacity: 0.92
  });
  buildingMats.push(atriumGlassMat);

  var atriumMesh = new THREE.Mesh(atriumGeo, atriumGlassMat);
  atriumMesh.position.set(0, 18 + atriumH / 2, 0);
  atriumMesh.castShadow = true;
  grp.add(atriumMesh);

  // 中庭顶部三角形采光天幕棱形脊
  var roofRidge = new THREE.Mesh(
    new THREE.ConeGeometry(atriumW * 0.45, 3.5, 4),
    new THREE.MeshStandardMaterial({ color: 0x38bdf8, metalness: 0.8, roughness: 0.2, transparent: true, opacity: 0.85 })
  );
  roofRidge.rotation.y = Math.PI / 4;
  roofRidge.position.set(0, 18 + atriumH + 1.75, 0);
  grp.add(roofRidge);

  // ③ 南正门迎宾多级宽大台阶与门廊石柱
  var stairW = 38;
  for (var st = 0; st < 6; st++) {
    var stepMesh = new THREE.Mesh(
      new THREE.BoxGeometry(stairW - st * 1.2, 0.5, 3 + st * 1.8),
      new THREE.MeshStandardMaterial({ color: 0xd4d4d8, roughness: 0.75 })
    );
    stepMesh.position.set(0, (6 - st) * 0.25, -(b.size[1] / 2 + 1.5 + st * 1.8));
    stepMesh.receiveShadow = true;
    grp.add(stepMesh);
  }

  // 门厅石材廊柱
  // 门厅石材廊柱与首层通高玻璃大堂
  var libLobbyMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.75, roughness: 0.1, metalness: 0.25 });
  var libLobby = new THREE.Mesh(new THREE.BoxGeometry(32, 7.5, 3.2), libLobbyMat);
  libLobby.position.set(0, 3.75, -(b.size[1] / 2 + 0.2));
  grp.add(libLobby);

  [-15, -9, -3, 3, 9, 15].forEach(function(px) {
    var colMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 9, 1.6),
      new THREE.MeshStandardMaterial({ color: 0xc4b5a4, roughness: 0.65 })
    );
    colMesh.position.set(px, 18 / 2, -(b.size[1] / 2 + 0.8));
    colMesh.castShadow = true;
    grp.add(colMesh);
  });

  // ④ 楼顶暖通空调机组与排风塔
  [-46, 46].forEach(function(rx) {
    var equipMesh = new THREE.Mesh(
      new THREE.BoxGeometry(14, 3.2, 10),
      new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.8 })
    );
    equipMesh.position.set(rx, 18 + 1.6, 0);
    equipMesh.castShadow = true;
    grp.add(equipMesh);
  });

  // 馆名牌匾：“博厚图书馆”
  var libCanvas = textCanvas('博厚图书馆 · BOHOU LIBRARY', { fs: 38, color: '#fef08a', bg: 'rgba(15,23,42,0.88)', border: '#eab308' });
  var libTex = canvasTex(libCanvas);
  var libPlate = new THREE.Mesh(new THREE.PlaneGeometry(26, 3.8), new THREE.MeshBasicMaterial({ map: libTex, transparent: true, side: THREE.DoubleSide }));
  libPlate.rotation.y = Math.PI;
  libPlate.position.set(0, 16.5, -(b.size[1] / 2 + 1.2));
  grp.add(libPlate);

  return grp;
}

/* 3. 南湖校区历史地标：郭力楼（原苏式主教学楼 · 1952建校保护建筑 · 电气与电子工程学院） */
function buildGuoLiLou(b, campus) {
  var grp = new THREE.Group();

  // ① 经典苏式红砖长轴主楼基座（长轴 228 米对称“工”字型，高 16 米）
  var shape = new THREE.Shape();
  shape.moveTo(b.pts[0][0] - b.pos[0], -(b.pts[0][1] - b.pos[1]));
  for (var i = 1; i < b.pts.length; i++) {
    shape.lineTo(b.pts[i][0] - b.pos[0], -(b.pts[i][1] - b.pos[1]));
  }
  var baseGeo = new THREE.ExtrudeGeometry(shape, { depth: 16, bevelEnabled: false });
  baseGeo.rotateX(-Math.PI / 2);
  fixExtrudeUVs(baseGeo, 16);

  var redBrickMat = new THREE.MeshStandardMaterial({
    color: 0x99382d, // 经典苏式朱红清水砖墙
    roughness: 0.85,
    metalness: 0.1
  });
  buildingMats.push(redBrickMat);

  var baseMesh = new THREE.Mesh(baseGeo, [redBrickMat, redBrickMat]);
  baseMesh.position.set(0, 0, 0);
  baseMesh.castShadow = baseMesh.receiveShadow = true;
  grp.add(baseMesh);

  var edgeLines = new THREE.LineSegments(new THREE.EdgesGeometry(baseGeo, 40), getSharedNeonMaterial());
  baseMesh.add(edgeLines);

  // ② 经典苏式深绿琉璃瓦双坡坡屋顶（使用多边形挤压并出挑飞檐）
  var roofGeo = new THREE.ExtrudeGeometry(shape, { depth: 2.8, bevelEnabled: false });
  roofGeo.rotateX(-Math.PI / 2);
  var greenTileMat = new THREE.MeshStandardMaterial({
    color: 0x2b4c37, // 苏式墨绿琉璃瓦
    roughness: 0.65,
    metalness: 0.2
  });
  buildingMats.push(greenTileMat);
  var roofMesh = new THREE.Mesh(roofGeo, greenTileMat);
  roofMesh.position.set(0, 16, 0);
  roofMesh.castShadow = true;
  grp.add(roofMesh);

  // ③ 中轴对称古典石柱廊门厅与多立克古典柱
  var porticoW = 32, porticoH = 14;

  // 汉白玉苏式迎宾基座台阶（向北延伸迎宾）
  for (var st = 0; st < 4; st++) {
    var stMesh = new THREE.Mesh(
      new THREE.BoxGeometry(porticoW + 6 - st * 1.5, 0.35, 2.5 + st * 1.2),
      new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.8 })
    );
    stMesh.position.set(0, (4 - st) * 0.18, -(b.size[1] / 2 + 3.5 + st * 1.2));
    stMesh.receiveShadow = true;
    grp.add(stMesh);
  }

  // 门厅厚重苏式古典入户大门
  var doorMesh = new THREE.Mesh(
    new THREE.BoxGeometry(7, 4.5, 0.4),
    new THREE.MeshStandardMaterial({ color: 0x451a03, roughness: 0.7 })
  );
  doorMesh.position.set(0, 2.25, -(b.size[1] / 2 + 0.2));
  grp.add(doorMesh);

  [-12, -4, 4, 12].forEach(function(cx) {
    var col = new THREE.Mesh(
      new THREE.CylinderGeometry(0.7, 0.85, porticoH, 16),
      new THREE.MeshStandardMaterial({ color: 0xf5f3ee, roughness: 0.6 })
    );
    col.position.set(cx, porticoH / 2, -(b.size[1] / 2 + 3.2));
    col.castShadow = true;
    grp.add(col);
  });

  // 门厅古典三角山花山墙（Pediment）
  var pedimentGeo = new THREE.ConeGeometry(porticoW * 0.52, 4.2, 4);
  var pedimentMesh = new THREE.Mesh(pedimentGeo, new THREE.MeshStandardMaterial({ color: 0xeee8dc, roughness: 0.7 }));
  pedimentMesh.rotation.y = Math.PI / 4;
  pedimentMesh.position.set(0, 16 + 2.1, -(b.size[1] / 2 + 3.2));
  pedimentMesh.castShadow = true;
  grp.add(pedimentMesh);

  // 三角山花中央红星与建校标识（1952，朝北迎宾旋转180°+双面渲染）
  var starMesh = new THREE.Mesh(
    new THREE.CircleGeometry(1.2, 5),
    new THREE.MeshBasicMaterial({ color: 0xde2910, side: THREE.DoubleSide })
  );
  starMesh.rotation.y = Math.PI;
  starMesh.position.set(0, 16 + 2.0, -(b.size[1] / 2 + 5.8));
  grp.add(starMesh);

  // 正门金色匾额：“郭力楼 · 电气与电子工程学院”（朝北迎宾旋转180°+双面渲染）
  var sc = textCanvas('郭力楼 · 电气与电子工程学院', { fs: 34, color: '#fef08a', bg: 'rgba(80,20,15,0.92)', border: '#facc15' });
  var sp = new THREE.Mesh(new THREE.PlaneGeometry(22, 3.2), new THREE.MeshBasicMaterial({ map: canvasTex(sc), transparent: true, side: THREE.DoubleSide }));
  sp.rotation.y = Math.PI;
  sp.position.set(0, 14.2, -(b.size[1] / 2 + 3.8));
  grp.add(sp);

  return grp;
}

/* 4. 北湖东区主教学楼（东区主楼 · 259米大弧形长楼 · 数学与统计学院 / 经济管理学院 / 人文学院） */
function buildDongquZhuJiao(b, campus) {
  var grp = new THREE.Group();

  // ① 弧形主楼示意（5层，按 OpenStreetMap 建筑轮廓近似生成，高 18 米）
  var shape = new THREE.Shape();
  shape.moveTo(b.pts[0][0] - b.pos[0], -(b.pts[0][1] - b.pos[1]));
  for (var i = 1; i < b.pts.length; i++) {
    shape.lineTo(b.pts[i][0] - b.pos[0], -(b.pts[i][1] - b.pos[1]));
  }
  var baseGeo = new THREE.ExtrudeGeometry(shape, { depth: 18, bevelEnabled: false });
  baseGeo.rotateX(-Math.PI / 2);
  fixExtrudeUVs(baseGeo, 18);

  var mats = makeFacadeMaterial({ color: 0xd9825b, floors: 5, size: b.size, h: 18, photo: b.photo });
  var baseMesh = new THREE.Mesh(baseGeo, [mats[2], mats[0]]);
  baseMesh.position.set(0, 0, 0);
  baseMesh.castShadow = baseMesh.receiveShadow = true;
  grp.add(baseMesh);

  var edgeLines = new THREE.LineSegments(new THREE.EdgesGeometry(baseGeo, 40), getSharedNeonMaterial());
  baseMesh.add(edgeLines);

  // ② 沿弧形模型外轮廓生成的女儿墙（0.9米），避免矩形遮盖
  var parapetGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.9, bevelEnabled: false });
  parapetGeo.rotateX(-Math.PI / 2);
  var parapetMesh = new THREE.Mesh(parapetGeo, new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.8 }));
  parapetMesh.position.set(0, 18, 0);
  parapetMesh.castShadow = true;
  grp.add(parapetMesh);

  // ③ 弧形中轴主入口门厅与迎宾大堂（面向南侧内环绿化与庭院广场 Z = -3.2 ~ +5.0）
  var lobbyMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.75, roughness: 0.1, metalness: 0.25 });
  var lobbyMesh = new THREE.Mesh(new THREE.BoxGeometry(26, 5.2, 3), lobbyMat);
  lobbyMesh.position.set(0, 2.6, -3.0);
  grp.add(lobbyMesh);

  var entranceCanopy = new THREE.Mesh(
    new THREE.BoxGeometry(28, 0.8, 8),
    new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.6 })
  );
  entranceCanopy.position.set(0, 5.5, 0.5);
  entranceCanopy.castShadow = true;
  grp.add(entranceCanopy);

  [-11, 11].forEach(function(cx) {
    var col = new THREE.Mesh(
      new THREE.CylinderGeometry(0.45, 0.45, 5.5, 12),
      new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.7, roughness: 0.3 })
    );
    col.position.set(cx, 2.75, 4.0);
    col.castShadow = true;
    grp.add(col);
  });

  // 汉白玉迎宾台阶
  for (var st = 0; st < 3; st++) {
    var step = new THREE.Mesh(
      new THREE.BoxGeometry(32 - st * 1.5, 0.35, 2.2 + st * 1.0),
      new THREE.MeshStandardMaterial({ color: 0xd1d5db, roughness: 0.8 })
    );
    step.position.set(0, (3 - st) * 0.18, 1.2 + st * 1.2);
    step.receiveShadow = true;
    grp.add(step);
  }

  // ④ 楼顶大字标识与母院铭牌（朝南迎宾，双面渲染防背面剔除）
  var tc = textCanvas('长春工业大学 · 东区主教学楼', { fs: 36, color: '#ffffff', bg: 'rgba(15,23,42,0.90)', border: '#38bdf8' });
  var tp = new THREE.Mesh(new THREE.PlaneGeometry(28, 3.6), new THREE.MeshBasicMaterial({ map: canvasTex(tc), transparent: true, side: THREE.DoubleSide }));
  tp.position.set(0, 19.8, -3.2);
  grp.add(tp);

  // 母院指引铭牌（数学与统计学院 3F）
  var sc = textCanvas('数学与统计学院 (3F) · 经济管理学院 · 人文学院', { fs: 26, color: '#fef08a', bg: 'rgba(15,23,42,0.85)', border: '#f59e0b' });
  var sp = new THREE.Mesh(new THREE.PlaneGeometry(24, 2.6), new THREE.MeshBasicMaterial({ map: canvasTex(sc), transparent: true, side: THREE.DoubleSide }));
  sp.position.set(0, 6.2, 4.6);
  grp.add(sp);

  return grp;
}

/* 4b. 南湖田径运动场主看台（主席台 · 阶梯座席 · 白色钢架张拉膜挑棚 · 赛事转播裁判室） */
function buildGrandstand(b, campus) {
  var grp = new THREE.Group();
  var w = b.size ? b.size[0] : 126;
  var d = b.size ? b.size[1] : 20;
  var h = b.h || 8;

  // ① 钢筋混凝土看台后背墙与主体承重基座
  var baseGeo = new THREE.BoxGeometry(w, h, 3.5);
  var baseMat = new THREE.MeshStandardMaterial({ color: 0xd4d4d8, roughness: 0.75, metalness: 0.15 });
  var backWall = new THREE.Mesh(baseGeo, baseMat);
  backWall.position.set(0, h / 2, d / 2 - 1.75);
  backWall.castShadow = backWall.receiveShadow = true;
  grp.add(backWall);

  // 两侧封头山墙
  [-w / 2 + 1.2, w / 2 - 1.2].forEach(function(wx) {
    var endWall = new THREE.Mesh(
      new THREE.BoxGeometry(2.4, h, d),
      baseMat
    );
    endWall.position.set(wx, h / 2, 0);
    endWall.castShadow = endWall.receiveShadow = true;
    grp.add(endWall);
  });

  // ② 阶梯看台梯级（8级，从北往南向下递减面向田径场，-Z方向朝向跑道）
  var tiers = 8;
  var tierD = (d - 4.5) / tiers;
  for (var k = 0; k < tiers; k++) {
    var tZ = (d / 2 - 3.5) - (k + 0.5) * tierD;
    var tY = h - (k + 1) * ((h - 1.5) / tiers);
    var tH = ((h - 1.5) / tiers) + 0.3;
    var stepMesh = new THREE.Mesh(
      new THREE.BoxGeometry(w - 6, tH, tierD + 0.3),
      new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.8 })
    );
    stepMesh.position.set(0, tY + tH / 2, tZ);
    stepMesh.castShadow = stepMesh.receiveShadow = true;
    grp.add(stepMesh);

    // 观众看台座椅阵列（红白相间与深蓝分区）
    var seatColor = (k >= 2 && k <= 5 ? 0x2563eb : 0xd97706);
    var seatMat = new THREE.MeshStandardMaterial({ color: seatColor, roughness: 0.5 });
    var seatBlocks = 6;
    for (var sb = 0; sb < seatBlocks; sb++) {
      var sX = (sb - (seatBlocks - 1) / 2) * ((w - 18) / seatBlocks);
      var seatRow = new THREE.Mesh(
        new THREE.BoxGeometry((w - 24) / seatBlocks, 0.45, 0.55),
        seatMat
      );
      seatRow.position.set(sX, tY + tH + 0.22, tZ);
      seatRow.castShadow = true;
      grp.add(seatRow);
    }
  }

  // ③ 中央 VIP 主席台与赛事广播裁判室
  var rostrumW = 28, rostrumD = 8;
  var rostrumBase = new THREE.Mesh(
    new THREE.BoxGeometry(rostrumW, 1.2, rostrumD),
    new THREE.MeshStandardMaterial({ color: 0x991b1b, roughness: 0.6 })
  );
  rostrumBase.position.set(0, h * 0.65, 0);
  rostrumBase.receiveShadow = true;
  grp.add(rostrumBase);

  // 主席台长条领导与嘉宾检阅席长桌
  var table = new THREE.Mesh(
    new THREE.BoxGeometry(rostrumW - 6, 0.9, 1.2),
    new THREE.MeshStandardMaterial({ color: 0xb91c1c, roughness: 0.5 })
  );
  table.position.set(0, h * 0.65 + 0.6 + 0.45, -1.5);
  table.castShadow = true;
  grp.add(table);

  // 赛事播报与裁判工作室（全景玻璃观察室，位于看台顶部中央后方）
  var boothMesh = new THREE.Mesh(
    new THREE.BoxGeometry(22, 3.8, 5),
    new THREE.MeshStandardMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.75, roughness: 0.1, metalness: 0.3 })
  );
  boothMesh.position.set(0, h + 1.9, d / 2 - 2.5);
  boothMesh.castShadow = true;
  grp.add(boothMesh);

  // ④ 大跨度白色轻钢挑棚顶棚（张拉膜结构）
  var canopyW = w - 2;
  var canopyD = d * 1.05;
  var canopyRoof = new THREE.Mesh(
    new THREE.BoxGeometry(canopyW, 0.55, canopyD),
    new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.25, metalness: 0.1, side: THREE.DoubleSide })
  );
  canopyRoof.position.set(0, h + 5.2, -1.0);
  canopyRoof.rotation.x = 0.06;
  canopyRoof.castShadow = true;
  grp.add(canopyRoof);

  // 顶棚后方钢柱支撑桁架
  [-w * 0.38, -w * 0.18, 0, w * 0.18, w * 0.38].forEach(function(px) {
    var mast = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.45, h + 6, 8),
      new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.8, roughness: 0.2 })
    );
    mast.position.set(px, (h + 6) / 2, d / 2 - 1.2);
    mast.castShadow = true;
    grp.add(mast);
  });

  // ⑤ 看台前沿不锈钢安全护栏（面向跑道侧 -Z）
  var railMesh = new THREE.Mesh(
    new THREE.BoxGeometry(w - 4, 1.1, 0.2),
    new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.85, roughness: 0.2 })
  );
  railMesh.position.set(0, 1.8, -d / 2 + 1.2);
  railMesh.castShadow = true;
  grp.add(railMesh);

  // ⑥ 主席台标识牌匾（面向田径场南侧 -Z）
  var signCanvas = textCanvas('长春工业大学田径运动场 · 主席台', { fs: 36, color: '#fef08a', bg: 'rgba(15,23,42,0.88)', border: '#38bdf8' });
  var signPlate = new THREE.Mesh(
    new THREE.PlaneGeometry(28, 3.6),
    new THREE.MeshBasicMaterial({ map: canvasTex(signCanvas), transparent: true, side: THREE.DoubleSide })
  );
  signPlate.rotation.y = Math.PI;
  signPlate.position.set(0, h + 5.2, -d / 2);
  grp.add(signPlate);

  var neonLines = new THREE.LineSegments(new THREE.EdgesGeometry(baseGeo), getSharedNeonMaterial());
  backWall.add(neonLines);

  return grp;
}

/* 4c. 东区文体活动中心（大学生活动中心 · 弧形大跨度天幕穹顶 · 双层通高幕墙） */
function buildActivityCenter(b, campus) {
  var grp = new THREE.Group();

  // ① 多边形轮廓基座示意（3层，高 11 米）
  var shape = new THREE.Shape();
  shape.moveTo(b.pts[0][0] - b.pos[0], -(b.pts[0][1] - b.pos[1]));
  for (var i = 1; i < b.pts.length; i++) {
    shape.lineTo(b.pts[i][0] - b.pos[0], -(b.pts[i][1] - b.pos[1]));
  }
  var baseGeo = new THREE.ExtrudeGeometry(shape, { depth: 11, bevelEnabled: false });
  baseGeo.rotateX(-Math.PI / 2);
  fixExtrudeUVs(baseGeo, 11);

  var mats = makeFacadeMaterial({ color: 0x38bdf8, floors: 3, size: b.size, h: 11, photo: b.photo });
  var baseMesh = new THREE.Mesh(baseGeo, [mats[2], mats[0]]);
  baseMesh.position.set(0, 0, 0);
  baseMesh.castShadow = baseMesh.receiveShadow = true;
  grp.add(baseMesh);

  var edgeLines = new THREE.LineSegments(new THREE.EdgesGeometry(baseGeo, 40), getSharedNeonMaterial());
  baseMesh.add(edgeLines);

  // ② 屋顶大跨度采光天幕穹顶（半圆柱拱形白色张拉膜）
  var domeW = 58, domeD = 32;
  var archGeo = new THREE.CylinderGeometry(domeD * 0.5, domeD * 0.5, domeW, 32, 1, false, 0, Math.PI);
  var archMat = new THREE.MeshStandardMaterial({
    color: 0xf8fafc,
    roughness: 0.3,
    metalness: 0.15,
    side: THREE.DoubleSide
  });
  var archMesh = new THREE.Mesh(archGeo, archMat);
  archMesh.rotation.z = Math.PI / 2;
  archMesh.position.set(0, 11, 0);
  archMesh.castShadow = true;
  grp.add(archMesh);

  // 穹顶钢结构天窗拱肋
  [-20, 0, 20].forEach(function(ax) {
    var rib = new THREE.Mesh(
      new THREE.CylinderGeometry(domeD * 0.52, domeD * 0.52, 1.2, 32, 1, false, 0, Math.PI),
      new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.6 })
    );
    rib.rotation.z = Math.PI / 2;
    rib.position.set(ax, 11, 0);
    grp.add(rib);
  });

  // ③ 南正门迎宾门厅雨棚与大堂台阶
  var canopyW = 24, canopyD = 7, canopyH = 4.8;
  var canopyMesh = new THREE.Mesh(
    new THREE.BoxGeometry(canopyW, 0.6, canopyD),
    new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.6 })
  );
  canopyMesh.position.set(0, canopyH, -(b.size[1] / 2 + 1.2));
  canopyMesh.castShadow = true;
  grp.add(canopyMesh);

  [-9, 9].forEach(function(cx) {
    var col = new THREE.Mesh(
      new THREE.CylinderGeometry(0.4, 0.4, canopyH, 12),
      new THREE.MeshStandardMaterial({ color: 0xcfd8dc, metalness: 0.8, roughness: 0.2 })
    );
    col.position.set(cx, canopyH / 2, -(b.size[1] / 2 + 3.8));
    col.castShadow = true;
    grp.add(col);
  });

  // 迎宾石阶
  for (var st = 0; st < 3; st++) {
    var step = new THREE.Mesh(
      new THREE.BoxGeometry(canopyW + 2 - st * 1.2, 0.35, 2.2 + st * 1.0),
      new THREE.MeshStandardMaterial({ color: 0xd1d5db, roughness: 0.8 })
    );
    step.position.set(0, (3 - st) * 0.18, -(b.size[1] / 2 + 2.0 + st * 1.1));
    step.receiveShadow = true;
    grp.add(step);
  }

  // ④ 大楼名称标识牌匾
  var signCanvas = textCanvas('大学生活动中心 · 文体中心', { fs: 34, color: '#fef08a', bg: 'rgba(15,23,42,0.88)', border: '#38bdf8' });
  var signPlate = new THREE.Mesh(
    new THREE.PlaneGeometry(22, 3.4),
    new THREE.MeshBasicMaterial({ map: canvasTex(signCanvas), transparent: true, side: THREE.DoubleSide })
  );
  signPlate.rotation.y = Math.PI;
  signPlate.position.set(0, canopyH + 1.6, -(b.size[1] / 2 + 1.2));
  grp.add(signPlate);

  return grp;
}

/* 4d. 长春工业大学数学与统计学院（数学与统计科技楼 · 6层现代主楼 + 3层学术报告厅 + 顶层大数据智能计算中心） */
function buildMathStatsBuilding(b, campus) {
  var grp = new THREE.Group();
  var h = b.h || 22;

  // ① 6层科技主楼
  var mainW = 76, mainD = 28;
  var mainGeo = new THREE.BoxGeometry(mainW, h, mainD);
  var whiteMat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.4, metalness: 0.2 });
  var glassRibbonMat = new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.1, metalness: 0.3, transparent: true, opacity: 0.85 });
  buildingMats.push(whiteMat);
  buildingMats.push(glassRibbonMat);

  var mainMesh = new THREE.Mesh(mainGeo, whiteMat);
  mainMesh.position.set(6, h / 2, 0);
  mainMesh.castShadow = mainMesh.receiveShadow = true;
  grp.add(mainMesh);

  var mainEdges = new THREE.LineSegments(new THREE.EdgesGeometry(mainGeo, 40), getSharedNeonMaterial());
  mainMesh.add(mainEdges);

  // 幕墙横向 Low-E 采光玻璃窗带（6 层）
  for (var f = 1; f <= 5; f++) {
    var winRibbon = new THREE.Mesh(
      new THREE.BoxGeometry(mainW + 0.2, 1.8, mainD + 0.2),
      glassRibbonMat
    );
    winRibbon.position.set(6, f * 3.6, 0);
    grp.add(winRibbon);
  }

  // ② 西侧 3 层学术报告厅与学术交流中心（弧形屋顶，深蓝色金属包边）
  var hallW = 28, hallD = 34, hallH = 12;
  var hallMesh = new THREE.Mesh(
    new THREE.BoxGeometry(hallW, hallH, hallD),
    new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.5, metalness: 0.4 })
  );
  hallMesh.position.set(-hallW / 2 - 10, hallH / 2, 6);
  hallMesh.castShadow = hallMesh.receiveShadow = true;
  grp.add(hallMesh);

  var hallEdges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(hallW, hallH, hallD), 40), getSharedNeonMaterial());
  hallMesh.add(hallEdges);

  // 报告厅声学拱形穹顶
  var archGeo = new THREE.CylinderGeometry(hallD * 0.52, hallD * 0.52, hallW * 0.98, 24, 1, false, 0, Math.PI);
  var archMat = new THREE.MeshStandardMaterial({ color: 0x0284c7, metalness: 0.6, roughness: 0.3, side: THREE.DoubleSide });
  var hallArch = new THREE.Mesh(archGeo, archMat);
  hallArch.rotation.z = Math.PI / 2;
  hallArch.position.set(-hallW / 2 - 10, hallH, 6);
  hallArch.castShadow = true;
  grp.add(hallArch);

  // ③ 4层通高中庭采光玻璃连廊（连接主楼与学术报告厅）
  var linkMesh = new THREE.Mesh(
    new THREE.BoxGeometry(16, 14, 16),
    new THREE.MeshStandardMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.72, roughness: 0.1, metalness: 0.3 })
  );
  linkMesh.position.set(-10, 7, 2);
  linkMesh.castShadow = true;
  grp.add(linkMesh);

  // ④ 主楼屋顶：大数据与智能计算中心机房 + 太阳能光伏阵列
  var pentMesh = new THREE.Mesh(
    new THREE.BoxGeometry(28, 4.0, 16),
    new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.6, metalness: 0.5 })
  );
  pentMesh.position.set(12, h + 2.0, 0);
  pentMesh.castShadow = true;
  grp.add(pentMesh);

  // 楼顶光伏电池板
  [-12, 0, 12].forEach(function(ox) {
    var pv = new THREE.Mesh(
      new THREE.BoxGeometry(8, 0.3, 10),
      new THREE.MeshStandardMaterial({ color: 0x1d4ed8, metalness: 0.8, roughness: 0.2 })
    );
    pv.rotation.x = -0.2;
    pv.position.set(ox, h + 1.2, -6);
    pv.castShadow = true;
    grp.add(pv);
  });

  // ⑤ 西迎宾主入口：出挑大雨棚、立柱、汉白玉石阶与迎宾铜匾
  var canopyW = 20, canopyD = 6.5, canopyH = 5.2;
  var canopyMesh = new THREE.Mesh(
    new THREE.BoxGeometry(canopyW, 0.7, canopyD),
    new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.5, metalness: 0.6 })
  );
  canopyMesh.position.set(6, canopyH, mainD / 2 + canopyD / 2 - 0.5);
  canopyMesh.castShadow = true;
  grp.add(canopyMesh);

  [-7.5, 7.5].forEach(function(cx) {
    var col = new THREE.Mesh(
      new THREE.CylinderGeometry(0.45, 0.45, canopyH, 12),
      new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.8, roughness: 0.2 })
    );
    col.position.set(6 + cx, canopyH / 2, mainD / 2 + canopyD - 1.0);
    col.castShadow = true;
    grp.add(col);
  });

  // 迎宾石阶
  for (var st = 0; st < 4; st++) {
    var step = new THREE.Mesh(
      new THREE.BoxGeometry(canopyW + 2 - st * 1.0, 0.28, 2.2 + st * 0.8),
      new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.8 })
    );
    step.position.set(6, (4 - st) * 0.14, mainD / 2 + 1.5 + st * 0.8);
    step.receiveShadow = true;
    grp.add(step);
  }

  // 门楣金色铜匾牌匾（正反双面渲染，朝南向迎宾）
  var sc = textCanvas('数学与统计学院', { fs: 36, color: '#fef08a', bg: 'rgba(15,23,42,0.92)', border: '#38bdf8' });
  var sp = new THREE.Mesh(
    new THREE.PlaneGeometry(16, 2.6),
    new THREE.MeshBasicMaterial({ map: canvasTex(sc), transparent: true, side: THREE.DoubleSide })
  );
  sp.position.set(6, canopyH + 1.6, mainD / 2 + 0.2);
  grp.add(sp);

  // 楼顶朝南发光字：“长春工业大学 数学与统计学院”
  var roofSignCanvas = textCanvas('长春工业大学 数学与统计学院 · 数据科学重点实验室', { fs: 32, color: '#f8fafc', bg: 'rgba(2,132,199,0.92)', border: '#67e8f9' });
  var roofSign = new THREE.Mesh(
    new THREE.PlaneGeometry(36, 3.2),
    new THREE.MeshBasicMaterial({ map: canvasTex(roofSignCanvas), transparent: true, side: THREE.DoubleSide })
  );
  roofSign.position.set(6, h + 2.2, mainD / 2 + 0.1);
  grp.add(roofSign);

  return grp;
}

/* 计算建筑最长主迎宾外墙立面位置与法线偏角（消除穿模、错位与反面剔除） */
function getPrimaryFacade(b) {
  if (!b.pts || b.pts.length < 3) {
    var halfD = (b.size ? b.size[1] : 20) / 2;
    return {
      pos: [0, -halfD],
      rot: Math.PI,
      width: (b.size ? b.size[0] : 30)
    };
  }
  var bestEdge = null;
  var maxLen = 0;
  for (var i = 0; i < b.pts.length - 1; i++) {
    var p1 = b.pts[i], p2 = b.pts[i + 1];
    var dx = p2[0] - p1[0], dz = p2[1] - p1[1];
    var len = Math.hypot(dx, dz);
    if (len > maxLen) {
      maxLen = len;
      var mx = (p1[0] + p2[0]) / 2 - b.pos[0];
      var mz = (p1[1] + p2[1]) / 2 - b.pos[1];
      var nx = -dz / len, nz = dx / len;
      if (nx * mx + nz * mz < 0) { nx = -nx; nz = -nz; }
      var normalAngle = Math.atan2(nx, nz);
      bestEdge = {
        pos: [mx, mz],
        rot: normalAngle,
        width: len
      };
    }
  }
  return bestEdge || { pos: [0, -((b.size ? b.size[1] : 20) / 2)], rot: Math.PI, width: 30 };
}

/* 5. 现代工科教学科研楼（计算机楼 / 材料楼 / 化工楼 / 艺术楼 / 传播楼 / 基础楼 / 逸夫楼 / 机械楼） */
function buildCollegeBuilding(b, campus) {
  var grp = new THREE.Group();
  var h = b.h || 18;

  var shape = new THREE.Shape();
  if (b.pts && b.pts.length >= 3) {
    shape.moveTo(b.pts[0][0] - b.pos[0], -(b.pts[0][1] - b.pos[1]));
    for (var i = 1; i < b.pts.length; i++) {
      shape.lineTo(b.pts[i][0] - b.pos[0], -(b.pts[i][1] - b.pos[1]));
    }
  } else {
    var hw = (b.size ? b.size[0] : 60) / 2, hd = (b.size ? b.size[1] : 30) / 2;
    shape.moveTo(-hw, -hd); shape.lineTo(hw, -hd); shape.lineTo(hw, hd); shape.lineTo(-hw, hd); shape.lineTo(-hw, -hd);
  }

  var baseGeo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
  baseGeo.rotateX(-Math.PI / 2);
  fixExtrudeUVs(baseGeo, h);

  var mats = makeFacadeMaterial(b);
  var baseMesh = new THREE.Mesh(baseGeo, [mats[2], mats[0]]);
  baseMesh.position.set(0, 0, 0);
  baseMesh.castShadow = baseMesh.receiveShadow = true;
  grp.add(baseMesh);

  var edgeLines = new THREE.LineSegments(new THREE.EdgesGeometry(baseGeo, 40), getSharedNeonMaterial());
  baseMesh.add(edgeLines);

  // 顶层女儿墙
  var parapetGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.9, bevelEnabled: false });
  parapetGeo.rotateX(-Math.PI / 2);
  var parapetMesh = new THREE.Mesh(parapetGeo, new THREE.MeshStandardMaterial({ color: shade(b.color, 0.75), roughness: 0.8 }));
  parapetMesh.position.set(0, h, 0);
  grp.add(parapetMesh);

  // 楼顶排烟/空调机房与太阳能模块
  var pw = Math.min(18, (b.size ? b.size[0] : 40) * 0.3);
  var pd = Math.min(12, (b.size ? b.size[1] : 20) * 0.3);
  var pent = new THREE.Mesh(
    new THREE.BoxGeometry(pw, 3.2, pd),
    new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.7 })
  );
  pent.position.set(0, h + 1.6, 0);
  pent.castShadow = true;
  grp.add(pent);

  // 主迎宾外立面门廊与专属名牌（依据外墙几何法线自动对齐，杜绝错位与穿模）
  var f = getPrimaryFacade(b);
  var entGrp = new THREE.Group();
  entGrp.position.set(f.pos[0], 0, f.pos[1]);
  entGrp.rotation.y = f.rot;

  var canopyW = Math.min(22, Math.max(12, f.width * 0.32));
  var canopyD = 4.8;
  var canopy = new THREE.Mesh(
    new THREE.BoxGeometry(canopyW, 0.6, canopyD),
    new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.6 })
  );
  canopy.position.set(0, 4.2, canopyD / 2);
  canopy.castShadow = true;
  entGrp.add(canopy);

  // 门廊立柱
  [-canopyW * 0.4, canopyW * 0.4].forEach(function(px) {
    var col = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.35, 4.2, 12),
      new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.4 })
    );
    col.position.set(px, 2.1, canopyD - 0.6);
    col.castShadow = true;
    entGrp.add(col);
  });

  // 迎宾石阶
  for (var st = 0; st < 3; st++) {
    var step = new THREE.Mesh(
      new THREE.BoxGeometry(canopyW + 2 - st * 1.0, 0.25, 1.8 + st * 0.8),
      new THREE.MeshStandardMaterial({ color: 0xd1d5db, roughness: 0.8 })
    );
    step.position.set(0, (3 - st) * 0.12, 1.0 + st * 0.8);
    step.receiveShadow = true;
    entGrp.add(step);
  }

  // 建筑专属门牌铭匾（正反双面渲染，朝向外侧迎宾）
  var shortName = b.name.split('（')[0].replace('教学科研楼', '楼').replace('实验教学楼', '楼');
  var sc = textCanvas(shortName, { fs: 30, color: '#f8fafc', bg: 'rgba(15,23,42,0.92)', border: '#38bdf8' });
  var sp = new THREE.Mesh(
    new THREE.PlaneGeometry(Math.min(canopyW * 0.85, 20), 2.2),
    new THREE.MeshBasicMaterial({ map: canvasTex(sc), transparent: true, side: THREE.DoubleSide })
  );
  sp.position.set(0, 5.6, 0.2);
  entGrp.add(sp);

  grp.add(entGrp);

  return grp;
}

/* 6. 高校大型多功能餐饮服务中心（西区第一食堂 / 东区第二食堂 / 南湖食堂） */
function buildCanteenBuilding(b, campus) {
  var grp = new THREE.Group();
  var h = b.h || 14;

  var shape = new THREE.Shape();
  if (b.pts && b.pts.length >= 3) {
    shape.moveTo(b.pts[0][0] - b.pos[0], -(b.pts[0][1] - b.pos[1]));
    for (var i = 1; i < b.pts.length; i++) {
      shape.lineTo(b.pts[i][0] - b.pos[0], -(b.pts[i][1] - b.pos[1]));
    }
  } else {
    var hw = (b.size ? b.size[0] : 70) / 2, hd = (b.size ? b.size[1] : 70) / 2;
    shape.moveTo(-hw, -hd); shape.lineTo(hw, -hd); shape.lineTo(hw, hd); shape.lineTo(-hw, hd); shape.lineTo(-hw, -hd);
  }

  var baseGeo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
  baseGeo.rotateX(-Math.PI / 2);
  fixExtrudeUVs(baseGeo, h);

  var mats = makeFacadeMaterial(b);
  var baseMesh = new THREE.Mesh(baseGeo, [mats[2], mats[0]]);
  baseMesh.position.set(0, 0, 0);
  baseMesh.castShadow = baseMesh.receiveShadow = true;
  grp.add(baseMesh);

  var edgeLines = new THREE.LineSegments(new THREE.EdgesGeometry(baseGeo, 40), getSharedNeonMaterial());
  baseMesh.add(edgeLines);

  // 顶层女儿墙
  var parapetGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.9, bevelEnabled: false });
  parapetGeo.rotateX(-Math.PI / 2);
  var parapetMesh = new THREE.Mesh(parapetGeo, new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.8 }));
  parapetMesh.position.set(0, h, 0);
  grp.add(parapetMesh);

  // 食堂楼顶大型排烟通风净化机组
  [-16, 16].forEach(function(ox) {
    var vent = new THREE.Mesh(
      new THREE.CylinderGeometry(2.5, 3.2, 4.0, 16),
      new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.8, roughness: 0.3 })
    );
    vent.position.set(ox, h + 2.0, 0);
    vent.castShadow = true;
    grp.add(vent);
  });

  // 餐饮中心迎宾门头与大堂入口（依据模型外墙位置近似对齐）
  var f = getPrimaryFacade(b);
  var entGrp = new THREE.Group();
  entGrp.position.set(f.pos[0], 0, f.pos[1]);
  entGrp.rotation.y = f.rot;

  var canW = Math.min(26, Math.max(16, f.width * 0.35));
  var canD = 6.0;
  var entranceCanopy = new THREE.Mesh(
    new THREE.BoxGeometry(canW, 0.8, canD),
    new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.5 })
  );
  entranceCanopy.position.set(0, 4.8, canD / 2);
  entranceCanopy.castShadow = true;
  entGrp.add(entranceCanopy);

  // 门头立柱
  [-canW * 0.42, canW * 0.42].forEach(function(px) {
    var col = new THREE.Mesh(
      new THREE.CylinderGeometry(0.4, 0.4, 4.8, 12),
      new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.5 })
    );
    col.position.set(px, 2.4, canD - 0.6);
    col.castShadow = true;
    entGrp.add(col);
  });

  // 餐饮石阶
  for (var st = 0; st < 3; st++) {
    var step = new THREE.Mesh(
      new THREE.BoxGeometry(canW + 2 - st * 1.0, 0.28, 2.0 + st * 0.8),
      new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.8 })
    );
    step.position.set(0, (3 - st) * 0.14, 1.2 + st * 0.8);
    step.receiveShadow = true;
    entGrp.add(step);
  }

  // 餐饮服务中心招牌（正反双面渲染）
  var cName = b.name.split('（')[0];
  var sc = textCanvas(cName + ' · 师生餐饮服务中心', { fs: 30, color: '#fef3c7', bg: 'rgba(180,83,9,0.92)', border: '#fbbf24' });
  var sp = new THREE.Mesh(
    new THREE.PlaneGeometry(Math.min(canW * 0.9, 24), 2.8),
    new THREE.MeshBasicMaterial({ map: canvasTex(sc), transparent: true, side: THREE.DoubleSide })
  );
  sp.position.set(0, 6.2, 0.2);
  entGrp.add(sp);

  grp.add(entGrp);

  return grp;
}

/* 7. 标准高校学生宿舍楼群（西区1-10栋 / 东区1-7栋 / 南湖宿舍群 · 6层阳台立面） */
function buildDormBuilding(b, campus) {
  var grp = new THREE.Group();
  var h = b.h || 21;

  var shape = new THREE.Shape();
  if (b.pts && b.pts.length >= 3) {
    shape.moveTo(b.pts[0][0] - b.pos[0], -(b.pts[0][1] - b.pos[1]));
    for (var i = 1; i < b.pts.length; i++) {
      shape.lineTo(b.pts[i][0] - b.pos[0], -(b.pts[i][1] - b.pos[1]));
    }
  } else {
    var hw = (b.size ? b.size[0] : 68) / 2, hd = (b.size ? b.size[1] : 20) / 2;
    shape.moveTo(-hw, -hd); shape.lineTo(hw, -hd); shape.lineTo(hw, hd); shape.lineTo(-hw, hd); shape.lineTo(-hw, -hd);
  }

  var baseGeo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
  baseGeo.rotateX(-Math.PI / 2);
  fixExtrudeUVs(baseGeo, h);

  var mats = makeFacadeMaterial(b);
  var baseMesh = new THREE.Mesh(baseGeo, [mats[2], mats[0]]);
  baseMesh.position.set(0, 0, 0);
  baseMesh.castShadow = baseMesh.receiveShadow = true;
  grp.add(baseMesh);

  var edgeLines = new THREE.LineSegments(new THREE.EdgesGeometry(baseGeo, 40), getSharedNeonMaterial());
  baseMesh.add(edgeLines);

  // 顶层女儿墙
  var parapetGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.9, bevelEnabled: false });
  parapetGeo.rotateX(-Math.PI / 2);
  var parapetMesh = new THREE.Mesh(parapetGeo, new THREE.MeshStandardMaterial({ color: 0x9a3412, roughness: 0.8 }));
  parapetMesh.position.set(0, h, 0);
  grp.add(parapetMesh);

  // 宿舍楼顶双侧楼梯间/电梯机房凸起
  var w = b.size ? b.size[0] : 60;
  [-w * 0.25, w * 0.25].forEach(function(px) {
    var stairHut = new THREE.Mesh(
      new THREE.BoxGeometry(8, 2.8, 7),
      new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.7 })
    );
    stairHut.position.set(px, h + 1.4, 0);
    stairHut.castShadow = true;
    grp.add(stairHut);
  });

  // 宿舍单元入口门斗与栋号标牌（依据立面法线自动对齐外墙）
  var f = getPrimaryFacade(b);
  var entGrp = new THREE.Group();
  entGrp.position.set(f.pos[0], 0, f.pos[1]);
  entGrp.rotation.y = f.rot;

  var porchW = 8, porchD = 3.2;
  var porch = new THREE.Mesh(
    new THREE.BoxGeometry(porchW, 3.2, porchD),
    new THREE.MeshStandardMaterial({ color: 0xeee8dc, roughness: 0.7 })
  );
  porch.position.set(0, 1.6, porchD / 2);
  porch.castShadow = true;
  entGrp.add(porch);

  // 入口踏步
  var stoop = new THREE.Mesh(
    new THREE.BoxGeometry(porchW + 1.2, 0.35, 1.8),
    new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.8 })
  );
  stoop.position.set(0, 0.18, porchD + 0.9);
  stoop.receiveShadow = true;
  entGrp.add(stoop);

  // 栋号标牌（正反双面渲染）
  var sc = textCanvas(b.name, { fs: 28, color: '#fef08a', bg: 'rgba(15,23,42,0.92)', border: '#f59e0b' });
  var sp = new THREE.Mesh(
    new THREE.PlaneGeometry(6.4, 1.6),
    new THREE.MeshBasicMaterial({ map: canvasTex(sc), transparent: true, side: THREE.DoubleSide })
  );
  sp.position.set(0, 3.5, porchD + 0.1);
  entGrp.add(sp);

  grp.add(entGrp);

  return grp;
}

/* 8. 生活服务苑（知理苑 / 知行苑 / 知义苑 / 雅逸苑 / 知远苑 / 知信苑 / 雅馨苑 / 雅慧苑） */
function buildServiceYuan(b, campus) {
  var grp = new THREE.Group();
  var h = b.h || 11;

  var shape = new THREE.Shape();
  if (b.pts && b.pts.length >= 3) {
    shape.moveTo(b.pts[0][0] - b.pos[0], -(b.pts[0][1] - b.pos[1]));
    for (var i = 1; i < b.pts.length; i++) {
      shape.lineTo(b.pts[i][0] - b.pos[0], -(b.pts[i][1] - b.pos[1]));
    }
  } else {
    var hw = (b.size ? b.size[0] : 30) / 2, hd = (b.size ? b.size[1] : 15) / 2;
    shape.moveTo(-hw, -hd); shape.lineTo(hw, -hd); shape.lineTo(hw, hd); shape.lineTo(-hw, hd); shape.lineTo(-hw, -hd);
  }

  var baseGeo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
  baseGeo.rotateX(-Math.PI / 2);
  fixExtrudeUVs(baseGeo, h);

  var mats = makeFacadeMaterial(b);
  var baseMesh = new THREE.Mesh(baseGeo, [mats[2], mats[0]]);
  baseMesh.position.set(0, 0, 0);
  baseMesh.castShadow = baseMesh.receiveShadow = true;
  grp.add(baseMesh);

  var edgeLines = new THREE.LineSegments(new THREE.EdgesGeometry(baseGeo, 40), getSharedNeonMaterial());
  baseMesh.add(edgeLines);

  // 便民生活服务苑门廊与招牌（自动对齐外墙）
  var f = getPrimaryFacade(b);
  var entGrp = new THREE.Group();
  entGrp.position.set(f.pos[0], 0, f.pos[1]);
  entGrp.rotation.y = f.rot;

  var awnW = Math.min(18, Math.max(10, f.width * 0.6));
  var awnD = 3.0;
  var awning = new THREE.Mesh(
    new THREE.BoxGeometry(awnW, 0.4, awnD),
    new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.5 })
  );
  awning.position.set(0, 3.8, awnD / 2);
  awning.castShadow = true;
  entGrp.add(awning);

  // 便民生活服务苑招牌（正反双面渲染）
  var sc = textCanvas(b.name + ' · 便民生活服务', { fs: 26, color: '#ffedd5', bg: 'rgba(124,45,18,0.92)', border: '#fb923c' });
  var sp = new THREE.Mesh(
    new THREE.PlaneGeometry(12, 2.2),
    new THREE.MeshBasicMaterial({ map: canvasTex(sc), transparent: true, side: THREE.DoubleSide })
  );
  sp.position.set(0, 4.8, 0.2);
  entGrp.add(sp);

  grp.add(entGrp);

  return grp;
}

/* 9. 南湖校区红砖图书馆（经典苏式红砖历史建筑 · 5层 · 西南迎宾多柱门廊 · 坡顶双坡老虎窗） */
function buildNanhuLibrary(b, campus) {
  var grp = new THREE.Group();
  var h = b.h || 18;

  var shape = new THREE.Shape();
  if (b.pts && b.pts.length >= 3) {
    shape.moveTo(b.pts[0][0] - b.pos[0], -(b.pts[0][1] - b.pos[1]));
    for (var i = 1; i < b.pts.length; i++) {
      shape.lineTo(b.pts[i][0] - b.pos[0], -(b.pts[i][1] - b.pos[1]));
    }
  } else {
    var hw = (b.size ? b.size[0] : 80) / 2, hd = (b.size ? b.size[1] : 60) / 2;
    shape.moveTo(-hw, -hd); shape.lineTo(hw, -hd); shape.lineTo(hw, hd); shape.lineTo(-hw, hd); shape.lineTo(-hw, -hd);
  }

  // ① 5层苏式红砖主体
  var baseGeo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
  baseGeo.rotateX(-Math.PI / 2);
  fixExtrudeUVs(baseGeo, h);

  var redMat = new THREE.MeshStandardMaterial({ color: 0x9e3a2b, roughness: 0.85, metalness: 0.1 });
  buildingMats.push(redMat);
  var baseMesh = new THREE.Mesh(baseGeo, [redMat, redMat]);
  baseMesh.position.set(0, 0, 0);
  baseMesh.castShadow = baseMesh.receiveShadow = true;
  grp.add(baseMesh);

  var edgeLines = new THREE.LineSegments(new THREE.EdgesGeometry(baseGeo, 40), getSharedNeonMaterial());
  baseMesh.add(edgeLines);

  // ② 苏式古典出挑屋檐与红褐色歇山双坡瓦顶
  var roofGeo = new THREE.ExtrudeGeometry(shape, { depth: 3.2, bevelEnabled: false });
  roofGeo.rotateX(-Math.PI / 2);
  var roofMat = new THREE.MeshStandardMaterial({ color: 0x5a231b, roughness: 0.65, metalness: 0.15 });
  buildingMats.push(roofMat);
  var roofMesh = new THREE.Mesh(roofGeo, roofMat);
  roofMesh.position.set(0, h, 0);
  roofMesh.castShadow = true;
  grp.add(roofMesh);

  // ③ 标志性西南立面迎宾多柱古典柱廊与门厅
  // 模型坐标下的西南外墙中点与朝向近似值
  var entGrp = new THREE.Group();
  entGrp.position.set(-26.7, 0, 25.75);
  entGrp.rotation.y = -Math.PI / 4;

  var porticoW = 24, porticoD = 6.5, porticoH = 11;
  // 雨棚挑檐与古典三角山花山墙
  var pedimentGeo = new THREE.ConeGeometry(porticoW * 0.52, 3.2, 4);
  var pedimentMat = new THREE.MeshStandardMaterial({ color: 0xdecbb7, roughness: 0.7 });
  var pediment = new THREE.Mesh(pedimentGeo, pedimentMat);
  pediment.rotation.y = Math.PI / 4;
  pediment.position.set(0, porticoH + 1.6, porticoD / 2);
  pediment.castShadow = true;
  entGrp.add(pediment);

  // 门廊柱顶平梁
  var architrave = new THREE.Mesh(
    new THREE.BoxGeometry(porticoW, 0.8, porticoD),
    new THREE.MeshStandardMaterial({ color: 0xecd9c6, roughness: 0.6 })
  );
  architrave.position.set(0, porticoH, porticoD / 2);
  architrave.castShadow = true;
  entGrp.add(architrave);

  // 4 根通高苏式汉白玉立柱
  [-8.5, -2.8, 2.8, 8.5].forEach(function(cx) {
    var col = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.65, porticoH, 16),
      new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.4, metalness: 0.1 })
    );
    col.position.set(cx, porticoH / 2, porticoD - 0.7);
    col.castShadow = true;
    entGrp.add(col);
  });

  // 汉白玉迎宾五级石阶
  for (var st = 0; st < 5; st++) {
    var step = new THREE.Mesh(
      new THREE.BoxGeometry(porticoW + 3 - st * 1.2, 0.3, 2.5 + st * 0.9),
      new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.8 })
    );
    step.position.set(0, (5 - st) * 0.15, 2.0 + st * 0.9);
    step.receiveShadow = true;
    entGrp.add(step);
  }

  // 首层欧式双扇玻璃入馆大堂
  var lobbyMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.75, roughness: 0.1 });
  var lobbyMesh = new THREE.Mesh(new THREE.BoxGeometry(18, 4.2, 1.2), lobbyMat);
  lobbyMesh.position.set(0, 2.1, 0.6);
  entGrp.add(lobbyMesh);

  // 门楣金色铜匾牌匾（正反双面渲染）
  var libCanvas = textCanvas('南湖图书馆 · 历史文化建筑', { fs: 34, color: '#fef08a', bg: 'rgba(69,26,20,0.92)', border: '#facc15' });
  var libPlate = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 2.8),
    new THREE.MeshBasicMaterial({ map: canvasTex(libCanvas), transparent: true, side: THREE.DoubleSide })
  );
  libPlate.position.set(0, porticoH - 1.2, porticoD + 0.1);
  entGrp.add(libPlate);

  grp.add(entGrp);

  // ④ 屋顶两翼苏式采光老虎窗（Dormers）
  [[-15, -15], [15, 15]].forEach(function(pos) {
    var dormer = new THREE.Mesh(
      new THREE.BoxGeometry(4.8, 2.6, 5.2),
      new THREE.MeshStandardMaterial({ color: 0x6e2c24, roughness: 0.7 })
    );
    dormer.position.set(pos[0], h + 1.3, pos[1]);
    dormer.castShadow = true;
    grp.add(dormer);
  });

  return grp;
}

/* 10. 南湖大礼堂 / 大学生活动中心（苏式大跨度红砖大礼堂 · 东正门古典柱廊 · 灰色歇山大坡顶） */
function buildAuditorium(b, campus) {
  var grp = new THREE.Group();
  var h = b.h || 8;

  var shape = new THREE.Shape();
  if (b.pts && b.pts.length >= 3) {
    shape.moveTo(b.pts[0][0] - b.pos[0], -(b.pts[0][1] - b.pos[1]));
    for (var i = 1; i < b.pts.length; i++) {
      shape.lineTo(b.pts[i][0] - b.pos[0], -(b.pts[i][1] - b.pos[1]));
    }
  } else {
    var hw = (b.size ? b.size[0] : 120) / 2, hd = (b.size ? b.size[1] : 90) / 2;
    shape.moveTo(-hw, -hd); shape.lineTo(hw, -hd); shape.lineTo(hw, hd); shape.lineTo(-hw, hd); shape.lineTo(-hw, -hd);
  }

  // ① 2层大礼堂主体
  var baseGeo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
  baseGeo.rotateX(-Math.PI / 2);
  fixExtrudeUVs(baseGeo, h);

  var redMat = new THREE.MeshStandardMaterial({ color: 0x943d31, roughness: 0.85, metalness: 0.1 });
  buildingMats.push(redMat);
  var baseMesh = new THREE.Mesh(baseGeo, [redMat, redMat]);
  baseMesh.position.set(0, 0, 0);
  baseMesh.castShadow = baseMesh.receiveShadow = true;
  grp.add(baseMesh);

  var edgeLines = new THREE.LineSegments(new THREE.EdgesGeometry(baseGeo, 40), getSharedNeonMaterial());
  baseMesh.add(edgeLines);

  // ② 大礼堂古典青灰双坡大坡屋顶
  var roofGeo = new THREE.ExtrudeGeometry(shape, { depth: 4.5, bevelEnabled: false });
  roofGeo.rotateX(-Math.PI / 2);
  var slateMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.65 });
  buildingMats.push(slateMat);
  var roofMesh = new THREE.Mesh(roofGeo, slateMat);
  roofMesh.position.set(0, h, 0);
  roofMesh.castShadow = true;
  grp.add(roofMesh);

  // ③ 东正门主立面苏式迎宾柱廊（面向延安大街内侧主干道，朝向偏角为 Math.PI / 2）
  var entGrp = new THREE.Group();
  entGrp.position.set(34.5, 0, -2.5);
  entGrp.rotation.y = Math.PI / 2;

  var porticoW = 28, porticoD = 7.0, porticoH = 8.5;
  // 三角山花山墙
  var pedGeo = new THREE.ConeGeometry(porticoW * 0.52, 3.8, 4);
  var pedMat = new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.6, metalness: 0.2 });
  var ped = new THREE.Mesh(pedGeo, pedMat);
  ped.rotation.y = Math.PI / 4;
  ped.position.set(0, porticoH + 1.9, porticoD / 2);
  ped.castShadow = true;
  entGrp.add(ped);

  // 山花中央红星徽章
  var starGeo = new THREE.ConeGeometry(1.6, 0.4, 5);
  var starMat = new THREE.MeshStandardMaterial({ color: 0xdc2626, metalness: 0.3, roughness: 0.3 });
  var starMesh = new THREE.Mesh(starGeo, starMat);
  starMesh.rotation.x = Math.PI / 2;
  starMesh.position.set(0, porticoH + 1.6, porticoD / 2 + 1.4);
  entGrp.add(starMesh);

  // 门廊过梁
  var architrave = new THREE.Mesh(
    new THREE.BoxGeometry(porticoW, 0.8, porticoD),
    new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.6 })
  );
  architrave.position.set(0, porticoH, porticoD / 2);
  architrave.castShadow = true;
  entGrp.add(architrave);

  // 4 根宏伟方柱
  [-10, -3.3, 3.3, 10].forEach(function(cx) {
    var col = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, porticoH, 1.2),
      new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.4 })
    );
    col.position.set(cx, porticoH / 2, porticoD - 0.8);
    col.castShadow = true;
    entGrp.add(col);
  });

  // 汉白玉迎宾石阶
  for (var st = 0; st < 4; st++) {
    var step = new THREE.Mesh(
      new THREE.BoxGeometry(porticoW + 3 - st * 1.2, 0.28, 2.4 + st * 0.8),
      new THREE.MeshStandardMaterial({ color: 0xd4d4d8, roughness: 0.8 })
    );
    step.position.set(0, (4 - st) * 0.14, 2.0 + st * 0.8);
    step.receiveShadow = true;
    entGrp.add(step);
  }

  // 大礼堂三道古典朱红大门
  [-6, 0, 6].forEach(function(dx) {
    var door = new THREE.Mesh(
      new THREE.BoxGeometry(3.6, 4.8, 0.5),
      new THREE.MeshStandardMaterial({ color: 0x7f1d1d, roughness: 0.6 })
    );
    door.position.set(dx, 2.4, 0.3);
    entGrp.add(door);
  });

  // 迎宾匾额：“大学生活动中心 · 南湖大礼堂”（正反双面渲染）
  var sc = textCanvas('大学生活动中心 · 南湖大礼堂', { fs: 32, color: '#fef08a', bg: 'rgba(15,23,42,0.92)', border: '#f59e0b' });
  var sp = new THREE.Mesh(
    new THREE.PlaneGeometry(24, 3.2),
    new THREE.MeshBasicMaterial({ map: canvasTex(sc), transparent: true, side: THREE.DoubleSide })
  );
  sp.position.set(0, porticoH - 1.4, porticoD + 0.1);
  entGrp.add(sp);

  grp.add(entGrp);

  return grp;
}

function isCollegeBuilding(id) {
  return ['osm32', 'osm33', 'osm35', 'osm36', 'osm37', 'osm38', 'osm51', 'osm52', 'osm1', 'osm5', 'osm6', 'osm61', 'osm62', 'osm64'].indexOf(id) !== -1;
}
function isDormBuilding(id) {
  return ['osm15', 'osm16', 'osm18', 'osm20', 'osm22', 'osm24', 'osm25', 'osm27', 'osm29', 'osm31',
          'osm39', 'osm41', 'osm42', 'osm44', 'osm45', 'osm47', 'osm48',
          'osm3', 'osm4', 'osm7', 'osm8', 'osm9', 'osm10', 'osm11', 'osm13'].indexOf(id) !== -1;
}
function isServiceYuan(id) {
  return ['osm17', 'osm19', 'osm23', 'osm26', 'osm30', 'osm40', 'osm43', 'osm46'].indexOf(id) !== -1;
}

/* 5. 标准400米塑胶跑道田径运动场（双色草坪足球场 · 3D球门 · 白色张拉膜结构看台） */
function buildTrack(b) {
  var grp = new THREE.Group();
  var rx = b.rx || 85, rz = b.rz || 55;
  var isVertical = (rz > rx);

  // 400米塑胶跑道（聚氨酯标准砖红色）
  var trackGeo = new THREE.RingGeometry(0.68, 1.0, 64);
  var trackMat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.1, color: 0xc84c36 });
  var trackMesh = new THREE.Mesh(trackGeo, trackMat);
  trackMesh.rotation.x = -Math.PI / 2;
  trackMesh.scale.set(rx, rz, 1);
  trackMesh.position.y = 0.22;
  trackMesh.receiveShadow = true;
  grp.add(trackMesh);

  // 4条白色主分道线
  for (var lane = 1; lane <= 4; lane++) {
    var laneR = 0.68 + (1.0 - 0.68) * (lane / 5);
    var lineGeo = new THREE.RingGeometry(laneR - 0.005, laneR + 0.005, 64);
    var lineMesh = new THREE.Mesh(lineGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
    lineMesh.rotation.x = -Math.PI / 2;
    lineMesh.scale.set(rx, rz, 1);
    lineMesh.position.y = 0.24;
    grp.add(lineMesh);
  }

  // 场内天然草坪足球场
  var pitchW = rx * 1.25, pitchD = rz * 1.25;
  var fieldGeo = new THREE.PlaneGeometry(pitchW, pitchD);
  var fieldMat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.05, color: 0x3f8f4f });
  var fieldMesh = new THREE.Mesh(fieldGeo, fieldMat);
  fieldMesh.rotation.x = -Math.PI / 2;
  fieldMesh.position.y = 0.25;
  fieldMesh.receiveShadow = true;
  grp.add(fieldMesh);

  // 足球场白色边界线与中圈
  var linesGroup = new THREE.Group();
  linesGroup.position.y = 0.27;
  
  var boundEdge = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.PlaneGeometry(pitchW * 0.92, pitchD * 0.88)),
    new THREE.LineBasicMaterial({ color: 0xffffff })
  );
  boundEdge.rotation.x = -Math.PI / 2;
  linesGroup.add(boundEdge);

  var midLineGeo = isVertical ? new THREE.PlaneGeometry(pitchW * 0.92, 0.4) : new THREE.PlaneGeometry(0.4, pitchD * 0.88);
  var midLine = new THREE.Mesh(midLineGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }));
  midLine.rotation.x = -Math.PI / 2;
  linesGroup.add(midLine);

  var centerCircle = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(new THREE.EllipseCurve(0, 0, 9.15, 9.15, 0, Math.PI * 2, false, 0).getPoints(40).map(function(p) { return new THREE.Vector3(p.x, 0, p.y); })),
    new THREE.LineBasicMaterial({ color: 0xffffff })
  );
  linesGroup.add(centerCircle);
  grp.add(linesGroup);

  // 3D 白色足球门模型
  var barMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
  if (isVertical) {
    [-pitchD * 0.44, pitchD * 0.44].forEach(function(gz) {
      var goal = new THREE.Group();
      goal.position.set(0, 0.28, gz);
      var topBar = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 7.32, 8), barMat);
      topBar.rotation.z = Math.PI / 2;
      topBar.position.set(0, 2.44, 0);
      goal.add(topBar);

      [-3.66, 3.66].forEach(function(px) {
        var post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 2.44, 8), barMat);
        post.position.set(px, 1.22, 0);
        goal.add(post);
      });
      grp.add(goal);
    });
  } else {
    [-pitchW * 0.44, pitchW * 0.44].forEach(function(gx) {
      var goal = new THREE.Group();
      goal.position.set(gx, 0.28, 0);
      var topBar = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 7.32, 8), barMat);
      topBar.rotation.x = Math.PI / 2;
      topBar.position.set(0, 2.44, 0);
      goal.add(topBar);

      [-3.66, 3.66].forEach(function(py) {
        var post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 2.44, 8), barMat);
        post.position.set(0, 1.22, py);
        goal.add(post);
      });
      grp.add(goal);
    });
  }

  // 现代观众看台与白色张拉膜结构挑篷
  if (!b.noStand) {
    if (isVertical) {
      // 垂直田径场看台位于西侧（X 负向），沿南北向长轴延伸
      var standLen = rz * 1.2, standDepth = 14, standH = 7.5;
      var standBase = new THREE.Mesh(
        new THREE.BoxGeometry(standDepth, standH, standLen),
        new THREE.MeshStandardMaterial({ color: 0xd6d3cb, roughness: 0.8 })
      );
      standBase.position.set(-rx - 8, standH / 2, 0);
      standBase.castShadow = standBase.receiveShadow = true;
      grp.add(standBase);

      var canopyArch = new THREE.Mesh(
        new THREE.CylinderGeometry(standDepth * 0.6, standDepth * 0.6, standLen * 1.05, 24, 1, true, 0, Math.PI * 0.65),
        new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.3, side: THREE.DoubleSide })
      );
      canopyArch.rotation.x = 0;
      canopyArch.rotation.z = Math.PI * 0.35;
      canopyArch.position.set(-rx - 8, standH + 5.5, 0);
      canopyArch.castShadow = true;
      grp.add(canopyArch);
    } else {
      var standW = rx * 1.1, standD = 16, standH = 8;
      var standBase = new THREE.Mesh(
        new THREE.BoxGeometry(standW, standH, standD),
        new THREE.MeshStandardMaterial({ color: 0xd6d3cb, roughness: 0.8 })
      );
      standBase.position.set(0, standH / 2, -rz * 1.1);
      standBase.castShadow = standBase.receiveShadow = true;
      grp.add(standBase);

      var canopyArch = new THREE.Mesh(
        new THREE.CylinderGeometry(standW * 0.52, standW * 0.52, standD * 1.2, 24, 1, true, 0, Math.PI * 0.65),
        new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.3, side: THREE.DoubleSide })
      );
      canopyArch.rotation.z = Math.PI / 2;
      canopyArch.rotation.x = Math.PI * 0.18;
      canopyArch.position.set(0, standH + 6, -rz * 1.1);
      canopyArch.castShadow = true;
      grp.add(canopyArch);
    }
  }

  return grp;
}

/* 6. 丙烯酸篮球场群：蓝绿双色面层 + 3D真实篮球架 */
function buildCourts(b) {
  var grp = new THREE.Group();
  var cols = b.cols || Math.ceil(b.n / 2);
  var rows = Math.ceil(b.n / cols);
  var cw = b.cw || 16, cd = b.cd || 26, gap = 6;
  var courtGeo = new THREE.PlaneGeometry(cw, cd);
  var matA = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.1, color: 0x2563eb }); // 丙烯酸深蓝
  var matB = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.1, color: 0x059669 }); // 丙烯酸翡翠绿
  var edgeGeo = new THREE.EdgesGeometry(courtGeo);
  var edgeMat = new THREE.LineBasicMaterial({ color: 0xffffff });
  var i = 0;
  for (var r = 0; r < rows; r++) {
    for (var c2 = 0; c2 < cols && i < b.n; c2++, i++) {
      var cx = (c2 - (cols - 1) / 2) * (cw + gap);
      var cz = (r - (rows - 1) / 2) * (cd + gap);
      var court = new THREE.Mesh(courtGeo, (r + c2) % 2 ? matA : matB);
      court.rotation.x = -Math.PI / 2;
      court.position.set(cx, 0.18, cz);
      court.receiveShadow = true;
      grp.add(court);
      var edge = new THREE.LineSegments(edgeGeo, edgeMat);
      edge.rotation.x = -Math.PI / 2;
      edge.position.set(cx, 0.2, cz);
      grp.add(edge);

      // 3D 篮球架（南北两端标准篮球架）
      [-cd / 2 + 1.2, cd / 2 - 1.2].forEach(function(hz, sIdx) {
        var hoopGrp = new THREE.Group();
        hoopGrp.position.set(cx, 0.2, cz + hz);
        if (sIdx === 0) hoopGrp.rotation.y = Math.PI;

        var post = new THREE.Mesh(
          new THREE.CylinderGeometry(0.12, 0.14, 3.8, 8),
          new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.4 })
        );
        post.position.set(0, 1.8, 0);
        post.rotation.x = 0.2;
        hoopGrp.add(post);

        var arm = new THREE.Mesh(
          new THREE.CylinderGeometry(0.1, 0.1, 1.5, 8),
          new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.4 })
        );
        arm.position.set(0, 3.3, 0.6);
        arm.rotation.x = Math.PI / 3;
        hoopGrp.add(arm);

        var board = new THREE.Mesh(
          new THREE.BoxGeometry(1.8, 1.05, 0.06),
          new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2, transparent: true, opacity: 0.85 })
        );
        board.position.set(0, 3.05, 1.2);
        hoopGrp.add(board);

        var rim = new THREE.Mesh(
          new THREE.TorusGeometry(0.23, 0.02, 8, 16),
          new THREE.MeshStandardMaterial({ color: 0xe11d48, roughness: 0.3 })
        );
        rim.rotation.x = Math.PI / 2;
        rim.position.set(0, 3.05, 1.45);
        hoopGrp.add(rim);

        grp.add(hoopGrp);
      });
    }
  }
  return grp;
}

/* 7. 校门（红柱金顶 + 镌刻金字牌匾 + 门禁安全岛） */
function buildGate(b, campus) {
  var grp = new THREE.Group();
  var maroon = new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0.15, color: 0x7e2f2f });
  var pw = 6, ph = b.h || 12;
  var p1 = new THREE.Mesh(new THREE.BoxGeometry(pw, ph, pw), maroon);
  p1.position.set(-b.w / 2, ph / 2, 0);
  var p2 = p1.clone(); p2.position.x = b.w / 2;
  p1.castShadow = p2.castShadow = true;
  grp.add(p1, p2);

  // 柱头金色压顶
  [p1, p2].forEach(function (p) {
    var cap = new THREE.Mesh(new THREE.BoxGeometry(pw + 1.4, 1.4, pw + 1.4), new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.8, color: 0xc9a227 }));
    cap.position.set(p.position.x, ph + 0.7, 0);
    cap.castShadow = true;
    grp.add(cap);
  });
  var beamH = 4.6;
  var beam = new THREE.Mesh(new THREE.BoxGeometry(b.w + pw, beamH, pw + 1.4), maroon);
  beam.position.y = ph - beamH / 2 + 2.8;
  beam.castShadow = true;
  grp.add(beam);
  var sign = new THREE.Mesh(
    new THREE.PlaneGeometry(b.w * 0.82, beamH * 0.68),
    new THREE.MeshBasicMaterial({ map: gateSignTexture(campus.gateText) })
  );
  sign.position.set(0, ph - beamH / 2 + 2.8, (pw + 1.4) / 2 + 0.08);
  grp.add(sign);
  var sign2 = sign.clone();
  sign2.rotation.y = Math.PI; sign2.position.z = -(pw + 1.4) / 2 - 0.08;
  grp.add(sign2);

  // 门卫岗亭
  var guardBox = new THREE.Mesh(
    new THREE.BoxGeometry(4.8, 3.6, 4.2),
    new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.6 })
  );
  guardBox.position.set(-b.w / 2 - 5.5, 1.8, 0);
  guardBox.castShadow = true;
  grp.add(guardBox);

  // 安全岛地面
  var island = new THREE.Mesh(
    new THREE.BoxGeometry(b.w + 14, 0.4, 8),
    new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.8 })
  );
  island.position.set(0, 0.2, 0);
  island.receiveShadow = true;
  grp.add(island);

  return grp;
}

/* ============================================================
 * 配景（props）
 * ============================================================ */
function buildProp(p, campus) {
  var grp = new THREE.Group();
  grp.name = 'prop';
  if (p.type === 'plaza') {
    grp.isGroundProp = true;
    var geo = p.r ? new THREE.CircleGeometry(p.r, 48) : new THREE.PlaneGeometry(p.w, p.d);
    var plaza = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.1, color: p.color || PAVE }));
    plaza.rotation.x = -Math.PI / 2;
    plaza.position.set(p.pos[0], 0.09, p.pos[1]);
    plaza.receiveShadow = true;
    grp.add(plaza);
  } else if (p.type === 'parking') {
    grp.isGroundProp = true;
    var lot = new THREE.Mesh(new THREE.PlaneGeometry(p.w, p.d), new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.1, color: 0x50565c }));
    lot.rotation.x = -Math.PI / 2;
    lot.position.set(p.pos[0], 0.13, p.pos[1]);
    lot.receiveShadow = true;
    grp.add(lot);
    // 车位线
    var lineMat = new THREE.MeshBasicMaterial({ color: 0xdddddd });
    var cols = Math.floor(p.w / 5.6);
    for (var i = 0; i <= cols; i++) {
      var lx = p.pos[0] - p.w / 2 + i * (p.w / cols);
      var line = new THREE.Mesh(new THREE.PlaneGeometry(0.4, p.d - 6), lineMat);
      line.rotation.x = -Math.PI / 2;
      line.position.set(lx, 0.16, p.pos[1]);
      grp.add(line);
    }
    // 停放车辆
    var carColors = [0xd8d8d8, 0x333333, 0xb5b5c8, 0x8a2f2f, 0x2f4f8a, 0xc8c8c8];
    for (var k = 0; k < Math.floor(cols * 0.6); k++) {
      var cx = p.pos[0] - p.w / 2 + (k + 0.5) * (p.w / cols);
      var cz = p.pos[1] + (Math.random() < 0.5 ? -1 : 1) * (p.d / 4.4);
      var car = new THREE.Mesh(
        new THREE.BoxGeometry(2.4, 1.6, 4.6),
        new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.1, color: carColors[Math.floor(Math.random() * carColors.length)] })
      );
      car.position.set(cx, 0.9, cz);
      car.castShadow = true;
      grp.add(car);
    }
  } else if (p.type === 'bridge') {
    // 盛北大街跨街天桥：桥面 + 透明玻璃幕墙走廊 + 钢构顶棚 + 支撑墩 + 双侧梯道
    var deck = new THREE.Mesh(
      new THREE.BoxGeometry(p.len, 1.2, p.w),
      new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.1, color: 0x9aa2aa })
    );
    deck.position.set(p.pos[0], 6.2, p.pos[1]);
    deck.castShadow = true;
    grp.add(deck);

    // 封闭式全景观光玻璃廊道
    var glassCorridor = new THREE.Mesh(
      new THREE.BoxGeometry(p.len - 4, 3.2, p.w - 0.4),
      new THREE.MeshStandardMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.6, roughness: 0.1, metalness: 0.2 })
    );
    glassCorridor.position.set(p.pos[0], 8.4, p.pos[1]);
    grp.add(glassCorridor);

    // 顶棚遮雨钢架
    var roofTop = new THREE.Mesh(
      new THREE.BoxGeometry(p.len + 1, 0.6, p.w + 0.8),
      new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.7 })
    );
    roofTop.position.set(p.pos[0], 10.3, p.pos[1]);
    roofTop.castShadow = true;
    grp.add(roofTop);

    // 桥名标识牌：“盛北天桥”
    var brSignCanvas = textCanvas('盛北天桥 · 跨区人行天桥', { fs: 32, color: '#f8fafc', bg: 'rgba(30,41,59,0.85)', border: '#38bdf8' });
    var brSign = new THREE.Mesh(new THREE.PlaneGeometry(16, 2.6), new THREE.MeshBasicMaterial({ map: canvasTex(brSignCanvas), transparent: true, side: THREE.DoubleSide }));
    brSign.position.set(p.pos[0], 8.4, p.pos[1] + p.w / 2 + 0.1);
    grp.add(brSign);

    // 桥墩立柱
    [p.pos[0] - p.len / 2 + 8, p.pos[0], p.pos[0] + p.len / 2 - 8].forEach(function (px) {
      var pil = new THREE.Mesh(new THREE.BoxGeometry(2.0, 6.2, 2.0), new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.1, color: 0x8a929a }));
      pil.position.set(px, 3.1, p.pos[1]);
      pil.castShadow = true;
      grp.add(pil);
    });
    // 两端阶梯
    [-1, 1].forEach(function (side) {
      for (var st = 0; st < 4; st++) {
        var step = new THREE.Mesh(
          new THREE.BoxGeometry(2.2, 1.6, p.w),
          new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.1, color: 0xa8b0b8 })
        );
        step.position.set(p.pos[0] + side * (p.len / 2 + 1.2 + st * 2.2), 5.6 - st * 1.6, p.pos[1]);
        step.castShadow = true;
        grp.add(step);
      }
    });
  } else if (p.type === 'sign') {
    var pole = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 6, 6), new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.1, color: 0x666e76 }));
    pole.position.set(p.pos[0], 3, p.pos[1]);
    grp.add(pole);
    var c = document.createElement('canvas'); c.width = 256; c.height = 128;
    var g = c.getContext('2d');
    g.fillStyle = p.color || '#1f6fb5';
    roundRect(g, 0, 0, 256, 128, 14); g.fill();
    g.fillStyle = '#fff';
    g.font = 'bold 44px "Microsoft YaHei", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(p.text, 128, p.sub ? 48 : 64);
    if (p.sub) {
      g.font = '28px "Microsoft YaHei", sans-serif';
      g.fillText(p.sub, 128, 96);
    }
    var board = new THREE.Mesh(
      new THREE.PlaneGeometry(13, 6.5),
      new THREE.MeshBasicMaterial({ map: canvasTex(c), transparent: false, side: THREE.DoubleSide })
    );
    board.position.set(p.pos[0], 8.2, p.pos[1]);
    grp.add(board);
  } else if (p.type === 'street') {
    var sc = textCanvas(p.text, { fs: 40, color: p.color || 'rgba(255,255,255,0.85)', bg: p.bg || null, br: 12 });
    var st = canvasTex(sc);
    var size = p.size || 1;
    var w = sc.width * 0.09 * size, h = sc.height * 0.09 * size;
    var txt = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: st, transparent: true, depthWrite: false })
    );
    txt.rotation.x = -Math.PI / 2;
    txt.rotation.z = p.rot || 0;
    txt.position.set(p.pos[0], 0.17, p.pos[1]);
    txt.renderOrder = 5;
    grp.add(txt);
  } else if (p.type === 'stone') {
    var sw = p.w || 11, sh = p.h || 5.5, sd = p.d || 4.2;
    var srot = p.rot || 0;
    var stoneGrp = new THREE.Group();
    stoneGrp.position.set(p.pos[0], 0, p.pos[1]);
    stoneGrp.rotation.y = srot;

    // 花岗岩雕花基座
    var basePlinth = new THREE.Mesh(
      new THREE.BoxGeometry(sw + 2.0, 0.8, sd + 1.6),
      new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0.15, color: 0x334155 })
    );
    basePlinth.position.y = 0.4;
    basePlinth.castShadow = basePlinth.receiveShadow = true;
    stoneGrp.add(basePlinth);

    // 泰山青石主体
    var stoneMesh = new THREE.Mesh(
      new THREE.BoxGeometry(sw, sh, sd),
      new THREE.MeshStandardMaterial({ roughness: 0.88, metalness: 0.1, color: p.color || 0x94a3b8 })
    );
    stoneMesh.position.y = 0.8 + sh / 2;
    stoneMesh.castShadow = stoneMesh.receiveShadow = true;
    stoneGrp.add(stoneMesh);

    // 正面镌刻朱红毛体校名
    var frontText = p.text || '长春工业大学';
    var scFront = textCanvas(frontText, { fs: 56, color: p.frontColor || '#b91c1c', bg: 'rgba(255,255,255,0)' });
    var plateFront = new THREE.Mesh(
      new THREE.PlaneGeometry(sw * 0.88, sh * 0.65),
      new THREE.MeshBasicMaterial({ map: canvasTex(scFront), transparent: true, side: THREE.DoubleSide })
    );
    plateFront.position.set(0, 0.8 + sh / 2, sd / 2 + 0.08);
    stoneGrp.add(plateFront);

    // 背面镌刻金色校训或建校铭文
    var backText = p.sub || '爱国 · 笃学 · 诚信 · 创新';
    var scBack = textCanvas(backText, { fs: 38, color: p.backColor || '#d97706', bg: 'rgba(255,255,255,0)' });
    var plateBack = new THREE.Mesh(
      new THREE.PlaneGeometry(sw * 0.88, sh * 0.65),
      new THREE.MeshBasicMaterial({ map: canvasTex(scBack), transparent: true, side: THREE.DoubleSide })
    );
    plateBack.rotation.y = Math.PI;
    plateBack.position.set(0, 0.8 + sh / 2, -sd / 2 - 0.08);
    stoneGrp.add(plateBack);

    grp.add(stoneGrp);
  } else if (p.type === 'flower') {
    grp.isGroundProp = true;
    var bed = new THREE.Mesh(new THREE.CircleGeometry(p.r, 24), new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.1, color: 0xb55a44 }));
    bed.rotation.x = -Math.PI / 2;
    bed.position.set(p.pos[0], 0.12, p.pos[1]);
    grp.add(bed);
    var core = new THREE.Mesh(new THREE.CircleGeometry(p.r * 0.55, 24), new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.1, color: 0xe8c04f }));
    core.rotation.x = -Math.PI / 2;
    core.position.set(p.pos[0], 0.16, p.pos[1]);
    grp.add(core);
  } else if (p.type === 'river') {
    riverMesh = buildRiver(p);
    grp.add(riverMesh);
  }
  return grp;
}

/* 升级版动态水系（支持动态 UV 波纹流动） */
function buildRiver(p) {
  var pts = p.path.map(function (q) { return new THREE.Vector3(q[0], 0.15, q[1]); });
  var curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
  var N = Math.max(36, p.path.length * 8);
  var positions = [], uvs = [], indices = [];
  for (var i = 0; i <= N; i++) {
    var t = i / N;
    var pt = curve.getPointAt(t);
    var tan = curve.getTangentAt(t);
    var nx = -tan.z, nz = tan.x;
    var hw = (p.w || 14) / 2;
    positions.push(pt.x + nx * hw, pt.y, pt.z + nz * hw);
    positions.push(pt.x - nx * hw, pt.y, pt.z - nz * hw);
    uvs.push(t * 8, 0);
    uvs.push(t * 8, 1);
    if (i < N) {
      var a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  var mat = new THREE.MeshPhysicalMaterial({
    color: 0x2288cc,
    metalness: 0.9,
    roughness: 0.05,
    transmission: 0.8,
    ior: 1.33,
    transparent: true,
    opacity: 0.9,
    envMapIntensity: 2.0,
    clearcoat: 1.0,
    clearcoatRoughness: 0.1
  });
  
  mat.onBeforeCompile = function (shader) {
    shader.uniforms.time = { value: 0 };
    mat.userData.shader = shader;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
      uniform float time;
      `
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>
       // Calculate wave normals using multiple sine waves
       float wave1 = sin(vUv.x * 20.0 + time * 1.5) * cos(vUv.y * 20.0 + time * 1.2) * 0.08;
       float wave2 = sin(vUv.x * 40.0 - time * 2.0) * cos(vUv.y * 40.0 - time * 1.8) * 0.04;
       normal = normalize(normal + vec3(wave1 + wave2, wave1 - wave2, 0.0));
      `
    );
  };

  riverTex = mat; // Keep a reference to the material to update time in animate()

  var mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

/* ============================================================
 * 高空气流流动云层
 * ============================================================ */
function buildClouds(groundSize) {
  var grp = new THREE.Group();
  cloudMats = [];
  var cloudCount = 12;
  // 球形替代低面数十二面体：轮廓更圆润，三角面反而更少（96 vs 360）
  var cloudGeo = new THREE.SphereGeometry(1, 8, 6);
  cloudGeo._shared = true;

  for (var c = 0; c < cloudCount; c++) {
    var cluster = new THREE.Group();
    var mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.46,
      depthWrite: false
    });
    cloudMats.push(mat);

    var subBlobs = 5 + Math.floor(Math.random() * 4);
    var blobs = [];
    for (var b = 0; b < subBlobs; b++) {
      var blob = new THREE.Mesh(cloudGeo, mat);
      var sc = rand(14, 28);
      // 压得更扁，呈层云状而不是悬浮的圆石头
      blob.scale.set(sc * rand(1.3, 2.0), sc * rand(0.32, 0.5), sc * rand(0.8, 1.1));
      blob.position.set(rand(-30, 30), rand(-3, 3), rand(-22, 22));
      cluster.add(blob);
      blobs.push(blob);
    }
    // 同一朵云内部 blob 合并为单个网格（每朵云仍独立，保留各自的漂移速度）
    mergeMeshList(cluster, blobs, mat, 'cloud');
    cluster.position.set(
      rand(-groundSize * 0.45, groundSize * 0.45),
      rand(320, 440),
      rand(-groundSize * 0.45, groundSize * 0.45)
    );
    cluster.userData.speed = rand(2.8, 5.2);
    grp.add(cluster);
  }
  return grp;
}

/* ============================================================
 * 树木 / 路灯（全面采用 THREE.InstancedMesh 批量渲染合批）
 * ============================================================ */
var GEOS = { trunk: null, leaf: null, lampPole: null, lampHead: null, lampHalo: null };
var MATS = { trunk: null, leafA: [], lampPole: null, lampHead: null, lampHalo: null };

function initSharedGeometries() {
  if (GEOS.trunk) return;
  GEOS.trunk = new THREE.CylinderGeometry(0.55, 0.8, 4.4, 6);
  GEOS.leaf = new THREE.ConeGeometry(3.1, 7.2, 8);
  GEOS.lampPole = new THREE.CylinderGeometry(0.28, 0.36, 9, 6);
  GEOS.lampHead = new THREE.SphereGeometry(0.9, 10, 8);
  GEOS.lampHalo = new THREE.CircleGeometry(7.5, 16);

  GEOS.trunk._shared = GEOS.leaf._shared = GEOS.lampPole._shared = GEOS.lampHead._shared = GEOS.lampHalo._shared = true;

  MATS.trunk = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.1, color: 0x7a5b3a });
  MATS.trunk._shared = true;

  [0x3d7a44, 0x2f6b3c, 0x4c8a4a].forEach(function (c) {
    var m = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.1, color: c });
    m._shared = true;
    MATS.leafA.push(m);
  });

  MATS.lampPole = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.1, color: 0x5a636b });
  MATS.lampPole._shared = true;

  MATS.lampHead = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.1, color: 0xfff3c2, emissive: 0xffe9a0, emissiveIntensity: 0 });
  MATS.lampHead._shared = true;
  lampMats.push(MATS.lampHead);

  MATS.lampHalo = new THREE.MeshBasicMaterial({
    map: lampHaloTexture(),
    transparent: true,
    opacity: 0,
    depthWrite: false
  });
  MATS.lampHalo._shared = true;
  haloMats.push(MATS.lampHalo);
}

/* 收集树木点位 */
function collectTreePoints(spec, footprintList) {
  var list = [];
  function blocked(x, z) {
    for (var i = 0; i < footprintList.length; i++) {
      var f = footprintList[i];
      if (Math.abs(x - f.x) < f.w / 2 + 5 && Math.abs(z - f.z) < f.d / 2 + 5) return true;
    }
    return false;
  }
  function plant(x, z) {
    if (blocked(x, z)) return;
    list.push({ x: x, z: z, s: rand(0.8, 1.45), leafIdx: Math.floor(Math.random() * 3) });
  }
  if (spec.mode === 'line') {
    for (var i = 0; i < spec.n; i++) {
      var t = i / (spec.n - 1 || 1);
      plant(spec.a[0] + (spec.b[0] - spec.a[0]) * t, spec.a[1] + (spec.b[1] - spec.a[1]) * t);
    }
  } else if (spec.mode === 'ring') {
    for (var j = 0; j < spec.n; j++) {
      var ang = (j / spec.n) * Math.PI * 2;
      plant(spec.pos[0] + Math.cos(ang) * spec.r, spec.pos[1] + Math.sin(ang) * spec.r);
    }
  } else if (spec.mode === 'scatter') {
    for (var k = 0; k < spec.n; k++) {
      plant(rand(spec.rect[0], spec.rect[2]), rand(spec.rect[1], spec.rect[3]));
    }
  } else if (spec.mode === 'pts' && spec.pts) {
    spec.pts.forEach(function(p) {
      plant(p[0], p[1]);
    });
  }
  return list;
}

/* 批量生成 InstancedMesh 树木 */
function buildInstancedTrees(treePoints, grp) {
  if (!treePoints.length) return;
  var count = treePoints.length;
  var trunkMesh = new THREE.InstancedMesh(GEOS.trunk, MATS.trunk, count);
  trunkMesh.castShadow = true;
  trunkMesh.receiveShadow = true;

  var leafBuckets = [[], [], []];
  treePoints.forEach(function (tp, idx) {
    leafBuckets[tp.leafIdx].push({ tp: tp, globalIdx: idx });
  });

  var dummy = new THREE.Object3D();
  treePoints.forEach(function (tp, i) {
    dummy.position.set(tp.x, 2.2 * tp.s, tp.z);
    dummy.scale.setScalar(tp.s);
    dummy.updateMatrix();
    trunkMesh.setMatrixAt(i, dummy.matrix);
  });
  trunkMesh.instanceMatrix.needsUpdate = true;
  grp.add(trunkMesh);

  leafBuckets.forEach(function (bucket, lIdx) {
    if (!bucket.length) return;
    var leafMesh = new THREE.InstancedMesh(GEOS.leaf, MATS.leafA[lIdx], bucket.length);
    leafMesh.castShadow = true;
    bucket.forEach(function (item, bIdx) {
      var tp = item.tp;
      dummy.position.set(tp.x, (5.4 + Math.random() * 0.6) * tp.s, tp.z);
      dummy.scale.setScalar(tp.s * rand(0.9, 1.25));
      dummy.updateMatrix();
      leafMesh.setMatrixAt(bIdx, dummy.matrix);
    });
    leafMesh.instanceMatrix.needsUpdate = true;
    grp.add(leafMesh);
  });
}

/* 沿路网自动采样并批量布设路灯 (InstancedMesh) */
function buildInstancedLamps(campus, footprintList, grp) {
  var lampList = [];
  function blocked(x, z) {
    for (var i = 0; i < footprintList.length; i++) {
      var f = footprintList[i];
      if (Math.abs(x - f.x) < f.w / 2 + 3.5 && Math.abs(z - f.z) < f.d / 2 + 3.5) return true;
    }
    return false;
  }

  
  campus.roads.forEach(function (r) {
    function processSegment(p1, p2, w) {
      var dx = p2[0] - p1[0], dz = p2[1] - p1[1];
      var len = Math.sqrt(dx * dx + dz * dz);
      if (len < 36) return;
      var nx = -dz / len, nz = dx / len;
      var offsetDist = (w / 2) + 2.5;
      var steps = Math.max(1, Math.floor(len / 48));
      for (var s = 1; s <= steps; s++) {
        var t = s / (steps + 1);
        var side = (s % 2 === 0) ? 1 : -1;
        var lx = p1[0] + dx * t + nx * offsetDist * side;
        var lz = p1[1] + dz * t + nz * offsetDist * side;
        if (!blocked(lx, lz)) lampList.push({ x: lx, z: lz });
      }
    }
    if (r.poly) {
      for (var i = 0; i < r.poly.length - 1; i++) {
        processSegment(r.poly[i], r.poly[i+1], r.w || 7);
      }
    } else if (r.a && r.b) {
      processSegment(r.a, r.b, r.w || 7);
    }
  });


  if (!lampList.length) return;
  var count = lampList.length;
  var poleMesh = new THREE.InstancedMesh(GEOS.lampPole, MATS.lampPole, count);
  var headMesh = new THREE.InstancedMesh(GEOS.lampHead, MATS.lampHead, count);
  var haloMesh = new THREE.InstancedMesh(GEOS.lampHalo, MATS.lampHalo, count);
  poleMesh.castShadow = true;
  headMesh.castShadow = false;

  var dummy = new THREE.Object3D();
  lampList.forEach(function (lp, i) {
    dummy.position.set(lp.x, 4.5, lp.z);
    dummy.scale.set(1, 1, 1);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    poleMesh.setMatrixAt(i, dummy.matrix);

    dummy.position.set(lp.x, 9.4, lp.z);
    dummy.updateMatrix();
    headMesh.setMatrixAt(i, dummy.matrix);

    dummy.position.set(lp.x, 0.18, lp.z);
    dummy.rotation.set(-Math.PI / 2, 0, 0);
    dummy.updateMatrix();
    haloMesh.setMatrixAt(i, dummy.matrix);
  });
  poleMesh.instanceMatrix.needsUpdate = true;
  headMesh.instanceMatrix.needsUpdate = true;
  haloMesh.instanceMatrix.needsUpdate = true;

  grp.add(poleMesh, headMesh, haloMesh);
}

/* ============================================================
 * 校园导览动态流光路线
 * ============================================================ */
function buildGuideRoutes(campus) {
  if (routeGroup) { scene.remove(routeGroup); routeGroup = null; }
  routeGroup = new THREE.Group();
  if (!campus.guideRoutes || !campus.guideRoutes.length) return routeGroup;

  routeTex = routeTextureFunc();
  campus.guideRoutes.forEach(function (routeSpec) {
    var ribs = [];
    var pts = routeSpec.path.map(function (p) { return new THREE.Vector3(p[0], 0.28, p[1]); });
    var ribMat = new THREE.MeshBasicMaterial({
      map: routeTex,
      color: routeSpec.color || '#ffb300',
      transparent: true,
      opacity: 0.92,
      depthWrite: false
    });
    for (var i = 0; i < pts.length - 1; i++) {
      var p1 = pts[i], p2 = pts[i + 1];
      var dist = p1.distanceTo(p2);
      if (dist < 0.5) continue;
      var mid = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
      var angle = Math.atan2(p2.z - p1.z, p2.x - p1.x);

      var rib = new THREE.Mesh(new THREE.PlaneGeometry(dist, 4.4), ribMat);
      rib.rotation.x = -Math.PI / 2;
      rib.rotation.z = -angle;
      rib.position.set(mid.x, mid.y, mid.z);
      rib.renderOrder = 8;
      routeGroup.add(rib);
      ribs.push(rib);
    }
    // 同一条路线的流光段合并为单个网格（材质共享，UV 逐段保留，流光动画不受影响）
    mergeMeshList(routeGroup, ribs, ribMat, 'route_rib');
  });
  routeGroup.visible = showGuideRoute;
  return routeGroup;
}

/* ============================================================
 * 场景初始化
 * ============================================================ */
function initScene() {
  var canvas = $('c3d');
  // 设备分级：移动端 / 低核设备关闭 MSAA、压低像素比与阴影档位，换取稳定帧率
  var isMobileUA = /Android|iPhone|iPad|iPod|Mobile|HarmonyOS/i.test(navigator.userAgent);
  var isLowEnd = isMobileUA || (navigator.hardwareConcurrency || 8) <= 4;
  window.__ccutLowEnd = isLowEnd;
  renderer = new THREE.WebGLRenderer({
    canvas: canvas,
    antialias: !isLowEnd,
    // 截图改为「同帧渲染后立即读取」，不再长期驻留后台缓冲（preserveDrawingBuffer 会显著拖慢每一帧）
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance'
  });

  // GPU 驱动重置 / 显卡切换等会触发上下文丢失：暂停渲染循环，恢复后再续
  canvas.addEventListener('webglcontextlost', function (event) {
    event.preventDefault();
    console.warn('[CampusMap] WebGL context lost. Pausing rendering...');
    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
  }, false);

  canvas.addEventListener('webglcontextrestored', function () {
    console.info('[CampusMap] WebGL context restored. Resuming animation...');
    clock.getDelta();
    if (!animFrameId && !isPageHidden) {
      animFrameId = requestAnimationFrame(animate);
    }
  }, false);

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isLowEnd ? 1.5 : 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = isLowEnd ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
  // 物理渲染优化
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  // 关闭自动更新阴影，改为按需更新以提升性能
  renderer.shadowMap.autoUpdate = false;
  
  pmremGenerator = window.pmremGenerator = new THREE.PMREMGenerator(renderer);

  scene = new THREE.Scene();
  scene.background = skyTexture(DAY_SKY);
  scene.fog = new THREE.Fog(new THREE.Color(DAY_SKY.fog), 700, 2600);
  
  // 初始环境光贴图
  var envScene = new THREE.Scene();
  envScene.background = scene.background;
  scene.environment = pmremGenerator.fromScene(envScene).texture;

  camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 1, 5200);
  camera.position.set(0, 320, 560);

  // Bloom Post-Processing
  var renderScene = new THREE.RenderPass(scene, camera);
  bloomPass = new THREE.UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
  bloomPass.strength = 0; // Default off, enabled dynamically
  composer = new THREE.EffectComposer(renderer);
  composer.addPass(renderScene);
  composer.addPass(bloomPass);

  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.maxPolarAngle = Math.PI / 2 - 0.02;
  controls.minDistance = 30;
  controls.maxDistance = 1750;

  // 设置为类似高德/百度的标准地图交互方式：左键拖拽平移，右键旋转，单指触控平移，双指缩放旋转
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.PAN,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.ROTATE
  };
  controls.touches = {
    ONE: THREE.TOUCH.PAN,
    TWO: THREE.TOUCH.DOLLY_ROTATE
  };
  controls.screenSpacePanning = false; // 锁定在地面 XZ 平面平移，符合传统地图拖拽习惯
  controls.listenToKeyEvents(window); // 允许使用键盘方向键自由移动
  controls.keyPanSpeed = 15.0; // 提升键盘移动速度

  raycaster = new THREE.Raycaster();
  pointer = new THREE.Vector2();

  hemiLight = new THREE.HemisphereLight(0xcfe6ff, 0x8a9a6a, 0.85);
  scene.add(hemiLight);
  ambientLight = new THREE.AmbientLight(0xffffff, 0.28);
  scene.add(ambientLight);
  dirLight = new THREE.DirectionalLight(0xfff2dd, 1.05);
  dirLight.position.set(-420, 620, 360);
  dirLight.castShadow = true;
  var shadowRes = window.__ccutLowEnd ? 1024 : 2048;
  dirLight.shadow.mapSize.set(shadowRes, shadowRes);
  var sc = dirLight.shadow.camera;
  sc.left = -900; sc.right = 900; sc.top = 900; sc.bottom = -900; sc.near = 50; sc.far = 2300;
  dirLight.shadow.bias = -0.0006;
  scene.add(dirLight);

  // Add a glowing sun disk
  var sunGeo = new THREE.CircleGeometry(60, 32);
  var sunMat = new THREE.MeshBasicMaterial({ color: 0xfff9e6, fog: false });
  var sunMesh = new THREE.Mesh(sunGeo, sunMat);
  sunMesh.position.set(-1400, 2060, 1200); // Far away in the direction of light
  sunMesh.lookAt(0,0,0);
  scene.add(sunMesh);
  
  // Add an atmospheric glow around the sun
  var glowGeo = new THREE.CircleGeometry(160, 32);
  var glowMat = new THREE.MeshBasicMaterial({ color: 0xffe6a3, fog: false, transparent: true, opacity: 0.15 });
  var glowMesh = new THREE.Mesh(glowGeo, glowMat);
  glowMesh.position.set(-1390, 2050, 1190);
  glowMesh.lookAt(0,0,0);
  scene.add(glowMesh);


  var starGeo = new THREE.BufferGeometry();
  var pos = [];
  for (var i = 0; i < 600; i++) {
    var th = Math.random() * Math.PI * 2;
    var ph = Math.random() * Math.PI * 0.44;
    var r = 1900;
    pos.push(r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph) + 60, r * Math.sin(ph) * Math.sin(th));
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xdfe8ff, size: 2.6, sizeAttenuation: false, transparent: true, opacity: 0 }));
  scene.add(stars);

  initSharedGeometries();

  selRing = new THREE.Mesh(
    new THREE.RingGeometry(0.8, 1.0, 48),
    new THREE.MeshBasicMaterial({ color: 0xffd54d, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthTest: false })
  );
  selRing.rotation.x = -Math.PI / 2;
  selRing.visible = false;
  selRing.renderOrder = 998;
  scene.add(selRing);

  // 3D 浮空立体光标与地标光柱
  selBeacon = new THREE.Group();
  var beamGeo = new THREE.CylinderGeometry(0.7, 0.7, 36, 16);
  var beamMat = new THREE.MeshBasicMaterial({ color: 0xffd54d, transparent: true, opacity: 0.35, depthWrite: false });
  var beamMesh = new THREE.Mesh(beamGeo, beamMat);
  beamMesh.position.y = 18;
  selBeacon.add(beamMesh);

  var coneGeo = new THREE.CylinderGeometry(0.1, 2.6, 6, 16);
  var coneMat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.1, color: 0xff9e64 });
  var coneMesh = new THREE.Mesh(coneGeo, coneMat);
  coneMesh.position.y = 3;
  selBeacon.add(coneMesh);

  var sphGeo = new THREE.SphereGeometry(1.6, 16, 16);
  var sphMat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.1, color: 0xffe277 });
  var sphMesh = new THREE.Mesh(sphGeo, sphMat);
  sphMesh.position.y = 7;
  selBeacon.add(sphMesh);
  selBeacon.visible = false;
  scene.add(selBeacon);

  // 北国冬雪落雪粒子系统
  var snowCount = 1400;
  var snowGeo = new THREE.BufferGeometry();
  var snowPos = new Float32Array(snowCount * 3);
  for (var si = 0; si < snowCount; si++) {
    snowPos[si * 3] = rand(-900, 900);
    snowPos[si * 3 + 1] = rand(10, 360);
    snowPos[si * 3 + 2] = rand(-900, 900);
  }
  snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPos, 3));
  snowPoints = new THREE.Points(snowGeo, new THREE.PointsMaterial({
    color: 0xffffff, size: 3.2, transparent: true, opacity: 0.85
  }));
  snowPoints.visible = false;
  scene.add(snowPoints);

  window.addEventListener('resize', onResize);
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (composer) composer.setSize(window.innerWidth, window.innerHeight);
}

/* ============================================================
 * 校区构建
 * ============================================================ */
function clearCampus() {
  if (campusGroup) {
    scene.remove(campusGroup);
    campusGroup.traverse(function (o) {
      // Sprite 共用 three 内部同一份几何体，绝不能 dispose，否则全部标签失效
      if (o.geometry && !o.geometry._shared && !o.isSprite) o.geometry.dispose();
      var mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
      mats.forEach(function (m) {
        if (m._shared) return;
        if (m.map && m.map.dispose && !m.map._cached) m.map.dispose();
        if (m.emissiveMap && m.emissiveMap.dispose && !m.emissiveMap._cached) m.emissiveMap.dispose();
        // 标签图集等自定义着色器的贴图挂在 uniforms 上，需单独释放
        if (m.uniforms && m.uniforms.uMap && m.uniforms.uMap.value && m.uniforms.uMap.value.dispose) {
          m.uniforms.uMap.value.dispose();
        }
        m.dispose();
      });
    });
  }
  if (routeGroup) { scene.remove(routeGroup); routeGroup = null; }
  if (cloudGroup) { scene.remove(cloudGroup); cloudGroup = null; }
  if (satGroup) {
    if (scene) scene.remove(satGroup);
    satGroup.children.forEach(function (c) {
      if (c.material && c.material.map) c.material.map.dispose();
      if (c.material) c.material.dispose();
      if (c.geometry) c.geometry.dispose();
    });
    satGroup = null;
  }

  campusGroup = null; labelGroup = null; pickables = []; buildingEntries = [];
  buildingMats = [];
  lampMats = [];
  haloMats = [];
  neonMats = [];
  groundMesh = null;
  selected = null;
  if (selRing) selRing.visible = false;
  if (selBeacon) selBeacon.visible = false;
  clearNavRoute();
  if (UI && UI.infoCard) UI.infoCard.classList.remove('show');
}

function addRoad(a, b, w, grp) {
  var dx = b[0] - a[0], dz = b[1] - a[1];
  var len = Math.sqrt(dx * dx + dz * dz);
  if (len < 0.1) return;
  var geo = new THREE.PlaneGeometry(len, w);
  var uv = geo.attributes.uv;
  var rep = Math.max(1, len / 22);
  for (var i = 0; i < uv.count; i++) {
    uv.setX(i, uv.getX(i) * rep);
  }
  var mesh = new THREE.Mesh(geo, getSharedRoadMaterial());
  mesh.rotation.x = -Math.PI / 2;
  mesh.rotation.z = -Math.atan2(dz, dx);
  mesh.position.set((a[0] + b[0]) / 2, 0.12, (a[1] + b[1]) / 2);
  mesh.receiveShadow = true;
  mesh.name = 'road';
  grp.add(mesh);
}

function buildingFootprint(b) {
  if (b.shape === 'track') return { x: b.pos[0], z: b.pos[1], w: b.rx * 2, d: b.rz * 2 };
  if (b.shape === 'dome') return { x: b.pos[0], z: b.pos[1], w: b.r * 2.4, d: b.r * 2.4 };
  if (b.shape === 'gate') return { x: b.pos[0], z: b.pos[1], w: b.w + 10, d: 12 };
  if (b.shape === 'courts') {
    var cols = b.cols || Math.ceil(b.n / 2);
    var rows = Math.ceil(b.n / cols);
    return { x: b.pos[0], z: b.pos[1], w: cols * (b.cw || 16) + (cols - 1) * 6, d: rows * (b.cd || 26) + (rows - 1) * 6 };
  }
  if (b.shape === 'multi') {
    var minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    b.parts.forEach(function (p) {
      minX = Math.min(minX, p.dx - p.w / 2); maxX = Math.max(maxX, p.dx + p.w / 2);
      minZ = Math.min(minZ, p.dz - p.d / 2); maxZ = Math.max(maxZ, p.dz + p.d / 2);
    });
    return { x: b.pos[0] + (minX + maxX) / 2, z: b.pos[1] + (minZ + maxZ) / 2, w: maxX - minX, d: maxZ - minZ };
  }
  return { x: b.pos[0], z: b.pos[1], w: b.size[0], d: b.size[1] };
}

function buildingTopY(b) {
  if (b.shape === 'gate') return b.h + 12;
  if (b.shape === 'track') return 26;
  if (b.shape === 'courts') return 16;
  if (b.shape === 'arena') return b.h * 0.8 + 14;
  if (b.shape === 'dome') return b.h + b.r * 0.92 + 12;
  if (b.shape === 'multi') {
    var mh = 0;
    b.parts.forEach(function (p) { mh = Math.max(mh, p.h); });
    return mh + 14;
  }
  return b.h + 14;
}

function isMajorLandmark(b) {
  if (!b) return false;
  if (b.cat === 'lib' || b.cat === 'admin') return true;
  if (b.shape === 'gate' || b.shape === 'track' || b.shape === 'arena') return true;
  if (b.floors >= 10 || b.h >= 30) return true; // 12层西区教学主楼主塔等核心地标
  var name = b.name || '';
  if (/郭力楼|西区教学主楼|东区主教学楼|数学与统计|主教学楼|科技大楼|教学科研楼|电气与电子|图书馆|博厚|活动中心|食堂|田径|门|计算机/.test(name)) return true;
  return false;
}

function buildBoundaryLines(campus) {
  var grp = new THREE.Group();
  grp.name = 'boundaryLines';
  if (!campus.groundPolys || !campus.groundPolys.length) return grp;
  campus.groundPolys.forEach(function (poly) {
    var pts = poly.map(function (p) { return new THREE.Vector3(p[0], 0.16, p[1]); });
    if (pts.length > 2) pts.push(pts[0].clone());
    var geo = new THREE.BufferGeometry().setFromPoints(pts);
    var mat = new THREE.LineBasicMaterial({
      color: 0xffd54d,
      transparent: true,
      opacity: 0.55
    });
    var line = new THREE.Line(geo, mat);
    line.renderOrder = 4;
    grp.add(line);
  });
  return grp;
}

function buildCampus(campus) {
  var _tBuild0 = (window.performance && performance.now) ? performance.now() : 0;
  clearCampus();
  currentCampus = campus;
  campusGroup = new THREE.Group();
  labelGroup = new THREE.Group();
  var cx = campus.center ? campus.center[0] : 0;
  var cz = campus.center ? campus.center[1] : 0;

  groundMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(campus.ground, campus.ground),
    new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.1, color: (weatherMode === 'snow' ? 0xedf2f7 : 0xffffff), map: (weatherMode === 'snow' ? null : grassTexture(GRASS)) })
  );
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.position.set(cx, 0, cz);
  groundMesh.receiveShadow = true; groundMesh.name = 'ground';
  campusGroup.add(groundMesh);

  for (var p = 0; p < 8; p++) {
    var patch = new THREE.Mesh(
      new THREE.CircleGeometry(rand(40, 90), 24),
      new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.1, color: 0xffffff, map: grassTexture(GRASS2) })
    );
    patch.rotation.x = -Math.PI / 2;
    patch.position.set(cx + rand(-campus.ground / 3, campus.ground / 3), 0.05, cz + rand(-campus.ground / 3, campus.ground / 3)); patch.name='ground_patch'; patch.visible = !isSatellite;
    campusGroup.add(patch);
  }

  // 校区范围示意轮廓
  campusGroup.add(buildBoundaryLines(campus));

  campus.roads.forEach(function (r) {
    if (r.poly) {
      for (var i = 0; i < r.poly.length - 1; i++) {
        addRoad(r.poly[i], r.poly[i+1], r.w || 7, campusGroup);
      }
    } else if (r.a && r.b) {
      addRoad(r.a, r.b, r.w, campusGroup);
    }
  });

  (campus.props || []).forEach(function (pp) { campusGroup.add(buildProp(pp, campus)); });

  var footprints = campus.buildings.map(buildingFootprint);

  campus.buildings.forEach(function (b) {
    var grp;
    if (b.shape === 'gate') grp = buildGate(b, campus);
    else if (b.shape === 'dome') grp = buildDome(b);
    else if (b.shape === 'arena') grp = buildArena(b);
    else if (b.shape === 'track' || b.shape === 'stadium') grp = buildTrack(b);
    else if (b.shape === 'courts') grp = buildCourts(b);
    else if (b.shape === 'grandstand' || b.id === 'osm63') grp = buildGrandstand(b, campus);
    else if (b.shape === 'activity' || b.id === 'osm50') grp = buildActivityCenter(b, campus);
    else if (b.shape === 'multi') grp = buildMulti(b);
    else if (b.id === 'osm21') grp = buildXiQuZhuJiao(b, campus);
    else if (b.id === 'osm34') grp = buildBohouLibrary(b, campus);
    else if (b.id === 'osm53') grp = buildDongquZhuJiao(b, campus);
    else if (b.id === 'osm59') grp = buildGuoLiLou(b, campus);
    else if (b.id === 'osm0') grp = buildNanhuLibrary(b, campus);
    else if (b.id === 'osm2') grp = buildAuditorium(b, campus);
    else if (b.shape === 'mathStats' || b.id === 'osm64') grp = buildMathStatsBuilding(b, campus);
    else if (b.id === 'osm28' || b.id === 'osm54' || b.id === 'osm14' || /食堂/.test(b.name)) grp = buildCanteenBuilding(b, campus);
    else if (isCollegeBuilding(b.id) || /学院楼|科研楼|实验楼|基础楼|逸夫楼|工训|办公|行政/.test(b.name)) grp = buildCollegeBuilding(b, campus);
    else if (isDormBuilding(b.id) || /公寓|宿舍|寝/.test(b.name)) grp = buildDormBuilding(b, campus);
    else if (isServiceYuan(b.id) || /苑/.test(b.name)) grp = buildServiceYuan(b, campus);
    else grp = buildBox(b);

    grp.position.set(b.pos[0], 0, b.pos[1]);
    if (!b.pts && b.rot) grp.rotation.y = b.rot;
    grp.userData.bid = b.id;
    grp.userData.cat = b.cat;
    grp.traverse(function (o) { o.userData.bid = b.id; o.userData.cat = b.cat; });
    campusGroup.add(grp);
    pickables.push(grp);

    var priority = isMajorLandmark(b) ? 1 : 2;
    var lbl = makeLabel(b.name, CATEGORIES[b.cat].color, b.ls || 1, priority);
    lbl.position.set(b.pos[0], buildingTopY(b) + 6, b.pos[1]);
    lbl.userData.bid = b.id;
    lbl.userData.cat = b.cat;
    labelGroup.add(lbl);

    buildingEntries.push({ id: b.id, cat: b.cat, data: b, group: grp, label: lbl });
  });

  // 渲染校门与地标门厅示意（全部纳入 3D 模型与检索）
  if (campus.gates && campus.gates.length) {
    campus.gates.forEach(function (g) {
      var gb = {
        id: g.id,
        name: g.name,
        cat: 'admin',
        shape: 'gate',
        pos: g.pos,
        w: g.w || 32,
        h: g.h || 12,
        rot: g.rot || 0,
        desc: g.desc || (g.name + '，长春工业大学主要校门通道。')
      };
      var grp = buildGate(gb, campus);
      grp.position.set(g.pos[0], 0, g.pos[1]);
      if (g.rot) grp.rotation.y = g.rot;
      grp.userData.bid = g.id;
      grp.userData.cat = 'admin';
      grp.traverse(function (o) { o.userData.bid = g.id; o.userData.cat = 'admin'; });
      campusGroup.add(grp);
      pickables.push(grp);

      var priority = 1;
      var lbl = makeLabel(g.name, CATEGORIES.admin.color, 0.92, priority);
      lbl.position.set(g.pos[0], gb.h + 8, g.pos[1]);
      lbl.userData.bid = g.id;
      lbl.userData.cat = 'admin';
      labelGroup.add(lbl);

      buildingEntries.push({ id: g.id, cat: 'admin', data: gb, group: grp, label: lbl });
    });
  }

  // 批量布设 InstancedMesh 树木
  var allTreePoints = [];
  
  var tList = campus.trees ? (Array.isArray(campus.trees) ? campus.trees : [campus.trees]) : [];
  tList.forEach(function (t) {

    allTreePoints = allTreePoints.concat(collectTreePoints(t, footprints));
  });
  buildInstancedTrees(allTreePoints, campusGroup);

  // 批量布设 InstancedMesh 路灯
  buildInstancedLamps(campus, footprints, campusGroup);

  // 导览推荐路线
  var rGrp = buildGuideRoutes(campus);
  campusGroup.add(rGrp);

  // 高空浮云
  cloudGroup = buildClouds(campus.ground);
  if (scene) scene.add(cloudGroup);

  campusGroup.add(labelGroup);

  /* ---- 建筑标签打包进单张图集，数十个 Sprite 合成一个实例化批次 ---- */
  try {
    bakeLabelsToAtlas(labelGroup, campusGroup);
  } catch (e) {
    console.warn('标签图集合批跳过：', e);
  }

  /* ---- 静态合批：压缩 draw call（道路 / 草地斑块 / 霓虹描边 / 建筑同材质零件） ---- */
  var batchStat = { saved: 0 };
  var _tBatch0 = (window.performance && performance.now) ? performance.now() : 0;
  try {
    campusGroup.updateMatrixWorld(true);

    // 1) 道路分段一次性合并为单张网格（原为数百个独立 Mesh）
    var roadMeshes = campusGroup.children.filter(function (c) { return c.name === 'road' && c.isMesh; });
    if (mergeMeshList(campusGroup, roadMeshes, getSharedRoadMaterial(), 'road')) {
      batchStat.saved += roadMeshes.length - 1;
    }

    // 2) 草地斑块合并（季节着色仍作用于合并后的单个对象）
    var patches = campusGroup.children.filter(function (c) { return c.name === 'ground_patch' && c.isMesh; });
    if (patches.length > 1) {
      if (mergeMeshList(campusGroup, patches, patches[0].material, 'ground_patch')) {
        batchStat.saved += patches.length - 1;
      }
    }

    // 3) 夜景霓虹描边合并为一条线段对象
    var neonMat = getSharedNeonMaterial();
    var neonList = [];
    campusGroup.traverse(function (o) {
      if (o.isLineSegments && o.material === neonMat) neonList.push(o);
    });
    if (mergeLineSegmentsList(campusGroup, neonList, neonMat, 'neonEdges')) {
      batchStat.saved += neonList.length - 1;
    }

    // 4) 每栋建筑内部：先按「完全同外观材质」合批，再按表面档位做顶点色跨材质合批
    campusGroup.children.forEach(function (c) {
      if (!c.userData || !c.userData.bid) return;
      batchStat.saved += batchBuildingGroup(c);
      batchStat.saved += batchBuildingGroupVertex(c);
    });

    // 5) 配景（雕塑 / 球场 / 旗杆等）同样按同材质合批
    campusGroup.children.forEach(function (c) {
      if (c.name === 'prop') { batchStat.saved += batchBuildingGroup(c); batchStat.saved += batchBuildingGroupVertex(c); }
    });
  } catch (e) {
    console.warn('静态合批跳过：', e);
  }
  batchStat.ms = Math.round(((window.performance && performance.now) ? performance.now() : 0) - _tBatch0);
  window.__batchStat = batchStat;

  /* ---- 拾取加速：预计算每栋楼的包围球，点击/悬停先做射线-球粗筛 ---- */
  try {
    campusGroup.updateMatrixWorld(true);
    pickables.forEach(function (grp) {
      var box = new THREE.Box3().setFromObject(grp);
      grp.userData.bs = new THREE.Sphere(
        box.getCenter(new THREE.Vector3()),
        box.getSize(new THREE.Vector3()).length() * 0.5 + 2
      );
    });
  } catch (e) { /* 包围球失败时自动退回全量射线检测 */ }

  if (scene) scene.add(campusGroup);

  var cam = campus.camera;
  if (camera && camera.position && cam) camera.position.set(cam.pos[0], cam.pos[1], cam.pos[2]);
  if (controls && controls.target && cam) {
    controls.target.set(cam.target[0], cam.target[1], cam.target[2]);
    controls.update();
  }

  applyTimeMode(timeMode);
  applyWeatherMode(weatherMode);
  filterCategory(activeCategory);
  buildList(campus);
  showIntro(campus);

  if (renderer && renderer.shadowMap) renderer.shadowMap.needsUpdate = true;

  if (isSatellite) {
    if (groundMesh) groundMesh.visible = false;
    if (campusGroup) {
      campusGroup.children.forEach(function (c) {
        if ((c.name === 'ground_patch' || c.name === 'ground')) c.visible = false;
        if (c.isInstancedMesh) c.visible = false;
      });
    }
    if (cloudGroup) cloudGroup.visible = false;
    setupSatelliteMap();
  }

  window.__buildMs = Math.round(((window.performance && performance.now) ? performance.now() : 0) - _tBuild0);
}

/* ============================================================
 * 微气候光影系统（白天 ☀️ / 黄昏 🌅 / 夜景 🌙）
 * ============================================================ */
function updateBloom() {
  if (!bloomPass) return;
  if (isSatellite || timeMode === 'night') {
    bloomPass.strength = 1.2;
    bloomPass.radius = 0.5;
  } else if (timeMode === 'sunset') {
    bloomPass.strength = 0.6;
    bloomPass.radius = 0.2;
  } else {
    bloomPass.strength = 0;
  }
}

function applyTimeMode(mode) {
  timeMode = mode;
  isNight = (mode === 'night');
  var isSunset = (mode === 'sunset');

  var skySet = DAY_SKY;
  var dirColor = 0xfff2dd, dirInt = 1.05;
  var hemiSky = 0xcfe6ff, hemiGrd = 0x8a9a6a, hemiInt = 0.85;
  var ambColor = 0xffffff, ambInt = 0.28;
  var winEmissive = 0;
  var lampEmissive = 0;
  var haloOpacity = 0;
  var starOpacity = 0;

  if (isSunset) {
    skySet = SUNSET_SKY;
    dirColor = 0xff9b57; dirInt = 1.18;
    hemiSky = 0xf5a57a; hemiGrd = 0x52423b; hemiInt = 0.72;
    ambColor = 0x946552; ambInt = 0.32;
    winEmissive = 0.40;
    lampEmissive = 0.75;
    haloOpacity = 0.45;
  } else if (isNight) {
    skySet = NIGHT_SKY;
    dirColor = 0x9db8e8; dirInt = 0.18;
    hemiSky = 0x3a4a77; hemiGrd = 0x152033; hemiInt = 0.22;
    ambColor = 0x223048; ambInt = 0.16;
    winEmissive = 0.95;
    lampEmissive = 1.0;
    haloOpacity = 0.85;
    starOpacity = 0.9;
  }

  scene.background = skyTexture(skySet);
  scene.fog.color.set(skySet.fog);
  scene.fog.near = isNight ? 500 : (isSunset ? 600 : 700);
  
  updateBloom();

  // 更新环境光贴图 (VR级别物理渲染要求)
  if (window.pmremGenerator) {
    if (scene.environment && scene.environment.dispose) {
      scene.environment.dispose();
    }
    var envScene = new THREE.Scene();
    envScene.background = scene.background;
    scene.environment = pmremGenerator.fromScene(envScene).texture;
  }
  
  if (renderer && renderer.shadowMap) renderer.shadowMap.needsUpdate = true;

  dirLight.color.set(dirColor);
  dirLight.intensity = dirInt;
  if (isSunset) dirLight.position.set(-560, 320, 380);
  else dirLight.position.set(-420, 620, 360);

  hemiLight.color.set(hemiSky);
  hemiLight.groundColor.set(hemiGrd);
  hemiLight.intensity = hemiInt;

  ambientLight.color.set(ambColor);
  ambientLight.intensity = ambInt;

  buildingMats.forEach(function (m) { m.emissiveIntensity = winEmissive; });
  lampMats.forEach(function (m) { m.emissiveIntensity = lampEmissive; });
  haloMats.forEach(function (m) { m.opacity = haloOpacity; });
  if (sharedNeonMaterial) sharedNeonMaterial.opacity = (isNight || isSatellite) ? 0.75 : 0;
  neonMats.forEach(function (m) { m.opacity = (isNight || isSatellite) ? 0.75 : 0; });
  stars.material.opacity = starOpacity;

  if (cloudMats && cloudMats.length) {
    var cColor = isNight ? 0x203254 : (isSunset ? 0xffc2ad : 0xffffff);
    var cOp = isNight ? 0.22 : (isSunset ? 0.55 : 0.46);
    cloudMats.forEach(function (cm) { cm.color.set(cColor); cm.opacity = cOp; });
  }

  var btn = $('btnTimeMode');
  var topTime = $('btnTime');
  var modeText = (timeMode === 'day') ? '☀️ 白天' : (timeMode === 'sunset') ? '🌅 黄昏' : '🌙 夜景';
  var isOn = (timeMode !== 'day');
  if (btn) {
    btn.innerHTML = modeText;
    btn.classList.toggle('on', isOn);
  }
  if (topTime) {
    topTime.innerHTML = modeText;
    topTime.classList.toggle('on', isOn);
  }
}

function applyNight(night) {
  applyTimeMode(night ? 'night' : 'day');
}

/* ============================================================
 * 建筑分类快速筛选
 * ============================================================ */
function filterCategory(cat) {
  activeCategory = cat || 'all';
  var chips = document.querySelectorAll('#catFilter .c-chip');
  chips.forEach(function (c) {
    c.classList.toggle('active', c.getAttribute('data-cat') === activeCategory);
  });

  buildingEntries.forEach(function (entry) {
    var match = (activeCategory === 'all' || entry.cat === activeCategory);
    entry.group.traverse(function (child) {
      if (child.isLine) {
        child.visible = true;
      }
      if (child.isMesh) {
        // Disable shadow casting in satellite mode to remove "ghost shadows"
        child.castShadow = !isSatellite;
        
        if (!child.material) return;
        var mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach(function (m) {
          if (m._shared) return;
          m.visible = true;
          m.transparent = !match;
          m.opacity = match ? 1.0 : 0.22;
        });
      }
    });
    if (entry.label) entry.label.visible = match;
  });

  buildList(currentCampus);
}

/* ============================================================
 * 拾取 & 信息卡
 * ============================================================ */
function pickAt(clientX, clientY) {
  pointer.x = (clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  // 包围球粗筛：先剔除射线打不中的楼，再做精确网格求交
  var cands = null;
  for (var i = 0; i < pickables.length; i++) {
    var bs = pickables[i] && pickables[i].userData.bs;
    if (!bs || raycaster.ray.intersectsSphere(bs)) {
      if (!cands) cands = [];
      cands.push(pickables[i]);
    }
  }
  if (cands === null) cands = pickables;
  if (!cands.length) return null;
  var hits = raycaster.intersectObjects(cands, true);
  for (var j = 0; j < hits.length; j++) {
    var bid = hits[j].object.userData.bid;
    if (bid) return findBuilding(bid);
  }
  return null;
}

/* ---------------- 悬停浮签与性能面板 ---------------- */
var hoverTip = null, hoverTipOn = false;
function ensureHoverTip() {
  if (hoverTip) return hoverTip;
  hoverTip = document.createElement('div');
  hoverTip.style.cssText = 'position:fixed;z-index:70;pointer-events:none;display:none;' +
    'background:rgba(6,14,26,.86);color:#f2f7fd;font:600 12px/1.5 "Microsoft YaHei",sans-serif;' +
    'padding:5px 10px;border-radius:9px;border:1px solid rgba(255,213,77,.45);' +
    'box-shadow:0 6px 18px rgba(0,0,0,.35);white-space:nowrap;backdrop-filter:blur(6px);';
  document.body.appendChild(hoverTip);
  return hoverTip;
}
function showHoverTip(x, y, text) {
  var el = ensureHoverTip();
  el.textContent = text;
  el.style.display = 'block';
  var w = el.offsetWidth || 120;
  el.style.left = Math.min(x + 14, window.innerWidth - w - 10) + 'px';
  el.style.top = (y + 16) + 'px';
}
function hideHoverTip() {
  if (hoverTip && hoverTip.style.display !== 'none') hoverTip.style.display = 'none';
}

var perfHud = null, perfHudOn = false, _fpsFrames = 0, _fpsLast = 0;
function ensurePerfHud() {
  if (perfHud) return perfHud;
  perfHud = document.createElement('div');
  perfHud.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:70;display:none;' +
    'background:rgba(6,14,26,.80);color:#cfe0f2;font:11px/1.7 Consolas,Menlo,monospace;' +
    'padding:6px 11px;border-radius:10px;pointer-events:none;white-space:pre;' +
    'border:1px solid rgba(157,184,214,.25);backdrop-filter:blur(6px);';
  document.body.appendChild(perfHud);
  return perfHud;
}
function togglePerfHud(force) {
  perfHudOn = (force !== undefined) ? !!force : !perfHudOn;
  var el = ensurePerfHud();
  el.style.display = perfHudOn ? 'block' : 'none';
  _fpsFrames = 0;
  _fpsLast = performance.now();
  showToast(perfHudOn ? '📊 性能面板已开启（帧率 / DrawCall / 显存）' : '📊 性能面板已关闭');
}

function findBuilding(bid) {  if (!bid) return null;
  for (var i = 0; i < buildingEntries.length; i++) {
    if (buildingEntries[i].id === bid) return { bid: bid, data: buildingEntries[i].data };
  }
  var b = null;
  if (currentCampus && currentCampus.buildings) {
    currentCampus.buildings.forEach(function (x) { if (x.id === bid) b = x; });
  }
  if (!b && currentCampus && currentCampus.gates) {
    currentCampus.gates.forEach(function (g) {
      if (g.id === bid) b = { id: g.id, name: g.name, cat: 'admin', shape: 'gate', pos: g.pos, w: g.w || 32, h: g.h || 12, desc: g.desc };
    });
  }
  return b ? { bid: bid, data: b } : null;
}

function selectBuilding(hit, flyTo) {
  if (!hit) { deselect(); return; }
  selected = hit;
  var b = hit.data;
  var cat = CATEGORIES[b.cat];
  UI.infoName.textContent = b.name;
  UI.infoCampus.textContent = currentCampus.name + ' · ' + cat.name;
  UI.infoCat.style.background = cat.color;
  UI.infoCat.style.color = cat.color;
  UI.infoStats.textContent = b.stats || '';
  UI.infoStats.style.display = b.stats ? '' : 'none';
  UI.infoDesc.textContent = b.desc;

  var walkInfo = calcGateDistance(b, currentKey);
  var walkEl = $('icWalk');
  if (walkEl) {
    if (walkInfo) {
      walkEl.innerHTML = '🚶 至【' + walkInfo.gateName + '】模型坐标估算约 <b>' + walkInfo.dist + 'm</b> · 按固定速度估算步行约 <b>' + walkInfo.min + '分钟</b>';
      walkEl.style.display = 'block';
    } else {
      walkEl.style.display = 'none';
    }
  }

  var picBox = $('icPic');
  if (b.photo) {
    picBox.innerHTML = '<img src="' + b.photo + '" alt="' + b.name + '"><span class="pic-tag">📷 官方实景/效果图</span>';
    picBox.classList.add('has-img');
    var imgEl = picBox.querySelector('img');
    imgEl.onclick = function () { window.open(b.photo, '_blank'); };
    imgEl.title = '点击查看原图';
  } else {
    picBox.innerHTML = '';
    picBox.classList.remove('has-img');
  }

  UI.infoCard.classList.add('show');
  markListItem(hit.bid);

  var fp = buildingFootprint(b);
  selRing.scale.set(fp.w * 0.62 + 6, fp.d * 0.62 + 6, 1);
  selRing.position.set(fp.x, 0.5, fp.z);
  selRing.visible = true;

  if (selBeacon) {
    var topY = buildingTopY(b);
    selBeacon.userData.baseY = topY + 4;
    selBeacon.position.set(fp.x, selBeacon.userData.baseY, fp.z);
    selBeacon.visible = true;
  }

  playSound('select');
  updateURLParams();

  if (flyTo) flyToBuilding(b);
}

function deselect() {
  selected = null;
  selRing.visible = false;
  if (selBeacon) selBeacon.visible = false;
  clearNavRoute();
  UI.infoCard.classList.remove('show');
  var walkEl = $('icWalk');
  if (walkEl) walkEl.style.display = 'none';
  var picBox = $('icPic');
  if (picBox) picBox.classList.remove('has-img');
  markListItem(null);
  updateURLParams();
}

/* ---------------- 校园推荐导览示意线（不提供路网导航） ---------------- */
var activeNavRoute = null;

function clearNavRoute() {
  if (activeNavRoute) {
    scene.remove(activeNavRoute);
    activeNavRoute.traverse(function (o) {
      if (o.geometry && !o.geometry._shared) o.geometry.dispose();
      if (o.material && !o.material._shared) o.material.dispose();
    });
    activeNavRoute = null;
  }
}

function navigateToBuilding(b) {
  if (!b || !b.pos) return;
  playSound('select');
  clearNavRoute();
  
  var walkInfo = calcGateDistance(b, currentKey);
  var gatePos = walkInfo ? walkInfo.gatePos : (currentKey === 'beiHu' ? [-774, 254] : [0, 220]);
  var gateName = walkInfo ? walkInfo.gateName : '校门报到点';
  
  var p0 = new THREE.Vector3(gatePos[0], 0.32, gatePos[1]);
  var p3 = new THREE.Vector3(b.pos[0], 0.32, b.pos[1]);
  var midZ = (p0.z * 0.45 + p3.z * 0.55);
  var p1 = new THREE.Vector3(p0.x, 0.32, midZ);
  var p2 = new THREE.Vector3(p3.x, 0.32, midZ);
  
  var pathPts = [p0, p1, p2, p3];
  var curve = new THREE.CatmullRomCurve3(pathPts, false, 'catmullrom', 0.25);
  var curvePts = curve.getPoints(36);
  
  activeNavRoute = new THREE.Group();
  activeNavRoute.name = 'activeNavRoute';
  
  var navTex = routeTextureFunc();
  var navMat = new THREE.MeshBasicMaterial({
    map: navTex,
    color: 0x00e5ff,
    transparent: true,
    opacity: 0.95,
    depthWrite: false
  });
  
  for (var i = 0; i < curvePts.length - 1; i++) {
    var segA = curvePts[i], segB = curvePts[i + 1];
    var segDist = segA.distanceTo(segB);
    if (segDist < 0.2) continue;
    var segMid = new THREE.Vector3().addVectors(segA, segB).multiplyScalar(0.5);
    var segAngle = Math.atan2(segB.z - segA.z, segB.x - segA.x);
    
    var segMesh = new THREE.Mesh(new THREE.PlaneGeometry(segDist, 5.2), navMat);
    segMesh.rotation.x = -Math.PI / 2;
    segMesh.rotation.z = -segAngle;
    segMesh.position.set(segMid.x, 0.32, segMid.z);
    segMesh.renderOrder = 9;
    activeNavRoute.add(segMesh);
  }
  
  var startRing = new THREE.Mesh(
    new THREE.RingGeometry(2.4, 5.2, 32),
    new THREE.MeshBasicMaterial({ color: 0x00e5ff, side: THREE.DoubleSide, transparent: true, opacity: 0.85 })
  );
  startRing.rotation.x = -Math.PI / 2;
  startRing.position.set(p0.x, 0.35, p0.z);
  activeNavRoute.add(startRing);
  
  scene.add(activeNavRoute);
  
  var centerPos = new THREE.Vector3().addVectors(p0, p3).multiplyScalar(0.5);
  var spanDist = p0.distanceTo(p3);
  var camH = Math.max(160, spanDist * 0.85);
  var targetCamPos = new THREE.Vector3(centerPos.x, camH, centerPos.z + spanDist * 0.7);
  startFly(targetCamPos, centerPos, 1300);
  
  showToast('🚶 已显示从【' + gateName + '】至【' + b.name + '】的示意导览线（非路网导航）');
}

function flyToBuilding(b) {
  stopTour();
  var fp = buildingFootprint(b);
  var dist = Math.max(70, Math.max(fp.w, fp.d) * 1.9);
  var dir = new THREE.Vector3().subVectors(camera.position, controls.target);
  dir.y = 0;
  if (dir.lengthSq() < 1) dir.set(0.6, 0, 1);
  dir.normalize();
  var h = (b.shape === 'multi') ? Math.max.apply(null, b.parts.map(function (p) { return p.h; })) : (b.h || 12);
  var p1 = new THREE.Vector3(fp.x + dir.x * dist, Math.max(36, h * 2.4), fp.z + dir.z * dist);
  startFly(p1, new THREE.Vector3(fp.x, h * 0.55, fp.z));
}

function startFly(p1, look1, dur) {
  fly = {
    p0: camera.position.clone(), p1: p1,
    l0: controls.target.clone(), l1: look1,
    start: performance.now(), dur: dur || 1100,
  };
  controls.enabled = false;
}

function flyTo(p1, look1, dur) {
  startFly(p1, look1, dur);
}

/* 点击指北针平滑归北 */
function resetCompassNorth() {
  stopTour();
  var dx = camera.position.x - controls.target.x;
  var dz = camera.position.z - controls.target.z;
  var distH = Math.sqrt(dx * dx + dz * dz);
  var targetPos = new THREE.Vector3(controls.target.x, camera.position.y, controls.target.z + distH);
  startFly(targetPos, controls.target.clone());
  showToast('🧭 视角已回正指向正北');
}

/* ============================================================
 * 全景漫游
 * ============================================================ */
function buildTourCurve() {
  var c = currentCampus;
  var cx = c.center ? c.center[0] : 0;
  var cz = c.center ? c.center[1] : 0;
  var pts = [];
  var rx = c.ground * 0.34, rz = c.ground * 0.28;
  var n = 10;
  for (var i = 0; i < n; i++) {
    var a = (i / n) * Math.PI * 2;
    var h = c.tourHeight[0] + (c.tourHeight[1] - c.tourHeight[0]) * (0.5 + 0.5 * Math.sin(a * 2 + 1));
    pts.push(new THREE.Vector3(cx + Math.cos(a) * rx, h, cz + Math.sin(a) * rz));
  }
  return new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.6);
}

function startTour() {
  tour.on = true;
  tour.t = 0;
  tour.curve = buildTourCurve();
  controls.enabled = false;
  deselect();
  $('btnTour').classList.add('on');
}
function stopTour() {
  if (!tour.on) return;
  tour.on = false;
  controls.enabled = true;
  $('btnTour').classList.remove('on');
}
var _tourLook = new THREE.Vector3();
var _tourCur = new THREE.Vector3();
var _tourTarget = new THREE.Vector3();

function updateTour(dt) {
  tour.t = (tour.t + dt * 0.0125) % 1;
  var p = tour.curve.getPointAt(tour.t);
  camera.position.lerp(p, 0.06);
  _tourLook.set(controls.target.x, 6, controls.target.z);
  camera.getWorldDirection(_tourCur);
  _tourLook.sub(camera.position).normalize();
  _tourCur.lerp(_tourLook, 0.04);
  _tourTarget.copy(camera.position).addScaledVector(_tourCur, 50);
  camera.lookAt(_tourTarget);
}

/* ============================================================
 * 高清全景截图与海报导出
 * ============================================================ */
function takeScreenshot() {
  var uis = [
    UI.sidebar, UI.infoCard, $('dock'), $('compass'), $('campusIntro'),
    $('topbar'), $('hint'), $('mobileJoystick'), $('gameOverlay'),
    $('crosshair'), $('radarMap')
  ];
  uis.forEach(function (el) { if (el) el.style.visibility = 'hidden'; });

  var useComposer = composer && (isNight || isSatellite || timeMode === 'sunset');
  if (useComposer) {
    composer.render();
  } else {
    renderer.render(scene, camera);
  }

  var w = renderer.domElement.width;
  var h = renderer.domElement.height;
  var offCanvas = document.createElement('canvas');
  offCanvas.width = w; offCanvas.height = h;
  var ctx = offCanvas.getContext('2d');
  ctx.drawImage(renderer.domElement, 0, 0);

  var barH = Math.max(68, Math.round(h * 0.085));
  var grad = ctx.createLinearGradient(0, h - barH, 0, h);
  grad.addColorStop(0, 'rgba(8, 18, 34, 0)');
  grad.addColorStop(1, 'rgba(8, 18, 34, 0.90)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, h - barH, w, barH);

  ctx.fillStyle = '#ffd54d';
  ctx.font = 'bold ' + Math.max(16, Math.round(barH * 0.32)) + 'px "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText('🏫 长春工业大学 · 全景立体地图  [' + currentCampus.name + ']', 24, h - barH * 0.52);

  ctx.fillStyle = '#9db8d6';
  ctx.font = Math.max(11, Math.round(barH * 0.22)) + 'px sans-serif';
  ctx.fillText('CHANGCHUN UNIVERSITY OF TECHNOLOGY · 3D CAMPUS MAP', 24, h - barH * 0.22);

  uis.forEach(function (el) { if (el) el.style.visibility = ''; });

  var a = document.createElement('a');
  a.download = '长春工业大学_' + currentCampus.name + '_全景立体地图.png';
  a.href = offCanvas.toDataURL('image/png');
  a.click();

  showToast('📸 高清全景截图已成功保存！');
}

/* ============================================================
 * 交互功能扩展：气象季节 / 校区切换 / 快捷分享 / 帮助指南
 * ============================================================ */
function applyWeatherMode(mode) {
  if (mode !== 'autumn' && mode !== 'snow') mode = 'summer';
  weatherMode = mode;
  var isSnow = (mode === 'snow');
  var isAutumn = (mode === 'autumn');
  if (snowPoints) snowPoints.visible = isSnow;

  if (groundMesh && groundMesh.material) {
    if (isSnow) {
      groundMesh.material.map = null;
      groundMesh.material.color.set(0xedf2f7);
    } else if (isAutumn) {
      groundMesh.material.map = grassTexture(GRASS);
      groundMesh.material.color.set(0xcca85a);
    } else {
      groundMesh.material.map = grassTexture(GRASS);
      groundMesh.material.color.set(0xffffff);
    }
    groundMesh.material.needsUpdate = true;
  }

  if (campusGroup) {
    campusGroup.children.forEach(function (c) {
      if ((c.name === 'ground_patch' || c.name === 'ground') && c.material) {
        if (isSnow) {
          c.visible = false;
        } else if (isAutumn) {
          c.visible = true;
          c.material.color.set(0xbfa04e);
          c.material.needsUpdate = true;
        } else {
          c.visible = true;
          c.material.color.set(0xffffff);
          c.material.needsUpdate = true;
        }
      }
    });
  }

  if (MATS.leafA && MATS.leafA.length >= 3) {
    var leafColors = isAutumn
      ? [0xf39c12, 0xe67e22, 0xd35400]
      : (isSnow ? [0xdfe6e9, 0xb2bec3, 0x747d8c] : [0x3d7a44, 0x2f6b3c, 0x4c8a4a]);
    MATS.leafA.forEach(function (m, idx) {
      if (leafColors[idx]) m.color.setHex(leafColors[idx]);
    });
  }

  if (renderer && renderer.shadowMap) renderer.shadowMap.needsUpdate = true;

  var wBtn = $('btnWeather');
  var wDock = $('btnWeatherDock');
  var curLabel = (mode === 'summer') ? '🌿 夏绿' : ((mode === 'autumn') ? '🍂 金秋' : '❄️ 冬雪');
  if (wBtn) {
    wBtn.innerHTML = curLabel;
    wBtn.classList.toggle('on', mode !== 'summer');
  }
  if (wDock) {
    wDock.innerHTML = curLabel;
    wDock.classList.toggle('on', mode !== 'summer');
  }
  updateURLParams();
}

function toggleWeather() {
  playSound('btn');
  var nextMode = 'summer';
  if (weatherMode === 'summer') nextMode = 'autumn';
  else if (weatherMode === 'autumn') nextMode = 'snow';
  else nextMode = 'summer';

  applyWeatherMode(nextMode);
  var toastMap = {
    summer: '🌿 已切换至葱郁夏绿模式',
    autumn: '🍂 已切换至金秋银杏模式',
    snow: '❄️ 已切换至北国冬雪模式'
  };
  showToast(toastMap[nextMode] || '✨ 季节光景已切换');
}

function switchCampus(key, targetBid) {
  if (!CAMPUSES[key] || key === currentKey) {
    if (targetBid) {
      var targetSame = findBuilding(targetBid);
      if (targetSame) selectBuilding(targetSame, true);
    }
    return;
  }
  if (isGameMode) toggleGameMode();
  stopTour();
  currentKey = key;
  document.querySelectorAll('.campus-tabs button').forEach(function (b) {
    b.classList.toggle('active', b.getAttribute('data-key') === key);
  });
  playSound('campus');
  buildCampus(CAMPUSES[key]);
  if (isSatellite) {
    setupSatelliteMap();
  } else {
    if (satGroup) satGroup.visible = false;
  }
  updateBloom();
  filterCategory(activeCategory);
  if (targetBid) {
    var target = findBuilding(targetBid);
    if (target) selectBuilding(target, true);
  }
  updateURLParams();
}

function updateURLParams() {
  try {
    var url = new URL(window.location.href);
    url.searchParams.set('campus', currentKey);
    if (selected && selected.bid) {
      url.searchParams.set('bid', selected.bid);
    } else {
      url.searchParams.delete('bid');
    }
    if (timeMode && timeMode !== 'day') {
      url.searchParams.set('time', timeMode);
    } else {
      url.searchParams.delete('time');
    }
    if (weatherMode && weatherMode !== 'summer') {
      url.searchParams.set('weather', weatherMode);
    } else {
      url.searchParams.delete('weather');
    }
    window.history.replaceState(null, '', url.toString());
  } catch (e) {}
}

function copyShareLink(bid) {
  playSound('btn');
  updateURLParams();
  var shareUrl = window.location.href;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(shareUrl).then(function () {
      showToast('🔗 分享链接已复制到剪贴板！');
    }).catch(function () {
      prompt('请复制当前分享链接：', shareUrl);
    });
  } else {
    prompt('请复制当前分享链接：', shareUrl);
  }
}

function toggleFullscreen() {
  playSound('btn');
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(function () {});
  } else {
    if (document.exitFullscreen) document.exitFullscreen();
  }
}

function toggleSound() {
  soundEnabled = !soundEnabled;
  try { localStorage.setItem('ccut_map_sound', soundEnabled ? '1' : '0'); } catch (e) {}
  var btn = $('btnSound');
  if (btn) {
    btn.innerHTML = soundEnabled ? '🔊' : '🔇';
    btn.classList.toggle('on', !soundEnabled);
  }
  if (soundEnabled) {
    initAudioEngine();
    startAmbientSoundscape();
    playSound('btn');
  }
  showToast(soundEnabled ? '🔊 音效已开启' : '🔇 音效已静音');
}

function toggleHelp(show) {
  playSound('btn');
  var modal = $('helpModal');
  if (!modal) return;
  if (typeof show === 'boolean') {
    modal.classList.toggle('hide', !show);
  } else {
    modal.classList.toggle('hide');
  }
}

/* ============================================================
 * UI
 * ============================================================ */
function buildList(campus) {
  var box = UI.blist;
  if (!box) return;
  box.innerHTML = '';
  var q = (UI.search && UI.search.value ? UI.search.value : '').trim();
  var qLower = q.toLowerCase();
  var groups = {};
  var totalMatched = 0;

  var clearBtn = $('searchClear');
  if (clearBtn) clearBtn.classList.toggle('show', !!q);

  var allItems = (campus.buildings || []).slice();
  if (campus.gates) {
    campus.gates.forEach(function (g) {
      allItems.push({ id: g.id, name: g.name, cat: 'admin', shape: 'gate', pos: g.pos, desc: g.desc });
    });
  }

  allItems.forEach(function (b) {
    if (activeCategory !== 'all' && b.cat !== activeCategory) return;
    if (q && !matchSearch(b.name, q)) return;
    totalMatched++;
    (groups[b.cat] = groups[b.cat] || []).push(b);
  });

  var countBadge = $('bcount');
  if (countBadge) countBadge.textContent = totalMatched + ' 处';

  var any = false;
  Object.keys(CATEGORIES).forEach(function (cat) {
    if (!groups[cat]) return;
    any = true;
    var g = document.createElement('div');
    g.className = 'group';
    var gn = document.createElement('div');
    gn.className = 'gname';
    gn.innerHTML = '<i style="background:' + CATEGORIES[cat].color + '"></i>' + CATEGORIES[cat].name + ' (' + groups[cat].length + ')';
    g.appendChild(gn);
    groups[cat].forEach(function (b) {
      var it = document.createElement('div');
      it.className = 'item';
      it.setAttribute('data-bid', b.id);
      if (selected && selected.bid === b.id) it.classList.add('sel');

      var labelHtml = b.name;
      if (q) {
        var idx = b.name.toLowerCase().indexOf(qLower);
        if (idx >= 0) {
          labelHtml = b.name.substring(0, idx) + '<mark>' + b.name.substring(idx, idx + q.length) + '</mark>' + b.name.substring(idx + q.length);
        }
      }

      it.innerHTML = '<span>' + labelHtml + '</span>' + (b.photo ? '<small style="color:#ffd54d;font-size:10px;">图</small>' : '');
      it.addEventListener('click', function () {
        selectBuilding(findBuilding(b.id), true);
        if (window.innerWidth <= 768) {
          UI.sidebar.classList.add('hidden');
          var sbBtn = $('btnSidebar');
          if (sbBtn) sbBtn.classList.remove('on');
        }
      });
      g.appendChild(it);
    });
    box.appendChild(g);
  });
  if (!any) box.innerHTML = '<div class="empty">未找到匹配的建筑</div>';
}

function markListItem(bid) {
  var items = UI.blist.querySelectorAll('.item');
  for (var i = 0; i < items.length; i++) {
    var isSel = (items[i].getAttribute('data-bid') === bid);
    items[i].classList.toggle('sel', isSel);
    if (isSel && UI.sidebar && !UI.sidebar.classList.contains('hidden')) {
      items[i].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }
}

function showIntro(campus) {
  var el = UI.campusIntro || (typeof $ === 'function' ? $('campusIntro') : null);
  if (el) {
    el.innerHTML = '<b>' + campus.name + '</b>' + campus.intro;
    el.classList.remove('hide');
  }
}

/* ============================================================
 * 第一人称校园漫游 (FPS Game Mode)
 * ============================================================ */
var isGameMode = false;
var vrSavedCam = { pos: new THREE.Vector3(), target: new THREE.Vector3() };

// FPS 控制状态
var playerVelocity = new THREE.Vector3();
var playerDirection = new THREE.Vector3();
var playerEuler = new THREE.Euler(0, 0, 0, 'YXZ');
var fpsKeys = { w: false, a: false, s: false, d: false, shift: false, space: false };
var canJump = false;

// ---------------- Procedural Audio Engine ----------------
var audioCtx = null;
var windGain = null;
var noiseBuffer = null;

function initAudioEngine() {
  if (audioCtx) {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return;
  }
  var AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  audioCtx = new AudioContext();
  
  var bufferSize = audioCtx.sampleRate * 2; 
  noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  var output = noiseBuffer.getChannelData(0);
  for (var i = 0; i < bufferSize; i++) {
    output[i] = Math.random() * 2 - 1; // White noise
  }

  // Wind setup (Continuous Low-Pass Noise)
  var windFilter = audioCtx.createBiquadFilter();
  windFilter.type = 'lowpass';
  windFilter.frequency.value = 400;
  windGain = audioCtx.createGain();
  windGain.gain.value = 0;
  
  var windSource = audioCtx.createBufferSource();
  windSource.buffer = noiseBuffer;
  windSource.loop = true;
  windSource.connect(windFilter);
  windFilter.connect(windGain);
  windGain.connect(audioCtx.destination);
  windSource.start();
}

function playFootstep(speed) {
  if (!audioCtx || !soundEnabled) return;
  var source = audioCtx.createBufferSource();
  source.buffer = noiseBuffer;
  var filter = audioCtx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = speed > 20 ? 800 : 400; // Running sounds crisper
  filter.Q.value = 1.5;
  var gain = audioCtx.createGain();
  gain.gain.setValueAtTime(0.5, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.15);
  
  source.connect(filter);
  filter.connect(gain);
  gain.connect(audioCtx.destination);
  source.start();
  source.stop(audioCtx.currentTime + 0.2);
}

function playJump() {
  if (!audioCtx || !soundEnabled) return;
  var osc = audioCtx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(150, audioCtx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(50, audioCtx.currentTime + 0.2);
  var gain = audioCtx.createGain();
  gain.gain.setValueAtTime(0.6, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.2);
  
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + 0.2);
}

function playLand(velocity) {
  if (!audioCtx || !soundEnabled) return;
  var source = audioCtx.createBufferSource();
  source.buffer = noiseBuffer;
  var filter = audioCtx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 300;
  var gain = audioCtx.createGain();
  var vol = Math.min(1.0, Math.abs(velocity) / 100);
  gain.gain.setValueAtTime(vol, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
  
  source.connect(filter);
  filter.connect(gain);
  gain.connect(audioCtx.destination);
  source.start();
  source.stop(audioCtx.currentTime + 0.3);
}
document.addEventListener('pointerlockchange', function () {
  if (document.pointerLockElement !== document.body && isGameMode) {
    toggleGameMode(); // Exit if user presses ESC
  }
});
document.addEventListener('mousemove', function (e) {
  if (isGameMode && document.pointerLockElement === document.body) {
    var movementX = e.movementX || e.mozMovementX || e.webkitMovementX || 0;
    var movementY = e.movementY || e.mozMovementY || e.webkitMovementY || 0;
    var sensitivity = 0.002;
    playerEuler.y -= movementX * sensitivity;
    playerEuler.x -= movementY * sensitivity;
    playerEuler.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, playerEuler.x));
    camera.quaternion.setFromEuler(playerEuler);
  }
});
document.addEventListener('keydown', function(e) {
  if (!isGameMode) return;
  switch (e.code) {
    case 'KeyW': fpsKeys.w = true; break;
    case 'KeyA': fpsKeys.a = true; break;
    case 'KeyS': fpsKeys.s = true; break;
    case 'KeyD': fpsKeys.d = true; break;
    case 'ShiftLeft': case 'ShiftRight': fpsKeys.shift = true; break;
    case 'Space': 
      if (canJump) { playerVelocity.y += 60; canJump = false; playJump(); } 
      break;
  }
});
document.addEventListener('keyup', function(e) {
  if (!isGameMode) return;
  switch (e.code) {
    case 'KeyW': fpsKeys.w = false; break;
    case 'KeyA': fpsKeys.a = false; break;
    case 'KeyS': fpsKeys.s = false; break;
    case 'KeyD': fpsKeys.d = false; break;
    case 'ShiftLeft': case 'ShiftRight': fpsKeys.shift = false; break;
  }
});

function toggleGameMode() {
  if (typeof playSound !== 'undefined') playSound('switch');
  var btn = $('btnVR');
  var radar = $('radarMap');
  if (!isGameMode) {
    initAudioEngine();
    startAmbientSoundscape();
    try {
      if (document.body.requestPointerLock) document.body.requestPointerLock();
    } catch (e) {}
    isGameMode = true;
    document.body.classList.add('game-mode-active');
    if (btn) { btn.classList.add('on'); btn.innerHTML = '🎮 退出漫游'; }
    if (radar) {
      radar.style.display = 'block';
      drawRadarBackground(); // Draw buildings once
    }
    
    vrSavedCam.pos.copy(camera.position);
    vrSavedCam.target.copy(controls.target);
    
    controls.enabled = false;
    stopTour();

    var cx = controls.target.x;
    var cz = controls.target.z;
    var eyeH = 2.2;
    if (selected && selected.data && selected.data.pos) {
      var bx = selected.data.pos[0], bz = selected.data.pos[1];
      var standDist = 40;
      cx = bx; cz = bz + standDist;
    }
    camera.position.set(cx, eyeH, cz);
    
    // 面向原目标方向
    camera.lookAt(controls.target.x, eyeH, controls.target.z);
    playerEuler.setFromQuaternion(camera.quaternion);
    
    playerVelocity.set(0, 0, 0);
    showToast('🎮 已进入校园漫游模式 (ESC 或轻触✕退出)');
  } else {
    try {
      if (document.pointerLockElement === document.body) document.exitPointerLock();
    } catch (e) {}
    isGameMode = false;
    fpsKeys.w = fpsKeys.s = fpsKeys.a = fpsKeys.d = false;
    if (windGain) windGain.gain.value = 0;
    document.body.classList.remove('game-mode-active');
    if (btn) { btn.classList.remove('on'); btn.innerHTML = '🚶‍♂️ 漫游'; }
    if (radar) radar.style.display = 'none';
    
    controls.enabled = true;
    flyTo(vrSavedCam.pos, vrSavedCam.target, 800);
    showToast('🕊️ 已恢复全景鸟瞰视角');
  }
}

var radarBgCanvas = null;
function drawRadarBackground() {
  if (!currentCampus || !currentCampus.b) return;
  if (!radarBgCanvas) {
    radarBgCanvas = document.createElement('canvas');
    radarBgCanvas.width = 200;
    radarBgCanvas.height = 200;
  }
  var ctx = radarBgCanvas.getContext('2d');
  ctx.clearRect(0, 0, 200, 200);
  
  var s = 200 / currentCampus.ground;
  var cx = currentCampus.center[0];
  var cz = currentCampus.center[1];
  
  ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
  currentCampus.b.forEach(function(b) {
    if (b.pts) {
      ctx.beginPath();
      b.pts.forEach(function(pt, i) {
        var x = 100 + (pt[0] - cx) * s;
        var y = 100 + (pt[1] - cz) * s;
        if (i===0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.fill();
    }
  });
}

/* ---------------- 校园环境自然声场系统 (Procedural Soundscape) ---------------- */
var ambientGain = null;
var birdTimer = null;

function startAmbientSoundscape() {
  if (!audioCtx || !soundEnabled) return;
  if (!ambientGain) {
    ambientGain = audioCtx.createGain();
    ambientGain.gain.setValueAtTime(0.04, audioCtx.currentTime);
    ambientGain.connect(audioCtx.destination);
  }
  
  if (!birdTimer) {
    (function loopBird() {
      var delay = 8000 + Math.random() * 9000;
      birdTimer = setTimeout(function () {
        if (soundEnabled && timeMode === 'day' && weatherMode !== 'snow' && audioCtx && audioCtx.state === 'running' && !document.hidden) {
          playBirdChirp();
        }
        loopBird();
      }, delay);
    })();
  }
}

function playBirdChirp() {
  if (!audioCtx || !soundEnabled || audioCtx.state !== 'running') return;
  try {
    var t = audioCtx.currentTime;
    var osc = audioCtx.createOscillator();
    var g = audioCtx.createGain();
    osc.type = 'sine';
    
    var baseFreq = 2400 + Math.random() * 500;
    osc.frequency.setValueAtTime(baseFreq, t);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.35, t + 0.08);
    osc.frequency.setValueAtTime(baseFreq * 1.15, t + 0.12);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.5, t + 0.22);
    
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.035, t + 0.04);
    if (g.gain.exponentialRampToValueAtTime) {
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    } else {
      g.gain.linearRampToValueAtTime(0.001, t + 0.25);
    }
    
    osc.connect(g);
    g.connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + 0.26);
  } catch (e) {}
}

/* ---------------- 移动端虚拟摇杆与触控漫游 ---------------- */
var touchJoystickState = { active: false, startX: 0, startY: 0, touchId: null };
var touchLookState = { active: false, lastX: 0, lastY: 0, touchId: null };

function initMobileJoystick() {
  var joyZone = $('joyZone');
  var joyThumb = $('joyThumb');
  var btnJump = $('btnJoyJump');
  var btnShift = $('btnJoyShift');
  var btnExit = $('btnJoyExit');
  
  if (btnJump) {
    btnJump.addEventListener('touchstart', function (e) {
      e.preventDefault();
      if (canJump) { playerVelocity.y += 60; canJump = false; playJump(); }
    }, { passive: false });
  }
  if (btnShift) {
    btnShift.addEventListener('touchstart', function (e) {
      e.preventDefault();
      fpsKeys.shift = !fpsKeys.shift;
      btnShift.classList.toggle('active', fpsKeys.shift);
    }, { passive: false });
  }
  if (btnExit) {
    btnExit.addEventListener('touchstart', function (e) {
      e.preventDefault();
      if (isGameMode) toggleGameMode();
    }, { passive: false });
    btnExit.addEventListener('click', function (e) {
      if (isGameMode) toggleGameMode();
    });
  }

  if (joyZone && joyThumb) {
    joyZone.addEventListener('touchstart', function (e) {
      e.preventDefault();
      var t = e.changedTouches[0];
      touchJoystickState.active = true;
      touchJoystickState.touchId = t.identifier;
      var rect = joyZone.getBoundingClientRect();
      touchJoystickState.startX = rect.left + rect.width / 2;
      touchJoystickState.startY = rect.top + rect.height / 2;
      updateJoystick(t.clientX, t.clientY);
    }, { passive: false });

    window.addEventListener('touchmove', function (e) {
      if (!isGameMode) return;
      for (var i = 0; i < e.changedTouches.length; i++) {
        var t = e.changedTouches[i];
        if (touchJoystickState.active && t.identifier === touchJoystickState.touchId) {
          updateJoystick(t.clientX, t.clientY);
        } else if (touchLookState.active && t.identifier === touchLookState.touchId) {
          var dx = t.clientX - touchLookState.lastX;
          var dy = t.clientY - touchLookState.lastY;
          touchLookState.lastX = t.clientX;
          touchLookState.lastY = t.clientY;
          var lookSens = 0.0035;
          playerEuler.y -= dx * lookSens;
          playerEuler.x -= dy * lookSens;
          playerEuler.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, playerEuler.x));
          camera.quaternion.setFromEuler(playerEuler);
        }
      }
    }, { passive: true });

    var endJoy = function (e) {
      for (var i = 0; i < e.changedTouches.length; i++) {
        var t = e.changedTouches[i];
        if (touchJoystickState.active && t.identifier === touchJoystickState.touchId) {
          touchJoystickState.active = false;
          touchJoystickState.touchId = null;
          joyThumb.style.transform = 'translate(0px, 0px)';
          fpsKeys.w = fpsKeys.s = fpsKeys.a = fpsKeys.d = false;
        } else if (touchLookState.active && t.identifier === touchLookState.touchId) {
          touchLookState.active = false;
          touchLookState.touchId = null;
        }
      }
    };
    window.addEventListener('touchend', endJoy, { passive: true });
    window.addEventListener('touchcancel', endJoy, { passive: true });

    function updateJoystick(cx, cy) {
      var dx = cx - touchJoystickState.startX;
      var dy = cy - touchJoystickState.startY;
      var maxR = 40;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > maxR) {
        dx = (dx / dist) * maxR;
        dy = (dy / dist) * maxR;
      }
      joyThumb.style.transform = 'translate(' + dx + 'px, ' + dy + 'px)';
      
      var threshold = 8;
      fpsKeys.w = dy < -threshold;
      fpsKeys.s = dy > threshold;
      fpsKeys.a = dx < -threshold;
      fpsKeys.d = dx > threshold;
    }
  }

  // 屏幕右侧支持触控旋转视角
  renderer.domElement.addEventListener('touchstart', function (e) {
    if (!isGameMode) return;
    for (var i = 0; i < e.changedTouches.length; i++) {
      var t = e.changedTouches[i];
      if (t.clientX > window.innerWidth * 0.35 && !touchLookState.active) {
        touchLookState.active = true;
        touchLookState.touchId = t.identifier;
        touchLookState.lastX = t.clientX;
        touchLookState.lastY = t.clientY;
      }
    }
  }, { passive: true });
}

// 后台标签节能优化
document.addEventListener('visibilitychange', function () {
  if (document.hidden) {
    if (audioCtx && audioCtx.state === 'running') audioCtx.suspend();
  } else {
    if (soundEnabled && audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  }
});

function initUI() {
  UI.blist = $('blist');
  UI.search = $('bsearch');
  UI.infoCard = $('infoCard');
  UI.infoName = $('icName');
  UI.infoCampus = $('icCampus');
  UI.infoCat = $('icCat');
  UI.infoStats = $('icStats');
  UI.infoDesc = $('icDesc');
  UI.campusIntro = $('campusIntro');
  UI.sidebar = $('sidebar');

  var tabs = document.querySelectorAll('.campus-tabs button');
  for (var i = 0; i < tabs.length; i++) {
    (function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.getAttribute('data-key');
        if (key === currentKey) return;
        switchCampus(key);
      });
    })(tabs[i]);
  }

  var chips = document.querySelectorAll('#catFilter .c-chip');
  chips.forEach(function (chip) {
    chip.addEventListener('click', function () {
      playSound('btn');
      filterCategory(chip.getAttribute('data-cat'));
    });
  });

  UI.search.addEventListener('input', function () { buildList(currentCampus); });
  var sClear = $('searchClear');
  if (sClear) {
    sClear.addEventListener('click', function () {
      UI.search.value = '';
      buildList(currentCampus);
      UI.search.focus();
    });
  }

  var hotChips = document.querySelectorAll('#hotChips .h-chip');
  hotChips.forEach(function (chip) {
    chip.addEventListener('click', function () {
      playSound('btn');
      var name = chip.getAttribute('data-name');
      var match = null;
      if (currentCampus && currentCampus.buildings) {
        match = currentCampus.buildings.find(function (b) { return b.name.indexOf(name) >= 0; });
      }
      if (!match && currentCampus && currentCampus.gates) {
        match = currentCampus.gates.find(function (g) { return g.name.indexOf(name) >= 0; });
      }
      if (match) {
        selectBuilding(findBuilding(match.id), true);
        if (window.innerWidth <= 768) {
          UI.sidebar.classList.add('hidden');
          var sbBtn = $('btnSidebar');
          if (sbBtn) sbBtn.classList.remove('on');
        }
      } else {
        if (UI.search) {
          UI.search.value = name;
          buildList(currentCampus);
        }
      }
    });
  });

  $('icClose').addEventListener('click', function () { playSound('btn'); deselect(); });
  $('icFly').addEventListener('click', function () {
    playSound('btn');
    if (selected) flyToBuilding(selected.data);
  });
  var icShare = $('icShare');
  if (icShare) {
    icShare.addEventListener('click', function () {
      if (selected) copyShareLink(selected.bid);
    });
  }
  var icNav = $('icNav');
  if (icNav) {
    icNav.addEventListener('click', function () {
      playSound('btn');
      if (selected) navigateToBuilding(selected.data);
    });
  }

  $('btnTour').addEventListener('click', function () {
    playSound('btn');
    tour.on ? stopTour() : startTour();
  });

  var btnCampus = $('btnCampus');
  if (btnCampus) {
    btnCampus.addEventListener('click', function () {
      playSound('switch');
      switchCampus(currentKey === 'beiHu' ? 'nanHu' : 'beiHu');
    });
  }

  var topTimeBtn = $('btnTime');
  if (topTimeBtn) {
    topTimeBtn.addEventListener('click', function () {
      playSound('btn');
      if (timeMode === 'day') applyTimeMode('sunset');
      else if (timeMode === 'sunset') applyTimeMode('night');
      else applyTimeMode('day');
      updateURLParams();
    });
  }

  var timeBtn = $('btnTimeMode');
  if (timeBtn) {
    timeBtn.addEventListener('click', function () {
      playSound('btn');
      if (timeMode === 'day') applyTimeMode('sunset');
      else if (timeMode === 'sunset') applyTimeMode('night');
      else applyTimeMode('day');
      updateURLParams();
    });
  }

  var wBtn = $('btnWeather');
  if (wBtn) wBtn.addEventListener('click', toggleWeather);
  var wDock = $('btnWeatherDock');
  if (wDock) wDock.addEventListener('click', toggleWeather);

  var sndBtn = $('btnSound');
  if (sndBtn) sndBtn.addEventListener('click', toggleSound);

  var btnVR = $('btnVR');
  if (btnVR) btnVR.addEventListener('click', toggleGameMode);

  var btnSat = $('btnSat');
  if (btnSat) btnSat.addEventListener('click', toggleSatellite);

  var fsBtn = $('btnFullscreen');
  if (fsBtn) fsBtn.addEventListener('click', toggleFullscreen);

  var helpBtn = $('btnHelp');
  if (helpBtn) helpBtn.addEventListener('click', function () { toggleHelp(true); });
  var helpClose = $('helpClose');
  if (helpClose) helpClose.addEventListener('click', function () { toggleHelp(false); });
  var helpOk = $('helpOk');
  if (helpOk) helpOk.addEventListener('click', function () { toggleHelp(false); });
  var helpModal = $('helpModal');
  if (helpModal) {
    helpModal.addEventListener('click', function (e) {
      if (e.target === helpModal) toggleHelp(false);
    });
  }

  var routeBtn = $('btnRoute');
  if (routeBtn) {
    routeBtn.addEventListener('click', function () {
      playSound('btn');
      showGuideRoute = !showGuideRoute;
      if (routeGroup) routeGroup.visible = showGuideRoute;
      routeBtn.classList.toggle('on', showGuideRoute);
      showToast(showGuideRoute ? '🚶 示意导览线已开启（非导航）' : '🚶 示意导览线已关闭');
    });
  }

  $('btnRotate').addEventListener('click', function () {
    playSound('btn');
    controls.autoRotate = !controls.autoRotate;
    controls.autoRotateSpeed = 0.7;
    this.classList.toggle('on', controls.autoRotate);
  });

  $('btnSnap').addEventListener('click', function () {
    playSound('btn');
    takeScreenshot();
  });

  var shareAllBtn = $('btnShareAll');
  if (shareAllBtn) {
    shareAllBtn.addEventListener('click', function () {
      copyShareLink();
    });
  }

  $('btnReset').addEventListener('click', function () {
    playSound('btn');
    stopTour();
    var cam = currentCampus.camera;
    startFly(new THREE.Vector3(cam.pos[0], cam.pos[1], cam.pos[2]),
             new THREE.Vector3(cam.target[0], cam.target[1], cam.target[2]));
  });

  $('btnSidebar').addEventListener('click', function () {
    playSound('btn');
    UI.sidebar.classList.toggle('hidden');
    this.classList.toggle('on', !UI.sidebar.classList.contains('hidden'));
  });

  var sheetGrab = $('sheetGrab');
  if (sheetGrab) {
    sheetGrab.addEventListener('click', function () {
      UI.sidebar.classList.add('hidden');
      var sbBtn = $('btnSidebar');
      if (sbBtn) sbBtn.classList.remove('on');
    });
  }
  var closeSidebar = $('btnCloseSidebar');
  if (closeSidebar) {
    closeSidebar.addEventListener('click', function () {
      UI.sidebar.classList.add('hidden');
      var sbBtn = $('btnSidebar');
      if (sbBtn) sbBtn.classList.remove('on');
    });
  }

  var comp = $('compass');
  if (comp) comp.addEventListener('click', resetCompassNorth);

  setTimeout(function () { $('hint').classList.add('fade'); }, 9000);

  var downXY = null;
  var isMultiTouch = false;
  renderer.domElement.addEventListener('touchstart', function (e) {
    if (e.touches.length > 1) isMultiTouch = true;
  }, { passive: true });
  renderer.domElement.addEventListener('touchend', function (e) {
    if (e.touches.length === 0) {
      setTimeout(function () { isMultiTouch = false; }, 140);
    }
  }, { passive: true });

  renderer.domElement.addEventListener('pointerdown', function (e) {
    downXY = [e.clientX, e.clientY];
    if (tour.on && e.button === 0) stopTour();
  });
  renderer.domElement.addEventListener('pointerup', function (e) {
    if (!downXY || isMultiTouch) return;
    var moved = Math.abs(e.clientX - downXY[0]) + Math.abs(e.clientY - downXY[1]);
    downXY = null;
    if (moved > 6) return;
    var hit = pickAt(e.clientX, e.clientY);
    if (hit) selectBuilding(hit, false);
    else deselect();
  });

  var hoverTimer = 0;
  renderer.domElement.addEventListener('pointermove', function (e) {
    if (e.buttons || isGameMode) { hideHoverTip(); return; }
    var now = performance.now();
    if (now - hoverTimer < 60) return;
    hoverTimer = now;
    var hit = pickAt(e.clientX, e.clientY);
    renderer.domElement.style.cursor = hit ? 'pointer' : '';
    if (hit && hit.data && hit.data.name) {
      showHoverTip(e.clientX, e.clientY, hit.data.name);
    } else {
      hideHoverTip();
    }
  });
  renderer.domElement.addEventListener('pointerleave', hideHoverTip);

  // 双击建筑直接镜头聚焦
  renderer.domElement.addEventListener('dblclick', function (e) {
    if (isGameMode) return;
    var hit = pickAt(e.clientX, e.clientY);
    if (hit) selectBuilding(hit, true);
  });

  // 全局键盘快捷键
  window.addEventListener('keydown', function (e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    var k = e.key.toLowerCase();
    
    // 快捷键 / 快速打开侧栏并聚焦搜索框
    if (k === '/' || ((e.ctrlKey || e.metaKey) && k === 'f')) {
      e.preventDefault();
      if (UI.sidebar && UI.sidebar.classList.contains('hidden')) {
        UI.sidebar.classList.remove('hidden');
        var sbBtn = $('btnSidebar');
        if (sbBtn) sbBtn.classList.add('on');
      }
      if (UI.search) {
        UI.search.focus();
        UI.search.select();
      }
      return;
    }
    
    // 如果在游戏模式中，屏蔽部分冲突的快捷键 (W, S, A, D, Space)
    if (isGameMode && (k === 'w' || k === 'a' || k === 's' || k === 'd' || k === ' ')) {
      return;
    }
    if (k === '1') { switchCampus('beiHu'); }
    else if (k === '2') { switchCampus('nanHu'); }
    else if (k === 'v') { toggleGameMode(); }
    else if (k === 'p') { togglePerfHud(); }
    else if (k === 'm') { toggleSatellite(); }
    else if (k === 'w') { toggleWeather(); }
    else if (k === 'f') { toggleFullscreen(); }
    else if (k === 'n') { resetCompassNorth(); }
    else if (k === 's') { takeScreenshot(); }
    else if (k === 'l') {
      var rBtn = $('btnRoute');
      if (rBtn) rBtn.click();
    }
    else if (k === ' ' || k === 't') {
      e.preventDefault();
      var tmBtn = $('btnTimeMode');
      if (tmBtn) tmBtn.click();
    }
    else if (k === 'escape') {
      deselect();
      toggleHelp(false);
      UI.sidebar.classList.add('hidden');
      var sbBtn = $('btnSidebar');
      if (sbBtn) sbBtn.classList.remove('on');
    }
    else if (k === '?' || k === 'h') {
      toggleHelp();
    }
  });

  initMobileJoystick();
}

/* ============================================================
 * 主循环
 * ============================================================ */
var clock = new THREE.Clock();

function toggleSatellite() {
  playSound('btn');
  isSatellite = !isSatellite;
  var btnSat = document.getElementById('btnSat');
  if (btnSat) {
    btnSat.classList.toggle('active', isSatellite);
    btnSat.classList.toggle('on', isSatellite);
    btnSat.textContent = isSatellite ? '🗺️ 矢量' : '🛰️ 卫星';
  }
  
  if (groundMesh) groundMesh.visible = !isSatellite;
  if (cloudGroup) cloudGroup.visible = !isSatellite;
  if (riverMesh) riverMesh.visible = !isSatellite;

  if (campusGroup) {
    campusGroup.children.forEach(function (c) {
      if ((c.name === 'ground_patch' || c.name === 'ground')) c.visible = !isSatellite;
      if (c.name === 'road') c.visible = !isSatellite;
      if (c.name === 'prop' && c.isGroundProp) c.visible = !isSatellite;
      if (c.name === 'boundaryLines') c.visible = !isSatellite;
      if (c.isInstancedMesh) c.visible = !isSatellite; // Hide trees and lamps
    });
  }

  if (isSatellite) {
    setupSatelliteMap();
    showToast('🛰️ 已开启高德实时卫星遥感影像与路网注记');
  } else {
    if (satGroup) {
      if (scene) scene.remove(satGroup);
      satGroup.children.forEach(function (c) {
        if (c.material && c.material.map) c.material.map.dispose();
        if (c.material) c.material.dispose();
        if (c.geometry) c.geometry.dispose();
      });
      satGroup = null;
    }
    showToast('🗺️ 已切换回标准三维矢量地图');
  }
  updateBloom();
  filterCategory(activeCategory);
}

function setupSatelliteMap() {
  if (satGroup) {
    if (scene) scene.remove(satGroup);
    satGroup.children.forEach(function(c) {
      if (c.material && c.material.map) c.material.map.dispose();
      if (c.material) c.material.dispose();
      if (c.geometry) c.geometry.dispose();
    });
  }
  satGroup = new THREE.Group();
  satGroup.name = 'satGroup';
  
  var cd = CAMPUSES[currentKey];
  if (!cd || !cd.sat) return;
  
  var z = cd.sat.z;
  var cx = cd.sat.cx;
  var cy = cd.sat.cy;
  var scale = cd.sat.scale;
  var ox = cd.sat.ox;
  var oz = cd.sat.oz;
  var num = 3;
  var grid = num * 2 + 1;          // 7 × 7 瓦片
  var TILE = 256;                  // 高德瓦片像素尺寸
  var atlasSize = grid * TILE;     // 1792 —— 两张图集取代原先 98 张独立纹理

  var exactScale = (40075016.68 / 65536) * Math.cos(43.93 * Math.PI / 180);
  if (currentKey === 'nanHu') exactScale = (40075016.68 / 131072) * Math.cos(43.83 * Math.PI / 180); // z=17

  /* ---- 图集画布：瓦片加载后逐块绘入，避免 98 次纹理上传与 98 次 draw call ---- */
  function makeAtlas(fill) {
    var c = document.createElement('canvas');
    c.width = c.height = atlasSize;
    var g = c.getContext('2d');
    if (fill) { g.fillStyle = fill; g.fillRect(0, 0, atlasSize, atlasSize); }
    return c;
  }
  var satCanvas = makeAtlas('#2a382c');
  var labCanvas = makeAtlas(null);
  var satCtx = satCanvas.getContext('2d');
  var labCtx = labCanvas.getContext('2d');

  function makeAtlasTexture(canvas) {
    var t = canvasTex(canvas);
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.minFilter = THREE.LinearFilter;   // 图集尺寸非 2 的幂，关闭 mipmap 省一次金字塔生成
    t.generateMipmaps = false;
    if (renderer && renderer.capabilities) t.anisotropy = maxAniso();
    if (THREE.sRGBEncoding) t.encoding = THREE.sRGBEncoding;
    else if (THREE.SRGBColorSpace) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  var satTex = makeAtlasTexture(satCanvas);
  var labTex = makeAtlasTexture(labCanvas);

  /* ---- 合并上传节流：多张瓦片到达只触发一次纹理上传 ---- */
  var uploadScheduled = false;
  function markAtlasDirty() {
    if (uploadScheduled) return;
    uploadScheduled = true;
    setTimeout(function () {
      uploadScheduled = false;
      satTex.needsUpdate = true;
      labTex.needsUpdate = true;
    }, 150);
  }

  /* ---- 把 grid×grid 个瓦片网格按图集 UV 合并为单个 Mesh ---- */
  function buildAtlasLayer(y, material, name, receiveShadow) {
    var list = [];
    for (var i = -num; i <= num; i++) {
      for (var j = -num; j <= num; j++) {
        var geo = new THREE.PlaneGeometry(exactScale, exactScale);
        geo.rotateX(-Math.PI / 2);
        var gi = i + num, gj = j + num;
        var u0 = gi / grid, u1 = (gi + 1) / grid;
        var v0 = 1 - (gj + 1) / grid, v1 = 1 - gj / grid;
        var uv = geo.attributes.uv;
        for (var k = 0; k < uv.count; k++) {
          uv.setXY(k, u0 + uv.getX(k) * (u1 - u0), v0 + uv.getY(k) * (v1 - v0));
        }
        var m = new THREE.Mesh(geo, material);
        m.position.set(i * exactScale + ox, y, j * exactScale + oz);
        if (receiveShadow) m.receiveShadow = true;
        m.renderOrder = (name === 'satLabel') ? 999 : 0;
        satGroup.add(m);
        list.push(m);
      }
    }
    var merged = mergeMeshList(satGroup, list, material, name);
    if (merged && name === 'satLabel') merged.renderOrder = 999;
    return merged;
  }

  // 1. 卫星影像地表瓦片
  var satMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.95,
    metalness: 0.05,
    map: satTex,
    transparent: true,
    opacity: 0,
    depthWrite: false // 淡入完成前避免 Z-fighting
  });
  buildAtlasLayer(0.04, satMat, 'satImage', true);

  // 2. 高德实时路网与 POI 注记透明图层 (style=8)
  var labelMat = new THREE.MeshBasicMaterial({
    map: labTex,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: false // 注记始终压在建筑之上，保证可读
  });
  buildAtlasLayer(0.056, labelMat, 'satLabel', false);

  /* ---- 逐块拉取瓦片并绘入图集 ---- */
  var fadeStarted = false;
  function startFade() {
    if (fadeStarted) return;
    fadeStarted = true;
    var start = Date.now();
    function fade() {
      var t = (Date.now() - start) / 400;
      if (t >= 1) {
        satMat.opacity = 1;
        satMat.transparent = false;
        satMat.depthWrite = true;
        satMat.needsUpdate = true;
        labelMat.opacity = 0.95;
      } else {
        satMat.opacity = t;
        labelMat.opacity = t * 0.95;
        requestAnimationFrame(fade);
      }
    }
    fade();
  }

  for (var i2 = -num; i2 <= num; i2++) {
    for (var j2 = -num; j2 <= num; j2++) {
      (function (i, j) {
        var tx = cx + i;
        var ty = cy + j;
        var sub = 'webst0' + (1 + (Math.abs(tx + ty) % 4));
        var gi = i + num, gj = j + num;

        function load(url, ctx) {
          var img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = function () {
            try { ctx.drawImage(img, gi * TILE, gj * TILE, TILE, TILE); } catch (e) { /* 跨域失败时保留底色 */ }
            markAtlasDirty();
            startFade();
          };
          img.onerror = function () { markAtlasDirty(); startFade(); };
          img.src = url;
        }
        load('https://' + sub + '.is.autonavi.com/appmaptile?style=6&x=' + tx + '&y=' + ty + '&z=' + z, satCtx);
        load('https://' + sub + '.is.autonavi.com/appmaptile?style=8&x=' + tx + '&y=' + ty + '&z=' + z, labCtx);
      })(i2, j2);
    }
  }

  // 兜底：瓦片全部失败时也要淡入底色，避免出现永久透明空洞
  setTimeout(startFade, 2500);
  if (scene) scene.add(satGroup);
  satGroup.visible = true;
}

var animFrameId = null;
var isPageHidden = false;

/* 页面隐藏时主动取消 rAF（省电），切回时重置时钟续播 */
document.addEventListener('visibilitychange', function () {
  if (document.hidden) {
    isPageHidden = true;
    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
  } else {
    isPageHidden = false;
    clock.getDelta(); // 重置时间差，防止后台切回后出现大幅度位移瞬移
    if (!animFrameId) {
      animFrameId = requestAnimationFrame(animate);
    }
  }
});

function animate() {
  if (isPageHidden) return;
  // 入队前取消挂起帧：看门狗补帧期间可能积压多个 rAF 回调，
  // 不取消的话恢复后会残留多条并行动画链，每帧重复渲染
  if (animFrameId) cancelAnimationFrame(animFrameId);
  animFrameId = requestAnimationFrame(animate);
  window.__rafOk = true;
  var dt = Math.min(clock.getDelta(), 0.1);
  var now = performance.now();
  window.__lastFrameTs = now; // rAF 看门狗据此判断渲染循环是否停摆

  if (fly) {
    var k = clamp((now - fly.start) / fly.dur, 0, 1);
    var e = easeInOut(k);
    camera.position.lerpVectors(fly.p0, fly.p1, e);
    // 增加抛物线高度提升 (Arc Height)，大跨度飞行时抬升相机防止穿模建筑物
    var flightDist = fly.p0.distanceTo(fly.p1);
    if (flightDist > 80) {
      var arcH = Math.min(130, flightDist * 0.16) * Math.sin(k * Math.PI);
      camera.position.y += arcH;
    }
    controls.target.lerpVectors(fly.l0, fly.l1, e);
    camera.lookAt(controls.target);
    if (k >= 1) { fly = null; controls.enabled = !isGameMode; if(!isGameMode) controls.update(); }
  } else if (tour.on) {
    updateTour(dt);
  } else if (isGameMode) {
    var speed = fpsKeys.shift ? 36 : 14;
    playerDirection.set(0, 0, 0);
    if (fpsKeys.w) playerDirection.z = -1;
    if (fpsKeys.s) playerDirection.z = 1;
    if (fpsKeys.a) playerDirection.x = -1;
    if (fpsKeys.d) playerDirection.x = 1;
    
    var nearby = getNearbyPickables(camera.position.x, camera.position.z, 60);

    if (playerDirection.lengthSq() > 0.1) {
      playerDirection.normalize();
      _fpsCamEulerY.set(0, camera.rotation.y, 0, 'YXZ');
      playerDirection.applyEuler(_fpsCamEulerY);
      
      var stepX = playerDirection.x * speed * dt;
      var stepZ = playerDirection.z * speed * dt;
      _fpsMoveVec.set(stepX, 0, stepZ);
      var moveLen = _fpsMoveVec.length();
      
      // 水平碰撞检测 (Wall Collision - 仅针对附近建筑)
      if (nearby.length > 0) {
        _fpsMoveVec.normalize();
        raycaster.set(camera.position, _fpsMoveVec);
        var fwdHits = raycaster.intersectObjects(nearby, true);
        if (fwdHits.length > 0 && fwdHits[0].distance < moveLen + 1.2) {
          stepX = 0; stepZ = 0; // 撞墙停止
        }
      }
      if (stepX !== 0 || stepZ !== 0) {
        if (canJump) { // 只有在地面且没有撞墙时产生脚步声
          var footstepInterval = fpsKeys.shift ? 300 : 450;
          if (!window._lastFootstep || now - window._lastFootstep > footstepInterval) {
            playFootstep(speed);
            window._lastFootstep = now;
          }
        }
        camera.position.x += stepX;
        camera.position.z += stepZ;
      }
    }
    
    // Wind sound (speed based)
    if (windGain) {
      var targetWind = fpsKeys.shift ? 0.4 : (playerDirection.lengthSq() > 0.1 ? 0.1 : 0);
      if (playerVelocity.y < -30) targetWind = 0.6; // Falling fast
      windGain.gain.value += (targetWind - windGain.gain.value) * dt * 2.0;
    }
    
    // 垂直碰撞与重力 (Gravity & Roof Walking - 局部邻近检测)
    var floorY = 0;
    if (nearby.length > 0) {
      _fpsDownRayPos.set(camera.position.x, Math.max(camera.position.y + 8, 80), camera.position.z);
      raycaster.set(_fpsDownRayPos, _fpsDownRayDir);
      var downHits = raycaster.intersectObjects(nearby, true);
      if (downHits.length > 0) {
        floorY = downHits[0].point.y;
      }
    }
    
    var targetCamY = floorY + 2.2;
    var prevY = camera.position.y;
    playerVelocity.y -= 160 * dt; // Gravity
    camera.position.y += playerVelocity.y * dt;
    
    if (camera.position.y <= targetCamY) {
      if (prevY > targetCamY + 0.1 && playerVelocity.y < -20) {
        playLand(playerVelocity.y); // Play landing sound
      }
      camera.position.y = targetCamY;
      playerVelocity.y = 0;
      canJump = true;
    }
    
    // 更新雷达小地图 (位移或朝向变化时按需重绘，避免无谓 Canvas 消耗)
    if (radarBgCanvas && currentCampus) {
      if (!radarEl) radarEl = $('radarMap');
      if (radarEl && radarEl.style.display !== 'none') {
        _fpsMoveVec.set(0, 0, -1).applyQuaternion(camera.quaternion);
        var curAngle = Math.atan2(_fpsMoveVec.z, _fpsMoveVec.x);
        if (!radarEl._lastX || Math.abs(camera.position.x - radarEl._lastX) > 0.2 ||
            Math.abs(camera.position.z - radarEl._lastZ) > 0.2 ||
            Math.abs(curAngle - radarEl._lastAngle) > 0.04) {
          radarEl._lastX = camera.position.x;
          radarEl._lastZ = camera.position.z;
          radarEl._lastAngle = curAngle;
          
          var ctx = radarEl.getContext('2d');
          ctx.clearRect(0, 0, 200, 200);
          ctx.drawImage(radarBgCanvas, 0, 0);
          
          var s = 200 / currentCampus.ground;
          var px = 100 + (camera.position.x - currentCampus.center[0]) * s;
          var pz = 100 + (camera.position.z - currentCampus.center[1]) * s;
          
          // 视锥角度扇形
          ctx.beginPath();
          ctx.moveTo(px, pz);
          ctx.arc(px, pz, 30, curAngle - 0.4, curAngle + 0.4);
          ctx.closePath();
          ctx.fillStyle = 'rgba(0, 255, 255, 0.45)';
          ctx.fill();
          
          // 角色光标点
          ctx.beginPath();
          ctx.arc(px, pz, 4, 0, Math.PI * 2);
          ctx.fillStyle = '#ff3366';
          ctx.fill();
        }
      }
    }
    
  } else {
    controls.update();
  }

  if (riverTex && riverTex.userData.shader) {
    riverTex.userData.shader.uniforms.time.value = now * 0.001;
  }

  if (selRing.visible) {
    var pulse = 0.62 + 0.38 * Math.abs(Math.sin(now * 0.0035));
    selRing.material.opacity = pulse;
  }

  // 浮空光锥信标：平稳周期悬浮，绝不高度漂移
  if (selBeacon && selBeacon.visible) {
    selBeacon.rotation.y += dt * 1.5;
    var baseY = selBeacon.userData.baseY || 20;
    selBeacon.position.y = baseY + Math.sin(now * 0.004) * 1.6;
  }

  // 北国冬雪落雪微风扰动与平滑循环
  if (snowPoints && weatherMode === 'snow') {
    var posArr = snowPoints.geometry.attributes.position.array;
    var windX = Math.sin(now * 0.0009) * 8 * dt;
    var windZ = Math.cos(now * 0.0007) * 5 * dt;
    for (var si = 0; si < posArr.length; si += 3) {
      posArr[si] += windX;
      posArr[si + 1] -= dt * 45;
      posArr[si + 2] += windZ;
      if (posArr[si + 1] < 0) {
        posArr[si + 1] = 300 + Math.random() * 40;
        posArr[si] = rand(-900, 900);
        posArr[si + 2] = rand(-900, 900);
      }
    }
    snowPoints.geometry.attributes.position.needsUpdate = true;
  }

  if (labelGroup && labelGroup.userData.atlas) {
    updateLabelAtlas(labelGroup.userData.atlas);
  } else if (labelGroup) {
    if (!window._lastLabelCam) window._lastLabelCam = new THREE.Vector3();
    if (!window._lastLabelTarget) window._lastLabelTarget = new THREE.Vector3();
    var camMoved = camera.position.distanceToSquared(window._lastLabelCam) > 0.16 ||
                   controls.target.distanceToSquared(window._lastLabelTarget) > 0.16;
    if (camMoved) {
      window._lastLabelCam.copy(camera.position);
      window._lastLabelTarget.copy(controls.target);
      var camDist = camera.position.distanceTo(controls.target);
      for (var li2 = 0; li2 < labelGroup.children.length; li2++) {
        var sp = labelGroup.children[li2];
        var dist = camera.position.distanceTo(sp.position);
        var fs = clamp(dist / 520, 0.32, 1.0);
        sp.scale.set(sp.userData.baseW * fs, sp.userData.baseH * fs, 1);

        if (activeCategory === 'all') {
          if (sp.userData.priority === 2) {
            sp.visible = camDist < 780;
          } else {
            sp.visible = true;
          }
        }
      }
    }
  }

  if (cloudGroup && currentCampus) {
    var bound = currentCampus.ground * 0.55;
    for (var ci = 0; ci < cloudGroup.children.length; ci++) {
      var cld = cloudGroup.children[ci];
      cld.position.x += dt * (cld.userData.speed || 3);
      if (cld.position.x > bound) cld.position.x = -bound;
    }
  }

  if ((showGuideRoute || activeNavRoute) && routeTex) {
    routeTex.offset.x = (routeTex.offset.x - dt * 1.0) % 1;
  }

  if (isNight && stars) {
    stars.material.size = 2.4 + 0.5 * Math.sin(now * 0.003);
  }

  var ang = Math.atan2(camera.position.x - controls.target.x, camera.position.z - controls.target.z);
  if (!needleEl) needleEl = document.getElementById('needle');
  if (needleEl && (!needleEl._lastAng || Math.abs(ang - needleEl._lastAng) > 0.003)) {
    needleEl._lastAng = ang;
    needleEl.setAttribute('transform', 'rotate(' + (-ang * 180 / Math.PI) + ' 31 31)');
  }

  // 智能渲染管线：无发光效果时直连 WebGL 渲染，大幅节约 GPU 离屏通道与带宽开销
  var useComposer = composer && (isNight || isSatellite || timeMode === 'sunset');
  if (useComposer) {
    composer.render();
  } else {
    renderer.render(scene, camera);
  }

  // 性能面板（P 键开关）
  if (perfHudOn && perfHud) {
    _fpsFrames++;
    if (now - _fpsLast >= 500) {
      var fps = Math.round(_fpsFrames * 1000 / (now - _fpsLast));
      _fpsFrames = 0; _fpsLast = now;
      var inf = renderer.info;
      perfHud.textContent =
        'FPS ' + fps +
        '\nDrawCalls ' + inf.render.calls +
        '\nTriangles ' + (inf.render.triangles / 1000).toFixed(1) + 'k' +
        '\nGeometries ' + inf.memory.geometries +
        '\nTextures ' + inf.memory.textures;
    }
  }
}

/* ============================================================
 * 启动
 * ============================================================ */
function boot() {
  var bar = $('loadProgress') || document.querySelector('#loader .bar i');
  var tip = $('loadTip') || document.querySelector('#loader .tip');
  var pct = 0;

  var tips = [
    '正在加载三维地形与地下管网数据…',
    '正在构建 76 处建筑与场馆地标三维模型…',
    '正在对齐北湖与南湖校区模型坐标…',
    '正在初始化微气候光影与全季节渲染引擎…',
    '三维场景加载完成，欢迎来到长春工业大学！'
  ];
  var tipIdx = 0;

  var timer = setInterval(function () {
    pct = Math.min(94, pct + rand(10, 22));
    if (bar) bar.style.width = pct + '%';
    tipIdx = Math.min(tips.length - 2, Math.floor(pct / 25));
    if (tip) tip.textContent = tips[tipIdx];
  }, 120);

  // 恢复声音偏好设置
  try {
    var savedSound = localStorage.getItem('ccut_map_sound');
    if (savedSound === '0') {
      soundEnabled = false;
      var sBtn = $('btnSound');
      if (sBtn) { sBtn.innerHTML = '🔇'; sBtn.classList.add('on'); }
    }
  } catch (e) {}

  // 解析 URL 参数实现深度直达链接
  var params = null;
  var campusParam = null, bidParam = null, timeParam = null, weatherParam = null;
  try {
    params = new URLSearchParams(window.location.search);
    campusParam = params.get('campus');
    bidParam = params.get('bid');
    timeParam = params.get('time');
    weatherParam = params.get('weather');
  } catch (e) {}

  /* 先让加载页完成首帧绘制，再执行同步的三维构建，避免移动端出现长时间白屏。
   * 双 rAF 在嵌入式 WebView（应用内浏览器面板、部分后台节流场景）被遮挡时会永久停摆，
   * 导致 boot 永远无法开始——把构建主体抽成幂等的 __bootBody，rAF 正常时双跳后执行，
   * 任一跳停摆则由定时器接力，先到者执行。 */
  var __bootBodyRan = false;
  var __bootBody = function () {
    if (__bootBodyRan) return;
    __bootBodyRan = true;

  try {
    initScene();
    initUI();

    currentKey = (campusParam === 'nanHu') ? 'nanHu' : 'beiHu';
    document.querySelectorAll('.campus-tabs button').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-key') === currentKey);
    });

    if (weatherParam === 'snow' || weatherParam === 'autumn') {
      applyWeatherMode(weatherParam);
    }

    buildCampus(CAMPUSES[currentKey]);

    // 开场镜头：高空缓降入场（带直达链接/漫游参数时不抢镜头）
    if (!bidParam) {
      try {
        var camCfg = CAMPUSES[currentKey].camera;
        var endPos = new THREE.Vector3(camCfg.pos[0], camCfg.pos[1], camCfg.pos[2]);
        var endTgt = new THREE.Vector3(camCfg.target[0], camCfg.target[1], camCfg.target[2]);
        camera.position.set(endPos.x * 0.52, endPos.y + 460, endPos.z * 0.6);
        controls.target.copy(endTgt);
        camera.lookAt(endTgt);
        startFly(endPos, endTgt, 2000);
      } catch (e) { /* 入场动画失败不影响正常使用 */ }
    }

    if (timeParam && (timeParam === 'sunset' || timeParam === 'night')) {
      applyTimeMode(timeParam);
    }

    if (bidParam) {
      var target = findBuilding(bidParam);
      if (target) {
        selectBuilding(target, true);
      }
    }

    animate();
  } catch (err) {
    window.__bootErr = (err && err.stack) ? String(err.stack) : String(err);
    if (tip) tip.textContent = '初始化失败：' + err.message;
    console.error(err);
    clearInterval(timer);
    return;
  }

  // 场景构建为同步操作——用定时器收尾，不依赖 rAF（遮挡环境 rAF 会暂停）
  setTimeout(function () {
    clearInterval(timer);
    if (bar) bar.style.width = '100%';
    if (tip) tip.textContent = tips[tips.length - 1];
    setTimeout(function () {
      var loader = $('loader');
      if (loader) loader.classList.add('hide');
    }, 350);
  }, 300);

  // rAF 看门狗：内嵌 WebView（应用内浏览器面板、部分国产浏览器后台）会在遮挡/节流后
  // 停掉 rAF——即使它曾经正常运行过。这里持续检测帧停摆，页面可见且超过 1.2s 没有新帧时
  // 用定时器低频补帧（约 2fps 幻灯片模式）；rAF 恢复后条件不再满足，看门狗自动空转零开销。
  setInterval(function () {
    if (window.__bootErr) return;
    if (document.visibilityState === 'hidden') return;
    var last = window.__lastFrameTs || 0;
    if (performance.now() - last < 1200) return;
    if (window.__rafWatchdogBusy) return;
    window.__rafWatchdogBusy = true;
    try { animate(); } catch (e) { /* 单次补帧失败不影响主流程 */ }
    window.__rafWatchdogBusy = false;
  }, 500);

  }; /* 结束 __bootBody：同步三维构建主体 */

  /* 健康路径：双 rAF 后构建（此时加载页已完成首帧绘制）；
   * 任一跳 rAF 停摆则由定时器接力执行 __bootBody（幂等，先到者生效）。 */
  requestAnimationFrame(function () {
    requestAnimationFrame(__bootBody);
    setTimeout(__bootBody, 300); // 第二跳 rAF 停摆兜底
  });
  setTimeout(__bootBody, 600);   // 第一跳 rAF 停摆兜底
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

})();

