# Peajes: revisión de cobros del archivo decenal

Guía de operación para finanzas y para quien administra la flota. Estado: rama `loop/cinco-peajes-importador`,
migraciones 0775 a 0777, todo probado con datos sintéticos y sin aplicar a ninguna base remota. Lo que todavía
no existe está marcado «No construido» en la última sección: no lo prometas a nadie.

Documento hermano del contrato técnico: [conciliacion-peajes.md](conciliacion-peajes.md). Para apagar o deshacer:
[peajes-rollback.md](peajes-rollback.md).

## Para qué sirve

El proveedor de peaje manda cada diez días un archivo con todos los cruces de la flota y una factura sin detalle.
La revisión lee ese archivo **tal cual llega**, marca los cobros que merecen una pregunta al proveedor y lleva la
cuenta de lo reclamado y de lo que el proveedor acredita. No acusa de nada: cada marca es un **candidato**.

## Subir el archivo decenal «tal cual»

1. Entra a `/dashboard/agentes/peajes` y sube el Excel del proveedor sin editarlo (no borres filas de total, no
   cambies encabezados, no lo conviertas a CSV). Por el buzón firmado, el correo y el pull configurable entra por la
   misma lectura (detalle en el contrato técnico).
2. Opcional pero recomendado: declara el **periodo del archivo** (inicio y fin). Si no lo declaras, se toma del
   nombre del archivo (por ejemplo «01 A 10 DE SEPT»). Si el nombre tampoco lo dice, la regla de cobros
   extemporáneos **no se aplica** y la pantalla lo avisa; no se inventa un periodo.
3. El lector elige la hoja principal, repara acentos dañados en los nombres de caseta y guarda un **reporte de calidad**
   del archivo: filas leídas, columnas reconocidas y no reconocidas, líneas sin TAG, sin unidad, sin clase o sin hora,
   y hojas ignoradas. Si falta algo, el reporte lo dice con la columna; vuelve a subir el archivo correcto.
4. Subir el mismo archivo dos veces no duplica nada (misma huella sha256 por flota).
5. Un archivo subido por error se **anula** con motivo (ver el runbook de rollback) y se vuelve a subir el correcto.

## Qué hace cada regla

Todas son puras (sin red ni base) y viven en `src/lib/likida/peajes/reglas_cobro.ts`. Cada marca lleva el rótulo
«Candidato: validar con el proveedor».

| Regla | Cuándo marca | Qué necesita de la flota |
|---|---|---|
| Clase distinta de 3 y 5 | La clase de cobro del renglón no es 3 (tracto solo) ni 5 (tracto con caja de dos ejes), salvo las clases que la flota declare válidas para esa caseta. | Opcional: clases adicionales válidas por caseta (por ejemplo la clase 1 en casetas de tarifa por pasada). |
| Cobro extemporáneo | La fecha del cruce es anterior al inicio del periodo del archivo. | El periodo del archivo (declarado o del nombre). |
| Cobro duplicado exacto | Mismo TAG, mismo segundo, misma caseta y mismo importe. Es distinto del «posible doble cobro» del reporte de reclamación (mismo TAG y caseta en 10 minutos o menos), que puede ser un retorno. | Nada. |
| TAG dado de baja | El cruce es posterior a la fecha de baja del TAG. | La lista de TAGs de baja con su fecha. |
| Caseta que no debe cruzarse | La caseta está en la lista de casetas prohibidas de la flota. | La lista de casetas prohibidas. |

Además, la revisión muestra **cruces atípicos** (misma caseta muchas veces en pocas horas, horario anómalo, dos casetas
lejanas en muy poco tiempo). Son señales para mirar, no reclamos.

Sin el tarifario por caseta y clase no se puede afirmar cuánto debió costar un cruce: la revisión dice «candidato» y
nunca «cobro indebido» ni un importe a favor.

## Candidato frente a confirmado

- **Candidato**: el dato del archivo cumple una regla. Es una pregunta para el proveedor.
- **Confirmado**: el proveedor lo reconoció y acreditó. Eso se registra en el seguimiento de reclamos (abajo) con la
  nota de crédito. Hasta entonces nada se llama «cobro indebido» en pantalla, en Excel ni en PDF.
- Una línea sin el dato que la regla necesita (sin clase, sin fecha, sin periodo) no se marca: se cuenta aparte para
  saber qué dato falta.

## Cargar el catálogo de casetas y el tarifario

- **Catálogo por nombre** (migración 0776): los nombres salen del propio archivo del proveedor y se registran al
  importar. Sobre cada nombre la flota declara clases permitidas y si la caseta no debe cruzarse. Nace vacío: no
  viene ninguna regla precargada. Se edita en `/dashboard/agentes/peajes/configuracion`, sección de reglas de cobro.
- **Coordenadas** (opcionales): se cargan por CSV con la plantilla `src/lib/likida/peajes/fixtures/catalogo_casetas_plantilla.csv`
  (datos sintéticos). Sin coordenadas, el cruce con GPS y la señal de «dos casetas lejanas» dicen «sin datos»; nunca
  se inventan coordenadas.
- **TAGs de baja**: se dan de alta con TAG y fecha en la misma pantalla y se quitan si fue un error.
- **Tarifario**: No construido (depende de que el proveedor lo entregue). Mientras tanto no hay importes esperados.

## Configurar atípicos y destinatario

- **Atípicos**: hoy corren con los valores por omisión (cuatro cruces de la misma caseta en seis horas, velocidad máxima
  plausible de 130 km/h, cinco minutos mínimos entre cruces; sin franja de horario anómalo). No hay pantalla para
  cambiarlos: los umbrales existen en código (`UMBRALES_ATIPICOS_DEFAULT`) y se validan con `validarUmbrales`.
  Configurarlos por flota es trabajo pendiente.
- **Destinatario del aviso**: hoy el aviso a la oficina de cobros sin respaldo o con GPS que no coincide va por
  WhatsApp a quien ve dinero (dueña o dueño, o contador; nunca al encargado). Elegir otro destinatario o canal por
  flota es trabajo pendiente.

## El plazo de reclamo

El proveedor acepta reclamos durante **tres meses** contados desde el cobro más antiguo incluido en el reclamo.
El sistema lo calcula al leer, contra el reloj, y no lo guarda:

- Estado del reclamo: preparado, enviado, acreditado parcial, acreditado, rechazado.
- Alerta **por vencer** cuando faltan 30 días o menos; **vencido** cuando el plazo ya pasó.
- Acciones en la pantalla: crear el reclamo de una categoría de candidatos, marcarlo como enviado (con la referencia
  del portal del proveedor), registrar cada nota de crédito (monto y referencia; varias notas se acumulan) y marcarlo
  como rechazado.
- El reclamo se presenta por el portal del proveedor: Likida no lo envía.

## Cierre mensual

La pantalla de revisión agrupa los archivos por mes (según el periodo oficial de cada uno) y muestra el resumen por
decena. Los cobros tardíos de un mes anterior se listan aparte. El mes no se «cierra» de forma automática: es una
vista para que finanzas vea que están las tres decenas y qué falta.

## Qué queda oculto o apagado

- Lo no construido (tarifario, vínculos con viaje, recordatorio de plazo, configuración de atípicos y de destinatario)
  no tiene pantalla ni botón: no hay nada que ocultar.
- Con el interruptor `agente:peajes` apagado, ninguna acción de subir, importar, conciliar o barrer corre y la pantalla
  lo avisa. Lo ya guardado no se pierde.
