(function (global) {
  'use strict';

  const VERSION = 3;
  const controllers = new Map();

  function readJson(storage, key, fallback) {
    try {
      const value = JSON.parse(storage.getItem(key) || 'null');
      return value && value.version === VERSION ? value : fallback;
    } catch {
      return fallback;
    }
  }

  function writeJson(storage, key, value) {
    try { storage.setItem(key, JSON.stringify({ version: VERSION, ...value })); } catch { /* storage can be unavailable */ }
  }

  function parseHash() {
    const match = global.location.hash.match(/(?:^#|&)view=([^&]+)/);
    if (!match) return '';
    try { return decodeURIComponent(match[1]); } catch { return ''; }
  }

  function create(options) {
    const role = String(options?.role || '').trim();
    const pages = new Set(options?.pages || []);
    const defaultPage = pages.has(options?.defaultPage) ? options.defaultPage : [...pages][0];
    const transientPages = new Set(options?.transientPages || []);
    const render = options?.render;
    const scope = String(options?.scope || '').trim();

    if (!role || !pages.size || typeof render !== 'function') {
      throw new Error('TragoNavigation: configuração inválida.');
    }

    const scopeSuffix = scope ? `:${encodeURIComponent(scope)}` : '';
    const localKey = `trago:navigation:${role}${scopeSuffix}:last`;
    const sessionKey = `trago:navigation:${role}${scopeSuffix}:session`;
    const sessionState = readJson(global.sessionStorage, sessionKey, { version: VERSION, scroll: {}, stack: [], current: '' });
    const localState = readJson(global.localStorage, localKey, { version: VERSION, page: defaultPage });
    let current = pages.has(options.getCurrent?.()) ? options.getCurrent() : defaultPage;
    let stack = Array.isArray(sessionState.stack)
      ? sessionState.stack.filter((page) => pages.has(page)).slice(-20)
      : [];
    let scroll = sessionState.scroll && typeof sessionState.scroll === 'object' ? sessionState.scroll : {};
    let restored = false;

    function persist() {
      writeJson(global.sessionStorage, sessionKey, { scroll, stack, current });
      if (!transientPages.has(current)) writeJson(global.localStorage, localKey, { page: current });
      try { global.localStorage.setItem('trago:last-portal', role); } catch { /* optional convenience */ }
    }

    function saveScroll(page = current) {
      if (!pages.has(page)) return;
      scroll[page] = Math.max(0, Math.round(global.scrollY || 0));
      persist();
    }

    function updateBrowserHistory(page, replace) {
      try {
        const url = new URL(global.location.href);
        url.hash = `view=${encodeURIComponent(page)}`;
        const state = { ...(global.history.state || {}), tragoNavigation: true, role, page };
        global.history[replace ? 'replaceState' : 'pushState'](state, '', url.href);
      } catch { /* file previews and embedded browsers may restrict History API */ }
    }

    function restorePosition(page, shouldRestore) {
      const top = shouldRestore ? Number(scroll[page] || 0) : 0;
      global.requestAnimationFrame(() => global.scrollTo({
        top: Math.max(0, top),
        behavior: 'auto'
      }));
    }

    function navigate(page, settings = {}) {
      const target = pages.has(page) ? page : defaultPage;
      const previous = current;
      const changed = target !== previous;

      if (settings.root) stack = [];
      if (changed) {
        saveScroll(previous);
        if (!settings.root && !settings.skipStack && pages.has(previous) && stack.at(-1) !== previous) {
          stack.push(previous);
          stack = stack.slice(-20);
        }
      }

      current = target;
      render(target, { previous, restored, changed, source: settings.source || 'app' });
      persist();

      if (!settings.skipBrowser && (changed || !restored)) updateBrowserHistory(target, Boolean(settings.replace || settings.root || !restored));
      restorePosition(target, settings.restoreScroll !== false && (settings.source === 'restore' || settings.source === 'history' || settings.source === 'back'));
      restored = true;
      return target;
    }

    function back(fallback) {
      saveScroll(current);
      let target = stack.pop();
      while (target === current) target = stack.pop();
      if (!pages.has(target)) target = pages.has(fallback) ? fallback : defaultPage;
      return navigate(target, { source: 'back', skipStack: true, replace: true });
    }

    function restore() {
      const browserPage = global.history.state?.role === role ? global.history.state.page : '';
      const hashPage = parseHash();
      const storedPage = localState.page;
      const target = [browserPage, hashPage, storedPage, defaultPage].find((page) => pages.has(page) && !transientPages.has(page)) || defaultPage;
      if (sessionState.current !== target) stack = [];
      return navigate(target, { source: 'restore', skipStack: true, replace: true });
    }

    function onPopState(event) {
      const state = event.state || {};
      const target = state.role === role && pages.has(state.page) ? state.page : parseHash();
      if (pages.has(target)) {
        stack = [];
        navigate(target, { source: 'history', skipStack: true, skipBrowser: true });
      }
    }

    function onSmartBack(event) {
      const button = event.target.closest?.('[data-smart-back]');
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      back(button.dataset.jumpPanel || button.dataset.driverNav || button.dataset.fallbackPanel || defaultPage);
    }

    global.addEventListener('popstate', onPopState);
    global.addEventListener('pagehide', () => saveScroll(current));
    document.addEventListener('click', onSmartBack, true);

    const controller = { navigate, back, restore, saveScroll, get current() { return current; } };
    controllers.set(role, controller);
    return controller;
  }

  global.TragoNavigation = {
    create,
    get(role) { return controllers.get(role); }
  };
})(window);
