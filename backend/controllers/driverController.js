// backend/controllers/driverController.js

const asyncHandler = require('express-async-handler');
const { isValidId } = require('../utils/id');

// IMPORTS CORRETOS (estamos dentro da pasta controllers)
const User = require('../models/User');
const DriverProfile = require('../models/DriverProfile');
const Order = require('../models/Order');
const { DRIVER_STATUS, ORDER_STATUS, FINANCIAL, DRIVER_TYPES } = require('../utils/constants');
const { parseCommissionRate } = require('../utils/helpers');
const {
  expireDriverOffers,
  getFreshAvailablePresences,
  getFreshOnlinePresences
} = require('../utils/driverPresence');

const cleanText = (value, maxLength = 180) => String(value ?? '').trim().slice(0, maxLength);

const cleanProfileImage = (value) => {
  const image = String(value || '').trim();
  if (!image) return '';
  const isRemoteImage = /^https:\/\/[\w.-]+(?:[/:?#]|$)/i.test(image);
  const isDataImage = /^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(image);
  if ((!isRemoteImage && !isDataImage) || image.length > 950000) {
    const error = new Error('Uma das fotografias é inválida ou demasiado grande.');
    error.statusCode = 400;
    throw error;
  }
  return image;
};

const driverProfilePayload = (user, profile, totalDeliveries = 0) => ({
  id: user?._id || user?.id,
  name: user?.nome || '',
  phone: user?.telefone || '',
  email: user?.email || '',
  profile: {
    bio: profile?.bio || '',
    avatar_url: profile?.avatar_url || '',
    vehicle_photo_url: profile?.vehicle_photo_url || '',
    license_photo_url: profile?.license_photo_url || '',
    vehicle_type: profile?.vehicle_type || profile?.vehicle?.type || 'mota',
    vehicle_plate: profile?.vehicle_plate || profile?.vehicle?.plate || '',
    vehicle_brand: profile?.vehicle_brand || profile?.vehicle?.brand || '',
    vehicle_model: profile?.vehicle_model || profile?.vehicle?.model || '',
    vehicle_color: profile?.vehicle_color || '',
    vehicle_year: profile?.vehicle_year || '',
    license_number: profile?.license_number || '',
    license_expiry: profile?.license_expiry || '',
    license_category: profile?.license_category || 'A',
    emergency_name: profile?.emergency_name || '',
    emergency_phone: profile?.emergency_phone || '',
    rating: Number(profile?.rating || 4.9),
    verified: profile?.verified === true,
    total_deliveries: Number(totalDeliveries || 0),
    status: profile?.status || DRIVER_STATUS.OFFLINE
  }
});

const publicDriverPayload = (user, profile) => ({
  id: profile?._id || profile?.id,
  name: user?.nome || 'Motorista TraGo',
  phone: user?.telefone || '',
  avatar_url: profile?.avatar_url || '',
  rating: Number(profile?.rating || 4.9),
  verified: profile?.verified === true,
  vehicle: {
    type: profile?.vehicle_type || profile?.vehicle?.type || 'mota',
    plate: profile?.vehicle_plate || profile?.vehicle?.plate || '',
    brand: profile?.vehicle_brand || profile?.vehicle?.brand || '',
    model: profile?.vehicle_model || profile?.vehicle?.model || '',
    color: profile?.vehicle_color || '',
    photo_url: profile?.vehicle_photo_url || ''
  }
});


const getPeriodRange = (periodRaw) => {
  const key = ['day', 'week', 'month'].includes(String(periodRaw || '')) ? String(periodRaw) : 'month';
  const start = new Date();
  const end = new Date();
  end.setHours(23, 59, 59, 999);

  if (key === 'day') {
    start.setHours(0, 0, 0, 0);
  } else if (key === 'week') {
    const day = start.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    start.setDate(start.getDate() + mondayOffset);
    start.setHours(0, 0, 0, 0);
  } else {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
  }

  const label = key === 'day' ? 'Hoje' : key === 'week' ? 'Esta Semana' : 'Este Mês';
  return { key, label, start, end };
};

exports.getAllDrivers = asyncHandler(async (_req, res) => {
  const drivers = await User.find({ role: 'driver' })
    .populate('profile')
    .sort({ nome: 1 })
    .lean();

  res.status(200).json({ drivers });
});

exports.getDriverById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!isValidId(id)) {
    res.status(404);
    throw new Error('Motorista não encontrado (ID inválido).');
  }

  const driver = await User.findById(id).populate('profile');

  if (!driver || driver.role !== 'driver') {
    res.status(404);
    throw new Error('Motorista não encontrado.');
  }

  res.status(200).json({ driver });
});

exports.updateDriver = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const data = req.filtered || req.body;
  const { nome, telefone, vehicle_plate, vehicleId, status, driverType, commissionRate } = data;

  const user = await User.findById(id);
  if (!user || user.role !== 'driver') {
    res.status(404);
    throw new Error('Motorista não encontrado.');
  }

  user.nome = nome;
  user.telefone = telefone;
  await user.save();

  const normalizedDriverType = Object.values(DRIVER_TYPES).includes(driverType)
    ? driverType
    : DRIVER_TYPES.FREELANCER;

  const parsedCommission = normalizedDriverType === DRIVER_TYPES.OFFICIAL
    ? 0
    : parseCommissionRate(commissionRate, FINANCIAL.DEFAULT_COMMISSION_RATE);

  const profile = await DriverProfile.findOneAndUpdate(
    { user: id },
    {
      vehicle_plate,
      vehicle: vehicleId || null,
      status,
      driverType: normalizedDriverType,
      commissionRate: parsedCommission
    },
    { new: true, upsert: true }
  );

  res.status(200).json({
    message: 'Motorista atualizado com sucesso.',
    user,
    profile
  });
});

/**
 * Lista de motoristas *disponíveis* para atribuição de encomenda.
 * Usado pelo front em: GET /api/drivers/available
 *
 * Retorna no formato:
 *   { drivers: [ { _id, nome, telefone, profile: { _id, vehicle_plate, status, commissionRate } } ] }
 */
exports.getAllDriversForAvailability = asyncHandler(async (_req, res) => {
  await expireDriverOffers();
  const presences = await getFreshAvailablePresences(60000);
  const drivers = [];
  for (const presence of presences || []) {
    const profile = await DriverProfile.findById(presence.driver_profile_id)
      .populate('user')
      .populate('vehicle')
      .lean();
    if (
      !profile?.user
      || profile.user.role !== 'driver'
      || profile.account_status === 'inactive'
      || profile.approval_status === 'rejected'
    ) continue;
    drivers.push({
      _id: profile.user._id,
      nome: profile.user.nome,
      telefone: profile.user.telefone,
      profile: {
        _id: profile._id,
        vehicle_plate: profile.vehicle_plate,
        status: DRIVER_STATUS.ONLINE_FREE,
        commissionRate: profile.commissionRate,
        driverType: profile.driverType || DRIVER_TYPES.FREELANCER,
        vehicle: profile.vehicle || null,
        presence: {
          lat: Number(presence.latitude),
          lng: Number(presence.longitude),
          updatedAt: presence.location_updated_at,
          lastSeenAt: presence.last_seen_at
        },
        public: publicDriverPayload(profile.user, profile)
      }
    });
  }
  drivers.sort((a, b) => a.nome.localeCompare(b.nome));

  return res.status(200).json({ drivers });
});


exports.getLiveDriverLocations = asyncHandler(async (_req, res) => {
  const presences = await getFreshOnlinePresences(60000);
  const drivers = [];
  for (const presence of presences || []) {
    const profile = await DriverProfile.findById(presence.driver_profile_id)
      .populate('user', 'nome telefone role')
      .lean();
    if (!profile?.user || profile.user.role !== 'driver') continue;
    drivers.push({
      driverId: profile._id,
      driverUserId: profile.user._id,
      driverName: profile.user.nome,
      telefone: profile.user.telefone,
      status: profile.status,
      available: presence.is_available === true,
      lat: Number(presence.latitude),
      lng: Number(presence.longitude),
      accuracy: presence.accuracy,
      speed: presence.speed,
      updatedAt: presence.location_updated_at,
      lastSeenAt: presence.last_seen_at
    });
  }

  res.status(200).json({ drivers });
});

exports.getDriverReport = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!isValidId(id)) {
    res.status(404);
    throw new Error('Motorista não encontrado (ID inválido).');
  }

  const profile = await DriverProfile.findOne({ user: id });
  if (!profile) {
    res.status(404);
    throw new Error('Perfil de motorista não encontrado.');
  }
  const orders = await Order.find({
    assigned_to_driver: profile._id,
    status: ORDER_STATUS.COMPLETED
  })
    .sort({ timestamp_completed: -1 })
    .lean();

  res.status(200).json({
    totalOrders: orders.length,
    orders
  });
});

exports.getMyProfile = asyncHandler(async (req, res) => {
  const profile = await DriverProfile.findOne({ user: req.user.id }).populate('vehicle');
  if (!profile) {
    res.status(404);
    throw new Error('Perfil de motorista não encontrado.');
  }

  const completedOrders = await Order.find({
    assigned_to_driver: profile._id,
    status: ORDER_STATUS.COMPLETED
  }).lean();

  res.status(200).json({
    driver: driverProfilePayload(req.user, profile, completedOrders.length)
  });
});

exports.updateMyProfile = asyncHandler(async (req, res) => {
  const data = req.filtered || req.body || {};
  const user = await User.findById(req.user.id);
  if (!user || user.role !== 'driver') {
    res.status(404);
    throw new Error('Motorista não encontrado.');
  }

  user.nome = cleanText(data.name || data.nome || user.nome, 100);
  user.telefone = cleanText(data.phone || data.telefone || user.telefone, 30);
  if (data.email) user.email = cleanText(data.email, 160).toLowerCase();
  await user.save();

  const existing = await DriverProfile.findOne({ user: req.user.id });
  const profileData = {
    bio: cleanText(data.bio, 180),
    avatar_url: cleanProfileImage(data.avatar_url),
    vehicle_photo_url: cleanProfileImage(data.vehicle_photo_url),
    license_photo_url: cleanProfileImage(data.license_photo_url),
    vehicle_type: ['mota', 'carro', 'carrinha', 'outro'].includes(data.vehicle_type) ? data.vehicle_type : 'mota',
    vehicle_plate: cleanText(data.vehicle_plate, 20).toUpperCase(),
    vehicle_brand: cleanText(data.vehicle_brand, 40),
    vehicle_model: cleanText(data.vehicle_model, 40),
    vehicle_color: cleanText(data.vehicle_color, 30),
    vehicle_year: data.vehicle_year ? Math.min(2035, Math.max(1990, Number(data.vehicle_year))) : null,
    license_number: cleanText(data.license_number, 40),
    license_expiry: data.license_expiry || null,
    license_category: ['A', 'B', 'C'].includes(data.license_category) ? data.license_category : 'A',
    emergency_name: cleanText(data.emergency_name, 80),
    emergency_phone: cleanText(data.emergency_phone, 30),
    status: existing?.status || DRIVER_STATUS.OFFLINE,
    driverType: existing?.driverType || DRIVER_TYPES.FREELANCER,
    commissionRate: existing?.commissionRate ?? FINANCIAL.DEFAULT_COMMISSION_RATE,
    verified: existing?.verified === true,
    rating: Number(existing?.rating || 4.9)
  };

  const profile = await DriverProfile.findOneAndUpdate(
    { user: req.user.id },
    profileData,
    { new: true, upsert: true }
  );

  const completedOrders = await Order.find({
    assigned_to_driver: profile._id,
    status: ORDER_STATUS.COMPLETED
  }).lean();

  res.status(200).json({
    message: 'Perfil do motorista actualizado com sucesso.',
    driver: driverProfilePayload(user, profile, completedOrders.length)
  });
});

exports.getMyEarnings = asyncHandler(async (req, res) => {
  const profile = await DriverProfile.findOne({ user: req.user.id });

  if (!profile) {
    res.status(404);
    throw new Error('Perfil de motorista não encontrado.');
  }

  const range = getPeriodRange(req.query?.period || 'month');

  const orders = await Order.find({
    assigned_to_driver: profile._id,
    status: ORDER_STATUS.COMPLETED,
    timestamp_completed: { $gte: range.start, $lte: range.end }
  })
    .sort({ timestamp_completed: -1 })
    .lean();

  const isOfficial = (profile.driverType || DRIVER_TYPES.FREELANCER) === DRIVER_TYPES.OFFICIAL;
  const totalGanhos = isOfficial
    ? 0
    : orders.reduce((total, order) => total + Number(order.valor_motorista || 0), 0);

  res.status(200).json({
    canViewEarnings: !isOfficial,
    driverType: profile.driverType || DRIVER_TYPES.FREELANCER,
    message: isOfficial ? 'Motorista oficial pode ver entregas concluídas, mas não comissões.' : undefined,
    commissionRate: isOfficial ? 0 : profile.commissionRate,
    totalGanhos,
    totalOrders: orders.length,
    ordersList: orders,
    period: { key: range.key, label: range.label, start: range.start, end: range.end }
  });
});
