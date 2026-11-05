/* Lógica de cliente compartida: sesión, almacenamiento local y Firestore. */
import { CONFIG, type Jurado } from "../config";
import { firebaseConfig } from "../firebase";

const STORE_KEY = "despega-clein-notas-v2"; // v2: notas 1–10 ponderadas
const SESSION_KEY = "despega-clein-sesion";

export interface ScoreRecord {
  scores: Record<string, number>;
  total: number;
  comentario: string;
  ts: string;
  synced: boolean;
}
type Store = Record<string, Record<string, ScoreRecord>>;

export type { Row } from "./scoring";
import type { Row } from "./scoring";
import { docId } from "./scoring";

/* ---------- Sesión ---------- */
export function getSession(): string | null {
  try { return localStorage.getItem(SESSION_KEY); } catch { return null; }
}
export function setSession(id: string | null) {
  try { id ? localStorage.setItem(SESSION_KEY, id) : localStorage.removeItem(SESSION_KEY); } catch {}
}
export const findJudge = (id: string | null) => CONFIG.jurados.find((j) => j.id === id);

/** Devuelve el jurado en sesión o redirige al acceso. */
export function requireJudge(): Jurado | null {
  const j = findJudge(getSession());
  if (!j) location.replace("/");
  return j ?? null;
}
export function requireAdmin(): boolean {
  const ok = getSession() === CONFIG.admin.id;
  if (!ok) location.replace("/");
  return ok;
}

/* ---------- Almacenamiento local ---------- */
function load(): Store {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || "{}"); } catch { return {}; }
}
function save(store: Store) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch {}
}
export const judgeScores = (judgeId: string) => load()[judgeId] || {};
export function setScore(judgeId: string, team: string, rec: ScoreRecord) {
  const s = load();
  (s[judgeId] ||= {})[team] = rec;
  save(s);
}
export function localRows(): Row[] {
  const s = load();
  return CONFIG.jurados.flatMap((j) =>
    Object.entries(s[j.id] || {}).map(([equipo, r]) => ({
      juradoId: j.id, jurado: j.nombre, equipo, total: r.total, comentario: r.comentario, fecha: r.ts, ...r.scores,
    })));
}

/* ---------- Borradores ----------
   Cada nota que el jurado escribe se guarda al instante en el celular, aunque no
   haya pulsado "Guardar". Si sale a WhatsApp y el navegador recarga la página,
   al volver el modal se reabre con lo que ya había escrito. */
export interface Draft { notas: Record<string, number | null>; comentario: string }
const draftKey = (judgeId: string, team: string) => `despega-clein-borrador:${judgeId}:${team}`;
export function getDraft(judgeId: string, team: string): Draft | null {
  try { return JSON.parse(localStorage.getItem(draftKey(judgeId, team)) || "null"); } catch { return null; }
}
export function setDraft(judgeId: string, team: string, d: Draft) {
  try { localStorage.setItem(draftKey(judgeId, team), JSON.stringify(d)); } catch {}
}
export function clearDraft(judgeId: string, team: string) {
  try { localStorage.removeItem(draftKey(judgeId, team)); } catch {}
}

/* ---------- Firestore ---------- */
export const remoteEnabled = () => !!firebaseConfig.projectId;

/** Carga el módulo de Firestore bajo demanda (queda en caché tras la primera vez). */
let _remote: Promise<typeof import("./remote")> | null = null;
const remote = () => (_remote ||= import("./remote").catch((e) => { _remote = null; throw e; }));
/** Precarga Firestore en segundo plano (p. ej. mientras el jurado escribe su clave). */
export function prefetchRemote() { if (remoteEnabled()) remote().catch(() => {}); }

const timeout = (ms: number) => new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms));

export async function sendRemote(judge: Jurado, team: string, rec: ScoreRecord): Promise<boolean> {
  if (!remoteEnabled()) return false;
  // Sin internet: no esperamos; queda "Por enviar" y se reenvía al volver la conexión.
  if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
  const payload = {
    juradoId: judge.id, jurado: judge.nombre, equipo: team,
    total: rec.total, comentario: rec.comentario, fecha: rec.ts, ...rec.scores,
  };
  try {
    // Sin conexión setDoc no termina: tras 8 s se marca "por enviar" y se reintenta luego.
    await Promise.race([remote().then((r) => r.write(docId(judge.id, team), payload)), timeout(8000)]);
    return true;
  } catch { return false; }
}

/** Todas las calificaciones, en vivo: llama a `cb` cada vez que alguien guarda. */
export function subscribeRemote(cb: (rows: Row[]) => void, onError: (e: Error) => void): () => void {
  let unsub: (() => void) | undefined;
  let cancelled = false;
  remote().then((r) => { if (!cancelled) unsub = r.subscribe(cb, onError); }).catch(onError);
  return () => { cancelled = true; unsub?.(); };
}

/** Trae las notas del jurado desde Firestore (p. ej. si cambió de celular). */
export async function pullJudge(judge: Jurado): Promise<number> {
  if (!remoteEnabled()) return 0;
  try {
    const remoteRows = await Promise.race([remote().then((r) => r.fetchJudge(judge.id)), timeout(15000)]);
    const local = judgeScores(judge.id);
    let n = 0;
    for (const r of remoteRows) {
      if (!CONFIG.equipos.includes(r.equipo)) continue;
      const mine = local[r.equipo];
      if (mine && !mine.synced) continue; // la nota local aún no subida manda
      if (mine && mine.ts >= r.fecha) continue;
      setScore(judge.id, r.equipo, {
        scores: Object.fromEntries(CONFIG.criterios.map((c) => [c.id, Number(r[c.id])])),
        total: Number(r.total), comentario: String(r.comentario ?? ""), ts: String(r.fecha), synced: true,
      });
      n++;
    }
    return n;
  } catch { return 0; }
}

/** Reenvía las notas que no llegaron a Firestore (p. ej. sin conexión). */
export async function syncPending(judge: Jurado): Promise<number> {
  if (!remoteEnabled()) return 0;
  let n = 0;
  for (const [team, rec] of Object.entries(judgeScores(judge.id))) {
    if (!rec.synced && (await sendRemote(judge, team, rec))) { setScore(judge.id, team, { ...rec, synced: true }); n++; }
  }
  return n;
}

/* ---------- UI ---------- */
let toastTimer: ReturnType<typeof setTimeout>;
export function toast(msg: string, kind: "" | "ok" | "warn" = "") {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.className = "toast" + (kind ? " toast--" + kind : "");
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3200);
}
/** Muestra un toast después de navegar a otra página. */
export function flash(msg: string, kind: "" | "ok" | "warn" = "") {
  try { sessionStorage.setItem("flash", JSON.stringify([msg, kind])); } catch {}
}
export function showFlash() {
  try {
    const f = sessionStorage.getItem("flash");
    if (f) { sessionStorage.removeItem("flash"); const [m, k] = JSON.parse(f); toast(m, k); }
  } catch {}
}

export const fmt = (n: number) => String(Math.round(n * 100) / 100); // 79.5, 80, 81.25
export const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[m]!);
