/* 明史资料平台 · 交互逻辑
   纯静态实现，无外部依赖、无网络请求。
   所有检索与渲染均在本机浏览器内完成。 */
(function () {
  "use strict";

  const CORE = window.MING_CORE || {};
  const BOOKS = window.MING_BOOKS || [];
  const EMPERORS = CORE.EMPERORS || [];
  const CHRONOLOGY = CORE.CHRONOLOGY || [];
  const COMPARE = CORE.COMPARE || [];
  const THEMES = CORE.THEMES || [];
  const GLOSSARY = CORE.GLOSSARY || [];

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
  }

  /* ---------------- 总览 ---------------- */
  function renderOverview() {
    const statBox = $("#stats");
    const totalCh = BOOKS.reduce((n, b) => n + b.chapters.length, 0);
    const totalPages = BOOKS.reduce((n, b) => n + (b.pages || 0), 0);
    const stats = [
      [BOOKS.length, "部著作 / 册"],
      [totalCh, "章 索引条目"],
      [totalPages.toLocaleString("en-US"), "页 扫描件"],
      [EMPERORS.length, "帝 与监国"],
      [CHRONOLOGY.length, "条 大事年表"],
      [GLOSSARY.length, "条 词条"],
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
  let houseFilter = "all", openEmp = null;

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
          <h4>在位大事</h4>
          <ul>${e.events.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
          <h4>对应章节</h4>
          <div class="emp-refs">${e.refs.map((r) => `<span class="chip">${esc(r)}</span>`).join("")}</div>
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

  let chronoEra = "全部";
  function renderChrono() {
    const used = PERIODS.filter((p) => CHRONOLOGY.some((c) => periodOf(c.y) === p.id)).map((p) => p.id);
    const eras = ["全部"].concat(used);
    $("#chronoFilters").innerHTML = eras.map((e) =>
      `<button class="pill${chronoEra === e ? " active" : ""}" data-era="${esc(e)}" type="button">${esc(e)}</button>`).join("");
    $$("#chronoFilters .pill").forEach((p) => p.addEventListener("click", () => {
      chronoEra = p.dataset.era; renderChrono();
    }));

    const list = CHRONOLOGY.filter((c) => chronoEra === "全部" || periodOf(c.y) === chronoEra);
    $("#chronoList").innerHTML = list.map((c) => `
      <div class="ce${c.key ? " key" : ""}">
        <div class="y">${c.y}<span class="era">${esc(c.era)}</span></div>
        <h3>${esc(c.t)}${c.key ? ' <span class="chip key">节点</span>' : ""}</h3>
        <p>${esc(c.d)}</p>
      </div>`).join("") || '<div class="empty">该时段暂无条目</div>';
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
            ${c.views.map((v) => `<div class="cmp-view"><div class="src">${esc(v.book)}</div><p>${esc(v.text)}</p></div>`).join("")}
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
        <span>${esc(b.vol)} · ${b.chapters.length} 章</span>
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
      <div class="meta">${esc(b.editor)} · ${esc(b.press)}${b.pages ? " · " + b.pages + " 页" : ""} · 覆盖 ${esc(b.scope)}${b.en ? " · " + esc(b.en) : ""}</div>
      ${b.split ? `<div class="notice" style="margin-bottom:16px">${Object.entries(b.split).map(([k, v]) => `<b>${esc(k)}</b>　${esc(v)}`).join("　｜　")}</div>` : ""}
      <div id="idxChapters">
        ${chapters.length ? chapters.map(({ c, subs }) => {
          const hasSub = subs.length > 0;
          return `<div class="idx-ch${kw ? " open" : ""}">
            <button class="idx-ch-head" type="button" ${hasSub ? "" : 'disabled style="cursor:default"'}>
              <span class="caret">${hasSub ? "▶" : "·"}</span>
              <span class="t">${esc(c.t)}</span>
              ${c.p ? `<span class="pg">p.${c.p}</span>` : ""}
            </button>
            ${hasSub ? `<div class="idx-subs">${subs.map((s) => {
              const t = typeof s === "string" ? s : s.t;
              const p = typeof s === "string" ? null : s.p;
              return `<div class="idx-sub">${p ? `<span class="pg">${p}</span>` : '<span class="pg">—</span>'}<span>${esc(t)}</span></div>`;
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
    initHouseSwitch();
    renderEmperors();
    renderChrono();
    renderCompare();
    renderIndex();
    initIndexSearch();
    renderGlossary();
    initGlossSearch();
    renderThemes();
    initReader();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
