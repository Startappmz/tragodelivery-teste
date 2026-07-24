const asyncHandler = require('express-async-handler');
const { isValidId } = require('../utils/id');
const Client = require('../models/Client');
const Order = require('../models/Order');
const { ORDER_STATUS, CLIENT_BILLING_TYPES } = require('../utils/constants');

function normalizeBillingPayload(data = {}, currentClient = null) {
  const billingType = Object.values(CLIENT_BILLING_TYPES).includes(data.billing_type)
    ? data.billing_type
    : (currentClient?.billing_type || CLIENT_BILLING_TYPES.PREPAID);

  const creditLimit = Number(data.credit_limit ?? currentClient?.credit_limit ?? 0) || 0;
  const creditUsed = Number(data.credit_used ?? currentClient?.credit_used ?? 0) || 0;
  let creditBalance;
  if (data.credit_balance !== undefined) {
    creditBalance = Number(data.credit_balance) || 0;
  } else if (data.credit_limit !== undefined) {
    // Quando o admin atribui/actualiza crédito, o disponível passa a ser o limite menos o já consumido.
    creditBalance = Math.max(creditLimit - creditUsed, 0);
  } else {
    creditBalance = Number(currentClient?.credit_balance ?? creditLimit) || 0;
  }

  if (billingType === CLIENT_BILLING_TYPES.PREPAID) {
    creditBalance = 0;
  }

  if (creditBalance > creditLimit) creditBalance = creditLimit;
  if (creditBalance < 0) creditBalance = 0;

  return { billingType, creditLimit, creditBalance, creditUsed };
}

exports.createClient = asyncHandler(async (req, res) => {
  const data = req.filtered || req.body;
  const { nome, telefone, email, empresa, nuit, endereco } = data;

  const existingClient = await Client.findOne({ telefone });
  if (existingClient) {
    res.status(400);
    throw new Error('Um cliente com este número de telefone já existe.');
  }

  const billing = normalizeBillingPayload(data);

  const client = await Client.create({
    nome,
    telefone,
    email,
    empresa,
    nuit,
    endereco,
    billing_type: billing.billingType,
    credit_limit: billing.creditLimit,
    credit_balance: billing.billingType === CLIENT_BILLING_TYPES.POSTPAID ? billing.creditBalance : 0,
    credit_used: billing.billingType === CLIENT_BILLING_TYPES.POSTPAID ? billing.creditUsed : 0,
    created_by_admin: req.user._id
  });

  res.status(201).json({ message: 'Cliente criado com sucesso', client });
});

exports.getAllClients = asyncHandler(async (_req, res) => {
  const clients = await Client.find().sort({ nome: 1 }).lean();
  res.status(200).json({ clients });
});

exports.getClientById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!isValidId(id)) {
    res.status(404);
    throw new Error('Cliente não encontrado (ID inválido).');
  }

  const client = await Client.findById(id);
  if (!client) {
    res.status(404);
    throw new Error('Cliente não encontrado.');
  }

  res.status(200).json({ client });
});

exports.updateClient = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const data = req.filtered || req.body;
  const { nome, telefone, email, empresa, nuit, endereco } = data;

  const client = await Client.findById(id);
  if (!client) {
    res.status(404);
    throw new Error('Cliente não encontrado.');
  }

  if (telefone !== client.telefone) {
    const phoneInUse = await Client.findOne({ telefone });
    if (phoneInUse) {
      res.status(400);
      throw new Error('Este novo número de telefone já está em uso.');
    }
  }

  const billing = normalizeBillingPayload(data, client);

  client.nome = nome;
  client.telefone = telefone;
  client.email = email;
  client.empresa = empresa;
  client.nuit = nuit;
  client.endereco = endereco;
  client.billing_type = billing.billingType;
  client.credit_limit = billing.creditLimit;
  client.credit_balance = billing.billingType === CLIENT_BILLING_TYPES.POSTPAID ? billing.creditBalance : 0;
  client.credit_used = billing.billingType === CLIENT_BILLING_TYPES.POSTPAID ? billing.creditUsed : 0;

  await client.save();

  res.status(200).json({ message: 'Cliente atualizado com sucesso', client });
});

exports.deleteClient = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const client = await Client.findById(id);
  if (!client) {
    res.status(404);
    throw new Error('Cliente não encontrado.');
  }

  const hasOrders = await Order.exists({ client: id });
  if (hasOrders) {
    res.status(400);
    throw new Error('Não é possível apagar clientes com histórico de encomendas.');
  }

  await client.deleteOne();
  res.status(200).json({ message: 'Cliente apagado com sucesso' });
});

exports.getStatement = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { startDate, endDate } = req.query;

  if (!startDate || !endDate) {
    res.status(400);
    throw new Error('Datas de início e fim são obrigatórias.');
  }

  const start = new Date(startDate);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setUTCHours(23, 59, 59, 999);

  const client = await Client.findById(id).lean();
  if (!client) {
    res.status(404);
    throw new Error('Cliente não encontrado.');
  }

  const orders = await Order.find({
    client: id,
    status: ORDER_STATUS.COMPLETED,
    timestamp_completed: { $gte: start, $lte: end }
  })
    .sort({ timestamp_completed: 1 })
    .lean();

  const totalValue = orders.reduce((total, order) => total + Number(order.price || 0), 0);

  res.status(200).json({
    client,
    totalValue,
    totalOrders: orders.length,
    credit: {
      billing_type: client.billing_type,
      limit: Number(client.credit_limit || 0),
      balance: Number(client.credit_balance || 0),
      used: Number(client.credit_used || 0),
      credit_limit: Number(client.credit_limit || 0),
      credit_balance: Number(client.credit_balance || 0),
      credit_used: Number(client.credit_used || 0)
    },
    ordersList: orders
  });
});
