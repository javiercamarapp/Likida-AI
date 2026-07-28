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
datos *filtrados*: se alimenta del `logger`, que redacta RFC, UUID de CFDI y
teléfonos antes de emitir, y se inicializa con `sendDefaultPii: false` para que
el enriquecimiento automático no adjunte IP ni cabeceras —que el pipeline del
logger no ha visto y por tanto no ha podido redactar—. Sin `SENTRY_DSN` no se
carga el paquete siquiera.

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
- Ningún dato **sensible** en el sentido de la ley. Los datos financieros exigen
  consentimiento expreso, que es otra cosa: **no** activan el incremento "hasta
  por dos veces" del art. 59 fr. IV.

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

## Lo que ya quedó cerrado

- Mecanismo del aviso simplificado en WhatsApp — art. 16 fr. II
  (`src/lib/cuadra/privacidad.ts`, mig. 0018).
- Constancia por operador, con reenvío automático si la flota cambia su aviso —
  art. 15 fr. VI.
- Medio ARCO que de verdad responde: la palabra *PRIVACIDAD* se atiende de forma
  determinística, antes del agente.
