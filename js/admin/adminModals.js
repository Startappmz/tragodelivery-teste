/*
 * Ficheiro: js/admin/adminModals.js (VERSÃO COMPLETA E CORRIGIDA)
 *
 * Contém toda a lógica de ABERTURA e carregamento de dados
 * dos modais (pop-ups) do painel de admin.
 */

/**
 * Calcula as durações por fase da entrega (central → recolha, recolha → entrega).
 * Usa timestamps específicos se existirem, senão faz fallback para timestamp_started/completed.
 * @param {object} order
 * @returns {{pickupMs:number|null, deliveryMs:number|null, totalMs:number, pickupLabel:string, deliveryLabel:string, totalLabel:string}}
 */
function getPhaseDurations(order) {
    const toMs = (value) => {
        if (!value) return null;
        const d = new Date(value);
        const t = d.getTime();
        return Number.isNaN(t) ? null : t;
    };

    const pickupStart = toMs(order.pickupStartAt);
    const pickupEnd = toMs(order.pickupCompletedAt);
    const deliveryStart = toMs(order.deliveryStartAt);
    const deliveryEnd = toMs(order.deliveryCompletedAt || order.timestamp_completed);

    const computeDiff = (start, end) => {
        if (start == null || end == null) return null;
        if (end < start) return null;
        return end - start;
    };

    const pickupMs = computeDiff(pickupStart, pickupEnd);
    const deliveryMs = computeDiff(deliveryStart, deliveryEnd);

    let totalMs = 0;
    if (pickupMs != null) totalMs += pickupMs;
    if (deliveryMs != null) totalMs += deliveryMs;

    // Fallback para duração total clássica, se por algum motivo as fases não estiverem marcadas
    if (totalMs === 0 && order.timestamp_started && order.timestamp_completed) {
        const start = toMs(order.timestamp_started);
        const end = toMs(order.timestamp_completed);
        const diff = computeDiff(start, end);
        if (diff != null) {
            totalMs = diff;
        }
    }

    const formatFromMs = (ms) => {
        if (ms == null) return 'N/D';
        const totalMinutes = Math.round(ms / 60000);
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        if (hours <= 0) {
            return `${totalMinutes} min`;
        }
        if (minutes === 0) {
            return `${hours}h`;
        }
        return `${hours}h ${minutes}min`;
    };

    return {
        pickupMs,
        deliveryMs,
        totalMs,
        pickupLabel: formatFromMs(pickupMs),
        deliveryLabel: formatFromMs(deliveryMs),
        totalLabel: formatFromMs(totalMs)
    };
}

/**
 * Abre o modal genérico de confirmação (para ações destrutivas).
 * @param {object} options - { title, message, confirmText, onConfirm }
 */
function openConfirmationModal({ title, message, confirmText, onConfirm }) {
    const modal = document.getElementById('confirmation-modal');
    document.getElementById('confirmation-title').innerHTML = title;
    document.getElementById('confirmation-message').innerHTML = message;
    
    const input = document.getElementById('confirmation-input');
    const label = document.getElementById('confirmation-input-label');
    const confirmBtn = document.getElementById('btn-confirm-action');

    label.innerHTML = `Para confirmar, digite a palavra: <b>${confirmText}</b>`;
    input.value = '';
    confirmBtn.disabled = true;
    
    // Remove listeners antigos para evitar duplicação
    input.oninput = null;
    confirmBtn.onclick = null;

    input.oninput = () => {
        if (input.value.toUpperCase() === confirmText) {
            confirmBtn.disabled = false;
        } else {
            confirmBtn.disabled = true;
        }
    };
    
    confirmBtn.onclick = () => {
        onConfirm(); // Chama a função de callback (ex: handleDeleteOldHistory)
    };

    modal.classList.remove('hidden');
}

/**
 * Abre o modal para atribuir/reatribuir uma encomenda.
 * @param {string} orderId - O ID da encomenda.
 */
function escapeAdminOrderChat(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
}

async function openAdminDeliveryProof(orderId) {
    const proofWindow = window.open('about:blank', '_blank');
    if (proofWindow) proofWindow.opener = null;
    try {
        const response = await fetch(`${API_URL}/api/orders/${encodeURIComponent(orderId)}/delivery-proof`, {
            headers: getAuthHeaders('admin')
        });
        const data = await readJsonResponse(response);
        if (!response.ok || !data.url) throw new Error(data.message || 'Comprovativo indisponível.');
        if (proofWindow) proofWindow.location.href = data.url;
        else window.open(data.url, '_blank', 'noopener,noreferrer');
    } catch (error) {
        proofWindow?.close();
        showCustomAlert('Comprovativo de entrega', error.message, 'error');
    }
}

async function loadAdminOrderMessages(orderId) {
    const stream = document.getElementById('admin-order-chat-stream');
    if (!stream) return;
    stream.innerHTML = '<p>A carregar conversa…</p>';
    try {
        const response = await fetch(`${API_URL}/api/orders/${encodeURIComponent(orderId)}/messages`, { headers: getAuthHeaders('admin') });
        const data = await readJsonResponse(response);
        if (!response.ok) throw new Error(data.message || 'Falha ao carregar conversa.');
        const messages = data.messages || [];
        stream.innerHTML = messages.length ? messages.map((message) => {
            const role = message.senderRole || message.sender_role || 'system';
            const channel = message.channelType || message.channel_type || 'system';
            const channelLabels = {
                client_driver: 'Cliente ↔ Motorista',
                driver_partner: 'Motorista ↔ Loja',
                system: 'Sistema',
                support: 'Suporte'
            };
            const date = new Date(message.createdAt || Date.now());
            return `<article class="admin-order-message ${role === 'admin' ? 'mine' : role === 'system' ? 'system' : ''}"><header><strong>${escapeAdminOrderChat(message.senderName || message.sender_name || role)} · ${channelLabels[channel] || channel}</strong><small>${Number.isNaN(date.getTime()) ? '' : date.toLocaleString('pt-MZ')}</small></header><p>${escapeAdminOrderChat(message.body || '')}</p></article>`;
        }).join('') : '<p class="admin-order-chat-empty">Ainda não existem mensagens neste pedido.</p>';
        stream.scrollTop = stream.scrollHeight;
    } catch (error) {
        stream.innerHTML = `<p class="admin-order-chat-error">${escapeAdminOrderChat(error.message)}</p>`;
    }
}

async function sendAdminOrderMessage(event, orderId) {
    event.preventDefault();
    const form = event.currentTarget;
    const message = String(form.elements.message.value || '').trim();
    const channel = String(form.elements.channel?.value || 'client_driver');
    if (!message) return;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
        const response = await fetch(`${API_URL}/api/orders/${encodeURIComponent(orderId)}/messages`, {
            method: 'POST',
            headers: { ...getAuthHeaders('admin'), 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, channel })
        });
        const data = await readJsonResponse(response);
        if (!response.ok) throw new Error(data.message || 'Falha ao enviar mensagem.');
        form.reset();
        await loadAdminOrderMessages(orderId);
    } catch (error) { showCustomAlert('Conversa do pedido', error.message, 'error'); }
    finally { button.disabled = false; }
}

async function openAssignModal(orderId) {
    const modal = document.getElementById('assign-modal');
    modal.classList.remove('hidden');
    document.getElementById('modal-order-id').innerText = `#${orderId.slice(-6)}`;
    
    const select = document.getElementById('driver-select-dropdown');
    select.innerHTML = '<option value="">A carregar...</option>';
    
    try {
        const response = await fetch(`${API_URL}/api/drivers/available`, { headers: getAuthHeaders('admin') });
        if (response.status === 401) { await handle401Safely('admin'); return; }

        const data = await readJsonResponse(response);
        if (!response.ok) throw new Error(data.message);
        
        if (data.drivers.length === 0) { 
            select.innerHTML = '<option value="">Nenhum motorista disponível</option>'; 
            return; 
        }
        
        select.innerHTML = '<option value="">-- Selecione um motorista --</option>';
        data.drivers.forEach(driver => { 
            select.innerHTML += `<option value="${driver.profile._id}">${driver.nome} (${driver.profile.vehicle?.plate || driver.profile.vehicle_plate || 'Sem viatura'})</option>`; 
        });
        
        // Atribui a função de clique ao botão (usando a função do adminApi.js)
        document.getElementById('btn-confirm-assign').onclick = async () => {
            const driverId = select.value;
            if (!driverId) { 
                showCustomAlert('Atenção', 'Por favor, selecione um motorista.'); 
                return; 
            }
            await confirmAssign(orderId, driverId);
        };
        
    } catch (error) { 
        console.error('Falha ao carregar motoristas disponíveis:', error); 
        select.innerHTML = '<option value="">Erro ao carregar</option>'; 
    }
}

/**
 * Abre o modal para editar os dados de um motorista.
 * @param {string} driverUserId - O ID do *User* do motorista.
 */
async function openEditDriverModal(driverUserId) {
    const modal = document.getElementById('edit-driver-modal');
    modal.classList.remove('hidden');
    document.getElementById('edit-driver-id').value = driverUserId;
    
    // Limpa o formulário enquanto carrega
    document.getElementById('form-edit-motorista').reset();
    document.getElementById('edit-driver-name').value = 'A carregar...';
    document.getElementById('edit-driver-phone').value = 'A carregar...';
    
    try {
        const response = await fetch(`${API_URL}/api/drivers/${driverUserId}`, { headers: getAuthHeaders('admin') });
        if (response.status === 401) { await handle401Safely('admin'); return; }

        const data = await readJsonResponse(response);
        if (!response.ok) throw new Error(data.message);
        
        const driver = data.driver;
        const profile = driver.profile || {};
        
        // Preenche o formulário
        document.getElementById('edit-driver-name').value = driver.nome;
        document.getElementById('edit-driver-phone').value = driver.telefone;
        if (typeof loadVehiclesIntoSelects === 'function') await loadVehiclesIntoSelects();
        document.getElementById('edit-driver-plate').value = profile.vehicle_plate || '';
        document.getElementById('edit-driver-type').value = profile.driverType || profile.driver_type || 'freelancer';
        document.getElementById('edit-driver-vehicle-id').value = profile.vehicle?._id || profile.vehicle || profile.vehicle_id || '';
        document.getElementById('edit-driver-status').value = profile.status || 'offline';
        document.getElementById('edit-driver-commission').value = profile.commissionRate || 20;
        if (typeof applyDriverTypeCommissionLock === 'function') applyDriverTypeCommissionLock('edit-driver-type', 'edit-driver-commission');
        
    } catch (error) { 
        console.error('Falha ao carregar dados do motorista:', error); 
        showCustomAlert('Erro', 'Erro ao carregar dados do motorista.', 'error'); 
        closeEditDriverModal(); 
    }
}

/**
 * Abre o modal com os detalhes de uma encomenda do histórico.
 * Agora mostra também:
 *  - Tempo Central → Recolha
 *  - Tempo Recolha → Entrega
 *  - Duração Total
 * @param {string} orderId - O ID da encomenda.
 */
async function openHistoryDetailModal(orderId) {
    const modal = document.getElementById('history-detail-modal');
    modal.dataset.orderId = orderId;
    const body = document.getElementById('history-modal-body');
    modal.classList.remove('hidden');
    document.getElementById('history-modal-id').innerText = `#${orderId.slice(-6)}`;
    body.innerHTML = '<p>A carregar detalhes...</p>';
    
    try {
        const response = await fetch(`${API_URL}/api/orders/${orderId}`, { headers: getAuthHeaders('admin') });
        if (response.status === 401) { await handle401Safely('admin'); return; }

        const data = await readJsonResponse(response);
        if (!response.ok) throw new Error(data.message);
        
        const order = data.order;
        const motorista = order.assigned_to_driver ? order.assigned_to_driver.user.nome : 'N/D';
        const admin = order.created_by_admin ? order.created_by_admin.nome : 'N/D';
        
        let coordsHtml = '<p><strong>Pin do Mapa:</strong> N/D</p>';
        if (order.address_coords && order.address_coords.lat) {
            coordsHtml = `<p><strong>Pin do Mapa:</strong> ${order.address_coords.lat.toFixed(5)}, ${order.address_coords.lng.toFixed(5)}</p>`;
        }

        const phases = getPhaseDurations(order);
        
        body.innerHTML = `
            <p><strong>Cliente:</strong> ${order.client_name}</p>
            <p><strong>Telefone:</strong> ${order.client_phone1}</p>
            <p><strong>Ponto de Recolha:</strong> ${order.pickup_address_text || 'N/D'}</p>
            <p><strong>Responsável na Recolha:</strong> ${order.pickup_contact_name || 'N/D'}</p>
            <p><strong>Contacto da Recolha:</strong> ${order.pickup_contact_phone || 'N/D'}</p>
            <p><strong>Orientações de Recolha:</strong> ${order.pickup_notes || 'N/D'}</p>
            <p><strong>Ponto de Entrega:</strong> ${order.address_text || 'N/D'}</p>
            ${coordsHtml}
            <p><strong>Distância:</strong> ${order.route_distance_km ? Number(order.route_distance_km).toFixed(2) + ' km' : 'N/D'}</p>
            <p><strong>Preço Serviço:</strong> ${order.service_price ? Number(order.service_price).toFixed(2) + ' MZN' : '0.00 MZN'}</p>
            <p><strong>Taxa Distância:</strong> ${order.delivery_fee ? Number(order.delivery_fee).toFixed(2) + ' MZN' : '0.00 MZN'}</p>
            <p><strong>Total:</strong> ${order.price ? Number(order.price).toFixed(2) + ' MZN' : 'N/D'}</p>
            <p><strong>Pagamento:</strong> ${typeof getPaymentMethodLabel === 'function' ? getPaymentMethodLabel(order.payment_method) : (order.payment_method || 'N/D')}</p>
            <p><strong>Estado do Pagamento:</strong> ${(order.payment_status || 'N/D').replace(/_/g, ' ')}</p>
            <p><strong>Valor confirmado:</strong> ${order.payment_confirmed_amount != null ? Number(order.payment_confirmed_amount).toFixed(2) + ' MZN' : 'N/D'}</p>
            <p><strong>Comentário do Motorista:</strong> ${order.driver_delivery_notes || 'N/D'}</p>
            <p><strong>Comprovativo de entrega:</strong> ${order.delivery_proof_available || order.delivery_proof_url ? `<button type="button" class="btn btn-secondary btn-sm" onclick="openAdminDeliveryProof('${escapeAdminOrderChat(orderId)}')">Abrir fotografia</button>` : 'N/D'}</p>
            <p><strong>Natureza:</strong> ${SERVICE_NAMES[order.service_type] || order.service_type}</p>
            <p><strong>Status:</strong> ${typeof getOrderStatusLabel === 'function' ? getOrderStatusLabel(order.status) : order.status}</p>
            <p><strong>Código:</strong> ${order.verification_code}</p>
            <p><strong>Motorista:</strong> ${motorista}</p>
            <p><strong>Admin:</strong> ${admin}</p>
            <p><strong>Criado em:</strong> ${order.createdAt ? new Date(order.createdAt).toLocaleString('pt-MZ') : 'N/D'}</p>
            <p><strong>Iniciado em:</strong> ${order.timestamp_started ? new Date(order.timestamp_started).toLocaleString('pt-MZ') : 'N/D'}</p>
            <p><strong>Concluído em:</strong> ${order.timestamp_completed ? new Date(order.timestamp_completed).toLocaleString('pt-MZ') : 'N/D'}</p>
            <hr class="modal-separator">
            <p><strong>Tempo Central → Recolha:</strong> ${phases.pickupLabel}</p>
            <p><strong>Tempo Recolha → Entrega:</strong> ${phases.deliveryLabel}</p>
            <p><strong>Duração Total:</strong> ${phases.totalLabel}</p>
        `;
    } catch (error) { 
        console.error('Falha ao carregar detalhes do histórico:', error); 
        body.innerHTML = '<p>Erro ao carregar detalhes.</p>'; 
    }
    if (!body.querySelector('.admin-order-chat') && !body.textContent.includes('Erro ao carregar')) {
        body.insertAdjacentHTML('beforeend', `
            <section class="admin-order-chat">
                <header><div><small>AUDITORIA DE CANAIS PRIVADOS</small><h3>Conversas do pedido</h3><p>Os canais Cliente ↔ Motorista e Motorista ↔ Loja são separados.</p></div><button type="button" class="btn btn-secondary" onclick="loadAdminOrderMessages('${orderId}')"><i class="fas fa-sync-alt"></i> Actualizar</button></header>
                <div id="admin-order-chat-stream" class="admin-order-chat-stream"><p>A carregar conversa…</p></div>
                <form class="admin-order-chat-form" onsubmit="sendAdminOrderMessage(event, '${orderId}')"><label>Canal<select name="channel" required><option value="client_driver">Cliente ↔ Motorista</option><option value="driver_partner">Motorista ↔ Loja</option></select></label><textarea name="message" maxlength="2000" required placeholder="Escreva apenas para o canal seleccionado"></textarea><button class="btn btn-primary" type="submit"><i class="fas fa-paper-plane"></i> Enviar</button></form>
            </section>
        `);
        await loadAdminOrderMessages(orderId);
    }
}

/**
 * Abre o modal de relatório de entregas de um motorista.
 * Agora mostra também, por linha:
 *  - C → R (Central → Recolha)
 *  - R → E (Recolha → Entrega)
 * @param {string} driverUserId - O ID do *User* do motorista.
 * @param {string} driverName - O nome do motorista.
 */
async function openDriverReportModal(driverUserId, driverName) {
    const modal = document.getElementById('driver-report-modal');
    modal.classList.remove('hidden');
    document.getElementById('driver-report-title').innerText = `Relatório de ${driverName}`;
    document.getElementById('report-total-entregas').innerText = '...';
    document.getElementById('report-total-duracao').innerText = '...';
    
    const tableBody = document.getElementById('driver-report-table-body');
    tableBody.innerHTML = '<tr><td colspan="5">A carregar relatório...</td></tr>';
    
    try {
        const response = await fetch(`${API_URL}/api/drivers/${driverUserId}/report`, { headers: getAuthHeaders('admin') });
        if (response.status === 401) { await handle401Safely('admin'); return; }

        const data = await readJsonResponse(response);
        if (!response.ok) throw new Error(data.message);
        
        const orders = data.orders;
        let totalMs = 0;

        orders.forEach(order => {
            const phases = getPhaseDurations(order);
            if (phases.totalMs) {
                totalMs += phases.totalMs;
            }
        });
        
        document.getElementById('report-total-entregas').innerText = orders.length;
        document.getElementById('report-total-duracao').innerText = formatTotalDuration(totalMs);
        
        tableBody.innerHTML = '';
        if (orders.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="5">Nenhuma entrega concluída encontrada.</td></tr>';
            return;
        }
        
        orders.forEach(order => {
            const serviceName = SERVICE_NAMES[order.service_type] || order.service_type;
            const phases = getPhaseDurations(order);

            tableBody.innerHTML += `
                <tr>
                    <td>#${order._id.slice(-6)}</td>
                    <td>${order.client_name}</td>
                    <td>${serviceName}</td>
                    <td>${new Date(order.timestamp_completed).toLocaleDateString('pt-MZ')}</td>
                    <td>
                        <div><strong>C → R:</strong> ${phases.pickupLabel}</div>
                        <div><strong>R → E:</strong> ${phases.deliveryLabel}</div>
                    </td>
                </tr>
            `;
        });
    } catch (error) { 
        console.error('Falha ao carregar relatório do motorista:', error); 
        tableBody.innerHTML = '<tr><td colspan="5">Erro ao carregar relatório.</td></tr>'; 
    }
}

/**
 * Abre o modal para editar os dados de um cliente.
 * @param {string} clientId - O ID do cliente.
 */
async function openEditClientModal(clientId) {
    const modal = document.getElementById('edit-client-modal');
    modal.classList.remove('hidden');
    
    // Limpa o formulário enquanto carrega
    document.getElementById('form-edit-cliente').reset();
    document.getElementById('edit-client-nome').value = 'A carregar...';
    document.getElementById('edit-client-telefone').value = 'A carregar...';

    try {
        const response = await fetch(`${API_URL}/api/clients/${clientId}`, { headers: getAuthHeaders('admin') });
        if (response.status === 401) { await handle401Safely('admin'); return; }

        const data = await readJsonResponse(response);
        if (!response.ok) throw new Error(data.message);
        
        const client = data.client;
        document.getElementById('edit-client-id').value = client._id;
        document.getElementById('edit-client-nome').value = client.nome;
        document.getElementById('edit-client-telefone').value = client.telefone;
        document.getElementById('edit-client-empresa').value = client.empresa || '';
        document.getElementById('edit-client-email').value = client.email || '';
        document.getElementById('edit-client-nuit').value = client.nuit || '';
        document.getElementById('edit-client-endereco').value = client.endereco || '';
        document.getElementById('edit-client-billing-type').value = client.billing_type || 'prepaid';
        document.getElementById('edit-client-credit-limit').value = client.credit_limit || 0;
        
    } catch (error) {
        console.error('Falha ao carregar dados do cliente:', error);
        showCustomAlert('Erro', 'Erro ao carregar dados do cliente.', 'error');
        closeEditClientModal();
    }
}

/**
 * Abre o modal de extrato (faturação) de um cliente.
 * @param {string} clientId - O ID do cliente.
 * @param {string} clientName - O nome do cliente.
 */
function openStatementModal(clientId, clientName) {
    const modal = document.getElementById('statement-modal');
    document.getElementById('statement-client-name').textContent = `Extrato de ${clientName}`;
    document.getElementById('statement-client-id').value = clientId;
    
    // Limpa o modal
    document.getElementById('statement-results').classList.add('hidden');
    document.getElementById('statement-table-body').innerHTML = '';
    document.getElementById('statement-start-date').value = '';
    document.getElementById('statement-end-date').value = '';
    
    modal.classList.remove('hidden');
}

/**
 * Preenche o modal de extrato com os resultados da API.
 * (Chamado por 'handleGenerateStatement' em adminApi.js)
 */
function populateStatementModal(data, startDate, endDate) {
    const { totalValue, totalOrders, ordersList, client, credit } = data;
    
    const formattedTotal = new Intl.NumberFormat('pt-MZ', { style: 'currency', currency: 'MZN' }).format(totalValue);
    document.getElementById('statement-total-value').textContent = formattedTotal;
    document.getElementById('statement-total-orders').textContent = `${totalOrders} Pedidos`;
    
    const start = new Date(startDate + 'T00:00:00Z').toLocaleDateString('pt-MZ', { timeZone: 'UTC' });
    const end = new Date(endDate + 'T00:00:00Z').toLocaleDateString('pt-MZ', { timeZone: 'UTC' });
    document.getElementById('statement-date-range').textContent = `Pedidos Concluídos de ${start} a ${end}`;
    if (client?.billing_type === 'postpaid' && credit) {
        document.getElementById('statement-date-range').textContent += ` · Crédito: ${Number(credit.balance || 0).toFixed(2)} / ${Number(credit.limit || 0).toFixed(2)} MZN`;
    }

    const tableBody = document.getElementById('statement-table-body');
    tableBody.innerHTML = '';
    
    if (ordersList.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="5">Nenhum pedido concluído neste período.</td></tr>';
    } else {
        ordersList.forEach(order => {
            tableBody.innerHTML += `
                <tr>
                    <td>${new Date(order.timestamp_completed).toLocaleDateString('pt-MZ')}</td>
                    <td>#${order._id.slice(-6)}</td>
                    <td>${SERVICE_NAMES[order.service_type] || order.service_type}</td>
                    <td>${order.price.toFixed(2)} MZN</td>
                    <td>${typeof getPaymentMethodLabel === 'function' ? getPaymentMethodLabel(order.payment_method) : (order.payment_method || '—')}</td>
                </tr>
            `;
        });
    }
    
    document.getElementById('statement-results').classList.remove('hidden');
}

/**
 * Gera e baixa um PDF do extrato do cliente.
 * (Chamado pelo event listener em admin.js)
 */
function handleDownloadPDF() {
    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        
        const clientName = document.getElementById('statement-client-name').textContent;
        const cleanClientName = clientName.replace('Extrato de ', '');
        const dateRange = document.getElementById('statement-date-range').textContent;
        const totalValue = document.getElementById('statement-total-value').textContent;
        const totalOrders = document.getElementById('statement-total-orders').textContent;

        doc.setFontSize(18);
        doc.text('Extrato de Conta de Cliente', 14, 22);
        
        doc.setFontSize(11);
        doc.setTextColor(100);
        doc.text(`Cliente: ${cleanClientName}`, 14, 32);
        doc.text(`Período: ${dateRange}`, 14, 38);
        
        doc.setFontSize(12);
        doc.setTextColor(0);
        doc.text(`Total de Pedidos: ${totalOrders}`, 14, 50);
        doc.text(`Valor Total Gasto: ${totalValue}`, 14, 56);

        doc.autoTable({
            html: '#statement-results .table-pedidos',
            startY: 65,
            theme: 'grid',
            styles: { fontSize: 9 },
            headStyles: { fillColor: [44, 62, 80] }
        });
        
        doc.save(`Extrato_${cleanClientName.replace(/ /g, '_')}.pdf`);

    } catch (error) {
        console.error('Erro ao gerar PDF:', error);
        showCustomAlert('Erro', 'Não foi possível gerar o PDF. Tente novamente.', 'error');
    }
}
