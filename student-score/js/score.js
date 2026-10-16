/**
 * score.js — 纯计算引擎（无 DOM、无副作用，可单独跑测试）
 *
 * 设计原则：
 *   · 任何一项缺数据都不编造 —— 缺失项不参与加权，权重在**实际有分的项**上重新归一化
 *   · 每个结果都带 coverage（实际参与计算的项 / 应有项），界面据此标注「基于 2/3 个维度」
 *   · 同一份输入永远得到同一份输出
 */

import { FIVES, SUBJECTS, DIMENSIONS, gradeOf } from './model.js';

/* ---------------------------- 基础工具 ---------------------------- */

export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

export function round(v, digits = 2) {
  if (!isNum(v)) return null;
  const p = 10 ** digits;
  return Math.round(v * p) / p;
}

/** 把权重表归一化成总和 1；只保留权重大于 0 的键 */
export function normalizeWeights(weights, keys) {
  const ks = (keys || Object.keys(weights || {})).filter((k) => (weights[k] || 0) > 0);
  const sum = ks.reduce((a, k) => a + weights[k], 0);
  if (!sum) return { weights: {}, keys: [], sum: 0 };
  const out = {};
  for (const k of ks) out[k] = weights[k] / sum;
  return { weights: out, keys: ks, sum };
}

/**
 * 有效权重：只在「实际有值且权重>0」的项上归一化。
 *
 * ⚠️ 与 normalizeWeights 的区别很关键：normalizeWeights 只看权重表（名义权重），
 *    本函数只看真正参与了计算的项（有效权重）。某个维度没数据时它不参与计算，
 *    剩下的维度权重会变大 —— 界面上要显示的就是这个「有效权重」，
 *    否则会出现「写着五育占 40%，实际算了 66.7%」这种误导。
 */
export function effectiveWeights(pairs) {
  const usable = pairs.filter((p) => isNum(p.value) && p.weight > 0);
  const sum = usable.reduce((a, p) => a + p.weight, 0);
  if (!sum) return {};
  const out = {};
  for (const p of usable) out[p.key] = p.weight / sum;
  return out;
}

/** 加权平均：只在「有值且权重>0」的项上归一化。返回 null 表示一个可用项都没有 */
export function weightedMean(pairs) {
  // pairs: [{ key, value, weight }]
  const usable = pairs.filter((p) => isNum(p.value) && p.weight > 0);
  if (!usable.length) return null;
  const wsum = usable.reduce((a, p) => a + p.weight, 0);
  return usable.reduce((a, p) => a + p.value * p.weight, 0) / wsum;
}

/* ---------------------------- 一、五育 ---------------------------- */

/** 某一育的得分 = 该育下所有「已评细项」的算术平均 */
export function fivesDimScore(items, dimKey) {
  const dim = FIVES.find((f) => f.key === dimKey);
  if (!dim) return null;
  const vals = dim.items.map((it) => (items && items[dimKey] ? items[dimKey][it.key] : null)).filter(isNum);
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

/** 某一育的填写覆盖度 */
export function fivesDimCoverage(items, dimKey) {
  const dim = FIVES.find((f) => f.key === dimKey);
  if (!dim) return { filled: 0, total: 0 };
  const filled = dim.items.filter((it) => isNum(items && items[dimKey] ? items[dimKey][it.key] : null)).length;
  return { filled, total: dim.items.length };
}

/**
 * 五育总分
 * @returns {{ score:number|null, dims:Object, coverage:{filled:number,total:number},
 *            weights:Object, hasData:boolean }}
 *   weights 是**有效权重**（只在有分的育上归一化），hasData = 至少有一个细项评过分
 */
export function fivesTotal(items, fivesWeights) {
  const dims = {};
  const pairs = [];
  let filled = 0;
  let total = 0;

  for (const f of FIVES) {
    const s = fivesDimScore(items, f.key);
    dims[f.key] = s;
    pairs.push({ key: f.key, value: s, weight: fivesWeights[f.key] || 0 });
    const c = fivesDimCoverage(items, f.key);
    filled += c.filled;
    total += c.total;
  }

  const score = weightedMean(pairs);
  return {
    score: round(score),
    dims,
    coverage: { filled, total },
    weights: effectiveWeights(pairs),
    hasData: filled > 0,
  };
}

/* ---------------------------- 二、学科成绩 ---------------------------- */

/** 单科学期成绩 = 平时×w1 + 期中×w2 + 期末×w3（缺项时在实有项上归一化） */
export function subjectTermScore(parts, termWeights) {
  const pairs = [
    { key: 'usual', value: parts ? parts.usual : null, weight: termWeights.usual || 0 },
    { key: 'mid', value: parts ? parts.mid : null, weight: termWeights.mid || 0 },
    { key: 'final', value: parts ? parts.final : null, weight: termWeights.final || 0 },
  ];
  const v = weightedMean(pairs);
  return round(v);
}

/**
 * 学科总分：各科「学期成绩」按科目权重加权（只算有成绩且权重>0 的科目）
 * @returns {{ score:number|null, subjects:Object, coverage:{filled:number,total:number},
 *            weights:Object, usedWeight:number, hasData:boolean }}
 *   weights 是**有效权重**（只在有分的科目上归一化）
 */
export function subjectTotal(scores, subjectWeights, termWeights) {
  const subjects = {};
  const pairs = [];
  let filled = 0;
  let activeTotal = 0;

  for (const s of SUBJECTS) {
    const w = subjectWeights[s.key] || 0;
    const term = subjectTermScore(scores ? scores[s.key] : null, termWeights);
    subjects[s.key] = term;
    if (w > 0) activeTotal += 1;
    if (isNum(term) && w > 0) filled += 1;
    pairs.push({ key: s.key, value: term, weight: w });
  }

  const score = weightedMean(pairs);
  const usedWeight = pairs.filter((p) => isNum(p.value) && p.weight > 0).reduce((a, p) => a + p.weight, 0);
  return {
    score: round(score),
    subjects,
    coverage: { filled, total: activeTotal },
    weights: effectiveWeights(pairs),
    usedWeight: round(usedWeight, 2),
    hasData: filled > 0,
  };
}

/* ---------------------------- 三、日常表现 ---------------------------- */

/**
 * 日常表现分 = 基础分 + 流水净加分，钳制在 [min,max]
 *
 * ⚠️ hasData 的含义：**「有没有记录过」**，而不是「分数是不是 0」。
 *    基础分 100 是一条计分规则，不代表老师已经评过这个学生。
 *    一条流水都没有时 score 仍然是 100（这是口径，界面照常显示），
 *    但 hasData=false —— 综合分不该用一个「谁都没评过」的默认分去顶替缺失维度，
 *    否则一个完全没被评过的学生会被算成 100 分「优秀」。
 *
 * @returns {{ score, raw, net, plus, minus, count, clamped, hasData }}
 */
export function dailyScore(entries, cfg) {
  const list = Array.isArray(entries) ? entries : [];
  const net = list.reduce((a, e) => a + (isNum(e.delta) ? e.delta : 0), 0);
  const base = isNum(cfg.dailyBase) ? cfg.dailyBase : 100;
  const raw = base + net;
  const lo = isNum(cfg.dailyMin) ? cfg.dailyMin : 0;
  const hi = isNum(cfg.dailyMax) ? cfg.dailyMax : 120;
  return {
    score: round(clamp(raw, lo, hi)),
    raw: round(raw),
    net: round(net),
    plus: round(list.filter((e) => e.delta > 0).reduce((a, e) => a + e.delta, 0)),
    minus: round(list.filter((e) => e.delta < 0).reduce((a, e) => a + e.delta, 0)),
    count: list.length,
    clamped: raw !== clamp(raw, lo, hi),
    hasData: list.length > 0,
  };
}

/* ---------------------------- 四、综合评分 ---------------------------- */

/**
 * 综合分 = 三维加权；缺失维度不参与，权重在实有维度上重新归一化
 * @returns {{ score:number|null, parts:Object, coverage:{filled:number,total:number},
 *            weights:Object, complete:boolean }}
 *   weights 是**有效权重**（只在真正参与计算的维度上归一化）
 */
export function composite(partScores, dimWeights) {
  const pairs = DIMENSIONS.map((d) => ({ key: d.key, value: partScores[d.key], weight: dimWeights[d.key] || 0 }));
  const score = weightedMean(pairs);
  const filled = pairs.filter((p) => isNum(p.value) && p.weight > 0).length;
  const total = pairs.filter((p) => p.weight > 0).length;
  return {
    score: round(score),
    parts: { ...partScores },
    coverage: { filled, total },
    weights: effectiveWeights(pairs),
    complete: total > 0 && filled === total,
  };
}

/* ---------------------------- 五、一次性算完一个学生 ---------------------------- */

/**
 * @param {{ student, fives, subjects, daily }} bundle  某学生的一套原始数据
 * @param {object} cfg  配置
 * @returns 完整计算结果
 *
 * ⚠️ composite 用的是「实际计入」的维度值：某维度 hasData=false 时传 null，
 *    不参与加权。fives/subject/daily 三个字段仍然保留各自的口径分数，
 *    界面可以照常显示（例如日常基础分 100），但要说明它未计入。
 */
export function evaluate(bundle, cfg) {
  const fivesItems = bundle.fives ? bundle.fives.items : null;
  const fives = fivesTotal(fivesItems, cfg.fivesWeights);
  const subject = subjectTotal(bundle.subjects ? bundle.subjects.scores : null, cfg.subjectWeights, cfg.termWeights);
  const daily = dailyScore(bundle.daily ? bundle.daily.entries : [], cfg);

  const comp = composite({
    fives: fives.hasData ? fives.score : null,
    subject: subject.hasData ? subject.score : null,
    daily: daily.hasData ? daily.score : null,
  }, cfg.dimWeights);

  const g = gradeOf(comp.score);
  return {
    studentId: bundle.student ? bundle.student.id : null,
    name: bundle.student ? bundle.student.name : '',
    fives,
    subject,
    daily,
    composite: comp,
    grade: g.grade,
    gradeLabel: g.label,
    gradeCls: g.cls,
  };
}

/** 批量评估 */
export function evaluateAll(bundles, cfg) {
  return bundles.map((b) => evaluate(b, cfg));
}

/* ---------------------------- 六、排名与统计 ---------------------------- */

/**
 * 竞赛排名法（并列同名次，名次跳号）：95,95,90 → 1,1,3
 * @param {Array<{studentId:string, score:number|null}>} list
 */
export function rankBy(list, scoreOf) {
  const rows = list.map((item) => ({ item, score: scoreOf(item) }));
  const scored = rows.filter((r) => isNum(r.score)).sort((a, b) => b.score - a.score);
  const rankMap = new Map();
  let lastScore = null;
  let lastRank = 0;
  scored.forEach((r, i) => {
    const rank = r.score === lastScore ? lastRank : i + 1;
    lastScore = r.score;
    lastRank = rank;
    rankMap.set(r.item.studentId, rank);
  });
  return { rankMap, ranked: scored, unscored: rows.filter((r) => !isNum(r.score)).map((r) => r.item) };
}

export function stats(values) {
  const v = (values || []).filter(isNum).slice().sort((a, b) => a - b);
  if (!v.length) return { n: 0, mean: null, median: null, sd: null, min: null, max: null, p25: null, p75: null };
  const n = v.length;
  const mean = v.reduce((a, b) => a + b, 0) / n;
  const median = n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2;
  // 样本标准差用 n−1（与站内其它页口径一致）
  const sd = n > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : null;
  const q = (p) => {
    const pos = (n - 1) * p;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return lo === hi ? v[lo] : v[lo] + (v[hi] - v[lo]) * (pos - lo);
  };
  return {
    n,
    mean: round(mean),
    median: round(median),
    sd: round(sd),
    min: round(v[0]),
    max: round(v[n - 1]),
    p25: round(q(0.25)),
    p75: round(q(0.75)),
  };
}

/** 直方图分箱：返回 [{ from, to, count, ratio }] */
export function histogram(values, binSize = 5, lo = 0, hi = 100) {
  const v = (values || []).filter(isNum);
  const bins = [];
  for (let from = lo; from < hi; from += binSize) {
    const to = Math.min(from + binSize, hi);
    const count = v.filter((x) => x >= from && (to === hi ? x <= to : x < to)).length;
    bins.push({ from, to, count, ratio: v.length ? count / v.length : 0 });
  }
  return bins;
}

/** 自评与师评的差异（用于「自评 vs 师评」对照） */
export function gap(selfScore, teacherScore) {
  if (!isNum(selfScore) || !isNum(teacherScore)) return null;
  const d = round(selfScore - teacherScore);
  // 文案里用 1 位小数，和界面其它地方的 fmt1 保持一致（6.82 不该显示成 6.82）
  const a = round(Math.abs(d), 1);
  const level = Math.abs(d) <= 3 ? 'consistent' : d > 0 ? 'over' : 'under';
  return {
    diff: d,
    abs: Math.abs(d),
    level,
    label: level === 'consistent' ? '基本一致' : d > 0 ? `自评偏高 ${a}` : `自评偏低 ${a}`,
  };
}

/** 导出用：把一行结果拍平成 CSV 行 */
export function flattenForCsv(ev, cfg) {
  const row = {
    学号: ev.studentNo || '',
    姓名: ev.name || '',
    综合分: ev.composite.score ?? '',
    等级: ev.grade || '',
    综合排名: ev.rank ?? '',
    五育总分: ev.fives.score ?? '',
    学科总分: ev.subject.score ?? '',
    日常表现: ev.daily.score ?? '',
  };
  for (const f of FIVES) row[`${f.name}育`] = ev.fives.dims[f.key] ?? '';
  for (const s of SUBJECTS) {
    if ((cfg.subjectWeights[s.key] || 0) > 0) row[s.name] = ev.subject.subjects[s.key] ?? '';
  }
  return row;
}
