/* ==========================================================================
   daixuan.cloud · 数据实验室 (stats-lab) · js/i18n.js
   双语文案表 + 静态文本应用器。零依赖、无构建步骤。

   设计取舍
   --------
   1. HTML 里的中文是「正本」：默认语言仍是中文，SEO / 禁用 JS 时看到的都是它。
      英文只在用户显式切换（或带 ?lang=en）时才由本文件覆盖上去。
   2. 本文件必须排在 js/lab.js 之前，且两者都是 defer —— defer 按顺序执行，
      所以 lab.js 启动时 SL_I18N 已就绪，图表第一帧画出来就是对的语种。
   3. 文案表同时服务两处：HTML 静态节点（data-i18n*）与 lab.js 动态生成的
      读数/画布 aria-label（SL_I18N.t）。
   4. 颜色对比度日志（window.__slContrastLog）里的分类名**故意不翻译** ——
      它们是诊断用的稳定标识符，不是界面文案，翻译会让测试断言随语种漂移。
   ========================================================================== */
(function () {
  'use strict';

  var STORE_KEY = 'dx_lang';
  var DEFAULT_LANG = 'zh';
  var SUPPORTED = ['zh', 'en'];
  var CANONICAL_BASE = 'https://daixuan.cloud/stats-lab/';

  /* ======================================================================
     文案表
     ====================================================================== */
  var DICT = {
    zh: {
      /* —— head —— */
      'meta.title': '数据实验室 · 交互统计沙盒 | 戴璇 · daixuan.cloud',
      'meta.desc': '纯静态交互统计实验室：中心极限定理、Bootstrap 置信区间、均值与中位数的效率与稳健性、辛普森悖论。参数可拖动、图表即时更新、每个实验都能分享深链，零依赖。',
      'meta.ogDesc': '把统计变成可以拖动的直觉：中心极限定理、Bootstrap 置信区间、均值 vs 中位数、辛普森悖论。零依赖纯静态，每个实验都能分享深链。',
      'meta.twDesc': '中心极限定理、Bootstrap 置信区间、均值 vs 中位数、辛普森悖论 —— 可拖动、可分享深链的交互统计实验室。',

      /* —— 顶栏 / 骨架 —— */
      'a11y.skip': '跳到主内容',
      'brand.name': '戴璇',
      'theme.aria': '切换色彩主题',
      'theme.title': '切换深色/浅色模式',
      'back': '返回作品索引',

      /* —— Hero —— */
      'hero.eyebrow': 'DATA LAB / 交互统计沙盒',
      'hero.title': '把统计，变成可以拖动的直觉。',
      'hero.lead': '四个经典问题，全部在浏览器里现场模拟：拖一根滑块，图表立刻重算。没有后端、没有第三方库，也没有预先录好的动画——你看到的每一条柱子，都是这一秒刚抽出来的样本。',
      'hero.chip1': '零依赖 · 纯静态',
      'hero.chip2': '随机种子可复现',
      'hero.chip3': '每个实验都能分享深链',
      'hero.chip4': '深浅双主题',
      'hero.hint': '玩法：拖动滑块 → 看图表与读数同步变化 → 点「复制链接」把当前这组参数发给别人，对方打开会看到<strong>一模一样</strong>的图。',

      /* —— 章节导航 —— */
      'nav.aria': '实验目录',
      'nav.1': '中心极限定理',
      'nav.2': 'Bootstrap 区间',
      'nav.3': '均值 vs 中位数',
      'nav.4': '辛普森悖论',

      /* —— 实验 01 —— */
      'lab1.index': '实验 01 / CENTRAL LIMIT THEOREM',
      'lab1.title': '无论总体长得多奇怪，样本均值的分布都会变正态',
      'lab1.lead': '左边选一个总体分布，右边看它的样子；下面那张图，是「每次抽 <em>n</em> 个观测、算一次均值」重复几千次之后，这些均值自己形成的分布。把 <em>n</em> 从 2 拖到 30，看它怎么从「和总体一样歪」变成一口标准的钟形。',
      'lab1.dist.label': '总体分布',
      'lab1.dist.hint': '被抽样的「真实世界」长什么样',
      'lab1.opt.exponential': '指数分布（右偏，最经典的反例）',
      'lab1.opt.uniform': '均匀分布（平顶）',
      'lab1.opt.bimodal': '双峰分布（两个峰，完全不像钟形）',
      'lab1.opt.lognormal': '对数正态（长右尾，极右偏）',
      'lab1.n.label': '每次抽样的样本量 <em>n</em>',
      'lab1.n.hint': '一次抽样里包含多少个观测；n 越大，均值越稳定',
      'lab1.sims.label': '重复抽样次数',
      'lab1.sims.hint': '重复次数越多，直方图越平滑（不影响结论，只影响观感）',
      'lab1.btn.converge': '▶ 播放收敛动画',
      'lab1.btn.reseed': '换一组随机数',
      'lab1.figA': '总体分布',
      'lab1.figB': '样本均值的抽样分布',
      'lab1.figB.sub': '叠加理论正态曲线',
      'lab1.canvasA.aria': '总体分布直方图',
      'lab1.canvasB.aria': '样本均值的抽样分布直方图',
      'ro.mu': '总体均值 μ',
      'ro.sigma': '总体标准差 σ',
      'ro.seTheory': '理论标准误 σ/√n',
      'ro.seObs': '实测标准误',
      'ro.skew': '抽样分布的偏度',
      'lab1.note.sum': '这条曲线为什么重要？',
      'lab1.note.p1': '中心极限定理说的是：只要观测之间独立、方差有限，<strong>样本均值的抽样分布</strong>会随着 <em>n</em> 增大趋近正态，而且这个正态的均值等于总体均值 μ、标准差等于 σ/√n —— 后者就是「标准误」。',
      'lab1.note.p2': '注意图 B 的横轴比图 A 窄得多，而且随 <em>n</em> 增大越来越窄。这就是为什么「平均值」这种统计量如此好用：单个观测可能很吵，但它的平均值的波动被 1/√n 压下去了。',
      'lab1.note.p3': '两个前提别忘：<strong>独立性</strong>（观测之间不能强相关）与<strong>有限方差</strong>。厚尾到方差都不存在的分布（比如 Cauchy），这条定理不成立——实验 03 会让你看到厚尾的代价。',
      'share.btn': '复制这个实验的链接',

      /* —— 实验 02 —— */
      'lab2.index': '实验 02 / BOOTSTRAP CONFIDENCE INTERVAL',
      'lab2.title': '只有一份样本时，误差有多大？自己重抽样问出来',
      'lab2.lead': '图 A 是你唯一拿到的那份样本（这里的真实总体是对数正态，真实均值 μ ≈ 1.197）。图 B 把这份样本「有放回地重抽」几千次，每次算一个均值——这些均值的分布，就是置信区间的来源。点「模拟覆盖率」还能做一次元实验：造 200 份独立样本，看这些区间到底盖住了真值几次。',
      'lab2.n.label': '样本量 <em>n</em>',
      'lab2.n.hint': '样本越小，区间越宽、越容易偏',
      'lab2.B.label': '重抽样次数 <em>B</em>',
      'lab2.B.hint': 'B 越大，区间端点越稳定',
      'lab2.conf.label': '置信水平',
      'lab2.conf.hint': '区间覆盖真值的名义概率',
      'lab2.btn.reseed': '换一份样本',
      'lab2.btn.cover': '模拟覆盖率（200 份样本）',
      'lab2.figA': '你手上的那份样本',
      'lab2.figB': 'Bootstrap 分布与置信区间',
      'lab2.figB.sub': '阴影 = 百分位区间',
      'lab2.figC': '覆盖率元实验',
      'lab2.figC.sub': '200 份独立样本的区间，绿=盖住真值',
      'lab2.canvasA.aria': '样本散点与样本均值',
      'lab2.canvasB.aria': 'Bootstrap 重抽样分布与置信区间',
      'lab2.canvasC.aria': '200 份独立样本的置信区间覆盖情况',
      'ro.xbar': '样本均值 x̄',
      'ro.s': '样本标准差 s',
      'ro.perc': '百分位区间',
      'ro.norm': '正态近似区间',
      'ro.width': '区间宽度',
      'ro.trueMu': '真实 μ',
      'lab2.note.sum': '百分位区间和正态近似区间，该信哪个？',
      'lab2.note.p1': '<strong>百分位区间</strong>直接取 bootstrap 分布的 2.5% 与 97.5% 分位数——不假设任何分布形状，是默认选择。<strong>正态近似区间</strong>用 x̄ ± 1.96·SE，只有在 bootstrap 分布近似对称时才靠得住。',
      'lab2.note.p2': '把 <em>n</em> 拖到 5 再点「模拟覆盖率」：95% 的区间实际只盖住真值 <strong>76%</strong> 上下；<em>n</em> 提到 50 才回到 93% 左右（本页 M=200 实测）。因为对数正态右偏，小样本的 bootstrap 分布本身也偏，百分位区间会系统性偏移。这不是代码错了，这是 bootstrap 的真实局限，也是它需要 <em>n</em> 别太小的原因。',

      /* —— 实验 03 —— */
      'lab3.index': '实验 03 / EFFICIENCY vs ROBUSTNESS',
      'lab3.title': '均值更「省」，中位数更「稳」——换分布就换赢家',
      'lab3.lead': '同样是估计「中心位置」，均值和中位数谁更靠谱？答案取决于总体有没有离群点。图 B 把两个统计量的抽样分布画在同一根横轴上，谁的分布更窄，谁的估计就更精确。',
      'lab3.dist.label': '总体分布',
      'lab3.dist.hint': '离群点越多，均值的优势越小',
      'lab3.opt.normal': '正态分布（无离群点）',
      'lab3.opt.t3': 't 分布，自由度 3（厚尾）',
      'lab3.opt.contaminated': '污染正态（掺入离群点）',
      'lab3.opt.lognormal': '对数正态（单侧长尾）',
      'lab3.eps.label': '离群点占比 <em>ε</em>',
      'lab3.eps.hint': '有 ε 的概率抽到一个远离中心的异常观测',
      'lab3.n.label': '样本量 <em>n</em>',
      'lab3.n.hint': '两个统计量用完全相同的样本',
      'lab3.sims.label': '重复抽样次数',
      'lab3.sims.hint': '用于估计两个统计量各自的波动',
      'lab3.btn.reseed': '换一组随机数',
      'lab3.figA': '总体分布',
      'lab3.figB': '抽样分布对比',
      'lab3.legend.mean': '均值',
      'lab3.legend.median': '中位数',
      'lab3.canvasA.aria': '总体分布直方图',
      'lab3.canvasB.aria': '样本均值与样本中位数的抽样分布对比',
      'ro.seMean': '均值标准误 SE(x̄)',
      'ro.seMed': '中位数标准误 SE(med)',
      'ro.eff': '相对效率 SE(med)/SE(x̄)',
      'ro.skewMean': '均值的偏度',
      'ro.skewMed': '中位数的偏度',
      'lab3.note.sum': '「相对效率」怎么读？',
      'lab3.note.p1': 'SE(med)/SE(x̄) 就是中位数相对均值要多花多少样本量才能达到同样的精度。这个比值 ≈ 1 时两者打平；1.25 意味着中位数需要多约 1.25² ≈ 1.6 倍的样本量。',
      'lab3.note.p2': '正态总体下这个比值约 <strong>1.253</strong>（理论值 √(π/2)）—— 均值赢得干净利落，因为它用上了每一个观测的具体数值。但换成 t(3) 或掺了离群点的污染正态，均值会被极端值反复拽偏，比值迅速跌到 1 以下，<strong>中位数反而更准</strong>。这就是「稳健性」的价格：在理想世界里吃点亏，换极端情况下的不崩盘。',

      /* —— 实验 04 —— */
      'lab4.index': '实验 04 / SIMPSON\'S PARADOX',
      'lab4.title': '每个分组都赢，合并起来却输了',
      'lab4.lead': '方案 A 与方案 B 各自面对「轻症」和「重症」两类病例。默认参数下，A 在轻症组赢、在重症组也赢——但合并统计时 B 反而领先。差别只在于：重症病例被更多地分给了 A。拖一拖「重症占比」的两个滑块，看结论什么时候翻转。',
      'lab4.light.label': '轻症组基线成功率',
      'lab4.light.hint': '病情轻时，方案 B 的成功率',
      'lab4.sev.label': '重症组基线成功率',
      'lab4.sev.hint': '病情重时，方案 B 的成功率',
      'lab4.margin.label': '方案 A 的优势',
      'lab4.margin.hint': 'A 在两个组里分别比 B 高出多少（固定为正）',
      'lab4.aSev.label': 'A 组中重症占比',
      'lab4.aSev.hint': '这就是「混杂因素」——它让 A 看起来更差',
      'lab4.bSev.label': 'B 组中重症占比',
      'lab4.bSev.hint': '两个占比拉平，悖论就消失',
      'lab4.btn.fix': '随机化分配（消除混杂）',
      'lab4.btn.reset': '恢复默认参数',
      'lab4.figA': '分组比较',
      'lab4.figA.sub': '同一层内，A 始终更高',
      'lab4.figB': '合并比较',
      'lab4.figB.sub': '不分层时的总体成功率',
      'lab4.figC': '病例构成',
      'lab4.figC.sub': '重症（深色）在每组里的比例',
      'lab4.canvasA.aria': '按病情分层的成功率对比柱状图',
      'lab4.canvasB.aria': '合并后的总体成功率对比柱状图',
      'lab4.canvasC.aria': '两组病例中重症比例的构成条',
      'lab4.table.cap': '数值明细（成功率 = 成功数 / 该格病例数）',
      'lab4.th.stratum': '分层',
      'lab4.th.a': '方案 A',
      'lab4.th.b': '方案 B',
      'lab4.th.diff': 'A − B',
      'lab4.row.mild': '轻症',
      'lab4.row.severe': '重症',
      'lab4.row.pooled': '合并',
      'lab4.note.sum': '这不是数字游戏，是真实发生过的事',
      'lab4.note.p1': '当分组变量同时影响「谁进入哪一组」和「结果」时，合并统计量就会把<strong>组间差异</strong>和<strong>构成差异</strong>混在一起。本实验里，A 组重症占比高，所以它被迫在更难的人群里作战，合并成功率被拖低。',
      'lab4.note.p2': '识别它的办法很朴素：<strong>把可能影响分配的因素都分层看一遍</strong>。点「随机化分配」把两组构成拉平，悖论立刻消失——这正是随机对照试验（RCT）要随机化的原因：随机化让构成差异在期望上归零。',

      /* —— 关于 —— */
      'about.title': '关于这个实验室',
      'about.c1.h': '数字是怎么算出来的',
      'about.c1.p': '全部在浏览器里现场模拟，没有预渲染、没有后端、不引任何图表库。直方图用 Canvas 2D 绘制，柱高来自真实的抽样计数。',
      'about.c2.h': '为什么同一链接结果一样',
      'about.c2.p': '所有随机数来自可播种的生成器（mulberry32），种子写进链接里。分享出去的不是一张图，而是「重放这段实验的完整配方」。',
      'about.c3.h': '口径说明',
      'about.c3.p': '样本方差用 n−1（无偏）；偏度用 Fisher–Pearson 标准化矩；正态近似区间用 z 分位数，百分位区间用 bootstrap 分位数。中位数在偶数样本量时取中间两个值的平均。',
      'about.c4.h': '已知取舍',
      'about.c4.p': '为了交互流畅，重复次数上限设为 5000、覆盖率元实验固定 200 份样本，因此读数会有约 1–2% 的蒙特卡洛抖动。抖动是模拟的常态，不是 bug。',
      'about.foot': '想聊统计建模、工业工程或这个页面的实现？<a href="../index.html#contact">在主页找我</a>，或直接看 <a href="../case-studies/applied-statistics-credit-risk.html">应用统计案例分析</a>。',

      /* —— 页脚 —— */
      'footer.note': '交互统计沙盒 · 纯静态零依赖 · 图表由浏览器现场模拟生成',

      /* —— 语言切换按钮自身 —— */
      'lang.btn': 'EN',
      'lang.btn.lang': 'en',
      'lang.aria': 'Switch to English',
      'lang.title': 'Switch to English',

      /* ================= lab.js 动态文案 ================= */
      'js.dist.uniform': '均匀分布',
      'js.dist.exponential': '指数分布',
      'js.dist.bimodal': '双峰分布',
      'js.dist.lognormal': '对数正态',
      'js.dist.normal': '正态分布',
      'js.dist.t3': 't 分布 (df=3)',
      'js.dist.contaminated': '污染正态',

      'js.axis.count': '频数',
      'js.axis.sampleIndex': '样本序号',
      'js.axis.successRate': '成功率',
      'js.clip.tail': '  · 已截断长尾',
      'js.clip.plain': '  · 已截断',

      'js.clt.annotA': 'μ={mu}  σ={sigma}{clip}',
      'js.clt.annotB': '横轴 {lo}–{hi}  ·  σ/√n={se}{clip}',
      'js.clt.legend.obs': '实测 {sims} 次',
      'js.clt.legend.theory': '理论 N(μ, σ²/n)',
      'js.clt.ariaA': '总体分布（{dist}）直方图，均值 {mu}，标准差 {sigma}，横轴 {lo} 到 {hi}。',
      'js.clt.ariaB': '样本均值的抽样分布直方图：{sims} 次重复抽样，每次样本量 {n}。实测标准误 {seObs}，理论值 {seTheory}，偏度 {skew}。叠加理论正态曲线。',
      'js.clt.v.near': '抽样分布已经<strong>非常接近正态</strong>——偏度只有 {skew}，与理论曲线的偏差肉眼难辨。',
      'js.clt.v.mid': '抽样分布<strong>开始像正态</strong>，但仍能看出可见的偏斜（偏度 {skew}）。把 n 再拖大一点。',
      'js.clt.v.far': '抽样分布<strong>还明显不是正态</strong>（偏度 {skew}），形状基本继承了总体。这正是 CLT 要解决的问题。',
      'js.clt.v.se': ' 实测标准误 {seObs} vs 理论 σ/√n = {seTheory}，两者吻合说明「波动按 1/√n 收缩」这条规律成立。',
      'js.clt.v.live': ' <em>（拖动中，当前用 {sims} 次快速预览）</em>',

      'js.bs.sampleNote': 'n = {n}，真实总体为对数正态',
      'js.bs.annotA': 'n={n}  ·  s={s}',
      'js.bs.legend.band': '百分位区间 {conf}',
      'js.bs.legend.boot': 'B={B} 次重抽样',
      'js.bs.annotB': '百分位 [{lo}, {hi}]',
      'js.bs.annotC': '覆盖 {rate}  ·  名义 {conf}  ·  M={M}',
      'js.bs.ariaA': '样本散点图：{n} 个观测，样本均值 {xbar}，样本标准差 {s}，真实总体均值 {trueMu}。',
      'js.bs.ariaB': 'Bootstrap 重抽样分布直方图：{B} 次重抽样，{conf} 百分位置信区间为 {pLo} 到 {pHi}，正态近似区间为 {nLo} 到 {nHi}。',
      'js.bs.ariaC': '覆盖率元实验：{M} 份独立样本的置信区间，其中 {rate} 盖住真实均值 {trueMu}，名义覆盖水平 {conf}。',
      'js.bs.v.head': '这份样本的 {conf} 百分位区间是 [{pLo}, {pHi}]，',
      'js.bs.v.cover': '它<strong>盖住了</strong>真实 μ = {trueMu}。',
      'js.bs.v.miss': '它<strong>没盖住</strong>真实 μ = {trueMu} —— 这很正常，{miss} 的区间本来就会漏。',
      'js.bs.v.wide': ' 百分位区间宽度是正态近似区间的 {ratio} 倍，说明 bootstrap 分布明显右偏 —— 这时更该信百分位区间。',
      'js.bs.v.sym': ' 百分位区间宽度是正态近似区间的 {ratio} 倍，两者接近，说明 bootstrap 分布已近似对称。',
      'js.bs.run.start': '正在模拟… 0/{M}',
      'js.bs.run.progress': '正在模拟… {done}/{M}（已覆盖 {cov}）',
      'js.bs.run.again': '重新模拟覆盖率',
      'js.bs.meta.head': '元实验结论：{M} 份独立样本里，有 <strong>{cov}</strong> 的 {conf} 百分位区间盖住了真值，名义水平是 {conf}。',
      'js.bs.meta.under': ' <strong>覆盖不足</strong>，差值 {dev} 个百分点，超出 ±{band} 的蒙特卡洛误差带 —— 右偏总体在 n={n} 时 bootstrap 分布本身也偏，这是它的真实短板。',
      'js.bs.meta.over': ' 覆盖偏高，差值 +{dev} 个百分点，超出 ±{band} 的蒙特卡洛误差带。',
      'js.bs.meta.ok': ' 与名义水平一致（差值 {dev} 个百分点，落在 ±{band} 的蒙特卡洛误差带内）。',
      'js.bs.meta.foot': ' 每份样本用 B={B} 次重抽样。',

      'js.rb.nameEps': '（ε={eps}）',
      'js.rb.annotA': 'σ={sigma}{eps}{clip}',
      'js.rb.annotB': '相对效率 {r}{clip}',
      'js.rb.legend.mean': '均值 SE={se}',
      'js.rb.legend.med': '中位数 SE={se}',
      'js.rb.ariaA': '总体分布（{dist}）直方图，标准差 {sigma}。',
      'js.rb.ariaB': '样本均值与样本中位数的抽样分布叠加直方图。均值的标准误 {seMean}，中位数的标准误 {seMed}，比值 {ratio}。',
      'js.rb.v.mean': '这一局<strong>均值赢</strong>：中位数的标准误是均值的 {ratio} 倍，要达到同样精度，中位数大约需要多 {sq} 倍的样本量。',
      'js.rb.v.meanNormal': ' 正态总体下这个比值收敛到理论值 √(π/2) ≈ 1.253 —— 均值用上了每个观测的具体数值，所以更省。',
      'js.rb.v.med': '这一局<strong>中位数赢</strong>：它的标准误只有均值的 {ratio} 倍（越小越好）。均值的抽样分布偏度达 {skew}，被极端值反复拽偏；中位数只看中间，天然抗离群点。',
      'js.rb.v.tie': '两者<strong>基本打平</strong>（比值 {ratio}）。这个总体里离群点的代价与「只用中间信息」的代价刚好抵消。',
      'js.rb.v.foot': ' 当前每个样本 n={n}，共重复 {sims} 次。',

      'js.sp.mildA': '轻症 A',
      'js.sp.mildB': '轻症 B',
      'js.sp.sevA': '重症 A',
      'js.sp.sevB': '重症 B',
      'js.sp.group.mild': '轻症组（同层比较）',
      'js.sp.group.sev': '重症组（同层比较）',
      'js.sp.pooledA': '合并 A',
      'js.sp.pooledB': '合并 B',
      'js.sp.armA': 'A 组',
      'js.sp.armB': 'B 组',
      'js.sp.mix.severe': '重症 {p}',
      'js.sp.mix.mild': '轻症 {p}',
      'js.sp.ariaA': '分层成功率柱状图：轻症组 A {la}、B {lb}；重症组 A {sa}、B {sb}。',
      'js.sp.ariaB': '合并成功率柱状图：方案 A {a}，方案 B {b}。',
      'js.sp.ariaC': '病例构成条：A 组重症占比 {a}，B 组重症占比 {b}。',
      'js.sp.v.paradox': '<strong>悖论出现了。</strong>分层看，方案 A 在轻症组（{la} vs {lb}）和重症组（{sa} vs {sb}）都更高；但合并之后 B 反超：{pb} vs {pa}。原因是 A 组里重症占 {aShare}，而 B 组只占 {bShare} —— A 一直在更难的病人里作战。',
      'js.sp.v.gone': '<strong>悖论消失了。</strong>分层与合并结论一致：A 在两个组里都更高，合并后也更高（{pa} vs {pb}）。两组重症占比现在只差 {gap} 个百分点。',
      'js.sp.v.none': '当前方案 A 在某一层里并不占优，所以不构成辛普森悖论。把「方案 A 的优势」调大，或让两组重症占比拉开差距。',

      'js.ppSuffix': ' 个百分点',
      'js.ppPlus': '+{v} 个百分点',

      'js.share.ok': '已复制到剪贴板，粘贴即可分享。',
      'js.share.fail': '自动复制被浏览器拦下了，请手动复制地址栏里的链接。',
      'js.theme.toLight': '切换至浅色模式',
      'js.theme.toDark': '切换至深色模式',
      'js.err.prefix': '这个实验渲染出错：'
    },

    en: {
      /* —— head —— */
      'meta.title': 'Stats Lab · Interactive Statistics Sandbox | Dai Xuan · daixuan.cloud',
      'meta.desc': 'A pure-static interactive statistics lab: the central limit theorem, bootstrap confidence intervals, the efficiency and robustness of mean vs median, and Simpson\'s paradox. Drag the parameters, charts update instantly, and every experiment has a shareable deep link. Zero dependencies.',
      'meta.ogDesc': 'Statistics you can drag instead of just read: the central limit theorem, bootstrap confidence intervals, mean vs median, Simpson\'s paradox. Pure static, zero dependencies, and a shareable deep link for every experiment.',
      'meta.twDesc': 'The central limit theorem, bootstrap confidence intervals, mean vs median, Simpson\'s paradox — an interactive statistics lab with draggable parameters and shareable deep links.',

      /* —— 顶栏 / 骨架 —— */
      'a11y.skip': 'Skip to main content',
      'brand.name': 'Dai Xuan',
      'theme.aria': 'Switch colour theme',
      'theme.title': 'Toggle dark / light mode',
      'back': 'Back to portfolio',

      /* —— Hero —— */
      'hero.eyebrow': 'DATA LAB / INTERACTIVE STATISTICS',
      'hero.title': 'Statistics you can drag, not just read.',
      'hero.lead': 'Four classic problems, simulated live in your browser: drag a slider and every chart recomputes on the spot. No backend, no third-party libraries, no pre-recorded animation — every bar you see was drawn from a sample taken this very second.',
      'hero.chip1': 'Zero dependencies · pure static',
      'hero.chip2': 'Reproducible random seeds',
      'hero.chip3': 'Shareable deep link per experiment',
      'hero.chip4': 'Dark and light themes',
      'hero.hint': 'How to play: drag a slider → watch the charts and the readouts move together → hit “Copy link” to send someone this exact set of parameters, and they will see <strong>exactly the same</strong> picture.',

      /* —— 章节导航 —— */
      'nav.aria': 'Experiment index',
      'nav.1': 'Central limit theorem',
      'nav.2': 'Bootstrap intervals',
      'nav.3': 'Mean vs median',
      'nav.4': 'Simpson\'s paradox',

      /* —— 实验 01 —— */
      'lab1.index': 'EXPERIMENT 01 / CENTRAL LIMIT THEOREM',
      'lab1.title': 'However odd the population looks, the sample mean goes normal',
      'lab1.lead': 'Pick a population on the left and see its shape on the right. The lower chart is what you get from drawing <em>n</em> observations and taking their mean, thousands of times over — the distribution those means form by themselves. Drag <em>n</em> from 2 to 30 and watch it turn from “as skewed as the population” into a clean bell.',
      'lab1.dist.label': 'Population',
      'lab1.dist.hint': 'What the “real world” being sampled actually looks like',
      'lab1.opt.exponential': 'Exponential (right-skewed, the classic counter-example)',
      'lab1.opt.uniform': 'Uniform (flat-topped)',
      'lab1.opt.bimodal': 'Bimodal (two peaks, nothing like a bell)',
      'lab1.opt.lognormal': 'Lognormal (long right tail, strongly skewed)',
      'lab1.n.label': 'Observations per sample <em>n</em>',
      'lab1.n.hint': 'How many observations go into one sample; a larger n makes the mean steadier',
      'lab1.sims.label': 'Repeated samples',
      'lab1.sims.hint': 'More repetitions give a smoother histogram — this changes how it looks, not what it says',
      'lab1.btn.converge': '▶ Play convergence',
      'lab1.btn.reseed': 'New random draw',
      'lab1.figA': 'Population',
      'lab1.figB': 'Sampling distribution of the mean',
      'lab1.figB.sub': 'theoretical normal overlaid',
      'lab1.canvasA.aria': 'Histogram of the population distribution',
      'lab1.canvasB.aria': 'Histogram of the sampling distribution of the mean',
      'ro.mu': 'Population mean μ',
      'ro.sigma': 'Population SD σ',
      'ro.seTheory': 'Theoretical SE σ/√n',
      'ro.seObs': 'Observed SE',
      'ro.skew': 'Skewness of the sampling distribution',
      'lab1.note.sum': 'Why does this curve matter?',
      'lab1.note.p1': 'The central limit theorem says that as long as the observations are independent and the variance is finite, the <strong>sampling distribution of the sample mean</strong> approaches normality as <em>n</em> grows — with mean equal to the population mean μ and standard deviation σ/√n. That standard deviation is the “standard error”.',
      'lab1.note.p2': 'Notice how chart B\'s horizontal axis is far narrower than chart A\'s, and narrows further as <em>n</em> grows. That is why the average is such a useful statistic: a single observation can be noisy, but the wobble of its average is squeezed down by 1/√n.',
      'lab1.note.p3': 'Two assumptions are easy to forget: <strong>independence</strong> (no strong correlation between observations) and <strong>finite variance</strong>. For distributions so heavy-tailed that the variance does not even exist — Cauchy, for instance — the theorem fails. Experiment 03 shows you what heavy tails cost.',
      'share.btn': 'Copy a link to this experiment',

      /* —— 实验 02 —— */
      'lab2.index': 'EXPERIMENT 02 / BOOTSTRAP CONFIDENCE INTERVAL',
      'lab2.title': 'With only one sample, how large is the error? Resample it and ask',
      'lab2.lead': 'Chart A is the one sample you were handed (the true population here is lognormal, with true mean μ ≈ 1.197). Chart B resamples it with replacement thousands of times, taking a mean each round — the distribution of those means is where a confidence interval comes from. Hit “Simulate coverage” for a meta-experiment: build 200 independent samples and count how often the intervals really do capture the truth.',
      'lab2.n.label': 'Sample size <em>n</em>',
      'lab2.n.hint': 'Smaller samples give wider intervals that are more easily biased',
      'lab2.B.label': 'Resamples <em>B</em>',
      'lab2.B.hint': 'A larger B makes the interval endpoints steadier',
      'lab2.conf.label': 'Confidence level',
      'lab2.conf.hint': 'The nominal probability that the interval covers the truth',
      'lab2.btn.reseed': 'New sample',
      'lab2.btn.cover': 'Simulate coverage (200 samples)',
      'lab2.figA': 'The sample you were given',
      'lab2.figB': 'Bootstrap distribution and confidence interval',
      'lab2.figB.sub': 'shaded = percentile interval',
      'lab2.figC': 'Coverage meta-experiment',
      'lab2.figC.sub': 'intervals from 200 independent samples; green = covers the truth',
      'lab2.canvasA.aria': 'Sample scatter with the sample mean',
      'lab2.canvasB.aria': 'Bootstrap resampling distribution and confidence interval',
      'lab2.canvasC.aria': 'Coverage of the confidence intervals from 200 independent samples',
      'ro.xbar': 'Sample mean x̄',
      'ro.s': 'Sample SD s',
      'ro.perc': 'Percentile interval',
      'ro.norm': 'Normal-approx. interval',
      'ro.width': 'Interval width',
      'ro.trueMu': 'True μ',
      'lab2.note.sum': 'Percentile or normal-approximation interval — which do you trust?',
      'lab2.note.p1': 'The <strong>percentile interval</strong> simply takes the 2.5% and 97.5% quantiles of the bootstrap distribution — it assumes nothing about its shape, which is why it is the default. The <strong>normal-approximation interval</strong> uses x̄ ± 1.96·SE and is only trustworthy when the bootstrap distribution is roughly symmetric.',
      'lab2.note.p2': 'Drag <em>n</em> down to 5 and hit “Simulate coverage”: the 95% intervals actually cover the truth only about <strong>76%</strong> of the time, and you need <em>n</em> near 50 to get back to roughly 93% (measured here with M=200). Because the lognormal is right-skewed, the bootstrap distribution of a small sample is skewed too, so the percentile interval shifts systematically. The code is not wrong — this is a real limitation of the bootstrap, and the reason it wants a decent <em>n</em>.',

      /* —— 实验 03 —— */
      'lab3.index': 'EXPERIMENT 03 / EFFICIENCY VS ROBUSTNESS',
      'lab3.title': 'The mean is thriftier, the median steadier — change the population and the winner changes',
      'lab3.lead': 'Both estimate the centre of a distribution, so which is more reliable — the mean or the median? The answer depends on whether the population has outliers. Chart B puts both sampling distributions on the same horizontal axis: the narrower one gives the more precise estimate.',
      'lab3.dist.label': 'Population',
      'lab3.dist.hint': 'The more outliers, the smaller the mean\'s edge',
      'lab3.opt.normal': 'Normal (no outliers)',
      'lab3.opt.t3': 't distribution, 3 df (heavy tails)',
      'lab3.opt.contaminated': 'Contaminated normal (outliers mixed in)',
      'lab3.opt.lognormal': 'Lognormal (one-sided long tail)',
      'lab3.eps.label': 'Outlier share <em>ε</em>',
      'lab3.eps.hint': 'With probability ε you draw an aberrant observation far from the centre',
      'lab3.n.label': 'Sample size <em>n</em>',
      'lab3.n.hint': 'Both statistics use exactly the same samples',
      'lab3.sims.label': 'Repeated samples',
      'lab3.sims.hint': 'Used to estimate the spread of each statistic',
      'lab3.btn.reseed': 'New random draw',
      'lab3.figA': 'Population',
      'lab3.figB': 'Sampling distributions compared',
      'lab3.legend.mean': 'mean',
      'lab3.legend.median': 'median',
      'lab3.canvasA.aria': 'Histogram of the population distribution',
      'lab3.canvasB.aria': 'Sampling distributions of the sample mean and the sample median, overlaid',
      'ro.seMean': 'Mean standard error SE(x̄)',
      'ro.seMed': 'Median standard error SE(med)',
      'ro.eff': 'Relative efficiency SE(med)/SE(x̄)',
      'ro.skewMean': 'Skewness of the mean',
      'ro.skewMed': 'Skewness of the median',
      'lab3.note.sum': 'How do you read “relative efficiency”?',
      'lab3.note.p1': 'SE(med)/SE(x̄) is how much more data the median needs to reach the same precision as the mean. A ratio of ≈ 1 means the two are level; 1.25 means the median needs roughly 1.25² ≈ 1.6× as many observations.',
      'lab3.note.p2': 'Under a normal population the ratio sits near <strong>1.253</strong> (the theoretical √(π/2)) — a clean win for the mean, because it uses the actual value of every observation. Switch to t(3) or a contaminated normal and extreme values keep dragging the mean off centre; the ratio quickly drops below 1 and <strong>the median becomes the more accurate estimate</strong>. That is the price of robustness: give up a little in the ideal world to avoid collapsing in the extreme one.',

      /* —— 实验 04 —— */
      'lab4.index': 'EXPERIMENT 04 / SIMPSON\'S PARADOX',
      'lab4.title': 'Ahead in every group, behind once you pool them',
      'lab4.lead': 'Treatments A and B each face two kinds of case, mild and severe. With the default settings A wins in the mild group and in the severe group — yet once the results are pooled, B pulls ahead. The only difference: more of the severe cases were assigned to A. Drag the two severity-share sliders and watch when the conclusion flips.',
      'lab4.light.label': 'Baseline success rate, mild group',
      'lab4.light.hint': 'Success rate of treatment B on mild cases',
      'lab4.sev.label': 'Baseline success rate, severe group',
      'lab4.sev.hint': 'Success rate of treatment B on severe cases',
      'lab4.margin.label': 'Treatment A\'s edge',
      'lab4.margin.hint': 'How much better A does than B in each group (held positive)',
      'lab4.aSev.label': 'Severe share in group A',
      'lab4.aSev.hint': 'This is the confounder — it makes A look worse',
      'lab4.bSev.label': 'Severe share in group B',
      'lab4.bSev.hint': 'Level the two shares and the paradox disappears',
      'lab4.btn.fix': 'Randomise assignment (remove the confounder)',
      'lab4.btn.reset': 'Reset to defaults',
      'lab4.figA': 'Comparison within strata',
      'lab4.figA.sub': 'inside each stratum, A is always higher',
      'lab4.figB': 'Pooled comparison',
      'lab4.figB.sub': 'overall success rate, ignoring strata',
      'lab4.figC': 'Case mix',
      'lab4.figC.sub': 'share of severe cases (dark) in each arm',
      'lab4.canvasA.aria': 'Bar chart comparing success rates by severity stratum',
      'lab4.canvasB.aria': 'Bar chart comparing pooled overall success rates',
      'lab4.canvasC.aria': 'Composition bars showing the severe-case share in each arm',
      'lab4.table.cap': 'Detail (success rate = successes / cases in that cell)',
      'lab4.th.stratum': 'Stratum',
      'lab4.th.a': 'Treatment A',
      'lab4.th.b': 'Treatment B',
      'lab4.th.diff': 'A − B',
      'lab4.row.mild': 'Mild',
      'lab4.row.severe': 'Severe',
      'lab4.row.pooled': 'Pooled',
      'lab4.note.sum': 'This is not a number game — it has really happened',
      'lab4.note.p1': 'When the grouping variable influences both who enters which group and the outcome, a pooled statistic blends <strong>differences between groups</strong> with <strong>differences in composition</strong>. Here group A carries a higher share of severe cases, so it is forced to fight in a harder population and its pooled success rate is dragged down.',
      'lab4.note.p2': 'Spotting it is plain work: <strong>stratify on everything that might influence assignment</strong>. Hit “Randomise assignment” to level the two groups and the paradox vanishes at once — which is exactly why randomised controlled trials (RCTs) randomise: randomisation drives the difference in composition to zero in expectation.',

      /* —— 关于 —— */
      'about.title': 'About this lab',
      'about.c1.h': 'How the numbers are produced',
      'about.c1.p': 'Everything is simulated live in the browser — no pre-rendering, no backend, no charting library. The histograms are drawn with Canvas 2D and every bar height comes from a real sample count.',
      'about.c2.h': 'Why the same link gives the same result',
      'about.c2.p': 'Every random number comes from a seedable generator (mulberry32), and the seed travels inside the link. What you share is not a picture but the complete recipe for replaying the experiment.',
      'about.c3.h': 'Conventions',
      'about.c3.p': 'Sample variance uses n−1 (unbiased); skewness uses the Fisher–Pearson standardised moment; normal-approximation intervals use z quantiles while percentile intervals use bootstrap quantiles. For an even sample size the median averages the two middle values.',
      'about.c4.h': 'Known trade-offs',
      'about.c4.p': 'To keep interaction smooth, repetitions are capped at 5000 and the coverage meta-experiment is fixed at 200 samples, so readouts carry roughly 1–2% of Monte-Carlo jitter. Jitter is normal in simulation, not a bug.',
      'about.foot': 'Want to talk about statistical modelling, industrial engineering, or how this page is built? <a href="../index.html#contact">Find me on the homepage</a>, or go straight to the <a href="../case-studies/applied-statistics-credit-risk.html">applied-statistics case study</a>.',

      /* —— 页脚 —— */
      'footer.note': 'Interactive statistics sandbox · pure static, zero dependencies · charts simulated live in the browser',

      /* —— 语言切换按钮自身 —— */
      'lang.btn': '中文',
      'lang.btn.lang': 'zh-CN',
      'lang.aria': '切换到中文',
      'lang.title': '切换到中文',

      /* ================= lab.js 动态文案 ================= */
      'js.dist.uniform': 'Uniform',
      'js.dist.exponential': 'Exponential',
      'js.dist.bimodal': 'Bimodal',
      'js.dist.lognormal': 'Lognormal',
      'js.dist.normal': 'Normal',
      'js.dist.t3': 't distribution (df=3)',
      'js.dist.contaminated': 'Contaminated normal',

      'js.axis.count': 'count',
      'js.axis.sampleIndex': 'sample #',
      'js.axis.successRate': 'success rate',
      'js.clip.tail': '  · long tail clipped',
      'js.clip.plain': '  · clipped',

      'js.clt.annotA': 'μ={mu}  σ={sigma}{clip}',
      'js.clt.annotB': 'x {lo}–{hi}  ·  σ/√n={se}{clip}',
      'js.clt.legend.obs': 'observed ×{sims}',
      'js.clt.legend.theory': 'theory N(μ, σ²/n)',
      'js.clt.ariaA': 'Histogram of the population distribution ({dist}): mean {mu}, standard deviation {sigma}, horizontal axis {lo} to {hi}.',
      'js.clt.ariaB': 'Histogram of the sampling distribution of the sample mean: {sims} repeated samples of size {n}. Observed standard error {seObs}, theoretical value {seTheory}, skewness {skew}. The theoretical normal curve is overlaid.',
      'js.clt.v.near': 'The sampling distribution is now <strong>very close to normal</strong> — skewness is just {skew}, and the deviation from the theoretical curve is hard to see by eye.',
      'js.clt.v.mid': 'The sampling distribution is <strong>starting to look normal</strong>, but a visible skew remains (skewness {skew}). Drag n a little higher.',
      'js.clt.v.far': 'The sampling distribution is <strong>still clearly not normal</strong> (skewness {skew}); its shape has largely inherited the population. This is exactly the problem the CLT solves.',
      'js.clt.v.se': ' Observed standard error {seObs} against the theoretical σ/√n = {seTheory} — they agree, which confirms that the spread contracts like 1/√n.',
      'js.clt.v.live': ' <em>(mid-drag, currently a fast preview at {sims} repetitions)</em>',

      'js.bs.sampleNote': 'n = {n}, true population is lognormal',
      'js.bs.annotA': 'n={n}  ·  s={s}',
      'js.bs.legend.band': 'percentile interval {conf}',
      'js.bs.legend.boot': 'B={B} resamples',
      'js.bs.annotB': 'percentile [{lo}, {hi}]',
      'js.bs.annotC': 'coverage {rate}  ·  nominal {conf}  ·  M={M}',
      'js.bs.ariaA': 'Sample scatter plot: {n} observations, sample mean {xbar}, sample standard deviation {s}, true population mean {trueMu}.',
      'js.bs.ariaB': 'Histogram of the bootstrap resampling distribution: {B} resamples, {conf} percentile confidence interval from {pLo} to {pHi}, normal-approximation interval from {nLo} to {nHi}.',
      'js.bs.ariaC': 'Coverage meta-experiment: confidence intervals from {M} independent samples, {rate} of which cover the true mean {trueMu}; the nominal coverage level is {conf}.',
      'js.bs.v.head': 'The {conf} percentile interval for this sample is [{pLo}, {pHi}], and ',
      'js.bs.v.cover': 'it <strong>does cover</strong> the true μ = {trueMu}.',
      'js.bs.v.miss': 'it <strong>does not cover</strong> the true μ = {trueMu} — which is perfectly normal, since {miss} of intervals are meant to miss.',
      'js.bs.v.wide': ' The percentile interval is {ratio}× as wide as the normal-approximation interval, which tells you the bootstrap distribution is clearly right-skewed — trust the percentile interval here.',
      'js.bs.v.sym': ' The percentile interval is {ratio}× as wide as the normal-approximation interval; the two are close, so the bootstrap distribution is already roughly symmetric.',
      'js.bs.run.start': 'Simulating… 0/{M}',
      'js.bs.run.progress': 'Simulating… {done}/{M} (coverage {cov})',
      'js.bs.run.again': 'Run coverage again',
      'js.bs.meta.head': 'Meta-experiment: across {M} independent samples, <strong>{cov}</strong> of the {conf} percentile intervals covered the true value; the nominal level is {conf}.',
      'js.bs.meta.under': ' That is <strong>undercoverage</strong>: the gap of {dev} percentage points falls outside the ±{band} Monte-Carlo error band — for a right-skewed population at n={n} the bootstrap distribution is itself skewed, and this is its genuine weak spot.',
      'js.bs.meta.over': ' Coverage runs high: the gap of +{dev} percentage points falls outside the ±{band} Monte-Carlo error band.',
      'js.bs.meta.ok': ' This matches the nominal level (gap {dev} percentage points, inside the ±{band} Monte-Carlo error band).',
      'js.bs.meta.foot': ' Each sample used B={B} resamples.',

      'js.rb.nameEps': ' (ε={eps})',
      'js.rb.annotA': 'σ={sigma}{eps}{clip}',
      'js.rb.annotB': 'relative efficiency {r}{clip}',
      'js.rb.legend.mean': 'mean SE={se}',
      'js.rb.legend.med': 'median SE={se}',
      'js.rb.ariaA': 'Histogram of the population distribution ({dist}), standard deviation {sigma}.',
      'js.rb.ariaB': 'Overlaid histograms of the sampling distributions of the sample mean and the sample median. Standard error of the mean {seMean}, standard error of the median {seMed}, ratio {ratio}.',
      'js.rb.v.mean': '<strong>The mean wins</strong> this round: the median\'s standard error is {ratio}× that of the mean, so reaching the same precision would take the median about {sq}× as many observations.',
      'js.rb.v.meanNormal': ' Under a normal population this ratio converges to the theoretical √(π/2) ≈ 1.253 — the mean uses the actual value of every observation, which is why it is thriftier.',
      'js.rb.v.med': '<strong>The median wins</strong> this round: its standard error is only {ratio}× that of the mean (lower is better). The mean\'s sampling distribution reaches a skewness of {skew}, dragged off centre again and again by extreme values, while the median looks only at the middle and is naturally immune to outliers.',
      'js.rb.v.tie': 'The two are <strong>essentially level</strong> (ratio {ratio}). In this population the cost of outliers and the cost of using only the middle information happen to cancel out.',
      'js.rb.v.foot': ' Each sample currently holds n={n} observations, repeated {sims} times.',

      'js.sp.mildA': 'Mild A',
      'js.sp.mildB': 'Mild B',
      'js.sp.sevA': 'Severe A',
      'js.sp.sevB': 'Severe B',
      'js.sp.group.mild': 'Mild group (within-stratum)',
      'js.sp.group.sev': 'Severe group (within-stratum)',
      'js.sp.pooledA': 'Pooled A',
      'js.sp.pooledB': 'Pooled B',
      'js.sp.armA': 'Arm A',
      'js.sp.armB': 'Arm B',
      'js.sp.mix.severe': 'severe {p}',
      'js.sp.mix.mild': 'mild {p}',
      'js.sp.ariaA': 'Bar chart of success rates by stratum: mild group A {la}, B {lb}; severe group A {sa}, B {sb}.',
      'js.sp.ariaB': 'Bar chart of pooled success rates: treatment A {a}, treatment B {b}.',
      'js.sp.ariaC': 'Case-mix bars: severe share {a} in group A and {b} in group B.',
      'js.sp.v.paradox': '<strong>The paradox is here.</strong> Stratum by stratum, treatment A is higher in the mild group ({la} vs {lb}) and in the severe group ({sa} vs {sb}); but once pooled, B overtakes it: {pb} vs {pa}. The reason is that severe cases make up {aShare} of group A but only {bShare} of group B — A has been fighting in the harder population all along.',
      'js.sp.v.gone': '<strong>The paradox is gone.</strong> Stratified and pooled conclusions now agree: A is higher in both groups and higher once pooled ({pa} vs {pb}). The two severe shares now differ by only {gap} percentage points.',
      'js.sp.v.none': 'Treatment A is not ahead in at least one stratum here, so there is no Simpson\'s paradox to speak of. Increase “Treatment A\'s edge”, or push the two severe shares further apart.',

      'js.ppSuffix': ' pp',
      'js.ppPlus': '+{v} pp',

      'js.share.ok': 'Copied to the clipboard — just paste it to share.',
      'js.share.fail': 'The browser blocked the automatic copy, so please copy the link from the address bar manually.',
      'js.theme.toLight': 'Switch to light mode',
      'js.theme.toDark': 'Switch to dark mode',
      'js.err.prefix': 'This experiment failed to render: '
    }
  };

  /* ======================================================================
     状态与取值
     ====================================================================== */
  var lang = DEFAULT_LANG;

  function normalize(v) {
    if (v === 'en' || v === 'zh') return v;
    if (typeof v === 'string' && v.slice(0, 2).toLowerCase() === 'en') return 'en';
    if (typeof v === 'string' && v.slice(0, 2).toLowerCase() === 'zh') return 'zh';
    return null;
  }

  function readStored() {
    try { return normalize(localStorage.getItem(STORE_KEY)); } catch (e) { return null; }
  }
  function writeStored(v) {
    try { localStorage.setItem(STORE_KEY, v); } catch (e) { /* 隐私模式忽略 */ }
  }
  function readQuery() {
    try { return normalize(new URLSearchParams(location.search).get('lang')); } catch (e) { return null; }
  }

  /* 文案取值：{name} 占位符替换。缺 key 时回落到中文（正本），再不行返回 key 本身，
     这样即使漏翻一处，页面也不会出现空白。 */
  function t(key, vars) {
    var table = DICT[lang] || DICT[DEFAULT_LANG];
    var s = table[key];
    if (s === undefined) s = DICT[DEFAULT_LANG][key];
    if (s === undefined) return key;
    if (vars) {
      s = s.replace(/\{(\w+)\}/g, function (m, name) {
        return Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : m;
      });
    }
    return s;
  }

  /* ======================================================================
     把文案刷到 DOM 上
     三种标注，互不干扰，可以同时出现在一个元素上：
       data-i18n="key"        → textContent
       data-i18n-html="key"   → innerHTML（文案里带 <strong>/<em>/<a> 时用）
       data-i18n-a="attr:key;attr:key" → 写属性（meta 的 content、按钮的 title 等）
     ====================================================================== */
  function applyStatic(root) {
    var scope = root || document;

    Array.prototype.forEach.call(scope.querySelectorAll('[data-i18n]'), function (el) {
      el.textContent = t(el.getAttribute('data-i18n'));
    });

    Array.prototype.forEach.call(scope.querySelectorAll('[data-i18n-html]'), function (el) {
      el.innerHTML = t(el.getAttribute('data-i18n-html'));
    });

    Array.prototype.forEach.call(scope.querySelectorAll('[data-i18n-a]'), function (el) {
      el.getAttribute('data-i18n-a').split(';').forEach(function (pair) {
        var i = pair.indexOf(':');
        if (i < 0) return;
        el.setAttribute(pair.slice(0, i).trim(), t(pair.slice(i + 1).trim()));
      });
    });
  }

  function applyMeta() {
    /* canonical：zh 指向目录，en 指向 ?lang=en，让英文版自己当自己的规范页，
       避免被当成中文页的重复内容 */
    var link = document.querySelector('link[rel="canonical"]');
    if (link) link.setAttribute('href', lang === 'en' ? CANONICAL_BASE + '?lang=en' : CANONICAL_BASE);

    var ogLocale = document.querySelector('meta[property="og:locale"]');
    if (ogLocale) ogLocale.setAttribute('content', lang === 'en' ? 'en_US' : 'zh_CN');
  }

  function paintToggle() {
    var btn = document.getElementById('lang-toggle');
    if (!btn) return;
    var text = t('lang.btn');
    var span = btn.querySelector('.sl-lang-text');
    if (!span) {
      span = document.createElement('span');
      span.className = 'sl-lang-text';
      btn.appendChild(span);
    }
    span.textContent = text;
    /* 让屏幕阅读器/断行按目标语言处理这段文字（"EN" 用英文读，"中文" 用中文读） */
    span.setAttribute('lang', t('lang.btn.lang'));
    btn.setAttribute('aria-label', t('lang.aria'));
    btn.setAttribute('title', t('lang.title'));
  }

  function applyAll() {
    document.documentElement.setAttribute('lang', lang === 'en' ? 'en' : 'zh-CN');
    applyStatic();
    applyMeta();
    paintToggle();
    /* 已应用完成，解除首帧遮罩（见 index.html 的预初始化脚本） */
    document.documentElement.classList.remove('sl-lang-init');
  }

  /* ======================================================================
     切换
     ====================================================================== */
  function syncQuery(next) {
    if (!history.replaceState) return;
    try {
      var p = new URLSearchParams(location.search);
      if (next === 'en') p.set('lang', 'en'); else p.delete('lang');
      var q = p.toString();
      history.replaceState(null, '', location.pathname + (q ? '?' + q : '') + location.hash);
    } catch (e) { /* file:// 或隐私模式忽略 */ }
  }

  function set(next, opts) {
    next = normalize(next) || DEFAULT_LANG;
    opts = opts || {};
    var prev = lang;
    lang = next;
    if (opts.persist !== false) writeStored(next);
    if (opts.url !== false) syncQuery(next);
    applyAll();
    if (prev === next) return;
    if (opts.silent) return;
    try {
      document.dispatchEvent(new CustomEvent('sl:langchange', { detail: { lang: next, prev: prev } }));
    } catch (e) {
      /* 极老的浏览器没有 CustomEvent 构造器 —— 用降级事件 */
      var ev = document.createEvent('Event');
      ev.initEvent('sl:langchange', false, false);
      ev.detail = { lang: next, prev: prev };
      document.dispatchEvent(ev);
    }
  }

  /* ======================================================================
     初始化
     ====================================================================== */
  function init() {
    /* 优先级：URL 显式指定 > 本地记忆 > 页面默认（中文）。
       刻意**不**跟随 navigator.language —— 中文是正本，浏览器语言是 en 的
       中文用户不该被自动翻走。 */
    var fromQuery = readQuery();
    lang = fromQuery || readStored() || DEFAULT_LANG;
    if (fromQuery) writeStored(fromQuery);

    applyAll();

    var btn = document.getElementById('lang-toggle');
    if (btn) {
      btn.addEventListener('click', function () {
        set(lang === 'en' ? 'zh' : 'en');
      });
    }

    /* 多标签页同步，与主题开关一致 */
    window.addEventListener('storage', function (e) {
      if (e.key !== STORE_KEY && e.key !== null) return;
      var v = readStored() || DEFAULT_LANG;
      if (v !== lang) set(v, { persist: false, url: false });
    });

    /* ?lang= 变化（前进/后退、外部改 hash 之外的查询串）也要跟上 */
    window.addEventListener('popstate', function () {
      var q = readQuery() || readStored() || DEFAULT_LANG;
      if (q !== lang) set(q, { persist: true, url: false });
    });
  }

  window.SL_I18N = {
    t: t,
    set: set,
    apply: applyAll,
    getLang: function () { return lang; },
    isEn: function () { return lang === 'en'; },
    /* 供 lab.js 拼 URL：英文时才带 lang 参数，中文保持地址栏干净 */
    queryParam: function () { return lang === 'en' ? { k: 'lang', v: 'en' } : null; },
    /* 给自检用：两个语种的 key 集合必须一一对应，漏翻会静默回落成中文 */
    keys: function (l) { return Object.keys(DICT[l || lang]); },
    has: function (key, l) { return DICT[l || lang].hasOwnProperty(key); },
    SUPPORTED: SUPPORTED
  };

  init();
})();
