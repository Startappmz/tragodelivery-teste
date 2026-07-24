const express = require('express');
const { body, param } = require('express-validator');
const clientController = require('../controllers/clientController');
const { protect, admin } = require('../middleware/authMiddleware');
const { validateRequest } = require('../middleware/validateRequest');
const { CLIENT_BILLING_TYPES } = require('../utils/constants');

const router = express.Router();

const clientValidators = [
  body('nome', 'O nome do cliente é obrigatório').trim().notEmpty(),
  body('telefone', 'O telefone é obrigatório (mín. 9 dígitos)').trim().isLength({ min: 9 }),
  body('email', 'Por favor, insira um email válido').optional({ checkFalsy: true }).isEmail(),
  body('empresa').optional({ checkFalsy: true }).trim(),
  body('nuit').optional({ checkFalsy: true }).trim(),
  body('endereco').optional({ checkFalsy: true }).trim(),
  body('billing_type').optional({ checkFalsy: true }).isIn(Object.values(CLIENT_BILLING_TYPES)).withMessage('Tipo de faturação inválido.'),
  body('credit_limit').optional({ checkFalsy: true }).isFloat({ min: 0 }).withMessage('Crédito atribuído inválido.'),
  body('credit_balance').optional({ checkFalsy: true }).isFloat({ min: 0 }).withMessage('Crédito disponível inválido.'),
  body('credit_used').optional({ checkFalsy: true }).isFloat({ min: 0 }).withMessage('Crédito usado inválido.')
];

router.post('/', protect, admin, clientValidators, validateRequest, clientController.createClient);

router.get('/', protect, admin, clientController.getAllClients);

router.get(
  '/:id',
  protect,
  admin,
  [param('id', 'ID de cliente inválido').isMongoId()],
  validateRequest,
  clientController.getClientById
);

router.put(
  '/:id',
  protect,
  admin,
  [param('id', 'ID de cliente inválido').isMongoId(), ...clientValidators],
  validateRequest,
  clientController.updateClient
);

router.delete(
  '/:id',
  protect,
  admin,
  [param('id', 'ID de cliente inválido').isMongoId()],
  validateRequest,
  clientController.deleteClient
);

router.get(
  '/:id/statement',
  protect,
  admin,
  [param('id', 'ID de cliente inválido').isMongoId()],
  validateRequest,
  clientController.getStatement
);

module.exports = router;
