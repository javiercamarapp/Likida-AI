# Perfil de flota `cinco_agentes`

Recorta una flota a los cinco agentes (liquidación, peajes, Carta Porte, vigía de servicio al cliente y
conductor) más la base mínima para operarlos. Todo lo demás queda **en stand-by**: oculto **e inoperante**
(páginas, menú, Resumen, acciones de servidor, chat, MCP, API `/v1`, descargas `/api/export/*`, crons y los
flujos de comprobantes por WhatsApp), sin borrar nada. **Una flota sin fila de perfil se comporta exactamente
como siempre.**

## Fase 1: A1, A2 y A3 activos; A4 y A5 «Próximamente»

Decisión del 15-oct-2026. Hoy el perfil opera **liquidación (A1), peajes (A2) y Carta Porte (A3)**. El **vigía de
servicio al cliente (A4)** y el **conductor (A5)** se **ven** en el menú y en el Resumen con la etiqueta
«Próximamente», pero **no se operan**:

- **Páginas:** las rutas de A4/A5 siguen en `RUTAS_PERFIL_CINCO_AGENTES` (por eso se ven), pero están en
  `MODULOS_PROXIMAMENTE_PERFIL` (`['vigia', 'conductor']`). `exigirRutaDePerfil` las corta **antes de tocar un dato**
  (también sus server actions) y manda a `/dashboard/proximamente/<modulo>`, una pantalla única de solo texto: qué
  hará el agente, sin datos de la flota, sin formularios, sin botones de acción, sin envíos. No manda a `/dashboard`.
- **Menú y Resumen:** el link lleva a esa misma pantalla, con la etiqueta «Próximamente». La ficha del Resumen ya no
  consulta la última corrida.
- **API:** `/api/v1/{hitos,estadias,sitios,conductor,evidencias}` y `/api/export/vigia-faqs` están en
  `API_PROXIMAMENTE_PERFIL` y se niegan (403).
- **Crons:** `vigia` y `conductor-hitos` (`CRONS_PROXIMAMENTE_PERFIL`) saltan las flotas con perfil: filtran los viajes y
  conversaciones antes de decidir nada. En `escalar` (mixto) también se salta la escalación del conductor.
  `gps` sigue corriendo (solo trae posiciones y eventos del proveedor del cliente; no envía nada).
- **Chat y MCP:** siguen cerrados para toda flota con perfil.
- **Sin fila de perfil:** nada cambia; A4/A5 abren como siempre.

**Encender la fase 2** para una flota: sacar `vigia` y/o `conductor` de `MODULOS_PROXIMAMENTE_PERFIL`, mover sus
recursos de `API_PROXIMAMENTE_PERFIL` a `API_PERFIL_CINCO_AGENTES` y sus crons de `CRONS_PROXIMAMENTE_PERFIL` a
`CRONS_PERFIL_CINCO_AGENTES` (y ajustar `perfil_inventario.test.ts` y `perfil_proximamente.test.ts`). Hoy esa lista es
por perfil, no por flota: encenderlos es para todas las flotas con `cinco_agentes`.

**WhatsApp de A4/A5 bajo el perfil (fase 1):** el chofer ya no dispara el Conductor: `moduloEnStandBy(tenant,'conductor')`
(en `perfil_tenant.ts`) corta, en el processor, el registro de hitos, la evidencia de hitos, el pin que el Conductor
compara y la solicitud de ubicación; el «Ya lo atiendo» del jefe se consume en silencio. El resto del turno del chofer
(ROJO/ARCO, talacha, agente genérico, «sin comprobantes por WhatsApp») sigue como siempre. El Vigía tampoco responde:
el mensaje de un cliente de la allowlist se descarta sin guardarlo ni escalarlo, y los botones `vig_*` del gerente se
consumen sin contestar. Todo falla CERRADO si el perfil no se puede leer. Sin fila de perfil nada cambia.

**Lectura del perfil con la base caída:** `perfilDeTenant` falla CERRADO: sin valor previo en la instancia (arranque en frío) y con la
tabla ilegible asume `cinco_agentes`, incluso para una flota SIN perfil. Es deliberado (nunca enseña ni opera de más); el costo
es que, durante un bache de base con una instancia fría, esa flota ve páginas y APIs rebotadas y su chofer no dispara el Conductor
hasta la siguiente lectura (los errores no se cachean, el siguiente request reintenta; con valor previo se usa el último
conocido). No se acota para no perder el fail-closed de las flotas CON perfil.

**Siembra de hitos:** `sembrar_hitos_conductor` (0801) ya se salta a toda flota con fila en `tenant_perfil` (siembra y conciliación).

**Límites conocidos de la fase 1:** (a) el pin de ubicación del chofer sigue guardándose en `posicion` y avisando al
jefe (función de ruta anterior al módulo, no del Conductor); (b) el cron `vigia` ejecuta la retención `vigia_purgar`
(solo borra lo vencido, no envía ni lee) para todas las flotas; (c) la lectura de correos vencidos del Vigía
(`vigia_correos_vencidos`) trae hasta 20 filas de cualquier flota y descarta las de perfil: con 20 o más filas de perfil
atoradas podrían tapar a una flota libre (hoy no hay filas así).

## Cómo funciona

- **Dato:** tabla `tenant_perfil` (migración `0770_tenant_perfil.sql`): una fila por flota, RLS deny-all
  (solo service-role), y un trigger que asienta cada alta, cambio o baja en `bitacora_auditoria`.
- **Lista cerrada, en código:** `src/lib/auth/visibilidad.ts`.
  - `RUTAS_PERFIL_CINCO_AGENTES` — las pantallas permitidas (la ÚNICA constante que se edita para ampliar el perfil).
  - `RUTAS_STAND_BY_PERFIL_CINCO_AGENTES` — lo que existe y el perfil oculta (solo documenta y alimenta las pruebas).
  - `API_PERFIL_CINCO_AGENTES` — recursos de `/v1`, exports y endpoints de `/api/dashboard` que siguen vivos.
  - `CRONS_PERFIL_CINCO_AGENTES` — crons que siguen corriendo para estas flotas.
  - `MODULOS_PROXIMAMENTE_PERFIL`, `API_PROXIMAMENTE_PERFIL`, `CRONS_PROXIMAMENTE_PERFIL` — lo que A4/A5 muestran pero no operan (fase 1).
- **Falla cerrado:** lo que no está en la lista se niega. Una pantalla, recurso o cron nuevo sin clasificar
  no aparece bajo el perfil, y una prueba falla hasta que alguien lo clasifique.
- **El perfil solo quita:** se aplica encima del rol, nunca da acceso que el rol no tenía.
- **Lectura:** `src/lib/auth/perfil_tenant.ts`, cacheada 30 s por flota. Si la tabla no se puede leer y no hay
  valor previo, se asume el perfil restrictivo (nunca se enseña de más por un bache). Si la tabla aún no existe
  (migración sin aplicar), se trata como «sin perfil».

## Qué cierra, superficie por superficie

| Superficie | Cómo se cierra |
| --- | --- |
| URL directa de una pantalla | `resolverTenantEfectivo` rebota a `/dashboard` (a `/dashboard/proximamente/<modulo>` si es de A4/A5) |
| Acciones de servidor (`'use server'`) | pasan por `resolverTenantEfectivo` o `requireSessionTenant` con la ruta de su pantalla; una prueba escanea cada archivo |
| Menú, ⌘K y Resumen | `SidebarNav` recibe el perfil; el Resumen es `src/app/dashboard/inicio-cinco-agentes.tsx` (sin chat, planes ni precios) |
| Notificaciones | filtradas con el mismo perfil |
| Chat «Pregunta a tus datos» (y su historial, archivo, ingesta y chat de onboarding) | 403 en cada endpoint de `/api/dashboard/*` fuera de la lista |
| MCP (`/api/mcp`, autorización OAuth y despacho) | 403: una flota con perfil no atiende MCP |
| API `/v1` (llave y sesión) y exports | 403 por recurso fuera de la lista |
| Crons de stand-by y de A4/A5 | saltan las flotas con perfil (`tenantsConPerfilASaltar`); `escalar` (mixto) lo hace por sección |
| WhatsApp del chofer | `ocr` y `cuadre` apagados por código bajo el perfil; la recepción y los hitos del conductor siguen |

Inventario completo, generado del sistema de archivos y no a mano:

```bash
node scripts/perfil/matriz-superficies.mjs                              # tabla markdown: permitido | negado | NO CLASIFICADO
node scripts/perfil/matriz-superficies.mjs | grep -c "NO CLASIFICADO"   # debe dar 0
```

La prueba `src/lib/auth/perfil_matriz.test.ts` falla si queda algo `NO CLASIFICADO`.

## Aplicar y revertir (lo ejecuta quien opera la plataforma)

Orden: **1)** aplicar la migración `0770` en la base de destino (con respaldo previo, como cualquier migración),
**2)** desplegar el código, **3)** aplicar el perfil a la flota.

```bash
# Solo lectura: ¿qué tiene hoy la flota?
DATABASE_URL="postgres://..." scripts/perfil/aplicar-cinco-agentes.sh --verificar <UUID-de-la-flota>

# Aplicar (una transacción: inserta el perfil y apaga los pipelines ocr y cuadre con motivo)
DATABASE_URL="postgres://..." scripts/perfil/aplicar-cinco-agentes.sh <UUID-de-la-flota>

# Revertir (borra el perfil y re-enciende SOLO los pipelines que puso el perfil)
DATABASE_URL="postgres://..." scripts/perfil/revertir-cinco-agentes.sh <UUID-de-la-flota>
```

Ambos scripts validan que el argumento sea un UUID, son idempotentes y no tocan ninguna otra flota. El cambio se
nota en la app en menos de un minuto (caché de 30 s).

Seguridad de los scripts de cambio (`aplicar-` y `revertir-`):

- Contra un host que no sea local (`127.0.0.1`, `localhost`, `::1`) se **niegan**, salvo con `--produccion` y una
  confirmación interactiva (escribir el UUID de la flota).
- Antes de cambiar nada escriben el estado previo de la flota en `~/likida-respaldos/perfil/<fecha>-<tenant>.json`
  e imprimen al final el comando exacto de reversa. No imprimen la URL de la base (solo el host).
- `--env-file <ruta>` lee `DATABASE_URL` de un archivo sin ejecutarlo ni imprimirlo.

## Cómo ampliar el perfil

1. Agrega la ruta a `RUTAS_PERFIL_CINCO_AGENTES` (y quítala de `RUTAS_STAND_BY_PERFIL_CINCO_AGENTES`).
2. Si la pantalla tiene acciones de servidor, comprueba que su archivo esté clasificado `permitido` en
   `src/app/dashboard/perfil_acciones.test.ts`.
3. Para una API o un cron, agrega el recurso a `API_PERFIL_CINCO_AGENTES` / `CRONS_PERFIL_CINCO_AGENTES` y
   actualiza `src/app/api/perfil_inventario.test.ts`.
4. Corre la matriz (`node scripts/perfil/matriz-superficies.mjs | grep -c "NO CLASIFICADO"` debe dar 0) tras cada
   integración de un frente que añada rutas, recursos `/v1` o crons.
5. Corre `src/lib/auth/perfil_*.test.ts`, `src/app/dashboard/perfil_*.test.ts*` y `src/app/api/perfil_*.test.ts`.

## Si la lectura del perfil falla (decisión de T-PER-08)

`perfilDeTenant` (`src/lib/auth/perfil_tenant.ts`) tiene cuatro casos, fijados por
`src/lib/auth/perfil_sin_perfil.test.ts`:

1. Flota **sin fila** y lectura correcta: `null`, todas las puertas permiten (comportamiento de siempre).
2. **Tabla ausente** (códigos `42P01` / `PGRST205`, migración `0770` sin aplicar): se trata como «sin perfil».
3. **Error transitorio con valor previo**: se usa el último valor conocido de esa flota.
4. **Error transitorio sin valor previo** (por ejemplo, un arranque en frío durante un bache de la base): se asume el
   perfil **restrictivo** (`PERFIL_SI_NO_SE_PUDO_LEER`). El error no se cachea; el siguiente request reintenta.

Consecuencia del caso 4: durante unos segundos, **cualquier** flota (también las que no tienen perfil) puede ver la
aplicación recortada. Nunca se enseña de más. Está **pendiente de decisión de quien opera la plataforma**
(opciones: dejarlo así, fallar abierto, o guardar «esta flota tuvo perfil alguna vez»); mientras no se decida,
rige la opción de dejarlo así, que es la recomendada para la fase actual. Cambiar de opción es ajustar la rama
`catch` de `perfilDeTenant` y la sección «(4)» de `src/lib/auth/perfil_sin_perfil.test.ts`.

## Rollback (runbook)

Cuándo: el perfil recortó algo que la flota necesita, o hay que devolverla al comportamiento de siempre.

1. **Ver el estado actual** (solo lectura):
   ```bash
   scripts/perfil/verificar-cinco-agentes.sh --env-file <ruta-del-env> --produccion <UUID-de-la-flota>
   ```
2. **Revertir** (borra la fila de `tenant_perfil` y los interruptores `ocr` y `cuadre` que puso el perfil; si alguien
   apagó uno de ellos por otra razón, esa palanca no se toca):
   ```bash
   scripts/perfil/revertir-cinco-agentes.sh --env-file <ruta-del-env> --produccion <UUID-de-la-flota>
   ```
   Pide escribir el UUID para confirmar y deja el respaldo en `~/likida-respaldos/perfil/`.
3. **Comprobar** que quedó sin perfil (sale con código 0 si coincide):
   ```bash
   scripts/perfil/verificar-cinco-agentes.sh --esperado sin --env-file <ruta-del-env> --produccion <UUID-de-la-flota>
   ```
   Opcional: `--base-url <URL> --cookie "nombre=valor"` prueba además rutas contra la app con la sesión de un usuario
   de la flota.
4. **Esperar menos de un minuto** (caché de 30 s) y confirmar a mano que el menú y el Resumen vuelven a ser los de siempre.
5. **Re-aplicar** si fue una falsa alarma: el script de aplicar imprime su propio comando; es idempotente.

Revertir no borra datos de la flota. Si lo que falla es el **código** y no el perfil, el perfil no se toca: se
revierte el despliegue como cualquier otro; la migración `0770` es aditiva y puede quedarse aplicada (sin fila no
hace nada).

## Qué NO hace

- **No aísla datos.** La flota con perfil sigue en la misma base y en la misma aplicación que las demás; el perfil
  solo oculta e inhabilita superficies. Separar la base de una flota (instancia aparte) es una decisión de quien opera
  la plataforma, que se toma cuando entren datos de nómina y GPS reales.
- No borra código ni datos de los módulos en stand-by.
- No da permisos: se aplica encima del rol.

## Alcance y límites conocidos

- El perfil protege la **aplicación**, no el repositorio: el código de los módulos en stand-by sigue siendo legible
  donde el repositorio sea legible.
- Una llave de API o un acceso MCP emitidos antes del perfil dejan de servir los recursos fuera de la lista; no se
  revocan ni se borran.
- El tenant del superadmin que mira una flota con `?tenant=` ve lo mismo que el cliente (así se prueba el perfil).
