/* Aurora Chat · 本地存储：所有数据只写 localStorage，不出本机 */
window.AC = window.AC || {};

AC.store = (() => {
  const PREFIX = "aurora.";
  const KEYS = { settings: "settings", providers: "providers", conversations: "conversations", templates: "templates" };

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function load(key, fallback) {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (e) {
      console.warn("[aurora] 读取存储失败:", key, e);
      return fallback;
    }
  }

  function save(key, val) {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(val));
      return true;
    } catch (e) {
      console.error("[aurora] 写入存储失败（可能是空间已满）:", e);
      return false;
    }
  }

  const DEFAULT_SETTINGS = {
    theme: "dark",
    defaultProviderId: "preset-glm",
    temperature: 0.7,
    maxTokens: null,
    stream: true,
    contextLimit: 0, // 0 = 发送全部历史
  };

  function seedProviders() {
    const now = Date.now();
    const demo = {
      id: AC.DEMO_PROVIDER_ID, name: "演示模式（本地）", baseURL: "demo", apiKey: "",
      models: ["aurora-demo"], builtin: true, demo: true,
    };
    const presets = AC.PROVIDER_PRESETS.map((p) => ({
      id: p.id, name: p.name, baseURL: p.baseURL, apiKey: "",
      models: [...p.models], builtin: true, preset: true,
    }));
    return { list: [demo, ...presets], demoSaved: true };
  }

  function loadAll() {
    let prov = load(KEYS.providers, null);
    if (!prov || !Array.isArray(prov.list)) prov = seedProviders();
    // 保证演示模式始终存在
    if (!prov.list.some((p) => p.id === AC.DEMO_PROVIDER_ID)) {
      prov.list.unshift({
        id: AC.DEMO_PROVIDER_ID, name: "演示模式（本地）", baseURL: "demo", apiKey: "",
        models: ["aurora-demo"], builtin: true, demo: true,
      });
      prov.demoSaved = true;
    }

    const settings = Object.assign({}, DEFAULT_SETTINGS, load(KEYS.settings, {}));

    const templates = load(KEYS.templates, null);
    const tplList = Array.isArray(templates)
      ? templates
      : AC.BUILTIN_TEMPLATES.map((t) => ({ ...t, builtin: true }));

    return {
      settings,
      providers: prov,
      conversations: load(KEYS.conversations, []),
      templates: tplList,
    };
  }

  function exportAll(state) {
    return {
      app: "aurora-chat",
      version: AC.VERSION,
      exportedAt: new Date().toISOString(),
      settings: state.settings,
      providers: state.providers,
      conversations: state.conversations,
      templates: state.templates,
    };
  }

  function importAll(json) {
    if (!json || json.app !== "aurora-chat" || !Array.isArray(json.conversations)) {
      throw new Error("不是有效的 Aurora Chat 备份文件");
    }
    if (json.settings) save(KEYS.settings, json.settings);
    if (json.providers && Array.isArray(json.providers.list)) save(KEYS.providers, json.providers);
    save(KEYS.conversations, json.conversations);
    if (Array.isArray(json.templates)) save(KEYS.templates, json.templates);
    return loadAll();
  }

  function clearAll() {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(PREFIX))
      .forEach((k) => localStorage.removeItem(k));
  }

  return { uid, load, save, loadAll, exportAll, importAll, clearAll, KEYS };
})();
