# Decisiones pendientes de Javier

Cosas que requieren criterio de producto/negocio o credenciales que no tengo, y
que **no adiviné** durante el trabajo autónomo. Cada una con opciones y mi
recomendación. (HARD RULE 4 y 5.)

---

## 1. Flags de las correcciones de orquestación (recomiendo ENCENDER para el demo)

Dos CRÍTICOS de la auditoría los dejé **detrás de flag, default OFF** (HARD RULE
3: el camino actual queda intacto como fallback). Funcionan y están probados,
pero para que apliquen hay que poner las envs. **Para el demo del 6-ago recomiendo
encender ambos.**

| Env | Default | Recomendado demo | Qué hace |
|-----|---------|------------------|----------|
| `CUADRA_INTAKE_GRACE_MS` | `0` (off) | `2000` | Gracia inicial en la barrera de ráfaga: si fotos y "listo" llegan en el mismo lote, evita que el "listo" lea el contador antes de que una foto registre su `+1` y cuadre sobre parciales. |
| `CUADRA_RECUPERAR_CIERRE_PARCIAL` | vacío (off) | `1` | Recupera el "huérfano de cierre": si `guardar_liquidacion` ya persistió pero el ciclo del agente murió después (timeout), trata el cierre como válido, vincula costos y manda el PDF en vez de decir "se trabó". |

**Recomendación:** encender ambos en el entorno del demo. Con OFF, el sistema
queda **exactamente** como el camino verificado actual (sin regresión), pero
expuesto a esos dos casos borde. Riesgo de encenderlos: bajo (código nuevo y
probado); por eso el default OFF es conservador, no porque dude del fix.

---

## 2. Verificar los slugs de modelos de fallback (requiere API/credenciales)

`src/lib/llm/openrouter.ts` → `FALLBACK` mapea cada modelo primario a uno de otro
proveedor para que una caída no sea error visible:

```
google/gemini-3.6-flash        → anthropic/claude-haiku-4.5
google/gemini-3.5-flash-lite   → openai/gpt-5.6-luna
anthropic/claude-sonnet-5      → openai/gpt-5.6-terra
anthropic/claude-opus-5        → anthropic/claude-sonnet-5
```

El primario (`claude-sonnet-5`) está verificado. Los **fallbacks NO** los pude
verificar: requiere una llamada autenticada a OpenRouter y no quise gastar tus
créditos/clave de madrugada (HARD RULE 5). Riesgo: si un slug de fallback está
mal, un error *transitorio* del primario se vuelve error *duro* (peor que
reintentar el primario).

**Opciones:**
- **A (recomendada):** antes del demo, correr un ping a cada slug de fallback
  (`GET /models` de OpenRouter o un completion mínimo) y corregir los que no
  existan. 10 min de trabajo con la clave.
- **B:** desactivar el fallback cross-provider para el cuadre (dejar que el
  primario reintente). Menos resiliencia, cero riesgo de slug malo.

**Mi recomendación:** A. El fallback vale, solo hay que confirmar los nombres.

---

## 3. `cuadre_fallback` → Opus: ¿cablearlo o quitarlo?

`models.ts` define el rol `cuadre_fallback` (→ `claude-opus-5`) con su env y sus
params, pero **ningún agente lo usa** y `runAgent` no lo referencia. Es intención
muerta: la idea era "si el cuadre con Sonnet se ve difícil, escalar a Opus", pero
no está cableada.

**Opciones:**
- **A:** cablear una escalada real (p. ej. si el agente pide reasoning alto o si
  detecta ambigüedad, reintentar el cuadre con Opus). Es una **feature nueva sobre
  el camino del dinero** → merece diseño y tests, no improvisarla de noche.
- **B (recomendada por ahora):** dejarlo como está (config inerte, no molesta) y
  decidir la escalada como feature con calma. O borrar el rol para no confundir.

**Mi recomendación:** B para el demo (no aporta nada crítico y Sonnet-5 ya es
frontera). Si quieres la escalada a Opus como diferenciador de robustez, la
diseñamos como feature con su test.

---

## 4. Reversión del precio intro de Sonnet (recordatorio, no decisión)

Ajusté `PRICES['anthropic/claude-sonnet-5']` a `[2, 10]` (tarifa intro **vigente
hasta 31-ago-2026**). Es solo atribución interna de costo. **Recordatorio:**
después del 31-ago hay que revertir a `[3, 15]`. No es decisión, es una fecha que
anoto para no olvidarla.
