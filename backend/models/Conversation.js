const { createModel } = require('../lib/supabaseModel');

const Conversation = createModel({
  name: 'Conversation',
  table: 'conversations',
  collection: 'conversations',
  mapping: {
    _id: 'id',
    id: 'id',
    orderId: 'order_id',
    order_id: 'order_id',
    scope: 'scope',
    channelType: 'channel_type',
    channel_type: 'channel_type',
    closedAt: 'closed_at',
    closed_at: 'closed_at',
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  },
  defaults: {
    scope: 'order',
    channelType: 'client_driver',
    closedAt: null
  }
});

module.exports = Conversation;
