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
                auth: { persistSession: false, autoRefreshToken: false },
                realtime: { params: { eventsPerSecond: 20 } }
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

    async function readResponseJson(response) {
        if (typeof window.readJsonResponse === 'function') return window.readJsonResponse(response);
        const text = await response.text().catch(() => '');
        if (!text) return {};
        try { return JSON.parse(text); } catch (_error) { return {}; }
    }

    async function requestParticipantRealtimeToken(token, participant) {
        const response = await fetch(`${API_URL}/api/realtime/token`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`
            },
            body: JSON.stringify({ participant })
        });
        const data = await readResponseJson(response);
        if (!response.ok || !data.token || !data.topic) {
            throw new Error(data.message || 'Não foi possível autorizar o canal Realtime.');
        }
        return data;
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

    async function requestOrderRealtimeToken(orderId, accessToken) {
        const response = await fetch(`${API_URL}/api/public/orders/${encodeURIComponent(orderId)}/realtime-token`, {
            method: 'GET',
            headers: { 'x-order-access-token': accessToken }
        });
        const data = await readResponseJson(response);
        if (!response.ok || !data.token || !data.topic) {
            throw new Error(data.message || 'Não foi possível autorizar o acompanhamento em tempo real.');
        }
        return data;
    }

    function privateBroadcastChannel(client, topic, onEvent, onReady) {
        return client
            .channel(topic, { config: { private: true, broadcast: { self: false } } })
            .on('broadcast', { event: '*' }, function (message) {
                if (typeof onEvent === 'function') onEvent(message.event, message.payload || {});
            })
            .subscribe(function (status) {
                if (status === 'SUBSCRIBED' && typeof onReady === 'function') onReady();
            });
    }

    async function connectAdminRealtime({ token, onEvent, onReady } = {}) {
        if (!token) return null;
        const client = createClient();
        if (!client) return null;
        const authorization = await requestParticipantRealtimeToken(token, 'admin');
        if (authorization.topic !== ADMIN_CHANNEL) throw new Error('Canal administrativo inválido.');
        await client.realtime.setAuth(authorization.token);
        const channel = privateBroadcastChannel(client, authorization.topic, onEvent, onReady);
        return { client, channel, unsubscribe: function () { return client.removeChannel(channel); } };
    }

    async function connectDriverRealtime({ token, onEvent, onReady } = {}) {
        const client = createClient();
        if (!client || !token) return null;
        const decoded = parseJwt(token);
        const userId = decoded && decoded.user && decoded.user.id;
        if (!userId) throw new Error('Não foi possível determinar o motorista pelo token.');
        const authorization = await requestParticipantRealtimeToken(token, 'driver');
        if (authorization.topic !== `driver:${userId}`) throw new Error('Canal do motorista inválido.');
        await client.realtime.setAuth(authorization.token);
        const channel = privateBroadcastChannel(client, authorization.topic, onEvent, onReady);
        return { client, channel, userId, unsubscribe: function () { return client.removeChannel(channel); } };
    }

    async function connectOrderRealtime({ orderId, accessToken, onEvent, onReady } = {}) {
        const safeOrderId = String(orderId || '').trim();
        const safeAccessToken = String(accessToken || '').trim();
        if (!safeOrderId || !safeAccessToken) return null;
        const client = createClient();
        if (!client) return null;
        const tokenHash = await sha256Hex(safeAccessToken);
        const expectedTopic = `order:${safeOrderId}:${tokenHash}`;
        const authorization = await requestOrderRealtimeToken(safeOrderId, safeAccessToken);
        if (authorization.topic !== expectedTopic) throw new Error('Canal de acompanhamento inválido.');
        await client.realtime.setAuth(authorization.token);
        const channel = privateBroadcastChannel(client, authorization.topic, onEvent, onReady);
        return { client, channel, orderId: safeOrderId, unsubscribe: function () { return client.removeChannel(channel); } };
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
            const data = await readResponseJson(response);
            throw new Error(data.message || 'Falha na comunicação Realtime.');
        }
        return readResponseJson(response);
    }

    window.TragoRealtime = {
        connectAdminRealtime,
        connectDriverRealtime,
        connectOrderRealtime,
        sendDriverLocation: function (token, payload) { return postRealtimeEndpoint(token, 'driver-location', payload); },
        setDriverOnline: function (token, options) { return postRealtimeEndpoint(token, 'driver-online', {}, options); },
        setDriverOffline: function (token, options) { return postRealtimeEndpoint(token, 'driver-offline', {}, options); }
    };
})();
