/* Aurora Chat · Markdown 渲染：marked 解析 + DOMPurify 消毒 + 代码块增强 */
window.AC = window.AC || {};

AC.md = (() => {
  marked.setOptions({ gfm: true, breaks: true });

  // 拦截外链：新窗口打开且不泄露 referrer
  const PURIFY_CFG = {
    ADD_ATTR: ["target", "rel"],
    FORBID_TAGS: ["style"],
  };

  function render(text) {
    if (!text) return "";
    const raw = marked.parse(String(text));
    return DOMPurify.sanitize(raw, PURIFY_CFG);
  }

  /* highlight.js 约 120 KB（gzip 41 KB），而首屏并不一定有代码块 ——
     改为首次真正出现代码块时按需拉取，拉完后再补上高亮。
     没有它代码块依然可读、可复制，所以加载失败也不影响正文。 */
  const HLJS_SRC = "vendor/highlight.min.js";
  /* 配色也由这个主题文件提供（站点自己的 style.css 里没有任何 .hljs 规则），
     所以它与脚本一起按需拉取，不再占首屏的渲染阻塞资源。 */
  const HLJS_THEME = "vendor/hljs-github-dark.min.css";
  let hljsPromise = null;

  function loadCss(href) {
    return new Promise((resolve) => {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      link.onload = resolve;
      link.onerror = resolve; /* 主题缺失只影响配色，不该阻断高亮 */
      document.head.appendChild(link);
    });
  }

  function loadJs(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = () => (window.hljs ? resolve(window.hljs) : reject(new Error("highlight.js 未挂载")));
      s.onerror = () => reject(new Error("highlight.js 加载失败"));
      document.head.appendChild(s);
    });
  }

  function ensureHljs() {
    if (window.hljs) return Promise.resolve(window.hljs);
    if (!hljsPromise) {
      /* 两者并行拉取，但等主题到位后才高亮，避免无配色的一闪 */
      hljsPromise = Promise.all([loadCss(HLJS_THEME), loadJs(HLJS_SRC)]).then((r) => r[1]);
    }
    return hljsPromise;
  }

  /* hljs.highlightElement 会给元素加上 .hljs，用它去重，避免重复高亮告警 */
  function highlightIn(container) {
    if (!window.hljs) return;
    container.querySelectorAll("pre > code:not(.hljs)").forEach((code) => {
      try { hljs.highlightElement(code); } catch (e) { /* 高亮失败不影响正文 */ }
    });
  }

  /* 将渲染结果挂到容器后调用：给代码块加语言标签与复制按钮、跑高亮 */
  function enhance(container) {
    let hasCode = false;
    container.querySelectorAll("pre > code").forEach((code) => {
      if (code.closest(".code-block")) return;
      hasCode = true;
      const lang = (code.className.match(/language-([\w+#-]+)/) || [])[1] || "";
      let html = "";

      const pre = code.parentElement;
      const wrap = document.createElement("div");
      wrap.className = "code-block";
      const head = document.createElement("div");
      head.className = "code-head";
      const langEl = document.createElement("span");
      langEl.textContent = lang || "text";
      const btn = document.createElement("button");
      btn.className = "copy-code";
      btn.type = "button";
      btn.textContent = "复制";
      head.append(langEl, btn);
      pre.replaceWith(wrap);
      wrap.append(head, pre);
      html = wrap;
    });

    /* 只有真的有代码块时才拉 highlight.js */
    if (hasCode) {
      if (window.hljs) highlightIn(container);
      else ensureHljs().then(() => highlightIn(container)).catch(() => { /* 无高亮也照常可读、可复制 */ });
    }

    container.querySelectorAll("a[href]").forEach((a) => {
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    });
  }

  return { render, enhance };
})();
