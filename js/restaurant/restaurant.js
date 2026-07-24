/* Trago Delivery · Portal Restaurante */
(() => {
  const TOKEN_KEY = 'tragoRestaurantToken';
  const PROFILE_KEY = 'tragoRestaurantProfile';
  const currency = new Intl.NumberFormat('pt-MZ', { style: 'currency', currency: 'MZN' });
  const state = { token: null, profile: null, menu: [], orders: [], editingId: null, activePanel: 'overview', activeOrderId: null, chatTimer: null, orderFilter: 'new' };
  let panelNavigation = null;
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));
  const money = (value) => currency.format(Number(value || 0));
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));

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

  function headers(json = true) {
    return {
      ...(json ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${state.token}`
    };
  }

  async function api(path, options = {}) {
    const response = await fetch(`${API_URL}${path}`, options);
    const data = await readJsonResponse(response);
    if (response.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(PROFILE_KEY);
      window.location.replace('login-restaurante.html');
      return null;
    }
    if (!response.ok) throw new Error(data.message || 'Erro de comunicação com o servidor.');
    return data;
  }

  function initSession() {
    state.token = localStorage.getItem(TOKEN_KEY);
    try { state.profile = JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null'); } catch { state.profile = null; }
    if (!state.token) {
      window.location.replace('login-restaurante.html');
      return false;
    }
    updateProfileUI();
    return true;
  }

  function updateProfileUI() {
    const p = state.profile || {};
    const initial = String(p.name || 'R').trim().charAt(0).toUpperCase() || 'R';
    $$('#restaurant-name-label').forEach((el) => { el.textContent = p.name || 'Restaurante'; });
    $$('#restaurant-avatar-label, #restaurant-preview-avatar').forEach((el) => { el.textContent = initial; });
    $('#restaurant-preview-name') && ($('#restaurant-preview-name').textContent = p.name || 'Restaurante');
    $('#restaurant-preview-phone') && ($('#restaurant-preview-phone').textContent = p.phone || 'Por configurar');
    $('#restaurant-preview-address') && ($('#restaurant-preview-address').textContent = p.address_text || 'Por configurar');
    $('#profile-name') && ($('#profile-name').value = p.name || '');
    $('#profile-phone') && ($('#profile-phone').value = p.phone || '');
    $('#profile-email') && ($('#profile-email').value = p.email || '');
    $('#profile-whatsapp') && ($('#profile-whatsapp').value = p.whatsapp || '');
    $('#profile-description') && ($('#profile-description').value = p.description || '');
    $('#profile-business-type') && ($('#profile-business-type').value = p.business_type === 'bottle_store' ? 'Bottle Store' : 'Restaurante');
    $('#profile-delivery-zones') && ($('#profile-delivery-zones').value = (p.delivery_zones || []).join(', '));
    $('#profile-radius') && ($('#profile-radius').value = Number(p.delivery_radius_km || 0));
    $('#profile-fee') && ($('#profile-fee').value = Number(p.delivery_fee || 0));
    $('#profile-min-order') && ($('#profile-min-order').value = Number(p.min_order_amount || 0));
    $('#profile-is-open') && ($('#profile-is-open').checked = p.is_open !== false);
    $('#profile-address') && ($('#profile-address').value = p.address_text || '');
    $('#profile-logo') && ($('#profile-logo').value = p.logo_url || '');
    $('#profile-cover') && ($('#profile-cover').value = p.cover_url || '');
    $('#profile-lat') && ($('#profile-lat').value = p.address_coords?.lat || '');
    $('#profile-lng') && ($('#profile-lng').value = p.address_coords?.lng || '');
    $('#restaurant-operational-note') && ($('#restaurant-operational-note').value = p.operational_note || '');
    $('#restaurant-note-count') && ($('#restaurant-note-count').textContent = String((p.operational_note || '').length));
    $('#restaurant-open-toggle') && ($('#restaurant-open-toggle').checked = p.is_open !== false);
    $$('[data-restaurant-public-state]').forEach((el) => { el.textContent = p.is_open === false ? 'FECHADO' : 'ABERTO'; });
    try {
      const opening = typeof p.opening_hours === 'string' ? JSON.parse(p.opening_hours || '{}') : (p.opening_hours || {});
      const keys = ['weekdays', 'saturday', 'sunday'];
      $$('.v20-opening-hours > div').forEach((row, index) => {
        const value = opening[keys[index]];
        if (!value) return;
        const times = $$('input[type="time"]', row);
        if (times[0]) times[0].value = value.open || '';
        if (times[1]) times[1].value = value.close || '';
        const enabled = $('input[type="checkbox"]', row);
        if (enabled) enabled.checked = value.enabled !== false;
      });
    } catch (_error) { /* mantém os horários padrão se os dados antigos forem texto livre */ }
    const hero = $('.portal-hero');
    if (hero && p.cover_url) hero.style.backgroundImage = `linear-gradient(90deg, rgba(10,20,10,.86), rgba(10,20,10,.16)), url('${p.cover_url.replace(/'/g, '%27')}')`;
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(PROFILE_KEY);
    window.location.replace('login-restaurante.html');
  }

  function renderPanel(panel) {
    state.activePanel = panel;
    document.body.dataset.restaurantPanel = panel;
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
    $$('.mobile-bottom-nav button').forEach((btn) => {
      const active = btn.dataset.panel === panel;
      btn.classList.toggle('active', active);
      if (active) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
    });
    if (panel === 'orders') loadOrders();
    if (panel === 'reviews') loadPublicRestaurantSummary();
  }

  function setPanel(panel, options = {}) {
    if (panelNavigation) return panelNavigation.navigate(panel, options);
    renderPanel(panel);
    return panel;
  }

  function initPanelNavigation() {
    window.TragoRestaurantOpenPanel = setPanel;
    if (!window.TragoNavigation) {
      renderPanel('overview');
      return;
    }
    panelNavigation = window.TragoNavigation.create({
      role: 'restaurant',
      scope: state.profile?.id || state.profile?._id || 'anonymous',
      pages: ['overview', 'orders', 'menu', 'profile', 'communication', 'reviews'],
      defaultPage: 'overview',
      getCurrent: () => state.activePanel,
      render: renderPanel
    });
    panelNavigation.restore();
  }

  async function loadProfile() {
    const data = await api('/api/restaurant/profile', { headers: headers(false) });
    if (!data) return;
    state.profile = data.restaurant;
    localStorage.setItem(PROFILE_KEY, JSON.stringify(state.profile));
    updateProfileUI();
  }

  async function loadPublicRestaurantSummary() {
    try {
      const response = await fetch(`${API_URL}/api/public/restaurants`);
      const data = await readJsonResponse(response);
      if (!response.ok) throw new Error(data.message || 'Falha ao carregar reputação pública.');
      const profileId = String(state.profile?.id || state.profile?._id || '');
      const restaurant = (data.restaurants || []).find((item) => String(item.id || item._id) === profileId);
      const menu = restaurant?.menuItems || [];
      const average = Number(restaurant?.average_rating || 0);
      const count = Number(restaurant?.rating_count || 0);
      const prepValues = menu.map((item) => Number(item.prep_time_min || 0)).filter((value) => value > 0);
      const prep = prepValues.length ? Math.round(prepValues.reduce((sum, value) => sum + value, 0) / prepValues.length) : 0;
      $('#metric-rating') && ($('#metric-rating').textContent = count ? average.toFixed(1) : '—');
      $('#metric-rating-count') && ($('#metric-rating-count').textContent = count ? `${count} avaliação(ões)` : 'Sem avaliações');
      $('#restaurant-rating-average') && ($('#restaurant-rating-average').textContent = count ? average.toFixed(1) : '—');
      $('#restaurant-rating-total') && ($('#restaurant-rating-total').textContent = count ? `${count} avaliação(ões) verificadas` : 'Sem avaliações verificadas');
      $('#metric-prep-time') && ($('#metric-prep-time').textContent = prep ? `${prep} min` : '—');
      $$('[data-restaurant-public-rating]').forEach((node) => { node.textContent = count ? average.toFixed(1) : '—'; });
      $$('[data-restaurant-public-prep]').forEach((node) => { node.textContent = prep ? `${prep} min` : '—'; });
      const productList = $('#restaurant-product-ratings');
      if (productList) {
        const rated = menu.filter((item) => Number(item.rating_count || 0) > 0).sort((a, b) => Number(b.average_rating || 0) - Number(a.average_rating || 0));
        productList.innerHTML = rated.length ? rated.map((item) => `<article><span class="v20-product-placeholder"><i class="fa-solid fa-bowl-food"></i></span><div><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.category || 'Geral')} · ${Number(item.rating_count || 0)} avaliação(ões)</small></div><b>${Number(item.average_rating || 0).toFixed(1)} <i class="fa-solid fa-star"></i></b></article>`).join('') : '<div class="empty-state">Os produtos ainda não receberam avaliações.</div>';
      }
    } catch (_error) {
      const productList = $('#restaurant-product-ratings');
      if (productList) productList.innerHTML = '<div class="empty-state">Não foi possível carregar as avaliações neste momento.</div>';
    }
  }

  async function updateProfile(event) {
    event.preventDefault();
    const btn = event.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> A guardar...';
    try {
      const openingHours = {};
      $$('.v20-opening-hours > div').forEach((row, index) => {
        const times = $$('input[type="time"]', row);
        const enabled = $('input[type="checkbox"]', row)?.checked !== false;
        openingHours[index === 0 ? 'weekdays' : index === 1 ? 'saturday' : 'sunday'] = {
          enabled,
          open: times[0]?.value || '',
          close: times[1]?.value || ''
        };
      });
      const data = await api('/api/restaurant/profile', {
        method: 'PUT',
        headers: headers(),
        body: JSON.stringify({
          name: $('#profile-name')?.value,
          phone: $('#profile-phone')?.value,
          whatsapp: $('#profile-whatsapp')?.value,
          description: $('#profile-description')?.value,
          business_type: $('#profile-business-type')?.value,
          address_text: $('#profile-address')?.value,
          logo_url: $('#profile-logo')?.value,
          cover_url: $('#profile-cover')?.value,
          opening_hours: openingHours,
          delivery_zones: String($('#profile-delivery-zones')?.value || '').split(',').map((value) => value.trim()).filter(Boolean),
          delivery_radius_km: Number($('#profile-radius')?.value || 0),
          delivery_fee: Number($('#profile-fee')?.value || 0),
          min_order_amount: Number($('#profile-min-order')?.value || 0),
          is_open: $('#profile-is-open')?.checked !== false,
          address_coords: ($('#profile-lat')?.value && $('#profile-lng')?.value) ? {
            lat: Number($('#profile-lat').value),
            lng: Number($('#profile-lng').value)
          } : null
        })
      });
      state.profile = data.restaurant;
      localStorage.setItem(PROFILE_KEY, JSON.stringify(state.profile));
      updateProfileUI();
      toast('Perfil do restaurante actualizado.');
    } catch (error) { toast(error.message, 'error'); }
    finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-save"></i> Guardar perfil';
    }
  }

  async function saveRestaurantOperation(patch, successMessage = '') {
    try {
      const data = await api('/api/restaurant/profile', { method: 'PUT', headers: headers(), body: JSON.stringify(patch) });
      if (!data) return;
      state.profile = data.restaurant;
      localStorage.setItem(PROFILE_KEY, JSON.stringify(state.profile));
      updateProfileUI();
      if (successMessage) toast(successMessage);
    } catch (error) { toast(error.message, 'error'); }
  }

  async function loadMenu() {
    const list = $('#restaurant-menu-list');
    if (list) list.innerHTML = '<div class="trago-skeleton-grid" aria-label="A carregar menu"><div class="trago-skeleton-card"></div><div class="trago-skeleton-card"></div><div class="trago-skeleton-card"></div></div>';
    try {
      const data = await api('/api/restaurant/menu', { headers: headers(false) });
      state.menu = data?.items || [];
      renderMenu();
    } catch (error) {
      if (list) list.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    }
  }

  function renderMenu() {
    const list = $('#restaurant-menu-list');
    const totalItems = $('#metric-menu-items');
    if (totalItems) totalItems.textContent = state.menu.length;
    if (!list) return;
    if (!state.menu.length) {
      list.innerHTML = '<div class="empty-state">Ainda não adicionou comidas. Use o formulário para publicar o primeiro item.</div>';
      return;
    }
    const groups = state.menu.reduce((acc, item) => {
      const key = item.category || 'Geral';
      if (!acc[key]) acc[key] = [];
      acc[key].push(item);
      return acc;
    }, {});
    list.innerHTML = Object.entries(groups).map(([category, items]) => `
      <div class="restaurant-group">
        <div class="category-strip"><span class="category-chip">${escapeHtml(category)}</span></div>
        <div class="menu-list">
          ${items.map((item) => `
            <article class="menu-admin-item" data-menu-item-id="${escapeHtml(item.id)}" data-menu-available="${item.available !== false ? 'true' : 'false'}">
              <img src="${escapeHtml(item.image_url || '')}" alt="" loading="lazy" decoding="async" onerror="this.style.display='none'">
              <div>
                <h4>${escapeHtml(item.name)} ${item.available ? '' : '<span class="status-pill">Indisponível</span>'}</h4>
                <p>${money(item.price)} · ${escapeHtml(item.description || 'Sem descrição')}</p>
              </div>
              <div class="inline-actions">
                <button class="portal-btn secondary" type="button" data-edit-item="${escapeHtml(item.id)}"><i class="fas fa-edit"></i> Editar</button>
                <button class="portal-btn danger" type="button" data-delete-item="${escapeHtml(item.id)}"><i class="fas fa-trash"></i></button>
              </div>
            </article>
          `).join('')}
        </div>
      </div>
    `).join('');
  }

  function resetMenuForm() {
    state.editingId = null;
    $('#menu-form')?.reset();
    $('#menu-item-id').value = '';
    $('#menu-available').checked = true;
    window.TragoRestaurantRenderOptions?.([]);
    $('#menu-submit-label').textContent = 'Adicionar comida';
    $('#btn-cancel-menu-edit')?.classList.add('hidden');
  }

  function editMenuItem(id) {
    const item = state.menu.find((entry) => entry.id === id || entry._id === id);
    if (!item) return;
    state.editingId = item.id;
    $('#menu-item-id').value = item.id;
    $('#menu-name').value = item.name || '';
    $('#menu-category').value = item.category || '';
    $('#menu-price').value = Number(item.price || 0);
    $('#menu-image').value = item.image_url || '';
    $('#menu-prep-time').value = item.prep_time_min || '';
    $('#menu-description').value = item.description || '';
    $('#menu-daily-stock').value = item.stock?.quantity ?? '';
    $('#menu-ingredients').value = item.ingredients || '';
    $('#menu-details').value = item.details || '';
    $('#menu-tags').value = (item.tags || []).join(', ');
    $('#menu-auto-disable').checked = item.stock?.auto_disable === true;
    $('#menu-unavailable-reason').value = item.stock?.unavailable_reason || item.unavailable_reason || '';
    window.TragoRestaurantRenderOptions?.(item.options || []);
    $('#menu-available').checked = item.available !== false;
    $('#menu-submit-label').textContent = 'Guardar alterações';
    $('#btn-cancel-menu-edit')?.classList.remove('hidden');
    window.scrollTo({ top: 180, behavior: 'smooth' });
  }

  async function saveMenuItem(event) {
    event.preventDefault();
    const btn = event.target.querySelector('button[type="submit"]');
    const payload = {
      name: $('#menu-name')?.value,
      category: $('#menu-category')?.value || 'Geral',
      price: Number($('#menu-price')?.value || 0),
      image_url: $('#menu-image')?.value || '',
      prep_time_min: Number($('#menu-prep-time')?.value || 0) || null,
      description: $('#menu-description')?.value || '',
      daily_stock: $('#menu-daily-stock')?.value === '' ? null : Number($('#menu-daily-stock')?.value || 0),
      ingredients: $('#menu-ingredients')?.value || '',
      details: $('#menu-details')?.value || '',
      tags: String($('#menu-tags')?.value || '').split(',').map((value) => value.trim()).filter(Boolean),
      auto_disable: $('#menu-auto-disable')?.checked === true,
      unavailable_reason: $('#menu-unavailable-reason')?.value || '',
      options: window.TragoRestaurantCollectOptions?.() || [],
      available: $('#menu-available')?.checked !== false
    };
    if (!payload.name || !payload.category || payload.price <= 0) {
      toast('Preencha nome, categoria e preço válido.', 'error');
      return;
    }
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> A guardar...';
    try {
      const path = state.editingId ? `/api/restaurant/menu/${state.editingId}` : '/api/restaurant/menu';
      const method = state.editingId ? 'PUT' : 'POST';
      await api(path, { method, headers: headers(), body: JSON.stringify(payload) });
      toast(state.editingId ? 'Comida actualizada.' : 'Comida adicionada ao restaurante.');
      resetMenuForm();
      await loadMenu();
    } catch (error) { toast(error.message, 'error'); }
    finally {
      btn.disabled = false;
      btn.innerHTML = `<i class="fas fa-utensils"></i> <span id="menu-submit-label">${state.editingId ? 'Guardar alterações' : 'Adicionar comida'}</span>`;
    }
  }

  async function deleteMenuItem(id) {
    const confirmed = window.TragoFeedback
      ? await window.TragoFeedback.confirm({
        type: 'warning',
        kicker: 'CATÁLOGO',
        title: 'Eliminar produto?',
        message: 'O produto deixará de aparecer imediatamente no Cliente. Esta acção não pode ser anulada.',
        confirmText: 'Eliminar produto',
        cancelText: 'Manter'
      })
      : false;
    if (!confirmed) return;
    try {
      await api(`/api/restaurant/menu/${id}`, { method: 'DELETE', headers: headers(false) });
      toast('Comida eliminada.');
      await loadMenu();
    } catch (error) { toast(error.message, 'error'); }
  }

  async function setMenuItemAvailability(id, available) {
    const item = state.menu.find((entry) => String(entry.id || entry._id) === String(id));
    if (!item) return;
    try {
      await api(`/api/restaurant/menu/${encodeURIComponent(id)}`, { method: 'PUT', headers: headers(), body: JSON.stringify({ available }) });
      toast(available ? 'Produto disponível no Cliente.' : 'Produto ocultado do Cliente.');
      await loadMenu();
    } catch (error) {
      toast(error.message, 'error');
      await loadMenu();
    }
  }

  async function loadOrders() {
    const list = $('#restaurant-orders-list');
    if (list) list.innerHTML = '<div class="trago-skeleton-grid" aria-label="A carregar pedidos"><div class="trago-skeleton-card"></div><div class="trago-skeleton-card"></div></div>';
    try {
      const data = await api('/api/restaurant/orders', { headers: headers(false) });
      state.orders = data?.orders || [];
      renderOrders();
    } catch (error) {
      if (list) list.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    }
  }

  function renderLegacyOrders() {
    const list = $('#restaurant-orders-list');
    const metricOrders = $('#metric-orders');
    const metricRevenue = $('#metric-revenue');
    if (metricOrders) metricOrders.textContent = state.orders.length;
    if (metricRevenue) metricRevenue.textContent = money(state.orders.reduce((sum, order) => sum + Number(order.service_price || order.price || 0), 0));
    if (!list) return;
    if (!state.orders.length) {
      list.innerHTML = '<div class="empty-state">Ainda não existem pedidos de comida para este restaurante.</div>';
      return;
    }
    list.innerHTML = state.orders.map((order) => `
      <article class="order-card">
        <div class="order-card-head">
          <strong>#${escapeHtml(String(order.id || order._id).slice(-6).toUpperCase())} · ${escapeHtml(order.client_name || 'Cliente')}</strong>
          <span class="status-pill">${escapeHtml(order.status || 'pendente')}</span>
        </div>
        <div class="order-meta"><strong>Contacto:</strong> ${escapeHtml(order.client_phone1 || '—')} · <strong>Total:</strong> ${money(order.service_price || order.price)}</div>
        <div class="order-meta"><strong>Entrega:</strong> ${escapeHtml(order.address_text || '—')}</div>
        <div class="order-meta"><strong>Itens/Notas:</strong> ${escapeHtml(order.pickup_notes || '—')}</div>
        <div class="order-meta"><strong>Código:</strong> ${escapeHtml(order.verification_code || '—')} · ${order.createdAt ? new Date(order.createdAt).toLocaleString('pt-MZ') : ''}</div>
      </article>
    `).join('');
  }

  const restaurantStatusLabels = {
    new: 'Novo', accepted: 'Confirmado', preparing: 'Em preparação', ready: 'Recolha autorizada',
    rejected: 'Cancelado', concluido: 'Concluído', cancelado: 'Cancelado'
  };

  function normalizeRestaurantStatus(order = {}) {
    if (order.pickup_authorized_at || order.pickupAuthorizedAt) return 'ready';
    const explicit = String(order.restaurant_status || order.restaurantStatus || '');
    if (['new', 'accepted', 'preparing', 'ready', 'rejected'].includes(explicit)) return explicit;
    const operationalStatus = String(order.status || '');
    if (operationalStatus === 'cancelado') return 'rejected';
    if (['em_progresso', 'recolha_em_progresso', 'recolha_concluida', 'entrega_em_progresso', 'concluido'].includes(operationalStatus)) return 'ready';
    return 'new';
  }

  function orderActionButtons(order) {
    const id = escapeHtml(order.id || order._id);
    const status = normalizeRestaurantStatus(order);
    if (['concluido', 'cancelado'].includes(order.status)) return `<button type="button" class="v20-secondary-button" data-order-chat="${id}"><i class="fa-regular fa-comments"></i> Ver conversa</button>`;
    const buttons = [];
    if (status === 'new') buttons.push(`<button type="button" class="v20-primary" data-order-action="accept" data-order-id="${id}"><i class="fa-solid fa-check"></i> Confirmar recepção</button>`);
    if (status === 'accepted') buttons.push(`<button type="button" class="v20-primary" data-order-action="prepare" data-order-id="${id}"><i class="fa-solid fa-fire-burner"></i> Marcar Em preparação</button>`);
    if (status === 'preparing') buttons.push(`<button type="button" class="v20-primary" data-order-action="ready" data-order-id="${id}"><i class="fa-solid fa-box-open"></i> Autorizar recolha</button>`);
    if (['new', 'accepted', 'preparing'].includes(status)) buttons.push(`<button type="button" class="v20-danger-outline" data-order-action="cancel" data-order-id="${id}">Cancelar com justificativa</button>`);
    buttons.push(`<button type="button" class="v20-secondary-button" data-order-chat="${id}"><i class="fa-regular fa-comments"></i> Conversa</button>`);
    return buttons.join('');
  }

  function renderOrders() {
    const list = $('#restaurant-orders-list');
    const orderCounts = { new: 0, preparing: 0, ready: 0, done: 0, cancelled: 0 };
    state.orders.forEach((order) => {
      const restaurantStatus = normalizeRestaurantStatus(order);
      if (order.status === 'concluido') orderCounts.done += 1;
      else if (order.status === 'cancelado' || restaurantStatus === 'rejected') orderCounts.cancelled += 1;
      else if (restaurantStatus === 'accepted') orderCounts.preparing += 1;
      else if (Object.hasOwn(orderCounts, restaurantStatus)) orderCounts[restaurantStatus] += 1;
    });
    $$('[data-restaurant-order-count]').forEach((badge) => {
      const count = Number(orderCounts[badge.dataset.restaurantOrderCount] || 0);
      badge.textContent = String(count);
      badge.hidden = count === 0;
    });
    const visible = state.orderFilter === 'all' ? state.orders : state.orders.filter((order) => {
      const restaurantStatus = normalizeRestaurantStatus(order);
      if (state.orderFilter === 'done') return order.status === 'concluido';
      if (state.orderFilter === 'cancelled') return order.status === 'cancelado' || restaurantStatus === 'rejected';
      if (state.orderFilter === 'preparing') return ['accepted', 'preparing'].includes(restaurantStatus);
      return restaurantStatus === state.orderFilter;
    });
    $('#metric-orders') && ($('#metric-orders').textContent = state.orders.filter((order) => !['concluido', 'cancelado'].includes(order.status)).length);
    $('#metric-revenue') && ($('#metric-revenue').textContent = money(state.orders.reduce((sum, order) => sum + Number(order.service_price || order.price || 0), 0)));
    renderRestaurantOperationalInbox();
    if (!list) return;
    if (!visible.length) {
      list.innerHTML = '<div class="empty-state">Não existem pedidos neste estado.</div>';
      return;
    }
    list.innerHTML = visible.map((order) => {
      const restaurantStatus = normalizeRestaurantStatus(order);
      const orderStatus = ['concluido', 'cancelado'].includes(order.status) ? order.status : restaurantStatus;
      return `<article class="order-card restaurant-live-order" data-restaurant-status="${escapeHtml(orderStatus)}">
        <div class="order-card-head"><strong>#${escapeHtml(String(order.id || order._id).slice(-6).toUpperCase())} · ${escapeHtml(order.client_name || 'Cliente')}</strong><span class="status-pill status-${escapeHtml(orderStatus)}">${escapeHtml(restaurantStatusLabels[orderStatus] || orderStatus)}</span></div>
        <div class="restaurant-order-details"><p><strong>Itens e notas</strong><span>${escapeHtml(order.pickup_notes || 'Sem observações')}</span></p><p><strong>Entrega</strong><span>${escapeHtml(order.address_text || '—')}</span></p><p><strong>Contacto</strong><span>${escapeHtml(order.client_phone1 || '—')}</span></p><p><strong>Total</strong><span>${money(order.service_price || order.price)}</span></p></div>
        ${order.assigned_to_driver ? '<p class="restaurant-driver-linked"><i class="fa-solid fa-motorcycle"></i> Motorista atribuído · comunicação activa</p>' : '<p class="restaurant-driver-linked waiting"><i class="fa-regular fa-clock"></i> A aguardar motorista</p>'}
        <div class="v20-backend-order-actions">${orderActionButtons(order)}</div>
      </article>`;
    }).join('');
  }

  function renderRestaurantOperationalInbox() {
    const recent = state.orders.slice(0, 5);
    $('#restaurant-communication-count') && ($('#restaurant-communication-count').textContent = String(recent.length));
    const inbox = $('.v20-message-list');
    if (inbox) {
      inbox.querySelectorAll(':scope > article').forEach((article) => article.remove());
      const html = recent.length ? recent.map((order, index) => {
        const id = order.id || order._id;
        const status = normalizeRestaurantStatus(order);
        return `<article class="${index === 0 ? 'unread' : ''}" data-order-chat="${escapeHtml(id)}" tabindex="0"><span>${escapeHtml(String(order.client_name || 'C').split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase())}</span><div><strong>${escapeHtml(order.client_name || 'Cliente')} · #${escapeHtml(String(id).slice(-6).toUpperCase())}</strong><p>${escapeHtml(restaurantStatusLabels[status] || status)} · ${escapeHtml(order.pickup_notes || 'Abrir conversa do pedido')}</p><small>${order.createdAt ? new Date(order.createdAt).toLocaleString('pt-MZ') : ''}</small></div></article>`;
      }).join('') : '<article><div><strong>Sem conversas operacionais</strong><p>As mensagens dos pedidos aparecerão aqui.</p></div></article>';
      inbox.insertAdjacentHTML('beforeend', html);
    }
    const notifications = $('.v20-notification-list');
    if (notifications) {
      notifications.innerHTML = recent.length ? recent.map((order, index) => {
        const id = order.id || order._id;
        const status = normalizeRestaurantStatus(order);
        return `<article class="${index === 0 ? 'unread' : ''}" data-order-chat="${escapeHtml(id)}"><i class="fa-regular fa-clipboard"></i><span><strong>Pedido #${escapeHtml(String(id).slice(-6).toUpperCase())}</strong><p>${escapeHtml(order.client_name || 'Cliente')} · ${escapeHtml(restaurantStatusLabels[status] || status)}</p><small>${order.createdAt ? new Date(order.createdAt).toLocaleString('pt-MZ') : ''}</small></span></article>`;
      }).join('') : '<div class="empty-state">Sem notificações de pedidos.</div>';
    }
  }

  function renderRestaurantMessages(messages = []) {
    const stream = $('#restaurant-order-chat-stream');
    if (!stream) return;
    if (!messages.length) { stream.innerHTML = '<div class="empty-state">Ainda não existem mensagens neste pedido.</div>'; return; }
    stream.innerHTML = messages.map((message) => {
      const role = message.senderRole || message.sender_role || 'system';
      const date = new Date(message.createdAt || Date.now());
      return `<article class="${role === 'restaurant' ? 'mine' : role === 'system' ? 'system' : ''}"><header><strong>${escapeHtml(message.senderName || message.sender_name || role)}</strong><small>${Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString('pt-MZ', { hour: '2-digit', minute: '2-digit' })}</small></header><p>${escapeHtml(message.body || '')}</p></article>`;
    }).join('');
    stream.scrollTop = stream.scrollHeight;
  }

  async function loadRestaurantMessages(silent = false) {
    if (!state.activeOrderId) return;
    try {
      const data = await api(`/api/restaurant/orders/${state.activeOrderId}/messages`, { headers: headers(false) });
      renderRestaurantMessages(data?.messages || []);
    } catch (error) { if (!silent) toast(error.message, 'error'); }
  }

  async function openRestaurantOrderChat(id) {
    state.activeOrderId = id;
    $('#restaurant-chat-order-code') && ($('#restaurant-chat-order-code').textContent = `PEDIDO #${String(id).slice(-6).toUpperCase()}`);
    const sheet = $('#restaurant-order-chat-sheet');
    sheet?.classList.add('open');
    sheet?.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    $('#restaurant-order-chat-stream').innerHTML = '<div class="empty-state">A carregar mensagens…</div>';
    await loadRestaurantMessages();
    clearInterval(state.chatTimer);
    state.chatTimer = setInterval(() => {
      if ($('#restaurant-order-chat-sheet')?.classList.contains('open')) loadRestaurantMessages(true);
    }, 8000);
  }

  async function updateRestaurantOrderStatus(id, action, trigger = null) {
    const statusMap = { prepare: 'preparing', cancel: 'rejected' };
    const status = statusMap[action];
    if (!status && !['accept', 'ready'].includes(action)) return;
    let reason = '';
    if (status === 'rejected') {
      const confirmed = window.TragoFeedback
        ? await window.TragoFeedback.confirm({
          type: 'warning',
          kicker: 'PEDIDO',
          title: 'Recusar este pedido?',
          message: 'O Cliente, o Motorista e a Administração serão informados imediatamente. Se a recolha já tiver começado, use o suporte.',
          confirmText: 'Sim, recusar',
          cancelText: 'Manter pedido'
        })
        : false;
      if (!confirmed) return;
      reason = String(window.prompt('Justificativa do cancelamento (obrigatória):') || '').trim();
      if (reason.length < 3) {
        toast('Indique uma justificativa válida para cancelar.', 'error');
        return;
      }
    }
    const originalMarkup = trigger?.innerHTML || '';
    if (trigger) {
      trigger.disabled = true;
      trigger.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> A actualizar';
    }
    try {
      const endpoint = action === 'accept'
        ? `/api/restaurant/orders/${id}/confirm`
        : action === 'ready'
          ? `/api/restaurant/orders/${id}/pickup-confirmation`
          : `/api/restaurant/orders/${id}/status`;
      const body = action === 'prepare'
        ? { status: 'preparing', prep_time_min: 25 }
        : action === 'cancel'
          ? { status: 'rejected', reason }
          : {};
      const data = await api(endpoint, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
      toast(data.message || 'Estado actualizado.');
      await loadOrders();
      if (action === 'ready') await openRestaurantOrderChat(id);
    } catch (error) {
      if (window.TragoFeedback && /motorista|recolha|operação|mudança de estado/i.test(error.message)) {
        await window.TragoFeedback.alert({
          type: 'warning',
          kicker: 'ESTADO PROTEGIDO',
          title: 'Acção indisponível',
          message: `${error.message}\n\nO pedido foi actualizado para mostrar o seu estado real.`,
          confirmText: 'Actualizar pedido'
        });
        await loadOrders();
      } else toast(error.message, 'error');
    } finally {
      if (trigger?.isConnected) {
        trigger.disabled = false;
        trigger.innerHTML = originalMarkup;
      }
    }
  }

  function bindEvents() {
    $('#btn-restaurant-logout')?.addEventListener('click', logout);
    $$('.portal-tab, .mobile-bottom-nav button').forEach((btn) => btn.addEventListener('click', () => setPanel(btn.dataset.panel, { root: true, source: 'root' })));
    $('#restaurant-profile-form')?.addEventListener('submit', updateProfile);
    $('#menu-form')?.addEventListener('submit', saveMenuItem);
    $('#btn-cancel-menu-edit')?.addEventListener('click', resetMenuForm);
    $('#btn-refresh-orders')?.addEventListener('click', loadOrders);
    document.addEventListener('trago_restaurant_operation_change', (event) => saveRestaurantOperation({ is_open: event.detail?.isOpen === true }, event.detail?.isOpen ? 'Restaurante aberto para novos pedidos.' : 'Restaurante fechado para novos pedidos.'));
    document.addEventListener('trago_restaurant_menu_availability', (event) => setMenuItemAvailability(event.detail?.id, event.detail?.available === true));
    $('#restaurant-operational-note')?.addEventListener('input', (event) => {
      $('#restaurant-note-count') && ($('#restaurant-note-count').textContent = String(event.currentTarget.value.length));
    });
    $('#restaurant-note-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const operational_note = String($('#restaurant-operational-note')?.value || '').trim();
      await saveRestaurantOperation({ operational_note }, operational_note ? 'Aviso publicado no Cliente.' : 'Aviso público removido.');
    });
    document.addEventListener('click', (event) => {
      const editBtn = event.target.closest('[data-edit-item]');
      if (editBtn) editMenuItem(editBtn.dataset.editItem);
      const deleteBtn = event.target.closest('[data-delete-item]');
      if (deleteBtn) deleteMenuItem(deleteBtn.dataset.deleteItem);
      const orderAction = event.target.closest('[data-order-action][data-order-id]');
      if (orderAction) {
        event.preventDefault();
        event.stopPropagation();
        updateRestaurantOrderStatus(orderAction.dataset.orderId, orderAction.dataset.orderAction, orderAction);
      }
      const orderChat = event.target.closest('[data-order-chat]');
      if (orderChat && !orderAction) {
        event.preventDefault();
        openRestaurantOrderChat(orderChat.dataset.orderChat);
      }
      const filter = event.target.closest('[data-restaurant-order-filter]');
      if (filter) {
        state.orderFilter = ({ new: 'new', preparing: 'preparing', ready: 'ready', done: 'done', cancelled: 'cancelled' })[filter.dataset.restaurantOrderFilter] || 'all';
        $$('[data-restaurant-order-filter]').forEach((button) => button.classList.toggle('active', button === filter));
        renderOrders();
      }
      if (event.target.closest('.v20-message-list header button')) setPanel('orders');
    });
    $('#restaurant-order-chat-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const message = String(form.elements.message.value || '').trim();
      if (!message || !state.activeOrderId) return;
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      const originalMarkup = button.innerHTML;
      button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> A enviar';
      try {
        await api(`/api/restaurant/orders/${state.activeOrderId}/messages`, { method: 'POST', headers: headers(), body: JSON.stringify({ message }) });
        form.reset();
        await loadRestaurantMessages(true);
        toast('Mensagem enviada para a conversa do pedido.');
      } catch (error) { toast(error.message, 'error'); }
      finally {
        button.disabled = false;
        button.innerHTML = originalMarkup;
      }
    });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    if (!initSession()) return;
    bindEvents();
    initPanelNavigation();
    await loadProfile().catch((error) => toast(error.message, 'error'));
    await loadMenu();
    await loadOrders();
    await loadPublicRestaurantSummary();
    resetMenuForm();
  });
})();
