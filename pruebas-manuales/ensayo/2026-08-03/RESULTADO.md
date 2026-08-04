# Ensayo del demo — 3/4 de agosto de 2026

> **El ensayo corrió, y el guion NO pasa tal como está escrito.** Tres cosas
> rompen el arco y una cuarta lo deja sin su cifra principal. Ninguna es un bug
> del motor: son datos del demo y una promesa del guion que el producto cumple
> por otro camino.

Es el **primer** ensayo: no hay directorio anterior contra el cual comparar, así
que no hay sección de diferencias contra ayer. Desde el próximo sí la habrá.

## Cómo se corrió

Local (`npm run dev`) contra la base real de producción (`gngoqsvrxdguxvsizpbw`).
**No se recorrió por WhatsApp**: mandar fotos desde el teléfono de Javier no lo
puede hacer un agente. Lo que sí se recorrió, y es el 80% del riesgo:

- el estado real de los datos del demo, contra la base;
- el panel que se proyecta, **mirando la captura**, no solo consultando;
- el PDF entero, **abierto y leído**, no verificado como "existe";
- el camino del diésel de punta a punta con **papel nuevo**, incluida una
  llamada de visión real ($0.0156 USD).

Queda pendiente de recorrer a mano: el acuse de WhatsApp, el `listo`, y la
entrega del PDF por el chat.

---

## Hallazgos que ROMPEN el demo

### 1. No hay viaje abierto — el "hola" engancha un viaje de basura

El único viaje `abierto` del teléfono `529993700779` es:

| folio | ruta | anticipo | gastos |
|---|---|---|---|
| `PRUEBA-XML-DIESEL` | Prueba → Prueba | $1,000.00 | 0 |

Es un viaje de prueba que quedó del 2-ago. Si Javier manda "hola" en la sala,
**eso** es lo que el sistema le va a contestar, proyectado. `VJ-2026-0848` está
**liquidado**, así que no recibe comprobantes.

**Qué hacer:** decidir el viaje del demo y dejarlo abierto (ver "Decisión
pendiente" abajo). Reabrir exige borrar la fila de `liquidacion`, no cambiar
`viaje.estatus` — el SQL está en `TRASPASO.md`.

### 2. El guion describe datos que ya no existen

`GUION_DEMO.md` dice que el viaje abierto es `VJ-2026-0847`, Silao → Nuevo
Laredo, anticipo **$10,600**, con 2 gastos. La base dice otra cosa:

| lo que dice el guion | lo que hay |
|---|---|
| `VJ-2026-0847` abierto | `VJ-2026-0847` **liquidado**, 13 gastos |
| Silao → Nuevo Laredo | el viaje vivo es `VJ-2026-0848`, **Mérida → Campeche** |
| anticipo $10,600 | anticipo **$3,000** |

El guion se reescribió el 1-ago y los datos se movieron el 1-ago por la noche.

### 3. La sección que vende sale en CEROS

El guion §4 promete decir *"cuántos litros son elegibles"* y que *"el IVA
acreditable y el 50% de peaje sí van en pesos"*. Lo que se ve en pantalla
(captura `01-dashboard.png`):

```
ESTÍMULOS ACREDITABLES
   0 L        $0.00              $0.00
   Diésel     IVA acreditable    Peaje (50%)
```

Y en el PDF (`08-liquidacion.pdf`) la sección **no aparece en absoluto**:
`filasAcreditables()` devuelve `null` cuando los tres valen cero, así que se
omite entera. Es honesto —no pinta un cero que parezca medición— pero deja al
guion sin su momento principal.

**La causa NO es un bug.** Todo acreditamiento exige `xmlVerificado`
(`engine.ts:882`), y **ninguno de los 21 gastos tiene CFDI**: son fotos de
tickets sin timbrar. Es el comportamiento correcto.

**Ojo con el IVA y el peaje que sí se ven en agregado** ($4,150 y $2,380 en la
vista "Todo"): salen **únicamente de las 3 liquidaciones de siembra**
(`VJ-2026-0844/0845/0846`), que tienen **0 gastos y ningún PDF** — las mismas
que el guion advierte no abrir. Si en la sala alguien pregunta de dónde sale ese
IVA, el detalle está vacío.

| liquidación | comprobado | litros | IVA | peaje | gastos | PDF |
|---|---|---|---|---|---|---|
| VJ-2026-0848 | $12,388.05 | 0 | $0 | $0 | 21 | sí |
| VJ-2026-0847 | $16,297.05 | 0 | $0 | $0 | 13 | sí |
| VJ-2026-0846 | $9,900.00 | 0 | **$1,210** | **$690** | **0** | **no** |
| VJ-2026-0845 | $12,100.00 | 0 | **$1,580** | **$910** | **0** | **no** |
| VJ-2026-0844 | $10,200.00 | 0 | **$1,360** | **$780** | **0** | **no** |

### 4. Los datos del viaje del demo se ven rotos proyectados

Leyendo el PDF entero:

- **Una comida de $7,881.05**, cargada **3 veces** (2 excluidas). Genera dos de
  las observaciones más grandes del documento: excede la política por $7,081.05
  y excede el tope fiscal de $750/día por $7,131.05.
- **Gastos por $12,388.05 contra un anticipo de $3,000** → "Diferencia a favor
  del operador **$9,388.05**". Un operador que gastó 4× su anticipo.
- **Comprobantes fechados en 2020 y 2024**, más dos de junio fuera del rango.
- **13 de 15 renglones en rojo `revisar`** (ya estaba anotado en `TRASPASO.md`,
  punto 7). Confirmado mirando: proyectado parece que todo falló.
- **5 líneas casi idénticas** de "sigue sin factura: se pasó el plazo", con la
  liga de La Gas repetida **3 veces** (`TRASPASO.md` punto 6, sin resolver).

---

## El ticket de diésel nuevo — lo que faltaba probar

Papel virgen: un ticket de diésel **generado para este ensayo** con verdad
conocida (`09-ticket-diesel-nuevo.png` / `.html`), para poder comparar campo por
campo lo leído contra lo impreso — cosa que una foto al azar no permite.

> **Salvedad honesta:** es un ticket *renderizado*, nítido. Prueba la LÓGICA
> (litros, portal, plazo, estímulo), **no** la robustez de la visión sobre papel
> térmico arrugado y fotografiado en una cabina. Eso sigue sin probarse.

### El OCR acertó los 12 campos

| campo | impreso | leído |
|---|---|---|
| concepto | diésel | `diesel` ✅ |
| monto | $1,704.89 | `1704.89` ✅ |
| **fecha** | 02/08/2026 | `2026-08-02` ✅ |
| folio | 4471902 | `4471902` ✅ |
| RFC emisor | CGC-100524-3I3 | `CGC1005243I3` ✅ |
| forma de pago | tarjeta de crédito | `04` ✅ |
| subtotal | $1,469.73 | `1469.73` ✅ |
| producto | DIESEL | `DIESEL` ✅ |
| **litros** | 62.450 LT | `62.45` ✅ |
| precio unitario | 27.300 | `27.3` ✅ |
| estación | 20187 | `20187` ✅ |
| IVA | $235.16 (16%) | `235.16` / `0.16` ✅ |

Confianza `1.0`, 7.9 s, $0.0156 USD. **El año se leyó bien**, que es justo donde
falló con tickets reales antes.

### Y aun así: CERO litros elegibles

```
A · SOLO FOTO          → litros 0      · IVA $0
B · FOTO + XML         → litros 62.45  · IVA $235.16
C · XML sin complemento→ litros 62.45  (marca complemento_no_verificable)
D · portal del catálogo→ nombra el portal, la liga y qué campos pide
```

**Éste es el hallazgo del ensayo.** Los dos datos vienen de fuentes distintas:

- los **litros** los lee el OCR de la **foto** → `ocrExtra.litros`
- el **permiso** para acreditarlos lo da el **XML** → `xmlVerificado` + clave SAT

Es decir: **para que el panel enseñe litros en la sala, el operador tiene que
mandar la foto del ticket Y el XML del CFDI.** Con la foto sola siempre es 0, y
eso es correcto: un ticket sin timbrar no acredita nada.

Queda fijado en `src/lib/cuadra/cuadre/diesel_estimulo.test.ts` (6 pruebas,
sin llamadas de pago), incluidos los tres casos que **no** acreditan: efectivo,
gasolina, y foto sin litros.

### El portal sí se nombra (correción a una lectura mía anterior)

Con el dominio inventado del ticket, el aviso salió genérico y parecía que el
guion §3 prometía algo que no pasa. **No es así**: con un comercio del catálogo
el aviso sale completo —

> "…puedes timbrarlo hasta el 2026-08-31 (27 días) (plazo del portal de La Gas /
> Grupo GES, no de la ley…). Portal de La Gas / Grupo GES:
> https://facturacion.lagas.com.mx/ — te pedirá # de Referencia, Importe Ticket."

Un dominio fuera del catálogo deja el aviso genérico a propósito: inventarle un
portal sería peor.

### El PDF NO llama "Diésel" a la gasolina

Otra lectura mía que hay que corregir: en la base, 10 gastos tienen
`concepto='diesel'` con `producto` = PLUS, Magna o Premium. Parecía que el
documento del contralor iba a etiquetar gasolina como diésel. **Mirando el PDF,
no pasa**: los renglones dicen "Combustible Premium", "Combustible Plus",
"Combustible Magna". `etiquetaConcepto()` usa `ocrExtra.producto`. Y el estímulo
se decide por clave SAT `15101505`, nunca por `concepto`. El motor está bien
defendido en los dos frentes.

---

## Lo que se arregló en este ensayo

- **Esquinas del asistente en `/admin`**: salía con los dos cantos derechos a
  filo. `MARCO_SCROLL` usa `overflow-y: auto`, que lo vuelve contenedor de
  scroll, y un contenedor de scroll recorta por su caja de borde: sin radio
  propio, ese recorte es un rectángulo. En `/dashboard` no pasaba porque ahí el
  rail es hermano de la columna. Arreglado en `marco.ts` y verificado mirando.
- **Directorio `src/app/zzz-preview-admin/` vacío**, olvidado de una sesión
  anterior. Git no rastrea directorios vacíos, así que `git status` salía limpio
  y nadie lo veía. Borrado.

---

## Decisión pendiente (de Javier, no de código)

Para que el demo tenga viaje abierto Y la sección de acreditables no salga en
ceros, hay que decidir **con qué datos se entra a la sala**. Las opciones no son
equivalentes y ninguna se puede tomar por inferencia.

1. **Reabrir `VJ-2026-0848`** — borra su fila de `liquidacion` (se regenera al
   próximo `listo`). Conserva sus 21 gastos… incluida la comida de $7,881
   triplicada y las fechas de 2020/2024.
2. **Crear un viaje nuevo y limpio** con la ruta y el anticipo del guion
   (Silao → Nuevo Laredo, $10,600) y cargar en la sala solo los comprobantes que
   se van a mandar. Es lo que mejor se proyecta, y deja el guion §4 dependiendo
   de que se mande el XML.
3. **Dejarlo como está** y narrar los ceros como diseño ("hasta que no se timbra,
   no acredito nada"), que es verdad y es defendible ante un contralor.

Y aparte: **si se quiere enseñar litros elegibles, hay que mandar un XML de
diésel en la sala**, no solo la foto.

## Trampas nuevas para la lista

- **Una captura tomada mientras Next recompila miente.** El toast "Compiling" en
  la esquina salió en la imagen y el arreglo del canto parecía no haber servido.
  Recapturado ya compilado, sí servía. Si la captura trae ese toast, se tira.
- **Chrome headless se cuelga en páginas con polling** (`/dashboard/chat` pide a
  `/api/dashboard/asistente`): nunca dispara el evento de carga y no escribe el
  screenshot. Se captura con un preview `zzz-preview-*` que importe el componente
  real, sin el rail.
- **El perfil de Chrome se corrompe** si se le mata con `pkill` a media escritura:
  las siguientes corridas fallan en silencio. Perfil nuevo por sesión de captura.
- **El magic link de Supabase no sirve para entrar en local**:
  `exchangeCodeForSession` es PKCE y exige el `code_verifier` del navegador que
  PIDIÓ el link. Un link generado con la service role cae siempre en
  `/login?error=1`. Lo que sí funciona es `verifyOtp` con el `token_hash` desde
  el servidor.

## Estado de la verificación

`npx tsc --noEmit` · `npx eslint src/` · `npx vitest run` · `npm run build` —
los cuatro limpios. 1,676 pruebas verdes (1,670 + las 6 nuevas del diésel).
