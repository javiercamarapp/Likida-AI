# Agente de asistencia y siniestros — plano técnico (23-ago-2026)

## Lo que YA existe y es el molde
`talacha_wa.ts` completo (reconocedor cerrado, acuse, botones al jefe, firma atómica) ·
`crearIncidencia` con candados de tenant · tabla `incidencia` (18 columnas, 6 CHECKs) ·
`reclamarEscalacion` de escalar_viaje.ts (el UPDATE condicional que hay que copiar) ·
`dentroDeVentana` de cobranza_pura.ts (el único quiet-hours del repo) · `posicion` ya la escribe
el pin de WhatsApp · `geo/ciudades.ts` (geocodificador estático, sin API) · conectores GPS con
`probar()` verificado (Wialon, Samsara, Geotab, Navixy).

## Modelo de datos (migración 0168)
- `incidencia` se AMPLÍA, no se duplica: tipos nuevos (siniestro, robo, emergencia_medica, varado,
  bloqueo), prioridad `critica`, y columnas lat/lng, hay_lesionados, unidad_movible,
  nivel_escalado, reconocida_en/por, notificar_desde. **El NULL de `hay_lesionados` significa
  "no preguntado": jamás false por defecto.**
- El PROTOCOLO no es tabla: vive en `tenant.config.siniestros` (la política ya vive ahí;
  `politica_gasto` como tabla está muerta y repetir ese error sería reabrir la trampa).
- Tablas nuevas: `proveedor_emergencia` (directorio por flota, círculo con radio),
  `flota_poliza` (hoy solo existe `unidad.poliza_vence`, una fecha suelta: falta aseguradora,
  número y el 800 de siniestros, que es EL dato que el agente necesita), `contacto_emergencia`
  (con `avisar_si_lesionados` en false a propósito), `incidencia_evento` (bitácora append-only;
  NO se reusa bitacora_auditoria, que es administrativa y cross-tenant).

## Enrutamiento: 5 puntos de entrada
A) Texto del chofer, ENTRE el botón y `responderConsulta` (el botón manda porque responde a una
   pregunta nuestra; todo lo demás puede comerse un reporte grave).
B) **Caption de foto, ANTES de la visión.** Hoy la talacha se evalúa DESPUÉS de addGasto: la foto
   de un camión volcado paga OCR, sale `ilegible` y el chofer recibe *"esa foto salió difícil de
   leer, ¿me la reenvías con buena luz?"* mientras su unidad arde.
C) Rama sin viaje abierto (`incidencia.viaje_id` ya es nullable).
D) Primer lugar de `atenderTextoOficina`: si el dueño choca sin viaje abierto, hoy le contesta
   el analista como si fuera pregunta de negocio.
E) **El gate de privacidad**: un siniestro ROJO debe ir POR ENCIMA, con tratamiento mínimo
   (incidencia + aviso, sin foto/OCR/modelo). Precedente: el medio ARCO ya se izó encima.
   Es decisión de producto+legal, no un default.

## Dos niveles de reconocimiento (ROJO gana sobre cualquier palabra de talacha)
ROJO: choque, volcadura, atropell*, incendio, muerto, lesionado, sangre, 911, asalto, robaron,
secuestro, balacera, bloqueo, retén, derrame. **Sin tope de largo** (quien describe un choque
escribe largo; talacha corta a 220 y hitos a 40). La pregunta NO descarta ("¿qué hago? choqué").
ÁMBAR: varado, no arranca, se salió del camino, se me fue el freno, humo, se calentó.
**La asimetría se invierte**: en talacha el falso positivo es barato; aquí el caro es el negativo.

## Tools (8) — ninguna autoriza, contrata, promete ETA ni dice "estás cubierto"
ubicacion_del_incidente (cascada pin → posicion → ciudad, SIEMPRE rotulando la fuente;
`geo/ciudades.ts` dice que un centroide jamás se presenta como posición del camión) ·
pedir_ubicacion (contador en incidencia_evento, NO regex sobre el historial) · ruta_y_distancia
(**haversine, y `eta_min` queda null hasta que exista ruta real: un ETA en línea recta sobre
carretera de montaña es cifra fabricada**) · poliza_de_la_flota (el deducible NO va al canal del
chofer: se instrumenta por lista de tools por agente) · directorio_de_emergencia (vacío → "tu
flota no tiene grúa dada de alta") · abrir_incidencia_de_siniestro (mutation, idempotente) ·
avisar_al_jefe · registrar_en_bitacora.

## Escalamiento: 5 niveles con claim atómico monótono
0 chofer · 1 jefe · 2 dueño (o inmediato si hay lesionados) · 3 seguros · 4 emergencia.
**Likida NO marca 911 ni a la aseguradora jamás**: una llamada automática abre un siniestro, que
es dinero y acto jurídico; y un despacho falso de 911 es delito. El flag `requiere911` solo cambia
el texto y el orden, nunca quién marca.
Diferencia con escalar_viaje: allí el sello no expira nunca; aquí TIENE que volver a disparar
(que el nivel 1 no conteste es el caso de uso). Se sustituye por `nivel_escalado` monótono.
Cron nuevo `/api/cron/asistencia` cada 5 min (el de escalar corre cada hora: para una emergencia
no sirve). **El primer aviso NO espera al cron**: sale síncrono en el turno del webhook.

## No despertar al jefe por una ponchadura
La ventana horaria aplica a la SEVERIDAD, no al canal. ROJO la ignora siempre. ÁMBAR la respeta
reusando `dentroDeVentana` de cobranza (una implementación, no dos) y fuera de ventana el aviso
se DIFIERE con `notificar_desde`, no se tira. **Nunca se le pide al modelo que juzgue si despierta
a alguien**: los tiers son deterministas; el modelo puede bajar el ruido, nunca subirlo.

## La incidencia no puede depender del modelo
Orden: (1) abrir incidencia + evento, (2) avisar al jefe, (3) SOLO SI queda presupuesto, el agente
redacta. Con COSTO_AGENTE_MS=15s y un webhook cargado, **el caso normal es que no haya presupuesto
para el modelo**: el camino determinista tiene que estar completo por sí solo, no ser el plan B.

## Ventana de 24 h — la ruta crítica del calendario
Dos plantillas nuevas a aprobar en Meta ANTES de escribir código: `siniestro_reportado_v1` y
`siniestro_sin_atender_v1`. No reusar `recordatorio_cierre` (escalar_viaje ya admite que su texto
habla de otro evento). Cascada cableada con una fila de bitácora por intento: botones → plantilla
→ correo → alertarOperador. Y al chofer se le dice la verdad si el jefe no recibió.
**Una plantilla no lleva botones**: el texto debe invitar a responder, lo que reabre la ventana.

## Orden de construcción (1-5 sin NINGUNA integración externa)
1. Migración + bloque de verificación
2. Reconocedor + enrutamiento + incidencia + aviso síncrono con botones ← **ya es producto usable**
3. Directorio, póliza y contactos con su captura en /dashboard
4. Escalamiento por niveles + cron de 5 min
5. Plantillas de Meta y cascada de canales ← mandar a aprobación el DÍA 1
6. Tools y agente · 7. Poller GPS (falta el poller y `unidad.gps_device_id`; lo demás existe)
8. API de mapas (ETA, distancia real, geocodificación inversa del pin — lo que el gruero necesita oír)

## Riesgos colaterales que hay que nombrar
- `getSystemPrompt` cae al prompt de LIQUIDACIÓN por `default`: una clave mal escrita le da al
  agente de siniestros el prompt de cuadre, en silencio.
- `incidencia` tiene RLS `tenant_data` a secas mientras `gasto` está tras `ve_finanzas()`: un
  `monto_estimado` grande pone dinero a la vista de un rol al que el panel se lo esconde.
- `contacto_emergencia` guarda a un familiar que nunca aceptó nada → aviso de privacidad + purga.
- `geocerca` existe y NADIE la lee.
- `models.ts` define el rol `piloto` que el CHECK de `agente_definicion` no incluye.
