// common.js
const admin = require("firebase-admin");

function initAdmin() {
  if (admin.apps.length) return admin;
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
  });
  return admin;
}

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

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function commitBatches(firestore, writes, dryRun) {
  // Firestore batch limit is 500. Usamos 400 por margen.
  const batches = chunk(writes, 400);
  let committed = 0;

  for (const ops of batches) {
    if (dryRun) {
      committed += ops.length;
      continue;
    }
    const batch = firestore.batch();
    for (const op of ops) op(batch);
    await batch.commit();
    committed += ops.length;
  }
  return committed;
}

function normalizeRole(roleRaw) {
  if (!roleRaw || typeof roleRaw !== "string") return null;
  const r = roleRaw.trim().toLowerCase();

  // Mapa (ajusta si tu app usa otros strings)
  const map = {
    operario: "operator",
    operador: "operator",
    operator: "operator",

    mantenimiento: "maintenance",
    tecnico: "maintenance",
    maintenance: "maintenance",

    admin: "admin",
    administrador: "admin",
    administrator: "admin",

    dept_head: "dept_head",
    jefe_departamento: "dept_head",
    "jefe de departamento": "dept_head",

    dept_head_multi: "dept_head_multi",
    jefe_departamento_multi: "dept_head_multi",
    "jefe de departamento multi": "dept_head_multi",

    super_admin: "super_admin",
    owner: "owner",
  };

  return map[r] || r; // Si no está mapeado, lo deja tal cual (pero normalizado a lower)
}

module.exports = { initAdmin, parseArgs, commitBatches, normalizeRole };

