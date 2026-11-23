/**
 * Execution safety guard for live mutating security & QA test suites.
 * Ensures mutating tests:
 *  - Default to a local isolated instance (http://127.0.0.1:3000)
 *  - Refuse unconditionally to run against production environments or production-like URLs
 *  - Require explicit dual opt-in (OURO_SECURITY_TEST_MODE=staging + OURO_ALLOW_SHARED_STAGING_TESTS=true)
 *    before targeting a non-local shared staging deployment.
 */

export type SecurityTestTargetClass = 'local' | 'staging';

export interface SecurityTestGuardResult {
  allowed: true;
  baseUrl: string;
  targetClass: SecurityTestTargetClass;
  mode: string;
}

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);

// Hostname tokens that indicate a commercial production or shared preview-live deployment
const PRODUCTION_HOST_PATTERNS: RegExp[] = [
  /(^|[.-])prod([.-]|$)/i,
  /(^|[.-])production([.-]|$)/i,
  /(^|[.-])live([.-]|$)/i,
  /^app\.ouro/i,
  /(^|\.)ouro\.eco$/i,
  /(^|\.)ouro-circular\.com$/i,
  /^ais-pre-/i,
];

const STAGING_HOST_PATTERNS: RegExp[] = [
  /(^|[.-])stag(e|ing)([.-]|$)/i,
  /(^|[.-])qa([.-]|$)/i,
  /(^|[.-])sandbox([.-]|$)/i,
  /(^|[.-])test([.-]|$)/i,
  /^ais-dev-/i,
];

export class SecurityTestSafetyError extends Error {
  public readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'SecurityTestSafetyError';
    this.code = code;
  }
}

export function assertSafeSecurityTestTarget(
  env: NodeJS.ProcessEnv = process.env
): SecurityTestGuardResult {
  const nodeEnv = (env.NODE_ENV || '').trim().toLowerCase();
  const viteAppEnv = (env.VITE_APP_ENV || '').trim().toLowerCase();
  const mode = (env.OURO_SECURITY_TEST_MODE || 'local').trim().toLowerCase();
  const allowSharedStaging = (env.OURO_ALLOW_SHARED_STAGING_TESTS || '').trim().toLowerCase() === 'true';

  if (nodeEnv === 'production' || viteAppEnv === 'production' || mode === 'production') {
    throw new SecurityTestSafetyError(
      'REFUSED_PRODUCTION_ENV',
      'SAFETY REFUSAL: Live mutating security tests cannot execute when NODE_ENV=production, VITE_APP_ENV=production, or OURO_SECURITY_TEST_MODE=production.'
    );
  }

  if (mode !== 'local' && mode !== 'staging') {
    throw new SecurityTestSafetyError(
      'INVALID_SECURITY_TEST_MODE',
      `Invalid OURO_SECURITY_TEST_MODE "${env.OURO_SECURITY_TEST_MODE}". Allowed values: "local" (default) or "staging" (with OURO_ALLOW_SHARED_STAGING_TESTS=true).`
    );
  }

  const rawUrl = (env.QA_BASE_URL || 'http://127.0.0.1:3000').trim().replace(/\/+$/, '');
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SecurityTestSafetyError(
      'INVALID_TARGET_URL',
      `Invalid QA_BASE_URL "${rawUrl}". Provide a valid http:// or https:// URL.`
    );
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new SecurityTestSafetyError(
      'INVALID_TARGET_PROTOCOL',
      `Unsupported QA_BASE_URL protocol "${parsed.protocol}". Expected http: or https:.`
    );
  }

  const hostname = parsed.hostname.toLowerCase();

  // Unconditional block for production-like hostnames regardless of opt-in flags
  if (PRODUCTION_HOST_PATTERNS.some((re) => re.test(hostname))) {
    throw new SecurityTestSafetyError(
      'REFUSED_PRODUCTION_URL',
      `SAFETY REFUSAL: Target URL "${rawUrl}" matches a production hostname pattern. Live security mutation tests are unconditionally forbidden against production.`
    );
  }

  const isLocal = LOCAL_HOSTNAMES.has(hostname) || hostname.endsWith('.local');
  if (isLocal) {
    return {
      allowed: true,
      baseUrl: rawUrl,
      targetClass: 'local',
      mode,
    };
  }

  // Non-local target requires BOTH explicit staging opt-in AND a recognizable non-production staging hostname
  if (mode !== 'staging' || !allowSharedStaging) {
    throw new SecurityTestSafetyError(
      'STAGING_OPT_IN_REQUIRED',
      `SAFETY REFUSAL: Refusing to execute mutating security tests against non-local target "${rawUrl}". ` +
        'For local testing use http://127.0.0.1:3000. To target a shared staging server, explicitly set BOTH ' +
        'OURO_SECURITY_TEST_MODE=staging and OURO_ALLOW_SHARED_STAGING_TESTS=true.'
    );
  }

  const looksLikeStaging = STAGING_HOST_PATTERNS.some((re) => re.test(hostname));
  if (!looksLikeStaging) {
    throw new SecurityTestSafetyError(
      'UNRECOGNIZED_REMOTE_HOST',
      `SAFETY REFUSAL: Non-local host "${hostname}" does not match an approved staging/qa/sandbox/test hostname pattern. ` +
        'Refusing to run mutating security tests against an unrecognized remote host that could be production.'
    );
  }

  return {
    allowed: true,
    baseUrl: rawUrl,
    targetClass: 'staging',
    mode,
  };
}
