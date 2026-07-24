const { createModel } = require('../lib/supabaseModel');

const PasswordResetCode = createModel({
  name: 'PasswordResetCode',
  table: 'password_reset_codes',
  collection: 'password_reset_codes',
  mapping: {
    _id: 'id',
    id: 'id',
    user: 'user_id',
    email: 'email',
    role: 'role',
    codeHash: 'code_hash',
    expiresAt: 'expires_at',
    usedAt: 'used_at',
    attempts: 'attempts',
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  }
});

module.exports = PasswordResetCode;
