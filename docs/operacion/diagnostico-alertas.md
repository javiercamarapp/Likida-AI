# Diagnóstico de solo lectura de alertas (F14-C)

Bandera: `DIAGNOSTICO_ALERTAS=encendido` (apagada por omisión; ver `banderas.md`). Tope: US$20 al mes (`DIAGNOSTICO_TOPE_USD`).

- Cuando la guardia ve una alerta S1/S2 NUEVA, lee (solo lectura) latidos, bitácora y el contexto de la alerta, redacta datos personales y pide al modelo un JSON: causa probable, confianza (`inconclusivo` es válido; sin cita no hay causa raíz), evidencia citada y arreglo PROPUESTO.
- El resultado es una pieza `diagnostico_alerta` en `/admin/aprobaciones` (agente `especialistas_incidente`). Aprobar = lo acepto como diagnóstico; rechazar = lo descarto. Ninguna ejecuta nada.
- Nunca ejecuta, ni toca dinero, datos personales, fiscal ni su propia autonomía (el arreglo que roce esas clases lleva la marca «lo decide el dueño»).
- Gasto: cada llamada se anota en `agente_corrida.costo_usd` (`resumen.origen = diagnostico_f14`). Una llamada fallida anota la cota de costo, nunca cero. Al llegar al tope: estado `tope` en el latido de `guardia`, un correo al operador y la campana; deja de llamar al modelo. Si el gasto no se puede leer (error o alguna fila sin costo): `gasto_ilegible`, no llama y la campana lo dice.
- Máximo 2 diagnósticos por pasada de 5 min y una sola vez por alerta (huellas en el latido).
- Límite honesto: no lee los logs de Vercel (no hay fuente en el servidor); las piezas pendientes cuentan para la contrapresión de la bandeja, por eso el tope de gasto y el máximo por pasada importan.
