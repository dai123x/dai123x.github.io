/**
 * DAIXUAN.CLOUD · 案例页图表 lightbox（点击放大）
 * - 仅绑定 .figure-showcase 内的图表
 * - Esc / 点击遮罩关闭，恢复焦点，尊重 prefers-reduced-motion
 */
(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', () => {
    const imgs = document.querySelectorAll('.figure-showcase img');
    if (!imgs.length) return;

    const overlay = document.createElement('div');
    overlay.className = 'lightbox-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', '图表放大查看');
    overlay.setAttribute('tabindex', '-1');
    overlay.innerHTML = '<img class="lightbox-img" alt="">';
    document.body.appendChild(overlay);
    const big = overlay.querySelector('.lightbox-img');

    let lastFocused = null;

    function open(src, alt) {
      lastFocused = document.activeElement;
      big.src = src;
      big.alt = alt || '';
      overlay.classList.add('active');
      document.body.style.overflow = 'hidden';
      overlay.focus();
    }

    function close() {
      if (!overlay.classList.contains('active')) return;
      overlay.classList.remove('active');
      document.body.style.overflow = '';
      big.src = '';
      if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
    }

    imgs.forEach(img => {
      img.style.cursor = 'zoom-in';
      img.setAttribute('tabindex', '0');
      img.setAttribute('role', 'button');
      img.setAttribute('aria-label', '放大查看：' + (img.alt || '图表'));
      const act = () => open(img.currentSrc || img.src, img.alt);
      img.addEventListener('click', act);
      img.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          act();
        }
      });
    });

    overlay.addEventListener('click', close);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
    });
  });
})();
