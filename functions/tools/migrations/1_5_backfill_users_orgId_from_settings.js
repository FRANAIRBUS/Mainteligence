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
  const limit = args["limit"] ? parseInt(args["limit"], 10) : 0;

  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
  }

  const db = admin.firestore();
  const FieldValue = admin.firestore.FieldValue;

  const settingsSnap = await db.collection("settings").doc("app").get();
  if (!settingsSnap.exists) throw new Error("settings/app no existe");
  const orgId = (settingsSnap.data() || {}).organizationId || "default";

  console.log(`[1.5] Backfill users.organizationId = ${orgId} (dry-run=${dryRun})`);

  let q = db.collection("users").where("organizationId", "==", null);
  // Firestore no permite where == null directo si el campo no existe.
  // Así que leemos en lotes y solo actualizamos si falta.
  q = db.collection("users");
  if (limit > 0) q = q.limit(limit);

  const snap = await q.get();
  console.log(`[1.5] users leídos: ${snap.size}`);

  let toUpdate = 0;
  let batch = db.batch();
  let n = 0;

  for (const d of snap.docs) {
    const data = d.data() || {};
    if (data.organizationId) continue;

    toUpdate++;
    if (dryRun) {
      console.log(`[1.5] DRY-RUN user ${d.id}: set organizationId=${orgId}`);
      continue;
    }

    batch.update(d.ref, {
      organizationId: orgId,
      updatedAt: FieldValue.serverTimestamp(),
      orgIdBackfilledAt: FieldValue.serverTimestamp(),
    });
    n++;

    if (n >= 400) {
      await batch.commit();
      batch = db.batch();
      n = 0;
    }
  }
  if (!dryRun && n > 0) await batch.commit();

  console.log(`[1.5] users a actualizar: ${toUpdate}`);
  console.log(`[1.5] DONE`);
})().catch((e) => {
  console.error("[1.5] ERROR:", e);
  process.exit(1);
});
