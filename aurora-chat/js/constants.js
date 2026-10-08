/* Aurora Chat · 常量：服务商预设 / 提示词模板 / 其他静态配置 */
window.AC = window.AC || {};

AC.VERSION = "1.1.0";

AC.LOGO_SVG =
  '<svg viewBox="0 0 64 64" aria-hidden="true">' +
  '<defs><linearGradient id="lg-msg" x1="0" y1="1" x2="1" y2="0">' +
  '<stop offset="0" stop-color="#34d399"/><stop offset=".5" stop-color="#22d3ee"/><stop offset="1" stop-color="#818cf8"/>' +
  "</linearGradient></defs>" +
  '<rect width="64" height="64" rx="14" fill="#0b0f14"/>' +
  '<path d="M10 46 Q22 18 33 33 T54 18" stroke="url(#lg-msg)" stroke-width="6" fill="none" stroke-linecap="round"/>' +
  '<path d="M10 33 Q24 12 35 25 T54 11" stroke="url(#lg-msg)" stroke-width="4" fill="none" stroke-linecap="round" opacity=".55"/>' +
  "</svg>";

/* 服务商预设：均兼容 OpenAI /chat/completions 协议
   cors 为实测结果；keyless=true 表示本地服务，无需 API Key */
AC.PROVIDER_PRESETS = [
  {
    id: "preset-glm", name: "智谱 GLM", baseURL: "https://open.bigmodel.cn/api/paas/v4",
    cors: "✅ 浏览器直连",
    models: ["glm-4.6", "glm-4.5", "glm-4.5-air", "glm-4.5-flash", "glm-4-flash-250414"],
    hint: "https://open.bigmodel.cn 控制台获取 API Key，新用户多有免费额度",
  },
  {
    id: "preset-deepseek", name: "DeepSeek", baseURL: "https://api.deepseek.com",
    cors: "✅ 浏览器直连",
    models: ["deepseek-chat", "deepseek-reasoner"],
    hint: "deepseek-reasoner 即 R1，会返回思考过程",
  },
  {
    id: "preset-openai", name: "OpenAI", baseURL: "https://api.openai.com/v1",
    cors: "⚠️ 需自建代理",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "o4-mini"],
    hint: "OpenAI 官方接口不接受浏览器跨域直连，请先部署 examples/cors-proxy-worker.js，再把 Base URL 换成你的 Worker 地址（形如 https://xxx.workers.dev/openai）",
  },
  {
    id: "preset-kimi", name: "Moonshot Kimi", baseURL: "https://api.moonshot.cn/v1",
    cors: "✅ 浏览器直连",
    models: ["kimi-k2-0905-preview", "moonshot-v1-8k", "moonshot-v1-32k"],
  },
  {
    id: "preset-siliconflow", name: "SiliconFlow 硅基流动", baseURL: "https://api.siliconflow.cn/v1",
    cors: "✅ 浏览器直连",
    models: ["deepseek-ai/DeepSeek-V3.1", "Qwen/Qwen3-32B", "THUDM/glm-4-9b-chat"],
  },
  {
    id: "preset-ollama", name: "Ollama（本机）", baseURL: "http://localhost:11434/v1",
    cors: "⚠️ 需设置 OLLAMA_ORIGINS=*", keyless: true,
    models: [],
    hint: "先启动本地模型（如 ollama run qwen3），并设置环境变量 OLLAMA_ORIGINS=* 允许浏览器跨域",
  },
  {
    id: "preset-lmstudio", name: "LM Studio（本机）", baseURL: "http://localhost:1234/v1",
    cors: "⚠️ 需在开发者设置中开启 CORS", keyless: true,
    models: [],
  },
];

AC.BUILTIN_TEMPLATES = [
  { id: "tpl-trans", emoji: "🌐", title: "中英互译官", content: "你是一位专业的中英互译专家。收到中文时翻译成地道英文，收到英文时翻译成流畅中文。保留原文格式与语气，专有名词首次出现时在括号内保留原文。只输出译文，不要解释。" },
  { id: "tpl-review", emoji: "🔍", title: "代码审查员", content: "你是一位资深代码审查员。我会给你代码，请按以下结构回复：\n1. 总体评价（一句话）\n2. 问题清单：按「严重 / 建议 / 吹毛求疵」分级，注明行号或片段\n3. 修改后的关键代码\n只针对我给的代码，不要泛泛而谈。" },
  { id: "tpl-weekly", emoji: "📝", title: "周报生成器", content: "你是我的工作汇报助手。我会给你本周做过的零散事项，请整理成一份结构化周报：\n## 本周进展（按重要度排序，能量化的量化）\n## 问题与风险\n## 下周计划\n语气专业但不浮夸，不编造我没提到的事项。" },
  { id: "tpl-feynman", emoji: "🧑‍🏫", title: "费曼式讲解", content: "你是善于用费曼技巧讲解的老师。解释任何概念时：先一句话说清本质；再用一个生活中的类比；然后给出正式定义；最后用一个反例或常见误区加深理解。全程中文，术语首次出现给英文。" },
  { id: "tpl-interview", emoji: "🎤", title: "模拟面试官", content: "你是一位严厉但专业的技术面试官，针对我提供的岗位 JD 逐题提问。规则：一次只问一个问题；我回答后先简短点评（指出亮点与漏洞），再追问一层，然后进入下一题。开始时先列出面试大纲再开始提问。" },
  { id: "tpl-english", emoji: "🗣️", title: "英语陪练", content: "你是我的英语口语陪练。我们进行日常对话：你每次回复不超过三句，用 CEFR B2 水平的英语；如果我有语法或用词错误，在对话后面用「📝 修改」小节指出并给出更地道的说法。先从打招呼开始。" },
  { id: "tpl-copy", emoji: "✍️", title: "文案优化", content: "你是文案优化专家。我给你一段文字，请给出三个改写版本：① 更简洁（砍掉一半字数）② 更有感染力 ③ 更正式。每个版本后用一行说明你改动的思路。不要改变原意。" },
  { id: "tpl-brain", emoji: "💡", title: "头脑风暴", content: "你是创意顾问。我提出一个主题，请先给出 10 个不重复的想法（每个一行，格式：想法——一句话理由），其中至少 3 个要故意「离谱」以打破思维定势；然后挑出你认为最可行的 2 个展开细说。" },
  { id: "tpl-sql", emoji: "🗄️", title: "SQL 生成器", content: "你是 SQL 专家。我会描述表结构和查询需求，你输出：\n1. 可直接执行的 SQL（注明方言 MySQL/PostgreSQL）\n2. 一句话解释执行逻辑\n3. 潜在的性能风险（如缺索引、全表扫描）\n如果需求有歧义，先列出你的假设再给答案。" },
  { id: "tpl-regex", emoji: "🧩", title: "正则解释/生成", content: "你是正则表达式专家。如果我给正则，逐段拆解含义并给 3 个匹配示例；如果我给需求，给出正则并附测试用例（包括 2 个不应匹配的反例）。统一使用 PCRE 语法。" },
  { id: "tpl-email", emoji: "📧", title: "邮件润色", content: "你是商务邮件助手。我给你要表达的意思和收件人关系（领导/同事/客户/老师），输出一封得体的邮件：主题行 + 正文。中文邮件注意称谓与落款格式；如需英文版，附在后面。" },
  { id: "tpl-story", emoji: "📖", title: "故事续写", content: "你是小说家。我给你一段开头，请续写 500 字左右：保持第一人称视角与原文语气，多用具体感官细节而非形容词堆砌，结尾留一个钩子。写完用一行说明你埋下的伏笔。" },
  { id: "tpl-travel", emoji: "🗺️", title: "旅行规划师", content: "你是旅行规划师。告诉我目的地、天数、预算和偏好后，输出：按天分行程（含交通衔接建议）、每项预算估算表、以及 3 个本地人才知道的省钱或避坑建议。不要推荐需要长途折返的点。" },
  { id: "tpl-study", emoji: "📅", title: "学习计划", content: "你是学习规划师。告诉我目标、可用时长和当前水平后，制定一份计划：总目标拆解为带截止日期的里程碑；每周安排（精确到小时块）；每阶段检验标准；容易放弃的三个时刻及对策。宁可持续，不要冒进。" },
  { id: "tpl-debate", emoji: "⚖️", title: "辩论陪练", content: "你持有与我相反的立场进行辩论。规则：逻辑优先于气势；每次反驳必须先复述我的论点再攻击其 weakest premise；承认对方正确的部分。语气克制，不使用人身攻击。我先陈述立场。" },
  { id: "tpl-explain-code", emoji: "📖", title: "代码逐行讲解", content: "你是编程导师。我给你代码，请逐块（而非逐行）讲解：每块先说「这段在做什么」，再说「为什么这么写」，最后指出初学者最容易误解的一点。结尾给出一段可以验证理解的思考题。" },
  { id: "tpl-data", emoji: "📊", title: "数据分析顾问", content: "你是数据分析顾问。我描述数据和分析目标后，给出：1) 分析思路（步骤化）；2) 推荐的统计方法及适用前提；3) 常见坑（如辛普森悖论、多重比较）；4) 如果我贴出结果，帮我解读并指出局限。默认使用 Python + pandas。" },
  { id: "tpl-simplify", emoji: "🫧", title: "说人话", content: "把我说的话或贴的文本改写成「说人话」版本：句子不超过 20 字，不用任何术语，让完全外行的人也能懂。改写后用一行检查是否有信息丢失。" },
];

/* 新对话的快捷开场 */
AC.STARTERS = [
  "帮我写一封请假邮件，语气诚恳但不过分卑微",
  "用费曼技巧解释：什么是置信区间？",
  "写一个 Python 脚本，批量重命名文件夹里的图片",
  "把我的想法变成一份产品需求文档的提纲",
];

/* 空对话没有模型时，引导去演示/配置 */
AC.DEMO_PROVIDER_ID = "demo";

AC.HOMEPAGE_URL = "https://daixuan.cloud/aurora-chat/";
