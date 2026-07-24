(function (global) {
  'use strict';

  const ROLE_LABELS = { client: 'Cliente', driver: 'Motorista', restaurant: 'Restaurante', admin: 'Admin' };
  const STATUS_LABELS = { open: 'Aberto', pending: 'Em atendimento', resolved: 'Resolvido', closed: 'Fechado' };
  const CATEGORY_LABELS = { order: 'Pedido', payment: 'Pagamento', account: 'Conta', technical: 'Problema técnico', restaurant: 'Restaurante', driver: 'Motorista', general: 'Geral' };
  const PRIORITY_LABELS = { low: 'Baixa', normal: 'Normal', high: 'Alta', urgent: 'Urgente' };
  const hubs = new Map();

  const safeJson = (value, fallback = null) => {
    try { return JSON.parse(value || '') || fallback; } catch (_error) { return fallback; }
  };

  const escapeHtml = (value) => String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');

  const formatDate = (value) => {
    const date = new Date(value || Date.now());
    if (Number.isNaN(date.getTime())) return 'Agora';
    return date.toLocaleString('pt-MZ', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  };

  const makeId = () => {
    if (global.crypto?.randomUUID) return `client_${global.crypto.randomUUID()}`;
    return `client_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  };

  function getIdentity(role) {
    if (role === 'admin') return { role, token: localStorage.getItem('adminToken') || '', id: '', name: 'Admin' };
    if (role === 'driver') return { role, token: localStorage.getItem('driverToken') || '', id: '', name: 'Motorista' };
    if (role === 'restaurant') {
      const profile = safeJson(localStorage.getItem('tragoRestaurantProfile'), {});
      return { role, token: localStorage.getItem('tragoRestaurantToken') || '', id: profile?.id || profile?._id || '', name: profile?.name || 'Restaurante' };
    }

    const session = safeJson(localStorage.getItem('tragoClientSession'), null);
    let supportSession = safeJson(localStorage.getItem('tragoClientSupportSession'), null);
    if (!session?.id && !supportSession?.id) {
      supportSession = { id: makeId(), name: 'Cliente' };
      localStorage.setItem('tragoClientSupportSession', JSON.stringify(supportSession));
    }
    const actor = session || supportSession;
    return { role: 'client', token: session?.token || '', id: actor.id, name: actor.name || actor.nome || 'Cliente' };
  }

  async function request(role, path, options = {}) {
    const identity = getIdentity(role);
    const method = options.method || 'GET';
    const payload = { ...(options.body || {}) };
    const headers = { Accept: 'application/json', ...(options.headers || {}) };
    let requestPath = path;

    if (identity.token) headers.Authorization = `Bearer ${identity.token}`;
    if (role === 'client') {
      if (method === 'GET') {
        const separator = requestPath.includes('?') ? '&' : '?';
        requestPath += `${separator}client_session_id=${encodeURIComponent(identity.id)}&client_name=${encodeURIComponent(identity.name)}`;
      } else {
        payload.client_session_id = identity.id;
        payload.client_name = identity.name;
      }
    }

    const init = { method, headers };
    if (method !== 'GET') {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(payload);
    }
    const base = typeof API_URL !== 'undefined' && typeof API_URL === 'string'
      ? API_URL
      : (typeof global.API_URL === 'string' ? global.API_URL : '');
    const response = await fetch(`${base}${requestPath}`, init);
    const data = await readJsonResponse(response);
    if (!response.ok) throw new Error(data.message || 'Não foi possível comunicar com o suporte.');
    return data;
  }

  const api = {
    listThreads: (role, status = '') => request(role, `/api/support/threads${status ? `?status=${encodeURIComponent(status)}` : ''}`),
    createThread: (role, payload) => request(role, '/api/support/threads', { method: 'POST', body: payload }),
    getMessages: (role, threadId) => request(role, `/api/support/threads/${encodeURIComponent(threadId)}/messages`),
    sendMessage: (role, threadId, message) => request(role, `/api/support/threads/${encodeURIComponent(threadId)}/messages`, { method: 'POST', body: { message } }),
    updateThread: (role, threadId, patch) => request(role, `/api/support/threads/${encodeURIComponent(threadId)}`, { method: 'PATCH', body: patch })
  };

  function createHub(root) {
    const role = root.dataset.supportRole || 'client';
    const isAdmin = role === 'admin';
    const state = { threads: [], selectedId: '', loading: false };
    const el = (name) => root.querySelector(`[data-support-${name}]`);

    function notify(message, kind = 'info') {
      const target = el('notice');
      if (target) {
        target.textContent = message;
        target.dataset.kind = kind;
        target.hidden = !message;
      }
      if (kind === 'error') console.warn('[TraGo Support]', message);
    }

    function setBusy(value) {
      state.loading = value;
      root.classList.toggle('is-loading', value);
      root.querySelectorAll('button[type="submit"]').forEach((button) => { button.disabled = value; });
    }

    function renderThreads() {
      const list = el('list');
      const count = el('count');
      if (count) count.textContent = String(state.threads.length);
      if (!list) return;
      if (!state.threads.length) {
        list.innerHTML = '<div class="support-empty-list"><i class="fa-regular fa-comments"></i><strong>Sem conversas</strong><span>Os pedidos de apoio aparecem aqui.</span></div>';
        return;
      }
      list.innerHTML = state.threads.map((thread) => {
        const id = thread._id || thread.id;
        const roleLabel = ROLE_LABELS[thread.requesterRole] || thread.requesterRole || '';
        return `<button type="button" class="support-thread-item ${String(id) === state.selectedId ? 'active' : ''}" data-support-thread="${escapeHtml(id)}">
          <span class="support-thread-icon role-${escapeHtml(thread.requesterRole || role)}"><i class="fa-solid ${thread.requesterRole === 'restaurant' ? 'fa-utensils' : thread.requesterRole === 'driver' ? 'fa-motorcycle' : thread.requesterRole === 'admin' ? 'fa-shield-halved' : 'fa-user'}"></i></span>
          <span><b>${escapeHtml(thread.subject)}</b><small>${isAdmin ? `${escapeHtml(thread.requesterName || roleLabel)} · ` : ''}${escapeHtml(formatDate(thread.lastMessageAt || thread.createdAt))}</small></span>
          <em class="support-status status-${escapeHtml(thread.status)}">${escapeHtml(STATUS_LABELS[thread.status] || thread.status)}</em>
        </button>`;
      }).join('');
    }

    function renderConversation(data) {
      const thread = data.thread || {};
      const messages = Array.isArray(data.messages) ? data.messages : [];
      const empty = el('conversation-empty');
      const panel = el('conversation');
      if (empty) empty.hidden = true;
      if (panel) panel.hidden = false;
      if (el('subject')) el('subject').textContent = thread.subject || 'Conversa';
      if (el('meta')) {
        const order = thread.orderId ? ` · Pedido #${String(thread.orderId).slice(-6).toUpperCase()}` : '';
        el('meta').textContent = `${CATEGORY_LABELS[thread.category] || 'Geral'}${order}`;
      }
      if (el('requester')) el('requester').textContent = `${ROLE_LABELS[thread.requesterRole] || thread.requesterRole}: ${thread.requesterName || 'Utilizador'}`;
      const status = el('status');
      const priority = el('priority');
      if (status) {
        status.querySelector('option[data-support-current]')?.remove();
        const currentStatus = thread.status || 'open';
        if (![...status.options].some((option) => option.value === currentStatus)) {
          const currentOption = document.createElement('option');
          currentOption.value = currentStatus;
          currentOption.textContent = STATUS_LABELS[currentStatus] || currentStatus;
          currentOption.dataset.supportCurrent = '1';
          currentOption.disabled = true;
          status.appendChild(currentOption);
        }
        status.value = currentStatus;
      }
      if (priority) priority.value = thread.priority || 'normal';
      const stream = el('messages');
      if (stream) {
        stream.innerHTML = messages.map((message) => {
          const mine = message.senderRole === role;
          return `<article class="support-message ${mine ? 'mine' : 'theirs'}">
            <div><strong>${escapeHtml(message.senderName || ROLE_LABELS[message.senderRole] || 'TraGo')}</strong><time>${escapeHtml(formatDate(message.createdAt))}</time></div>
            <p>${escapeHtml(message.body).replace(/\n/g, '<br>')}</p>
          </article>`;
        }).join('') || '<div class="support-empty-list"><span>A conversa ainda não tem mensagens.</span></div>';
        stream.scrollTop = stream.scrollHeight;
      }
    }

    async function load(selectFirst = false, force = false) {
      if (state.loading && !force) return;
      setBusy(true);
      try {
        const status = el('filter')?.value || '';
        const data = await api.listThreads(role, status);
        state.threads = Array.isArray(data.threads) ? data.threads : [];
        if (state.selectedId && !state.threads.some((item) => String(item._id || item.id) === state.selectedId)) state.selectedId = '';
        renderThreads();
        if (state.selectedId) await selectThread(state.selectedId, false);
        else if ((selectFirst || isAdmin) && state.threads[0]) await selectThread(state.threads[0]._id || state.threads[0].id, false);
      } catch (error) {
        notify(error.message, 'error');
        const list = el('list');
        if (list) list.innerHTML = `<div class="support-empty-list error"><i class="fa-solid fa-triangle-exclamation"></i><strong>Não foi possível carregar</strong><span>${escapeHtml(error.message)}</span></div>`;
      } finally { setBusy(false); }
    }

    async function selectThread(threadId, rerender = true) {
      state.selectedId = String(threadId);
      if (rerender) renderThreads();
      setBusy(true);
      try {
        const data = await api.getMessages(role, state.selectedId);
        renderConversation(data);
        notify('');
      } catch (error) { notify(error.message, 'error'); }
      finally { setBusy(false); }
    }

    root.addEventListener('click', (event) => {
      const threadButton = event.target.closest('[data-support-thread]');
      if (threadButton) selectThread(threadButton.dataset.supportThread);
      const newButton = event.target.closest('[data-support-new]');
      if (newButton) root.classList.toggle('creating');
      const closeButton = event.target.closest('[data-support-close-create]');
      if (closeButton) root.classList.remove('creating');
      const refreshButton = event.target.closest('[data-support-refresh]');
      if (refreshButton) load();
    });

    el('create-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const values = Object.fromEntries(new FormData(form).entries());
      setBusy(true);
      try {
        const data = await api.createThread(role, values);
        form.reset();
        root.classList.remove('creating');
        const createdId = String(data.thread?._id || data.thread?.id || '');
        state.selectedId = '';
        notify('Conversa criada. A equipa TraGo já recebeu a sua mensagem.', 'success');
        await load(false, true);
        const createdThread = state.threads.find((thread) => String(thread._id || thread.id) === createdId) || state.threads[0];
        if (createdThread) await selectThread(createdThread._id || createdThread.id);
      } catch (error) { notify(error.message, 'error'); }
      finally { setBusy(false); }
    });

    el('reply-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const input = el('reply');
      const message = input?.value.trim();
      if (!state.selectedId || !message) return;
      setBusy(true);
      try {
        await api.sendMessage(role, state.selectedId, message);
        input.value = '';
        notify('Mensagem enviada.', 'success');
        await selectThread(state.selectedId);
        await load();
      } catch (error) { notify(error.message, 'error'); }
      finally { setBusy(false); }
    });

    el('filter')?.addEventListener('change', () => load(true));
    el('status')?.addEventListener('change', async (event) => {
      if (!state.selectedId) return;
      try { await api.updateThread(role, state.selectedId, { status: event.target.value }); await load(); }
      catch (error) { notify(error.message, 'error'); }
    });
    el('priority')?.addEventListener('change', async (event) => {
      if (!state.selectedId || !isAdmin) return;
      try { await api.updateThread(role, state.selectedId, { priority: event.target.value }); await load(); }
      catch (error) { notify(error.message, 'error'); }
    });

    const controller = {
      load,
      open(options = {}) {
        const form = el('create-form');
        if (form && !isAdmin) {
          root.classList.add('creating');
          if (options.subject && form.elements.subject) form.elements.subject.value = options.subject;
          if (options.orderId && form.elements.order_id) form.elements.order_id.value = options.orderId;
          if (options.message && form.elements.message) form.elements.message.value = options.message;
          form.elements.message?.focus();
        }
        load(true);
      }
    };
    root._tragoSupportHub = controller;
    hubs.set(role, controller);
    load(isAdmin);
    window.setInterval(() => {
      if (root.isConnected && root.offsetParent !== null) load(false);
    }, 30000);
    return controller;
  }

  function init() {
    document.querySelectorAll('[data-support-hub]').forEach((root) => {
      if (!root._tragoSupportHub) createHub(root);
    });
    document.querySelectorAll('[data-support-new-shortcut]').forEach((button) => {
      if (button.dataset.supportBound === '1') return;
      button.dataset.supportBound = '1';
      button.addEventListener('click', () => {
        const panel = button.closest('.portal-panel, .content-section, .content-page') || document;
        panel.querySelector('[data-support-hub]')?._tragoSupportHub?.open?.();
      });
    });
  }

  global.TragoSupport = {
    ...api,
    mount: createHub,
    init,
    openHub(role, options) { hubs.get(role)?.open(options); },
    labels: { roles: ROLE_LABELS, statuses: STATUS_LABELS, categories: CATEGORY_LABELS, priorities: PRIORITY_LABELS }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
