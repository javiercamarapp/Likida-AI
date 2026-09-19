# MAPA — auditoría 32 (16-sep-2026)

Ronda **LIGERA** de rotación sobre rama nueva `claude/auditoria-32`, cortada de
`69becdb` (`origin/master`, verificado con `git ls-remote`).

Este documento describe **qué cambió** desde la ronda anterior y **qué no**. No
sugiere ninguna dirección para las notas: que suba, que baje o que se quede son
los tres resultados igual de válidos, y ninguno de los tres es el que este
documento quiere. Todo movimiento necesita un número contable detrás.

---

## Decisión de tipo de ronda, con los comandos

No hay `gh` en esta imagen: todo lo de GitHub sale del MCP.

```
list_pull_requests(javiercamarapp/cuadra, state=open)  →  []
```

Cero PRs abiertos. El PR #462 de la ronda 31 y sus dos continuaciones está
**mergeado** en `8b01aec`.

```
git ls-remote origin master  →  69becdbd569a165b4547aef9771d1e4935d98b62
git rev-parse HEAD           →  69becdbd569a165b4547aef9771d1e4935d98b62
```

(Primer paso obligatorio que dejó escrito la continuación 2: el clon del 15-sep
traía `refs/remotes/origin/master` rancio y el primer cotejo salió con 7,298
borrados falsos. Hoy el ref está fresco y coincide con HEAD.)

```
git log --oneline 8b01aec..HEAD                        →  69becdb (1 commit)
git log --oneline 8b01aec..HEAD -- src/ supabase/ normas/  →  (vacío)
```

El único commit desde que se mergeó la 31 toca **una línea de un script de
shell**:

```
69becdb  fix(mejora-diaria): quitar notificación nativa de macOS al terminar rutina (#475)
         scripts/mejora-diaria/rutina.sh | 1 -
```

**Cero líneas de `src/`. Cero de `supabase/`. Cero fichas `normas/*.yaml`.**

→ Sin PR abierto y sin commits en las rutas vigiladas, la regla manda **RONDA
LIGERA: solo 3 rubros**, los tres de nota más baja que no se hayan auditado en
las últimas rondas. La cobertura se acumula por rotación en vez de por
repetición.

---

## Qué árbol están calificando estos tres auditores

El mismo que cerró la continuación 2 del 15-sep, **más una línea de
`scripts/mejora-diaria/rutina.sh`**. Ninguno de los tres rubros de hoy tiene esa
ruta en su superficie. En términos de código auditable, el árbol es **byte por
byte** el que la continuación 2 calificó con global 4.7.

Eso tiene una consecuencia que conviene tener presente al calificar: de las tres
razones admitidas para mover una nota, *se atacó y subió* y *deuda que cobró
factura* exigen que algo haya cambiado en el repo o en producción. Si nada
cambió, la única razón disponible es *mirada más profunda*, y ésa exige decir
con todas sus letras que la nota anterior estaba inflada — no vale usarla como
comodín. «Ninguna de las tres razones aplica» es una respuesta completa y
legítima, y seis rubros la escribieron en la 31.

---

## Quién se audita hoy, y por qué exactamente esos tres

Notas vigentes al cierre de la continuación 2 (15-sep), suma 56, global 4.7:

| Rubro | Nota | Última vez auditado |
|---|---|---|
| Modelo de datos y esquema | 7 | ronda 31 (13-sep) |
| Backend y API | 6 | ronda 31 (13-sep) |
| Pruebas | 6 | **continuación 2 (15-sep)** |
| Frontend | 5 | **continuación 2 (15-sep)** |
| Seguridad | 5 | **continuación 2 (15-sep)** |
| Tool calling | 5 | ronda 31 (13-sep) |
| Operabilidad y DX | 4 | **continuación 2 (15-sep)** |
| Rendimiento y costo | 4 | **continuación 1 (14-sep)** |
| Sistema agéntico | 4 | ronda 31 (13-sep) |
| **Arquitectura y mantenibilidad** | **4** | ronda 31 (13-sep) |
| **Cumplimiento legal** | **3** | ronda 31 (13-sep) |
| **Cumplimiento fiscal** | **3** | ronda 31 (13-sep) |

Los cinco marcados en negritas en la columna derecha se reauditaron en las dos
continuaciones y quedan fuera de la rotación de hoy. De los siete restantes, los
de nota más baja son **fiscal (3)**, **legal (3)** y un empate en 4 entre
**arquitectura** y **sistema agéntico**.

**El desempate, dicho para que se pueda discutir:** va arquitectura. Dos razones
contables. (1) Tiene el hallazgo con más antigüedad del tablero, ARQ-C1, en su
**9ª aparición consecutiva desde la ronda 24**. (2) La continuación 1 dejó por
escrito un lead concreto para hoy: ARQ-A3 —CRÍTICO, el dedup del ejercicio que
regala cupo del 15 %— **no se pudo reproducir** en la 31 porque vive en una
función SQL y el contenedor no tenía Postgres corriendo; el lead dice que hay
binarios de PostgreSQL 16 en la imagen y que el PR corre un job «Migraciones +
aislamiento (Postgres efímero)» que sí ejecuta `supabase/tests/`. Un crítico que
lleva dos rondas sin poder reproducirse, con una pista de cómo reproducirlo, vale
más que un empate resuelto por orden alfabético.

Los **nueve rubros no auditados** conservan su nota por regla y van marcados
`no auditado esta ronda`. Su nota no se mueve: un rubro sin archivo es un rubro
sin auditar.

---

## Dónde está todo

- `/admin` — consola del superadmin (Javier). Cruza todos los tenants a
  propósito; `lib/admin/negocio.ts` es la única función con ese permiso.
- `/dashboard` — panel del cliente (flota_admin, contador, encargado), ~31
  páginas, todas filtradas al tenant. Reusa los componentes de `/admin`
  (`ui/kit`, `ui/graficas`, `charts`); no hay segunda librería de UI.
- `src/lib/likida/` — el dominio: `cuadre/` (motor), `liquidacion/`, `intake/`,
  `facturacion/`, `repo.ts` (acceso a datos), `analytics.ts`.
- `normas/*.yaml` — **fuente de verdad fiscal y legal**. 40 fichas. Las marcadas
  `verificado_fuente_primaria` traen el texto literal de la norma y ganan
  cualquier discusión.
- `supabase/migrations/` — 333 migraciones aplicadas.
- `docs/auditoria-31/` — la ronda anterior: `00-SINTESIS.md`, sus dos
  continuaciones, y el archivo de cada rubro.

## Trampas del repo que cuestan una hora si no se saben

- `gasto.ocr_raw` está **muerta**; `repo.ts` escribe `ocr_confianza`/`ocr_extra`.
  La prueba de que algo pasó por OCR es `ocr_confianza`.
- `politica_gasto` (la tabla) está muerta. La política viva es
  `tenant.config.politica`, vía `getConfig()`.
- `wa_mensaje_procesado` **no** tiene `tenant_id`: no se puede atribuir a una flota.
- `viaje.estatus` solo admite `abierto | en_cuadre | liquidado`.
  `app_user.rol`: superadmin, flota_admin, contador, encargado, vendedor.
- `cliente`, `unidad`, `tarifa`, `factura_emitida`, `pago_recibido`, `posicion`,
  `cotizacion`, `mantenimiento` y `ticket_mensaje` **ya tienen escritor**. Si vas
  a reportar «falta el escritor», verifica primero: esa línea del CLAUDE.md
  cambió el 29-ago y sigue confundiendo agentes.
- Siguen **sin** escritor: `geocerca`, `terminal`, `portal_credencial`,
  `invitacion`, y las muertas de facto `campania`/`envio_mensaje`.
- La base entera está en cero (0 viajes) porque **no hay clientes todavía**, no
  porque falte código.
- `requireSessionTenant(destino)` arma su redirect con un string fijo y **pierde
  el query string** — por eso existe `dashboard/sufijo.ts`.
- El formato de cifras vive **solo** en `lib/formato.ts`. Hay una prueba que falla
  si aparece `toLocaleString('es-MX')` en cualquier otro archivo.

## Restricciones de esta corrida (nube)

- **La compuerta es `npm test` + `npx tsc --noEmit` + `npm run lint`.** `npm run
  build` **no se corre**: pide Supabase, OpenRouter, Facturapi y Upstash, que
  aquí no existen, y su fallo no diría nada del código.
- **No se corre `pruebas-manuales/*.prueba.ts`**: hacen llamadas reales de pago.
- Sin red saliente: nada se consulta contra `app.likida.ai` ni contra el DOF.
  Lo de producción solo se puede deducir de la historia de git y de los
  artefactos del repo, y hay que decir que es deducción.
- `docs/auditoria-*/` está en `.gitignore:36` → se commitea con `git add -f` o el
  PR sale vacío sin avisar.
