const { createModel } = require('../lib/supabaseModel');

const OrderMessage = createModel({
  name: 'OrderMessage',
  table: 'order_messages',
  collection: 'order_messages',
  mapping: {
    _id: 'id',
    id: 'id',
    orderId: 'order_id',
    order_id: 'order_id',
    senderRole: 'sender_role',
    sender_role: 'sender_role',
    senderId: 'sender_id',
    sender_id: 'sender_id',
    senderName: 'sender_name',
    sender_name: 'sender_name',
    body: 'body',
    conversationId: 'conversation_id',
    conversation_id: 'conversation_id',
    channelType: 'channel_type',
    channel_type: 'channel_type',
    visibleToRoles: 'visible_to_roles',
    visible_to_roles: 'visible_to_roles',
    messageType: 'message_type',
    message_type: 'message_type',
    metadata: 'metadata',
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  },
  defaults: {
    messageType: 'text',
    channelType: 'system',
    visibleToRoles: ['client', 'driver', 'restaurant', 'admin'],
    metadata: {}
  }
});

module.exports = OrderMessage;
