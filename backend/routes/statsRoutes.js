// Ficheiro: backend/routes/statsRoutes.js (Atualizado)

const express = require('express');
const router = express.Router();
const statsController = require('../controllers/statsController');
const { protect, admin } = require('../middleware/authMiddleware');

// @route   GET /api/stats/overview
// @desc    Admin obtém as estatísticas para a visão geral
router.get('/overview', protect, admin, statsController.getOverviewStats);

// @route   GET /api/stats/services
// @desc    Admin obtém dados para o gráfico de desempenho
router.get('/services', protect, admin, statsController.getServicePerformanceStats);

// --- (NOVA MELHORIA) ---
// @route   GET /api/stats/financials
// @desc    Admin obtém os dados financeiros (Receita, Lucro, Ganhos Motorista)
// @access  Privado (Admin)
router.get('/financials', protect, admin, statsController.getFinancialStats);
// --- FIM DA MELHORIA ---

module.exports = router;