# Verificación de portales de autofactura (runbook)

> Generado desde el código por `npx tsx scripts/generar-doc-verificacion.ts`. **No lo edites a mano**: una prueba falla si difiere del render.

## Qué significa «verificado»

Un portal solo emite CFDI si su guion está **verificado**, y eso solo lo dice una **corrida supervisada contra el portal real**. Hay dos señales independientes y la pantalla las muestra por separado:

| Señal | La calcula | Qué prueba | Qué NO prueba |
|---|---|---|---|
| **Contrato** | las pruebas, en cada push (`autofactura/contrato_portales.test.ts`: motor real + Chromium + HTML fixture, sin red) | que la tabla de selectores es válida y que el motor llena, aprieta, lee el UUID y el rechazo, y falla cerrado ante portal caído o CAPTCHA | que el portal real sea así: los fixtures `sintetico_desde_guion` se derivan de la propia tabla |
| **Real** | `scripts/verificar-portal.mjs`, con confirmación humana | que los selectores del formulario en blanco existen EN EL PORTAL REAL (visita de solo lectura) | el botón de emitir en varios portales, el contenedor del UUID, el cuadro de error y el XML: solo aparecen al emitir. Por eso la **primera emisión real sigue supervisada** |

Si alguien cambia un selector después de la corrida, la huella de la tabla ya no coincide y el portal pasa a **obsoleto** (vuelve a no emitir). Escribir `verificado` a mano en `portales.ts` no habilita nada.

**Estado hoy: 0 de 21 guiones verificados contra el portal real.**

## Cómo se corre (una persona, una visita, solo lectura)

```bash
npx tsx scripts/verificar-portal.mjs --listar
npx tsx scripts/verificar-portal.mjs <clave> --visita-real --yo "Nombre Apellido"
```

1. Exige `--visita-real` y `--yo`, una terminal interactiva (no corre en CI ni redirigido) y que teclees la frase `VISITAR <CLAVE> EN EL PORTAL REAL`.
2. Abre UNA vez el portal con un Chromium real. **Toda petición que no sea GET/HEAD se aborta** (emitir es un POST). No resuelve CAPTCHA, no teclea nada, no envía formularios.
3. Deja evidencia en `pruebas-manuales/verificacion-portales/<clave>/<fecha>/` (`reporte.txt`, `captura.jpg`, `dom-saneado.html`).
4. Solo si NO hubo CAPTCHA y resolvieron todos los selectores del formulario en blanco, escribe la entrada en `src/lib/likida/facturacion/adaptadores/verificaciones.json` (huella de la tabla, sha256 del reporte, quién confirmó) y guarda el DOM saneado como fixture `grabado`.
5. **Revisa el diff antes de commitear**: el DOM saneado va a git (`sanearHtml` quita scripts, valores, tokens, correos y RFC, pero es la primera barrera, no la única).
6. Con el portal verificado, la emisión real sigue el flujo supervisado de `docs/operacion/agente-autofactura.md` (bandera por flota, límites, confirmación humana por lote).

Si sale `no_graduar_selectores`, el reporte lista cuáles faltaron y el inventario real de la página: corrige los candidatos en `portales.ts`, regenera fixtures (`npx tsx scripts/generar-fixtures-portales.ts`) y vuelve a correr. Si sale `no_graduar_captcha`, ese portal va por vinculación asistida / modo asistido, no por emisión automática.

## Estado por portal

| Portal | Real (visita supervisada) | Contrato (fixture) | Sesión | Bloqueo del catálogo |
|---|---|---|---|---|
| Office Depot (`office_depot`) | no verificado | sintetico_desde_guion | sin cuenta | — |
| ControlNet (multi-comercio: Walmart, Alsea, OXXO, gasolineras) (`controlnet`) | no verificado | sintetico_desde_guion | sin cuenta | — |
| Enerser (gasolineras: Efigas, Palmira, Bahía Asunción…) (`enerser`) | no verificado | sintetico_desde_guion | sin cuenta | — |
| AutoZone México (refacciones) (`autozone`) | no verificado | sintetico_desde_guion | sin cuenta | muro_anti_bot |
| FacturaGAS® / ControlGAS (estaciones Pemex independientes) (`facturagas`) | no verificado | sintetico_desde_guion | sin cuenta | — |
| Sevafusa (24 estaciones de servicio del noroeste) (`sevafusa`) | no verificado | sintetico_desde_guion | sin cuenta | — |
| Gogas (`gogas`) | no verificado | sintetico_desde_guion | sin cuenta | — |
| OXXO (tienda) (`oxxo`) | no verificado | sintetico_desde_guion | sin cuenta | — |
| Red Estatal de Autopistas de Nuevo León (REANL) (`red_estatal_autopistas`) | no verificado | sintetico_desde_guion | sin cuenta | — |
| Super Carreteras del Norte (Allende–Agujita, Premier) (`supercarreteras`) | no verificado | sintetico_desde_guion | sin cuenta | — |
| ARCO Chihuahua (Petrol / ADFSA) (`arco_chihuahua`) | no verificado | sintetico_desde_guion | sin cuenta | — |
| Circle K México (`circle_k`) | no verificado | sintetico_desde_guion | sin cuenta | — |
| Red de Carreteras de Occidente (9 autopistas) (`redviacorta`) | no verificado | sintetico_desde_guion | sin cuenta | — |
| Libramientos META / Quadrum / Valoran (San Luis Potosí) (`libramientos_meta`) | no verificado | sintetico_desde_guion | sin cuenta | — |
| McDonald's México (`mcdonalds`) | no verificado | sintetico_desde_guion | sin cuenta | — |
| Los Bisquets Bisquets Obregón (BB del Sur) (`lbbo`) | no verificado | sintetico_desde_guion | sin cuenta | — |
| Tim Hortons México (`tim_hortons`) | no verificado | sintetico_desde_guion | sin cuenta | — |
| The Home Depot México (`home_depot`) | no verificado | sintetico_desde_guion | sin cuenta | — |
| Lo de Mored (Fomento Gasolinero, Mérida) (`lodemored`) | no verificado | sintetico_desde_guion | sin cuenta | — |
| Parrot (plataforma de punto de venta para restaurantes) (`parrot`) | no verificado | sintetico_desde_guion | sin cuenta | — |
| El Globo (Tradición en Pastelerías) (`el_globo`) | no verificado | sintetico_desde_guion | sin cuenta | — |

## Ficha de verificación por portal

Lo que hay que mirar en cada visita. «Apuestas» son los elementos que el formulario en blanco no puede confirmar.

### Office Depot — `office_depot`

- URL: https://facturacion.officedepot.com.mx/#/generaF
- Datos fiscales de la flota que pide: rfc, correo
- Campos del ticket: numeroTicket, monto
- Botón de emitir (apuesta): `button:has-text("Facturar"), input[type="submit"][value*="Facturar" i]` o `button:has-text("Generar"), input[type="submit"][value*="Generar" i]`
- Contenedor del UUID (apuesta, solo se ve emitiendo): `.uuid, [class*="folio-fiscal" i], [data-uuid]`
- XML: `button:has-text("XML"), input[type="submit"][value*="XML" i]` o `a[href$=".xml"]` (solo tras emitir)
- Selectores derivados de la etiqueta del campo (hipótesis): el pre-vuelo puede no resolver todo.
- Comando: `npx tsx scripts/verificar-portal.mjs office_depot --visita-real --yo "Nombre Apellido"`

### ControlNet (multi-comercio: Walmart, Alsea, OXXO, gasolineras) — `controlnet`

- URL: https://www.controlnet.com.mx/Factura
- Datos fiscales de la flota que pide: rfc, correo
- Campos del ticket: numeroTicket
- Paso de búsqueda previo: el botón de consultar el ticket
- Botón de emitir (apuesta): `button:has-text("Facturar"), input[type="submit"][value*="Facturar" i]` o `button:has-text("Generar factura"), input[type="submit"][value*="Generar factura" i]`
- Contenedor del UUID (apuesta, solo se ve emitiendo): `.uuid, [class*="folio-fiscal" i], [data-uuid]`
- XML: `button:has-text("XML"), input[type="submit"][value*="XML" i]` o `a[href$=".xml"]` (solo tras emitir)
- Selectores derivados de la etiqueta del campo (hipótesis): el pre-vuelo puede no resolver todo.
- Comando: `npx tsx scripts/verificar-portal.mjs controlnet --visita-real --yo "Nombre Apellido"`

### Enerser (gasolineras: Efigas, Palmira, Bahía Asunción…) — `enerser`

- URL: https://facturacion.enerser.com.mx/invitado/facturacion-lote
- Datos fiscales de la flota que pide: rfc, correo
- Campos del ticket: referencia
- Botón de emitir (apuesta): `button:has-text("Facturar"), input[type="submit"][value*="Facturar" i]` o `button:has-text("Generar"), input[type="submit"][value*="Generar" i]`
- Contenedor del UUID (apuesta, solo se ve emitiendo): `.uuid, [class*="folio-fiscal" i], [data-uuid]`
- XML: `button:has-text("XML"), input[type="submit"][value*="XML" i]` o `a[href$=".xml"]` (solo tras emitir)
- Selectores derivados de la etiqueta del campo (hipótesis): el pre-vuelo puede no resolver todo.
- Comando: `npx tsx scripts/verificar-portal.mjs enerser --visita-real --yo "Nombre Apellido"`

### AutoZone México (refacciones) — `autozone`

- URL: https://www.autozone.com.mx/factura-electronica
- Datos fiscales de la flota que pide: rfc, correo
- Campos del ticket: transaccion, fecha, monto
- Paso de búsqueda previo: el botón de buscar la transacción
- Botón de emitir (apuesta): `button:has-text("Facturar"), input[type="submit"][value*="Facturar" i]` o `button:has-text("Generar factura"), input[type="submit"][value*="Generar factura" i]`
- Contenedor del UUID (apuesta, solo se ve emitiendo): `.uuid, [class*="folio-fiscal" i], [data-uuid]`
- XML: `button:has-text("XML"), input[type="submit"][value*="XML" i]` o `a[href$=".xml"]` (solo tras emitir)
- Selectores derivados de la etiqueta del campo (hipótesis): el pre-vuelo puede no resolver todo.
- **No se automatiza**: muro_anti_bot — Recon 28-ago-2026: 403 Forbidden en tres intentos con tres configuraciones distintas (Chromium headless con UA real; el mismo con Accept-Language es-MX y navigator.webdriver neutralizado; WebFetch). Bloqueo del borde, no caída. No se insistió con evasión.
- Comando: `npx tsx scripts/verificar-portal.mjs autozone --visita-real --yo "Nombre Apellido"`

### FacturaGAS® / ControlGAS (estaciones Pemex independientes) — `facturagas`

- URL: https://app.facturagas.net/generar_factura.aspx
- Datos fiscales de la flota que pide: rfc, nombre, correo, codigoPostal, regimenFiscal, usoCfdi
- Campos del ticket: sucursal, folio, webId
- Paso de búsqueda previo: el botón de consultar el ticket
- Botón de emitir (apuesta): `#btnGenFacUs` o `button:has-text("Generar Factura"), input[type="submit"][value*="Generar Factura" i]`
- Contenedor del UUID (apuesta, solo se ve emitiendo): `.uuid, [class*="folio-fiscal" i], [data-uuid]`
- XML: `button:has-text("XML"), input[type="submit"][value*="XML" i]` o `a[href$=".xml"]` (solo tras emitir)
- Selectores copiados del DOM real el 2026-08-28 (RECON-PORTALES-20.md §2.2); el pre-vuelo debería confirmarlos.
- Comando: `npx tsx scripts/verificar-portal.mjs facturagas --visita-real --yo "Nombre Apellido"`

### Sevafusa (24 estaciones de servicio del noroeste) — `sevafusa`

- URL: https://sevafusa.facturacionestacion.com/
- Datos fiscales de la flota que pide: rfc, nombre, correo, codigoPostal, regimenFiscal, usoCfdi
- Campos del ticket: referencia, folio, monto
- Paso de búsqueda previo: el botón de buscar el ticket
- Botón de emitir (apuesta): `button:has-text("Facturar"), input[type="submit"][value*="Facturar" i]` o `button:has-text("Generar"), input[type="submit"][value*="Generar" i]`
- Contenedor del UUID (apuesta, solo se ve emitiendo): `.uuid, [class*="folio-fiscal" i], [data-uuid]`
- XML: `button:has-text("XML"), input[type="submit"][value*="XML" i]` o `a[href$=".xml"]` (solo tras emitir)
- Selectores copiados del DOM real el 2026-08-28 (RECON-PORTALES-20.md §2.5); el pre-vuelo debería confirmarlos.
- Comando: `npx tsx scripts/verificar-portal.mjs sevafusa --visita-real --yo "Nombre Apellido"`

### Gogas — `gogas`

- URL: https://facturasgas.com/facturacion/autofactura.php
- Datos fiscales de la flota que pide: rfc, nombre, correo, codigoPostal, regimenFiscal, usoCfdi
- Campos del ticket: referencia
- Paso de búsqueda previo: el botón de agregar el ticket a la lista
- Botón de emitir (apuesta): `#Button_Insert` o `button:has-text("Solicitar Factura"), input[type="submit"][value*="Solicitar Factura" i]`
- Contenedor del UUID (apuesta, solo se ve emitiendo): `.uuid, [class*="folio-fiscal" i], [data-uuid]`
- Selectores copiados del DOM real el 2026-08-28 (RECON-PORTALES-17.md §2.3); el pre-vuelo debería confirmarlos.
- Comando: `npx tsx scripts/verificar-portal.mjs gogas --visita-real --yo "Nombre Apellido"`

### OXXO (tienda) — `oxxo`

- URL: https://www4.oxxo.com:9443/facturacionElectronica-web/views/layout/inicio.do
- Datos fiscales de la flota que pide: rfc, nombre, codigoPostal, regimenFiscal, usoCfdi
- Campos del ticket: fecha, folio, transaccion, monto
- Paso de búsqueda previo: el botón de continuar que valida el ticket
- Botón de emitir (apuesta): `#form\:generarFactura` o `button:has-text("Generar Factura"), input[type="submit"][value*="Generar Factura" i]`
- Contenedor del UUID (apuesta, solo se ve emitiendo): `.uuid, [class*="folio-fiscal" i], [data-uuid]`
- XML: `button:has-text("XML"), input[type="submit"][value*="XML" i]` o `a[href$=".xml"]` (solo tras emitir)
- Selectores copiados del DOM real el 2026-08-28 (RECON-PORTALES-17.md §2.5); el pre-vuelo debería confirmarlos.
- Comando: `npx tsx scripts/verificar-portal.mjs oxxo --visita-real --yo "Nombre Apellido"`

### Red Estatal de Autopistas de Nuevo León (REANL) — `red_estatal_autopistas`

- URL: https://www.qrplus.com.mx/REA_Facturacion/FormsFacturacion/FWizExprFacturacion.aspx
- Datos fiscales de la flota que pide: rfc, correo
- Campos del ticket: webId
- Paso de búsqueda previo: el botón de registrar el Web ID
- Botón de emitir (apuesta): `button:has-text("Facturar"), input[type="submit"][value*="Facturar" i]` o `button:has-text("Generar"), input[type="submit"][value*="Generar" i]`
- Contenedor del UUID (apuesta, solo se ve emitiendo): `.uuid, [class*="folio-fiscal" i], [data-uuid]`
- XML: `button:has-text("XML"), input[type="submit"][value*="XML" i]` o `a[href$=".xml"]` (solo tras emitir)
- Selectores copiados del DOM real el 2026-08-28 (RECON-PORTALES-17.md §2.15); el pre-vuelo debería confirmarlos.
- Comando: `npx tsx scripts/verificar-portal.mjs red_estatal_autopistas --visita-real --yo "Nombre Apellido"`

### Super Carreteras del Norte (Allende–Agujita, Premier) — `supercarreteras`

- URL: https://supercarreteras.haz-factura.com/blk_varios_tickets/blk_varios_tickets.php
- Datos fiscales de la flota que pide: rfc
- Campos del ticket: referencia
- Botón de emitir (apuesta): `button.btn-success` o `button:has-text("Facturar"), input[type="submit"][value*="Facturar" i]`
- Contenedor del UUID (apuesta, solo se ve emitiendo): `.uuid, [class*="folio-fiscal" i], [data-uuid]`
- XML: `button:has-text("XML"), input[type="submit"][value*="XML" i]` o `a[href$=".xml"]` (solo tras emitir)
- Selectores copiados del DOM real el 2026-08-28 (RECON-PORTALES-20.md §2.6); el pre-vuelo debería confirmarlos.
- Comando: `npx tsx scripts/verificar-portal.mjs supercarreteras --visita-real --yo "Nombre Apellido"`

### ARCO Chihuahua (Petrol / ADFSA) — `arco_chihuahua`

- URL: https://www.petrol.com.mx/facturacionpetrol/
- Datos fiscales de la flota que pide: rfc, nombre, correo, codigoPostal, regimenFiscal, usoCfdi
- Campos del ticket: sucursal, folio, monto
- Paso de búsqueda previo: el botón de agregar el ticket
- Botón de emitir (apuesta): `#BtnFacturar` o `input[value="Generar Factura"]`
- Contenedor del UUID (apuesta, solo se ve emitiendo): `.uuid, [class*="folio-fiscal" i], [data-uuid]`
- Selectores copiados del DOM real el 2026-08-28 (RECON-PORTALES-20.md §2.1); el pre-vuelo debería confirmarlos.
- Comando: `npx tsx scripts/verificar-portal.mjs arco_chihuahua --visita-real --yo "Nombre Apellido"`

### Circle K México — `circle_k`

- URL: https://facturacion.portalcck.com/
- Datos fiscales de la flota que pide: rfc, correo
- Campos del ticket: sucursal, folio, fecha
- Paso de búsqueda previo: el botón de consultar el ticket
- Botón de emitir (apuesta): `button:has-text("Facturar"), input[type="submit"][value*="Facturar" i]` o `button:has-text("Generar"), input[type="submit"][value*="Generar" i]`
- Contenedor del UUID (apuesta, solo se ve emitiendo): `.uuid, [class*="folio-fiscal" i], [data-uuid]`
- XML: `button:has-text("XML"), input[type="submit"][value*="XML" i]` o `a[href$=".xml"]` (solo tras emitir)
- Selectores copiados del DOM real el 2026-08-28 (RECON-PORTALES-20.md §2.3); el pre-vuelo debería confirmarlos.
- Comando: `npx tsx scripts/verificar-portal.mjs circle_k --visita-real --yo "Nombre Apellido"`

### Red de Carreteras de Occidente (9 autopistas) — `redviacorta`

- URL: https://redviacorta.mx/es/factura
- Datos fiscales de la flota que pide: rfc, nombre, correo, codigoPostal, regimenFiscal, usoCfdi
- Campos del ticket: folio, monto
- Paso de búsqueda previo: el botón de agregar el ticket
- Botón de emitir (apuesta): `button:has-text("Generar Factura"), input[type="submit"][value*="Generar Factura" i]`
- Contenedor del UUID (apuesta, solo se ve emitiendo): `.uuid, [class*="folio-fiscal" i], [data-uuid]`
- XML: `button:has-text("XML"), input[type="submit"][value*="XML" i]` o `a[href$=".xml"]` (solo tras emitir)
- Selectores copiados del DOM real el 2026-08-28 (RECON-PORTALES-20.md §2.4); el pre-vuelo debería confirmarlos.
- Comando: `npx tsx scripts/verificar-portal.mjs redviacorta --visita-real --yo "Nombre Apellido"`

### Libramientos META / Quadrum / Valoran (San Luis Potosí) — `libramientos_meta`

- URL: https://facturacionquadrum.com.mx/valoran/#/sinregistro
- Datos fiscales de la flota que pide: rfc, nombre, correo, codigoPostal, regimenFiscal, usoCfdi
- Campos del ticket: codigo
- Paso de búsqueda previo: el botón de avanzar al paso de capturar códigos
- Botón de emitir (apuesta): `button:has-text("Facturar"), input[type="submit"][value*="Facturar" i]` o `button:has-text("Generar"), input[type="submit"][value*="Generar" i]`
- Contenedor del UUID (apuesta, solo se ve emitiendo): `.uuid, [class*="folio-fiscal" i], [data-uuid]`
- XML: `button:has-text("XML"), input[type="submit"][value*="XML" i]` o `a[href$=".xml"]` (solo tras emitir)
- Selectores copiados del DOM real el 2026-08-28 (RECON-PORTALES-17.md §2.4 (paso 1); el paso 2 NO se leyó); el pre-vuelo debería confirmarlos.
- Comando: `npx tsx scripts/verificar-portal.mjs libramientos_meta --visita-real --yo "Nombre Apellido"`

### McDonald's México — `mcdonalds`

- URL: https://www.facturacionmcdonalds.com.mx/
- Datos fiscales de la flota que pide: rfc, nombre, codigoPostal, regimenFiscal, correo
- Campos del ticket: sucursal, numeroTicket, caja, fecha, monto
- Botón de emitir (apuesta): `#facturar` o `button:has-text("Realizar facturación"), input[type="submit"][value*="Realizar facturación" i]`
- Contenedor del UUID (apuesta, solo se ve emitiendo): `.uuid, [class*="folio-fiscal" i], [data-uuid]`
- Selectores copiados del DOM real el 2026-08-29 (pruebas-manuales/ensayo/2026-08-29/recon-portales-26.txt); el pre-vuelo debería confirmarlos.
- Comando: `npx tsx scripts/verificar-portal.mjs mcdonalds --visita-real --yo "Nombre Apellido"`

### Los Bisquets Bisquets Obregón (BB del Sur) — `lbbo`

- URL: https://autofacturacionlbbo.edimex.com.mx/edi2/AutofacturacionPublico
- Datos fiscales de la flota que pide: rfc, correo
- Campos del ticket: sucursal, folio, codigo
- Paso de búsqueda previo: el botón de facturar (revela el paso fiscal)
- Botón de emitir (apuesta): `button:has-text("Generar Factura"), input[type="submit"][value*="Generar Factura" i]` o `button:has-text("Emitir"), input[type="submit"][value*="Emitir" i]`
- Contenedor del UUID (apuesta, solo se ve emitiendo): `.uuid, [class*="folio-fiscal" i], [data-uuid]`
- Selectores copiados del DOM real el 2026-08-29 (pruebas-manuales/ensayo/2026-08-29/recon-portales-26.txt); el pre-vuelo debería confirmarlos.
- Comando: `npx tsx scripts/verificar-portal.mjs lbbo --visita-real --yo "Nombre Apellido"`

### Tim Hortons México — `tim_hortons`

- URL: https://timsboh.com/autofacturacion/busqueda
- Datos fiscales de la flota que pide: rfc, correo
- Campos del ticket: sucursal, numeroTicket, fecha, monto
- Paso de búsqueda previo: el botón de buscar el ticket
- Botón de emitir (apuesta): `button:has-text("Facturar"), input[type="submit"][value*="Facturar" i]` o `button:has-text("Generar"), input[type="submit"][value*="Generar" i]`
- Contenedor del UUID (apuesta, solo se ve emitiendo): `.uuid, [class*="folio-fiscal" i], [data-uuid]`
- Selectores copiados del DOM real el 2026-08-29 (pruebas-manuales/ensayo/2026-08-29/recon-portales-26.txt); el pre-vuelo debería confirmarlos.
- Comando: `npx tsx scripts/verificar-portal.mjs tim_hortons --visita-real --yo "Nombre Apellido"`

### The Home Depot México — `home_depot`

- URL: https://facturacion.homedepot.com.mx/
- Datos fiscales de la flota que pide: rfc
- Campos del ticket: numeroTicket
- Paso de búsqueda previo: el botón de continuar
- Botón de emitir (apuesta): `button:has-text("Facturar"), input[type="submit"][value*="Facturar" i]` o `button:has-text("Generar"), input[type="submit"][value*="Generar" i]`
- Contenedor del UUID (apuesta, solo se ve emitiendo): `.uuid, [class*="folio-fiscal" i], [data-uuid]`
- Selectores copiados del DOM real el 2026-08-29 (pruebas-manuales/ensayo/2026-08-29/recon-portales-26.txt); el pre-vuelo debería confirmarlos.
- Comando: `npx tsx scripts/verificar-portal.mjs home_depot --visita-real --yo "Nombre Apellido"`

### Lo de Mored (Fomento Gasolinero, Mérida) — `lodemored`

- URL: https://fact.lodemored.net/
- Datos fiscales de la flota que pide: rfc, nombre, correo, codigoPostal, regimenFiscal, usoCfdi
- Campos del ticket: numeroTicket, fecha, monto
- Paso de búsqueda previo: el botón de agregar el ticket a la lista
- Botón de emitir (apuesta): `#lnkBtnFacturar` o `button:has-text("GENERAR FACTURA"), input[type="submit"][value*="GENERAR FACTURA" i]`
- Contenedor del UUID (apuesta, solo se ve emitiendo): `.uuid, [class*="folio-fiscal" i], [data-uuid]`
- Selectores copiados del DOM real el 2026-08-29 (pruebas-manuales/ensayo/2026-08-29/recon-portales-26.txt); el pre-vuelo debería confirmarlos.
- Comando: `npx tsx scripts/verificar-portal.mjs lodemored --visita-real --yo "Nombre Apellido"`

### Parrot (plataforma de punto de venta para restaurantes) — `parrot`

- URL: https://facturacion.parrot.rest/
- Datos fiscales de la flota que pide: rfc, correo
- Campos del ticket: codigo
- Botón de emitir (apuesta): `button:has-text("Facturar"), input[type="submit"][value*="Facturar" i]` o `button:has-text("Generar"), input[type="submit"][value*="Generar" i]` o `button[type="submit"]`
- Contenedor del UUID (apuesta, solo se ve emitiendo): `.uuid, [class*="folio-fiscal" i], [data-uuid]`
- Selectores copiados del DOM real el 2026-08-29 (pruebas-manuales/ensayo/2026-08-29/recon-portales-26.txt); el pre-vuelo debería confirmarlos.
- Comando: `npx tsx scripts/verificar-portal.mjs parrot --visita-real --yo "Nombre Apellido"`

### El Globo (Tradición en Pastelerías) — `el_globo`

- URL: https://www.masfacturaweb.com.mx:73/ElGlobo/
- Datos fiscales de la flota que pide: rfc, usoCfdi
- Campos del ticket: numeroTicket, sucursal, monto, fecha
- Botón de emitir (apuesta): `button:has-text("Generar"), input[type="submit"][value*="Generar" i]` o `button:has-text("Facturar"), input[type="submit"][value*="Facturar" i]` o `button:has-text("Confirmar"), input[type="submit"][value*="Confirmar" i]`
- Contenedor del UUID (apuesta, solo se ve emitiendo): `.uuid, [class*="folio-fiscal" i], [data-uuid]`
- Selectores copiados del DOM real el 2026-08-29 (pruebas-manuales/ensayo/2026-08-29/recon-portales-26.txt); el pre-vuelo debería confirmarlos.
- Comando: `npx tsx scripts/verificar-portal.mjs el_globo --visita-real --yo "Nombre Apellido"`

