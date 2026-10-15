# Perfil de flota `cinco_agentes`

Recorta una flota a los cinco agentes (liquidación, peajes, Carta Porte, vigía de servicio al cliente y
conductor) más la base mínima para operarlos. Todo lo demás queda **en stand-by**: oculto **e inoperante**
(páginas, menú, Resumen, acciones de servidor, chat, MCP, API `/v1`, descargas `/api/export/*`, crons y los
flujos de comprobantes por WhatsApp), sin borrar nada. **Una flota sin fila de perfil se comporta exactamente
como siempre.**

## Cómo funciona

- **Dato:** tabla `tenant_perfil` (migración `0770_tenant_perfil.sql`): una fila por flota, RLS deny-all
  (solo service-role), y un trigger que asienta cada alta, cambio o baja en `bitacora_auditoria`.
- **Lista cerrada, en código:** `src/lib/auth/visibilidad.ts`.
  - `RUTAS_PERFIL_CINCO_AGENTES` — las pantallas permitidas (la ÚNICA constante que se edita para ampliar el perfil).
  - `RUTAS_STAND_BY_PERFIL_CINCO_AGENTES` — lo que existe y el perfil oculta (solo documenta y alimenta las pruebas).
  - `API_PERFIL_CINCO_AGENTES` — recursos de `/v1`, exports y endpoints de `/api/dashboard` que siguen vivos.
  - `CRONS_PERFIL_CINCO_AGENTES` — crons que siguen corriendo para estas flotas.
- **Falla cerrado:** lo que no está en la lista se niega. Una pantalla, recurso o cron nuevo sin clasificar
  no aparece bajo el perfil, y una prueba falla hasta que alguien lo clasifique.
- **El perfil solo quita:** se aplica encima del rol, nunca da acceso que el rol no tenía.
- **Lectura:** `src/lib/auth/perfil_tenant.ts`, cacheada 30 s por flota. Si la tabla no se puede leer y no hay
  valor previo, se asume el perfil restrictivo (nunca se enseña de más por un bache). Si la tabla aún no existe
  (migración sin aplicar), se trata como «sin perfil».

## Qué cierra, superficie por superficie

| Superficie | Cómo se cierra |
| --- | --- |
| URL directa de una pantalla | `resolverTenantEfectivo` rebota a `/dashboard` |
| Acciones de servidor (`'use server'`) | pasan por `resolverTenantEfectivo` o `requireSessionTenant` con la ruta de su pantalla; una prueba escanea cada archivo |
| Menú, ⌘K y Resumen | `SidebarNav` recibe el perfil; el Resumen es `inicio-cinco-agentes.tsx` (sin chat, planes ni precios) |
| Notificaciones | filtradas con el mismo perfil |
| Chat «Pregunta a tus datos» (y su historial, archivo, ingesta y chat de onboarding) | 403 en cada endpoint de `/api/dashboard/*` fuera de la lista |
| MCP (`/api/mcp`, autorización OAuth y despacho) | 403: una flota con perfil no atiende MCP |
| API `/v1` (llave y sesión) y exports | 403 por recurso fuera de la lista |
| Crons de stand-by | saltan las flotas con perfil (`tenantsConPerfilASaltar`); `escalar` (mixto) lo hace por sección |
| WhatsApp del chofer | `ocr` y `cuadre` apagados por código bajo el perfil; la recepción y los hitos del conductor siguen |

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

## Cómo ampliar el perfil

1. Agrega la ruta a `RUTAS_PERFIL_CINCO_AGENTES` (y quítala de `RUTAS_STAND_BY_PERFIL_CINCO_AGENTES`).
2. Si la pantalla tiene acciones de servidor, comprueba que su archivo esté clasificado `permitido` en
   `src/app/dashboard/perfil_acciones.test.ts`.
3. Para una API o un cron, agrega el recurso a `API_PERFIL_CINCO_AGENTES` / `CRONS_PERFIL_CINCO_AGENTES` y
   actualiza `src/app/api/perfil_inventario.test.ts`.
4. Corre `src/lib/auth/perfil_*.test.ts`, `src/app/dashboard/perfil_*.test.ts*` y `src/app/api/perfil_*.test.ts`.

## Alcance y límites conocidos

- El perfil protege la **aplicación**, no el repositorio: el código de los módulos en stand-by sigue siendo legible
  donde el repositorio sea legible.
- Una llave de API o un acceso MCP emitidos antes del perfil dejan de servir los recursos fuera de la lista; no se
  revocan ni se borran.
- El tenant del superadmin que mira una flota con `?tenant=` ve lo mismo que el cliente (así se prueba el perfil).
