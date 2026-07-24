/* TraGo · feedback visual comum a todos os portais */
(() => {
  let activeDialog = null;
  let lastFocused = null;

  function ensureToastRegion() {
    let region = document.querySelector('.trago-feedback-toasts');
    if (region) return region;
    region = document.createElement('div');
    region.className = 'trago-feedback-toasts';
    region.setAttribute('aria-live', 'polite');
    region.setAttribute('aria-atomic', 'true');
    document.body.append(region);
    return region;
  }

  function notify(message, options = {}) {
    if (!message) return;
    const settings = typeof options === 'string' ? { type: options } : options;
    const type = ['success', 'error', 'warning', 'info'].includes(settings.type) ? settings.type : 'success';
    const icons = { success: 'fa-circle-check', error: 'fa-circle-exclamation', warning: 'fa-triangle-exclamation', info: 'fa-circle-info' };
    const titles = { success: 'Concluído', error: 'Não foi possível', warning: 'Atenção', info: 'Informação' };
    const toast = document.createElement('article');
    toast.className = `trago-feedback-toast is-${type}`;
    toast.innerHTML = `
      <i class="fa-solid ${icons[type]}" aria-hidden="true"></i>
      <span><strong>${escapeHtml(settings.title || titles[type])}</strong><small>${escapeHtml(message)}</small></span>
      <button type="button" aria-label="Fechar"><i class="fa-solid fa-xmark"></i></button>
      <b aria-hidden="true"></b>`;
    const close = () => {
      toast.classList.add('is-leaving');
      window.setTimeout(() => toast.remove(), 220);
    };
    toast.querySelector('button').addEventListener('click', close);
    ensureToastRegion().append(toast);
    requestAnimationFrame(() => toast.classList.add('is-visible'));
    window.setTimeout(close, Number(settings.duration || (type === 'error' ? 5200 : 3600)));
    return toast;
  }

  function closeDialog(value) {
    if (!activeDialog) return;
    const { root, resolve, keyHandler } = activeDialog;
    activeDialog = null;
    document.removeEventListener('keydown', keyHandler);
    root.classList.add('is-leaving');
    document.body.classList.remove('trago-feedback-open');
    window.setTimeout(() => root.remove(), 180);
    lastFocused?.focus?.({ preventScroll: true });
    resolve(value);
  }

  function openDialog(options = {}) {
    if (activeDialog) closeDialog(null);
    lastFocused = document.activeElement;
    const type = ['success', 'error', 'warning', 'info'].includes(options.type) ? options.type : 'info';
    const icons = { success: 'fa-circle-check', error: 'fa-circle-exclamation', warning: 'fa-triangle-exclamation', info: 'fa-circle-info' };
    const root = document.createElement('section');
    root.className = `trago-feedback-dialog is-${type}`;
    root.setAttribute('role', 'presentation');
    const input = options.inputType ? `
      <label class="trago-feedback-field">
        <span>${escapeHtml(options.label || '')}</span>
        <input type="${escapeHtml(options.inputType)}" placeholder="${escapeHtml(options.placeholder || '')}" value="${escapeHtml(options.value || '')}" autocomplete="${options.inputType === 'password' ? 'current-password' : 'off'}">
        <small data-feedback-error></small>
      </label>` : '';
    root.innerHTML = `
      <button class="trago-feedback-backdrop" type="button" tabindex="-1" aria-label="Fechar"></button>
      <article role="dialog" aria-modal="true" aria-labelledby="trago-feedback-title">
        <header>
          <span><i class="fa-solid ${icons[type]}" aria-hidden="true"></i></span>
          <button type="button" data-feedback-close aria-label="Fechar"><i class="fa-solid fa-xmark"></i></button>
        </header>
        <div class="trago-feedback-copy">
          <small>${escapeHtml(options.kicker || 'TRAGO')}</small>
          <h2 id="trago-feedback-title">${escapeHtml(options.title || 'Confirmação')}</h2>
          <p>${escapeHtml(options.message || '')}</p>
        </div>
        ${input}
        <footer>
          ${options.cancelText === null ? '' : `<button type="button" class="trago-feedback-cancel" data-feedback-cancel>${escapeHtml(options.cancelText || 'Cancelar')}</button>`}
          <button type="button" class="trago-feedback-confirm" data-feedback-confirm>${escapeHtml(options.confirmText || 'Continuar')}</button>
        </footer>
      </article>`;
    document.body.append(root);
    document.body.classList.add('trago-feedback-open');

    return new Promise((resolve) => {
      const field = root.querySelector('input');
      const error = root.querySelector('[data-feedback-error]');
      const cancelValue = options.inputType ? null : false;
      const cancel = () => closeDialog(cancelValue);
      const confirm = () => {
        const value = field ? field.value : true;
        const validationMessage = typeof options.validate === 'function' ? options.validate(value) : '';
        if (validationMessage) {
          error.textContent = validationMessage;
          field.setAttribute('aria-invalid', 'true');
          field.focus();
          return;
        }
        closeDialog(value);
      };
      const keyHandler = (event) => {
        if (event.key === 'Escape') cancel();
        if (event.key === 'Enter' && (!field || event.target === field)) {
          event.preventDefault();
          confirm();
        }
      };
      activeDialog = { root, resolve, keyHandler };
      document.addEventListener('keydown', keyHandler);
      root.querySelector('.trago-feedback-backdrop').addEventListener('click', cancel);
      root.querySelector('[data-feedback-close]').addEventListener('click', cancel);
      root.querySelector('[data-feedback-cancel]')?.addEventListener('click', cancel);
      root.querySelector('[data-feedback-confirm]').addEventListener('click', confirm);
      field?.addEventListener('input', () => {
        field.removeAttribute('aria-invalid');
        error.textContent = '';
      });
      requestAnimationFrame(() => {
        root.classList.add('is-open');
        (field || root.querySelector('[data-feedback-confirm]')).focus();
      });
    });
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[character]));
  }

  window.TragoFeedback = Object.freeze({
    notify,
    alert(options = {}) {
      return openDialog({ ...options, cancelText: null, confirmText: options.confirmText || 'Entendido' });
    },
    confirm(options = {}) {
      return openDialog(options);
    },
    prompt(options = {}) {
      return openDialog({ ...options, inputType: options.inputType || 'text' });
    }
  });
})();
