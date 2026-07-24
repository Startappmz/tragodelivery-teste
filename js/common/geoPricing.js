/*
 * Trago Delivery - Geolocalização e preço por distância
 *
 * - Captura ponto de recolha e ponto de entrega.
 * - Usa pesquisa OpenStreetMap/Nominatim para sugestões sem chave Google.
 * - Calcula a rota no backend via OpenRouteService quando TRAGO_ORS_API_KEY estiver configurada.
 * - Calcula preço por distância com a política operacional da Trago Delivery.
 */
(function () {
  'use strict';

  const MAPUTO_BIAS = {
    lat: -25.9640,
    lng: 32.5707,
    radiusMeters: 45000
  };

  const PRICING_POLICY = Object.freeze({
    baseDistanceKm: 11.6,
    baseFeeMzn: 200,
    extraKmFeeMzn: 15
  });

  const state = {
    pickup: null,
    delivery: null,
    form: null,
    debounceTimers: {}
  };

  const $ = (id) => document.getElementById(id);
  const toNumber = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

  function isValidCoord(coord) {
    return coord && Number.isFinite(Number(coord.lat)) && Number.isFinite(Number(coord.lng));
  }

  function formatMzn(value) {
    return `${Number(value || 0).toLocaleString('pt-MZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MZN`;
  }

  function formatKm(value) {
    if (!Number.isFinite(Number(value))) return '—';
    return `${Number(value).toFixed(2)} km`;
  }

  function calculateDeliveryFee(distanceKm) {
    const distance = Math.max(0, Number(distanceKm) || 0);
    if (distance <= PRICING_POLICY.baseDistanceKm) return PRICING_POLICY.baseFeeMzn;
    const extraKm = Math.ceil(distance - PRICING_POLICY.baseDistanceKm);
    return PRICING_POLICY.baseFeeMzn + (extraKm * PRICING_POLICY.extraKmFeeMzn);
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

  function setInputValue(id, value) {
    const el = $(id);
    if (el) el.value = value ?? '';
  }

  function updateOutput({ distanceKm = null, durationMin = null, deliveryFee = 0, total = 0, source = '' } = {}) {
    const form = state.form || {};
    setInputValue(form.distanceInputId, Number.isFinite(Number(distanceKm)) ? Number(distanceKm).toFixed(2) : '');
    setInputValue(form.durationInputId, Number.isFinite(Number(durationMin)) ? Math.round(Number(durationMin)) : '');
    setInputValue(form.deliveryFeeInputId, Number(deliveryFee || 0).toFixed(2));
    setInputValue(form.totalPriceInputId, Number(total || 0).toFixed(2));

    const distanceLabel = $(form.distanceLabelId);
    const feeLabel = $(form.deliveryFeeLabelId);
    const totalLabel = $(form.totalPriceLabelId);
    const sourceLabel = $(form.sourceLabelId);

    if (distanceLabel) distanceLabel.textContent = distanceKm ? formatKm(distanceKm) : '—';
    if (feeLabel) feeLabel.textContent = formatMzn(deliveryFee);
    if (totalLabel) totalLabel.textContent = formatMzn(total);
    if (sourceLabel) sourceLabel.textContent = source || 'Aguardando moradas';
  }

  async function fetchRouteQuote(origin, destination) {
    const response = await fetch(`${API_URL}/api/geo/quote`, {
      method: 'POST',
      headers: { ...getAuthHeaders('admin'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ origin, destination })
    });
    const data = await readJsonResponse(response);
    if (!response.ok) throw new Error(data.message || 'Falha ao calcular distância.');
    return data;
  }

  async function updateQuote() {
    const form = state.form || {};
    const servicePrice = toNumber($(form.servicePriceInputId)?.value, 0);

    if (!isValidCoord(state.pickup) || !isValidCoord(state.delivery)) {
      updateOutput({ deliveryFee: 0, total: servicePrice, source: 'Seleccione recolha e entrega' });
      return;
    }

    try {
      const quote = await fetchRouteQuote(state.pickup, state.delivery);
      const total = servicePrice + toNumber(quote.delivery_fee, 0);
      updateOutput({
        distanceKm: quote.distance_km,
        durationMin: quote.duration_min,
        deliveryFee: quote.delivery_fee,
        total,
        source: quote.source === 'openrouteservice' ? 'OpenRouteService' : 'Cálculo estimado'
      });
    } catch (error) {
      console.warn('[TragoGeoPricing] Fallback local:', error.message || error);
      const distanceKm = haversineKm(state.pickup, state.delivery);
      const deliveryFee = calculateDeliveryFee(distanceKm);
      updateOutput({
        distanceKm,
        durationMin: Math.max(1, Math.round((distanceKm / 35) * 60)),
        deliveryFee,
        total: servicePrice + deliveryFee,
        source: 'Estimativa local'
      });
    }
  }

  function setCoords(kind, coords, label = '') {
    if (!['pickup', 'delivery'].includes(kind) || !isValidCoord(coords)) return;
    state[kind] = { lat: Number(coords.lat), lng: Number(coords.lng), label };

    const form = state.form || {};
    if (kind === 'pickup') {
      setInputValue(form.pickupLatInputId, state[kind].lat);
      setInputValue(form.pickupLngInputId, state[kind].lng);
      if (label && $(form.pickupInputId)) $(form.pickupInputId).value = label;
    } else {
      setInputValue(form.deliveryLatInputId, state[kind].lat);
      setInputValue(form.deliveryLngInputId, state[kind].lng);
      if (label && $(form.deliveryInputId)) $(form.deliveryInputId).value = label;
      if (typeof window.setFormMapDeliveryPosition === 'function') {
        window.setFormMapDeliveryPosition(state[kind].lat, state[kind].lng);
      }
    }

    updateQuote();
  }

  function isMobileViewport() {
    return window.matchMedia('(max-width: 768px)').matches;
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function getSuggestionTitle(place) {
    const displayName = String(place?.display_name || '').trim();
    return String(place?.name || displayName.split(',')[0] || 'Local encontrado').trim();
  }

  function getSuggestionAddress(place) {
    return String(place?.display_name || '').trim();
  }

  function lockMobileSuggestionsScroll(locked) {
    document.documentElement.classList.toggle('geo-suggestions-open', Boolean(locked));
    document.body.classList.toggle('geo-suggestions-open', Boolean(locked));
  }

  function positionSuggestionsPanel(input, panel) {
    if (!input || !panel || panel.classList.contains('hidden')) return;

    if (isMobileViewport()) {
      panel.classList.add('geo-suggestions-panel-mobile');
      panel.style.left = '10px';
      panel.style.right = '10px';
      panel.style.top = 'auto';
      panel.style.bottom = '10px';
      panel.style.width = 'auto';
      lockMobileSuggestionsScroll(true);
      return;
    }

    const rect = input.getBoundingClientRect();
    panel.classList.remove('geo-suggestions-panel-mobile');
    panel.style.left = `${Math.max(12, rect.left)}px`;
    panel.style.top = `${rect.bottom + 6}px`;
    panel.style.bottom = 'auto';
    panel.style.right = 'auto';
    panel.style.width = `${Math.max(260, rect.width)}px`;
    lockMobileSuggestionsScroll(false);
  }

  function makeSuggestionsPanel(input) {
    const panelId = `geo-suggestions-${input.id || Math.random().toString(36).slice(2)}`;
    let panel = document.getElementById(panelId);

    if (!panel) {
      panel = document.createElement('div');
      panel.id = panelId;
      panel.className = 'geo-suggestions-panel hidden';
      panel.setAttribute('role', 'listbox');
      panel.setAttribute('aria-label', `Sugestões para ${input.labels?.[0]?.textContent || input.placeholder || 'morada'}`);
      document.body.appendChild(panel);
    }

    input.setAttribute('aria-controls', panelId);
    input.setAttribute('aria-expanded', 'false');
    return panel;
  }

  function showSuggestions(input, panel) {
    if (!input || !panel) return;
    panel.classList.remove('hidden');
    input.setAttribute('aria-expanded', 'true');
    positionSuggestionsPanel(input, panel);
  }

  function hideSuggestions(input) {
    const panelId = input?.getAttribute('aria-controls');
    const panel = panelId ? document.getElementById(panelId) : null;
    if (panel) {
      panel.classList.add('hidden');
      panel.classList.remove('geo-suggestions-panel-mobile');
    }
    if (input) input.setAttribute('aria-expanded', 'false');

    const anyOpen = document.querySelector('.geo-suggestions-panel:not(.hidden)');
    if (!anyOpen) lockMobileSuggestionsScroll(false);
  }

  function hideAllSuggestions() {
    document.querySelectorAll('.geo-suggestions-panel').forEach((panel) => {
      panel.classList.add('hidden');
      panel.classList.remove('geo-suggestions-panel-mobile');
    });
    document.querySelectorAll('[aria-controls^="geo-suggestions-"]').forEach((input) => {
      input.setAttribute('aria-expanded', 'false');
    });
    lockMobileSuggestionsScroll(false);
  }

  function renderSuggestions(panel, input, kind, results) {
    panel.innerHTML = '';

    if (!Array.isArray(results) || !results.length) {
      panel.innerHTML = '<div class="geo-suggestion-muted">Nenhuma sugestão encontrada.</div>';
      showSuggestions(input, panel);
      return;
    }

    if (isMobileViewport()) {
      const header = document.createElement('div');
      header.className = 'geo-suggestions-header';
      header.innerHTML = '<strong>Seleccione uma morada</strong><button type="button" aria-label="Fechar sugestões">×</button>';
      header.querySelector('button').addEventListener('click', () => hideSuggestions(input));
      panel.appendChild(header);
    }

    const list = document.createElement('div');
    list.className = 'geo-suggestions-list';

    results.forEach((place) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'geo-suggestion-item';
      item.setAttribute('role', 'option');
      const title = escapeHtml(getSuggestionTitle(place));
      const address = escapeHtml(getSuggestionAddress(place));
      item.innerHTML = `<strong>${title}</strong><small>${address}</small>`;

      const selectPlace = (event) => {
        event.preventDefault();
        event.stopPropagation();
        setCoords(kind, { lat: Number(place.lat), lng: Number(place.lon) }, getSuggestionAddress(place));
        hideSuggestions(input);
      };

      item.addEventListener('pointerdown', selectPlace);
      item.addEventListener('click', selectPlace);
      list.appendChild(item);
    });

    panel.appendChild(list);
    showSuggestions(input, panel);
  }

  function attachNominatimFallback(input, kind) {
    const panel = makeSuggestionsPanel(input);

    const reposition = () => positionSuggestionsPanel(input, panel);
    window.addEventListener('resize', reposition, { passive: true });
    window.addEventListener('orientationchange', () => setTimeout(reposition, 200), { passive: true });
    window.addEventListener('scroll', reposition, true);

    input.addEventListener('focus', () => {
      if (panel.innerHTML.trim() && input.value.trim().length >= 3) showSuggestions(input, panel);
    });

    input.addEventListener('input', () => {
      const query = input.value.trim();
      state[kind] = null;
      updateQuote();

      clearTimeout(state.debounceTimers[kind]);
      if (query.length < 3) {
        hideSuggestions(input);
        return;
      }

      state.debounceTimers[kind] = setTimeout(async () => {
        try {
          panel.innerHTML = '<div class="geo-suggestion-muted">A procurar locais...</div>';
          showSuggestions(input, panel);

          const url = new URL('https://nominatim.openstreetmap.org/search');
          url.searchParams.set('format', 'jsonv2');
          url.searchParams.set('q', `${query}, Maputo, Moçambique`);
          url.searchParams.set('countrycodes', 'mz');
          url.searchParams.set('limit', '7');
          url.searchParams.set('addressdetails', '1');
          url.searchParams.set('bounded', '0');
          url.searchParams.set('viewbox', '32.25,-25.70,32.85,-26.15');

          const response = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
          const results = await readJsonResponse(response);
          renderSuggestions(panel, input, kind, results);
        } catch (error) {
          console.warn('[TragoGeoPricing] Sugestões indisponíveis:', error.message || error);
          panel.innerHTML = '<div class="geo-suggestion-muted">Sugestões indisponíveis. Use o pin do mapa.</div>';
          showSuggestions(input, panel);
        }
      }, 350);
    });

    document.addEventListener('pointerdown', (event) => {
      const target = event.target;
      if (target === input || panel.contains(target)) return;
      hideSuggestions(input);
    }, true);

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') hideSuggestions(input);
    });
  }


  function initDeliveryPricingForm(options = {}) {
    state.form = {
      pickupInputId: 'pickup-address',
      deliveryInputId: 'delivery-address',
      servicePriceInputId: 'delivery-price',
      pickupLatInputId: 'pickup-lat',
      pickupLngInputId: 'pickup-lng',
      deliveryLatInputId: 'delivery-lat',
      deliveryLngInputId: 'delivery-lng',
      distanceInputId: 'route-distance-km',
      durationInputId: 'route-duration-min',
      deliveryFeeInputId: 'delivery-fee',
      totalPriceInputId: 'final-order-price',
      distanceLabelId: 'route-distance-label',
      deliveryFeeLabelId: 'delivery-fee-label',
      totalPriceLabelId: 'total-price-label',
      sourceLabelId: 'route-source-label',
      ...options
    };

    const pickupInput = $(state.form.pickupInputId);
    const deliveryInput = $(state.form.deliveryInputId);
    const servicePriceInput = $(state.form.servicePriceInputId);
    if (!pickupInput || !deliveryInput || !servicePriceInput) return;

    [pickupInput, deliveryInput].forEach((input) => {
      if (getComputedStyle(input.parentElement).position === 'static') {
        input.parentElement.style.position = 'relative';
      }
    });

    attachNominatimFallback(pickupInput, 'pickup');
    attachNominatimFallback(deliveryInput, 'delivery');

    servicePriceInput.addEventListener('input', updateQuote);
    updateQuote();
  }

  function resetDeliveryPricing() {
    state.pickup = null;
    state.delivery = null;
    updateOutput({ deliveryFee: 0, total: toNumber($(state.form?.servicePriceInputId)?.value, 0), source: 'Seleccione recolha e entrega' });
  }

  window.TragoGeoPricing = {
    PRICING_POLICY,
    initDeliveryPricingForm,
    resetDeliveryPricing,
    setCoords,
    updateQuote,
    calculateDeliveryFee,
    haversineKm
  };
})();
