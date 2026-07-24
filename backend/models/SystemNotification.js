const { createModel } = require('../lib/supabaseModel');

const SystemNotification = createModel({
  name: 'SystemNotification',
  table: 'system_notifications',
  collection: 'system_notifications',
  mapping: {
    _id: 'id',
    id: 'id',
    scope: 'scope',
    dedupe_key: 'dedupe_key',
    type: 'type',
    title: 'title',
    message: 'message',
    orderId: 'order_id',
    order_id: 'order_id',
    orderCode: 'order_code',
    order_code: 'order_code',
    verificationCode: 'verification_code',
    verification_code: 'verification_code',
    payload: 'payload',
    readAt: 'read_at',
    read_at: 'read_at',
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  },
  defaults: {
    scope: 'admin',
    type: 'info',
    message: '',
    payload: {},
    readAt: null
  }
});

module.exports = SystemNotification;
