import {
  ABSOLUTE_MAX_PAGE_SIZE,
  CELEX_REGEX,
  LANGUAGE_CODE_REGEX,
  MAX_PAGE,
  MAX_TIMEOUT_MS,
  MIN_PAGE,
  MIN_PAGE_SIZE,
  MIN_TIMEOUT_MS
} from "./constants.js";

function toInteger(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return NaN;
  return Math.trunc(parsed);
}

export function sanitizeString(value, field, maxLength = 2000) {
  if (typeof value !== "string") {
    throw new Error(`Invalid ${field}: expected string`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Invalid ${field}: must not be empty`);
  }
  if (trimmed.length > maxLength) {
    throw new Error(`Invalid ${field}: exceeds maximum length of ${maxLength}`);
  }
  return trimmed;
}

export function parseLanguage(language) {
  const value = sanitizeString(language ?? "en", "language", 8).toLowerCase();
  if (!LANGUAGE_CODE_REGEX.test(value)) {
    throw new Error("Invalid language: expected 2-letter language code (e.g., 'en')");
  }
  return value;
}

export function parsePage(page) {
  const value = toInteger(page, MIN_PAGE);
  if (!Number.isFinite(value) || value < MIN_PAGE || value > MAX_PAGE) {
    throw new Error(`Invalid page: expected integer ${MIN_PAGE}-${MAX_PAGE}`);
  }
  return value;
}

export function parsePageSize(pageSize, maxPageSize) {
  const boundedMax = Math.min(Math.max(maxPageSize, MIN_PAGE_SIZE), ABSOLUTE_MAX_PAGE_SIZE);
  const value = toInteger(pageSize, 10);
  if (!Number.isFinite(value) || value < MIN_PAGE_SIZE || value > boundedMax) {
    throw new Error(`Invalid page_size: expected integer ${MIN_PAGE_SIZE}-${boundedMax}`);
  }
  return value;
}

export function parseTimeoutMs(timeoutMs, defaultTimeoutMs) {
  const value = toInteger(timeoutMs, defaultTimeoutMs);
  if (!Number.isFinite(value) || value < MIN_TIMEOUT_MS || value > MAX_TIMEOUT_MS) {
    throw new Error(
      `Invalid timeout_ms: expected integer ${MIN_TIMEOUT_MS}-${MAX_TIMEOUT_MS}`
    );
  }
  return value;
}

export function parseCelex(celex) {
  const value = sanitizeString(celex, "celex", 64).toUpperCase();
  if (!CELEX_REGEX.test(value)) {
    throw new Error("Invalid celex: only A-Z, 0-9, and ()-._ are allowed");
  }
  return value;
}

export function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return fallback;
}
