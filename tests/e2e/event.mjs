/* =========================================================
   Simulación completa del evento (navegadores reales + emulador de Firestore).
   Ejecutar con:  npm run test:e2e
   Nunca toca la base de datos real: usa el proyecto "demo-despega" del emulador.
   ========================================================= */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname } from "node:path";
import { homedir } from "node:os";

const DIST = ".e2e-dist";
const PORT = 4590;
const BASE = `http://localhost:${PORT}`;
const FS = "http://127.0.0.1:8080/v1/projects/demo-despega/databases/(default)/documents";

/* ---------- datos del evento (deben coincidir con src/config.ts) ---------- */
const CFG = JSON.parse(process.env.E2E_CONFIG);
const JUR = CFG.jurados;          // [{id, clave, nombre}]
const EQ = CFG.equipos;           // ["Equipo 01", …]
const CRIT = CFG.criterios;       // [{id, peso}]
const ADMIN = CFG.adminClave;

/* ---------- mini framework de aserciones ---------- */
const results = [];
let current = "";
const ok = (cond, msg, extra = "") => {
  results.push({ scenario: current, ok: !!cond, msg });
  console.log(`  ${cond ? "✔" : "✘"} ${msg}${!cond && extra ? `  →  ${extra}` : ""}`);
};
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), msg, `obtenido ${JSON.stringify(a)}, esperado ${JSON.stringify(b)}`);
const scenario = (name) => { current = name; console.log(`\n▶ ${name}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 8000, step = 100) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { const v = await fn(); if (v) return v; } catch {} await sleep(step); }
  return null;
}

/* ---------- servidor estático del build de prueba ---------- */
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml" };
const server = createServer(async (req, res) => {
  const u = new URL(req.url, BASE);
  let p = decodeURIComponent(u.pathname);
  // Igual que Firebase Hosting: /jurado → 301 → /jurado/
  if (!extname(p) && !p.endsWith("/")) { res.writeHead(301, { Location: p + "/" + u.search }); res.end(); return; }
  if (p.endsWith("/")) p += "index.html";
  try { const b = await readFile(join(DIST, p)); res.writeHead(200, { "Content-Type": MIME[extname(p)] || "application/octet-stream" }); res.end(b); }
  catch { res.writeHead(404); res.end("404"); }
});
await new Promise((r) => server.listen(PORT, r));

/* ---------- navegador ---------- */
async function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const base = join(homedir(), ".cache/ms-playwright");
  const dirs = existsSync(base) ? (await readdir(base)).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse() : [];
  for (const d of dirs) { const p = join(base, d, "chrome-linux64/chrome"); if (existsSync(p)) return p; }
  return undefined; // playwright usa el suyo
}
const browser = await chromium.launch({ executablePath: await chromePath() });
const pageErrors = [];
async function phone() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/net::ERR|Failed to load resource|WebChannelConnection|Could not reach Cloud Firestore|offline mode/i.test(m.text())) pageErrors.push(m.text()); });
  return page;
}
async function login(page, id, clave) {
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.click(`[data-id="${id}"]`);
  await page.fill("#pinInput", clave);
  await page.click('#pinForm button[type="submit"]');
}
/** Califica un equipo escribiendo como lo haría un jurado (con avance automático). */
async function scoreTeam(page, i, notas, comentario = "") {
  await page.click(`.team >> nth=${i}`);
  await page.waitForSelector("#scoreSheet:not([hidden])");
  await page.tap(".nota >> nth=0");
  for (const n of notas) {
    await page.keyboard.type(String(n));
    await sleep(n === 1 ? 1050 : 200); // "1" espera por si es 10
  }
  if (comentario) await page.fill("#comment", comentario);
  const btn = await page.textContent("#sheetSaveText");
  await page.click("#sheetSave");
  await page.waitForSelector("#scoreSheet", { state: "hidden" });
  return btn;
}
const pill = (page, i) => page.$eval(`.team >> nth=${i}`, (e) => e.querySelector("[data-status]").textContent);

/* ---------- referencia independiente (aritmética entera) ---------- */
const totalX10 = (n) => CRIT.reduce((s, c, k) => s + n[k] * c.peso, 0); // puntaje × 10 (entero)
function expectedRanking(data) { // data[judgeId][team] = notas[]
  const teams = EQ.map((t) => {
    const ns = JUR.map((j) => data[j.id]?.[t]).filter(Boolean);
    const avg = ns.length ? Math.round((ns.reduce((s, n) => s + totalX10(n), 0) / 10 / ns.length) * 100) / 100 : null;
    return { t, n: ns.length, avg };
  }).filter((x) => x.n).sort((a, b) => b.avg - a.avg || a.t.localeCompare(b.t, "es"));
  return teams.map((x) => ({ ...x, rank: 1 + teams.filter((y) => Math.round(y.avg * 100) > Math.round(x.avg * 100)).length }));
}
const fmt = (n) => String(Math.round(n * 100) / 100);
async function adminRanking(page) {
  return page.$$eval("#tab-final .rrow:not(.rrow--pending)", (rows) => rows.map((r) => ({
    rank: Number(r.querySelector(".rank").textContent),
    t: r.dataset.team,
    score: r.querySelector(".rrow__score").textContent.replace("/100", ""),
    tie: !!r.querySelector(".tie"),
  })));
}
async function firestoreDocs() {
  const res = await fetch(`${FS}/calificaciones?pageSize=500`, { headers: { Authorization: "Bearer owner" } });
  const j = await res.json();
  return (j.documents || []).map((d) => {
    const o = { _id: d.name.split("/").pop() };
    for (const [k, v] of Object.entries(d.fields)) o[k] = v.integerValue !== undefined ? Number(v.integerValue) : v.doubleValue ?? v.stringValue;
    return o;
  });
}

/* ---------- notas del evento simulado ---------- */
// Determinista (semilla) para reproducir; incluye un empate forzado entre Equipo 03 y Equipo 04.
let seed = 20261105;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const data = {};
for (const j of JUR) {
  data[j.id] = {};
  EQ.forEach((t, i) => { data[j.id][t] = CRIT.map(() => 1 + Math.floor(rnd() * 10)); });
}
if (EQ.length >= 4) for (const j of JUR) data[j.id][EQ[3]] = [...data[j.id][EQ[2]]]; // empate exacto
// Algunas notas extremas para cubrir bordes de entrada (1 y 10)
data[JUR[0].id][EQ[0]] = [10, 10, 10, 10, 10];
data[JUR[0].id][EQ[1]] = [1, 1, 1, 1, 1];

const t0 = Date.now();
try {
  /* ===================================================== */
  scenario("1. Acceso y claves");
  {
    const p = await phone();
    await login(p, JUR[0].id, "clave-incorrecta");
    ok(await p.isVisible("#pinError"), "clave incorrecta muestra error y no entra");
    ok(p.url().endsWith("/"), "sigue en la pantalla de acceso");
    await p.click("#pinEye");
    eq(await p.getAttribute("#pinInput", "type"), "text", "el ojito muestra la clave");
    await p.click("#pinEye");
    eq(await p.getAttribute("#pinInput", "type"), "password", "el ojito la vuelve a ocultar");
    await p.fill("#pinInput", JUR[0].clave);
    await p.click('#pinForm button[type="submit"]');
    ok(await p.waitForURL("**/jurado/", { timeout: 5000 }).then(() => true, () => false), "clave correcta entra a sus equipos");
    eq(await p.$$eval(".team", (e) => e.length), EQ.length, `ve los ${EQ.length} equipos`);
    // la sesión sobrevive a cerrar y abrir la página
    const ctx = p.context();
    await p.close();
    const p2 = await ctx.newPage();
    await p2.goto(BASE + "/", { waitUntil: "domcontentloaded" });
    ok(await p2.waitForURL("**/jurado/", { timeout: 5000 }).then(() => true, () => false), "al reabrir la página sigue conectado (no pide clave)");
    await p2.click("#logoutBtn");
    ok(await p2.waitForURL(BASE + "/", { timeout: 5000 }).then(() => true, () => false), "Salir cierra la sesión");
    await p2.goto(BASE + "/jurado/", { waitUntil: "domcontentloaded" });
    ok(await p2.waitForURL(BASE + "/", { timeout: 5000 }).then(() => true, () => false), "sin sesión, /jurado redirige al acceso");
    await p2.goto(BASE + "/admin/", { waitUntil: "domcontentloaded" });
    ok(await p2.waitForURL(BASE + "/", { timeout: 5000 }).then(() => true, () => false), "sin sesión, /admin redirige al acceso");
    await login(p2, "admin", "mala");
    ok(await p2.isVisible("#pinError"), "admin con clave incorrecta no entra");
    await ctx.close();
  }

  /* ===================================================== */
  scenario("2. Validación de notas en el modal");
  {
    const p = await phone();
    await login(p, JUR[1].id, JUR[1].clave);
    await p.waitForURL("**/jurado/");
    await p.click(".team >> nth=0");
    await p.waitForSelector("#scoreSheet:not([hidden])");
    eq(await p.textContent("#sheetSaveText"), `Faltan ${CRIT.length}`, "al abrir: 'Faltan 5' y Guardar deshabilitado");
    ok(await p.isDisabled("#sheetSave"), "Guardar deshabilitado");
    // el signo "-" se ignora (en el teclado numérico del celular no existe); "-3" queda como 3, que es válido
    await p.fill(".nota >> nth=0", ""); await p.type(".nota >> nth=0", "-3");
    eq(await p.inputValue(".nota >> nth=0"), "3", "el signo '-' se ignora");
    for (const [val, desc] of [["0", "0"], ["11", "11"], ["abc", "letras"], ["5.5", "decimal"], ["99", "99"]]) {
      await p.fill(".nota >> nth=0", "");
      await p.type(".nota >> nth=0", val);
      const v = await p.inputValue(".nota >> nth=0");
      const err = await p.$eval(".crit >> nth=0", (e) => e.classList.contains("crit--error"));
      const done = await p.$eval(".crit >> nth=0", (e) => e.classList.contains("crit--done"));
      ok(!done && (err || v === "" || !/^(10|[1-9])$/.test(v)), `rechaza ${desc} (queda "${v}")`);
    }
    ok(await p.isDisabled("#sheetSave"), "con notas inválidas no se puede guardar");
    // avance automático
    await p.fill(".nota >> nth=0", "");
    await p.tap(".nota >> nth=0");
    await p.keyboard.type("7"); await sleep(400);
    eq(await p.evaluate(() => document.activeElement?.closest(".crit")?.dataset.crit), CRIT[1].id, "al escribir 7 pasa solo al criterio 2");
    await p.keyboard.type("10"); await sleep(400);
    eq(await p.evaluate(() => document.activeElement?.closest(".crit")?.dataset.crit), CRIT[2].id, "al escribir 10 pasa al criterio 3");
    await p.keyboard.type("1"); await sleep(1200);
    eq(await p.evaluate(() => document.activeElement?.closest(".crit")?.dataset.crit), CRIT[3].id, "al escribir 1 espera y luego pasa al criterio 4");
    eq(await p.$$eval(".nota", (e) => e.map((x) => x.value)), ["7", "10", "1", "", ""], "valores correctos tras el avance");
    eq(await p.textContent("#sheetSaveText"), "Faltan 2", "contador de faltantes");
    // atrás cierra el modal sin salir
    await p.goBack();
    ok(await p.waitForSelector("#scoreSheet", { state: "hidden", timeout: 3000 }).then(() => true, () => false), "botón atrás cierra el modal");
    ok(p.url().includes("/jurado/"), "y sigue en la lista de equipos");
    eq(await pill(p, 0), "Sin terminar", "equipo a medias aparece 'Sin terminar'");
    // borrador: matar la pestaña y volver
    const ctx = p.context();
    await p.click(".team >> nth=0");
    await p.waitForSelector("#scoreSheet:not([hidden])");
    const url = p.url();
    await p.close();
    const p2 = await ctx.newPage();
    await p2.goto(url, { waitUntil: "domcontentloaded" });
    await p2.waitForSelector("#scoreSheet:not([hidden])", { timeout: 5000 });
    eq(await p2.$$eval(".nota", (e) => e.map((x) => x.value)), ["7", "10", "1", "", ""], "tras cerrar la pestaña (WhatsApp) el borrador se recupera");
    await ctx.close();
    const docs = await firestoreDocs();
    eq(docs.length, 0, "nada se envió a Firestore sin pulsar Guardar");
  }

  /* ===================================================== */
  scenario("3. Evento completo: 3 jurados calificando a la vez, admin en vivo");
  let admin;
  {
    admin = await phone();
    await login(admin, "admin", ADMIN);
    await admin.waitForURL("**/admin/");
    ok(await until(() => admin.textContent("#source").then((s) => s.includes("En vivo"))), "panel admin conectado 'En vivo'");
    eq(await admin.$$eval("#tab-final .rrow:not(.rrow--pending)", (e) => e.length), 0, "ranking vacío al inicio");

    const judges = await Promise.all(JUR.map(async (j) => { const p = await phone(); await login(p, j.id, j.clave); await p.waitForURL("**/jurado/"); return [j, p]; }));
    const tStart = Date.now();
    await Promise.all(judges.map(async ([j, p]) => {
      for (let i = 0; i < EQ.length; i++) {
        const btn = await scoreTeam(p, i, data[j.id][EQ[i]], i === 0 ? `Comentario de ${j.id} con "comillas", comas y ñ` : "");
        if (btn !== "Guardar") ok(false, `${j.id} · ${EQ[i]}: botón decía "${btn}" antes de guardar`);
      }
    }));
    const tScored = Date.now();
    console.log(`  · 3 jurados calificaron ${EQ.length} equipos cada uno en ${((tScored - tStart) / 1000).toFixed(1)} s`);

    for (const [j, p] of judges) {
      const allOk = await until(async () => (await p.$$eval("[data-status]", (e) => e.filter((x) => x.textContent === "✓ Calificado").length)) === EQ.length, 10000);
      ok(allOk, `${j.id}: los ${EQ.length} equipos '✓ Calificado' (confirmados por Firestore)`);
      eq(await p.textContent("#pct"), "100%", `${j.id}: avance 100%`);
    }

    const N = JUR.length * EQ.length;
    const tComplete = await until(async () => (await admin.textContent("#stats")).includes(`(${N}/${N})`), 10000);
    ok(tComplete, `admin muestra 'Todas las calificaciones recibidas (${N}/${N})'`);
    console.log(`  · el admin tuvo el ranking completo ${((Date.now() - tScored) / 1000).toFixed(2)} s después del último guardado`);

    const docs = await firestoreDocs();
    eq(docs.length, N, `Firestore tiene exactamente ${N} documentos (sin duplicados)`);
    let match = 0;
    for (const d of docs) {
      const exp = data[d.juradoId]?.[d.equipo];
      if (exp && CRIT.every((c, k) => d[c.id] === exp[k]) && Math.round(d.total * 100) === totalX10(exp) * 10) match++;
    }
    eq(match, N, "cada documento tiene exactamente las notas que escribió el jurado y su total correcto");
    eq(docs.filter((d) => d.comentario.includes('"comillas"')).length, JUR.length, "comentarios guardados con comillas/ñ intactos");

    const exp = expectedRanking(data);
    const got = await adminRanking(admin);
    eq(got.map((g) => g.t), exp.map((e) => e.t), "orden del ranking final = cálculo independiente");
    eq(got.map((g) => g.score), exp.map((e) => fmt(e.avg)), "promedios del ranking final = cálculo independiente");
    eq(got.map((g) => g.rank), exp.map((e) => e.rank), "puestos (con empates) = cálculo independiente");
    const tied = got.filter((g) => g.tie).map((g) => g.t).sort();
    ok(tied.includes(EQ[2]) && tied.includes(EQ[3]), `empate forzado detectado y marcado (${tied.join(", ")})`);
    const r3 = got.find((g) => g.t === EQ[2]).rank, r4 = got.find((g) => g.t === EQ[3]).rank;
    eq(r3, r4, "equipos empatados comparten puesto");

    // podio
    const podium = await admin.$$eval(".podium__item", (e) => e.map((x) => x.querySelector(".podium__team").textContent));
    eq(podium, exp.filter((e) => e.rank <= 3).map((e) => e.t), "podio = top 3 (incluye empatados)");

    // ranking por jurado
    await admin.click('.tab[data-tab="jurado"]');
    for (const j of JUR) {
      await admin.click(`.jpick__btn[data-judge="${j.id}"]`);
      const mine = await admin.$$eval("#tab-jurado .rrow:not(.rrow--pending)", (rows) => rows.map((r) => r.querySelector(".rrow__score").textContent.replace("/100", "")));
      const expJ = EQ.map((t) => totalX10(data[j.id][t]) / 10).sort((a, b) => b - a).map(fmt);
      eq(mine, expJ, `ranking individual de ${j.id} correcto`);
    }
    // por criterio
    await admin.click('.tab[data-tab="criterio"]');
    const critRow = await admin.$$eval("#tab-criterio tbody tr", (rows) => rows.map((r) => [...r.querySelectorAll("td")].map((td) => td.textContent.trim())));
    const first = exp[0];
    const rowFirst = critRow.find((r) => r[1] === first.t);
    const expCrit = CRIT.map((c, k) => fmt(JUR.reduce((s, j) => s + data[j.id][first.t][k], 0) / JUR.length));
    eq(rowFirst.slice(2, 2 + CRIT.length), expCrit, "promedio por criterio correcto (1° lugar)");
    await admin.click('.tab[data-tab="final"]');

    // CSV
    const [dl] = await Promise.all([admin.waitForEvent("download"), admin.click("#csvRankBtn")]);
    const csv = (await readFile(await dl.path(), "utf8")).replace(/^﻿/, "");
    const lines = csv.trim().split("\n");
    eq(lines.length, 1 + EQ.length, "CSV ranking: encabezado + una fila por equipo");
    const firstCsv = lines[1].split('","').map((s) => s.replace(/"/g, ""));
    eq([firstCsv[0], firstCsv[1]], ["1", exp[0].t], "CSV ranking: 1° lugar correcto");
    const [dl2] = await Promise.all([admin.waitForEvent("download"), admin.click("#csvDetailBtn")]);
    const csv2 = (await readFile(await dl2.path(), "utf8")).replace(/^﻿/, "");
    ok(csv2.includes('""comillas""'), "CSV detalle: comillas escapadas correctamente");
    eq(csv2.trim().split("\n").length, 1 + N + (csv2.match(/\n(?!")/g) || []).length * 0, `CSV detalle: ${N} filas de calificaciones`);

    globalThis.__judges = judges;
  }

  /* ===================================================== */
  scenario("4. Editar una nota ya enviada");
  {
    const [j, p] = globalThis.__judges[0];
    await p.click(".team >> nth=5");
    await p.waitForSelector("#scoreSheet:not([hidden])");
    eq(await p.$$eval(".nota", (e) => e.map((x) => Number(x.value))), data[j.id][EQ[5]], "al reabrir muestra las notas guardadas");
    await p.fill(".nota >> nth=0", "");
    await p.type(".nota >> nth=0", "10");
    data[j.id][EQ[5]][0] = 10;
    await p.click("#sheetSave");
    await p.waitForSelector("#scoreSheet", { state: "hidden" });
    const exp = expectedRanking(data);
    const target = exp.find((e) => e.t === EQ[5]);
    ok(await until(async () => (await adminRanking(admin)).find((g) => g.t === EQ[5])?.score === fmt(target.avg)), `admin recibe la edición en vivo (${EQ[5]} → ${fmt(target.avg)})`);
    eq((await firestoreDocs()).length, JUR.length * EQ.length, "editar no crea documentos duplicados");
    eq((await adminRanking(admin)).map((g) => g.t), exp.map((e) => e.t), "ranking reordenado correctamente tras la edición");
  }

  /* ===================================================== */
  scenario("5. Sin internet al guardar y reconexión");
  {
    const [j, p] = globalThis.__judges[1];
    await p.context().setOffline(true);
    await p.click(".team >> nth=6");
    await p.waitForSelector("#scoreSheet:not([hidden])");
    await p.fill(".nota >> nth=4", "");
    const nueva = data[j.id][EQ[6]][4] === 3 ? 4 : 3;
    await p.type(".nota >> nth=4", String(nueva));
    data[j.id][EQ[6]][4] = nueva;
    await p.click("#sheetSave");
    await p.waitForSelector("#scoreSheet", { state: "hidden" });
    ok(await until(async () => (await pill(p, 6)) === "Por enviar", 12000), "sin internet: la nota queda guardada en el celular como 'Por enviar'");
    ok(await until(async () => /Guardado en este celular/.test(await p.textContent("#toast")), 2000), "avisa al instante que se reenviará al recuperar conexión");
    // recarga sin internet: no se pierde
    await p.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
    await sleep(500);
    const afterReload = await pill(p, 6).catch(() => null);
    ok(afterReload === "Por enviar" || afterReload === null, `recargar sin internet no borra la nota (${afterReload ?? "página sin red"})`);
    await p.context().setOffline(false);
    if (afterReload === null) await p.reload({ waitUntil: "domcontentloaded" });
    const exp = expectedRanking(data);
    const target = exp.find((e) => e.t === EQ[6]);
    ok(await until(async () => (await pill(p, 6)) === "✓ Calificado", 15000), "al volver internet se envía sola → '✓ Calificado'");
    ok(await until(async () => (await adminRanking(admin)).find((g) => g.t === EQ[6])?.score === fmt(target.avg), 10000), "el admin recibe la nota que estaba pendiente");
  }

  /* ===================================================== */
  scenario("6. El mismo jurado entra desde otro celular");
  {
    const j = JUR[2];
    const p = await phone();
    await login(p, j.id, j.clave);
    await p.waitForURL("**/jurado/");
    ok(await until(async () => (await p.textContent("#pct")) === "100%"), "recupera su avance (100%) desde Firestore");
    await p.click(".team >> nth=8");
    await p.waitForSelector("#scoreSheet:not([hidden])");
    eq(await p.$$eval(".nota", (e) => e.map((x) => Number(x.value))), data[j.id][EQ[8]], "ve exactamente sus notas guardadas");
    await p.context().close();
  }

  /* ===================================================== */
  scenario("7. Admin recarga / abre en otro dispositivo");
  {
    const a2 = await phone();
    await login(a2, "admin", ADMIN);
    await a2.waitForURL("**/admin/");
    const exp = expectedRanking(data);
    ok(await until(async () => JSON.stringify((await adminRanking(a2)).map((g) => g.t)) === JSON.stringify(exp.map((e) => e.t))), "otro dispositivo admin ve el mismo ranking final");
    const tLoad = Date.now();
    await a2.reload({ waitUntil: "domcontentloaded" });
    ok(await until(async () => (await adminRanking(a2)).length === EQ.length), "tras recargar, el ranking vuelve completo");
    console.log(`  · ranking completo tras recargar en ${((Date.now() - tLoad) / 1000).toFixed(2)} s`);
    await a2.context().close();
  }

  /* ===================================================== */
  scenario("8. Conexión lenta (3G de celular)");
  {
    const j = JUR[0];
    const p = await phone();
    const cdp = await p.context().newCDPSession(p);
    await cdp.send("Network.enable");
    // ~400 kbps y 400 ms de latencia
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 400, downloadThroughput: 50_000, uploadThroughput: 20_000 });
    const tl = Date.now();
    await login(p, j.id, j.clave);
    await p.waitForURL("**/jurado/");
    await p.waitForSelector(".team");
    console.log(`  · en 3G la lista de equipos apareció en ${((Date.now() - tl) / 1000).toFixed(1)} s`);
    ok(await p.isVisible("#syncNote"), "muestra 'Sincronizando tus notas…' mientras descarga");
    // abre el equipo ANTES de que termine la sincronización (lo que haría un jurado apurado)
    await p.click(".team >> nth=9");
    await p.waitForSelector("#scoreSheet:not([hidden])");
    const got = await until(async () => {
      const v = await p.$$eval(".nota", (e) => e.map((x) => Number(x.value)));
      return JSON.stringify(v) === JSON.stringify(data[j.id][EQ[9]]) ? v : null;
    }, 30000);
    ok(got, "en 3G, el modal se completa solo con sus notas guardadas al terminar de sincronizar");
    ok(await p.isHidden("#syncNote"), "el indicador de sincronización desaparece");
    await p.fill(".nota >> nth=1", "");
    const nueva = data[j.id][EQ[9]][1] === 2 ? 3 : 2;
    await p.type(".nota >> nth=1", String(nueva));
    data[j.id][EQ[9]][1] = nueva;
    await p.click("#sheetSave");
    await p.waitForSelector("#scoreSheet", { state: "hidden" });
    ok(await until(async () => (await pill(p, 9)) === "✓ Calificado", 30000), "en 3G la nota termina confirmada '✓ Calificado'");
    const target = expectedRanking(data).find((e) => e.t === EQ[9]);
    ok(await until(async () => (await adminRanking(admin)).find((g) => g.t === EQ[9])?.score === fmt(target.avg), 30000), "el admin recibe la nota enviada por 3G");
    eq((await firestoreDocs()).length, JUR.length * EQ.length, "sigue sin duplicados");
    await p.context().close();
  }

  /* ===================================================== */
  scenario("9. Resultado final consistente");
  {
    const exp = expectedRanking(data);
    const got = await adminRanking(admin);
    eq(got.map((g) => [g.rank, g.t, g.score]), exp.map((e) => [e.rank, e.t, fmt(e.avg)]), "ranking final del admin = cálculo independiente tras todos los cambios");
  }

  /* ===================================================== */
  scenario("10. Errores de JavaScript en toda la sesión");
  eq(pageErrors, [], "ningún error de JavaScript en ninguna página");

  for (const [, p] of globalThis.__judges ?? []) await p.context().close();
} catch (e) {
  ok(false, "excepción inesperada", e.stack || String(e));
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n══════════════════════════════════════════════`);
console.log(`  ${results.length - failed.length}/${results.length} verificaciones OK · ${((Date.now() - t0) / 1000).toFixed(1)} s`);
if (failed.length) { console.log("  FALLARON:"); for (const f of failed) console.log(`   ✘ [${f.scenario}] ${f.msg}`); }
console.log(`══════════════════════════════════════════════`);
process.exit(failed.length ? 1 : 0);
