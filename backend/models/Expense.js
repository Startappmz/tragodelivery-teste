const { createModel } = require('../lib/supabaseModel');

const Expense = createModel({
  name: 'Expense',
  table: 'expenses',
  collection: 'expenses',
  mapping: {
    _id: 'id',
    id: 'id',
    category: 'category',
    description: 'description',
    amount: 'amount',
    date: 'date',
    employee: 'employee',
    created_by: 'created_by',
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  },
  defaults: {
    employee: null,
    amount: 0
  },
  relations: {
    employee: {
      model: () => require('./User'),
      localField: 'employee',
      foreignField: '_id',
      single: true
    },
    created_by: {
      model: () => require('./User'),
      localField: 'created_by',
      foreignField: '_id',
      single: true
    }
  }
});

module.exports = Expense;
