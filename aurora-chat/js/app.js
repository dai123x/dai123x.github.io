/* Aurora Chat · 主程序：状态、渲染与交互（无框架，原生 JS） */
(function () {
  "use strict";

  const uid = AC.store.uid;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  /* ================= 状态 ================= */
  let state = null;
  let currentId = null;
  const streaming = new Map(); // convId -> { type:'single', ctrl } | { type:'arena', ctrlA, ctrlB }
  let searchQ = "";
  let stickBottom = true;
  let editingMsgId = null;

  const messagesEl = () => $("#messages");
  const curConv = () => state.conversations.find((c) => c.id === currentId) || null;
  const getProvider = (id) => state.providers.list.find((p) => p.id === id) || null;

  function persist() {
    AC.store.save("settings", state.settings);
    AC.store.save("providers", state.providers);
    AC.store.save("conversations", state.conversations);
    AC.store.save("templates", state.templates);
  }

  /* ================= 小工具 ================= */

  function esc(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  }

  function fmtTime(ts) {
    if (!ts) return "";
    const d = new Date(ts), now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    if (sameDay) return hm;
    const yest = new Date(now); yest.setDate(now.getDate() - 1);
    if (d.toDateString() === yest.toDateString()) return "昨天";
    if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}-${d.getDate()}`;
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  }

  function toast(msg, type = "ok", ms = 2600) {
    const root = $("#toast-root");
    const el = document.createElement("div");
    el.className = "toast " + type;
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(() => el.classList.add("out"), ms);
    setTimeout(() => el.remove(), ms + 300);
  }

  function makeThrottle(fn, ms = 90) {
    let dirty = false, timer = null;
    const run = () => { timer = null; if (dirty) { dirty = false; fn(); } };
    return {
      kick() { dirty = true; if (!timer) timer = setTimeout(run, ms); },
      flush() { if (timer) { clearTimeout(timer); timer = null; } dirty = false; fn(); },
    };
  }

  function download(filename, content, type = "application/json") {
    const blob = new Blob([content], { type: type + ";charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      const ta = document.createElement("textarea");
      ta.value = text; document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand("copy"); } catch (e2) { /* 忽略 */ }
      ta.remove();
      return ok;
    }
  }

  /* ================= 模态框基础 ================= */

  function closeModalAll() { $("#modal-root").innerHTML = ""; }

  function openModal(html, { wide = false } = {}) {
    const root = $("#modal-root");
    root.innerHTML = `<div class="backdrop"><div class="modal${wide ? " wide" : ""}">${html}</div></div>`;
    const backdrop = $(".backdrop", root);
    backdrop.addEventListener("mousedown", (e) => { if (e.target === backdrop) closeModalAll(); });
    $$("[data-close]", root).forEach((b) => b.addEventListener("click", closeModalAll));
    return root;
  }

  function confirmDialog({ title, body, okText = "确定", danger = false }) {
    return new Promise((resolve) => {
      const root = $("#modal-root");
      const wrap = document.createElement("div");
      wrap.className = "backdrop";
      wrap.innerHTML = `
        <div class="modal" style="max-width:420px">
          <div class="modal-head"><h2>${esc(title)}</h2><button class="icon-btn" data-x>✕</button></div>
          <div class="modal-body" style="color:var(--muted);font-size:13.5px">${body || ""}</div>
          <div class="modal-foot">
            <button class="btn" data-x>取消</button>
            <button class="btn ${danger ? "danger" : "primary"}" data-ok>${esc(okText)}</button>
          </div>
        </div>`;
      root.appendChild(wrap);
      const done = (v) => { wrap.remove(); resolve(v); };
      wrap.addEventListener("mousedown", (e) => { if (e.target === wrap) done(false); });
      $$("[data-x]", wrap).forEach((b) => b.addEventListener("click", () => done(false)));
      $("[data-ok]", wrap).addEventListener("click", () => done(true));
    });
  }

  function promptDialog({ title, label, value = "", placeholder = "" }) {
    return new Promise((resolve) => {
      const root = $("#modal-root");
      const wrap = document.createElement("div");
      wrap.className = "backdrop";
      wrap.innerHTML = `
        <div class="modal" style="max-width:440px">
          <div class="modal-head"><h2>${esc(title)}</h2><button class="icon-btn" data-x>✕</button></div>
          <div class="modal-body">
            <div class="form-row"><label>${esc(label || "")}</label>
              <input type="text" id="pd-input" value="${esc(value)}" placeholder="${esc(placeholder)}">
            </div>
          </div>
          <div class="modal-foot">
            <button class="btn" data-x>取消</button>
            <button class="btn primary" data-ok>确定</button>
          </div>
        </div>`;
      root.appendChild(wrap);
      const input = $("#pd-input", wrap);
      input.focus(); input.select();
      const done = (v) => { wrap.remove(); resolve(v); };
      wrap.addEventListener("mousedown", (e) => { if (e.target === wrap) done(null); });
      $$("[data-x]", wrap).forEach((b) => b.addEventListener("click", () => done(null)));
      $("[data-ok]", wrap).addEventListener("click", () => done(input.value.trim() || null));
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.isComposing) done(input.value.trim() || null);
        if (e.key === "Escape") done(null);
      });
    });
  }

  /* ================= 主题 ================= */

  function applyTheme() {
    document.documentElement.dataset.theme = state.settings.theme;
    $("#btn-theme").textContent = state.settings.theme === "dark" ? "🌙" : "☀️";
  }

  /* ================= 侧栏 / 对话列表 ================= */

  function convSearchText(c) {
    let s = c.title || "";
    (c.messages || []).forEach((m) => { s += "\n" + m.content; });
    (c.arena?.rounds || []).forEach((r) => { s += "\n" + r.prompt + "\n" + r.A.content + "\n" + r.B.content; });
    return s.toLowerCase();
  }

  function renderConvList() {
    const list = $("#conv-list");
    const q = searchQ.trim().toLowerCase();
    const items = [...state.conversations].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const filtered = q ? items.filter((c) => convSearchText(c).includes(q)) : items;

    if (!filtered.length) {
      list.innerHTML = `<div class="conv-empty">${q ? "没有匹配的对话" : "还没有对话，点上方「新建对话」开始"}</div>`;
      return;
    }
    list.innerHTML = filtered.map((c) => `
      <div class="conv-item${c.id === currentId ? " active" : ""}" data-cid="${c.id}">
        <div class="conv-title">${esc(c.title || "新对话")}</div>
        <div class="conv-meta">
          <span>${fmtTime(c.updatedAt)}</span>
          ${c.mode === "arena" ? '<span class="tag">⚔️ 对比</span>' : ""}
          <span class="tag">${esc(shortModel(c))}</span>
        </div>
        <div class="conv-acts">
          <button data-cact="rename" title="重命名">✎</button>
          <button data-cact="del" class="del" title="删除">🗑</button>
        </div>
      </div>`).join("");
  }

  function shortModel(c) {
    if (c.mode === "arena") {
      const b = c.arena?.modelB || "?";
      return `${c.model || "?"} / ${b}`;
    }
    return c.model || "未选模型";
  }

  /* ================= 头部 ================= */

  function buildModelSelect(sel, currentPid, currentModel, placeholder) {
    sel.innerHTML = "";
    const withModels = state.providers.list.filter((p) => p.models.length > 0 || p.demo);
    let found = false;
    withModels.forEach((p) => {
      const g = document.createElement("optgroup");
      g.label = p.name;
      p.models.forEach((m) => {
        const o = document.createElement("option");
        o.value = p.id + "::" + m;
        o.textContent = m;
        if (p.id === currentPid && m === currentModel) { o.selected = true; found = true; }
        g.appendChild(o);
      });
      sel.appendChild(g);
    });
    if (currentPid && !found) {
      const p = getProvider(currentPid);
      const o = document.createElement("option");
      o.value = currentPid + "::" + (currentModel || "");
      o.selected = true;
      o.textContent = `${p ? p.name : "未知"} · ${currentModel || "(未选模型)"}`;
      sel.prepend(o);
    }
    if (!currentPid && !currentModel) {
      const o = document.createElement("option");
      o.value = ""; o.selected = true; o.disabled = true;
      o.textContent = placeholder || "选择模型";
      sel.appendChild(o);
    }
    const custom = document.createElement("option");
    custom.value = "__custom__";
    custom.textContent = "✏️ 自定义模型名…";
    sel.appendChild(custom);
  }

  function renderHeader() {
    const c = curConv();
    $("#head-title").textContent = c ? (c.title || "新对话") : "Aurora Chat";
    const segBtns = $$("#mode-seg button");
    segBtns.forEach((b) => b.classList.toggle("active", !!c && b.dataset.mode === c.mode));

    if (!c) {
      $("#head-sub").textContent = "极光 · 数据只存在你的浏览器里";
      $("#model-select").innerHTML = '<option value="">选择模型</option>';
      $("#model-select-b").innerHTML = $("#model-select").innerHTML;
      $("#model-select-b").classList.add("hidden");
      renderFoot();
      return;
    }
    if (c.mode === "arena") {
      $("#model-select-b").classList.remove("hidden");
      buildModelSelect($("#model-select"), c.providerId, c.model, "模型 A");
      buildModelSelect($("#model-select-b"), c.arena?.providerIdB, c.arena?.modelB, "模型 B");
      $("#head-sub").textContent = `A：${c.model || "?"}　B：${c.arena?.modelB || "?"}`;
    } else {
      $("#model-select-b").classList.add("hidden");
      buildModelSelect($("#model-select"), c.providerId, c.model);
      const p = getProvider(c.providerId);
      $("#head-sub").textContent = p ? `${p.name} · ${c.model || "未选模型"}` : "未配置服务商";
    }
    renderFoot();
  }

  function renderFoot() {
    const c = curConv();
    $("#foot-left").textContent = c && c.systemPrompt ? "🎭 系统提示已生效" : "";
    const pill = $("#sys-pill");
    if (c && c.systemPrompt) {
      pill.classList.remove("hidden");
      $("#sys-pill-text").textContent = "🎭 系统提示：" + c.systemPrompt.slice(0, 60);
    } else {
      pill.classList.add("hidden");
    }
  }

  /* ================= 消息渲染 ================= */

  function msgMeta(msg) {
    const parts = [];
    if (msg.model) parts.push(msg.model);
    if (msg.durationMs) parts.push((msg.durationMs / 1000).toFixed(1) + "s");
    if (msg.usage) parts.push(`↑${msg.usage.prompt_tokens ?? "?"} ↓${msg.usage.completion_tokens ?? "?"}`);
    if (msg.stopped) parts.push("已停止");
    return parts.join(" · ");
  }

  function assistantBodyHTML(msg) {
    let html = "";
    if (msg.reasoning) {
      html += `<details class="thinking"${msg.streaming ? "" : " open"}>
        <summary>💭 思考过程${msg.streaming ? "（生成中…）" : ""}</summary>
        <div class="thinking-body">${esc(msg.reasoning)}</div></details>`;
    }
    if (msg.error && !msg.content) {
      html += `<div class="error-card"><div class="err-title">⚠️ 请求失败</div>
        <div>${esc(msg.error)}</div>
        <div class="err-hint">浏览器直连失败时：检查 Key 与网络；或使用仓库 examples/ 里的 Cloudflare Worker 反代。</div>
        <button class="retry" data-act="retry" data-mid="${msg.id}">↻ 重试</button></div>`;
    } else {
      html += `<div class="md-body${msg.streaming ? " cursor" : ""}">${AC.md.render(msg.content)}</div>`;
    }
    return html;
  }

  function msgHTML(msg) {
    const isUser = msg.role === "user";
    const body = isUser
      ? `<div class="msg-text">${esc(msg.content)}</div>`
      : assistantBodyHTML(msg);
    const meta = msgMeta(msg);
    const acts = isUser
      ? `<button class="msg-act" data-act="copy" data-mid="${msg.id}" title="复制">📋</button>
         <button class="msg-act" data-act="edit" data-mid="${msg.id}" title="编辑并重发">✎</button>
         <button class="msg-act danger" data-act="del" data-mid="${msg.id}" title="删除">🗑</button>`
      : `<button class="msg-act" data-act="copy" data-mid="${msg.id}" title="复制">📋</button>
         <button class="msg-act" data-act="regen" data-mid="${msg.id}" title="重新生成">↻</button>
         <button class="msg-act danger" data-act="del" data-mid="${msg.id}" title="删除">🗑</button>`;
    return `
      <div class="msg ${isUser ? "user" : "assistant"}" data-mid="${msg.id}">
        <div class="avatar">${isUser ? "你" : AC.LOGO_SVG}</div>
        <div class="bubble">
          ${editingMsgId === msg.id ? editHTML(msg) : body}
          <div class="msg-foot">
            ${meta ? `<span class="meta">${esc(meta)}</span>` : ""}
            <span class="spacer"></span>${acts}
          </div>
        </div>
      </div>`;
  }

  function editHTML(msg) {
    return `<div class="edit-box">
      <textarea class="edit-ta" style="width:100%;min-height:70px;padding:9px 12px;border-radius:10px;
        background:var(--panel-2);border:1px solid var(--border-soft);outline:none;resize:vertical">${esc(msg.content)}</textarea>
      <div style="display:flex;gap:8px;margin-top:8px;justify-content:flex-end">
        <button class="btn" data-act="edit-cancel">取消</button>
        <button class="btn primary" data-act="edit-save" data-mid="${msg.id}">保存并重发</button>
      </div></div>`;
  }

  function heroHTML() {
    return `<div class="hero">
      <div class="hero-glow"></div>
      <svg class="hero-logo" viewBox="0 0 64 64">
        <defs><linearGradient id="lg-hero" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stop-color="#34d399"/><stop offset=".5" stop-color="#22d3ee"/><stop offset="1" stop-color="#818cf8"/>
        </linearGradient></defs>
        <rect width="64" height="64" rx="14" fill="var(--bg-deep)"/>
        <path d="M10 46 Q22 18 33 33 T54 18" stroke="url(#lg-hero)" stroke-width="6" fill="none" stroke-linecap="round"/>
        <path d="M10 33 Q24 12 35 25 T54 11" stroke="url(#lg-hero)" stroke-width="4" fill="none" stroke-linecap="round" opacity=".55"/>
      </svg>
      <h1>Aurora Chat</h1>
      <p>极光 · 私有 AI 聊天工作台 —— 零后端、数据不出浏览器</p>
      <div class="hero-actions">
        <button class="btn primary" data-hero="demo">🚀 一键体验（演示模式）</button>
        <button class="btn" data-hero="setup">🔑 配置 API，直连真实模型</button>
      </div>
      <div class="starters">
        ${AC.STARTERS.map((s) => `<button data-starter="${esc(s)}">${esc(s)}</button>`).join("")}
      </div>
    </div>`;
  }

  function roundHTML(round) {
    const col = (key, label) => {
      const s = round[key];
      const body = s.error && !s.content
        ? `<div class="error-card"><div class="err-title">⚠️ ${label} 失败</div><div>${esc(s.error)}</div></div>`
        : `<div class="md-body${s.streaming ? " cursor" : ""}">${AC.md.render(s.content)}</div>`;
      const thinking = s.reasoning
        ? `<details class="thinking"${s.streaming ? "" : " open"}><summary>💭 思考过程</summary>
             <div class="thinking-body">${esc(s.reasoning)}</div></details>`
        : "";
      const win = round.vote === key ? '<span class="win">👑</span>' : "";
      return `<div class="round-col" data-col="${key}">
        <div class="col-head"><span class="model-chip">${esc(s.model || label)}</span>${win}
          ${s.durationMs ? `<span>${(s.durationMs / 1000).toFixed(1)}s</span>` : ""}</div>
        ${thinking}${body}
      </div>`;
    };
    const bothDone = !round.A.streaming && !round.B.streaming;
    const hasContent = round.A.content || round.B.content || round.A.error || round.B.error;
    const voteBar = bothDone && hasContent
      ? `<div class="vote-bar">
          <button data-vote="A" class="${round.vote === "A" ? "picked" : ""}">👍 A 更好</button>
          <button data-vote="tie" class="${round.vote === "tie" ? "picked" : ""}">🤝 平手</button>
          <button data-vote="B" class="${round.vote === "B" ? "picked" : ""}">👍 B 更好</button>
        </div>`
      : "";
    return `<div class="round" data-rid="${round.id}">
      <div class="round-prompt">${esc(round.prompt)}</div>
      <div class="round-cols">${col("A", "A")}${col("B", "B")}${voteBar}</div>
    </div>`;
  }

  function renderMessages() {
    const col = $("#msg-col");
    const c = curConv();
    if (!c || (c.messages.length === 0 && !(c.arena && c.arena.rounds.length))) {
      col.innerHTML = heroHTML();
      return;
    }
    if (c.mode === "arena") {
      const rounds = c.arena?.rounds || [];
      col.innerHTML = rounds.length
        ? rounds.map(roundHTML).join("")
        : heroHTML();
    } else {
      col.innerHTML = c.messages.map(msgHTML).join("");
    }
    AC.md.enhance(col);
  }

  function appendMsgEl(msg) {
    const col = $("#msg-col");
    const hero = $(".hero", col);
    if (hero) col.innerHTML = "";
    col.insertAdjacentHTML("beforeend", msgHTML(msg));
    AC.md.enhance(col);
    scrollBottom(true);
  }

  function appendRoundEl(round) {
    const col = $("#msg-col");
    const hero = $(".hero", col);
    if (hero) col.innerHTML = "";
    col.insertAdjacentHTML("beforeend", roundHTML(round));
    AC.md.enhance(col);
    scrollBottom(true);
  }

  function scrollBottom(force = false) {
    const m = messagesEl();
    if (force || stickBottom) m.scrollTop = m.scrollHeight;
  }

  function updateStreamBubble(msg) {
    const el = $(`#msg-col [data-mid="${msg.id}"]`);
    if (!el) return;
    const body = $(".md-body", el);
    if (body) body.innerHTML = AC.md.render(msg.content);
    const th = $(".thinking-body", el);
    if (th && msg.reasoning) th.textContent = msg.reasoning;
    scrollBottom();
  }

  function updateStreamCol(round, key) {
    const el = $(`#msg-col [data-rid="${round.id}"] [data-col="${key}"]`);
    if (!el) return;
    const s = round[key];
    const body = $(".md-body", el);
    if (body) body.innerHTML = AC.md.render(s.content);
    const th = $(".thinking-body", el);
    if (th && s.reasoning) th.textContent = s.reasoning;
    scrollBottom();
  }

  /* ================= 会话操作 ================= */

  function newConv(mode = "single") {
    const def = defaultProvider();
    const c = {
      id: uid(), title: "", mode, createdAt: Date.now(), updatedAt: Date.now(),
      providerId: def.id, model: def.models[0] || "",
      systemPrompt: "", messages: [],
      arena: { providerIdB: def.id, modelB: def.models[1] || def.models[0] || "", rounds: [] },
    };
    state.conversations.unshift(c);
    currentId = c.id;
    persist(); renderConvList(); renderHeader(); renderMessages(); renderFoot(); updateSendBtn();
    closeSidebarIfMobile();
    return c;
  }

  function defaultProvider() {
    let p = getProvider(state.settings.defaultProviderId);
    if (!p || p.demo) p = state.providers.list.find((x) => !x.demo) || getProvider(AC.DEMO_PROVIDER_ID);
    return p || { id: AC.DEMO_PROVIDER_ID, models: ["aurora-demo"] };
  }

  function openConv(id) {
    currentId = id;
    editingMsgId = null;
    renderConvList(); renderHeader(); renderMessages(); renderFoot(); updateSendBtn();
    closeSidebarIfMobile();
  }

  function ensureConv(mode) {
    let c = curConv();
    if (!c) return newConv(mode);
    if (c.mode !== mode) c.mode = mode;
    return c;
  }

  function closeSidebarIfMobile() {
    $("#sidebar").classList.remove("open");
    $("#side-mask").classList.remove("show");
  }

  function renameConv(c) {
    promptDialog({ title: "重命名对话", label: "新的名称", value: c.title || "" }).then((v) => {
      if (v == null) return;
      c.title = v;
      c.updatedAt = Date.now();
      persist(); renderConvList(); renderHeader();
    });
  }

  async function deleteConv(c) {
    const ok = await confirmDialog({
      title: "删除对话", danger: true, okText: "删除",
      body: `确定删除「<b>${esc(c.title || "新对话")}</b>」吗？该操作不可恢复。`,
    });
    if (!ok) return;
    const st = streaming.get(c.id);
    if (st) abortStream(c.id);
    state.conversations = state.conversations.filter((x) => x.id !== c.id);
    if (currentId === c.id) currentId = state.conversations[0]?.id || null;
    persist(); renderConvList(); renderHeader(); renderMessages(); renderFoot(); updateSendBtn();
    toast("已删除");
  }

  function clearConvMessages(c) {
    c.messages = [];
    if (c.arena) c.arena.rounds = [];
    c.updatedAt = Date.now();
    persist(); renderMessages(); renderConvList(); updateSendBtn();
    toast("已清空本对话内容");
  }

  /* ================= 发送与响应 ================= */

  function buildPayload(conv) {
    const msgs = [];
    if (conv.systemPrompt && conv.systemPrompt.trim()) {
      msgs.push({ role: "system", content: conv.systemPrompt.trim() });
    }
    let history = conv.messages.filter((m) => !m.error && m.content && !m.streaming);
    const limit = state.settings.contextLimit;
    if (limit > 0) history = history.slice(-limit);
    history.forEach((m) => msgs.push({ role: m.role, content: m.content }));
    return msgs;
  }

  function demoVariantSingle(conv) {
    return conv.messages.filter((m) => m.role === "assistant").length % 3;
  }

  function sendFromInput() {
    const input = $("#input");
    const text = input.value.trim();
    if (!text) return;
    const c = curConv();
    if (c && streaming.has(c.id)) return;
    input.value = "";
    autoResize();
    const conv = ensureConv($("#mode-seg .active")?.dataset.mode === "arena" && (!c || c.mode === "arena") ? "arena" : "single");
    if (conv.mode === "arena") sendArena(conv, text);
    else sendSingle(conv, text);
  }

  function markTitle(conv, text) {
    if (conv.title) return;
    conv.title = text.replace(/\s+/g, " ").slice(0, 24) || "新对话";
  }

  function sendSingle(conv, text) {
    conv.messages.push({ id: uid(), role: "user", content: text, createdAt: Date.now() });
    markTitle(conv, text);
    conv.updatedAt = Date.now();
    persist(); renderConvList(); renderHeader();
    const last = conv.messages[conv.messages.length - 1];
    const hero = $(".hero", $("#msg-col"));
    if (hero || curConv()?.id !== conv.id) renderMessages(); else appendMsgEl(last);
    respondSingle(conv);
  }

  async function respondSingle(conv) {
    const provider = getProvider(conv.providerId);
    if (!provider || (!provider.demo && !conv.model)) {
      toast("请先选择模型（或配置服务商）", "err");
      renderHeader();
      return;
    }
    if (provider.demo) conv.model = "aurora-demo";

    const variant = demoVariantSingle(conv);
    const msg = {
      id: uid(), role: "assistant", content: "", reasoning: "",
      model: conv.model, providerId: provider.id, createdAt: Date.now(), streaming: true,
    };
    conv.messages.push(msg);
    appendMsgEl(msg);

    const ctrl = new AbortController();
    streaming.set(conv.id, { type: "single", ctrl });
    updateSendBtn();

    const flush = makeThrottle(() => updateStreamBubble(msg));
    const t0 = performance.now();
    try {
      const runner = provider.demo
        ? AC.api.demoStream
        : state.settings.stream ? AC.api.streamChat : AC.api.chatOnce;
      const { usage } = await runner({
        provider, model: conv.model,
        messages: buildPayload(conv),
        temperature: state.settings.temperature,
        maxTokens: state.settings.maxTokens,
        signal: ctrl.signal,
        variant,
        onDelta: (t) => { msg.content += t; flush.kick(); },
        onReasoning: (t) => { msg.reasoning += t; flush.kick(); },
        onUsage: (u) => { msg.usage = u; },
      });
      msg.usage = usage || msg.usage;
      msg.streaming = false;
      msg.durationMs = Math.round(performance.now() - t0);
      flush.flush();
    } catch (err) {
      msg.streaming = false;
      if (err.name === "AbortError") {
        msg.stopped = true;
        if (!msg.content && !msg.reasoning) {
          const i = conv.messages.indexOf(msg);
          if (i >= 0) conv.messages.splice(i, 1);
        }
      } else {
        msg.error = err.status === 0 ? err.message : err.message;
      }
    } finally {
      streaming.delete(conv.id);
      msg.streaming = false;
      conv.updatedAt = Date.now();
      persist();
      if (curConv()?.id === conv.id) renderMessages();
      renderConvList(); updateSendBtn();
    }
  }

  function sendArena(conv, text) {
    if (!conv.arena) conv.arena = { providerIdB: defaultProvider().id, modelB: "", rounds: [] };
    const round = {
      id: uid(), prompt: text, createdAt: Date.now(), vote: "",
      A: { content: "", reasoning: "", model: conv.model, providerId: conv.providerId, streaming: true },
      B: { content: "", reasoning: "", model: conv.arena.modelB, providerId: conv.arena.providerIdB, streaming: true },
    };
    conv.arena.rounds.push(round);
    markTitle(conv, text);
    conv.updatedAt = Date.now();
    persist(); renderConvList(); renderHeader();
    appendRoundEl(round);

    streaming.set(conv.id, { type: "arena", ctrlA: new AbortController(), ctrlB: new AbortController() });
    updateSendBtn();
    Promise.allSettled([runColumn(conv, round, "A"), runColumn(conv, round, "B")]).then(() => {
      streaming.delete(conv.id);
      round.A.streaming = round.B.streaming = false;
      conv.updatedAt = Date.now();
      persist();
      if (curConv()?.id === conv.id) renderMessages();
      renderConvList(); updateSendBtn();
    });
  }

  async function runColumn(conv, round, key) {
    const st = streaming.get(conv.id);
    const ctrl = key === "A" ? st.ctrlA : st.ctrlB;
    const pid = key === "A" ? conv.providerId : conv.arena.providerIdB;
    const model = key === "A" ? conv.model : conv.arena.modelB;
    const provider = getProvider(pid);

    if (!provider || (!provider.demo && !model)) {
      round[key].streaming = false;
      round[key].error = "未选择模型，请点击顶部模型下拉框选择";
      return;
    }
    if (provider.demo) round[key].model = "aurora-demo";

    const s = round[key];
    const flush = makeThrottle(() => updateStreamCol(round, key));
    const t0 = performance.now();
    try {
      const runner = provider.demo
        ? AC.api.demoStream
        : state.settings.stream ? AC.api.streamChat : AC.api.chatOnce;
      const variant = key === "A" ? conv.arena.rounds.indexOf(round) % 3 : (conv.arena.rounds.indexOf(round) + 1) % 3;
      const { usage } = await runner({
        provider, model,
        messages: [
          ...(conv.systemPrompt ? [{ role: "system", content: conv.systemPrompt }] : []),
          { role: "user", content: round.prompt },
        ],
        temperature: state.settings.temperature,
        maxTokens: state.settings.maxTokens,
        signal: ctrl.signal,
        variant,
        onDelta: (t) => { s.content += t; flush.kick(); },
        onReasoning: (t) => { s.reasoning += t; flush.kick(); },
        onUsage: (u) => { s.usage = u; },
      });
      s.usage = usage || s.usage;
      s.durationMs = Math.round(performance.now() - t0);
      flush.flush();
    } catch (err) {
      if (err.name === "AbortError") {
        s.stopped = true;
      } else {
        s.error = err.message;
      }
    } finally {
      s.streaming = false;
    }
  }

  function abortStream(convId) {
    const st = streaming.get(convId);
    if (!st) return;
    if (st.type === "arena") { st.ctrlA?.abort(); st.ctrlB?.abort(); }
    else st.ctrl?.abort();
  }

  function updateSendBtn() {
    const btn = $("#btn-send");
    const c = curConv();
    const active = c && streaming.has(c.id);
    btn.classList.toggle("stopping", !!active);
    $("#icon-send").classList.toggle("hidden", !!active);
    $("#icon-stop").classList.toggle("hidden", !active);
    btn.title = active ? "停止生成" : "发送";
    if (active) { btn.disabled = false; return; }
    btn.disabled = !$("#input").value.trim();
  }

  /* ================= 消息动作 ================= */

  function findMsg(mid) {
    const c = curConv();
    if (!c) return {};
    const idx = c.messages.findIndex((m) => m.id === mid);
    return idx >= 0 ? { c, msg: c.messages[idx], idx } : {};
  }

  async function msgAction(act, mid) {
    const c = curConv();
    if (!c) return;
    const { msg, idx } = findMsg(mid);

    if (act === "copy" && msg) {
      (await copyText(msg.content)) ? toast("已复制") : toast("复制失败", "err");
      return;
    }
    if (act === "del" && msg) {
      c.messages.splice(idx, 1);
      persist(); renderMessages(); renderConvList();
      return;
    }
    if (act === "regen" && msg) {
      if (streaming.has(c.id)) { toast("正在生成中，请先停止", "err"); return; }
      c.messages = c.messages.slice(0, idx);
      persist(); renderMessages();
      respondSingle(c);
      return;
    }
    if (act === "retry" && msg) {
      c.messages = c.messages.slice(0, idx);
      persist(); renderMessages();
      respondSingle(c);
      return;
    }
    if (act === "edit" && msg) {
      editingMsgId = mid;
      renderMessages();
      const ta = $(".edit-ta", $("#msg-col"));
      if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
      return;
    }
    if (act === "edit-cancel") {
      editingMsgId = null;
      renderMessages();
      return;
    }
    if (act === "edit-save" && msg) {
      const ta = $(".edit-ta", $("#msg-col"));
      const text = ta?.value.trim();
      if (!text) { toast("内容不能为空", "err"); return; }
      editingMsgId = null;
      msg.content = text;
      c.messages = c.messages.slice(0, idx + 1);
      persist(); renderMessages();
      respondSingle(c);
      return;
    }
  }

  /* ================= 设置模态框 ================= */

  function openSettings(tab = "providers") {
    const html = `
      <div class="modal-head"><h2>⚙️ 设置</h2><button class="icon-btn" data-close>✕</button></div>
      <div class="tabs">
        <button data-tab="providers" class="${tab === "providers" ? "active" : ""}">服务商</button>
        <button data-tab="general" class="${tab === "general" ? "active" : ""}">通用</button>
        <button data-tab="data" class="${tab === "data" ? "active" : ""}">数据</button>
        <button data-tab="about" class="${tab === "about" ? "active" : ""}">关于</button>
      </div>
      <div class="modal-body" id="settings-body"></div>`;
    openModal(html, { wide: true });
    $$(".tabs button").forEach((b) =>
      b.addEventListener("click", () => openSettings(b.dataset.tab)));
    renderSettingsTab(tab);
  }

  function renderSettingsTab(tab) {
    const body = $("#settings-body");
    if (tab === "providers") body.innerHTML = providersTabHTML();
    if (tab === "general") { body.innerHTML = generalTabHTML(); bindGeneralTab(); }
    if (tab === "data") { body.innerHTML = dataTabHTML(); bindDataTab(); }
    if (tab === "about") body.innerHTML = aboutTabHTML();

    if (tab === "providers") {
      $("#btn-add-provider").addEventListener("click", () => openProviderForm(null));
      $$("#settings-body [data-pedit]").forEach((b) =>
        b.addEventListener("click", () => openProviderForm(getProvider(b.dataset.pedit))));
      $$("#settings-body [data-pdel]").forEach((b) =>
        b.addEventListener("click", async () => {
          const p = getProvider(b.dataset.pdel);
          if (!p) return;
          if (p.demo) { toast("演示模式不可删除", "err"); return; }
          const ok = await confirmDialog({
            title: "删除服务商", danger: true, okText: "删除",
            body: `删除「<b>${esc(p.name)}</b>」不会影响已有对话记录。`,
          });
          if (!ok) return;
          state.providers.list = state.providers.list.filter((x) => x.id !== p.id);
          persist(); openSettings("providers"); renderHeader(); renderConvList();
        }));
    }
  }

  function providersTabHTML() {
    return `
      <p style="margin:4px 0 12px;font-size:12.5px;color:var(--muted)">
        所有服务商均走 OpenAI 兼容协议（/chat/completions）。API Key 只保存在本机浏览器，请求由你的浏览器直接发往对应服务商。
      </p>
      ${state.providers.list.map((p) => `
        <div class="provider-card">
          <div class="p-info">
            <div class="p-name">${esc(p.name)}
              ${p.demo ? '<span class="badge gray">内置演示</span>' : p.apiKey ? '<span class="badge">Key 已配置</span>' : '<span class="badge gray">未配 Key</span>'}
            </div>
            <div class="p-url">${esc(p.baseURL === "demo" ? "本地生成，无需网络" : p.baseURL)} · ${p.models.length} 个模型</div>
          </div>
          <div class="p-acts">
            ${p.demo ? "" : `<button class="icon-btn" data-pedit="${p.id}" title="编辑">✎</button>
            <button class="icon-btn del" data-pdel="${p.id}" title="删除">🗑</button>`}
          </div>
        </div>`).join("")}
      <button class="btn" id="btn-add-provider" style="width:100%">＋ 添加服务商</button>`;
  }

  function openProviderForm(existing) {
    const isNew = !existing;
    const p = existing || { id: uid(), name: "", baseURL: "", apiKey: "", models: [] };
    const presetHints = AC.PROVIDER_PRESETS.filter((x) => !state.providers.list.some((l) => l.id === x.id));
    const html = `
      <div class="modal-head"><h2>${isNew ? "添加服务商" : "编辑：" + esc(p.name)}</h2><button class="icon-btn" data-close>✕</button></div>
      <div class="modal-body">
        ${isNew && presetHints.length ? `
        <div class="form-row"><label>快速填入预设（Base URL 与常用模型）</label>
          <div class="chip-list">
            ${presetHints.map((x) => `<button class="chip" data-preset="${x.id}">${esc(x.name)}</button>`).join("")}
          </div>
        </div>` : ""}
        <div class="form-grid">
          <div class="form-row"><label>名称 *</label><input type="text" id="pf-name" value="${esc(p.name)}" placeholder="如：我的 GLM"></div>
          <div class="form-row"><label>Base URL *</label><input type="text" id="pf-url" value="${esc(p.baseURL === "demo" ? "" : p.baseURL)}" placeholder="https://…/v1"></div>
        </div>
        <div class="form-row"><label>API Key</label>
          <div class="form-inline">
            <input type="password" id="pf-key" value="${esc(p.apiKey)}" placeholder="sk-…" autocomplete="off">
            <button class="btn" id="pf-show" type="button">显示</button>
          </div>
        </div>
        <div class="form-row"><label>模型列表（点 ✕ 移除）</label>
          <div class="chip-list" id="pf-chips"></div>
          <div class="form-inline" style="margin-top:8px">
            <input type="text" id="pf-model" placeholder="输入模型名后回车，如 glm-4.6">
            <button class="btn" id="pf-fetch" type="button" title="用上面的 Key 请求 /models 接口">🔃 从 API 拉取</button>
          </div>
          <div class="hint">部分服务商（如 Ollama）不会自带模型列表，手动输入即可。</div>
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn" data-close>取消</button>
        <button class="btn primary" id="pf-save">保存</button>
      </div>`;

    const models = [...p.models];
    openModal(html);

    const renderChips = () => {
      $("#pf-chips").innerHTML = models.length
        ? models.map((m, i) => `<span class="chip">${esc(m)}<button data-mi="${i}" title="移除">✕</button></span>`).join("")
        : '<span style="font-size:12px;color:var(--faint)">暂无模型</span>';
      $$("#pf-chips [data-mi]").forEach((b) =>
        b.addEventListener("click", () => { models.splice(+b.dataset.mi, 1); renderChips(); }));
    };
    renderChips();

    $$("[data-preset]").forEach((b) => b.addEventListener("click", () => {
      const preset = AC.PROVIDER_PRESETS.find((x) => x.id === b.dataset.preset);
      if (!preset) return;
      $("#pf-name").value = preset.name;
      $("#pf-url").value = preset.baseURL;
      preset.models.forEach((m) => { if (!models.includes(m)) models.push(m); });
      renderChips();
    }));

    $("#pf-show").addEventListener("click", () => {
      const k = $("#pf-key");
      k.type = k.type === "password" ? "text" : "password";
      $("#pf-show").textContent = k.type === "password" ? "显示" : "隐藏";
    });
    $("#pf-model").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.isComposing) {
        e.preventDefault();
        const v = $("#pf-model").value.trim();
        if (v && !models.includes(v)) { models.push(v); renderChips(); }
        $("#pf-model").value = "";
      }
    });
    $("#pf-fetch").addEventListener("click", async () => {
      const tmp = { baseURL: $("#pf-url").value.trim(), apiKey: $("#pf-key").value.trim() };
      if (!tmp.baseURL) { toast("请先填写 Base URL", "err"); return; }
      $("#pf-fetch").textContent = "拉取中…";
      try {
        const ids = await AC.api.listModels(tmp);
        ids.forEach((m) => { if (!models.includes(m)) models.push(m); });
        renderChips();
        toast(`拉取到 ${ids.length} 个模型`);
      } catch (err) {
        toast("拉取失败：" + err.message, "err", 4000);
      }
      $("#pf-fetch").textContent = "🔃 从 API 拉取";
    });
    $("#pf-save").addEventListener("click", () => {
      const name = $("#pf-name").value.trim();
      const baseURL = $("#pf-url").value.trim();
      if (!name || !baseURL) { toast("名称和 Base URL 必填", "err"); return; }
      const target = existing || { id: uid(), builtin: false };
      target.name = name;
      target.baseURL = baseURL;
      target.apiKey = $("#pf-key").value.trim();
      target.models = models;
      if (!existing) state.providers.list.push(target);
      persist();
      openSettings("providers"); renderHeader(); renderConvList();
      toast("已保存");
    });
  }

  function generalTabHTML() {
    const s = state.settings;
    const provOpts = state.providers.list.filter((p) => !p.demo)
      .map((p) => `<option value="${p.id}" ${p.id === s.defaultProviderId ? "selected" : ""}>${esc(p.name)}</option>`).join("");
    return `
      <div class="form-row"><label>默认服务商（新建对话使用）</label><select id="gs-defprov">${provOpts}</select></div>
      <div class="form-row"><label>温度（创造性，0 = 稳定）</label>
        <div class="range-row"><input type="range" id="gs-temp" min="0" max="2" step="0.1" value="${s.temperature}">
        <span class="val" id="gs-temp-val">${s.temperature}</span></div></div>
      <div class="form-grid">
        <div class="form-row"><label>最大生成 tokens（留空不限）</label>
          <input type="number" id="gs-maxtok" min="1" step="64" value="${s.maxTokens ?? ""}" placeholder="不限制"></div>
        <div class="form-row"><label>携带历史条数（0 = 全部）</label>
          <input type="number" id="gs-ctx" min="0" step="2" value="${s.contextLimit}"></div>
      </div>
      <div class="form-row"><label class="check-row"><input type="checkbox" id="gs-stream" ${s.stream ? "checked" : ""}> 流式输出（逐字显示）</label></div>
      <div class="form-row"><label>主题</label>
        <select id="gs-theme">
          <option value="dark" ${s.theme === "dark" ? "selected" : ""}>深色</option>
          <option value="light" ${s.theme === "light" ? "selected" : ""}>浅色</option>
        </select></div>`;
  }

  function bindGeneralTab() {
    $("#gs-defprov").addEventListener("change", (e) => { state.settings.defaultProviderId = e.target.value; persist(); });
    $("#gs-temp").addEventListener("input", (e) => {
      state.settings.temperature = +e.target.value;
      $("#gs-temp-val").textContent = e.target.value;
      persist();
    });
    $("#gs-maxtok").addEventListener("change", (e) => { state.settings.maxTokens = +e.target.value || null; persist(); });
    $("#gs-ctx").addEventListener("change", (e) => { state.settings.contextLimit = Math.max(0, +e.target.value || 0); persist(); });
    $("#gs-stream").addEventListener("change", (e) => { state.settings.stream = e.target.checked; persist(); });
    $("#gs-theme").addEventListener("change", (e) => { state.settings.theme = e.target.value; applyTheme(); persist(); });
  }

  function dataTabHTML() {
    return `
      <div class="form-row">
        <label>备份</label>
        <p class="hint" style="margin:0 0 8px">导出包含全部对话、服务商配置（<b>含 API Key</b>）与模板，请妥善保管备份文件。</p>
        <div class="form-inline">
          <button class="btn" id="dt-export">⬇ 导出全部数据（JSON）</button>
          <button class="btn" id="dt-import-btn">⬆ 导入备份</button>
          <input type="file" id="dt-import" accept=".json" class="hidden">
        </div>
      </div>
      <div class="form-row">
        <label>导出单篇对话</label>
        <p class="hint" style="margin:0 0 8px">在「对话设置」（右上角 ⋯）里可以把当前对话导出为 Markdown。</p>
      </div>
      <div class="form-row">
        <label style="color:var(--danger)">危险操作</label>
        <button class="btn danger" id="dt-clear">🗑 清空全部本地数据</button>
      </div>`;
  }

  function bindDataTab() {
    $("#dt-export").addEventListener("click", () => {
      download(`aurora-chat-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(AC.store.exportAll(state), null, 2));
      toast("已导出");
    });
    $("#dt-import-btn").addEventListener("click", () => $("#dt-import").click());
    $("#dt-import").addEventListener("change", (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const json = JSON.parse(reader.result);
          const ok = await confirmDialog({
            title: "导入备份", body: "导入会<b>覆盖</b>当前全部本地数据，确定继续吗？", danger: true, okText: "覆盖导入",
          });
          if (!ok) return;
          state = AC.store.importAll(json);
          currentId = null;
          applyTheme();
          renderConvList(); renderHeader(); renderMessages(); renderFoot(); updateSendBtn();
          openSettings("data");
          toast("导入成功");
        } catch (err) {
          toast("导入失败：" + err.message, "err", 4000);
        }
      };
      reader.readAsText(f);
    });
    $("#dt-clear").addEventListener("click", async () => {
      const ok1 = await confirmDialog({ title: "清空全部数据", body: "将删除所有对话、配置与模板，<b>不可恢复</b>。", danger: true, okText: "继续" });
      if (!ok1) return;
      const ok2 = await confirmDialog({ title: "再次确认", body: "真的要清空吗？建议先导出备份。", danger: true, okText: "全部清空" });
      if (!ok2) return;
      AC.store.clearAll();
      state = AC.store.loadAll();
      currentId = null;
      applyTheme();
      renderConvList(); renderHeader(); renderMessages(); renderFoot(); updateSendBtn();
      closeModalAll();
      toast("已清空");
    });
  }

  function aboutTabHTML() {
    return `
      <p style="font-size:13.5px;line-height:1.8">
        <b>Aurora Chat · 极光</b> v${AC.VERSION}<br>
        一个纯静态的私有 AI 聊天工作台：浏览器直连各服务商 API，没有后端、没有账号，数据只存在本机 localStorage。
      </p>
      <ul class="about-list">
        <li>对话体验参考 <b>lobe-chat</b> / <b>open-webui</b></li>
        <li>双模型对比参考 <b>LMSYS Chatbot Arena</b></li>
        <li>提示词库参考 <b>awesome-chatgpt-prompts</b></li>
        <li>推理模型（GLM-4.5+ / DeepSeek-R1）的思考过程会折叠展示</li>
      </ul>
      <p class="hint" style="margin-top:12px">
        <b>开源与商用：</b>本程序基于 MIT 许可证开源——允许自由使用、修改、再分发与<b>商业使用</b>，
        唯一义务是保留版权与许可声明；捆绑的第三方组件（marked / DOMPurify / highlight.js）
        均为宽松许可，声明见仓库 <b>THIRD-PARTY-NOTICES.md</b>。<br>
        AI 生成内容请自行甄别；使用时请遵守所接入服务商的服务条款。<br>
        项目主页：<a href="${AC.HOMEPAGE_URL}" target="_blank" rel="noopener noreferrer" style="color:var(--acc2)">${AC.HOMEPAGE_URL}</a>
      </p>`;
  }

  /* ================= 对话设置 ================= */

  function openConvSettings() {
    const c = curConv();
    if (!c) { toast("先创建一个对话", "err"); return; }
    const html = `
      <div class="modal-head"><h2>对话设置</h2><button class="icon-btn" data-close>✕</button></div>
      <div class="modal-body">
        <div class="form-row"><label>系统提示（System Prompt，对本对话所有提问生效）</label>
          <textarea id="cs-sys" placeholder="例如：你是一位严谨的统计学助教，回答时先给结论再给推导。">${esc(c.systemPrompt || "")}</textarea>
          <div class="hint">想用现成模板？点输入框左侧的 📚。</div>
        </div>
        <div class="form-row"><label>其他操作</label>
          <div class="form-inline" style="flex-wrap:wrap">
            <button class="btn" id="cs-export">⬇ 导出 Markdown</button>
            <button class="btn" id="cs-clear">🧹 清空本对话内容</button>
            <button class="btn danger" id="cs-del">🗑 删除对话</button>
          </div>
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn" data-close>取消</button>
        <button class="btn primary" id="cs-save">保存</button>
      </div>`;
    openModal(html);
    $("#cs-save").addEventListener("click", () => {
      c.systemPrompt = $("#cs-sys").value.trim();
      persist(); renderFoot(); renderHeader();
      closeModalAll();
      toast("已保存");
    });
    $("#cs-export").addEventListener("click", () => exportConvMD(c));
    $("#cs-clear").addEventListener("click", async () => {
      const ok = await confirmDialog({ title: "清空对话", body: "清空本对话的全部消息（对比轮次），保留系统提示。", danger: true, okText: "清空" });
      if (!ok) return;
      clearConvMessages(c);
      closeModalAll();
    });
    $("#cs-del").addEventListener("click", async () => {
      closeModalAll();
      deleteConv(c);
    });
  }

  function exportConvMD(c) {
    let out = `# ${c.title || "新对话"}\n\n> 导出自 Aurora Chat · ${new Date().toLocaleString()}\n`;
    if (c.systemPrompt) out += `> 系统提示：${c.systemPrompt}\n`;
    out += "\n---\n\n";
    if (c.mode === "arena") {
      (c.arena?.rounds || []).forEach((r, i) => {
        out += `## 轮次 ${i + 1}\n\n**提问：** ${r.prompt}\n\n`;
        ["A", "B"].forEach((k) => {
          const s = r[k];
          out += `### ${k}（${s.model || "?"}）\n\n${s.error ? "（失败：" + s.error + "）" : s.content || "（空）"}\n\n`;
          if (r.vote) out += `> 本轮评价：${r.vote === "tie" ? "平手" : r.vote + " 更好"}\n\n`;
        });
        out += "---\n\n";
      });
    } else {
      c.messages.forEach((m) => {
        const who = m.role === "user" ? "🧑 用户" : `🤖 ${m.model || "AI"}`;
        out += `### ${who}\n\n${m.error ? "（失败：" + m.error + "）" : m.content}\n\n`;
      });
    }
    download(`${(c.title || "对话").replace(/[\\/:*?"<>|]/g, "_")}.md`, out, "text/markdown");
    toast("已导出 Markdown");
  }

  /* ================= 提示词库 ================= */

  function openTemplates() {
    const html = `
      <div class="modal-head"><h2>📚 提示词库</h2><button class="icon-btn" data-close>✕</button></div>
      <div class="modal-body">
        <div class="form-row"><input type="search" id="tpl-search" placeholder="搜索模板…"></div>
        <div class="tpl-grid" id="tpl-grid"></div>
        <div style="margin-top:14px;display:flex;gap:8px;justify-content:flex-end">
          <button class="btn" id="tpl-save-current">⭐ 把当前系统提示存为模板</button>
        </div>
      </div>`;
    openModal(html, { wide: true });

    const render = (q = "") => {
      const list = state.templates.filter(
        (t) => !q || (t.title + t.content).toLowerCase().includes(q.toLowerCase()));
      $("#tpl-grid").innerHTML = list.length
        ? list.map((t) => `
          <button class="tpl-card" data-tid="${t.id}">
            <div class="t-title">${esc(t.emoji || "⭐")} ${esc(t.title)}</div>
            <div class="t-body">${esc(t.content)}</div>
            ${t.builtin ? "" : `<span class="t-del" data-tdel="${t.id}" title="删除模板">✕</span>`}
          </button>`).join("")
        : '<p style="color:var(--faint);font-size:13px">没有匹配的模板</p>';

      $$("#tpl-grid .tpl-card").forEach((card) =>
        card.addEventListener("click", (e) => {
          if (e.target.closest("[data-tdel]")) return;
          const t = state.templates.find((x) => x.id === card.dataset.tid);
          if (t) applyTemplate(t);
        }));
      $$("#tpl-grid [data-tdel]").forEach((b) =>
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          state.templates = state.templates.filter((x) => x.id !== b.dataset.tdel);
          persist(); render($("#tpl-search").value);
          toast("模板已删除");
        }));
    };
    render();
    $("#tpl-search").addEventListener("input", (e) => render(e.target.value));
    $("#tpl-save-current").addEventListener("click", async () => {
      const c = curConv();
      if (!c || !c.systemPrompt) { toast("当前对话还没有系统提示", "err"); return; }
      const name = await promptDialog({ title: "保存为模板", label: "模板名称", value: "我的模板" });
      if (!name) return;
      state.templates.push({ id: uid(), emoji: "⭐", title: name, content: c.systemPrompt });
      persist(); render($("#tpl-search").value);
      toast("已保存到提示词库");
    });
  }

  function applyTemplate(t) {
    const c = ensureConv(curConv()?.mode || "single");
    c.systemPrompt = t.content;
    persist(); renderFoot();
    closeModalAll();
    toast(`已应用「${t.title}」到当前对话`);
  }

  /* ================= 演示模式 ================= */

  function startDemo() {
    let c = curConv();
    if (c && (c.messages.length || c.arena?.rounds.length)) c = newConv("single");
    c = ensureConv("single");
    c.providerId = AC.DEMO_PROVIDER_ID;
    c.model = "aurora-demo";
    renderHeader();
    sendSingle(c, "你好！演示一下你的能力吧");
  }

  /* ================= 事件绑定 ================= */

  function autoResize() {
    const ta = $("#input");
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 190) + "px";
  }

  function bindStaticEvents() {
    $("#btn-new").addEventListener("click", () => newConv("single"));
    $("#conv-list").addEventListener("click", (e) => {
      const itemEl = e.target.closest("[data-cid]");
      if (!itemEl) return;
      const c = state.conversations.find((x) => x.id === itemEl.dataset.cid);
      if (!c) return;
      const actBtn = e.target.closest("[data-cact]");
      if (actBtn) {
        actBtn.dataset.cact === "rename" ? renameConv(c) : deleteConv(c);
        return;
      }
      if (c.id !== currentId) openConv(c.id);
    });
    $("#search").addEventListener("input", (e) => { searchQ = e.target.value; renderConvList(); });
    $("#btn-templates").addEventListener("click", openTemplates);
    $("#btn-quick-templates").addEventListener("click", openTemplates);
    $("#btn-settings").addEventListener("click", () => openSettings("providers"));
    $("#btn-theme").addEventListener("click", () => {
      state.settings.theme = state.settings.theme === "dark" ? "light" : "dark";
      applyTheme(); persist();
    });
    $("#btn-conv-settings").addEventListener("click", openConvSettings);

    $("#btn-show-side").addEventListener("click", () => {
      $("#sidebar").classList.add("open");
      $("#side-mask").classList.add("show");
    });
    $("#btn-hide-side").addEventListener("click", () => {
      $("#sidebar").classList.add("collapsed");
    });
    $("#side-mask").addEventListener("click", closeSidebarIfMobile);

    $$("#mode-seg button").forEach((b) =>
      b.addEventListener("click", () => {
        const c = curConv();
        if (!c) { toast("先创建或选择一个对话", "err"); return; }
        if (c.mode === b.dataset.mode) return;
        c.mode = b.dataset.mode;
        persist(); renderHeader(); renderMessages(); renderConvList();
        toast(c.mode === "arena" ? "已切到对比模式：单聊与对比的内容互相独立" : "已切回单聊");
      }));

    $("#model-select").addEventListener("change", (e) => {
      const c = curConv(); if (!c) return;
      const v = e.target.value;
      if (v === "__custom__") {
        promptDialog({ title: "自定义模型", label: "模型名称（使用当前服务商）", value: c.model || "" }).then((m) => {
          if (m) c.model = m;
          persist(); renderHeader();
        });
        return;
      }
      const [pid, model] = v.split("::");
      c.providerId = pid; c.model = model;
      persist(); renderHeader(); renderConvList();
    });
    $("#model-select-b").addEventListener("change", (e) => {
      const c = curConv(); if (!c) return;
      if (!c.arena) c.arena = { providerIdB: defaultProvider().id, modelB: "", rounds: [] };
      const v = e.target.value;
      if (v === "__custom__") {
        promptDialog({ title: "自定义模型 B", label: "模型名称（使用当前服务商）", value: c.arena.modelB || "" }).then((m) => {
          if (m) c.arena.modelB = m;
          persist(); renderHeader();
        });
        return;
      }
      const [pid, model] = v.split("::");
      c.arena.providerIdB = pid; c.arena.modelB = model;
      persist(); renderHeader();
    });

    $("#btn-send").addEventListener("click", () => {
      const c = curConv();
      if (c && streaming.has(c.id)) { abortStream(c.id); return; }
      sendFromInput();
    });

    const input = $("#input");
    input.addEventListener("input", () => { autoResize(); updateSendBtn(); });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        sendFromInput();
      }
    });

    $("#sys-pill-edit").addEventListener("click", openConvSettings);
    $("#sys-pill-clear").addEventListener("click", () => {
      const c = curConv(); if (!c) return;
      c.systemPrompt = "";
      persist(); renderFoot();
      toast("已移除系统提示");
    });

    messagesEl().addEventListener("scroll", () => {
      const m = messagesEl();
      stickBottom = m.scrollHeight - m.scrollTop - m.clientHeight < 90;
      $("#btn-jump-bottom").classList.toggle("hidden", stickBottom);
    });
    $("#btn-jump-bottom").addEventListener("click", () => { stickBottom = true; scrollBottom(true); });

    $("#msg-col").addEventListener("click", async (e) => {
      const vote = e.target.closest("[data-vote]");
      if (vote) {
        const c = curConv(); if (!c?.arena) return;
        const rid = vote.closest("[data-rid]").dataset.rid;
        const r = c.arena.rounds.find((x) => x.id === rid);
        if (r) {
          r.vote = vote.dataset.vote === r.vote ? "" : vote.dataset.vote;
          persist(); renderMessages();
        }
        return;
      }
      const copyBtn = e.target.closest(".copy-code");
      if (copyBtn) {
        const code = copyBtn.closest(".code-block").querySelector("pre code");
        if (code && (await copyText(code.innerText))) {
          copyBtn.textContent = "已复制 ✓";
          setTimeout(() => (copyBtn.textContent = "复制"), 1200);
        }
        return;
      }
      const heroBtn = e.target.closest("[data-hero]");
      if (heroBtn) {
        heroBtn.dataset.hero === "demo" ? startDemo() : openSettings("providers");
        return;
      }
      const starter = e.target.closest("[data-starter]");
      if (starter) {
        $("#input").value = starter.dataset.starter;
        autoResize(); updateSendBtn();
        sendFromInput();
        return;
      }
      const act = e.target.closest("[data-act]");
      if (act) {
        msgAction(act.dataset.act, act.dataset.mid);
      }
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        const backdrops = $$("#modal-root .backdrop");
        if (backdrops.length) backdrops[backdrops.length - 1].remove();
      }
    });
  }

  /* ================= 启动 ================= */

  function init() {
    state = AC.store.loadAll();
    applyTheme();
    bindStaticEvents();
    const last = [...state.conversations].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
    if (last) openConv(last.id);
    else { renderConvList(); renderHeader(); renderMessages(); }
    autoResize();
  }

  init();
})();
