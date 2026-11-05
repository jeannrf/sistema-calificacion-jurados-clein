# Despega CLEIN · Sistema de calificación de jurados

Plataforma web en **Astro** para que los jurados del **Despega CLEIN — CLEIN Perú 2026** califiquen a los equipos con la rúbrica oficial (100 pts).

## Uso

```bash
npm install
npm run dev        # http://localhost:4321  (también visible en la red local)
npm run build      # genera el sitio estático en dist/
npm run preview    # sirve dist/
```

## Flujo

| Ruta | Qué hace |
|---|---|
| `/` | Acceso: el jurado elige su perfil e ingresa su clave |
| `/jurado` | Lista de equipos con avance. Al tocar un equipo se abre el modal de calificación |
| `/admin` | Administrador: ranking final (promedio simple de los jurados), ranking y notas de cada jurado, promedio por criterio y CSV |

## Calificación

Cada criterio se califica **del 1 al 10** y pesa según la rúbrica. El puntaje final (sobre 100) es el ponderado:

```
final = Σ nota × peso / 10
```

| Criterio | Peso |
|---|---|
| Impacto e innovación | 25% |
| Profundidad técnica | 20% |
| Alineación estratégica | 15% |
| Modelo de negocio y viabilidad | 20% |
| Narrativa y pitch | 20% |

Ejemplo: notas 8, 7, 9, 10, 6 → 20 + 14 + 13.5 + 20 + 12 = **79.5 / 100**.

En el modal, al escribir una nota el cursor pasa solo al siguiente criterio (el "1" espera un instante por si es un 10). El botón "atrás" del celular cierra el modal.

## Claves de acceso

Las claves de cada perfil están en el campo `clave` de [`src/config.ts`](src/config.ts).

Jurados, claves, **equipos** y criterios se editan en [`src/config.ts`](src/config.ts). La lista de equipos se actualiza sola al editarla.

> Las claves viajan en el código del navegador: evitan errores de perfil, no son seguridad real.

## Dónde se guardan las notas (Firebase)

Cada nota se guarda en el celular del jurado **y** en Firestore (colección `calificaciones`, un documento por jurado y equipo). El panel de administrador escucha Firestore y se actualiza **en vivo**. Si un jurado se queda sin internet, la nota queda marcada "Por enviar" y se sube sola al volver la conexión. Si cambia de celular, al entrar recupera sus notas.

Mientras `projectId` esté vacío en [`src/firebase.ts`](src/firebase.ts), las notas solo quedan en cada celular.

### Configurar (una sola vez)

1. Crea un proyecto en [console.firebase.google.com](https://console.firebase.google.com).
2. **Firestore Database → Crear base de datos** (modo producción, región `southamerica-east1` o la más cercana).
3. **Configuración del proyecto → Tus apps → Web (`</>`)**: copia el objeto `firebaseConfig` en [`src/firebase.ts`](src/firebase.ts).
4. Pon el ID del proyecto en [`.firebaserc`](.firebaserc) (reemplaza `TU-PROYECTO-ID`).
5. Publica las reglas y la página:

```bash
firebase login
npm run deploy           # compila, sube las reglas de Firestore y publica en Hosting
```

La página está publicada en **https://calificacion-despega-clein.web.app**.

### Reglas de Firestore

[`firestore.rules`](firestore.rules) deja leer a cualquiera y solo acepta calificaciones con formato válido (jurados conocidos, notas enteras del 1 al 10, total 0–100). No permite borrar. **Si cambias los `id` de los jurados en `config.ts`, actualiza también la lista en `firestore.rules`.**

### Probar en local sin tocar el proyecto real

```bash
firebase emulators:start --only firestore --project demo-despega
# en otra terminal, con projectId "demo-despega" en src/firebase.ts:
PUBLIC_FIRESTORE_EMULATOR=127.0.0.1:8080 npm run dev
```

## Estructura

```
src/
  config.ts                 jurados, claves, equipos, rúbrica
  firebase.ts               configuración de Firebase (pegar firebaseConfig)
  lib/store.ts              sesión, almacenamiento local, Firestore
  layouts/Layout.astro      barra superior, fuentes, pie
  components/               Avatar, ScoreModal
  pages/                    index, jurado/index, admin
  styles/global.css         paleta y estilos CLEIN
public/                     logos CLEIN
firebase.json, .firebaserc  Hosting + reglas
firestore.rules             reglas de seguridad de Firestore
```

## Publicar

`npm run deploy` (ver arriba). También sirve cualquier hosting estático con `npm run build` → `dist/`, siempre que `src/firebase.ts` esté configurado.
