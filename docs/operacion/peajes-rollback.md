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

## 2. Apagar los flags por flota

No hay hoy flags por flota para atípicos, vínculos con viaje, aviso ni recordatorio de plazo: la revisión de cobros y
los atípicos van prendidos siempre que el agente esté encendido, y el aviso a la oficina sale solo cuando el cron concilia
un desglose. Hasta que existan esos flags, el único apagado granular es el del paso 1. Cuando se construyan, este paso
se actualiza con el nombre exacto de cada flag.

Lo que sí se puede desactivar por flota hoy, en `/dashboard/agentes/peajes/configuracion`:

- Los canales de entrada: buzón firmado, correo y pull.
- Las reglas de cobro por caseta (clases permitidas, casetas prohibidas) y las bajas de TAG: se editan o se quitan; sin
  reglas declaradas, la regla correspondiente no marca nada.

## 3. Migraciones 0775 a 0777: nada que revertir

Las tres son aditivas e idempotentes (`add column if not exists`, `create table if not exists`). No cambian ni borran
datos existentes.

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

Los reclamos ya creados a partir de ese desglose **no se anulan solos**. Revísalos en el seguimiento: si todavía están en
«preparado», márcalos como rechazados; si ya se enviaron al proveedor, avisa a finanzas antes de tocarlos.

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
