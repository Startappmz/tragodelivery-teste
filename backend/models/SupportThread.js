const { createModel } = require('../lib/supabaseModel');

const SupportThread = createModel({
  name: 'SupportThread',
  table: 'support_threads',
  collection: 'support_threads',
  mapping: {
    _id: 'id',
    id: 'id',
    subject: 'subject',
    category: 'category',
    status: 'status',
    priority: 'priority',
    requesterRole: 'requester_role',
    requester_role: 'requester_role',
    requesterId: 'requester_id',
    requester_id: 'requester_id',
    requesterName: 'requester_name',
    requester_name: 'requester_name',
    orderId: 'order_id',
    order_id: 'order_id',
    assignedAdminId: 'assigned_admin_id',
    assigned_admin_id: 'assigned_admin_id',
    lastMessageAt: 'last_message_at',
    last_message_at: 'last_message_at',
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  },
  defaults: {
    category: 'general',
    status: 'open',
    priority: 'normal',
    requesterName: '',
    orderId: null,
    assignedAdminId: null,
    lastMessageAt: null
  }
});

module.exports = SupportThread;
