const META_NAME = 'fsi-expenses-api-base';
const LEGACY_GLOBAL_KEY = '__FSI_EXPENSES_API_BASE__';
const GLOBAL_CONFIG_KEY = '__FSI_EXPENSES_CONFIG__';
const OFFLINE_META_NAME = 'fsi-expenses-offline-only';

let cachedApiBase;
let cachedOfflineOnly;

const isString = (value) => typeof value === 'string';

const readMetaApiBase = () => {
  if (typeof document === 'undefined') {
    return '';
  }
  const meta = document.querySelector(`meta[name="${META_NAME}"]`);
  const content = meta?.getAttribute('content');
  return isString(content) ? content : '';
};

const parseBoolean = (value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return ['1', 'true', 'yes', 'on'].includes(normalized);
  }
  return false;
};

const readMetaOfflineOnly = () => {
  if (typeof document === 'undefined') {
    return false;
  }
  const meta = document.querySelector(`meta[name="${OFFLINE_META_NAME}"]`);
  const content = meta?.getAttribute('content');
  return parseBoolean(content);
};

const readGlobalOfflineOnly = () => {
  if (typeof window === 'undefined') {
    return false;
  }
  const config = window[GLOBAL_CONFIG_KEY];
  if (config && typeof config === 'object' && 'offlineOnly' in config) {
    return parseBoolean(config.offlineOnly);
  }
  return false;
};

const readGlobalApiBase = () => {
  if (typeof window === 'undefined') {
    return '';
  }

  const legacyValue = window[LEGACY_GLOBAL_KEY];
  if (isString(legacyValue) && legacyValue.trim()) {
    return legacyValue;
  }

  const config = window[GLOBAL_CONFIG_KEY];
  if (config && typeof config === 'object') {
    const candidates = [config.apiBaseUrl, config.apiBase, config.baseUrl];
    for (const candidate of candidates) {
      if (isString(candidate) && candidate.trim()) {
        return candidate;
      }
    }
  }

  return '';
};

const sanitizeApiBase = (rawValue) => {
  if (!isString(rawValue)) {
    return '';
  }

  const trimmed = rawValue.trim();
  if (!trimmed) {
    return '';
  }

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      const normalizedPath = url.pathname.replace(/\/+$/, '');
      return `${url.origin}${normalizedPath}`;
    } catch (error) {
      console.warn('Invalid API base URL provided, falling back to relative paths.', error);
      return trimmed.replace(/\/+$/, '');
    }
  }

  const withoutTrailingSlash = trimmed.replace(/\/+$/, '');
  if (!withoutTrailingSlash) {
    return '';
  }

  if (withoutTrailingSlash.startsWith('/')) {
    return `/${withoutTrailingSlash.replace(/^\/+/, '')}`;
  }

  return `/${withoutTrailingSlash}`;
};

export const getApiBase = () => {
  if (cachedApiBase !== undefined) {
    return cachedApiBase;
  }

  const configuredBase = readMetaApiBase() || readGlobalApiBase();
  cachedApiBase = sanitizeApiBase(configuredBase);
  return cachedApiBase;
};

export const buildApiUrl = (path = '') => {
  const apiBase = getApiBase();
  if (!apiBase) {
    return path;
  }

  if (!path) {
    return apiBase;
  }

  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  const normalizedPath = path.startsWith('/') ? path : `/${path}`;

  if (/^https?:\/\//i.test(apiBase)) {
    return `${apiBase}${normalizedPath}`;
  }

  const normalizedBase = apiBase === '/' ? '' : apiBase;
  return `${normalizedBase}${normalizedPath}`.replace(/\/\/{2,}/g, '/');
};

export const isOfflineOnly = () => {
  if (cachedOfflineOnly !== undefined) {
    return cachedOfflineOnly;
  }

  cachedOfflineOnly = readMetaOfflineOnly() || readGlobalOfflineOnly();
  return cachedOfflineOnly;
};

export const resetConfigCacheForTests = () => {
  cachedApiBase = undefined;
  cachedOfflineOnly = undefined;
};
