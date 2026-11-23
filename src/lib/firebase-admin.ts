import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import firebaseConfig from '../../firebase-applet-config.json';

const VALID_PROJECT_ID = /^[a-z][a-z0-9-]{4,29}$/i;

function readValidProjectId(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && VALID_PROJECT_ID.test(trimmed) ? trimmed : undefined;
}

let resolvedProjectId = '';
let serviceAccountConfigured = false;

function initFirebaseAdmin() {
  if (getApps().length > 0) {
    resolvedProjectId =
      readValidProjectId(process.env.FIREBASE_PROJECT_ID) ||
      readValidProjectId(firebaseConfig.projectId) ||
      readValidProjectId(process.env.GOOGLE_CLOUD_PROJECT) ||
      firebaseConfig.projectId;
    return;
  }

  // Prefer explicit FIREBASE_PROJECT_ID, then firebase-applet-config.json projectId.
  // Never let a generic host runtime GOOGLE_CLOUD_PROJECT override the app's Firebase projectId.
  const projectId =
    readValidProjectId(process.env.FIREBASE_PROJECT_ID) ||
    readValidProjectId(firebaseConfig.projectId) ||
    readValidProjectId(process.env.GOOGLE_CLOUD_PROJECT) ||
    firebaseConfig.projectId;

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (serviceAccountJson && serviceAccountJson.startsWith('{')) {
    const parsed = JSON.parse(serviceAccountJson);
    resolvedProjectId = readValidProjectId(parsed.project_id) || projectId;
    serviceAccountConfigured = true;
    initializeApp({
      credential: cert(parsed),
      projectId: resolvedProjectId,
    });
    return;
  }

  const gacPath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (gacPath && gacPath.endsWith('.json')) {
    serviceAccountConfigured = true;
  }

  resolvedProjectId = projectId;
  initializeApp({ projectId: resolvedProjectId });
}

initFirebaseAdmin();

export const adminAuth = getAuth();
export const firebaseProjectId = resolvedProjectId;
export const hasFirebaseAdminServiceAccount = serviceAccountConfigured;
