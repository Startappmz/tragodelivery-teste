// backend/server.js

require('dotenv').config();

const path = require('node:path');
const http = require('node:http');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const hpp = require('hpp');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss-clean');
const { Server } = require('socket.io');

const connectDB = require('./config/db');
const rateLimiter = require('./middleware/rateLimiter');
const { notFound, errorHandler } = require('./middleware/errorMiddleware');
const { initSocketHandler } = require('./socketHandler');
const { ADMIN_ROOM } = require('./utils/constants');
const { validateRequiredEnv } = require('./utils/validateEnv');

validateRequiredEnv(['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'JWT_SECRET']);

connectDB();

const app = express();
const server = http.createServer(app);

const allowedOrigins = [process.env.FRONTEND_URL, process.env.FRONTEND_URL_DEV].filter(Boolean);

const corsOptions = {
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.error(`CORS bloqueado para a origem: ${origin}`);
      callback(new Error('Não permitido pela política de CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
};

const io = new Server(server, { cors: corsOptions });
app.set('socketio', io);

app.use(cors(corsOptions));
app.use(
  helmet({
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' }
  })
);
app.use(compression());
app.use(express.json({ limit: '4mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());
app.use(mongoSanitize());
app.use(xss());
app.use(hpp());

if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}

app.use('/uploads', express.static(path.join(__dirname, 'uploads'), { maxAge: '1d' }));

// Rate limit em todas as rotas /api
app.use('/api', rateLimiter);

// Rotas da API
app.use('/api', require('./routes/publicPortalRoutes')); // portais cliente/restaurante
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/orders', require('./routes/orderRoutes'));
app.use('/api/drivers', require('./routes/driverRoutes'));
app.use('/api/stats', require('./routes/statsRoutes'));
app.use('/api/clients', require('./routes/clientRoutes'));
app.use('/api/admin', require('./routes/adminRoutes'));
app.use('/api/costs', require('./routes/costRoutes')); // <- NOVO: custos da empresa
app.use('/api/vehicles', require('./routes/vehicleRoutes')); // frota e custos por matrícula
app.use('/api/notifications', require('./routes/notificationRoutes')); // notificações persistidas do sistema
app.use('/api/support', require('./routes/supportRoutes')); // suporte interno entre os quatro painéis
app.use('/api/geo', require('./routes/geoRoutes')); // Geolocalização e preço por distância

// Healthcheck
app.get('/health', (_req, res) =>
  res.status(200).json({
    status: 'ok',
    uptime: process.uptime(),
    adminRoom: ADMIN_ROOM
  })
);

// Rota raiz
app.get('/', (_req, res) => {
  res.send('<h1>Servidor Backend da Trago Delivery está no ar!</h1>');
});

initSocketHandler(io);

app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Servidor a correr na porta ${PORT}`);
});
