# Peajes: runbook de rollback

Para quien opera la plataforma. El objetivo es dejar el agente de Peajes como estaba **sin perder datos** y sin
tocar la base a mano. Cada paso dice cómo comprobar que quedó hecho. Documentos hermanos:
[peajes-revision-cobros.md](peajes-revision-cobros.md) y [conciliacion-peajes.md](conciliacion-peajes.md).

## 1. Apagar el agente (primer paso, siempre)

Apaga el interruptor `agente:peajes` desde la consola de Likida. Efecto:

- Las acciones de la pantalla (subir consolidado, importar y cruzar un desglose, re-conciliar, barrido de pendientes)
  se niegan y muestran «El agente de Peajes está apagado desde la consola de Likida».
- El buzón firmado `POST /api/peajes/ingesta` contesta `503` y el proveedor o la flota reintenta; el archivo no se
  pierde.
- Si el interruptor no se puede leer, el sistema falla cerrado: se considera apagado y lo registra en el log.
- Comprobación: abre `/dashboard/agentes/peajes` y busca el aviso de apagado.

El cron `/api/cron/peajes` también respeta el interruptor: en cada corrida lee `global` y `agente:peajes`. Si
cualquiera está apagado, no procesa nada: responde `{ corrio: false, saltado }` y deja un latido `saltado` en la bitácora
del agente. Si no puede leer alguno, falla cerrado (error 500 y latido `fallo`). Los archivos que ya estén en cola
esperan sin perderse y se procesan cuando el interruptor vuelva a encenderse. **No hace falta retirar el cron del
despliegue** para detenerlo. Comprobación: tras apagar, la siguiente corrida del cron aparece como `saltado`.

## 2. Apagar los interruptores por flota

A37-L-docs-ux-calidad-04: desde la migración de configuración de avisos (`peajes/config_avisos.ts`) SÍ hay dos
interruptores por flota, que **nacen apagados** y se encienden o apagan en `/dashboard/agentes/peajes/configuracion`
(bloque de plazo de reclamo y avisos):

- `aviso_plazo`: el aviso de que se acerca el vencimiento del plazo para reclamar al proveedor.
- `recordatorio_archivo`: el recordatorio de que falta el archivo del periodo.

Apagarlos detiene solo esos dos avisos para esa flota; no toca el cruce, los atípicos ni el aviso a la oficina cuando el cron
concilia un desglose. La revisión de cobros y los atípicos siguen prendidos mientras el agente esté encendido: para
detenerlo todo, el único apagado es el del paso 1.

También se puede desactivar por flota, en la misma pantalla:

- Los canales de entrada: buzón firmado, correo, pull y SFTP.
- Las reglas de cobro por caseta (clases permitidas, casetas prohibidas), el tipo de unidad por TAG y las bajas de TAG: se
  editan o se quitan; sin reglas declaradas, la regla correspondiente no marca nada.
- Comprobación: tras apagar un interruptor, recarga la pantalla y confirma que quedó en «apagado»; el siguiente barrido
  del cron ya no envía ese aviso para la flota.

## 3. Migraciones 0775 a 0866: nada que revertir

Todas son aditivas e idempotentes (`add column if not exists`, `create table if not exists`, `create or replace function`).
No cambian ni borran datos existentes. La tabla siguiente cubre las tres primeras; las posteriores (0778 a 0866: atípicos,
tarifario, tipo de unidad por TAG, unidades inmovilizadas, cruce con viaje, candidatos, SFTP, candados de idempotencia de
reclamos y notas de crédito, tope de la cola) siguen el mismo criterio y cada una trae su propia cabecera `-- REVERSA:` en
`supabase/migrations/`. Antes de revertir cualquiera, lee esa cabecera y no ejecutes nada que borre tablas con historial.

| Migración | Qué agrega |
|---|---|
| 0775 | Columnas nuevas en las líneas (clase, unidad tal como la escribe el proveedor, importe al 100 por ciento) y en el desglose (periodo oficial, número de periodo, reporte de calidad). |
| 0776 | Tablas del catálogo por nombre de caseta y de TAGs de baja. Nacen vacías. |
| 0777 | Tablas de reclamos y de notas de crédito. |

Si se apaga el agente, esas columnas y tablas quedan sin uso y no estorban. **No ejecutes `drop` ni `alter ... drop`**:
perderías el historial de reclamos y notas de crédito que finanzas ya capturó. Si de verdad hace falta deshacerlas, es una
decisión de quien administra la plataforma, con respaldo previo, no un paso de este runbook.

Antes de apagar o revertir, confirma con quien administra la base cuáles de las tres migraciones ya están aplicadas; si alguna
no lo está, el rollback de esa es simplemente no aplicarla.

## 4. Anular un desglose mal importado

Cuando se subió el archivo de otra flota, con periodo equivocado o con el proveedor mal elegido:

1. Abre el desglose en `/dashboard/agentes/peajes` y pulsa «Anular», o llama
   `POST /v1/peajes/desgloses/{id}/anular` con `{ "motivo": "..." }` (el motivo es obligatorio, 1 a 500 caracteres;
   área `administracion`).
2. Efecto: no se borra. Queda quién anuló y por qué. El desglose deja de contar en el tablero, la bitácora, las
   exportaciones, la re-conciliación y los avisos, y su archivo libera la huella para poder subir el correcto.
3. Es idempotente: anular lo ya anulado responde `yaAnulado: true`. Un desglose que no existe o es de otra flota
   responde 404.
4. Comprobación: el desglose desaparece del tablero y la respuesta trae el estado de anulado.

Los reclamos ya creados a partir de ese desglose **no se anulan solos**. Revísalos en el seguimiento:

- Si todavía están en «preparado», márcalos como rechazados.
- Si ya se enviaron al proveedor (estado «enviado»), avisa a finanzas antes de tocarlos.
- **Si ya tienen una nota de crédito registrada (estado «acreditado en parte» o «acreditado»), NO los marques como
  rechazados**: el monto acreditado y su estado se calculan sobre las notas, y rechazarlos esconde dinero que el proveedor
  ya devolvió. Es un camino conocido como problemático: deja el reclamo como está y avisa a finanzas, que decide cómo
  conciliar esa nota contra el desglose anulado.

## 5. Volver a importar

1. Con el desglose anulado, sube el archivo correcto (o el mismo, ya arreglado) por la pantalla o por el buzón.
2. Declara el periodo del archivo para que la regla de extemporáneos aplique.
3. Comprueba el reporte de calidad y que los totales coincidan con el resumen del proveedor.
4. Vuelve a crear los reclamos que correspondan; los del desglose anulado no se reutilizan.

## 6. Orden recomendado si algo sale mal

1. Apagar el interruptor (paso 1).
2. Anular el desglose afectado con motivo (paso 4).
3. Revisar reclamos ligados (paso 4, último párrafo).
4. Corregir la causa y volver a importar (paso 5).
5. Encender el interruptor y confirmar con un archivo de prueba pequeño.

## Qué no hace este runbook

No borra tablas, no revierte migraciones, no toca datos de la plataforma fuera de Peajes y no sustituye la decisión de
quien administra la flota sobre un reclamo ya presentado al proveedor.
