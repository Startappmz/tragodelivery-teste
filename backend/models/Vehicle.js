const { createModel } = require('../lib/supabaseModel');

const Vehicle = createModel({
  name: 'Vehicle',
  table: 'vehicles',
  collection: 'vehicles',
  mapping: {
    _id: 'id',
    id: 'id',
    plate: 'plate',
    brand: 'brand',
    model: 'model',
    type: 'type',
    status: 'status',
    notes: 'notes',
    created_by: 'created_by',
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  },
  defaults: {
    brand: '',
    model: '',
    type: 'mota',
    status: 'ativo',
    notes: ''
  },
  relations: {
    created_by: {
      model: () => require('./User'),
      localField: 'created_by',
      foreignField: '_id',
      single: true
    }
  }
});

module.exports = Vehicle;
