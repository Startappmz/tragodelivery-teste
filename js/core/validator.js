const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^(?:\+?258)?[278]\d{8}$/;

const isEmpty = (value) => value == null || (typeof value === 'string' && value.trim() === '') || (Array.isArray(value) && value.length === 0);

export const validators = Object.freeze({
  required(value, parameter, label) {
    if (parameter !== false && isEmpty(value)) return `${label} é obrigatório.`;
    return null;
  },
  email(value, parameter, label) {
    if (!parameter || isEmpty(value) || EMAIL_PATTERN.test(String(value).trim())) return null;
    return `${label} deve ter um email válido.`;
  },
  phone(value, parameter, label) {
    const normalized = String(value || '').replace(/[\s()-]/g, '');
    if (!parameter || isEmpty(value) || PHONE_PATTERN.test(normalized)) return null;
    return `${label} deve ter um número moçambicano válido.`;
  },
  minLength(value, parameter, label) {
    if (isEmpty(value) || String(value).length >= Number(parameter)) return null;
    return `${label} deve ter pelo menos ${parameter} caracteres.`;
  },
  maxLength(value, parameter, label) {
    if (isEmpty(value) || String(value).length <= Number(parameter)) return null;
    return `${label} deve ter no máximo ${parameter} caracteres.`;
  },
  min(value, parameter, label) {
    if (isEmpty(value) || Number(value) >= Number(parameter)) return null;
    return `${label} deve ser igual ou superior a ${parameter}.`;
  },
  max(value, parameter, label) {
    if (isEmpty(value) || Number(value) <= Number(parameter)) return null;
    return `${label} deve ser igual ou inferior a ${parameter}.`;
  },
  integer(value, parameter, label) {
    if (!parameter || isEmpty(value) || Number.isInteger(Number(value))) return null;
    return `${label} deve ser um número inteiro.`;
  },
  sameAs(value, parameter, label, data) {
    if (value === data?.[parameter]) return null;
    return `${label} não coincide.`;
  },
  pattern(value, parameter, label) {
    if (isEmpty(value)) return null;
    const expression = parameter instanceof RegExp ? parameter : new RegExp(parameter);
    return expression.test(String(value)) ? null : `${label} tem um formato inválido.`;
  },
  accepted(value, parameter, label) {
    if (!parameter || value === true || value === 'true' || value === 'on' || value === 1 || value === '1') return null;
    return `${label} deve ser aceite.`;
  }
});

function normalizeRule(rule) {
  if (typeof rule === 'string') return { name: rule, value: true };
  if (typeof rule === 'function') return { name: 'custom', validate: rule, value: true };
  if (rule && typeof rule === 'object' && rule.name) return rule;
  throw new TypeError('Regra de validação inválida.');
}

export function validateValue(value, rules = [], context = {}) {
  const normalizedRules = Array.isArray(rules) ? rules : Object.entries(rules).map(([name, parameter]) => ({ name, value: parameter }));
  const errors = [];

  for (const inputRule of normalizedRules) {
    const rule = normalizeRule(inputRule);
    const validate = rule.validate || validators[rule.name];
    if (typeof validate !== 'function') throw new TypeError(`Validador desconhecido: ${rule.name}`);
    const message = validate(value, rule.value, context.label || context.field || 'Este campo', context.data || {}, context);
    if (message) errors.push(rule.message || message);
    if (message && context.firstOnly !== false) break;
  }
  return errors;
}

export function validateData(data = {}, schema = {}) {
  const errors = {};
  for (const [field, definition] of Object.entries(schema)) {
    const rules = Array.isArray(definition) ? definition : definition.rules || [];
    const label = Array.isArray(definition) ? field : definition.label || field;
    const fieldErrors = validateValue(data[field], rules, { field, label, data });
    if (fieldErrors.length) errors[field] = fieldErrors;
  }
  const firstField = Object.keys(errors)[0];
  return {
    valid: !firstField,
    errors,
    firstError: firstField ? errors[firstField][0] : null
  };
}

export function formToObject(form) {
  if (!(form instanceof HTMLFormElement)) throw new TypeError('É necessário fornecer um formulário HTML.');
  const result = {};
  const formData = new FormData(form);
  for (const [key, value] of formData.entries()) {
    if (Object.prototype.hasOwnProperty.call(result, key)) {
      result[key] = Array.isArray(result[key]) ? [...result[key], value] : [result[key], value];
    } else {
      result[key] = value;
    }
  }
  form.querySelectorAll('input[type="checkbox"][name]').forEach((field) => {
    if (!formData.has(field.name)) result[field.name] = false;
  });
  return result;
}

export function renderFieldErrors(form, errors = {}) {
  if (!(form instanceof HTMLFormElement)) return;
  form.querySelectorAll('[data-field-error]').forEach((node) => {
    node.textContent = '';
    node.hidden = true;
  });
  form.querySelectorAll('[aria-invalid="true"]').forEach((field) => field.removeAttribute('aria-invalid'));

  Object.entries(errors).forEach(([fieldName, messages]) => {
    const field = form.elements.namedItem(fieldName);
    const errorNode = form.querySelector(`[data-field-error="${CSS.escape(fieldName)}"]`);
    if (field?.setAttribute) field.setAttribute('aria-invalid', 'true');
    if (errorNode) {
      errorNode.textContent = messages[0] || '';
      errorNode.hidden = false;
      if (field?.setAttribute && errorNode.id) field.setAttribute('aria-describedby', errorNode.id);
    }
  });
}

export function validateForm(form, schema, { render = true } = {}) {
  const data = formToObject(form);
  const result = validateData(data, schema);
  if (render) renderFieldErrors(form, result.errors);
  return { ...result, data };
}
