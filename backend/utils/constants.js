// backend/utils/constants.js

const ADMIN_ROOM = 'admin_room';

const DRIVER_STATUS = Object.freeze({
  ONLINE_FREE: 'online_livre',
  ONLINE_BUSY: 'online_ocupado',
  PICKUP: 'em_recolha',
  DELIVERY: 'em_entrega',
  OFFLINE: 'offline'
});

const DRIVER_TYPES = Object.freeze({
  FREELANCER: 'freelancer',
  OFFICIAL: 'official'
});

const ORDER_STATUS = Object.freeze({
  PENDING: 'pendente',
  ASSIGNED: 'atribuido',
  IN_PROGRESS: 'em_progresso',
  PICKUP_IN_PROGRESS: 'recolha_em_progresso',
  PICKUP_DONE: 'recolha_concluida',
  DELIVERY_IN_PROGRESS: 'entrega_em_progresso',
  COMPLETED: 'concluido',
  CANCELED: 'cancelado'
});

const MESSAGE_CHANNEL = Object.freeze({
  CLIENT_DRIVER: 'client_driver',
  DRIVER_PARTNER: 'driver_partner',
  SYSTEM: 'system',
  SUPPORT: 'support'
});

const MESSAGE_CHANNELS = Object.freeze(Object.values(MESSAGE_CHANNEL));

const PAYMENT_STATUS = Object.freeze({
  UNPAID: 'nao_pago',
  AWAITING_DRIVER_CONFIRMATION: 'aguardando_confirmacao_pagamento',
  PAID: 'pago',
  POSTPAID_MONTHLY: 'pos_pago_mensal'
});

const PAYMENT_METHODS = Object.freeze({
  CASH: 'cash',
  MPESA: 'mpesa',
  EMOLA: 'emola',
  MKESH: 'mkesh',
  BANK_TRANSFER: 'bank_transfer',
  POS: 'pos',
  POSTPAID_CREDIT: 'postpaid_credit'
});

const CLIENT_BILLING_TYPES = Object.freeze({
  PREPAID: 'prepaid',
  POSTPAID: 'postpaid'
});

const SERVICE_TYPES = Object.freeze({
  RAPIDO: 'rapido',
  DOC: 'doc',
  FARMA: 'farma',
  CARGA: 'carga',
  RESTAURANTE_COMIDA: 'restaurante_comida',
  MERCADORIA_CP: 'mercadoria_cp',
  REFEICAO_RESTAURANTE_P: 'refeicao_restaurante_p',
  OUTROS: 'outros'
});

const SERVICE_TYPE_LABELS = Object.freeze({
  [SERVICE_TYPES.RAPIDO]: 'Delivery Rápido',
  [SERVICE_TYPES.DOC]: 'Tramitação de Documentos',
  [SERVICE_TYPES.FARMA]: 'Produtos Farmacêuticos',
  [SERVICE_TYPES.CARGA]: 'Transporte de Cargas',
  [SERVICE_TYPES.RESTAURANTE_COMIDA]: 'Comida de Restaurante',
  [SERVICE_TYPES.MERCADORIA_CP]: 'Mercadoria C/P',
  [SERVICE_TYPES.REFEICAO_RESTAURANTE_P]: 'Refeição Restaurante P',
  [SERVICE_TYPES.OUTROS]: 'Outros Serviços'
});

const FINANCIAL = Object.freeze({
  DEFAULT_COMMISSION_RATE: 20
});

module.exports = {
  ADMIN_ROOM,
  DRIVER_STATUS,
  DRIVER_TYPES,
  ORDER_STATUS,
  MESSAGE_CHANNEL,
  MESSAGE_CHANNELS,
  PAYMENT_STATUS,
  PAYMENT_METHODS,
  CLIENT_BILLING_TYPES,
  SERVICE_TYPES,
  SERVICE_TYPE_LABELS,
  FINANCIAL
};
