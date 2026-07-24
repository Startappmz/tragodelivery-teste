const asyncHandler = require('express-async-handler');
const Order = require('../models/Order');
const OrderMessage = require('../models/OrderMessage');
const Conversation = require('../models/Conversation');
const OrderStatusEvent = require('../models/OrderStatusEvent');
const DriverProfile = require('../models/DriverProfile');
const Restaurant = require('../models/Restaurant');
const { ORDER_STATUS, DRIVER_STATUS, ADMIN_ROOM, MESSAGE_CHANNEL } = require('../utils/constants');
const { requireOrderAccess } = require('../utils/orderAccess');
const { createAdminNotification, shortOrderCode } = require('../utils/notifications');
const {
  canUseChannel,
  channelsForViewer,
  defaultChannelForRole,
  visibilityForChannel
} = require('../utils/messageChannels');
const { recordAudit, recordOrderStatusEvent } = require('../utils/audit');
const { cancelPendingDriverOffers, syncDriverPresence } = require('../utils/driverPresence');

const clean = (value, limit = 2000) => String(value || '').trim().slice(0, limit);
const idOf = (value) => String(value?._id || value?.id || value || '');

const publicDriver = (profile) => profile ? ({
  id: idOf(profile),
  name: profile.user?.nome || 'Motorista TraGo',
  phone: profile.user?.telefone || '',
  avatar_url: profile.avatar_url || '',
  rating: Number(profile.rating || 4.9),
  verified: profile.verified === true,
  location: profile.lastLocation && Number.isFinite(Number(profile.lastLocation.lat)) && Number.isFinite(Number(profile.lastLocation.lng))
    ? {
        lat: Number(profile.lastLocation.lat),
        lng: Number(profile.lastLocation.lng),
        accuracy: Number(profile.lastLocation.accuracy || 0) || null,
        updated_at: profile.lastLocation.updatedAt || null
      }
    : null,
  vehicle: {
    type: profile.vehicle_type || profile.vehicle?.type || 'mota',
    plate: profile.vehicle_plate || profile.vehicle?.plate || '',
    brand: profile.vehicle_brand || profile.vehicle?.brand || '',
    model: profile.vehicle_model || profile.vehicle?.model || '',
    color: profile.vehicle_color || '',
    photo_url: profile.vehicle_photo_url || ''
  }
}) : null;

const safeOrder = (order) => {
  const value = typeof order?.toObject === 'function' ? order.toObject() : { ...(order || {}) };
  delete value.publicAccessTokenHash;
  delete value.public_access_token_hash;
  return value;
};

const belongsToRestaurant = (order, restaurant) => {
  if (idOf(order.restaurantId || order.restaurant_id) === idOf(restaurant)) return true;
  const restaurantPhone = String(restaurant.phone || '').replace(/\D/g, '');
  const orderPhone = String(order.pickup_contact_phone || '').replace(/\D/g, '');
  const samePhone = restaurantPhone && orderPhone && restaurantPhone === orderPhone;
  const sameName = clean(order.pickup_contact_name, 120).toLowerCase() === clean(restaurant.name, 120).toLowerCase();
  return Boolean(samePhone || sameName);
};

const emitOrderEvent = (req, event, order, payload = {}) => {
  const io = req.app.get('socketio');
  if (!io) return;
  const data = { orderId: idOf(order), ...payload };
  io.to(ADMIN_ROOM).emit(event, data);
  if (order.assigned_to_driver) {
    DriverProfile.findById(order.assigned_to_driver).then((profile) => {
      if (profile?.user) io.to(idOf(profile.user)).emit(event, data);
    }).catch(() => {});
  }
};

const ensureConversation = async (orderId, channelType) => {
  const existing = await Conversation.findOne({ orderId, channelType });
  return existing || Conversation.create({ orderId, scope: 'order', channelType });
};

const createMessage = async ({
  order,
  role,
  senderId,
  senderName,
  body,
  type = 'text',
  metadata = {},
  channel = defaultChannelForRole(role)
}) => {
  if (!canUseChannel(role, channel, { write: type === 'text' })) {
    const error = new Error('Canal de conversa não permitido para este perfil.');
    error.statusCode = 403;
    throw error;
  }
  const orderId = idOf(order);
  const conversation = await ensureConversation(orderId, channel);
  return OrderMessage.create({
    orderId,
    conversationId: idOf(conversation),
    channelType: channel,
    visibleToRoles: visibilityForChannel(channel),
    senderRole: role,
    senderId: String(senderId || role),
    senderName: clean(senderName, 120) || role,
    body: clean(body),
    messageType: type,
    metadata
  });
};

const listForOrder = async (orderId, viewerRole, requestedChannel = '') => {
  const allowedChannels = new Set(channelsForViewer(viewerRole, requestedChannel, true));
  const messages = await OrderMessage.find({ orderId }).sort({ createdAt: 1 }).limit(500).lean();
  return messages.filter((message) => {
    const channel = message.channelType || message.channel_type || MESSAGE_CHANNEL.SYSTEM;
    const visibleTo = message.visibleToRoles || message.visible_to_roles || visibilityForChannel(channel);
    return allowedChannels.has(channel) && visibleTo.includes(viewerRole);
  });
};

const requireDriverOrAdmin = async (req, order) => {
  if (req.user?.role === 'admin') return { role: 'admin', id: idOf(req.user), name: req.user.nome || 'Admin' };
  if (req.user?.role !== 'driver') {
    const error = new Error('Perfil sem acesso à conversa do pedido.'); error.statusCode = 403; throw error;
  }
  const profile = await DriverProfile.findOne({ user: req.user._id });
  if (!profile || idOf(order.assigned_to_driver) !== idOf(profile)) {
    const error = new Error('Este pedido não está atribuído a este motorista.'); error.statusCode = 403; throw error;
  }
  return { role: 'driver', id: idOf(profile), name: req.user.nome || 'Motorista' };
};

exports.getPublicContext = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) { res.status(404); throw new Error('Pedido não encontrado.'); }
  requireOrderAccess(req, order);
  const driver = order.assigned_to_driver
    ? await DriverProfile.findById(order.assigned_to_driver).populate('user', 'nome telefone').populate('vehicle').lean()
    : null;
  const restaurant = order.restaurantId ? await Restaurant.findById(order.restaurantId).lean() : null;
  const publicLabels = new Set(['Pedido confirmado', 'Em preparação', 'A caminho', 'Entregue', 'Cancelado']);
  const statusHistory = (await OrderStatusEvent.find({ orderId: idOf(order) })
    .sort({ createdAt: 1 })
    .limit(100)
    .lean())
    .filter((event) => publicLabels.has(event.label))
    .map((event) => ({
      id: idOf(event),
      status: event.status,
      label: event.label,
      actor_type: event.actorType || event.actor_type,
      created_at: event.createdAt
    }));
  res.json({
    order: safeOrder(order),
    driver: publicDriver(driver),
    status_history: statusHistory,
    restaurant: restaurant ? { id: idOf(restaurant), name: restaurant.name, phone: restaurant.phone || '', logo_url: restaurant.logo_url || '' } : null
  });
});

exports.listPublicMessages = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) { res.status(404); throw new Error('Pedido não encontrado.'); }
  requireOrderAccess(req, order);
  res.json({
    channel: MESSAGE_CHANNEL.CLIENT_DRIVER,
    messages: await listForOrder(idOf(order), 'client', MESSAGE_CHANNEL.CLIENT_DRIVER)
  });
});

exports.createPublicMessage = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) { res.status(404); throw new Error('Pedido não encontrado.'); }
  requireOrderAccess(req, order);
  const body = clean(req.body.message);
  if (!body) { res.status(400); throw new Error('Escreva uma mensagem.'); }
  const message = await createMessage({
    order,
    role: 'client',
    senderId: order.client || `public:${idOf(order)}`,
    senderName: order.client_name || 'Cliente',
    body,
    channel: MESSAGE_CHANNEL.CLIENT_DRIVER
  });
  emitOrderEvent(req, 'order_message_created', order, { messageId: idOf(message), senderRole: 'client' });
  res.status(201).json({ message });
});

exports.cancelPublicOrder = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) { res.status(404); throw new Error('Pedido não encontrado.'); }
  requireOrderAccess(req, order);
  if (![ORDER_STATUS.PENDING, ORDER_STATUS.ASSIGNED].includes(order.status)) {
    res.status(409); throw new Error('O pedido já está em operação. Contacte o suporte para solicitar o cancelamento.');
  }
  if (['preparing', 'ready'].includes(order.restaurantStatus || order.restaurant_status)) {
    res.status(409); throw new Error('O restaurante já iniciou a preparação. Contacte o suporte para solicitar o cancelamento.');
  }
  const affectedDriverId = order.assigned_to_driver || order.offered_to_driver;
  order.status = ORDER_STATUS.CANCELED;
  order.cancelledAt = new Date();
  order.cancelReason = clean(req.body.reason, 500) || 'Cancelado pelo cliente';
  order.offered_to_driver = null;
  order.driver_offer_status = null;
  order.driver_offer_expires_at = null;
  await order.save();
  await cancelPendingDriverOffers(order._id);
  if (affectedDriverId) {
    const profile = await DriverProfile.findById(affectedDriverId);
    if (profile) {
      profile.status = DRIVER_STATUS.ONLINE_FREE;
      await profile.save();
      await syncDriverPresence(profile, { currentOrderId: null, isOnline: true, isAvailable: true });
    }
  }
  const message = await createMessage({
    order,
    role: 'system',
    senderId: 'system',
    senderName: 'TraGo',
    body: 'O cliente cancelou este pedido.',
    type: 'status',
    metadata: { status: ORDER_STATUS.CANCELED, reason: order.cancelReason },
    channel: MESSAGE_CHANNEL.SYSTEM
  });
  await recordOrderStatusEvent({
    order,
    label: 'Cancelado',
    actorType: 'client',
    actorId: order.client || `public:${idOf(order)}`,
    actorName: order.client_name || 'Cliente',
    note: order.cancelReason
  });
  await recordAudit('client', order.client || `public:${idOf(order)}`, 'order_cancelled', 'order', order, { reason: order.cancelReason });
  await createAdminNotification({ dedupeKey: `client_cancel:${idOf(order)}`, type: 'warning', title: `Pedido ${shortOrderCode(idOf(order))} cancelado pelo cliente`, message: order.cancelReason, order });
  emitOrderEvent(req, 'order_status_changed', order, { status: order.status, messageId: idOf(message) });
  res.json({ message: 'Pedido cancelado.', order: safeOrder(order) });
});

exports.listAuthenticatedMessages = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) { res.status(404); throw new Error('Pedido não encontrado.'); }
  const actor = await requireDriverOrAdmin(req, order);
  const requestedChannel = clean(req.query?.channel, 40);
  if (requestedChannel && !canUseChannel(actor.role, requestedChannel)) {
    res.status(403);
    throw new Error('Canal de conversa não permitido para este perfil.');
  }
  res.json({
    channel: requestedChannel || (actor.role === 'driver' ? MESSAGE_CHANNEL.CLIENT_DRIVER : 'all'),
    messages: await listForOrder(idOf(order), actor.role, requestedChannel)
  });
});

exports.createAuthenticatedMessage = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) { res.status(404); throw new Error('Pedido não encontrado.'); }
  const actor = await requireDriverOrAdmin(req, order);
  const body = clean(req.body.message);
  if (!body) { res.status(400); throw new Error('Escreva uma mensagem.'); }
  const channel = clean(req.body.channel, 40) || defaultChannelForRole(actor.role);
  if (!canUseChannel(actor.role, channel, { write: true })) {
    res.status(403);
    throw new Error(actor.role === 'driver'
      ? 'Escolha Cliente ou Estabelecimento para enviar a mensagem.'
      : 'Escolha um canal operacional válido.');
  }
  const message = await createMessage({
    order,
    ...actor,
    senderId: actor.id,
    senderName: actor.name,
    body,
    channel
  });
  if (actor.role !== 'admin') await createAdminNotification({ dedupeKey: `order_chat:${idOf(message)}`, type: 'info', title: `Mensagem no pedido ${shortOrderCode(idOf(order))}`, message: `${actor.name}: ${body.slice(0, 140)}`, order });
  emitOrderEvent(req, 'order_message_created', order, { messageId: idOf(message), senderRole: actor.role });
  res.status(201).json({ message });
});

exports.listRestaurantMessages = asyncHandler(async (req, res) => {
  const { restaurant, order } = req;
  if (!restaurant || !order || !belongsToRestaurant(order, restaurant)) { res.status(403); throw new Error('Pedido não pertence a este restaurante.'); }
  res.json({
    channel: MESSAGE_CHANNEL.DRIVER_PARTNER,
    messages: await listForOrder(idOf(order), 'restaurant', MESSAGE_CHANNEL.DRIVER_PARTNER)
  });
});

exports.createRestaurantMessage = asyncHandler(async (req, res) => {
  const { restaurant, order } = req;
  if (!restaurant || !order || !belongsToRestaurant(order, restaurant)) { res.status(403); throw new Error('Pedido não pertence a este restaurante.'); }
  const body = clean(req.body.message);
  if (!body) { res.status(400); throw new Error('Escreva uma mensagem.'); }
  const message = await createMessage({
    order,
    role: 'restaurant',
    senderId: idOf(restaurant),
    senderName: restaurant.name || 'Restaurante',
    body,
    channel: MESSAGE_CHANNEL.DRIVER_PARTNER
  });
  emitOrderEvent(req, 'order_message_created', order, { messageId: idOf(message), senderRole: 'restaurant' });
  res.status(201).json({ message });
});

exports.confirmRestaurantOrder = asyncHandler(async (req, res) => {
  const { restaurant, order } = req;
  if (!restaurant || !order || !belongsToRestaurant(order, restaurant)) {
    res.status(403);
    throw new Error('Pedido não pertence a este estabelecimento.');
  }
  if ([ORDER_STATUS.COMPLETED, ORDER_STATUS.CANCELED].includes(order.status)) {
    res.status(409);
    throw new Error('Este pedido já foi encerrado.');
  }
  if (order.partnerConfirmedAt || order.partner_confirmed_at) {
    return res.json({ message: 'Pedido já confirmado pelo estabelecimento.', order: safeOrder(order) });
  }

  const now = new Date();
  order.restaurantStatus = 'accepted';
  order.restaurant_status = 'accepted';
  order.partnerConfirmedAt = now;
  order.partner_confirmed_at = now;
  order.partnerConfirmedBy = idOf(restaurant);
  order.partner_confirmed_by = idOf(restaurant);
  await order.save();
  const message = await createMessage({
    order,
    role: 'restaurant',
    senderId: idOf(restaurant),
    senderName: restaurant.name || 'Estabelecimento',
    body: 'O estabelecimento confirmou que recebeu o pedido.',
    type: 'status',
    metadata: { partner_confirmed_at: now },
    channel: MESSAGE_CHANNEL.DRIVER_PARTNER
  });
  await recordOrderStatusEvent({
    order,
    label: 'Confirmado pelo estabelecimento',
    actorType: 'restaurant',
    actorId: restaurant,
    actorName: restaurant.name || 'Estabelecimento'
  });
  await recordAudit('restaurant', restaurant, 'partner_order_confirmed', 'order', order);
  await createAdminNotification({
    dedupeKey: `partner_confirmed:${idOf(order)}`,
    type: 'order',
    title: `${restaurant.name || 'Estabelecimento'} confirmou o pedido`,
    message: `Pedido ${shortOrderCode(idOf(order))} confirmado pelo ponto de recolha.`,
    order
  });
  emitOrderEvent(req, 'restaurant_order_status_changed', order, {
    restaurantStatus: 'accepted',
    messageId: idOf(message)
  });
  res.json({ message: 'Pedido confirmado.', order: safeOrder(order) });
});

exports.confirmRestaurantPickup = asyncHandler(async (req, res) => {
  const { restaurant, order } = req;
  if (!restaurant || !order || !belongsToRestaurant(order, restaurant)) {
    res.status(403);
    throw new Error('Pedido não pertence a este estabelecimento.');
  }
  if ([ORDER_STATUS.COMPLETED, ORDER_STATUS.CANCELED].includes(order.status)) {
    res.status(409);
    throw new Error('Este pedido já foi encerrado.');
  }
  if (!order.partnerConfirmedAt && !order.partner_confirmed_at) {
    res.status(409);
    throw new Error('Confirme primeiro a recepção do pedido.');
  }
  if ((order.restaurantStatus || order.restaurant_status) !== 'preparing') {
    res.status(409);
    throw new Error('Marque primeiro o pedido como Em preparação.');
  }
  if (order.pickupAuthorizedAt || order.pickup_authorized_at) {
    return res.json({ message: 'Recolha já autorizada pelo estabelecimento.', order: safeOrder(order) });
  }

  const now = new Date();
  order.pickupAuthorizedAt = now;
  order.pickup_authorized_at = now;
  order.pickupAuthorizedBy = idOf(restaurant);
  order.pickup_authorized_by = idOf(restaurant);
  order.restaurantReadyAt = now;
  order.restaurant_ready_at = now;
  await order.save();
  const message = await createMessage({
    order,
    role: 'restaurant',
    senderId: idOf(restaurant),
    senderName: restaurant.name || 'Estabelecimento',
    body: 'O estabelecimento autorizou a recolha pelo motorista.',
    type: 'status',
    metadata: { pickup_authorized_at: now },
    channel: MESSAGE_CHANNEL.DRIVER_PARTNER
  });
  await recordOrderStatusEvent({
    order,
    label: 'Recolha autorizada',
    actorType: 'restaurant',
    actorId: restaurant,
    actorName: restaurant.name || 'Estabelecimento'
  });
  await recordAudit('restaurant', restaurant, 'pickup_authorized', 'order', order);
  emitOrderEvent(req, 'pickup_authorized', order, { pickupAuthorized: true, messageId: idOf(message) });
  res.json({ message: 'Recolha confirmada para o motorista.', order: safeOrder(order) });
});

exports.updateRestaurantStatus = asyncHandler(async (req, res) => {
  const { restaurant, order } = req;
  if (!restaurant || !order || !belongsToRestaurant(order, restaurant)) { res.status(403); throw new Error('Pedido não pertence a este restaurante.'); }
  const status = clean(req.body.status, 30);
  const allowed = ['preparing', 'rejected'];
  if (!allowed.includes(status)) {
    res.status(400);
    throw new Error('O estabelecimento só pode marcar Em preparação ou Cancelado.');
  }
  if ([ORDER_STATUS.COMPLETED, ORDER_STATUS.CANCELED].includes(order.status)) { res.status(409); throw new Error('Este pedido já foi encerrado.'); }
  const current = order.restaurantStatus || 'new';
  if (status === 'preparing' && !order.partnerConfirmedAt && !order.partner_confirmed_at) {
    res.status(409);
    throw new Error('Confirme primeiro a recepção do pedido.');
  }
  if (status === 'preparing' && !['accepted', 'preparing'].includes(current)) {
    res.status(409);
    throw new Error('Esta mudança de estado já não é válida para o pedido.');
  }
  if (status === 'rejected' && (order.pickupCompletedAt || order.deliveryStartAt)) {
    res.status(409);
    throw new Error('A recolha já foi concluída. Use o suporte para cancelar em segurança.');
  }
  const reason = clean(req.body.reason, 500);
  if (status === 'rejected' && reason.length < 3) {
    res.status(400);
    throw new Error('Indique a justificativa do cancelamento.');
  }
  const affectedDriverId = order.assigned_to_driver || order.offered_to_driver;
  order.restaurantStatus = status;
  order.restaurant_status = status;
  order.restaurantPrepTimeMin = req.body.prep_time_min ? Math.max(1, Math.min(180, Number(req.body.prep_time_min))) : order.restaurantPrepTimeMin;
  order.restaurant_prep_time_min = order.restaurantPrepTimeMin;
  if (status === 'rejected') {
    order.status = ORDER_STATUS.CANCELED;
    order.cancelledAt = new Date();
    order.cancelReason = reason;
    order.offered_to_driver = null;
    order.driver_offer_status = null;
    order.driver_offer_expires_at = null;
  }
  await order.save();
  if (status === 'rejected') {
    await cancelPendingDriverOffers(order._id);
    if (affectedDriverId) {
      const driverProfile = await DriverProfile.findById(affectedDriverId);
      if (driverProfile) {
        driverProfile.status = DRIVER_STATUS.ONLINE_FREE;
        await driverProfile.save();
        await syncDriverPresence(driverProfile, { currentOrderId: null, isOnline: true, isAvailable: true });
      }
    }
  }
  const labels = {
    preparing: 'O pedido está em preparação.',
    rejected: `Pedido cancelado pelo estabelecimento: ${reason}`
  };
  const message = await createMessage({
    order,
    role: 'restaurant',
    senderId: idOf(restaurant),
    senderName: restaurant.name || 'Estabelecimento',
    body: labels[status],
    type: 'status',
    metadata: {
      restaurant_status: status,
      prep_time_min: order.restaurantPrepTimeMin || null,
      reason: status === 'rejected' ? reason : undefined
    },
    channel: MESSAGE_CHANNEL.SYSTEM
  });
  await recordOrderStatusEvent({
    order,
    label: status === 'preparing' ? 'Em preparação' : 'Cancelado',
    actorType: 'restaurant',
    actorId: restaurant,
    actorName: restaurant.name || 'Estabelecimento',
    note: status === 'rejected' ? reason : ''
  });
  await recordAudit(
    'restaurant',
    restaurant,
    status === 'preparing' ? 'order_preparing' : 'order_cancelled',
    'order',
    order,
    { reason }
  );
  await createAdminNotification({ dedupeKey: `restaurant_status:${idOf(order)}:${status}`, type: status === 'rejected' ? 'warning' : 'order', title: `${restaurant.name || 'Restaurante'} · ${shortOrderCode(idOf(order))}`, message: labels[status], order });
  emitOrderEvent(req, 'restaurant_order_status_changed', order, { restaurantStatus: status, messageId: idOf(message) });
  res.json({ message: labels[status], order: safeOrder(order) });
});

exports._belongsToRestaurant = belongsToRestaurant;
