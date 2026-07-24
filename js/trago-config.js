(function installTragoConfig(global) {
  const current = global.TRAGO_CONFIG && typeof global.TRAGO_CONFIG === 'object'
    ? global.TRAGO_CONFIG
    : {};

  global.TRAGO_CONFIG = Object.freeze({
    API_URL: '',
    SOCKET_URL: '',
    APP_ENV: '',
    MAP_PROVIDER: 'openstreetmap',
    REQUEST_TIMEOUT_MS: 15000,
    GET_RETRY_COUNT: 1,
    SOCKET_PATH: '/socket.io',
    ...current
  });

  // Compatibilidade temporária com os portais Vanilla existentes durante o cutover.
  if (typeof global.API_URL !== 'string') global.API_URL = global.TRAGO_CONFIG.API_URL;
})(globalThis);
