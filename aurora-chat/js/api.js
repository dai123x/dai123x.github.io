/* Aurora Chat · API 层：OpenAI 兼容协议（流式 SSE / 非流式）+ 演示模式 */
window.AC = window.AC || {};

AC.api = (() => {
  class APIError extends Error {
    constructor(message, status) {
      super(message);
      this.status = status;
    }
  }

  function endpoint(provider, path) {
    return provider.baseURL.replace(/\/+$/, "") + path;
  }

  function headers(provider) {
    const h = { "Content-Type": "application/json" };
    if (provider.apiKey) h["Authorization"] = "Bearer " + provider.apiKey;
    return h;
  }

  async function readError(res) {
    let detail = "";
    try {
      const j = await res.json();
      detail = j.error?.message || j.error?.code || j.message || j.msg || "";
      if (Array.isArray(detail)) detail = detail.map((d) => d.msg || d).join("; ");
    } catch (e) { /* 忽略非 JSON 错误体 */ }
    const status = res.status;
    const statusHint =
      status === 401 || status === 403
        ? "API Key 无效或没有该模型权限"
        : status === 404
          ? "接口路径或模型名不存在（检查 Base URL 是否少了 /v1）"
          : status === 429
            ? "请求过于频繁或额度不足"
            : status >= 500
              ? "服务商服务端错误，稍后重试"
              : "";
    return new APIError(`HTTP ${status}${detail ? "：" + detail : ""}${statusHint ? "（" + statusHint + "）" : ""}`, status);
  }

  /* 把浏览器抛出的裸错误翻译成用户能照着做的诊断 */
  function networkError(err) {
    const raw = err.message || "无法连接";
    const looksCors = /failed to fetch|load failed|networkerror|network request failed/i.test(raw);
    const msg =
      "网络请求失败（" + raw + "）。" +
      (looksCors
        ? "这几乎总是「服务商不允许浏览器直连」或「网络/代理不通」——不是 Key 的问题。" +
          "请先在服务商编辑框里点「测试连接」确认；若确实被跨域拦截，" +
          "部署仓库 examples/cors-proxy-worker.js 后把 Base URL 改成你的 Worker 地址即可。"
        : "请检查 Base URL、网络与代理后重试。");
    return new APIError(msg, 0);
  }

  /**
   * 流式对话。
   * opts: { provider, model, messages, temperature, maxTokens, signal,
   *         onDelta(text), onReasoning(text), onUsage(usage) }
   * 返回 { usage }；中止时抛出 AbortError。
   */
  async function streamChat(opts) {
    const { provider, model, messages, temperature, maxTokens, signal } = opts;
    const body = {
      model,
      messages,
      stream: true,
      temperature,
    };
    if (maxTokens) body.max_tokens = maxTokens;

    let res;
    try {
      res = await fetch(endpoint(provider, "/chat/completions"), {
        method: "POST",
        headers: headers(provider),
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if (err.name === "AbortError") throw err;
      throw networkError(err);
    }
    if (!res.ok) throw await readError(res);
    if (!res.body) throw new APIError("当前环境不支持流式读取，请在设置中改用非流式输出", 0);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let usage = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") {
          try { await reader.cancel(); } catch (e) { /* 已结束 */ }
          return { usage };
        }
        let j;
        try { j = JSON.parse(data); } catch (e) { continue; }
        const delta = j.choices?.[0]?.delta || {};
        const reasoning = delta.reasoning_content ?? delta.reasoning;
        if (reasoning) opts.onReasoning?.(reasoning);
        if (delta.content) opts.onDelta?.(delta.content);
        if (j.usage) usage = j.usage;
      }
    }
    return { usage };
  }

  /** 非流式对话，参数同上（onDelta 仍会以整段回调一次） */
  async function chatOnce(opts) {
    const { provider, model, messages, temperature, maxTokens, signal } = opts;
    const body = { model, messages, stream: false, temperature };
    if (maxTokens) body.max_tokens = maxTokens;

    let res;
    try {
      res = await fetch(endpoint(provider, "/chat/completions"), {
        method: "POST",
        headers: headers(provider),
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if (err.name === "AbortError") throw err;
      throw networkError(err);
    }
    if (!res.ok) throw await readError(res);
    const j = await res.json();
    const msg = j.choices?.[0]?.message || {};
    if (msg.reasoning_content || msg.reasoning) opts.onReasoning?.(msg.reasoning_content ?? msg.reasoning);
    if (msg.content) opts.onDelta?.(msg.content);
    return { usage: j.usage || null };
  }

  /** 拉取服务商的模型列表（GET /models） */
  async function listModels(provider) {
    let res;
    try {
      res = await fetch(endpoint(provider, "/models"), { headers: headers(provider) });
    } catch (err) {
      if (err.name === "AbortError") throw err;
      throw networkError(err);
    }
    if (!res.ok) throw await readError(res);
    const j = await res.json();
    const ids = (j.data || j.models || [])
      .map((m) => m.id || m.name || m)
      .filter((x) => typeof x === "string");
    return [...new Set(ids)].sort();
  }

  /**
   * 轻量连通性测试：先试 GET /models，不行就发一条 1 token 的对话。
   * 用于在保存配置前就告诉用户"能不能用"。
   */
  async function testConnection(provider, model) {
    const t0 = Date.now();
    let modelsErr = null;
    try {
      const ids = await listModels(provider);
      if (ids.length) return { via: "models", count: ids.length, ms: Date.now() - t0 };
    } catch (err) {
      // 网络类错误直接抛出；接口不存在则退化为对话测试
      if (!err.status) throw err;
      modelsErr = err;
    }
    if (!model) {
      throw modelsErr ||
        new APIError("该服务商未返回模型列表，请先手动填一个模型名再测试", 0);
    }
    await chatOnce({
      provider, model,
      messages: [{ role: "user", content: "ping" }],
      temperature: 0, maxTokens: 1,
    });
    return { via: "chat", ms: Date.now() - t0 };
  }

  /* ---------- 演示模式：本地逐字输出，零配置可体验 ---------- */

  const sleep = (ms, signal) =>
    new Promise((resolve, reject) => {
      const t = setTimeout(resolve, ms);
      if (signal) {
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(t);
            const e = new Error("aborted");
            e.name = "AbortError";
            reject(e);
          },
          { once: true }
        );
      }
    });

  /**
   * 演示流。variant 指定第几段预置文案（自动循环）。
   * 文案原文放在 index.html 的 <script type="text/template"> 里。
   * 输出节奏按墙钟时间追赶：即使标签页被后台节流，总时长也保持稳定。
   */
  async function demoStream({ onDelta, onReasoning, signal, variant }) {
    const el = document.getElementById("demo-" + (variant % 3));
    const text = el ? el.textContent.trim() : "（演示文案缺失）";

    const think =
      "用户在体验演示模式。我需要输出一段带有标题、表格、代码块与引用的回复，" +
      "把流式输出和 Markdown 渲染的能力都展示出来，最后引导用户去配置真实模型。";
    const THINK_MS = 900, TEXT_MS = 6500;

    const streamBy = (full, durationMs, emit) => async () => {
      const start = Date.now();
      let shown = 0;
      while (shown < full.length) {
        await sleep(30, signal);
        const should = Math.min(full.length, Math.floor(((Date.now() - start) / durationMs) * full.length));
        if (should > shown) { emit(full.slice(shown, should)); shown = should; }
      }
    };

    await streamBy(think, THINK_MS, onReasoning)();   // 思考过程先出，营造推理模型的感觉
    await streamBy(text, TEXT_MS, onDelta)();
    return { usage: null };
  }

  return { streamChat, chatOnce, listModels, testConnection, demoStream, APIError };
})();
