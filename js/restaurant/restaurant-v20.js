/* TraGo V20 — experiência visual do Restaurante em JavaScript puro. */
(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const PROFILE_KEY = 'tragoRestaurantProfile';
  let coupons = [];

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

  function readJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || '') || fallback; } catch { return fallback; }
  }

  async function request(path, options = {}) {
    const token = localStorage.getItem('tragoRestaurantToken') || '';
    const headers = { Accept: 'application/json', Authorization: `Bearer ${token}`, ...(options.headers || {}) };
    const init = { ...options, headers };
    if (options.body && !(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }
    const response = await fetch(`${API_URL}${path}`, init);
    const data = await readJsonResponse(response);
    if (!response.ok) throw new Error(data.message || 'Não foi possível comunicar com a TraGo.');
    return data;
  }

  function openSheet(id) {
    const sheet = document.getElementById(id);
    if (!sheet) return;
    sheet.classList.add('open');
    sheet.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closeSheet(id) {
    const sheet = document.getElementById(id);
    if (!sheet) return;
    sheet.classList.remove('open');
    sheet.setAttribute('aria-hidden', 'true');
    if (!$('.v20-sheet.open')) document.body.style.overflow = '';
  }

  function syncProfile() {
    const profile = readJson(PROFILE_KEY, {});
    const name = $('#profile-name')?.value || profile.name || 'Restaurante';
    const phone = $('#profile-phone')?.value || profile.phone || 'Por configurar';
    const address = $('#profile-address')?.value || profile.address_text || 'Por configurar';
    const description = $('#profile-description')?.value || profile.description || 'Restaurante parceiro TraGo';
    const initial = name.trim().charAt(0).toUpperCase() || 'R';
    $$('#restaurant-name-label, #restaurant-preview-name, #v20-public-name, #preview-client-name').forEach((node) => { node.textContent = name; });
    $$('#restaurant-avatar-label, #restaurant-preview-avatar, #v20-public-avatar, #preview-client-avatar').forEach((node) => { node.textContent = initial; });
    $$('#restaurant-preview-address, #v20-public-address').forEach((node) => { node.textContent = address; });
    $$('#restaurant-preview-phone, #v20-public-phone').forEach((node) => { node.textContent = phone; });
    if ($('#preview-client-description')) $('#preview-client-description').textContent = description;
    const cover = $('#profile-cover')?.value || profile.cover_url;
    if (cover) $('.v20-restaurant-hero').style.backgroundImage = `linear-gradient(90deg,rgba(11,16,9,.94),rgba(19,29,15,.55)),url("${String(cover).replace(/["\\]/g, '')}")`;
  }

  function jumpPanel(panel, root = false) {
    if (typeof window.TragoRestaurantOpenPanel === 'function') window.TragoRestaurantOpenPanel(panel, root ? { root: true, source: 'root' } : {});
  }

  function initNavigation() {
    $$('[data-jump-restaurant]').forEach((button) => button.addEventListener('click', (event) => {
      event.preventDefault();
      jumpPanel(button.dataset.jumpRestaurant, button.hasAttribute('data-nav-root'));
    }));
    $('#btn-quick-add')?.addEventListener('click', () => {
      $('#restaurant-editor-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setTimeout(() => $('#menu-name')?.focus(), 350);
    });
  }

  function initSheets() {
    $('[data-restaurant-notifications]')?.addEventListener('click', () => openSheet('restaurant-notifications-sheet'));
    $('[data-preview-public]')?.addEventListener('click', () => { syncProfile(); openSheet('restaurant-public-preview'); });
    $$('[data-close-sheet]').forEach((button) => button.addEventListener('click', () => closeSheet(button.dataset.closeSheet)));
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      const open = $('.v20-sheet.open');
      if (open) closeSheet(open.id);
    });
  }

  function setStoreOpen(open) {
    const topStatus = $('.v20-store-status');
    topStatus?.classList.toggle('closed', !open);
    if (topStatus) topStatus.innerHTML = `<i></i> ${open ? 'Loja aberta' : 'Loja fechada'}`;
    const operation = $('.v20-operation-status');
    if (operation) operation.innerHTML = open
      ? '<i></i><span><strong>Aberta e a receber pedidos</strong><small>Os produtos disponíveis estão visíveis no Cliente.</small></span>'
      : '<i></i><span><strong>Fechada para novos pedidos</strong><small>O menu continua visível, mas não aceita checkout.</small></span>';
    $('#profile-is-open') && ($('#profile-is-open').checked = open);
    document.dispatchEvent(new CustomEvent('trago_restaurant_operation_change', { detail: { isOpen: open } }));
  }

  function initOperation() {
    $('#restaurant-open-toggle')?.addEventListener('change', (event) => setStoreOpen(event.currentTarget.checked));
    $('.v20-store-status')?.addEventListener('click', () => {
      const toggle = $('#restaurant-open-toggle');
      toggle.checked = !toggle.checked;
      setStoreOpen(toggle.checked);
      toast(toggle.checked ? 'Restaurante aberto para pedidos.' : 'Restaurante fechado para novos pedidos.');
    });
    $('#btn-restaurant-refresh')?.addEventListener('click', () => {
      $('#btn-refresh-orders')?.click();
      toast('Dados do restaurante actualizados.');
    });
  }

  function renderCoupons() {
    const list = $('#restaurant-coupon-list');
    if (!list) return;
    list.innerHTML = coupons.length ? coupons.map((coupon) => `<article><b>${coupon.type === 'delivery' ? 'FREE' : coupon.type === 'percentage' ? `${coupon.value}%` : `${coupon.value}`}</b><span><strong>${String(coupon.code).replace(/[<>]/g, '')}</strong><small>${coupon.type === 'percentage' ? `${coupon.value}%` : coupon.type === 'delivery' ? 'Entrega grátis' : `${coupon.value} MZN`} · mínimo ${coupon.min} MZN · ${coupon.used || 0}/${coupon.limit} usos</small></span><button type="button" data-delete-coupon="${String(coupon.code).replace(/["<>]/g, '')}"><i class="fa-regular fa-trash-can"></i></button></article>`).join('') : '<div class="empty-state">Ainda não publicou cupões.</div>';
  }

  function initCoupons() {
    request('/api/restaurant/coupons').then((data) => {
      coupons = data.coupons || [];
      renderCoupons();
    }).catch((error) => {
      $('#restaurant-coupon-list').innerHTML = `<div class="empty-state">${String(error.message).replace(/[<>]/g, '')}</div>`;
    });
    $('#restaurant-coupon-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const code = String($('#restaurant-coupon-code')?.value || '').trim().toUpperCase().replace(/\s+/g, '');
      if (!code) return;
      const submit = form.querySelector('button[type="submit"]');
      submit.disabled = true;
      try {
        const data = await request('/api/restaurant/coupons', {
          method: 'POST',
          body: { code, type: $('#restaurant-coupon-type').value, value: Number($('#restaurant-coupon-value').value || 0), min: Number($('#restaurant-coupon-min').value || 0), limit: Number($('#restaurant-coupon-limit').value || 1) }
        });
        coupons = data.coupons || [];
        form.reset();
        renderCoupons();
        toast(`Cupão ${code} publicado.`);
      } catch (error) { toast(error.message, 'error'); }
      finally { submit.disabled = false; }
    });
    document.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-delete-coupon]');
      if (!button) return;
      const confirmed = window.TragoFeedback
        ? await window.TragoFeedback.confirm({
          type: 'warning',
          title: 'Eliminar cupão?',
          message: `O cupão ${button.dataset.deleteCoupon} deixa de poder ser utilizado imediatamente.`,
          confirmText: 'Eliminar',
          cancelText: 'Manter'
        })
        : false;
      if (!confirmed) return;
      try {
        const data = await request(`/api/restaurant/coupons/${encodeURIComponent(button.dataset.deleteCoupon)}`, { method: 'DELETE' });
        coupons = data.coupons || [];
        renderCoupons();
        toast('Cupão removido.');
      } catch (error) { toast(error.message, 'error'); }
    });
  }

  function addOptionGroup(group = {}) {
    const container = $('#menu-option-groups');
    const article = document.createElement('article');
    const values = Array.isArray(group.values) && group.values.length ? group.values : [{ name: '', price: 0 }];
    article.innerHTML = `<div><input value="${String(group.name || 'Novo grupo').replace(/["<>]/g, '')}" data-option-group-name aria-label="Nome do grupo"><select data-option-group-rule aria-label="Regra"><option value="required" ${group.required ? 'selected' : ''}>Obrigatório · 1 opção</option><option value="optional" ${group.required ? '' : 'selected'}>Opcional · várias</option></select><button type="button" data-remove-option-group><i class="fa-regular fa-trash-can"></i></button></div>${values.map((value) => `<label><input data-option-name placeholder="Nome da opção" value="${String(value.name || '').replace(/["<>]/g, '')}"><input data-option-price type="number" min="0" step="0.01" value="${Number(value.price || 0)}" aria-label="Preço adicional"><button type="button" data-remove-option><i class="fa-solid fa-xmark"></i></button></label>`).join('')}<button type="button" data-add-option><i class="fa-solid fa-plus"></i> Adicionar opção</button>`;
    container.append(article);
  }

  window.TragoRestaurantCollectOptions = () => $$('#menu-option-groups > article').map((article) => {
    const values = $$('label', article).map((label) => ({
      name: $('[data-option-name]', label)?.value.trim() || '',
      price: Number($('[data-option-price]', label)?.value || 0)
    })).filter((value) => value.name);
    const required = $('[data-option-group-rule]', article)?.value === 'required';
    return {
      name: $('[data-option-group-name]', article)?.value.trim() || '',
      required,
      min_select: required ? 1 : 0,
      max_select: required ? 1 : Math.max(1, values.length),
      values
    };
  }).filter((group) => group.name && group.values.length);

  window.TragoRestaurantRenderOptions = (groups = []) => {
    const container = $('#menu-option-groups');
    if (!container) return;
    container.innerHTML = '';
    (groups || []).forEach(addOptionGroup);
  };

  function initProductEditor() {
    $('#btn-add-option-group')?.addEventListener('click', addOptionGroup);
    const imageUpload = $('#btn-menu-image-file');
    if (imageUpload) {
      imageUpload.addEventListener('click', () => $('#menu-image-file')?.click());
      $('#menu-image-file')?.addEventListener('change', async (event) => {
        const file = event.currentTarget.files?.[0];
        if (!file) return;
        imageUpload.disabled = true;
        try {
          const form = new FormData();
          form.append('file', file);
          form.append('category', 'product');
          const data = await request('/api/media/upload', { method: 'POST', body: form });
          $('#menu-image').value = data.url;
          toast('Imagem do produto carregada.');
        } catch (error) { toast(error.message, 'error'); }
        finally { imageUpload.disabled = false; }
      });
    }
    document.addEventListener('click', (event) => {
      const removeGroup = event.target.closest('[data-remove-option-group]');
      if (removeGroup) removeGroup.closest('article')?.remove();
      const removeOption = event.target.closest('[data-remove-option]');
      if (removeOption) removeOption.closest('label')?.remove();
      const addOption = event.target.closest('[data-add-option]');
      if (addOption) {
        const label = document.createElement('label');
        label.innerHTML = '<input data-option-name placeholder="Nome da opção"><input data-option-price type="number" min="0" step="0.01" value="0" aria-label="Preço adicional"><button type="button" data-remove-option><i class="fa-solid fa-xmark"></i></button>';
        addOption.before(label);
      }
    });
    $('#menu-form')?.addEventListener('reset', () => setTimeout(() => { $('#restaurant-product-form-title').textContent = 'Adicionar produto'; }, 0));
    $$('[data-upload-restaurant-image]').forEach((button) => {
      const category = button.dataset.uploadRestaurantImage;
      const fileInput = category === 'restaurant-logo' ? $('#profile-logo-file') : $('#profile-cover-file');
      const urlInput = category === 'restaurant-logo' ? $('#profile-logo') : $('#profile-cover');
      button.addEventListener('click', () => fileInput?.click());
      fileInput?.addEventListener('change', async () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        button.disabled = true;
        try {
          const form = new FormData();
          form.append('file', file);
          form.append('category', category);
          const data = await request('/api/media/upload', { method: 'POST', body: form });
          urlInput.value = data.url;
          syncProfile();
          toast(category === 'restaurant-logo' ? 'Logótipo carregado.' : 'Imagem de capa carregada.');
        } catch (error) { toast(error.message, 'error'); }
        finally { button.disabled = false; }
      });
    });
  }

  function filterMenu() {
    const term = String($('#restaurant-menu-search')?.value || '').trim().toLowerCase();
    $$('#restaurant-menu-list .menu-admin-item').forEach((item) => { item.hidden = Boolean(term && !item.textContent.toLowerCase().includes(term)); });
  }

  function enhanceMenuAndOrders() {
    $$('#restaurant-menu-list .menu-admin-item').forEach((item) => {
      if ($('.v20-product-availability', item)) return;
      const available = item.dataset.menuAvailable !== 'false';
      const toggle = document.createElement('label');
      toggle.className = 'v20-product-availability';
      toggle.innerHTML = `<input type="checkbox" ${available ? 'checked' : ''}><span></span>`;
      $('.inline-actions', item)?.prepend(toggle);
      toggle.addEventListener('click', (event) => event.stopPropagation());
      $('input', toggle)?.addEventListener('change', (event) => {
        event.currentTarget.disabled = true;
        document.dispatchEvent(new CustomEvent('trago_restaurant_menu_availability', { detail: { id: item.dataset.menuItemId, available: event.currentTarget.checked } }));
      });
    });
    $$('#restaurant-orders-list .order-card').forEach((card) => {
      if ($('.v20-backend-order-actions', card)) return;
      const actions = document.createElement('div');
      actions.className = 'v20-backend-order-actions';
      actions.innerHTML = '<button type="button" data-order-action="accept">Aceitar</button><button type="button" data-order-action="prepare">Preparar</button><button type="button" data-order-action="ready">Pronto</button><button type="button" data-order-action="cancel">Cancelar</button>';
      card.append(actions);
    });
  }

  function initCatalog() {
    $('#restaurant-menu-search')?.addEventListener('input', filterMenu);
    $$('.v20-product-filter button').forEach((button, index) => {
      const value = ['all', 'available', 'unavailable'][index];
      if (!value) {
        button.disabled = true;
        button.title = 'O controlo de stock requer o módulo de inventário.';
        return;
      }
      button.dataset.menuFilter = value;
      button.addEventListener('click', () => {
        $$('.v20-product-filter button').forEach((item) => item.classList.toggle('active', item === button));
        $$('#restaurant-menu-list .menu-admin-item').forEach((item) => {
          const matches = value === 'all' || (value === 'available') === (item.dataset.menuAvailable !== 'false');
          item.hidden = !matches;
        });
      });
    });
    $('#btn-menu-grid')?.addEventListener('click', () => {
      $('#restaurant-menu-list')?.classList.remove('is-list');
      $('#btn-menu-grid')?.classList.add('active');
      $('#btn-menu-list')?.classList.remove('active');
    });
    $('#btn-menu-list')?.addEventListener('click', () => {
      $('#restaurant-menu-list')?.classList.add('is-list');
      $('#btn-menu-list')?.classList.add('active');
      $('#btn-menu-grid')?.classList.remove('active');
    });
    const observer = new MutationObserver(enhanceMenuAndOrders);
    if ($('#restaurant-menu-list')) observer.observe($('#restaurant-menu-list'), { childList: true, subtree: true });
    if ($('#restaurant-orders-list')) observer.observe($('#restaurant-orders-list'), { childList: true, subtree: true });
    enhanceMenuAndOrders();
    $('#restaurant-public-preview .v20-preview-client > button')?.addEventListener('click', () => {
      closeSheet('restaurant-public-preview');
      window.TragoRestaurantOpenPanel?.('menu');
    });
  }

  function initProfile() {
    $('#restaurant-profile-form')?.addEventListener('submit', () => {
      syncProfile();
    });
    $$('#restaurant-profile-form input, #restaurant-profile-form textarea, #restaurant-profile-form select').forEach((input) => input.addEventListener('input', syncProfile));
    setTimeout(syncProfile, 250);
    setTimeout(syncProfile, 1000);
  }

  function syncMetrics() {
    const orders = $('#metric-orders')?.textContent || '0';
    if ($('#sidebar-orders-count')) $('#sidebar-orders-count').textContent = orders;
    if ($('#metric-orders-state')) $('#metric-orders-state').textContent = Number(orders) ? `${orders} pedido(s) registado(s)` : 'sem pedidos pendentes';
  }

  document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    initSheets();
    initOperation();
    initCoupons();
    initProductEditor();
    initCatalog();
    // As acções dos pedidos são persistidas por restaurant.js.
    initProfile();
    // A nota operacional é guardada no backend por restaurant.js.
    const metric = $('#metric-orders');
    if (metric) new MutationObserver(syncMetrics).observe(metric, { childList: true, subtree: true });
    syncMetrics();
  });
})();
