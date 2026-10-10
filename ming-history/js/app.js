/* 明史资料平台 · 交互逻辑
   纯静态实现，无外部依赖、无网络请求。所有检索、换算与渲染均在本机浏览器内完成。

   架构：
     1) 工具函数
     2) 主题
     3) 路由 + 按需渲染（首屏只渲染「总览」，其余栏目首次激活时才构建）
     4) 各栏目渲染器（列表类筛选走 DOM 切换，不重建）
     5) 全站检索（命令面板，Ctrl/⌘+K）
     6) 阅读辅助（进度条 / 回到顶部 / 滚动位置记忆）
     7) 本地阅读器
     8) 启动
*/
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
  const VIEWS = ["overview", "lineage", "chrono", "eras", "compare", "index",
    "bibliography", "glossary", "geo", "numbers", "debates", "themes", "reader"];

  const rendered = Object.create(null);   // 栏目是否已构建
  const scrollMem = Object.create(null);  // 每栏的滚动位置
  let curView = "overview";

  // 各栏目的构建入口（懒执行）
  const BUILD = {
    overview: renderOverview,
    lineage: function () { renderEmperors(); renderTrees(); renderLineageNotes(); },
    chrono: renderChrono,
    eras: renderEras,
    compare: renderCompare,
    index: renderIndex,
    bibliography: renderBibliography,
    glossary: renderGlossary,
    geo: renderGeo,
    numbers: renderNumbers,
    debates: renderDebates,
    themes: renderThemes,
    reader: initReader,
  };

  function ensure(view) {
    if (rendered[view]) return;
    rendered[view] = true;
    const fn = BUILD[view];
    if (fn) fn();
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

    if (opts.push !== false) setHash(view, anchor, opts.replace === true);

    if (anchor) {
      resolveAnchor(view, anchor);
    } else if (opts.source === "pop") {
      const y = scrollMem[view] || 0;
      window.scrollTo({ top: y, behavior: "auto" });
    } else {
      window.scrollTo({ top: 0, behavior: "auto" });
    }

    // 标签滚到可见区域（窄屏）
    const tab = $('#tabs .tab[data-view="' + view + '"]');
    if (tab && tab.scrollIntoView) tab.scrollIntoView({ block: "nearest", inline: "nearest" });
    live(($("#tab-" + view) || {}).textContent ? "已切换到" + $("#tab-" + view).textContent + "栏目" : "");
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
    const y = el.getBoundingClientRect().top + window.scrollY - 84;
    window.scrollTo({ top: Math.max(0, y), behavior: "auto" });
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

  /* ==================== 10. 多书对照 ==================== */
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

  /* ==================== 11. 章节索引 ==================== */
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

  /* ==================== 12. 延伸书目 ==================== */
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

  /* ==================== 13. 词条库 ==================== */
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

  /* ==================== 14. 舆图政区 ==================== */
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

  /* ==================== 15. 数据一览 ==================== */
  const confClass = (k) => (k === "册载" ? "ok" : k === "估算" ? "mid" : "low");

  function renderNumbers() {
    $("#numLegend").innerHTML = (NUMBERS.legend || []).map((l) =>
      `<div class="legend-item"><span class="conf ${confClass(l.k)}">${esc(l.k)}</span><span>${esc(l.d)}</span></div>`).join("");
    $("#numGroups").innerHTML = (NUMBERS.groups || []).map((g) => `
      <section class="num-group">
        <div class="num-group-head"><span class="num-ico">${esc(g.icon)}</span><h3>${esc(g.name)}</h3><span class="chip">${g.items.length} 项</span></div>
        <div class="num-list">
          ${g.items.map((it) => `
            <article class="num-item">
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

  /* ==================== 16. 争议考辨 ==================== */
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

  /* ==================== 17. 主题线索 ==================== */
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

  /* ==================== 18. 全站检索（命令面板） ==================== */
  let SEARCH_IX = null;
  let palResults = [];
  let palActive = 0;

  function buildSearchIndex() {
    const ix = [];
    const add = (o) => {
      o.hay = (o.title + " " + (o.sub || "") + " " + (o.text || "")).toLowerCase();
      o.tl = o.title.toLowerCase();
      o.sl = (o.sub || "").toLowerCase();
      ix.push(o);
    };
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
        if (e.tl === k) score += 120;
        else if (e.tl.indexOf(k) === 0) score += 70;
        else if (e.tl.indexOf(k) > 0) score += 42;
        else if (e.sl.indexOf(k) >= 0) score += 16;
        else if (e.hay.indexOf(k) >= 0) score += 7;
        else { ok = false; break; }
      }
      if (!ok) continue;
      // 词条/年号这类短条目在同等命中下更该靠前
      if (e.type === "词条" || e.type === "年号") score += 4;
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

  const typeKey = (t) => ({ "帝王": "emp", "大事": "chr", "词条": "glo", "对照": "cmp", "考辨": "deb", "年号": "era", "纪年": "era", "政区": "geo", "九边": "geo", "地名": "geo", "疆域": "geo", "制度": "geo", "主题": "thm", "书目": "bib", "章节": "idx", "小节": "idx" })[t] || "glo";

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

  /* ==================== 19. 阅读辅助 ==================== */
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

  /* ==================== 20. 本地阅读器 ==================== */
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
    const order = ["lineage", "chrono", "glossary", "geo", "eras", "numbers",
      "compare", "debates", "themes", "index", "bibliography", "reader"];
    let i = 0;
    const step = (deadline) => {
      const t0 = performance.now();
      const budget = deadline && typeof deadline.timeRemaining === "function"
        ? Math.max(8, Math.min(24, deadline.timeRemaining()))
        : 10;
      while (i < order.length && performance.now() - t0 < budget) ensure(order[i++]);
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
      if (t) ensure(t.dataset.view);
    };
    nav.addEventListener("pointerover", warm);
    nav.addEventListener("focusin", warm);
  }

  /* ==================== 21. 启动 ==================== */
  function boot() {
    initTheme();
    initTabs();
    initHoverPrefetch();
    initLineageMode();
    initEmpList();
    initChronoFilters();
    initEras();
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
