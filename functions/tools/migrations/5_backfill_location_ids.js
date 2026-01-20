// 5_backfill_location_ids.js
const { initAdmin, parseArgs, commitBatches } = require("./common");

(async () => {
  const args = parseArgs(process.argv);
  const dryRun = !!args["dry-run"];
  const limit = args["limit"] ? parseInt(args["limit"], 10) : 0;
  const scope = args["scope"] ? String(args["scope"]) : "both"; // users | members | both

  const admin = initAdmin();
  const db = admin.firestore();
  const FieldValue = admin.firestore.FieldValue;

  console.log(`[5] Backfill locationId/siteId (dry-run=${dryRun}, scope=${scope})`);

  let totalOps = 0;

  const buildLocationUpdate = (data) => {
    const locationId = String(data?.locationId ?? "").trim();
    const siteId = String(data?.siteId ?? "").trim();

    if (locationId || !siteId) return null;

    return {
      locationId: siteId,
      siteId,
      updatedAt: FieldValue.serverTimestamp(),
      source: "migration_5_backfill_location_ids",
    };
  };

  if (scope === "users" || scope === "both") {
    let uq = db.collection("users");
    if (limit > 0) uq = uq.limit(limit);

    const usersSnap = await uq.get();
    console.log(`[5] users leídos: ${usersSnap.size}`);

    const writes = [];
    let changed = 0;

    for (const d of usersSnap.docs) {
      const data = d.data() || {};
      const payload = buildLocationUpdate(data);
      if (!payload) continue;

      writes.push((batch) => batch.update(d.ref, payload));
      changed++;
    }

    const committed = await commitBatches(db, writes, dryRun);
    totalOps += committed;
    console.log(`[5] users locationId backfilled: ${changed} (ops=${committed})`);
  }

  if (scope === "members" || scope === "both") {
    let mq = db.collectionGroup("members");
    if (limit > 0) mq = mq.limit(limit);

    const membersSnap = await mq.get();
    console.log(`[5] members leídos (collectionGroup): ${membersSnap.size}`);

    const writes = [];
    let changed = 0;

    for (const d of membersSnap.docs) {
      const data = d.data() || {};
      const payload = buildLocationUpdate(data);
      if (!payload) continue;

      writes.push((batch) => batch.update(d.ref, payload));
      changed++;
    }

    const committed = await commitBatches(db, writes, dryRun);
    totalOps += committed;
    console.log(`[5] members locationId backfilled: ${changed} (ops=${committed})`);
  }

  console.log(`[5] total ops: ${totalOps}`);
  console.log(`[5] DONE`);
})().catch((e) => {
  console.error("[5] ERROR:", e);
  process.exit(1);
});
