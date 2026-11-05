/* =========================================================
   CONFIGURACIÓN — Despega CLEIN · Sistema de Calificación
   Edita este archivo para cambiar jurados, claves, equipos
   La conexión a Firebase está en src/firebase.ts.
   ========================================================= */

export type Color = "navy" | "teal" | "green" | "gold" | "copper";

export interface Jurado {
  id: string;
  nombre: string;
  corto: string;
  iniciales: string;
  color: Color;
  clave: string;
}

export interface Criterio {
  id: string;
  nombre: string;
  peso: number;        // % del puntaje final (la suma debe dar 100)
  color: Color;
  resumen: string;     // texto corto que se ve al calificar
  descripcion: string; // texto completo de la rúbrica
}

/* Escala de notas que pone el jurado en cada criterio. */
export const NOTA_MIN = 1;
export const NOTA_MAX = 10;

export const CONFIG = {
  evento: "Despega CLEIN 2026",
  subtitulo: "CLEIN Perú 2026 · Hackathon",


  jurados: [
    { id: "edwin", nombre: "Edwin Coya Garcia", corto: "Edwin Coya", iniciales: "EC", color: "teal", clave: "ecoya123" },
    { id: "alejandro", nombre: "Alejandro Daniel Oroncoy Almeyda", corto: "Alejandro Oroncoy", iniciales: "AO", color: "green", clave: "aoroncoy123" },
    { id: "jaime", nombre: "Jaime Fernández Chavez", corto: "Jaime Fernández", iniciales: "JF", color: "copper", clave: "jfernandez123" },
  ] as Jurado[],

  /* Perfil administrador: ve todos los puntajes, rankings y exporta resultados. */
  admin: { id: "admin", nombre: "Administrador", clave: "clein2026" },

  /* Equipos participantes (reemplaza con los nombres reales). */
  equipos: [
    "Equipo 01", "Equipo 02", "Equipo 03", "Equipo 04", "Equipo 05",
    "Equipo 06", "Equipo 07", "Equipo 08", "Equipo 09", "Equipo 10",
  ],

  /* Rúbrica oficial. Cada criterio se califica del 1 al 10 y pesa su %:
     puntaje final (sobre 100) = Σ nota × peso / 10. */
  criterios: [
    {
      id: "impacto", nombre: "Impacto e innovación", peso: 25, color: "teal",
      resumen: "Enfoque novedoso, resuelve el reto y aporta a los ODS.",
      descripcion: "La propuesta muestra un enfoque novedoso y creativo para abordar el reto, y demuestra con claridad cómo resuelve el problema y contribuye a los ODS, con un impacto social, ambiental o económico relevante.",
    },
    {
      id: "tecnica", nombre: "Profundidad técnica", peso: 20, color: "navy",
      resumen: "Solidez de la arquitectura y coherencia del prototipo (MVP).",
      descripcion: "Solidez y claridad de la arquitectura tecnológica y del prototipo (MVP): cómo se integran sus componentes y la coherencia de su funcionamiento.",
    },
    {
      id: "alineacion", nombre: "Alineación estratégica", peso: 15, color: "green",
      resumen: "Vínculo con el reto y el eje elegido, y uso justificado de su tecnología.",
      descripcion: "La solución está directamente vinculada al reto y al eje elegido (Data Storytelling, Operaciones 4.0 o Nearshoring) y justifica el uso de las tecnologías de ese eje.",
    },
    {
      id: "negocio", nombre: "Modelo de negocio y viabilidad", peso: 20, color: "gold",
      resumen: "Lean Canvas coherente, lógica financiera, realismo y escalabilidad.",
      descripcion: "Coherencia interna del Lean Canvas (problema, solución y cliente), solidez de la lógica financiera o retorno de inversión, realismo en recursos, tiempo y conocimientos del equipo, y potencial de escalar a más usuarios o contextos.",
    },
    {
      id: "pitch", nombre: "Narrativa y pitch", peso: 20, color: "copper",
      resumen: "Pitch de 6 min claro, con evidencia y buena defensa ante el jurado.",
      descripcion: "El elevator pitch de 6 minutos articula con claridad el problema, la solución y la viabilidad del modelo de negocio, respaldado por evidencia, y el equipo defiende bien su propuesta ante el jurado.",
    },
  ] as Criterio[],
};

/** Puntaje final máximo (100 si los pesos suman 100). */
export const MAX_TOTAL = CONFIG.criterios.reduce((s, c) => s + c.peso, 0);

/** Aporte de un criterio al puntaje final: nota 8 en un criterio de 25% → 20 pts. */
export const aporte = (nota: number, peso: number) => (nota / NOTA_MAX) * peso;

/** Puntaje final ponderado sobre 100. */
export const ponderado = (notas: Record<string, number>) =>
  Math.round(CONFIG.criterios.reduce((s, c) => s + aporte(notas[c.id] ?? 0, c.peso), 0) * 100) / 100;
