/* Prepara y ejecuta la simulación completa del evento:
   1) compila una copia de la página apuntando al emulador (proyecto demo, nunca la base real),
   2) levanta el emulador de Firestore con las reglas reales,
   3) corre tests/e2e/event.mjs con navegadores reales,
   4) limpia la copia temporal. */
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { CONFIG } from "../../src/config.ts";

const node = process.execPath; // el Node del sistema (el CLI de Firebase trae otro más antiguo)
const OUT = ".e2e-dist";
const run = (cmd, args, env = {}) => {
  const r = spawnSync(cmd, args, { stdio: "inherit", env: { ...process.env, ...env } });
  if (r.status !== 0) { rmSync(OUT, { recursive: true, force: true }); process.exit(r.status ?? 1); }
};

console.log("▶ Compilando copia de prueba (emulador)…");
run(node, ["node_modules/astro/bin/astro.mjs", "build", "--outDir", OUT, "--silent"], { PUBLIC_FIRESTORE_EMULATOR: "127.0.0.1:8080" });

const E2E_CONFIG = JSON.stringify({
  jurados: CONFIG.jurados.map(({ id, clave, nombre }) => ({ id, clave, nombre })),
  equipos: CONFIG.equipos,
  criterios: CONFIG.criterios.map(({ id, peso }) => ({ id, peso })),
  adminClave: CONFIG.admin.clave,
});

console.log("▶ Emulador de Firestore + simulación del evento…");
const r = spawnSync("firebase", ["emulators:exec", "--only", "firestore", "--project", "demo-despega", `${node} tests/e2e/event.mjs`],
  { stdio: "inherit", env: { ...process.env, E2E_CONFIG } });
rmSync(OUT, { recursive: true, force: true });
rmSync("firestore-debug.log", { force: true });
process.exit(r.status ?? 1);
