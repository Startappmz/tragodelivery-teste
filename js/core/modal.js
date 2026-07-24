const openModals = [];
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function appendSafeContent(container, content) {
  if (content == null) return;
  if (content instanceof Node) container.append(content);
  else container.textContent = String(content);
}

function focusableElements(container) {
  return [...container.querySelectorAll(FOCUSABLE)].filter((element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true');
}

export function createModal(options = {}) {
  if (typeof document === 'undefined') throw new Error('Modais só estão disponíveis no navegador.');
  const previouslyFocused = document.activeElement;
  const backdrop = document.createElement('div');
  backdrop.className = 'trago-modal-backdrop';
  backdrop.dataset.tragoModal = options.id || '';

  const dialog = document.createElement('section');
  dialog.className = `trago-modal trago-modal--${options.size || 'medium'}`;
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.tabIndex = -1;

  const header = document.createElement('header');
  header.className = 'trago-modal__header';
  const title = document.createElement('h2');
  title.className = 'trago-modal__title';
  title.id = `trago-modal-title-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  title.textContent = options.title || 'Informação';
  dialog.setAttribute('aria-labelledby', title.id);

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'trago-modal__close';
  closeButton.setAttribute('aria-label', 'Fechar janela');
  closeButton.textContent = '×';
  header.append(title, closeButton);

  const body = document.createElement('div');
  body.className = 'trago-modal__body';
  appendSafeContent(body, options.content);
  dialog.append(header, body);

  if (Array.isArray(options.actions) && options.actions.length) {
    const footer = document.createElement('footer');
    footer.className = 'trago-modal__footer';
    options.actions.forEach((action) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `trago-button trago-button--${action.variant || 'secondary'}`;
      button.textContent = action.label;
      button.disabled = Boolean(action.disabled);
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          const result = await action.onClick?.(controller);
          if (result !== false && action.close !== false) controller.close(action.value);
        } finally {
          if (backdrop.isConnected) button.disabled = Boolean(action.disabled);
        }
      });
      footer.append(button);
    });
    dialog.append(footer);
  }

  backdrop.append(dialog);
  let settled = false;
  let resolveClosed;
  const closed = new Promise((resolve) => { resolveClosed = resolve; });

  const controller = Object.freeze({
    element: backdrop,
    dialog,
    body,
    closed,
    setContent(content) {
      body.replaceChildren();
      appendSafeContent(body, content);
    },
    close(result = null) {
      if (settled) return;
      settled = true;
      backdrop.classList.add('trago-modal-backdrop--leaving');
      openModals.splice(openModals.indexOf(controller), 1);
      const remove = () => {
        backdrop.remove();
        document.body.classList.toggle('trago-modal-open', openModals.length > 0);
        if (previouslyFocused?.isConnected) previouslyFocused.focus();
      };
      backdrop.addEventListener('animationend', remove, { once: true });
      setTimeout(remove, 250);
      resolveClosed(result);
      options.onClose?.(result);
    }
  });

  const dismissible = options.dismissible !== false;
  closeButton.hidden = !dismissible;
  closeButton.addEventListener('click', () => controller.close(null));
  backdrop.addEventListener('mousedown', (event) => {
    if (dismissible && event.target === backdrop) controller.close(null);
  });
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && dismissible) {
      event.preventDefault();
      controller.close(null);
      return;
    }
    if (event.key !== 'Tab') return;
    const elements = focusableElements(dialog);
    if (!elements.length) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = elements[0];
    const last = elements[elements.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  document.body.append(backdrop);
  document.body.classList.add('trago-modal-open');
  openModals.push(controller);
  requestAnimationFrame(() => {
    backdrop.classList.add('trago-modal-backdrop--visible');
    const target = options.initialFocus ? dialog.querySelector(options.initialFocus) : focusableElements(dialog)[0];
    (target || dialog).focus();
  });
  return controller;
}

export function confirmDialog(options = {}) {
  const modal = createModal({
    title: options.title || 'Confirmar acção',
    content: options.message || 'Deseja continuar?',
    size: 'small',
    dismissible: options.dismissible !== false,
    actions: [
      { label: options.cancelLabel || 'Cancelar', variant: 'secondary', value: false },
      { label: options.confirmLabel || 'Confirmar', variant: options.danger ? 'danger' : 'primary', value: true }
    ]
  });
  return modal.closed.then(Boolean);
}
