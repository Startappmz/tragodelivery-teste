const jwt = require('jsonwebtoken');
const User = require('../models/User');

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET não está definido nas variáveis de ambiente.');
}

const decodeToken = (token) => jwt.verify(token, JWT_SECRET);

const extractToken = (req) => {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.split(' ')[1];
  }
  if (req.cookies?.token) {
    return req.cookies.token;
  }
  return null;
};

const protect = async (req, res, next) => {
  try {
    const token = extractToken(req);

    if (!token) {
      return res.status(401).json({ message: 'Não autorizado, token em falta' });
    }

    const decoded = decodeToken(token);
    const user = await User.findById(decoded.user.id).select('-password');

    if (!user) {
      return res.status(401).json({ message: 'Não autorizado, utilizador inexistente' });
    }

    req.user = user;
    return next();
  } catch (error) {
    return res.status(401).json({ message: 'Sessão inválida ou expirada' });
  }
};

const admin = (req, res, next) => {
  if (req.user?.role === 'admin') {
    return next();
  }
  return res.status(403).json({ message: 'Acesso restrito a administradores' });
};

const driver = (req, res, next) => {
  if (req.user?.role === 'driver') {
    return next();
  }
  return res.status(403).json({ message: 'Acesso restrito a motoristas' });
};

module.exports = {
  protect,
  admin,
  driver
};