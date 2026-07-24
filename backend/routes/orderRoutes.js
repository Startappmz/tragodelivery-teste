const express = require('express');
const multer = require('multer');
const path = require('node:path');
const { body, param } = require('express-validator');
const orderController = require('../controllers/orderController');
const communicationController = require('../controllers/orderCommunicationController');
const { protect, admin, driver } = require('../middleware/authMiddleware');
const { validateRequest } = require('../middleware/validateRequest');
const { PAYMENT_METHODS, MESSAGE_CHANNEL } = require('../utils/constants');

const router = express.Router();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, 'uploads/'),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});

const fileFilter = (_req, file, cb) => {
  const allowedMime = ['image/jpeg', 'image/png', 'image/gif'];
  if (allowedMime.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Formato de imagem não suportado'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: parseInt(process.env.UPLOAD_IMAGE_MAX_SIZE || `${5 * 1024 * 1024}`, 10) }
});

// -----------------------------------------------------------------------------
// CRIAÇÃO
// -----------------------------------------------------------------------------

router.post(
  '/',
  protect,
  admin,
  upload.any(),
  [
    body('service_type', 'O tipo de serviço é obrigatório').trim().notEmpty(),
    body('client_name', 'O nome do cliente é obrigatório').trim().notEmpty(),
    body('client_phone1', 'O telefone principal é obrigatório').trim().isLength({ min: 9 }),
    body('price', 'O preço é obrigatório e deve ser um número').isFloat({ min: 0 }),
    body('service_price').optional({ checkFalsy: true }).isFloat({ min: 0 }),
    body('delivery_fee').optional({ checkFalsy: true }).isFloat({ min: 0 }),
    body('route_distance_km').optional({ checkFalsy: true }).isFloat({ min: 0 }),
    body('route_duration_min').optional({ checkFalsy: true }).isFloat({ min: 0 }),
    body('pickup_address_text').optional({ checkFalsy: true }).trim(),
    body('pickup_contact_name').optional({ checkFalsy: true }).trim().isLength({ max: 120 }),
    body('pickup_contact_phone').optional({ checkFalsy: true }).trim().isLength({ max: 40 }),
    body('pickup_notes').optional({ checkFalsy: true }).trim().isLength({ max: 1000 }),
    body('client_notes').optional({ checkFalsy: true }).trim().isLength({ max: 1000 }),
    body('pickup_lat').optional({ checkFalsy: true }).isFloat(),
    body('pickup_lng').optional({ checkFalsy: true }).isFloat(),
    body('lat').optional({ checkFalsy: true }).isFloat(),
    body('lng').optional({ checkFalsy: true }).isFloat(),
    body('clientId').optional({ checkFalsy: true }).isMongoId(),
    body('autoAssign').optional({ checkFalsy: true }).isBoolean().toBoolean(),
    body('payment_method')
      .optional({ checkFalsy: true })
      .trim()
      .isIn(Object.values(PAYMENT_METHODS))
      .withMessage('Método de pagamento inválido.')
  ],
  validateRequest,
  orderController.createOrder
);

// -----------------------------------------------------------------------------
// ROTAS DO MOTORISTA
// -----------------------------------------------------------------------------

// lista das minhas entregas activas
router.get('/my-deliveries', protect, driver, orderController.getMyDeliveries);

router.post(
  '/:id/offer-response',
  protect,
  driver,
  [
    param('id', 'ID da encomenda inválido').isMongoId(),
    body('accept', 'Indique se aceita ou recusa o pedido.').isBoolean()
  ],
  validateRequest,
  orderController.respondToDriverOffer
);

router.get('/:id/messages', protect, [param('id', 'ID da encomenda inválido').isMongoId()], validateRequest, communicationController.listAuthenticatedMessages);
router.post(
  '/:id/messages',
  protect,
  [
    param('id', 'ID da encomenda inválido').isMongoId(),
    body('message').trim().isLength({ min: 1, max: 2000 }),
    body('channel')
      .optional({ checkFalsy: true })
      .isIn([MESSAGE_CHANNEL.CLIENT_DRIVER, MESSAGE_CHANNEL.DRIVER_PARTNER, MESSAGE_CHANNEL.SYSTEM])
      .withMessage('Canal de conversa inválido.')
  ],
  validateRequest,
  communicationController.createAuthenticatedMessage
);


// Pendências de pagamento: admin vê todas; motorista vê apenas as suas.
router.get('/payment-pending', protect, orderController.getPaymentPendingOrders);

router.post(
  '/:id/payment-preview',
  protect,
  driver,
  [
    param('id', 'ID da encomenda inválido').isMongoId(),
    body('verification_code', 'O código de verificação é obrigatório e deve ter 5 caracteres')
      .trim()
      .isLength({ min: 5, max: 5 })
  ],
  validateRequest,
  orderController.previewDeliveryPayment
);


// NOVO: iniciar RECOLHA (motorista sai da central)
// Compatível com a lógica nova de fases
router.post(
  '/:id/pickup-start',
  protect,
  driver,
  [param('id', 'ID da encomenda inválido').isMongoId()],
  validateRequest,
  orderController.startPickup
);

// NOVO: concluir RECOLHA (motorista chegou ao ponto de recolha)
router.post(
  '/:id/pickup-complete',
  protect,
  driver,
  [param('id', 'ID da encomenda inválido').isMongoId()],
  validateRequest,
  orderController.completePickup
);

// NOVO: iniciar ENTREGA (motorista sai do ponto de recolha para o destino)
router.post(
  '/:id/delivery-start',
  protect,
  driver,
  [param('id', 'ID da encomenda inválido').isMongoId()],
  validateRequest,
  orderController.startDeliveryPhase
);

// NOVO: concluir ENTREGA (equivalente moderno ao /:id/complete)
router.post(
  '/:id/delivery-complete',
  protect,
  driver,
  [
    param('id', 'ID da encomenda inválido').isMongoId(),
    body('verification_code', 'O código de verificação é obrigatório e deve ter 5 caracteres')
      .trim()
      .isLength({ min: 5, max: 5 }),
    body('payment_amount_confirmed').optional({ checkFalsy: true }).isFloat({ min: 0 }),
    body('driver_delivery_notes').optional({ checkFalsy: true }).trim().isLength({ max: 1000 })
  ],
  validateRequest,
  orderController.completeDelivery
);

// COMPATIBILIDADE: rotas antigas (mantidas)
// /:id/start -> agora inicia a RECOLHA (usa startPickup internamente)
router.post(
  '/:id/start',
  protect,
  driver,
  [param('id', 'ID da encomenda inválido').isMongoId()],
  validateRequest,
  orderController.startDelivery // alias para startPickup
);

// /:id/complete -> agora conclui a ENTREGA (usa completeDelivery internamente)
router.post(
  '/:id/complete',
  protect,
  driver,
  [
    param('id', 'ID da encomenda inválido').isMongoId(),
    body('verification_code', 'O código de verificação é obrigatório e deve ter 5 caracteres')
      .trim()
      .isLength({ min: 5, max: 5 }),
    body('payment_amount_confirmed').optional({ checkFalsy: true }).isFloat({ min: 0 }),
    body('driver_delivery_notes').optional({ checkFalsy: true }).trim().isLength({ max: 1000 })
  ],
  validateRequest,
  orderController.completeDelivery
);

// -----------------------------------------------------------------------------
// ADMIN – ATRIBUIR E CANCELAR
// -----------------------------------------------------------------------------

router.put(
  '/:orderId/assign',
  protect,
  admin,
  [
    param('orderId', 'ID da encomenda inválido').isMongoId(),
    body('driverId', 'ID do motorista é obrigatório e inválido').notEmpty().isMongoId()
  ],
  validateRequest,
  orderController.assignOrder
);

// NOVO: cancelar encomenda (ADMIN)
router.post(
  '/:id/cancel',
  protect,
  admin,
  [
    param('id', 'ID da encomenda inválido').isMongoId(),
    body('reason')
      .optional({ checkFalsy: true })
      .isString()
      .isLength({ max: 500 })
      .withMessage('Motivo demasiado longo (máx. 500 caracteres).')
  ],
  validateRequest,
  orderController.cancelOrder
);

// -----------------------------------------------------------------------------
// LISTAGENS PARA ADMIN
// -----------------------------------------------------------------------------

router.get('/active', protect, admin, orderController.getActiveOrders);
router.get('/history', protect, admin, orderController.getHistoryOrders);
router.get('/', protect, admin, orderController.getAllOrders);

router.get(
  '/:id',
  protect,
  admin,
  [param('id', 'ID da encomenda inválido').isMongoId()],
  validateRequest,
  orderController.getOrderById
);

module.exports = router;
