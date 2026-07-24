/* TraGo · endereços frequentes do Cliente (independentes da rota do pedido). */
(() => {
  'use strict';

  const STORAGE_KEY = 'tragoClientSavedAddresses';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
  const typeMeta = {
    home: { label: 'Casa', icon: 'fa-house' },
    work: { label: 'Trabalho', icon: 'fa-briefcase' },
    other: { label: 'Outro', icon: 'fa-location-dot' }
  };

  const starterAddresses = [];

  function clientSession() {
    try { return JSON.parse(localStorage.getItem('tragoClientSession') || 'null'); } catch { return null; }
  }

  async function request(path, options = {}) {
    const session = clientSession();
    if (!session?.token) throw new Error('Entre na sua conta para sincronizar endereços.');
    const headers = { Accept: 'application/json', Authorization: `Bearer ${session.token}`, ...(options.headers || {}) };
    const init = { ...options, headers };
    if (options.body) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }
    const response = await fetch(`${API_URL}${path}`, init);
    const data = await readJsonResponse(response);
    if (!response.ok) throw new Error(data.message || 'Não foi possível guardar o endereço.');
    return data;
  }

  function normalise(address) {
    const type = typeMeta[address?.type] ? address.type : 'other';
    const hasLat = address?.lat !== null && address?.lat !== '' && Number.isFinite(Number(address?.lat));
    const hasLng = address?.lng !== null && address?.lng !== '' && Number.isFinite(Number(address?.lng));
    return {
      id: String(address?.id || `address_${Date.now()}_${Math.random().toString(16).slice(2)}`),
      type,
      label: String(address?.label || typeMeta[type].label).trim().slice(0, 30),
      address: String(address?.address || address?.details || '').trim().slice(0, 180),
      reference: String(address?.reference || '').trim().slice(0, 100),
      isDefault: Boolean(address?.isDefault ?? address?.is_default),
      lat: hasLat ? Number(address.lat) : null,
      lng: hasLng ? Number(address.lng) : null
    };
  }

  function readAddresses() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(starterAddresses));
        return starterAddresses.map(normalise);
      }
      const parsed = JSON.parse(stored);
      if (!Array.isArray(parsed)) return [];
      const values = parsed.map(normalise).filter((item) => item.address);
      if (values.length && !values.some((item) => item.isDefault)) values[0].isDefault = true;
      return values;
    } catch {
      return starterAddresses.map(normalise);
    }
  }

  function writeAddresses(values) {
    const clean = values.map(normalise).filter((item) => item.address);
    if (clean.length && !clean.some((item) => item.isDefault)) clean[0].isDefault = true;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
    renderAddresses(clean);
    document.dispatchEvent(new CustomEvent('trago:addresses-updated', { detail: { addresses: clean } }));
  }

  async function refreshRemote(silent = false) {
    if (!clientSession()?.token) {
      renderAddresses(readAddresses());
      return readAddresses();
    }
    try {
      const data = await request('/api/client/addresses');
      const values = (data.addresses || []).map(normalise).filter((item) => item.address);
      writeAddresses(values);
      return values;
    } catch (error) {
      if (!silent) toast(error.message, 'error');
      renderAddresses(readAddresses());
      return readAddresses();
    }
  }

  function toast(message, kind = '') {
    const node = $('#portal-toast');
    if (!node) return;
    node.textContent = message;
    node.className = `portal-toast ${kind} show`;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => node.classList.remove('show'), 2800);
  }

  function openSheet() {
    const sheet = $('#client-address-sheet');
    if (!sheet) return;
    sheet.classList.add('open');
    sheet.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    setTimeout(() => $('#client-address-form input[name="address"]')?.focus(), 80);
  }

  function closeSheet() {
    const sheet = $('#client-address-sheet');
    if (!sheet) return;
    sheet.classList.remove('open');
    sheet.setAttribute('aria-hidden', 'true');
    if (!$('.v20-sheet.open')) document.body.style.overflow = '';
  }

  function selectType(type) {
    const safeType = typeMeta[type] ? type : 'other';
    const form = $('#client-address-form');
    if (!form) return;
    form.elements.type.value = safeType;
    $$('[data-address-type]', form).forEach((button) => button.classList.toggle('active', button.dataset.addressType === safeType));
    const custom = $('.v20-address-custom-label', form);
    custom.hidden = safeType !== 'other';
    custom.querySelector('input').required = safeType === 'other';
  }

  function resetForm(address = null) {
    const form = $('#client-address-form');
    if (!form) return;
    form.reset();
    form.elements.id.value = address?.id || '';
    form.elements.address.value = address?.address || '';
    form.elements.reference.value = address?.reference || '';
    form.elements.label.value = address?.type === 'other' ? address.label : '';
    form.elements.lat.value = address?.lat ?? '';
    form.elements.lng.value = address?.lng ?? '';
    form.elements.is_default.checked = address?.isDefault ?? !readAddresses().length;
    $('[data-address-location-state]', form).textContent = address?.lat && address?.lng
      ? 'Localização associada a este endereço'
      : 'Opcional · ajuda a localizar este endereço';
    $('#client-address-sheet-title').textContent = address ? 'Editar endereço' : 'Adicionar endereço';
    selectType(address?.type || 'home');
  }

  function activeAddress(values = readAddresses()) {
    return values.find((item) => item.isDefault) || values[0] || null;
  }

  function syncDefaultAddress(values) {
    const selected = activeAddress(values);
    const shortAddress = selected?.address?.split(',')[0]?.trim() || 'Escolher endereço';
    $$('[data-client-active-address]').forEach((node) => { node.textContent = shortAddress; });
    if (!selected) return;
    const suggest = (inputSelector, latSelector, lngSelector) => {
      const input = $(inputSelector);
      if (!input) return;
      const canReplace = !input.value.trim() || input.dataset.addressSuggestion === 'true';
      if (!canReplace) return;
      input.value = selected.address;
      input.dataset.addressSuggestion = 'true';
      input.dataset.resolvedAddress = selected.address.trim();
      const latInput = $(latSelector);
      const lngInput = $(lngSelector);
      latInput && (latInput.value = selected.lat !== null ? Number(selected.lat).toFixed(6) : '');
      lngInput && (lngInput.value = selected.lng !== null ? Number(selected.lng).toFixed(6) : '');
    };
    suggest('#food-delivery-address', '#food-delivery-lat', '#food-delivery-lng');
    suggest('#order-delivery-address', '#delivery-lat', '#delivery-lng');
  }

  function renderAddresses(values = readAddresses()) {
    const list = $('#client-address-list');
    const empty = $('#client-address-empty');
    if (!list || !empty) return;
    list.innerHTML = values.map((item) => {
      const meta = typeMeta[item.type];
      return `<article class="v20-address-card${item.isDefault ? ' active' : ''}" data-address-id="${escapeHtml(item.id)}">
        <i class="fa-solid ${meta.icon}"></i>
        <span><strong>${escapeHtml(item.label || meta.label)}</strong><p>${escapeHtml(item.address)}</p>${item.reference ? `<small><i class="fa-solid fa-landmark"></i> ${escapeHtml(item.reference)}</small>` : ''}${item.isDefault ? '<em><i class="fa-solid fa-circle-check"></i> Predefinido</em>' : ''}</span>
        <div class="v20-address-actions">${item.isDefault ? '' : `<button type="button" data-address-default="${escapeHtml(item.id)}" title="Usar como predefinido"><i class="fa-regular fa-circle-check"></i><span>Predefinir</span></button>`}<button type="button" data-address-edit="${escapeHtml(item.id)}" title="Editar"><i class="fa-regular fa-pen-to-square"></i><span>Editar</span></button><button type="button" data-address-delete="${escapeHtml(item.id)}" title="Eliminar"><i class="fa-regular fa-trash-can"></i><span>Eliminar</span></button></div>
      </article>`;
    }).join('');
    empty.hidden = values.length > 0;
    syncDefaultAddress(values);
  }

  async function saveFromForm(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const addressText = String(data.get('address') || '').trim();
    if (addressText.length < 5) {
      toast('Indique um endereço completo.', 'error');
      form.elements.address.focus();
      return;
    }
    const type = String(data.get('type') || 'home');
    const id = String(data.get('id') || `address_${Date.now()}`);
    const values = readAddresses().filter((item) => item.id !== id);
    const isDefault = data.get('is_default') === 'on' || !values.length;
    const next = normalise({
      id,
      type,
      label: type === 'other' ? data.get('label') : typeMeta[type]?.label,
      address: addressText,
      reference: data.get('reference'),
      isDefault,
      lat: data.get('lat'),
      lng: data.get('lng')
    });
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      if (clientSession()?.token) {
        const payload = {
          type: next.type,
          label: next.label,
          address: next.address,
          reference: next.reference,
          is_default: next.isDefault,
          lat: next.lat,
          lng: next.lng
        };
        const isExisting = /^[a-f0-9]{24}$/i.test(String(data.get('id') || ''));
        await request(isExisting ? `/api/client/addresses/${encodeURIComponent(id)}` : '/api/client/addresses', {
          method: isExisting ? 'PUT' : 'POST',
          body: payload
        });
        await refreshRemote(true);
      } else {
        if (isDefault) values.forEach((item) => { item.isDefault = false; });
        writeAddresses([...values, next]);
      }
      closeSheet();
      toast(clientSession()?.token ? 'Endereço sincronizado na sua conta.' : 'Endereço guardado neste dispositivo.');
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      submit.disabled = false;
    }
  }

  function useCurrentLocation(button) {
    if (!navigator.geolocation) {
      toast('A localização não está disponível neste dispositivo.', 'error');
      return;
    }
    const form = $('#client-address-form');
    button.disabled = true;
    button.classList.add('is-loading');
    $('[data-address-location-state]', form).textContent = 'A obter localização…';
    navigator.geolocation.getCurrentPosition((position) => {
      form.elements.lat.value = position.coords.latitude.toFixed(6);
      form.elements.lng.value = position.coords.longitude.toFixed(6);
      $('[data-address-location-state]', form).textContent = 'Localização actual associada com sucesso';
      button.disabled = false;
      button.classList.remove('is-loading');
    }, () => {
      $('[data-address-location-state]', form).textContent = 'Não foi possível obter a localização';
      button.disabled = false;
      button.classList.remove('is-loading');
      toast('Autorize a localização e tente novamente.', 'error');
    }, { enableHighAccuracy: true, timeout: 10000 });
  }

  async function handleActions(event) {
    const add = event.target.closest('[data-address-add]');
    if (add) {
      event.preventDefault();
      resetForm();
      openSheet();
      return;
    }
    const edit = event.target.closest('[data-address-edit]');
    if (edit) {
      const item = readAddresses().find((address) => address.id === edit.dataset.addressEdit);
      if (item) { resetForm(item); openSheet(); }
      return;
    }
    const makeDefault = event.target.closest('[data-address-default]');
    if (makeDefault) {
      try {
        if (clientSession()?.token && /^[a-f0-9]{24}$/i.test(makeDefault.dataset.addressDefault)) {
          const item = readAddresses().find((entry) => entry.id === makeDefault.dataset.addressDefault);
          await request(`/api/client/addresses/${encodeURIComponent(item.id)}`, {
            method: 'PUT',
            body: { ...item, is_default: true }
          });
          await refreshRemote(true);
        } else {
          const values = readAddresses().map((item) => ({ ...item, isDefault: item.id === makeDefault.dataset.addressDefault }));
          writeAddresses(values);
        }
        toast('Endereço predefinido actualizado.');
      } catch (error) {
        toast(error.message, 'error');
      }
      return;
    }
    const remove = event.target.closest('[data-address-delete]');
    if (remove) {
      const values = readAddresses();
      const item = values.find((address) => address.id === remove.dataset.addressDelete);
      if (!item) return;
      const confirmed = window.TragoFeedback
        ? await window.TragoFeedback.confirm({
          type: 'warning',
          title: 'Eliminar endereço?',
          message: `“${item.label}” deixará de aparecer nos seus locais guardados.`,
          confirmText: 'Eliminar',
          cancelText: 'Manter'
        })
        : false;
      if (!confirmed) return;
      try {
        if (clientSession()?.token && /^[a-f0-9]{24}$/i.test(item.id)) {
          await request(`/api/client/addresses/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
          await refreshRemote(true);
        } else {
          writeAddresses(values.filter((address) => address.id !== item.id));
        }
        toast('Endereço eliminado.');
      } catch (error) {
        toast(error.message, 'error');
      }
    }
  }

  function init() {
    const form = $('#client-address-form');
    if (!form) return;
    renderAddresses();
    refreshRemote(true);
    document.addEventListener('click', handleActions);
    $$('[data-address-type]', form).forEach((button) => button.addEventListener('click', () => selectType(button.dataset.addressType)));
    $('[data-address-use-location]', form)?.addEventListener('click', (event) => useCurrentLocation(event.currentTarget));
    form.addEventListener('submit', saveFromForm);
  }

  window.TragoClientAddresses = { read: readAddresses, render: renderAddresses, refresh: () => refreshRemote(true), open: () => { resetForm(); openSheet(); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
