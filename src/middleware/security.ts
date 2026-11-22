import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { getCacheProvider, type RateLimitStore } from '../infra/cache/index.ts';
import { logger } from '../infra/logger.ts';

export type { RateLimitStore };

const SAFE_REQUEST_ID_REGEX = /^[a-zA-Z0-9_-]{8,64}$/;

/**
 * Security headers + sanitized X-Request-Id correlation safe for embedded iframe preview and production SaaS deployments.
 */
export function securityHeadersMiddleware(req: Request, res: Response, next: NextFunction) {
  const incomingId = typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'].trim() : '';
  const reqId = SAFE_REQUEST_ID_REGEX.test(incomingId) ? incomingId : crypto.randomUUID();
  res.setHeader('X-Request-Id', reqId);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), geolocation=(self), microphone=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');

  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self' https://maps.googleapis.com https://apis.google.com",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com data:",
        "img-src 'self' data: blob: https://maps.gstatic.com https://maps.googleapis.com https://*.googleusercontent.com",
        "connect-src 'self' https://maps.googleapis.com https://routes.googleapis.com https://places.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com",
        "object-src 'none'",
        "base-uri 'self'",
      ].join('; ')
    );
  }
  // Do NOT emit X-Frame-Options: DENY so AI Studio preview iframe works seamlessly
  next();
}

/**
 * Strict CORS allowlist middleware for API routes.
 * - Never emits wildcard Access-Control-Allow-Origin: * on authenticated routes.
 * - Same-origin requests (matching Host / X-Forwarded-Host) and explicitly allowlisted origins are permitted.
 * - Disallowed cross-origin requests receive 403 on preflight and receive no CORS allow headers.
 */
export function createCorsMiddleware(allowedOrigins: string[] = []) {
  const normalizedAllowlist = new Set(
    allowedOrigins
      .map((o) => o.trim().replace(/\/+$/, '').toLowerCase())
      .filter((o) => o.startsWith('http://') || o.startsWith('https://'))
  );

  return (req: Request, res: Response, next: NextFunction) => {
    const originHeader = typeof req.headers.origin === 'string' ? req.headers.origin.trim() : '';
    res.setHeader('Vary', 'Origin');

    if (!originHeader) {
      return next();
    }

    const normalizedOrigin = originHeader.replace(/\/+$/, '').toLowerCase();
    const forwardedHost =
      (typeof req.headers['x-forwarded-host'] === 'string' && req.headers['x-forwarded-host'].split(',')[0].trim()) ||
      req.headers.host ||
      '';
    const isSameOrigin =
      Boolean(forwardedHost) &&
      (normalizedOrigin === `https://${forwardedHost.toLowerCase()}` ||
        normalizedOrigin === `http://${forwardedHost.toLowerCase()}`);

    const isAllowed = isSameOrigin || normalizedAllowlist.has(normalizedOrigin);

    if (isAllowed) {
      res.setHeader('Access-Control-Allow-Origin', originHeader);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Authorization, Content-Type, Idempotency-Key, X-Request-Id, X-Requested-With'
      );
      res.setHeader('Access-Control-Max-Age', '600');
      if (req.method === 'OPTIONS') {
        return res.status(204).end();
      }
      return next();
    }

    if (req.method === 'OPTIONS') {
      return res.status(403).json({ error: 'CORS origin not allowed.' });
    }
    // Block cross-origin state-changing requests from non-allowlisted origins (CSRF/CORS defense-in-depth)
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method.toUpperCase())) {
      return res.status(403).json({ error: 'Cross-origin request blocked by CORS policy.' });
    }
    return next();
  };
}

/**
 * Sliding-window rate limiter per IP + route bucket backed by the cloud-agnostic CacheProvider.
 * Uses MemoryCacheProvider in local dev and RedisCacheProvider in multi-instance production.
 */
export function createRateLimiter(options: {
  windowMs: number;
  maxRequests: number;
  bucketName: string;
  store?: RateLimitStore;
}) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const store = options.store || getCacheProvider();
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `${options.bucketName}:${ip}`;

    try {
      const count = await store.recordAndCount(key, Date.now(), options.windowMs);
      if (count > options.maxRequests) {
        res.setHeader('Retry-After', String(Math.ceil(options.windowMs / 1000)));
        return res.status(429).json({
          error: 'Too many requests. Please wait a moment and try again.',
          code: 'RATE_LIMIT_EXCEEDED',
        });
      }
      return next();
    } catch (err) {
      logger.error('rate_limiter_store_error', {
        bucket: options.bucketName,
        error: err,
      });
      return res.status(503).json({
        error: 'Rate-limiting backend temporarily unavailable. Please retry.',
        code: 'RATE_LIMIT_BACKEND_UNAVAILABLE',
      });
    }
  };
}

/**
 * Neutralizes spreadsheet CSV formula injection (=, +, -, @, tab, CR) and escapes quotes.
 */
export function sanitizeCsvCell(value: string | number | null | undefined): string {
  let str = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  const escaped = str.replace(/"/g, '""');
  return `"${escaped}"`;
}

/**
 * Structured JSON logger facade delegating to the cloud-agnostic Logger with secret redaction.
 */
export function logStructured(
  level: 'info' | 'warn' | 'error',
  event: string,
  meta: Record<string, unknown> = {}
) {
  logger[level](event, meta);
}
