/*
 * Set/unset the hidden ROOT custom claim for a Firebase Auth user.
 *
 * Usage:
 *   node tools/set_root_claim.js --email root@dominio.com --root=true
 *   node tools/set_root_claim.js --uid <UID> --root=false
 *
 * Requirements:
 *   - GOOGLE_APPLICATION_CREDENTIALS points to a service account JSON
 *   - The service account belongs to the SAME Firebase project
 */

const admin = require('firebase-admin');

function getArg(name) {
  const idx = process.argv.findIndex((a) => a === `--${name}`);
  if (idx === -1) return null;
  return process.argv[idx + 1] ?? null;
}

function parseBool(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(s)) return true;
  if (['false', '0', 'no', 'n'].includes(s)) return false;
  return null;
}

async function main() {
  const email = getArg('email');
  const uid = getArg('uid');
  const root = parseBool(getArg('root'));

  if (!email && !uid) {
    console.error('Missing --email or --uid');
    process.exit(1);
  }
  if (root === null) {
    console.error('Missing/invalid --root. Use --root=true or --root=false');
    process.exit(1);
  }

  admin.initializeApp({ credential: admin.credential.applicationDefault() });

  const user = email ? await admin.auth().getUserByEmail(email) : await admin.auth().getUser(uid);
  const newClaims = { ...(user.customClaims || {}) };
  if (root) newClaims.root = true;
  else delete newClaims.root;

  await admin.auth().setCustomUserClaims(user.uid, newClaims);

  // Force token refresh hint
  console.log(JSON.stringify({ ok: true, uid: user.uid, email: user.email, root }, null, 2));
  console.log('NOTE: the user must sign out/in to refresh the ID token and apply the claim.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
