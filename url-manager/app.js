/**
 * 个人专属网址管理系统 - 核心交互逻辑
 * 原生 ES6+ 编写，高性能、零外部第三方库依赖
 */

(function () {
  'use strict';

  // 全局系统状态
  const state = {
    categories: [],
    items: [],
    activeCategoryId: 'all',
    searchKeyword: '',
    isOffline: false,
    theme: 'light'
  };

  // DOM 元素引用
  const el = {
    // 顶部与控制栏
    themeToggleBtn: document.getElementById('themeToggleBtn'),
    themeIcon: document.getElementById('themeIcon'),
    searchInput: document.getElementById('searchInput'),
    clearSearchBtn: document.getElementById('clearSearchBtn'),
    itemCountBadge: document.getElementById('itemCountBadge'),
    syncStatus: document.getElementById('syncStatus'),
    moreActionsBtn: document.getElementById('moreActionsBtn'),
    moreDropdown: document.getElementById('moreDropdown'),
    exportDataBtn: document.getElementById('exportDataBtn'),
    importFileInput: document.getElementById('importFileInput'),
    shutdownServiceBtn: document.getElementById('shutdownServiceBtn'),
    
    // 分类与卡片区域
    categoryTabs: document.getElementById('categoryTabs'),
    sitesGrid: document.getElementById('sitesGrid'),
    emptyState: document.getElementById('emptyState'),
    emptyAddBtn: document.getElementById('emptyAddBtn'),

    // 网址弹窗
    openAddModalBtn: document.getElementById('openAddModalBtn'),
    siteModal: document.getElementById('siteModal'),
    siteModalTitle: document.getElementById('siteModalTitle'),
    siteForm: document.getElementById('siteForm'),
    siteId: document.getElementById('siteId'),
    siteUrl: document.getElementById('siteUrl'),
    siteTitle: document.getElementById('siteTitle'),
    siteCategory: document.getElementById('siteCategory'),
    siteDesc: document.getElementById('siteDesc'),
    autoFetchTitleBtn: document.getElementById('autoFetchTitleBtn'),
    closeSiteModalBtn: document.getElementById('closeSiteModalBtn'),
    cancelSiteModalBtn: document.getElementById('cancelSiteModalBtn'),

    // 分类弹窗
    openCategoryModalBtn: document.getElementById('openCategoryModalBtn'),
    categoryModal: document.getElementById('categoryModal'),
    newCategoryIcon: document.getElementById('newCategoryIcon'),
    newCategoryName: document.getElementById('newCategoryName'),
    addCategoryBtn: document.getElementById('addCategoryBtn'),
    categoryList: document.getElementById('categoryList'),
    closeCategoryModalBtn: document.getElementById('closeCategoryModalBtn'),
    finishCategoryBtn: document.getElementById('finishCategoryBtn'),

    // 吐司通知
    toastContainer: document.getElementById('toastContainer')
  };

  // 渐变色彩库，供断网或无 favicon 时生成雅致首字母头像
  const GRADIENT_PALETTES = [
    'linear-gradient(135deg, #6366f1, #a855f7)',
    'linear-gradient(135deg, #3b82f6, #06b6d4)',
    'linear-gradient(135deg, #10b981, #059669)',
    'linear-gradient(135deg, #f59e0b, #d97706)',
    'linear-gradient(135deg, #ec4899, #f43f5e)',
    'linear-gradient(135deg, #8b5cf6, #ec4899)',
    'linear-gradient(135deg, #14b8a6, #3b82f6)',
    'linear-gradient(135deg, #f97316, #e11d48)'
  ];

  function getGradientByText(text) {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = text.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % GRADIENT_PALETTES.length;
    return GRADIENT_PALETTES[index];
  }

  // --------------------------------------------------------------------------
  // 初始化入口
  // --------------------------------------------------------------------------
  async function init() {
    initTheme();
    bindEvents();
    await loadData();
    renderAll();
  }

  // --------------------------------------------------------------------------
  // --------------------------------------------------------------------------
  // 主题管理 (明亮 / 暗黑模式)
  // --------------------------------------------------------------------------
  function initTheme() {
    const savedTheme = localStorage.getItem('dx_theme') || localStorage.getItem('url_manager_theme');
    if (savedTheme) {
      state.theme = savedTheme;
    } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      state.theme = 'dark';
    }
    applyTheme(state.theme);
  }

  function applyTheme(theme) {
    state.theme = theme;
    document.body.setAttribute('data-theme', theme);
    document.documentElement.setAttribute('data-theme', theme);
    if (el.themeIcon) el.themeIcon.textContent = theme === 'dark' ? '☀️' : '🌙';
    localStorage.setItem('dx_theme', theme);
    localStorage.setItem('url_manager_theme', theme);
  }

  function toggleTheme() {
    applyTheme(state.theme === 'dark' ? 'light' : 'dark');
  }

  // --------------------------------------------------------------------------
  // 数据读写与服务端同步
  // --------------------------------------------------------------------------
  async function loadData() {
    setSyncStatus('saving', '加载数据中...');
    let loadedFromServer = false;

    // 1. 如果在本地环境且有后台服务，优先尝试 /api/data (设置合理超时，避免在静态站点无响应时卡住)
    if (window.location.protocol === 'http:' && (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost')) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 1200);
        const response = await fetch('/api/data', { cache: 'no-store', signal: controller.signal });
        clearTimeout(timeoutId);
        if (response.ok) {
          const data = await response.json();
          state.categories = data.categories || [];
          state.items = data.items || [];
          state.isOffline = false;
          localStorage.setItem('url_manager_cache', JSON.stringify(data));
          setSyncStatus('synced', '已连接本地后台 urls.json');
          loadedFromServer = true;
        }
      } catch (err) {
        // 本地服务未运行，转入本地离线模式
      }
    }

    if (loadedFromServer) return;

    // 2. 离线/静态托管模式：优先读取浏览器本地已持久化的最新修改
    state.isOffline = true;
    const cached = localStorage.getItem('url_manager_cache');
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        state.categories = parsed.categories || [];
        state.items = parsed.items || [];
        setSyncStatus('offline', '浏览器本地持久化模式');
        return;
      } catch (e) {
        console.warn('缓存解析失败，尝试加载预设文件:', e);
      }
    }

    // 3. 首次访问未建立缓存时，加载预置的 urls.json 静态数据
    try {
      const staticRes = await fetch('./urls.json', { cache: 'no-store' });
      if (staticRes.ok) {
        const data = await staticRes.json();
        state.categories = data.categories || [];
        state.items = data.items || [];
        localStorage.setItem('url_manager_cache', JSON.stringify(data));
        setSyncStatus('offline', '预设数据已就绪 · 浏览器存储');
        return;
      }
    } catch (e) {
      console.warn('静态 urls.json 加载失败:', e);
    }

    // 4. 最终兜底数据
    fallbackDefaultData();
    setSyncStatus('offline', '离线存储模式');
  }

  function fallbackDefaultData() {
    state.categories = [
      { id: 'cat_daily', name: '常用推荐', icon: '⭐', order: 1 },
      { id: 'cat_tools', name: '实用工具', icon: '🛠️', order: 2 },
      { id: 'cat_dev', name: '编程开发', icon: '💻', order: 3 }
    ];
    state.items = [
      {
        id: 'item_001',
        categoryId: 'cat_daily',
        title: '戴璇的个人主页',
        url: 'https://daixuan.cloud',
        description: '算法、全栈开发与开源作品矩阵',
        icon: '',
        createdAt: new Date().toISOString()
      },
      {
        id: 'item_002',
        categoryId: 'cat_dev',
        title: 'GitHub',
        url: 'https://github.com',
        description: '全球开源代码托管与协作平台',
        icon: '',
        createdAt: new Date().toISOString()
      }
    ];
  }

  async function persistData() {
    const payload = {
      version: '1.0',
      lastUpdated: new Date().toISOString(),
      categories: state.categories,
      items: state.items
    };

    // 始终更新本地浏览器缓存
    localStorage.setItem('url_manager_cache', JSON.stringify(payload));

    if (state.isOffline) {
      setSyncStatus('offline', '已实时保存至浏览器存储');
      return;
    }

    setSyncStatus('saving', '正在保存至本地文件...');
    try {
      const res = await fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('保存失败');
      setSyncStatus('synced', '已自动保存至 urls.json');
    } catch (err) {
      console.error('保存失败:', err);
      state.isOffline = true;
      setSyncStatus('error', '保存失败，已暂存浏览器');
      showToast('同步到本地 urls.json 遇到问题，已暂存在浏览器中', 'error');
    }
  }

  function setSyncStatus(type, message) {
    const dot = el.syncStatus.querySelector('.sync-dot');
    const text = el.syncStatus.querySelector('.sync-text');
    dot.className = 'sync-dot';
    
    if (type === 'saving') {
      dot.classList.add('saving');
    } else if (type === 'error') {
      dot.classList.add('error');
    } else if (type === 'offline') {
      dot.style.backgroundColor = '#94a3b8';
      dot.style.boxShadow = 'none';
    } else {
      dot.style.backgroundColor = 'var(--success)';
      dot.style.boxShadow = '0 0 6px var(--success)';
    }
    
    text.textContent = message;
    el.syncStatus.title = message;
  }

  // --------------------------------------------------------------------------
  // 界面渲染逻辑
  // --------------------------------------------------------------------------
  function renderAll() {
    renderCategoryTabs();
    renderSites();
    updateBadge();
    populateCategorySelect();
  }

  function updateBadge() {
    const total = state.items.length;
    el.itemCountBadge.textContent = `已收录 ${total} 个站点`;
  }

  // 渲染分类胶囊标签
  function renderCategoryTabs() {
    el.categoryTabs.innerHTML = '';

    // "全部" 标签
    const allTab = document.createElement('div');
    allTab.className = `category-tab ${state.activeCategoryId === 'all' ? 'active' : ''}`;
    allTab.innerHTML = `<span>🌐</span><span>全部</span><span class="tab-count">${state.items.length}</span>`;
    allTab.addEventListener('click', () => {
      state.activeCategoryId = 'all';
      renderCategoryTabs();
      renderSites();
    });
    el.categoryTabs.appendChild(allTab);

    // 各独立分类
    state.categories.forEach(cat => {
      const count = state.items.filter(item => item.categoryId === cat.id).length;
      const tab = document.createElement('div');
      tab.className = `category-tab ${state.activeCategoryId === cat.id ? 'active' : ''}`;
      tab.innerHTML = `<span>${cat.icon || '📁'}</span><span>${escapeHtml(cat.name)}</span><span class="tab-count">${count}</span>`;
      tab.addEventListener('click', () => {
        state.activeCategoryId = cat.id;
        renderCategoryTabs();
        renderSites();
      });
      el.categoryTabs.appendChild(tab);
    });
  }

  // 渲染网址卡片网格
  function renderSites() {
    el.sitesGrid.innerHTML = '';

    // 过滤逻辑：分类过滤 + 搜索过滤
    const filtered = state.items.filter(item => {
      // 1. 分类匹配
      if (state.activeCategoryId !== 'all' && item.categoryId !== state.activeCategoryId) {
        return false;
      }
      // 2. 搜索关键词匹配 (匹配标题、URL、说明、分类名)
      if (state.searchKeyword) {
        const kw = state.searchKeyword.toLowerCase();
        const cat = state.categories.find(c => c.id === item.categoryId);
        const catName = cat ? cat.name.toLowerCase() : '';
        const matchTitle = (item.title || '').toLowerCase().includes(kw);
        const matchUrl = (item.url || '').toLowerCase().includes(kw);
        const matchDesc = (item.description || '').toLowerCase().includes(kw);
        const matchCat = catName.includes(kw);
        return matchTitle || matchUrl || matchDesc || matchCat;
      }
      return true;
    });

    if (filtered.length === 0) {
      el.emptyState.style.display = 'block';
      el.sitesGrid.style.display = 'none';
      return;
    }

    el.emptyState.style.display = 'none';
    el.sitesGrid.style.display = 'grid';

    // 排序：优先按创建时间倒序
    filtered.forEach(item => {
      const card = createSiteCard(item);
      el.sitesGrid.appendChild(card);
    });
  }

  // 创建单张网址卡片
  function createSiteCard(item) {
    const card = document.createElement('div');
    card.className = 'site-card';

    const category = state.categories.find(c => c.id === item.categoryId);
    const categoryName = category ? `${category.icon || ''} ${category.name}` : '未分类';
    const domain = extractDomain(item.url);

    // 卡片内容
    card.innerHTML = `
      <div class="site-card-header">
        <div class="site-icon-wrapper" id="iconWrap_${item.id}">
          <!-- 图标渲染占位 -->
        </div>
        <div class="site-title-wrap">
          <div class="site-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</div>
          <div class="site-domain" title="${escapeHtml(item.url)}">${escapeHtml(domain || item.url)}</div>
        </div>
      </div>
      <div class="site-desc" title="${escapeHtml(item.description || '暂无描述')}">
        ${item.description ? escapeHtml(item.description) : '<span style="color:var(--text-muted);font-style:italic;">暂无备忘描述</span>'}
      </div>
      <div class="site-card-footer">
        <span class="site-category-badge">${escapeHtml(categoryName)}</span>
        <div class="site-card-actions">
          <button class="site-action-btn copy-btn" title="复制网址链接" data-id="${item.id}">🔗</button>
          <button class="site-action-btn edit-btn" title="编辑网址" data-id="${item.id}">✏️</button>
          <button class="site-action-btn delete-btn" title="删除网址" data-id="${item.id}">🗑️</button>
        </div>
      </div>
    `;

    // 填充图标
    const iconWrapper = card.querySelector(`#iconWrap_${item.id}`);
    renderSiteIcon(iconWrapper, item);

    // 卡片整体点击在新标签页打开网址 (需避开按钮点击)
    card.addEventListener('click', (e) => {
      if (e.target.closest('.site-card-actions')) return;
      openUrl(item.url);
    });

    // 按钮事件绑定
    card.querySelector('.copy-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      copyToClipboard(item.url);
    });

    card.querySelector('.edit-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      openEditSiteModal(item);
    });

    card.querySelector('.delete-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      confirmDeleteSite(item);
    });

    return card;
  }

  // 图标渲染：支持 Favicon 在线抓取与断网首字母彩色头像优雅降级
  function renderSiteIcon(wrapper, item) {
    const domain = extractDomain(item.url);
    const firstLetter = (item.title || domain || '网').trim().charAt(0);

    const img = document.createElement('img');
    img.alt = item.title;
    img.loading = 'lazy';
    
    // 构造 Favicon 源 (使用可靠公开服务与本地回退)
    if (domain) {
      img.src = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
    }

    img.onload = () => {
      wrapper.innerHTML = '';
      wrapper.appendChild(img);
    };

    img.onerror = () => {
      // 加载失败时渲染艺术渐变首字母徽章
      wrapper.innerHTML = '';
      const fallbackBadge = document.createElement('div');
      fallbackBadge.className = 'site-icon-placeholder';
      fallbackBadge.style.background = getGradientByText(item.title || domain || '网');
      fallbackBadge.textContent = firstLetter;
      wrapper.appendChild(fallbackBadge);
    };

    // 先置入首字母占位，待图片加载成功平滑替换
    const initBadge = document.createElement('div');
    initBadge.className = 'site-icon-placeholder';
    initBadge.style.background = getGradientByText(item.title || domain || '网');
    initBadge.textContent = firstLetter;
    wrapper.appendChild(initBadge);
  }

  function extractDomain(url) {
    try {
      if (!/^https?:\/\//i.test(url)) {
        url = 'https://' + url;
      }
      const parsed = new URL(url);
      return parsed.hostname.replace(/^www\./i, '');
    } catch {
      return '';
    }
  }

  function openUrl(url) {
    if (!url) return;
    let targetUrl = url.trim();
    if (!/^https?:\/\//i.test(targetUrl)) {
      targetUrl = 'https://' + targetUrl;
    }
    window.open(targetUrl, '_blank', 'noopener,noreferrer');
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(() => {
        showToast('已复制网址到剪贴板！', 'success');
      }).catch(() => fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    const input = document.createElement('textarea');
    input.value = text;
    document.body.appendChild(input);
    input.select();
    try {
      document.execCommand('copy');
      showToast('已复制网址到剪贴板！', 'success');
    } catch (err) {
      showToast('复制失败，请手动长按复制', 'error');
    }
    document.body.removeChild(input);
  }

  // --------------------------------------------------------------------------
  // 弹窗与交互逻辑 (网址新增/编辑、分类管理)
  // --------------------------------------------------------------------------
  function populateCategorySelect() {
    el.siteCategory.innerHTML = '';
    state.categories.forEach(cat => {
      const opt = document.createElement('option');
      opt.value = cat.id;
      opt.textContent = `${cat.icon || '📁'} ${cat.name}`;
      el.siteCategory.appendChild(opt);
    });
  }

  function openAddSiteModal() {
    el.siteModalTitle.textContent = '添加新网址';
    el.siteForm.reset();
    el.siteId.value = '';
    
    // 如果当前选了具体分类，则默认选中该分类
    if (state.activeCategoryId !== 'all') {
      el.siteCategory.value = state.activeCategoryId;
    }
    
    el.siteModal.classList.add('active');
    setTimeout(() => el.siteUrl.focus(), 150);
  }

  function openEditSiteModal(item) {
    el.siteModalTitle.textContent = '编辑网址信息';
    el.siteId.value = item.id;
    el.siteUrl.value = item.url;
    el.siteTitle.value = item.title;
    el.siteCategory.value = item.categoryId;
    el.siteDesc.value = item.description || '';
    
    el.siteModal.classList.add('active');
    setTimeout(() => el.siteTitle.focus(), 150);
  }

  function closeSiteModal() {
    el.siteModal.classList.remove('active');
  }

  function handleSiteFormSubmit(e) {
    e.preventDefault();
    let url = el.siteUrl.value.trim();
    const title = el.siteTitle.value.trim();
    const categoryId = el.siteCategory.value;
    const desc = el.siteDesc.value.trim();
    const editId = el.siteId.value;

    if (!url || !title) {
      showToast('请完整填写网址和名称', 'error');
      return;
    }

    if (!/^https?:\/\//i.test(url)) {
      url = 'https://' + url;
    }

    if (editId) {
      // 编辑更新
      const index = state.items.findIndex(it => it.id === editId);
      if (index !== -1) {
        state.items[index] = {
          ...state.items[index],
          url,
          title,
          categoryId,
          description: desc,
          updatedAt: new Date().toISOString()
        };
        showToast('网址已成功更新！', 'success');
      }
    } else {
      // 新增收录
      const newItem = {
        id: 'item_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
        categoryId,
        title,
        url,
        description: desc,
        icon: '',
        visitCount: 0,
        createdAt: new Date().toISOString()
      };
      state.items.unshift(newItem);
      showToast('新网址收录成功！', 'success');
    }

    closeSiteModal();
    renderAll();
    persistData();
  }

  function confirmDeleteSite(item) {
    if (confirm(`确定要删除“${item.title}”吗？此操作无法撤销。`)) {
      state.items = state.items.filter(it => it.id !== item.id);
      renderAll();
      persistData();
      showToast(`已删除“${item.title}”`, 'info');
    }
  }

  // 自动提取域名填入标题建议
  function autoSuggestTitle() {
    const url = el.siteUrl.value.trim();
    if (!url) {
      showToast('请先输入网址', 'info');
      return;
    }
    const domain = extractDomain(url);
    if (domain) {
      const parts = domain.split('.');
      const mainName = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
      const capitalized = mainName.charAt(0).toUpperCase() + mainName.slice(1);
      if (!el.siteTitle.value) {
        el.siteTitle.value = capitalized;
        showToast(`已提取建议名称: ${capitalized}`, 'success');
      }
    }
  }

  // --------------------------------------------------------------------------
  // 分类管理模块
  // --------------------------------------------------------------------------
  function openCategoryModal() {
    renderCategoryList();
    el.categoryModal.classList.add('active');
  }

  function closeCategoryModal() {
    el.categoryModal.classList.remove('active');
  }

  function renderCategoryList() {
    el.categoryList.innerHTML = '';
    state.categories.forEach((cat, index) => {
      const count = state.items.filter(it => it.categoryId === cat.id).length;
      const row = document.createElement('div');
      row.className = 'category-item-row';
      row.innerHTML = `
        <div class="category-item-info">
          <span>${cat.icon || '📁'}</span>
          <span>${escapeHtml(cat.name)}</span>
          <span style="font-size:12px;color:var(--text-muted);">(${count} 个网址)</span>
        </div>
        <div class="category-item-actions">
          <button class="site-action-btn edit-cat-btn" data-id="${cat.id}">✏️ 重命名</button>
          <button class="site-action-btn delete-btn delete-cat-btn" data-id="${cat.id}">🗑️ 删除</button>
        </div>
      `;

      row.querySelector('.edit-cat-btn').addEventListener('click', () => {
        const newName = prompt('请输入新的分类名称：', cat.name);
        if (newName && newName.trim() && newName.trim() !== cat.name) {
          cat.name = newName.trim();
          renderCategoryList();
          renderAll();
          persistData();
          showToast('分类名称已修改', 'success');
        }
      });

      row.querySelector('.delete-cat-btn').addEventListener('click', () => {
        if (state.categories.length <= 1) {
          alert('至少需要保留一个分类！');
          return;
        }
        if (confirm(`确定要删除分类“${cat.name}”吗？\n删除后该分类下的网址将自动合并至其它分类。`)) {
          state.categories = state.categories.filter(c => c.id !== cat.id);
          const fallbackCatId = state.categories[0].id;
          state.items.forEach(it => {
            if (it.categoryId === cat.id) {
              it.categoryId = fallbackCatId;
            }
          });
          if (state.activeCategoryId === cat.id) {
            state.activeCategoryId = 'all';
          }
          renderCategoryList();
          renderAll();
          persistData();
          showToast('分类已删除，网址已安全转移', 'info');
        }
      });

      el.categoryList.appendChild(row);
    });
  }

  function handleAddCategory() {
    const name = el.newCategoryName.value.trim();
    const icon = el.newCategoryIcon.value.trim() || '📁';
    if (!name) {
      showToast('请输入分类名称', 'error');
      return;
    }
    const newCat = {
      id: 'cat_' + Date.now().toString(36),
      name,
      icon,
      order: state.categories.length + 1
    };
    state.categories.push(newCat);
    el.newCategoryName.value = '';
    renderCategoryList();
    renderAll();
    persistData();
    showToast(`分类“${name}”创建成功！`, 'success');
  }

  // --------------------------------------------------------------------------
  // 数据导入与导出
  // --------------------------------------------------------------------------
  function exportData() {
    const data = {
      version: '1.0',
      exportAt: new Date().toISOString(),
      categories: state.categories,
      items: state.items
    };
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const a = document.createElement('a');
    a.href = url;
    a.download = `网址管理系统_备份_${dateStr}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('备份文件已成功导出！', 'success');
    closeDropdown();
  }

  function handleImportFile(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const imported = JSON.parse(event.target.result);
        if (!imported.categories || !imported.items) {
          throw new Error('格式不符合规范');
        }
        if (confirm(`检测到 ${imported.categories.length} 个分类，${imported.items.length} 个网址，确认导入并覆盖现有数据吗？`)) {
          state.categories = imported.categories;
          state.items = imported.items;
          state.activeCategoryId = 'all';
          renderAll();
          persistData();
          showToast('数据导入成功！', 'success');
        }
      } catch (err) {
        alert('导入失败：文件不是合法的网址管理系统 JSON 格式。');
      }
      e.target.value = '';
    };
    reader.readAsText(file, 'utf-8');
    closeDropdown();
  }

  function closeDropdown() {
    el.moreDropdown.classList.remove('show');
  }

  // --------------------------------------------------------------------------
  // 消息提示 (Toast)
  // --------------------------------------------------------------------------
  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    const iconMap = { success: '✅', error: '⚠️', info: 'ℹ️' };
    toast.innerHTML = `<span>${iconMap[type] || 'ℹ️'}</span><span>${escapeHtml(message)}</span>`;
    el.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 2800);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // --------------------------------------------------------------------------
  // 事件绑定与快捷键
  // --------------------------------------------------------------------------
  function bindEvents() {
    // 主题切换
    el.themeToggleBtn.addEventListener('click', toggleTheme);

    // 搜索输入
    el.searchInput.addEventListener('input', (e) => {
      state.searchKeyword = e.target.value.trim();
      el.clearSearchBtn.style.display = state.searchKeyword ? 'block' : 'none';
      renderSites();
    });

    el.clearSearchBtn.addEventListener('click', () => {
      el.searchInput.value = '';
      state.searchKeyword = '';
      el.clearSearchBtn.style.display = 'none';
      renderSites();
      el.searchInput.focus();
    });

    // 快捷键支持：按 '/' 聚焦搜索框，按 'Esc' 退出搜索或关闭弹窗
    window.addEventListener('keydown', (e) => {
      if (e.key === '/' && document.activeElement !== el.searchInput && !document.querySelector('.modal-overlay.active')) {
        e.preventDefault();
        el.searchInput.focus();
        el.searchInput.select();
      } else if (e.key === 'Escape') {
        if (document.querySelector('.modal-overlay.active')) {
          closeSiteModal();
          closeCategoryModal();
        } else if (el.searchInput.value) {
          el.searchInput.value = '';
          state.searchKeyword = '';
          el.clearSearchBtn.style.display = 'none';
          renderSites();
        }
      } else if (e.altKey && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault();
        openAddSiteModal();
      }
    });

    // 弹窗相关
    el.openAddModalBtn.addEventListener('click', openAddSiteModal);
    el.emptyAddBtn.addEventListener('click', openAddSiteModal);
    el.closeSiteModalBtn.addEventListener('click', closeSiteModal);
    el.cancelSiteModalBtn.addEventListener('click', closeSiteModal);
    el.siteForm.addEventListener('submit', handleSiteFormSubmit);
    el.autoFetchTitleBtn.addEventListener('click', autoSuggestTitle);

    el.openCategoryModalBtn.addEventListener('click', openCategoryModal);
    el.closeCategoryModalBtn.addEventListener('click', closeCategoryModal);
    el.finishCategoryBtn.addEventListener('click', closeCategoryModal);
    el.addCategoryBtn.addEventListener('click', handleAddCategory);

    // 点击弹窗背景遮罩关闭
    [el.siteModal, el.categoryModal].forEach(modal => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.remove('active');
      });
    });

    // 更多下拉菜单
    el.moreActionsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      el.moreDropdown.classList.toggle('show');
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.action-dropdown-wrapper')) {
        closeDropdown();
      }
    });

    el.exportDataBtn.addEventListener('click', exportData);
    el.importFileInput.addEventListener('change', handleImportFile);

    if (el.shutdownServiceBtn) {
      el.shutdownServiceBtn.addEventListener('click', () => {
        closeDropdown();
        if (state.isOffline) {
          showToast('当前处于网页静态/浏览器存储模式，无需停止后台服务', 'info');
          return;
        }
        if (confirm('确定要停止网址管理系统后台服务吗？\n停止后网页不会再自动同步本地文件，您可以随后关闭本标签页。')) {
          fetch('/api/shutdown', { method: 'POST' }).then(() => {
            state.isOffline = true;
            setSyncStatus('offline', '服务已停止');
            showToast('后台服务已安全停止，您可以关闭此网页了！', 'info');
          }).catch(() => {
            state.isOffline = true;
            setSyncStatus('offline', '服务已停止');
            showToast('后台服务已停止', 'info');
          });
        }
      });
    }
  }

  // 启动应用
  document.addEventListener('DOMContentLoaded', init);
})();
