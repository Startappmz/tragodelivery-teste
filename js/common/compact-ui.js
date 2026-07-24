/* Trago Delivery — Compact UI enhancer (HTML/CSS/JS puro + Tailwind CDN) */
(function () {
  'use strict';

  function addClasses(selector, classes) {
    document.querySelectorAll(selector).forEach((el) => {
      classes.split(/\s+/).filter(Boolean).forEach((cls) => el.classList.add(cls));
    });
  }

  function enhanceButtons() {
    addClasses('.btn, .btn-login, .btn-logout, .btn-voltar, .btn-mapa', 'active:scale-[0.98] transition will-change-transform');
    addClasses('.glass-card, .login-card, .modal-content', 'transition duration-200');
  }

  function addLoadingGuard() {
    document.querySelectorAll('form').forEach((form) => {
      if (form.dataset.compactGuard === '1') return;
      form.dataset.compactGuard = '1';
      form.addEventListener('submit', () => {
        const btn = form.querySelector('button[type="submit"]');
        if (!btn) return;
        btn.classList.add('is-submitting');
        window.setTimeout(() => btn.classList.remove('is-submitting'), 2500);
      });
    });
  }

  function closeMobileMenuOnEscape() {
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      document.body.classList.remove('mobile-menu-open');
      const driverMenu = document.getElementById('driver-mobile-nav');
      if (driverMenu) driverMenu.classList.remove('open');
    });
  }

  function boot() {
    document.documentElement.classList.add('scroll-smooth');
    document.body.classList.add('antialiased');
    enhanceButtons();
    addLoadingGuard();
    closeMobileMenuOnEscape();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
