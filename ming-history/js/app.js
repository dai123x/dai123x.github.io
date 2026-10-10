/* 明史资料平台 · 交互逻辑
   纯静态实现，无外部依赖、无网络请求。所有检索、换算与渲染均在本机浏览器内完成。

   架构：
     1) 数据
     2) 工具函数
     3) 主题
     4) 路由 + 按需渲染（首屏只渲染「总览」，其余栏目首次激活时才构建）
     5) 标签栏
     6) 各栏目渲染器（列表类筛选走 DOM 切换，不重建）
     7) 全站检索（命令面板，Ctrl/⌘+K）
     8) 阅读辅助（进度条 / 回到顶部 / 滚动位置记忆）
     9) 本地阅读器
    10) 启动

   附：栏目「权力结构」另有一份体积较大的 OCR 段落语料（js/data-power-text.js），
   不进首屏，仅在进入该栏目后按需注入 <script>，用于段落级检索。 */
(function () {
  "use strict";

  /* ==================== 1. 数据 ==================== */
  const CORE = window.MING_CORE || {};
  const BOOKS = window.MING_BOOKS || [];
  const EMPERORS = CORE.EMPERORS || [];
  const CHRONOLOGY = CORE.CHRONOLOGY || [];
  const COMPARE = CORE.COMPARE || [];
  const THEMES = CORE.THEMES || [];
  const GLOSSARY = CORE.GLOSSARY || [];
  const ERAS = CORE.ERAS || [];
  const RIVAL_ERAS = CORE.RIVAL_ERAS || [];
  const CALENDAR = CORE.CALENDAR || { items: [] };
  const PROVINCES = CORE.PROVINCES || [];
  const NINE_GARRISONS = CORE.NINE_GARRISONS || [];
  const MILITARY_GEO = CORE.MILITARY_GEO || [];
  const PLACES = CORE.PLACES || [];
  const TERRITORY = CORE.TERRITORY || [];
  const NUMBERS = CORE.NUMBERS || { groups: [], legend: [], intro: "", caveat: "" };
  const DEBATES = CORE.DEBATES || [];
  const LINEAGE = CORE.LINEAGE || { trees: [], notes: [] };
  const BIBLIOGRAPHY = CORE.BIBLIOGRAPHY || { groups: [], legend: [], intro: "", note: "", closing: "" };
  const BIB_COUNT = (BIBLIOGRAPHY.groups || []).reduce((n, g) => n + g.items.length, 0);
  const BUREAUCRACY = CORE.BUREAUCRACY || { systems: [], ranks: [], routes: [], notes: [], legend: [], intro: "" };
  const THINKERS = CORE.THINKERS || { schools: [], debates: [], notes: [], legend: [], intro: "" };
  const BZ_OFFICE_COUNT = (BUREAUCRACY.systems || []).reduce((n, s) => n + (s.offices || []).length, 0);
  const TK_COUNT = (THINKERS.schools || []).reduce((n, s) => n + (s.thinkers || []).length, 0);

  /* ==================== 2. 工具 ==================== */
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

  // 事件委托：容器上挂一个监听，按选择器分发，避免每次渲染后重复绑定
  function delegate(root, evt, sel, fn) {
    if (!root) return;
    root.addEventListener(evt, (e) => {
      const el = e.target.closest(sel);
      if (el && root.contains(el)) fn(el, e);
    });
  }
  function debounce(fn, ms) {
    let t = null;
    return function () {
      const args = arguments;
      clearTimeout(t);
      t = setTimeout(() => fn.apply(null, args), ms);
    };
  }
  // 滚动/尺寸类回调用 rAF 合并，避免高频布局抖动
  function raf(fn) {
    let queued = false;
    return function () {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; fn(); });
    };
  }
  const live = (msg) => { const el = $("#live"); if (el) el.textContent = msg; };

  /* ==================== 3. 主题 ==================== */
  function initTheme() {
    const btn = $("#themeBtn");
    const sync = () => {
      const t = document.documentElement.getAttribute("data-theme") || "dark";
      if (btn) {
        btn.textContent = t === "dark" ? "☀" : "☾";
        btn.setAttribute("aria-label", t === "dark" ? "切换到浅色主题" : "切换到深色主题");
      }
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute("content", t === "dark" ? "#0a0e17" : "#f8fafc");
    };
    sync();
    if (!btn) return;
    btn.addEventListener("click", () => {
      const next = (document.documentElement.getAttribute("data-theme") || "dark") === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      try { localStorage.setItem("dx_theme", next); } catch (e) { /* 忽略 */ }
      sync();
      live(next === "dark" ? "已切换到深色主题" : "已切换到浅色主题");
    });
  }

  /* ==================== 4. 路由 + 按需渲染 ==================== */
  const VIEWS = ["overview", "lineage", "chrono", "eras", "bureaucracy", "thinkers", "power", "compare", "index",
    "bibliography", "glossary", "geo", "numbers", "debates", "themes", "charts", "reader"];

  const rendered = Object.create(null);   // 栏目是否已构建
  const scrollMem = Object.create(null);  // 每栏的滚动位置
  let curView = "overview";

  // 各栏目的构建入口（懒执行）
  const BUILD = {
    overview: renderOverview,
    lineage: function () { renderEmperors(); renderTrees(); renderLineageNotes(); },
    chrono: renderChrono,
    eras: renderEras,
    bureaucracy: renderBureaucracy,
    thinkers: renderThinkers,
    power: renderPower,
    compare: renderCompare,
    index: renderIndex,
    bibliography: renderBibliography,
    glossary: renderGlossary,
    geo: renderGeo,
    numbers: renderNumbers,
    debates: renderDebates,
    themes: renderThemes,
    charts: renderCharts,
    reader: initReader,
  };

  function ensure(view, opts) {
    if (rendered[view]) return;
    rendered[view] = true;
    const fn = BUILD[view];
    if (fn) fn(opts || {});
  }

  /* 地址格式：
       #glossary                  → 栏目
       #glossary/gl-12            → 栏目 + 元素 id
       #index/ch:nanming:3        → 栏目 + 章节（需先选中该书）
       #index/sub:nanming:3:5     → 栏目 + 小节（需展开所属章）
  */
  function parseHash() {
    const raw = (location.hash || "").replace(/^#/, "");
    if (!raw) return { view: "overview", anchor: "" };
    const i = raw.indexOf("/");
    const v = i < 0 ? raw : raw.slice(0, i);
    const a = i < 0 ? "" : raw.slice(i + 1);
    return { view: VIEWS.indexOf(v) >= 0 ? v : "overview", anchor: decodeURIComponent(a) };
  }

  function setHash(view, anchor, replace) {
    const h = "#" + view + (anchor ? "/" + encodeURIComponent(anchor) : "");
    if (location.hash === h) return;
    try {
      if (replace) history.replaceState({ view: view, anchor: anchor }, "", h);
      else history.pushState({ view: view, anchor: anchor }, "", h);
    } catch (e) { /* 忽略 */ }
  }

  function syncTabs(view) {
    $$("#tabs .tab").forEach((t) => {
      const on = t.dataset.view === view;
      t.classList.toggle("active", on);
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
    });
    $$(".view").forEach((v) => {
      const on = v.id === "view-" + view;
      v.classList.toggle("active", on);
      v.setAttribute("aria-hidden", String(!on));
    });
  }

  /* go：唯一的导航入口
     opts.source: 'tab' | 'pop' | 'link' | 'init'  */
  function go(view, opts) {
    opts = opts || {};
    const anchor = opts.anchor || "";
    if (VIEWS.indexOf(view) < 0) view = "overview";

    // 离开当前栏目时记住滚动位置
    if (curView && curView !== view) scrollMem[curView] = window.scrollY;

    ensure(view);
    syncTabs(view);
    curView = view;

    // 「权力」栏的段落语料有 1 MB，只在真正进入该栏时才拉。
    // 空闲预渲染会把这个栏目也建出来（只建骨架），若在 renderPower 里无条件 loadPwText()，
    // 等于每次冷启动都白下载 1 MB —— 实测这是首屏 load 的最大单项（线上冷启 ~2.5s）。
    if (view === "power") loadPwText();

    if (opts.push !== false) setHash(view, anchor, opts.replace === true);

    // 标签滚到可见区域（窄屏）。这一步本身也是一次滚动写入，必须排在锚点定位
    // 之前：排在后面会把刚算好的锚点位置覆盖掉，表现为深链有时停在页首。
    const tab = $('#tabs .tab[data-view="' + view + '"]');
    if (tab && tab.scrollIntoView) withInstantScroll(() => tab.scrollIntoView({ block: "nearest", inline: "nearest" }));

    if (anchor) {
      resolveAnchor(view, anchor);
    } else if (opts.source === "pop") {
      jumpTo(scrollMem[view] || 0);   // 返回上一栏要瞬移回原位，不能演动画
    } else {
      jumpTo(0);
    }

    live(($("#tab-" + view) || {}).textContent ? "已切换到" + $("#tab-" + view).textContent + "栏目" : "");
  }

  /* 定位/导航一律「瞬移」，不要动画。
     坑：css 里有 `html{scroll-behavior:smooth}`，而 scrollTo({behavior:"auto"})
     的 auto 是「沿用 CSS 值」而非「瞬间」，所以原来的写法实际会走一段 1—2 秒的
     平滑动画。后果有二：① 深链要等动画跑完才到位；② 动画途中若有第二次滚动
     写入（如 go() 里的标签 scrollIntoView），动画会被中断，页面停在页首。
     这里临时把根元素的 scroll-behavior 压成 auto，做完立刻还原。 */
  function withInstantScroll(fn) {
    const de = document.documentElement;
    const prev = de.style.scrollBehavior;
    de.style.scrollBehavior = "auto";
    try { fn(); } finally { de.style.scrollBehavior = prev; }
  }

  function jumpTo(y) {
    withInstantScroll(() => window.scrollTo({ top: Math.max(0, y), behavior: "auto" }));
  }

  /* 定位到某个条目：滚动 + 闪烁高亮 */
  function unskip(el) {
    // 目标或任一祖先进程可能被 content-visibility 跳过渲染，先解除，否则量出的位置是估算值
    let n = el;
    while (n && n !== document.body) {
      if (n.style && getComputedStyle(n).contentVisibility === "auto") n.style.contentVisibility = "visible";
      n = n.parentElement;
    }
  }

  function reveal(el) {
    if (!el) return;
    unskip(el);
    // 必须瞬移：闪烁环只挂 2400ms，若边走动画边闪，人还在路上高亮就放完了
    jumpTo(el.getBoundingClientRect().top + window.scrollY - 84);
    el.classList.remove("flash");
    void el.offsetWidth;            // 强制重排，让动画可重放
    el.classList.add("flash");
    setTimeout(() => el.classList.remove("flash"), 2400);
  }

  function resolveAnchor(view, anchor) {
    // 章节 / 小节：需要先选中对应书目，再展开所属章
    if (view === "index" && (anchor.indexOf("ch:") === 0 || anchor.indexOf("sub:") === 0)) {
      const book = anchor.split(":")[1];
      selectBook(book, { anchor: anchor });
      return;
    }
    // 普通元素 id
    const el = document.getElementById(anchor);
    if (el) {
      // 折叠容器里的条目先展开
      const holder = el.closest(".emp, .deb, .cmp");
      if (holder && !holder.classList.contains("open")) {
        const head = holder.querySelector(".emp-row, .deb-head, .cmp-head");
        if (head) head.click();
      }
      reveal(el);
    }
  }

  /* 章节索引内的定位：渲染完成后再执行，避免与 selectBook 互相调用 */
  function revealIndexAnchor(a) {
    const p = a.split(":");
    const book = p[1], ci = p[2];
    const ch = document.getElementById("ch-" + book + "-" + ci);
    if (a.indexOf("ch:") === 0) {
      if (ch) reveal(ch);
      return;
    }
    // 小节：先展开所属章，再定位（元素 id 用连字符，不是冒号）
    if (ch && !ch.classList.contains("open")) {
      const head = ch.querySelector(".idx-ch-head");
      if (head && !head.disabled) head.click();
    }
    const el = document.getElementById("sub-" + book + "-" + ci + "-" + p[3]);
    if (el) reveal(el);
    else if (ch) reveal(ch);
  }

  function initRouter() {
    window.addEventListener("popstate", () => {
      const p = parseHash();
      go(p.view, { push: false, source: "pop", anchor: p.anchor });
    });
    const start = parseHash();
    go(start.view, { push: false, source: "init", anchor: start.anchor });
  }

  /* ==================== 5. 标签栏 ==================== */
  function initTabs() {
    const nav = $("#tabs");
    if (!nav) return;

    delegate(nav, "click", ".tab", (t) => {
      if (t.dataset.view === curView) { window.scrollTo({ top: 0, behavior: "smooth" }); return; }
      go(t.dataset.view, { source: "tab" });
    });

    // 方向键在标签间移动（roving tabindex）
    nav.addEventListener("keydown", (e) => {
      const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
      if (keys.indexOf(e.key) < 0) return;
      const tabs = $$("#tabs .tab");
      const i = tabs.indexOf(document.activeElement);
      if (i < 0) return;
      e.preventDefault();
      let n = i;
      if (e.key === "ArrowLeft") n = (i - 1 + tabs.length) % tabs.length;
      else if (e.key === "ArrowRight") n = (i + 1) % tabs.length;
      else if (e.key === "Home") n = 0;
      else n = tabs.length - 1;
      tabs[n].focus();
      go(tabs[n].dataset.view, { source: "tab" });
    });

    // 窄屏标签栏横向滚动渐隐提示
    const sync = () => {
      nav.classList.toggle("more-right", nav.scrollWidth - nav.clientWidth - nav.scrollLeft > 2);
      nav.classList.toggle("more-left", nav.scrollLeft > 2);
    };
    const onSync = raf(sync);
    nav.addEventListener("scroll", onSync, { passive: true });
    window.addEventListener("resize", onSync);
    sync(); setTimeout(sync, 500);

    window.__mingGo = go;
  }

  /* ==================== 6. 总览 ==================== */
  function renderOverview() {
    const totalCh = BOOKS.reduce((n, b) => n + b.chapters.length, 0);
    const totalPages = BOOKS.reduce((n, b) => n + (b.pages || 0), 0);
    const stats = [
      [BOOKS.length, "部著作 · 已收索引"],
      [totalCh, "章 索引条目"],
      [totalPages.toLocaleString("en-US"), "页 扫描件"],
      [EMPERORS.length, "帝 与监国"],
      [CHRONOLOGY.length, "条 大事年表"],
      [GLOSSARY.length, "条 词条"],
      [ERAS.length, "个 年号"],
      [BZ_OFFICE_COUNT, "个 官职详解"],
      [TK_COUNT, "位 思想家"],
      [((CORE.POWER || {}).themes || []).length, "个 权力结构主题"],
      [DEBATES.length, "组 争议考辨"],
      [BIB_COUNT, "种 延伸书目"],
    ];
    $("#stats").innerHTML = stats.map(([n, k]) =>
      '<div class="stat"><div class="n">' + esc(n) + '</div><div class="k">' + esc(k) + "</div></div>").join("");

    $("#bookGrid").innerHTML = BOOKS.map((b) => `
      <button class="card book-card" data-book="${esc(b.id)}" type="button">
        <div class="vol">${esc(b.vol)}</div>
        <h3>${esc(b.title)}</h3>
        <div class="meta">${esc(b.editor)} · ${esc(b.press)}${b.pages ? " · " + b.pages + " 页" : ""}</div>
        <div class="angle">${esc(b.angle)}</div>
        <p>${esc(b.blurb)}</p>
        <div style="margin-top:auto"><span class="chip accent">看章节索引 →</span></div>
      </button>`).join("");

    delegate($("#bookGrid"), "click", ".book-card", (el) => {
      go("index", { source: "tab", anchor: "ch:" + el.dataset.book + ":0", replace: true });
    });
  }

  /* ==================== 7. 帝王世系 ==================== */
  const AXIS_FROM = 1368, AXIS_TO = 1683;
  let houseFilter = "all", lineageMode = "axis", treeFilter = "all";
  const openEmps = new Set();

  function empBodyHtml(e) {
    return `
      <p class="one">${esc(e.one)}</p>
      ${e.court && e.court.length ? `<h4>朝廷要人</h4><ul class="compact">${e.court.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
      ${e.figures && e.figures.length ? `<h4>名臣名将</h4><div class="emp-tags">${e.figures.map((x) => `<span class="chip">${esc(x)}</span>`).join("")}</div>` : ""}
      <h4>在位大事</h4>
      <ul>${(e.events || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
      ${e.policy && e.policy.length ? `<h4>制度与政策</h4><ul class="compact">${e.policy.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
      ${e.reading ? `<div class="emp-reading"><b>读法提示 · </b>${esc(e.reading)}</div>` : ""}
      <h4>对应章节</h4>
      <div class="emp-refs">${(e.refs || []).map((r) => `<span class="chip">${esc(r)}</span>`).join("")}</div>`;
  }

  /* 表头常驻、正文按需注入：首屏只建 23 个表头，展开哪一个才建哪一段 */
  function renderEmperors() {
    const list = EMPERORS.filter((e) => houseFilter === "all" || e.house === houseFilter);

    const axis = $("#axis");
    const span = AXIS_TO - AXIS_FROM;
    const marks = [1368, 1400, 1450, 1500, 1550, 1600, 1650, 1683].map((y) => {
      const p = ((y - AXIS_FROM) / span) * 100;
      return `<span class="axis-year" style="left:${p.toFixed(3)}%">${y}</span>`;
    }).join("");
    const nodes = list.map((e) => {
      const p = Math.max(0, Math.min(100, ((e.from - AXIS_FROM) / span) * 100));
      return `<button class="axis-node${openEmps.has(e.no) ? " on" : ""}" type="button" style="left:${p.toFixed(3)}%"
        data-no="${e.no}" title="${esc(e.temple + e.name)} ${esc(e.span)}" aria-label="${esc(e.temple + e.name)}"></button>`;
    }).join("");
    // 高亮条覆盖当前筛选出的时间范围
    let fill = "";
    if (list.length) {
      const lo = Math.min.apply(null, list.map((e) => e.from));
      const hi = Math.max.apply(null, list.map((e) => e.to));
      const l = Math.max(0, ((lo - AXIS_FROM) / span) * 100);
      const w = Math.min(100 - l, ((hi - lo) / span) * 100);
      fill = `<div class="axis-fill" style="left:${l.toFixed(3)}%;width:${w.toFixed(3)}%"></div>`;
    }
    axis.innerHTML = `<div class="axis-track"></div>${fill}${marks}${nodes}`;

    $("#empList").innerHTML = list.map((e) => {
      const on = openEmps.has(e.no);
      return `<article class="emp${on ? " open" : ""}" data-no="${e.no}" id="emp-${e.no}">
        <button class="emp-row" type="button" aria-expanded="${on}" aria-controls="empbody-${e.no}">
          <div class="emp-no">${e.no > 100 ? "南" : e.no}</div>
          <div class="emp-main">
            <b><span class="temple">${esc(e.temple)}</span>${esc(e.name)}</b>
            <div class="sub">${esc(e.era)}${e.tomb && e.tomb !== "—" ? " · " + esc(e.tomb) : ""}</div>
          </div>
          <div class="emp-span">${esc(e.span)}<br><span style="color:var(--text-muted)">${esc(e.years)}</span></div>
        </button>
        <div class="emp-body" id="empbody-${e.no}"></div>
      </article>`;
    }).join("");

    // 把已展开的正文补回（筛选切换后保持展开状态）
    list.forEach((e) => {
      if (!openEmps.has(e.no)) return;
      const box = document.getElementById("empbody-" + e.no);
      if (box) box.innerHTML = empBodyHtml(e);
    });
  }

  function toggleEmp(no) {
    const e = EMPERORS.find((x) => x.no === no);
    if (!e) return;
    const art = document.getElementById("emp-" + no);
    const box = document.getElementById("empbody-" + no);
    const head = art && art.querySelector(".emp-row");
    const open = !openEmps.has(no);
    if (open) {
      openEmps.add(no);
      if (box && !box.innerHTML) box.innerHTML = empBodyHtml(e);
    } else {
      openEmps.delete(no);
    }
    if (art) art.classList.toggle("open", open);
    if (head) head.setAttribute("aria-expanded", String(open));
  }

  function initEmpList() {
    const box = $("#empList");
    delegate(box, "click", ".emp-row", (btn) => {
      const no = Number(btn.closest(".emp").dataset.no);
      toggleEmp(no);
      if (openEmps.has(no)) {
        const el = document.getElementById("emp-" + no);
        if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    });
    delegate($("#axis"), "click", ".axis-node", (n) => {
      const no = Number(n.dataset.no);
      if (!openEmps.has(no)) toggleEmp(no);
      const el = document.getElementById("emp-" + no);
      if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
    });
    delegate($("#houseSwitch"), "click", ".pill", (p) => {
      houseFilter = p.dataset.house;
      openEmps.clear();
      $$("#houseSwitch .pill").forEach((x) => x.classList.toggle("active", x === p));
      renderEmperors();
    });
  }

  /* ---- 皇族世系图 ---- */
  function treeNodeHtml(node) {
    const kids = node.children && node.children.length
      ? `<div class="tn-kids">${node.children.map(treeNodeHtml).join("")}</div>` : "";
    return `<div class="tnode${node.reign ? " reign" : " nonreign"}">
      <div class="tn-box">
        <div class="tn-head">
          ${node.title ? `<span class="tn-title">${esc(node.title)}</span>` : ""}
          <b class="tn-name">${esc(node.name)}</b>
          ${node.era ? `<span class="tn-era">${esc(node.era)}</span>` : ""}
          ${node.span ? `<span class="tn-span">${esc(node.span)}</span>` : ""}
        </div>
        ${node.note ? `<p class="tn-note">${esc(node.note)}</p>` : ""}
      </div>
      ${kids}
    </div>`;
  }

  function renderTrees() {
    const trees = (LINEAGE.trees || []).filter((t) => treeFilter === "all" || t.id === treeFilter);
    $("#treeWrap").innerHTML = trees.map((t) => `
      <section class="tree-sec">
        <div class="tree-head">
          <h3>${esc(t.title)}</h3>
          <span class="chip accent">${esc(t.span)}</span>
        </div>
        ${t.note ? `<p class="tree-note">${esc(t.note)}</p>` : ""}
        <div class="tree">${t.roots.map(treeNodeHtml).join("")}</div>
      </section>`).join("") || '<div class="empty">该支系暂无数据</div>';
  }

  function renderLineageNotes() {
    $("#lineageNotes").innerHTML = (LINEAGE.notes || []).map((n) => `
      <div class="rel"><h4>${esc(n.t)}</h4><p>${esc(n.d)}</p></div>`).join("");
  }

  function initLineageMode() {
    delegate($("#lineageMode"), "click", ".pill", (p) => {
      lineageMode = p.dataset.mode;
      $$("#lineageMode .pill").forEach((x) => x.classList.toggle("active", x === p));
      $("#lineageAxisView").style.display = lineageMode === "axis" ? "" : "none";
      $("#lineageTreeView").style.display = lineageMode === "tree" ? "" : "none";
    });
    delegate($("#treeSwitch"), "click", ".pill", (p) => {
      treeFilter = p.dataset.tree;
      $$("#treeSwitch .pill").forEach((x) => x.classList.toggle("active", x === p));
      renderTrees();
    });
  }

  /* ==================== 8. 大事年表 ==================== */
  /* 分期按年代分段，避免「洪武」与「甲申」并排的语义错层 */
  const PERIODS = [
    { id: "元末", from: -Infinity, to: 1367 },
    { id: "洪武", from: 1368, to: 1398 },
    { id: "建文—永乐", from: 1399, to: 1424 },
    { id: "洪熙—宣德", from: 1425, to: 1435 },
    { id: "正统—天顺", from: 1436, to: 1464 },
    { id: "成化—弘治", from: 1465, to: 1505 },
    { id: "正德—嘉靖", from: 1506, to: 1566 },
    { id: "隆庆—万历", from: 1567, to: 1620 },
    { id: "泰昌—崇祯", from: 1621, to: 1644 },
    { id: "南明", from: 1645, to: 1662 },
    { id: "清初", from: 1663, to: Infinity },
  ];
  const periodOf = (y) => (PERIODS.find((p) => y >= p.from && y <= p.to) || {}).id || "其他";
  const CAT_ORDER = ["政治", "军事", "经济", "文化", "对外", "灾异"];
  let chronoEra = "全部", chronoCat = "全部";

  /* 149 行一次性建好，之后筛选只切 class，不再重建 DOM */
  function renderChrono() {
    const used = PERIODS.filter((p) => CHRONOLOGY.some((c) => periodOf(c.y) === p.id)).map((p) => p.id);
    $("#chronoFilters").innerHTML = ["全部"].concat(used).map((e) =>
      `<button class="pill${chronoEra === e ? " active" : ""}" data-era="${esc(e)}" type="button">${esc(e)}</button>`).join("");

    const catsUsed = CAT_ORDER.filter((c) => CHRONOLOGY.some((x) => x.cat === c));
    $("#chronoCatFilters").innerHTML = ["全部"].concat(catsUsed).map((c) =>
      `<button class="pill cat${chronoCat === c ? " active" : ""}" data-cat="${esc(c)}" type="button">${esc(c)}</button>`).join("");

    $("#chronoList").innerHTML = CHRONOLOGY.map((c, i) => `
      <div class="ce${c.key ? " key" : ""}" id="ce-${i}" data-era="${esc(periodOf(c.y))}" data-cat="${esc(c.cat || "")}">
        <div class="y">${c.y}<span class="era">${esc(c.era)}</span>${c.cat ? `<span class="cat-tag" data-cat="${esc(c.cat)}">${esc(c.cat)}</span>` : ""}</div>
        <h3>${esc(c.t)}${c.key ? ' <span class="chip key">节点</span>' : ""}</h3>
        <p>${esc(c.d)}</p>
        ${c.refs && c.refs.length ? `<div class="ce-refs">${c.refs.map((r) => `<span>${esc(r)}</span>`).join("")}</div>` : ""}
      </div>`).join("");

    applyChronoFilter();
  }

  function applyChronoFilter() {
    let shown = 0;
    $$("#chronoList .ce").forEach((el) => {
      const ok = (chronoEra === "全部" || el.dataset.era === chronoEra) &&
        (chronoCat === "全部" || el.dataset.cat === chronoCat);
      el.hidden = !ok;
      if (ok) shown++;
    });
    let empty = $("#chronoEmpty");
    if (!shown) {
      if (!empty) {
        empty = document.createElement("div");
        empty.id = "chronoEmpty";
        empty.className = "empty";
        empty.textContent = "该筛选下暂无条目";
        $("#chronoList").appendChild(empty);
      }
    } else if (empty) empty.remove();
  }

  function initChronoFilters() {
    delegate($("#chronoFilters"), "click", ".pill", (p) => {
      chronoEra = p.dataset.era;
      $$("#chronoFilters .pill").forEach((x) => x.classList.toggle("active", x === p));
      applyChronoFilter();
    });
    delegate($("#chronoCatFilters"), "click", ".pill", (p) => {
      chronoCat = p.dataset.cat;
      $$("#chronoCatFilters .pill").forEach((x) => x.classList.toggle("active", x === p));
      applyChronoFilter();
    });
  }

  /* ==================== 9. 年号纪年 ==================== */
  const GAN = "甲乙丙丁戊己庚辛壬癸";
  const ZHI = "子丑寅卯辰巳午未申酉戌亥";
  const CN = "〇一二三四五六七八九";
  const ganzhiOf = (y) => GAN[(((y - 4) % 10) + 10) % 10] + ZHI[(((y - 4) % 12) + 12) % 12];
  function cnNum(n) {
    if (n <= 0) return String(n);
    if (n < 10) return CN[n];
    if (n === 10) return "十";
    if (n < 20) return "十" + CN[n % 10];
    if (n < 100) { const t = Math.floor(n / 10), o = n % 10; return CN[t] + "十" + (o ? CN[o] : ""); }
    return String(n);
  }
  const yearLabel = (n) => (n === 1 ? "元" : cnNum(n)) + "年";

  function eraRow(e, withHouse) {
    return `<article class="era-row" id="era-${esc(e.era)}">
      <div class="era-name">
        <b>${esc(e.era)}</b>
        ${withHouse ? `<span class="era-house">${esc(e.house)}</span>` : ""}
      </div>
      <div class="era-emp">${esc(e.emp)}</div>
      <div class="era-span">${e.from}${e.to !== e.from ? "—" + e.to : ""}<br><span class="era-n">${e.n > 1 ? e.n + " 年" : "不足一年"}</span></div>
      <p class="era-note">${esc(e.note)}</p>
    </article>`;
  }

  function renderEras() {
    $("#eraTableMing").innerHTML = ERAS.filter((e) => e.house === "明朝").map((e) => eraRow(e, false)).join("");
    $("#eraTableNan").innerHTML = ERAS.filter((e) => e.house !== "明朝").map((e) => eraRow(e, true)).join("");
    $("#eraTableRival").innerHTML = RIVAL_ERAS.map((r, i) => `
      <article class="era-row rival" id="rival-${i}">
        <div class="era-name"><b>${esc(r.regime)}</b></div>
        <div class="era-emp">${esc(r.leader)}<br><span class="era-n">年号：${esc(r.era)}</span></div>
        <div class="era-span">${r.from}—${r.to}</div>
        <p class="era-note">${esc(r.note)}</p>
      </article>`).join("");

    $("#calendarNotes").innerHTML = `<div class="notice" style="margin-bottom:16px">${esc(CALENDAR.intro || "")}</div>` +
      (CALENDAR.items || []).map((n, i) => `
        <div class="rel" id="cal-${i}"><h4>${esc(n.t)}</h4><p>${esc(n.d)}</p></div>`).join("");

    const quick = [1368, 1402, 1421, 1449, 1521, 1567, 1581, 1619, 1644, 1662, 1683];
    $("#gzQuick").innerHTML = quick.map((y) => `<button class="pill tiny" data-y="${y}" type="button">${y}</button>`).join("");
    $("#gzYear").addEventListener("input", updateGz);
    updateGz();
  }

  function initEras() {
    delegate($("#gzQuick"), "click", ".pill", (p) => {
      $("#gzYear").value = p.dataset.y;
      updateGz();
    });
  }

  function updateGz() {
    const raw = parseInt($("#gzYear").value, 10);
    const out = $("#gzOut");
    if (!raw || raw < 1 || raw > 9999) { out.innerHTML = '<span class="gz-hint">请输入 1—9999 之间的公元年份。</span>'; return; }
    const hits = ERAS.filter((e) => raw >= e.from && raw <= e.to);
    out.innerHTML = `
      <div class="gz-main">
        <div class="gz-big"><span class="gz-y">${raw}</span><span class="gz-gz">${ganzhiOf(raw)}</span></div>
        <div class="gz-era">
          ${hits.length ? hits.map((e) => `<div class="gz-hit"><b>${esc(e.era)}${yearLabel(raw - e.from + 1)}</b><span>${esc(e.emp)}</span></div>`).join("")
            : '<div class="gz-hit muted"><b>不在明代年号范围内</b><span>该年无明代年号与之对应</span></div>'}
        </div>
      </div>
      <p class="gz-formula">换算：(公元年 − 4) mod 10 得天干，mod 12 得地支。本例 (${raw} − 4) = ${raw - 4}，${raw - 4} mod 10 = ${(((raw - 4) % 10) + 10) % 10} → ${GAN[(((raw - 4) % 10) + 10) % 10]}；${raw - 4} mod 12 = ${(((raw - 4) % 12) + 12) % 12} → ${ZHI[(((raw - 4) % 12) + 12) % 12]}。</p>`;
  }

  /* ==================== 10. 官僚体系 ==================== */
  const BZ_LVL = { "品级": "ok", "职事官": "mid", "差遣": "low", "加官": "tool" };
  let bzSystem = "全部";

  function bzLadder(chain) {
    return '<div class="bz-ladder">' + (chain || []).map((c, i) =>
      (i ? '<span class="bz-arrow" aria-hidden="true">→</span>' : "") +
      '<span class="bz-node">' + esc(c) + "</span>").join("") + "</div>";
  }

  function bzOfficeHtml(o) {
    return `<article class="bz-office" id="${esc(o.id)}">
      <div class="bz-off-head">
        <b>${esc(o.name)}</b>
        <span class="bz-rank">${esc(o.rank)}</span>
      </div>
      ${o.alias ? `<div class="bz-alias">${esc(o.alias)}</div>` : ""}
      <div class="bz-field"><span class="bz-k">职掌</span><p>${esc(o.duty)}</p></div>
      <div class="bz-field"><span class="bz-k">沿革</span><p>${esc(o.since)}</p></div>
      ${o.holders && o.holders.length ? `<div class="bz-field"><span class="bz-k">代表人物</span><div class="bz-tags">${o.holders.map((h) => `<span class="chip">${esc(h)}</span>`).join("")}</div></div>` : ""}
      ${o.note ? `<div class="bz-note"><b>读法提示 · </b>${esc(o.note)}</div>` : ""}
      ${o.refs && o.refs.length ? `<div class="bz-refs">${o.refs.map((r) => `<span class="chip">${esc(r)}</span>`).join("")}</div>` : ""}
    </article>`;
  }

  function renderBureaucracy() {
    const intro = $("#bzIntro");
    if (intro) intro.textContent = BUREAUCRACY.intro || "";

    $("#bzLegend").innerHTML = (BUREAUCRACY.legend || []).map((l) =>
      `<div class="legend-item"><span class="conf ${BZ_LVL[l.k] || "mid"}">${esc(l.k)}</span><span>${esc(l.d)}</span></div>`).join("");

    const systems = BUREAUCRACY.systems || [];
    $("#bzFilters").innerHTML = ["全部"].concat(systems.map((s) => s.name)).map((k) =>
      `<button class="pill${bzSystem === k ? " active" : ""}" data-sys="${esc(k)}" type="button">${esc(k)}</button>`).join("");

    $("#bzSystems").innerHTML = systems.map((s) => `
      <section class="bz-sec" id="bzs-${esc(s.id)}" data-sys="${esc(s.name)}">
        <div class="bz-sec-head">
          <span class="bz-ico" aria-hidden="true">${esc(s.icon)}</span>
          <h3>${esc(s.name)}</h3>
          <span class="chip">${(s.offices || []).length} 个职位</span>
        </div>
        <p class="bz-sec-note">${esc(s.note)}</p>
        ${bzLadder(s.chain)}
        <div class="bz-offices">${(s.offices || []).map(bzOfficeHtml).join("")}</div>
      </section>`).join("");

    $("#bzRanks").innerHTML = `
      <div class="bz-tablewrap">
        <table class="bz-table">
          <caption>明代文官品级总表（常见官职）</caption>
          <thead><tr><th scope="col">品级</th><th scope="col">主要文职</th><th scope="col">备考</th></tr></thead>
          <tbody>${(BUREAUCRACY.ranks || []).map((r, i) => `
            <tr id="bz-rank-${i}">
              <th scope="row" class="bz-rk">${esc(r.rank)}</th>
              <td class="bz-cv">${esc(r.civil)}</td>
              <td class="bz-nt">${esc(r.note)}</td>
            </tr>`).join("")}</tbody>
        </table>
      </div>`;

    $("#bzRoutes").innerHTML = (BUREAUCRACY.routes || []).map((r, i) =>
      `<div class="rel" id="bz-route-${i}"><h4>${esc(r.t)}</h4><p>${esc(r.d)}</p></div>`).join("");

    $("#bzNotes").innerHTML = (BUREAUCRACY.notes || []).map((n) =>
      `<div class="rel"><h4>${esc(n.t)}</h4><p>${esc(n.d)}</p></div>`).join("");

    applyBzFilter();
  }

  function applyBzFilter() {
    let shown = 0;
    $$("#bzSystems .bz-sec").forEach((el) => {
      const ok = bzSystem === "全部" || el.dataset.sys === bzSystem;
      el.hidden = !ok;
      if (ok) shown++;
    });
    let empty = $("#bzEmpty");
    if (!shown) {
      if (!empty) {
        empty = document.createElement("div");
        empty.id = "bzEmpty"; empty.className = "empty"; empty.textContent = "该体系暂无数据";
        $("#bzSystems").appendChild(empty);
      }
    } else if (empty) empty.remove();
  }

  function initBureaucracy() {
    delegate($("#bzFilters"), "click", ".pill", (p) => {
      bzSystem = p.dataset.sys;
      $$("#bzFilters .pill").forEach((x) => x.classList.toggle("active", x === p));
      applyBzFilter();
    });
  }

  /* ==================== 11. 思想界 ==================== */
  const TK_LVL = { "理学": "ok", "心学": "mid", "气学": "low", "实学": "tool" };
  let tkSchool = "全部";

  function thinkerHtml(k) {
    return `<article class="tk" id="${esc(k.id)}">
      <div class="tk-head">
        <div class="tk-name"><b>${esc(k.name)}</b>${k.courtesy ? `<span class="tk-courtesy">${esc(k.courtesy)}</span>` : ""}</div>
        <span class="tk-life">${esc(k.life)}</span>
      </div>
      <div class="tk-meta"><span class="chip accent">${esc(k.school)}</span><span class="tk-title">${esc(k.title)}</span></div>
      <div class="tk-core">${esc(k.core)}</div>
      <div class="tk-thoughts">
        ${(k.thoughts || []).map((t) => `<div class="tk-th"><b>${esc(t.t)}</b><p>${esc(t.d)}</p></div>`).join("")}
      </div>
      ${k.works && k.works.length ? `<div class="tk-field"><span class="bz-k">代表著作</span><div class="bz-tags">${k.works.map((w) => `<span class="chip">${esc(w)}</span>`).join("")}</div></div>` : ""}
      ${k.legacy ? `<div class="tk-legacy"><b>影响 · </b>${esc(k.legacy)}</div>` : ""}
      ${k.refs && k.refs.length ? `<div class="bz-refs">${k.refs.map((r) => `<span class="chip">${esc(r)}</span>`).join("")}</div>` : ""}
    </article>`;
  }

  function renderThinkers() {
    const intro = $("#tkIntro");
    if (intro) intro.textContent = THINKERS.intro || "";

    $("#tkLegend").innerHTML = (THINKERS.legend || []).map((l) =>
      `<div class="legend-item"><span class="conf ${TK_LVL[l.k] || "mid"}">${esc(l.k)}</span><span>${esc(l.d)}</span></div>`).join("");

    const schools = THINKERS.schools || [];
    $("#tkFilters").innerHTML = ["全部"].concat(schools.map((s) => s.name)).map((k) =>
      `<button class="pill${tkSchool === k ? " active" : ""}" data-school="${esc(k)}" type="button">${esc(k)}</button>`).join("");

    $("#tkSchools").innerHTML = schools.map((s) => `
      <section class="tk-sec" id="tks-${esc(s.id)}" data-school="${esc(s.name)}">
        <div class="tk-sec-head">
          <span class="bz-ico" aria-hidden="true">${esc(s.icon)}</span>
          <h3>${esc(s.name)}</h3>
          <span class="chip">${esc(s.span)}</span>
          <span class="chip">${(s.thinkers || []).length} 位</span>
        </div>
        <p class="bz-sec-note">${esc(s.note)}</p>
        <div class="tk-list">${(s.thinkers || []).map(thinkerHtml).join("")}</div>
      </section>`).join("");

    $("#tkDebates").innerHTML = (THINKERS.debates || []).map((d) => `
      <article class="deb" id="${esc(d.id)}">
        <div class="deb-head-static">
          <span class="deb-tag">${esc(d.tag)}</span>
          <div class="deb-t"><h3>${esc(d.t)}</h3><p class="deb-q">${esc(d.q)}</p></div>
        </div>
        <div class="deb-body-open">
          <div class="deb-sides">${(d.sides || []).map((x) => `<div class="deb-side"><div class="deb-side-name">${esc(x.name)}</div><p>${esc(x.view)}</p></div>`).join("")}</div>
          <div class="deb-status"><b>学界倾向 · </b>${esc(d.status)}</div>
          <div class="deb-refs">${(d.refs || []).map((r) => `<span class="chip">${esc(r)}</span>`).join("")}</div>
        </div>
      </article>`).join("");

    $("#tkNotes").innerHTML = (THINKERS.notes || []).map((n) =>
      `<div class="rel"><h4>${esc(n.t)}</h4><p>${esc(n.d)}</p></div>`).join("");

    applyTkFilter();
  }

  function applyTkFilter() {
    let shown = 0;
    $$("#tkSchools .tk-sec").forEach((el) => {
      const ok = tkSchool === "全部" || el.dataset.school === tkSchool;
      el.hidden = !ok;
      if (ok) shown++;
    });
    let empty = $("#tkEmpty");
    if (!shown) {
      if (!empty) {
        empty = document.createElement("div");
        empty.id = "tkEmpty"; empty.className = "empty"; empty.textContent = "该学派暂无数据";
        $("#tkSchools").appendChild(empty);
      }
    } else if (empty) empty.remove();
  }

  function initThinkers() {
    delegate($("#tkFilters"), "click", ".pill", (p) => {
      tkSchool = p.dataset.school;
      $$("#tkFilters .pill").forEach((x) => x.classList.toggle("active", x === p));
      applyTkFilter();
    });
  }

  /* ==================== 12. 权力结构（方志远） ==================== */
  const POWER = CORE.POWER || { book: {}, parts: [], themes: [], tail: [], legend: [], stats: {} };
  const PW_LVL = { "篇": "ok", "章": "mid", "主题": "low", "段落定位": "tool", "摘句": "mid", "交叉链接": "ok" };
  const PW_TEXT_VER = "20261011_04";
  const PW_SNIP = 56;                 // 检索结果里围绕命中词的摘句窗口
  let pwGroup = "全部";
  let pwText = null, pwTextState = "idle";
  let pwHits = [];

  function pwPartOf(where) {
    const w = String(where || "");
    if (w.indexOf("上篇") === 0) return "上篇";
    if (w.indexOf("中篇") === 0) return "中篇";
    if (w.indexOf("下篇") === 0) return "下篇";
    return "导论";
  }

  /* 交叉链接：类型 → 本站条目 id。延后构建，避免依赖数据加载顺序 */
  const PW_KIND = { bz: ["bureaucracy", "官职"], gl: ["glossary", "词条"], tk: ["thinkers", "思想"], era: ["eras", "年号"] };
  let pwIx = null;

  function pwIndex() {
    if (pwIx) return pwIx;
    const m = { bz: {}, gl: {}, tk: {}, era: {} };
    (BUREAUCRACY.systems || []).forEach((s) => (s.offices || []).forEach((o) => {
      [o.name].concat(o.aka || []).forEach((n) => { if (n && !m.bz[n]) m.bz[n] = o.id; });
    }));
    GLOSSARY.forEach((g, i) => { if (g.t && !m.gl[g.t]) m.gl[g.t] = "gl-" + i; });
    (THINKERS.schools || []).forEach((s) => (s.thinkers || []).forEach((k) => {
      if (k.name && !m.tk[k.name]) m.tk[k.name] = k.id;
    }));
    ERAS.forEach((e) => { if (e.era && !m.era[e.era]) m.era[e.era] = "era-" + e.era; });
    pwIx = m;
    return m;
  }

  function pwLinkHtml(pair) {
    const kind = pair[0], name = pair[1], conf = PW_KIND[kind];
    if (!conf) return "";
    const anchor = (pwIndex()[kind] || {})[name];
    const label = conf[1] + " · " + name;
    if (!anchor) return '<span class="chip pw-chip pw-off" title="本站暂无对应条目">' + esc(label) + "</span>";
    return '<button class="chip pw-chip" type="button" data-jump="' + conf[0] + "|" + esc(anchor) + '">' + esc(label) + "</button>";
  }

  function pwBookHtml() {
    const b = POWER.book || {}, st = POWER.stats || {};
    return `<div class="pw-book">
      <div class="pw-book-main">
        <h3>${esc(b.title)}</h3>
        <p class="pw-book-meta">${esc(b.author)} 著　${esc(b.press)}　${esc(b.year)}　${esc(b.series || "")}</p>
        <p class="pw-book-meta">ISBN ${esc(b.isbn)}　全书 ${b.pages} 页　${esc(b.words || "")}　${esc(b.price || "")}</p>
      </div>
      <div class="pw-book-stats">
        <div><b>${st.chapters || 0}</b><span>章</span></div>
        <div><b>${st.sections || 0}</b><span>节</span></div>
        <div><b>${st.subs || 0}</b><span>目</span></div>
        <div><b>${st.themes || 0}</b><span>主题</span></div>
        <div><b>${st.paras || 0}</b><span>段落</span></div>
      </div>
    </div>`;
  }

  function pwChapterHtml(c) {
    const secs = (c.sections || []).map((s) => `
      <li><span class="pw-sec-no">${esc(s.no)}</span><span class="pw-sec-t">${esc(s.title)}</span><span class="pw-pg">p.${s.page}</span>
        ${(s.subs || []).length ? `<ul class="pw-subs">${s.subs.map((x) => `<li><span>${esc(x.no)}、${esc(x.title)}</span><span class="pw-pg">p.${x.page}</span></li>`).join("")}</ul>` : ""}
      </li>`).join("");
    return `<details class="pw-ch" id="pwc-${esc(c.id)}">
      <summary>
        <span class="pw-ch-no">${esc(c.no || "导论")}</span>
        <span class="pw-ch-t">${esc(c.title)}</span>
        <span class="pw-pg">p.${c.page}</span>
      </summary>
      <p class="pw-ch-gist">${esc(c.gist)}</p>
      ${secs ? `<ul class="pw-secs">${secs}</ul>` : ""}
      <div class="pw-ch-meta">本章已索引 ${c.paras || 0} 段</div>
    </details>`;
  }

  function pwPartHtml(p) {
    return `<section class="pw-part" id="pwp-${esc(p.id)}">
      <div class="pw-part-head">
        <h3>${esc(p.name)}</h3>
        <span class="chip">原书 ${esc(p.span)} 页</span>
      </div>
      <p class="pw-part-note">${esc(p.note)}</p>
      <div class="pw-chapters">${(p.chapters || []).map(pwChapterHtml).join("")}</div>
    </section>`;
  }

  function pwRefHtml(r) {
    return `<li><button class="pw-ref" type="button" data-page="${r.page}" data-para="${r.para}">
      <span class="pw-ref-pg">p.${r.page}<i>·${r.para}</i></span>
      <span class="pw-ref-body">
        <span class="pw-ref-ch">${esc(r.ch)}${r.sec ? "　" + esc(r.sec) : ""}</span>
        <span class="pw-ref-snip">${esc(r.snip)}…</span>
      </span>
    </button></li>`;
  }

  function pwThemeHtml(t) {
    const refs = (t.refs || []).map(pwRefHtml).join("");
    const links = (t.links || []).map(pwLinkHtml).join("");
    return `<article class="pw-theme" id="pwt-${esc(t.id)}" data-g="${esc(pwPartOf(t.where))}">
      <div class="pw-th-head">
        <h3>${esc(t.name)}</h3>
        <span class="chip">${esc(t.where)}</span>
      </div>
      <p class="pw-gist">${esc(t.gist)}</p>
      <div class="pw-block">
        <div class="pw-k">方志远的论断<span class="pw-hint">本站转述</span></div>
        <ol class="pw-claims">${(t.claims || []).map((c) => `<li>${esc(c)}</li>`).join("")}</ol>
      </div>
      <div class="pw-block">
        <div class="pw-k">书中位置<span class="pw-hint">点段落定位到全书检索</span></div>
        <ul class="pw-refs">${refs || '<li class="pw-none">未在语料中定位到对应段落</li>'}</ul>
      </div>
      ${links ? `<div class="pw-block"><div class="pw-k">本站相关条目</div><div class="pw-linkrow">${links}</div></div>` : ""}
    </article>`;
  }

  function pwApplyFilter() {
    let shown = 0;
    $$("#pwThemes .pw-theme").forEach((el) => {
      const ok = pwGroup === "全部" || el.dataset.g === pwGroup;
      el.hidden = !ok;
      if (ok) shown++;
    });
    let empty = $("#pwEmpty");
    if (!shown) {
      if (!empty) {
        empty = document.createElement("div");
        empty.id = "pwEmpty"; empty.className = "empty"; empty.textContent = "该篇暂无主题";
        $("#pwThemes").appendChild(empty);
      }
    } else if (empty) empty.remove();
    const cnt = $("#pwCount");
    if (cnt) cnt.textContent = shown + " 个主题";
  }

  function setPwMeta(msg) {
    const el = $("#pwSearchMeta");
    if (el) el.textContent = msg || "";
  }

  /* 段落语料体积较大，进栏目后空闲时才拉取 */
  function loadPwText(cb) {
    if (pwTextState === "ready") { if (cb) cb(); return; }
    if (pwTextState === "loading") return;
    pwTextState = "loading";
    setPwMeta("正在载入全书段落语料…");
    const s = document.createElement("script");
    s.src = "js/data-power-text.js?v=" + PW_TEXT_VER;
    s.onload = () => {
      pwText = (window.MING_CORE && window.MING_CORE.POWER_TEXT) || {};
      pwTextState = "ready";
      const n = Object.keys(pwText).length;
      setPwMeta("语料已就绪：共 " + n + " 页可检索。输入关键词，例如「票拟」「以内制外」「镇守中官」。");
      if (cb) cb();
    };
    s.onerror = () => { pwTextState = "fail"; setPwMeta("段落语料载入失败，请刷新后重试。"); };
    document.head.appendChild(s);
  }

  function pwSearch(q) {
    const toks = q.trim().split(/\s+/).filter(Boolean);
    if (!toks.length) return [];
    if (!pwText) { loadPwText(() => { if (q === $("#pwSearchInput").value) pwRenderHits(q); }); return null; }
    const out = [];
    const pages = Object.keys(pwText);
    for (let k = 0; k < pages.length; k++) {
      const pg = pages[k], rows = pwText[pg];
      for (let j = 0; j < rows.length; j++) {
        const text = rows[j][2];
        let ok = true, sc = 0, first = -1;
        for (let t = 0; t < toks.length; t++) {
          const at = text.indexOf(toks[t]);
          if (at < 0) { ok = false; break; }
          if (first < 0 || at < first) first = at;
          sc += 10 + toks[t].length * 3;
        }
        if (!ok) continue;
        out.push({ page: +pg, para: rows[j][0], head: rows[j][1] === 1, text: text, at: first, sc: sc });
      }
    }
    out.sort((a, b) => (b.sc - a.sc) || (a.page - b.page) || (a.para - b.para));
    return out.slice(0, 60);
  }

  function pwSnippet(text, q) {
    const toks = q.trim().split(/\s+/).filter(Boolean);
    let at = -1;
    for (const t of toks) { const i = text.indexOf(t); if (i >= 0 && (at < 0 || i < at)) at = i; }
    if (at < 0) at = 0;
    const from = Math.max(0, at - Math.floor(PW_SNIP / 3));
    let s = text.slice(from, from + PW_SNIP);
    if (from > 0) s = "…" + s;
    if (from + PW_SNIP < text.length) s += "…";
    return hlText(s, q);
  }

  function pwRenderHits(q) {
    const box = $("#pwSearchResults");
    if (!box) return;
    if (!q.trim()) {
      box.innerHTML = "";
      setPwMeta(pwTextState === "ready" ? "语料已就绪，输入关键词开始检索。" : "输入关键词，检索全书段落。");
      return;
    }
    const hits = pwSearch(q);
    if (hits === null) return;             // 语料尚未就绪，回调里会重跑
    pwHits = hits;
    if (!hits.length) {
      box.innerHTML = '<div class="empty">没有命中。OCR 文本可能存在识别误差，可试试更短的词或换一个说法。</div>';
      setPwMeta("0 条");
      return;
    }
    setPwMeta("命中 " + hits.length + " 段（按相关度排序，最多显示 60 条）");
    box.innerHTML = hits.map((h, i) => `
      <article class="pw-hit" id="pwh-${i}">
        <div class="pw-hit-head">
          <button class="pw-hit-pg" type="button" data-page="${h.page}" data-para="${h.para}">p.${h.page} · 第 ${h.para + 1} 段</button>
          ${h.head ? '<span class="chip pw-hit-h">标题行</span>' : ""}
        </div>
        <p class="pw-hit-text">${pwSnippet(h.text, q)}</p>
      </article>`).join("");
  }

  function renderPower(opts) {
    const intro = $("#pwIntro");
    if (intro) intro.textContent = POWER.intro || "";
    $("#pwLegend").innerHTML = (POWER.legend || []).map((l) =>
      `<div class="legend-item"><span class="conf ${PW_LVL[l.k] || "mid"}">${esc(l.k)}</span><span>${esc(l.d)}</span></div>`).join("");
    $("#pwBook").innerHTML = pwBookHtml();

    const parts = POWER.parts || [];
    $("#pwParts").innerHTML = parts.map(pwPartHtml).join("") +
      (POWER.tail || []).map((t) => `<div class="pw-tail" id="pwtl-${esc(t.id)}"><span>${esc(t.name)}</span><span class="pw-pg">p.${t.page}</span></div>`).join("");

    const groups = ["全部", "导论", "上篇", "中篇", "下篇"];
    $("#pwFilters").innerHTML = groups.map((g) =>
      `<button class="pill${pwGroup === g ? " active" : ""}" data-g="${esc(g)}" type="button">${esc(g)}</button>`).join("") +
      '<span class="pw-count" id="pwCount"></span>';

    $("#pwThemes").innerHTML = (POWER.themes || []).map(pwThemeHtml).join("");
    pwApplyFilter();
    setPwMeta("输入关键词，检索全书段落。");
    // 语料不在这里拉：本函数也会被空闲预渲染调用，见 go() 里的说明
    if (!(opts && opts.prefetch)) loadPwText();
  }

  function initPower() {
    delegate($("#pwFilters"), "click", ".pill", (p) => {
      pwGroup = p.dataset.g;
      $$("#pwFilters .pill").forEach((x) => x.classList.toggle("active", x === p));
      pwApplyFilter();
    });

    // 主题里的「书中位置」→ 填进检索框并跑一次，等于把该段所在的页找出来
    delegate($("#pwThemes"), "click", ".pw-ref", (b) => {
      const inp = $("#pwSearchInput");
      if (!inp) return;
      const box = $("#pwSearch");
      if (box && box.scrollIntoView) box.scrollIntoView({ block: "start" });
      inp.value = "p" + b.dataset.page;      // 页码检索占位，实际按页定位
      pwGotoPage(+b.dataset.page, +b.dataset.para);
    });

    delegate($("#pwThemes"), "click", ".pw-chip[data-jump]", (b) => {
      const parts = b.dataset.jump.split("|");
      go(parts[0], { source: "link", anchor: parts[1] });
    });

    delegate($("#pwSearchResults"), "click", ".pw-hit-pg", (b) => {
      pwGotoPage(+b.dataset.page, +b.dataset.para);
    });

    const inp = $("#pwSearchInput");
    if (inp) {
      const run = debounce(() => pwRenderHits(inp.value), 140);
      inp.addEventListener("input", run);
      inp.addEventListener("focus", () => loadPwText());
    }
  }

  /* 按「原书页码 + 段序」定位：语料里的键是 PDF 页序，需加偏移 */
  function pwGotoPage(bookPage, para) {
    if (!pwText) { loadPwText(() => pwGotoPage(bookPage, para)); return; }
    const off = (POWER.book && POWER.book.pdf_offset) || 0;
    const pdfPage = bookPage + off;
    const rows = pwText[String(pdfPage)] || [];
    const i = rows.findIndex((r) => r[0] === para);
    const idx = i < 0 ? 0 : i;
    $("#pwSearchResults").innerHTML = `
      <article class="pw-hit pw-hit-one">
        <div class="pw-hit-head">
          <span class="chip">原书 p.${bookPage}　第 ${para + 1} 段</span>
          <span class="pw-hint">OCR 文本，未逐字校对</span>
        </div>
        <p class="pw-hit-text">${esc((rows[idx] || [null, 0, "（该段未识别到文本）"])[2])}</p>
      </article>`;
    setPwMeta("已定位到原书 p." + bookPage + " 第 " + (para + 1) + " 段。");
  }

  /* ==================== 13. 多书对照 ==================== */
  function renderCompare() {
    $("#cmpList").innerHTML = COMPARE.map((c, i) => `
      <article class="cmp${i === 0 ? " open" : ""}" id="cmp-${esc(c.id)}">
        <button class="cmp-head" type="button" aria-expanded="${i === 0}" aria-controls="cmpbody-${esc(c.id)}">
          <span class="chip accent">${esc(c.era)}</span>
          <h3>${esc(c.title)}</h3>
          <span class="yr">${esc(c.year)}</span>
          <span class="caret" aria-hidden="true">▾</span>
        </button>
        <div class="cmp-body" id="cmpbody-${esc(c.id)}">
          <div class="cmp-views">
            ${c.views.map((v) => `<div class="cmp-view"><div class="src">${esc(v.book)}${v.loc ? " · " + esc(v.loc) : ""}</div><p>${esc(v.text)}</p></div>`).join("")}
          </div>
          <div class="cmp-take"><b>并读提示 · </b>${esc(c.take)}</div>
        </div>
      </article>`).join("");
    delegate($("#cmpList"), "click", ".cmp-head", (h) => {
      const art = h.closest(".cmp");
      const open = art.classList.toggle("open");
      h.setAttribute("aria-expanded", String(open));
    });
  }

  /* ==================== 14. 章节索引 ==================== */
  let curBook = BOOKS.length ? BOOKS[0].id : null;
  let idxQuery = "";

  function selectBook(id, opts) {
    opts = opts || {};
    curBook = id;
    idxQuery = "";
    const q = $("#idxQuery"); if (q) q.value = "";
    renderIndex();
    if (opts.anchor) {
      const a = opts.anchor;
      setTimeout(() => revealIndexAnchor(a), 30);
    }
  }

  function renderIndex() {
    $("#idxSide").innerHTML = BOOKS.map((b) => `
      <button class="idx-book${curBook === b.id ? " active" : ""}" data-book="${esc(b.id)}" type="button" aria-pressed="${curBook === b.id}">
        <b>${esc(b.short)}</b>
        <span>${esc(b.vol)} · ${b.chapters.length} 章${b.noPages ? " · 仅目录" : ""}</span>
      </button>`).join("");

    const b = BOOKS.find((x) => x.id === curBook) || BOOKS[0];
    if (!b) { $("#idxPanel").innerHTML = '<div class="empty">无书目数据</div>'; return; }

    const kw = idxQuery.trim().toLowerCase();
    const hit = (s) => !kw || String(s).toLowerCase().indexOf(kw) >= 0;
    const chapters = b.chapters.map((c, ci) => {
      const subs = (c.s || []).map((s, si) => ({ s, si })).filter((x) => hit(typeof x.s === "string" ? x.s : x.s.t));
      const selfHit = hit(c.t);
      if (kw && !selfHit && !subs.length) return null;
      return { c, ci, subs: kw && !selfHit ? subs : (c.s || []).map((s, si) => ({ s, si })) };
    }).filter(Boolean);

    $("#idxPanel").innerHTML = `
      <h3>${esc(b.title)}</h3>
      <p class="blurb">${esc(b.blurb)}</p>
      <div class="meta">${esc(b.editor)} · ${esc(b.press)}${b.pages ? " · " + b.pages + " 页" : b.noPages ? " · 仅列目录，不标页码" : ""} · 覆盖 ${esc(b.scope)}${b.en ? " · " + esc(b.en) : ""}</div>
      ${b.split ? `<div class="notice" style="margin-bottom:16px">${Object.entries(b.split).map(([k, v]) => `<b>${esc(k)}</b>　${esc(v)}`).join("　｜　")}</div>` : ""}
      ${b.disclaimer ? `<div class="notice" style="margin-bottom:16px">${esc(b.disclaimer)}</div>` : ""}
      <div id="idxChapters">
        ${chapters.length ? chapters.map(({ c, ci, subs }) => {
          const hasSub = subs.length > 0;
          return `<div class="idx-ch${kw ? " open" : ""}" id="ch-${esc(b.id)}-${ci}">
            <button class="idx-ch-head" type="button" ${hasSub ? "" : 'disabled style="cursor:default"'} aria-expanded="${hasSub && kw ? "true" : "false"}">
              <span class="caret" aria-hidden="true">${hasSub ? "▶" : "·"}</span>
              <span class="t">${esc(c.t)}</span>
              ${c.p ? `<span class="pg">p.${c.p}</span>` : ""}
            </button>
            ${c.n ? `<p class="idx-note">${esc(c.n)}</p>` : ""}
            ${hasSub ? `<div class="idx-subs">${subs.map(({ s, si }) => {
              const t = typeof s === "string" ? s : s.t;
              const p = typeof s === "string" ? null : s.p;
              const n = typeof s === "string" ? null : s.n;
              return `<div class="idx-sub" id="sub-${esc(b.id)}-${ci}-${si}">${b.noPages ? "" : (p ? `<span class="pg">${p}</span>` : '<span class="pg">—</span>')}<span>${esc(t)}${n ? `<em class="idx-sub-n">${esc(n)}</em>` : ""}</span></div>`;
            }).join("")}</div>` : ""}
          </div>`;
        }).join("") : '<div class="empty">没有匹配的章节</div>'}
      </div>`;

    if (kw) $$("#idxPanel .idx-ch").forEach((ch) => ch.classList.add("open"));
  }

  function initIndex() {
    delegate($("#idxSide"), "click", ".idx-book", (el) => selectBook(el.dataset.book));
    delegate($("#idxPanel"), "click", ".idx-ch-head", (h) => {
      const ch = h.closest(".idx-ch");
      if (h.disabled) return;
      const open = ch.classList.toggle("open");
      h.setAttribute("aria-expanded", String(open));
    });
    const q = $("#idxQuery");
    if (q) q.addEventListener("input", debounce(() => { idxQuery = q.value; renderIndex(); }, 120));
  }

  /* ==================== 15. 延伸书目 ==================== */
  const LVL_CLASS = { "入门": "ok", "进阶": "mid", "专题": "low", "工具": "tool", "史料": "src" };
  const lvlClass = (k) => LVL_CLASS[k] || "mid";
  let bibLvl = "全部";

  function renderBibliography() {
    const intro = $("#bibIntro");
    if (intro) intro.textContent = BIBLIOGRAPHY.intro || "";
    $("#bibLegend").innerHTML = (BIBLIOGRAPHY.legend || []).map((l) =>
      `<div class="legend-item"><span class="conf ${lvlClass(l.k)}">${esc(l.k)}</span><span>${esc(l.d)}</span></div>`).join("");

    const lvls = ["全部"].concat((BIBLIOGRAPHY.legend || []).map((l) => l.k));
    $("#bibFilters").innerHTML = lvls.map((k) =>
      `<button class="pill${bibLvl === k ? " active" : ""}" data-lvl="${esc(k)}" type="button">${esc(k)}</button>`).join("");

    $("#bibGroups").innerHTML = (BIBLIOGRAPHY.groups || []).map((g, gi) => `
      <section class="bib-group" data-g="${gi}">
        <div class="num-group-head">
          <span class="num-ico">${esc(g.icon)}</span>
          <h3>${esc(g.name)}</h3>
          <span class="chip" data-count></span>
        </div>
        <div class="bib-list">${(g.items || []).map((it, ii) => `
          <article class="bib" id="bib-${gi}-${ii}" data-lvl="${esc(it.lvl)}">
            <div class="bib-top">
              <b class="bib-t">《${esc(it.t)}》</b>
              <span class="conf ${lvlClass(it.lvl)}">${esc(it.lvl)}</span>
              ${it.indexed ? '<span class="chip accent bib-idx">已收作索引</span>' : ""}
            </div>
            <div class="bib-meta">${esc(it.a)}　·　${esc(it.v)}　·　${esc(it.y)}</div>
            <p class="bib-d">${esc(it.d)}</p>
            <p class="bib-use"><b>适合 · </b>${esc(it.use)}</p>
          </article>`).join("")}</div>
      </section>`).join("");

    const cl = $("#bibClosing");
    if (cl) cl.innerHTML = `<b>阅读顺序建议。</b>${esc(String(BIBLIOGRAPHY.closing || "").replace(/^顺序建议：/, ""))}`;

    applyBibFilter();
  }

  function applyBibFilter() {
    let total = 0;
    $$("#bibGroups .bib-group").forEach((sec) => {
      let n = 0;
      $$(".bib", sec).forEach((el) => {
        const ok = bibLvl === "全部" || el.dataset.lvl === bibLvl;
        el.hidden = !ok;
        if (ok) n++;
      });
      sec.hidden = n === 0;
      const c = sec.querySelector("[data-count]");
      if (c) c.textContent = n + " / " + $$(".bib", sec).length + " 种";
      total += n;
    });
    let empty = $("#bibEmpty");
    if (!total) {
      if (!empty) {
        empty = document.createElement("div");
        empty.id = "bibEmpty"; empty.className = "empty"; empty.textContent = "该难度下暂无书目";
        $("#bibGroups").appendChild(empty);
      }
    } else if (empty) empty.remove();
  }

  function initBibliography() {
    delegate($("#bibFilters"), "click", ".pill", (p) => {
      bibLvl = p.dataset.lvl;
      $$("#bibFilters .pill").forEach((x) => x.classList.toggle("active", x === p));
      applyBibFilter();
    });
  }

  /* ==================== 16. 词条库 ==================== */
  let glossCat = "全部", glossKw = "";

  function renderGlossary() {
    const cats = ["全部"].concat(GLOSSARY.map((g) => g.c).filter((v, i, a) => a.indexOf(v) === i));
    $("#glossCats").innerHTML = cats.map((c) =>
      `<button class="pill${glossCat === c ? " active" : ""}" data-cat="${esc(c)}" type="button">${esc(c)}</button>`).join("");

    const kw = glossKw.trim().toLowerCase();
    const hl = (s) => {
      const t = esc(s);
      if (!kw) return t;
      const i = String(s).toLowerCase().indexOf(kw);
      if (i < 0) return t;
      return esc(String(s).slice(0, i)) + "<mark>" + esc(String(s).slice(i, i + kw.length)) + "</mark>" + esc(String(s).slice(i + kw.length));
    };
    const list = GLOSSARY.map((g, i) => ({ g, i })).filter(({ g }) => {
      if (glossCat !== "全部" && g.c !== glossCat) return false;
      if (!kw) return true;
      return (g.t + " " + (g.e || "") + " " + g.d + " " + g.r.join(" ")).toLowerCase().indexOf(kw) >= 0;
    });

    $("#glossCount").textContent = list.length + " 条";
    $("#glossGrid").innerHTML = list.length ? list.map(({ g, i }) => `
      <article class="gi" id="gl-${i}">
        <div class="top"><b>${hl(g.t)}</b>${g.e ? `<span class="e">${hl(g.e)}</span>` : ""}<span class="chip" style="margin-left:auto">${esc(g.c)}</span></div>
        <p>${hl(g.d)}</p>
        <div class="refs">${g.r.map((r) => `<span>${esc(r)}</span>`).join("")}</div>
      </article>`).join("") : '<div class="empty">没有匹配的词条</div>';
  }

  function initGlossary() {
    delegate($("#glossCats"), "click", ".pill", (p) => {
      glossCat = p.dataset.cat;
      $$("#glossCats .pill").forEach((x) => x.classList.toggle("active", x === p));
      renderGlossary();
    });
    const q = $("#glossQuery");
    if (q) q.addEventListener("input", debounce(() => { glossKw = q.value; renderGlossary(); }, 120));
  }

  /* ==================== 17. 舆图政区 ==================== */
  let placeKind = "全部";

  function renderGeo() {
    $("#provGrid").innerHTML = PROVINCES.map((p, i) => `
      <article class="prov" id="prov-${i}">
        <div class="prov-head"><b>${esc(p.name)}</b><span class="chip">${esc(p.seat)}</span></div>
        <p class="prov-area">今地：${esc(p.area)}</p>
        <p class="prov-since">${esc(p.since)}</p>
        <p class="prov-note">${esc(p.note)}</p>
      </article>`).join("");

    $("#garrList").innerHTML = NINE_GARRISONS.map((g, i) => `
      <article class="garr" id="garr-${i}">
        <div class="garr-no">${i + 1}</div>
        <div class="garr-body">
          <div class="garr-head"><b>${esc(g.name)}</b><span class="garr-seat">${esc(g.seat)}</span></div>
          <div class="garr-span">${esc(g.span)}</div>
          <p>${esc(g.note)}</p>
        </div>
      </article>`).join("");

    $("#milGeo").innerHTML = MILITARY_GEO.map((m, i) =>
      `<div class="rel" id="mil-${i}"><h4>${esc(m.t)}</h4><p>${esc(m.d)}</p></div>`).join("");

    const kinds = ["全部"].concat(PLACES.map((p) => p.kind).filter((v, i, a) => a.indexOf(v) === i));
    $("#placeFilters").innerHTML = kinds.map((k) =>
      `<button class="pill${placeKind === k ? " active" : ""}" data-kind="${esc(k)}" type="button">${esc(k)}</button>`).join("");

    $("#placeGrid").innerHTML = PLACES.map((p, i) => `
      <article class="place" id="pl-${i}" data-kind="${esc(p.kind)}">
        <div class="place-head"><b>${esc(p.name)}</b><span class="chip">${esc(p.kind)}</span></div>
        <p>${esc(p.note)}</p>
      </article>`).join("");

    $("#terrList").innerHTML = TERRITORY.map((t, i) => `
      <div class="terr-row" id="terr-${i}">
        <div class="terr-stage">${esc(t.stage)}</div>
        <p>${esc(t.d)}</p>
      </div>`).join("");

    applyPlaceFilter();
  }

  function applyPlaceFilter() {
    $$("#placeGrid .place").forEach((el) => {
      el.hidden = !(placeKind === "全部" || el.dataset.kind === placeKind);
    });
  }

  function initGeo() {
    delegate($("#placeFilters"), "click", ".pill", (p) => {
      placeKind = p.dataset.kind;
      $$("#placeFilters .pill").forEach((x) => x.classList.toggle("active", x === p));
      applyPlaceFilter();
    });
  }

  /* ==================== 18. 数据一览 ==================== */
  const confClass = (k) => (k === "册载" ? "ok" : k === "估算" ? "mid" : "low");

  function renderNumbers() {
    $("#numLegend").innerHTML = (NUMBERS.legend || []).map((l) =>
      `<div class="legend-item"><span class="conf ${confClass(l.k)}">${esc(l.k)}</span><span>${esc(l.d)}</span></div>`).join("");
    $("#numGroups").innerHTML = (NUMBERS.groups || []).map((g, gi) => `
      <section class="num-group">
        <div class="num-group-head"><span class="num-ico">${esc(g.icon)}</span><h3>${esc(g.name)}</h3><span class="chip">${g.items.length} 项</span></div>
        <div class="num-list">
          ${g.items.map((it, ii) => `
            <article class="num-item" id="num-${gi}-${ii}">
              <div class="num-top">
                <span class="num-label">${esc(it.label)}</span>
                <span class="conf ${confClass(it.conf)}">${esc(it.conf)}</span>
              </div>
              <div class="num-value">${esc(it.value)}${it.unit && it.unit !== "—" ? `<span class="num-unit">${esc(it.unit)}</span>` : ""}</div>
              <p class="num-note">${esc(it.note)}</p>
            </article>`).join("")}
        </div>
      </section>`).join("");
    const cav = $("#numCaveat");
    if (cav) cav.innerHTML = `<b>使用提醒。</b>${esc(String(NUMBERS.caveat || "").replace(/^使用提醒：/, ""))}`;
  }

  /* ==================== 19. 争议考辨 ==================== */
  function renderDebates() {
    $("#debList").innerHTML = DEBATES.map((d, i) => `
      <article class="deb${i === 0 ? " open" : ""}" id="deb-${i}">
        <button class="deb-head" type="button" aria-expanded="${i === 0}" aria-controls="debbody-${i}">
          <span class="deb-tag">${esc(d.tag)}</span>
          <div class="deb-t">
            <h3>${esc(d.t)}</h3>
            <p class="deb-q">${esc(d.q)}</p>
          </div>
          <span class="caret" aria-hidden="true">▾</span>
        </button>
        <div class="deb-body" id="debbody-${i}">
          <div class="deb-sides">
            ${d.sides.map((s) => `<div class="deb-side"><div class="deb-side-name">${esc(s.name)}</div><p>${esc(s.view)}</p></div>`).join("")}
          </div>
          <div class="deb-status"><b>学界倾向 · </b>${esc(d.status)}</div>
          <div class="deb-refs">${(d.refs || []).map((r) => `<span class="chip">${esc(r)}</span>`).join("")}</div>
        </div>
      </article>`).join("");
    delegate($("#debList"), "click", ".deb-head", (h) => {
      const art = h.closest(".deb");
      const open = art.classList.toggle("open");
      h.setAttribute("aria-expanded", String(open));
    });
  }

  /* ==================== 20. 主题线索 ==================== */
  const THEME_COLOR = { indigo: "var(--c-indigo)", teal: "var(--c-teal)", amber: "var(--c-amber)", violet: "var(--c-violet)", rose: "var(--c-rose)" };

  function renderThemes() {
    $("#themeGrid").innerHTML = THEMES.map((t) => `
      <article class="thm" id="thm-${esc(t.id)}" style="--tc:${THEME_COLOR[t.color] || "var(--accent-primary)"}">
        <h3>${esc(t.name)}</h3>
        <p class="q">${esc(t.q)}</p>
        <ol>${t.path.map(([a, b]) => `<li><b>${esc(a)}</b>　${esc(b)}</li>`).join("")}</ol>
        <div class="note">${esc(t.note)}</div>
      </article>`).join("");
  }

  /* ==================== 21. 全站检索（命令面板） ==================== */
  let SEARCH_IX = null;
  let palResults = [];
  let palActive = 0;

  function buildSearchIndex() {
    const ix = [];
    const add = (o) => {
      const aka = o.aka && o.aka.length ? " " + o.aka.filter(Boolean).join(" ") : "";
      o.hay = (o.title + aka + " " + (o.sub || "") + " " + (o.text || "")).toLowerCase();
      o.tl = (o.title + aka).toLowerCase();
      o.tt = String(o.title || "").toLowerCase();   // 纯标题，用于「标题完全相等」加权
      o.sl = (o.sub || "").toLowerCase();
      ix.push(o);
    };
    // 由「字／号／世称」推出常用别称，让「王阳明」「李卓吾」「黄梨洲」这类称呼也能命中
    const aliasesOf = (courtesy, name) => {
      const c = courtesy || "", surname = String(name || "").charAt(0), out = [];
      const pick = (re) => { const m = c.match(re); return m ? m[1] : ""; };
      const zi = pick(/字([^，,、]+)/), hao = pick(/号([^，,、]+)/), shi = pick(/世称([^，,、]+?)先生/);
      [[zi], [hao], [shi]].forEach(([v]) => {
        if (!v) return;
        out.push(v);
        if (surname) out.push(surname + v);
      });
      return out;
    };
    // 别名拆分：过长整串无益，过短（单字）会误伤，故只取 2 字以上
    const aliasParts = (o) => (o.aka || []).concat(String(o.alias || "").split(/[·\/、\s]+/))
      .filter((t) => t && t.length >= 2);
    EMPERORS.forEach((e) => add({
      view: "lineage", anchor: "emp-" + e.no, type: "帝王", cat: e.house,
      title: (e.temple || "") + e.name, sub: e.era + " · " + e.span,
      text: [e.one, (e.court || []).join(" "), (e.figures || []).join(" "), (e.policy || []).join(" "), (e.events || []).join(" ")].join(" "),
    }));
    CHRONOLOGY.forEach((c, i) => add({
      view: "chrono", anchor: "ce-" + i, type: "大事", cat: c.cat || "",
      title: c.t, sub: c.y + " · " + c.era, text: c.d,
    }));
    GLOSSARY.forEach((g, i) => add({
      view: "glossary", anchor: "gl-" + i, type: "词条", cat: g.c,
      title: g.t, sub: g.e || "", text: g.d + " " + (g.r || []).join(" "),
    }));
    COMPARE.forEach((c) => add({
      view: "compare", anchor: "cmp-" + c.id, type: "对照", cat: c.era,
      title: c.title, sub: c.year, text: c.views.map((v) => v.book + " " + v.text).join(" ") + " " + c.take,
    }));
    DEBATES.forEach((d, i) => add({
      view: "debates", anchor: "deb-" + i, type: "考辨", cat: d.tag,
      title: d.t, sub: d.q, text: d.sides.map((s) => s.name + s.view).join(" ") + " " + d.status,
    }));
    ERAS.forEach((e) => add({
      view: "eras", anchor: "era-" + e.era, type: "年号", cat: e.house,
      title: e.era, sub: e.emp, text: e.note + " " + e.from + " " + e.to,
    }));
    RIVAL_ERAS.forEach((r, i) => add({
      view: "eras", anchor: "rival-" + i, type: "年号", cat: r.regime,
      title: r.era, sub: r.leader, text: r.note,
    }));
    (CALENDAR.items || []).forEach((n, i) => add({
      view: "eras", anchor: "cal-" + i, type: "纪年", cat: "常识", title: n.t, sub: "", text: n.d,
    }));
    PROVINCES.forEach((p, i) => add({
      view: "geo", anchor: "prov-" + i, type: "政区", cat: "布政使司",
      title: p.name, sub: p.seat, text: p.area + " " + p.since + " " + p.note,
    }));
    NINE_GARRISONS.forEach((g, i) => add({
      view: "geo", anchor: "garr-" + i, type: "九边", cat: "军镇", title: g.name, sub: g.seat, text: g.span + " " + g.note,
    }));
    PLACES.forEach((p, i) => add({
      view: "geo", anchor: "pl-" + i, type: "地名", cat: p.kind, title: p.name, sub: p.kind, text: p.note,
    }));
    TERRITORY.forEach((t, i) => add({
      view: "geo", anchor: "terr-" + i, type: "疆域", cat: t.stage, title: t.stage, sub: "", text: t.d,
    }));
    MILITARY_GEO.forEach((m, i) => add({
      view: "geo", anchor: "mil-" + i, type: "制度", cat: "军事", title: m.t, sub: "", text: m.d,
    }));
    THEMES.forEach((t) => add({
      view: "themes", anchor: "thm-" + t.id, type: "主题", cat: "线索",
      title: t.name, sub: t.q, text: t.path.map((p) => p.join(" ")).join(" ") + " " + t.note,
    }));
    // 数据一览：组 → 每一条数据。此前整栏漏收，导致「数据」在检索索引里是 0 条
    (NUMBERS.groups || []).forEach((g, gi) => (g.items || []).forEach((it, ii) => add({
      view: "numbers", anchor: "num-" + gi + "-" + ii, type: "数据", cat: g.name,
      title: it.label, sub: g.name + " · " + it.conf,
      text: it.value + " " + (it.unit || "") + " " + it.conf + " " + it.note,
    })));
    // 官僚体系：体系 → 职位 → 品级 → 入仕途径
    (BUREAUCRACY.systems || []).forEach((s) => {
      add({
        view: "bureaucracy", anchor: "bzs-" + s.id, type: "官制", cat: s.name,
        title: s.name, sub: (s.offices || []).length + " 个职位",
        text: (s.note || "") + " " + (s.chain || []).join(" ") + " " +
          (s.offices || []).map((o) => o.name + " " + (o.alias || "") + " " + o.duty + " " + o.since).join(" "),
      });
      (s.offices || []).forEach((o) => add({
        view: "bureaucracy", anchor: o.id, type: "官职", cat: s.name,
        title: o.name, sub: o.rank, aka: aliasParts(o),
        text: (o.alias || "") + " " + o.duty + " " + o.since + " " + (o.holders || []).join(" ") + " " + (o.note || ""),
      }));
    });
    (BUREAUCRACY.ranks || []).forEach((r, i) => add({
      view: "bureaucracy", anchor: "bz-rank-" + i, type: "品级", cat: "文官品级",
      title: r.rank, sub: "文官品级", text: r.civil + " " + r.note,
    }));
    (BUREAUCRACY.routes || []).forEach((r, i) => add({
      view: "bureaucracy", anchor: "bz-route-" + i, type: "入仕", cat: "选官途径",
      title: r.t, sub: "入仕途径", text: r.d,
    }));
    // 思想界：学派 → 思想家 → 思想史争议
    (THINKERS.schools || []).forEach((s) => {
      add({
        view: "thinkers", anchor: "tks-" + s.id, type: "学派", cat: s.span,
        title: s.name, sub: s.span + " · " + (s.thinkers || []).length + " 位",
        text: (s.note || "") + " " + (s.thinkers || []).map((k) => k.name + " " + k.core + " " + k.title).join(" "),
      });
      (s.thinkers || []).forEach((k) => add({
        view: "thinkers", anchor: k.id, type: "思想", cat: s.name,
        title: k.name, sub: (k.courtesy || "") + " · " + k.life, aka: aliasesOf(k.courtesy, k.name),
        text: k.title + " " + k.core + " " + (k.thoughts || []).map((t) => t.t + " " + t.d).join(" ") +
          " " + (k.works || []).join(" ") + " " + (k.legacy || "") + " " + k.school,
      }));
    });
    (THINKERS.debates || []).forEach((d) => add({
      view: "thinkers", anchor: d.id, type: "思潮", cat: d.tag,
      title: d.t, sub: d.q, text: (d.sides || []).map((x) => x.name + x.view).join(" ") + " " + d.status,
    }));
    // 权力结构：篇 → 章 → 主题（方志远《明代国家权力结构及运行机制》研读索引）
    (POWER.parts || []).forEach((p) => {
      add({
        view: "power", anchor: "pwp-" + p.id, type: "权力", cat: "篇",
        title: p.name, sub: "原书 " + p.span + " 页",
        text: p.note + " " + (p.chapters || []).map((c) => c.no + c.title + c.gist).join(" "),
      });
      (p.chapters || []).forEach((c) => add({
        view: "power", anchor: "pwc-" + c.id, type: "权力", cat: p.name,
        title: (c.no ? c.no + "　" : "") + c.title, sub: p.name + " · p." + c.page,
        text: c.gist + " " + (c.sections || []).map((s) => s.no + s.title + " " + (s.subs || []).map((x) => x.title).join(" ")).join(" "),
      }));
    });
    (POWER.themes || []).forEach((t) => add({
      view: "power", anchor: "pwt-" + t.id, type: "权力结构", cat: t.where, aka: t.aka || [],
      title: t.name, sub: t.where,
      text: t.gist + " " + (t.claims || []).join(" ") + " " +
        (t.refs || []).map((r) => r.ch + " " + r.sec + " " + r.snip).join(" "),
    }));
    (BIBLIOGRAPHY.groups || []).forEach((g, gi) => (g.items || []).forEach((it, ii) => add({
      view: "bibliography", anchor: "bib-" + gi + "-" + ii, type: "书目", cat: g.name,
      title: it.t, sub: it.a + " · " + it.y, text: it.d + " " + it.use + " " + it.v + " " + it.lvl,
    })));
    BOOKS.forEach((b) => (b.chapters || []).forEach((c, ci) => {
      add({
        view: "index", anchor: "ch:" + b.id + ":" + ci, type: "章节", cat: b.short,
        title: c.t, sub: b.short + (c.p ? " · p." + c.p : ""),
        text: (c.n || "") + " " + (c.s || []).map((s) => (typeof s === "string" ? s : s.t + " " + (s.n || ""))).join(" "),
      });
      (c.s || []).forEach((s, si) => add({
        view: "index", anchor: "sub:" + b.id + ":" + ci + ":" + si, type: "小节", cat: b.short,
        title: typeof s === "string" ? s : s.t,
        sub: b.short + " · " + c.t + (typeof s === "string" ? "" : (s.p ? " · p." + s.p : "")),
        text: c.t + " " + (c.n || "") + " " + (typeof s === "string" ? "" : (s.n || "")),
      }));
    }));
    // 图表栏：标题取自 CH_TITLE（与渲染同源），便于直接搜「图表」「构成」跳过去
    CH_GROUPS_META.forEach(([gname, ids]) => ids.forEach((n) => add({
      view: "charts", anchor: "ch-" + n, type: "图表", cat: gname,
      title: CH_TITLE[n], sub: gname, text: "本站内容统计 数据图 图表 构成 分布 " + gname,
    })));
    return ix;
  }

  /* 打分：标题命中权重最高，其次副标题，再次正文；多词按 AND 匹配 */
  function runSearch(q) {
    const toks = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!toks.length) return [];
    const out = [];
    for (let i = 0; i < SEARCH_IX.length; i++) {
      const e = SEARCH_IX[i];
      let ok = true, score = 0;
      for (let t = 0; t < toks.length; t++) {
        const k = toks[t];
        if (e.tt === k) score += 150;          // 标题与检索词完全相等，优先级最高
        else if (e.tl === k) score += 120;
        else if (e.tl.indexOf(k) === 0) score += 70;
        else if (e.tl.indexOf(k) > 0) score += 42;
        else if (e.sl.indexOf(k) >= 0) score += 16;
        else if (e.hay.indexOf(k) >= 0) score += 7;
        else { ok = false; break; }
      }
      if (!ok) continue;
      // 词条/年号这类短条目在同等命中下更该靠前
      if (e.type === "词条" || e.type === "年号" || e.type === "官职" || e.type === "思想" || e.type === "品级" || e.type === "权力结构") score += 4;
      if (e.type === "章节" || e.type === "小节") score += 1;
      out.push({ e, score, i });
    }
    out.sort((a, b) => (b.score - a.score) || (a.i - b.i));
    return out.slice(0, 60).map((x) => x.e);
  }

  function hlText(s, q) {
    const toks = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    let html = esc(s);
    if (!toks.length) return html;
    // 在已转义的文本上做替换，长词优先，避免嵌套
    const uniq = toks.slice().sort((a, b) => b.length - a.length)
      .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    if (!uniq.length) return html;
    const re = new RegExp("(" + uniq.join("|") + ")", "gi");
    return html.replace(re, "<mark>$1</mark>");
  }

  function snippet(e, q) {
    const toks = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const text = e.text || "";
    let at = -1;
    for (const t of toks) { const i = text.toLowerCase().indexOf(t); if (i >= 0) { at = i; break; } }
    if (at < 0) at = 0;
    const from = Math.max(0, at - 26);
    let s = text.slice(from, from + 96);
    if (from > 0) s = "…" + s;
    if (from + 96 < text.length) s += "…";
    return hlText(s, q);
  }

  function renderPalette() {
    const q = $("#paletteInput").value;
    const box = $("#paletteResults");
    if (!q.trim()) {
      palResults = [];
      palActive = 0;
      const hints = [
        ["词条", "于谦", "glossary"], ["词条", "一条鞭法", "glossary"], ["年号", "崇祯", "eras"],
        ["大事", "土木之变", "chrono"], ["考辨", "建文", "debates"], ["地名", "山海关", "geo"],
        ["官职", "内阁大学士", "bureaucracy"], ["品级", "正二品", "bureaucracy"],
        ["思想", "王阳明", "thinkers"], ["权力结构", "票拟", "power"], ["权力结构", "以内制外", "power"],
        ["主题", "白银", "themes"], ["书目", "晚明史", "bibliography"],
      ];
      box.innerHTML = '<div class="pal-hint-t">试试这些</div><div class="pal-chips">' +
        hints.map(([t, k]) => `<button class="pal-chip" type="button" data-q="${esc(k)}"><span>${esc(t)}</span>${esc(k)}</button>`).join("") +
        "</div>";
      $("#paletteCount").textContent = "共 " + (SEARCH_IX ? SEARCH_IX.length : 0) + " 条可检索";
      return;
    }
    palResults = runSearch(q);
    palActive = 0;
    if (!palResults.length) {
      box.innerHTML = '<div class="pal-empty">没有匹配的条目。试试更短的关键词，例如「张居正」「白银」「靖难」。</div>';
      $("#paletteCount").textContent = "0 条";
      return;
    }
    box.innerHTML = palResults.map((e, i) => `
      <button class="pal-item${i === 0 ? " on" : ""}" type="button" role="option" aria-selected="${i === 0}" data-i="${i}">
        <span class="pal-type t-${esc(typeKey(e.type))}">${esc(e.type)}</span>
        <span class="pal-main">
          <span class="pal-title">${hlText(e.title, q)}</span>
          <span class="pal-sub">${esc(e.sub || "")}${e.cat ? " · " + esc(e.cat) : ""}</span>
          <span class="pal-snip">${snippet(e, q)}</span>
        </span>
        <span class="pal-go" aria-hidden="true">↵</span>
      </button>`).join("");
    $("#paletteCount").textContent = palResults.length + " 条结果";
  }

  const typeKey = (t) => ({ "帝王": "emp", "大事": "chr", "词条": "glo", "对照": "cmp", "考辨": "deb", "年号": "era", "纪年": "era", "政区": "geo", "九边": "geo", "地名": "geo", "疆域": "geo", "制度": "geo", "主题": "thm", "书目": "bib", "章节": "idx", "小节": "idx", "官制": "bz", "官职": "bz", "品级": "bz", "入仕": "bz", "学派": "tk", "思想": "tk", "思潮": "tk", "权力": "pw", "权力结构": "pw", "图表": "ch", "数据": "num" })[t] || "glo";

  function movePal(d) {
    if (!palResults.length) return;
    palActive = (palActive + d + palResults.length) % palResults.length;
    $$("#paletteResults .pal-item").forEach((el, i) => {
      const on = i === palActive;
      el.classList.toggle("on", on);
      el.setAttribute("aria-selected", String(on));
      if (on) el.scrollIntoView({ block: "nearest" });
    });
  }

  function openPalette() {
    if (!SEARCH_IX) SEARCH_IX = buildSearchIndex();
    const box = $("#palette");
    if (!box || !box.hidden) return;
    box.hidden = false;
    document.body.classList.add("pal-open");
    const inp = $("#paletteInput");
    inp.value = "";
    renderPalette();
    setTimeout(() => inp.focus(), 20);
  }

  function closePalette() {
    const box = $("#palette");
    if (!box || box.hidden) return;
    box.hidden = true;
    document.body.classList.remove("pal-open");
    const btn = $("#searchBtn");
    if (btn) btn.focus();
  }

  function goResult(e) {
    closePalette();
    go(e.view, { source: "link", anchor: e.anchor });
  }

  function initPalette() {
    const box = $("#palette"), inp = $("#paletteInput"), res = $("#paletteResults");

    const openBtn = $("#searchBtn");
    if (openBtn) openBtn.addEventListener("click", openPalette);

    // 全局快捷键：Ctrl/⌘+K 打开；/ 在非输入框内也能打开
    document.addEventListener("keydown", (e) => {
      const inField = /^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || "");
      if ((e.key === "k" || e.key === "K") && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        box.hidden ? openPalette() : closePalette();
        return;
      }
      if (e.key === "/" && !inField && box.hidden) { e.preventDefault(); openPalette(); return; }
      if (box.hidden) return;
      if (e.key === "Escape") { e.preventDefault(); closePalette(); }
      else if (e.key === "ArrowDown") { e.preventDefault(); movePal(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); movePal(-1); }
      else if (e.key === "Enter") {
        e.preventDefault();
        if (palResults.length) goResult(palResults[palActive]);
      }
    });

    if (inp) inp.addEventListener("input", debounce(renderPalette, 90));

    delegate(res, "click", ".pal-chip", (c) => {
      inp.value = c.dataset.q;
      renderPalette();
      inp.focus();
    });
    delegate(res, "click", ".pal-item", (el) => {
      const i = Number(el.dataset.i);
      if (palResults[i]) goResult(palResults[i]);
    });
    delegate(res, "mousemove", ".pal-item", (el) => {
      const i = Number(el.dataset.i);
      if (palResults[i]) ensure(palResults[i].view);   // 悬停即预建目标栏目
      if (i === palActive) return;
      palActive = i;
      $$("#paletteResults .pal-item").forEach((x, k) => {
        x.classList.toggle("on", k === i);
        x.setAttribute("aria-selected", String(k === i));
      });
    });
    delegate(box, "click", "[data-pal-close]", closePalette);
  }

  /* ==================== 22. 阅读辅助 ==================== */
  function initReading() {
    const bar = $("#readbar"), top = $("#toTop");
    const sync = raf(() => {
      const h = document.documentElement;
      const max = h.scrollHeight - h.clientHeight;
      const p = max > 0 ? Math.min(1, h.scrollTop / max) : 0;
      if (bar) bar.style.transform = "scaleX(" + p.toFixed(4) + ")";
      if (top) top.hidden = h.scrollTop < 600;
    });
    window.addEventListener("scroll", sync, { passive: true });
    window.addEventListener("resize", sync);
    if (top) top.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
    sync();
  }

  /* ==================== 23. 本地阅读器 ==================== */
  function initReader() {
    const drop = $("#drop"), input = $("#fileInput"), stage = $("#readerStage");
    const nameEl = $("#readerName"), frameEl = $("#readerFrame"), textEl = $("#readerText");
    const closeBtn = $("#readerClose");
    let url = null;

    function clear() {
      if (url) { URL.revokeObjectURL(url); url = null; }
      frameEl.style.display = "none"; frameEl.src = "about:blank";
      textEl.style.display = "none"; textEl.textContent = "";
      stage.classList.remove("on");
      input.value = "";
    }

    function open(file) {
      if (!file) return;
      clear();
      nameEl.textContent = file.name + " · " + (file.size / 1024).toFixed(0) + " KB";
      const isText = /\.(txt|md|markdown|text|csv|log|json)$/i.test(file.name) || /^text\//.test(file.type);
      if (isText) {
        const fr = new FileReader();
        fr.onload = () => {
          textEl.textContent = String(fr.result || "");
          textEl.style.display = "block";
          stage.classList.add("on");
          live("已载入文本文件 " + file.name);
        };
        fr.onerror = () => { textEl.textContent = "读取失败，请确认文件未损坏。"; textEl.style.display = "block"; stage.classList.add("on"); };
        fr.readAsText(file, "utf-8");
      } else {
        // PDF 等由浏览器内置阅读器在本机渲染，文件不离开设备
        url = URL.createObjectURL(file);
        frameEl.src = url;
        frameEl.style.display = "block";
        stage.classList.add("on");
        live("已载入文件 " + file.name);
      }
    }

    drop.addEventListener("click", () => input.click());
    drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
    input.addEventListener("change", () => open(input.files && input.files[0]));
    ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
    ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
    drop.addEventListener("drop", (e) => {
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      open(f);
    });
    closeBtn.addEventListener("click", clear);
    window.addEventListener("beforeunload", clear);
  }

  /* 空闲预渲染：首屏只建总览，其余栏目在浏览器空闲时后台补建。
     这样既保住首屏轻量，又让真正切过去时几乎零等待。
     注意：ensure 在调用构建函数前就置位 rendered，且构建是同步的，
     不会与用户点击产生交错。 */
  function prefetch() {
    const order = ["lineage", "chrono", "glossary", "geo", "eras", "bureaucracy",
      "thinkers", "power", "numbers", "compare", "debates", "themes", "charts", "index", "bibliography", "reader"];
    let i = 0;
    const step = (deadline) => {
      const t0 = performance.now();
      const budget = deadline && typeof deadline.timeRemaining === "function"
        ? Math.max(8, Math.min(24, deadline.timeRemaining()))
        : 10;
      while (i < order.length && performance.now() - t0 < budget) ensure(order[i++], { prefetch: true });
      if (i < order.length) schedule();
    };
    const schedule = () => {
      if (window.requestIdleCallback) requestIdleCallback(step, { timeout: 900 });
      else setTimeout(() => step(null), 200);
    };
    schedule();
  }

  /* 指针/焦点落在某个标签上时立刻补建，给点击留出提前量 */
  function initHoverPrefetch() {
    const nav = $("#tabs");
    if (!nav) return;
    const warm = (e) => {
      const t = e.target.closest ? e.target.closest(".tab") : null;
      if (!t) return;
      ensure(t.dataset.view);
      // 指针已经停在「权力」标签上，说明多半要进去：这时就开始拉那 1 MB 语料
      if (t.dataset.view === "power") loadPwText();
    };
    nav.addEventListener("pointerover", warm);
    nav.addEventListener("focusin", warm);
  }

  /* ==================== 24. 图表（本站内容统计） ==================== */
  /* 这些图统计的是「本站收录了什么」——是站点的自画像，不是明代史本身的统计量。
     全部在渲染时由上面的数据层现算：数据一改，图跟着变，不留中间文件。
     站点无依赖、无网络请求，所以不用任何图表库：横条 / 柱状 / 堆积都用 div 加百分比
     （文字保持真实 px，窄屏只压条子、不缩字），只有环形用内联 SVG 且环内不放文字，
     因此不受 viewBox 缩放影响。 */

  const CH_COLORS = ["var(--c-indigo)", "var(--c-teal)", "var(--c-amber)", "var(--c-violet)", "var(--c-rose)", "var(--accent-3)"];
  const chCol = (i) => CH_COLORS[i % CH_COLORS.length];
  const chPct = (a, b) => (b ? (a / b * 100).toFixed(1) : "0.0") + "%";
  const chSum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
  const chCount = (arr, f) => arr.reduce((m, x) => { const k = f(x); m[k] = (m[k] || 0) + 1; return m; }, {});
  const chRank = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]);
  const chReign = (e) => e.to - e.from + 1;
  const chSpan = (scope) => { const m = String(scope || "").match(/(\d{4})\s*[—\-–]\s*(\d{4})/); return m ? (+m[2] - +m[1]) : 0; };

  /* 横向条形：一行一类 */
  function chBarH(rows, opts) {
    const o = opts || {};
    const max = o.max || Math.max(1, ...rows.map((r) => r.v));
    const sum = chSum(rows, (r) => r.v);
    return `<div class="ch-bars${o.wide ? " wide" : ""}${o.tight ? " tight" : ""}">`
      + rows.map((r, i) => {
        const col = r.c || o.color || chCol(0);
        const tip = r.tip || (r.l + " " + r.v + (o.unit || "") + (o.pct ? "（" + chPct(r.v, sum) + "）" : ""));
        return `<div class="ch-bar" title="${esc(tip)}">`
          + `<span class="ch-lab">${esc(r.l)}</span>`
          + `<span class="ch-track"><i style="width:${(r.v / max * 100).toFixed(2)}%;background:${col}"></i></span>`
          + `<span class="ch-val">${r.v}${o.unit ? `<em>${esc(o.unit)}</em>` : ""}`
          + (o.pct ? `<b>${chPct(r.v, sum)}</b>` : "") + (r.note ? `<em class="ch-sub">${esc(r.note)}</em>` : "") + `</span>`
          + `</div>`;
      }).join("") + `</div>`;
  }

  /* 纵向柱状：列数少时才用（≤6），否则窄屏标签会挤在一起 */
  function chBarV(cols, opts) {
    const o = opts || {};
    const max = Math.max(1, ...cols.map((c) => c.v));
    const peak = cols.reduce((a, c) => (c.v > a.v ? c : a), cols[0]);
    const mark = o.mark !== false;
    return `<div class="ch-cols"><div class="ch-col-plot">`
      + cols.map((c) => {
        const hi = mark && c.v === peak.v;
        return `<div class="ch-col${hi ? " peak" : ""}" title="${esc(c.tip || c.l + " " + c.v + (o.unit || ""))}">`
          + `<span class="ch-col-v">${c.v}</span>`
          + `<i style="height:calc(${(c.v / max).toFixed(4)} * (100% - 18px));background:${c.c || o.color || chCol(0)}"></i></div>`;
      }).join("")
      + `</div><div class="ch-col-axis">`
      + cols.map((c) => `<span${mark && c.v === peak.v ? ' class="peak"' : ""}>${esc(c.l)}</span>`).join("")
      + `</div></div>`;
  }

  /* 堆积横条：每行一条，条长 = 合计（相对最大值），分段 = 构成 */
  function chStackRows(rows, series, opts) {
    const o = opts || {};
    const max = Math.max(1, ...rows.map((r) => r.total));
    const legend = series.map((s, i) => `<span class="ch-lg"><i style="background:${chCol(i)}"></i>${esc(s)}</span>`).join("");
    return `<div class="ch-stackrows${o.tight ? " tight" : ""}">`
      + rows.map((r) => {
        const tip = `${r.l}：共 ${r.total} 条`
          + series.filter((s) => r.parts[s]).map((s) => `，${s} ${r.parts[s]}`).join("");
        return `<div class="ch-srow" title="${esc(tip)}">`
          + `<span class="ch-lab">${esc(r.l)}</span>`
          + `<span class="ch-strack" style="width:${(r.total / max * 100).toFixed(2)}%">`
          + series.map((s, i) => (r.parts[s] ? `<i style="flex:${r.parts[s]} 0 0;background:${chCol(i)}"></i>` : "")).join("")
          + `</span><span class="ch-val">${r.total}</span></div>`;
      }).join("") + `</div><div class="ch-legend ch-legend-wrap">${legend}</div>`;
  }

  /* 环形：只在环外配图例，环内不放文字 */
  function chDonut(items, opts) {
    const o = opts || {};
    const total = chSum(items, (x) => x.v) || 1;
    const C0 = 60, R = 54, r = 33;
    let acc = 0, paths;
    if (items.length === 1) {
      paths = `<circle cx="${C0}" cy="${C0}" r="${(R + r) / 2}" fill="none" stroke="${items[0].c || chCol(0)}" stroke-width="${R - r}"><title>${esc(items[0].l)} ${items[0].v}</title></circle>`;
    } else {
      paths = items.map((x, i) => {
        const a0 = acc / total * Math.PI * 2 - Math.PI / 2;
        acc += x.v;
        const a1 = acc / total * Math.PI * 2 - Math.PI / 2;
        const big = (a1 - a0) > Math.PI ? 1 : 0;
        const pt = (rad, a) => `${(C0 + rad * Math.cos(a)).toFixed(2)} ${(C0 + rad * Math.sin(a)).toFixed(2)}`;
        return `<path d="M${pt(R, a0)}A${R} ${R} 0 ${big} 1 ${pt(R, a1)}L${pt(r, a1)}A${r} ${r} 0 ${big} 0 ${pt(r, a0)}Z"`
          + ` fill="${x.c || chCol(i)}"><title>${esc(x.l)} ${x.v}（${chPct(x.v, total)}）</title></path>`;
      }).join("");
    }
    const legend = items.map((x, i) =>
      `<span class="ch-lg"><i style="background:${x.c || chCol(i)}"></i>${esc(x.l)}<b>${x.v}</b><em>${chPct(x.v, total)}</em></span>`).join("");
    return `<div class="ch-donut-wrap"><svg class="ch-donut" viewBox="0 0 120 120" role="img"`
      + ` aria-label="${esc(o.aria || "构成占比图")}">${paths}</svg><div class="ch-legend">${legend}</div></div>`;
  }

  /* 时间轴（甘特）：每行一个区间，横轴是年份（也可以是页码）。
     区间用 left/width 百分比定位，因此横轴刻度必须与条形共用同一列网格，
     否则轴和条对不齐——所以刻度行也走 .ch-g-row，只是轨道里放的是刻度而不是条。
     items: [{l, from, to, c?, tip?}]；o.ticks: [{v, l}]；o.series: [{l, c}] 出图例。 */
  function chGantt(items, opts) {
    const o = opts || {};
    const min = o.min != null ? o.min : Math.min(...items.map((x) => x.from));
    const max = o.max != null ? o.max : Math.max(...items.map((x) => x.to));
    const span = Math.max(1, max - min);
    const pos = (v) => ((v - min) / span * 100).toFixed(2);
    const axis = `<div class="ch-g-row ch-g-axis"><span class="ch-lab"></span>`
      + `<span class="ch-g-track">`
      + (o.ticks || []).map((t) => `<span class="ch-g-tick" style="left:${pos(t.v)}%">${esc(t.l)}</span>`).join("")
      + `</span><span class="ch-val"></span></div>`;
    const rows = items.map((x) => {
      const a = (x.from - min) / span * 100;
      const n = x.to - x.from + 1;
      const w = Math.max(0.45, (x.to - min) / span * 100 - a);   // 极短的区间也要看得见
      return `<div class="ch-g-row" title="${esc(x.tip || (x.l + "　" + x.from + "—" + x.to + "（" + n + (o.unit || "年") + "）"))}">`
        + `<span class="ch-lab">${esc(x.l)}</span>`
        + `<span class="ch-g-track"><i style="left:${a.toFixed(2)}%;width:${w.toFixed(2)}%;background:${x.c || chCol(0)}"></i></span>`
        + `<span class="ch-val">${n}${o.unit ? `<em>${esc(o.unit)}</em>` : ""}</span></div>`;
    }).join("");
    const legend = (o.series || []).map((s) => `<span class="ch-lg"><i style="background:${s.c}"></i>${esc(s.l)}</span>`).join("");
    return `<div class="ch-gantt${o.wide ? " wide" : ""}">${axis}${rows}</div>`
      + (legend ? `<div class="ch-legend ch-legend-wrap">${legend}</div>` : "");
  }

  /* 热力图：行 × 列 的交叉表，颜色深浅表示数量。
     刻意不用 color-mix()（老浏览器不认），改成固定 RGB 叠透明度；
     格子里的数字按深浅换色——深底用白字、浅底用主题正文色，明暗两套主题下都读得出来。
     rows: [{l, cells:{列名: 数}}]，cols: [列名]；o.lab 给行标签留多少像素。 */
  const CH_RGB = ["99,102,241", "45,212,191", "245,158,11", "139,92,246", "244,63,94", "56,189,248"];
  function chHeat(rows, cols, opts) {
    const o = opts || {};
    const rgb = CH_RGB[(o.hue || 0) % CH_RGB.length];
    const max = Math.max(1, ...rows.map((r) => Math.max(...cols.map((c) => r.cells[c] || 0))));
    const head = `<div class="ch-hm-row ch-hm-head"><span class="ch-hm-lab"></span>`
      + cols.map((c) => `<span class="ch-hm-col">${esc(c)}</span>`).join("")
      + `<span class="ch-hm-tot">合计</span></div>`;
    const body = rows.map((r) => {
      const tot = chSum(cols, (c) => r.cells[c] || 0);
      return `<div class="ch-hm-row"><span class="ch-hm-lab" title="${esc(r.l)}">${esc(r.l)}</span>`
        + cols.map((c) => {
          const v = r.cells[c] || 0, t = v / max;
          const st = v ? ` style="background:rgba(${rgb},${(0.10 + t * 0.82).toFixed(2)});color:${t > 0.55 ? "#fff" : "var(--text-primary)"}"` : "";
          return `<span class="ch-hm-cell${v ? "" : " zero"}"${st}`
            + ` title="${esc(r.l + " · " + c + "：" + v + (o.unit || ""))}">${v || ""}</span>`;
        }).join("")
        + `<span class="ch-hm-tot">${tot}</span></div>`;
    }).join("");
    return `<div class="ch-heat" style="--ch-hm-n:${cols.length};--ch-hm-lab:${o.lab || 104}px">${head}${body}`
      + (o.note ? `<div class="ch-hm-note">${o.note}</div>` : "") + `</div>`;
  }

  /* 图表清单：标题只在这里写一次，渲染与全站检索共用，免得两处各写一遍后走样 */
  const CH_GROUPS_META = [
    ["本站收录了什么", [1, 2, 16, 17]],
    ["时间轴上的明代", [3, 4, 5, 6, 18, 19]],
    ["权力结构专题的密度", [7, 8, 9, 10, 20]],
    ["词条、数据与书目", [11, 12, 13, 21, 22, 23]],
    ["交叉覆盖", [14, 15, 24]],
  ];
  const CH_TITLE = {
    1: "各栏目条目数", 2: "七部索引书：章数与叙述颗粒度",
    3: "年表的时间密度（每 20 年一桶）", 4: "年表的年代 × 类别构成",
    5: "二十三位帝王在位年数", 6: "年号的时长分布",
    7: "一百个主题在各篇的分布", 8: "各章已索引段落数",
    9: "每个主题的论断条数", 10: "主题交叉链接指向哪里",
    11: "词条库的类别构成", 12: "数据一览的可信度构成",
    13: "延伸书目按难度", 14: "三书对照：各书被引用的次数",
    15: "思想界的学派分布",
    16: "检索索引：十七个栏目各贡献多少条", 17: "检索索引：二十七种条目类型的构成",
    18: "帝王在位时间轴（1368—1683）", 19: "年号起止与「一帝一年号」的例外",
    20: "语料页码覆盖：原书哪些页被引得最密",
    21: "词条的出处覆盖：一条词条靠几本书撑着",
    22: "数据一览：分类 × 可信度", 23: "延伸书目：分类 × 难度",
    24: "思想人物生卒时间轴（1310—1695）",
  };

  function renderCharts() {
    const host = $("#chGroups");
    if (!host) return;

    /* ---- 通用包装：每张图 = 标题 + 图 + 一句解读（数字全部现算，故不会与图脱节） ---- */
    const card = (n, body, note, cls) =>
      `<section class="ch-card${cls ? " " + cls : ""}" id="ch-${n}">
        <h3 class="ch-h">${esc(CH_TITLE[n])}</h3>${body}${note ? `<p class="ch-read">${note}</p>` : ""}</section>`;
    const group = (name, lead, cards) =>
      `<section class="ch-group"><div class="ch-group-head"><h2>${esc(name)}</h2><p>${lead}</p></div>
        <div class="ch-cards">${cards.join("")}</div></section>`;

    const G = [];

    /* ================= 组 A · 本站收录了什么 ================= */
    const chN = chSum(BOOKS, (b) => (b.chapters || []).length);
    const numN = chSum(NUMBERS.groups, (g) => g.items.length);
    const scale = [
      { l: "词条库", v: GLOSSARY.length }, { l: "大事年表", v: CHRONOLOGY.length },
      { l: "章节索引", v: chN }, { l: "权力结构主题", v: POWER.themes.length },
      { l: "数据一览", v: numN }, { l: "延伸书目", v: BIB_COUNT },
      { l: "三书对照", v: COMPARE.length }, { l: "官制条目", v: BZ_OFFICE_COUNT },
      { l: "年号纪年", v: ERAS.length }, { l: "帝王世系", v: EMPERORS.length },
      { l: "思想人物", v: TK_COUNT }, { l: "舆图地名", v: PLACES.length },
      { l: "政区", v: PROVINCES.length }, { l: "争议考辨", v: DEBATES.length },
      { l: "主题线索", v: THEMES.length },
    ].sort((a, b) => b.v - a.v);
    const scaleTotal = chSum(scale, (r) => r.v);
    const top4 = scale.slice(0, 4);
    const top4N = chSum(top4, (r) => r.v);

    const bookRows = BOOKS.map((b) => {
      const n = (b.chapters || []).length, sp = chSpan(b.scope);
      return { l: b.short, v: n, tip: `${b.short}：${n} 章${sp ? "，覆盖 " + sp + " 年" : ""}${sp && n ? "（约 " + (sp / n).toFixed(1) + " 年/章）" : ""}`, note: sp && n ? (sp / n).toFixed(1) + " 年/章" : "" };
    }).sort((a, b) => b.v - a.v);
    const nanming = bookRows.find((r) => r.l === "南明史"), mcn = bookRows.find((r) => r.l === "明朝那些事儿");
    const jy = bookRows.find((r) => r.l === "明史讲义"), wl = bookRows.find((r) => r.l === "万历十五年");
    const wlScope = (BOOKS.find((b) => b.short === "万历十五年") || {}).scope || "";

    /* 检索索引是另一套口径：栏目级条目之外，章节下的小节、官制下的官职等
       「能直接跳过去」的落点也各算一条。两套口径的差，就是本站的索引深度。 */
    if (!SEARCH_IX) SEARCH_IX = buildSearchIndex();
    const ixByView = chCount(SEARCH_IX, (e) => e.view);
    const ixViewRows = VIEWS.map((v) => ({ l: (($("#tab-" + v) || {}).textContent || v), v: ixByView[v] || 0 }))
      .sort((a, b) => b.v - a.v);
    const ixTypeRows = chRank(chCount(SEARCH_IX, (e) => e.type)).map(([k, v]) => ({ l: k, v: v }));
    const ixTop = ixTypeRows[0], ixTop3 = ixTypeRows.slice(0, 3), ixBot = ixTypeRows[ixTypeRows.length - 1];
    const ixTop3N = chSum(ixTop3, (r) => r.v);
    const ixRatio = (SEARCH_IX.length / scaleTotal).toFixed(2);
    const ixZero = ixViewRows.filter((r) => r.v === 0).map((r) => r.l);

    G.push(group("本站收录了什么",
      `先把家底盘清：下表每一格都是「本站自己写下的条目」，不是明代史的统计量。数字全部在打开本页时现算。`,
      [
        card(1, chBarH(scale, { unit: " 条", pct: true }),
          `十五类合计 <b>${scaleTotal}</b> 条。最多的「${scale[0].l}」有 <b>${scale[0].v}</b> 条，占 ${chPct(scale[0].v, scaleTotal)}；`
          + `前四类（${top4.map((r) => r.l).join("、")}）合计 <b>${top4N}</b> 条，占 ${chPct(top4N, scaleTotal)}。`
          + `这个排序说明了本站的定位：它是<b>可检索条目</b>驱动的——设计目标是「查得到」，不是「读得完」。`
          + `反过来看末三位：${scale.slice(-3).map((r) => r.l).join("、")}——这三类不是不重要，`
          + `而是它们最容易写成「有观点没落点」的综述，本站刻意只收到能立条目的程度。`),
        card(2, chBarH(bookRows, { unit: " 章", wide: false }),
          `七部书共 <b>${chN}</b> 章。同样一章，分量差得很远：「${nanming.l}」用 ${nanming.v} 章讲 39 年（${nanming.note}），`
          + `「${mcn.l}」用 ${mcn.v} 章讲 300 年（${mcn.note}），<b>相差约 ${(parseFloat(mcn.note) / parseFloat(nanming.note)).toFixed(0)} 倍</b>。`
          + `这不是篇幅问题，是叙述颗粒度的选择——易代之际的一年，值得写的比承平之世的一年多得多。`
          + `另有两处不能按这个比值读：「${jy.l}」的 ${jy.note} 来自它只有两编、按专题而非按年叙述；`
          + `「${wl.l}」的 scope 直接写成「${wlScope}」，本身就是切一个横断面的书。`
          + `把这类书按「年/章」去比，等于问一本书它不想回答的问题——所以看这张图要区分「书本身短」和「书写得粗」。`),
        card(16, chBarH(ixViewRows, { unit: " 条", pct: true }),
          `同一批内容换一套口径数就变了样：顶栏检索框里是 <b>${SEARCH_IX.length}</b> 条，`
          + `而上面第一张图只有 ${scaleTotal} 条，<b>相差 ${ixRatio} 倍</b>。`
          + `多出来的全在细粒度落点上——「${ixViewRows[0].l}」一栏就有 ${ixViewRows[0].v} 条，`
          + `因为它把每部书的每一章、每一节都算成能跳过去的落点。这不是重复计数，是刻意的：`
          + `检索要能直接跳到<b>某一节</b>，而不是只跳到某个栏目。`
          + `所以两个数字都对，只是回答的问题不同——一个是「站里有多少主题」，一个是「站里有多少落脚点」。`
          + `还要老实交代一处：${ixZero.length ? "「" + ixZero.join("」「") + "」两栏是 0 条" : "每一栏都有条目"}。`
          + `这不是遗漏——总览是入口页、阅读是本地文件阅读器，两者本来就没有可跳转的条目。`
          + `但把这张图画出来确实揪出过一处真遗漏：「数据一览」原本整栏 0 条，61 项数据一条都搜不到，`
          + `本轮已补上（现在 ${ixByView["numbers"]} 条）。这正是这张图的用法——它是一张<b>缺口清单</b>。`),
        card(17, chBarH(ixTypeRows, { unit: " 条", tight: true, pct: true }),
          `${SEARCH_IX.length} 条索引分成 <b>${ixTypeRows.length}</b> 种类型。最大的「${ixTop.l}」有 <b>${ixTop.v}</b> 条，`
          + `占 ${chPct(ixTop.v, SEARCH_IX.length)}；前三类（${ixTop3.map((r) => r.l).join("、")}）合计占 ${chPct(ixTop3N, SEARCH_IX.length)}。`
          + `「${ixTop.l}」压倒性地多，是因为本站把每部书的每一节都当成独立落点，粒度一路压到了「节」。`
          + `另一端，「${ixBot.l}」只有 ${ixBot.v} 条，说明它在站里是「点到为止」的——有，但撑不起一个可以深挖的面。`
          + `所以这张图同时也是<b>一张缺口清单</b>：条数越少的类型，越是下一轮该补的地方。`),
      ]));

    /* ================= 组 B · 时间轴上的明代 ================= */
    const decades = {};
    CHRONOLOGY.forEach((c) => { if (typeof c.y === "number") { const d = Math.floor(c.y / 20) * 20; decades[d] = (decades[d] || 0) + 1; } });
    const decRows = Object.keys(decades).map(Number).sort((a, b) => a - b)
      .map((d) => ({ l: d + "s", v: decades[d], tip: `${d}—${d + 19} 年：${decades[d]} 条` }));
    const decMax = decRows.reduce((a, c) => (c.v > a.v ? c : a), decRows[0]);
    const decMin = decRows.reduce((a, c) => (c.v < a.v ? c : a), decRows[0]);
    const decMid = decRows.filter((r) => r.l >= "1440s" && r.l <= "1580s");
    const decEarly = decRows.filter((r) => r.l >= "1320s" && r.l <= "1420s");
    const decMidN = chSum(decMid, (r) => r.v), decEarlyN = chSum(decEarly, (r) => r.v);
    const decMinAll = decRows.filter((r) => r.v === decMin.v);
    // 按年计的密度比：中段跨 decMid.length×20 年，开国段跨 decEarly.length×20 年
    const decRatio = ((decEarlyN / (decEarly.length * 20)) / (decMidN / (decMid.length * 20))).toFixed(1);

    const ERA_ORDER = ["元末", "洪武", "建文", "永乐", "宣德", "正统", "景泰", "天顺", "成化", "弘治",
      "正德", "嘉靖", "隆庆", "万历", "泰昌", "天启", "崇祯", "南明", "清初"];
    const CATS = ["政治", "军事", "文化", "经济", "对外", "灾异"];
    const stackRows = ERA_ORDER.map((e) => {
      const parts = {};
      CATS.forEach((c) => { parts[c] = CHRONOLOGY.filter((x) => x.era === e && x.cat === c).length; });
      return { l: e, parts: parts, total: chSum(CATS, (c) => parts[c]) };
    }).filter((r) => r.total > 0);
    const catTot = {};
    CATS.forEach((c) => { catTot[c] = chSum(CHRONOLOGY, (x) => (x.cat === c ? 1 : 0)); });
    const nanRow = stackRows.find((r) => r.l === "南明"), hwRow = stackRows.find((r) => r.l === "洪武");

    const empRows = EMPERORS.map((e) => ({
      l: (e.temple || "") + e.name, v: chReign(e),
      c: e.house === "明朝" ? CH_COLORS[0] : e.house === "南明" ? CH_COLORS[2] : CH_COLORS[4],
      tip: `${e.temple || ""}${e.name}　${e.span}　在位 ${chReign(e)} 年　${e.house}`,
    })).sort((a, b) => b.v - a.v);
    const ming = EMPERORS.filter((e) => e.house === "明朝"), nan = EMPERORS.filter((e) => e.house === "南明");
    const mingAvg = (chSum(ming, chReign) / ming.length).toFixed(1);
    const nanAvg = (chSum(nan, chReign) / nan.length).toFixed(1);

    const BINS = [["1 年", 1, 1], ["2—5 年", 2, 5], ["6—15 年", 6, 15], ["16—30 年", 16, 30], ["31 年以上", 31, 9999]];
    const eraCols = BINS.map((b) => {
      const hit = ERAS.filter((e) => { const n = e.n || chReign(e); return n >= b[1] && n <= b[2]; });
      return { l: b[0], v: hit.length, tip: b[0] + "：" + (hit.length ? hit.map((e) => e.era).join("、") : "无") };
    });
    const oneYear = ERAS.filter((e) => (e.n || chReign(e)) === 1);

    /* ---- 时间轴：帝王在位与年号起止。两条轴共用同一套画法，但回答不同的问题 ---- */
    const HOUSE_C = { "明朝": CH_COLORS[0], "南明": CH_COLORS[2], "明郑": CH_COLORS[4] };
    const empLbl = (e) => (e.temple || "") + e.name;
    const empGantt = EMPERORS.map((e) => ({
      l: empLbl(e), from: e.from, to: e.to, c: HOUSE_C[e.house] || CH_COLORS[5],
      tip: `${empLbl(e)}　${e.house}　${e.span}　在位 ${chReign(e)} 年　年号 ${e.era}`,
    }));
    const empTicks = [1368, 1420, 1470, 1520, 1570, 1620, 1683].map((y) => ({ v: y, l: String(y) }));
    // 把 1368—1683 逐年扫一遍，看有没有哪一年「一位在位者都没有」
    const empMin = Math.min(...EMPERORS.map((e) => e.from)), empMax = Math.max(...EMPERORS.map((e) => e.to));
    const covY = new Set();
    EMPERORS.forEach((e) => { for (let y = e.from; y <= e.to; y++) covY.add(y); });
    let uncovered = 0;
    for (let y = empMin; y <= empMax; y++) if (!covY.has(y)) uncovered++;
    // 时间条重叠的组数（南明的并立会贡献很多）
    const empByFrom = EMPERORS.slice().sort((a, b) => a.from - b.from);
    let ovl = 0;
    for (let i = 0; i < empByFrom.length; i++)
      for (let j = i + 1; j < empByFrom.length; j++) if (empByFrom[j].from <= empByFrom[i].to) ovl++;
    const mingSpanY = Math.max(...ming.map((e) => e.to)) - Math.min(...ming.map((e) => e.from)) + 1;
    const nanSpanY = Math.max(...nan.map((e) => e.to)) - Math.min(...nan.map((e) => e.from)) + 1;
    const mingzheng = EMPERORS.find((e) => e.house === "明郑") || EMPERORS[EMPERORS.length - 1];

    const eraGantt = ERAS.map((e) => ({
      l: e.era, from: e.from, to: e.to, c: e.house === "明朝" ? CH_COLORS[0] : CH_COLORS[2],
      tip: `${e.era}（${e.from}—${e.to}，${e.n} 年）　${e.emp}　${e.house}`,
    })).concat(RIVAL_ERAS.map((r) => ({
      l: r.era.split(" →")[0], from: r.from, to: r.to, c: CH_COLORS[4],
      tip: `${r.regime}　${r.era}（${r.from}—${r.to}）　${r.leader}`,
    }))).sort((a, b) => a.from - b.from || b.to - a.to);
    const eraTicks = [1351, 1400, 1450, 1500, 1550, 1600, 1644, 1683].map((y) => ({ v: y, l: String(y) }));
    // 年号表 ↔ 帝王表的对不上的地方
    const empEraSet = new Set(EMPERORS.flatMap((e) => String(e.era || "").split(/[\/、\s]+/).filter(Boolean)));
    const eraNoEmp = ERAS.filter((e) => !empEraSet.has(e.era));
    const empNoEra = EMPERORS.filter((e) => !ERAS.some((x) => x.era === e.era) && e.era && e.era !== "—");
    const eraReign = EMPERORS.find((e) => String(e.era || "").indexOf("正统") >= 0) || EMPERORS[5];   // 英宗：唯一用过两个年号的人

    G.push(group("时间轴上的明代",
      `本站的大事年表收了 ${CHRONOLOGY.length} 条（${Math.min(...CHRONOLOGY.map((c) => c.y))}—${Math.max(...CHRONOLOGY.map((c) => c.y))}）。`
      + `下面看的是「本站选择记录了什么」，而不是明代真实发生过多少事。`,
      [
        card(3, chBarH(decRows, { unit: " 条", tight: true, pct: true }),
          `密度最高的是 <b>${decMax.l}</b>（${decMax.v} 条，占全部的 ${chPct(decMax.v, CHRONOLOGY.length)}）；`
          + `最低的是 ${decMinAll.map((r) => r.l).join(" 与 ")}（各 ${decMin.v} 条）。`
          + `但中段并不空：${decMid.map((r) => r.l).join("、")} 八段合计 ${decMidN} 条，`
          + `与开国六段（${decEarly.map((r) => r.l).join("、")}）的 ${decEarlyN} 条几乎持平。`
          + `差别在跨度——中段跨 ${decMid.length * 20} 年、开国段只跨 ${decEarly.length * 20} 年，`
          + `按年计开国段的密度仍是中段的 <b>${decRatio} 倍</b>。`
          + `所以本站年表既不是「两头重、中间轻」，也不均匀：<b>开国密、中段匀、末段一个尖峰</b>。`
          + `这个形状是编选的结果，不是明代本身的样子——最容易讲清楚的年代，从来不是最热闹的年代。`),
        card(4, chStackRows(stackRows, CATS, { tight: true }),
          `政治与军事合计 <b>${catTot["政治"] + catTot["军事"]}</b> 条，占全部的 ${chPct(catTot["政治"] + catTot["军事"], CHRONOLOGY.length)}；`
          + `灾异只有 ${catTot["灾异"]} 条。而更重要的是构成会随时代翻转：`
          + `「洪武」${hwRow.total} 条里政治 ${hwRow.parts["政治"]} 条（${chPct(hwRow.parts["政治"], hwRow.total)}），是<b>政治年表</b>；`
          + `「南明」${nanRow.total} 条里军事 ${nanRow.parts["军事"]} 条（${chPct(nanRow.parts["军事"], nanRow.total)}），变成了<b>军事年表</b>。`
          + `越接近易代，年表越只剩下打仗这一件事。`
          + `另外「灾异」全站只有 ${catTot["灾异"]} 条，这是最该被点破的一处偏科：`
          + `明代的水旱、蝗疫、地震记录其实极多（黄册与《明实录》里连篇累牍），本站一条都不多收，`
          + `等于把「天」从年表里删掉了——而当时的人并不这么看世界。`),
        card(5, chBarH(empRows, { unit: " 年", tight: true }),
          `二十三位平均在位 <b>${(chSum(EMPERORS, chReign) / EMPERORS.length).toFixed(1)}</b> 年。`
          + `明朝十六帝平均 ${mingAvg} 年、摊在 ${mingSpanY} 年里；南明六帝平均只有 ${nanAvg} 年，`
          + `六个人挤在 ${nanSpanY} 年里，<b>不到前者的三分之一</b>。`
          + `最长与最短相差 ${Math.max(...EMPERORS.map(chReign))} 倍（${empRows[0].l} ${empRows[0].v} 年 vs ${empRows[empRows.length - 1].l} ${empRows[empRows.length - 1].v} 年）。`
          + `还有一条两类都归不进去：明郑（郑成功 · 郑经 · 郑克塽，1661—1683，${chReign(mingzheng)} 年）——`
          + `它奉永历正朔而不另立年号，所以列在这里、但不计入明朝或南明。`
          + `南明的短促不只是军事失败的结果，也是「谁有资格继统」始终无法解决的问题本身。`),
        card(6, chBarV(eraCols, { unit: " 个" }),
          `${ERAS.length} 个年号里，有 <b>${oneYear.length}</b> 个只用了一年（${oneYear.map((e) => e.era).join("、")}），`
          + `另有 ${eraCols[4].v} 个超过 30 年。这并不矛盾：明清行「一帝一年号」之制，年号短多半是<b>皇帝在位短</b>，`
          + `而不是频繁改元——与唐宋动辄十余个年号的情形正好相反。`
          + `所以这张图的分布，本质上和上一张「帝王在位年数」是同一件事的两种画法：`
          + `一个按人数，一个按年号数；两者只有一处不同，就是那位用过两个年号的皇帝。`),
        card(18, chGantt(empGantt, {
          ticks: empTicks, unit: " 年", series: [
            { l: "明朝", c: CH_COLORS[0] }, { l: "南明", c: CH_COLORS[2] }, { l: "明郑", c: CH_COLORS[4] }],
        }),
          `把在位年数摊到时间轴上，三个之前看不出来的事实露了出来。`
          + `① 帝王条<b>并不首尾相接</b>：${EMPERORS.length} 条里有 ${ovl} 组彼此重叠。最刺眼的是${empLbl(eraReign)}`
          + `（${eraReign.span}）那一条把代宗（1450—1457）整段包在里面——中间隔着土木之变与夺门之变，`
          + `一个人当了两次皇帝，中间那次「不在位」是本站唯一用两条年号来记的事。`
          + `② 南明那 ${nan.length} 条几乎全部叠在一起：他们不是依次继位，而是<b>同时并立</b>，`
          + `「南明」与其说是一个朝廷，不如说是几个都想代表明朝的政权在抢同一个名分。`
          + `③ 从 ${empMin} 到 ${empMax} 逐一年查下来，<b>没有一年是空的</b>（断档 ${uncovered} 年）——`
          + `南明的并立与明郑的奉朔把 1662 年之后也接上了，这条轴因此一直连到 1683。`),
        card(19, chGantt(eraGantt, {
          ticks: eraTicks, unit: " 年", series: [
            { l: "明朝年号", c: CH_COLORS[0] }, { l: "南明年号", c: CH_COLORS[2] }, { l: "明初对手政权", c: CH_COLORS[4] }],
        }),
          `${ERAS.length} 个明朝年号，加上明初那 ${RIVAL_ERAS.length} 个对手政权的纪年，摊在同一条轴上。`
          + `① <b>一帝一年号是常态</b>，真正的例外只有${empLbl(eraReign)}一个人：先「正统」后「天顺」，中间被代宗的「景泰」隔开。`
          + `② 最短的年号只有一年（${oneYear.map((e) => e.era).join("、")}）——而最短的皇帝也是这两位，两件事本来就是同一件事。`
          + `③ 左侧那几条短杠是朱元璋还没称帝时的对手（${RIVAL_ERAS.map((r) => r.regime).join("、")}）。`
          + `本站把它们单列而不并进明朝年号，因为「奉谁的正朔」在当时是真问题，不是称呼问题。`
          + `这张图还顺手照出两处表与表之间的对不上：年号「${eraNoEmp.map((e) => e.era).join("、")}」在帝王表里找不到对应条目；`
          + `反过来帝王表的年号字段是自由文本（${empNoEra.map((e) => empLbl(e) + "「" + e.era + "」").join("、")}），`
          + `一格可以写两个年号，而年号表是一年号一条——两边粒度不同。这不是错，但检索时靠字面匹配会漏，记在这里。`),
      ]));

    /* ================= 组 C · 权力结构专题的密度 ================= */
    const pwPartRows = chRank(chCount(POWER.themes, (t) => String(t.where || "").split("·")[0]))
      .map(([k, v]) => ({
        l: k, v: v,
        tip: ((POWER.parts.find((p) => String(p.name).indexOf(k) === 0) || {}).name || k) + "：" + v + " 个主题",
      }));
    const pwTop = pwPartRows[0], pwBot = pwPartRows[pwPartRows.length - 1];
    const pwTopPart = POWER.parts.find((p) => String(p.name).indexOf(pwTop.l) === 0) || { chapters: [] };
    const chRows = [];
    (POWER.parts || []).forEach((p) => (p.chapters || []).forEach((c) => chRows.push({
      l: c.title, v: c.paras, c: p.name === "导论" ? CH_COLORS[3] : chCol(0),
      tip: `${p.name}　${c.title}（原书 p.${c.page} 起）　已索引 ${c.paras} 段`,
    })));
    const chSorted = chRows.slice().sort((a, b) => b.v - a.v);
    const chTop = chSorted[0], chBot = chSorted[chSorted.length - 1];
    const claimCols = [2, 3, 4, 5].map((n) => ({
      l: n + " 条", v: POWER.themes.filter((t) => (t.claims || []).length === n).length,
    }));
    const claimTot = chSum(POWER.themes, (t) => (t.claims || []).length);
    const linkT = chCount(POWER.themes.flatMap((t) => t.links || []), (l) => l[0]);
    const LINK_NAME = { bz: "官制", gl: "词条", era: "年号", tk: "思想" };
    const linkItems = chRank(linkT).map(([k, v]) => ({ l: LINK_NAME[k] || k, v: v }));
    const linkTot = chSum(linkItems, (x) => x.v);
    const lk = (k) => linkT[k] || 0;
    /* 语料页码覆盖：100 个主题的 400 处引用落在原书的哪些页上（20 页一桶） */
    const refPages = POWER.themes.flatMap((t) => (t.refs || []).map((r) => r.page)).filter((p) => typeof p === "number");
    const pgB = {};
    refPages.forEach((p) => { const k = Math.floor((p - 1) / 20) * 20 + 1; pgB[k] = (pgB[k] || 0) + 1; });
    const pgRows = Object.keys(pgB).map(Number).sort((a, b) => a - b)
      .map((k) => ({ l: k + "—" + (k + 19) + " 页", v: pgB[k], tip: `原书 p.${k}—${k + 19}：被引 ${pgB[k]} 处` }));
    const pgMax = pgRows.reduce((a, c) => (c.v > a.v ? c : a), pgRows[0]);
    const pgMin = pgRows.reduce((a, c) => (c.v < a.v ? c : a), pgRows[0]);
    const pgTail = pgRows[pgRows.length - 1];

    G.push(group("权力结构专题的密度",
      `「权力」栏是本站唯一做了段落级索引的专题：方志远《明代国家权力结构及运行机制》全书 ${POWER.stats.pages_ocr} 页经 OCR 入库，`
      + `切出 ${POWER.stats.paras} 段（约 ${(POWER.stats.chars / 10000).toFixed(1)} 万字），再归纳成 ${POWER.themes.length} 个可检索主题。`
      + `这是全站唯一收原书正文的地方，所以下面的数字也比别处更接近「原书长什么样」。`,
      [
        card(7, chBarH(pwPartRows, { unit: " 个", pct: true }),
          `主题重心落在「${pwTop.l}」（${pwTop.v} 个，占 ${chPct(pwTop.v, POWER.themes.length)}），`
          + `最少的是「${pwBot.l}」（${pwBot.v} 个）。这与原书的篇幅分配一致：`
          + `「${pwTop.l}」全篇 ${pwTopPart.chapters.length} 章、${chSum(pwTopPart.chapters, (c) => c.paras)} 段，`
          + `讲的是外廷、内府与科道三方怎么互相咬住——这是全书论证最密的部分，也是明代制度史最容易被讲乱的部分。`
          + `「${pwBot.l}」只有 ${pwBot.v} 个主题，是因为它本身是总纲，负责定框架而不是铺材料。`),
        card(8, chBarH(chSorted, { unit: " 段", wide: true, tight: true }),
          `${POWER.stats.chapters} 章共 ${POWER.stats.paras} 段，平均每章 ${(POWER.stats.paras / POWER.stats.chapters).toFixed(0)} 段。`
          + `最长的「${chTop.l}」有 <b>${chTop.v}</b> 段，最短的「${chBot.l}」只有 ${chBot.v} 段，相差 ${(chTop.v / chBot.v).toFixed(1)} 倍。`
          + `这个分布是原书章节轻重与 OCR 段落切分共同作用的结果——段落数不等于篇幅，`
          + `但它决定了本站能在这个专题上做多细的定位：${chTop.v} 段的一章可以精确定位到某一段，`
          + `${chBot.v} 段的一章则只能定位到章。`),
        card(9, chBarV(claimCols, { unit: " 个" }),
          `${POWER.themes.length} 个主题共转述 ${claimTot} 条书中论断，平均 <b>${(claimTot / POWER.themes.length).toFixed(2)}</b> 条。`
          + `其中 <b>${claimCols[0].v}</b> 个主题只有 2 条，占 ${chPct(claimCols[0].v, POWER.themes.length)}——`
          + `多数主题是「一个界定 + 两条论断」的最小完整单元，而不是长篇综述。`
          + `这是刻意的取舍：宁可多立主题、每条短，也不把检索单元做成摘要。`
          + `代价是深度：只有 ${claimCols[3].v} 个主题攒到了 5 条论断，`
          + `想看一个问题的完整论证链，仍然得回原书。`),
        card(10, chDonut(linkItems, { aria: "权力结构主题交叉链接的栏目构成" }),
          `${linkTot} 条链接里，指向官制 ${lk("bz")} 条、词条 ${lk("gl")} 条，合计占 <b>${chPct(lk("bz") + lk("gl"), linkTot)}</b>；`
          + `年号 ${lk("era")} 条，而指向「思想」的只有 <b>${lk("tk")}</b> 条。`
          + `这暴露出一个真实的结构性缺口：在本书的视角下，制度史与思想史几乎是两条平行的线。`
          + `但也不全是缺口——制度条目天然指向官制与词条，因为「内阁」「司礼监」这类词本来就既是制度概念又是检索词。`
          + `真正该补的是那 ${lk("tk")} 条之外的部分：制度变动与当时人怎么想，本站还没有连起来。`),
        card(20, chBarH(pgRows, { unit: " 处", tight: true }),
          `${POWER.themes.length} 个主题共引用原书 ${refPages.length} 处，落在 p.${Math.min(...refPages)}—${Math.max(...refPages)} 之间。`
          + `最密的是 <b>p.${pgMax.l}</b>（${pgMax.v} 处），最疏的是 p.${pgMin.l}（${pgMin.v} 处）。`
          + `末桶 p.${pgTail.l} 只有 ${pgTail.v} 处：原书正文到 p.${POWER.stats.pages_ocr} 结束，`
          + `最后那段是后记与附录，本站把后记也收进了语料，但没有为它立主题，所以它在这张图上是空的。`
          + `换句话说，这张图量的不是「书里哪里重要」，而是<b>「本站替哪些页建了索引」</b>——`
          + `空白处不代表原书没内容，只代表本站还没在那儿立主题。`),
      ]));

    /* ================= 组 D · 词条、数据与书目 ================= */
    const gloRows = chRank(chCount(GLOSSARY, (g) => g.c)).map(([k, v]) => ({ l: k, v: v }));
    const numItems = NUMBERS.groups.flatMap((g) => g.items);
    const confItems = chRank(chCount(numItems, (i) => i.conf)).map(([k, v]) => ({ l: k, v: v }));
    const bibItems = BIBLIOGRAPHY.groups.flatMap((g) => g.items);
    const lvlRows = chRank(chCount(bibItems, (i) => i.lvl)).map(([k, v]) => ({ l: k, v: v }));

    /* 词条的出处：每条词条背后引了哪几本书 */
    const gloBook = chCount(GLOSSARY.flatMap((g) => g.r || []), (r) => String(r).split(/\s+/)[0]);
    const gloBookRows = chRank(gloBook).map(([k, v]) => ({ l: k, v: v }));
    const gloRefN = chSum(gloBookRows, (r) => r.v);
    const gloPerN = chCount(GLOSSARY, (g) => (g.r || []).length);
    const gloOne = gloPerN[1] || 0;
    const gloBookSet = new Set(gloBookRows.map((r) => r.l));
    const gloMissing = BOOKS.filter((b) => !gloBookSet.has(b.short)).map((b) => b.short);

    /* 数据一览：分类 × 可信度；延伸书目：分类 × 难度。两张交叉表 */
    const confCols = chRank(chCount(numItems, (i) => i.conf)).map(([k]) => k);
    const heatNum = NUMBERS.groups.map((g) => {
      const cells = {};
      g.items.forEach((i) => { cells[i.conf] = (cells[i.conf] || 0) + 1; });
      return { l: g.name, cells: cells };
    });
    const estTop = heatNum.reduce((a, c) => ((c.cells["估算"] || 0) > (a.cells["估算"] || 0) ? c : a), heatNum[0]);
    const doubtRows = heatNum.filter((r) => r.cells["存疑"]);
    const lvlCols = ["入门", "进阶", "专题", "工具", "史料"];
    const heatBib = BIBLIOGRAPHY.groups.map((g) => {
      const cells = {};
      g.items.forEach((i) => { cells[i.lvl] = (cells[i.lvl] || 0) + 1; });
      return { l: g.name, cells: cells };
    });
    const bibIntro = heatBib.filter((r) => r.cells["入门"]);
    const bibNone = heatBib.filter((r) => !r.cells["入门"]);

    G.push(group("词条、数据与书目",
      `这三栏是本站的「工具部分」：词条供查人查事，数据一览供查数，延伸书目供往下走。`
      + `三者的共同点是「都要交代出处」，所以下面六张图里有两张是交叉表——单看一栏看不出的问题，摊成表就露出来了。`,
      [
        card(11, chBarH(gloRows, { unit: " 条", pct: true }),
          `${GLOSSARY.length} 条词条中「${gloRows[0].l}」占 <b>${chPct(gloRows[0].v, GLOSSARY.length)}</b>（${gloRows[0].v} 条），`
          + `「${gloRows[1].l}」${gloRows[1].v} 条，最少的「${gloRows[gloRows.length - 1].l}」只有 ${gloRows[gloRows.length - 1].v} 条。`
          + `前两类合计 ${gloRows[0].v + gloRows[1].v} 条、占 ${chPct(gloRows[0].v + gloRows[1].v, GLOSSARY.length)}——`
          + `人物条目占比高，符合「读史先认人」的实际使用顺序。`
          + `而「${gloRows[gloRows.length - 1].l}」少，是因为本站不做原文库：古籍与地名只在需要交代出处或确定方位时才立条，不追求收全。`
          + `这也解释了为什么「词条」在检索索引里是第二大类——它是全站唯一按<b>「一个词」</b>而不是「一件事」组织的栏目。`),
        card(12, chDonut(confItems, { aria: "数据一览各条数据的可信度构成" }),
          `${numItems.length} 项数据里「册载」${confItems[0].v} 项（<b>${chPct(confItems[0].v, numItems.length)}</b>），`
          + `「估算」${(confItems.find((x) => x.l === "估算") || {}).v} 项，「存疑」${(confItems.find((x) => x.l === "存疑") || {}).v} 项。`
          + `这个比例本身是本站的态度声明：近八成数字有册籍依据。`
          + `但明代的「册载」恰恰是最容易失实的一类——黄册里的口数近两百年几乎不变，就是最好的反证。`
          + `所以每一档都配了说明，而不是只给一个数；这个环形图的比例好看，不等于这些数字好看。`),
        card(13, chBarH(lvlRows, { unit: " 种", pct: true }),
          `${bibItems.length} 种书目里「${lvlRows[0].l}」类最多（${lvlRows[0].v} 种），`
          + `而「入门」只有 ${(lvlRows.find((x) => x.l === "入门") || {}).v} 种。`
          + `这暴露了这份书目的定位：它是给<b>已经读完通史、想往下走</b>的人准备的，不是从零开始的清单。`
          + `若要照顾初学者，缺的不是书，是「先读哪一本、再读哪一本」的路径。`
          + `顺便说，「${lvlRows[lvlRows.length - 1].l}」只有 ${lvlRows[lvlRows.length - 1].v} 种也不是遗漏：`
          + `本站把史料与工具书单独立了一类，不混进按难度分的梯度里。`),
        card(21, chBarH(gloBookRows, { unit: " 次", pct: true }),
          `${GLOSSARY.length} 条词条一共留下 ${gloRefN} 条出处，但只指向 <b>${gloBookRows.length} 部书</b>：`
          + `${gloBookRows.map((r) => r.l + " " + r.v).join("、")}。`
          + `更要紧的是分布——<b>${gloOne} 条</b>词条只引了一本书，平均每条 ${(gloRefN / GLOSSARY.length).toFixed(2)} 本，`
          + `引到三本的只有 ${(gloPerN[3] || 0)} 条。这意味着多数词条是「单源」的：查到它，也只能顺着一条线往下走。`
          + `另外七部书里有 ${gloMissing.length} 部一次都没被词条引用过（${gloMissing.join("、")}）——`
          + `不是它们不重要，而是这几本书的写法（一人一时、按专题展开）不产出「某事见某书第几章」这种可以挂靠的出处。`),
        card(22, chHeat(heatNum, confCols, { hue: 0, lab: 104, unit: " 项", note: "颜色越深＝该分类里这一类数据越多；空白＝该分类没有这一类数据。" }),
          `把 ${numItems.length} 项数据摊成「分类 × 可信度」，整张表几乎被「册载」占满，这正是本站想让人看到的东西：`
          + `<b>「册载」不等于「可信」</b>。明代最常被引用的那几个数字（户口、田土）恰恰出自黄册与鱼鳞图册，`
          + `而这两套册籍本身是为赋役而设，越到后期越脱离实际——颜色深只说明「有册籍可查」，不说明这个数站得住。`
          + `真正值得盯的是两处：「存疑」只在 ${doubtRows.map((r) => r.l).join("、")} 出现，`
          + `而「估算」最集中的是「${estTop.l}」（${estTop.cells["估算"]} 项）——`
          + `估算扎堆的地方，就是史料本身给不出确切数的地方，也是本站最该写明理由的地方。`),
        card(23, chHeat(heatBib, lvlCols, { hue: 3, lab: 116, unit: " 种", note: "颜色越深＝该分类里这一难度的书越多；空白＝该分类没有这一难度的书。" }),
          `${bibItems.length} 种书目摊成「分类 × 难度」，偏斜一眼可见：「入门」总共只有 ${chSum(heatBib, (r) => r.cells["入门"] || 0)} 种，`
          + `而且全部集中在${bibIntro.map((r) => "「" + r.l + "」").join("、")}——`
          + `反过来，${bibNone.map((r) => "「" + r.l + "」").join("、")}两栏<b>一本入门书都没有</b>。`
          + `这不是漏收，是这份书目的定位本身：它是给已经读完通史、想往下走的人配的装备，不是从零开始的清单。`
          + `右下角那一片深色（史料与工具书）是全表最厚的一格，也说明本站更愿意把力气花在「怎么查」而不是「怎么入门」上。`),
      ]));

    /* ================= 组 E · 交叉覆盖 ================= */
    const cmpB = chCount(COMPARE.flatMap((c) => c.views), (v) => v.book);
    const cmpRows = chRank(cmpB).map(([k, v]) => ({ l: k, v: v }));
    const cmpTot = chSum(cmpRows, (r) => r.v);
    const cam2 = (cmpB["剑桥上卷"] || 0) + (cmpB["剑桥下卷"] || 0);
    const cmpEra = chRank(chCount(COMPARE, (c) => c.era));
    const cmpEraTop = cmpEra[0], cmpEra2 = cmpEra[1];
    const tkRows = THINKERS.schools.map((s) => ({
      l: String(s.name).split("·")[0].trim(), v: s.thinkers.length,
      tip: `${s.name}（${s.span}）　${s.thinkers.length} 人：${s.thinkers.map((t) => t.name).join("、")}`,
    })).sort((a, b) => b.v - a.v);
    const tkLast = tkRows[tkRows.length - 1];
    const tkLastNames = THINKERS.schools
      .filter((s) => String(s.name).split("·")[0].trim() === tkLast.l)
      .flatMap((s) => s.thinkers.map((t) => t.name)).join("、");

    /* 思想人物的生卒时间轴：20 条命，看的是「谁和谁同时活着」 */
    const TK_C = ["var(--c-indigo)", "var(--c-teal)", "var(--c-amber)", "var(--c-violet)",
      "var(--c-rose)", "var(--accent-3)", "var(--accent-primary)"];
    const tkGantt = THINKERS.schools.flatMap((s, si) => (s.thinkers || []).map((t) => {
      const m = String(t.life || "").match(/(\d{3,4})\s*[—\-–~]\s*(\d{3,4})/);
      if (!m) return null;
      return {
        l: t.name, from: +m[1], to: +m[2], c: TK_C[si % TK_C.length],
        tip: `${t.name}（${t.life}）　${String(s.name).split("·")[0].trim()}　享年 ${+m[2] - +m[1] + 1} 岁　${t.title || ""}`,
      };
    })).filter(Boolean).sort((a, b) => a.from - b.from);
    const tkTicks = [1310, 1360, 1410, 1460, 1510, 1560, 1610, 1660].map((y) => ({ v: y, l: String(y) }));
    const tkSeries = THINKERS.schools.map((s, si) => ({ l: String(s.name).split("·")[0].trim(), c: TK_C[si % TK_C.length] }));
    const tkBirths = tkGantt.map((x) => x.from);
    let bgA = tkBirths[0], bgB = tkBirths[1];
    for (let i = 1; i < tkBirths.length; i++) if (tkBirths[i] - tkBirths[i - 1] > bgB - bgA) { bgA = tkBirths[i - 1]; bgB = tkBirths[i]; }
    const bgPrev = tkGantt.filter((x) => x.from === bgA).map((x) => x.l).join("、");
    const bgNext = tkGantt.filter((x) => x.from === bgB).map((x) => x.l).join("、");
    const tkMin = Math.min(...tkGantt.map((x) => x.from)), tkMax = Math.max(...tkGantt.map((x) => x.to));
    const tkAt1644 = tkGantt.filter((x) => x.from <= 1644 && x.to >= 1644);
    const tkLongest = tkGantt.reduce((a, c) => ((c.to - c.from) > (a.to - a.from) ? c : a), tkGantt[0]);

    G.push(group("交叉覆盖",
      `最后看三条「横向」的线：同一个问题在不同书里怎么被讲、本站的思想栏覆盖到了哪些学派，`
      + `以及这 ${TK_COUNT} 位思想家在时间上是怎么排布的。`,
      [
        card(14, chBarH(cmpRows, { unit: " 次", pct: true }),
          `${COMPARE.length} 组对照共收录 ${cmpTot} 条观点，剑桥上下两卷合计 <b>${cam2}</b> 条，占 ${chPct(cam2, cmpTot)}。`
          + `「万历十五年」与「南明史」各只有 ${cmpB["万历十五年"]} 次——不是因为它们不重要，`
          + `而是它们的写法（一人一时、一朝之亡）不容易和通史放进同一个对照框里。`
          + `对照表的时期分布同样偏：${COMPARE.length} 组里「${cmpEraTop[0]}」${cmpEraTop[1]} 组、「${cmpEra2[0]}」${cmpEra2[1]} 组，`
          + `两个时期就占了近三分之一。这说明对照表是<b>跟着争议走的</b>，不是按朝代平均分配的——`
          + `有争论的地方才值得把几本书摆在一起看。`),
        card(15, chBarH(tkRows, { unit: " 人", pct: true }),
          `${THINKERS.schools.length} 个学派共 ${TK_COUNT} 人。「${tkRows[0].l}」${tkRows[0].v} 人最多，`
          + `而「${tkLast.l}」只有 <b>${tkLast.v}</b> 人（${tkLastNames}）。`
          + `这一支在明代思想史上的分量与其在史料中的存在感并不匹配，也是本站思想栏目前最薄的一环——`
          + `下一轮要补的是这里，而不是继续加心学人物。`
          + `还有一个数字值得留意：平均每个学派 ${(TK_COUNT / THINKERS.schools.length).toFixed(1)} 人，`
          + `说明本站是按<b>学派</b>而不是按<b>人名</b>组织的——先有谱系，再往里填人。`),
        card(24, chGantt(tkGantt, { ticks: tkTicks, unit: " 岁", series: tkSeries }),
          `${tkGantt.length} 位思想人物的生卒跨 ${tkMin}—${tkMax}，共 ${tkMax - tkMin} 年。四点值得看：`
          + `① 生年最早的是${tkGantt[0].l}（${tkGantt[0].from}），享年最长的是${tkLongest.l}（${tkLongest.to - tkLongest.from + 1} 岁，${tkLongest.from}—${tkLongest.to}）；`
          + `② 生年之间最大的一段空档在 ${bgA}—${bgB} 之间：${bgPrev}（生于 ${bgA}）之后，`
          + `直到 ${bgNext}（生于 ${bgB}）才有人接上，中间整整 <b>${bgB - bgA} 年</b>本站一个人都没收——`
          + `这段空白正好卡在明初理学与心学之间，是本站思想栏最明显的断点；`
          + `③ 1644 年明亡时，这些人里有 <b>${tkAt1644.length}</b> 位在世（${tkAt1644.map((x) => x.l).join("、")}），`
          + `他们是把「明朝」当记忆而不是当现实来写的一代人——明末清初的总结性著作，正是这批人写的；`
          + `④ 时间条彼此交叠得厉害：明初理学与心学有两代人是同时活着、互相批评的，`
          + `所以「学派」在图上不是一个接一个的段落，而是一层层压着的。`),
      ]));

    host.innerHTML = G.join("");
  }

  /* ==================== 25. 启动 ==================== */
  function boot() {
    initTheme();
    initTabs();
    initHoverPrefetch();
    initLineageMode();
    initEmpList();
    initChronoFilters();
    initEras();
    initBureaucracy();
    initThinkers();
    initPower();
    initIndex();
    initGlossary();
    initGeo();
    initBibliography();
    initPalette();
    initReading();
    initRouter();     // 按地址决定首屏渲染哪一栏（默认总览）
    prefetch();       // 空闲时把其余栏目补建好
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
