/**
 * DAIXUAN.CLOUD · 戴璇 个人主页交互脚本
 * 主题切换 · 移动端菜单 · 项目筛选 · 剪贴板 · 模态弹窗 · 滚动联动 · 入场动画
 *
 * 设计规范：
 * - 主题在 <head> 内联脚本中同步应用，此处只负责交互与图标，避免闪屏
 * - 所有滚动监听统一走 requestAnimationFrame 节流，避免布局抖动
 * - 尊重 prefers-reduced-motion，减弱动效偏好下关闭装饰性动画
 */

(function () {
  'use strict';

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** rAF 节流：同一帧内多次触发只执行一次 */
  function rafThrottle(fn) {
    let ticking = false;
    return function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        fn();
        ticking = false;
      });
    };
  }

  document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initMobileMenu();
    initProjectFilter();
    initMailbox();
    initClipboardToast();
    initWechatModal();
    initScrollEffects();
    initScrollSpy();
    initReveal();
    initTypewriter();
    initCountUp();
    initCardPointerGlow();
    initFooterYear();
    initLastMod();
    initCommandPalette();
  });

  /* --------------------------------------------------------------------------
     1. 主题切换 (Dark / Light)
     -------------------------------------------------------------------------- */
  function initTheme() {
    const themeToggle = document.getElementById('theme-toggle');
    if (!themeToggle) return;

    // data-theme 已由 head 内联脚本同步写入，此处直接读取当前值
    updateThemeIcon(document.documentElement.getAttribute('data-theme') || 'dark');

    themeToggle.addEventListener('click', () => {
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      const target = isDark ? 'light' : 'dark';

      document.documentElement.setAttribute('data-theme', target);
      try {
        localStorage.setItem('dx_theme', target);
      } catch (e) { /* 隐私模式下忽略 */ }
      updateThemeIcon(target);
      // 同步移动端浏览器状态栏颜色
      const themeColorMeta = document.querySelector('meta[name="theme-color"]');
      if (themeColorMeta) {
        themeColorMeta.setAttribute('content', target === 'dark' ? '#0a0e17' : '#f8fafc');
      }
      showToast(`已切换至${target === 'dark' ? '深色' : '浅色'}模式`);
    });
  }

  function updateThemeIcon(theme) {
    const box = document.getElementById('theme-icon');
    if (!box) return;

    box.innerHTML = theme === 'light'
      ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>`
      : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>`;
  }

  /* --------------------------------------------------------------------------
     2. 移动端菜单（含无障碍状态与外部点击关闭）
     -------------------------------------------------------------------------- */
  function initMobileMenu() {
    const toggle = document.getElementById('mobile-toggle');
    const navMenu = document.getElementById('nav-menu');
    if (!toggle || !navMenu) return;

    function setMenu(open) {
      navMenu.classList.toggle('active', open);
      document.body.classList.toggle('nav-open', open);
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? '收起导航菜单' : '展开导航菜单');
    }

    toggle.addEventListener('click', () => {
      setMenu(!navMenu.classList.contains('active'));
    });

    // 点击菜单项后收起（锚点跳转）
    navMenu.querySelectorAll('.nav-link').forEach(link => {
      link.addEventListener('click', () => setMenu(false));
    });

    // 点击菜单外部区域关闭
    document.addEventListener('click', (e) => {
      if (!navMenu.classList.contains('active')) return;
      if (!navMenu.contains(e.target) && !toggle.contains(e.target)) setMenu(false);
    });

    // ESC 关闭 / 视口放大到桌面端时重置
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && navMenu.classList.contains('active')) {
        setMenu(false);
        toggle.focus();
      }
    });

    window.addEventListener('resize', rafThrottle(() => {
      if (window.innerWidth > 768 && navMenu.classList.contains('active')) setMenu(false);
    }));
  }

  /* --------------------------------------------------------------------------
     3. 作品项目分类筛选（class 驱动，动画与布局解耦）
     -------------------------------------------------------------------------- */
  function initProjectFilter() {
    const btns = document.querySelectorAll('.tab-btn');
    const cards = document.querySelectorAll('.project-card');
    if (!btns.length || !cards.length) return;

    btns.forEach(btn => {
      btn.addEventListener('click', () => {
        btns.forEach(b => {
          b.classList.remove('active');
          b.setAttribute('aria-pressed', 'false');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-pressed', 'true');

        const filter = btn.getAttribute('data-filter');

        cards.forEach(card => {
          const categories = (card.getAttribute('data-category') || '').split(/\s+/);
          const match = filter === 'all' || categories.includes(filter);

          if (card._fadeTimer) clearTimeout(card._fadeTimer);

          if (match) {
            card.classList.remove('is-hidden');
            // 下一帧再移除渐隐，确保过渡生效
            requestAnimationFrame(() => card.classList.remove('is-fading'));
          } else {
            card.classList.add('is-fading');
            if (prefersReducedMotion) {
              card.classList.add('is-hidden');
            } else {
              card._fadeTimer = setTimeout(() => {
                if (card.classList.contains('is-fading')) card.classList.add('is-hidden');
              }, 320);
            }
          }
        });
      });
    });

    // 初始无障碍状态
    btns.forEach(b => b.setAttribute('aria-pressed', String(b.classList.contains('active'))));
  }

  /* --------------------------------------------------------------------------
     3.5 邮箱运行时拼装（HTML 不落明文，防爬虫抓取）
     在 initClipboardToast 之前执行，为元素补上 data-copy 供复制逻辑绑定
     -------------------------------------------------------------------------- */
  function initMailbox() {
    document.querySelectorAll('[data-mailbox]').forEach(el => {
      const email = `${el.dataset.user}@${el.dataset.domain}`;
      el.querySelectorAll('.mailbox-text').forEach(t => { t.textContent = email; });
      if (!el.querySelector('.mailbox-text')) el.textContent = email;
      el.setAttribute('data-copy', email);
      el.setAttribute('aria-label', `复制邮箱 ${email}`);
    });
  }

  /* --------------------------------------------------------------------------
     4. 复制到剪贴板 + Toast
     -------------------------------------------------------------------------- */
  function initClipboardToast() {
    document.querySelectorAll('[data-copy]').forEach(el => {
      if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
      if (!el.hasAttribute('role')) el.setAttribute('role', 'button');

      const copy = () => {
        const text = el.getAttribute('data-copy');
        const done = () => showToast(`已复制：${text}`);
        const fail = () => showToast('复制失败，请手动长按复制');

        if (navigator.clipboard && window.isSecureContext) {
          navigator.clipboard.writeText(text).then(done).catch(fallback);
        } else {
          fallback();
        }

        function fallback() {
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.setAttribute('readonly', '');
          ta.style.cssText = 'position:fixed;top:-9999px;opacity:0;';
          document.body.appendChild(ta);
          ta.select();
          try {
            document.execCommand('copy') ? done() : fail();
          } catch (e) {
            fail();
          }
          document.body.removeChild(ta);
        }
      };

      el.addEventListener('click', copy);
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          copy();
        }
      });
    });
  }

  let toastTimer = null;
  function showToast(message) {
    let toast = document.getElementById('toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'toast';
      toast.className = 'toast';
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');

    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2400);
  }

  /* --------------------------------------------------------------------------
     5. 微信二维码弹窗（焦点管理 + 焦点陷阱）
     -------------------------------------------------------------------------- */
  function initWechatModal() {
    const modal = document.getElementById('wechat-modal');
    if (!modal) return;

    const triggers = [
      document.getElementById('wechat-modal-trigger'),
      document.getElementById('wechat-box-trigger')
    ].filter(Boolean);

    const closeBtn = document.getElementById('modal-close');
    let lastFocused = null;

    triggers.forEach(t => {
      if (!t.hasAttribute('tabindex') && t.tagName !== 'BUTTON') t.setAttribute('tabindex', '0');
      if (!t.hasAttribute('role') && t.tagName !== 'BUTTON') t.setAttribute('role', 'button');
      t.addEventListener('click', open);
      t.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      });
    });

    function open() {
      lastFocused = document.activeElement;
      const qr = modal.querySelector('img[data-src]');
      if (qr) {
        qr.src = qr.dataset.src;
        qr.removeAttribute('data-src');
      }
      document.body.classList.add('nav-open');
      modal.classList.add('active');
      if (closeBtn) closeBtn.focus();
    }

    function close() {
      modal.classList.remove('active');
      document.body.classList.remove('nav-open');
      if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
    }

    if (closeBtn) closeBtn.addEventListener('click', close);

    modal.addEventListener('click', (e) => {
      if (e.target === modal) close();
    });

    document.addEventListener('keydown', (e) => {
      if (!modal.classList.contains('active')) return;

      if (e.key === 'Escape') {
        close();
        return;
      }

      // 焦点陷阱：Tab 在弹窗内循环
      if (e.key === 'Tab') {
        const focusables = modal.querySelectorAll('button, [href], input, [tabindex]:not([tabindex="-1"])');
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    });
  }

  /* --------------------------------------------------------------------------
     6. 滚动效果：导航态、回到顶部、顶部进度条（统一 rAF 节流）
     -------------------------------------------------------------------------- */
  function initScrollEffects() {
    const navbar = document.getElementById('navbar');
    const backTop = document.getElementById('back-to-top');
    const progress = document.getElementById('scroll-progress-bar');

    const onScroll = rafThrottle(() => {
      const y = window.scrollY || document.documentElement.scrollTop;

      if (navbar) navbar.classList.toggle('scrolled', y > 24);
      if (backTop) backTop.classList.toggle('show', y > 400);

      if (progress) {
        const height = document.documentElement.scrollHeight - window.innerHeight;
        const pct = height > 0 ? Math.min(100, (y / height) * 100) : 0;
        progress.style.transform = `scaleX(${(pct / 100).toFixed(4)})`;
      }
    });

    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    if (backTop) {
      backTop.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: prefersReducedMotion ? 'auto' : 'smooth' });
      });
    }
  }

  /* --------------------------------------------------------------------------
     7. 导航高亮 (ScrollSpy) —— IntersectionObserver 替代 scroll 计算
     -------------------------------------------------------------------------- */
  function initScrollSpy() {
    const sections = Array.from(document.querySelectorAll('section[id]'));
    const links = Array.from(document.querySelectorAll('.nav-link'));
    if (!sections.length || !links.length || !('IntersectionObserver' in window)) return;

    const visible = new Map();

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        visible.set(entry.target.id, entry.isIntersecting ? entry.intersectionRatio : 0);
      });

      // 取当前可见比例最高的区块
      let currentId = '';
      let max = 0;
      visible.forEach((ratio, id) => {
        if (ratio > max) {
          max = ratio;
          currentId = id;
        }
      });
      if (!currentId) return;

      links.forEach(link => {
        const active = link.getAttribute('href') === `#${currentId}`;
        link.classList.toggle('active', active);
        if (active) {
          link.setAttribute('aria-current', 'true');
        } else {
          link.removeAttribute('aria-current');
        }
      });
    }, {
      rootMargin: '-72px 0px -55% 0px',
      threshold: [0, 0.25, 0.5, 0.75, 1]
    });

    sections.forEach(s => observer.observe(s));

    // 触底兜底高亮：确保页面滚动到最底部时正确激活“联系方式”
    window.addEventListener('scroll', () => {
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 40) {
        links.forEach(link => {
          const isContact = link.getAttribute('href') === '#contact';
          link.classList.toggle('active', isContact);
          if (isContact) link.setAttribute('aria-current', 'true');
          else link.removeAttribute('aria-current');
        });
      }
    }, { passive: true });
  }

  /* --------------------------------------------------------------------------
     8. 滚动入场动画
     -------------------------------------------------------------------------- */
  function initReveal() {
    const targets = document.querySelectorAll(
      '.section-header, .bento-card, .edu-card, .internship-card, .skill-category-card, ' +
      '.award-card, .project-card, .contact-box'
    );
    if (!targets.length) return;

    if (prefersReducedMotion || !('IntersectionObserver' in window)) return;

    targets.forEach(el => el.classList.add('reveal'));

    const observer = new IntersectionObserver((entries, obs) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        obs.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });

    targets.forEach((el, i) => {
      // 同组卡片错落出现，避免整排同时弹出
      el.style.transitionDelay = `${Math.min((i % 4) * 70, 280)}ms`;
      observer.observe(el);
    });
  }

  /* --------------------------------------------------------------------------
     9. 动态打字效果（减弱动效时直接展示静态文案）
     -------------------------------------------------------------------------- */
  function initTypewriter() {
    const target = document.getElementById('typing-role');
    if (!target) return;

    const phrases = [
      '应用统计硕士 · 工业工程复合背景',
      '长春工业大学 · 应用统计硕士（研究方向：数据分析）',
      '工业工程 (IE) × 数据分析 × 统计建模',
      '时间序列分析 · 生产线作业测定 · 精益改善',
      'Web 3D 全景数字孪生 · Three.js 研发探索'
    ];

    if (prefersReducedMotion) {
      target.textContent = phrases[0];
      return;
    }

    let phraseIndex = 0;
    let charIndex = phrases[0].length;
    let isDeleting = true;
    let speed = 2200; // 首屏完整停留 2.2 秒后再平滑回退，避免切字突变

    function tick() {
      const phrase = phrases[phraseIndex];

      if (isDeleting) {
        charIndex--;
        speed = 45;
      } else {
        charIndex++;
        speed = 110;
      }
      target.textContent = phrase.substring(0, charIndex);

      if (!isDeleting && charIndex === phrase.length) {
        isDeleting = true;
        speed = 1900;
      } else if (isDeleting && charIndex === 0) {
        isDeleting = false;
        phraseIndex = (phraseIndex + 1) % phrases.length;
        speed = 400;
      }

      setTimeout(tick, speed);
    }

    setTimeout(tick, speed);
  }

  /* --------------------------------------------------------------------------
     10. 数字翻牌滚动递增动画 (Count Up)
     -------------------------------------------------------------------------- */
  function initCountUp() {
    const counters = document.querySelectorAll('.counter-val');
    if (!counters.length) return;

    if (prefersReducedMotion || !('IntersectionObserver' in window)) return;

    const observer = new IntersectionObserver((entries, obs) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        obs.unobserve(el);

        const target = parseFloat(el.getAttribute('data-target') || '0');
        const prefix = el.getAttribute('data-prefix') || '';
        const suffix = el.getAttribute('data-suffix') || '';
        const duration = 1400; // ms
        const startTime = performance.now();

        function update(currentTime) {
          const elapsed = currentTime - startTime;
          const progress = Math.min(elapsed / duration, 1);
          // Ease-out cubic: 1 - (1 - t)^3
          const easeProgress = 1 - Math.pow(1 - progress, 3);
          const currentVal = Math.round(target * easeProgress);

          el.textContent = `${prefix}${currentVal}${suffix}`;

          if (progress < 1) {
            requestAnimationFrame(update);
          } else {
            el.textContent = `${prefix}${target}${suffix}`;
          }
        }

        requestAnimationFrame(update);
      });
    }, { threshold: 0.2 });

    counters.forEach(c => observer.observe(c));
  }

  /* --------------------------------------------------------------------------
     11. 卡片指针跟随高光（仅精确指针设备，移动端不触发）
     -------------------------------------------------------------------------- */
  function initCardPointerGlow() {
    if (prefersReducedMotion) return;
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

    document.querySelectorAll(
      '.bento-card, .edu-card, .internship-card, .award-card, ' +
      '.skill-category-card, .competition-hero-card'
    ).forEach(card => {
      card.addEventListener('pointermove', (e) => {
        const rect = card.getBoundingClientRect();
        card.style.setProperty('--mx', `${e.clientX - rect.left}px`);
        card.style.setProperty('--my', `${e.clientY - rect.top}px`);
      });
    });
  }

  /* --------------------------------------------------------------------------
     12. 页脚年份自动更新
     -------------------------------------------------------------------------- */
  function initFooterYear() {
    const el = document.querySelector('.footer-year');
    if (el) el.textContent = String(new Date().getFullYear());
  }

  /* --------------------------------------------------------------------------
     13. 页脚“最后更新”（取 GitHub Pages 部署时间）
     -------------------------------------------------------------------------- */
  function initLastMod() {
    const el = document.querySelector('.lastmod');
    if (!el || !document.lastModified) return;
    const d = new Date(document.lastModified);
    if (isNaN(d.getTime())) return;
    const pad = (n) => String(n).padStart(2, '0');
    el.textContent = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  /* --------------------------------------------------------------------------
     14. 命令面板（Ctrl/⌘ + K）：章节导航 · 子站页面 · 快捷操作
     参考 leerob / brianlovin 等个人站的 ⌘K 交互，DOM 由脚本注入
     -------------------------------------------------------------------------- */
  function initCommandPalette() {
    if (document.getElementById('palette-overlay')) return;

    const mailboxEl = document.querySelector('[data-mailbox]');
    const email = mailboxEl ? mailboxEl.getAttribute('data-copy') : '';

    const groups = [
      {
        label: '页面与作品',
        keywords: 'resume cv jianli',
        items: [
          { icon: '📄', label: '在线简历（附 PDF 下载）', href: 'resume/', keywords: 'resume cv jianli 简历' },
          { icon: '🌌', label: 'Aurora Chat · 极光 AI 聊天工作台', href: 'aurora-chat/', keywords: 'aurora chat ai 聊天 大模型 glm deepseek arena 对比' },
          { icon: '❄️', label: '雪线之上 · 冰雪经济可视化系统', href: 'snow-viz/index.html', keywords: 'snow viz 3d 可视化 冰雪' },
          { icon: '📘', label: '雪线之上 · 作品说明书', href: 'snow-viz/documentation.html', keywords: 'documentation 说明书 指标' },
          { icon: '🗺️', label: '长春工业大学全景立体地图', href: 'campus-map/', keywords: 'campus map 3d 校园地图' },
          { icon: '🏭', label: '案例 · 智能制造产线节拍异常诊断', href: 'case-studies/smart-manufacturing-takt-time-analysis.html', keywords: 'case ie 制造 takt' },
          { icon: '🏦', label: '案例 · 信贷违约风险预警与数智定价', href: 'case-studies/applied-statistics-credit-risk.html', keywords: 'case 统计 信贷 risk' },
          { icon: '🐙', label: 'GitHub 主页 @dai123x', href: 'https://github.com/dai123x', keywords: 'github 代码 repo' },
          { icon: '⬇️', label: '下载简历 PDF', href: 'resume/resume.pdf', keywords: 'download pdf 简历下载' }
        ]
      },
      {
        label: '本页章节',
        keywords: 'section',
        items: [
          { icon: '🏠', label: '首页 Hero', href: '#hero', keywords: 'home hero 首页' },
          { icon: '👤', label: '个人概况', href: '#about', keywords: 'about 概况' },
          { icon: '🎓', label: '教育背景', href: '#education', keywords: 'education 教育 硕士' },
          { icon: '💼', label: '实习经历', href: '#internships', keywords: 'internship 实习 丰田' },
          { icon: '🧰', label: '专业技能', href: '#skills', keywords: 'skills 技能 r python' },
          { icon: '🏆', label: '竞赛荣誉', href: '#awards', keywords: 'awards 获奖 挑战杯' },
          { icon: '🖥️', label: '参赛作品', href: '#competition', keywords: 'competition 虚拟现实大赛' },
          { icon: '📂', label: '精选项目', href: '#projects', keywords: 'projects 项目 作品' },
          { icon: '📮', label: '联系方式', href: '#contact', keywords: 'contact 联系 微信' }
        ]
      },
      {
        label: '快捷操作',
        keywords: 'action',
        items: [
          {
            icon: '🌓', label: '切换深色 / 浅色主题', keywords: 'theme dark light 主题 深色 浅色',
            action: () => { const t = document.getElementById('theme-toggle'); if (t) t.click(); }
          },
          {
            icon: '📧', label: '复制邮箱地址', keywords: 'email copy 邮箱 复制',
            action: () => { if (mailboxEl) mailboxEl.click(); }
          },
          {
            icon: '🔝', label: '回到顶部', keywords: 'top 回到顶部 顶部',
            action: () => window.scrollTo({ top: 0, behavior: prefersReducedMotion ? 'auto' : 'smooth' })
          }
        ]
      }
    ];

    const overlay = document.createElement('div');
    overlay.id = 'palette-overlay';
    overlay.className = 'palette-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', '快捷搜索与操作');
    overlay.innerHTML = `
      <div class="palette-panel">
        <div class="palette-input-row">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          <input id="palette-input" class="palette-input" type="text" placeholder="搜索章节、页面或操作…" autocomplete="off" spellcheck="false" aria-label="搜索章节、页面或操作">
          <kbd class="palette-kbd">Esc</kbd>
        </div>
        <div class="palette-list" id="palette-list" role="listbox" aria-label="结果列表"></div>
      </div>`;
    document.body.appendChild(overlay);

    const input = overlay.querySelector('.palette-input');
    const list = overlay.querySelector('.palette-list');
    let flat = [];        // [{ el, item }]
    let activeIdx = 0;
    let lastFocused = null;

    function render() {
      const q = input.value.trim().toLowerCase();
      list.innerHTML = '';
      flat = [];

      groups.forEach(g => {
        const hits = g.items.filter(it => !q
          || it.label.toLowerCase().includes(q)
          || (it.keywords || '').toLowerCase().includes(q)
          || (g.keywords || '').toLowerCase().includes(q));
        if (!hits.length) return;

        const head = document.createElement('div');
        head.className = 'palette-group';
        head.textContent = g.label;
        list.appendChild(head);

        hits.forEach(it => {
          const entry = { item: it, el: null };
          const row = document.createElement('div');
          entry.el = row;
          row.className = 'palette-item';
          row.id = `palette-item-${flat.length}`;
          row.setAttribute('role', 'option');
          row.innerHTML = `<span class="pi-icon" aria-hidden="true">${it.icon}</span><span>${it.label}</span>`
            + (it.href && !it.href.startsWith('#') ? '<span class="pi-hint" aria-hidden="true">↗</span>' : '');
          row.addEventListener('mouseenter', () => setActive(flat.indexOf(entry)));
          row.addEventListener('click', () => run(it));
          flat.push(entry);
          list.appendChild(row);
        });
      });

      if (!flat.length) {
        list.innerHTML = '<div class="palette-empty">没有匹配的结果，换个关键词试试～</div>';
      }
      setActive(0);
    }

    function setActive(i) {
      if (!flat.length) { activeIdx = 0; return; }
      activeIdx = (i + flat.length) % flat.length;
      flat.forEach((e, idx) => {
        e.el.classList.toggle('active', idx === activeIdx);
        e.el.setAttribute('aria-selected', String(idx === activeIdx));
      });
      const cur = flat[activeIdx].el;
      list.setAttribute('aria-activedescendant', cur.id);
      if (cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
    }

    function run(it) {
      close();
      if (it.action) { it.action(); return; }
      if (!it.href) return;
      if (it.href.startsWith('#')) {
        const target = document.querySelector(it.href);
        if (target) target.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'start' });
      } else {
        window.open(it.href, '_blank', 'noopener');
      }
    }

    function open() {
      lastFocused = document.activeElement;
      overlay.classList.add('active');
      input.value = '';
      render();
      setTimeout(() => input.focus(), 0);
    }

    function close() {
      overlay.classList.remove('active');
      if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
    }

    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        overlay.classList.contains('active') ? close() : open();
        return;
      }
      if (!overlay.classList.contains('active')) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive(activeIdx + 1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive(activeIdx - 1);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (flat[activeIdx]) run(flat[activeIdx].item);
      } else if (e.key === 'Tab') {
        // 单输入框面板：Tab 留在输入框内即可
        e.preventDefault();
      }
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    input.addEventListener('input', render);

    const trigger = document.getElementById('palette-trigger');
    if (trigger) trigger.addEventListener('click', open);
  }
})();
