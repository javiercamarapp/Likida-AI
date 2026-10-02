# Hallazgos 28–30 de la auditoría ola 1 — estado (Ola 9, 2-oct-2026)

Fuente: `~/likida-loop/hallazgos-ola1.json` (59 hallazgos, dimensión `agentes-integraciones`). **La cola cita «28-30» con numeración
desde 0** (la misma que usan `pendientes-seguridad-w2.md`: «CSP (4)», «flood (19)», «retención (22)»): son los índices 28, 29 y 30 =
posiciones 29, 30 y 31 contando desde 1. El de la posición 28 (alerta del token de WhatsApp vencido, índice 27) ya estaba cerrado por
W2 y se verifica abajo para que ninguna de las dos lecturas deje un hueco. No existen carpetas `docs/auditoria-28/29/30` en esta rama:
las rondas de auditoría 28–30 viven en `master` y son otra serie (informes de seguridad, no estos hallazgos).

| # (desde 0) | Hallazgo | Estado | Evidencia |
|---|---|---|---|
| 27 | Token de WhatsApp vencido (Meta 190) sin aviso ni cola | **Cerrado en código** (W2) | `fix(whatsapp)` `df50540a`: `alFallarPorToken` avisa al operador (piso de 1 h), encola la salida y el cron `wa-outbox` sondea antes de reclamar; `src/lib/meta/token_vencido.test.ts`. Falta externo: token de USUARIO DEL SISTEMA permanente en Meta. |
| 28 | ERP `api_en_vivo` (SAP B1, Oracle, Odoo) solo prueba el login; capacidades de escritura declaradas sin consumidor | **Cerrado como HONESTIDAD; la construcción sigue abierta** (8 días + instancia real) | Ola 9: las tres fichas dicen que hoy solo comprueban la credencial y qué falta (`erp.ts`), `resumenHonesto()` lo declara, `CAPACIDADES_SIN_EJECUTOR` (`tipos.ts`) y la prueba de contrato `capacidades_con_ejecutor.test.ts` fallan si alguien declara una capacidad de escritura sin ejecutor o construye uno sin actualizar la lista. El camino que funciona es el archivo (póliza TXT/CSV). |
| 29 | Autofactura de casetas/combustible inoperante (19 guiones sin verificar, CAPUFE sin observar) | **Cerrado en código por W3; verificación real pendiente** | `9bdd8331` (graduar portales con fixtures y arnés contra el portal real), `4d0bbe72` (vinculación asistida, 0540), `93285d79` (control de emisión real por flota con lote supervisado y cupo, 0542), `fc7a17a3` (aceptación del mandato). `verificado: null` sigue en los guiones: pasar a `true` exige el pre-vuelo supervisado contra el portal real (`docs/operacion/verificacion-portales.md`, `docs/encender-emision.md`) y la cláusula del mandato publicada. La retención de lotes/cupos (0542) ahora la ejecuta `/api/cron/purgar`. |
| 30 | GPS: 4 proveedores con API sin verificar contra instancia real; cron eventos+posiciones en un solo presupuesto | **Parcial: código hecho, medición y verificación reales pendientes** | Lectores Wialon/Geotab/Navixy/Samsara y lector de tabla propia con fixtures de contrato (`conectores/posiciones_proveedores.ts`, `tabla_propia/`); `cron/gps` corta por deadline (`venceEn`) y deja el resto a la corrida siguiente. Falta: confirmar el proveedor del cliente, verificar su autenticación/paginación con una cuenta real, medir el cron con 250 unidades y, si no alcanza, separar eventos de posiciones en dos crons. Nada de eso se puede hacer sin credenciales reales. |

## Lo que queda para una persona

1. **28**: una instancia real de SAP/Oracle/Odoo + la ruta de red que abra su área de sistemas, y entonces construir el escritor
   (`JournalEntries` / `PurchaseInvoices` del Service Layer) y sacar la capacidad de `CAPACIDADES_SIN_EJECUTOR`.
2. **29**: correr el pre-vuelo supervisado de peajes y diésel, graduar `verificado` con evidencia, publicar la cláusula del mandato.
3. **30**: credenciales de lectura del GPS del cliente; medir el cron.
