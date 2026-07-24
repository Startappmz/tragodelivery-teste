const asyncHandler = require('express-async-handler');
const SystemNotification = require('../models/SystemNotification');
const { syncOperationalNotifications } = require('../utils/notifications');

exports.listNotifications = asyncHandler(async (_req, res) => {
  await syncOperationalNotifications();
  const notifications = await SystemNotification.find({ scope: 'admin', readAt: null })
    .sort({ createdAt: -1 })
    .limit(80)
    .lean();
  res.status(200).json({ notifications, totalUnread: notifications.length });
});

exports.markNotificationRead = asyncHandler(async (req, res) => {
  const notification = await SystemNotification.findByIdAndUpdate(req.params.id, { readAt: new Date() });
  if (!notification) {
    res.status(404);
    throw new Error('Notificação não encontrada.');
  }
  res.status(200).json({ message: 'Notificação marcada como lida.', notification });
});

exports.markAllNotificationsRead = asyncHandler(async (_req, res) => {
  const notifications = await SystemNotification.find({ scope: 'admin', readAt: null }).lean();
  let updatedCount = 0;
  for (const notification of notifications) {
    await SystemNotification.findByIdAndUpdate(notification._id, { readAt: new Date() });
    updatedCount += 1;
  }
  res.status(200).json({ message: 'Notificações marcadas como lidas.', updatedCount });
});
