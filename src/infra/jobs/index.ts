import crypto from 'crypto';
import Redis from 'ioredis';
import { InfraConfigurationError, resolveInfraConfig, type JobsConfig, type JobsProviderName } from '../config.ts';
import { logger } from '../logger.ts';

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'dead_letter';

export interface JobRecord<T = unknown> {
  id: string;
  name: string;
  payload: T;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  enqueuedAt: string;
  completedAt?: string;
  lastError?: string;
}

export interface EnqueueOptions {
  delayMs?: number;
  maxAttempts?: number;
  dedupeKey?: string;
}

export type JobHandler<T = any> = (payload: T, meta: { jobId: string; attempt: number }) => Promise<void> | void;

export interface JobQueueMetrics {
  provider: JobsProviderName;
  registeredHandlers: string[];
  scheduledTasks: string[];
  queued: number;
  processed: number;
  failed: number;
  deadLetterCount: number;
}

export interface JobQueue {
  readonly providerName: JobsProviderName;
  registerHandler<T = any>(jobName: string, handler: JobHandler<T>): void;
  enqueue<T = any>(jobName: string, payload: T, options?: EnqueueOptions): Promise<JobRecord<T>>;
  scheduleRecurring(
    scheduleName: string,
    jobName: string,
    intervalMs: number,
    payload?: unknown
  ): void;
  getDeadLetters(): JobRecord[];
  getMetrics(): JobQueueMetrics;
  shutdown(): Promise<void>;
}

/**
 * In-process async background job queue for local development and single-instance deployments.
 * Supports non-blocking execution, delayed jobs, deduplication keys, retries with backoff, and dead-letter tracking.
 */
export class InProcessJobQueue implements JobQueue {
  public readonly providerName = 'memory' as const;
  private readonly config: JobsConfig;
  private readonly handlers = new Map<string, JobHandler>();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly intervals = new Map<string, ReturnType<typeof setInterval>>();
  private readonly activeDedupeKeys = new Set<string>();
  private readonly deadLetters: JobRecord[] = [];
  private readonly jobLog = logger.child({ module: 'jobs', provider: 'memory' });
  private queued = 0;
  private processed = 0;
  private failed = 0;
  private isShuttingDown = false;

  constructor(config: JobsConfig) {
    this.config = config;
  }

  registerHandler<T = any>(jobName: string, handler: JobHandler<T>): void {
    this.handlers.set(jobName, handler as JobHandler);
  }

  async enqueue<T = any>(
    jobName: string,
    payload: T,
    options: EnqueueOptions = {}
  ): Promise<JobRecord<T>> {
    const maxAttempts = options.maxAttempts ?? this.config.defaultMaxAttempts;
    const record: JobRecord<T> = {
      id: `job_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`,
      name: jobName,
      payload,
      status: 'queued',
      attempts: 0,
      maxAttempts,
      enqueuedAt: new Date().toISOString(),
    };

    if (this.isShuttingDown) {
      return record;
    }

    if (options.dedupeKey) {
      if (this.activeDedupeKeys.has(options.dedupeKey)) {
        return record;
      }
      this.activeDedupeKeys.add(options.dedupeKey);
    }

    this.queued += 1;
    const delayMs = Math.max(0, options.delayMs ?? 0);

    const scheduleAttempt = (waitMs: number) => {
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        void this.executeJob(record, options.dedupeKey, scheduleAttempt);
      }, waitMs);
      if (typeof timer.unref === 'function') timer.unref();
      this.timers.add(timer);
    };

    scheduleAttempt(delayMs);
    return record;
  }

  private async executeJob<T>(
    record: JobRecord<T>,
    dedupeKey: string | undefined,
    reschedule: (waitMs: number) => void
  ): Promise<void> {
    const handler = this.handlers.get(record.name);
    if (!handler) {
      this.queued = Math.max(0, this.queued - 1);
      this.failed += 1;
      record.status = 'dead_letter';
      record.lastError = `No handler registered for job "${record.name}"`;
      this.recordDeadLetter(record);
      if (dedupeKey) this.activeDedupeKeys.delete(dedupeKey);
      return;
    }

    record.status = 'running';
    record.attempts += 1;

    try {
      await handler(record.payload, { jobId: record.id, attempt: record.attempts });
      record.status = 'completed';
      record.completedAt = new Date().toISOString();
      this.queued = Math.max(0, this.queued - 1);
      this.processed += 1;
      if (dedupeKey) this.activeDedupeKeys.delete(dedupeKey);
    } catch (err: any) {
      record.lastError = err?.message || String(err);
      this.jobLog.warn('background_job_attempt_failed', {
        jobId: record.id,
        jobName: record.name,
        attempt: record.attempts,
        maxAttempts: record.maxAttempts,
        error: record.lastError,
      });

      if (record.attempts < record.maxAttempts && !this.isShuttingDown) {
        record.status = 'queued';
        const backoff = this.config.defaultBackoffMs * Math.pow(2, record.attempts - 1);
        reschedule(backoff);
      } else {
        record.status = 'dead_letter';
        this.queued = Math.max(0, this.queued - 1);
        this.failed += 1;
        this.recordDeadLetter(record);
        if (dedupeKey) this.activeDedupeKeys.delete(dedupeKey);
      }
    }
  }

  private recordDeadLetter(record: JobRecord): void {
    this.deadLetters.push(record);
    if (this.deadLetters.length > 100) {
      this.deadLetters.shift();
    }
  }

  scheduleRecurring(
    scheduleName: string,
    jobName: string,
    intervalMs: number,
    payload: unknown = {}
  ): void {
    if (this.intervals.has(scheduleName)) {
      clearInterval(this.intervals.get(scheduleName)!);
    }
    const handle = setInterval(() => {
      if (!this.isShuttingDown) {
        void this.enqueue(jobName, payload, { dedupeKey: `sched:${scheduleName}` });
      }
    }, Math.max(1000, intervalMs));
    if (typeof handle.unref === 'function') handle.unref();
    this.intervals.set(scheduleName, handle);
  }

  getDeadLetters(): JobRecord[] {
    return [...this.deadLetters];
  }

  getMetrics(): JobQueueMetrics {
    return {
      provider: 'memory',
      registeredHandlers: Array.from(this.handlers.keys()),
      scheduledTasks: Array.from(this.intervals.keys()),
      queued: this.queued,
      processed: this.processed,
      failed: this.failed,
      deadLetterCount: this.deadLetters.length,
    };
  }

  async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    for (const timer of this.timers) {
      clearTimeout(timer);
    }
    this.timers.clear();
    for (const interval of this.intervals.values()) {
      clearInterval(interval);
    }
    this.intervals.clear();
    this.activeDedupeKeys.clear();
  }
}

/**
 * Redis-backed distributed background job queue adapter (prepared for multi-instance cloud workers).
 * Persists job payloads into Redis lists with dead-letter queue isolation.
 */
export class RedisJobQueue implements JobQueue {
  public readonly providerName = 'redis' as const;
  private readonly config: JobsConfig;
  private readonly client: Redis;
  private readonly handlers = new Map<string, JobHandler>();
  private readonly intervals = new Map<string, ReturnType<typeof setInterval>>();
  private readonly deadLetters: JobRecord[] = [];
  private readonly jobLog = logger.child({ module: 'jobs', provider: 'redis' });
  private queued = 0;
  private processed = 0;
  private failed = 0;

  constructor(config: JobsConfig, injectedClient?: Redis) {
    if (!config.redisUrl && !injectedClient) {
      throw new InfraConfigurationError(
        'REDIS_URL_REQUIRED_FOR_JOBS',
        'JOBS_PROVIDER=redis requires REDIS_URL to be configured.'
      );
    }
    this.config = config;
    this.client =
      injectedClient ||
      new Redis(config.redisUrl!, {
        keyPrefix: config.redisKeyPrefix,
        lazyConnect: true,
        maxRetriesPerRequest: 2,
        tls: config.redisUrl!.startsWith('rediss://') ? {} : undefined,
      });

    if (!injectedClient) {
      this.client.on('error', (err) => {
        this.jobLog.error('redis_jobs_client_error', { error: err });
      });
    }
  }

  registerHandler<T = any>(jobName: string, handler: JobHandler<T>): void {
    this.handlers.set(jobName, handler as JobHandler);
  }

  async enqueue<T = any>(
    jobName: string,
    payload: T,
    options: EnqueueOptions = {}
  ): Promise<JobRecord<T>> {
    if (this.client.status === 'wait') {
      await this.client.connect();
    }
    const record: JobRecord<T> = {
      id: `job_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`,
      name: jobName,
      payload,
      status: 'queued',
      attempts: 0,
      maxAttempts: options.maxAttempts ?? this.config.defaultMaxAttempts,
      enqueuedAt: new Date().toISOString(),
    };

    if (options.delayMs && options.delayMs > 0) {
      await this.client.zadd('delayed', Date.now() + options.delayMs, JSON.stringify(record));
    } else {
      await this.client.lpush(`queue:${jobName}`, JSON.stringify(record));
    }
    this.queued += 1;
    return record;
  }

  /**
   * Processes one queued job for the given jobName (used by dedicated worker loops or tests).
   */
  async processNext(jobName: string): Promise<boolean> {
    if (this.client.status === 'wait') {
      await this.client.connect();
    }
    const raw = await this.client.rpop(`queue:${jobName}`);
    if (!raw) return false;

    const record = JSON.parse(raw) as JobRecord;
    const handler = this.handlers.get(record.name);
    if (!handler) {
      record.status = 'dead_letter';
      record.lastError = `No handler registered for job "${record.name}"`;
      await this.client.lpush('dead_letter', JSON.stringify(record));
      this.deadLetters.push(record);
      this.failed += 1;
      return true;
    }

    record.attempts += 1;
    try {
      await handler(record.payload, { jobId: record.id, attempt: record.attempts });
      this.processed += 1;
    } catch (err: any) {
      record.lastError = err?.message || String(err);
      if (record.attempts < record.maxAttempts) {
        await this.client.lpush(`queue:${jobName}`, JSON.stringify(record));
      } else {
        record.status = 'dead_letter';
        await this.client.lpush('dead_letter', JSON.stringify(record));
        this.deadLetters.push(record);
        this.failed += 1;
      }
    }
    return true;
  }

  scheduleRecurring(
    scheduleName: string,
    jobName: string,
    intervalMs: number,
    payload: unknown = {}
  ): void {
    if (this.intervals.has(scheduleName)) {
      clearInterval(this.intervals.get(scheduleName)!);
    }
    const handle = setInterval(() => {
      void this.enqueue(jobName, payload);
    }, Math.max(1000, intervalMs));
    if (typeof handle.unref === 'function') handle.unref();
    this.intervals.set(scheduleName, handle);
  }

  getDeadLetters(): JobRecord[] {
    return [...this.deadLetters];
  }

  getMetrics(): JobQueueMetrics {
    return {
      provider: 'redis',
      registeredHandlers: Array.from(this.handlers.keys()),
      scheduledTasks: Array.from(this.intervals.keys()),
      queued: this.queued,
      processed: this.processed,
      failed: this.failed,
      deadLetterCount: this.deadLetters.length,
    };
  }

  async shutdown(): Promise<void> {
    for (const interval of this.intervals.values()) {
      clearInterval(interval);
    }
    this.intervals.clear();
    if (this.client.status !== 'end' && this.client.status !== 'wait') {
      await this.client.quit();
    } else {
      this.client.disconnect();
    }
  }
}

declare global {
  var _ouroJobQueue: JobQueue | undefined;
}

export function createJobQueue(customConfig?: JobsConfig): JobQueue {
  const cfg = customConfig || resolveInfraConfig().jobs;
  if (cfg.provider === 'redis') {
    return new RedisJobQueue(cfg);
  }
  return new InProcessJobQueue(cfg);
}

export function getJobQueue(): JobQueue {
  if (!global._ouroJobQueue) {
    global._ouroJobQueue = createJobQueue();
  }
  return global._ouroJobQueue;
}

export async function resetJobQueueForTests(): Promise<void> {
  if (global._ouroJobQueue) {
    await global._ouroJobQueue.shutdown();
    global._ouroJobQueue = undefined;
  }
}
