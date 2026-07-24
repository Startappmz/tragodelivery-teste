/*
 * Trago Delivery · Mapa interno do motorista
 * Intervenção de raiz:
 * - Leaflet isolado dentro do painel, sem abrir mapa externo.
 * - Aguarda o container estar visível antes de inicializar o mapa.
 * - Corrige tiles quebrados causados por renderização em secção oculta.
 * - Mostra recolha, entrega, rota e posição do motorista.
 */
(function () {
    let map = null;
    let tileLayer = null;
    let pickupMarker = null;
    let deliveryMarker = null;
    let driverMarker = null;
    let driverAccuracyCircle = null;
    let routeCasingLayer = null;
    let routeLayer = null;
    let driverTrailLayer = null;
    let driverTrailPoints = [];
    let currentOrder = null;
    let lastDriverPosition = null;
    let resizeObserver = null;
    let renderSequence = 0;
    let followDriver = false;
    let markerAnimationFrame = null;
    let compactMapMode = false;
    let mapStatusControl = null;
    let mapPartners = [];
    let mapPartnersPromise = null;

    const DEFAULT_CENTER = [-25.9655, 32.5832];
    const DEFAULT_ZOOM = 13;

    async function loadMapPartners() {
        if (mapPartnersPromise) return mapPartnersPromise;
        mapPartnersPromise = (async () => {
            try {
                const response = await fetch(`${API_URL}/api/public/partners`);
                const data = await readJsonResponse(response);
                if (!response.ok) throw new Error(data.message || 'Parceiros indisponíveis.');
                mapPartners = (Array.isArray(data.partners) ? data.partners : []).filter((partner) => isValidCoord(partner?.address_coords));
                if (map) window.TragoMapUI?.syncPartnerLayer?.(map, mapPartners);
                return mapPartners;
            } catch (_error) {
                return mapPartners;
            } finally {
                mapPartnersPromise = null;
            }
        })();
        return mapPartnersPromise;
    }

    function isValidCoord(coord) {
        if (!coord || coord.lat === '' || coord.lng === '' || coord.lat === null || coord.lng === null) return false;
        const lat = Number(coord.lat);
        const lng = Number(coord.lng);
        return Number.isFinite(lat) && Number.isFinite(lng)
            && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
            && !(Math.abs(lat) < 0.000001 && Math.abs(lng) < 0.000001);
    }

    function toLatLng(coord) {
        return [Number(coord.lat), Number(coord.lng)];
    }

    function setMapStatus(message) {
        const el = document.getElementById('driver-map-status');
        if (el) el.textContent = message;
    }

    function setLocationState(message, mode = 'idle') {
        const el = document.getElementById('driver-location-state');
        if (!el) return;
        el.textContent = message;
        el.dataset.state = mode;
    }

    function setMapGuidance(message, mode = 'idle') {
        const box = document.getElementById('driver-map-guidance');
        const text = document.getElementById('driver-map-guidance-text');
        if (text) text.textContent = message;
        if (box) box.dataset.mode = mode;
    }

    function getActiveRouteTarget() {
        const status = currentOrder?.status || '';
        if (status === 'entrega_em_progresso' || status === 'recolha_concluida') {
            return { label: 'entrega', coord: currentOrder?.address_coords, icon: 'fa-flag-checkered' };
        }
        return { label: 'recolha', coord: currentOrder?.pickup_address_coords, icon: 'fa-box-open' };
    }

    function updateRouteGuidance(position = lastDriverPosition) {
        if (!currentOrder) {
            setMapGuidance('A aguardar pedido para orientar a rota.');
            return;
        }

        const target = getActiveRouteTarget();
        if (!isValidCoord(target.coord)) {
            setMapGuidance('Este pedido ainda não tem coordenadas suficientes.', 'warning');
            return;
        }

        if (!isValidCoord(position)) {
            setMapGuidance(`Siga para a ${target.label}; GPS ainda sem posição actual.`, 'waiting');
            return;
        }

        const km = distanceKm(position, target.coord);
        if (!Number.isFinite(km)) {
            setMapGuidance(`Siga para a ${target.label}.`, 'waiting');
            return;
        }

        if (km <= 0.08) {
            setMapGuidance(`Está muito perto da ${target.label}. Confirme o ponto antes de avançar.`, 'near');
            return;
        }

        setMapGuidance(`Próximo passo: ${target.label} · ${formatDistance(km)} restantes.`, 'active');
    }

    function setDriverButtonPressed(id, value) {
        const btn = document.getElementById(id);
        if (!btn) return;
        btn.classList.toggle('is-active', Boolean(value));
        btn.setAttribute('aria-pressed', String(Boolean(value)));
    }

    function setHudValue(id, value) {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    }

    function formatDistance(km) {
        if (!Number.isFinite(km)) return '—';
        if (km < 1) return `${Math.max(1, Math.round(km * 1000))} m`;
        return `${km.toFixed(km < 10 ? 1 : 0)} km`;
    }

    function distanceKm(a, b) {
        if (!isValidCoord(a) || !isValidCoord(b)) return NaN;
        const R = 6371;
        const lat1 = Number(a.lat) * Math.PI / 180;
        const lat2 = Number(b.lat) * Math.PI / 180;
        const dLat = (Number(b.lat) - Number(a.lat)) * Math.PI / 180;
        const dLng = (Number(b.lng) - Number(a.lng)) * Math.PI / 180;
        const sinLat = Math.sin(dLat / 2);
        const sinLng = Math.sin(dLng / 2);
        const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
        return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
    }

    function updateRouteHud(position = lastDriverPosition) {
        const pickup = currentOrder?.pickup_address_coords;
        const delivery = currentOrder?.address_coords;
        const accuracy = Number(position?.accuracy);

        setHudValue('driver-map-accuracy', Number.isFinite(accuracy) ? `±${Math.round(accuracy)} m` : '—');

        if (!isValidCoord(position)) {
            setHudValue('driver-map-distance-pickup', '—');
            setHudValue('driver-map-distance-delivery', '—');
            updateRouteGuidance(position);
            return;
        }

        setHudValue('driver-map-distance-pickup', formatDistance(distanceKm(position, pickup)));
        setHudValue('driver-map-distance-delivery', formatDistance(distanceKm(position, delivery)));
        updateRouteGuidance(position);
    }

    function getMapElement() {
        return document.getElementById('driver-route-map');
    }

    function isMapElementReady(mapEl) {
        if (!mapEl) return false;
        const rect = mapEl.getBoundingClientRect();
        return rect.width >= 220 && rect.height >= 145 && mapEl.offsetParent !== null;
    }

    function waitForVisibleMap(maxAttempts = 20) {
        return new Promise((resolve) => {
            let attempts = 0;
            const check = () => {
                const mapEl = getMapElement();
                if (isMapElementReady(mapEl)) {
                    resolve(mapEl);
                    return;
                }
                attempts += 1;
                if (attempts >= maxAttempts) {
                    resolve(mapEl || null);
                    return;
                }
                setTimeout(check, 90);
            };
            requestAnimationFrame(check);
        });
    }

    function createDivIcon(type, label, icon) {
        if (window.TragoMapUI?.createPointIcon) {
            return window.TragoMapUI.createPointIcon(type, label);
        }
        return L.divIcon({
            className: `trago-map-pin trago-map-pin-${type}`,
            html: `<span><i class="fas ${icon}"></i></span><small>${label}</small>`,
            iconSize: [78, 48],
            iconAnchor: [23, 38],
            popupAnchor: [0, -36]
        });
    }

    function createDriverPositionIcon() {
        return L.divIcon({
            className: 'trago-driver-position-icon',
            html: `
                <span class="trago-driver-position-pulse"></span>
                <span class="trago-driver-position-dot"><i class="fa-solid fa-motorcycle"></i></span>
                <small>Você</small>
            `,
            iconSize: [72, 72],
            iconAnchor: [36, 36],
            popupAnchor: [0, -34]
        });
    }

    function invalidateMapLayout(times = 6) {
        if (!map) return;
        const delays = [0, 60, 150, 320, 650, 1000].slice(0, Math.max(1, times));
        delays.forEach((delay) => setTimeout(() => {
            try {
                map.invalidateSize({ animate: false, pan: false });
            } catch (_) {}
        }, delay));
    }

    function ensureMap(mapEl) {
        if (!mapEl || !window.L) return null;

        if (map) {
            invalidateMapLayout(6);
            return map;
        }

        map = L.map(mapEl, {
            zoomControl: false,
            attributionControl: true,
            scrollWheelZoom: true,
            preferCanvas: true,
            fadeAnimation: false,
            zoomAnimation: true,
            markerZoomAnimation: true
        }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);

        if (window.TragoMapUI?.addBaseLayer) {
            tileLayer = window.TragoMapUI.addBaseLayer(map, {
                minZoom: 5,
                updateWhenIdle: false,
                updateWhenZooming: false
            });
            window.TragoMapUI.addZoomControl?.(map);
            mapStatusControl = window.TragoMapUI.addStatusControl?.(map, {
                label: 'Navegação activa',
                icon: 'fa-circle',
                tone: 'live',
                position: 'topright'
            }) || null;
            window.TragoMapUI.syncPartnerLayer?.(map, mapPartners);
            loadMapPartners();
        } else {
            L.control.zoom({ position: 'bottomright' }).addTo(map);
            tileLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
                subdomains: 'abcd',
                maxZoom: 20,
                minZoom: 5,
                updateWhenIdle: false,
                updateWhenZooming: false,
                keepBuffer: 4,
                attribution: '&copy; OpenStreetMap &copy; CARTO'
            }).addTo(map);
        }

        map.whenReady(() => {
            invalidateMapLayout(6);
            setTimeout(() => {
                try { map.setView(DEFAULT_CENTER, DEFAULT_ZOOM, { animate: false }); } catch (_) {}
            }, 120);
        });

        if ('ResizeObserver' in window && !resizeObserver) {
            resizeObserver = new ResizeObserver(() => invalidateMapLayout(4));
            resizeObserver.observe(mapEl);
        }

        window.addEventListener('resize', () => invalidateMapLayout(4));
        return map;
    }

    function clearRoute() {
        if (!map) return;
        [pickupMarker, deliveryMarker, routeCasingLayer, routeLayer, driverTrailLayer].forEach((layer) => {
            if (layer) map.removeLayer(layer);
        });
        pickupMarker = null;
        deliveryMarker = null;
        routeCasingLayer = null;
        routeLayer = null;
        driverTrailLayer = null;
        driverTrailPoints = [];
        updateRouteHud(null);
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function compactPlaceName(value, fallback = 'Morada não informada') {
        const raw = String(value || '').replace(/\s+/g, ' ').trim();
        if (!raw) return fallback;
        const ignored = [/^moçambique$/i, /^mozambique$/i, /^cidade de maputo$/i, /^zona sul$/i, /^zona norte$/i, /^zona centro$/i, /^distrito municipal/i, /^\d{3,}[-–]?\d*$/i];
        const parts = raw.split(',')
            .map(part => part.replace(/[“”"']/g, '').replace(/\s+/g, ' ').trim())
            .filter(Boolean)
            .filter(part => !ignored.some(rx => rx.test(part)))
            .map(part => part.replace(/^Avenida\s+/i, 'Av. '));
        let selected = parts.slice(0, 3);
        if (!selected.length) selected = raw.split(',').map(p => p.trim()).filter(Boolean).slice(0, 2);
        let short = selected.join(' · ');
        if (short.length > 72 && selected.length > 2) short = selected.slice(0, 2).join(' · ');
        if (short.length > 72) short = `${short.slice(0, 69).trim()}…`;
        return short || fallback;
    }

    function applyRouteMotion(layer = routeLayer) {
        if (!layer) return;
        setTimeout(() => {
            const path = layer.getElement?.();
            if (path) path.classList.add('trago-route-line-animated');
        }, 60);
    }

    function drawFallbackLine(origin, destination) {
        if (!map || !isValidCoord(origin) || !isValidCoord(destination)) return;
        const points = [toLatLng(origin), toLatLng(destination)];
        if (window.TragoMapUI?.drawRoute) {
            const route = window.TragoMapUI.drawRoute(map, points, {
                color: '#69be35',
                weight: 6,
                opacity: 0.96,
                dashArray: '8 9'
            });
            routeCasingLayer = route.casing;
            routeLayer = route.line;
        } else {
            routeCasingLayer = L.polyline(points, {
                color: '#fff',
                weight: 11,
                opacity: 0.94,
                lineCap: 'round',
                lineJoin: 'round'
            }).addTo(map);
            routeLayer = L.polyline(points, {
                color: '#69be35',
                weight: 6,
                opacity: 0.96,
                dashArray: '8 9',
                lineCap: 'round',
                lineJoin: 'round'
            }).addTo(map);
        }
        applyRouteMotion(routeLayer);
        fitRoute();
    }

    function geoJsonToLatLngs(geometry) {
        if (!geometry || geometry.type !== 'LineString' || !Array.isArray(geometry.coordinates)) return [];
        return geometry.coordinates
            .filter((point) => Array.isArray(point) && point.length >= 2)
            .map((point) => [Number(point[1]), Number(point[0])])
            .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng));
    }

    async function fetchRoute(origin, destination) {
        const response = await fetch(`${API_URL}/api/geo/route`, {
            method: 'POST',
            headers: { ...getAuthHeaders('driver'), 'Content-Type': 'application/json' },
            body: JSON.stringify({ origin, destination })
        });
        const data = await readJsonResponse(response);
        if (!response.ok) throw new Error(data.message || 'Não foi possível carregar a rota.');
        return data;
    }

    async function renderOrderRoute(order) {
        currentOrder = order;
        updateRouteGuidance(lastDriverPosition);
        const sequence = ++renderSequence;
        const mapEl = await waitForVisibleMap();
        if (sequence !== renderSequence) return;

        const activeMap = ensureMap(mapEl);
        if (!activeMap) {
            setMapStatus('Não foi possível carregar o mapa interno.');
            return;
        }

        invalidateMapLayout(6);
        clearRoute();

        const pickup = order?.pickup_address_coords;
        const delivery = order?.address_coords;

        if (!isValidCoord(pickup) || !isValidCoord(delivery)) {
            setMapStatus('Este pedido ainda não tem coordenadas completas de recolha e entrega.');
            activeMap.setView(DEFAULT_CENTER, DEFAULT_ZOOM, { animate: false });
            return;
        }

        pickupMarker = L.marker(toLatLng(pickup), {
            icon: createDivIcon('pickup', 'Recolha', 'fa-box-open'),
            keyboard: false
        }).addTo(activeMap).bindPopup(`<strong>Ponto de Recolha</strong><br>${escapeHtml(compactPlaceName(order.pickup_address_text, 'Morada não informada'))}`);

        deliveryMarker = L.marker(toLatLng(delivery), {
            icon: createDivIcon('delivery', 'Entrega', 'fa-flag-checkered'),
            keyboard: false
        }).addTo(activeMap).bindPopup(`<strong>Ponto de Entrega</strong><br>${escapeHtml(compactPlaceName(order.address_text, 'Morada não informada'))}`);

        setMapStatus('A calcular rota interna...');

        try {
            const route = await fetchRoute(pickup, delivery);
            if (sequence !== renderSequence) return;
            const latLngs = geoJsonToLatLngs(route.geometry);
            if (latLngs.length >= 2) {
                if (window.TragoMapUI?.drawRoute) {
                    const renderedRoute = window.TragoMapUI.drawRoute(activeMap, latLngs, {
                        color: '#69be35',
                        weight: 7,
                        opacity: 0.98
                    });
                    routeCasingLayer = renderedRoute.casing;
                    routeLayer = renderedRoute.line;
                } else {
                    routeCasingLayer = L.polyline(latLngs, {
                        color: '#fff',
                        weight: 12,
                        opacity: 0.94,
                        lineCap: 'round',
                        lineJoin: 'round'
                    }).addTo(activeMap);
                    routeLayer = L.polyline(latLngs, {
                        color: '#69be35',
                        weight: 7,
                        opacity: 0.98,
                        lineCap: 'round',
                        lineJoin: 'round'
                    }).addTo(activeMap);
                }
                applyRouteMotion(routeLayer);
                const distance = Number(route.distance_km || 0).toFixed(2);
                const duration = route.duration_min ? ` · ${route.duration_min} min` : '';
                setMapStatus(`Rota carregada: ${distance} km${duration}.`);
                fitRoute();
            } else {
                drawFallbackLine(pickup, delivery);
                setMapStatus('Rota estimada carregada.');
            }
        } catch (error) {
            console.warn('[DriverMap] Falha ao carregar rota ORS:', error);
            drawFallbackLine(pickup, delivery);
            setMapStatus('Rota estimada carregada; serviço de rota indisponível.');
        }

        updateDriverMarker(lastDriverPosition);
        updateRouteHud(lastDriverPosition);
        invalidateMapLayout(6);
    }

    function fitRoute() {
        if (!map) return;
        const layers = [pickupMarker, deliveryMarker, routeCasingLayer, routeLayer, driverMarker, driverAccuracyCircle].filter(Boolean);
        if (!layers.length) return;

        invalidateMapLayout(3);
        setTimeout(() => {
            try {
                const group = L.featureGroup(layers);
                map.fitBounds(group.getBounds().pad(0.18), {
                    animate: false,
                    maxZoom: 16,
                    paddingTopLeft: [24, 24],
                    paddingBottomRight: [24, 24]
                });
                invalidateMapLayout(4);
            } catch (error) {
                console.warn('[DriverMap] Não foi possível centralizar rota:', error);
            }
        }, 160);
    }

    function animateDriverMarkerTo(latLng) {
        if (!driverMarker) return;
        if (markerAnimationFrame) cancelAnimationFrame(markerAnimationFrame);

        const start = driverMarker.getLatLng();
        const end = L.latLng(latLng[0], latLng[1]);
        const startTime = performance.now();
        const duration = 520;

        if (Math.abs(start.lat - end.lat) > 0.03 || Math.abs(start.lng - end.lng) > 0.03) {
            driverMarker.setLatLng(end);
            return;
        }

        const step = (now) => {
            const progress = Math.min(1, (now - startTime) / duration);
            const eased = 1 - Math.pow(1 - progress, 3);
            driverMarker.setLatLng([
                start.lat + (end.lat - start.lat) * eased,
                start.lng + (end.lng - start.lng) * eased
            ]);
            if (progress < 1) markerAnimationFrame = requestAnimationFrame(step);
        };
        markerAnimationFrame = requestAnimationFrame(step);
    }

    function updateDriverTrail(latLng) {
        if (!map || !Array.isArray(latLng)) return;
        const last = driverTrailPoints[driverTrailPoints.length - 1];
        if (!last || Math.abs(last[0] - latLng[0]) > 0.00004 || Math.abs(last[1] - latLng[1]) > 0.00004) {
            driverTrailPoints.push(latLng);
            if (driverTrailPoints.length > 28) driverTrailPoints.shift();
        }

        if (driverTrailPoints.length < 2) return;

        if (!driverTrailLayer) {
            driverTrailLayer = L.polyline(driverTrailPoints, {
                color: '#183f29',
                weight: 4,
                opacity: 0.48,
                lineCap: 'round',
                lineJoin: 'round',
                interactive: false
            }).addTo(map);
            setTimeout(() => driverTrailLayer?.getElement?.()?.classList.add('trago-driver-trail-animated'), 80);
        } else {
            driverTrailLayer.setLatLngs(driverTrailPoints);
        }
    }

    function syncFollowButton() {
        const btn = document.getElementById('btn-seguir-motorista');
        if (!btn) return;
        btn.classList.toggle('is-active', followDriver);
        btn.setAttribute('aria-pressed', String(followDriver));
    }

    function updateDriverMarker(position) {
        lastDriverPosition = position;
        if (!map || !isValidCoord(position)) {
            setLocationState('GPS inativo', 'idle');
            return;
        }

        const latLng = toLatLng(position);
        const accuracy = Number(position.accuracy);
        const radius = Number.isFinite(accuracy) ? Math.max(18, Math.min(accuracy, 120)) : 24;

        if (!driverAccuracyCircle) {
            driverAccuracyCircle = L.circle(latLng, {
                radius,
                stroke: true,
                color: '#69be35',
                weight: 1.5,
                opacity: 0.35,
                fillColor: '#69be35',
                fillOpacity: 0.11,
                interactive: false
            }).addTo(map);
        } else {
            driverAccuracyCircle.setLatLng(latLng);
            driverAccuracyCircle.setRadius(radius);
        }

        if (!driverMarker) {
            driverMarker = L.marker(latLng, {
                icon: createDriverPositionIcon(),
                keyboard: false,
                zIndexOffset: 1200
            }).addTo(map).bindPopup('A sua posição actual');
        } else {
            animateDriverMarkerTo(latLng);
        }

        updateDriverTrail(latLng);
        updateRouteHud(position);

        if (followDriver) {
            map.setView(latLng, Math.max(map.getZoom(), 16), { animate: true });
        }

        try {
            driverAccuracyCircle.bringToFront();
            driverMarker.setZIndexOffset(1200);
        } catch (_) {}

        setLocationState(Number.isFinite(accuracy) ? `GPS activo · ±${Math.round(accuracy)}m` : 'GPS activo', 'active');
    }

    function centerOnDriver() {
        if (!map) {
            setMapStatus('O mapa ainda não terminou de carregar.');
            return;
        }

        let latLng = null;
        if (driverMarker) {
            latLng = driverMarker.getLatLng();
        } else if (isValidCoord(lastDriverPosition)) {
            latLng = L.latLng(Number(lastDriverPosition.lat), Number(lastDriverPosition.lng));
            updateDriverMarker(lastDriverPosition);
        }

        if (!latLng) {
            setMapStatus('A posição actual ainda não foi recebida. Confirme a permissão de localização.');
            return;
        }

        invalidateMapLayout(3);
        map.setView(latLng, 17, { animate: true });
        setMapStatus('Mapa centrado na sua posição actual.');
        try {
            driverMarker?.openPopup();
        } catch (_) {}
    }

    function toggleFollowDriver() {
        followDriver = !followDriver;
        syncFollowButton();
        if (followDriver) centerOnDriver();
    }

    function clearDriverTrail() {
        driverTrailPoints = [];
        if (driverTrailLayer) {
            driverTrailLayer.setLatLngs([]);
        }
        setMapStatus('Trilho percorrido limpo.');
    }

    function toggleCompactMap() {
        compactMapMode = !compactMapMode;
        const card = document.querySelector('#detalhe-entrega .driver-map-card');
        if (card) card.classList.toggle('is-mini-map', compactMapMode);
        setDriverButtonPressed('btn-mapa-compacto', compactMapMode);
        invalidateMapLayout(6);
    }

    document.addEventListener('driver_location_updated', (event) => {
        updateDriverMarker(event.detail || null);
    });

    document.addEventListener('DOMContentLoaded', () => {
        document.getElementById('btn-centralizar-rota')?.addEventListener('click', fitRoute);
        document.getElementById('btn-minha-posicao')?.addEventListener('click', centerOnDriver);
        document.getElementById('btn-seguir-motorista')?.addEventListener('click', toggleFollowDriver);
        document.getElementById('btn-limpar-trilho')?.addEventListener('click', clearDriverTrail);
        document.getElementById('btn-mapa-compacto')?.addEventListener('click', toggleCompactMap);
        syncFollowButton();
        setDriverButtonPressed('btn-mapa-compacto', compactMapMode);
    });

    window.TragoDriverMap = {
        renderOrderRoute,
        updateDriverMarker,
        fitRoute,
        centerOnDriver,
        clearDriverTrail,
        toggleCompactMap,
        invalidate: () => invalidateMapLayout(6),
        destroy: () => {
            if (resizeObserver) resizeObserver.disconnect();
            resizeObserver = null;
            if (map) map.remove();
            map = null;
            tileLayer = null;
            pickupMarker = null;
            deliveryMarker = null;
            driverMarker = null;
            driverAccuracyCircle = null;
            routeCasingLayer = null;
            routeLayer = null;
            driverTrailLayer = null;
            driverTrailPoints = [];
            mapStatusControl = null;
            if (markerAnimationFrame) cancelAnimationFrame(markerAnimationFrame);
            markerAnimationFrame = null;
        }
    };
})();
