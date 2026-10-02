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
Deja una fila en `orquestador_escalacion`: sin efectos laterales (no manda mensajes, no cambia un viaje, no toca dinero). Una abierta por
(flota, destino, motivo, viaje); el resumen se limpia (enlaces, correos y rachas de 10+ dígitos). Las tareas abiertas se ven y se marcan
atendidas en `/dashboard/viajes-en-vivo`. Si la base aún no tiene la 0650, la herramienta lo dice y le indica a la persona avisar a mano.

## Si un agente falla

`salud_agentes` cruza el latido del cron de cada agente (plataforma), su última corrida en **esta** flota y los envíos que no salieron
(Vigía y entregas del buzón). El prompt obliga al asistente a decirlo. La cola de WhatsApp de la plataforma (`wa_outbox`) no tiene `tenant_id`
y **no** se le enseña a una flota.

## Tablero de viajes en vivo (`/dashboard/viajes-en-vivo`, área operación, sin pesos)

El mismo modelo (`armarTableroViajes`) lo usan la pantalla y la herramienta: el semáforo y la cola de excepciones salen del Conductor
(`armarTablero`) y se les suma la posición del tractor. Excepciones: llegada sin confirmar, sin señal de vida (chofer sin reporte **y** GPS
callado), escalado al jefe de tráfico, estadía excedida, GPS obsoleto, sin posición, sin tractor. Filtros por terminal y cliente (validados contra
el catálogo de la flota). Trae una caja para preguntarle al asistente y la lista de tareas que dejó.

**Enganche con el GPS:** el mapa con semáforo de obsolescencia vive en la rama del GPS y no se duplicó. `orquestador/enganche_gps.ts` usa sus
mismos umbrales y nombres (en vivo ≤ 30 min, atrasada ≤ 6 h, obsoleta); al integrar esa rama basta reexportar allí `nivelDePosicion` de `gps_salud`.

## Pendientes y bloqueos

- Aplicar la 0650 en una base real requiere autorización y respaldo (no se aplicó nada).
- Avisar a la persona por WhatsApp/correo al escalar (hoy solo queda la tarea visible en el tablero) exige declarar el evento en el catálogo de
  avisos y, para WhatsApp fuera de ventana, una plantilla aprobada por Meta.
- La pestaña completa `/dashboard/chat` sigue en el área de dinero (regla heredada y su prueba); abrirla al jefe de tráfico es una decisión de producto.
  La API del chat y la caja del tablero ya admiten roles de operación.
- Verificación contra el modelo real y contra datos reales de una flota: no hecha (las pruebas usan un doble del modelo y fuentes en memoria).
