const DEFAULT_LOCALE = 'pt-MZ';

export function toNumber(value, fallback = 0) {
  const parsed = typeof value === 'string' ? Number(value.replace(',', '.')) : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function formatCurrency(value, options = {}) {
  return new Intl.NumberFormat(options.locale || DEFAULT_LOCALE, {
    style: 'currency',
    currency: options.currency || 'MZN',
    currencyDisplay: options.currencyDisplay || 'code',
    minimumFractionDigits: options.minimumFractionDigits ?? 2,
    maximumFractionDigits: options.maximumFractionDigits ?? 2
  }).format(toNumber(value));
}

export function formatDate(value, options = {}) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return options.fallback || '—';
  return new Intl.DateTimeFormat(options.locale || DEFAULT_LOCALE, {
    day: '2-digit',
    month: options.month || 'short',
    year: 'numeric',
    ...options.format
  }).format(date);
}

export function formatDateTime(value, options = {}) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return options.fallback || '—';
  return new Intl.DateTimeFormat(options.locale || DEFAULT_LOCALE, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    ...options.format
  }).format(date);
}

export function formatRelativeTime(value, options = {}) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return options.fallback || '—';
  const difference = date.getTime() - (options.now ? new Date(options.now).getTime() : Date.now());
  const absolute = Math.abs(difference);
  const units = [
    ['year', 365 * 24 * 60 * 60 * 1000],
    ['month', 30 * 24 * 60 * 60 * 1000],
    ['day', 24 * 60 * 60 * 1000],
    ['hour', 60 * 60 * 1000],
    ['minute', 60 * 1000]
  ];
  const [unit, divisor] = units.find(([, size]) => absolute >= size) || ['second', 1000];
  return new Intl.RelativeTimeFormat(options.locale || DEFAULT_LOCALE, { numeric: 'auto' })
    .format(Math.round(difference / divisor), unit);
}

export function formatPhone(value) {
  const digits = String(value || '').replace(/\D/g, '').replace(/^258/, '');
  if (digits.length !== 9) return String(value || '');
  return `+258 ${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5)}`;
}

export function formatDistance(metres) {
  const value = toNumber(metres);
  if (value < 1000) return `${Math.round(value)} m`;
  return `${(value / 1000).toLocaleString(DEFAULT_LOCALE, { maximumFractionDigits: 1 })} km`;
}

export function formatDuration(seconds) {
  const totalMinutes = Math.max(0, Math.round(toNumber(seconds) / 60));
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${hours} h ${minutes} min` : `${hours} h`;
}

export function formatOrderCode(value) {
  const code = String(value || '').trim().replace(/^#/, '').toUpperCase();
  return code ? `#${code}` : '—';
}

export function getInitials(value, maximum = 2) {
  return String(value || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, maximum)
    .map((part) => part[0])
    .join('')
    .toUpperCase() || '?';
}
