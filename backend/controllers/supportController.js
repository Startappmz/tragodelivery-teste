const jwt = require('jsonwebtoken');
const asyncHandler = require('express-async-handler');
const User = require('../models/User');
const Restaurant = require('../models/Restaurant');
const SupportThread = require('../models/SupportThread');
const SupportMessage = require('../models/SupportMessage');
const { createAdminNotification } = require('../utils/notifications');
const { ADMIN_ROOM } = require('../utils/constants');

const clean = (value, limit = 500) => String(value || '').trim().slice(0, limit);
const validId = (value) => /^[a-f0-9]{24}$/i.test(String(value || ''));

const getBearer = (req) => {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
};

async function resolveActor(req, payload = {}) {
  const token = getBearer(req);
  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (decoded?.user?.id) {
        const user = await User.findById(decoded.user.id).lean();
        if (user && !['admin', 'driver'].includes(user.role)) {
          const error = new Error('Perfil sem acesso ao suporte interno.');
          error.statusCode = 403;
          throw error;
        }
        if (user) return { role: user.role, id: String(user._id || user.id), name: user.nome || user.email || user.role };
      }
      if (decoded?.restaurant?.id) {
        const restaurant = await Restaurant.findById(decoded.restaurant.id).lean();
        if (restaurant?.status === 'active') return { role: 'restaurant', id: String(restaurant._id || restaurant.id), name: restaurant.name || 'Restaurante' };
      }
    } catch (_error) {
      if (_error?.statusCode) throw _error;
      const error = new Error('Sessão inválida ou expirada.');
      error.statusCode = 401;
      throw error;
    }
  }

  const sessionId = clean(payload.client_session_id || req.query.client_session_id, 120);
  if (sessionId) return { role: 'client', id: sessionId, name: clean(payload.client_name || req.query.client_name, 120) || 'Cliente' };

  const error = new Error('Identificação necessária para usar o suporte.');
  error.statusCode = 401;
  throw error;
}

function ensureAccess(thread, actor) {
  const isAdmin = actor.role === 'admin';
  const ownsThread = String(thread.requesterId || thread.requester_id) === actor.id && String(thread.requesterRole || thread.requester_role) === actor.role;
  if (!isAdmin && !ownsThread) {
    const error = new Error('Não tem acesso a esta conversa.');
    error.statusCode = 403;
    throw error;
  }
}

function emitSupport(req, event, payload) {
  const io = req.app.get('socketio');
  io?.to(ADMIN_ROOM).emit(event, payload);
  if (payload.requesterRole === 'driver' && payload.requesterId) io?.to(`driver:${payload.requesterId}`).emit(event, payload);
}

exports.listThreads = asyncHandler(async (req, res) => {
  const actor = await resolveActor(req);
  const filter = actor.role === 'admin' ? {} : { requesterRole: actor.role, requesterId: actor.id };
  if (req.query.status && ['open', 'pending', 'resolved', 'closed'].includes(req.query.status)) filter.status = req.query.status;
  const threads = await SupportThread.find(filter).sort({ lastMessageAt: -1, createdAt: -1 }).limit(150).lean();
  res.json({ threads, actor: { role: actor.role, name: actor.name } });
});

exports.createThread = asyncHandler(async (req, res) => {
  const actor = await resolveActor(req, req.body);
  const subject = clean(req.body.subject, 140);
  const body = clean(req.body.message, 2000);
  if (!subject || !body) {
    res.status(400);
    throw new Error('Indique o assunto e a mensagem.');
  }

  const now = new Date();
  const thread = await SupportThread.create({
    subject,
    category: ['order', 'payment', 'account', 'technical', 'restaurant', 'driver', 'general'].includes(req.body.category) ? req.body.category : 'general',
    status: 'open',
    priority: ['low', 'normal', 'high', 'urgent'].includes(req.body.priority) ? req.body.priority : 'normal',
    requesterRole: actor.role,
    requesterId: actor.id,
    requesterName: actor.name,
    orderId: validId(req.body.order_id) ? String(req.body.order_id) : null,
    lastMessageAt: now
  });
  const message = await SupportMessage.create({ threadId: thread._id, senderRole: actor.role, senderId: actor.id, senderName: actor.name, body });
  await createAdminNotification({
    dedupeKey: `support:${thread._id}:created`,
    type: 'info',
    title: `Novo pedido de suporte · ${actor.role}`,
    message: `${actor.name}: ${subject}`,
    orderId: thread.orderId || null,
    payload: { threadId: thread._id, requesterRole: actor.role, requesterName: actor.name }
  });
  emitSupport(req, 'support_thread_created', { threadId: thread._id, requesterRole: actor.role, requesterId: actor.id });
  res.status(201).json({ thread, message });
});

exports.listMessages = asyncHandler(async (req, res) => {
  const actor = await resolveActor(req);
  const thread = await SupportThread.findById(req.params.id).lean();
  if (!thread) {
    res.status(404);
    throw new Error('Conversa de suporte não encontrada.');
  }
  ensureAccess(thread, actor);
  const messages = await SupportMessage.find({ threadId: thread._id }).sort({ createdAt: 1 }).limit(500).lean();
  res.json({ thread, messages });
});

exports.createMessage = asyncHandler(async (req, res) => {
  const actor = await resolveActor(req, req.body);
  const thread = await SupportThread.findById(req.params.id);
  if (!thread) {
    res.status(404);
    throw new Error('Conversa de suporte não encontrada.');
  }
  ensureAccess(thread, actor);
  const body = clean(req.body.message, 2000);
  if (!body) {
    res.status(400);
    throw new Error('Escreva uma mensagem.');
  }
  const message = await SupportMessage.create({ threadId: thread._id, senderRole: actor.role, senderId: actor.id, senderName: actor.name, body });
  thread.lastMessageAt = new Date();
  if (actor.role === 'admin') {
    thread.status = thread.status === 'closed' ? 'closed' : 'pending';
    thread.assignedAdminId = actor.id;
  } else {
    thread.status = thread.status === 'closed' ? 'open' : thread.status;
    await createAdminNotification({
      dedupeKey: `support:${thread._id}:message:${message._id}`,
      type: 'info',
      title: `Nova mensagem de ${actor.name}`,
      message: body.slice(0, 180),
      orderId: thread.orderId || null,
      payload: { threadId: thread._id, requesterRole: thread.requesterRole }
    });
  }
  await thread.save();
  emitSupport(req, 'support_message_created', { threadId: thread._id, requesterRole: thread.requesterRole, requesterId: thread.requesterId });
  res.status(201).json({ thread, message });
});

exports.updateThread = asyncHandler(async (req, res) => {
  const actor = await resolveActor(req, req.body);
  const thread = await SupportThread.findById(req.params.id);
  if (!thread) {
    res.status(404);
    throw new Error('Conversa de suporte não encontrada.');
  }
  ensureAccess(thread, actor);
  const status = clean(req.body.status, 30);
  const priority = clean(req.body.priority, 30);
  if (status) {
    if (!['open', 'pending', 'resolved', 'closed'].includes(status)) {
      res.status(400);
      throw new Error('Estado de suporte inválido.');
    }
    if (actor.role !== 'admin' && !['open', 'closed'].includes(status)) {
      res.status(403);
      throw new Error('Apenas o Admin pode definir este estado.');
    }
    thread.status = status;
  }
  if (priority && actor.role === 'admin' && ['low', 'normal', 'high', 'urgent'].includes(priority)) thread.priority = priority;
  if (actor.role === 'admin') thread.assignedAdminId = actor.id;
  await thread.save();
  emitSupport(req, 'support_thread_updated', { threadId: thread._id, requesterRole: thread.requesterRole, requesterId: thread.requesterId, status: thread.status });
  res.json({ thread });
});
