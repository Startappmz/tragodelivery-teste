const jwt = require('jsonwebtoken');
const DriverProfile = require('./models/DriverProfile');
const Order = require('./models/Order');
const { DRIVER_STATUS, ORDER_STATUS, ADMIN_ROOM } = require('./utils/constants');
const { syncDriverPresence } = require('./utils/driverPresence');

const socketUserMap = new Map();
const driverDisconnectTimers = new Map();
const PRESENCE_GRACE_MS = 45000;

const ONLINE_DRIVER_STATUSES = [
  DRIVER_STATUS.ONLINE_FREE,
  DRIVER_STATUS.ONLINE_BUSY,
  DRIVER_STATUS.PICKUP,
  DRIVER_STATUS.DELIVERY
];
const ACTIVE_ORDER_STATUSES = [
  ORDER_STATUS.ASSIGNED,
  ORDER_STATUS.IN_PROGRESS,
  ORDER_STATUS.PICKUP_IN_PROGRESS,
  ORDER_STATUS.PICKUP_DONE,
  ORDER_STATUS.DELIVERY_IN_PROGRESS
];

const isValidCoordinate = (value) => value !== null && value !== undefined && Number.isFinite(Number(value));
const isFreshLocation = (location, maxAgeMs = 60000) => {
  const value = location?.updatedAt || location?.updated_at;
  const timestamp = value ? new Date(value).getTime() : 0;
  return timestamp > 0 && Date.now() - timestamp <= maxAgeMs;
};

const buildLocationPayload = ({ profileId, userId, driverName, status, lastLocation }) => ({
  driverId: profileId || userId,
  driverUserId: userId,
  driverName,
  status: status || DRIVER_STATUS.ONLINE_FREE,
  lat: Number(lastLocation.lat),
  lng: Number(lastLocation.lng),
  accuracy: lastLocation.accuracy,
  speed: lastLocation.speed,
  updatedAt: lastLocation.updatedAt
});

const emitStoredDriverLocations = async (targetSocket) => {
  const seenProfileIds = new Set();

  socketUserMap.forEach((data) => {
    if (data.userRole !== 'driver' || !data.lastLocation || !isFreshLocation(data.lastLocation)) return;
    if (!isValidCoordinate(data.lastLocation.lat) || !isValidCoordinate(data.lastLocation.lng)) return;

    if (data.profileId) seenProfileIds.add(String(data.profileId));

    targetSocket.emit(
      'driver_location_broadcast',
      buildLocationPayload({
        profileId: data.profileId,
        userId: data.userId,
        driverName: data.userName,
        status: data.lastLocation.status,
        lastLocation: data.lastLocation
      })
    );
  });

  const profiles = await DriverProfile.find({
    status: { $in: ONLINE_DRIVER_STATUSES },
    'lastLocation.lat': { $exists: true, $ne: null },
    'lastLocation.lng': { $exists: true, $ne: null }
  })
    .populate('user', 'nome role')
    .lean();

  profiles.forEach((profile) => {
    const profileId = String(profile._id);
    if (seenProfileIds.has(profileId)) return;
    if (!profile.user || profile.user.role !== 'driver') return;
    if (!isValidCoordinate(profile.lastLocation?.lat) || !isValidCoordinate(profile.lastLocation?.lng)) return;
    if (!isFreshLocation(profile.lastLocation)) return;

    targetSocket.emit(
      'driver_location_broadcast',
      buildLocationPayload({
        profileId,
        userId: String(profile.user._id),
        driverName: profile.user.nome || 'Motorista',
        status: profile.status,
        lastLocation: profile.lastLocation
      })
    );
  });
};

const initSocketHandler = (io) => {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    throw new Error('JWT_SECRET não definido para Socket.IO.');
  }

  io.on('connection', async (socket) => {
    let userId;
    let userRole;
    let userName;

    try {
      const token = socket.handshake.auth?.token;
      if (!token) {
        throw new Error('Token não fornecido');
      }

      const decoded = jwt.verify(token, jwtSecret);
      userId = decoded.user.id;
      userRole = decoded.user.role;
      userName = decoded.user.nome;

      socketUserMap.set(socket.id, {
        userId,
        userRole,
        userName,
        profileId: null,
        lastLocation: null
      });

      if (userRole === 'admin') {
        socket.join(ADMIN_ROOM);
        await emitStoredDriverLocations(socket);
      }

      if (userRole === 'driver') {
        socket.join(userId);
        const pendingOffline = driverDisconnectTimers.get(userId);
        if (pendingOffline) {
          clearTimeout(pendingOffline);
          driverDisconnectTimers.delete(userId);
        }

        const profile = await DriverProfile.findOne({ user: userId });
        if (profile) {
          const activeOrder = await Order.findOne({
            assigned_to_driver: profile._id,
            status: { $in: ACTIVE_ORDER_STATUSES }
          });
          const restoredStatus = activeOrder?.status === ORDER_STATUS.DELIVERY_IN_PROGRESS
            ? DRIVER_STATUS.DELIVERY
            : activeOrder?.status === ORDER_STATUS.PICKUP_IN_PROGRESS
              ? DRIVER_STATUS.PICKUP
              : activeOrder
                ? DRIVER_STATUS.ONLINE_BUSY
                : DRIVER_STATUS.ONLINE_FREE;
          if (profile.status !== restoredStatus) {
            profile.status = restoredStatus;
            await profile.save();
          }
          profile.activeOrderId = activeOrder?._id || null;
          await syncDriverPresence(profile, {
            isOnline: true,
            isAvailable: restoredStatus === DRIVER_STATUS.ONLINE_FREE,
            currentOrderId: profile.activeOrderId,
            lastSeenAt: new Date()
          });
        }

        const entry = socketUserMap.get(socket.id);
        if (entry && profile) {
          entry.profileId = String(profile._id);
          if (profile.lastLocation?.lat != null && profile.lastLocation?.lng != null) {
            const storedLocation = typeof profile.lastLocation.toObject === 'function'
              ? profile.lastLocation.toObject()
              : profile.lastLocation;

            entry.lastLocation = {
              ...storedLocation,
              status: profile.status
            };

            io.to(ADMIN_ROOM).emit(
              'driver_location_broadcast',
              buildLocationPayload({
                profileId: entry.profileId,
                userId,
                driverName: userName,
                status: profile.status,
                lastLocation: entry.lastLocation
              })
            );
          }
        }
      }
    } catch (error) {
      console.log(`Falha na autenticação do socket (${socket.id}):`, error.message);
      socket.disconnect();
      return;
    }

    socket.on('admin_request_all_locations', async () => {
      if (userRole !== 'admin') return;

      try {
        await emitStoredDriverLocations(socket);
      } catch (error) {
        console.error('Erro ao enviar localizações ativas para o admin:', error);
      }
    });

    socket.on('driver_location_update', async (payload) => {
      if (userRole !== 'driver') return;

      const { lat, lng, accuracy, speed } = payload || {};
      if (!isValidCoordinate(lat) || !isValidCoordinate(lng)) return;

      const parsedLocation = {
        lat: Number(lat),
        lng: Number(lng),
        accuracy: isValidCoordinate(accuracy) ? Number(accuracy) : undefined,
        speed: isValidCoordinate(speed) ? Number(speed) : undefined,
        updatedAt: new Date()
      };

      try {
        const profile = await DriverProfile.findOneAndUpdate(
          { user: userId },
          { $set: { lastLocation: parsedLocation } },
          { new: true }
        );

        const status = profile ? profile.status : DRIVER_STATUS.ONLINE_FREE;
        const profileId = profile ? String(profile._id) : null;
        const lastLocation = { ...parsedLocation, status };

        if (socketUserMap.has(socket.id)) {
          const entry = socketUserMap.get(socket.id);
          entry.profileId = profileId;
          entry.lastLocation = lastLocation;
        }
        if (profile) {
          await syncDriverPresence(profile, {
            status,
            location: parsedLocation,
            isOnline: true,
            isAvailable: status === DRIVER_STATUS.ONLINE_FREE,
            lastSeenAt: parsedLocation.updatedAt
          });
        }

        io.to(ADMIN_ROOM).emit(
          'driver_location_broadcast',
          buildLocationPayload({
            profileId,
            userId,
            driverName: userName,
            status,
            lastLocation
          })
        );
      } catch (error) {
        console.error('Erro ao atualizar localização do motorista:', error);
      }
    });

    socket.on('disconnect', async () => {
      const userData = socketUserMap.get(socket.id);

      if (userData?.userRole === 'driver') {
        const hasOtherActiveDriverSocket = Array.from(socketUserMap.entries()).some(
          ([socketId, data]) =>
            socketId !== socket.id &&
            data.userRole === 'driver' &&
            data.userId === userData.userId
        );

        if (!hasOtherActiveDriverSocket) {
          const previousTimer = driverDisconnectTimers.get(userData.userId);
          if (previousTimer) clearTimeout(previousTimer);
          const timer = setTimeout(async () => {
            const reconnected = Array.from(socketUserMap.values()).some(
              (data) => data.userRole === 'driver' && data.userId === userData.userId
            );
            if (reconnected) return;
            try {
              const profile = await DriverProfile.findOneAndUpdate(
                { user: userData.userId },
                { status: DRIVER_STATUS.OFFLINE }
              );
              if (profile) {
                await syncDriverPresence(profile, {
                  isOnline: false,
                  isAvailable: false,
                  lastSeenAt: new Date()
                });
              }
              io.to(ADMIN_ROOM).emit('driver_status_changed', {
                driverId: userData.profileId || userData.userId,
                driverUserId: userData.userId,
                newStatus: DRIVER_STATUS.OFFLINE
              });
              io.to(ADMIN_ROOM).emit('driver_disconnected_broadcast', {
                driverId: userData.profileId || userData.userId,
                driverUserId: userData.userId,
                driverName: userData.userName
              });
            } catch (err) {
              console.error('Erro ao atualizar status para offline:', err);
            } finally {
              driverDisconnectTimers.delete(userData.userId);
            }
          }, PRESENCE_GRACE_MS);
          driverDisconnectTimers.set(userData.userId, timer);
        }
      }

      socketUserMap.delete(socket.id);
    });
  });
};

const getSocketUserMap = () => socketUserMap;

module.exports = {
  initSocketHandler,
  getSocketUserMap
};
