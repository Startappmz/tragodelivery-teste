/* TraGo V20 — experiência visual do Cliente em JavaScript puro. */
(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const SESSION_KEY = 'tragoClientSession';
  const ONBOARDING_KEY = 'tragoV20OnboardingSeen';
  const FAVORITES_KEY = 'tragoV20Favorites';
  const PREFERENCES_KEY = 'tragoClientPreferences';
  const ASSIGNED_DRIVER_KEY = 'tragoClientAssignedDriver';
  const ORDER_HISTORY_KEY = 'tragoClientOrderHistory';
  const storageKey = (base) => window.TragoClientStorageKey?.(base) || base;
  let activeOrderEntry = null;
  let activeOrderContext = null;
  let orderChatTimer = null;
  let orderRealtimeSubscription = null;
  let orderRealtimeSignature = '';
  let orderRealtimeGeneration = 0;
  let activeTrackingMap = null;
  let activeTrackingLayers = null;
  let detailTrackingMap = null;
  let detailTrackingLayers = null;
  let cargoStops = [];
  const favoriteRecords = new Map();
  const routeGeometryCache = new Map();

  const onboardingSlides = [
    { image: 'assets/v20/images/onboard_1.svg', title: 'Selecione a sua localização', description: 'Descubra restaurantes próximos, cozinhas e entregas disponíveis na sua zona.' },
    { image: 'assets/v20/images/onboard_2.svg', title: 'Escolha alimentos saborosos', description: 'Encontre pratos, restaurantes, promoções e opções para cada momento.' },
    { image: 'assets/v20/images/onboard_3.svg', title: 'Receba tudo a tempo', description: 'Acompanhe comida, encomendas e cargas até ao destino em tempo real.' },
    { image: 'assets/v20/images/delivery_location.svg', title: 'Encontre restaurantes e entregas perto de si', description: 'Permita a localização para mostrarmos opções, taxas e previsões mais exactas.' }
  ];
  const banners = [
    { kicker: 'TRAGO FOOD', title: 'A sua comida favorita, entregue onde estiver.', text: 'Restaurantes próximos, preços claros e entrega acompanhada.', image: 'assets/v20/images/comida-restaurantes.jpg', panel: 'food', action: 'Pedir agora', tone: 'food' },
    { kicker: 'BOTTLE STORE', title: 'Bebidas frescas para cada ocasião.', text: 'Escolha, confirme e receba com segurança.', image: 'assets/v20/images/comida-restaurantes.jpg', panel: 'bottle-store', action: 'Explorar lojas', tone: 'bottle' },
    { kicker: 'TRAGO EXPRESS', title: 'Da recolha ao destino, sem complicações.', text: 'Documentos, presentes, compras e carga no mesmo fluxo.', image: 'assets/v20/images/entrega-rapida.jpg', panel: 'delivery', action: 'Fazer envio', tone: 'express' }
  ];

  let onboardingIndex = 0;
  let bannerIndex = 0;
  let bannerTimer = null;

  function driverInitials(name) {
    return String(name || 'Motorista')
      .trim().split(/\s+/).slice(0, 2)
      .map((part) => part.charAt(0)).join('').toUpperCase() || 'M';
  }

  function normaliseAssignedDriver(source = {}) {
    const nested = source.profile && typeof source.profile === 'object' ? source.profile : {};
    const vehicle = source.vehicle && typeof source.vehicle === 'object'
      ? source.vehicle
      : (nested.vehicle && typeof nested.vehicle === 'object' ? nested.vehicle : {});
    const name = source.name || source.nome || nested.name || 'Motorista TraGo';
    return {
      id: source.id || source._id || nested.id || '',
      name,
      phone: source.phone || source.telefone || nested.phone || '',
      avatar_url: source.avatar_url || nested.avatar_url || '',
      rating: Number(source.rating || nested.rating || 4.9),
      verified: source.verified !== false && nested.verified !== false,
      distance_km: Number(source.distance_km || 0),
      location: source.location || nested.location || null,
      vehicle: {
        type: vehicle.type || source.vehicle_type || nested.vehicle_type || 'mota',
        plate: vehicle.plate || source.vehicle_plate || nested.vehicle_plate || '',
        brand: vehicle.brand || source.vehicle_brand || nested.vehicle_brand || '',
        model: vehicle.model || source.vehicle_model || nested.vehicle_model || '',
        color: vehicle.color || source.vehicle_color || nested.vehicle_color || '',
        photo_url: vehicle.photo_url || source.vehicle_photo_url || nested.vehicle_photo_url || ''
      }
    };
  }

  function readAssignedDriver() {
    const fallback = {
      name: 'Motorista por atribuir', phone: '', avatar_url: '', rating: 0, verified: false,
      vehicle: { type: 'outro', plate: '', brand: '', model: '', color: '', photo_url: '' }
    };
    try {
      const assigned = JSON.parse(localStorage.getItem(storageKey(ASSIGNED_DRIVER_KEY)) || 'null');
      if (assigned) return normaliseAssignedDriver(assigned);
      return normaliseAssignedDriver(fallback);
    } catch (_error) {
      return normaliseAssignedDriver(fallback);
    }
  }

  function assignedVehicleType(type) {
    return ({ mota: 'Motorizada', carro: 'Carro', carrinha: 'Carrinha', outro: 'Viatura' })[type] || 'Viatura';
  }

  function assignedVehicleIcon(type) {
    return type === 'carro' ? 'fa-solid fa-car-side'
      : type === 'carrinha' ? 'fa-solid fa-van-shuttle'
        : 'fa-solid fa-motorcycle';
  }

  function renderAssignedDriver(driver = readAssignedDriver()) {
    const safe = normaliseAssignedDriver(driver);
    const vehicleName = [safe.vehicle.brand, safe.vehicle.model].filter(Boolean).join(' ')
      || assignedVehicleType(safe.vehicle.type);
    const vehicleSummary = `${vehicleName} · ${safe.vehicle.plate || 'Matrícula por definir'}`;
    const firstLetters = driverInitials(safe.name);

    const verificationLabel = $('.v20-driver-public-identity > div > small');
    if (verificationLabel) {
      verificationLabel.innerHTML = safe.verified
        ? '<i class="fa-solid fa-shield-halved"></i> MOTORISTA VERIFICADO'
        : '<i class="fa-solid fa-shield"></i> MOTORISTA TRAGO';
    }

    $$('[data-assigned-driver-name]').forEach((node) => { node.textContent = safe.name; });
    $$('.v20-order-driver > div > small').forEach((node) => {
      node.textContent = safe.id
        ? (safe.location ? 'Localização em tempo real activa' : 'Motorista atribuído · a aguardar GPS')
        : 'Identificação disponível após atribuição';
    });
    $$('[data-assigned-driver-rating]').forEach((node) => { node.textContent = safe.rating.toFixed(1); });
    $$('[data-assigned-driver-initial]').forEach((node) => {
      node.textContent = firstLetters;
      node.hidden = Boolean(safe.avatar_url);
    });
    $$('[data-assigned-driver-avatar]').forEach((image) => {
      image.hidden = !safe.avatar_url;
      if (safe.avatar_url) image.src = safe.avatar_url;
      else image.removeAttribute('src');
    });
    $$('[data-assigned-driver-icon]').forEach((icon) => { icon.className = assignedVehicleIcon(safe.vehicle.type); });
    $$('[data-assigned-driver-vehicle]').forEach((node) => { node.textContent = vehicleSummary; });
    $$('[data-assigned-driver-vehicle-name]').forEach((node) => { node.textContent = vehicleName; });
    $$('[data-assigned-driver-plate]').forEach((node) => { node.textContent = safe.vehicle.plate || 'Matrícula por definir'; });
    $$('[data-assigned-driver-color]').forEach((node) => { node.textContent = safe.vehicle.color || 'Cor por definir'; });
    $$('[data-assigned-driver-call]').forEach((link) => {
      link.href = safe.phone ? `tel:${safe.phone.replace(/[^+\d]/g, '')}` : '#';
      link.classList.toggle('disabled', !safe.phone);
    });
    $$('[data-assigned-driver-vehicle-photo]').forEach((image) => {
      image.hidden = !safe.vehicle.photo_url;
      if (safe.vehicle.photo_url) image.src = safe.vehicle.photo_url;
      else image.removeAttribute('src');
    });
    $$('[data-assigned-driver-vehicle-fallback]').forEach((node) => { node.hidden = Boolean(safe.vehicle.photo_url); });
    return safe;
  }

  function openAssignedDriver() {
    renderAssignedDriver();
    openSheet('client-driver-profile-sheet');
  }

  window.TragoClientSetAssignedDriver = (driver) => {
    const safe = normaliseAssignedDriver(driver || {});
    try { localStorage.setItem(storageKey(ASSIGNED_DRIVER_KEY), JSON.stringify(safe)); } catch (_error) { /* sem armazenamento */ }
    renderAssignedDriver(safe);
    return safe;
  };

  function readSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
  }

  function storeSession(client, token = '') {
    const current = readSession() || {};
    const next = {
      id: client?.id || client?._id || current.id || '',
      name: client?.name || client?.nome || current.name || 'Cliente',
      phone: client?.phone || client?.telefone || current.phone || '',
      email: client?.email ?? current.email ?? '',
      avatar_url: client?.avatar_url ?? current.avatar_url ?? '',
      preferences: client?.notification_preferences || client?.preferences || current.preferences || {},
      language: client?.language || current.language || 'pt',
      wallet_balance_cents: Number(client?.wallet_balance_cents ?? current.wallet_balance_cents ?? 0),
      loyalty_points: Number(client?.loyalty_points ?? current.loyalty_points ?? 0),
      referral_code: client?.referral_code || current.referral_code || '',
      token: token || current.token || ''
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(next));
    return next;
  }

  async function clientApi(path, options = {}) {
    const session = readSession();
    const headers = { Accept: 'application/json', ...(options.headers || {}) };
    if (session?.token) headers.Authorization = `Bearer ${session.token}`;
    const request = { ...options, headers };
    if (options.body && !(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      request.body = JSON.stringify(options.body);
    }
    const response = await fetch(`${API_URL}${path}`, request);
    const data = await readJsonResponse(response);
    if (response.status === 401 && path.startsWith('/api/client/')) {
      localStorage.removeItem(SESSION_KEY);
      syncProfile();
    }
    if (!response.ok) throw new Error(data.message || 'Não foi possível comunicar com a TraGo.');
    return data;
  }

  async function uploadClientImage(file, category = 'avatar') {
    const form = new FormData();
    form.append('file', file);
    form.append('category', category);
    return clientApi('/api/media/upload', { method: 'POST', body: form });
  }

  function toast(message, type = '') {
    if (window.TragoFeedback) {
      window.TragoFeedback.notify(message, { type: type === 'error' ? 'error' : type || 'success' });
      return;
    }
    const node = $('#portal-toast');
    if (!node) return;
    node.textContent = message;
    node.className = `portal-toast ${type} show`;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => node.classList.remove('show'), 2600);
  }

  function syncProfile() {
    const session = readSession();
    const name = session?.name || 'Cliente';
    const phone = session?.phone || 'Conta TraGo';
    const initial = name.trim().charAt(0).toUpperCase() || 'C';
    $$('#client-name-label').forEach((node) => { node.textContent = name; });
    $$('#client-phone-label').forEach((node) => { node.textContent = phone; });
    $$('#client-initial, #cart-user-initial').forEach((node) => {
      node.textContent = initial;
      node.hidden = Boolean(session?.avatar_url);
    });
    if ($('#client-profile-initial')) $('#client-profile-initial').textContent = initial;
    $$('#client-avatar, #client-profile-avatar-image, #client-header-avatar-image, #client-menu-avatar-image').forEach((image) => {
      image.hidden = !session?.avatar_url;
      if (session?.avatar_url) image.src = session.avatar_url;
      else image.removeAttribute('src');
    });
    if ($('#client-profile-name-preview')) $('#client-profile-name-preview').textContent = name;
    $('#btn-client-login')?.toggleAttribute('hidden', Boolean(session));
    $('#btn-client-logout')?.toggleAttribute('hidden', !session);
    $('#btn-client-logout-account')?.toggleAttribute('hidden', !session);
  }

  function renderOnboarding() {
    const slide = onboardingSlides[onboardingIndex];
    if (!slide) return;
    $('#onboarding-image').src = slide.image;
    $('#onboarding-title').textContent = slide.title;
    $('#onboarding-description').textContent = slide.description;
    $('#onboarding-step-label').textContent = `PASSO ${onboardingIndex + 1} DE ${onboardingSlides.length}`;
    $$('#onboarding-dots i').forEach((dot, index) => dot.classList.toggle('active', index === onboardingIndex));
    const next = $('#btn-next-onboarding');
    next.innerHTML = onboardingIndex === onboardingSlides.length - 1
      ? '<i class="fa-solid fa-location-crosshairs"></i> Usar minha localização'
      : 'Seguinte <i class="fa-solid fa-arrow-right"></i>';
    $('#btn-location-later')?.classList.toggle('hidden', onboardingIndex !== onboardingSlides.length - 1);
  }

  function finishOnboarding() {
    localStorage.setItem(ONBOARDING_KEY, '1');
    $('#client-onboarding')?.classList.add('hidden');
    document.body.style.overflow = '';
  }

  function useOnboardingLocation() {
    if (!navigator.geolocation) return finishOnboarding();
    const button = $('#btn-next-onboarding');
    button.disabled = true;
    button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> A localizar…';
    navigator.geolocation.getCurrentPosition((position) => {
      localStorage.setItem('tragoV20LastLocation', JSON.stringify({ lat: position.coords.latitude, lng: position.coords.longitude }));
      finishOnboarding();
      toast('Localização definida. Bem-vindo à TraGo!');
    }, () => {
      finishOnboarding();
      toast('Pode definir a localização mais tarde.', 'error');
    }, { enableHighAccuracy: true, timeout: 8000 });
  }

  function initOnboarding() {
    const params = new URLSearchParams(location.search);
    const forceOnboarding = params.get('reset-onboarding') === '1';
    if (forceOnboarding) localStorage.removeItem(ONBOARDING_KEY);
    const seen = !forceOnboarding && localStorage.getItem(ONBOARDING_KEY) === '1';
    $('#client-onboarding')?.classList.toggle('hidden', seen);
    if (!seen) document.body.style.overflow = 'hidden';
    renderOnboarding();
    $('#btn-next-onboarding')?.addEventListener('click', () => {
      if (onboardingIndex < onboardingSlides.length - 1) {
        onboardingIndex += 1;
        renderOnboarding();
      } else useOnboardingLocation();
    });
    $('#btn-skip-onboarding')?.addEventListener('click', finishOnboarding);
    $('#btn-location-later')?.addEventListener('click', finishOnboarding);
  }

  function setBanner(index) {
    bannerIndex = (index + banners.length) % banners.length;
    const banner = banners[bannerIndex];
    const root = $('#home-banner');
    if (!root) return;
    root.dataset.tone = banner.tone;
    $('#banner-kicker').textContent = banner.kicker;
    $('#banner-title').textContent = banner.title;
    $('#banner-text').textContent = banner.text;
    $('#banner-image').src = banner.image;
    $('#banner-action').textContent = banner.action;
    $('#banner-action').dataset.jumpPanel = banner.panel;
    $$('.v20-banner-dots button').forEach((button, buttonIndex) => button.classList.toggle('active', buttonIndex === bannerIndex));
  }

  function initBanners() {
    $$('.v20-banner-dots button').forEach((button) => button.addEventListener('click', () => {
      setBanner(Number(button.dataset.banner || 0));
      clearInterval(bannerTimer);
      bannerTimer = setInterval(() => setBanner(bannerIndex + 1), 6500);
    }));
    bannerTimer = setInterval(() => setBanner(bannerIndex + 1), 6500);
  }

  function openSheet(id) {
    const sheet = document.getElementById(id);
    if (!sheet) return;
    sheet.classList.add('open');
    sheet.setAttribute('aria-hidden', 'false');
    document.body.classList.add('sheet-open');
    if (id === 'order-detail-sheet') {
      document.body.classList.add('tracking-open');
      const content = $('.v20-order-detail', sheet);
      if (content) content.scrollTop = 0;
    }
    document.body.style.overflow = 'hidden';
  }

  function closeSheet(id) {
    const sheet = document.getElementById(id);
    if (!sheet) return;
    sheet.classList.remove('open');
    sheet.setAttribute('aria-hidden', 'true');
    if (id === 'order-detail-sheet') document.body.classList.remove('tracking-open');
    if (!$('.v20-sheet.open')) {
      document.body.classList.remove('sheet-open');
      document.body.style.overflow = '';
    }
    if (id === 'order-detail-sheet') {
      clearInterval(orderChatTimer);
      orderChatTimer = null;
    }
  }

  window.TragoClientOpenAuth = () => openSheet('client-auth-sheet');

  function readActiveOrderEntry() {
    try {
      const history = JSON.parse(localStorage.getItem(storageKey(ORDER_HISTORY_KEY)) || '[]');
      const selectedId = sessionStorage.getItem('tragoClientSelectedOrderId');
      return history.find((item) => selectedId && String(item.id) === selectedId)
        || history.find((item) => !['concluido', 'cancelado'].includes(item.status))
        || history[0]
        || null;
    } catch (_error) { return null; }
  }

  function readCurrentActiveOrderEntry() {
    try {
      const history = JSON.parse(localStorage.getItem(storageKey(ORDER_HISTORY_KEY)) || '[]');
      return history.find((item) => !['concluido', 'cancelado'].includes(item.status)) || null;
    } catch (_error) { return null; }
  }

  function syncActiveOrderShell() {
    const entry = readCurrentActiveOrderEntry();
    const shell = $('.v20-active-order');
    const activeTab = $('[data-order-tab].active')?.dataset.orderTab || 'active';
    const active = activeTab === 'active' && entry && !['concluido', 'cancelado'].includes(entry.status);
    shell?.classList.toggle('hidden', !active);
    if (!shell || !active) return;
    const code = $('.v20-order-head small', shell);
    const title = $('.v20-order-head strong', shell);
    const labels = {
      pendente: 'A aguardar confirmação',
      atribuido: 'Pedido confirmado',
      recolha_em_progresso: 'Pedido confirmado',
      recolha_concluida: 'Em preparação',
      entrega_em_progresso: 'A caminho',
      concluido: 'Entregue',
      cancelado: 'Cancelado'
    };
    if (code) code.textContent = `PEDIDO #${String(entry.id || '').slice(-6).toUpperCase()}`;
    if (title) title.textContent = entry.restaurant_status === 'preparing' && !['entrega_em_progresso', 'concluido', 'cancelado'].includes(entry.status)
      ? 'Em preparação'
      : labels[entry.status] || 'A acompanhar';
    const deliveryCode = $('.v20-delivery-code strong', shell);
    if (deliveryCode) deliveryCode.textContent = entry.code ? String(entry.code).split('').join(' ') : '—';
    const chooseDriver = $('[data-reopen-driver-radar]', shell);
    if (chooseDriver) chooseDriver.hidden = Boolean(entry.assigned_to_driver) || entry.status !== 'pendente';
  }

  window.TragoClientSyncOrderShell = syncActiveOrderShell;

  async function orderApi(path, entry, options = {}) {
    const session = readSession();
    const response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        'X-Order-Access-Token': entry?.access_token || '',
        ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
        ...(options.headers || {})
      }
    });
    const data = await readJsonResponse(response);
    if (!response.ok) throw new Error(data.message || 'Não foi possível actualizar o pedido.');
    return data;
  }

  async function disconnectOrderRealtime() {
    orderRealtimeGeneration += 1;
    orderRealtimeSignature = '';
    const subscription = orderRealtimeSubscription;
    orderRealtimeSubscription = null;
    if (subscription?.unsubscribe) {
      try { await subscription.unsubscribe(); } catch (_error) { /* canal já desligado */ }
    }
  }

  function applyRealtimeDriverLocation(payload = {}) {
    const contextOrderId = String(activeOrderContext?.order?.id || activeOrderContext?.order?._id || '');
    const payloadOrderId = String(payload.orderId || '');
    if (!contextOrderId || (payloadOrderId && payloadOrderId !== contextOrderId)) return;
    const lat = Number(payload.lat);
    const lng = Number(payload.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)
      || lat < -90 || lat > 90 || lng < -180 || lng > 180
      || (Math.abs(lat) < 0.000001 && Math.abs(lng) < 0.000001)) return;

    const currentDriver = activeOrderContext?.driver || readAssignedDriver();
    const nextDriver = {
      ...currentDriver,
      id: payload.driverId || currentDriver.id || '',
      name: payload.driverName || currentDriver.name || 'Motorista TraGo',
      location: {
        lat,
        lng,
        accuracy: Number(payload.accuracy || 0) || null,
        speed: Number(payload.speed || 0) || null,
        updated_at: payload.updatedAt || new Date().toISOString()
      }
    };
    activeOrderContext = { ...activeOrderContext, driver: nextDriver };
    try { localStorage.setItem(storageKey(ASSIGNED_DRIVER_KEY), JSON.stringify(nextDriver)); } catch (_error) { /* sem cache */ }
    renderAssignedDriver(nextDriver);
    renderTrackingMaps(activeOrderContext);
  }

  async function ensureOrderRealtime(entry) {
    const orderId = String(entry?.id || '').trim();
    const accessToken = String(entry?.access_token || '').trim();
    const signature = orderId && accessToken ? `${orderId}:${accessToken}` : '';
    if (!signature || !window.TragoRealtime?.connectOrderRealtime) {
      if (orderRealtimeSubscription) disconnectOrderRealtime();
      return;
    }
    if (signature === orderRealtimeSignature && orderRealtimeSubscription) return;

    const generation = ++orderRealtimeGeneration;
    const previous = orderRealtimeSubscription;
    orderRealtimeSubscription = null;
    orderRealtimeSignature = signature;
    if (previous?.unsubscribe) {
      try { await previous.unsubscribe(); } catch (_error) { /* canal anterior já desligado */ }
    }

    try {
      const subscription = await window.TragoRealtime.connectOrderRealtime({
        orderId,
        accessToken,
        onEvent(event, payload) {
          if (String(payload?.orderId || orderId) !== orderId) return;
          if (event === 'order_driver_location') {
            applyRealtimeDriverLocation(payload);
            return;
          }
          if (['order_status_changed', 'order_message_created', 'restaurant_order_status_changed'].includes(event)) {
            if (activeOrderEntry?.id && String(activeOrderEntry.id) === orderId) refreshOrderConversation(true);
            else refreshActiveOrderTracking();
          }
        }
      });
      if (generation !== orderRealtimeGeneration || signature !== orderRealtimeSignature) {
        await subscription?.unsubscribe?.();
        return;
      }
      orderRealtimeSubscription = subscription;
    } catch (_error) {
      if (generation === orderRealtimeGeneration) {
        orderRealtimeSubscription = null;
        orderRealtimeSignature = '';
      }
      // O polling periódico continua activo como tolerância a falhas.
    }
  }

  function renderOrderMessages(messages = []) {
    const stream = $('.v20-chat-stream');
    if (!stream) return;
    if (!messages.length) {
      stream.innerHTML = '<p class="v20-chat-empty">Ainda não existem mensagens. Escreva ao motorista ou acompanhe aqui as actualizações.</p>';
      return;
    }
    stream.innerHTML = messages.map((message) => {
      const role = message.senderRole || message.sender_role || 'system';
      const time = new Date(message.createdAt || Date.now());
      const safeBody = String(message.body || '').replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char]));
      const safeName = String(message.senderName || message.sender_name || role).replace(/[&<>]/g, '');
      return `<article class="${role === 'client' ? 'mine' : role === 'system' ? 'system' : ''}"><b>${safeName}</b><p>${safeBody}</p><small>${Number.isNaN(time.getTime()) ? '' : time.toLocaleTimeString('pt-MZ', { hour: '2-digit', minute: '2-digit' })}</small></article>`;
    }).join('');
    stream.scrollTop = stream.scrollHeight;
  }

  function trackingPoint(order, prefix) {
    const location = prefix === 'pickup'
      ? (order?.pickup_address_coords || order?.pickup_location)
      : (order?.address_coords || order?.delivery_location);
    const coordinates = Array.isArray(location?.coordinates) ? location.coordinates : [];
    const lat = Number(order?.[`${prefix}_lat`] ?? location?.lat ?? coordinates[1]);
    const lng = Number(order?.[`${prefix}_lng`] ?? location?.lng ?? coordinates[0]);
    return Number.isFinite(lat) && Number.isFinite(lng)
      && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
      && !(Math.abs(lat) < 0.000001 && Math.abs(lng) < 0.000001)
      ? [lat, lng] : null;
  }

  function trackingIcon(kind, label) {
    if (!window.L) return null;
    if (window.TragoMapUI?.createPointIcon) {
      return window.TragoMapUI.createPointIcon(kind, label, { live: kind === 'driver' });
    }
    const icon = kind === 'driver' ? 'fa-motorcycle' : kind === 'pickup' ? 'fa-store' : 'fa-location-dot';
    return L.divIcon({
      className: 'trago-map-div-icon',
      html: `<span class="trago-map-pin ${kind}"><i class="fa-solid ${icon}"></i></span><small>${String(label || '').replace(/[&<>]/g, '')}</small>`,
      iconSize: [44, 54],
      iconAnchor: [22, 43]
    });
  }

  function compactTrackingLabel(value, fallback) {
    const firstPart = String(value || '').split(',')[0].trim() || fallback;
    return firstPart.length > 20 ? `${firstPart.slice(0, 18).trim()}…` : firstPart;
  }

  async function trackingRoute(origin, destination) {
    if (!origin || !destination) return [];
    const key = [...origin, ...destination].map((value) => Number(value).toFixed(4)).join(':');
    if (routeGeometryCache.has(key)) return routeGeometryCache.get(key);
    const pending = (async () => {
      try {
        const route = await window.TragoMapUI?.fetchRoadRoute?.(
          { lat: origin[0], lng: origin[1] },
          { lat: destination[0], lng: destination[1] },
          { apiUrl: API_URL, timeoutMs: 7000, attempts: 2 }
        );
        const points = window.TragoMapUI?.roadRouteLatLngs?.(route) || [];
        if (points.length < 3) throw new Error('Rota indisponível');
        return points;
      } catch (_error) {
        return [];
      }
    })();
    routeGeometryCache.set(key, pending);
    while (routeGeometryCache.size > 80) {
      routeGeometryCache.delete(routeGeometryCache.keys().next().value);
    }
    pending.then((points) => {
      if (!Array.isArray(points) || points.length < 3) routeGeometryCache.delete(key);
    });
    return pending;
  }

  async function trackingRouteSequence(points = []) {
    const valid = points.filter((point) => Array.isArray(point)
      && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1])));
    if (valid.length < 2) return [];
    try {
      const route = await window.TragoMapUI?.fetchRoadRouteSequence?.(
        valid.map((point) => ({ lat: point[0], lng: point[1] })),
        { apiUrl: API_URL, timeoutMs: 7000, attempts: 2 }
      );
      const routePoints = window.TragoMapUI?.roadRouteLatLngs?.(route) || [];
      return routePoints.length >= 3 ? routePoints : [];
    } catch (_error) {
      return [];
    }
  }

  function drawTrackingRoute(layers, points, options = {}) {
    if (!Array.isArray(points) || points.length < 2) return;
    if (window.TragoMapUI?.drawRoute) {
      window.TragoMapUI.drawRoute(layers, points, options);
      return;
    }
    L.polyline(points, {
      color: '#ffffff',
      weight: options.weight ? options.weight + 5 : 11,
      opacity: 0.96,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(layers);
    L.polyline(points, {
      color: options.color || '#35bd70',
      weight: options.weight || 6,
      opacity: 0.96,
      dashArray: options.dashArray || null,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(layers);
  }

  function ensureTrackingMap(element, detail = false) {
    if (!element || !window.L) return null;
    const currentMap = detail ? detailTrackingMap : activeTrackingMap;
    if (currentMap) return currentMap;
    const map = L.map(element, {
      zoomControl: false,
      attributionControl: true,
      dragging: true,
      scrollWheelZoom: false,
      touchZoom: true,
      doubleClickZoom: true,
      keyboard: true,
      boxZoom: false
    }).setView([-25.9692, 32.5732], 12);
    if (detail) {
      if (window.TragoMapUI?.addZoomControl) window.TragoMapUI.addZoomControl(map);
      else L.control.zoom({ position: 'bottomright' }).addTo(map);
    }
    if (window.TragoMapUI?.addBaseLayer) window.TragoMapUI.addBaseLayer(map);
    else {
      L.tileLayer('https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        maxZoom: 20,
        keepBuffer: 2,
        updateWhenZooming: false,
        attribution: '&copy; OpenStreetMap &copy; CARTO'
      }).addTo(map);
    }
    map._tragoCamera = window.TragoMapUI?.createCameraController?.(map) || null;
    window.TragoMapUI?.observeMapSize?.(map);
    if (window.TragoMapUI?.addStatusControl) {
      map._tragoStatusControl = window.TragoMapUI.addStatusControl(map, {
        label: 'AO VIVO',
        icon: 'fa-circle',
        tone: 'live',
        position: 'topright'
      });
    } else {
      const liveControl = L.control({ position: 'topright' });
      liveControl.onAdd = () => {
        const badge = L.DomUtil.create('div', 'trago-map-live-badge');
        badge.innerHTML = '<i></i><span>AO VIVO</span>';
        return badge;
      };
      liveControl.addTo(map);
    }
    map._tragoNavigationControl = window.TragoMapUI?.addNavigationControl?.(map, {
      label: detail ? 'Navegação do acompanhamento' : 'Navegação da pré-visualização',
      position: 'topright',
      actions: [
        {
          id: 'fit-route',
          icon: 'fa-route',
          title: 'Ver a rota completa',
          onClick: () => map._tragoFitRoute?.()
        },
        ...(detail ? [{
          id: 'focus-driver',
          icon: 'fa-motorcycle',
          title: 'Seguir motorista',
          onClick: () => map._tragoFocusDriver?.()
        }] : [])
      ]
    }) || null;
    map._tragoCamera?.onModeChange?.((mode) => {
      map._tragoNavigationControl?.setActive?.('focus-driver', mode === 'follow');
    });
    window.TragoMapUI?.syncPartnerLayer?.(map, window.TragoClientGetMapPartners?.() || []);
    const layers = L.layerGroup().addTo(map);
    map._tragoMarkerLayer = L.layerGroup().addTo(map);
    map._tragoMarkers = {};
    map._tragoRouteGeneration = 0;
    if (detail) {
      detailTrackingMap = map;
      detailTrackingLayers = layers;
    } else {
      activeTrackingMap = map;
      activeTrackingLayers = layers;
    }
    return map;
  }

  function upsertTrackingMarker(map, kind, point, icon) {
    const existing = map?._tragoMarkers?.[kind];
    if (!point) {
      if (existing) {
        map._tragoMarkerLayer?.removeLayer(existing);
        delete map._tragoMarkers[kind];
      }
      return null;
    }
    if (existing) {
      existing.setLatLng(point);
      existing.setIcon(icon);
      return existing;
    }
    const marker = L.marker(point, { icon }).addTo(map._tragoMarkerLayer);
    map._tragoMarkers[kind] = marker;
    return marker;
  }

  function syncTrackingPartnerLayers(partners = window.TragoClientGetMapPartners?.() || []) {
    [activeTrackingMap, detailTrackingMap].filter(Boolean).forEach((map) => {
      window.TragoMapUI?.syncPartnerLayer?.(map, partners);
    });
  }

  window.addEventListener('trago:partners-updated', (event) => {
    syncTrackingPartnerLayers(event.detail?.partners || []);
  });

  function refreshTrackingRoutes(map, layers, { mainOrigin, delivery, routeStops = [], driver, target, status }) {
    const routeSignature = JSON.stringify({ mainOrigin, delivery, routeStops, driver, target, status });
    if (map._tragoRouteSignature === routeSignature) return;
    map._tragoRouteSignature = routeSignature;
    const generation = ++map._tragoRouteGeneration;
    clearTimeout(map._tragoRouteRetryTimer);
    layers.clearLayers();
    const jobs = [];
    if (mainOrigin && delivery) {
      jobs.push(trackingRouteSequence([mainOrigin, ...routeStops, delivery]).then((route) => ({ kind: 'main', route })));
    }
    if (driver && target && mainOrigin !== driver && (driver[0] !== target[0] || driver[1] !== target[1])) {
      jobs.push(trackingRoute(driver, target).then((route) => ({ kind: 'driver', route })));
    }
    Promise.all(jobs).then((routes) => {
      if (generation !== map._tragoRouteGeneration) return;
      layers.clearLayers();
      const successful = routes.filter(({ route }) => Array.isArray(route) && route.length >= 3);
      successful.forEach(({ kind, route }) => drawTrackingRoute(layers, route, kind === 'main'
        ? { color: '#35bd70', weight: 6 }
        : {
            color: '#102c1c',
            weight: 4,
            dashArray: status === 'entrega_em_progresso' ? null : '9 9'
          }));
      map.getContainer?.().classList.remove('is-route-loading');
      const incomplete = successful.length !== routes.length;
      map.getContainer?.().classList.toggle('is-route-unavailable', incomplete);
      if (incomplete) {
        map._tragoRouteSignature = '';
        map._tragoRouteRetryTimer = setTimeout(() => {
          if (map?._container) refreshTrackingRoutes(map, layers, {
            mainOrigin, delivery, routeStops, driver, target, status
          });
        }, 4000);
      }
    });
    map.getContainer?.().classList.toggle('is-route-loading', jobs.length > 0);
  }

  async function paintTrackingMap(element, context, detail = false) {
    const map = ensureTrackingMap(element, detail);
    if (!map) return;
    const layers = detail ? detailTrackingLayers : activeTrackingLayers;
    const order = context?.order || {};
    const orderKey = String(order.id || order._id || '');
    if (map._tragoOrderKey !== orderKey) {
      map._tragoOrderKey = orderKey;
      map._tragoHasInitialFit = false;
      map._tragoPaintSignature = '';
      map._tragoRouteSignature = '';
      map._tragoCamera?.setMode?.('initial-fit');
    }
    const pickup = trackingPoint(order, 'pickup');
    const delivery = trackingPoint(order, 'delivery');
    const routeStops = (Array.isArray(order.route_stops) ? order.route_stops : [])
      .map((stop) => {
        const lat = Number(stop?.lat);
        const lng = Number(stop?.lng);
        return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null;
      })
      .filter(Boolean);
    const rawDriverLat = context?.driver?.location?.lat;
    const rawDriverLng = context?.driver?.location?.lng;
    const driverLat = Number(rawDriverLat);
    const driverLng = Number(rawDriverLng);
    const driver = rawDriverLat !== null && rawDriverLat !== undefined
      && rawDriverLng !== null && rawDriverLng !== undefined
      && Number.isFinite(driverLat) && Number.isFinite(driverLng)
      ? [driverLat, driverLng]
      : null;
    const paintSignature = JSON.stringify({
      pickup,
      delivery,
      routeStops,
      driver,
      status: order.status,
      locationUpdatedAt: context?.driver?.location?.updated_at || context?.driver?.location?.updatedAt || ''
    });
    if (map._tragoPaintSignature === paintSignature) {
      if (map._tragoCamera?.getMode?.() === 'follow' && driver) map._tragoCamera.follow(driver, 17);
      return;
    }
    map._tragoPaintSignature = paintSignature;
    const points = [pickup, ...routeStops, delivery, driver].filter(Boolean);

    const mainOrigin = pickup || (['recolha_concluida', 'entrega_em_progresso'].includes(order.status) ? driver : null);
    const target = ['pendente', 'atribuido', 'recolha_em_progresso'].includes(order.status) ? pickup : delivery;
    refreshTrackingRoutes(map, layers, {
      mainOrigin,
      delivery,
      routeStops,
      driver,
      target,
      status: order.status
    });

    upsertTrackingMarker(map, 'pickup', pickup, trackingIcon('pickup', 'Recolha'));
    upsertTrackingMarker(map, 'delivery', delivery, trackingIcon('delivery', 'Destino'));
    upsertTrackingMarker(map, 'driver', driver, trackingIcon('driver', compactTrackingLabel(context?.driver?.name, 'Motorista')));
    routeStops.forEach((stop, index) => upsertTrackingMarker(map, `stop-${index}`, stop, trackingIcon('delivery', `Paragem ${index + 1}`)));
    Object.keys(map._tragoMarkers || {})
      .filter((key) => key.startsWith('stop-') && Number(key.slice(5)) >= routeStops.length)
      .forEach((key) => upsertTrackingMarker(map, key, null, null));
    const driverAccuracy = Math.max(0, Number(context?.driver?.location?.accuracy || 0));
    if (driver && driverAccuracy) {
      if (map._tragoDriverAccuracyCircle) map._tragoDriverAccuracyCircle.setLatLng(driver).setRadius(driverAccuracy);
      else map._tragoDriverAccuracyCircle = L.circle(driver, {
        radius: driverAccuracy,
        color: '#245f3b',
        weight: 1,
        opacity: 0.35,
        fillColor: '#35bd70',
        fillOpacity: 0.08,
        interactive: false
      }).addTo(map);
    } else if (map._tragoDriverAccuracyCircle) {
      map.removeLayer(map._tragoDriverAccuracyCircle);
      map._tragoDriverAccuracyCircle = null;
    }
    const locationUpdatedAt = context?.driver?.location?.updated_at || context?.driver?.location?.updatedAt;
    const locationAgeMs = locationUpdatedAt ? Date.now() - new Date(locationUpdatedAt).getTime() : NaN;
    const stale = Number.isFinite(locationAgeMs) && locationAgeMs > 120000;
    map._tragoStatusControl?.setLabel?.(driver
      ? stale ? 'LOCALIZAÇÃO DESACTUALIZADA' : 'AO VIVO'
      : 'A AGUARDAR MOTORISTA');
    map._tragoFitRoute = () => {
      if (points.length > 1) {
        map._tragoCamera?.fit(points, {
          paddingTopLeft: detail ? [44, 118] : [34, 48],
          paddingBottomRight: detail ? [44, 76] : [34, 48],
          maxZoom: detail ? 16 : 15,
          animate: true
        }, { force: true, mode: 'free' });
      } else if (points[0]) map._tragoCamera?.setView(points[0], 15, { force: true, mode: 'free' });
      else map._tragoCamera?.setView([-25.9692, 32.5732], 12, { force: true, mode: 'free' });
    };
    map._tragoFocusDriver = () => {
      if (driver) map._tragoCamera?.follow(driver, 17);
      else map._tragoFitRoute();
    };
    if (!map._tragoHasInitialFit) {
      if (points.length > 1) {
        map._tragoCamera?.fit(points, {
          paddingTopLeft: detail ? [44, 118] : [34, 48],
          paddingBottomRight: detail ? [44, 76] : [34, 48],
          maxZoom: detail ? 16 : 15
        }, { mode: 'initial-fit' });
      } else if (points[0]) map._tragoCamera?.setView(points[0], 15, { mode: 'initial-fit' });
      else map._tragoCamera?.setView([-25.9692, 32.5732], 12, { mode: 'initial-fit' });
      map._tragoHasInitialFit = true;
    } else if (map._tragoCamera?.getMode?.() === 'follow' && driver) {
      map._tragoCamera.follow(driver, 17);
    }
    setTimeout(() => map.invalidateSize(), 100);
  }

  function renderTrackingMaps(context) {
    const activeMapElement = $('#client-active-order-map');
    const detailMapElement = $('#client-live-order-map');
    if (activeMapElement && !$('.v20-active-order')?.classList.contains('hidden')) paintTrackingMap(activeMapElement, context, false);
    if (detailMapElement && $('#order-detail-sheet')?.classList.contains('open')) paintTrackingMap(detailMapElement, context, true);
  }

  window.TragoClientMapTracking = Object.freeze({
    render(context, { detail = true, preview = true } = {}) {
      const activeMapElement = preview ? $('#client-active-order-map') : null;
      const detailMapElement = detail ? $('#client-live-order-map') : null;
      if (activeMapElement) paintTrackingMap(activeMapElement, context, false);
      if (detailMapElement) paintTrackingMap(detailMapElement, context, true);
    },
    syncPartners: syncTrackingPartnerLayers
  });

  function renderOrderContext(context) {
    const order = context?.order || {};
    activeOrderContext = context;
    const orderId = String(order.id || order._id || '');
    const realtimeEntry = String(activeOrderEntry?.id || '') === orderId
      ? activeOrderEntry
      : readCurrentActiveOrderEntry();
    ensureOrderRealtime(realtimeEntry);
    const code = `PEDIDO #${String(order.id || order._id || '').slice(-6).toUpperCase()}`;
    const headerCode = $('#order-detail-sheet header.simple small');
    if (headerCode) headerCode.textContent = code;
    const activeCode = $('.v20-active-order .v20-order-head small');
    if (activeCode) activeCode.textContent = code;
    const chatTitle = $('#order-detail-sheet .v20-chat header strong');
    const chatSubtitle = $('#order-detail-sheet .v20-chat header small');
    if (chatTitle) chatTitle.textContent = 'Chat com o motorista';
    if (chatSubtitle) chatSubtitle.textContent = 'Canal privado Cliente ↔ Motorista';
    const driver = context?.driver;
    if (driver) {
      localStorage.setItem(storageKey(ASSIGNED_DRIVER_KEY), JSON.stringify(driver));
      renderAssignedDriver(driver);
    } else {
      localStorage.removeItem(storageKey(ASSIGNED_DRIVER_KEY));
      renderAssignedDriver({ name: 'Motorista por atribuir', rating: 0, verified: false, vehicle: { type: 'outro' } });
    }
    const restaurantStatus = order.restaurant_status || order.restaurantStatus;
    const isOnWay = ['entrega_em_progresso', 'concluido'].includes(order.status);
    const isDelivered = order.status === 'concluido';
    const isCancelled = order.status === 'cancelado';
    const isConfirmed = Boolean(order.assigned_to_driver) || !['pendente', 'cancelado'].includes(order.status);
    const isPreparing = restaurantStatus === 'preparing' || Boolean(order.pickup_authorized_at || order.pickupAuthorizedAt);
    const publicStatus = isCancelled
      ? 'Cancelado'
      : isDelivered
        ? 'Entregue'
        : isOnWay
          ? 'A caminho'
          : isPreparing
            ? 'Em preparação'
            : isConfirmed
              ? 'Pedido confirmado'
              : 'A aguardar confirmação';
    const title = $('.v20-active-order .v20-order-head strong');
    if (title) title.textContent = publicStatus;
    const routeLabels = $$('.v20-active-order .v20-order-route strong');
    if (routeLabels[0]) routeLabels[0].textContent = order.pickup_address_text || context?.restaurant?.name || 'Ponto de recolha';
    if (routeLabels[1]) routeLabels[1].textContent = order.address_text || 'Destino de entrega';
    const eta = $('[data-active-order-eta]');
    if (eta) eta.textContent = order.route_duration_min ? `${Math.round(Number(order.route_duration_min))} min` : 'Em actualização';
    const history = Array.isArray(context?.status_history) ? context.status_history : [];
    const statusDefinitions = [
      { key: 'confirmed', reached: isConfirmed, active: isConfirmed && !isPreparing && !isOnWay && !isDelivered, label: 'Pedido confirmado', fallback: order.driver_assigned_at || order.driverAssignedAt },
      { key: 'preparing', reached: isPreparing || isOnWay || isDelivered, active: isPreparing && !isOnWay && !isDelivered, label: 'Em preparação' },
      { key: 'on_way', reached: isOnWay || isDelivered, active: isOnWay && !isDelivered, label: 'A caminho', fallback: order.delivery_start_at || order.deliveryStartAt },
      { key: 'delivered', reached: isDelivered, active: isDelivered, label: 'Entregue', fallback: order.timestamp_completed || order.timestampCompleted }
    ];
    statusDefinitions.forEach((definition) => {
      const node = $(`#order-detail-sheet [data-client-status="${definition.key}"]`);
      if (!node) return;
      const event = history.find((item) => item.label === definition.label);
      const timestamp = event?.created_at || event?.createdAt || definition.fallback;
      const time = timestamp ? new Date(timestamp) : null;
      const small = $('small', node);
      node.classList.toggle('done', definition.reached && !definition.active && !isCancelled);
      node.classList.toggle('active', definition.active && !isCancelled);
      if (small) small.textContent = time && !Number.isNaN(time.getTime())
        ? time.toLocaleTimeString('pt-MZ', { hour: '2-digit', minute: '2-digit' })
        : definition.active && !isCancelled ? 'Agora' : '—';
    });
    const codeValue = String(order.verification_code || '').replace(/\s+/g, '').split('').join(' ');
    const deliveryCode = $('.v20-active-order .v20-delivery-code strong');
    if (deliveryCode && codeValue) deliveryCode.textContent = codeValue;
    const contactCopy = $('#order-detail-sheet header.simple p');
    if (contactCopy) contactCopy.textContent = isCancelled
      ? `Cancelado${order.cancel_reason ? `: ${order.cancel_reason}` : '.'}`
      : 'Estados públicos e canal privado Cliente ↔ Motorista.';
    const chooseDriver = $('[data-reopen-driver-radar]');
    if (chooseDriver) chooseDriver.hidden = Boolean(order.assigned_to_driver) || order.status !== 'pendente';
    renderTrackingMaps(context);
  }

  async function refreshOrderConversation(silent = false) {
    if (!activeOrderEntry?.id || (!activeOrderEntry.access_token && !readSession()?.token)) return;
    try {
      const [context, messages] = await Promise.all([
        orderApi(`/api/public/orders/${encodeURIComponent(activeOrderEntry.id)}/context`, activeOrderEntry),
        orderApi(`/api/public/orders/${encodeURIComponent(activeOrderEntry.id)}/messages`, activeOrderEntry)
      ]);
      renderOrderContext(context);
      renderOrderMessages(messages.messages || []);
      const nextStatus = context.order?.status || activeOrderEntry.status;
      const nextRestaurantStatus = context.order?.restaurant_status || context.order?.restaurantStatus || activeOrderEntry.restaurant_status;
      const changed = nextStatus !== activeOrderEntry.status || nextRestaurantStatus !== activeOrderEntry.restaurant_status;
      activeOrderEntry.status = nextStatus;
      activeOrderEntry.restaurant_status = nextRestaurantStatus;
      activeOrderEntry.assigned_to_driver = context.order?.assigned_to_driver || activeOrderEntry.assigned_to_driver;
      activeOrderEntry.driver_offer_status = context.order?.driver_offer_status || null;
      activeOrderEntry.driver_offer_expires_at = context.order?.driver_offer_expires_at || null;
      if (changed) activeOrderEntry.last_update = new Date().toISOString();
      const history = JSON.parse(localStorage.getItem(storageKey(ORDER_HISTORY_KEY)) || '[]');
      localStorage.setItem(storageKey(ORDER_HISTORY_KEY), JSON.stringify(history.map((entry) => String(entry.id) === String(activeOrderEntry.id) ? { ...entry, ...activeOrderEntry } : entry)));
      syncActiveOrderShell();
      window.TragoClientRenderNotifications?.();
    } catch (error) {
      if (!silent) toast(error.message, 'error');
    }
  }

  async function refreshActiveOrderTracking() {
    const historyPanel = $('[data-panel="history"]');
    const activeTab = $('[data-order-tab].active')?.dataset.orderTab || 'active';
    if (historyPanel?.classList.contains('hidden') || activeTab !== 'active') return;
    const entry = readCurrentActiveOrderEntry();
    if (!entry?.id || (!entry.access_token && !readSession()?.token)) return;
    try {
      const context = await orderApi(`/api/public/orders/${encodeURIComponent(entry.id)}/context`, entry);
      renderOrderContext(context);
      const history = JSON.parse(localStorage.getItem(storageKey(ORDER_HISTORY_KEY)) || '[]');
      const nextOrder = context.order || {};
      localStorage.setItem(storageKey(ORDER_HISTORY_KEY), JSON.stringify(history.map((item) => String(item.id) === String(entry.id)
        ? {
            ...item,
            status: nextOrder.status || item.status,
            restaurant_status: nextOrder.restaurant_status || nextOrder.restaurantStatus || item.restaurant_status,
            assigned_to_driver: nextOrder.assigned_to_driver || item.assigned_to_driver,
            driver_offer_status: nextOrder.driver_offer_status || null,
            driver_offer_expires_at: nextOrder.driver_offer_expires_at || null,
            pickup_address_coords: nextOrder.pickup_address_coords || item.pickup_address_coords,
            address_coords: nextOrder.address_coords || item.address_coords,
            last_update: new Date().toISOString()
          }
        : item)));
      syncActiveOrderShell();
    } catch (_error) { /* o próximo ciclo volta a tentar */ }
  }

  async function openOrderDetail() {
    activeOrderEntry = readActiveOrderEntry();
    renderOrderMessages([]);
    const loadingTitle = $('.v20-active-order .v20-order-head strong');
    if (loadingTitle) loadingTitle.textContent = 'A carregar estado…';
    $$('#order-detail-sheet .v20-timeline > span').forEach((node) => {
      node.classList.remove('done', 'active');
      const time = $('small', node);
      if (time) time.textContent = '—';
    });
    openSheet('order-detail-sheet');
    if (!activeOrderEntry) {
      toast('Ainda não existe um pedido neste dispositivo.', 'error');
      return;
    }
    if (!activeOrderEntry.access_token && !readSession()?.token) {
      renderOrderMessages([]);
      toast('Entre na conta usada neste pedido para abrir a comunicação segura.', 'error');
      return;
    }
    await refreshOrderConversation();
    clearInterval(orderChatTimer);
    orderChatTimer = setInterval(() => refreshOrderConversation(true), 8000);
  }

  window.TragoClientOpenOrder = (orderId) => {
    if (orderId) sessionStorage.setItem('tragoClientSelectedOrderId', String(orderId));
    openOrderDetail();
  };

  function initSheets() {
    $('#btn-client-login')?.addEventListener('click', () => openSheet('client-auth-sheet'));
    $('#btn-open-directory-filter')?.addEventListener('click', () => openSheet('directory-filter-sheet'));
    $$('[data-open-order-detail]').forEach((button) => button.addEventListener('click', () => {
      sessionStorage.removeItem('tragoClientSelectedOrderId');
      openOrderDetail();
    }));
    $$('[data-open-assigned-driver]').forEach((button) => button.addEventListener('click', openAssignedDriver));
    $$('[data-close-sheet]').forEach((button) => button.addEventListener('click', () => closeSheet(button.dataset.closeSheet)));
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      const sheet = $('.v20-sheet.open');
      if (sheet) closeSheet(sheet.id);
    });
  }

  function initAuth() {
    $$('[data-auth-mode]').forEach((button) => button.addEventListener('click', () => {
      $$('[data-auth-mode]').forEach((item) => item.classList.toggle('active', item === button));
      const registering = button.dataset.authMode === 'register';
      $$('.register-field').forEach((field) => field.classList.toggle('hidden', !registering));
      $('#v20-auth-form')?.setAttribute('data-mode', registering ? 'register' : 'login');
      const email = $('#v20-auth-form input[name="email"]');
      const name = $('#v20-auth-form input[name="name"]');
      const phone = $('#v20-auth-form input[name="phone"]');
      const password = $('#v20-auth-form input[name="password"]');
      if (email) email.required = true;
      if (name) name.required = registering;
      if (phone) phone.required = registering;
      if (password) {
        password.minLength = registering ? 8 : 4;
        password.autocomplete = registering ? 'new-password' : 'current-password';
      }
    }));
    $('#v20-auth-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const data = new FormData(form);
      const phone = String(data.get('phone') || '').trim();
      const email = String(data.get('email') || '').trim();
      const password = String(data.get('password') || '');
      const registering = form.dataset.mode === 'register';
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      button.textContent = registering ? 'A criar conta…' : 'A entrar…';
      try {
        const result = await clientApi(registering ? '/api/public/clients/register' : '/api/public/clients/login', {
          method: 'POST',
          body: registering
            ? { name: String(data.get('name') || '').trim(), phone, email, password }
            : { email, password }
        });
        const session = storeSession(result.client, result.token);
        window.TragoClientRefreshSession?.();
        window.TragoClientAddresses?.refresh?.();
        loadRemoteFavorites();
        loadClientBenefits(true);
        closeSheet('client-auth-sheet');
        syncProfile();
        form.reset();
        toast(`Bem-vindo, ${session.name.split(' ')[0]}!`);
      } catch (error) {
        toast(error.message, 'error');
      } finally {
        button.disabled = false;
        button.textContent = 'Continuar';
      }
    });
    $('[data-continue-guest]')?.addEventListener('click', () => closeSheet('client-auth-sheet'));
    $('[data-forgot-password]')?.addEventListener('click', () => {
      closeSheet('client-auth-sheet');
      window.TragoClientOpenPanel?.('support');
      toast('Abra uma conversa segura com o suporte para recuperar a palavra-passe.');
    });
  }

  function openProfile() {
    const session = readSession();
    if (!session) {
      openSheet('client-auth-sheet');
      return;
    }
    const form = $('#client-profile-form');
    if (form) {
      form.elements.name.value = session.name || '';
      form.elements.phone.value = session.phone || '';
      form.elements.email.value = session.email || '';
    }
    openSheet('client-profile-sheet');
  }

  function initProfile() {
    $('#client-profile-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const current = readSession();
      if (!current?.token) {
        closeSheet('client-profile-sheet');
        openSheet('client-auth-sheet');
        toast('Entre na sua conta para guardar o perfil.', 'error');
        return;
      }
      const data = new FormData(form);
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      try {
        let avatarUrl = current.avatar_url || '';
        const avatarFile = form.elements.avatar?.files?.[0];
        if (avatarFile) avatarUrl = (await uploadClientImage(avatarFile, 'avatar')).url;
        const result = await clientApi('/api/client/me', {
          method: 'PUT',
          body: {
            name: String(data.get('name') || '').trim(),
            phone: String(data.get('phone') || '').trim(),
            email: String(data.get('email') || '').trim(),
            avatar_url: avatarUrl
          }
        });
        storeSession(result.client, result.token);
        window.TragoClientRefreshSession?.();
        syncProfile();
        closeSheet('client-profile-sheet');
        toast('Perfil actualizado.');
      } catch (error) {
        toast(error.message, 'error');
      } finally {
        button.disabled = false;
      }
    });
  }

  function bindHomeSearch() {
    $('#home-search-form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const value = $('#home-search')?.value || '';
      window.TragoClientOpenPanel?.('food');
      setTimeout(() => {
        const input = $('#food-search');
        if (!input) return;
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }, 0);
    });
    $$('[data-prefill]').forEach((button) => button.addEventListener('click', () => {
      setTimeout(() => {
        const input = $('#food-search');
        if (!input) return;
        input.value = button.dataset.prefill;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }, 0);
    }));
  }

  function selectCargoType(button) {
    $$('#cargo-type-grid [data-cargo-type]').forEach((item) => item.classList.toggle('active', item === button));
    $('#cargo-type-label').textContent = button.dataset.label || 'Envio';
    $('#cargo-type-description').textContent = button.dataset.description || '';
    $('#order-service-type').value = button.dataset.cargoType || 'outros';
    $('#cargo-item-description')?.focus();
  }

  function selectVehicle(button) {
    $$('#cargo-vehicle-grid [data-vehicle]').forEach((item) => item.classList.toggle('active', item === button));
    const vehicle = button.dataset.vehicle || 'Moto';
    $('#cargo-selected-vehicle').textContent = vehicle === 'Moto' ? 'Motorizada' : vehicle;
    const icon = $('.v20-selected-vehicle>i');
    if (icon) icon.className = vehicle === 'Camião' ? 'fa-solid fa-truck' : vehicle === 'Carrinha' ? 'fa-solid fa-car-side' : 'fa-solid fa-motorcycle';
  }

  function initCargo() {
    $$('#cargo-type-grid [data-cargo-type]').forEach((button) => button.addEventListener('click', () => selectCargoType(button)));
    $$('#cargo-vehicle-grid [data-vehicle]').forEach((button) => button.addEventListener('click', () => selectVehicle(button)));
    $('#btn-cargo-continue')?.addEventListener('click', () => {
      if (!String($('#order-service-type')?.value || '').trim()) return toast('Escolha a categoria do produto ou carga.', 'error');
      if (String($('#cargo-item-description')?.value || '').trim().length < 3) return toast('Descreva exactamente o produto ou conteúdo a recolher.', 'error');
      if (!$('#cargo-selected-source')?.classList.contains('selected')) return toast('Escolha um Parceiro TraGo ou adicione o ponto de recolha no mapa.', 'error');
      $('#cargo-step-selector')?.classList.add('hidden');
      $('#cargo-step-details')?.classList.remove('hidden');
      scrollTo({ top: 0, behavior: 'smooth' });
    });
    $('#btn-cargo-back')?.addEventListener('click', () => {
      $('#cargo-step-details')?.classList.add('hidden');
      $('#cargo-step-selector')?.classList.remove('hidden');
      scrollTo({ top: 0, behavior: 'smooth' });
    });
    const distance = $('#delivery-distance-label');
    if (distance) new MutationObserver(() => { if ($('#delivery-distance-label-secondary')) $('#delivery-distance-label-secondary').textContent = distance.textContent; }).observe(distance, { childList: true, subtree: true });
    const syncRouteText = () => {
      const pickup = $('#order-pickup-address')?.value.trim();
      const delivery = $('#order-delivery-address')?.value.trim();
      if (pickup && $('#route-pickup-label')) $('#route-pickup-label').textContent = pickup;
      if (delivery && $('#route-delivery-label')) $('#route-delivery-label').textContent = delivery;
    };
    $('#order-pickup-address')?.addEventListener('input', syncRouteText);
    $('#order-delivery-address')?.addEventListener('input', syncRouteText);
    const renderStops = () => {
      const list = $('#cargo-stops-list');
      if (!list) return;
      list.innerHTML = cargoStops.map((stop, index) => `<span><i class="fa-solid fa-location-dot"></i><b>${String(stop.address).replace(/[&<>"]/g, '')}${Number.isFinite(Number(stop.lat)) && Number.isFinite(Number(stop.lng)) ? `<small><i class="fa-solid fa-map-pin"></i> ${Number(stop.lat).toFixed(5)}, ${Number(stop.lng).toFixed(5)}</small>` : '<small>Morada escrita</small>'}</b><button type="button" data-remove-cargo-stop="${index}" aria-label="Remover paragem"><i class="fa-solid fa-xmark"></i></button></span>`).join('');
    };
    window.TragoClientAddCargoStop = (stop) => {
      const address = String(stop?.address || '').trim();
      if (address.length < 5) return toast('Indique uma paragem válida.', 'error');
      if (cargoStops.length >= 5) return toast('Pode adicionar no máximo 5 paragens.', 'error');
      cargoStops.push({
        address,
        lat: Number.isFinite(Number(stop?.lat)) ? Number(stop.lat) : null,
        lng: Number.isFinite(Number(stop?.lng)) ? Number(stop.lng) : null,
        source: stop?.source === 'map' ? 'map' : 'text'
      });
      renderStops();
      toast('Paragem adicionada à rota.');
      window.TragoClientRefreshDeliveryQuote?.();
      return true;
    };
    $('#btn-add-cargo-stop')?.addEventListener('click', async () => {
      const input = $('#cargo-stop');
      const address = String(input?.value || '').trim();
      if (address.length < 5) return toast('Indique uma paragem válida.', 'error');
      if (cargoStops.length >= 5) return toast('Pode adicionar no máximo 5 paragens.', 'error');
      const button = $('#btn-add-cargo-stop');
      if (button) button.disabled = true;
      try {
        const resolved = await window.TragoClientResolveAddress?.(address);
        const lat = Number(resolved?.lat);
        const lng = Number(resolved?.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          throw new Error('Não foi possível confirmar esta paragem. Marque-a directamente no mapa.');
        }
        window.TragoClientAddCargoStop?.({
          address: resolved.label || address,
          lat,
          lng,
          source: 'map'
        });
        input.value = '';
      } catch (error) {
        toast(error.message || 'Marque a paragem directamente no mapa.', 'error');
      } finally {
        if (button) button.disabled = false;
      }
    });
    $('#cargo-stops-list')?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-remove-cargo-stop]');
      if (!button) return;
      cargoStops.splice(Number(button.dataset.removeCargoStop), 1);
      renderStops();
      window.TragoClientRefreshDeliveryQuote?.();
    });
    $$('[data-cargo-schedule]').forEach((button) => button.addEventListener('click', () => {
      const later = button.dataset.cargoSchedule === 'later';
      $$('[data-cargo-schedule]').forEach((item) => item.classList.toggle('active', item === button));
      $('#cargo-schedule-field')?.classList.toggle('hidden', !later);
      if ($('#cargo-scheduled-at')) $('#cargo-scheduled-at').required = later;
    }));
    const minimum = new Date(Date.now() + 15 * 60 * 1000);
    const minValue = new Date(minimum.getTime() - minimum.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    if ($('#cargo-scheduled-at')) $('#cargo-scheduled-at').min = minValue;
  }

  window.TragoClientCargoStops = () => cargoStops.map((stop) => ({ ...stop }));

  function initCartVisuals() {
    const desktopCount = $('#cart-count-desktop');
    const sync = () => { if ($('#cart-count-mobile')) $('#cart-count-mobile').textContent = desktopCount?.textContent || '0'; };
    if (desktopCount) new MutationObserver(sync).observe(desktopCount, { childList: true, subtree: true });
    sync();
    $$('.v20-payment-methods [data-payment]').forEach((button) => button.addEventListener('click', () => {
      $$('.v20-payment-methods [data-payment]').forEach((item) => item.classList.toggle('active', item === button));
      const select = $('#food-payment-method');
      const map = { transfer: 'bank_transfer' };
      if (select) select.value = map[button.dataset.payment] || button.dataset.payment;
    }));
    $$('.v20-schedule [data-cart-schedule]').forEach((button) => button.addEventListener('click', () => {
      $$('.v20-schedule [data-cart-schedule]').forEach((item) => item.classList.toggle('active', item === button));
      const later = button.dataset.cartSchedule === 'later';
      $('#food-schedule-field')?.classList.toggle('hidden', !later);
      if ($('#food-scheduled-at')) $('#food-scheduled-at').required = later;
    }));
    const minimum = new Date(Date.now() + 15 * 60 * 1000);
    const minValue = new Date(minimum.getTime() - minimum.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    if ($('#food-scheduled-at')) $('#food-scheduled-at').min = minValue;
  }

  function readFavorites() {
    try { return JSON.parse(localStorage.getItem(storageKey(FAVORITES_KEY)) || '[]'); } catch { return []; }
  }

  async function loadRemoteFavorites() {
    if (!readSession()?.token) return;
    try {
      const data = await clientApi('/api/client/favorites');
      favoriteRecords.clear();
      (data.favorites || []).forEach((favorite) => favoriteRecords.set(String(favorite.entity_id), String(favorite.id)));
      localStorage.setItem(storageKey(FAVORITES_KEY), JSON.stringify([...favoriteRecords.keys()]));
      enhanceFoodCards();
      $$('[data-favorite-id]').forEach((button) => {
        const active = favoriteRecords.has(String(button.dataset.favoriteId));
        button.innerHTML = `<i class="${active ? 'fa-solid' : 'fa-regular'} fa-heart"></i>`;
        button.classList.toggle('active', active);
      });
      document.dispatchEvent(new CustomEvent('trago:favorites-changed'));
    } catch (_error) { /* a cache local continua disponível */ }
  }

  function enhanceFoodCards() {
    $$('.food-card').forEach((card) => {
      if ($('.v20-favorite-button', card)) return;
      const id = card.dataset.openDish || '';
      const active = readFavorites().includes(id);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `v20-favorite-button${active ? ' active' : ''}`;
      button.dataset.favoriteId = id;
      button.dataset.favoriteType = 'product';
      button.setAttribute('aria-label', active ? 'Remover dos favoritos' : 'Guardar nos favoritos');
      button.innerHTML = `<i class="${active ? 'fa-solid' : 'fa-regular'} fa-heart"></i>`;
      $('.food-image', card)?.append(button);
    });
  }

  function initDynamicEnhancements() {
    const observer = new MutationObserver(() => {
      enhanceFoodCards();
    });
    ['#new-dishes-grid', '#favorite-dishes-grid', '#restaurants-container', '#restaurant-profile-content', '#dish-detail-content'].forEach((selector) => {
      const node = $(selector);
      if (node) observer.observe(node, { childList: true, subtree: true });
    });
    enhanceFoodCards();
    document.addEventListener('click', async (event) => {
      const favorite = event.target.closest('[data-favorite-id]');
      if (!favorite) return;
      event.stopPropagation();
      const id = favorite.dataset.favoriteId;
      const entityType = favorite.dataset.favoriteType === 'restaurant' ? 'restaurant' : 'product';
      let values = readFavorites();
      const removing = values.includes(id);
      try {
        if (readSession()?.token) {
          if (removing) {
            const recordId = favoriteRecords.get(String(id));
            if (recordId) await clientApi(`/api/client/favorites/${encodeURIComponent(recordId)}`, { method: 'DELETE' });
            favoriteRecords.delete(String(id));
          } else {
            const data = await clientApi('/api/client/favorites', { method: 'POST', body: { entity_type: entityType, entity_id: id } });
            favoriteRecords.set(String(id), String(data.favorite?.id || ''));
          }
        }
        values = removing ? values.filter((item) => item !== id) : [...values, id];
        localStorage.setItem(storageKey(FAVORITES_KEY), JSON.stringify(values));
      } catch (error) {
        toast(error.message, 'error');
        return;
      }
      favorite.innerHTML = `<i class="${values.includes(id) ? 'fa-solid' : 'fa-regular'} fa-heart"></i>`;
      favorite.classList.toggle('active', values.includes(id));
      favorite.setAttribute('aria-label', values.includes(id)
        ? (entityType === 'restaurant' ? 'Remover restaurante dos favoritos' : 'Remover dos favoritos')
        : (entityType === 'restaurant' ? 'Guardar restaurante nos favoritos' : 'Guardar nos favoritos'));
      document.dispatchEvent(new CustomEvent('trago:favorites-changed'));
      toast(values.includes(id) ? 'Adicionado aos favoritos.' : 'Removido dos favoritos.');
    });
    loadRemoteFavorites();
  }

  async function loadClientBenefits(silent = false) {
    const session = readSession();
    const panel = $('#client-benefits-content');
    if (!session?.token) {
      if (panel) panel.innerHTML = '<div class="v20-empty compact"><i class="fa-solid fa-lock"></i><h2>Entre na sua conta</h2><p>A carteira, os pontos e os cupões estão ligados à sua conta TraGo.</p><button class="v20-primary" type="button" data-open-client-auth>Entrar ou registar</button></div>';
      return null;
    }
    try {
      const data = await clientApi('/api/client/benefits');
      const balance = Number(data.wallet_balance_cents || 0) / 100;
      $$('[data-client-wallet-balance]').forEach((node) => { node.textContent = `${balance.toFixed(2)} MZN`; });
      $$('[data-client-loyalty-points]').forEach((node) => { node.textContent = String(data.loyalty_points || 0); });
      $$('[data-client-referral-code]').forEach((node) => {
        node.textContent = data.referral_code || '—';
        if (data.referral_code) node.dataset.copy = data.referral_code;
      });
      if (panel) {
        const coupons = Array.isArray(data.coupons) ? data.coupons : [];
        const transactions = Array.isArray(data.wallet_transactions) ? data.wallet_transactions : [];
        panel.innerHTML = `<div class="v20-benefit-summary"><article><i class="fa-solid fa-wallet"></i><span><small>SALDO TRAGO</small><strong>${balance.toFixed(2)} MZN</strong></span></article><article><i class="fa-solid fa-star"></i><span><small>PONTOS</small><strong>${Number(data.loyalty_points || 0)}</strong></span></article></div>
          <section class="v20-benefit-list"><header><small>CUPÕES ACTIVOS</small><h2>Descontos disponíveis</h2></header>${coupons.length ? coupons.map((coupon) => `<article><b>${String(coupon.code || '').replace(/[<>&"]/g, '')}</b><span><strong>${String(coupon.name || 'Cupão TraGo').replace(/[<>&"]/g, '')}</strong><small>${String(coupon.description || 'Consulte as condições no checkout.').replace(/[<>&"]/g, '')}</small></span></article>`).join('') : '<div class="empty-state">Não existem cupões activos neste momento.</div>'}</section>
          <section class="v20-benefit-list"><header><small>MOVIMENTOS</small><h2>Carteira</h2></header>${transactions.length ? transactions.slice(0, 20).map((entry) => `<article><b>${entry.direction === 'credit' ? '+' : '−'}${(Number(entry.amount_cents || 0) / 100).toFixed(2)}</b><span><strong>${String(entry.description || entry.type || 'Movimento').replace(/[<>&"]/g, '')}</strong><small>${new Date(entry.created_at).toLocaleString('pt-MZ')}</small></span></article>`).join('') : '<div class="empty-state">Ainda não existem movimentos na carteira.</div>'}</section>`;
      }
      return data;
    } catch (error) {
      if (!silent) toast(error.message, 'error');
      return null;
    }
  }

  function initSmallInteractions() {
    let preferences = readSession()?.preferences || {};
    if (!Object.keys(preferences).length) {
      try { preferences = JSON.parse(localStorage.getItem(PREFERENCES_KEY) || '{}'); } catch { preferences = {}; }
    }
    const preferenceMap = { orderNotifications: 'orders', promotions: 'promotions', preciseLocation: 'preciseLocation' };
    $$('[data-client-pref]').forEach((input) => {
      const serverKey = preferenceMap[input.dataset.clientPref] || input.dataset.clientPref;
      if (Object.prototype.hasOwnProperty.call(preferences, serverKey)) input.checked = preferences[serverKey] === true;
      input.addEventListener('change', async () => {
        preferences[serverKey] = input.checked;
        localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
        const session = readSession();
        if (!session?.token) {
          toast('Preferência guardada neste dispositivo.');
          return;
        }
        try {
          const result = await clientApi('/api/client/preferences', { method: 'PUT', body: { preferences, language: session.language || 'pt' } });
          storeSession({ ...session, notification_preferences: result.preferences, language: result.language });
          toast('Preferência sincronizada.');
        } catch (error) {
          toast(error.message, 'error');
        }
      });
    });
    $$('[data-copy]').forEach((button) => button.addEventListener('click', async () => {
      const value = button.dataset.copy;
      try { await navigator.clipboard.writeText(value); } catch { /* fallback visual */ }
      toast(`Código ${value} copiado.`);
    }));
    $$('[data-view="profile"]').forEach((button) => button.addEventListener('click', openProfile));
    $$('[data-jump-panel="coupons"]').forEach((button) => button.addEventListener('click', () => loadClientBenefits()));
    $('[data-refresh-benefits]')?.addEventListener('click', () => loadClientBenefits());
    $('[data-change-client-password]')?.addEventListener('click', async () => {
      if (!readSession()?.token) return openSheet('client-auth-sheet');
      const currentPassword = window.TragoFeedback
        ? await window.TragoFeedback.prompt({
          title: 'Palavra-passe actual',
          message: 'Confirme a sua identidade antes de definir uma nova palavra-passe.',
          label: 'Palavra-passe actual',
          inputType: 'password',
          confirmText: 'Continuar'
        })
        : null;
      if (currentPassword === null) return;
      const newPassword = window.TragoFeedback
        ? await window.TragoFeedback.prompt({
          title: 'Nova palavra-passe',
          message: 'Use pelo menos 8 caracteres e evite palavras-passe já utilizadas.',
          label: 'Nova palavra-passe',
          inputType: 'password',
          confirmText: 'Definir',
          validate: (value) => String(value).length < 8 ? 'Use pelo menos 8 caracteres.' : ''
        })
        : null;
      if (newPassword === null) return;
      const confirmation = window.TragoFeedback
        ? await window.TragoFeedback.prompt({
          title: 'Confirmar palavra-passe',
          message: 'Repita exactamente a nova palavra-passe.',
          label: 'Confirmação',
          inputType: 'password',
          confirmText: 'Actualizar'
        })
        : null;
      if (newPassword !== confirmation) return toast('A confirmação da nova palavra-passe não coincide.', 'error');
      try {
        const result = await clientApi('/api/client/password', {
          method: 'PUT',
          body: { current_password: currentPassword, new_password: newPassword }
        });
        if (result.token) storeSession(readSession(), result.token);
        toast('Palavra-passe actualizada com segurança.');
      } catch (error) { toast(error.message, 'error'); }
    });
    $('[data-delete-client-account]')?.addEventListener('click', async () => {
      if (!readSession()?.token) return openSheet('client-auth-sheet');
      const confirmed = window.TragoFeedback
        ? await window.TragoFeedback.confirm({
          type: 'warning',
          kicker: 'CONTA',
          title: 'Desactivar a sua conta?',
          message: 'O acesso será removido. Os registos legais dos pedidos serão preservados.',
          confirmText: 'Desactivar conta',
          cancelText: 'Manter conta'
        })
        : false;
      if (!confirmed) return;
      const password = window.TragoFeedback
        ? await window.TragoFeedback.prompt({
          type: 'warning',
          title: 'Confirmar identidade',
          message: 'Introduza a sua palavra-passe para concluir a desactivação.',
          label: 'Palavra-passe',
          inputType: 'password',
          confirmText: 'Confirmar'
        })
        : null;
      if (password === null) return;
      try {
        await clientApi('/api/client/me', { method: 'DELETE', body: { password } });
        localStorage.removeItem(SESSION_KEY);
        window.TragoClientRefreshSession?.();
        syncProfile();
        window.TragoClientOpenPanel?.('home');
        toast('Conta desactivada.');
      } catch (error) { toast(error.message, 'error'); }
    });
    document.addEventListener('click', (event) => {
      if (event.target.closest('[data-open-client-auth]')) openSheet('client-auth-sheet');
    });
    $$('[data-wishlist-tab]').forEach((button) => button.addEventListener('click', () => {
      $$('[data-wishlist-tab]').forEach((item) => item.classList.toggle('active', item === button));
      window.TragoClientRenderWishlist?.();
    }));
    $$('[data-order-tab]').forEach((button) => button.addEventListener('click', () => {
      $$('[data-order-tab]').forEach((item) => item.classList.toggle('active', item === button));
      $('.v20-active-order')?.classList.toggle('hidden', button.dataset.orderTab !== 'active');
      window.TragoClientFilterOrders?.(button.dataset.orderTab || 'active');
    }));
    $$('[data-directory-quick]').forEach((button) => button.addEventListener('click', () => {
      const selected = button.dataset.directoryQuick || 'all';
      window.TragoClientSetDirectoryQuick?.(selected === 'all' ? [] : [selected]);
    }));
    $('#btn-apply-directory-filters')?.addEventListener('click', () => {
      const filters = $$('[data-directory-filter]:checked').map((input) => input.dataset.directoryFilter);
      window.TragoClientApplyDirectoryFilters?.({
        filters,
        minRating: Number($('[data-directory-rating]')?.value || 0),
        sort: $('[data-directory-sort]')?.value || 'recommended'
      });
      closeSheet('directory-filter-sheet');
      toast('Filtros aplicados.');
    });
    $('[data-share-trago]')?.addEventListener('click', async () => {
      const share = { title: 'TraGo Delivery', text: 'Conheça a TraGo Delivery.', url: location.href.split('#')[0] };
      try {
        if (navigator.share) await navigator.share(share);
        else {
          await navigator.clipboard.writeText(share.url);
          toast('Ligação da TraGo copiada.');
        }
      } catch (error) {
        if (error?.name !== 'AbortError') toast('Não foi possível partilhar neste navegador.', 'error');
      }
    });
    $('#btn-client-logout-account')?.addEventListener('click', () => {
      localStorage.removeItem(SESSION_KEY);
      window.TragoClientRefreshSession?.();
      syncProfile();
      window.TragoClientAddresses?.refresh?.();
    });
    loadClientBenefits(true);
  }

  function initOrderDetailInteractions() {
    $('#client-driver-chat-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const input = event.currentTarget.elements.message;
      const message = String(input.value || '').trim();
      if (!message) return;
      if (!activeOrderEntry?.access_token && !readSession()?.token) return toast('Entre na conta usada no pedido para enviar a mensagem.', 'error');
      const button = event.currentTarget.querySelector('button[type="submit"]');
      button.disabled = true;
      const originalMarkup = button.innerHTML;
      button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
      try {
        await orderApi(`/api/public/orders/${encodeURIComponent(activeOrderEntry.id)}/messages`, activeOrderEntry, { method: 'POST', body: JSON.stringify({ message }) });
        input.value = '';
        await refreshOrderConversation(true);
        input.focus();
        toast('Mensagem enviada ao motorista.');
      } catch (error) { toast(error.message, 'error'); }
      finally {
        button.disabled = false;
        button.innerHTML = originalMarkup;
      }
    });

    $('[data-upload-proof]')?.addEventListener('click', async () => {
      const order = activeOrderContext?.order;
      if (!order?.delivery_proof_available && !order?.delivery_proof_url) {
        return toast('O motorista ainda não anexou um comprovativo.');
      }
      const proofWindow = window.open('about:blank', '_blank');
      if (proofWindow) proofWindow.opener = null;
      try {
        const data = await orderApi(`/api/public/orders/${encodeURIComponent(activeOrderEntry.id)}/delivery-proof`, activeOrderEntry);
        if (!data.url) throw new Error('Comprovativo indisponível.');
        if (proofWindow) proofWindow.location.href = data.url;
        else window.open(data.url, '_blank', 'noopener,noreferrer');
      } catch (error) {
        proofWindow?.close();
        toast(error.message, 'error');
      }
    });

    $('[data-view-receipt]')?.addEventListener('click', () => {
      const order = activeOrderContext?.order;
      if (!order) return toast('Abra primeiro o acompanhamento do pedido.', 'error');
      const receipt = window.open('', '_blank', 'noopener,noreferrer');
      if (!receipt) return toast('Permita a abertura da janela para ver o recibo.', 'error');
      const safe = (value) => String(value ?? '—').replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char]));
      receipt.document.write(`<title>Recibo TraGo</title><style>body{font:16px Arial;max-width:620px;margin:40px auto;color:#141914}h1{color:#62b52b}dl{display:grid;grid-template-columns:180px 1fr;gap:12px}dt{font-weight:700}hr{border:0;border-top:1px solid #ddd}</style><h1>TraGo · Resumo do pedido</h1><p>#${safe(String(order.id || order._id).slice(-6).toUpperCase())}</p><hr><dl><dt>Cliente</dt><dd>${safe(order.client_name)}</dd><dt>Estado</dt><dd>${safe(order.status)}</dd><dt>Recolha</dt><dd>${safe(order.pickup_address_text)}</dd><dt>Entrega</dt><dd>${safe(order.address_text)}</dd><dt>Serviço</dt><dd>${safe(Number(order.service_price || 0).toFixed(2))} MZN</dd><dt>Taxa de entrega</dt><dd>${safe(Number(order.delivery_fee || 0).toFixed(2))} MZN</dd><dt>Total</dt><dd><strong>${safe(Number(order.price || 0).toFixed(2))} MZN</strong></dd></dl><p><button onclick="print()">Imprimir</button></p>`);
      receipt.document.close();
    });

    $('[data-cancel-active-order]')?.addEventListener('click', async () => {
      const confirmed = window.TragoFeedback
        ? await window.TragoFeedback.confirm({
          type: 'warning',
          kicker: 'PEDIDO ACTIVO',
          title: 'Cancelar este pedido?',
          message: 'A possibilidade de cancelamento depende do estado da preparação e da deslocação do motorista.',
          confirmText: 'Pedir cancelamento',
          cancelText: 'Manter pedido'
        })
        : false;
      if (!confirmed) return;
      if (!activeOrderEntry?.access_token && !readSession()?.token) return toast('Entre na conta usada no pedido para o cancelar.', 'error');
      const button = document.querySelector('[data-cancel-active-order]');
      const originalMarkup = button?.innerHTML || '';
      if (button) {
        button.disabled = true;
        button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> A cancelar';
      }
      try {
        await orderApi(`/api/public/orders/${encodeURIComponent(activeOrderEntry.id)}/cancel`, activeOrderEntry, { method: 'POST', body: JSON.stringify({ reason: 'Cancelado pelo cliente na aplicação' }) });
        activeOrderEntry.status = 'cancelado';
        await refreshOrderConversation(true);
        toast('Pedido cancelado. Restaurante, motorista e Administração foram informados.');
      } catch (error) { toast(error.message, 'error'); }
      finally {
        if (button?.isConnected) {
          button.disabled = false;
          button.innerHTML = originalMarkup;
        }
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    initOnboarding();
    syncProfile();
    renderAssignedDriver();
    initBanners();
    initSheets();
    initAuth();
    initProfile();
    bindHomeSearch();
    initCargo();
    initCartVisuals();
    initDynamicEnhancements();
    initSmallInteractions();
    initOrderDetailInteractions();
    syncActiveOrderShell();
    refreshActiveOrderTracking();
    setInterval(refreshActiveOrderTracking, 7000);
  });
  window.addEventListener('pagehide', () => disconnectOrderRealtime());
})();
