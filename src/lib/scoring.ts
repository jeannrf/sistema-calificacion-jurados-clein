/* =========================================================
   Lógica pura de calificación y ranking (sin DOM ni Firebase).
   Todo lo que decide quién gana vive aquí y está cubierto por tests.
   ========================================================= */
import { CONFIG, NOTA_MIN, NOTA_MAX, type Criterio, type Jurado } from "../config";

export interface Row {
  juradoId: string;
  jurado: string;
  equipo: string;
  total: number;
  comentario: string;
  fecha: string;
  [criterio: string]: string | number;
}

/** Valida lo que el jurado escribe: solo enteros de NOTA_MIN a NOTA_MAX. */
export function parseNota(raw: string): number | null {
  if (!/^\d{1,2}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= NOTA_MIN && n <= NOTA_MAX ? n : null;
}

/** Puntaje final ponderado sobre 100 (redondeado a 2 decimales). */
export function ponderar(notas: Record<string, number>, criterios: Criterio[] = CONFIG.criterios): number {
  const raw = criterios.reduce((s, c) => s + (Number(notas[c.id]) / NOTA_MAX) * c.peso, 0);
  return Math.round(raw * 100) / 100;
}

/** Representación entera (centésimas) para comparar puntajes sin errores de coma flotante. */
export const cents = (n: number) => Math.round(n * 100);

/** Ranking de competencia: empates comparten puesto (1, 1, 3…). La lista debe venir ordenada. */
export function withRanks<T>(list: T[], score: (x: T) => number): (T & { rank: number; tie: boolean })[] {
  const keys = list.map((x) => cents(score(x)));
  let rank = 0;
  return list.map((x, i) => {
    if (i === 0 || keys[i] !== keys[i - 1]) rank = i + 1;
    const tie = (i > 0 && keys[i] === keys[i - 1]) || (i < list.length - 1 && keys[i] === keys[i + 1]);
    return { ...x, rank, tie };
  });
}

/** ¿Es una fila válida y completa? (protege el ranking de datos corruptos). */
export function rowValida(r: Row, criterios: Criterio[] = CONFIG.criterios): boolean {
  return typeof r.equipo === "string" && r.equipo.length > 0 &&
    criterios.every((c) => Number.isInteger(r[c.id]) && (r[c.id] as number) >= NOTA_MIN && (r[c.id] as number) <= NOTA_MAX);
}

export interface TeamResult {
  team: string;
  judges: Record<string, Row & { total: number }>;
  n: number;
  avg: number | null;
  crit: Record<string, number | null>;
}

/**
 * Agrega todas las calificaciones:
 * - descarta filas de jurados que ya no existen o con notas inválidas,
 * - recalcula el puntaje de cada jurado desde sus notas (no confía en `total`),
 * - promedio simple entre los jurados que calificaron a cada equipo,
 * - ranking ordenado por promedio (empates → mismo puesto, desempate visual alfabético).
 */
export function aggregate(
  rows: Row[],
  { jurados = CONFIG.jurados, equipos = CONFIG.equipos, criterios = CONFIG.criterios }:
    { jurados?: Jurado[]; equipos?: string[]; criterios?: Criterio[] } = {},
) {
  const ids = new Set(jurados.map((j) => j.id));
  const valid = rows.filter((r) => ids.has(r.juradoId) && rowValida(r, criterios));

  const byTeam = new Map<string, Record<string, Row & { total: number }>>(equipos.map((t) => [t, {}]));
  for (const r of valid) {
    if (!byTeam.has(r.equipo)) byTeam.set(r.equipo, {});
    const notas = Object.fromEntries(criterios.map((c) => [c.id, Number(r[c.id])]));
    byTeam.get(r.equipo)![r.juradoId] = { ...r, total: ponderar(notas, criterios) } as Row;
  }

  const teams: TeamResult[] = [...byTeam.entries()].map(([team, judges]) => {
    const list = Object.values(judges);
    const n = list.length;
    const avg = n ? Math.round((list.reduce((s, r) => s + r.total, 0) / n) * 100) / 100 : null;
    const crit = Object.fromEntries(criterios.map((c) =>
      [c.id, n ? Math.round((list.reduce((s, r) => s + Number(r[c.id]), 0) / n) * 100) / 100 : null]));
    return { team, judges, n, avg, crit };
  });

  const scored = withRanks(
    teams.filter((t) => t.n).sort((a, b) => cents(b.avg!) - cents(a.avg!) || a.team.localeCompare(b.team, "es")),
    (t) => t.avg!,
  );
  const pending = teams.filter((t) => !t.n);
  const expected = equipos.length * jurados.length;
  const received = valid.filter((r) => equipos.includes(r.equipo)).length;
  return { teams, scored, pending, valid, expected, received, complete: received >= expected };
}

/** Ranking individual de un jurado (sus puntajes recalculados, de mayor a menor). */
export function judgeRanking(rows: Row[], judgeId: string, criterios: Criterio[] = CONFIG.criterios) {
  const mine = rows
    .filter((r) => r.juradoId === judgeId && rowValida(r, criterios))
    .map((r): Row => ({ ...r, total: ponderar(Object.fromEntries(criterios.map((c) => [c.id, Number(r[c.id])])), criterios) }))
    .sort((a, b) => cents(b.total) - cents(a.total) || a.equipo.localeCompare(b.equipo, "es"));
  return withRanks(mine, (r) => r.total);
}

/** ID estable del documento en Firestore: un documento por jurado y equipo. */
export const slug = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
export const docId = (judgeId: string, team: string) => `${judgeId}__${slug(team)}`;
