# Guion y acta de restauración de la base

CT-INF-04 (F5, 4-nov-2026). Estado verificado en el repo: la restauración de la base **nunca se ha probado** (`DEPLOY.md`: «Última
prueba de restauración: nunca»). El proyecto desechable `eoctuhudpxhyaxxridrf` que preparó el ensayo del 24-oct no aparece.
Este guion lo corre **Javier** (necesita su base y sus llaves); el agente solo lo deja listo. **Nunca contra producción.**

Referencias que ya existen y este guion no duplica: `scripts/respaldo.sh`, `scripts/respaldo-storage.sh`,
`docs/conocimiento/DEPLOY.md` («Respaldo y restauración»), `docs/operacion/RESILIENCIA-DEPLOY.md` (objetivos RPO 24 h / RTO 4 h,
declarados **no demostrados** hasta tener un ensayo con cronómetro) (los scripts `ensayo-restauracion-*.sh` del ensayo del 24-oct viven fuera del repo, en `~/likida-worktrees/`).

## Antes de empezar (5 min)

- [ ] Un dump reciente y **cifrado** (CT-SEG-16: `RESPALDO_AGE_RECIPIENT` + binario `age`) y la clave privada para abrirlo, a mano.
- [ ] Un destino **desechable**: proyecto de Supabase vacío nuevo o `createdb likida_restauro` local. Anotar su URL en una variable,
      nunca en el chat.
- [ ] Cronómetro. La cifra que importa es el tiempo total (RTO), no que «funcionó».
- [ ] Confirmar que `$URL_RESTAURO` NO es la URL de producción (comparar el host con el de `NEXT_PUBLIC_SUPABASE_URL`).

## Pasos (con la hora de cada uno en el acta)

1. **Esquema.** `psql "$URL_RESTAURO" -v ON_ERROR_STOP=1 -f supabase/pruebas-aislamiento/andamio_ci.sql` y las migraciones en orden
   (`for f in supabase/migrations/*.sql`). Registrar la última aplicada; debe coincidir con `migracion.base` de `/api/health`.
2. **Datos.** Descifrar y cargar el dump más reciente. Registrar duración y cualquier error (un error aceptado se anota, no se omite).
3. **Conteos.** Tabla de abajo: producción (consulta de solo lectura) contra restaurada.
4. **Storage.** Por cada `pdf_url` de `liquidacion` y `imagen_url` de `gasto`, la ruta debe estar en `MANIFIESTO.tsv`. Una faltante =
   respaldo incompleto, se dice.
5. **Batería.** `DATABASE_URL=$URL_RESTAURO node scripts/ci/correr-verificaciones.mjs supabase/verificaciones.sql`.
6. **Humo funcional.** Abrir la app contra la base restaurada (entorno local) y listar viajes de una flota.
7. **Borrar** la base de prueba y anotar que se borró.

## Acta (copiar y llenar; guardar en `cierre-total/q-prod/`)

| Campo | Valor |
|---|---|
| Fecha y hora de inicio / fin (hora de México) | |
| Quién corrió el ensayo | |
| Dump usado (nombre, fecha, tamaño) | |
| Edad del dump respecto de la hora del ensayo (= pérdida si fuera hoy) | |
| Destino (tipo, sin URL) | |
| Última migración aplicada / `migracion.base` | |
| Duración: esquema / datos / total (RTO medido) | |
| Errores durante la carga | |

| Conteo | Producción | Restaurada | ¿Igual? |
|---|---|---|---|
| `tenant` | | | |
| `viaje` | | | |
| `gasto` | | | |
| `liquidacion` | | | |
| `operador` | | | |
| Rutas de Storage sin archivo en el manifiesto | n/a | | |

Veredicto: **RESTAURÓ / RESTAURÓ CON FALTANTES / NO RESTAURÓ**. Lo que falta o se debe cambiar: __________.

Después de llenar el acta, actualizar «Última prueba de restauración» en `DEPLOY.md` con la fecha y el RTO medido, y mover RPO/RTO
de «no demostrado» a la cifra medida en `RESILIENCIA-DEPLOY.md`.
