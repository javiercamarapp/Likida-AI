# Cumplimiento continuo: el agente como vigilante

> Ola 2 — 27-jul-2026. Construido sobre la ola 1 (`00` a `11`) y sobre `21-guardarrailes.md` y
> `23-actualizacion.md` de esta misma ola. No repite lo que esos archivos ya cerraron; lo cita y
> sigue desde ahí.

---

## Resumen para el fundador

`23-actualizacion.md` (de este mismo paquete) ya resolvió una pregunta: cómo se entera Likida de
que **la ley cambió**. Esta investigación resuelve la otra mitad, que es distinta y nadie la había
mirado: cómo se entera Likida de que **su contraparte dejó de cumplir** — un proveedor que hoy
factura bien y en tres semanas aparece en una lista negra del SAT, un operador cuya licencia federal
venció el mes pasado sin que nadie lo notara, una póliza de seguro que caducó mientras el camión
seguía saliendo a ruta. La ley no se movió. Lo que se movió fue el estatus de alguien más, y ese
movimiento no llega por WhatsApp: hay que ir a buscarlo.

El hallazgo central, y el que cambia el diseño del producto: **de las ocho cosas que el encargo pidió
vigilar, solo tres tienen una consulta pública, gratuita y sin credenciales de la contraparte** — las
listas negras del SAT (69, 69-B, 69-B Bis, 49 Bis y CSD sin efectos), la validación masiva de RFC
(hasta 5,000 por archivo, sin necesidad de contraseña ni firma), y de forma parcial el estatus del
RFC vía el QR de la Constancia de Situación Fiscal. La opinión de cumplimiento 32-D — la que más
vale, porque resume todo lo demás en un solo semáforo — **solo se puede consultar con las
credenciales propias del contribuyente o con su autorización expresa como "tercero autorizado" en el
portal del SAT**; no hay forma de pedírsela a un proveedor sin que él la habilite, y eso confirma
—no contradice— la decisión que ya tomó `11-datos-personales.md`: nada de bóveda de credenciales.
El permiso SICT de la empresa, la verificación físico-mecánica, la verificación de emisiones, la
aptitud psicofísica del operador y la vigencia de una póliza de seguro **no tienen ninguna consulta
pública verificada en esta investigación**. Eso no es un hueco de investigación: es el hueco real del
mercado, y es exactamente donde Likida puede vender un registro de vencimientos con evidencia
documental en vez de prometer una API que no existe.

El segundo hallazgo que cambia el diseño: **los archivos masivos que el SAT publica (los CSV de
"datos abiertos") no son en tiempo real — llevan semanas o meses de retraso** (la lista 69-B decía
"actualizada al 31 de mayo" consultada el 27 de julio; el Artículo 69, "al 1 de abril"; el 69-B Bis,
"al 12 de marzo"). Eso significa que el barrido masivo sirve como red de respaldo, nunca como fuente
principal: la fuente principal sigue siendo el web service de validación de CFDI que `01` ya diseñó
(consulta puntual, prácticamente en vivo, trae `ValidacionEFOS` de regalo). Y el tercer hallazgo:
existe un buscador público de la Licencia Federal de Conductor en el sitio de la SICT/DGAF, algo que
`07` y `10-contradicciones.md` no habían encontrado — pero está protegido con CAPTCHA, y `11` ya puso
la línea que no se cruza con eso.

Lo que propongo: un **radar de contrapartes y activos**, hermano del "índice de citas vivas" que `23`
diseñó para las normas, pero para entidades (RFC de proveedores, número de licencia, número de
póliza, folio de verificación) — con su propio mecanismo, su propia cadencia y su propio dueño humano
cuando la máquina no puede resolverlo sola.

---

## 1. Dos vigilancias distintas que no hay que confundir

`23-actualizacion.md` diseñó cómo Likida se entera de que **la norma** cambió: nueva RMF, nuevo
Anexo, nueva regla renumerada. Esta investigación diseña cómo Likida se entera de que **la
contraparte** dejó de cumplir esa norma, que es un problema distinto aunque comparta técnica de
vigilancia (ambos usan `HEAD`, hashes, scraping periódico, listas con fecha de corte). La norma es
una: cambia pocas veces al año. Las contrapartes son cientos por flota — cada proveedor de diésel,
cada gasolinera, cada operador, cada unidad — y cualquiera de ellas puede caer en incumplimiento en
cualquier momento sin que el texto de ninguna ley se haya movido ni una coma.

La distinción de la Regla Dura #4 del encargo aplica aquí con más fuerza que en ningún otro
documento de este paquete, porque las tres capas conviven en la misma tabla:

- **LEY**: que exista la lista de EFOS (CFF 69-B), que el permisionario deba tener seguro (LCPAF
  63 Bis y 68), que la licencia federal deba renovarse, que el vehículo deba verificarse.
- **FACILIDAD/REGLA ADMINISTRATIVA**: la vigencia de 30 días de la opinión de cumplimiento (RMF, no
  CFF), el calendario de verificación físico-mecánica por dígito de placa (AVISO DOF, no la NOM), el
  plazo de 15 días para desvirtuar el 69-B antes de pasar a definitivo (RMF/Reglamento del CFF).
- **PRÁCTICA DE MERCADO** (ni ley ni facilidad, y a veces ilegal si cruza la línea): herramientas de
  terceros como extensiones de navegador que automatizan captchas del SAT para consultar RFC más
  rápido, o proveedores que piden la CIEC del contribuyente para "monitorear" su cumplimiento. Ambas
  prácticas existen en el mercado (ver §3.2 y §5); ninguna es el estándar que Likida debe copiar.

---

## 2. El mapa: qué se cae, quién lo controla, y con qué reloj

| # | Qué vigilar | Quién lo controla | Capa (ley / facilidad / práctica) | Con qué frecuencia cambia | Qué pasa si nadie mira |
|---|---|---|---|---|---|
| 1 | RFC del emisor en lista 69-B (EFOS) | SAT, CFF 69-B | Ley (la lista) + reglas de plazo (RMF) | Publicación cada ~10 días a 4 semanas, sin periodicidad fija | Se pierde la deducción y el IVA acreditado; 30 días naturales desde el DOF para corregir |
| 2 | RFC del emisor en lista 49 Bis (CFDI declarado falso) | SAT, CFF 49 Bis (DOF 07-nov-2025, vigente desde 01-ene-2026) | Ley (nueva desde 2026) | Recién empezó a producir publicaciones (primer oficio: **10-jul-2026**, 3 contribuyentes) | Igual que el 69-B, pero además puede restringir el CSD **propio** de la flota si no reacciona en 30 días naturales |
| 3 | RFC del proveedor en la lista de "incumplidos" (Art. 69: cancelados, exigibles, firmes, no localizados, **CSD sin efectos**) | SAT, CFF 69 | Ley | "Se actualiza continuamente" según el propio SAT, sin fecha fija | Facturar con alguien cuyo CSD ya está restringido produce un CFDI que puede no timbrarse o quedar en entredicho |
| 4 | Opinión de cumplimiento del proveedor (32-D) | SAT, CFF 32-D + RMF | Ley (el mecanismo) + regla (la vigencia) | Vigencia de la opinión positiva: **30 días naturales** (caso general) o **3 meses** (para estímulos/subsidios) | Sin esto no se sabe si el proveedor tiene adeudos firmes o declaraciones no presentadas, aunque no esté en ninguna lista negra |
| 5 | Estatus del RFC (activo / suspendido / cancelado) | SAT | Ley | Cambia con cada movimiento del contribuyente en el RFC | Un CFDI de un RFC suspendido es un gasto en riesgo aunque el CFDI mismo esté bien formado |
| 6 | Vigencia de la Licencia Federal de Conductor del operador | SICT/DGAF, LCPAF 36 | Ley (obligación) — **4 años** cat. A/B/C/D/F, **2 años** cat. E (`07` §3.3) | Evento fijo y conocido por operador, pero nadie lo vigila hoy | El permisionario es **solidariamente responsable** (LCPAF 38) si su operador circula con la licencia vencida |
| 7 | Constancia de aptitud psicofísica del operador | DGPMPT | Ley/norma médica (Requisitos DGPMPT, Art. Octavo) — **2 años** | Evento fijo por operador | Sin ella no se puede renovar la licencia; es la causa más silenciosa de un operador "varado" |
| 8 | Permiso SICT de la empresa (el de la unidad, no el de la persona) | SICT, LCPAF 8/50 | Ley | **Indefinido** — no vence, pero está condicionado a mantener vigentes seguro y verificación al hacer altas/bajas | El riesgo no es que caduque el permiso; es que se le den de alta o de baja vehículos sin los requisitos vigentes |
| 9 | Verificación físico-mecánica (NOM-068) | Unidad de Inspección acreditada, LCPAF 35 | Ley (obligación) + facilidad (el calendario por dígito de placa es un AVISO DOF que se ha movido 3 veces solo en 2025) | Anual (con exenciones por antigüedad, `07` §5.2) | Multa de 100 a 105 UMA ($11,731–$12,318) y el vehículo puede ser retirado de circulación en carretera |
| 10 | Verificación de emisiones | Centro de verificación autorizado, ACUERDO DOF 18-abr-1997 | Ley + calendario semestral fijo por SICT | Semestral, calendario 2026 ya confirmado en `07` §6.2 | Multa y riesgo de retiro de circulación |
| 11 | Vigencia de las pólizas de seguro (RC vehicular, RC del permisionario, daños ecológicos) | Aseguradora + CNSF (registro obligatorio, LISF art. 202) | Ley (la obligación) | Anual, fecha propia de cada póliza | Multa (LCPAF 74 Bis fr. II, con 45 días de gracia) **y** la flota queda expuesta al costo total de un siniestro sin cobertura — el peor escenario económico de todo este documento |

---

## 3. Lo que SÍ se puede vigilar programáticamente, uno por uno

### 3.1 Las listas negras del SAT: hay más de una, y ahora hay un portal de datos abiertos

Ola 1 (`01` §9.1) ya identificó el web service de validación de CFDI y su campo `ValidacionEFOS`.
Lo que esta investigación agrega es que el 69-B **no es la única lista**, y que existe un portal
oficial de "datos abiertos" que las agrupa a todas en archivos descargables (CSV/XLS), sin necesidad
de scraping del HTML de consulta uno-por-uno:

**Portal — SAT, "Datos abiertos: contribuyentes publicados"**
`https://www.sat.gob.mx/minisitio/DatosAbiertos/contribuyentes_publicados.html`

Ahí conviven, cada una con su propia fecha de corte impresa en la página:

| Lista | Fundamento | Archivos disponibles | Fecha de corte vista el 27-jul-2026 |
|---|---|---|---|
| **Art. 69** — contribuyentes incumplidos | CFF 69, último párrafo | Cancelados, Exigibles, Firmes, No localizados, **CSD sin efectos**, Condonados, Reducción de multas/recargos, Entes públicos omisos | actualizada al **1-abr-2026** |
| **Art. 69-B** — EFOS/EDOS | CFF 69-B | Listado completo, Definitivos, Desvirtuados, **Presuntos**, Sentencias favorables | actualizada al **31-may-2026** |
| **Art. 69-B Bis** — pérdidas fiscales indebidamente transmitidas | CFF 69-B Bis | Listado completo, Definitivos, Sentencias favorables | actualizada al **12-mar-2026** |

**El hallazgo que importa más que la lista misma:** las tres fechas de corte están **desfasadas
entre sí y todas por detrás de la fecha de consulta** (hasta 4 meses de retraso en el caso del 69-B
Bis). Esto confirma, con evidencia nueva, la regla que `01` ya aplicaba de facto: **el archivo masivo
es un barrido de respaldo, no la fuente de la verdad del día**. La fuente del día sigue siendo el
web service `consultaqr.facturaelectronica.sat.gob.mx` que `01` §9.1 ya documentó, porque responde
sobre la base transaccional viva del SAT, no sobre un extracto congelado.

El archivo del **CSD sin efectos** (dentro del Art. 69) es el hallazgo más directamente accionable de
esta sección y no estaba en el radar de ola 1: es la lista de contribuyentes a quienes el SAT ya les
restringió el Certificado de Sello Digital (por el mecanismo del 17-H Bis, que `01` §2.3 y §4.2 ya
documentó como consecuencia del 49 Bis y de las cancelaciones no atendidas). Un proveedor en esa
lista **no puede timbrar CFDI válidos aunque nada le impida seguir operando el negocio** — es la
señal más temprana de que una gasolinera o un comercio recurrente está a punto de dejar de poder
facturar, y hoy nadie la cruza contra el padrón de proveedores de una flota.

### 3.2 Validación masiva de RFC — pública, gratuita, sin credenciales, hasta 5,000 por corrida

**Hallazgo nuevo respecto a `01` y `11`.** El SAT ofrece un servicio de "Validación del RFC en
línea", documentado en un instructivo propio del portal, que:

- **No requiere Contraseña ni e.firma** ("no es necesario abrir un caso de Servicios al
  Contribuyente").
- Valida **uno a uno o de forma masiva hasta 5,000 registros por archivo**, subiendo un `.txt` con
  formato de columnas separadas por `|` (RFC, nombre/razón social, código postal).
- Devuelve, por cada RFC: si es **válido/inválido**, si el **nombre coincide** con lo registrado, y
  si el **código postal coincide**.

Esto es distinto y complementario al `ValidacionEFOS` del web service de CFDI: aquel valida una
factura puntual; este valida **la existencia y consistencia del RFC en sí**, en lote, sin necesidad
de tener un CFDI a la mano. Es el mecanismo correcto para una corrida periódica contra **todo** el
padrón de proveedores recurrentes de una flota (gasolineras, casetas, talleres, refaccionarias),
no solo contra los que facturaron esta semana — detecta el caso donde el nombre o el código postal
del proveedor cambiaron sin avisar, que es exactamente el tipo de discrepancia que `01` §2.1
identifica como motivo de rechazo de un CFDI por el fisco.

Fuente primaria: instructivo oficial "Validación del RFC en línea de uno hasta cinco mil registros",
publicado en `sat.gob.mx` (ver Fuentes).

**Práctica de mercado que no hay que copiar:** existe una extensión de navegador de un tercero
("SAT+") que automatiza el buscador de RFC del portal **resolviendo el CAPTCHA de forma
automatizada**. `11-datos-personales.md` §4 ya puso la línea: bypass de CAPTCHA en un portal que lo
usa como mecanismo de seguridad "no es zona gris". El servicio de validación masiva del §3.2 no tiene
este problema porque es un servicio explícitamente diseñado para consulta programática — es la ruta
que hay que usar, no el buscador con CAPTCHA.

### 3.3 Opinión de cumplimiento 32-D — la que más vale y la que menos se puede automatizar de un tercero

Verificado contra tres páginas oficiales del portal del SAT (ver Fuentes): existen **tres formas** de
obtener la opinión de cumplimiento, y las tres tienen el mismo candado:

1. **Consulta propia**: el contribuyente entra con su Contraseña o e.firma. Solo sirve para
   consultar la opinión **de uno mismo**.
2. **Consulta como "tercero autorizado"**: un tercero puede consultarla, pero **solo si el
   contribuyente lo autorizó explícitamente dentro del Portal del SAT** para ese fin. Si el
   contribuyente lo da de baja como autorizado, el tercero deja de poder consultarla.
3. **Consulta como "autoridad externa"**: reservada a entes que ejercen recursos públicos
   (gobierno, quien da subsidios) — no aplica a una flota privada.

**No existe una cuarta vía.** No hay una consulta pública sin autenticación, ni un servicio que
permita a Likida pedir la opinión de un proveedor con solo su RFC. La única forma de que Likida vea
la opinión de una gasolinera es que esa gasolinera la autorice expresamente en el Portal del SAT como
tercero — algo que en la práctica ningún comercio pequeño va a hacer para un cliente. Esto **confirma
la decisión ya tomada en `11-datos-personales.md`** (arrancar sin bóveda de credenciales): no hay
ninguna ruta legítima para automatizar el 32-D de un proveedor sin su cooperación activa.

**Lo que sí es defendible y valioso: la opinión de la propia flota.** El contralor ya tiene sus
propias credenciales del SAT (las necesita para todo lo demás). Un chequeo mensual del 32-D de la
propia empresa es barato, no toca el problema de credenciales de terceros, y detecta con antelación
si la flota misma va a tener problemas para acceder a subsidios, licitaciones o financiamiento —
información que hoy el contralor solo descubre cuando la necesita y ya es tarde.

**Vigencia (RMF, no CFF):** 30 días naturales para el caso general, 3 meses para efectos de
estímulos o subsidios. Esto fija la cadencia: revisarla **cada mes** cubre ambos casos con margen.

**Nota de mercado (no imitar sin evaluar el riesgo legal).** Existen proveedores (ej. CRiskCo) que sí
extraen el 32-D, el CFDI y la Constancia Fiscal de un tercero de forma automatizada — pero lo hacen
pidiéndole al contribuyente su **contraseña CIEC** directamente, no vía el mecanismo de "tercero
autorizado" del SAT. Es exactamente el patrón de "bóveda de credenciales" que `11-datos-personales.md`
ya evaluó y decidió no construir para el arranque de Likida.

### 3.4 Constancia de Situación Fiscal — no es un documento con fecha de caducidad; es una foto que se puede volver a tomar

El encargo pregunta por "vigencia de la Constancia de Situación Fiscal", y la precisión que hay que
hacer es esta: **la CSF no tiene una fecha de vencimiento impresa que caduque por sí sola** —es un
extracto del estado del RFC en el momento en que se generó. Lo que cambia con el tiempo no es "la
constancia", es el **estatus del RFC** detrás de ella (Activo, Suspendido, Cancelado, Reactivado).
Por eso una CSF de hace un año puede mostrar información que ya no es cierta, sin que el documento
mismo esté "vencido" en ningún sentido legal formal.

El SAT resolvió esto con dos mecanismos, ambos verificados:

- **El código QR de la CSF** enlaza a una consulta en vivo contra la base del SAT: al escanearlo,
  muestra el estatus **actual** del RFC (no el que tenía cuando se imprimió el PDF), incluyendo si
  está Activo o Suspendido. Esto significa que una CSF vieja **sigue siendo útil para vigilancia
  continua** si Likida guarda el enlace del QR (no solo la imagen del PDF) y lo vuelve a consultar
  periódicamente.
- **"Verifica si estás registrado en el RFC"** (`wwwmat.sat.gob.mx/aplicacion/29073`): consulta
  pública, **sin autenticación**, por RFC o CURP, que confirma si la clave sigue inscrita en el
  padrón. Es más simple que el QR (no requiere tener antes una CSF del proveedor) y sirve como primer
  filtro barato.

**Desde 2026, además, ya no es obligatorio exigirle la CSF física a un proveedor para facturarle**
(fuente secundaria, ver Fuentes) — lo que hace más valiosa todavía la validación programática del
RFC por sí sola (§3.2), porque Likida no puede depender de que el proveedor le entregue el documento.

### 3.5 Licencia Federal de Conductor — sí hay un buscador público, con un candado de CAPTCHA

**Hallazgo que matiza, sin contradecir, a `07` y a `10-contradicciones.md` §12.2.** Esos documentos
concluyeron que "nadie valida el permiso de la SICT" contra una fuente pública — y siguen teniendo
razón: eso es sobre el **permiso de la empresa** (§3.6 abajo). Lo que esta investigación encontró es
distinto: existe un **buscador público de la Licencia Federal de Conductor** (el documento de la
*persona*, no el de la empresa), operado por la Dirección General de Autotransporte Federal:

`http://app.sct.gob.mx/ConsultaInfracciones/detalleLicFederal.do` (también accesible vía
`aplicaciones9.sct.gob.mx`, listado en la propia página de "Sistemas de consulta" de la SICT).

El formulario pide **número de licencia** y **número de expediente médico**, más un **CAPTCHA**. No
pude completar una consulta real (el CAPTCHA bloquea la automatización de prueba en esta
investigación), así que **queda SIN VERIFICAR qué campos exactos devuelve** — si muestra vigencia,
categoría, estatus de suspensión/cancelación, o solo confirma existencia. Lo que sí está verificado
es que **la herramienta existe, es pública y no requiere las credenciales del operador**.

**El mismo candado de `11-datos-personales.md` aplica aquí.** Automatizar esta consulta en lote
requeriría resolver el CAPTCHA — la misma línea que ya se decidió no cruzar en §3.2. La forma
correcta de usar esto no es un scraper masivo: es dar de alta manualmente el número de licencia y el
expediente médico de cada operador una sola vez, y usar la consulta **puntual y ocasional** (por
ejemplo, al contratar a un operador nuevo, o para una verificación de auditoría), no como fuente de
vigilancia automática recurrente.

### 3.6 Lo que sigue sin tener consulta pública verificada (y no hay que prometer que la tiene)

Cuatro de las ocho cosas del mapa del §2 **no tienen ninguna fuente pública consultable** encontrada
en esta investigación, ni por API ni por formulario con CAPTCHA:

- **Permiso SICT de la empresa** (el número de permiso, no la licencia del operador). Confirma la
  conclusión de `07` y `10-contradicciones.md` §12.2: dos verificaciones negativas independientes ya
  existían; esta es la tercera. La ficha de trámite y el propio Acuerdo de simplificación (DOF
  02-jul-2025) no mencionan ningún servicio de consulta pública del estatus de un permiso ya emitido.
- **Verificación físico-mecánica (NOM-068)** y **verificación de emisiones**: la SICT publica
  calendarios (por dígito de placa) y las Unidades de Inspección emiten el dictamen y la calcomanía
  física (`07` §5–6), pero no se encontró un padrón público consultable de qué unidades ya pasaron o
  están vencidas. La prueba de cumplimiento vive físicamente pegada al vehículo, no en una base de
  datos abierta.
- **Constancia de aptitud psicofísica** del operador (DGPMPT): ningún registro público encontrado.
- **Vigencia de pólizas de seguro**: la Ley de Instituciones de Seguros y de Fianzas (**art. 202**)
  **sí obliga a registrar cada contrato de seguro ante la CNSF**, y ese registro importa legalmente —
  la SCJN resolvió un caso (Amparo Directo en Revisión 839/2023, ver Fuentes) donde la falta de
  registro de una póliza a tiempo afectó los límites de cobertura frente a un tercero. Pero **no se
  encontró ningún servicio público donde Likida pueda introducir un número de póliza y verificar si
  está vigente hoy**. Lo que sí existe y es público es el **RECAS de CONDUSEF**
  (`phpapps.condusef.gob.mx/recas/`), pero ese registro es de **modelos de contrato** (qué cláusulas
  ofrece cada aseguradora), no de pólizas individuales — sirve para comparar coberturas, no para
  saber si la póliza específica de un permisionario sigue pagada y vigente.

**Consecuencia de producto, y es la más importante de todo este documento:** para estas cuatro cosas,
la única fuente confiable es el **documento físico o su fecha de vencimiento auto-reportada**, no una
consulta a una autoridad. Likida puede diferenciarse aquí construyendo el mejor **registro de
vencimientos con evidencia fotográfica/OCR** del mercado (extraer la fecha de vigencia de la foto de
la póliza, de la calcomanía de verificación, del oficio de aptitud psicofísica), pero **nunca debe
prometerle a un contralor que "valida contra la aseguradora" o "valida contra la SICT"** — sería
repetir, en pólizas y verificaciones, el mismo error que `07` §"Lo que hay que dejar de prometer" ya
marcó para permisos.

---

## 4. El sistema de alertas propuesto: el radar de contrapartes y activos

### 4.1 Por qué no es el mismo mecanismo que el índice de citas vivas de `23`

`23-actualizacion.md` propuso un índice de **citas normativas** (una fila por cada regla que el
producto usa). Lo que este documento necesita es distinto: una fila por cada **entidad** que puede
dejar de cumplir — un RFC, un número de licencia, un número de póliza, un folio de verificación. Los
campos no son los mismos, pero el principio sí: **ninguna afirmación de cumplimiento entra al
producto sin fecha de verificación y sin fecha de próxima revisión**, y el default ante una fecha
vencida es dejar de afirmar "vigente", no seguir mostrándolo en verde con datos viejos.

### 4.2 La tabla — un renglón por entidad vigilada

| Campo | Ejemplo |
|---|---|
| `tipo_entidad` | proveedor / operador / unidad / la_propia_flota |
| `identificador` | RFC, número de licencia, número de póliza, folio de verificación |
| `que_se_vigila` | "¿está en el 69-B?", "¿la licencia sigue vigente?", "¿la póliza está pagada?" |
| `mecanismo` | web_service_puntual / barrido_masivo_csv / consulta_publica_manual / auto_reportado_con_evidencia |
| `fuente_url` | el servicio o portal exacto (§3) |
| `fecha_ultima_verificacion` | — |
| `fecha_proxima_revision` | calculada según §4.3 |
| `fecha_vencimiento_conocida` | (solo aplica a licencia, póliza, verificación, aptitud psicofísica — no a RFC ni listas negras) |
| `estado` | vigente / en_revision / vencido / en_lista_negra / sin_evidencia |

### 4.3 Las cuatro cadencias, y por qué cada una es distinta

| Mecanismo | Qué vigila | Cadencia recomendada | Por qué esa cadencia |
|---|---|---|---|
| Web service de CFDI (`ValidacionEFOS`, `EstatusCancelacion`) | Cada CFDI en el momento en que entra | **En cada CFDI**, ya diseñado en `01` | Es la fuente más viva que existe; no hay razón para retrasarla |
| Barrido masivo (CSV de datos abiertos: 69, 69-B, 69-B Bis, CSD sin efectos) | Todo el padrón de proveedores recurrentes, no solo los que facturaron hoy | **Semanal** | Los archivos mismos se actualizan con semanas o meses de retraso (§3.1); revisarlos más seguido que eso no gana nada, y revisarlos menos deja huecos de un mes |
| Validación masiva de RFC (§3.2) | Consistencia de RFC/nombre/código postal de todo el padrón | **Mensual** | Es gratis y sin límite operativo real, pero el dato no cambia todos los días — mensual alcanza para detectar antes del cierre contable |
| 32-D propio + registro de vencimientos (licencia, póliza, verificación, aptitud psicofísica) | Estatus de la propia flota + documentos con fecha fija conocida | **32-D: mensual** (cubre la vigencia de 30 días). **Vencimientos con fecha conocida: alerta automática a 30, 15 y 1 día antes**, calculada desde la fecha que el propio documento declara | No depende de ningún servicio externo — es aritmética sobre una fecha que Likida ya tiene guardada |

### 4.4 A quién le llega cada alerta, y qué la cierra

- **Aparece un RFC conocido en el 69-B, 69-B Bis, 49 Bis o CSD sin efectos** → alerta al contralor,
  **no** al operador. Es una decisión de negocio (¿se sigue comprando con ese proveedor?) con reloj
  de 30 días naturales. La cierra un humano.
- **Vence en 30/15/1 días una licencia, póliza, verificación o aptitud psicofísica** → alerta al
  contralor y, si aplica, notificación al propio operador. La cierra la carga de un documento nuevo
  con fecha de vigencia extraída (OCR) — si el sistema no puede leer la fecha con confianza, la
  alerta se queda abierta y pide confirmación humana, nunca se cierra sola.
- **32-D propio sale en sentido negativo** → alerta directa al contralor; nunca se muestra "vigente"
  con una opinión vieja, y el producto no debe intentar "arreglarlo" automáticamente (aclarar una
  inconsistencia ante el SAT toma hasta 6 días y es un trámite legal, no un checkbox).
- **Un dato no tiene evidencia ni fecha próxima de revisión** (por ejemplo, nunca se cargó la póliza
  de una unidad) → esto no es "vencido", es `sin_evidencia`, y se muestra distinto: es un hueco de
  onboarding, no una alerta de vencimiento.

### 4.5 Qué es automatizable y qué necesita a un humano

| Tarea | Automatizable | Necesita humano |
|---|---|---|
| Detectar que un RFC de proveedor entró a una lista negra (69, 69-B, 69-B Bis, CSD sin efectos) | Sí — barrido semanal + validación puntual por CFDI | Decidir si se sigue comprando con ese proveedor |
| Detectar que un RFC dejó de ser válido o que el nombre/CP no coincide | Sí — validación masiva mensual, sin credenciales | Confirmar si es error de captura o cambio real |
| Consultar el 32-D de un **proveedor** | — | Siempre requiere que el proveedor autorice a Likida como tercero en el Portal del SAT; no es automatizable sin su cooperación activa |
| Consultar el 32-D de la **propia flota** | Sí, con las credenciales propias del contralor (las mismas que usa para todo lo demás) | — |
| Extraer la fecha de vigencia de una licencia, póliza o dictamen de verificación desde una foto | Parcialmente (OCR) | Confirmar cuando el OCR tiene baja confianza; nunca cerrar la alerta solo con el OCR |
| Verificar el estatus real de una licencia federal contra la SICT | No, sin resolver un CAPTCHA (línea que `11` ya marcó como no cruzable) | Consulta manual puntual, no vigilancia recurrente |
| Verificar si un permiso SICT de empresa, una verificación físico-mecánica o una póliza siguen vigentes contra la autoridad/aseguradora | No — no existe consulta pública verificada | Siempre: registro de vencimientos con evidencia documental, sin promesa de validación externa |

---

## Acciones concretas

| Acción | Por qué | Esfuerzo | Cuándo |
|---|---|---|---|
| Construir el barrido semanal de los CSV de "datos abiertos" (Art. 69, 69-B, 69-B Bis, CSD sin efectos) contra el RFC de todos los proveedores recurrentes de cada flota | Es la red de respaldo que cubre lo que el web service puntual de `01` no ve si un proveedor no facturó esta semana pero sí sigue en el padrón | Bajo | Junto con el validador de CFDI que `01` ya propuso construir primero |
| Añadir la validación masiva de RFC (§3.2, hasta 5,000 por corrida, sin credenciales) al ciclo mensual de mantenimiento del padrón de proveedores | Detecta RFC inválidos o con nombre/CP inconsistente antes de que rechacen una deducción en la declaración anual | Bajo | Fase 1, junto con el motor de requisitos del 29-A |
| Construir el registro de vencimientos por unidad y por operador (licencia, aptitud psicofísica, verificación físico-mecánica, verificación de emisiones, pólizas), con carga de evidencia y extracción de fecha por OCR | Es el hueco real del mercado: ninguna de estas cinco cosas tiene consulta pública verificada; es donde Likida puede ganarle a cualquier competidor con solo tener el dato completo y a tiempo | Medio-alto | Antes de la demo si se puede mostrar con datos de ejemplo; es el diferenciador más defendible de esta investigación |
| Ofrecer el chequeo mensual del 32-D de la **propia** flota (con las credenciales que el contralor ya usa) como parte del panel de cumplimiento | Es accionable, legal, no toca el problema de credenciales de terceros, y resuelve una pregunta real ("¿podemos participar en esta licitación / pedir este financiamiento hoy?") | Bajo | Fase 2, después de que el motor de CFDI esté estable |
| **No construir** ni prometer un validador automático del 32-D de proveedores, del permiso SICT, de la verificación físico-mecánica ni de pólizas de seguro contra ninguna autoridad | No existe la fuente pública para hacerlo bien; prometerlo repite el error que `07` ya marcó para permisos, ahora en cuatro rubros más | — | Antes de escribir cualquier material comercial |
| Evaluar si vale la pena habilitar manualmente, uno por uno, la consulta pública de Licencia Federal de Conductor (con CAPTCHA) como verificación puntual de onboarding de un operador nuevo — nunca como barrido recurrente | Existe la herramienta; usarla mal (automatizando el CAPTCHA) cruza la línea que `11` ya trazó | Bajo (si es manual) | Cuando se diseñe el flujo de alta de un operador |
| Confirmar en fuente primaria qué campos exactos devuelve el buscador de Licencia Federal de Conductor (`app.sct.gob.mx/ConsultaInfracciones/detalleLicFederal.do`) — vigencia, estatus, categoría | Hoy solo está confirmado que la herramienta existe y qué pide como entrada; no qué contesta | Bajo (una consulta manual con datos de prueba reales) | Antes de diseñar la pantalla de "estatus de licencia" en el producto |
| Documentar el mecanismo de "tercero autorizado" del 32-D como una opción **opt-in** que Likida podría ofrecerle a un proveedor grande y recurrente (una gasolinera de flota, no un OXXO) a cambio de algo (mejor tarifa, prioridad de pago) | Es la única vía legítima para ver el 32-D de un tercero; convertirla en una oferta de valor en vez de asumir que nunca se puede | Medio | Fase 3, cuando exista relación comercial directa con proveedores ancla |

---

## CONFLICTOS

No se encontró ninguna contradicción real entre esta investigación y los documentos previos del
paquete. Hay una **precisión que podría leerse como contradicción y no lo es**, y vale la pena
dejarla explícita para que nadie la use mal:

**Aclaración, no conflicto — el permiso SICT sigue sin consulta pública; la licencia del operador sí
la tiene.** `07-no-fiscal.md` y `10-contradicciones.md` §12.2 concluyen que "nadie valida el permiso
de la SICT" y que eso es un hallazgo de demo (un número de permiso inventado pasa el timbrado). Esta
investigación **no lo contradice**: sigue sin existir consulta pública para el **permiso de la
empresa** (el objeto que esos dos documentos investigaron). Lo que sí encontré es una herramienta
distinta para un objeto distinto — la **Licencia Federal del conductor**, una persona, no una
empresa — que si se confunde con el permiso podría hacer pensar erróneamente que el hallazgo de `07`
y `10` quedó superado. No es así: siguen siendo dos objetos separados, con dos respuestas separadas,
y solo uno de los dos tiene consulta pública verificada.

---

## SIN VERIFICAR

1. **Qué campos exactos devuelve la Consulta de Licencias Federales de Conductor** de la SICT/DGAF
   (`app.sct.gob.mx/ConsultaInfracciones/detalleLicFederal.do`) — el CAPTCHA impidió completar una
   consulta real en esta investigación. Confirmado que existe, que pide número de licencia y número
   de expediente médico, y que es pública; no confirmado si contesta con vigencia, categoría o
   estatus de suspensión.
2. **El número exacto de la regla de la RMF 2026 que fija la vigencia de la opinión de cumplimiento**
   (30 días naturales / 3 meses). Las fuentes secundarias citan la regla 2.1.36 para la RMF 2024, y
   el propio portal del SAT confirma los plazos sin citar el número de regla 2026 en el texto
   accesible durante esta investigación.
3. **Si existe alguna consulta pública (aunque sea con CAPTCHA) del estatus de un permiso SICT de
   empresa**, más allá de lo ya negativo que confirmaron `07` y `10`. Esta investigación no encontró
   ninguna, pero tampoco agotó cada rincón del sitio de trámites de la SICT (que tiene enlaces rotos
   y páginas con nombres inconsistentes, ej. `sct.gob.mx` vs `micrs.sct.gob.mx` vs `app.sct.gob.mx`).
4. **Si el archivo de "CSD sin efectos" del Art. 69 se actualiza con la misma cadencia que el resto
   de la lista, o de forma independiente.** La página de datos abiertos no desglosa una fecha de
   corte por sub-archivo dentro del Art. 69, solo una fecha general ("actualizada al 1-abr-2026") para
   todo el bloque.
5. **Si existe ya un archivo de datos abiertos específico para el 49 Bis** (equivalente a los CSV del
   69-B). Al 27-jul-2026 el mecanismo es tan nuevo (primera publicación: 10-jul-2026) que lo único
   encontrado son los oficios individuales publicados en el DOF, no un archivo consolidado descargable
   como el del 69-B — habría que revisar el propio minisitio de datos abiertos en las próximas
   semanas para confirmar si el SAT lo agrega.
6. **Si la CNSF tiene, en alguna parte de su sitio no explorada en esta investigación (fuera de RECAS
   y de "Datos Abiertos" de sanciones), un servicio de consulta de vigencia de una póliza individual
   por número de póliza.** Lo que se revisó (RECAS, Datos Abiertos de sanciones y de registro de
   productos) no lo tiene; no se descarta que exista algo más especializado, orientado a
   aseguradoras o intermediarios, fuera del alcance público general.
7. **El costo y la fricción reales de dar de alta el número de licencia y expediente médico de cada
   operador para usar la consulta puntual del §3.5** — no se probó el flujo completo por el CAPTCHA.

---

## Fuentes

### SAT — listas y consultas públicas

- Datos abiertos SAT — Contribuyentes publicados (Art. 69, 69-B, 69-B Bis, CSD sin efectos), consultado 27-jul-2026: https://www.sat.gob.mx/minisitio/DatosAbiertos/contribuyentes_publicados.html
- Consulta la relación de contribuyentes con operaciones presuntamente inexistentes (69-B): https://wwwmat.sat.gob.mx/consultas/76674/consulta-la-relacion-de-contribuyentes-con-operaciones-presuntamente-inexistentes
- Consulta la relación de contribuyentes incumplidos y condonados (Art. 69): https://wwwmat.sat.gob.mx/consultas/11981/consulta-la-relacion-de-contribuyentes-incumplidos
- Validación del RFC en línea, de uno hasta cinco mil registros (instructivo oficial, sin necesidad de Contraseña ni e.firma): https://www.sat.gob.mx/cs/Satellite?blobcol=urldata&blobkey=id&blobtable=MungoBlobs&blobwhere=1461175429696&ssbinary=true
- Verifica si estás registrado en el RFC (consulta pública sin autenticación, por RFC o CURP): https://wwwmat.sat.gob.mx/aplicacion/29073/verifica-si-estas-registrado-en-el-rfc
- Obtén la Opinión del cumplimiento de tu empresa (consulta propia, 32-D): https://wwwmat.sat.gob.mx/consultas/20430/consulta-tu-opinion-de-cumplimiento-de-obligaciones-fiscales-para-tu-empresa
- Consulta como tercero autorizado la Opinión del cumplimiento de obligaciones fiscales: https://wwwmat.sat.gob.mx/consultas/92139/consulta-la-opinion-del-cumplimiento-de-obligaciones-fiscales-como-tercero-autorizado
- Obtén como autoridad externa autorizada la Opinión del cumplimiento de obligaciones fiscales: https://wwwmat.sat.gob.mx/consultas/82175/consulta-la-opinion-del-cumplimiento-de-obligaciones-fiscales-como-entidad-externa-autorizada-
- Reimprime tus acuses del RFC y genera tu Constancia de Situación Fiscal con CIF (portal, con Contraseña/e.firma): https://wwwmat.sat.gob.mx/aplicacion/43824/reimprime-tus-acuses-del-rfc

### SICT/DGAF — consultas públicas

- Sistemas de consulta — Dirección General de Autotransporte Federal (lista oficial de herramientas públicas, incluida la de Licencias Federales): https://micrs.sct.gob.mx/index.php/transporte-y-medicina-preventiva/autotransporte-federal/sistemas-de-consulta
- Consulta de Licencias Federales de Conductor — DGAF (formulario público, con CAPTCHA): http://app.sct.gob.mx/ConsultaInfracciones/detalleLicFederal.do

### Seguros — CNSF / CONDUSEF

- Ley de Instituciones de Seguros y de Fianzas, artículo 202 (obligación de registro de contratos de seguro ante la CNSF): https://www.diputados.gob.mx/LeyesBiblio/pdf/LISF.pdf
- CONDUSEF — RECAS, Registro de Contratos de Adhesión de Seguros (modelos de contrato, no pólizas individuales): https://phpapps.condusef.gob.mx/recas/
- CNSF — Transparencia / Datos Abiertos (sanciones a aseguradoras, estadística del sector, no pólizas individuales): https://www.cnsf.gob.mx/Transparencia/Paginas/DatosAbiertos.aspx
- SCJN, Amparo Directo en Revisión 839/2023 (aplicación práctica del art. 202 LISF: efecto de un registro tardío de póliza en la cobertura frente a un tercero): https://juristeca.com/mx/scjn/amparo-directo-en-revision/2025/7/amparo-directo-en-revision-839-2023

### El 49 Bis — primera aplicación práctica (jul-2026)

- IDC, "Primera lista SAT de CFDI falsos: Receptores deben corregirse" (14-jul-2026): https://idconline.mx/fiscal-contable/2026/07/14/primera-lista-sat-de-cfdi-falsos-receptores-deben-corregirse
- AMCP, "SAT publica nuevos contribuyentes que no desvirtuaron la presunción de falsedad de CFDI conforme al artículo 49 Bis del CFF" (13-jul-2026): https://amcpdf.org.mx/sat-publica-nuevos-contribuyentes-que-no-desvirtuaron-la-presuncion-de-falsedad-de-cfdi-conforme-al-articulo-49-bis-del-cff/
- efosmx, "Hoy se enlistaron a 3 contribuyentes en las listas del 49 Bis del CFF" (10-jul-2026): https://www.efos.mx/2026/07/10/hoy-se-enlistaron-a-3-contirbuyentes-en-las-listas-del-49-bis-del-cff/
- Blog Aduanero (Consorcio Jurídico Aduanero), "SAT publica contribuyente cuyos CFDI se consideran falsos con efectos generales": https://blog.cjaduanero.com/sat-publica-contribuyente-cuyos-cfdi-se-consideran-falsos-con-efectos-generales-implicaciones-para-quienes-recibieron-facturas/
- El Contribuyente, "SAT estrena las 'auditorías exprés': publica primeros contribuyentes con facturas falsas" (13-jul-2026): https://www.elcontribuyente.mx/2026/07/sat-estrena-las-auditorias-expres-publica-primeros-contribuyentes-con-facturas-falsas/
- Infobae, "Visitas domiciliarias del SAT: qué contribuyentes están en la mira..." (23-jul-2026, contexto del 49 Bis y módulos itinerantes de regularización de RFC/e.firma/CSF): https://www.infobae.com/mexico/2026/07/23/visitas-domiciliarias-del-sat-que-contribuyentes-estan-en-la-mira-que-buscan-y-que-hacer-si-llegan/
- SDV, oficio DOF 24-jul-2026 (listado global adicional del Art. 69-B, primer párrafo): https://sdv.com.mx/dof/5794667/

### Secundarias (pista, no fundamento — usadas solo para triangular plazos y periodicidad)

- CRiskCo, "Integración API SAT México: CIEC, endpoints y monitoreo" (práctica de mercado de extracción con CIEC de terceros; NO es el modelo que Likida debe seguir, ver `11-datos-personales.md`): https://criskco.com/integracion-sat-api
- TramitaMex, "Opinión de cumplimiento del SAT (32-D): cómo obtenerla gratis" (17-jun-2026): https://tramitamex.com.mx/opinion-de-cumplimiento/
- DMG Consultores, "¿Cómo obtengo la 32-D u Opinión de cumplimiento?": https://dmgconsultores.mx/como-obtengo-la-32-d-u-opinion-de-cumplimiento/
- Nuvvo/MiFiscal, "Articulo 69-B SAT - Lista negra EFOS 2026" (periodicidad estimada de actualización, 2-4 semanas): https://fiscal.nuvvo.org/que-es-69b
- Incumplidos MX, "Lista 69-B del SAT" (periodicidad estimada, ~10 días, y tamaño de la base ~502,000 registros): https://incumplidos.mx/lista-69b-sat.html
- Cocapws, "Cómo validar el código QR de la constancia de situación fiscal": https://www.cocapws.com/validar-el-codigo-qr-de-la-constancia-de-situacion-fiscal/
- MCI Consultoría, "Cómo usar el código QR de tu Constancia Fiscal": https://www.mciconsultoria.mx/post/codigo-qr-constancia-situacion-fiscal-actualizada
- Siempre Contable, "Constancia de Situación Fiscal 2026: cómo sacarla con y sin cita" (04-jun-2026; fuente de la afirmación "ya no es obligatorio entregarla para facturar"): https://www.siemprecontable.net/blog/constancia-situacion-fiscal
- La Verdad Noticias, "Buscador de RFC del SAT: cómo usarlo y para qué sirve" (extensión de terceros que automatiza CAPTCHA — citada solo como advertencia de práctica de mercado a no imitar): https://laverdadnoticias.com/dinero-inteligente/finanzas-personales/buscador-de-rfc-del-sat-como-uso
- Alternativo.mx, "Registro Federal de Contribuyentes, ¿cómo saber estatus ante el SAT?" (16-ene-2026): https://alternativo.mx/registro-federal-de-contribuyentes/

### Internas (ola 1 y ola 2, ya citadas por número en el cuerpo del documento)

- `01-cfdi-cff.md` §2.3, §4.2, §9.1, §9.3 — cancelación de CFDI, buzón tributario, web service de validación.
- `05-hidrocarburos.md` — L_CNE y padrón de permisos de hidrocarburos (no repetido aquí).
- `07-no-fiscal.md` §2, §3, §4, §5, §6 — permiso SICT, licencia federal, seguros, verificaciones.
- `08-competencia.md`, `09-liquidacion.md` — padrón de emisores de monederos de combustible.
- `10-contradicciones.md` §12.2 — verificación negativa sobre el permiso SICT.
- `11-datos-personales.md` §4 — el candado de CAPTCHA y la decisión de no usar bóveda de credenciales.
- `21-guardarrailes.md` — contexto del 32-D en el dictamen fiscal (RCFF art. 52).
- `23-actualizacion.md` — el índice de citas vivas para normas, del que este documento es hermano (para entidades).
