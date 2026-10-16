# Conexión al sistema de transporte del cliente: red (Zero Trust, IP fija, VPN)

Estado: **recomendación escrita; la decisión y cualquier gasto son de Javier.** No se contrató ni se configuró nada.
Origen del requisito: el cliente describió una plataforma de seguridad tipo Zero Trust con las aplicaciones detrás del firewall, sin acceso directo desde internet.

## Qué sabemos del código
- `httpsPublico` y el modo SQL del conector de tabla propia **rechazan redes privadas por diseño** (anti-SSRF). Una VPN privada **no es alcanzable** desde el hosting tal cual.
- La prueba de conexión (`probar()` en `src/lib/likida/conectores/tms/ficha.ts`) distingue ahora, en frases llanas:
  - «no resuelve el nombre (DNS)» → la dirección está mal escrita o es solo interna. `no_se_sabe`.
  - «no conectó a tiempo (probable firewall)» → el firewall descarta el paquete. `no_se_sabe`.
  - «el servidor rechazó la conexión» → hay servidor pero no escucha para nosotros. `no_se_sabe`.
  - «respondió 403 (probable lista de IP permitidas)» → alguien contestó y nos negó. `no_sirve`.
  Ninguna de las tres primeras culpa a la credencial.
- El panel de `/dashboard/conexiones` muestra la IP de salida **solo si está confirmada** (propiedad `ipSalida`); sin IP no se promete ninguna.

## Opciones

| # | Opción | Qué pide al cliente | Costo | Riesgo | Veredicto |
|---|---|---|---|---|---|
| 1 | Lista blanca de IP de salida estáticas del hosting | Autorizar 1–2 IP en su firewall / política Zero Trust | Verificar el plan del hosting: las IP estáticas de salida son un complemento de pago; **si no está contratado, no se asume** | Si el hosting cambia de IP o el plan se cancela, la conexión cae en silencio | Preferida si el cliente acepta lista de IP y el costo se autoriza |
| 2 | Relevo mínimo con IP fija propia (un servidor pequeño que reenvía solo al host del sistema) | Autorizar la IP del relevo | Mensualidad pequeña del servidor + mantenimiento; **requiere autorización de gasto de Javier** | Un componente más que vigilar y parchar; debe reenviar únicamente al host acordado | Respaldo si el hosting no ofrece IP estática |
| 3 | VPN sitio a sitio | Túnel entre su red y la nuestra | Alto (equipos, soporte de su TI) | La red resultante es privada: **inalcanzable** por `httpsPublico`; sirve solo si termina en un relevo (opción 2) | Descartar salvo como parte del relevo |
| 4 | Plan B sin conexión entrante: exportaciones programadas (lector de archivos, T-TMS-13) o envío firmado hacia nosotros (el endpoint `/api/gps/push` ya existe para GPS) | Que su TI deje un archivo en un sitio acordado o haga un POST firmado saliente | Nulo o mínimo | Retraso de la información (no es tiempo real); depende de que su TI programe la exportación | Camino sin tocar su firewall; siempre disponible |

## Recomendación
1. Pedir primero la opción 4 en paralelo: no depende de abrir su red y ya tiene lector.
2. Si quieren lectura en vivo: opción 1 si el plan del hosting incluye IP estáticas; si no, opción 2.
3. No usar la opción 3 por sí sola.

## Cuenta de servicio
Siempre una cuenta de servicio de solo lectura creada para Likida, **sin correo personal**.

## Pendiente de decisión (Javier)
- ¿Se contrata IP estática de salida o se paga un relevo? (gasto)
- ¿Se enciende `ipSalida` en el panel cuando exista una IP confirmada?
