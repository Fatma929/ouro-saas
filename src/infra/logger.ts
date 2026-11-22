import { resolveInfraConfig, type LogFormat, type LogLevel } from './config.ts';

export interface LogEntry {
  ts: string;
  level: LogLevel;
  service: string;
  event: string;
  meta: Record<string, unknown>;
}

export interface LogSink {
  write(entry: LogEntry): void;
}

export interface Logger {
  debug(event: string, meta?: Record<string, unknown>): void;
  info(event: string, meta?: Record<string, unknown>): void;
  warn(event: string, meta?: Record<string, unknown>): void;
  error(event: string, meta?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
  getStatus(): { level: LogLevel; format: LogFormat; serviceName: string };
}

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const SENSITIVE_KEY_PATTERN =
  /pass(word|phrase)?|secret|token|authorization|cookie|api[-_]?key|private[-_]?key|credential|access[-_]?key/i;

/**
 * Recursively redacts sensitive fields so secrets/tokens are never emitted to cloud log aggregators.
 */
export function redactLogMeta(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[TRUNCATED]';
  if (value === null || value === undefined) return value;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
    };
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactLogMeta(item, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(k)) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = redactLogMeta(v, depth + 1);
      }
    }
    return out;
  }
  return value;
}

export class ConsoleLogSink implements LogSink {
  private readonly format: LogFormat;

  constructor(format: LogFormat = 'json') {
    this.format = format;
  }

  write(entry: LogEntry): void {
    const line =
      this.format === 'pretty'
        ? `[${entry.ts}] ${entry.level.toUpperCase()} (${entry.service}) ${entry.event} ${
            Object.keys(entry.meta).length > 0 ? JSON.stringify(entry.meta) : ''
          }`.trim()
        : JSON.stringify({
            ts: entry.ts,
            level: entry.level,
            service: entry.service,
            event: entry.event,
            ...entry.meta,
          });

    if (entry.level === 'error') {
      console.error(line);
    } else if (entry.level === 'warn') {
      console.warn(line);
    } else {
      console.log(line);
    }
  }
}

export class StructuredLogger implements Logger {
  private readonly level: LogLevel;
  private readonly format: LogFormat;
  private readonly serviceName: string;
  private readonly sink: LogSink;
  private readonly bindings: Record<string, unknown>;

  constructor(options: {
    level: LogLevel;
    format: LogFormat;
    serviceName: string;
    sink?: LogSink;
    bindings?: Record<string, unknown>;
  }) {
    this.level = options.level;
    this.format = options.format;
    this.serviceName = options.serviceName;
    this.sink = options.sink || new ConsoleLogSink(options.format);
    this.bindings = options.bindings || {};
  }

  private emit(level: LogLevel, event: string, meta?: Record<string, unknown>): void {
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[this.level]) {
      return;
    }
    const merged = { ...this.bindings, ...(meta || {}) };
    const safeMeta = redactLogMeta(merged) as Record<string, unknown>;
    this.sink.write({
      ts: new Date().toISOString(),
      level,
      service: this.serviceName,
      event,
      meta: safeMeta,
    });
  }

  debug(event: string, meta?: Record<string, unknown>): void {
    this.emit('debug', event, meta);
  }

  info(event: string, meta?: Record<string, unknown>): void {
    this.emit('info', event, meta);
  }

  warn(event: string, meta?: Record<string, unknown>): void {
    this.emit('warn', event, meta);
  }

  error(event: string, meta?: Record<string, unknown>): void {
    this.emit('error', event, meta);
  }

  child(bindings: Record<string, unknown>): Logger {
    return new StructuredLogger({
      level: this.level,
      format: this.format,
      serviceName: this.serviceName,
      sink: this.sink,
      bindings: { ...this.bindings, ...bindings },
    });
  }

  getStatus() {
    return {
      level: this.level,
      format: this.format,
      serviceName: this.serviceName,
    };
  }
}

export function createLogger(
  options?: Partial<{
    level: LogLevel;
    format: LogFormat;
    serviceName: string;
    sink: LogSink;
    bindings: Record<string, unknown>;
  }>
): Logger {
  const cfg = resolveInfraConfig().logging;
  return new StructuredLogger({
    level: options?.level || cfg.level,
    format: options?.format || cfg.format,
    serviceName: options?.serviceName || cfg.serviceName,
    sink: options?.sink,
    bindings: options?.bindings,
  });
}

export const logger = createLogger();
