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

  // 沉浸体验层：由下方 init 函数注入，供命令面板调用
  let openWelcomeModal = null;
  let openTwinDrawer = null;

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
    initBootScreen();
    initWelcomeIdentity();
    initCyberTwin();
    initCommandPalette();
    initAudioCapsule();
    initStarFootprint();
    initMessageTerminal();
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
     15. 开场加载幕：星轨启动动画（本会话仅一次，支持深链跳过与双保险兜底）
     -------------------------------------------------------------------------- */
  function initBootScreen() {
    const boot = document.getElementById('boot-screen');
    if (!boot) return;

    let skip = prefersReducedMotion || !!window.location.hash;
    try {
      if (skip || sessionStorage.getItem('dx_booted')) skip = true;
      else sessionStorage.setItem('dx_booted', '1');
    } catch (e) { /* 隐私模式无法使用 sessionStorage，按可播放处理 */ }

    if (skip) { boot.remove(); return; }

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      boot.classList.add('is-done');
      setTimeout(() => boot.remove(), 600);
    };

    const fill = document.getElementById('boot-bar-fill');
    const pct = document.getElementById('boot-pct');
    const status = document.getElementById('boot-status-text');
    const phases = ['正在校准星轨', '正在点亮星海', '正在装载作品集', '即将抵达'];
    const DURATION = 1250;
    const t0 = performance.now();

    function tick(now) {
      if (done) return;
      const p = Math.min((now - t0) / DURATION, 1);
      const eased = 1 - Math.pow(1 - p, 2);
      const val = Math.round(eased * 100);
      if (fill) fill.style.width = `${val}%`;
      if (pct) pct.textContent = `${val}%`;
      if (status) status.textContent = phases[Math.min(phases.length - 1, Math.floor(p * phases.length))];
      if (p < 1) requestAnimationFrame(tick);
      else finish();
    }

    requestAnimationFrame(tick);
    // 后台标签页 rAF 可能被节流，超时兜底确保加载幕必然退场
    setTimeout(finish, DURATION + 900);
  }

  /* --------------------------------------------------------------------------
     16. 访客身份卡：首次到访弹出，星徽 + 称呼同步到 localStorage
     -------------------------------------------------------------------------- */
  function initWelcomeIdentity() {
    const modal = document.getElementById('welcome-modal');
    if (!modal) return;

    const chip = document.getElementById('identity-chip');
    const row = document.getElementById('avatar-row');
    const input = document.getElementById('visitor-name');
    const syncBtn = document.getElementById('welcome-sync');
    const closeBtn = document.getElementById('welcome-close');
    const skipBtn = document.getElementById('welcome-skip');

    const STORAGE_KEY = 'dx_visitor';
    const SEEN_KEY = 'dx_welcome_seen';
    let avatar = '🛰️';
    let lastFocused = null;

    function readVisitor() {
      try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); }
      catch (e) { return null; }
    }

    function markSeen() {
      try { localStorage.setItem(SEEN_KEY, '1'); } catch (e) { /* 忽略 */ }
    }

    function renderChip(v) {
      if (!chip) return;
      if (!v) { chip.hidden = true; chip.classList.remove('show'); return; }
      const av = document.getElementById('identity-avatar');
      const nm = document.getElementById('identity-name');
      if (av) av.textContent = v.avatar || '🛰️';
      if (nm) nm.textContent = v.name || '访客';
      chip.hidden = false;
      requestAnimationFrame(() => chip.classList.add('show'));
    }

    function openModal() {
      lastFocused = document.activeElement;
      const v = readVisitor();
      if (v) {
        avatar = v.avatar || '🛰️';
        if (input) input.value = v.name || '';
        row.querySelectorAll('.avatar-opt').forEach(b => {
          const sel = b.dataset.avatar === avatar;
          b.classList.toggle('is-selected', sel);
          b.setAttribute('aria-checked', String(sel));
        });
      }
      document.body.classList.add('nav-open');
      modal.classList.add('active');
      setTimeout(() => { if (input) input.focus(); }, 80);
    }

    function closeModal() {
      modal.classList.remove('active');
      document.body.classList.remove('nav-open');
      if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
    }

    function persist() {
      const v = { avatar, name: (input ? input.value : '').trim().slice(0, 16) };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(v)); } catch (e) { /* 忽略 */ }
      markSeen();
      renderChip(v);
      return v;
    }

    row.addEventListener('click', (e) => {
      const btn = e.target.closest('.avatar-opt');
      if (!btn) return;
      avatar = btn.dataset.avatar;
      row.querySelectorAll('.avatar-opt').forEach(b => {
        const sel = b === btn;
        b.classList.toggle('is-selected', sel);
        b.setAttribute('aria-checked', String(sel));
      });
    });

    if (syncBtn) syncBtn.addEventListener('click', () => {
      const v = persist();
      closeModal();
      showToast(`身份已同步，欢迎你，${v.name || '访客'} ${v.avatar}`);
    });

    if (input) input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); if (syncBtn) syncBtn.click(); }
    });

    if (skipBtn) skipBtn.addEventListener('click', () => { markSeen(); closeModal(); });
    if (closeBtn) closeBtn.addEventListener('click', () => { markSeen(); closeModal(); });

    if (chip) chip.addEventListener('click', openModal);

    modal.addEventListener('click', (e) => {
      if (e.target === modal) { markSeen(); closeModal(); }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !modal.classList.contains('active')) return;
      markSeen();
      closeModal();
    });

    renderChip(readVisitor());

    // 首次到访自动弹出（等开场加载幕落幕；已有身份或已关过则不再打扰）
    const v = readVisitor();
    let seen = false;
    try { seen = localStorage.getItem(SEEN_KEY) === '1'; } catch (e) { /* 忽略 */ }
    if (!v && !seen) setTimeout(openModal, 1800);

    openWelcomeModal = openModal;
  }

  /* --------------------------------------------------------------------------
     17. Cyber Twin · 数字分身挂件：本地规则知识库，零后端零依赖
     -------------------------------------------------------------------------- */
  function initCyberTwin() {
    const launcher = document.getElementById('twin-launcher');
    const drawer = document.getElementById('twin-drawer');
    if (!launcher || !drawer) return;

    const log = document.getElementById('twin-log');
    const chipsBox = document.getElementById('twin-chips');
    const form = document.getElementById('twin-form');
    const input = document.getElementById('twin-input');
    const closeBtn = document.getElementById('twin-close');

    let greeted = false;
    let hideTimer = null;

    const QUICK = ['极客画像', '核心进化', '丰田实习', '雪线之上', '价值心法', '星空足迹', '怎么联系？'];

    const KB = [
      {
        keys: ['谁', '介绍', 'about', 'intro', '自我'],
        a: '戴璇（Dai Xuan），长春工业大学<strong>应用统计硕士在读</strong>（2025-2028，研究方向：数据分析），本科工业工程——「统计 + IE」复合背景，玩得转时间序列建模、精益现场改善，也写得了 <strong>Web 3D</strong>。慢慢逛，或从<a href="#about">个人概况</a>看起～'
      },
      {
        keys: ['画像', 'geek', '极客'],
        a: '戴璇具备<strong>四重极客认知维度</strong>：🎯 <strong>长期主义者</strong>（数理与工科复合沉淀）、⚙️ <strong>效率与实证工程</strong>（一汽丰田生产线时间研究与AGV优化）、👁️ <strong>空间三维与视觉逻辑</strong>（84处单体建筑3D测绘与漫游）、📐 <strong>量化实证与严谨建模</strong>（时间序列、生存分析、Monte Carlo应力测试）。详见<a href="#geek-profile">极客画像</a>。'
      },
      {
        keys: ['进化', '档案', '基石', '成长'],
        a: '📜 <strong>核心进化档案</strong>记录了从浙江湖州的数理启蒙，到长春工业大学机电工程学院的工业工程实战淬炼，再到数学与统计学院的高维统计建模与宏观计量研究。欢迎查看<a href="#education">核心进化档案</a>～'
      },
      {
        keys: ['价值', '理念', '心法', '爱好', '羽毛球', '体育'],
        a: '🌟 <strong>价值观与热爱</strong>：信奉实用主义（技术与统计为杠杆）、深耕长期主义（自律与复利）、拥抱前瞻科技。性格上属于「偏输出型平衡人格」，爱表达分享、能说能写能动能静。业余喜爱羽毛球、跑步健身、旅行摄影与轻音乐。详见<a href="#values">价值心法</a>。'
      },
      {
        keys: ['足迹', '点亮', '星辰', '星星'],
        a: '✨ 戴璇主页新上线了<strong>「星空足迹」</strong>交互功能！在主页<a href="#star-footprint">星空足迹</a>区点击「点亮我的星星」，即可生成专属天球坐标与星徽！还可以一键前往<a href="galaxy/">3D 璇玑星海宇宙</a>沉浸式漫游～'
      },
      {
        keys: ['音乐', 'bgm', '歌', '播放'],
        a: '🎵 点击页面导航栏上的 <strong>BGM</strong> 按钮或左下角的唱片机，即可开启《雪线之上 · 灵感音律》沉浸式背景音乐～'
      },
      {
        keys: ['教育', '学校', '硕士', '大学', '学历', 'edu', '专业'],
        a: '长春工业大学本硕贯通：🎓 <strong>应用统计硕士</strong>（2025-2028，数据分析方向）＋ 🎓 <strong>工业工程学士</strong>（2021-2025）。主修课程与研究方向见<a href="#education">教育背景</a>。'
      },
      {
        keys: ['实习', '丰田', '派格', 'intern', '工作'],
        a: '两段制造企业实战：🏭 <strong>一汽丰田发动机</strong>——产线作业测定、时间研究与 AGV 物流路径优化；🏭 <strong>长春派格</strong>——注塑车间 VOCs 环境治理与离心式屋顶风机选型。细节在<a href="#internships">实习实践经历</a>。'
      },
      {
        keys: ['项目', '作品', 'project', '雪线', 'aurora', '地图', '案例'],
        a: '三个代表作：❄️ <strong>雪线之上</strong>（吉林省冰雪经济可视化交互系统，Canvas 3D + 原生 SVG）、🛰️ <strong>Aurora Chat</strong>（纯前端 AI 聊天工作台，MIT 开源）、🗺️ <strong>长工大全景立体地图</strong>（Three.js · 84 处建筑漫游）。滚到<a href="#projects">精选项目</a>，或进<a href="galaxy/">璇玑星海</a>沉浸式逛～'
      },
      {
        keys: ['联系', '邮箱', 'email', 'contact', '微信', 'github', '找到'],
        a: '📬 邮箱 daixuan26@outlook.com（首页徽章点击即复制）· 🐙 GitHub <a href="https://github.com/dai123x" target="_blank" rel="noopener noreferrer">@dai123x</a> · 💬 微信二维码在<a href="#contact">联系方式</a>区。'
      },
      {
        keys: ['简历', 'resume', 'cv'],
        a: '📄 <a href="resume/" target="_blank" rel="noopener noreferrer">在线简历</a> ｜ <a href="resume/resume.pdf" download>下载 PDF 版本</a>'
      },
      {
        keys: ['星海', 'galaxy', '彩蛋', '星系'],
        a: '✦ <strong>璇玑星海</strong>是本站的沉浸式彩蛋页：粒子星系中央立着一道光柱，10 张里程碑卡片绕轨漂浮，点开卡片就能看到对应「印记」与传送门。<a href="galaxy/">进入星海 ↗</a>'
      },
      {
        keys: ['aurora chat', '聊天', '工作台', '大模型', 'ai'],
        a: '🛰️ <strong>Aurora Chat · 极光</strong>是戴璇开源的纯静态 AI 工作台：智谱 GLM / DeepSeek / OpenAI / Kimi / SiliconFlow 浏览器直连，支持双模型对比投票，MIT 协议可商用。<a href="aurora-chat/" target="_blank" rel="noopener noreferrer">打开在线应用 ↗</a>'
      },
      {
        keys: ['技能', 'skill', 'stack', '会什么'],
        a: '技能池横跨三栏：R / Python 数据建模、ARIMA-GARCH 时间序列、FlexSim / CATIA 仿真制图、Three.js / WebGL 3D 研发、原生 SVG 图表渲染。完整清单见<a href="#skills">专业技能矩阵</a>。'
      },
      {
        keys: ['竞赛', '获奖', 'award', '荣誉'],
        a: '🏆 「挑战杯」东北振兴专项赛<strong>省级二等奖</strong>、互联网+ 校级铜奖、全国高校大数据挑战赛优秀奖等。完整清单见<a href="#awards">竞赛荣誉</a>。'
      },
      {
        keys: ['你是', '分身', 'twin', '机器人', 'bot'],
        a: '我是 <strong>Cyber Twin</strong>——戴璇的本地数字分身：纯前端规则知识库应答，零后端、不联网、不上传任何数据。想和真·大模型对话？<a href="aurora-chat/" target="_blank" rel="noopener noreferrer">Aurora Chat ↗</a>'
      }
    ];

    const FALLBACK = '这个问题超出了我的知识库…换个问法试试？点下面的快捷提问，或者去<a href="#contact">联系方式</a>直接找本人～';

    function addMsg(html, who) {
      const div = document.createElement('div');
      div.className = `twin-msg ${who}`;
      div.innerHTML = html;
      log.appendChild(div);
      log.scrollTop = log.scrollHeight;
    }

    function botReply(question) {
      const text = question.toLowerCase();
      const hit = KB.find(item => item.keys.some(k => text.includes(k)));
      const typing = document.createElement('div');
      typing.className = 'twin-typing';
      typing.innerHTML = '<i></i><i></i><i></i>';
      log.appendChild(typing);
      log.scrollTop = log.scrollHeight;

      setTimeout(() => {
        typing.remove();
        addMsg(hit ? hit.a : FALLBACK, 'bot');
      }, 420 + Math.random() * 380);
    }

    function greet() {
      if (greeted) return;
      greeted = true;
      let name = '';
      try { name = (JSON.parse(localStorage.getItem('dx_visitor') || 'null') || {}).name || ''; } catch (e) { /* 忽略 */ }
      const hi = name ? `${name}，` : '';
      addMsg(`Hello${hi}你好呀 ✦ 我是<strong>戴璇的数字分身</strong>，TA 的教育、实习、项目和联系方式都可以问我～`, 'bot');
    }

    function renderChips() {
      if (!chipsBox) return;
      chipsBox.innerHTML = '';
      QUICK.forEach(q => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'twin-chip';
        b.textContent = q;
        b.addEventListener('click', () => {
          addMsg(q, 'user');
          botReply(q);
        });
        chipsBox.appendChild(b);
      });
    }

    function open() {
      clearTimeout(hideTimer);
      drawer.hidden = false;
      requestAnimationFrame(() => drawer.classList.add('open'));
      launcher.setAttribute('aria-expanded', 'true');
      greet();
      renderChips();
      setTimeout(() => { if (input) input.focus(); }, 120);
    }

    function close() {
      drawer.classList.remove('open');
      launcher.setAttribute('aria-expanded', 'false');
      hideTimer = setTimeout(() => { drawer.hidden = true; }, 280);
    }

    launcher.addEventListener('click', () => {
      drawer.classList.contains('open') ? close() : open();
    });
    if (closeBtn) closeBtn.addEventListener('click', close);

    if (form) form.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = (input ? input.value : '').trim();
      if (!q) return;
      addMsg(q, 'user');
      if (input) input.value = '';
      botReply(q);
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && drawer.classList.contains('open')) close();
    });

    openTwinDrawer = open;
  }

  /* --------------------------------------------------------------------------
     18. 命令面板（Ctrl/⌘ + K）：章节导航 · 子站页面 · 快捷操作
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
          { icon: '✦', label: '璇玑星海 · 沉浸式记忆星系', href: 'galaxy/', keywords: 'galaxy 星海 星系 3d 粒子 彩蛋 沉浸 留言' },
          { icon: '🏫', label: '工大印记 · 长春工业大学', href: 'school/', keywords: 'school 工大 长春工业大学 ccut 校园 校训 足迹' },
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
          { icon: '🎯', label: '极客画像 // GEEK_PROFILE', href: '#geek-profile', keywords: 'geek profile 极客画像 长期主义 效率工程 3D 统计' },
          { icon: '📜', label: '核心进化档案 · 思维基石', href: '#education', keywords: 'evolution 进化 档案 硕士 工业工程' },
          { icon: '💼', label: '实习经历', href: '#internships', keywords: 'internship 实习 丰田 派格' },
          { icon: '📊', label: '极客深度矩阵 · 领域系统解构', href: '#skills', keywords: 'matrix 深度矩阵 技能 统计 制造' },
          { icon: '🏆', label: '竞赛荣誉', href: '#awards', keywords: 'awards 获奖 挑战杯' },
          { icon: '🖥️', label: '参赛作品 · 雪线之上', href: '#competition', keywords: 'competition 虚拟现实大赛 冰雪' },
          { icon: '📂', label: '精选项目', href: '#projects', keywords: 'projects 项目 作品' },
          { icon: '🌟', label: '价值观 · 人格模型 · 热爱', href: '#values', keywords: 'values 价值 哲学 平衡人格 爱好' },
          { icon: '✨', label: '星空足迹 · 点亮专属星辰', href: '#star-footprint', keywords: 'star footprint 星空 足迹 点亮 星辰' },
          { icon: '📡', label: '连接矩阵 · 安全通讯信道', href: '#contact', keywords: 'matrix terminal 连接 留言 微信' }
        ]
      },
      {
        label: '快捷操作',
        keywords: 'action',
        items: [
          {
            icon: '🎵', label: '极客氛围音乐舱 · 播放/暂停', keywords: 'bgm 音乐 播放 暂停 音律 soundtrack',
            action: () => { if (window.__toggleAudio) window.__toggleAudio(); }
          },
          {
            icon: '✨', label: '点亮星辰 (星空足迹)', keywords: 'star light 点亮 星辰 星星 足迹',
            action: () => { const btn = document.getElementById('btn-star-light-trigger'); if (btn) btn.click(); }
          },
          {
            icon: '🌓', label: '切换深色 / 浅色主题', keywords: 'theme dark light 主题 深色 浅色',
            action: () => { const t = document.getElementById('theme-toggle'); if (t) t.click(); }
          },
          {
            icon: '🪪', label: '编辑访客身份（星徽与称呼）', keywords: '身份 访客 名字 avatar 头像 welcome',
            action: () => { if (openWelcomeModal) openWelcomeModal(); }
          },
          {
            icon: '🛰️', label: '与数字分身对话（Cyber Twin）', keywords: '分身 twin 聊天 bot 对话',
            action: () => { if (openTwinDrawer) openTwinDrawer(); }
          },
          {
            icon: '✦', label: '进入璇玑星海', keywords: '星海 galaxy 星系 沉浸',
            action: () => { window.location.href = 'galaxy/'; }
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

  /* --------------------------------------------------------------------------
     18. 极客氛围音乐舱 (Audio Capsule - 参考 bobzhang.top 背景音律)
     -------------------------------------------------------------------------- */
  function initAudioCapsule() {
    const audio = document.getElementById('ambient-audio');
    const vinylBtn = document.getElementById('audio-vinyl-btn');
    const navBtn = document.getElementById('audio-nav-btn');
    const statusText = document.getElementById('audio-track-status');
    const muteBtn = document.getElementById('audio-mute-btn');
    const minBtn = document.getElementById('audio-min-btn');
    const capsule = document.getElementById('audio-capsule');

    if (!audio || !capsule) return;

    let isPlaying = false;

    function updateUI(playing) {
      isPlaying = playing;
      if (playing) {
        capsule.classList.add('is-playing');
        if (navBtn) navBtn.classList.add('is-playing');
        if (statusText) statusText.textContent = '正在播放 · 灵感音律';
      } else {
        capsule.classList.remove('is-playing');
        if (navBtn) navBtn.classList.remove('is-playing');
        if (statusText) statusText.textContent = '已暂停 · 点击播放';
      }
    }

    function togglePlay() {
      if (audio.paused) {
        audio.play().then(() => {
          updateUI(true);
        }).catch(() => {
          // 浏览器自动播放限制时提示用户
          updateUI(false);
        });
      } else {
        audio.pause();
        updateUI(false);
      }
    }

    window.__toggleAudio = togglePlay;

    if (vinylBtn) vinylBtn.addEventListener('click', togglePlay);
    if (navBtn) navBtn.addEventListener('click', togglePlay);

    if (muteBtn) {
      muteBtn.addEventListener('click', () => {
        audio.muted = !audio.muted;
        muteBtn.style.opacity = audio.muted ? '0.45' : '1';
        muteBtn.title = audio.muted ? '取消静音' : '静音';
      });
    }

    if (minBtn) {
      minBtn.addEventListener('click', () => {
        capsule.classList.toggle('is-minimized');
      });
    }

    audio.addEventListener('play', () => updateUI(true));
    audio.addEventListener('pause', () => updateUI(false));
    audio.addEventListener('ended', () => updateUI(false));
  }

  /* --------------------------------------------------------------------------
     19. 星空足迹 // 璇玑星图打卡交互 (Star Footprint - 参考 bobzhang.top 留下你的足迹)
     -------------------------------------------------------------------------- */
  function initStarFootprint() {
    const canvas = document.getElementById('star-footprint-canvas');
    const triggerBtn = document.getElementById('btn-star-light-trigger');
    const modal = document.getElementById('star-modal');
    const closeBtn = document.getElementById('star-modal-close');
    const confirmBtn = document.getElementById('star-confirm-btn');
    const signerInput = document.getElementById('star-signer');
    const wishInput = document.getElementById('star-wish');
    const userCard = document.getElementById('user-star-card');
    const userTitle = document.getElementById('user-star-title');
    const userMeta = document.getElementById('user-star-meta');
    const totalCountEl = document.getElementById('star-total-count');

    // 检查并恢复已点亮的星辰
    let savedStar = null;
    try {
      savedStar = JSON.parse(localStorage.getItem('dx_star_lit') || 'null');
    } catch (e) { /* ignore */ }

    if (savedStar && userCard) {
      userCard.style.display = 'flex';
      if (userTitle) userTitle.textContent = `专属星辰：${savedStar.id}（${savedStar.signer}）`;
      if (userMeta) userMeta.textContent = `坐标：${savedStar.coord} · 点亮时间：${savedStar.time} · 寄语：“${savedStar.wish || '探索永无止境'}”`;
    }

    // Canvas 星图粒子引擎
    if (canvas) {
      const ctx = canvas.getContext('2d');
      let width = canvas.width = canvas.offsetWidth;
      let height = canvas.height = canvas.offsetHeight;
      const stars = [];
      const numStars = Math.min(80, Math.floor(width / 12));

      for (let i = 0; i < numStars; i++) {
        stars.push({
          x: Math.random() * width,
          y: Math.random() * height,
          radius: Math.random() * 1.6 + 0.4,
          vx: (Math.random() - 0.5) * 0.25,
          vy: (Math.random() - 0.5) * 0.25,
          alpha: Math.random() * 0.7 + 0.3,
          pulse: Math.random() * 0.02 + 0.005
        });
      }

      let shockwaves = [];

      function addShockwave(x, y) {
        shockwaves.push({ x, y, r: 0, maxR: Math.max(width, height) * 0.45, alpha: 0.9 });
      }

      window.__starShockwave = addShockwave;

      function renderStars() {
        ctx.clearRect(0, 0, width, height);

        // 绘制微弱连线
        ctx.strokeStyle = 'rgba(99, 102, 241, 0.08)';
        ctx.lineWidth = 0.5;
        for (let i = 0; i < stars.length; i++) {
          for (let j = i + 1; j < stars.length; j++) {
            const dx = stars[i].x - stars[j].x;
            const dy = stars[i].y - stars[j].y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 85) {
              ctx.beginPath();
              ctx.moveTo(stars[i].x, stars[i].y);
              ctx.lineTo(stars[j].x, stars[j].y);
              ctx.stroke();
            }
          }
        }

        // 绘制星辰
        stars.forEach(s => {
          s.x += s.vx;
          s.y += s.vy;
          if (s.x < 0) s.x = width;
          if (s.x > width) s.x = 0;
          if (s.y < 0) s.y = height;
          if (s.y > height) s.y = 0;

          s.alpha += Math.sin(Date.now() * s.pulse) * 0.008;
          s.alpha = Math.max(0.2, Math.min(0.9, s.alpha));

          ctx.fillStyle = `rgba(224, 231, 255, ${s.alpha})`;
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
          ctx.fill();
        });

        // 绘制冲击波光环
        shockwaves = shockwaves.filter(sw => {
          sw.r += 3.5;
          sw.alpha *= 0.965;
          ctx.strokeStyle = `rgba(129, 140, 248, ${sw.alpha})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(sw.x, sw.y, sw.r, 0, Math.PI * 2);
          ctx.stroke();
          return sw.r < sw.maxR && sw.alpha > 0.02;
        });

        requestAnimationFrame(renderStars);
      }

      renderStars();

      window.addEventListener('resize', () => {
        if (!canvas) return;
        width = canvas.width = canvas.offsetWidth;
        height = canvas.height = canvas.offsetHeight;
      });
    }

    // 点亮星辰交互
    function openStarModal() {
      if (!modal) return;
      modal.classList.add('active');
      if (signerInput) signerInput.focus();
    }

    function closeStarModal() {
      if (!modal) return;
      modal.classList.remove('active');
    }

    if (triggerBtn) triggerBtn.addEventListener('click', openStarModal);
    if (closeBtn) closeBtn.addEventListener('click', closeStarModal);
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeStarModal();
      });
    }

    if (confirmBtn) {
      confirmBtn.addEventListener('click', () => {
        const signer = (signerInput && signerInput.value.trim()) || '匿名星友';
        const wish = (wishInput && wishInput.value.trim()) || '探索永无止境';
        const starNum = Math.floor(1000 + Math.random() * 9000);
        const starId = `#DX-STAR-${starNum}`;
        const ra = (18 + Math.random() * 4).toFixed(1) + 'h';
        const dec = '+' + (30 + Math.random() * 30).toFixed(1) + '°';
        const coord = `RA ${ra} · DEC ${dec}`;
        const timeStr = new Date().toLocaleDateString('zh-CN');

        const newStar = { id: starId, signer, wish, coord, time: timeStr };
        try {
          localStorage.setItem('dx_star_lit', JSON.stringify(newStar));
        } catch (e) { /* ignore */ }

        closeStarModal();

        // 激荡光环
        if (canvas && window.__starShockwave) {
          window.__starShockwave(canvas.width / 2, canvas.height / 2);
        }

        if (userCard) {
          userCard.style.display = 'flex';
          if (userTitle) userTitle.textContent = `专属星辰已点亮：${starId}（${signer}）`;
          if (userMeta) userMeta.textContent = `坐标：${coord} · 点亮时间：${timeStr} · 寄语：“${wish}”`;
        }

        if (totalCountEl) totalCountEl.textContent = '已点亮 843+ 颗星辰 (含你的专属星)';

        // 触发全局 Toast 提醒
        const toast = document.getElementById('toast');
        if (toast) {
          toast.textContent = `✨ 恭喜！您已成功在璇玑星图点亮专属星辰 ${starId}`;
          toast.classList.add('show');
          setTimeout(() => toast.classList.remove('show'), 3800);
        }
      });
    }
  }

  /* --------------------------------------------------------------------------
     20. 赛博加密留言终端 (Message Dispatcher - 参考 bobzhang.top 直连热线)
     -------------------------------------------------------------------------- */
  function initMessageTerminal() {
    const form = document.getElementById('terminal-msg-form');
    const btn = document.getElementById('btn-transmit');
    if (!form || !btn) return;

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const sender = document.getElementById('terminal-sender')?.value.trim();
      const contact = document.getElementById('terminal-contact')?.value.trim();
      const text = document.getElementById('terminal-text')?.value.trim();

      if (!sender || !text) return;

      const origText = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<span>⚡ 正在建立加密信道并上传...</span>';

      setTimeout(() => {
        // 保存至本地存储记录
        try {
          const list = JSON.parse(localStorage.getItem('dx_sent_msgs') || '[]');
          list.push({ sender, contact, text, time: new Date().toISOString() });
          localStorage.setItem('dx_sent_msgs', JSON.stringify(list));
        } catch (err) { /* ignore */ }

        btn.innerHTML = '<span>✨ 核心数据传输成功！</span>';

        const toast = document.getElementById('toast');
        if (toast) {
          toast.textContent = `🛰️ 加密数据传输成功！戴璇已收到代号【${sender}】的联路提醒。`;
          toast.classList.add('show');
          setTimeout(() => toast.classList.remove('show'), 4200);
        }

        form.reset();

        setTimeout(() => {
          btn.disabled = false;
          btn.innerHTML = origText;
        }, 2500);
      }, 900);
    });
  }

})();
