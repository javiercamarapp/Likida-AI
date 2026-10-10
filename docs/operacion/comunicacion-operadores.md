# Comunicación con operadores (Agente 11)

Todo lo que Likida le dice al chofer por WhatsApp y todo lo que el chofer contesta, hasta que el viaje arranca: el aviso de asignación, la
aceptación («sí», «no», un número, o una foto), el acuse y el canal por el que sale (texto o plantilla según la ventana de 24 h). Los hitos
posteriores («ya llegué», «ya cargué»…) los atiende el Agente 5, ver `agente-conductor.md`; la insistencia cuando nadie acepta es el Agente 8,
ver `escalacion-viaje-no-aceptado.md`.

> Estado al 2-oct-2026: construido y probado con dobles de base y de WhatsApp (`src/lib/likida/e2e/agente-11-comunicacion-operadores.e2e.test.ts`,
> 16 pruebas: feliz, fallo, duplicado, fuera de orden y otro tenant). **No se ha probado con un WABA real**: la plantilla `viaje_asignado` está en el catálogo
> con `textoVerificado: false` (reconstruida del código, hay que cotejarla con la que Meta aprobó). Migraciones: `0058` (marcas del viaje). Sin migraciones nuevas
> en las olas 4a-4d.

## El camino de un viaje, de la asignación a la aceptación

```
oficina crea el viaje con operador (o lo reasigna)
   └─► avisarAlChofer (operacion.ts) → notificarAsignacion (notificar.ts): plantilla `viaje_asignado`  ──► marca viaje.avisado_en
         · las instrucciones del convenio y el briefing de inicio salen aparte (ver abajo)
chofer contesta ──► atenderConfirmacion (confirmar_viaje.ts + inicio_viaje.ts, pura) ──► marca viaje.aceptado_en (UPDATE condicional)
                                                                                      └─► acuse por el selector enviarConFallback
nadie contesta a las 5 h ──► Agente 8 (cron `escalar`)
```

### 1. El aviso de asignación

- Sale por **plantilla** (`viaje_asignado`) y no por texto libre: Likida inicia la conversación y fuera de la ventana de 24 h WhatsApp solo entrega plantillas
  aprobadas. Los datos van una pieza por parámetro (folio, ruta, salida, unidad y anticipo); el cierre («manda por aquí la foto de cada ticket…») vive en el
  cuerpo aprobado.
- **No se inventa nada**: si falta la unidad o el anticipo el aviso dice que falta («no hay anticipo registrado»); un viaje sin folio ni ruta no se avisa; un operador sin
  teléfono de al menos 10 dígitos no recibe el aviso y el motivo se dice en pantalla.
- **`avisado_en` es lo único que hace visible el viaje para la escalación.** Solo se marca si el aviso salió. Si no salió (plantilla sin aprobar, número fuera de
  la lista de pruebas, operador sin teléfono) el viaje se queda como «no avisado» en el panel y NO escala solo: alguien tiene que resolverlo, y el log lo dice
  (`viaje.aviso_no_salio`, `viaje.aviso_sin_destinatario`). Una lectura de base fallida **lanza** en vez de volver en silencio.
- Después del aviso, la oficina o el sistema pueden mandar el briefing de inicio (0208) y las **instrucciones del convenio** (puerta, con quién reportarse; ver
  `convenios-clientes.md`): salen en la creación del viaje con operador, en la primera asignación posterior y al reasignar. El briefing es texto libre: solo entra si la
  ventana del chofer está abierta; si no, se reintenta cuando el chofer confirma.

### 2. La aceptación

El chofer contesta con una de estas formas; la decisión es una máquina de estados **pura** (`inicio_viaje.ts`) y el pegamento con la base es `confirmar_viaje.ts`:

| El chofer… | Qué pasa |
|---|---|
| «sí», «va», equivalentes | Si tiene UN viaje por confirmar, lo acepta: `aceptado_en` queda sellado con la hora de la **primera** respuesta y el acuse sale con la ruta. |
| «no» o equivalentes | No lo arranca; queda sin aceptar y se le explica que sin aceptarlo no se pueden anotar sus gastos. El jefe sigue enterándose a las 5 h. |
| un número | Con varios viajes por confirmar elige el que dijo y solo acepta ese. |
| «sí» con DOS viajes por confirmar | **No se elige por él** (`ambiguo`): se le pregunta cuál. Arrancar el equivocado carga los comprobantes de una ruta a la liquidación de otra y no se ve hasta el cuadre. |
| una foto de comprobante | Cuenta como aceptar: es trabajo hecho, y el jefe no debe recibir «tu chofer no confirmó» cuando ya mandó ocho tickets. |
| algo ininteligible | No acepta nada y se le vuelve a preguntar. |

Garantías con prueba en el E2E:

- **Duplicados**: «sí» y una foto a la vez, o aceptar dos veces, dejan UNA aceptación; el UPDATE lleva el candado `aceptado_en IS NULL`, así que la hora no se pisa.
- **Fuera de orden**: un viaje que Likida nunca avisó no se ofrece para confirmar (un «sí» no puede materializar un viaje); uno que ya se cerró no se acepta; una
  respuesta para un viaje que ya no es el actual del chofer se ignora.
- **Otro tenant / otro chofer**: la aceptación se acota por (viaje, flota, operador). Un chofer no puede aceptar el viaje de un compañero ni el de otra flota, ni
  cambiando un uuid a mano.
- **Fallo de base**: `viajesPorConfirmar` falla cerrado (lanza); marcar la aceptación nunca le lanza al chofer, el viaje sigue sin aceptar y se reintenta con su
  siguiente mensaje.

### 3. El canal de salida (texto o plantilla)

Todo acuse sale por `enviarConFallback`: con la ventana de 24 h abierta, texto; cerrada, la plantilla del catálogo; desconocida, texto y, si Meta lo rechaza por
ventana, plantilla. Cada decisión queda en `wa_envio_registro` con su motivo. Un rechazo reintentable (429, 5xx) ya queda en `wa_outbox` y no se duplica con una
plantilla. El acuse de la aceptación fuera de ventana sale por plantilla y no se pierde en silencio.

## Hitos del viaje

`atenderConductor` (Agente 5) los registra: el primer «ya llegué» es la llegada a CARGAR y no sella el destino del legado 0090; un «ya llegué» repetido deja UN solo
hito y conserva la primera hora; el chofer de otra flota con el viaje de la mía no registra nada. El intérprete anterior (`hitos_viaje.ts`) ya no está en el camino y se retiró del
repositorio en la ronda 11.

## Operación

- No hay cron propio: la aceptación corre en el webhook de WhatsApp y el aviso en la creación o reasignación del viaje.
- Para que el aviso salga fuera de ventana hace falta la plantilla `viaje_asignado` aprobada por Meta (ver `plantillas-meta.md`); hasta entonces los avisos a choferes
  que no han escrito en 24 h devuelven `132001` y el panel lo dice.
- Un chofer nuevo entra con la invitación (`operador_invitacion_v1`, también por aprobar). Los teléfonos de demo son siempre de la serie 28999…

## Bloqueos externos

1. Número y WABA reales; aprobación de `viaje_asignado` y cotejo de su texto contra el que Meta tiene.
2. Teléfonos reales de los choferes y del jefe de cada flota (el aviso y la escalación dependen de ellos).
3. Nada de esto se probó contra WhatsApp real: los dobles siguen el contrato documentado de la Cloud API.
