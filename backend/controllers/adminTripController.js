const Trip = require('../models/Trip');
const DriverProfile = require('../models/DriverProfile');

/**
 * Lista todas as viagens (coletas, entregas, retornos, pausas) de um motorista
 * GET /api/admin/drivers/:driverId/trips
 */
exports.getDriverTripsHistory = async (req, res) => {
  try {
    const { driverId } = req.params;
    const { startDate, endDate } = req.query;

    // Buscar o DriverProfile pelo ID
    const driverProfile = await DriverProfile.findById(driverId);
    if (!driverProfile) {
      return res.status(404).json({ message: 'Motorista não encontrado' });
    }

    const filter = { driver: driverProfile._id };

    // Filtro opcional por data de início/fim (usando createdAt da Trip)
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) {
        filter.createdAt.$gte = new Date(startDate);
      }
      if (endDate) {
        filter.createdAt.$lte = new Date(endDate);
      }
    }

    const trips = await Trip.find(filter)
      .populate({
        path: 'driver',
        populate: { path: 'user', select: 'nome telefone email' }
      })
      .populate({
        path: 'order',
        // ✅ CAMPOS QUE EXISTEM MESMO NO Order.js
        select:
          'client_name client_phone1 client_phone2 service_type price address_text address_coords image_url status'
      })
      .sort({ createdAt: -1 })
      .lean();

    res.json({ trips });
  } catch (error) {
    console.error('Erro ao listar histórico de viagens do motorista:', error);
    res.status(500).json({ message: 'Erro ao listar histórico de viagens do motorista' });
  }
};

/**
 * Detalhes de uma viagem específica
 * GET /api/admin/trips/:tripId
 */
exports.getTripDetails = async (req, res) => {
  try {
    const { tripId } = req.params;

    const trip = await Trip.findById(tripId)
      .populate({
        path: 'driver',
        populate: { path: 'user', select: 'nome telefone email' }
      })
      .populate({
        path: 'order',
        // ✅ Mesma correção aqui
        select:
          'client_name client_phone1 client_phone2 service_type price address_text address_coords image_url status'
      });

    if (!trip) {
      return res.status(404).json({ message: 'Viagem não encontrada' });
    }

    res.json({ trip });
  } catch (error) {
    console.error('Erro ao buscar detalhes da viagem:', error);
    res.status(500).json({ message: 'Erro ao buscar detalhes da viagem' });
  }
};
