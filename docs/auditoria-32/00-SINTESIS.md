# Auditoría 32 — síntesis

**16-sep-2026** · ronda **LIGERA de rotación**, 3 rubros de 12 · rama
`claude/auditoria-32` sobre `69becdb` · árbol limpio al arrancar, **autofix
habilitado**.

**Global: 4.7** (anterior: **4.7**) · **= 0.0**. Ninguna de las tres notas
auditadas se movió, y las tres escribieron por qué.

---

## Por qué esta ronda fue ligera, y no de doce

La decisión se tomó **antes de gastar un token en auditores**, que es donde la
regla tiene todo su valor: una ronda completa sobre código que no cambió es la
forma más cara de no encontrar nada.

```
list_pull_requests(javiercamarapp/cuadra, state=open)  →  []
git ls-remote origin master                            →  69becdb
git rev-parse HEAD                                     →  69becdb
git log --oneline 8b01aec..HEAD                        →  69becdb (1 commit)
git log --oneline 8b01aec..HEAD -- src/ supabase/ normas/   →  (vacío)
```

Sin PR de auditoría abierto —el #462 de la 31 y sus dos continuaciones está
mergeado en `8b01aec`— y **sin un solo commit en las rutas vigiladas**. El único
commit de la ventana quita una línea de `scripts/mejora-diaria/rutina.sh`.

**La trampa de la ronda anterior no se repitió.** La continuación 2 dejó escrito
que su clon traía `refs/remotes/origin/master` rancio y que el primer cotejo
salió con 7,298 borrados falsos; el primer comando de hoy fue `git ls-remote`, y
el ref vino fresco. La lección se aplicó y se anota que funcionó.

### Los tres que rotaron, y el desempate dicho para que se pueda discutir

Notas vigentes al cierre de la continuación 2: fiscal **3**, legal **3**, y un
empate en **4** entre arquitectura, sistema agéntico, rendimiento y
operabilidad. Los cinco reauditados en las continuaciones del 14 y 15-sep
(frontend, seguridad, pruebas, operabilidad, rendimiento) quedan fuera de la
rotación. De los que quedan, los dos más bajos son fiscal y legal; el tercer
lugar lo disputaban **arquitectura** y **sistema agéntico**, los dos en 4.

Ganó arquitectura por dos razones contables, no por orden alfabético:

1. Tiene el hallazgo más antiguo del tablero, **ARQ-C1**, en su 9ª aparición al
   entrar esta ronda.
2. La continuación 1 dejó **un lead concreto** para reproducir ARQ-A3, un
   CRÍTICO que llevaba dos rondas sin poder reproducirse por vivir en una
   función SQL.

Ese segundo motivo es el que pagó la ronda. **Sistema agéntico queda primero en
la cola de la 33.**

---

## El resultado de la ronda: ARQ-A3 dejó de ser irreproducible, y está arreglado

La 31 escribió ARQ-A3 con aritmética supuesta. Hoy se ejecutó.

### Lo que el lead decía y lo que costaba averiguar

Los binarios de PostgreSQL 16 **sí** están en la imagen, en
`/usr/lib/postgresql/16/bin/` — pero **fuera del PATH**, así que `which initdb`
sale en exit 1 y parece que no existen. Ésa fue la hora que se perdió en la
ronda anterior. Además `initdb` se niega a correr como root y hay que
`su postgres`. Con la receta del job «Migraciones + aislamiento (Postgres
efímero)» de `ci-postgres.yml:143-169`, **las 333 migraciones aplican limpias
sobre base virgen** — dato que de paso dice que ese job sigue sano.

**Consecuencia para las próximas rondas, y es la más útil de hoy: este
contenedor puede correr Postgres y la batería de aislamiento. Lo que vive en SQL
ya no hay que deducirlo.**

### La cifra, medida contra la función viva

Dos tickets de diésel en efectivo de **$2,500** de **estaciones distintas**
(`rfc_emisor` distinto), los dos con folio **1234**, en viajes y meses distintos
de un ejercicio de $1,400,000:

| | `sumar_combustible_ejercicio` | La verdad en la base |
|---|---|---|
| total | $1,397,500 | **$1,400,000** |
| efectivo | $208,500 | **$211,000** |
| tope = 0.15 × total (`engine.ts:812`) | $209,625 | **$210,000** |
| `cupoRestante` (`engine.ts:816`) | **$3,625** | **$1,500** |

**El daño no se quedaba en el sustraendo.** El total deflactado deforma también
el **denominador** del 15 %, y los dos errores empujan en la misma dirección
—el universo grande nunca dedupa menos que el chico—, así que **siempre se
regala cupo**: el PDF declaraba deducibles los $2,500 completos cuando $1,000 no
lo eran, sin imprimir el renglón que lo avisaría. **La 31 se quedó corta, no
larga**: suponía el tope fijo en $210,000.

### La causa raíz es de arquitectura, no de aritmética

La 0349 portó a SQL el criterio de `copiasDeComprobante` (`engine.ts:514-564`)
**tal cual**. Ese criterio —mismo concepto, mismo folio, mismo monto al centavo
⇒ es la misma foto dos veces— es correcto en el universo para el que se
escribió: **UN viaje**, el fajo de comprobantes de un operador. Deja de serlo al
aplicarse al **ejercicio completo**: un año, todos los viajes, todas las
estaciones, donde **el folio se reinicia por emisor**. Mismo código, universo
distinto, supuesto roto. Es exactamente lo que el ancla del rubro castiga.

### El arreglo, y la mutación en los dos sentidos

`f0645f9` — migración **0357**, una línea y **solo en la rama del folio**: se
agrega `coalesce(rfc_emisor, '')` a la partición.

| | resultado |
|---|---|
| sin el arreglo (0349 original) | `total=2500` esperado 5000 → **rojo** |
| con el dedup apagado (mutante `partition by … id`) | `total=6400` esperado 5700 → **rojo** |
| con el arreglo | **verde** |

La prueba (`supabase/tests/0357_dedup_ejercicio_emisor.sql`, cableada en
`ci-postgres.yml`) fija **las tres direcciones**, porque arreglar una rompiendo
otra es el modo de falla de este dedup: emisores distintos **no** son copias;
mismo emisor **sí**; emisor nulo en ambos **sigue** siendo copia (conserva la
0349 — sin emisor no hay con qué distinguirlas, y fallar hacia «es copia» nunca
imprime una deducción de más). La prueba vieja de la 0349 sigue verde.

**Lo que NO se tocó, y se dice para que no se lea como olvido:**
`copiasDeComprobante` se queda igual. Corre sobre un solo viaje, donde su
criterio sigue siendo el correcto, y unificar las dos definiciones es un cambio
de diseño, no este arreglo. FIS-A2 (`fecha` vs `pagado_en`) sigue pendiente: es
interpretación fiscal, decisión de Javier.

**De pilón, el auditor dejó ARQ-A6 y ARQ-A2 también reproducidos.** ARQ-A6 salió
**peor de lo que la 31 escribió**: la ventana anual no solo reporta $2,500 de
$5,000, además declara **`n = 1` comprobante** habiendo dos, con el conteo
respaldando la cifra mala.

---

## Las notas

| Rubro | Ayer | Hoy | Δ | Porqué del movimiento |
|---|---|---|---|---|
| **Cumplimiento fiscal** | 3 | **3** | = | **Ninguna de las tres razones aplica.** Cero líneas de `src/`, así que *se atacó y subió* y *deuda que cobró factura* quedan descartadas por construcción. *Mirada más profunda* exigiría decir que 3 estaba inflado, y no lo estaba: el ancla («3 o menos si el producto imprime una cifra fiscal equivocada») la clava **FIS-C1**, reverificado hoy línea por línea y abierto. 2 CRÍTICOS · 5 ALTOS (1 nuevo) · 8 MEDIOS (1 nuevo) · 4 BAJOS. |
| **Cumplimiento legal** | 3 | **3** | = | **Ninguna de las tres razones aplica**, con el barrido que lo sostiene: **16/16** abiertos reconfirmados con `archivo:línea` de hoy, **0 cerrados, 0 mal reportados**. El ancla («3 o menos si hay transferencia sin cobertura») la fijan LEG-A1 y LEG-A5, las dos reverificadas. El nuevo **LEG-32-A1** sostiene mejor el 3, no lo empeora: es un derecho anunciado que no se puede honrar, no una transferencia nueva. |
| **Arquitectura y mantenibilidad** | 4 | **4** | = | **Ninguna de las tres razones aplica.** El ancla («4 o menos si la misma lógica de dinero vive en más de un archivo») ya topaba en 4 y **sigue topando**: `copiasDeComprobante` y la función SQL siguen siendo dos definiciones. Reproducir ARQ-A3 con cifras es *la misma deuda, mejor medida*, no deuda nueva — el encargo lo dice y el auditor estuvo de acuerdo. 2 CRÍTICOS · 4 ALTOS (1 nuevo) · 5 MEDIOS · 3 BAJOS. |
| Los otros 9 | — | — | = | **No auditados esta ronda.** Conservan su nota por regla. |

**Global = 56 / 12 = 4.67 → 4.7.**

### La nota que NO subí, y por qué lo digo

**Arquitectura no sube por mi arreglo de ARQ-A3.** El auditor entregó su 4
**antes** de que `f0645f9` existiera, y calificar mi propio arreglo con el
auditor ya ido es exactamente el sesgo que la ronda 30 documentó y que la 31
midió. Además el ancla no la mueve: la misma lógica de dinero sigue viviendo en
dos archivos, que es precisamente lo que ARQ-A3 señala de fondo. **Lo decide la
33, con mirada fresca.**

Lo mismo con **fiscal**: `f0645f9` toca el cubo del 15 %, que es su superficie,
y entró después de que entregara. No se califica solo.

---

## Los cuatro CRÍTICOS, ninguno sin estado

**Arreglado con prueba que lo reproduce (1), commit atómico, 0 revertidos:**

- **`f0645f9` — ARQ-A3.** Detallado arriba. Rojo medido → verde, mutación
  verificada en los dos sentidos, suite completa corrida.

**Pendientes con la razón escrita (3):**

- **ARQ-C1 — 10ª aparición consecutiva desde la ronda 24.** Reverificado **por
  mí**, abriendo el archivo, no heredado del reporte:
  `src/app/api/export/poliza/route.ts:363-367` mete al arreglo `bloqueos`
  cualquier liquidación `ajustada` cuyo desglose fiscal no cuadre, y
  `:394-402` corta el export **del periodo completo** con 409 en cuanto
  `bloqueos.length > 0`. *Por qué no se arregló hoy:* el tope de arreglos de una
  ronda ligera se gastó en ARQ-A3, y éste exige decidir un comportamiento
  —¿exportar parcial, o seguir bloqueando?— que es de producto, no de código.
  **Diez rondas señalándolo sin decidirlo es, en sí mismo, el hallazgo.**
- **LEG-31-C1 y LEG-C1** (los dos de legal). Reincidentes, intactos, con sus
  `archivo:línea` de hoy en `legal.md`. *Por qué no se arreglaron:* los dos son
  cambios de esquema y de promesa del aviso —qué se borra y cuándo—, no
  correcciones mecánicas; y legal no admite «arreglar a ciegas» menos que
  ningún otro rubro.
- **FIS-C1 y FIS-C2** (los dos de fiscal). FIS-C1 verificado por mí:
  `preguntas.ts:239` mete `regimenElegible` en el patch y
  `onboarding/page.tsx:67` lo persiste **antes** de que el guardia de la clave
  del SAT (`repo.ts:1616-1632`) corra en `:70`; el `DatoInvalido` se atrapa en
  `:72-74` y sale como error de pantalla, pero el perfil —«la fuente que
  MANDA», dice el comentario de la 29— ya quedó escrito. *Por qué no se
  arregló:* invertir el orden de esas dos escrituras toca el camino de alta de
  cliente completo, y el tope de la ronda ya estaba gastado.

---

## Lo que encontré yo y ningún auditor pidió

**`src/app/api/cron/asistencia/route.test.ts` es intermitente, y lo es desde
antes de esta ronda.** Apareció al correr la suite después del arreglo, y lo
primero que hice fue descartar que fuera mío:

```
git stash -u        (árbol pristino, HEAD sin mis cambios)
5 corridas de src/app/api/cron/asistencia/route.test.ts
  →  10 passed · 10 passed · 1 FAILED · 10 passed · 10 passed
```

**Falla 1 de cada 5 sobre HEAD sin tocar nada.** Causa raíz: el margen derivado
tiene **cero holgura**. El test captura `antes = Date.now()` antes del `GET`, y
la ruta ancla `venceEn` desde su propio `Date.now()`, posterior; un solo tic de
reloj entre los dos voltea la aserción por **1 ms**
(`expected 1789558600309 to be less than or equal to 1789558600308`).

No es solo del test: en producción también transcurre tiempo real entre que
entra la petición y que se ancla el plazo, así que el peor caso puede rebasar
`maxDuration` por ese tanto. **No lo toqué**, y la razón es la regla: los rubros
dueños de eso —rendimiento y operabilidad— **no se rotaron hoy**, y un arreglo
que se sale de su alcance es la causa documentada de PRs rechazados. Queda como
hallazgo para la 33, con la reproducción ya hecha.

---

## Lo que urge y no es código — CUARTO día consecutivo

```
último commit con [deploy] en el ASUNTO:  cfa00ab  (10-sep-2026)
git diff --name-only cfa00ab origin/master -- src/ supabase/   →  21 archivos
```

**Creció: la continuación 2 contaba el arreglo fiscal de la 30; hoy son 21
archivos de `src/`**, entre ellos `cuadre/desde_db.ts` (el cubo del 15 %, ARQ-C2
de la ronda 30) y `sat_descarga/ciclo.ts` (AG-C1). Todo eso está en `master` y
**no en producción**.

No es código y no se arregla con un commit de auditoría: es **Redeploy en el
panel de Vercel** sobre el último deployment, o un commit con la bandera en la
primera línea. Notificado al dueño.

---

## La compuerta, al cerrar

```
npx vitest run     988 archivos · 12,976 pasan · 6 saltadas · 0 fallan   (2 de 3 corridas)
                   987 + 1 roja: cron/asistencia, intermitente PREEXISTENTE  (1 de 3)
npx tsc --noEmit   exit 0, sin salida
npm run lint       0 errores · 154 avisos · exit 0
npm run build      NO se corre en la nube (pide Supabase/OpenRouter/Facturapi/Upstash)
```

Línea base al arrancar: **988 archivos / 12,976 pruebas**, idéntica al cierre de
la continuación 2 — que es lo que confirma que el árbol no se había movido. Al
cerrar, la misma cifra: el arreglo de hoy vive en SQL y su prueba corre en
`ci-postgres`, no en vitest.

**Tablero:** `tablero.html` + `tablero.png`, capturado **y mirado**. Mirarlo
encontró un defecto que medir no encontró: la tarjeta de la compuerta decía
«verde · 0 fallan» copiando la línea base, callando el intermitente. Corregido y
recapturado. Verificado en la imagen: 12 filas, suma 56, global 4.7, 3 píldoras
«auditado hoy», y los 11 puntos de la serie dentro del `viewBox` sin etiquetas
cortadas.

## INFRA de esta corrida

- El clon no traía `node_modules` (`npm ci`, exit 0). **No es un fallo del
  código.**
- `refs/remotes/origin/master` vino **fresco** esta vez (la trampa de la
  continuación 2 no se repitió, porque se aplicó su lección).
- No hay `gh` en la imagen: todo lo de GitHub salió del MCP. Donde el encargo
  pedía `gh pr list`, se corrió `list_pull_requests` y se pega su salida.
- Sin red saliente: nada se consultó contra `app.likida.ai`. Lo de producción se
  dedujo de la historia de git, y se dice que es deducción.
- `docs/auditoria-*/` está en `.gitignore:36` → se commitea con `git add -f` o
  el PR sale vacío sin avisar.
- Chromium para la captura en `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`,
  con `--force-prefers-reduced-motion`.
- **Nuevo y útil:** PostgreSQL 16 en `/usr/lib/postgresql/16/bin/` (fuera del
  PATH), `initdb` requiere `su postgres`, y las 333 migraciones aplican limpias.

## Acciones para la 33

1. **Sistema agéntico** entra primero: perdió el desempate de hoy, no por nota.
2. **ARQ-C1 necesita una decisión de producto**, no un undécimo reporte.
3. El intermitente de `cron/asistencia` ya está reproducido: es de rendimiento u
   operabilidad, y cualquiera de los dos que rote lo hereda.
4. Mantener el MAPA neutral —ya es el default— y seguir exigiendo un número
   contable detrás de cada movimiento. **Hoy: tres rubros auditados, tres notas
   quietas, tres razones escritas.**
