const path = require('path');

const isProduction = process.env.NODE_ENV === 'production';

function sanitizeEnvValue(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';

  const startsWithQuote = trimmed.startsWith('"') || trimmed.startsWith("'");
  const endsWithQuote = trimmed.endsWith('"') || trimmed.endsWith("'");
  if (startsWithQuote && endsWithQuote && trimmed.length >= 2) {
    return trimmed.slice(1, -1).trim();
  }

  return trimmed;
}

function normalizeOrigin(value) {
  const sanitized = sanitizeEnvValue(value);
  if (!sanitized) return '';

  const withoutTrailingSlash = sanitized.replace(/\/+$/, '');
  try {
    return new URL(withoutTrailingSlash).origin;
  } catch {
    // Keep non-URL values as-is; this preserves backward compatibility.
    return withoutTrailingSlash;
  }
}

function parseCsv(value) {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => normalizeOrigin(item))
    .filter(Boolean);
}

function parseTrustProxy(value) {
  if (!value) return false;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;

  const asNumber = Number.parseInt(normalized, 10);
  return Number.isNaN(asNumber) ? false : asNumber;
}

const corsOrigins = Array.from(new Set([
  ...parseCsv(process.env.CORS_ORIGINS),
  normalizeOrigin(process.env.CLIENT_URL),
  normalizeOrigin(process.env.WEB_ORIGIN),
  ...(isProduction ? [] : ['http://localhost:3000', 'http://localhost:3001']),
].filter(Boolean)));

function isCorsOriginAllowed(origin) {
  const normalizedOrigin = normalizeOrigin(origin);
  if (!normalizedOrigin) return false;

  if (corsOrigins.includes(normalizedOrigin)) {
    return true;
  }

  // If any Vercel domain is configured, allow other Vercel subdomains
  // (e.g. preview URLs like *-git-main-*.vercel.app).
  const hasConfiguredVercelOrigin = corsOrigins.some((allowed) => /\.vercel\.app$/i.test(allowed));
  if (hasConfiguredVercelOrigin && /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(normalizedOrigin)) {
    return true;
  }

  return false;
}

const uploadBase = process.env.UPLOAD_PATH
  ? path.resolve(process.env.UPLOAD_PATH)
  : path.join(__dirname, '..', 'uploads');

const trustProxy = parseTrustProxy(process.env.TRUST_PROXY);

function validateProductionEnv() {
  if (!isProduction) return;

  const required = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'JWT_SECRET'];
  const missing = required.filter((name) => {
    const value = process.env[name];
    return typeof value !== 'string' || value.trim().length === 0;
  });

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables in production: ${missing.join(', ')}`);
  }

  if (process.env.JWT_SECRET.trim().length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters in production');
  }
}

module.exports = {
  isProduction,
  corsOrigins,
  isCorsOriginAllowed,
  uploadBase,
  trustProxy,
  validateProductionEnv,
};