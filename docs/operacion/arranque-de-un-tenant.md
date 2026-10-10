# Arranque de un tenant nuevo (sin tocar la base)

Pantalla guía dentro del panel: **/dashboard/arranque** («Puesta en marcha»). Cada paso
se palomea solo con una señal real del tenant; uno cuya lectura falló dice «no pude
comprobarlo». Esta nota es el orden y lo que requiere a Likida.

## Lo que hace Likida (una vez por flota, fuera del panel del cliente)
1. **Alta del tenant**: razón social, domicilio fiscal y liga del aviso de privacidad
   (`/admin/flotas`). Sin ellos el bot frena a cada chofer en su primer mensaje.
2. **`LIKIDA_WHATSAPP_NUMERO`** (variable de entorno, número comercial verificado con
   código de país). Lo enseña `/dashboard/whatsapp` con enlace `wa.me`, QR y cartel. Si
   el número es de prueba, `LIKIDA_WHATSAPP_NUMERO_PRUEBA=1` lo marca. **No** se deriva
   de `WHATSAPP_PHONE_NUMBER_ID`.
3. **Plantilla `operador_invitacion_v1`** aprobada en Meta (ver `plantillas-meta.md`):
   sin ella la invitación masiva sale solo dentro de la ventana de 24 h.
4. Migraciones **0460–0462** aplicadas (patio del jefe, invitaciones, conteos por patio)
   antes de desplegar.

## Lo que hace el dueño (en el panel)
| Paso | Dónde | Notas |
|---|---|---|
| Perfil fiscal | `/dashboard/onboarding` | «Lo confirmo con mi contador» abre el Resumen con un aviso permanente; el estímulo de peaje sigue en $0 |
| Patios (opcional) | `/dashboard/patios` | Crear/editar/borrar; asignar jefes de tráfico; mover lo que quedó sin patio |
| Jefes de tráfico | `/dashboard/usuarios` + Patios | Con patio solo corrigen lo de su patio |
| Operadores | `/dashboard/operadores` | Uno por uno o CSV/Excel: plantilla, **revisar** (no escribe), confirmar. Hasta 2,000 filas / 4 MB |
| Unidades | `/dashboard/unidades` | Igual; sin columna de económico se usa la placa |
| Invitar choferes | Operadores → «Enviar invitaciones pendientes» | Cada invitación es un mensaje de WhatsApp (costo de Meta) que el dueño confirma; salen 40 por vez |
| Política de gastos | `/dashboard/politicas` | La heredada no cuenta como declarada |

## Qué ve cada rol
- **Dueño / soporte**: todo lo anterior.
- **Jefe de tráfico sin patio**: corrige, da de baja y da de alta a toda la flota; no toca dinero ni configuración.
- **Jefe con patio**: solo lo de su patio (operadores, unidades, jornadas) y crea siempre en el suyo.
- **Contador**: no ve operadores ni unidades.

## Límites conocidos (no cerrables por código)
- Número real de WhatsApp y aprobación de plantillas en Meta (2–5 días hábiles).
- Razón social y domicilio los captura Likida en `/admin`; el cliente no los edita aún.
- Aún no hay rol «capturista»: un capturista es un encargado (con o sin patio).
