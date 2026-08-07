# Runbook de producción

Producción: **https://app.likida.ai** — proyecto `likida/likida.ai` en Vercel,
plan Pro. Ya está desplegado y sirviendo WhatsApp real; este documento es para
**operarlo**, no para levantarlo. El apartado de despliegue está al final porque
es lo que menos falta se hace a las 3 a.m.

`https://likidaai.vercel.app` sigue siendo un alias válido (verificado con
`vercel inspect likida.ai` el 4-ago-2026: la lista de Aliases trae los dos, más
`likida.ai` a secas), pero **`app.likida.ai` es el dominio canónico** — el que
exige `NEXT_PUBLIC_APP_URL` (CLAUDE.md) para que la cookie de Supabase Auth no
quede en otro dominio. Usar el alias viejo aquí no rompe nada operativamente,
pero documentar el dominio equivocado como "producción" sí puede llevar a
verificar cosas (Meta, Supabase Site URL) contra el sitio que no es.

---

## Algo se rompió: qué mirar, en este orden

1. **Los logs.** Todo sale como JSON de una línea por `src/lib/logger.ts`.
   ```
   vercel logs https://app.likida.ai --since 1h
   ```
   O el panel: Vercel → proyecto → *Logs* (runtime). Ojo: **la retención de esa
   vista es corta y no hay ningún log drain configurado** — un fallo del sábado
   de madrugada puede no existir el lunes. Si el incidente importa, copia las
   líneas antes de cerrar la pestaña.

2. **Qué buscar en la línea.** Los identificadores del camino del dinero
   (`tenant`, `viaje`, `operador`, `gasto`, `liquidacion`) salen como huella
   `id:xxxxxxxxxxxx`, no como UUID. Para cruzar una huella contra la base:

   ```ts
   import { huellaId } from '@/lib/logger';
   huellaId('<el uuid de la fila>') // === lo que dice el log
   ```

   El porqué está explicado arriba de `src/lib/logger.ts`: el log solo no puede
   revelar a nadie, pero quien tiene la base recorre el camino contrario en un
   segundo. El RFC y los teléfonos sí se borran del todo y no se recuperan.

3. **Los mensajes de arranque.** Cada instancia nueva emite:
   - `startup.observabilidad` — `{"sentry":false}` en `error` significa que
     **nadie va a recibir el siguiente fallo**. Es lo primero que hay que
     arreglar si aparece.
   - `startup.migraciones` — el esquema del camino del dinero.
   - `startup.entorno` — falta configuración crítica.

4. **Si el panel falló para el contralor.** Pídele el `Digest: <número>` que
   Next enseña en pantalla y busca ese número en los logs: `onRequestError`
   (`src/instrumentation.ts`) emite `request.fail` con `digest`, `ruta` y el
   error. Es el único puente entre lo que él vio y el servidor.

5. **Si las fotos dejaron de llegar.** El sospechoso número uno es el token de
   WhatsApp caducado — ver la sección siguiente.

---

## ¿El costo por liquidación es real o solo parece barato?

Likida cobra **por liquidación**, así que un costo que se subestima en silencio
es el que hace fijar mal el precio. Estas cuatro líneas son las que lo delatan
(`src/lib/cuadra/costos.ts`):

| Línea | Qué significa |
|---|---|
| `costo.no_registrado` | Un insert a `llm_costo` rebotó (RLS, columna, `check`). Ese gasto **no está contado**: el costo real es más alto que el que se ve. |
| `costo.liquidacion_sin_costo` | Una liquidación se cerró sin **una sola** fila de costo. Su costo unitario es DESCONOCIDO, no cero. |
| `costo.precio_wa_invalido` | `CUADRA_WHATSAPP_MSG_USD` está puesta y no es un número (típicamente vacía). Se usó el default; sin este aviso cada mensaje habría contado $0. |
| `costo.monto_invalido` | Llegó un costo NaN o negativo y se descartó la fila en vez de escribir un 0 que se leería como barato. |

Regla de lectura: **cero solo es cero cuando alguien lo midió.** `getResumenCosto`
devuelve `estado: 'medido' | 'sin_registros' | 'no_medido'` justamente para que
un fallo de lectura no se pueda pintar como "$0.00".

---

## Rotar el token de WhatsApp

`WHATSAPP_ACCESS_TOKEN` es un token de usuario de sistema de Meta y **caduca**.
Cuando caduca, la Graph API contesta 401 a las descargas de media: el operador
recibe *"No pude descargar tu foto 😕. ¿Me la reenvías?"*, reenvía, y vuelve a
fallar — reenviar no arregla un token vencido, así que el bucle no termina solo.

1. Meta Business Settings → *Usuarios* → *Usuarios del sistema* → el usuario de
   la app → **Generar nuevo token**, con los permisos `whatsapp_business_messaging`
   y `whatsapp_business_management`.
2. ```
   vercel env rm WHATSAPP_ACCESS_TOKEN production
   vercel env add WHATSAPP_ACCESS_TOKEN production
   ```
3. Redespliega (`vercel --prod`): las envs se leen en el arranque de la función.
4. Comprueba con un mensaje de prueba al número de pruebas, no al del cliente.

---

## Variables que deben estar en Vercel

Están todas en `.env.example`, que es el inventario completo y está verificado
contra el código por la suite (`src/lib/observability/runbook.test.ts`). Las
dos que hay que revisar a mano porque **si faltan el sistema arranca igual**:

| Variable | Qué pasa si falta |
|---|---|
| `SENTRY_DSN` | No hay alerta de nada. Los errores mueren en el runtime log. |
| `DEMO_TENANT_ID` | El panel consulta el tenant del seed y pinta **cero liquidaciones**, sin log. |

El gate de `/dashboard` no depende de ninguna variable de entorno: es la
sesión de Supabase Auth, verificada en `proxy.ts` (`RUTAS_CON_SESION`). El
passcode compartido (`DASHBOARD_PASSCODE`/`DASHBOARD_SECRET`, la ruta
`/acceso`) se borró el 5-ago-2026 — llevaba desde que `proxy.ts` se reescribió
sin ningún llamador real (auditoría 10, seguridad).

Para listarlas: `vercel env ls production`.

---

## Desplegar

Con el proyecto ya vinculado:

```
vercel --prod
```

Para un entorno nuevo desde cero, `bash scripts/deploy-vercel.sh` vincula el
proyecto, empuja las envs de `.env.local` a production + preview (salta las
`WHATSAPP_*` vacías) y fija `NEXT_PUBLIC_APP_URL` al dominio real.

**No** copies solo "las envs de `.env.example` que tengan valor": ese atajo fue
el que dejó fuera el tenant del demo. El inventario de arriba es el que manda.

### Meta / WhatsApp

- Webhook URL: `https://app.likida.ai/api/webhook/whatsapp`
- Verify token: el valor de `WHATSAPP_VERIFY_TOKEN`.
- El `GET` responde el challenge; el `POST` valida HMAC con `WHATSAPP_APP_SECRET`.
- El webhook responde **200 antes de trabajar** (el trabajo va en `after()`, con
  `maxDuration = 120` en `src/app/api/webhook/whatsapp/route.ts`). Consecuencia
  operativa: **Meta no reintenta**. Un error después del 200 es un mensaje
  perdido, y por eso importa tanto que los errores tengan destino.

---

## Lo que este runbook NO cubre

- **Quién recibe qué cuando algo falla.** Hoy no hay nadie asignado ni ningún
  canal: sin `SENTRY_DSN` no hay a dónde mandarlo, y con él habría que decidir
  destinatario.
- **Qué se hace con una liquidación cerrada cuyo PDF no salió** (`pdf.no_entregado`).
  El operador recibe aviso; el procedimiento de reenvío no está escrito.
- **La retención exacta de los runtime logs** en este plan, ni si hace falta un
  log drain antes del demo.

---

## Publicar un cambio (cambió el 5-ago-2026)

**El push a `master` ya no despliega solo.** `vercel.json` trae un
`ignoreCommand` que solo construye cuando **el asunto del commit** —la primera
línea, no el cuerpo— lleva la bandera `[deploy]`.

```
fix(cuadre): redondeo de casetas [deploy]     -> construye y publica
fix(cuadre): redondeo de casetas              -> llega a GitHub, NO publica
```

Antes se redesplegaba en cada push: 30 builds en 12 horas, ~$26 USD/mes de puro
tiempo de build, casi todos publicando arreglos de auditoría que no urgían.
La gráfica de contribuciones de GitHub cuenta commits, no builds, así que
seguir subiendo a `master` todo el día no cuesta nada.

**El modo de falla es silencioso.** Si olvidas la bandera, el push se ve normal
en GitHub y producción se queda atrás sin avisar. Antes de enseñarle el producto
a alguien:

```bash
git log -1 --format='%h %s'                      # tu último commit
vercel inspect likida.ai --scope likida | head   # qué está publicado
```

Si no coinciden, la salida rápida es **Redeploy** en el panel sobre el último
deployment, que no requiere commit nuevo.

Lee solo el asunto a propósito: con el mensaje completo, cualquier commit que
*mencionara* la palabra en el cuerpo disparaba un build. Pasó el mismo día que
se puso la regla.
