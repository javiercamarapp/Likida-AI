# Auditoría 31 — síntesis de la CONTINUACIÓN

**14-sep-2026** · ronda de **CONTINUACIÓN** sobre el PR **#462** (rama
`claude/auditoria-31`) · 2 rubros reauditados de 12 · árbol limpio al arrancar,
**autofix habilitado**.

**Global: 4.8** (la de la 31: **4.8**) · **= 0.0**. No se movió ninguna de las 12.

---

## Por qué esta ronda fue de continuación y no una ronda nueva

Decidido antes de gastar un token en auditores, con dos comandos:

- `list_pull_requests(open)` → **PR #462 abierto**, rama `claude/auditoria-31`,
  título «Auditoría 31 — 12 rubros, 148 hallazgos…». (No hay `gh` en esta
  imagen; se usó el MCP de GitHub.) Con un PR de auditoría vivo, la regla es
  continuar sobre él: un PR vivo vale más que catorce ignorados.
- `git log 4e36c82..HEAD -- src/ supabase/ normas/` → los 3 commits que
  devuelve ya están dentro de la 31. **`origin/master` sigue en `4047a50`**, el
  mismo sha sobre el que se cortó la rama.

De ahí sale qué se relanza: **los 12 archivos de rubro existen** y **el código
de master no se movió desde que los 12 los escribieron**, así que la regla de
continuación («solo los rubros cuyo archivo falte o cuyo código haya cambiado»)
daba **cero auditores**. Lo que esta ronda tenía para aportar no era auditar de
nuevo, era **gastar el presupuesto de arreglo** sobre los hallazgos que la 31
dejó abiertos — y después reauditar los dos rubros cuyo código acababa de
cambiar por esos arreglos.

---

## Lo que se arregló, y lo que el auditor dijo de cada arreglo

Cuatro commits, cada uno con prueba que lo reproduce y **rojo medido → verde**,
cada uno verificado por mutación en los dos sentidos. **Revertidos: 0** — la
suite terminó verde en los cuatro.

### `f4fde69` — REN-31-C1 (CRÍTICO) · el veredicto es **cierra a medias**

El cron de emergencias (`api/cron/asistencia`) derivaba su margen de reloj de un
literal `15` para una unidad atómica de **91.5 s**, y `reclamarEscalacionAsistencia`
escribe el claim **antes** del WhatsApp. Una escalada admitida a 1 s de `venceEn`
moría a mitad de camino con el claim quemado, y el barrido siguiente
—`.lt('nivel_escalado', NIVEL_MAXIMO)`— ya no la listaba: **un nivel 4 que muere
ahí no se reintenta nunca**. Medido antes del arreglo: `venceEn + 91.5 s =
186.5 s` contra `maxDuration = 120`.

El arreglo deriva el margen con `margenUnidadAtomicaMs({consultas: 7, envios: 2})`
—el patrón que `gps` y `descarga-sat` ya usan desde REN-A4/A5 de la 28— y envuelve
en `acotada()` el `select` de `viaje` que era la única consulta de la cadena sin
techo (sin él, hereda los 300 s de undici y el margen es aritmética sobre un
supuesto falso).

**El auditor relanzado lo midió y dijo que cierra el modo de falla y no el techo:**
`sendButtons` ahora se alcanza siempre, pero `venceEn` se ancla **después** de
`leerInterruptor` (hasta 9.5 s) y `COLCHON_LATIDO_CRON_MS` reserva 5.0 s para un
latido que puede costar 9.5 → **hasta 130.2 s contra 120**. Y `leerConfigCobranza`
(`cobranza.ts:39`) sigue sin `acotada()` dentro de la misma cadena. Queda abierto
con su parte restante escrita.

### `54bddb2` — REN-30-C1 (CRÍTICO reincidente) · el veredicto es **no cierra**

`barrerPorConciliar` recorría hasta 1,000 líneas con 3 consultas cada una, sin un
solo chequeo de reloj, desde una Server Action que no declara `maxDuration`:
3,047 viajes de red y **914 s nominales contra el techo de 300** que es el máximo
del repo. El arreglo le presta el reloj de 25 s que el hermano de Cobranza ya
usaba, corta **antes** de tocar cada línea (nunca a media línea, porque el sello
del gasto y el cierre de la línea son dos escrituras), y añade `cortadosPorReloj`.

**El auditor dijo que no cierra, y tiene razón en los dos cargos:** el prólogo
—hasta 100 páginas de `gasto`, ~30 s nominales— corre **antes** del único
`Date.now()`, así que en una flota grande el botón puede no avanzar una sola
línea; y el cambio de significado de `revisadas` **rompió dos rótulos**.

### `065f699` — REN-31C-C1 (CRÍTICO) · **regresión propia, arreglada**

El segundo cargo de arriba es un CRÍTICO que **mi propio arreglo creó** y que el
auditor encontró al reauditar. Antes de `54bddb2`, `revisadas` era el tamaño de
la cola, así que `revisadas === 0` significaba «la cola está vacía». Con el
reloj, un corte antes de la primera línea deja `revisadas = 0` con
`cortadosPorReloj = 1000`, y `controles.tsx:71` pintaba **«No había nada
pendiente que barrer»** sobre mil líneas sin conciliar; `page.tsx:242` archivaba
esa corrida como `estado: 'ok'` con `tareasTotal = 0`.

Es la regla que CLAUDE.md pone primero —un rótulo tiene que ser verdad— y por eso
se arregló en vez de quedar propuesta: **un arreglo que deja una cifra falsa en la
pantalla del comprador es peor que no haberlo hecho**. La prueba es de render
sobre el componente real (`renderToStaticMarkup`), no un grep del fuente, y muere
al quitar la guarda.

### `30e5e14` — OP-A6 (ALTO) · el veredicto es **no cierra: lo mueve de sitio**

El cotejo de `salud-produccion.yml` pregunta «¿aterrizó lo último que se pidió
publicar?» — una pregunta sobre la intención, no sobre el estado. El detector
nuevo (`scripts/ci/deriva-sin-desplegar.mjs`) pregunta qué commits de `src/` y
`supabase/` hay en master que producción no corre, y contra la historia real
nombra exactamente `5ce91b2`, el commit que siete pulsos verdes no vieron.

**El auditor lo desmontó con evidencia y el cargo es serio:** el `::warning::` no
escribe en `$GITHUB_STEP_SUMMARY` (el paso vecino sí lo hace), no abre issue
(`:228` es `if: failure()`) y no manda correo — GitHub solo notifica cuando un
workflow programado **falla**, y este paso tiene prohibido fallar. Con él
mergeado, **las 14 corridas verdes habrían mandado cero notificaciones**: el
aviso acaba en el mismo sitio donde OP-C1 lleva seis rondas atascado, el log de
la corrida. Además, la prueba nueva muere al destripar `resumirDeriva` pero
**sobrevive a tres mutaciones del cableado** — es una prueba a medias y lo digo
aquí en vez de dejar que la siguiente ronda lo descubra.

---

## Las notas

| Rubro | 31 | Hoy | Δ | Porqué |
|---|---|---|---|---|
| **Rendimiento y costo** | 4 | **4** | = | **Reauditado. Las tres razones aplican a la vez y se cancelan**, y el auditor lo argumentó con cifras: bajaron dos peores casos (202.2 → 130.2 s; 914 s sin reloj → bucle acotado) = *se atacó y subió*; el arreglo de peajes abrió un CRÍTICO en la pantalla del contralor = *deuda que cobró factura*; y la *mirada más profunda* encontró que `gps` (**314.0/300**) y `descarga-sat` (**323.5/300**) —que la 31 tenía en «lo que revisé y está bien»— **también exceden**. |
| **Operabilidad y DX** | 5 | **5** | = | **Reauditado. El arreglo es real y no mueve ninguna ancla del rubro**, y en la misma ventana las tres cifras que sostenían el 5 empeoraron: **7 → 14** corridas verdes sobre el arreglo fiscal sin publicar, hueco del pulso **310 → 345 min**, respaldo de Storage **18 → 19 días** sin intento. «Se atacó y subió» y «deuda que cobró factura» se anulan. |
| Los otros 10 | — | — | = | **No auditados esta ronda.** Conservan su nota de la 31 por regla: una nota que no se auditó no cambia de valor por haber pasado un día. |

**Global = 57 / 12 = 4.75 → 4.8.** Idéntica a la de la 31.

### La nota que NO subí, y por qué lo digo

REN-31C-C1 —una de las dos razones por las que rendimiento no subió— se cerró
**después** de que el auditor entregara. Subirle el punto por eso sería el
orquestador calificando su propio arreglo con el auditor ya ido, que es
exactamente el sesgo que la 30 documentó. Se queda en 4 y la 32 decide con
mirada fresca. La otra razón sigue entera y sola ya justifica el 4: dos crons más
excediendo su `maxDuration`, medidos, sin atender.

---

## Lo que urge y no es código (segundo día consecutivo)

**El arreglo fiscal de la ronda 30 sigue en `master` y no en producción.**
Verificado hoy con comando, no inferido:

```
$ git log origin/master --format='%h %s' | grep -m1 '^\S* \[deploy'
cfa00ab [deploy] publicar fix de integridad de REN-C1 (keyset en candidatosDb)   ← 10-sep

$ git diff --stat cfa00ab..origin/master -- src/ supabase/
 src/lib/likida/cuadre/desde_db.ts        | 19 ++++++++-    ← ARQ-C2 (cubo del 15 %)
 src/lib/likida/sat_descarga/ciclo.ts     | 22 +++++++---    ← AG-C1
```

En dinero: con acumulado $100,000 y un ticket de diésel en efectivo de $4,700
fotografiado dos veces, el previo que corre en producción sale **$90,600** donde
lo correcto son **$95,300** — cupo del 15 % regalado, y el PDF declara deducible
lo que ya excedió la RFA 2026 2.9. El auditor de operabilidad contó **14**
corridas del pulso en verde sobre ese estado (la 31 contó 7).

**Se arregla con Redeploy en el panel de Vercel, o con un commit cuyo asunto
lleve `[deploy]` en la primera línea.** No hace falta código nuevo.

---

## Pendientes, con razón escrita

- **REN-30-C2** (CRÍTICO reincidente) — `candidatosDeGasto` (427.5 s) excede el
  `maxDuration` y va antes del único avance durable. No atacado: el tope de 3
  vueltas se gastó, y la cuarta se usó en la regresión propia.
- **REN-31-C1, parte restante** — el techo de 130.2 s contra 120 y
  `leerConfigCobranza` sin `acotada()`.
- **REN-30-C1, parte restante** — el prólogo del barrido corre antes del reloj.
- **OP-A6, parte restante** — el aviso no llega a ningún canal que alguien lea.
- **OP-C1** (CRÍTICO, **6ª ronda**) — no atacado. Mi razón fue que el cuerpo de
  `/api/health` es público y nombrar el reloj es decisión de privacidad. **El
  auditor la aceptó a medias y con razón:** se sostiene para el cuerpo público y
  **no** se sostiene para el **issue privado** que el workflow ya abre con
  `GH_TOKEN` en un repo privado, donde el nombre del cron podría ir sin exponer
  nada. Queda como la pieza más barata y más vieja del tablero.
- **ARQ-A3** (CRÍTICO) — el dedup del ejercicio colapsa comprobantes que no son
  copias y regala cupo del 15 %. **No se pudo reproducir aquí**: el defecto vive
  en una función SQL y este contenedor no tiene servidor de Postgres corriendo.
  Arreglarlo a ciegas en el camino del dinero es justo lo que la rutina prohíbe.
  *Lead para la 32: hay binarios de PostgreSQL 16 en la imagen
  (`/usr/lib/postgresql/16`) y el PR corre un job «Migraciones + aislamiento
  (Postgres efímero)» que sí ejecuta `supabase/tests/`. Levantar un cluster local
  con `initdb`, o usar ese job como oráculo rojo→verde, son dos caminos que
  ninguna ronda ha intentado.*
- **ARQ-C1** (9ª aparición) y **FE-C1** (6ª ronda) — **reverificados hoy por mí,
  abiertos e idénticos**: `poliza/route.ts:363-367` conserva el
  `bloqueos.push` + `continue` por fila que tira el export del periodo completo;
  `visibilidad.ts:41` (`encargado: ['operacion']`) y `forma-viaje.tsx:90` siguen
  dejando el campo Anticipo fuera de la pantalla de despacho.
- **FIS-C1, FIS-C2, LEG-C1, LEG-31-C1, PRU-C1** — rubros no reauditados esta
  ronda; siguen como los dejó la 31.

---

## Compuerta al cerrar

```
npm test        986 archivos · 12,958 pasan · 6 saltadas · 0 fallan · exit 0
tsc --noEmit    exit 0
eslint          0 errores · 154 avisos
lint:ratchet    154/194 heredados · 0 nuevos · 0 errores
npm run build   no se corre en la nube (pide Supabase/OpenRouter/Facturapi/Upstash)
```

Línea base al arrancar: 984 archivos / 12,939 pruebas — idéntica al cierre de la
31, que es lo que confirma que el árbol no se había movido. Al cerrar: **+2
archivos, +19 pruebas**.

**Tablero:** `tablero-continuacion.html` + `tablero-continuacion.png`, capturado
**y mirado**. Mirarlo encontró dos defectos que medir no encontró: la serie
histórica tenía la escala mal (el punto de la 29, 4.4, caía **fuera** del
`viewBox` y no se dibujaba) y la etiqueta final salía cortada como «cont · 4.».
Los dos corregidos y recapturado. Verificado en la imagen: 12 rubros, suma 57,
global 4.8 — las mismas cifras de esta síntesis.

## INFRA de esta corrida

- El clon no traía `node_modules` (`npm ci`, exit 0). No es un fallo del código.
- No hay `gh` en la imagen: todo lo de GitHub salió del MCP.
- Sin red saliente: nada se consultó contra `app.likida.ai`. Lo de producción se
  dedujo de la historia de git y del sha que el pulso publicó, no de un `curl`.
- `docs/auditoria-*/` está en `.gitignore:36` → la ronda se commitea con
  `git add -f` o el PR sale vacío sin avisar.
- Chromium para la captura en `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`,
  con `--force-prefers-reduced-motion`.
