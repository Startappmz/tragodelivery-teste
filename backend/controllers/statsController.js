const asyncHandler = require('express-async-handler');
const Order = require('../models/Order');
const DriverProfile = require('../models/DriverProfile');
const {
  ORDER_STATUS,
  DRIVER_STATUS,
  SERVICE_TYPE_LABELS
} = require('../utils/constants');

function getDayRange(date = new Date()) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function getWeekRange(date = new Date()) {
  const current = new Date(date);
  const day = current.getDay(); // domingo=0
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const start = new Date(current);
  start.setDate(current.getDate() + diffToMonday);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function getMonthRange(date = new Date()) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function resolveFinancialPeriod(period) {
  const normalized = ['day', 'week', 'month'].includes(period) ? period : 'month';
  const now = new Date();
  const ranges = {
    day: getDayRange(now),
    week: getWeekRange(now),
    month: getMonthRange(now)
  };
  const labels = {
    day: 'Hoje',
    week: 'Esta semana',
    month: 'Este mês'
  };

  return { key: normalized, label: labels[normalized], ...ranges[normalized] };
}

exports.getOverviewStats = asyncHandler(async (_req, res) => {
  const { start, end } = getDayRange(new Date());

  const transitStatuses = [
    ORDER_STATUS.ASSIGNED,
    ORDER_STATUS.IN_PROGRESS,
    ORDER_STATUS.PICKUP_IN_PROGRESS,
    ORDER_STATUS.PICKUP_DONE,
    ORDER_STATUS.DELIVERY_IN_PROGRESS
  ];

  const onlineDriverStatuses = [
    DRIVER_STATUS.ONLINE_FREE,
    DRIVER_STATUS.ONLINE_BUSY,
    DRIVER_STATUS.PICKUP,
    DRIVER_STATUS.DELIVERY
  ];

  const [pendentes, emTransito, concluidasHoje, motoristasOnline] = await Promise.all([
    Order.countDocuments({ status: ORDER_STATUS.PENDING }),
    Order.countDocuments({ status: { $in: transitStatuses } }),
    Order.countDocuments({
      status: ORDER_STATUS.COMPLETED,
      timestamp_completed: { $gte: start, $lte: end }
    }),
    DriverProfile.countDocuments({
      status: { $in: onlineDriverStatuses }
    })
  ]);

  res.status(200).json({
    pendentes,
    emTransito,
    concluidasHoje,
    motoristasOnline
  });
});

exports.getServicePerformanceStats = asyncHandler(async (_req, res) => {
  const stats = await Order.aggregate([
    { $match: { status: ORDER_STATUS.COMPLETED } },
    {
      $group: {
        _id: '$service_type',
        totalValue: { $sum: { $ifNull: ['$price', 0] } },
        totalOrders: { $sum: 1 }
      }
    }
  ]);

  const statsByService = stats.reduce((acc, item) => {
    if (item && item._id) {
      acc[item._id] = {
        totalValue: Number(item.totalValue || 0),
        totalOrders: Number(item.totalOrders || 0)
      };
    }
    return acc;
  }, {});

  const keys = Object.keys(SERVICE_TYPE_LABELS);

  res.status(200).json({
    labels: keys.map((key) => SERVICE_TYPE_LABELS[key]),
    dataValues: keys.map((key) => statsByService[key]?.totalValue || 0),
    adesaoValues: keys.map((key) => statsByService[key]?.totalOrders || 0)
  });
});

exports.getFinancialStats = asyncHandler(async (req, res) => {
  const period = resolveFinancialPeriod(req.query.period);

  const query = {
    status: ORDER_STATUS.COMPLETED,
    timestamp_completed: { $gte: period.start, $lte: period.end }
  };

  const [financialStats] = await Order.aggregate([
    { $match: query },
    {
      $group: {
        _id: null,
        totalReceita: { $sum: '$price' },
        totalGanhosMotorista: { $sum: '$valor_motorista' },
        totalLucroEmpresa: { $sum: '$valor_empresa' },
        totalEntregas: { $sum: 1 }
      }
    }
  ]);

  const [topDriver] = await Order.aggregate([
    { $match: query },
    {
      $group: {
        _id: '$assigned_to_driver',
        totalGanhos: { $sum: '$valor_motorista' },
        totalEntregas: { $sum: 1 }
      }
    },
    { $sort: { totalGanhos: -1 } },
    { $limit: 1 },
    {
      $lookup: {
        from: 'driverprofiles',
        localField: '_id',
        foreignField: '_id',
        as: 'profile'
      }
    },
    { $unwind: '$profile' },
    {
      $lookup: {
        from: 'users',
        localField: 'profile.user',
        foreignField: '_id',
        as: 'user'
      }
    },
    { $unwind: '$user' },
    {
      $project: {
        _id: 0,
        nome: '$user.nome',
        totalGanhos: '$totalGanhos',
        totalEntregas: '$totalEntregas'
      }
    }
  ]);

  res.status(200).json({
    period: {
      key: period.key,
      label: period.label,
      start: period.start,
      end: period.end
    },
    totalReceita: financialStats?.totalReceita || 0,
    totalGanhosMotorista: financialStats?.totalGanhosMotorista || 0,
    totalLucroEmpresa: financialStats?.totalLucroEmpresa || 0,
    totalEntregas: financialStats?.totalEntregas || 0,
    topDriver: topDriver || { nome: 'N/A', totalGanhos: 0, totalEntregas: 0 }
  });
});
