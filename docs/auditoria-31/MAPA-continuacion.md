# MAPA — auditoría 31, ronda de CONTINUACIÓN (14-sep-2026)

Este mapa es para los auditores que se relanzan porque **su código cambió**
después de que escribieron su archivo. No sustituye al `MAPA.md` de la ronda 31:
lo complementa con lo que pasó desde entonces.

## Qué es esta ronda

La 31 cerró el 13-sep y su PR (#462, rama `claude/auditoria-31`) sigue **abierto
y sin mergear**. La regla de la rutina dice que con un PR de auditoría vivo se
continúa sobre él en vez de abrir uno nuevo, y que se relanzan **solo** los
rubros cuyo archivo falte o cuyo código haya cambiado desde que se escribió.

- Archivos de rubro: **los 12 existen**.
- Código de `master`: **no se movió** entre el 13-sep y hoy (`origin/master` =
  `4047a50`, el mismo sobre el que se cortó la rama).
- Lo que **sí** cambió: tres arreglos de esta continuación, commiteados sobre la
  rama. Dos son de **rendimiento** y uno de **operabilidad**. Por eso se
  relanzan esos dos auditores y ningún otro.

## Los tres commits de esta continuación

| sha | Hallazgo | Qué cambió |
|---|---|---|
| `f4fde69` | **REN-31-C1** (CRÍTICO) | `api/cron/asistencia/route.ts` deriva el margen de reloj con `margenUnidadAtomicaMs({consultas: 7, envios: 2})` en vez del literal `15`; `asistencia_escalamiento.ts:303` envuelve en `acotada()` el `select` de `viaje` que era la única consulta sin techo de la cadena. Pruebas nuevas en `route.test.ts` y en `asistencia_escalamiento.test.ts`. |
| `54bddb2` | **REN-30-C1** (CRÍTICO, reincidente) | `intake/consolidado.ts`: `barrerPorConciliar(tenantId, {venceEn})` con corte antes de tocar cada línea y `cortadosPorReloj` en `ResumenBarrido`; `revisadas` pasa de afirmarse por adelantado a contarse. `peajes/page.tsx` presta el reloj (25 s, como cobranza); `peajes/controles.tsx` pinta las que quedaron fuera. |
| `30e5e14` | **OP-A6** (ALTO) | `scripts/ci/deriva-sin-desplegar.mjs` + su prueba, y un paso nuevo en `salud-produccion.yml` que avisa (`::warning::`, sin `exit 1`) qué commits de `src/`/`supabase/` hay en master que producción no corre. |

## Qué se te pide verificar, y con qué criterio

Abre los archivos. La pregunta no es si el arreglo suena razonable, es si **cierra
el hallazgo que dice cerrar** y si **no abrió otro**. En concreto:

- ¿La prueba nueva muere al revertir el arreglo, o pasa igual? (Mutar es barato:
  cambia la línea, corre el archivo de prueba, restaura.)
- ¿El arreglo cambió el contrato de algo que otros llaman?
- ¿Quedó alguna afirmación en pantalla o en un resumen que ya no sea cierta?

Lo que quedó **sin tocar** de tu rubro sigue abierto y te toca reverificarlo: un
hallazgo que nadie atacó no cambia de estado por haber pasado un día.

## Cómo se califica

Las tres razones de movimiento de `rubros.md` son las únicas válidas, y cada
movimiento necesita un número contable detrás — no una impresión. Un rubro cuya
nota se queda igual con el argumento escrito es un resultado tan legítimo como
uno que se mueve. No hay una dirección esperada.

## Estado del árbol y de la compuerta

Árbol limpio al arrancar la continuación. Compuerta corrida hoy sobre el árbol
final: `npm test` **985 archivos / 12,954 pasan / 6 saltadas**, exit 0 ·
`npx tsc --noEmit` exit 0 · `npm run lint` **0 errores, 154 avisos** ·
`npm run lint:ratchet` **0 nuevos**.

## Entorno de esta corrida (la nube)

- No hay `.env`, ni Supabase, ni OpenRouter. **No corras `npm run build`**: pide
  credenciales que aquí no existen.
- **No corras `pruebas-manuales/*.prueba.ts`**: hacen llamadas reales de pago.
- Sin red saliente: nada se puede consultar contra `app.likida.ai`.
- `docs/auditoria-*/` está en `.gitignore:36` — la ronda se commitea con
  `git add -f` o el PR sale vacío sin avisar.
- Dato nuevo de hoy, por si te sirve: **hay binarios de PostgreSQL 16 en la
  imagen** (`/usr/lib/postgresql/16`), aunque no hay servidor corriendo. Las
  rondas anteriores asumieron que ningún `supabase/tests/*.sql` se podía correr
  aquí; eso está sin confirmar, no sin posibilidad.

## Tu entregable

Un solo archivo: `docs/auditoria-31/<tu-rubro>-continuacion.md`, con la forma de
siempre. **No toques el `<tu-rubro>.md` de la 31** — se conserva para poder leer
el delta. No edites ningún archivo de código.
