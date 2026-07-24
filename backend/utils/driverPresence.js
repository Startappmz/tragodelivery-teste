const DriverOffer = require('../models/DriverOffer');
const { supabaseRequest } = require('../config/supabase');
const { DRIVER_STATUS } = require('./constants');

const ONLINE_STATUSES = new Set([
  DRIVER_STATUS.ONLINE_FREE,
  DRIVER_STATUS.ONLINE_BUSY,
  DRIVER_STATUS.PICKUP,
  DRIVER_STATUS.DELIVERY
]);

const idOf = (value) => String(value?._id || value?.id || value || '');
const validNumber = (value) => value !== null && value !== undefined && Number.isFinite(Number(value));

const getPresence = async (profileId) => {
  const rows = await supabaseRequest(
    `/rest/v1/driver_presence?driver_profile_id=eq.${encodeURIComponent(idOf(profileId))}&select=*&limit=1`,
    { method: 'GET' }
  );
  return rows?.[0] || null;
};

const presencePatchFromProfile = (profile, patch = {}) => {
  const location = patch.location || profile?.lastLocation || {};
  const now = new Date();
  const status = patch.status || profile?.status || DRIVER_STATUS.OFFLINE;
  const hasLocation = validNumber(location.lat) && validNumber(location.lng);
  const isOnline = patch.isOnline ?? ONLINE_STATUSES.has(status);
  const currentOrderId = patch.currentOrderId === undefined ? null : patch.currentOrderId;

  return {
    driverProfileId: idOf(profile),
    isOnline,
    isAvailable: patch.isAvailable ?? (isOnline && status === DRIVER_STATUS.ONLINE_FREE && !currentOrderId),
    currentOrderId,
    latitude: hasLocation ? Number(location.lat) : null,
    longitude: hasLocation ? Number(location.lng) : null,
    accuracy: validNumber(location.accuracy) ? Number(location.accuracy) : null,
    speed: validNumber(location.speed) ? Number(location.speed) : null,
    heading: validNumber(location.heading) ? Number(location.heading) : null,
    lastSeenAt: patch.lastSeenAt || now,
    locationUpdatedAt: hasLocation ? (location.updatedAt || location.updated_at || now) : null,
    version: Number(patch.version || 1)
  };
};

const syncDriverPresence = async (profile, patch = {}) => {
  if (!profile) return null;
  const profileId = idOf(profile);
  const existing = await getPresence(profileId);
  const payload = presencePatchFromProfile(profile, {
    ...patch,
    currentOrderId: patch.currentOrderId === undefined
      ? (existing?.current_order_id || null)
      : patch.currentOrderId,
    version: Number(existing?.version || 0) + 1
  });
  const rows = await supabaseRequest('/rest/v1/driver_presence?on_conflict=driver_profile_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({
      driver_profile_id: payload.driverProfileId,
      is_online: payload.isOnline,
      is_available: payload.isAvailable,
      current_order_id: payload.currentOrderId || null,
      latitude: payload.latitude,
      longitude: payload.longitude,
      accuracy: payload.accuracy,
      speed: payload.speed,
      heading: payload.heading,
      last_seen_at: new Date(payload.lastSeenAt).toISOString(),
      location_updated_at: payload.locationUpdatedAt ? new Date(payload.locationUpdatedAt).toISOString() : null,
      version: payload.version
    })
  });
  return rows?.[0] || null;
};

const getFreshAvailablePresences = async (heartbeatMaxAgeMs = 60000, locationMaxAgeMs = 600000) => {
  const heartbeatCutoff = encodeURIComponent(new Date(Date.now() - heartbeatMaxAgeMs).toISOString());
  const locationCutoff = encodeURIComponent(new Date(Date.now() - locationMaxAgeMs).toISOString());
  return supabaseRequest(
    `/rest/v1/driver_presence?select=*&is_online=eq.true&is_available=eq.true&current_order_id=is.null&last_seen_at=gte.${heartbeatCutoff}&location_updated_at=gte.${locationCutoff}&latitude=not.is.null&longitude=not.is.null&order=last_seen_at.desc`,
    { method: 'GET' }
  );
};

const getFreshOnlinePresences = async (maxAgeMs = 60000) => {
  const cutoff = encodeURIComponent(new Date(Date.now() - maxAgeMs).toISOString());
  return supabaseRequest(
    `/rest/v1/driver_presence?select=*&is_online=eq.true&last_seen_at=gte.${cutoff}&location_updated_at=gte.${cutoff}&latitude=not.is.null&longitude=not.is.null&order=last_seen_at.desc`,
    { method: 'GET' }
  );
};

const expireDriverOffers = async () => supabaseRequest('/rest/v1/rpc/trago_expire_driver_offers', {
  method: 'POST',
  body: '{}'
});

const cancelPendingDriverOffers = async (orderId) => supabaseRequest(
  `/rest/v1/driver_offers?order_id=eq.${encodeURIComponent(idOf(orderId))}&status=eq.pending`,
  {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      status: 'cancelled',
      responded_at: new Date().toISOString()
    })
  }
);

const createDriverOffer = async ({ orderId, driverProfileId, selectedByRole, selectedById, expiresAt }) => {
  const result = await supabaseRequest('/rest/v1/rpc/trago_create_driver_offer', {
    method: 'POST',
    body: JSON.stringify({
      p_order_id: idOf(orderId),
      p_driver_profile_id: idOf(driverProfileId),
      p_selected_by_role: selectedByRole,
      p_selected_by_id: idOf(selectedById) || null,
      p_expires_at: new Date(expiresAt).toISOString()
    })
  });
  return Array.isArray(result) ? result[0] : result;
};

const respondDriverOffer = async ({ orderId, driverProfileId, accept, reason = '' }) => {
  const offer = await DriverOffer.findOne({
    orderId: idOf(orderId),
    driverProfileId: idOf(driverProfileId),
    status: 'pending'
  });
  if (!offer) {
    const error = new Error('Esta oferta já não está disponível para si.');
    error.statusCode = 409;
    throw error;
  }
  return supabaseRequest('/rest/v1/rpc/trago_respond_driver_offer', {
    method: 'POST',
    body: JSON.stringify({
      p_offer_id: idOf(offer),
      p_driver_profile_id: idOf(driverProfileId),
      p_accept: Boolean(accept),
      p_reason: String(reason || '').slice(0, 500) || null
    })
  });
};

module.exports = {
  cancelPendingDriverOffers,
  createDriverOffer,
  expireDriverOffers,
  getPresence,
  getFreshAvailablePresences,
  getFreshOnlinePresences,
  respondDriverOffer,
  syncDriverPresence
};
