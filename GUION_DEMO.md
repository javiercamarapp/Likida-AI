# Guion del demo — 6 de agosto, Transportes Innovativos

> Reescrito el **1-ago-2026**. El anterior era del 25-jul, **182 commits atrás**, y
> te ponía en la boca cifras que el producto dejó de dar a propósito. Todo lo que
> dice éste se comprobó contra la base y el código de hoy.
>
> Demo por **WhatsApp REAL** proyectado desde la laptop. Público: director de
> operaciones (ex-Daimler) + admin/fiscal.
>
> **Y esto no es una venta, es un primer acercamiento.** El bloque de preguntas
> del final vale más que la demostración: si sales sabiendo cómo liquidan hoy y
> cuánto les cuesta, la segunda reunión ya tiene tema. Si solo enseñas producto,
> no.

---

## Antes de entrar a la sala

1. **La prueba que decide todo — hazla DÍAS ANTES, no ese día.** Que alguien
   **sin rol en la app de Meta** le mande un "hola" al WhatsApp de Likida. La app
   está en `dev_mode` (`is_live: false`), y si el modo desarrollo restringe la
   mensajería a quien tiene rol, **un teléfono de fuera no llega y de tu lado no
   aparece ningún error**. Si no contesta: hay que poner la app en vivo
   (`Settings → Basic`: la política ya existe en `likida.ai/privacidad`, falta
   verificar el correo de contacto).
2. **Despertar la base**: abrir el panel una vez. Si Supabase pausó, la primera
   consulta la revive (~10 s).
3. **Arranque limpio**: los logs del despliegue tienen que decir
   `startup.observabilidad sentry:true` y `startup.config_silenciosa ok:true`.
4. **Tu viaje abierto existe.** El 1-ago se corrigió: el viaje `VJ-2026-0847`
   (Silao→Nuevo Laredo, anticipo **$10,600**) estaba a nombre de un operador con
   teléfono inventado del seed, así que **el demo no habría funcionado desde tu
   número**. Ahora es del operador con `529993700779`. Compruébalo mandando un
   "hola": si contesta algo que no sea *"No tienes un viaje abierto"*, vas bien.
5. **Plan B abierto en otra pestaña**: `/demo`, el simulador. Mismo motor, sin
   depender de Meta.
6. **Probar con el WiFi del lugar**, no solo con el de la oficina.

---

## El arco (≈8 min)

### 1. El problema — 40 s, sin pantalla

> "Un operador termina su viaje y alguien captura sus tickets a mano, los coteja
> contra la política, calcula diferencias y arma la liquidación. Horas por viaje.
> Pero lo que más cuesta no son las horas: es el ticket que se venció sin
> facturar."

**Pregunta, no afirmación:** *"¿Cuántos viajes cierran a la semana, y quién los
captura?"* — te da el tamaño y te da el nombre de quien va a usar esto.

### 2. El flujo en vivo por WhatsApp — 3 min

- Mandas **fotos de tickets reales** (diésel, caseta, una comida).
- El sistema acusa **una sola vez**: *"📸 Voy recibiendo tus comprobantes.
  Mándalos todos y cuando termines escribe **listo**."*
- Escribes **listo**.

> ⚠️ **Todas las fotos ANTES del `listo`.** Una vez emitida la liquidación, un
> comprobante nuevo NO entra en ella: lo impide el trigger de la 0036, que existe
> para que el PDF ya entregado y el mensaje de WhatsApp no digan cifras distintas
> y de signo contrario.
>
> Desde el 1-ago eso **ya no pierde el comprobante**: pasa a la sala de espera
> (`comprobante_huerfano`) y el sistema lo ofrece en el viaje siguiente. Así que
> si te pasa en la sala, la respuesta es buena — *"no entró en ésta, la guardé
> para tu próximo viaje"*— y se puede narrar como diseño: *"una vez que firmo una
> liquidación ya no la puedo alterar sin que se note, pero tampoco tiro tu
> ticket"*.
>
> **Lo que sigue sin existir es reabrir un viaje ya liquidado.** No se puede ni
> desde WhatsApp ni desde el panel; hoy se hace por SQL. Y `update viaje set
> estatus='abierto'` NO basta: el trigger mira si existe la liquidación, no el
> estatus, así que hay que borrar esa fila (se regenera sola al próximo `listo`).
> Aprendido a golpes ese mismo día — cuatro "ya lo reabrí" que no reabrían nada.
- Llega el **cuadre** —comprobado contra anticipo, la diferencia y las
  observaciones en lenguaje humano— y después el **PDF**.

> **Lo que hay que decir aquí, y es lo que sostiene todo lo demás:**
> "El número lo calcula un motor determinístico, no la IA. La IA conversa y lee
> fotos; **nunca inventa un monto**. Hay una guardia en el código que compara lo
> que el modelo quiere decir contra lo que el motor calculó, y si no coinciden,
> gana el motor."

### 3. Lo que el sistema ATRAPA — 2 min, y es la parte nueva

Esto no estaba en el guion viejo porque no existía. Es lo que separa a Likida de
"una app que junta fotos", y sale solo, en las observaciones:

| lo que aparece | por qué le importa al contralor |
|---|---|
| **"quedan 0 días para timbrarlo"** — y **nombra el portal** de esa gasolinera con su liga | el ticket que se vence es dinero perdido entero, y nadie lleva ese calendario |
| **"aparece dos veces (excluido del total)"** | el mismo ticket cobrado contra dos anticipos |
| **"está fechado en 2024 y estamos en 2026 — puede ser un error de lectura"** | un gasto de otro ejercicio no se deduce en éste |
| **"excede el tope fiscal de $750 por día (LISR 28-V)"** | el excedente no es deducible y casi nadie lo separa |
| **"sin comprobante de hospedaje ni transporte que la ampare"** | LISR 28-V condiciona la deducción de la comida |
| **"lleva impreso que NO es un comprobante fiscal"** | el ticket que dice de sí mismo que no sirve, y aun así trae RFC e IVA |

> "Todo eso salió de catorce fotos reales, sin que nadie le dijera qué buscar."

### 4. El panel — 2 min

Proyecta `/dashboard`.

**⚠️ CORRECCIÓN AL GUION VIEJO.** Decía *"arriba en grande: IEPS de diésel
acreditable"*, **en pesos**. El producto ya no da eso, y quitarlo fue deliberado:
la fórmula anterior sumaba el IEPS trasladado del CFDI, que **no es el
estímulo**. El estímulo es *cuota vigente × litros*, la cuota la publica el DOF
cada semana y pasó de $7.36 a $2.09 en cinco meses. La cifra vieja inflaba la
propuesta ~30%.

Hoy el panel dice **"Diésel elegible para el estímulo — N litros"**. Dilo así:

> "No les voy a dar un peso que no puedo defender. La cuota la publica el DOF
> cada semana y su contador la tiene fechada; lo que le entregamos es el dato
> duro: **cuántos litros son elegibles**, ya filtrados por los que sí traen
> complemento de hidrocarburos. Él multiplica."

Eso al contralor le suena a rigor, no a que falta algo. El **IVA acreditable** y
el **50% de peaje (LIF 2026 art. 20-A)** sí van en pesos, porque salen de
importes impresos en el CFDI.

**Abre el detalle de la liquidación que acabas de crear en la sala.** No abras
las del historial: son de siembra y **no tienen comprobantes ni PDF** — el
detalle sale vacío. Están ahí solo para que la lista no se vea sola.

### 5. Lo que protege el dinero — 1 min

> "Cada CFDI se valida contra el SAT: vigente, cancelado, lista negra del 69-B.
> Se exige el XML para el complemento de hidrocarburos. Y si el SAT no responde,
> **la liquidación no se cae**: queda pendiente y sigue. Nada tumba la operación."

### 6. Cierre — 30 s

> "Todo lo que vieron corre contra base real y es configurable por flota: la
> política de gastos, los topes, el RFC. No hay nada escrito a la medida de nadie."

---

## Si algo falla en vivo

| qué pasa | qué haces |
|---|---|
| **WhatsApp no entrega** | pestaña del simulador `/demo`: mismo motor, mismos números, sin Meta. Se narra igual |
| **El SAT no responde** | es el comportamiento esperado: el CFDI queda pendiente y la liquidación sigue. Enséñalo como diseño, no como falla |
| **El modelo tarda o cae** | hay respaldo entre proveedores; si todo cae, el agente pide reenviar **sin inventar números** |
| **La base pausó** | una consulta la despierta (~10 s). Por eso el paso 2 del checklist |
| **"No tienes un viaje abierto"** | tu operador ya cerró el viaje. Hay que abrir otro; ten a la mano quién lo hace |
| **"ya cerré esta liquidación… lo guardé para tu siguiente viaje"** | mandaste una foto DESPUÉS del `listo`. Es la respuesta correcta y el comprobante NO se pierde. Nárralo: el candado impide alterar una liquidación firmada, y la sala de espera impide tirar el ticket |
| **"ese comprobante ya estaba registrado en tu viaje VJ-…"** | esa foto ya se usó en otro viaje. Correcto: evita cobrarla dos veces |
| **"Por ahora solo proceso texto, fotos y XML"** | mandaste audio, sticker o documento. Es la respuesta correcta; repite con la foto |

---

## La verdad sobre los datos del demo

Dilo tú antes de que lo pregunten. Cuesta menos.

- El tenant "Transportes Innovativos" tiene **RFC, operadores y política de
  siembra**. El RFC configurado es real (`GMX0902279I1`, de un tercero que dio
  permiso) **solo para que la validación de receptor funcione** — con el genérico
  del SAT, todas las facturas saldrían "a revisión" y parecería que el producto
  no sirve.
- El viaje abierto es **Silao→Nuevo Laredo, anticipo $10,600**, con 2 gastos ya
  cargados; los que mandes en vivo se suman a ésos.
- Las **3 liquidaciones del historial son de siembra y están vacías por dentro**.
  No las abras.
- El aviso de privacidad de la flota se sirve en `likida.ai/aviso/<tenant>` y hoy
  **marca como pendiente** el contacto del art. 29, porque nadie lo ha designado.
  Si abres esa página, se ve. No es un error —es el criterio de decir lo que
  falta en vez de inventarlo— pero decídelo antes, no en la sala.

---

## Preguntas de descubrimiento — esto es lo que vale

Enseñar producto es la mitad. Sales de ahí sabiendo **si vale una segunda
reunión y de qué se trata**. Pregunta y **cállate a escuchar**: las respuestas
valen más que cualquier cosa que enseñes después.

### Cómo liquidan hoy — el tamaño del dolor

1. ¿Cuántos viajes cierran a la semana? ¿Quién los captura y cuánto tarda?
2. ¿Cuánto pasa entre que el operador termina el viaje y queda liquidado?
3. ¿Qué usan hoy — Excel, un ERP, papel? *(si dicen un ERP, pregunta cuál:
   cambia todo lo que viene después)*
4. ¿Qué pasa cuando un operador manda un ticket incompleto o tarde?

### El dinero que se les va — aquí es donde se enderezan

5. **¿Cuántos tickets de gasolina se les vencen sin facturar al mes?**
   *(casi nadie lo sabe, y ésa es justamente la respuesta útil)*
6. ¿Quién persigue las facturas en los portales de las gasolineras, y cuánto
   tiempo le toma?
7. ¿Su contador les separa el IVA acreditable de combustible del resto?
8. ¿Están tomando el estímulo de IEPS de diésel? ¿Y el 50% de peaje?
   *(si dudan, ahí hay dinero sobre la mesa)*

### Cómo son por dentro — decide si son cliente

9. ¿Cuántas unidades y cuántos operadores?
10. ¿Los operadores son de nómina o subcontratados? *(cambia lo laboral entero)*
11. ¿Todos tienen WhatsApp y lo usan? ¿Cuál es el más reacio a la tecnología?
12. ¿Quién decide una compra así, y quién la tiene que usar todos los días?
    *(pueden no ser la misma persona, y hay que convencer a las dos)*

### Lo que hay que preguntar aunque incomode

13. ¿Qué tendría que pasar para que esto NO les sirva?
14. ¿Han intentado algo parecido antes? ¿Por qué no funcionó?
15. Si esto existiera mañana funcionando, ¿lo usarían? ¿Qué los detendría?

> **Anota las respuestas ahí mismo**, no de memoria. Y anota también lo que
> pidieron y hoy no existe: eso es el roadmap con nombre y apellido, y es la
> única lista de funciones que no te inventaste tú.

### Lo que NO hay que prometer

- Una fecha de entrega de algo que no existe.
- Facturación automática en portales — está investigada y planeada, **no
  construida**. Se puede decir así: *"lo tenemos mapeado, 37 portales; hoy les
  avisamos cuál vence y con qué liga, pero facturar sigue siendo manual."*
- Un ahorro en pesos que no puedas sostener con su propio número. Mejor:
  *"díganme cuántos tickets se les vencen y lo calculamos juntos."*
