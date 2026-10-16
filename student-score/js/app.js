/**
 * app.js — 控制器 / 视图层
 *
 * 职责边界：
 *   · model.js  —— 领域模型与出厂口径（有哪些维度、默认权重）
 *   · score.js  —— 纯计算引擎（加权、排名、统计、直方图、差异）
 *   · data.js   —— 存储（本机 localStorage 持久化；云端未接入）
 *   · app.js    —— 本文件：只负责「读 store → 调 score → 画界面 → 把用户输入写回 store」
 *
 * 渲染策略：
 *   整体重渲染（结构变了：换视图、换学生、增删行）
 *   + 局部刷新（正在输入：只更新带 data-live 的派生数字块，不动 DOM 结构）
 *   —— 这样输入框不会因为重渲染丢焦点。
 */

import {
  FIVES, FIVES_KEYS, SUBJECTS, SUBJECT_KEYS, DIMENSIONS,
  DEFAULT_DAILY_ITEMS, DEFAULT_FIVES_WEIGHTS,
  defaultConfig, emptyFives, emptySubjects,
} from './model.js';

import {
  isNum, round, evaluate, evaluateAll, rankBy, stats, histogram, gap, flattenForCsv,
} from './score.js';

import { store, SOURCES, SOURCE_LABEL, CloudStore } from './data.js';

/* ===================================================================== *
 * 0. 小工具
 * ===================================================================== */

const shell = document.getElementById('shell');

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const fmt = (v, d = 2) => (isNum(v) ? round(v, d).toFixed(d) : '—');
const fmt1 = (v) => (isNum(v) ? round(v, 1).toFixed(1) : '—');

/** 输入框内容 → 数字或 null（空 = 未评，不当作 0） */
function numOrNull(raw, lo, hi) {
  const s = String(raw == null ? '' : raw).trim();
  if (s === '') return null;
  let v = Number(s);
  if (!Number.isFinite(v)) return null;
  if (isNum(lo)) v = Math.max(lo, v);
  if (isNum(hi)) v = Math.min(hi, v);
  return round(v, 1);
}

const clone = (o) => JSON.parse(JSON.stringify(o));

function toast(msg, kind = '') {
  const box = document.getElementById('toasts');
  if (!box) return;
  const el = document.createElement('div');
  el.className = 'toast' + (kind ? ' ' + kind : '');
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, 2400);
  setTimeout(() => el.remove(), 2800);
}

function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ===================================================================== *
 * 1. 界面状态（只放「看什么」，不放数据）
 * ===================================================================== */

const state = {
  role: 'teacher',            // teacher | student
  tview: 'grade',             // roster | grade | board | weights | data
  sview: 'report',            // report | self | compare
  classId: null,
  studentId: null,
  src: SOURCES.TEACHER,       // 评分台当前编辑的是谁的评分
  boardDim: 'composite',      // 榜单按哪个维度排
  boardSource: SOURCES.TEACHER,
  showBannerDetail: false,
  matrixSortKey: 'rank',
  showCertificate: false,
  matrixFilter: 'all',
  gradeMode: 'single', // 'single' | 'batch'
  batchSubject: 'chinese',
  batchTerm: 'final',
  matrixSortAsc: true,
  matrixQuery: '',
};

try {
  const r = localStorage.getItem('dx_role');
  if (r === 'teacher' || r === 'student') state.role = r;
} catch (e) { /* 忽略 */ }

/* ===================================================================== *
 * 2. 派生数据
 * ===================================================================== */

function bundlesFor(classId, source) {
  return store.listStudents(classId).map((stu) => ({
    student: stu,
    fives: store.getFives(stu.id, source),
    subjects: store.getSubjects(stu.id, source),
    daily: store.getDaily(stu.id, source),
  }));
}

/** 一次算完整班 */
function reportFor(classId, source) {
  const cfg = store.getConfig();
  const bundles = bundlesFor(classId, source);
  const results = evaluateAll(bundles, cfg);
  const byId = new Map(results.map((r) => [r.studentId, r]));
  return { cfg, bundles, results, byId };
}

const SCORE_OF = {
  composite: (ev) => ev.composite.score,
  fives: (ev) => ev.fives.score,
  subject: (ev) => ev.subject.score,
  daily: (ev) => ev.daily.score,
};

function fivesFill(items) {
  let f = 0;
  let t = 0;
  for (const d of FIVES) {
    for (const it of d.items) {
      t += 1;
      if (isNum(items && items[d.key] ? items[d.key][it.key] : null)) f += 1;
    }
  }
  return { f, t };
}

function subjectFill(scores) {
  let f = 0;
  for (const s of SUBJECTS) {
    const p = scores ? scores[s.key] : null;
    if (p && (isNum(p.usual) || isNum(p.mid) || isNum(p.final))) f += 1;
  }
  return { f, t: SUBJECTS.length };
}

/** 当前班级 */
function curClass() {
  const list = store.listClasses();
  if (!list.length) return null;
  return list.find((c) => c.id === state.classId) || list[0];
}

/** 确保 state.classId / studentId 指向真实存在的对象 */
function reconcile() {
  const classes = store.listClasses();
  if (!classes.length) { state.classId = null; state.studentId = null; return; }
  if (!classes.some((c) => c.id === state.classId)) state.classId = classes[0].id;

  const students = store.listStudents(state.classId);
  if (!students.length) { state.studentId = null; return; }
  if (!students.some((s) => s.id === state.studentId)) state.studentId = students[0].id;
}

const curStudent = () => store.listStudents(state.classId).find((s) => s.id === state.studentId) || null;

/* ===================================================================== *
 * 3. 图表（内联 SVG，不引第三方库）
 * ===================================================================== */

function gradeColor(score) {
  if (!isNum(score)) return 'var(--faint)';
  if (score >= 90) return 'var(--ok)';
  if (score >= 80) return 'var(--accent-2)';
  if (score >= 70) return 'var(--warn)';
  if (score >= 60) return 'var(--warn)';
  return 'var(--bad)';
}

/** 成绩单主环 */
function ringSVG(score) {
  const S = 158;
  const r = 65;
  const C = 2 * Math.PI * r;
  const pct = isNum(score) ? Math.max(0, Math.min(100, score)) / 100 : 0;
  const on = C * pct;
  return `<svg width="${S}" height="${S}" viewBox="0 0 ${S} ${S}" aria-hidden="true" focusable="false">
    <circle cx="${S / 2}" cy="${S / 2}" r="${r}" fill="none" stroke="var(--track)" stroke-width="13"></circle>
    <circle cx="${S / 2}" cy="${S / 2}" r="${r}" fill="none" stroke="${gradeColor(score)}"
      stroke-width="13" stroke-linecap="round"
      stroke-dasharray="${on.toFixed(2)} ${(C - on).toFixed(2)}"></circle>
  </svg>`;
}

/**
 * 五育雷达图
 * @param {Array<{key,name,color,teacher:number|null,self:number|null}>} rows
 */
function radarSVG(rows) {
  const W = 340;
  const H = 316;
  const cx = W / 2;
  const cy = H / 2 + 4;
  const R = 100;
  const LR = 124;
  const n = rows.length;
  const ang = (i) => ((-90 + (i * 360) / n) * Math.PI) / 180;
  const pt = (i, v) => [
    cx + Math.cos(ang(i)) * R * (Math.max(0, Math.min(100, v || 0)) / 100),
    cy + Math.sin(ang(i)) * R * (Math.max(0, Math.min(100, v || 0)) / 100),
  ];
  const poly = (key) => rows
    .map((r, i) => pt(i, r[key]).map((x) => x.toFixed(1)).join(','))
    .join(' ');

  const parts = [];

  // 底环
  for (const lv of [20, 40, 60, 80, 100]) {
    const p = rows.map((_, i) => pt(i, lv).map((x) => x.toFixed(1)).join(',')).join(' ');
    parts.push(`<polygon points="${p}" fill="none" stroke="var(--grid)" stroke-width="1"></polygon>`);
  }
  // 轴线
  rows.forEach((_, i) => {
    const [x, y] = pt(i, 100);
    parts.push(`<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="var(--grid)" stroke-width="1"></line>`);
  });

  const hasSelf = rows.some((r) => isNum(r.self));
  const hasTeacher = rows.some((r) => isNum(r.teacher));

  // 自评（虚线）
  if (hasSelf) {
    parts.push(`<polygon points="${poly('self')}" fill="none" stroke="var(--accent-2)"
      stroke-width="2" stroke-dasharray="6 4" stroke-linejoin="round"></polygon>`);
    rows.forEach((r, i) => {
      if (!isNum(r.self)) return;
      const [x, y] = pt(i, r.self);
      parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.2" fill="var(--bg)" stroke="var(--accent-2)" stroke-width="2"></circle>`);
    });
  }
  // 师评（实心）
  if (hasTeacher) {
    parts.push(`<polygon points="${poly('teacher')}" fill="var(--accent-soft)" stroke="var(--accent)"
      stroke-width="2" stroke-linejoin="round"></polygon>`);
    rows.forEach((r, i) => {
      if (!isNum(r.teacher)) return;
      const [x, y] = pt(i, r.teacher);
      parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.6" fill="var(--accent)"></circle>`);
    });
  }

  // 轴标签
  rows.forEach((r, i) => {
    const x = cx + Math.cos(ang(i)) * LR;
    const y = cy + Math.sin(ang(i)) * LR;
    const val = isNum(r.teacher) ? fmt1(r.teacher) : '—';
    parts.push(`<text x="${x.toFixed(1)}" y="${(y - 5).toFixed(1)}" text-anchor="middle"
      dominant-baseline="middle" font-size="14" font-weight="700" fill="${r.color}">${esc(r.name)}</text>`);
    parts.push(`<text x="${x.toFixed(1)}" y="${(y + 11).toFixed(1)}" text-anchor="middle"
      dominant-baseline="middle" font-size="11.5" font-family="monospace" fill="var(--muted)">${val}</text>`);
  });

  return `<svg class="chart" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"
    role="img" aria-label="五育雷达图：${rows.map((r) => `${r.name}${fmt1(r.teacher)}`).join('，')}">${parts.join('')}</svg>`;
}

/** 直方图 */
function histSVG(bins, opts = {}) {
  const W = 380;
  const H = 156;
  const padL = 26;
  const padR = 10;
  const padT = 12;
  const padB = 30;
  const iw = W - padL - padR;
  const ih = H - padT - padB;
  const maxC = Math.max(1, ...bins.map((b) => b.count));
  const bw = iw / bins.length;
  const marker = opts.marker;

  const parts = [];
  // y 网格
  for (let g = 0; g <= maxC; g += Math.max(1, Math.ceil(maxC / 3))) {
    const y = padT + ih - (g / maxC) * ih;
    parts.push(`<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="var(--grid)" stroke-width="1"></line>`);
    parts.push(`<text x="${padL - 5}" y="${y.toFixed(1)}" text-anchor="end" dominant-baseline="middle"
      font-size="9.5" font-family="monospace" fill="var(--faint)">${g}</text>`);
  }

  bins.forEach((b, i) => {
    const h = (b.count / maxC) * ih;
    const x = padL + i * bw + 1;
    const y = padT + ih - h;
    const isHit = isNum(marker) && marker >= b.from && (b.to === 100 ? marker <= b.to : marker < b.to);
    parts.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(1, bw - 2).toFixed(1)}"
      height="${Math.max(b.count ? 1.5 : 0, h).toFixed(1)}" rx="2"
      fill="${isHit ? 'var(--accent)' : 'var(--accent-2)'}" opacity="${isHit ? 1 : .5}">
      <title>${b.from}–${b.to} 分：${b.count} 人</title></rect>`);
    if (b.count) {
      parts.push(`<text x="${(x + (bw - 2) / 2).toFixed(1)}" y="${(y - 3).toFixed(1)}" text-anchor="middle"
        font-size="9.5" font-family="monospace" fill="var(--muted)">${b.count}</text>`);
    }
  });

  // x 轴
  parts.push(`<line x1="${padL}" y1="${(padT + ih).toFixed(1)}" x2="${W - padR}" y2="${(padT + ih).toFixed(1)}" stroke="var(--border-2)" stroke-width="1"></line>`);
  // x 轴：每 4 箱标一个刻度（0/20/40/60/80），避免窄屏缩放后刻度挤在一起
  bins.forEach((b, i) => {
    if (i % 4 !== 0) return;
    const x = padL + i * bw + bw / 2;
    parts.push(`<text x="${x.toFixed(1)}" y="${(padT + ih + 13).toFixed(1)}" text-anchor="middle"
      font-size="9.5" font-family="monospace" fill="var(--faint)">${b.from}</text>`);
  });
  parts.push(`<text x="${(W - padR).toFixed(1)}" y="${(padT + ih + 13).toFixed(1)}" text-anchor="end"
    font-size="9.5" font-family="monospace" fill="var(--faint)">100</text>`);

  return `<svg class="chart" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"
    role="img" aria-label="分数分布直方图，共 ${bins.reduce((a, b) => a + b.count, 0)} 人">${parts.join('')}</svg>`;
}

/** 横向条形。max 用该维度自己的量程（日常表现上限是 120，不是 100） */
function barRowHTML(label, value, max, color) {
  const pct = isNum(value) ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return `<div class="bar-cell" title="${esc(label)} ${fmt1(value)} / 满量程 ${max}">
    <span class="bar-track"><i class="bar-fill" style="width:${pct.toFixed(1)}%;background:${color || 'var(--accent-2)'}"></i></span>
    <span class="bar-val">${fmt1(value)}</span>
  </div>`;
}

/* ===================================================================== *
 * 4. 顶栏 / 状态条 / 侧栏
 * ===================================================================== */

function topbarHTML() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  return `<header class="topbar no-print">
    <div class="topbar-in">
      <div style="display:flex;align-items:center;gap:12px">
        <a href="../index.html" class="topbar-home-btn" title="返回主站 daixuan.cloud">
          <span aria-hidden="true">←</span> 主页
        </a>
        <div class="brand">
          <span class="brand-mark" aria-hidden="true">评</span>
          <span class="brand-text">
            <strong>学生综合评分系统</strong>
            <small>五育并举 · 学科成绩 · 日常表现</small>
          </span>
        </div>
      </div>
      
        ${state.role === 'teacher' && store.listClasses().length > 1 ? `
          <div class="topbar-class-box" style="display:inline-flex;align-items:center;gap:6px;background:var(--surface-3);padding:3px 10px;border-radius:var(--r-pill);border:1px solid var(--border)">
            <span style="font-size:.76rem;color:var(--muted)">当前班级:</span>
            <select data-act="switch-class-top" style="background:transparent;border:0;color:var(--text);font-size:.82rem;font-weight:600;outline:none;cursor:pointer">
              ${store.listClasses().map((c) => `<option value="${esc(c.id)}"${c.id === state.classId ? ' selected' : ''}>${esc(c.name)} (${c.studentCount}人)</option>`).join('')}
            </select>
          </div>` : ''}
    
      <span class="topbar-spacer"></span>
      <div class="topbar-actions">
        <div class="seg" role="group" aria-label="使用角色">
          <button class="seg-btn" type="button" data-act="role" data-arg="teacher"
            aria-pressed="${state.role === 'teacher'}">教师端</button>
          <button class="seg-btn" type="button" data-act="role" data-arg="student"
            aria-pressed="${state.role === 'student'}">学生端</button>
        </div>
        <button class="icon-btn" type="button" data-act="theme"
          title="切换深浅色" aria-label="切换深浅色">${isDark ? '☀' : '☾'}</button>
      </div>
    </div>
  </header>`;
}

function bannerHTML() {
  const open = state.showBannerDetail;
  return `<div class="banner no-print" role="status">
    <div class="banner-in">
      <span class="banner-dot" aria-hidden="true"></span>
      <div class="banner-text">
        <strong>数据存储：${esc(store.label)}</strong>
        <p style="margin:4px 0 0">
          评分记录会实时写进本机浏览器，刷新不丢；跨设备同步与账号登录等云服务环境开通后接入。
          <button class="btn btn-xs btn-ghost" type="button" data-act="banner-detail"
            style="margin-left:6px">${open ? '收起说明' : '接入说明'}</button>
        </p>
        ${open ? `<div class="banner-note">
          云服务环境开通后，这里会换成：<br>
          ① 老师用邮箱 / 手机号登录，数据按账号隔离，换设备也能看到；<br>
          ② 评分记录实时同步到云端，换设备、换浏览器都能接着用，不再只困在本机；<br>
          ③ 学生用自己的账号登录，只能看到自己的成绩单与自评表。<br>
          接入点已经留好：<code>js/data.js</code> 里的 <code>CloudStore.connect(publicConfig)</code>，
          其余代码一行都不用改。
          <button class="btn btn-xs" type="button" data-act="try-cloud" style="margin-top:8px">现在尝试连接云端</button>
        </div>` : ''}
      </div>
    </div>
  </div>`;
}

const TEACHER_NAV = [
  { key: 'grade', ico: '✎', name: '评分台' },
  { key: 'matrix', ico: '▦', name: '全班成绩大表' },
  { key: 'analytics', ico: '📈', name: '学情诊断大屏' },
  { key: 'batchReports', ico: '🖨️', name: '全班报告单连续打印' },
  { key: 'board', ico: '▤', name: '班级榜单' },
  { key: 'roster', ico: '☰', name: '班级与学生' },
  { key: 'weights', ico: '⚖', name: '权重设置' },
  { key: 'data', ico: '⇅', name: '数据管理' },
];

const STUDENT_NAV = [
  { key: 'report', ico: '★', name: '我的成绩单' },
  { key: 'self', ico: '✎', name: '我的自评' },
  { key: 'compare', ico: '⇄', name: '自评与师评对照' },
];

function sideHTML() {
  const nav = state.role === 'teacher' ? TEACHER_NAV : STUDENT_NAV;
  const cur = state.role === 'teacher' ? state.tview : state.sview;
  const cls = curClass();
  const students = cls ? store.listStudents(cls.id) : [];
  const { cfg, byId } = cls ? reportFor(cls.id, SOURCES.TEACHER) : { cfg: store.getConfig(), byId: new Map() };

  const navHTML = `<nav class="nav no-print" aria-label="功能导航">
    ${nav.map((n) => `<button class="nav-item" type="button" data-act="nav" data-arg="${n.key}"
      aria-current="${cur === n.key}">
      <span class="nav-ico" aria-hidden="true">${n.ico}</span><span>${esc(n.name)}</span>
    </button>`).join('')}
  </nav>`;

  // 学生选择器（学生端：演示用切换；教师端：评分台/榜单也用得上）
  const needPicker = state.role === 'student' || state.tview === 'grade';
  const pickerHTML = (needPicker && students.length) ? `<div class="picker">
    <div class="picker-head">
      <span>${state.role === 'student' ? '切换学生' : '学生名单'}</span>
      <span class="tag tag-plain">${students.length} 人</span>
    </div>
    ${state.role === 'student'
      ? `<p class="hint" style="margin:0 0 4px">演示用切换。正式接入登录后，这里由账号身份决定，学生只能看到自己。</p>`
      : ''}
    <div class="stu-list" role="list">
      ${students.map((s) => {
        const ev = byId.get(s.id);
        const sc = ev && ev.composite.score;
        return `<button class="stu-item" type="button" role="listitem"
          data-act="pick-student" data-arg="${esc(s.id)}" aria-current="${state.studentId === s.id}">
          <span class="stu-no">${esc(s.no)}</span>
          <span class="stu-name">${esc(s.name)}</span>
          <span class="stu-score">${isNum(sc) ? fmt1(sc) : '—'}</span>
          <span class="stu-bar" aria-hidden="true"><i style="width:${isNum(sc) ? Math.max(2, Math.min(100, sc)).toFixed(0) : 0}%"></i></span>
        </button>`;
      }).join('')}
    </div>
  </div>` : '';

  return `<aside class="side no-print">
    ${navHTML}
    ${pickerHTML}
    ${cls ? `<div class="kpi" style="background:var(--surface)">
      <div class="kpi-label">当前班级</div>
      <div style="font-weight:700;font-size:.9rem">${esc(cls.name)}</div>
      <div class="kpi-sub">${esc(cls.term || '')}</div>
    </div>` : ''}
  </aside>`;
}

/* ===================================================================== *
 * 5. 空状态
 * ===================================================================== */

function noClassHTML() {
  return `<div class="card"><div class="card-body">
    <div class="empty">
      <span class="empty-ico" aria-hidden="true">☰</span>
      <h2>还没有班级</h2>
      <p>先新建一个班级，再往里面加学生；也可以直接载入一份演示数据看看整套流程。</p>
      <div class="row" style="justify-content:center;margin-top:14px">
        <button class="btn btn-primary" type="button" data-act="load-demo">载入演示数据（12 名学生）</button>
        <button class="btn" type="button" data-act="new-class">新建空班级</button>
      </div>
    </div>
  </div></div>`;
}

function noStudentHTML() {
  return `<div class="card"><div class="card-body">
    <div class="empty">
      <span class="empty-ico" aria-hidden="true">☺</span>
      <h2>这个班还没有学生</h2>
      <p>到「班级与学生」里添加，或者载入演示数据。</p>
      <div class="row" style="justify-content:center;margin-top:14px">
        <button class="btn" type="button" data-act="nav" data-arg="roster">去添加学生</button>
        <button class="btn" type="button" data-act="load-demo">载入演示数据</button>
      </div>
    </div>
  </div></div>`;
}

/* ===================================================================== *
 * 6. 教师端 · 评分台
 * ===================================================================== */

function fivesRubricHTML(stu, src) {
  const rec = store.getFives(stu.id, src);
  const items = rec && rec.items ? rec.items : emptyFives();
  const srcLabel = SOURCE_LABEL[src];

  return FIVES.map((f) => {
    const dimVals = f.items.map((it) => items[f.key][it.key]).filter(isNum);
    const dimAvg = dimVals.length ? dimVals.reduce((a, b) => a + b, 0) / dimVals.length : null;
    return `<section class="rubric" style="margin-bottom:14px">
      <div class="rubric-head">
        <span class="five-dot five-${f.key}" aria-hidden="true"></span>
        <span class="rubric-title five-${f.key}-t">${esc(f.name)}育</span>
        <span class="rubric-desc">${esc(f.desc)}</span>
        <span class="row-end row" style="gap:4px">
          <span class="tag tag-plain" data-live="fives.${f.key}.avg">本育均分 ${fmt1(dimAvg)}（${dimVals.length}/${f.items.length} 项）</span>
          ${[80, 90, 100].map((v) => `<button class="btn btn-xs" type="button" data-act="fill-dim"
            data-arg="${f.key}" data-val="${v}" title="把本育未评的项都填成 ${v}">填 ${v}</button>`).join('')}
          <button class="btn btn-xs btn-ghost" type="button" data-act="clear-dim" data-arg="${f.key}">清空</button>
        </span>
      </div>
      <div class="rubric-body">
        ${f.items.map((it) => {
          const v = items[f.key][it.key];
          return `<label class="item">
            <span class="item-label">
              <span class="item-name">${esc(it.name)}</span>
              <span class="item-hint">${esc(it.hint)}</span>
            </span>
            <input class="input score-input num-cell${isNum(v) ? '' : ' empty'}" type="number"
              inputmode="decimal" min="0" max="100" step="1" placeholder="—"
              value="${isNum(v) ? v : ''}"
              aria-label="${esc(`${srcLabel}·${f.name}育·${it.name}（0-100 分）`)}"
              data-fk="fives|${stu.id}|${src}|${f.key}|${it.key}"
              data-write="fives" data-stu="${esc(stu.id)}" data-src="${src}"
              data-dim="${f.key}" data-item="${it.key}">
          </label>`;
        }).join('')}
      </div>
    </section>`;
  }).join('');
}

function subjectsTableHTML(stu, src) {
  const rec = store.getSubjects(stu.id, src);
  const scores = rec && rec.scores ? rec.scores : emptySubjects();
  const cfg = store.getConfig();
  const srcLabel = SOURCE_LABEL[src];

  return `<div class="table-wrap"><table>
    <caption class="sr-only">${esc(srcLabel)}学科成绩录入：平时、期中、期末</caption>
    <thead><tr>
      <th scope="col">科目</th>
      <th scope="col" class="center">平时</th>
      <th scope="col" class="center">期中</th>
      <th scope="col" class="center">期末</th>
      <th scope="col" class="center">学期成绩</th>
      <th scope="col">科目权重</th>
    </tr></thead>
    <tbody>
      ${SUBJECTS.map((s) => {
        const p = scores[s.key] || { usual: null, mid: null, final: null };
        const term = termOf(p, cfg.termWeights);
        const w = cfg.subjectWeights[s.key] || 0;
        const cells = ['usual', 'mid', 'final'].map((part) => `<td class="center">
          <input class="input score-input num-cell${isNum(p[part]) ? '' : ' empty'}" type="number"
            inputmode="decimal" min="0" max="100" step="1" placeholder="—"
            value="${isNum(p[part]) ? p[part] : ''}"
            aria-label="${esc(`${srcLabel}·${s.name}·${{ usual: '平时', mid: '期中', final: '期末' }[part]}`)}"
            data-fk="subj|${stu.id}|${src}|${s.key}|${part}"
            data-write="subj" data-stu="${esc(stu.id)}" data-src="${src}"
            data-subj="${s.key}" data-part="${part}"></td>`).join('');
        return `<tr>
          <th scope="row" style="font-weight:600;text-align:left;padding:8px 12px">${esc(s.name)}</th>
          ${cells}
          <td class="center"><strong data-live="subj.${s.key}.term">${fmt1(term)}</strong></td>
          <td>${w > 0 ? `<span class="tag tag-plain">×${w}</span>` : `<span class="tag" style="opacity:.5">不计入</span>`}</td>
        </tr>`;
      }).join('')}
    </tbody>
  </table></div>`;
}

function termOf(parts, tw) {
  const pairs = [
    { value: parts ? parts.usual : null, weight: tw.usual || 0 },
    { value: parts ? parts.mid : null, weight: tw.mid || 0 },
    { value: parts ? parts.final : null, weight: tw.final || 0 },
  ].filter((p) => isNum(p.value) && p.weight > 0);
  if (!pairs.length) return null;
  const ws = pairs.reduce((a, p) => a + p.weight, 0);
  return pairs.reduce((a, p) => a + p.value * p.weight, 0) / ws;
}

function dailyPanelHTML(stu, src) {
  const rec = store.getDaily(stu.id, src);
  const entries = rec ? rec.entries : [];
  const cfg = store.getConfig();
  const d = dailyScoreOf(entries, cfg);

  return `<div class="stack">
    <div class="chips">
      ${DEFAULT_DAILY_ITEMS.map((it) => `<button class="chip ${it.cat}" type="button"
        data-act="add-daily" data-arg="${esc(it.key)}">
        ${esc(it.label)}<span class="d">${it.delta > 0 ? '+' : ''}${it.delta}</span></button>`).join('')}
    </div>

    <div class="row" style="gap:8px;align-items:flex-end">
      <div class="field" style="flex:2 1 160px">
        <label for="diy-label-${src}">自定义项目名称</label>
        <input class="input" id="diy-label-${src}" type="text" placeholder="例如：区级演讲比赛一等奖"
          data-fk="diy|${src}|label" data-diy="label">
      </div>
      <div class="field" style="flex:0 0 108px">
        <label for="diy-delta-${src}">分值（可负）</label>
        <input class="input num-cell" id="diy-delta-${src}" type="number" inputmode="numeric" step="1"
          placeholder="+2" data-fk="diy|${src}|delta" data-diy="delta">
      </div>
      <button class="btn" type="button" data-act="add-diy" data-arg="${src}">加入流水</button>
    </div>

    <div class="kpis" data-live="daily.${src}.summary">
      ${kpi('基础分', cfg.dailyBase)}
      ${kpi('加分', '+' + fmt1(d.plus), 'ok')}
      ${kpi('扣分', fmt1(d.minus), 'bad')}
      ${kpi('日常表现分', fmt1(d.score), '', `净 ${d.net > 0 ? '+' : ''}${fmt1(d.net)} · ${d.count} 条记录`)}
    </div>

    <div class="log">
      ${entries.length ? entries.map((e, i) => `<div class="log-row">
        <span>${esc(e.label)}${e.note ? `<span class="log-note"> · ${esc(e.note)}</span>` : ''}</span>
        <span class="log-delta ${e.delta > 0 ? 'plus' : 'minus'}">${e.delta > 0 ? '+' : ''}${e.delta}</span>
        <button class="btn btn-xs btn-ghost" type="button" data-act="del-daily"
          data-arg="${src}" data-idx="${i}" aria-label="删除记录 ${esc(e.label)}">删除</button>
      </div>`).join('') : `<div class="log-empty">还没有日常表现记录。点上面的标签快速加分或扣分。</div>`}
    </div>
  </div>`;
}

function dailyScoreOf(entries, cfg) {
  const list = Array.isArray(entries) ? entries : [];
  const net = list.reduce((a, e) => a + (isNum(e.delta) ? e.delta : 0), 0);
  const base = isNum(cfg.dailyBase) ? cfg.dailyBase : 100;
  const lo = isNum(cfg.dailyMin) ? cfg.dailyMin : 0;
  const hi = isNum(cfg.dailyMax) ? cfg.dailyMax : 120;
  const raw = base + net;
  return {
    score: Math.max(lo, Math.min(hi, raw)),
    net,
    plus: list.filter((e) => e.delta > 0).reduce((a, e) => a + e.delta, 0),
    minus: list.filter((e) => e.delta < 0).reduce((a, e) => a + e.delta, 0),
    count: list.length,
  };
}

function kpi(label, val, tone, sub) {
  const color = tone === 'ok' ? 'var(--ok)' : tone === 'bad' ? 'var(--bad)' : tone === 'warn' ? 'var(--warn)' : 'var(--text)';
  return `<div class="kpi">
    <div class="kpi-label">${esc(label)}</div>
    <div class="kpi-val" style="color:${color}">${val}</div>
    ${sub ? `<div class="kpi-sub">${esc(sub)}</div>` : ''}
  </div>`;
}


/* ===================================================================== *
 * 5.1 按科目批量快速录入视图（Batch Scoring View）
 * ===================================================================== */

function viewBatchGrade() {
  const cls = curClass();
  if (!cls) return noClassHTML();
  const students = store.listStudents(cls.id);
  const cfg = store.getConfig();
  const subKey = state.batchSubject || 'chinese';
  const termKey = state.batchTerm || 'final';
  const curSub = SUBJECTS.find((s) => s.key === subKey) || SUBJECTS[0];

  const termNames = { usual: '平时成绩', mid: '期中考试', final: '期末考试' };
  const termWeights = { usual: cfg.termWeights.usual, mid: cfg.termWeights.mid, final: cfg.termWeights.final };

  return `<div class="stack">
    <div class="card">
      <div class="card-head" style="flex-wrap:wrap;gap:12px">
        <div>
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
            <h1 style="margin:0">极速录入模式 · 按科目批量录入</h1>
            <div class="seg seg-sm">
              <button class="seg-btn" type="button" data-act="set-grade-mode" data-arg="single">单人全维打分</button>
              <button class="seg-btn" type="button" data-act="set-grade-mode" data-arg="batch" aria-pressed="true">按科目极速录入</button>
            </div>
          </div>
          <p class="card-sub">键盘友好模式：在输入框中输完按 <b>Enter 或 ↓ 键</b> 自动跳到下一名同学，光标自动全选</p>
        </div>

        <div class="row row-end" style="gap:10px;flex-wrap:wrap">
          <div style="display:inline-flex;align-items:center;gap:6px;background:var(--surface-2);padding:4px 10px;border-radius:var(--r);border:1px solid var(--border)">
            <span style="font-size:.82rem;color:var(--muted)">当前科目：</span>
            <select data-act="set-batch-subject" style="background:transparent;border:0;color:var(--text);font-size:.86rem;font-weight:700;outline:none;cursor:pointer">
              ${SUBJECTS.map((s) => `<option value="${s.key}"${s.key === subKey ? ' selected' : ''}>${esc(s.name)} (权重 ${cfg.subjectWeights[s.key] ?? s.weight})</option>`).join('')}
            </select>
          </div>

          <div style="display:inline-flex;align-items:center;gap:6px;background:var(--surface-2);padding:4px 10px;border-radius:var(--r);border:1px solid var(--border)">
            <span style="font-size:.82rem;color:var(--muted)">考核阶段：</span>
            <select data-act="set-batch-term" style="background:transparent;border:0;color:var(--text);font-size:.86rem;font-weight:700;outline:none;cursor:pointer">
              <option value="final"${termKey === 'final' ? ' selected' : ''}>期末成绩 (${termWeights.final}%)</option>
              <option value="mid"${termKey === 'mid' ? ' selected' : ''}>期中成绩 (${termWeights.mid}%)</option>
              <option value="usual"${termKey === 'usual' ? ' selected' : ''}>平时成绩 (${termWeights.usual}%)</option>
            </select>
          </div>
        </div>
      </div>

      <div class="card-body tight">
        <div class="table-wrap" style="max-height:70vh;overflow:auto">
          <table>
            <thead style="position:sticky;top:0;z-index:2;background:var(--surface)">
              <tr>
                <th scope="col" style="width:50px" class="center">序号</th>
                <th scope="col" style="width:100px">学号</th>
                <th scope="col" style="width:110px">姓名</th>
                <th scope="col" style="width:170px" class="center">本次录入 (${termNames[termKey]})</th>
                <th scope="col" class="center" style="width:90px">平时分</th>
                <th scope="col" class="center" style="width:90px">期中分</th>
                <th scope="col" class="center" style="width:90px">期末分</th>
                <th scope="col" class="center" style="width:100px">当前科目总评</th>
                <th scope="col">表现水平</th>
              </tr>
            </thead>
            <tbody>
              ${students.map((stu, idx) => {
                const subRec = store.getSubjects(stu.id, SOURCES.TEACHER) || {};
                const scores = subRec.scores || {};
                const p = scores[subKey] || { usual: null, mid: null, final: null };
                const curVal = p[termKey];
                // 实时算分
                const parts = [
                  isNum(p.usual) ? p.usual * termWeights.usual : null,
                  isNum(p.mid) ? p.mid * termWeights.mid : null,
                  isNum(p.final) ? p.final * termWeights.final : null,
                ].filter(isNum);
                const wSum = [
                  isNum(p.usual) ? termWeights.usual : 0,
                  isNum(p.mid) ? termWeights.mid : 0,
                  isNum(p.final) ? termWeights.final : 0,
                ].reduce((a, b) => a + b, 0);
                const termScore = wSum > 0 ? parts.reduce((a, b) => a + b, 0) / wSum : null;

                return `<tr>
                  <td class="center font-mono" style="color:var(--muted)">${idx + 1}</td>
                  <td class="font-mono">${esc(stu.no)}</td>
                  <td><strong>${esc(stu.name)}</strong></td>
                  <td class="center">
                    <input class="input font-mono center batch-score-input" type="number" min="0" max="100" step="0.5"
                      data-batch-stu="${stu.id}" data-batch-idx="${idx}" value="${curVal ?? ''}" placeholder="未评"
                      style="max-width:110px;font-weight:700;font-size:1.05rem;${isNum(curVal) ? (curVal >= 90 ? 'border-color:var(--ok);color:var(--ok)' : curVal < 60 ? 'border-color:var(--bad);color:var(--bad)' : '') : ''}">
                  </td>
                  <td class="center num font-mono" style="${termKey === 'usual' ? 'font-weight:700;color:var(--accent)' : 'color:var(--muted)'}">${fmt1(p.usual)}</td>
                  <td class="center num font-mono" style="${termKey === 'mid' ? 'font-weight:700;color:var(--accent)' : 'color:var(--muted)'}">${fmt1(p.mid)}</td>
                  <td class="center num font-mono" style="${termKey === 'final' ? 'font-weight:700;color:var(--accent)' : 'color:var(--muted)'}">${fmt1(p.final)}</td>
                  <td class="center">
                    <strong class="font-mono" style="color:${gradeColor(termScore)}">${fmt1(termScore)}</strong>
                  </td>
                  <td>${barRowHTML(curSub.name, termScore, 100, gradeColor(termScore))}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>`;
}

function viewGrade() {
  if (state.gradeMode === 'batch') return viewBatchGrade();
  const cls = curClass();
  if (!cls) return noClassHTML();
  const stu = curStudent();
  if (!stu) return noStudentHTML();

  const src = state.src;
  const ev = evaluate({
    student: stu,
    fives: store.getFives(stu.id, src),
    subjects: store.getSubjects(stu.id, src),
    daily: store.getDaily(stu.id, src),
  }, store.getConfig());

  return `<div class="card">
    <div class="card-head">
      <div>
        <h1 style="margin:0">评分台 · ${esc(stu.name)}</h1>
        <p class="card-sub">学号 ${esc(stu.no)} · ${esc(cls.name)} · 正在录入「${esc(SOURCE_LABEL[src])}」</p>
      </div>
      <div class="seg seg-sm" role="group" aria-label="评分来源">
        <button class="seg-btn" type="button" data-act="src" data-arg="teacher"
          aria-pressed="${src === 'teacher'}">教师评分</button>
        <button class="seg-btn" type="button" data-act="src" data-arg="self"
          aria-pressed="${src === 'self'}">学生自评</button>
      </div>
    </div>
    <div class="card-body" style="padding-bottom:0">
      <div data-live="grade.preview">${gradePreviewHTML(ev)}</div>
    </div>
    <div class="card-body">
      ${src === 'self' ? `<div class="note note-warn" style="margin-bottom:14px">
        <span class="note-ico" aria-hidden="true">!</span>
        <span>这是<b>学生自评</b>通道。录入时<b>不要参考教师评分</b>，否则「自评 vs 师评对照」就失去意义了。</span>
      </div>` : ''}
      <h2>一、五育并举</h2>
      <p class="card-sub" style="margin-bottom:12px">24 个细项，每项 0–100 分。留空表示「未评」，不会当成 0 分参与计算。</p>
      ${fivesRubricHTML(stu, src)}

      <h2 style="margin-top:26px">二、学科成绩</h2>
      <p class="card-sub" style="margin-bottom:12px">
        每科录入平时 / 期中 / 期末，按 ${store.getConfig().termWeights.usual}% / ${store.getConfig().termWeights.mid}% / ${store.getConfig().termWeights.final}% 加权成学期成绩（可在「权重设置」里改）。
      </p>
      ${subjectsTableHTML(stu, src)}

      <h2 style="margin-top:26px">三、日常表现积分</h2>
      <p class="card-sub" style="margin-bottom:12px">基础分 ${store.getConfig().dailyBase} 分，加分减分累加后钳制在 ${store.getConfig().dailyMin}–${store.getConfig().dailyMax} 分之间。</p>
      ${dailyPanelHTML(stu, src)}
    </div>
  </div>`;
}

function gradePreviewHTML(ev) {
  const c = ev.composite;
  const f = ev.fives.coverage;
  const s = ev.subject.coverage;
  const missing = DIMENSIONS.filter((d) => !isNum(c.parts[d.key]));
  const warn = !c.complete;
  return `<div class="note ${warn ? 'note-warn' : 'note-ok'}" style="margin-bottom:14px">
    <span class="note-ico" aria-hidden="true">${warn ? '!' : '✓'}</span>
    <span>${warn
      ? `综合分目前基于 <b>${c.coverage.filled}/${c.coverage.total}</b> 个维度计算（${missing.map((d) => esc(d.name)).join('、')} 还没有数据）。
         缺失维度不参与，权重已在实有维度上重新归一化 —— 补齐后分数会变。`
      : '三个维度都有数据，综合分为完整口径。'}</span>
  </div>
  <div class="kpis">
    ${kpi('综合评分', `<span style="color:${gradeColor(c.score)}">${fmt1(c.score)}</span>`, '', `${ev.grade} · ${ev.gradeLabel}`)}
    ${kpi('五育并举', fmt1(c.parts.fives), '', isNum(c.parts.fives) ? `细项 ${f.filled}/${f.total} 项已评` : '尚无评分')}
    ${kpi('学科成绩', fmt1(c.parts.subject), '', isNum(c.parts.subject) ? `${s.filled}/${s.total} 个计权科目有分` : '尚无成绩')}
    ${kpi('日常表现', fmt1(c.parts.daily), '', isNum(c.parts.daily)
      ? `净 ${ev.daily.net > 0 ? '+' : ''}${fmt1(ev.daily.net)} · ${ev.daily.count} 条`
      : '尚无记录，未计入')}
  </div>`;
}

/* ===================================================================== *
 * 7. 教师端 · 班级榜单
 * ===================================================================== */


/* ===================================================================== *
 * 7.1 全班成绩总览大表（Matrix View）
 * ===================================================================== */

function viewMatrix() {
  const cls = curClass();
  if (!cls) return noClassHTML();
  const cfg = store.getConfig();
  const students = store.listStudents(cls.id);
  const { results } = reportFor(cls.id, SOURCES.TEACHER);
  const { rankMap } = rankBy(results, SCORE_OF.composite);

  let allRows = students.map((stu) => {
    const ev = results.find((r) => r.studentId === stu.id);
    const fScores = ev && ev.fives ? ev.fives.fives : {};
    return {
      stu,
      studentId: stu.id,
      no: stu.no || '',
      name: stu.name || '',
      rank: rankMap.get(stu.id) || 999,
      composite: ev ? ev.composite.score : null,
      fives: ev ? ev.fives.score : null,
      de: fScores.de ?? null,
      zhi: fScores.zhi ?? null,
      ti: fScores.ti ?? null,
      mei: fScores.mei ?? null,
      lao: fScores.lao ?? null,
      subject: ev ? ev.subject.score : null,
      daily: ev ? ev.daily.score : null,
      grade: gradeOf(ev ? ev.composite.score : null)
    };
  });

  let rows = allRows;

  const q = (state.matrixQuery || '').trim().toLowerCase();
  if (q) {
    rows = rows.filter((r) => r.name.toLowerCase().includes(q) || r.no.toLowerCase().includes(q));
  }

  const mFilter = state.matrixFilter || 'all';
  if (mFilter === 'exc') {
    rows = rows.filter((r) => isNum(r.composite) && r.composite >= 85);
  } else if (mFilter === 'good') {
    rows = rows.filter((r) => isNum(r.composite) && r.composite >= 75 && r.composite < 85);
  } else if (mFilter === 'pass') {
    rows = rows.filter((r) => isNum(r.composite) && r.composite >= 60 && r.composite < 75);
  } else if (mFilter === 'fail') {
    rows = rows.filter((r) => isNum(r.composite) && r.composite < 60);
  }

  const sk = state.matrixSortKey || 'rank';
  const asc = state.matrixSortAsc !== false;
  rows.sort((a, b) => {
    let va = a[sk];
    let vb = b[sk];
    if (va == null) va = asc ? 999999 : -999999;
    if (vb == null) vb = asc ? 999999 : -999999;
    if (typeof va === 'string') return asc ? va.localeCompare(vb) : vb.localeCompare(va);
    return asc ? (va - vb) : (vb - va);
  });

  const sortArrow = (k) => (state.matrixSortKey === k ? (state.matrixSortAsc ? ' ▲' : ' ▼') : '');

  const heatBg = (v) => {
    if (!isNum(v)) return '';
    if (v >= 90) return 'background:var(--ok-soft);color:var(--ok)';
    if (v >= 80) return 'background:var(--accent-soft);color:var(--accent-2)';
    if (v >= 60) return '';
    return 'background:var(--bad-soft);color:var(--bad)';
  };

  const compList = rows.map((r) => r.composite).filter(isNum);
  const deList = rows.map((r) => r.de).filter(isNum);
  const zhiList = rows.map((r) => r.zhi).filter(isNum);
  const tiList = rows.map((r) => r.ti).filter(isNum);
  const meiList = rows.map((r) => r.mei).filter(isNum);
  const laoList = rows.map((r) => r.lao).filter(isNum);
  const subjList = rows.map((r) => r.subject).filter(isNum);
  const dailyList = rows.map((r) => r.daily).filter(isNum);

  const calcAvg = (arr) => arr.length ? fmt1(arr.reduce((a, b) => a + b, 0) / arr.length) : '—';
  const calcMax = (arr) => arr.length ? fmt1(Math.max(...arr)) : '—';
  const calcMin = (arr) => arr.length ? fmt1(Math.min(...arr)) : '—';
  const calcPass = (arr) => arr.length ? ((arr.filter((v) => v >= 60).length / arr.length) * 100).toFixed(1) + '%' : '—';

  return `<div class="card">
    <div class="card-head" style="flex-wrap:wrap;gap:12px">
      <div>
        <h1 style="margin:0;display:flex;align-items:center;gap:8px">
          <span>全班成绩总览大表 · ${esc(cls.name)}</span>
          <span class="tag tag-accent">${rows.length}/${students.length} 人</span>
        </h1>
        <p class="card-sub">点击表头快速升降序排布、支持模糊搜索、直观色彩热力染色与底部班级统计小计</p>
      </div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <input type="search" id="matrixSearchInp" placeholder="搜索学号或姓名..." value="${esc(state.matrixQuery || '')}"
          style="padding:6px 12px;border-radius:var(--r-pill);background:var(--surface-2);border:1px solid var(--border);color:var(--text);font-size:.85rem;width:160px">
        <button class="btn btn-sm" type="button" data-act="export-html">🌐 导出网页报表</button>
        <button class="btn btn-sm" type="button" data-act="export-csv">📥 导出 Excel CSV</button>
        <button class="btn btn-sm" type="button" data-act="print">🖨️ 打印表格</button>
      </div>
    </div>

    <!-- 快捷分段过滤器 -->
    <div style="padding:10px 18px;background:var(--surface-2);border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      <span style="font-size:12px;font-weight:700;color:var(--muted)">快速分段：</span>
      <button class="btn btn-xs ${mFilter === 'all' ? 'btn-primary' : 'btn-ghost'}" type="button" data-act="matrix-filter" data-arg="all">全部 (${students.length})</button>
      <button class="btn btn-xs ${mFilter === 'exc' ? 'btn-primary' : 'btn-ghost'}" type="button" data-act="matrix-filter" data-arg="exc">优秀 (≥85分)</button>
      <button class="btn btn-xs ${mFilter === 'good' ? 'btn-primary' : 'btn-ghost'}" type="button" data-act="matrix-filter" data-arg="good">良好 (75-84分)</button>
      <button class="btn btn-xs ${mFilter === 'pass' ? 'btn-primary' : 'btn-ghost'}" type="button" data-act="matrix-filter" data-arg="pass">及格 (60-74分)</button>
      <button class="btn btn-xs ${mFilter === 'fail' ? 'btn-primary' : 'btn-ghost'}" type="button" data-act="matrix-filter" data-arg="fail">待补辅导 (<60分)</button>
    </div>

    <div class="card-body tight">
      <div class="table-wrap" style="max-height:68vh;overflow:auto">
        <table style="font-size:.84rem;min-width:880px">
          <thead style="position:sticky;top:0;z-index:3;background:var(--surface)">
            <tr>
              <th scope="col" style="cursor:pointer;white-space:nowrap" data-act="matrix-sort" data-arg="rank">排名${sortArrow('rank')}</th>
              <th scope="col" style="cursor:pointer;white-space:nowrap" data-act="matrix-sort" data-arg="no">学号${sortArrow('no')}</th>
              <th scope="col" style="cursor:pointer;white-space:nowrap" data-act="matrix-sort" data-arg="name">姓名${sortArrow('name')}</th>
              <th scope="col" style="cursor:pointer;white-space:nowrap" data-act="matrix-sort" data-arg="composite">综合总分${sortArrow('composite')}</th>
              <th scope="col" class="center">等级</th>
              <th scope="col" style="cursor:pointer;white-space:nowrap;color:var(--five-de)" data-act="matrix-sort" data-arg="de">德育${sortArrow('de')}</th>
              <th scope="col" style="cursor:pointer;white-space:nowrap;color:var(--five-zhi)" data-act="matrix-sort" data-arg="zhi">智育${sortArrow('zhi')}</th>
              <th scope="col" style="cursor:pointer;white-space:nowrap;color:var(--five-ti)" data-act="matrix-sort" data-arg="ti">体育${sortArrow('ti')}</th>
              <th scope="col" style="cursor:pointer;white-space:nowrap;color:var(--five-mei)" data-act="matrix-sort" data-arg="mei">美育${sortArrow('mei')}</th>
              <th scope="col" style="cursor:pointer;white-space:nowrap;color:var(--five-lao)" data-act="matrix-sort" data-arg="lao">劳育${sortArrow('lao')}</th>
              <th scope="col" style="cursor:pointer;white-space:nowrap" data-act="matrix-sort" data-arg="subject">学科总分${sortArrow('subject')}</th>
              <th scope="col" style="cursor:pointer;white-space:nowrap" data-act="matrix-sort" data-arg="daily">日常表现${sortArrow('daily')}</th>
              <th scope="col" class="center no-print">操作</th>
            </tr>
          </thead>
          <tbody>
            ${rows.length ? rows.map((r) => `
              <tr>
                <td class="center"><strong style="font-family:var(--mono);color:${r.rank <= 3 ? 'var(--warn)' : 'inherit'}">${r.rank <= 900 ? r.rank : '—'}</strong></td>
                <td style="font-family:var(--mono)">${esc(r.no)}</td>
                <td><strong>${esc(r.name)}</strong></td>
                <td class="center" style="font-family:var(--mono);font-weight:700;${heatBg(r.composite)}">${fmt1(r.composite)}</td>
                <td class="center"><span class="badge-grade ${r.grade.cls}">${r.grade.grade}</span></td>
                <td class="center num" style="${heatBg(r.de)}">${fmt1(r.de)}</td>
                <td class="center num" style="${heatBg(r.zhi)}">${fmt1(r.zhi)}</td>
                <td class="center num" style="${heatBg(r.ti)}">${fmt1(r.ti)}</td>
                <td class="center num" style="${heatBg(r.mei)}">${fmt1(r.mei)}</td>
                <td class="center num" style="${heatBg(r.lao)}">${fmt1(r.lao)}</td>
                <td class="center num" style="${heatBg(r.subject)}">${fmt1(r.subject)}</td>
                <td class="center num" style="${heatBg(r.daily)}">${fmt1(r.daily)}</td>
                <td class="center no-print" style="white-space:nowrap">
                  <button class="btn btn-xs" type="button" data-act="goto-grade" data-arg="${r.studentId}">打分</button>
                  <button class="btn btn-xs btn-ghost" type="button" data-act="view-student-report" data-arg="${r.studentId}">成绩单</button>
                </td>
              </tr>
            `).join('') : `
              <tr><td colspan="13" style="text-align:center;padding:32px;color:var(--muted)">没有找到符合条件的学生</td></tr>
            `}
          </tbody>
          ${rows.length ? `
          <tfoot style="position:sticky;bottom:0;background:var(--surface);border-top:2px solid var(--border)">
            <tr style="background:var(--surface-2);font-weight:700">
              <td colspan="3" class="center">全班均分 (Average)</td>
              <td class="center" style="font-family:var(--mono);color:var(--accent-2)">${calcAvg(compList)}</td>
              <td class="center">—</td>
              <td class="center num">${calcAvg(deList)}</td>
              <td class="center num">${calcAvg(zhiList)}</td>
              <td class="center num">${calcAvg(tiList)}</td>
              <td class="center num">${calcAvg(meiList)}</td>
              <td class="center num">${calcAvg(laoList)}</td>
              <td class="center num">${calcAvg(subjList)}</td>
              <td class="center num">${calcAvg(dailyList)}</td>
              <td class="no-print"></td>
            </tr>
            <tr style="background:var(--surface-2);font-size:.8rem;color:var(--muted)">
              <td colspan="3" class="center">全班最高分 (Highest)</td>
              <td class="center" style="font-family:var(--mono);font-weight:700;color:var(--ok)">${calcMax(compList)}</td>
              <td class="center">—</td>
              <td class="center num">${calcMax(deList)}</td>
              <td class="center num">${calcMax(zhiList)}</td>
              <td class="center num">${calcMax(tiList)}</td>
              <td class="center num">${calcMax(meiList)}</td>
              <td class="center num">${calcMax(laoList)}</td>
              <td class="center num">${calcMax(subjList)}</td>
              <td class="center num">${calcMax(dailyList)}</td>
              <td class="no-print"></td>
            </tr>
            <tr style="background:var(--surface-2);font-size:.8rem;color:var(--muted)">
              <td colspan="3" class="center">及格率 (Pass Rate)</td>
              <td class="center" style="font-family:var(--mono);font-weight:700">${calcPass(compList)}</td>
              <td class="center">—</td>
              <td class="center num">${calcPass(deList)}</td>
              <td class="center num">${calcPass(zhiList)}</td>
              <td class="center num">${calcPass(tiList)}</td>
              <td class="center num">${calcPass(meiList)}</td>
              <td class="center num">${calcPass(laoList)}</td>
              <td class="center num">${calcPass(subjList)}</td>
              <td class="center num">${calcPass(dailyList)}</td>
              <td class="no-print"></td>
            </tr>
          </tfoot>` : ''}
        </table>
      </div>
    </div>
  </div>`;
}

function generateStudentRemark(stu, ev) {
  if (!ev || !ev.composite || !isNum(ev.composite.score)) {
    return '该生本学期正在全面发展中，期待在后续的素质教育与学业学习中取得更优异的表现！';
  }
  const f = ev.fives ? ev.fives.fives : {};
  const traits = [];
  if (isNum(f.de) && f.de >= 85) traits.push('遵纪守法、集体责任感强');
  if (isNum(f.zhi) && f.zhi >= 85) traits.push('学习刻苦、善于思辨');
  if (isNum(f.ti) && f.ti >= 85) traits.push('热爱体育锻炼、体魄强健');
  if (isNum(f.mei) && f.mei >= 85) traits.push('具有良好审美素养与艺术表现力');
  if (isNum(f.lao) && f.lao >= 85) traits.push('劳动观念强、动手实践能力扎实');

  const strength = traits.length ? traits.join('，且') : '品行端正、勤勉好学';
  const cScore = ev.composite.score;
  let levelWord = '综合表现十分优秀';
  if (cScore >= 90) levelWord = '各方面均表现卓越，五育并举协调发展';
  else if (cScore >= 80) levelWord = '综合素质优良，学业与行为习惯表现扎实';
  else if (cScore >= 70) levelWord = '表现稳中有进，具备良好发展潜能';

  return `【综合评语】${esc(stu.name)}同学在校${strength}。本学期${levelWord}（综合评估总分 ${fmt1(cScore)}，评定等级为 ${gradeOf(cScore).grade}）。望戒骄戒躁，勇攀高峰！`;
}

/* =====================================================================
 * 7.2 学情与教学质量深度诊断大屏（Analytics & Insights View）
 * ===================================================================== */
function viewAnalytics() {
  const cls = curClass();
  if (!cls) return noClassHTML();
  const cfg = store.getConfig();
  const students = store.listStudents(cls.id);
  const { results } = reportFor(cls.id, SOURCES.TEACHER);
  const validResults = results.filter((r) => isNum(r.composite && r.composite.score));
  const compScores = validResults.map((r) => r.composite.score);
  const total = students.length;
  const n = compScores.length;
  const countExc = compScores.filter((s) => s >= 85).length;
  const countGood = compScores.filter((s) => s >= 75 && s < 85).length;
  const countPass = compScores.filter((s) => s >= 60 && s < 75).length;
  const countFail = compScores.filter((s) => s < 60).length;
  const pct = (cnt) => (n > 0 ? ((cnt / n) * 100).toFixed(1) : '0.0');
  const fivesAvgs = {};
  FIVES.forEach((f) => {
    const vals = validResults.map((r) => r.fives && r.fives.fives ? r.fives.fives[f.key] : null).filter(isNum);
    fivesAvgs[f.key] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  });
  const subjectAvgs = SUBJECTS.map((s) => {
    const vals = validResults.map((r) => r.subject && r.subject.subjects ? r.subject.subjects[s.key] : null).filter(isNum);
    const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    return { ...s, avg };
  }).sort((a, b) => b.avg - a.avg);
  const warningStudents = [];
  validResults.forEach((r) => {
    const stu = students.find((s) => s.id === r.studentId);
    if (!stu) return;
    const lowSubs = [];
    if (r.subject && r.subject.subjects) {
      for (const [k, v] of Object.entries(r.subject.subjects)) {
        if (isNum(v) && v < 60) lowSubs.push(subjectName(k) + ' (' + fmt1(v) + '分)');
      }
    }
    const isDailyLow = isNum(r.daily && r.daily.score) && r.daily.score < 90;
    if (lowSubs.length || isDailyLow) {
      warningStudents.push({
        stu,
        compScore: r.composite.score,
        lowSubs,
        dailyLow: isDailyLow ? fmt1(r.daily.score) + '分' : null
      });
    }
  });
  const radarRows = FIVES.map((f) => ({
    key: f.key,
    name: f.name,
    color: f.color,
    teacher: fivesAvgs[f.key],
    self: null
  }));
  const avgTotal = n ? compScores.reduce((a,b)=>a+b,0)/n : 0;
  return `<div class="stack">` +
    `<div class="card">` +
      `<div class="card-head" style="flex-wrap:wrap;gap:12px">` +
        `<div>` +
          `<h1 style="margin:0;display:flex;align-items:center;gap:8px">` +
            `<span>学情诊断与教学质量大屏 · ${esc(cls.name)}</span>` +
            `<span class="tag tag-ok">已参评 ${n}/${total} 人</span>` +
          `</h1>` +
          `<p class="card-sub">综合素质四率分布、全班五育均衡度、学科横向对标与薄弱学生精准预警</p>` +
        `</div>` +
        `<button class="btn btn-sm" type="button" data-act="print">🖨️ 打印诊断报告</button>` +
      `</div>` +
      `<div class="card-body">` +
        `<div class="kpis" style="margin-bottom:18px">` +
          kpi('全班总评均分', fmt1(avgTotal)) +
          kpi('优秀率 (≥85分)', pct(countExc) + '%', '', countExc + ' 人') +
          kpi('优良率 (≥75分)', pct(countExc + countGood) + '%', '', (countExc + countGood) + ' 人') +
          kpi('及格率 (≥60分)', pct(n - countFail) + '%', '', (n - countFail) + ' 人') +
          kpi('需重点关注 (<60分)', countFail + ' 人', '', pct(countFail) + '%') +
        `</div>` +
        `<div style="margin:14px 0 6px">` +
          `<div style="display:flex;align-items:center;justify-content:space-between;font-size:12px;color:var(--muted);margin-bottom:6px">` +
            `<span>全员四率分布带：</span>` +
            `<span>优秀 ${countExc}人 / 良好 ${countGood}人 / 及格 ${countPass}人 / 待辅导 ${countFail}人</span>` +
          `</div>` +
          `<div style="height:12px;border-radius:var(--r-pill);display:flex;overflow:hidden;background:var(--surface-3);border:1px solid var(--border)">` +
            `<div style="width:${pct(countExc)}%;background:var(--ok)" title="优秀 ${pct(countExc)}%"></div>` +
            `<div style="width:${pct(countGood)}%;background:var(--accent)" title="良好 ${pct(countGood)}%"></div>` +
            `<div style="width:${pct(countPass)}%;background:var(--warn)" title="及格 ${pct(countPass)}%"></div>` +
            `<div style="width:${pct(countFail)}%;background:var(--bad)" title="待提升 ${pct(countFail)}%"></div>` +
          `</div>` +
        `</div>` +
      `</div>` +
    `</div>` +
    `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr));gap:16px">` +
      `<div class="card">` +
        `<div class="card-head"><div><h2 style="margin:0">全班五育发展均衡度雷达</h2><p class="card-sub">群体德智体美劳平均水平（点击细看长短板）</p></div></div>` +
        `<div class="card-body center" style="padding-bottom:10px">` +
          radarSVG(radarRows) +
          `<div style="display:flex;justify-content:center;gap:12px;margin-top:8px;font-size:12px;flex-wrap:wrap">` +
            FIVES.map((f) => `<span style="color:${f.color}">${f.name}育均分: <strong>${fmt1(fivesAvgs[f.key])}</strong></span>`).join('') +
          `</div>` +
        `</div>` +
      `</div>` +
      `<div class="card">` +
        `<div class="card-head"><div><h2 style="margin:0">13 门学科均分排行榜</h2><p class="card-sub">全班单科学期均分从高到低排列（红虚线为60分及格线）</p></div></div>` +
        `<div class="card-body tight" style="padding:12px 18px;max-height:360px;overflow-y:auto">` +
          subjectAvgs.map((s, idx) => `
            <div style="margin-bottom:9px">
              <div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:3px">
                <span><strong style="font-family:var(--mono);color:${idx < 3 ? 'var(--warn)' : 'var(--muted)'}">#${idx + 1}</strong> ${esc(s.name)}</span>
                <strong style="font-family:var(--mono);color:${gradeColor(s.avg)}">${fmt1(s.avg)} 分</strong>
              </div>
              <div style="position:relative;height:7px;background:var(--surface-3);border-radius:4px;overflow:hidden">
                <div style="width:${Math.max(0, Math.min(100, s.avg))}%;height:100%;background:${idx === 0 ? 'var(--ok)' : 'var(--accent)'}"></div>
              </div>
            </div>`).join('') +
        `</div>` +
      `</div>` +
    `</div>` +
    `<div class="card">` +
      `<div class="card-head">` +
        `<div><h2 style="margin:0">学情预警与个别辅导关怀名单</h2><p class="card-sub">自动识别单科不及格或日常积分偏低的学生，便于任课教师与班主任因材施教精准施策</p></div>` +
        `<span class="tag ${warningStudents.length ? 'tag-warn' : 'tag-ok'} row-end">${warningStudents.length ? '需关怀 ' + warningStudents.length + ' 人' : '全员达标无预警'}</span>` +
      `</div>` +
      `<div class="card-body tight">` +
        (warningStudents.length ? `
          <div class="table-wrap"><table>
            <thead><tr>
              <th scope="col" style="width:100px">学号</th>
              <th scope="col" style="width:110px">姓名</th>
              <th scope="col" class="center" style="width:100px">综合总分</th>
              <th scope="col">需要辅导的薄弱科目</th>
              <th scope="col" style="width:140px">日常表现情况</th>
              <th scope="col" class="center no-print" style="width:100px">跟进操作</th>
            </tr></thead>
            <tbody>` +
              warningStudents.map((w) => `
                <tr>
                  <td class="font-mono">${esc(w.stu.no)}</td>
                  <td><strong>${esc(w.stu.name)}</strong></td>
                  <td class="center font-mono" style="font-weight:700;${w.compScore < 60 ? 'color:var(--bad)' : ''}">${fmt1(w.compScore)}</td>
                  <td>${w.lowSubs.length ? w.lowSubs.map((sub) => `<span class="tag tag-warn" style="margin-right:4px;margin-bottom:2px">${sub}</span>`).join('') : '<span style="color:var(--ok)">各科均及格</span>'}</td>
                  <td>${w.dailyLow ? `<span class="tag tag-bad">积分偏低: ${w.dailyLow}</span>` : '<span class="hint">正常</span>'}</td>
                  <td class="center no-print">
                    <button class="btn btn-xs" type="button" data-act="goto-grade" data-arg="${w.stu.id}">辅导打分</button>
                  </td>
                </tr>`).join('') +
            `</tbody></table></div>` : `<div class="empty" style="padding:28px 20px"><span class="empty-ico">🎉</span><p>太棒了！本班级当前所有参评学生的学科与日常表现均达到良好基准线，未出现偏科预警。</p></div>`) +
      `</div>` +
    `</div>` +
  `</div>`;
}

/* =====================================================================
 * 7.3 全班综合素质评价报告单 · 批量连续打印引擎（Batch Reports Print View）
 * ===================================================================== */
function viewBatchReports() {
  const cls = curClass();
  if (!cls) return noClassHTML();
  const cfg = store.getConfig();
  const students = store.listStudents(cls.id);
  const { results } = reportFor(cls.id, SOURCES.TEACHER);
  const { rankMap } = rankBy(results, SCORE_OF.composite);
  const sortedStudents = students.slice().sort((a, b) => (rankMap.get(a.id) || 999) - (rankMap.get(b.id) || 999));

  return `<div class="stack">
    <div class="card no-print" style="background:var(--surface)">
      <div class="card-head" style="flex-wrap:wrap;gap:12px">
        <div>
          <h1 style="margin:0;display:flex;align-items:center;gap:8px">
            <span>🖨️ 全班综合素质评价报告单 · 批量连续打印</span>
            <span class="tag tag-ok">共 ${students.length} 名学生</span>
          </h1>
          <p class="card-sub">标准 A4 规格双联排版，包含学期总评、五育量化、13 门单科成绩、班主任个性化评语及家长回执剪裁栏。按 Ctrl+P 或点击右侧按钮即可一键连续打印输出。</p>
        </div>
        <div style="display:flex;gap:10px;align-items:center">
          <button class="btn btn-primary" type="button" data-act="print">🖨️ 开始全班连续打印 (Ctrl+P)</button>
          <button class="btn" type="button" data-act="nav" data-arg="matrix">← 返回成绩大表</button>
        </div>
      </div>
    </div>

    <div class="batch-reports-wrap">
      ${sortedStudents.map((stu) => {
        const ev = results.find((r) => r.studentId === stu.id);
        const rank = rankMap.get(stu.id) || '—';
        const comp = ev && ev.composite ? ev.composite.score : null;
        const gr = gradeOf(comp);
        const f = ev && ev.fives ? ev.fives.fives : {};
        const remark = localStorage.getItem('stu_remark_' + stu.id) || generateStudentRemark(stu, ev);
        const subjRec = store.getSubjects(stu.id, SOURCES.TEACHER);
        const subjScores = subjRec ? subjRec.scores : {};

        return `
        <div class="report-a4-sheet">
          <div class="report-header">
            <div style="font-size:11px;letter-spacing:2px;color:var(--muted);text-transform:uppercase">STUDENT COMPREHENSIVE REPORT CARD</div>
            <h2 style="font-size:1.5rem;margin:6px 0 10px;letter-spacing:1px">${esc(cls.name)} · 学生综合素质与学业成长报告单</h2>
            <div class="report-meta-bar">
              <span>姓名：<strong>${esc(stu.name)}</strong></span>
              <span>学号：<strong>${esc(stu.no)}</strong></span>
              <span>全班排名：<strong>第 ${rank} 名</strong></span>
              <span>综合总评：<strong style="color:var(--accent-2);font-size:1.1rem">${fmt1(comp)} 分</strong></span>
              <span>等第：<strong class="tag ${gr.cls}">${gr.grade}（${gr.label}）</strong></span>
            </div>
          </div>

          <div class="report-main-grid">
            <!-- 左侧：五育与学科量化 -->
            <div>
              <div class="sec-title">一、五育发展量化水平</div>
              <div class="report-five-grid">
                ${FIVES.map((fItem) => `
                  <div class="report-five-pill">
                    <span style="color:${fItem.color};font-weight:700">${fItem.name}育</span>
                    <strong style="font-family:var(--mono);display:block;margin-top:2px">${fmt1(f[fItem.key])}</strong>
                  </div>
                `).join('')}
              </div>

              <div class="sec-title" style="margin-top:14px">二、学科期末学期总评</div>
              <div class="table-wrap">
                <table style="font-size:12px">
                  <thead><tr>
                    <th>学科</th><th class="center">平时</th><th class="center">期中</th><th class="center">期末</th><th class="center">学期总评</th>
                  </tr></thead>
                  <tbody>
                    ${SUBJECTS.map((s) => {
                      const sc = subjScores[s.key] || {};
                      const term = termOf(sc, cfg.termWeights);
                      return `<tr>
                        <th style="text-align:left;font-weight:600">${esc(s.name)}</th>
                        <td class="center font-mono">${fmt1(sc.usual)}</td>
                        <td class="center font-mono">${fmt1(sc.mid)}</td>
                        <td class="center font-mono">${fmt1(sc.final)}</td>
                        <td class="center font-mono" style="font-weight:700;color:${gradeColor(term)}">${fmt1(term)}</td>
                      </tr>`;
                    }).join('')}
                  </tbody>
                </table>
              </div>
            </div>

            <!-- 右侧：日常表现与班主任综合评语 -->
            <div style="display:flex;flex-direction:column;justify-content:space-between">
              <div>
                <div class="sec-title">三、班主任综合评语与发展建议</div>
                <div class="report-remark-box">
                  ${esc(remark)}
                </div>
                <div style="margin-top:10px;font-size:12px;color:var(--muted);text-align:right">
                  班主任签名：____________________ &nbsp;&nbsp; 日期：2026年___月___日
                </div>
              </div>

              <!-- 虚线回执条 -->
              <div class="report-receipt-box">
                <div class="receipt-cut-line">✂ ————————— 沿虚线剪下此联·签字后交回班主任留存 ————————— ✂</div>
                <div style="font-weight:700;text-align:center;margin-bottom:8px;font-size:13px">${esc(cls.name)} · 家长意见与回执单</div>
                <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:8px">
                  <span>学生：<strong>${esc(stu.name)}</strong> (${esc(stu.no)})</span>
                  <span>学期等第：<strong>${gr.grade}</strong></span>
                  <span>家长已阅确认：[ &nbsp; ]</span>
                </div>
                <div style="font-size:12px;color:var(--text-2);margin-bottom:6px">家长寄语 / 假期规划反馈：</div>
                <div style="height:34px;border-bottom:1px dashed var(--border-2);margin-bottom:10px"></div>
                <div style="display:flex;justify-content:space-between;font-size:11.5px">
                  <span>家长签名：________________</span>
                  <span>联系电话：________________</span>
                  <span>日期：2026年___月___日</span>
                </div>
              </div>
            </div>
          </div>
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

function viewBoard() {
  const cls = curClass();
  if (!cls) return noClassHTML();
  const students = store.listStudents(cls.id);
  if (!students.length) return noStudentHTML();

  const dim = state.boardDim;
  const src = state.boardSource;
  const { cfg, results } = reportFor(cls.id, src);
  const scoreOf = SCORE_OF[dim];
  const { rankMap, unscored } = rankBy(results, scoreOf);
  const ranked = results
    .filter((r) => isNum(scoreOf(r)))
    .slice()
    .sort((a, b) => scoreOf(b) - scoreOf(a));

  const values = ranked.map(scoreOf);
  const st = stats(values);
  const bins = histogram(values, 5, 0, 100);

  const dimName = dim === 'composite' ? '综合评分'
    : dim === 'fives' ? '五育并举' : dim === 'subject' ? '学科成绩' : '日常表现';

  const dimOptions = [
    ['composite', '综合评分'], ['fives', '五育并举'], ['subject', '学科成绩'], ['daily', '日常表现'],
  ];

  return `<div class="stack">
    <div class="card">
      <div class="card-head">
        <div>
          <h1 style="margin:0">班级榜单 · ${esc(cls.name)}</h1>
          <p class="card-sub">按「${esc(dimName)}」排名 · 共 ${students.length} 人${unscored.length ? ` · ${unscored.length} 人数据不足未参与排名` : ''}</p>
        </div>
        <div class="row row-end" style="gap:8px">
          <div class="seg seg-sm" role="group" aria-label="排名维度">
            ${dimOptions.map(([k, n]) => `<button class="seg-btn" type="button" data-act="board-dim" data-arg="${k}"
              aria-pressed="${dim === k}">${n}</button>`).join('')}
          </div>
          <div class="seg seg-sm" role="group" aria-label="数据来源">
            <button class="seg-btn" type="button" data-act="board-src" data-arg="teacher"
              aria-pressed="${src === 'teacher'}">师评</button>
            <button class="seg-btn" type="button" data-act="board-src" data-arg="self"
              aria-pressed="${src === 'self'}">自评</button>
          </div>
        </div>
      </div>
      <div class="card-body">
        <div class="kpis">
          ${kpi('参与人数', st.n)}
          ${kpi('平均分', fmt1(st.mean))}
          ${kpi('中位数', fmt1(st.median))}
          ${kpi('标准差', fmt1(st.sd), '', '样本 n−1')}
          ${kpi('最低 / 最高', `${fmt1(st.min)} / ${fmt1(st.max)}`)}
          ${kpi('四分位距', `${fmt1(st.p25)} – ${fmt1(st.p75)}`)}
        </div>
      </div>
      <div class="card-body" style="border-top:1px solid var(--border)">
        <div class="chart-wrap">
          ${histSVG(bins, { marker: null })}
          <div class="chart-legend">
            <div class="legend-row"><span class="legend-key">分数区间</span><span class="legend-val">人数</span></div>
            ${bins.filter((b) => b.count).map((b) => `<div class="legend-row">
              <span class="legend-key"><span class="legend-swatch" style="background:var(--accent-2);opacity:.6"></span>${b.from}–${b.to}</span>
              <span class="legend-val">${b.count}</span></div>`).join('') || '<div class="hint">暂无数据</div>'}
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><div><h2 style="margin:0">成绩明细</h2>
        <p class="card-sub">点姓名可跳到该生的评分台</p></div></div>
      <div class="card-body tight">
        <div class="table-wrap"><table>
          <caption class="sr-only">${esc(cls.name)}按${esc(dimName)}排名的成绩明细</caption>
          <thead><tr>
            <th scope="col" class="center">名次</th>
            <th scope="col">学生</th>
            <th scope="col" class="center">${esc(dimName)}</th>
            <th scope="col" class="center">等级</th>
            <th scope="col">五育</th>
            <th scope="col">学科</th>
            <th scope="col">日常</th>
            <th scope="col" class="center">自评差</th>
          </tr></thead>
          <tbody>
            ${ranked.map((ev) => {
              const stu = students.find((s) => s.id === ev.studentId);
              const rank = rankMap.get(ev.studentId);
              const selfRec = store.getFives(ev.studentId, SOURCES.SELF);
              const selfScore = selfRec ? evaluate({
                student: stu, fives: selfRec,
                subjects: store.getSubjects(ev.studentId, SOURCES.SELF),
                daily: store.getDaily(ev.studentId, SOURCES.SELF),
              }, cfg).composite.score : null;
              const g = gap(selfScore, ev.composite.score);
              return `<tr${ev.studentId === state.studentId ? ' class="is-me"' : ''}>
                <td class="center rank-cell rank-${rank <= 3 ? rank : 0}">${rank}</td>
                <td><button class="btn btn-xs btn-ghost" type="button" data-act="goto-grade" data-arg="${esc(ev.studentId)}"
                  style="border:0;padding:2px 4px">
                  <span class="who"><span class="who-no">${esc(stu.no)}</span><span class="who-name">${esc(ev.name)}</span></span>
                </button></td>
                <td class="center"><strong style="color:${gradeColor(scoreOf(ev))};font-family:var(--mono)">${fmt1(scoreOf(ev))}</strong></td>
                <td class="center"><span class="tag ${ev.gradeCls}">${ev.grade}</span></td>
                <td>${barRowHTML('五育', ev.fives.score, 100, 'var(--accent)')}</td>
                <td>${barRowHTML('学科', ev.subject.score, 100, 'var(--five-zhi)')}</td>
                <td>${barRowHTML('日常', ev.daily.score, cfg.dailyMax || 120, 'var(--five-ti)')}</td>
                <td class="center">${g
                  ? `<span class="gap-${g.level}" title="自评 ${fmt1(selfScore)} / 师评 ${fmt1(ev.composite.score)}">${g.diff > 0 ? '+' : ''}${fmt1(g.diff)}</span>`
                  : '<span class="hint">—</span>'}</td>
              </tr>`;
            }).join('')}
            ${unscored.length ? unscored.map((ev) => `<tr>
              <td class="center rank-cell">—</td>
              <td><span class="who"><span class="who-name">${esc(ev.name)}</span></span></td>
              <td class="center" colspan="6"><span class="hint">数据不足，未参与排名（请补齐评分）</span></td>
            </tr>`).join('') : ''}
          </tbody>
        </table></div>
      </div>
      <div class="card-foot">
        <span class="hint">并列名次采用竞赛排名法：同分同名次，下一名次跳号（如 1、1、3）。</span>
        <span class="row-end"></span>
        <button class="btn btn-sm" type="button" data-act="export-csv">导出 CSV</button>
        <button class="btn btn-sm" type="button" data-act="print">打印 / 存 PDF</button>
      </div>
    </div>
  </div>`;
}

/* ===================================================================== *
 * 8. 教师端 · 班级与学生
 * ===================================================================== */

function viewRoster() {
  const classes = store.listClasses();
  const cls = curClass();

  return `<div class="stack">
    <div class="card">
      <div class="card-head">
        <div><h1 style="margin:0">班级与学生</h1>
          <p class="card-sub">一个班级下挂学生名单；删除班级会连带删除该班全部评分记录。</p></div>
        <button class="btn btn-primary btn-sm row-end" type="button" data-act="new-class">＋ 新建班级</button>
      </div>
      <div class="card-body tight">
        ${classes.length ? `<div class="table-wrap"><table>
          <caption class="sr-only">班级列表</caption>
          <thead><tr>
            <th scope="col">班级名称</th><th scope="col">年级</th><th scope="col">学期</th>
            <th scope="col" class="center">人数</th><th scope="col" class="center">操作</th>
          </tr></thead>
          <tbody>
            ${classes.map((c) => `<tr${c.id === state.classId ? ' class="is-me"' : ''}>
              <td>
                <input class="input" type="text" value="${esc(c.name)}" aria-label="班级名称"
                  data-fk="cls|${c.id}|name" data-write="cls" data-id="${esc(c.id)}" data-prop="name" style="max-width:220px">
              </td>
              <td><input class="input" type="text" value="${esc(c.grade)}" aria-label="年级"
                data-fk="cls|${c.id}|grade" data-write="cls" data-id="${esc(c.id)}" data-prop="grade" style="max-width:110px"></td>
              <td><input class="input" type="text" value="${esc(c.term || '')}" aria-label="学期"
                data-fk="cls|${c.id}|term" data-write="cls" data-id="${esc(c.id)}" data-prop="term" style="max-width:180px"></td>
              <td class="center">${c.studentCount}</td>
              <td class="center">
                <div class="row" style="justify-content:center;gap:6px">
                  <button class="btn btn-xs" type="button" data-act="pick-class" data-arg="${esc(c.id)}"
                    ${c.id === state.classId ? 'disabled' : ''}>设为当前</button>
                  <button class="btn btn-xs btn-danger" type="button" data-act="del-class" data-arg="${esc(c.id)}"
                    data-name="${esc(c.name)}">删除</button>
                </div>
              </td>
            </tr>`).join('')}
          </tbody>
        </table></div>` : `<div class="empty"><span class="empty-ico">☰</span><p>还没有班级，点右上角新建。</p></div>`}
      </div>
    </div>

    ${cls ? `<div class="card">
      <div class="card-head">
        <div><h2 style="margin:0">${esc(cls.name)} · 学生名单</h2>
          <p class="card-sub">${store.listStudents(cls.id).length} 人</p></div>
        <button class="btn btn-primary btn-sm row-end" type="button" data-act="new-student">＋ 添加学生</button>
      </div>
      <div class="card-body tight">
        <div class="table-wrap"><table>
          <caption class="sr-only">${esc(cls.name)}学生名单</caption>
          <thead><tr>
            <th scope="col" style="width:88px">学号</th>
            <th scope="col">姓名</th>
            <th scope="col" style="width:88px">性别</th>
            <th scope="col" style="width:110px">分组</th>
            <th scope="col" class="center">五育</th>
            <th scope="col" class="center">学科</th>
            <th scope="col" class="center">日常</th>
            <th scope="col" class="center">操作</th>
          </tr></thead>
          <tbody>
            ${store.listStudents(cls.id).map((s) => {
              const ff = fivesFill((store.getFives(s.id, SOURCES.TEACHER) || {}).items);
              const sf = subjectFill((store.getSubjects(s.id, SOURCES.TEACHER) || {}).scores);
              const dn = ((store.getDaily(s.id, SOURCES.TEACHER) || {}).entries || []).length;
              return `<tr>
                <td><input class="input" type="text" value="${esc(s.no)}" aria-label="${esc(s.name)} 的学号"
                  data-fk="stu|${s.id}|no" data-write="stu" data-id="${esc(s.id)}" data-prop="no"></td>
                <td><input class="input" type="text" value="${esc(s.name)}" aria-label="姓名"
                  data-fk="stu|${s.id}|name" data-write="stu" data-id="${esc(s.id)}" data-prop="name"></td>
                <td><input class="input" type="text" value="${esc(s.gender)}" aria-label="${esc(s.name)} 的性别"
                  data-fk="stu|${s.id}|gender" data-write="stu" data-id="${esc(s.id)}" data-prop="gender"></td>
                <td><input class="input" type="text" value="${esc(s.group)}" aria-label="${esc(s.name)} 的分组"
                  data-fk="stu|${s.id}|group" data-write="stu" data-id="${esc(s.id)}" data-prop="group"></td>
                <td class="center"><span class="tag ${ff.f === ff.t ? 'tag-ok' : ff.f ? 'tag-warn' : 'tag-plain'}">${ff.f}/${ff.t}</span></td>
                <td class="center"><span class="tag ${sf.f === sf.t ? 'tag-ok' : sf.f ? 'tag-warn' : 'tag-plain'}">${sf.f}/${sf.t}</span></td>
                <td class="center"><span class="tag ${dn ? 'tag-ok' : 'tag-plain'}">${dn} 条</span></td>
                <td class="center">
                  <div class="row" style="justify-content:center;gap:6px">
                    <button class="btn btn-xs" type="button" data-act="goto-grade" data-arg="${esc(s.id)}">评分</button>
                    <button class="btn btn-xs btn-danger" type="button" data-act="del-student" data-arg="${esc(s.id)}"
                      data-name="${esc(s.name)}">删除</button>
                  </div>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table></div>
      </div>
      <div class="card-foot">
        <span class="hint">五育 / 学科 / 日常 三列的徽标是「已填写项数」，全绿表示该生该维度已填满。</span>
      </div>
    </div>` : ''}
  </div>`;
}

/* ===================================================================== *
 * 9. 教师端 · 权重设置
 * ===================================================================== */

function weightRow(label, hint, path, value, cls) {
  return `<div class="row" style="gap:10px;align-items:center;padding:7px 0;border-bottom:1px solid var(--border)">
    <div style="flex:1 1 auto;min-width:0">
      <div style="font-weight:600;font-size:.85rem">${label}</div>
      ${hint ? `<div class="hint">${hint}</div>` : ''}
    </div>
    <input class="input num-cell-sm${cls || ''}" type="number" inputmode="decimal" step="0.1" min="0"
      value="${isNum(value) ? value : ''}" aria-label="${esc(label)}权重"
      data-fk="cfg|${path}" data-write="cfg-num" data-path="${path}">
  </div>`;
}

function viewWeights() {
  const cls = curClass();
  if (!cls) return noClassHTML();
  const cfg = store.getConfig();

  const fwSum = FIVES_KEYS.reduce((a, k) => a + (cfg.fivesWeights[k] || 0), 0);
  const twSum = (cfg.termWeights.usual || 0) + (cfg.termWeights.mid || 0) + (cfg.termWeights.final || 0);
  const dwSum = DIMENSIONS.reduce((a, d) => a + (cfg.dimWeights[d.key] || 0), 0);
  const swSum = SUBJECT_KEYS.reduce((a, k) => a + (cfg.subjectWeights[k] || 0), 0);

  const sumTag = (s) => `<span class="tag ${Math.abs(s - 100) < 0.001 ? 'tag-ok' : 'tag-warn'}">合计 ${fmt1(s)}${Math.abs(s - 100) < 0.001 ? '' : '（将自动归一化）'}</span>`;

  return `<div class="stack">
    <div class="card">
      <div class="card-head">
        <div><h1 style="margin:0">权重设置</h1>
          <p class="card-sub">改权重<b>不会改动任何原始打分</b>，只影响加权方式；改完立刻全站重算。</p></div>
        <button class="btn btn-sm row-end" type="button" data-act="reset-weights">恢复出厂权重</button>
      </div>
      <div class="card-body" data-live="weights.preview">${weightsPreviewHTML()}</div>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-head"><div><h2 style="margin:0">综合评分 · 三维权重</h2>
          <p class="card-sub">决定综合分里「五育 / 学科 / 日常」各占多少</p></div></div>
        <div class="card-body">
          <div class="row" style="margin-bottom:8px">${sumTag(dwSum)}</div>
          ${DIMENSIONS.map((d) => weightRow(d.name, d.desc, `dimWeights.${d.key}`, cfg.dimWeights[d.key])).join('')}
        </div>
      </div>

      <div class="card">
        <div class="card-head"><div><h2 style="margin:0">五育并举 · 五育权重</h2>
          <p class="card-sub">决定五育总分里德 / 智 / 体 / 美 / 劳各占多少</p></div></div>
        <div class="card-body">
          <div class="row" style="margin-bottom:8px">${sumTag(fwSum)}</div>
          ${FIVES.map((f) => weightRow(
            `<span class="five-dot five-${f.key}" style="vertical-align:middle"></span> ${esc(f.full)}`,
            esc(f.desc), `fivesWeights.${f.key}`, cfg.fivesWeights[f.key])).join('')}
          <div class="row" style="margin-top:10px;gap:6px">
            <span class="hint">快速方案：</span>
            <button class="btn btn-xs" type="button" data-act="preset-fives" data-arg="balanced">均衡（20/20/20/20/20）</button>
            <button class="btn btn-xs" type="button" data-act="preset-fives" data-arg="default">出厂（25/35/20/10/10）</button>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><div><h2 style="margin:0">学科成绩 · 平时/期中/期末</h2>
          <p class="card-sub">决定单科「学期成绩」里三次成绩的占比</p></div></div>
        <div class="card-body">
          <div class="row" style="margin-bottom:8px">${sumTag(twSum)}</div>
          ${weightRow('平时成绩', '作业、小测、课堂表现等', 'termWeights.usual', cfg.termWeights.usual)}
          ${weightRow('期中成绩', '', 'termWeights.mid', cfg.termWeights.mid)}
          ${weightRow('期末成绩', '', 'termWeights.final', cfg.termWeights.final)}
        </div>
      </div>

      <div class="card">
        <div class="card-head"><div><h2 style="margin:0">学科成绩 · 科目权重</h2>
          <p class="card-sub">权重为 0 的科目不计入学科总分（但仍可录入成绩、单独查看）</p></div></div>
        <div class="card-body" style="max-height:520px;overflow:auto">
          <div class="row" style="margin-bottom:8px">${sumTag(swSum)}</div>
          ${SUBJECTS.map((s) => weightRow(esc(s.name), '', `subjectWeights.${s.key}`, cfg.subjectWeights[s.key])).join('')}
        </div>
      </div>

      <div class="card">
        <div class="card-head"><div><h2 style="margin:0">日常表现 · 计分区间</h2>
          <p class="card-sub">基础分 + 加减分流水，结果钳制在上下限之间</p></div></div>
        <div class="card-body">
          ${weightRow('基础分', '全班统一，通常是 100 分', 'dailyBase', cfg.dailyBase)}
          ${weightRow('下限', '再低也不会低于这个分数', 'dailyMin', cfg.dailyMin)}
          ${weightRow('上限', '再高也不会超过这个分数', 'dailyMax', cfg.dailyMax)}
        </div>
      </div>
    </div>
  </div>`;
}

function weightsPreviewHTML() {
  const cls = curClass();
  if (!cls) return '';
  const { results } = reportFor(cls.id, SOURCES.TEACHER);
  const vals = results.map((r) => r.composite.score).filter(isNum);
  const st = stats(vals);
  const top = results.filter((r) => isNum(r.composite.score))
    .slice().sort((a, b) => b.composite.score - a.composite.score).slice(0, 3);
  const complete = results.filter((r) => r.composite.complete).length;

  return `<div class="note" style="margin-bottom:14px">
    <span class="note-ico" aria-hidden="true">◷</span>
    <span>当前权重下：全班 <b>${results.length}</b> 人，<b>${complete}</b> 人三维齐全；
      平均分 <b>${fmt1(st.mean)}</b>，中位数 <b>${fmt1(st.median)}</b>，标准差 <b>${fmt1(st.sd)}</b>。</span>
  </div>
  <div class="kpis">
    ${top.map((r, i) => kpi(`第 ${i + 1} 名`, `${esc(r.name)} <span style="font-size:.8rem;font-weight:600">${fmt1(r.composite.score)}</span>`)).join('')}
    ${!top.length ? kpi('暂无数据', '—') : ''}
  </div>`;
}

/* ===================================================================== *
 * 10. 教师端 · 数据管理
 * ===================================================================== */


/* ===================================================================== *
 * 全真 CSV 智能导入引擎
 * ===================================================================== */
function parseRawCSV(text) {
  const lines = [];
  let row = [''];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (c === '"') {
      if (inQuotes && next === '"') {
        row[row.length - 1] += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      row.push('');
    } else if ((c === '\r' || c === '\n') && !inQuotes) {
      if (c === '\r' && next === '\n') i++;
      lines.push(row);
      row = [''];
    } else {
      row[row.length - 1] += c;
    }
  }
  if (row.length > 1 || row[0] !== '') lines.push(row);
  return lines;
}

function importCSVIntoClass(clsId, csvText) {
  const lines = parseRawCSV(csvText);
  if (lines.length < 2) throw new Error('CSV 文件行数不足，至少需包含表头与一行数据');
  
  const headers = lines[0].map((h) => h.trim().replace(/^\uFEFF/, ''));
  const noIdx = headers.findIndex((h) => h.includes('学号') || h.toLowerCase() === 'no' || h.toLowerCase() === 'id');
  const nameIdx = headers.findIndex((h) => h.includes('姓名') || h.toLowerCase() === 'name');
  if (noIdx === -1 || nameIdx === -1) {
    throw new Error('未识别到「学号」或「姓名」列，请使用标准模板');
  }

  // 科目列与五育列映射索引
  const subCols = {};
  SUBJECTS.forEach((s) => {
    const idx = headers.findIndex((h) => h === s.name || h.includes(s.name));
    if (idx !== -1) subCols[s.key] = idx;
  });

  const fiveCols = {};
  FIVES.forEach((f) => {
    const idx = headers.findIndex((h) => h === f.name || h === f.full || h.includes(f.name));
    if (idx !== -1) fiveCols[f.key] = idx;
  });

  const dailyIdx = headers.findIndex((h) => h.includes('日常'));

  let updatedCount = 0;
  let createdCount = 0;

  for (let i = 1; i < lines.length; i++) {
    const row = lines[i];
    if (!row || !row[noIdx] || !row[noIdx].trim()) continue;
    const no = row[noIdx].trim();
    const name = row[nameIdx] ? row[nameIdx].trim() : '学生' + no;

    let stu = store.listStudents(clsId).find((s) => String(s.no) === no);
    if (!stu) {
      stu = store.upsertStudent({ classId: clsId, no, name });
      createdCount++;
    } else {
      if (name && stu.name !== name) store.upsertStudent({ id: stu.id, classId: clsId, no, name });
      updatedCount++;
    }

    // 导入五育
    if (Object.keys(fiveCols).length) {
      const curFives = store.getFives(stu.id, SOURCES.TEACHER) || { items: emptyFives() };
      const items = curFives.items || emptyFives();
      for (const [fKey, cIdx] of Object.entries(fiveCols)) {
        const v = parseFloat(row[cIdx]);
        if (!Number.isNaN(v)) {
          // 均匀赋给该育细项
          const fMeta = FIVES.find((x) => x.key === fKey);
          if (fMeta) fMeta.items.forEach((it) => { items[fKey][it.key] = Math.max(0, Math.min(100, v)); });
        }
      }
      store.setFives(stu.id, SOURCES.TEACHER, items);
    }

    // 导入学科成绩
    if (Object.keys(subCols).length) {
      const curSubs = store.getSubjects(stu.id, SOURCES.TEACHER) || { scores: emptySubjects() };
      const scores = curSubs.scores || emptySubjects();
      for (const [sKey, cIdx] of Object.entries(subCols)) {
        const v = parseFloat(row[cIdx]);
        if (!Number.isNaN(v)) {
          scores[sKey] = { usual: v, mid: v, final: v };
        }
      }
      store.setSubjects(stu.id, SOURCES.TEACHER, scores);
    }

    // 导入日常表现分
    if (dailyIdx !== -1) {
      const v = parseFloat(row[dailyIdx]);
      if (!Number.isNaN(v)) {
        const diff = v - store.getConfig().dailyBase;
        store.setDaily(stu.id, SOURCES.TEACHER, [{ key: 'd-import', label: 'CSV 导入初始分', delta: diff, at: new Date().toISOString() }]);
      }
    }
  }

  return { createdCount, updatedCount };
}

function viewData() {
  const snap = store.snapshot();
  const counts = {
    classes: snap.classes.length,
    students: snap.students.length,
    fives: Object.keys(snap.fives).length,
    subjects: Object.keys(snap.subjects).length,
    daily: Object.values(snap.daily).reduce((a, r) => a + (r.entries || []).length, 0),
  };

  return `<div class="stack">
    <div class="card">
      <div class="card-head"><div><h1 style="margin:0">数据管理</h1>
        <p class="card-sub">当前存储：${esc(store.label)}</p></div></div>
      <div class="card-body">
        <div class="note note-warn" style="margin-bottom:16px">
          <span class="note-ico" aria-hidden="true">!</span>
          <span><b>当前数据保存在这台设备的这个浏览器里，刷新、关标签页都不会丢。</b>
            但换设备、换浏览器、清缓存都会丢失，老师与学生之间也不会自动同步。
            云端环境开通后会自动改为「登录 + 云端保存」；在那之前，
            跨设备搬运请先用下面的「导出备份」存成文件，再用「导入备份」恢复。</span>
        </div>
        <div class="kpis">
          ${kpi('班级', counts.classes)}
          ${kpi('学生', counts.students)}
          ${kpi('五育评分记录', counts.fives, '', '含教师评分与学生自评')}
          ${kpi('学科成绩记录', counts.subjects)}
          ${kpi('日常流水', counts.daily, '', '条')}
        </div>
      </div>
      <div class="card-foot" style="flex-wrap:wrap;gap:8px">
        <a class="btn btn-sm btn-primary" href="student-score-miniprogram.zip" download="student-score-miniprogram.zip">📱 下载微信小程序交付工程包 (.zip)</a>
        <button class="btn btn-primary btn-sm" type="button" data-act="export-json">导出备份（JSON）</button>
        <button class="btn btn-sm" type="button" data-act="import-json">导入备份</button>
        <button class="btn btn-sm" type="button" data-act="export-csv">导出成绩表（CSV）</button>
        <button class="btn btn-sm" type="button" data-act="download-csv-template">📥 下载导入空白模板（CSV）</button>
        <button class="btn btn-sm btn-primary" type="button" data-act="import-csv">📤 智能导入成绩表（CSV）</button>
        <button class="btn btn-sm" type="button" data-act="print">打印 / 存 PDF</button>
        <span class="row-end"></span>
        <button class="btn btn-sm" type="button" data-act="load-demo">重新载入演示数据</button>
        <button class="btn btn-sm btn-danger" type="button" data-act="reset">清空全部数据</button>
      </div>
    </div>

    
    <!-- 本地历史快照与防手抖存档 -->
    <div class="card">
      <div class="card-head">
        <div>
          <h2 style="margin:0">本地历史快照与安全存档</h2>
          <p class="card-sub">在进行大批量导入或学期封档前创建快照，随时一键安全回滚</p>
        </div>
        <button class="btn btn-sm btn-primary row-end" type="button" data-act="create-snapshot">📸 创建即时快照</button>
      </div>
      <div class="card-body tight">
        ${(() => {
          let list = [];
          try { list = JSON.parse(localStorage.getItem('dx_snapshots') || '[]'); } catch (e) { list = []; }
          if (!list.length) {
            return '<div class="empty" style="padding:24px"><span class="empty-ico">📷</span><p>暂无快照。点击右上角“创建即时快照”随时保存当前完整数据版本。</p></div>';
          }
          return `<div class="table-wrap"><table>
            <thead><tr>
              <th>快照名称与时间</th>
              <th class="center" style="width:140px">班级与学生</th>
              <th class="center" style="width:160px">操作</th>
            </tr></thead>
            <tbody>
              ${list.map((it) => `
                <tr>
                  <td><strong>${esc(it.name)}</strong><br><small style="color:var(--muted)">${esc(it.time)}</small></td>
                  <td class="center font-mono">${it.data && it.data.classes ? it.data.classes.length : 0} 班 / ${it.data && it.data.students ? it.data.students.length : 0} 人</td>
                  <td class="center">
                    <button class="btn btn-xs" type="button" data-act="restore-snapshot" data-arg="${it.id}">↺ 恢复此快照</button>
                    <button class="btn btn-xs btn-ghost btn-danger" type="button" data-act="delete-snapshot" data-arg="${it.id}">删除</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table></div>`;
        })()}
      </div>
    </div>
  
    <div class="card">
      <div class="card-head"><div><h2 style="margin:0">评分口径说明</h2>
        <p class="card-sub">这套系统怎么算分，写在这里，方便对家长和学生解释</p></div></div>
      <div class="card-body">
        <div class="stack" style="gap:14px">
          <div>
            <h3>一、五育并举（24 个细项）</h3>
            <p class="hint">每项 0–100 分。某一育的得分 = 该育下<b>已评细项</b>的算术平均；五育总分 = 各育得分按「五育权重」加权平均。
              留空的项不参与，不当作 0 分。</p>
          </div>
          <div>
            <h3>二、学科成绩</h3>
            <p class="hint">单科学期成绩 = 平时 × 平时权重 + 期中 × 期中权重 + 期末 × 期末权重（在实有项上归一化）；
              学科总分 = 各科学期成绩按「科目权重」加权平均，权重为 0 的科目不计入。</p>
          </div>
          <div>
            <h3>三、日常表现积分</h3>
            <p class="hint">日常表现分 = 基础分 + 加分 − 扣分，结果钳制在设定的上下限之间。</p>
          </div>
          <div>
            <h3>四、综合评分与排名</h3>
            <p class="hint">综合分 = 五育总分 × W₁ + 学科总分 × W₂ + 日常表现分 × W₃。
              <b>某个维度完全没数据时，该维度不参与，权重在剩下的维度上重新归一化</b>，
              并在界面上标注「基于 x/y 个维度」—— 不会用 0 分顶替缺失值。
              排名采用竞赛排名法：同分同名次，下一名次跳号。</p>
          </div>
          <div>
            <h3>五、统计口径</h3>
            <p class="hint">标准差为样本标准差（分母 n−1）；四分位数用线性插值（R type-7）。
              自评与师评之差 ≤3 分记为「基本一致」，超过则提示偏高或偏低。</p>
          </div>
        </div>
      </div>
    </div>
  </div>`;
}

/* ===================================================================== *
 * 11. 学生端 · 我的成绩单
 * ===================================================================== */

function viewReport() {
  const cls = curClass();
  if (!cls) return noClassHTML();
  const stu = curStudent();
  if (!stu) return noStudentHTML();

  const cfg = store.getConfig();
  const tFives = store.getFives(stu.id, SOURCES.TEACHER);
  const tSubjects = store.getSubjects(stu.id, SOURCES.TEACHER);
  const tDaily = store.getDaily(stu.id, SOURCES.TEACHER);
  const ev = evaluate({ student: stu, fives: tFives, subjects: tSubjects, daily: tDaily }, cfg);

  const { results } = reportFor(cls.id, SOURCES.TEACHER);
  const vals = results.map((r) => r.composite.score).filter(isNum);
  const { rankMap } = rankBy(results, SCORE_OF.composite);
  const rank = rankMap.get(stu.id);
  const lower = isNum(ev.composite.score) ? vals.filter((v) => v < ev.composite.score).length : 0;
  const beatPct = vals.length > 1 ? (lower / (vals.length - 1)) * 100 : null;
  const st = stats(vals);
  const bins = histogram(vals, 5, 0, 100);

  const radarRows = FIVES.map((f) => ({
    key: f.key, name: f.name, color: f.color,
    teacher: ev.fives.dims[f.key],
    self: null,
  }));

  const selfRec = store.getFives(stu.id, SOURCES.SELF);
  const selfEv = selfRec ? evaluate({
    student: stu, fives: selfRec,
    subjects: store.getSubjects(stu.id, SOURCES.SELF),
    daily: store.getDaily(stu.id, SOURCES.SELF),
  }, cfg) : null;

  return `<div class="stack">
    <div class="card">
      <div class="report-hero">
        <div class="ring">
          ${ringSVG(ev.composite.score)}
          <div class="ring-mid">
            <span class="ring-score" style="color:${gradeColor(ev.composite.score)}">${fmt1(ev.composite.score)}</span>
            <span class="ring-cap">综合评分</span>
            <span class="tag ${ev.gradeCls}" style="margin-top:3px">${ev.grade} · ${ev.gradeLabel}</span>
          </div>
        </div>
        <div class="hero-meta">
          <h1 class="hero-name">${esc(stu.name)}</h1>
          <p class="hero-sub">学号 ${esc(stu.no)} · ${esc(cls.name)} · ${esc(cls.term || '')}</p>
          <div class="dim-cards">
            ${DIMENSIONS.map((d) => {
              const v = ev.composite.parts[d.key];
              const counted = isNum(v);
              // 日常表现的量程是 [dailyMin, dailyMax]，不是 0–100
              const denom = d.key === 'daily' ? (cfg.dailyMax || 120) : 100;
              const cov = d.key === 'fives'
                ? `${ev.fives.coverage.filled}/${ev.fives.coverage.total} 细项`
                : d.key === 'subject'
                  ? `${ev.subject.coverage.filled}/${ev.subject.coverage.total} 科目`
                  : `${ev.daily.count} 条流水`;
              const w = ev.composite.weights[d.key];
              return `<div class="dim-card">
                <div class="dim-card-top">
                  <span class="dim-card-name">${esc(d.name)}</span>
                  <span class="dim-card-val" style="color:${gradeColor(v)}">${fmt1(v)}</span>
                </div>
                <div class="bar-track" style="margin:5px 0 4px"><i class="bar-fill" style="width:${counted ? Math.max(0, Math.min(100, (v / denom) * 100)).toFixed(1) : 0}%;background:${gradeColor(v)}"></i></div>
                <div class="dim-card-foot">${esc(cov)} · ${counted ? `有效权重 ${fmt1(w * 100)}%` : '尚未计入综合分'}</div>
              </div>`;
            }).join('')}
          </div>
        </div>
      </div>
      ${!ev.composite.complete ? `<div class="card-body" style="padding-top:0">
        <div class="note note-warn"><span class="note-ico" aria-hidden="true">!</span>
          <span>目前综合分基于 <b>${ev.composite.coverage.filled}/${ev.composite.coverage.total}</b> 个维度计算，
            ${DIMENSIONS.filter((d) => !isNum(ev.composite.parts[d.key])).map((d) => esc(d.name)).join('、')} 还没有数据，补齐后综合分会更新。</span></div>
      </div>` : ''}
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-head"><div><h2 style="margin:0">五育雷达</h2>
          <p class="card-sub">五项各自得分，越靠外越好</p></div></div>
        <div class="card-body">
          <div class="chart-wrap">
            ${radarSVG(radarRows)}
            <div class="chart-legend">
              ${FIVES.map((f) => {
                const v = ev.fives.dims[f.key];
                const cnt = f.items.filter((it) => isNum(tFives && tFives.items && tFives.items[f.key] ? tFives.items[f.key][it.key] : null)).length;
                return `<div class="legend-row">
                  <span class="legend-key"><span class="legend-swatch" style="background:${f.color}"></span>${esc(f.full)}</span>
                  <span class="legend-val">${fmt1(v)}</span>
                  <span class="hint" style="min-width:38px;text-align:right">${cnt}/${f.items.length}</span>
                </div>`;
              }).join('')}
            </div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><div><h2 style="margin:0">我在班里的位置</h2>
          <p class="card-sub">${esc(cls.name)} 共 ${vals.length} 人有完整评分</p></div></div>
        <div class="card-body">
          <div class="kpis" style="margin-bottom:14px">
            ${kpi('班级排名', rank ? `第 ${rank} 名` : '—', '', `共 ${vals.length} 人`)}
            ${kpi('超过同学', isNum(beatPct) ? fmt1(beatPct) + '%' : '—')}
            ${kpi('班级平均', fmt1(st.mean))}
            ${kpi('班级最高', fmt1(st.max))}
          </div>
          ${histSVG(bins, { marker: ev.composite.score })}
          <p class="hint" style="margin-top:8px">深色柱子是你所在的分数区间。</p>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><div><h2 style="margin:0">学科成绩明细</h2>
        <p class="card-sub">平时 / 期中 / 期末按 ${cfg.termWeights.usual}% / ${cfg.termWeights.mid}% / ${cfg.termWeights.final}% 加权</p></div>
        <span class="tag tag-accent row-end">学科总分 ${fmt1(ev.subject.score)}</span>
      </div>
      <div class="card-body tight">
        <div class="table-wrap"><table>
          <caption class="sr-only">学科成绩明细</caption>
          <thead><tr>
            <th scope="col">科目</th>
            <th scope="col" class="center">平时</th>
            <th scope="col" class="center">期中</th>
            <th scope="col" class="center">期末</th>
            <th scope="col" class="center">学期成绩</th>
            <th scope="col" style="min-width:150px">水平</th>
          </tr></thead>
          <tbody>
            ${SUBJECTS.map((s) => {
              const p = (store.getSubjects(stu.id, SOURCES.TEACHER) || {}).scores || {};
              const parts = p[s.key] || {};
              const term = ev.subject.subjects[s.key];
              const w = cfg.subjectWeights[s.key] || 0;
              return `<tr${w === 0 ? ' style="opacity:.55"' : ''}>
                <th scope="row" style="font-weight:600;text-align:left;padding:8px 12px">${esc(s.name)}${w === 0 ? ' <span class="hint">（不计入）</span>' : ''}</th>
                <td class="center num">${fmt1(parts.usual)}</td>
                <td class="center num">${fmt1(parts.mid)}</td>
                <td class="center num">${fmt1(parts.final)}</td>
                <td class="center"><strong style="font-family:var(--mono);color:${gradeColor(term)}">${fmt1(term)}</strong></td>
                <td>${barRowHTML(s.name, term, 100, gradeColor(term))}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table></div>
      </div>
    </div>

    <div class="card">
        <div class="card-head"><div><h2 style="margin:0">日常表现记录</h2>
          <p class="card-sub">基础分 ${cfg.dailyBase} · 加分 ${fmt1(ev.daily.plus)} · 扣分 ${fmt1(ev.daily.minus)}${ev.daily.hasData ? '' : ' · 尚无记录，暂未计入综合分'}</p></div>
        <span class="tag ${ev.daily.hasData ? 'tag-accent' : 'tag-plain'} row-end">日常表现分 ${fmt1(ev.daily.score)}</span>
      </div>
      <div class="card-body">
        <div class="log">
          ${(() => {
            const entries = ((store.getDaily(stu.id, SOURCES.TEACHER) || {}).entries) || [];
            return entries.length ? entries.map((e) => `<div class="log-row">
              <span>${esc(e.label)}</span>
              <span class="log-delta ${e.delta > 0 ? 'plus' : 'minus'}">${e.delta > 0 ? '+' : ''}${e.delta}</span>
              <span class="hint">${esc((e.at || '').slice(0, 10))}</span>
            </div>`).join('') : '<div class="log-empty">暂无日常表现记录。</div>';
          })()}
        </div>
      </div>
      
            <!-- 素质教育荣誉证书触发 -->
      <div class="card ${state.showCertificate ? 'certificate-card' : 'no-print'}" style="background:linear-gradient(135deg,var(--surface),var(--surface-2));border-color:rgba(245,165,36,0.4)">
        <div class="card-head ${state.showCertificate ? 'no-print' : ''}" style="align-items:center">
          <div style="display:flex;align-items:center;gap:10px">
            <span style="font-size:24px">🏆</span>
            <div>
              <h2 style="margin:0;font-size:1.05rem">素质教育成长荣誉档案与电子奖状</h2>
              <p class="card-sub">本学期综合评定：${gradeOf(ev.composite.score).grade}（${gradeOf(ev.composite.score).label}）· 班级排名第 ${rank} 名</p>
            </div>
          </div>
          <button class="btn btn-sm btn-primary row-end" type="button" data-act="toggle-cert">${state.showCertificate ? '收起荣誉奖状' : '🏅 展开我的荣誉奖状'}</button>
        </div>
        ${state.showCertificate ? `
          <div class="card-body" style="padding-top:0">
            <div class="certificate-frame" style="margin:10px auto;max-width:680px;padding:32px 28px;border:8px double #d4af37;border-radius:14px;background:var(--surface);box-shadow:0 8px 30px rgba(0,0,0,0.3);text-align:center;position:relative;overflow:hidden">
              <div style="font-size:12px;letter-spacing:4px;color:#d4af37;text-transform:uppercase;font-weight:700">HONORARY CERTIFICATE</div>
              <h1 style="font-size:1.85rem;margin:12px 0 16px;color:var(--text);letter-spacing:2px">荣 誉 证 书</h1>
              <p style="font-size:1.05rem;line-height:2;color:var(--text);margin:16px auto;max-width:540px;text-align:left;text-indent:2em">
                <strong style="font-size:1.25rem;border-bottom:2px solid var(--accent);padding:0 6px">${esc(stu.name)}</strong> 同学：
              </p>
              <p style="font-size:1rem;line-height:1.9;color:var(--text);margin:10px auto 28px;max-width:540px;text-align:left;text-indent:2em">
                在本学期综合素质评价与学业表现中，遵规守纪、五育并举、笃行求知。经班级综合量化评定，总评成绩荣列全班 <strong>第 ${rank} 名</strong>，表现优异，特授予
                <strong style="color:var(--warn);font-size:1.2rem">【五育并举 · 阳光少年】</strong> 荣誉称号。
              </p>
              <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:36px;padding:0 30px;font-size:.9rem;color:var(--muted)">
                <div style="text-align:left">
                  <div>颁发单位：${esc(cls.name)} 班务委员会</div>
                  <div>证书编号：DX-CERT-${stu.no}</div>
                </div>
                <div style="text-align:center">
                  <div style="width:72px;height:72px;border:2px dashed #d4af37;border-radius:50%;display:grid;place-items:center;margin:0 auto 6px;color:#d4af37;font-weight:800;font-size:11px;transform:rotate(-15deg)">
                    优秀之星<br>★ 认证 ★
                  </div>
                  <div>2026 学年第一学期</div>
                </div>
              </div>
              <div style="margin-top:20px" class="no-print">
                <button class="btn btn-sm" type="button" data-act="print">🖨️ 打印专属奖状</button>
              </div>
            </div>
          </div>` : ''}
      </div>
      <!-- 成绩单智能评语与回执区 -->
      <div class="card" style="margin-top:14px">
        <div class="card-head">
          <div>
            <h2 style="margin:0">期末综合素质发展评语与家长回执</h2>
            <p class="card-sub">智能分析五育优长项，支持教师个性化润色，打印时完整留存</p>
          </div>
          <button class="btn btn-xs btn-ghost row-end no-print" type="button" data-act="regen-remark">✨ 重新生成建议</button>
        </div>
        <div class="card-body">
          <div style="margin-bottom:12px">
            <textarea id="studentReportRemark" rows="3" style="width:100%;padding:10px 12px;border-radius:var(--r);background:var(--surface-2);border:1px solid var(--border);color:var(--text);font-size:.88rem;line-height:1.6">${esc(localStorage.getItem('stu_remark_' + stu.id) || generateStudentRemark(stu, ev))}</textarea>
            <div style="display:flex;justify-content:flex-end;margin-top:6px" class="no-print">
              <button class="btn btn-xs btn-primary" type="button" data-act="save-remark">保存评语</button>
            </div>
          </div>
          <!-- 打印回执栏 -->
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:20px;border-top:1px dashed var(--border);padding-top:14px;font-size:.82rem;color:var(--muted)">
            <div>班主任签名：__________________</div>
            <div>家长查阅签名：__________________</div>
            <div>评定日期：2026 年 ___ 月 ___ 日</div>
          </div>
        </div>
      </div>
    
      ${selfEv ? `<div class="card-foot">
        <span class="hint">你在「我的自评」里给自己打的分是 ${fmt1(selfEv.composite.score)}，
          与老师的 ${fmt1(ev.composite.score)} 相差 ${fmt1(selfEv.composite.score - ev.composite.score)} 分。</span>
        <span class="row-end"></span>
        <button class="btn btn-sm" type="button" data-act="nav" data-arg="compare">看详细对照</button>
      </div>` : ''}
    </div>
  </div>`;
}

/* ===================================================================== *
 * 12. 学生端 · 我的自评
 * ===================================================================== */

function viewSelf() {
  const cls = curClass();
  if (!cls) return noClassHTML();
  const stu = curStudent();
  if (!stu) return noStudentHTML();

  const rec = store.getFives(stu.id, SOURCES.SELF);
  const items = rec && rec.items ? rec.items : emptyFives();
  const ff = fivesFill(items);
  const selfEv = evaluate({
    student: stu,
    fives: rec,
    subjects: store.getSubjects(stu.id, SOURCES.SELF),
    daily: store.getDaily(stu.id, SOURCES.SELF),
  }, store.getConfig());

  return `<div class="card">
    <div class="card-head">
      <div><h1 style="margin:0">我的自评 · ${esc(stu.name)}</h1>
        <p class="card-sub">给自己这学期的表现打个分，0–100 分，留空表示「说不好」</p></div>
      <span class="tag ${ff.f === ff.t ? 'tag-ok' : 'tag-warn'} row-end" data-live="self.progress">已填 ${ff.f}/${ff.t} 项</span>
    </div>
    <div class="card-body" style="padding-bottom:0">
      <div class="note" style="margin-bottom:14px">
        <span class="note-ico" aria-hidden="true">☺</span>
        <span><b>这里看不到老师的评分</b>——这是故意的。自评的价值在于你自己的判断，
          先按自己的感觉打完，再去看「自评与师评对照」，对比才有意义。</span>
      </div>
    </div>
    <div class="card-body">
      ${FIVES.map((f) => {
        const dimVals = f.items.map((it) => items[f.key][it.key]).filter(isNum);
        const avg = dimVals.length ? dimVals.reduce((a, b) => a + b, 0) / dimVals.length : null;
        return `<section class="rubric" style="margin-bottom:14px">
          <div class="rubric-head">
            <span class="five-dot five-${f.key}" aria-hidden="true"></span>
            <span class="rubric-title five-${f.key}-t">${esc(f.name)}育</span>
            <span class="rubric-desc">${esc(f.desc)}</span>
            <span class="row-end row" style="gap:4px">
              <span class="tag tag-plain" data-live="self.${f.key}.avg">本育自评 ${fmt1(avg)}</span>
              <button class="btn btn-xs btn-ghost" type="button" data-act="clear-dim" data-arg="${f.key}" data-src="self">清空</button>
            </span>
          </div>
          <div class="rubric-body">
            ${f.items.map((it) => {
              const v = items[f.key][it.key];
              return `<label class="item">
                <span class="item-label">
                  <span class="item-name">${esc(it.name)}</span>
                  <span class="item-hint">${esc(it.hint)}</span>
                </span>
                <input class="input score-input num-cell${isNum(v) ? '' : ' empty'}" type="number"
                  inputmode="decimal" min="0" max="100" step="1" placeholder="—"
                  value="${isNum(v) ? v : ''}"
                  aria-label="${esc(`自评·${f.name}育·${it.name}（0-100 分）`)}"
                  data-fk="fives|${stu.id}|self|${f.key}|${it.key}"
                  data-write="fives" data-stu="${esc(stu.id)}" data-src="self"
                  data-dim="${f.key}" data-item="${it.key}">
              </label>`;
            }).join('')}
          </div>
        </section>`;
      }).join('')}

      <h2 style="margin-top:26px">我给自己记的日常表现</h2>
      <p class="card-sub" style="margin-bottom:12px">比如「坚持跑操一个月」「主动帮同学补课」—— 这些老师不一定看得到，自己记下来。</p>
      ${dailyPanelHTML(stu, SOURCES.SELF)}
    </div>
    <div class="card-foot">
      <span class="hint">自评的五育总分：<b>${fmt1(selfEv.fives.score)}</b>（${ff.f}/${ff.t} 项）</span>
      <span class="row-end"></span>
      <button class="btn btn-sm" type="button" data-act="nav" data-arg="report">看我的成绩单</button>
      <button class="btn btn-sm btn-primary" type="button" data-act="nav" data-arg="compare">看自评与师评对照</button>
    </div>
  </div>`;
}

/* ===================================================================== *
 * 13. 学生端 · 自评与师评对照
 * ===================================================================== */

function viewCompare() {
  const cls = curClass();
  if (!cls) return noClassHTML();
  const stu = curStudent();
  if (!stu) return noStudentHTML();

  const cfg = store.getConfig();
  const tItems = (store.getFives(stu.id, SOURCES.TEACHER) || {}).items || emptyFives();
  const sItems = (store.getFives(stu.id, SOURCES.SELF) || {}).items || emptyFives();
  const tEv = evaluate({ student: stu, fives: store.getFives(stu.id, SOURCES.TEACHER), subjects: store.getSubjects(stu.id, SOURCES.TEACHER), daily: store.getDaily(stu.id, SOURCES.TEACHER) }, cfg);
  const sEv = evaluate({ student: stu, fives: store.getFives(stu.id, SOURCES.SELF), subjects: store.getSubjects(stu.id, SOURCES.SELF), daily: store.getDaily(stu.id, SOURCES.SELF) }, cfg);
  const hasSelf = isNum(sEv.fives.score);
  const g = gap(sEv.composite.score, tEv.composite.score);

  const radarRows = FIVES.map((f) => ({
    key: f.key, name: f.name, color: f.color,
    teacher: tEv.fives.dims[f.key],
    self: sEv.fives.dims[f.key],
  }));

  const allItems = [];
  for (const f of FIVES) {
    for (const it of f.items) {
      const t = tItems[f.key][it.key];
      const s = sItems[f.key][it.key];
      const gg = gap(s, t);
      allItems.push({ f, it, t, s, gg });
    }
  }
  const diffs = allItems.map((x) => x.gg).filter(Boolean);
  const bigGaps = allItems.filter((x) => x.gg && x.gg.abs > 10);

  return `<div class="stack">
    <div class="card">
      <div class="card-head"><div><h1 style="margin:0">自评与师评对照 · ${esc(stu.name)}</h1>
        <p class="card-sub">看看「自己眼里的我」和「老师眼里的我」差在哪</p></div></div>
      <div class="card-body">
        ${!hasSelf ? `<div class="note note-warn"><span class="note-ico" aria-hidden="true">!</span>
          <span>还没有自评数据。<button class="btn btn-xs" type="button" data-act="nav" data-arg="self" style="margin-left:6px">去填写自评</button></span></div>`
        : `<div class="kpis" style="margin-bottom:16px">
          ${kpi('综合 · 师评', fmt1(tEv.composite.score))}
          ${kpi('综合 · 自评', fmt1(sEv.composite.score))}
          ${kpi('差值', `${g.diff > 0 ? '+' : ''}${fmt1(g.diff)}`, g.level === 'consistent' ? 'ok' : g.level === 'over' ? 'warn' : '', g.label)}
          ${kpi('明显差异项', `${bigGaps.length} 项`, bigGaps.length ? 'warn' : 'ok', '相差超过 10 分')}
        </div>`}
        <div class="chart-wrap">
          ${radarSVG(radarRows)}
          <div class="chart-legend">
            <div class="legend-row"><span class="legend-key"><span class="legend-swatch" style="background:var(--accent)"></span>教师评分</span></div>
            <div class="legend-row"><span class="legend-key"><span class="legend-swatch dashed"></span>学生自评</span></div>
            <div style="height:6px"></div>
            ${FIVES.map((f) => {
              const t = tEv.fives.dims[f.key];
              const s = sEv.fives.dims[f.key];
              const d = gap(s, t);
              return `<div class="legend-row">
                <span class="legend-key">${esc(f.name)}</span>
                <span class="legend-val">${fmt1(t)} → ${fmt1(s)}</span>
                <span class="hint gap-${d ? d.level : 'consistent'}" style="min-width:44px;text-align:right">${d ? (d.diff > 0 ? '+' : '') + fmt1(d.diff) : '—'}</span>
              </div>`;
            }).join('')}
          </div>
        </div>
      </div>
      <div class="card-foot">
        <span class="hint">差值 = 自评 − 师评。|差值| ≤ 3 视为「基本一致」。</span>
      </div>
    </div>

    ${hasSelf ? `<div class="card">
      <div class="card-head"><div><h2 style="margin:0">24 个细项逐项对照</h2>
        <p class="card-sub">${bigGaps.length ? `有 ${bigGaps.length} 项相差超过 10 分，值得和老师聊一聊` : '自评和师评整体比较接近'}</p></div></div>
      <div class="card-body tight">
        <div class="table-wrap"><table>
          <caption class="sr-only">五育 24 个细项的自评与师评对照</caption>
          <thead><tr>
            <th scope="col">维度</th><th scope="col">细项</th>
            <th scope="col" class="center">师评</th>
            <th scope="col" class="center">自评</th>
            <th scope="col" class="center">差值</th>
            <th scope="col">对照</th>
          </tr></thead>
          <tbody>
            ${allItems.map(({ f, it, t, s, gg }) => `<tr>
              <td><span class="five-dot five-${f.key}" style="vertical-align:middle"></span> <span class="hint">${esc(f.name)}</span></td>
              <th scope="row" style="font-weight:600;text-align:left;padding:8px 12px">${esc(it.name)}</th>
              <td class="center num">${fmt1(t)}</td>
              <td class="center num">${fmt1(s)}</td>
              <td class="center"><span class="gap-${gg ? gg.level : 'consistent'}" style="font-family:var(--mono);font-weight:700">${gg ? (gg.diff > 0 ? '+' : '') + fmt1(gg.diff) : '—'}</span></td>
              <td>${barRowHTML(it.name, s, 100, gg && gg.abs > 10 ? 'var(--warn)' : 'var(--accent-2)')}</td>
            </tr>`).join('')}
          </tbody>
        </table></div>
      </div>
      <div class="card-foot">
        <span class="hint">共 ${diffs.length} 项可对照，平均绝对差 ${fmt1(diffs.length ? diffs.reduce((a, x) => a + x.abs, 0) / diffs.length : null)} 分。</span>
      </div>
    </div>` : ''}
  </div>`;
}

/* ===================================================================== *
 * 14. 主渲染
 * ===================================================================== */

function mainHTML() {
  if (!store.listClasses().length) return noClassHTML();
  if (state.role === 'teacher') {
    switch (state.tview) {
      case 'matrix': return viewMatrix();
      case 'analytics': return viewAnalytics();
      case 'batchReports': return viewBatchReports();
      case 'board': return viewBoard();
      case 'roster': return viewRoster();
      case 'weights': return viewWeights();
      case 'data': return viewData();
      default: return viewGrade();
    }
  }
  switch (state.sview) {
    case 'self': return viewSelf();
    case 'compare': return viewCompare();
    default: return viewReport();
  }
}

function footHTML() {
  return `<footer class="foot no-print">
    <p>学生综合评分系统 · 全部计算在浏览器本地完成，不依赖任何第三方库。
      评分口径：五育并举（24 细项）+ 学科成绩（13 科 × 平时/期中/期末）+ 日常表现积分。</p>
    <p>存储状态：<b>${esc(store.label)}</b>。云端环境开通后，<code>js/data.js</code> 的
      <code>CloudStore.connect()</code> 会接管登录与数据保存，界面与算分逻辑无需改动。</p>
    <p style="margin-top:10px;font-size:13px;display:flex;gap:14px;flex-wrap:wrap">
      <a href="../index.html" style="color:var(--accent);text-decoration:none;font-weight:600">← 返回戴璇主页 (daixuan.cloud)</a>
      <a href="../claude-anti-ban/" style="color:var(--text-2);text-decoration:none">Claude 防封指南</a>
      <a href="../aurora-chat/" style="color:var(--text-2);text-decoration:none">Aurora Chat</a>
      <a href="../ming-history/" style="color:var(--text-2);text-decoration:none">明史资料平台</a>
    </p>
  </footer>`;
}

let rafPending = false;
let pendingFocus = null;

function captureFocus() {
  const el = document.activeElement;
  if (!el || !el.dataset || !el.dataset.fk) return null;
  let start = null;
  let end = null;
  try { start = el.selectionStart; end = el.selectionEnd; } catch (e) { /* number 输入不支持 */ }
  return { fk: el.dataset.fk, start, end };
}

function restoreFocus(snap) {
  if (!snap) return;
  const el = document.querySelector(`[data-fk="${CSS.escape(snap.fk)}"]`);
  if (!el) return;
  el.focus();
  if (snap.start != null && typeof el.setSelectionRange === 'function') {
    try { el.setSelectionRange(snap.start, snap.end); } catch (e) { /* 忽略 */ }
  }
}

function render() {
  reconcile();
  const y = window.scrollY;
  shell.innerHTML = topbarHTML() + bannerHTML()
    + `<div class="shell">${sideHTML()}<main class="main" id="app" tabindex="-1">${mainHTML()}</main></div>`
    + footHTML();
  if (y) window.scrollTo(0, y);
  restoreFocus(pendingFocus);
  pendingFocus = null;
}

function scheduleRender() {
  pendingFocus = captureFocus();
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    render();
  });
}

/** 局部刷新：只替换带 data-live 的派生数字块，不动 DOM 结构（输入时不丢焦点） */
function refreshDerived() {
  const map = liveMap();
  document.querySelectorAll('[data-live]').forEach((el) => {
    const k = el.dataset.live;
    if (k in map) el.innerHTML = map[k];
  });
}

function liveMap() {
  const out = {};
  const stu = curStudent();
  const cls = curClass();
  if (!stu || !cls) return out;
  const cfg = store.getConfig();
  const src = state.role === 'teacher' ? state.src : SOURCES.SELF;

  const ev = evaluate({
    student: stu,
    fives: store.getFives(stu.id, src),
    subjects: store.getSubjects(stu.id, src),
    daily: store.getDaily(stu.id, src),
  }, cfg);

  if (state.role === 'teacher' && state.tview === 'grade') {
    out['grade.preview'] = gradePreviewHTML(ev);
  }
  if (state.role === 'teacher' && state.tview === 'weights') {
    out['weights.preview'] = weightsPreviewHTML();
  }

  // 五育每育均分
  const items = (store.getFives(stu.id, src) || {}).items || emptyFives();
  for (const f of FIVES) {
    const vals = f.items.map((it) => items[f.key][it.key]).filter(isNum);
    const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    out[`fives.${f.key}.avg`] = `本育均分 ${fmt1(avg)}（${vals.length}/${f.items.length} 项）`;
    out[`self.${f.key}.avg`] = `本育自评 ${fmt1(avg)}`;
  }

  // 学科各科学期成绩
  const sc = (store.getSubjects(stu.id, src) || {}).scores || {};
  for (const s of SUBJECTS) {
    out[`subj.${s.key}.term`] = fmt1(termOf(sc[s.key], cfg.termWeights));
  }

  // 日常汇总
  const d = dailyScoreOf((store.getDaily(stu.id, src) || {}).entries, cfg);
  out[`daily.${src}.summary`] = [
    kpi('基础分', cfg.dailyBase),
    kpi('加分', '+' + fmt1(d.plus), 'ok'),
    kpi('扣分', fmt1(d.minus), 'bad'),
    kpi('日常表现分', fmt1(d.score), '', `净 ${d.net > 0 ? '+' : ''}${fmt1(d.net)} · ${d.count} 条记录`),
  ].join('');

  // 自评进度
  if (state.role === 'student') {
    const ff = fivesFill((store.getFives(stu.id, SOURCES.SELF) || {}).items);
    out['self.progress'] = `已填 ${ff.f}/${ff.t} 项`;
  }

  return out;
}

/* ===================================================================== *
 * 15. 交互
 * ===================================================================== */

let suppressRender = false;

function writeField(el) {
  const w = el.dataset.write;
  if (!w) return;
  const raw = el.value;

  if (w === 'fives') {
    const { stu, src, dim, item } = el.dataset;
    const cur = store.getFives(stu, src);
    const items = cur && cur.items ? clone(cur.items) : emptyFives();
    if (!items[dim]) items[dim] = {};
    items[dim][item] = numOrNull(raw, 0, 100);
    store.setFives(stu, src, items);
    return;
  }

  if (w === 'subj') {
    const { stu, src, subj, part } = el.dataset;
    const cur = store.getSubjects(stu, src);
    const scores = cur && cur.scores ? clone(cur.scores) : emptySubjects();
    if (!scores[subj]) scores[subj] = { usual: null, mid: null, final: null };
    scores[subj][part] = numOrNull(raw, 0, 100);
    store.setSubjects(stu, src, scores);
    return;
  }

  if (w === 'cfg-num') {
    const path = el.dataset.path;
    const cfg = clone(store.getConfig());
    const [a, b] = path.split('.');
    const v = numOrNull(raw, 0, null);
    if (b) { if (!cfg[a]) cfg[a] = {}; cfg[a][b] = v; } else cfg[a] = v;
    store.setConfig(cfg);
    return;
  }

  if (w === 'stu') {
    store.upsertStudent({ id: el.dataset.id, [el.dataset.prop]: raw });
  }
}

/** 班级字段走这里（createClass 只能新增，改动走 updateClass） */
function writeClassField(el) {
  store.updateClass(el.dataset.id, { [el.dataset.prop]: el.value });
}

function handleAction(act, arg, el) {
  switch (act) {
    case 'role':
      state.role = arg;
      try { localStorage.setItem('dx_role', arg); } catch (e) { /* 忽略 */ }
      render();
      break;

    case 'nav':
      if (state.role === 'teacher') state.tview = arg;
      else state.sview = arg;
      render();
      break;

    case 'theme': {
      const cur = document.documentElement.getAttribute('data-theme');
      const next = cur === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('dx_theme', next); } catch (e) { /* 忽略 */ }
      render();
      break;
    }

    case 'banner-detail':
      state.showBannerDetail = !state.showBannerDetail;
      render();
      break;

    case 'try-cloud':
      try {
        CloudStore.connect();
      } catch (e) {
        toast(e.message, 'bad');
      }
      break;

    case 'pick-class':
      state.classId = arg;
      state.studentId = null;
      render();
      break;

    case 'pick-student':
      state.studentId = arg;
      render();
      break;

    case 'goto-grade':
      state.studentId = arg;
      if (state.role === 'teacher') state.tview = 'grade';
      else state.sview = 'report';
      render();
      break;

    case 'src':
      state.src = arg;
      render();
      break;

    case 'board-dim':
      state.boardDim = arg;
      render();
      break;

    case 'board-src':
      state.boardSource = arg;
      render();
      break;

    case 'new-class': {
      const n = store.listClasses().length + 1;
      const c = store.createClass({ name: `新班级 ${n}`, grade: '初二', term: '2026 学年第一学期' });
      state.classId = c.id;
      state.studentId = null;
      toast('已新建班级，可以改名字了', 'ok');
      render();
      break;
    }

    case 'del-class': {
      if (!window.confirm(`确定删除「${el.dataset.name}」？\n该班的学生名单和全部评分记录都会一起删除，且无法恢复。`)) return;
      store.removeClass(arg);
      if (state.classId === arg) state.classId = null;
      toast('已删除班级');
      render();
      break;
    }

    case 'new-student': {
      const cls = curClass();
      if (!cls) break;
      const s = store.upsertStudent({ classId: cls.id, name: '新同学' });
      state.studentId = s.id;
      toast('已添加学生，可以改名字了', 'ok');
      render();
      break;
    }

    case 'del-student': {
      if (!window.confirm(`确定删除「${el.dataset.name}」？\n该生的全部评分记录会一起删除，且无法恢复。`)) return;
      store.removeStudent(arg);
      toast('已删除学生');
      render();
      break;
    }

    case 'fill-dim': {
      const dim = arg;
      const val = Number(el.dataset.val);
      const stu = curStudent();
      if (!stu) break;
      const src = state.role === 'teacher' ? state.src : SOURCES.SELF;
      const cur = store.getFives(stu.id, src);
      const items = cur && cur.items ? clone(cur.items) : emptyFives();
      const f = FIVES.find((x) => x.key === dim);
      for (const it of f.items) if (!isNum(items[dim][it.key])) items[dim][it.key] = val;
      store.setFives(stu.id, src, items);
      toast(`${f.name}育未评项已填为 ${val} 分`, 'ok');
      render();
      break;
    }

    case 'clear-dim': {
      const dim = arg;
      const stu = curStudent();
      if (!stu) break;
      const src = el.dataset.src || (state.role === 'teacher' ? state.src : SOURCES.SELF);
      const cur = store.getFives(stu.id, src);
      const items = cur && cur.items ? clone(cur.items) : emptyFives();
      for (const it of FIVES.find((x) => x.key === dim).items) items[dim][it.key] = null;
      store.setFives(stu.id, src, items);
      render();
      break;
    }

    case 'add-daily': {
      const stu = curStudent();
      if (!stu) break;
      const src = el.dataset.src || (state.role === 'teacher' ? state.src : SOURCES.SELF);
      const item = DEFAULT_DAILY_ITEMS.find((x) => x.key === arg);
      if (!item) break;
      store.addDailyEntry(stu.id, src, { ...item });
      render();
      break;
    }

    case 'add-diy': {
      const stu = curStudent();
      if (!stu) break;
      const src = arg;
      const labelEl = document.querySelector(`[data-diy="label"][data-fk="diy|${src}|label"]`);
      const deltaEl = document.querySelector(`[data-diy="delta"][data-fk="diy|${src}|delta"]`);
      const label = labelEl ? labelEl.value.trim() : '';
      const delta = deltaEl ? Number(deltaEl.value) : NaN;
      if (!label) { toast('先写个名称', 'bad'); return; }
      if (!Number.isFinite(delta) || delta === 0) { toast('分值要填一个非 0 的数字', 'bad'); return; }
      store.addDailyEntry(stu.id, src, { label, delta, note: '自定义' });
      if (labelEl) labelEl.value = '';
      if (deltaEl) deltaEl.value = '';
      render();
      break;
    }

    case 'del-daily': {
      const stu = curStudent();
      if (!stu) break;
      store.removeDailyEntry(stu.id, arg, Number(el.dataset.idx));
      render();
      break;
    }

    case 'reset-weights':
      if (!window.confirm('把所有权重恢复成出厂设置？原始打分不受影响。')) return;
      store.setConfig(defaultConfig());
      toast('权重已恢复出厂设置', 'ok');
      render();
      break;

    case 'preset-fives': {
      const cfg = clone(store.getConfig());
      cfg.fivesWeights = arg === 'balanced'
        ? Object.fromEntries(FIVES_KEYS.map((k) => [k, 20]))
        : { ...DEFAULT_FIVES_WEIGHTS };
      store.setConfig(cfg);
      toast(arg === 'balanced' ? '已切换为五育均衡权重' : '已切换为出厂权重', 'ok');
      render();
      break;
    }

    
    case 'matrix-sort': {
      if (state.matrixSortKey === arg) {
        state.matrixSortAsc = !state.matrixSortAsc;
      } else {
        state.matrixSortKey = arg;
        state.matrixSortAsc = true;
      }
      render();
      break;
    }

    case 'view-student-report':
      state.studentId = arg;
      state.role = 'student';
      state.sview = 'report';
      render();
      break;

    case 'regen-remark': {
      const stu = curStudent();
      const cls = curClass();
      if (stu && cls) {
        const { byId } = reportFor(cls.id, SOURCES.TEACHER);
        const remark = generateStudentRemark(stu, byId.get(stu.id));
        const el = document.getElementById('studentReportRemark');
        if (el) el.value = remark;
        localStorage.setItem('stu_remark_' + stu.id, remark);
        toast('已重新生成并填入评语', 'ok');
      }
      break;
    }

    case 'save-remark': {
      const stu = curStudent();
      const el = document.getElementById('studentReportRemark');
      if (stu && el) {
        localStorage.setItem('stu_remark_' + stu.id, el.value);
        toast('评语已保存', 'ok');
      }
      break;
    }

    case 'download-csv-template': {
      const tpl = '学号,姓名,德育,智育,体育,美育,劳育,语文,数学,英语,物理,化学,生物,道德与法治,历史,地理,体育与健康,音乐,美术,信息科技,日常表现分\r\n' +
        '202601,张晓明,92,95,88,86,90,92,98,90,88,85,90,92,88,85,90,85,88,95,108\r\n' +
        '202602,李晨,88,82,96,80,85,84,80,82,78,75,80,85,82,80,95,80,82,88,102\r\n' +
        '202603,王芳,96,90,84,95,92,95,88,94,82,85,88,94,92,90,85,96,92,90,112';
      download('学生综合评分导入模板.csv', '\uFEFF' + tpl, 'text/csv;charset=utf-8');
      toast('标准导入模板已下载', 'ok');
      break;
    }
  
    
    case 'toggle-cert':
      state.showCertificate = !state.showCertificate;
      render();
      break;

    case 'switch-class-top':
      state.classId = arg;
      const topStus = store.listStudents(arg);
      if (topStus.length) state.studentId = topStus[0].id;
      render();
      break;

    case 'set-grade-mode':
      state.gradeMode = arg;
      render();
      break;

    case 'set-batch-subject':
      state.batchSubject = arg;
      render();
      break;

    case 'set-batch-term':
      state.batchTerm = arg;
      render();
      break;

    case 'import-csv': {
      const cls = curClass();
      if (!cls) { toast('请先选择或新建一个班级', 'bad'); break; }
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = '.csv,text/csv';
      inp.addEventListener('change', () => {
        const file = inp.files && inp.files[0];
        if (!file) return;
        const fr = new FileReader();
        fr.onload = () => {
          try {
            const res = importCSVIntoClass(cls.id, String(fr.result));
            toast(`CSV 导入成功！新增 ${res.createdCount} 人，更新 ${res.updatedCount} 人`, 'ok');
            render();
          } catch (err) {
            alert('CSV 导入失败：' + err.message);
          }
        };
        fr.readAsText(file, 'utf-8');
      });
      inp.click();
      break;
    }
  
    case 'export-json': {
      const snap = store.snapshot();
      const stamp = new Date().toISOString().slice(0, 10);
      download(`学生评分备份-${stamp}.json`, JSON.stringify(snap, null, 2), 'application/json');
      toast('备份已导出', 'ok');
      break;
    }

    case 'import-json': {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = '.json,application/json';
      inp.addEventListener('change', () => {
        const file = inp.files && inp.files[0];
        if (!file) return;
        const fr = new FileReader();
        fr.onload = () => {
          try {
            const obj = JSON.parse(String(fr.result));
            store.restore(obj);
            toast('备份已导入', 'ok');
            render();
          } catch (e) {
            toast('导入失败：' + e.message, 'bad');
          }
        };
        fr.readAsText(file);
      });
      inp.click();
      break;
    }

    case 'create-snapshot': {
      const snap = store.snapshot();
      let list = [];
      try { list = JSON.parse(localStorage.getItem('dx_snapshots') || '[]'); } catch (e) { list = []; }
      const cls = curClass();
      const name = (cls ? cls.name : '全校数据') + ' - ' + snap.students.length + '人存档';
      list.unshift({
        id: 'snap_' + Date.now(),
        time: new Date().toLocaleString(),
        name,
        data: snap
      });
      if (list.length > 8) list.pop();
      localStorage.setItem('dx_snapshots', JSON.stringify(list));
      toast('已成功创建当前数据快照 ✓', 'ok');
      render();
      break;
    }

    case 'restore-snapshot': {
      let list = [];
      try { list = JSON.parse(localStorage.getItem('dx_snapshots') || '[]'); } catch (e) { list = []; }
      const item = list.find((x) => x.id === act.arg);
      if (!item) { toast('未找到该快照', 'bad'); break; }
      if (window.confirm('确定要将数据还原至【' + item.name + '】(' + item.time + ') 吗？当前未保存的修改将被覆盖。')) {
        store.restore(item.data);
        toast('已成功还原至历史快照 ✓', 'ok');
        render();
      }
      break;
    }

    case 'delete-snapshot': {
      let list = [];
      try { list = JSON.parse(localStorage.getItem('dx_snapshots') || '[]'); } catch (e) { list = []; }
      list = list.filter((x) => x.id !== act.arg);
      localStorage.setItem('dx_snapshots', JSON.stringify(list));
      toast('快照已删除', 'ok');
      render();
      break;
    }

    case 'matrix-filter':
      state.matrixFilter = act.arg || 'all';
      render();
      break;

    case 'export-html': {
      const cls = curClass();
      if (!cls) { toast('还没有班级', 'bad'); break; }
      const cfg = store.getConfig();
      const { results } = reportFor(cls.id, SOURCES.TEACHER);
      const { rankMap } = rankBy(results, SCORE_OF.composite);
      const students = store.listStudents(cls.id);
      const sortedStudents = students.slice().sort((a, b) => (rankMap.get(a.id) || 999) - (rankMap.get(b.id) || 999));
      const stamp = new Date().toISOString().slice(0, 10);
      const rowsHtml = sortedStudents.map((stu) => {
        const ev = results.find((r) => r.studentId === stu.id);
        const comp = ev && ev.composite ? ev.composite.score : null;
        const gr = gradeOf(comp);
        const f = ev && ev.fives ? ev.fives.fives : {};
        return `<tr>
          <td style="text-align:center">${rankMap.get(stu.id) || '—'}</td>
          <td style="font-family:monospace">${esc(stu.no)}</td>
          <td><strong>${esc(stu.name)}</strong></td>
          <td style="text-align:center;font-weight:700">${fmt1(comp)}</td>
          <td style="text-align:center">${gr.grade} (${gr.label})</td>
          <td style="text-align:center">${fmt1(f.de)}</td>
          <td style="text-align:center">${fmt1(f.zhi)}</td>
          <td style="text-align:center">${fmt1(f.ti)}</td>
          <td style="text-align:center">${fmt1(f.mei)}</td>
          <td style="text-align:center">${fmt1(f.lao)}</td>
          <td style="text-align:center">${fmt1(ev ? ev.subject.score : null)}</td>
          <td style="text-align:center">${fmt1(ev ? ev.daily.score : null)}</td>
        </tr>`;
      }).join('');

      const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${esc(cls.name)} · 综合素质与学业成绩总览表</title>
<style>
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 24px auto; max-width: 1000px; color: #111; line-height: 1.5; }
h1 { margin: 0 0 6px; font-size: 22px; text-align: center; }
.meta { text-align: center; color: #666; font-size: 13px; margin-bottom: 20px; }
table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
th, td { border: 1px solid #ccc; padding: 8px 10px; }
th { background: #f2f4f8; font-weight: 700; }
tr:nth-child(even) { background: #fafafa; }
@media print { button { display: none; } body { margin: 0; } }
</style>
</head>
<body>
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
    <span></span>
    <button onclick="window.print()" style="padding:6px 14px;cursor:pointer;border-radius:4px;border:1px solid #999;background:#f5f5f5;font-weight:600">🖨️ 打印成绩报表</button>
  </div>
  <h1>${esc(cls.name)} · 学生综合素质评价大表</h1>
  <div class="meta">生成日期：${stamp} · 参评学生人数：${students.length} 人 · 评价标准：五育并举 + 13科学业 + 日常表现</div>
  <table>
    <thead>
      <tr>
        <th>排名</th><th>学号</th><th>姓名</th><th>综合总分</th><th>评定等级</th>
        <th>德育</th><th>智育</th><th>体育</th><th>美育</th><th>劳育</th>
        <th>学科总评</th><th>日常积分</th>
      </tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
  </table>
</body>
</html>`;
      download(`${cls.name}-综合成绩报表-${stamp}.html`, html, 'text/html;charset=utf-8');
      toast('网页报表已导出，可离线在任何浏览器打开或打印', 'ok');
      break;
    }

    case 'export-csv': {
      const cls = curClass();
      if (!cls) { toast('还没有班级', 'bad'); break; }
      const cfg = store.getConfig();
      const { results } = reportFor(cls.id, SOURCES.TEACHER);
      const { rankMap } = rankBy(results, SCORE_OF.composite);
      const students = store.listStudents(cls.id);
      const rows = results
        .slice()
        .sort((a, b) => (rankMap.get(a.studentId) || 999) - (rankMap.get(b.studentId) || 999))
        .map((ev) => {
          const stu = students.find((s) => s.id === ev.studentId);
          const enriched = { ...ev, studentNo: stu ? stu.no : '', rank: rankMap.get(ev.studentId) || '' };
          return flattenForCsv(enriched, cfg);
        });
      if (!rows.length) { toast('没有可导出的数据', 'bad'); break; }
      const headers = Object.keys(rows[0]);
      const csv = [headers.join(','), ...rows.map((r) => headers.map((h) => {
        const v = r[h];
        const s = v == null ? '' : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      }).join(','))].join('\r\n');
      const stamp = new Date().toISOString().slice(0, 10);
      download(`${cls.name}-成绩表-${stamp}.csv`, '\uFEFF' + csv, 'text/csv;charset=utf-8');
      toast('成绩表已导出（含 BOM，Excel 直接打开不乱码）', 'ok');
      break;
    }

    case 'print':
      window.print();
      break;

    case 'load-demo': {
      if (store.listClasses().length
        && !window.confirm('载入演示数据会清空当前所有班级、学生与评分记录。继续？')) return;
      const c = store.loadDemo();
      state.classId = c.id;
      state.studentId = null;
      toast('已载入演示数据：初二(3)班 12 名学生', 'ok');
      render();
      break;
    }

    case 'reset': {
      if (!window.confirm('确定清空全部数据？班级、学生、所有评分记录都会被删除，且无法恢复。')) return;
      store.reset();
      state.classId = null;
      state.studentId = null;
      toast('已清空全部数据');
      render();
      break;
    }

    default:
      break;
  }
}

/* ---- 事件绑定（委托到 #shell，元素重渲染也不会丢） ---- */

shell.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  e.preventDefault();
  handleAction(btn.dataset.act, btn.dataset.arg || '', btn);
});

shell.addEventListener('input', (e) => {
  const el = e.target;
  if (el.dataset && el.dataset.write === 'cls') {
    suppressRender = true;
    try { writeClassField(el); } finally { suppressRender = false; }
    return;
  }
  if (!el.dataset || !el.dataset.write) return;
  suppressRender = true;
  try { writeField(el); } finally { suppressRender = false; }
  refreshDerived();
});

shell.addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset && el.dataset.write === 'cls') {
    writeClassField(el);
    scheduleRender();
    return;
  }
  if (!el.dataset || !el.dataset.write) return;
  writeField(el);
  scheduleRender();
});

store.subscribe(() => {
  if (suppressRender) return;
  scheduleRender();
});

/* ===================================================================== *
 * 16. 启动
 * ===================================================================== */

function boot() {
  const toasts = document.createElement('div');
  toasts.className = 'toasts';
  toasts.id = 'toasts';
  toasts.setAttribute('aria-live', 'polite');
  document.body.appendChild(toasts);

  // 首次打开：空库则载入演示数据，让整套流程可以立刻走通
  if (!store.listClasses().length) {
    try {
      const c = store.loadDemo();
      state.classId = c.id;
    } catch (e) {
      console.error('[boot] 演示数据载入失败', e);
    }
  }

  reconcile();
  render();

  window.__studentScoreReady = true;
  console.info(
    `%c学生综合评分系统%c 已就绪 · 存储：${store.label}`,
    'background:#6366f1;color:#fff;padding:2px 6px;border-radius:4px;font-weight:700',
    'color:#8b98b8',
  );
}

boot();
