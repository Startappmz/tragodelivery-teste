const AuditLog = require('../models/AuditLog');
const OrderStatusEvent = require('../models/OrderStatusEvent');

const idOf = (value) => String(value?._id || value?.id || value || '');

const recordAudit = async (actorRole, actorId, action, entityType, entityId, payload = {}) => AuditLog.create({
  actorRole: actorRole || 'system',
  actorId: idOf(actorId) || null,
  action,
  entityType,
  entityId: idOf(entityId) || null,
  payload
});

const recordOrderStatusEvent = async ({
  order,
  status,
  label,
  actorType = 'system',
  actorId = '',
  actorName = '',
  note = '',
  metadata = {}
}) => OrderStatusEvent.create({
  orderId: idOf(order),
  status: status || order?.status || 'pendente',
  label,
  actorType,
  actorId: idOf(actorId),
  actorName,
  note,
  metadata
});

module.exports = {
  recordAudit,
  recordOrderStatusEvent
};
