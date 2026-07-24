// backend/controllers/costController.js

const asyncHandler = require('express-async-handler');
const { isValidId } = require('../utils/id');
const CompanyCost = require('../models/CompanyCost');
const Order = require('../models/Order');
const { ORDER_STATUS } = require('../utils/constants');
const { COMPANY_COST_CATEGORIES } = require('../models/CompanyCost');

/**
 * Helper: devolve início e fim de um mês (UTC safe)
 */
function getMonthRange(year, monthIndex) {
  // monthIndex: 0-11
  const start = new Date(Date.UTC(year, monthIndex, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, monthIndex + 1, 0, 23, 59, 59, 999));
  return { start, end };
}

/**
 * POST /api/costs
 * Body: { category, amount, description?, date?, assignedUserId?, assignedClientId? }
 */
exports.createCost = asyncHandler(async (req, res) => {
  const {
    category,
    amount,
    description,
    date,
    assignedUserId,
    assignedClientId,
    assignedVehicleId
  } = req.body;

  if (!COMPANY_COST_CATEGORIES.includes(category)) {
    res.status(400);
    throw new Error('Categoria de custo inválida.');
  }

  const parsedAmount = Number(amount);
  if (Number.isNaN(parsedAmount) || parsedAmount < 0) {
    res.status(400);
    throw new Error('Valor do custo inválido.');
  }

  let parsedDate = new Date();
  if (date) {
    const tmp = new Date(date);
    if (!Number.isNaN(tmp.getTime())) parsedDate = tmp;
  }

  let assignedUser = null;
  let assignedClient = null;
  let assignedVehicle = null;

  if (assignedUserId) {
    if (!isValidId(assignedUserId)) {
      res.status(400);
      throw new Error('ID de utilizador inválido para atribuição do custo.');
    }
    assignedUser = assignedUserId;
  }

  if (assignedClientId) {
    if (!isValidId(assignedClientId)) {
      res.status(400);
      throw new Error('ID de cliente inválido para atribuição do custo.');
    }
    assignedClient = assignedClientId;
  }

  if (assignedVehicleId) {
    if (!isValidId(assignedVehicleId)) {
      res.status(400);
      throw new Error('ID de veículo inválido para atribuição do custo.');
    }
    assignedVehicle = assignedVehicleId;
  }

  const assignments = [assignedUser, assignedClient, assignedVehicle].filter(Boolean);
  if (assignments.length > 1) {
    res.status(400);
    throw new Error('O custo só pode ser atribuído a um funcionário, cliente ou veículo.');
  }

  const cost = await CompanyCost.create({
    category,
    amount: parsedAmount,
    description: description || '',
    date: parsedDate,
    createdBy: req.user ? req.user.id : undefined,
    assignedUser,
    assignedClient,
    assignedVehicle
  });

  res.status(201).json({
    message: 'Custo registado com sucesso.',
    cost
  });
});

/**
 * GET /api/costs
 *   ?month=YYYY-MM
 *   ?limit=50
 */
exports.getCostsList = asyncHandler(async (req, res) => {
  const { month, limit } = req.query;

  const query = {};
  if (month) {
    const [yearStr, monthStr] = month.split('-');
    const year = Number(yearStr);
    const monthIndex = Number(monthStr) - 1;
    if (!Number.isNaN(year) && !Number.isNaN(monthIndex) && monthIndex >= 0 && monthIndex <= 11) {
      const { start, end } = getMonthRange(year, monthIndex);
      query.date = { $gte: start, $lte: end };
    }
  }

  const max = Number(limit) && Number(limit) > 0 ? Number(limit) : 100;

  const costs = await CompanyCost.find(query)
    .sort({ date: -1 })
    .limit(max)
    .populate('assignedUser', 'nome telefone role')
    .populate('assignedClient', 'nome telefone empresa')
    .populate('assignedVehicle', 'plate brand model type status')
    .lean();

  res.status(200).json({
    total: costs.length,
    costs
  });
});

/**
 * GET /api/costs/dashboard-summary
 *   ?months=6
 */
const getCostsDashboardSummary = asyncHandler(async (req, res) => {
  const monthsBack = Number(req.query.months) && Number(req.query.months) > 0
    ? Number(req.query.months)
    : 6;

  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const currentMonthIndex = now.getUTCMonth(); // 0-11

  // 1) Mês atual – total e por categoria
  const { start: currentStart, end: currentEnd } = getMonthRange(currentYear, currentMonthIndex);

  const currentCostsAgg = await CompanyCost.aggregate([
    { $match: { date: { $gte: currentStart, $lte: currentEnd } } },
    {
      $group: {
        _id: '$category',
        total: { $sum: '$amount' }
      }
    }
  ]);

  const costsByCategory = {};
  let totalCosts = 0;
  COMPANY_COST_CATEGORIES.forEach(cat => {
    costsByCategory[cat] = 0;
  });

  currentCostsAgg.forEach(item => {
    costsByCategory[item._id] = item.total;
    totalCosts += item.total;
  });

  // 2) Histórico de meses para gráfico Receita vs Custos
  const labels = [];
  const revenueSeries = [];
  const costsSeries = [];

  for (let i = monthsBack - 1; i >= 0; i--) {
    const refDate = new Date(Date.UTC(currentYear, currentMonthIndex - i, 1));
    const year = refDate.getUTCFullYear();
    const monthIndex = refDate.getUTCMonth();
    const { start, end } = getMonthRange(year, monthIndex);

    const label = `${String(monthIndex + 1).padStart(2, '0')}/${year}`;
    labels.push(label);

    // Receita (orders COMPLETED)
    const ordersAgg = await Order.aggregate([
      {
        $match: {
          status: ORDER_STATUS.COMPLETED,
          timestamp_completed: { $gte: start, $lte: end }
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$price' }
        }
      }
    ]);

    const monthlyRevenue = ordersAgg.length > 0 ? ordersAgg[0].total : 0;
    revenueSeries.push(monthlyRevenue);

    // Custos
    const costsAgg = await CompanyCost.aggregate([
      { $match: { date: { $gte: start, $lte: end } } },
      {
        $group: {
          _id: null,
          total: { $sum: '$amount' }
        }
      }
    ]);

    const monthlyCosts = costsAgg.length > 0 ? costsAgg[0].total : 0;
    costsSeries.push(monthlyCosts);
  }

  res.status(200).json({
    currentMonth: {
      label: `${String(currentMonthIndex + 1).padStart(2, '0')}/${currentYear}`,
      totalCosts,
      costsByCategory
    },
    history: {
      labels,
      revenue: revenueSeries,
      costs: costsSeries
    }
  });
});

// ✅ Exportar com os dois nomes, para ser compatível com qualquer versão de costRoutes
exports.getCostsDashboardSummary = getCostsDashboardSummary;
exports.getDashboardSummary = getCostsDashboardSummary;
