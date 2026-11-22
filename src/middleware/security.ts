import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';

/**
 * Security headers + X-Request-Id correlation safe for embedded iframe preview and production SaaS deployments.
 */
export function securityHeadersMiddleware(req: Request, res: Response, next: NextFunction) {
  const reqId =
    (typeof req.headers['x-request-id'] === 'string' && req.headers['x-request-id'].slice(0, 64)) ||
    crypto.randomUUID();
  res.setHeader('X-Request-Id', reqId);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), geolocation=(self), microphone=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  // Do NOT emit X-Frame-Options: DENY so AI Studio preview iframe works seamlessly
  next();
}

/**
 * Pluggable sliding-window rate-limit store interface.
 * Defaults to single-instance InMemoryRateLimitStore; swap with RedisRateLimitStore when scaling horizontally.
 */
export interface RateLimitStore {
  recordAndCount(key: string, nowMs: number, windowMs: number): Promise<number> | number;
}

class InMemoryRateLimitStore implements RateLimitStore {
  private hits = new Map<string, number[]>();

  recordAndCount(key: string, nowMs: number, windowMs: number): number {
    const cutoff = nowMs - windowMs;
    const recent = (this.hits.get(key) || []).filter((ts) => ts > cutoff);
    recent.push(nowMs);
    this.hits.set(key, recent);

    if (this.hits.size > 5000) {
      for (const [k, arr] of this.hits.entries()) {
        const filtered = arr.filter((ts) => ts > cutoff);
        if (filtered.length === 0) this.hits.delete(k);
        else this.hits.set(k, filtered);
      }
    }
    return recent.length;
  }
}

const defaultRateLimitStore = new InMemoryRateLimitStore();

/**
 * Sliding-window rate limiter per IP + route bucket.
 * Note: For multi-replica Cloud Run deployments, inject a Redis-backed RateLimitStore via REDIS_URL.
 */
export function createRateLimiter(options: {
  windowMs: number;
  maxRequests: number;
  bucketName: string;
  store?: RateLimitStore;
}) {
  const store = options.store || defaultRateLimitStore;

  return async (req: Request, res: Response, next: NextFunction) => {
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket.remoteAddress ||
      'unknown';
    const key = `${options.bucketName}:${ip}`;
    const count = await store.recordAndCount(key, Date.now(), options.windowMs);

    if (count > options.maxRequests) {
      res.setHeader('Retry-After', String(Math.ceil(options.windowMs / 1000)));
      return res.status(429).json({
        error: 'Too many requests. Please wait a moment and try again.',
        code: 'RATE_LIMIT_EXCEEDED',
      });
    }

    return next();
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
 * Structured JSON logger for server-side operational telemetry (never logs passwords or tokens).
 */
export function logStructured(
  level: 'info' | 'warn' | 'error',
  event: string,
  meta: Record<string, unknown> = {}
) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    service: 'ouro-api',
    event,
    ...meta,
  };
  const line = JSON.stringify(entry);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}
