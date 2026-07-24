const crypto = require('node:crypto');

const createOrderAccessToken = () => crypto.randomBytes(32).toString('hex');

const hashOrderAccessToken = (value) => crypto
  .createHash('sha256')
  .update(String(value || ''))
  .digest('hex');

const extractOrderAccessToken = (req) => String(
  req.headers['x-order-access-token']
  || req.query?.access_token
  || req.body?.access_token
  || ''
).trim();

const hasValidOrderAccess = (order, token) => {
  const expected = String(order?.publicAccessTokenHash || order?.public_access_token_hash || '');
  if (!expected || !token) return false;
  const actual = hashOrderAccessToken(token);
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
};

const requireOrderAccess = (req, order) => {
  if (hasValidOrderAccess(order, extractOrderAccessToken(req))) return;
  const error = new Error('Acesso ao pedido inválido ou expirado. Abra o pedido no dispositivo onde foi criado.');
  error.statusCode = 403;
  throw error;
};

module.exports = {
  createOrderAccessToken,
  extractOrderAccessToken,
  hashOrderAccessToken,
  hasValidOrderAccess,
  requireOrderAccess
};
