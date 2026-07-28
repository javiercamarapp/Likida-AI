# Ciclo de vida y actualización del conocimiento normativo

> Ola 2 — 27-jul-2026. Construido sobre la ola 1 (00 a 11). No repite lo ya verificado ahí; lo usa como línea base y mide cada cuánto se rompe.

## Resumen para el fundador

Todo el paquete de la ola 1 tiene fecha de caducidad, y no la misma para cada pieza. Hay tres relojes corriendo a velocidades distintas: las **leyes** (Congreso, cambian ~1 vez al año en el paquete económico de octubre-noviembre, pero en 2025-2026 hubo además reformas sueltas en abril y noviembre), las **reglas administrativas** del SAT — RMF y RFA — (cambian varias veces al año, y una parte de esos cambios **ya es válida desde que se publica en el portal del SAT, antes de llegar al DOF**), y los **catálogos y esquemas técnicos** de la factura (cambian casi todos los meses, sin pasar nunca por el DOF).

El hallazgo más importante de esta investigación no estaba en el radar de la ola 1: mientras la escribían, el SAT le añadió a la RMF 2026 una regla nueva (11.7.3) que ajusta el precio del diésel usado para calcular el estímulo — la misma cifra que `04-iva-ieps-estimulos.md` daba por resuelta con el mecanismo del Acuerdo semanal de la SHCP. Es el ejemplo real, no hipotético, de por qué este documento existe: **conocimiento verificado el 27 de julio puede estar parcialmente caduco el 9 de julio anterior sin que nadie se entere**, porque el cambio entró por una puerta distinta a la que se vigilaba.

Los datos duros: la Primera Resolución de Modificaciones a la RMF 2026 pasó por **16 versiones anticipadas** entre el 23-feb y el 2-jul-2026 antes de publicarse en el DOF el 9-jul, y desde mayo el ritmo se volvió **semanal**. El Anexo 20 (catálogos del CFDI) tuvo actualizaciones el 1, 15, 22 y 23 de enero, y el 2 de marzo, y sigue moviéndose (última modificación registrada: 20-jul-2026). Las tasas de ISN de 32 estados se fijan en 32 procesos legislativos independientes, casi todos en diciembre, publicados en 32 periódicos oficiales distintos — no en el DOF. Nada de esto se puede hardcodear con una fecha de "hoy"; todo necesita una fecha de vigencia y una fecha de próxima revisión al lado.

La propuesta central: un **índice de citas vivas** — cada afirmación normativa que el producto usa (ley, regla, anexo, catálogo, tasa) vive como un registro con su fuente, su fecha de verificación y su fecha de próxima revisión, no como texto suelto en un prompt o en un comentario de código. Cuando la fecha de revisión vence, el dato se marca `en_revision` y el agente dejar de afirmarlo como hecho hasta que un humano (o un chequeo automático de menor riesgo) lo confirme. Gran parte de la vigilancia se puede automatizar con `HEAD` requests y comparación de hashes; la interpretación de si un cambio de regla altera una promesa comercial o un cálculo de ahorro necesita siempre un humano.

---

## 1. El calendario real: qué cambia, con qué frecuencia, y por qué canal

La distinción que importa no es "cada cuánto cambia" sino **por qué puerta entra el cambio**, porque cada puerta necesita un mecanismo de vigilancia distinto.

### 1.1 Leyes (Congreso — DOF, canal oficial único)

| Instrumento | Frecuencia real observada | Canal |
|---|---|---|
| LIF (Ley de Ingresos de la Federación) | Anual, nueva ley completa cada año, paquete económico de octubre-noviembre. LIF 2026: **DOF 07-nov-2025** | DOF |
| CFF, LISR, LIVA, LIEPS | En teoría anuales (paquete económico), en la práctica también sufren reformas sueltas fuera de ese calendario. CFF reformado en el paquete de **07-nov-2025** y de nuevo, aparte, el **09-abr-2026** (reforma al art. 141 sobre garantías del interés fiscal) | DOF |
| Ley de Caminos, Puentes y Autotransporte Federal (LCPAF) | Irregular. Última reforma verificada: **DOF 14-nov-2025** | DOF |

**Lo que cambia respecto a lo que asumía la ola 1:** ninguno de los archivos 01-09 modeló la posibilidad de una reforma de ley **fuera** de la ventana de octubre-noviembre. La reforma del CFF art. 141 del 09-abr-2026 confirma que sí ocurre. **Verificado** (síntesis del DOF y nota de despacho, ver Fuentes).

### 1.2 Reglas administrativas del SAT: RMF y RFA

Esta es la capa con más movimiento y la que la ola 1 subestimó en frecuencia.

**RMF (Resolución Miscelánea Fiscal).** Se publica una vez al año en el DOF (RMF 2026: **DOF 28-dic-2025**, vigente 1-ene a 31-dic-2026) y luego se modifica varias veces durante el año mediante "Resoluciones de Modificaciones" numeradas (1a, 2a, 3a…). Cadencia observada en el año completo más reciente, **RMF 2025**:

| Resolución | Fecha DOF |
|---|---|
| RMF 2025 (original) | 30-dic-2024 |
| 1a Resolución de Modificaciones | 22-ene-2025 |
| 2a | 07-abr-2025 |
| 3a | 13-may-2025 |
| 4a | 09-jul-2025 |
| 5a | 22-oct-2025 |
| 6a | 17-dic-2025 |

**Seis modificaciones en el año**, con huecos de 1 a 3 meses. **Verificado** (minisitio de normatividad RMF/RGCE del SAT, sección 2025).

Lo que la ola 1 no capturó: **cada Resolución de Modificaciones se anuncia primero como una o varias "versiones anticipadas" en el portal del SAT, y esas versiones anticipadas ya tienen efecto legal desde su publicación en el portal — no desde que llegan al DOF** (RMF 2026, regla 1.3, tercer párrafo, citada en el propio texto de cada resolución: *"las disposiciones dadas a conocer de manera anticipada en el Portal del SAT... surtirán sus efectos en términos de la regla 1.3., tercer párrafo"*). **Verificado** contra el texto de la Primera Resolución de Modificaciones a la RMF 2026 y su síntesis en el DOF del 09-jul-2026 (SCJN).

Para la Primera Resolución de Modificaciones a la RMF 2026, la cadencia real de esas versiones anticipadas fue:

| Versión anticipada | Fecha |
|---|---|
| 1a | 23-feb-2026 |
| 2a | 01-abr-2026 |
| 3a | 09-abr-2026 |
| 4a | 14-abr-2026 |
| 5a | 17-abr-2026 |
| 6a | 23-abr-2026 |
| 7a | 29-abr-2026 |
| 8a | 07-may-2026 |
| 9a | 14-may-2026 |
| 10a | 21-may-2026 |
| 11a | 28-may-2026 |
| 12a | 04-jun-2026 |
| 13a | 11-jun-2026 |
| 14a | 18-jun-2026 |
| 15a | 25-jun-2026 |
| 16a | 02-jul-2026 |
| **Texto definitivo (DOF)** | **09-jul-2026** |

**Dato accionable: desde el 7-may-2026 el ritmo se estabilizó en exactamente 7 días entre versiones.** Y el mismo día que se publicó el texto definitivo (9-jul-2026), el SAT ya había puesto en el portal la **primera versión anticipada de la Segunda Resolución de Modificaciones** — que al 27-jul-2026 lleva dos versiones (9-jul y 16-jul). El ciclo no tiene pausa entre una resolución y la siguiente. **Verificado** (minisitio SAT, normatividad_rmf_rgce2026.html, y notas del IMCP citadas abajo).

**RFA (Resolución de Facilidades Administrativas).** A diferencia de la RMF, no se modifica durante el año — se publica una vez, íntegra, y rige todo el ejercicio. La fecha de publicación, sin embargo, **se mueve año con año y no tiene ventana fija**:

| Ejercicio | Fecha DOF |
|---|---|
| 2016 | 30-dic-2015 |
| 2018 | 29-dic-2017 |
| 2019 | 21-feb-2019 |
| 2020 | 18-feb-2020 |
| 2022 | 14-abr-2022 |
| 2023 | 03-mar-2023 |
| 2024 | 23-feb-2024 |
| 2025 | 17-feb-2025 |
| 2026 | 17-feb-2026 |

**Verificado** (DOF/SIDOF, cada fecha con su nota). Lectura correcta: la RFA de un ejercicio suele publicarse **entre enero y abril del mismo ejercicio que regula** (nunca antes de que empiece el año, salvo 2016 y 2018), pero cubre retroactivamente desde el 1 de enero (ola 1, `03-isr-facilidades.md`, ya lo documentó para 2026). Desde 2023 hay una tendencia a converger en febrero, pero **no hay garantía**: si Likida asume "la RFA sale a mediados de febrero" y planifica el corte anual de un cliente sobre esa fecha, un año como 2022 (14-abr) lo deja operando cuatro meses con el año fiscal vigente pero sin la resolución que fija sus topes.

### 1.3 Anexos, catálogos y esquemas técnicos: el canal que no pasa por el DOF

Esta es la capa de mayor frecuencia y la que más directamente rompe un validador de CFDI.

**Anexo 20 (estándar y catálogos del CFDI).** El SAT publica y actualiza estos archivos directamente en su portal, sin necesidad de una Resolución de Modificaciones ni de DOF — están habilitados por la regla que faculta al SAT a dar a conocer catálogos por esa vía. Movimiento observado sólo en 2026:

| Fecha | Qué cambió |
|---|---|
| 01-ene-2026 | `c_TasaOCuota`, `c_NumPedimentoAduanal`, `c_ClaveProdServ` (descripciones) |
| 15-ene-2026 | Catálogo `c_PatenteAduanal` (nueva relación) |
| 22-ene-2026 | Complemento de Nómina 1.2 |
| 23-ene-2026 | Catálogos de código postal (93 códigos entre dos tablas) |
| 02-mar-2026 | `c_NumPedimentoAduana` (según ola 1, `01-cfdi-cff.md`, sin verificar en fuente primaria en su momento) |
| 17-jul-2026 | "Secuencia de cadena original" (xslt) y "Catálogos CFDI 4.0" (xls) — `Last-Modified` |
| 20-jul-2026 | "Matriz de errores" (xls) — `Last-Modified` |

**Verificado** (página oficial `omawww.sat.gob.mx/tramitesyservicios/Paginas/anexo_20.htm`, con fecha de última modificación por documento, más comunicados de PAC — SW Sapien/Timbrado Masivo, GoSocket — que datan cada cambio). El patrón es: **el catálogo de datos (xsd) lleva fecha 13-dic-2024 en ese mismo portal**, mientras el Excel de catálogos y la matriz de errores se mueven cada mes — confirma exactamente lo que la ola 1 (`05-hidrocarburos.md`) documentó para el `catCartaPorte.xsd`: **la página del portal miente por omisión sobre qué está desactualizado; solo el `Last-Modified` HTTP dice la verdad**, y ni siquiera todos los archivos del mismo Anexo se actualizan al mismo tiempo.

**Complemento Carta Porte.** A diferencia de los catálogos del Anexo 20, los saltos de **versión mayor** del complemento son eventos poco frecuentes y bien anunciados: v2.0 obligatoria desde 01-ene-2022; v3.0 publicada en el portal el 25-sep-2023, obligatoria desde el 25-nov-2023 con convivencia con v2.0 hasta el 31-dic-2023; v3.1 publicada en el portal el 17-jun-2024, obligatoria desde el 17-jul-2024, **sin periodo de convivencia** (a diferencia del salto anterior). Para 2026, la lectura de fuentes consistentes (ver §CONFLICTOS) es que **no hubo salto de versión mayor**: sigue vigente 3.1, y lo que se mueve son sus catálogos internos (`c_ClaveProdServCP`, `c_MaterialPeligroso`, `c_NumAutorizacionNaviero` — actualizado 15-ene-2026) y el rigor de las validaciones cruzadas contra el pedimento aduanal. **Verificado** para v2.0→v3.0→v3.1; **verificado con matiz** (ver CONFLICTOS) para "sin cambio de versión en 2026".

**Complemento Concepto para Hidrocarburos y Petrolíferos (HidroYPetro).** Esto cierra uno de los pendientes bloqueantes que la ola 1 dejó abierto (`00-RESUMEN-EJECUTIVO.md`, pendiente #2; `05-hidrocarburos.md`, SIN VERIFICAR #1). Encontré un **comunicado conjunto SAT-SENER-CNE-ATDT publicado en gob.mx el 27-mar-2026** que confirma la entrada en vigor el **24-abr-2026**, y múltiples fuentes técnicas independientes (SW Timbrado Masivo, GoSocket, EdifactMx) que coinciden en **publicación en el portal el 25-mar-2026**. Es un nivel de confirmación más alto que el que tenía la ola 1 (un comunicado oficial de gob.mx, no solo el `Last-Modified` del XSD), pero **sigue sin ser la página misma del minisitio de complementos con esa fecha impresa** — la recomendación de la ola 1 de pedírsela al PAC del primer cliente sigue siendo válida como confirmación final. **Verificado, con el matiz anotado.**

### 1.4 El estímulo de IEPS al diésel: el ejemplo de dos relojes que pueden estar midiendo lo mismo sin saberlo

`04-iva-ieps-estimulos.md` (ola 1) documentó un mecanismo: cada viernes la SHCP publica en el DOF un Acuerdo con las "cuotas disminuidas" del IEPS, con fundamento en el Decreto DOF 27-dic-2016 y su modificación DOF 04-mar-2022 — ese es el mecanismo detrás de la caída de $7.3634 a $2.0925 documentada ahí.

Durante esta investigación encontré que la **Primera Resolución de Modificaciones a la RMF 2026 (DOF 09-jul-2026) adicionó la regla 11.7.3**, dentro del Capítulo 11.7 — el mismo capítulo que `04-iva-ieps-estimulos.md` había identificado como el del **enajenante**, no el del transportista. Esta regla nueva reduce el "precio base del diésel" (que se determina con un Acuerdo distinto: DOF 11-mar-2019, modificado DOF 04-sep-2025) en montos que se han ido añadiendo fracción por fracción, casi cada vez que sale una versión anticipada:

| Fecha desde la que aplica | Reducción por litro (regla 11.7.3) |
|---|---|
| 1 al 16-abr-2026 | −$0.28 |
| 17-abr al 6-may-2026 | −$0.60 |
| 7-may al 24-jun-2026 | −$1.03 |
| 25-jun-2026 | −$0.95 |
| 2-jul-2026 | −$0.93 |
| Desde 9-jul-2026 | −$0.92 |

**Esto es un hallazgo nuevo, no una corrección de la ola 1** — la regla 11.7.3 no existía cuando `04-iva-ieps-estimulos.md` se escribió (nació en la modificación de julio-2026, la investigación original leyó la RMF de diciembre-2025). Lo dejo marcado como **SIN VERIFICAR la relación exacta entre este mecanismo y el Acuerdo semanal de la SHCP** que `04-iva-ieps-estimulos.md` documentó: pueden ser (a) el mismo número visto por dos vías distintas, (b) mecanismos que se alimentan uno al otro (el "precio base" de 11.7.3 podría ser un insumo del cálculo del Acuerdo semanal), o (c) dos estímulos distintos y acumulables. **Ninguna fuente que leí lo aclara explícitamente.** Antes de tocar el motor de cuotas de IEPS, esto necesita una llamada con un fiscalista — es exactamente el tipo de pregunta que un cambio intra-año puede introducir sin que el producto se entere si solo vigila el Acuerdo de los viernes.

### 1.5 ISN estatal: 32 calendarios, ninguno en el DOF

`06-estatal.md` (ola 1) ya documentó que las tasas de ISN cambian en diciembre, estado por estado, y que solo 13 de 32 estaban verificadas en fuente primaria. Lo que agrego aquí es el **mecanismo**, no las tasas: cada entidad reforma su Ley de Hacienda o su Ley de Ingresos en su propio Congreso local, en su propia ventana de fin de año (los ejemplos verificados por la ola 1 van de 13-nov-2025 a 26-dic-2025), y lo publica en su propio periódico oficial — 32 publicaciones independientes, ninguna indexada en el DOF ni en un portal único. No existe un "SAT estatal" que centralice esto. La única forma de vigilar las 32 es una lista de 32 URLs de periódicos oficiales estatales, revisada en la ventana de noviembre-diciembre de cada año, y eso es trabajo que **hoy nadie en el mercado ofrece como servicio de datos** (a diferencia del DOF, que sí tiene APIs y feeds de terceros).

### 1.6 UMA: el reloj más simple

Un solo evento al año: INEGI calcula el valor, se publica en el DOF a inicios de enero (UMA 2026: **DOF 09-ene-2026**, $117.31, vigente desde el 1-feb-2026 — ya verificado por la ola 1, `07-no-fiscal.md`, corrección C5 del resumen ejecutivo). Es el único de todos estos relojes con fecha predecible y fuente única. Cualquier multa o tope calculado en UMA debe recalcularse cada febrero, no cada enero (hay un mes de traslape donde sigue vigente la UMA del año anterior).

### 1.7 CFDI 5.0: rumor activo, sin fecha, sin publicar

Circula en blogs y foros de contadores desde finales de 2025 la idea de una próxima versión "CFDI 5.0" con geolocalización, IA cruzando datos bancarios y validación automática de RFC. **Al 27-jul-2026 el SAT no ha publicado ningún esquema, catálogo ni guía de llenado con ese nombre; el estándar vigente y único sigue siendo CFDI 4.0** (confirmado por el propio portal del Anexo 20, que sigue mostrando la 4.0 como única vigente desde el 1-abr-2023). Es un rumor que vale la pena vigilar (si se materializa es el evento de mayor impacto de todo este documento — obligaría a re-timbrar y re-validar todo el pipeline), pero **no es información, es ruido de mercado**. No construir nada sobre él; solo tener la alerta lista.

---

## 2. Cómo se entera el agente: el mecanismo de vigilancia propuesto

La conclusión del §1 es que un solo mecanismo no sirve para las tres capas. Propongo tres anillos con distinta frecuencia y distinto método:

### Anillo 1 — Leyes (baja frecuencia, alto impacto)
- **Fuente:** texto vigente de cada ley en diputados.gob.mx/LeyesBiblio (trae "última reforma" en la portada del PDF) + DOF para el texto íntegro de la reforma.
- **Método:** un `HEAD`/hash mensual del PDF de cada ley que Likida usa (CFF, LISR, LIVA, LIEPS, LCPAF, LIF del ejercicio en curso) contra el hash guardado. Si cambia, el PDF completo se vuelve a bajar y se re-lee la fecha de "última reforma" en la portada.
- **Frecuencia de chequeo:** semanal es suficiente; el propio patrón observado (paquete de oct-nov + alguna reforma suelta) no exige más.

### Anillo 2 — RMF, RFA y sus Anexos normativos (frecuencia media-alta, el que la ola 1 subestimó)
- **Fuente primaria de verdad:** el minisitio `sat.gob.mx/minisitio/NormatividadRMFyRGCE/normatividad_rmf_rgce{año}.html` — lista, con fecha, cada Resolución, cada versión anticipada y cada modificación de Anexo. **Es HTML simple servido por el SAT, no la SPA que devuelve 403** (esa es una página distinta, `sat.gob.mx/portal/public/tramites/...`, la que ola 1 no pudo leer). Este minisitio sí es legible con un fetch normal.
- **Método:** scraping de esa página **una vez por semana** (justificado por el patrón semanal observado desde mayo-2026), comparando la lista contra la última capturada. Cualquier fila nueva dispara: (a) descarga del PDF, (b) extracción de qué reglas/anexos toca (el resolutivo PRIMERO siempre lo dice en una lista), (c) verificación cruzada contra el índice de citas vivas (§3) para ver si alguna regla citada en el producto está en esa lista.
- **RFA:** no tiene versiones anticipadas ni modificaciones intra-año — solo hay que vigilar que aparezca la del ejercicio en curso, con una alerta manual si no ha salido para el 1 de marzo (con base en que desde 2019 nunca ha salido después de abril, salvo 2022).

### Anillo 3 — Catálogos y esquemas técnicos (altísima frecuencia, bajo impacto individual, alto impacto acumulado)
- **Fuente:** los propios archivos XSD/XLS del Anexo 20 y de cada complemento, más el `Last-Modified` de la cabecera HTTP de cada uno — el método que la ola 1 ya usó con éxito para el HidroYPetro y que hay que generalizar.
- **Método:** `HEAD` diario (son requests baratos) a cada URL de catálogo que el validador de Likida consuma; si el `Last-Modified` cambia, descargar y diffear contra la copia anterior antes de aceptar el nuevo catálogo en producción. **Nunca reemplazar en caliente sin diff** — un catálogo mal parseado genera rechazos falsos en producción, que es peor que operar con un catálogo un día viejo.
- **Nota de infraestructura:** algunas rutas del portal (la sección "complementos-de-factura", la SPA de consulta pública) devuelven 403 a requests automatizados sin sesión de navegador (ya documentado en ola 1). Los XSD y XLS bajo `omawww.sat.gob.mx` sí responden 200 a requests simples — usar esa ruta, no la SPA nueva.

### El caso especial del IEPS diésel: Anillo 2 y Anillo 3 a la vez
El Acuerdo semanal de la SHCP (viernes, DOF) y la regla 11.7.3 (dentro del ciclo de versiones anticipadas de la RMF) son dos fuentes que hay que ingerir **ambas**, con la relación entre ellas marcada como pregunta abierta para un fiscalista (§1.4). Mientras esa relación no se aclare, el motor de cuotas de Likida debe exponer **las dos cifras por separado** en su salida — nunca fusionarlas en un solo número sin que quede trazable de cuál Acuerdo o regla salió cada una.

---

## 3. Cómo detectar que una regla citada cambió de número

Este es el problema que ya mordió a la ola 1 dos veces: el Anexo 1-A se volvió Anexo 2, los Anexos 30/31/32 se volvieron 21/22/23, y el estímulo de diésel se movió del artículo 16 al 20 de la LIF. Ninguno de esos tres cambios rompe el *contenido* — rompe la *cita*, que es lo que un fiscalista, un cliente o el propio producto usan para verificar que Likida no está inventando.

**Propuesta: un índice de citas vivas**, una tabla (no un documento de prosa) con un renglón por cada norma que el producto cita en su salida o en su lógica:

| Campo | Ejemplo |
|---|---|
| `cita` | "RFA 2026, regla 2.9" |
| `texto_resumen` | "15% de combustible pagado por medios no bancarizados sigue deducible" |
| `fuente_url` | link al PDF del DOF |
| `fecha_publicacion_citada` | 17-feb-2026 |
| `fecha_ultima_verificacion` | 27-jul-2026 |
| `fecha_proxima_revision` | 17-feb-2027 (o antes, si el Anillo 2 detecta movimiento) |
| `numero_anterior` | (vacío, o el número que tenía antes de una renumeración) |
| `estado` | vigente / en_revision / caduco |

**Mecanismo de detección de renumeración:** cuando el Anillo 2 detecta una nueva Resolución de Modificaciones o un nuevo Anexo, el paso de extracción (§2, Anillo 2, paso b) no solo busca reglas nuevas o derogadas — busca explícitamente **tablas de correlación** ("el Anexo 1-A pasa a ser el Anexo 2", "donde antes se decía X ahora se lee Y"), que el SAT sí publica cuando reordena (la ola 1 encontró esa correlación citada en el propio texto de la RFA 2026). Cuando existe esa tabla, se aplica automáticamente al índice de citas vivas, cambiando `cita` y guardando el valor viejo en `numero_anterior` — así ningún material comercial ni ninguna respuesta del producto vuelve a citar el número muerto. Cuando **no** existe una tabla de correlación explícita (como con el artículo 16→20 de la LIF, que nadie anunció como "renumeración", solo cambió porque se emitió una Nueva Ley completa), el único mecanismo confiable es el diff completo del texto contra la versión anterior — no hay atajo.

---

## 4. Cómo marcar conocimiento caducado

La ola 1 ya usa, de facto, un sistema de semaforización (**VERIFICADO** / **SIN VERIFICAR** / **P** / **S** / **O**) que funciona bien para un documento de investigación leído por humanos. No sirve tal cual para un sistema que responde en producción, porque un documento no vence solo — vence *un dato dentro de él*, y distintos datos del mismo archivo caducan en fechas distintas (la tasa de ISN de un estado caduca en diciembre; la cita del artículo que la sostiene puede llevar años sin moverse).

**Regla propuesta: ninguna afirmación normativa entra al producto sin fecha de próxima revisión, y el default ante una fecha vencida es dejar de afirmar, no seguir afirmando con una fecha vieja.**

En la práctica, tres tipos de vencimiento, cada uno con su propio disparador:

1. **Vencimiento programado** (se sabe de antemano cuándo toca revisar): tasas de ISN → revisar cada diciembre-enero; UMA → cada enero; RFA del ejercicio → confirmar que salió antes de abril; cuotas de IEPS → cada viernes (o cada vez que el Anillo 2 detecte una versión anticipada que toque 11.7.3, ver §1.4).
2. **Vencimiento por evento** (no se sabe cuándo, pero se detecta cuando ocurre): una nueva Resolución de Modificaciones que toque una regla del índice de citas vivas; un nuevo `Last-Modified` en un catálogo consumido.
3. **Vencimiento por antigüedad sin evidencia de revisión** (nadie ha vuelto a mirar la fuente en mucho tiempo, aunque no haya señal de cambio): cualquier cita sin verificación en más de 12 meses pasa a `en_revision` aunque el Anillo correspondiente no haya disparado nada — cubre el caso de que el propio mecanismo de vigilancia falle silenciosamente (páginas que cambian de URL, XSD que dejan de responder, etc.).

Cuando un dato pasa a `en_revision` o `caduco`, el producto no debe eliminarlo silenciosamente ni seguir usándolo como si nada — debe **mostrarlo con la marca visible** (igual que la ola 1 marca **SIN VERIFICAR**), porque en este dominio "no sé" es una respuesta defendible ante un contralor y "afirmé algo caduco con seguridad" no lo es.

---

## 5. Qué es automatizable y qué necesita un humano

| Tarea | Automatizable | Necesita humano |
|---|---|---|
| Detectar que hay una nueva Resolución de Modificaciones, versión anticipada o Anexo publicado | Sí — scraping semanal del minisitio de normatividad | — |
| Detectar que un catálogo/XSD cambió | Sí — `HEAD` diario + diff | — |
| Detectar que una cita en el índice quedó dentro del alcance de un cambio publicado | Sí — cruce de texto (qué reglas/anexos toca el resolutivo) contra el índice | Revisar los casos donde el cruce es ambiguo (el resolutivo dice "se reforma el Glosario, fracción II, numeral 58" sin más contexto) |
| Ingerir el Acuerdo semanal de cuotas de IEPS | Sí — parseo estructurado de la tabla del Acuerdo | — |
| Decidir si un cambio de número (renumeración) se propaga automáticamente al material comercial | Sí, cuando hay tabla de correlación oficial | Cuando no la hay (diff manual y juicio) |
| Decidir si un cambio de regla altera una **promesa comercial** o un **cálculo de ahorro** ya hecho a un cliente | — | Siempre. Es una decisión de producto y de riesgo legal, no de datos |
| Confirmar los ~15 "pendientes que requieren fiscalista" que la ola 1 ya dejó listados (ej. si el tope de $1M de la regla 2.2 es por integrante o por coordinado) | — | Siempre — son vacíos de la propia norma, ningún monitoreo los resuelve, se resuelven preguntando |
| Distinguir si un cambio nuevo es **ley**, **facilidad administrativa** o **política interna de un comercio** (la Regla Dura #4 del encargo de esta ola) | Parcialmente — la fuente (DOF vs. blog vs. sitio de un monedero) ya da una señal fuerte | Confirmar cuando la fuente no deja claro el nivel — ej. el caso de la regla 11.7.3 (§1.4), que hasta no aclararse podría ser cualquiera de los tres respecto al estímulo del transportista |
| Validar las 32 tasas de ISN cada diciembre | Parcialmente — se puede automatizar el `HEAD`/hash de 32 URLs de periódicos oficiales si se identifican de antemano | La lectura del texto reformado siempre — no hay dos leyes de hacienda estatales con la misma estructura |
| Decidir cuándo migrar de una versión mayor de complemento a otra (ej. Carta Porte 3.0→3.1) | — | Siempre, y con antelación: la migración de v3.0 a v3.1 se hizo **sin periodo de convivencia**; automatizar el corte sin aviso humano puede tumbar el timbrado de toda una flota de un día para otro |

---

## Acciones concretas

| Acción | Por qué | Esfuerzo | Cuándo |
|---|---|---|---|
| Construir el índice de citas vivas (tabla con cita, fuente, fecha de verificación, fecha de próxima revisión, estado) y migrar a él las citas ya usadas en `01`–`11` | Es la pieza que le falta a todo lo demás de esta lista — sin ella, "vigilar" no tiene dónde aterrizar | Medio | Antes de escribir cualquier validador que cite una regla en su salida |
| Scraper semanal del minisitio `normatividad_rmf_rgce{año}.html` (Anillo 2) | Es la fuente única, legible (no SPA), que anuncia RMF, RFA y modificaciones de Anexos normativos con fecha | Bajo | Fase 3 de la ola 1 (relojes y monitoreo), antes del primer cliente |
| `HEAD` diario + diff de los XSD/XLS de Anexo 20 y de cada complemento que el validador consuma (Anillo 3) | Es el mecanismo que ya funcionó para descubrir el `Last-Modified` de HidroYPetro; generalizarlo cubre Carta Porte, Nómina, ECC, etc. | Bajo | Junto con el cargador de catálogos que la ola 1 ya propuso (acción #14 de su resumen ejecutivo) |
| Aclarar con un fiscalista la relación entre la regla 11.7.3 (RMF, adicionada 09-jul-2026) y el Acuerdo semanal de la SHCP para el estímulo de diésel | Sin esto, el motor de cuotas de IEPS puede estar subestimando o duplicando el estímulo — el mismo riesgo de orden de magnitud que la ola 1 ya marcó como bloqueante para la cuota disminuida | Bajo (una llamada) | Antes de codificar el motor de cuotas — es más urgente que el pendiente #1 original de la ola 1, porque además cambia la superficie de vigilancia (dos fuentes, no una) |
| Confirmar la fecha exacta de publicación del HidroYPetro directamente en el minisitio de complementos (no solo por el comunicado de prensa) | El comunicado gob.mx del 27-mar-2026 sube la confianza pero no es la página fuente; sigue siendo el pendiente bloqueante #2 de la ola 1 | Bajo | Con el primer PAC/cliente, como ya recomendaba la ola 1 |
| Definir el protocolo de "vencimiento": cuándo un dato pasa a `en_revision`, quién lo confirma, y qué hace el producto mientras tanto (ocultar el dato vs. mostrarlo marcado) | Sin esta regla, "caducado" es un concepto de este documento, no un comportamiento del producto | Medio | Fase 1 de la ola 1 (antes de escribir código), junto con la leyenda de los arts. 89/90 del CFF |
| Armar la lista de 32 URLs de periódicos oficiales estatales (uno por entidad) para el chequeo anual de ISN de diciembre | Hoy solo 13/32 tasas están verificadas; sin una lista fija de dónde mirar, cada diciembre se repite el trabajo de buscar la fuente desde cero | Medio-alto (una vez), bajo (mantenimiento) | Antes de diciembre de 2026, para tener el primer ciclo completo listo |
| No fusionar en el motor de cuotas la cifra del Acuerdo semanal y la de la regla 11.7.3 en un solo número; exponer ambas por separado y trazables | Mientras no se resuelva §1.4, fusionar es inventar una relación que nadie ha confirmado | Bajo | Al construir el motor de cuotas (Fase 1/2 de la ola 1) |

---

## CONFLICTOS

**CONFLICTO A — ¿hubo o no salto de versión del Complemento Carta Porte en 2026?** Dos fuentes secundarias de baja calidad (`aprende-logistica.com`, sin firma verificable, con lenguaje de contenido generado) afirman que existe una "Carta Porte 3.1 (2026)" con "nuevos campos obligatorios" y un periodo de convivencia entre versiones durante el primer semestre de 2026, con la 3.1 volviéndose exclusiva en el segundo semestre. Esto **contradice** tanto a `02-carta-porte.md` de la ola 1 (que documenta que la v3.1 es obligatoria sin convivencia desde el 17-jul-2024, y que verificó los 25 transitorios de la RMF 2026 sin encontrar mención de Carta Porte) como a dos fuentes técnicas independientes de esta investigación (`tododiarios.com` y `tress.com.mx`, que describen 2026 como un año de **catálogos más estrictos sobre la misma versión 3.1**, sin salto de versión mayor, y confirman que la obligatoriedad sin convivencia data de julio-2024). **Gana la versión de la ola 1 y las fuentes técnicas**: no hay evidencia de una versión "3.1 (2026)" distinta a la 3.1 vigente desde 2024; lo que cambió es la severidad de la validación de catálogos, no el estándar. No usar la afirmación de `aprende-logistica.com` en ningún material.

**CONFLICTO B — origen del hallazgo de la regla 11.7.3 respecto a `04-iva-ieps-estimulos.md`.** No es una contradicción entre archivos en el sentido de que ambos estén vigentes al mismo tiempo diciendo cosas distintas — es una **discontinuidad temporal real**: `04-iva-ieps-estimulos.md` leyó la RMF 2026 tal como se publicó el 28-dic-2025, donde el Capítulo 11.7 no tenía regla 11.7.3 y el propio archivo advierte, correctamente para esa fecha, que "el estímulo de diésel se instrumenta en 11.7.3" era una "trampa documentada" de blogs. El 09-jul-2026 el SAT **sí** adicionó la regla 11.7.3, y su contenido (reducir el "precio base del diésel") toca exactamente el terreno que el archivo 04 daba por resuelto con el Acuerdo semanal de la SHCP. No corrijo la ola 1 — su lectura era correcta el día que se hizo. Lo marco aquí como el caso de estudio de este documento: la ventana entre "verificado" y "caduco" para las reglas de IEPS al diésel puede ser de meses, no de años, y ningún archivo de la ola 1 estaba diseñado para volver a mirarse solo.

---

## SIN VERIFICAR

1. **La relación exacta entre la regla 11.7.3 (RMF, adicionada 09-jul-2026) y el estímulo de diésel acreditable por el transportista (LIF 2026 art. 20-A-IV, RMF reglas 9.1.6–9.1.8).** No encontré ninguna fuente que conecte explícitamente ambos mecanismos. Es el pendiente de mayor riesgo de todo este documento — ver Acciones concretas.
2. **Si existe un feed, RSS o API oficial del SAT que anuncie nuevas versiones anticipadas o Resoluciones de Modificaciones sin necesidad de scraping del HTML.** No se buscó exhaustivamente; el minisitio HTML es suficiente pero un feed estructurado sería más barato de vigilar.
3. **Si el "comunicado conjunto" de gob.mx del 27-mar-2026 sobre HidroYPetro es la fuente que legalmente cuenta para el cómputo de los 30 días naturales de la regla 2.7.1.8**, o si ese cómputo exige específicamente la fecha de publicación en el minisitio de complementos (que sigue sin poder leerse por el 403 de la SPA). Ola 1 ya lo dejó como pendiente bloqueante; sigue sin cerrar del todo, aunque con más respaldo.
4. **Calendario exacto de actualización de catálogos del Anexo 20 más allá de 2026** — no hay compromiso publicado de periodicidad (la ola 1 ya señaló lo mismo para el padrón de la CNE). Lo observado (casi mensual) es un patrón, no una garantía contractual del SAT.
5. **Si las 16 versiones anticipadas de la Primera Resolución de 2026 y las 6 Resoluciones completas de 2025 son representativas de un patrón estable, o si 2025-2026 fue un año inusualmente activo** (el propio blog de Alegra lo describe como "8+ modificaciones... más recientes que afectan materialidad de CFDI", sugiriendo una intensificación deliberada de la fiscalización, no solo ruido normal). Un solo año de datos completos (2025) no basta para separar tendencia de ruido.
6. **Existencia y contenido de una tabla de correlación oficial para el cambio del artículo 16 al 20 de la LIF** (el caso donde, a diferencia de Anexo 1-A→2, no hay renumeración anunciada como tal sino una Nueva Ley completa). Confirmar si el SAT o la SHCP publicaron alguna guía de transición, o si de verdad el único mecanismo es leer ambos textos y diferenciarlos a mano, como hizo la ola 1.
7. **Los 32 periódicos oficiales estatales y su formato/accesibilidad para scraping** — no se armó la lista ni se probó el acceso de ninguno; es trabajo pendiente, no solo dato pendiente.

---

## Fuentes

- Minisitio de Normatividad RMF, RGCE y RFA — SAT, sección 2026: https://www.sat.gob.mx/minisitio/NormatividadRMFyRGCE/normatividad_rmf_rgce2026.html
- Minisitio de Normatividad RMF, RGCE y RFA — SAT, sección 2025 (para la cadencia de 6 resoluciones): https://www.sat.gob.mx/minisitio/NormatividadRMFyRGCE/normatividad_rmf_rgce2025.html
- Diario Oficial de la Federación, 17-jul-2026 (Anexos 1, 2, 3, 9, 14, 15, 21, 22, 29 de la Primera Resolución de Modificaciones a la RMF 2026): https://www.diputados.gob.mx/LeyesBiblio/dof/2026/jul/DOF_17jul26.pdf
- Síntesis del Diario Oficial de la Federación, 09-jul-2026 (SCJN) — texto del resolutivo Primero de la Primera Resolución de Modificaciones a la RMF 2026: https://www.scjn.gob.mx/sites/default/files/sintesis_dof_gocdmx/documento/2026-07/DOF%2009072026%20S%C3%8DNTESIS.pdf
- IMCP, Noticias Fiscales 2026-156 — Segunda Resolución de Modificaciones a la RMF 2026, 1a versión anticipada (09-jul-2026): https://imcp.org.mx/noticias-fiscales-2026-156-sat-segunda-resolucion-de-modificaciones-a-la-resolucion-miscelanea-fiscal-para-2026-primera-version-anticipada/
- IMCP, Noticias Fiscales 2026-160 — Segunda Resolución de Modificaciones a la RMF 2026, 2a versión anticipada (16-jul-2026): https://imcp.org.mx/noticias-fiscales-2026-160-sat-segunda-resolucion-de-modificaciones-a-la-resolucion-miscelanea-fiscal-para-2026-segunda-version-anticipada/
- Stratego Asesores, "Quinta versión anticipada de la RMF 2026 y sus modificaciones clave" (17-abr-2026): https://www.stratego-st.com/publicaciones/quinta-version-anticipada-de-la-rmf-2026-y-sus-modificaciones-clave/
- Siempre al Día, "Resolución Miscelánea Fiscal 2026" (tabla completa de versiones anticipadas 1a–16a y cronología del estímulo IEPS diésel vía regla 11.7.3, 15-jul-2026): https://siemprealdia.co/mexico/fiscal/resolucion-miscelanea-fiscal-2026/
- Blog Alegra, "Resolución Miscelánea Fiscal 2026: cambios y actualizaciones" (renumeración Anexo 1-A→2, conteo de 8+ modificaciones a mayo-2026): https://blog.alegra.com/mexico/resolucion-miscelanea-fiscal/
- Portal de trámites y servicios SAT — Resolución de Facilidades Administrativas (RFA 2020 y enlaces históricos): https://wwwmat.sat.gob.mx/normatividad/61128/resolucion-de-facilidades-administrativas
- DOF/SIDOF — RFA 2016 (DOF 30-dic-2015, texto con transitorio del Complemento de Liquidación): http://imcp.org.mx/wp-content/uploads/2015/12/ANEXO-NOTICIAS-FISCALES-382.pdf
- DOF/SIDOF — RFA 2018 (DOF 29-dic-2017): https://www.dof.gob.mx/nota_detalle.php?codigo=5509510&fecha=29/12/2017
- SIDOF — RFA 2019 (DOF 21-feb-2019): https://sidofqa.segob.gob.mx/notas/getNewsletter/21-02-2019/Matutina/281627
- SIDOF — RFA 2020 (DOF 18-feb-2020): https://sidof.segob.gob.mx/notas/getNewsletter/18-02-2020/Matutina/285299
- Portal de trámites y servicios SAT — Anexo 20, tabla de "fecha de última modificación en este portal" por documento técnico (esquema, catálogos, matriz de errores): http://omawww.sat.gob.mx/tramitesyservicios/Paginas/anexo_20.htm
- SW Developers (Timbrado Masivo CFDI) — actualización de catálogos CFDI 4.0, 01-ene-2026: https://developers.sw.com.mx/knowledge-base/01-enero-2026-actualizacion-de-catalogos-cfdi-4-0/
- SW Developers — actualización de catálogos Carta Porte y Plataformas Tecnológicas, 15-ene-2026: https://developers.sw.com.mx/knowledge-base/15-enero-2026-actualizacion-de-catalogos-complemento-carta-porte-v3-1/
- GoSocket, "SAT actualiza el catálogo de CFDI versión 4.0: 15-01-2026": https://gosocket.net/centro-de-recursos/sat-actualiza-el-catalogo-de-cfdi-version-4-0-15-01-2026/
- CONTPAQi / carta técnica — Actualización de Catálogos SAT (código postal, municipio), 23-ene-2026: https://conocimiento.blob.core.windows.net/conocimiento/2026/Comerciales/FacturaElectronica/CartasTecnicas/CT_Factura_Electronica_1401/actualizacion_de_catalogos_sat_print.html
- gob.mx/SAT, comunicado conjunto SAT-SENER-CNE-ATDT, "El Gobierno de México implementa nuevo mecanismo para combatir el mercado ilícito de combustibles" (27-mar-2026): https://www.gob.mx/sat/prensa/el-gobierno-de-mexico-implementa-nuevo-mecanismo-para-combatir-el-mercado-ilicito-de-combustibles-422420?idiom=es
- SW Developers — Nuevo Complemento Concepto Hidrocarburos y Petrolíferos v1.0 (25-mar-2026): https://developers.sw.com.mx/knowledge-base/nuevo-complemento-concepto-hidrocarburos-y-petroliferos-v1-0/
- GoSocket, "Nuevo Complemento de Hidrocarburos y Petrolíferos para CFDI" (26-mar-2026): https://gosocket.net/centro-de-recursos/nuevo-complemento-de-hidrocarburos-y-petroliferos-para-cfdi/
- Facturama, historial de actualizaciones del Complemento Carta Porte 3.1: https://apisandbox.facturama.mx/guias/complementos/complemento-carta-porte-31
- Facturando.mx, "Nueva versión del complemento carta porte 3.1" (27-jun-2024): https://www.facturando.mx/blog/index.php/2024/06/27/nueva-version-del-complemento-carta-porte-3-1/
- Asesoría en Informática, "Carta Porte versión 3.0 ¿Cuándo entra en vigor?" (transición v2.0→v3.0, Primer Anteproyecto de la Octava RM RMF 2023): https://asesoriaeninformatica.com/carta-porte-v-3-0-cuando-entra-en-vigor/
- Todo Diarios, "Carta Porte 3.1 en 2026: SAT endurece criterios de validación y catálogos" (sin salto de versión mayor en 2026): https://tododiarios.com/noticias/carta-porte-3-1-validacion-catalogos-2026
- Tress.com.mx, "Actualizaciones de Carta Porte: ¿qué deben considerar las empresas?" (08-may-2026): https://tress.com.mx/blog/actualizaciones-de-carta-porte-que-deben-considerar-las-empresas/
- [SIN CORROBORAR, citado solo para dejar constancia del Conflicto A] Aprende Logística, "Carta Porte 3.1 SAT 2026: Cambios, Obligaciones y Cómo Cumplir": https://aprende-logistica.com/carta-porte-3-1-sat-2026-cambios/
- Siempre al Día, "CFDI 5.0 en México 2026: ¿Está vigente según el SAT?" (02-mar-2026): https://siemprealdia.co/mexico/fiscal/cfdi-5-0/
- Blog Alegra, "¿Nuevo CFDI 5.0? Cambios, requisitos y fechas clave 2026" (23-feb-2026): https://blog.alegra.com/mexico/cfdi-5-0/
- 00-INDICE.md, 00-RESUMEN-EJECUTIVO.md, 01-cfdi-cff.md, 02-carta-porte.md, 03-isr-facilidades.md, 04-iva-ieps-estimulos.md, 05-hidrocarburos.md, 06-estatal.md, 07-no-fiscal.md — ola 1, `/Users/javiercamaraportepetit/likida-conocimiento/`, consultados 27-jul-2026 (línea base de este documento, no re-citados fuente por fuente aquí; ver esos archivos para el detalle original).
