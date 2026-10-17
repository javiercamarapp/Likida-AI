# Runbook de conexión al sistema de transporte de la flota (solo lectura)

Estado: **procedimiento escrito; no se ha conectado ninguna flota real.** Hoy no existe credencial ni documentación de la API de ninguna flota (BLOQUEO EXTERNO: ver `docs/operacion/conexion-tms-red.md` para la red). Este documento dice qué pedir, cómo capturar, probar, desactivar y revertir. Se refiere siempre al «sistema de la flota»; no lleva nombres de personas ni de empresas.

Ficha del catálogo: `tms_api_lectura` (`src/lib/likida/conectores/erp.ts`). Solo lectura: Likida no escribe nada en el sistema de la flota.

## 1. Qué se le pide al área de sistemas de la flota

### 1.1 Lo que pide la ficha (se genera del catálogo)

El bloque siguiente es copia exacta de `loQuePedirle(['tms_api_lectura'])`. Una prueba (`ficha.test.ts`) lo compara con la función: si cambian los campos de la ficha y no este bloque, la prueba falla.

<!-- BEGIN:lo-que-pedirle -->
```text
La API de lectura de tu sistema de transporte:
  · Dirección de la API de tu sistema de transporte. La que te da tu área de sistemas. Tiene la forma https://api.tuempresa.com — sin la ruta del login.
  · Usuario de servicio. Una cuenta de servicio de solo lectura creada para Likida. No uses el correo ni el usuario de una persona.
  · Contraseña de la cuenta de servicio [SECRETO — mándalo por un canal seguro, no por chat]. La de esa cuenta de servicio. Se guarda cifrada y no se vuelve a mostrar.
  · Ruta del inicio de sesión (opcional). Déjala vacía si no te dieron una. Por omisión se usa /api/login.
  · Ambiente (opcional). Escribe prueba o produccion. Conviene empezar por el ambiente de prueba si tu equipo de sistemas lo tiene.
```
<!-- END:lo-que-pedirle -->

Los campos marcados **[SECRETO]** nunca se mandan por WhatsApp ni se pegan en un correo; se entregan por un canal seguro y se capturan directo en el panel (sección 2).

### 1.2 Lo que la ficha no cubre y hay que pedir por escrito

1. **Documentación del inicio de sesión y de cada recurso** que se va a leer (liquidaciones, peajes por fechas, viajes e hitos, posiciones): ruta, método, parámetros, forma de la respuesta y un ejemplo de respuesta con datos de prueba.
2. **Cuenta de servicio de SOLO lectura**, creada para Likida, **sin correo personal** y sin permisos de escritura.
3. **Ambiente de prueba** separado del de producción (se empieza siempre por él).
4. **Límites de tasa:** peticiones por minuto permitidas, tamaño máximo de página y si hay ventana de mantenimiento.
5. **Zona horaria de las fechas** que devuelve la API (con y sin zona explícita). Por defecto Likida interpreta fechas sin zona como `America/Mexico_City` y guarda UTC; si la API usa otra, se declara en el mapeo.
6. **Semántica de `Icident`:** si identifica un viaje completo, un tramo o un tracto-día, y si se repite entre días. Mientras no se confirme, Likida lo guarda como `despacho_ref` sin exigir unicidad estricta.
7. **Qué devuelve ante token vencido o inválido** (código y cuerpo) y cuánto dura un token, para que el re-login no confunda un vencimiento con una credencial mala.
8. **Cómo se marca «consumido»:** si existe un campo de consumo y **quién lo escribe** (el sistema de la flota o Likida). Hasta que se defina, Likida es idempotente por su cuenta (huella por registro) y **no escribe** nada de vuelta.
9. **Red:** si el sistema está detrás de un firewall o Zero Trust, qué IP de salida hay que autorizar. Ver `conexion-tms-red.md` (opciones y costos; la decisión y el gasto son de la persona responsable de Likida).

## 2. Cómo se da de alta la credencial

1. Entrar a `/dashboard/conexiones` con un usuario administrador de la flota.
2. Elegir la ficha «API de tu sistema de transporte» (`tms_api_lectura`).
3. Capturar dirección, usuario de servicio, contraseña y, si se dieron, ruta de login y ambiente (**empezar con `prueba`**).
4. Guardar. La contraseña se cifra por flota; **el panel no la vuelve a mostrar** ni la devuelve en ninguna respuesta. Para cambiarla se captura de nuevo.
5. No hay otra vía: no se pega en chat, correo, tickets ni commits. Si una credencial se pegó en algún chat, se considera expuesta: pedir su revocación y emitir otra.

## 3. Cómo se prueba

1. En la misma ficha, «Probar conexión». Hace **un login y una lectura de bajo costo**; no escribe nada.
2. Lectura del veredicto:
   - **sirve:** login y lectura respondieron bien.
   - **no sirve:** credencial rechazada (401) o acceso negado por IP (403, «probable lista de IP permitidas»).
   - **no se sabe:** no se pudo comprobar (DNS, tiempo agotado, servidor que rechaza la conexión, redirección, página de acceso web en vez de la API, 5xx). **Esto no significa que la credencial sea mala.**
3. Si sale «no se sabe» por red: es un tema de red, no de la cuenta. Seguir `conexion-tms-red.md`.
4. El detalle del resultado nunca contiene la contraseña, el usuario ni el token.
5. Solo con la prueba en **sirve** en `prueba` se pasa a `produccion` (se captura otra credencial/ambiente y se repite la prueba).

## 4. Cómo se desactiva (cortar el acceso)

1. En `/dashboard/conexiones`, «Desactivar» sobre la ficha. Internamente llama a `desactivarCredencial`: marca la credencial inactiva **y sobrescribe el valor cifrado con un marcador de revocación**, de modo que no se puede volver a abrir aunque la llave del cofre se filtrara después.
2. Reactivar es **capturar de nuevo** la credencial; no hay forma de «deshacer» la desactivación.
3. Si el sistema de la flota también debe revocar la cuenta de servicio, se le pide a su área de sistemas por separado; desactivar en Likida no la elimina allá.

## 5. Cómo se revierte la conexión completa

En este orden, parando primero lo que lee:

1. **Apagar la lectura periódica para esa flota.** El sincronizador del conector (tarea T-TMS-12, que se construye después de esta) debe quedar sin credencial activa y sin mapeo activo para la flota; con eso no lee. Si al momento de revertir el cron ya existe y corre, se excluye a la flota de su lista antes de continuar. *Pendiente de confirmar al cerrar T-TMS-12: nombre exacto del interruptor.*
2. **Desactivar la credencial** (sección 4).
3. **Desactivar el mapeo activo:** en la tabla `tms_mapeo` poner `activo = false` en la fila activa de cada recurso de la flota (las versiones se conservan como historia; no se borran filas). Se hace con un script del servidor, no con el panel.
4. **Estado de lectura:** `tms_sincronizacion` (cursor y última lectura por recurso) y `tms_ingesta` (huellas de lo ya visto) **se conservan**: así una reconexión posterior reanuda sin duplicar. Solo se vacían por orden expresa y respaldo previo.
5. **Datos ya importados** (viajes, peajes, liquidaciones con origen `tms`): no se borran al revertir. Si hubiera que retirarlos, es una tarea aparte con respaldo y autorización; la reversión del conector no toca datos de negocio.
6. Registrar en la bitácora de la operación la fecha, quién ordenó la reversión y por qué.

## 6. Qué NO hace este conector

- No escribe en el sistema de la flota, ni siquiera el campo de «consumido».
- No usa cuentas personales.
- No se prueba contra producción primero.
- No publica credenciales ni respuestas crudas en bitácoras: los errores son frases propias.
