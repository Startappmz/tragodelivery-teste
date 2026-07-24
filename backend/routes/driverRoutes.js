// backend/routes/driverRoutes.js

const express = require('express');
const { body, param } = require('express-validator');
const driverController = require('../controllers/driverController');
const { protect, admin, driver } = require('../middleware/authMiddleware');
const { validateRequest } = require('../middleware/validateRequest');
const { DRIVER_STATUS, DRIVER_TYPES } = require('../utils/constants');

const router = express.Router();

/**
 * GET /api/drivers
 * Lista todos os motoristas (ecrã de gestão) – ADMIN
 */
router.get('/', protect, admin, driverController.getAllDrivers);

/**
 * GET /api/drivers/available
 * Motoristas DISPONÍVEIS (online_livre) para atribuir encomendas – ADMIN
 * Usado no modal "Atribuir motorista"
 */
router.get(
  '/available',
  protect,
  admin,
  driverController.getAllDriversForAvailability
);

/**
 * GET /api/drivers/my-earnings
 * Ganhos do motorista autenticado – DRIVER
 * Usado no painel do motorista (driver.js → loadMyEarnings)
 */
router.get(
  '/my-earnings',
  protect,
  driver,
  driverController.getMyEarnings
);

/**
 * GET/PUT /api/drivers/me/profile
 * Perfil privado do motorista e dados públicos da viatura.
 */
router.get('/me/profile', protect, driver, driverController.getMyProfile);

router.put(
  '/me/profile',
  protect,
  driver,
  [
    body('name').trim().isLength({ min: 2, max: 100 }).withMessage('Indique o nome completo.'),
    body('phone').trim().isLength({ min: 7, max: 30 }).withMessage('Indique um contacto válido.'),
    body('email').optional({ checkFalsy: true }).isEmail().normalizeEmail().withMessage('Email inválido.'),
    body('bio').optional().trim().isLength({ max: 180 }),
    body('vehicle_type').isIn(['mota', 'carro', 'carrinha', 'outro']).withMessage('Tipo de viatura inválido.'),
    body('vehicle_plate').trim().isLength({ min: 2, max: 20 }).withMessage('Indique a matrícula.'),
    body('vehicle_brand').optional().trim().isLength({ max: 40 }),
    body('vehicle_model').optional().trim().isLength({ max: 40 }),
    body('vehicle_color').optional().trim().isLength({ max: 30 }),
    body('vehicle_year').optional({ checkFalsy: true }).isInt({ min: 1990, max: 2035 }),
    body('license_number').optional().trim().isLength({ max: 40 }),
    body('license_expiry').optional({ checkFalsy: true }).isISO8601().withMessage('Validade da carta inválida.'),
    body('license_category').optional().isIn(['A', 'B', 'C']),
    body('emergency_name').optional().trim().isLength({ max: 80 }),
    body('emergency_phone').optional().trim().isLength({ max: 30 }),
    body('avatar_url').optional().isString().isLength({ max: 950000 }),
    body('vehicle_photo_url').optional().isString().isLength({ max: 950000 }),
    body('license_photo_url').optional().isString().isLength({ max: 950000 })
  ],
  validateRequest,
  driverController.updateMyProfile
);


/**
 * GET /api/drivers/live-locations
 * Localizações dos motoristas online para fallback do mapa em tempo real – ADMIN
 */
router.get(
  '/live-locations',
  protect,
  admin,
  driverController.getLiveDriverLocations
);

/**
 * GET /api/drivers/:id/report
 * Relatório de entregas concluídas de um motorista – ADMIN
 * Usado no modal "Relatório do Motorista"
 */
router.get(
  '/:id/report',
  protect,
  admin,
  [param('id', 'ID de motorista inválido').isMongoId()],
  validateRequest,
  driverController.getDriverReport
);

/**
 * GET /api/drivers/:id
 * Detalhes de um motorista – ADMIN
 * Usado no modal de edição de motorista
 */
router.get(
  '/:id',
  protect,
  admin,
  [param('id', 'ID de motorista inválido').isMongoId()],
  validateRequest,
  driverController.getDriverById
);

/**
 * PUT /api/drivers/:id
 * Atualizar motorista (nome, telefone, matrícula, status, comissão) – ADMIN
 * Usado no formulário "Editar motorista"
 */
router.put(
  '/:id',
  protect,
  admin,
  [
    param('id', 'ID de motorista inválido').isMongoId(),
    body('nome')
      .trim()
      .notEmpty()
      .withMessage('Nome é obrigatório.'),
    body('telefone')
      .trim()
      .notEmpty()
      .withMessage('Telefone é obrigatório.'),
    body('vehicle_plate')
      .optional({ checkFalsy: true })
      .trim(),
    body('vehicleId')
      .optional({ checkFalsy: true })
      .isMongoId()
      .withMessage('ID de veículo inválido.'),
    body('driverType')
      .optional({ checkFalsy: true })
      .isIn(Object.values(DRIVER_TYPES))
      .withMessage('Tipo de motorista inválido.'),
    body('status')
      .optional({ checkFalsy: true })
      .isIn(Object.values(DRIVER_STATUS))
      .withMessage('Status inválido.'),
    body('commissionRate')
      .optional({ checkFalsy: true })
      .isFloat({ min: 0, max: 100 })
      .withMessage('Comissão deve estar entre 0 e 100.')
  ],
  validateRequest,
  driverController.updateDriver
);

module.exports = router;
