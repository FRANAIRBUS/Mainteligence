// 6_backfill_ticket_created_by_name.js
const { initAdmin, parseArgs, commitBatches } = require("./common");

(async () => {
  const args = parseArgs(process.argv);
  const dryRun = !!args["dry-run"];
  const limit = args["limit"] ? parseInt(args["limit"], 10) : 0;

  const admin = initAdmin();
  const db = admin.firestore();
  const FieldValue = admin.firestore.FieldValue;

  console.log(`[6] Backfill ticket createdByName (dry-run=${dryRun})`);

  let q = db.collectionGroup("tickets");
  if (limit > 0) q = q.limit(limit);

  const ticketsSnap = await q.get();
  console.log(`[6] tickets leídos (collectionGroup): ${ticketsSnap.size}`);

  const writes = [];
  let changed = 0;

  for (const doc of ticketsSnap.docs) {
    const data = doc.data() || {};
    const existing = String(data.createdByName ?? "").trim();
    const createdBy = String(data.createdBy ?? "").trim();

    if (existing || !createdBy) continue;

    const orgId = doc.ref.parent.parent?.id;
    let resolvedName = "";

    if (orgId) {
      const memberRef = db.doc(`organizations/${orgId}/members/${createdBy}`);
      const memberSnap = await memberRef.get();
      if (memberSnap.exists) {
        const member = memberSnap.data() || {};
        resolvedName = String(member.displayName || member.email || "").trim();
      }
    }

    if (!resolvedName) {
      const userRef = db.doc(`users/${createdBy}`);
      const userSnap = await userRef.get();
      if (userSnap.exists) {
        const userData = userSnap.data() || {};
        resolvedName = String(userData.displayName || userData.email || "").trim();
      }
    }

    if (!resolvedName) {
      resolvedName = createdBy;
    }

    const payload = {
      createdByName: resolvedName,
      updatedAt: FieldValue.serverTimestamp(),
      source: "migration_6_backfill_ticket_created_by_name",
    };

    writes.push((batch) => batch.update(doc.ref, payload));
    changed++;
  }

  const committed = await commitBatches(db, writes, dryRun);
  console.log(`[6] tickets backfilled: ${changed} (ops=${committed})`);
  console.log(`[6] DONE`);
})().catch((e) => {
  console.error("[6] ERROR:", e);
  process.exit(1);
});
