# Encender la emisión real de CFDI — el runbook del día uno

**Estado al 2-oct-2026:** TODO el circuito técnico está construido y en ensayo,
y desde el 0540–0542 la emisión real pasa por **siete llaves**, no por dos
(detalle y operación diaria en `docs/operacion/agente-autofactura.md`). Falta:
lo LEGAL (cláusula publicada), **verificar al menos un portal contra el sitio
real** (hoy 0 de 21) y la **primera emisión supervisada**. Este documento es la
lista exacta de ese día.

## Por qué está apagado (el candado, en una frase)

Emitir un CFDI presentando el RFC del cliente ante CAPUFE es actuar en su
representación, y el `/terminos` publicado dice hoy lo contrario ("Likida no
timbra facturas"). La auditoría 10 lo encontró y el código lo cerró con dos
llaves globales (`modo.ts`): `FACTURACION_MODO=emitir` **y**
`FACTURACION_MANDATO_ACEPTADO=si`. Sin la segunda, todo corre en ensayo:
se llena el portal y NO se aprieta emitir.

Desde la 0542 hay cinco llaves más, **por flota** y arbitradas por la base: el
mandato de la flota (`aceptacion_legal`), la bandera `emision_real` de la flota,
el portal **verificado** contra el sitio real, la fase del portal (supervisada:
una persona confirma cada lote) y los límites de monto y cupo diario. Cualquiera
cerrada = ensayo, y el motivo se dice.

## Lo que YA está listo (verificado)

- **La cláusula de mandato está REDACTADA**:
  `docs/conocimiento/legal/tos-mandato-borrador.md` — borrador de una página
  esperando visto bueno del abogado, con las notas para él incluidas.
- **Pre-vuelo contra el portal real de CAPUFE** (13-ago-2026, solo lectura,
  reporte en `pruebas-manuales/ensayo/2026-08-14/capufe-prevuelo.txt`):
  - ✅ 11 selectores del adaptador casan contra el DOM real (RFC, nombre,
    CP, régimen, uso CFDI, correo, código, botón Validar, tabla, checkbox
    de partidos —que `clicSeguro()` prohíbe—, cuadro de error).
  - ⚠️ El **botón de emitir no existe en la página inicial** — aparece
    después de validar un código. NO es corregible sin un ticket real: la
    primera corrida de ensayo con código de verdad lo confirma (paso 4).
  - ⚠️ Los dos buscadores de respaldo (xpath) no están — se pierde ese
    camino, no es fatal. Los catálogos de los <select> se llenan por un POST
    que el pre-vuelo aborta a propósito: en ensayo real sí cargan.
  - ✅ Sin CAPTCHA bloqueante en pantalla (hay reCAPTCHA v3 invisible, que
    el adaptador tolera; si algún día bloquea, el ticket cae a `bloqueo` y
    a la cola del jefe — ese camino ya existe y se ve en el panel).
- **El resto del ciclo foto→CFDI ya opera**: OCR → cuadre → cierre →
  cron `facturar` (lotes por portal, red de seguridad horaria) → sello
  `cfdi_uuid`+`cfdi_orden` → cola del jefe para lo que pide cuenta o se
  bloquea → "Ya quedó" manual con folio validado.

## El día uno, en orden

> **DECISIÓN TOMADA (13-ago-2026):** Javier eligió encender **bajo su propio
> riesgo, sin revisión de abogado**, PERO hasta cerrar el primer cliente:
> "cuando ya cierre el primer cliente, recuérdame hacer eso". El disparador
> es ese — al primer cliente cerrado, ejecutar esta lista desde el paso 2.

1. **Visto bueno del abogado** al borrador (o decisión expresa de Javier de
   publicarlo bajo su propio riesgo — es su producto; que quede por escrito.
   ← Ya quedó por escrito: ver el recuadro de arriba).
2. **Publicar `/terminos`** con el texto corregido y la cláusula de mandato
   (secciones 1 y 2 del borrador). Sin este paso, el candado NO se toca.
3. **Variables en Vercel** (las pone Javier — el CLI, no el panel):
   `FACTURACION_MODO=emitir` y `FACTURACION_MANDATO_ACEPTADO=si`, y un
   commit con `[deploy]` en el asunto.
4. **Migraciones 0540–0542 aplicadas** en la base ANTES de ese despliegue
   (la compuerta `[deploy]` lo exige). Sin la 0542 el control no contesta y
   todo sigue en ensayo (falla cerrado).
5. **Por cada flota que va a emitir** (lo hace su dueño, en
   `/dashboard/legal` y `/dashboard/agentes/facturas`): otorgar el mandato de
   autofacturación, y **encender la emisión real** de la flota. Arranca con los
   límites por omisión (1,500 por ticket, 3 por lote, 10 al día, 10,000 al día) y
   con cada portal en fase **supervisada**.
6. **Verificar el portal** contra el sitio real
   (`docs/operacion/verificacion-portales.md`). Sin esa visita el portal no
   emite aunque todo lo demás esté abierto. CAPUFE tiene adaptador propio y está
   exento del registro.
7. **Primera emisión SUPERVISADA**: el agente propone un lote, una persona lo
   confirma en el panel (Facturas en automático) y se mira UN ticket real de
   CAPUFE en el log — confirma el botón de emitir (el hueco del pre-vuelo), el
   cuadro de error y el contenedor del UUID, los tres que solo se ven emitiendo.
   Si el botón real no casa, `OpcionesCapufe.selectores` lo sobrescribe sin
   tocar lógica.
8. **Verificar el sello**: el gasto queda con `cfdi_uuid` + `cfdi_orden`, el
   XML llega al correo capturado, el ticket sale de la cola del panel y el cupo
   del día muestra lo emitido.
9. **Promoción a autónomo** (opcional, decisión del dueño): solo tras 3
   emisiones reales confirmadas con UUID en ese portal; los límites siguen
   mandando.

### Si el portal pide cuenta (CAPTCHA o código de dos pasos)

Hay un paso humano que Likida no resuelve ni rodea: el dueño genera un código en
el panel y alguien con pantalla corre `scripts/vincular-portal.mjs --codigo …`
(`docs/operacion/agente-autofactura.md`, sección 3). **Hoy ese script vive en el
repositorio**, así que lo opera el equipo de Likida con la persona del cliente;
la forma de entregárselo al cliente (paquete `npx` o binario) está pendiente de
decisión de Javier.

## Lo que NO cubre este encendido

- El RFC del tenant demo es de un TERCERO (con permiso): no emitir contra
  ese RFC sin su instrucción escrita — la nota 4 del borrador legal existe
  por esto.
- "Timbrar" en sentido PAC (emitir CFDI de INGRESO de la flota a sus
  clientes, o la factura de la mensualidad de Likida) es OTRO producto:
  requiere CSD del emisor y un PAC (Facturama/SW/Finkok). No se enciende con
  estas llaves. (La Carta Porte sí se timbra y se cancela por PAC, 0226/0541,
  con su propio candado.)
- **Cancelar** un CFDI emitido por un portal de tercero: no hay API. Lo cancela
  una persona; por eso la primera emisión es supervisada.
