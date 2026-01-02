// 3_normalize_roles.js
const { initAdmin, parseArgs, commitBatches, normalizeRole } = require("./common");

(async () => {
  const args = parseArgs(process.argv);
  const dryRun = !!args["dry-run"];
  const limit = args["limit"] ? parseInt(args["limit"], 10) : 0;
  const scope = args["scope"] ? String(args["scope"]) : "both"; // users | members | both

  const admin = initAdmin();
  const db = admin.firestore();
  const FieldValue = admin.firestore.FieldValue;

  console.log(`[3] Normalize roles (dry-run=${dryRun}, scope=${scope})`);

  let totalOps = 0;

  // A) USERS
  if (scope === "users" || scope === "both") {
    let uq = db.collection("users");
    if (limit > 0) uq = uq.limit(limit);

    const usersSnap = await uq.get();
    console.log(`[3] users leídos: ${usersSnap.size}`);

    const writes = [];
    let changed = 0;

    for (const d of usersSnap.docs) {
      const data = d.data() || {};
      const roleRaw = data.role || data.userRole || null;
      if (!roleRaw) continue;

      const roleNorm = normalizeRole(roleRaw);
      if (!roleNorm) continue;

      // Si ya está igual (case-insensitive), no tocamos
      if (String(roleRaw).trim().toLowerCase() === String(roleNorm).trim().toLowerCase()) continue;

      const ref = db.collection("users").doc(d.id);
      writes.push((batch) =>
        batch.update(ref, {
          role: roleNorm,
          roleLegacy: roleRaw,
          updatedAt: FieldValue.serverTimestamp(),
        })
      );
      changed++;
    }

    const committed = await commitBatches(db, writes, dryRun);
    totalOps += committed;
    console.log(`[3] users roles cambiados: ${changed} (ops=${committed})`);
  }

  // B) MEMBERS (collectionGroup)
  if (scope === "members" || scope === "both") {
    // OJO: puede ser enorme. Si es grande, ejecuta por org con un script específico o añade filtros.
    let mq = db.collectionGroup("members");
    if (limit > 0) mq = mq.limit(limit);

    const membersSnap = await mq.get();
    console.log(`[3] members leídos (collectionGroup): ${membersSnap.size}`);

    const writes = [];
    let changed = 0;

    for (const d of membersSnap.docs) {
      const data = d.data() || {};
      const roleRaw = data.role || null;
      if (!roleRaw) continue;

      const roleNorm = normalizeRole(roleRaw);
      if (!roleNorm) continue;

      if (String(roleRaw).trim().toLowerCase() === String(roleNorm).trim().toLowerCase()) continue;

      writes.push((batch) =>
        batch.update(d.ref, {
          role: roleNorm,
          roleLegacy: roleRaw,
          updatedAt: FieldValue.serverTimestamp(),
        })
      );
      changed++;
    }

    const committed = await commitBatches(db, writes, dryRun);
    totalOps += committed;
    console.log(`[3] members roles cambiados: ${changed} (ops=${committed})`);
  }

  console.log(`[3] total ops: ${totalOps}`);
  console.log(`[3] DONE`);
})().catch((e) => {
  console.error("[3] ERROR:", e);
  process.exit(1);
});
