// Trago Delivery · Supabase Edge Function API
// Mantém compatibilidade com as rotas /api/... do front-end antigo,
// substituindo o backend antigo por Supabase Edge Functions + Postgres + Storage + Realtime.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import bcrypt from 'https://esm.sh/bcryptjs@2.4.3';
import { create, getNumericDate, verify } from 'https://deno.land/x/djwt@v3.0.2/mod.ts';

// IMPORTANTE:
// O Dashboard da Supabase não permite criar secrets personalizadas com o prefixo SUPABASE_.
// Por isso, usamos nomes próprios do projecto: TRAGO_SUPABASE_URL e TRAGO_SUPABASE_SECRET_KEY.
const SUPABASE_URL = Deno.env.get('TRAGO_SUPABASE_URL') || Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SECRET_KEY =
  Deno.env.get('TRAGO_SUPABASE_SECRET_KEY') ||
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ||
  Deno.env.get('SERVICE_ROLE_KEY') ||
  '';
const JWT_SECRET = Deno.env.get('JWT_SECRET') || '';
const JWT_DAYS = Number(Deno.env.get('JWT_DAYS') || '30');
const STORAGE_BUCKET = Deno.env.get('STORAGE_BUCKET_ORDER_IMAGES') || 'order-images';
const MEDIA_BUCKET = Deno.env.get('STORAGE_BUCKET_MEDIA') || 'trago-media';
const PRIVATE_MEDIA_BUCKET = Deno.env.get('STORAGE_BUCKET_PRIVATE_MEDIA') || 'trago-private-media';
const MAX_IMAGE_BYTES = Number(Deno.env.get('UPLOAD_IMAGE_MAX_SIZE') || String(5 * 1024 * 1024));
const TRAGO_ORS_API_KEY = Deno.env.get('TRAGO_ORS_API_KEY') || '';
const TRAGO_GOOGLE_CLIENT_ID = Deno.env.get('TRAGO_GOOGLE_CLIENT_ID') || Deno.env.get('GOOGLE_CLIENT_ID') || '';
const ROUTE_PRICING_POLICY = Object.freeze({
  baseDistanceKm: Number(Deno.env.get('TRAGO_BASE_DISTANCE_KM') || '11.6'),
  baseFeeMzn: Number(Deno.env.get('TRAGO_BASE_DISTANCE_FEE_MZN') || '200'),
  extraKmFeeMzn: Number(Deno.env.get('TRAGO_EXTRA_KM_FEE_MZN') || '15')
});
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') || '';
const RESET_EMAIL_FROM = Deno.env.get('RESET_EMAIL_FROM') || 'Trago Delivery <noreply@trago.local>';
const RESET_EMAIL_REPLY_TO = Deno.env.get('RESET_EMAIL_REPLY_TO') || '';
const PASSWORD_RESET_TTL_MINUTES = Number(Deno.env.get('PASSWORD_RESET_TTL_MINUTES') || '10');
const PASSWORD_RESET_MAX_ATTEMPTS = Number(Deno.env.get('PASSWORD_RESET_MAX_ATTEMPTS') || '5');
const RADAR_PRIMARY_RADIUS_KM = 5;
const RADAR_EXPANDED_RADIUS_KM = 25;
const RADAR_HEARTBEAT_TTL_MS = 60 * 1000;
const RADAR_LOCATION_TTL_MS = 10 * 60 * 1000;

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY || !JWT_SECRET) {
  console.warn('[trago-edge] Variáveis obrigatórias em falta: TRAGO_SUPABASE_URL, TRAGO_SUPABASE_SECRET_KEY, JWT_SECRET.');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

type Role = 'admin' | 'driver' | 'manager';
type AnyRecord = Record<string, any>;

const DRIVER_STATUS = Object.freeze({
  ONLINE_FREE: 'online_livre',
  ONLINE_BUSY: 'online_ocupado',
  PICKUP: 'em_recolha',
  DELIVERY: 'em_entrega',
  OFFLINE: 'offline'
});

const DRIVER_TYPES = Object.freeze({
  FREELANCER: 'freelancer',
  OFFICIAL: 'official'
});

const ORDER_STATUS = Object.freeze({
  PENDING: 'pendente',
  ASSIGNED: 'atribuido',
  IN_PROGRESS: 'em_progresso',
  PICKUP_IN_PROGRESS: 'recolha_em_progresso',
  PICKUP_DONE: 'recolha_concluida',
  DELIVERY_IN_PROGRESS: 'entrega_em_progresso',
  COMPLETED: 'concluido',
  CANCELED: 'cancelado'
});

// Pedidos criados antes da coluna restaurant_status podem já estar em rota.
// São expostos como “ready” no portal do estabelecimento para não voltar a
// apresentar acções de aceitar/preparar nesses registos antigos.
const MESSAGE_CHANNEL = Object.freeze({
  CLIENT_DRIVER: 'client_driver',
  DRIVER_PARTNER: 'driver_partner',
  SYSTEM: 'system',
  SUPPORT: 'support'
});

const MESSAGE_CHANNELS = new Set(Object.values(MESSAGE_CHANNEL));

// Estados legados guardados antes da confirmaÃ§Ã£o explÃ­cita do parceiro.
// Um pedido antigo marcado como "ready" continua levantÃ¡vel, sem remover a
// exigÃªncia de confirmaÃ§Ã£o para novos pedidos.
const ADMIN_ROOM = 'admin_room';
const PAYMENT_STATUS = Object.freeze({
  UNPAID: 'nao_pago',
  AWAITING_DRIVER_CONFIRMATION: 'aguardando_confirmacao_pagamento',
  PAID: 'pago',
  POSTPAID_MONTHLY: 'pos_pago_mensal'
});

const CLIENT_BILLING_TYPES = Object.freeze({
  PREPAID: 'prepaid',
  POSTPAID: 'postpaid'
});

const ALLOWED_PAYMENT_METHODS = new Set(['cash', 'mpesa', 'emola', 'mkesh', 'bank_transfer', 'pos', 'card', 'wallet', 'postpaid_credit']);
const ONLINE_DRIVER_STATUSES = [
  DRIVER_STATUS.ONLINE_FREE,
  DRIVER_STATUS.ONLINE_BUSY,
  DRIVER_STATUS.PICKUP,
  DRIVER_STATUS.DELIVERY
];

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-order-access-token',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Credentials': 'true'
};

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const json = (body: unknown, status = 200, extraHeaders: HeadersInit = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json; charset=utf-8',
      ...extraHeaders
    }
  });

const textResponse = (body: string, status = 200, headers: HeadersInit = {}) =>
  new Response(body, {
    status,
    headers: {
      ...corsHeaders,
      ...headers
    }
  });

const normalizePath = (requestUrl: string) => {
  const url = new URL(requestUrl);
  const parts = url.pathname.split('/').filter(Boolean);
  const functionIndex = parts.findIndex((part, index) => part === 'api' && parts[index - 1] === 'v1');

  let pathParts: string[];
  if (functionIndex >= 0) {
    pathParts = parts.slice(functionIndex + 1);
  } else if (parts[0] === 'api') {
    pathParts = parts.slice(1);
  } else {
    pathParts = parts;
  }

  const path = `/${pathParts.join('/')}`.replace(/\/+/g, '/');
  return path === '/' ? '/health' : path;
};

const isValidId = (id: unknown) => typeof id === 'string' && /^[a-f0-9]{24}$/i.test(id);
const generateId = () => Array.from(crypto.getRandomValues(new Uint8Array(12))).map((b) => b.toString(16).padStart(2, '0')).join('');
const generateOrderAccessToken = () => Array.from(crypto.getRandomValues(new Uint8Array(32))).map((b) => b.toString(16).padStart(2, '0')).join('');
const hashOrderAccessToken = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))).map((b) => b.toString(16).padStart(2, '0')).join('');
const nowIso = () => new Date().toISOString();
const toNumber = (value: unknown, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clean = (value: unknown) => typeof value === 'string' ? value.trim() : value;
const lowerEmail = (value: unknown) => String(value || '').trim().toLowerCase();
const normalizePhone = (value: unknown) => String(value || '').replace(/\D/g, '');
const isClientPassword = (value: unknown) => {
  const password = String(value || '');
  return password.length >= 8 && password.length <= 128;
};
const isLegacyClientCredential = (value: unknown) => {
  const password = String(value || '');
  return password.length >= 4 && password.length <= 128;
};
const cleanDriverImage = (value: unknown) => {
  const image = String(value || '').trim();
  if (!image) return '';
  const valid = /^https:\/\/[\w.-]+(?:[/:?#]|$)/i.test(image)
    || /^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(image)
    || /^private:[a-z0-9_./-]+$/i.test(image);
  if (!valid || image.length > 950000) throw new HttpError(400, 'Uma das fotografias é inválida ou demasiado grande.');
  return image;
};

const paymentMethodLabel = (method: unknown) => ({
  cash: 'Dinheiro',
  mpesa: 'M-Pesa',
  emola: 'e-Mola',
  mkesh: 'mKesh',
  bank_transfer: 'Transferência bancária',
  pos: 'POS',
  card: 'Cartão',
  wallet: 'Carteira TraGo',
  postpaid_credit: 'Cliente Pós-pago / Crédito'
})[String(method || '')] || String(method || '—');

const requiresImmediatePayment = (order: AnyRecord) => String(order.payment_method || '') !== 'postpaid_credit';

const makeJwtKey = async () => crypto.subtle.importKey(
  'raw',
  new TextEncoder().encode(JWT_SECRET),
  { name: 'HMAC', hash: 'SHA-256' },
  false,
  ['sign', 'verify']
);

const generateToken = async (user: AnyRecord) => {
  const key = await makeJwtKey();
  return create(
    { alg: 'HS256', typ: 'JWT' },
    {
      user: {
        id: user.id,
        role: user.role,
        nome: user.nome
      },
      exp: getNumericDate(JWT_DAYS * 24 * 60 * 60)
    },
    key
  );
};

const readToken = (req: Request) => {
  const auth = req.headers.get('authorization') || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);

  const cookie = req.headers.get('cookie') || '';
  const tokenCookie = cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith('token='));
  return tokenCookie ? decodeURIComponent(tokenCookie.slice('token='.length)) : null;
};

const verifyToken = async (token: string) => {
  const key = await makeJwtKey();
  return verify(token, key) as Promise<AnyRecord>;
};

const requiredFields = (payload: AnyRecord, fields: string[]) => {
  for (const field of fields) {
    if (payload[field] === undefined || payload[field] === null || String(payload[field]).trim() === '') {
      throw new HttpError(400, `Campo obrigatório em falta: ${field}`);
    }
  }
};

const readBody = async (req: Request) => {
  const contentType = req.headers.get('content-type') || '';
  if (contentType.includes('multipart/form-data')) return req.formData();
  if (contentType.includes('application/json')) return req.json().catch(() => ({}));
  const text = await req.text().catch(() => '');
  if (!text) return {};
  try { return JSON.parse(text); } catch { return Object.fromEntries(new URLSearchParams(text)); }
};

const parseQuery = (req: Request) => Object.fromEntries(new URL(req.url).searchParams.entries());

const requirePublicOrderAccess = async (req: Request, order: AnyRecord) => {
  const authenticatedClient = await optionalClient(req);
  if (authenticatedClient && String(order.client || '') === String(authenticatedClient.id)) return;
  const query = parseQuery(req);
  const token = String(req.headers.get('x-order-access-token') || query.access_token || '').trim();
  if (!token || !order.public_access_token_hash || await hashOrderAccessToken(token) !== order.public_access_token_hash) {
    throw new HttpError(403, 'Acesso ao pedido inválido ou expirado. Entre na conta usada no pedido ou abra-o no dispositivo onde foi criado.');
  }
};

const getPeriodRange = (periodRaw: unknown) => {
  const key = ['day', 'week', 'month'].includes(String(periodRaw || '')) ? String(periodRaw) : 'month';
  const start = new Date();
  const end = new Date();
  end.setUTCHours(23, 59, 59, 999);

  if (key === 'day') {
    start.setUTCHours(0, 0, 0, 0);
  } else if (key === 'week') {
    const day = start.getUTCDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    start.setUTCDate(start.getUTCDate() + mondayOffset);
    start.setUTCHours(0, 0, 0, 0);
  } else {
    start.setUTCDate(1);
    start.setUTCHours(0, 0, 0, 0);
  }

  const label = key === 'day' ? 'Hoje' : key === 'week' ? 'Esta Semana' : 'Este Mês';
  return { key, label, start, end };
};

const requireUser = async (req: Request, allowedRoles?: Role | Role[]) => {
  const token = readToken(req);
  if (!token) throw new HttpError(401, 'Não autorizado, token em falta');

  let decoded: AnyRecord;
  try {
    decoded = await verifyToken(token);
  } catch (_err) {
    throw new HttpError(401, 'Sessão inválida ou expirada');
  }

  const userId = decoded?.user?.id;
  if (!userId) throw new HttpError(401, 'Sessão inválida ou expirada');

  const { data: user, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (error) throw new HttpError(500, error.message);
  if (!user) throw new HttpError(401, 'Não autorizado, utilizador inexistente');

  const roles = Array.isArray(allowedRoles) ? allowedRoles : allowedRoles ? [allowedRoles] : [];
  if (roles.length && !roles.includes(user.role)) {
    throw new HttpError(403, roles.includes('admin') ? 'Acesso restrito a administradores' : 'Acesso restrito');
  }

  return fromUser(user);
};

const fromUser = (row: AnyRecord, includePassword = false) => {
  if (!row) return null;
  const user: AnyRecord = {
    _id: row.id,
    id: row.id,
    nome: row.nome,
    email: row.email,
    telefone: row.telefone,
    role: row.role,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
  if (includePassword) user.password = row.password;
  return user;
};

const fromClient = (row: AnyRecord) => row ? ({
  _id: row.id,
  id: row.id,
  nome: row.nome,
  name: row.nome,
  telefone: row.telefone,
  phone: row.telefone,
  email: row.email || '',
  empresa: row.empresa || '',
  nuit: row.nuit || '',
  endereco: row.endereco || '',
  billing_type: row.billing_type || CLIENT_BILLING_TYPES.PREPAID,
  credit_limit: Number(row.credit_limit || 0),
  credit_balance: Number(row.credit_balance || 0),
  credit_used: Number(row.credit_used || 0),
  avatar_url: row.avatar_url || '',
  account_status: row.account_status || 'active',
  email_verified: row.email_verified === true,
  phone_verified: row.phone_verified === true,
  referral_code: row.referral_code || '',
  notification_preferences: row.notification_preferences || {},
  language: row.language || 'pt',
  wallet_balance_cents: Number(row.wallet_balance_cents || 0),
  loyalty_points: Number(row.loyalty_points || 0),
  credit: {
    limit: Number(row.credit_limit || 0),
    balance: Number(row.credit_balance || 0),
    used: Number(row.credit_used || 0)
  },
  created_by_admin: row.created_by_admin,
  createdAt: row.created_at,
  updatedAt: row.updated_at
}) : null;

const fromProfile = (row: AnyRecord) => row ? ({
  _id: row.id,
  id: row.id,
  user: row.user_id,
  vehicle_plate: row.vehicle_plate || '',
  vehicle_id: row.vehicle_id || null,
  driver_type: row.driver_type || DRIVER_TYPES.FREELANCER,
  driverType: row.driver_type || DRIVER_TYPES.FREELANCER,
  account_status: row.account_status || 'active',
  accountStatus: row.account_status || 'active',
  approval_status: row.approval_status || 'pending',
  approvalStatus: row.approval_status || 'pending',
  status: row.status,
  commissionRate: String(row.driver_type || DRIVER_TYPES.FREELANCER) === DRIVER_TYPES.OFFICIAL ? 0 : Number(row.commission_rate ?? 20),
  lastLocation: row.last_location,
  avatar_url: row.avatar_url || '',
  vehicle_photo_url: row.vehicle_photo_url || '',
  license_photo_url: String(row.license_photo_url || '').startsWith('private:') ? '' : (row.license_photo_url || ''),
  license_photo_available: Boolean(row.license_photo_url),
  vehicle_brand: row.vehicle_brand || '',
  vehicle_model: row.vehicle_model || '',
  vehicle_color: row.vehicle_color || '',
  vehicle_type: row.vehicle_type || 'mota',
  vehicle_year: row.vehicle_year || null,
  license_number: row.license_number || '',
  license_expiry: row.license_expiry || null,
  license_category: row.license_category || 'A',
  emergency_name: row.emergency_name || '',
  emergency_phone: row.emergency_phone || '',
  bio: row.bio || '',
  rating: Number(row.rating || 4.9),
  verified: row.verified === true,
  createdAt: row.created_at,
  updatedAt: row.updated_at
}) : null;

const fromOrder = (row: AnyRecord) => row ? ({
  _id: row.id,
  id: row.id,
  service_type: row.service_type,
  price: Number(row.price || 0),
  client_name: row.client_name,
  client_phone1: row.client_phone1,
  client_phone2: row.client_phone2,
  address_text: row.address_text,
  address_coords: row.address_coords,
  pickup_address_text: row.pickup_address_text,
  pickup_address_coords: row.pickup_address_coords,
  pickup_contact_name: row.pickup_contact_name || '',
  pickup_contact_phone: row.pickup_contact_phone || '',
  pickup_notes: row.pickup_notes || '',
  client_notes: row.client_notes || '',
  service_price: Number(row.service_price || 0),
  delivery_fee: Number(row.delivery_fee || 0),
  route_distance_km: row.route_distance_km != null ? Number(row.route_distance_km) : null,
  route_duration_min: row.route_duration_min != null ? Number(row.route_duration_min) : null,
  route_pricing_source: row.route_pricing_source,
  image_url: row.image_url,
  verification_code: row.verification_code,
  created_by_admin: row.created_by_admin,
  assigned_to_driver: row.assigned_to_driver,
  offered_to_driver: row.offered_to_driver || null,
  driver_offer_status: row.driver_offer_status || null,
  driver_offer_expires_at: row.driver_offer_expires_at || null,
  driver_offer_rejected_ids: Array.isArray(row.driver_offer_rejected_ids) ? row.driver_offer_rejected_ids : [],
  restaurant_id: row.restaurant_id || null,
  restaurantId: row.restaurant_id || null,
  restaurant_status: row.restaurant_status || null,
  restaurantStatus: row.restaurant_status || null,
  restaurant_ready_at: row.restaurant_ready_at || null,
  restaurantReadyAt: row.restaurant_ready_at || null,
  restaurant_prep_time_min: row.restaurant_prep_time_min || null,
  restaurantPrepTimeMin: row.restaurant_prep_time_min || null,
  partner_confirmed_at: row.partner_confirmed_at || null,
  partner_confirmed_by: row.partner_confirmed_by || null,
  pickup_authorized_at: row.pickup_authorized_at || null,
  pickup_authorized_by: row.pickup_authorized_by || null,
  partner_id: row.partner_id || null,
  purchase_source_type: row.purchase_source_type || null,
  purchase_source_label: row.purchase_source_label || '',
  purchase_source_coords: row.purchase_source_coords || null,
  requested_product: row.requested_product || '',
  scheduled_at: row.scheduled_at || null,
  route_stops: Array.isArray(row.route_stops) ? row.route_stops : [],
  delivery_proof_url: String(row.delivery_proof_url || '').startsWith('private:') ? '' : (row.delivery_proof_url || ''),
  delivery_proof_available: Boolean(row.delivery_proof_url),
  delivery_proof_at: row.delivery_proof_at || null,
  food_items: Array.isArray(row.food_items) ? row.food_items : [],
  food_subtotal: Number(row.food_subtotal || 0),
  coupon_code: row.coupon_code || '',
  coupon_discount: Number(row.coupon_discount || 0),
  client: row.client,
  status: row.status,
  timestamp_started: row.timestamp_started,
  timestamp_completed: row.timestamp_completed,
  pickupStartAt: row.pickup_start_at,
  pickupCompletedAt: row.pickup_completed_at,
  deliveryStartAt: row.delivery_start_at,
  deliveryCompletedAt: row.delivery_completed_at,
  cancelledAt: row.cancelled_at,
  cancelledBy: row.cancelled_by,
  cancelReason: row.cancel_reason,
  valor_motorista: Number(row.valor_motorista || 0),
  valor_empresa: Number(row.valor_empresa || 0),
  payment_method: row.payment_method || 'cash',
  payment_status: row.payment_status || PAYMENT_STATUS.UNPAID,
  payment_confirmed_amount: row.payment_confirmed_amount != null ? Number(row.payment_confirmed_amount) : null,
  payment_confirmation_requested_at: row.payment_confirmation_requested_at,
  payment_confirmed_at: row.payment_confirmed_at,
  driver_delivery_notes: row.driver_delivery_notes || '',
  createdAt: row.created_at,
  updatedAt: row.updated_at
}) : null;

const fromOrderMessage = (row: AnyRecord) => row ? ({
  _id: row.id,
  id: row.id,
  orderId: row.order_id,
  order_id: row.order_id,
  senderRole: row.sender_role,
  sender_role: row.sender_role,
  senderId: row.sender_id,
  sender_id: row.sender_id,
  senderName: row.sender_name || '',
  sender_name: row.sender_name || '',
  body: row.body || '',
  messageType: row.message_type || 'text',
  message_type: row.message_type || 'text',
  conversationId: row.conversation_id || null,
  conversation_id: row.conversation_id || null,
  channelType: row.channel_type || MESSAGE_CHANNEL.SYSTEM,
  channel_type: row.channel_type || MESSAGE_CHANNEL.SYSTEM,
  visibleToRoles: Array.isArray(row.visible_to_roles) ? row.visible_to_roles : [],
  visible_to_roles: Array.isArray(row.visible_to_roles) ? row.visible_to_roles : [],
  metadata: row.metadata || {},
  createdAt: row.created_at,
  updatedAt: row.updated_at
}) : null;

const fromExpense = (row: AnyRecord) => row ? ({
  _id: row.id,
  id: row.id,
  category: row.category,
  description: row.description,
  amount: Number(row.amount || 0),
  date: row.date,
  employee: row.employee,
  created_by: row.created_by,
  createdAt: row.created_at,
  updatedAt: row.updated_at
}) : null;

const fromCost = (row: AnyRecord) => row ? ({
  _id: row.id,
  id: row.id,
  category: row.category,
  description: row.description || '',
  amount: Number(row.amount || 0),
  date: row.date,
  createdBy: row.created_by,
  assignedUser: row.assigned_user,
  assignedClient: row.assigned_client,
  assignedVehicle: row.assigned_vehicle,
  createdAt: row.created_at,
  updatedAt: row.updated_at
}) : null;

const fromVehicle = (row: AnyRecord) => row ? ({
  _id: row.id,
  id: row.id,
  plate: row.plate || '',
  brand: row.brand || '',
  model: row.model || '',
  type: row.type || 'mota',
  status: row.status || 'ativo',
  notes: row.notes || '',
  created_by: row.created_by,
  createdAt: row.created_at,
  updatedAt: row.updated_at
}) : null;

const fromRestaurant = (row: AnyRecord) => row ? ({
  _id: row.id,
  id: row.id,
  name: row.name || '',
  email: row.email || '',
  phone: row.phone || '',
  address_text: row.address_text || '',
  address_coords: row.address_coords || null,
  logo_url: row.logo_url || '',
  cover_url: row.cover_url || '',
  operational_note: row.operational_note || '',
  is_open: row.is_open !== false,
  whatsapp: row.whatsapp || '',
  description: row.description || '',
  opening_hours: row.opening_hours || '',
  delivery_zones: Array.isArray(row.delivery_zones) ? row.delivery_zones : [],
  delivery_radius_km: Number(row.delivery_radius_km || 0),
  delivery_fee: Number(row.delivery_fee || 0),
  min_order_amount: Number(row.min_order_amount || 0),
  coupons: Array.isArray(row.coupons) ? row.coupons : [],
  business_type: row.business_type || 'restaurant',
  delivery_time: row.delivery_time || '',
  status: row.status || 'active',
  createdAt: row.created_at,
  updatedAt: row.updated_at
}) : null;

const fromPartner = (row: AnyRecord) => row ? ({
  _id: row.id,
  id: row.id,
  entity_type: 'partner',
  entity_id: row.id,
  restaurant_id: row.restaurant_id || null,
  name: row.name || '',
  partner_type: row.partner_type || 'other',
  summary: row.summary || '',
  products_summary: row.products_summary || '',
  phone: row.phone || '',
  whatsapp: row.whatsapp || '',
  email: row.email || '',
  address_text: row.address_text || '',
  address_coords: row.address_coords || null,
  logo_url: row.logo_url || '',
  cover_url: row.cover_url || '',
  opening_hours: row.opening_hours || '',
  status: row.status || 'pending',
  verified: row.status === 'active',
  createdAt: row.created_at,
  updatedAt: row.updated_at
}) : null;

const fromMenuItem = (row: AnyRecord) => row ? ({
  _id: row.id,
  id: row.id,
  restaurant_id: row.restaurant_id,
  name: row.name || '',
  category: row.category || 'Geral',
  description: row.description || '',
  price: Number(row.price || 0),
  image_url: row.image_url || '',
  available: row.available !== false,
  prep_time_min: row.prep_time_min || null,
  details: row.details || '',
  ingredients: row.ingredients || '',
  tags: Array.isArray(row.tags) ? row.tags : [],
  sort_order: Number(row.sort_order || 0),
  unavailable_reason: row.unavailable_reason || '',
  unavailable_until: row.unavailable_until || null,
  createdAt: row.created_at,
  updatedAt: row.updated_at
}) : null;

const fromTrip = (row: AnyRecord) => row ? ({
  _id: row.id,
  id: row.id,
  driver: row.driver,
  order: row.order_id,
  type: row.type,
  status: row.status,
  startedAt: row.started_at,
  finishedAt: row.finished_at,
  origin: row.origin,
  destination: row.destination,
  positions: row.positions || [],
  metrics: row.metrics || { distance: 0, duration: 0, avgSpeed: 0, maxSpeed: 0 },
  notes: row.notes || '',
  createdAt: row.created_at,
  updatedAt: row.updated_at
}) : null;

const fromNotification = (row: AnyRecord) => row ? ({
  _id: row.id,
  id: row.id,
  scope: row.scope || 'admin',
  type: row.type || 'info',
  title: row.title || 'Notificação',
  message: row.message || '',
  orderId: row.order_id || null,
  orderCode: row.order_code || '',
  verificationCode: row.verification_code || '',
  payload: row.payload || {},
  readAt: row.read_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at
}) : null;

const fromSupportThread = (row: AnyRecord) => row ? ({
  _id: row.id,
  id: row.id,
  subject: row.subject || '',
  category: row.category || 'general',
  status: row.status || 'open',
  priority: row.priority || 'normal',
  requesterRole: row.requester_role,
  requesterId: row.requester_id,
  requesterName: row.requester_name || '',
  orderId: row.order_id || null,
  assignedAdminId: row.assigned_admin_id || null,
  lastMessageAt: row.last_message_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at
}) : null;

const fromSupportMessage = (row: AnyRecord) => row ? ({
  _id: row.id,
  id: row.id,
  threadId: row.thread_id,
  senderRole: row.sender_role,
  senderId: row.sender_id,
  senderName: row.sender_name || '',
  body: row.body || '',
  createdAt: row.created_at,
  updatedAt: row.updated_at
}) : null;

const selectOne = async (table: string, column: string, value: unknown) => {
  const { data, error } = await supabase.from(table).select('*').eq(column, value).maybeSingle();
  if (error) throw new HttpError(500, error.message);
  return data;
};

const selectMany = async (table: string) => {
  const { data, error } = await supabase.from(table).select('*');
  if (error) throw new HttpError(500, error.message);
  return data || [];
};

const insertRow = async (table: string, payload: AnyRecord) => {
  const row = { id: payload.id || generateId(), ...payload };
  const { data, error } = await supabase.from(table).insert(row).select('*').single();
  if (error) throw new HttpError(400, error.message);
  return data;
};

const updateRow = async (table: string, id: string, payload: AnyRecord) => {
  const { data, error } = await supabase
    .from(table)
    .update({ ...payload, updated_at: nowIso() })
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) throw new HttpError(400, error.message);
  if (!data) throw new HttpError(404, 'Registo não encontrado.');
  return data;
};

const deleteRow = async (table: string, id: string) => {
  const { data, error } = await supabase.from(table).delete().eq('id', id).select('*').maybeSingle();
  if (error) throw new HttpError(400, error.message);
  return data;
};

const countRows = async (table: string, mutator?: (q: any) => any) => {
  let query = supabase.from(table).select('id', { count: 'exact', head: true });
  if (mutator) query = mutator(query);
  const { count, error } = await query;
  if (error) throw new HttpError(500, error.message);
  return count || 0;
};

const getDriverProfileByUser = async (userId: string) => selectOne('driver_profiles', 'user_id', userId);

const generateRestaurantToken = async (restaurant: AnyRecord) => {
  const key = await makeJwtKey();
  return create(
    { alg: 'HS256', typ: 'JWT' },
    {
      restaurant: {
        id: restaurant.id,
        name: restaurant.name,
        email: restaurant.email
      },
      scope: 'restaurant',
      exp: getNumericDate(JWT_DAYS * 24 * 60 * 60)
    },
    key
  );
};

const generateClientToken = async (client: AnyRecord) => {
  const key = await makeJwtKey();
  return create(
    { alg: 'HS256', typ: 'JWT' },
    {
      client: {
        id: client.id,
        name: client.nome,
        email: client.email || '',
        phone: client.telefone || ''
      },
      scope: 'client',
      exp: getNumericDate(JWT_DAYS * 24 * 60 * 60)
    },
    key
  );
};

const optionalClient = async (req: Request) => {
  const token = readToken(req);
  if (!token) return null;
  try {
    const decoded = await verifyToken(token);
    const clientId = decoded?.client?.id;
    if (!clientId || !isValidId(clientId)) return null;
    const client = await selectOne('clients', 'id', clientId);
    if (!client || client.account_status !== 'active' || client.deleted_at) return null;
    return client;
  } catch (_error) {
    return null;
  }
};

const requireClient = async (req: Request) => {
  const client = await optionalClient(req);
  if (!client) throw new HttpError(401, 'Sessão do cliente inválida ou expirada.');
  return client;
};

const requireRestaurant = async (req: Request) => {
  const token = readToken(req);
  if (!token) throw new HttpError(401, 'Sessão do restaurante em falta.');
  const decoded = await verifyToken(token);
  const restaurantId = decoded?.restaurant?.id;
  if (!restaurantId || !isValidId(restaurantId)) throw new HttpError(401, 'Sessão do restaurante inválida ou expirada.');
  const restaurant = await selectOne('restaurants', 'id', restaurantId);
  if (!restaurant || restaurant.status !== 'active') throw new HttpError(401, 'Restaurante inexistente ou inactivo.');
  return restaurant;
};

const orderBelongsToRestaurant = (order: AnyRecord, restaurant: AnyRecord) => {
  if (String(order.restaurant_id || '') === String(restaurant.id || '')) return true;
  const restaurantPhone = String(restaurant.phone || '').replace(/\D/g, '');
  const orderPhone = String(order.pickup_contact_phone || '').replace(/\D/g, '');
  const samePhone = Boolean(restaurantPhone && orderPhone && restaurantPhone === orderPhone);
  const sameName = String(order.pickup_contact_name || '').trim().toLowerCase() === String(restaurant.name || '').trim().toLowerCase();
  return samePhone || sameName;
};

const defaultMessageChannel = (role: string) => {
  if (role === 'client' || role === 'driver') return MESSAGE_CHANNEL.CLIENT_DRIVER;
  if (role === 'restaurant') return MESSAGE_CHANNEL.DRIVER_PARTNER;
  return MESSAGE_CHANNEL.SYSTEM;
};

const defaultMessageVisibility = (channelType: string) => {
  if (channelType === MESSAGE_CHANNEL.CLIENT_DRIVER) return ['client', 'driver', 'admin'];
  if (channelType === MESSAGE_CHANNEL.DRIVER_PARTNER) return ['driver', 'restaurant', 'admin'];
  if (channelType === MESSAGE_CHANNEL.SUPPORT) return ['admin'];
  return ['client', 'driver', 'restaurant', 'admin'];
};

const ensureOrderConversation = async (orderId: string, channelType: string) => {
  const channel = MESSAGE_CHANNELS.has(channelType) ? channelType : MESSAGE_CHANNEL.SYSTEM;
  const { data: existing, error: selectError } = await supabase
    .from('conversations')
    .select('id')
    .eq('order_id', orderId)
    .eq('channel_type', channel)
    .maybeSingle();
  if (selectError) throw new HttpError(500, selectError.message);
  if (existing?.id) return existing.id;
  const { data, error } = await supabase
    .from('conversations')
    .insert({ order_id: orderId, scope: 'order', channel_type: channel })
    .select('id')
    .single();
  if (error) {
    const { data: concurrent } = await supabase
      .from('conversations')
      .select('id')
      .eq('order_id', orderId)
      .eq('channel_type', channel)
      .maybeSingle();
    if (concurrent?.id) return concurrent.id;
    throw new HttpError(500, error.message);
  }
  return data.id;
};

const listOrderMessages = async (
  orderId: string,
  viewerRole: string,
  requestedChannel = '',
  includeSystem = true
) => {
  const channel = MESSAGE_CHANNELS.has(requestedChannel) ? requestedChannel : '';
  let query = supabase
    .from('order_messages')
    .select('*')
    .eq('order_id', orderId)
    .contains('visible_to_roles', [viewerRole])
    .order('created_at', { ascending: true })
    .limit(500);
  if (channel) {
    query = includeSystem && channel !== MESSAGE_CHANNEL.SYSTEM
      ? query.in('channel_type', [channel, MESSAGE_CHANNEL.SYSTEM])
      : query.eq('channel_type', channel);
  }
  const { data, error } = await query;
  if (error) throw new HttpError(500, error.message);
  return (data || []).map(fromOrderMessage);
};

const createOrderMessage = async (
  orderId: string,
  role: string,
  senderId: string,
  senderName: string,
  body: string,
  messageType = 'text',
  metadata: AnyRecord = {},
  requestedChannel = '',
  requestedVisibility: string[] | null = null
) => {
  const value = String(body || '').trim().slice(0, 2000);
  if (!value) throw new HttpError(400, 'Escreva uma mensagem.');
  const channelType = MESSAGE_CHANNELS.has(requestedChannel) ? requestedChannel : defaultMessageChannel(role);
  const visibleToRoles = Array.isArray(requestedVisibility) && requestedVisibility.length
    ? [...new Set(requestedVisibility.filter((entry) => ['client', 'driver', 'restaurant', 'admin'].includes(entry)))]
    : defaultMessageVisibility(channelType);
  const conversationId = await ensureOrderConversation(orderId, channelType);
  return insertRow('order_messages', {
    order_id: orderId,
    conversation_id: conversationId,
    channel_type: channelType,
    visible_to_roles: visibleToRoles,
    sender_role: role,
    sender_id: senderId || role,
    sender_name: String(senderName || role).slice(0, 120),
    body: value,
    message_type: messageType,
    metadata
  });
};

const recordAudit = async (
  actorRole: string,
  actorId: string | null,
  action: string,
  entityType: string,
  entityId: string,
  payload: AnyRecord = {}
) => insertRow('audit_logs', {
  actor_role: actorRole || 'system',
  actor_id: actorId || null,
  action,
  entity_type: entityType,
  entity_id: entityId,
  payload
});

const recordOrderStatusEvent = async (
  orderId: string,
  status: string,
  label: string,
  actorRole: string,
  actorId: string,
  actorName: string,
  note = '',
  metadata: AnyRecord = {}
) => insertRow('order_status_events', {
  order_id: orderId,
  status,
  label,
  actor_type: actorRole,
  actor_id: actorId || '',
  actor_name: actorName || actorRole,
  note: String(note || '').slice(0, 1000),
  metadata
});

const enrichDriverUser = async (userRow: AnyRecord) => {
  const user = fromUser(userRow);
  const profileRow = await getDriverProfileByUser(userRow.id);
  user.profile = fromProfile(profileRow);
  if (profileRow?.license_photo_url) {
    user.profile.license_photo_url = await signPrivateMedia(profileRow.license_photo_url);
  }
  return user;
};

const ownDriverProfile = async (profileRow: AnyRecord, totalDeliveries: number) => {
  const profile: AnyRecord = { ...fromProfile(profileRow), total_deliveries: totalDeliveries };
  const reference = String(profileRow?.license_photo_url || '');
  if (reference) {
    profile.license_photo_url = await signPrivateMedia(reference);
    profile.license_photo_ref = reference.startsWith('private:') ? reference : '';
  } else {
    profile.license_photo_ref = '';
  }
  return profile;
};

const enrichProfile = async (profileRow: AnyRecord, withUser = true) => {
  const profile = fromProfile(profileRow);
  if (profile && withUser && profileRow.user_id) profile.user = fromUser(await selectOne('users', 'id', profileRow.user_id));
  return profile;
};

const enrichOrder = async (row: AnyRecord) => {
  const order = fromOrder(row);
  if (!order) return null;

  if (row.created_by_admin) order.created_by_admin = fromUser(await selectOne('users', 'id', row.created_by_admin));
  if (row.client) order.client = fromClient(await selectOne('clients', 'id', row.client));
  if (row.cancelled_by) order.cancelledBy = fromUser(await selectOne('users', 'id', row.cancelled_by));
  if (row.assigned_to_driver) {
    const profileRow = await selectOne('driver_profiles', 'id', row.assigned_to_driver);
    order.assigned_to_driver = await enrichProfile(profileRow, true);
  }
  return order;
};

const enrichCost = async (row: AnyRecord) => {
  const cost = fromCost(row);
  if (!cost) return null;
  if (row.assigned_user) cost.assignedUser = fromUser(await selectOne('users', 'id', row.assigned_user));
  if (row.assigned_client) cost.assignedClient = fromClient(await selectOne('clients', 'id', row.assigned_client));
  if (row.assigned_vehicle) cost.assignedVehicle = fromVehicle(await selectOne('vehicles', 'id', row.assigned_vehicle));
  return cost;
};

const broadcast = async (channelName: string, event: string, payload: AnyRecord) => {
  try {
    const channel = supabase.channel(channelName, { config: { broadcast: { self: false } } });
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 1200);
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    await channel.send({ type: 'broadcast', event, payload });
    await supabase.removeChannel(channel);
  } catch (error) {
    console.warn(`[trago-edge] Falha ao emitir Realtime ${channelName}:${event}`, error);
  }
};

const broadcastAdmin = (event: string, payload: AnyRecord = {}) => broadcast(ADMIN_ROOM, event, payload);
const broadcastDriver = (userId: string, event: string, payload: AnyRecord = {}) => broadcast(`driver:${userId}`, event, payload);
const broadcastOrder = async (orderId: string, event: string, payload: AnyRecord = {}) => {
  const order = orderId ? await selectOne('orders', 'id', orderId) : null;
  const accessHash = String(order?.public_access_token_hash || '').trim();
  if (!order?.id || !accessHash) return;
  await broadcast(`order:${order.id}:${accessHash}`, event, { orderId: order.id, ...payload });
};

const shortOrderCode = (orderId: unknown) => {
  const raw = String(orderId || '').trim();
  return raw ? `#${raw.slice(-6).toUpperCase()}` : '—';
};

const createAdminNotification = async ({
  dedupeKey,
  type = 'info',
  title = 'Notificação',
  message = '',
  order = null,
  orderId = null,
  orderCode = '',
  verificationCode = '',
  payload = {},
  createdAt = null
}: AnyRecord) => {
  try {
    const effectiveOrderId = orderId || order?.id || null;
    const record = {
      id: generateId(),
      scope: 'admin',
      dedupe_key: String(dedupeKey || `${type}:${effectiveOrderId || Date.now()}`).slice(0, 180),
      type: String(type || 'info').slice(0, 40),
      title: String(title || 'Notificação').slice(0, 120),
      message: String(message || '').slice(0, 500),
      order_id: effectiveOrderId,
      order_code: orderCode || shortOrderCode(effectiveOrderId),
      verification_code: verificationCode || order?.verification_code || '',
      payload: payload || {},
      created_at: createdAt || nowIso()
    };
    const { error } = await supabase
      .from('system_notifications')
      .upsert(record, { onConflict: 'dedupe_key', ignoreDuplicates: true });
    if (error) console.warn('[trago-edge] Notificação não persistida:', error.message);
  } catch (error) {
    console.warn('[trago-edge] Falha ao persistir notificação:', error);
  }
};

const createClientNotification = async (order: AnyRecord, type: string, title: string, message: string, payload: AnyRecord = {}) => {
  if (!order?.client) return null;
  try {
    return await insertRow('client_notifications', {
      client_id: order.client,
      order_id: order.id || null,
      type: String(type || 'info').slice(0, 40),
      title: String(title || 'Actualização do pedido').slice(0, 120),
      message: String(message || '').slice(0, 500),
      payload: payload || {}
    });
  } catch (error) {
    console.warn('[trago-edge] Notificação do cliente não persistida:', error);
    return null;
  }
};

const syncOperationalNotifications = async () => {
  try {
    const { data: pendingOrders } = await supabase
      .from('orders')
      .select('*')
      .eq('status', ORDER_STATUS.PENDING)
      .order('created_at', { ascending: false })
      .limit(25);

    for (const order of pendingOrders || []) {
      await createAdminNotification({
        dedupeKey: `new_order:${order.id}`,
        type: 'order',
        title: 'Novo pedido recebido',
        message: `Pedido ${shortOrderCode(order.id)} · ${order.client_name || 'Cliente'} aguarda atribuição.`,
        order,
        payload: { clientName: order.client_name, amount: Number(order.price || 0), paymentMethod: order.payment_method },
        createdAt: order.created_at || nowIso()
      });
    }

    const { data: paymentOrders } = await supabase
      .from('orders')
      .select('*')
      .eq('payment_status', PAYMENT_STATUS.AWAITING_DRIVER_CONFIRMATION)
      .order('payment_confirmation_requested_at', { ascending: false, nullsFirst: false })
      .limit(50);

    for (const order of paymentOrders || []) {
      await createAdminNotification({
        dedupeKey: `payment_pending:${order.id}`,
        type: 'payment',
        title: 'Pagamento por confirmar',
        message: `Pedido ${shortOrderCode(order.id)} · Código ${order.verification_code || '—'} · confirmar ${Number(order.price || 0).toFixed(2)} MZN.`,
        order,
        payload: { clientName: order.client_name, amount: Number(order.price || 0), paymentMethod: order.payment_method },
        createdAt: order.payment_confirmation_requested_at || order.updated_at || nowIso()
      });
    }
  } catch (error) {
    console.warn('[trago-edge] Falha ao sincronizar notificações operacionais:', error);
  }
};

const buildLocationPayload = (profileRow: AnyRecord, userRow: AnyRecord) => {
  const loc = profileRow.last_location || {};
  return {
    driverId: profileRow.id,
    driverUserId: profileRow.user_id,
    driverName: userRow?.nome || 'Motorista',
    telefone: userRow?.telefone,
    status: profileRow.status || DRIVER_STATUS.ONLINE_FREE,
    lat: Number(loc.lat),
    lng: Number(loc.lng),
    accuracy: loc.accuracy,
    speed: loc.speed,
    updatedAt: loc.updatedAt
  };
};

const normalizeCoordinates = (lat: unknown, lng: unknown) => {
  if (lat === undefined || lng === undefined || lat === null || lng === null || lat === '' || lng === '') return null;
  const parsedLat = Number(lat);
  const parsedLng = Number(lng);
  if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLng)) return null;
  return { lat: parsedLat, lng: parsedLng };
};

const isValidCoordinate = (coord: AnyRecord | null | undefined) => Boolean(coord && Number.isFinite(Number(coord.lat)) && Number.isFinite(Number(coord.lng)));

const calculateDeliveryFee = (distanceKm: number) => {
  const distance = Math.max(0, Number(distanceKm) || 0);
  if (distance <= ROUTE_PRICING_POLICY.baseDistanceKm) return ROUTE_PRICING_POLICY.baseFeeMzn;
  const extraKm = Math.ceil(distance - ROUTE_PRICING_POLICY.baseDistanceKm);
  return ROUTE_PRICING_POLICY.baseFeeMzn + (extraKm * ROUTE_PRICING_POLICY.extraKmFeeMzn);
};

const haversineKm = (origin: AnyRecord, destination: AnyRecord) => {
  const R = 6371;
  const dLat = (Number(destination.lat) - Number(origin.lat)) * Math.PI / 180;
  const dLng = (Number(destination.lng) - Number(origin.lng)) * Math.PI / 180;
  const lat1 = Number(origin.lat) * Math.PI / 180;
  const lat2 = Number(destination.lat) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const quoteWithOpenRouteService = async (origin: AnyRecord, destination: AnyRecord) => {
  if (!TRAGO_ORS_API_KEY) return null;
  const url = new URL('https://api.openrouteservice.org/v2/directions/driving-car');
  url.searchParams.set('api_key', TRAGO_ORS_API_KEY);
  // OpenRouteService usa longitude,latitude.
  url.searchParams.set('start', `${Number(origin.lng)},${Number(origin.lat)}`);
  url.searchParams.set('end', `${Number(destination.lng)},${Number(destination.lat)}`);

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json, application/geo+json' }
  });
  if (!response.ok) return null;

  const data = await response.json();
  const summary = data?.features?.[0]?.properties?.summary;
  if (!summary || !Number.isFinite(Number(summary.distance))) return null;

  return {
    distance_km: Number(summary.distance) / 1000,
    duration_min: Number.isFinite(Number(summary.duration)) ? Math.max(1, Math.round(Number(summary.duration) / 60)) : null,
    source: 'openrouteservice'
  };
};


const routeWithOpenRouteService = async (origin: AnyRecord, destination: AnyRecord) => {
  if (!TRAGO_ORS_API_KEY) return null;
  const url = new URL('https://api.openrouteservice.org/v2/directions/driving-car');
  url.searchParams.set('api_key', TRAGO_ORS_API_KEY);
  url.searchParams.set('start', `${Number(origin.lng)},${Number(origin.lat)}`);
  url.searchParams.set('end', `${Number(destination.lng)},${Number(destination.lat)}`);

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json, application/geo+json' }
  });
  if (!response.ok) return null;

  const data = await response.json();
  const feature = data?.features?.[0];
  const summary = feature?.properties?.summary;
  const geometry = feature?.geometry;
  if (!summary || !geometry || !Array.isArray(geometry.coordinates)) return null;

  return {
    geometry,
    distance_km: Number(summary.distance) / 1000,
    duration_min: Number.isFinite(Number(summary.duration)) ? Math.max(1, Math.round(Number(summary.duration) / 60)) : null,
    source: 'openrouteservice'
  };
};

const buildRouteGeometry = async (origin: AnyRecord, destination: AnyRecord) => {
  if (!isValidCoordinate(origin) || !isValidCoordinate(destination)) {
    throw new HttpError(400, 'Coordenadas de recolha e entrega são obrigatórias.');
  }

  let route: AnyRecord | null = null;
  try {
    route = await routeWithOpenRouteService(origin, destination);
  } catch (_error) {
    route = null;
  }

  if (!route) {
    const distanceKm = haversineKm(origin, destination);
    route = {
      geometry: {
        type: 'LineString',
        coordinates: [
          [Number(origin.lng), Number(origin.lat)],
          [Number(destination.lng), Number(destination.lat)]
        ]
      },
      distance_km: distanceKm,
      duration_min: Math.max(1, Math.round((distanceKm / 35) * 60)),
      source: 'haversine_fallback'
    };
  }

  return {
    origin,
    destination,
    geometry: route.geometry,
    distance_km: Number(Number(route.distance_km).toFixed(2)),
    duration_min: route.duration_min,
    delivery_fee: calculateDeliveryFee(Number(route.distance_km)),
    source: route.source
  };
};
const buildRouteQuote = async (origin: AnyRecord, destination: AnyRecord) => {
  if (!isValidCoordinate(origin) || !isValidCoordinate(destination)) {
    throw new HttpError(400, 'Coordenadas de recolha e entrega são obrigatórias.');
  }
  let quote: AnyRecord | null = null;
  try {
    quote = await quoteWithOpenRouteService(origin, destination);
  } catch (_error) {
    quote = null;
  }
  if (!quote) {
    const distanceKm = haversineKm(origin, destination);
    quote = {
      distance_km: distanceKm,
      duration_min: Math.max(1, Math.round((distanceKm / 35) * 60)),
      source: 'haversine_fallback'
    };
  }
  const deliveryFee = calculateDeliveryFee(Number(quote.distance_km));
  return {
    distance_km: Number(Number(quote.distance_km).toFixed(2)),
    duration_min: quote.duration_min,
    delivery_fee: Number(Number(deliveryFee).toFixed(2)),
    source: quote.source,
    policy: ROUTE_PRICING_POLICY
  };
};

const getDistanceFromLatLonInKm = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
};

const publicAssignedDriver = async (profile: AnyRecord | null, distanceKm = 0, presence: AnyRecord | null = null) => {
  if (!profile) return null;
  const user = await selectOne('users', 'id', profile.user_id);
  const vehicle = profile.vehicle_id ? await selectOne('vehicles', 'id', profile.vehicle_id) : null;
  const operationalLocation = presence && isValidCoordinate({ lat: presence.latitude, lng: presence.longitude })
    ? {
        lat: Number(presence.latitude),
        lng: Number(presence.longitude),
        accuracy: Number(presence.accuracy || 0) || null,
        speed: Number(presence.speed || 0) || null,
        heading: Number(presence.heading || 0) || null,
        updated_at: presence.location_updated_at || null
      }
    : null;
  return {
    id: profile.id,
    name: user?.nome || 'Motorista TraGo',
    phone: user?.telefone || '',
    avatar_url: profile.avatar_url || '',
    rating: Number(profile.rating || 4.9),
    verified: profile.verified === true,
    distance_km: Number(Number(distanceKm || 0).toFixed(2)),
    online: presence ? presence.is_online === true : profile.status !== DRIVER_STATUS.OFFLINE,
    available: presence ? presence.is_available === true : profile.status === DRIVER_STATUS.ONLINE_FREE,
    last_seen_at: presence?.last_seen_at || null,
    location: operationalLocation || (isValidCoordinate(profile.last_location)
      ? {
          lat: Number(profile.last_location.lat),
          lng: Number(profile.last_location.lng),
          accuracy: Number(profile.last_location.accuracy || 0) || null,
          updated_at: profile.last_location.updatedAt || profile.last_location.updated_at || null
        }
      : null),
    vehicle: {
      type: profile.vehicle_type || vehicle?.type || 'mota',
      plate: profile.vehicle_plate || vehicle?.plate || '',
      brand: profile.vehicle_brand || vehicle?.brand || '',
      model: profile.vehicle_model || vehicle?.model || '',
      color: profile.vehicle_color || '',
      photo_url: profile.vehicle_photo_url || ''
    }
  };
};

const generateVerificationCode = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
};

const generatePasswordResetCode = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  const value = ((bytes[0] << 24) >>> 0) + (bytes[1] << 16) + (bytes[2] << 8) + bytes[3];
  return String(value % 1000000).padStart(6, '0');
};

const escapeHtml = (value: unknown) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

const sendPasswordResetEmail = async (email: string, code: string, role: Role) => {
  if (!RESEND_API_KEY) throw new HttpError(503, 'Envio de email não configurado. Defina RESEND_API_KEY no ambiente da Supabase Function.');

  const roleLabel = role === 'driver' ? 'motorista' : 'admin';
  const subject = 'Código de restauração - Trago Delivery';
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827;max-width:520px;margin:0 auto;padding:24px;border:1px solid #e5e7eb">
      <h2 style="margin:0 0 12px;font-size:20px;color:#111827">Restaurar password</h2>
      <p>Recebemos um pedido para restaurar a password da sua conta de ${escapeHtml(roleLabel)} no Trago Delivery.</p>
      <p style="margin:18px 0 6px">O seu código é:</p>
      <div style="font-size:28px;font-weight:800;letter-spacing:6px;background:#f3f4f6;padding:14px 18px;text-align:center;border:1px solid #d1d5db">${escapeHtml(code)}</div>
      <p>Este código expira em ${PASSWORD_RESET_TTL_MINUTES} minutos.</p>
      <p style="color:#6b7280;font-size:13px">Se não fez este pedido, ignore este email.</p>
    </div>`;
  const text = `Código de restauração - Trago Delivery\n\nO seu código é: ${code}\n\nEste código expira em ${PASSWORD_RESET_TTL_MINUTES} minutos. Se não fez este pedido, ignore este email.`;

  const payload: AnyRecord = {
    from: RESET_EMAIL_FROM,
    to: [email],
    subject,
    html,
    text
  };
  if (RESET_EMAIL_REPLY_TO) payload.reply_to = RESET_EMAIL_REPLY_TO;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    console.error('[trago-edge] Falha Resend:', detail);
    throw new HttpError(502, 'Não foi possível enviar o email de restauração.');
  }
};

const uploadOrderImage = async (file: File | null) => {
  if (!file || file.size === 0) return null;
  if (file.size > MAX_IMAGE_BYTES) throw new HttpError(400, 'Imagem acima do limite permitido.');
  if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.type)) {
    throw new HttpError(400, 'Formato de imagem não suportado.');
  }

  const safeName = file.name.replace(/[^a-z0-9._-]/gi, '_').toLowerCase();
  const path = `orders/${Date.now()}-${generateId()}-${safeName}`;
  const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(path, file, {
    cacheControl: '3600',
    contentType: file.type,
    upsert: false
  });
  if (error) throw new HttpError(500, `Falha ao enviar imagem para Supabase Storage: ${error.message}`);

  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  return data.publicUrl;
};

const resolveMediaActor = async (req: Request) => {
  const token = readToken(req);
  if (!token) throw new HttpError(401, 'Autenticação necessária para carregar ficheiros.');
  let decoded: AnyRecord;
  try {
    decoded = await verifyToken(token);
  } catch (_error) {
    throw new HttpError(401, 'Sessão inválida ou expirada.');
  }

  if (decoded?.user?.id) {
    const user = await selectOne('users', 'id', decoded.user.id);
    if (!user || !['admin', 'driver', 'manager'].includes(user.role)) throw new HttpError(403, 'Perfil sem permissão para carregar ficheiros.');
    return { role: user.role, id: user.id };
  }
  if (decoded?.restaurant?.id) {
    const restaurant = await selectOne('restaurants', 'id', decoded.restaurant.id);
    if (!restaurant || restaurant.status !== 'active') throw new HttpError(401, 'Restaurante inexistente ou inactivo.');
    return { role: 'restaurant', id: restaurant.id };
  }
  if (decoded?.client?.id) {
    const client = await selectOne('clients', 'id', decoded.client.id);
    if (!client || client.account_status !== 'active' || client.deleted_at) throw new HttpError(401, 'Conta de cliente inactiva.');
    return { role: 'client', id: client.id };
  }
  throw new HttpError(403, 'Perfil sem permissão para carregar ficheiros.');
};

const signPrivateMedia = async (value: unknown, expiresIn = 900) => {
  const reference = String(value || '').trim();
  if (!reference) return '';
  if (!reference.startsWith('private:')) return reference;
  const objectPath = reference.slice('private:'.length);
  const { data, error } = await supabase.storage.from(PRIVATE_MEDIA_BUCKET).createSignedUrl(objectPath, expiresIn);
  if (error || !data?.signedUrl) throw new HttpError(500, 'Não foi possível autorizar o acesso ao ficheiro privado.');
  return data.signedUrl;
};

const uploadMediaImage = async (file: File, actor: AnyRecord, category: string) => {
  if (!file || file.size === 0) throw new HttpError(400, 'Seleccione uma imagem.');
  if (file.size > MAX_IMAGE_BYTES) throw new HttpError(400, 'Imagem acima do limite de 5 MB.');
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new HttpError(400, 'Use uma imagem JPG, PNG ou WebP.');
  }

  const allowedCategories = new Set(['avatar', 'vehicle', 'license', 'restaurant-logo', 'restaurant-cover', 'product', 'delivery-proof']);
  const safeCategory = allowedCategories.has(category) ? category : 'product';
  const categoriesByRole: Record<string, string[]> = {
    client: ['avatar'],
    driver: ['avatar', 'vehicle', 'license', 'delivery-proof'],
    restaurant: ['restaurant-logo', 'restaurant-cover', 'product'],
    admin: [...allowedCategories],
    manager: [...allowedCategories]
  };
  if (!categoriesByRole[String(actor.role)]?.includes(safeCategory)) {
    throw new HttpError(403, 'Este perfil não pode carregar esta categoria de ficheiro.');
  }
  const isPrivate = ['license', 'delivery-proof'].includes(safeCategory);
  const bucket = isPrivate ? PRIVATE_MEDIA_BUCKET : MEDIA_BUCKET;
  const extension = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as AnyRecord)[file.type] || 'jpg';
  const objectPath = `${actor.role}/${actor.id}/${safeCategory}/${Date.now()}-${generateId()}.${extension}`;
  const { error } = await supabase.storage.from(bucket).upload(objectPath, file, {
    cacheControl: '86400',
    contentType: file.type,
    upsert: false
  });
  if (error) throw new HttpError(500, `Falha ao guardar imagem: ${error.message}`);
  if (isPrivate) {
    const storageRef = `private:${objectPath}`;
    return {
      url: await signPrivateMedia(storageRef),
      storage_ref: storageRef,
      path: objectPath,
      category: safeCategory,
      private: true
    };
  }
  const { data } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(objectPath);
  return {
    url: data.publicUrl,
    storage_ref: data.publicUrl,
    path: objectPath,
    category: safeCategory,
    private: false
  };
};

const requireOrderProofActor = async (req: Request, order: AnyRecord) => {
  const token = readToken(req);
  if (!token) throw new HttpError(401, 'Autenticação necessária.');
  let decoded: AnyRecord;
  try {
    decoded = await verifyToken(token);
  } catch (_error) {
    throw new HttpError(401, 'Sessão inválida ou expirada.');
  }

  if (decoded?.client?.id && String(order.client || '') === String(decoded.client.id)) return;
  if (decoded?.restaurant?.id && String(order.restaurant_id || '') === String(decoded.restaurant.id)) return;
  if (decoded?.user?.id) {
    const user = await selectOne('users', 'id', decoded.user.id);
    if (user && ['admin', 'manager'].includes(user.role)) return;
    if (user?.role === 'driver') {
      const profile = await getDriverProfileByUser(user.id);
      if (profile && String(order.assigned_to_driver || '') === String(profile.id)) return;
    }
  }
  throw new HttpError(403, 'Este comprovativo não pertence à sua operação.');
};

const routeMedia = async (req: Request, path: string, method: string) => {
  if (path === '/api/media/upload' && method === 'POST') {
    const actor = await resolveMediaActor(req);
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) throw new HttpError(400, 'Ficheiro de imagem em falta.');
    const uploaded = await uploadMediaImage(file, actor, String(form.get('category') || 'product'));
    return json({ message: 'Imagem carregada com sucesso.', ...uploaded }, 201);
  }

  const publicProofMatch = path.match(/^\/api\/public\/orders\/([a-f0-9]{24})\/delivery-proof$/i);
  const protectedProofMatch = path.match(/^\/api\/orders\/([a-f0-9]{24})\/delivery-proof$/i);
  if ((publicProofMatch || protectedProofMatch) && method === 'GET') {
    const orderId = publicProofMatch?.[1] || protectedProofMatch?.[1] || '';
    const order = await selectOne('orders', 'id', orderId);
    if (!order) throw new HttpError(404, 'Pedido não encontrado.');
    if (publicProofMatch) await requirePublicOrderAccess(req, order);
    else await requireOrderProofActor(req, order);
    if (!order.delivery_proof_url) throw new HttpError(404, 'O pedido ainda não tem comprovativo de entrega.');
    return json({ url: await signPrivateMedia(order.delivery_proof_url), expires_in: 900 });
  }

  return null;
};

const routeAuth = async (req: Request, path: string, method: string) => {
  if (path === '/api/auth/login' && method === 'POST') {
    const body = await readBody(req) as AnyRecord;
    requiredFields(body, ['email', 'password', 'role']);
    const role = clean(body.role) as Role;
    if (!['admin', 'driver', 'manager'].includes(role)) throw new HttpError(400, 'Tipo de utilizador inválido.');

    const email = lowerEmail(body.email);
    const { data: row, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .eq('role', role)
      .maybeSingle();
    if (error) throw new HttpError(500, error.message);
    if (!row || !bcrypt.compareSync(String(body.password), row.password)) {
      throw new HttpError(401, 'Credenciais inválidas.');
    }

    const token = await generateToken(row);
    return json({
      message: 'Login bem-sucedido.',
      token,
      user: { _id: row.id, nome: row.nome, role: row.role }
    }, 200, {
      'Set-Cookie': `token=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${JWT_DAYS * 24 * 60 * 60}; SameSite=Strict; Secure`
    });
  }


  if (path === '/api/auth/request-password-reset' && method === 'POST') {
    const body = await readBody(req) as AnyRecord;
    requiredFields(body, ['email', 'role']);

    const role = clean(body.role) as Role;
    if (!['admin', 'driver'].includes(role)) throw new HttpError(400, 'Tipo de utilizador inválido.');

    const email = lowerEmail(body.email);
    const genericMessage = 'Se o email existir, receberá um código de restauração.';

    const { data: row, error } = await supabase
      .from('users')
      .select('id,email,role,nome')
      .eq('email', email)
      .eq('role', role)
      .maybeSingle();

    if (error) throw new HttpError(500, error.message);
    if (!row) return json({ message: genericMessage });

    const code = generatePasswordResetCode();
    const codeHash = bcrypt.hashSync(code, 12);
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MINUTES * 60 * 1000).toISOString();

    const { error: invalidateError } = await supabase
      .from('password_reset_codes')
      .update({ used_at: nowIso(), updated_at: nowIso() })
      .eq('email', email)
      .eq('role', role)
      .is('used_at', null);
    if (invalidateError) throw new HttpError(500, invalidateError.message);

    const { error: insertError } = await supabase.from('password_reset_codes').insert({
      id: generateId(),
      user_id: row.id,
      email,
      role,
      code_hash: codeHash,
      expires_at: expiresAt,
      attempts: 0
    });
    if (insertError) throw new HttpError(500, insertError.message);

    await sendPasswordResetEmail(email, code, role);
    return json({ message: genericMessage });
  }

  if ((path === '/api/auth/confirm-password-reset' || path === '/api/auth/reset-password') && method === 'POST') {
    const body = await readBody(req) as AnyRecord;
    const codeInput = body.code ?? body.resetCode;
    requiredFields({ ...body, code: codeInput }, ['email', 'role', 'code', 'newPassword']);

    const role = clean(body.role) as Role;
    if (!['admin', 'driver'].includes(role)) throw new HttpError(400, 'Tipo de utilizador inválido.');
    if (String(body.newPassword).length < 8) throw new HttpError(400, 'A nova password deve ter pelo menos 8 caracteres.');

    const email = lowerEmail(body.email);
    const { data: row, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .eq('role', role)
      .maybeSingle();

    if (error) throw new HttpError(500, error.message);
    if (!row) throw new HttpError(400, 'Código inválido ou expirado.');

    const { data: resetRows, error: resetError } = await supabase
      .from('password_reset_codes')
      .select('*')
      .eq('user_id', row.id)
      .eq('email', email)
      .eq('role', role)
      .is('used_at', null)
      .order('created_at', { ascending: false })
      .limit(1);

    if (resetError) throw new HttpError(500, resetError.message);
    const resetRow = resetRows?.[0];
    if (!resetRow || new Date(resetRow.expires_at).getTime() < Date.now()) {
      throw new HttpError(400, 'Código inválido ou expirado.');
    }

    if (Number(resetRow.attempts || 0) >= PASSWORD_RESET_MAX_ATTEMPTS) {
      await supabase.from('password_reset_codes').update({ used_at: nowIso(), updated_at: nowIso() }).eq('id', resetRow.id);
      throw new HttpError(429, 'Muitas tentativas. Peça um novo código.');
    }

    const codeOk = bcrypt.compareSync(String(codeInput), String(resetRow.code_hash));
    if (!codeOk) {
      const nextAttempts = Number(resetRow.attempts || 0) + 1;
      const payload: AnyRecord = { attempts: nextAttempts, updated_at: nowIso() };
      if (nextAttempts >= PASSWORD_RESET_MAX_ATTEMPTS) payload.used_at = nowIso();
      await supabase.from('password_reset_codes').update(payload).eq('id', resetRow.id);
      throw new HttpError(401, nextAttempts >= PASSWORD_RESET_MAX_ATTEMPTS ? 'Muitas tentativas. Peça um novo código.' : 'Código inválido ou expirado.');
    }

    await updateRow('users', row.id, { password: bcrypt.hashSync(String(body.newPassword), 12) });
    await supabase.from('password_reset_codes').update({ used_at: nowIso(), updated_at: nowIso() }).eq('id', resetRow.id);
    return json({ message: 'Password actualizada com sucesso. Já pode iniciar sessão.' });
  }

  if (path === '/api/auth/me' && method === 'GET') {
    const user = await requireUser(req);
    return json({ id: user.id, _id: user._id, nome: user.nome, email: user.email, role: user.role });
  }

  if (path === '/api/auth/logout' && method === 'POST') {
    const user = await requireUser(req).catch(() => null);
    if (user?.role === 'driver') await setDriverOnlineState(user.id, DRIVER_STATUS.OFFLINE);
    return json({ message: 'Sessão encerrada com sucesso.' }, 200, {
      'Set-Cookie': 'token=; HttpOnly; Path=/; Max-Age=0; SameSite=Strict; Secure'
    });
  }

  if (path === '/api/auth/change-password' && method === 'PUT') {
    const user = await requireUser(req);
    const body = await readBody(req) as AnyRecord;
    requiredFields(body, ['senhaAntiga', 'senhaNova']);
    if (String(body.senhaNova).length < 6) throw new HttpError(400, 'A nova senha deve ter pelo menos 6 caracteres.');

    const row = await selectOne('users', 'id', user.id);
    if (!row || !bcrypt.compareSync(String(body.senhaAntiga), row.password)) {
      throw new HttpError(401, 'A senha antiga está incorreta.');
    }
    const hashed = bcrypt.hashSync(String(body.senhaNova), 12);
    await updateRow('users', user.id, { password: hashed });
    const token = await generateToken({ ...row, password: hashed });
    return json({ message: 'Senha atualizada com sucesso.', token });
  }

  if (path === '/api/auth/register-driver' && method === 'POST') {
    await requireUser(req, 'admin');
    const body = await readBody(req) as AnyRecord;
    requiredFields(body, ['nome', 'email', 'telefone', 'password']);
    const email = lowerEmail(body.email);
    const exists = await selectOne('users', 'email', email);
    if (exists) throw new HttpError(400, 'Já existe um utilizador com este email.');

    const userRow = await insertRow('users', {
      nome: clean(body.nome),
      email,
      telefone: clean(body.telefone),
      password: bcrypt.hashSync(String(body.password), 12),
      role: 'driver'
    });

    const driverType = String(body.driverType || body.driver_type || DRIVER_TYPES.FREELANCER) === DRIVER_TYPES.OFFICIAL
      ? DRIVER_TYPES.OFFICIAL
      : DRIVER_TYPES.FREELANCER;
    const profileRow = await insertRow('driver_profiles', {
      user_id: userRow.id,
      vehicle_plate: clean(body.vehicle_plate) || '',
      vehicle_id: isValidId(String(body.vehicleId || body.vehicle_id || '')) ? String(body.vehicleId || body.vehicle_id) : null,
      driver_type: driverType,
      commission_rate: driverType === DRIVER_TYPES.OFFICIAL ? 0 : toNumber(body.commissionRate, 20),
      status: DRIVER_STATUS.OFFLINE
    });

    return json({
      message: 'Motorista registado com sucesso.',
      user: fromUser(userRow),
      profile: fromProfile(profileRow)
    }, 201);
  }

  return null;
};

const upsertDriverPresence = async (profile: AnyRecord, patch: AnyRecord = {}) => {
  const { data: current, error: readError } = await supabase
    .from('driver_presence')
    .select('*')
    .eq('driver_profile_id', profile.id)
    .maybeSingle();
  if (readError) throw new HttpError(500, readError.message);
  const now = nowIso();
  const currentOrderId = Object.prototype.hasOwnProperty.call(patch, 'current_order_id')
    ? patch.current_order_id
    : (current?.current_order_id || null);
  const isOnline = Object.prototype.hasOwnProperty.call(patch, 'is_online')
    ? patch.is_online === true
    : profile.status !== DRIVER_STATUS.OFFLINE;
  const payload = {
    driver_profile_id: profile.id,
    is_online: isOnline,
    is_available: Object.prototype.hasOwnProperty.call(patch, 'is_available')
      ? patch.is_available === true
      : Boolean(isOnline && profile.status === DRIVER_STATUS.ONLINE_FREE && !currentOrderId),
    current_order_id: currentOrderId,
    latitude: patch.latitude ?? current?.latitude ?? null,
    longitude: patch.longitude ?? current?.longitude ?? null,
    accuracy: patch.accuracy ?? current?.accuracy ?? null,
    speed: patch.speed ?? current?.speed ?? null,
    heading: patch.heading ?? current?.heading ?? null,
    last_seen_at: patch.last_seen_at || now,
    location_updated_at: patch.location_updated_at ?? current?.location_updated_at ?? null,
    version: Number(current?.version || 0) + 1,
    updated_at: now
  };
  const { data, error } = await supabase
    .from('driver_presence')
    .upsert(payload, { onConflict: 'driver_profile_id' })
    .select('*')
    .single();
  if (error) throw new HttpError(500, error.message);
  return data;
};

const cancelPendingDriverOffers = async (orderId: string) => {
  const { error } = await supabase
    .from('driver_offers')
    .update({ status: 'cancelled', responded_at: nowIso(), updated_at: nowIso() })
    .eq('order_id', orderId)
    .eq('status', 'pending');
  if (error) throw new HttpError(500, error.message);
};

const setDriverOnlineState = async (userId: string, status: string) => {
  const profile = await getDriverProfileByUser(userId);
  if (!profile) return null;
  const updated = await updateRow('driver_profiles', profile.id, { status });
  await upsertDriverPresence(updated, {
    is_online: status !== DRIVER_STATUS.OFFLINE,
    is_available: status === DRIVER_STATUS.ONLINE_FREE,
    last_seen_at: nowIso()
  });
  await broadcastAdmin('driver_status_changed', { driverId: updated.id, driverUserId: userId, newStatus: updated.status });
  if (status === DRIVER_STATUS.OFFLINE) {
    const user = await selectOne('users', 'id', userId);
    await broadcastAdmin('driver_disconnected_broadcast', {
      driverId: updated.id,
      driverUserId: userId,
      driverName: user?.nome || 'Motorista'
    });
  }
  return updated;
};

const routeRealtime = async (req: Request, path: string, method: string) => {
  if (path === '/api/realtime/driver-online' && method === 'POST') {
    const user = await requireUser(req, 'driver');
    const profile = await getDriverProfileByUser(user.id);
    if (!profile) throw new HttpError(404, 'Perfil de motorista não encontrado.');
    const status = profile.status === DRIVER_STATUS.OFFLINE ? DRIVER_STATUS.ONLINE_FREE : profile.status;
    const updated = await updateRow('driver_profiles', profile.id, { status });
    const presence = await upsertDriverPresence(updated, {
      is_online: true,
      is_available: status === DRIVER_STATUS.ONLINE_FREE,
      last_seen_at: nowIso()
    });
    await broadcastAdmin('driver_status_changed', { driverId: updated.id, driverUserId: user.id, newStatus: updated.status });
    return json({ ok: true, profile: fromProfile(updated), presence });
  }

  if (path === '/api/realtime/driver-offline' && method === 'POST') {
    const user = await requireUser(req, 'driver');
    const updated = await setDriverOnlineState(user.id, DRIVER_STATUS.OFFLINE);
    return json({ ok: true, profile: fromProfile(updated) });
  }

  if (path === '/api/realtime/driver-location' && method === 'POST') {
    const user = await requireUser(req, 'driver');
    const body = await readBody(req) as AnyRecord;
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new HttpError(400, 'Coordenadas inválidas.');

    const profile = await getDriverProfileByUser(user.id);
    if (!profile) throw new HttpError(404, 'Perfil de motorista não encontrado.');

    const lastLocation = {
      lat,
      lng,
      accuracy: Number.isFinite(Number(body.accuracy)) ? Number(body.accuracy) : undefined,
      speed: Number.isFinite(Number(body.speed)) ? Number(body.speed) : undefined,
      updatedAt: nowIso()
    };
    const updated = await updateRow('driver_profiles', profile.id, { last_location: lastLocation });
    const { data: previousPresence } = await supabase
      .from('driver_presence')
      .select('*')
      .eq('driver_profile_id', profile.id)
      .maybeSingle();
    const timestamp = nowIso();
    const presence = await upsertDriverPresence(updated, {
      is_online: true,
      is_available: profile.status === DRIVER_STATUS.ONLINE_FREE && !previousPresence?.current_order_id,
      latitude: lat,
      longitude: lng,
      accuracy: lastLocation.accuracy ?? null,
      speed: lastLocation.speed ?? null,
      heading: Number.isFinite(Number(body.heading)) ? Number(body.heading) : null,
      last_seen_at: timestamp,
      location_updated_at: timestamp
    });
    const previousLocationAt = previousPresence?.location_updated_at
      ? new Date(previousPresence.location_updated_at).getTime()
      : 0;
    if (!previousLocationAt || Date.now() - previousLocationAt >= 15000) {
      await insertRow('driver_locations', {
        driver_profile_id: profile.id,
        lat,
        lng,
        accuracy: lastLocation.accuracy ?? null,
        speed: lastLocation.speed ?? null
      });
    }
    const locationPayload = buildLocationPayload(updated, user);
    await broadcastAdmin('driver_location_broadcast', locationPayload);
    const activeOrderId = String(presence?.current_order_id || previousPresence?.current_order_id || '').trim();
    if (activeOrderId) {
      await broadcastOrder(activeOrderId, 'order_driver_location', locationPayload);
    }
    return json({ ok: true, presence });
  }

  return null;
};

const routeDrivers = async (req: Request, path: string, method: string) => {
  if (path === '/api/drivers' && method === 'GET') {
    await requireUser(req, 'admin');
    const { data, error } = await supabase.from('users').select('*').eq('role', 'driver').order('nome', { ascending: true });
    if (error) throw new HttpError(500, error.message);
    const drivers = [];
    for (const row of data || []) drivers.push(await enrichDriverUser(row));
    return json({ drivers });
  }

  if (path === '/api/drivers/available' && method === 'GET') {
    await requireUser(req, 'admin');
    await supabase.rpc('trago_expire_driver_offers');
    const cutoff = new Date(Date.now() - 45000).toISOString();
    const { data, error } = await supabase
      .from('driver_presence')
      .select('*')
      .eq('is_online', true)
      .eq('is_available', true)
      .is('current_order_id', null)
      .gte('last_seen_at', cutoff)
      .gte('location_updated_at', cutoff);
    if (error) throw new HttpError(500, error.message);
    const drivers: AnyRecord[] = [];
    for (const presence of data || []) {
      const profile = await selectOne('driver_profiles', 'id', presence.driver_profile_id);
      if (!profile) continue;
      if (profile.account_status === 'inactive' || profile.approval_status === 'rejected') continue;
      const user = await selectOne('users', 'id', profile.user_id);
      if (user?.role === 'driver') {
        drivers.push({
          _id: user.id,
          nome: user.nome,
          telefone: user.telefone,
          profile: {
            ...fromProfile(profile),
            status: DRIVER_STATUS.ONLINE_FREE,
            presence,
            lastLocation: {
              lat: Number(presence.latitude),
              lng: Number(presence.longitude),
              accuracy: Number(presence.accuracy || 0) || null,
              updatedAt: presence.location_updated_at
            }
          }
        });
      }
    }
    drivers.sort((a, b) => String(a.nome).localeCompare(String(b.nome)));
    return json({ drivers });
  }

  if (path === '/api/drivers/live-locations' && method === 'GET') {
    await requireUser(req, 'admin');
    const cutoff = new Date(Date.now() - 60000).toISOString();
    const { data, error } = await supabase
      .from('driver_presence')
      .select('*')
      .eq('is_online', true)
      .gte('last_seen_at', cutoff)
      .gte('location_updated_at', cutoff)
      .not('latitude', 'is', null)
      .not('longitude', 'is', null);
    if (error) throw new HttpError(500, error.message);
    const drivers: AnyRecord[] = [];
    for (const presence of data || []) {
      const profile = await selectOne('driver_profiles', 'id', presence.driver_profile_id);
      if (!profile) continue;
      const user = await selectOne('users', 'id', profile.user_id);
      const loc = { lat: presence.latitude, lng: presence.longitude };
      if (user?.role === 'driver' && Number.isFinite(Number(loc.lat)) && Number.isFinite(Number(loc.lng))) {
        drivers.push({
          ...buildLocationPayload({
            ...profile,
            last_location: {
              lat: Number(presence.latitude),
              lng: Number(presence.longitude),
              accuracy: Number(presence.accuracy || 0) || null,
              speed: Number(presence.speed || 0) || null,
              updatedAt: presence.location_updated_at
            }
          }, user),
          isOnline: presence.is_online === true,
          isAvailable: presence.is_available === true,
          lastSeenAt: presence.last_seen_at
        });
      }
    }
    return json({ drivers });
  }

  if (path === '/api/drivers/me/profile' && method === 'GET') {
    const user = await requireUser(req, 'driver');
    const profile = await getDriverProfileByUser(user.id);
    if (!profile) throw new HttpError(404, 'Perfil de motorista não encontrado.');
    const totalDeliveries = await countRows('orders', (query) => query
      .eq('assigned_to_driver', profile.id)
      .eq('status', ORDER_STATUS.COMPLETED));
    return json({
      driver: {
        id: user.id,
        name: user.nome,
        phone: user.telefone,
        email: user.email,
        profile: await ownDriverProfile(profile, totalDeliveries)
      }
    });
  }

  if (path === '/api/drivers/me/profile' && method === 'PUT') {
    const user = await requireUser(req, 'driver');
    const body = await readBody(req) as AnyRecord;
    requiredFields(body, ['name', 'phone', 'vehicle_plate']);
    const currentProfile = await getDriverProfileByUser(user.id);
    if (!currentProfile) throw new HttpError(404, 'Perfil de motorista não encontrado.');
    const vehicleType = ['mota', 'carro', 'carrinha', 'outro'].includes(String(body.vehicle_type))
      ? String(body.vehicle_type)
      : 'mota';
    const licenseCategory = ['A', 'B', 'C'].includes(String(body.license_category))
      ? String(body.license_category)
      : 'A';
    const vehicleYear = body.vehicle_year ? Math.min(2035, Math.max(1990, Number(body.vehicle_year))) : null;
    if (body.email && !/^\S+@\S+\.\S+$/.test(String(body.email))) throw new HttpError(400, 'Email inválido.');

    const updatedUser = await updateRow('users', user.id, {
      nome: String(clean(body.name) || '').slice(0, 100),
      telefone: String(clean(body.phone) || '').slice(0, 30),
      ...(body.email ? { email: lowerEmail(body.email).slice(0, 160) } : {})
    });
    const profile = await updateRow('driver_profiles', currentProfile.id, {
      bio: String(clean(body.bio) || '').slice(0, 180),
      avatar_url: cleanDriverImage(body.avatar_url),
      vehicle_photo_url: cleanDriverImage(body.vehicle_photo_url),
      license_photo_url: cleanDriverImage(body.license_photo_url),
      vehicle_type: vehicleType,
      vehicle_plate: String(clean(body.vehicle_plate) || '').slice(0, 20).toUpperCase(),
      vehicle_brand: String(clean(body.vehicle_brand) || '').slice(0, 40),
      vehicle_model: String(clean(body.vehicle_model) || '').slice(0, 40),
      vehicle_color: String(clean(body.vehicle_color) || '').slice(0, 30),
      vehicle_year: Number.isFinite(vehicleYear) ? vehicleYear : null,
      license_number: String(clean(body.license_number) || '').slice(0, 40),
      license_expiry: body.license_expiry || null,
      license_category: licenseCategory,
      emergency_name: String(clean(body.emergency_name) || '').slice(0, 80),
      emergency_phone: String(clean(body.emergency_phone) || '').slice(0, 30)
    });
    const totalDeliveries = await countRows('orders', (query) => query
      .eq('assigned_to_driver', profile.id)
      .eq('status', ORDER_STATUS.COMPLETED));
    return json({
      message: 'Perfil do motorista actualizado com sucesso.',
      driver: {
        id: updatedUser.id,
        name: updatedUser.nome,
        phone: updatedUser.telefone,
        email: updatedUser.email,
        profile: await ownDriverProfile(profile, totalDeliveries)
      }
    });
  }

  if (path === '/api/drivers/my-earnings' && method === 'GET') {
    const user = await requireUser(req, 'driver');
    const profile = await getDriverProfileByUser(user.id);
    if (!profile) throw new HttpError(404, 'Perfil de motorista não encontrado.');
    const query = parseQuery(req);
    const range = getPeriodRange(query.period || 'month');
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .eq('assigned_to_driver', profile.id)
      .eq('status', ORDER_STATUS.COMPLETED)
      .gte('timestamp_completed', range.start.toISOString())
      .lte('timestamp_completed', range.end.toISOString())
      .order('timestamp_completed', { ascending: false });
    if (error) throw new HttpError(500, error.message);
    const orders = (data || []).map(fromOrder);
    const isOfficial = String(profile.driver_type || DRIVER_TYPES.FREELANCER) === DRIVER_TYPES.OFFICIAL;
    return json({
      canViewEarnings: !isOfficial,
      driverType: profile.driver_type || DRIVER_TYPES.FREELANCER,
      message: isOfficial ? 'Motorista oficial pode ver entregas concluídas, mas não comissões.' : undefined,
      commissionRate: isOfficial ? 0 : Number(profile.commission_rate || 20),
      totalGanhos: isOfficial ? 0 : orders.reduce((sum: number, order: AnyRecord) => sum + Number(order.valor_motorista || 0), 0),
      totalOrders: orders.length,
      ordersList: orders,
      period: { key: range.key, label: range.label, start: range.start.toISOString(), end: range.end.toISOString() }
    });
  }

  const reportMatch = path.match(/^\/api\/drivers\/([a-f0-9]{24})\/report$/i);
  if (reportMatch && method === 'GET') {
    await requireUser(req, 'admin');
    const userId = reportMatch[1];
    const profile = await getDriverProfileByUser(userId);
    if (!profile) throw new HttpError(404, 'Perfil de motorista não encontrado.');
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .eq('assigned_to_driver', profile.id)
      .eq('status', ORDER_STATUS.COMPLETED)
      .order('timestamp_completed', { ascending: false });
    if (error) throw new HttpError(500, error.message);
    const orders = (data || []).map(fromOrder);
    return json({ totalOrders: orders.length, orders });
  }

  const idMatch = path.match(/^\/api\/drivers\/([a-f0-9]{24})$/i);
  if (idMatch && method === 'GET') {
    await requireUser(req, 'admin');
    const row = await selectOne('users', 'id', idMatch[1]);
    if (!row || row.role !== 'driver') throw new HttpError(404, 'Motorista não encontrado.');
    return json({ driver: await enrichDriverUser(row) });
  }

  if (idMatch && method === 'PUT') {
    await requireUser(req, 'admin');
    const body = await readBody(req) as AnyRecord;
    const row = await selectOne('users', 'id', idMatch[1]);
    if (!row || row.role !== 'driver') throw new HttpError(404, 'Motorista não encontrado.');
    const user = await updateRow('users', row.id, {
      nome: clean(body.nome),
      telefone: clean(body.telefone)
    });
    let profile = await getDriverProfileByUser(row.id);
    if (profile) {
      const driverType = String(body.driverType || body.driver_type || profile.driver_type || DRIVER_TYPES.FREELANCER) === DRIVER_TYPES.OFFICIAL
        ? DRIVER_TYPES.OFFICIAL
        : DRIVER_TYPES.FREELANCER;
      profile = await updateRow('driver_profiles', profile.id, {
        vehicle_plate: clean(body.vehicle_plate) || '',
        vehicle_id: isValidId(String(body.vehicleId || body.vehicle_id || '')) ? String(body.vehicleId || body.vehicle_id) : null,
        driver_type: driverType,
        status: clean(body.status) || profile.status,
        commission_rate: driverType === DRIVER_TYPES.OFFICIAL ? 0 : toNumber(body.commissionRate, 20)
      });
    } else {
      const driverType = String(body.driverType || body.driver_type || DRIVER_TYPES.FREELANCER) === DRIVER_TYPES.OFFICIAL
        ? DRIVER_TYPES.OFFICIAL
        : DRIVER_TYPES.FREELANCER;
      profile = await insertRow('driver_profiles', {
        user_id: row.id,
        vehicle_plate: clean(body.vehicle_plate) || '',
        vehicle_id: isValidId(String(body.vehicleId || body.vehicle_id || '')) ? String(body.vehicleId || body.vehicle_id) : null,
        driver_type: driverType,
        status: clean(body.status) || DRIVER_STATUS.OFFLINE,
        commission_rate: driverType === DRIVER_TYPES.OFFICIAL ? 0 : toNumber(body.commissionRate, 20)
      });
    }
    await broadcastAdmin('driver_status_changed', { driverId: profile.id, driverUserId: row.id, newStatus: profile.status });
    return json({ message: 'Motorista atualizado com sucesso.', user: fromUser(user), profile: fromProfile(profile) });
  }

  return null;
};

const routeClients = async (req: Request, path: string, method: string) => {
  if (path === '/api/clients' && method === 'GET') {
    await requireUser(req, 'admin');
    const { data, error } = await supabase.from('clients').select('*').order('nome', { ascending: true });
    if (error) throw new HttpError(500, error.message);
    return json({ clients: (data || []).map(fromClient) });
  }

  if (path === '/api/clients' && method === 'POST') {
    const user = await requireUser(req, 'admin');
    const body = await readBody(req) as AnyRecord;
    requiredFields(body, ['nome', 'telefone']);
    const exists = await selectOne('clients', 'telefone', clean(body.telefone));
    if (exists) throw new HttpError(400, 'Um cliente com este número de telefone já existe.');
    const billingType = String(body.billing_type || CLIENT_BILLING_TYPES.PREPAID) === CLIENT_BILLING_TYPES.POSTPAID
      ? CLIENT_BILLING_TYPES.POSTPAID
      : CLIENT_BILLING_TYPES.PREPAID;
    const creditLimit = billingType === CLIENT_BILLING_TYPES.POSTPAID ? Math.max(0, toNumber(body.credit_limit, 0)) : 0;
    const row = await insertRow('clients', {
      nome: clean(body.nome),
      telefone: clean(body.telefone),
      email: clean(body.email) || '',
      empresa: clean(body.empresa) || '',
      nuit: clean(body.nuit) || '',
      endereco: clean(body.endereco) || '',
      billing_type: billingType,
      credit_limit: creditLimit,
      credit_balance: creditLimit,
      credit_used: 0,
      created_by_admin: user.id
    });
    return json({ message: 'Cliente criado com sucesso', client: fromClient(row) }, 201);
  }

  const statementMatch = path.match(/^\/api\/clients\/([a-f0-9]{24})\/statement$/i);
  if (statementMatch && method === 'GET') {
    await requireUser(req, 'admin');
    const query = parseQuery(req);
    if (!query.startDate || !query.endDate) throw new HttpError(400, 'Datas de início e fim são obrigatórias.');
    const start = new Date(query.startDate); start.setUTCHours(0, 0, 0, 0);
    const end = new Date(query.endDate); end.setUTCHours(23, 59, 59, 999);
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .eq('client', statementMatch[1])
      .eq('status', ORDER_STATUS.COMPLETED)
      .gte('timestamp_completed', start.toISOString())
      .lte('timestamp_completed', end.toISOString())
      .order('timestamp_completed', { ascending: true });
    if (error) throw new HttpError(500, error.message);
    const ordersList = (data || []).map(fromOrder);
    return json({
      totalValue: ordersList.reduce((sum: number, order: AnyRecord) => sum + Number(order.price || 0), 0),
      totalOrders: ordersList.length,
      ordersList
    });
  }

  const idMatch = path.match(/^\/api\/clients\/([a-f0-9]{24})$/i);
  if (idMatch && method === 'GET') {
    await requireUser(req, 'admin');
    const row = await selectOne('clients', 'id', idMatch[1]);
    if (!row) throw new HttpError(404, 'Cliente não encontrado.');
    return json({ client: fromClient(row) });
  }

  if (idMatch && method === 'PUT') {
    await requireUser(req, 'admin');
    const body = await readBody(req) as AnyRecord;
    const client = await selectOne('clients', 'id', idMatch[1]);
    if (!client) throw new HttpError(404, 'Cliente não encontrado.');
    if (body.telefone && String(body.telefone) !== String(client.telefone)) {
      const phoneInUse = await selectOne('clients', 'telefone', clean(body.telefone));
      if (phoneInUse) throw new HttpError(400, 'Este novo número de telefone já está em uso.');
    }
    const billingType = String(body.billing_type || client.billing_type || CLIENT_BILLING_TYPES.PREPAID) === CLIENT_BILLING_TYPES.POSTPAID
      ? CLIENT_BILLING_TYPES.POSTPAID
      : CLIENT_BILLING_TYPES.PREPAID;
    const creditUsed = billingType === CLIENT_BILLING_TYPES.POSTPAID ? Math.max(0, toNumber(client.credit_used, 0)) : 0;
    const creditLimit = billingType === CLIENT_BILLING_TYPES.POSTPAID ? Math.max(0, toNumber(body.credit_limit, client.credit_limit || 0)) : 0;
    const row = await updateRow('clients', idMatch[1], {
      nome: clean(body.nome),
      telefone: clean(body.telefone),
      email: clean(body.email) || '',
      empresa: clean(body.empresa) || '',
      nuit: clean(body.nuit) || '',
      endereco: clean(body.endereco) || '',
      billing_type: billingType,
      credit_limit: creditLimit,
      credit_balance: billingType === CLIENT_BILLING_TYPES.POSTPAID ? Math.max(creditLimit - creditUsed, 0) : 0,
      credit_used: creditUsed
    });
    return json({ message: 'Cliente atualizado com sucesso', client: fromClient(row) });
  }

  if (idMatch && method === 'DELETE') {
    await requireUser(req, 'admin');
    const orders = await countRows('orders', (q) => q.eq('client', idMatch[1]));
    if (orders > 0) throw new HttpError(400, 'Não é possível apagar clientes com histórico de encomendas.');
    await deleteRow('clients', idMatch[1]);
    return json({ message: 'Cliente apagado com sucesso' });
  }

  return null;
};



const routeVehicles = async (req: Request, path: string, method: string) => {
  if (path === '/api/vehicles' && method === 'GET') {
    await requireUser(req, 'admin');
    const { data, error } = await supabase.from('vehicles').select('*').order('plate', { ascending: true });
    if (error) throw new HttpError(500, error.message);
    return json({ vehicles: (data || []).map(fromVehicle) });
  }

  if (path === '/api/vehicles' && method === 'POST') {
    const user = await requireUser(req, 'admin');
    const body = await readBody(req) as AnyRecord;
    requiredFields(body, ['plate']);
    const normalizedPlate = String(body.plate || '').trim().toUpperCase();
    const existing = await selectOne('vehicles', 'plate', normalizedPlate);
    if (existing) throw new HttpError(400, 'Já existe um veículo com esta matrícula.');
    const row = await insertRow('vehicles', {
      plate: normalizedPlate,
      brand: clean(body.brand) || '',
      model: clean(body.model) || '',
      type: ['mota', 'carro', 'carrinha', 'outro'].includes(String(body.type || '')) ? String(body.type) : 'mota',
      status: ['ativo', 'manutencao', 'inativo'].includes(String(body.status || '')) ? String(body.status) : 'ativo',
      notes: String(body.notes || '').trim().slice(0, 500),
      created_by: user.id
    });
    return json({ message: 'Veículo registado com sucesso.', vehicle: fromVehicle(row) }, 201);
  }

  const vehicleMatch = path.match(/^\/api\/vehicles\/([a-f0-9]{24})$/i);
  if (vehicleMatch && method === 'GET') {
    await requireUser(req, 'admin');
    const row = await selectOne('vehicles', 'id', vehicleMatch[1]);
    if (!row) throw new HttpError(404, 'Veículo não encontrado.');
    return json({ vehicle: fromVehicle(row) });
  }

  if (vehicleMatch && method === 'PUT') {
    await requireUser(req, 'admin');
    const body = await readBody(req) as AnyRecord;
    requiredFields(body, ['plate']);
    const current = await selectOne('vehicles', 'id', vehicleMatch[1]);
    if (!current) throw new HttpError(404, 'Veículo não encontrado.');
    const normalizedPlate = String(body.plate || '').trim().toUpperCase();
    if (normalizedPlate !== current.plate) {
      const plateInUse = await selectOne('vehicles', 'plate', normalizedPlate);
      if (plateInUse) throw new HttpError(400, 'Esta matrícula já está em uso.');
    }
    const row = await updateRow('vehicles', current.id, {
      plate: normalizedPlate,
      brand: clean(body.brand) || '',
      model: clean(body.model) || '',
      type: ['mota', 'carro', 'carrinha', 'outro'].includes(String(body.type || '')) ? String(body.type) : 'mota',
      status: ['ativo', 'manutencao', 'inativo'].includes(String(body.status || '')) ? String(body.status) : 'ativo',
      notes: String(body.notes || '').trim().slice(0, 500)
    });
    return json({ message: 'Veículo atualizado com sucesso.', vehicle: fromVehicle(row) });
  }

  if (vehicleMatch && method === 'DELETE') {
    await requireUser(req, 'admin');
    const current = await selectOne('vehicles', 'id', vehicleMatch[1]);
    if (!current) throw new HttpError(404, 'Veículo não encontrado.');
    const hasCosts = await countRows('company_costs', (q) => q.eq('assigned_vehicle', current.id));
    if (hasCosts > 0) throw new HttpError(400, 'Não é possível apagar veículos com custos associados.');
    await deleteRow('vehicles', current.id);
    return json({ message: 'Veículo apagado com sucesso.' });
  }

  return null;
};

const routeGeo = async (req: Request, path: string, method: string) => {
  if (path === '/api/geo/quote' && method === 'POST') {
    await requireUser(req, 'admin');
    const body = await readBody(req) as AnyRecord;
    const quote = await buildRouteQuote(body.origin, body.destination);
    return json(quote);
  }

  if (path === '/api/geo/route' && method === 'POST') {
    await requireUser(req);
    const body = await readBody(req) as AnyRecord;
    const route = await buildRouteGeometry(body.origin, body.destination);
    return json(route);
  }

  return null;
};

const routeClientPortal = async (req: Request, path: string, method: string) => {
  if (path === '/api/public/clients/register' && method === 'POST') {
    const body = await readBody(req) as AnyRecord;
    const name = String(clean(body.name) || '').slice(0, 120);
    const phone = normalizePhone(body.phone);
    const email = lowerEmail(body.email);
    const password = String(body.password || '');
    if (!name || phone.length < 8 || !/^\S+@\S+\.\S+$/.test(email) || !isClientPassword(password)) {
      throw new HttpError(400, 'Indique nome, contacto, email válido e uma palavra-passe com pelo menos 8 caracteres.');
    }

    const [phoneResult, emailResult] = await Promise.all([
      supabase.from('clients').select('*').eq('telefone', phone).maybeSingle(),
      supabase.from('clients').select('*').eq('email', email).maybeSingle()
    ]);
    if (phoneResult.error) throw new HttpError(500, phoneResult.error.message);
    if (emailResult.error) throw new HttpError(500, emailResult.error.message);
    if (phoneResult.data && emailResult.data && phoneResult.data.id !== emailResult.data.id) {
      throw new HttpError(409, 'O contacto e o email pertencem a contas diferentes.');
    }
    let client = phoneResult.data || emailResult.data || null;
    if (client?.password_hash) throw new HttpError(409, 'Já existe uma conta com este contacto ou email. Use a opção Entrar.');

    const payload = {
      nome: name,
      telefone: phone,
      email,
      password_hash: bcrypt.hashSync(password, 12),
      auth_provider: 'password',
      account_status: 'active',
      last_login_at: nowIso(),
      referral_code: client?.referral_code || `TG${generateId().slice(0, 8).toUpperCase()}`
    };
    client = client ? await updateRow('clients', client.id, payload) : await insertRow('clients', payload);
    return json({
      message: 'Conta criada com sucesso.',
      client: fromClient(client),
      token: await generateClientToken(client)
    }, 201);
  }

  if (path === '/api/public/clients/login' && method === 'POST') {
    const body = await readBody(req) as AnyRecord;
    const email = lowerEmail(body.email || body.identifier);
    // O fallback de PIN mantém contas antigas utilizáveis durante a transição.
    const password = String(body.password ?? body.pin ?? '');
    if (!/^\S+@\S+\.\S+$/.test(email) || !isLegacyClientCredential(password)) {
      throw new HttpError(400, 'Indique o email e a palavra-passe.');
    }
    const { data: client, error } = await supabase.from('clients').select('*').eq('email', email).maybeSingle();
    if (error) throw new HttpError(500, error.message);
    if (!client || client.account_status !== 'active' || client.deleted_at || !client.password_hash || !bcrypt.compareSync(password, client.password_hash)) {
      throw new HttpError(401, 'Email ou palavra-passe incorrectos.');
    }
    const updated = await updateRow('clients', client.id, { last_login_at: nowIso() });
    return json({ client: fromClient(updated), token: await generateClientToken(updated) });
  }

  if (path === '/api/public/clients/google' && method === 'POST') {
    const body = await readBody(req) as AnyRecord;
    if (!body.id_token) throw new HttpError(400, 'Token Google em falta.');
    const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(String(body.id_token))}`);
    const profile = await response.json().catch(() => ({})) as AnyRecord;
    if (!response.ok || !profile.email || !profile.sub) throw new HttpError(401, 'Não foi possível validar a conta Google.');
    const expectedAudience = TRAGO_GOOGLE_CLIENT_ID;
    if (expectedAudience && profile.aud !== expectedAudience) throw new HttpError(401, 'Conta Google destinada a outro projecto.');

    const email = lowerEmail(profile.email);
    let { data: client, error } = await supabase.from('clients').select('*').eq('auth_provider', 'google').eq('auth_subject', profile.sub).maybeSingle();
    if (error) throw new HttpError(500, error.message);
    if (!client) {
      const result = await supabase.from('clients').select('*').eq('email', email).maybeSingle();
      if (result.error) throw new HttpError(500, result.error.message);
      client = result.data;
    }
    const payload = {
      nome: String(profile.name || email.split('@')[0]).slice(0, 120),
      email,
      telefone: client?.telefone || `google${String(profile.sub).slice(-12)}`,
      auth_provider: 'google',
      auth_subject: String(profile.sub),
      avatar_url: String(profile.picture || '').slice(0, 1000),
      email_verified: true,
      account_status: 'active',
      last_login_at: nowIso(),
      referral_code: client?.referral_code || `TG${generateId().slice(0, 8).toUpperCase()}`
    };
    client = client ? await updateRow('clients', client.id, payload) : await insertRow('clients', payload);
    return json({
      message: 'Conta Google validada.',
      client: fromClient(client),
      token: await generateClientToken(client)
    });
  }

  // Keep the authenticated client portal namespace strictly bounded.
  // `/api/clients` is the Admin collection and used to be intercepted here
  // because it also starts with the characters `/api/client`.
  if (path !== '/api/client' && !path.startsWith('/api/client/')) return null;
  const client = await requireClient(req);

  if (path === '/api/client/me' && method === 'GET') {
    return json({ client: fromClient(client) });
  }

  if (path === '/api/client/me' && method === 'PUT') {
    const body = await readBody(req) as AnyRecord;
    const patch: AnyRecord = {};
    if (body.name !== undefined) patch.nome = String(clean(body.name) || client.nome).slice(0, 120);
    if (body.phone !== undefined) {
      const phone = normalizePhone(body.phone);
      if (phone.length < 8) throw new HttpError(400, 'Contacto inválido.');
      patch.telefone = phone;
    }
    if (body.email !== undefined) {
      const email = lowerEmail(body.email);
      if (email && !/^\S+@\S+\.\S+$/.test(email)) throw new HttpError(400, 'Email inválido.');
      patch.email = email;
    }
    if (body.avatar_url !== undefined) patch.avatar_url = String(body.avatar_url || '').slice(0, 1200);
    const updated = await updateRow('clients', client.id, patch);
    return json({ message: 'Perfil actualizado.', client: fromClient(updated), token: await generateClientToken(updated) });
  }

  if (path === '/api/client/me' && method === 'DELETE') {
    const body = await readBody(req) as AnyRecord;
    if (client.password_hash && !bcrypt.compareSync(String(body.password ?? body.pin ?? ''), client.password_hash)) {
      throw new HttpError(401, 'Palavra-passe incorrecta.');
    }
    await updateRow('clients', client.id, {
      account_status: 'inactive',
      deleted_at: nowIso(),
      password_hash: '',
      auth_subject: ''
    });
    return json({ message: 'Conta desactivada. Os dados legais dos pedidos foram preservados.' });
  }

  if ((path === '/api/client/password' || path === '/api/client/pin') && method === 'PUT') {
    const body = await readBody(req) as AnyRecord;
    const currentPassword = String(body.current_password ?? body.current_pin ?? '');
    const newPassword = String(body.new_password ?? body.new_pin ?? '');
    if (!client.password_hash || !bcrypt.compareSync(currentPassword, client.password_hash)) {
      throw new HttpError(401, 'Palavra-passe actual incorrecta.');
    }
    if (!isClientPassword(newPassword)) throw new HttpError(400, 'A nova palavra-passe deve ter pelo menos 8 caracteres.');
    const updated = await updateRow('clients', client.id, {
      password_hash: bcrypt.hashSync(newPassword, 12),
      auth_provider: 'password'
    });
    return json({ message: 'Palavra-passe actualizada.', token: await generateClientToken(updated) });
  }

  if (path === '/api/client/preferences' && method === 'PUT') {
    const body = await readBody(req) as AnyRecord;
    const preferences = body.preferences && typeof body.preferences === 'object' ? body.preferences : {};
    const updated = await updateRow('clients', client.id, {
      notification_preferences: {
        orders: preferences.orders !== false,
        support: preferences.support !== false,
        payments: preferences.payments !== false,
        promotions: preferences.promotions === true,
        preciseLocation: preferences.preciseLocation !== false
      },
      language: ['pt', 'en'].includes(String(body.language || '')) ? body.language : client.language || 'pt'
    });
    return json({ preferences: updated.notification_preferences, language: updated.language });
  }

  if (path === '/api/client/orders' && method === 'GET') {
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .eq('client', client.id)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw new HttpError(500, error.message);
    return json({ orders: (data || []).map(fromOrder) });
  }

  if (path === '/api/client/addresses' && method === 'GET') {
    const { data, error } = await supabase.from('saved_addresses').select('*').eq('client_id', client.id).order('is_default', { ascending: false }).order('created_at', { ascending: false });
    if (error) throw new HttpError(500, error.message);
    return json({ addresses: data || [] });
  }

  if (path === '/api/client/addresses' && method === 'POST') {
    const body = await readBody(req) as AnyRecord;
    const details = String(clean(body.address || body.details) || '').slice(0, 180);
    if (details.length < 5) throw new HttpError(400, 'Indique o endereço completo.');
    const makeDefault = body.is_default === true;
    if (makeDefault) {
      const { error } = await supabase.from('saved_addresses').update({ is_default: false }).eq('client_id', client.id);
      if (error) throw new HttpError(400, error.message);
    }
    const address = await insertRow('saved_addresses', {
      client_id: client.id,
      label: String(clean(body.label) || 'Endereço').slice(0, 30),
      details,
      neighborhood: String(clean(body.neighborhood) || '').slice(0, 100),
      reference: String(clean(body.reference) || '').slice(0, 100),
      lat: Number.isFinite(Number(body.lat)) ? Number(body.lat) : null,
      lng: Number.isFinite(Number(body.lng)) ? Number(body.lng) : null,
      type: ['home', 'work', 'other'].includes(String(body.type)) ? body.type : 'other',
      is_default: makeDefault
    });
    return json({ address }, 201);
  }

  const addressMatch = path.match(/^\/api\/client\/addresses\/([a-f0-9]{24})$/i);
  if (addressMatch && method === 'PUT') {
    const current = await selectOne('saved_addresses', 'id', addressMatch[1]);
    if (!current || current.client_id !== client.id) throw new HttpError(404, 'Endereço não encontrado.');
    const body = await readBody(req) as AnyRecord;
    if (body.is_default === true) {
      const { error } = await supabase.from('saved_addresses').update({ is_default: false }).eq('client_id', client.id);
      if (error) throw new HttpError(400, error.message);
    }
    const address = await updateRow('saved_addresses', current.id, {
      label: String(clean(body.label) || current.label).slice(0, 30),
      details: String(clean(body.address || body.details) || current.details).slice(0, 180),
      neighborhood: String(clean(body.neighborhood) || '').slice(0, 100),
      reference: String(clean(body.reference) || '').slice(0, 100),
      lat: Number.isFinite(Number(body.lat)) ? Number(body.lat) : null,
      lng: Number.isFinite(Number(body.lng)) ? Number(body.lng) : null,
      type: ['home', 'work', 'other'].includes(String(body.type)) ? body.type : current.type,
      is_default: body.is_default === true
    });
    return json({ address });
  }

  if (addressMatch && method === 'DELETE') {
    const current = await selectOne('saved_addresses', 'id', addressMatch[1]);
    if (!current || current.client_id !== client.id) throw new HttpError(404, 'Endereço não encontrado.');
    await deleteRow('saved_addresses', current.id);
    return json({ message: 'Endereço eliminado.' });
  }

  if (path === '/api/client/favorites' && method === 'GET') {
    const { data, error } = await supabase.from('client_favorites').select('*').eq('client_id', client.id).order('created_at', { ascending: false });
    if (error) throw new HttpError(500, error.message);
    return json({ favorites: data || [] });
  }

  if (path === '/api/client/favorites' && method === 'POST') {
    const body = await readBody(req) as AnyRecord;
    const requestedEntityType = String(body.entity_type || '');
    const entityType = requestedEntityType === 'menu_item'
      ? 'product'
      : (['restaurant', 'product'].includes(requestedEntityType) ? requestedEntityType : '');
    const entityId = String(body.entity_id || '');
    if (!entityType || !isValidId(entityId)) throw new HttpError(400, 'Favorito inválido.');
    const { data: existing, error } = await supabase.from('client_favorites').select('*').eq('client_id', client.id).eq('entity_type', entityType).eq('entity_id', entityId).maybeSingle();
    if (error) throw new HttpError(500, error.message);
    const favorite = existing || await insertRow('client_favorites', { client_id: client.id, entity_type: entityType, entity_id: entityId });
    return json({ favorite }, existing ? 200 : 201);
  }

  const favoriteMatch = path.match(/^\/api\/client\/favorites\/([a-f0-9]{24})$/i);
  if (favoriteMatch && method === 'DELETE') {
    const current = await selectOne('client_favorites', 'id', favoriteMatch[1]);
    if (!current || current.client_id !== client.id) throw new HttpError(404, 'Favorito não encontrado.');
    await deleteRow('client_favorites', current.id);
    return json({ message: 'Favorito removido.' });
  }

  if (path === '/api/client/notifications' && method === 'GET') {
    const { data, error } = await supabase.from('client_notifications').select('*').eq('client_id', client.id).order('created_at', { ascending: false }).limit(100);
    if (error) throw new HttpError(500, error.message);
    return json({ notifications: data || [] });
  }

  if (path === '/api/client/notifications/read-all' && method === 'POST') {
    const { error } = await supabase.from('client_notifications').update({ read_at: nowIso() }).eq('client_id', client.id).is('read_at', null);
    if (error) throw new HttpError(400, error.message);
    return json({ message: 'Notificações marcadas como lidas.' });
  }

  if (path === '/api/client/benefits' && method === 'GET') {
    const now = nowIso();
    const { data: coupons, error: couponError } = await supabase.from('finance_coupons').select('*').eq('active', true).or(`starts_at.is.null,starts_at.lte.${now}`).or(`expires_at.is.null,expires_at.gte.${now}`).order('created_at', { ascending: false });
    if (couponError) throw new HttpError(500, couponError.message);
    const { data: transactions, error: walletError } = await supabase.from('wallet_transactions').select('*').eq('client_id', client.id).order('created_at', { ascending: false }).limit(50);
    if (walletError) throw new HttpError(500, walletError.message);
    return json({
      wallet_balance_cents: Number(client.wallet_balance_cents || 0),
      loyalty_points: Number(client.loyalty_points || 0),
      referral_code: client.referral_code || '',
      coupons: coupons || [],
      wallet_transactions: transactions || []
    });
  }

  return null;
};

const menuItemWithExtras = async (row: AnyRecord) => {
  const item = fromMenuItem(row) as AnyRecord;
  const [{ data: stock, error: stockError }, { data: options, error: optionError }] = await Promise.all([
    supabase.from('product_stock').select('*').eq('menu_item_id', row.id).maybeSingle(),
    supabase.from('product_options').select('*').eq('menu_item_id', row.id).order('created_at', { ascending: true })
  ]);
  if (stockError) throw new HttpError(500, stockError.message);
  if (optionError) throw new HttpError(500, optionError.message);
  item.stock = stock || null;
  item.options = options || [];
  return item;
};

const syncMenuExtras = async (itemId: string, body: AnyRecord) => {
  if (body.stock !== undefined || body.daily_stock !== undefined || body.auto_disable !== undefined || body.unavailable_reason !== undefined) {
    const quantityValue = body.stock ?? body.daily_stock;
    const stockPayload = {
      quantity: quantityValue === '' || quantityValue === null || quantityValue === undefined ? null : Math.max(0, Math.floor(toNumber(quantityValue, 0))),
      auto_disable: body.auto_disable === true,
      unavailable_until: body.unavailable_until || null,
      unavailable_reason: String(body.unavailable_reason || '').slice(0, 180)
    };
    const { data: existing, error } = await supabase.from('product_stock').select('*').eq('menu_item_id', itemId).maybeSingle();
    if (error) throw new HttpError(500, error.message);
    if (existing) await updateRow('product_stock', existing.id, stockPayload);
    else await insertRow('product_stock', { menu_item_id: itemId, ...stockPayload });
  }

  if (Array.isArray(body.options)) {
    const { error } = await supabase.from('product_options').delete().eq('menu_item_id', itemId);
    if (error) throw new HttpError(400, error.message);
    for (const raw of body.options.slice(0, 12)) {
      const name = String(raw?.name || '').trim().slice(0, 80);
      const values = Array.isArray(raw?.values)
        ? raw.values.slice(0, 30).map((value: AnyRecord) => ({
          id: String(value?.id || generateId()),
          name: String(value?.name || '').trim().slice(0, 80),
          price: Math.max(0, toNumber(value?.price, 0))
        })).filter((value: AnyRecord) => value.name)
        : [];
      if (!name || !values.length) continue;
      await insertRow('product_options', {
        menu_item_id: itemId,
        name,
        required: raw.required === true,
        min_select: Math.max(0, Math.floor(toNumber(raw.min_select, raw.required ? 1 : 0))),
        max_select: Math.max(1, Math.floor(toNumber(raw.max_select, 1))),
        values
      });
    }
  }
};

const resolveCoupon = async (rawCode: unknown, restaurantId: string | null, subtotalMzn: number, deliveryFeeMzn: number, client: AnyRecord | null) => {
  const code = String(rawCode || '').trim().toUpperCase().replace(/\s+/g, '').slice(0, 30);
  if (!code) return null;
  const subtotal = Math.max(0, toNumber(subtotalMzn, 0));
  const deliveryFee = Math.max(0, toNumber(deliveryFeeMzn, 0));

  if (restaurantId) {
    const restaurant = await selectOne('restaurants', 'id', restaurantId);
    const list = Array.isArray(restaurant?.coupons) ? restaurant.coupons : [];
    const coupon = list.find((item: AnyRecord) => item?.active !== false && String(item?.code || '').toUpperCase() === code);
    if (coupon) {
      if (coupon.expires_at && new Date(coupon.expires_at).getTime() < Date.now()) throw new HttpError(400, 'Este cupão expirou.');
      if (Number(coupon.used || 0) >= Number(coupon.limit || Infinity)) throw new HttpError(400, 'Este cupão atingiu o limite de utilizações.');
      if (subtotal < Number(coupon.min || 0)) throw new HttpError(400, `Este cupão requer um pedido mínimo de ${Number(coupon.min || 0).toFixed(2)} MZN.`);
      const discount = coupon.type === 'percentage'
        ? subtotal * Math.min(100, Number(coupon.value || 0)) / 100
        : coupon.type === 'delivery' ? deliveryFee : Math.min(subtotal, Number(coupon.value || 0));
      return { code, discount: Math.max(0, discount), source: 'restaurant', coupon, restaurant, label: `Cupão ${code}` };
    }
  }

  const { data: coupon, error } = await supabase.from('finance_coupons').select('*').eq('code', code).eq('active', true).maybeSingle();
  if (error) throw new HttpError(500, error.message);
  if (!coupon) throw new HttpError(404, 'Cupão inexistente ou indisponível.');
  const now = Date.now();
  if (coupon.starts_at && new Date(coupon.starts_at).getTime() > now) throw new HttpError(400, 'Este cupão ainda não está activo.');
  if (coupon.expires_at && new Date(coupon.expires_at).getTime() < now) throw new HttpError(400, 'Este cupão expirou.');
  if (coupon.total_limit !== null && Number(coupon.usage_count || 0) >= Number(coupon.total_limit)) throw new HttpError(400, 'Este cupão atingiu o limite de utilizações.');
  if (subtotal * 100 < Number(coupon.min_order_cents || 0)) throw new HttpError(400, `Este cupão requer um pedido mínimo de ${(Number(coupon.min_order_cents || 0) / 100).toFixed(2)} MZN.`);
  const restaurantIds = Array.isArray(coupon.restaurant_ids) ? coupon.restaurant_ids.map(String) : [];
  if (restaurantIds.length && (!restaurantId || !restaurantIds.includes(String(restaurantId)))) throw new HttpError(400, 'Este cupão não é válido neste restaurante.');
  if ((coupon.first_order_only || Number(coupon.per_client_limit || 0) > 0) && !client) throw new HttpError(401, 'Entre na sua conta para usar este cupão.');
  if (client) {
    const { count, error: countError } = await supabase.from('coupon_redemptions').select('id', { count: 'exact', head: true }).eq('coupon_id', coupon.id).eq('client_id', client.id).eq('status', 'applied');
    if (countError) throw new HttpError(500, countError.message);
    if (Number(count || 0) >= Number(coupon.per_client_limit || 1)) throw new HttpError(400, 'Já utilizou este cupão o número máximo de vezes.');
    if (coupon.first_order_only) {
      const previousOrders = await countRows('orders', (query) => query.eq('client', client.id).neq('status', ORDER_STATUS.CANCELED));
      if (previousOrders > 0) throw new HttpError(400, 'Este cupão é exclusivo para o primeiro pedido.');
    }
  }
  const type = String(coupon.discount_type || '');
  let discount = type.includes('percent')
    ? subtotal * Math.min(100, Number(coupon.discount_percent || 0)) / 100
    : type.includes('delivery') ? deliveryFee : Number(coupon.discount_value_cents || 0) / 100;
  if (coupon.max_discount_cents !== null) discount = Math.min(discount, Number(coupon.max_discount_cents || 0) / 100);
  discount = Math.min(subtotal + deliveryFee, Math.max(0, discount));
  return { code, discount, source: 'finance', coupon, restaurant: null, label: coupon.name || `Cupão ${code}` };
};

const commitCouponUse = async (resolved: AnyRecord | null, order: AnyRecord, client: AnyRecord | null) => {
  if (!resolved) return;
  if (resolved.source === 'restaurant') {
    const coupons = (resolved.restaurant.coupons || []).map((coupon: AnyRecord) => String(coupon.code || '').toUpperCase() === resolved.code
      ? { ...coupon, used: Number(coupon.used || 0) + 1 }
      : coupon);
    await updateRow('restaurants', resolved.restaurant.id, { coupons });
    return;
  }
  await updateRow('finance_coupons', resolved.coupon.id, { usage_count: Number(resolved.coupon.usage_count || 0) + 1 });
  if (client) {
    await insertRow('coupon_redemptions', {
      coupon_id: resolved.coupon.id,
      client_id: client.id,
      order_id: order.id,
      discount_cents: Math.round(Number(resolved.discount || 0) * 100),
      status: 'applied'
    });
  }
};

const validateFoodOrder = async (restaurantId: string | null, rawItems: unknown) => {
  if (!restaurantId) throw new HttpError(400, 'Restaurante inválido.');
  const restaurant = await selectOne('restaurants', 'id', restaurantId);
  if (!restaurant || restaurant.status !== 'active') throw new HttpError(404, 'Restaurante não encontrado.');
  if (restaurant.is_open === false) throw new HttpError(409, 'O restaurante está fechado para novos pedidos.');
  const requested = Array.isArray(rawItems) ? rawItems.slice(0, 80) : [];
  if (!requested.length) throw new HttpError(400, 'Adicione pelo menos um produto ao pedido.');
  const ids = [...new Set(requested.map((item: AnyRecord) => String(item?.id || '')).filter(isValidId))];
  if (!ids.length) throw new HttpError(400, 'Os produtos do pedido são inválidos.');
  const [{ data: menuRows, error: menuError }, { data: stockRows, error: stockError }, { data: optionRows, error: optionError }] = await Promise.all([
    supabase.from('restaurant_menu_items').select('*').eq('restaurant_id', restaurantId).in('id', ids),
    supabase.from('product_stock').select('*').in('menu_item_id', ids),
    supabase.from('product_options').select('*').in('menu_item_id', ids)
  ]);
  if (menuError) throw new HttpError(500, menuError.message);
  if (stockError) throw new HttpError(500, stockError.message);
  if (optionError) throw new HttpError(500, optionError.message);
  const menus = new Map((menuRows || []).map((row: AnyRecord) => [String(row.id), row]));
  const stocks = new Map((stockRows || []).map((row: AnyRecord) => [String(row.menu_item_id), row]));
  const options = new Map<string, AnyRecord[]>();
  (optionRows || []).forEach((row: AnyRecord) => options.set(String(row.menu_item_id), [...(options.get(String(row.menu_item_id)) || []), row]));
  const normalized: AnyRecord[] = [];
  const stockUpdates: AnyRecord[] = [];
  let subtotal = 0;
  let preparationMinutes = 0;

  for (const request of requested) {
    const id = String(request?.id || '');
    const menu = menus.get(id);
    if (!menu || menu.available === false) throw new HttpError(409, `O produto “${String(request?.name || id)}” já não está disponível.`);
    const quantity = Math.max(1, Math.min(50, Math.floor(toNumber(request?.qty, 1))));
    const stock = stocks.get(id);
    if (stock?.unavailable_until && new Date(stock.unavailable_until).getTime() > Date.now()) throw new HttpError(409, `${menu.name} está temporariamente indisponível.`);
    if (stock?.quantity !== null && stock?.quantity !== undefined && Number(stock.quantity) < quantity) throw new HttpError(409, `Stock insuficiente para ${menu.name}.`);
    const selected = Array.isArray(request?.options) ? request.options : [];
    const selectedByGroup = new Map<string, AnyRecord[]>();
    selected.forEach((entry: AnyRecord) => {
      const key = String(entry?.group || '');
      selectedByGroup.set(key, [...(selectedByGroup.get(key) || []), entry]);
    });
    const acceptedOptions: AnyRecord[] = [];
    let unitPrice = Number(menu.price || 0);
    for (const group of options.get(id) || []) {
      const choices = selectedByGroup.get(String(group.name)) || [];
      if (group.required && choices.length < Math.max(1, Number(group.min_select || 1))) throw new HttpError(400, `Seleccione ${group.name} em ${menu.name}.`);
      if (choices.length > Number(group.max_select || 1)) throw new HttpError(400, `Escolheu opções a mais em ${group.name}.`);
      for (const choice of choices) {
        const value = (Array.isArray(group.values) ? group.values : []).find((candidate: AnyRecord) => String(candidate?.name || '') === String(choice?.name || ''));
        if (!value) throw new HttpError(400, `Uma opção de ${menu.name} já não está disponível.`);
        const price = Math.max(0, Number(value.price || 0));
        unitPrice += price;
        acceptedOptions.push({ group: group.name, name: value.name, price });
      }
    }
    subtotal += unitPrice * quantity;
    preparationMinutes = Math.max(preparationMinutes, Number(menu.prep_time_min || 0));
    normalized.push({ id, name: menu.name, category: menu.category || 'Geral', qty: quantity, base_price: Number(menu.price || 0), price: unitPrice, options: acceptedOptions });
    if (stock && stock.quantity !== null && stock.quantity !== undefined) stockUpdates.push({ id: stock.id, quantity: Number(stock.quantity) - quantity, auto_disable: stock.auto_disable === true });
  }
  if (subtotal < Number(restaurant.min_order_amount || 0)) throw new HttpError(400, `O pedido mínimo deste restaurante é ${Number(restaurant.min_order_amount || 0).toFixed(2)} MZN.`);
  return { restaurant, items: normalized, subtotal, preparationMinutes: preparationMinutes || null, stockUpdates };
};

const commitFoodStock = async (validated: AnyRecord | null) => {
  if (!validated) return;
  for (const stock of validated.stockUpdates || []) {
    await updateRow('product_stock', stock.id, { quantity: Math.max(0, Number(stock.quantity || 0)) });
    if (stock.auto_disable && Number(stock.quantity || 0) <= 0) {
      const current = await selectOne('product_stock', 'id', stock.id);
      if (current?.menu_item_id) await updateRow('restaurant_menu_items', current.menu_item_id, { available: false, unavailable_reason: 'Esgotado' });
    }
  }
};


const routePublicPortals = async (req: Request, path: string, method: string) => {
  if (path === '/api/public/partners' && method === 'GET') {
    const [partnerResult, restaurantResult, menuResult] = await Promise.all([
      supabase.from('trago_partners').select('*').eq('status', 'active').order('name', { ascending: true }),
      supabase.from('restaurants').select('*').eq('status', 'active').order('name', { ascending: true }),
      supabase.from('restaurant_menu_items').select('restaurant_id,name,category,available').eq('available', true).order('name', { ascending: true })
    ]);
    if (partnerResult.error) throw new HttpError(500, partnerResult.error.message);
    if (restaurantResult.error) throw new HttpError(500, restaurantResult.error.message);
    if (menuResult.error) throw new HttpError(500, menuResult.error.message);

    const menuByRestaurant = new Map<string, AnyRecord[]>();
    (menuResult.data || []).forEach((item: AnyRecord) => {
      const key = String(item.restaurant_id || '');
      menuByRestaurant.set(key, [...(menuByRestaurant.get(key) || []), item]);
    });
    const linkedRestaurants = new Set((partnerResult.data || []).map((partner: AnyRecord) => String(partner.restaurant_id || '')).filter(Boolean));
    const listedPartners = (partnerResult.data || []).map((partner: AnyRecord) => {
      const linkedRestaurant = partner.restaurant_id
        ? (restaurantResult.data || []).find((restaurant: AnyRecord) => String(restaurant.id) === String(partner.restaurant_id))
        : null;
      const items = linkedRestaurant ? (menuByRestaurant.get(String(linkedRestaurant.id)) || []) : [];
      const categories = [...new Set(items.map((item: AnyRecord) => String(item.category || '').trim()).filter(Boolean))];
      return {
        ...fromPartner(partner),
        products_summary: partner.products_summary || categories.slice(0, 6).join(', '),
        product_count: items.length,
        address_text: partner.address_text || linkedRestaurant?.address_text || '',
        address_coords: partner.address_coords || linkedRestaurant?.address_coords || null,
        phone: partner.phone || linkedRestaurant?.phone || '',
        whatsapp: partner.whatsapp || linkedRestaurant?.whatsapp || '',
        logo_url: partner.logo_url || linkedRestaurant?.logo_url || '',
        cover_url: partner.cover_url || linkedRestaurant?.cover_url || '',
        opening_hours: partner.opening_hours || linkedRestaurant?.opening_hours || ''
      };
    });
    const restaurantPartners = (restaurantResult.data || [])
      .filter((restaurant: AnyRecord) => !linkedRestaurants.has(String(restaurant.id)))
      .map((restaurant: AnyRecord) => {
        const items = menuByRestaurant.get(String(restaurant.id)) || [];
        const categories = [...new Set(items.map((item: AnyRecord) => String(item.category || '').trim()).filter(Boolean))];
        const restaurantType = String(restaurant.business_type || '').toLowerCase();
        return {
          id: restaurant.id,
          entity_type: 'restaurant',
          entity_id: restaurant.id,
          restaurant_id: restaurant.id,
          name: restaurant.name || '',
          partner_type: restaurantType.includes('bottle') ? 'bottle_store' : 'restaurant',
          summary: restaurant.description || restaurant.operational_note || 'Parceiro TraGo',
          products_summary: categories.slice(0, 6).join(', ') || items.slice(0, 6).map((item: AnyRecord) => item.name).join(', '),
          product_count: items.length,
          phone: restaurant.phone || '',
          whatsapp: restaurant.whatsapp || '',
          email: '',
          address_text: restaurant.address_text || '',
          address_coords: restaurant.address_coords || null,
          logo_url: restaurant.logo_url || '',
          cover_url: restaurant.cover_url || '',
          opening_hours: restaurant.opening_hours || '',
          status: 'active',
          verified: true,
          createdAt: restaurant.created_at,
          updatedAt: restaurant.updated_at
        };
      });
    return json({ partners: [...listedPartners, ...restaurantPartners].sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt')) });
  }

  if (path === '/api/public/partners/applications' && method === 'POST') {
    const body = await readBody(req) as AnyRecord;
    const name = String(clean(body.name) || '').slice(0, 140);
    const productsSummary = String(clean(body.products_summary) || '').slice(0, 700);
    const phone = String(clean(body.phone) || '').slice(0, 40);
    const whatsapp = String(clean(body.whatsapp) || '').slice(0, 40);
    const email = lowerEmail(body.email).slice(0, 180);
    const addressText = String(clean(body.address_text) || '').slice(0, 240);
    const addressCoords = normalizeCoordinates(body.address_coords?.lat ?? body.lat, body.address_coords?.lng ?? body.lng);
    const requestedType = String(body.partner_type || 'other').toLowerCase().replace(/[\s-]+/g, '_');
    const allowedTypes = new Set(['restaurant', 'bottle_store', 'shop', 'market', 'pharmacy', 'bakery', 'florist', 'electronics', 'fashion', 'other']);
    if (name.length < 2 || productsSummary.length < 3 || phone.replace(/\D/g, '').length < 8) {
      throw new HttpError(400, 'Indique o nome, o que o parceiro vende e um contacto válido.');
    }
    if (addressText.length < 5 || !addressCoords) {
      throw new HttpError(400, 'Indique a morada e confirme a localização exacta do estabelecimento.');
    }
    if (email && !/^\S+@\S+\.\S+$/.test(email)) throw new HttpError(400, 'Email inválido.');

    let duplicate: AnyRecord | null = null;
    if (email) {
      const { data, error } = await supabase.from('trago_partners').select('id,status').eq('email', email).in('status', ['pending', 'active']).limit(1);
      if (error) throw new HttpError(500, error.message);
      duplicate = data?.[0] || null;
    }
    if (!duplicate && phone) {
      const { data, error } = await supabase.from('trago_partners').select('id,status').eq('phone', phone).in('status', ['pending', 'active']).limit(1);
      if (error) throw new HttpError(500, error.message);
      duplicate = data?.[0] || null;
    }
    if (duplicate) throw new HttpError(409, duplicate.status === 'active' ? 'Este parceiro já está publicado.' : 'Já existe uma candidatura pendente para este parceiro.');

    const application = await insertRow('trago_partners', {
      name,
      partner_type: allowedTypes.has(requestedType) ? requestedType : 'other',
      summary: String(clean(body.summary) || '').slice(0, 1000),
      products_summary: productsSummary,
      phone,
      whatsapp,
      email,
      address_text: addressText,
      address_coords: addressCoords,
      opening_hours: String(clean(body.opening_hours) || '').slice(0, 1000),
      status: 'pending',
      source: 'application'
    });
    return json({
      message: 'Candidatura recebida. A TraGo irá validar os dados antes da publicação.',
      application: { id: application.id, name: application.name, status: application.status }
    }, 201);
  }

  if (path === '/api/public/restaurants' && method === 'GET') {
    const { data: restaurants, error: restaurantError } = await supabase
      .from('restaurants')
      .select('*')
      .eq('status', 'active')
      .order('created_at', { ascending: false });
    if (restaurantError) throw new HttpError(500, restaurantError.message);

    const { data: menuItems, error: menuError } = await supabase
      .from('restaurant_menu_items')
      .select('*')
      .eq('available', true)
      .order('created_at', { ascending: false })
      .order('category', { ascending: true })
      .order('name', { ascending: true });
    if (menuError) throw new HttpError(500, menuError.message);

    const menuIds = (menuItems || []).map((item: AnyRecord) => item.id);
    let stockRows: AnyRecord[] = [];
    let optionRows: AnyRecord[] = [];
    if (menuIds.length) {
      const [stockResult, optionResult] = await Promise.all([
        supabase.from('product_stock').select('*').in('menu_item_id', menuIds),
        supabase.from('product_options').select('*').in('menu_item_id', menuIds).order('created_at', { ascending: true })
      ]);
      if (stockResult.error) throw new HttpError(500, stockResult.error.message);
      if (optionResult.error) throw new HttpError(500, optionResult.error.message);
      stockRows = stockResult.data || [];
      optionRows = optionResult.data || [];
    }
    const stockByItem = new Map(stockRows.map((stock: AnyRecord) => [String(stock.menu_item_id), stock]));
    const optionsByItem = new Map<string, AnyRecord[]>();
    optionRows.forEach((option: AnyRecord) => {
      const key = String(option.menu_item_id);
      optionsByItem.set(key, [...(optionsByItem.get(key) || []), option]);
    });

    let ratings: AnyRecord[] = [];
    const { data: ratingRows, error: ratingError } = await supabase
      .from('restaurant_ratings')
      .select('*');
    if (!ratingError) ratings = ratingRows || [];

    const restaurantStats = new Map<string, AnyRecord>();
    const menuStats = new Map<string, AnyRecord>();
    const addRating = (map: Map<string, AnyRecord>, key: string, rating: number) => {
      if (!key) return;
      const current = map.get(key) || { total: 0, count: 0, average: 0 };
      current.total += Number(rating || 0);
      current.count += 1;
      current.average = current.count ? current.total / current.count : 0;
      map.set(key, current);
    };
    ratings.forEach((row: AnyRecord) => {
      addRating(restaurantStats, String(row.restaurant_id || ''), Number(row.rating || 0));
      if (row.menu_item_id) addRating(menuStats, String(row.menu_item_id || ''), Number(row.rating || 0));
    });
    const attachRating = (target: AnyRecord, stats?: AnyRecord) => ({
      ...target,
      average_rating: stats ? Number(Number(stats.average || 0).toFixed(1)) : 0,
      rating_count: stats ? Number(stats.count || 0) : 0
    });

    const payload = (restaurants || []).map((restaurant: AnyRecord) => {
      const safeRestaurant = attachRating(fromRestaurant(restaurant) as AnyRecord, restaurantStats.get(String(restaurant.id)));
      delete safeRestaurant.email;
      return {
        ...safeRestaurant,
        menuItems: (menuItems || [])
          .filter((item: AnyRecord) => item.restaurant_id === restaurant.id)
          .map((item: AnyRecord) => {
            const stock = stockByItem.get(String(item.id)) || null;
            const unavailableUntil = stock?.unavailable_until ? new Date(stock.unavailable_until).getTime() : 0;
            const unavailable = Boolean(
              (stock?.auto_disable && stock?.quantity !== null && Number(stock.quantity) <= 0)
              || (unavailableUntil && unavailableUntil > Date.now())
            );
            if (unavailable) return null;
            return {
              ...attachRating(fromMenuItem(item) as AnyRecord, menuStats.get(String(item.id))),
              stock,
              options: optionsByItem.get(String(item.id)) || []
            };
          })
          .filter(Boolean)
      };
    }).filter((restaurant: AnyRecord) => (restaurant.menuItems || []).length > 0);

    return json({ restaurants: payload });
  }

  if (path === '/api/public/geo/search' && method === 'GET') {
    const requestUrl = new URL(req.url);
    const query = String(requestUrl.searchParams.get('q') || '').trim();
    const limit = Math.max(1, Math.min(12, Math.round(toNumber(requestUrl.searchParams.get('limit'), 8))));
    if (query.length < 3) return json({ suggestions: [] });

    const searchUrl = new URL('https://nominatim.openstreetmap.org/search');
    searchUrl.searchParams.set('format', 'jsonv2');
    searchUrl.searchParams.set('q', query);
    searchUrl.searchParams.set('countrycodes', 'mz');
    searchUrl.searchParams.set('addressdetails', '1');
    searchUrl.searchParams.set('limit', String(limit));
    searchUrl.searchParams.set('accept-language', 'pt');
    searchUrl.searchParams.set('viewbox', '32.20,-25.60,33.10,-26.25');
    searchUrl.searchParams.set('bounded', '0');

    try {
      const response = await fetch(searchUrl.toString(), {
        headers: {
          Accept: 'application/json',
          'Accept-Language': 'pt-MZ,pt;q=0.9',
          'User-Agent': 'TraGoDelivery/2.0'
        },
        signal: AbortSignal.timeout(9000)
      });
      if (!response.ok) throw new Error(`Serviço de mapas indisponível (${response.status}).`);
      const data = await response.json().catch(() => []);
      const suggestions = (Array.isArray(data) ? data : [])
        .slice(0, limit)
        .map((item: AnyRecord) => {
          const label = String(item?.display_name || '').trim();
          return {
            label,
            short_label: label.split(',').slice(0, 2).join(',').trim() || label,
            lat: Number(item?.lat),
            lng: Number(item?.lon),
            provider: 'openstreetmap_nominatim',
            external_id: item?.osm_id ? String(item.osm_id) : ''
          };
        })
        .filter((item: AnyRecord) => item.label && isValidCoordinate(item));
      return json({ suggestions });
    } catch (error) {
      console.warn('[trago-edge] address search unavailable', error);
      return json({ suggestions: [], warning: 'A pesquisa automática de endereços está temporariamente indisponível.' });
    }
  }

  if (path === '/api/public/geo/reverse' && method === 'GET') {
    const requestUrl = new URL(req.url);
    const latRaw = requestUrl.searchParams.get('lat');
    const lngRaw = requestUrl.searchParams.get('lng');
    const lat = Number(latRaw);
    const lng = Number(lngRaw);
    if (!latRaw || !lngRaw || !Number.isFinite(lat) || !Number.isFinite(lng)
      || lat < -90 || lat > 90 || lng < -180 || lng > 180
      || (Math.abs(lat) < 0.000001 && Math.abs(lng) < 0.000001)) {
      throw new HttpError(400, 'Indique coordenadas válidas para confirmar a morada.');
    }
    const reverseUrl = new URL('https://nominatim.openstreetmap.org/reverse');
    reverseUrl.searchParams.set('format', 'jsonv2');
    reverseUrl.searchParams.set('lat', String(lat));
    reverseUrl.searchParams.set('lon', String(lng));
    reverseUrl.searchParams.set('zoom', '18');
    reverseUrl.searchParams.set('addressdetails', '1');
    reverseUrl.searchParams.set('accept-language', 'pt');
    try {
      const response = await fetch(reverseUrl.toString(), {
        headers: {
          Accept: 'application/json',
          'Accept-Language': 'pt-MZ,pt;q=0.9',
          'User-Agent': 'TraGoDelivery/2.0'
        },
        signal: AbortSignal.timeout(9000)
      });
      if (!response.ok) throw new Error(`Serviço de mapas indisponível (${response.status}).`);
      const data = await response.json().catch(() => ({})) as AnyRecord;
      const label = String(data?.display_name || '').trim() || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      return json({
        label,
        short_label: label.split(',').slice(0, 2).join(',').trim() || label,
        lat,
        lng,
        provider: 'openstreetmap_nominatim'
      });
    } catch (error) {
      console.warn('[trago-edge] reverse geocoding unavailable', error);
      return json({
        label: `Ponto no mapa · ${lat.toFixed(5)}, ${lng.toFixed(5)}`,
        short_label: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
        lat,
        lng,
        provider: 'coordinate_fallback',
        warning: 'A morada textual não pôde ser confirmada neste momento.'
      });
    }
  }


  if (path === '/api/public/geo/quote' && method === 'POST') {
    const body = await readBody(req) as AnyRecord;
    const quote = await buildRouteQuote(body.origin, body.destination);
    return json(quote);
  }

  if (path === '/api/public/coupons/validate' && method === 'POST') {
    const body = await readBody(req) as AnyRecord;
    const restaurantId = isValidId(String(body.restaurant_id || '')) ? String(body.restaurant_id) : null;
    const client = await optionalClient(req);
    const resolved = await resolveCoupon(body.code, restaurantId, toNumber(body.subtotal, 0), toNumber(body.delivery_fee, 0), client);
    return json({
      valid: true,
      code: resolved?.code || '',
      label: resolved?.label || '',
      discount: Number(resolved?.discount || 0),
      source: resolved?.source || ''
    });
  }

  if (path === '/api/public/geo/route' && method === 'POST') {
    const body = await readBody(req) as AnyRecord;
    if (!isValidCoordinate(body.origin) || !isValidCoordinate(body.destination)) {
      throw new HttpError(400, 'Indique uma origem e um destino válidos.');
    }
    const route = await buildRouteGeometry(body.origin, body.destination);
    return json(route);
  }

  if (path === '/api/public/ratings' && method === 'POST') {
    const body = await readBody(req) as AnyRecord;
    const ratingValue = Math.max(1, Math.min(5, Math.round(toNumber(body.rating, 0))));
    if (!ratingValue) throw new HttpError(400, 'A avaliação deve estar entre 1 e 5 estrelas.');

    let restaurantId = clean(body.restaurant_id) || '';
    const menuItemId = clean(body.menu_item_id) || '';
    const customerSessionId = clean(body.customer_session_id) || req.headers.get('x-forwarded-for') || 'anonymous';
    if (!restaurantId && !menuItemId) throw new HttpError(400, 'Indique o restaurante ou o prato a avaliar.');

    if (menuItemId) {
      const menuItem = await selectOne('restaurant_menu_items', 'id', menuItemId);
      if (!menuItem) throw new HttpError(404, 'Prato não encontrado.');
      restaurantId = restaurantId || String(menuItem.restaurant_id || '');
    }

    const restaurant = await selectOne('restaurants', 'id', restaurantId);
    if (!restaurant || restaurant.status !== 'active') throw new HttpError(404, 'Restaurante não encontrado.');

    const { data: existing, error: existingError } = await supabase
      .from('restaurant_ratings')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .eq('menu_item_id', menuItemId)
      .eq('customer_session_id', customerSessionId)
      .maybeSingle();
    if (existingError) throw new HttpError(500, existingError.message);

    if (existing) {
      const updated = await updateRow('restaurant_ratings', existing.id, {
        rating: ratingValue,
        comment: clean(body.comment) || ''
      });
      return json({ message: 'Avaliação guardada com sucesso.', rating: updated });
    }

    const rating = await insertRow('restaurant_ratings', {
      restaurant_id: restaurantId,
      menu_item_id: menuItemId,
      customer_session_id: customerSessionId,
      rating: ratingValue,
      comment: clean(body.comment) || ''
    });
    return json({ message: 'Avaliação guardada com sucesso.', rating }, 201);
  }

  const publicContextMatch = path.match(/^\/api\/public\/orders\/([a-f0-9]{24})\/context$/i);
  if (publicContextMatch && method === 'GET') {
    const order = await selectOne('orders', 'id', publicContextMatch[1]);
    if (!order) throw new HttpError(404, 'Pedido não encontrado.');
    await requirePublicOrderAccess(req, order);
    const profile = order.assigned_to_driver ? await selectOne('driver_profiles', 'id', order.assigned_to_driver) : null;
    const presence = profile ? await selectOne('driver_presence', 'driver_profile_id', profile.id) : null;
    const restaurant = order.restaurant_id ? await selectOne('restaurants', 'id', order.restaurant_id) : null;
    const publicStatusLabels = new Set(['Pedido confirmado', 'Em preparação', 'A caminho', 'Entregue', 'Cancelado']);
    const { data: statusEvents, error: statusEventsError } = await supabase
      .from('order_status_events')
      .select('id,status,label,actor_type,created_at')
      .eq('order_id', order.id)
      .order('created_at', { ascending: true })
      .limit(100);
    if (statusEventsError) throw new HttpError(500, statusEventsError.message);
    return json({
      order: fromOrder(order),
      driver: profile ? await publicAssignedDriver(profile, 0, presence) : null,
      status_history: (statusEvents || [])
        .filter((event: AnyRecord) => publicStatusLabels.has(String(event.label || '')))
        .map((event: AnyRecord) => ({
          id: event.id,
          status: event.status,
          label: event.label,
          actor_type: event.actor_type,
          created_at: event.created_at
        })),
      restaurant: restaurant ? { id: restaurant.id, name: restaurant.name, phone: restaurant.phone || '', logo_url: restaurant.logo_url || '' } : null
    });
  }

  const publicMessagesMatch = path.match(/^\/api\/public\/orders\/([a-f0-9]{24})\/messages$/i);
  if (publicMessagesMatch && method === 'GET') {
    const order = await selectOne('orders', 'id', publicMessagesMatch[1]);
    if (!order) throw new HttpError(404, 'Pedido não encontrado.');
    await requirePublicOrderAccess(req, order);
    return json({
      channel: MESSAGE_CHANNEL.CLIENT_DRIVER,
      messages: await listOrderMessages(order.id, 'client', MESSAGE_CHANNEL.CLIENT_DRIVER, true)
    });
  }

  if (publicMessagesMatch && method === 'POST') {
    const order = await selectOne('orders', 'id', publicMessagesMatch[1]);
    if (!order) throw new HttpError(404, 'Pedido não encontrado.');
    await requirePublicOrderAccess(req, order);
    const body = await readBody(req) as AnyRecord;
    const message = await createOrderMessage(
      order.id,
      'client',
      order.client || `public:${order.id}`,
      order.client_name || 'Cliente',
      body.message,
      'text',
      {},
      MESSAGE_CHANNEL.CLIENT_DRIVER
    );
    await broadcastAdmin('order_message_created', { orderId: order.id, messageId: message.id, senderRole: 'client' });
    if (order.assigned_to_driver) {
      const profile = await selectOne('driver_profiles', 'id', order.assigned_to_driver);
      if (profile?.user_id) await broadcastDriver(profile.user_id, 'order_message_created', { orderId: order.id, messageId: message.id, senderRole: 'client' });
    }
    return json({ message: fromOrderMessage(message) }, 201);
  }

  const publicCancelMatch = path.match(/^\/api\/public\/orders\/([a-f0-9]{24})\/cancel$/i);
  if (publicCancelMatch && method === 'POST') {
    const order = await selectOne('orders', 'id', publicCancelMatch[1]);
    if (!order) throw new HttpError(404, 'Pedido não encontrado.');
    await requirePublicOrderAccess(req, order);
    if (![ORDER_STATUS.PENDING, ORDER_STATUS.ASSIGNED].includes(order.status)) throw new HttpError(409, 'O pedido já está em operação. Contacte o suporte para solicitar o cancelamento.');
    if (['preparing', 'ready'].includes(order.restaurant_status)) throw new HttpError(409, 'O restaurante já iniciou a preparação. Contacte o suporte para solicitar o cancelamento.');
    const body = await readBody(req) as AnyRecord;
    const reason = String(body.reason || 'Cancelado pelo cliente').slice(0, 500);
    const updated = await updateRow('orders', order.id, {
      status: ORDER_STATUS.CANCELED,
      cancelled_at: nowIso(),
      cancel_reason: reason,
      offered_to_driver: null,
      driver_offer_status: null,
      driver_offer_expires_at: null
    });
    await cancelPendingDriverOffers(order.id);
    const affectedDriverId = order.assigned_to_driver || order.offered_to_driver;
    if (affectedDriverId) {
      const profile = await selectOne('driver_profiles', 'id', affectedDriverId);
      if (profile) {
        const updatedProfile = await updateRow('driver_profiles', profile.id, { status: DRIVER_STATUS.ONLINE_FREE });
        await upsertDriverPresence(updatedProfile, { current_order_id: null, is_available: true });
      }
    }
    const message = await createOrderMessage(order.id, 'system', 'system', 'TraGo', 'O cliente cancelou este pedido.', 'status', { status: ORDER_STATUS.CANCELED });
    await createAdminNotification({ dedupeKey: `client_cancel:${order.id}`, type: 'warning', title: `Pedido ${shortOrderCode(order.id)} cancelado pelo cliente`, message: reason, order: updated });
    await createClientNotification(updated, 'warning', 'Pedido cancelado', reason, { status: updated.status });
    await broadcastAdmin('order_status_changed', { orderId: order.id, status: ORDER_STATUS.CANCELED, messageId: message.id });
    return json({ message: 'Pedido cancelado.', order: fromOrder(updated) });
  }

  const radarMatch = path.match(/^\/api\/public\/orders\/([a-f0-9]{24})\/radar-assign$/i);
  if (radarMatch && method === 'POST') {
    const order = await selectOne('orders', 'id', radarMatch[1]);
    if (!order) throw new HttpError(404, 'Pedido não encontrado.');

    await requirePublicOrderAccess(req, order);

    if (order.assigned_to_driver) {
      const assignedProfile = await selectOne('driver_profiles', 'id', order.assigned_to_driver);
      return json({
        assigned: true,
        already_assigned: true,
        order: fromOrder(order),
        driver: await publicAssignedDriver(assignedProfile, 0)
      });
    }

    const target = order.pickup_address_coords || order.address_coords;
    if (!isValidCoordinate(target)) {
      return json({ assigned: false, reason: 'missing_coordinates', candidates_checked: 0 });
    }

    await supabase.rpc('trago_expire_driver_offers');
    const heartbeatCutoff = new Date(Date.now() - RADAR_HEARTBEAT_TTL_MS).toISOString();
    const locationCutoff = new Date(Date.now() - RADAR_LOCATION_TTL_MS).toISOString();
    const { data: presences, error } = await supabase
      .from('driver_presence')
      .select('*')
      .eq('is_online', true)
      .eq('is_available', true)
      .is('current_order_id', null)
      .gte('last_seen_at', heartbeatCutoff)
      .gte('location_updated_at', locationCutoff)
      .not('latitude', 'is', null)
      .not('longitude', 'is', null);
    if (error) throw new HttpError(500, error.message);

    const rejectedIds = new Set((Array.isArray(order.driver_offer_rejected_ids) ? order.driver_offer_rejected_ids : []).map(String));
    const candidates: AnyRecord[] = [];
    for (const presence of presences || []) {
      const profile = await selectOne('driver_profiles', 'id', presence.driver_profile_id);
      if (!profile) continue;
      if (profile.account_status === 'inactive' || profile.approval_status === 'rejected') continue;
      const location = { lat: Number(presence.latitude), lng: Number(presence.longitude) };
      const distanceKm = isValidCoordinate(location) ? haversineKm(target, location) : Infinity;
      candidates.push({ profile, presence, distance_km: distanceKm });
    }
    const nonRejectedCandidates = candidates
      .filter((entry: AnyRecord) => Number.isFinite(entry.distance_km) && entry.distance_km <= RADAR_EXPANDED_RADIUS_KM)
      .filter((entry: AnyRecord) => !rejectedIds.has(String(entry.profile.id)))
      .sort((a: AnyRecord, b: AnyRecord) => a.distance_km - b.distance_km);
    const primaryCandidates = nonRejectedCandidates
      .filter((entry: AnyRecord) => entry.distance_km <= RADAR_PRIMARY_RADIUS_KM);
    const eligibleCandidates = primaryCandidates.length ? primaryCandidates : nonRejectedCandidates;
    const radiusExpanded = primaryCandidates.length === 0 && eligibleCandidates.length > 0;
    const searchRadiusKm = radiusExpanded ? RADAR_EXPANDED_RADIUS_KM : RADAR_PRIMARY_RADIUS_KM;
    if (!eligibleCandidates.length) {
      return json({
        assigned: false,
        reason: 'no_free_driver_in_25km',
        candidates_checked: (presences || []).length,
        in_radius: 0,
        candidates: [],
        heartbeat_cutoff_seconds: RADAR_HEARTBEAT_TTL_MS / 1000,
        location_cutoff_seconds: RADAR_LOCATION_TTL_MS / 1000,
        search_radius_km: RADAR_EXPANDED_RADIUS_KM,
        radius_expanded: true
      });
    }

    const publicCandidates = [];
    for (const candidate of eligibleCandidates) {
      publicCandidates.push(await publicAssignedDriver(candidate.profile, candidate.distance_km, candidate.presence));
    }
    return json({
      assigned: false,
      requires_client_choice: true,
      order: fromOrder(order),
      candidates_checked: (presences || []).length,
      in_radius: publicCandidates.length,
      candidates: publicCandidates,
      heartbeat_cutoff_seconds: RADAR_HEARTBEAT_TTL_MS / 1000,
      location_cutoff_seconds: RADAR_LOCATION_TTL_MS / 1000,
      search_radius_km: searchRadiusKm,
      radius_expanded: radiusExpanded
    });
  }

  const driverOfferMatch = path.match(/^\/api\/public\/orders\/([a-f0-9]{24})\/driver-offer$/i);
  if (driverOfferMatch && method === 'POST') {
    const order = await selectOne('orders', 'id', driverOfferMatch[1]);
    if (!order) throw new HttpError(404, 'Pedido não encontrado.');
    await requirePublicOrderAccess(req, order);
    if (order.assigned_to_driver || order.status !== ORDER_STATUS.PENDING) {
      throw new HttpError(409, 'Este pedido já não está disponível para escolher motorista.');
    }

    const body = await readBody(req) as AnyRecord;
    const driverId = String(body.driverId || '');
    const rejectedIds = new Set((Array.isArray(order.driver_offer_rejected_ids) ? order.driver_offer_rejected_ids : []).map(String));
    if (rejectedIds.has(driverId)) throw new HttpError(409, 'Este motorista já recusou o pedido. Escolha outro motorista.');
    const profile = await selectOne('driver_profiles', 'id', driverId);
    const { data: presence, error: presenceError } = await supabase
      .from('driver_presence')
      .select('*')
      .eq('driver_profile_id', driverId)
      .maybeSingle();
    if (presenceError) throw new HttpError(500, presenceError.message);
    const presenceFresh = presence?.last_seen_at
      && presence?.location_updated_at
      && Date.now() - new Date(presence.last_seen_at).getTime() <= RADAR_HEARTBEAT_TTL_MS
      && Date.now() - new Date(presence.location_updated_at).getTime() <= RADAR_LOCATION_TTL_MS;
    if (!profile || profile.account_status === 'inactive' || profile.approval_status === 'rejected' || !presence || !presenceFresh || !presence.is_online || !presence.is_available) {
      throw new HttpError(409, 'O motorista já não está online e livre.');
    }
    const driverLocation = { lat: Number(presence.latitude), lng: Number(presence.longitude) };
    const target = order.pickup_address_coords || order.address_coords;
    if (!isValidCoordinate(target) || !isValidCoordinate(driverLocation) || haversineKm(target, driverLocation) > RADAR_EXPANDED_RADIUS_KM) {
      throw new HttpError(409, 'O motorista já não está dentro do raio máximo de 25 km deste pedido.');
    }

    const expiresAt = new Date(Date.now() + 90 * 1000).toISOString();
    const { data: offer, error: offerError } = await supabase.rpc('trago_create_driver_offer', {
      p_order_id: order.id,
      p_driver_profile_id: profile.id,
      p_selected_by_role: 'client',
      p_selected_by_id: order.client || `public:${order.id}`,
      p_expires_at: expiresAt
    });
    if (offerError) throw new HttpError(409, offerError.message);
    const offerRow = Array.isArray(offer) ? offer[0] : offer;
    const updated = await selectOne('orders', 'id', order.id);
    await broadcastDriver(profile.user_id, 'nova_oferta_entrega', {
      orderId: order.id,
      offerId: offerRow?.id || null,
      clientName: order.client_name,
      serviceType: order.service_type,
      paymentMethod: order.payment_method,
      price: Number(order.price || 0),
      pickup: order.pickup_address_text || '',
      delivery: order.address_text || '',
      expiresAt
    });
    await broadcastAdmin('orders_changed', { orderId: order.id, action: 'driver_offer_created' });
    return json({
      offered: true,
      order: fromOrder(updated),
      driver: await publicAssignedDriver(profile, haversineKm(target, driverLocation), presence),
      offer_id: offerRow?.id || null,
      expires_at: offerRow?.expires_at || expiresAt
    });
  }

  if (path === '/api/public/restaurants/register' && method === 'POST') {
    const body = await readBody(req) as AnyRecord;
    requiredFields(body, ['name', 'email', 'phone', 'password']);
    if (String(body.password || '').length < 6) throw new HttpError(400, 'A password deve ter pelo menos 6 caracteres.');
    const email = lowerEmail(body.email);
    const existing = await selectOne('restaurants', 'email', email);
    if (existing) throw new HttpError(400, 'Já existe um restaurante com este email.');
    const restaurant = await insertRow('restaurants', {
      name: clean(body.name),
      email,
      phone: clean(body.phone),
      password_hash: bcrypt.hashSync(String(body.password), 12),
      address_text: clean(body.address_text) || '',
      address_coords: body.address_coords || null,
      logo_url: clean(body.logo_url) || '',
      cover_url: clean(body.cover_url) || '',
      status: 'active'
    });
    return json({ restaurant: fromRestaurant(restaurant), token: await generateRestaurantToken(restaurant) }, 201);
  }

  if (path === '/api/public/restaurants/login' && method === 'POST') {
    const body = await readBody(req) as AnyRecord;
    requiredFields(body, ['email', 'password']);
    const restaurant = await selectOne('restaurants', 'email', lowerEmail(body.email));
    if (!restaurant || restaurant.status !== 'active' || !bcrypt.compareSync(String(body.password), String(restaurant.password_hash || ''))) {
      throw new HttpError(401, 'Credenciais inválidas.');
    }
    return json({ restaurant: fromRestaurant(restaurant), token: await generateRestaurantToken(restaurant) });
  }

  if (path === '/api/public/orders' && method === 'POST') {
    const body = await readBody(req) as AnyRecord;
    requiredFields(body, ['service_type', 'client_name', 'client_phone1', 'price']);
    const authenticatedClient = await optionalClient(req);

    let coordinates = normalizeCoordinates(body.lat, body.lng);
    let pickupCoordinates = normalizeCoordinates(body.pickup_lat, body.pickup_lng);
    let restaurantId = isValidId(String(body.restaurant_id || '')) ? String(body.restaurant_id) : null;
    const isFoodOrder = String(body.service_type || '') === 'restaurante_comida';
    const validatedFood = isFoodOrder
      ? await validateFoodOrder(restaurantId, body.food_items)
      : null;
    let partnerId: string | null = null;
    let purchaseSourceType = isFoodOrder ? 'catalog_product' : String(body.purchase_source_type || '');
    let purchaseSourceLabel = '';
    let purchaseSourceCoords: AnyRecord | null = null;
    let requestedProduct = '';
    let pickupAddressText = String(clean(body.pickup_address_text) || '').slice(0, 240);

    if (!coordinates || String(clean(body.address_text) || '').length < 5) {
      throw new HttpError(400, 'Seleccione no mapa um ponto de entrega válido.');
    }

    if (isFoodOrder) {
      const restaurantCoords = validatedFood?.restaurant?.address_coords;
      pickupCoordinates = pickupCoordinates || normalizeCoordinates(restaurantCoords?.lat, restaurantCoords?.lng);
      pickupAddressText = pickupAddressText || String(validatedFood?.restaurant?.address_text || '').slice(0, 240);
      if (!pickupCoordinates || pickupAddressText.length < 5) {
        throw new HttpError(409, 'Este estabelecimento ainda não configurou a localização exacta de recolha.');
      }
      purchaseSourceLabel = String(validatedFood?.restaurant?.name || 'Restaurante').slice(0, 180);
      purchaseSourceCoords = pickupCoordinates;
      requestedProduct = (validatedFood?.items || []).map((item: AnyRecord) => `${item.qty}× ${item.name}`).join(', ').slice(0, 700);
    } else {
      const cargoCategory = String(clean(body.cargo_category || body.service_type) || '').slice(0, 80);
      requestedProduct = String(clean(body.requested_product || body.cargo_description) || '').slice(0, 700);
      if (!cargoCategory || requestedProduct.length < 3) {
        throw new HttpError(400, 'Escolha a categoria e descreva exactamente o produto ou carga.');
      }
      if (!pickupCoordinates || pickupAddressText.length < 5) {
        throw new HttpError(400, 'Seleccione um parceiro ou marque no mapa o ponto exacto de compra/recolha.');
      }
      if (purchaseSourceType === 'partner') {
        if (isValidId(String(body.partner_id || ''))) {
          const partner = await selectOne('trago_partners', 'id', String(body.partner_id));
          if (!partner || partner.status !== 'active') throw new HttpError(404, 'Parceiro TraGo não encontrado ou indisponível.');
          partnerId = partner.id;
          const partnerCoords = normalizeCoordinates(partner.address_coords?.lat, partner.address_coords?.lng);
          if (!partnerCoords || String(partner.address_text || '').trim().length < 5) {
            throw new HttpError(409, 'Este parceiro ainda não tem uma localização exacta configurada.');
          }
          pickupCoordinates = partnerCoords;
          pickupAddressText = String(partner.address_text).slice(0, 240);
          purchaseSourceLabel = String(partner.name || '').slice(0, 180);
          purchaseSourceCoords = partnerCoords;
          if (partner.restaurant_id && isValidId(String(partner.restaurant_id))) restaurantId = String(partner.restaurant_id);
        } else if (restaurantId) {
          const partnerRestaurant = await selectOne('restaurants', 'id', restaurantId);
          if (!partnerRestaurant || partnerRestaurant.status !== 'active') throw new HttpError(404, 'Parceiro TraGo não encontrado ou indisponível.');
          const partnerCoords = normalizeCoordinates(partnerRestaurant.address_coords?.lat, partnerRestaurant.address_coords?.lng);
          if (!partnerCoords || String(partnerRestaurant.address_text || '').trim().length < 5) {
            throw new HttpError(409, 'Este parceiro ainda não tem uma localização exacta configurada.');
          }
          pickupCoordinates = partnerCoords;
          pickupAddressText = String(partnerRestaurant.address_text).slice(0, 240);
          purchaseSourceLabel = String(partnerRestaurant.name || '').slice(0, 180);
          purchaseSourceCoords = partnerCoords;
        } else {
          throw new HttpError(400, 'Seleccione um parceiro TraGo válido.');
        }
      } else if (purchaseSourceType === 'map_location') {
        purchaseSourceLabel = String(clean(body.purchase_source_label) || pickupAddressText).slice(0, 180);
        purchaseSourceCoords = pickupCoordinates;
      } else {
        throw new HttpError(400, 'Seleccione um parceiro TraGo ou marque o ponto de compra/recolha no mapa.');
      }
    }
    const baseServicePrice = validatedFood?.subtotal ?? toNumber(body.service_price ?? body.price, 0);
    let routeQuote: AnyRecord = {
      distance_km: toNumber(body.route_distance_km, 0),
      duration_min: toNumber(body.route_duration_min, 0) || null,
      delivery_fee: toNumber(body.delivery_fee, 0),
      source: 'frontend_public'
    };
    if (pickupCoordinates && coordinates) routeQuote = await buildRouteQuote(pickupCoordinates, coordinates);

    const rawPayment = String(body.payment_method || '').trim();
    const paymentMethod = ALLOWED_PAYMENT_METHODS.has(rawPayment) && rawPayment !== 'postpaid_credit' ? rawPayment : 'cash';
    const coupon = body.coupon_code
      ? await resolveCoupon(body.coupon_code, restaurantId, baseServicePrice, toNumber(routeQuote.delivery_fee, 0), authenticatedClient)
      : null;
    const totalOrderPrice = Math.max(0, baseServicePrice + toNumber(routeQuote.delivery_fee, 0) - Number(coupon?.discount || 0));
    const scheduledAt = body.scheduled_at ? new Date(String(body.scheduled_at)) : null;
    if (scheduledAt && (!Number.isFinite(scheduledAt.getTime()) || scheduledAt.getTime() < Date.now() + 15 * 60 * 1000)) {
      throw new HttpError(400, 'A entrega agendada deve ter pelo menos 15 minutos de antecedência.');
    }
    const routeStops = Array.isArray(body.route_stops)
      ? body.route_stops.slice(0, 5).map((stop: AnyRecord) => ({
        address: String(stop?.address || '').trim().slice(0, 180),
        lat: Number.isFinite(Number(stop?.lat)) ? Number(stop.lat) : null,
        lng: Number.isFinite(Number(stop?.lng)) ? Number(stop.lng) : null
      })).filter((stop: AnyRecord) => stop.address)
      : [];

    const publicAccessToken = generateOrderAccessToken();
    const orderRow = await insertRow('orders', {
      service_type: clean(body.service_type),
      price: toNumber(totalOrderPrice, 0),
      service_price: baseServicePrice,
      delivery_fee: toNumber(routeQuote.delivery_fee, 0),
      route_distance_km: toNumber(routeQuote.distance_km, 0),
      route_duration_min: routeQuote.duration_min || null,
      route_pricing_source: routeQuote.source || 'fallback_public',
      client_name: clean(body.client_name),
      client_phone1: clean(body.client_phone1),
      client_phone2: clean(body.client_phone2) || '',
      client_notes: String(body.client_notes || body.notes || '').trim().slice(0, 1000),
      pickup_address_text: pickupAddressText,
      pickup_address_coords: pickupCoordinates,
      pickup_contact_name: clean(body.pickup_contact_name) || '',
      pickup_contact_phone: clean(body.pickup_contact_phone) || '',
      pickup_notes: clean(body.pickup_notes) || '',
      address_text: clean(body.address_text) || '',
      address_coords: coordinates,
      image_url: clean(body.image_url) || null,
      verification_code: generateVerificationCode(),
      created_by_admin: null,
      assigned_to_driver: null,
      restaurant_id: restaurantId,
      restaurant_status: restaurantId ? 'new' : null,
      partner_id: partnerId,
      purchase_source_type: purchaseSourceType,
      purchase_source_label: purchaseSourceLabel,
      purchase_source_coords: purchaseSourceCoords,
      requested_product: requestedProduct,
      public_access_token_hash: await hashOrderAccessToken(publicAccessToken),
      client: authenticatedClient?.id || null,
      status: ORDER_STATUS.PENDING,
      payment_method: paymentMethod,
      payment_status: PAYMENT_STATUS.UNPAID,
      scheduled_at: scheduledAt ? scheduledAt.toISOString() : null,
      route_stops: routeStops,
      coupon_code: coupon?.code || '',
      coupon_discount: Number(coupon?.discount || 0),
      cargo_category: String(body.cargo_category || '').slice(0, 80),
      cargo_description: requestedProduct,
      food_items: validatedFood?.items || (Array.isArray(body.food_items) ? body.food_items.slice(0, 80) : []),
      food_subtotal: validatedFood?.subtotal ?? toNumber(body.food_subtotal ?? body.service_price, 0),
      estimated_preparation_minutes: validatedFood?.preparationMinutes || (body.estimated_preparation_minutes
        ? Math.max(1, Math.min(360, toNumber(body.estimated_preparation_minutes, 30)))
        : null)
    });
    try {
      await commitFoodStock(validatedFood);
    } catch (stockError) {
      console.error('[trago-edge] Pedido criado, mas falhou a actualização do stock.', stockError);
    }
    try {
      await commitCouponUse(coupon, orderRow, authenticatedClient);
    } catch (couponError) {
      console.error('[trago-edge] Pedido criado, mas falhou o registo de utilização do cupão.', couponError);
    }

    await createAdminNotification({
      dedupeKey: `new_order:${orderRow.id}`,
      type: 'order',
      title: body.public_source === 'client_food' ? 'Novo pedido de comida' : 'Novo pedido do cliente',
      message: `Pedido ${shortOrderCode(orderRow.id)} · ${orderRow.client_name || 'Cliente'} · ${paymentMethodLabel(orderRow.payment_method)}.`,
      order: orderRow,
      payload: {
        clientName: orderRow.client_name,
        amount: Number(orderRow.price || 0),
        paymentMethod: orderRow.payment_method,
        publicSource: body.public_source || 'client',
        restaurantId: body.restaurant_id || null,
        foodItems: body.food_items || []
      },
      createdAt: orderRow.created_at || nowIso()
    });
    await createClientNotification(orderRow, 'order', 'Pedido recebido', `O pedido ${shortOrderCode(orderRow.id)} foi criado e está a aguardar atribuição.`, { status: orderRow.status });
    await broadcastAdmin('order_pending', { orderId: orderRow.id, clientName: orderRow.client_name, source: body.public_source || 'client' });
    await broadcastAdmin('orders_changed', { orderId: orderRow.id, action: 'created' });
    return json({ message: 'Pedido criado com sucesso.', order: { ...fromOrder(orderRow), public_access_token: publicAccessToken } }, 201);
  }

  if (path === '/api/restaurant/profile' && method === 'GET') {
    const restaurant = await requireRestaurant(req);
    return json({ restaurant: fromRestaurant(restaurant) });
  }

  if (path === '/api/restaurant/profile' && method === 'PUT') {
    const restaurant = await requireRestaurant(req);
    const body = await readBody(req) as AnyRecord;
    const profilePatch: AnyRecord = {};
    if (body.name !== undefined) profilePatch.name = clean(body.name) || restaurant.name;
    if (body.phone !== undefined) profilePatch.phone = clean(body.phone) || restaurant.phone || '';
    if (body.address_text !== undefined) profilePatch.address_text = clean(body.address_text) || '';
    if (body.address_coords !== undefined) profilePatch.address_coords = body.address_coords || restaurant.address_coords || null;
    if (body.logo_url !== undefined) profilePatch.logo_url = clean(body.logo_url) || '';
    if (body.cover_url !== undefined) profilePatch.cover_url = clean(body.cover_url) || '';
    if (body.operational_note !== undefined) profilePatch.operational_note = String(body.operational_note || '').trim().slice(0, 180);
    if (body.is_open !== undefined) profilePatch.is_open = body.is_open !== false;
    if (body.whatsapp !== undefined) profilePatch.whatsapp = String(clean(body.whatsapp) || '').slice(0, 30);
    if (body.description !== undefined) profilePatch.description = String(clean(body.description) || '').slice(0, 1000);
    if (body.opening_hours !== undefined) profilePatch.opening_hours = typeof body.opening_hours === 'string' ? body.opening_hours.slice(0, 2000) : JSON.stringify(body.opening_hours || {});
    if (body.delivery_zones !== undefined) profilePatch.delivery_zones = Array.isArray(body.delivery_zones) ? body.delivery_zones.slice(0, 30) : [];
    if (body.delivery_radius_km !== undefined) profilePatch.delivery_radius_km = Math.max(0, toNumber(body.delivery_radius_km, 0));
    if (body.delivery_fee !== undefined) profilePatch.delivery_fee = Math.max(0, toNumber(body.delivery_fee, 0));
    if (body.min_order_amount !== undefined) profilePatch.min_order_amount = Math.max(0, toNumber(body.min_order_amount, 0));
    if (body.delivery_time !== undefined) profilePatch.delivery_time = String(clean(body.delivery_time) || '').slice(0, 80);
    if (body.business_type !== undefined) {
      const businessType = String(body.business_type || '').toLowerCase().replace(/[\s-]+/g, '_');
      profilePatch.business_type = businessType.includes('bottle') ? 'bottle_store' : 'restaurant';
    }
    const updated = await updateRow('restaurants', restaurant.id, profilePatch);
    return json({ restaurant: fromRestaurant(updated) });
  }

  if (path === '/api/restaurant/coupons' && method === 'GET') {
    const restaurant = await requireRestaurant(req);
    return json({ coupons: Array.isArray(restaurant.coupons) ? restaurant.coupons : [] });
  }

  if (path === '/api/restaurant/coupons' && method === 'POST') {
    const restaurant = await requireRestaurant(req);
    const body = await readBody(req) as AnyRecord;
    const code = String(body.code || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 20);
    const type = ['percentage', 'fixed', 'delivery'].includes(String(body.type)) ? String(body.type) : '';
    const value = Math.max(0, toNumber(body.value, 0));
    const minimum = Math.max(0, toNumber(body.min, 0));
    const limit = Math.max(1, Math.floor(toNumber(body.limit, 1)));
    if (!code || !type || (type !== 'delivery' && value <= 0)) throw new HttpError(400, 'Defina um código e um desconto válidos.');
    if (type === 'percentage' && value > 100) throw new HttpError(400, 'A percentagem não pode ultrapassar 100%.');
    const coupons = (Array.isArray(restaurant.coupons) ? restaurant.coupons : []).filter((coupon: AnyRecord) => String(coupon?.code || '').toUpperCase() !== code);
    const coupon = {
      id: generateId(),
      code,
      type,
      value,
      min: minimum,
      limit,
      used: 0,
      active: body.active !== false,
      expires_at: body.expires_at || null,
      created_at: nowIso()
    };
    coupons.unshift(coupon);
    await updateRow('restaurants', restaurant.id, { coupons: coupons.slice(0, 100) });
    return json({ coupon, coupons: coupons.slice(0, 100) }, 201);
  }

  const restaurantCouponMatch = path.match(/^\/api\/restaurant\/coupons\/([^/]+)$/i);
  if (restaurantCouponMatch && method === 'DELETE') {
    const restaurant = await requireRestaurant(req);
    const code = decodeURIComponent(restaurantCouponMatch[1]).toUpperCase();
    const current = Array.isArray(restaurant.coupons) ? restaurant.coupons : [];
    const coupons = current.filter((coupon: AnyRecord) => String(coupon?.code || '').toUpperCase() !== code);
    if (coupons.length === current.length) throw new HttpError(404, 'Cupão não encontrado.');
    await updateRow('restaurants', restaurant.id, { coupons });
    return json({ message: 'Cupão eliminado.', coupons });
  }

  if (path === '/api/restaurant/menu' && method === 'GET') {
    const restaurant = await requireRestaurant(req);
    const { data, error } = await supabase
      .from('restaurant_menu_items')
      .select('*')
      .eq('restaurant_id', restaurant.id)
      .order('category', { ascending: true })
      .order('name', { ascending: true });
    if (error) throw new HttpError(500, error.message);
    const items = [];
    for (const row of data || []) items.push(await menuItemWithExtras(row));
    return json({ items });
  }

  if (path === '/api/restaurant/menu' && method === 'POST') {
    const restaurant = await requireRestaurant(req);
    const body = await readBody(req) as AnyRecord;
    requiredFields(body, ['name', 'category', 'price']);
    if (toNumber(body.price, 0) <= 0) throw new HttpError(400, 'O preço deve ser maior que zero.');
    const item = await insertRow('restaurant_menu_items', {
      restaurant_id: restaurant.id,
      name: clean(body.name),
      category: clean(body.category) || 'Geral',
      description: clean(body.description) || '',
      price: toNumber(body.price, 0),
      image_url: clean(body.image_url) || '',
      available: body.available !== false,
      prep_time_min: body.prep_time_min ? toNumber(body.prep_time_min, 0) : null,
      details: String(body.details || '').slice(0, 1000),
      ingredients: String(body.ingredients || '').slice(0, 1000),
      tags: Array.isArray(body.tags) ? body.tags.slice(0, 20) : [],
      sort_order: Math.floor(toNumber(body.sort_order, 0)),
      unavailable_reason: String(body.unavailable_reason || '').slice(0, 180),
      unavailable_until: body.unavailable_until || null
    });
    await syncMenuExtras(item.id, body);
    return json({ item: await menuItemWithExtras(item) }, 201);
  }

  const menuItemMatch = path.match(/^\/api\/restaurant\/menu\/([a-f0-9]{24})$/i);
  if (menuItemMatch && method === 'PUT') {
    const restaurant = await requireRestaurant(req);
    const current = await selectOne('restaurant_menu_items', 'id', menuItemMatch[1]);
    if (!current || current.restaurant_id !== restaurant.id) throw new HttpError(404, 'Comida não encontrada neste restaurante.');
    const body = await readBody(req) as AnyRecord;
    const patch: AnyRecord = {};
    if (body.name !== undefined) patch.name = clean(body.name) || current.name;
    if (body.category !== undefined) patch.category = clean(body.category) || current.category || 'Geral';
    if (body.description !== undefined) patch.description = clean(body.description) || '';
    if (body.price !== undefined) patch.price = toNumber(body.price, current.price || 0);
    if (body.image_url !== undefined) patch.image_url = clean(body.image_url) || '';
    if (body.available !== undefined) patch.available = body.available === true;
    if (body.prep_time_min !== undefined) patch.prep_time_min = body.prep_time_min ? toNumber(body.prep_time_min, 0) : null;
    if (body.details !== undefined) patch.details = String(body.details || '').slice(0, 1000);
    if (body.ingredients !== undefined) patch.ingredients = String(body.ingredients || '').slice(0, 1000);
    if (body.tags !== undefined) patch.tags = Array.isArray(body.tags) ? body.tags.slice(0, 20) : [];
    if (body.sort_order !== undefined) patch.sort_order = Math.floor(toNumber(body.sort_order, 0));
    if (body.unavailable_reason !== undefined) patch.unavailable_reason = String(body.unavailable_reason || '').slice(0, 180);
    if (body.unavailable_until !== undefined) patch.unavailable_until = body.unavailable_until || null;
    const updated = await updateRow('restaurant_menu_items', current.id, patch);
    await syncMenuExtras(current.id, body);
    return json({ item: await menuItemWithExtras(updated) });
  }

  if (menuItemMatch && method === 'DELETE') {
    const restaurant = await requireRestaurant(req);
    const current = await selectOne('restaurant_menu_items', 'id', menuItemMatch[1]);
    if (!current || current.restaurant_id !== restaurant.id) throw new HttpError(404, 'Comida não encontrada neste restaurante.');
    await deleteRow('restaurant_menu_items', current.id);
    return json({ message: 'Comida eliminada com sucesso.' });
  }

  if (path === '/api/restaurant/orders' && method === 'GET') {
    const restaurant = await requireRestaurant(req);
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .eq('service_type', 'restaurante_comida')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw new HttpError(500, error.message);
    const restaurantPhone = String(restaurant.phone || '').replace(/\D/g, '');
    const orders = (data || []).filter((order: AnyRecord) => {
      const orderPhone = String(order.pickup_contact_phone || '').replace(/\D/g, '');
      const samePhone = restaurantPhone && orderPhone && restaurantPhone === orderPhone;
      const sameName = String(order.pickup_contact_name || '').trim().toLowerCase() === String(restaurant.name || '').trim().toLowerCase();
      return String(order.restaurant_id || '') === String(restaurant.id) || samePhone || sameName;
    }).map(fromOrder);
    return json({ orders });
  }

  const restaurantMessagesMatch = path.match(/^\/api\/restaurant\/orders\/([a-f0-9]{24})\/messages$/i);
  if (restaurantMessagesMatch) {
    const restaurant = await requireRestaurant(req);
    const order = await selectOne('orders', 'id', restaurantMessagesMatch[1]);
    if (!order) throw new HttpError(404, 'Pedido não encontrado.');
    if (!orderBelongsToRestaurant(order, restaurant)) throw new HttpError(403, 'Pedido não pertence a este restaurante.');
    if (method === 'GET') return json({
      channel: MESSAGE_CHANNEL.DRIVER_PARTNER,
      messages: await listOrderMessages(order.id, 'restaurant', MESSAGE_CHANNEL.DRIVER_PARTNER, true)
    });
    if (method === 'POST') {
      const body = await readBody(req) as AnyRecord;
      const message = await createOrderMessage(
        order.id,
        'restaurant',
        restaurant.id,
        restaurant.name || 'Restaurante',
        body.message,
        'text',
        {},
        MESSAGE_CHANNEL.DRIVER_PARTNER
      );
      await broadcastAdmin('order_message_created', { orderId: order.id, messageId: message.id, senderRole: 'restaurant' });
      if (order.assigned_to_driver) {
        const profile = await selectOne('driver_profiles', 'id', order.assigned_to_driver);
        if (profile?.user_id) await broadcastDriver(profile.user_id, 'order_message_created', { orderId: order.id, messageId: message.id, senderRole: 'restaurant' });
      }
      return json({ message: fromOrderMessage(message) }, 201);
    }
  }

  const restaurantConfirmMatch = path.match(/^\/api\/restaurant\/orders\/([a-f0-9]{24})\/confirm$/i);
  if (restaurantConfirmMatch && method === 'POST') {
    const restaurant = await requireRestaurant(req);
    const order = await selectOne('orders', 'id', restaurantConfirmMatch[1]);
    if (!order) throw new HttpError(404, 'Pedido não encontrado.');
    if (!orderBelongsToRestaurant(order, restaurant)) throw new HttpError(403, 'Pedido não pertence a este restaurante.');
    if ([ORDER_STATUS.COMPLETED, ORDER_STATUS.CANCELED].includes(order.status)) throw new HttpError(409, 'Este pedido já foi encerrado.');
    if (order.partner_confirmed_at) return json({ message: 'Pedido já confirmado pelo estabelecimento.', order: fromOrder(order) });
    const now = nowIso();
    const updated = await updateRow('orders', order.id, {
      restaurant_status: 'accepted',
      partner_confirmed_at: now,
      partner_confirmed_by: restaurant.id
    });
    const message = await createOrderMessage(
      order.id,
      'restaurant',
      restaurant.id,
      restaurant.name || 'Estabelecimento',
      'O estabelecimento confirmou que recebeu o pedido.',
      'status',
      { partner_confirmed_at: now },
      MESSAGE_CHANNEL.DRIVER_PARTNER
    );
    await recordOrderStatusEvent(order.id, order.status, 'Confirmado pelo estabelecimento', 'restaurant', restaurant.id, restaurant.name || 'Estabelecimento');
    await recordAudit('restaurant', restaurant.id, 'partner_order_confirmed', 'order', order.id);
    await createAdminNotification({
      dedupeKey: `partner_confirmed:${order.id}`,
      type: 'order',
      title: `${restaurant.name || 'Estabelecimento'} confirmou o pedido`,
      message: `Pedido ${shortOrderCode(order.id)} confirmado pelo ponto de recolha.`,
      order: updated
    });
    if (order.assigned_to_driver) {
      const profile = await selectOne('driver_profiles', 'id', order.assigned_to_driver);
      if (profile?.user_id) await broadcastDriver(profile.user_id, 'partner_order_confirmed', { orderId: order.id, messageId: message.id });
    }
    await broadcastAdmin('restaurant_order_status_changed', { orderId: order.id, restaurantStatus: 'accepted', messageId: message.id });
    return json({ message: 'Pedido confirmado.', order: fromOrder(updated) });
  }

  const restaurantPickupMatch = path.match(/^\/api\/restaurant\/orders\/([a-f0-9]{24})\/pickup-confirmation$/i);
  if (restaurantPickupMatch && method === 'POST') {
    const restaurant = await requireRestaurant(req);
    const order = await selectOne('orders', 'id', restaurantPickupMatch[1]);
    if (!order) throw new HttpError(404, 'Pedido não encontrado.');
    if (!orderBelongsToRestaurant(order, restaurant)) throw new HttpError(403, 'Pedido não pertence a este restaurante.');
    if ([ORDER_STATUS.COMPLETED, ORDER_STATUS.CANCELED].includes(order.status)) throw new HttpError(409, 'Este pedido já foi encerrado.');
    if (!order.partner_confirmed_at) throw new HttpError(409, 'Confirme primeiro a recepção do pedido.');
    if (String(order.restaurant_status || '') !== 'preparing') throw new HttpError(409, 'Marque primeiro o pedido como Em preparação.');
    if (order.pickup_authorized_at) return json({ message: 'Recolha já confirmada pelo estabelecimento.', order: fromOrder(order) });
    const now = nowIso();
    const updated = await updateRow('orders', order.id, {
      pickup_authorized_at: now,
      pickup_authorized_by: restaurant.id,
      restaurant_ready_at: now
    });
    const message = await createOrderMessage(
      order.id,
      'restaurant',
      restaurant.id,
      restaurant.name || 'Estabelecimento',
      'O estabelecimento autorizou a recolha pelo motorista.',
      'status',
      { pickup_authorized_at: now },
      MESSAGE_CHANNEL.DRIVER_PARTNER
    );
    await recordOrderStatusEvent(order.id, order.status, 'Recolha autorizada', 'restaurant', restaurant.id, restaurant.name || 'Estabelecimento');
    await recordAudit('restaurant', restaurant.id, 'pickup_authorized', 'order', order.id);
    if (order.assigned_to_driver) {
      const profile = await selectOne('driver_profiles', 'id', order.assigned_to_driver);
      if (profile?.user_id) await broadcastDriver(profile.user_id, 'pickup_authorized', { orderId: order.id, messageId: message.id });
    }
    await broadcastAdmin('restaurant_order_status_changed', { orderId: order.id, pickupAuthorized: true, messageId: message.id });
    return json({ message: 'Recolha confirmada para o motorista.', order: fromOrder(updated) });
  }

  const restaurantStatusMatch = path.match(/^\/api\/restaurant\/orders\/([a-f0-9]{24})\/status$/i);
  if (restaurantStatusMatch && method === 'POST') {
    const restaurant = await requireRestaurant(req);
    const order = await selectOne('orders', 'id', restaurantStatusMatch[1]);
    if (!order) throw new HttpError(404, 'Pedido não encontrado.');
    if (!orderBelongsToRestaurant(order, restaurant)) throw new HttpError(403, 'Pedido não pertence a este restaurante.');
    if ([ORDER_STATUS.COMPLETED, ORDER_STATUS.CANCELED].includes(order.status)) throw new HttpError(409, 'Este pedido já foi encerrado.');
    const body = await readBody(req) as AnyRecord;
    const status = String(body.status || '');
    if (!['preparing', 'rejected'].includes(status)) throw new HttpError(400, 'O estabelecimento só pode marcar Em preparação ou Cancelado.');
    if (status === 'preparing' && !order.partner_confirmed_at) throw new HttpError(409, 'Confirme primeiro a recepção do pedido.');
    if (status === 'preparing' && !['accepted', 'preparing'].includes(String(order.restaurant_status || ''))) {
      throw new HttpError(409, 'Esta mudança de estado já não é válida para o pedido.');
    }
    if (status === 'rejected' && (order.pickup_completed_at || order.delivery_start_at)) {
      throw new HttpError(409, 'A recolha já foi concluída. Use o suporte para cancelar em segurança.');
    }
    const reason = String(body.reason || '').trim().slice(0, 500);
    if (status === 'rejected' && reason.length < 3) throw new HttpError(400, 'Indique a justificativa do cancelamento.');
    const labels: AnyRecord = {
      preparing: 'O pedido está em preparação.',
      rejected: `Pedido cancelado pelo estabelecimento: ${reason}`
    };
    const orderPatch: AnyRecord = {
      restaurant_status: status,
      restaurant_prep_time_min: body.prep_time_min ? Math.max(1, Math.min(180, toNumber(body.prep_time_min, 25))) : order.restaurant_prep_time_min
    };
    if (status === 'rejected') Object.assign(orderPatch, {
      status: ORDER_STATUS.CANCELED,
      cancelled_at: nowIso(),
      cancel_reason: reason,
      offered_to_driver: null,
      driver_offer_status: null,
      driver_offer_expires_at: null
    });
    const updated = await updateRow('orders', order.id, orderPatch);
    if (status === 'rejected') await cancelPendingDriverOffers(order.id);
    const affectedDriverId = order.assigned_to_driver || order.offered_to_driver;
    if (status === 'rejected' && affectedDriverId) {
      const profile = await selectOne('driver_profiles', 'id', affectedDriverId);
      if (profile) {
        const updatedProfile = await updateRow('driver_profiles', profile.id, { status: DRIVER_STATUS.ONLINE_FREE });
        await upsertDriverPresence(updatedProfile, { current_order_id: null, is_available: true });
      }
    }
    const message = await createOrderMessage(
      order.id,
      'restaurant',
      restaurant.id,
      restaurant.name || 'Estabelecimento',
      labels[status],
      'status',
      { restaurant_status: status, prep_time_min: orderPatch.restaurant_prep_time_min || null },
      MESSAGE_CHANNEL.SYSTEM
    );
    await recordOrderStatusEvent(order.id, updated.status, status === 'preparing' ? 'Em preparação' : 'Cancelado', 'restaurant', restaurant.id, restaurant.name || 'Estabelecimento', reason);
    await recordAudit('restaurant', restaurant.id, status === 'preparing' ? 'order_preparing' : 'order_cancelled', 'order', order.id, { reason });
    await createAdminNotification({ dedupeKey: `restaurant_status:${order.id}:${status}`, type: status === 'rejected' ? 'warning' : 'order', title: `${restaurant.name || 'Restaurante'} · ${shortOrderCode(order.id)}`, message: labels[status], order: updated });
    await createClientNotification(updated, status === 'rejected' ? 'warning' : 'restaurant', status === 'rejected' ? 'Pedido cancelado' : 'Em preparação', labels[status], { restaurant_status: status, reason });
    await broadcastAdmin('restaurant_order_status_changed', { orderId: order.id, restaurantStatus: status, messageId: message.id });
    if (order.assigned_to_driver) {
      const profile = await selectOne('driver_profiles', 'id', order.assigned_to_driver);
      if (profile?.user_id) await broadcastDriver(profile.user_id, 'restaurant_order_status_changed', { orderId: order.id, restaurantStatus: status, messageId: message.id });
    }
    return json({ message: labels[status], order: fromOrder(updated) });
  }

  return null;
};

const routeOrders = async (req: Request, path: string, method: string) => {
  if (path === '/api/orders' && method === 'POST') {
    const user = await requireUser(req, 'admin');
    const body = await readBody(req);
    const isForm = body instanceof FormData;
    const get = (key: string) => isForm ? (body as FormData).get(key) : (body as AnyRecord)[key];
    requiredFields(Object.fromEntries(['service_type', 'client_name', 'client_phone1', 'price'].map((k) => [k, get(k)])), ['service_type', 'client_name', 'client_phone1', 'price']);

    const imageFile = isForm ? ((body as FormData).get('image') || (body as FormData).get('file') || Array.from((body as FormData).values()).find((value) => value instanceof File)) as File | null : null;
    const imageUrl = await uploadOrderImage(imageFile);
    const coordinates = normalizeCoordinates(get('lat'), get('lng'));
    const pickupCoordinates = normalizeCoordinates(get('pickup_lat'), get('pickup_lng'));
    const baseServicePrice = toNumber(get('service_price') ?? get('price'), 0);
    let routeQuote: AnyRecord = {
      distance_km: toNumber(get('route_distance_km'), 0),
      duration_min: toNumber(get('route_duration_min'), 0),
      delivery_fee: toNumber(get('delivery_fee'), 0),
      source: 'frontend'
    };
    if (pickupCoordinates && coordinates) {
      routeQuote = await buildRouteQuote(pickupCoordinates, coordinates);
    }
    const totalOrderPrice = baseServicePrice + toNumber(routeQuote.delivery_fee, 0);
    const rawPayment = String(get('payment_method') || '').trim();
    let paymentMethod = ALLOWED_PAYMENT_METHODS.has(rawPayment) ? rawPayment : 'cash';
    const linkedClientId = isValidId(String(get('clientId') || '')) ? String(get('clientId')) : null;
    const linkedClient = linkedClientId ? await selectOne('clients', 'id', linkedClientId) : null;

    if (linkedClient?.billing_type === CLIENT_BILLING_TYPES.POSTPAID) {
      paymentMethod = 'postpaid_credit';
      const availableCredit = toNumber(linkedClient.credit_balance, 0);
      if (availableCredit < totalOrderPrice) {
        throw new HttpError(400, `Crédito insuficiente para cliente pós-pago. Disponível: ${availableCredit.toFixed(2)} MZN.`);
      }
      await updateRow('clients', linkedClient.id, {
        credit_balance: availableCredit - totalOrderPrice,
        credit_used: toNumber(linkedClient.credit_used, 0) + totalOrderPrice
      });
    } else if (paymentMethod === 'postpaid_credit') {
      paymentMethod = 'cash';
    }

    const orderRow = await insertRow('orders', {
      service_type: clean(get('service_type')),
      price: toNumber(totalOrderPrice, 0),
      service_price: baseServicePrice,
      delivery_fee: toNumber(routeQuote.delivery_fee, 0),
      route_distance_km: toNumber(routeQuote.distance_km, 0),
      route_duration_min: routeQuote.duration_min || null,
      route_pricing_source: routeQuote.source || 'fallback',
      client_name: clean(get('client_name')),
      client_phone1: clean(get('client_phone1')),
      client_phone2: clean(get('client_phone2')) || '',
      client_notes: String(get('client_notes') || get('notes') || '').trim().slice(0, 1000),
      pickup_address_text: clean(get('pickup_address_text')) || '',
      pickup_address_coords: pickupCoordinates,
      address_text: clean(get('address_text')) || '',
      address_coords: coordinates,
      pickup_contact_name: clean(get('pickup_contact_name')) || '',
      pickup_contact_phone: clean(get('pickup_contact_phone')) || '',
      pickup_notes: clean(get('pickup_notes')) || '',
      client: linkedClientId,
      image_url: imageUrl,
      verification_code: generateVerificationCode(),
      created_by_admin: user.id,
      assigned_to_driver: null,
      status: ORDER_STATUS.PENDING,
      payment_method: paymentMethod,
      payment_status: paymentMethod === 'postpaid_credit' ? PAYMENT_STATUS.POSTPAID_MONTHLY : PAYMENT_STATUS.UNPAID
    });

    await createAdminNotification({
      dedupeKey: `new_order:${orderRow.id}`,
      type: 'order',
      title: 'Novo pedido recebido',
      message: `Pedido ${shortOrderCode(orderRow.id)} · ${orderRow.client_name || 'Cliente'} · ${paymentMethodLabel(orderRow.payment_method)}.`,
      order: orderRow,
      payload: { clientName: orderRow.client_name, amount: Number(orderRow.price || 0), paymentMethod: orderRow.payment_method },
      createdAt: orderRow.created_at || nowIso()
    });

    const order = fromOrder(orderRow);
    await broadcastAdmin('order_pending', { orderId: orderRow.id });
    await broadcastAdmin('orders_changed', { orderId: orderRow.id, action: 'created' });
    return json({ message: 'Encomenda criada com sucesso!', order }, 201);
  }

  if (path === '/api/orders/my-deliveries' && method === 'GET') {
    const user = await requireUser(req, 'driver');
    const profile = await getDriverProfileByUser(user.id);
    if (!profile) throw new HttpError(404, 'Perfil de motorista não encontrado.');
    const activeStatuses = [ORDER_STATUS.ASSIGNED, ORDER_STATUS.IN_PROGRESS, ORDER_STATUS.PICKUP_IN_PROGRESS, ORDER_STATUS.PICKUP_DONE, ORDER_STATUS.DELIVERY_IN_PROGRESS];
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .eq('assigned_to_driver', profile.id)
      .in('status', activeStatuses)
      .order('created_at', { ascending: false });
    if (error) throw new HttpError(500, error.message);
    await supabase.rpc('trago_expire_driver_offers');
    const { data: rawOffers, error: offerError } = await supabase
      .from('driver_offers')
      .select('*')
      .eq('driver_profile_id', profile.id)
      .eq('status', 'pending')
      .gt('expires_at', nowIso())
      .order('created_at', { ascending: false });
    if (offerError) throw new HttpError(500, offerError.message);
    const offers = [];
    for (const offer of rawOffers || []) {
      const offeredOrder = await selectOne('orders', 'id', offer.order_id);
      if (!offeredOrder || offeredOrder.status !== ORDER_STATUS.PENDING) continue;
      offers.push({
        ...fromOrder(offeredOrder),
        driver_offer_id: offer.id,
        driver_offer_status: offer.status,
        driver_offer_expires_at: offer.expires_at
      });
    }
    return json({ orders: (data || []).map(fromOrder), offers });
  }

  const offerResponseMatch = path.match(/^\/api\/orders\/([a-f0-9]{24})\/offer-response$/i);
  if (offerResponseMatch && method === 'POST') {
    const user = await requireUser(req, 'driver');
    const profile = await getDriverProfileByUser(user.id);
    if (!profile) throw new HttpError(404, 'Perfil de motorista não encontrado.');
    const order = await selectOne('orders', 'id', offerResponseMatch[1]);
    if (!order) throw new HttpError(404, 'Pedido não encontrado.');
    const body = await readBody(req) as AnyRecord;
    const requestedOfferId = String(body.offer_id || body.offerId || '');
    let offerQuery = supabase
      .from('driver_offers')
      .select('*')
      .eq('order_id', order.id)
      .eq('driver_profile_id', profile.id)
      .eq('status', 'pending');
    if (requestedOfferId) offerQuery = offerQuery.eq('id', requestedOfferId);
    const { data: pendingOffer, error: offerLookupError } = await offerQuery
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (offerLookupError) throw new HttpError(500, offerLookupError.message);
    if (!pendingOffer) throw new HttpError(409, 'Esta oferta já não está disponível para si.');

    const { data: outcome, error: responseError } = await supabase.rpc('trago_respond_driver_offer', {
      p_offer_id: pendingOffer.id,
      p_driver_profile_id: profile.id,
      p_accept: body.accept === true,
      p_reason: String(body.reason || '').slice(0, 500) || null
    });
    if (responseError) throw new HttpError(409, responseError.message);
    const outcomeRow = Array.isArray(outcome) ? outcome[0] : outcome;
    if (outcomeRow?.outcome === 'expired') throw new HttpError(409, 'O tempo para responder a esta oferta terminou.');

    const updated = await selectOne('orders', 'id', order.id);
    if (outcomeRow?.outcome === 'rejected') {
      await createOrderMessage(order.id, 'system', 'system', 'TraGo', `${user.nome || 'O motorista'} recusou a oferta. O cliente pode escolher outro motorista.`, 'status', { driver_offer_status: 'rejected' });
      await createAdminNotification({
        dedupeKey: `driver_offer_rejected:${order.id}:${profile.id}`,
        type: 'warning',
        title: `Oferta recusada · ${shortOrderCode(order.id)}`,
        message: `${user.nome || 'Motorista'} recusou o pedido. O cliente pode escolher outro motorista.`,
        order: updated
      });
      await createClientNotification(updated, 'warning', 'Motorista indisponível', 'O motorista escolhido não aceitou. Escolha outro motorista no radar.', { driver_offer_status: 'rejected' });
      await broadcastAdmin('orders_changed', { orderId: order.id, action: 'driver_offer_rejected' });
      return json({ accepted: false, order: fromOrder(updated) });
    }
    await createOrderMessage(order.id, 'system', 'system', 'TraGo', `${user.nome || 'O motorista'} aceitou o pedido.`, 'status', { driver_offer_status: 'accepted', status: ORDER_STATUS.ASSIGNED });
    await createAdminNotification({
      dedupeKey: `driver_offer_accepted:${order.id}:${profile.id}`,
      type: 'order',
      title: `Motorista aceitou · ${shortOrderCode(order.id)}`,
      message: `${user.nome || 'Motorista'} aceitou o pedido do cliente.`,
      order: updated
    });
    await createClientNotification(updated, 'driver', 'Motorista confirmado', `${user.nome || 'O motorista'} aceitou o seu pedido. Já pode acompanhar a localização em tempo real.`, { status: ORDER_STATUS.ASSIGNED, driver_id: profile.id });
    await broadcastDriver(profile.user_id, 'nova_entrega_atribuida', {
      orderId: order.id,
      clientName: order.client_name,
      serviceType: order.service_type,
      paymentMethod: order.payment_method
    });
    await broadcastAdmin('orders_changed', { orderId: order.id, action: 'driver_offer_accepted' });
    await broadcastAdmin('driver_status_changed', {
      driverId: profile.id,
      driverUserId: profile.user_id,
      newStatus: DRIVER_STATUS.ONLINE_BUSY
    });
    return json({ accepted: true, order: fromOrder(updated) });
  }

  const orderMessagesMatch = path.match(/^\/api\/orders\/([a-f0-9]{24})\/messages$/i);
  if (orderMessagesMatch) {
    const user = await requireUser(req, ['admin', 'driver']);
    const order = await selectOne('orders', 'id', orderMessagesMatch[1]);
    if (!order) throw new HttpError(404, 'Pedido não encontrado.');
    let senderId = user.id;
    if (user.role === 'driver') {
      const profile = await getDriverProfileByUser(user.id);
      if (!profile || String(order.assigned_to_driver || '') !== String(profile.id)) throw new HttpError(403, 'Este pedido não está atribuído a este motorista.');
      senderId = profile.id;
    }
    const requestedChannel = String(parseQuery(req).channel || '');
    const channel = MESSAGE_CHANNELS.has(requestedChannel)
      ? requestedChannel
      : (user.role === 'driver' ? MESSAGE_CHANNEL.CLIENT_DRIVER : '');
    if (user.role === 'driver' && channel && ![MESSAGE_CHANNEL.CLIENT_DRIVER, MESSAGE_CHANNEL.DRIVER_PARTNER, MESSAGE_CHANNEL.SYSTEM].includes(channel as any)) {
      throw new HttpError(403, 'Canal de conversa não permitido para o motorista.');
    }
    if (method === 'GET') return json({
      channel: channel || 'all',
      messages: await listOrderMessages(order.id, user.role, channel, true)
    });
    if (method === 'POST') {
      const body = await readBody(req) as AnyRecord;
      const messageChannel = MESSAGE_CHANNELS.has(String(body.channel || ''))
        ? String(body.channel)
        : (user.role === 'driver' ? MESSAGE_CHANNEL.CLIENT_DRIVER : MESSAGE_CHANNEL.SYSTEM);
      if (user.role === 'driver' && ![MESSAGE_CHANNEL.CLIENT_DRIVER, MESSAGE_CHANNEL.DRIVER_PARTNER].includes(messageChannel as any)) {
        throw new HttpError(403, 'Escolha Cliente ou Estabelecimento para enviar a mensagem.');
      }
      const message = await createOrderMessage(
        order.id,
        user.role,
        senderId,
        user.nome || user.role,
        body.message,
        'text',
        {},
        messageChannel
      );
      if (user.role !== 'admin') {
        await createAdminNotification({ dedupeKey: `order_chat:${message.id}`, type: 'info', title: `Mensagem no pedido ${shortOrderCode(order.id)}`, message: `${user.nome || 'Motorista'}: ${String(body.message || '').slice(0, 140)}`, order });
      }
      await broadcastAdmin('order_message_created', { orderId: order.id, messageId: message.id, senderRole: user.role });
      if (order.assigned_to_driver) {
        const profile = await selectOne('driver_profiles', 'id', order.assigned_to_driver);
        if (profile?.user_id) await broadcastDriver(profile.user_id, 'order_message_created', { orderId: order.id, messageId: message.id, senderRole: user.role });
      }
      return json({ message: fromOrderMessage(message) }, 201);
    }
  }

  if (path === '/api/orders/payment-pending' && method === 'GET') {
    const user = await requireUser(req, ['admin', 'driver']);
    let q = supabase
      .from('orders')
      .select('*')
      .eq('payment_status', PAYMENT_STATUS.AWAITING_DRIVER_CONFIRMATION)
      .order('payment_confirmation_requested_at', { ascending: false, nullsFirst: false });

    if (user.role === 'driver') {
      const profile = await getDriverProfileByUser(user.id);
      if (!profile) throw new HttpError(404, 'Perfil de motorista não encontrado.');
      q = q.eq('assigned_to_driver', profile.id);
    }

    const { data, error } = await q;
    if (error) throw new HttpError(500, error.message);
    return json({ total: (data || []).length, orders: (data || []).map(fromOrder) });
  }

  const paymentPreviewMatch = path.match(/^\/api\/orders\/([a-f0-9]{24})\/payment-preview$/i);
  if (paymentPreviewMatch && method === 'POST') {
    const user = await requireUser(req, 'driver');
    const body = await readBody(req) as AnyRecord;
    requiredFields(body, ['verification_code']);

    const profile = await getDriverProfileByUser(user.id);
    if (!profile) throw new HttpError(404, 'Perfil de motorista não encontrado.');

    const order = await selectOne('orders', 'id', paymentPreviewMatch[1]);
    if (!order) throw new HttpError(404, 'Encomenda não encontrada.');
    if (String(order.assigned_to_driver || '') !== String(profile.id)) throw new HttpError(403, 'Não autorizado para esta encomenda.');

    if (String(order.verification_code || '').toUpperCase() !== String(body.verification_code || '').toUpperCase()) {
      throw new HttpError(400, 'Código de verificação incorreto.');
    }
    if (order.status !== ORDER_STATUS.DELIVERY_IN_PROGRESS) {
      throw new HttpError(400, 'Esta encomenda não está na fase de entrega para confirmação de pagamento.');
    }

    const requiresPayment = requiresImmediatePayment(order);
    const updated = requiresPayment
      ? await updateRow('orders', order.id, {
        payment_status: PAYMENT_STATUS.AWAITING_DRIVER_CONFIRMATION,
        payment_confirmation_requested_at: nowIso()
      })
      : await updateRow('orders', order.id, {
        payment_confirmation_requested_at: nowIso()
      });

    if (requiresPayment) {
      const payload = {
        id: updated.id,
        clientName: updated.client_name,
        driverId: profile.id,
        amount: toNumber(updated.price, 0),
        paymentMethod: updated.payment_method,
        orderCode: shortOrderCode(updated.id),
        verificationCode: updated.verification_code
      };
      await createAdminNotification({
        dedupeKey: `payment_pending:${updated.id}`,
        type: 'payment',
        title: 'Pagamento por confirmar',
        message: `Pedido ${shortOrderCode(updated.id)} · Código ${updated.verification_code || '—'} · confirmar ${Number(updated.price || 0).toFixed(2)} MZN.`,
        order: updated,
        payload,
        createdAt: updated.payment_confirmation_requested_at || nowIso()
      });
      await broadcastAdmin('payment_confirmation_pending', payload);
      await broadcastDriver(profile.user_id, 'payment_confirmation_pending', payload);
    }

    return json({
      orderId: updated.id,
      totalToPay: toNumber(updated.price, 0),
      paymentMethod: updated.payment_method,
      paymentMethodLabel: paymentMethodLabel(updated.payment_method),
      requiresImmediatePayment: requiresPayment,
      paymentStatus: updated.payment_status,
      message: requiresPayment
        ? 'Código validado. Confirme o valor recebido para finalizar.'
        : 'Código validado. Cliente pós-pago: sem cobrança no acto.'
    });
  }

  if (path === '/api/orders/active' && method === 'GET') {
    await requireUser(req, 'admin');
    const activeStatuses = [ORDER_STATUS.PENDING, ORDER_STATUS.ASSIGNED, ORDER_STATUS.IN_PROGRESS, ORDER_STATUS.PICKUP_IN_PROGRESS, ORDER_STATUS.PICKUP_DONE, ORDER_STATUS.DELIVERY_IN_PROGRESS];
    const { data, error } = await supabase.from('orders').select('*').in('status', activeStatuses).order('created_at', { ascending: false });
    if (error) throw new HttpError(500, error.message);
    const orders = [];
    for (const row of data || []) orders.push(await enrichOrder(row));
    return json({ orders });
  }

  if (path === '/api/orders/history' && method === 'GET') {
    await requireUser(req, 'admin');
    const query = parseQuery(req);
    const range = getPeriodRange(query.period || 'month');
    let q = supabase
      .from('orders')
      .select('*')
      .in('status', [ORDER_STATUS.COMPLETED, ORDER_STATUS.CANCELED])
      .gte('timestamp_completed', range.start.toISOString())
      .lte('timestamp_completed', range.end.toISOString());
    const { data, error } = await q.order('timestamp_completed', { ascending: false, nullsFirst: false });
    if (error) throw new HttpError(500, error.message);
    const orders = [];
    for (const row of data || []) orders.push(await enrichOrder(row));
    return json({ orders, period: { key: range.key, label: range.label, start: range.start.toISOString(), end: range.end.toISOString() } });
  }

  if (path === '/api/orders' && method === 'GET') {
    await requireUser(req, 'admin');
    const { data, error } = await supabase.from('orders').select('*').order('created_at', { ascending: false });
    if (error) throw new HttpError(500, error.message);
    const orders = [];
    for (const row of data || []) orders.push(await enrichOrder(row));
    return json({ orders });
  }

  const assignMatch = path.match(/^\/api\/orders\/([a-f0-9]{24})\/assign$/i);
  if (assignMatch && method === 'PUT') {
    const admin = await requireUser(req, 'admin');
    const body = await readBody(req) as AnyRecord;
    const order = await selectOne('orders', 'id', assignMatch[1]);
    if (!order) throw new HttpError(404, 'Encomenda não encontrada.');
    if ([ORDER_STATUS.IN_PROGRESS, ORDER_STATUS.PICKUP_IN_PROGRESS, ORDER_STATUS.DELIVERY_IN_PROGRESS].includes(order.status)) {
      throw new HttpError(400, 'Não é possível reatribuir uma encomenda em progresso.');
    }
    const driverId = String(body.driverId || '');
    const newProfile = await selectOne('driver_profiles', 'id', driverId);
    if (!newProfile) throw new HttpError(404, 'Perfil de motorista não encontrado.');
    const { data: newPresence, error: newPresenceError } = await supabase
      .from('driver_presence')
      .select('*')
      .eq('driver_profile_id', driverId)
      .maybeSingle();
    if (newPresenceError) throw new HttpError(500, newPresenceError.message);
    const presenceFresh = newPresence?.last_seen_at
      && Date.now() - new Date(newPresence.last_seen_at).getTime() <= 60000;
    const reservedForThisOrder = String(order.offered_to_driver || '') === driverId;
    if (
      !newPresence?.is_online
      || (!newPresence.is_available && !reservedForThisOrder)
      || newPresence.current_order_id
      || !presenceFresh
    ) {
      throw new HttpError(409, 'O motorista já não está online e disponível.');
    }

    const previousDriverIds = [...new Set([order.assigned_to_driver, order.offered_to_driver]
      .filter((value) => value && String(value) !== driverId)
      .map(String))];
    for (const previousDriverId of previousDriverIds) {
      const oldProfile = await selectOne('driver_profiles', 'id', previousDriverId);
      if (oldProfile) {
        const updatedOldProfile = await updateRow('driver_profiles', oldProfile.id, { status: DRIVER_STATUS.ONLINE_FREE });
        await upsertDriverPresence(updatedOldProfile, { current_order_id: null, is_available: true });
        await broadcastDriver(oldProfile.user_id, 'entrega_cancelada', { orderId: order.id });
        await broadcastAdmin('driver_status_changed', {
          driverId: oldProfile.id,
          driverUserId: oldProfile.user_id,
          newStatus: DRIVER_STATUS.ONLINE_FREE
        });
      }
    }

    const updatedNewProfile = await updateRow('driver_profiles', newProfile.id, { status: DRIVER_STATUS.ONLINE_BUSY });
    await upsertDriverPresence(updatedNewProfile, { current_order_id: order.id, is_available: false, is_online: true });
    const updated = await updateRow('orders', order.id, {
      assigned_to_driver: driverId,
      offered_to_driver: null,
      driver_offer_status: null,
      driver_offer_expires_at: null,
      status: ORDER_STATUS.ASSIGNED,
      driver_assigned_at: order.driver_assigned_at || nowIso(),
      last_status_at: nowIso()
    });
    await cancelPendingDriverOffers(order.id);
    await createClientNotification(updated, 'driver', 'Motorista atribuído', 'A Central TraGo atribuiu um motorista ao seu pedido.', { status: updated.status, driver_id: driverId });
    await recordOrderStatusEvent(updated.id, updated.status, 'Pedido confirmado', 'admin', admin.id, admin.nome || 'Central TraGo', '', { driver_id: driverId });
    await recordAudit('admin', admin.id, 'driver_assigned_manually', 'order', updated.id, { driver_id: driverId });
    await broadcastDriver(newProfile.user_id, 'nova_entrega_atribuida', {
      orderId: updated.id,
      clientName: updated.client_name,
      serviceType: updated.service_type,
      paymentMethod: updated.payment_method
    });
    await broadcastAdmin('driver_status_changed', {
      driverId: newProfile.id,
      driverUserId: newProfile.user_id,
      newStatus: DRIVER_STATUS.ONLINE_BUSY
    });
    await broadcastAdmin('orders_changed', { orderId: updated.id, action: 'assigned' });
    return json({ message: 'Encomenda atribuída com sucesso.', order: fromOrder(updated) });
  }

  const phaseMatch = path.match(/^\/api\/orders\/([a-f0-9]{24})\/(pickup-start|pickup-complete|delivery-start|delivery-complete|start|complete|cancel)$/i);
  if (phaseMatch) return handleOrderAction(req, phaseMatch[1], phaseMatch[2], method);

  const idMatch = path.match(/^\/api\/orders\/([a-f0-9]{24})$/i);
  if (idMatch && method === 'GET') {
    await requireUser(req, 'admin');
    const row = await selectOne('orders', 'id', idMatch[1]);
    if (!row) throw new HttpError(404, 'Encomenda não encontrada.');
    return json({ order: await enrichOrder(row) });
  }

  return null;
};

const handleOrderAction = async (req: Request, orderId: string, action: string, method: string) => {
  const isCancel = action === 'cancel';
  if (isCancel && method !== 'POST') return null;
  if (!isCancel && method !== 'POST') return null;

  if (isCancel) {
    const user = await requireUser(req, 'admin');
    const body = await readBody(req) as AnyRecord;
    const order = await selectOne('orders', 'id', orderId);
    if (!order) throw new HttpError(404, 'Encomenda não encontrada.');
    if ([ORDER_STATUS.COMPLETED, ORDER_STATUS.CANCELED].includes(order.status)) throw new HttpError(400, 'Esta encomenda já foi concluída ou cancelada.');
    const updated = await updateRow('orders', order.id, {
      status: ORDER_STATUS.CANCELED,
      cancelled_at: nowIso(),
      cancelled_by: user.id,
      cancel_reason: String(body.reason || 'Cancelado pelo administrador').slice(0, 500),
      offered_to_driver: null,
      driver_offer_status: null,
      driver_offer_expires_at: null
    });
    await cancelPendingDriverOffers(order.id);
    const affectedDriverId = order.assigned_to_driver || order.offered_to_driver;
    if (affectedDriverId) {
      const profile = await selectOne('driver_profiles', 'id', affectedDriverId);
      if (profile) {
        const updatedProfile = await updateRow('driver_profiles', profile.id, { status: DRIVER_STATUS.ONLINE_FREE });
        await upsertDriverPresence(updatedProfile, { current_order_id: null, is_available: true });
        await broadcastDriver(profile.user_id, 'entrega_cancelada', { orderId: order.id });
      }
    }
    await createOrderMessage(order.id, 'system', 'system', 'TraGo', 'O Admin cancelou este pedido.', 'status', { status: ORDER_STATUS.CANCELED, reason: updated.cancel_reason });
    await recordOrderStatusEvent(order.id, updated.status, 'Cancelado', 'admin', user.id, user.nome || 'Administrador', updated.cancel_reason);
    await recordAudit('admin', user.id, 'order_cancelled', 'order', order.id, { reason: updated.cancel_reason });
    await broadcastAdmin('order_canceled', { id: updated.id, reason: updated.cancel_reason });
    return json({ message: 'Encomenda cancelada com sucesso.', order: fromOrder(updated) });
  }

  const user = await requireUser(req, 'driver');
  const profile = await getDriverProfileByUser(user.id);
  if (!profile) throw new HttpError(404, 'Perfil de motorista não encontrado.');
  const order = await selectOne('orders', 'id', orderId);
  if (!order) throw new HttpError(404, 'Encomenda não encontrada.');
  if (String(order.assigned_to_driver || '') !== String(profile.id)) throw new HttpError(403, 'Não autorizado para esta encomenda.');

  const now = nowIso();
  let orderUpdate: AnyRecord = {};
  let profileStatus = profile.status;
  let message = '';
  let event = '';

  if (action === 'pickup-start' || action === 'start') {
    if (![ORDER_STATUS.ASSIGNED, ORDER_STATUS.PENDING, ORDER_STATUS.PICKUP_IN_PROGRESS].includes(order.status)) throw new HttpError(400, 'Esta encomenda não está disponível para iniciar a recolha.');
    orderUpdate = { status: ORDER_STATUS.PICKUP_IN_PROGRESS, pickup_start_at: order.pickup_start_at || now, timestamp_started: order.timestamp_started || now };
    profileStatus = DRIVER_STATUS.PICKUP;
    message = 'Recolha iniciada.';
    event = 'pickup_started';
  } else if (action === 'pickup-complete') {
    if (![ORDER_STATUS.ASSIGNED, ORDER_STATUS.PICKUP_IN_PROGRESS, ORDER_STATUS.IN_PROGRESS].includes(order.status)) throw new HttpError(400, 'Esta encomenda não está numa fase válida para concluir a recolha.');
    if (order.restaurant_id && !order.pickup_authorized_at) throw new HttpError(409, 'O estabelecimento ainda não autorizou a recolha deste pedido.');
    orderUpdate = { status: ORDER_STATUS.PICKUP_DONE, pickup_start_at: order.pickup_start_at || order.timestamp_started || now, pickup_completed_at: now };
    profileStatus = DRIVER_STATUS.ONLINE_BUSY;
    message = 'Recolha concluída.';
    event = 'pickup_completed';
  } else if (action === 'delivery-start') {
    if (!order.pickup_completed_at) throw new HttpError(400, 'Ainda não foi registada a conclusão da recolha desta encomenda.');
    if (![ORDER_STATUS.PICKUP_DONE, ORDER_STATUS.DELIVERY_IN_PROGRESS, ORDER_STATUS.IN_PROGRESS].includes(order.status)) throw new HttpError(400, 'Esta encomenda não está numa fase válida para iniciar a entrega.');
    orderUpdate = { status: ORDER_STATUS.DELIVERY_IN_PROGRESS, delivery_start_at: order.delivery_start_at || now };
    profileStatus = DRIVER_STATUS.DELIVERY;
    message = 'Entrega iniciada.';
    event = 'delivery_started';
  } else if (action === 'delivery-complete' || action === 'complete') {
    const body = await readBody(req) as AnyRecord;
    requiredFields(body, ['verification_code']);
    if (String(order.verification_code).toUpperCase() !== String(body.verification_code).toUpperCase()) throw new HttpError(400, 'Código de verificação incorreto.');

    const totalPrice = toNumber(order.price, 0);
    const requiresPayment = requiresImmediatePayment(order);
    let paymentUpdate: AnyRecord;

    if (requiresPayment) {
      const rawConfirmed = body.payment_amount_confirmed;
      if (rawConfirmed === undefined || rawConfirmed === null || String(rawConfirmed).trim() === '') {
        throw new HttpError(400, 'Introduza manualmente o valor recebido para confirmar o pagamento.');
      }
      const confirmed = Number(String(rawConfirmed).trim().replace(',', '.'));
      if (!Number.isFinite(confirmed)) throw new HttpError(400, 'Introduza um valor recebido válido.');
      if (Math.round(confirmed * 100) !== Math.round(totalPrice * 100)) {
        await updateRow('orders', order.id, {
          payment_status: PAYMENT_STATUS.AWAITING_DRIVER_CONFIRMATION,
          payment_confirmation_requested_at: order.payment_confirmation_requested_at || now
        });
        throw new HttpError(400, `Valor divergente. O valor correto a confirmar é ${totalPrice.toFixed(2)} MZN.`);
      }
      paymentUpdate = {
        payment_status: PAYMENT_STATUS.PAID,
        payment_confirmed_amount: confirmed,
        payment_confirmed_at: now
      };
    } else {
      paymentUpdate = {
        payment_status: PAYMENT_STATUS.POSTPAID_MONTHLY,
        payment_confirmed_amount: 0,
        payment_confirmed_at: now
      };
    }

    const driverType = profile.driver_type || DRIVER_TYPES.FREELANCER;
    const commission = driverType === DRIVER_TYPES.OFFICIAL ? 0 : toNumber(profile.commission_rate, 20);
    const driverValue = totalPrice * (commission / 100);
    orderUpdate = {
      status: ORDER_STATUS.COMPLETED,
      timestamp_started: order.timestamp_started || order.pickup_start_at || now,
      pickup_start_at: order.pickup_start_at || order.timestamp_started || now,
      pickup_completed_at: order.pickup_completed_at || now,
      delivery_start_at: order.delivery_start_at || now,
      delivery_completed_at: now,
      timestamp_completed: now,
      valor_motorista: driverValue,
      valor_empresa: totalPrice - driverValue,
      driver_delivery_notes: String(body.driver_delivery_notes || '').trim().slice(0, 1000),
      delivery_proof_url: cleanDriverImage(body.delivery_proof_url),
      delivery_proof_at: body.delivery_proof_url ? now : null,
      ...paymentUpdate
    };
    profileStatus = DRIVER_STATUS.ONLINE_FREE;
    message = requiresPayment ? 'Entrega finalizada e pagamento confirmado!' : 'Entrega finalizada. Cliente pós-pago para fecho mensal.';
    event = 'delivery_completed';
  }

  const updatedOrder = await updateRow('orders', order.id, orderUpdate);
  const updatedProfile = await updateRow('driver_profiles', profile.id, { status: profileStatus });
  await upsertDriverPresence(updatedProfile, {
    current_order_id: event === 'delivery_completed' ? null : updatedOrder.id,
    is_available: event === 'delivery_completed',
    is_online: true
  });
  const statusMessages: AnyRecord = {
    pickup_started: `${user.nome || 'O motorista'} iniciou o percurso para a recolha.`,
    pickup_completed: `${user.nome || 'O motorista'} confirmou o levantamento do pedido.`,
    delivery_started: `${user.nome || 'O motorista'} iniciou a entrega ao cliente.`,
    delivery_completed: 'Entrega concluída com sucesso.'
  };
  if (statusMessages[event]) await createOrderMessage(order.id, 'system', 'system', 'TraGo', statusMessages[event], 'status', { status: updatedOrder.status });
  const publicLabels: AnyRecord = {
    pickup_started: 'Pedido confirmado',
    pickup_completed: 'Pedido confirmado',
    delivery_started: 'A caminho',
    delivery_completed: 'Entregue'
  };
  if (statusMessages[event]) {
    await recordOrderStatusEvent(order.id, updatedOrder.status, publicLabels[event] || statusMessages[event], 'driver', profile.id, user.nome || 'Motorista');
    await recordAudit('driver', profile.id, event, 'order', order.id, { status: updatedOrder.status });
  }
  if (statusMessages[event]) {
    const titles: AnyRecord = {
      pickup_started: 'Motorista a caminho da recolha',
      pickup_completed: 'Pedido recolhido',
      delivery_started: 'Entrega iniciada',
      delivery_completed: 'Pedido entregue'
    };
    await createClientNotification(updatedOrder, event === 'delivery_completed' ? 'success' : 'driver', titles[event] || 'Actualização da entrega', statusMessages[event], { status: updatedOrder.status });
  }
  if (event === 'delivery_completed') {
    await createAdminNotification({
      dedupeKey: `delivery_completed:${updatedOrder.id}`,
      type: 'success',
      title: 'Entrega finalizada',
      message: `Pedido ${shortOrderCode(updatedOrder.id)} · Código ${updatedOrder.verification_code || '—'} · finalizado por ${user.nome || 'motorista'}.`,
      order: updatedOrder,
      payload: { driverName: user.nome, amount: Number(updatedOrder.price || 0), paymentMethod: updatedOrder.payment_method },
      createdAt: updatedOrder.timestamp_completed || nowIso()
    });
  }
  await broadcastAdmin(event, { id: updatedOrder.id, driverName: user.nome, orderCode: shortOrderCode(updatedOrder.id), verificationCode: updatedOrder.verification_code });
  await broadcastAdmin('driver_status_changed', { driverId: updatedProfile.id, driverUserId: user.id, newStatus: updatedProfile.status });
  return json({ message, order: fromOrder(updatedOrder) });
};

const routeNotifications = async (req: Request, path: string, method: string) => {
  if (!path.startsWith('/api/notifications')) return null;
  await requireUser(req, 'admin');

  if (path === '/api/notifications' && method === 'GET') {
    await syncOperationalNotifications();
    const query = parseQuery(req);
    const limit = Math.min(Math.max(Number(query.limit || 80), 1), 150);
    let q = supabase
      .from('system_notifications')
      .select('*')
      .eq('scope', 'admin')
      .is('read_at', null)
      .order('created_at', { ascending: false })
      .limit(limit);

    const { data, error } = await q;
    if (error) throw new HttpError(500, error.message);
    return json({ notifications: (data || []).map(fromNotification), totalUnread: (data || []).length });
  }

  if (path === '/api/notifications/mark-all-read' && method === 'POST') {
    const { data, error } = await supabase
      .from('system_notifications')
      .update({ read_at: nowIso(), updated_at: nowIso() })
      .eq('scope', 'admin')
      .is('read_at', null)
      .select('id');
    if (error) throw new HttpError(500, error.message);
    return json({ message: 'Notificações marcadas como lidas.', updatedCount: data?.length || 0 });
  }

  const readMatch = path.match(/^\/api\/notifications\/([a-f0-9]{24})\/read$/i);
  if (readMatch && ['POST', 'PUT', 'PATCH'].includes(method)) {
    const { data, error } = await supabase
      .from('system_notifications')
      .update({ read_at: nowIso(), updated_at: nowIso() })
      .eq('id', readMatch[1])
      .eq('scope', 'admin')
      .select('*')
      .maybeSingle();
    if (error) throw new HttpError(500, error.message);
    if (!data) throw new HttpError(404, 'Notificação não encontrada.');
    return json({ message: 'Notificação marcada como lida.', notification: fromNotification(data) });
  }

  return null;
};

const resolveSupportActor = async (req: Request, payload: AnyRecord = {}) => {
  const token = readToken(req);
  if (token) {
    let decoded: AnyRecord;
    try {
      decoded = await verifyToken(token);
    } catch (_error) {
      throw new HttpError(401, 'Sessão inválida ou expirada.');
    }

    if (decoded?.user?.id) {
      const user = await selectOne('users', 'id', decoded.user.id);
      if (!user) throw new HttpError(401, 'Utilizador inexistente.');
      if (!['admin', 'driver'].includes(user.role)) throw new HttpError(403, 'Perfil sem acesso ao suporte interno.');
      return { role: user.role, id: user.id, name: user.nome || user.email || user.role };
    }

    if (decoded?.restaurant?.id) {
      const restaurant = await selectOne('restaurants', 'id', decoded.restaurant.id);
      if (!restaurant || restaurant.status !== 'active') throw new HttpError(401, 'Restaurante inexistente ou inactivo.');
      return { role: 'restaurant', id: restaurant.id, name: restaurant.name || 'Restaurante' };
    }

    if (decoded?.client?.id) {
      const client = await selectOne('clients', 'id', decoded.client.id);
      if (!client || client.account_status !== 'active' || client.deleted_at) throw new HttpError(401, 'Cliente inexistente ou inactivo.');
      return { role: 'client', id: client.id, name: client.nome || 'Cliente' };
    }

    throw new HttpError(401, 'Sessão inválida ou expirada.');
  }

  const query = parseQuery(req);
  const sessionId = String(clean(payload.client_session_id || query.client_session_id) || '').slice(0, 120);
  const clientName = String(clean(payload.client_name || query.client_name) || '').slice(0, 120);
  if (!sessionId) throw new HttpError(401, 'Identificação necessária para usar o suporte.');
  return { role: 'client', id: sessionId, name: clientName || 'Cliente' };
};

const ensureSupportAccess = (thread: AnyRecord, actor: AnyRecord) => {
  const owner = thread.requester_role === actor.role && String(thread.requester_id) === String(actor.id);
  if (actor.role !== 'admin' && !owner) throw new HttpError(403, 'Não tem acesso a esta conversa.');
};

const notifySupportRealtime = async (event: string, thread: AnyRecord) => {
  const payload = {
    threadId: thread.id,
    requesterRole: thread.requester_role,
    requesterId: thread.requester_id,
    status: thread.status
  };
  await broadcastAdmin(event, payload);
  if (thread.requester_role === 'driver' && thread.requester_id) {
    await broadcastDriver(thread.requester_id, event, payload);
  }
};

const routeSupport = async (req: Request, path: string, method: string) => {
  if (!path.startsWith('/api/support')) return null;

  if (path === '/api/support/threads' && method === 'GET') {
    const actor = await resolveSupportActor(req);
    const query = parseQuery(req);
    let q = supabase.from('support_threads').select('*');
    if (actor.role !== 'admin') q = q.eq('requester_role', actor.role).eq('requester_id', actor.id);
    if (['open', 'pending', 'resolved', 'closed'].includes(String(query.status || ''))) q = q.eq('status', query.status);
    const { data, error } = await q.order('last_message_at', { ascending: false }).order('created_at', { ascending: false }).limit(150);
    if (error) throw new HttpError(500, error.message);
    return json({ threads: (data || []).map(fromSupportThread), actor: { role: actor.role, name: actor.name } });
  }

  if (path === '/api/support/threads' && method === 'POST') {
    const body = await readBody(req) as AnyRecord;
    const actor = await resolveSupportActor(req, body);
    const subject = String(clean(body.subject) || '').slice(0, 140);
    const messageBody = String(clean(body.message) || '').slice(0, 2000);
    if (!subject || !messageBody) throw new HttpError(400, 'Indique o assunto e a mensagem.');
    const now = nowIso();
    const thread = await insertRow('support_threads', {
      subject,
      category: ['order', 'payment', 'account', 'technical', 'restaurant', 'driver', 'general'].includes(String(body.category)) ? body.category : 'general',
      status: 'open',
      priority: ['low', 'normal', 'high', 'urgent'].includes(String(body.priority)) ? body.priority : 'normal',
      requester_role: actor.role,
      requester_id: actor.id,
      requester_name: actor.name,
      order_id: isValidId(String(body.order_id || '')) ? String(body.order_id) : null,
      assigned_admin_id: null,
      last_message_at: now,
      created_at: now
    });
    const message = await insertRow('support_messages', {
      thread_id: thread.id,
      sender_role: actor.role,
      sender_id: actor.id,
      sender_name: actor.name,
      body: messageBody,
      created_at: now
    });
    await createAdminNotification({
      dedupeKey: `support:${thread.id}:created`,
      type: 'info',
      title: `Novo pedido de suporte · ${actor.role}`,
      message: `${actor.name}: ${subject}`,
      orderId: thread.order_id,
      payload: { threadId: thread.id, requesterRole: actor.role, requesterName: actor.name }
    });
    await notifySupportRealtime('support_thread_created', thread);
    return json({ thread: fromSupportThread(thread), message: fromSupportMessage(message) }, 201);
  }

  const messagesMatch = path.match(/^\/api\/support\/threads\/([a-f0-9]{24})\/messages$/i);
  if (messagesMatch && method === 'GET') {
    const actor = await resolveSupportActor(req);
    const thread = await selectOne('support_threads', 'id', messagesMatch[1]);
    if (!thread) throw new HttpError(404, 'Conversa de suporte não encontrada.');
    ensureSupportAccess(thread, actor);
    const { data, error } = await supabase.from('support_messages').select('*').eq('thread_id', thread.id).order('created_at', { ascending: true }).limit(500);
    if (error) throw new HttpError(500, error.message);
    return json({ thread: fromSupportThread(thread), messages: (data || []).map(fromSupportMessage) });
  }

  if (messagesMatch && method === 'POST') {
    const body = await readBody(req) as AnyRecord;
    const actor = await resolveSupportActor(req, body);
    const thread = await selectOne('support_threads', 'id', messagesMatch[1]);
    if (!thread) throw new HttpError(404, 'Conversa de suporte não encontrada.');
    ensureSupportAccess(thread, actor);
    const messageBody = String(clean(body.message) || '').slice(0, 2000);
    if (!messageBody) throw new HttpError(400, 'Escreva uma mensagem.');
    const message = await insertRow('support_messages', {
      thread_id: thread.id,
      sender_role: actor.role,
      sender_id: actor.id,
      sender_name: actor.name,
      body: messageBody,
      created_at: nowIso()
    });
    const updated = await updateRow('support_threads', thread.id, {
      last_message_at: nowIso(),
      status: actor.role === 'admin' ? (thread.status === 'closed' ? 'closed' : 'pending') : (thread.status === 'closed' ? 'open' : thread.status),
      assigned_admin_id: actor.role === 'admin' ? actor.id : thread.assigned_admin_id
    });
    if (actor.role !== 'admin') {
      await createAdminNotification({
        dedupeKey: `support:${thread.id}:message:${message.id}`,
        type: 'info',
        title: `Nova mensagem de ${actor.name}`,
        message: messageBody.slice(0, 180),
        orderId: thread.order_id,
        payload: { threadId: thread.id, requesterRole: thread.requester_role }
      });
    }
    await notifySupportRealtime('support_message_created', updated);
    return json({ thread: fromSupportThread(updated), message: fromSupportMessage(message) }, 201);
  }

  const threadMatch = path.match(/^\/api\/support\/threads\/([a-f0-9]{24})$/i);
  if (threadMatch && method === 'PATCH') {
    const body = await readBody(req) as AnyRecord;
    const actor = await resolveSupportActor(req, body);
    const thread = await selectOne('support_threads', 'id', threadMatch[1]);
    if (!thread) throw new HttpError(404, 'Conversa de suporte não encontrada.');
    ensureSupportAccess(thread, actor);
    const patch: AnyRecord = {};
    const status = String(clean(body.status) || '');
    const priority = String(clean(body.priority) || '');
    if (status) {
      if (!['open', 'pending', 'resolved', 'closed'].includes(status)) throw new HttpError(400, 'Estado de suporte inválido.');
      if (actor.role !== 'admin' && !['open', 'closed'].includes(status)) throw new HttpError(403, 'Apenas o Admin pode definir este estado.');
      patch.status = status;
    }
    if (priority && actor.role === 'admin' && ['low', 'normal', 'high', 'urgent'].includes(priority)) patch.priority = priority;
    if (actor.role === 'admin') patch.assigned_admin_id = actor.id;
    const updated = await updateRow('support_threads', thread.id, patch);
    await notifySupportRealtime('support_thread_updated', updated);
    return json({ thread: fromSupportThread(updated) });
  }

  return null;
};

const routeStats = async (req: Request, path: string, method: string) => {
  if (!path.startsWith('/api/stats') || method !== 'GET') return null;
  await requireUser(req, 'admin');

  if (path === '/api/stats/overview') {
    const start = new Date(); start.setUTCHours(0, 0, 0, 0);
    const end = new Date(); end.setUTCHours(23, 59, 59, 999);
    const transitStatuses = [ORDER_STATUS.ASSIGNED, ORDER_STATUS.IN_PROGRESS, ORDER_STATUS.PICKUP_IN_PROGRESS, ORDER_STATUS.PICKUP_DONE, ORDER_STATUS.DELIVERY_IN_PROGRESS];
    const [pendentes, emTransito, concluidasHoje, motoristasOnline] = await Promise.all([
      countRows('orders', (q) => q.eq('status', ORDER_STATUS.PENDING)),
      countRows('orders', (q) => q.in('status', transitStatuses)),
      countRows('orders', (q) => q.eq('status', ORDER_STATUS.COMPLETED).gte('timestamp_completed', start.toISOString()).lte('timestamp_completed', end.toISOString())),
      countRows('driver_profiles', (q) => q.in('status', ONLINE_DRIVER_STATUSES))
    ]);
    return json({ pendentes, emTransito, concluidasHoje, motoristasOnline });
  }

  if (path === '/api/stats/services') {
    const serviceNames: AnyRecord = { rapido: 'Delivery Rápido', doc: 'Doc.', farma: 'Farmácia', carga: 'Cargas', restaurante_comida: 'Comida de Restaurante', mercadoria_cp: 'Mercadoria C/P', refeicao_restaurante_p: 'Refeição Restaurante P', outros: 'Outros' };
    const { data, error } = await supabase.from('orders').select('service_type,price').eq('status', ORDER_STATUS.COMPLETED);
    if (error) throw new HttpError(500, error.message);
    const byService: AnyRecord = {};
    for (const row of data || []) {
      const key = row.service_type || 'outros';
      byService[key] = byService[key] || { totalValue: 0, totalOrders: 0 };
      byService[key].totalValue += Number(row.price || 0);
      byService[key].totalOrders += 1;
    }
    const keys = Object.keys(serviceNames);
    return json({ labels: keys.map((k) => serviceNames[k]), dataValues: keys.map((k) => byService[k]?.totalValue || 0), adesaoValues: keys.map((k) => byService[k]?.totalOrders || 0) });
  }

  if (path === '/api/stats/financials') {
    const query = parseQuery(req);
    const range = getPeriodRange(query.period || 'month');
    const { data, error } = await supabase.from('orders').select('*').eq('status', ORDER_STATUS.COMPLETED).gte('timestamp_completed', range.start.toISOString()).lte('timestamp_completed', range.end.toISOString());
    if (error) throw new HttpError(500, error.message);
    const rows = data || [];
    const totals = rows.reduce((acc: AnyRecord, row: AnyRecord) => {
      acc.totalReceita += Number(row.price || 0);
      acc.totalGanhosMotorista += Number(row.valor_motorista || 0);
      acc.totalLucroEmpresa += Number(row.valor_empresa || 0);
      acc.byDriver[row.assigned_to_driver] = (acc.byDriver[row.assigned_to_driver] || 0) + Number(row.valor_motorista || 0);
      return acc;
    }, { totalReceita: 0, totalGanhosMotorista: 0, totalLucroEmpresa: 0, byDriver: {} });
    const [topProfileId, topValue] = Object.entries(totals.byDriver).sort((a: any, b: any) => b[1] - a[1])[0] || [null, 0];
    let topDriver = { nome: 'N/A', totalGanhos: 0 };
    if (topProfileId) {
      const profile = await selectOne('driver_profiles', 'id', topProfileId);
      const user = profile ? await selectOne('users', 'id', profile.user_id) : null;
      topDriver = { nome: user?.nome || 'N/A', totalGanhos: Number(topValue || 0) };
    }
    return json({
      totalReceita: totals.totalReceita,
      totalGanhosMotorista: totals.totalGanhosMotorista,
      totalLucroEmpresa: totals.totalLucroEmpresa,
      topDriver,
      period: { key: range.key, label: range.label, start: range.start.toISOString(), end: range.end.toISOString() }
    });
  }

  return null;
};

const routeSimpleFinancials = async (req: Request, path: string, method: string) => {
  // Managers
  if (path === '/api/managers' && method === 'GET') {
    await requireUser(req, 'admin');
    const { data, error } = await supabase.from('users').select('*').eq('role', 'manager').order('nome', { ascending: true });
    if (error) throw new HttpError(500, error.message);
    return json({ managers: (data || []).map(fromUser) });
  }
  if (path === '/api/managers' && method === 'POST') {
    await requireUser(req, 'admin');
    const body = await readBody(req) as AnyRecord;
    requiredFields(body, ['nome', 'email', 'telefone', 'password']);
    const exists = await selectOne('users', 'email', lowerEmail(body.email));
    if (exists) throw new HttpError(400, 'Já existe um utilizador com este email.');
    const row = await insertRow('users', { nome: clean(body.nome), email: lowerEmail(body.email), telefone: clean(body.telefone), password: bcrypt.hashSync(String(body.password), 12), role: 'manager' });
    return json({ message: 'Gestor criado com sucesso.', manager: fromUser(row) }, 201);
  }
  const managerMatch = path.match(/^\/api\/managers\/([a-f0-9]{24})$/i);
  if (managerMatch && method === 'GET') {
    await requireUser(req, 'admin');
    const row = await selectOne('users', 'id', managerMatch[1]);
    if (!row || row.role !== 'manager') throw new HttpError(404, 'Gestor não encontrado.');
    return json({ manager: fromUser(row) });
  }
  if (managerMatch && method === 'PUT') {
    await requireUser(req, 'admin');
    const body = await readBody(req) as AnyRecord;
    const row = await selectOne('users', 'id', managerMatch[1]);
    if (!row || row.role !== 'manager') throw new HttpError(404, 'Gestor não encontrado.');
    const updated = await updateRow('users', row.id, { nome: clean(body.nome), telefone: clean(body.telefone), email: lowerEmail(body.email) });
    return json({ message: 'Gestor atualizado com sucesso.', manager: fromUser(updated) });
  }
  if (managerMatch && method === 'DELETE') {
    await requireUser(req, 'admin');
    await deleteRow('users', managerMatch[1]);
    return json({ message: 'Gestor apagado com sucesso.' });
  }

  // Expenses
  if (path === '/api/expenses' && method === 'GET') {
    await requireUser(req, ['admin', 'manager']);
    const query = parseQuery(req);
    let q = supabase.from('expenses').select('*');
    if (query.category) q = q.eq('category', query.category);
    if (query.startDate) q = q.gte('date', new Date(query.startDate).toISOString());
    if (query.endDate) { const end = new Date(query.endDate); end.setUTCHours(23, 59, 59, 999); q = q.lte('date', end.toISOString()); }
    const { data, error } = await q.order('date', { ascending: false });
    if (error) throw new HttpError(500, error.message);
    return json({ expenses: (data || []).map(fromExpense) });
  }
  if (path === '/api/expenses' && method === 'POST') {
    const user = await requireUser(req, ['admin', 'manager']);
    const body = await readBody(req) as AnyRecord;
    requiredFields(body, ['category', 'description', 'amount', 'date']);
    const row = await insertRow('expenses', { category: clean(body.category), description: clean(body.description), amount: toNumber(body.amount), date: new Date(body.date).toISOString(), employee: isValidId(String(body.employee || '')) ? String(body.employee) : null, created_by: user.id });
    return json({ message: 'Despesa criada com sucesso.', expense: fromExpense(row) }, 201);
  }
  if (path === '/api/expenses/summary' && method === 'GET') {
    await requireUser(req, ['admin', 'manager']);
    const { data, error } = await supabase.from('expenses').select('category,amount');
    if (error) throw new HttpError(500, error.message);
    const summary: AnyRecord = {};
    for (const row of data || []) summary[row.category] = (summary[row.category] || 0) + Number(row.amount || 0);
    return json({ summary });
  }
  const expenseMatch = path.match(/^\/api\/expenses\/([a-f0-9]{24})$/i);
  if (expenseMatch && method === 'PUT') {
    await requireUser(req, ['admin', 'manager']);
    const body = await readBody(req) as AnyRecord;
    const row = await updateRow('expenses', expenseMatch[1], { category: clean(body.category), description: clean(body.description), amount: toNumber(body.amount), date: new Date(body.date).toISOString(), employee: isValidId(String(body.employee || '')) ? String(body.employee) : null });
    return json({ message: 'Despesa atualizada com sucesso.', expense: fromExpense(row) });
  }
  if (expenseMatch && method === 'DELETE') {
    await requireUser(req, ['admin', 'manager']);
    await deleteRow('expenses', expenseMatch[1]);
    return json({ message: 'Despesa apagada com sucesso.' });
  }

  // Costs
  if (path.startsWith('/api/costs') && method === 'GET') {
    await requireUser(req, 'admin');
    if (path === '/api/costs/dashboard-summary') return costsDashboardSummary(req);
    const query = parseQuery(req);
    let q = supabase.from('company_costs').select('*');
    if (query.category) q = q.eq('category', query.category);
    if (query.startDate) q = q.gte('date', new Date(query.startDate).toISOString());
    if (query.endDate) { const end = new Date(query.endDate); end.setUTCHours(23, 59, 59, 999); q = q.lte('date', end.toISOString()); }
    const { data, error } = await q.order('date', { ascending: false });
    if (error) throw new HttpError(500, error.message);
    const costs = [];
    for (const row of data || []) costs.push(await enrichCost(row));
    return json({ costs });
  }
  if (path === '/api/costs' && method === 'POST') {
    const user = await requireUser(req, 'admin');
    const body = await readBody(req) as AnyRecord;
    requiredFields(body, ['category', 'amount']);
    const row = await insertRow('company_costs', {
      category: clean(body.category),
      description: clean(body.description) || '',
      amount: toNumber(body.amount),
      date: body.date ? new Date(body.date).toISOString() : nowIso(),
      created_by: user.id,
      assigned_user: isValidId(String(body.assignedUserId || body.assignedUser || '')) ? String(body.assignedUserId || body.assignedUser) : null,
      assigned_client: isValidId(String(body.assignedClientId || body.assignedClient || '')) ? String(body.assignedClientId || body.assignedClient) : null,
      assigned_vehicle: isValidId(String(body.assignedVehicleId || body.assignedVehicle || '')) ? String(body.assignedVehicleId || body.assignedVehicle) : null
    });
    return json({ message: 'Custo criado com sucesso.', cost: await enrichCost(row) }, 201);
  }

  return null;
};

const costsDashboardSummary = async (req: Request) => {
  const query = parseQuery(req);
  const months = Math.min(Math.max(Number(query.months || 6), 1), 24);
  const from = new Date();
  from.setUTCMonth(from.getUTCMonth() - (months - 1));
  from.setUTCDate(1); from.setUTCHours(0, 0, 0, 0);

  const { data: costs, error: costError } = await supabase.from('company_costs').select('*').gte('date', from.toISOString());
  if (costError) throw new HttpError(500, costError.message);
  const { data: orders, error: orderError } = await supabase.from('orders').select('*').eq('status', ORDER_STATUS.COMPLETED).gte('timestamp_completed', from.toISOString());
  if (orderError) throw new HttpError(500, orderError.message);

  const totalCosts = (costs || []).reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const totalRevenue = (orders || []).reduce((sum, row) => sum + Number(row.price || 0), 0);
  return json({
    totalCosts,
    totalRevenue,
    netProfit: totalRevenue - totalCosts,
    costsByCategory: (costs || []).reduce((acc: AnyRecord, row: AnyRecord) => {
      acc[row.category] = (acc[row.category] || 0) + Number(row.amount || 0);
      return acc;
    }, {})
  });
};

const routeAdmin = async (req: Request, path: string, method: string) => {
  if (path === '/api/admin/orders/history' && method === 'DELETE') {
    await requireUser(req, 'admin');
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - 30);
    const { data, error } = await supabase
      .from('orders')
      .delete()
      .in('status', [ORDER_STATUS.COMPLETED, ORDER_STATUS.CANCELED])
      .lt('timestamp_completed', cutoff.toISOString())
      .select('id');
    if (error) throw new HttpError(500, error.message);
    await broadcastAdmin('orders_changed', { action: 'history_deleted' });
    return json({ message: 'Histórico antigo apagado com sucesso.', deletedCount: data?.length || 0 });
  }

  if (path === '/api/admin/export-financial' && method === 'GET') {
    await requireUser(req, 'admin');
    const query = parseQuery(req);
    let q = supabase.from('orders').select('*').eq('status', ORDER_STATUS.COMPLETED);
    if (query.startDate) q = q.gte('timestamp_completed', new Date(query.startDate).toISOString());
    if (query.endDate) { const end = new Date(query.endDate); end.setUTCHours(23, 59, 59, 999); q = q.lte('timestamp_completed', end.toISOString()); }
    const { data, error } = await q.order('timestamp_completed', { ascending: false });
    if (error) throw new HttpError(500, error.message);
    const header = ['ID', 'Cliente', 'Serviço', 'Preço', 'Motorista', 'Empresa', 'Pagamento', 'Concluído Em'];
    const lines = [header.join(',')].concat((data || []).map((row) => [row.id, row.client_name, row.service_type, row.price, row.valor_motorista, row.valor_empresa, row.payment_method, row.timestamp_completed].map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')));
    return textResponse(lines.join('\n'), 200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="trago-financeiro.csv"' });
  }

  return null;
};

const routeTrips = async (req: Request, path: string, method: string) => {
  const historyMatch = path.match(/^\/api\/trips\/driver\/([a-f0-9]{24})\/history$/i);
  if (historyMatch && method === 'GET') {
    await requireUser(req, 'admin');
    const profile = await getDriverProfileByUser(historyMatch[1]);
    if (!profile) throw new HttpError(404, 'Perfil de motorista não encontrado.');
    const { data, error } = await supabase.from('trips').select('*').eq('driver', profile.id).order('started_at', { ascending: false });
    if (error) throw new HttpError(500, error.message);
    return json({ trips: (data || []).map(fromTrip) });
  }
  return null;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const path = normalizePath(req.url);
  const method = req.method.toUpperCase();

  try {
    if (path === '/health') return json({
      status: 'ok',
      runtime: 'supabase-edge-functions',
      storageBucket: STORAGE_BUCKET,
      features: {
        password_reset_email: Boolean(RESEND_API_KEY),
        road_route_geometry: Boolean(TRAGO_ORS_API_KEY),
        google_client_login: Boolean(TRAGO_GOOGLE_CLIENT_ID)
      }
    });

    const handlers = [routeAuth, routeRealtime, routeGeo, routeMedia, routeClientPortal, routePublicPortals, routeDrivers, routeClients, routeVehicles, routeOrders, routeNotifications, routeSupport, routeStats, routeSimpleFinancials, routeAdmin, routeTrips];
    for (const handler of handlers) {
      const response = await handler(req, path, method);
      if (response) return response;
    }

    return json({ message: `Rota não encontrada: ${method} ${path}` }, 404);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof Error ? error.message : 'Erro interno do servidor.';
    console.error(`[trago-edge] ${method} ${path}`, error);
    return json({ message }, status);
  }
});
