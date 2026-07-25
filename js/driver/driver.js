/*
 * Ficheiro: js/driver/driver.js
 * (CORREÇÃO 7: Link do Google Maps - http://googleusercontent.com/maps)
 */

/* --- PONTO DE ENTRADA (Entry Point) --- */
let driverNavigation = null;
let driverActiveOrderId = '';
let driverOrderChatTimer = null;
let driverActiveChatChannel = 'client_driver';

document.addEventListener('DOMContentLoaded', () => {
    checkAuth('driver');
    initDriverModalGuard();
    connectDriverSocket();
    attachDriverEventListeners();
    loadDriverProfileVisibility();
    setInterval(() => checkDriverPaymentPendingAlerts(false), 120000);
    initDriverNavigation();
});

function initDriverModalGuard() {
    const modals = [...document.querySelectorAll('.driver-modal')];
    if (!modals.length) return;

    const sync = () => {
        let hasOpenModal = false;
        modals.forEach((modal) => {
            const isOpen = !modal.classList.contains('hidden');
            modal.setAttribute('aria-hidden', String(!isOpen));
            modal.setAttribute('role', 'dialog');
            modal.setAttribute('aria-modal', 'true');
            hasOpenModal ||= isOpen;
        });
        document.body.classList.toggle('driver-modal-open', hasOpenModal);
    };

    const observer = new MutationObserver(sync);
    modals.forEach((modal) => observer.observe(modal, { attributes: true, attributeFilter: ['class'] }));
    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        const openModals = modals.filter((modal) => !modal.classList.contains('hidden'));
        const topModal = openModals[openModals.length - 1];
        topModal?.querySelector('.modal-close')?.click();
    });
    sync();
}

/**
 * Anexa todos os event listeners do painel do motorista.
 */
function attachDriverEventListeners() {
    document.getElementById('driver-order-chat-form')?.addEventListener('submit', sendDriverOrderMessage);
    document.querySelectorAll('[data-driver-chat-channel]').forEach((button) => {
        button.addEventListener('click', () => {
            const channel = button.dataset.driverChatChannel;
            if (!['client_driver', 'driver_partner'].includes(channel)) return;
            driverActiveChatChannel = channel;
            document.querySelectorAll('[data-driver-chat-channel]').forEach((item) => {
                const active = item === button;
                item.classList.toggle('active', active);
                item.setAttribute('aria-pressed', String(active));
            });
            const textarea = document.querySelector('#driver-order-chat-form textarea');
            if (textarea) textarea.placeholder = channel === 'driver_partner'
                ? 'Escrever ao Estabelecimento'
                : 'Escrever ao Cliente';
            if (driverActiveOrderId) loadDriverOrderMessages(driverActiveOrderId);
        });
    });
    document.addEventListener('trago_order_communication', (event) => {
        if (!driverActiveOrderId || (event.detail?.orderId && String(event.detail.orderId) !== String(driverActiveOrderId))) return;
        loadDriverOrderMessages(driverActiveOrderId, true);
        if (event.detail?.pickupAuthorized || event.detail?.restaurantStatus === 'ready') updateDriverRestaurantReady('ready');
    });
    // Botão de Logout (Desktop)
    document.getElementById('driver-logout')?.addEventListener('click', (e) => {
        e.preventDefault();
        handleLogout('driver');
    });
    
    // Botão de Configurações (Desktop)
    document.getElementById('driver-settings')?.addEventListener('click', () => {
        showDriverPage('configuracoes-motorista', { root: true, source: 'root' });
    });
    
    // Botão de Ganhos (Desktop)
    document.getElementById('driver-earnings')?.addEventListener('click', () => {
        showDriverPage('meus-ganhos', { root: true, source: 'root' });
    });
    
    // Botões "Voltar"
    document.getElementById('btn-voltar-lista')?.addEventListener('click', () => {
        showDriverPage('lista-entregas');
    });
    document.getElementById('btn-voltar-lista-config')?.addEventListener('click', () => {
        showDriverPage('lista-entregas');
    });
    document.getElementById('btn-voltar-lista-ganhos')?.addEventListener('click', () => {
        showDriverPage('lista-entregas');
    });

    // Botões do Modal de Alerta
    document.getElementById('btn-close-alert')?.addEventListener('click', closeCustomAlert);
    document.getElementById('btn-ok-alert')?.addEventListener('click', closeCustomAlert);
    
    // Listener de Notificação (socket -> driver.js recarrega lista)
    document.addEventListener('nova_entrega', () => {
        const listaSection = document.getElementById('lista-entregas');
        if (listaSection && !listaSection.classList.contains('hidden')) {
            loadMyDeliveries();
        }
    });

    // Modal de confirmação de pagamento
    document.getElementById('btn-close-payment-confirmation')?.addEventListener('click', closePaymentConfirmationModal);
    document.getElementById('btn-cancel-payment-confirmation')?.addEventListener('click', closePaymentConfirmationModal);
    document.getElementById('btn-confirm-payment-finalize')?.addEventListener('click', submitPaymentConfirmation);
    const paymentAmountInput = document.getElementById('payment-confirmed-amount');
    if (paymentAmountInput) {
        paymentAmountInput.addEventListener('input', () => {
            paymentAmountInput.dataset.userTyped = 'true';
        });
        paymentAmountInput.addEventListener('paste', (event) => {
            event.preventDefault();
            paymentAmountInput.dataset.userTyped = 'false';
            showCustomAlert('Atenção', 'O valor recebido deve ser digitado manualmente pelo motorista.', 'warning');
        });
    }

    const earningsPeriodSelect = document.getElementById('driver-earnings-period-select');
    const completedPeriodSelect = document.getElementById('driver-completed-period-select');
    const syncDriverPeriodAndLoad = (period) => {
        const safePeriod = ['day', 'week', 'month'].includes(period) ? period : 'month';
        if (earningsPeriodSelect) earningsPeriodSelect.value = safePeriod;
        if (completedPeriodSelect) completedPeriodSelect.value = safePeriod;
        loadMyEarnings(safePeriod);
    };
    if (earningsPeriodSelect) {
        earningsPeriodSelect.addEventListener('change', () => syncDriverPeriodAndLoad(earningsPeriodSelect.value));
    }
    if (completedPeriodSelect) {
        completedPeriodSelect.addEventListener('change', () => syncDriverPeriodAndLoad(completedPeriodSelect.value));
    }

    // Listener do formulário de senha
    document.getElementById('form-change-password-driver')?.addEventListener('submit', handleChangePasswordDriver);

    // App shell mobile: navegação inferior, refresh e estado de GPS
    document.getElementById('driver-brand-home')?.addEventListener('click', () => showDriverPage('lista-entregas', { root: true, source: 'root' }));
    document.querySelectorAll('[data-driver-nav]').forEach((button) => {
        button.addEventListener('click', (event) => {
            event.preventDefault();
            const target = button.dataset.driverNav;
            if (target) showDriverPage(target, button.hasAttribute('data-nav-root') ? { root: true, source: 'root' } : {});
        });
    });
    document.querySelectorAll('[data-driver-action="logout"]').forEach((button) => {
        button.addEventListener('click', () => handleLogout('driver'));
    });

    const refreshDeliveries = () => {
        document.querySelectorAll('#driver-refresh-deliveries, #driver-refresh-deliveries-inline').forEach((button) => {
            button.classList.add('is-loading');
            setTimeout(() => button.classList.remove('is-loading'), 900);
        });
        loadMyDeliveries();
    };
    document.getElementById('driver-refresh-deliveries')?.addEventListener('click', refreshDeliveries);
    document.getElementById('driver-refresh-deliveries-inline')?.addEventListener('click', refreshDeliveries);

    document.querySelectorAll('[data-driver-period]').forEach((button) => {
        button.addEventListener('click', () => {
            const period = button.dataset.driverPeriod || 'month';
            const earningsPeriodSelect = document.getElementById('driver-earnings-period-select');
            const completedPeriodSelect = document.getElementById('driver-completed-period-select');
            if (earningsPeriodSelect) earningsPeriodSelect.value = period;
            if (completedPeriodSelect) completedPeriodSelect.value = period;
            updateDriverPeriodChips(period);
            loadMyEarnings(period);
        });
    });

    document.getElementById('driver-refresh-earnings')?.addEventListener('click', () => {
        const button = document.getElementById('driver-refresh-earnings');
        const period = document.getElementById('driver-earnings-period-select')?.value || 'month';
        button?.classList.add('is-loading');
        Promise.resolve(loadMyEarnings(period)).finally(() => button?.classList.remove('is-loading'));
    });
    document.getElementById('driver-export-earnings')?.addEventListener('click', exportDriverEarnings);

    document.addEventListener('driver_location_updated', (event) => {
        updateDriverLocationStatus('active', 'GPS activo', 'Localização em tempo real.', event.detail?.timestamp);
    });
    document.addEventListener('driver_location_state_changed', (event) => {
        const detail = event.detail || {};
        updateDriverLocationStatus(detail.state, detail.title, detail.text, detail.timestamp);
    });
}


/* --- Lógica de Navegação do Motorista --- */

function showDriverPage(pageId, options = {}) {
    if (driverNavigation) return driverNavigation.navigate(pageId, options);
    renderDriverPage(pageId);
    return pageId;
}

function renderDriverPage(pageId) {
    const safePageId = pageId || 'lista-entregas';

    // Esconde todas as secções
    document.getElementById('lista-entregas')?.classList.add('hidden');
    document.getElementById('detalhe-entrega')?.classList.add('hidden');
    document.getElementById('configuracoes-motorista')?.classList.add('hidden');
    document.getElementById('meus-ganhos')?.classList.add('hidden');
    document.getElementById('suporte-motorista')?.classList.add('hidden');

    // Mostra a secção pedida
    const pageToShow = document.getElementById(safePageId);
    if (pageToShow) {
        pageToShow.classList.remove('hidden');
    }

    updateDriverActiveNav(safePageId);
    document.body.dataset.driverPage = safePageId;

    // Carrega os dados necessários para a página
    if (safePageId === 'lista-entregas') {
        loadMyDeliveries();
    }
    if (safePageId === 'configuracoes-motorista') {
        document.getElementById('form-change-password-driver')?.reset();
        window.TragoDriverProfile?.refresh?.();
    }
    if (safePageId === 'meus-ganhos') {
        const period = document.getElementById('driver-completed-period-select')?.value
            || document.getElementById('driver-earnings-period-select')?.value
            || 'month';
        loadMyEarnings(period);
    }
    if (safePageId === 'suporte-motorista') {
        window.TragoSupport?.openHub?.('driver');
    }
    if (safePageId === 'detalhe-entrega') {
        requestAnimationFrame(() => window.TragoDriverMap?.invalidate?.());
        setTimeout(() => window.TragoDriverMap?.invalidate?.(), 180);
        setTimeout(() => window.TragoDriverMap?.invalidate?.(), 520);
    }

    if (window.matchMedia('(max-width: 900px)').matches) {
        window.scrollTo({ top: 0, behavior: 'auto' });
    }
}

function initDriverNavigation() {
    document.querySelectorAll('.btn-voltar').forEach((button) => {
        button.setAttribute('data-smart-back', '');
        if (!button.hasAttribute('aria-label')) button.setAttribute('aria-label', 'Voltar');
    });
    if (!window.TragoNavigation) {
        renderDriverPage('lista-entregas');
        return;
    }
    driverNavigation = window.TragoNavigation.create({
        role: 'driver',
        scope: localStorage.getItem('driverId') || localStorage.getItem('driverName') || 'anonymous',
        pages: ['lista-entregas', 'detalhe-entrega', 'configuracoes-motorista', 'meus-ganhos', 'suporte-motorista'],
        defaultPage: 'lista-entregas',
        transientPages: ['detalhe-entrega'],
        getCurrent: () => document.body.dataset.driverPage || 'lista-entregas',
        render: renderDriverPage
    });
    driverNavigation.restore();
}

function updateDriverActiveNav(pageId) {
    const navPage = pageId === 'detalhe-entrega' ? 'lista-entregas' : pageId;
    document.querySelectorAll('[data-driver-nav]').forEach((button) => {
        const active = button.dataset.driverNav === navPage;
        button.classList.toggle('active', active);
        if (active) button.setAttribute('aria-current', 'page');
        else button.removeAttribute('aria-current');
    });
}

function updateDriverPeriodChips(period = 'month') {
    const safePeriod = ['day', 'week', 'month'].includes(period) ? period : 'month';
    document.querySelectorAll('[data-driver-period]').forEach((button) => {
        button.classList.toggle('active', button.dataset.driverPeriod === safePeriod);
    });
}

function updateDriverLocationStatus(state = 'waiting', title = 'GPS a iniciar', text = 'A aguardar localização.', timestamp = null) {
    const header = document.getElementById('driver-header-status');
    const headerText = document.getElementById('driver-header-status-text');
    const card = document.getElementById('driver-status-card');
    const titleEl = document.getElementById('driver-gps-status-title');
    const textEl = document.getElementById('driver-gps-status-text');
    const timeEl = document.getElementById('driver-last-location-time');
    const settingsCopy = document.getElementById('settings-location-copy');

    [header, card].forEach((el) => {
        if (!el) return;
        el.classList.remove('status-active', 'status-warning', 'status-error', 'status-waiting');
        el.classList.add(`status-${state}`);
    });

    if (headerText) headerText.textContent = title;
    if (titleEl) titleEl.textContent = title;
    if (textEl) textEl.textContent = text;
    if (settingsCopy) settingsCopy.textContent = state === 'active' ? 'GPS activo.' : 'Obrigatória para entregas.';

    if (timeEl) {
        if (timestamp) {
            const date = new Date(timestamp);
            const time = Number.isNaN(date.getTime()) ? 'agora' : date.toLocaleTimeString('pt-MZ', { hour: '2-digit', minute: '2-digit' });
            timeEl.textContent = `Actualizado: ${time}`;
        } else {
            timeEl.textContent = 'Actualizado: —';
        }
    }
}

window.updateDriverLocationStatus = updateDriverLocationStatus;

/* --- Lógica de API (GET) --- */

function renderDriverOffers(offers = []) {
    const card = document.getElementById('driver-offers-card');
    const container = document.getElementById('driver-offers-container');
    const count = document.getElementById('driver-offers-count');
    if (!card || !container) return;
    card.hidden = offers.length === 0;
    if (count) count.textContent = String(offers.length);
    container.innerHTML = offers.map((order) => {
        const orderId = String(order._id || order.id || '');
        const pickup = compactPlaceName(order.pickup_address_text || order.pickup_address || '', 'Recolha');
        const delivery = compactPlaceName(order.address_text || order.delivery_address || '', 'Entrega');
        const service = SERVICE_NAMES[order.service_type] || order.service_type || 'Serviço';
        const expiresAt = new Date(order.driver_offer_expires_at || 0).getTime();
        const seconds = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
        return `
            <article class="driver-offer-card" data-driver-offer="${escapeHtml(orderId)}">
                <header><span><i class="fa-solid fa-bolt"></i> Pedido próximo</span><b data-offer-countdown="${expiresAt}">${seconds}s</b></header>
                <div class="driver-offer-value"><strong>${formatDriverMZN(Number(order.price || 0))}</strong><small>${escapeHtml(service)} · ${escapeHtml(getDriverPaymentLabel(order.payment_method))}</small></div>
                <div class="driver-offer-route">
                    <span><i class="fa-solid fa-box-open"></i><b>Recolha</b><small>${escapeHtml(pickup)}</small></span>
                    <i class="fa-solid fa-arrow-down"></i>
                    <span><i class="fa-solid fa-location-dot"></i><b>Entrega</b><small>${escapeHtml(delivery)}</small></span>
                </div>
                <footer>
                    <button type="button" class="driver-offer-reject" data-offer-response="false" data-order-id="${escapeHtml(orderId)}"><i class="fa-solid fa-xmark"></i> Recusar</button>
                    <button type="button" class="driver-offer-accept" data-offer-response="true" data-order-id="${escapeHtml(orderId)}"><i class="fa-solid fa-check"></i> Aceitar pedido</button>
                </footer>
            </article>`;
    }).join('');

    clearInterval(renderDriverOffers._timer);
    if (offers.length) {
        renderDriverOffers._timer = setInterval(() => {
            let expired = false;
            container.querySelectorAll('[data-offer-countdown]').forEach((node) => {
                const seconds = Math.max(0, Math.ceil((Number(node.dataset.offerCountdown || 0) - Date.now()) / 1000));
                node.textContent = `${seconds}s`;
                if (seconds <= 0) expired = true;
            });
            if (expired) loadMyDeliveries();
        }, 1000);
    }
}

async function respondDriverOffer(orderId, accept, button) {
    if (!orderId || !button) return;
    const card = button.closest('.driver-offer-card');
    card?.querySelectorAll('button').forEach((item) => { item.disabled = true; });
    const original = button.innerHTML;
    button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> A enviar...';
    try {
        const response = await fetch(`${API_URL}/api/orders/${encodeURIComponent(orderId)}/offer-response`, {
            method: 'POST',
            headers: { ...getAuthHeaders('driver'), 'Content-Type': 'application/json' },
            body: JSON.stringify({ accept })
        });
        const data = await readJsonResponse(response);
        if (!response.ok) throw new Error(data.message || 'Não foi possível responder ao pedido.');
        showCustomAlert(
            accept ? 'Pedido aceite' : 'Pedido recusado',
            accept ? 'A entrega foi adicionada à sua fila operacional.' : 'O cliente poderá escolher outro motorista.',
            accept ? 'success' : 'info'
        );
        await loadMyDeliveries();
    } catch (error) {
        showCustomAlert('Pedido', error.message, 'error');
        card?.querySelectorAll('button').forEach((item) => { item.disabled = false; });
        button.innerHTML = original;
    }
}

async function loadMyDeliveries() {
    const entregasContainer = document.getElementById('entregas-container');
    if (!entregasContainer) return;

    entregasContainer.innerHTML = '<div class="loading-state driver-loading-card"><i class="fas fa-spinner fa-spin"></i><strong>A carregar...</strong><span>A verificar pedidos.</span></div>';
    try {
        const response = await fetch(`${API_URL}/api/orders/my-deliveries`, {
            method: 'GET',
            headers: getAuthHeaders('driver')
        });
        const data = await readJsonResponse(response);
        if (!response.ok) throw new Error(data.message);

        const orders = Array.isArray(data.orders) ? data.orders : [];
        const offers = Array.isArray(data.offers) ? data.offers : [];
        renderDriverOffers(offers);
        entregasContainer.innerHTML = '';

        const subtitle = document.getElementById('driver-home-subtitle');
        if (subtitle) {
            subtitle.textContent = offers.length
                ? `${offers.length} novo${offers.length > 1 ? 's' : ''} pedido${offers.length > 1 ? 's' : ''} aguarda${offers.length > 1 ? 'm' : ''} a sua decisão.`
                : orders.length
                  ? `${orders.length} entrega${orders.length > 1 ? 's' : ''}.`
                  : 'Livre para entregas.';
        }

        if (orders.length === 0) {
            entregasContainer.innerHTML = `
                <div class="empty-state driver-empty-state">
                    <span class="driver-empty-icon"><i class="fas fa-motorcycle"></i></span>
                    <strong>Sem entregas</strong>
                    <p>A nova entrega aparece aqui.</p>
                    <button type="button" class="driver-empty-refresh" onclick="loadMyDeliveries()">
                        <i class="fas fa-sync-alt"></i> Actualizar
                    </button>
                </div>
            `;
            return;
        }

        orders.forEach(order => {
            const card = document.createElement('article');
            card.className = 'entrega-card driver-delivery-card';
            card.dataset.order = JSON.stringify(order);

            const orderId = String(order._id || order.id || '');
            const pickup = compactPlaceName(order.pickup_address_text || order.pickup_address || '', 'Recolha');
            const delivery = compactPlaceName(order.address_text || order.delivery_address || '', 'Entrega');
            const service = SERVICE_NAMES[order.service_type] || order.service_type || 'Serviço';
            const paymentLabel = getDriverPaymentLabel(order.payment_method);
            const statusLabel = getDriverStatusLabel(order.status);
            const price = Number(order.price || order.total_price || 0);
            const priceHtml = Number.isFinite(price) && price > 0 ? `<strong>${formatDriverMZN(price)}</strong>` : '<strong>—</strong>';
            const ctaLabel = ['atribuido', 'pendente'].includes(order.status) ? 'Detalhes' : 'Continuar';

            card.innerHTML = `
                <div class="driver-delivery-top">
                    <span class="driver-delivery-id">#${escapeHtml(orderId.slice(-6) || 'pedido')}</span>
                    <span class="driver-delivery-status status-${escapeHtml(order.status || 'pendente')}">${escapeHtml(statusLabel)}</span>
                </div>
                <div class="driver-delivery-route">
                    <span><i class="fas fa-box-open"></i> ${escapeHtml(pickup)}</span>
                    <i class="fas fa-arrow-down route-arrow"></i>
                    <span><i class="fas fa-flag-checkered"></i> ${escapeHtml(delivery)}</span>
                </div>
                <div class="driver-delivery-meta">
                    <span><i class="fas fa-user"></i> ${escapeHtml(order.client_name || 'Cliente')}</span>
                    <span><i class="fas fa-briefcase"></i> ${escapeHtml(service)}</span>
                    <span><i class="fas fa-credit-card"></i> ${escapeHtml(paymentLabel)}</span>
                </div>
                <div class="driver-delivery-footer">
                    <div class="driver-delivery-price">
                        <small>Valor</small>
                        ${priceHtml}
                    </div>
                    <span class="ver-detalhes-btn">${ctaLabel} <i class="fas fa-chevron-right"></i></span>
                </div>
            `;
            card.addEventListener('click', () => {
                showDriverPage('detalhe-entrega');
                fillDetalheEntrega(order);
            });
            entregasContainer.appendChild(card);
        });
    } catch (error) {
        console.error('Falha ao carregar entregas:', error);
        entregasContainer.innerHTML = `
            <div class="error-state driver-error-state">
                <i class="fas fa-wifi"></i>
                <strong>Erro ao carregar</strong>
                <p>Verifique a internet e tente novamente.</p>
                <button type="button" class="driver-empty-refresh" onclick="loadMyDeliveries()">Tentar</button>
            </div>
        `;
    }
}

document.addEventListener('click', (event) => {
    const responseButton = event.target.closest('[data-offer-response]');
    if (!responseButton) return;
    event.preventDefault();
    event.stopPropagation();
    respondDriverOffer(
        responseButton.dataset.orderId,
        responseButton.dataset.offerResponse === 'true',
        responseButton
    );
});


async function loadMyEarnings(period = 'month') {
    const safePeriod = ['day', 'week', 'month'].includes(period) ? period : 'month';

    const totalGanhosEl = document.getElementById('driver-total-ganhos');
    const totalOrdersEl = document.getElementById('driver-total-entregas');
    const commissionEl = document.getElementById('driver-commission-rate');
    const tableBody = document.getElementById('driver-earnings-table-body');
    const titleEl = document.getElementById('driver-earnings-title');
    const tableTitleEl = document.getElementById('driver-earnings-table-title');
    const captionEl = document.getElementById('driver-earnings-summary-caption');
    const periodLabelEl = document.getElementById('driver-period-label');
    const averageEl = document.getElementById('driver-average-earning');
    const nextCloseEl = document.getElementById('driver-next-close');
    const payoutDateEl = document.getElementById('driver-payout-date');

    if (!totalGanhosEl || !totalOrdersEl || !commissionEl || !tableBody) return;

    const topPeriodSelect = document.getElementById('driver-earnings-period-select');
    const tablePeriodSelect = document.getElementById('driver-completed-period-select');
    if (topPeriodSelect) topPeriodSelect.value = safePeriod;
    if (tablePeriodSelect) tablePeriodSelect.value = safePeriod;
    updateDriverPeriodChips(safePeriod);

    totalGanhosEl.innerText = '...';
    totalOrdersEl.innerText = '...';
    commissionEl.innerText = '... %';
    if (averageEl) averageEl.innerText = '...';
    tableBody.innerHTML = '<tr><td colspan="4"><span class="driver-table-loading"><i class="fas fa-spinner fa-spin"></i> A actualizar movimentos…</span></td></tr>';

    try {
        const response = await fetch(`${API_URL}/api/drivers/my-earnings?period=${encodeURIComponent(safePeriod)}`, {
            method: 'GET',
            headers: getAuthHeaders('driver')
        });

        if (response.status === 401) {
            return handleLogout('driver');
        }

        const data = await readJsonResponse(response);
        if (!response.ok) throw new Error(data.message);
        const periodLabel = data.period?.label || (safePeriod === 'day' ? 'Hoje' : safePeriod === 'week' ? 'Esta semana' : 'Este mês');
        if (titleEl) titleEl.textContent = 'Ganhos';
        if (periodLabelEl) periodLabelEl.textContent = periodLabel;
        if (tableTitleEl) tableTitleEl.textContent = 'Histórico de entregas';
        if (captionEl) captionEl.textContent = `Resumo de ${periodLabel.toLowerCase()}.`;

        const endDate = new Date();
        if (safePeriod === 'week') {
            const daysUntilSunday = (7 - endDate.getDay()) % 7;
            endDate.setDate(endDate.getDate() + daysUntilSunday);
        } else if (safePeriod === 'month') {
            endDate.setMonth(endDate.getMonth() + 1, 0);
        }
        const endDateLabel = endDate && !Number.isNaN(endDate.getTime())
            ? endDate.toLocaleDateString('pt-MZ', { day: '2-digit', month: 'short' }).replace('.', '')
            : 'Fim do período';
        if (nextCloseEl) nextCloseEl.textContent = safePeriod === 'day' ? 'Hoje' : endDateLabel;
        if (payoutDateEl) payoutDateEl.textContent = safePeriod === 'day' ? 'Após o fecho de hoje' : `Fecho a ${endDateLabel}`;

        const canViewEarnings = data.canViewEarnings !== false;
        if (!canViewEarnings) {
            totalGanhosEl.innerText = 'Restrito';
            totalOrdersEl.innerText = data.totalOrders || 0;
            commissionEl.innerText = 'Restrito';
            if (averageEl) averageEl.innerText = 'Restrito';
        } else {
            totalGanhosEl.innerText = formatDriverMZN(data.totalGanhos);
            totalOrdersEl.innerText = data.totalOrders;
            commissionEl.innerText = `${data.commissionRate} %`;
            if (averageEl) {
                const average = Number(data.totalOrders) > 0 ? Number(data.totalGanhos || 0) / Number(data.totalOrders) : 0;
                averageEl.innerText = formatDriverMZN(average);
            }
        }

        window.TragoDriverEarningsData = { ...data, selectedPeriod: safePeriod };
        renderDriverEarningsChart(Array.isArray(data.ordersList) ? data.ordersList : []);
        const savedProfile = window.TragoDriverProfile?.read?.();
        if (savedProfile && Number(data.totalOrders) > Number(savedProfile.total_deliveries || 0)) {
            window.TragoDriverProfile?.render?.({ ...savedProfile, total_deliveries: Number(data.totalOrders) });
        }

        tableBody.innerHTML = '';
        if (!Array.isArray(data.ordersList) || data.ordersList.length === 0) {
            const periodText = data.period?.label || (safePeriod === 'day' ? 'hoje' : safePeriod === 'week' ? 'esta semana' : 'este mês');
            tableBody.innerHTML = `<tr><td colspan="4"><span class="driver-table-empty"><i class="fa-regular fa-folder-open"></i><b>Sem movimentos</b><small>Ainda não existem entregas concluídas para ${escapeHtml(periodText)}.</small></span></td></tr>`;
            return;
        }

        data.ordersList.forEach(order => {
            const orderId = String(order._id || order.id || '');
            const completedAt = order.timestamp_completed ? new Date(order.timestamp_completed).toLocaleDateString('pt-MZ') : '—';
            const driverValue = canViewEarnings ? formatDriverMZN(Number(order.valor_motorista || 0)) : 'Restrito';
            const priceValue = formatDriverMZN(Number(order.price || 0));
            tableBody.innerHTML += `
                <tr class="driver-earning-row">
                    <td data-label="Data">${escapeHtml(completedAt)}</td>
                    <td data-label="Pedido">#${escapeHtml(orderId.slice(-6))}</td>
                    <td data-label="Valor">${escapeHtml(priceValue)}</td>
                    <td data-label="Ganho" class="${canViewEarnings ? 'value-success' : 'muted-value'}">${escapeHtml(driverValue)}</td>
                </tr>
            `;
        });

    } catch (error) {
        console.error('Falha ao carregar ganhos:', error);
        totalGanhosEl.innerText = '—';
        totalOrdersEl.innerText = '—';
        commissionEl.innerText = '—';
        if (averageEl) averageEl.innerText = '—';
        renderDriverEarningsChart([]);
        tableBody.innerHTML = '<tr><td colspan="4" class="table-error"><span class="driver-table-empty error"><i class="fa-solid fa-wifi"></i><b>Não foi possível actualizar</b><small>Verifique a ligação e use o botão Actualizar.</small></span></td></tr>';
    }
}

function renderDriverEarningsChart(orders = []) {
    const chart = document.getElementById('driver-performance-chart');
    if (!chart) return;
    const labels = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
    const values = Array(7).fill(0);
    orders.forEach((order) => {
        const date = new Date(order.timestamp_completed || order.updatedAt || order.updated_at || '');
        if (Number.isNaN(date.getTime())) return;
        values[(date.getDay() + 6) % 7] += 1;
    });
    const maxValue = Math.max(1, ...values);
    chart.innerHTML = labels.map((label, index) => {
        const height = values[index] ? Math.max(18, Math.round((values[index] / maxValue) * 100)) : 8;
        return `<i style="--value:${height}%" title="${values[index]} entrega${values[index] === 1 ? '' : 's'}"><span>${values[index] || ''}</span><b>${label}</b></i>`;
    }).join('');
}

function exportDriverEarnings() {
    const data = window.TragoDriverEarningsData;
    if (!data || !Array.isArray(data.ordersList)) {
        showCustomAlert('Extrato indisponível', 'Actualize os ganhos antes de gerar o extrato.', 'warning');
        return;
    }
    const rows = [['Data', 'Pedido', 'Valor do serviço (MZN)', 'Ganho do motorista (MZN)']];
    data.ordersList.forEach((order) => {
        const date = order.timestamp_completed ? new Date(order.timestamp_completed).toLocaleDateString('pt-MZ') : '';
        rows.push([
            date,
            String(order._id || order.id || ''),
            Number(order.price || 0).toFixed(2),
            data.canViewEarnings === false ? 'Restrito' : Number(order.valor_motorista || 0).toFixed(2)
        ]);
    });
    const csv = '\uFEFF' + rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    link.download = `trago-ganhos-${data.selectedPeriod || 'periodo'}.csv`;
    document.body.appendChild(link);
    link.click();
    URL.revokeObjectURL(link.href);
    link.remove();
}


/* --- Lógica de UI (Mostrar/Esconder Secções) --- */

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function formatDriverMZN(value) {
    return new Intl.NumberFormat('pt-MZ', { style: 'currency', currency: 'MZN' }).format(Number(value || 0));
}

function getDriverPaymentLabel(paymentMethod) {
    const paymentMap = {
        cash: 'Dinheiro',
        mpesa: 'M-Pesa',
        emola: 'e-Mola',
        mkesh: 'mKesh',
        bank_transfer: 'Transferência bancária',
        pos: 'POS',
        postpaid_credit: 'Cliente Pós-pago / Crédito'
    };
    return paymentMap[paymentMethod] || paymentMethod || '—';
}

function getDriverStatusLabel(status) {
    const statusMap = {
        pendente: 'Pendente',
        atribuido: 'Atribuído',
        recolha_em_progresso: 'Em recolha',
        em_progresso: 'Em recolha',
        recolha_concluida: 'Recolha feita',
        entrega_em_progresso: 'Em entrega',
        concluido: 'Concluído',
        cancelado: 'Cancelado'
    };
    return statusMap[status] || 'Em análise';
}

function sanitizePhoneForLink(value) {
    const raw = String(value || '').trim();
    const clean = raw.replace(/[^+\d]/g, '');
    return clean || '';
}

function buildMapUrl(coord, text) {
    if (coord && Number.isFinite(Number(coord.lat)) && Number.isFinite(Number(coord.lng))) {
        return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${Number(coord.lat)},${Number(coord.lng)}`)}`;
    }
    const query = String(text || '').trim();
    return query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` : '';
}

function formatCoord(coord) {
    if (!coord || !Number.isFinite(Number(coord.lat)) || !Number.isFinite(Number(coord.lng))) return '';
    return `${Number(coord.lat).toFixed(5)}, ${Number(coord.lng).toFixed(5)}`;
}

function compactPlaceName(value, fallback = 'Morada não informada') {
    const raw = String(value || '').replace(/\s+/g, ' ').trim();
    if (!raw) return fallback;

    const ignored = [
        /^moçambique$/i, /^mozambique$/i, /^cidade de maputo$/i, /^maputo cidade$/i,
        /^zona sul$/i, /^zona norte$/i, /^zona centro$/i, /^região sul$/i,
        /^distrito municipal/i, /^município/i, /^municipal/i, /^província/i,
        /^\d{3,}[-–]?\d*$/i
    ];

    const cleaned = raw
        .split(',')
        .map(part => part.replace(/[“”"']/g, '').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .filter(part => !ignored.some(rx => rx.test(part)))
        .map(part => part.replace(/^Avenida\s+/i, 'Av. '));

    const unique = [];
    for (const part of cleaned) {
        const normalized = part.toLowerCase();
        if (!unique.some(item => item.toLowerCase() === normalized)) unique.push(part);
    }

    let selected = unique.slice(0, 3);
    if (!selected.length) selected = raw.split(',').map(p => p.trim()).filter(Boolean).slice(0, 2);

    let short = selected.join(' · ');
    if (short.length > 72 && selected.length > 2) short = selected.slice(0, 2).join(' · ');
    if (short.length > 72) short = `${short.slice(0, 69).trim()}…`;
    return short || fallback;
}

function buildAddressTitle(fullAddress, fallback) {
    const full = String(fullAddress || '').trim();
    const compact = compactPlaceName(full, fallback);
    const title = full ? ` title="${escapeHtml(full)}"` : '';
    return `<strong class="route-address-title"${title}>${escapeHtml(compact)}</strong>`;
}

function buildDriverRouteSummary(order) {
    const pickupRaw = order.pickup_address_text || order.pickup_address || '';
    const deliveryRaw = order.address_text || order.delivery_address || '';
    const pickupText = buildAddressTitle(pickupRaw, 'Recolha');
    const deliveryText = buildAddressTitle(deliveryRaw, 'Entrega');
    const distance = Number(order.route_distance_km || order.distance_km || 0);
    const distanceHtml = Number.isFinite(distance) && distance > 0
        ? `<div class="route-metric-pill"><span>Distância</span><strong>${distance.toFixed(2)} km</strong></div>`
        : '';

    return `
        <div class="route-point-card route-point-pickup">
            <span class="route-marker-dot"><i class="fas fa-box-open"></i></span>
            <div>
                <small>Recolha</small>
                ${pickupText}
            </div>
        </div>
        <div class="route-connector-line" aria-hidden="true"></div>
        <div class="route-point-card route-point-delivery">
            <span class="route-marker-dot"><i class="fas fa-flag-checkered"></i></span>
            <div>
                <small>Entrega</small>
                ${deliveryText}
            </div>
        </div>
        ${distanceHtml}
    `;
}

function renderDriverQuickActions(order) {
    const container = document.getElementById('driver-quick-actions');
    if (!container) return;

    const clientPhone = sanitizePhoneForLink(order.client_phone1);
    const pickupPhone = sanitizePhoneForLink(order.pickup_contact_phone);
    const pickupMap = buildMapUrl(order.pickup_address_coords, order.pickup_address_text || order.pickup_address);
    const deliveryMap = buildMapUrl(order.address_coords, order.address_text || order.delivery_address);

    const actions = [];
    if (pickupMap) actions.push(`<a href="${escapeHtml(pickupMap)}" target="_blank" rel="noopener" class="driver-quick-action"><i class="fas fa-box-open"></i><span>Recolha</span></a>`);
    if (deliveryMap) actions.push(`<a href="${escapeHtml(deliveryMap)}" target="_blank" rel="noopener" class="driver-quick-action"><i class="fas fa-map-location-dot"></i><span>Entrega</span></a>`);
    if (pickupPhone) actions.push(`<a href="tel:${escapeHtml(pickupPhone)}" class="driver-quick-action"><i class="fas fa-phone"></i><span>Ligar loja</span></a>`);
    if (clientPhone) actions.push(`<a href="tel:${escapeHtml(clientPhone)}" class="driver-quick-action"><i class="fas fa-user-phone"></i><span>Ligar cliente</span></a>`);
    if (clientPhone) actions.push(`<a href="https://wa.me/${escapeHtml(clientPhone.replace(/^\+/, ''))}" target="_blank" rel="noopener" class="driver-quick-action"><i class="fab fa-whatsapp"></i><span>WhatsApp</span></a>`);

    container.innerHTML = actions.length
        ? actions.join('')
        : '<p class="driver-quick-empty">Sem acções rápidas.</p>';
}

function renderDriverOrderMessages(messages = []) {
    const stream = document.getElementById('driver-order-chat-stream');
    if (!stream) return;
    if (!messages.length) {
        stream.innerHTML = '<div class="driver-chat-empty"><i class="fa-regular fa-comments"></i><strong>Sem mensagens</strong><span>Use esta conversa para coordenar a recolha e a entrega.</span></div>';
        return;
    }
    stream.innerHTML = messages.map((message) => {
        const role = message.senderRole || message.sender_role || 'system';
        const date = new Date(message.createdAt || Date.now());
        return `<article class="${role === 'driver' ? 'mine' : role === 'system' ? 'system' : ''}"><header><strong>${escapeHtml(message.senderName || message.sender_name || role)}</strong><small>${Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString('pt-MZ', { hour: '2-digit', minute: '2-digit' })}</small></header><p>${escapeHtml(message.body || '')}</p></article>`;
    }).join('');
    stream.scrollTop = stream.scrollHeight;
}

function updateDriverRestaurantReady(status) {
    const banner = document.getElementById('driver-restaurant-ready');
    if (!banner) return;
    banner.hidden = status !== 'ready';
}

async function loadDriverOrderMessages(orderId, silent = false) {
    if (!orderId) return;
    try {
        const response = await fetch(`${API_URL}/api/orders/${encodeURIComponent(orderId)}/messages?channel=${encodeURIComponent(driverActiveChatChannel)}`, { headers: getAuthHeaders('driver') });
        const data = await readJsonResponse(response);
        if (!response.ok) throw new Error(data.message || 'Falha ao carregar a conversa.');
        renderDriverOrderMessages(data.messages || []);
    } catch (error) {
        if (!silent) showCustomAlert('Comunicação', error.message, 'error');
    }
}

async function sendDriverOrderMessage(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const message = String(form.elements.message.value || '').trim();
    if (!message || !driverActiveOrderId) return;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
        const response = await fetch(`${API_URL}/api/orders/${encodeURIComponent(driverActiveOrderId)}/messages`, {
            method: 'POST',
            headers: { ...getAuthHeaders('driver'), 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, channel: driverActiveChatChannel })
        });
        const data = await readJsonResponse(response);
        if (!response.ok) throw new Error(data.message || 'Falha ao enviar a mensagem.');
        form.reset();
        await loadDriverOrderMessages(driverActiveOrderId, true);
    } catch (error) { showCustomAlert('Comunicação', error.message, 'error'); }
    finally { button.disabled = false; }
}

async function loadDriverOrderImage(order, img, noImg) {
    const orderId = String(order?._id || order?.id || '');
    const directUrl = String(order?.image_url || '');
    if (directUrl) {
        img.src = /^https?:\/\//i.test(directUrl) ? directUrl : `${API_URL}${directUrl}`;
        img.classList.remove('hidden');
        noImg.classList.add('hidden');
        return;
    }
    if (!orderId || !(order?.image_available || order?.imageAvailable)) {
        img.removeAttribute('src');
        img.classList.add('hidden');
        noImg.classList.remove('hidden');
        return;
    }

    try {
        const response = await fetch(`${API_URL}/api/orders/${encodeURIComponent(orderId)}/image`, {
            headers: getAuthHeaders('driver'),
            cache: 'no-store'
        });
        const data = await readJsonResponse(response);
        if (!response.ok || !data?.url) throw new Error(data?.message || 'Imagem indisponível.');
        if (String(driverActiveOrderId) !== orderId) return;
        img.src = data.url;
        img.classList.remove('hidden');
        noImg.classList.add('hidden');
    } catch (_error) {
        if (String(driverActiveOrderId) !== orderId) return;
        img.removeAttribute('src');
        img.classList.add('hidden');
        noImg.classList.remove('hidden');
    }
}

function fillDetalheEntrega(order) {
    const detalheSection = document.getElementById('detalhe-entrega');
    if (!detalheSection) return;

    const orderId = String(order._id || order.id || '');
    driverActiveOrderId = orderId;
    updateDriverRestaurantReady(order.pickup_authorized_at || order.pickupAuthorizedAt ? 'ready' : '');
    const restaurantParticipant = document.getElementById('driver-chat-restaurant-participant');
    if (restaurantParticipant) restaurantParticipant.textContent = order.restaurant_id || order.restaurantId
        ? 'Restaurante'
        : 'Ponto de recolha';
    loadDriverOrderMessages(orderId);
    clearInterval(driverOrderChatTimer);
    driverOrderChatTimer = setInterval(() => {
        const detailVisible = !document.getElementById('detalhe-entrega')?.classList.contains('hidden');
        if (detailVisible && driverActiveOrderId) loadDriverOrderMessages(driverActiveOrderId, true);
    }, 8000);
    detalheSection.dataset.orderId = orderId;
    detalheSection.querySelector('#detalhe-entrega-title').innerText = `Pedido #${orderId.slice(-6)}`;
    const detailStatus = document.getElementById('driver-detail-status');
    if (detailStatus) {
        detailStatus.textContent = getDriverStatusLabel(order.status);
        detailStatus.className = `driver-order-status-pill status-${order.status || 'pendente'}`;
    }
    renderDriverQuickActions(order);
    
    const img = detalheSection.querySelector('#encomenda-imagem');
    const noImg = detalheSection.querySelector('#no-image-placeholder');
    loadDriverOrderImage(order, img, noImg);

    document.getElementById('detalhe-cliente-nome').innerHTML = `<strong>Nome:</strong> ${escapeHtml(order.client_name || '—')}`;
    document.getElementById('detalhe-cliente-telefone').innerHTML = `<strong>Tel.:</strong> ${escapeHtml(order.client_phone1 || '—')}`;
    document.getElementById('detalhe-pickup-contact').innerHTML = `<strong>Resp.:</strong> ${escapeHtml(order.pickup_contact_name || '—')}`;
    document.getElementById('detalhe-pickup-phone').innerHTML = `<strong>Contacto:</strong> ${escapeHtml(order.pickup_contact_phone || '—')}`;
    const clientNotes = order.client_notes || order.clientNotes || '';
    const pickupNotes = order.pickup_notes || '';
    document.getElementById('detalhe-pickup-notes').innerHTML = `<strong>Notas do cliente:</strong> ${escapeHtml(clientNotes || pickupNotes || 'Sem orientações adicionais')}${clientNotes && pickupNotes && clientNotes !== pickupNotes ? `<br><strong>Instruções de recolha:</strong> ${escapeHtml(pickupNotes)}` : ''}`;
    document.getElementById('detalhe-cliente-endereco').innerHTML = buildDriverRouteSummary(order);
    
    const paymentMap = {
        cash: 'Dinheiro',
        mpesa: 'M-Pesa',
        emola: 'e-Mola',
        mkesh: 'mKesh',
        bank_transfer: 'Transferência bancária',
        pos: 'POS',
        postpaid_credit: 'Cliente Pós-pago / Crédito'
    };

    const paymentEl = document
        .getElementById('detalhe-payment-method')
        ?.querySelector(':scope > span');
    if (paymentEl) {
        paymentEl.textContent = paymentMap[order.payment_method] || order.payment_method || '—';
    }

    const coordsP = document.getElementById('detalhe-cliente-coords');
    const pickupCoords = order.pickup_address_coords;
    const deliveryCoords = order.address_coords;
    if (coordsP?.querySelector('span') && pickupCoords?.lat && deliveryCoords?.lat) {
        coordsP.querySelector('span').innerHTML = `<span>Recolha: ${formatCoord(pickupCoords)}</span><span>Entrega: ${formatCoord(deliveryCoords)}</span>`;
        coordsP.classList.remove('hidden');
    } else if (coordsP?.querySelector('span') && deliveryCoords?.lat) {
        coordsP.querySelector('span').innerHTML = `<span>Entrega: ${formatCoord(deliveryCoords)}</span>`;
        coordsP.classList.remove('hidden');
    } else if (coordsP) {
        coordsP.classList.add('hidden');
    }

    requestAnimationFrame(() => {
        window.TragoDriverMap?.renderOrderRoute?.(order);
    });


    // --- Controlo dos botões consoante o ESTADO da encomenda ---
    const btnIniciar = detalheSection.querySelector('#btn-iniciar-entrega');
    const formFinalizacao = detalheSection.querySelector('#form-finalizacao');

    btnIniciar.onclick = null;
    formFinalizacao.onsubmit = null;

    const status = order.status; // valores tipo: 'pendente', 'atribuido', 'recolha_em_progresso', 'recolha_concluida', 'entrega_em_progresso', 'concluido', 'cancelado'

    // 1) Estados iniciais: ainda não começou recolha
    if (status === 'pendente' || status === 'atribuido') {
        btnIniciar.classList.remove('hidden');
        btnIniciar.innerHTML = '<i class="fas fa-play-circle"></i> Iniciar Recolha';
        formFinalizacao.classList.add('hidden');
        btnIniciar.onclick = () => handleStartPickup(order._id);
        return;
    }

    // 2) Recolha em progresso (ou estado legacy 'em_progresso')
    if (status === 'recolha_em_progresso' || status === 'em_progresso') {
        btnIniciar.classList.remove('hidden');
        btnIniciar.innerHTML = '<i class="fas fa-flag-checkered"></i> Concluir Recolha';
        formFinalizacao.classList.add('hidden');
        btnIniciar.onclick = () => handleCompletePickup(order._id);
        return;
    }

    // 3) Recolha concluída -> pronto para iniciar entrega
    if (status === 'recolha_concluida') {
        btnIniciar.classList.remove('hidden');
        btnIniciar.innerHTML = '<i class="fas fa-route"></i> Iniciar Entrega';
        formFinalizacao.classList.add('hidden');
        btnIniciar.onclick = () => handleStartDeliveryPhase(order._id);
        return;
    }

    // 4) Entrega em progresso -> mostra formulário de finalização com código
    if (status === 'entrega_em_progresso') {
        btnIniciar.classList.add('hidden');
        formFinalizacao.classList.remove('hidden');
        formFinalizacao.reset();
        formFinalizacao.onsubmit = (event) => handlePaymentPreview(event, order._id);
        return;
    }

    // 5) Concluído ou cancelado -> nada para fazer
    if (status === 'concluido' || status === 'cancelado') {
        btnIniciar.classList.add('hidden');
        formFinalizacao.classList.add('hidden');
        return;
    }

    // Qualquer outro estado desconhecido -> não mostrar acções
    btnIniciar.classList.add('hidden');
    formFinalizacao.classList.add('hidden');

    
}

function showListaEntregas() {
    showDriverPage('lista-entregas');
}


/* --- Lógica de API (POST/PUT) --- */

async function handleChangePasswordDriver(e) {
    e.preventDefault();
    const form = e.target;
    const submitButton = form.querySelector('button[type="submit"]');

    const senhaAntiga = document.getElementById('driver-pass-antiga').value;
    const senhaNova = document.getElementById('driver-pass-nova').value;
    const senhaConfirmar = document.getElementById('driver-pass-confirmar').value;
    if (senhaNova !== senhaConfirmar) {
        showCustomAlert('Erro', 'As novas senhas não coincidem.', 'error');
        return;
    }

    submitButton.disabled = true;
    submitButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> A atualizar...';

    try {
        const response = await fetch(`${API_URL}/api/auth/change-password`, {
            method: 'PUT',
            headers: { ...getAuthHeaders('driver'), 'Content-Type': 'application/json' },
            body: JSON.stringify({ senhaAntiga, senhaNova })
        });
        const data = await readJsonResponse(response);
        if (!response.ok) {
            throw new Error(data.message);
        }
        showCustomAlert('Sucesso!', 'A sua senha foi alterada. Por favor, faça login novamente.', 'success');
        setTimeout(() => {
            handleLogout('driver');
        }, 2500);
    } catch (error) {
        console.error('Falha ao mudar a senha:', error);
        showCustomAlert('Erro', error.message, 'error');
        submitButton.disabled = false;
        submitButton.innerHTML = 'Atualizar Senha';
    }
}

/**
 * 1) Iniciar RECOLHA (central -> cliente)
 */
async function handleStartPickup(orderId) {
    const button = document.getElementById('btn-iniciar-entrega');
    if (!button) return;

    button.disabled = true;
    button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> A iniciar recolha...';

    try {
        const response = await fetch(`${API_URL}/api/orders/${orderId}/pickup-start`, {
            method: 'POST',
            headers: getAuthHeaders('driver')
        });
        const data = await readJsonResponse(response);
        if (!response.ok) throw new Error(data.message || 'Falha ao iniciar recolha.');
        
        showCustomAlert('Sucesso', 'Recolha iniciada. Dirija-se ao ponto de recolha.', 'success');
        showListaEntregas();
    } catch (error) {
        console.error('Falha ao iniciar recolha:', error);
        showCustomAlert('Erro', error.message, 'error');
    } finally {
        button.disabled = false;
        button.innerHTML = '<i class="fas fa-play-circle"></i> Iniciar Recolha';
    }
}

/**
 * 2) Concluir RECOLHA (chegou ao cliente / recolheu)
 */
async function handleCompletePickup(orderId) {
    const button = document.getElementById('btn-iniciar-entrega');
    if (!button) return;

    button.disabled = true;
    button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> A concluir recolha...';

    try {
        const response = await fetch(`${API_URL}/api/orders/${orderId}/pickup-complete`, {
            method: 'POST',
            headers: getAuthHeaders('driver')
        });
        const data = await readJsonResponse(response);
        if (!response.ok) throw new Error(data.message || 'Falha ao concluir recolha.');
        
        showCustomAlert('Sucesso', 'Recolha concluída. Pode iniciar a entrega.', 'success');
        showListaEntregas();
    } catch (error) {
        console.error('Falha ao concluir recolha:', error);
        showCustomAlert('Erro', error.message, 'error');
    } finally {
        button.disabled = false;
        button.innerHTML = '<i class="fas fa-flag-checkered"></i> Concluir Recolha';
    }
}

/**
 * 3) Iniciar ENTREGA (cliente -> destino)
 */
async function handleStartDeliveryPhase(orderId) {
    const button = document.getElementById('btn-iniciar-entrega');
    if (!button) return;

    button.disabled = true;
    button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> A iniciar entrega...';

    try {
        const response = await fetch(`${API_URL}/api/orders/${orderId}/delivery-start`, {
            method: 'POST',
            headers: getAuthHeaders('driver')
        });
        const data = await readJsonResponse(response);
        if (!response.ok) throw new Error(data.message || 'Falha ao iniciar entrega.');
        
        showCustomAlert('Sucesso', 'Entrega iniciada. Siga a rota até ao ponto de entrega.', 'success');
        showListaEntregas();
    } catch (error) {
        console.error('Falha ao iniciar entrega:', error);
        showCustomAlert('Erro', error.message, 'error');
    } finally {
        button.disabled = false;
        button.innerHTML = '<i class="fas fa-route"></i> Iniciar Entrega';
    }
}

/**
 * 4) Concluir ENTREGA (entrega final com código)
 */
let pendingPaymentConfirmation = null;

function closePaymentConfirmationModal() {
    const modal = document.getElementById('payment-confirmation-modal');
    const amountInput = document.getElementById('payment-confirmed-amount');
    if (modal) modal.classList.add('hidden');
    if (amountInput) {
        amountInput.value = '';
        amountInput.dataset.userTyped = 'false';
        amountInput.dataset.expectedAmount = '';
    }
    pendingPaymentConfirmation = null;
}

function openPaymentConfirmationModal({ orderId, verificationCode, preview, notes, proofFile }) {
    const modal = document.getElementById('payment-confirmation-modal');
    const totalEl = document.getElementById('payment-confirmation-total');
    const messageEl = document.getElementById('payment-confirmation-message');
    const methodEl = document.getElementById('payment-confirmation-method');
    const amountGroup = document.getElementById('payment-confirmation-amount-group');
    const amountInput = document.getElementById('payment-confirmed-amount');
    const button = document.getElementById('btn-confirm-payment-finalize');

    if (!modal || !totalEl || !messageEl || !methodEl || !amountGroup || !amountInput || !button) {
        showCustomAlert('Erro', 'Não foi possível abrir a confirmação de pagamento. Actualize a página e tente novamente.', 'error');
        return;
    }

    const requiresImmediatePayment = preview.requiresImmediatePayment !== false;
    const amount = Number(preview.totalToPay || 0).toFixed(2);
    pendingPaymentConfirmation = {
        orderId,
        verificationCode,
        preview: { ...preview, requiresImmediatePayment },
        notes,
        proofFile: proofFile || null
    };

    totalEl.textContent = `${amount} MZN`;
    messageEl.textContent = preview.message || 'Código validado. Confirme o pagamento para finalizar.';
    methodEl.textContent = `Método: ${preview.paymentMethodLabel || preview.paymentMethod || '—'}`;
    // Segurança operacional: nunca pré-preencher o valor a confirmar.
    // O motorista deve escrever manualmente o valor recebido no acto.
    amountInput.value = '';
    amountInput.dataset.userTyped = 'false';
    amountInput.dataset.expectedAmount = String(amount);
    amountInput.required = requiresImmediatePayment;
    amountInput.readOnly = !requiresImmediatePayment;
    amountGroup.classList.toggle('hidden', !requiresImmediatePayment);
    button.innerHTML = requiresImmediatePayment
        ? '<i class="fas fa-check-circle"></i> Confirmar valor e finalizar'
        : '<i class="fas fa-check-circle"></i> Finalizar Pós-pago';
    modal.classList.remove('hidden');
    if (requiresImmediatePayment) {
        setTimeout(() => amountInput.focus(), 80);
    }
}

async function handlePaymentPreview(event, orderId) {
    event.preventDefault();
    const form = event.target;
    const submitButton = form.querySelector('button[type="submit"]');
    const verification_code = form.querySelector('#codigo-finalizacao').value.toUpperCase();
    const notes = form.querySelector('#driver-delivery-notes')?.value || '';
    const proofFile = form.querySelector('#driver-delivery-proof')?.files?.[0] || null;

    if (verification_code.length < 5) {
        showCustomAlert('Erro', 'O código deve ter 5 caracteres.', 'error');
        return;
    }

    submitButton.disabled = true;
    submitButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> A validar código...';

    try {
        const response = await fetch(`${API_URL}/api/orders/${orderId}/payment-preview`, {
            method: 'POST',
            headers: { ...getAuthHeaders('driver'), 'Content-Type': 'application/json' },
            body: JSON.stringify({ verification_code })
        });
        const preview = await readJsonResponse(response);
        if (!response.ok) throw new Error(preview.message || 'Falha ao validar código.');
        openPaymentConfirmationModal({ orderId, verificationCode: verification_code, preview, notes, proofFile });
    } catch (error) {
        console.error('Falha ao validar pagamento:', error);
        showCustomAlert('Erro', error.message, 'error');
    } finally {
        submitButton.disabled = false;
        submitButton.innerHTML = '<i class="fas fa-check-circle"></i> Finalizar Entrega';
    }
}

function parsePaymentAmount(value) {
    const normalized = String(value || '').trim().replace(/\s+/g, '').replace(',', '.');
    if (!normalized) return NaN;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : NaN;
}

async function submitPaymentConfirmation() {
    if (!pendingPaymentConfirmation) return;
    const { orderId, verificationCode, preview, notes, proofFile } = pendingPaymentConfirmation;
    const button = document.getElementById('btn-confirm-payment-finalize');
    const amountInput = document.getElementById('payment-confirmed-amount');
    const requiresImmediatePayment = preview.requiresImmediatePayment !== false;
    const expectedAmount = Number(preview.totalToPay || 0);
    let amount = null;

    if (requiresImmediatePayment) {
        const rawAmount = amountInput?.value || '';
        const manuallyTyped = amountInput?.dataset.userTyped === 'true';
        amount = parsePaymentAmount(rawAmount);

        if (!manuallyTyped) {
            showCustomAlert('Erro', 'O motorista tem de escrever manualmente o valor recebido antes de finalizar.', 'error');
            amountInput?.focus();
            return;
        }

        if (!Number.isFinite(amount)) {
            showCustomAlert('Erro', 'Introduza um valor recebido válido.', 'error');
            amountInput?.focus();
            return;
        }

        if (Math.round(amount * 100) !== Math.round(expectedAmount * 100)) {
            showCustomAlert('Valor divergente', `O valor digitado deve ser exactamente ${expectedAmount.toFixed(2)} MZN.`, 'error');
            amountInput?.focus();
            return;
        }
    }

    button.disabled = true;
    button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> A finalizar...';

    try {
        let deliveryProofUrl = '';
        if (proofFile) {
            const upload = new FormData();
            upload.append('file', proofFile);
            upload.append('category', 'delivery-proof');
            const uploadResponse = await fetch(`${API_URL}/api/media/upload`, {
                method: 'POST',
                headers: getAuthHeaders('driver'),
                body: upload
            });
            const uploadData = await readJsonResponse(uploadResponse);
            if (!uploadResponse.ok) throw new Error(uploadData.message || 'Falha ao carregar o comprovativo.');
            deliveryProofUrl = uploadData.storage_ref || uploadData.url || '';
        }
        const response = await fetch(`${API_URL}/api/orders/${orderId}/complete`, {
            method: 'POST',
            headers: { ...getAuthHeaders('driver'), 'Content-Type': 'application/json' },
            body: JSON.stringify({
                verification_code: verificationCode,
                payment_amount_confirmed: amount,
                driver_delivery_notes: notes,
                delivery_proof_url: deliveryProofUrl
            })
        });
        const data = await readJsonResponse(response);
        if (!response.ok) throw new Error(data.message || 'Falha ao finalizar entrega.');
        closePaymentConfirmationModal();
        showCustomAlert('Sucesso', data.message || 'Entrega finalizada e pagamento confirmado!', 'success');
        showListaEntregas();
    } catch (error) {
        console.error('Falha ao confirmar pagamento:', error);
        showCustomAlert('Erro', error.message, 'error');
    } finally {
        button.disabled = false;
        button.innerHTML = requiresImmediatePayment
            ? '<i class="fas fa-check-circle"></i> Confirmar valor e finalizar'
            : '<i class="fas fa-check-circle"></i> Finalizar Pós-pago';
    }
}


async function loadDriverProfileVisibility() {
    try {
        const response = await fetch(`${API_URL}/api/auth/me`, { headers: getAuthHeaders('driver') });
        if (!response.ok) return;
        const data = await readJsonResponse(response);
        const type = data.profile?.driverType || data.profile?.driver_type;
        if (type === 'official') {
            const desktopBtn = document.getElementById('driver-earnings');
            const mobileBtn = document.getElementById('mobile-nav-ganhos');
            desktopBtn?.classList.remove('hidden');
            mobileBtn?.classList.remove('hidden');
            desktopBtn?.setAttribute('title', 'Ver entregas concluídas. Comissões restritas para motoristas oficiais.');
            mobileBtn?.setAttribute('title', 'Ver entregas concluídas. Comissões restritas para motoristas oficiais.');
        }
        const nameEl = document.getElementById('driver-name-header');
        if (nameEl && data.nome) nameEl.textContent = data.nome;
    } catch (error) {
        console.warn('Falha ao carregar perfil do motorista:', error);
    }
}

let lastDriverPaymentAlertAt = 0;
async function checkDriverPaymentPendingAlerts(force = false) {
    try {
        const response = await fetch(`${API_URL}/api/orders/payment-pending`, { headers: getAuthHeaders('driver') });
        if (!response.ok) return;
        const data = await readJsonResponse(response);
        const total = Number(data.total || 0);
        const now = Date.now();
        if (total > 0 && (force || now - lastDriverPaymentAlertAt > 120000)) {
            lastDriverPaymentAlertAt = now;
            showCustomAlert('Pagamento pendente', `${total} entrega(s) aguardam confirmação de pagamento/finalização.`, 'info');
        }
    } catch (error) {
        console.warn('Falha ao verificar pagamentos pendentes:', error);
    }
}

/**
 * Compatibilidade: se algum código antigo chamar handleStartDelivery,
 * encaminhamos para o início da recolha.
 */
async function handleStartDelivery(orderId) {
    return handleStartPickup(orderId);
}
