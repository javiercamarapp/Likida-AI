# Carta Porte: salida al sistema del cliente (TMS)

Estado: construido y probado con documentos y un TMS **simulados**. La conexión real (credenciales, formato de errores) depende de insumos del cliente que aún no existen; ver «Lo que falta». Rollback: `carta-porte-salida-tms-rollback.md`. Extracción y bandeja: `carta-porte-multiformato.md`.

## Qué hace, en una frase

Cuando una persona **aprueba** un documento de Carta Porte, el agente arma la plantilla del TMS del cliente y la deja lista para **descargar y subir a mano**, o (si la flota tiene conector) la **sube sola**. Nunca crea el requerimiento ni timbra: eso sigue siendo del equipo del cliente.

## El flujo

```
entrada (correo · WhatsApp 1:1 · carga manual)
  → lectura y validación
  → revisión: una persona corrige y aprueba          (/dashboard/carta-porte/documentos)
  → plantilla: se arma «normal» o «nueva»            (la elige la configuración, no el contenido)
  → pre-chequeo: ¿hay número de cliente interno, caja y requerimiento?
        falta cliente o caja  → vuelve a «por revisar» con el motivo
        falta el requerimiento → «esperando requerimiento» (se reintenta solo)
        todo bien              → listo
  → envío:  modo descarga → queda «listo» y alguien lo sube a mano
            modo API      → «enviando» → «enviado»  |  «rechazado por el TMS»  |  se reintenta
  → fin: «enviado», «subido a mano», «rechazado» o «sin envío»
```

Por qué un documento puede no ligarse (es lo que el pre-chequeo vigila, 33c4d51b 28:16): el número de cliente está mal, la caja está mal, o hay un pre-requerimiento. El agente **no inventa** el número de cliente interno: sale del catálogo del cliente (`/dashboard/agentes/carta-porte/catalogo`).

Un documento con bloqueos abiertos **nunca** queda «listo».

## Interruptores

| Interruptor | Qué apaga | Si está apagado o ilegible |
|---|---|---|
| `agente:carta_porte` | Todo el agente de Carta Porte (lectura incluida). | El cron no procesa documentos. |
| `agente:carta_porte_salida_tms` | **Solo la salida** al TMS (la lectura y la bandeja siguen). | No se sube ni se consulta nada. Los envíos se quedan donde están. Si no se puede leer, se asume apagado (no envía). |
| `cp_salida_config.modo = descarga` | Que el sistema suba por su cuenta. | Todo queda «listo» para bajarlo a mano. |

La fila del interruptor `agente:carta_porte_salida_tms` ya se puede escribir desde el panel: la migración `0842_interruptor_carta_porte_salida_tms.sql` amplió la lista de nombres permitidos de la tabla `interruptor` (la restricción `interruptor_id_dominio`), de forma aditiva. **Mientras esa migración no esté aplicada en un entorno** (ver `supabase/APLICAR-EN-PRODUCCION.md`), la lectura contesta «encendido» por omisión y la palanca práctica para detener las subidas sigue siendo poner el modo en **descarga** (pantalla de configuración). Ver el rollback.

## Parámetros y valores de arranque

Pantalla: `/dashboard/agentes/carta-porte/configuracion`. Tabla `cp_salida_config`. Son valores de **arranque**: el cliente no definió reintentos, frecuencia ni destinatarios; se ajustan en la operación. Sin fila se usan estos valores.

| Parámetro | Valor de arranque | Rango | Qué hace |
|---|---|---|---|
| Modo de salida | `descarga` | `descarga` o `api` | `api` solo sirve si la flota tiene conector. |
| Plantilla por defecto | `normal` | `normal` o `nueva` | Se usa si el perfil del cliente no pide otra. Nunca se adivina por el contenido. |
| Reintentos | 6 | 0 a 50 | Cuántas veces se vuelve a mirar un envío en espera antes de avisar. |
| Frecuencia | 60 minutos | 5 a 1440 | Cada cuánto se revisa un envío en espera. |
| Ventana horaria | vacía (todo el día) | `HH:MM` a `HH:MM`, hora local de la flota | Solo se revisa dentro de la ventana. Inicio y fin van juntos o ambos vacíos. |
| Correo de la alerta | vacío | un correo | A quién avisar cuando se agotan los reintentos o hay rechazo. |
| Usuario de la alerta | vacío | un usuario de la flota | Igual, por WhatsApp de oficina. |
| Revisión (usuario o correo) | vacío | | A quién le toca revisar los documentos que caen a «por revisar» (aparece «Mis casos»). |
| Si el TMS no puede decir si el requerimiento existe | `retener` | `retener` o `enviar` | `retener`: espera. `enviar`: sube de todos modos. |
| Formato de la distancia | `texto_km` | `texto_km` o `numero` | Cómo se escribe la distancia en la plantilla. |

Zona horaria de la flota: `America/Mexico_City`. Las credenciales del TMS **no** se guardan en esta pantalla; viven en el cofre de llaves.

## Descargar y subir a mano

1. Abre el documento aprobado en la bandeja.
2. Pulsa **Descargar plantilla del TMS**. Se baja el libro de Excel armado con la plantilla elegida.
3. Súbelo en el módulo de cargas del TMS del cliente.
4. De regreso, pulsa **Marcar como subido a mano**. El envío pasa a «Subido a mano» y ya no se reenvía.

Si otra persona cambió el documento mientras lo mirabas, la pantalla lo avisa: recarga y vuelve a intentar. Si el envío se está haciendo en ese momento, espera a que termine.

## Cómo leer cada estado del envío

| Lo que ves en el documento | Qué significa | Qué hacer |
|---|---|---|
| Aún no se ha enviado nada | No hay envío (todavía no aprobado, o se descartó). | Aprueba el documento si ya está revisado. |
| Listo para enviar | Pasó el pre-chequeo. En modo descarga espera a que lo subas; en modo API sale en la siguiente pasada. | Nada, o descarga y sube a mano. |
| Enviándose al sistema del cliente | Está en camino ahora mismo. | Espera unos minutos. |
| Esperando que exista el requerimiento | El TMS aún no tiene el requerimiento de ese viaje. Se reintenta solo (muestra la próxima revisión). | Crea el requerimiento en el TMS. Al aparecer, sigue solo. |
| El sistema del cliente no contestó, se reintentará | Falla pasajera de conexión. Se reintenta con esperas cada vez mayores (hasta 5 veces). | Nada; si se agota llega un aviso. |
| Enviado | El TMS lo recibió. | Nada. |
| Rechazado por el TMS | El TMS dijo que no. El documento vuelve a «por revisar» con lo que hay que corregir. | Corrige los campos marcados y aprueba otra vez (se crea un envío nuevo). |
| Subido a mano | Alguien lo subió y lo marcó. | Nada. |
| Sin envío | El envío se descartó (por ejemplo, el documento volvió a revisión). | Aprueba de nuevo cuando esté corregido. |

Filtros de la bandeja: Todos, Sin envío, En curso, Enviados, Rechazados por el TMS, Subidos a mano.

## Avisos a la oficina

Hay **un solo aviso** por envío y motivo (con candado en base), con folio y liga; nunca lleva RFC, nombres ni importes:

- Sigue sin requerimiento tras los reintentos configurados.
- El sistema del cliente rechazó el documento.
- El sistema del cliente no respondió tras varios intentos.

Se manda al correo o usuario de la alerta; sin destinatario configurado no sale aviso y el estado queda visible en la bandeja.

## Errores en lenguaje llano

Qué ve la persona y qué hacer. Los textos reales salen de `errores_tms.ts`, `alerta_envio.ts`, `prechequeo.ts` y las pantallas.

| Causa | Qué ve la persona | Qué hacer |
|---|---|---|
| Falta el número de cliente interno | «Falta el número de cliente interno: no está en el catálogo del cliente y el agente no lo inventa.» El documento vuelve a por revisar. | Da de alta el cliente en el catálogo (con su número interno) y aprueba otra vez. |
| El documento no trae caja | «El documento no trae número de caja.» | Captura la caja en la revisión. |
| La caja no existe en el TMS | «La caja no existe en el TMS.» | Corrige el número de caja o créala en el TMS. |
| No existe el requerimiento | «Esperando que exista el requerimiento.» | Crea el requerimiento en el TMS; el agente lo detecta. |
| No se pudo verificar el requerimiento | «No se pudo verificar el requerimiento.» Con la regla `retener` queda en espera. | Revisa la conexión con el TMS o súbelo a mano. |
| Sin requerimiento tras los reintentos | Aviso: «sigue sin requerimiento tras N reintentos. Crea el requerimiento o márcalo como subido a mano.» | Crea el requerimiento o sube a mano y marca. |
| El TMS rechaza un campo | Un bloqueo en el campo, por ejemplo: «…: el sistema del cliente lo rechazó (no está en el catálogo del sistema del cliente). Corrígelo y vuelve a aprobar.» | Corrige ese campo y aprueba de nuevo. |
| El TMS rechaza por algo que no se ubica | «El sistema del cliente rechazó el archivo: …» (un solo bloqueo general). | Abre el módulo del TMS para ver el detalle y corrige el campo que corresponda. |
| El TMS no responde | «El sistema del cliente no contestó, se reintentará»; al agotarse, aviso «no respondió tras varios intentos». | Revisa la conexión o sube a mano y marca. |
| Credenciales del TMS caducadas | Los envíos quedan «listos» y no sale nada hasta renovar las credenciales; el operador recibe aviso. | Renueva las credenciales en el cofre de llaves. |
| La flota no tiene conector | «Esta flota no tiene conectado el sistema del cliente: descarga la plantilla y súbela a mano.» | Usa la descarga manual. |
| Documento sin aprobar | «Solo se prepara el envío de un documento aprobado.» | Revisa y aprueba primero. |
| Ya se envió | «Este documento ya se envió al TMS: no hay nada que subir a mano.» | Nada. |

Los valores rechazados (un RFC, una descripción) **no se copian** a hallazgos, bitácora ni base: solo la ubicación (hoja, fila, columna).

## Paso de prueba con el equipo del cliente

Pendiente de hacer con ellos (33c4d51b 31:25–32:08). Pregunta que sigue abierta: si el TMS todavía genera un pre-requerimiento al subir una carga cuya caja no existe. Desde Likida no se puede detectar un pre-requerimiento; se cubre con las verificaciones de caja y de requerimiento.

1. Pide a la oficina que suba al TMS una carga **sin requerimiento** (con una caja cualquiera) y que revise si el TMS genera un pre-requerimiento.
2. Si lo genera: ese caso se queda en «esperando requerimiento» y la oficina lo limpia en el TMS; anota la frecuencia.
3. Si no lo genera: anótalo aquí y deja la regla de `retener` como está.
4. Registra la fecha y el resultado en la bitácora de la operación.

## Lo que falta (bloqueos externos)

- Formato real de los errores de carga del TMS: hoy se asume `hoja / fila / campo / detalle`. Cuando llegue, solo cambia el adaptador.
- Credenciales y acceso al TMS del cliente (cofre de llaves) para el modo API.
- Valores definitivos de reintentos, frecuencia y destinatarios.
- Criterio real del cliente para elegir entre plantilla normal y nueva.

## Checklist de verificación posterior a un cambio

Ver `carta-porte-salida-tms-rollback.md`, sección final.

## Ubicación del código

- Máquina de estados: `src/lib/likida/carta_porte_docs/envio_estados.ts`
- Pre-chequeo: `src/lib/likida/carta_porte_docs/prechequeo.ts`
- Worker de envíos y cron: `src/lib/likida/carta_porte_docs/worker_envios.ts`, `src/app/api/cron/carta-porte-docs/route.ts`
- Errores del TMS a hallazgos: `src/lib/likida/carta_porte_docs/errores_tms.ts`
- Configuración: `src/lib/likida/carta_porte_docs/salida_config.ts`
- Migraciones: `supabase/migrations/0790_cp_envio_tms.sql` a `0793_cp_sat_catalogo.sql`
