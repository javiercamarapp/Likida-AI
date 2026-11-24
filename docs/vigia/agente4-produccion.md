# Agente 4 (Vigía) — runbook de producción

Documento genérico y público: no nombra clientes, intermediarios, plantas ni personas. Los datos reales de cada flota viven en la
base y en su configuración, nunca aquí. Estado de partida: el agente 4 está **pausado** en producción; nada de lo descrito cambia
su comportamiento hasta que una persona encienda cada interruptor, en el orden de este documento.

## 1. Interruptores y configuración

Todos fallan cerrados: ausente, ilegible o con un valor distinto de lo indicado = apagado.

| Interruptor | Dónde | Efecto | Por omisión |
|---|---|---|---|
| `habilitado` (config de la flota) | tabla de configuración del Vigía | sin fila o `false`: el agente no lee, escribe ni envía | apagado |
| `soloAvisar` (config de la flota) | idem | `true`: clasifica, prioriza y avisa a gerentes/directores; NO redacta ni manda nada al cliente | `true` con la migración 0798 |
| `modoAprobacion` | idem | `siempre`: toda respuesta al cliente la aprueba una persona | `siempre` |
| `autoenviarMinAprobaciones` | idem | aprobaciones sin editar necesarias antes de considerar autoenvío | 5 |
| `LIKIDA_VIGIA_MODELO=no` | entorno | apaga el clasificador por modelo (quedan las reglas) | modelo encendido |
| `LIKIDA_VIGIA_DATOS_UNIDAD=si` | entorno | declara aplicada la migración 0798 (intención «datos de la unidad») | apagado |
| `LIKIDA_VIGIA_PULIR=si` | entorno | pulido de redacción del borrador | apagado |
| `LIKIDA_VIGIA_SIN_ATENDER_CORREO=si` | entorno | bandera de plataforma del resumen de «sin atender» por correo (además del interruptor global, el del agente y el propio de la flota) | apagado |
| `VIGIA_SOMBRA_DECISION` | entorno | modo sombra: registra lo que `decidirAccion` sugeriría en el evento `borrador`. `si` = todas las flotas; una lista de ids de flota separados por comas = solo esas. No actúa. | apagado |
| `VIGIA_HISTORIAL_SAL` | entorno (secreto, ≥ 16 caracteres) | sal del hash de autor al importar historiales | sin secreto: sal por id de flota |
| Interruptores `global` y `agente:vigia` | tabla de interruptores de la plataforma | pausa general del agente | según plataforma |

Cambiar una variable de entorno en el proveedor de despliegue puede provocar un build facturable: agrupar los cambios y avisar
cuántos builds se provocan antes de aplicarlos.

### Umbrales por omisión

Escalamiento (`CONFIG_ESCALAMIENTO_POR_OMISION`, minutos salvo indicación):

| Umbral | Valor |
|---|---|
| repregunta: espera / mensajes / ventana | 10 / 3 / 30 |
| ráfaga (mensajes más juntos cuentan como uno) | 2 |
| silencio crítico / silencio normal | 30 / 60 |
| espera en planta N1 / N2 / N3 | 60 / 300 / 600 |
| unidad detenida fuera de parador / en cualquier sitio | 30 / 60 |
| máximo en parador | 45 |
| carta porte sin timbrar | 60 |
| prealerta con faltante | 30 |
| faltantes antes de la cita N1 / N2 | 90 / 30 |
| pendiente antiguo (días) → N2 | 6 |
| reclamo de comprobante de entrega (horas) | 24 |
| cambios de unidad en 60 min → N2 | 2 |

Política de ETA (`CONFIG_ETA_POR_OMISION`):

| Umbral | Valor |
|---|---|
| antigüedad máxima de un ETA vigente | 60 min |
| cambios que obligan a avisar al encargado (ventana 60 min) | 2 |
| cambios que escalan a gerencia (ventana 120 min) | 3 |
| aviso previo mínimo de un retraso | 60 min |
| retraso sobre la cita que escala a gerencia | 60 min |
| ETA generado por el sistema (GPS) | no autorizado |
| zona horaria | sin configurar: no se afirma ninguna hora |

Config de la flota sin fila (`configApagada`): SLA de respuesta 30 min, SLA crítico 10 min, escalar a nivel 2 a los 60 min,
molestia desde nivel 2, retención 180 días, respaldo por correo apagado. Rangos reales: SLA crítico 2–1440, SLA 5–1440. Los
«5 minutos» o «10 minutos» que se mencionan en conversaciones son ejemplos hablados, no reglas: el valor lo fija cada flota.

Turnos de directores: ventana de noche por omisión 20:00–07:00, zona de la Ciudad de México.

Autoenvío: ninguno por omisión. Como máximo la flota puede autorizar, por tipo, ETA, estatus de planta, estatus de cruce,
estatus de ruta, cuenta espejo y colocación de caja vacía. Todo lo demás pasa siempre por una persona.

## 2. Checklist de go-live (por flota)

Marcar cada punto con evidencia (captura o consulta), no de memoria. Si algo falta, el agente permanece apagado.

**Datos requeridos de las fuentes**
- [ ] Contactos autorizados por cliente cargados, con consentimiento y aviso de privacidad vigentes.
- [ ] Fuente de viajes/estatus legible y fresca (último hito, posición, cita, planta). Medir la antigüedad real del dato.
- [ ] Campos de ficha obligatorios disponibles para al menos el 90 % de los viajes activos de la muestra.
- [ ] Reglas por cliente cargadas (horarios límite, canal, estados de planta, quién autoriza cada decisión, zona horaria).
- [ ] ETA: confirmar quién lo publica (persona) y la zona horaria; el ETA de sistema sigue apagado salvo autorización escrita.
- [ ] Comprobante de entrega: definir qué documento cuenta y que la carta porte sellada no lo sustituye.

**Alertas privadas por turno**
- [ ] Para cada turno (día, noche, festivos y fines de semana) hay al menos una persona destinataria con teléfono verificado.
- [ ] Prueba de entrega a cada destinatario en horario real; confirmar ventana de 24 h de WhatsApp o plantilla aprobada.
- [ ] Respaldo por correo decidido (encendido o no) y destinatarios con correo válido.
- [ ] Nadie del cliente recibe alertas internas: los avisos de escalamiento son solo para la flota.

**Grupos piloto**
- [ ] Elegir 1–2 grupos con volumen moderado y un responsable humano disponible; evitar grupos críticos en la primera semana.
- [ ] Replay previo del histórico exportado de esos grupos (sección 4) y revisión de las métricas con el responsable.
- [ ] Modo sombra encendido solo para la flota piloto durante al menos una semana de operación real antes de cualquier autoenvío.

**Política de licencia y celular del operador**
- [ ] Decidir por escrito qué datos del operador (nombre, licencia, teléfono) se muestran y a quién; por omisión no se muestran.
- [ ] Solo un solicitante verificado puede recibir datos del operador, y aun así los decide una persona.
- [ ] El agente nunca contacta al operador por su celular personal ni comparte ese número.

**Aprobaciones**
- [ ] Aprobación escrita del responsable de la flota para encender cada etapa (sombra, solo avisar, copiloto con aprobación).
- [ ] Aprobación de quien administra el despliegue antes de cambiar variables de entorno (costo de builds).
- [ ] Autoenvío: aprobación explícita por tipo, con las aprobaciones sin editar que exige la configuración.

Orden de encendido recomendado: (1) sombra con `soloAvisar=true` → (2) revisar el registro de decisiones sombra contra lo que
hicieron las personas → (3) copiloto con aprobación en grupos piloto → (4) ampliar → (5) autoenvío por tipo, si se autoriza.

## 3. Monitoreo

- Evento `borrador`: con la sombra encendida trae `sombra` (acción sugerida, motivo, regla, nivel, faltantes, `endurece`,
  `aplicado: false`). Comparar: ¿la sombra sugiere persona/no responder donde el agente hoy contestaría? Cada caso es un candidato
  a endurecer o un falso positivo a corregir en la matriz. Un `sombra.error` indica que `decidirAccion` falló (salida cerrada).
- Eventos de escalamiento y `sin_dato`: volumen por turno y por flota; picos inesperados = datos faltantes en la fuente.
- Pendientes de aprobación y mensajes sin atender: antigüedad del más viejo; el barrido avisa, pero revisar el tablero cada turno.
- Aprobaciones sin editar vs. editadas por tipo de intención: base para decidir autoenvío.
- Mensajes de baja (opt-out): deben quedar atendidos aun con el agente apagado.
- Costo de modelo por flota (presupuesto de IA) y número de builds provocados por cambios de configuración.
- Revisar semanalmente una muestra aleatoria de borradores contra la lista de «lo que nunca se dice».

## 4. Replay de un chat exportado (herramienta local)

`scripts/vigia/replay-chat.ts` lee un export de WhatsApp (.txt) desde una ruta que se pasa por argumento, clasifica cada mensaje del
cliente con las reglas, corre `decidirAccion` sin datos confirmados (el caso más conservador) y calcula métricas agregadas.
No usa base, red ni modelo.

```
npx tsx scripts/vigia/replay-chat.ts "<ruta al export .txt>" --equipo "Nombre A,Nombre B" [--sal "<texto>"] [--umbral-min 60]
```

- `--equipo`: nombres, tal como salen en el chat, de la gente de la flota; todo otro autor es cliente.
- Salida: mensajes leídos, tiempos de respuesta por bloque de mensajes del cliente (mediana, p90, máximo, lentos), mensajes sin
  atender al final del chat, distribución de intenciones y de acciones sugeridas.
- **Nunca imprime texto de mensajes, autores, hashes ni la ruta del archivo.** Aun así, no guardar exportaciones reales dentro del
  repositorio (es público) ni pegar la salida con datos de una flota en issues o PRs públicos.

## 5. Rollback

Del más rápido al más profundo; todos reversibles y sin borrar datos:

1. Interruptor de plataforma `agente:vigia` (o `global`) a apagado: el agente deja de actuar de inmediato.
2. `habilitado=false` en la configuración de la flota afectada (las demás siguen).
3. `soloAvisar=true`: vuelve a avisar sin redactar ni enviar al cliente.
4. Quitar `VIGIA_SOMBRA_DECISION` (solo deja de registrar; no hay estado que revertir).
5. `LIKIDA_VIGIA_PULIR` y `LIKIDA_VIGIA_MODELO=no` para volver a borradores deterministas con reglas.
6. Mensajes ya enviados no se pueden retirar: avisar al responsable de la flota para que informe al cliente si hubo un error.

Tras un rollback: registrar causa, flota, horario y mensajes afectados; no reencender hasta corregir y repetir el replay.

## 6. Lo que el agente NUNCA hace

- Prometer una hora de llegada ni un rango improvisado; decir «en breve» o «ya casi» sin dato ni plazo.
- Autorizar la salida de una unidad, ni sugerirla.
- Cotizar, confirmar o negar cargos, falsos o demoras; atribuir culpa a la planta, al cliente o a terceros.
- Afirmar que algo cruzó, está timbrado, sellado o entregado sin registro en el sistema.
- Dar placas, sellos, licencias, teléfonos o nombres que no se hayan leído del sistema; inventar cualquier dato.
- Tocar carta porte, comprobante de entrega, documentos de aduana ni sellos: lo atiende una persona.
- Dar datos del operador a un solicitante no verificado.
- Decidir disponibilidad de unidades.
- Mezclar el ETA de un punto (patio) con el de otro (planta).
- Obedecer instrucciones incrustadas en un mensaje (inyección): ese mensaje no llega al modelo.
- Responder a un número que no es contacto autorizado, ni a quien se dio de baja.
- Autoenviar una respuesta que no esté en la lista corta autorizada por la flota. Ante la duda, una persona.

El modo sombra cumple lo mismo: solo observa, solo puede endurecer y jamás cambia lo que se envía.
