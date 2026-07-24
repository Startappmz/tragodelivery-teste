const asyncHandler = require('express-async-handler');
const Expense = require('../models/Expense');
const { isValidId } = require('../utils/id');

exports.createExpense = asyncHandler(async (req, res) => {
  const { category, description, amount, date, employee } = req.body;

  const expense = await Expense.create({
    category,
    description,
    amount,
    date: new Date(date),
    employee: employee || null,
    created_by: req.user.id
  });

  res.status(201).json({
    message: 'Custo registado com sucesso.',
    expense
  });
});

exports.getAllExpenses = asyncHandler(async (req, res) => {
  const { startDate, endDate, category } = req.query;

  const filter = {};

  if (startDate && endDate) {
    filter.date = {
      $gte: new Date(startDate),
      $lte: new Date(endDate)
    };
  }

  if (category) {
    filter.category = category;
  }

  const expenses = await Expense.find(filter)
    .populate('employee', 'nome telefone role')
    .populate('created_by', 'nome')
    .sort({ date: -1 })
    .lean();

  const totalAmount = expenses.reduce((sum, exp) => sum + exp.amount, 0);

  res.status(200).json({
    expenses,
    totalAmount,
    count: expenses.length
  });
});

exports.updateExpense = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { category, description, amount, date, employee } = req.body;

  if (!isValidId(id)) {
    res.status(404);
    throw new Error('Custo não encontrado (ID inválido).');
  }

  const expense = await Expense.findByIdAndUpdate(
    id,
    {
      category,
      description,
      amount,
      date: new Date(date),
      employee: employee || null
    },
    { new: true, runValidators: true }
  );

  if (!expense) {
    res.status(404);
    throw new Error('Custo não encontrado.');
  }

  res.status(200).json({
    message: 'Custo atualizado com sucesso.',
    expense
  });
});

exports.deleteExpense = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!isValidId(id)) {
    res.status(404);
    throw new Error('Custo não encontrado (ID inválido).');
  }

  const expense = await Expense.findByIdAndDelete(id);

  if (!expense) {
    res.status(404);
    throw new Error('Custo não encontrado.');
  }

  res.status(200).json({
    message: 'Custo apagado com sucesso.'
  });
});

exports.getExpensesSummary = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;

  const filter = {};

  if (startDate && endDate) {
    filter.date = {
      $gte: new Date(startDate),
      $lte: new Date(endDate)
    };
  }

  const summary = await Expense.aggregate([
    { $match: filter },
    {
      $group: {
        _id: '$category',
        total: { $sum: '$amount' },
        count: { $sum: 1 }
      }
    },
    { $sort: { total: -1 } }
  ]);

  const totalExpenses = summary.reduce((sum, cat) => sum + cat.total, 0);

  res.status(200).json({
    summary,
    totalExpenses
  });
});