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

function viewGrade() {
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
      <div class="card-foot">
        <button class="btn btn-primary btn-sm" type="button" data-act="export-json">导出备份（JSON）</button>
        <button class="btn btn-sm" type="button" data-act="import-json">导入备份</button>
        <button class="btn btn-sm" type="button" data-act="export-csv">导出成绩表（CSV）</button>
        <button class="btn btn-sm" type="button" data-act="print">打印 / 存 PDF</button>
        <span class="row-end"></span>
        <button class="btn btn-sm" type="button" data-act="load-demo">重新载入演示数据</button>
        <button class="btn btn-sm btn-danger" type="button" data-act="reset">清空全部数据</button>
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
