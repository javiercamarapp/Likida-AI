# Demo en vivo: Likida factura — guion y pre-vuelo (reunión con Gal)

> Escrito el 20-ago-2026. El demo es por WhatsApp, contra producción
> (app.likida.ai), con el tenant G3M (RFC GMX0902279I1, validado contra el
> validador real: dígito verificador correcto, cero problemas).
>
> **ACTUALIZADO el 20-ago (tarde): ya NO hay datos sembrados.** Se borró el
> movimiento demo entero —5 viajes, 4 gastos, 4 liquidaciones, 5 operadores
> ficticios, 3 terminales, 25 comprobantes huérfanos, las conversaciones de
> WhatsApp y el histórico de costo de IA— porque el software sale a mercado y
> una base con choferes inventados no es un producto, es una maqueta. El demo
> se enseña con **un ticket real de Javier**, no con una siembra.
>
> Lo que queda vivo: la flota, sus cuatro cuentas y **un solo operador —
> Javier Cámara Portepetit, 529993700779**, que es a la vez el chofer y el
> dueño. Eso ahora funciona de verdad: ver «Un número, las dos caras» abajo.
>
> Para volver a sembrar, `supabase/seed.sql` es idempotente y sigue en el repo.

## La historia que se cuenta (2 minutos)

El chofer fotografía su ticket y lo manda por WhatsApp. Likida lo lee, lo
registra en el viaje abierto y decide QUIÉN factura:

| El portal…                      | Quién factura | Qué se ve en el demo                                    |
| ------------------------------- | ------------- | ------------------------------------------------------- |
| tiene adaptador escrito (CAPUFE)| la máquina    | ensayo real: el robot llena el portal y captura pantalla |
| tiene ficha, sin adaptador      | el piloto de visión (`FACTURACION_PILOTO=si`) | llena guiado por el modelo, se detiene antes de emitir |
| pide cuenta, cuenta compartida  | el piloto, con la sesión del cofre | login + llenado; la contraseña jamás viaja al modelo |
| pide cuenta, sin compartir      | el encargado  | WhatsApp con la liga + WebID + plazo, listo para teclear |
| pide CAPTCHA (Megasur/G500)     | el encargado  | mismo mensaje; el captcha NUNCA se rodea                 |

La frase honesta para Gal: **"lo que la máquina puede probar, lo hace sola;
lo que no, te llega al teléfono con todo listo — y nada se pierde en
silencio."**

## El flujo en vivo (lo que se teclea y lo que llega)

1. **Foto del ticket de Megasur/G500** desde el WhatsApp de prueba
   (529993700779) → acuse del chofer en segundos, gasto en el viaje abierto.
2. A la **media hora en punto** corre `/api/cron/facturar` (`:30`,
   vercel.json). Megasur trae reCAPTCHA (pre-vuelo del 20-ago), así que el
   ticket sale de la cola automática y…
3. …al **encargado le llega el WhatsApp completo**: liga del portal, WebID,
   plazo y el porqué ("ese portal lo tiene que hacer una persona"). Desde el
   PR #33 va el TEXTO ÍNTEGRO (sendText dentro de ventana de 24 h; plantilla
   `plazo_factura` solo de respaldo).
4. Se abre la liga delante de Gal, se pega el WebID → la factura sale en un
   minuto. Ese es el cierre: "esto que acabas de hacer en un minuto, el robot
   lo hace solo donde el portal lo permite — mira" →
5. **Ensayo del robot en pantalla**: correr desde la Mac
   `TENANT_ID=… GASTO_ID=… npx vitest run --config pruebas-manuales/vitest.config.ts pruebas-manuales/factura-punta-a-punta.prueba.ts`
   sobre un ticket CAPUFE (o un pilotable con `FACTURACION_PILOTO=si`): llena
   el portal real, JPEG de evidencia, y NO emite (candado del mandato).

## Pre-vuelo del domingo (nada de esto se improvisa el lunes)

- [ ] **Deploy vigente**: el último deployment de Vercel corresponde al último
      commit `[deploy]` de master (el ignoreCommand falla en silencio).
- [x] **Encargado con teléfono** en el tenant G3M. **HECHO** — `app_user`
      `f8380948`, hoy rol `flota_admin`, tel. `529993700779`.
      `telefonoJefeDe` sí devuelve destinatario (comprobado el 20-ago con el
      MCP de Supabase ya reconectado).
- [x] **Un operador con ese mismo número. HECHO** — Javier Cámara Portepetit,
      `529993700779`. Es lo que le permite mandar la foto del ticket: el camino
      de oficina NO acepta fotos, solo el de chofer.
- [x] **Datos fiscales de la flota — CONFIRMADOS por Javier el 20-ago.**
      `Flota G3M` · razón social `G3M SA DE CV` · RFC `GMX0902279I1` · régimen
      `601` (General de Ley Personas Morales) · CP fiscal `97000` · uso `G03`.
      Los CINCO del receptor, más el correo del contador
      (`javiercamaraportepetit+cfdi@gmail.com`) para recibir el CFDI:
      `getFiscalDeFlota` ya devuelve flota válida y **la facturación está
      desbloqueada**.

      Vale la pena conservar cómo se corrigió: primero se capturó `G3M` a secas,
      y `revisarReceptor` la aceptó —solo exige 3 caracteres—. Nuestra
      validación no puede saber cómo la tiene el SAT, y el SAT compara LITERAL:
      el PAC habría rechazado el timbrado por el sufijo faltante, en producción
      y con el ticket ya gastado. La comprobación que sirvió fue humana, contra
      la Constancia. Repetir la advertencia con cada flota nueva.
- [ ] **`domicilio_fiscal` — sigue mal Y SE PUBLICA.** Dice "Carretera
      Silao-Romita Km 4.5, 36100 Silao, Guanajuato": dato marcado 🔴 INVENTADO
      en `seed.sql`, e incoherente con el CP fiscal 97000 (Mérida). Se sirve en
      `/aviso/<tenant>` —página PÚBLICA— junto a la razón social. No se puede
      inventar, y `getDatosResponsable` no manda el aviso de privacidad sin él,
      así que sin este dato el chofer no puede ni mandar su primer ticket.
- [ ] **Plantilla `plazo_factura` aprobada** en Meta (respaldo fuera de
      ventana). Para el demo basta la ventana: manda un "hola" desde el
      teléfono del encargado antes de empezar y el texto completo entra.
- [ ] **Ventana de 24 h abierta** para el número del demo (el paso anterior).
- [ ] **Viaje abierto** del operador 529993700779. Ya no viene sembrado: se
      despacha por WhatsApp desde el mismo número («nuevo viaje para Javier
      Cámara Portepetit, Silao a Nuevo Laredo, anticipo 10000») — que es, de
      paso, una parte del producto que el guion viejo no enseñaba.
- [ ] **El OCR contesta.** El 20-ago a las 00:59 una ráfaga de 25 fotos falló
      25 de 25 con `fallo_tecnico` (429, truncamiento o proveedor de visión
      caído — `processor.ts` lo llama sistémico con esas palabras). Las 25 filas
      de `llm_costo` fase `ocr` traían `tokens_in/out = 0`. Los huérfanos ya se
      borraron, pero **no se ha comprobado que el OCR esté sano**: es el paso 1
      del guion y la base no puede responderlo. Mandar UNA foto antes del lunes.
- [ ] Si se enseña el piloto: `FACTURACION_PILOTO=si` en Vercel (y/o en la
      Mac para el ensayo local) y `OPENROUTER_API_KEY` vigente.
- [ ] Ticket CAPUFE de reserva por si el portal de Megasur está caído.
- [ ] `LIKIDA_CAPTURAS_DIR` puesto en la Mac para que el ensayo escriba JPEGs.

## Un número, las dos caras (20-ago-2026)

El número del demo es el chofer **y** la oficina, y hasta hoy eso no funcionaba:
`resolveOperador` acertaba primero y el camino de oficina no se probaba siquiera
(`processor.ts`, el `if (!op)`). O sea que dar de alta al dueño como operador
—lo único que le permite mandar tickets— le apagaba en silencio el despacho y
los informes por WhatsApp. `contactos.ts` documentaba desde la 0059 que un
número puede ser las dos cosas y que "quien llama decide con su contexto";
nadie decidía, porque nadie preguntaba.

Ahora los mandos de oficina viven en `atenderTextoOficina` y el camino del
chofer también los consulta. El reparto, que es lo que se puede enseñar:

| Lo que llega                        | Quién lo atiende                       |
| ----------------------------------- | -------------------------------------- |
| foto, XML, pin, botón               | el chofer, siempre — son de ruta        |
| «nuevo viaje para…», «asígnale…»    | oficina, aunque traiga viaje abierto    |
| «¿cómo van?», «informe en PDF»      | oficina                                 |
| «listo», «ya llegué» con viaje abierto | el chofer — el analista NO se le pone delante |
| pregunta suelta SIN viaje abierto   | el analista: ya no hay ruta que disputar |

El desempate del analista es el viaje abierto, y es el criterio que
`contactos.ts` ya nombraba. Importa porque el analista contesta CUALQUIER texto
—los demás reconocedores se apartan solos devolviendo `null`— así que en ruta se
comería «listo», que es con lo que se cierra un viaje.

Cubierto por `processor_dueno_maneja.test.ts` (7 casos, incluido el choque de
tenants: si el mismo número apunta a dos flotas no se adivina, se anota y se
sigue como chofer).

## Lo que NO se dice / no se hace (guardarraíles)

- No se promete "90% de precisión" ni cifras sin verificar; los dos contadores
  fiscales (IEPS diésel, estímulo casetas) siguen SIN confirmar.
- No se emite un CFDI real en vivo: el candado del mandato
  (`FACTURACION_MANDATO_ACEPTADO`) sigue puesto a propósito — la cláusula
  legal no existe todavía, y eso también se le puede decir a Gal tal cual:
  "el botón de emitir está detrás de una revisión legal, no de un TODO".
- El piloto de visión NO emite nunca (regla 1 de `piloto_vision.ts`); emitir
  exige adaptador escrito con pre-vuelo.
- CAPTCHA no se rodea. Es política del producto, no una limitación pasajera.
