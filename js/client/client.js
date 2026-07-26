/* Trago Delivery · Portal do Cliente */
(() => {
  const SESSION_KEY = 'tragoClientSession';
  const ORDER_HISTORY_KEY = 'tragoClientOrderHistory';
  const LOCAL_RATINGS_KEY = 'tragoClientFoodRatings';
  const FAVORITES_KEY = 'tragoV20Favorites';
  const CART_KEY = 'tragoClientFoodCart';
  const currency = new Intl.NumberFormat('pt-MZ', { style: 'currency', currency: 'MZN' });
  const PRICING_POLICY = Object.freeze({ baseDistanceKm: 11.6, baseFeeMzn: 200, extraKmFeeMzn: 15 });
  const CURRENT_LOCATION_KEY = 'tragoClientCurrentLocationV1';

  const state = {
    session: null,
    activePanel: 'home',
    selectedCategory: 'all',
    selectedRatings: {},
    selectedDishId: null,
    selectedRestaurantId: null,
    lastPanelBeforeDish: 'food',
    addressSearchCache: new Map(),
    addressSearchControllers: new Map(),
    map: null,
    mapStatusControl: null,
    mapNavigationControl: null,
    mapCamera: null,
    mapUserMarker: null,
    mapAccuracyCircle: null,
    partnersUserMarker: null,
    partnersAccuracyCircle: null,
    routeCasing: null,
    routeLine: null,
    routeAbortController: null,
    routeRenderId: 0,
    routeGeometryCache: new Map(),
    reverseAbortController: null,
    reverseTimer: null,
    mapDraft: null,
    mapDraftLayer: null,
    mapDraftRouteLayer: null,
    mapDraftHistory: [],
    mapDraftPartnerSnapshot: null,
    mode: 'pickup',
    pickupMarker: null,
    deliveryMarker: null,
    stopMarker: null,
    foodDeliveryMarker: null,
    pickupCoords: null,
    deliveryCoords: null,
    stopCoords: null,
    foodDeliveryCoords: null,
    deliveryQuote: null,
    foodQuote: null,
    catalogLocation: null,
    catalogCoupons: [],
    mapContext: 'delivery-route',
    restaurants: [],
    restaurantsLoaded: false,
    partners: [],
    partnersLoaded: false,
    partnersMap: null,
    partnersMarkers: null,
    partnersNavigationControl: null,
    partnersCamera: null,
    partnersHasInitialFit: false,
    partnersVisible: [],
    selectedPartnerMapKey: '',
    partnersPoints: [],
    partnerType: 'all',
    selectedPartnerId: null,
    cargoSourceType: '',
    mapTarget: null,
    cart: [],
    appliedCoupon: null,
    orderHistoryFilter: 'active',
    directoryQuickFilters: [],
    directoryFavoritesOnly: false,
    directoryMinRating: 0,
    directorySort: 'recommended',
    bottleCategory: 'all'
  };
  let panelNavigation = null;
  let sessionOwnerScope = '';

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));
  const money = (value) => currency.format(Number(value || 0));
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
  const parseCoordinate = (value, min, max) => {
    if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
  };
  const normaliseCoord = (coord) => {
    if (!coord || typeof coord !== 'object') return null;
    const lat = parseCoordinate(coord.lat, -90, 90);
    const lng = parseCoordinate(coord.lng, -180, 180);
    if (lat === null || lng === null || (Math.abs(lat) < 0.000001 && Math.abs(lng) < 0.000001)) return null;
    return { lat, lng };
  };
  const isValidCoord = (coord) => Boolean(normaliseCoord(coord));

  function clientMapIcon(kind, label = '', options = {}) {
    if (window.TragoMapUI?.createPointIcon) {
      return window.TragoMapUI.createPointIcon(kind, label, options);
    }
    const icon = kind === 'driver' ? 'fa-motorcycle'
      : kind === 'pickup' ? 'fa-store'
        : kind === 'partner' ? 'fa-shop'
          : kind === 'stop' ? 'fa-circle-plus'
            : 'fa-location-dot';
    return L.divIcon({
      className: `trago-map-div-icon trago-map-div-icon--${kind}`,
      html: `<span class="trago-map-pin ${kind}"><i class="fa-solid ${icon}"></i></span>${label ? `<small>${escapeHtml(label)}</small>` : ''}`,
      iconSize: [48, 58],
      iconAnchor: [24, 45],
      popupAnchor: [0, -42]
    });
  }

  function addClientBaseMap(map, options = {}) {
    if (window.TragoMapUI?.addBaseLayer) return window.TragoMapUI.addBaseLayer(map, options);
    return L.tileLayer('https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      maxZoom: 20,
      keepBuffer: 2,
      updateWhenZooming: false,
      attribution: '&copy; OpenStreetMap &copy; CARTO',
      ...options
    }).addTo(map);
  }

  function focusMapPoints(map, points = [], options = {}) {
    if (!map || !window.L) return false;
    const validPoints = points
      .map((point) => Array.isArray(point) ? point : (isValidCoord(point) ? [Number(point.lat), Number(point.lng)] : null))
      .filter((point) => Array.isArray(point)
        && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1]))
        && Number(point[0]) >= -90 && Number(point[0]) <= 90
        && Number(point[1]) >= -180 && Number(point[1]) <= 180
        && !(Math.abs(Number(point[0])) < 0.000001 && Math.abs(Number(point[1])) < 0.000001));
    if (!validPoints.length) return false;
    const camera = options.camera || map._tragoCamera;
    if (camera?.fit) return camera.fit(validPoints, options, { force: options.force === true, mode: options.mode });
    if (validPoints.length === 1) map.setView(validPoints[0], options.zoom || 16, { animate: true });
    else map.fitBounds(L.latLngBounds(validPoints), {
      paddingTopLeft: options.paddingTopLeft || [42, 42],
      paddingBottomRight: options.paddingBottomRight || [42, 100],
      maxZoom: options.maxZoom || 16,
      animate: true
    });
    return true;
  }

  function focusClientRoute() {
    const points = mapDraftPoints();
    if (focusMapPoints(state.map, points, { camera: state.mapCamera, force: true, mode: 'free', paddingBottomRight: [42, 118] })) return;
    const selected = activeDraftPoint();
    if (isValidCoord(selected)) state.mapCamera?.setView(selected, 16, { force: true, mode: 'free' });
    else state.mapCamera?.setView([-25.9655, 32.5832], 12, { force: true, mode: 'free' });
  }

  function focusSelectedMapPoint() {
    const target = singleMapTarget() || state.mode;
    const draftTarget = state.mapContext === 'food-delivery' ? 'food-delivery' : target;
    const selected = state.mapDraft?.points?.[draftTarget]
      || (target === 'pickup' ? state.pickupCoords
        : target === 'stop' ? state.stopCoords
          : state.mapContext === 'food-delivery' ? state.foodDeliveryCoords
            : state.deliveryCoords);
    if (isValidCoord(selected)) {
      state.mapCamera?.setView(selected, 17, { force: true, mode: 'free' });
      return;
    }
    focusClientRoute();
  }

  function focusBrowserLocation(map, markerKey = 'mapUserMarker') {
    if (!map || !navigator.geolocation) {
      toast('A localização não está disponível neste dispositivo.', 'error');
      return;
    }
    const container = map.getContainer?.();
    container?.classList.add('is-locating');
    container?.setAttribute('aria-busy', 'true');
    navigator.geolocation.getCurrentPosition((position) => {
      const point = [Number(position.coords.latitude), Number(position.coords.longitude)];
      if (state[markerKey]) state[markerKey].setLatLng(point);
      else {
        state[markerKey] = L.marker(point, {
          icon: clientMapIcon('current', 'Você', { live: true, compact: true }),
          keyboard: false,
          zIndexOffset: 1100
        }).addTo(map);
      }
      const circleKey = markerKey === 'partnersUserMarker' ? 'partnersAccuracyCircle' : 'mapAccuracyCircle';
      const accuracy = Math.max(0, Number(position.coords.accuracy || 0));
      if (state[circleKey]) state[circleKey].setLatLng(point).setRadius(accuracy);
      else if (accuracy) state[circleKey] = L.circle(point, {
        radius: accuracy, color: '#2589ff', weight: 1, opacity: 0.5,
        fillColor: '#2589ff', fillOpacity: 0.1, interactive: false
      }).addTo(map);
      const camera = markerKey === 'partnersUserMarker' ? state.partnersCamera : state.mapCamera;
      if (camera?.setView) camera.setView(point, Math.max(map.getZoom?.() || 15, 16), { force: true, mode: 'free' });
      else map.setView(point, Math.max(map.getZoom?.() || 15, 16), { animate: true });
      container?.classList.remove('is-locating');
      container?.setAttribute('aria-busy', 'false');
    }, () => toast('Não foi possível obter a sua localização.', 'error'), {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 15000
    });
  }

  function toast(message, type = 'success') {
    if (window.TragoFeedback) {
      window.TragoFeedback.notify(message, { type: type === 'error' ? 'error' : type || 'success' });
      return;
    }
    const el = $('#portal-toast');
    if (!el) {
      console[type === 'error' ? 'error' : 'info'](`[TraGo] ${message}`);
      return;
    }
    el.textContent = message;
    el.className = `portal-toast ${type} show`;
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => el.classList.remove('show'), 3800);
  }

  function readSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
  }

  function clientStorageKey(base) {
    const session = state.session || readSession();
    const identity = String(session?.id || session?._id || 'guest');
    return `${base}:${encodeURIComponent(identity)}`;
  }
  window.TragoClientStorageKey = clientStorageKey;

  function readLocalRatings() {
    try { return JSON.parse(localStorage.getItem(clientStorageKey(LOCAL_RATINGS_KEY)) || '{}'); } catch { return {}; }
  }

  function restoreCart() {
    try {
      const saved = JSON.parse(localStorage.getItem(clientStorageKey(CART_KEY)) || '[]');
      state.cart = (Array.isArray(saved) ? saved : []).slice(0, 40).filter((entry) => (
        entry?.item?.id
        && entry?.restaurant?.id
        && Number.isFinite(Number(entry?.item?.price))
        && Number(entry?.qty) > 0
      )).map((entry) => ({
        item: entry.item,
        restaurant: entry.restaurant,
        qty: Math.max(1, Math.min(99, Math.round(Number(entry.qty)))),
        selectedOptions: Array.isArray(entry.selectedOptions) ? entry.selectedOptions : []
      }));
    } catch {
      state.cart = [];
      localStorage.removeItem(clientStorageKey(CART_KEY));
    }
  }

  function persistCart() {
    if (!state.cart.length) {
      localStorage.removeItem(clientStorageKey(CART_KEY));
      return;
    }
    const compact = state.cart.map((entry) => ({
      item: {
        id: entry.item.id,
        name: entry.item.name,
        price: Number(entry.item.price || 0),
        base_price: Number(entry.item.base_price ?? entry.item.price ?? 0),
        category: entry.item.category || 'Geral',
        description: entry.item.description || ''
      },
      restaurant: {
        id: entry.restaurant.id,
        name: entry.restaurant.name,
        phone: entry.restaurant.phone || '',
        address_text: entry.restaurant.address_text || '',
        address_coords: entry.restaurant.address_coords || null,
        is_open: entry.restaurant.is_open !== false,
        min_order_amount: Number(entry.restaurant.min_order_amount || 0)
      },
      qty: entry.qty,
      selectedOptions: entry.selectedOptions || []
    }));
    localStorage.setItem(clientStorageKey(CART_KEY), JSON.stringify(compact));
  }

  function reconcileCartWithRestaurants() {
    if (!state.cart.length || !state.restaurants.length) return;
    const previousLength = state.cart.length;
    state.cart = state.cart.flatMap((entry) => {
      const restaurant = state.restaurants.find((candidate) => String(candidate.id) === String(entry.restaurant.id));
      const item = restaurant?.menuItems?.find((candidate) => String(candidate.id) === String(entry.item.id));
      if (!restaurant || !item || item.available === false) return [];
      const optionPrice = (entry.selectedOptions || []).reduce((sum, option) => sum + Number(option.price || 0), 0);
      return [{
        ...entry,
        restaurant,
        item: {
          ...item,
          base_price: Number(item.price || 0),
          price: Number(item.price || 0) + optionPrice
        }
      }];
    });
    if (state.cart.length !== previousLength) toast('O cesto foi actualizado porque um produto deixou de estar disponível.', 'info');
    renderCart();
  }

  function saveLocalRating(key, rating) {
    state.selectedRatings[key] = Number(rating);
    localStorage.setItem(clientStorageKey(LOCAL_RATINGS_KEY), JSON.stringify(state.selectedRatings));
  }

  let clientNotificationsRequest = null;
  let clientNotificationsFetchedAt = 0;
  let clientNotificationsHydrated = false;
  let notificationOwnerScope = '';
  let notificationOwnerVersion = 0;
  let notificationRequestController = null;
  let notificationRequestFilter = '';
  let notificationQueuedFetch = null;
  let notificationSwipe = null;
  let notificationClickBlockedUntil = 0;
  let notificationPaintDeferred = false;
  let notificationQueueProcessing = false;
  let notificationQueueTimer = 0;
  let notificationPollTimer = 0;
  let notificationUndo = null;
  let notificationFilter = 'all';
  let notificationLastError = '';
  const notificationStore = new Map();
  const notificationViews = { all: [], unread: [] };
  const notificationMeta = {
    all: { total: 0, totalUnread: 0, hasMore: false, nextCursor: '' },
    unread: { total: 0, totalUnread: 0, hasMore: false, nextCursor: '' }
  };
  const CLIENT_NOTIFICATIONS_MIN_REFRESH_MS = 15000;
  const CLIENT_NOTIFICATIONS_POLL_MS = 60000;
  const CLIENT_NOTIFICATIONS_PAGE_SIZE = 30;
  const CLIENT_NOTIFICATIONS_CACHE_KEY = 'tragoClientNotificationsCacheV2';
  const CLIENT_NOTIFICATIONS_PENDING_KEY = 'tragoClientNotificationPendingOpsV2';
  const CLIENT_NOTIFICATIONS_MAX_CACHE = 240;
  const CLIENT_NOTIFICATION_UNDO_MS = 5000;

  function notificationCacheKey() {
    return clientStorageKey(CLIENT_NOTIFICATIONS_CACHE_KEY);
  }

  function notificationPendingKey() {
    return clientStorageKey(CLIENT_NOTIFICATIONS_PENDING_KEY);
  }

  function currentNotificationOwnerScope() {
    const session = state.session || readSession();
    return String(session?.id || session?._id || 'guest');
  }

  function ensureNotificationOwner() {
    const owner = currentNotificationOwnerScope();
    if (notificationOwnerScope === owner) return owner;
    notificationOwnerScope = owner;
    notificationOwnerVersion += 1;
    notificationRequestController?.abort?.();
    notificationRequestController = null;
    clientNotificationsRequest = null;
    notificationRequestFilter = '';
    notificationQueuedFetch = null;
    clientNotificationsFetchedAt = 0;
    clientNotificationsHydrated = false;
    notificationLastError = '';
    notificationStore.clear();
    notificationViews.all = [];
    notificationViews.unread = [];
    Object.assign(notificationMeta.all, { total: 0, totalUnread: 0, hasMore: false, nextCursor: '' });
    Object.assign(notificationMeta.unread, { total: 0, totalUnread: 0, hasMore: false, nextCursor: '' });
    if (notificationUndo) {
      clearTimeout(notificationUndo.timer);
      notificationUndo = null;
      document.getElementById('client-notification-undo')?.classList.remove('show');
    }
    return owner;
  }

  function normaliseClientNotification(item) {
    if (!item || typeof item !== 'object') return null;
    const id = String(item.id || item._id || '').trim();
    if (!id) return null;
    return {
      id,
      order_id: item.order_id ? String(item.order_id) : '',
      type: String(item.type || 'info'),
      title: String(item.title || 'Actualização'),
      message: String(item.message || ''),
      payload: item.payload && typeof item.payload === 'object' ? item.payload : {},
      read_at: item.read_at || null,
      created_at: item.created_at || new Date().toISOString(),
      updated_at: item.updated_at || item.created_at || new Date().toISOString()
    };
  }

  function normaliseNotificationMeta(value = {}) {
    return {
      total: Math.max(0, Number(value.total || 0)),
      totalUnread: Math.max(0, Number(value.totalUnread || value.total_unread || 0)),
      hasMore: Boolean(value.hasMore ?? value.has_more),
      nextCursor: String(value.nextCursor || value.next_cursor || '')
    };
  }

  function readNotificationPendingOps() {
    try {
      const parsed = JSON.parse(localStorage.getItem(notificationPendingKey()) || '[]');
      return (Array.isArray(parsed) ? parsed : []).filter((operation) => (
        operation && ['read', 'read_all', 'delete'].includes(operation.type) && String(operation.id || '').trim()
      )).slice(-500);
    } catch {
      return [];
    }
  }

  function writeNotificationPendingOps(operations) {
    try { localStorage.setItem(notificationPendingKey(), JSON.stringify(operations.slice(-500))); } catch { /* fila opcional */ }
  }

  function upsertNotificationOperation(operation) {
    const operations = readNotificationPendingOps();
    const key = `${operation.type}:${operation.id}`;
    let filtered = operations.filter((entry) => `${entry.type}:${entry.id}` !== key);
    if (operation.type === 'read_all') filtered = filtered.filter((entry) => entry.type !== 'read');
    if (operation.type === 'read' && filtered.some((entry) => entry.type === 'read_all')) return;
    filtered.push({
      attempts: 0,
      createdAt: Date.now(),
      executeAt: Date.now(),
      ...operation,
      id: String(operation.id)
    });
    writeNotificationPendingOps(filtered);
    scheduleNotificationQueue();
    updateNotificationSyncStatus();
  }

  function removeNotificationOperation(type, id) {
    const operations = readNotificationPendingOps();
    const next = operations.filter((entry) => !(entry.type === type && String(entry.id) === String(id)));
    if (next.length !== operations.length) writeNotificationPendingOps(next);
    updateNotificationSyncStatus();
  }

  function pendingNotificationOperation(type, id) {
    return readNotificationPendingOps().find((entry) => entry.type === type && String(entry.id) === String(id)) || null;
  }

  function applyNotificationPendingState(items) {
    const operations = readNotificationPendingOps();
    const readAll = operations.some((entry) => entry.type === 'read_all');
    const readIds = new Set(operations.filter((entry) => entry.type === 'read').map((entry) => String(entry.id)));
    const deletedIds = new Set(operations.filter((entry) => entry.type === 'delete').map((entry) => String(entry.id)));
    return items
      .filter((item) => !deletedIds.has(String(item.id)))
      .map((item) => (readAll || readIds.has(String(item.id))) && !item.read_at
        ? { ...item, read_at: item.updated_at || new Date().toISOString() }
        : item);
  }

  function currentNotificationIds() {
    return notificationViews[notificationFilter] || [];
  }

  function currentNotificationItems() {
    return currentNotificationIds().map((id) => notificationStore.get(String(id))).filter(Boolean);
  }

  function persistClientNotifications() {
    try {
      const items = [...notificationStore.values()]
        .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
        .slice(0, CLIENT_NOTIFICATIONS_MAX_CACHE);
      const allowedIds = new Set(items.map((item) => String(item.id)));
      const views = {
        all: notificationViews.all.filter((id) => allowedIds.has(String(id))),
        unread: notificationViews.unread.filter((id) => allowedIds.has(String(id)))
      };
      localStorage.setItem(notificationCacheKey(), JSON.stringify({
        version: 2,
        fetchedAt: clientNotificationsFetchedAt,
        items,
        views,
        meta: notificationMeta
      }));
    } catch { /* cache opcional */ }
  }

  function hydrateClientNotifications() {
    ensureNotificationOwner();
    if (clientNotificationsHydrated) return;
    clientNotificationsHydrated = true;
    try {
      const parsed = JSON.parse(localStorage.getItem(notificationCacheKey()) || 'null');
      if (!parsed || parsed.version !== 2 || !Array.isArray(parsed.items)) return;
      applyNotificationPendingState(parsed.items.map(normaliseClientNotification).filter(Boolean)).forEach((item) => notificationStore.set(item.id, item));
      ['all', 'unread'].forEach((filter) => {
        const ids = Array.isArray(parsed.views?.[filter]) ? parsed.views[filter].map(String) : [];
        notificationViews[filter] = ids.filter((id) => notificationStore.has(id));
        Object.assign(notificationMeta[filter], normaliseNotificationMeta(parsed.meta?.[filter]));
      });
      clientNotificationsFetchedAt = Number(parsed.fetchedAt || 0);
    } catch { /* cache antigo ou inválido */ }
  }

  function notificationIconClass(item) {
    if (item.type === 'success') return 'fa-circle-check';
    if (item.type === 'warning') return 'fa-triangle-exclamation';
    if (item.type === 'restaurant') return 'fa-store';
    if (item.type === 'payment') return 'fa-wallet';
    if (item.type === 'order') return 'fa-bag-shopping';
    return 'fa-motorcycle';
  }

  function notificationDateGroup(value) {
    const date = new Date(value || Date.now());
    const now = new Date();
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const itemStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const difference = Math.round((dayStart.getTime() - itemStart.getTime()) / 86400000);
    if (difference === 0) return 'Hoje';
    if (difference === 1) return 'Ontem';
    return 'Anteriores';
  }

  function notificationRowMarkup(item) {
    const readLabel = item.read_at ? 'Já lida' : 'Marcar como lida';
    const canOpen = Boolean(item.order_id);
    return `<div class="v20-notification-row ${item.read_at ? '' : 'unread'}" data-notification-id="${escapeHtml(item.id)}">
      <div class="v20-notification-underlay" aria-hidden="true"><span class="read"><i class="fa-solid fa-check"></i>${escapeHtml(readLabel)}</span><span class="delete"><i class="fa-solid fa-trash-can"></i>Eliminar</span></div>
      <div class="v20-notification-card">
        <button class="v20-notification-content" ${canOpen ? `data-open-client-order="${escapeHtml(item.order_id)}"` : ''} type="button" ${canOpen ? '' : 'disabled'}>
          <i class="fa-solid ${notificationIconClass(item)}" aria-hidden="true"></i>
          <span><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.message)}</p><small>${new Date(item.created_at || Date.now()).toLocaleString('pt-MZ')}</small></span>
        </button>
        <div class="v20-notification-quick-actions" aria-label="Acções da notificação">
          <button aria-label="${escapeHtml(readLabel)}" data-notification-read="${escapeHtml(item.id)}" ${item.read_at ? 'disabled' : ''} type="button"><i class="fa-solid fa-check"></i></button>
          <button aria-label="Eliminar notificação" data-notification-delete="${escapeHtml(item.id)}" type="button"><i class="fa-regular fa-trash-can"></i></button>
        </div>
        <button aria-expanded="false" aria-label="Mais acções" class="v20-notification-menu-toggle" data-notification-menu="${escapeHtml(item.id)}" type="button"><i class="fa-solid fa-ellipsis-vertical"></i></button>
      </div>
      <div class="v20-notification-mobile-actions" hidden>
        <button data-notification-read="${escapeHtml(item.id)}" ${item.read_at ? 'disabled' : ''} type="button"><i class="fa-solid fa-check"></i>${escapeHtml(readLabel)}</button>
        <button data-notification-delete="${escapeHtml(item.id)}" type="button"><i class="fa-regular fa-trash-can"></i>Eliminar</button>
      </div>
    </div>`;
  }

  function notificationListMarkup(items) {
    if (!items.length) {
      return notificationFilter === 'unread'
        ? '<div class="empty-state">Não existem notificações por ler.</div>'
        : '<div class="empty-state">Ainda não existem notificações na sua conta.</div>';
    }
    const groups = new Map();
    items.forEach((item) => {
      const label = notificationDateGroup(item.created_at);
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(item);
    });
    return [...groups.entries()].map(([label, values]) => `<section class="v20-notification-group"><h2>${label}</h2>${values.map(notificationRowMarkup).join('')}</section>`).join('');
  }

  function setNotificationUnreadCount(value) {
    const count = Math.max(0, Number(value || 0));
    $$('.v20-menu-badge').forEach((badge) => {
      badge.textContent = String(count);
      badge.hidden = count === 0;
    });
    $$('.v20-alert-dot').forEach((dot) => {
      dot.hidden = count === 0;
      dot.setAttribute('aria-label', count ? `${count} notificações não lidas` : 'Sem notificações não lidas');
    });
  }

  function effectiveNotificationCounts(total, totalUnread) {
    const operations = readNotificationPendingOps();
    const deleted = operations.filter((entry) => entry.type === 'delete');
    const read = operations.filter((entry) => entry.type === 'read');
    const readAll = operations.some((entry) => entry.type === 'read_all');
    const deletedUnread = deleted.filter((entry) => !entry.snapshot?.read_at).length;
    return {
      total: Math.max(0, Number(total || 0) - deleted.length),
      totalUnread: readAll ? 0 : Math.max(0, Number(totalUnread || 0) - deletedUnread - read.length)
    };
  }

  function updateNotificationSummary() {
    const allMeta = notificationMeta.all;
    const summary = $('#client-notification-summary');
    if (summary) summary.textContent = `${allMeta.total} ${allMeta.total === 1 ? 'notificação' : 'notificações'} · ${allMeta.totalUnread} ${allMeta.totalUnread === 1 ? 'não lida' : 'não lidas'}`;
    setNotificationUnreadCount(allMeta.totalUnread);
    $$('[data-notification-filter]').forEach((button) => {
      const active = button.dataset.notificationFilter === notificationFilter;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function updateNotificationSyncStatus() {
    const status = $('#client-notification-sync-status');
    const retry = $('[data-notifications-retry]');
    if (!status) return;
    const pending = readNotificationPendingOps().length;
    status.className = 'v20-notification-sync-status';
    retry?.toggleAttribute('hidden', true);
    if (clientNotificationsRequest) {
      status.textContent = 'A sincronizar…';
      status.classList.add('is-syncing');
      return;
    }
    if (navigator.onLine === false) {
      status.textContent = pending ? `Sem ligação · ${pending} alteração(ões) por sincronizar` : 'A mostrar dados guardados';
      status.classList.add('is-offline');
      return;
    }
    if (pending) {
      status.textContent = `${pending} alteração(ões) por sincronizar`;
      status.classList.add('is-pending');
      return;
    }
    if (notificationLastError) {
      status.textContent = 'Falha de ligação';
      status.classList.add('is-error');
      retry?.toggleAttribute('hidden', false);
      return;
    }
    status.textContent = clientNotificationsFetchedAt ? 'Sincronizado' : 'Pronto para sincronizar';
    status.classList.add('is-synced');
  }

  function paintClientNotifications() {
    if (notificationSwipe) {
      notificationPaintDeferred = true;
      return;
    }
    notificationPaintDeferred = false;
    const list = $('#client-notification-list');
    if (!list) return;
    const items = currentNotificationItems();
    const awaitingFirstSync = !items.length && Boolean(readSession()?.token) && clientNotificationsFetchedAt === 0 && navigator.onLine !== false;
    list.innerHTML = awaitingFirstSync
      ? '<div class="empty-state"><i class="fa-solid fa-spinner fa-spin"></i> A carregar notificações…</div>'
      : notificationListMarkup(items);
    list.setAttribute('aria-busy', clientNotificationsRequest ? 'true' : 'false');
    const loadMore = $('[data-notification-load-more]');
    if (loadMore) {
      loadMore.hidden = !notificationMeta[notificationFilter].hasMore;
      loadMore.disabled = Boolean(clientNotificationsRequest);
    }
    updateNotificationSummary();
    updateNotificationSyncStatus();
  }

  function mergeNotificationPage(filter, items, append) {
    const clean = applyNotificationPendingState(items.map(normaliseClientNotification).filter(Boolean));
    clean.forEach((item) => notificationStore.set(item.id, item));
    const incoming = clean.map((item) => String(item.id));
    const existing = append ? notificationViews[filter] : [];
    notificationViews[filter] = [...new Set([...existing, ...incoming])];
    if (filter === 'all') {
      notificationViews.unread = notificationViews.unread.filter((id) => notificationStore.get(id) && !notificationStore.get(id).read_at);
    }
  }

  async function fetchClientNotificationSummary() {
    const owner = ensureNotificationOwner();
    const ownerVersion = notificationOwnerVersion;
    const session = readSession();
    if (!session?.token || document.visibilityState === 'hidden' || navigator.onLine === false) return;
    try {
      const response = await fetch(`${API_URL}/api/client/notifications?summary_only=true`, {
        headers: { Authorization: `Bearer ${session.token}` }
      });
      const data = await readJsonResponse(response);
      if (!response.ok) throw new Error(data.message || 'Não foi possível actualizar o resumo das notificações.');
      if (owner !== currentNotificationOwnerScope() || ownerVersion !== notificationOwnerVersion) return;
      const counts = effectiveNotificationCounts(data.total, data.totalUnread || data.total_unread);
      notificationMeta.all.total = counts.total;
      notificationMeta.all.totalUnread = counts.totalUnread;
      notificationMeta.unread.total = counts.totalUnread;
      notificationMeta.unread.totalUnread = notificationMeta.all.totalUnread;
      notificationLastError = '';
      updateNotificationSummary();
      updateNotificationSyncStatus();
      persistClientNotifications();
    } catch (error) {
      notificationLastError = error.message || 'Falha de ligação';
      updateNotificationSyncStatus();
    }
  }

  async function fetchClientNotifications(options = {}) {
    const owner = ensureNotificationOwner();
    hydrateClientNotifications();
    const session = readSession();
    if (!session?.token || document.visibilityState === 'hidden') return currentNotificationItems();
    if (navigator.onLine === false) {
      updateNotificationSyncStatus();
      return currentNotificationItems();
    }
    const append = options.append === true;
    const filter = options.filter === 'unread' ? 'unread' : 'all';
    const now = Date.now();
    const shouldRefresh = append || options.force === true || now - clientNotificationsFetchedAt >= CLIENT_NOTIFICATIONS_MIN_REFRESH_MS;
    if (!shouldRefresh) return currentNotificationItems();
    if (clientNotificationsRequest) {
      if (filter !== notificationRequestFilter || append) notificationQueuedFetch = { force: true, filter, append: filter === notificationRequestFilter && append };
      return clientNotificationsRequest;
    }
    const ownerVersion = notificationOwnerVersion;
    const params = new URLSearchParams({ limit: String(CLIENT_NOTIFICATIONS_PAGE_SIZE), filter });
    if (append && notificationMeta[filter].nextCursor) params.set('before', notificationMeta[filter].nextCursor);
    notificationRequestFilter = filter;
    notificationRequestController = new AbortController();
    clientNotificationsRequest = fetch(`${API_URL}/api/client/notifications?${params.toString()}`, {
      headers: { Authorization: `Bearer ${session.token}` },
      signal: notificationRequestController.signal
    })
      .then(async (response) => ({ response, data: await readJsonResponse(response) }))
      .then(({ response, data }) => {
        if (!response.ok) throw new Error(data.message || 'Não foi possível carregar as notificações.');
        if (owner !== currentNotificationOwnerScope() || ownerVersion !== notificationOwnerVersion) return currentNotificationItems();
        clientNotificationsFetchedAt = Date.now();
        notificationLastError = '';
        mergeNotificationPage(filter, Array.isArray(data.notifications) ? data.notifications : [], append);
        Object.assign(notificationMeta[filter], normaliseNotificationMeta(data));
        const counts = effectiveNotificationCounts(data.totalAll ?? (filter === 'all' ? data.total : notificationMeta.all.total), data.totalUnread || data.total_unread);
        notificationMeta.all.total = counts.total;
        notificationMeta.all.totalUnread = counts.totalUnread;
        notificationMeta.unread.total = counts.totalUnread;
        notificationMeta.unread.totalUnread = notificationMeta.all.totalUnread;
        persistClientNotifications();
        paintClientNotifications();
        return currentNotificationItems();
      })
      .catch((error) => {
        if (error?.name === 'AbortError') return currentNotificationItems();
        notificationLastError = error.message || 'Falha de ligação';
        paintClientNotifications();
        return currentNotificationItems();
      })
      .finally(() => {
        if (ownerVersion !== notificationOwnerVersion) return;
        clientNotificationsRequest = null;
        notificationRequestController = null;
        notificationRequestFilter = '';
        $('#client-notification-list')?.setAttribute('aria-busy', 'false');
        updateNotificationSyncStatus();
        const queued = notificationQueuedFetch;
        notificationQueuedFetch = null;
        if (queued) queueMicrotask(() => fetchClientNotifications(queued));
      });
    updateNotificationSyncStatus();
    return clientNotificationsRequest;
  }

  function renderClientNotifications(options = {}) {
    hydrateClientNotifications();
    paintClientNotifications();
    fetchClientNotifications(options);
    processNotificationQueue();
  }

  function findClientNotification(id) {
    return notificationStore.get(String(id)) || null;
  }

  function updateNotificationRowState(id) {
    const item = findClientNotification(id);
    const row = document.querySelector(`.v20-notification-row[data-notification-id="${CSS.escape(String(id))}"]`);
    if (!row || !item) return;
    row.classList.toggle('unread', !item.read_at);
    row.classList.remove('is-swiping', 'is-read-direction', 'is-delete-direction', 'is-committing');
    row.querySelector('.v20-notification-card')?.style.removeProperty('transform');
    row.querySelectorAll('[data-notification-read]').forEach((button) => {
      button.disabled = Boolean(item.read_at);
      const label = item.read_at ? 'Já lida' : 'Marcar como lida';
      button.setAttribute('aria-label', label);
      if (button.closest('.v20-notification-mobile-actions')) button.innerHTML = `<i class="fa-solid fa-check"></i>${escapeHtml(label)}`;
    });
    const underlay = row.querySelector('.v20-notification-underlay .read');
    if (underlay) underlay.innerHTML = `<i class="fa-solid fa-check"></i>${item.read_at ? 'Já lida' : 'Marcar como lida'}`;
  }

  function removeNotificationFromViews(id) {
    ['all', 'unread'].forEach((filter) => {
      notificationViews[filter] = notificationViews[filter].filter((entry) => String(entry) !== String(id));
    });
  }

  function announceNotification(message) {
    const announcer = $('#client-notification-announcer');
    if (!announcer) return;
    announcer.textContent = '';
    requestAnimationFrame(() => { announcer.textContent = message; });
  }

  async function markClientNotificationRead(id, options = {}) {
    const item = findClientNotification(id);
    if (!item) return false;
    if (item.read_at) {
      updateNotificationRowState(id);
      return false;
    }
    const timestamp = new Date().toISOString();
    notificationStore.set(String(id), { ...item, read_at: timestamp, updated_at: timestamp });
    notificationViews.unread = notificationViews.unread.filter((entry) => String(entry) !== String(id));
    notificationMeta.all.totalUnread = Math.max(0, notificationMeta.all.totalUnread - 1);
    notificationMeta.unread.total = notificationMeta.all.totalUnread;
    notificationMeta.unread.totalUnread = notificationMeta.all.totalUnread;
    if (notificationFilter === 'unread') paintClientNotifications();
    else updateNotificationRowState(id);
    upsertNotificationOperation({ type: 'read', id, executeAt: Date.now() });
    persistClientNotifications();
    updateNotificationSummary();
    processNotificationQueue();
    if (!options.silent) toast('Notificação marcada como lida.');
    return true;
  }

  function ensureNotificationUndo() {
    let node = $('#client-notification-undo');
    if (node) return node;
    node = document.createElement('div');
    node.id = 'client-notification-undo';
    node.className = 'v20-notification-undo';
    node.setAttribute('role', 'status');
    node.setAttribute('aria-live', 'polite');
    node.innerHTML = '<span>Notificação eliminada.</span><button type="button">Desfazer</button>';
    document.body.append(node);
    return node;
  }

  function closeNotificationUndo(commit = true) {
    if (!notificationUndo) return;
    const current = notificationUndo;
    notificationUndo = null;
    clearTimeout(current.timer);
    ensureNotificationUndo().classList.remove('show');
    if (commit) {
      const operations = readNotificationPendingOps().map((entry) => (
        entry.type === 'delete' && String(entry.id) === String(current.id)
          ? { ...entry, executeAt: Date.now() }
          : entry
      ));
      writeNotificationPendingOps(operations);
      processNotificationQueue();
    }
  }

  function restoreDeletedNotification(id) {
    const operation = pendingNotificationOperation('delete', id);
    if (!operation?.snapshot) return false;
    const item = normaliseClientNotification(operation.snapshot);
    if (!item) return false;
    notificationStore.set(item.id, item);
    notificationViews.all = [...new Set([item.id, ...notificationViews.all])];
    if (!item.read_at) notificationViews.unread = [...new Set([item.id, ...notificationViews.unread])];
    notificationMeta.all.total += 1;
    if (!item.read_at) notificationMeta.all.totalUnread += 1;
    notificationMeta.unread.total = notificationMeta.all.totalUnread;
    notificationMeta.unread.totalUnread = notificationMeta.all.totalUnread;
    removeNotificationOperation('delete', id);
    persistClientNotifications();
    paintClientNotifications();
    announceNotification('Eliminação desfeita.');
    return true;
  }

  function showNotificationUndo(id) {
    if (notificationUndo) closeNotificationUndo(true);
    const node = ensureNotificationUndo();
    const button = node.querySelector('button');
    node.classList.add('show');
    const undo = () => {
      if (restoreDeletedNotification(id)) closeNotificationUndo(false);
    };
    button.onclick = undo;
    notificationUndo = {
      id,
      timer: setTimeout(() => closeNotificationUndo(true), CLIENT_NOTIFICATION_UNDO_MS)
    };
  }

  async function deleteClientNotification(id, options = {}) {
    const item = findClientNotification(id);
    if (!item) return false;
    notificationStore.delete(String(id));
    removeNotificationFromViews(id);
    notificationMeta.all.total = Math.max(0, notificationMeta.all.total - 1);
    if (!item.read_at) notificationMeta.all.totalUnread = Math.max(0, notificationMeta.all.totalUnread - 1);
    notificationMeta.unread.total = notificationMeta.all.totalUnread;
    notificationMeta.unread.totalUnread = notificationMeta.all.totalUnread;
    upsertNotificationOperation({
      type: 'delete',
      id,
      snapshot: item,
      executeAt: Date.now() + (options.immediate ? 0 : CLIENT_NOTIFICATION_UNDO_MS)
    });
    const row = document.querySelector(`.v20-notification-row[data-notification-id="${CSS.escape(String(id))}"]`);
    row?.remove();
    persistClientNotifications();
    paintClientNotifications();
    if (!options.immediate) showNotificationUndo(id);
    else processNotificationQueue();
    announceNotification('Notificação eliminada. Pode desfazer durante cinco segundos.');
    return true;
  }

  async function markClientNotificationsRead() {
    const unreadCount = Math.max(notificationMeta.all.totalUnread, [...notificationStore.values()].filter((item) => !item.read_at).length);
    if (!unreadCount) {
      toast('Todas as notificações já estão lidas.', 'info');
      return;
    }
    const timestamp = new Date().toISOString();
    [...notificationStore.values()].forEach((item) => {
      if (!item.read_at) notificationStore.set(item.id, { ...item, read_at: timestamp, updated_at: timestamp });
    });
    notificationViews.unread = [];
    notificationMeta.all.totalUnread = 0;
    notificationMeta.unread.total = 0;
    notificationMeta.unread.totalUnread = 0;
    upsertNotificationOperation({ type: 'read_all', id: 'all', executeAt: Date.now() });
    persistClientNotifications();
    paintClientNotifications();
    processNotificationQueue();
    toast(navigator.onLine === false ? 'Alteração guardada. Será sincronizada quando voltar a ter internet.' : 'Notificações marcadas como lidas.');
  }

  async function executeNotificationOperation(operation, token) {
    const path = operation.type === 'read_all'
      ? '/api/client/notifications/read-all'
      : operation.type === 'read'
        ? `/api/client/notifications/${encodeURIComponent(operation.id)}/read`
        : `/api/client/notifications/${encodeURIComponent(operation.id)}`;
    const response = await fetch(`${API_URL}${path}`, {
      method: operation.type === 'delete' ? 'DELETE' : 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await readJsonResponse(response);
    if (!response.ok && response.status !== 404) {
      const error = new Error(data.message || 'Não foi possível sincronizar a notificação.');
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function scheduleNotificationQueue() {
    clearTimeout(notificationQueueTimer);
    const now = Date.now();
    const next = readNotificationPendingOps()
      .filter((operation) => Number(operation.executeAt || 0) > now)
      .sort((a, b) => Number(a.executeAt) - Number(b.executeAt))[0];
    if (next) notificationQueueTimer = setTimeout(processNotificationQueue, Math.max(40, Number(next.executeAt) - now + 20));
  }

  async function processNotificationQueue() {
    if (notificationQueueProcessing || navigator.onLine === false) {
      scheduleNotificationQueue();
      updateNotificationSyncStatus();
      return;
    }
    const session = readSession();
    if (!session?.token) return;
    const now = Date.now();
    const operations = readNotificationPendingOps();
    const due = operations.filter((operation) => Number(operation.executeAt || 0) <= now);
    if (!due.length) {
      scheduleNotificationQueue();
      updateNotificationSyncStatus();
      return;
    }
    notificationQueueProcessing = true;
    const remaining = [...operations];
    for (const operation of due) {
      try {
        await executeNotificationOperation(operation, session.token);
        const index = remaining.findIndex((entry) => entry.type === operation.type && String(entry.id) === String(operation.id));
        if (index >= 0) remaining.splice(index, 1);
      } catch (error) {
        const index = remaining.findIndex((entry) => entry.type === operation.type && String(entry.id) === String(operation.id));
        if (index >= 0) {
          remaining[index] = {
            ...remaining[index],
            attempts: Number(remaining[index].attempts || 0) + 1,
            lastError: error.message || 'Falha de ligação',
            executeAt: Date.now() + Math.min(60000, 2500 * (Number(remaining[index].attempts || 0) + 1))
          };
        }
        if (Number(error?.status || 0) === 401) break;
      }
    }
    writeNotificationPendingOps(remaining);
    notificationQueueProcessing = false;
    scheduleNotificationQueue();
    updateNotificationSyncStatus();
  }

  function resetNotificationSwipe(row, card) {
    if (!row || !card) return;
    row.classList.remove('is-swiping', 'is-read-direction', 'is-delete-direction', 'is-committing');
    card.style.removeProperty('transform');
    if (notificationPaintDeferred) paintClientNotifications();
  }

  function beginNotificationSwipe(event) {
    if (event.button !== undefined && event.button !== 0) return;
    if (event.target.closest('.v20-notification-quick-actions, .v20-notification-menu-toggle, .v20-notification-mobile-actions')) return;
    const row = event.target.closest('.v20-notification-row');
    const card = row?.querySelector('.v20-notification-card');
    if (!row || !card) return;
    notificationSwipe = {
      pointerId: event.pointerId,
      row,
      card,
      startX: event.clientX,
      startY: event.clientY,
      dx: 0,
      axis: ''
    };
    card.setPointerCapture?.(event.pointerId);
  }

  function moveNotificationSwipe(event) {
    if (!notificationSwipe || notificationSwipe.pointerId !== event.pointerId) return;
    const dx = event.clientX - notificationSwipe.startX;
    const dy = event.clientY - notificationSwipe.startY;
    if (!notificationSwipe.axis && Math.max(Math.abs(dx), Math.abs(dy)) >= 8) {
      notificationSwipe.axis = Math.abs(dx) > Math.abs(dy) * 1.15 ? 'x' : 'y';
    }
    if (notificationSwipe.axis !== 'x') return;
    event.preventDefault();
    const item = findClientNotification(notificationSwipe.row.dataset.notificationId);
    const positiveLimit = item?.read_at ? 34 : 118;
    notificationSwipe.dx = Math.max(-118, Math.min(positiveLimit, dx));
    const { row, card } = notificationSwipe;
    row.classList.add('is-swiping');
    row.classList.toggle('is-read-direction', notificationSwipe.dx > 0 && !item?.read_at);
    row.classList.toggle('is-delete-direction', notificationSwipe.dx < 0);
    card.style.transform = `translate3d(${notificationSwipe.dx}px,0,0)`;
  }

  function finishNotificationSwipe(event) {
    if (!notificationSwipe || notificationSwipe.pointerId !== event.pointerId) return;
    const current = notificationSwipe;
    notificationSwipe = null;
    const id = current.row.dataset.notificationId;
    const item = findClientNotification(id);
    const threshold = Math.min(82, Math.max(58, current.row.clientWidth * 0.22));
    if (current.axis !== 'x' || Math.abs(current.dx) < threshold || (current.dx > 0 && item?.read_at)) {
      resetNotificationSwipe(current.row, current.card);
      return;
    }
    notificationClickBlockedUntil = Date.now() + 450;
    current.row.classList.add('is-committing');
    current.card.style.transform = `translate3d(${current.dx > 0 ? '115%' : '-115%'},0,0)`;
    setTimeout(async () => {
      if (current.dx > 0) await markClientNotificationRead(id, { silent: true });
      else await deleteClientNotification(id);
      if (document.contains(current.row)) resetNotificationSwipe(current.row, current.card);
      if (notificationPaintDeferred) paintClientNotifications();
    }, 160);
  }

  function cancelNotificationSwipe(event) {
    if (!notificationSwipe || (event.pointerId !== undefined && notificationSwipe.pointerId !== event.pointerId)) return;
    const current = notificationSwipe;
    notificationSwipe = null;
    resetNotificationSwipe(current.row, current.card);
  }

  function toggleNotificationMenu(id, button) {
    const row = button.closest('.v20-notification-row');
    if (!row) return;
    const open = !row.classList.contains('is-menu-open');
    document.querySelectorAll('.v20-notification-row.is-menu-open').forEach((other) => {
      other.classList.remove('is-menu-open');
      other.querySelector('.v20-notification-menu-toggle')?.setAttribute('aria-expanded', 'false');
      other.querySelector('.v20-notification-mobile-actions')?.toggleAttribute('hidden', true);
    });
    row.classList.toggle('is-menu-open', open);
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
    row.querySelector('.v20-notification-mobile-actions')?.toggleAttribute('hidden', !open);
  }

  function setNotificationFilter(filter) {
    const target = filter === 'unread' ? 'unread' : 'all';
    if (notificationFilter === target) return;
    notificationFilter = target;
    paintClientNotifications();
    fetchClientNotifications({ force: true, filter: target });
  }

  function loadMoreClientNotifications() {
    if (!notificationMeta[notificationFilter].hasMore) return;
    fetchClientNotifications({ append: true, filter: notificationFilter, force: true });
  }

  function startNotificationPolling() {
    clearInterval(notificationPollTimer);
    notificationPollTimer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (state.activePanel === 'notifications') fetchClientNotifications({ force: true, filter: notificationFilter });
      else fetchClientNotificationSummary();
      processNotificationQueue();
    }, CLIENT_NOTIFICATIONS_POLL_MS);
  }

  window.TragoClientRenderNotifications = renderClientNotifications;

  const ORDER_ACTIVE_STATUSES = Object.freeze([
    'pendente', 'atribuido', 'em_progresso', 'recolha_em_progresso', 'recolha_concluida', 'entrega_em_progresso'
  ]);
  const ORDER_FILTER_TO_API = Object.freeze({ active: 'active', previous: 'completed', cancelled: 'cancelled' });
  const ORDER_PAGE_SIZE = 30;
  const ORDER_CACHE_MAX = 360;
  const orderStore = new Map();
  const orderViews = { active: [], previous: [], cancelled: [] };
  const orderMeta = {
    active: { total: 0, hasMore: false, nextCursor: '', loaded: false },
    previous: { total: 0, hasMore: false, nextCursor: '', loaded: false },
    cancelled: { total: 0, hasMore: false, nextCursor: '', loaded: false }
  };
  let orderOwnerScope = '';
  let orderOwnerVersion = 0;
  let orderRequestController = null;
  let orderRequestPromise = null;
  let orderRequestFilter = '';
  let orderQueuedRefresh = null;
  let orderFetchedAt = 0;
  let orderHydrated = false;
  let activeOrderContextController = null;

  function currentOrderOwnerScope() {
    const session = state.session || readSession();
    return String(session?.id || session?._id || 'guest');
  }

  function canonicalOrderStatus(value) {
    const raw = String(value || 'pendente').trim().toLowerCase();
    const aliases = {
      pending: 'pendente', new: 'pendente', aguardando: 'pendente',
      assigned: 'atribuido', accepted: 'atribuido', confirmado: 'atribuido',
      in_progress: 'em_progresso', em_andamento: 'em_progresso',
      pickup_in_progress: 'recolha_em_progresso', collecting: 'recolha_em_progresso',
      pickup_done: 'recolha_concluida', collected: 'recolha_concluida',
      delivery_in_progress: 'entrega_em_progresso', on_the_way: 'entrega_em_progresso',
      completed: 'concluido', delivered: 'concluido', finalizado: 'concluido', entregue: 'concluido',
      canceled: 'cancelado', cancelled: 'cancelado', cancelada: 'cancelado'
    };
    return aliases[raw] || raw || 'pendente';
  }

  function orderBucket(status) {
    const normalised = canonicalOrderStatus(status);
    if (normalised === 'concluido') return 'previous';
    if (normalised === 'cancelado') return 'cancelled';
    return 'active';
  }

  function orderStatusLabel(status, restaurantStatus = '') {
    const normalised = canonicalOrderStatus(status);
    if (restaurantStatus === 'preparing' && !['entrega_em_progresso', 'concluido', 'cancelado'].includes(normalised)) return 'Em preparação';
    return ({
      pendente: 'A aguardar',
      atribuido: 'Motorista atribuído',
      em_progresso: 'Em andamento',
      recolha_em_progresso: 'Em recolha',
      recolha_concluida: 'Recolha concluída',
      entrega_em_progresso: 'A caminho',
      concluido: 'Entregue',
      cancelado: 'Cancelado'
    })[normalised] || 'Em actualização';
  }

  function orderDateValue(item) {
    const bucket = orderBucket(item?.status);
    const preferred = bucket === 'active'
      ? (item?.updatedAt || item?.updated_at || item?.last_update || item?.createdAt || item?.created_at)
      : (item?.closedAt || item?.closed_at || item?.timestamp_completed || item?.cancelledAt || item?.cancelled_at || item?.updatedAt || item?.createdAt);
    const parsed = new Date(preferred || 0).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function formatOrderDate(item) {
    const value = orderDateValue(item);
    return value ? new Date(value).toLocaleString('pt-MZ', { dateStyle: 'medium', timeStyle: 'short' }) : 'Data indisponível';
  }

  function normaliseOrderRecord(order, previous = {}) {
    const id = String(order?.id || order?._id || previous?.id || '');
    if (!id) return null;
    const status = canonicalOrderStatus(order?.status || previous?.status);
    const accessToken = order?.public_access_token || order?.access_token || previous?.access_token || previous?.public_access_token || '';
    return {
      ...previous,
      ...order,
      id,
      _id: id,
      status,
      code: order?.verification_code || order?.code || previous?.code || '',
      access_token: accessToken,
      public_access_token: accessToken,
      service_type: order?.service_type || previous?.service_type || 'Serviço',
      price: Number(order?.price ?? previous?.price ?? 0),
      delivery_fee: Number(order?.delivery_fee ?? previous?.delivery_fee ?? 0),
      createdAt: order?.createdAt || order?.created_at || previous?.createdAt || previous?.created_at || new Date().toISOString(),
      updatedAt: order?.updatedAt || order?.updated_at || previous?.updatedAt || previous?.updated_at || new Date().toISOString(),
      closedAt: order?.closedAt || order?.closed_at || previous?.closedAt || previous?.closed_at || null,
      closed_at: order?.closed_at || order?.closedAt || previous?.closed_at || previous?.closedAt || null,
      cancelledAt: order?.cancelledAt || order?.cancelled_at || previous?.cancelledAt || previous?.cancelled_at || null,
      restaurant_status: order?.restaurant_status || order?.restaurantStatus || previous?.restaurant_status || null,
      assigned_to_driver: order?.assigned_to_driver || previous?.assigned_to_driver || null,
      driver_offer_status: order?.driver_offer_status ?? previous?.driver_offer_status ?? null,
      driver_offer_expires_at: order?.driver_offer_expires_at ?? previous?.driver_offer_expires_at ?? null,
      pickup_address_coords: order?.pickup_address_coords || previous?.pickup_address_coords || null,
      address_coords: order?.address_coords || previous?.address_coords || null,
      last_update: order?.updatedAt || order?.updated_at || previous?.last_update || new Date().toISOString()
    };
  }

  function persistOrderStore() {
    const rows = [...orderStore.values()]
      .sort((a, b) => orderDateValue(b) - orderDateValue(a) || String(b.id).localeCompare(String(a.id)))
      .slice(0, ORDER_CACHE_MAX);
    try { localStorage.setItem(clientStorageKey(ORDER_HISTORY_KEY), JSON.stringify(rows)); } catch { /* storage indisponível */ }
  }

  function hydrateOrderStore(force = false) {
    if (orderHydrated && !force) return;
    orderStore.clear();
    let cached = [];
    try { cached = JSON.parse(localStorage.getItem(clientStorageKey(ORDER_HISTORY_KEY)) || '[]'); } catch { cached = []; }
    Object.keys(orderViews).forEach((filter) => { orderViews[filter] = []; });
    (Array.isArray(cached) ? cached : []).forEach((entry) => {
      const safe = normaliseOrderRecord(entry);
      if (!safe) return;
      orderStore.set(safe.id, safe);
      orderViews[orderBucket(safe.status)].push(safe.id);
    });
    Object.keys(orderViews).forEach((filter) => {
      orderViews[filter].sort((a, b) => orderDateValue(orderStore.get(b)) - orderDateValue(orderStore.get(a)) || String(b).localeCompare(String(a)));
    });
    orderHydrated = true;
  }

  function ensureOrderOwner() {
    const owner = currentOrderOwnerScope();
    if (owner === orderOwnerScope && orderHydrated) return false;
    orderOwnerVersion += 1;
    orderOwnerScope = owner;
    orderRequestController?.abort?.();
    activeOrderContextController?.abort?.();
    activeOrderContextController = null;
    orderRequestController = null;
    orderRequestPromise = null;
    orderRequestFilter = '';
    orderQueuedRefresh = null;
    orderFetchedAt = 0;
    orderHydrated = false;
    Object.values(orderMeta).forEach((meta) => Object.assign(meta, { total: 0, hasMore: false, nextCursor: '', loaded: false }));
    hydrateOrderStore(true);
    return true;
  }

  function upsertOrderHistory(order, options = {}) {
    ensureOrderOwner();
    const id = String(order?.id || order?._id || '');
    if (!id) return null;
    const previous = orderStore.get(id) || {};
    const safe = normaliseOrderRecord(order, previous);
    if (!safe) return null;
    orderStore.set(id, safe);
    Object.keys(orderViews).forEach((filter) => {
      orderViews[filter] = orderViews[filter].filter((entryId) => String(entryId) !== id);
    });
    orderViews[orderBucket(safe.status)].unshift(id);
    persistOrderStore();
    if (options.render !== false) renderHistory();
    return safe;
  }

  function patchOrderHistory(id, patch, options = {}) {
    ensureOrderOwner();
    const current = orderStore.get(String(id));
    if (!current) return null;
    return upsertOrderHistory({ ...current, ...(patch || {}), id: current.id }, options);
  }

  function orderRowsForFilter(filter = state.orderHistoryFilter) {
    ensureOrderOwner();
    const ids = orderViews[filter] || [];
    return ids
      .map((id) => orderStore.get(String(id)))
      .filter((item) => item && orderBucket(item.status) === filter)
      .sort((a, b) => orderDateValue(b) - orderDateValue(a) || String(b.id).localeCompare(String(a.id)));
  }

  function updateOrderTabUI(filter) {
    $$('[data-order-tab]').forEach((button) => {
      const active = button.dataset.orderTab === filter;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    $('.v20-active-order')?.classList.toggle('hidden', filter !== 'active');
  }

  function renderHistory() {
    ensureOrderOwner();
    const list = $('#client-history-list');
    if (!list) return;
    window.TragoClientSyncOrderShell?.();
    const computedActive = orderRowsForFilter('active').length;
    const activeCount = state.session?.token && orderMeta.active.loaded ? Number(orderMeta.active.total) : computedActive;
    $$('[data-client-active-count]').forEach((badge) => {
      badge.textContent = String(activeCount);
      badge.hidden = activeCount === 0;
    });
    updateOrderTabUI(state.orderHistoryFilter);
    const rows = orderRowsForFilter(state.orderHistoryFilter);
    const sync = $('#client-history-sync-status');
    if (sync) sync.textContent = navigator.onLine === false ? 'A mostrar pedidos guardados.' : `${rows.length} pedido${rows.length === 1 ? '' : 's'} carregado${rows.length === 1 ? '' : 's'}.`;
    if (!rows.length) {
      const label = state.orderHistoryFilter === 'previous'
        ? 'Ainda não existem pedidos anteriores.'
        : state.orderHistoryFilter === 'cancelled'
          ? 'Ainda não existem pedidos cancelados.'
          : 'Não existem pedidos activos neste momento.';
      list.innerHTML = `<div class="empty-state">${label}</div>`;
    } else {
      list.innerHTML = rows.map((item) => {
        const status = canonicalOrderStatus(item.status);
        const serviceLabel = String(item.service_type || 'Serviço').replaceAll('_', ' ');
        return `
          <div class="order-card" data-open-client-order="${escapeHtml(item.id)}" role="button" tabindex="0" aria-label="Abrir pedido #${escapeHtml(String(item.id).slice(-6).toUpperCase())}">
            <div class="order-card-head">
              <strong>#${escapeHtml(String(item.id).slice(-6).toUpperCase())}</strong>
              <span class="status-pill status-${escapeHtml(status)}">${escapeHtml(orderStatusLabel(status, item.restaurant_status))}</span>
            </div>
            <div class="order-meta">${escapeHtml(serviceLabel)} · ${money(item.price)} · ${escapeHtml(formatOrderDate(item))}</div>
            ${item.delivery_fee ? `<div class="order-meta"><strong>Taxa de entrega:</strong> ${money(item.delivery_fee)}</div>` : ''}
            ${item.code && status !== 'cancelado' ? `<div class="order-meta"><strong>Código para entrega:</strong> ${escapeHtml(item.code)}</div>` : ''}
          </div>`;
      }).join('');
    }
    const meta = orderMeta[state.orderHistoryFilter];
    const more = $('[data-order-load-more]');
    if (more) {
      more.hidden = !state.session?.token || !meta.hasMore;
      more.disabled = Boolean(orderRequestPromise);
    }
  }

  async function refreshActiveOrderContextForShell(order) {
    if (!order?.id || (!order.access_token && !state.session?.token)) return;
    activeOrderContextController?.abort?.();
    const controller = new AbortController();
    activeOrderContextController = controller;
    try {
      const response = await fetch(`${API_URL}/api/public/orders/${encodeURIComponent(order.id)}/context`, {
        headers: {
          'X-Order-Access-Token': order.access_token || '',
          ...(state.session?.token ? { Authorization: `Bearer ${state.session.token}` } : {})
        },
        signal: controller.signal
      });
      const data = await readJsonResponse(response);
      if (!response.ok) return;
      if (data.driver) window.TragoClientSetAssignedDriver?.(data.driver);
      if (data.order) patchOrderHistory(order.id, data.order, { render: false });
      window.TragoClientSyncOrderShell?.();
    } catch (error) {
      if (error?.name !== 'AbortError') console.warn('[TraGo] contexto activo indisponível:', error?.message || error);
    } finally {
      if (activeOrderContextController === controller) activeOrderContextController = null;
    }
  }

  async function fetchOrderPage(options = {}) {
    ensureOrderOwner();
    const filter = ['active', 'previous', 'cancelled'].includes(options.filter) ? options.filter : state.orderHistoryFilter;
    const append = options.append === true;
    const silent = options.silent === true;
    const owner = orderOwnerScope;
    const version = orderOwnerVersion;
    if (!state.session?.token) {
      renderHistory();
      return { orders: orderRowsForFilter(filter), local: true };
    }
    if (orderRequestPromise) {
      if (orderRequestFilter === filter && !append) return orderRequestPromise;
      orderQueuedRefresh = { ...options, filter };
      orderRequestController?.abort?.();
      return orderRequestPromise;
    }
    const controller = new AbortController();
    orderRequestController = controller;
    orderRequestFilter = filter;
    const meta = orderMeta[filter];
    const params = new URLSearchParams({ filter: ORDER_FILTER_TO_API[filter], limit: String(ORDER_PAGE_SIZE) });
    if (append && meta.nextCursor) params.set('before', meta.nextCursor);
    const list = $('#client-history-list');
    list?.setAttribute('aria-busy', 'true');
    const request = (async () => {
      try {
        const response = await fetch(`${API_URL}/api/client/orders?${params}`, {
          headers: { Authorization: `Bearer ${state.session.token}` },
          signal: controller.signal
        });
        const data = await readJsonResponse(response);
        if (!response.ok) throw new Error(data.message || 'Não foi possível carregar os pedidos.');
        if (owner !== currentOrderOwnerScope() || version !== orderOwnerVersion) return data;
        const received = Array.isArray(data.orders) ? data.orders : [];
        received.forEach((order) => upsertOrderHistory(order, { render: false }));
        const receivedIds = received.map((order) => String(order.id || order._id || '')).filter(Boolean);
        orderViews[filter] = append
          ? [...new Set([...(orderViews[filter] || []), ...receivedIds])]
          : receivedIds;
        const totals = data.totals || {};
        orderMeta.active.total = Number(totals.active ?? orderMeta.active.total ?? 0);
        orderMeta.previous.total = Number(totals.completed ?? orderMeta.previous.total ?? 0);
        orderMeta.cancelled.total = Number(totals.cancelled ?? orderMeta.cancelled.total ?? 0);
        meta.hasMore = data.hasMore === true;
        meta.nextCursor = String(data.nextCursor || '');
        meta.loaded = true;
        orderFetchedAt = Date.now();
        renderHistory();
        if (filter === 'active') refreshActiveOrderContextForShell(orderRowsForFilter('active')[0]);
        return data;
      } catch (error) {
        if (error?.name === 'AbortError') return null;
        renderHistory();
        if (!silent) toast(error.message || 'Não foi possível actualizar os pedidos.', 'error');
        return null;
      } finally {
        const currentRequest = orderRequestPromise === request;
        if (orderRequestController === controller) orderRequestController = null;
        if (currentRequest) {
          orderRequestPromise = null;
          orderRequestFilter = '';
          list?.setAttribute('aria-busy', 'false');
          const queued = orderQueuedRefresh;
          orderQueuedRefresh = null;
          if (queued) queueMicrotask(() => fetchOrderPage(queued));
        }
      }
    })();
    orderRequestPromise = request;
    return request;
  }

  function setOrderHistoryFilter(filter, options = {}) {
    const target = ['active', 'previous', 'cancelled'].includes(filter) ? filter : 'active';
    state.orderHistoryFilter = target;
    renderHistory();
    if (options.fetch !== false) fetchOrderPage({ filter: target, force: true, silent: options.silent === true });
    return target;
  }

  async function refreshHistoryStatuses(silent = false) {
    ensureOrderOwner();
    const filter = state.orderHistoryFilter || 'active';
    const result = await fetchOrderPage({ filter, force: true, silent });
    if (filter !== 'active') await fetchOrderPage({ filter: 'active', force: true, silent: true });
    if (!silent && result) toast('Estado dos pedidos actualizado.');
    return result;
  }

  function loadMoreOrderHistory() {
    const meta = orderMeta[state.orderHistoryFilter];
    if (!meta?.hasMore) return;
    fetchOrderPage({ filter: state.orderHistoryFilter, append: true, force: true });
  }

  function resetOrderSessionState() {
    orderOwnerScope = '';
    ensureOrderOwner();
    sessionStorage.removeItem('tragoClientSelectedOrderId');
    window.TragoClientResetOrderTracking?.();
    renderHistory();
  }

  window.TragoClientFilterOrders = setOrderHistoryFilter;
  window.TragoClientOrders = Object.freeze({
    upsert: upsertOrderHistory,
    patch: patchOrderHistory,
    get: (id) => { ensureOrderOwner(); return orderStore.get(String(id)) || null; },
    all: () => { ensureOrderOwner(); return [...orderStore.values()]; },
    active: () => orderRowsForFilter('active'),
    refresh: refreshHistoryStatuses,
    resetSession: resetOrderSessionState
  });


  async function claimGuestOrdersForSession(session) {
    if (!session?.token) return 0;
    const guestKey = `${ORDER_HISTORY_KEY}:${encodeURIComponent('guest')}`;
    let guestOrders = [];
    try { guestOrders = JSON.parse(localStorage.getItem(guestKey) || '[]'); } catch { guestOrders = []; }
    const claimable = (Array.isArray(guestOrders) ? guestOrders : [])
      .filter((order) => order?.id && (order?.access_token || order?.public_access_token))
      .slice(0, 30);
    if (!claimable.length) return 0;
    const claimedIds = new Set();
    for (const order of claimable) {
      try {
        const response = await fetch(`${API_URL}/api/client/orders/claim`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
          body: JSON.stringify({ order_id: order.id, access_token: order.access_token || order.public_access_token })
        });
        const data = await readJsonResponse(response);
        if (!response.ok) continue;
        claimedIds.add(String(order.id));
        upsertOrderHistory({ ...order, ...(data.order || {}), id: order.id }, { render: false });
      } catch { /* mantém no perfil convidado para nova tentativa */ }
    }
    if (claimedIds.size) {
      const remaining = guestOrders.filter((order) => !claimedIds.has(String(order?.id || '')));
      try {
        if (remaining.length) localStorage.setItem(guestKey, JSON.stringify(remaining));
        else localStorage.removeItem(guestKey);
      } catch { /* storage indisponível */ }
      persistOrderStore();
      renderHistory();
      toast(`${claimedIds.size} pedido${claimedIds.size === 1 ? '' : 's'} associado${claimedIds.size === 1 ? '' : 's'} à sua conta.`, 'info');
    }
    return claimedIds.size;
  }

  function initSessionUI(options = {}) {
    const nextSession = readSession();
    const previousScope = sessionOwnerScope;
    const nextScope = String(nextSession?.id || nextSession?._id || 'guest');
    const identityChanged = Boolean(previousScope && previousScope !== nextScope);
    state.session = nextSession;
    sessionOwnerScope = nextScope;
    ensureNotificationOwner();
    ensureOrderOwner();
    state.selectedRatings = readLocalRatings();
    const authenticated = Boolean(state.session);
    const profile = state.session || {};
    $$('#client-name-label').forEach((el) => { el.textContent = profile.name || 'Cliente'; });
    $('#btn-client-login')?.toggleAttribute('hidden', authenticated);
    $('#btn-client-logout')?.toggleAttribute('hidden', !authenticated);
    const nameInput = $('#order-client-name');
    const phoneInput = $('#order-client-phone');
    if (nameInput) nameInput.value = profile.name || '';
    if (phoneInput) phoneInput.value = profile.phone || '';
    const foodName = $('#food-client-name');
    const foodPhone = $('#food-client-phone');
    if (foodName) foodName.value = profile.name || '';
    if (foodPhone) foodPhone.value = profile.phone || '';

    if (identityChanged) {
      restoreCart();
      resetOrderSessionState();
      hydrateClientNotifications(true);
      paintClientNotifications();
      renderCart();
      panelNavigation?.destroy?.();
      panelNavigation = null;
      initPanelNavigation();
      window.TragoClientAddresses?.refresh?.();
      window.TragoClientRefreshFavorites?.();
      fetchClientNotificationSummary();
      if (previousScope === 'guest' && nextScope !== 'guest') {
        claimGuestOrdersForSession(nextSession).finally(() => fetchOrderPage({ filter: 'active', force: true, silent: true }));
      } else {
        fetchOrderPage({ filter: 'active', force: true, silent: true });
      }
    } else if (options.refreshData === true) {
      fetchClientNotificationSummary();
      fetchOrderPage({ filter: 'active', force: true, silent: true });
    }
    return true;
  }

  window.TragoClientRefreshSession = (options = {}) => initSessionUI(options);

  function logout() {
    localStorage.removeItem(SESSION_KEY);
    window.location.replace('login-cliente.html');
  }

  function renderPanel(panel) {
    if (!panel) return;
    const isDishDetail = panel === 'dish-detail';
    if (!isDishDetail) state.lastPanelBeforeDish = panel;
    state.activePanel = panel;
    document.body.dataset.clientPanel = panel;
    $$('.portal-tab').forEach((btn) => {
      const active = btn.dataset.panel === panel;
      btn.classList.toggle('active', active);
      if (active) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
    });
    $$('.portal-panel').forEach((el) => {
      const active = el.dataset.panel === panel;
      el.classList.toggle('hidden', !active);
      el.setAttribute('aria-hidden', active ? 'false' : 'true');
    });
    $$('.mobile-bottom-nav button[data-panel]').forEach((btn) => {
      const active = btn.dataset.panel === panel;
      btn.classList.toggle('active', active);
      if (active) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
    });
    if (panel === 'map') setTimeout(() => state.map?.invalidateSize?.(), 160);
    if (['food', 'bottle-store', 'bottle-profile', 'home', 'dish-detail', 'restaurant-profile', 'wishlist'].includes(panel)) loadRestaurants();
    if (panel === 'bottle-store') renderBottleStore();
    if (panel === 'bottle-profile') {
      if (state.selectedRestaurantId) renderBottleProfile(state.selectedRestaurantId);
      else queueMicrotask(() => setPanel('bottle-store', { replace: true, skipStack: true }));
    }
    if (panel === 'restaurant-profile') {
      if (state.selectedRestaurantId) renderRestaurantProfile(state.selectedRestaurantId);
      else queueMicrotask(() => setPanel('food', { replace: true, skipStack: true }));
    }
    if (panel === 'dish-detail' && state.selectedDishId) renderDishDetail(state.selectedDishId);
    if (panel === 'wishlist') renderWishlist();
    if (panel === 'notifications') renderClientNotifications({ force: true });
    if (panel === 'history') {
      renderHistory();
      fetchOrderPage({ filter: state.orderHistoryFilter, force: true, silent: true });
    }
    if (panel === 'partners') {
      loadPartners();
      setTimeout(() => state.partnersMap?.invalidateSize?.(), 120);
    }
    closeCartModal(false);
  }

  function setPanel(panel, options = {}) {
    if (panelNavigation) return panelNavigation.navigate(panel, options);
    renderPanel(panel);
    return panel;
  }

  function backPanel(fallback = 'home') {
    if (panelNavigation) return panelNavigation.back(fallback);
    renderPanel(fallback);
    return fallback;
  }

  function initPanelNavigation() {
    if (panelNavigation) return panelNavigation;
    $$('.v20-back:not([data-local-back])').forEach((button) => {
      if (button.dataset.jumpPanel && !button.dataset.fallbackPanel) {
        button.dataset.fallbackPanel = button.dataset.jumpPanel;
        button.removeAttribute('data-jump-panel');
      }
      button.setAttribute('data-smart-back', '');
      if (!button.hasAttribute('aria-label')) button.setAttribute('aria-label', 'Voltar');
    });
    window.TragoClientOpenPanel = setPanel;
    if (!window.TragoNavigation) {
      renderPanel('home');
      return;
    }
    panelNavigation = window.TragoNavigation.create({
      role: 'client',
      scope: state.session?.id || state.session?._id || 'guest',
      pages: ['home', 'food', 'bottle-store', 'bottle-profile', 'restaurant-profile', 'dish-detail', 'wishlist', 'partners', 'delivery', 'map', 'history', 'menu', 'addresses', 'notifications', 'coupons', 'preferences', 'language', 'support', 'referral', 'policies', 'about'],
      defaultPage: 'home',
      transientPages: ['dish-detail', 'map'],
      restorablePages: ['home', 'food', 'bottle-store', 'wishlist', 'partners', 'delivery', 'history', 'menu'],
      deepLinkPages: ['home', 'food', 'bottle-store', 'wishlist', 'partners', 'delivery', 'history', 'menu', 'restaurant-profile', 'bottle-profile'],
      getCurrent: () => state.activePanel,
      getContext: (page) => {
        if (['restaurant-profile', 'bottle-profile'].includes(page) && state.selectedRestaurantId) return { id: state.selectedRestaurantId };
        if (page === 'dish-detail' && state.selectedDishId) return { id: state.selectedDishId, origin: state.lastPanelBeforeDish || 'food' };
        return {};
      },
      applyContext: (page, context) => {
        if (['restaurant-profile', 'bottle-profile'].includes(page)) state.selectedRestaurantId = context.id || null;
        if (page === 'dish-detail') {
          state.selectedDishId = context.id || null;
          state.lastPanelBeforeDish = context.origin || state.lastPanelBeforeDish || 'food';
        }
      },
      validateContext: (page, context) => {
        if (['restaurant-profile', 'bottle-profile', 'dish-detail'].includes(page)) return Boolean(context.id);
        return true;
      },
      fallbackFor: (page) => page === 'bottle-profile' ? 'bottle-store' : page === 'restaurant-profile' || page === 'dish-detail' ? 'food' : 'home',
      render: renderPanel
    });
    panelNavigation.restore();
  }

  function singleMapTarget() {
    return String(state.mapContext || '').startsWith('cargo-')
      ? String(state.mapContext).replace('cargo-', '')
      : '';
  }

  function mapContextKind() {
    return state.mapContext === 'food-delivery' ? 'food-delivery' : (singleMapTarget() || state.mode);
  }

  function cloneMapPoint(point) {
    const normalised = normaliseCoord(point);
    return normalised ? { ...normalised } : null;
  }

  function committedMapPoints() {
    return {
      pickup: cloneMapPoint(state.pickupCoords),
      delivery: cloneMapPoint(state.deliveryCoords),
      stop: cloneMapPoint(state.stopCoords),
      'food-delivery': cloneMapPoint(state.foodDeliveryCoords)
    };
  }

  function committedMapLabels() {
    return {
      pickup: String($('#order-pickup-address')?.value || ''),
      delivery: String($('#order-delivery-address')?.value || ''),
      stop: String($('#cargo-stop')?.value || ''),
      'food-delivery': String($('#food-delivery-address')?.value || '')
    };
  }

  function beginMapDraft() {
    state.mapDraftLayer?.clearLayers?.();
    state.mapDraftRouteLayer?.clearLayers?.();
    state.mapDraftHistory = [];
    state.mapDraftPartnerSnapshot = {
      selectedPartnerId: state.selectedPartnerId,
      cargoSourceType: state.cargoSourceType,
      partnerId: $('#selected-partner-id')?.value || '',
      partnerEntityType: $('#selected-partner-entity-type')?.value || '',
      partnerSelect: $('#cargo-partner-select')?.value || ''
    };
    state.mapDraft = {
      context: state.mapContext,
      points: committedMapPoints(),
      labels: committedMapLabels(),
      dirty: false,
      quote: null,
      updatedAt: Date.now()
    };
    updateMapDraftUI();
  }

  function activeDraftPoint() {
    return state.mapDraft?.points?.[mapContextKind()] || null;
  }

  function mapDraftPoints() {
    if (!state.mapDraft) return [];
    if (state.mapContext === 'food-delivery') return [state.mapDraft.points['food-delivery']].filter(isValidCoord);
    const target = singleMapTarget();
    if (target) return [state.mapDraft.points[target]].filter(isValidCoord);
    const routeStops = (window.TragoClientCargoStops?.() || []).filter(isValidCoord);
    return [state.mapDraft.points.pickup, ...routeStops, state.mapDraft.points.delivery].filter(isValidCoord);
  }

  function draftPointLabel(kind, point) {
    const prefix = kind === 'pickup' ? 'Recolha'
      : kind === 'stop' ? 'Paragem'
        : kind === 'food-delivery' ? 'Morada de entrega'
          : 'Entrega';
    return `${prefix} · ${Number(point.lat).toFixed(5)}, ${Number(point.lng).toFixed(5)}`;
  }

  function updateMapDraftUI(message = '') {
    const draft = state.mapDraft;
    const target = singleMapTarget();
    const valid = draft && (state.mapContext === 'food-delivery'
      ? isValidCoord(draft.points['food-delivery'])
      : target
        ? isValidCoord(draft.points[target])
        : isValidCoord(draft.points.pickup) && isValidCoord(draft.points.delivery));
    const confirm = $('#btn-confirm-map');
    if (confirm) {
      confirm.disabled = !valid;
      confirm.setAttribute('aria-disabled', String(!valid));
    }
    state.mapNavigationControl?.setDisabled?.('undo-point', !state.mapDraftHistory.length);
    const status = $('#map-draft-status');
    if (status) {
      const kind = mapContextKind();
      const point = draft?.points?.[kind];
      const hasCurrentRoute = state.mapContext === 'delivery-route' && !draft?.dirty
        && isValidCoord(draft?.points?.pickup) && isValidCoord(draft?.points?.delivery);
      status.textContent = message || (hasCurrentRoute
        ? 'Rota actual carregada. Mova um ponto apenas se desejar alterá-la.'
        : isValidCoord(point)
        ? `${draft?.dirty ? 'Alteração por confirmar' : 'Ponto actual'}: ${draft?.labels?.[kind] || draftPointLabel(kind, point)}`
        : 'Mova o mapa ou pesquise uma morada. Nada será gravado sem confirmação.');
    }
    $('#client-map-workspace')?.classList.toggle('has-valid-draft', Boolean(valid));
    $('#client-map-workspace')?.classList.toggle('has-draft-change', Boolean(draft?.dirty));
  }

  function pushMapDraftHistory() {
    if (!state.mapDraft) return;
    state.mapDraftHistory.push({
      points: Object.fromEntries(Object.entries(state.mapDraft.points).map(([key, value]) => [key, cloneMapPoint(value)])),
      labels: { ...state.mapDraft.labels },
      mode: state.mode
    });
    if (state.mapDraftHistory.length > 12) state.mapDraftHistory.shift();
  }

  function undoMapDraftPoint() {
    const previous = state.mapDraftHistory.pop();
    if (!previous || !state.mapDraft) return;
    state.mapDraft.points = previous.points;
    state.mapDraft.labels = previous.labels;
    state.mapDraft.dirty = true;
    setMapMode(previous.mode);
    renderMapDraft({ reverse: false });
    updateMapDraftUI('Última alteração desfeita. Confirme para guardar.');
  }

  function clearActiveDraftPoint() {
    if (!state.mapDraft) return;
    const kind = mapContextKind();
    pushMapDraftHistory();
    state.mapDraft.points[kind] = null;
    state.mapDraft.labels[kind] = '';
    state.mapDraft.dirty = true;
    renderMapDraft({ reverse: false });
    updateMapDraftUI('Ponto removido do rascunho. A alteração ainda não foi guardada.');
  }

  async function reverseGeocodeDraft(kind, coords) {
    clearTimeout(state.reverseTimer);
    state.reverseAbortController?.abort?.();
    const controller = new AbortController();
    state.reverseAbortController = controller;
    state.reverseTimer = setTimeout(async () => {
      try {
        const url = new URL(`${API_URL}/api/public/geo/reverse`);
        url.searchParams.set('lat', String(coords.lat));
        url.searchParams.set('lng', String(coords.lng));
        const response = await fetch(url, { signal: controller.signal });
        const data = await readJsonResponse(response);
        if (!response.ok || !state.mapDraft || !isValidCoord(state.mapDraft.points[kind])) return;
        const current = state.mapDraft.points[kind];
        if (Math.abs(current.lat - coords.lat) > 0.00001 || Math.abs(current.lng - coords.lng) > 0.00001) return;
        state.mapDraft.labels[kind] = data.short_label || data.label || draftPointLabel(kind, coords);
        updateMapDraftUI();
      } catch (error) {
        if (error?.name !== 'AbortError') updateMapDraftUI('Ponto definido. A morada será confirmada ao guardar.');
      }
    }, 360);
  }

  async function fetchClientRouteGeometry(origin, destination) {
    const a = normaliseCoord(origin);
    const b = normaliseCoord(destination);
    if (!a || !b) return { points: [], route: null };
    const key = [a.lat, a.lng, b.lat, b.lng].map((value) => value.toFixed(5)).join(':');
    if (state.routeGeometryCache.has(key)) return state.routeGeometryCache.get(key);
    const pending = (async () => {
      try {
        const route = await window.TragoMapUI?.fetchRoadRoute?.(a, b, {
          apiUrl: API_URL,
          timeoutMs: 7000,
          attempts: 2
        });
        const points = window.TragoMapUI?.roadRouteLatLngs?.(route) || [];
        if (points.length < 3) throw new Error('route');
        return { points, route };
      } catch (_error) {
        return { points: [], route: null };
      }
    })();
    state.routeGeometryCache.set(key, pending);
    if (state.routeGeometryCache.size > 50) state.routeGeometryCache.delete(state.routeGeometryCache.keys().next().value);
    pending.then((result) => {
      if (!result?.points || result.points.length < 3) state.routeGeometryCache.delete(key);
    });
    return pending;
  }

  async function fetchClientRouteSequence(points = []) {
    const valid = points.map(normaliseCoord).filter(Boolean);
    if (valid.length < 2) return { points: [], route: null };
    if (valid.length === 2) return fetchClientRouteGeometry(valid[0], valid[1]);
    try {
      const route = await window.TragoMapUI?.fetchRoadRouteSequence?.(valid, {
        apiUrl: API_URL,
        timeoutMs: 7000,
        attempts: 2
      });
      const routePoints = window.TragoMapUI?.roadRouteLatLngs?.(route) || [];
      return routePoints.length >= 3 ? { points: routePoints, route } : { points: [], route: null };
    } catch (_error) {
      return { points: [], route: null };
    }
  }

  async function renderMapDraft({ fitInitial = false, reverse = false } = {}) {
    if (!state.map || !state.mapDraft || !state.mapDraftLayer || !state.mapDraftRouteLayer) return;
    const draft = state.mapDraft;
    const renderId = ++state.routeRenderId;
    state.mapDraftLayer.clearLayers();
    state.mapDraftRouteLayer.clearLayers();
    syncMapMarkerVisibility(false);
    const visibleKinds = state.mapContext === 'food-delivery'
      ? ['food-delivery']
      : singleMapTarget() ? [singleMapTarget()] : ['pickup', 'delivery'];
    visibleKinds.forEach((kind) => {
      const point = state.mapDraft.points[kind];
      if (!isValidCoord(point)) return;
      const iconKind = kind === 'food-delivery' ? 'delivery' : kind;
      L.marker(point, {
        title: state.mapDraft.labels[kind] || draftPointLabel(kind, point),
        icon: clientMapIcon(iconKind, iconKind === 'pickup' ? 'Recolha' : iconKind === 'stop' ? 'Paragem' : 'Entrega'),
        keyboard: true
      }).addTo(state.mapDraftLayer);
    });
    const cargoRouteStops = state.mapContext === 'delivery-route'
      ? (window.TragoClientCargoStops?.() || []).filter(isValidCoord)
      : [];
    cargoRouteStops.forEach((stop, index) => {
      L.marker(stop, {
        title: stop.address || `Paragem ${index + 1}`,
        icon: clientMapIcon('stop', `Paragem ${index + 1}`),
        keyboard: true
      }).addTo(state.mapDraftLayer);
    });
    if (reverse && isValidCoord(activeDraftPoint())) reverseGeocodeDraft(mapContextKind(), activeDraftPoint());
    if (fitInitial) {
      const points = mapDraftPoints();
      if (points.length) state.mapCamera?.fit(points, {
        paddingTopLeft: [42, 118], paddingBottomRight: [42, 126], maxZoom: 16
      }, { mode: 'initial-fit' });
      else state.mapCamera?.setView([-25.9655, 32.5832], 12, { force: true, mode: 'initial-fit' });
    }
    const origin = draft.points.pickup;
    const destination = draft.points.delivery;
    if (!singleMapTarget() && state.mapContext !== 'food-delivery' && isValidCoord(origin) && isValidCoord(destination)) {
      clearTimeout(state.routeDraftRetryTimer);
      $('#client-map-workspace')?.classList.add('is-route-loading');
      updateMapDraftUI('A calcular o percurso pelas estradas…');
      const roadResult = await fetchClientRouteSequence([origin, ...cargoRouteStops, destination]);
      const geometry = roadResult.points;
      if (renderId !== state.routeRenderId || state.mapDraft !== draft) return;
      $('#client-map-workspace')?.classList.remove('is-route-loading');
      state.mapDraftRouteLayer.clearLayers();
      if (geometry.length < 3) {
        draft.quote = null;
        renderActiveMapQuote();
        updateMapDraftUI('Não foi possível calcular a rota rodoviária. Verifique a ligação e tente novamente.');
        state.routeDraftRetryTimer = setTimeout(() => {
          if (state.mapDraft === draft && state.routeRenderId === renderId) renderMapDraft({ reverse: false });
        }, 4000);
        return;
      }
      if (window.TragoMapUI?.drawRoute) window.TragoMapUI.drawRoute(state.mapDraftRouteLayer, geometry, {
        color: '#69be35', weight: 6, className: 'is-road-route'
      });
      else L.polyline(geometry, { color: '#69be35', weight: 6 }).addTo(state.mapDraftRouteLayer);
      const roadDistance = Number(roadResult.route?.distance_km || 0);
      const quote = roadDistance > 0 ? {
        distance_km: Number(roadDistance.toFixed(2)),
        duration_min: Number(roadResult.route?.duration_min || 0) || Math.max(1, Math.round((roadDistance / 35) * 60)),
        delivery_fee: calculateDeliveryFee(roadDistance),
        source: roadResult.route?.source || 'road_route'
      } : await quotePublicRoute(origin, destination);
      if (renderId !== state.routeRenderId || state.mapDraft !== draft) return;
      draft.quote = quote;
      renderActiveMapQuote();
    } else {
      draft.quote = null;
      renderActiveMapQuote();
    }
    updateMapDraftUI();
  }

  function setDraftPoint(kind, coords, label = '', options = {}) {
    const cleanCoords = normaliseCoord(coords);
    if (!state.mapDraft || !cleanCoords) return false;
    pushMapDraftHistory();
    state.mapDraft.points[kind] = cleanCoords;
    state.mapDraft.labels[kind] = label || draftPointLabel(kind, cleanCoords);
    state.mapDraft.dirty = true;
    state.mapDraft.updatedAt = Date.now();
    renderMapDraft({ reverse: options.reverse !== false });
    updateMapDraftUI('Ponto em pré-visualização. Confirme para guardar.');
    return true;
  }

  function discardMapDraft() {
    clearTimeout(state.reverseTimer);
    state.reverseAbortController?.abort?.();
    state.routeAbortController?.abort?.();
    state.routeRenderId += 1;
    state.mapDraftLayer?.clearLayers?.();
    state.mapDraftRouteLayer?.clearLayers?.();
    state.mapDraft = null;
    state.mapDraftHistory = [];
    syncMapMarkerVisibility(true);
  }

  function commitMapDraft() {
    if (!state.mapDraft) return false;
    const target = singleMapTarget();
    const kinds = state.mapContext === 'food-delivery' ? ['food-delivery'] : target ? [target] : ['pickup', 'delivery'];
    if (kinds.some((kind) => !isValidCoord(state.mapDraft.points[kind]))) return false;
    const previousPickup = cloneMapPoint(state.pickupCoords);
    const pickupChanged = kinds.includes('pickup') && isValidCoord(state.mapDraft.points.pickup)
      && (!previousPickup
        || Math.abs(state.mapDraft.points.pickup.lat - previousPickup.lat) > 0.00001
        || Math.abs(state.mapDraft.points.pickup.lng - previousPickup.lng) > 0.00001);
    kinds.forEach((kind) => placeMarker(kind, state.mapDraft.points[kind], state.mapDraft.labels[kind], {
      recenter: false,
      openPopup: false,
      refresh: false
    }));
    if (kinds.includes('pickup')) {
      if (pickupChanged) {
        state.selectedPartnerId = null;
        state.cargoSourceType = 'map_location';
        setInputValue('#selected-partner-id', '');
        setInputValue('#selected-partner-entity-type', '');
        if ($('#cargo-partner-select')) $('#cargo-partner-select').value = '';
        renderCargoSourceSelection();
      }
    }
    if (kinds.includes('food-delivery')) calculateCartDistance(false);
    else if (kinds.some((kind) => kind !== 'stop')) refreshDeliveryQuote();
    return true;
  }

  function setMapMode(mode) {
    const singleTarget = singleMapTarget();
    const safeMode = state.mapContext === 'food-delivery' ? 'delivery' : (singleTarget || mode);
    state.mode = safeMode;
    state.mapStatusControl?.setLabel?.(
      safeMode === 'pickup' ? 'Marcar recolha'
        : safeMode === 'stop' ? 'Marcar paragem'
          : 'Marcar entrega'
    );
    $$('.map-mode').forEach((btn) => btn.classList.toggle('active', btn.dataset.mode === safeMode));
    const hint = $('#map-mode-hint');
    if (hint) {
      hint.textContent = state.mapContext === 'food-delivery'
        ? 'Toque no mapa para marcar onde pretende receber o pedido.'
        : singleTarget === 'pickup'
          ? 'Toque no mapa para marcar o ponto exacto de compra ou recolha.'
          : singleTarget === 'delivery'
            ? 'Toque no mapa para marcar o destino exacto da entrega.'
            : singleTarget === 'stop'
              ? 'Toque no mapa para adicionar esta paragem intermédia.'
        : safeMode === 'pickup'
          ? 'Marque onde o motorista deve recolher o envio.'
          : 'Agora marque o destino final da entrega.';
    }
  }

  function syncMapContext(context = 'delivery-route') {
    const foodDelivery = context === 'food-delivery';
    const singleTarget = String(context).startsWith('cargo-') ? String(context).replace('cargo-', '') : '';
    state.mapContext = foodDelivery ? 'food-delivery' : (singleTarget ? `cargo-${singleTarget}` : 'delivery-route');
    $('#client-map-workspace')?.classList.toggle('is-food-delivery', foodDelivery);
    $('#client-map-workspace')?.classList.toggle('is-single-point', Boolean(singleTarget));
    const pickupMode = $('.map-mode[data-mode="pickup"]');
    const pickupLocation = $('#btn-use-location-pickup');
    const deliveryLocation = $('#btn-use-location-delivery');
    const modes = $('.v20-map-toolbar > div');
    if (pickupMode) pickupMode.hidden = foodDelivery;
    if (modes) modes.hidden = Boolean(singleTarget);
    if (pickupLocation) pickupLocation.hidden = foodDelivery || (Boolean(singleTarget) && singleTarget !== 'pickup');
    if (deliveryLocation) deliveryLocation.hidden = Boolean(singleTarget) && singleTarget === 'pickup';
    const titleMap = {
      pickup: ['PONTO DE COMPRA/RECOLHA', 'Adicionar recolha pelo mapa'],
      delivery: ['PONTO DE ENTREGA', 'Adicionar entrega pelo mapa'],
      stop: ['PARAGEM INTERMÉDIA', 'Adicionar paragem pelo mapa']
    };
    if ($('#map-context-kicker')) $('#map-context-kicker').textContent = foodDelivery ? 'ENTREGA DO PEDIDO' : (titleMap[singleTarget]?.[0] || 'ROTA DO ENVIO');
    if ($('#map-context-title')) $('#map-context-title').textContent = foodDelivery ? 'Marcar morada de entrega' : (titleMap[singleTarget]?.[1] || 'Definir recolha e entrega');
    if ($('#map-estimate-label')) $('#map-estimate-label').textContent = foodDelivery ? 'Restaurante até ao destino' : (singleTarget ? 'Coordenadas exactas' : 'Estimativa da rota');
    const mapSearch = $('#map-place-search');
    if (mapSearch) {
      mapSearch.value = '';
      mapSearch.placeholder = singleTarget === 'pickup'
        ? 'Pesquisar loja ou ponto de recolha'
        : singleTarget === 'delivery' || foodDelivery
          ? 'Pesquisar destino da entrega'
          : singleTarget === 'stop'
            ? 'Pesquisar local da paragem'
            : 'Pesquisar loja, rua ou local no mapa';
    }
    const confirmText = $('#btn-confirm-map span');
    if (confirmText) confirmText.textContent = foodDelivery ? 'Usar esta morada' : (singleTarget === 'stop' ? 'Adicionar paragem' : singleTarget ? 'Usar este ponto' : 'Confirmar rota');
    const deliveryLocationText = $('#btn-use-location-delivery span');
    if (deliveryLocationText) deliveryLocationText.innerHTML = singleTarget === 'stop'
      ? '<strong>Localizar</strong><small>Paragem</small>'
      : '<strong>Localizar</strong><small>Entrega</small>';
    syncMapMarkerVisibility();
    setMapMode(foodDelivery ? 'delivery' : (singleTarget || (!isValidCoord(state.pickupCoords) ? 'pickup' : 'delivery')));
    renderActiveMapQuote();
  }

  function openMapContext(context, useLocation = false) {
    syncMapContext(context);
    beginMapDraft();
    setPanel('map');
    requestAnimationFrame(() => {
      if (state.mapDraft) {
        state.map?.invalidateSize?.();
        renderMapDraft({ fitInitial: true });
        if (useLocation) useMyLocation(context === 'food-delivery' ? 'food-delivery' : state.mode);
        return;
      }
      if (state.mapContext === 'food-delivery') {
        const coords = getFoodDeliveryCoords();
        if (coords) placeMarker('food-delivery', coords, $('#food-delivery-address')?.value || 'Morada de entrega');
      } else {
        const pickup = { lat: Number($('#pickup-lat')?.value), lng: Number($('#pickup-lng')?.value) };
        const delivery = { lat: Number($('#delivery-lat')?.value), lng: Number($('#delivery-lng')?.value) };
        if (isValidCoord(pickup)) placeMarker('pickup', pickup, $('#order-pickup-address')?.value || 'Ponto de recolha');
        if (isValidCoord(delivery)) placeMarker('delivery', delivery, $('#order-delivery-address')?.value || 'Ponto de entrega');
      }
      if (useLocation) useMyLocation(context === 'food-delivery' ? 'food-delivery' : state.mode);
    });
  }

  function openPointMap(target) {
    const safeTarget = ['pickup', 'delivery', 'stop'].includes(String(target)) ? String(target) : 'pickup';
    const partnerSnapshot = {
      selectedPartnerId: state.selectedPartnerId,
      cargoSourceType: state.cargoSourceType,
      partnerId: $('#selected-partner-id')?.value || '',
      partnerEntityType: $('#selected-partner-entity-type')?.value || '',
      partnerSelect: $('#cargo-partner-select')?.value || ''
    };
    if (safeTarget === 'pickup') {
      state.selectedPartnerId = null;
      state.cargoSourceType = '';
      setInputValue('#selected-partner-id', '');
      setInputValue('#selected-partner-entity-type', '');
      if ($('#cargo-partner-select')) $('#cargo-partner-select').value = '';
      renderCargoSourceSelection();
    }
    state.selectedPartnerId = partnerSnapshot.selectedPartnerId;
    state.cargoSourceType = partnerSnapshot.cargoSourceType;
    setInputValue('#selected-partner-id', partnerSnapshot.partnerId);
    setInputValue('#selected-partner-entity-type', partnerSnapshot.partnerEntityType);
    if ($('#cargo-partner-select')) $('#cargo-partner-select').value = partnerSnapshot.partnerSelect;
    renderCargoSourceSelection();
    state.mapTarget = safeTarget;
    syncMapContext(`cargo-${safeTarget}`);
    beginMapDraft();
    setPanel('map');
    requestAnimationFrame(() => {
      if (state.mapDraft) {
        state.map?.invalidateSize?.();
        renderMapDraft({ fitInitial: true });
        return;
      }
      const coords = safeTarget === 'pickup' ? state.pickupCoords : safeTarget === 'delivery' ? state.deliveryCoords : state.stopCoords;
      const label = safeTarget === 'pickup'
        ? $('#order-pickup-address')?.value
        : safeTarget === 'delivery'
          ? $('#order-delivery-address')?.value
          : $('#cargo-stop')?.value;
      if (isValidCoord(coords)) placeMarker(safeTarget, coords, label || '');
      state.map?.invalidateSize?.();
    });
  }

  function closeMapContext({ confirm = false } = {}) {
    if (confirm) {
      if (!commitMapDraft()) {
        toast(state.mapContext === 'delivery-route'
          ? 'Marque a recolha e a entrega antes de continuar.'
          : 'Marque um ponto exacto no mapa antes de continuar.', 'error');
        return;
      }
    }
    discardMapDraft();
    if (state.mapContext === 'food-delivery') {
      if (confirm && !getFoodDeliveryCoords()) {
        toast('Marque a morada de entrega antes de continuar.', 'error');
        return;
      }
      backPanel('food');
      setTimeout(openCartModal, 0);
      return;
    }
    const target = singleMapTarget();
    if (target) {
      const coords = target === 'pickup' ? state.pickupCoords : target === 'delivery' ? state.deliveryCoords : state.stopCoords;
      if (confirm && !isValidCoord(coords)) {
        toast('Marque um ponto exacto no mapa antes de continuar.', 'error');
        return;
      }
      if (confirm && target === 'stop') {
        const address = String($('#cargo-stop')?.value || `Paragem no mapa · ${Number(coords.lat).toFixed(5)}, ${Number(coords.lng).toFixed(5)}`).trim();
        window.TragoClientAddCargoStop?.({ address, lat: Number(coords.lat), lng: Number(coords.lng), source: 'map' });
        setInputValue('#cargo-stop', '');
        state.stopCoords = null;
        if (state.stopMarker) {
          state.map?.removeLayer(state.stopMarker);
          state.stopMarker = null;
        }
      }
      if (confirm && target === 'pickup') {
        state.cargoSourceType = state.selectedPartnerId ? 'partner' : 'map_location';
        renderCargoSourceSelection();
      }
      state.mapTarget = null;
      backPanel('delivery');
      return;
    }
    if (confirm && (!isValidCoord(state.pickupCoords) || !isValidCoord(state.deliveryCoords))) {
      toast('Marque a recolha e a entrega antes de continuar.', 'error');
      return;
    }
    backPanel('delivery');
  }

  function setInputValue(selector, value) {
    const el = $(selector);
    if (el) el.value = value ?? '';
  }

  function setMarkerVisible(marker, visible) {
    if (!state.map || !marker) return;
    const active = state.map.hasLayer(marker);
    if (visible && !active) marker.addTo(state.map);
    if (!visible && active) state.map.removeLayer(marker);
  }

  function syncMapMarkerVisibility(showCommitted = !state.mapDraft) {
    const foodDelivery = state.mapContext === 'food-delivery';
    const target = singleMapTarget();
    setMarkerVisible(state.pickupMarker, showCommitted && !foodDelivery && (!target || target === 'pickup'));
    setMarkerVisible(state.deliveryMarker, showCommitted && !foodDelivery && (!target || target === 'delivery'));
    setMarkerVisible(state.stopMarker, showCommitted && target === 'stop');
    setMarkerVisible(state.foodDeliveryMarker, showCommitted && foodDelivery);
  }

  function fitMapRoute() {
    if (!state.map || !isValidCoord(state.pickupCoords) || !isValidCoord(state.deliveryCoords)) return;
    const bounds = L.latLngBounds([state.pickupCoords, state.deliveryCoords]);
    state.map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
  }

  async function drawRouteLine() {
    if (!state.map) return;
    if (state.routeCasing) {
      state.map.removeLayer(state.routeCasing);
      state.routeCasing = null;
    }
    if (state.routeLine) {
      state.map.removeLayer(state.routeLine);
      state.routeLine = null;
    }
    if (state.mapContext === 'food-delivery' || singleMapTarget()) return;
    if (isValidCoord(state.pickupCoords) && isValidCoord(state.deliveryCoords)) {
      const routeResult = await fetchClientRouteGeometry(state.pickupCoords, state.deliveryCoords);
      const points = routeResult.points;
      if (points.length < 3) return;
      if (window.TragoMapUI?.drawRoute) {
        const route = window.TragoMapUI.drawRoute(state.map, points, { color: '#69be35', weight: 6 });
        state.routeCasing = route.casing;
        state.routeLine = route.line;
      } else {
        state.routeCasing = L.polyline(points, { color: '#fff', weight: 11, opacity: 0.94, lineCap: 'round', lineJoin: 'round' }).addTo(state.map);
        state.routeLine = L.polyline(points, { color: '#69be35', weight: 6, opacity: 0.98, lineCap: 'round', lineJoin: 'round' }).addTo(state.map);
      }
    }
  }

  function placeMarker(kind, coords, label = '', options = {}) {
    const cleanCoords = normaliseCoord(coords);
    if (!cleanCoords) return;
    if (kind === 'food-delivery') {
      state.foodDeliveryCoords = cleanCoords;
      setInputValue('#food-delivery-lat', cleanCoords.lat.toFixed(6));
      setInputValue('#food-delivery-lng', cleanCoords.lng.toFixed(6));
      if (!state.foodDeliveryMarker && state.map) state.foodDeliveryMarker = L.marker(cleanCoords, {
        title: 'Entrega da comida',
        icon: clientMapIcon('delivery', 'A sua entrega')
      }).addTo(state.map);
      setMarkerVisible(state.foodDeliveryMarker, state.mapContext === 'food-delivery');
      state.foodDeliveryMarker?.setLatLng(cleanCoords).bindPopup(label || 'Morada de entrega');
      if (options.openPopup !== false) state.foodDeliveryMarker?.openPopup();
    } else if (kind === 'pickup') {
      state.pickupCoords = cleanCoords;
      setInputValue('#pickup-lat', cleanCoords.lat.toFixed(6));
      setInputValue('#pickup-lng', cleanCoords.lng.toFixed(6));
      const pickupLabel = label || `Ponto no mapa · ${cleanCoords.lat.toFixed(5)}, ${cleanCoords.lng.toFixed(5)}`;
      setInputValue('#order-pickup-address', pickupLabel);
      if (!state.pickupMarker && state.map) state.pickupMarker = L.marker(cleanCoords, {
        title: 'Recolha',
        icon: clientMapIcon('pickup', 'Recolha')
      }).addTo(state.map);
      setMarkerVisible(state.pickupMarker, state.mapContext !== 'food-delivery');
      state.pickupMarker?.setLatLng(cleanCoords).bindPopup(pickupLabel);
      if (options.openPopup !== false) state.pickupMarker?.openPopup();
      if ($('#route-pickup-label')) $('#route-pickup-label').textContent = pickupLabel;
      if (!singleMapTarget()) setMapMode('delivery');
    } else if (kind === 'delivery') {
      state.deliveryCoords = cleanCoords;
      setInputValue('#delivery-lat', cleanCoords.lat.toFixed(6));
      setInputValue('#delivery-lng', cleanCoords.lng.toFixed(6));
      const deliveryLabel = label || `Destino no mapa · ${cleanCoords.lat.toFixed(5)}, ${cleanCoords.lng.toFixed(5)}`;
      setInputValue('#order-delivery-address', deliveryLabel);
      if (!state.deliveryMarker && state.map) state.deliveryMarker = L.marker(cleanCoords, {
        title: 'Entrega',
        icon: clientMapIcon('delivery', 'Entrega')
      }).addTo(state.map);
      setMarkerVisible(state.deliveryMarker, state.mapContext !== 'food-delivery');
      state.deliveryMarker?.setLatLng(cleanCoords).bindPopup(deliveryLabel);
      if (options.openPopup !== false) state.deliveryMarker?.openPopup();
      if ($('#route-delivery-label')) $('#route-delivery-label').textContent = deliveryLabel;
    } else if (kind === 'stop') {
      state.stopCoords = cleanCoords;
      const stopLabel = label || `Paragem no mapa · ${cleanCoords.lat.toFixed(5)}, ${cleanCoords.lng.toFixed(5)}`;
      setInputValue('#cargo-stop', stopLabel);
      if (!state.stopMarker && state.map) state.stopMarker = L.marker(cleanCoords, {
        title: 'Paragem',
        icon: clientMapIcon('stop', 'Paragem')
      }).addTo(state.map);
      setMarkerVisible(state.stopMarker, singleMapTarget() === 'stop');
      state.stopMarker?.setLatLng(cleanCoords).bindPopup(stopLabel);
      if (options.openPopup !== false) state.stopMarker?.openPopup();
    }
    if (options.recenter !== false && state.map) {
      const zoom = Math.max(state.map.getZoom?.() || 14, 14);
      if (state.mapCamera?.setView) state.mapCamera.setView(cleanCoords, zoom, { force: true, mode: 'free' });
      else state.map.setView(cleanCoords, zoom);
    }
    drawRouteLine();
    if (options.refresh !== false) {
      if (kind === 'food-delivery') calculateCartDistance(false);
      else if (kind !== 'stop') refreshDeliveryQuote();
    }
  }

  async function resolveSavedAddressPoint(address) {
    const label = String(address?.address || address?.label || '').trim();
    let coords = normaliseCoord(address);
    let resolvedLabel = label;
    if (!coords && label.length >= 4) {
      const suggestion = (await searchAddresses(label, { limit: 3 }))[0];
      coords = normaliseCoord(suggestion);
      resolvedLabel = String(suggestion?.label || suggestion?.short_label || label).trim();
      if (coords && window.TragoFeedback?.confirm) {
        const confirmed = await window.TragoFeedback.confirm({
          type: 'info',
          title: 'Confirmar localização encontrada?',
          message: `${resolvedLabel}. Confirme antes de calcular a rota e o preço.`,
          confirmText: 'Usar localização',
          cancelText: 'Editar endereço'
        });
        if (!confirmed) throw new Error('Localização não aplicada. Edite o endereço e associe um ponto exacto.');
      }
    }
    if (!coords) throw new Error('Este endereço ainda não tem uma localização exacta. Edite-o e associe a localização actual.');
    return { coords, label: resolvedLabel || String(address?.label || 'Endereço guardado') };
  }

  async function useSavedAddress(address, target = 'delivery', options = {}) {
    const safeTarget = ['pickup', 'delivery', 'food-delivery'].includes(target) ? target : 'delivery';
    const resolved = await resolveSavedAddressPoint(address);
    const inputSelector = safeTarget === 'pickup'
      ? '#order-pickup-address'
      : safeTarget === 'food-delivery' ? '#food-delivery-address' : '#order-delivery-address';
    const input = $(inputSelector);
    if (input) {
      input.value = resolved.label;
      input.dataset.resolvedAddress = resolved.label;
      input.dataset.savedAddressId = String(address?.id || '');
      delete input.dataset.addressSuggestion;
    }
    if (safeTarget === 'pickup') {
      state.selectedPartnerId = null;
      state.cargoSourceType = 'map_location';
      setInputValue('#selected-partner-id', '');
      setInputValue('#selected-partner-entity-type', '');
      if ($('#cargo-partner-select')) $('#cargo-partner-select').value = '';
    }
    placeMarker(safeTarget, resolved.coords, resolved.label, { openPopup: false, recenter: false });
    if (safeTarget === 'pickup') renderCargoSourceSelection();
    if (options.openPanel !== false) {
      setPanel(safeTarget === 'food-delivery' ? 'food' : 'delivery');
      window.scrollTo({ top: 0, behavior: 'auto' });
    }
    document.dispatchEvent(new CustomEvent('trago:saved-address-used', {
      detail: { address, target: safeTarget, coords: resolved.coords, label: resolved.label }
    }));
    return { ...resolved, target: safeTarget };
  }

  window.TragoClientUseSavedAddress = useSavedAddress;

  function initMap() {
    const mapEl = $('#client-map');
    if (!mapEl || typeof L === 'undefined') return;
    state.map = L.map(mapEl, {
      zoomControl: false,
      attributionControl: true,
      scrollWheelZoom: true,
      preferCanvas: true,
      touchZoom: true,
      doubleClickZoom: true,
      keyboard: true,
      boxZoom: false
    }).setView([-25.9655, 32.5832], 12);
    addClientBaseMap(state.map);
    state.mapCamera = window.TragoMapUI?.createCameraController?.(state.map) || null;
    state.map._tragoCamera = state.mapCamera;
    window.TragoMapUI?.observeMapSize?.(state.map);
    if (window.TragoMapUI?.addZoomControl) window.TragoMapUI.addZoomControl(state.map);
    else L.control.zoom({ position: 'bottomright' }).addTo(state.map);
    state.mapStatusControl = window.TragoMapUI?.addStatusControl?.(state.map, {
      label: 'Marcar recolha',
      icon: 'fa-location-crosshairs',
      position: 'topright'
    }) || null;
    state.mapNavigationControl = window.TragoMapUI?.addNavigationControl?.(state.map, {
      label: 'Navegação da rota',
      position: 'topright',
      actions: [
        { id: 'fit-route', icon: 'fa-route', title: 'Ver toda a rota', onClick: focusClientRoute },
        { id: 'undo-point', icon: 'fa-rotate-left', title: 'Desfazer última alteração', onClick: undoMapDraftPoint }
      ]
    }) || null;
    state.mapNavigationControl?.setDisabled?.('undo-point', true);
    state.mapDraftRouteLayer = L.layerGroup().addTo(state.map);
    state.mapDraftLayer = L.layerGroup().addTo(state.map);
    state.map.on('click', (event) => {
      if (!state.mapDraft) return;
      state.mapCamera?.setMode?.('free');
      state.map.panTo(event.latlng, { animate: true });
      setDraftPoint(mapContextKind(), { lat: event.latlng.lat, lng: event.latlng.lng });
    });
    state.map.on('dragend', () => {
      if (!state.mapDraft) return;
      const center = state.map.getCenter();
      setDraftPoint(mapContextKind(), { lat: center.lat, lng: center.lng });
    });
    let keyboardPreviewTimer = null;
    mapEl.addEventListener('keydown', (event) => {
      if (!state.mapDraft || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      state.mapCamera?.setMode?.('free');
      clearTimeout(keyboardPreviewTimer);
      keyboardPreviewTimer = setTimeout(() => {
        const center = state.map.getCenter();
        setDraftPoint(mapContextKind(), { lat: center.lat, lng: center.lng });
      }, 220);
    });
    window.TragoMapUI?.syncPartnerLayer?.(state.map, clientMapPartners());
  }

  function useMyLocation(target = 'delivery') {
    if (!navigator.geolocation) {
      toast('Este navegador não disponibiliza localização.', 'error');
      return;
    }
    navigator.geolocation.getCurrentPosition((pos) => {
      const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      syncCatalogLocation(coords);
      if (target === 'pickup') setMapMode('pickup');
      else setMapMode(target === 'stop' ? 'stop' : 'delivery');
      const label = target === 'pickup'
        ? 'Minha localização como recolha'
        : target === 'food-delivery'
          ? 'Minha morada de entrega'
          : target === 'stop'
            ? 'Minha localização como paragem'
            : 'Minha localização como entrega';
      if (state.mapDraft) setDraftPoint(target, coords, label, { reverse: true });
      else placeMarker(target, coords, label);
      state.mapCamera?.setView?.(coords, 17, { force: true, mode: 'free' });
      const accuracy = Math.max(0, Number(pos.coords.accuracy || 0));
      if (state.mapAccuracyCircle) state.mapAccuracyCircle.setLatLng(coords).setRadius(accuracy);
      else if (accuracy && state.map) state.mapAccuracyCircle = L.circle(coords, {
        radius: accuracy, color: '#2589ff', weight: 1, opacity: 0.5,
        fillColor: '#2589ff', fillOpacity: 0.1, interactive: false
      }).addTo(state.map);
      toast(`Localização em pré-visualização${accuracy ? ` (precisão aproximada: ${Math.round(accuracy)} m)` : ''}. Confirme para guardar.`);
    }, (error) => toast(error?.code === 1
      ? 'Permissão de localização recusada. Pesquise a morada manualmente.'
      : 'Não foi possível obter a localização.', 'error'), {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 15000
    });
  }

  function haversineKm(origin, destination) {
    const R = 6371;
    const dLat = (Number(destination.lat) - Number(origin.lat)) * Math.PI / 180;
    const dLng = (Number(destination.lng) - Number(origin.lng)) * Math.PI / 180;
    const lat1 = Number(origin.lat) * Math.PI / 180;
    const lat2 = Number(destination.lat) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }


  function readCatalogLocation() {
    const runtime = window.TragoClientLocation?.read?.();
    if (isValidCoord(runtime)) return normaliseCoord(runtime);
    try {
      const cached = JSON.parse(localStorage.getItem(CURRENT_LOCATION_KEY) || 'null');
      return isValidCoord(cached) ? normaliseCoord(cached) : null;
    } catch {
      return null;
    }
  }

  function syncCatalogLocation(location = null, { render = true } = {}) {
    state.catalogLocation = isValidCoord(location) ? normaliseCoord(location) : readCatalogLocation();
    if (render && state.restaurantsLoaded) renderAllFoodViews();
    return state.catalogLocation;
  }

  function restaurantDistanceKm(restaurant) {
    const clientLocation = isValidCoord(state.catalogLocation) ? state.catalogLocation : readCatalogLocation();
    const restaurantLocation = normaliseCoord(restaurant?.address_coords);
    if (!clientLocation || !restaurantLocation) return null;
    const value = haversineKm(clientLocation, restaurantLocation);
    return Number.isFinite(value) ? value : null;
  }

  function restaurantDistanceText(restaurant, unavailable = 'Activar localização') {
    const distance = restaurantDistanceKm(restaurant);
    if (distance === null) return unavailable;
    if (distance < 1) return `≈ ${Math.max(50, Math.round(distance * 1000 / 50) * 50)} m de si`;
    return `≈ ${distance.toFixed(distance < 10 ? 1 : 0)} km de si`;
  }

  function restaurantDistanceMarkup(restaurant, className = 'v20-catalog-distance') {
    const available = restaurantDistanceKm(restaurant) !== null;
    return `<span class="${className}${available ? '' : ' is-unavailable'}"><i class="fa-solid fa-location-arrow"></i>${escapeHtml(restaurantDistanceText(restaurant))}</span>`;
  }

  function primaryRestaurantCoupon(restaurant) {
    const coupons = Array.isArray(restaurant?.coupons) ? restaurant.coupons : [];
    return coupons.find((coupon) => coupon?.code && coupon?.discount_label) || coupons[0] || null;
  }

  function restaurantCouponMarkup(restaurant, className = 'v20-catalog-coupon') {
    const coupon = primaryRestaurantCoupon(restaurant);
    if (!coupon) return '';
    const label = coupon.discount_label || coupon.name || `Cupão ${coupon.code}`;
    return `<span class="${className}" title="Código ${escapeHtml(coupon.code || '')}"><i class="fa-solid fa-ticket"></i>${escapeHtml(label)}</span>`;
  }

  function restaurantCouponBanner(restaurant) {
    const coupon = primaryRestaurantCoupon(restaurant);
    if (!coupon) return '';
    return `<div class="v20-restaurant-coupon-banner"><i class="fa-solid fa-ticket"></i><span><small>CUPÃO DISPONÍVEL</small><strong>${escapeHtml(coupon.discount_label || coupon.name || 'Desconto disponível')}</strong><b>Código ${escapeHtml(coupon.code || '')}</b><em>${escapeHtml(coupon.conditions || coupon.description || 'Consulte as condições no checkout.')}</em></span></div>`;
  }


  let catalogCouponsPromise = null;
  async function loadPublicCatalogCoupons({ force = false } = {}) {
    if (catalogCouponsPromise && !force) return catalogCouponsPromise;
    const supabaseUrl = String(window.TRAGO_SUPABASE_URL || '').replace(/\/$/, '');
    const anonKey = String(window.TRAGO_SUPABASE_ANON_KEY || '').trim();
    if (!supabaseUrl || !anonKey) return [];
    catalogCouponsPromise = fetch(`${supabaseUrl}/rest/v1/rpc/trago_public_catalog_coupons`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`
      },
      body: '{}'
    }).then(async (response) => {
      const data = await readJsonResponse(response);
      if (!response.ok) throw new Error(data.message || 'Não foi possível carregar os cupões do catálogo.');
      return registerCatalogCoupons(Array.isArray(data) ? data : []);
    }).catch(() => state.catalogCoupons).finally(() => {
      if (force) catalogCouponsPromise = null;
    });
    return catalogCouponsPromise;
  }

  function mergeRestaurantCoupons(restaurants, coupons) {
    const byRestaurant = new Map();
    (Array.isArray(coupons) ? coupons : []).forEach((coupon) => {
      const key = String(coupon.restaurant_id || '');
      if (!key || !coupon.code) return;
      byRestaurant.set(key, [...(byRestaurant.get(key) || []), coupon]);
    });
    return (Array.isArray(restaurants) ? restaurants : []).map((restaurant) => {
      const existing = Array.isArray(restaurant.coupons) ? restaurant.coupons : [];
      const merged = new Map();
      [...existing, ...(byRestaurant.get(String(restaurant.id)) || [])].forEach((coupon) => {
        const key = `${String(coupon.source || 'restaurant')}:${String(coupon.restaurant_id || restaurant.id)}:${String(coupon.code || '').toUpperCase()}`;
        if (coupon.code) merged.set(key, coupon);
      });
      return { ...restaurant, coupons: [...merged.values()] };
    });
  }

  function registerCatalogCoupons(coupons) {
    const merged = new Map();
    [...(Array.isArray(state.catalogCoupons) ? state.catalogCoupons : []), ...(Array.isArray(coupons) ? coupons : [])].forEach((coupon) => {
      const key = `${String(coupon?.source || 'platform')}:${String(coupon?.restaurant_id || '')}:${String(coupon?.code || '').trim().toUpperCase()}`;
      if (coupon?.code) merged.set(key, coupon);
    });
    state.catalogCoupons = [...merged.values()];
    return state.catalogCoupons;
  }

  window.TragoClientCatalogCoupons = Object.freeze({
    load: (force = false) => loadPublicCatalogCoupons({ force }),
    merge: mergeRestaurantCoupons,
    register: registerCatalogCoupons
  });

  function calculateDeliveryFee(distanceKm) {
    const distance = Math.max(0, Number(distanceKm) || 0);
    if (distance <= PRICING_POLICY.baseDistanceKm) return PRICING_POLICY.baseFeeMzn;
    const extraKm = Math.ceil(distance - PRICING_POLICY.baseDistanceKm);
    return PRICING_POLICY.baseFeeMzn + (extraKm * PRICING_POLICY.extraKmFeeMzn);
  }

  async function quotePublicRoute(origin, destination) {
    if (!isValidCoord(origin) || !isValidCoord(destination)) throw new Error('Coordenadas de recolha e entrega são obrigatórias.');
    let serverQuote = null;
    try {
      const response = await fetch(`${API_URL}/api/public/geo/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ origin, destination })
      });
      const data = await readJsonResponse(response);
      if (!response.ok) throw new Error(data.message || 'Falha ao calcular rota.');
      serverQuote = data;
      if (!String(data.source || '').includes('fallback')) return data;
    } catch (_error) { /* tenta o motor rodoviário partilhado */ }
    try {
      const route = await window.TragoMapUI?.fetchRoadRoute?.(origin, destination, {
        apiUrl: API_URL,
        timeoutMs: 7000
      });
      const distanceKm = Number(route?.distance_km || 0);
      if (distanceKm > 0 && Array.isArray(route?.geometry?.coordinates) && route.geometry.coordinates.length > 2) {
        return {
          distance_km: Number(distanceKm.toFixed(2)),
          duration_min: Number(route.duration_min || 0) || Math.max(1, Math.round((distanceKm / 35) * 60)),
          delivery_fee: calculateDeliveryFee(distanceKm),
          source: route.source || 'road_route'
        };
      }
    } catch (_error) { /* usa estimativa final abaixo */ }
    if (serverQuote) return serverQuote;
    const distanceKm = haversineKm(origin, destination);
    return {
      distance_km: Number(distanceKm.toFixed(2)),
      duration_min: Math.max(1, Math.round((distanceKm / 35) * 60)),
      delivery_fee: calculateDeliveryFee(distanceKm),
      source: 'frontend_haversine'
    };
  }

  function debounce(fn, wait = 320) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), wait);
    };
  }

  async function searchAddresses(query, { limit = 8, signal } = {}) {
    const cleanQuery = String(query || '').trim();
    if (cleanQuery.length < 3) return [];
    const cacheKey = `${cleanQuery.toLowerCase()}::${limit}`;
    if (state.addressSearchCache.has(cacheKey)) return state.addressSearchCache.get(cacheKey);
    const url = new URL(`${API_URL}/api/public/geo/search`);
    url.searchParams.set('q', cleanQuery);
    url.searchParams.set('limit', String(limit));
    if (isValidCoord(state.deliveryCoords)) {
      url.searchParams.set('lat', String(state.deliveryCoords.lat));
      url.searchParams.set('lng', String(state.deliveryCoords.lng));
    }
    const response = await fetch(url.toString(), { signal });
    const data = await readJsonResponse(response);
    if (!response.ok) throw new Error(data.message || 'Não foi possível procurar endereços.');
    const suggestions = Array.isArray(data.suggestions) ? data.suggestions : [];
    state.addressSearchCache.set(cacheKey, suggestions);
    return suggestions;
  }

  window.TragoClientResolveAddress = async (query) => {
    const suggestions = await searchAddresses(query, { limit: 1 });
    return suggestions[0] || null;
  };

  function hideAddressSuggestions(inputId) {
    const box = document.querySelector(`[data-suggestions-for="${inputId}"]`);
    if (box) {
      box.innerHTML = '';
      box.classList.remove('show');
    }
  }

  function renderAddressSuggestions(input, suggestions, config) {
    const box = document.querySelector(`[data-suggestions-for="${input.id}"]`);
    if (!box) return;
    if (!suggestions.length) {
      box.innerHTML = '<div class="address-suggestion-empty">Sem sugestões para este texto.</div>';
      box.classList.add('show');
      return;
    }
    box.innerHTML = suggestions.map((item, index) => `
      <button type="button" class="address-suggestion-item" data-address-index="${index}">
        <i class="fas fa-location-dot"></i>
        <span><strong>${escapeHtml(item.short_label || item.label)}</strong><small>${escapeHtml(item.label || '')}</small></span>
      </button>
    `).join('');
    box.classList.add('show');
    box.querySelectorAll('[data-address-index]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const selected = suggestions[Number(btn.dataset.addressIndex)];
        if (!selected) return;
        input.value = selected.label || selected.short_label || input.value;
        input.dataset.resolvedAddress = input.value.trim();
        delete input.dataset.addressSuggestion;
        const coords = { lat: Number(selected.lat), lng: Number(selected.lng) };
        if (isValidCoord(coords)) {
          if (config.latSelector) setInputValue(config.latSelector, coords.lat.toFixed(6));
          if (config.lngSelector) setInputValue(config.lngSelector, coords.lng.toFixed(6));
          if (config.kind === 'partner-application') {
            const locationState = $('#partner-application-location-state');
            if (locationState) locationState.textContent = `Localização confirmada · ${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`;
          } else {
            const markerKind = config.kind === 'map-search'
              ? (config.resolvedKind || (state.mapContext === 'food-delivery' ? 'food-delivery' : (singleMapTarget() || state.mode)))
              : config.kind;
            const selectedLabel = selected.short_label || selected.label || 'Endereço seleccionado';
            if (config.kind === 'map-search' && state.mapDraft) {
              setDraftPoint(markerKind, coords, selectedLabel, { reverse: false });
              state.mapCamera?.setView?.(coords, 17, { force: true, mode: 'free' });
            } else placeMarker(markerKind, coords, selectedLabel);
            if (markerKind === 'pickup' && config.kind !== 'map-search') {
              state.selectedPartnerId = null;
              state.cargoSourceType = 'map_location';
              setInputValue('#selected-partner-id', '');
              setInputValue('#selected-partner-entity-type', '');
              if ($('#cargo-partner-select')) $('#cargo-partner-select').value = '';
              renderCargoSourceSelection();
            }
          }
        }
        hideAddressSuggestions(input.id);
      });
    });
  }

  function setupAddressAutocomplete(config) {
    const input = $(config.inputSelector);
    if (!input) return;
    const runSearch = debounce(async () => {
      const query = input.value.trim();
      if (query.length < 3) {
        hideAddressSuggestions(input.id);
        return;
      }
      const resolvedKind = config.kind === 'map-search' ? mapContextKind() : config.kind;
      try {
        state.addressSearchControllers.get(input.id)?.abort?.();
        const controller = new AbortController();
        state.addressSearchControllers.set(input.id, controller);
        const suggestions = await searchAddresses(query, { limit: 8, signal: controller.signal });
        if (input.value.trim() !== query) return;
        renderAddressSuggestions(input, suggestions, {
          ...config,
          resolvedKind
        });
      } catch (error) {
        if (error?.name === 'AbortError') return;
        const box = document.querySelector(`[data-suggestions-for="${input.id}"]`);
        if (box) {
          box.innerHTML = `<div class="address-suggestion-empty">${escapeHtml(error.message)}</div>`;
          box.classList.add('show');
        }
      }
    }, 340);
    input.addEventListener('input', () => {
      const value = input.value.trim();
      if (input.dataset.resolvedAddress && value !== input.dataset.resolvedAddress) {
        setInputValue(config.latSelector, '');
        setInputValue(config.lngSelector, '');
        delete input.dataset.resolvedAddress;
        delete input.dataset.addressSuggestion;
        if (config.kind === 'pickup') {
          state.selectedPartnerId = null;
          state.cargoSourceType = '';
          setInputValue('#selected-partner-id', '');
          setInputValue('#selected-partner-entity-type', '');
          if ($('#cargo-partner-select')) $('#cargo-partner-select').value = '';
          renderCargoSourceSelection();
          state.pickupCoords = null;
          if (state.pickupMarker) state.map?.removeLayer(state.pickupMarker);
          state.pickupMarker = null;
          state.deliveryQuote = null;
          updateDeliveryQuoteLabels(null);
        } else if (config.kind === 'food-delivery') {
          state.foodDeliveryCoords = null;
          if (state.foodDeliveryMarker) state.map?.removeLayer(state.foodDeliveryMarker);
          state.foodDeliveryMarker = null;
          state.foodQuote = null;
          renderCartQuote();
        } else if (config.kind === 'partner-application') {
          const locationState = $('#partner-application-location-state');
          if (locationState) locationState.textContent = 'Obrigatório · escolha uma sugestão ou confirme a localização actual';
        } else if (config.kind === 'map-search') {
          // A pesquisa do mapa é apenas uma ferramenta de posicionamento.
        } else {
          state.deliveryCoords = null;
          if (state.deliveryMarker) state.map?.removeLayer(state.deliveryMarker);
          state.deliveryMarker = null;
          state.deliveryQuote = null;
          updateDeliveryQuoteLabels(null);
        }
        drawRouteLine();
      }
      runSearch();
    });
    input.addEventListener('focus', () => { if (input.value.trim().length >= 3) runSearch(); });
    input.addEventListener('keydown', (event) => { if (event.key === 'Escape') hideAddressSuggestions(input.id); });
  }

  async function ensureAddressCoordinates({ inputSelector, kind, latSelector, lngSelector }) {
    const fallbackCoords = kind === 'pickup'
      ? state.pickupCoords
      : kind === 'food-delivery'
        ? state.foodDeliveryCoords
        : state.deliveryCoords;
    const existing = {
      lat: Number($(latSelector)?.value || fallbackCoords?.lat),
      lng: Number($(lngSelector)?.value || fallbackCoords?.lng)
    };
    if (isValidCoord(existing)) {
      if (kind === 'pickup') state.pickupCoords = existing;
      else if (kind === 'food-delivery') state.foodDeliveryCoords = existing;
      else state.deliveryCoords = existing;
      return existing;
    }
    const input = $(inputSelector);
    const query = input?.value?.trim();
    if (!query || query.length < 4) return null;
    try {
      const [first] = await searchAddresses(query, { limit: 1 });
      if (!first) return null;
      const coords = { lat: Number(first.lat), lng: Number(first.lng) };
      if (!isValidCoord(coords)) return null;
      if (latSelector) setInputValue(latSelector, coords.lat.toFixed(6));
      if (lngSelector) setInputValue(lngSelector, coords.lng.toFixed(6));
      input.dataset.resolvedAddress = input.value.trim();
      placeMarker(kind, coords, first.short_label || first.label || query);
      return coords;
    } catch (_error) {
      return null;
    }
  }

  function initAddressAutocomplete() {
    setupAddressAutocomplete({ inputSelector: '#order-pickup-address', kind: 'pickup', latSelector: '#pickup-lat', lngSelector: '#pickup-lng' });
    setupAddressAutocomplete({ inputSelector: '#order-delivery-address', kind: 'delivery', latSelector: '#delivery-lat', lngSelector: '#delivery-lng' });
    setupAddressAutocomplete({ inputSelector: '#food-delivery-address', kind: 'food-delivery', latSelector: '#food-delivery-lat', lngSelector: '#food-delivery-lng' });
    setupAddressAutocomplete({ inputSelector: '#partner-application-address', kind: 'partner-application', latSelector: '#partner-application-form [name="lat"]', lngSelector: '#partner-application-form [name="lng"]' });
    setupAddressAutocomplete({ inputSelector: '#map-place-search', kind: 'map-search' });
    document.addEventListener('click', (event) => {
      if (!event.target.closest('.address-field')) $$('.address-suggestions.show').forEach((box) => box.classList.remove('show'));
    });
  }

  function updateDeliveryQuoteLabels(quote = null) {
    const servicePrice = Number($('#order-price')?.value || 0);
    const distance = quote?.distance_km ? `${Number(quote.distance_km).toFixed(2)} km` : '—';
    const fee = quote?.delivery_fee ? money(quote.delivery_fee) : '—';
    const total = quote ? money(servicePrice + Number(quote.delivery_fee || 0)) : '—';
    $$('#delivery-distance-label').forEach((el) => { el.textContent = distance; });
    $$('#delivery-fee-label').forEach((el) => { el.textContent = fee; });
    const totalEl = $('#delivery-total-label');
    if (totalEl) totalEl.textContent = total;
    const timeEl = $('#delivery-route-time');
    if (timeEl) {
      const estimatedMinutes = quote
        ? Math.max(8, Math.round(Number(quote.duration_min || quote.distance_km * 3 + 5)))
        : null;
      timeEl.textContent = estimatedMinutes ? `aprox. ${estimatedMinutes} min` : 'Defina os dois pontos';
    }
    renderActiveMapQuote();
  }

  function renderActiveMapQuote() {
    const quote = state.mapDraft?.quote || (state.mapContext === 'food-delivery' ? state.foodQuote : state.deliveryQuote);
    const distance = quote?.distance_km ? `${Number(quote.distance_km).toFixed(2)} km` : '—';
    const fee = quote?.delivery_fee ? money(quote.delivery_fee) : '—';
    if ($('#map-distance-label')) $('#map-distance-label').textContent = distance;
    if ($('#map-fee-label')) $('#map-fee-label').textContent = fee;
  }

  async function refreshDeliveryQuote() {
    if (!isValidCoord(state.pickupCoords) || !isValidCoord(state.deliveryCoords)) {
      state.deliveryQuote = null;
      updateDeliveryQuoteLabels(null);
      return null;
    }
    try {
      const routeStops = (window.TragoClientCargoStops?.() || []).filter(isValidCoord);
      if (routeStops.length) {
        const roadResult = await fetchClientRouteSequence([state.pickupCoords, ...routeStops, state.deliveryCoords]);
        const distanceKm = Number(roadResult.route?.distance_km || 0);
        if (!distanceKm || roadResult.points.length < 3) throw new Error('Rota completa indisponível.');
        state.deliveryQuote = {
          distance_km: Number(distanceKm.toFixed(2)),
          duration_min: Number(roadResult.route?.duration_min || 0),
          delivery_fee: calculateDeliveryFee(distanceKm),
          source: roadResult.route?.source || 'road_route_sequence'
        };
      } else {
        state.deliveryQuote = await quotePublicRoute(state.pickupCoords, state.deliveryCoords);
      }
      updateDeliveryQuoteLabels(state.deliveryQuote);
      return state.deliveryQuote;
    } catch (_error) {
      state.deliveryQuote = null;
      updateDeliveryQuoteLabels(null);
      return null;
    }
  }

  window.TragoClientRefreshDeliveryQuote = refreshDeliveryQuote;

  async function createPublicOrder(payload) {
    const session = readSession();
    const response = await fetch(`${API_URL}/api/public/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {})
      },
      body: JSON.stringify(payload)
    });
    const data = await readJsonResponse(response);
    if (!response.ok) throw new Error(data.message || 'Não foi possível criar o pedido.');
    return data.order;
  }

  async function handleDeliverySubmit(event) {
    event.preventDefault();
    const form = event.target;
    const btn = form.querySelector('button[type="submit"]');
    const servicePrice = Number($('#order-price')?.value || 0);
    const cargoCategory = String($('#order-service-type')?.value || '').trim();
    const requestedProduct = String($('#cargo-item-description')?.value || '').trim();
    if (!cargoCategory) {
      toast('Escolha primeiro a categoria do produto ou carga.', 'error');
      $('#cargo-step-details')?.classList.add('hidden');
      $('#cargo-step-selector')?.classList.remove('hidden');
      return;
    }
    if (requestedProduct.length < 3) {
      toast('Descreva exactamente o produto ou conteúdo que será recolhido.', 'error');
      $('#cargo-step-details')?.classList.add('hidden');
      $('#cargo-step-selector')?.classList.remove('hidden');
      $('#cargo-item-description')?.focus();
      return;
    }
    if (!['partner', 'map_location'].includes(state.cargoSourceType)) {
      toast('Escolha um Parceiro TraGo ou marque o ponto de compra/recolha no mapa.', 'error');
      $('#cargo-step-details')?.classList.add('hidden');
      $('#cargo-step-selector')?.classList.remove('hidden');
      return;
    }
    await ensureAddressCoordinates({ inputSelector: '#order-pickup-address', kind: 'pickup', latSelector: '#pickup-lat', lngSelector: '#pickup-lng' });
    await ensureAddressCoordinates({ inputSelector: '#order-delivery-address', kind: 'delivery', latSelector: '#delivery-lat', lngSelector: '#delivery-lng' });
    if (!isValidCoord(state.pickupCoords) || !isValidCoord(state.deliveryCoords)) {
      toast('Confirme no mapa os pontos exactos de recolha e entrega.', 'error');
      return;
    }
    if (isValidCoord(state.pickupCoords) && isValidCoord(state.deliveryCoords) && !state.deliveryQuote) {
      await refreshDeliveryQuote();
    }
    const quote = state.deliveryQuote || {};
    const selectedPartner = state.selectedPartnerId ? findPartnerByKey(state.selectedPartnerId) : null;
    const selectedEntityType = $('#selected-partner-entity-type')?.value || '';
    const selectedEntityId = $('#selected-partner-id')?.value || '';
    const payload = {
      public_source: 'client',
      service_type: cargoCategory,
      cargo_category: cargoCategory,
      cargo_description: requestedProduct,
      requested_product: requestedProduct,
      purchase_source_type: state.cargoSourceType,
      purchase_source_label: selectedPartner?.name || $('#order-pickup-address')?.value || '',
      partner_id: selectedEntityType === 'partner' ? selectedEntityId : undefined,
      restaurant_id: selectedEntityType === 'restaurant' ? selectedEntityId : undefined,
      client_name: $('#order-client-name')?.value || state.session?.name || 'Cliente',
      client_phone1: $('#order-client-phone')?.value || state.session?.phone || '',
      client_phone2: $('#order-client-phone2')?.value || '',
      pickup_address_text: $('#order-pickup-address')?.value || '',
      pickup_contact_name: $('#order-pickup-contact-name')?.value || state.session?.name || 'Cliente',
      pickup_contact_phone: $('#order-pickup-contact-phone')?.value || state.session?.phone || '',
      pickup_notes: $('#order-notes')?.value || '',
      client_notes: $('#order-notes')?.value || '',
      delivery_notes: $('#order-delivery-notes')?.value || '',
      address_text: $('#order-delivery-address')?.value || '',
      service_price: servicePrice,
      price: servicePrice,
      delivery_fee: quote.delivery_fee || 0,
      route_distance_km: quote.distance_km || 0,
      route_duration_min: quote.duration_min || 0,
      payment_method: $('#order-payment-method')?.value || 'cash',
      pickup_lat: $('#pickup-lat')?.value || undefined,
      pickup_lng: $('#pickup-lng')?.value || undefined,
      lat: $('#delivery-lat')?.value || undefined,
      lng: $('#delivery-lng')?.value || undefined,
      scheduled_at: $('#cargo-scheduled-at')?.value ? new Date($('#cargo-scheduled-at').value).toISOString() : null,
      route_stops: window.TragoClientCargoStops?.() || [],
      customer_session_id: state.session?.id || state.session?.phone || 'guest'
    };

    if (!payload.pickup_address_text || !payload.address_text) {
      toast('Preencha o ponto de recolha e o ponto de entrega.', 'error');
      return;
    }
    if (!payload.client_name || !payload.client_phone1) {
      toast('Dados do cliente em falta.', 'error');
      return;
    }

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> A criar pedido...';
    try {
      const order = await createPublicOrder(payload);
      upsertOrderHistory(order);
      toast(`Pedido criado. Código do destinatário: ${order.verification_code || '—'}`);
      await runDriverRadar(order);
      form.reset();
      initSessionUI();
      resetMapState();
      state.selectedPartnerId = null;
      state.cargoSourceType = '';
      setInputValue('#selected-partner-id', '');
      setInputValue('#selected-partner-entity-type', '');
      renderCargoSourceSelection();
      updateDeliveryQuoteLabels(null);
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-paper-plane"></i> Criar pedido';
    }
  }

  function resetMapState() {
    state.pickupCoords = null;
    state.deliveryCoords = null;
    state.stopCoords = null;
    state.deliveryQuote = null;
    if (state.pickupMarker) { state.map?.removeLayer(state.pickupMarker); state.pickupMarker = null; }
    if (state.deliveryMarker) { state.map?.removeLayer(state.deliveryMarker); state.deliveryMarker = null; }
    if (state.stopMarker) { state.map?.removeLayer(state.stopMarker); state.stopMarker = null; }
    if (state.routeLine) { state.map?.removeLayer(state.routeLine); state.routeLine = null; }
    ['#pickup-lat', '#pickup-lng', '#delivery-lat', '#delivery-lng'].forEach((selector) => setInputValue(selector, ''));
  }

  async function loadRestaurants(force = false) {
    const container = $('#restaurants-container');
    if (state.restaurants.length && !force) {
      renderAllFoodViews();
      return;
    }
    if (container) container.innerHTML = `
      <div class="trago-skeleton-grid" aria-label="A carregar restaurantes">
        <div class="trago-skeleton-card"></div><div class="trago-skeleton-card"></div><div class="trago-skeleton-card"></div>
      </div>`;
    try {
      const response = await fetch(`${API_URL}/api/public/restaurants`);
      const data = await readJsonResponse(response);
      if (!response.ok) throw new Error(data.message || 'Falha ao carregar restaurantes.');
      const restaurants = Array.isArray(data.restaurants) ? data.restaurants : [];
      const fallbackCoupons = await loadPublicCatalogCoupons();
      state.restaurants = mergeRestaurantCoupons(restaurants, fallbackCoupons);
      state.restaurantsLoaded = true;
      reconcileCartWithRestaurants();
      renderAllFoodViews();
    } catch (error) {
      state.restaurantsLoaded = true;
      if (container) container.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}<br>Não foi possível obter os menus do servidor TraGo.</div>`;
      renderHomeHighlights();
      renderWishlist();
    }
  }

  const PARTNER_TYPES = Object.freeze([
    ['all', 'Todos'],
    ['restaurant', 'Restaurantes'],
    ['bottle_store', 'Bottle Stores'],
    ['shop', 'Lojas'],
    ['market', 'Mercados'],
    ['pharmacy', 'Farmácias'],
    ['bakery', 'Pastelarias'],
    ['florist', 'Flores'],
    ['electronics', 'Electrónica'],
    ['fashion', 'Moda'],
    ['other', 'Outros']
  ]);

  function partnerTypeLabel(type) {
    return PARTNER_TYPES.find(([key]) => key === String(type || 'other'))?.[1] || 'Parceiro';
  }

  function partnerCoordinates(partner) {
    const coords = partner?.address_coords;
    return isValidCoord(coords) ? { lat: Number(coords.lat), lng: Number(coords.lng) } : null;
  }

  function clientMapPartners() {
    return state.partners
      .map((partner) => {
        const coords = partnerCoordinates(partner);
        return coords ? {
          id: partner.entity_id || partner.id,
          name: partner.name || 'Parceiro TraGo',
          address_text: partner.address_text || '',
          partner_type: partner.partner_type || 'other',
          address_coords: coords
        } : null;
      })
      .filter(Boolean);
  }

  function syncClientPartnerLayers() {
    const partners = clientMapPartners();
    [state.map, radarState?.map].filter(Boolean).forEach((map) => {
      window.TragoMapUI?.syncPartnerLayer?.(map, partners);
    });
    window.dispatchEvent(new CustomEvent('trago:partners-updated', { detail: { partners } }));
  }

  window.TragoClientGetMapPartners = clientMapPartners;

  function filteredPartners() {
    const term = String($('#partners-search')?.value || '').trim().toLowerCase();
    return state.partners.filter((partner) => {
      if (state.partnerType !== 'all' && String(partner.partner_type || 'other') !== state.partnerType) return false;
      if (!term) return true;
      return [partner.name, partner.summary, partner.products_summary, partner.address_text, partnerTypeLabel(partner.partner_type)]
        .some((value) => String(value || '').toLowerCase().includes(term));
    });
  }

  function initPartnersMap() {
    const element = $('#partners-map');
    if (!element || typeof L === 'undefined' || state.partnersMap) return;
    state.partnersMap = L.map(element, {
      zoomControl: false,
      scrollWheelZoom: false,
      attributionControl: true,
      touchZoom: true,
      doubleClickZoom: true,
      keyboard: true,
      boxZoom: false
    }).setView([-25.9655, 32.5832], 11);
    addClientBaseMap(state.partnersMap);
    state.partnersCamera = window.TragoMapUI?.createCameraController?.(state.partnersMap) || null;
    state.partnersMap._tragoCamera = state.partnersCamera;
    window.TragoMapUI?.observeMapSize?.(state.partnersMap);
    if (window.TragoMapUI?.addZoomControl) window.TragoMapUI.addZoomControl(state.partnersMap);
    else L.control.zoom({ position: 'bottomright' }).addTo(state.partnersMap);
    window.TragoMapUI?.addStatusControl?.(state.partnersMap, {
      label: 'Parceiros TraGo',
      icon: 'fa-shop',
      position: 'topright'
    });
    state.partnersNavigationControl = window.TragoMapUI?.addNavigationControl?.(state.partnersMap, {
      label: 'Navegação dos parceiros',
      position: 'topright',
      actions: [
        {
          id: 'fit-partners',
          icon: 'fa-expand',
          title: 'Ver todos os parceiros',
          onClick: () => focusMapPoints(state.partnersMap, state.partnersPoints, {
            camera: state.partnersCamera, force: true, mode: 'free', paddingBottomRight: [38, 72], maxZoom: 15
          })
        },
        {
          id: 'my-location',
          icon: 'fa-location-arrow',
          title: 'Ver a minha localização',
          onClick: () => focusBrowserLocation(state.partnersMap, 'partnersUserMarker')
        }
      ]
    }) || null;
    state.partnersMarkers = L.layerGroup().addTo(state.partnersMap);
    state.partnersMap.on('zoomend', () => renderPartnersMap(state.partnersVisible, { preserveCamera: true }));
    if (!element.parentElement?.querySelector('.v20-partner-map-selection')) {
      const selection = document.createElement('div');
      selection.className = 'v20-partner-map-selection';
      selection.hidden = true;
      selection.setAttribute('aria-live', 'polite');
      element.insertAdjacentElement('afterend', selection);
    }
  }

  function selectPartnerOnMap(partner) {
    if (!partner) return;
    const entityKey = `${partner.entity_type || 'partner'}:${partner.entity_id || partner.id}`;
    state.selectedPartnerMapKey = entityKey;
    $$('[data-partner-card]').forEach((card) => card.classList.toggle('is-map-selected', card.dataset.partnerCard === entityKey));
    const selection = $('#partners-map')?.parentElement?.querySelector('.v20-partner-map-selection');
    if (selection) {
      selection.hidden = false;
      selection.innerHTML = `<span><strong>${escapeHtml(partner.name || 'Parceiro TraGo')}</strong><small>${escapeHtml(partner.address_text || partnerTypeLabel(partner.partner_type))}</small></span><button type="button" data-reveal-partner-card="${escapeHtml(entityKey)}">Ver detalhes</button>`;
    }
  }

  function clusterPartners(partners, zoom) {
    const cell = Math.max(0.0008, 0.032 / Math.pow(2, Math.max(0, Number(zoom || 11) - 11)));
    const groups = new Map();
    partners.forEach((partner) => {
      const coords = partnerCoordinates(partner);
      if (!coords) return;
      const key = `${Math.round(coords.lat / cell)}:${Math.round(coords.lng / cell)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ partner, coords });
    });
    return [...groups.values()];
  }

  function renderPartnersMap(partners, { forceFit = false, preserveCamera = false } = {}) {
    initPartnersMap();
    if (!state.partnersMap || !state.partnersMarkers) return;
    state.partnersVisible = partners.slice();
    state.partnersMarkers.clearLayers();
    const points = [];
    partners.forEach((partner) => {
      const coords = partnerCoordinates(partner);
      if (coords) points.push(coords);
    });
    clusterPartners(partners, state.partnersMap.getZoom()).forEach((group) => {
      if (group.length > 1) {
        const center = {
          lat: group.reduce((sum, item) => sum + item.coords.lat, 0) / group.length,
          lng: group.reduce((sum, item) => sum + item.coords.lng, 0) / group.length
        };
        const icon = L.divIcon({
          className: 'trago-partner-cluster',
          html: `<span>${group.length}</span>`,
          iconSize: [44, 44],
          iconAnchor: [22, 22]
        });
        L.marker(center, { icon, title: `${group.length} parceiros nesta zona` })
          .on('click', () => state.partnersCamera?.setView(center, Math.min(18, state.partnersMap.getZoom() + 2), { force: true, mode: 'free' }))
          .addTo(state.partnersMarkers);
        return;
      }
      const { partner, coords } = group[0];
      const marker = L.marker(coords, {
        title: partner.name || 'Parceiro TraGo',
        icon: clientMapIcon('partner', '', { compact: true })
      })
        .bindPopup(`<strong>${escapeHtml(partner.name)}</strong><br>${escapeHtml(partner.address_text || '')}`)
        .addTo(state.partnersMarkers);
      marker.on('click', () => selectPartnerOnMap(partner));
    });
    state.partnersPoints = points.map((point) => [Number(point.lat), Number(point.lng)]);
    if (!preserveCamera && (!state.partnersHasInitialFit || forceFit)) {
      const fitted = focusMapPoints(state.partnersMap, state.partnersPoints, {
        camera: state.partnersCamera,
        force: forceFit,
        mode: forceFit ? 'free' : 'initial-fit',
        paddingBottomRight: [38, 78],
        maxZoom: 15
      });
      if (!fitted) state.partnersCamera?.setView([-25.9655, 32.5832], 11, { force: forceFit, mode: 'initial-fit' });
      state.partnersHasInitialFit = true;
    }
  }

  function renderPartnerCard(partner) {
    const coords = partnerCoordinates(partner);
    const entityKey = `${partner.entity_type || 'partner'}:${partner.entity_id || partner.id}`;
    const phone = String(partner.phone || '').replace(/[^\d+]/g, '');
    const whatsapp = String(partner.whatsapp || partner.phone || '').replace(/\D/g, '');
    return `
      <article class="v20-partner-card" data-partner-card="${escapeHtml(entityKey)}">
        <div class="v20-partner-card-cover">
          ${partner.cover_url ? `<img src="${escapeHtml(partner.cover_url)}" alt="" loading="lazy" decoding="async">` : '<span><i class="fa-solid fa-handshake"></i></span>'}
          <b><i class="fa-solid fa-circle-check"></i> Verificado</b>
        </div>
        <div class="v20-partner-card-body">
          <header><span>${partner.logo_url ? `<img src="${escapeHtml(partner.logo_url)}" alt="" loading="lazy">` : escapeHtml(String(partner.name || 'PT').slice(0, 2).toUpperCase())}</span><div><small>${escapeHtml(partnerTypeLabel(partner.partner_type))}</small><h2>${escapeHtml(partner.name || 'Parceiro TraGo')}</h2></div></header>
          <p>${escapeHtml(partner.summary || 'Parceiro verificado da rede TraGo.')}</p>
          <dl><div><dt><i class="fa-solid fa-basket-shopping"></i> O que vende</dt><dd>${escapeHtml(partner.products_summary || 'Produtos por confirmar')}</dd></div><div><dt><i class="fa-solid fa-location-dot"></i> Localização exacta</dt><dd>${escapeHtml(partner.address_text || 'Morada por confirmar')}${coords ? `<small>${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}</small>` : '<small>Coordenadas ainda não publicadas</small>'}</dd></div>${partner.opening_hours ? `<div><dt><i class="fa-regular fa-clock"></i> Horário</dt><dd>${escapeHtml(typeof partner.opening_hours === 'string' ? partner.opening_hours : JSON.stringify(partner.opening_hours))}</dd></div>` : ''}</dl>
          <footer>
            ${phone ? `<a href="tel:${escapeHtml(phone)}"><i class="fa-solid fa-phone"></i> Ligar</a>` : ''}
            ${whatsapp ? `<a href="https://wa.me/${escapeHtml(whatsapp)}" target="_blank" rel="noopener"><i class="fa-brands fa-whatsapp"></i> WhatsApp</a>` : ''}
            ${coords ? `<button type="button" data-focus-partner="${escapeHtml(entityKey)}"><i class="fa-solid fa-map-location-dot"></i> Ver no mapa</button>` : ''}
            <button type="button" data-use-cargo-partner="${escapeHtml(entityKey)}"><i class="fa-solid fa-truck-fast"></i> Recolher aqui</button>
          </footer>
        </div>
      </article>`;
  }

  function populateCargoPartnerSelect() {
    const select = $('#cargo-partner-select');
    if (!select) return;
    const previous = select.value;
    const eligible = state.partners.filter((partner) => partnerCoordinates(partner));
    select.innerHTML = '<option value="">Seleccione um parceiro da lista</option>' + eligible
      .map((partner) => {
        const key = `${partner.entity_type || 'partner'}:${partner.entity_id || partner.id}`;
        return `<option value="${escapeHtml(key)}">${escapeHtml(partner.name)} · ${escapeHtml(partnerTypeLabel(partner.partner_type))}</option>`;
      }).join('');
    if ([...select.options].some((option) => option.value === previous)) select.value = previous;
  }

  function renderPartners() {
    const categories = $('#partners-category-scroll');
    const results = $('#partners-results');
    if (!categories || !results) return;
    categories.innerHTML = PARTNER_TYPES.map(([key, label]) => `<button type="button" class="category-filter ${state.partnerType === key ? 'active' : ''}" data-partner-type="${key}">${label}</button>`).join('');
    if (!state.partnersLoaded) return;
    const partners = filteredPartners();
    const resultCount = $('#partners-result-count');
    if (resultCount) resultCount.textContent = `${partners.length} parceiro(s) verificado(s) · ${partners.filter(partnerCoordinates).length} no mapa`;
    results.innerHTML = partners.length
      ? partners.map(renderPartnerCard).join('')
      : '<div class="v20-empty"><i class="fa-solid fa-store-slash"></i><h2>Nenhum parceiro neste filtro</h2><p>Altere a pesquisa ou envie uma candidatura para validação.</p><button type="button" class="v20-primary" id="btn-open-partner-application-empty"><i class="fa-solid fa-plus"></i> Ser parceiro</button></div>';
    renderPartnersMap(state.partners);
    populateCargoPartnerSelect();
  }

  async function loadPartners(force = false) {
    if (state.partnersLoaded && !force) {
      renderPartners();
      return;
    }
    const results = $('#partners-results');
    if (results) results.innerHTML = '<div class="trago-skeleton-grid"><div class="trago-skeleton-card"></div><div class="trago-skeleton-card"></div></div>';
    try {
      const response = await fetch(`${API_URL}/api/public/partners`);
      const data = await readJsonResponse(response);
      if (!response.ok) throw new Error(data.message || 'Não foi possível carregar os parceiros.');
      state.partners = Array.isArray(data.partners) ? data.partners : [];
      state.partnersLoaded = true;
      renderPartners();
      syncClientPartnerLayers();
    } catch (error) {
      state.partnersLoaded = true;
      if (results) results.innerHTML = `<div class="v20-empty"><h2>Parceiros indisponíveis</h2><p>${escapeHtml(error.message)}</p><button type="button" class="v20-primary" id="btn-retry-partners">Tentar novamente</button></div>`;
    }
  }

  function findPartnerByKey(key) {
    const [entityType, entityId] = String(key || '').split(':');
    return state.partners.find((partner) => String(partner.entity_type || 'partner') === entityType && String(partner.entity_id || partner.id) === entityId) || null;
  }

  function selectCargoPartner(key, { openDelivery = false } = {}) {
    const partner = findPartnerByKey(key);
    const coords = partnerCoordinates(partner);
    if (!partner || !coords) {
      toast('Este parceiro ainda não tem uma localização exacta disponível.', 'error');
      return false;
    }
    const entityType = String(partner.entity_type || 'partner');
    const entityId = String(partner.entity_id || partner.id);
    state.selectedPartnerId = `${entityType}:${entityId}`;
    state.cargoSourceType = 'partner';
    setInputValue('#selected-partner-id', entityId);
    setInputValue('#selected-partner-entity-type', entityType);
    if ($('#cargo-partner-select')) $('#cargo-partner-select').value = state.selectedPartnerId;
    const pickupLabel = [partner.name, partner.address_text].filter(Boolean).join(' · ');
    setInputValue('#order-pickup-address', pickupLabel);
    setInputValue('#order-pickup-contact-name', partner.name || '');
    setInputValue('#order-pickup-contact-phone', partner.phone || partner.whatsapp || '');
    placeMarker('pickup', coords, pickupLabel);
    renderCargoSourceSelection();
    if (openDelivery) setPanel('delivery');
    return true;
  }

  function renderCargoSourceSelection() {
    const wrap = $('#cargo-selected-source');
    if (!wrap) return;
    const partner = state.selectedPartnerId ? findPartnerByKey(state.selectedPartnerId) : null;
    if (state.cargoSourceType === 'partner' && partner) {
      wrap.classList.add('selected');
      wrap.innerHTML = `<i class="fa-solid fa-circle-check"></i><span><strong>${escapeHtml(partner.name)}</strong><small>${escapeHtml(partner.address_text || 'Localização confirmada')}</small></span>`;
      return;
    }
    if (state.cargoSourceType === 'map_location' && isValidCoord(state.pickupCoords)) {
      wrap.classList.add('selected');
      wrap.innerHTML = `<i class="fa-solid fa-map-location-dot"></i><span><strong>Local escolhido no mapa</strong><small>${escapeHtml($('#order-pickup-address')?.value || `${state.pickupCoords.lat}, ${state.pickupCoords.lng}`)}</small></span>`;
      return;
    }
    wrap.classList.remove('selected');
    wrap.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i><span><strong>Nenhum ponto seleccionado</strong><small>Escolha um parceiro ou marque a recolha no mapa.</small></span>';
  }

  function openPartnerApplicationSheet() {
    if (!readSession()?.token) {
      toast('Entre na sua conta para enviar uma candidatura e receber a decisão do Admin.', 'error');
      window.TragoClientOpenAuth?.();
      return;
    }
    const sheet = $('#partner-application-sheet');
    if (!sheet) return;
    sheet.classList.add('open');
    sheet.setAttribute('aria-hidden', 'false');
    document.body.classList.add('sheet-open');
    setTimeout(() => $('#partner-application-form [name="name"]')?.focus(), 80);
  }

  function capturePartnerApplicationLocation() {
    if (!navigator.geolocation) {
      toast('Este navegador não disponibiliza localização.', 'error');
      return;
    }
    const status = $('#partner-application-location-state');
    if (status) status.textContent = 'A obter localização exacta…';
    navigator.geolocation.getCurrentPosition((position) => {
      const form = $('#partner-application-form');
      if (!form) return;
      form.elements.lat.value = Number(position.coords.latitude).toFixed(6);
      form.elements.lng.value = Number(position.coords.longitude).toFixed(6);
      if (status) status.textContent = `Localização confirmada · ${form.elements.lat.value}, ${form.elements.lng.value}`;
    }, () => {
      if (status) status.textContent = 'Não foi possível obter a localização. Escolha uma sugestão de morada.';
      toast('Não foi possível obter a localização.', 'error');
    }, { enableHighAccuracy: true, timeout: 12000 });
  }

  async function submitPartnerApplication(event) {
    event.preventDefault();
    const session = readSession();
    if (!session?.token) {
      toast('A sua sessão terminou. Entre novamente para enviar a candidatura.', 'error');
      window.TragoClientOpenAuth?.();
      return;
    }
    const form = event.currentTarget;
    const submit = form.querySelector('button[type="submit"]');
    const data = Object.fromEntries(new FormData(form).entries());
    if (!isValidCoord({ lat: Number(data.lat), lng: Number(data.lng) })) {
      toast('Confirme a localização exacta do estabelecimento.', 'error');
      return;
    }
    submit.disabled = true;
    submit.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> A enviar…';
    try {
      const response = await fetch(`${API_URL}/api/public/partners/applications`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.token}`
        },
        body: JSON.stringify({ ...data, lat: Number(data.lat), lng: Number(data.lng) })
      });
      const result = await readJsonResponse(response);
      if (!response.ok) throw new Error(result.message || 'Não foi possível enviar a candidatura.');
      toast(result.message || 'Candidatura enviada para validação.');
      form.reset();
      const locationState = $('#partner-application-location-state');
      if (locationState) locationState.textContent = 'Obrigatório · também pode escolher uma sugestão de morada';
      const sheet = $('#partner-application-sheet');
      sheet?.classList.remove('open');
      sheet?.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('sheet-open');
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      submit.disabled = false;
      submit.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Enviar candidatura';
    }
  }

  function getAllMenuItems() {
    return state.restaurants.flatMap((restaurant) => (restaurant.menuItems || []).map((item) => ({ ...item, restaurant })));
  }

  const STANDARD_FOOD_CATEGORIES = [
    'Pratos principais',
    'Entradas',
    'Hambúrgueres',
    'Pizzas',
    'Massas',
    'Frango',
    'Peixe e mariscos',
    'Carnes',
    'Vegetariano',
    'Sobremesas',
    'Bebidas',
    'Café e chá',
    'Combos'
  ];

  function categoryKey(value) {
    const normalized = String(value || 'Geral').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    const aliases = {
      bebida: 'bebidas',
      refrigerante: 'bebidas',
      refrigerantes: 'bebidas',
      sumo: 'bebidas',
      sumos: 'bebidas',
      drink: 'bebidas',
      drinks: 'bebidas',
      'prato principal': 'pratos principais',
      principal: 'pratos principais',
      sobremesa: 'sobremesas',
      hamburger: 'hambúrgueres',
      hamburguer: 'hambúrgueres',
      hamburgueres: 'hambúrgueres'
    };
    return aliases[normalized] || normalized;
  }

  function getCategories() {
    const categories = new Map(STANDARD_FOOD_CATEGORIES.map((label) => [categoryKey(label), label]));
    getAllMenuItems().forEach((entry) => {
      const label = String(entry.category || 'Geral').trim();
      const key = categoryKey(label);
      if (!categories.has(key)) categories.set(key, label);
    });
    return Array.from(categories, ([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label, 'pt'));
  }

  function renderCategoryBar() {
    const wrap = $('#food-category-scroll');
    if (!wrap) return;
    const categories = getCategories();
    wrap.innerHTML = [
      `<button type="button" class="category-filter ${state.selectedCategory === 'all' ? 'active' : ''}" data-category-filter="all">Todos</button>`,
      ...categories.map(({ key, label }) => `<button type="button" class="category-filter ${state.selectedCategory === key ? 'active' : ''}" data-category-filter="${escapeHtml(key)}">${escapeHtml(label)}</button>`)
    ].join('');
  }

  const BOTTLE_CATEGORY_GROUPS = Object.freeze([
    ['cervejas', 'Cervejas', ['cerveja', 'beer']],
    ['vinhos', 'Vinhos', ['vinho', 'wine']],
    ['espumantes', 'Espumantes', ['espumante', 'champagne', 'prosecco']],
    ['whisky', 'Whisky', ['whisky', 'whiskey']],
    ['vodka', 'Vodka', ['vodka']],
    ['gin', 'Gin', ['gin']],
    ['licores', 'Licores', ['licor', 'liqueur']],
    ['refrigerantes', 'Refrigerantes', ['refrigerante', 'soda']],
    ['sumos', 'Sumos', ['sumo', 'juice']],
    ['aguas', 'Águas', ['agua', 'água', 'water']],
    ['outras-bebidas', 'Outras bebidas', ['bebida', 'drink']]
  ]);

  function bottleCategoryFor(item, restaurant) {
    const haystack = [
      item?.category,
      item?.name,
      item?.description,
      ...(Array.isArray(item?.tags) ? item.tags : []),
      restaurant?.business_type
    ].join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const match = BOTTLE_CATEGORY_GROUPS.find(([, , aliases]) => aliases.some((alias) => haystack.includes(alias.normalize('NFD').replace(/[\u0300-\u036f]/g, ''))));
    return match?.[0] || '';
  }

  function getBottleEntries() {
    const term = String($('#bottle-store-search')?.value || '').trim().toLowerCase();
    return getAllMenuItems().map(({ restaurant, ...item }) => ({
      item,
      restaurant,
      bottleCategory: bottleCategoryFor(item, restaurant)
    })).filter((entry) => {
      const bottleBusiness = String(entry.restaurant?.business_type || '').toLowerCase() === 'bottle_store';
      if (!entry.bottleCategory && !bottleBusiness) return false;
      if (state.bottleCategory !== 'all' && entry.bottleCategory !== state.bottleCategory) return false;
      if (!term) return true;
      return [entry.item.name, entry.item.category, entry.item.description, entry.restaurant.name]
        .some((value) => String(value || '').toLowerCase().includes(term));
    });
  }

  function renderBottleStore() {
    const categoriesWrap = $('#bottle-store-categories');
    const results = $('#bottle-store-results');
    if (!categoriesWrap || !results) return;
    categoriesWrap.innerHTML = [
      `<button type="button" class="category-filter ${state.bottleCategory === 'all' ? 'active' : ''}" data-bottle-category="all">Todas</button>`,
      ...BOTTLE_CATEGORY_GROUPS.map(([key, label]) => `<button type="button" class="category-filter ${state.bottleCategory === key ? 'active' : ''}" data-bottle-category="${key}">${label}</button>`)
    ].join('');

    if (!state.restaurantsLoaded) {
      results.innerHTML = '<div class="trago-skeleton-grid" aria-label="A carregar Bottle Store"><div class="trago-skeleton-card"></div><div class="trago-skeleton-card"></div></div>';
      return;
    }

    const entries = getBottleEntries();
    const count = $('#bottle-store-result-count');
    if (count) count.textContent = entries.length
      ? `${entries.length} bebida(s) disponível(is) para entrega`
      : 'Ainda não existem bebidas publicadas nesta categoria';
    if (!entries.length) {
      results.innerHTML = '<div class="v20-empty v20-bottle-empty"><i class="fa-solid fa-wine-bottle"></i><h2>Bottle Store em preparação</h2><p>As lojas aparecerão aqui assim que publicarem cervejas, vinhos, destilados, refrigerantes, sumos ou águas.</p><button class="v20-primary" type="button" data-jump-panel="food">Ver restaurantes</button></div>';
      return;
    }

    const grouped = new Map();
    entries.forEach((entry) => {
      const key = String(entry.restaurant.id);
      if (!grouped.has(key)) grouped.set(key, { restaurant: entry.restaurant, items: [] });
      grouped.get(key).items.push(entry.item);
    });
    results.innerHTML = [...grouped.values()].map(({ restaurant, items }) => `
      <section class="v20-bottle-shop">
        <header data-open-bottle="${escapeHtml(restaurant.id)}" tabindex="0" role="button">
          <span>${restaurant.logo_url ? `<img src="${escapeHtml(restaurant.logo_url)}" alt="" loading="lazy">` : '<i class="fa-solid fa-store"></i>'}</span>
          <div><small>BOTTLE STORE</small><h2>${escapeHtml(restaurant.name)}</h2><p>${restaurant.is_open === false ? 'Fechado agora' : 'Aberto para pedidos'} · ${items.length} produto(s)</p></div>
          <i class="fa-solid fa-chevron-right"></i>
        </header>
        <div class="food-grid">${items.map((item) => renderFoodCard(item, restaurant)).join('')}</div>
      </section>
    `).join('');
  }

  function renderBottleProfile(restaurantId) {
    const wrap = $('#bottle-profile-content');
    const restaurant = state.restaurants.find((entry) => String(entry.id) === String(restaurantId));
    if (!wrap) return;
    if (!restaurant) {
      wrap.innerHTML = '<div class="v20-empty"><h2>Bottle Store indisponível</h2><p>Actualize a lista e volte a tentar.</p><button class="v20-primary" type="button" data-jump-panel="bottle-store">Voltar às bebidas</button></div>';
      return;
    }
    state.selectedRestaurantId = restaurant.id;
    const drinks = (restaurant.menuItems || []).filter((item) => bottleCategoryFor(item, restaurant) || String(restaurant.business_type || '').includes('bottle'));
    const favorite = readFavoriteIds().includes(String(restaurant.id));
    const favoriteButton = $('[data-bottle-profile-favorite]');
    if (favoriteButton) {
      favoriteButton.dataset.favoriteId = restaurant.id;
      favoriteButton.dataset.favoriteType = 'restaurant';
      favoriteButton.classList.toggle('active', favorite);
      const icon = favoriteButton.querySelector('i');
      if (icon) icon.className = `${favorite ? 'fa-solid' : 'fa-regular'} fa-heart`;
    }
    const categories = [...new Set(drinks.map((item) => item.category || 'Bebidas'))];
    const coords = restaurant.address_coords;
    wrap.innerHTML = `
      <article class="v20-restaurant-profile-hero v20-bottle-profile-hero">
        <div class="v20-restaurant-profile-cover">
          ${restaurant.cover_url ? `<img src="${escapeHtml(restaurant.cover_url)}" alt="" decoding="async">` : '<span><i class="fa-solid fa-champagne-glasses"></i></span>'}
          <b class="${restaurant.is_open === false ? 'closed' : ''}"><i></i> ${restaurant.is_open === false ? 'Fechado' : 'Aberto agora'}</b>
        </div>
        <div class="v20-restaurant-profile-info">
          <span class="v20-restaurant-profile-logo">${restaurant.logo_url ? `<img src="${escapeHtml(restaurant.logo_url)}" alt="" decoding="async">` : escapeHtml(String(restaurant.name || 'BS').slice(0, 2).toUpperCase())}</span>
          <div><small>BOTTLE STORE PARCEIRA</small><h2>${escapeHtml(restaurant.name || 'Bottle Store')}</h2><p>${escapeHtml(restaurant.address_text || 'Localização ainda não publicada')}</p></div>
        </div>
        <p class="v20-restaurant-about">${escapeHtml(restaurant.description || restaurant.operational_note || 'Loja de bebidas parceira TraGo com catálogo e entrega integrados.')}</p>
        ${restaurantCouponBanner(restaurant)}
        <div class="v20-restaurant-facts">
          <span><i class="fa-solid fa-star"></i><b>${Number(restaurant.average_rating || 0).toFixed(1)}</b><small>${Number(restaurant.rating_count || 0)} avaliações</small></span>
          <span><i class="fa-regular fa-clock"></i><b>${escapeHtml(restaurant.delivery_time || 'A confirmar')}</b><small>Entrega</small></span>
          <span><i class="fa-solid fa-wine-bottle"></i><b>${drinks.length}</b><small>Bebidas</small></span>
          <span><i class="fa-solid fa-location-arrow"></i><b>${escapeHtml(restaurantDistanceText(restaurant, 'Localização desligada'))}</b><small>Distância aproximada</small></span>
        </div>
        <div class="v20-bottle-contact-grid">
          ${restaurant.phone ? `<a href="tel:${escapeHtml(String(restaurant.phone).replace(/[^\d+]/g, ''))}"><i class="fa-solid fa-phone"></i><span><strong>Telefone</strong><small>${escapeHtml(restaurant.phone)}</small></span></a>` : ''}
          ${restaurant.whatsapp ? `<a href="https://wa.me/${escapeHtml(String(restaurant.whatsapp).replace(/\D/g, ''))}" target="_blank" rel="noopener"><i class="fa-brands fa-whatsapp"></i><span><strong>WhatsApp</strong><small>${escapeHtml(restaurant.whatsapp)}</small></span></a>` : ''}
          ${isValidCoord(coords) ? `<a href="https://www.openstreetmap.org/?mlat=${Number(coords.lat)}&mlon=${Number(coords.lng)}#map=18/${Number(coords.lat)}/${Number(coords.lng)}" target="_blank" rel="noopener"><i class="fa-solid fa-map-location-dot"></i><span><strong>Ver localização</strong><small>${Number(coords.lat).toFixed(5)}, ${Number(coords.lng).toFixed(5)}</small></span></a>` : ''}
        </div>
        <div class="v20-restaurant-rate"><span><strong>Classificar esta Bottle Store</strong><small>A sua avaliação ajuda outros clientes.</small></span>${renderStars({ type: 'restaurant', id: restaurant.id, restaurantId: restaurant.id, average: restaurant.average_rating, count: restaurant.rating_count })}</div>
      </article>
      <section class="v20-restaurant-menu v20-bottle-menu">
        <header><div><small>CATÁLOGO COMPLETO</small><h2>Escolha as suas bebidas</h2><p>${drinks.length} produto(s) em ${categories.length} categoria(s)</p></div></header>
        ${drinks.length ? categories.map((category) => `<section class="v20-profile-menu-category"><div class="v20-section-title"><div><h3>${escapeHtml(category)}</h3><p>${drinks.filter((item) => (item.category || 'Bebidas') === category).length} opções</p></div></div><div class="food-grid">${drinks.filter((item) => (item.category || 'Bebidas') === category).map((item) => renderFoodCard(item, restaurant)).join('')}</div></section>`).join('') : '<div class="v20-empty"><i class="fa-solid fa-wine-bottle"></i><h2>Catálogo em actualização</h2><p>Esta Bottle Store ainda não publicou bebidas disponíveis.</p></div>'}
      </section>`;
  }

  function openBottleProfile(restaurantId) {
    state.selectedRestaurantId = restaurantId;
    renderBottleProfile(restaurantId);
    setPanel('bottle-profile', { context: { id: String(restaurantId) } });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function getFilteredRestaurants() {
    const term = String($('#food-search')?.value || '').toLowerCase().trim();
    const selected = state.selectedCategory;
    const quick = state.directoryQuickFilters;
    const favoriteIds = new Set(readFavoriteIds());
    const filtered = state.restaurants.filter((restaurant) => {
      const favoriteRestaurant = favoriteIds.has(String(restaurant.id));
      const hasFavoriteFood = (restaurant.menuItems || []).some((item) => favoriteIds.has(String(item.id)));
      if (state.directoryFavoritesOnly && !favoriteRestaurant && !hasFavoriteFood) return false;
      if (quick.includes('open') && restaurant.is_open === false) return false;
      const minimumRating = Math.max(quick.includes('rating') ? 4.5 : 0, Number(state.directoryMinRating || 0));
      if (minimumRating && Number(restaurant.average_rating || 0) < minimumRating) return false;
      if (quick.includes('free')) {
        const fee = restaurant.delivery_fee ?? restaurant.default_delivery_fee;
        if (restaurant.free_delivery !== true && Number(fee) !== 0) return false;
      }
      return true;
    }).map((restaurant) => ({
      ...restaurant,
      menuItems: (restaurant.menuItems || []).filter((item) => {
        const matchesTerm = !term || [restaurant.name, item.name, item.category, item.description].some((value) => String(value || '').toLowerCase().includes(term));
        const matchesCategory = selected === 'all' || categoryKey(item.category) === selected;
        const matchesFavorite = !state.directoryFavoritesOnly
          || favoriteIds.has(String(restaurant.id))
          || favoriteIds.has(String(item.id));
        return matchesTerm && matchesCategory && matchesFavorite;
      })
    })).filter((restaurant) => (restaurant.menuItems || []).length);
    return filtered.sort((a, b) => {
      if (state.directorySort === 'rating') return Number(b.average_rating || 0) - Number(a.average_rating || 0);
      if (state.directorySort === 'fee') return Number(a.delivery_fee || 0) - Number(b.delivery_fee || 0);
      if (state.directorySort === 'fastest') {
        const prep = (restaurant) => Math.min(...(restaurant.menuItems || []).map((item) => Number(item.prep_time_min || 999)));
        return prep(a) - prep(b);
      }
      if (state.directorySort === 'newest') return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
      return (a.is_open === false) - (b.is_open === false)
        || Number(b.average_rating || 0) - Number(a.average_rating || 0)
        || Number(b.rating_count || 0) - Number(a.rating_count || 0);
    });
  }

  function syncDirectoryQuickButtons() {
    $$('[data-directory-quick]').forEach((button) => {
      const key = button.dataset.directoryQuick;
      button.classList.toggle('active', key === 'all' ? state.directoryQuickFilters.length === 0 && !state.directoryMinRating : state.directoryQuickFilters.includes(key));
    });
    const favoritesButton = $('[data-toggle-favorites]');
    favoritesButton?.classList.toggle('active', state.directoryFavoritesOnly);
    const icon = favoritesButton?.querySelector('i');
    icon?.classList.toggle('fa-solid', state.directoryFavoritesOnly);
    icon?.classList.toggle('fa-regular', !state.directoryFavoritesOnly);
  }

  window.TragoClientSetFavoritesOnly = (enabled) => {
    state.directoryFavoritesOnly = Boolean(enabled);
    renderAllFoodViews();
  };

  window.TragoClientSetDirectoryQuick = (filters = []) => {
    state.directoryQuickFilters = Array.isArray(filters) ? filters.filter((item) => ['open', 'free', 'rating'].includes(item)) : [];
    if (!state.directoryQuickFilters.length) {
      state.directoryMinRating = 0;
      state.directorySort = 'recommended';
      $('[data-directory-rating]') && ($('[data-directory-rating]').value = '0');
      $('[data-directory-sort]') && ($('[data-directory-sort]').value = 'recommended');
      $$('[data-directory-filter]').forEach((input) => { input.checked = false; });
    }
    syncDirectoryQuickButtons();
    renderAllFoodViews();
  };

  window.TragoClientApplyDirectoryFilters = ({ filters = [], minRating = 0, sort = 'recommended' } = {}) => {
    state.directoryQuickFilters = filters.filter((item) => ['open', 'free'].includes(item));
    state.directoryMinRating = Number(minRating || 0);
    state.directorySort = ['recommended', 'newest', 'fastest', 'rating', 'fee'].includes(sort) ? sort : 'recommended';
    syncDirectoryQuickButtons();
    renderAllFoodViews();
  };

  function ratingAverage(value) {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function renderStars({ type, id, restaurantId, average = 0, count = 0 }) {
    const key = type === 'food' ? `food:${id}` : `restaurant:${id}`;
    const selected = Number(state.selectedRatings[key] || 0);
    const displayRating = selected || Math.round(ratingAverage(average));
    const buttons = [1, 2, 3, 4, 5].map((rating) => `
      <button type="button" class="star-btn ${rating <= displayRating ? 'filled' : ''}" data-rate-${type}="${escapeHtml(id)}" data-restaurant-id="${escapeHtml(restaurantId || id)}" data-rating="${rating}" aria-label="Avaliar com ${rating} estrela(s)">★</button>
    `).join('');
    return `
      <div class="rating-row" title="${count ? `${Number(average || 0).toFixed(1)} em ${count} avaliação(ões)` : 'Ainda sem avaliações'}">
        <div class="stars">${buttons}</div>
        <small>${count ? `${Number(average || 0).toFixed(1)} (${count})` : 'Avaliar'}</small>
      </div>
    `;
  }

  function renderFoodCard(item, restaurant, highlight = false) {
    return `
      <article class="food-card ${highlight ? 'highlight-food-card' : ''}" data-open-dish="${escapeHtml(item.id)}" tabindex="0" role="button" aria-label="Ver detalhes de ${escapeHtml(item.name)}">
        <div class="food-image">
          ${item.image_url ? `<img src="${escapeHtml(item.image_url)}" alt="${escapeHtml(item.name)}" loading="lazy" decoding="async">` : '<span class="food-image-fallback"><i class="fas fa-utensils"></i></span>'}
          <span class="food-category-badge">${escapeHtml(item.category || 'Geral')}</span>
        </div>
        <div class="food-body">
          <div>
            <h4>${escapeHtml(item.name)}</h4>
            <p class="food-restaurant-name"><i class="fas fa-store"></i> ${escapeHtml(restaurant.name || 'Restaurante')}</p>
          </div>
          <div class="v20-food-card-context">${restaurantDistanceMarkup(restaurant)}${restaurantCouponMarkup(restaurant)}</div>
          <p>${escapeHtml(item.description || 'Prato disponível para entrega.')}</p>
          ${renderStars({ type: 'food', id: item.id, restaurantId: restaurant.id, average: item.average_rating, count: item.rating_count })}
          <div class="food-bottom">
            <span class="food-price">${money(item.price)}</span>
            <button class="btn-plus" type="button" data-add-food="${escapeHtml(item.id)}" aria-label="Adicionar ${escapeHtml(item.name)}"><i class="fas fa-plus"></i></button>
          </div>
          <small class="tap-detail-hint">Tocar para detalhes</small>
        </div>
      </article>
    `;
  }

  function renderPopularRestaurantCard(restaurant) {
    const categories = [...new Set((restaurant.menuItems || []).map((item) => item.category || 'Geral'))];
    const averagePrep = (restaurant.menuItems || []).reduce((sum, item) => sum + Number(item.prep_time_min || 0), 0)
      / Math.max(1, (restaurant.menuItems || []).filter((item) => Number(item.prep_time_min || 0) > 0).length);
    const deliveryLabel = restaurant.delivery_time || (averagePrep ? `${Math.round(averagePrep)}–${Math.round(averagePrep + 15)} min` : 'Tempo a confirmar');
    const cover = restaurant.cover_url || '';
    return `
      <article class="popular-restaurant-card ${restaurant.is_open === false ? 'is-closed' : ''}" data-open-restaurant="${escapeHtml(restaurant.id)}" tabindex="0" role="button" aria-label="Abrir menu de ${escapeHtml(restaurant.name)}">
        <div class="popular-restaurant-cover">
          ${cover ? `<img src="${escapeHtml(cover)}" alt="" loading="lazy" decoding="async">` : '<span><i class="fa-solid fa-store"></i></span>'}
          <b class="${restaurant.is_open === false ? 'closed' : ''}"><i></i>${restaurant.is_open === false ? 'Fechado' : 'Aberto'}</b>
          ${primaryRestaurantCoupon(restaurant) ? `<em class="v20-cover-coupon"><i class="fa-solid fa-ticket"></i>${escapeHtml(primaryRestaurantCoupon(restaurant).discount_label || 'Cupão')}</em>` : ''}
          <button type="button" class="v20-favorite-button popular-restaurant-favorite ${readFavoriteIds().includes(String(restaurant.id)) ? 'active' : ''}" data-favorite-id="${escapeHtml(restaurant.id)}" data-favorite-type="restaurant" aria-label="${readFavoriteIds().includes(String(restaurant.id)) ? 'Remover restaurante dos favoritos' : 'Guardar restaurante nos favoritos'}"><i class="${readFavoriteIds().includes(String(restaurant.id)) ? 'fa-solid' : 'fa-regular'} fa-heart"></i></button>
        </div>
        <div class="popular-restaurant-body">
          <span class="popular-restaurant-logo">${restaurant.logo_url ? `<img src="${escapeHtml(restaurant.logo_url)}" alt="" loading="lazy" decoding="async">` : escapeHtml(String(restaurant.name || 'R').slice(0, 2).toUpperCase())}</span>
          <div>
            <h3>${escapeHtml(restaurant.name || 'Restaurante')}</h3>
            <p>${escapeHtml(restaurant.address_text || categories.slice(0, 2).join(' · ') || 'Parceiro TraGo')}</p>
          </div>
          <i class="fa-solid fa-chevron-right"></i>
        </div>
        <footer>
          <span><i class="fa-solid fa-star"></i> <b>${Number(restaurant.average_rating || 0).toFixed(1)}</b><small>${Number(restaurant.rating_count || 0) ? `(${Number(restaurant.rating_count)})` : 'Novo'}</small></span>
          <span><i class="fa-regular fa-clock"></i> ${escapeHtml(deliveryLabel)}</span>
          ${restaurantDistanceMarkup(restaurant, 'v20-popular-distance')}
          <span><i class="fa-solid fa-motorcycle"></i> ${Number(restaurant.delivery_fee || 0) ? money(restaurant.delivery_fee) : 'Grátis'}</span>
        </footer>
      </article>`;
  }

  function renderRestaurantProfile(restaurantId) {
    const wrap = $('#restaurant-profile-content');
    const restaurant = state.restaurants.find((entry) => String(entry.id) === String(restaurantId));
    if (!wrap) return;
    if (!restaurant) {
      wrap.innerHTML = '<div class="v20-empty"><h2>Restaurante indisponível</h2><p>Actualize a lista e volte a tentar.</p><button class="v20-primary" type="button" data-jump-panel="food">Voltar aos restaurantes</button></div>';
      return;
    }
    state.selectedRestaurantId = restaurant.id;
    const favoriteIds = new Set(readFavoriteIds());
    const favorite = favoriteIds.has(String(restaurant.id));
    const profileFavorite = $('[data-profile-favorite]');
    if (profileFavorite) {
      profileFavorite.dataset.favoriteId = restaurant.id;
      profileFavorite.dataset.favoriteType = 'restaurant';
      profileFavorite.classList.toggle('active', favorite);
      profileFavorite.setAttribute('aria-label', favorite ? 'Remover restaurante dos favoritos' : 'Guardar restaurante');
      const icon = profileFavorite.querySelector('i');
      if (icon) icon.className = `${favorite ? 'fa-solid' : 'fa-regular'} fa-heart`;
    }
    const categories = [...new Set((restaurant.menuItems || []).map((item) => item.category || 'Geral'))];
    const averagePrep = (restaurant.menuItems || []).map((item) => Number(item.prep_time_min || 0)).filter(Boolean);
    const prep = averagePrep.length ? Math.round(averagePrep.reduce((sum, value) => sum + value, 0) / averagePrep.length) : 0;
    wrap.innerHTML = `
      <article class="v20-restaurant-profile-hero">
        <div class="v20-restaurant-profile-cover">
          ${restaurant.cover_url ? `<img src="${escapeHtml(restaurant.cover_url)}" alt="" decoding="async">` : '<span><i class="fa-solid fa-store"></i></span>'}
          <b class="${restaurant.is_open === false ? 'closed' : ''}"><i></i> ${restaurant.is_open === false ? 'Fechado' : 'Aberto agora'}</b>
        </div>
        <div class="v20-restaurant-profile-info">
          <span class="v20-restaurant-profile-logo">${restaurant.logo_url ? `<img src="${escapeHtml(restaurant.logo_url)}" alt="" decoding="async">` : escapeHtml(String(restaurant.name || 'R').slice(0, 2).toUpperCase())}</span>
          <div><h2>${escapeHtml(restaurant.name || 'Restaurante')}</h2><p>${escapeHtml(restaurant.address_text || 'Restaurante parceiro TraGo')}</p></div>
        </div>
        ${restaurant.description || restaurant.operational_note ? `<p class="v20-restaurant-about">${escapeHtml(restaurant.description || restaurant.operational_note)}</p>` : ''}
        ${restaurantCouponBanner(restaurant)}
        <div class="v20-restaurant-facts">
          <span><i class="fa-solid fa-star"></i><b>${Number(restaurant.average_rating || 0).toFixed(1)}</b><small>${Number(restaurant.rating_count || 0)} avaliações</small></span>
          <span><i class="fa-regular fa-clock"></i><b>${prep ? `${prep}–${prep + 15} min` : 'A confirmar'}</b><small>Preparação</small></span>
          <span><i class="fa-solid fa-motorcycle"></i><b>${Number(restaurant.delivery_fee || 0) ? money(restaurant.delivery_fee) : 'Grátis'}</b><small>Entrega</small></span>
          <span><i class="fa-solid fa-location-arrow"></i><b>${escapeHtml(restaurantDistanceText(restaurant, 'Localização desligada'))}</b><small>Distância aproximada</small></span>
        </div>
        <div class="v20-restaurant-rate">
          <span><strong>Classificar este restaurante</strong><small>A sua avaliação ajuda outros clientes.</small></span>
          ${renderStars({ type: 'restaurant', id: restaurant.id, restaurantId: restaurant.id, average: restaurant.average_rating, count: restaurant.rating_count })}
        </div>
      </article>
      <section class="v20-restaurant-menu">
        <header><div><small>MENU COMPLETO</small><h2>Escolha o seu prato</h2><p>${(restaurant.menuItems || []).length} produtos em ${categories.length} categorias</p></div></header>
        ${(restaurant.menuItems || []).length ? categories.map((category) => `
          <section class="v20-profile-menu-category">
            <div class="v20-section-title"><div><h3>${escapeHtml(category)}</h3><p>${(restaurant.menuItems || []).filter((item) => (item.category || 'Geral') === category).length} opções</p></div></div>
            <div class="food-grid">${(restaurant.menuItems || []).filter((item) => (item.category || 'Geral') === category).map((item) => renderFoodCard(item, restaurant)).join('')}</div>
          </section>`).join('') : '<div class="v20-empty"><h2>Menu em actualização</h2><p>Este parceiro ainda não publicou produtos.</p></div>'}
      </section>`;
  }

  function openRestaurantProfile(restaurantId) {
    state.selectedRestaurantId = restaurantId;
    renderRestaurantProfile(restaurantId);
    setPanel('restaurant-profile', { context: { id: String(restaurantId) } });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }


  function renderDishDetail(itemId) {
    const wrap = $('#dish-detail-content');
    if (!wrap) return;
    const found = findFoodItem(itemId);
    if (!found) {
      wrap.innerHTML = '<div class="empty-state">Este prato já não está disponível.</div>';
      return;
    }
    const { item, restaurant } = found;
    const siblings = (restaurant.menuItems || []).filter((entry) => String(entry.id) !== String(item.id));
    const options = Array.isArray(item.options) ? item.options : [];
    wrap.innerHTML = `
      <div class="dish-hero-grid">
        <div class="dish-hero-image">
          ${item.image_url ? `<img src="${escapeHtml(item.image_url)}" alt="${escapeHtml(item.name)}" decoding="async" fetchpriority="high">` : '<i class="fas fa-utensils"></i>'}
          <span class="food-category-badge">${escapeHtml(item.category || 'Geral')}</span>
        </div>
        <div class="dish-info">
          <span class="eyebrow-inline"><i class="fas fa-store"></i> ${escapeHtml(restaurant.name || 'Restaurante')}</span>
          <h2>${escapeHtml(item.name)}</h2>
          <p>${escapeHtml(item.description || 'Prato disponível para entrega pela Trago Delivery.')}</p>
          ${item.ingredients ? `<p><strong>Ingredientes:</strong> ${escapeHtml(item.ingredients)}</p>` : ''}
          ${item.details ? `<p><strong>Detalhes:</strong> ${escapeHtml(item.details)}</p>` : ''}
          ${Array.isArray(item.tags) && item.tags.length ? `<div class="category-strip">${item.tags.map((tag) => `<span class="category-chip">${escapeHtml(tag)}</span>`).join('')}</div>` : ''}
          ${renderStars({ type: 'food', id: item.id, restaurantId: restaurant.id, average: item.average_rating, count: item.rating_count })}
          <div class="dish-meta-grid">
            <span><strong>${money(item.price)}</strong><small>Preço</small></span>
            <span><strong>${item.prep_time_min ? `${escapeHtml(item.prep_time_min)} min` : '—'}</strong><small>Preparação</small></span>
            <span><strong>${Number(item.average_rating || 0).toFixed(1)}</strong><small>Avaliação</small></span>
            <span><strong>${escapeHtml(restaurantDistanceText(restaurant, '—'))}</strong><small>Distância do restaurante</small></span>
          </div>
          ${options.length ? `<div class="dish-option-groups">${options.map((group, groupIndex) => `<fieldset data-dish-option-group="${groupIndex}" data-required="${group.required === true}"><legend>${escapeHtml(group.name)}${group.required ? ' *' : ''}</legend>${(group.values || []).map((value, valueIndex) => `<label><input type="${group.max_select === 1 || group.required ? 'radio' : 'checkbox'}" name="dish-option-${groupIndex}" value="${valueIndex}" ${group.required && valueIndex === 0 ? 'checked' : ''}><span>${escapeHtml(value.name)}</span><b>${Number(value.price || 0) ? `+ ${money(value.price)}` : 'Incluído'}</b></label>`).join('')}</fieldset>`).join('')}</div>` : ''}
          <div class="portal-actions">
            <button class="portal-btn primary" type="button" ${options.length ? `data-add-configured-food="${escapeHtml(item.id)}"` : `data-add-food="${escapeHtml(item.id)}"`}><i class="fas fa-cart-plus"></i> Adicionar ao carrinho</button>
            <button class="portal-btn secondary" type="button" data-jump-panel="food"><i class="fas fa-layer-group"></i> Ver categorias</button>
          </div>
        </div>
      </div>
      <div class="restaurant-products-section ${siblings.length ? '' : 'restaurant-only'}">
        <div class="card-title-row">
          <div>
            <h3>${siblings.length ? `Mais produtos de ${escapeHtml(restaurant.name || 'Restaurante')}` : `Conheça ${escapeHtml(restaurant.name || 'o restaurante')}`}</h3>
            <p>${siblings.length ? 'Outras opções do menu publicado.' : 'Consulte o menu, horário e condições de entrega.'}</p>
          </div>
          ${renderStars({ type: 'restaurant', id: restaurant.id, restaurantId: restaurant.id, average: restaurant.average_rating, count: restaurant.rating_count })}
        </div>
        ${siblings.length
          ? `<div class="food-grid related-food-grid">${siblings.slice(0, 4).map((entry) => renderFoodCard(entry, restaurant)).join('')}</div>`
          : renderPopularRestaurantCard(restaurant)}
      </div>
    `;
  }

  function openDishDetail(itemId) {
    state.selectedDishId = itemId;
    renderDishDetail(itemId);
    setPanel('dish-detail', { context: { id: String(itemId), origin: state.lastPanelBeforeDish || 'food' } });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function renderHomeHighlights() {
    const newestWrap = $('#new-dishes-grid');
    const favoritesWrap = $('#favorite-dishes-grid');
    if (!newestWrap && !favoritesWrap) return;
    const allItems = getAllMenuItems();
    const newest = [...allItems].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)).slice(0, 8);
    const popularRestaurants = [...state.restaurants]
      .sort((a, b) => (Number(b.average_rating || 0) - Number(a.average_rating || 0))
        || (Number(b.rating_count || 0) - Number(a.rating_count || 0))
        || ((b.menuItems || []).length - (a.menuItems || []).length))
      .slice(0, 8);

    if (newestWrap) newestWrap.innerHTML = newest.length ? newest.map(({ restaurant, ...item }) => renderFoodCard(item, restaurant, true)).join('') : '<div class="empty-state">Ainda não há pratos novos disponíveis.</div>';
    if (favoritesWrap) favoritesWrap.innerHTML = popularRestaurants.length ? popularRestaurants.map(renderPopularRestaurantCard).join('') : '<div class="empty-state">Os restaurantes populares aparecerão aqui quando os menus estiverem disponíveis.</div>';
  }

  function readFavoriteIds() {
    try {
      const values = JSON.parse(localStorage.getItem(clientStorageKey(FAVORITES_KEY)) || '[]');
      return Array.isArray(values) ? values.map(String) : [];
    } catch (_error) {
      return [];
    }
  }

  function renderWishlist() {
    const content = $('#wishlist-content');
    if (!content) return;
    if (!state.restaurantsLoaded) {
      content.innerHTML = '<div class="trago-skeleton-grid" aria-label="A carregar favoritos"><div class="trago-skeleton-card"></div><div class="trago-skeleton-card"></div></div>';
      return;
    }
    const activeTab = $('[data-wishlist-tab].active')?.dataset.wishlistTab || 'foods';
    const favoriteIds = new Set(readFavoriteIds());
    if (activeTab === 'restaurants') {
      const restaurants = state.restaurants.filter((restaurant) => favoriteIds.has(String(restaurant.id)));
      content.innerHTML = restaurants.length
        ? `<div class="popular-restaurant-grid wishlist-restaurant-grid">${restaurants.map(renderPopularRestaurantCard).join('')}</div>`
        : '<div class="v20-empty"><img src="assets/v20/images/empty_wishlist.svg" alt=""><h2>Nenhum restaurante guardado</h2><p>Guarde os seus parceiros preferidos para abrir o menu mais depressa.</p><button class="v20-primary" type="button" data-jump-panel="food">Explorar restaurantes</button></div>';
      return;
    }
    const allFavoriteProducts = getAllMenuItems().filter((item) => favoriteIds.has(String(item.id)));
    if (activeTab === 'drinks') {
      const drinks = allFavoriteProducts.filter((item) => bottleCategoryFor(item, item.restaurant));
      content.innerHTML = drinks.length
        ? `<div class="food-grid wishlist-food-grid wishlist-drinks-grid">${drinks.map(({ restaurant, ...item }) => renderFoodCard(item, restaurant)).join('')}</div>`
        : '<div class="v20-empty"><i class="fa-solid fa-wine-bottle"></i><h2>Nenhuma bebida guardada</h2><p>Toque no coração de uma bebida para a encontrar rapidamente aqui.</p><button class="v20-primary" type="button" data-jump-panel="bottle-store">Explorar Bottle Store</button></div>';
      return;
    }
    const foods = allFavoriteProducts.filter((item) => !bottleCategoryFor(item, item.restaurant));
    content.innerHTML = foods.length
      ? `<div class="food-grid wishlist-food-grid">${foods.map(({ restaurant, ...item }) => renderFoodCard(item, restaurant)).join('')}</div>`
      : '<div class="v20-empty"><img src="assets/v20/images/empty_wishlist.svg" alt=""><h2>Nenhum prato guardado</h2><p>Toque no coração de um prato para o encontrar aqui.</p><button class="v20-primary" type="button" data-jump-panel="food">Explorar restaurantes</button></div>';
  }

  window.TragoClientRenderWishlist = renderWishlist;
  document.addEventListener('trago:favorites-changed', () => {
    renderWishlist();
    renderRestaurants();
    if (state.selectedRestaurantId) renderRestaurantProfile(state.selectedRestaurantId);
    if (state.activePanel === 'bottle-profile' && state.selectedRestaurantId) renderBottleProfile(state.selectedRestaurantId);
  });

  function renderRestaurants() {
    const container = $('#restaurants-container');
    if (!container) return;
    const restaurants = getFilteredRestaurants();
    const resultCount = $('#directory-result-count');
    if (resultCount) resultCount.textContent = restaurants.length
      ? `${restaurants.length} restaurante(s) · ${restaurants.reduce((sum, restaurant) => sum + (restaurant.menuItems || []).length, 0)} produto(s)`
      : 'Nenhum resultado para estes filtros';
    if (!restaurants.length) {
      container.innerHTML = '<div class="empty-state">Nenhum prato disponível neste filtro.</div>';
      return;
    }
    container.innerHTML = restaurants.map((restaurant) => {
      const categories = [...new Set((restaurant.menuItems || []).map((item) => item.category || 'Geral'))];
      const cards = categories.map((category) => {
        const items = (restaurant.menuItems || []).filter((item) => (item.category || 'Geral') === category);
        return `
          <div class="category-strip"><span class="category-chip">${escapeHtml(category)}</span></div>
          <div class="food-grid">
            ${items.map((item) => renderFoodCard(item, restaurant)).join('')}
          </div>
        `;
      }).join('');
      return `
        <section class="restaurant-group ${restaurant.is_open === false ? 'restaurant-closed' : ''}" data-restaurant-id="${escapeHtml(restaurant.id)}">
          <div class="restaurant-head" data-open-restaurant="${escapeHtml(restaurant.id)}" tabindex="0" role="button" aria-label="Abrir perfil de ${escapeHtml(restaurant.name)}">
            <div class="restaurant-id">
              <div class="restaurant-logo">${restaurant.logo_url ? `<img src="${escapeHtml(restaurant.logo_url)}" alt="${escapeHtml(restaurant.name)}" loading="lazy" decoding="async">` : escapeHtml(String(restaurant.name || 'R').slice(0,2).toUpperCase())}</div>
              <div>
                <h3>${escapeHtml(restaurant.name)}</h3>
                <p>${escapeHtml(restaurant.address_text || 'Restaurante parceiro Trago')}</p>
                <div class="v20-restaurant-head-context">${restaurantDistanceMarkup(restaurant)}${restaurantCouponMarkup(restaurant)}</div>
                ${renderStars({ type: 'restaurant', id: restaurant.id, restaurantId: restaurant.id, average: restaurant.average_rating, count: restaurant.rating_count })}
              </div>
            </div>
            <span class="status-pill"><i class="fas fa-store"></i> ${restaurant.is_open === false ? 'Fechado' : `${categories.length} categoria(s)`}</span>
          </div>
          ${restaurant.operational_note ? `<div class="restaurant-operational-alert"><i class="fas fa-bullhorn"></i><span>${escapeHtml(restaurant.operational_note)}</span></div>` : ''}
          ${cards}
        </section>
      `;
    }).join('');
  }

  function renderAllFoodViews() {
    syncDirectoryQuickButtons();
    renderCategoryBar();
    renderRestaurants();
    renderBottleStore();
    renderHomeHighlights();
    renderWishlist();
    if (state.selectedRestaurantId) renderRestaurantProfile(state.selectedRestaurantId);
    if (state.activePanel === 'bottle-profile' && state.selectedRestaurantId) renderBottleProfile(state.selectedRestaurantId);
  }

  function findFoodItem(itemId) {
    for (const restaurant of state.restaurants) {
      const item = (restaurant.menuItems || []).find((entry) => String(entry.id || entry._id) === String(itemId));
      if (item) return { item, restaurant };
    }
    return null;
  }

  function addToCart(itemId, selectedOptions = null) {
    const found = findFoodItem(itemId);
    if (!found) return;
    const { item, restaurant } = found;
    if (restaurant.is_open === false) {
      toast('Este restaurante está fechado para novos pedidos.', 'error');
      return;
    }
    if (state.cart.length && String(state.cart[0].restaurant.id) !== String(restaurant.id)) {
      toast('Por agora, cada pedido de comida deve ser feito num restaurante de cada vez.', 'error');
      return;
    }
    if (Array.isArray(item.options) && item.options.length && !selectedOptions) {
      openDishDetail(item.id);
      toast('Escolha as opções do produto antes de adicionar.');
      return;
    }
    const extraPrice = (selectedOptions || []).reduce((sum, option) => sum + Number(option.price || 0), 0);
    const configuredItem = selectedOptions
      ? { ...item, base_price: Number(item.price || 0), price: Number(item.price || 0) + extraPrice }
      : item;
    const existing = state.cart.find((entry) => String(entry.item.id) === String(item.id));
    if (existing) existing.qty += 1;
    else state.cart.push({ item: configuredItem, restaurant, qty: 1, selectedOptions: selectedOptions || [] });
    state.foodQuote = null;
    invalidateAppliedCoupon('O cesto mudou. Confirme novamente o cupão.');
    renderCart();
    toast(`${item.name} adicionado ao carrinho.`);
  }

  function updateCart(itemId, delta) {
    const entry = state.cart.find((cartItem) => String(cartItem.item.id) === String(itemId));
    if (!entry) return;
    entry.qty += delta;
    if (entry.qty <= 0) state.cart = state.cart.filter((cartItem) => String(cartItem.item.id) !== String(itemId));
    state.foodQuote = null;
    invalidateAppliedCoupon('O cesto mudou. Confirme novamente o cupão.');
    renderCart();
  }

  function removeCartItem(itemId) {
    state.cart = state.cart.filter((cartItem) => String(cartItem.item.id) !== String(itemId));
    state.foodQuote = null;
    invalidateAppliedCoupon('O cesto mudou. Confirme novamente o cupão.');
    renderCart();
  }

  function clearCart() {
    if (!state.cart.length) return;
    state.cart = [];
    state.foodQuote = null;
    invalidateAppliedCoupon('', { clearCode: true });
    renderCart();
    toast('Carrinho limpo.');
  }

  function cartSubtotal() {
    return state.cart.reduce((sum, entry) => sum + Number(entry.item.price || 0) * entry.qty, 0);
  }

  function cartCount() {
    return state.cart.reduce((sum, entry) => sum + entry.qty, 0);
  }

  function updateCartBadges() {
    const count = cartCount();
    $$('#cart-count-mobile, #cart-count-desktop').forEach((el) => { el.textContent = String(count); });
  }

  function getRestaurantCoords(restaurant) {
    const coords = restaurant?.address_coords;
    if (isValidCoord(coords)) return { lat: Number(coords.lat), lng: Number(coords.lng) };
    return null;
  }

  function getFoodDeliveryCoords() {
    const lat = $('#food-delivery-lat')?.value;
    const lng = $('#food-delivery-lng')?.value;
    const coords = { lat: Number(lat), lng: Number(lng) };
    return isValidCoord(coords) ? coords : (isValidCoord(state.foodDeliveryCoords) ? state.foodDeliveryCoords : null);
  }

  function setCartCouponFeedback(message = '', tone = 'info') {
    const feedback = $('#cart-coupon-feedback');
    if (!feedback) return;
    feedback.textContent = String(message || '');
    feedback.hidden = !message;
    feedback.className = `v20-coupon-feedback is-${['success', 'warning', 'error'].includes(tone) ? tone : 'info'}`;
  }

  function invalidateAppliedCoupon(message = '', { clearCode = false } = {}) {
    state.appliedCoupon = null;
    if (clearCode && $('#cart-coupon')) $('#cart-coupon').value = '';
    setCartCouponFeedback(message, 'info');
  }

  function couponMinimumOrderMzn(coupon) {
    if (!coupon) return 0;
    if (coupon.min_order_cents !== undefined && coupon.min_order_cents !== null) {
      return Math.max(0, Number(coupon.min_order_cents || 0) / 100);
    }
    return Math.max(0, Number(coupon.min || coupon.minimum_order || 0));
  }

  function couponDiscountType(coupon) {
    return String(coupon?.discount_type || coupon?.type || '').toLowerCase();
  }

  function findCatalogCoupon(code, restaurant) {
    const normalizedCode = String(code || '').trim().toUpperCase();
    if (!normalizedCode) return null;
    const restaurantId = String(restaurant?.id || '');
    const candidates = [
      ...(Array.isArray(restaurant?.coupons) ? restaurant.coupons : []),
      ...(Array.isArray(state.catalogCoupons) ? state.catalogCoupons : [])
    ].filter((coupon) => String(coupon?.code || '').trim().toUpperCase() === normalizedCode);
    return candidates.find((coupon) => String(coupon.source || 'restaurant') === 'restaurant' && String(coupon.restaurant_id || restaurantId) === restaurantId)
      || candidates.find((coupon) => {
        const ids = Array.isArray(coupon.restaurant_ids) ? coupon.restaurant_ids.map(String) : [];
        return !ids.length || ids.includes(restaurantId);
      })
      || candidates[0]
      || null;
  }

  function evaluateCatalogCouponLocally(code, restaurant) {
    const coupon = findCatalogCoupon(code, restaurant);
    if (!coupon) return null;
    const subtotal = cartSubtotal();
    const minimumOrder = couponMinimumOrderMzn(coupon);
    const restaurantId = String(restaurant?.id || '');
    const couponRestaurantId = String(coupon.restaurant_id || '');
    const restaurantIds = Array.isArray(coupon.restaurant_ids) ? coupon.restaurant_ids.map(String) : [];
    const expiresAt = coupon.expires_at ? new Date(coupon.expires_at).getTime() : 0;
    const startsAt = coupon.starts_at ? new Date(coupon.starts_at).getTime() : 0;
    const totalLimit = Math.max(0, Number(coupon.total_limit ?? coupon.limit ?? 0));
    const used = Math.max(0, Number(coupon.usage_count ?? coupon.used ?? 0));
    const result = (status, message, tone = 'info', extra = {}) => ({
      recognized: true,
      valid: false,
      eligible: false,
      status,
      code: String(code || '').trim().toUpperCase(),
      message,
      severity: tone,
      minimum_order: minimumOrder,
      current_subtotal: subtotal,
      ...extra
    });
    if (coupon.active === false) return result('inactive', 'Este cupão está temporariamente indisponível.', 'warning');
    if (startsAt && startsAt > Date.now()) return result('not_started', `Este cupão ficará disponível em ${new Date(startsAt).toLocaleDateString('pt-MZ')}.`);
    if (expiresAt && expiresAt < Date.now()) return result('expired', 'Este cupão expirou.', 'warning');
    if (totalLimit > 0 && used >= totalLimit) return result('usage_limit_reached', 'Este cupão já atingiu o limite de utilizações.', 'warning');
    if (couponRestaurantId && couponRestaurantId !== restaurantId) return result('restaurant_mismatch', 'Este cupão pertence a outro restaurante.');
    if (restaurantIds.length && !restaurantIds.includes(restaurantId)) return result('restaurant_mismatch', 'Este cupão não se aplica ao restaurante seleccionado.');
    if ((coupon.first_order_only === true || Number(coupon.per_client_limit || 0) > 0) && !readSession()?.token) {
      return result('login_required', 'Entre na sua conta para confirmar a elegibilidade deste cupão.');
    }
    if (subtotal < minimumOrder) {
      const missing = Math.max(0, minimumOrder - subtotal);
      return result('minimum_not_reached', `Pedido mínimo de ${money(minimumOrder)}. Adicione mais ${money(missing)} ao cesto.`, 'info', { missing_amount: missing });
    }
    if (couponDiscountType(coupon).includes('delivery') && Number(state.foodQuote?.delivery_fee || 0) <= 0) {
      return result('delivery_fee_pending', 'Calcule primeiro a distância para aplicar o desconto na entrega.');
    }
    return { recognized: true, eligible: null, coupon };
  }

  function legacyCouponBusinessResult(response, data, code) {
    const message = String(data?.message || '').trim();
    if (![400, 401, 404, 422].includes(Number(response?.status)) || !/cup[aã]o|pedido m[ií]nimo/i.test(message)) return null;
    const lower = message.toLowerCase();
    const status = lower.includes('mínimo') ? 'minimum_not_reached'
      : lower.includes('expir') ? 'expired'
        : lower.includes('primeiro pedido') ? 'first_order_only'
          : lower.includes('entre na sua conta') ? 'login_required'
            : lower.includes('restaurante') ? 'restaurant_mismatch'
              : lower.includes('limite') ? 'usage_limit_reached'
                : lower.includes('inexistente') ? 'not_found'
                  : 'not_eligible';
    return {
      recognized: status !== 'not_found',
      valid: false,
      eligible: false,
      status,
      code,
      message: message || 'Este cupão não pode ser aplicado agora.',
      severity: ['expired', 'usage_limit_reached', 'not_found'].includes(status) ? 'warning' : 'info',
      discount: 0
    };
  }

  function presentCouponEligibility(result) {
    state.appliedCoupon = null;
    renderCartQuote();
    const tone = result?.severity === 'warning' ? 'warning' : 'info';
    setCartCouponFeedback(result?.message || 'Este cupão não pode ser aplicado agora.', tone);
    toast(result?.message || 'Consulte as condições do cupão.');
    return result;
  }

  function renderCartQuote() {
    const subtotal = cartSubtotal();
    const quote = state.foodQuote;
    const discount = Number(state.appliedCoupon?.discount || 0);
    $('#cart-total') && ($('#cart-total').textContent = money(subtotal));
    $('#cart-distance-label') && ($('#cart-distance-label').textContent = quote?.distance_km ? `${Number(quote.distance_km).toFixed(2)} km` : '—');
    $('#cart-delivery-fee-label') && ($('#cart-delivery-fee-label').textContent = quote?.delivery_fee ? money(quote.delivery_fee) : '—');
    $('#cart-grand-total') && ($('#cart-grand-total').textContent = money(Math.max(0, subtotal + Number(quote?.delivery_fee || 0) - discount)));
    const summary = $('.v20-order-summary');
    let discountRow = $('#cart-coupon-discount-row');
    if (summary && discount && !discountRow) {
      discountRow = document.createElement('div');
      discountRow.id = 'cart-coupon-discount-row';
      summary.querySelector('.total')?.before(discountRow);
    }
    if (discountRow) {
      discountRow.hidden = !discount;
      discountRow.innerHTML = `<span>Cupão ${escapeHtml(state.appliedCoupon.code || '')}</span><strong>− ${money(discount)}</strong>`;
    }
    const help = $('#cart-distance-help');
    if (help) {
      if (!state.cart.length) help.textContent = 'Adicione pratos para iniciar um pedido.';
      else if (quote?.source) help.textContent = quote.source === 'openrouteservice' ? 'Distância calculada pela rota.' : 'Distância estimada localmente.';
      else help.textContent = 'Para calcular a distância, o restaurante precisa ter coordenadas e a entrega deve estar marcada no mapa.';
    }
    const orderFeedback = $('#cart-order-condition-feedback');
    if (orderFeedback) {
      const minimumOrder = Math.max(0, Number(state.cart[0]?.restaurant?.min_order_amount || 0));
      const missing = Math.max(0, minimumOrder - subtotal);
      orderFeedback.hidden = !state.cart.length || missing <= 0;
      orderFeedback.textContent = missing > 0
        ? `Pedido mínimo: ${money(minimumOrder)}. Faltam ${money(missing)} no cesto.`
        : '';
    }
    renderActiveMapQuote();
  }

  function renderCart() {
    const list = $('#cart-list');
    const restaurantLabel = $('#cart-restaurant-label');
    const clearBtn = $('#btn-clear-cart');
    persistCart();
    updateCartBadges();
    if (!list) return;
    if (!state.cart.length) {
      list.innerHTML = '<div class="empty-state">Carrinho vazio.</div>';
      if (restaurantLabel) restaurantLabel.textContent = 'Selecione pratos de um restaurante.';
      if (clearBtn) clearBtn.disabled = true;
      renderCartQuote();
      return;
    }
    if (clearBtn) clearBtn.disabled = false;
    if (restaurantLabel) restaurantLabel.textContent = `Restaurante: ${state.cart[0].restaurant.name}`;
    list.innerHTML = state.cart.map((entry) => `
      <div class="cart-item">
        <div>
          <strong>${escapeHtml(entry.item.name)}</strong>
          <small>${money(entry.item.price)} · ${entry.qty} un.${entry.selectedOptions?.length ? ` · ${escapeHtml(entry.selectedOptions.map((option) => option.name).join(', '))}` : ''}</small>
        </div>
        <div class="qty-row">
          <button class="qty-btn" type="button" data-cart-dec="${escapeHtml(entry.item.id)}" aria-label="Reduzir quantidade">−</button>
          <strong>${entry.qty}</strong>
          <button class="qty-btn" type="button" data-cart-inc="${escapeHtml(entry.item.id)}" aria-label="Aumentar quantidade">+</button>
          <button class="qty-btn remove" type="button" data-cart-remove="${escapeHtml(entry.item.id)}" aria-label="Remover item"><i class="fas fa-xmark"></i></button>
        </div>
      </div>
    `).join('');
    renderCartQuote();
  }

  async function calculateCartDistance(showFeedback = true) {
    if (!state.cart.length) {
      state.foodQuote = null;
      renderCartQuote();
      return null;
    }
    const restaurant = state.cart[0].restaurant;
    const origin = getRestaurantCoords(restaurant);
    const destination = getFoodDeliveryCoords();
    if (!origin) {
      state.foodQuote = null;
      renderCartQuote();
      if (showFeedback) toast('Este restaurante ainda não tem coordenadas no perfil. Peça ao restaurante para actualizar o endereço no portal.', 'error');
      return null;
    }
    if (!destination) {
      state.foodQuote = null;
      renderCartQuote();
      if (showFeedback) toast('Marque o ponto de entrega no mapa ou use a sua localização.', 'error');
      return null;
    }
    state.foodQuote = await quotePublicRoute(origin, destination);
    renderCartQuote();
    if (showFeedback) toast(`Distância calculada: ${Number(state.foodQuote.distance_km || 0).toFixed(2)} km.`);
    return state.foodQuote;
  }

  async function applyCartCoupon() {
    if (!state.cart.length) return toast('Adicione produtos antes de aplicar um cupão.', 'error');
    const code = String($('#cart-coupon')?.value || '').trim().toUpperCase();
    if (!code) {
      setCartCouponFeedback('Indique o código do cupão.', 'info');
      return;
    }
    const session = readSession();
    const restaurant = state.cart[0].restaurant;
    const localEligibility = evaluateCatalogCouponLocally(code, restaurant);
    if (localEligibility?.eligible === false) return presentCouponEligibility(localEligibility);

    const button = $('.v20-coupon-input button');
    const originalText = button?.textContent || 'Aplicar';
    if (button) {
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      button.textContent = 'A verificar…';
    }
    setCartCouponFeedback('A verificar condições do cupão…', 'info');
    try {
      const response = await fetch(`${API_URL}/api/public/coupons/validate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Trago-Coupon-Contract': 'eligibility-v1',
          ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {})
        },
        body: JSON.stringify({
          code,
          restaurant_id: restaurant.id,
          subtotal: cartSubtotal(),
          delivery_fee: Number(state.foodQuote?.delivery_fee || 0)
        })
      });
      const data = await readJsonResponse(response);
      if (!response.ok) {
        const businessResult = legacyCouponBusinessResult(response, data, code);
        if (businessResult) return presentCouponEligibility(businessResult);
        throw new Error(data.message || 'Não foi possível verificar o cupão.');
      }
      if (data.eligible !== true) return presentCouponEligibility(data);
      state.appliedCoupon = data;
      renderCartQuote();
      setCartCouponFeedback(`${data.label || `Cupão ${code}`} aplicado. Desconto: ${money(data.discount)}.`, 'success');
      toast(`${data.label || `Cupão ${code}`} aplicado: ${money(data.discount)} de desconto.`);
      return data;
    } finally {
      if (button) {
        button.disabled = false;
        button.removeAttribute('aria-busy');
        button.textContent = originalText;
      }
    }
  }

  function openCartModal() {
    const modal = $('#cart-modal');
    if (!modal) return;
    modal.classList.add('show');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('cart-modal-open');
    renderCart();
  }

  function closeCartModal(silent = true) {
    const modal = $('#cart-modal');
    if (!modal) return;
    modal.classList.remove('show');
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('cart-modal-open');
    if (!silent) return;
  }

  async function checkoutFood(event) {
    event.preventDefault();
    if (!state.cart.length) {
      toast('Adicione pelo menos um prato ao carrinho.', 'error');
      return;
    }
    const form = event.target;
    const btn = form.querySelector('button[type="submit"]');
    const restaurant = state.cart[0].restaurant;
    if (restaurant.is_open === false) {
      toast('O restaurante fechou para novos pedidos. Escolha outro restaurante.', 'error');
      return;
    }
    const subtotal = cartSubtotal();
    const minimumOrder = Math.max(0, Number(restaurant.min_order_amount || 0));
    if (subtotal < minimumOrder) {
      const missing = Math.max(0, minimumOrder - subtotal);
      renderCartQuote();
      toast(`Pedido mínimo de ${money(minimumOrder)}. Adicione mais ${money(missing)} ao cesto.`);
      $('#cart-list')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (!isValidCoord(restaurant.address_coords) || String(restaurant.address_text || '').trim().length < 5) {
      toast('Este estabelecimento ainda não publicou o ponto exacto de recolha. Escolha outro parceiro ou contacte a loja.', 'error');
      return;
    }
    await ensureAddressCoordinates({ inputSelector: '#food-delivery-address', kind: 'food-delivery', latSelector: '#food-delivery-lat', lngSelector: '#food-delivery-lng' });
    if (!isValidCoord(state.foodDeliveryCoords)) {
      toast('Seleccione no mapa o ponto exacto onde pretende receber o pedido.', 'error');
      return;
    }
    if (!state.foodQuote) await calculateCartDistance(false);
    const quote = state.foodQuote || {};
    const itemsSummary = state.cart.map((entry) => `${entry.qty}x ${entry.item.name} (${money(entry.item.price)})`).join('; ');
    const payload = {
      public_source: 'client_food',
      service_type: 'restaurante_comida',
      client_name: $('#food-client-name')?.value || state.session?.name || 'Cliente',
      client_phone1: $('#food-client-phone')?.value || state.session?.phone || '',
      client_phone2: $('#food-client-phone2')?.value || '',
      pickup_address_text: restaurant.address_text || restaurant.name,
      pickup_contact_name: restaurant.name,
      pickup_contact_phone: restaurant.phone || '',
      pickup_lat: restaurant.address_coords?.lat,
      pickup_lng: restaurant.address_coords?.lng,
      address_text: $('#food-delivery-address')?.value || '',
      lat: $('#food-delivery-lat')?.value || undefined,
      lng: $('#food-delivery-lng')?.value || undefined,
      service_price: subtotal,
      price: subtotal,
      delivery_fee: quote.delivery_fee || 0,
      route_distance_km: quote.distance_km || 0,
      route_duration_min: quote.duration_min || 0,
      payment_method: $('#food-payment-method')?.value || 'cash',
      pickup_notes: `Pedido de comida · Restaurante: ${restaurant.name}. Itens: ${itemsSummary}. Observações do cliente: ${$('#food-notes')?.value || '—'}`,
      client_notes: $('#food-notes')?.value || '',
      restaurant_id: restaurant.id,
      food_items: state.cart.map((entry) => ({ id: entry.item.id, name: entry.item.name, qty: entry.qty, price: Number(entry.item.price || 0), base_price: Number(entry.item.base_price ?? entry.item.price ?? 0), category: entry.item.category || 'Geral', options: entry.selectedOptions || [] })),
      scheduled_at: $('#food-scheduled-at')?.value ? new Date($('#food-scheduled-at').value).toISOString() : null,
      coupon_code: state.appliedCoupon?.code || '',
      customer_session_id: state.session?.id || state.session?.phone || 'guest'
    };
    if (!payload.address_text) {
      toast('Indique o endereço de entrega da comida.', 'error');
      return;
    }
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> A enviar pedido...';
    try {
      const order = await createPublicOrder(payload);
      upsertOrderHistory(order);
      toast(`Pedido de comida enviado. Código: ${order.verification_code || '—'}`);
      await runDriverRadar(order);
      state.cart = [];
      state.foodQuote = null;
      invalidateAppliedCoupon('', { clearCode: true });
      state.foodDeliveryCoords = null;
      if (state.foodDeliveryMarker) { state.map?.removeLayer(state.foodDeliveryMarker); state.foodDeliveryMarker = null; }
      renderCart();
      form.reset();
      initSessionUI();
      closeCartModal();
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-bag-shopping"></i> Finalizar pedido de comida';
    }
  }

  const radarState = {
    order: null,
    map: null,
    markers: null,
    candidates: [],
    radiusControl: null,
    navigationControl: null,
    camera: null,
    hasInitialFit: false,
    selectedDriverId: '',
    driverMarkers: new Map(),
    orderKey: '',
    lastResult: {},
    points: [],
    pickup: null
  };

  function orderPoint(order, prefix) {
    const location = prefix === 'pickup'
      ? (order?.pickup_address_coords || order?.pickup_location)
      : (order?.address_coords || order?.delivery_location);
    const coordinates = Array.isArray(location?.coordinates) ? location.coordinates : [];
    const lat = Number(order?.[`${prefix}_lat`] ?? location?.lat ?? coordinates[1]);
    const lng = Number(order?.[`${prefix}_lng`] ?? location?.lng ?? coordinates[0]);
    return Number.isFinite(lat) && Number.isFinite(lng)
      && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
      && !(Math.abs(lat) < 0.000001 && Math.abs(lng) < 0.000001)
      ? { lat, lng } : null;
  }

  function radarMarkerIcon(kind, label = '') {
    return clientMapIcon(kind, label, { live: kind === 'driver' });
  }

  function clusterRadarCandidates(candidates, zoom) {
    const cell = Math.max(0.0005, 0.02 / Math.pow(2, Math.max(0, Number(zoom || 12) - 12)));
    const groups = new Map();
    candidates.forEach((driver) => {
      const lat = Number(driver.location?.lat);
      const lng = Number(driver.location?.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      const key = `${Math.round(lat / cell)}:${Math.round(lng / cell)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ driver, lat, lng });
    });
    return [...groups.values()];
  }

  function openRadarModal(order) {
    const modal = $('#driver-radar-modal');
    if (!modal) return;
    const orderKey = String(order?._id || order?.id || '');
    if (radarState.orderKey !== orderKey) {
      radarState.hasInitialFit = false;
      radarState.selectedDriverId = '';
      radarState.orderKey = orderKey;
    }
    radarState.order = order;
    document.body.classList.add('radar-open');
    modal.classList.add('show');
    modal.setAttribute('aria-hidden', 'false');
    $('#radar-title') && ($('#radar-title').textContent = 'Escolha o seu motorista');
    $('#radar-message') && ($('#radar-message').textContent = `Pedido #${String(order?._id || order?.id || '').slice(-6).toUpperCase()} · procura inicial em 5 km, com expansão automática até 25 km.`);
    $('#radar-status') && ($('#radar-status').textContent = 'A actualizar localizações…');
    $('#radar-progress-bar') && ($('#radar-progress-bar').style.width = '0%');
    $('#driver-radar-candidates') && ($('#driver-radar-candidates').innerHTML = '<div class="radar-loading"><i class="fa-solid fa-spinner fa-spin"></i><span>A procurar motoristas online e livres…</span></div>');
  }

  function updateRadarModal({ progress = 0, message = '', status = '' } = {}) {
    const pct = Math.min(100, Math.max(0, Number(progress) || 0));
    $('#radar-progress-bar') && ($('#radar-progress-bar').style.width = `${pct}%`);
    if (message && $('#radar-message')) $('#radar-message').textContent = message;
    if (status && $('#radar-status')) $('#radar-status').textContent = status;
  }

  function closeRadarModal(delay = 0) {
    const modal = $('#driver-radar-modal');
    if (!modal) return;
    setTimeout(() => {
      modal.classList.remove('show');
      modal.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('radar-open');
    }, delay);
  }

  async function requestRadarAssignment(orderId, accessToken) {
    const session = readSession();
    const response = await fetch(`${API_URL}/api/public/orders/${encodeURIComponent(orderId)}/radar-assign`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Order-Access-Token': accessToken || '',
        ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {})
      }
    });
    const data = await readJsonResponse(response);
    if (!response.ok) throw new Error(data.message || 'Falha no radar de motoristas.');
    return data;
  }

  async function requestDriverOffer(orderId, driverId, accessToken) {
    const session = readSession();
    const response = await fetch(`${API_URL}/api/public/orders/${encodeURIComponent(orderId)}/driver-offer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Order-Access-Token': accessToken || '',
        ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {})
      },
      body: JSON.stringify({ driverId })
    });
    const data = await readJsonResponse(response);
    if (!response.ok) throw new Error(data.message || 'Não foi possível enviar o pedido ao motorista.');
    return data;
  }

  function renderRadarMap(order, candidates = [], radarResult = {}) {
    const mapElement = $('#driver-radar-map');
    if (!mapElement || !window.L) return;
    radarState.lastResult = { ...radarState.lastResult, ...radarResult };
    if (!radarState.map) {
      radarState.map = L.map(mapElement, {
        zoomControl: false,
        attributionControl: true,
        touchZoom: true,
        doubleClickZoom: true,
        keyboard: true,
        boxZoom: false
      });
      if (window.TragoMapUI?.addZoomControl) window.TragoMapUI.addZoomControl(radarState.map);
      else L.control.zoom({ position: 'bottomright' }).addTo(radarState.map);
      addClientBaseMap(radarState.map);
      radarState.camera = window.TragoMapUI?.createCameraController?.(radarState.map) || null;
      radarState.map._tragoCamera = radarState.camera;
      window.TragoMapUI?.observeMapSize?.(radarState.map);
      radarState.radiusControl = window.TragoMapUI?.addStatusControl?.(radarState.map, {
        label: 'Raio 5 km',
        icon: 'fa-tower-broadcast',
        tone: 'radius',
        position: 'topright'
      }) || null;
      radarState.navigationControl = window.TragoMapUI?.addNavigationControl?.(radarState.map, {
        label: 'Navegação do radar',
        position: 'topright',
        actions: [
          {
            id: 'fit-radar',
            icon: 'fa-route',
            title: 'Ver toda a zona e os motoristas',
            onClick: () => focusMapPoints(radarState.map, radarState.points, {
              camera: radarState.camera,
              force: true,
              mode: 'free',
              paddingTopLeft: [44, 128],
              paddingBottomRight: [44, 210],
              maxZoom: 15
            })
          },
          {
            id: 'focus-pickup',
            icon: 'fa-store',
            title: 'Centrar no ponto de recolha',
            onClick: () => {
              if (radarState.pickup) radarState.camera?.setView(radarState.pickup, 16, { force: true, mode: 'free' });
            }
          }
        ]
      }) || null;
      radarState.markers = L.layerGroup().addTo(radarState.map);
      radarState.map.on('zoomend', () => {
        if (radarState.order) renderRadarMap(radarState.order, radarState.candidates, radarState.lastResult);
      });
    }
    window.TragoMapUI?.syncPartnerLayer?.(radarState.map, clientMapPartners());
    radarState.markers.clearLayers();
    radarState.driverMarkers.clear();
    const points = [];
    const pickup = orderPoint(order, 'pickup');
    radarState.pickup = pickup ? [pickup.lat, pickup.lng] : null;
    const searchRadiusKm = Math.max(5, Math.min(25, Number(radarResult.search_radius_km || 5)));
    radarState.radiusControl?.setLabel?.(`Raio ${searchRadiusKm} km`);
    if (pickup) {
      points.push([pickup.lat, pickup.lng]);
      L.circle([pickup.lat, pickup.lng], {
        radius: searchRadiusKm * 1000,
        color: '#69be35',
        weight: 1.5,
        opacity: 0.35,
        fillColor: '#8dd35a',
        fillOpacity: 0.055,
        interactive: false
      }).addTo(radarState.markers);
      L.marker([pickup.lat, pickup.lng], { icon: radarMarkerIcon('pickup', 'Recolha') }).addTo(radarState.markers);
    }
    candidates.forEach((driver) => {
      const lat = Number(driver.location?.lat);
      const lng = Number(driver.location?.lng);
      if (Number.isFinite(lat) && Number.isFinite(lng)) points.push([lat, lng]);
    });
    clusterRadarCandidates(candidates, radarState.map.getZoom()).forEach((group) => {
      if (group.length > 1) {
        const center = [
          group.reduce((sum, item) => sum + item.lat, 0) / group.length,
          group.reduce((sum, item) => sum + item.lng, 0) / group.length
        ];
        const icon = L.divIcon({
          className: 'trago-radar-cluster',
          html: `<span>${group.length}</span><small>motoristas</small>`,
          iconSize: [50, 50],
          iconAnchor: [25, 25]
        });
        L.marker(center, { icon, title: `${group.length} motoristas nesta zona` })
          .on('click', () => radarState.camera?.setView(center, Math.min(18, radarState.map.getZoom() + 2), { force: true, mode: 'free' }))
          .addTo(radarState.markers);
        return;
      }
      const { driver, lat, lng } = group[0];
      const marker = L.marker([lat, lng], { icon: radarMarkerIcon('driver', driver.name || 'Motorista') })
        .bindPopup(`<strong>${escapeHtml(driver.name || 'Motorista TraGo')}</strong><br>${Number(driver.distance_km || 0).toFixed(1)} km da recolha`)
        .addTo(radarState.markers);
      marker.on('click', () => selectRadarCandidate(String(driver.id || '')));
      marker.on('add', () => marker.getElement?.()?.classList.toggle('is-selected-driver', String(driver.id || '') === radarState.selectedDriverId));
      radarState.driverMarkers.set(String(driver.id || ''), marker);
    });
    radarState.points = [radarState.pickup, ...candidates
      .slice()
      .sort((a, b) => Number(a.distance_km || 0) - Number(b.distance_km || 0))
      .slice(0, 10)
      .map((driver) => [Number(driver.location?.lat), Number(driver.location?.lng)])]
      .filter((point) => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]));
    if (!radarState.hasInitialFit) {
      const radarHasPoints = focusMapPoints(radarState.map, radarState.points, {
        camera: radarState.camera,
        paddingTopLeft: [44, 128],
        paddingBottomRight: [44, 210],
        maxZoom: 15
      });
      if (!radarHasPoints) radarState.camera?.setView([-25.9692, 32.5732], 12, { mode: 'initial-fit' });
      radarState.hasInitialFit = true;
    }
    setTimeout(() => radarState.map?.invalidateSize(), 80);
  }

  function selectRadarCandidate(driverId) {
    const id = String(driverId || '');
    const driver = radarState.candidates.find((candidate) => String(candidate.id || '') === id);
    if (!driver) return;
    radarState.selectedDriverId = id;
    $$('.radar-driver-card').forEach((card) => card.classList.toggle('is-selected', card.dataset.driverId === id));
    $$('[data-select-radar-driver]').forEach((button) => {
      const selected = button.dataset.selectRadarDriver === id;
      button.classList.toggle('is-confirm', selected);
      button.textContent = selected ? 'Confirmar' : 'Escolher';
      button.setAttribute('aria-pressed', String(selected));
    });
    radarState.driverMarkers.forEach((marker, markerId) => marker.getElement?.()?.classList.toggle('is-selected-driver', markerId === id));
    const lat = Number(driver.location?.lat);
    const lng = Number(driver.location?.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      radarState.camera?.setView([lat, lng], Math.max(15, radarState.map?.getZoom?.() || 15), { force: true, mode: 'free' });
      radarState.driverMarkers.get(id)?.openPopup?.();
    }
    updateRadarModal({
      progress: 100,
      message: `${driver.name || 'Motorista'} está a ${Number(driver.distance_km || 0).toFixed(1)} km da recolha. Toque em Confirmar para enviar a oferta.`,
      status: `Chegada estimada à recolha: ${Math.max(2, Math.round(Number(driver.distance_km || 0) * 3 + 2))} min · nenhuma oferta enviada ainda`
    });
  }

  function renderRadarCandidates(candidates = [], radarResult = {}) {
    const wrap = $('#driver-radar-candidates');
    if (!wrap) return;
    if (!candidates.length) {
      const checked = Number(radarResult.candidates_checked || 0);
      wrap.innerHTML = `<div class="radar-empty"><i class="fa-solid fa-motorcycle"></i><strong>${checked ? 'Nenhum motorista livre dentro de 25 km' : 'Nenhum motorista com presença recente'}</strong><p>${checked ? 'Os motoristas online verificados estão fora do raio máximo ou já recusaram este pedido.' : 'Peça ao motorista para manter a localização activa e actualize o radar.'} O pedido continua pendente.</p></div>`;
      return;
    }
    wrap.innerHTML = candidates.map((driver) => `
      <article class="radar-driver-card${String(driver.id || '') === radarState.selectedDriverId ? ' is-selected' : ''}" data-driver-id="${escapeHtml(driver.id)}" data-eta="ETA ${Math.max(2, Math.round(Number(driver.distance_km || 0) * 3 + 2))} min">
        <span class="radar-driver-avatar">${driver.avatar_url ? `<img src="${escapeHtml(driver.avatar_url)}" alt="">` : `<b>${escapeHtml(String(driver.name || 'M').slice(0, 1).toUpperCase())}</b>`}<i class="fa-solid fa-circle-check"></i></span>
        <div><strong>${escapeHtml(driver.name || 'Motorista TraGo')}</strong><small><i class="fa-solid fa-star"></i> ${Number(driver.rating || 0).toFixed(1)} · ${escapeHtml(driver.vehicle?.brand || driver.vehicle?.type || 'Motorizada')} ${escapeHtml(driver.vehicle?.model || '')}</small><em>${Number(driver.distance_km || 0).toFixed(1)} km da recolha${driver.vehicle?.plate ? ` · ${escapeHtml(driver.vehicle.plate)}` : ''}</em></div>
        <button type="button" class="${String(driver.id || '') === radarState.selectedDriverId ? 'is-confirm' : ''}" aria-pressed="${String(driver.id || '') === radarState.selectedDriverId}" data-select-radar-driver="${escapeHtml(driver.id)}">${String(driver.id || '') === radarState.selectedDriverId ? 'Confirmar' : 'Escolher'}</button>
      </article>`).join('');
  }

  async function refreshDriverRadar() {
    const order = radarState.order;
    const orderId = order?._id || order?.id;
    if (!orderId) return null;
    updateRadarModal({ progress: 35, status: 'A consultar motoristas online e livres…' });
    try {
      const data = await requestRadarAssignment(orderId, order.public_access_token || order.access_token || '');
      radarState.candidates = Array.isArray(data.candidates) ? data.candidates : [];
      if (!radarState.candidates.some((candidate) => String(candidate.id || '') === radarState.selectedDriverId)) {
        radarState.selectedDriverId = '';
      }
      renderRadarCandidates(radarState.candidates, data);
      renderRadarMap(order, radarState.candidates, data);
      const searchRadiusKm = Number(data.search_radius_km || 5);
      updateRadarModal({
        progress: 100,
        message: radarState.candidates.length
          ? `${radarState.candidates.length} motorista(s) disponível(is) até ${searchRadiusKm} km. Toque em Escolher para enviar a oferta.`
          : `Não há motoristas livres dentro de ${searchRadiusKm} km neste momento.`,
        status: `${Number(data.candidates_checked || 0)} motorista(s) online verificado(s)${data.radius_expanded ? ' · raio expandido automaticamente' : ''} · sem atribuição automática`
      });
      return data;
    } catch (error) {
      renderRadarCandidates([], {});
      updateRadarModal({ progress: 100, status: error.message });
      toast(error.message, 'error');
      return null;
    }
  }

  async function runDriverRadar(order) {
    const orderId = order?._id || order?.id;
    if (!orderId) return null;
    openRadarModal(order);
    return refreshDriverRadar();
  }

  window.TragoClientRunDriverRadar = runDriverRadar;

  async function submitRating({ type, id, restaurantId, rating }) {
    const parsedRating = Math.max(1, Math.min(5, Number(rating) || 0));
    if (!parsedRating) return;
    const session = readSession();
    if (!session?.token) {
      toast('Entre na sua conta para avaliar uma compra concluída.', 'error');
      return;
    }
    const history = window.TragoClientOrders?.all?.() || [];
    const targetRestaurantId = String(restaurantId || id || '');
    const eligibleOrder = history.find((order) => {
      if (order.status !== 'concluido' || String(order.restaurant_id || '') !== targetRestaurantId) return false;
      if (type !== 'food') return true;
      return (Array.isArray(order.food_items) ? order.food_items : []).some((item) => String(item?.id || '') === String(id));
    });
    if (!eligibleOrder?.id) {
      toast('Só pode avaliar depois de concluir uma compra deste estabelecimento.', 'error');
      return;
    }
    try {
      const payload = {
        order_id: eligibleOrder.id,
        restaurant_id: targetRestaurantId,
        menu_item_id: type === 'food' ? id : '',
        rating: parsedRating
      };
      const response = await fetch(`${API_URL}/api/public/ratings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.token}`
        },
        body: JSON.stringify(payload)
      });
      const data = await readJsonResponse(response);
      if (!response.ok) throw new Error(data.message || 'Não foi possível guardar a avaliação.');
      const key = type === 'food' ? `food:${id}` : `restaurant:${id}`;
      saveLocalRating(key, parsedRating);
      renderAllFoodViews();
      toast('Avaliação guardada.');
      await loadRestaurants(true);
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  function bindEvents() {
    $$('.portal-tab, .mobile-bottom-nav button[data-panel]').forEach((btn) => btn.addEventListener('click', () => setPanel(btn.dataset.panel, { root: true, source: 'root' })));
    $$('.map-mode').forEach((btn) => btn.addEventListener('click', () => setMapMode(btn.dataset.mode)));
    $('#btn-client-logout')?.addEventListener('click', logout);
    $('#btn-use-location-delivery')?.addEventListener('click', () => useMyLocation(singleMapTarget() === 'stop' ? 'stop' : 'delivery'));
    $('#btn-use-location-pickup')?.addEventListener('click', () => useMyLocation('pickup'));
    $('#btn-map-back')?.addEventListener('click', () => closeMapContext());
    $('#btn-confirm-map')?.addEventListener('click', () => closeMapContext({ confirm: true }));
    $('#btn-clear-map-point')?.addEventListener('click', clearActiveDraftPoint);
    $('#client-delivery-form')?.addEventListener('submit', handleDeliverySubmit);
    $('#food-checkout-form')?.addEventListener('submit', checkoutFood);
    $('#food-search')?.addEventListener('input', renderRestaurants);
    $('#bottle-store-search')?.addEventListener('input', renderBottleStore);
    $('#partners-search')?.addEventListener('input', renderPartners);
    $('#cargo-partner-select')?.addEventListener('change', (event) => {
      if (!event.target.value) {
        state.selectedPartnerId = null;
        state.cargoSourceType = '';
        setInputValue('#selected-partner-id', '');
        setInputValue('#selected-partner-entity-type', '');
        renderCargoSourceSelection();
        return;
      }
      selectCargoPartner(event.target.value);
    });
    $('#partner-application-form')?.addEventListener('submit', submitPartnerApplication);
    $('#btn-partner-application-location')?.addEventListener('click', capturePartnerApplicationLocation);
    $('#btn-open-partner-application')?.addEventListener('click', openPartnerApplicationSheet);
    $('#order-price')?.addEventListener('input', () => updateDeliveryQuoteLabels(state.deliveryQuote));
    $('#btn-refresh-food')?.addEventListener('click', () => loadRestaurants(true));
    $('#btn-refresh-bottle-store')?.addEventListener('click', () => loadRestaurants(true));
    $('#btn-refresh-partners')?.addEventListener('click', () => loadPartners(true));
    $('#btn-refresh-home')?.addEventListener('click', () => loadRestaurants(true));
    $('#btn-refresh-history')?.addEventListener('click', () => refreshHistoryStatuses(false));
    $('[data-order-load-more]')?.addEventListener('click', loadMoreOrderHistory);
    $('#btn-refresh-radar')?.addEventListener('click', refreshDriverRadar);
    $('[data-client-notifications-read]')?.addEventListener('click', markClientNotificationsRead);
    const notificationList = $('#client-notification-list');
    notificationList?.addEventListener('pointerdown', beginNotificationSwipe);
    notificationList?.addEventListener('pointermove', moveNotificationSwipe, { passive: false });
    notificationList?.addEventListener('pointerup', finishNotificationSwipe);
    notificationList?.addEventListener('pointercancel', cancelNotificationSwipe);
    notificationList?.addEventListener('lostpointercapture', cancelNotificationSwipe);
    window.addEventListener('online', () => {
      processNotificationQueue();
      if (state.activePanel === 'notifications') renderClientNotifications({ force: true });
      else fetchClientNotificationSummary();
      if (state.activePanel === 'history') refreshHistoryStatuses(true);
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      processNotificationQueue();
      if (state.activePanel === 'notifications') renderClientNotifications({ force: true });
      else fetchClientNotificationSummary();
      if (state.activePanel === 'history' && Date.now() - orderFetchedAt > 15000) refreshHistoryStatuses(true);
    });
    $('[data-notification-load-more]')?.addEventListener('click', loadMoreClientNotifications);
    $('[data-notifications-retry]')?.addEventListener('click', () => renderClientNotifications({ force: true }));
    $('#btn-clear-food-filter')?.addEventListener('click', () => {
      state.selectedCategory = 'all';
      state.directoryQuickFilters = [];
      state.directoryFavoritesOnly = false;
      state.directoryMinRating = 0;
      state.directorySort = 'recommended';
      const search = $('#food-search');
      if (search) search.value = '';
      $('[data-directory-rating]') && ($('[data-directory-rating]').value = '0');
      $('[data-directory-sort]') && ($('[data-directory-sort]').value = 'recommended');
      $$('[data-directory-filter]').forEach((input) => { input.checked = false; });
      renderAllFoodViews();
    });
    $('#btn-clear-bottle-store-search')?.addEventListener('click', () => {
      const search = $('#bottle-store-search');
      if (search) search.value = '';
      state.bottleCategory = 'all';
      renderBottleStore();
    });
    $('#btn-clear-partners-search')?.addEventListener('click', () => {
      if ($('#partners-search')) $('#partners-search').value = '';
      state.partnerType = 'all';
      renderPartners();
    });
    $('#btn-clear-map-place-search')?.addEventListener('click', () => {
      const input = $('#map-place-search');
      if (input) {
        input.value = '';
        input.focus();
      }
      hideAddressSuggestions('map-place-search');
    });
    $('#btn-open-cart-mobile')?.addEventListener('click', openCartModal);
    $('#btn-open-cart-desktop')?.addEventListener('click', openCartModal);
    $('#btn-clear-cart')?.addEventListener('click', clearCart);
    $('#btn-calc-cart-distance')?.addEventListener('click', () => calculateCartDistance(true));
    $('.v20-coupon-input button')?.addEventListener('click', async () => {
      try { await applyCartCoupon(); } catch (error) {
        setCartCouponFeedback(error.message || 'Não foi possível verificar o cupão.', 'error');
        toast(error.message, 'error');
      }
    });
    $('#cart-coupon')?.addEventListener('keydown', async (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      try { await applyCartCoupon(); } catch (error) {
        setCartCouponFeedback(error.message || 'Não foi possível verificar o cupão.', 'error');
        toast(error.message, 'error');
      }
    });
    document.addEventListener('click', (event) => {
      if (event.target.closest('[data-close-radar]')) {
        closeRadarModal();
        return;
      }
      const radarDriver = event.target.closest('[data-select-radar-driver]');
      if (radarDriver) {
        const order = radarState.order;
        const orderId = order?._id || order?.id;
        if (!orderId) return;
        const driverId = String(radarDriver.dataset.selectRadarDriver || '');
        if (radarState.selectedDriverId !== driverId) {
          selectRadarCandidate(driverId);
          return;
        }
        radarDriver.disabled = true;
        radarDriver.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        requestDriverOffer(orderId, driverId, order.public_access_token || order.access_token || '')
          .then((data) => {
            if (data.order) upsertOrderHistory(data.order);
            updateRadarModal({ progress: 100, message: `Oferta enviada a ${data.driver?.name || 'este motorista'}.`, status: 'A aguardar aceitação durante 90 segundos. O pedido ainda não foi atribuído.' });
            toast('O motorista recebeu o resumo e pode aceitar ou recusar.');
            closeRadarModal(1700);
          })
          .catch((error) => {
            radarDriver.disabled = false;
            radarDriver.textContent = 'Escolher';
            toast(error.message, 'error');
            refreshDriverRadar();
          });
        return;
      }
      if (event.target.closest('[data-reopen-driver-radar]')) {
        const order = radarState.order || window.TragoClientOrders?.active?.()?.[0];
        if (order) runDriverRadar(order);
        else toast('Não existe um pedido activo para procurar motorista.', 'error');
        return;
      }
      const favoritesOnly = event.target.closest('[data-toggle-favorites]');
      if (favoritesOnly) {
        state.directoryFavoritesOnly = !state.directoryFavoritesOnly;
        renderAllFoodViews();
        return;
      }
      const closeBtn = event.target.closest('[data-close-cart]');
      if (closeBtn) closeCartModal();
      const notificationFilterButton = event.target.closest('[data-notification-filter]');
      if (notificationFilterButton) {
        setNotificationFilter(notificationFilterButton.dataset.notificationFilter);
        return;
      }
      const notificationMenu = event.target.closest('[data-notification-menu]');
      if (notificationMenu) {
        toggleNotificationMenu(notificationMenu.dataset.notificationMenu, notificationMenu);
        return;
      }
      const notificationRead = event.target.closest('[data-notification-read]');
      if (notificationRead) {
        markClientNotificationRead(notificationRead.dataset.notificationRead);
        return;
      }
      const notificationDelete = event.target.closest('[data-notification-delete]');
      if (notificationDelete) {
        deleteClientNotification(notificationDelete.dataset.notificationDelete);
        return;
      }
      if (Date.now() < notificationClickBlockedUntil && event.target.closest('.v20-notification-row')) {
        event.preventDefault();
        return;
      }
      const historyOrder = event.target.closest('[data-open-client-order]');
      if (historyOrder) {
        const notificationRow = historyOrder.closest('.v20-notification-row');
        if (notificationRow?.dataset.notificationId) markClientNotificationRead(notificationRow.dataset.notificationId, { silent: true });
        window.TragoClientOpenOrder?.(historyOrder.dataset.openClientOrder);
        return;
      }
      const pointMapButton = event.target.closest('[data-map-target]');
      if (pointMapButton) {
        openPointMap(pointMapButton.dataset.mapTarget);
        return;
      }
      const mapContextBtn = event.target.closest('[data-map-context]');
      if (mapContextBtn) {
        openMapContext(mapContextBtn.dataset.mapContext, mapContextBtn.hasAttribute('data-map-auto-location'));
        return;
      }
      const jumpBtn = event.target.closest('[data-jump-panel]');
      if (jumpBtn) {
        setPanel(jumpBtn.dataset.jumpPanel);
        return;
      }
      const categoryBtn = event.target.closest('[data-category-filter]');
      if (categoryBtn) {
        state.selectedCategory = categoryBtn.dataset.categoryFilter || 'all';
        renderAllFoodViews();
      }
      const bottleCategory = event.target.closest('[data-bottle-category]');
      if (bottleCategory) {
        state.bottleCategory = bottleCategory.dataset.bottleCategory || 'all';
        renderBottleStore();
        return;
      }
      const partnerType = event.target.closest('[data-partner-type]');
      if (partnerType) {
        state.partnerType = partnerType.dataset.partnerType || 'all';
        renderPartners();
        return;
      }
      if (event.target.closest('#btn-open-partner-application-empty')) {
        openPartnerApplicationSheet();
        return;
      }
      if (event.target.closest('#btn-retry-partners')) {
        state.partnersLoaded = false;
        loadPartners(true);
        return;
      }
      const focusPartner = event.target.closest('[data-focus-partner]');
      if (focusPartner) {
        const partner = findPartnerByKey(focusPartner.dataset.focusPartner);
        const coords = partnerCoordinates(partner);
        if (coords && state.partnersMap) {
          selectPartnerOnMap(partner);
          state.partnersCamera?.setView(coords, 16, { force: true, mode: 'free' });
          $('#partners-map')?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
        }
        return;
      }
      const revealPartner = event.target.closest('[data-reveal-partner-card]');
      if (revealPartner) {
        document.querySelector(`[data-partner-card="${CSS.escape(revealPartner.dataset.revealPartnerCard)}"]`)
          ?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
        return;
      }
      const useCargoPartner = event.target.closest('[data-use-cargo-partner]');
      if (useCargoPartner) {
        if (selectCargoPartner(useCargoPartner.dataset.useCargoPartner, { openDelivery: true })) toast('Parceiro definido como ponto de recolha.');
        return;
      }
      const addBtn = event.target.closest('[data-add-food]');
      if (addBtn) {
        addToCart(addBtn.dataset.addFood);
        return;
      }
      const configured = event.target.closest('[data-add-configured-food]');
      if (configured) {
        const found = findFoodItem(configured.dataset.addConfiguredFood);
        if (!found) return;
        const selected = [];
        const groups = found.item.options || [];
        let valid = true;
        groups.forEach((group, groupIndex) => {
          const checked = $$(`[name="dish-option-${groupIndex}"]:checked`);
          if (group.required && !checked.length) valid = false;
          checked.forEach((input) => {
            const value = group.values?.[Number(input.value)];
            if (value) selected.push({ group: group.name, name: value.name, price: Number(value.price || 0) });
          });
        });
        if (!valid) return toast('Seleccione todas as opções obrigatórias.', 'error');
        addToCart(configured.dataset.addConfiguredFood, selected);
        return;
      }
      const incBtn = event.target.closest('[data-cart-inc]');
      if (incBtn) updateCart(incBtn.dataset.cartInc, 1);
      const decBtn = event.target.closest('[data-cart-dec]');
      if (decBtn) updateCart(decBtn.dataset.cartDec, -1);
      const removeBtn = event.target.closest('[data-cart-remove]');
      if (removeBtn) removeCartItem(removeBtn.dataset.cartRemove);
      const rateFoodBtn = event.target.closest('[data-rate-food]');
      if (rateFoodBtn) submitRating({ type: 'food', id: rateFoodBtn.dataset.rateFood, restaurantId: rateFoodBtn.dataset.restaurantId, rating: rateFoodBtn.dataset.rating });
      const rateRestaurantBtn = event.target.closest('[data-rate-restaurant]');
      if (rateRestaurantBtn) {
        submitRating({ type: 'restaurant', id: rateRestaurantBtn.dataset.rateRestaurant, restaurantId: rateRestaurantBtn.dataset.restaurantId, rating: rateRestaurantBtn.dataset.rating });
        return;
      }
      const restaurantCard = event.target.closest('[data-open-restaurant]');
      if (restaurantCard && !event.target.closest('button, a, input, select, textarea')) {
        openRestaurantProfile(restaurantCard.dataset.openRestaurant);
        return;
      }
      const bottleCard = event.target.closest('[data-open-bottle]');
      if (bottleCard && !event.target.closest('button, a, input, select, textarea')) {
        openBottleProfile(bottleCard.dataset.openBottle);
        return;
      }
      const dishCard = event.target.closest('[data-open-dish]');
      if (dishCard && !event.target.closest('button, a, input, select, textarea')) {
        openDishDetail(dishCard.dataset.openDish);
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeCartModal();
      if ((event.key === 'Enter' || event.key === ' ') && event.target?.matches?.('[data-open-dish]')) {
        event.preventDefault();
        openDishDetail(event.target.dataset.openDish);
      }
      if ((event.key === 'Enter' || event.key === ' ') && event.target?.matches?.('[data-open-restaurant]')) {
        event.preventDefault();
        event.target.click();
      }
      if ((event.key === 'Enter' || event.key === ' ') && event.target?.matches?.('[data-open-bottle]')) {
        event.preventDefault();
        openBottleProfile(event.target.dataset.openBottle);
      }
      if ((event.key === 'Enter' || event.key === ' ') && event.target?.matches?.('[data-open-client-order]')) {
        event.preventDefault();
        window.TragoClientOpenOrder?.(event.target.dataset.openClientOrder);
      }
    });
    initAddressAutocomplete();
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (!initSessionUI()) return;
    state.catalogLocation = readCatalogLocation();
    document.addEventListener('trago:current-location-updated', (event) => {
      syncCatalogLocation(event.detail || null);
    });
    restoreCart();
    bindEvents();
    initMap();
    setMapMode('pickup');
    initPanelNavigation();
    if (state.activePanel === 'map' && !state.mapDraft) {
      syncMapContext('delivery-route');
      beginMapDraft();
      requestAnimationFrame(() => {
        state.map?.invalidateSize?.();
        renderMapDraft({ fitInitial: true });
      });
    }
    renderCart();
    renderHistory();
    refreshHistoryStatuses(true);
    loadRestaurants();
    loadPartners();
    hydrateClientNotifications();
    paintClientNotifications();
    fetchClientNotificationSummary();
    processNotificationQueue();
    startNotificationPolling();
    setInterval(() => {
      if (document.visibilityState === 'visible') loadPartners(true);
    }, 60000);
  });
})();
