(function (global) {
  'use strict';

  const VERSION = 5;
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

  function normaliseContext(context) {
    if (!context || typeof context !== 'object') return {};
    return Object.fromEntries(Object.entries(context)
      .filter(([key, value]) => key && value !== null && value !== undefined && String(value).trim() !== '')
      .slice(0, 10)
      .map(([key, value]) => [String(key).slice(0, 40), String(value).slice(0, 220)]));
  }

  function parseHashState() {
    try {
      const params = new URLSearchParams(String(global.location.hash || '').replace(/^#/, ''));
      const page = String(params.get('view') || '');
      const context = {};
      params.forEach((value, key) => {
        if (key !== 'view') context[key] = value;
      });
      return { page, context: normaliseContext(context) };
    } catch {
      return { page: '', context: {} };
    }
  }

  function normaliseStackEntry(entry, pages, transientPages) {
    const raw = typeof entry === 'string' ? { page: entry, context: {} } : entry;
    const page = String(raw?.page || '');
    if (!pages.has(page) || transientPages.has(page)) return null;
    return { page, context: normaliseContext(raw?.context) };
  }

  function create(options) {
    const role = String(options?.role || '').trim();
    const pages = new Set(options?.pages || []);
    const defaultPage = pages.has(options?.defaultPage) ? options.defaultPage : [...pages][0];
    const transientPages = new Set(options?.transientPages || []);
    const restorablePages = new Set(options?.restorablePages || [...pages].filter((page) => !transientPages.has(page)));
    const deepLinkPages = new Set(options?.deepLinkPages || [...restorablePages]);
    const render = options?.render;
    const scope = String(options?.scope || '').trim();
    const validateContext = typeof options?.validateContext === 'function' ? options.validateContext : () => true;
    const applyContext = typeof options?.applyContext === 'function' ? options.applyContext : () => {};
    const getContext = typeof options?.getContext === 'function' ? options.getContext : () => ({});
    const fallbackFor = typeof options?.fallbackFor === 'function' ? options.fallbackFor : () => defaultPage;

    if (!role || !pages.size || typeof render !== 'function') {
      throw new Error('TragoNavigation: configuração inválida.');
    }

    controllers.get(role)?.destroy?.();

    const scopeSuffix = scope ? `:${encodeURIComponent(scope)}` : '';
    const localKey = `trago:navigation:${role}${scopeSuffix}:last`;
    const sessionKey = `trago:navigation:${role}${scopeSuffix}:session`;
    const sessionState = readJson(global.sessionStorage, sessionKey, { version: VERSION, scroll: {}, stack: [], current: '', context: {} });
    const localState = readJson(global.localStorage, localKey, { version: VERSION, page: defaultPage, context: {} });
    let current = pages.has(options.getCurrent?.()) ? options.getCurrent() : defaultPage;
    let currentContext = normaliseContext(sessionState.context);
    let stack = Array.isArray(sessionState.stack)
      ? sessionState.stack.map((entry) => normaliseStackEntry(entry, pages, transientPages)).filter(Boolean).slice(-20)
      : [];
    let scroll = sessionState.scroll && typeof sessionState.scroll === 'object' ? sessionState.scroll : {};
    let restored = false;

    function contextKey(page, context = {}) {
      const id = context.id || context.order || context.item || '';
      return id ? `${page}:${id}` : page;
    }

    function isValidTarget(page, context = {}) {
      return pages.has(page) && validateContext(page, normaliseContext(context)) !== false;
    }

    function resolveTarget(page, context = {}) {
      const target = pages.has(page) ? page : defaultPage;
      const safeContext = normaliseContext(context);
      if (isValidTarget(target, safeContext)) return { page: target, context: safeContext };
      const fallback = pages.has(fallbackFor(target, safeContext)) ? fallbackFor(target, safeContext) : defaultPage;
      return { page: fallback, context: {} };
    }

    function persist() {
      writeJson(global.sessionStorage, sessionKey, { scroll, stack, current, context: currentContext });
      if (restorablePages.has(current) && isValidTarget(current, currentContext)) {
        writeJson(global.localStorage, localKey, { page: current, context: currentContext });
      }
      try { global.localStorage.setItem('trago:last-portal', role); } catch { /* optional convenience */ }
    }

    function saveScroll(page = current, context = currentContext) {
      if (!pages.has(page)) return;
      scroll[contextKey(page, context)] = Math.max(0, Math.round(global.scrollY || 0));
      persist();
    }

    function updateBrowserHistory(page, context, replace) {
      try {
        const url = new URL(global.location.href);
        const params = new URLSearchParams({ view: page });
        Object.entries(normaliseContext(context)).forEach(([key, value]) => params.set(key, value));
        url.hash = params.toString();
        const state = { ...(global.history.state || {}), tragoNavigation: true, role, page, context: normaliseContext(context) };
        global.history[replace ? 'replaceState' : 'pushState'](state, '', url.href);
      } catch { /* file previews and embedded browsers may restrict History API */ }
    }

    function restorePosition(page, context, shouldRestore) {
      const top = shouldRestore ? Number(scroll[contextKey(page, context)] || 0) : 0;
      global.requestAnimationFrame(() => global.scrollTo({
        top: Math.max(0, top),
        behavior: 'auto'
      }));
    }

    function navigate(page, settings = {}) {
      const requestedContext = settings.context !== undefined
        ? settings.context
        : (page === current ? currentContext : getContext(page));
      const resolvedTarget = resolveTarget(page, requestedContext);
      const target = resolvedTarget.page;
      const targetContext = resolvedTarget.context;
      const previous = current;
      const previousContext = currentContext;
      const changed = target !== previous || JSON.stringify(targetContext) !== JSON.stringify(previousContext);

      if (settings.root) stack = [];
      if (changed) {
        saveScroll(previous, previousContext);
        if (!settings.root && !settings.skipStack && pages.has(previous) && !transientPages.has(previous)) {
          const previousEntry = { page: previous, context: previousContext };
          const last = stack.at(-1);
          if (!last || last.page !== previousEntry.page || JSON.stringify(last.context) !== JSON.stringify(previousEntry.context)) {
            stack.push(previousEntry);
            stack = stack.slice(-20);
          }
        }
      }

      current = target;
      currentContext = targetContext;
      applyContext(target, targetContext, { previous, previousContext, source: settings.source || 'app' });
      render(target, { previous, previousContext, context: targetContext, restored, changed, source: settings.source || 'app' });
      persist();

      if (!settings.skipBrowser && (changed || !restored)) {
        const replaceBrowserEntry = Boolean(settings.replace || settings.root || !restored || transientPages.has(previous));
        updateBrowserHistory(target, targetContext, replaceBrowserEntry);
      }
      restorePosition(target, targetContext, settings.restoreScroll !== false && ['restore', 'history', 'back'].includes(settings.source));
      restored = true;
      return target;
    }

    function back(fallback) {
      saveScroll(current, currentContext);
      let entry = stack.pop();
      while (entry && entry.page === current && JSON.stringify(entry.context) === JSON.stringify(currentContext)) entry = stack.pop();
      const fallbackTarget = resolveTarget(pages.has(fallback) ? fallback : defaultPage, {});
      const target = entry && isValidTarget(entry.page, entry.context) ? entry : fallbackTarget;
      return navigate(target.page, { source: 'back', context: target.context, skipStack: true, replace: true });
    }

    function restore() {
      const browser = global.history.state?.role === role
        ? { page: global.history.state.page, context: normaliseContext(global.history.state.context) }
        : { page: '', context: {} };
      const hash = parseHashState();
      const stored = { page: localState.page, context: normaliseContext(localState.context) };
      const candidates = [
        { ...browser, allowed: deepLinkPages.has(browser.page) },
        { ...hash, allowed: deepLinkPages.has(hash.page) },
        { ...stored, allowed: restorablePages.has(stored.page) },
        { page: defaultPage, context: {}, allowed: true }
      ];
      const target = candidates.find((candidate) => (
        candidate.allowed
        && pages.has(candidate.page)
        && !transientPages.has(candidate.page)
        && isValidTarget(candidate.page, candidate.context)
      )) || { page: defaultPage, context: {} };
      if (sessionState.current !== target.page || JSON.stringify(sessionState.context || {}) !== JSON.stringify(target.context || {})) stack = [];
      return navigate(target.page, { source: 'restore', context: target.context, skipStack: true, replace: true });
    }

    function onPopState(event) {
      const state = event.state || {};
      const hash = parseHashState();
      const candidate = state.role === role
        ? { page: state.page, context: normaliseContext(state.context) }
        : hash;
      const target = resolveTarget(candidate.page, candidate.context);
      stack = [];
      navigate(target.page, { source: 'history', context: target.context, skipStack: true, skipBrowser: true });
    }

    function onSmartBack(event) {
      const button = event.target.closest?.('[data-smart-back]');
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      back(button.dataset.jumpPanel || button.dataset.driverNav || button.dataset.fallbackPanel || defaultPage);
    }

    function onPageHide() { saveScroll(current, currentContext); }

    function destroy() {
      global.removeEventListener('popstate', onPopState);
      global.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('click', onSmartBack, true);
      if (controllers.get(role) === controller) controllers.delete(role);
    }

    global.addEventListener('popstate', onPopState);
    global.addEventListener('pagehide', onPageHide);
    document.addEventListener('click', onSmartBack, true);

    const controller = {
      navigate,
      back,
      restore,
      saveScroll,
      destroy,
      get current() { return current; },
      get context() { return { ...currentContext }; }
    };
    controllers.set(role, controller);
    return controller;
  }

  global.TragoNavigation = {
    create,
    get(role) { return controllers.get(role); }
  };
})(window);
