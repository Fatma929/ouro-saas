import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import firebaseConfig from '../../firebase-applet-config.json';

function initFirebaseAdmin() {
  if (getApps().length > 0) return;

  const projectId =
    process.env.FIREBASE_PROJECT_ID?.trim() ||
    process.env.GOOGLE_CLOUD_PROJECT?.trim() ||
    firebaseConfig.projectId;

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (serviceAccountJson && serviceAccountJson.startsWith('{')) {
    const parsed = JSON.parse(serviceAccountJson);
    initializeApp({
      credential: cert(parsed),
      projectId: parsed.project_id || projectId,
    });
    return;
  }

  initializeApp({ projectId });
}

initFirebaseAdmin();

export const adminAuth = getAuth();
