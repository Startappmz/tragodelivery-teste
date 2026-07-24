const { createModel } = require('../lib/supabaseModel');

const OrderStatusEvent = createModel({
  name: 'OrderStatusEvent',
  table: 'order_status_events',
  collection: 'order_status_events',
  mapping: {
    _id: 'id',
    id: 'id',
    orderId: 'order_id',
    order_id: 'order_id',
    status: 'status',
    label: 'label',
    actorType: 'actor_type',
    actor_type: 'actor_type',
    actorId: 'actor_id',
    actor_id: 'actor_id',
    actorName: 'actor_name',
    actor_name: 'actor_name',
    note: 'note',
    metadata: 'metadata',
    createdAt: 'created_at'
  },
  defaults: {
    label: '',
    actorType: 'system',
    actorId: '',
    actorName: '',
    note: '',
    metadata: {}
  }
});

module.exports = OrderStatusEvent;
