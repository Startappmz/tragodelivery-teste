import { apiRequest } from './api.js';

const DEFAULT_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export class UploadValidationError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'UploadValidationError';
    this.code = code;
  }
}

export function validateUpload(file, options = {}) {
  const maxBytes = Number(options.maxBytes || 5 * 1024 * 1024);
  const acceptedTypes = options.acceptedTypes || DEFAULT_IMAGE_TYPES;
  if (!(file instanceof Blob)) throw new UploadValidationError('Seleccione um ficheiro válido.', 'FILE_REQUIRED');
  if (file.size === 0) throw new UploadValidationError('O ficheiro está vazio.', 'FILE_EMPTY');
  if (file.size > maxBytes) {
    const megabytes = Math.round((maxBytes / (1024 * 1024)) * 10) / 10;
    throw new UploadValidationError(`O ficheiro não pode exceder ${megabytes} MB.`, 'FILE_TOO_LARGE');
  }
  if (acceptedTypes.length && !acceptedTypes.includes(file.type)) {
    throw new UploadValidationError('Formato de ficheiro não suportado.', 'FILE_TYPE_NOT_ALLOWED');
  }
  return file;
}

export function createUploadFormData(file, options = {}) {
  validateUpload(file, options);
  const formData = new FormData();
  formData.append(options.fieldName || 'file', file, file.name || options.filename || 'upload');
  Object.entries(options.fields || {}).forEach(([key, value]) => {
    if (value != null) formData.append(key, String(value));
  });
  return formData;
}

export async function readImageDimensions(file) {
  validateUpload(file);
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file);
    const result = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return result;
  }
  if (typeof document === 'undefined') throw new Error('Leitura de imagem indisponível neste ambiente.');

  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new UploadValidationError('Não foi possível ler a imagem.', 'INVALID_IMAGE'));
    };
    image.src = url;
  });
}

export async function uploadFile(path, file, options = {}) {
  const body = createUploadFormData(file, options);
  return apiRequest(path, {
    method: options.method || 'POST',
    body,
    auth: options.auth || 'required',
    actor: options.actor,
    signal: options.signal,
    timeoutMs: options.timeoutMs || 30000,
    retries: 0
  });
}
