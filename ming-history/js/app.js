/* 明史资料平台 · 交互逻辑
   纯静态实现，无外部依赖、无网络请求。
   所有检索、换算与渲染均在本机浏览器内完成。 */
(function () {
  "use strict";

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

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

  /* ---------------- 主题 ---------------- */
  function initTheme() {
    const btn = $("#themeBtn");
    const sync = () => {
      const t = document.documentElement.getAttribute("data-theme") || "dark";
      if (btn) { btn.textContent = t === "dark" ? "☀" : "☾"; btn.setAttribute("aria-label", t === "dark" ? "切换到浅色" : "切换到深色"); }
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
    });
  }

  /* ---------------- 分栏切换 ---------------- */
  function initTabs() {
    const tabs = $$(".tab");
    const views = $$(".view");
    function go(id, push) {
      tabs.forEach((t) => t.classList.toggle("active", t.dataset.view === id));
      views.forEach((v) => v.classList.toggle("active", v.id === "view-" + id));
      if (push !== false) { try { history.replaceState(null, "", "#" + id); } catch (e) { /* 忽略 */ } }
      window.scrollTo({ top: 0, behavior: "auto" });
    }
    tabs.forEach((t) => t.addEventListener("click", () => go(t.dataset.view)));
    const hash = (location.hash || "").replace("#", "");
    if (hash && $("#view-" + hash)) go(hash, false);
    window.__mingGo = go;

    // 窄屏时标签栏横向可滚动，用渐隐遮罩提示「还有更多」
    const nav = $(".tabs");
    if (nav) {
      const sync = () => {
        nav.classList.toggle("more-right", nav.scrollWidth - nav.clientWidth - nav.scrollLeft > 2);
        nav.classList.toggle("more-left", nav.scrollLeft > 2);
      };
      nav.addEventListener("scroll", sync, { passive: true });
      window.addEventListener("resize", sync);
      sync(); setTimeout(sync, 500);
    }
  }

  /* ---------------- 总览 ---------------- */
  function renderOverview() {
    const statBox = $("#stats");
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
    statBox.innerHTML = stats.map(([n, k]) => `<div class="stat"><div class="n">${esc(n)}</div><div class="k">${esc(k)}</div></div>`).join("");

    $("#bookGrid").innerHTML = BOOKS.map((b) => `
      <button class="card book-card" data-book="${esc(b.id)}" type="button">
        <div class="vol">${esc(b.vol)}</div>
        <h3>${esc(b.title)}</h3>
        <div class="meta">${esc(b.editor)} · ${esc(b.press)}${b.pages ? " · " + b.pages + " 页" : ""}</div>
        <div class="angle">${esc(b.angle)}</div>
        <p>${esc(b.blurb)}</p>
        <div style="margin-top:auto"><span class="chip accent">看章节索引 →</span></div>
      </button>`).join("");

    $$("#bookGrid .book-card").forEach((el) => el.addEventListener("click", () => {
      window.__mingGo("index");
      selectBook(el.dataset.book);
    }));
  }

  /* ---------------- 帝王世系 ---------------- */
  const AXIS_FROM = 1368, AXIS_TO = 1683;
  let houseFilter = "all", openEmp = null, lineageMode = "axis", treeFilter = "all";

  function renderEmperors() {
    const list = EMPERORS.filter((e) => houseFilter === "all" || e.house === houseFilter);

    // 时间轴
    const axis = $("#axis");
    const span = AXIS_TO - AXIS_FROM;
    const nodes = list.map((e) => {
      const p = Math.max(0, Math.min(100, ((e.from - AXIS_FROM) / span) * 100));
      return `<button class="axis-node${openEmp === e.no ? " on" : ""}" type="button" style="left:${p.toFixed(3)}%"
        data-no="${e.no}" title="${esc(e.temple + e.name)} ${esc(e.span)}" aria-label="${esc(e.temple + e.name)}"></button>`;
    }).join("");
    const marks = [1368, 1400, 1450, 1500, 1550, 1600, 1650, 1683].map((y) => {
      const p = ((y - AXIS_FROM) / span) * 100;
      return `<span class="axis-year" style="left:${p.toFixed(3)}%">${y}</span>`;
    }).join("");
    axis.innerHTML = `<div class="axis-track"></div><div class="axis-fill"></div>${marks}${nodes}`;

    // 列表
    $("#empList").innerHTML = list.map((e) => `
      <article class="emp${openEmp === e.no ? " open" : ""}" data-no="${e.no}">
        <button class="emp-row" type="button" aria-expanded="${openEmp === e.no}">
          <div class="emp-no">${e.no > 100 ? "南" : e.no}</div>
          <div class="emp-main">
            <b><span class="temple">${esc(e.temple)}</span>${esc(e.name)}</b>
            <div class="sub">${esc(e.era)}${e.tomb && e.tomb !== "—" ? " · " + esc(e.tomb) : ""}</div>
          </div>
          <div class="emp-span">${esc(e.span)}<br><span style="color:var(--text-muted)">${esc(e.years)}</span></div>
        </button>
        <div class="emp-body">
          <p class="one">${esc(e.one)}</p>
          ${e.court && e.court.length ? `<h4>朝廷要人</h4><ul class="compact">${e.court.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
          ${e.figures && e.figures.length ? `<h4>名臣名将</h4><div class="emp-tags">${e.figures.map((x) => `<span class="chip">${esc(x)}</span>`).join("")}</div>` : ""}
          <h4>在位大事</h4>
          <ul>${(e.events || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
          ${e.policy && e.policy.length ? `<h4>制度与政策</h4><ul class="compact">${e.policy.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
          ${e.reading ? `<div class="emp-reading"><b>读法提示 · </b>${esc(e.reading)}</div>` : ""}
          <h4>对应章节</h4>
          <div class="emp-refs">${(e.refs || []).map((r) => `<span class="chip">${esc(r)}</span>`).join("")}</div>
        </div>
      </article>`).join("");

    $$("#empList .emp-row").forEach((btn) => btn.addEventListener("click", () => {
      const no = Number(btn.closest(".emp").dataset.no);
      openEmp = openEmp === no ? null : no;
      renderEmperors();
      if (openEmp) {
        const el = $(`#empList .emp[data-no="${openEmp}"]`);
        if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    }));
    $$("#axis .axis-node").forEach((n) => n.addEventListener("click", () => {
      const no = Number(n.dataset.no);
      openEmp = no;
      renderEmperors();
      const el = $(`#empList .emp[data-no="${no}"]`);
      if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
    }));
  }

  /* ---------------- 皇族世系图 ---------------- */
  function treeNodeHtml(node, depth) {
    const kids = node.children && node.children.length
      ? `<div class="tn-kids">${node.children.map((c) => treeNodeHtml(c, depth + 1)).join("")}</div>` : "";
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
        <div class="tree">${t.roots.map((r) => treeNodeHtml(r, 0)).join("")}</div>
      </section>`).join("") || '<div class="empty">该支系暂无数据</div>';
  }

  function renderLineageNotes() {
    $("#lineageNotes").innerHTML = (LINEAGE.notes || []).map((n) => `
      <div class="rel">
        <h4>${esc(n.t)}</h4>
        <p>${esc(n.d)}</p>
      </div>`).join("");
  }

  function initLineageMode() {
    const box = $("#lineageMode");
    if (box) {
      $$("#lineageMode .pill").forEach((p) => p.addEventListener("click", () => {
        lineageMode = p.dataset.mode;
        $$("#lineageMode .pill").forEach((x) => x.classList.toggle("active", x === p));
        $("#lineageAxisView").style.display = lineageMode === "axis" ? "" : "none";
        $("#lineageTreeView").style.display = lineageMode === "tree" ? "" : "none";
      }));
    }
    const tb = $("#treeSwitch");
    if (tb) {
      $$("#treeSwitch .pill").forEach((p) => p.addEventListener("click", () => {
        treeFilter = p.dataset.tree;
        $$("#treeSwitch .pill").forEach((x) => x.classList.toggle("active", x === p));
        renderTrees();
      }));
    }
  }

  function initHouseSwitch() {
    $$("#houseSwitch .pill").forEach((p) => p.addEventListener("click", () => {
      houseFilter = p.dataset.house;
      openEmp = null;
      $$("#houseSwitch .pill").forEach((x) => x.classList.toggle("active", x === p));
      renderEmperors();
    }));
  }

  /* ---------------- 大事年表 ---------------- */
  /* 筛选按年代分段而非单个年号，避免出现「洪武」与「甲申」并排的语义错层 */
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

  function renderChrono() {
    const used = PERIODS.filter((p) => CHRONOLOGY.some((c) => periodOf(c.y) === p.id)).map((p) => p.id);
    const eras = ["全部"].concat(used);
    $("#chronoFilters").innerHTML = eras.map((e) =>
      `<button class="pill${chronoEra === e ? " active" : ""}" data-era="${esc(e)}" type="button">${esc(e)}</button>`).join("");
    $$("#chronoFilters .pill").forEach((p) => p.addEventListener("click", () => {
      chronoEra = p.dataset.era; renderChrono();
    }));

    const catsUsed = CAT_ORDER.filter((c) => CHRONOLOGY.some((x) => x.cat === c));
    const cats = ["全部"].concat(catsUsed);
    $("#chronoCatFilters").innerHTML = cats.map((c) =>
      `<button class="pill cat${chronoCat === c ? " active" : ""}" data-cat="${esc(c)}" type="button">${esc(c)}</button>`).join("");
    $$("#chronoCatFilters .pill").forEach((p) => p.addEventListener("click", () => {
      chronoCat = p.dataset.cat; renderChrono();
    }));

    const list = CHRONOLOGY.filter((c) =>
      (chronoEra === "全部" || periodOf(c.y) === chronoEra) &&
      (chronoCat === "全部" || c.cat === chronoCat));

    $("#chronoList").innerHTML = list.map((c) => `
      <div class="ce${c.key ? " key" : ""}">
        <div class="y">${c.y}<span class="era">${esc(c.era)}</span>${c.cat ? `<span class="cat-tag" data-cat="${esc(c.cat)}">${esc(c.cat)}</span>` : ""}</div>
        <h3>${esc(c.t)}${c.key ? ' <span class="chip key">节点</span>' : ""}</h3>
        <p>${esc(c.d)}</p>
        ${c.refs && c.refs.length ? `<div class="ce-refs">${c.refs.map((r) => `<span>${esc(r)}</span>`).join("")}</div>` : ""}
      </div>`).join("") || '<div class="empty">该筛选下暂无条目</div>';
  }

  /* ---------------- 年号纪年 ---------------- */
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
    return `<article class="era-row">
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
    const ming = ERAS.filter((e) => e.house === "明朝");
    const nan = ERAS.filter((e) => e.house !== "明朝");
    $("#eraTableMing").innerHTML = ming.map((e) => eraRow(e, false)).join("");
    $("#eraTableNan").innerHTML = nan.map((e) => eraRow(e, true)).join("");
    $("#eraTableRival").innerHTML = RIVAL_ERAS.map((r) => `
      <article class="era-row rival">
        <div class="era-name"><b>${esc(r.regime)}</b></div>
        <div class="era-emp">${esc(r.leader)}<br><span class="era-n">年号：${esc(r.era)}</span></div>
        <div class="era-span">${r.from}—${r.to}</div>
        <p class="era-note">${esc(r.note)}</p>
      </article>`).join("");

    $("#calendarNotes").innerHTML = `<div class="notice" style="margin-bottom:16px">${esc(CALENDAR.intro || "")}</div>` +
      (CALENDAR.items || []).map((n) => `
        <div class="rel">
          <h4>${esc(n.t)}</h4>
          <p>${esc(n.d)}</p>
        </div>`).join("");

    const quick = [1368, 1402, 1421, 1449, 1521, 1567, 1581, 1619, 1644, 1662, 1683];
    $("#gzQuick").innerHTML = quick.map((y) => `<button class="pill tiny" data-y="${y}" type="button">${y}</button>`).join("");
    $$("#gzQuick .pill").forEach((p) => p.addEventListener("click", () => {
      $("#gzYear").value = p.dataset.y; updateGz();
    }));

    const input = $("#gzYear");
    input.addEventListener("input", updateGz);
    updateGz();
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

  /* ---------------- 三书对照 ---------------- */
  function renderCompare() {
    $("#cmpList").innerHTML = COMPARE.map((c, i) => `
      <article class="cmp${i === 0 ? " open" : ""}">
        <button class="cmp-head" type="button" aria-expanded="${i === 0}">
          <span class="chip accent">${esc(c.era)}</span>
          <h3>${esc(c.title)}</h3>
          <span class="yr">${esc(c.year)}</span>
          <span class="caret">▾</span>
        </button>
        <div class="cmp-body">
          <div class="cmp-views">
            ${c.views.map((v) => `<div class="cmp-view"><div class="src">${esc(v.book)}${v.loc ? " · " + esc(v.loc) : ""}</div><p>${esc(v.text)}</p></div>`).join("")}
          </div>
          <div class="cmp-take"><b>并读提示 · </b>${esc(c.take)}</div>
        </div>
      </article>`).join("");
    $$("#cmpList .cmp-head").forEach((h) => h.addEventListener("click", () => {
      const art = h.closest(".cmp");
      const open = art.classList.toggle("open");
      h.setAttribute("aria-expanded", String(open));
    }));
  }

  /* ---------------- 章节索引 ---------------- */
  let curBook = BOOKS.length ? BOOKS[0].id : null;
  let idxQuery = "";

  function selectBook(id) {
    curBook = id;
    idxQuery = "";
    const q = $("#idxQuery"); if (q) q.value = "";
    renderIndex();
  }

  function renderIndex() {
    $("#idxSide").innerHTML = BOOKS.map((b) => `
      <button class="idx-book${curBook === b.id ? " active" : ""}" data-book="${esc(b.id)}" type="button">
        <b>${esc(b.short)}</b>
        <span>${esc(b.vol)} · ${b.chapters.length} 章${b.noPages ? " · 仅目录" : ""}</span>
      </button>`).join("");
    $$("#idxSide .idx-book").forEach((el) => el.addEventListener("click", () => selectBook(el.dataset.book)));

    const b = BOOKS.find((x) => x.id === curBook) || BOOKS[0];
    if (!b) { $("#idxPanel").innerHTML = '<div class="empty">无书目数据</div>'; return; }

    const kw = idxQuery.trim().toLowerCase();
    const hit = (s) => !kw || String(s).toLowerCase().indexOf(kw) >= 0;
    const chapters = b.chapters.map((c) => {
      const subs = (c.s || []).filter((s) => hit(typeof s === "string" ? s : s.t));
      const selfHit = hit(c.t);
      if (kw && !selfHit && !subs.length) return null;
      return { c, subs: kw && !selfHit ? subs : (c.s || []) };
    }).filter(Boolean);

    $("#idxPanel").innerHTML = `
      <h3>${esc(b.title)}</h3>
      <p class="blurb">${esc(b.blurb)}</p>
      <div class="meta">${esc(b.editor)} · ${esc(b.press)}${b.pages ? " · " + b.pages + " 页" : b.noPages ? " · 仅列目录，不标页码" : ""} · 覆盖 ${esc(b.scope)}${b.en ? " · " + esc(b.en) : ""}</div>
      ${b.split ? `<div class="notice" style="margin-bottom:16px">${Object.entries(b.split).map(([k, v]) => `<b>${esc(k)}</b>　${esc(v)}`).join("　｜　")}</div>` : ""}
      ${b.disclaimer ? `<div class="notice" style="margin-bottom:16px">${esc(b.disclaimer)}</div>` : ""}
      <div id="idxChapters">
        ${chapters.length ? chapters.map(({ c, subs }) => {
          const hasSub = subs.length > 0;
          return `<div class="idx-ch${kw ? " open" : ""}">
            <button class="idx-ch-head" type="button" ${hasSub ? "" : 'disabled style="cursor:default"'}>
              <span class="caret">${hasSub ? "▶" : "·"}</span>
              <span class="t">${esc(c.t)}</span>
              ${c.p ? `<span class="pg">p.${c.p}</span>` : ""}
            </button>
            ${c.n ? `<p class="idx-note">${esc(c.n)}</p>` : ""}
            ${hasSub ? `<div class="idx-subs">${subs.map((s) => {
              const t = typeof s === "string" ? s : s.t;
              const p = typeof s === "string" ? null : s.p;
              const n = typeof s === "string" ? null : s.n;
              return `<div class="idx-sub">${b.noPages ? "" : (p ? `<span class="pg">${p}</span>` : '<span class="pg">—</span>')}<span>${esc(t)}${n ? `<em class="idx-sub-n">${esc(n)}</em>` : ""}</span></div>`;
            }).join("")}</div>` : ""}
          </div>`;
        }).join("") : '<div class="empty">没有匹配的章节</div>'}
      </div>`;

    $$("#idxPanel .idx-ch-head").forEach((h) => h.addEventListener("click", () => {
      const ch = h.closest(".idx-ch");
      if (h.disabled) return;
      ch.classList.toggle("open");
    }));
  }

  function initIndexSearch() {
    const q = $("#idxQuery");
    if (!q) return;
    q.addEventListener("input", () => { idxQuery = q.value; renderIndex(); });
  }

  /* ---------------- 词条库 ---------------- */
  let glossCat = "全部", glossKw = "";
  function renderGlossary() {
    const cats = ["全部"].concat(GLOSSARY.map((g) => g.c).filter((v, i, a) => a.indexOf(v) === i));
    $("#glossCats").innerHTML = cats.map((c) =>
      `<button class="pill${glossCat === c ? " active" : ""}" data-cat="${esc(c)}" type="button">${esc(c)}</button>`).join("");
    $$("#glossCats .pill").forEach((p) => p.addEventListener("click", () => { glossCat = p.dataset.cat; renderGlossary(); }));

    const kw = glossKw.trim().toLowerCase();
    const hl = (s) => {
      const t = esc(s);
      if (!kw) return t;
      const i = String(s).toLowerCase().indexOf(kw);
      if (i < 0) return t;
      return esc(String(s).slice(0, i)) + "<mark>" + esc(String(s).slice(i, i + kw.length)) + "</mark>" + esc(String(s).slice(i + kw.length));
    };
    const list = GLOSSARY.filter((g) => {
      if (glossCat !== "全部" && g.c !== glossCat) return false;
      if (!kw) return true;
      return (g.t + " " + (g.e || "") + " " + g.d + " " + g.r.join(" ")).toLowerCase().indexOf(kw) >= 0;
    });

    $("#glossCount").textContent = list.length + " 条";
    $("#glossGrid").innerHTML = list.length ? list.map((g) => `
      <article class="gi">
        <div class="top"><b>${hl(g.t)}</b>${g.e ? `<span class="e">${hl(g.e)}</span>` : ""}<span class="chip" style="margin-left:auto">${esc(g.c)}</span></div>
        <p>${hl(g.d)}</p>
        <div class="refs">${g.r.map((r) => `<span>${esc(r)}</span>`).join("")}</div>
      </article>`).join("") : '<div class="empty">没有匹配的词条</div>';
  }

  function initGlossSearch() {
    const q = $("#glossQuery");
    if (!q) return;
    let t = null;
    q.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(() => { glossKw = q.value; renderGlossary(); }, 120);
    });
  }

  /* ---------------- 舆图政区 ---------------- */
  let placeKind = "全部";
  function renderGeo() {
    $("#provGrid").innerHTML = PROVINCES.map((p) => `
      <article class="prov">
        <div class="prov-head"><b>${esc(p.name)}</b><span class="chip">${esc(p.seat)}</span></div>
        <p class="prov-area">今地：${esc(p.area)}</p>
        <p class="prov-since">${esc(p.since)}</p>
        <p class="prov-note">${esc(p.note)}</p>
      </article>`).join("");

    $("#garrList").innerHTML = NINE_GARRISONS.map((g, i) => `
      <article class="garr">
        <div class="garr-no">${i + 1}</div>
        <div class="garr-body">
          <div class="garr-head"><b>${esc(g.name)}</b><span class="garr-seat">${esc(g.seat)}</span></div>
          <div class="garr-span">${esc(g.span)}</div>
          <p>${esc(g.note)}</p>
        </div>
      </article>`).join("");

    $("#milGeo").innerHTML = MILITARY_GEO.map((m) => `
      <div class="rel"><h4>${esc(m.t)}</h4><p>${esc(m.d)}</p></div>`).join("");

    const kinds = ["全部"].concat(PLACES.map((p) => p.kind).filter((v, i, a) => a.indexOf(v) === i));
    $("#placeFilters").innerHTML = kinds.map((k) =>
      `<button class="pill${placeKind === k ? " active" : ""}" data-kind="${esc(k)}" type="button">${esc(k)}</button>`).join("");
    $$("#placeFilters .pill").forEach((b) => b.addEventListener("click", () => {
      placeKind = b.dataset.kind; renderGeo();
    }));

    const list = PLACES.filter((p) => placeKind === "全部" || p.kind === placeKind);
    $("#placeGrid").innerHTML = list.map((p) => `
      <article class="place">
        <div class="place-head"><b>${esc(p.name)}</b><span class="chip">${esc(p.kind)}</span></div>
        <p>${esc(p.note)}</p>
      </article>`).join("");

    $("#terrList").innerHTML = TERRITORY.map((t) => `
      <div class="terr-row">
        <div class="terr-stage">${esc(t.stage)}</div>
        <p>${esc(t.d)}</p>
      </div>`).join("");
  }

  /* ---------------- 数据一览 ---------------- */
  function renderNumbers() {
    $("#numLegend").innerHTML = (NUMBERS.legend || []).map((l) => `
      <div class="legend-item"><span class="conf ${confClass(l.k)}">${esc(l.k)}</span><span>${esc(l.d)}</span></div>`).join("");
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
  const confClass = (k) => (k === "册载" ? "ok" : k === "估算" ? "mid" : "low");

  /* ---------------- 延伸书目 ---------------- */
  const LVL_CLASS = { "入门": "ok", "进阶": "mid", "专题": "low", "工具": "tool", "史料": "src" };
  const lvlClass = (k) => LVL_CLASS[k] || "mid";
  let bibLvl = "全部";

  function renderBibliography() {
    const intro = $("#bibIntro");
    if (intro) intro.textContent = BIBLIOGRAPHY.intro || "";
    $("#bibLegend").innerHTML = (BIBLIOGRAPHY.legend || []).map((l) => `
      <div class="legend-item"><span class="conf ${lvlClass(l.k)}">${esc(l.k)}</span><span>${esc(l.d)}</span></div>`).join("");

    const lvls = ["全部"].concat((BIBLIOGRAPHY.legend || []).map((l) => l.k));
    $("#bibFilters").innerHTML = lvls.map((k) =>
      `<button class="pill${bibLvl === k ? " active" : ""}" data-lvl="${esc(k)}" type="button">${esc(k)}</button>`).join("");
    $$("#bibFilters .pill").forEach((b) => b.addEventListener("click", () => { bibLvl = b.dataset.lvl; renderBibliography(); }));

    const groups = (BIBLIOGRAPHY.groups || []).map((g) => {
      const items = g.items.filter((it) => bibLvl === "全部" || it.lvl === bibLvl);
      if (!items.length) return null;
      return `<section class="bib-group">
        <div class="num-group-head">
          <span class="num-ico">${esc(g.icon)}</span>
          <h3>${esc(g.name)}</h3>
          <span class="chip">${items.length} / ${g.items.length} 种</span>
        </div>
        <div class="bib-list">${items.map((it) => `
          <article class="bib">
            <div class="bib-top">
              <b class="bib-t">《${esc(it.t)}》</b>
              <span class="conf ${lvlClass(it.lvl)}">${esc(it.lvl)}</span>
              ${it.indexed ? '<span class="chip accent bib-idx">已收作索引</span>' : ""}
            </div>
            <div class="bib-meta">${esc(it.a)}　·　${esc(it.v)}　·　${esc(it.y)}</div>
            <p class="bib-d">${esc(it.d)}</p>
            <p class="bib-use"><b>适合 · </b>${esc(it.use)}</p>
          </article>`).join("")}</div>
      </section>`;
    }).filter(Boolean);
    $("#bibGroups").innerHTML = groups.length ? groups.join("") : '<div class="empty">该难度下暂无书目</div>';

    const cl = $("#bibClosing");
    if (cl) cl.innerHTML = `<b>阅读顺序建议。</b>${esc(String(BIBLIOGRAPHY.closing || "").replace(/^顺序建议：/, ""))}`;
  }

  /* ---------------- 争议考辨 ---------------- */
  function renderDebates() {
    $("#debList").innerHTML = DEBATES.map((d, i) => `
      <article class="deb${i === 0 ? " open" : ""}">
        <button class="deb-head" type="button" aria-expanded="${i === 0}">
          <span class="deb-tag">${esc(d.tag)}</span>
          <div class="deb-t">
            <h3>${esc(d.t)}</h3>
            <p class="deb-q">${esc(d.q)}</p>
          </div>
          <span class="caret">▾</span>
        </button>
        <div class="deb-body">
          <div class="deb-sides">
            ${d.sides.map((s) => `<div class="deb-side"><div class="deb-side-name">${esc(s.name)}</div><p>${esc(s.view)}</p></div>`).join("")}
          </div>
          <div class="deb-status"><b>学界倾向 · </b>${esc(d.status)}</div>
          <div class="deb-refs">${(d.refs || []).map((r) => `<span class="chip">${esc(r)}</span>`).join("")}</div>
        </div>
      </article>`).join("");
    $$("#debList .deb-head").forEach((h) => h.addEventListener("click", () => {
      const art = h.closest(".deb");
      const open = art.classList.toggle("open");
      h.setAttribute("aria-expanded", String(open));
    }));
  }

  /* ---------------- 主题线索 ---------------- */
  const THEME_COLOR = { indigo: "var(--c-indigo)", teal: "var(--c-teal)", amber: "var(--c-amber)", violet: "var(--c-violet)", rose: "var(--c-rose)" };
  function renderThemes() {
    $("#themeGrid").innerHTML = THEMES.map((t) => `
      <article class="thm" style="--tc:${THEME_COLOR[t.color] || "var(--accent-primary)"}">
        <h3>${esc(t.name)}</h3>
        <p class="q">${esc(t.q)}</p>
        <ol>${t.path.map(([a, b]) => `<li><b>${esc(a)}</b>　${esc(b)}</li>`).join("")}</ol>
        <div class="note">${esc(t.note)}</div>
      </article>`).join("");
  }

  /* ---------------- 本地阅读器 ---------------- */
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
        };
        fr.onerror = () => { textEl.textContent = "读取失败，请确认文件未损坏。"; textEl.style.display = "block"; stage.classList.add("on"); };
        fr.readAsText(file, "utf-8");
      } else {
        // PDF 等由浏览器内置阅读器在本机渲染，文件不离开设备
        url = URL.createObjectURL(file);
        frameEl.src = url;
        frameEl.style.display = "block";
        stage.classList.add("on");
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

  /* ---------------- 启动 ---------------- */
  function boot() {
    initTheme();
    initTabs();
    renderOverview();
    initLineageMode();
    initHouseSwitch();
    renderEmperors();
    renderTrees();
    renderLineageNotes();
    renderChrono();
    renderEras();
    renderCompare();
    renderIndex();
    initIndexSearch();
    renderGlossary();
    initGlossSearch();
    renderGeo();
    renderNumbers();
    renderBibliography();
    renderDebates();
    renderThemes();
    initReader();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
