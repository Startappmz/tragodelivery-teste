const express = require('express');
const { body, param, query } = require('express-validator');
const expenseController = require('../controllers/expenseController');
const { protect, adminOrManager } = require('../middleware/authMiddleware');
const { validateRequest } = require('../middleware/validateRequest');

const router = express.Router();

router.post(
  '/',
  protect,
  adminOrManager,
  [
    body('category', 'Categoria inválida').isIn([
      'manutencao',
      'combustivel',
      'emprestimo',
      'credito',
      'taxa_trans_levant',
      'consumiveis',
      'despesas_aplicativo',
      'diversos'
    ]),
    body('description', 'Descrição é obrigatória').trim().notEmpty(),
    body('amount', 'Valor deve ser um número positivo').isFloat({ min: 0 }),
    body('date', 'Data inválida').isISO8601(),
    body('employee').optional({ checkFalsy: true }).isMongoId()
  ],
  validateRequest,
  expenseController.createExpense
);

router.get(
  '/',
  protect,
  adminOrManager,
  [
    query('startDate').optional().isISO8601(),
    query('endDate').optional().isISO8601(),
    query('category').optional().isIn([
      'manutencao',
      'combustivel',
      'emprestimo',
      'credito',
      'taxa_trans_levant',
      'consumiveis',
      'despesas_aplicativo',
      'diversos'
    ])
  ],
  validateRequest,
  expenseController.getAllExpenses
);

router.get('/summary', protect, adminOrManager, expenseController.getExpensesSummary);

router.put(
  '/:id',
  protect,
  adminOrManager,
  [
    param('id', 'ID inválido').isMongoId(),
    body('category', 'Categoria inválida').isIn([
      'manutencao',
      'combustivel',
      'emprestimo',
      'credito',
      'taxa_trans_levant',
      'consumiveis',
      'despesas_aplicativo',
      'diversos'
    ]),
    body('description', 'Descrição é obrigatória').trim().notEmpty(),
    body('amount', 'Valor deve ser um número positivo').isFloat({ min: 0 }),
    body('date', 'Data inválida').isISO8601(),
    body('employee').optional({ checkFalsy: true }).isMongoId()
  ],
  validateRequest,
  expenseController.updateExpense
);

router.delete(
  '/:id',
  protect,
  adminOrManager,
  [param('id', 'ID inválido').isMongoId()],
  validateRequest,
  expenseController.deleteExpense
);

module.exports = router;