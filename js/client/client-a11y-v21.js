(() => {
  'use strict';

  const focusableSelector = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
  ].join(',');

  const focusOrigins = new WeakMap();
  let observer = null;
  let syncFrame = 0;
  let pendingFlags = 0;

  const SYNC_PRESSED = 1;
  const SYNC_NAVIGATION = 2;
  const SYNC_DIALOGS = 4;
  const SYNC_CONTROLS = 8;
  const SYNC_ALL = SYNC_PRESSED | SYNC_NAVIGATION | SYNC_DIALOGS | SYNC_CONTROLS;

  function isVisible(element) {
    return Boolean(element && (element.offsetWidth || element.offsetHeight || element.getClientRects().length));
  }

  function setAttributeIfChanged(element, name, value) {
    if (element.getAttribute(name) !== value) element.setAttribute(name, value);
  }

  function syncPressed(root = document) {
    root.querySelectorAll([
      '.v20-quick-filters button',
      '.v20-category-scroll button',
      '[data-wishlist-tab]',
      '[data-order-tab]',
      '[data-auth-mode]',
      '[data-cargo-type]',
      '[data-vehicle]',
      '[data-payment]',
      '[data-cargo-schedule]',
      '[data-cart-schedule]',
      '.v20-banner-dots button'
    ].join(',')).forEach((button) => {
      setAttributeIfChanged(button, 'aria-pressed', button.classList.contains('active') ? 'true' : 'false');
    });
  }

  function syncNavigation() {
    document.querySelectorAll('.portal-tab, .mobile-bottom-nav button[data-panel]').forEach((button) => {
      if (button.classList.contains('active')) setAttributeIfChanged(button, 'aria-current', 'page');
      else if (button.hasAttribute('aria-current')) button.removeAttribute('aria-current');
    });

    document.querySelectorAll('.portal-panel').forEach((panel) => {
      setAttributeIfChanged(panel, 'aria-hidden', panel.classList.contains('hidden') ? 'true' : 'false');
    });
  }

  function openDialogs() {
    return [...document.querySelectorAll('.v20-sheet.open, .dish-detail-overlay:not(.hidden)')]
      .filter((dialog) => dialog.getAttribute('aria-hidden') !== 'true' && isVisible(dialog));
  }

  function setBackgroundInert(activeDialog) {
    const background = [
      document.querySelector('.v20-client-header'),
      document.querySelector('.v20-client-main'),
      document.querySelector('.v20-bottom-nav')
    ].filter(Boolean);

    background.forEach((element) => {
      const shouldBeInert = Boolean(activeDialog && !element.contains(activeDialog));
      element.toggleAttribute('inert', shouldBeInert);
    });
  }

  function focusDialog(dialog) {
    if (!dialog || focusOrigins.has(dialog)) return;
    focusOrigins.set(dialog, document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const candidates = [...dialog.querySelectorAll(focusableSelector)]
      .filter((element) => !element.matches('.v20-sheet-backdrop, .dish-detail-backdrop, .trago-feedback-backdrop'))
      .filter(isVisible);
    const preferred = candidates.find((element) => element.matches('[data-autofocus], input, select, textarea'))
      || candidates.find((element) => element.matches('[data-close-sheet], .dish-detail-close, [aria-label^="Fechar"]'))
      || candidates[0];
    window.setTimeout(() => {
      if (!document.contains(dialog) || dialog.getAttribute('aria-hidden') === 'true') return;
      (preferred || dialog).focus({ preventScroll: true });
    }, 0);
  }

  function restoreDialogFocus(dialog) {
    const origin = focusOrigins.get(dialog);
    focusOrigins.delete(dialog);
    if (origin && document.contains(origin) && isVisible(origin)) {
      window.setTimeout(() => origin.focus({ preventScroll: true }), 0);
    }
  }

  function syncDialogs() {
    const dialogs = openDialogs();
    const active = dialogs.at(-1) || null;

    document.querySelectorAll('.v20-sheet, .dish-detail-overlay').forEach((dialog) => {
      const open = dialogs.includes(dialog);
      setAttributeIfChanged(dialog, 'aria-hidden', open ? 'false' : 'true');
      if (open) focusDialog(dialog);
      else if (focusOrigins.has(dialog)) restoreDialogFocus(dialog);
    });

    setBackgroundInert(active);
  }

  function trapFocus(event) {
    if (event.key !== 'Tab') return;
    const dialog = openDialogs().at(-1);
    if (!dialog) return;
    const focusable = [...dialog.querySelectorAll(focusableSelector)].filter(isVisible);
    if (!focusable.length) {
      event.preventDefault();
      dialog.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function enhanceStaticControls(root = document) {
    const scope = root.querySelectorAll ? root : document;

    if (root instanceof HTMLButtonElement && !root.hasAttribute('type')) root.type = 'button';
    scope.querySelectorAll('button:not([type])').forEach((button) => {
      button.type = 'button';
    });

    if (root instanceof HTMLElement && root.matches('.v20-back:not([aria-label])')) {
      root.setAttribute('aria-label', 'Voltar');
    }
    scope.querySelectorAll('.v20-back:not([aria-label])').forEach((button) => {
      button.setAttribute('aria-label', 'Voltar');
    });

    scope.querySelectorAll('.leaflet-control-zoom a').forEach((control) => {
      if (!control.getAttribute('aria-label')) {
        control.setAttribute('aria-label', control.classList.contains('leaflet-control-zoom-in') ? 'Aumentar mapa' : 'Diminuir mapa');
      }
    });
  }

  function flushSync() {
    syncFrame = 0;
    const flags = pendingFlags;
    pendingFlags = 0;

    if (flags & SYNC_CONTROLS) enhanceStaticControls();
    if (flags & SYNC_PRESSED) syncPressed();
    if (flags & SYNC_NAVIGATION) syncNavigation();
    if (flags & SYNC_DIALOGS) syncDialogs();
  }

  function scheduleSync(flags) {
    pendingFlags |= flags;
    if (syncFrame) return;
    syncFrame = window.requestAnimationFrame(flushSync);
  }

  function handleMutations(mutations) {
    let flags = 0;

    mutations.forEach((mutation) => {
      if (mutation.type === 'attributes') {
        const target = mutation.target;
        if (target.matches?.('button, .portal-tab, .portal-panel')) {
          flags |= SYNC_PRESSED | SYNC_NAVIGATION;
        }
        if (target.matches?.('.v20-sheet, .dish-detail-overlay')) flags |= SYNC_DIALOGS;
      } else if (mutation.type === 'childList') {
        flags |= SYNC_ALL;
      }
    });

    if (flags) scheduleSync(flags);
  }

  function init() {
    enhanceStaticControls();
    syncPressed();
    syncNavigation();
    syncDialogs();

    observer = new MutationObserver(handleMutations);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['class'],
      childList: true,
      subtree: true
    });
  }

  document.addEventListener('keydown', trapFocus);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
