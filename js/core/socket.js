import { getAccessToken } from './auth.js';
import { getSocketOrigin, TRAGO_CONFIG } from './config.js';

let socketIoLoader = null;
const sharedClients = new Map();

function socketClientScriptUrl() {
  const origin = getSocketOrigin() || (typeof window !== 'undefined' ? window.location.origin : '');
  if (!origin) throw new Error('SOCKET_URL não está configurado.');
  const path = TRAGO_CONFIG.SOCKET_PATH.replace(/\/+$/, '');
  return new URL(`${path}/socket.io.js`, `${origin}/`).toString();
}

export function ensureSocketIoClient() {
  if (typeof globalThis.io === 'function') return Promise.resolve(globalThis.io);
  if (typeof document === 'undefined') return Promise.reject(new Error('Socket.IO Client não está disponível neste ambiente.'));
  if (socketIoLoader) return socketIoLoader;

  socketIoLoader = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = socketClientScriptUrl();
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.dataset.tragoSocketClient = '';
    script.onload = () => {
      if (typeof globalThis.io === 'function') resolve(globalThis.io);
      else reject(new Error('O servidor não disponibilizou o cliente Socket.IO.'));
    };
    script.onerror = () => reject(new Error('Não foi possível carregar o cliente Socket.IO.'));
    document.head.append(script);
  }).catch((error) => {
    socketIoLoader = null;
    throw error;
  });
  return socketIoLoader;
}

export function createSocketClient(options = {}) {
  const actor = options.actor || null;
  const tokenProvider = options.tokenProvider || (() => getAccessToken(actor));
  const statusListeners = new Set();
  const pendingListeners = [];
  let socket = null;
  let state = 'idle';
  let connectPromise = null;

  const setState = (nextState, detail = {}) => {
    if (nextState === state && !detail.force) return;
    const previous = state;
    state = nextState;
    statusListeners.forEach((listener) => listener(nextState, previous, detail));
    options.onStatusChange?.(nextState, previous, detail);
  };

  const bindLifecycle = () => {
    socket.on('connect', () => setState('connected', { socketId: socket.id }));
    socket.on('disconnect', (reason) => setState('disconnected', { reason }));
    socket.on('connect_error', (error) => setState('error', { error, message: error?.message }));
    socket.io.on('reconnect_attempt', (attempt) => setState('reconnecting', { attempt }));
    socket.io.on('reconnect_failed', () => setState('error', { message: 'Falha de reconexão.' }));
    pendingListeners.splice(0).forEach(([event, listener]) => socket.on(event, listener));
  };

  const connect = async () => {
    if (socket?.connected) return socket;
    if (connectPromise) return connectPromise;
    setState('connecting');

    connectPromise = (async () => {
      const ioFactory = options.ioFactory || await ensureSocketIoClient();
      const origin = options.url || getSocketOrigin() || undefined;
      const factoryOptions = {
        path: options.path || TRAGO_CONFIG.SOCKET_PATH,
        autoConnect: false,
        reconnection: options.reconnection !== false,
        reconnectionAttempts: options.reconnectionAttempts ?? Infinity,
        reconnectionDelay: options.reconnectionDelay ?? 800,
        reconnectionDelayMax: options.reconnectionDelayMax ?? 5000,
        timeout: options.timeout || TRAGO_CONFIG.REQUEST_TIMEOUT_MS,
        transports: options.transports || ['websocket', 'polling'],
        auth(callback) {
          callback({ token: tokenProvider() || undefined, actor: actor || undefined });
        }
      };
      socket = ioFactory(origin, factoryOptions);
      bindLifecycle();
      socket.connect();
      return socket;
    })();

    try {
      return await connectPromise;
    } catch (error) {
      setState('error', { error, message: error?.message });
      throw error;
    } finally {
      connectPromise = null;
    }
  };

  const client = Object.freeze({
    connect,
    disconnect() {
      socket?.disconnect();
      socket = null;
      setState('idle');
    },
    on(event, listener) {
      if (typeof listener !== 'function') throw new TypeError('O listener do socket deve ser uma função.');
      if (socket) socket.on(event, listener);
      else pendingListeners.push([event, listener]);
      return () => client.off(event, listener);
    },
    once(event, listener) {
      if (!socket) throw new Error('Ligue o socket antes de usar once().');
      socket.once(event, listener);
      return () => socket.off(event, listener);
    },
    off(event, listener) {
      socket?.off(event, listener);
      for (let index = pendingListeners.length - 1; index >= 0; index -= 1) {
        if (pendingListeners[index][0] === event && (!listener || pendingListeners[index][1] === listener)) {
          pendingListeners.splice(index, 1);
        }
      }
    },
    emit(event, payload, acknowledgement) {
      if (!socket?.connected) throw new Error('Socket.IO não está ligado.');
      socket.emit(event, payload, acknowledgement);
    },
    subscribeStatus(listener, { immediate = true } = {}) {
      if (typeof listener !== 'function') throw new TypeError('O listener de estado deve ser uma função.');
      statusListeners.add(listener);
      if (immediate) listener(state, state, { type: 'initial' });
      return () => statusListeners.delete(listener);
    },
    getState: () => state,
    getSocket: () => socket
  });

  if (options.autoConnect) connect().catch((error) => options.onError?.(error));
  return client;
}

export function getSharedSocketClient(actor, options = {}) {
  const key = actor || 'public';
  if (!sharedClients.has(key)) sharedClients.set(key, createSocketClient({ ...options, actor }));
  return sharedClients.get(key);
}

export function disconnectAllSockets() {
  sharedClients.forEach((client) => client.disconnect());
  sharedClients.clear();
}
