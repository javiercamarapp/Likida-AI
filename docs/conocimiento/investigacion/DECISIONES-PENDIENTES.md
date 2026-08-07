# Decisiones pendientes de Javier

Cosas que requieren criterio de producto/negocio o credenciales que no tengo, y
que **no adiviné** durante el trabajo autónomo. Cada una con opciones y mi
recomendación. (HARD RULE 4 y 5.)

---

## 1. Flags del demo — ✅ YA ENCENDIDOS (por tu indicación)

Los encendí en `.env.local` (entorno local del demo). El camino "verificado"
ahora corre **con los flags ON**.

| Env | Valor puesto | Qué hace |
|-----|--------------|----------|
| `CUADRA_INTAKE_GRACE_MS` | `2000` | Gracia anti-carrera fotos+"listo" en el mismo lote. |
| `CUADRA_RECUPERAR_CIERRE_PARCIAL` | `1` | Recupera el "huérfano de cierre" (guarda OK pero el ciclo murió). |
| `CUADRA_DEDUP_FOTOS` | `1` | Dedup de fotos por SHA-256 (reenvíos manuales). |
| `CUADRA_INTAKE_ESPERA_MS` | `20000` | Acota el peor caso de la barrera bajo el tope de Vercel. |

**Pendiente cuando despliegues:** replicar estas 4 envs en el entorno de Vercel
(hoy no hay proyecto de este repo en Vercel; el demo corre local). Validación
offline hecha: `barrera.test.ts` (ráfaga) + `injeccion.test.ts` (12 casos) + 97
tests verdes. Falta la corrida **en vivo** (LLM+WhatsApp) del flujo completo ×3
→ va al checklist manual pre-demo (no es reproducible headless).

---

## 1b. ⚠️ RIESGO ABIERTO — `maxDuration` vs plan de Vercel

Subí `maxDuration` a 120 y tú advertiste bien: en **Hobby** el tope duro es 60s y
Vercel **ignora** valores mayores; 120/300 solo en **Pro con Fluid Compute**. No
pude confirmar el plan por API (la cuenta es un team personal → default Hobby).
**Revertí a 60** para no asumir margen inexistente.

- **Si confirmas Pro + Fluid Compute** (Vercel → Project → Settings → Functions →
  Fluid Compute ON): sube `maxDuration` a 120 en `route.ts`.
- **Si es Hobby:** queda en 60. El peor caso teórico (lock+barrera+cuadre >60s) NO
  cabe → el camino fiable es el común (~30s: OCR rápido + cuadre). El fix real del
  peor caso es mover el procesamiento pesado a **QStash** (ya es dependencia) en
  FASE 3. Mientras, `CUADRA_INTAKE_ESPERA_MS=20000` acota la barrera.

**Acción tuya:** confirmar el plan (2 clics en Vercel) y avisarme para subir o no
`maxDuration`, o decidir si priorizamos el offload a QStash en FASE 3.

---

## 2. ✅ RESUELTO — Slugs de fallback de OpenRouter verificados

Los verifiqué contra el catálogo (`GET /api/v1/models` con tu clave, lectura sin
costo): **los 7 existen** (primarios + fallbacks). El fallback cross-provider es
válido. Nada que hacer.

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
