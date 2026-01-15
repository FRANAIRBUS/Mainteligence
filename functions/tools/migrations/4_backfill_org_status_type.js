// 4_backfill_org_status_type.js
const { initAdmin, parseArgs, commitBatches } = require("./common");

(async () => {
  const args = parseArgs(process.argv);
  const dryRun = !!args["dry-run"];
  const limit = args["limit"] ? parseInt(args["limit"], 10) : 0;

  const admin = initAdmin();
  const db = admin.firestore();
  const FieldValue = admin.firestore.FieldValue;

  console.log(`[4] Backfill org status/type (dry-run=${dryRun})`);

  let q = db.collection("organizations");
  if (limit > 0) q = q.limit(limit);

  const snap = await q.get();
  console.log(`[4] organizations encontrados: ${snap.size}`);

  const writes = [];
  let touched = 0;

  for (const doc of snap.docs) {
    const orgId = doc.id;
    const data = doc.data() || {};

    const statusExists = typeof data.status === "string" && data.status.trim() !== "";
    const typeExists = typeof data.type === "string" && data.type.trim() !== "";
    if (statusExists && typeExists) continue;

    const isDemo = orgId.startsWith("demo-") || data.demoExpiresAt != null;
    const nextType = typeExists ? data.type : isDemo ? "demo" : "standard";
    const nextStatus = statusExists ? data.status : data.isActive === false ? "suspended" : "active";
    const isActive = nextStatus === "active";

    touched += 1;

    const orgRef = db.collection("organizations").doc(orgId);
    writes.push((batch) =>
      batch.set(
        orgRef,
        {
          type: nextType,
          status: nextStatus,
          isActive,
          updatedAt: FieldValue.serverTimestamp(),
          source: "migration_backfill_org_status_type_v1",
        },
        { merge: true }
      )
    );

    const publicRef = db.collection("organizationsPublic").doc(orgId);
    writes.push((batch) =>
      batch.set(
        publicRef,
        {
          type: nextType,
          status: nextStatus,
          isActive,
          updatedAt: FieldValue.serverTimestamp(),
          source: "migration_backfill_org_status_type_v1",
        },
        { merge: true }
      )
    );
  }

  const committed = await commitBatches(db, writes, dryRun);
  console.log(`[4] organizations actualizadas: ${touched}`);
  console.log(`[4] operaciones preparadas/commiteadas: ${committed}`);
  console.log(`[4] DONE`);
})().catch((e) => {
  console.error("[4] ERROR:", e);
  process.exit(1);
});
