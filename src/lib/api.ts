// Centralized memory-held Bearer API client (never persists tokens in localStorage)

let inMemoryToken: string | null = null;

export function setAuthToken(token: string | null) {
  inMemoryToken = token;
}

export function getAuthToken(): string | null {
  return inMemoryToken;
}

export function generateIdempotencyKey(prefix = 'ouro'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export async function apiFetch<T = any>(
  url: string,
  options: RequestInit & { idempotencyKey?: string } = {}
): Promise<T> {
  const { idempotencyKey, ...fetchOpts } = options;
  const headers = new Headers(fetchOpts.headers || {});
  if (inMemoryToken) {
    headers.set('Authorization', `Bearer ${inMemoryToken}`);
  }
  if (idempotencyKey) {
    headers.set('Idempotency-Key', idempotencyKey);
  }
  if (!(fetchOpts.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(url, { ...fetchOpts, headers });

  if (!res.ok) {
    let errMessage = `Request failed (${res.status})`;
    try {
      const errBody = await res.json();
      if (errBody?.error) errMessage = errBody.error;
    } catch {
      // ignore non-json error body
    }
    throw new Error(errMessage);
  }

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return (await res.json()) as T;
  }
  return (await res.text()) as unknown as T;
}

export async function downloadAuthenticatedCsv(url: string, filename: string): Promise<void> {
  const headers = new Headers();
  if (inMemoryToken) {
    headers.set('Authorization', `Bearer ${inMemoryToken}`);
  }
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error('Failed to download CSV ledger');
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}

/**
 * Requests a short-lived HMAC-signed URL for a private file and downloads it securely
 * without ever using window.open or exposing bearer tokens in query parameters.
 */
export async function downloadSignedPrivateFile(
  fileId: number,
  fallbackFilename = 'document'
): Promise<void> {
  const { signedUrl } = await apiFetch<{ signedUrl: string }>(`/api/storage/${fileId}/sign`, {
    method: 'POST',
  });
  const res = await fetch(signedUrl);
  if (!res.ok) {
    throw new Error('Could not retrieve private file');
  }
  const blob = await res.blob();
  const disp = res.headers.get('content-disposition') || '';
  const match = disp.match(/filename="([^"]+)"/);
  const filename = match?.[1] || fallbackFilename;

  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}
