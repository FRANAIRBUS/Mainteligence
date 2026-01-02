// 2_migrate_memberships.js
const { initAdmin, parseArgs, commitBatches, normalizeRole } = require("./common");

(async () => {
  const args = parseArgs(process.argv);
  const dryRun = !!args["dry-run"];
  const limit = args["limit"] ? parseInt(args["limit"], 10) : 0;
  const force = !!args["force"]; // si true, sobreescribe role/departments
  const orgOnly = args["org"] ? String(args["org"]) : null;

  const admin = initAdmin();
  const db = admin.firestore();
  const FieldValue = admin.firestore.FieldValue;

  console.log(`[2] Migrate memberships (dry-run=${dryRun}, force=${force}, org=${orgOnly || "ALL"})`);

  let q = db.collection("users");
  if (limit > 0) q = q.limit(limit);

  const usersSnap = await q.get();
  console.log(`[2] users encontrados: ${usersSnap.size}`);

  const writes = [];
  let usersProcessed = 0;
  let membershipsPlanned = 0;

  for (const u of usersSnap.docs) {
    const uid = u.id;
    const user = u.data() || {};

    // Detecta org(s) desde varios posibles formatos
    let orgIds = [];

    if (orgOnly) {
      // Si se filtra por org, solo esa
      orgIds = [orgOnly];
    } else if (typeof user.organizationId === "string" && user.organizationId.trim()) {
      orgIds = [user.organizationId.trim()];
    } else if (Array.isArray(user.organizationIds) && user.organizationIds.length) {
      orgIds = user.organizationIds.filter(Boolean).map(String);
    } else if (user.organizations && typeof user.organizations === "object") {
      // ejemplo: organizations: { orgA: true, orgB: true }
      orgIds = Object.keys(user.organizations);
    }

    if (!orgIds.length) continue;

    const roleNorm = normalizeRole(user.role || user.userRole || null);
    const deptId = user.departmentId || null;
    const deptIds =
      Array.isArray(user.departmentIds) ? user.departmentIds :
      Array.isArray(user.departmentIdList) ? user.departmentIdList :
      null;

    for (const orgId of orgIds) {
      const memberRef = db.collection("organizations").doc(orgId).collection("members").doc(uid);

      // Datos seguros a escribir
      const memberData = {
        uid,
        orgId,
        email: user.email || null,
        displayName: user.displayName || user.name || null,
        updatedAt: FieldValue.serverTimestamp(),
        createdAt: user.createdAt || FieldValue.serverTimestamp(),
        source: "migration_memberships_v1",
      };

      // Solo setear role/departamentos si force o si vienen definidos
      if (force) {
        memberData.role = roleNorm;
        memberData.departmentId = deptId;
        memberData.departmentIds = deptIds || null;
      } else {
        // En modo seguro, los ponemos solo si existen (y no tocamos si null)
        if (roleNorm) memberData.role = roleNorm;
        if (deptId) memberData.departmentId = deptId;
        if (deptIds && deptIds.length) memberData.departmentIds = deptIds;
      }

      writes.push((batch) => batch.set(memberRef, memberData, { merge: true }));
      membershipsPlanned++;
    }

    usersProcessed++;
  }

  const committed = await commitBatches(db, writes, dryRun);
  console.log(`[2] users procesados: ${usersProcessed}`);
  console.log(`[2] memberships planificados: ${membershipsPlanned}`);
  console.log(`[2] operaciones preparadas/commiteadas: ${committed}`);
  console.log(`[2] DONE`);
})().catch((e) => {
  console.error("[2] ERROR:", e);
  process.exit(1);
});
