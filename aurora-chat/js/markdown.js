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

  /* 将渲染结果挂到容器后调用：给代码块加语言标签与复制按钮、跑高亮 */
  function enhance(container) {
    container.querySelectorAll("pre > code").forEach((code) => {
      if (code.closest(".code-block")) return;
      const lang = (code.className.match(/language-([\w+#-]+)/) || [])[1] || "";
      let html = "";
      try {
        if (window.hljs) hljs.highlightElement(code);
      } catch (e) { /* 高亮失败不影响正文 */ }

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

    container.querySelectorAll("a[href]").forEach((a) => {
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    });
  }

  return { render, enhance };
})();
