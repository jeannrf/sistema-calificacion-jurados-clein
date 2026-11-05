/* Acceso a Firestore. Se carga bajo demanda (import dinámico) para que las
   pantallas aparezcan al instante aunque la librería de Firebase pese ~140 KB. */
import { initializeApp } from "firebase/app";
import {
  getFirestore, connectFirestoreEmulator, doc, setDoc, getDocs, collection, query, where, onSnapshot, type Firestore,
} from "firebase/firestore";
import { firebaseConfig } from "../firebase";
import type { Row } from "./scoring";

const COLLECTION = "calificaciones";

let _db: Firestore | null = null;
function db(): Firestore {
  if (!_db) {
    // Solo para pruebas: PUBLIC_FIRESTORE_EMULATOR=127.0.0.1:8080 usa el emulador local
    // con un proyecto "demo-" (nunca toca la base de datos real).
    const emu = import.meta.env.PUBLIC_FIRESTORE_EMULATOR as string | undefined;
    _db = getFirestore(initializeApp(emu ? { ...firebaseConfig, projectId: "demo-despega" } : firebaseConfig));
    if (emu) { const [h, port] = emu.split(":"); connectFirestoreEmulator(_db, h, Number(port)); }
  }
  return _db;
}

export function write(id: string, data: Record<string, unknown>) {
  return setDoc(doc(db(), COLLECTION, id), data);
}

export function subscribe(cb: (rows: Row[]) => void, onError: (e: Error) => void): () => void {
  return onSnapshot(collection(db(), COLLECTION), (snap) => cb(snap.docs.map((d) => d.data() as Row)), onError);
}

export async function fetchJudge(judgeId: string): Promise<Row[]> {
  const snap = await getDocs(query(collection(db(), COLLECTION), where("juradoId", "==", judgeId)));
  return snap.docs.map((d) => d.data() as Row);
}
