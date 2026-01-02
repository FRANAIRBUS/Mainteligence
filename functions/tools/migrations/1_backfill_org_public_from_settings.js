const admin = require("firebase-admin");

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const [k, v] = a.split("=");
      const key = k.replace(/^--/, "");
      args[key] = v === undefined ? true : v;
    }
  }
  return args;
}

(async () => {
  const args = parseArgs(process.argv);
  const dryRun = !!args["dry-run"];

  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
  }

  const db = admin.firestore();
  const FieldValue = admin.firestore.FieldValue;

  console.log(`[1] Backfill organizationsPublic desde settings/app (dry-run=${dryRun})`);

  const settingsRef = db.collection("settings").doc("app");
  const settingsSnap = await settingsRef.get();
  if (!settingsSnap.exists) {
    console.log(`[1] settings/app no existe. Nada que hacer.`);
    return;
  }

  const s = settingsSnap.data() || {};
  const orgId = s.organizationId || "default";

  // Public minimal
  const publicDoc = {
    organizationId: orgId,
    logoUrl: s.logoUrl || null,
    // Si tienes name en algún sitio, añádelo aquí
    name: s.name || orgId,
    updatedAt: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
    source: "migration_backfill_from_settings_v1",
  };

  const publicRef = db.collection("organizationsPublic").doc(orgId);

  if (dryRun) {
    console.log(`[1] DRY-RUN: escribiría organizationsPublic/${orgId}`, publicDoc);
  } else {
    await publicRef.set(publicDoc, { merge: true });
    console.log(`[1] OK: organizationsPublic/${orgId} actualizado.`);
  }

  console.log(`[1] DONE`);
})().catch((e) => {
  console.error("[1] ERROR:", e);
  process.exit(1);
});
