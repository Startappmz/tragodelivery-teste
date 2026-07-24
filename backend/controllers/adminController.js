const asyncHandler = require('express-async-handler');
const Order = require('../models/Order');
const { ORDER_STATUS } = require('../utils/constants');

exports.deleteOldHistory = asyncHandler(async (_req, res) => {
  const cutoffDate = new Date();
  cutoffDate.setUTCDate(cutoffDate.getUTCDate() - 30);

  const result = await Order.deleteMany({
    status: { $in: [ORDER_STATUS.COMPLETED, ORDER_STATUS.CANCELED] },
    timestamp_completed: { $lt: cutoffDate }
  });

  if (!result.deletedCount) {
    return res.status(200).json({
      message: 'Nenhuma encomenda antiga encontrada para apagar.'
    });
  }

  return res.status(200).json({
    message: `${result.deletedCount} encomendas antigas foram apagadas com sucesso.`
  });
});