/**
 * model.js — 领域模型与默认口径
 *
 * 三套评分口径：
 *   1) 五育并举（德/智/体/美/劳）—— 每育若干细项，细项均分 → 育分，育分加权 → 五育总分
 *   2) 学科成绩 —— 每科「平时 + 期中 + 期末」加权 → 单科成绩，再按科目权重 → 学科总分
 *   3) 日常表现积分 —— 基础分 + 加减分流水 → 日常表现分
 *
 * 综合评分 = 五育总分 × W1 + 学科总分 × W2 + 日常表现分 × W3（三维权重可调，自动归一化）
 * 单独评分 = ① 单维度看全班分布与榜单  ② 单个学生看完整成绩单
 *
 * 所有默认值都只是「出厂设置」，老师可在「权重设置」里改；改了立刻重算，不改动原始打分。
 */

export const SCHEMA_VERSION = 1;

/* ------------------------------------------------------------------ *
 * 一、五育并举
 * ------------------------------------------------------------------ */
export const FIVES = [
  {
    key: 'de', name: '德', full: '德育', color: 'var(--five-de)',
    desc: '品行、纪律、责任与公德',
    items: [
      { key: 'de-rule', name: '遵规守纪', hint: '校规校纪、课堂纪律' },
      { key: 'de-honest', name: '诚实守信', hint: '作业与考试诚信、言行一致' },
      { key: 'de-manner', name: '文明礼貌', hint: '礼貌用语、仪容仪表、尊重他人' },
      { key: 'de-team', name: '集体责任', hint: '班级事务、值日、集体活动' },
      { key: 'de-help', name: '助人友善', hint: '帮助同学、志愿服务' },
    ],
  },
  {
    key: 'zhi', name: '智', full: '智育', color: 'var(--five-zhi)',
    desc: '学习态度、方法与学业表现',
    items: [
      { key: 'zhi-attitude', name: '学习态度', hint: '专注度、主动性、求知欲' },
      { key: 'zhi-class', name: '课堂参与', hint: '发言、提问、讨论与合作' },
      { key: 'zhi-homework', name: '作业质量', hint: '完成度、正确率、书写规范' },
      { key: 'zhi-method', name: '学习方法', hint: '笔记、复习、错题整理、时间管理' },
      { key: 'zhi-extend', name: '拓展探究', hint: '课外阅读、竞赛、研究性学习' },
    ],
  },
  {
    key: 'ti', name: '体', full: '体育', color: 'var(--five-ti)',
    desc: '体质健康与运动习惯',
    items: [
      { key: 'ti-fitness', name: '体质健康', hint: '体测成绩、身体素质' },
      { key: 'ti-pe', name: '体育课表现', hint: '参与度、技能掌握、团队配合' },
      { key: 'ti-skill', name: '运动技能', hint: '专项技能、校队或社团参与' },
      { key: 'ti-habit', name: '锻炼习惯', hint: '课间操、跑操、课外锻炼' },
      { key: 'ti-mind', name: '心理韧性', hint: '抗压、情绪调节、抗挫折' },
    ],
  },
  {
    key: 'mei', name: '美', full: '美育', color: 'var(--five-mei)',
    desc: '审美感受与艺术表达',
    items: [
      { key: 'mei-course', name: '艺术课程', hint: '音乐 / 美术课参与与表现' },
      { key: 'mei-taste', name: '审美表达', hint: '发现美、评价美、表达感受' },
      { key: 'mei-activity', name: '艺术活动', hint: '文艺演出、书画展览、社团' },
      { key: 'mei-create', name: '创意实践', hint: '原创作品、设计、跨学科创作' },
    ],
  },
  {
    key: 'lao', name: '劳', full: '劳动教育', color: 'var(--five-lao)',
    desc: '劳动观念、技能与习惯',
    items: [
      { key: 'lao-course', name: '劳动课程', hint: '劳动课参与与任务完成' },
      { key: 'lao-school', name: '校园劳动', hint: '值日、大扫除、绿植养护' },
      { key: 'lao-home', name: '家务劳动', hint: '家庭劳动清单完成情况' },
      { key: 'lao-practice', name: '劳动实践', hint: '社会实践、研学、志愿劳动' },
      { key: 'lao-skill', name: '劳动技能', hint: '动手能力、工具使用、生活技能' },
    ],
  },
];

export const FIVES_KEYS = FIVES.map((f) => f.key);

/** 五育默认权重（%，总和 100） */
export const DEFAULT_FIVES_WEIGHTS = { de: 25, zhi: 35, ti: 20, mei: 10, lao: 10 };

/* ------------------------------------------------------------------ *
 * 二、学科成绩
 * ------------------------------------------------------------------ */
export const SUBJECTS = [
  { key: 'chinese', name: '语文', weight: 1.0 },
  { key: 'math', name: '数学', weight: 1.0 },
  { key: 'english', name: '英语', weight: 1.0 },
  { key: 'physics', name: '物理', weight: 0.8 },
  { key: 'chemistry', name: '化学', weight: 0.8 },
  { key: 'biology', name: '生物学', weight: 0.6 },
  { key: 'politics', name: '道德与法治', weight: 0.6 },
  { key: 'history', name: '历史', weight: 0.6 },
  { key: 'geography', name: '地理', weight: 0.6 },
  { key: 'pe', name: '体育与健康', weight: 0.5 },
  { key: 'music', name: '音乐', weight: 0.3 },
  { key: 'art', name: '美术', weight: 0.3 },
  { key: 'it', name: '信息科技', weight: 0.3 },
];

export const SUBJECT_KEYS = SUBJECTS.map((s) => s.key);

/** 单科内部：平时 / 期中 / 期末 占比（%，总和 100） */
export const DEFAULT_TERM_WEIGHTS = { usual: 30, mid: 30, final: 40 };

/** 等级换算（按综合分或单项分套用同一套阈值） */
export const GRADE_SCALE = [
  { min: 95, grade: 'A+', label: '优秀', cls: 'g-a-plus' },
  { min: 90, grade: 'A', label: '优秀', cls: 'g-a' },
  { min: 85, grade: 'B+', label: '良好', cls: 'g-b-plus' },
  { min: 80, grade: 'B', label: '良好', cls: 'g-b' },
  { min: 75, grade: 'C+', label: '中等', cls: 'g-c-plus' },
  { min: 70, grade: 'C', label: '中等', cls: 'g-c' },
  { min: 60, grade: 'D', label: '及格', cls: 'g-d' },
  { min: -Infinity, grade: 'E', label: '待提升', cls: 'g-e' },
];

/* ------------------------------------------------------------------ *
 * 三、日常表现积分
 * ------------------------------------------------------------------ */
/** 默认积分项（可增删改；delta 为分值，正加负减） */
export const DEFAULT_DAILY_ITEMS = [
  { key: 'd-speak', label: '课堂发言积极', delta: 1, cat: 'plus' },
  { key: 'd-homework', label: '作业全优', delta: 2, cat: 'plus' },
  { key: 'd-help', label: '助人为乐', delta: 2, cat: 'plus' },
  { key: 'd-duty', label: '主动承担值日', delta: 1, cat: 'plus' },
  { key: 'd-progress', label: '进步显著', delta: 3, cat: 'plus' },
  { key: 'd-award', label: '竞赛 / 评比获奖', delta: 5, cat: 'plus' },
  { key: 'd-activity', label: '积极参与班级活动', delta: 2, cat: 'plus' },
  { key: 'd-late', label: '迟到早退', delta: -2, cat: 'minus' },
  { key: 'd-nohw', label: '未交作业', delta: -3, cat: 'minus' },
  { key: 'd-discipline', label: '课堂违纪', delta: -2, cat: 'minus' },
  { key: 'd-uniform', label: '仪容仪表不合规', delta: -1, cat: 'minus' },
  { key: 'd-phone', label: '违规使用手机', delta: -3, cat: 'minus' },
];

/* ------------------------------------------------------------------ *
 * 四、综合评分的三维权重
 * ------------------------------------------------------------------ */
export const DEFAULT_DIM_WEIGHTS = { fives: 40, subject: 40, daily: 20 };

export const DIMENSIONS = [
  { key: 'fives', name: '五育并举', short: '五育', desc: '德智体美劳综合素质' },
  { key: 'subject', name: '学科成绩', short: '学科', desc: '平时 / 期中 / 期末加权' },
  { key: 'daily', name: '日常表现', short: '日常', desc: '积分制加减分' },
];

/* ------------------------------------------------------------------ *
 * 出厂配置
 * ------------------------------------------------------------------ */
export function defaultConfig() {
  return {
    schemaVersion: SCHEMA_VERSION,
    fivesWeights: { ...DEFAULT_FIVES_WEIGHTS },
    termWeights: { ...DEFAULT_TERM_WEIGHTS },
    subjectWeights: Object.fromEntries(SUBJECTS.map((s) => [s.key, s.weight])),
    dimWeights: { ...DEFAULT_DIM_WEIGHTS },
    dailyBase: 100,
    dailyMin: 0,
    dailyMax: 120,
    dailyItems: DEFAULT_DAILY_ITEMS.map((d) => ({ ...d })),
  };
}

/* ------------------------------------------------------------------ *
 * 小工具
 * ------------------------------------------------------------------ */
export function emptyFives() {
  const out = {};
  for (const f of FIVES) {
    out[f.key] = {};
    for (const it of f.items) out[f.key][it.key] = null; // null = 未评
  }
  return out;
}

export function emptySubjects() {
  const out = {};
  for (const s of SUBJECTS) out[s.key] = { usual: null, mid: null, final: null };
  return out;
}

export function subjectName(key) {
  const s = SUBJECTS.find((x) => x.key === key);
  return s ? s.name : key;
}

export function fivesMeta(key) {
  return FIVES.find((f) => f.key === key) || null;
}

export function gradeOf(score) {
  if (score == null || Number.isNaN(score)) return { grade: '—', label: '未评', cls: 'g-none' };
  for (const g of GRADE_SCALE) if (score >= g.min) return g;
  return GRADE_SCALE[GRADE_SCALE.length - 1];
}
