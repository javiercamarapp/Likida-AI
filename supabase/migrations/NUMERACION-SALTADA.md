# Números de migración saltados a propósito

Auditoría 25, BAJO (reincidente de la 24): nada distinguía "número saltado"
de "migración perdida" — una rama futura que ocupiera uno de estos números
se aplicaría fuera de orden en producción (después de la última migración
ya aplicada, en vez de en su hueco numérico). Este archivo es la marca que
faltaba: **los números de la tabla «Huecos declarados» no existieron nunca y no deben reutilizarse.**

Reescrito en F0 (CT-BAS-10, 3-nov-2026): la lista anterior declaraba 10 números y el repo tiene **412** huecos entre
0001 y 0949 (68 rangos). La tabla de abajo se calculó con un script sobre los nombres de archivo de
`supabase/migrations/` (537 archivos, prefijos únicos) y se vigila sola: `scripts/ci/guarda-numeracion-migraciones.mjs`
(prueba `scripts/ci/guarda_numeracion_migraciones.test.ts`, corre en CI con vitest).

## Regla (la hace cumplir la guarda)

1. Un número de migración **nuevo es MAYOR a 0949** (la base de producción está en 0949; `/api/health` → `migracion.base`).
2. **Todo hueco no declarado está prohibido.** Un número menor al máximo que no tenga archivo y no aparezca en la tabla de abajo
   hace fallar la guarda (salvo huecos dentro de un rango reservado por fase, ver más abajo).
3. Un número declarado como saltado **no puede tener archivo**. Si alguien rellena un hueco histórico, la guarda falla: ese SQL
   se aplicaría en producción DESPUÉS de la última migración ya aplicada, fuera de su hueco numérico.
4. Cada fase que cierre declara aquí los números que reservó y no usó (pasan a la tabla de huecos).

## Huecos declarados

| Número | Estado |
| --- | --- |
| `0067`-`0069` | Hueco histórico: sin archivo en el repo ni en la base (medido por script el 3-nov-2026). Origen no registrado; consistente con numeración reservada por lotes o renumeración durante trabajo en paralelo. No se rellena. |
| `0156` | Hueco histórico: sin archivo en el repo ni en la base (medido por script el 3-nov-2026). Origen no registrado; consistente con numeración reservada por lotes o renumeración durante trabajo en paralelo. No se rellena. |
| `0179` | Hueco histórico: sin archivo en el repo ni en la base (medido por script el 3-nov-2026). Origen no registrado; consistente con numeración reservada por lotes o renumeración durante trabajo en paralelo. No se rellena. |
| `0200` | Hueco histórico: sin archivo en el repo ni en la base (medido por script el 3-nov-2026). Origen no registrado; consistente con numeración reservada por lotes o renumeración durante trabajo en paralelo. No se rellena. |
| `0210`-`0212` | Hueco histórico: sin archivo en el repo ni en la base (medido por script el 3-nov-2026). Origen no registrado; consistente con numeración reservada por lotes o renumeración durante trabajo en paralelo. No se rellena. |
| `0220`-`0222` | Hueco histórico: sin archivo en el repo ni en la base (medido por script el 3-nov-2026). Origen no registrado; consistente con numeración reservada por lotes o renumeración durante trabajo en paralelo. No se rellena. |
| `0224` | Hueco histórico: sin archivo en el repo ni en la base (medido por script el 3-nov-2026). Origen no registrado; consistente con numeración reservada por lotes o renumeración durante trabajo en paralelo. No se rellena. |
| `0249` | Hueco histórico: sin archivo en el repo ni en la base (medido por script el 3-nov-2026). Origen no registrado; consistente con numeración reservada por lotes o renumeración durante trabajo en paralelo. No se rellena. |
| `0252`-`0253` | Hueco histórico: sin archivo en el repo ni en la base (medido por script el 3-nov-2026). Origen no registrado; consistente con numeración reservada por lotes o renumeración durante trabajo en paralelo. No se rellena. |
| `0255`-`0257` | Hueco histórico: sin archivo en el repo ni en la base (medido por script el 3-nov-2026). Origen no registrado; consistente con numeración reservada por lotes o renumeración durante trabajo en paralelo. No se rellena. |
| `0277` | Nunca se escribió. Saltado en el trabajo en paralelo de la auditoría 24/25 (varios agentes reservando rangos de números a la vez); no quedó rastro de para qué era. |
| `0293` | Igual que 0277. |
| `0295` | Igual que 0277. |
| `0343` | Igual que 0277, pero de la auditoría 28: `0342_poliza_revision_y_desglose.sql` (`42f93f91`, fix(poliza)) y `0344_analytics_sin_rechazadas.sql` (`0c2133a8`, fix(analytics)) entraron el 5-sep-2026, trabajo en paralelo el mismo día — el mismo patrón que dejó 0277/0293/0295. Atenuante vigente (corregida 21-oct-2026, hallazgo con reproducción real): hasta esa fecha, `prefijosMigraciones()`/`prefijosDeFilas()` en `scripts/ci/compuerta-deploy.mjs` y `scripts/ci/verificar-migraciones-aplicadas.mjs` colapsaban dos archivos con el mismo prefijo en un `Set`, así que un futuro `0343_*.sql` NO bloqueaba el build — se colaba fuera de orden exactamente como el escenario que este documento señala. Ahora detectan la colisión como error explícito (ver `src/lib/likida/migraciones_verificadas.test.ts`, caso "ninguna migración comparte prefijo con otra migración DISTINTA") y la compuerta/el verificador fallan cerrado en vez de construir. |
| `0369` | Hueco histórico: sin archivo en el repo ni en la base (medido por script el 3-nov-2026). Origen no registrado; consistente con numeración reservada por lotes o renumeración durante trabajo en paralelo. No se rellena. |
| `0371`-`0374` | Hueco histórico: sin archivo en el repo ni en la base (medido por script el 3-nov-2026). Origen no registrado; consistente con numeración reservada por lotes o renumeración durante trabajo en paralelo. No se rellena. |
| `0377`-`0379` | Hueco histórico: sin archivo en el repo ni en la base (medido por script el 3-nov-2026). Origen no registrado; consistente con numeración reservada por lotes o renumeración durante trabajo en paralelo. No se rellena. |
| `0381`-`0384` | Hueco histórico: sin archivo en el repo ni en la base (medido por script el 3-nov-2026). Origen no registrado; consistente con numeración reservada por lotes o renumeración durante trabajo en paralelo. No se rellena. |
| `0386`-`0399` | Bloque de numeración reservado por lotes de agentes (10/20 números) y nunca usado; sin archivo en el repo ni en la base (medido 3-nov-2026). No se rellena. |
| `0402`-`0419` | Bloque de numeración reservado por lotes de agentes (10/20 números) y nunca usado; sin archivo en el repo ni en la base (medido 3-nov-2026). No se rellena. |
| `0422`-`0439` | Bloque de numeración reservado por lotes de agentes (10/20 números) y nunca usado; sin archivo en el repo ni en la base (medido 3-nov-2026). No se rellena. |
| `0444`-`0459` | Bloque de numeración reservado por lotes de agentes (10/20 números) y nunca usado; sin archivo en el repo ni en la base (medido 3-nov-2026). No se rellena. |
| `0463`-`0479` | Bloque de numeración reservado por lotes de agentes (10/20 números) y nunca usado; sin archivo en el repo ni en la base (medido 3-nov-2026). No se rellena. |
| `0485`-`0499` | Bloque de numeración reservado por lotes de agentes (10/20 números) y nunca usado; sin archivo en el repo ni en la base (medido 3-nov-2026). No se rellena. |
| `0504`-`0519` | Bloque de numeración reservado por lotes de agentes (10/20 números) y nunca usado; sin archivo en el repo ni en la base (medido 3-nov-2026). No se rellena. |
| `0521`-`0524` | Hueco histórico: sin archivo en el repo ni en la base (medido por script el 3-nov-2026). Origen no registrado; consistente con numeración reservada por lotes o renumeración durante trabajo en paralelo. No se rellena. |
| `0526`-`0529` | Hueco histórico: sin archivo en el repo ni en la base (medido por script el 3-nov-2026). Origen no registrado; consistente con numeración reservada por lotes o renumeración durante trabajo en paralelo. No se rellena. |
| `0532`-`0539` | Hueco histórico: sin archivo en el repo ni en la base (medido por script el 3-nov-2026). Origen no registrado; consistente con numeración reservada por lotes o renumeración durante trabajo en paralelo. No se rellena. |
| `0543`-`0559` | Bloque de numeración reservado por lotes de agentes (10/20 números) y nunca usado; sin archivo en el repo ni en la base (medido 3-nov-2026). No se rellena. |
| `0565`-`0579` | Bloque de numeración reservado por lotes de agentes (10/20 números) y nunca usado; sin archivo en el repo ni en la base (medido 3-nov-2026). No se rellena. |
| `0581`-`0599` | Bloque de numeración reservado por lotes de agentes (10/20 números) y nunca usado; sin archivo en el repo ni en la base (medido 3-nov-2026). No se rellena. |
| `0606`-`0619` | Bloque de numeración reservado por lotes de agentes (10/20 números) y nunca usado; sin archivo en el repo ni en la base (medido 3-nov-2026). No se rellena. |
| `0621`-`0629` | Hueco histórico: sin archivo en el repo ni en la base (medido por script el 3-nov-2026). Origen no registrado; consistente con numeración reservada por lotes o renumeración durante trabajo en paralelo. No se rellena. |
| `0633`-`0634` | Hueco histórico: sin archivo en el repo ni en la base (medido por script el 3-nov-2026). Origen no registrado; consistente con numeración reservada por lotes o renumeración durante trabajo en paralelo. No se rellena. |
| `0638`-`0639` | Hueco histórico: sin archivo en el repo ni en la base (medido por script el 3-nov-2026). Origen no registrado; consistente con numeración reservada por lotes o renumeración durante trabajo en paralelo. No se rellena. |
| `0646` | Hueco histórico: sin archivo en el repo ni en la base (medido por script el 3-nov-2026). Origen no registrado; consistente con numeración reservada por lotes o renumeración durante trabajo en paralelo. No se rellena. |
| `0649` | Hueco histórico: sin archivo en el repo ni en la base (medido por script el 3-nov-2026). Origen no registrado; consistente con numeración reservada por lotes o renumeración durante trabajo en paralelo. No se rellena. |
| `0653`-`0655` | Hueco histórico: sin archivo en el repo ni en la base (medido por script el 3-nov-2026). Origen no registrado; consistente con numeración reservada por lotes o renumeración durante trabajo en paralelo. No se rellena. |
| `0659` | Hueco histórico: sin archivo en el repo ni en la base (medido por script el 3-nov-2026). Origen no registrado; consistente con numeración reservada por lotes o renumeración durante trabajo en paralelo. No se rellena. |
| `0662`-`0664` | Hueco histórico: sin archivo en el repo ni en la base (medido por script el 3-nov-2026). Origen no registrado; consistente con numeración reservada por lotes o renumeración durante trabajo en paralelo. No se rellena. |
| `0666`-`0669` | Hueco histórico: sin archivo en el repo ni en la base (medido por script el 3-nov-2026). Origen no registrado; consistente con numeración reservada por lotes o renumeración durante trabajo en paralelo. No se rellena. |
| `0675` | Hueco histórico: sin archivo en el repo ni en la base (medido por script el 3-nov-2026). Origen no registrado; consistente con numeración reservada por lotes o renumeración durante trabajo en paralelo. No se rellena. |
| `0691`-`0692` | Hueco histórico: sin archivo en el repo ni en la base (medido por script el 3-nov-2026). Origen no registrado; consistente con numeración reservada por lotes o renumeración durante trabajo en paralelo. No se rellena. |
| `0696`-`0699` | Hueco histórico: sin archivo en el repo ni en la base (medido por script el 3-nov-2026). Origen no registrado; consistente con numeración reservada por lotes o renumeración durante trabajo en paralelo. No se rellena. |
| `0702`-`0769` | Bloque de numeración reservado por lotes de agentes (10/20 números) y nunca usado; sin archivo en el repo ni en la base (medido 3-nov-2026). No se rellena. |
| `0771`-`0774` | Hueco histórico: sin archivo en el repo ni en la base (medido por script el 3-nov-2026). Origen no registrado; consistente con numeración reservada por lotes o renumeración durante trabajo en paralelo. No se rellena. |
| `0783` | Hueco histórico: sin archivo en el repo ni en la base (medido por script el 3-nov-2026). Origen no registrado; consistente con numeración reservada por lotes o renumeración durante trabajo en paralelo. No se rellena. |
| `0816`-`0819` | Hueco histórico: sin archivo en el repo ni en la base (medido por script el 3-nov-2026). Origen no registrado; consistente con numeración reservada por lotes o renumeración durante trabajo en paralelo. No se rellena. |
| `0821`-`0822` | Hueco histórico: sin archivo en el repo ni en la base (medido por script el 3-nov-2026). Origen no registrado; consistente con numeración reservada por lotes o renumeración durante trabajo en paralelo. No se rellena. |
| `0824`-`0829` | Hueco histórico: sin archivo en el repo ni en la base (medido por script el 3-nov-2026). Origen no registrado; consistente con numeración reservada por lotes o renumeración durante trabajo en paralelo. No se rellena. |
| `0831` | Hueco histórico: sin archivo en el repo ni en la base (medido por script el 3-nov-2026). Origen no registrado; consistente con numeración reservada por lotes o renumeración durante trabajo en paralelo. No se rellena. |
| `0833`-`0839` | Hueco histórico: sin archivo en el repo ni en la base (medido por script el 3-nov-2026). Origen no registrado; consistente con numeración reservada por lotes o renumeración durante trabajo en paralelo. No se rellena. |
| `0862` | Hueco histórico: sin archivo en el repo ni en la base (medido por script el 3-nov-2026). Origen no registrado; consistente con numeración reservada por lotes o renumeración durante trabajo en paralelo. No se rellena. |
| `0864` | Hueco histórico: sin archivo en el repo ni en la base (medido por script el 3-nov-2026). Origen no registrado; consistente con numeración reservada por lotes o renumeración durante trabajo en paralelo. No se rellena. |
| `0867`-`0869` | Hueco histórico: sin archivo en el repo ni en la base (medido por script el 3-nov-2026). Origen no registrado; consistente con numeración reservada por lotes o renumeración durante trabajo en paralelo. No se rellena. |
| `0871`-`0875` | Hueco histórico: sin archivo en el repo ni en la base (medido por script el 3-nov-2026). Origen no registrado; consistente con numeración reservada por lotes o renumeración durante trabajo en paralelo. No se rellena. |
| `0877`-`0886` | Bloque de numeración reservado por lotes de agentes (10/20 números) y nunca usado; sin archivo en el repo ni en la base (medido 3-nov-2026). No se rellena. |
| `0888`-`0889` | Hueco histórico: sin archivo en el repo ni en la base (medido por script el 3-nov-2026). Origen no registrado; consistente con numeración reservada por lotes o renumeración durante trabajo en paralelo. No se rellena. |
| `0891` | Hueco histórico: sin archivo en el repo ni en la base (medido por script el 3-nov-2026). Origen no registrado; consistente con numeración reservada por lotes o renumeración durante trabajo en paralelo. No se rellena. |
| `0893` | Hueco histórico: sin archivo en el repo ni en la base (medido por script el 3-nov-2026). Origen no registrado; consistente con numeración reservada por lotes o renumeración durante trabajo en paralelo. No se rellena. |
| `0895`-`0898` | Hueco histórico: sin archivo en el repo ni en la base (medido por script el 3-nov-2026). Origen no registrado; consistente con numeración reservada por lotes o renumeración durante trabajo en paralelo. No se rellena. |
| `0900`-`0901` | Hueco histórico: sin archivo en el repo ni en la base (medido por script el 3-nov-2026). Origen no registrado; consistente con numeración reservada por lotes o renumeración durante trabajo en paralelo. No se rellena. |
| `0903`-`0908` | Hueco histórico: sin archivo en el repo ni en la base (medido por script el 3-nov-2026). Origen no registrado; consistente con numeración reservada por lotes o renumeración durante trabajo en paralelo. No se rellena. |
| `0910`-`0922` | Bloque de numeración reservado por lotes de agentes (10/20 números) y nunca usado; sin archivo en el repo ni en la base (medido 3-nov-2026). No se rellena. |
| `0924` | Nunca se escribió. Verificado el 25-oct-2026: no existe en `master`, en ninguna rama remota ni en ningún worktree. El rango 0924-0927 lo trabajaron en paralelo los lotes de la ola 8 de la auditoría 39 (fusionados en #736 y #738, que añadieron 0925 y 0927); no quedó registro de para qué se reservó este número. |
| `0926` | Igual que 0924. |
| `0934` | Hueco histórico: sin archivo en el repo ni en la base (medido por script el 3-nov-2026). Origen no registrado; consistente con numeración reservada por lotes o renumeración durante trabajo en paralelo. No se rellena. |
| `0941`-`0944` | Reservados y NO usados en la ola 10 (28-oct-2026, hallazgo H759 de la verificación del PR #759): el carril A (liquidación) usó `0940` y el carril B (peajes) arrancó su rango en `0945` (rango A2 ola 10: 0945-0949), dejando cuatro números intermedios sin archivo. Verificado: ninguna rama remota usa 0941-0944. Si se llenaran después, `supabase db push` rechazaría versiones menores que la última aplicada (haría falta `--include-all`) y la compuerta de despliegue las tomaría por migraciones fuera de orden: no se reutilizan. |

## Rangos reservados por fase

Rangos de números de migración asignados por fase para que dos fases en paralelo no choquen (el patrón que dejó 0277, 0293, 0295,
0343 y 0941-0944). Dentro de su rango, cada fase usa los números en orden ascendente; los huecos sobre 0949 que caigan dentro de un
rango reservado se toleran mientras la fase no cierre. Al cerrar la fase, los números no usados se mueven a «Huecos declarados».
Fuera de estos rangos, un hueco sobre 0949 es error. El siguiente rango libre empieza en 1030.

| Rango | Fase |
| --- | --- |
| `0950`-`0979` | F3 |
| `0980`-`0989` | F4 |
| `0990`-`0999` | F6 |
| `1000`-`1009` | F7 |
| `1010`-`1029` | F9 |

F0, F1, F2, F5, F8 y F10 no tienen rango: no deben crear migraciones; si una las necesita, pide un rango nuevo (desde 1030) y se anota aquí.

## Aplicadas en la base y fuera del repo

- `0351b_costo_fase_dominio_sintaxis_in` (versión `20260908183539`): aplicada directo en producción, nunca estuvo en un commit
  (CT-BAS-09). Su SQL se recuperó por lectura y vive en `supabase/migraciones-fuera-del-repo/0351b_costo_fase_dominio_sintaxis_in.sql`
  (fuera de `migrations/` a propósito: el sufijo `b` no cumple `^\d{4}_` y no debe tomarse por pendiente). Es redundante con
  `0351_costo_fase_copiloto_runner.sql`, que ya usa la sintaxis `fase in (...)`. El número 0351 tiene archivo; no es un hueco.

## Orden de aplicación en producción distinto al numérico

Por versión de registro, cinco prefijos se aplicaron tras uno mayor: 0351b tras 0352, 0784 tras 0804, 0823 tras 0840, 0857 tras 0860 y
0870 tras 0876 (auditoría de 3-nov-2026, M-03). Ya están aplicadas y funcionan; importa solo al reconstruir una base desde cero (el
orden de archivos difiere del orden productivo: ver el ensayo de restauración).

## Cómo seguir

La próxima migración usa el siguiente número libre dentro del rango de su fase (arriba), nunca uno de la tabla de huecos. Ver
`supabase/APLICAR-EN-PRODUCCION.md` para aplicarla (una por una; nunca `supabase db push`).
