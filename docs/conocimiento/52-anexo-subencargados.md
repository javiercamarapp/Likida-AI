# Anexo de subencargados — la cadena real

**Estado:** derivado del código, no de suposiciones. Cada renglón trae el archivo
donde se puede verificar.
**Fecha:** 28-jul-2026.
**Cierra:** B20 de la auditoría de fase 0.

---

## Por qué existe este documento

El mapa de `11-datos-personales.md` §7 pone a *"Proveedor de modelo (Anthropic /
OpenAI)"* como subencargado directo de Likida. **Eso no es lo que hace el
código.** Likida contrata con **OpenRouter** y con nadie más para IA; Google,
Anthropic y OpenAI están *debajo* de OpenRouter, según a dónde enrute cada
llamada.

La distinción no es pedante, cambia qué se puede exigir y a quién:

- A OpenRouter, Likida **sí** le puede pedir un anexo que cubra su propia cadena:
  es su contraparte contractual.
- A Google, Likida **no** le puede exigir nada directamente. No hay contrato.

Por eso el pendiente de B20 es **contractual con OpenRouter**, y no una tabla del
art. 52 para Google que nadie puede hacer cumplir.

> **Y que nadie salga a cambiar de modelo por esto.** B20 es una brecha de
> documentación, no un incumplimiento demostrado.

---

## Quién es quién

| Figura | Quién | Fundamento |
|---|---|---|
| Titular | El operador | — |
| **Responsable** | La **flota** | art. 2 fr. XIV y XVI |
| **Persona encargada** | **Likida** | art. 2 fr. XII |
| Subencargados | Los de la tabla de abajo | Regl. arts. 54-55 |

Mandarle datos a Likida **no es una transferencia**: el art. 2 fr. XX excluye
expresamente a la persona encargada de la definición, y el art. 35 lo confirma
al hablar de terceros *"distintos de la persona encargada"*.

Esto se apoya en la **definición vigente**, no en la figura de "remisión" del
Reglamento de 2011 — esa palabra no aparece ni una vez en la ley de 2025.
Verificado contra el texto vigente en `normas/lfpdppp-2-XII-XX.yaml`.

---

## La cadena real

| # | Subencargado | Qué recibe | Dónde se verifica |
|---|---|---|---|
| 1 | **Meta Platforms** (WhatsApp Cloud API) | Teléfono del operador, texto de los mensajes, **las fotos de los comprobantes** | `graph.facebook.com` en el cliente de WhatsApp |
| 2 | **OpenRouter, Inc.** | Las fotos (OCR) y el texto de la conversación | `openrouter.ai/api/v1` en `src/lib/llm/openrouter.ts:24` |
| 2a | └ Google | Las fotos, cuando enruta a Gemini | `google/gemini-3.6-flash`, `google/gemini-3.5-flash-lite` en `models.ts` |
| 2b | └ Anthropic | El texto del cuadre | `anthropic/claude-sonnet-5`, `claude-opus-5`, `claude-haiku-4.5` |
| 2c | └ OpenAI | Solo si cae el fallback cross-provider | tabla `FALLBACK` en `openrouter.ts:50` |
| 3 | **Supabase** | Todo lo que se guarda: gastos, montos, folios, RFC, liquidaciones | `src/lib/supabase/admin.ts` |
| 4 | **Vercel** | Hosting: los datos pasan por su cómputo en tránsito | `scripts/deploy-vercel.sh` |
| 5 | **Sentry** | Solo `warn` y `error`, **ya redactados** | `src/lib/observability/sentry.ts` |

**Sobre Sentry (cableado el 28-jul-2026).** Es el único de la tabla que recibe
datos *filtrados*: se alimenta del `logger`, que antes de emitir **borra** el RFC
y el teléfono y **sustituye** el UUID por una huella. Y se inicializa con
`sendDefaultPii: false` para que el enriquecimiento automático no adjunte IP ni
cabeceras —que el pipeline del logger no ha visto y por tanto no ha podido
redactar—. Sin `SENTRY_DSN` no se carga el paquete siquiera.

**Borrar y huellar no son lo mismo, y ante un auditor conviene decirlo así**
(`src/lib/logger.ts:11-47` lo razona entero):

- **RFC y teléfono se borran** (`[RFC]`, `[TEL]`). Su espacio es enumerable —un
  RFC se genera, un celular de diez dígitos son 10^10 intentos—, así que
  huellarlos sería reversible por fuerza bruta.
- **El UUID se pseudonimiza, no se suprime**: se cambia por `id:` + 12 hex de
  FNV-1a (`huellaId`, `logger.ts:82`). Desde la huella no se recupera el UUID
  (~122 bits de entropía), pero quien **sí** tiene la base puede volver a
  relacionarla con la fila. Es deliberado: sin eso, dos fallos de dos flotas
  distintas producían la misma línea carácter por carácter y no se podía
  reconstruir nada a las 3 a.m.

> ✅ **Teléfonos: cerrado el 28-jul-2026** (`src/lib/logger.ts:57`).
> Este documento afirmó primero que se redactaban —y no era cierto para el único
> formato que Meta entrega— y después que no se redactaban. Las dos versiones
> caducaron; ésta va con la medición de hoy sobre la regex vigente
> `/\b\+?521?\d{10}\b|\b\d{10}\b/`:
>
> ```
> "5219993700779"  ->  [TEL]      ← el wa_id mexicano, 13 dígitos
> "+5219993700779" ->  [TEL]
> "5215512345678"  ->  [TEL]
> "529993700779"   ->  [TEL]
> "9993700779"     ->  [TEL]
> ```
>
> **Lo que hay que volver a medir si alguien toca esa regex:** el `wa_id` que
> Meta entrega para México lleva un "1" después del 52 (`5219993700779`) y por
> eso el `1` va opcional; y NO se generaliza a "12 o 13 dígitos" a propósito,
> porque un epoch en milisegundos tiene 13 dígitos y se convertiría en `[TEL]`,
> que es como se pierde la hora de un evento. El camino que lo destapó fue
> `src/app/api/webhook/whatsapp/route.ts` (`logger.warn('wa.ratelimit', { from })`
> con el `from` sin normalizar), y `warn` se replica a Sentry.

### El SAT no es subencargado

`consultaqr.facturaelectronica.sat.gob.mx` (`src/lib/cuadra/intake/sat.ts:15`)
recibe UUID, RFC emisor, RFC receptor y total para validar un CFDI. Es la
**autoridad fiscal consultando su propio registro**, no un proveedor tratando
datos por cuenta de nadie. Listarlo como subencargado sería un error de
categoría.

### Lo que el `package.json` dice y el código desmiente

Había seis dependencias declaradas con **cero** archivos que las usen en `src/`.
Ninguna recibía un solo byte. Cinco se quitaron el 28-jul-2026
(`@upstash/redis`, `@upstash/qstash`, `facturapi`, `@anthropic-ai/sdk`,
`axios`). La sexta, `@sentry/nextjs`, **se cableó ese mismo día** y por eso ya
figura en la tabla de arriba.

Comprobable con `command grep -rl "<paquete>" src/ | wc -l` — con `command`
delante: en esta máquina `grep` es una función de shell que envuelve `ugrep -I` y
salta en silencio los archivos que parecen binarios.

**Trampa a evitar:** quien arme el anexo leyendo el `package.json` va a listar
seis proveedores que no existen en la operación. Ya pasó una vez en una revisión
externa que calificó cuatro tecnologías que el proyecto no usa.

---

## Cuánto dato personal hay aquí, de verdad

Menos del que parece, y conviene saberlo para no sobredimensionar el riesgo ante
un cliente:

- Un ticket de **diésel** o de **caseta** trae datos fiscales de la **empresa**,
  no del operador.
- La exposición personal se concentra en **los viáticos timbrados al RFC del
  operador** (el caso de RLISR 57) y en su **teléfono y nombre** en el canal.
- Los datos financieros exigen consentimiento expreso, que es otra cosa que
  "sensible": **no** activan por sí solos el incremento "hasta por dos veces" del
  art. 59 fr. IV.

> ⚠️ **"Ningún dato sensible" era cierto por suerte, no por diseño — y eso ya
> se corrigió, con la salvedad del último párrafo.**
> Corregido el 28-jul-2026. El esquema de extracción pide `producto`
> (`src/lib/cuadra/intake/ocr.ts:36`) y se persiste en `gasto.ocr_extra`
> (`repo.ts:109`). Un ticket de farmacia metido a gastos escribe
> `producto: "METFORMINA 850MG 30 TABS"` — dato de **salud** del titular
> (art. 2 fr. VI) en una base sin justificación (art. 8, párrafo segundo), con el
> incremento del art. 59 fr. IV disponible. Nadie decidió guardar salud; nadie
> decidió no guardarla.
>
> **Filtro escrito y CABLEADO** (`ocr.ts:344` llama `sanitizarProducto`, no
> `sanitizarTexto`). Descarta el valor completo cuando revela salud, vida sexual
> o creencias, y deja intactos los productos de combustible, que es para lo único
> que el campo se usa (`etiquetaConcepto`, `cuadre/engine.ts`). Se descarta
> entero y no se sustituye por "[dato de salud omitido]": esa marca sigue siendo
> una inferencia de salud guardada y visible para el patrón.
>
> Lo que cubre, con el motivo de cada regla en el propio archivo: formas
> farmacéuticas —incluida la presentación **pegada a la cantidad** (`30TABS`,
> `C/10TAB`), que es como la imprime un ticket de farmacia y por donde se colaba
> el medicamento sin dosis—, dosis en mg/mcg/UI, contexto de salud impreso en el
> ticket, salud reproductiva, y las marcas alimentarias que revelan creencias
> religiosas (§8.6: *"un ticket de farmacia revela salud; uno de comida,
> posiblemente creencias"*).
>
> **Lo que NO cubre, dicho para que nadie lo lea como el catálogo completo del
> art. 2 fr. VI:** opiniones políticas, origen racial o étnico e información
> genética no tienen camino real hasta el campo `producto` de un comprobante de
> carretera, así que no se simulan reglas para ellos. Y el nombre de la farmacia
> viaja por **otro** campo (`emisor`), que pasa por `sanitizarTexto` sin filtro de
> contenido porque `identificarComercio` lo necesita para decidir si el gasto se
> puede facturar: saber que alguien compró en una farmacia no es su diagnóstico,
> pero tampoco es nada, y la decisión de conservarlo es consciente.
>
> Y el límite honesto: eso reduce lo que se **persiste**, no lo que se **remite**.
> La foto entera ya viajó a Gemini vía OpenRouter antes de llegar al filtro, y
> una imagen no se puede enmascarar de antemano. `11-datos-personales.md` §8.6
> pide las dos cosas; hoy se cubre una.

---

## Pendientes, en orden

1. **Anexo de subencargado con OpenRouter** que cubra su cadena (2a–2c). Es el
   eslabón que falta y el único exigible por contrato.
2. **Autorización de subcontratación en el contrato con la flota** (Regl. arts.
   54-55). Sin ella, toda la cadena queda sin base contractual.
3. Confirmar el régimen de retención de OpenRouter para las imágenes.
4. Aviso de privacidad **propio de Likida** para sus usuarios directos —el
   contralor, el dueño, los leads—, donde Likida es **responsable**, no
   encargada. El mecanismo del canal (`src/lib/cuadra/privacidad.ts`) cubre el
   otro sombrero: el de la flota frente a sus operadores.

### 5. Lo que tiene que dar la flota, y sin lo cual no hay aviso válido

Ningún renglón de esta lista se puede resolver escribiendo código. Van con el
nombre exacto de la columna de `tenant` que llenan, para que se capturen una vez
y no se vuelvan a inventar.

| Dato | Columna | Por qué no se puede inventar |
|---|---|---|
| URL del aviso integral, **publicada y abierta** | `url_aviso_privacidad` | Art. 16 fr. II obliga a señalar el sitio; y ahí viven las fr. V (procedimiento ARCO), VI (cómo se comunican cambios), el art. 35 (cláusula de transferencias) y el art. 7 último párrafo (revocación). Sin ella el titular no puede ejercer nada. |
| Razón social exacta del responsable | `razon_social` | Art. 15 fr. I. Hoy dice *TRANSPORTES INNOVATIVOS SA DE CV*, un prospecto sin contrato al que se le está atribuyendo una calidad jurídica que no aceptó. |
| Domicilio del responsable | `domicilio_fiscal` | Art. 15 fr. I. La fracción existe para que el titular sepa **dónde emplazar**; un domicilio inventado cumple la forma y falla en lo único que persigue. |
| Nombre y correo de la persona o departamento de datos personales | (no hay columna) | Art. 29. Va en el integral. |

Mientras falten, el producto **no finge**: manda el aviso simplificado completo
sin la liga y le dice al operador que la empresa aún no la publica. Eso es lo
mejor que el código puede hacer; no es cumplimiento, es honestidad mientras
llega el dato.

## Lo que ya quedó cerrado

- Mecanismo del aviso simplificado en WhatsApp — art. 16 fr. II
  (`src/lib/cuadra/privacidad.ts`, mig. 0018). El **mecanismo**: el contenido
  depende de datos que la flota tiene que dar (ver el bloque de abajo).
- Reenvío automático cuando cambia el aviso — art. 15 fr. VI. Es estructural: la
  versión sale de un hash del texto, no de un contador que alguien suba.
- Medio ARCO que de verdad responde: la palabra *PRIVACIDAD* se atiende de forma
  determinística, antes del agente. Y con ella **las palabras que el propio aviso
  induce** al anunciar la oposición del art. 26 fr. II —"me opongo", "quiero que
  lo revise una persona", "revisión humana"—, que antes caían en el LLM
  (`OPOSICION` en `privacidad.ts`). §6 pide el mecanismo *"documentado en el aviso
  y accesible desde WhatsApp"*: documentarlo con una palabra clave que nadie usa
  al ejercerlo es documentarlo, no hacerlo accesible.
- Constancia de puesta a disposición atada al ENVÍO — Regl. art. 31.
  `sendText` devuelve el `wamid` o `null` (`meta/client.ts:82`) y
  `ponerAvisoADisposicion` (`processor.ts`) libera la reserva y deja
  `privacidad.aviso_no_entregado` cuando no hubo `wamid`, en vez de dejar en la
  base una fila que afirma una entrega que no ocurrió. La reserva sigue yendo
  antes del envío —si no, el aviso sale dos o tres veces—, pero reservar y
  constar dejaron de ser el mismo hecho.
- Enunciado honesto de las finalidades — art. 11 y art. 15 fr. III. El aviso
  decía *"liquidar los viajes y comprobar los gastos ante el SAT. Nada más"* y el
  producto además correlaciona gastos **entre viajes** para marcar duplicados y
  se los entrega al contralor (`analytics.ts:86`, `dashboard/page.tsx:52`). El
  art. 11 vigente perdió las palabras *"compatible o análogo"*: una finalidad que
  el aviso no enuncia exige consentimiento nuevo. Ahora se enuncia.
- Advertencia de tratamiento automatizado y derecho de oposición — art. 26 fr. II
  (elemento 11 del checklist de `11-datos-personales.md` §5.4). La tabla lo ubica
  en el integral; se puso también en el simplificado porque la revisión que lo
  activa ya corre y un derecho que solo vive en un documento que el titular no ha
  visto no se ejerce nunca. **Esto informa la oposición, no la resuelve**: el
  humano en el loop que pide §6 en su punto 1 sigue abierto — `guardar_liquidacion`
  (`tools.ts`) cierra la liquidación en el mismo turno, sin que nadie mire (ver
  el último renglón de la sección siguiente).

## Lo que NO está cerrado y este documento llegó a dar por cerrado

- **El aviso integral no existe.** `url_aviso_privacidad` del tenant de
  producción apunta a `https://transportesinnovativos.mx/aviso-de-privacidad`, un
  dominio **sin zona DNS** (NXDOMAIN, comprobado con `host`). El art. 16 obliga a
  *poner a disposición* el aviso; una liga que no abre no lo pone, y esa misma
  liga era la única respuesta al ejercicio de un derecho ARCO.
  - **Lo que el código ya hace:** `revisarAvisoIntegral` rechaza lo que no tiene
    forma de sitio consultable, y cuando la liga no sirve el aviso **se manda
    igual** —las fr. I a IV del art. 15 caben enteras en el mensaje— pero sin
    pegar la dirección muerta y diciéndole al operador que la empresa aún no la
    publica. Lo mismo en la respuesta ARCO.
  - **Lo que el código NO puede hacer:** saber que un dominio bien escrito no
    está registrado. Eso solo lo prueba `sondearAvisoIntegral`, que sale a la
    red y por eso no va en el camino de cada mensaje: **necesita un llamador en
    un preflight de despliegue, un arranque o un cron** (archivo ajeno).
  - **Lo que hace falta del dueño del negocio:** una URL real y publicada. No hay
    arreglo de código para esto.
- **Los datos del responsable son inventados.** `seed.sql:26-34` los marca
  `🔴 INVENTADO` y los reescribe con `on conflict do update`, así que revierte en
  silencio cualquier captura real: el día que alguien capture la razón social y
  el domicilio de verdad, la siguiente corrida del seed los deshace sin avisar.
  **No hay arreglo de código que lo tape**, y taparlo sería lo peor: una lista de
  "razones sociales prohibidas" haría pasar por buenos los datos inventados que
  no estuvieran en la lista. Archivo ajeno: `supabase/seed.sql`.
- **Sin razón social o sin domicilio, el pipeline sigue.**
  `ponerAvisoADisposicion` (`processor.ts`) registra
  `privacidad.tenant_sin_datos_responsable` y **retorna de esa función, no del
  procesamiento**: la foto se descarga y se manda a Gemini igual. El operador
  nunca ve un aviso y nada se detiene ni se degrada; el único rastro es una línea
  de log. Es el supuesto que §4.3 no admite en ninguna lectura (*"el aviso se
  pone a disposición SIEMPRE"*). Lo que falta decidir no es el texto del aviso
  —eso ya está resuelto— sino **qué hace el pipeline cuando no hay aviso que
  poner**. Archivo ajeno: `processor.ts`.
  - *(La otra mitad de este hueco ya se cerró: `getDatosResponsable`
    (`repo.ts:367`) dejó de exigir la URL del integral, así que la degradación
    honesta —mandar el aviso diciendo que la empresa aún no lo publica— sí se
    alcanza. Razón social y domicilio se siguen exigiendo: son la fr. I.)*
- **Humano en el loop para las decisiones adversas** (§6, punto 1;
  `normas/lfpdppp-26-II.yaml` con `usado_en_codigo: []`). `guardar_liquidacion`
  (`tools.ts`) computa el cuadre, genera los PDF y cierra la liquidación **en el
  mismo turno**, y el contralor ve el resultado después, no antes. El aviso ya
  informa el derecho y el canal ya reconoce su ejercicio, pero **informar la
  oposición no es resolverla**: mientras nadie mire antes del cierre, el supuesto
  de la fr. II sigue activo. Archivos ajenos: `tools.ts`, `processor.ts`.
