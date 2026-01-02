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

async function backfillCollection(db, colName, orgId, { dryRun, limit, force }) {
  let q = db.collection(colName);
  if (limit > 0) q = q.limit(limit);

  const snap = await q.get();
  console.log(`\n[1.6] ${colName}: docs leídos=${snap.size}`);

  let missing = 0;
  let updated = 0;

  let batch = db.batch();
  let n = 0;

  for (const d of snap.docs) {
    const data = d.data() || {};
    const current = data.organizationId;

    const needsFill = current === undefined || current === null || current === "";
    const shouldUpdate = force ? true : needsFill;

    if (!shouldUpdate) continue;

    if (needsFill) missing++;

    const payload = {
      organizationId: orgId,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      orgIdBackfilledAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    // Si había algo raro y force=true, guardamos legacy
    if (force && current && current !== orgId) {
      payload.organizationIdLegacy = current;
    }

    if (dryRun) {
      console.log(`[1.6] DRY-RUN ${colName}/${d.id}: ${current} -> ${orgId}`);
      updated++;
      continue;
    }

    batch.update(d.ref, payload);
    n++;
    updated++;

    if (n >= 400) {
      await batch.commit();
      batch = db.batch();
      n = 0;
    }
  }

  if (!dryRun && n > 0) await batch.commit();

  console.log(`[1.6] ${colName}: missing=${missing}, updated=${updated}, force=${force}`);
  return { missing, updated };
}

(async () => {
  const args = parseArgs(process.argv);
  const dryRun = !!args["dry-run"];
  const limit = args["limit"] ? parseInt(args["limit"], 10) : 0;
  const force = !!args["force"]; // ⚠️ si lo activas, unifica a una sola org y guarda legacy
  const only = args["only"] ? String(args["only"]).split(",").map(s => s.trim()).filter(Boolean) : null;

  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
  }

  const db = admin.firestore();

  const settingsSnap = await db.collection("settings").doc("app").get();
  if (!settingsSnap.exists) throw new Error("settings/app no existe");
  const orgId = (settingsSnap.data() || {}).organizationId || "default";

  console.log(`[1.6] Backfill organizationId en colecciones (dry-run=${dryRun}, limit=${limit || "ALL"}, force=${force})`);
  console.log(`[1.6] orgId objetivo: ${orgId}`);

  const collections = ["tickets", "tasks", "sites", "assets", "departments", "users"];
  const targets = only ? collections.filter(c => only.includes(c)) : collections;

  for (const col of targets) {
    await backfillCollection(db, col, orgId, { dryRun, limit, force });
  }

  console.log(`\n[1.6] DONE`);
})().catch((e) => {
  console.error("[1.6] ERROR:", e);
  process.exit(1);
});
