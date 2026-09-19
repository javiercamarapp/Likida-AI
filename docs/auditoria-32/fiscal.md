# Cumplimiento fiscal — auditoría 32

**Nota: 3/10** (antes 3). Razón del movimiento: **ninguna de las tres razones
aplica**, y lo argumento en vez de dejarlo dicho.

- *Se atacó y subió* está descartado por construcción: `git log 8b01aec..HEAD --
  src/ supabase/ normas/` sale **vacío**. El único commit de la ventana
  (`69becdb`) quita una línea de `scripts/mejora-diaria/rutina.sh`. Ninguno de
  los 17 hallazgos abiertos podía haberse arreglado sin tocar `src/`.
- *Deuda que cobró factura* exige un daño nuevo. No hay clientes, la base sigue
  en cero, no hay un CFDI rechazado ni una liquidación mal impresa que contar.
  Lo único que se movió solo es el reloj: la tabla del DOF sigue terminando el
  **11-sep** y hoy es **16-sep**, así que la calculadora pública lleva **5 días**
  imprimiendo pesos con una cuota cuya vigencia terminó (antes eran 2). Es el
  mismo defecto un poco más viejo, no un defecto nuevo: mover la nota por el
  paso del calendario sería teatro.
- *Mirada más profunda* sí produjo algo — abrí por primera vez toda la cadena de
  Carta Porte (`carta_porte{,_datos,_wa,_xml,_cfdi,_timbre}.ts` + las tres
  pantallas), que la 31 dejó por escrito como su hueco más grande, y salieron
  **2 hallazgos nuevos**. Pero esa razón exige decir que la nota anterior estaba
  **inflada**, y no lo estaba: el ancla del rubro («3 o menos si el producto
  imprime una cifra fiscal equivocada») ya estaba clavada por **FIS-C1**, que
  verifiqué línea por línea hoy y sigue idéntico. Los dos hallazgos nuevos son
  ALTO y MEDIO: engrosan el expediente, no bajan el piso. Y bajar a 2 exigiría
  que algo empeorara — nada empeoró, el árbol es byte por byte el de la 31.

**El riesgo mayor del rubro, hoy:** sigue siendo FIS-C1 — el cotejo contra la
clave del SAT corre *después* de la escritura que vigila, así que la declaración
contradictoria se guarda, se rechaza en pantalla y el motor imprime la deducción
del 15 % igual. Lo que la mirada de hoy agrega es que ese patrón —la salvedad
que vive en una pantalla y no en el dato— se repite en Carta Porte, donde la
consecuencia no es una deducción de más sino la presunción de contrabando del
CFF 103-XXII.

| Severidad | # | de los cuales |
|---|---|---|
| CRÍTICO | 2 | 2 REINCIDENTES |
| ALTO | 5 | 4 REINCIDENTES · **1 nuevo** |
| MEDIO | 8 | 7 REINCIDENTES · **1 nuevo** |
| BAJO | 4 | 4 REINCIDENTES |

**Medido hoy, para que mañana se distinga una medición de una impresión:**

- `npx vitest run src/lib/likida/{cuadre,liquidacion,intake,facturacion,marketing} 'src/lib/likida/carta_porte*.test.ts'`
  → **142 archivos / 1,936 pruebas, todas verdes**, 29.2 s. Es la suite de mi
  rubro sobre el árbol sin tocar.
- Fichas `normas/*.yaml`: **39** (`ls normas/*.yaml | wc -l`). La que estrené
  esta ronda y que gana cualquier discusión: `rmf-2026-2.7.7`,
  **`verificado_fuente_primaria`**, verificada el 27-jul-2026 contra el PDF del
  DOF 28-dic-2025.
- Semanas de cuota del DOF en `normas/datos/cuota-ieps-diesel.yaml`: **7**, de
  `2026-07-25` a **`2026-09-11`** (`:50-85`). Hoy es **16-sep-2026**: faltan las
  semanas 12–18 y 19–25 de septiembre. Rango de las 7: **$0.6787 – $2.5801 por
  litro**, factor **3.80×**.
- Llamadores de `opcionesDe` sin perfil: **8** (`grep`, sin `*.test.ts`) — los
  mismos 8 de la 29, la 30 y la 31, carácter por carácter.

---

## Hallazgos nuevos

### [ALTO] FIS-A5 — el veredicto «sale SIN complemento» viaja a WhatsApp y a la hoja imprimible citando la regla 2.7.7.2.1, sin la salvedad de las materias excluidas que esa misma regla trae; la salvedad existe en el producto, pero solo en la pantalla índice (NUEVO)

`src/lib/likida/carta_porte_wa.ts:99-103`, textual:

```ts
  return (
    `El viaje ${rotuloViaje(v)} sale SIN complemento según lo declarado.\n${d.motivo}\n(${d.fundamento})\n\n` +
    'La declaración quedó firmada en el viaje — es tu rastro ante una revisión. Si la ruta cambia y pisa federal, la obligación revive: decláralo en el panel o mándame «sí pisa».' +
    (dedicado ? AVISO_DEDICADO : '')
  );
```

· el `motivo` y el `fundamento` que se pegan ahí salen de
`src/lib/likida/carta_porte.ts:117-124`: *«Traslado local: no se pisa tramo
federal… — la facilidad quita el complemento, no la factura»*, fundamento
*«RMF 2026, regla 2.7.7.2.1; clave del Apéndice 4 del Instructivo»*.
· la segunda superficie, la que se imprime y se archiva:
`src/app/dashboard/carta-porte/borrador/[viajeId]/page.tsx:77-79` — «Sin
complemento, según lo declarado. {motivo} ({fundamento})», bajo un `<h2>`
que dice **Veredicto**, en una página cuyo propio encabezado invita a
`Ctrl/Cmd + P` (`:53-55`).
· dónde SÍ está la salvedad, y en un solo lugar:
`src/app/dashboard/carta-porte/vista.tsx:57-58` — «Se evalúa como **carga
general**: si mueves hidrocarburos, medicamentos o mercancía de despacho
aduanero, el complemento es obligatorio siempre y ninguna facilidad aplica.»

**Norma** — `normas/rmf-2026-2.7.7.yaml`, **`verificado_fuente_primaria`**
(`estado_verificacion` en `:34`; extraído del PDF oficial de la RMF 2026, DOF
28-dic-2025), `texto_vigente` líneas 18-23, literal:

> «2.7.7.2.1: el transportista que NO transite por tramos de jurisdicción
> federal puede acreditar el transporte con el CFDI de ingreso SIN complemento;
> aplica solo con "plena certeza" de no pisar federal, y si por cualquier causa
> se pisa, deben emitirse los CFDI conforme a 2.7.7.1.1 y 2.7.7.1.2.
> **Excluidos de la facilidad: transportistas extranjeros,
> hidrocarburos/petrolíferos, despacho aduanero y medicamentos.**»

y la `advertencia` de la misma ficha, `:46-51`, literal:

> «El incumplimiento no es solo multa (CFF 84-IV-d, **$450-$670 por CFDI**): el
> traslado sin CFDI con complemento **SE PRESUME CONTRABANDO** (CFF 103-XXII,
> pena de 3 a 6 años, CFF 104-IV) y el gasto pierde deducción y acreditamiento
> (CFF 29-A). Por eso el clasificador NUNCA responde "no necesita" con datos
> faltantes: responde "falta declarar".»

**Por qué el dato falta siempre.** `necesitaCartaPorte` recibe
`materiaExcluida: boolean` (`carta_porte.ts:74`) — un booleano, sin `null`, o
sea sin estado «no declarado». Y quien lo llena es una sola fuente:
`carta_porte_datos.ts:202` → `filaAViajeCcp(f, hazmat === true)`, con
`hazmat = hazmatDeclarado(perfil)` (`:199`); igual en `:227` para el viaje
suelto. Esa bandera es la respuesta de la flota a **una** pregunta de la
entrevista, `src/lib/likida/perfil/entrevista.ts:454`, literal: *«¿Mueven
materiales peligrosos (Clase 1 a 9)?»*. Likida **no captura en ningún lado**
hidrocarburos/petrolíferos, medicamentos ni despacho aduanero —
`grep -rn "medicament\|hidrocarb\|aduaner"` sobre `src/` fuera de pruebas da
exactamente dos aciertos, los dos en el párrafo de `vista.tsx:57-58`. El propio
código lo admite en `carta_porte_datos.ts:88-91`: *«Likida no captura todavía la
materia de la carga… quien las mueva no debe fiarse del "no necesita"»*, y ahí
mismo dice **«(y la pantalla lo repite)»** — en singular, que es justo el
problema: lo repite **una** pantalla de tres.

**Escenario, con números.** Flota de distribución farmacéutica en el área
metropolitana de Monterrey; reparto de medicamento a farmacias, 20 viajes al
mes, todos urbanos.

1. En la entrevista contestan «no» a *«¿Mueven materiales peligrosos (Clase 1 a
   9)?»* — y es la respuesta **correcta**: el medicamento de farmacia no es
   materia peligrosa de la NOM-005. → `hazmatDeclarado(perfil) === false`.
2. `carta_porte_datos.ts:202` → `materiaExcluida = false`.
3. Se despacha el viaje F-1042. `evaluarYAvisarCcpDespacho`
   (`carta_porte_wa.ts:114-186`) manda los dos botones al jefe de tráfico. El
   jefe aprieta **«No pisa»** — y es verdad, la ruta es toda vialidad urbana.
   `declararCcp` escribe `ccp_pisa_federal = false`.
4. `necesitaCartaPorte` entra por `carta_porte.ts:117` y devuelve
   `necesita: 'no'`.
5. WhatsApp imprime, palabra por palabra: *«El viaje F-1042 sale SIN complemento
   según lo declarado. Traslado local: no se pisa tramo federal. El CFDI de
   ingreso se emite de todas formas (clave 78101801, "en área local") — la
   facilidad quita el complemento, no la factura. (RMF 2026, regla 2.7.7.2.1;
   clave del Apéndice 4 del Instructivo)»*.

Pero la regla que se cita **excluye los medicamentos de esa facilidad** en su
propio texto. El complemento era obligatorio. Salida: **20 CFDI al mes sin
complemento**, multa CFF 84-IV-d de $450–$670 cada uno = **$9,000 a $13,400
mensuales**, más la presunción de contrabando del CFF 103-XXII sobre cada
traslado y la pérdida de la deducción del flete para el cliente que los
contrató. El mismo escenario corre idéntico con una pipa de petrolíferos y con
carga de despacho aduanero.

**Consecuencia.** Le pega a dos personas distintas y a ninguna la alcanza la
salvedad. El **jefe de tráfico** decide en WhatsApp, en el momento del despacho,
y nunca abre `/dashboard/carta-porte`. El **contralor** imprime
`/dashboard/carta-porte/borrador/[viajeId]`, que es literalmente el papel que se
le entrega al PAC de la flota, y en ese papel el veredicto va con su fundamento
y sin su supuesto. La salvedad quedó en el párrafo de bienvenida de la pantalla
que sirve para navegar, no en el documento que sirve para decidir.

**Me refuté antes de escribirlo, cuatro veces.**
· *«El texto dice "según lo declarado", o sea que se cubre.»* Se cubre de lo que
sí se declaró (la ruta), no de lo que nunca se preguntó (la materia). «Según lo
declarado» apunta a `ccp_pisa_federal`; el lector entiende que el resto está
verificado.
· *«¿No lo atrapa `hazmat`?»* No, y por la razón buena: la pregunta de
`entrevista.ts:454` es de **clase 1 a 9**, y ni medicamentos ni «despacho
aduanero» lo son. Un carrier de farma que conteste la verdad queda fuera del
único guardia que existe.
· *«¿No hay un aviso por viaje?»* Hay uno de `material_peligroso` por renglón de
mercancía (`vista.tsx:212-213`, badge «material peligroso»), pero **no alimenta
la decisión**: `filaAViajeCcp` (`carta_porte_datos.ts:115-120`) no mira
`mercancias` para armar `materiaExcluida`. O sea que la pantalla puede pintar a
la vez «sale sin complemento» y el badge rojo del renglón.
· *«¿No es un hallazgo de UI disfrazado?»* No: lo que está mal es la **cita**. El
producto atribuye a la regla 2.7.7.2.1 una facilidad sin las exclusiones que esa
regla enumera en el mismo párrafo — es el modo de falla que este rubro nombra
por su nombre, «una leyenda que cita un artículo que no dice eso».

**Causa raíz probable:** el supuesto vive en JSX de una pantalla en vez de vivir
en `DecisionCcp`, que tiene `motivo`, `fundamento` y `pendientes` pero no
`supuestos` — así que cada consumidor nuevo de la decisión (WhatsApp en la Fase
B, la hoja imprimible en la Fase D) lo vuelve a perder.

---

### [MEDIO] FIS-M8 — el CFDI que Likida manda a timbrar al PAC exige el CP del domicilio y NO exige el Estado, que el mismo estándar marca como requerido; y donde sí se captura, la forma enseña a teclear «Nuevo León» donde el complemento espera la clave del catálogo (NUEVO)

`src/lib/likida/carta_porte_cfdi.ts:179-180`, textual — la lista fail-closed de
faltantes del CFDI timbrable:

```ts
  if (cc.origenCp === null) faltantes.push('CP del origen (dato del cliente) — sin él, la Ubicación de origen rebota.');
  if (cc.destinoCp === null) faltantes.push('CP del destino (dato del cliente).');
```

No hay un renglón equivalente para `origenEstado` ni `destinoEstado`: leí las
256 líneas del archivo y `Estado` no aparece en ninguna guarda. El nodo se arma
igual en `src/lib/likida/carta_porte_xml.ts:274-286`:

```ts
function domicilio(cp: string | null, estado: string | null, transpInternac: boolean | null): string {
  if (cp === null && estado === null) {            // ← solo si faltan LOS DOS
    return '          <!-- Domicilio: CP y estado sin capturar … -->';
  }
  const attrs = [
    estado === null ? null : `Estado="${escaparXml(estado)}"`,
    transpInternac === false ? 'Pais="MEX"' : null,
    cp === null ? null : `CodigoPostal="${escaparXml(cp)}"`,
  ].filter((x): x is string => x !== null);
```

El camino vivo: `carta_porte_timbre.ts:281` llama a `armarCfdiTimbrable`, y si
sale `ok` se aparta la reserva (`:294`) y **se llama al PAC de verdad** —
`:266-275` cortan cuando no hay PAC configurado o cuando el modo del perfil no
casa con el ambiente, no cuando falta un atributo requerido.

**Norma / estándar.** La ficha `normas/rmf-2026-2.7.7.yaml` es
**`verificado_fuente_primaria`** y su `nota_verificacion` (`:35-45`) declara
literal que la verificación incluyó *«validaciones del Estándar CCP 3.1 y el
Instructivo Autotransporte en `docs/conocimiento/02-carta-porte.md`»*. Esa
investigación, `docs/conocimiento/02-carta-porte.md:329`, §6.3
(`Ubicaciones → Ubicacion → Domicilio`), dice textual:

> «Requeridos: **`Estado`, `Pais`, `CodigoPostal`**.
> Opcionales: `Calle`, `NumeroExterior`, `NumeroInterior`, `Colonia`,
> `Localidad`, `Referencia`, `Municipio`.»

Lo digo con su estado de verificación exacto, sin inflarlo: **el `texto_vigente`
de la ficha transcribe la RMF, no el XSD**. La exigencia de `Estado` la sostengo
con el documento que la propia ficha verificada nombra como su fuente técnica, y
con la prueba del repo (abajo), no con una transcripción `verificado_fuente_primaria`
del estándar. Que la RMF 2.7.7.1.1 remite a los requisitos del CFDI sí está en la
ficha, `:12-14`: *«deben expedir un CFDI de tipo ingreso con los requisitos
establecidos en el artículo 29-A del CFF, al que deben incorporar el "Complemento
Carta Porte"»*.

**La prueba de que el repo sabe cuál es el formato correcto y la pantalla no lo
pide.** `src/lib/likida/carta_porte_xml.test.ts:90-91`:

```ts
    expect(x).toContain('Estado="YUC" Pais="MEX" CodigoPostal="97000"');
    expect(x).toContain('Estado="ROO" Pais="MEX" CodigoPostal="77500"');
```

`YUC` y `ROO` son claves del catálogo `c_Estado`. Ahora la forma real que lo
captura, `src/app/dashboard/carta-porte/forma.tsx:135-136` y `:157-158`:

```tsx
          <input id={campo('oedo')} name="origenEstado" type="text" maxLength={60}
            defaultValue={inicial.origenEstado ?? ''} placeholder="p. ej. Nuevo León"
…
          <input id={campo('dedo')} name="destinoEstado" type="text" maxLength={60}
            defaultValue={inicial.destinoEstado ?? ''} placeholder="p. ej. Jalisco"
```

y el validador, `src/lib/likida/carta_porte_datos.ts:446-451`, solo corta a los
60 caracteres:

```ts
  const estado = (v: string): string | null => {
    const t = v.trim();
    if (t === '') return null;
    if (t.length > 60) throw new DatoInvalido('El estado no puede pasar de 60 caracteres.');
    return t;
  };
```

El fixture de la prueba usa `YUC`; el `placeholder` que ve el humano dice
**«Nuevo León»**. Nadie que llene esa casilla como se la piden va a escribir
`NL`.

**Escenario, con valores.** Viaje F-2210, Monterrey → Guadalajara, flete pactado
**$18,500.00**, receptor persona moral. El contralor llena la forma de datos del
cliente tal como se la piden:

- Caso A (lo que pasa cuando el cliente solo mandó CPs): `origenCp = '64000'`,
  `origenEstado = ''` → `null`, `transpInternac = 'no'`.
  `armarCfdiTimbrable` devuelve **`ok: true`** —nada revisa el Estado—, el XML
  sale con `<cartaporte31:Domicilio Pais="MEX" CodigoPostal="64000"/>
  <!-- incompleto: lo que falta se captura antes de emitir -->`, sin el atributo
  `Estado` que el §6.3 marca como requerido. Se inserta la reserva en
  `ccp_timbre` y se llama al PAC, que rebota por esquema. El módulo se escribió
  con el propósito contrario, dicho en `carta_porte_cfdi.ts:164-165`: *«Lo que
  el TIMBRE exige y el pre-CFDI dejaba como comentario… El PAC rebotaría cada
  uno con su código; decirlos ANTES ahorra el viaje.»* Para `Estado` no lo dice
  antes.
- Caso B (lo que pasa cuando sí llena la casilla): teclea **«Nuevo León»** y
  **«Jalisco»**, que es exactamente lo que el `placeholder` le pide. El XML sale
  con `Estado="Nuevo León"` y `Estado="Jalisco"` donde el complemento espera
  `NL` y `JAL`. Mismo rebote, con la diferencia de que aquí el contralor cree
  que lo llenó bien y no tiene cómo saber qué está mal.

En los dos casos el CFDI que ampara los $18,500 no se timbra, con la unidad ya
cargada, y el mensaje que Likida sabe dar («te falta esto, antes de salir») no
se da.

**Consecuencia.** Le pega al contralor, que aprieta «Timbrar» y recibe un código
del PAC sin traducción justo cuando el chofer está esperando; y le pega al
equipo que mantiene esto, porque el gate de faltantes —la pieza de la que
depende toda la promesa de este módulo— tiene un hueco que su propia suite no
puede ver: `carta_porte_cfdi.test.ts:31` y `:42` prueban los dos extremos (todo
capturado / todo nulo) y nunca el intermedio CP-sí-Estado-no, que es el caso
normal de un cliente que manda códigos postales por WhatsApp.

**Me refuté antes de escribirlo, tres veces.**
· *«¿No lo atrapa `validarComplemento`?»* No: `carta_porte.ts:435-503` valida
pesos, conteos, distancias, placa, figuras y el caso traslado. El domicilio no
entra a `ComplementoBorrador` (`:402-419`), así que el validador de rechazo
seguro no tiene con qué juzgarlo.
· *«¿No es un problema solo de la vía export, que es un papel de trabajo?»* Esa
sería la versión benigna. Pero `nodoComplementoCcp` es compartido a propósito
(`carta_porte_xml.ts:76-86`, «un solo constructor del complemento = una sola
verdad») y `carta_porte_cfdi.ts:190` lo llama para el CFDI que **sí** va al PAC.
· *«¿No habrá una normalización del estado más arriba?»* Busqué: el único
escritor es `guardarDatosCliente` (`carta_porte_datos.ts:482-489`), que pasa el
string tal cual, y el único lector es `filaAViajeCcp:124`, que lo devuelve con
`txt()`. No hay catálogo `c_Estado` en `src/` — `grep -rn "c_Estado" src/` no da
nada.

**Causa raíz probable:** la lista de faltantes del timbrable se escribió campo
por campo a mano y se quedó corta en dos, en vez de derivarse de la misma tabla
de «requeridos» del §6.3 que la investigación ya tiene escrita; y el
`placeholder` de la forma se redactó pensando en un humano y no en el catálogo
que el atributo va a recibir.

---

## Los reincidentes, verificados hoy uno por uno

Los cinco que el encargo me asignó explícitamente van primero, con el
`archivo:línea` de hoy leído por mí. Los demás van en tabla. El escenario con
pesos y la refutación de cada uno están en `docs/auditoria-31/fiscal.md` y
`docs/auditoria-30/fiscal.md`; aquí va la prueba de que siguen.

### [CRÍTICO] FIS-C1 — el cotejo del régimen corre DESPUÉS de la escritura que vigila (REINCIDENTE, fija el ancla)

`src/app/dashboard/onboarding/page.tsx:67` escribe
(`await guardarPerfilPatch(ses.tenantId, patch, ses.userId)`), y **hasta
`:68-71`** se calcula `facilidad15Declarada(patch)` y se llama a
`actualizarFacilidad15`, cuyo rechazo cae en el `catch` de `:72-74` que solo
devuelve `{ error }` a la pantalla. El perfil contradictorio ya quedó guardado.
Verificado carácter por carácter contra la 31: **idéntico**.

Norma: `normas/rfa-2026-2.9.yaml`, **`verificado_fuente_primaria`**, el requisito
de dedicación exclusiva y régimen del que cuelga el 15 % de combustible en
efectivo; es la cifra que el motor imprime en verde en el PDF.

### [ALTO] FIS-A4 — la calculadora pública imprime el estímulo de IEPS EN PESOS multiplicando un año de litros por la cuota de UNA semana (REINCIDENTE)

`src/lib/likida/marketing/calculadora.ts:170` —
`estimacionMesMxn: vencida ? null : pesos(litrosMes * CUOTA_DOF.pesosPorLitro)`;
la anualización en `:200` (`partes.push(diesel.estimacionMesMxn * 12)`); la
constante copiada a mano en `:49-53` (`pesosPorLitro: 0.6787, registradaEl:
'2026-09-05'`). Sin un carácter de cambio.

Norma — `normas/lif-2026-20-A.yaml`, **`verificado_fuente_primaria`**, líneas
101-105, literal:

> «el monto que se podrá acreditar será el que resulte de multiplicar la cuota
> del impuesto especial sobre producción y servicios que corresponda según el
> tipo de combustible… con los ajustes que, en su caso, correspondan, **vigente
> en el momento en que se haya realizado la importación o adquisición del
> diésel…, por el número de litros importados o adquiridos**.»

y la regla operativa que el propio repo se escribió,
`normas/datos/cuota-ieps-diesel.yaml:1-6`, literal:

> «**HASTA QUE UN FISCALISTA CON CÉDULA FIRME UNA: el producto y el marketing
> muestran LITROS acreditables y rango, jamás el estímulo en pesos.**»

**Actualizado a hoy:** con 40,000 L/mes el titular anual sigue dando
`40,000 × 0.6787 × 12 =` **$325,776**; con la cuota del 8–14 de agosto
($2.5801, codNota 5795798) el mismo insumo daría **$1,238,448**. Los mismos
litros, **3.80×** de dispersión según la semana en que entre el visitante.

### [MEDIO] FIS-M6 — la ventana de gracia del lector permisivo se cuenta desde el INICIO de la semana (REINCIDENTE, y hoy muerde más)

`src/lib/likida/marketing/calculadora.ts:58` (`const DIAS_VIGENCIA_CUOTA = 14;`)
y `:135-137` (`return diasEntre(CUOTA_DOF.registradaEl, hoy) > DIAS_VIGENCIA_CUOTA;`).
`registradaEl` es el **sábado en que empieza** la semana, y la fila del YAML
(`cuota-ieps-diesel.yaml:80-85`) declara `vigencia: 2026-09-05 a 2026-09-11`.

**Aritmética de hoy, 16-sep-2026:** `diasEntre('2026-09-05','2026-09-16') = 11`,
que no es `> 14` → `vencida === false` → **se siguen imprimiendo pesos**. La
vigencia de esa cuota terminó el **11-sep**: la página lleva **5 días** citando
una cuota muerta y le quedan **4 más** (se apaga el 20-sep). En ese lapso el DOF
publicó el acuerdo del 11-sep y publicará el del 18 — **dos semanas** que la
página se salta sin decirlo.

El contraste sigue intacto: `src/lib/likida/cuadre/cuota_diesel.ts:131-135`
(`cuotaDieselVigente`) devuelve **`null`** para `'2026-09-16'`, y su encabezado
`:14-18` dice literal *«FAIL-CLOSED: fuera de rango no se devuelve la última
conocida… Sin cuota no hay cifra»*. La calculadora no lo llama: `grep` de
`cuotaDieselVigente` fuera de `*.test.ts` sigue dando **un solo archivo**, su
propia definición.

### [MEDIO] FIS-M7 — la nota del NO DEDUCIBLE enumera la LISR 27-III sin la transferencia electrónica (REINCIDENTE)

`src/lib/likida/cuadre/engine.ts:845`, textual y sin cambio:

> «…así que el combustible exige uno de los medios de la LISR 27-III (cheque
> nominativo, tarjeta de crédito/débito/servicios o monedero autorizado) — no
> deducible.»

Contra la lista que el mismo archivo aplica, `engine.ts:126`:
`MEDIOS_LISR_27_III = ['02','03','04','05','28','29']`, donde **`03` es la
transferencia electrónica de fondos**. Y contra las dos redacciones hermanas que
sí la nombran: `engine.ts:911` y `fiscal.ts:691`.

Norma — `normas/lisr-27-III.yaml:9-14` está en **`evidencia_corroborante`**
(*no verificable en esta ronda*, y lo digo en vez de esconderlo); el mismo medio
está transcrito en una ficha que **sí** es `verificado_fuente_primaria`,
`normas/lif-2026-20-A.yaml:114-123`, para la lista gemela:

> «…deberá efectuarse con: monedero electrónico autorizado…; tarjeta de crédito,
> débito o de servicios…; con cheque nominativo…, o bien, **transferencia
> electrónica de fondos desde cuentas abiertas a nombre de la persona
> contribuyente en instituciones que componen el sistema financiero**…»

La lógica está bien; lo equivocado es el rótulo del veredicto más duro.

### [BAJO] FIS-B4 — columna «IEPS de diésel» en pesos bajo «LIF 20-A fr. IV», fundada en «CFDI con desglose» (REINCIDENTE)

`src/app/dashboard/[id]/detalle.tsx:278` (la cabecera `<th>IEPS de diésel</th>`),
`:286` (la celda en `mxn()`) y `:298`, textual y sin cambio:

> «Diésel en litros (LIF 20-A fr. IV, estímulo por cuota semanal del DOF)… **IVA
> e IEPS sólo de CFDI con desglose**.»

Norma — `normas/lif-2026-20-A.yaml:124`, **`verificado_fuente_primaria`**,
literal:

> «cuota IEPS vigente al momento de la compra × LITROS. **No es el IEPS
> trasladado en el CFDI.**»

Sigue BAJO por la misma razón que en la 31: `engine.ts:1630` es
`const iepsAcreditable = 0` (verificado hoy, con su comentario `:1626-1629`), así
que toda liquidación nueva escribe 0 y no hay daño vivo. Lo que sí está vivo es
el pie, que se imprime siempre que haya algo acreditable.

### Los doce restantes, en tabla

| # | Título en corto | `archivo:línea` verificado hoy | ¿sigue? |
|---|---|---|---|
| **FIS-C2** (CRÍTICO) | cambiar la clave del SAT después no recalcula nada | `src/lib/saas/fiscal.ts:222-233` — `guardarDatosFiscales` hace `update(fila).eq('id', tenantId)` y no toca `perfil` ni `config`; `regimen_fiscal` va dentro de `fila` (`:207`) | **SÍ, la función entera sin un carácter de cambio** |
| **FIS-A1** (ALTO) | la «fuente única» del 15 % sigue siendo parámetro OPCIONAL y 8 llamadores no lo pasan | `src/lib/likida/fiscal.ts:577` (`perfilCrudo?: unknown`); sin perfil: `inicio-contenido.tsx:161,166,167,168` + `contador/inicio-contador.tsx:121,126,127,128` = **8**; con perfil: `chat-tools.ts:152`, `dinero.ts:165`, `fiscal.ts:519,1650,1716` | **SÍ, los mismos 8** |
| **FIS-A2** (ALTO) | la retención del 4 % no la teclea ningún formulario y la ayuda afirma lo contrario | `src/app/dashboard/facturacion/forma.tsx:159-170` | **SÍ** |
| **FIS-A3** (ALTO) | `0355` reescribe la RPC del panel del contador y no tiene test SQL | `supabase/migrations/0355_gastos_fiscales_sin_copias.sql` existe; `supabase/tests/` termina en `0354_cierre_insumos_hash_v2.sql` | **SÍ** |
| **FIS-M1** (MEDIO) | el criterio de copia portado a SQL es más ancho que el del motor | `0349:57-63` vs `engine.ts:514` | **SÍ** |
| **FIS-M2** (MEDIO) | `traerTodoDesdeId` no es inmune a inserciones | `src/lib/likida/pg.ts:264,267` | **SÍ** |
| **FIS-M3** (MEDIO) | el cubo del 15 % se define por exclusión de la lista de la LISR (5 familias), no de la RFA (4) | `engine.ts:126`, `:221-225`; `rfa-2026-2.9.yaml:60-71` | **SÍ** |
| **FIS-M4** (MEDIO) | el denominador suma combustible COMPRADO y la regla dice «pagos EFECTUADOS» | `0349:80` vs `:81-85` | **SÍ** |
| **FIS-M5** (MEDIO) | dos fichas `verificado_fuente_primaria` dan instrucciones opuestas sobre la caseta estatal | `rmf-2026-9.1.7.yaml:66` y `red-nacional-autopistas.yaml:88` | **SÍ** |
| **FIS-B1** (BAJO) | `exigibleHasta` sin un solo lector de producción | `normas/indice.ts:92` (definición) y `:286,320,352,364,376,388,400` (poblado) | **SÍ. Faltan 106 días para el 31-dic-2026** |
| **FIS-B2** (BAJO) | el `ayuda` de dedicación afirma ser válvula del estímulo de peaje, y el peaje no la lee | `src/app/dashboard/onboarding/forma.tsx:104` vs `perfil/preguntas.ts:126-133` | **SÍ** |
| **FIS-B3** (BAJO) | el comentario que funda la retención cita la migración equivocada | `src/lib/likida/facturacion_escritura.ts:156` («mig. 0351»; la buena es `0352_factura_retencion_iva.sql`) | **SÍ** |

---

## Lo que revisé y está bien

Lo abrí esta ronda y salió limpio. Vale tanto como los hallazgos: es lo que
distingue un rubro sano de uno sin revisar.

- **El árbol de decisión de la Carta Porte es correcto en sus tres entradas, y
  falla al lado seguro.** `carta_porte.ts:98-171`. Contra
  `rmf-2026-2.7.7.yaml:24-29`, **`verificado_fuente_primaria`**: *«los vehículos
  que no excedan los pesos y dimensiones de un camión tipo C2
  (NOM-012-SCT-2-2017) se entiende que NO transitan por tramos federales
  "siempre que en su trayecto la longitud del tramo federal que se pretenda
  utilizar **no exceda de un radio de distancia de 30 kilómetros**, los cuales se
  computarán entre el origen inicial y el destino final, incluyendo los puntos
  intermedios del traslado"»*. El código usa `<= 30` (`:156`) — «no exceda» es
  `> 30`, así que el 30 exacto cabe: correcto. El radio se pide como radio y no
  como odómetro, y lo dice en el texto (`:145`, `:68-69`). `C2R2`/`C2R3` van a
  `MAYOR_QUE_C2` (`:41-46`) con su porqué escrito (`:47-49`): camión C2 **más**
  remolque exige verificar pesos contra la NOM, y el lado seguro es exigir el
  complemento. Una configuración desconocida devuelve `null` y cae en
  `falta_declarar` (`:53-59`, `:137-154`), nunca en el lado cómodo.
- **El «no» nunca lo inventa el agente.** `carta_porte_wa.ts:27-31` declara el
  candado y el código lo cumple: la rama `necesita: 'no'` solo se alcanza con
  `ccp_pisa_federal` escrito por una declaración humana —el botón `ccp_no`
  (`:270-305`) o la forma del panel—, con rol re-gateado (`puedeAsignar`, `:272`)
  y tenant del lookup, y queda en bitácora (`carta_porte_datos.ts:289-293`,
  acción `ccp.declarado`). La evaluación se anota **siempre**
  (`carta_porte_wa.ts:124-128`), aunque el aviso no salga.
- **La contradicción «no pisa federal + radio declarado» está cerrada
  estructuralmente.** `carta_porte_datos.ts:259-261` lanza `DatoInvalido`, y el
  camino de WhatsApp la resuelve a favor de la declaración nueva con su porqué
  escrito (`carta_porte_wa.ts:274-278`). El radio ya medido se **preserva** al
  reapretar «sí pisa» en vez de borrarse.
- **El reparto 19/18 de responsabilidad implementa el último párrafo de la
  2.7.7.1.1.** `carta_porte.ts:193-239` (`CAMPOS_CCP`) contra
  `rmf-2026-2.7.7.yaml:14-17`, **`verificado_fuente_primaria`**: *«tanto quien
  contrate el servicio como quien lo preste serán responsables ante la autoridad
  cuando esta detecte alguna irregularidad en los datos, y "dicha
  responsabilidad se limitará a los datos que proporcione cada una de las
  partes"»*. El semáforo del transportista no se contamina con los huecos del
  cliente (`:252-255`, `transportistaListo`), y el hueco del cliente se reporta
  con su número y su fundamento (`carta_porte_wa.ts:66-68`).
- **Nada del complemento se rellena por el cliente.** `pesoBrutoDe` devuelve
  `null` si **algún** renglón no trae peso (`carta_porte.ts:303-306`) — una suma
  parcial se leería como el peso bruto total; `todas()` (`:312-317`) hace lo
  mismo por columna. La clave `c_ClaveProdServCP` se valida por formato de 8
  dígitos y puede quedarse vacía, con el texto que lo explica
  (`carta_porte_datos.ts:333-335`): *«Si tu cliente no te la ha dado, déjala
  vacía — no se inventa»*. `material_peligroso` admite `null` = no declarado
  (`:356-360`) y el XML solo emite el atributo cuando se declaró
  (`carta_porte_xml.ts:161`), porque un «No» supuesto decidiría por su cuenta
  que `AseguraMedAmbiente` no aplica.
- **El IdCCP cumple el formato del Estándar 3.1.** `carta_porte.ts:606-611`:
  `CCC` + `randomUUID().slice(3)` = 36 caracteres; `ID_CCP_RE` lo re-valida en la
  frontera del XML (`carta_porte_xml.ts:105-107`) y un IdCCP con forma mala corta
  el armado en vez de salir.
- **Las validaciones aritméticas de rechazo seguro coinciden con la
  investigación.** `carta_porte.ts:439-459` (PesoBrutoTotal = Σ PesoEnKg a
  ±0.001; NumTotalMercancias = nodos; TotalDistRec = Σ DistanciaRecorrida de los
  Destinos; distancia obligatoria en **cada** Destino) contra
  `docs/conocimiento/02-carta-porte.md:322` y `:337-340`, que las enumeran una a
  una. El caso traslado (`tipoComprobante: 'T'`) exige SubTotal/Total en cero,
  Moneda `XXX`, receptor = emisor y UsoCFDI `S01` (`:490-500`).
- **El CFDI timbrable falla cerrado en todo lo que sí revisa, y explica el
  rechazo del PAC antes de gastarlo.** `carta_porte_cfdi.ts:150-162`: PPD exige
  FormaPago `99`, PUE exige dos dígitos reales y rechaza `99` **con su razón**
  (`CFDI40158`). `:140-142` detecta los RFC genéricos `XAXX010101000` /
  `XEXX010101000` y dice que ese CFDI necesita `InformacionGlobal`, que Likida no
  arma — en vez de dejar que el PAC lo rebote sin explicación. `:145-147`: sin
  `ingreso_flete` capturado no hay CFDI, «el precio jamás se inventa». `:172-174`
  exige que la llegada estimada sea posterior a la salida.
- **La retención del 4 % está bien donde Likida timbra.**
  `carta_porte_cfdi.ts:199` (`esMoral = re.rfc.length === 12`; RFC de 13 = persona
  física → `null`), `:200` (`dinero(sub * 0.04)`), `:201`
  (`total = sub + iva − ret`), `:234` (`TasaOCuota="0.040000"`), `:241-247`
  (`TotalImpuestosRetenidos` y el nodo global con Retenciones antes que
  Traslados). Contra `normas/rliva-3-fr-II.yaml:14-17`,
  **`verificado_fuente_primaria`**: *«La retención se hará por el **4%** del valor
  de la contraprestación pagada efectivamente, cuando reciban los servicios de
  autotransporte terrestre de bienes…»*, que solo obliga a personas morales.
- **El estímulo de IEPS del MOTOR sigue siendo litros, no el IEPS trasladado.**
  `engine.ts:1630` (`const iepsAcreditable = 0`, y es `const` a propósito, con el
  comentario `:1626-1629` explicando que el motor no tiene la cuota semanal),
  contra `lif-2026-20-A.yaml:124`, **`verificado_fuente_primaria`**. La regla que
  el encargo nombra por su nombre está respetada en el motor y en el PDF; lo roto
  está fuera de los dos (FIS-A4, FIS-B4).
- **`cuota_diesel.ts` es fail-closed de verdad.** `:131-135` devuelve `null`
  fuera de rango, nunca la última conocida; `:107-124` valida sábado-a-viernes,
  empalme sin hueco y `reducción + disminuida = 7.3634` al diezmilésimo; `:83-85`
  rechaza el nombre viejo `estimulo_por_litro` con un `throw` que explica que
  multiplicarlo por litros da 2.2× de más. Es el lector correcto; el problema es
  que la superficie pública no lo usa.

---

## Lo que NO alcancé a revisar

Sin esto la nota es una mentira por omisión.

- **No ejecuté una sola línea de lo que reporto en Carta Porte.** Los dos
  hallazgos nuevos salen de leer `armarCfdiTimbrable` entera (256 líneas) y la
  función `domicilio()` (12 líneas puras), no de correr el caso. Intenté acotarlo
  con la suite del módulo —**86 pruebas verdes** en los cinco archivos de
  `carta_porte*` + `calculadora`— y el caso CP-sí/Estado-no **no está entre
  ellas**: `carta_porte_cfdi.test.ts:31` prueba todo capturado y `:42` todo nulo.
  Que la suite pase no contradice el hallazgo; tampoco lo confirma.
- **Ningún render.** No levanté preview de `/dashboard/carta-porte`, de
  `/dashboard/carta-porte/borrador/[viajeId]`, de `/calculadora` ni de
  `/dashboard/onboarding`. Todo lo de pantalla se sostiene en el `archivo:línea`
  del componente y de la función pura que lo alimenta.
- **Nada que requiera base viva ni red.** Sin Postgres no ejecuté `0349`, `0352`
  ni `0355`; sin egreso no crucé el DOF de las semanas 12–18 y 19–25 de
  septiembre, así que la dispersión de FIS-A4 la calculo con las 7 semanas que el
  repo tiene capturadas y no con la cuota real de hoy. Es deducción, y lo digo.
- **El `ClaveProdServ` del flete quedó como duda, no como hallazgo.**
  `carta_porte_cfdi.ts:44` fija `CLAVE_PROD_SERV_FLETE = '78101800'` para **todo**
  viaje, mientras `carta_porte.ts:120` le dice a la flota que el CFDI del traslado
  local lleva **`78101801`** («en área local»). Son dos claves distintas para el
  mismo concepto en el mismo producto. **No lo levanto como hallazgo** porque
  ninguna ficha de `normas/` transcribe el requisito del catálogo
  `c_ClaveProdServ` para el concepto del flete, y afirmarlo de memoria es
  exactamente lo que este rubro no admite. Queda como lead con su `archivo:línea`.
- **`carta_porte_timbre.ts` lo abrí solo en el tramo 255-320** (el gate del PAC,
  la coherencia sandbox/producción y la reserva). No revisé la consolidación, la
  cancelación ni qué pasa con la reserva de `ccp_timbre` cuando el PAC rebota —
  eso toca a otro rubro y no lo dictamino.
- **El techo estructural de la nota sigue en pie, y es el mismo desde la 28.**
  `normas/lisr-27-III.yaml` —la fracción detrás del veredicto rojo más frecuente
  del motor, del importe de $2,000 y de media docena de leyendas— sigue en
  **`evidencia_corroborante`**, con su `nota_verificacion` pidiendo leer el PDF
  vigente en diputados.gob.mx. Mientras eso no se cierre contra fuente primaria,
  el ancla de 8+ («cada cifra fiscal impresa rastrea a una ficha
  `verificado_fuente_primaria`») es **inalcanzable con independencia del
  código**. Esta ronda tampoco lo pudo cerrar: no hay red saliente.
- **`rfa-2026-3.12` sigue sin ficha** (39 archivos, ninguno es 3.12), y
  `normas/cff-29-A.yaml` sigue con `texto_vigente: null`, así que no puedo
  dictaminar si falta un requisito del 29-A en `intake/cfdi.ts`.
- **`facturacion/` no lo reabrí esta ronda** (ni `permiso_cre.ts`,
  `flota_fiscal.ts`, `enrutar.ts`, `vinculacion_asistida.ts`), ni
  `sat_descarga/`. Elegí ir a fondo en un solo tema, que era el encargo.
