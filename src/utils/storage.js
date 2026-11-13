/**
 * Safe localStorage wrapper
 * Handles Safari Private Mode and other environments where localStorage throws
 */

let storageAccountId = null;
let storageDatabase = "unavailable";

export function setStorageAccount(accountId, role) {
  storageAccountId = Number.isSafeInteger(Number(accountId)) && Number(accountId) > 0
    ? String(Number(accountId))
    : null;
  storageDatabase = storageAccountId
    ? role === "guest" ? "guest" : "admin"
    : "unavailable";
}

export function accountStorageKey(key) {
  return `deepread:account:${storageDatabase}:${storageAccountId || "unavailable"}:${key}`;
}

export function safeGetItem(key, fallback = null) {
  try {
    const value = localStorage.getItem(key);
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

export function safeSetItem(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function safeRemoveItem(key) {
  try {
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function safeParseItem(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function safeStringifyItem(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}