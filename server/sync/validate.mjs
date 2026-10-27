import { VOCAB_ID_MAX, VOCAB_ID_PREFIX } from './config.mjs';

// 前缀与上限从配置来，KET / PET 各用各的。
const VOCAB_ID_PATTERN = new RegExp(`^${VOCAB_ID_PREFIX}-\\d{4}$`);
const VOCAB_ID_HINT = `${VOCAB_ID_PREFIX}-0001`;

export class HttpError extends Error {
  constructor(status, code, message, retryable = false) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

export function codePointLength(value) {
  return [...value].length;
}

export function requirePlainObject(value, field = 'body') {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'INVALID_REQUEST', `${field} must be an object`);
  }
  return value;
}

export function requireString(value, field, { min = 1, max = 128 } = {}) {
  if (typeof value !== 'string') {
    throw new HttpError(400, 'INVALID_REQUEST', `${field} must be a string`);
  }
  const length = codePointLength(value);
  if (length < min || length > max) {
    throw new HttpError(400, 'INVALID_REQUEST', `${field} must be ${min}-${max} characters`);
  }
  return value;
}

export function validateDeviceId(value) {
  const id = requireString(value, 'deviceId', { min: 1, max: 128 });
  if (!/^[A-Za-z0-9._:-]+$/.test(id)) {
    throw new HttpError(400, 'INVALID_DEVICE_ID', 'deviceId contains invalid characters');
  }
  return id;
}

export function validateOpaqueId(value, field) {
  const id = requireString(value, field, { min: 1, max: 128 });
  if (!/^[A-Za-z0-9._:-]+$/.test(id)) {
    throw new HttpError(400, 'INVALID_REQUEST', `${field} contains invalid characters`);
  }
  return id;
}

export function validateListName(value) {
  if (typeof value !== 'string') {
    throw new HttpError(400, 'INVALID_LIST_NAME', 'list name must be a string');
  }
  const name = value.trim();
  const length = codePointLength(name);
  if (length < 1 || length > 80 || /[\p{Cc}\p{Cf}]/u.test(name)) {
    throw new HttpError(400, 'INVALID_LIST_NAME', 'list name must be 1-80 characters without control characters');
  }
  return name;
}

export function validateVocabId(value) {
  if (typeof value !== 'string' || !VOCAB_ID_PATTERN.test(value)) {
    throw new HttpError(400, 'INVALID_VOCAB_ID', `vocabId must use the ${VOCAB_ID_HINT} format`);
  }
  const number = Number(value.slice(VOCAB_ID_PREFIX.length + 1));
  if (number < 1 || number > VOCAB_ID_MAX) {
    throw new HttpError(400, 'INVALID_VOCAB_ID', `vocabId is outside ${VOCAB_ID_HINT}..${VOCAB_ID_PREFIX}-${VOCAB_ID_MAX}`);
  }
  return value;
}

export function validateCursor(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new HttpError(400, 'INVALID_CURSOR', 'cursor must be a non-negative safe integer');
  }
  return value;
}

export function validateClientTime(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new HttpError(400, 'INVALID_CLIENT_TIME', 'clientTime must be a non-negative epoch millisecond integer');
  }
  return value;
}

