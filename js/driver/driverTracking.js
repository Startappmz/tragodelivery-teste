/*
 * Trago Delivery · Tracking do motorista
 * Fluxo corrigido:
 * - A permissão de localização é pedida de forma clara e controlada.
 * - O motorista só fica online depois da primeira coordenada válida.
 * - Logout/descarregamento da página força estado offline no Supabase.
 * - Cada actualização de GPS alimenta o Realtime do admin e o mapa interno do motorista.
 */
let socket = null;
let locationWatchId = null;
let heartbeatTimer = null;
let locationPermissionDenied = false;
let locationRetryCount = 0;
let driverRealtimeSubscription = null;
let driverOnlineConfirmed = false;
let offlineInProgress = false;
let locationPromptDismissed = false;

const MAX_RETRIES = 3;
const HEARTBEAT_INTERVAL_MS = 30000;

const notificationSound = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
notificationSound.volume = 0.45;
let audioUnblocked = false;

function getDriverTokenSafe() {
    return typeof getAuthToken === 'function' ? getAuthToken('driver') : localStorage.getItem('driverToken');
}

function playNotificationSound() {
    const playPromise = notificationSound.play();
    if (playPromise !== undefined) {
        playPromise.then(() => {
            audioUnblocked = true;
        }).catch(() => {
            audioUnblocked = false;
        });
    }
}

function unlockAudio() {
    if (audioUnblocked) return;
    notificationSound.muted = true;
    notificationSound.play().then(() => {
        notificationSound.muted = false;
        audioUnblocked = true;
    }).catch(() => {
        notificationSound.muted = false;
    });
}

function emitDriverPosition(position) {
    document.dispatchEvent(new CustomEvent('driver_location_updated', {
        detail: position
    }));
}

function emitDriverLocationState(state, title, text, timestamp = null) {
    document.dispatchEvent(new CustomEvent('driver_location_state_changed', {
        detail: { state, title, text, timestamp }
    }));
}

function updateLocationNote(html, color = 'var(--danger)') {
    const note = document.getElementById('location-permission-note');
    if (!note) return;
    note.style.display = 'block';
    note.style.color = color;
    note.innerHTML = html;
}

function hideLocationModal({ dismissed = false } = {}) {
    const modal = document.getElementById('location-permission-modal');
    if (!modal) return;
    locationPromptDismissed = dismissed;
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
}

function showLocationPermissionModal({ force = false } = {}) {
    const modal = document.getElementById('location-permission-modal');
    if (!modal) {
        requestLocationPermission();
        return;
    }

    if (locationPromptDismissed && !force) return;

    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    const note = document.getElementById('location-permission-note');
    if (note) {
        note.style.display = 'block';
        note.style.color = 'var(--driver-muted, #69736b)';
        note.textContent = 'A TraGo usa o GPS durante o turno para atribuir pedidos, calcular a rota e manter a operação segura.';
    }
    emitDriverLocationState('waiting', 'GPS por activar', 'Toque em permitir para ficar disponível para entregas.');

    const closeBtn = document.getElementById('close-location-modal');
    if (closeBtn) {
        closeBtn.style.display = '';
        closeBtn.onclick = () => {
            hideLocationModal({ dismissed: true });
            markDriverOffline({ keepalive: false });
            emitDriverLocationState('warning', 'Motorista offline', 'Active o GPS quando quiser começar a receber entregas.');
        };
    }

    const allowBtn = document.getElementById('allow-location-btn');
    const denyBtn = document.getElementById('deny-location-btn');
    if (!allowBtn || !denyBtn) return;

    const newAllowBtn = allowBtn.cloneNode(true);
    const newDenyBtn = denyBtn.cloneNode(true);
    allowBtn.parentNode.replaceChild(newAllowBtn, allowBtn);
    denyBtn.parentNode.replaceChild(newDenyBtn, denyBtn);

    newAllowBtn.addEventListener('click', () => {
        locationPromptDismissed = false;
        requestLocationPermission();
    });

    newDenyBtn.addEventListener('click', () => {
        hideLocationModal({ dismissed: true });
        markDriverOffline({ keepalive: false });
        emitDriverLocationState('warning', 'Motorista offline', 'Sem GPS activo não receberá novas entregas.');
    });
}

async function ensureDriverOnline() {
    const token = getDriverTokenSafe();
    if (!token || !window.TragoRealtime?.setDriverOnline) return;
    try {
        await window.TragoRealtime.setDriverOnline(token);
        driverOnlineConfirmed = true;
    } catch (error) {
        console.warn('Não foi possível marcar motorista como online:', error);
    }
}

function startHeartbeat() {
    stopHeartbeat();
    heartbeatTimer = setInterval(() => {
        if (!driverOnlineConfirmed) return;
        const token = getDriverTokenSafe();
        if (!token) return;
        window.TragoRealtime?.setDriverOnline?.(token).catch((error) => {
            console.warn('Heartbeat online falhou:', error);
        });
    }, HEARTBEAT_INTERVAL_MS);
}

function stopHeartbeat() {
    if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
    }
}

function requestLocationPermission() {
    if (!navigator.geolocation) {
        updateLocationNote('<i class="fas fa-times-circle"></i> Este dispositivo/navegador não suporta geolocalização.');
        const modalOpen = !document.getElementById('location-permission-modal')?.classList.contains('hidden');
        if (!modalOpen && typeof showCustomAlert === 'function') {
            showCustomAlert('GPS indisponível', 'O dispositivo não suporta geolocalização. Não é possível iniciar turno.', 'error');
        }
        markDriverOffline({ keepalive: false });
        return;
    }

    if (navigator.permissions?.query) {
        navigator.permissions.query({ name: 'geolocation' }).then((permissionStatus) => {
            if (permissionStatus.state === 'granted') {
                startLocationTracking();
                return;
            }

            if (permissionStatus.state === 'denied') {
                locationPermissionDenied = true;
                markDriverOffline({ keepalive: false });
                updateLocationNote('<i class="fas fa-ban"></i> A localização está bloqueada. Abra as permissões do navegador para este site e active “Localização”.');
                emitDriverLocationState('error', 'GPS bloqueado', 'Abra as permissões da aplicação e active Localização.');
                return;
            }

            navigator.geolocation.getCurrentPosition(
                () => startLocationTracking(),
                (error) => handleLocationError(error, true),
                { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
            );

            permissionStatus.onchange = () => {
                if (permissionStatus.state === 'granted') {
                    locationPermissionDenied = false;
                    startLocationTracking();
                    hideLocationModal();
                }
            };
        }).catch(() => {
            navigator.geolocation.getCurrentPosition(
                () => startLocationTracking(),
                (error) => handleLocationError(error, true),
                { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
            );
        });
        return;
    }

    navigator.geolocation.getCurrentPosition(
        () => startLocationTracking(),
        (error) => handleLocationError(error, true),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
}

function handleLocationError(error, isRequired = false) {
    console.error('Erro ao obter localização:', error?.message || error);
    let errorMessage = 'Erro desconhecido ao obter localização.';

    if (error?.code === error.PERMISSION_DENIED) {
        locationPermissionDenied = true;
        errorMessage = 'Permissão de localização negada. Active a localização no navegador para iniciar o turno.';
        markDriverOffline({ keepalive: false });
        showLocationPermissionModal({ force: true });
        updateLocationNote('<i class="fas fa-exclamation-triangle"></i> Permissão negada. O motorista permanece offline até a localização ser permitida.');
    } else if (error?.code === error.POSITION_UNAVAILABLE) {
        errorMessage = 'GPS indisponível. Verifique se a localização do dispositivo está ligada.';
        locationRetryCount += 1;
    } else if (error?.code === error.TIMEOUT) {
        errorMessage = 'Tempo limite excedido ao obter localização. A tentar novamente...';
        locationRetryCount += 1;
    }

    if (isRequired && error?.code !== error.PERMISSION_DENIED && locationRetryCount < MAX_RETRIES) {
        setTimeout(() => requestLocationPermission(), 3000);
    }

    const statusState = error?.code === error.PERMISSION_DENIED ? 'error' : 'warning';
    emitDriverLocationState(statusState, statusState === 'error' ? 'GPS bloqueado' : 'GPS instável', errorMessage);

    const locationModalOpen = !document.getElementById('location-permission-modal')?.classList.contains('hidden');
    if (locationModalOpen && error?.code !== error.PERMISSION_DENIED) {
        updateLocationNote(`<i class="fas fa-location-crosshairs"></i> ${errorMessage}`, 'var(--driver-amber, #9a6711)');
    }
    if (!locationModalOpen && typeof showCustomAlert === 'function') {
        showCustomAlert('Localização', errorMessage, 'error', 6500);
    }
}

async function connectDriverSocket() {
    const token = getDriverTokenSafe();
    if (!token) {
        console.error('Token do motorista não encontrado. Realtime não iniciado.');
        return;
    }

    function handleDriverRealtimeEvent(event, data = {}) {
        if (event === 'order_message_created' || event === 'restaurant_order_status_changed' || event === 'order_status_changed') {
            document.dispatchEvent(new CustomEvent('trago_order_communication', { detail: data }));
            if (event === 'restaurant_order_status_changed' && data.restaurantStatus === 'ready' && typeof showCustomAlert === 'function') {
                showCustomAlert('Pedido pronto', `O restaurante marcou o pedido #${data.orderId ? data.orderId.slice(-6) : ''} como pronto para levantamento.`, 'success');
            }
            if (event === 'restaurant_order_status_changed' && data.restaurantStatus === 'rejected') {
                if (typeof showCustomAlert === 'function') showCustomAlert('Pedido recusado', 'O restaurante recusou o pedido. A entrega foi retirada da sua fila.', 'info');
                document.dispatchEvent(new Event('nova_entrega'));
            }
            return;
        }

        if (event === 'nova_entrega_atribuida') {
            playNotificationSound();
            if (typeof showCustomAlert === 'function') {
                showCustomAlert('Nova Entrega!', `Novo pedido de ${data.clientName || 'cliente'}.`, 'success');
            }
            document.dispatchEvent(new Event('nova_entrega'));
            return;
        }

        if (event === 'nova_oferta_entrega') {
            playNotificationSound();
            if (typeof showCustomAlert === 'function') {
                showCustomAlert(
                    'Novo pedido para decidir',
                    `${data.clientName || 'Cliente'} solicitou uma entrega. Consulte o resumo e escolha aceitar ou recusar.`,
                    'info'
                );
            }
            document.dispatchEvent(new Event('nova_entrega'));
            return;
        }

        if (event === 'payment_confirmation_pending') {
            if (typeof checkDriverPaymentPendingAlerts === 'function') {
                checkDriverPaymentPendingAlerts(true);
            }
            return;
        }

        if (event === 'entrega_cancelada') {
            if (typeof showCustomAlert === 'function') {
                showCustomAlert('Entrega Reatribuída', `O pedido #${data.orderId ? data.orderId.slice(-6) : ''} foi reatribuído/cancelado.`, 'info');
            }
            document.dispatchEvent(new Event('nova_entrega'));
            return;
        }
    }

    try {
        driverRealtimeSubscription = await window.TragoRealtime?.connectDriverRealtime({
            token,
            onEvent: handleDriverRealtimeEvent,
            onReady: () => {
                showLocationPermissionModal();
                document.body.addEventListener('click', unlockAudio, { once: true });
                document.body.addEventListener('touchstart', unlockAudio, { once: true });
            }
        });
    } catch (error) {
        console.warn('Realtime do motorista indisponível:', error);
        driverRealtimeSubscription = null;
    }

    socket = {
        connected: Boolean(driverRealtimeSubscription),
        emit(event, payload) {
            if (event !== 'driver_location_update') return undefined;
            return window.TragoRealtime?.sendDriverLocation(token, payload).catch((error) => {
                console.warn('Falha ao enviar localização:', error);
            });
        },
        disconnect() {
            driverRealtimeSubscription?.unsubscribe?.();
            driverRealtimeSubscription = null;
            socket.connected = false;
        }
    };
}

function startLocationTracking() {
    stopLocationTracking();

    if (!navigator.geolocation) {
        handleLocationError({ code: 0, message: 'Geolocalização não suportada.' }, true);
        return;
    }

    hideLocationModal();
    locationPermissionDenied = false;
    locationRetryCount = 0;
    emitDriverLocationState('warning', 'GPS a localizar', 'A obter a primeira posição do motorista.');

    locationWatchId = navigator.geolocation.watchPosition(
        async (position) => {
            const { latitude, longitude, accuracy, speed } = position.coords;
            const payload = {
                lat: latitude,
                lng: longitude,
                accuracy,
                speed,
                timestamp: new Date().toISOString()
            };

            emitDriverPosition(payload);

            if (!driverOnlineConfirmed) {
                await ensureDriverOnline();
                startHeartbeat();
            }

            if (socket?.connected) {
                socket.emit('driver_location_update', payload);
            }

            locationRetryCount = 0;
        },
        (error) => handleLocationError(error, true),
        {
            enableHighAccuracy: true,
            timeout: 25000,
            maximumAge: 8000
        }
    );
}

function stopLocationTracking() {
    if (locationWatchId !== null) {
        navigator.geolocation.clearWatch(locationWatchId);
        locationWatchId = null;
    }
}

async function markDriverOffline(options = {}) {
    const token = getDriverTokenSafe();
    if (!token || offlineInProgress) return;

    offlineInProgress = true;
    driverOnlineConfirmed = false;
    stopHeartbeat();
    emitDriverLocationState('warning', 'Motorista offline', 'GPS parado ou sessão encerrada.');

    try {
        await window.TragoRealtime?.setDriverOffline?.(token, { keepalive: Boolean(options.keepalive) });
    } catch (error) {
        console.warn('Falha ao marcar motorista offline:', error);
    } finally {
        offlineInProgress = false;
    }
}

async function shutdownDriverTracking(options = {}) {
    stopLocationTracking();
    stopHeartbeat();
    await markDriverOffline(options);
    if (driverRealtimeSubscription?.unsubscribe) {
        try { driverRealtimeSubscription.unsubscribe(); } catch (_) {}
    }
    driverRealtimeSubscription = null;
    if (socket) socket.connected = false;
}

function restartLocationTracking() {
    locationPermissionDenied = false;
    locationRetryCount = 0;
    locationPromptDismissed = false;
    showLocationPermissionModal({ force: true });
}

window.addEventListener('pagehide', () => {
    shutdownDriverTracking({ keepalive: true });
});

window.addEventListener('beforeunload', () => {
    shutdownDriverTracking({ keepalive: true });
});

window.restartLocationTracking = restartLocationTracking;
window.startLocationTracking = startLocationTracking;
window.stopLocationTracking = stopLocationTracking;
window.showLocationPermissionModal = showLocationPermissionModal;
window.requestLocationPermission = requestLocationPermission;
window.TragoDriverTracking = {
    shutdown: shutdownDriverTracking,
    markOffline: markDriverOffline,
    restart: restartLocationTracking,
    isOnline: () => driverOnlineConfirmed,
    isTracking: () => locationWatchId !== null
};
