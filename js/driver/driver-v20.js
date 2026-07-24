(function () {
  'use strict';

  const getName = () => localStorage.getItem('driverName') || document.getElementById('driver-name-header')?.textContent || 'Motorista';

  function syncDriverIdentity() {
    const fullName = String(getName()).trim() || 'Motorista';
    const firstName = fullName.split(/\s+/)[0];
    const initial = firstName.slice(0, 1).toUpperCase() || 'M';
    document.querySelectorAll('[data-driver-first-name]').forEach((node) => { node.textContent = firstName.toLowerCase(); });
    document.querySelectorAll('[data-driver-full-name]').forEach((node) => { node.textContent = fullName; });
    document.querySelectorAll('.driver-avatar').forEach((node) => { node.textContent = initial; });
  }

  function openOrderSupport() {
    const detail = document.getElementById('detalhe-entrega');
    const orderId = detail?.dataset.orderId || '';
    const shortCode = orderId ? `#${orderId.slice(-6).toUpperCase()}` : '';
    if (typeof window.showDriverPage === 'function') window.showDriverPage('suporte-motorista');
    setTimeout(() => window.TragoSupport?.openHub?.('driver', {
      subject: `Ajuda com a entrega ${shortCode}`.trim(),
      orderId,
      message: `Preciso de apoio da central relativamente à entrega ${shortCode}. `
    }), 40);
  }

  function attachV20Events() {
    syncDriverIdentity();
    document.getElementById('driver-support-order')?.addEventListener('click', openOrderSupport);
    document.getElementById('btn-reativar-localizacao')?.addEventListener('click', () => {
      if (typeof window.restartLocationTracking === 'function') window.restartLocationTracking();
    });

    const name = document.getElementById('driver-name-header');
    if (name && window.MutationObserver) new MutationObserver(syncDriverIdentity).observe(name, { childList: true, subtree: true });

    document.addEventListener('support_thread_created', () => window.TragoSupport?.openHub?.('driver'));
    document.addEventListener('support_message_created', () => window.TragoSupport?.openHub?.('driver'));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attachV20Events);
  else attachV20Events();
})();
