/*
 * Ficheiro: js/common/supabaseRealtime.js
 * Substitui Socket.IO por Supabase Realtime Broadcast.
 *
 * Requer:
 * - @supabase/supabase-js via CDN
 * - window.TRAGO_SUPABASE_URL
 * - window.TRAGO_SUPABASE_ANON_KEY
 */
(function () {
    const ADMIN_CHANNEL = 'admin_room';

    function hasConfig() {
        return Boolean(window.supabase && window.TRAGO_SUPABASE_URL && window.TRAGO_SUPABASE_ANON_KEY);
    }

    function createClient() {
        if (!hasConfig()) {
            console.warn('[TragoRealtime] Supabase Realtime não configurado. Defina TRAGO_SUPABASE_URL e TRAGO_SUPABASE_ANON_KEY.');
            return null;
        }

        return window.supabase.createClient(
            window.TRAGO_SUPABASE_URL,
            window.TRAGO_SUPABASE_ANON_KEY,
            {
                auth: {
                    persistSession: false,
                    autoRefreshToken: false
                },
                realtime: {
                    params: {
                        eventsPerSecond: 20
                    }
                }
            }
        );
    }

    function parseJwt(token) {
        try {
            const payload = token.split('.')[1];
            const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
            return JSON.parse(decodeURIComponent(atob(normalized).split('').map(function (c) {
                return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
            }).join('')));
        } catch (error) {
            console.warn('[TragoRealtime] Não foi possível ler o JWT localmente:', error);
            return null;
        }
    }

    function connectAdminRealtime({ onEvent } = {}) {
        const client = createClient();
        if (!client) return null;

        const channel = client
            .channel(ADMIN_CHANNEL, { config: { broadcast: { self: false } } })
            .on('broadcast', { event: '*' }, function (message) {
                if (typeof onEvent === 'function') {
                    onEvent(message.event, message.payload || {});
                }
            })
            .subscribe(function (status) {
            });

        return {
            client,
            channel,
            unsubscribe: function () {
                return client.removeChannel(channel);
            }
        };
    }

    function connectDriverRealtime({ token, onEvent, onReady } = {}) {
        const client = createClient();
        if (!client) return null;

        const decoded = parseJwt(token || '');
        const userId = decoded && decoded.user && decoded.user.id;

        if (!userId) {
            console.warn('[TragoRealtime] Não foi possível determinar o ID do motorista pelo token.');
            return null;
        }

        const channel = client
            .channel(`driver:${userId}`, {
                config: {
                    broadcast: { self: false },
                    presence: { key: userId }
                }
            })
            .on('broadcast', { event: '*' }, function (message) {
                if (typeof onEvent === 'function') {
                    onEvent(message.event, message.payload || {});
                }
            })
            .subscribe(function (status) {
                if (status === 'SUBSCRIBED') {
                    channel.track({ user_id: userId, online_at: new Date().toISOString() });
                    if (typeof onReady === 'function') onReady();
                }
            });

        return {
            client,
            channel,
            userId,
            unsubscribe: function () {
                return client.removeChannel(channel);
            }
        };
    }

    async function sha256Hex(value) {
        if (!window.crypto?.subtle || typeof TextEncoder !== 'function') {
            throw new Error('Este navegador não suporta o canal seguro de acompanhamento.');
        }
        const input = new TextEncoder().encode(String(value || ''));
        const digest = await window.crypto.subtle.digest('SHA-256', input);
        return Array.from(new Uint8Array(digest))
            .map(function (byte) { return byte.toString(16).padStart(2, '0'); })
            .join('');
    }

    async function connectOrderRealtime({ orderId, accessToken, onEvent, onReady } = {}) {
        const safeOrderId = String(orderId || '').trim();
        const safeAccessToken = String(accessToken || '').trim();
        if (!safeOrderId || !safeAccessToken) return null;

        const client = createClient();
        if (!client) return null;

        const tokenHash = await sha256Hex(safeAccessToken);
        const channelName = `order:${safeOrderId}:${tokenHash}`;
        const channel = client
            .channel(channelName, { config: { broadcast: { self: false } } })
            .on('broadcast', { event: '*' }, function (message) {
                if (typeof onEvent === 'function') {
                    onEvent(message.event, message.payload || {});
                }
            })
            .subscribe(function (status) {
                if (status === 'SUBSCRIBED' && typeof onReady === 'function') onReady();
            });

        return {
            client,
            channel,
            orderId: safeOrderId,
            unsubscribe: function () {
                return client.removeChannel(channel);
            }
        };
    }

    async function postRealtimeEndpoint(token, endpoint, payload, options = {}) {
        const response = await fetch(`${API_URL}/api/realtime/${endpoint}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(payload || {}),
            keepalive: Boolean(options.keepalive)
        });

        if (!response.ok) {
            const data = await readJsonResponse(response);
            throw new Error(data.message || 'Falha na comunicação Realtime.');
        }

        return readJsonResponse(response);
    }

    window.TragoRealtime = {
        connectAdminRealtime,
        connectDriverRealtime,
        connectOrderRealtime,
        sendDriverLocation: function (token, payload) {
            return postRealtimeEndpoint(token, 'driver-location', payload);
        },
        setDriverOnline: function (token, options) {
            return postRealtimeEndpoint(token, 'driver-online', {}, options);
        },
        setDriverOffline: function (token, options) {
            return postRealtimeEndpoint(token, 'driver-offline', {}, options);
        }
    };
})();
