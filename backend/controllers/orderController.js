const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const asyncHandler = require('express-async-handler');
const Order = require('../models/Order');
const OrderMessage = require('../models/OrderMessage');
const Conversation = require('../models/Conversation');
const DriverProfile = require('../models/DriverProfile');
const Client = require('../models/Client');
const {
  DRIVER_STATUS,
  DRIVER_TYPES,
  ORDER_STATUS,
  ADMIN_ROOM,
  FINANCIAL,
  PAYMENT_METHODS,
  PAYMENT_STATUS,
  CLIENT_BILLING_TYPES,
  MESSAGE_CHANNEL
} = require('../utils/constants');
const { getDistanceFromLatLonInKm, parseCommissionRate } = require('../utils/helpers');
const { buildRouteQuote } = require('../utils/geoPricing');
const { getSocketUserMap } = require('../socketHandler');
const { createAdminNotification, shortOrderCode } = require('../utils/notifications');
const { recordAudit, recordOrderStatusEvent } = require('../utils/audit');
const {
  cancelPendingDriverOffers,
  expireDriverOffers,
  getPresence,
  respondDriverOffer,
  syncDriverPresence
} = require('../utils/driverPresence');

const MAX_IMAGE_BYTES = parseInt(process.env.UPLOAD_IMAGE_MAX_SIZE || `${5 * 1024 * 1024}`, 10);

const recordOrderStatus = async (order, body, metadata = {}) => {
  const orderId = String(order?._id || order?.id || '');
  const conversation = await Conversation.findOne({
    orderId,
    channelType: MESSAGE_CHANNEL.SYSTEM
  }) || await Conversation.create({
    orderId,
    scope: 'order',
    channelType: MESSAGE_CHANNEL.SYSTEM
  });
  return OrderMessage.create({
    orderId,
    conversationId: conversation._id,
    channelType: MESSAGE_CHANNEL.SYSTEM,
    visibleToRoles: ['client', 'driver', 'restaurant', 'admin'],
    senderRole: 'system',
    senderId: 'system',
    senderName: 'TraGo',
    body,
    messageType: 'status',
    metadata: { status: order.status, ...metadata }
  });
};

const generateVerificationCode = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 5; i += 1) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

const normalizeCoordinates = (lat, lng) => {
  if (lat === undefined || lng === undefined) return null;
  const parsedLat = Number(lat);
  const parsedLng = Number(lng);

  if (Number.isNaN(parsedLat) || Number.isNaN(parsedLng)) {
    return null;
  }

  return { lat: parsedLat, lng: parsedLng };
};

const getPeriodRange = (periodRaw) => {
  const key = ['day', 'week', 'month'].includes(String(periodRaw || '')) ? String(periodRaw) : 'month';
  const start = new Date();
  const end = new Date();
  end.setHours(23, 59, 59, 999);

  if (key === 'day') {
    start.setHours(0, 0, 0, 0);
  } else if (key === 'week') {
    const day = start.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    start.setDate(start.getDate() + mondayOffset);
    start.setHours(0, 0, 0, 0);
  } else {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
  }

  const label = key === 'day' ? 'Hoje' : key === 'week' ? 'Esta Semana' : 'Este Mês';
  return { key, label, start, end };
};

const optimizeUpload = async (file) => {
  const normalizedName = `${Date.now()}-${file.originalname}`.replace(/\s+/g, '_');
  const outputPath = path.join('uploads', normalizedName);

  await sharp(file.path)
    .resize(1200, 1200, { fit: 'inside' })
    .jpeg({ quality: 80 })
    .toFile(outputPath);

  await fs.unlink(file.path);

  return `/uploads/${normalizedName}`;
};

const findBestDriverProfile = async (coordinates) => {
  if (!coordinates) return null;

  const availableProfiles = await DriverProfile.find({
    status: DRIVER_STATUS.ONLINE_FREE
  }).lean();

  if (!availableProfiles.length) return null;

  const sockets = getSocketUserMap();
  let bestProfileId = null;
  let minDistance = Infinity;

  availableProfiles.forEach((profile) => {
    const userId = profile.user.toString();

    sockets.forEach((data) => {
      if (data.userId === userId && data.lastLocation) {
        const distance = getDistanceFromLatLonInKm(
          coordinates.lat,
          coordinates.lng,
          data.lastLocation.lat,
          data.lastLocation.lng
        );

        if (distance < minDistance) {
          minDistance = distance;
          bestProfileId = profile._id;
        }
      }
    });
  });

  return bestProfileId;
};

// -----------------------------------------------------------------------------
// CRIAÇÃO / ATRIBUIÇÃO
// -----------------------------------------------------------------------------

exports.createOrder = asyncHandler(async (req, res) => {
  const data = req.filtered || req.body;

  // ===== EXTRAIR DADOS =====
  const {
    service_type,
    client_name,
    client_phone1,
    client_phone2,
    address_text,
    pickup_address_text,
    pickup_contact_name,
    pickup_contact_phone,
    pickup_notes,
    client_notes,
    price,
    service_price,
    lat,
    lng,
    pickup_lat,
    pickup_lng,
    clientId,
    autoAssign
  } = data;

  // ===== NORMALIZAÇÃO SEGURA DO PAYMENT =====
  // Nota importante: validateRequest() usa matchedData(); por isso mantemos
  // também o fallback para req.body, garantindo que o método escolhido no
  // formulário nunca volta silenciosamente para "cash".
  const rawPaymentMethod = data.payment_method ?? req.body?.payment_method;
  const allowedPaymentMethods = new Set(Object.values(PAYMENT_METHODS));
  let normalizedPayment =
    typeof rawPaymentMethod === 'string' && allowedPaymentMethods.has(rawPaymentMethod.trim())
      ? rawPaymentMethod.trim()
      : PAYMENT_METHODS.CASH;

  let imageUrl = null;

  // ===== PROCESSAMENTO DE IMAGEM =====
  if (req.files?.length) {
    const file = req.files[0];

    if (file.size > MAX_IMAGE_BYTES) {
      await fs.unlink(file.path);
      res.status(400);
      throw new Error('Imagem acima do limite permitido (5MB por defeito).');
    }

    try {
      imageUrl = await optimizeUpload(file);
    } catch (error) {
      await fs.unlink(file.path).catch(() => {});
      res.status(500);
      throw new Error('Falha ao processar a imagem.');
    }
  }

  // ===== COORDENADAS E PREÇO POR DISTÂNCIA =====
  const coordinates = normalizeCoordinates(lat, lng);
  const pickupCoordinates = normalizeCoordinates(pickup_lat, pickup_lng);
  const baseServicePrice = Number(service_price ?? price) || 0;

  let routeQuote = {
    distance_km: Number(data.route_distance_km) || 0,
    duration_min: Number(data.route_duration_min) || null,
    delivery_fee: Number(data.delivery_fee) || 0,
    source: 'frontend'
  };

  if (pickupCoordinates && coordinates) {
    routeQuote = await buildRouteQuote(pickupCoordinates, coordinates);
  }

  const totalOrderPrice = baseServicePrice + Number(routeQuote.delivery_fee || 0);

  let linkedClient = null;
  if (clientId) {
    linkedClient = await Client.findById(clientId);
    if (!linkedClient) {
      res.status(404);
      throw new Error('Cliente registado não encontrado.');
    }

    if (linkedClient.billing_type === CLIENT_BILLING_TYPES.POSTPAID) {
      normalizedPayment = PAYMENT_METHODS.POSTPAID_CREDIT;
      const availableCredit = Number(linkedClient.credit_balance || 0);
      if (availableCredit < totalOrderPrice) {
        res.status(400);
        throw new Error(`Crédito insuficiente para cliente pós-pago. Disponível: ${availableCredit.toFixed(2)} MZN.`);
      }

      linkedClient.credit_balance = availableCredit - totalOrderPrice;
      linkedClient.credit_used = Number(linkedClient.credit_used || 0) + totalOrderPrice;
      await linkedClient.save();
    }
  } else if (normalizedPayment === PAYMENT_METHODS.POSTPAID_CREDIT) {
    normalizedPayment = PAYMENT_METHODS.CASH;
  }

  // A criaÃ§Ã£o nunca atribui automaticamente um motorista. O radar apenas
  // apresenta motoristas livres; a atribuiÃ§Ã£o acontece apÃ³s escolha explÃ­cita
  // e aceite do motorista.
  // A criação nunca conclui uma atribuição. O radar pode sugerir/oferecer,
  // mas o pedido só fica atribuído após aceite do motorista ou acção manual
  // auditada do Admin.
  const assignedDriverProfileId = null;
  const orderStatus = ORDER_STATUS.PENDING;

  // ===== AUTO-ATRIBUIÇÃO =====
  // ===== CÓDIGO DE VERIFICAÇÃO =====
  const verificationCode = generateVerificationCode();

  // ===== CRIAÇÃO DO PEDIDO =====
  const order = await Order.create({
    service_type,
    price: Number(totalOrderPrice) || 0,
    service_price: Number(baseServicePrice) || 0,
    delivery_fee: Number(routeQuote.delivery_fee) || 0,
    route_distance_km: Number(routeQuote.distance_km) || 0,
    route_duration_min: routeQuote.duration_min || null,
    route_pricing_source: routeQuote.source || 'fallback',
    client_name,
    client_phone1,
    client_phone2,
    pickup_address_text: pickup_address_text || '',
    pickup_address_coords: pickupCoordinates,
    pickup_contact_name: pickup_contact_name || '',
    pickup_contact_phone: pickup_contact_phone || '',
    pickup_notes: pickup_notes || '',
    client_notes: String(client_notes || pickup_notes || '').trim().slice(0, 1000),
    address_text,
    address_coords: coordinates,
    client: clientId || null,
    image_url: imageUrl,
    verification_code: verificationCode,
    created_by_admin: req.user._id,
    assigned_to_driver: assignedDriverProfileId,
    status: orderStatus,
    payment_method: normalizedPayment,
    payment_status: normalizedPayment === PAYMENT_METHODS.POSTPAID_CREDIT
      ? PAYMENT_STATUS.POSTPAID_MONTHLY
      : PAYMENT_STATUS.UNPAID
  });

  await createAdminNotification({
    dedupeKey: `new_order:${order._id}`,
    type: 'order',
    title: 'Novo pedido recebido',
    message: `Pedido ${shortOrderCode(order._id)} · ${order.client_name || 'Cliente'} · ${paymentMethodLabel(order.payment_method)}.`,
    order,
    payload: { clientName: order.client_name, amount: Number(order.price || 0), paymentMethod: order.payment_method },
    createdAt: order.createdAt || new Date()
  });
  await recordAudit('admin', req.user, 'order_created', 'order', order, {
    service_type,
    auto_assign_requested: autoAssign === true || autoAssign === 'true'
  });

  // ===== SOCKET.IO =====
  const io = req.app.get('socketio');

  if (orderStatus === ORDER_STATUS.ASSIGNED && assignedDriverProfileId) {
    const assignedProfile = await DriverProfile.findById(assignedDriverProfileId).lean();
    if (assignedProfile) {
      io.to(assignedProfile.user.toString()).emit('nova_entrega_atribuida', {
        orderId: order._id,
        clientName: order.client_name,
        serviceType: order.service_type,
        paymentMethod: order.payment_method
      });
    }
  } else {
    io.to(ADMIN_ROOM).emit('order_pending', { orderId: order._id });
  }

  res.status(201).json({ message: 'Encomenda criada com sucesso!', order });
});

exports.assignOrder = asyncHandler(async (req, res) => {
  const data = req.filtered || req.body;
  const { orderId } = req.params;
  const { driverId } = data;

  const order = await Order.findById(orderId);
  if (!order) {
    res.status(404);
    throw new Error('Encomenda não encontrada.');
  }

  // não reatribuir se já estiver em andamento (qualquer fase)
  if (
    [
      ORDER_STATUS.IN_PROGRESS,
      ORDER_STATUS.PICKUP_IN_PROGRESS,
      ORDER_STATUS.DELIVERY_IN_PROGRESS
    ].includes(order.status)
  ) {
    res.status(400);
    throw new Error('Não é possível reatribuir uma encomenda em progresso.');
  }

  const newDriverProfile = await DriverProfile.findById(driverId);
  if (!newDriverProfile) {
    res.status(404);
    throw new Error('Perfil de motorista não encontrado.');
  }
  const newPresence = await getPresence(driverId);
  const presenceTimestamp = new Date(newPresence?.last_seen_at || 0).getTime();
  const isReservedForThisOrder = String(order.offered_to_driver || '') === String(driverId);
  if (
    !newPresence?.is_online
    || (!newPresence.is_available && !isReservedForThisOrder)
    || newPresence.current_order_id
    || Date.now() - presenceTimestamp > 60000
  ) {
    res.status(409);
    throw new Error('O motorista já não está online e disponível.');
  }

  const io = req.app.get('socketio');

  const previousDriverIds = [...new Set([
    order.assigned_to_driver,
    order.offered_to_driver
  ].filter((value) => value && String(value) !== String(driverId)).map(String))];
  for (const previousDriverId of previousDriverIds) {
    const oldProfile = await DriverProfile.findById(previousDriverId);
    if (oldProfile) {
      oldProfile.status = DRIVER_STATUS.ONLINE_FREE;
      await oldProfile.save();
      await syncDriverPresence(oldProfile, {
        currentOrderId: null,
        isOnline: true,
        isAvailable: true
      });
      io.to(oldProfile.user.toString()).emit('entrega_cancelada', { orderId: order._id });
      io.to(ADMIN_ROOM).emit('driver_status_changed', {
        driverId: oldProfile._id,
        driverUserId: oldProfile.user,
        newStatus: DRIVER_STATUS.ONLINE_FREE
      });
    }
  }

  newDriverProfile.status = DRIVER_STATUS.ONLINE_BUSY;
  await newDriverProfile.save();
  await syncDriverPresence(newDriverProfile, {
    currentOrderId: order._id,
    isOnline: true,
    isAvailable: false
  });
  order.assigned_to_driver = driverId;
  order.offered_to_driver = null;
  order.driver_offer_status = null;
  order.driver_offer_expires_at = null;
  order.status = ORDER_STATUS.ASSIGNED;
  order.driverAssignedAt = order.driverAssignedAt || new Date();
  order.driver_assigned_at = order.driverAssignedAt;
  order.lastStatusAt = new Date();
  order.last_status_at = order.lastStatusAt;
  await order.save();
  await cancelPendingDriverOffers(order._id);
  await recordOrderStatus(order, 'Pedido confirmado e motorista atribuído pelo Admin.', {
    actor: 'admin',
    driverProfileId: String(driverId)
  });
  await recordOrderStatusEvent({
    order,
    label: 'Pedido confirmado',
    actorType: 'admin',
    actorId: req.user,
    actorName: req.user.nome || 'Admin',
    metadata: { driver_profile_id: String(driverId), manual_assignment: true }
  });
  await recordAudit('admin', req.user, 'driver_manually_assigned', 'order', order, {
    driver_profile_id: String(driverId)
  });

  io.to(newDriverProfile.user.toString()).emit('nova_entrega_atribuida', {
    orderId: order._id,
    clientName: order.client_name,
    serviceType: order.service_type,
    paymentMethod: order.payment_method
  });
  io.to(ADMIN_ROOM).emit('driver_status_changed', {
    driverId: newDriverProfile._id,
    driverUserId: newDriverProfile.user,
    newStatus: DRIVER_STATUS.ONLINE_BUSY
  });

  res.status(200).json({ message: 'Encomenda atribuída com sucesso.', order });
});

// -----------------------------------------------------------------------------
// LISTAGENS
// -----------------------------------------------------------------------------

exports.getMyDeliveries = asyncHandler(async (req, res) => {
  const driverProfile = await DriverProfile.findOne({ user: req.user._id });
  if (!driverProfile) {
    res.status(404);
    throw new Error('Perfil de motorista não encontrado.');
  }
  await expireDriverOffers();

  const activeStatuses = [
    ORDER_STATUS.ASSIGNED,
    ORDER_STATUS.IN_PROGRESS,
    ORDER_STATUS.PICKUP_IN_PROGRESS,
    ORDER_STATUS.PICKUP_DONE,
    ORDER_STATUS.DELIVERY_IN_PROGRESS
  ];

  const orders = await Order.find({
    assigned_to_driver: driverProfile._id,
    status: { $in: activeStatuses }
  })
    .sort({ createdAt: -1 })
    .lean();

  const rawOffers = await Order.find({
    offered_to_driver: driverProfile._id,
    driver_offer_status: 'pending',
    status: ORDER_STATUS.PENDING
  }).sort({ createdAt: -1 }).lean();
  const now = Date.now();
  const offers = [];
  for (const offer of rawOffers) {
    const expiresAt = new Date(offer.driver_offer_expires_at || 0).getTime();
    if (!expiresAt || expiresAt <= now) {
      const expired = await Order.findById(offer._id);
      if (expired && expired.driver_offer_status === 'pending') {
        expired.offered_to_driver = null;
        expired.driver_offer_status = 'expired';
        expired.driver_offer_expires_at = null;
        await expired.save();
      }
      continue;
    }
    offers.push(offer);
  }

  const safeOrder = (order) => {
    const safe = { ...order };
    delete safe.publicAccessTokenHash;
    delete safe.public_access_token_hash;
    return safe;
  };
  res.status(200).json({ orders: orders.map(safeOrder), offers: offers.map(safeOrder) });
});

exports.respondToDriverOffer = asyncHandler(async (req, res) => {
  const driverProfile = await DriverProfile.findOne({ user: req.user._id });
  if (!driverProfile) {
    res.status(404);
    throw new Error('Perfil de motorista não encontrado.');
  }

  const previousOrder = await Order.findById(req.params.id);
  if (!previousOrder) {
    res.status(404);
    throw new Error('Pedido não encontrado.');
  }

  const accept = req.body?.accept === true;
  const io = req.app.get('socketio');
  const outcomePayload = await respondDriverOffer({
    orderId: previousOrder,
    driverProfileId: driverProfile,
    accept,
    reason: req.body?.reason
  });
  const outcome = outcomePayload?.outcome || (accept ? 'accepted' : 'rejected');
  const order = await Order.findById(req.params.id);

  if (outcome === 'expired') {
    res.status(409);
    throw new Error('O tempo para responder a esta oferta terminou.');
  }

  if (outcome === 'rejected') {
    await recordOrderStatus(order, `${req.user.nome || 'O motorista'} recusou a oferta. O cliente pode escolher outro motorista.`, { driverOfferStatus: 'rejected' });
    await createAdminNotification({
      dedupeKey: `driver_offer_rejected:${order._id}:${driverProfile._id}`,
      type: 'warning',
      title: `Oferta recusada · ${shortOrderCode(order._id)}`,
      message: `${req.user.nome || 'Motorista'} recusou o pedido. O cliente pode escolher outro motorista.`,
      order
    });
    io?.to(ADMIN_ROOM).emit('orders_changed', { orderId: order._id, action: 'driver_offer_rejected' });
    return res.json({ accepted: false, order });
  }

  await recordOrderStatus(order, `${req.user.nome || 'O motorista'} aceitou o pedido.`, { driverOfferStatus: 'accepted' });
  await createAdminNotification({
    dedupeKey: `driver_offer_accepted:${order._id}:${driverProfile._id}`,
    type: 'order',
    title: `Motorista aceitou · ${shortOrderCode(order._id)}`,
    message: `${req.user.nome || 'Motorista'} aceitou o pedido do cliente.`,
    order
  });

  io?.to(String(driverProfile.user)).emit('nova_entrega_atribuida', {
    orderId: order._id,
    clientName: order.client_name,
    serviceType: order.service_type,
    paymentMethod: order.payment_method
  });
  io?.to(ADMIN_ROOM).emit('orders_changed', { orderId: order._id, action: 'driver_offer_accepted' });
  io?.to(ADMIN_ROOM).emit('driver_status_changed', {
    driverId: driverProfile._id,
    driverUserId: driverProfile.user,
    newStatus: DRIVER_STATUS.ONLINE_BUSY
  });

  res.json({ accepted: true, order });
});

// -----------------------------------------------------------------------------
// FLUXO DO MOTORISTA – RECOLHA E ENTREGA
// -----------------------------------------------------------------------------

/**
 * Motorista inicia a RECOLHA (sai da central para o ponto de recolha)
 * Também é usado pela rota antiga POST /:id/start
 */
const startPickup = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const driverProfile = await DriverProfile.findOne({ user: req.user._id });
  if (!driverProfile) {
    res.status(404);
    throw new Error('Perfil de motorista não encontrado.');
  }

  const order = await Order.findById(id);
  if (!order) {
    res.status(404);
    throw new Error('Encomenda não encontrada.');
  }

  if (String(order.assigned_to_driver || '') !== String(driverProfile._id)) {
    res.status(403);
    throw new Error('Não autorizado para esta encomenda.');
  }

  // apenas permite iniciar se estiver atribuída / pendente de início
  if (
    ![
      ORDER_STATUS.ASSIGNED,
      ORDER_STATUS.PENDING,
      ORDER_STATUS.PICKUP_IN_PROGRESS
    ].includes(order.status)
  ) {
    res.status(400);
    throw new Error('Esta encomenda não está disponível para iniciar a recolha.');
  }

  const now = new Date();

  if (!order.pickupStartAt) {
    order.pickupStartAt = now;
  }
  if (!order.timestamp_started) {
    order.timestamp_started = now;
  }

  order.status = ORDER_STATUS.PICKUP_IN_PROGRESS;
  order.lastStatusAt = now;
  order.last_status_at = now;
  await order.save();
  await recordOrderStatus(order, `${req.user.nome || 'O motorista'} iniciou o percurso para a recolha.`);
  await recordOrderStatusEvent({
    order,
    label: 'Percurso para recolha iniciado',
    actorType: 'driver',
    actorId: driverProfile,
    actorName: req.user.nome || 'Motorista'
  });
  await recordAudit('driver', driverProfile, 'pickup_started', 'order', order, { status: order.status });

  driverProfile.status = DRIVER_STATUS.PICKUP;
  await driverProfile.save();
  await syncDriverPresence(driverProfile, {
    currentOrderId: order._id,
    isOnline: true,
    isAvailable: false
  });

  const io = req.app.get('socketio');
  io.to(ADMIN_ROOM).emit('pickup_started', {
    id: order._id,
    driverName: req.user.nome
  });
  io.to(ADMIN_ROOM).emit('driver_status_changed', {
    driverId: driverProfile._id,
    newStatus: driverProfile.status
  });

  res.status(200).json({ message: 'Recolha iniciada.', order });
});

/**
 * Motorista conclui a RECOLHA (chega ao ponto de recolha)
 */
const completePickup = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const driverProfile = await DriverProfile.findOne({ user: req.user._id });
  if (!driverProfile) {
    res.status(404);
    throw new Error('Perfil de motorista não encontrado.');
  }

  const order = await Order.findById(id);
  if (!order) {
    res.status(404);
    throw new Error('Encomenda não encontrada.');
  }

  if (String(order.assigned_to_driver || '') !== String(driverProfile._id)) {
    res.status(403);
    throw new Error('Não autorizado para esta encomenda.');
  }

  if (
    ![
      ORDER_STATUS.ASSIGNED,
      ORDER_STATUS.PICKUP_IN_PROGRESS,
      ORDER_STATUS.IN_PROGRESS
    ].includes(order.status)
  ) {
    res.status(400);
    throw new Error('Esta encomenda não está numa fase válida para concluir a recolha.');
  }

  const pickupAuthorizedAt = order.pickup_authorized_at || order.pickupAuthorizedAt;
  if ((order.restaurant_id || order.restaurantId) && !pickupAuthorizedAt) {
    res.status(409);
    throw new Error('O estabelecimento ainda não autorizou a recolha deste pedido.');
  }

  const now = new Date();

  if (!order.pickupStartAt) {
    order.pickupStartAt = order.timestamp_started || now;
  }
  order.pickupCompletedAt = now;
  order.status = ORDER_STATUS.PICKUP_DONE;
  order.lastStatusAt = now;
  order.last_status_at = now;
  await order.save();
  await recordOrderStatus(order, `${req.user.nome || 'O motorista'} confirmou o levantamento do pedido.`);
  await recordOrderStatusEvent({
    order,
    label: 'Recolha concluída',
    actorType: 'driver',
    actorId: driverProfile,
    actorName: req.user.nome || 'Motorista'
  });
  await recordAudit('driver', driverProfile, 'pickup_completed', 'order', order, { status: order.status });

  // Mantemos o motorista como "ocupado" até iniciar entrega
  driverProfile.status = DRIVER_STATUS.ONLINE_BUSY;
  await driverProfile.save();
  await syncDriverPresence(driverProfile, {
    currentOrderId: order._id,
    isOnline: true,
    isAvailable: false
  });

  const io = req.app.get('socketio');
  io.to(ADMIN_ROOM).emit('pickup_completed', {
    id: order._id,
    driverName: req.user.nome
  });
  io.to(ADMIN_ROOM).emit('driver_status_changed', {
    driverId: driverProfile._id,
    newStatus: driverProfile.status
  });

  res.status(200).json({ message: 'Recolha concluída.', order });
});

/**
 * Motorista inicia a ENTREGA (sai do ponto de recolha para o destino)
 */
const startDeliveryPhase = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const driverProfile = await DriverProfile.findOne({ user: req.user._id });
  if (!driverProfile) {
    res.status(404);
    throw new Error('Perfil de motorista não encontrado.');
  }

  const order = await Order.findById(id);
  if (!order) {
    res.status(404);
    throw new Error('Encomenda não encontrada.');
  }

  if (String(order.assigned_to_driver || '') !== String(driverProfile._id)) {
    res.status(403);
    throw new Error('Não autorizado para esta encomenda.');
  }

  if (!order.pickupCompletedAt) {
    res.status(400);
    throw new Error('Ainda não foi registada a conclusão da recolha desta encomenda.');
  }

  if (
    ![
      ORDER_STATUS.PICKUP_DONE,
      ORDER_STATUS.DELIVERY_IN_PROGRESS,
      ORDER_STATUS.IN_PROGRESS
    ].includes(order.status)
  ) {
    res.status(400);
    throw new Error('Esta encomenda não está numa fase válida para iniciar a entrega.');
  }

  const now = new Date();
  if (!order.deliveryStartAt) {
    order.deliveryStartAt = now;
  }

  order.status = ORDER_STATUS.DELIVERY_IN_PROGRESS;
  order.lastStatusAt = now;
  order.last_status_at = now;
  await order.save();
  await recordOrderStatus(order, `${req.user.nome || 'O motorista'} iniciou a entrega ao cliente.`);
  await recordOrderStatusEvent({
    order,
    label: 'A caminho',
    actorType: 'driver',
    actorId: driverProfile,
    actorName: req.user.nome || 'Motorista'
  });
  await recordAudit('driver', driverProfile, 'delivery_started', 'order', order, { status: order.status });

  driverProfile.status = DRIVER_STATUS.DELIVERY;
  await driverProfile.save();
  await syncDriverPresence(driverProfile, {
    currentOrderId: order._id,
    isOnline: true,
    isAvailable: false
  });

  const io = req.app.get('socketio');
  io.to(ADMIN_ROOM).emit('delivery_started', {
    id: order._id,
    driverName: req.user.nome
  });
  io.to(ADMIN_ROOM).emit('driver_status_changed', {
    driverId: driverProfile._id,
    newStatus: driverProfile.status
  });

  res.status(200).json({ message: 'Entrega iniciada.', order });
});

/**
 * Motorista conclui a ENTREGA (entrega final) – também usado pela rota antiga POST /:id/complete
 */
const getImmediatePaymentRequired = (order) => order.payment_method !== PAYMENT_METHODS.POSTPAID_CREDIT;

const paymentMethodLabel = (method) => ({
  [PAYMENT_METHODS.CASH]: 'Dinheiro',
  [PAYMENT_METHODS.MPESA]: 'M-Pesa',
  [PAYMENT_METHODS.EMOLA]: 'e-Mola',
  [PAYMENT_METHODS.MKESH]: 'mKesh',
  [PAYMENT_METHODS.BANK_TRANSFER]: 'Transferência Bancária',
  [PAYMENT_METHODS.POS]: 'POS',
  [PAYMENT_METHODS.POSTPAID_CREDIT]: 'Cliente Pós-pago'
}[method] || method || '—');

const validateDriverAndOrder = async (req, orderId) => {
  const driverProfile = await DriverProfile.findOne({ user: req.user._id });
  if (!driverProfile) {
    const error = new Error('Perfil de motorista não encontrado.');
    error.statusCode = 404;
    throw error;
  }

  const order = await Order.findById(orderId);
  if (!order) {
    const error = new Error('Encomenda não encontrada.');
    error.statusCode = 404;
    throw error;
  }

  if (String(order.assigned_to_driver || '') !== String(driverProfile._id)) {
    const error = new Error('Não autorizado para esta encomenda.');
    error.statusCode = 403;
    throw error;
  }

  return { driverProfile, order };
};

exports.previewDeliveryPayment = asyncHandler(async (req, res) => {
  const data = req.filtered || req.body;
  const { id } = req.params;
  const verificationCode = String(data.verification_code || '').toUpperCase();
  const { driverProfile, order } = await validateDriverAndOrder(req, id);

  if (order.verification_code !== verificationCode) {
    res.status(400);
    throw new Error('Código de verificação incorreto.');
  }

  if (order.status !== ORDER_STATUS.DELIVERY_IN_PROGRESS) {
    res.status(400);
    throw new Error('Esta encomenda não está na fase de entrega para confirmação de pagamento.');
  }

  const now = new Date();
  if (getImmediatePaymentRequired(order)) {
    order.payment_status = PAYMENT_STATUS.AWAITING_DRIVER_CONFIRMATION;
  }
  order.payment_confirmation_requested_at = now;
  await order.save();

  const io = req.app.get('socketio');
  if (io && getImmediatePaymentRequired(order)) {
    const payload = {
      id: order._id,
      clientName: order.client_name,
      driverId: driverProfile._id,
      amount: Number(order.price || 0),
      paymentMethod: order.payment_method,
      orderCode: shortOrderCode(order._id),
      verificationCode: order.verification_code
    };
    await createAdminNotification({
      dedupeKey: `payment_pending:${order._id}`,
      type: 'payment',
      title: 'Pagamento por confirmar',
      message: `Pedido ${shortOrderCode(order._id)} · Código ${order.verification_code || '—'} · confirmar ${Number(order.price || 0).toFixed(2)} MZN.`,
      order,
      payload,
      createdAt: order.payment_confirmation_requested_at || new Date()
    });
    io.to(ADMIN_ROOM).emit('payment_confirmation_pending', payload);
    io.to(String(driverProfile.user)).emit('payment_confirmation_pending', payload);
  }

  res.status(200).json({
    orderId: order._id,
    totalToPay: Number(order.price || 0),
    paymentMethod: order.payment_method,
    paymentMethodLabel: paymentMethodLabel(order.payment_method),
    requiresImmediatePayment: getImmediatePaymentRequired(order),
    paymentStatus: order.payment_status,
    message: getImmediatePaymentRequired(order)
      ? 'Código validado. Confirme o valor recebido para finalizar.'
      : 'Código validado. Cliente pós-pago: sem cobrança no acto.'
  });
});

/**
 * Motorista conclui a ENTREGA (entrega final) – também usado pela rota antiga POST /:id/complete
 */
const completeDelivery = asyncHandler(async (req, res) => {
  const data = req.filtered || req.body;
  const { id } = req.params;
  const verificationCode = String(data.verification_code || '').toUpperCase();
  const paymentAmountConfirmed = data.payment_amount_confirmed;
  const driverDeliveryNotes = String(data.driver_delivery_notes || '').trim().slice(0, 1000);

  const { driverProfile, order } = await validateDriverAndOrder(req, id);

  if (order.verification_code !== verificationCode) {
    res.status(400);
    throw new Error('Código de verificação incorreto.');
  }

  const requiresImmediatePayment = getImmediatePaymentRequired(order);
  const totalPrice = Number(order.price || 0);

  if (requiresImmediatePayment) {
    const rawPaymentAmount = paymentAmountConfirmed;
    if (rawPaymentAmount === undefined || rawPaymentAmount === null || String(rawPaymentAmount).trim() === '') {
      res.status(400);
      throw new Error('Introduza manualmente o valor recebido para confirmar o pagamento.');
    }

    const confirmed = Number(String(rawPaymentAmount).trim().replace(',', '.'));
    if (!Number.isFinite(confirmed)) {
      res.status(400);
      throw new Error('Introduza um valor recebido válido.');
    }

    const expectedCents = Math.round(totalPrice * 100);
    const confirmedCents = Math.round(confirmed * 100);
    if (expectedCents !== confirmedCents) {
      order.payment_status = PAYMENT_STATUS.AWAITING_DRIVER_CONFIRMATION;
      order.payment_confirmation_requested_at = order.payment_confirmation_requested_at || new Date();
      await order.save();
      res.status(400);
      throw new Error(`Valor divergente. O valor correto a confirmar é ${totalPrice.toFixed(2)} MZN.`);
    }

    order.payment_confirmed_amount = confirmed;
    order.payment_status = PAYMENT_STATUS.PAID;
    order.payment_confirmed_at = new Date();
  } else {
    order.payment_confirmed_amount = 0;
    order.payment_status = PAYMENT_STATUS.POSTPAID_MONTHLY;
    order.payment_confirmed_at = new Date();
  }

  const now = new Date();

  // Garantir consistência dos tempos
  if (!order.timestamp_started) {
    order.timestamp_started = order.pickupStartAt || now;
  }
  if (!order.pickupStartAt) {
    order.pickupStartAt = order.timestamp_started;
  }
  if (!order.pickupCompletedAt) {
    order.pickupCompletedAt = now;
  }
  if (!order.deliveryStartAt) {
    order.deliveryStartAt = now;
  }
  order.deliveryCompletedAt = now;

  // Cálculo financeiro: oficiais não recebem comissão no painel.
  const driverType = driverProfile.driverType || DRIVER_TYPES.FREELANCER;
  const commissionRate = driverType === DRIVER_TYPES.OFFICIAL
    ? 0
    : parseCommissionRate(driverProfile.commissionRate, FINANCIAL.DEFAULT_COMMISSION_RATE);
  const driverValue = totalPrice * (commissionRate / 100);
  const companyValue = totalPrice - driverValue;

  order.valor_motorista = driverValue;
  order.valor_empresa = companyValue;
  order.driver_delivery_notes = driverDeliveryNotes;
  order.status = ORDER_STATUS.COMPLETED;
  order.timestamp_completed = now;
  order.lastStatusAt = now;
  order.last_status_at = now;
  await order.save();
  await recordOrderStatus(order, 'Entrega concluída com sucesso.');
  await recordOrderStatusEvent({
    order,
    label: 'Entregue',
    actorType: 'driver',
    actorId: driverProfile,
    actorName: req.user.nome || 'Motorista'
  });
  await recordAudit('driver', driverProfile, 'delivery_completed', 'order', order, {
    status: order.status,
    payment_status: order.payment_status
  });

  driverProfile.status = DRIVER_STATUS.ONLINE_FREE;
  await driverProfile.save();
  await syncDriverPresence(driverProfile, {
    currentOrderId: null,
    isOnline: true,
    isAvailable: true
  });

  await createAdminNotification({
    dedupeKey: `delivery_completed:${order._id}`,
    type: 'success',
    title: 'Entrega finalizada',
    message: `Pedido ${shortOrderCode(order._id)} · Código ${order.verification_code || '—'} · finalizado por ${req.user.nome || 'motorista'}.`,
    order,
    payload: { driverName: req.user.nome, amount: Number(order.price || 0), paymentMethod: order.payment_method },
    createdAt: order.timestamp_completed || new Date()
  });

  const io = req.app.get('socketio');
  io.to(ADMIN_ROOM).emit('delivery_completed', { id: order._id, orderCode: shortOrderCode(order._id), verificationCode: order.verification_code });
  io.to(ADMIN_ROOM).emit('driver_status_changed', {
    driverId: driverProfile._id,
    newStatus: driverProfile.status
  });

  res.status(200).json({ message: 'Entrega finalizada e pagamento confirmado com sucesso!', order });
});

// Exportações das fases (nomes novos + compatibilidade)
exports.startPickup = startPickup;
exports.completePickup = completePickup;
exports.startDeliveryPhase = startDeliveryPhase;
exports.completeDelivery = completeDelivery;

// Compatibilidade com a rota antiga /:id/start
exports.startDelivery = startPickup;


exports.getPaymentPendingOrders = asyncHandler(async (req, res) => {
  if (!['admin', 'driver'].includes(req.user?.role)) {
    res.status(403);
    throw new Error('Acesso restrito a administradores e motoristas.');
  }

  const query = {
    status: ORDER_STATUS.DELIVERY_IN_PROGRESS,
    payment_status: PAYMENT_STATUS.AWAITING_DRIVER_CONFIRMATION
  };

  if (req.user.role === 'driver') {
    const driverProfile = await DriverProfile.findOne({ user: req.user._id });
    if (!driverProfile) {
      res.status(404);
      throw new Error('Perfil de motorista não encontrado.');
    }
    query.assigned_to_driver = driverProfile._id;
  }

  const orders = await Order.find(query)
    .populate({ path: 'assigned_to_driver', populate: { path: 'user', select: 'nome telefone' } })
    .sort({ payment_confirmation_requested_at: -1 })
    .lean();

  res.status(200).json({ total: orders.length, orders });
});

// -----------------------------------------------------------------------------
// LISTAS PARA ADMIN
// -----------------------------------------------------------------------------

exports.getAllOrders = asyncHandler(async (_req, res) => {
  const orders = await Order.find()
    .populate('assigned_to_driver')
    .populate('created_by_admin', 'nome email')
    .sort({ createdAt: -1 })
    .lean();

  res.status(200).json({ orders });
});

exports.getActiveOrders = asyncHandler(async (_req, res) => {
  const activeStatuses = [
    ORDER_STATUS.PENDING,
    ORDER_STATUS.ASSIGNED,
    ORDER_STATUS.IN_PROGRESS,
    ORDER_STATUS.PICKUP_IN_PROGRESS,
    ORDER_STATUS.PICKUP_DONE,
    ORDER_STATUS.DELIVERY_IN_PROGRESS
  ];

  const orders = await Order.find({
    status: { $in: activeStatuses }
  })
    .populate('created_by_admin', 'nome')
    .populate({
      path: 'assigned_to_driver',
      populate: { path: 'user', select: 'nome' }
    })
    .sort({ createdAt: -1 })
    .lean();

  res.status(200).json({ orders });
});

exports.getHistoryOrders = asyncHandler(async (req, res) => {
  const range = getPeriodRange(req.query?.period || 'month');
  const orders = await Order.find({
    status: { $in: [ORDER_STATUS.COMPLETED, ORDER_STATUS.CANCELED] },
    timestamp_completed: { $gte: range.start, $lte: range.end }
  })
    .populate({
      path: 'assigned_to_driver',
      populate: { path: 'user', select: 'nome' }
    })
    .sort({ timestamp_completed: -1 })
    .lean();

  res.status(200).json({
    orders,
    period: { key: range.key, label: range.label, start: range.start, end: range.end }
  });
});

exports.getOrderById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const order = await Order.findById(id)
    .populate('created_by_admin', 'nome')
    .populate({
      path: 'assigned_to_driver',
      populate: { path: 'user', select: 'nome telefone' }
    })
    .lean();

  if (!order) {
    res.status(404);
    throw new Error('Encomenda não encontrada.');
  }

  res.status(200).json({ order });
});

// -----------------------------------------------------------------------------
// CANCELAMENTO DE ENCOMENDAS (ADMIN)
// -----------------------------------------------------------------------------

exports.cancelOrder = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { reason } = req.filtered || req.body || {};

  const order = await Order.findById(id);
  if (!order) {
    res.status(404);
    throw new Error('Encomenda não encontrada.');
  }

  if (order.status === ORDER_STATUS.COMPLETED || order.status === ORDER_STATUS.CANCELED) {
    res.status(400);
    throw new Error('Esta encomenda já foi concluída ou cancelada.');
  }

  const affectedDriverId = order.assigned_to_driver || order.offered_to_driver;
  order.status = ORDER_STATUS.CANCELED;
  order.cancelledAt = new Date();
  order.cancelledBy = req.user._id;
  order.cancelReason = (reason || 'Cancelado pelo administrador').slice(0, 500);
  order.offered_to_driver = null;
  order.driver_offer_status = null;
  order.driver_offer_expires_at = null;

  if (order.payment_method === PAYMENT_METHODS.POSTPAID_CREDIT && order.client) {
    const linkedClient = await Client.findById(order.client);
    if (linkedClient) {
      const refundAmount = Number(order.price || 0);
      linkedClient.credit_balance = Math.min(
        Number(linkedClient.credit_limit || 0),
        Number(linkedClient.credit_balance || 0) + refundAmount
      );
      linkedClient.credit_used = Math.max(0, Number(linkedClient.credit_used || 0) - refundAmount);
      await linkedClient.save();
    }
  }

  await order.save();
  await cancelPendingDriverOffers(order._id);
  await recordOrderStatus(order, 'O Admin cancelou este pedido.', { reason: order.cancelReason });
  await recordOrderStatusEvent({
    order,
    label: 'Cancelado',
    actorType: 'admin',
    actorId: req.user,
    actorName: req.user.nome || 'Admin',
    note: order.cancelReason
  });
  await recordAudit('admin', req.user, 'order_cancelled', 'order', order, {
    reason: order.cancelReason
  });

  // Se tinha motorista atribuído, libertar
  if (affectedDriverId) {
    const driverProfile = await DriverProfile.findById(affectedDriverId);
    if (driverProfile) {
      driverProfile.status = DRIVER_STATUS.ONLINE_FREE;
      await driverProfile.save();
      await syncDriverPresence(driverProfile, {
        currentOrderId: null,
        isOnline: true,
        isAvailable: true
      });
    }
  }

  const io = req.app.get('socketio');
  if (io) {
    io.to(ADMIN_ROOM).emit('order_canceled', {
      id: order._id,
      reason: order.cancelReason
    });
  }

  res.status(200).json({
    message: 'Encomenda cancelada com sucesso.',
    order
  });
});
