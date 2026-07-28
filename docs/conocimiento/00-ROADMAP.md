# Roadmap: el agente experto en autotransporte de carga de México

> Síntesis final de las olas 1 y 2 (23 investigaciones), cerrada el **27 de julio de 2026**.
> Lee `00-RESUMEN-EJECUTIVO.md` para el marco fiscal; `00-OPORTUNIDAD.md` para qué más atacar;
> `00-MEJORAS.md` para la lista de cambios sobre el código que ya existe.
> Este documento decide **qué se construye, en qué orden, y qué no se construye**.

**La conclusión de una línea:** lo que está construido resuelve bien "¿este comprobante vale?".
Lo que falta —y lo que nadie más tiene— es la capa de **periodo** (los contadores fiscales del
ejercicio) y la capa de **fundamento citable** (que el veredicto traiga su norma, con fecha de
vigencia). El demo del 6-ago no se gana con features nuevas: se gana quitando las tres cifras
falsas que hoy el producto imprime en verde.

---

## Qué es este agente y qué NO es

**Es** un motor determinístico que emite **cuatro veredictos separados por comprobante**
(deducible ISR / IVA acreditable / genera estímulo IEPS / exento de ISN estatal), cada uno con su
fundamento citado y su fecha de vigencia, más los contadores acumulativos del ejercicio que
condicionan esos veredictos. El LLM narra y conversa; **nunca decide una cifra ni teclea un
artículo de memoria** (`guardia.ts` ya implementa ese patrón para cifras; hay que extenderlo a
fundamento — `20-arquitectura-conocimiento.md` §6).

**Es** el sistema que **prepara y marca**; el contralor decide. No por elegancia: el art. 26
fr. II de la LFPDPPP (DOF 20-mar-2025) le da al operador un derecho de oposición cuando un sistema
evalúa su fiabilidad o comportamiento **sin intervención humana** y con efecto significativo.

**NO es** un dictamen fiscal. La palabra "dictamen" está reservada al Contador Público Registrado
(CFF art. 52) y no puede aparecer en copy ni en salidas (`21-guardarrailes.md` §1.2). Fuera de esa
palabra, de la representación en juicio (LFPCA 5) y de presentarse como despacho contable (CPF 250),
**no existe reserva de actividad para "asesoría fiscal" en México**: Likida puede operar sin licencia.

**NO es** un asesor de planeación fiscal. El tercer verbo del agente es **RECHAZA**, y hay seis
preguntas tipo que no se responden nunca: cómo esquivar un tope, qué contestarle al SAT en una
auditoría, si conviene un recurso de revocación, garantías de no ser auditado
(`21-guardarrailes.md` §3.1 y §5.4).

**NO es** un TMS, ni un monedero de combustible, ni un PAC, ni una aseguradora, ni un sistema de
monitoreo antirrobo. Ver "Qué NO vamos a hacer".

**Advertencia de vocabulario, con consecuencia contractual** (`10-contradicciones.md` §6): el
paquete usa "bitácora" para dos documentos distintos. Fijar los nombres en producto, contrato y
landing, sin excepción:

- **bitácora fiscal de peaje (RMF 2026 regla 9.1.8 fr. II)** — origen, destino y ruta conciliados
  con el estado de cuenta del TAG. **Likida la genera sola. Se puede vender.**
- **bitácora de horas de servicio (RTCPJF art. 83 / NOM-087)** — diez campos más las firmas del
  conductor y del permisionario, multa de $2,346 a $3,519 por omitir un solo dato, conservación dos
  años. **Likida la pre-llena; el permisionario la firma. Nunca la sustituye.**

Un vendedor que diga "bitácora" a secas promete la que no puede entregar.

---

## Estado actual (con honestidad)

Auditoría línea por línea del 27-jul-2026 sobre `cuadra/src/lib/cuadra/**` (3,428 líneas de dominio,
23 archivos de prueba). Detalle en `40-auditoria-codigo.md`.

### Lo que funciona de verdad y no hay que tocar

Estas decisiones tienen medición encima, no opinión. Tocarlas es regresión garantizada.

- **Lectura de códigos con zxing y el protocolo de dos fotos** (`intake/cfdi.ts:227-267`,
  `intake/ocr.ts:129-142`). El UUID no pasa por visión porque se midió que jsQR falla a 1600/1200/900 px.
- **Folio impreso (31 chars) vs. folio del QR (30 chars)** como dos cadenas distintas
  (`intake/cfdi.ts:127-155`). Comprobado contra el papel.
- **Dígito verificador del RFC** (`intake/cfdi.ts:53-74`), con la excepción correcta para los RFC genéricos.
- **Mapeo conservador de EFOS** (`intake/sat.ts:61-78`): código desconocido → `null` + bandeja, nunca `true`.
- **Guardia determinística de cifras**, fail-closed (`cuadre/guardia.ts:23-48`).
- **Emparejamiento que se niega a adivinar** sin candidato único (`intake/emparejar.ts`).
- **Cierre atómico e idempotente** (`repo.ts:285` + migración `0013`).
- **RLS deny-all y revocación de RPC a `public`** (migraciones `0012`, `0016`).
- **Validación de CFDI contra el servicio público del SAT**, sin credenciales del cliente
  (`intake/sat.ts`). Probado en vivo contra el servicio real: obligatorios `id`, `re`, `rr`, `tt`;
  el Acuse trae `ValidacionEFOS` (`11-huecos.md`). Ojo: el código 602 es **ambiguo** (un total mal
  leído, un RFC mal transcrito y un UUID inexistente devuelven los tres el mismo 602). Mostrarlo como
  "factura apócrifa" acusa en falso al proveedor del cliente.

### Lo que está construido pero está mal

Tres cifras que el producto imprime **en verde** y le manda al chofer por WhatsApp:

1. **El IEPS del diésel se lee del XML** (`engine.ts:236-241`). La LIEPS art. 19 fr. II prohíbe que
   la gasolinera lo desglose a quien no es contribuyente del IEPS por esos bienes. `iepsAcreditable`
   será **siempre 0**, y la alarma `ieps_no_desglosado` dispara en el **100%** de las facturas de
   diésel, mandando toda liquidación a `revisar`. El estímulo es **litros × cuota**, y los litros ya
   se extraen (`ocr.ts:284`) y se tiran al jsonb.
2. **El 50% de casetas** (`engine.ts:231`) cumple **1 de 5** requisitos de la RMF 2026 regla 9.1.8:
   no verifica TAG, ni bitácora conciliada, ni aviso de marzo, ni el tope de 300 MDP.
3. **El diésel en efectivo** se declara no deducible sin excepción (`engine.ts:106-107, 218`),
   contra la corrección C1 ya verificada (RFA 2026 regla 2.9: hasta 15% del combustible del ejercicio).
   Agravante: ese veredicto se toma sobre un `formaPago` que en el camino de la foto lo **infirió el
   modelo de visión** de un ticket térmico (`ocr.ts:247`), y el motor no distingue esa fuente del
   `c_FormaPago` del XML.

Más cuatro fugas silenciosas de dinero (dedupe apagado por bandera, caseta por XML que nunca es
caseta, `catch → DEMO_CONFIG` que apaga la validación del RFC receptor, PDF que trunca sin avisar)
y el tope de viáticos aplicado al concepto y a la unidad equivocados. Todo el detalle, con línea de
código y esfuerzo, está en `00-MEJORAS.md`.

### Lo que no existe

- **La capa de periodo completa.** Ninguno de los cinco contadores fiscales ni de los dos laborales
  existe. El motor corre viaje por viaje, sin noción de mes ni de ejercicio.
- **Grupo fiscal A/B, régimen del operador, base de asignación, entidad `Unidad`.** Los cuatro campos
  que no se pueden agregar después sin migrar todo.
- **Estados `EN_EXCEPCIÓN`, `LIQUIDADA`, `CERRADA`.** Hoy la máquina llega a `cuadrada`.
- **Fundamento citable con fecha de vigencia.** `config.ts:87` ya tiene una cita frágil en producción
  (`vigenteDesde: '2026-04-24'`, comentario "RMF 2.7.1.8") sin ningún campo de estado de verificación.
- **Aviso de privacidad, consentimiento y mecanismo de oposición.** Cero resultados en el repositorio.
- **La leyenda de los arts. 89 y 90 del CFF** en ninguna salida.
- **~600 líneas (18% del dominio) que nunca se ejecutan**: el módulo `facturacion/` completo (501
  líneas, cero consumidores), media `config.ts`, `getStatsPorOperador()` que devuelve `diferencias: 0`
  hardcodeado, y `detectarAnomalias()` —que sí vale— desconectada.

---

## Fase 0 — antes del demo del 6-ago-2026

**Son 10 días.** Todo lo de abajo es esfuerzo bajo y ya está diagnosticado con archivo y línea.
Nada aquí es investigación nueva.

**Objetivo:** que ninguna cifra que el producto imprima sea falsa, que la pantalla de excepciones
funcione, y que el material comercial sobreviva a la primera pregunta del fiscalista de un contralor.

### Entregables

**Día 1 — las que se hacen hoy mismo (una tarde)**

1. `CUADRA_DEDUP_FOTOS=1` en el entorno del demo y de producción (`processor.ts:123`). Sin esto, el
   operador reenvía la foto "por si no llegó" y la diferencia contra el anticipo sale mal **a favor
   del operador**. Puede pasar en la demo.
2. Borrar la regla `ieps_no_desglosado` (`engine.ts:238-240`) y su tipo. Hoy manda **toda**
   liquidación con diésel a `revisar` y anula la pantalla de excepciones, que es el argumento de
   producto entero.
3. Reescribir la nota de `combustible_efectivo` a "verificar contra el 15% del ejercicio (RFA 2026
   regla 2.9)" y sacarla de `NO_DEDUCIBLE` (`engine.ts:106-107, 218`).

**Días 2-5 — código**

4. Mapear `claveProdServ → concepto` al ingerir XML (`processor.ts:245-249`): hoy solo hay `diesel` o
   `factura`, y toda caseta timbrada pierde el estímulo.
5. Separar el enum `viaticos` en `alimentacion` / `hospedaje` / `transporte` y aplicar el tope de
   $750 **solo a alimentación, por día y por beneficiario** (LISR 28 fr. V). No existe tope de
   hospedaje nacional.
6. Sumar y persistir `totalDeducible` / `totalNoDeducible` en `Liquidacion`. Es un `reduce` y una
   columna, y es **la única cifra que el contralor compra**.
7. Renglón "… y N comprobantes más" en el PDF (`pdf.ts:114, 164`). Hoy, a partir de ~15 comprobantes,
   los conceptos impresos no suman el total impreso. Ese papel es el que se archiva.
8. El veredicto adverso ("no deducible", "EFOS") deja de enviarse al operador y va solo al contralor
   (`resumen.ts:22-26` → `processor.ts:365`). Al operador se le pide lo que falta, no se le juzga.
9. Leyenda de los arts. 89 y 90 del CFF en el pie del PDF y en el mensaje de cierre
   (`21-guardarrailes.md` §5.2 trae las tres redacciones). Es la mitigación que la propia ley ofrece
   a "quien preste servicios".
10. Decidir sobre `facturacion/`: **sacarlo del árbol de build** (recomendación) o conectarlo.
    501 líneas sin consumidores son superficie que hay que explicar en la demo.
11. Conectar `detectarAnomalias()` al dashboard (un import): detecta el mismo CFDI en dos viajes, que
    es el fraude #1 del sector.

**Días 3-6 — conocimiento y documentos**

12. Crear `normas/` con **~12 fichas**, una por cada cita que ya vive en el código: 2.7.1.48,
    LIF 20-A-IV, LIF 20-A-V, LISR 27-III, LISR 28-V, CFF 29/29-A, RMF 2.7.1.12, RFA 2.2, RFA 2.9,
    criterio 1/LIF/PI, LFPDPPP 26-II, RMF 9.1.8. Formato en `20-arquitectura-conocimiento.md` §5:
    texto verbatim + fecha DOF + **`jerarquia`** (ley / facilidad administrativa / criterio no
    vinculativo / política de comercio) + **`estado_verificacion`**. Es una carpeta en git, no una
    base de datos.
13. **Alinear `FISCAL_LEGAL.md` dentro del repo** (`40-auditoria-codigo.md`, CONFLICTOS B y C):
    §1.1 sostiene la versión dura del diésel en efectivo en negritas y la llama "lo más importante de
    todo el documento" — es el archivo que está alimentando la regla equivocada del motor. Y §1.6
    cita la factura global como "RMF 2.7.1.24", cita muerta: en 2026 es la **2.7.1.21**.
14. **Barrido de citas muertas en todo el material comercial**: "LIF artículo 16" (hoy es el
    **artículo 20, apartado A**), "$113.90 de viáticos de tripulación" (esa facilidad ya no existe),
    "10% de deducción ciega" (es 8% con tope de $1M), montos de multa sacados de blogs.
15. **Retirar del material comercial** los dos datos de tamaño de mercado incompatibles ("95% con
    menos de 30 camiones" vs. "97% con menos de 20"), la cifra de permisos de la CNE (usar **346** y
    **17,385**, no 363 ni 17,840) y cualquier porcentaje de combustible sobre costo operativo hasta
    tener la canasta CANACAR en fuente primaria.
16. Congelar las **32 preguntas doradas** de `22-evaluacion.md` §5 en un JSON versionado con fecha de
    vigencia por pregunta, y correr a mano las **10 preguntas trampa** contra el agente actual como
    línea base. El panel de 4 jueces completo no cabe en 10 días; la línea base sí.

### Criterio de terminado verificable

- [ ] `npm test` y `npx tsc --noEmit` pasan (nadie los corrió en la auditoría; es probable que
      `engine.test.ts` **fije** el comportamiento equivocado de `combustible_efectivo` y haya que
      cambiar la prueba junto con la regla).
- [ ] Una liquidación de prueba con 20 comprobantes, incluyendo dos facturas de diésel con XML y una
      foto duplicada, sale en estatus `cuadrada` (no `revisar`), con `totalNoDeducible` impreso, sin
      duplicar el gasto, y con el PDF marcando cuántos renglones no cupieron.
- [ ] `grep -rn "2.7.1.24\|LIF.*art.*16\|113.90\|10% de deducción" src/ *.md` → 0 resultados en repo
      y material comercial.
- [ ] `normas/` tiene 12 fichas, cada una con `jerarquia` y `estado_verificacion`, y `config.ts:87`
      apunta a la ficha correspondiente con su estado real.
- [ ] Ninguna salida al operador contiene la cadena "no deducible" ni "EFOS".
- [ ] El PDF trae la leyenda del CFF 89/90 al pie.
- [ ] Las 10 preguntas trampa corridas, con el resultado escrito (no importa que falle; importa
      saber dónde se está parado).

### Riesgos de esta fase

- **Cambiar reglas rompe pruebas que fijan el comportamiento viejo.** Presupuestar medio día para eso.
- **Tentación de meter features en la demo.** Los contadores de periodo, el ECC de monedero y el motor
  de cuotas semanales **no caben en 10 días**. Enseñar lo que existe, bien, vale más que enseñar tres
  cosas a medias.
- **La demo enseña una cifra de estímulo de diésel en pesos.** No lo hagas: ver la decisión D2 abajo.

---

## Fase 1 — el agente que no se equivoca

**Horizonte:** de la demo al primer cliente pagado.

**Objetivo:** que cada veredicto traiga su fundamento con fecha de vigencia, que exista la capa de
periodo, y que haya una forma medible de saber si el agente se equivoca antes de que lo descubra un
cliente.

### Entregables

**Conocimiento (Capa 0 y Capa 4 de `20-arquitectura-conocimiento.md` §4)**

1. `normas/` crece de 12 a ~40 fichas, cubriendo todo lo que el motor cita.
2. **`guardiaFundamento()`**, gemela de `guardiaCifras()`: el modelo solo puede referenciar un
   `norma_id` devuelto por una tool **en ese turno**; el servidor sustituye el texto real. Nunca
   teclea un artículo de memoria. Es la única forma de que "no alucina el artículo" sea garantía de
   arquitectura y no esperanza sobre el prompt.
3. Tipo `VeredictoFiscal` con `fundamento: { norma_id }[]` — referencia, no texto libre.
4. Estado **`sin_criterio` / `requiere_revision`** de primera clase en el esquema de veredicto, con
   enrutamiento obligatorio a la bandeja de excepciones. El paquete ya documenta 5+ huecos reales de
   la ley misma (tope de $1M por integrante o por coordinado, si el 8% reduce base de PTU,
   metodología del radio de 30 km, faja de 50 km para operador de largo recorrido, periodicidad del
   15%). Esos casos van a llegar con clientes reales; no son errores.
5. Campo `jerarquia` en `CuadraConfig`, separando `estimulos`/`hidrocarburos` (ley/RMF) de `portales`
   (política de un tercero, cero fuerza legal). Fundamento: CFF art. 33 fr. I inciso g) + tesis SCJN
   P.LV/2004 — la RMF no puede crear obligaciones más allá de la ley. La regla dura
   **LEY ≠ FACILIDAD ≠ POLÍTICA INTERNA** deja de ser estilo y se vuelve un campo obligatorio.

**Guardarraíles (`21-guardarrailes.md`)**

6. Los **tres verbos** (AFIRMA / CONDICIONA / RECHAZA) como categorías explícitas del agente, con las
   6 plantillas de rechazo cableadas a los patrones de pregunta que las disparan. Sin el tercer verbo,
   un LLM tiende a *condicionar* respuestas que debería rehusarse a dar.
7. Plantilla fija de incertidumbre (hecho conocido + regla citada + lo que falta verificar + quién
   decide), sin que el "SIN VERIFICAR" quede en otra pantalla que el veredicto.
8. Prohibir por validación de UI las palabras "dictamen", "garantizo", "seguro" sin condicional
   (CFF 52 + publicidad engañosa, LFPC 32).
9. Cláusula de ToS basada en la de CONTPAQi (la única cláusula de IA explícita del mercado mexicano
   de software fiscal), **condicionada a que el contralor tenga control real** — aprobar y editar
   reglas, no solo aceptar el ToS una vez.
10. Registro con timestamp y usuario cada vez que un contralor sigue adelante después de un
    `CONDICIONA` o un `SIN VERIFICAR`. Es la evidencia que sostiene la defensa civil (CCF 1910/1913).

**Modelo de datos — los campos que no se pueden agregar después**

11. `grupo_fiscal` A/B explícito, derivado del concepto, no opcional. Es el candado estructural que
    impide que diésel llegue a Percepción 050 de nómina.
12. `régimen` del operador **derivado, nunca capturado como selección**: propiedad de la unidad +
    propiedad del permiso SICT. La LFT art. 256 dice que la relación entre el chofer y el
    propietario/permisionario **es relación de trabajo por ley** y que el pacto en contrario "no
    produce ningún efecto legal". Si el pacto dice "prestador de servicios" y conduce unidad de la
    flota, el sistema **advierte**, no acepta la bandera.
13. `base_asignacion` en `operador` (faja de 50 km, LISR 28-V / RLISR 57) y `salario` (topes LFT 110).
14. Tabla `unidad` real (placa, capacidad de tanque, rendimiento esperado por tipo de carga,
    propietario, TAG y monedero asignados), sacándola de `tenant.config` jsonb.
15. Booleano `formaPagoDeXml` en `Gasto`. Es la primera pregunta del contador del primer cliente.
16. Campo `hora` estructurado en el schema de OCR (hoy se descarta al normalizar a `YYYY-MM-DD`).

**La capa de periodo — la propuesta de valor que ningún competidor tiene**

17. **Contador del 15% de combustible en efectivo** (RFA 2026 regla 2.9), por tenant y ejercicio, con
    semáforo a 12%. Empezar por este. Rebasarlo tira el excedente **completo**, no proporcionalmente,
    y con él su IVA. *Periodicidad SIN VERIFICAR: la regla no dice si es mensual, acumulado o anual.
    Mostrar el cálculo bajo el supuesto conservador y decirlo.*
18. Contadores del **8% / $1,000,000 / 16% definitivo** (RFA 2.2) y del **20% / $15,000 por operador**
    (RLISR 152), este último con verificación de que el 80% restante se erogó con tarjeta del patrón.
19. **Los dos topes laborales del art. 110 fr. I de la LFT**: deuda exigible ≤ un mes de salario,
    descuento por periodo ≤ 30% del excedente sobre el salario mínimo. Sin ellos, la liquidación
    puede imprimir un "a pagar: $0" ilegal.
20. **Separar el veredicto fiscal (`deducible`) del laboral (`pagadero`).** LFT arts. 257 y 263 fr. I:
    cuando el viaje se alarga por causa ajena al operador, el patrón debe pagar hospedaje y comida
    aunque el gasto rompa la política interna o el tope fiscal de $750/día.

**Máquina de estados y terminación**

21. `EN_EXCEPCIÓN` explícito, `LIQUIDADA` (con topes laborales aplicados) y `CERRADA` (bloquea cargos
    nuevos).
22. Partir `REVISAR` (17 tipos incomparables hoy) en **`en_excepcion`** (fiscal, lo ve el contralor) y
    **`sin_validar`** (técnico, lo resuelve un reintento). Hoy `sat.ts:50,82` devuelve `pendiente`
    ante cualquier caída, así que una tarde con el SAT lento manda **todo** a revisión.
23. Cola de reconsulta para `estadoSat === 'pendiente'` (hoy se consulta una sola vez, dentro del OCR).
24. Incluir `cfdi_pendiente` y `cfdi_efos_indeterminado` en el filtro de acreditamiento
    (`engine.ts:218-228`): hoy se acredita IVA de CFDI que el SAT nunca confirmó.
25. Tratar el **602 del SAT como "no se pudo confirmar"**, con reintento de variantes del total — no
    como "apócrifa".

**Motor de cuotas semanales de IEPS** *(sube de Fase 2 a Fase 1: ver decisión D2)*

26. Ingestor del acuerdo semanal del DOF con tabla `{fecha_inicio, fecha_fin, combustible,
    cuota_disminuida}`, patrón de `intake/sat.ts` (timeout corto, fail-open a `pendiente`).
27. Persistir `litros` como **columna**, no en jsonb, y calcular el estímulo como **litros × cuota
    vigente al momento de la adquisición**, con el candado de medio de pago del 4º párrafo de la
    LIF 20-A-IV (monedero, tarjeta a favor del contribuyente, cheque nominativo o transferencia —
    **sin** la válvula del 15% que sí existe para ISR).
28. **Exponer la cuota de la regla 11.7.3 por separado, nunca fusionada** con la del acuerdo semanal,
    hasta que un fiscalista aclare la relación entre las dos.

**Evaluación (`22-evaluacion.md`)**

29. Libro mayor de citas verificadas (J1): cada cita ya confirmada en `01`–`11`, `10-contradicciones`
    y `11-huecos`, con su URL primaria. Es trabajo ya hecho once veces; falta consolidarlo.
30. Gate de citas inventadas: **0% de tolerancia**, bloqueo automático de release.
31. Jueces J2 (rúbrica) y J3 (adversarial) — J3 prompteado literalmente con las 12 contradicciones y
    las 6 correcciones C1–C6 como casos de entrenamiento; un juez adversarial genérico no sirve.
32. Gate de regresión en CI del repo `cuadra`: las 32 preguntas + la biblioteca adversarial en cada
    cambio de prompt, modelo o corpus; caída >5 pp bloquea.
33. Caso de prueba de **inyección de prompt vía texto oculto en la foto del ticket**, contra el
    pipeline real de `intake/`. Es un vector sobre código que ya existe, no una hipótesis.

**Legal antes del primer cliente pagado**

34. Aviso de privacidad en modalidad simplificada para el flujo de WhatsApp (LFPDPPP art. 16 fr. II)
    **con prueba de entrega** — la carga de la prueba es siempre del responsable (Reglamento art. 31).
35. Filtro de detección y exclusión de datos sensibles (un ticket de farmacia revela salud;
    LFPDPPP art. 8 párr. 2, y el art. 64 permite duplicar penas de prisión).
36. ZDR por escrito con el proveedor de IA, y prohibición por lint de los endpoints no elegibles
    (la API de archivos es la trampa obvia para subir fotos de tickets).
37. Contrato: quién notifica una brecha, con qué texto y quién paga. El titular a notificar es **cada
    operador**, no el contralor: 50 flotas × 40 choferes = 2,000 notificaciones individuales.

### Criterio de terminado verificable

- [ ] Un veredicto emitido por el motor no puede serializarse sin al menos un `norma_id` válido;
      hay una prueba que lo demuestra fallando.
- [ ] `guardiaFundamento()` bloquea una respuesta del modelo que contiene "artículo 27" sin que ese
      norma_id haya sido devuelto por una tool en ese turno. Prueba automatizada.
- [ ] El contador del 15% corre sobre datos de un ejercicio completo simulado y dispara el semáforo
      a 12%.
- [ ] Un operador con unidad de la flota y bandera "prestador de servicios" produce una advertencia,
      no un régimen `tercero`.
- [ ] Una liquidación con un anticipo mayor que el salario del mes produce un descuento topado por
      LFT 110, no un "a pagar $0".
- [ ] Las 32 preguntas doradas corren en CI, con 100% en trampas, 0% de citas inventadas, ≥95% en
      severidad 3 y <10% de abstención excesiva.
- [ ] El caso de inyección vía OCR no logra que el agente emita un veredicto que la regla no soporta.
- [ ] Existe el aviso de privacidad con prueba de entrega y hay un registro de una entrega real.

### Riesgos de esta fase

- **Los umbrales ≥95%/≥90% se propusieron por analogía con benchmarks de industria, no midiendo a un
  fiscalista humano real contra las mismas 32 preguntas.** Vale la pena esa medición de referencia.
- **Sin J4 (fiscalista con cédula) el panel queda en 3 jueces y pierde su mecanismo de resolución de
  desacuerdos.** Es el gasto que la tentación es recortar primero. Ver decisión D1.
- **Sobre-ingeniería de la Capa 0.** `normas/` es una carpeta en git revisable con `git diff` por un
  fiscalista que no sabe SQL. Se promueve a tabla de Supabase cuando el volumen lo justifique, no antes.
- **Los contadores dependen de datos que el cliente tiene que dar** (ingresos del tenant para el
  8%/300 MDP, salario del operador para LFT 110). Si no llegan en el onboarding, el contador miente
  en silencio: tiene que mostrarse `sin_evidencia`, no en verde.

---

## Fase 2 — el agente que vigila

**Horizonte:** con 1-3 clientes activos.

**Objetivo:** que el producto trabaje entre liquidaciones. Es el ROI más fácil de defender frente a
un contralor porque no le pide nada nuevo.

### Entregables

**Vigilancia normativa — tres anillos con tres velocidades (`23-actualizacion.md` §2)**

1. **Anillo 1, leyes (mensual).** Índice diario del DOF, que responde 200 a peticiones automatizadas,
   + `pdftotext -layout`, ya instalado. El método está probado dos veces por investigaciones
   independientes de esta ola.
2. **Anillo 2, RMF/RFA (semanal).** Scraper del minisitio HTML `normatividad_rmf_rgce{año}.html` — **no**
   la SPA que devuelve 403. Hallazgo crítico: la RMF se modifica en **versiones anticipadas que ya son
   legalmente vigentes desde su publicación en el portal del SAT**, no desde el DOF. La 1a Resolución
   de 2026 tuvo **16 versiones anticipadas** (23-feb a 2-jul), con ritmo semanal estable desde mayo.
   Vigilar solo el DOF es vivir con semanas de retraso respecto a reglas ya vigentes.
3. **Anillo 3, catálogos y XSD (diario).** `HEAD` + diff del `Last-Modified` de cada XSD/XLS que el
   validador consuma. Es el mecanismo que descubrió el `Last-Modified` de HidroYPetro y que atrapó al
   `catCartaPorte.xsd` cambiando el 13-ene-2026 mientras la página seguía diciendo 13-dic-2024.
4. El vigilante **degrada `estado_verificacion` a `revisar`**; no bloquea conversaciones ni manda
   alarmas que nadie lee.

**Radar de contrapartes y activos (`31-cumplimiento-continuo.md` §4)**

5. **Barrido semanal** de los CSV de datos abiertos del SAT (arts. 69, 69-B, 69-B Bis, CSD sin
   efectos) contra todos los RFC recurrentes de cada flota. Ojo: esos archivos llevan **semanas o
   meses de retraso** (el 69-B decía "actualizado al 31-may" consultado el 27-jul). Son **red de
   respaldo**, no fuente principal; la principal sigue siendo el web service puntual por CFDI.
6. **Validación masiva de RFC** (hasta 5,000 por corrida, sin autenticación), mensual.
7. **Reloj del art. 49 Bis: 30 días naturales.** Si un proveedor recurrente sale publicado en el DOF
   por el procedimiento exprés de comprobantes falsos y la flota no revierte el efecto fiscal, el SAT
   le restringe **su propio CSD** — no puede facturarle a sus clientes. Es riesgo de continuidad de
   negocio, no solo fiscal.
8. **Reloj del buzón tributario: 3 días.** Cuando un emisor pide cancelar un CFDI, el receptor tiene
   3 días para negarse y **el silencio es aceptación** (RMF 2026 regla 2.7.1.34).
9. **Registro de vencimientos por unidad y por operador** (licencia federal, aptitud psicofísica,
   verificación físico-mecánica, verificación de emisiones, pólizas), con carga de evidencia,
   extracción de fecha por OCR y alertas **T-30 / T-15 / T-1**. Ninguna de esas cinco cosas tiene
   consulta pública verificada: **ese es exactamente el hueco del mercado**. Un registro con evidencia
   documental vence a una promesa de API que no existe.
10. Estado `sin_evidencia` distinto de `vencido`: nunca se cierra una alerta solo con OCR de baja
    confianza.
11. Chequeo mensual del **32-D de la propia flota** (con las credenciales que el contralor ya usa).
    El 32-D de un **proveedor** no se puede consultar sin que él autorice a Likida como tercero: no
    prometerlo.

**Detección de desviaciones (`32-fraude.md` §3) — las seis primeras no necesitan ningún campo nuevo**

12. `duplicado_entre_viajes`: ampliar el dedupe a alcance de **tenant**, no de viaje
    (`repo.ts:gastoExistePorHash` recibe `viajeId` hoy).
13. `folio_repetido_monto_distinto`: cambiar la clave de `concepto|folio|monto` a
    `concepto|estación|folio` y **marcar** cuando el monto difiera. Es la huella del ticket alterado.
14. `dias_viatico_excede_viaje`, `precio_litro_fuera_de_historico_propio`, `caseta_fuera_de_historico`,
    `folio_no_facturado_prolongado`.
15. Feed público diario de la CNE (precio de gasolina y diésel por estación, Acuerdo A/041/2018, sin
    credenciales) como referencia externa de precio por litro.
16. **Regla de diseño no negociable:** ninguna alerta descuenta, retiene pago ni concluye. La plantilla
    es *medido / comparado contra / desviación / lo que no se sabe / quién decide*, con al menos una
    explicación no fraudulenta plausible, y **nunca las palabras "fraude", "robo" o "robó"**.
    Es requisito de la LFPDPPP art. 26 fr. II, no buen gusto.

**Integraciones que valen más que cien features**

17. **Estado de cuenta del emisor de monedero de combustible** (Edenred, Efectivale, Sí Vale, Toka,
    Broxel). Dato timbrado y granular, mejor que cualquier OCR. Y si la flota usa monedero autorizado,
    la gasolinera **tiene prohibido** facturarle (RMF 3.3.1.7): la foto del ticket fiscalmente no sirve.
18. **CFDI mensual del proveedor de TAG** (IAVE, PASE, TeleVía) + **exportador de la bitácora fiscal de
    peaje conciliada** + **generador del inventario vehicular de marzo** (RMF 9.1.8 frs. I y II).
    Esto último se vende solo.
19. **Comprar la capa ticket→CFDI, no construirla** (FacturaGPT: $4 MXN + IVA por CFDI exitoso,
    `external_id`, webhook, +1,000 comercios). Construir solo los 10-15 conectores de carretera que
    importan.

**Cierre contable del contralor — el dolor más cercano de todos (`30-dolores-flota.md` §11)**

20. **Reloj de 5 días** de RCFF art. 33 en la máquina de estados: cada gasto debe quedar asentado
    dentro de 5 días, ligado al folio del CFDI y con forma de pago. Es el mejor argumento de urgencia
    del producto y nadie lo usa.
21. Export ampliado: **UUID + forma de pago por renglón** (requisito literal del RCFF), póliza sugerida
    por grupo fiscal, **DIOT** (LIVA 32 fr. VIII), insumos de nómina 003/050/081.
22. **Carpeta de auditoría** (diagrama del sistema, descripción del almacenamiento y procesamiento,
    export íntegro) como entregable de onboarding. El RCFF art. 34 obliga al cliente a tenerla; si
    Likida no se la da, el cliente incumple sin saberlo.
23. Reloj de reintegro de terceros (31-dic, o 31-mar del siguiente si el dinero se entregó en diciembre).

### Criterio de terminado verificable

- [ ] El vigilante corrió cuatro semanas seguidas y degradó al menos una ficha a `revisar` sin
      intervención humana; hay bitácora de sus corridas.
- [ ] Un RFC de prueba metido a mano en la lista simulada produce una alerta al contralor con el
      reloj de 30 días visible, y **no** una alerta al operador.
- [ ] El registro de vencimientos dispara T-30 sobre una póliza cargada con fecha de vigencia leída
      por OCR, y una fecha ilegible queda como `sin_evidencia`, no como `vigente`.
- [ ] Las seis reglas de desviación corren sobre el histórico de un cliente real y ninguna salida
      contiene las palabras prohibidas; todas traen la explicación alternativa.
- [ ] El export de DIOT cuadra contra el CFDI recibido de un mes real del cliente.
- [ ] Un CFDI de monedero ingerido por ECC produce el mismo veredicto que la foto del mismo consumo,
      y el sistema prefiere el ECC.

### Riesgos de esta fase

- **Prometer validación de lo que no tiene fuente pública.** Permiso SICT de empresa, verificación
  físico-mecánica, verificación de emisiones, aptitud psicofísica y vigencia de pólizas **no tienen
  consulta pública verificada** (a pesar de que el art. 202 de la LISF obliga a registrar las pólizas
  ante la CNSF). Se vende registro de vencimientos con evidencia, jamás "validamos contra la autoridad".
- **Automatizar portales ámbar sin mandato escrito.** PASE, TeleVía y OXXO GAS fueron leídos y no lo
  prohíben, pero exigen mandato escrito, User-Agent identificado, rate limit conservador y **cero
  bypass de CAPTCHA**. Los PAC y plataformas de facturación son **rojo**: EdiFactMx prohíbe "spiders,
  robots, avatars o agentes inteligentes". La cláusula de cuenta intransferible es más peligrosa que
  la de scraping: el incumplimiento lo comete **el cliente** y le pueden cancelar el TAG a media semana.
- **El padrón público de la CNE no trae RFC** y lleva ~6 semanas de rezago. La promesa honesta es
  "al corte de {fecha} de la CNE aparece como vigente", nunca "este permiso pertenece a quien me facturó".
- **Emisores de monedero:** su autorización se renueva anualmente (ficha 7/ISR, agosto-octubre) y el
  SAT publica el padrón de no renovados. Si el emisor cae, el cliente se queda sin comprobante
  deducible de combustible. Hay que vigilarlo.

---

## Fase 3 — el agente que expande

**Horizonte:** después de validar el producto principal con los primeros clientes de pago.

**Objetivo:** profundizar el mismo dato, no diversificar la fuente de datos.

### Entregables, en orden

1. **Detección de ordeña por rendimiento.** Pedir el odómetro junto a **cada** ticket de diésel
   (no solo cuando hay monedero) y cruzar litros contra km ÷ rendimiento esperado, por unidad y por
   operador. Detecta el robo del propio tanque (80-300 L por evento) con aritmética simple, sin GPS
   ni telemetría. Requiere la entidad `Unidad` de la Fase 1.
2. **Tiempos de espera en carga y descarga.** Evento `llegada` / `salida` de zona, con hora y
   geolocalización. Likida ya tiene la mitad del dato en los timestamps de WhatsApp. No es solo costo
   de oportunidad: la LFT arts. 257 y 263 fr. I convierten la demora ajena al operador en **obligación
   salarial medible**. Ningún competidor del mapa lo tiene.
3. **Mantenimiento preventivo por unidad.** Mismo odómetro del punto 1. CFDI de taller como tercer
   tipo de intake, con campo `programado` vs. `emergencia` — separa gasto de unidad de gasto de viaje
   y evita inflar el costo por viaje.
4. **Registro electrónico de jornada laboral** (LFT art. 132 fr. XXXIV, reforma DOF 01-05-2026),
   obligatorio desde el **1-ene-2027**, multa de 250 a 5,000 UMA ($29,327 a $586,550). Reutiliza los
   mismos timestamps. Fecha fija, multa nombrada, cero competidores. *Las disposiciones de carácter
   general de la STPS aún no se emiten: no se sabe qué flotas quedan exceptuadas ni qué formato pide
   la autoridad.*
5. **Detector de horas de servicio con umbral de 12 h**, no 14. Ver el conflicto CN-6 abajo.
6. **Expediente de siniestro**: tipo de evento distinto de "comprobante", con checklist de documentos.
   Likida ya tiene la mitad (fecha, hora, ubicación, fotos del viaje).
7. **API del motor de validación fiscal** (faja de 50 km, hidrocarburos, deduplicación, régimen del
   operador) vendida a despachos contables y a otras verticales de gasto en carretera, comprando la
   capa de certificación a un PAC. Es **la única línea adyacente 100% defendible**: aprovecha el
   activo único de Likida (el viaje) en vez de competir donde hay más capital o donde el gobierno
   regala el dato.
8. **Convenios de referidos, cero capital y cero licencia** (LGOAAC art. 87-B: cualquier persona puede
   otorgar crédito, arrendamiento financiero o factoraje sin autorización federal; la barrera es el
   fondeo, no el trámite): factoraje con Solvento o una SOFOM; seguro de carga con un broker
   especializado (Sumari, MAS Seguros, Sobera, Transcargo); financiamiento de unidades con Serfimex,
   Credijal o Grupo IBC.
9. **Investigar el art. 102 de la LISF** (persona moral que coloca seguros de adhesión sin ser agente
   completo): podría abrir un seguro de carga embebido y cotizado por viaje que ningún TMS ni app de
   facturación ofrece hoy.

### Criterio de terminado verificable

- [ ] La regla de rendimiento produce menos de una alerta por unidad por mes sobre datos reales
      (si produce más, el umbral está mal calibrado y el contralor la apaga en la primera semana).
- [ ] El registro de jornada emite un acuse que el operador confirma por WhatsApp, con sello de tiempo
      y conservación de dos años, antes del 1-ene-2027.
- [ ] Al menos un despacho contable consume la API de validación en producción y paga por ella.
- [ ] Hay un convenio de referidos firmado y una comisión cobrada.

### Riesgos de esta fase

- **Diluir el producto.** Los tres dolores más caros del sector (robo de mercancía >$7,000M MXN/año,
  rotación de operadores ~$215k MXN por baja, cobranza a 53-90 días) **no comparten el dato de origen**
  que hace defendible la liquidación. Ver "Qué NO vamos a hacer".
- **El registro de jornada choca con la NOM-087.** Ver CN-6.
- **Las cifras de mercado de esta fase son PISTA, no fundamento** (3x-55x del mantenimiento correctivo,
  $30k-$96k/día de detention, ~$215k por baja, 80% de fraudes de combustible según Pulpo). Todas
  vienen de proveedores con interés comercial. No usarlas en material comercial sin fuente oficial.

---

## Conflictos que quedaban abiertos, resueltos

`10-contradicciones.md` y `11-huecos.md` ya dictaminaron los choques entre investigadores y **se
respetan sin re-litigar**. Lo que sigue son los que quedaron sin dictamen o nacieron en la ola 2.

### CN-1. Estímulo del diésel: cuota disminuida vs. cuota íntegra — **gana la disminuida**

`10-contradicciones.md` §1 lo declaró cerrado; `11-huecos.md` §2.5, el mismo día, lo reabrió;
`22-evaluacion.md` lo dejó como la pregunta dorada más cara (Q17) sin resolver.

**Resolución: gana `10-contradicciones.md`.** No por antigüedad ni por promedio, sino porque leyó el
documento que responde directamente la objeción. El criterio **1/LIF/PI** (Anexo 3 de la RMF 2026,
DOF 09-ene-2026, vigente sin cambios desde 2020 y **no tocado** por la Primera Modificación al Anexo 3
del 17-jul-2026) dice, textual, que los enajenantes *"causaron el IEPS […] es decir, aplicando cuotas
disminuidas, estas son las que […] deben considerarse para la aplicación del estímulo establecido en
el artículo 20, apartado A, fracción IV, primer párrafo de la LIF"*.

La objeción de `11-huecos.md` descansa en la premisa de que *"el estímulo semanal del Decreto de 2016
no reduce el IEPS causado por el enajenante: es un acreditamiento que aplica contra ese impuesto"*.
**El criterio contradice esa premisa con esas palabras.** La Lectura A cae.

**Consecuencias, todas de producto:**

- La dirección del riesgo **se invierte**: quien usa la cuota íntegra **sobreestima**, y eso es la
  práctica indebida tipificada. El resumen ejecutivo temía lo contrario.
- La fracción II del criterio alcanza a *"quien asesore, aconseje, preste servicios o participe"*.
  Un motor con $7.3634 constantes no comete un bug: implementa una práctica indebida en la que Likida
  presta el servicio.
- Por eso el servicio de cuotas semanales **sube a la Fase 1**: dejó de ser la pieza de mayor valor
  técnico y pasó a ser **requisito de cumplimiento**.
- **Reserva que se mantiene:** un criterio no vinculativo es la posición declarada de la autoridad,
  no ley (jerarquía: `criterio_no_vinculativo`). En la ficha de `normas/` va con esa jerarquía, y la
  leyenda del CFF 89/90 sigue siendo obligatoria.
- **Lo que `11-huecos.md` sí dejó en pie:** no publicar una cifra de estímulo en pesos hasta resolver
  la regla 11.7.3 (ver CN-2). Mostrar litros acreditables y la cuota fechada, trazables por separado.

### CN-2. La regla 11.7.3 existe — la corrección C4 del resumen ejecutivo está a medias

C4 acierta en que el fundamento es el **art. 20** de la LIF (no el 16) y en que las reglas del
transportista son **9.1.6 a 9.1.8**. Pero la frase "la 11.7.3 no existe" **ya no se puede usar frente
a un fiscalista**: la Primera Resolución de Modificaciones (DOF 09-jul-2026) la **adicionó**
("Cálculo del precio base del diésel"), disminuye el precio base entre $0.28 y $1.04 por litro en
**13 fechas concretas** que no son semanales (saltos de 6, 7 y 9 días), y el **Transitorio Sexto** la
hace aplicable **retroactivamente desde el 1-abr-2026**.

**Resolución:** corregir C4 quitando esa frase. **Queda genuinamente abierto** si el ajuste ya viene
incorporado en los acuerdos semanales de la SHCP o si aplica encima. Hasta que un fiscalista lo
firme: exponer las dos cifras por separado, nunca fusionadas, y no recalcular estímulos de abril a
julio de 2026 sin revisarlo.

### CN-3. La Primera Resolución de Modificaciones: el pendiente #16 se reescribe, no se cancela

`02-carta-porte.md` transcribió el resolutivo PRIMERO palabra por palabra y es exacto: reforma 28
reglas, adiciona 5 y un capítulo, deroga 1, y el instrumento modificó los **Anexos 1, 2, 3, 9, 14,
15, 21, 22 y 29**. La afirmación de `09-liquidacion.md` ("sólo modificó dos reglas", marcada
*Verificado*) **es falsa**. Ninguna de las reglas que preocupaban (9.1.6-9.1.8, 2.7.1.12, 2.7.7.2.x)
cambió; lo que cambió y nadie leyó son la **11.7.3** (nueva), la **2.7.1.48** (reformada) y los
**Anexos 21 y 22**.

**Nuevo alcance del pendiente #16:** (a) leer los Anexos 21 y 22 —base de todo el §5 de
`05-hidrocarburos.md`: control volumétrico, umbral de 75,714 L/mes, certificados y dictámenes—;
(b) localizar la **Segunda** Resolución de Modificaciones y sus versiones anticipadas de julio;
(c) diffear el criterio **43/ISR/PI**, el único reformado el 17-jul-2026, que ahora agrega
"compensación para el cumplimiento de la NOM-035-STPS-2018" y toca pagos a trabajadores a través de
terceros —cerca de las estructuras de coordinado y hombre-camión.

### CN-4. Regla 2.7.1.48 — la cita del motor **es correcta**; la fecha **no está verificada**

`40-auditoria-codigo.md` (CONFLICTO D) no pudo verificar que la 2.7.1.48 sea la regla que impone el
complemento de hidrocarburos. `10-contradicciones.md` sí leyó su texto reformado el 09-jul-2026:
gobierna a *"los contribuyentes que enajenen gasolinas y diésel a que hace referencia la regla
2.6.1.1 fr. II"*. **La cita de `engine.ts:181` se sostiene.**

Lo que **no** se sostiene es la fecha `vigenteDesde: '2026-04-24'` de `config.ts:87`: sigue sin
confirmarse en fuente del SAT (la regla reformada todavía dice "que al efecto publique el SAT", sin
transitorio que difiera su aplicación). El comunicado conjunto SAT-SENER-CNE-ATDT del 27-mar-2026
sube la confianza pero no es la página fuente. **Resolución:** ficha con
`estado_verificacion: evidencia_corroborante`, visible; confirmar con el PAC del primer cliente.

**Además, cambio de validador:** el SAT movió la cláusula relativa de *"los contribuyentes a que hace
referencia la regla 2.6.1.1 fr. II, que enajenen gasolinas y diésel"* a *"los contribuyentes que
enajenen gasolinas y diésel a que hace referencia la regla 2.6.1.1 fr. II"*. Quitar del validador el
filtro "¿el emisor está en 2.6.1.2?" y esperar HidroYPetro en **todo** CFDI de combustible.
*(Que la reforma amplíe y no solo aclare es lectura gramatical de `10-contradicciones.md` sobre dos
textos leídos, no criterio del SAT.)*

### CN-5. RFC receptor: **gana `09-liquidacion.md`** — cuatro ramas, no un booleano

`03-isr-facilidades.md` manda rechazar todo CFDI que no vaya al RFC de la flota. El **RLISR art. 57,
tercer párrafo** dice que si el beneficiario presta servicios personales subordinados, los
comprobantes *"podrán ser expedidos a nombre de dichas personas"*. `03` aplicó a todo el universo una
regla (RMF 2.7.1.12) que solo gobierna erogaciones por cuenta de terceros.

**Implementación:** Grupo A → siempre a la flota. Grupo B con servicios profesionales → a la flota.
Grupo B subordinado → **puede ir al operador**. Tercero → a la flota. **Ninguna admite XAXX010101000.**
Capa estatal: en Querétaro el CFDI a nombre del operador pierde la exención de ISN (art. 72 fr. VII de
su Ley de Hacienda).

### CN-6. NOM-087 (14 h) vs. LFT reformada (12 h) — **manda la LFT**

No es contradicción entre archivos: es entre ordenamientos, y nació el 01-05-2026. La NOM-087 num.
4.6 a) contempla rutas con conducción máxima de 14 horas; el art. 68 último párrafo de la LFT topa la
suma de jornada ordinaria y extraordinaria en **12 horas diarias**, y el art. 58 define jornada como
el tiempo a disposición del patrón.

**Resolución: manda la ley.** Una NOM no puede exceder a la ley federal (mismo principio de reserva
del CFF 33-I-g). El umbral del detector baja a **12 h**, y el producto explica ambos límites en vez de
esconder uno: un operador que cumple la NOM puede estar violando la LFT.

### CN-7. El argumento de venta del ISN está sobre-extendido — **acotar a Grupo B**

El resumen ejecutivo lo levantó como hallazgo general ("el viático mal comprobado además paga ISN").
Los siete conceptos que `03` lista como contenido típico del 8% ciego (propinas, maniobras, báscula,
talacha, pensión) son **Grupo A** —gastos de la unidad, no remuneraciones al trabajo personal— y el
ISN nunca entró a su objeto. **La versión chica es defendible; la general se cae con una sola pregunta
del fiscalista: "mi 8% son maniobras y propinas de patio, no viáticos".**

### CN-8. Carta Porte ≠ elegibilidad a la RFA — dos banderas independientes

`03` afirma que "el mismo hecho —tocar camino federal— define tanto la obligación de Carta Porte como
el acceso al Título 2 de la RFA". **Es falso.** La regla 2.7.7.2.8 crea una ficción acotada ("para los
efectos de las reglas" de la Sección 2.7.7) con condición de vehículo (no exceder un C2 conforme a
NOM-012), que nada tiene que ver con la elegibilidad de la RFA (90% de ingresos, servicio a terceros,
régimen fiscal). Un C2 exento de Carta Porte por el radio de 30 km **sigue siendo carga federal para
la RFA**. Separar `necesita_carta_porte` y `elegible_rfa_titulo_2`.

### CN-9. Régimen del operador: **no hay dos rutas simétricas** (ya dictaminado, se ratifica)

`09-liquidacion.md` §2.6 y §11 lo presentaban como campo de selección. El art. 256 de la LFT lo anula.
Se adopta la versión de `11-huecos.md` CONFLICTO 3 y de `34-proceso-liquidacion.md`. Si algún material
comercial o técnico cita `09` §11 sin la corrección, modela un campo con dos valores que la ley no
trata como equivalentes.

### CN-10. Errata que sigue viva en los archivos fuente

Dos errores **ya dictaminados como falsos pero no corregidos físicamente** en su archivo de origen:
`03-isr-facilidades.md` §8.4 (CN-8) y la cita "RMF 2.7.1.24" en `FISCAL_LEGAL.md` §1.6. Cualquiera
que lea solo esos archivos reproduce el error. **Acción de Fase 0:** encabezado de errata en ambos,
apuntando a este documento.

### Cerrados con fuente primaria (ya no son pendientes)

- **CFF art. 90: "multa de $79,130.00 a $124,380.00"** — leído literal en el Anexo 5 de la RMF 2026
  (DOF 28-12-2025), apartado B. El pendiente C3 del resumen ejecutivo se cierra.
- **CFF art. 84 fr. IV**, cuatro incisos, incluidos $22,300–$127,530 y $450–$670. Verificado.
- **Anexo 3: son 74 criterios**, no uno. Corregir el punto 11 del resumen de `01-cfdi-cff.md`.
- **RFA 2026 publicada en el DOF el 17-feb-2026**, con texto literal de las reglas 2.2, 2.9, 2.10,
  2.11 y 2.12.
- **El paquete económico 2026 no tocó LISR** (última reforma 01-04-2024) **ni LIVA** (12-11-2021);
  el CFF se reformó el 09-04-2026 solo en el art. 141. Cierra los pendientes #16 y #17 parcialmente.
- **Mitigación del CFF art. 90**, texto literal: *"No se incurrirá en la agravante… cuando se
  manifieste en la opinión que se otorgue por escrito que el criterio contenido en ella es diverso a
  los criterios dados a conocer por las autoridades fiscales"*. Quita el agravante del 10-20%, **no**
  la infracción base, y debe ir **por escrito en la opinión misma**, no solo en el ToS.
- **Esquemas reportables (CFF 197-199) no aplican** al motor de reglas de Likida hoy. Re-evaluar solo
  si entra al roadmap el prorrateo de gastos entre integrantes de un coordinado (partes relacionadas).
- **No existe reserva de actividad para asesoría fiscal en México.** Likida puede operar sin licencia.

### Sigue abierto y cuesta dinero

| # | Pendiente | Cómo se cierra | Bloquea |
|---|---|---|---|
| 1 | Relación entre la regla 11.7.3 y el acuerdo semanal de la SHCP | Fiscalista con cédula, una llamada | Publicar cualquier cifra de estímulo de diésel en pesos |
| 2 | Anexos 21 y 22 de la 1a Modificación (DOF 17-jul-2026) | `curl` + `pdftotext`, ya probado | Todo el §5 de `05-hidrocarburos.md` (control volumétrico) |
| 3 | Segunda Resolución de Modificaciones a la RMF 2026 y versiones anticipadas de julio | Minisitio `normatividad_rmf_rgce2026.html` | Cerrar el pendiente #16 |
| 4 | Fecha de publicación del Complemento HidroYPetro en el Portal del SAT | PAC del primer cliente | Lógica de cancelaciones (C2) |
| 5 | Periodicidad del 15% (RFA 2.9): mensual, acumulado o anual | Fiscalista | Calibrar el contador y el semáforo |
| 6 | Tope de $1,000,000 de la regla 2.2: ¿por integrante o por coordinado? | Fiscalista | Cambia el ahorro mostrado en un orden de magnitud |
| 7 | Si el 8% ciego reduce la base de PTU | Fiscalista | Decenas de miles de pesos por flota |
| 8 | 19 de 32 tasas de ISN, con conflictos en Durango, Morelos, Tabasco y Sonora | `curl` + `pdftotext` a periódicos oficiales estatales (ahora alcanzable) | Publicar la tabla de 32 estados |
| 9 | Cómo se miden "un mes de salario" y "el excedente del mínimo" (LFT 110) con pago por viaje o por km | Abogado laboral | Los topes de descuento |
| 10 | Metodología oficial del radio de 30 km (RMF 2.7.7.2.8) | Sin criterio publicado — es zona gris real | El clasificador de Carta Porte |
| 11 | Cifras del sector en fuente oficial (INEGI, SICT, CANACAR) | Estadística Básica del Autotransporte Federal de la SICT | Cualquier número de mercado en la landing |
| 12 | Cinco entrevistas con contralores de flota reales | Trabajo de campo | La sección "Realidad Actual" de la landing |

**Nota de método:** el presupuesto de WebSearch (200 llamadas) se agotó desde la ola 1. Todo lo
verificado en la ola 2 se hizo con `WebFetch` directo a PDF del SAT y de la Cámara de Diputados más
`pdftotext` local. Los pendientes 2, 3 y 8 se cierran hoy con ese método, a costo casi cero. Falta
instalar `openpyxl` para los XLS de catálogos.

---

## Decisiones que Javier tiene que tomar

### D1. Fiscalista con cédula: ¿ahora o después del primer cliente?

- **Opción A —** contratar horas recurrentes ya. Costo desde hoy; desbloquea 4 pendientes caros
  (11.7.3, periodicidad del 15%, tope de $1M, PTU) y da el cuarto juez (J4) del panel de evaluación,
  que es el único que resuelve desacuerdos entre los jueces automáticos.
- **Opción B —** esperar al primer cliente pagado y cargarle el costo al onboarding.

**Recomendación: A, pero acotada.** Contratar **una sesión de 4 horas antes del 6-ago** con una
agenda cerrada (11.7.3, periodicidad del 15%, tope $1M, revisión de la leyenda del CFF 89/90), y
dejar el retainer para cuando haya cliente. Es la compra de mayor retorno del paquete: el criterio
1/LIF/PI convirtió el cálculo del estímulo en obligación de cumplimiento de Likida, no del cliente.

### D2. ¿Se enseña una cifra de estímulo de diésel en la demo?

- **Opción A —** enseñar pesos. Es lo que más impresiona.
- **Opción B —** enseñar **litros acreditables + la cuota vigente fechada + el rango**, y decir en voz
  alta que la cifra en pesos se firma con el fiscalista.

**Recomendación: B, sin discusión.** La cuota pasó de $7.3634 a $2.0925 en cinco meses; la regla
11.7.3 mete una capa retroactiva desde abril que nadie ha conciliado; y el estímulo es **ingreso
acumulable** —presentarlo bruto infla la propuesta ~30%. Un contralor con fiscalista detecta las tres
cosas. La versión honesta impresiona más, porque nadie más la explica así.

### D3. Las 501 líneas de `facturacion/`

- **Opción A —** conectarlo al cuadre esta semana.
- **Opción B —** sacarlo del árbol de build hasta que se conecte.

**Recomendación: B.** El reloj del plazo de facturación es un problema real y el código es bueno,
pero conectarlo bien exige la máquina de estados de la Fase 1. En la demo es superficie que hay que
explicar y que puede llevar la conversación a un lugar que no controlas. Se recupera de git cuando
toque.

### D4. Capa ticket→CFDI: ¿construir o comprar?

- **Opción A —** construirla. Control total, meses de trabajo, y es un commodity que ya se regala.
- **Opción B —** comprar FacturaGPT ($4 MXN + IVA por CFDI exitoso, `external_id`, webhook, +1,000
  comercios) y construir solo los 10-15 conectores de carretera que importan.

**Recomendación: B.** El diferenciador de Likida no es conseguir la factura: es el veredicto de
deducibilidad y los contadores del ejercicio. Gastar meses ahí es competir en el terreno de
Fotofacturas y Zumma, donde ya se pierde.

### D5. Dónde vive el conocimiento normativo

- **Opción A —** RAG vectorial sobre el corpus.
- **Opción B —** carpeta `normas/` en git, una ficha por regla, con enrutador determinístico desde el
  concepto de gasto que el OCR ya clasifica.

**Recomendación: B, y es una decisión de NO construir A.** El corpus cabe en ~11 temas
pre-clasificados; RAG agrega infraestructura que hoy no existe en `package.json` y un modo de falla
nuevo (recuperar la versión derogada con score alto) sin resolver el problema real, que es la
**vigencia**. Se promueve a tabla de Supabase cuando el volumen lo justifique.

### D6. Precio

- **Opción A —** por asiento.
- **Opción B —** por resultado (viaje liquidado).

**Recomendación: B, con la definición de "liquidado" escrita en el contrato desde el día uno.** Sin
esa definición se convierte en disputa de facturación. **No publicar precios todavía**: ningún
competidor serio lo hace.

### D7. Las cinco entrevistas con contralores

Ninguna de las 23 investigaciones habló con un comprador real. Es el pendiente señalado como más
urgente por la ola 1 **y** por la ola 2, de forma independiente.

**Recomendación: cinco entrevistas grabadas antes de escribir la landing**, preguntando cuatro
números concretos: comprobantes por viaje, días de retraso en liquidar, días de conciliación
mensual, y % de comprobantes con problema fiscal. Sin ellos la sección "Realidad Actual" no funciona;
con ellos es la parte más persuasiva de la página. Pregunta extra que cambia el producto entero:
**"¿ya traen monedero de combustible?"** — de esa respuesta depende si el pitch es "conectamos tu
monedero" o "te salvamos el 15% de la regla 2.9".

---

## Qué NO vamos a hacer, y por qué

| No hacemos | Por qué | Fundamento |
|---|---|---|
| **Monedero de combustible propio** | $10,000,000 MXN de capital social pagado **más** $10,000,000 MXN de fianza a favor de la TESOFE, verificación tecnológica y meses de trámite | RMF 3.3.1.8 (fuente primaria sat.gob.mx) |
| **Ser PAC propio** | Mismos $10M + $10M. Se compra la capa de certificación y se integra vía ECC/API | Requisitos SAT-PAC |
| **Ser aseguradora** | Capital mínimo de 5.1 a 8.5 millones de UDI | CNSF Anexo 6.1.2 |
| **Producto de datos de precio de diésel** | El precio por zona ya es dato público obligatorio y ya lo revende PETROIntelligence. Competir contra un commodity gratuito | Acuerdo CRE A/041/2018 |
| **ERP contable propio** | Saturado (SIGA, ClickBalance, Advanpro, Logista, LISTMS+, todos con módulo integrado). El canal hacia despachos sí; el producto no | `33-ingresos-adyacentes.md` §6 |
| **Monitoreo antirrobo en tiempo real** | Requiere GPS vivo y detección de jammer: otra categoría de producto, con competidores establecidos. Solo el expediente posterior es cercano | `30-dolores-flota.md` §8 |
| **Reclutamiento y retención de operadores** | Es RH, no comprobantes. El único pedazo accionable es el registro de jornada (Fase 3) | `30-dolores-flota.md` §5 |
| **Facturación al cliente y cobranza** | Es el lado de ingreso, con otro documento y probablemente otro sistema | `30-dolores-flota.md` §9 |
| **Bóveda de e.firma o de credenciales del cliente** | Arrancar sin ella elimina el tipo penal del art. 62 de la LFPDPPP y el pasivo del CFF 17-J. El validador público del SAT no necesita ninguna credencial | `11-datos-personales.md`, `01-cfdi-cff.md` §9 |
| **Automatizar CAPTCHA** (licencia federal SICT, portales) | Línea trazada por la ola 1 y ratificada. Uso manual puntual en el alta de un operador, nunca barrido recurrente | `11-datos-personales.md`, `31-cumplimiento-continuo.md` §3.5 |
| **Automatizar portales rojos** (PAC y plataformas de facturación) | EdiFactMx prohíbe "spiders, robots, avatars o agentes inteligentes"; ioFacturo prohíbe "burlar mecanismos de autenticación". Marco penal: CPF 211 bis 1 y 211 bis 7 | `11-datos-personales.md` |
| **RAG vectorial para el corpus normativo** | Ver D5 | `20-arquitectura-conocimiento.md` §3 |
| **Timbrado en lote / "cierra tu semana con un timbrado"** | El SAT exige un CFDI con CCP por cada servicio y por cada cliente | `02-carta-porte.md` |
| **Prometer las 15 líneas de la tabla de promesas prohibidas** | Cada una es falsa, incumplible o legalmente peligrosa. La tabla completa está en `00-RESUMEN-EJECUTIVO.md` | — |
| **Usar la palabra "dictamen"** en copy o en salidas | Reserva del CFF art. 52 (solo Contador Público Registrado) | `21-guardarrailes.md` §1.2 |
| **Usar "fraude", "robo" o "robó"** en cualquier alerta | La calificación penal la hace una autoridad. Además reduce exposición por publicidad engañosa y difamación | `32-fraude.md` §4.3 |
| **Fila de logos de clientes** | Likida no tiene clientes. Las empresas del censo son prospectos de vacantes | memoria del proyecto |
| **Mencionar SOC 2, ISO 27001 o "cumplimiento SAT certificado"** | No existen. Es la mentira chica que cuesta el cliente grande | `10-handle-ai.md` |
| **Benford y análisis de brechas de secuencia de folios** | Necesitan cientos de registros por grupo. Construirlos antes de tener volumen es costo de oportunidad sin beneficio | `32-fraude.md` §3 |
