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

/* ---------------- 原生 Web Audio 交互音效 ---------------- */
var audioCtx = null;
var soundEnabled = (typeof localStorage !== 'undefined' && localStorage.getItem('ccut_sound') !== 'false');

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
  '教学主楼': ['jxzjl', 'zhujiaoxuelou', 'zjl'],
  '主教学楼': ['zjxl', 'zhujiaoxuelou', 'zjl'],
  '科技大楼': ['kjdl', 'kejidalou'],
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

/* ---------------- 新生步行测距计算（基于实测校门对齐） ---------------- */
function calcGateDistance(b, campusKey) {
  if (!b || !b.pos) return null;
  var gatePos, gateName;
  if (campusKey === 'beiHu') {
    if (b.pos[0] < -100) {
      gatePos = [-774, 254]; // 西区南门（实测坐标）
      gateName = '西区南门报到点';
    } else {
      gatePos = [54, 248]; // 东区西门（实测坐标）
      gateName = '东区西门报到点';
    }
  } else {
    gatePos = [272, -7]; // 南湖延安大街正门（实测坐标）
    gateName = '延安大街正门报到点';
  }
  var dx = b.pos[0] - gatePos[0];
  var dz = b.pos[1] - gatePos[1];
  var straight = Math.sqrt(dx * dx + dz * dz);
  var distM = Math.round(straight * 1.22);
  var walkMin = Math.max(1, Math.round(distM / 72));
  return { dist: distM, min: walkMin, gateName: gateName };
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
  var tDay = new THREE.CanvasTexture(day);
  var tNight = new THREE.CanvasTexture(night);
  var tPhys = new THREE.CanvasTexture(phys);
  tDay.wrapS = tNight.wrapS = tPhys.wrapS = THREE.RepeatWrapping;
  tDay.anisotropy = tNight.anisotropy = tPhys.anisotropy = 4;
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
  var tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(120, 120);
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
  var t = new THREE.CanvasTexture(c);
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
  var tex = new THREE.CanvasTexture(c);
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
  var tex = new THREE.CanvasTexture(c);
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
  var tex = new THREE.CanvasTexture(c);
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
  var tex = new THREE.CanvasTexture(c);
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
  var tex = new THREE.CanvasTexture(c);
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
  var t = new THREE.CanvasTexture(c);
  t._cached = true;
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
/* 真实照片贴图（官方效果图/实景图，本地 img/ 目录） */
var photoLoader = new THREE.TextureLoader();
var photoCache = {};
window.__photos = photoCache; // 调试：检查贴图加载
function photoTexture(url, onReady) {
  if (photoCache[url]) { if (photoCache[url].image) onReady(photoCache[url]); return; }
  photoCache[url] = null; // 占位，防止重复加载
  photoLoader.load(url, function (tex) {
    tex.anisotropy = 4;
    tex._cached = true;
    photoCache[url] = tex;
    onReady(tex);
  }, undefined, function () { /* 加载失败时保留程序化立面 */ });
}

function makeFacadeMaterial(b) {
  var floors = b.floors || Math.max(2, Math.round(b.h / 6.5));
  var w = b.size[0], dd = b.size[1];
  var colsLong = Math.max(3, Math.round(Math.max(w, dd) / 9));
  var colsShort = Math.max(2, Math.round(Math.min(w, dd) / 9));
  var texL = facadeTextures(b.color, floors, colsLong);
  var texS = facadeTextures(b.color, floors, colsShort);
  var roof = b.roof || (b.photo ? 0x6e6055 : shade(b.color, 0.62));
  
  var mL = new THREE.MeshPhysicalMaterial({
    map: texL.day, emissiveMap: texL.night, emissive: 0xffffff, emissiveIntensity: 0,
    roughnessMap: texL.phys, metalnessMap: texL.phys,
    roughness: 1.0, metalness: 1.0,
    transmission: 0, ior: 1.5, thickness: 5.0 // prepared for glass mode
  });
  var mS = new THREE.MeshPhysicalMaterial({
    map: texS.day, emissiveMap: texS.night, emissive: 0xffffff, emissiveIntensity: 0,
    roughnessMap: texS.phys, metalnessMap: texS.phys,
    roughness: 1.0, metalness: 1.0,
    transmission: 0, ior: 1.5, thickness: 5.0
  });
  var mR = new THREE.MeshPhysicalMaterial({ 
    roughness: 0.9, metalness: 0.1, color: roof,
    transmission: 0, ior: 1.5, thickness: 5.0
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
    boxGeo.translate(0, b.h / 2, 0); // Center Y
    
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
    mesh.position.set(b.pos[0], 0, b.pos[1]);
  } else {
    boxGeo = new THREE.BoxGeometry(b.size[0], b.h, b.size[1]);
    mesh = new THREE.Mesh(boxGeo, makeFacadeMaterial(b));
    mesh.position.set(b.pos[0] || 0, b.h / 2, b.pos[1] || 0);
    if (b.rot) mesh.rotation.y = -b.rot;
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

/* 田径场：红塑胶环道 + 草坪 + 场地球道 + 看台 */
function buildTrack(b) {
  var grp = new THREE.Group();
  var track = new THREE.Mesh(
    new THREE.RingGeometry(0.52, 1.0, 64),
    new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.1, color: 0xb55a44 })
  );
  track.rotation.x = -Math.PI / 2;
  track.scale.set(b.rx, b.rz, 1);
  track.position.y = 0.25; track.receiveShadow = true;
  grp.add(track);
  // 分道线
  var lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  for (var li = 0; li < 8; li++) {
    var a = (li / 8) * Math.PI * 2;
    var ix = Math.cos(a) * b.rx * 0.52, iz = Math.sin(a) * b.rz * 0.52;
    var ox = Math.cos(a) * b.rx * 0.97, oz = Math.sin(a) * b.rz * 0.97;
    var mx = (ix + ox) / 2, mz = (iz + oz) / 2;
    var len = Math.sqrt((ox - ix) * (ox - ix) + (oz - iz) * (oz - iz));
    var lane = new THREE.Mesh(new THREE.PlaneGeometry(0.7, len), lineMat);
    lane.rotation.x = -Math.PI / 2;
    lane.rotation.z = -Math.atan2(oz - iz, ox - ix) + Math.PI / 2;
    lane.position.set(mx, 0.3, mz);
    grp.add(lane);
  }
  var field = new THREE.Mesh(
    new THREE.CircleGeometry(0.52, 48),
    new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.1, color: 0x3f8f4f })
  );
  field.rotation.x = -Math.PI / 2;
  field.scale.set(b.rx, b.rz, 1);
  field.position.y = 0.2; field.receiveShadow = true;
  grp.add(field);
  // 场内地球场
  if (b.innerCourts) {
    for (var k = 0; k < 2; k++) {
      var ct = new THREE.Mesh(new THREE.PlaneGeometry(28, 15), new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.1, color: 0x628f62 }));
      ct.rotation.x = -Math.PI / 2;
      ct.position.set((k - 0.5) * 31, 0.32, 0);
      grp.add(ct);
      var edge = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.PlaneGeometry(28, 15)),
        new THREE.LineBasicMaterial({ color: 0xffffff })
      );
      edge.rotation.x = -Math.PI / 2;
      edge.position.set((k - 0.5) * 31, 0.34, 0);
      grp.add(edge);
    }
  }
  // 看台
  var stand = new THREE.Mesh(
    new THREE.BoxGeometry(b.rx * 1.05, 7, 12),
    new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.1, color: 0xd9d4c8 })
  );
  stand.position.set(0, 3.5, -b.rz * 0.9);
  stand.castShadow = stand.receiveShadow = true;
  grp.add(stand);
  return grp;
}

/* 球场群 */
function buildCourts(b) {
  var grp = new THREE.Group();
  var cols = b.cols || Math.ceil(b.n / 2);
  var rows = Math.ceil(b.n / cols);
  var cw = b.cw || 16, cd = b.cd || 26, gap = 6;
  var courtGeo = new THREE.PlaneGeometry(cw, cd);
  var matA = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.1, color: 0x628f62 });
  var matB = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.1, color: 0xa56a4a });
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
    }
  }
  return grp;
}

/* 校门（砖红立柱 + 金字牌匾） */
function buildGate(b, campus) {
  var grp = new THREE.Group();
  var maroon = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.1, color: 0x7e2f2f });
  var pw = 6, ph = b.h;
  var p1 = new THREE.Mesh(new THREE.BoxGeometry(pw, ph, pw), maroon);
  p1.position.set(-b.w / 2, ph / 2, 0);
  var p2 = p1.clone(); p2.position.x = b.w / 2;
  p1.castShadow = p2.castShadow = true;
  grp.add(p1, p2);
  // 柱头
  [p1, p2].forEach(function (p) {
    var cap = new THREE.Mesh(new THREE.BoxGeometry(pw + 1.2, 1.4, pw + 1.2), new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.1, color: 0xc9a227 }));
    cap.position.set(p.position.x, ph + 0.7, 0);
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
  return grp;
}

/* ============================================================
 * 配景（props）
 * ============================================================ */
function buildProp(p, campus) {
  var grp = new THREE.Group();
  if (p.type === 'plaza') {
    var geo = p.r ? new THREE.CircleGeometry(p.r, 48) : new THREE.PlaneGeometry(p.w, p.d);
    var plaza = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.1, color: p.color || PAVE }));
    plaza.rotation.x = -Math.PI / 2;
    plaza.position.set(p.pos[0], 0.09, p.pos[1]);
    plaza.receiveShadow = true;
    grp.add(plaza);
  } else if (p.type === 'parking') {
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
    var deck = new THREE.Mesh(
      new THREE.BoxGeometry(p.len, 1.2, p.w),
      new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.1, color: 0x9aa2aa })
    );
    deck.position.set(p.pos[0], 6.2, p.pos[1]);
    deck.castShadow = true;
    grp.add(deck);
    [p.pos[0] - p.len / 2 + 6, p.pos[0] + p.len / 2 - 6].forEach(function (px) {
      var pil = new THREE.Mesh(new THREE.BoxGeometry(1.6, 6.2, 1.6), new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.1, color: 0x8a929a }));
      pil.position.set(px, 3.1, p.pos[1]);
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
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: false, side: THREE.DoubleSide })
    );
    board.position.set(p.pos[0], 8.2, p.pos[1]);
    grp.add(board);
  } else if (p.type === 'street') {
    var sc = textCanvas(p.text, { fs: 40, color: p.color || 'rgba(255,255,255,0.85)', bg: p.bg || null, br: 12 });
    var st = new THREE.CanvasTexture(sc);
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
    var stone = new THREE.Mesh(
      new THREE.BoxGeometry(11, 6, 4.5),
      new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.1, color: 0x9a9a90 })
    );
    stone.position.set(p.pos[0], 3, p.pos[1]);
    stone.rotation.y = 0.25;
    stone.castShadow = true;
    grp.add(stone);
    var sc2 = textCanvas('长春工业大学', { fs: 64, color: '#b03030' });
    var plate = new THREE.Mesh(
      new THREE.PlaneGeometry(9.4, 3.6),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc2), transparent: true })
    );
    plate.position.set(p.pos[0] - Math.sin(0.25) * 2.35, 3.4, p.pos[1] - Math.cos(0.25) * 2.35);
    plate.rotation.y = 0.25;
    grp.add(plate);
  } else if (p.type === 'flower') {
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
  var cloudGeo = new THREE.DodecahedronGeometry(1, 1);
  cloudGeo._shared = true;

  for (var c = 0; c < cloudCount; c++) {
    var cluster = new THREE.Group();
    var mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.72,
      depthWrite: false
    });
    cloudMats.push(mat);

    var subBlobs = 5 + Math.floor(Math.random() * 4);
    for (var b = 0; b < subBlobs; b++) {
      var blob = new THREE.Mesh(cloudGeo, mat);
      var sc = rand(14, 28);
      blob.scale.set(sc * rand(1.2, 1.8), sc * rand(0.5, 0.8), sc);
      blob.position.set(rand(-28, 28), rand(-4, 4), rand(-20, 20));
      cluster.add(blob);
    }
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
    }
  });
  routeGroup.visible = showGuideRoute;
  return routeGroup;
}

/* ============================================================
 * 场景初始化
 * ============================================================ */
function initScene() {
  var canvas = $('c3d');
  renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // 物理渲染优化
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  // 关闭自动更新阴影，改为按需更新以提升性能
  renderer.shadowMap.autoUpdate = false;
  
  window.pmremGenerator = new THREE.PMREMGenerator(renderer);

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
  dirLight.shadow.mapSize.set(2048, 2048);
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
      if (o.geometry && !o.geometry._shared) o.geometry.dispose();
      var mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
      mats.forEach(function (m) {
        if (m._shared) return;
        if (m.map && m.map.dispose && !m.map._cached) m.map.dispose();
        if (m.emissiveMap && m.emissiveMap.dispose && !m.emissiveMap._cached) m.emissiveMap.dispose();
        m.dispose();
      });
    });
  }
  if (routeGroup) { scene.remove(routeGroup); routeGroup = null; }
  if (cloudGroup) { scene.remove(cloudGroup); cloudGroup = null; }
  if (satGroup) {
    scene.remove(satGroup);
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
  selected = null; selRing.visible = false;
  if (selBeacon) selBeacon.visible = false;
  clearNavRoute();
  UI.infoCard.classList.remove('show');
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
  if (b.floors >= 10 || b.h >= 30) return true; // 12层科技大楼主塔等核心地标
  var name = b.name || '';
  if (/主教学楼|科技大楼|教学科研楼|电气与电子|图书馆|博厚|活动中心|食堂|田径|门|计算机/.test(name)) return true;
  return false;
}

function buildBoundaryLines(campus) {
  var grp = new THREE.Group();
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

  // 校区测绘红线边界轮廓
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
    else if (b.shape === 'multi') grp = buildMulti(b);
    else grp = buildBox(b);

    grp.position.set(b.pos[0], 0, b.pos[1]);
    if (b.rot) grp.rotation.y = b.rot;
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

  // 渲染校区真实校门与地标门厅（全部纳入 3D 实体模型与检索）
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
        desc: g.desc || (g.name + '，长春工业大学主要校门通道。')
      };
      var grp = buildGate(gb, campus);
      grp.position.set(g.pos[0], 0, g.pos[1]);
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
  scene.add(cloudGroup);

  campusGroup.add(labelGroup);
  scene.add(campusGroup);

  var cam = campus.camera;
  camera.position.set(cam.pos[0], cam.pos[1], cam.pos[2]);
  controls.target.set(cam.target[0], cam.target[1], cam.target[2]);
  controls.update();

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
        if (c.name === 'ground_patch') c.visible = false;
        if (c.isInstancedMesh) c.visible = false;
      });
    }
    if (cloudGroup) cloudGroup.visible = false;
    setupSatelliteMap();
  }
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
    var cOp = isNight ? 0.35 : (isSunset ? 0.82 : 0.72);
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
          if (isSatellite) {
            m.visible = true;
            m.transparent = true;
            m.transmission = 0.85; // game-level glass refraction
            m.opacity = 1.0;
            m.roughness = 0.15;
            m.metalness = 0.1;
            m.clearcoat = 1.0;
            m.clearcoatRoughness = 0.1;
            m.envMapIntensity = 2.5;
          } else {
            m.visible = true;
            m.transparent = !match;
            m.transmission = 0;
            m.opacity = match ? 1 : 0.22;
            m.roughness = m.map ? 1.0 : 0.9;
            m.metalness = m.map ? 1.0 : 0.1;
            m.clearcoat = 0;
            m.envMapIntensity = 1.0;
          }
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
  var hits = raycaster.intersectObjects(pickables, true);
  for (var i = 0; i < hits.length; i++) {
    var bid = hits[i].object.userData.bid;
    if (bid) return findBuilding(bid);
  }
  return null;
}

function findBuilding(bid) {
  if (!bid) return null;
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
      walkEl.innerHTML = '🚶 距【' + walkInfo.gateName + '】约 <b>' + walkInfo.dist + 'm</b> · 步行约 <b>' + walkInfo.min + '分钟</b>';
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

/* ---------------- 迎新实时步行导览路线规划 ---------------- */
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
  
  showToast('🚶 已为您规划从【' + gateName + '】至【' + b.name + '】的迎新导览路线！');
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
      if (c.name === 'ground_patch' && c.material) {
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
  box.innerHTML = '';
  var q = (UI.search.value || '').trim();
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
  var el = UI.campusIntro;
  el.innerHTML = '<b>' + campus.name + '</b>' + campus.intro;
  el.classList.remove('hide');
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
      showToast(showGuideRoute ? '🚶 导览路线已开启' : '🚶 导览路线已关闭');
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
    if (e.buttons || isGameMode) return;
    var now = performance.now();
    if (now - hoverTimer < 60) return;
    hoverTimer = now;
    var hit = pickAt(e.clientX, e.clientY);
    renderer.domElement.style.cursor = hit ? 'pointer' : '';
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
  if (campusGroup) {
    campusGroup.children.forEach(function (c) {
      if (c.name === 'ground_patch') c.visible = !isSatellite;
      if (c.isInstancedMesh) c.visible = !isSatellite; // Hide trees and lamps
    });
  }
  if (cloudGroup) cloudGroup.visible = !isSatellite;

  if (isSatellite) {
    setupSatelliteMap();
    showToast('🛰️ 已开启高德卫星遥感影像底图');
  } else {
    if (satGroup) {
      scene.remove(satGroup);
      satGroup.children.forEach(function (c) {
        if (c.material && c.material.map) c.material.map.dispose();
        if (c.material) c.material.dispose();
        if (c.geometry) c.geometry.dispose();
      });
      satGroup = null;
    }
    showToast('🗺️ 已切换回标准矢量底图');
  }
  updateBloom();
  filterCategory(activeCategory);
  filterCategory(activeCategory);
}

function setupSatelliteMap() {
  if (satGroup) {
    scene.remove(satGroup);
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
  var texLoader = new THREE.TextureLoader();
  texLoader.crossOrigin = 'anonymous';

  for (var i = -num; i <= num; i++) {
    for (var j = -num; j <= num; j++) {
      (function(i, j) {
        var tx = cx + i;
        var ty = cy + j;
        var url = 'https://webst01.is.autonavi.com/appmaptile?style=6&x=' + tx + '&y=' + ty + '&z=' + z;
        
        var geo = new THREE.PlaneGeometry(scale, scale);
        geo.rotateX(-Math.PI / 2);
        
        var mat = new THREE.MeshStandardMaterial({
          color: 0xffffff,
          roughness: 0.9,
          metalness: 0.1,
          transparent: true,
          opacity: 0 // fade in
        });
        
        var mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(i * scale + ox, 0.05, j * scale + oz);
        mesh.receiveShadow = true;
        
        texLoader.load(url, function(tex) {
          tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
          if (THREE.sRGBEncoding) tex.encoding = THREE.sRGBEncoding;
          else if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
          mat.map = tex;
          mat.needsUpdate = true;
          
          var start = Date.now();
          function fade() {
            var t = (Date.now() - start) / 500;
            if (t >= 1) { mat.opacity = 1; }
            else { mat.opacity = t; requestAnimationFrame(fade); }
          }
          fade();
        }, undefined, function(err) {
          mat.color.setHex(0x334433);
          mat.opacity = 1;
        });
        
        satGroup.add(mesh);
      })(i, j);
    }
  }
  scene.add(satGroup);
  satGroup.visible = true;
}

function animate() {
  requestAnimationFrame(animate);
  window.__rafOk = true;
  var dt = Math.min(clock.getDelta(), 0.1);
  var now = performance.now();

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

  if (labelGroup) {
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
    '正在对齐北湖与南湖校区实测地理坐标…',
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

  setTimeout(function () {
    if (!window.__rafOk && !window.__rafFallbackTimer) {
      window.__rafFallbackTimer = setInterval(function () {
        if (window.__rafOk) {
          clearInterval(window.__rafFallbackTimer);
          window.__rafFallbackTimer = null;
        } else {
          animate();
        }
      }, 33);
    }
  }, 1000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

})();

