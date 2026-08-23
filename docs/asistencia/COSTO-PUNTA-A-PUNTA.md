# Costo de punta a punta — inventario (23-ago-2026)

## MARCO: hoy no hay nada que medir
`llm_costo` está VACÍA en producción (0 filas). gasto=0, liquidacion=0, viaje=1, tenant=1.
**El ciclo del producto nunca ha corrido en esta base.** Lo que sigue es arquitectura del código
+ los dos únicos puntos con medición real.

## Solo 8 archivos llaman al modelo en todo el repo
ocr.ts:327 (ocr) · agents/run.ts:60 (cuadre) · analista.ts:316,367 (chat) · copiloto.ts:199,228
(analisis) · mapa-prospectos/mensaje/route.ts:86 (marketing) · redactor.ts:174 (back_office) ·
piloto_vision.ts:364 (piloto) · computer_use.ts:252 (código MUERTO, sin llamador).
**Cualquier fase que no aparezca ahí es determinística y cuesta $0 de modelo.**

## Fases con CERO costo de modelo (confirmado)
Onboarding · Conciliación de consolidados (xlsx/fast-xml-parser) · Correo entrante (el PDF ni se
parsea) · Cobranza (plantilla pura; el agente tiene modelo_rol NULL y sus 12 corridas tienen
costo NULL) · Informes y avisos (salvo la pregunta libre) · 7 de los 10 agentes vivos.

## Costos unitarios
| Fase | Consumo | Unidad | USD |
|---|---|---|---|
| Intake OCR | 1 visión POR FOTO (el emparejamiento se revirtió el 1-ago a propósito) | foto | **0.0015** MEDIDO |
| Intake sin override | default gemini-3.6-flash | foto | **0.0176 (×11.7)** |
| Cuadre | claude-sonnet-5, 2-10 llamadas, escala con comprobantes (21 comprobantes = ~72,000 tokens de entrada en 8 vueltas) | liquidación | 0.03-0.05 (banda de julio) |
| Adquisición | gpt-5.6-luna, 1 llamada = 3 piezas | prospecto | ~0.0007 |
| Redactor | gpt-oss-120b, 1 completion | pieza | **0.000507 MEDIDO** (n=38) |
| Chat panel | ≤9 completions | turno | ~0.005 (tope $1/día) |
| Copiloto | ≤9 completions | turno | ~0.01 (tope 300 turnos) |
| **Piloto de facturación** | claude-sonnet-5, **1 visión POR PASO**, ≤14 pasos | **ticket** | **0.15-0.27 — 100× el OCR** |
| PDF | pdf-lib en proceso | liquidación | 0 |

## EL CEREBRO DE VENTAS HA CORRIDO POR API UNA SOLA VEZ
De 6,641 mensajes generados: **6,595 con Claude Code por suscripción (costo API $0)**, 38 agente
local, 7 fable, **1 por API**. Generar los 26,430 restantes por API costaría **~$18 una sola vez**.
No hay cadencia ni envío automático: el toque se REGISTRA, el envío es manual.

## LOS 5 AGUJEROS
1. **La pregunta libre por WhatsApp no tiene techo NI medición** (`oficina_wa.ts:161`). Corre el
   MISMO analista del panel (≤9 completions con tools) pero **descarta r.costoUsd** y **no consulta
   topeDiaUsd()**. En el panel se frena a $1/día por tenant; por WhatsApp no hay freno. Un dueño
   preguntando por WhatsApp gasta sin límite y sin rastro. **Es el único camino de LLM sin freno.**
2. **El piloto de facturación es 100× el OCR y no deja rastro**: $0.15-0.27/ticket calculados,
   cero `registrarCosto`, cero log de costo. Y OJO: **en modo ensayo el costo se paga completo**
   (el navegador arranca y el modelo decide igual; solo no aprieta emitir).
3. **El override de OCR es un punto único de falla de ×11.7** y vive solo en Vercel.
4. **85 de 87 envíos de WhatsApp no se registran.** `registrarCostoWhatsApp` se llama en 2 sitios
   (say() y el PDF). No cuentan: plantilla de asignación, despacho, informes, aviso de privacidad,
   talacha (hasta 4 por avería), escalación, cobranza, aviso de cierre, botones.
   **Y dejan de ser gratis el 1-oct-2026.**
5. **La máquina de adquisición está PARADA** desde el 18-ago: `cola_aprobacion` tiene 20 filas
   pendientes = el tope de contrapresión. No es por costo (el máximo posible del runner es
   $0.015/día contra un presupuesto de $1): es por aprobación humana.

## Otros hallazgos
- **El runner corre exactamente UN agente**: 4 guardas y solo `redactor` las pasa.
- **QA usa `processInbound` de PRODUCCIÓN** (`qa-motor.ts:29`): cada corrida gasta OCR y cuadre
  reales y contamina el costo unitario con el tenant ZZZ QA.
- **Dos roles muertos**: `chat_ligero` (el conserje se colapsó el 12-ago) y `router` (no hay un
  solo runAgent orchestrator; la clasificación es 100% regex).
- **GPS**: los conectores (Wialon, Samsara, Geotab, Navixy) **solo implementan probar()**. No hay
  ingesta de posiciones. `posicion` tiene un solo escritor: el pin manual de WhatsApp.
- **Caché de prompt medida: −91.6%** en la segunda llamada con el mismo system.
- Infra: 47,010 invocaciones/mes de crons de piso aunque no haya clientes; el webhook es el 90%
  del cómputo y de eso la mayoría es ESPERAR al modelo de visión; cada 1,000 viajes/mes ≈ 29-66 GB-h.
