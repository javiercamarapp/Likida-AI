# Handoff — Likida / cuadra

> Escrito el 29-jul, actualizado el **31-jul-2026** sobre `7712249`. Todo lo que
> dice "verificado" se comprobó corriendo el comando ese día. Lo que no, va
> marcado. **Pégale esto entero a tu agente nuevo antes de pedirle nada.**
>
> Las decisiones de arquitectura ya tomadas —y por qué— están en
> `docs/investigacion/00-DECISIONES.md`. Léelo antes de proponer integraciones.

---

## 1. Qué es esto

**Likida** liquida viajes por WhatsApp para flotas de autotransporte federal de
carga en México. El operador manda fotos de sus tickets al WhatsApp de la
empresa y escribe *listo*; el sistema hace OCR, lee el CFDI, cuadra contra el
anticipo, aplica la política de gastos y la ley fiscal mexicana, y devuelve un
PDF de liquidación. El contralor lo ve en un panel web.

- **Repo:** `~/javiercamarapp/cuadra` · GitHub **`javiercamarapp/likida.ai`** · rama `master`
  (se renombró desde `cuadra`; GitHub redirige, pero el remoto ya apunta al nuevo)
- **Pre-revenue, cero clientes.** Las empresas del censo son prospectos, no
  clientes. **No inventes logos, testimonios ni capturas de producto.**
- **Demo: 6-ago-2026.** El comprador es el **contralor** de la flota. Un error
  que él vea en la sala cuesta el trato. Ese es el criterio de prioridad de todo.

---

## 2. Estado hoy — verificado el 31-jul-2026

```
HEAD          7712249   árbol limpio, pusheado a origin/master
npm test      1197 pruebas · 1 saltada · 120 archivos     exit 0
tsc --noEmit                                              exit 0
eslint                                                    exit 0
npm run build                                             exit 0
cobertura     84.8% líneas · 85.3% ramas  (umbral rompe CI si baja)
```

> **Las 34 migraciones están aplicadas y verificadas contra la base real
> (31-jul).** Es la primera vez que no hay ninguna esperando. La salida de los
> bloques 8, 13, 14, 16 y 17 está copiada en la cabecera de
> `supabase/verificaciones.sql`.

**Funciona de punta a punta con WhatsApp real.** El 28-jul se cerró el ciclo
completo por primera vez: mensaje entrante → resolución de operador → motor →
agente → respuesta saliente → PDF.

### Dónde va cada cosa (31-jul)

| | |
|---|---|
| **Catálogo de portales** | **37** · verificados facturando: **2** (`megasur`, `la_gas`) |
| **Tabla permiso CRE → marca** | **12,625 permisos** (88% del padrón nacional) |
| **Investigación de competencia** | cerrada: 1,740 fichas, 319 portales, 5 competidores |
| **Auditorías** | 7 rondas · los 6 hallazgos abiertos de la 7 se cerraron el 31-jul |
| **Migraciones** | **34 escritas · 34 aplicadas** · verificadas contra la base |
| **Al demo** | **6 días** |

Los seis commits del 30-31 jul (`2f79174`..`b187427`) se revisaron uno por uno el
31: los seis correctos. El único hueco —un `return` que no liberaba su claim— se
cerró en `c07360a`.

Se han cerrado **siete rondas de auditoría**. La 6 (completa, 12 rubros) dejó
**5.3/10** y cerró 8 críticos y 5 altos. La 7 (ligera, 3 rubros por rotación)
subió a **5.5/10** — y corrió **sola, como routine en la nube**, abriendo un PR
que ya está mergeado a `master`.

**Empieza por `docs/auditoria-7/00-SINTESIS.md`, y después la 6.**

### `vercel redeploy` NO despliega código — y confundirlo cuesta caro

Pasó el 1-ago, dos veces seguidas, y lo detectó Javier pegando lo que de verdad
le llegaba por WhatsApp:

    vercel redeploy <url>   reconstruye el MISMO build con las variables de
                            entorno nuevas. NO toma commits.
    vercel deploy --prod    sube el directorio local y compila de verdad.

Con `redeploy` el estado queda en lo peor que hay: repo verde, GitHub al día,
1272 pruebas en cero... y producción sirviendo código viejo **sin que nada
falle**. Es la misma trampa que `cuadra.mx` devolviendo 200: la comprobación que
debía delatarlo era justo la que lo confirmaba.

**Cómo verificar de verdad que un cambio está vivo.** Si el cambio no se ve por
HTTP —los del camino de WhatsApp y del PDF no se ven— el despliegue no es
prueba. Hay que mirar el efecto:

    npx vercel alias ls | grep -E "likida.ai|likidaai"

Los TRES hosts (`likida.ai`, `app.likida.ai` y `likidaai.vercel.app`, que es el
del webhook) tienen que apuntar al mismo despliegue nuevo. Y aun así, la prueba
final de un cambio de conversación es el mensaje que llega al teléfono.

**Y para probar un saludo hay que vaciar la conversación.** El agente solo se
presenta cuando `wa_conversacion.estado->turns` está vacío; si hay turnos,
continúa y no dice su nombre. Se limpia así, sin borrar la fila:

    update wa_conversacion
       set estado = jsonb_set(estado, '{turns}', '[]'::jsonb)
     where telefono = '<el de Meta, CON el 1: 521...>';

### Ojo con esto: hay una routine que trabaja sola

Audita de madrugada, empuja a ramas `claude/*` y abre PR. Si te encuentras
commits que no hiciste, es eso. **Haz `git pull --rebase` antes de empezar.**
La ronda 7 y este servidor escribieron sobre los mismos archivos el mismo día y
no se pisaron, pero fue suerte además de disciplina.

### Lo que la ronda 7 encontró, y hay que saberlo

Que **una prueba corría una copia de la función, no la función**
(`analytics_deriva.test.ts` reimplementaba `derivoLaConfig` dentro del propio
archivo). La de producción podía romperse entera y las 7 pruebas seguían verdes.
Lo escribí yo en la ronda 6 — en la misma ronda cuyo hallazgo central era
justamente "prueba el cable, no la función". Ya está arreglado por la routine.

De los 3 críticos que la ronda 7 abrió en el rubro agéntico, **NO QUEDA
NINGUNO.** El último —el texto y el PDF saliendo de dos fotografías distintas de
la base— se cerró el 31-jul con la migración 0036.

**Cero hallazgos de código abiertos de las siete rondas de auditoría.**

### Los seis que se cerraron el 31-jul, y lo que enseñaron

`60538b3` `3fb1816` `3bf1ff8` `cb392f5` `7712249`

| hallazgo | lo que resultó ser |
|---|---|
| `mxn()` copiada a mano | reincidente por 3 rondas y **creciendo** (3 → 8 → 11 sitios). Faltaba una red que impidiera la copia SIGUIENTE, no arreglar las conocidas |
| contador de barrera sin TTL | el `-1` vive en un `finally`, y un `finally` no corre si el proceso muere. Dejaba el viaje **averiado para siempre** |
| 0030 sin bloque de verificación | escribir la lista destapó otras **tres** sin comprobar (0002, 0011, 0012) |
| `politica_gasto` sin lectores | la tabla muerta era la que **más parecía viva**: el seed afirmaba por escrito que el motor la usaba |
| pruebas saltadas bajo `--coverage` | CI corría **solo** `--coverage`, así que dos guardias de tiempo no se ejecutaban ahí ni una vez |
| `liberarEnvioAviso` sin ejecutar | al ejecutarla apareció algo peor: **destruía constancias buenas** del art. 16 |

Cuatro de los seis no eran el bug, eran **la red que faltaba para que el bug no
volviera**. Es el patrón que más se repite en este repo.

---

## 3. Stack y dónde está cada cosa

**Next.js 16** (App Router, `proxy.ts` en vez de `middleware.ts`, `after()`,
`maxDuration`) · **Vercel** plan pro · **Supabase** (Postgres + storage) ·
**Vitest** · **OpenRouter** para los modelos · **zxing-wasm** + **sharp** para el
QR del CFDI · **pdf-lib**.

```
src/lib/cuadra/
  cuadre/          EL MOTOR DEL DINERO. engine.ts es puro y sin I/O.
                   guardia.ts (cifras) · estado_afirmado.ts (afirmaciones)
                   cifras.ts · resumen.ts · leyendas.ts · desde_db.ts
  normas/          indice.ts · fundamento.ts · por_diferencia.ts
                   FUENTE DE VERDAD: los 21 YAML de `normas/` en la raíz
  facturacion/     comercios.ts (13 comercios) · identificar.ts · caducidad.ts
  intake/          ocr.ts · cfdi.ts (zxing) · cfdi_xml.ts · sat.ts
                   emparejar.ts · decidir.ts · sanitizar.ts · concepto.ts
  liquidacion/     pdf.ts · deducibilidad.ts · acreditable.ts · omitidos.ts
  (raíz)           processor.ts · repo.ts (TODO el acceso a datos) · conv.ts
                   presupuesto.ts · privacidad.ts · config.ts · costos.ts
                   analytics.ts · startup.ts · tools.ts
src/lib/           llm/ · agents/ · meta/client.ts · auth/ · observability/
src/app/           api/webhook/whatsapp/route.ts (maxDuration = 120)
                   dashboard/ (lista + detalle) · api/demo · api/export
supabase/migrations/  0001 … 0030
docs/auditoria-N/     seis rondas, con tablero.html y 00-SINTESIS.md
```

### Reglas del repo que NO son negociables

1. **Ninguna cifra que vea el usuario sale del LLM.** `guardia.ts` y `cifras.ts`
   lo imponen en código: si el modelo escribe un número que no vino de una tool,
   el texto se sustituye por el resumen del motor.
2. **El modelo solo puede citar una norma que una tool le devolvió ese turno.**
   `guardiaFundamento` lo impone.
3. **Todo el acceso a datos va por `repo.ts`.** (Se está incumpliendo: hay 55
   sitios fuera. Es el hallazgo reincidente de arquitectura.)
4. **El catálogo de comercios y el de normas son datos, no código.**
5. Comentarios en español, explicando **por qué**, no qué.
6. **`pruebas-manuales/*.prueba.ts` hacen llamadas REALES de pago. No se corren.**
   Nada con `TICKET_PATH` tampoco.

---

## 4. Cosas que te van a morder si no las sabes

- **El "1" mexicano.** Meta entrega el `wa_id` como `521XXXXXXXXXX` pero
  **rechaza los envíos** a esa forma (error #131030). `destinatarioWhatsApp()` en
  `meta/client.ts` lo normaliza a `52XXXXXXXXXX`. Si contestas al mismo `from`
  que recibes, el mensaje rebota en silencio: webhook 200, logs en verde, y el
  operador sin nada.
- **El 200 de Meta significa ACEPTADO, no ENTREGADO.** La entrega real llega
  después por el mismo webhook en `value.statuses`. Se lee en `route.ts`.
- **Supabase/PostgREST devuelve los errores POR VALOR, no lanzados.** Un
  `const { data } = await ...` que descarta `error` convierte un fallo de
  consulta en "no hay". **Ese patrón apareció cinco veces en este repo**
  (`startup.ts`, `resolveOperador`, `getOpenViaje`, `intakeDelta`, `getConfig`).
  Cada vez que escribas una consulta, desestructura `error` y decide qué hacer
  con él.
- **`\b` no funciona después de vocal acentuada en JS.** `\w` es `[A-Za-z0-9_]`,
  así que `cerr[ée]\b` no casa nunca. Usa `(?![\wáéíóúñ])`. En un producto
  escrito en español esto va a volver.
- **El `grep` de esta máquina es un wrapper de ugrep que salta binarios en
  silencio.** Para afirmar que algo NO existe, usa `command grep` y corrobora con
  dos búsquedas.
- **`fusionarConfig(DEMO_CONFIG, null)` devuelve la MISMA referencia.** Mutar lo
  que devuelve `getConfig` escribe el singleton del módulo y filtra datos entre
  tenants. Ya pasó una vez.
- **Las guardias se estorban entre sí, y hay que tenerlo en la cabeza.** En todo
  cierre real `guardiaCifras` sustituye el texto (`guardia.ts:37-39` y `:79`), lo
  que pone `textoDeterminista = true` y **hace que `guardiaFundamento` y
  `guardiaEstado` no corran**. Dos hallazgos de auditoría se declararon críticos
  sin ver ese acoplamiento y resultaron inalcanzables. Antes de arreglar
  cualquier cosa en una guardia, comprueba que su rama se pueda alcanzar de
  verdad: hay una prueba en `processor_cierre.test.ts` que fija el acoplamiento.
- **El permiso de citar una norma viaja en la llave `norma_id`** dentro del
  resultado de una tool. Si añades una tool que explique algo normativo y no la
  emite, `guardiaFundamento` borrará la cita **a media frase** — no la rechaza,
  la recorta. Ver `normasDePolitica` en `normas/por_diferencia.ts`.

---

## 5. Infraestructura y credenciales

| Qué | Dónde |
|---|---|
| Supabase | proyecto `gngoqsvrxdguxvsizpbw` |
| Vercel | `likidaai.vercel.app` · plan pro (tope 300 s) |
| Meta app | `2118551055367905` |
| WABA | `1285225531334385` |
| Phone number ID | `1395114249160000` |

Las credenciales vivas están en `.env.local` (local) y en las env de Vercel.
`.env.example` está verificado en las dos direcciones. `DEPLOY.md` es el runbook
y está al día (28-jul).

**Migraciones: 0001–0030 aplicadas, salvo la 0027, que está escrita y SIN
aplicar a propósito** — al aplicarla, reenviar las mismas fotos en un viaje nuevo
deja de registrar gastos, y hasta el 6-ago eso estorba para ensayar. Aplícala
después del demo.

---

## 6. Lo que Javier tiene que hacer, y nadie más puede

Estas dos bloquean cosas reales y **no son código**. Eran cuatro: las
migraciones se aplicaron el 31-jul y el aviso de privacidad ya tiene su liga
—la app sirve el integral en `/aviso/[tenant]`—, así que solo queda esto:

1. ~~RFC real de la flota~~ **HECHO el 31-jul.** `tenant.rfc = GMX0902279I1`
   (G3M, la empresa del amigo de Javier, la misma a la que se facturaron los
   tickets reales de esa mañana). Pasa forma Y dígito verificador —comprobado
   con `rfcChecksumOk`, no supuesto—; el `TIN010101AAA` del seed fallaba el
   dígito, que es por lo que la validación de receptor estaba APAGADA.

   **La razón social NO se cambió, a propósito.** El aviso integral es una
   página PÚBLICA (`/aviso/<tenant>`): poner ahí los datos de G3M publicaría a
   la empresa de un tercero como responsable de un tratamiento que no hace. La
   validación de receptor solo necesita el RFC. Si en el demo se va a enseñar el
   aviso, hay que decidirlo antes.
2. **Mudar el software a `app.likida.ai`** (decidido el 31-jul). Hoy `likida.ai`
   sirve ESTA app y la landing de `~/javiercamarapp/likida-web` no está
   desplegada en ningún lado.

   ```
   likida.ai       → landing (likida-web)
   app.likida.ai   → software (este repo)
                       /acceso          login  ← YA EXISTE, no hace falta /login
                       /dashboard       panel
                       /aviso/<tenant>  aviso público
                       /api/webhook/…   ← repuntar en Meta
   ```

   **EL ORDEN IMPORTA, y este es el que no rompe nada:**

   1. Añadir `app.likida.ai` al MISMO proyecto de Vercel y el CNAME en el DNS.
      Los dos dominios sirviendo la app: nada se cae.
   2. Repuntar la **Callback URL** en el panel de Meta a
      `https://app.likida.ai/api/webhook/whatsapp` y **probar un mensaje real**.
   3. Cambiar `NEXT_PUBLIC_APP_URL` en Vercel y correr:
      `update tenant set url_aviso_privacidad = 'https://app.likida.ai/aviso/' || id::text;`
   4. Solo entonces, apuntar `likida.ai` a la landing.

   **Mover el ápice antes del paso 2 deja de entrar TODO mensaje**, y de este
   lado no aparece ningún error: Meta simplemente deja de llamar. A seis días
   del demo es el fallo más caro que hay disponible.

   El paso 3 cambia el texto del aviso → cambia su versión → el operador recibe
   el aviso nuevo en su siguiente mensaje. Eso es el art. 15 fr. VI funcionando,
   no un efecto secundario.

   Opcional pero pendiente: `tenant.contacto_privacidad` (art. 29). Mientras esté
   vacío, el aviso integral **lo dice** en vez de inventar un contacto.

3. ~~`SENTRY_DSN` en Vercel~~ **HECHO el 1-ago.** Proyecto `atiendeai/likidaai`
   (plataforma Next.js). Verificado en el log real del arranque:
   `{"msg":"startup.observabilidad","sentry":true,"entorno":"production"}` — y de
   punta a punta: capturó `startup.config_silenciosa` como issue LIKIDAAI-1, que
   se arregló poniendo `CUADRA_WHATSAPP_MSG_USD=0.008` explícita y se marcó
   resuelto. El arranque siguiente reporta `ok:true, revisadas:3`.

   **NO se corrió el asistente de Sentry**, y no hay que correrlo: crearía
   `sentry.client.config.ts` / `sentry.server.config.ts` y envolvería
   `next.config.ts`, pisando la carga dinámica y la redacción de RFC/teléfonos
   de `observability/sentry.ts`. Una sola variable, sin `NEXT_PUBLIC_`.

   Sobre el 0.008: dentro de la ventana de servicio de 24h los mensajes son
   GRATIS hasta el 1-oct-2026. El valor es la tarifa de después — conservador
   hoy, correcto en octubre. Si quieres la cifra real de hoy, ponla en 0.

### RESUELTA el 1-ago: el chequeo de migraciones SÍ corre

Quedó anotado como duda porque `verificarMigracionesCriticas()` no dejaba rastro
en `vercel logs`. Se resolvió mirando el log de un arranque EN FRÍO (el que
disparó el primer mensaje de WhatsApp del día):

    {"msg":"startup.migraciones","meta":{"ok":true}}
    {"msg":"startup.aviso_privacidad","meta":{"ok":true}}

Las dos salen. Ayer se miró una ventana donde no había arranque en frío, así que
lo que faltaba era la instancia, no el chequeo. Y el aviso de privacidad ahora
pasa su sondeo de red — antes apuntaba a un NXDOMAIN.

### La app de Meta está en `dev_mode` y eso SÍ muerde (medido el 1-ago)

Un tercero mandó "hola" y no recibió respuesta. El diagnóstico, del log real:

    (#131030) Recipient phone number not in allowed list

El mensaje LLEGÓ y el pipeline lo procesó; lo que Meta rechazó fue la
**respuesta**. En `dev_mode` solo se puede contestar a números dados de alta a
mano, **hasta 5**.

Para que alguien pueda usar Likida hacen falta DOS altas, en sitios distintos:

| dónde | para qué |
|---|---|
| Meta → WhatsApp → API Setup → *Manage phone number list* | que Likida pueda RESPONDERLE |
| Likida → `operador` con su teléfono | que Likida sepa QUIÉN ES y a qué viaje pegar sus gastos |

Sin la primera: error 131030. Sin la segunda: el mensaje llega y no se reconoce.

**Consecuencia para el 6-ago:** si en la sala alguien de Innovativos escribe
desde su teléfono sin estar en las dos listas, no pasa nada. El tope de 5 es la
razón real para poner la app en vivo — falta `contact_email_verified`, la
política ya existe en `likida.ai/privacidad`.

Además, para facturar de verdad hacen falta cinco datos suyos: RFC, razón social,
CP fiscal, régimen fiscal y uso de CFDI.

---

## 7. Roadmap

### Antes del 6-ago (en orden)

1. **Los tres puntos de la sección 6.** Sin el RFC, el demo se ve mal. (El punto
   0, las migraciones, ya está hecho salvo la 0027.)
2. **Ensayar el flujo completo en vivo, tres veces.** Fotos reales + *listo* +
   PDF recibido. No es reproducible headless; es la única prueba que falta.
3. ~~`GUION_DEMO.md`~~ **REESCRITO el 1-ago** contra el comportamiento de hoy
   (el anterior era del 25-jul, 182 commits atrás). Trae el bloque de preguntas
   de descubrimiento, y `guion_demo.test.ts` lo ata al panel: falla si vuelve a
   prometer el IEPS en pesos. Lo viejo — revísalo contra el comportamiento de hoy, que
   cambió bastante desde el 25-jul.
4. **Nada de refactors grandes.** El repo tiene precedente de que arreglar un
   crítico abre uno peor; a nueve días del demo, el riesgo no se paga.

### Después del demo

- **Auth por usuario** (Supabase Auth + RLS con `auth.uid()`). Hoy el panel es
  UN passcode compartido para todos: no hay identidad, así que cortarle el acceso
  a una persona es imposible por construcción. **Es bloqueante de segundo
  cliente**, no de este demo.
- **Bajar las copias de cada verdad.** El acceso a datos fuera de `repo.ts` lleva
  cinco rondas subiendo (49 → 55). Dos críticos de la ronda 6 fueron exactamente
  eso: dos copias que se separaron.
- **Automatización completa de facturación en portales.** Investigado y planeado,
  no construido. El dato que importa: **9 de los 13 comercios catalogados no
  requieren cuenta**, y ésa es la cuña legalmente más segura.
- **Optimizaciones de costo** (batch API, prompt caching, ruteo por niveles):
  están en `ROADMAP.md` con la decisión explícita de no construirlas antes del
  demo. Sigue siendo la decisión correcta.

---

## 8. Cómo se trabaja aquí

Hay una rutina de auditoría (`~/.claude/skills/auditoria-diaria`) con 12 rubros,
que es lo que ha sostenido la calidad. Si tu agente nuevo no puede correr 12
subagentes, lo importante que se puede replicar a mano:

- **Un hallazgo sin `archivo:línea` y sin escenario "entra esto → sale esto mal"
  no es un hallazgo, es una opinión.** Se descarta.
- **Verifica cada hallazgo abriendo el archivo antes de arreglarlo.** En esta
  última ronda uno resultó **falso** y consta como falso en el tablero.
- **Primero la prueba que falla, luego el arreglo, luego la prueba que pasa.**
  No se arregla lo que no se pudo reproducir.
- **Prueba el CABLE, no solo la función.** El hallazgo central de la ronda 6 fue
  que dos mecanismos correctos, con pruebas unitarias verdes, **nunca se
  conectaron**. Quita la llamada y comprueba que tu prueba se pone roja; si no se
  pone, no está probando lo que crees.
- **Verifica por código de salida, nunca leyendo la salida.** Y encadena con
  `&&`, no con `;` — un commit se empujó en rojo por eso.
- **Una nota que solo sube es una nota que nadie está midiendo.**

---

## 9. Documentos: cuáles creer

| Archivo | Estado |
|---|---|
| `docs/auditoria-6/00-SINTESIS.md` | **Al día.** Empieza aquí. |
| `docs/auditoria-6/tablero.html` | Al día, con los sha verificados uno por uno. |
| `DEPLOY.md` · `README.md` | Al día (28-jul). |
| `FISCAL_LEGAL.md` · `MARCA.md` | 27-jul, razonablemente al día. |
| `normas/*.yaml` | **Fuente de verdad fiscal.** `normas/indice.ts` es copia. |
| `ROADMAP.md` · `AUDIT*.md` · `ESTADO_FINAL.md` · `DECISIONES_PENDIENTES.md` | **24–25 de julio: PARCIALMENTE OBSOLETOS.** `DECISIONES_PENDIENTES.md` todavía dice que no hay proyecto en Vercel, y sí lo hay. Léelos como historia, no como estado. |

**Regla general: si un documento contradice al código, gana el código.** Y si
contradice a `docs/auditoria-6/`, gana la auditoría 6.

---

## 10. El error de criterio que más veces se ha cometido aquí

Afirmar algo que no ocurrió. En todas sus formas:

- decirle al operador "ya quedó cerrada tu liquidación" cuando la base no
  contestó;
- imprimir `Deducible para ISR $11,600.00` en verde sobre un CFDI de un tercero;
- escribir en la base la constancia de un aviso de privacidad que Meta rechazó;
- que el arranque diga "ok" sobre una migración que no puede comprobar.

El producto vende **certeza fiscal**. Una cifra equivocada en verde citando un
artículo es peor que no enseñar la cifra. Cuando el sistema no pueda confirmar
algo, **tiene que decir que no puede** — hay un tercer estado ("a revisión")
justamente para eso, y usarlo siempre gana a adivinar.
