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
datos *filtrados*: se alimenta del `logger`, que redacta RFC y UUID de CFDI antes
de emitir, y se inicializa con `sendDefaultPii: false` para que el
enriquecimiento automático no adjunte IP ni cabeceras —que el pipeline del logger
no ha visto y por tanto no ha podido redactar—. Sin `SENTRY_DSN` no se carga el
paquete siquiera.

> ⚠️ **Los teléfonos NO están redactados hoy, y este documento afirmaba que sí.**
> Corregido el 28-jul-2026. La regex de `src/lib/logger.ts:11` es
> `/\b\+?52\d{10}\b|\b\d{10}\b/g`, y el formato que Meta entrega de verdad en el
> `wa_id` de todo operador mexicano lleva el "1": `5219993700779`, trece dígitos.
> Medido:
>
> ```
> "5219993700779"  ->  "5219993700779"   ← NO redacta
> "+5219993700779" ->  "+5219993700779"  ← NO redacta
> "529993700779"   ->  "[TEL]"
> "9993700779"     ->  "[TEL]"
> ```
>
> El camino real es `src/app/api/webhook/whatsapp/route.ts:60`
> (`logger.warn('wa.ratelimit', { from: m.from })`, sin normalizar), y `warn` se
> replica a Sentry. Mientras no se arregle la regex, la frase correcta ante un
> auditor es *"redacta RFC y UUID"*, no *"y teléfonos"*: una medida de seguridad
> que no hace lo que su documentación dice es peor que no tenerla, porque este
> documento es justo el que se firma (art. 18, segundo párrafo).
> **Arreglo pendiente en archivo ajeno:** `src/lib/logger.ts`.

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

> ⚠️ **"Ningún dato sensible" no es cierto por diseño, solo por suerte.**
> Corregido el 28-jul-2026. El esquema de extracción pide `producto`
> (`src/lib/cuadra/intake/ocr.ts:36`) y se persiste en `gasto.ocr_extra`
> (`repo.ts:109`). Un ticket de farmacia metido a gastos escribe
> `producto: "METFORMINA 850MG 30 TABS"` — dato de **salud** del titular
> (art. 2 fr. VI) en una base sin justificación (art. 8, párrafo segundo), con el
> incremento del art. 59 fr. IV disponible. Nadie decidió guardar salud; nadie
> decidió no guardarla.
>
> Ya existe el filtro: `sanitizarProducto` en
> `src/lib/cuadra/intake/sanitizar.ts` descarta el valor completo cuando revela
> salud o vida sexual, y deja intactos los productos de combustible, que es para
> lo único que el campo se usa (`etiquetaConcepto`, `cuadre/engine.ts:718`).
> **Queda inerte hasta que `ocr.ts:340` cambie `sanitizarTexto(data.producto)`
> por `sanitizarProducto(data.producto)`** — un renglón, en archivo ajeno.
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
  determinística, antes del agente.
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
  humano en el loop del punto 6 de "Hay que construir" sigue abierto
  (`tools.ts:100-150` cierra la liquidación en el mismo turno, sin que nadie
  mire).

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
- **La constancia de puesta a disposición se escribe ANTES del envío.**
  `processor.ts:148` reclama el envío y `meta/client.ts:69-81` no lanza nunca, así
  que un 400, un 401 o un `#131030` producen lo mismo que un éxito: la base
  afirma que se informó. El Reglamento art. 31 pone la carga de la prueba en el
  responsable, y el artefacto que la satisface es demostrablemente independiente
  del hecho que dice probar. Archivos ajenos: `processor.ts`, `meta/client.ts`,
  `supabase/migrations/0018_aviso_privacidad.sql`.
- **Los datos del responsable son inventados.** `seed.sql:26-34` los marca
  `🔴 INVENTADO` y los reescribe con `on conflict do update`, así que revierte en
  silencio cualquier captura real. Archivo ajeno: `supabase/seed.sql`.
- **Sin datos del responsable el pipeline sigue.** `processor.ts:136-142` registra
  un error y retorna de `ponerAvisoADisposicion`, no del procesamiento: la foto
  se descarga y se manda a Gemini igual (`:254`). Y `repo.ts:369` devuelve `null`
  cuando falta la URL, así que la degradación honesta del párrafo anterior **no
  se alcanza** por ese camino: hay que quitar `&& r.urlAvisoIntegral` de esa
  condición. Archivos ajenos: `processor.ts`, `repo.ts`.
