# Ensayo de restauración de la base (proyecto Supabase desechable)

Estado: **preparado, pendiente de correr por el dueño.** Nada de lo que sigue se ha ejecutado todavía; no hay RTO medido. Este
procedimiento complementa el guion `restauracion-guion-y-acta.md` (acta a llenar) y los objetivos de `RESILIENCIA-DEPLOY.md`.

## Objetivo

Demostrar con cronómetro y con verificaciones objetivas que el respaldo que produce `scripts/respaldo.sh` se puede convertir en una
base funcional, y medir el RTO real de ese camino. Hoy RPO 24 h y RTO 4 h son objetivos declarados, no demostrados.

## Qué es el respaldo y por qué el camino es este

`scripts/respaldo.sh` produce `~/likida-respaldos/base/likida-AAAA-MM-DD_HHMM.sql.age`: un volcado **solo de datos** (INSERT,
`supabase db dump --data-only`) cifrado con `age` para `RESPALDO_AGE_RECIPIENT`. La clave privada de `age` no vive en este equipo.
El volcado no trae esquema, así que el script `scripts/ensayo-restauracion-likida.sh` crea el esquema aplicando las migraciones del repo una por
una con `supabase db query --linked` (API de gestión). Ese camino no usa contraseña de base, y por eso no dispara ECIRCUITBREAKER del
pooler. No se usa `db push` (ver `supabase/APLICAR-EN-PRODUCCION.md`), ni `pg_restore`, ni `npm run respaldo -- restaurar`.

## Prerrequisitos

- `supabase` (CLI con `supabase login` hecho), `age`, `python3`, `jq` (solo para Storage). `brew install age` si falta.
- Archivo de identidad privada de `age` (el par de `RESPALDO_AGE_RECIPIENT`) en una ruta local. El script solo recibe la ruta; no pide ni imprime la clave.
- Al menos un respaldo en `~/likida-respaldos/base/`. Si el último es viejo, corre antes `scripts/respaldo.sh` (su edad es el RPO real).
- Opcional: una carpeta de `scripts/respaldo-storage.sh` (con `MANIFIESTO.json`) para la verificación de Storage.
- Cupo en la organización de Supabase para un proyecto más.

## Costo estimado

El ensayo del 24-oct de Bitácoras (instancia micro, unas 2 horas) costó alrededor de US$0.03. Este tardará más por las ~550 migraciones, así que
espera del orden de centavos. Es una estimación: confirma el cargo real en el panel de facturación de Supabase y bórralo al terminar.
Crear el proyecto es un gasto, por eso lo corres tú.

## Pasos (cada línea se pega con `!`)

1. Anotar la hora de inicio (para el RTO de extremo a extremo) y ver la organización:

   `mkdir -p ~/likida-respaldos/ensayo-restauracion && date +%s > ~/likida-respaldos/ensayo-restauracion/inicio-epoch && supabase orgs list`

2. Crear el desechable (misma región que producción; la contraseña aleatoria se descarta, el ensayo no la usa). El nombre debe contener «ensayo» o «desechable»:

   `supabase projects create likida-ensayo-restauracion-desechable --org-id <ID_ORG> --region us-east-2 --size micro --db-password "$(openssl rand -base64 24 | tr -d '/+=')"`

3. Leer el ref del proyecto nuevo (20 caracteres):

   `supabase projects list`

4. Correr el ensayo (reemplaza `<REF>` y la ruta de la identidad; `STORAGE_BACKUP` es opcional):

   `REF_DESECHABLE=<REF> CONFIRMO_DESECHABLE=SI RESPALDO_AGE_IDENTITY=<ruta/identidad-age.txt> STORAGE_BACKUP=<carpeta-storage> bash scripts/ensayo-restauracion-likida.sh`

   Es reintentable: si falla a la mitad, corrígelo y vuelve a correr la misma línea (las migraciones ya aplicadas se saltan; los datos se vacían y recargan).

5. Borrar el desechable, siempre, pase o falle:

   `supabase projects delete <REF> --yes`

El script deja el acta (sin datos de clientes) en `~/likida-respaldos/ensayo-restauracion/acta-*.txt` y una copia de los GRANT de producción en `acl-prod-*.sql`.

## Paso ARCO: reaplicar las bajas resueltas antes de abrir conexiones

Un respaldo restaurado trae a los titulares que ya habían pedido su cancelación después del corte del respaldo. Reabrir el servicio sin reaplicarlas resucita datos personales que la empresa ya prometió (y acreditó) haber cancelado: es un incumplimiento de la LFPDPPP aunque el sistema "funcione". Este paso es obligatorio en una restauración real y se ensaya en el desechable. **Va después de verificar filas/esquema/RLS y ANTES de repuntar las variables de Vercel o abrir cualquier conexión de clientes, del webhook de WhatsApp o de los crons.**

1. Fijar el corte: la fecha y hora del respaldo restaurado (la lee el acta, «edad del respaldo»).
2. Reunir las solicitudes ARCO de tipo `cancelacion` con `estado = 'resuelta'` y `resuelta_en` posterior al corte. La base restaurada NO las tiene (son posteriores al respaldo), así que la fuente es externa a ella:
   - producción, si todavía se puede leer en solo lectura: `solicitud_arco` con `tipo = 'cancelacion' and estado = 'resuelta' and resuelta_en > <corte>`; su columna `evidencia` dice qué se tocó (migración 0173);
   - si producción ya no existe: las confirmaciones enviadas a los titulares y la bitácora de cumplimiento de `/admin/compliance` exportada antes del incidente; lo que no pueda reconstruirse se anota como hallazgo, no se omite en silencio.
3. Por cada titular, volver a ejecutar la cancelación con el mismo ejecutor de la 0173 (anonimiza al titular, borra su hilo de WhatsApp, posiciones y avisos, desliga el gasto y marca las fotos para borrado en Storage). Es idempotente: reaplicarla sobre un titular ya cancelado no cambia nada.
4. Verificar: cero filas con el teléfono o nombre original de cada titular en `operador`, `wa_mensaje` y `posicion`, y las fotos en `storage_huerfano_candidato` con motivo `arco`.
5. Registrar en el acta cuántas bajas se reaplicaron y cuántas no pudieron reconstruirse. Solo entonces se abren conexiones.

En el ensayo con el desechable se hace el mismo recorrido con una solicitud sintética posterior al corte, para comprobar que el ejecutor corre sobre una base restaurada y que el paso cabe en el RTO.

## Qué verifica el script

| Verificación | Cómo |
|---|---|
| Filas por tabla | Conteo del destino contra el conteo hecho sobre el propio volcado (0 diferencias exigidas). Contra producción en vivo solo se informa (el respaldo es anterior, la diferencia es esperable). |
| Esquema | Tablas, vistas, secuencias, funciones, índices, triggers y huella de columnas, iguales a producción. |
| RLS | `relrowsecurity` y `force` por tabla, iguales a producción. |
| Políticas | Nombre, comando, roles y huella de la expresión, iguales a producción. |
| Migraciones | Destino = archivos del repo y contenido en el registro de producción; informa las que producción tiene sin archivo. |
| Privilegios | `anon`, `authenticated`, `service_role` y `PUBLIC` sobre tablas, columnas, secuencias y funciones, iguales a producción; informa si antes de la corrección no coincidían. |
| Storage | Si hay `STORAGE_BACKUP`: SHA-256 y bytes de cada objeto (`scripts/restore-storage-drill.sh`) y copia local. |
| RPO / RTO | Edad del respaldo contra 24 h; tiempo por fase y RTO medido contra el objetivo. |

Todo se lee con SELECT de catálogo y `count(*)`; la salida solo trae nombres de tablas, objetos y conteos. En producción no se escribe nada: sus consultas son de solo lectura.

## Criterios de aceptación

- 0 diferencias de filas (destino contra volcado). Sin excepciones.
- Esquema, RLS, políticas y privilegios iguales a producción; migraciones: destino = repo.
- RTO medido (descifrar, esquema, datos, privilegios, verificar) de **90 minutos o menos** como objetivo propuesto. Razonamiento: el RTO declarado de 4 h debe cubrir además detección y decisión, crear el proyecto, repuntar las variables de Vercel (un redeploy, es decir un build) y el humo funcional. Dejar 90 minutos a la parte mecánica deja unas 2.5 h de holgura para lo humano. Es una propuesta sin datos; la primera corrida fija la línea base, se ajusta con ella y se repite cuando la base crezca.
- Edad del respaldo de 24 h o menos.
- El paso ARCO se completó (bajas posteriores al corte reaplicadas o documentadas como no reconstruibles) antes de abrir conexiones.
- Cualquier `FALLA` en el resumen es no aceptado. Los `AVISO` se leen y se anotan; los `SALTADO` no cuentan como pasados.

## Si algo falla

- ECIRCUITBREAKER: no reintentes de inmediato; espera unos 10 minutos. El script aborta al primer fallo.
- Falla una migración: es un hallazgo (el esquema no se reconstruye desde cero en un proyecto nuevo). Anota cuál y el código de error. El script se detiene; no sigas a mano.
- Falla un trozo de datos: el mensaje oculta valores. Reintenta la misma línea.
- Privilegios distintos tras la corrección, RLS o políticas distintas: no se declara el ensayo como aprobado; abre el hallazgo con los objetos que lista el resumen.
- Filas distintas: si faltan tablas o filas respecto del volcado, la carga está incompleta; no continúes.

## Cómo registrar el resultado

Copia el acta generada a `cierre-total/q-prod/` y llena la tabla del acta de `restauracion-guion-y-acta.md` con los números. Después actualiza «Última prueba de restauración» en `docs/conocimiento/DEPLOY.md` y mueve RPO/RTO de «no demostrado» a la cifra medida en `RESILIENCIA-DEPLOY.md`. Hazlo solo con el ensayo realmente corrido.

## Límites (qué NO cubre)

- **No cubre PITR** (desactivado en producción) ni la **restauración física de Supabase** (respaldos diarios del proveedor). Este ensayo prueba el camino lógico con `respaldo.sh`.
- **No cubre el cifrado de la clave `respaldo.key`** ni la custodia de la identidad privada de `age`: solo se usa el archivo que le indicas.
- El volcado es solo de datos: si no incluye `auth.users` (el acta lo avisa), los usuarios de acceso no se restauran con este respaldo.
- Storage: se verifica la integridad del respaldo y se hace una copia local; **no se sube** al Storage del desechable (el script de drill no escribe en Supabase).
- La corrección de privilegios lee los GRANT de producción; en un desastre real producción puede no existir. Por eso el script guarda `acl-prod-*.sql`: consérvalo junto a los respaldos.
- Los datos se cargan con triggers desactivados (`session_replication_role = replica`); no se prueba que los triggers rehagan derivados.
- No se prueba la aplicación contra la base restaurada (sin humo funcional ni repunte de Vercel) ni el tiempo de crear el proyecto salvo el aviso de extremo a extremo.
- No comprobado de antemano: que cada una de las ~550 migraciones aplique por la API de gestión en un proyecto nuevo (varias usan BEGIN/COMMIT; la 0332 usa un sustituto no concurrente del preflight 0335, válido por estar las tablas vacías).
