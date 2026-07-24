/* Trago Delivery · Portal do Cliente */
(() => {
  const SESSION_KEY = 'tragoClientSession';
  const ORDER_HISTORY_KEY = 'tragoClientOrderHistory';
  const LOCAL_RATINGS_KEY = 'tragoClientFoodRatings';
  const FAVORITES_KEY = 'tragoV20Favorites';
  const CART_KEY = 'tragoClientFoodCart';
  const currency = new Intl.NumberFormat('pt-MZ', { style: 'currency', currency: 'MZN' });
  const PRICING_POLICY = Object.freeze({ baseDistanceKm: 11.6, baseFeeMzn: 200, extraKmFeeMzn: 15 });

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
    return L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      subdomains: 'abcd',
      maxZoom: 20,
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

  function writeHistory(order) {
    let history = [];
    try { history = JSON.parse(localStorage.getItem(clientStorageKey(ORDER_HISTORY_KEY)) || '[]'); } catch { history = []; }
    const id = order?._id || order?.id || `local_${Date.now()}`;
    const previous = history.find((item) => String(item.id) === String(id)) || {};
    const next = {
      id,
      code: order?.verification_code || '',
      service_type: order?.service_type || '',
      price: Number(order?.price || 0),
      delivery_fee: Number(order?.delivery_fee || 0),
      createdAt: order?.createdAt || new Date().toISOString(),
      status: order?.status || 'pendente',
      assigned_to_driver: order?.assigned_to_driver || null,
      driver_offer_status: order?.driver_offer_status || null,
      driver_offer_expires_at: order?.driver_offer_expires_at || null,
      access_token: order?.public_access_token || order?.access_token || previous.access_token || '',
      pickup_address_coords: order?.pickup_address_coords || previous.pickup_address_coords || null,
      address_coords: order?.address_coords || previous.address_coords || null,
      pickup_address_text: order?.pickup_address_text || previous.pickup_address_text || '',
      address_text: order?.address_text || previous.address_text || '',
      restaurant_status: order?.restaurant_status || order?.restaurantStatus || previous.restaurant_status || null,
      last_update: new Date().toISOString()
    };
    history = history.filter((item) => String(item.id) !== String(id));
    history.unshift(next);
    localStorage.setItem(clientStorageKey(ORDER_HISTORY_KEY), JSON.stringify(history.slice(0, 30)));
    renderHistory();
  }

  window.TragoClientFilterOrders = (filter) => {
    state.orderHistoryFilter = ['active', 'previous', 'cancelled'].includes(filter) ? filter : 'active';
    renderHistory();
  };

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

  function renderClientNotifications() {
    const list = $('#client-notification-list');
    if (!list) return;
    let history = [];
    try { history = JSON.parse(localStorage.getItem(clientStorageKey(ORDER_HISTORY_KEY)) || '[]'); } catch { history = []; }
    const readAt = Number(localStorage.getItem('tragoClientNotificationsReadAt') || 0);
    const statusLabels = {
      pendente: ['Pedido recebido', 'A operação procura um motorista disponível.'],
      atribuido: ['Motorista atribuído', 'Já pode abrir o acompanhamento e conversar com a operação.'],
      recolha_em_progresso: ['Motorista a caminho da recolha', 'A recolha do pedido foi iniciada.'],
      recolha_concluida: ['Pedido recolhido', 'O pedido saiu do ponto de recolha.'],
      entrega_em_progresso: ['Pedido a caminho', 'O motorista segue para o destino de entrega.'],
      concluido: ['Pedido entregue', 'A entrega foi concluída.'],
      cancelado: ['Pedido cancelado', 'A operação deste pedido foi encerrada.']
    };
    const restaurantLabels = { accepted: 'Restaurante confirmou o pedido.', preparing: 'O restaurante está a preparar o pedido.', ready: 'Pedido pronto para levantamento.', rejected: 'O restaurante não aceitou o pedido.' };
    const rows = history
      .map((item) => ({ ...item, eventTime: new Date(item.last_update || item.createdAt || 0).getTime() || 0 }))
      .sort((a, b) => b.eventTime - a.eventTime);
    if (!rows.length) {
      list.innerHTML = '<div class="empty-state">As actualizações reais dos seus pedidos aparecerão aqui.</div>';
    } else {
      list.innerHTML = rows.map((item) => {
        const label = statusLabels[item.status] || ['Actualização do pedido', `Estado: ${item.status || 'pendente'}.`];
        const restaurant = restaurantLabels[item.restaurant_status];
        const unread = item.eventTime > readAt;
        return `<article class="${unread ? 'unread' : ''}" data-open-client-order="${escapeHtml(item.id)}" role="button" tabindex="0"><i class="fa-solid ${item.status === 'concluido' ? 'fa-circle-check' : item.status === 'cancelado' ? 'fa-circle-xmark' : 'fa-motorcycle'}"></i><span><strong>${escapeHtml(label[0])}</strong><p>Pedido #${escapeHtml(String(item.id).slice(-6).toUpperCase())}. ${escapeHtml(restaurant || label[1])}</p><small>${item.eventTime ? new Date(item.eventTime).toLocaleString('pt-MZ') : 'Agora'}</small></span></article>`;
      }).join('');
    }
    const unreadCount = rows.filter((item) => item.eventTime > readAt).length;
    setNotificationUnreadCount(unreadCount);
    const session = readSession();
    if (session?.token) {
      fetch(`${API_URL}/api/client/notifications`, { headers: { Authorization: `Bearer ${session.token}` } })
        .then(async (response) => ({ response, data: await readJsonResponse(response) }))
        .then(({ response, data }) => {
          if (!response.ok) throw new Error(data.message || 'Não foi possível carregar as notificações.');
          const notifications = Array.isArray(data.notifications) ? data.notifications : [];
          list.innerHTML = notifications.length
            ? notifications.map((item) => `<article class="${item.read_at ? '' : 'unread'}" ${item.order_id ? `data-open-client-order="${escapeHtml(item.order_id)}" role="button" tabindex="0"` : ''}><i class="fa-solid ${item.type === 'success' ? 'fa-circle-check' : item.type === 'warning' ? 'fa-triangle-exclamation' : item.type === 'restaurant' ? 'fa-store' : 'fa-motorcycle'}"></i><span><strong>${escapeHtml(item.title || 'Actualização')}</strong><p>${escapeHtml(item.message || '')}</p><small>${new Date(item.created_at || Date.now()).toLocaleString('pt-MZ')}</small></span></article>`).join('')
            : '<div class="empty-state">Ainda não existem notificações na sua conta.</div>';
          const realUnread = notifications.filter((item) => !item.read_at).length;
          setNotificationUnreadCount(realUnread);
        }).catch(() => {});
    }
  }

  async function markClientNotificationsRead() {
    localStorage.setItem('tragoClientNotificationsReadAt', String(Date.now()));
    const session = readSession();
    if (session?.token) {
      try {
        await fetch(`${API_URL}/api/client/notifications/read-all`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${session.token}` }
        });
      } catch (_error) { /* mantém o estado local quando offline */ }
    }
    renderClientNotifications();
    toast('Notificações marcadas como lidas.');
  }

  window.TragoClientRenderNotifications = renderClientNotifications;

  function renderHistory() {
    const list = $('#client-history-list');
    if (!list) return;
    let history = [];
    try { history = JSON.parse(localStorage.getItem(clientStorageKey(ORDER_HISTORY_KEY)) || '[]'); } catch { history = []; }
    renderClientNotifications();
    window.TragoClientSyncOrderShell?.();
    const activeCount = history.filter((item) => !['concluido', 'cancelado'].includes(item.status)).length;
    $$('[data-client-active-count]').forEach((badge) => {
      badge.textContent = String(activeCount);
      badge.hidden = activeCount === 0;
    });
    history = history.filter((item) => {
      if (state.orderHistoryFilter === 'previous') return item.status === 'concluido';
      if (state.orderHistoryFilter === 'cancelled') return item.status === 'cancelado';
      return !['concluido', 'cancelado'].includes(item.status);
    });
    if (!history.length) {
      const label = state.orderHistoryFilter === 'previous'
        ? 'Ainda não existem pedidos anteriores.'
        : state.orderHistoryFilter === 'cancelled'
          ? 'Ainda não existem pedidos cancelados.'
          : 'Não existem pedidos activos neste momento.';
      list.innerHTML = `<div class="empty-state">${label}</div>`;
      return;
    }
    list.innerHTML = history.map((item) => `
      <div class="order-card" data-open-client-order="${escapeHtml(item.id)}" role="button" tabindex="0" aria-label="Abrir pedido #${escapeHtml(String(item.id).slice(-6).toUpperCase())}">
        <div class="order-card-head">
          <strong>#${escapeHtml(String(item.id).slice(-6).toUpperCase())}</strong>
          <span class="status-pill">${escapeHtml(item.status || 'pendente')}</span>
        </div>
        <div class="order-meta">${escapeHtml(item.service_type || 'Serviço')} · ${money(item.price)} · ${new Date(item.createdAt).toLocaleString('pt-MZ')}</div>
        ${item.delivery_fee ? `<div class="order-meta"><strong>Taxa de entrega:</strong> ${money(item.delivery_fee)}</div>` : ''}
        ${item.code ? `<div class="order-meta"><strong>Código para entrega:</strong> ${escapeHtml(item.code)}</div>` : ''}
      </div>
    `).join('');
  }

  async function refreshHistoryStatuses(silent = false) {
    let history = [];
    try { history = JSON.parse(localStorage.getItem(clientStorageKey(ORDER_HISTORY_KEY)) || '[]'); } catch { history = []; }
    if (state.session?.token) {
      try {
        const response = await fetch(`${API_URL}/api/client/orders`, { headers: { Authorization: `Bearer ${state.session.token}` } });
        const data = await readJsonResponse(response);
        if (response.ok) {
          const previousById = new Map(history.map((item) => [String(item.id), item]));
          history = (data.orders || []).map((order) => {
            const id = String(order.id || order._id || '');
            const previous = previousById.get(id) || {};
            return {
              ...previous,
              id,
              code: order.verification_code || previous.code || '',
              service_type: order.service_type || '',
              price: Number(order.price || 0),
              delivery_fee: Number(order.delivery_fee || 0),
              createdAt: order.createdAt || order.created_at || new Date().toISOString(),
              status: order.status || 'pendente',
              assigned_to_driver: order.assigned_to_driver || null,
              driver_offer_status: order.driver_offer_status || null,
              driver_offer_expires_at: order.driver_offer_expires_at || null,
              pickup_address_coords: order.pickup_address_coords || previous.pickup_address_coords || null,
              address_coords: order.address_coords || previous.address_coords || null,
              restaurant_status: order.restaurant_status || null,
              last_update: order.updatedAt || order.updated_at || new Date().toISOString()
            };
          });
          localStorage.setItem(clientStorageKey(ORDER_HISTORY_KEY), JSON.stringify(history));
        }
      } catch (_error) { /* mantém a cache local quando estiver offline */ }
    }
    const refreshable = history.filter((item) => (item.access_token || state.session?.token) && /^[a-f0-9]{24}$/i.test(String(item.id || '')));
    if (!refreshable.length) { renderHistory(); return; }
    const updated = await Promise.all(history.map(async (item) => {
      if ((!item.access_token && !state.session?.token) || !/^[a-f0-9]{24}$/i.test(String(item.id || ''))) return item;
      try {
        const response = await fetch(`${API_URL}/api/public/orders/${encodeURIComponent(item.id)}/context`, {
          headers: {
            'X-Order-Access-Token': item.access_token || '',
            ...(state.session?.token ? { Authorization: `Bearer ${state.session.token}` } : {})
          }
        });
        const data = await readJsonResponse(response);
        if (!response.ok) return item;
        if (data.driver) window.TragoClientSetAssignedDriver?.(data.driver);
        const nextStatus = data.order?.status || item.status;
        const nextRestaurantStatus = data.order?.restaurant_status || data.order?.restaurantStatus || item.restaurant_status;
        const nextOfferStatus = data.order?.driver_offer_status || null;
        const changed = nextStatus !== item.status || nextRestaurantStatus !== item.restaurant_status || nextOfferStatus !== item.driver_offer_status;
        return {
          ...item,
          status: nextStatus,
          assigned_to_driver: data.order?.assigned_to_driver || item.assigned_to_driver,
          driver_offer_status: nextOfferStatus,
          driver_offer_expires_at: data.order?.driver_offer_expires_at || null,
          pickup_address_coords: data.order?.pickup_address_coords || item.pickup_address_coords,
          address_coords: data.order?.address_coords || item.address_coords,
          restaurant_status: nextRestaurantStatus,
          last_update: changed ? new Date().toISOString() : item.last_update
        };
      } catch (_error) { return item; }
    }));
    localStorage.setItem(clientStorageKey(ORDER_HISTORY_KEY), JSON.stringify(updated));
    renderHistory();
    if (!silent) toast('Estado dos pedidos actualizado.');
  }

  function initSessionUI() {
    state.session = readSession();
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
    return true;
  }

  window.TragoClientRefreshSession = initSessionUI;

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
    if (panel === 'bottle-profile' && state.selectedRestaurantId) renderBottleProfile(state.selectedRestaurantId);
    if (panel === 'restaurant-profile' && state.selectedRestaurantId) renderRestaurantProfile(state.selectedRestaurantId);
    if (panel === 'wishlist') renderWishlist();
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
      transientPages: ['dish-detail'],
      getCurrent: () => state.activePanel,
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
    return [state.mapDraft.points.pickup, state.mapDraft.points.delivery].filter(isValidCoord);
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
    if (!a || !b) return [];
    const key = [a.lat, a.lng, b.lat, b.lng].map((value) => value.toFixed(5)).join(':');
    if (state.routeGeometryCache.has(key)) return state.routeGeometryCache.get(key);
    state.routeAbortController?.abort?.();
    const controller = new AbortController();
    state.routeAbortController = controller;
    const pending = (async () => {
      try {
        const response = await fetch(`${API_URL}/api/public/geo/route`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({ origin: a, destination: b })
        });
        const data = await readJsonResponse(response);
        const coordinates = data?.geometry?.coordinates;
        if (!response.ok || !Array.isArray(coordinates) || coordinates.length < 2) throw new Error('route');
        return coordinates.map((point) => [Number(point[1]), Number(point[0])])
          .filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]));
      } catch (error) {
        if (error?.name === 'AbortError') return [];
        return [[a.lat, a.lng], [b.lat, b.lng]];
      }
    })();
    state.routeGeometryCache.set(key, pending);
    if (state.routeGeometryCache.size > 50) state.routeGeometryCache.delete(state.routeGeometryCache.keys().next().value);
    return pending;
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
      if (window.TragoMapUI?.drawRoute) window.TragoMapUI.drawRoute(state.mapDraftRouteLayer, [origin, destination], {
        color: '#69be35', weight: 5, dashArray: '8 9', className: 'is-estimated-route'
      });
      else L.polyline([origin, destination], { color: '#69be35', weight: 5, dashArray: '8 9' }).addTo(state.mapDraftRouteLayer);
      const geometry = await fetchClientRouteGeometry(origin, destination);
      if (renderId !== state.routeRenderId || state.mapDraft !== draft || !geometry.length) return;
      state.mapDraftRouteLayer.clearLayers();
      if (window.TragoMapUI?.drawRoute) window.TragoMapUI.drawRoute(state.mapDraftRouteLayer, geometry, {
        color: '#69be35', weight: 6, className: geometry.length === 2 ? 'is-estimated-route' : 'is-road-route'
      });
      else L.polyline(geometry, { color: '#69be35', weight: 6 }).addTo(state.mapDraftRouteLayer);
      const quote = await quotePublicRoute(origin, destination);
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
      const points = await fetchClientRouteGeometry(state.pickupCoords, state.deliveryCoords);
      if (!points.length) return;
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
    if (options.recenter !== false) {
      if (state.mapCamera?.setView) state.mapCamera.setView(cleanCoords, Math.max(state.map.getZoom?.() || 14, 14), { force: true, mode: 'free' });
      else state.map?.setView(cleanCoords, Math.max(state.map.getZoom?.() || 14, 14));
    }
    drawRouteLine();
    if (options.refresh !== false) {
      if (kind === 'food-delivery') calculateCartDistance(false);
      else if (kind !== 'stop') refreshDeliveryQuote();
    }
  }

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

  function calculateDeliveryFee(distanceKm) {
    const distance = Math.max(0, Number(distanceKm) || 0);
    if (distance <= PRICING_POLICY.baseDistanceKm) return PRICING_POLICY.baseFeeMzn;
    const extraKm = Math.ceil(distance - PRICING_POLICY.baseDistanceKm);
    return PRICING_POLICY.baseFeeMzn + (extraKm * PRICING_POLICY.extraKmFeeMzn);
  }

  async function quotePublicRoute(origin, destination) {
    if (!isValidCoord(origin) || !isValidCoord(destination)) throw new Error('Coordenadas de recolha e entrega são obrigatórias.');
    try {
      const response = await fetch(`${API_URL}/api/public/geo/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ origin, destination })
      });
      const data = await readJsonResponse(response);
      if (!response.ok) throw new Error(data.message || 'Falha ao calcular rota.');
      return data;
    } catch (error) {
      const distanceKm = haversineKm(origin, destination);
      return {
        distance_km: Number(distanceKm.toFixed(2)),
        duration_min: Math.max(1, Math.round((distanceKm / 35) * 60)),
        delivery_fee: calculateDeliveryFee(distanceKm),
        source: 'frontend_haversine'
      };
    }
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
      state.deliveryQuote = await quotePublicRoute(state.pickupCoords, state.deliveryCoords);
      updateDeliveryQuoteLabels(state.deliveryQuote);
      return state.deliveryQuote;
    } catch (_error) {
      state.deliveryQuote = null;
      updateDeliveryQuoteLabels(null);
      return null;
    }
  }

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
      writeHistory(order);
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
      state.restaurants = Array.isArray(data.restaurants) ? data.restaurants : [];
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
      : '<div class="v20-empty"><i class="fa-solid fa-store-slash"></i><h2>Nenhum parceiro neste filtro</h2><p>Altere a pesquisa ou envie uma candidatura para validação.</p><button type="button" class="v20-primary" id="btn-open-partner-application-empty"><i class="fa-solid fa-plus"></i> Adicionar parceiro</button></div>';
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
        headers: { 'Content-Type': 'application/json' },
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
        <div class="v20-restaurant-facts">
          <span><i class="fa-solid fa-star"></i><b>${Number(restaurant.average_rating || 0).toFixed(1)}</b><small>${Number(restaurant.rating_count || 0)} avaliações</small></span>
          <span><i class="fa-regular fa-clock"></i><b>${escapeHtml(restaurant.delivery_time || 'A confirmar')}</b><small>Entrega</small></span>
          <span><i class="fa-solid fa-wine-bottle"></i><b>${drinks.length}</b><small>Bebidas</small></span>
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
    setPanel('bottle-profile');
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
        <div class="v20-restaurant-facts">
          <span><i class="fa-solid fa-star"></i><b>${Number(restaurant.average_rating || 0).toFixed(1)}</b><small>${Number(restaurant.rating_count || 0)} avaliações</small></span>
          <span><i class="fa-regular fa-clock"></i><b>${prep ? `${prep}–${prep + 15} min` : 'A confirmar'}</b><small>Preparação</small></span>
          <span><i class="fa-solid fa-motorcycle"></i><b>${Number(restaurant.delivery_fee || 0) ? money(restaurant.delivery_fee) : 'Grátis'}</b><small>Entrega</small></span>
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
    setPanel('restaurant-profile');
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
    setPanel('dish-detail');
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
    state.appliedCoupon = null;
    renderCart();
    toast(`${item.name} adicionado ao carrinho.`);
  }

  function updateCart(itemId, delta) {
    const entry = state.cart.find((cartItem) => String(cartItem.item.id) === String(itemId));
    if (!entry) return;
    entry.qty += delta;
    if (entry.qty <= 0) state.cart = state.cart.filter((cartItem) => String(cartItem.item.id) !== String(itemId));
    state.foodQuote = null;
    state.appliedCoupon = null;
    renderCart();
  }

  function removeCartItem(itemId) {
    state.cart = state.cart.filter((cartItem) => String(cartItem.item.id) !== String(itemId));
    state.foodQuote = null;
    state.appliedCoupon = null;
    renderCart();
  }

  function clearCart() {
    if (!state.cart.length) return;
    state.cart = [];
    state.foodQuote = null;
    state.appliedCoupon = null;
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
    if (!code) return toast('Indique o código do cupão.', 'error');
    const session = readSession();
    const restaurant = state.cart[0].restaurant;
    const response = await fetch(`${API_URL}/api/public/coupons/validate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
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
    if (!response.ok) throw new Error(data.message || 'Cupão inválido.');
    state.appliedCoupon = data;
    renderCartQuote();
    toast(`${data.label || `Cupão ${code}`} aplicado: ${money(data.discount)} de desconto.`);
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
      writeHistory(order);
      toast(`Pedido de comida enviado. Código: ${order.verification_code || '—'}`);
      await runDriverRadar(order);
      state.cart = [];
      state.foodQuote = null;
      state.appliedCoupon = null;
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
    const key = type === 'food' ? `food:${id}` : `restaurant:${id}`;
    saveLocalRating(key, parsedRating);
    renderAllFoodViews();
    try {
      const payload = {
        restaurant_id: restaurantId || id,
        menu_item_id: type === 'food' ? id : '',
        rating: parsedRating,
        customer_session_id: state.session?.id || state.session?.phone || 'anonymous'
      };
      const response = await fetch(`${API_URL}/api/public/ratings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await readJsonResponse(response);
      if (!response.ok) throw new Error(data.message || 'Não foi possível guardar a avaliação.');
      toast('Avaliação guardada.');
      await loadRestaurants(true);
    } catch (error) {
      toast(`${error.message} A avaliação ficou guardada neste dispositivo.`, 'error');
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
    $('#btn-refresh-history')?.addEventListener('click', refreshHistoryStatuses);
    $('#btn-refresh-radar')?.addEventListener('click', refreshDriverRadar);
    $('[data-client-notifications-read]')?.addEventListener('click', markClientNotificationsRead);
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
      try { await applyCartCoupon(); } catch (error) { toast(error.message, 'error'); }
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
            if (data.order) writeHistory(data.order);
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
        let history = [];
        try { history = JSON.parse(localStorage.getItem(clientStorageKey(ORDER_HISTORY_KEY)) || '[]'); } catch { history = []; }
        const order = radarState.order || history.find((entry) => !['concluido', 'cancelado'].includes(entry.status));
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
      const historyOrder = event.target.closest('[data-open-client-order]');
      if (historyOrder) {
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
  });
})();
