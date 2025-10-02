const META_NAME = 'fsi-expenses-api-base';
const LEGACY_GLOBAL_KEY = '__FSI_EXPENSES_API_BASE__';
const GLOBAL_CONFIG_KEY = '__FSI_EXPENSES_CONFIG__';

let cachedApiBase;

const isString = (value) => typeof value === 'string';

const readMetaApiBase = () => {
  if (typeof document === 'undefined') {
    return '';
  }
  const meta = document.querySelector(`meta[name="${META_NAME}"]`);
  const content = meta?.getAttribute('content');
  return isString(content) ? content : '';
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
