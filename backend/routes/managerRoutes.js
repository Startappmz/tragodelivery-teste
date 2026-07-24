const express = require('express');
const { body, param } = require('express-validator');
const managerController = require('../controllers/managerController');
const { protect, admin } = require('../middleware/authMiddleware');
const { validateRequest } = require('../middleware/validateRequest');

const router = express.Router();

router.post(
  '/',
  protect,
  admin,
  [
    body('nome', 'Nome é obrigatório').trim().notEmpty(),
    body('email', 'Email inválido').isEmail().normalizeEmail(),
    body('telefone', 'Telefone é obrigatório (mín. 9 dígitos)').trim().isLength({ min: 9 }),
    body('password', 'Senha deve ter no mínimo 6 caracteres').isLength({ min: 6 })
  ],
  validateRequest,
  managerController.createManager
);

router.get('/', protect, admin, managerController.getAllManagers);

router.get(
  '/:id',
  protect,
  admin,
  [param('id', 'ID inválido').isMongoId()],
  validateRequest,
  managerController.getManagerById
);

router.put(
  '/:id',
  protect,
  admin,
  [
    param('id', 'ID inválido').isMongoId(),
    body('nome', 'Nome é obrigatório').trim().notEmpty(),
    body('telefone', 'Telefone é obrigatório (mín. 9 dígitos)').trim().isLength({ min: 9 }),
    body('email', 'Email inválido').isEmail().normalizeEmail()
  ],
  validateRequest,
  managerController.updateManager
);

router.delete(
  '/:id',
  protect,
  admin,
  [param('id', 'ID inválido').isMongoId()],
  validateRequest,
  managerController.deleteManager
);

module.exports = router;