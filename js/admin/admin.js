/*
 * Ficheiro: js/admin/admin.js (REFATORADO)
 *
 * Este é o ficheiro "controlador" principal.
 * Ele apenas gere a navegação, os event listeners e os sockets.
 *
 * Depende de:
 * - adminApi.js (para chamadas fetch)
 * - adminModals.js (para abrir modais)
 * - adminMap.js (para lógica de mapas)
 * - adminCharts.js (para gráficos)
 */

// --- Variáveis de Estado Globais ---
let socket = null;
let clientCache = []; // O cache de clientes ainda é útil aqui

/* --- PONTO DE ENTRADA (Entry Point) --- */
document.addEventListener('DOMContentLoaded', () => {
    checkAuth('admin'); 
    initializeMapIcons(); // (Vem do adminMap.js)
    connectSocket(); 
    attachEventListeners();
    initAdminNotificationCenter();
    installResponsiveTableObserver();
    initAdminMobileShell();
    initCollapsibleVehicleForms();

    loadAdminProfile(); // 👈 ESTA LINHA
    
    // Carrega a página inicial
    showPage('visao-geral', 'nav-visao-geral', 'Visão Geral');
});

/**
 * Anexa todos os event listeners da aplicação.
 * As funções 'handle...' e 'open...' vêm dos ficheiros importados.
 */
function attachEventListeners() {
    // --- Formulários ---
    document.getElementById('delivery-form').addEventListener('submit', handleNewDelivery);
    document.getElementById('form-add-motorista').addEventListener('submit', handleAddDriver);
    document.getElementById('form-edit-motorista').addEventListener('submit', handleUpdateDriver);
    document.getElementById('form-add-cliente').addEventListener('submit', handleAddClient);
    document.getElementById('form-edit-cliente').addEventListener('submit', handleUpdateClient);
    document.getElementById('form-change-password').addEventListener('submit', handleChangePassword);

    // --- Navegação Principal (Sidebar) ---
    document.getElementById('nav-visao-geral').addEventListener('click', (e) => {
        e.preventDefault();
        showPage('visao-geral', 'nav-visao-geral', 'Visão Geral');
    });
    document.getElementById('nav-entregas').addEventListener('click', (e) => {
        e.preventDefault();
        showPage('entregas-activas', 'nav-entregas', 'Entregas Activas');
    });
    document.getElementById('nav-motoristas').addEventListener('click', (e) => {
        e.preventDefault();
        showPage('gestao-motoristas', 'nav-motoristas', 'Gestão de Motoristas');
    });
    document.getElementById('nav-clientes').addEventListener('click', (e) => {
        e.preventDefault();
        showPage('gestao-clientes', 'nav-clientes', 'Gestão de Clientes');
    });

    // NOVO: custos
    document.getElementById('nav-custos').addEventListener('click', (e) => {
        e.preventDefault();
        showPage('custos', 'nav-custos', 'Custos');
    });

    // NOVO: cargos
    document.getElementById('nav-cargos').addEventListener('click', (e) => {
        e.preventDefault();
        showPage('cargos', 'nav-cargos', 'Cargos');
    });

    document.getElementById('nav-historico').addEventListener('click', (e) => {
        e.preventDefault();
        showPage('historico', 'nav-historico', 'Histórico');
    });
    document.getElementById('nav-mapa').addEventListener('click', (e) => {
        e.preventDefault();
        showPage('mapa-tempo-real', 'nav-mapa', 'Mapa em Tempo Real');
    });
    document.getElementById('nav-support')?.addEventListener('click', (e) => {
        e.preventDefault();
        showPage('support-center', 'nav-support', 'Suporte Interno');
    });
    document.getElementById('nav-config').addEventListener('click', (e) => {
        e.preventDefault();
        showPage('configuracoes', 'nav-config', 'Configurações');
    });

    // Submenu de Formulários
    document.getElementById('nav-form-doc').addEventListener('click', (e) => { 
        e.preventDefault(); 
        showServiceForm('doc'); 
    });
    document.getElementById('nav-form-farma').addEventListener('click', (e) => { 
        e.preventDefault(); 
        showServiceForm('farma'); 
    });
    document.getElementById('nav-form-carga').addEventListener('click', (e) => { 
        e.preventDefault(); 
        showServiceForm('carga'); 
    });
    document.getElementById('nav-form-rapido').addEventListener('click', (e) => { 
        e.preventDefault(); 
        showServiceForm('rapido'); 
    });
    document.getElementById('nav-form-restaurante-comida')?.addEventListener('click', (e) => {
        e.preventDefault();
        showServiceForm('restaurante_comida');
    });
    document.getElementById('nav-form-mercadoria-cp')?.addEventListener('click', (e) => {
        e.preventDefault();
        showServiceForm('mercadoria_cp');
    });
    document.getElementById('nav-form-refeicao-restaurante-p')?.addEventListener('click', (e) => {
        e.preventDefault();
        showServiceForm('refeicao_restaurante_p');
    });
    document.getElementById('nav-form-outros').addEventListener('click', (e) => { 
        e.preventDefault(); 
        showServiceForm('outros'); 
    });

    // --- Autenticação ---
    document.getElementById('admin-logout').addEventListener('click', (e) => { 
        e.preventDefault(); 
        handleLogout('admin'); 
    });

    // --- Modais e Botões (Listeners) ---
    document.getElementById('history-search-input').addEventListener('input', filterHistoryTable);
    const historyPeriodSelect = document.getElementById('history-period-select');
    if (historyPeriodSelect) {
        historyPeriodSelect.addEventListener('change', () => loadHistory());
    }
    document.getElementById('delivery-image').addEventListener('change', handleImageUpload);
    document.getElementById('delivery-client-select').addEventListener('change', handleClientSelect);

    // Listeners do Modal de Extrato (Statement)
    document.getElementById('btn-generate-statement').addEventListener('click', handleGenerateStatement);
    document.getElementById('btn-download-pdf').addEventListener('click', handleDownloadPDF);
    document.querySelectorAll('.btn-set-date').forEach(btn => {
        btn.addEventListener('click', () => setStatementDates(btn.dataset.range));
    });

    // Zona de Perigo
    document.getElementById('btn-delete-old-history').addEventListener('click', handleDeleteOldHistoryClick);
    document.getElementById('btn-close-confirmation-modal').addEventListener('click', closeConfirmationModal);
    document.getElementById('btn-cancel-confirmation-modal').addEventListener('click', closeConfirmationModal);
    
    const financialPeriodSelect = document.getElementById('financial-period-select');
    if (financialPeriodSelect) {
        financialPeriodSelect.addEventListener('change', () => loadFinancialStats(financialPeriodSelect.value));
    }

    const vehicleForms = [document.getElementById('form-add-veiculo'), document.getElementById('form-add-veiculo-motoristas')].filter(Boolean);
    vehicleForms.forEach((vehicleForm) => {
        vehicleForm.addEventListener('submit', handleAddVehicle);
        vehicleForm.addEventListener('submit', () => {
            const keepOpen = vehicleForm.dataset.keepOpen === 'true';
            if (!keepOpen) {
                window.setTimeout(() => collapseVehicleForm(vehicleForm.id), 120);
            }
        });
    });

    const driverTypeSelect = document.getElementById('driver-type');
    if (driverTypeSelect) {
        driverTypeSelect.addEventListener('change', () => applyDriverTypeCommissionLock('driver-type', 'driver-commission'));
    }
    const editDriverTypeSelect = document.getElementById('edit-driver-type');
    if (editDriverTypeSelect) {
        editDriverTypeSelect.addEventListener('change', () => applyDriverTypeCommissionLock('edit-driver-type', 'edit-driver-commission'));
    }

    // NOVO: formulário de custos (pode não existir em versões antigas)
    const costForm = document.getElementById('form-add-cost');
    if (costForm) {
        costForm.addEventListener('submit', handleAddCost);
    }

    // Botão exportar Excel
    const exportCostsBtn = document.getElementById('btn-export-costs-excel');
    if (exportCostsBtn) {
        exportCostsBtn.addEventListener('click', handleExportCostsExcel);
    }

    // --- Lógica do Menu Mobile ---
    const menuToggle = document.getElementById('mobile-menu-toggle');
    const mainContent = document.querySelector('.main-content');
    const sidebar = document.getElementById('sidebar');
    if (menuToggle) {
        menuToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            document.body.classList.toggle('mobile-menu-open');
        });
    }

    // Mobile: o menu nunca deve bloquear o scroll da página.
    // Qualquer toque fora da sidebar fecha o menu e devolve a navegação normal.
    document.addEventListener('click', (e) => {
        if (!document.body.classList.contains('mobile-menu-open')) return;
        const clickedInsideSidebar = sidebar && sidebar.contains(e.target);
        const clickedMenuButton = menuToggle && menuToggle.contains(e.target);
        if (!clickedInsideSidebar && !clickedMenuButton) {
            document.body.classList.remove('mobile-menu-open');
        }
    });

    if (mainContent) {
        mainContent.addEventListener('touchmove', () => {
            // Mantém o scroll vertical natural no mobile, mesmo se a classe do menu ficar activa por algum estado antigo.
            document.body.style.overflowY = 'auto';
        }, { passive: true });
    }
    // Fecha o menu mobile ao clicar num item (em ecrãs pequenos)
    document.querySelectorAll('.sidebar-menu .menu-item a').forEach(item => {
        item.addEventListener('click', () => {
            if (window.innerWidth < 992 && !item.parentElement.classList.contains('has-submenu')) {
                document.body.classList.remove('mobile-menu-open');
            }
        });
    });
}


function collapseVehicleForm(formId) {
    const form = document.getElementById(formId);
    if (!form) return;
    const toggle = document.querySelector(`[data-target-form="${formId}"]`);
    form.classList.add('is-collapsed');
    form.hidden = true;
    form.dataset.keepOpen = 'false';
    if (toggle) {
        toggle.setAttribute('aria-expanded', 'false');
        toggle.classList.remove('is-open');
        const icon = toggle.querySelector('i');
        const label = toggle.querySelector('span');
        if (icon) icon.className = 'fas fa-plus';
        if (label && formId === 'form-add-veiculo-motoristas') label.textContent = 'Novo Veículo';
    }
}

function expandVehicleForm(formId) {
    const form = document.getElementById(formId);
    if (!form) return;
    const toggle = document.querySelector(`[data-target-form="${formId}"]`);
    form.classList.remove('is-collapsed');
    form.hidden = false;
    form.dataset.keepOpen = 'true';
    if (toggle) {
        toggle.setAttribute('aria-expanded', 'true');
        toggle.classList.add('is-open');
        const icon = toggle.querySelector('i');
        const label = toggle.querySelector('span');
        if (icon) icon.className = 'fas fa-chevron-up';
        if (label && formId === 'form-add-veiculo-motoristas') label.textContent = 'Fechar Formulário';
    }
}

function toggleVehicleForm(formId) {
    const form = document.getElementById(formId);
    if (!form) return;
    if (form.hidden || form.classList.contains('is-collapsed')) {
        expandVehicleForm(formId);
    } else {
        collapseVehicleForm(formId);
    }
}

function initCollapsibleVehicleForms() {
    document.querySelectorAll('[data-target-form]').forEach((toggle) => {
        const formId = toggle.getAttribute('data-target-form');
        if (!formId) return;
        collapseVehicleForm(formId);
        toggle.addEventListener('click', () => toggleVehicleForm(formId));
    });
}

/* --- Lógica de Navegação (Router) --- */

/**
 * Mostra uma página de conteúdo e esconde as outras.
 * Chama as funções de carregamento de dados necessárias.
 * @param {string} pageId - ID do elemento da página (ex: 'visao-geral')
 * @param {string} navId - ID do link da sidebar (ex: 'nav-visao-geral')
 * @param {string} title - O título a mostrar no header
 */
function showPage(pageId, navId, title) {
    // Limpa recursos de outras páginas
    destroyFormMap(); // (adminMap.js)
    destroyLiveMap(); // (adminMap.js)
    destroyCharts();  // (adminCharts.js)     
    
    // Esconde todas as páginas e desativa todos os links
    document.querySelectorAll('.content-page').forEach(page => page.classList.add('hidden'));
    document.querySelectorAll('.sidebar-menu .menu-item').forEach(item => item.classList.remove('active'));
    
    // Mostra a página e ativa o link corretos
    const pageToShow = document.getElementById(pageId);
    if (pageToShow) pageToShow.classList.remove('hidden');
    
    const navLink = document.getElementById(navId);
    if (navLink) navLink.classList.add('active');
    
    document.getElementById('main-title').innerText = title;
    setAdminMobileActive(pageId);
    
    // Carrega os dados específicos da página
    switch (pageId) {
        case 'visao-geral':
            loadOverviewStats();
            loadFinancialStats(document.getElementById('financial-period-select')?.value || 'month');
            initServicesChart();
            break;
        case 'custos':
            loadCostsDashboardSummary();
            loadCostAssignmentOptions();
            break;
        case 'gestao-motoristas':
            loadDrivers();
            loadVehicles();
            loadVehiclesIntoSelects();
            break;
        case 'entregas-activas':
            loadActiveDeliveries();
            break;
        case 'historico':
            loadHistory();
            break;
        case 'gestao-clientes':
            loadClients();
            break;
        case 'mapa-tempo-real':
            initializeLiveMap();
            break;
        case 'support-center':
            window.TragoSupport?.openHub?.('admin');
            break;
        case 'cargos':
            loadDrivers();
            loadClients();
            loadVehicles();
            loadVehiclesIntoSelects();
            break;
        case 'configuracoes':
            document.getElementById('form-change-password').reset();
            break;
    }
}

/**
 * Controlador para mostrar o formulário de nova entrega.
 * @param {string} serviceType - O tipo de serviço (ex: 'doc', 'farma')
 */
function showServiceForm(serviceType) {
    const titles = {
        'doc': 'Nova Tramitação de Documentos',
        'farma': 'Novo Pedido Farmacêutico',
        'carga': 'Novo Transporte de Carga',
        'rapido': 'Novo Delivery Rápido',
        'restaurante_comida': 'Nova Entrega — Comida de Restaurante',
        'mercadoria_cp': 'Nova Entrega — Mercadoria C/P',
        'refeicao_restaurante_p': 'Nova Entrega — Refeição Restaurante P',
        'outros': 'Outros Serviços'
    };
    showPage('form-nova-entrega', null, titles[serviceType] || 'Nova Entrega');
    
    // Prepara o formulário
    removeImage(); // (ui.js)
    resetDeliveryForm();
    document.getElementById('service-type').value = serviceType;
    loadClientsIntoDropdown(); // (adminApi.js)
    
    // Atraso para garantir que o elemento #map está visível antes de inicializar
    setTimeout(() => {
        initializeFormMap(); // (adminMap.js)
        if (window.TragoGeoPricing) {
            window.TragoGeoPricing.initDeliveryPricingForm();
        }
    }, 100);
}



/* --- Mobile Shell do Admin --- */
function initAdminMobileShell() {
    const bottomNav = document.getElementById('admin-bottom-nav');
    if (!bottomNav) return;

    const newSheet = document.getElementById('admin-mobile-new-sheet');
    const moreSheet = document.getElementById('admin-mobile-more-sheet');

    const openSheet = (sheet) => {
        if (!sheet) return;
        closeAdminMobileSheets();
        sheet.classList.remove('hidden');
        sheet.setAttribute('aria-hidden', 'false');
        document.body.classList.add('admin-sheet-open');
    };

    document.getElementById('admin-mobile-new-toggle')?.addEventListener('click', () => {
        setAdminMobileActive('form-nova-entrega');
        openSheet(newSheet);
    });

    document.getElementById('admin-mobile-more-toggle')?.addEventListener('click', () => {
        setAdminMobileActive('more');
        openSheet(moreSheet);
    });

    document.querySelectorAll('[data-mobile-nav]').forEach((button) => {
        button.addEventListener('click', () => {
            const navId = button.getAttribute('data-mobile-nav');
            const navElement = document.getElementById(navId);
            closeAdminMobileSheets();
            if (navElement) navElement.click();
        });
    });

    document.querySelectorAll('[data-mobile-service]').forEach((button) => {
        button.addEventListener('click', () => {
            const serviceType = button.getAttribute('data-mobile-service');
            closeAdminMobileSheets();
            if (serviceType) showServiceForm(serviceType);
            setAdminMobileActive('form-nova-entrega');
        });
    });

    document.querySelectorAll('[data-mobile-sheet-close]').forEach((button) => {
        button.addEventListener('click', closeAdminMobileSheets);
    });

    window.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closeAdminMobileSheets();
    });
}

function closeAdminMobileSheets() {
    document.querySelectorAll('.admin-mobile-sheet').forEach((sheet) => {
        sheet.classList.add('hidden');
        sheet.setAttribute('aria-hidden', 'true');
    });
    document.body.classList.remove('admin-sheet-open');
}

function setAdminMobileActive(pageId) {
    const bottomNav = document.getElementById('admin-bottom-nav');
    if (!bottomNav) return;

    bottomNav.querySelectorAll('.admin-bottom-item').forEach((item) => item.classList.remove('active'));

    const pageToNav = {
        'visao-geral': 'nav-visao-geral',
        'entregas-activas': 'nav-entregas',
        'gestao-motoristas': 'nav-motoristas',
        'gestao-clientes': 'more',
        'custos': 'more',
        'cargos': 'more',
        'historico': 'more',
        'mapa-tempo-real': 'more',
        'support-center': 'more',
        'configuracoes': 'more',
        'form-nova-entrega': 'new',
        'more': 'more'
    };

    const activeKey = pageToNav[pageId] || 'more';
    const selector = activeKey.startsWith('nav-')
        ? `[data-mobile-nav="${activeKey}"]`
        : `[data-mobile-role="${activeKey}"]`;

    const activeItem = bottomNav.querySelector(selector);
    if (activeItem) activeItem.classList.add('active');
}

/* --- Lógica de Supabase Realtime --- */
function connectSocket() {
    const token = getAuthToken('admin');
    if (!token) return;

    // Função auxiliar para saber qual página está ativa
    const activePage = () => {
        const page = document.querySelector('.content-page:not(.hidden)');
        return page ? page.id : null;
    };

    function refreshOperationalViews({ includeHistory = false, includeFinancials = false } = {}) {
        const page = activePage();
        if (page === 'entregas-activas') loadActiveDeliveries();
        if (page === 'gestao-motoristas') loadDrivers();
        if (page === 'historico' && includeHistory) loadHistory();
        if (page === 'visao-geral') {
            loadOverviewStats();
            if (includeFinancials) loadFinancialStats(document.getElementById('financial-period-select')?.value || 'month');
            initServicesChart();
        }
    }

    function handleRealtimeEvent(event, data = {}) {
        switch (event) {
            case 'order_pending':
                addAdminNotification({
                    id: `order_pending_${data.orderId || data.id || Date.now()}`,
                    type: 'order',
                    title: 'Novo pedido recebido',
                    message: data.clientName ? `Pedido de ${data.clientName} aguardando atribuição.` : 'Há um novo pedido aguardando controlo operacional.',
                    createdAt: new Date().toISOString()
                });
                refreshOperationalViews();
                break;

            case 'orders_changed':
            case 'pickup_started':
            case 'pickup_completed':
            case 'delivery_started':
                refreshOperationalViews();
                break;

            case 'order_message_created':
            case 'restaurant_order_status_changed':
            case 'order_status_changed': {
                refreshOperationalViews({ includeHistory: true });
                const modal = document.getElementById('history-detail-modal');
                if (modal && !modal.classList.contains('hidden') && String(modal.dataset.orderId || '') === String(data.orderId || '')) {
                    loadAdminOrderMessages(data.orderId);
                }
                break;
            }

            case 'payment_confirmation_pending':
                addAdminNotification({
                    id: `payment_pending_${data.id || data.orderId || Date.now()}`,
                    type: 'payment',
                    title: 'Pagamento por confirmar',
                    message: data.amount ? `Entrega aguardando confirmação de pagamento: ${Number(data.amount).toFixed(2)} MZN.` : 'Uma entrega aguarda confirmação de pagamento/finalização.',
                    createdAt: new Date().toISOString()
                });
                checkAdminPaymentPendingAlerts(true);
                refreshOperationalViews();
                break;

            case 'order_canceled':
                refreshOperationalViews({ includeHistory: true });
                break;

            case 'delivery_completed':
                addAdminNotification({
                    id: `delivery_completed_${data.orderId || data.id || Date.now()}`,
                    type: 'success',
                    title: 'Entrega finalizada',
                    message: 'Uma entrega foi finalizada e enviada para o histórico.',
                    createdAt: new Date().toISOString()
                });
                refreshOperationalViews({ includeHistory: true, includeFinancials: true });
                break;

            case 'driver_status_changed':
                refreshOperationalViews();
                if (activePage() === 'mapa-tempo-real') {
                    if (typeof updateDriverMarkerStatus === 'function') updateDriverMarkerStatus(data);
                    if (typeof fetchLiveDriverLocations === 'function') fetchLiveDriverLocations();
                }
                break;

            case 'driver_location_broadcast':
                if (typeof updateDriverMarker === 'function') updateDriverMarker(data);
                break;

            case 'driver_disconnected_broadcast':
                if (typeof removeDriverMarker === 'function') removeDriverMarker(data);
                break;

            default:
        }
    }

    const subscription = window.TragoRealtime?.connectAdminRealtime({
        onEvent: handleRealtimeEvent
    });

    // Mantém uma interface mínima compatível com código antigo que ainda chama socket.emit().
    socket = {
        connected: Boolean(subscription),
        emit(event) {
            if (event === 'admin_request_all_locations' && typeof fetchLiveDriverLocations === 'function') {
                fetchLiveDriverLocations();
            }
        },
        disconnect() {
            subscription?.unsubscribe?.();
        }
    };
}

/* --- Lógica Auxiliar (UI Helpers) --- */

/**
 * Preenche o formulário de entrega quando um cliente registado é selecionado.
 */
function handleClientSelect(e) {
    const selectedClientId = e.target.value;
    const client = clientCache.find(c => c._id === selectedClientId);
    
    if (client) {
        document.getElementById('client-name').value = client.nome;
        document.getElementById('client-phone1').value = client.telefone;
        document.getElementById('client-phone2').value = ''; // Limpa o tel. alternativo
        document.getElementById('delivery-client-id').value = client._id;
        const paymentMethodEl = document.getElementById('payment-method');
        if (paymentMethodEl) {
            if (client.billing_type === 'postpaid') {
                paymentMethodEl.value = 'postpaid_credit';
                showCustomAlert('Cliente pós-pago', `Este cliente usa crédito mensal. Saldo disponível: ${Number(client.credit_balance || 0).toFixed(2)} MZN.`, 'info');
            } else if (paymentMethodEl.value === 'postpaid_credit') {
                paymentMethodEl.value = 'cash';
            }
        }
        
        // Torna os campos read-only
        document.getElementById('client-name').readOnly = true;
        document.getElementById('client-phone1').readOnly = true;
        
    } else {
        // Se selecionar "-- Selecione --", limpa e reativa os campos
        resetDeliveryForm();
    }
}

/**
 * Limpa o formulário de entrega e reativa os campos.
 */
function resetDeliveryForm() {
    document.getElementById('delivery-form').reset();
    document.getElementById('delivery-client-id').value = ''; 
    
    document.getElementById('client-name').readOnly = false;
    document.getElementById('client-phone1').readOnly = false;

    ['pickup-lat', 'pickup-lng', 'delivery-lat', 'delivery-lng', 'route-distance-km', 'route-duration-min', 'delivery-fee', 'final-order-price'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    if (window.TragoGeoPricing) window.TragoGeoPricing.resetDeliveryPricing();
}

/**
 * Callback para a zona de perigo (Apagar Histórico).
 */
function handleDeleteOldHistoryClick() {
    const confirmWord = 'APAGAR';
    
    openConfirmationModal({ // (adminModals.js)
        title: "Apagar Histórico Antigo?",
        message: `Esta ação é irreversível. Todas as encomendas concluídas com mais de 30 dias serão permanentemente apagadas.\n\nPara confirmar, digite <b>${confirmWord}</b> no campo abaixo.`,
        confirmText: confirmWord,
        onConfirm: handleDeleteOldHistory // (adminApi.js)
    });
}

function applyDriverTypeCommissionLock(typeSelectId, commissionInputId) {
    const typeEl = document.getElementById(typeSelectId);
    const commissionEl = document.getElementById(commissionInputId);
    if (!typeEl || !commissionEl) return;
    if (typeEl.value === 'official') {
        commissionEl.value = '0';
        commissionEl.disabled = true;
    } else {
        commissionEl.disabled = false;
        if (!commissionEl.value || Number(commissionEl.value) === 0) commissionEl.value = '20';
    }
}

let lastAdminPaymentAlertAt = 0;
async function checkAdminPaymentPendingAlerts(force = false) {
    try {
        const response = await fetch(`${API_URL}/api/orders/payment-pending`, { headers: getAuthHeaders('admin') });
        if (!response.ok) return;
        const data = await readJsonResponse(response);
        const total = Number(data.total || 0);
        const now = Date.now();
        if (total > 0 && (force || now - lastAdminPaymentAlertAt > 120000)) {
            lastAdminPaymentAlertAt = now;
            showCustomAlert('Pagamentos por confirmar', `${total} entrega(s) aguardam confirmação de pagamento/finalização.`, 'info');
        }
    } catch (error) {
        console.warn('Falha ao verificar pagamentos pendentes:', error);
    }
}
setInterval(() => checkAdminPaymentPendingAlerts(false), 120000);



function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

let adminNotifications = [];
let adminNotificationsPanelOpen = false;
let adminNotificationsLoading = false;

function initAdminNotificationCenter() {
    renderAdminNotifications();

    const toggle = document.getElementById('notifications-toggle');
    const panel = document.getElementById('notifications-panel');
    const markAllBtn = document.getElementById('mark-all-notifications-read');

    if (toggle && panel) {
        toggle.addEventListener('click', async (event) => {
            event.preventDefault();
            event.stopPropagation();
            adminNotificationsPanelOpen = !adminNotificationsPanelOpen;
            panel.classList.toggle('hidden', !adminNotificationsPanelOpen);
            toggle.setAttribute('aria-expanded', adminNotificationsPanelOpen ? 'true' : 'false');
            if (adminNotificationsPanelOpen) await refreshAdminNotifications();
        });
    }

    if (markAllBtn) {
        markAllBtn.addEventListener('click', async (event) => {
            event.preventDefault();
            await markAllAdminNotificationsAsRead();
        });
    }

    document.addEventListener('click', (event) => {
        if (!adminNotificationsPanelOpen) return;
        const shell = document.querySelector('.notifications-shell');
        if (shell && shell.contains(event.target)) return;
        adminNotificationsPanelOpen = false;
        panel?.classList.add('hidden');
        toggle?.setAttribute('aria-expanded', 'false');
    });

    refreshAdminNotifications();
    setInterval(refreshAdminNotifications, 60000);
}

async function refreshAdminNotifications() {
    const token = getAuthToken('admin');
    if (!token || adminNotificationsLoading) return;

    adminNotificationsLoading = true;
    try {
        const response = await fetch(`${API_URL}/api/notifications?limit=80`, {
            headers: getAuthHeaders('admin')
        });

        if (response.status === 401) { await handle401Safely('admin'); return; }
        const data = await readJsonResponse(response);
        if (!response.ok) throw new Error(data.message || 'Falha ao carregar notificações.');

        adminNotifications = Array.isArray(data.notifications) ? data.notifications : [];
        renderAdminNotifications();
    } catch (error) {
        console.warn('Falha ao atualizar notificações persistidas:', error.message || error);
        renderAdminNotifications(true);
    } finally {
        adminNotificationsLoading = false;
    }
}

function addAdminNotification(_notification) {
    // As notificações agora são persistidas na base de dados pela Edge Function.
    // Este método fica como compatibilidade para os eventos Realtime antigos.
    refreshAdminNotifications();
}

async function markAdminNotificationAsRead(id) {
    if (!id) return;
    const previous = [...adminNotifications];
    adminNotifications = adminNotifications.filter((item) => String(item.id || item._id) !== String(id));
    renderAdminNotifications();

    try {
        const response = await fetch(`${API_URL}/api/notifications/${encodeURIComponent(id)}/read`, {
            method: 'POST',
            headers: getAuthHeaders('admin')
        });
        const data = await readJsonResponse(response);
        if (!response.ok) throw new Error(data.message || 'Falha ao marcar notificação como lida.');
        await refreshAdminNotifications();
    } catch (error) {
        console.warn('Falha ao marcar notificação como lida:', error.message || error);
        adminNotifications = previous;
        renderAdminNotifications();
        showCustomAlert('Erro', error.message || 'Não foi possível marcar a notificação como lida.', 'error');
    }
}

async function markAllAdminNotificationsAsRead() {
    if (!adminNotifications.length) return;
    const previous = [...adminNotifications];
    adminNotifications = [];
    renderAdminNotifications();

    try {
        const response = await fetch(`${API_URL}/api/notifications/mark-all-read`, {
            method: 'POST',
            headers: getAuthHeaders('admin')
        });
        const data = await readJsonResponse(response);
        if (!response.ok) throw new Error(data.message || 'Falha ao marcar notificações como lidas.');
        await refreshAdminNotifications();
    } catch (error) {
        console.warn('Falha ao marcar todas as notificações como lidas:', error.message || error);
        adminNotifications = previous;
        renderAdminNotifications();
        showCustomAlert('Erro', error.message || 'Não foi possível marcar todas como lidas.', 'error');
    }
}

function renderAdminNotifications(hasLoadError = false) {
    const list = document.getElementById('notifications-list');
    const badge = document.getElementById('notifications-count');
    if (!list || !badge) return;

    const unread = adminNotifications.filter((item) => !item.readAt && !item.read_at);
    badge.textContent = String(unread.length);
    badge.classList.toggle('hidden', unread.length === 0);

    if (hasLoadError && !unread.length) {
        list.innerHTML = '<div class="notification-empty">Erro ao carregar notificações.</div>';
        return;
    }

    if (!unread.length) {
        list.innerHTML = '<div class="notification-empty">Sem notificações por ler.</div>';
        return;
    }

    list.innerHTML = unread.map((item) => {
        const id = String(item.id || item._id || '').replace(/[^a-zA-Z0-9_:-]/g, '');
        const date = new Date(item.createdAt || item.created_at || Date.now());
        const time = Number.isNaN(date.getTime()) ? '' : date.toLocaleString('pt-MZ', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        const type = item.type || 'info';
        const icon = type === 'payment' ? 'fa-money-check-alt' : type === 'order' ? 'fa-box' : type === 'success' ? 'fa-check-circle' : 'fa-bell';
        const orderCode = escapeHtml(item.orderCode || item.order_code || '');
        const verificationCode = escapeHtml(item.verificationCode || item.verification_code || '');
        const meta = orderCode || verificationCode
            ? `<div class="notification-meta">
                    ${orderCode ? `<span><strong>Código do pedido:</strong> ${orderCode}</span>` : ''}
                    ${verificationCode ? `<span><strong>Código de verificação:</strong> ${verificationCode}</span>` : ''}
               </div>`
            : '';
        return `
            <div class="notification-item notification-${escapeHtml(type)}">
                <div class="notification-icon"><i class="fas ${icon}"></i></div>
                <div class="notification-content">
                    <strong>${escapeHtml(item.title || 'Notificação')}</strong>
                    ${meta}
                    <p>${escapeHtml(item.message || '')}</p>
                    <small>${time}</small>
                </div>
                <button type="button" class="btn-link-small notification-read-btn" onclick="markAdminNotificationAsRead('${id}')">Marcar como lida</button>
            </div>
        `;
    }).join('');
}

async function refreshAdminNotificationSources() {
    await refreshAdminNotifications();
}

/**
 * Carrega o perfil do administrador logado.
 */
async function loadAdminProfile() {
    try {
        const response = await fetch(`${API_URL}/api/auth/me`, {
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeaders('admin')
            }
        });

        if (!response.ok) {
            throw new Error('Sessão inválida');
        }

        const data = await readJsonResponse(response);

        const adminNameEl = document.getElementById('admin-name');
        if (adminNameEl) {
            adminNameEl.textContent = data.nome;
        }
        const adminNameHeaderEl = document.getElementById('admin-name-header');
        if (adminNameHeaderEl) {
            adminNameHeaderEl.textContent = data.nome;
        }

    } catch (error) {
        console.error('Erro ao carregar perfil do admin:', error);
        await handle401Safely('admin');
    }
}

/**
 * Converte tabelas tradicionais em cartões legíveis no mobile.
 * A função mantém o layout desktop intacto e apenas injeta data-label nos TDs,
 * permitindo ao CSS mostrar cada linha como um cartão em ecrãs pequenos.
 */
function enhanceResponsiveTable(table) {
    if (!table) return;

    const headers = Array.from(table.querySelectorAll('thead th')).map(th => th.textContent.trim());
    if (!headers.length) return;

    table.querySelectorAll('tbody tr').forEach(row => {
        Array.from(row.children).forEach((cell, index) => {
            if (cell.tagName !== 'TD') return;
            if (cell.hasAttribute('colspan')) return;
            cell.setAttribute('data-label', headers[index] || '');
        });
    });
}

function enhanceAllResponsiveTables(root = document) {
    root.querySelectorAll('table').forEach(enhanceResponsiveTable);
}

function installResponsiveTableObserver() {
    enhanceAllResponsiveTables();

    const target = document.querySelector('.content-area') || document.body;
    let scheduled = false;

    const observer = new MutationObserver(() => {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => {
            enhanceAllResponsiveTables(target);
            scheduled = false;
        });
    });

    observer.observe(target, {
        childList: true,
        subtree: true
    });
}
