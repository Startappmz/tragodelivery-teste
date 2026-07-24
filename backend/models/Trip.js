const { createModel } = require('../lib/supabaseModel');

const TRIP_TYPE = Object.freeze({
  COLETA: 'coleta',
  ENTREGA: 'entrega',
  RETORNO_CENTRAL: 'retorno_central',
  PAUSA: 'pausa',
  OUTRO: 'outro'
});

const TRIP_STATUS = Object.freeze({
  EM_ANDAMENTO: 'em_andamento',
  CONCLUIDA: 'concluida',
  CANCELADA: 'cancelada'
});

const Trip = createModel({
  name: 'Trip',
  table: 'trips',
  collection: 'trips',
  mapping: {
    _id: 'id',
    id: 'id',
    driver: 'driver',
    order: 'order_id',
    type: 'type',
    status: 'status',
    startedAt: 'started_at',
    finishedAt: 'finished_at',
    origin: 'origin',
    destination: 'destination',
    positions: 'positions',
    metrics: 'metrics',
    notes: 'notes',
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  },
  defaults: {
    status: TRIP_STATUS.EM_ANDAMENTO,
    positions: [],
    metrics: { distance: 0, duration: 0, avgSpeed: 0, maxSpeed: 0 },
    origin: null,
    destination: null,
    notes: ''
  },
  relations: {
    driver: {
      model: () => require('./DriverProfile'),
      localField: 'driver',
      foreignField: '_id',
      single: true
    },
    order: {
      model: () => require('./Order'),
      localField: 'order',
      foreignField: '_id',
      single: true
    }
  }
});

Trip.TRIP_TYPE = TRIP_TYPE;
Trip.TRIP_STATUS = TRIP_STATUS;

module.exports = Trip;
module.exports.TRIP_TYPE = TRIP_TYPE;
module.exports.TRIP_STATUS = TRIP_STATUS;
