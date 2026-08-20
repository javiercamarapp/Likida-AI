# Demo en vivo: Likida factura — guion y pre-vuelo (reunión con Gal)

> Escrito el 20-ago-2026. El demo es por WhatsApp, contra producción
> (app.likida.ai), con el tenant de prueba G3M (RFC GMX0902279I1, validado
> contra el validador real: dígito verificador correcto, cero problemas).

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
- [ ] **Encargado con teléfono** en el tenant G3M (rol `encargado` o
      `flota_admin`, tel. 5219993700779). Sin él, el aviso no tiene
      destinatario (`telefonoJefeDe`). ← *pendiente: el insert quedó bloqueado
      sin acceso a Supabase desde la sesión del 20-ago.*
- [ ] **Plantilla `plazo_factura` aprobada** en Meta (respaldo fuera de
      ventana). Para el demo basta la ventana: manda un "hola" desde el
      teléfono del encargado antes de empezar y el texto completo entra.
- [ ] **Ventana de 24 h abierta** para el número del demo (el paso anterior).
- [ ] **Viaje abierto** del operador 529993700779.
- [ ] Si se enseña el piloto: `FACTURACION_PILOTO=si` en Vercel (y/o en la
      Mac para el ensayo local) y `OPENROUTER_API_KEY` vigente.
- [ ] Ticket CAPUFE de reserva por si el portal de Megasur está caído.
- [ ] `LIKIDA_CAPTURAS_DIR` puesto en la Mac para que el ensayo escriba JPEGs.

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
