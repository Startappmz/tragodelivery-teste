const express = require('express');
const { body } = require('express-validator');
const authController = require('../controllers/authController');
const { protect, admin, driver  } = require('../middleware/authMiddleware');
const { DRIVER_TYPES } = require('../utils/constants');
const { validateRequest } = require('../middleware/validateRequest');

const router = express.Router();

const { getMe } = require('../controllers/authController');

router.get('/me', protect, getMe);

router.post(
  '/register-driver',
  protect,
  admin,
  [
    body('nome', 'O nome é obrigatório').trim().notEmpty(),
    body('email', 'Por favor, insira um email válido').isEmail(),
    body('telefone', 'O telefone é obrigatório (mín. 9 dígitos)').trim().isLength({ min: 9 }),
    body('password', 'A senha deve ter pelo menos 6 caracteres').isLength({ min: 6 }),
    body('vehicle_plate').optional({ checkFalsy: true }).trim(),
    body('vehicleId').optional({ checkFalsy: true }).isMongoId().withMessage('ID de veículo inválido.'),
    body('driverType').optional({ checkFalsy: true }).isIn(Object.values(DRIVER_TYPES)).withMessage('Tipo de motorista inválido.'),
    body('commissionRate', 'A comissão deve ser um número entre 0 e 100')
      .optional({ checkFalsy: true })
      .isFloat({ min: 0, max: 100 })
  ],
  validateRequest,
  authController.registerDriver
);

router.post(
  '/login',
  [
    body('email', 'O email é obrigatório').isEmail(),
    body('password', 'A senha é obrigatória').notEmpty(),
    body('role', 'O tipo de utilizador (role) é obrigatório').isIn(['admin', 'driver'])
  ],
  validateRequest,
  authController.login
);


router.post(
  '/request-password-reset',
  [
    body('email', 'Por favor, insira um email válido').isEmail(),
    body('role', 'O tipo de utilizador (role) é obrigatório').isIn(['admin', 'driver'])
  ],
  validateRequest,
  authController.requestPasswordReset
);

router.post(
  '/confirm-password-reset',
  [
    body('email', 'Por favor, insira um email válido').isEmail(),
    body('role', 'O tipo de utilizador (role) é obrigatório').isIn(['admin', 'driver']),
    body('code', 'O código de restauração é obrigatório').optional().trim().notEmpty(),
    body('resetCode', 'O código de restauração é obrigatório').optional().trim().notEmpty(),
    body('newPassword', 'A nova password deve ter pelo menos 8 caracteres').isLength({ min: 8 })
  ],
  validateRequest,
  authController.confirmPasswordReset
);

router.post(
  '/reset-password',
  [
    body('email', 'Por favor, insira um email válido').isEmail(),
    body('role', 'O tipo de utilizador (role) é obrigatório').isIn(['admin', 'driver']),
    body('resetCode', 'O código de restauração é obrigatório').trim().notEmpty(),
    body('newPassword', 'A nova password deve ter pelo menos 8 caracteres').isLength({ min: 8 })
  ],
  validateRequest,
  authController.confirmPasswordReset
);

router.post('/logout', protect, authController.logout);

router.put(
  '/change-password',
  protect,
  [
    body('senhaAntiga', 'A senha antiga é obrigatória').notEmpty(),
    body('senhaNova', 'A nova senha deve ter pelo menos 6 caracteres').isLength({ min: 6 })
  ],
  validateRequest,
  authController.changePassword
);

module.exports = router;