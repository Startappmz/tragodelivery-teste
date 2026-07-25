/* TraGo Delivery · sistema visual partilhado para mapas não administrativos. */
(function (global) {
  'use strict';

  const TILE_URL = 'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
  const TILE_OPTIONS = Object.freeze({
    minZoom: 4,
    maxZoom: 20,
    keepBuffer: 2,
    updateWhenIdle: true,
    updateWhenZooming: false,
    attribution: '&copy; OpenStreetMap &copy; CARTO'
  });
  const ROAD_ROUTE_CACHE_LIMIT = 80;
  const ROAD_ROUTE_CACHE_TTL_MS = 10 * 60 * 1000;
  const roadRouteCache = new Map();

  const POINTS = Object.freeze({
    pickup: { icon: 'fa-store', fallback: 'Recolha' },
    delivery: { icon: 'fa-location-dot', fallback: 'Entrega' },
    driver: { icon: 'fa-motorcycle', fallback: 'Motorista' },
    partner: { icon: 'fa-shop', fallback: 'Parceiro' },
    stop: { icon: 'fa-circle-plus', fallback: 'Paragem' },
    current: { icon: 'fa-location-arrow', fallback: 'Você' }
  });

  function safeText(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    })[character]);
  }

  function addBaseLayer(map, options = {}) {
    if (!map || !global.L) return null;
    const layer = global.L.tileLayer(TILE_URL, { ...TILE_OPTIONS, ...options }).addTo(map);
    const container = map.getContainer?.();
    if (!container) return layer;
    let pendingTiles = 0;
    let errorTimer = null;
    let networkState = container.querySelector('.trago-map-network-state');
    if (!networkState) {
      networkState = document.createElement('div');
      networkState.className = 'trago-map-network-state';
      networkState.setAttribute('role', 'status');
      networkState.setAttribute('aria-live', 'polite');
      networkState.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i><span>A carregar mapa…</span><button type="button">Tentar novamente</button>';
      container.appendChild(networkState);
    }
    const label = networkState.querySelector('span');
    const retry = networkState.querySelector('button');
    const setState = (status, message = '') => {
      container.dataset.networkState = status;
      container.classList.toggle('is-map-loading', status === 'loading');
      container.classList.toggle('has-map-error', status === 'error' || status === 'offline');
      container.setAttribute('aria-busy', String(status === 'loading'));
      if (label && message) label.textContent = message;
      if (retry) retry.hidden = !['error', 'offline'].includes(status);
    };
    layer.on('loading', () => {
      pendingTiles += 1;
      clearTimeout(errorTimer);
      setState('loading', 'A carregar mapa…');
    });
    layer.on('load', () => {
      pendingTiles = Math.max(0, pendingTiles - 1);
      if (!pendingTiles) setState('ready', '');
    });
    layer.on('tileerror', () => {
      clearTimeout(errorTimer);
      errorTimer = setTimeout(() => setState(
        navigator.onLine === false ? 'offline' : 'error',
        navigator.onLine === false ? 'Sem ligação. Os dados do pedido continuam disponíveis.' : 'Não foi possível carregar o mapa.'
      ), 180);
    });
    retry?.addEventListener('click', () => {
      setState('loading', 'A tentar carregar o mapa…');
      layer.redraw?.();
    });
    const onOffline = () => setState('offline', 'Sem ligação. Os dados do pedido continuam disponíveis.');
    const onOnline = () => {
      setState('loading', 'Ligação recuperada. A actualizar mapa…');
      layer.redraw?.();
    };
    global.addEventListener?.('offline', onOffline);
    global.addEventListener?.('online', onOnline);
    map.once?.('unload', () => {
      global.removeEventListener?.('offline', onOffline);
      global.removeEventListener?.('online', onOnline);
      clearTimeout(errorTimer);
    });
    return layer;
  }

  function createCameraController(map, options = {}) {
    if (!map || !global.L) return null;
    let mode = 'initial-fit';
    let suppressUntil = 0;
    const listeners = new Set();
    const emit = () => listeners.forEach((listener) => listener(mode));
    const setMode = (nextMode) => {
      const safeMode = ['initial-fit', 'free', 'follow'].includes(nextMode) ? nextMode : 'free';
      if (mode === safeMode) return;
      mode = safeMode;
      map.getContainer?.().setAttribute('data-camera-mode', mode);
      emit();
    };
    const programmatic = (callback, nextMode = mode) => {
      suppressUntil = Date.now() + Number(options.suppressMs || 850);
      callback();
      setMode(nextMode);
    };
    const onUserGesture = () => {
      if (Date.now() >= suppressUntil) setMode('free');
    };
    map.on('dragstart zoomstart', onUserGesture);
    map.getContainer?.().setAttribute('data-camera-mode', mode);
    const pointArray = (points) => (Array.isArray(points) ? points : [])
      .map((point) => Array.isArray(point) ? point : [Number(point?.lat), Number(point?.lng)])
      .filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]));
    return {
      getMode: () => mode,
      isFree: () => mode === 'free',
      setMode,
      onModeChange(listener) {
        if (typeof listener === 'function') listeners.add(listener);
        return () => listeners.delete(listener);
      },
      fit(points, fitOptions = {}, control = {}) {
        const valid = pointArray(points);
        if (!valid.length) return false;
        const force = control.force === true;
        if (!force && mode === 'free') return false;
        const nextMode = control.mode || (force ? 'free' : mode);
        programmatic(() => {
          if (valid.length === 1) map.setView(valid[0], fitOptions.zoom || 16, { animate: fitOptions.animate !== false });
          else map.fitBounds(global.L.latLngBounds(valid), {
            paddingTopLeft: fitOptions.paddingTopLeft || [42, 42],
            paddingBottomRight: fitOptions.paddingBottomRight || [42, 100],
            maxZoom: fitOptions.maxZoom || 16,
            animate: fitOptions.animate !== false
          });
        }, nextMode);
        return true;
      },
      setView(point, zoom = 16, control = {}) {
        const valid = pointArray([point])[0];
        if (!valid || (!control.force && mode === 'free')) return false;
        programmatic(() => map.setView(valid, zoom, { animate: control.animate !== false }), control.mode || mode);
        return true;
      },
      follow(point, zoom = 17) {
        const valid = pointArray([point])[0];
        if (!valid) return false;
        programmatic(() => map.setView(valid, zoom, { animate: true }), 'follow');
        return true;
      },
      destroy() {
        map.off('dragstart zoomstart', onUserGesture);
        listeners.clear();
      }
    };
  }

  function observeMapSize(map) {
    const container = map?.getContainer?.();
    if (!container || typeof ResizeObserver === 'undefined') return null;
    let timer = null;
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => map.invalidateSize?.({ pan: false }), 80);
    });
    observer.observe(container);
    map.once?.('unload', () => {
      clearTimeout(timer);
      observer.disconnect();
    });
    return observer;
  }

  function createPointIcon(kind = 'delivery', label = '', options = {}) {
    if (!global.L) return null;
    const point = POINTS[kind] || POINTS.delivery;
    const visibleLabel = label || (!options.compact ? point.fallback : '');
    const classNames = [
      'trago-map-div-icon',
      `trago-map-div-icon--${kind}`,
      options.live ? 'is-live' : '',
      options.compact ? 'is-compact' : ''
    ].filter(Boolean).join(' ');
    return global.L.divIcon({
      className: classNames,
      html: `
        <span class="trago-map-pin ${kind}">
          ${options.live ? '<b class="trago-map-pin-pulse" aria-hidden="true"></b>' : ''}
          <i class="fa-solid ${point.icon}" aria-hidden="true"></i>
        </span>
        ${visibleLabel ? `<small>${safeText(visibleLabel)}</small>` : ''}
      `,
      iconSize: options.compact ? [38, 42] : [48, 58],
      iconAnchor: options.compact ? [19, 34] : [24, 45],
      popupAnchor: [0, options.compact ? -31 : -42]
    });
  }

  function partnerPoint(partner) {
    const source = partner?.address_coords || partner?.location || partner?.coords || partner;
    const coordinates = Array.isArray(source?.coordinates) ? source.coordinates : [];
    const lat = Number(source?.lat ?? source?.latitude ?? partner?.lat ?? coordinates[1]);
    const lng = Number(source?.lng ?? source?.longitude ?? partner?.lng ?? coordinates[0]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)
      || lat < -90 || lat > 90 || lng < -180 || lng > 180
      || (Math.abs(lat) < 0.000001 && Math.abs(lng) < 0.000001)) return null;
    return { lat, lng };
  }

  function routePoint(value) {
    const lat = Number(Array.isArray(value) ? value[0] : value?.lat);
    const lng = Number(Array.isArray(value) ? value[1] : value?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)
      || lat < -90 || lat > 90 || lng < -180 || lng > 180
      || (Math.abs(lat) < 0.000001 && Math.abs(lng) < 0.000001)) return null;
    return { lat, lng };
  }

  function validRoadRoute(route) {
    const coordinates = route?.geometry?.coordinates;
    return route?.geometry?.type === 'LineString'
      && Array.isArray(coordinates)
      && coordinates.length > 2
      && coordinates.every((point) => Array.isArray(point)
        && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1])));
  }

  async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 7000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const raw = await response.text();
      if (!raw) return null;
      try {
        return JSON.parse(raw);
      } catch (_) {
        return null;
      }
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchApiRoadRoute(origin, destination, options = {}) {
    const apiUrl = String(options.apiUrl || '').replace(/\/+$/, '');
    if (!apiUrl) return null;
    const path = options.path || '/api/public/geo/route';
    return fetchJsonWithTimeout(`${apiUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      body: JSON.stringify({ origin, destination })
    }, Number(options.apiTimeoutMs || options.timeoutMs || 5000));
  }

  async function fetchOsrmRoadRoute(origin, destination, options = {}) {
    const baseUrl = String(options.osrmUrl || 'https://router.project-osrm.org').replace(/\/+$/, '');
    const coordinates = `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
    const url = `${baseUrl}/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=false`;
    const providerTimeout = Math.min(5000, Number(options.timeoutMs || 5000));
    const data = await fetchJsonWithTimeout(url, { headers: { Accept: 'application/json' } }, providerTimeout);
    const route = data?.code === 'Ok' ? data.routes?.[0] : null;
    if (!validRoadRoute(route)) return null;
    return {
      geometry: route.geometry,
      distance_km: Number((Number(route.distance || 0) / 1000).toFixed(2)),
      duration_min: Math.max(1, Math.round(Number(route.duration || 0) / 60)),
      source: 'osrm'
    };
  }

  async function fetchRoadRoute(originValue, destinationValue, options = {}) {
    const origin = routePoint(originValue);
    const destination = routePoint(destinationValue);
    if (!origin || !destination) return null;
    const key = [origin.lat, origin.lng, destination.lat, destination.lng]
      .map((value) => Number(value).toFixed(5))
      .join(':');
    const cached = roadRouteCache.get(key);
    if (cached?.route && cached.expiresAt > Date.now()) return cached.route;
    if (cached?.promise) return cached.promise;
    if (cached) roadRouteCache.delete(key);

    const pending = (async () => {
      const apiRoute = await fetchApiRoadRoute(origin, destination, {
        ...options,
        apiTimeoutMs: Number(options.apiTimeoutMs || 4500)
      }).catch(() => null);
      if (validRoadRoute(apiRoute)) return apiRoute;

      const attempts = Math.max(1, Math.min(2, Number(options.attempts || 2)));
      const osrmUrls = [...new Set([
        options.osrmUrl,
        'https://router.project-osrm.org',
        'https://routing.openstreetmap.de/routed-car'
      ].filter(Boolean).map((value) => String(value).replace(/\/+$/, '')))];
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
        for (const osrmUrl of osrmUrls) {
          const osrmRoute = await fetchOsrmRoadRoute(origin, destination, { ...options, osrmUrl }).catch(() => null);
          if (validRoadRoute(osrmRoute)) return osrmRoute;
        }
      }
      return null;
    })();
    roadRouteCache.set(key, { promise: pending, expiresAt: 0 });
    while (roadRouteCache.size > ROAD_ROUTE_CACHE_LIMIT) {
      roadRouteCache.delete(roadRouteCache.keys().next().value);
    }
    try {
      const route = await pending;
      if (validRoadRoute(route)) {
        roadRouteCache.set(key, { route, expiresAt: Date.now() + ROAD_ROUTE_CACHE_TTL_MS });
        return route;
      }
      roadRouteCache.delete(key);
      return null;
    } catch (error) {
      roadRouteCache.delete(key);
      throw error;
    }
  }

  async function fetchRoadRouteSequence(values = [], options = {}) {
    const points = (Array.isArray(values) ? values : []).map(routePoint).filter(Boolean);
    if (points.length < 2) return null;
    const legs = await Promise.all(points.slice(0, -1).map((origin, index) =>
      fetchRoadRoute(origin, points[index + 1], options)
    ));
    if (legs.some((route) => !validRoadRoute(route))) return null;
    const coordinates = [];
    legs.forEach((route, index) => {
      const legCoordinates = route.geometry.coordinates;
      coordinates.push(...(index ? legCoordinates.slice(1) : legCoordinates));
    });
    return {
      geometry: { type: 'LineString', coordinates },
      distance_km: Number(legs.reduce((sum, route) => sum + Number(route.distance_km || 0), 0).toFixed(2)),
      duration_min: Math.max(1, Math.round(legs.reduce((sum, route) => sum + Number(route.duration_min || 0), 0))),
      source: legs.every((route) => route.source === legs[0]?.source) ? legs[0]?.source : 'road_route_sequence',
      legs
    };
  }

  function roadRouteLatLngs(route) {
    const coordinates = route?.geometry?.coordinates;
    if (!Array.isArray(coordinates)) return [];
    return coordinates
      .map((point) => [Number(point?.[1]), Number(point?.[0])])
      .filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]));
  }

  function syncPartnerLayer(map, partners = [], options = {}) {
    if (!map || !global.L) return null;
    if (!map._tragoPartnerPane) {
      const paneName = `trago-partners-${String(map._leaflet_id || Date.now())}`;
      const pane = map.createPane(paneName);
      pane.style.zIndex = String(options.zIndex || 475);
      pane.style.pointerEvents = 'auto';
      map._tragoPartnerPane = paneName;
    }
    if (!map._tragoPartnerLayer) map._tragoPartnerLayer = global.L.layerGroup().addTo(map);
    map._tragoPartnerLayer.clearLayers();
    const visible = (Array.isArray(partners) ? partners : [])
      .map((partner) => ({ partner, point: partnerPoint(partner) }))
      .filter((entry) => entry.point);
    visible.forEach(({ partner, point }) => {
      const name = String(partner.name || partner.nome || 'Parceiro TraGo');
      const address = String(partner.address_text || partner.address || partner.morada || '');
      const marker = global.L.marker(point, {
        pane: map._tragoPartnerPane,
        title: name,
        keyboard: true,
        icon: createPointIcon('partner', options.showLabels ? name : '', { compact: true })
      });
      marker.bindPopup(`<strong>${safeText(name)}</strong>${address ? `<br>${safeText(address)}` : ''}<br><small>Parceiro TraGo</small>`);
      marker.addTo(map._tragoPartnerLayer);
    });
    map.getContainer?.().setAttribute('data-partner-count', String(visible.length));
    return map._tragoPartnerLayer;
  }

  function addStatusControl(map, options = {}) {
    if (!map || !global.L) return null;
    const control = global.L.control({ position: options.position || 'topright' });
    let labelNode = null;
    control.onAdd = () => {
      const element = global.L.DomUtil.create('div', `trago-map-status-control ${options.tone ? `is-${options.tone}` : ''}`);
      element.innerHTML = `
        <i class="fa-solid ${safeText(options.icon || 'fa-location-dot')}" aria-hidden="true"></i>
        <span>${safeText(options.label || 'TraGo Mapas')}</span>
      `;
      labelNode = element.querySelector('span');
      global.L.DomEvent.disableClickPropagation(element);
      global.L.DomEvent.disableScrollPropagation(element);
      return element;
    };
    control.addTo(map);
    control.setLabel = (label) => {
      if (labelNode) labelNode.textContent = String(label || '');
    };
    return control;
  }

  function addZoomControl(map, position = 'bottomright') {
    if (!map || !global.L) return null;
    return global.L.control.zoom({ position }).addTo(map);
  }

  function addNavigationControl(map, options = {}) {
    if (!map || !global.L) return null;
    const actions = Array.isArray(options.actions) ? options.actions.filter(Boolean) : [];
    if (!actions.length) return null;
    const control = global.L.control({ position: options.position || 'topright' });
    const buttons = new Map();
    control.onAdd = () => {
      const group = global.L.DomUtil.create('div', 'trago-map-navigation-control');
      group.setAttribute('role', 'group');
      group.setAttribute('aria-label', options.label || 'Navegação do mapa');
      actions.forEach((action) => {
        const button = global.L.DomUtil.create('button', '', group);
        button.type = 'button';
        button.dataset.mapAction = String(action.id || '');
        button.setAttribute('aria-label', action.title || action.label || 'Acção do mapa');
        button.title = action.title || action.label || '';
        button.innerHTML = `<i class="fa-solid ${safeText(action.icon || 'fa-location-crosshairs')}" aria-hidden="true"></i>${action.label ? `<span>${safeText(action.label)}</span>` : ''}`;
        global.L.DomEvent.on(button, 'click', (event) => {
          global.L.DomEvent.stop(event);
          if (!button.disabled) action.onClick?.(map, button);
        });
        buttons.set(String(action.id || ''), button);
      });
      global.L.DomEvent.disableClickPropagation(group);
      global.L.DomEvent.disableScrollPropagation(group);
      return group;
    };
    control.addTo(map);
    control.setDisabled = (id, disabled) => {
      const button = buttons.get(String(id || ''));
      if (button) button.disabled = Boolean(disabled);
    };
    control.setActive = (id, active) => {
      const button = buttons.get(String(id || ''));
      if (!button) return;
      button.classList.toggle('is-active', Boolean(active));
      button.setAttribute('aria-pressed', String(Boolean(active)));
    };
    control.setLabel = (id, label, title = '') => {
      const button = buttons.get(String(id || ''));
      if (!button) return;
      const labelNode = button.querySelector('span');
      if (labelNode) labelNode.textContent = String(label || '');
      if (title) {
        button.title = title;
        button.setAttribute('aria-label', title);
      }
    };
    return control;
  }

  function drawRoute(target, points, options = {}) {
    if (!global.L || !target || !Array.isArray(points) || points.length < 2) {
      return { casing: null, line: null };
    }
    const weight = Number(options.weight || 6);
    const common = {
      lineCap: 'round',
      lineJoin: 'round',
      interactive: options.interactive !== false
    };
    const casing = global.L.polyline(points, {
      ...common,
      color: options.casingColor || '#ffffff',
      weight: weight + Number(options.casingWidth || 5),
      opacity: Number(options.casingOpacity ?? 0.95)
    }).addTo(target);
    const line = global.L.polyline(points, {
      ...common,
      color: options.color || '#69be35',
      weight,
      opacity: Number(options.opacity ?? 0.98),
      dashArray: options.dashArray || null,
      className: options.className || ''
    }).addTo(target);
    return { casing, line };
  }

  global.TragoMapUI = Object.freeze({
    TILE_URL,
    TILE_OPTIONS,
    addBaseLayer,
    createCameraController,
    addNavigationControl,
    addStatusControl,
    addZoomControl,
    createPointIcon,
    drawRoute,
    fetchRoadRoute,
    fetchRoadRouteSequence,
    observeMapSize,
    roadRouteLatLngs,
    syncPartnerLayer
  });
})(window);
