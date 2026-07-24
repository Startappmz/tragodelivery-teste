const asyncHandler = require('express-async-handler');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const DriverProfile = require('../models/DriverProfile');
const PasswordResetCode = require('../models/PasswordResetCode');
const { FINANCIAL, DRIVER_TYPES } = require('../utils/constants');
const { parseCommissionRate } = require('../utils/helpers');

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '30d';

const generateToken = (user) =>
  jwt.sign(
    {
      user: {
        id: user._id.toString(),
        role: user.role,
        nome: user.nome
      }
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );

const setAuthCookie = (res, token) =>
  res.cookie('token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 30 * 24 * 60 * 60 * 1000
  });

const RESET_TTL_MINUTES = Number(process.env.PASSWORD_RESET_TTL_MINUTES || '10');
const RESET_MAX_ATTEMPTS = Number(process.env.PASSWORD_RESET_MAX_ATTEMPTS || '5');

const generatePasswordResetCode = () => String(Math.floor(Math.random() * 1000000)).padStart(6, '0');

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

const sendPasswordResetEmail = async (email, code, role) => {
  if (!process.env.RESEND_API_KEY) {
    const error = new Error('Envio de email não configurado. Defina RESEND_API_KEY no ambiente do backend.');
    error.statusCode = 503;
    throw error;
  }

  const roleLabel = role === 'driver' ? 'motorista' : 'admin';
  const from = process.env.RESET_EMAIL_FROM || 'Trago Delivery <noreply@trago.local>';
  const payload = {
    from,
    to: [email],
    subject: 'Código de restauração - Trago Delivery',
    html: `<div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827;max-width:520px;margin:0 auto;padding:24px;border:1px solid #e5e7eb"><h2 style="margin:0 0 12px;font-size:20px;color:#111827">Restaurar password</h2><p>Recebemos um pedido para restaurar a password da sua conta de ${escapeHtml(roleLabel)} no Trago Delivery.</p><p style="margin:18px 0 6px">O seu código é:</p><div style="font-size:28px;font-weight:800;letter-spacing:6px;background:#f3f4f6;padding:14px 18px;text-align:center;border:1px solid #d1d5db">${escapeHtml(code)}</div><p>Este código expira em ${RESET_TTL_MINUTES} minutos.</p><p style="color:#6b7280;font-size:13px">Se não fez este pedido, ignore este email.</p></div>`,
    text: `Código de restauração - Trago Delivery\n\nO seu código é: ${code}\n\nEste código expira em ${RESET_TTL_MINUTES} minutos. Se não fez este pedido, ignore este email.`
  };
  if (process.env.RESET_EMAIL_REPLY_TO) payload.reply_to = process.env.RESET_EMAIL_REPLY_TO;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    console.error('[trago-backend] Falha Resend:', detail);
    const error = new Error('Não foi possível enviar o email de restauração.');
    error.statusCode = 502;
    throw error;
  }
};

exports.registerDriver = asyncHandler(async (req, res) => {
  const data = req.filtered || req.body;
  const { nome, email, telefone, password, vehicle_plate, vehicleId, driverType, commissionRate } = data;

  const normalizedEmail = email.toLowerCase();
  const userExists = await User.findOne({ email: normalizedEmail });

  if (userExists) {
    res.status(400);
    throw new Error('Já existe um utilizador com este email.');
  }

  const hashedPassword = await bcrypt.hash(password, 12);
  const normalizedDriverType = Object.values(DRIVER_TYPES).includes(driverType)
    ? driverType
    : DRIVER_TYPES.FREELANCER;

  const parsedCommission = normalizedDriverType === DRIVER_TYPES.OFFICIAL
    ? 0
    : parseCommissionRate(commissionRate, FINANCIAL.DEFAULT_COMMISSION_RATE);

  const user = await User.create({
    nome: nome.trim(),
    email: normalizedEmail,
    telefone: telefone.trim(),
    password: hashedPassword,
    role: 'driver'
  });

  try {
    const driverProfile = await DriverProfile.create({
      user: user._id,
      vehicle_plate: vehicle_plate?.trim() || '',
      vehicle: vehicleId || null,
      driverType: normalizedDriverType,
      commissionRate: parsedCommission
    });

    res.status(201).json({
      message: 'Motorista registado com sucesso.',
      user: {
        _id: user._id,
        nome: user.nome,
        email: user.email,
        telefone: user.telefone,
        role: user.role
      },
      profile: driverProfile
    });
  } catch (error) {
    await user.deleteOne().catch(() => {});
    throw error;
  }
});

exports.login = asyncHandler(async (req, res) => {
  const data = req.filtered || req.body;
  const { email, password, role } = data;

  const normalizedEmail = email.toLowerCase();
  const user = await User.findOne({ email: normalizedEmail, role }).select('+password');

  if (!user) {
    res.status(401);
    throw new Error('Credenciais inválidas.');
  }

  const passwordOk = await bcrypt.compare(password, user.password);
  if (!passwordOk) {
    res.status(401);
    throw new Error('Credenciais inválidas.');
  }

  const token = generateToken(user);
  setAuthCookie(res, token);

  res.status(200).json({
    message: 'Login bem-sucedido.',
    token,
    user: {
      _id: user._id,
      nome: user.nome,
      role: user.role
    }
  });
});


exports.requestPasswordReset = asyncHandler(async (req, res) => {
  const data = req.filtered || req.body;
  const { email, role } = data;
  const allowedRoles = ['admin', 'driver'];
  if (!allowedRoles.includes(role)) {
    res.status(400);
    throw new Error('Tipo de utilizador inválido.');
  }

  const normalizedEmail = email.toLowerCase();
  const genericMessage = 'Se o email existir, receberá um código de restauração.';
  const user = await User.findOne({ email: normalizedEmail, role });
  if (!user) return res.status(200).json({ message: genericMessage });

  await PasswordResetCode.deleteMany({ email: normalizedEmail, role, usedAt: null });

  const code = generatePasswordResetCode();
  await PasswordResetCode.create({
    user: user._id,
    email: normalizedEmail,
    role,
    codeHash: await bcrypt.hash(code, 12),
    expiresAt: new Date(Date.now() + RESET_TTL_MINUTES * 60 * 1000).toISOString(),
    attempts: 0
  });

  await sendPasswordResetEmail(normalizedEmail, code, role);
  return res.status(200).json({ message: genericMessage });
});

exports.confirmPasswordReset = asyncHandler(async (req, res) => {
  const data = req.filtered || req.body;
  const { email, role, newPassword } = data;
  const code = data.code || data.resetCode;

  const allowedRoles = ['admin', 'driver'];
  if (!allowedRoles.includes(role)) {
    res.status(400);
    throw new Error('Tipo de utilizador inválido.');
  }

  if (String(newPassword || '').length < 8) {
    res.status(400);
    throw new Error('A nova password deve ter pelo menos 8 caracteres.');
  }

  const normalizedEmail = email.toLowerCase();
  const user = await User.findOne({ email: normalizedEmail, role }).select('+password');
  if (!user) {
    res.status(400);
    throw new Error('Código inválido ou expirado.');
  }

  const reset = await PasswordResetCode.findOne({ user: user._id, email: normalizedEmail, role, usedAt: null }).sort({ createdAt: -1 });
  if (!reset || new Date(reset.expiresAt).getTime() < Date.now()) {
    res.status(400);
    throw new Error('Código inválido ou expirado.');
  }

  if (Number(reset.attempts || 0) >= RESET_MAX_ATTEMPTS) {
    reset.usedAt = new Date().toISOString();
    await reset.save();
    res.status(429);
    throw new Error('Muitas tentativas. Peça um novo código.');
  }

  const codeOk = await bcrypt.compare(String(code), reset.codeHash);
  if (!codeOk) {
    reset.attempts = Number(reset.attempts || 0) + 1;
    if (reset.attempts >= RESET_MAX_ATTEMPTS) reset.usedAt = new Date().toISOString();
    await reset.save();
    res.status(reset.attempts >= RESET_MAX_ATTEMPTS ? 429 : 401);
    throw new Error(reset.attempts >= RESET_MAX_ATTEMPTS ? 'Muitas tentativas. Peça um novo código.' : 'Código inválido ou expirado.');
  }

  user.password = await bcrypt.hash(newPassword, 12);
  await user.save();
  reset.usedAt = new Date().toISOString();
  await reset.save();

  res.status(200).json({ message: 'Password actualizada com sucesso. Já pode iniciar sessão.' });
});

exports.logout = asyncHandler(async (_req, res) => {
  res.clearCookie('token', {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production'
  });

  res.status(200).json({ message: 'Sessão encerrada com sucesso.' });
});

exports.changePassword = asyncHandler(async (req, res) => {
  const data = req.filtered || req.body;
  const { senhaAntiga, senhaNova } = data;

  const user = await User.findById(req.user.id).select('+password');
  if (!user) {
    res.status(404);
    throw new Error('Utilizador não encontrado.');
  }

  const isMatch = await bcrypt.compare(senhaAntiga, user.password);
  if (!isMatch) {
    res.status(401);
    throw new Error('A senha antiga está incorreta.');
  }

  user.password = await bcrypt.hash(senhaNova, 12);
  await user.save();

  const token = generateToken(user);
  setAuthCookie(res, token);

  res.status(200).json({ message: 'Senha atualizada com sucesso.' });
});

// GET /api/auth/me
// Retorna os dados do utilizador autenticado
exports.getMe = asyncHandler(async (req, res) => {
  let profile = null;
  if (req.user.role === 'driver') {
    profile = await DriverProfile.findOne({ user: req.user._id }).lean();
  }

  res.status(200).json({
    id: req.user._id,
    nome: req.user.nome,
    email: req.user.email,
    role: req.user.role,
    profile
  });
});
