# Encender la emisión real de CFDI — el runbook del día uno

**Estado al 13-ago-2026 (noche):** TODO el circuito técnico está construido y
en ensayo. Lo único que falta para que Likida timbre de verdad es LEGAL, no
código. Este documento es la lista exacta de ese día.

## Por qué está apagado (el candado, en una frase)

Emitir un CFDI presentando el RFC del cliente ante CAPUFE es actuar en su
representación, y el `/terminos` publicado dice hoy lo contrario ("Likida no
timbra facturas"). La auditoría 10 lo encontró y el código lo cerró con dos
llaves (`modo.ts`): `FACTURACION_MODO=emitir` **y**
`FACTURACION_MANDATO_ACEPTADO=si`. Sin la segunda, todo corre en ensayo:
se llena el portal y NO se aprieta emitir.

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

1. **Visto bueno del abogado** al borrador (o decisión expresa de Javier de
   publicarlo bajo su propio riesgo — es su producto; que quede por escrito).
2. **Publicar `/terminos`** con el texto corregido y la cláusula de mandato
   (secciones 1 y 2 del borrador). Sin este paso, el candado NO se toca.
3. **Variables en Vercel** (las pone Javier — el CLI, no el panel):
   `FACTURACION_MODO=emitir` y `FACTURACION_MANDATO_ACEPTADO=si`, y un
   commit con `[deploy]` en el asunto.
4. **Primera emisión SUPERVISADA**: un solo ticket real de CAPUFE, mirando
   el log — confirma el botón de emitir (el hueco del pre-vuelo), el cuadro
   de error y el contenedor del UUID, los tres que solo se ven emitiendo.
   Si el botón real no casa, `OpcionesCapufe.selectores` lo sobrescribe sin
   tocar lógica.
5. **Verificar el sello**: el gasto queda con `cfdi_uuid` + `cfdi_orden`, el
   XML llega al correo capturado, y el ticket sale de la cola del panel.

## Lo que NO cubre este encendido

- El RFC del tenant demo es de un TERCERO (con permiso): no emitir contra
  ese RFC sin su instrucción escrita — la nota 4 del borrador legal existe
  por esto.
- "Timbrar" en sentido PAC (emitir CFDI de INGRESO de la flota a sus
  clientes, o la factura de la mensualidad de Likida) es OTRO producto:
  requiere CSD del emisor y un PAC (Facturama/SW/Finkok). No existe hoy y
  no se enciende con estas llaves.
