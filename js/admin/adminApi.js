/*
 * Ficheiro: js/admin/adminApi.js (NOVO)
 *
 * Contém toda a lógica de API (fetch) para o painel de admin.
 * (Movido de admin.js)
 * 
 * CORREÇÃO: Todas as chamadas getAuthHeaders() agora têm o parâmetro 'admin'
 */

/* --- Lógica de API (Carregamento de Dados - GET) --- */


const PAYMENT_METHOD_LABELS = {
    cash: 'Dinheiro',
    mpesa: 'M-Pesa',
    emola: 'e-Mola',
    mkesh: 'mKesh',
    bank_transfer: 'Transferência Bancária',
    pos: 'POS',
    postpaid_credit: 'Cliente Pós-pago / Crédito'
};

const ORDER_STATUS_LABELS = {
    pendente: 'Pendente',
    atribuido: 'Atribuído',
    em_progresso: 'Em progresso',
    recolha_em_progresso: 'Em recolha',
    recolha_concluida: 'Recolha concluída',
    entrega_em_progresso: 'Em entrega',
    concluido: 'Concluído',
    cancelado: 'Cancelado'
};

function getPaymentMethodLabel(method) {
    return PAYMENT_METHOD_LABELS[method] || method || '—';
}

function getOrderStatusLabel(status) {
    return ORDER_STATUS_LABELS[status] || String(status || 'N/D').replace(/_/g, ' ');
}

let adminPartnerCache = [];

const ADMIN_PARTNER_STATUS_LABELS = {
    pending: 'Pendente',
    active: 'Activo',
    inactive: 'Inactivo',
    rejected: 'Rejeitado'
};

function updateAdminPartnerBadge(count = 0) {
    const badge = document.getElementById('admin-partner-nav-badge');
    if (!badge) return;
    const value = Math.max(0, Number(count || 0));
    badge.textContent = String(value);
    badge.hidden = value === 0;
}

async function loadAdminPartnerBadge() {
    try {
        const response = await fetch(`${API_URL}/api/admin/partners?status=pending`, { headers: getAuthHeaders('admin') });
        const data = await readJsonResponse(response);
        if (!response.ok) throw new Error(data.message || 'Falha ao carregar candidaturas.');
        updateAdminPartnerBadge(Number(data.pendingCount ?? data.partners?.length ?? 0));
    } catch (_error) {
        updateAdminPartnerBadge(0);
    }
}

function renderAdminPartners() {
    const tbody = document.getElementById('admin-partners-table-body');
    if (!tbody) return;
    const filter = document.getElementById('admin-partner-status-filter')?.value || '';
    const visible = filter ? adminPartnerCache.filter((partner) => partner.status === filter) : adminPartnerCache;
    const pending = adminPartnerCache.filter((partner) => partner.status === 'pending').length;
    const active = adminPartnerCache.filter((partner) => partner.status === 'active' && partner.is_available !== false).length;
    const unavailable = adminPartnerCache.filter((partner) => partner.status !== 'active' || partner.is_available === false).length;
    const metrics = {
        'partner-metric-pending': pending,
        'partner-metric-active': active,
        'partner-metric-unavailable': unavailable,
        'partner-metric-total': adminPartnerCache.length
    };
    Object.entries(metrics).forEach(([id, value]) => {
        const element = document.getElementById(id);
        if (element) element.textContent = String(value);
    });
    updateAdminPartnerBadge(pending);
    if (!visible.length) {
        tbody.innerHTML = '<tr><td class="admin-partners-empty" colspan="6"><i class="fas fa-store"></i>Nenhum parceiro encontrado neste estado.</td></tr>';
        return;
    }
    tbody.innerHTML = visible.map((partner) => {
        const id = String(partner.id || partner._id || '');
        const status = String(partner.status || 'pending');
        const statusLabel = ADMIN_PARTNER_STATUS_LABELS[status] || status;
        const createdAt = partner.createdAt || partner.created_at;
        const date = createdAt ? new Date(createdAt).toLocaleString('pt-MZ') : '—';
        const actions = status === 'pending'
            ? `<button type="button" class="approve" data-partner-action="approve" data-partner-id="${escapeHtml(id)}"><i class="fas fa-check"></i> Aprovar</button>
               <button type="button" class="reject" data-partner-action="reject" data-partner-id="${escapeHtml(id)}"><i class="fas fa-xmark"></i> Rejeitar</button>`
            : status === 'active'
                ? `<button type="button" class="pause" data-partner-action="pause" data-partner-id="${escapeHtml(id)}"><i class="fas fa-pause"></i> Inactivar</button>`
                : `<button type="button" class="approve" data-partner-action="activate" data-partner-id="${escapeHtml(id)}"><i class="fas fa-rotate-left"></i> Activar</button>`;
        return `<tr>
            <td><div class="admin-partner-identity"><i class="fas fa-store"></i><span><strong>${escapeHtml(partner.name || 'Parceiro')}</strong><small>${escapeHtml(String(partner.partner_type || 'other').replace(/_/g, ' '))} · ${escapeHtml(partner.products_summary || 'Sem descrição')}</small></span></div></td>
            <td><div class="admin-partner-contact"><strong>${escapeHtml(partner.phone || partner.whatsapp || 'Sem contacto')}</strong><small>${escapeHtml(partner.address_text || 'Localização não informada')}</small></div></td>
            <td><span class="admin-partner-status ${escapeHtml(status)}"><i class="fas fa-circle"></i>${escapeHtml(statusLabel)}</span>${partner.status_reason ? `<small class="admin-partner-reason">${escapeHtml(partner.status_reason)}</small>` : ''}</td>
            <td><label class="admin-partner-map-toggle"><input type="checkbox" data-partner-availability="${escapeHtml(id)}" ${status === 'active' && partner.is_available !== false ? 'checked' : ''} ${status !== 'active' ? 'disabled' : ''}><span>${status === 'active' && partner.is_available !== false ? 'Visível' : 'Oculto'}</span></label></td>
            <td><small>${escapeHtml(date)}</small><br><small>${partner.source === 'application' ? 'Candidatura de cliente' : escapeHtml(partner.source || 'Admin')}</small></td>
            <td><div class="admin-partner-actions">${actions}<button type="button" class="delete" data-partner-action="delete" data-partner-id="${escapeHtml(id)}" data-partner-name="${escapeHtml(partner.name || 'Parceiro')}"><i class="fas fa-trash"></i></button></div></td>
        </tr>`;
    }).join('');
}

async function loadAdminPartners() {
    const tbody = document.getElementById('admin-partners-table-body');
    if (tbody) tbody.innerHTML = '<tr><td colspan="6"><i class="fas fa-spinner fa-spin"></i> A carregar parceiros…</td></tr>';
    try {
        const response = await fetch(`${API_URL}/api/admin/partners`, { headers: getAuthHeaders('admin') });
        const data = await readJsonResponse(response);
        if (!response.ok) throw new Error(data.message || 'Falha ao carregar parceiros.');
        adminPartnerCache = Array.isArray(data.partners) ? data.partners : [];
        renderAdminPartners();
    } catch (error) {
        if (tbody) tbody.innerHTML = `<tr><td class="admin-partners-empty" colspan="6"><i class="fas fa-triangle-exclamation"></i>${escapeHtml(error.message || 'Erro ao carregar parceiros.')}</td></tr>`;
    }
}

async function updateAdminPartner(partnerId, patch) {
    const response = await fetch(`${API_URL}/api/admin/partners/${encodeURIComponent(partnerId)}`, {
        method: 'PATCH',
        headers: { ...getAuthHeaders('admin'), 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
    });
    const data = await readJsonResponse(response);
    if (!response.ok) throw new Error(data.message || 'Falha ao actualizar parceiro.');
    await loadAdminPartners();
    return data;
}

async function handleAdminPartnerAction(partnerId, action, partnerName = 'Parceiro') {
    if (!partnerId) return;
    if (action === 'delete') {
        const confirmed = window.TragoFeedback
            ? await window.TragoFeedback.confirm({
                type: 'warning',
                title: 'Eliminar parceiro?',
                message: `${partnerName} será removido definitivamente do directório e dos mapas.`,
                confirmText: 'Eliminar',
                cancelText: 'Manter'
            })
            : false;
        if (!confirmed) return;
        const response = await fetch(`${API_URL}/api/admin/partners/${encodeURIComponent(partnerId)}`, {
            method: 'DELETE',
            headers: getAuthHeaders('admin')
        });
        const data = await readJsonResponse(response);
        if (!response.ok) throw new Error(data.message || 'Falha ao eliminar parceiro.');
        showCustomAlert('Parceiro eliminado', data.message || 'O parceiro foi eliminado.', 'success');
        await loadAdminPartners();
        return;
    }
    const patches = {
        approve: { status: 'active', is_available: true, status_reason: '' },
        activate: { status: 'active', is_available: true, status_reason: '' },
        pause: { status: 'inactive', is_available: false, status_reason: 'Temporariamente inactivo pela Administração.' },
        reject: { status: 'rejected', is_available: false, status_reason: 'A candidatura não cumpriu os critérios de validação da TraGo.' }
    };
    const patch = patches[action];
    if (!patch) return;
    if (action === 'reject') {
        const confirmed = window.TragoFeedback
            ? await window.TragoFeedback.confirm({
                type: 'warning',
                title: 'Rejeitar candidatura?',
                message: 'O cliente será informado de que o estabelecimento não cumpriu os critérios de validação.',
                confirmText: 'Rejeitar',
                cancelText: 'Voltar'
            })
            : false;
        if (!confirmed) return;
    }
    const data = await updateAdminPartner(partnerId, patch);
    showCustomAlert('Parceiro actualizado', data.message || 'Alteração guardada.', 'success');
}


async function loadOverviewStats() {
    try {
        const response = await fetch(`${API_URL}/api/stats/overview`, { headers: getAuthHeaders('admin') });
        if (response.status === 401) {
            await handle401Safely('admin');
            return;
        }
        const data = await readJsonResponse(response);
        if (!response.ok) throw new Error(data.message);
        document.getElementById('stats-pendentes').innerText = data.pendentes;
        document.getElementById('stats-em-transito').innerText = data.emTransito;
        document.getElementById('stats-concluidas-hoje').innerText = data.concluidasHoje;
        document.getElementById('stats-motoristas-online').innerText = data.motoristasOnline;
        initDeliveriesStatusChart(data.pendentes, data.emTransito);
    } catch (error) { 
        console.error('Falha ao carregar estatísticas:', error); 
        initDeliveriesStatusChart(0, 0);
    }
}

async function loadFinancialStats(period = 'month') {
    const formatMZN = (value) => new Intl.NumberFormat('pt-MZ', { style: 'currency', currency: 'MZN' }).format(value || 0);
    const periodLabels = { day: 'Hoje', week: 'Esta Semana', month: 'Este Mês' };
    const safePeriod = ['day', 'week', 'month'].includes(period) ? period : 'month';
    try {
        const response = await fetch(`${API_URL}/api/stats/financials?period=${encodeURIComponent(safePeriod)}`, { headers: getAuthHeaders('admin') });
        const data = await readJsonResponse(response);
        if (!response.ok) throw new Error(data.message);
        const label = data.period?.label || periodLabels[safePeriod];
        const titleEl = document.getElementById('financial-section-title');
        const chartTitleEl = document.getElementById('financial-chart-title');
        if (titleEl) titleEl.innerText = `Financeiro — ${label}`;
        if (chartTitleEl) chartTitleEl.innerText = `Divisão da Receita — ${label}`;
        
        document.getElementById('stats-receita-total').innerText = formatMZN(data.totalReceita);
        document.getElementById('stats-lucro-empresa').innerText = formatMZN(data.totalLucroEmpresa);
        document.getElementById('stats-ganhos-motorista').innerText = formatMZN(data.totalGanhosMotorista);
        
        const topDriverEl = document.getElementById('stats-top-driver');
        if (data.topDriver && data.topDriver.nome !== 'N/A') {
            topDriverEl.innerHTML = `${data.topDriver.nome} <br><small class="metric-muted">${formatMZN(data.topDriver.totalGanhos)}</small>`;
        } else {
            topDriverEl.innerText = 'N/A';
        }
        initFinancialPieChart(data.totalLucroEmpresa, data.totalGanhosMotorista);
    } catch (error) { 
        console.error('Falha ao carregar estatísticas financeiras:', error); 
        document.getElementById('stats-receita-total').innerText = formatMZN(0);
        document.getElementById('stats-lucro-empresa').innerText = formatMZN(0);
        document.getElementById('stats-ganhos-motorista').innerText = formatMZN(0);
        document.getElementById('stats-top-driver').innerText = 'Erro';
        initFinancialPieChart(0, 0);
    }
}

async function loadCostsDashboardSummary() {
    const formatMZN = (value) => new Intl.NumberFormat('pt-MZ', { style: 'currency', currency: 'MZN' }).format(value);

    const despesasEl = document.getElementById('stats-despesas-mes');
    const saldoEl = document.getElementById('stats-saldo-mes');
    const tableBody = document.getElementById('costs-latest-table-body');

    // Se a secção não existir (versão antiga do HTML), sai silenciosamente
    if (!despesasEl || !saldoEl) return;

    despesasEl.innerText = '.';
    saldoEl.innerText = '.';
    if (tableBody) {
        tableBody.innerHTML = '<tr><td colspan="5">A carregar.</td></tr>';
    }

    try {
        const response = await fetch(`${API_URL}/api/costs/dashboard-summary?months=6`, {
            headers: getAuthHeaders('admin')
        });

        if (response.status === 401) {
            await handle401Safely('admin');
            return;
        }

        const data = await readJsonResponse(response);
        if (!response.ok) throw new Error(data.message);

        const current = data.currentMonth || { totalCosts: 0, costsByCategory: {} };
        const history = data.history || { labels: [], revenue: [], costs: [] };

        // Card: despesas do mês
        despesasEl.innerText = formatMZN(current.totalCosts || 0);

        // Card: saldo = receita (mês atual) - despesas (mês atual)
        let saldo = 0;
        if (Array.isArray(history.labels) && history.labels.length > 0) {
            const lastIndex = history.labels.length - 1;
            const receitaMesAtual = history.revenue[lastIndex] || 0;
            saldo = receitaMesAtual - (current.totalCosts || 0);
        }
        saldoEl.innerText = formatMZN(saldo);

        // Gráfico: despesas por categoria
        initCostsByCategoryChart(current.costsByCategory || {});

        // Gráfico: receita vs custos (histórico)
        initRevenueVsCostsChart(history.labels || [], history.revenue || [], history.costs || []);

        // Tabela: últimos custos registados (por mês atual, se possível)
        if (tableBody) {
            let monthParam = null;
            if (current.label && current.label.includes('/')) {
                const [mm, yyyy] = current.label.split('/');
                monthParam = `${yyyy}-${mm}`; // ex: "2025-11"
            }
            await loadLatestCosts(tableBody, monthParam);
        }

    } catch (error) {
        console.error('Falha ao carregar resumo de custos:', error);
        despesasEl.innerText = formatMZN(0);
        saldoEl.innerText = formatMZN(0);
        if (tableBody) {
            tableBody.innerHTML = '<tr><td colspan="5">Erro ao carregar custos.</td></tr>';
        }
        initCostsByCategoryChart({});
        initRevenueVsCostsChart([], [], []);
    }
}

function initCostsByCategoryChart(costsByCategory) {
    const canvas = document.getElementById('costsByCategoryChart');
    if (!canvas || typeof Chart === 'undefined') return;

    if (costsByCategoryChart) {
        costsByCategoryChart.destroy();
        costsByCategoryChart = null;
    }
    if (typeof destroyChartByCanvasId === 'function') {
        destroyChartByCanvasId('costsByCategoryChart');
    }

    const keys = Object.keys(COST_CATEGORY_LABELS);
    const labels = keys.map(k => COST_CATEGORY_LABELS[k]);
    const values = keys.map(k => (costsByCategory && typeof costsByCategory[k] === 'number') ? costsByCategory[k] : 0);

    costsByCategoryChart = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Despesas (MZN)',
                data: values,
                backgroundColor: 'rgba(246, 162, 38, 0.82)',
                borderColor: '#B76D13',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            resizeDelay: 180,
            animation: false,
            layout: { padding: { top: 2, right: 2, bottom: 0, left: 2 } },
            plugins: {
                legend: typeof getChartLegendOptions === 'function' ? getChartLegendOptions() : { display: false }
            },
            scales: {
                y: { 
                    beginAtZero: true,
                    ticks: { font: { size: 10, family: 'Outfit, system-ui, sans-serif' } }
                },
                x: {
                    ticks: { font: { size: 10, family: 'Outfit, system-ui, sans-serif' }, maxRotation: 24, minRotation: 0 }
                }
            }
        }
    });
}

function initRevenueVsCostsChart(labels, revenueData, costsData) {
    const canvas = document.getElementById('revenueVsCostsChart');
    if (!canvas || typeof Chart === 'undefined') return;

    if (revenueVsCostsChart) {
        revenueVsCostsChart.destroy();
        revenueVsCostsChart = null;
    }
    if (typeof destroyChartByCanvasId === 'function') {
        destroyChartByCanvasId('revenueVsCostsChart');
    }

    const safeLabels = Array.isArray(labels) ? labels : [];
    const safeRevenue = Array.isArray(revenueData) ? revenueData : [];
    const safeCosts = Array.isArray(costsData) ? costsData : [];

    revenueVsCostsChart = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels: safeLabels,
            datasets: [
                {
                    label: 'Receita (MZN)',
                    data: safeRevenue,
                    borderColor: '#8DC543',
                    backgroundColor: 'rgba(141, 197, 67, 0.12)',
                    pointRadius: 3,
                    tension: 0.3
                },
                {
                    label: 'Custos (MZN)',
                    data: safeCosts,
                    borderColor: '#B76D13',
                    backgroundColor: 'rgba(246, 162, 38, 0.12)',
                    pointRadius: 3,
                    tension: 0.3
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            resizeDelay: 180,
            animation: false,
            layout: { padding: { top: 2, right: 2, bottom: 0, left: 2 } },
            plugins: {
                legend: typeof getChartLegendOptions === 'function' ? getChartLegendOptions() : { position: 'bottom' }
            },
            scales: {
                y: { 
                    beginAtZero: true,
                    ticks: { font: { size: 10, family: 'Outfit, system-ui, sans-serif' } }
                },
                x: {
                    ticks: { font: { size: 10, family: 'Outfit, system-ui, sans-serif' }, maxRotation: 24, minRotation: 0 }
                }
            }
        }
    });
}
async function loadCostAssignmentOptions() {
    const select = document.getElementById('cost-assigned-entity');
    if (!select) return;

    select.innerHTML = '<option value="">-- Não atribuir --</option>';

    try {
        // Busca motoristas
        const driversResp = await fetch(`${API_URL}/api/drivers`, {
            headers: getAuthHeaders('admin')
        });
        if (driversResp.status === 401) { await handle401Safely('admin'); return; }
        const driversData = await readJsonResponse(driversResp);

        // Busca clientes
        const clientsResp = await fetch(`${API_URL}/api/clients`, {
            headers: getAuthHeaders('admin')
        });
        if (clientsResp.status === 401) { await handle401Safely('admin'); return; }
        const clientsData = await readJsonResponse(clientsResp);

        // Funcionários (motoristas)
        if (driversData.drivers && driversData.drivers.length > 0) {
            const optGroupStaff = document.createElement('optgroup');
            optGroupStaff.label = 'Funcionários (Motoristas)';

            driversData.drivers.forEach((d) => {
                const opt = document.createElement('option');
                opt.value = `driver:${d._id}`;
                opt.textContent = d.nome ? d.nome : d.name || 'Motorista';
                optGroupStaff.appendChild(opt);
            });

            select.appendChild(optGroupStaff);
        }

        // Veículos
        try {
            const vehiclesResp = await fetch(`${API_URL}/api/vehicles`, { headers: getAuthHeaders('admin') });
            if (vehiclesResp.ok) {
                const vehiclesData = await readJsonResponse(vehiclesResp);
                if (vehiclesData.vehicles && vehiclesData.vehicles.length > 0) {
                    const optGroupVehicles = document.createElement('optgroup');
                    optGroupVehicles.label = 'Veículos / Matrículas';
                    vehiclesData.vehicles.forEach((v) => {
                        const opt = document.createElement('option');
                        opt.value = `vehicle:${v._id}`;
                        opt.textContent = `${v.plate || 'Sem matrícula'}${v.type ? ` · ${v.type}` : ''}`;
                        optGroupVehicles.appendChild(opt);
                    });
                    select.appendChild(optGroupVehicles);
                }
            }
        } catch (vehicleError) {
            console.warn('Falha ao carregar veículos para custos:', vehicleError);
        }

        // Clientes
        if (clientsData.clients && clientsData.clients.length > 0) {
            const optGroupClients = document.createElement('optgroup');
            optGroupClients.label = 'Clientes';

            clientsData.clients.forEach((c) => {
                const opt = document.createElement('option');
                opt.value = `client:${c._id}`;
                opt.textContent = c.nome || c.name || 'Cliente';
                optGroupClients.appendChild(opt);
            });

            select.appendChild(optGroupClients);
        }
    } catch (error) {
        console.error('Falha ao carregar lista de funcionários/clientes para custos:', error);
        // em caso de erro, mantemos só o "Não atribuir"
    }
}


async function loadLatestCosts(tableBody, monthParam) {
    try {
        const params = new URLSearchParams();
        params.set('limit', '10');
        if (monthParam) {
            params.set('month', monthParam);
        }

        const response = await fetch(`${API_URL}/api/costs?${params.toString()}`, {
            headers: getAuthHeaders('admin')
        });

        if (response.status === 401) { await handle401Safely('admin'); return; }

        const data = await readJsonResponse(response);
        if (!response.ok) throw new Error(data.message);

        const formatMZN = (value) =>
            new Intl.NumberFormat('pt-MZ', { style: 'currency', currency: 'MZN' }).format(value);

        const catLabel = (cat) => COST_CATEGORY_LABELS[cat] || cat || '';

        tableBody.innerHTML = '';
        if (!data.costs || data.costs.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="5">Sem registos de custos.</td></tr>';
            return;
        }

        data.costs.forEach((cost) => {
            const dateStr = cost.date
                ? new Date(cost.date).toLocaleDateString('pt-MZ')
                : '';

            let assignedStr = '';

            if (cost.assignedUser && cost.assignedUser.nome) {
                assignedStr = `Funcionário: ${cost.assignedUser.nome}`;
            } else if (cost.assignedClient && cost.assignedClient.nome) {
                assignedStr = `Cliente: ${cost.assignedClient.nome}`;
            } else if (cost.assignedVehicle && cost.assignedVehicle.plate) {
                assignedStr = `Veículo: ${cost.assignedVehicle.plate}`;
            } else {
                assignedStr = '-';
            }

            tableBody.innerHTML += `
                <tr>
                    <td>${dateStr}</td>
                    <td>${catLabel(cost.category)}</td>
                    <td>${assignedStr}</td>
                    <td>${cost.description || ''}</td>
                    <td>${formatMZN(cost.amount || 0)}</td>
                </tr>
            `;
        });
    } catch (error) {
        console.error('Falha ao carregar custos:', error);
        tableBody.innerHTML = '<tr><td colspan="5">Erro ao carregar custos.</td></tr>';
    }
}

async function loadDrivers() {
    const tableBody = document.getElementById('drivers-table-body');
    tableBody.innerHTML = '<tr><td colspan="6">A carregar...</td></tr>';
    try {
        const response = await fetch(`${API_URL}/api/drivers`, { method: 'GET', headers: getAuthHeaders('admin') });
        if (response.status === 401) { await handle401Safely('admin'); return; }
        const data = await readJsonResponse(response);
        if (!response.ok) throw new Error(data.message);
        tableBody.innerHTML = '';
        if (data.drivers.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="6">Nenhum motorista registado.</td></tr>';
            return;
        }
        data.drivers.forEach(driver => {
            const profile = driver.profile || { vehicle_plate: '(N/D)', status: 'offline', driverType: 'freelancer' };
            const statusClass = `status-${String(profile.status || 'offline').replace('_', '-')}`;
            const statusText = String(profile.status || 'offline').replace('_', ' ');
            const driverType = profile.driverType || profile.driver_type || 'freelancer';
            const typeLabel = driverType === 'official' ? 'Oficial Trago' : 'Freelancer';
            const vehicleLabel = profile.vehicle?.plate || profile.vehicle_plate || '(N/D)';
            tableBody.innerHTML += `
                <tr>
                    <td>${driver.nome}</td>
                    <td>${driver.telefone}</td>
                    <td>${vehicleLabel}</td>
                    <td>${typeLabel}</td>
                    <td><span class="status ${statusClass}">${statusText}</span></td>
                    <td>
                        <button class="btn-action btn-action-small" onclick="openEditDriverModal('${driver._id}')" title="Editar"><i class="fas fa-edit"></i></button>
                        <button class="btn-action-small btn-action-report" onclick="openDriverReportModal('${driver._id}', '${driver.nome}')" title="Ver Relatório"><i class="fas fa-chart-bar"></i></button>
                    </td>
                </tr>
            `;
        });
    } catch (error) { 
        console.error('Falha ao carregar motoristas:', error); 
        tableBody.innerHTML = '<tr><td colspan="6">Erro ao carregar motoristas.</td></tr>';
    }
}

async function loadActiveDeliveries() {
    const tableBody = document.getElementById('active-orders-table-body');
    tableBody.innerHTML = '<tr><td colspan="7">A carregar...</td></tr>';
    try {
        const response = await fetch(`${API_URL}/api/orders/active`, { headers: getAuthHeaders('admin') });
        if (response.status === 401) { await handle401Safely('admin'); return; }
        const data = await readJsonResponse(response);
        if (!response.ok) throw new Error(data.message);
        tableBody.innerHTML = '';
        if (data.orders.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="7">Nenhuma encomenda ativa.</td></tr>';
            return;
        }
        data.orders.forEach(order => {
            const motoristaNome = order.assigned_to_driver ? order.assigned_to_driver.user.nome : 'N/D';
            const statusClass = `status-${order.status.replace('_', '-')}`;
            
            let acaoBotao = '';
            if (order.status === 'pendente') {
                acaoBotao = `<button class="btn-action-assign" onclick="openAssignModal('${order._id}')">Atribuir</button>`;
            } else if (order.status === 'atribuido') {
                acaoBotao = `<button class="btn-action-small btn-action-report" onclick="openAssignModal('${order._id}')" title="Reatribuir">
                                <i class="fas fa-exchange-alt"></i> Reatribuir
                             </button>`;
            } else { // em_progresso
                acaoBotao = 'Em Curso';
            }
            acaoBotao += ` <button class="btn-action-small" onclick="openHistoryDetailModal('${order._id}')" title="Detalhes e conversa"><i class="fas fa-comments"></i></button>`;

            tableBody.innerHTML += `
                <tr>
                    <td>#${order._id.slice(-6)}</td>
                    <td>${order.client_name}</td>
                    <td>${order.client_phone1}</td>
                    <td><span class="status ${statusClass}">${getOrderStatusLabel(order.status)}</span></td>
                    <td>${motoristaNome}</td>
                    <td class="verification-code">${order.verification_code}</td> 
                    <td>${acaoBotao}</td>
                </tr>
            `;
        });
    } catch (error) { 
        console.error('Falha ao carregar encomendas ativas:', error); 
        tableBody.innerHTML = '<tr><td colspan="7">Erro ao carregar encomendas.</td></tr>';
    }
}

async function loadHistory() {
    const tableBody = document.getElementById('history-orders-table-body');
    const periodSelect = document.getElementById('history-period-select');
    const period = ['day', 'week', 'month'].includes(periodSelect?.value) ? periodSelect.value : 'month';
    tableBody.innerHTML = '<tr><td colspan="8">A carregar.</td></tr>';
    try {
        const response = await fetch(`${API_URL}/api/orders/history?period=${encodeURIComponent(period)}`, { headers: getAuthHeaders('admin') });
        if (response.status === 401) { await handle401Safely('admin'); return; }
        const data = await readJsonResponse(response);
        if (!response.ok) throw new Error(data.message);

        tableBody.innerHTML = '';
        if (!data.orders || data.orders.length === 0) {
            const label = data.period?.label || (period === 'day' ? 'hoje' : period === 'week' ? 'esta semana' : 'este mês');
            tableBody.innerHTML = `<tr><td colspan="8">Nenhum histórico encontrado para ${label}.</td></tr>`;
            return;
        }

        data.orders.forEach(order => {
            const motoristaNome = order.assigned_to_driver ? order.assigned_to_driver.user.nome : 'N/D';
            const serviceName = SERVICE_NAMES[order.service_type] || order.service_type;

            let duracaoHtml = '';
            if (typeof getPhaseDurations === 'function') {
                const phases = getPhaseDurations(order);
                duracaoHtml =
                    '<div><strong>C → R:</strong> ' + phases.pickupLabel + '</div>' +
                    '<div><strong>R → E:</strong> ' + phases.deliveryLabel + '</div>';
            } else {
                const duracao = formatDuration(order.timestamp_started, order.timestamp_completed);
                duracaoHtml = duracao;
            }
            tableBody.innerHTML += `
                <tr class="history-row">
                    <td>#${order._id.slice(-6)}</td>
                    <td>${order.client_name}</td>
                    <td>${serviceName}</td>
                    <td>${motoristaNome}</td>
                    <td>${getPaymentMethodLabel(order.payment_method)}</td>
                    <td>${duracaoHtml}</td>
                    <td class="verification-code">${order.verification_code}</td> 
                    <td><button class="btn-action-small" onclick="openHistoryDetailModal('${order._id}')"><i class="fas fa-eye"></i></button></td>
                </tr>
            `;
        });
    } catch (error) { 
        console.error('Falha ao carregar histórico:', error);
        tableBody.innerHTML = '<tr><td colspan="8">Erro ao carregar histórico.</td></tr>';
    }
}

async function loadClients() {
    const tableBody = document.getElementById('clients-table-body');
    tableBody.innerHTML = '<tr><td colspan="6">A carregar...</td></tr>';
    try {
        const response = await fetch(`${API_URL}/api/clients`, { method: 'GET', headers: getAuthHeaders('admin') });
        if (response.status === 401) { await handle401Safely('admin'); return; }
        const data = await readJsonResponse(response);
        if (!response.ok) throw new Error(data.message);
        tableBody.innerHTML = '';
        if (data.clients.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="6">Nenhum cliente registado.</td></tr>';
            return;
        }
        data.clients.forEach(client => {
            tableBody.innerHTML += `
                <tr>
                    <td>${client.nome}</td>
                    <td>${client.telefone}</td>
                    <td>${client.empresa || 'N/D'}</td>
                    <td>${client.billing_type === 'postpaid' ? '<span class="status status-online-livre">Pós-pago</span>' : 'Normal'}</td>
                    <td>${client.billing_type === 'postpaid' ? `${Number(client.credit_balance || 0).toFixed(2)} / ${Number(client.credit_limit || 0).toFixed(2)} MZN` : '—'}</td>
                    <td>
                        <div class="table-actions">
                            <button type="button" class="btn-action btn-action-small" onclick="openEditClientModal('${client._id}')" title="Editar"><i class="fas fa-edit"></i></button>
                            <button type="button" class="btn-action-small btn-action-report" onclick="openStatementModal('${client._id}', '${client.nome}')" title="Ver Extrato"><i class="fas fa-file-invoice-dollar"></i></button>
                            <div class="actions-menu">
                                <button type="button" class="action-menu-toggle" aria-label="Mais opções"><i class="fas fa-ellipsis-v"></i></button>
                                <div class="action-menu-panel" role="menu">
                                    <button type="button" class="action-menu-item danger" onclick="handleDeleteClient('${client._id}', '${client.nome}')" role="menuitem"><i class="fas fa-trash"></i><span>Eliminar</span></button>
                                </div>
                            </div>
                        </div>
                    </td>
                </tr>
            `;
        });
    } catch (error) { 
        console.error('Falha ao carregar clientes:', error);
        tableBody.innerHTML = '<tr><td colspan="6">Erro ao carregar clientes.</td></tr>';
    }
}

async function loadClientsIntoDropdown() {
    const select = document.getElementById('delivery-client-select');
    select.innerHTML = '<option value="">A carregar clientes...</option>';
    try {
        const response = await fetch(`${API_URL}/api/clients`, { headers: getAuthHeaders('admin') });
        if (response.status === 401) { 
            select.innerHTML = '<option value="">-- Erro de Sessão --</option>';
            await handle401Safely('admin');
            return;
        }
        const data = await readJsonResponse(response);
        if (!response.ok) throw new Error(data.message);
        clientCache = data.clients; // Preenche o cache global
        select.innerHTML = '<option value="">-- Selecione um cliente ou digite manualmente --</option>';
        if (clientCache.length === 0) {
            select.innerHTML = '<option value="">-- Nenhum cliente registado --</option>';
            return;
        }
        clientCache.forEach(client => {
            const option = document.createElement('option');
            option.value = client._id;
            option.textContent = `${client.nome} (${client.empresa || client.telefone})${client.billing_type === 'postpaid' ? ` · Pós-pago: ${Number(client.credit_balance || 0).toFixed(2)} MZN` : ''}`;
            select.appendChild(option);
        });
    } catch (error) {
        console.error('Falha ao carregar clientes para o dropdown:', error);
        select.innerHTML = '<option value="">-- Erro ao carregar clientes --</option>';
    }
}


/* --- Lógica de API (POST/PUT/DELETE) --- */

async function handleChangePassword(e) {
    e.preventDefault();
    const form = e.target;
    const submitButton = form.querySelector('button[type="submit"]');
    
    const senhaAntiga = document.getElementById('admin-pass-antiga').value;
    const senhaNova = document.getElementById('admin-pass-nova').value;
    const senhaConfirmar = document.getElementById('admin-pass-confirmar').value;
    
    if (senhaNova !== senhaConfirmar) {
        showCustomAlert('Erro', 'As novas senhas não coincidem.', 'error');
        return;
    }
    
    if (senhaNova.length < 6) {
        showCustomAlert('Erro', 'A nova senha deve ter pelo menos 6 caracteres.', 'error');
        return;
    }
    
    submitButton.disabled = true;
    submitButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> A atualizar...';

    try {
        const response = await fetch(`${API_URL}/api/auth/change-password`, {
            method: 'PUT',
            headers: { ...getAuthHeaders('admin'), 'Content-Type': 'application/json' },
            body: JSON.stringify({ senhaAntiga, senhaNova })
        });
        
        const data = await readJsonResponse(response);
        if (!response.ok) {
            throw new Error(data.message);
        }
        
        showCustomAlert('Sucesso!', 'A sua senha foi alterada. Por favor, faça login novamente.', 'success');
        
        setTimeout(() => {
            handleLogout('admin');
        }, 2500);

    } catch (error) {
        console.error('Falha ao mudar a senha:', error);
        showCustomAlert('Erro', error.message, 'error');
        submitButton.disabled = false;
        submitButton.innerHTML = 'Atualizar Senha';
    }
}

async function handleAddCost(e) {
    e.preventDefault();

    const form = e.target;
    const submitButton = form.querySelector('button[type="submit"]');

    const category = document.getElementById('cost-category').value;
    const amountStr = document.getElementById('cost-amount').value;
    const date = document.getElementById('cost-date').value;
    const description = document.getElementById('cost-description').value.trim();
    const assignedRaw = document.getElementById('cost-assigned-entity').value;

    if (!category) {
        showCustomAlert('Erro', 'Por favor, selecione uma categoria de custo.', 'error');
        return;
    }

    const amount = Number(amountStr);
    if (Number.isNaN(amount) || amount <= 0) {
        showCustomAlert('Erro', 'Introduza um valor de custo válido (maior que 0).', 'error');
        return;
    }

    let assignedUserId;
    let assignedClientId;
    let assignedVehicleId;

    if (assignedRaw) {
        const [type, id] = assignedRaw.split(':');
        if (type === 'driver') {
            assignedUserId = id;  // associar a utilizador/motorista
        } else if (type === 'client') {
            assignedClientId = id;
        } else if (type === 'vehicle') {
            assignedVehicleId = id;
        }
    }

    submitButton.disabled = true;
    submitButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> A guardar...';

    try {
        const body = {
            category,
            amount,
            description: description || undefined,
            date: date || undefined,
            assignedUserId: assignedUserId || undefined,
            assignedClientId: assignedClientId || undefined,
            assignedVehicleId: assignedVehicleId || undefined
        };

        const response = await fetch(`${API_URL}/api/costs`, {
            method: 'POST',
            headers: { 
                ...getAuthHeaders('admin'),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        const data = await readJsonResponse(response);
        if (!response.ok) throw new Error(data.message || 'Falha ao registar custo.');

        showCustomAlert('Sucesso', 'Custo registado com sucesso!', 'success');
        form.reset();

        // Recarrega dashboard de custos + opções de atribuição
        loadCostsDashboardSummary();
        loadCostAssignmentOptions();

    } catch (error) {
        console.error('Falha ao registar custo:', error);
        showCustomAlert('Erro', error.message || 'Erro ao registar custo.', 'error');
    } finally {
        submitButton.disabled = false;
        submitButton.innerHTML = '<i class="fas fa-save"></i> Guardar Custo';
    }
}

async function handleDeleteOldHistory() {
    const btn = document.getElementById('btn-confirm-action');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> A apagar...';

    try {
        const response = await fetch(`${API_URL}/api/admin/orders/history`, {
            method: 'DELETE',
            headers: getAuthHeaders('admin')
        });

        const data = await readJsonResponse(response);
        if (!response.ok) {
            throw new Error(data.message);
        }

        closeConfirmationModal();
        showCustomAlert('Sucesso', data.message, 'success');
        
        if(document.getElementById('historico').classList.contains('hidden') === false) {
            loadHistory();
        }

    } catch (error) {
        console.error('Falha ao apagar histórico:', error);
        showCustomAlert('Erro', error.message, 'error');
    } finally {
        // Garante que o botão do modal é reativado
        btn.disabled = false;
        btn.innerHTML = 'Confirmar e Apagar';
    }
}

async function handleExportCostsExcel() {
    try {
        const params = new URLSearchParams();
        // se quiseres no futuro: params.set('month', '2025-11');
        params.set('limit', '500'); // exportar até 500 registos, por exemplo

        const response = await fetch(`${API_URL}/api/costs?${params.toString()}`, {
            headers: getAuthHeaders('admin')
        });

        if (response.status === 401) { await handle401Safely('admin'); return; }

        const data = await readJsonResponse(response);
        if (!response.ok) throw new Error(data.message || 'Erro ao carregar custos.');

        const rows = [];
        rows.push(['Data', 'Categoria', 'Atribuído a', 'Descrição', 'Valor']);

        const formatDate = (d) => d ? new Date(d).toLocaleDateString('pt-MZ') : '';
        const catLabel = (cat) => COST_CATEGORY_LABELS[cat] || cat || '';
        
        (data.costs || []).forEach(cost => {
            const dateStr = formatDate(cost.date);
            const categoryStr = catLabel(cost.category);
            let assignedStr = '';

            if (cost.assignedUser && cost.assignedUser.nome) {
                assignedStr = `Funcionário: ${cost.assignedUser.nome}`;
            } else if (cost.assignedClient && cost.assignedClient.nome) {
                assignedStr = `Cliente: ${cost.assignedClient.nome}`;
            } else if (cost.assignedVehicle && cost.assignedVehicle.plate) {
                assignedStr = `Veículo: ${cost.assignedVehicle.plate}`;
            }

            rows.push([
                dateStr,
                categoryStr,
                assignedStr,
                cost.description || '',
                (cost.amount || 0).toString().replace('.', ',')
            ]);
        });

        const csvContent = rows.map(r => r.map((field) => {
            const safe = String(field).replace(/"/g, '""');
            return `"${safe}"`;
        }).join(';')).join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');

        const today = new Date();
        const fileName = `relatorio_custos_${today.getFullYear()}-${today.getMonth()+1}-${today.getDate()}.csv`;

        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

    } catch (error) {
        console.error('Falha ao exportar custos:', error);
        showCustomAlert('Erro', error.message || 'Erro ao exportar relatório de custos.', 'error');
    }
}
async function handleNewDelivery(e) {
    e.preventDefault();
    const form = e.target;
    const submitButton = form.querySelector('button[type="submit"]');
    const formData = new FormData(form);
    
    // ===== GARANTIR MÉTODO DE PAGAMENTO =====
    const paymentMethodEl = document.getElementById('payment-method');
    const paymentMethod = paymentMethodEl ? paymentMethodEl.value : 'cash';

    // Remove duplicados se existirem
    formData.delete('payment_method');

    // Adiciona valor correto
    formData.append('payment_method', paymentMethod);
    
    const pickupLat = document.getElementById('pickup-lat')?.value;
    const pickupLng = document.getElementById('pickup-lng')?.value;
    const deliveryLat = document.getElementById('delivery-lat')?.value;
    const deliveryLng = document.getElementById('delivery-lng')?.value;
    const servicePrice = Number(document.getElementById('delivery-price')?.value || 0);
    const totalPrice = Number(document.getElementById('final-order-price')?.value || 0);

    if (!pickupLat || !pickupLng) {
        showCustomAlert('Ponto de Recolha em falta', 'Seleccione uma sugestão válida para o ponto de recolha.', 'error');
        return;
    }

    if (!deliveryLat || !deliveryLng) {
        showCustomAlert('Ponto de Entrega em falta', 'Seleccione uma sugestão válida ou marque o pin do ponto de entrega no mapa.', 'error');
        return;
    }

    formData.delete('price');
    formData.append('price', Number(totalPrice || servicePrice || 0).toFixed(2));

    submitButton.disabled = true;
    submitButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> A gerar...';

    try {
        // IMPORTANTE: NÃO definir o header 'Content-Type' quando usas FormData
        // O browser define automaticamente com o boundary correto
        const response = await fetch(`${API_URL}/api/orders`, {
            method: 'POST',
            headers: {
                // APENAS o header de Authorization, NÃO o Content-Type
                'Authorization': `Bearer ${getAuthToken('admin')}`
            },
            body: formData
        });
        
        const data = await readJsonResponse(response); 
        if (!response.ok) {
            throw new Error(data.message || 'Erro do servidor');
        }

        showCustomAlert('Sucesso!', `Pedido Criado! \nCódigo do Destinatário: ${data.order.verification_code}`, 'success');
        form.reset();
        removeImage();
        if (typeof destroyFormMap === 'function') destroyFormMap();
        showPage('entregas-activas', 'nav-entregas', 'Entregas Activas');

    } catch (error) {
        console.error('Falha ao criar entrega:', error);
        showCustomAlert('Erro', error.message, 'error'); 
    } finally {
        submitButton.disabled = false;
        submitButton.innerHTML = 'Gerar Pedido';
    }
}

async function handleAddDriver(e) {
    e.preventDefault();
    const form = e.target;
    const submitButton = form.querySelector('button[type="submit"]');

    const name = document.getElementById('driver-name').value;
    const phone = document.getElementById('driver-phone').value;
    const email = document.getElementById('driver-email').value;
    const plate = document.getElementById('driver-plate').value;
    const vehicleId = document.getElementById('driver-vehicle-id')?.value || '';
    const driverType = document.getElementById('driver-type')?.value || 'freelancer';
    const password = document.getElementById('driver-password').value;
    const commissionRate = driverType === 'official' ? 0 : document.getElementById('driver-commission').value;
    
    if (password.length < 6) {
        showCustomAlert('Atenção', 'A senha do motorista deve ter pelo menos 6 caracteres.');
        return;
    }
    
    submitButton.disabled = true;
    submitButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> A salvar...';

    try {
        const response = await fetch(`${API_URL}/api/auth/register-driver`, {
            method: 'POST',
            headers: { ...getAuthHeaders('admin'), 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                nome: name, 
                email, 
                telefone: phone, 
                password, 
                vehicle_plate: plate,
                vehicleId: vehicleId || undefined,
                driverType,
                commissionRate: commissionRate
            })
        });
        
        const data = await readJsonResponse(response);
        if (!response.ok) throw new Error(data.message);
        
        showCustomAlert('Sucesso', 'Motorista adicionado com sucesso!', 'success');
        form.reset();
        showAddDriverForm(false);
        loadDrivers();
        loadVehiclesIntoSelects();
        
    } catch (error) {
        console.error('Falha ao adicionar motorista:', error);
        showCustomAlert('Erro', error.message, 'error');
    } finally {
        submitButton.disabled = false;
        submitButton.innerHTML = 'Salvar Motorista';
    }
}

async function handleUpdateDriver(event) {
    event.preventDefault();
    const form = event.target;
    const submitButton = form.querySelector('button[type="submit"]');
    const userId = document.getElementById('edit-driver-id').value;
    
    const updatedData = {
        nome: document.getElementById('edit-driver-name').value,
        telefone: document.getElementById('edit-driver-phone').value,
        vehicle_plate: document.getElementById('edit-driver-plate').value,
        vehicleId: document.getElementById('edit-driver-vehicle-id')?.value || '',
        driverType: document.getElementById('edit-driver-type')?.value || 'freelancer',
        status: document.getElementById('edit-driver-status').value,
        commissionRate: document.getElementById('edit-driver-type')?.value === 'official' ? 0 : document.getElementById('edit-driver-commission').value
    };
    
    submitButton.disabled = true;
    submitButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> A salvar...';

    try {
        const response = await fetch(`${API_URL}/api/drivers/${userId}`, { 
            method: 'PUT', 
            headers: { ...getAuthHeaders('admin'), 'Content-Type': 'application/json' }, 
            body: JSON.stringify(updatedData)
        });
        
        const data = await readJsonResponse(response);
        if (!response.ok) throw new Error(data.message);
        
        showCustomAlert('Sucesso', 'Motorista atualizado com sucesso!', 'success');
        closeEditDriverModal();
        loadDrivers();
        
    } catch (error) {
        console.error('Falha ao atualizar motorista:', error);
        showCustomAlert('Erro', error.message, 'error');
    } finally {
        submitButton.disabled = false;
        submitButton.innerHTML = 'Salvar Alterações';
    }
}

async function handleAddClient(e) {
    e.preventDefault();
    const form = e.target;
    const submitButton = form.querySelector('button[type="submit"]');

    const clientData = {
        nome: document.getElementById('client-nome').value,
        telefone: document.getElementById('client-telefone').value,
        empresa: document.getElementById('client-empresa').value,
        email: document.getElementById('client-email').value,
        nuit: document.getElementById('client-nuit').value,
        endereco: document.getElementById('client-endereco').value,
        billing_type: document.getElementById('client-billing-type')?.value || 'prepaid',
        credit_limit: Number(document.getElementById('client-credit-limit')?.value || 0)
    };
    if (!clientData.nome || !clientData.telefone) {
        showCustomAlert('Atenção', 'Nome e Telefone são obrigatórios.', 'error');
        return;
    }

    submitButton.disabled = true;
    submitButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> A salvar...';

    try {
        const response = await fetch(`${API_URL}/api/clients`, {
            method: 'POST',
            headers: { ...getAuthHeaders('admin'), 'Content-Type': 'application/json' },
            body: JSON.stringify(clientData)
        });
        const data = await readJsonResponse(response);
        if (!response.ok) throw new Error(data.message);
        showCustomAlert('Sucesso', 'Cliente adicionado com sucesso!', 'success');
        form.reset();
        showAddClientForm(false);
        loadClients();
        loadClientsIntoDropdown();
    } catch (error) {
        console.error('Falha ao adicionar cliente:', error);
        showCustomAlert('Erro', error.message, 'error');
    } finally {
        submitButton.disabled = false;
        submitButton.innerHTML = 'Salvar Cliente';
    }
}

async function handleUpdateClient(e) {
    e.preventDefault();
    const form = e.target;
    const submitButton = form.querySelector('button[type="submit"]');
    const clientId = document.getElementById('edit-client-id').value;

    const updatedData = {
        nome: document.getElementById('edit-client-nome').value,
        telefone: document.getElementById('edit-client-telefone').value,
        empresa: document.getElementById('edit-client-empresa').value,
        email: document.getElementById('edit-client-email').value,
        nuit: document.getElementById('edit-client-nuit').value,
        endereco: document.getElementById('edit-client-endereco').value,
        billing_type: document.getElementById('edit-client-billing-type')?.value || 'prepaid',
        credit_limit: Number(document.getElementById('edit-client-credit-limit')?.value || 0)
    };
    if (!updatedData.nome || !updatedData.telefone) {
        showCustomAlert('Atenção', 'Nome e Telefone são obrigatórios.', 'error');
        return;
    }

    submitButton.disabled = true;
    submitButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> A salvar...';

    try {
        const response = await fetch(`${API_URL}/api/clients/${clientId}`, {
            method: 'PUT',
            headers: { ...getAuthHeaders('admin'), 'Content-Type': 'application/json' },
            body: JSON.stringify(updatedData)
        });
        const data = await readJsonResponse(response);
        if (!response.ok) throw new Error(data.message);
        showCustomAlert('Sucesso', 'Cliente atualizado com sucesso!', 'success');
        closeEditClientModal();
        loadClients();
    } catch (error) {
        console.error('Falha ao atualizar cliente:', error);
        showCustomAlert('Erro', error.message, 'error');
    } finally {
        submitButton.disabled = false;
        submitButton.innerHTML = 'Salvar Alterações';
    }
}

async function handleDeleteClient(clientId, clientName) {
    const confirmed = window.TragoFeedback
        ? await window.TragoFeedback.confirm({
            type: 'warning',
            title: 'Apagar cliente?',
            message: `A conta de “${clientName}” será removida. Esta acção não pode ser revertida.`,
            confirmText: 'Apagar cliente',
            cancelText: 'Manter'
        })
        : false;
    if (!confirmed) return;
    try {
        const response = await fetch(`${API_URL}/api/clients/${clientId}`, {
            method: 'DELETE',
            headers: getAuthHeaders('admin')
        });
        const data = await readJsonResponse(response);
        if (!response.ok) throw new Error(data.message);
        showCustomAlert('Sucesso', data.message, 'success');
        loadClients();
    } catch (error) {
        console.error('Falha ao apagar cliente:', error);
        showCustomAlert('Erro', error.message, 'error');
    }
}

async function confirmAssign(orderId, driverId) {
    const button = document.getElementById('btn-confirm-assign');
    button.disabled = true;
    button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> A atribuir...';

    try {
        const response = await fetch(`${API_URL}/api/orders/${orderId}/assign`, { 
            method: 'PUT', 
            headers: { ...getAuthHeaders('admin'), 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ driverId }) 
        });
        const data = await readJsonResponse(response);
        if (!response.ok) throw new Error(data.message);
        showCustomAlert('Sucesso', 'Encomenda atribuída com sucesso!', 'success');
        closeAssignModal();
        loadActiveDeliveries();
    } catch (error) {
        console.error('Falha ao atribuir encomenda:', error);
        showCustomAlert('Erro', error.message, 'error');
    } finally {
        button.disabled = false;
        button.innerHTML = 'Confirmar';
    }
}

async function handleGenerateStatement() {
    const button = document.getElementById('btn-generate-statement');
    const clientId = document.getElementById('statement-client-id').value;
    const startDate = document.getElementById('statement-start-date').value;
    const endDate = document.getElementById('statement-end-date').value;
    
    if (!startDate || !endDate) {
        showCustomAlert('Erro', 'Por favor, selecione uma data de início e uma data de fim.', 'error');
        return;
    }
    
    const resultsDiv = document.getElementById('statement-results');
    resultsDiv.classList.add('hidden');
    
    button.disabled = true;
    button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> A gerar...';

    try {
        // showCustomAlert('A Gerar...', 'A buscar os dados do extrato.', 'info'); // (Removido para não sobrepor)
        const response = await fetch(`${API_URL}/api/clients/${clientId}/statement?startDate=${startDate}&endDate=${endDate}`, {
            headers: getAuthHeaders('admin')
        });
        const data = await readJsonResponse(response);
        if (!response.ok) throw new Error(data.message);
        // closeCustomAlert();
        populateStatementModal(data, startDate, endDate);
    } catch (error) {
        console.error('Falha ao gerar extrato:', error);
        showCustomAlert('Erro', error.message, 'error');
    } finally {
        button.disabled = false;
        button.innerHTML = '<i class="fas fa-search"></i> Gerar Extrato';
    }
}



async function loadVehicles() {
    const tableBodies = ['vehicles-table-body', 'vehicles-table-body-motoristas']
        .map(id => document.getElementById(id))
        .filter(Boolean);
    if (!tableBodies.length) return;
    tableBodies.forEach((tableBody) => {
        tableBody.innerHTML = '<tr><td colspan="5">A carregar...</td></tr>';
    });
    try {
        const response = await fetch(`${API_URL}/api/vehicles`, { headers: getAuthHeaders('admin') });
        if (response.status === 401) { await handle401Safely('admin'); return; }
        const data = await readJsonResponse(response);
        if (!response.ok) throw new Error(data.message || 'Erro ao carregar veículos.');
        const vehicles = data.vehicles || [];
        const html = !vehicles.length
            ? '<tr><td colspan="5">Nenhum veículo registado.</td></tr>'
            : vehicles.map(v => `
                <tr>
                    <td>${v.plate || '—'}</td>
                    <td>${v.type || '—'}</td>
                    <td><span class="status status-${String(v.status || 'ativo').replace('_', '-')}">${v.status || 'ativo'}</span></td>
                    <td>${[v.brand, v.model].filter(Boolean).join(' ') || '—'}</td>
                    <td>
                        <div class="actions-menu">
                            <button type="button" class="action-menu-toggle" aria-label="Mais opções"><i class="fas fa-ellipsis-v"></i></button>
                            <div class="action-menu-panel" role="menu">
                                <button type="button" class="action-menu-item danger" onclick="handleDeleteVehicle('${v._id}', '${(v.plate || '').replace(/'/g, '&#039;')}')" role="menuitem"><i class="fas fa-trash"></i><span>Eliminar</span></button>
                            </div>
                        </div>
                    </td>
                </tr>
            `).join('');
        tableBodies.forEach((tableBody) => {
            tableBody.innerHTML = html;
        });
    } catch (error) {
        console.error('Falha ao carregar veículos:', error);
        tableBodies.forEach((tableBody) => {
            tableBody.innerHTML = '<tr><td colspan="5">Erro ao carregar veículos.</td></tr>';
        });
    }
}

async function loadVehiclesIntoSelects() {
    const selects = ['driver-vehicle-id', 'edit-driver-vehicle-id'].map(id => document.getElementById(id)).filter(Boolean);
    if (!selects.length) return;
    try {
        const response = await fetch(`${API_URL}/api/vehicles`, { headers: getAuthHeaders('admin') });
        if (!response.ok) return;
        const data = await readJsonResponse(response);
        const vehicles = data.vehicles || [];
        selects.forEach(select => {
            const current = select.value;
            select.innerHTML = '<option value="">-- Sem veículo associado --</option>';
            vehicles.forEach(v => {
                const opt = document.createElement('option');
                opt.value = v._id;
                opt.textContent = `${v.plate}${v.type ? ` · ${v.type}` : ''}`;
                select.appendChild(opt);
            });
            if (current) select.value = current;
        });
    } catch (error) {
        console.warn('Falha ao carregar veículos nos selects:', error);
    }
}

async function handleAddVehicle(e) {
    e.preventDefault();
    const form = e.target;
    const submitButton = form.querySelector('button[type="submit"]');
    const suffix = form.id === 'form-add-veiculo-motoristas' ? '-motoristas' : '';
    const getVehicleField = (baseId) => document.getElementById(`${baseId}${suffix}`);
    const body = {
        plate: getVehicleField('vehicle-plate')?.value || '',
        type: getVehicleField('vehicle-type')?.value || 'mota',
        status: getVehicleField('vehicle-status')?.value || 'ativo',
        brand: getVehicleField('vehicle-brand')?.value || '',
        model: getVehicleField('vehicle-model')?.value || '',
        notes: getVehicleField('vehicle-notes')?.value || ''
    };
    if (!String(body.plate || '').trim()) {
        showCustomAlert('Erro', 'A matrícula do veículo é obrigatória.', 'error');
        return;
    }
    submitButton.disabled = true;
    submitButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> A guardar...';
    try {
        const response = await fetch(`${API_URL}/api/vehicles`, {
            method: 'POST',
            headers: { ...getAuthHeaders('admin'), 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await readJsonResponse(response);
        if (!response.ok) throw new Error(data.message || 'Falha ao adicionar veículo.');
        showCustomAlert('Sucesso', 'Veículo registado com sucesso!', 'success');
        form.reset();
        await loadVehicles();
        await loadVehiclesIntoSelects();
        await loadCostAssignmentOptions();
    } catch (error) {
        showCustomAlert('Erro', error.message || 'Erro ao adicionar veículo.', 'error');
    } finally {
        submitButton.disabled = false;
        submitButton.innerHTML = '<i class="fas fa-plus"></i> Adicionar Veículo';
    }
}

async function handleDeleteVehicle(vehicleId, plate) {
    const confirmed = window.TragoFeedback
        ? await window.TragoFeedback.confirm({
            type: 'warning',
            title: 'Apagar veículo?',
            message: `O veículo “${plate}” deixará de estar disponível para atribuição.`,
            confirmText: 'Apagar veículo',
            cancelText: 'Manter'
        })
        : false;
    if (!confirmed) return;
    try {
        const response = await fetch(`${API_URL}/api/vehicles/${vehicleId}`, {
            method: 'DELETE',
            headers: getAuthHeaders('admin')
        });
        const data = await readJsonResponse(response);
        if (!response.ok) throw new Error(data.message || 'Falha ao apagar veículo.');
        showCustomAlert('Sucesso', data.message || 'Veículo apagado.', 'success');
        loadVehicles();
        loadVehiclesIntoSelects();
        loadCostAssignmentOptions();
    } catch (error) {
        showCustomAlert('Erro', error.message || 'Erro ao apagar veículo.', 'error');
    }
}

// Mapa de categorias de custos -> label amigável
const COST_CATEGORY_LABELS = {
    manutencao: 'Manutenção',
    combustivel: 'Combustível',
    emprestimo: 'Empréstimo',
    credito: 'Crédito',
    taxa_trans_levant: 'Taxa Trans/Levant',
    consumiveis: 'Consumíveis',
    despesas_aplicativo: 'Despesas aplicativo',
    diversos: 'Diversos'
};

// Estado global para os gráficos de custos
let costsByCategoryChart = null;
let revenueVsCostsChart = null;
