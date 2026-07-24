const asyncHandler = require('express-async-handler');
const { isValidId } = require('../utils/id');
const Vehicle = require('../models/Vehicle');
const CompanyCost = require('../models/CompanyCost');

exports.createVehicle = asyncHandler(async (req, res) => {
  const data = req.filtered || req.body;
  const { plate, brand, model, type, status, notes } = data;
  const normalizedPlate = String(plate || '').trim().toUpperCase();

  const existing = await Vehicle.findOne({ plate: normalizedPlate });
  if (existing) {
    res.status(400);
    throw new Error('Já existe um veículo com esta matrícula.');
  }

  const vehicle = await Vehicle.create({
    plate: normalizedPlate,
    brand: brand || '',
    model: model || '',
    type: type || 'mota',
    status: status || 'ativo',
    notes: notes || '',
    created_by: req.user?._id
  });

  res.status(201).json({ message: 'Veículo registado com sucesso.', vehicle });
});

exports.getAllVehicles = asyncHandler(async (_req, res) => {
  const vehicles = await Vehicle.find().sort({ plate: 1 }).lean();
  res.status(200).json({ vehicles });
});

exports.getVehicleById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) {
    res.status(404);
    throw new Error('Veículo não encontrado (ID inválido).');
  }

  const vehicle = await Vehicle.findById(id);
  if (!vehicle) {
    res.status(404);
    throw new Error('Veículo não encontrado.');
  }

  res.status(200).json({ vehicle });
});

exports.updateVehicle = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const data = req.filtered || req.body;
  const { plate, brand, model, type, status, notes } = data;

  const vehicle = await Vehicle.findById(id);
  if (!vehicle) {
    res.status(404);
    throw new Error('Veículo não encontrado.');
  }

  const normalizedPlate = String(plate || '').trim().toUpperCase();
  if (normalizedPlate !== vehicle.plate) {
    const plateInUse = await Vehicle.findOne({ plate: normalizedPlate });
    if (plateInUse) {
      res.status(400);
      throw new Error('Esta matrícula já está em uso.');
    }
  }

  vehicle.plate = normalizedPlate;
  vehicle.brand = brand || '';
  vehicle.model = model || '';
  vehicle.type = type || 'mota';
  vehicle.status = status || 'ativo';
  vehicle.notes = notes || '';
  await vehicle.save();

  res.status(200).json({ message: 'Veículo atualizado com sucesso.', vehicle });
});

exports.deleteVehicle = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const vehicle = await Vehicle.findById(id);
  if (!vehicle) {
    res.status(404);
    throw new Error('Veículo não encontrado.');
  }

  const hasCosts = await CompanyCost.exists({ assignedVehicle: id });
  if (hasCosts) {
    res.status(400);
    throw new Error('Não é possível apagar veículos com custos associados.');
  }

  await vehicle.deleteOne();
  res.status(200).json({ message: 'Veículo apagado com sucesso.' });
});
