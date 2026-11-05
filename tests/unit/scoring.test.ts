import { describe, it, expect } from "vitest";
import { parseNota, ponderar, withRanks, aggregate, judgeRanking, rowValida, slug, docId, cents, type Row } from "../../src/lib/scoring";
import { CONFIG, type Jurado } from "../../src/config";

const C = CONFIG.criterios;
const IDS = C.map((c) => c.id);
const notas = (arr: number[]) => Object.fromEntries(IDS.map((id, i) => [id, arr[i]]));
const row = (juradoId: string, equipo: string, arr: number[], extra: Partial<Row> = {}): Row => ({
  juradoId, jurado: juradoId, equipo, comentario: "", fecha: "2026-11-05T10:00:00Z",
  total: ponderar(notas(arr)), ...notas(arr), ...extra,
} as Row);

const J: Jurado[] = [
  { id: "a", nombre: "A", corto: "A", iniciales: "A", color: "navy", clave: "x" },
  { id: "b", nombre: "B", corto: "B", iniciales: "B", color: "teal", clave: "y" },
  { id: "c", nombre: "C", corto: "C", iniciales: "C", color: "green", clave: "z" },
];
const T = ["Alfa", "Beta", "Gamma", "Delta"];
const opts = { jurados: J, equipos: T };

/* ------------------------------------------------------------------ */
describe("parseNota (lo que escribe el jurado)", () => {
  it("acepta todos los enteros del 1 al 10", () => {
    for (let n = 1; n <= 10; n++) expect(parseNota(String(n))).toBe(n);
  });
  it.each(["", "0", "11", "99", "-1", "5.5", "5,5", "a", " 5", "5 ", "100", "1e1", "Ⅴ", "٥"])(
    "rechaza %j", (raw) => expect(parseNota(raw)).toBeNull());
  it("tolera cero a la izquierda (01 → 1)", () => expect(parseNota("01")).toBe(1));
});

/* ------------------------------------------------------------------ */
describe("ponderar (puntaje final sobre 100)", () => {
  it("ejemplo de la rúbrica: 8,7,9,10,6 → 79.5", () => expect(ponderar(notas([8, 7, 9, 10, 6]))).toBe(79.5));
  it("todo 10 → 100 y todo 1 → 10", () => {
    expect(ponderar(notas([10, 10, 10, 10, 10]))).toBe(100);
    expect(ponderar(notas([1, 1, 1, 1, 1]))).toBe(10);
  });
  it("cada criterio pesa exactamente su %", () => {
    for (const c of C) {
      const base = Object.fromEntries(IDS.map((id) => [id, 1]));
      const subir = { ...base, [c.id]: 10 };
      // subir un criterio de 1 a 10 suma 9/10 de su peso
      expect(ponderar(subir) - ponderar(base)).toBeCloseTo((9 / 10) * c.peso, 10);
    }
  });
  it("coincide con aritmética entera exacta en las 100 000 combinaciones posibles", () => {
    let checked = 0;
    for (let a = 1; a <= 10; a++) for (let b = 1; b <= 10; b++) for (let c = 1; c <= 10; c++)
      for (let d = 1; d <= 10; d++) for (let e = 1; e <= 10; e++) {
        const arr = [a, b, c, d, e];
        const exactoX10 = arr.reduce((s, n, i) => s + n * C[i].peso, 0); // = puntaje × 10, entero
        const p = ponderar(notas(arr));
        expect(cents(p)).toBe(exactoX10 * 10);
        expect(p).toBeGreaterThanOrEqual(10);
        expect(p).toBeLessThanOrEqual(100);
        checked++;
      }
    expect(checked).toBe(100_000);
  });
  it("es monótono: subir cualquier nota nunca baja el puntaje", () => {
    for (let i = 0; i < 2000; i++) {
      const arr = IDS.map(() => 1 + Math.floor(Math.random() * 9));
      const k = Math.floor(Math.random() * 5);
      const up = [...arr]; up[k] += 1;
      expect(ponderar(notas(up))).toBeGreaterThan(ponderar(notas(arr)));
    }
  });
});

/* ------------------------------------------------------------------ */
describe("withRanks (puestos con empates)", () => {
  const r = (xs: number[]) => withRanks(xs, (x) => x).map((x) => x.rank);
  it("sin empates → 1,2,3,4", () => expect(r([90, 80, 70, 60])).toEqual([1, 2, 3, 4]));
  it("empate en el 1° → 1,1,3", () => expect(r([90, 90, 80])).toEqual([1, 1, 3]));
  it("empate en el medio → 1,2,2,4", () => expect(r([90, 80, 80, 70])).toEqual([1, 2, 2, 4]));
  it("todos empatados → 1,1,1", () => expect(r([50, 50, 50])).toEqual([1, 1, 1]));
  it("detecta empate aunque haya ruido de coma flotante", () => {
    const a = 0.1 + 0.2; // 0.30000000000000004
    expect(withRanks([a, 0.3], (x) => x).map((x) => x.rank)).toEqual([1, 1]);
  });
  it("marca tie solo en los empatados", () =>
    expect(withRanks([90, 80, 80, 70], (x) => x).map((x) => x.tie)).toEqual([false, true, true, false]));
  it("lista vacía", () => expect(r([])).toEqual([]));
});

/* ------------------------------------------------------------------ */
describe("aggregate (ranking final)", () => {
  it("promedio simple entre los jurados que calificaron", () => {
    const rows = [
      row("a", "Alfa", [8, 7, 9, 10, 6]), // 79.5
      row("b", "Alfa", [7, 7, 8, 8, 7]),  // 73.5
      row("c", "Alfa", [8, 8, 8, 8, 8]),  // 80
    ];
    const { scored } = aggregate(rows, opts);
    expect(scored[0].team).toBe("Alfa");
    expect(scored[0].avg).toBe(77.67); // (79.5+73.5+80)/3 = 77.666…
    expect(scored[0].n).toBe(3);
  });

  it("ordena por promedio y asigna puestos", () => {
    const rows = [
      row("a", "Alfa", [5, 5, 5, 5, 5]), row("a", "Beta", [9, 9, 9, 9, 9]),
      row("a", "Gamma", [7, 7, 7, 7, 7]), row("a", "Delta", [6, 6, 6, 6, 6]),
    ];
    const { scored, pending } = aggregate(rows, opts);
    expect(scored.map((t) => [t.rank, t.team, t.avg])).toEqual([
      [1, "Beta", 90], [2, "Gamma", 70], [3, "Delta", 60], [4, "Alfa", 50],
    ]);
    expect(pending).toHaveLength(0);
  });

  it("empates: mismo puesto, orden alfabético estable y marcados", () => {
    const rows = [row("a", "Gamma", [8, 8, 8, 8, 8]), row("a", "Alfa", [8, 8, 8, 8, 8]), row("a", "Beta", [9, 9, 9, 9, 9])];
    const { scored } = aggregate(rows, opts);
    expect(scored.map((t) => [t.rank, t.team, t.tie])).toEqual([[1, "Beta", false], [2, "Alfa", true], [2, "Gamma", true]]);
  });

  it("no confía en el total guardado: lo recalcula desde las notas", () => {
    const trampa = row("a", "Alfa", [1, 1, 1, 1, 1], { total: 100 });
    const { scored } = aggregate([trampa], opts);
    expect(scored[0].avg).toBe(10);
    expect(scored[0].judges.a.total).toBe(10);
  });

  it("descarta filas inválidas o de jurados que ya no están", () => {
    const rows = [
      row("a", "Alfa", [8, 8, 8, 8, 8]),
      row("marcia", "Alfa", [1, 1, 1, 1, 1]),                 // jurado retirado
      row("b", "Alfa", [11, 8, 8, 8, 8]),                      // nota fuera de rango
      row("c", "Alfa", [8, 8, 8, 8, 8], { impacto: 7.5 }),     // decimal
      row("c", "Beta", [8, 8, 8, 8, 8], { pitch: "8" as unknown as number }), // texto
      { juradoId: "b", equipo: "Beta" } as unknown as Row,     // incompleta
    ];
    const { scored, valid } = aggregate(rows, opts);
    expect(valid).toHaveLength(1);
    expect(scored).toHaveLength(1);
    expect(scored[0].avg).toBe(80);
  });

  it("un documento por jurado y equipo: si llegan dos, cuenta el último", () => {
    const rows = [row("a", "Alfa", [5, 5, 5, 5, 5]), row("a", "Alfa", [9, 9, 9, 9, 9])];
    const { scored } = aggregate(rows, opts);
    expect(scored[0].n).toBe(1);
    expect(scored[0].avg).toBe(90);
  });

  it("cuenta recibidas/esperadas y avisa cuando está completo", () => {
    const some = [row("a", "Alfa", [5, 5, 5, 5, 5])];
    let agg = aggregate(some, opts);
    expect([agg.received, agg.expected, agg.complete]).toEqual([1, 12, false]);
    const all = J.flatMap((j) => T.map((t) => row(j.id, t, [6, 6, 6, 6, 6])));
    agg = aggregate(all, opts);
    expect([agg.received, agg.expected, agg.complete]).toEqual([12, 12, true]);
  });

  it("equipos sin notas quedan como pendientes", () => {
    const { pending, scored } = aggregate([row("a", "Beta", [5, 5, 5, 5, 5])], opts);
    expect(scored.map((t) => t.team)).toEqual(["Beta"]);
    expect(pending.map((t) => t.team)).toEqual(["Alfa", "Gamma", "Delta"]);
  });

  it("promedio por criterio", () => {
    const rows = [row("a", "Alfa", [8, 6, 10, 4, 2]), row("b", "Alfa", [6, 6, 9, 5, 3])];
    const { scored } = aggregate(rows, opts);
    expect(scored[0].crit).toEqual({ impacto: 7, tecnica: 6, alineacion: 9.5, negocio: 4.5, pitch: 2.5 });
  });

  it("sin datos no se rompe", () => {
    const agg = aggregate([], opts);
    expect(agg.scored).toEqual([]);
    expect(agg.pending).toHaveLength(4);
    expect(agg.complete).toBe(false);
  });

  it("coincide con un cálculo independiente en 3 000 eventos aleatorios", () => {
    for (let iter = 0; iter < 3000; iter++) {
      const rows: Row[] = [];
      for (const j of J) for (const t of T) if (Math.random() < 0.85)
        rows.push(row(j.id, t, IDS.map(() => 1 + Math.floor(Math.random() * 10))));
      const { scored } = aggregate(rows, opts);

      // Implementación independiente con enteros: suma(nota×peso) por jurado, promedio exacto como fracción.
      const exp = T.map((t) => {
        const rs = rows.filter((r) => r.equipo === t);
        const sumX10 = rs.reduce((s, r) => s + C.reduce((a, c) => a + (r[c.id] as number) * c.peso, 0), 0);
        return { t, n: rs.length, avg: rs.length ? Math.round((sumX10 / 10 / rs.length) * 100) / 100 : null };
      }).filter((x) => x.n).sort((a, b) => b.avg! - a.avg! || a.t.localeCompare(b.t, "es"));

      expect(scored.map((s) => s.team)).toEqual(exp.map((e) => e.t));
      expect(scored.map((s) => s.avg)).toEqual(exp.map((e) => e.avg));
      // puestos: cada uno = 1 + cuántos tienen promedio estrictamente mayor
      scored.forEach((s) => expect(s.rank).toBe(1 + exp.filter((e) => cents(e.avg!) > cents(s.avg!)).length));
    }
  });
});

/* ------------------------------------------------------------------ */
describe("judgeRanking (ranking de cada jurado)", () => {
  it("ordena las notas del jurado de mayor a menor y recalcula", () => {
    const rows = [
      row("a", "Alfa", [5, 5, 5, 5, 5], { total: 999 }), row("a", "Beta", [9, 9, 9, 9, 9]),
      row("b", "Alfa", [10, 10, 10, 10, 10]),
    ];
    const r = judgeRanking(rows, "a");
    expect(r.map((x) => [x.rank, x.equipo, x.total])).toEqual([[1, "Beta", 90], [2, "Alfa", 50]]);
  });
});

/* ------------------------------------------------------------------ */
describe("IDs de documentos", () => {
  it("slug quita tildes y símbolos", () => {
    expect(slug("Equipo Ñandú #1")).toBe("equipo-nandu-1");
    expect(slug("  Café   Más  ")).toBe("cafe-mas");
  });
  it("docId = jurado__equipo", () => expect(docId("edwin", "Equipo 01")).toBe("edwin__equipo-01"));
  it("rowValida exige todas las notas enteras 1–10", () => {
    expect(rowValida(row("a", "Alfa", [1, 2, 3, 4, 10]))).toBe(true);
    expect(rowValida(row("a", "Alfa", [0, 2, 3, 4, 10]))).toBe(false);
    expect(rowValida(row("a", "", [5, 5, 5, 5, 5]))).toBe(false);
  });
});
