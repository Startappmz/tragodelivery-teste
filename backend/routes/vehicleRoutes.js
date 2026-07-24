const express = require('express');
const { body, param } = require('express-validator');
const vehicleController = require('../controllers/vehicleController');
const { protect, admin } = require('../middleware/authMiddleware');
const { validateRequest } = require('../middleware/validateRequest');

const router = express.Router();

router.post(
  '/',
  protect,
  admin,
  [
    body('plate', 'A matrícula é obrigatória').trim().notEmpty(),
    body('brand').optional({ checkFalsy: true }).trim(),
    body('model').optional({ checkFalsy: true }).trim(),
    body('type').optional({ checkFalsy: true }).isIn(['mota', 'carro', 'carrinha', 'outro']).withMessage('Tipo de veículo inválido.'),
    body('status').optional({ checkFalsy: true }).isIn(['ativo', 'manutencao', 'inativo']).withMessage('Estado do veículo inválido.'),
    body('notes').optional({ checkFalsy: true }).isString().isLength({ max: 500 })
  ],
  validateRequest,
  vehicleController.createVehicle
);

router.get('/', protect, admin, vehicleController.getAllVehicles);

router.get(
  '/:id',
  protect,
  admin,
  [param('id', 'ID de veículo inválido').isMongoId()],
  validateRequest,
  vehicleController.getVehicleById
);

router.put(
  '/:id',
  protect,
  admin,
  [
    param('id', 'ID de veículo inválido').isMongoId(),
    body('plate', 'A matrícula é obrigatória').trim().notEmpty(),
    body('brand').optional({ checkFalsy: true }).trim(),
    body('model').optional({ checkFalsy: true }).trim(),
    body('type').optional({ checkFalsy: true }).isIn(['mota', 'carro', 'carrinha', 'outro']).withMessage('Tipo de veículo inválido.'),
    body('status').optional({ checkFalsy: true }).isIn(['ativo', 'manutencao', 'inativo']).withMessage('Estado do veículo inválido.'),
    body('notes').optional({ checkFalsy: true }).isString().isLength({ max: 500 })
  ],
  validateRequest,
  vehicleController.updateVehicle
);

router.delete(
  '/:id',
  protect,
  admin,
  [param('id', 'ID de veículo inválido').isMongoId()],
  validateRequest,
  vehicleController.deleteVehicle
);

module.exports = router;
