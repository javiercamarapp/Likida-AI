# Entrega a Innovativos: día de conexión (liquidaciones, peajes, Carta Porte y servicio al cliente)

Estado a nov-2026: la plataforma, los cuatro agentes y el lector por consulta de bitácoras están en producción **apagados**. Nada se ha probado con datos reales de Innovativos. Este documento es el orden de encendido cuando ellos entreguen su API. Detalle técnico del conector: `conexion-tms.md` (§8.7 lista lo que falta pedirle a José Luis).

## 0. Qué debe existir antes de tocar nada

| Pieza | Quién | Cómo se comprueba |
|---|---|---|
| API de bitácoras de solo lectura, ambiente de **pruebas** y cuenta de servicio sin correo personal | Sistemas de Innovativos | Documentación + URL de pruebas por canal seguro (nunca chat) |
| Datos que la muestra no trae: póliza, nº de liquidación y de pago, tipo de operador, nº de empleado | Sistemas de Innovativos | Sin póliza, la bitácora queda retenida y no se envía (por diseño) |
| Padrón de operadores (nombre, nº de empleado, correo) cargado en la flota | Innovativos / Javier | Cada bitácora debe resolver un operador único; ausente u homónimo ⇒ revisión humana |
| Un responsable y un revisor por agente | Innovativos | Nombres escritos en el plan del piloto |
| Contraseña de la cuenta de servicio cambiada en el primer acceso | Javier | La que viajó por chat se considera expuesta |

## 1. Orden de encendido (siempre en `prueba`, nunca primero en producción)

1. **Credencial.** `/dashboard/conexiones` → ficha «API de tu sistema de transporte» → capturar dirección, usuario y contraseña con ambiente `prueba`. «Probar conexión» debe dar **sirve**. «No se sabe» es un tema de red, no de la cuenta (`conexion-tms-red.md`).
2. **Configuración del lector.** Variables de entorno del servidor (requiere redeploy): `LIKIDA_TMS_DESGLOSE_CONTRATO=muestra-tms`, `LIKIDA_TMS_MUESTRA=si`, y `LIKIDA_TMS_DESGLOSE_CONFIG` con ruta, parámetros de fecha, paginación, envoltorio y zona horaria **tal como la documentación de ellos**. Una llave desconocida o un valor fuera de rango deja el lector apagado y lo dice sin mostrar el valor.
3. **Prueba en seco** antes de encender el envío: `node scripts/tms/verificar-local.mjs --en-seco --muestra-tms` analiza una muestra sin copiar valores y dice cuántas bitácoras son mapeables y por qué fallan las demás.
4. **Interruptores.** Deben estar activos el `global` y el del agente (`agente:liquidacion`), y la flota con «Activar el envío» y canal correo.
5. **Primera ventana.** Con revisión humana de cada desglose antes de salir (piloto asistido). Revisar `/admin/escalaciones` y la bandeja de excepciones de la flota.
6. Repetir 1 a 5 por agente: peajes (posiciones GPS y reporte del proveedor), Carta Porte (solo cuando esté definida y acordada la subida), servicio al cliente (chats exportados).

## 2. Cómo se detiene

- Interruptor del agente o el general: deja de procesar y no envía nada.
- «Desactivar» en la ficha de conexiones: marca inactiva la credencial y sobrescribe el valor cifrado.
- Rollback de código: promover en Vercel el despliegue anterior (no consume build).

## 3. Qué mirar en la primera semana

- `/admin/escalaciones`: debe estar en cero salvo retenciones esperadas. El cuadro de corridas cuenta solo fallos **vigentes** (posteriores a la última corrida buena de su agente y flota).
- `/admin/salud-sistema` y el reporte diario por correo.
- Retenciones por motivo: `sin_poliza`, `operador_no_encontrado`, `operador_homonimo`, `mapeo_invalido`. Cada una nombra el campo, nunca el valor.

## 4. Lo que NO se afirma hasta tener datos reales

- Que el neto coincide con el que calcula su sistema: hoy se calcula de las percepciones y deducciones que trae la bitácora; coincidencia con el TMS se comprueba con una muestra que revisen ellos.
- Acierto de lectura de Carta Porte: se mide con 20 a 30 documentos reales, incluidos los difíciles.
- Fechas de salida: dependen de que entreguen el acceso.
