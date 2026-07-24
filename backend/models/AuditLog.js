const { createModel } = require('../lib/supabaseModel');

const AuditLog = createModel({
  name: 'AuditLog',
  table: 'audit_logs',
  collection: 'audit_logs',
  mapping: {
    _id: 'id',
    id: 'id',
    actorRole: 'actor_role',
    actor_role: 'actor_role',
    actorId: 'actor_id',
    actor_id: 'actor_id',
    action: 'action',
    entityType: 'entity_type',
    entity_type: 'entity_type',
    entityId: 'entity_id',
    entity_id: 'entity_id',
    payload: 'payload',
    createdAt: 'created_at'
  },
  defaults: {
    actorRole: 'system',
    payload: {}
  }
});

module.exports = AuditLog;
