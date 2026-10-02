# Orquestador — el asistente del panel y el tablero de viajes en vivo

El asistente que ya existía en el panel («Pregunta a tus datos») ahora contesta también sobre las fuentes de los agentes nuevos y,
sobre todo, **no decide lo delicado: lo deriva a una persona**. Junto a él hay un tablero con todos los viajes en curso.

## Qué ve cada rol (herramientas del asistente)

Cada herramienta declara su área en `src/lib/likida/orquestador/permisos.ts` y se aplica en tres sitios: al **ofrecerla** al modelo,
en un **executor envuelto** que falla cerrado (solo corre lo que está en el mapa y el rol puede ver) y **dentro del handler**.

| Herramienta | Área | Qué devuelve |
|---|---|---|
| `tablero_viajes` | operación | viajes en curso: último hito, posición del tractor y antigüedad del GPS, excepciones; filtros por terminal y cliente |
| `detalle_viaje` | operación | un folio: la línea de sus 5 hitos, citas/ETA, posición, excepciones |
| `estado_vigia` | operación | conversaciones esperando y plazos vencidos (más corto con grupo crítico), molestia, pendientes de aprobación, envíos fallidos, grupos |
| `salud_agentes` | operación | por agente: latido del proceso que lo despierta, última corrida de la flota, envíos que no salieron |
| `estado_buzon` | dinero | recibidas por estado, por revisar, con error, entregas al contador |
| `estado_cobranza` | dinero | viajes vigilados, cola de la próxima corrida, por nivel, más atrasados (folio y días) |
| `estado_autofactura` | dinero | emisión real (encendida/apagada y topes), lotes por confirmar, fase de cada portal |
| `convenio_viaje` | operación | el convenio ligado a un viaje abierto y sus instrucciones de planta (la foto que se le dijo al operador); sin tarifas |
| `estado_jornada` | operación | conteo del registro de jornada de 7 días: expedientes, abiertos, cerrados, cerrados sin conformidad; sin nombres ni horas por persona |
| `estado_liquidacion_externa` | dinero | la **entrega** de la liquidación al chofer: conteos por estado, «no coincide», fallidas recientes; sin montos ni teléfonos |
| `reclamacion_peajes` | dinero | último desglose de peajes cruzado con GPS y geocercas: reclamables, monto, motivos, principales cruces (una señal, no una acusación) |
| `escalar_a_persona` | cualquier rol de panel | **única acción**: abre una tarea para una persona (ver abajo) |
| las del analista de dinero | dinero | KPIs, liquidaciones, fiscal, series… (sin cambios; `consultar_carta_porte` pasó a operación) |

- `encargado` (jefe de tráfico) ve operación y ninguna de dinero; `contador` ve dinero y ninguna de operación; `flota_admin` y
  `superadmin` ven todo; el chofer o un rol desconocido no ven nada.
- Ninguna herramienta tiene parámetro de flota: el tenant lo fija la sesión. Los únicos textos libres son dos nombres (terminal,
  cliente) y un folio que se buscan **en memoria** contra datos de la flota ya cargados (el texto del modelo nunca llega a una consulta), y el
  `resumen` de una escalación.
- **Sin PII de más:** el recorte vive en `resumenes.ts` (puro, con pruebas). No salen teléfonos, correos, contactos del cliente, texto de
  sus mensajes, rutas de archivos ni coordenadas exactas (≈1 km).
- Un dato que no se pudo leer **se dice** (`gpsDisponible: false`, `disponible: false`), nunca se devuelve como cero.

## Escalar a una persona (0650)

`escalar_a_persona(destino, motivo, viaje_folio?, resumen)` con listas cerradas (`mesa_de_control | liquidacion | jefe_de_trafico | contador`;
`operador_sin_respuesta | posible_emergencia | diferencia_liquidacion | cliente_molesto | falla_de_agente | duda_fiscal | otro`).
Deja una fila en `orquestador_escalacion`: no cambia un viaje, no toca dinero y no le escribe a terceros. Una abierta por
(flota, destino, motivo, viaje); el resumen se limpia (enlaces, correos y rachas de 10+ dígitos). Las tareas abiertas se ven y se marcan
atendidas en `/dashboard/viajes-en-vivo` y **entran a las notificaciones del panel** (`/dashboard/notificaciones`, solo las que el rol puede leer: una
tarea de dinero no la ve el jefe de tráfico). Si la base aún no tiene la 0650, la herramienta lo dice y le indica a la persona avisar a mano.

### El aviso saliente (0651) — apagado por defecto

Al abrirse una tarea, y en el barrido del cron `escalar`, la persona recibe un **correo** (plantilla `avisoEscalacionAsistente` en `lib/correo/avisos.ts`)
**si la flota lo encendió**: es el evento `escalado` del agente `orquestador` en el catálogo de avisos (`agentes/notificaciones.ts`), que se enciende en la
sección **Notificaciones** al pie de `/dashboard/viajes-en-vivo` (solo el dueño decide quién recibe).

- **Un correo por tarea** (no por «marca de insistencia»): una emergencia nueva no se calla porque ya hubo un aviso hoy. El claim es un UPDATE condicional sobre
  `aviso_estado` (pendiente → enviado | omitido | agotado): dos corridas solapadas no mandan dos correos.
- **Apagado = omitido, no diferido**: una tarea creada con el aviso apagado queda `omitido: apagado` y NO se manda tarde cuando alguien lo enciende.
- Reciben las cuentas marcadas que abren la pantalla **y** pueden leer esa tarea (dinero → solo el dueño). Sin destinatario o sin canal de correo: `omitido`, dicho en la tarea.
- Un envío que falla se reintenta (espera de 10 min, hasta 3 intentos) y luego queda `agotado`. Tope: 3 correos por flota y por corrida.
- El asistente solo le dice a quien preguntó «ya le mandé el aviso por correo» si de verdad salió; si no, le dice que avise directamente si es urgente.
- Pendiente externo: es correo (Resend). Un aviso por **WhatsApp** a la persona exigiría una plantilla aprobada por Meta (la genérica `aviso_operacion_v1` sirve fuera de ventana
  cuando esté aprobada); no se cableó para no mandar mensajes a terceros sin esa aprobación.

## Si un agente falla

`salud_agentes` cruza el latido del cron de cada agente (plataforma), su última corrida en **esta** flota y los envíos que no salieron
(Vigía y entregas del buzón). El prompt obliga al asistente a decirlo. La cola de WhatsApp de la plataforma (`wa_outbox`) no tiene `tenant_id`
y **no** se le enseña a una flota.

### El barrido de salud (0652) — sin que nadie pregunte

Dentro del cron `escalar` (cada hora, sin cron nuevo) un barrido revisa la salud de los agentes de cada flota y abre **una tarea `falla_de_agente`** por agente caído
para la persona que le toca (Conductor y Carta Porte → jefe de tráfico; Vigía → mesa de control; peajes y liquidación → liquidación; buzón, cobranza y autofactura → contador).
- **Claim por flota** (`reclamar_flotas_barrido_orquestador`): ≤ 25 flotas por corrida y una vez cada 30 min por flota (10 min tras un error); dos corridas solapadas no barren la misma flota.
- Una tarea abierta por (flota, agente) (`barrido:<agente>`): mientras la falla siga, no se abre otra ni se reenvía el aviso. **Se cierra sola** cuando el agente vuelve a la normalidad
  (nota «se resolvió solo»), y nunca con una lectura ciega («no sé» no es «sano»).
- Es falla: latido vencido o en fallo, última corrida fallida (o 3 de las recientes), respuestas del Vigía sin salir en 24 h. **No** lo es «nunca ha latido» (entorno nuevo),
  «a medias» ni las entregas del buzón (ventana de 30 días); eso sigue visible en `salud_agentes`.
- **Carta Porte (`carta-porte-docs`) SÍ entra** a los agentes vigilados (decisión P6): su worker tiene cron propio con latido cada 5 min, y un documento sin procesar no hace ruido.
  No lleva `corridas` (el worker no escribe `agente_corrida`).
- Una falla del barrido (no poder leer una flota) pinta el cron `escalar` en 500, como los demás motores.

## Tablero de viajes en vivo (`/dashboard/viajes-en-vivo`, área operación, sin pesos)

El mismo modelo (`armarTableroViajes`) lo usan la pantalla y la herramienta: el semáforo y la cola de excepciones salen del Conductor
(`armarTablero`) y se les suma la posición del tractor. Excepciones: llegada sin confirmar, sin señal de vida (chofer sin reporte **y** GPS
callado), escalado al jefe de tráfico, estadía excedida, GPS obsoleto, sin posición, sin tractor. Filtros por terminal y cliente (validados contra
el catálogo de la flota). Trae una caja para preguntarle al asistente y la lista de tareas que dejó.

**Se refresca solo** (`actualizar_solo.tsx`): cada 60 s pide el tablero de nuevo (`router.refresh()`, que conserva lo que se está escribiendo); no refresca con la pestaña
oculta ni mientras hay un campo con foco; tiene «Actualizar ahora» y «Pausar», y dice cuándo fue la última vez. La caja del asistente pide el tablero de nuevo al terminar
cada respuesta, así una tarea nueva aparece sin recargar. La caja pinta las gráficas **dona** y **serie** que entregue el asistente (y su resumen en palabras): ya no dice
«la respuesta venía vacía» cuando solo traía una gráfica.

**Enganche con el GPS:** el mapa con semáforo de obsolescencia vive en la rama del GPS y no se duplicó. `orquestador/enganche_gps.ts` usa sus
mismos umbrales y nombres (en vivo ≤ 30 min, atrasada ≤ 6 h, obsoleta); al integrar esa rama basta reexportar allí `nivelDePosicion` de `gps_salud`.

## Pendientes y bloqueos

- Aplicar la 0650 en una base real requiere autorización y respaldo (no se aplicó nada).
- El aviso por **WhatsApp** a la persona (hoy es por correo y apagado por defecto) exige una plantilla aprobada por Meta; ver arriba.
- Aplicar la 0651 y la 0652 junto con la 0650 (sin ellas el código lo dice: no avisa ni barre, y todo lo demás sigue como antes).
- La pestaña completa `/dashboard/chat` sigue en el área de dinero (regla heredada y su prueba); abrirla al jefe de tráfico es una decisión de producto.
  La API del chat y la caja del tablero ya admiten roles de operación.
- Verificación contra el modelo real y contra datos reales de una flota: no hecha (las pruebas usan un doble del modelo y fuentes en memoria).
