/**
 * Cloudflare Worker 反向代理示例 —— 给"不允许浏览器直连"的服务商用
 *
 * 部署（免费）：
 *   1. 打开 https://dash.cloudflare.com → Workers & Pages → Create Worker
 *   2. 把本文件全部粘贴进去，Deploy，得到形如 https://aurora-proxy.<你的子域>.workers.dev 的地址
 *   3. 在 Aurora Chat 的服务商设置里，把 Base URL 改为：
 *        https://aurora-proxy.<你的子域>.workers.dev/glm        （对应下方 ROUTES 里的 key）
 *      例如 GLM：https://aurora-proxy.xxx.workers.dev/glm/chat/completions
 *
 * 注意：公开部署的代理任何人都能用，建议在 Cloudflare 后台给 Worker 加一层
 * Access 限制，或把 ALLOW_TOKEN 设为一个随机字符串、并在 Aurora Chat 的
 * API Key 一栏填写 "<真实Key> <ALLOW_TOKEN>" 的写法自行改造。
 */

const ROUTES = {
  glm: "https://open.bigmodel.cn/api/paas/v4",
  deepseek: "https://api.deepseek.com",
  openai: "https://api.openai.com/v1",
  kimi: "https://api.moonshot.cn/v1",
  siliconflow: "https://api.siliconflow.cn/v1",
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Max-Age": "86400",
};

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const key = url.pathname.split("/")[1]; // /glm/... → glm
    const upstream = ROUTES[key];
    if (!upstream) {
      return new Response("未知路由，可用：" + Object.keys(ROUTES).join(", "), {
        status: 404,
        headers: CORS_HEADERS,
      });
    }

    const path = url.pathname.slice(key.length + 1); // 去掉 /glm
    const target = upstream.replace(/\/$/, "") + path + url.search;

    const resp = await fetch(target, {
      method: request.method,
      headers: request.headers,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
    });

    const headers = new Headers(resp.headers);
    Object.entries(CORS_HEADERS).forEach(([k, v]) => headers.set(k, v));
    return new Response(resp.body, { status: resp.status, headers });
  },
};
