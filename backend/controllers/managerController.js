const asyncHandler = require('express-async-handler');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { isValidId } = require('../utils/id');

exports.createManager = asyncHandler(async (req, res) => {
  const { nome, email, telefone, password } = req.body;

  const existingUser = await User.findOne({ email });
  if (existingUser) {
    res.status(400);
    throw new Error('Email já registado.');
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  const manager = await User.create({
    nome,
    email,
    telefone,
    password: hashedPassword,
    role: 'manager'
  });

  res.status(201).json({
    message: 'Gestor criado com sucesso.',
    manager: {
      _id: manager._id,
      nome: manager.nome,
      email: manager.email,
      telefone: manager.telefone,
      role: manager.role
    }
  });
});

exports.getAllManagers = asyncHandler(async (_req, res) => {
  const managers = await User.find({ role: 'manager' })
    .sort({ nome: 1 })
    .lean();

  res.status(200).json({ managers });
});

exports.getManagerById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!isValidId(id)) {
    res.status(404);
    throw new Error('Gestor não encontrado (ID inválido).');
  }

  const manager = await User.findById(id);

  if (!manager || manager.role !== 'manager') {
    res.status(404);
    throw new Error('Gestor não encontrado.');
  }

  res.status(200).json({ manager });
});

exports.updateManager = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { nome, telefone, email } = req.body;

  if (!isValidId(id)) {
    res.status(404);
    throw new Error('Gestor não encontrado (ID inválido).');
  }

  const manager = await User.findById(id);

  if (!manager || manager.role !== 'manager') {
    res.status(404);
    throw new Error('Gestor não encontrado.');
  }

  manager.nome = nome;
  manager.telefone = telefone;
  manager.email = email;

  await manager.save();

  res.status(200).json({
    message: 'Gestor atualizado com sucesso.',
    manager
  });
});

exports.deleteManager = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!isValidId(id)) {
    res.status(404);
    throw new Error('Gestor não encontrado (ID inválido).');
  }

  const manager = await User.findById(id);

  if (!manager || manager.role !== 'manager') {
    res.status(404);
    throw new Error('Gestor não encontrado.');
  }

  await manager.deleteOne();

  res.status(200).json({
    message: 'Gestor apagado com sucesso.'
  });
});