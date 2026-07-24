const { createModel } = require('../lib/supabaseModel');

const SupportMessage = createModel({
  name: 'SupportMessage',
  table: 'support_messages',
  collection: 'support_messages',
  mapping: {
    _id: 'id',
    id: 'id',
    threadId: 'thread_id',
    thread_id: 'thread_id',
    senderRole: 'sender_role',
    sender_role: 'sender_role',
    senderId: 'sender_id',
    sender_id: 'sender_id',
    senderName: 'sender_name',
    sender_name: 'sender_name',
    body: 'body',
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  }
});

module.exports = SupportMessage;
