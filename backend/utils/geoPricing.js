const PRICING_POLICY = Object.freeze({
  baseDistanceKm: Number(process.env.TRAGO_BASE_DISTANCE_KM || 11.6),
  baseFeeMzn: Number(process.env.TRAGO_BASE_DISTANCE_FEE_MZN || 200),
  extraKmFeeMzn: Number(process.env.TRAGO_EXTRA_KM_FEE_MZN || 15)
});

function isValidCoordinate(coord) {
  return coord && Number.isFinite(Number(coord.lat)) && Number.isFinite(Number(coord.lng));
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

async function fetchOpenRouteService(origin, destination) {
  const apiKey = process.env.TRAGO_ORS_API_KEY;
  if (!apiKey || typeof fetch !== 'function') return null;

  const url = new URL('https://api.openrouteservice.org/v2/directions/driving-car');
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('start', `${Number(origin.lng)},${Number(origin.lat)}`);
  url.searchParams.set('end', `${Number(destination.lng)},${Number(destination.lat)}`);

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json, application/geo+json' }
  });

  if (!response.ok) return null;
  const data = await response.json();
  const feature = data?.features?.[0];
  const summary = feature?.properties?.summary;
  if (!summary || !Number.isFinite(Number(summary.distance))) return null;

  return {
    geometry: feature.geometry,
    distance_km: Number(summary.distance) / 1000,
    duration_min: Number.isFinite(Number(summary.duration)) ? Math.max(1, Math.round(Number(summary.duration) / 60)) : null,
    source: 'openrouteservice'
  };
}

async function buildRouteQuote(origin, destination) {
  const route = await buildRouteGeometry(origin, destination);
  return {
    distance_km: route.distance_km,
    duration_min: route.duration_min,
    delivery_fee: Number(Number(route.delivery_fee).toFixed(2)),
    source: route.source,
    policy: PRICING_POLICY
  };
}

async function buildRouteGeometry(origin, destination) {
  if (!isValidCoordinate(origin) || !isValidCoordinate(destination)) {
    throw new Error('Coordenadas de recolha e entrega são obrigatórias.');
  }

  let route = null;
  try {
    route = await fetchOpenRouteService(origin, destination);
  } catch (_error) {
    route = null;
  }

  if (!route || !route.geometry) {
    const distanceKm = haversineKm(origin, destination);
    route = {
      geometry: {
        type: 'LineString',
        coordinates: [
          [Number(origin.lng), Number(origin.lat)],
          [Number(destination.lng), Number(destination.lat)]
        ]
      },
      distance_km: distanceKm,
      duration_min: Math.max(1, Math.round((distanceKm / 35) * 60)),
      source: 'haversine_fallback'
    };
  }

  return {
    origin,
    destination,
    geometry: route.geometry,
    distance_km: Number(Number(route.distance_km).toFixed(2)),
    duration_min: route.duration_min,
    delivery_fee: calculateDeliveryFee(route.distance_km),
    source: route.source
  };
}

module.exports = {
  PRICING_POLICY,
  calculateDeliveryFee,
  haversineKm,
  buildRouteQuote,
  buildRouteGeometry,
  isValidCoordinate
};
