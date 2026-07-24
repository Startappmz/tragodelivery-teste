const DEFAULT_DURATION = 4200;
const toastTimers = new WeakMap();

function ensureDocument() {
  if (typeof document === 'undefined') throw new Error('Toasts só estão disponíveis no navegador.');
}

export function getToastRegion() {
  ensureDocument();
  let region = document.querySelector('[data-trago-toast-region]');
  if (region) return region;

  region = document.createElement('section');
  region.className = 'trago-toast-region';
  region.dataset.tragoToastRegion = '';
  region.setAttribute('aria-label', 'Notificações');
  region.setAttribute('aria-live', 'polite');
  region.setAttribute('aria-relevant', 'additions');
  document.body.append(region);
  return region;
}

export function dismissToast(toast) {
  if (!toast?.isConnected) return;
  const timer = toastTimers.get(toast);
  if (timer) clearTimeout(timer);
  toast.classList.add('trago-toast--leaving');
  const remove = () => toast.remove();
  toast.addEventListener('animationend', remove, { once: true });
  setTimeout(remove, 250);
}

export function showToast(message, options = {}) {
  const region = getToastRegion();
  const type = ['success', 'error', 'warning', 'info'].includes(options.type) ? options.type : 'info';
  const toast = document.createElement('article');
  toast.className = `trago-toast trago-toast--${type}`;
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status');

  const marker = document.createElement('span');
  marker.className = 'trago-toast__marker';
  marker.setAttribute('aria-hidden', 'true');

  const content = document.createElement('div');
  content.className = 'trago-toast__content';
  if (options.title) {
    const title = document.createElement('strong');
    title.className = 'trago-toast__title';
    title.textContent = String(options.title);
    content.append(title);
  }
  const text = document.createElement('p');
  text.className = 'trago-toast__message';
  text.textContent = String(message || '');
  content.append(text);

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'trago-toast__close';
  close.setAttribute('aria-label', 'Fechar notificação');
  close.textContent = '×';
  close.addEventListener('click', () => dismissToast(toast));

  toast.append(marker, content, close);
  region.append(toast);

  const duration = options.persistent ? 0 : Number(options.duration ?? DEFAULT_DURATION);
  if (duration > 0) toastTimers.set(toast, setTimeout(() => dismissToast(toast), duration));
  return toast;
}

export function clearToasts() {
  if (typeof document === 'undefined') return;
  document.querySelectorAll('[data-trago-toast-region] .trago-toast').forEach(dismissToast);
}

export const toast = Object.freeze({
  success: (message, options = {}) => showToast(message, { ...options, type: 'success' }),
  error: (message, options = {}) => showToast(message, { ...options, type: 'error' }),
  warning: (message, options = {}) => showToast(message, { ...options, type: 'warning' }),
  info: (message, options = {}) => showToast(message, { ...options, type: 'info' }),
  dismiss: dismissToast,
  clear: clearToasts
});
