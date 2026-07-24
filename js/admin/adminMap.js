/*
 * Ficheiro: js/admin/adminMap.js
 *
 * Mapas do painel admin:
 * - mapa do formulário de nova entrega;
 * - mapa em tempo real com filtros, resumo, lista de motoristas, foco, trilhos e movimento suave.
 */

// --- Variáveis de Estado para os Mapas ---
let map = null;
let mapMarker = null;

let liveMap = null;
let driverMarkers = {};
let driverTrails = {};
let liveDriverStore = new Map();
let liveMapRefreshTimer = null;
let liveMapUiTimer = null;
let freeIcon = null;
let busyIcon = null;
let offlineIcon = null;
let liveMapFilter = 'all';
let focusedDriverId = null;
let followFocusedDriver = false;
let liveMapTrailsVisible = true;
let liveMapPanelVisible = true;
let liveMapMiniMode = false;

const BUSY_DRIVER_STATUSES = new Set(['online_ocupado', 'em_recolha', 'em_entrega']);
const LIVE_DRIVER_STALE_MS = 4 * 60 * 1000;
const MAPUTO_CENTER = [-25.965, 32.589];

function normalizeDriverMarkerId(data) {
    return data?.driverId || data?.driverUserId || data?.userId || data?._id || data?.id;
}

function isValidMapCoordinate(value) {
    return value !== null && value !== undefined && Number.isFinite(Number(value));
}

function escapeLiveMapHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function getDriverStatusLabel(status = '') {
    const labels = {
        online_livre: 'Livre',
        online_ocupado: 'Ocupado',
        em_recolha: 'Recolha',
        em_entrega: 'Entrega',
        offline: 'Offline'
    };
    return labels[status] || String(status || 'Online').replace(/_/g, ' ');
}

function getDriverVisualGroup(data = {}) {
    const status = data.status || 'online_livre';
    if (status === 'offline') return 'offline';

    const updatedAt = data.updatedAt ? new Date(data.updatedAt) : null;
    if (updatedAt && !Number.isNaN(updatedAt.getTime()) && (Date.now() - updatedAt.getTime()) > LIVE_DRIVER_STALE_MS) {
        return 'offline';
    }

    return BUSY_DRIVER_STATUSES.has(status) ? 'busy' : 'free';
}

function getGroupLabel(group) {
    return { free: 'Livre', busy: 'Ocupado', offline: 'Inactivo' }[group] || 'Todos';
}

function getIconForDriver(data = {}) {
    const group = getDriverVisualGroup(data);
    if (group === 'offline') return offlineIcon || busyIcon || freeIcon;
    if (group === 'busy') return busyIcon || freeIcon;
    return freeIcon;
}

function formatLiveMapTime(value) {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleTimeString('pt-MZ', { hour: '2-digit', minute: '2-digit' });
}

function formatLiveMapAge(value) {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return 'sem hora';
    const diff = Math.max(0, Date.now() - date.getTime());
    const seconds = Math.round(diff / 1000);
    if (seconds < 45) return 'agora';
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} min atrás`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} h atrás`;
    const days = Math.round(hours / 24);
    return `${days} d atrás`;
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function setLiveMapSyncState(message, mode = 'active') {
    const el = document.getElementById('live-map-sync-state');
    const panel = document.getElementById('live-map-corner-panel');
    if (el) el.textContent = message;
    if (panel) panel.dataset.state = mode;
}

function setLiveMapPressed(id, value) {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.classList.toggle('active', Boolean(value));
    btn.setAttribute('aria-pressed', String(Boolean(value)));
}

function syncLiveMapEnhancedControls() {
    const shell = document.querySelector('#mapa-tempo-real .live-map-dashboard-shell');
    if (shell) {
        shell.classList.toggle('live-map-panel-hidden', !liveMapPanelVisible);
        shell.classList.toggle('live-map-mini-mode', liveMapMiniMode);
    }
    setLiveMapPressed('btn-live-map-trails', liveMapTrailsVisible);
    setLiveMapPressed('btn-live-map-panel', liveMapPanelVisible);
    setLiveMapPressed('btn-live-map-density', liveMapMiniMode);
}

function updateLiveMapFocusCard() {
    const card = document.getElementById('live-map-focus-card');
    if (!card) return;

    const selected = focusedDriverId ? liveDriverStore.get(focusedDriverId) : null;
    if (!selected) {
        card.classList.remove('has-driver');
        card.innerHTML = '<i class="fas fa-hand-pointer"></i><span>Toque num motorista para seguir, ver estado e última posição.</span>';
        return;
    }

    const group = getDriverVisualGroup(selected);
    const name = escapeLiveMapHtml(selected.driverName || selected.nome || 'Motorista');
    const status = escapeLiveMapHtml(getDriverStatusLabel(selected.status || 'online_livre'));
    const age = escapeLiveMapHtml(formatLiveMapAge(selected.updatedAt));
    const accuracy = Number(selected.accuracy);
    const gps = Number.isFinite(accuracy) ? `GPS ±${Math.round(accuracy)}m` : 'GPS activo';

    card.classList.add('has-driver');
    card.dataset.group = group;
    card.innerHTML = `
        <i class="fas fa-motorcycle"></i>
        <span><strong>${name}</strong><small>${status} · ${age} · ${escapeLiveMapHtml(gps)}</small></span>
    `;
}

function initializeMapIcons() {
    const makeDotIcon = (statusClass) => L.divIcon({
        className: `driver-dot-marker ${statusClass}`,
        html: '<span></span><i></i>',
        iconSize: [28, 28],
        iconAnchor: [14, 14],
        popupAnchor: [0, -14]
    });

    freeIcon = makeDotIcon('driver-dot-green');
    busyIcon = makeDotIcon('driver-dot-orange');
    offlineIcon = makeDotIcon('driver-dot-red');
}

function initializeFormMap() {
    const maputoCoords = MAPUTO_CENTER;

    if (map) {
        destroyFormMap();
    }

    try {
        map = L.map('map').setView(maputoCoords, 13);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
            subdomains: 'abcd',
            maxZoom: 20,
            attribution: '&copy; OpenStreetMap &copy; CARTO'
        }).addTo(map);

        mapMarker = L.marker(maputoCoords, { draggable: true }).addTo(map);

        mapMarker.on('dragend', (event) => {
            const position = event.target.getLatLng();
            document.getElementById('delivery-lng').value = position.lng;
            document.getElementById('delivery-lat').value = position.lat;
            if (window.TragoGeoPricing) {
                window.TragoGeoPricing.setCoords('delivery', { lat: position.lat, lng: position.lng }, document.getElementById('delivery-address')?.value || 'Pin no mapa');
            }
        });

        map.on('click', (event) => {
            const position = event.latlng;
            mapMarker.setLatLng(position);
            document.getElementById('delivery-lng').value = position.lng;
            document.getElementById('delivery-lat').value = position.lat;
            if (window.TragoGeoPricing) {
                window.TragoGeoPricing.setCoords('delivery', { lat: position.lat, lng: position.lng }, document.getElementById('delivery-address')?.value || 'Pin no mapa');
            }
        });

        document.getElementById('delivery-lng').value = '';
        document.getElementById('delivery-lat').value = '';
    } catch (error) {
        console.error('Erro ao inicializar o mapa do formulário:', error);
        const formMapEl = document.getElementById('map');
        if (formMapEl) formMapEl.innerHTML = '<p class="map-error-state">Erro ao carregar o mapa.</p>';
    }
}

function destroyFormMap() {
    if (map) {
        map.remove();
        map = null;
        mapMarker = null;
    }
}

function setFormMapDeliveryPosition(lat, lng) {
    if (!map || !mapMarker || !isValidMapCoordinate(lat) || !isValidMapCoordinate(lng)) return;
    const nextLatLng = [Number(lat), Number(lng)];
    mapMarker.setLatLng(nextLatLng);
    map.setView(nextLatLng, Math.max(map.getZoom(), 15));
    const latEl = document.getElementById('delivery-lat');
    const lngEl = document.getElementById('delivery-lng');
    if (latEl) latEl.value = Number(lat);
    if (lngEl) lngEl.value = Number(lng);
}
window.setFormMapDeliveryPosition = setFormMapDeliveryPosition;

function initializeLiveMap() {
    if (liveMap) {
        setTimeout(() => liveMap?.invalidateSize(), 120);
        return;
    }

    try {
        liveMap = L.map('live-map-container', {
            zoomControl: false,
            attributionControl: true,
            preferCanvas: true,
            scrollWheelZoom: true
        }).setView(MAPUTO_CENTER, 12);

        L.control.zoom({ position: 'bottomright' }).addTo(liveMap);

        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
            subdomains: 'abcd',
            maxZoom: 20,
            minZoom: 5,
            keepBuffer: 4,
            attribution: '&copy; OpenStreetMap &copy; CARTO'
        }).addTo(liveMap);

        setLiveMapSyncState('A ligar realtime...', 'loading');

        if (socket && typeof socket.emit === 'function') {
            socket.emit('admin_request_all_locations');
        }

        fetchLiveDriverLocations();
        liveMapRefreshTimer = setInterval(fetchLiveDriverLocations, 20000);
        liveMapUiTimer = setInterval(updateLiveMapUI, 30000);

        setTimeout(() => liveMap?.invalidateSize(), 150);
        setTimeout(() => liveMap?.invalidateSize(), 550);
    } catch (error) {
        console.error('Erro ao inicializar o mapa em tempo real:', error);
        const mapEl = document.getElementById('live-map-container');
        if (mapEl) mapEl.innerHTML = '<p>Erro ao carregar o mapa.</p>';
        setLiveMapSyncState('Erro no mapa', 'error');
    }
}

function destroyLiveMap() {
    if (liveMapRefreshTimer) {
        clearInterval(liveMapRefreshTimer);
        liveMapRefreshTimer = null;
    }
    if (liveMapUiTimer) {
        clearInterval(liveMapUiTimer);
        liveMapUiTimer = null;
    }
    if (liveMap) {
        liveMap.remove();
        liveMap = null;
    }
    driverMarkers = {};
    driverTrails = {};
    liveDriverStore = new Map();
    focusedDriverId = null;
    followFocusedDriver = false;
    updateLiveMapUI();
}

async function fetchLiveDriverLocations() {
    if (!liveMap) return;
    setLiveMapSyncState('Sync...', 'loading');

    try {
        const response = await fetch(`${API_URL}/api/drivers/live-locations`, {
            headers: getAuthHeaders('admin')
        });

        if (response.status === 401) {
            await handle401Safely('admin');
            return;
        }

        const data = await readJsonResponse(response);
        if (!response.ok) throw new Error(data.message || 'Erro ao carregar localizações.');

        (data.drivers || []).forEach(updateDriverMarker);
        setText('live-map-last-updated', `Sync: ${formatLiveMapTime(new Date())}`);
        setLiveMapSyncState('Live activo', 'active');
        updateLiveMapUI();
    } catch (error) {
        console.warn('Falha ao carregar fallback de localizações do mapa:', error.message || error);
        setLiveMapSyncState('Falha', 'error');
    }
}

function buildDriverPopupContent(driverId, data) {
    const group = getDriverVisualGroup(data);
    const driverName = data.driverName || data.nome || 'Motorista';
    const statusLabel = getDriverStatusLabel(data.status || 'online_livre');
    const updatedAt = data.updatedAt ? formatLiveMapTime(data.updatedAt) : '—';
    const age = formatLiveMapAge(data.updatedAt);
    const lat = Number(data.lat).toFixed(5);
    const lng = Number(data.lng).toFixed(5);
    const accuracy = Number(data.accuracy);
    const gpsText = Number.isFinite(accuracy) ? `GPS ±${Math.round(accuracy)}m` : 'GPS sem precisão';

    return `
        <div class="live-map-popup">
            <strong>${escapeLiveMapHtml(driverName)}</strong>
            <span class="live-map-popup-status live-map-popup-${group}">${escapeLiveMapHtml(statusLabel)}</span>
            <small>Últ.: ${escapeLiveMapHtml(updatedAt)} · ${escapeLiveMapHtml(age)}</small>
            <small>${escapeLiveMapHtml(gpsText)}</small>
            <small>Coord.: ${lat}, ${lng}</small>
            <button type="button" onclick="window.focusLiveDriverOnMap && window.focusLiveDriverOnMap(decodeURIComponent('${encodeURIComponent(driverId)}'))">Focar</button>
        </div>
    `;
}

function animateMarkerTo(marker, nextLatLng, duration = 620) {
    if (!marker || !marker.getLatLng) return;
    const start = marker.getLatLng();
    const end = L.latLng(nextLatLng[0], nextLatLng[1]);
    const startTime = performance.now();

    if (Math.abs(start.lat - end.lat) > 0.02 || Math.abs(start.lng - end.lng) > 0.02) {
        marker.setLatLng(end);
        return;
    }

    function step(now) {
        const progress = Math.min(1, (now - startTime) / duration);
        const eased = 1 - Math.pow(1 - progress, 3);
        const lat = start.lat + (end.lat - start.lat) * eased;
        const lng = start.lng + (end.lng - start.lng) * eased;
        marker.setLatLng([lat, lng]);
        if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
}

function updateDriverTrail(driverId, latLng, data) {
    if (!liveMap) return;
    const group = getDriverVisualGroup(data);
    const entry = driverTrails[driverId] || { points: [], layer: null };
    const last = entry.points[entry.points.length - 1];

    if (!last || Math.abs(last[0] - latLng[0]) > 0.00004 || Math.abs(last[1] - latLng[1]) > 0.00004) {
        entry.points.push(latLng);
        if (entry.points.length > 18) entry.points.shift();
    }

    if (!entry.layer) {
        entry.layer = L.polyline(entry.points, {
            color: group === 'busy' ? '#f59e0b' : '#2f7a3c',
            weight: 3,
            opacity: liveMapTrailsVisible ? 0.42 : 0,
            lineCap: 'round',
            lineJoin: 'round',
            dashArray: group === 'offline' ? '6, 8' : null,
            interactive: false
        }).addTo(liveMap);
        setTimeout(() => entry.layer?.getElement?.()?.classList.add('trago-live-trail-animated'), 80);
    } else {
        entry.layer.setLatLngs(entry.points);
        entry.layer.setStyle({
            color: group === 'busy' ? '#f59e0b' : group === 'offline' ? '#94a3b8' : '#2f7a3c',
            opacity: liveMapTrailsVisible ? (group === 'offline' ? 0.18 : 0.42) : 0,
            dashArray: group === 'offline' ? '6, 8' : null
        });
    }

    driverTrails[driverId] = entry;
}

function updateDriverMarker(data) {
    if (!data) return;

    const driverId = normalizeDriverMarkerId(data);
    const lat = Number(data.lat);
    const lng = Number(data.lng);

    if (!driverId || !isValidMapCoordinate(lat) || !isValidMapCoordinate(lng)) return;

    const previous = liveDriverStore.get(driverId) || {};
    const normalized = {
        ...previous,
        ...data,
        driverId,
        driverName: data.driverName || data.nome || previous.driverName || 'Motorista',
        status: data.status || previous.status || 'online_livre',
        lat,
        lng,
        accuracy: data.accuracy ?? previous.accuracy ?? null,
        updatedAt: data.updatedAt || new Date().toISOString()
    };

    liveDriverStore.set(driverId, normalized);

    if (!liveMap) return;

    const newLatLng = [lat, lng];
    const iconToUse = getIconForDriver(normalized);
    const popupContent = buildDriverPopupContent(driverId, normalized);

    if (driverMarkers[driverId]) {
        animateMarkerTo(driverMarkers[driverId], newLatLng);
        driverMarkers[driverId].setPopupContent(popupContent);
        driverMarkers[driverId].setIcon(iconToUse);
    } else {
        driverMarkers[driverId] = L.marker(newLatLng, {
            icon: iconToUse,
            keyboard: false,
            riseOnHover: true,
            zIndexOffset: getDriverVisualGroup(normalized) === 'busy' ? 700 : 500
        }).addTo(liveMap);
        driverMarkers[driverId].bindPopup(popupContent);
        driverMarkers[driverId].bindTooltip(escapeLiveMapHtml(normalized.driverName || 'Motorista'), {
            direction: 'top',
            offset: [0, -12],
            opacity: 0.92,
            sticky: true
        });
        driverMarkers[driverId].on('click', () => focusDriver(driverId, { openPopup: false, fromMarker: true }));
    }

    updateDriverTrail(driverId, newLatLng, normalized);

    if (followFocusedDriver && focusedDriverId === driverId) {
        liveMap.setView(newLatLng, Math.max(liveMap.getZoom(), 15), { animate: true });
    }

    updateLiveMapUI();
}

function updateDriverMarkerStatus(data) {
    const driverId = normalizeDriverMarkerId(data);
    const status = data?.newStatus || data?.status;
    if (!driverId || !status) return;

    const previous = liveDriverStore.get(driverId);
    if (!previous) {
        if (!liveMap || !driverMarkers[driverId]) return;
        const currentLatLng = driverMarkers[driverId].getLatLng();
        updateDriverMarker({ driverId, driverName: data.driverName || 'Motorista', status, lat: currentLatLng.lat, lng: currentLatLng.lng, updatedAt: data.updatedAt || new Date().toISOString() });
        return;
    }

    updateDriverMarker({ ...previous, ...data, driverId, status, updatedAt: data.updatedAt || new Date().toISOString() });
}

function removeDriverMarker(data) {
    const driverId = normalizeDriverMarkerId(data);
    if (!driverId) return;

    const previous = liveDriverStore.get(driverId);
    if (previous) {
        liveDriverStore.set(driverId, { ...previous, status: 'offline', updatedAt: new Date().toISOString() });
    }

    if (liveMap && driverMarkers[driverId]) {
        driverMarkers[driverId].setIcon(offlineIcon || busyIcon || freeIcon);
        driverMarkers[driverId].setOpacity(0.55);
        const current = liveDriverStore.get(driverId) || data || {};
        driverMarkers[driverId].setPopupContent(buildDriverPopupContent(driverId, current));
    }

    updateLiveMapUI();
}

function driverMatchesFilter(data) {
    const group = getDriverVisualGroup(data);
    if (liveMapFilter === 'all') return true;
    return group === liveMapFilter;
}

function updateLiveMapUI() {
    const drivers = [...liveDriverStore.entries()].map(([id, data]) => ({ id, data, group: getDriverVisualGroup(data) }));
    const counts = {
        all: drivers.length,
        free: drivers.filter(item => item.group === 'free').length,
        busy: drivers.filter(item => item.group === 'busy').length,
        offline: drivers.filter(item => item.group === 'offline').length
    };

    setText('live-map-count-all', counts.all);
    setText('live-map-count-free', counts.free);
    setText('live-map-count-busy', counts.busy);
    setText('live-map-count-offline', counts.offline);

    document.querySelectorAll('[data-driver-filter]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.driverFilter === liveMapFilter);
    });

    const visibleDrivers = drivers
        .filter(({ data }) => driverMatchesFilter(data))
        .sort((a, b) => {
            const weight = { busy: 0, free: 1, offline: 2 };
            return (weight[a.group] - weight[b.group]) || String(a.data.driverName || '').localeCompare(String(b.data.driverName || ''));
        });

    setText('live-map-visible-count', visibleDrivers.length);
    renderLiveDriversList(visibleDrivers);
    applyLiveMapFilter();
    updateLiveMapFocusCard();
    syncLiveMapEnhancedControls();
}

function renderLiveDriversList(items) {
    const list = document.getElementById('live-drivers-list');
    if (!list) return;

    if (!items.length) {
        list.innerHTML = '<div class="live-driver-empty"><i class="fas fa-location-dot"></i><span>Sem localização nesta vista.</span></div>';
        return;
    }

    list.innerHTML = items.map(({ id, data, group }) => {
        const name = data.driverName || data.nome || 'Motorista';
        const statusLabel = group === 'offline' ? 'Inact.' : getDriverStatusLabel(data.status || 'online_livre');
        const updated = data.updatedAt ? formatLiveMapTime(data.updatedAt) : '—';
        const age = formatLiveMapAge(data.updatedAt);
        const selected = focusedDriverId === id ? ' active' : '';
        return `
            <button type="button" class="live-driver-item${selected}" data-driver-focus="${escapeLiveMapHtml(id)}">
                <span class="live-driver-dot live-driver-dot-${group}"></span>
                <span class="live-driver-copy">
                    <strong>${escapeLiveMapHtml(name)}</strong>
                    <small>${escapeLiveMapHtml(statusLabel)} · ${escapeLiveMapHtml(updated)} · ${escapeLiveMapHtml(age)}</small>
                </span>
                <i class="fas fa-chevron-right"></i>
            </button>
        `;
    }).join('');

    list.querySelectorAll('[data-driver-focus]').forEach(btn => {
        btn.addEventListener('click', () => focusDriver(btn.dataset.driverFocus, { openPopup: true }));
    });
}

function applyLiveMapFilter() {
    Object.entries(driverMarkers).forEach(([id, marker]) => {
        const data = liveDriverStore.get(id);
        const visible = data ? driverMatchesFilter(data) : true;
        const selected = focusedDriverId && focusedDriverId === id;
        marker.setOpacity(visible ? 1 : 0.14);
        const el = marker.getElement?.();
        if (el) {
            el.classList.toggle('driver-marker-dimmed', !visible);
            el.classList.toggle('driver-marker-selected', Boolean(selected));
        }
    });

    Object.entries(driverTrails).forEach(([id, entry]) => {
        const data = liveDriverStore.get(id);
        const visible = data ? driverMatchesFilter(data) : true;
        if (entry.layer) {
            const baseOpacity = liveMapTrailsVisible ? (getDriverVisualGroup(data) === 'offline' ? 0.18 : 0.42) : 0;
            entry.layer.setStyle({ opacity: visible ? baseOpacity : 0.03 });
        }
    });
}

function fitLiveMapToVisibleDrivers() {
    if (!liveMap) return;
    const layers = Object.entries(driverMarkers)
        .filter(([id]) => {
            const data = liveDriverStore.get(id);
            return data && driverMatchesFilter(data);
        })
        .map(([, marker]) => marker)
        .filter(Boolean);

    if (!layers.length) {
        liveMap.setView(MAPUTO_CENTER, 12, { animate: true });
        return;
    }

    try {
        const group = L.featureGroup(layers);
        liveMap.fitBounds(group.getBounds().pad(0.18), {
            animate: true,
            maxZoom: 15,
            paddingTopLeft: [22, 22],
            paddingBottomRight: [22, 22]
        });
    } catch (_) {
        liveMap.setView(MAPUTO_CENTER, 12, { animate: true });
    }
}

function focusDriver(driverId, { openPopup = true } = {}) {
    if (!liveMap || !driverId || !driverMarkers[driverId]) return;
    focusedDriverId = driverId;
    const marker = driverMarkers[driverId];
    const latLng = marker.getLatLng();
    liveMap.setView(latLng, Math.max(liveMap.getZoom(), 16), { animate: true });
    if (openPopup) marker.openPopup();
    updateLiveMapFocusCard();
    updateLiveMapUI();
}
window.focusLiveDriverOnMap = focusDriver;

function initLiveMapControls() {
    document.getElementById('btn-live-map-refresh')?.addEventListener('click', fetchLiveDriverLocations);
    document.getElementById('btn-live-map-fit')?.addEventListener('click', fitLiveMapToVisibleDrivers);
    document.getElementById('btn-live-map-maputo')?.addEventListener('click', () => liveMap?.setView(MAPUTO_CENTER, 12, { animate: true }));
    document.getElementById('btn-live-map-trails')?.addEventListener('click', () => {
        liveMapTrailsVisible = !liveMapTrailsVisible;
        applyLiveMapFilter();
        syncLiveMapEnhancedControls();
    });
    document.getElementById('btn-live-map-panel')?.addEventListener('click', () => {
        liveMapPanelVisible = !liveMapPanelVisible;
        syncLiveMapEnhancedControls();
        setTimeout(() => liveMap?.invalidateSize(), 180);
    });
    document.getElementById('btn-live-map-density')?.addEventListener('click', () => {
        liveMapMiniMode = !liveMapMiniMode;
        syncLiveMapEnhancedControls();
        setTimeout(() => liveMap?.invalidateSize(), 180);
        setTimeout(() => liveMap?.invalidateSize(), 420);
    });
    document.getElementById('btn-live-map-follow')?.addEventListener('click', (event) => {
        followFocusedDriver = !followFocusedDriver;
        event.currentTarget.classList.toggle('active', followFocusedDriver);
        event.currentTarget.setAttribute('aria-pressed', String(followFocusedDriver));
        if (followFocusedDriver && focusedDriverId) focusDriver(focusedDriverId, { openPopup: false });
    });
    document.querySelectorAll('[data-driver-filter]').forEach(btn => {
        btn.addEventListener('click', () => {
            liveMapFilter = btn.dataset.driverFilter || 'all';
            updateLiveMapUI();
            fitLiveMapToVisibleDrivers();
        });
    });
}

document.addEventListener('DOMContentLoaded', initLiveMapControls);
