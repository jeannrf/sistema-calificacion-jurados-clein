/* Verifica que la configuración del evento sea coherente ANTES de publicar. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { CONFIG, MAX_TOTAL, NOTA_MIN, NOTA_MAX } from "../../src/config";
import { docId, slug } from "../../src/lib/scoring";
import { firebaseConfig } from "../../src/firebase";

const rules = readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8");
const unique = <T>(xs: T[]) => new Set(xs).size === xs.length;

describe("configuración del evento", () => {
  it("los pesos suman 100", () => expect(MAX_TOTAL).toBe(100));
  it("escala 1–10", () => expect([NOTA_MIN, NOTA_MAX]).toEqual([1, 10]));
  it("hay jurados y equipos", () => {
    expect(CONFIG.jurados.length).toBeGreaterThan(0);
    expect(CONFIG.equipos.length).toBeGreaterThan(0);
  });
  it("ids, iniciales y claves de jurados únicos", () => {
    expect(unique(CONFIG.jurados.map((j) => j.id))).toBe(true);
    expect(unique(CONFIG.jurados.map((j) => j.iniciales))).toBe(true);
    expect(unique([...CONFIG.jurados.map((j) => j.clave), CONFIG.admin.clave])).toBe(true);
  });
  it("ids de jurado válidos para Firestore (minúsculas, sin '__')", () => {
    for (const j of CONFIG.jurados) expect(j.id).toMatch(/^[a-z0-9-]+$/);
  });
  it("ninguna clave vacía", () => {
    for (const j of CONFIG.jurados) expect(j.clave.trim().length).toBeGreaterThan(0);
    expect(CONFIG.admin.clave.trim().length).toBeGreaterThan(0);
  });
  it("nombres de equipo únicos y sin vacíos", () => {
    expect(unique(CONFIG.equipos)).toBe(true);
    for (const t of CONFIG.equipos) expect(t.trim().length).toBeGreaterThan(0);
  });
  it("cada equipo tiene un ID de documento distinto (sin choques por tildes/símbolos)", () => {
    expect(unique(CONFIG.equipos.map(slug))).toBe(true);
    for (const t of CONFIG.equipos) expect(slug(t).length).toBeGreaterThan(0);
    for (const j of CONFIG.jurados) for (const t of CONFIG.equipos) expect(docId(j.id, t)).toMatch(/^[a-z0-9-]+__[a-z0-9-]+$/);
  });
  it("nombres de equipo caben en la regla de Firestore (≤ 80)", () => {
    for (const t of CONFIG.equipos) expect(t.length).toBeLessThanOrEqual(80);
  });
  it("ids de criterio únicos", () => expect(unique(CONFIG.criterios.map((c) => c.id))).toBe(true));
});

describe("firestore.rules está sincronizado con config.ts", () => {
  it("la lista de jurados de las reglas = jurados de config", () => {
    const m = rules.match(/d\.juradoId in \[([^\]]*)\]/);
    expect(m).not.toBeNull();
    const enReglas = m![1].split(",").map((s) => s.trim().replace(/'/g, "")).filter(Boolean).sort();
    expect(enReglas).toEqual(CONFIG.jurados.map((j) => j.id).sort());
  });
  it("las reglas validan cada criterio de config", () => {
    for (const c of CONFIG.criterios) {
      expect(rules).toContain(`nota(d.${c.id})`);
      expect(rules).toContain(`'${c.id}'`);
    }
  });
});

describe("firebase", () => {
  it("proyecto configurado", () => {
    expect(firebaseConfig.projectId).toBe("calificacion-despega-clein");
    expect(firebaseConfig.apiKey).toMatch(/^AIza/);
  });
});
