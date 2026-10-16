/**
 * data.js — 数据层
 *
 * ⚠️ 当前状态：**云端未接入**，但数据会保存在本机浏览器里（localStorage）。
 *    · MemoryStore —— 会话内存，刷新即丢。测试用，也是存储不可用时的降级路径。
 *    · LocalStore  —— 本机持久化，默认走这条。刷新 / 关标签页 / 重开浏览器都不丢。
 *    · CloudStore  —— 云端，尚未接入。
 *
 * ⚠️ 本机保存的诚实边界（界面文案必须与此一致，不许说成「云端」）：
 *    数据只在**这一台设备的这一个浏览器**里 —— 换设备、换浏览器、清缓存都会丢，
 *    老师与学生之间也不会自动同步。无痕模式或禁用存储时自动退回会话内存并改口径。
 *
 * 云端接入点：见文件末尾 `CloudStore`。等云服务环境开通后，拿到 publicConfig，
 *    在 CloudStore.connect() 里按 SDK 文档接 auth + database 即可，上层 UI 与算分引擎无需改动。
 *
 * 数据结构（source 区分老师评分与学生自评，两套并列保存，便于做「自评 vs 师评」对照）：
 *   classes:  [{ id, name, grade, term, createdAt }]
 *   students: [{ id, classId, no, name, gender, group }]
 *   fives:    { 'stuId:source': { items: {de:{...}, zhi:{...}, ...}, updatedAt, by } }
 *   subjects: { 'stuId:source': { scores: { chinese:{usual,mid,final}, ... }, updatedAt, by } }
 *   daily:    { 'stuId:source': { entries: [{ key,label,delta,note,at }], updatedAt, by } }
 *   config:   见 model.js defaultConfig()
 */

import { defaultConfig, emptyFives, emptySubjects, SUBJECTS, FIVES, DEFAULT_DAILY_ITEMS } from './model.js';

export const SOURCES = { TEACHER: 'teacher', SELF: 'self' };
export const SOURCE_LABEL = { teacher: '教师评分', self: '学生自评' };

const key = (studentId, source) => `${studentId}:${source}`;

/* ------------------------------------------------------------------ *
 * 可播种随机数（mulberry32）—— 保证演示数据每次生成都一模一样
 * ------------------------------------------------------------------ */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ *
 * Store 接口约定
 * ------------------------------------------------------------------ */
/**
 * @typedef {Object} Store
 * @property {(cb:Function)=>()=>void} subscribe       订阅变更，返回取消订阅函数
 * @property {()=>Array}  listClasses
 * @property {(patch:Object)=>Object} createClass
 * @property {(id:string)=>Array} listStudents
 * @property {(patch:Object)=>Object} upsertStudent
 * @property {(id:string)=>void} removeStudent
 * @property {(classId:string)=>void} removeClass
 * @property {(studentId:string, source:string)=>({items:Object}|null)} getFives
 * @property {(studentId:string, source:string, items:Object)=>void} setFives
 * @property {(studentId:string, source:string)=>({scores:Object}|null)} getSubjects
 * @property {(studentId:string, source:string, scores:Object)=>void} setSubjects
 * @property {(studentId:string, source:string)=>({entries:Array}|null)} getDaily
 * @property {(studentId:string, source:string, entries:Array)=>void} setDaily
 * @property {(studentId:string, source:string, entry:Object)=>void} addDailyEntry
 * @property {(studentId:string, source:string, index:number)=>void} removeDailyEntry
 * @property {()=>Object} getConfig
 * @property {(patch:Object)=>void} setConfig
 * @property {()=>Object} snapshot      导出全部数据（JSON）
 * @property {(obj:Object)=>void} restore  导入数据
 * @property {()=>void} reset           清空
 * @property {string} mode              'memory' | 'cloud'
 * @property {string} label             给界面显示的一句话状态
 */

/* ------------------------------------------------------------------ *
 * MemoryStore —— 会话内存实现（刷新即重置）
 * ------------------------------------------------------------------ */
export class MemoryStore {
  constructor() {
    this.mode = 'memory';
    this.label = '云端未接入 · 数据仅存在于本次会话，刷新即重置';
    this.classes = [];
    this.students = [];
    this.fives = {};
    this.subjects = {};
    this.daily = {};
    this.config = defaultConfig();
    this._subs = new Set();
    this._seq = 0;
  }

  _id(prefix) {
    this._seq += 1;
    return `${prefix}_${Date.now().toString(36)}${this._seq.toString(36)}`;
  }

  _emit() {
    for (const cb of this._subs) {
      try { cb(); } catch (e) { console.error('[store] 订阅回调出错', e); }
    }
  }

  subscribe(cb) {
    this._subs.add(cb);
    return () => this._subs.delete(cb);
  }

  /* ---- 班级 ---- */
  listClasses() {
    return this.classes.map((c) => ({
      ...c,
      studentCount: this.students.filter((s) => s.classId === c.id).length,
    }));
  }

  createClass(patch) {
    const c = {
      id: patch.id || this._id('cls'),
      name: patch.name || '未命名班级',
      grade: patch.grade || '初二',
      term: patch.term || '2026 学年第一学期',
      createdAt: new Date().toISOString(),
    };
    this.classes.push(c);
    this._emit();
    return c;
  }

  updateClass(id, patch) {
    const c = this.classes.find((x) => x.id === id);
    if (!c) return null;
    Object.assign(c, patch, { id: c.id }); // id 不可被覆盖
    this._emit();
    return c;
  }

  removeClass(classId) {
    const ids = this.students.filter((s) => s.classId === classId).map((s) => s.id);
    this.classes = this.classes.filter((c) => c.id !== classId);
    this.students = this.students.filter((s) => s.classId !== classId);
    for (const id of ids) this._dropStudentRecords(id);
    this._emit();
  }

  /* ---- 学生 ---- */
  listStudents(classId) {
    return this.students
      .filter((s) => !classId || s.classId === classId)
      .sort((a, b) => String(a.no).localeCompare(String(b.no), 'zh'));
  }

  upsertStudent(patch) {
    if (patch.id) {
      const i = this.students.findIndex((s) => s.id === patch.id);
      if (i >= 0) {
        this.students[i] = { ...this.students[i], ...patch };
        this._emit();
        return this.students[i];
      }
    }
    const s = {
      id: patch.id || this._id('stu'),
      classId: patch.classId,
      no: patch.no || String(this.students.filter((x) => x.classId === patch.classId).length + 1).padStart(2, '0'),
      name: patch.name || '未命名',
      gender: patch.gender || '',
      group: patch.group || '',
    };
    this.students.push(s);
    this._emit();
    return s;
  }

  removeStudent(id) {
    this.students = this.students.filter((s) => s.id !== id);
    this._dropStudentRecords(id);
    this._emit();
  }

  _dropStudentRecords(studentId) {
    for (const bag of [this.fives, this.subjects, this.daily]) {
      for (const k of Object.keys(bag)) if (k.startsWith(studentId + ':')) delete bag[k];
    }
  }

  /* ---- 五育 ---- */
  getFives(studentId, source = SOURCES.TEACHER) {
    return this.fives[key(studentId, source)] || null;
  }

  setFives(studentId, source, items) {
    this.fives[key(studentId, source)] = { items, updatedAt: new Date().toISOString(), by: source };
    this._emit();
  }

  /* ---- 学科 ---- */
  getSubjects(studentId, source = SOURCES.TEACHER) {
    return this.subjects[key(studentId, source)] || null;
  }

  setSubjects(studentId, source, scores) {
    this.subjects[key(studentId, source)] = { scores, updatedAt: new Date().toISOString(), by: source };
    this._emit();
  }

  /* ---- 日常 ---- */
  getDaily(studentId, source = SOURCES.TEACHER) {
    return this.daily[key(studentId, source)] || null;
  }

  setDaily(studentId, source, entries) {
    this.daily[key(studentId, source)] = { entries, updatedAt: new Date().toISOString(), by: source };
    this._emit();
  }

  addDailyEntry(studentId, source, entry) {
    const cur = this.getDaily(studentId, source);
    const entries = cur ? cur.entries.slice() : [];
    entries.push({
      key: entry.key || this._id('de'),
      label: entry.label || '自定义',
      delta: Number(entry.delta) || 0,
      note: entry.note || '',
      at: new Date().toISOString(),
    });
    this.setDaily(studentId, source, entries);
  }

  removeDailyEntry(studentId, source, index) {
    const cur = this.getDaily(studentId, source);
    if (!cur) return;
    const entries = cur.entries.slice();
    entries.splice(index, 1);
    this.setDaily(studentId, source, entries);
  }

  /* ---- 配置 ---- */
  getConfig() {
    return this.config;
  }

  setConfig(patch) {
    this.config = { ...this.config, ...patch };
    this._emit();
  }

  /* ---- 导入导出 ---- */
  snapshot() {
    return {
      schemaVersion: this.config.schemaVersion,
      exportedAt: new Date().toISOString(),
      classes: JSON.parse(JSON.stringify(this.classes)),
      students: JSON.parse(JSON.stringify(this.students)),
      fives: JSON.parse(JSON.stringify(this.fives)),
      subjects: JSON.parse(JSON.stringify(this.subjects)),
      daily: JSON.parse(JSON.stringify(this.daily)),
      config: JSON.parse(JSON.stringify(this.config)),
    };
  }

  restore(obj) {
    if (!obj || typeof obj !== 'object') throw new Error('文件内容不是有效的导出数据');
    this.classes = obj.classes || [];
    this.students = obj.students || [];
    this.fives = obj.fives || {};
    this.subjects = obj.subjects || {};
    this.daily = obj.daily || {};
    this.config = { ...defaultConfig(), ...(obj.config || {}) };
    this._emit();
  }

  reset() {
    this.classes = [];
    this.students = [];
    this.fives = {};
    this.subjects = {};
    this.daily = {};
    this.config = defaultConfig();
    this._emit();
  }

  /* ---- 演示数据 ---- */
  loadDemo() {
    this.reset();
    const rnd = mulberry32(20261016);

    const cls = this.createClass({ name: '初二(3)班', grade: '初二', term: '2026 学年第一学期' });

    const names = [
      ['01', '陈知远', '男', 'A 组'], ['02', '林晚晴', '女', 'A 组'],
      ['03', '周立行', '男', 'B 组'], ['04', '苏亦然', '女', 'B 组'],
      ['05', '黄予安', '男', 'C 组'], ['06', '许听澜', '女', 'C 组'],
      ['07', '郑一诺', '男', 'A 组'], ['08', '何星辞', '女', 'B 组'],
      ['09', '罗嘉树', '男', 'C 组'], ['10', '叶清和', '女', 'A 组'],
      ['11', '谢望舒', '男', 'B 组'], ['12', '孟雨棠', '女', 'C 组'],
    ];

    const students = names.map(([no, name, gender, group]) =>
      this.upsertStudent({ classId: cls.id, no, name, gender, group }));

    // 每位学生一个「基础水平」+ 各维度噪声，让分布像真实班级
    students.forEach((stu, idx) => {
      const base = 72 + rnd() * 22; // 72~94

      // 故意留两位「自我评价偏低」的学生，让「自评 vs 师评对照」两个方向都有样本
      const harsh = idx === 2 || idx === 9;

      /* 五育：老师评分 */
      const tItems = emptyFives();
      for (const f of FIVES) {
        for (const it of f.items) {
          const bias = f.key === 'zhi' ? 2 : f.key === 'ti' ? -1 : 0;
          tItems[f.key][it.key] = Math.round(Math.min(100, Math.max(50, base + bias + (rnd() - 0.5) * 14)));
        }
      }
      this.setFives(stu.id, SOURCES.TEACHER, tItems);

      /* 五育：学生自评（多数略高，少数偏低） */
      const sItems = emptyFives();
      for (const f of FIVES) {
        for (const it of f.items) {
          const selfBias = harsh
            ? -(3 + rnd() * 5)
            : (rnd() < 0.2 ? -3 : 3 + rnd() * 4);
          sItems[f.key][it.key] = Math.round(Math.min(100, Math.max(40, tItems[f.key][it.key] + selfBias)));
        }
      }
      this.setFives(stu.id, SOURCES.SELF, sItems);

      /* 学科：老师录入 平时/期中/期末 */
      const tScores = emptySubjects();
      for (const s of SUBJECTS) {
        const skew = ['chinese', 'math', 'english'].includes(s.key) ? 0 : -3;
        const mk = () => Math.round(Math.min(100, Math.max(45, base + skew + (rnd() - 0.5) * 16)));
        tScores[s.key] = { usual: mk(), mid: mk(), final: mk() };
      }
      this.setSubjects(stu.id, SOURCES.TEACHER, tScores);

      /* 日常表现：老师记的流水 */
      const pool = DEFAULT_DAILY_ITEMS;
      const n = 3 + Math.floor(rnd() * 5);
      for (let i = 0; i < n; i++) {
        const it = pool[Math.floor(rnd() * pool.length)];
        this.addDailyEntry(stu.id, SOURCES.TEACHER, { ...it });
      }

      /* 日常表现：学生自述
       * 自评偏低的那两位不给自己记日常加分 —— 这样他们的自评综合分与师评的差距
       * 会明显偏负，与「多数学生自评偏高」形成对照，功能演示两个方向都能看到。 */
      if (!harsh) {
        this.addDailyEntry(stu.id, SOURCES.SELF, { ...pool[1] });
        this.addDailyEntry(stu.id, SOURCES.SELF, { ...pool[6] });
      }
    });

    return cls;
  }
}

/* ------------------------------------------------------------------ *
 * CloudStore —— 云端实现（**尚未接入**）
 * ------------------------------------------------------------------ */
/**
 * 接入步骤（云服务环境开通后）：
 *   1. 拿到 publicConfig = { resourceId, endpoint, oauthRelayBaseUrl, publishableKey }
 *   2. 按 cloud-service 技能的 `references/database/code-generation.md` 与
 *      `references/auth/code-generation.md` 初始化 SDK 客户端（endpoint + publishableKey 必传，
 *      web 端还要传 oauthRelayBaseUrl）
 *   3. 建四张表：classes / students / fives / subjects / daily / config
 *      —— 每张表都带 ownerId（老师）与 classId，读写一律带身份约束，禁止跨用户读取
 *   4. 把下面每个方法换成对应的 SDK 调用，保持签名不变，UI 与算分引擎无需改动
 *
 * ⚠️ 在拿到 publicConfig 之前，这里**不会**凭空造一个环境 id 或写死 endpoint。
 */
export class CloudStore {
  constructor() {
    this.mode = 'cloud';
    this.label = '云端环境尚未开通';
  }

  static connect(/* publicConfig */) {
    throw new Error('云端环境尚未开通：请先开通云服务，再接入登录与数据保存。');
  }
}

/* ------------------------------------------------------------------ *
 * LocalStore —— 本机持久化（localStorage）
 * ------------------------------------------------------------------ */
/**
 * 与 MemoryStore 的唯一区别：每次变更后把整份快照写进 localStorage，启动时读回来。
 * 所以刷新、关标签页、重开浏览器都不会丢 —— 这是本机保存，不是云存储。
 */
export const STORAGE_KEY = 'dx_student_score_v1';

export class LocalStore extends MemoryStore {
  constructor(storageKey = STORAGE_KEY) {
    super();
    this.mode = 'local';
    this.label = '本机保存 · 数据存在这台设备的浏览器里，刷新不丢；换设备或清缓存会丢失';
    this.storageKey = storageKey;
    this._suspend = false;
    this._hydrate();
  }

  /** 启动时读回上次的数据。解析失败就按空数据启动，不抛错、不静默清库。 */
  _hydrate() {
    let raw = null;
    try { raw = localStorage.getItem(this.storageKey); } catch (e) { raw = null; }
    if (!raw) return;
    try {
      const obj = JSON.parse(raw);
      if (!obj || typeof obj !== 'object') return;
      this.classes = Array.isArray(obj.classes) ? obj.classes : [];
      this.students = Array.isArray(obj.students) ? obj.students : [];
      this.fives = obj.fives && typeof obj.fives === 'object' ? obj.fives : {};
      this.subjects = obj.subjects && typeof obj.subjects === 'object' ? obj.subjects : {};
      this.daily = obj.daily && typeof obj.daily === 'object' ? obj.daily : {};
      this.config = { ...defaultConfig(), ...(obj.config || {}) };
    } catch (e) {
      console.warn('[store] 本机数据解析失败，按空数据启动（原数据未删除）', e);
    }
  }

  /** 写盘。配额用尽或禁用存储时如实降级到会话内存，不假装保存成功。 */
  _persist() {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.snapshot()));
      return true;
    } catch (e) {
      this.mode = 'memory';
      this.label = '本机保存失败（存储空间不足或浏览器禁用）· 数据仅存在于本次会话，刷新即重置';
      console.warn('[store] 本机保存失败，退回会话内存', e);
      return false;
    }
  }

  _emit() {
    if (!this._suspend) this._persist();
    super._emit();
  }

  /** 批量操作（载入演示 / 导入备份）期间挂起写盘，结束后一次性落盘 */
  _batch(fn) {
    this._suspend = true;
    try { return fn(); } finally { this._suspend = false; this._persist(); }
  }

  loadDemo() { return this._batch(() => super.loadDemo()); }

  restore(obj) { return this._batch(() => super.restore(obj)); }

  /** 只清本机存储，不动内存里的当前数据（「清空全部数据」走的是 reset()） */
  clearStorage() {
    try { localStorage.removeItem(this.storageKey); } catch (e) { /* 忽略 */ }
  }
}

/** 能写 localStorage 就用 LocalStore，否则退回会话内存（无痕模式等） */
export function createStore() {
  try {
    const probe = '__dx_storage_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return new LocalStore();
  } catch (e) {
    return new MemoryStore();
  }
}

/* ------------------------------------------------------------------ *
 * 单例
 * ------------------------------------------------------------------ */
export const store = createStore();
