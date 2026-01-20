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

  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
  }

  const db = admin.firestore();
  const FieldValue = admin.firestore.FieldValue;

  console.log(`[3] Normalize roles users + members (dry-run=${dryRun})`);

  // orgId desde settings/app
  const settingsSnap = await db.collection("settings").doc("app").get();
  const orgId = (settingsSnap.data() || {}).organizationId || "default";
  console.log(`[3] organizationId: ${orgId}`);

  // A) USERS
  let uq = db.collection("users");
  if (limit > 0) uq = uq.limit(limit);
  const usersSnap = await uq.get();

  let userOps = 0;
  if (!dryRun) {
    let batch = db.batch();
    let n = 0;

    for (const d of usersSnap.docs) {
      const data = d.data() || {};
      const roleRaw = data.role || null;
      if (!roleRaw) continue;

      const roleNorm = normalizeRole(roleRaw);
      if (!roleNorm) continue;

      if (String(roleRaw).trim().toLowerCase() === String(roleNorm).trim().toLowerCase()) continue;

      batch.update(d.ref, {
        role: roleNorm,
        roleLegacy: roleRaw,
        updatedAt: FieldValue.serverTimestamp(),
      });
      n++;
      userOps++;

      if (n >= 400) {
        await batch.commit();
        batch = db.batch();
        n = 0;
      }
    }
    if (n > 0) await batch.commit();
  } else {
    for (const d of usersSnap.docs) {
      const data = d.data() || {};
      const roleRaw = data.role || null;
      const roleNorm = normalizeRole(roleRaw);
      if (roleRaw && roleNorm && String(roleRaw).trim().toLowerCase() !== String(roleNorm).trim().toLowerCase()) {
        console.log(`[3] DRY-RUN user ${d.id}: ${roleRaw} -> ${roleNorm}`);
        userOps++;
      }
    }
  }

  console.log(`[3] users roles to update: ${userOps}`);

  // B) MEMBERS
  let mq = db.collection("organizations").doc(orgId).collection("members");
  if (limit > 0) mq = mq.limit(limit);
  const membersSnap = await mq.get();

  let memberOps = 0;
  if (!dryRun) {
    let batch = db.batch();
    let n = 0;

    for (const d of membersSnap.docs) {
      const data = d.data() || {};
      const roleRaw = data.role || null;
      if (!roleRaw) continue;

      const roleNorm = normalizeRole(roleRaw);
      if (!roleNorm) continue;

      if (String(roleRaw).trim().toLowerCase() === String(roleNorm).trim().toLowerCase()) continue;

      batch.update(d.ref, {
        role: roleNorm,
        roleLegacy: roleRaw,
        updatedAt: FieldValue.serverTimestamp(),
      });
      n++;
      memberOps++;

      if (n >= 400) {
        await batch.commit();
        batch = db.batch();
        n = 0;
      }
    }
    if (n > 0) await batch.commit();
  } else {
    for (const d of membersSnap.docs) {
      const data = d.data() || {};
      const roleRaw = data.role || null;
      const roleNorm = normalizeRole(roleRaw);
      if (roleRaw && roleNorm && String(roleRaw).trim().toLowerCase() !== String(roleNorm).trim().toLowerCase()) {
        console.log(`[3] DRY-RUN member ${d.id}: ${roleRaw} -> ${roleNorm}`);
        memberOps++;
      }
    }
  }

  console.log(`[3] members roles to update: ${memberOps}`);
  console.log(`[3] DONE`);
})().catch((e) => {
  console.error("[3] ERROR:", e);
  process.exit(1);
});
