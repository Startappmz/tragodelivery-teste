const express = require('express');
const { param } = require('express-validator');
const notificationController = require('../controllers/notificationController');
const { protect, admin } = require('../middleware/authMiddleware');
const { validateRequest } = require('../middleware/validateRequest');

const router = express.Router();

router.get('/', protect, admin, notificationController.listNotifications);
router.post('/mark-all-read', protect, admin, notificationController.markAllNotificationsRead);
router.post('/:id/read', protect, admin, [param('id', 'ID de notificação inválido').isMongoId()], validateRequest, notificationController.markNotificationRead);

module.exports = router;
