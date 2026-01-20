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

function normalizeRole(roleRaw) {
  if (!roleRaw || typeof roleRaw !== "string") return null;
  const r = roleRaw.trim().toLowerCase();
  const map = {
    operario: "operario",
    operador: "operario",
    operator: "operario",
    mantenimiento: "mantenimiento",
    tecnico: "mantenimiento",
    maintenance: "mantenimiento",
    admin: "admin",
    administrador: "admin",
    super_admin: "super_admin",
    owner: "owner",
    dept_head: "jefe_departamento",
    dept_head_multi: "jefe_departamento",
  };
  return map[r] || r;
}

(async () => {
  const args = parseArgs(process.argv);
  const dryRun = !!args["dry-run"];
  const limit = args["limit"] ? parseInt(args["limit"], 10) : 0;
  const force = !!args["force"]; // si true, reescribe role/dept aunque ya existan

  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
  }

  const db = admin.firestore();
  const FieldValue = admin.firestore.FieldValue;

  console.log(`[2] Crear /organizations/{orgId}/members/{uid} desde users (dry-run=${dryRun}, force=${force})`);

  // 1) leer orgId desde settings/app
  const settingsSnap = await db.collection("settings").doc("app").get();
  if (!settingsSnap.exists) {
    throw new Error("settings/app no existe; no puedo determinar organizationId");
  }
  const orgId = (settingsSnap.data() || {}).organizationId || "default";
  console.log(`[2] organizationId detectado: ${orgId}`);

  // 2) asegurar que exista doc organizations/{orgId} (mínimo)
  const orgRef = db.collection("organizations").doc(orgId);
  if (!dryRun) {
    await orgRef.set(
      { organizationId: orgId, updatedAt: FieldValue.serverTimestamp(), source: "migration_create_org_stub_v1" },
      { merge: true }
    );
  } else {
    console.log(`[2] DRY-RUN: aseguraría organizations/${orgId} (stub mínimo)`);
  }

  let q = db.collection("users");
  if (limit > 0) q = q.limit(limit);
  const usersSnap = await q.get();

  console.log(`[2] users encontrados: ${usersSnap.size}`);

  // batch limit 500: usamos 400
  const docs = usersSnap.docs;
  let ops = 0;
  let changed = 0;

  const commitBatch = async (batch) => {
    if (dryRun) return;
    await batch.commit();
  };

  let batch = db.batch();
  let batchOps = 0;

  for (const u of docs) {
    const uid = u.id;
    const user = u.data() || {};
    const memberRef = db.collection("organizations").doc(orgId).collection("members").doc(uid);

    const memberData = {
      uid,
      orgId,
      email: user.email || null,
      displayName: user.displayName || null,
      active: user.active !== undefined ? !!user.active : true,
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: user.createdAt || FieldValue.serverTimestamp(),
      source: "migration_members_from_users_v1",
    };

    const roleNorm = normalizeRole(user.role || null);
    if (roleNorm) memberData.role = roleNorm;
    if (user.departmentId) memberData.departmentId = user.departmentId;

    // Si no force, hacemos merge y no borramos campos existentes.
    // Si force, igualmente merge pero sobreescribimos role/departmentId con lo actual.
    // (merge hace lo que queremos en ambos casos)
    if (dryRun) {
      console.log(`[2] DRY-RUN set members/${uid}`, memberData);
      changed++;
      continue;
    }

    batch.set(memberRef, memberData, { merge: true });
    batchOps++;
    ops++;

    if (batchOps >= 400) {
      await commitBatch(batch);
      batch = db.batch();
      batchOps = 0;
    }
    changed++;
  }

  if (batchOps > 0) await commitBatch(batch);

  console.log(`[2] members escritos: ${changed} (ops=${ops})`);
  console.log(`[2] DONE`);
})().catch((e) => {
  console.error("[2] ERROR:", e);
  process.exit(1);
});
