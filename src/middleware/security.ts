import type { Request, Response, NextFunction } from 'express';

/**
 * Security headers safe for embedded iframe preview and production SaaS deployments.
 */
export function securityHeadersMiddleware(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), geolocation=(self), microphone=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  // Do NOT emit X-Frame-Options: DENY so AI Studio preview iframe works seamlessly
  next();
}

/**
 * Lightweight in-memory sliding-window rate limiter per IP + route bucket.
 */
export function createRateLimiter(options: {
  windowMs: number;
  maxRequests: number;
  bucketName: string;
}) {
  const hits = new Map<string, number[]>();

  return (req: Request, res: Response, next: NextFunction) => {
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket.remoteAddress ||
      'unknown';
    const key = `${options.bucketName}:${ip}`;
    const now = Date.now();
    const cutoff = now - options.windowMs;
    const recent = (hits.get(key) || []).filter((ts) => ts > cutoff);

    if (recent.length >= options.maxRequests) {
      res.setHeader('Retry-After', String(Math.ceil(options.windowMs / 1000)));
      return res.status(429).json({
        error: 'Too many requests. Please wait a moment and try again.',
        code: 'RATE_LIMIT_EXCEEDED',
      });
    }

    recent.push(now);
    hits.set(key, recent);

    // Periodic pruning to prevent unbounded memory growth
    if (hits.size > 5000) {
      for (const [k, arr] of hits.entries()) {
        const filtered = arr.filter((ts) => ts > cutoff);
        if (filtered.length === 0) hits.delete(k);
        else hits.set(k, filtered);
      }
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
