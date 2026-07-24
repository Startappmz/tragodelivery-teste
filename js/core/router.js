const DEFAULT_BASE = '/';

export function normalizePath(path = '/') {
  const value = String(path || '/').trim();
  const withoutOrigin = value.replace(/^https?:\/\/[^/]+/i, '');
  const [pathname] = withoutOrigin.split(/[?#]/);
  const normalized = `/${String(pathname || '').replace(/^\/+|\/+$/g, '')}`;
  return normalized === '/' ? '/' : normalized.replace(/\/{2,}/g, '/');
}

function escapePattern(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function compileRoute(pattern) {
  if (pattern === '*' || pattern === '/*') {
    return { keys: ['wildcard'], expression: /^\/?(.*)$/ };
  }

  const keys = [];
  const routePattern = `/${String(pattern || '').trim().replace(/^\/+|\/+$/g, '')}`;
  const parts = routePattern.split('/').filter(Boolean);
  const source = parts.map((part) => {
    if (part.startsWith(':')) {
      const optional = part.endsWith('?');
      const key = part.slice(1, optional ? -1 : undefined);
      if (!key) throw new TypeError(`Parâmetro de rota inválido em "${pattern}".`);
      keys.push(key);
      return optional ? '(?:/([^/]+))?' : '/([^/]+)';
    }
    return `/${escapePattern(part)}`;
  }).join('');

  return {
    keys,
    expression: new RegExp(`^${source || '/'}\/?$`, 'i')
  };
}

export function matchRoute(pattern, pathname) {
  const compiled = typeof pattern === 'string' ? compileRoute(pattern) : pattern;
  const match = compiled.expression.exec(normalizePath(pathname));
  if (!match) return null;

  return compiled.keys.reduce((params, key, index) => {
    const value = match[index + 1];
    params[key] = value == null ? undefined : decodeURIComponent(value);
    return params;
  }, {});
}

function toQuery(search = '') {
  return Object.fromEntries(new URLSearchParams(String(search).replace(/^\?/, '')).entries());
}

function getBrowserLocation(mode) {
  if (typeof window === 'undefined') return { pathname: '/', search: '', hash: '' };
  if (mode === 'hash') {
    const raw = window.location.hash.replace(/^#/, '') || '/';
    const [pathname, search = ''] = raw.split('?');
    return { pathname, search: search ? `?${search}` : '', hash: window.location.hash };
  }
  return window.location;
}

function stripBase(pathname, base) {
  const normalizedBase = normalizePath(base);
  const normalizedPath = normalizePath(pathname);
  if (normalizedBase === '/') return normalizedPath;
  return normalizedPath.startsWith(normalizedBase)
    ? normalizePath(normalizedPath.slice(normalizedBase.length))
    : normalizedPath;
}

export function createRouter(options = {}) {
  const mode = options.mode === 'history' ? 'history' : 'hash';
  const base = options.base || DEFAULT_BASE;
  const routes = (options.routes || []).map((route) => ({
    ...route,
    compiled: compileRoute(route.path)
  }));
  let current = null;
  let started = false;
  let navigationSequence = 0;

  const resolve = (location = getBrowserLocation(mode)) => {
    const pathname = stripBase(location.pathname || '/', base);
    for (const route of routes) {
      const params = matchRoute(route.compiled, pathname);
      if (params) {
        return {
          route,
          name: route.name || null,
          path: pathname,
          params,
          query: toQuery(location.search),
          search: location.search || ''
        };
      }
    }
    return { route: null, name: null, path: pathname, params: {}, query: toQuery(location.search), search: location.search || '' };
  };

  const dispatch = async () => {
    const sequence = ++navigationSequence;
    const next = resolve();
    const previous = current;

    try {
      if (next.route?.guard) {
        const guardResult = await next.route.guard(next, previous);
        if (sequence !== navigationSequence) return current;
        if (guardResult === false) return previous;
        if (typeof guardResult === 'string') return navigate(guardResult, { replace: true });
      }

      current = next;
      if (next.route?.handler) await next.route.handler(next, previous);
      else if (options.notFound) await options.notFound(next, previous);
      options.onChange?.(next, previous);
      return next;
    } catch (error) {
      options.onError?.(error, next);
      if (!options.onError) throw error;
      return next;
    }
  };

  const navigate = (target, navigationOptions = {}) => {
    if (typeof window === 'undefined') return resolve({ pathname: target, search: '' });
    const [pathname, search = ''] = String(target || '/').split('?');
    const normalized = normalizePath(pathname);
    const suffix = search ? `?${search}` : '';

    if (mode === 'hash') {
      const value = `#${normalized}${suffix}`;
      const isCurrent = window.location.hash === value;
      if (navigationOptions.replace) {
        window.history.replaceState(null, '', value);
        return dispatch();
      }
      if (isCurrent) return dispatch();
      window.location.hash = `${normalized}${suffix}`;
      return null;
    }

    const normalizedBase = normalizePath(base);
    const url = `${normalizedBase === '/' ? '' : normalizedBase}${normalized}${suffix}` || '/';
    window.history[navigationOptions.replace ? 'replaceState' : 'pushState'](navigationOptions.state || null, '', url);
    return dispatch();
  };

  const clickHandler = (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest?.('a[data-route]');
    if (!link || link.target || link.hasAttribute('download')) return;
    const href = link.getAttribute('href');
    if (!href || /^(mailto:|tel:|https?:\/\/)/i.test(href)) return;
    event.preventDefault();
    navigate(mode === 'hash' ? href.replace(/^#/, '') : href);
  };

  const start = () => {
    if (started || typeof window === 'undefined') return dispatch();
    started = true;
    window.addEventListener(mode === 'hash' ? 'hashchange' : 'popstate', dispatch);
    document.addEventListener('click', clickHandler);
    return dispatch();
  };

  const stop = () => {
    if (!started || typeof window === 'undefined') return;
    started = false;
    window.removeEventListener(mode === 'hash' ? 'hashchange' : 'popstate', dispatch);
    document.removeEventListener('click', clickHandler);
  };

  return Object.freeze({ start, stop, navigate, dispatch, resolve, getCurrent: () => current });
}
