/* Reglas de Firestore contra el emulador. Ejecutar con: npm run test:rules */
import { describe, it, beforeAll, afterAll, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc, getDoc, getDocs, deleteDoc, updateDoc, collection } from "firebase/firestore";
import { CONFIG } from "../../src/config";
import { docId } from "../../src/lib/scoring";

let env: RulesTestEnvironment;
const J = CONFIG.jurados[0].id;
const T = CONFIG.equipos[0];

const valido = (over: Record<string, unknown> = {}) => ({
  juradoId: J, jurado: "Nombre", equipo: T, total: 79.5, comentario: "", fecha: "2026-11-05T10:00:00.000Z",
  impacto: 8, tecnica: 7, alineacion: 9, negocio: 10, pitch: 6, ...over,
});

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-despega",
    firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8080 },
  });
});
afterAll(async () => { await env?.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

const db = () => env.unauthenticatedContext().firestore();
const ref = (id = docId(J, T)) => doc(db(), "calificaciones", id);

describe("escrituras válidas", () => {
  it("crear una calificación correcta", async () => { await assertSucceeds(setDoc(ref(), valido())); });
  it("editar (sobrescribir) la propia calificación", async () => {
    await assertSucceeds(setDoc(ref(), valido()));
    await assertSucceeds(setDoc(ref(), valido({ impacto: 10, total: 84.5 })));
  });
  it("todos los jurados de config pueden escribir", async () => {
    for (const j of CONFIG.jurados) await assertSucceeds(setDoc(ref(docId(j.id, T)), valido({ juradoId: j.id })));
  });
  it("notas límite 1 y 10", async () => {
    await assertSucceeds(setDoc(ref(), valido({ impacto: 1, tecnica: 1, alineacion: 1, negocio: 1, pitch: 1, total: 10 })));
    await assertSucceeds(setDoc(ref(), valido({ impacto: 10, tecnica: 10, alineacion: 10, negocio: 10, pitch: 10, total: 100 })));
  });
  it("total entero o decimal", async () => {
    await assertSucceeds(setDoc(ref(), valido({ total: 80 })));
    await assertSucceeds(setDoc(ref(), valido({ total: 79.5 })));
  });
  it("comentario largo (2000) y con emojis", async () => {
    await assertSucceeds(setDoc(ref(), valido({ comentario: "😀 ñ ".repeat(300).slice(0, 2000) })));
  });
  it("cualquiera puede leer (panel del administrador)", async () => {
    await env.withSecurityRulesDisabled(async (c) => { await setDoc(doc(c.firestore(), "calificaciones", docId(J, T)), valido()); });
    await assertSucceeds(getDoc(ref()));
    await assertSucceeds(getDocs(collection(db(), "calificaciones")));
  });
});

describe("escrituras rechazadas", () => {
  const casos: [string, Record<string, unknown>][] = [
    ["nota 0", { impacto: 0 }],
    ["nota 11", { tecnica: 11 }],
    ["nota negativa", { pitch: -5 }],
    ["nota decimal", { alineacion: 7.5 }],
    ["nota como texto", { negocio: "8" }],
    ["nota nula", { impacto: null }],
    ["total > 100", { total: 101 }],
    ["total negativo", { total: -1 }],
    ["total como texto", { total: "80" }],
    ["jurado inexistente", { juradoId: "hacker" }],
    ["jurado retirado (marcia)", { juradoId: "marcia" }],
    ["campo extra", { admin: true }],
    ["equipo no texto", { equipo: 5 }],
    ["equipo demasiado largo", { equipo: "x".repeat(81) }],
    ["comentario > 2000", { comentario: "x".repeat(2001) }],
    ["fecha no texto", { fecha: 123 }],
  ];
  it.each(casos)("%s", async (_n, over) => { await assertFails(setDoc(ref(), valido(over))); });

  it("falta un criterio", async () => {
    const { pitch: _p, ...sinPitch } = valido();
    await assertFails(setDoc(ref(), sinPitch));
  });
  it("ID de documento de otro jurado (suplantación)", async () => {
    const otro = CONFIG.jurados[1]?.id ?? "x";
    await assertFails(setDoc(ref(docId(otro, T)), valido({ juradoId: J })));
  });
  it("no se puede borrar", async () => {
    await env.withSecurityRulesDisabled(async (c) => { await setDoc(doc(c.firestore(), "calificaciones", docId(J, T)), valido()); });
    await assertFails(deleteDoc(ref()));
  });
  it("no se puede romper una nota existente con update parcial", async () => {
    await env.withSecurityRulesDisabled(async (c) => { await setDoc(doc(c.firestore(), "calificaciones", docId(J, T)), valido()); });
    await assertFails(updateDoc(ref(), { impacto: 50 }));
  });
  it("no se puede escribir en otras colecciones", async () => {
    await assertFails(setDoc(doc(db(), "otra", "x"), { a: 1 }));
    await assertFails(getDoc(doc(db(), "otra", "x")));
  });
});
