# Agente 7 — Cobranza por gasto

> Estado (2-oct-2026, rama `loop/w3-buzon-cobranza-reglas`): **cerrado en código, no en campo.**
> Migración **0525** probada contra Postgres 17 local (cadena 0001..0531); **no aplicada a ninguna base real**.

## Qué hace

La cobranza por viaje (0089) sigue igual: «llevas N días con el viaje F-1042 sin mandarme comprobantes». La propuesta prometía
«falta comprobar un gasto». Con `por_gasto` encendido (por flota, **nace apagado**) el agente cobra **qué comprobante falta de qué gasto**:

- por cada gasto sin foto, sin CFDI (según el concepto), con foto de lectura dudosa o con CFDI no vigente;
- cadencia escalonada **por gasto** (días desde que se capturó; por omisión 1, 3 y 7);
- **un solo mensaje por chofer** con todos sus gastos pendientes (fusión) y **tope diario** (1 a 3) — lo que no cabe espera a mañana sin consumir tier;
- ventana horaria y días de la flota (los mismos de la cobranza por viaje);
- **fuera de la ventana de 24 h de WhatsApp** el mensaje sale por la plantilla `cobranza_gastos_v1` vía `enviarConFallback`;
- la cobranza por viaje **no duplica el día**: se salta los viajes con gastos pendientes y a los choferes a los que ya se escribió hoy;
- **efectividad**: un barrido marca como resuelto lo que dejó de faltar y el tablero mide qué porcentaje de avisos produjo el comprobante y en cuánto tiempo.

## El ciclo (criterio a–i)

| | Eslabón | Dónde |
|---|---|---|
| a | Entrada real | El chofer manda foto/XML por WhatsApp (flujo existente); la cobranza lee los gastos y sus comprobantes reales. Configuración en `/dashboard/agentes/cobranza`. |
| b | Lógica | `cobranza_gasto_pura.ts` (motivo, plan, fusión, tope, mensaje, efectividad) — pura, sin base. |
| c | Persistencia con RLS | `agente_cobranza_config` (+columnas 0525) y `cobranza_gasto_contacto` (una fila por gasto y tier). Unique (gasto, tier) = el claim; FK compuesta; RLS deny-all + `service_role`; retención 180 días. |
| d | Salida | `enviarConFallback` (texto si la ventana está abierta; plantilla `cobranza_gastos_v1` si no). |
| e | Cron con claim | Corre dentro de `ejecutarCobranza` (el cron existente). El lote se reclama en **un INSERT atómico** (todo o nada) **antes** de mandar; un rechazo reintentable libera el claim, uno permanente consume el tier con su porqué. Corte por reloj antes de reclamar. |
| f | UI sin botones muertos | Sección «Cobranza por gasto» (config con vista previa en vivo del mensaje real, cola de hoy, tablero de efectividad); una lectura caída se dice, no se pinta vacía. |
| g | Pruebas | `cobranza_gasto_pura.test.ts`, `cobranza_gasto_e2e.test.ts` (24 casos: feliz, Meta permanente/reintentable, duplicado, fuera de ventana/tope, otro tenant, sin teléfono, convivencia con la de por viaje, **base sin migrar**), `supabase/tests/0525_cobranza_por_gasto.sql`. |
| h | Integración externa | Solo WhatsApp (Meta), detrás de `enviarConFallback` con dobles. |
| i | Documentación | Este archivo y `plantillas-meta.md` (`cobranza_gastos_v1`). |

## Contra una base sin migrar

Sin las columnas de la 0525 la configuración por gasto cae a **apagada** (con un aviso en el log) y la cobranza por viaje corre como siempre, sin fallos.

## Bloqueos externos

- **Plantilla `cobranza_gastos_v1`** aprobada en Meta (texto en `plantillas-meta.md`, sin verificar contra Meta) y número/WABA reales.
- **Autorización de Javier** para aplicar la 0525 a la base real.
- Datos reales de gastos y choferes de Innovativos para ajustar la cadencia, el tope y los conceptos que exigen CFDI (hoy diésel y caseta; heurística declarada).

## Pendientes reales

- La cadencia se mide en días naturales desde la captura del gasto, no en días hábiles.
- El tablero mide efectividad sobre 30 días; no hay comparativo contra la cobranza por viaje.
