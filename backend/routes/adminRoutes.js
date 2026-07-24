// Ficheiro: backend/routes/adminRoutes.js (NOVO)

const express = require('express');
const router = express.Router();
// (MUDANÇA) Certifique-se que o nome do controller está correto
const adminController = require('../controllers/adminController');
const { protect, admin } = require('../middleware/authMiddleware');

// @route   DELETE /api/admin/orders/history
// @desc    Admin apaga o histórico de encomendas (mais antigo que 30 dias)
// @access  Privado (Admin)
// (Nota: o 'protect' e 'admin' são aplicados no server.js)
router.delete('/orders/history', adminController.deleteOldHistory);

module.exports = router;