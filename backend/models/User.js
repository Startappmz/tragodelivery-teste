const { createModel } = require('../lib/supabaseModel');

const User = createModel({
  name: 'User',
  table: 'users',
  collection: 'users',
  mapping: {
    _id: 'id',
    id: 'id',
    nome: 'nome',
    email: 'email',
    telefone: 'telefone',
    password: 'password',
    role: 'role',
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  },
  relations: {
    profile: {
      model: () => require('./DriverProfile'),
      localField: '_id',
      foreignField: 'user',
      single: true,
      virtual: true
    }
  }
});

module.exports = User;
