const { MESSAGE_CHANNEL, MESSAGE_CHANNELS } = require('./constants');

const ROLE_VISIBILITY = Object.freeze({
  [MESSAGE_CHANNEL.CLIENT_DRIVER]: Object.freeze(['client', 'driver', 'admin']),
  [MESSAGE_CHANNEL.DRIVER_PARTNER]: Object.freeze(['driver', 'restaurant', 'admin']),
  [MESSAGE_CHANNEL.SYSTEM]: Object.freeze(['client', 'driver', 'restaurant', 'admin']),
  [MESSAGE_CHANNEL.SUPPORT]: Object.freeze(['admin'])
});

const canUseChannel = (role, channel, { write = false } = {}) => {
  if (!MESSAGE_CHANNELS.includes(channel)) return false;
  if (role === 'system') return channel === MESSAGE_CHANNEL.SYSTEM;
  if (role === 'admin') return channel !== MESSAGE_CHANNEL.SUPPORT;
  if (role === 'driver') {
    return write
      ? [MESSAGE_CHANNEL.CLIENT_DRIVER, MESSAGE_CHANNEL.DRIVER_PARTNER].includes(channel)
      : [MESSAGE_CHANNEL.CLIENT_DRIVER, MESSAGE_CHANNEL.DRIVER_PARTNER, MESSAGE_CHANNEL.SYSTEM].includes(channel);
  }
  if (role === 'client') return channel === MESSAGE_CHANNEL.CLIENT_DRIVER || (!write && channel === MESSAGE_CHANNEL.SYSTEM);
  if (role === 'restaurant') return channel === MESSAGE_CHANNEL.DRIVER_PARTNER || (!write && channel === MESSAGE_CHANNEL.SYSTEM);
  return false;
};

const defaultChannelForRole = (role) => {
  if (role === 'client' || role === 'driver') return MESSAGE_CHANNEL.CLIENT_DRIVER;
  if (role === 'restaurant') return MESSAGE_CHANNEL.DRIVER_PARTNER;
  return MESSAGE_CHANNEL.SYSTEM;
};

const visibilityForChannel = (channel) => [...(ROLE_VISIBILITY[channel] || ROLE_VISIBILITY[MESSAGE_CHANNEL.SYSTEM])];

const channelsForViewer = (role, requestedChannel = '', includeSystem = true) => {
  if (requestedChannel && canUseChannel(role, requestedChannel)) {
    return includeSystem && requestedChannel !== MESSAGE_CHANNEL.SYSTEM
      ? [requestedChannel, MESSAGE_CHANNEL.SYSTEM]
      : [requestedChannel];
  }

  if (role === 'admin') return [MESSAGE_CHANNEL.CLIENT_DRIVER, MESSAGE_CHANNEL.DRIVER_PARTNER, MESSAGE_CHANNEL.SYSTEM];
  if (role === 'driver') return [MESSAGE_CHANNEL.CLIENT_DRIVER, MESSAGE_CHANNEL.DRIVER_PARTNER, MESSAGE_CHANNEL.SYSTEM];
  if (role === 'restaurant') return [MESSAGE_CHANNEL.DRIVER_PARTNER, MESSAGE_CHANNEL.SYSTEM];
  return [MESSAGE_CHANNEL.CLIENT_DRIVER, MESSAGE_CHANNEL.SYSTEM];
};

module.exports = {
  ROLE_VISIBILITY,
  canUseChannel,
  channelsForViewer,
  defaultChannelForRole,
  visibilityForChannel
};
