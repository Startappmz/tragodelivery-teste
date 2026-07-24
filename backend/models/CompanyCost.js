const { createModel } = require('../lib/supabaseModel');

const COMPANY_COST_CATEGORIES = [
  'manutencao',
  'combustivel',
  'emprestimo',
  'credito',
  'taxa_trans_levant',
  'consumiveis',
  'despesas_aplicativo',
  'diversos'
];

const CompanyCost = createModel({
  name: 'CompanyCost',
  table: 'company_costs',
  collection: 'companycosts',
  mapping: {
    _id: 'id',
    id: 'id',
    category: 'category',
    description: 'description',
    amount: 'amount',
    date: 'date',
    createdBy: 'created_by',
    assignedUser: 'assigned_user',
    assignedClient: 'assigned_client',
    assignedVehicle: 'assigned_vehicle',
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  },
  defaults: {
    description: '',
    amount: 0,
    assignedUser: null,
    assignedClient: null,
    assignedVehicle: null
  },
  relations: {
    createdBy: {
      model: () => require('./User'),
      localField: 'createdBy',
      foreignField: '_id',
      single: true
    },
    assignedUser: {
      model: () => require('./User'),
      localField: 'assignedUser',
      foreignField: '_id',
      single: true
    },
    assignedClient: {
      model: () => require('./Client'),
      localField: 'assignedClient',
      foreignField: '_id',
      single: true
    },
    assignedVehicle: {
      model: () => require('./Vehicle'),
      localField: 'assignedVehicle',
      foreignField: '_id',
      single: true
    }
  }
});

CompanyCost.CATEGORIES = COMPANY_COST_CATEGORIES;

module.exports = CompanyCost;
module.exports.COMPANY_COST_CATEGORIES = COMPANY_COST_CATEGORIES;
