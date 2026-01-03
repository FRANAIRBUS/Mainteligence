// 1_backfill_org_public.js
const { initAdmin, parseArgs, commitBatches } = require("./common");

(async () => {
  const args = parseArgs(process.argv);
  const dryRun = !!args["dry-run"];
  const limit = args["limit"] ? parseInt(args["limit"], 10) : 0;

  const admin = initAdmin();
  const db = admin.firestore();
  const FieldValue = admin.firestore.FieldValue;

  console.log(`[1] Backfill organizationsPublic (dry-run=${dryRun})`);

  let q = db.collection("organizations");
  if (limit > 0) q = q.limit(limit);

  const snap = await q.get();
  console.log(`[1] organizations encontrados: ${snap.size}`);

  const writes = [];
  for (const doc of snap.docs) {
    const orgId = doc.id;
    const data = doc.data() || {};

    // Public MINIMAL: evita exponer emails internos, settings, billing, etc.
    const publicDoc = {
      name: data.name || data.displayName || orgId,
      slug: data.slug || data.code || orgId,
      logoUrl: data.logoUrl || data.logo || null,
      isActive: data.isActive !== undefined ? !!data.isActive : true,
      updatedAt: FieldValue.serverTimestamp(),
      // si existe createdAt original, respétalo; si no, lo añadimos
      createdAt: data.createdAt || FieldValue.serverTimestamp(),
      source: "migration_backfill_v1",
    };

    const ref = db.collection("organizationsPublic").doc(orgId);
    writes.push((batch) => batch.set(ref, publicDoc, { merge: true }));
  }

  const committed = await commitBatches(db, writes, dryRun);
  console.log(`[1] operaciones preparadas/commiteadas: ${committed}`);
  console.log(`[1] DONE`);
})().catch((e) => {
  console.error("[1] ERROR:", e);
  process.exit(1);
});
