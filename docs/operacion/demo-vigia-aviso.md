# Demo del Vigía: aviso proactivo (guion y muestra)

Guion para enseñar el aviso proactivo del Vigía (agente 4) el 20-oct-2026 con datos **sintéticos**. Todo lo que se ve está **simulado y rotulado así**;
no hay clientes, claves ni mensajes reales. Cómo funciona el aviso por dentro: [vigia-aviso-proactivo.md](vigia-aviso-proactivo.md).

## La muestra

`scripts/demo/cinco-agentes/archivos-muestra/programa/programa_despacho_sintetico.csv`: un programa de despacho de un solo día (martes 20-oct-2026) con la
misma forma del real (título por sección y día, encabezados, `;`, la fecha dentro del título) y seis filas escritas para el guion. Lo escribe
`node scripts/demo/cinco-agentes/generar-programa-sintetico.mjs` (sin base de datos ni red); una prueba exige que el archivo sea idéntico a lo que genera
`construirProgramaDemo(1)` y que lo lea el lector real del Vigía sin avisos ni filas descartadas. Se valida antes de cargar con
`node scripts/demo/cinco-agentes/validar-archivo.mjs programa_despacho <ruta>`.

| Fila (caja) | Qué enseña | Con la regla provisional («proxy») |
|---|---|---|
| ZC1001 y ZC1002 | Caja, unidad y carta porte en listo/despachado | Listos para avisar |
| ZC1003 | Falta la carta porte (PEND CCP) | Incompleto: **no se avisa** |
| ZC1004 | Lista; en el **segundo corte** cambia la unidad (ZU2004 → ZU2099) | Listo; al volver a subir el archivo nace la versión «actualización» |
| (sin caja, unidad ZU2005) | Falta la caja | **No se avisa**; si el cliente pregunta por ese viaje, la consulta escala **en privado a servicio al cliente** |
| ZC1006 | Falta la unidad | **No se avisa** |

El cliente molesto que sube al gerente es una conversación sembrada en el tenant de demo (`scripts/demo/cinco-agentes/sql/07_vigia_y_conductor.sql`), no una fila del programa.

## Recorrido (≈ 5 min)

1. **Subir el programa** en `/dashboard/agentes/vigia/programa`: «6 filas leídas, sin descartadas».
2. **Bandeja de avisos** (`/dashboard/agentes/vigia/avisos`): los avisos de las cajas listas aparecen **cuando falta el número de horas antes de la cita que la
   flota configuró**; cada uno queda para **confirmación humana**. Los incompletos no aparecen: el sistema falla cerrado.
3. **Segundo corte:** cambiar la unidad de ZC1004 y volver a subir. La bandeja muestra la versión nueva («cambió la unidad: ZU2004 → ZU2099») otra vez por confirmación.
4. **Cliente molesto:** abrir la conversación sembrada; el Vigía avisa al gerente y a la dirección según los niveles configurados.

## Qué decir y qué no

- **Qué es:** el sistema arma el aviso del viaje (caja, unidad, operador) desde el programa que ya existe y lo deja listo para que una persona lo confirme.
  Avisa y prioriza.
- **No contesta solo.** El alcance inicial es avisar y priorizar (`vigia_config.solo_avisar`); no hay respuestas automáticas a los clientes.
- **Regla provisional.** «Listo» se decide hoy por caja + unidad + carta porte (proxy). El color del Excel solo cuenta cuando exista la leyenda real; falta el archivo.
- **No se promete:** lectura de grupos de WhatsApp en vivo (la API no los lee; ver [vigia-grupos-decision.md](vigia-grupos-decision.md)), ni priorización sobre chats
  reales de grupos, ni envío real a clientes mientras las plantillas de Meta no estén aprobadas para esos mensajes.
- **No se dice ninguna cifra de ahorro** (horas, porcentaje o dinero) como dato: no hay línea base verificada.
