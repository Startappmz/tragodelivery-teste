/*
 * Ficheiro: js/common/ui.js
 * (Garante que 'closeConfirmationModal' existe)
 */

// --- (MELHORIA) Constantes de Nomes de Serviço ---
const SERVICE_NAMES = {
    doc: 'Tram. Documentos',
    farma: 'Farmácia',
    carga: 'Cargas',
    rapido: 'Delivery Rápido',
    restaurante_comida: 'Comida de Restaurante',
    mercadoria_cp: 'Mercadoria C/P',
    refeicao_restaurante_p: 'Refeição Restaurante P',
    outros: 'Outros'
};

/* --- Funções de Alerta Customizado --- */
function showCustomAlert(title, message, type = 'info') {
    // ... (código sem alterações) ...
    const modal = document.getElementById('custom-alert-modal');
    if (!modal) { 
        if (window.TragoFeedback) {
            window.TragoFeedback.alert({ title, message, type });
        } else {
            console[type === 'error' ? 'error' : 'info'](`[TraGo] ${title}: ${message}`);
        }
        return; 
    }
    const modalContent = modal.querySelector('.modal-content');
    modalContent.classList.remove('success', 'error');
    if (type === 'success') modalContent.classList.add('success');
    if (type === 'error') modalContent.classList.add('error');
    document.getElementById('custom-alert-title').innerText = title;
    document.getElementById('custom-alert-message').innerText = message;
    modal.classList.remove('hidden');
}
function closeCustomAlert() {
    // ... (código sem alterações) ...
    const modal = document.getElementById('custom-alert-modal');
    if (modal) modal.classList.add('hidden');
}

/* --- Funções de Fecho de Modais --- */
function closeAssignModal() { 
    document.getElementById('assign-modal').classList.add('hidden'); 
}
function closeEditDriverModal() { 
    document.getElementById('edit-driver-modal').classList.add('hidden'); 
    document.getElementById('form-edit-motorista').reset();
}
function closeHistoryDetailModal() { 
    document.getElementById('history-detail-modal').classList.add('hidden'); 
}
function closeDriverReportModal() { 
    document.getElementById('driver-report-modal').classList.add('hidden'); 
}
function closeEditClientModal() {
    document.getElementById('edit-client-modal').classList.add('hidden');
    document.getElementById('form-edit-cliente').reset();
}
function closeStatementModal() {
    document.getElementById('statement-modal').classList.add('hidden');
}

// --- (CORREÇÃO ADICIONADA) ---
/**
 * Fecha o modal genérico de confirmação.
 */
function closeConfirmationModal() {
    const modal = document.getElementById('confirmation-modal');
    if(modal) {
        modal.classList.add('hidden');
        // Limpa o input para a próxima vez
        document.getElementById('confirmation-input').value = '';
    }
}
// --- FIM DA CORREÇÃO ---


/* --- Funções de Toggle de Formulários --- */
// ... (showAddDriverForm, showAddClientForm - sem alterações) ...
function showAddDriverForm(show) {
    if (show && typeof showPage === 'function') {
        showPage('cargos', 'nav-cargos', 'Cargos');
        if (typeof loadVehiclesIntoSelects === 'function') loadVehiclesIntoSelects();
    }
    const form = document.getElementById('form-add-motorista');
    const button = document.getElementById('btn-show-driver-form');
    if (!form || !button) return;
    if (show) { 
        form.classList.remove('hidden'); 
        button.classList.add('hidden');
        setTimeout(() => form.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
    } else { 
        form.classList.add('hidden'); 
        button.classList.remove('hidden'); 
        form.reset(); 
    }
}
function showAddClientForm(show) {
    if (show && typeof showPage === 'function') {
        showPage('cargos', 'nav-cargos', 'Cargos');
    }
    const form = document.getElementById('form-add-cliente');
    const button = document.getElementById('btn-show-client-form');
    if (!form || !button) return;
    if (show) { 
        form.classList.remove('hidden'); 
        button.classList.add('hidden');
        setTimeout(() => form.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
    } else { 
        form.classList.add('hidden'); 
        button.classList.remove('hidden'); 
        form.reset(); 
    }
}

/* --- Funções Auxiliares de Formulários (Upload de Imagem) --- */
// ... (handleImageUpload, removeImage - sem alterações) ...
function handleImageUpload(event) { 
    const file = event.target.files[0]; 
    if (!file) return; 
    const previewContainer = document.getElementById('image-preview'); 
    const previewImg = previewContainer.querySelector('.preview-img'); 
    const reader = new FileReader(); 
    reader.onload = function(e) { 
        previewImg.src = e.target.result; 
    }; 
    reader.readAsDataURL(file); 
    previewContainer.classList.remove('hidden'); 
}
function removeImage() { 
    const previewContainer = document.getElementById('image-preview'); 
    if (!previewContainer) return; 
    previewContainer.querySelector('.preview-img').src = ''; 
    previewContainer.classList.add('hidden'); 
    document.getElementById('delivery-image').value = ''; 
}

/* --- Funções Auxiliares de Formatação --- */
// ... (formatDuration, formatTotalDuration, filterHistoryTable, setStatementDates - sem alterações) ...
function formatDuration(start, end) { 
    if (!start || !end) return 'N/D'; 
    const diffMs = new Date(end) - new Date(start); 
    if (diffMs < 0) return 'N/D'; 
    const minutes = Math.floor(diffMs / 60000); 
    const seconds = Math.floor((diffMs % 60000) / 1000); 
    return `${minutes} min ${seconds} s`; 
}
function formatTotalDuration(totalMs) { 
    if (totalMs < 0) return 'N/D'; 
    const totalMinutes = Math.floor(totalMs / 60000); 
    const hours = Math.floor(totalMinutes / 60); 
    const minutes = totalMinutes % 60; 
    return `${hours} h ${minutes} min`; 
}
function filterHistoryTable(event) {
    const searchTerm = event.target.value.toLowerCase();
    const tableBody = document.getElementById('history-orders-table-body');
    const rows = tableBody.getElementsByTagName('tr');
    for (const row of rows) {
        if (row.getElementsByTagName('td').length > 1) {
            const rowText = row.textContent.toLowerCase();
            row.style.display = rowText.includes(searchTerm) ? '' : 'none';
        }
    }
}
function setStatementDates(range) {
    const today = new Date();
    const endDate = new Date();
    let startDate = new Date();
    if (range === 'this_week') {
        const dayOfWeek = today.getDay();
        startDate.setDate(today.getDate() - dayOfWeek);
    } else if (range === 'this_month') {
        startDate.setDate(1);
    }
    document.getElementById('statement-start-date').value = startDate.toISOString().split('T')[0];
    document.getElementById('statement-end-date').value = endDate.toISOString().split('T')[0];
}

/* --- Design system: labels de tabela para mobile --- */
(function installTableLabelEnhancer() {
    function enhanceTable(table) {
        if (!table || !table.querySelector) return;
        const headers = Array.from(table.querySelectorAll('thead th')).map((th) => th.textContent.trim());
        if (!headers.length) return;

        table.querySelectorAll('tbody tr').forEach((row) => {
            Array.from(row.children).forEach((cell, index) => {
                if (cell.tagName !== 'TD' || cell.hasAttribute('colspan')) return;
                cell.setAttribute('data-label', headers[index] || '');
            });
        });
    }

    function enhanceAllTables(root = document) {
        root.querySelectorAll('table').forEach(enhanceTable);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => enhanceAllTables());
    } else {
        enhanceAllTables();
    }

    const observer = new MutationObserver((mutations) => {
        let shouldEnhance = false;
        mutations.forEach((mutation) => {
            if (mutation.addedNodes.length) shouldEnhance = true;
        });
        if (shouldEnhance) requestAnimationFrame(() => enhanceAllTables());
    });

    if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
    } else {
        document.addEventListener('DOMContentLoaded', () => {
            observer.observe(document.body, { childList: true, subtree: true });
        });
    }
})();
