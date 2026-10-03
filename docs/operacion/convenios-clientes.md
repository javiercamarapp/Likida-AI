# Convenios de clientes e instrucciones de operación (0580)

Todo nace del convenio: el punto A→B de un cliente con la flota, su tarifa, los requisitos de cobro y las
**instrucciones de operación** (la «calle de instrucciones»): por dónde entrar, con quién reportarse, peculiaridades
de la planta, qué documentos llevar. Hoy eso vive en la cabeza del despachador y se le dicta al operador por teléfono.
Este módulo lo vuelve dato: el operador lo recibe por WhatsApp cuando le toca, y la flota lo puede llevar a su propio
sistema.

> Estado: **código completo y probado contra una base en memoria y contra Postgres 17 efímero; nada aplicado en
> producción.** Falta aplicar la migración 0580 (ver «Qué falta»). Sin ella, los viajes se despachan como siempre.

## El camino completo

1. **Perfil.** En `/dashboard/convenios` (o importando un archivo) la flota registra, por cliente, uno o más
   convenios: punto A y B (texto y, opcionalmente, sitio del catálogo de geocercas), vigencia e instrucciones.
   Cada instrucción lleva una **categoría** (puerta, reportarse, peculiaridad, documentos, horario, seguridad, otro),
   un **momento** (`despacho`, `acercamiento`, `ambos`) y un **lugar** (planta de `origen`, de `destino` o `ambos`).
   La tarifa y los requisitos de cobro viven en una tabla aparte, visible solo para quien ve finanzas.
2. **Al despachar el viaje** (`crearViaje`, después del aviso del viaje): se elige el convenio del cliente
   (regla escrita en `convenios/seleccion.ts`), se **fotografían** sus instrucciones vigentes en `viaje_convenio` y se
   le mandan al operador las de momento `despacho`/`ambos`. Si el viaje no traía sitios de catálogo y el convenio sí,
   se los pasa (solo donde estaban vacíos) para que el Conductor pueda validar y acercar contra esa planta.
3. **Al acercarse a la planta** (cron `conductor-hitos`, `convenios/acercamiento.ts`): si la última posición del tractor
   está a menos de *radio de la geocerca + margen de acercamiento* de la planta que toca (el margen es de cada flota,
   `margenAcercamientoM` en la configuración del Conductor, de 0 a 50,000 m; 5 km de partida) (la de carga hasta que sale de cargar; luego la
   de descarga), se le mandan **solo** las instrucciones de acercamiento de esa planta, **una vez por planta** (cada planta
   tiene su propio sello: llegar a la de carga y luego a la de descarga son dos avisos).
4. **«¿Por dónde entro?»** (`convenios/pregunta.ts`, en el processor antes del Conductor y del agente): el operador
   pregunta por la puerta, con quién reportarse, documentos, horario o «qué instrucciones tengo» y se le responde con el
   perfil de la planta que está atendiendo. Es determinista (lista cerrada de frases), sin modelo.
5. **Exportación para el sistema de la flota** (`/api/export/convenios`): CSV de instrucciones **sin dinero** (el mismo
   formato del importador, se vuelve a subir tal cual), texto por convenio para pegar en el campo de instrucciones de
   su sistema, y —solo con permiso de finanzas— el completo con tarifa y cobro.

## Reglas que no se rompen

- **El agente solo dice lo que el convenio dice.** Sin instrucciones registradas (o del tema preguntado), lo dice y
  remite al jefe de tráfico; nunca inventa una puerta. Un viaje sin cliente, sin convenio o con varios convenios
  empatados sin coincidencia **no recibe nada** (mandar la puerta de otra ruta es peor que no mandar).
- **La foto no cambia sola.** Editar el convenio después no cambia lo que ya se le dijo a un operador en ese viaje, salvo que quien edita lo pida expresamente (ver «Alta y edición en pantalla»).
- **Un solo envío por viaje, momento y planta.** El envío se reclama con un `UPDATE` condicionado *antes* de mandar
  (`reclamarEnvio`): dos corridas del cron o dos gestos no duplican el mensaje. Un reclamo que lleva más de 10 minutos
  sin cerrarse se considera caído y se puede volver a tomar. Un rechazo reintentable de Meta libera el reclamo; uno que
  no lo es (plantilla sin aprobar, número inválido) lo deja puesto y queda en el log.
- **Nunca deshace el despacho.** `despacharInstrucciones` y `acercarInstrucciones` no lanzan: un convenio mal capturado,
  una base sin migrar o un WhatsApp caído se loguean y se dicen en el resultado.
- **El dinero no sale de finanzas.** La tabla `convenio_comercial` solo la lee `ve_finanzas()` (en la base y en la
  pantalla); para quien no lo ve, la tabla ni se consulta. La exportación «para el sistema de la flota» nunca lo lleva.
- **Nada se inventa al importar.** El cliente debe existir en Clientes y los sitios en el catálogo (por código o
  nombre); si no, no se escribe nada y se dice la fila. Todo o nada.
- **Tenant anclado.** Toda consulta por flota lleva `tenant_id` (de la sesión o del viaje ya resuelto). Las únicas
  lecturas que cruzan flotas son las del barrido de acercamiento (`convenios/trabajo.ts`), y cada candidato lleva su
  tenant y todo lo posterior se ancla a él.

## Formato del archivo de importación (CSV o Excel)

Una fila por instrucción. Obligatorias: `cliente`, `convenio`. Del convenio: `origen`, `destino`, `sitio_origen`,
`sitio_destino` (código o nombre del catálogo de sitios), `vigente_desde`, `vigente_hasta` (AAAA-MM-DD, DD/MM/AAAA o
fecha de Excel), `notas`. De la instrucción: `categoria`, `instruccion`, `momento`, `lugar`, `orden`. Con permiso de
finanzas: `tarifa_modo` (`por_viaje`, `por_km`, `por_tonelada`), `tarifa_precio`, `moneda`, `requisitos_cobro`
(separados por `|`). Las filas con el mismo (cliente, convenio) forman un convenio; una fila sin categoría ni
instrucción solo define el convenio. Re-subir el mismo archivo **actualiza, no duplica**, y las instrucciones que el
archivo ya no trae se quitan (el archivo manda). Acepta `.csv` (UTF-8 con o sin BOM, o Windows-1252) y `.xlsx`.
La plantilla descargable trae una fila de ejemplo que el importador descarta.

## Reasignar y corregir (Ola 4a, paquete A)

- **Reasignar el viaje, o asignarlo por primera vez** (un viaje creado sin chofer): el chofer nuevo recibe las instrucciones
  del convenio igual que si el viaje se hubiera creado con él (`convenios/envio.ts`, `instruccionesAlCambiarOperador`).
  Si había otro chofer, los sellos de envío (despacho y acercamiento a cada planta) se reinician para que todo salga una vez
  hacia el nuevo; si el gesto no cambió al chofer, no se manda nada. Pasa desde `/dashboard/[id]`, desde Despacho y desde la
  asignación por WhatsApp de la oficina. Nunca lanza ni deshace la asignación.
- **Corregir a mano el convenio ligado a un viaje** (`/dashboard/convenios`, sección «Convenio ligado a cada viaje en curso»,
  dueño y jefe de tráfico): elige otro convenio activo **del mismo cliente** (o «sin convenio»), se vuelve a tomar la foto de
  instrucciones, la fila queda `ligado_por = 'manual'` (el despacho automático ya no la vuelve a elegir; sirve cuando varios
  convenios empatan) y, si se marca, se mandan de nuevo las instrucciones al operador. Un viaje liquidado ya no se corrige.

## Alta y edición en pantalla (P7, migraciones 0656 y 0657)

En `/dashboard/convenios` el dueño y el jefe de tráfico dan de alta un convenio («Nuevo convenio») y lo editan («Editar
convenio e instrucciones», en cada convenio) **sin volver a subir el Excel**: nombre, A→B, sitios del catálogo, vigencia,
notas y la lista de instrucciones (tema, texto, cuándo se manda y a qué planta aplica). La tarifa y los requisitos de cobro
**no se editan aquí** (son dinero: siguen entrando por la importación con permiso de finanzas).

- **Guardado atómico** (`guardar_convenio`, 0656): los datos y la lista de instrucciones se escriben en UNA transacción; las
  instrucciones que se quitan de la lista se borran al guardar. Un fallo a media lista revierte todo. El cliente de un
  convenio **no cambia** al editar (ya puede estar ligado a viajes de ese cliente).
- **Sin pisarse** (`cliente_convenio.version`): cada UPDATE sube la versión (también el del importador y el de archivar). La
  forma manda la versión que leyó; si alguien cambió el convenio entre tanto, no se guarda nada y se dice (recargar y volver a
  aplicar). Nombre repetido del mismo cliente, cliente o sitio de otra flota y datos fuera de dominio rebotan con su mensaje.
- **Llevarlo a los viajes en curso** (opt-in, `refrescar_viajes_de_convenio`, 0657): marcando «Llevar este cambio a los viajes
  en curso» se vuelve a tomar la foto de instrucciones de los viajes **no liquidados de ESE convenio** que de verdad cambian
  (no hay envíos de relleno). Con «Volver a mandar…» el despacho se reabre y se reenvía **solo** a los operadores que ya lo
  habían recibido (el texto dice «actualizamos las instrucciones»; la plantilla de Meta es de texto fijo). El aviso de
  acercamiento **no se repite** a una planta ya avisada; el de la planta que aún no se avisó sale con la foto nueva. Sin marcar
  nada, los viajes conservan lo que ya se les dijo.
- **Fallar cerrado y decirlo:** sin la 0656 la edición se apaga con un aviso (importar sigue funcionando) y la lista no se
  rompe (la versión se lee aparte); sin la 0657 lo guardado queda y se dice que no se pudo llevar a los viajes; si algún
  reenvío no sale (sin teléfono, plantilla sin aprobar) se cuenta y se indica cómo mandarlo desde «Convenio ligado a cada
  viaje en curso». Permiso: dueño y jefe de tráfico; el tenant sale de la sesión; ambas funciones son solo `service_role`.
- Pruebas: `convenios/edicion.test.ts` (validación), `acciones.test.ts`, `repo.test.ts`, `dashboard/convenios/vista.test.tsx`,
  el ciclo `convenios/convenios.e2e.test.ts` (acercamiento antes del despacho, convenio cambiado tras despachar con dos corridas
  del cron, y otra flota) y, contra Postgres real, `supabase/tests/0656_convenio_guardar.sql` (bloque 300 de
  `verificaciones.sql`).

## Qué falta (externo o decisión)

- **Aplicar 0580 en producción**, con respaldo previo (autorización de Javier). Hasta entonces la pantalla dice «falta
  aplicar la actualización» y el despacho no cambia.
- **Aprobación de Meta de las dos plantillas** nuevas: `convenio_instrucciones_despacho_v1` y
  `convenio_instrucciones_acercamiento_v1` (texto sin verificar contra Meta; ver `plantillas-meta.md`). Dentro de la
  ventana de 24 h el mensaje sale como texto libre; fuera de ella, sin plantilla aprobada, no sale y queda en el log.
- **Qué campo de SU sistema** recibe la «calle de instrucciones»: hoy se entrega CSV y texto para pegar. Una escritura
  directa en su sistema depende de su equipo de sistemas (no simulada).
- **El aviso de acercamiento depende de que el tractor tenga posición reciente (GPS o pin)**: sin posición no se manda.
  El margen ya se ajusta por flota (`/dashboard/agentes/conductores/configuracion`, «Margen de acercamiento a la planta»).
- Editar `convenio_comercial` (tarifa y requisitos de cobro) por pantalla: hoy solo por archivo, a propósito (dinero).
- **Aplicar 0656 y 0657 en producción** junto con la 0580 (autorización de Javier, con respaldo): sin ellas la edición en pantalla se apaga y dice por qué.

## Dónde está el código

`src/lib/likida/convenios/`: `tipos` (vocabulario), `mensajes` (lo que se le dice al operador y la respuesta del
perfil), `seleccion` (qué convenio le toca a un viaje), `importador` (CSV/Excel y exportación), `repo` (acceso a datos),
`envio` (despacho y acercamiento con claim), `acercamiento` + `trabajo` (barrido del cron), `pregunta` («¿por dónde
entro?»), `acciones` (acciones de la pantalla), `edicion` (validación de la forma de alta/edición). Pantalla: `src/app/dashboard/convenios/`. Exportación:
`src/app/api/export/convenios/route.ts`. Esquema y pruebas SQL: `supabase/migrations/0580_*.sql`,
`supabase/tests/0580_convenios.sql` y el bloque 580 de `supabase/verificaciones.sql`; la edición, `0656_*.sql`, `0657_*.sql`,
`supabase/tests/0656_convenio_guardar.sql` y el bloque 300.
