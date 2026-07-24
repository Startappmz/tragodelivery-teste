const SystemNotification = require('../models/SystemNotification');
const Order = require('../models/Order');
const { ORDER_STATUS, PAYMENT_STATUS } = require('./constants');

const shortOrderCode = (orderId) => {
  const raw = String(orderId || '').trim();
  return raw ? `#${raw.slice(-6).toUpperCase()}` : '—';
};

const createAdminNotification = async ({
  dedupeKey,
  type = 'info',
  title = 'Notificação',
  message = '',
  order = null,
  orderId = null,
  orderCode = '',
  verificationCode = '',
  payload = {},
  createdAt = null
} = {}) => {
  try {
    const effectiveOrderId = orderId || order?._id || order?.id || null;
    const effectiveDedupeKey = String(dedupeKey || `${type}:${effectiveOrderId || Date.now()}`).slice(0, 180);
    const existing = await SystemNotification.findOne({ dedupe_key: effectiveDedupeKey }).lean();
    if (existing) return existing;
    return await SystemNotification.create({
      scope: 'admin',
      dedupe_key: effectiveDedupeKey,
      type: String(type || 'info').slice(0, 40),
      title: String(title || 'Notificação').slice(0, 120),
      message: String(message || '').slice(0, 500),
      orderId: effectiveOrderId,
      orderCode: orderCode || shortOrderCode(effectiveOrderId),
      verificationCode: verificationCode || order?.verification_code || '',
      payload: payload || {},
      createdAt: createdAt || new Date()
    });
  } catch (error) {
    console.warn('[trago-backend] Notificação não persistida:', error.message || error);
    return null;
  }
};

const syncOperationalNotifications = async () => {
  try {
    const pendingOrders = await Order.find({ status: ORDER_STATUS.PENDING }).sort({ createdAt: -1 }).limit(25).lean();
    for (const order of pendingOrders) {
      await createAdminNotification({
        dedupeKey: `new_order:${order._id}`,
        type: 'order',
        title: 'Novo pedido recebido',
        message: `Pedido ${shortOrderCode(order._id)} · ${order.client_name || 'Cliente'} aguarda atribuição.`,
        order,
        payload: { clientName: order.client_name, amount: Number(order.price || 0), paymentMethod: order.payment_method },
        createdAt: order.createdAt || new Date()
      });
    }

    const paymentOrders = await Order.find({ payment_status: PAYMENT_STATUS.AWAITING_DRIVER_CONFIRMATION }).sort({ payment_confirmation_requested_at: -1 }).limit(50).lean();
    for (const order of paymentOrders) {
      await createAdminNotification({
        dedupeKey: `payment_pending:${order._id}`,
        type: 'payment',
        title: 'Pagamento por confirmar',
        message: `Pedido ${shortOrderCode(order._id)} · Código ${order.verification_code || '—'} · confirmar ${Number(order.price || 0).toFixed(2)} MZN.`,
        order,
        payload: { clientName: order.client_name, amount: Number(order.price || 0), paymentMethod: order.payment_method },
        createdAt: order.payment_confirmation_requested_at || order.updatedAt || new Date()
      });
    }
  } catch (error) {
    console.warn('[trago-backend] Falha ao sincronizar notificações:', error.message || error);
  }
};

module.exports = { shortOrderCode, createAdminNotification, syncOperationalNotifications };
