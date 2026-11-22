import { resolveInfraConfig } from './config.ts';
import { getCacheProvider } from './cache/index.ts';
import { getDatabaseProvider } from './database.ts';
import { getEmailProvider, type EmailMessage } from './email/index.ts';
import { getJobQueue } from './jobs/index.ts';
import { logger } from './logger.ts';
import { getStorageProvider } from './storage/index.ts';

export * from './config.ts';
export * from './logger.ts';
export * from './database.ts';
export * from './storage/index.ts';
export * from './cache/index.ts';
export * from './email/index.ts';
export * from './jobs/index.ts';

let initialized = false;

/**
 * Validates cloud-agnostic infrastructure configuration at startup, initializes singletons,
 * and registers core background job handlers.
 * Throws InfraConfigurationError immediately if a required production provider (e.g. Redis in
 * multi-instance production, or S3/GCS bucket config) is missing or misconfigured.
 */
export function bootstrapInfrastructure() {
  const config = resolveInfraConfig();
  const storage = getStorageProvider();
  const cache = getCacheProvider();
  const email = getEmailProvider();
  const jobs = getJobQueue();

  if (!initialized) {
    jobs.registerHandler<EmailMessage>('email.send', async (message) => {
      const result = await getEmailProvider().send(message);
      if (result.sent) {
        logger.info('transactional_email_sent', {
          provider: result.provider,
          messageId: result.messageId,
        });
      }
    });
    initialized = true;
  }

  logger.info('infrastructure_bootstrapped', {
    env: config.env,
    storageProvider: storage.providerName,
    storageSignedUrlMode: config.storage.signedUrlMode,
    cacheProvider: cache.providerName,
    cacheDistributed: cache.distributed,
    topology: config.cache.topology,
    emailProvider: email.providerName,
    jobsProvider: jobs.providerName,
    databaseMode: getDatabaseProvider().getDiagnostics().connectionMode,
    logLevel: config.logging.level,
  });

  return { config, storage, cache, email, jobs };
}

/**
 * Gracefully tears down all infrastructure connections (jobs, cache/Redis, PostgreSQL pool).
 */
export async function shutdownInfrastructure(): Promise<void> {
  const jobs = getJobQueue();
  const cache = getCacheProvider();
  const database = getDatabaseProvider();

  await Promise.allSettled([jobs.shutdown(), cache.close(), database.close()]);
  logger.info('infrastructure_shutdown_complete');
}
