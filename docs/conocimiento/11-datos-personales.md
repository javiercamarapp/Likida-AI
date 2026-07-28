# Protección de datos y custodia de credenciales

> Investigado el 27-jul-2026 para Likida.ai. Fundamentos citados. Lo no verificado va marcado.

---

## Resumen para el fundador

México cambió de ley de datos personales el 21 de marzo de 2025. La ley vieja de 2010 está abrogada; la nueva no es una reforma, es una ley distinta con numeración distinta. El INAI desapareció y quien vigila, verifica y multa hoy es la **Secretaría Anticorrupción y Buen Gobierno**, una dependencia del Ejecutivo, no un órgano autónomo.

Tres cosas te pegan directo:

1. **Se acabó el comodín de las "finalidades análogas o compatibles".** Antes podías argumentar que mejorar tu producto con los datos del cliente era una finalidad "análoga" a la contratada. La nueva ley borró esas dos palabras. Hoy cualquier finalidad distinta a la del aviso de privacidad requiere consentimiento **nuevo**. Y como los comprobantes de gasto son **datos patrimoniales**, ese consentimiento tiene que ser **expreso**. Traducción: no puedes entrenar ni afinar modelos con los comprobantes de tus clientes salvo que los disocies primero.

2. **El titular de los datos es el operador, no la flota.** La flota es tu cliente y es la responsable; el chofer es el dueño de los datos. Eso significa que quien tiene que recibir el aviso de privacidad y quien puede ejercer derechos ARCO es el chofer, y quien tiene que avisarle si hay una brecha, también. Tu producto necesita una pantalla de aviso de privacidad en el primer mensaje de WhatsApp de cada operador, no un PDF en el footer de tu landing.

3. **Guardar la e.firma o la Contraseña del SAT de un cliente es la decisión más cara que puedes tomar.** La Contraseña del SAT sustituye la firma autógrafa (RMF regla 2.2.1) y la e.firma también (CFF art. 17-D). El titular es responsable de las consecuencias jurídicas de no cuidarlas (CFF art. 17-J). Si te las guardas y te hackean, además de la multa administrativa hay un tipo penal de 3 meses a 3 años hecho a la medida (LFPDPPP art. 62). La buena noticia: para **validar** un CFDI no necesitas ninguna credencial — el servicio del SAT es público.

Sobre el resto: no hay reglamento nuevo (el de 2011 sigue siendo lo único que hay y aplica en lo que no contradiga la ley), y en enero de 2026 la Secretaría abrió un proceso para volver a reformar la ley. Los portales de autofacturación son un mosaico: los grandes de casetas y gasolina **no** prohíben el acceso automatizado; los PACs y plataformas de facturación **sí**, y algunos explícitamente.

---

## 1. Qué pasó el 21 de marzo de 2025

El **20 de marzo de 2025** se publicó en el DOF (edición vespertina) el Decreto por el que se expiden la Ley General de Transparencia y Acceso a la Información Pública; la Ley General de Protección de Datos Personales en Posesión de Sujetos Obligados; **la Ley Federal de Protección de Datos Personales en Posesión de los Particulares**; y se reforma el artículo 37, fracción XV, de la Ley Orgánica de la Administración Pública Federal.

- **Entrada en vigor:** al día siguiente de su publicación, es decir el **21 de marzo de 2025** (Transitorio Primero del Decreto).
- **Abrogación:** el Transitorio Segundo, fracción I, abroga expresamente *"La Ley Federal de Protección de Datos Personales en Posesión de los Particulares, publicada en el Diario Oficial de la Federación el 5 de julio de 2010"*.
- **Última reforma a la nueva ley:** DOF **14-11-2025**, que reformó **únicamente el artículo 4** (supletoriedad: ahora aplican el Código Nacional de Procedimientos Civiles y Familiares y la Ley Federal de Procedimiento Administrativo, en lugar del Código Federal de Procedimientos Civiles). Es un cambio procesal, no sustantivo. Su aplicación está atada a las declaratorias de aplicación gradual del CNPCyF, con entrada automática el **1 de abril de 2027** si no se emiten antes.

**Verificado.** Texto vigente descargado el 27-jul-2026 de `diputados.gob.mx/LeyesBiblio/pdf/LFPDPPP.pdf` (encabezado: "Nueva Ley publicada en el Diario Oficial de la Federación el 20 de marzo de 2025 / TEXTO VIGENTE / Última reforma publicada DOF 14-11-2025").

### No es una reforma, es otra ley

La numeración cambió por completo. Si tu abogado, tu plantilla de aviso de privacidad o cualquier blog te cita "el artículo 16 de la LFPDPPP" para el contenido del aviso, o "el artículo 37" para las excepciones a transferencia, **está citando la ley abrogada**. Tabla de equivalencias de lo que te importa:

| Tema | Ley 2010 (abrogada) | Ley 2025 (vigente) |
|---|---|---|
| Consentimiento; datos financieros y patrimoniales | art. 8 | **art. 7** |
| Consentimiento para datos sensibles | art. 9 | **art. 8** |
| Excepciones al consentimiento | art. 10 | **art. 9** |
| Limitación de finalidades | art. 12 | **art. 11** |
| Contenido del aviso de privacidad | art. 16 | **art. 15** |
| Puesta a disposición del aviso | art. 17 | **art. 16** |
| Deber de seguridad | art. 19 | **art. 18** |
| Aviso de vulneraciones | art. 20 | **art. 19** |
| Confidencialidad | art. 21 | **art. 20** |
| Plazos ARCO | art. 32 | **art. 31** |
| Transferencias | art. 36 | **art. 35** |
| Excepciones a transferencia | art. 37 | **art. 36** |
| Infracciones / sanciones | arts. 63-64 | **arts. 58-59** |
| Delitos | arts. 67-69 | **arts. 62-64** |

---

## 2. Quién manda ahora: la Secretaría Anticorrupción y Buen Gobierno

El artículo 2, fracción XV de la nueva ley define, sin rodeos: *"**Secretaría**: Secretaría Anticorrupción y Buen Gobierno"*. La palabra "Instituto" ya no aparece en el articulado.

**Atribuciones (art. 39):** vigilar y verificar el cumplimiento; interpretar la ley en el ámbito administrativo; dar apoyo técnico a los responsables que lo pidan; emitir criterios y recomendaciones; divulgar estándares y mejores prácticas de seguridad de la información; **conocer y resolver los procedimientos de protección de derechos y de verificación e imponer las sanciones**; cooperar con autoridades nacionales e internacionales; y elaborar estudios de impacto sobre la privacidad previos a nuevas modalidades de tratamiento.

**Traspaso (Transitorios del Decreto):**
- Transitorio **Cuarto**: toda mención al INAI en cualquier norma se entiende hecha a los entes públicos que adquieren esas atribuciones.
- Transitorio **Quinto**: los recursos humanos del INAI pasan a la Secretaría.
- Transitorio **Sexto**: los recursos materiales, en 20 días hábiles.
- Transitorio **Octavo**: registros, padrones y sistemas —incluidos los históricos— en 15 días hábiles.
- Transitorio **Décimo**: los procedimientos en materia de **datos personales** iniciados antes se sustancian **ante la Secretaría** conforme a las disposiciones vigentes al momento de su inicio; la defensa legal de los actos del INAI en esta materia la lleva la Secretaría.

**Ojo con la separación de funciones:** transparencia y acceso a la información se fueron a un ente distinto llamado **"Transparencia para el Pueblo"** (Transitorio Noveno). Datos personales de particulares se quedó en la **Secretaría Anticorrupción y Buen Gobierno**. Son dos ventanillas distintas.

**Impugnación (art. 51):** contra las resoluciones de la Secretaría procede **juicio de amparo**, sustanciado por jueces y tribunales **especializados** (art. 94 constitucional). El Transitorio Vigésimo ordenó al Poder Judicial habilitar juzgados de Distrito y tribunales Colegiados especializados en acceso a la información y protección de datos personales en 120 días naturales.

**Lo que esto significa en la práctica:** el regulador ya no es un órgano autónomo con criterio consolidado de 14 años, sino una secretaría de Estado que apenas está construyendo su práctica en el sector privado. Hay menos criterios publicados, menos predictibilidad y —por ahora— menos actividad sancionadora visible. Eso no es un permiso; es un riesgo diferido.

### La reforma que viene

El **28 de enero de 2026** (Día Internacional de la Protección de Datos), la Secretaría arrancó formalmente un proceso para actualizar la LFPDPPP, con un foro de diálogo nacional en la Ciudad de México. La hoja de ruta presentada por José Vicente Peredo Vázquez contempla **privacidad por diseño y por defecto, evaluaciones de impacto, la figura del Data Protection Officer (DPO)** y herramientas reforzadas de supervisión.

**Fuente:** nota de Infobae del 29-ene-2026 (medio, no fuente primaria). No encontré el comunicado oficial de la Secretaría — **ver SIN VERIFICAR**.

**Para Likida:** si vas a construir gobierno de datos, constrúyelo ya con DPO nombrado, evaluación de impacto y privacidad por diseño. Es hacia donde va la regulación y hoy ya te sirve como argumento de venta ante un contralor.

---

## 3. El agujero del Reglamento

**El Reglamento vigente sigue siendo el del 21 de diciembre de 2011**, expedido bajo la ley abrogada. No hay reglamento nuevo a julio de 2026.

Datos duros:
- El Transitorio **Décimo Segundo** del Decreto ordenó al Ejecutivo expedir *"las adecuaciones correspondientes a los reglamentos y demás disposiciones aplicables"* dentro de los **noventa días naturales** siguientes a la entrada en vigor. Ese plazo venció el **19 de junio de 2025**.
- El Transitorio Segundo, que lista lo que se abroga, **no incluye el Reglamento**.
- La nueva ley **presupone que el Reglamento existe**: lo define en el art. 2 fr. XIII y lo invoca en los arts. 17 (medidas compensatorias), 40 (procedimiento de protección de derechos), 41 (acreditación de identidad), 49 (conciliación), 55 (verificación) y 57 (imposición de sanciones).
- La Cámara de Diputados sigue publicando el Reglamento de 2011 marcado como **"TEXTO VIGENTE"** (consultado el 27-jul-2026).

**Lectura (razonamiento propio, no un pronunciamiento de autoridad):** el Reglamento de 2011 subsiste y aplica en todo lo que no contradiga la nueva ley. Pero su aplicación mecánica es imposible en varios puntos porque **remite a artículos que ya no existen con ese número**. Ejemplo concreto: el art. 26 del Reglamento dice que el aviso de privacidad debe contener los elementos *"de los artículos 8, 15, 16, 33 y 36 de la Ley"* — esos son números de la ley abrogada. Igual el art. 68 del Reglamento remite al "art. 37 de la Ley" para excepciones a transferencia, que hoy es el 36.

**Consecuencia práctica para Likida:** cuando cites fundamento ante un contralor o en tu aviso de privacidad, **cita primero la ley 2025** y usa el Reglamento 2011 solo para el detalle operativo que la ley no cubre (cómputo en la nube, encargado, remisiones, subcontratación, medidas de seguridad). Y di explícitamente en tu documentación que lo aplicas "en lo que no se opone a la Ley vigente". Eso te protege y te hace ver serio.

**Los Lineamientos del Aviso de Privacidad (DOF 17-ene-2013)** también siguen publicados y son la fuente de las tres modalidades de aviso (integral, simplificado y corto). Su vigencia bajo la nueva ley es dudosa porque el art. 16 de la ley 2025 ya define la modalidad simplificada por sí mismo. **Ver SIN VERIFICAR.**

---

## 4. Consentimiento: qué cambió y qué no

### 4.1 Los datos financieros y patrimoniales SIEMPRE requirieron consentimiento expreso

Esto es importante porque es un mito muy repetido en los blogs de despachos: **no es una novedad de 2025.**

Ley abrogada, **art. 8, párrafo cuarto** (DOF 05-jul-2010, texto literal):

> "Los datos financieros o patrimoniales requerirán el consentimiento expreso de su titular, salvo las excepciones a que se refieren los artículos 10 y 37 de la presente Ley."

Ley vigente, **art. 7, párrafo quinto** (DOF 20-mar-2025, texto literal):

> "Los datos financieros o patrimoniales requerirán el consentimiento expreso de la persona titular, salvo las excepciones a que se refieren los artículos 9 y 36 de la presente Ley."

Es la misma regla con la numeración actualizada. **Verificado contra ambos textos originales.**

Lo que **sí** cambió en materia de consentimiento:

| Punto | Ley 2010 | Ley 2025 |
|---|---|---|
| Definición de consentimiento | no definida en la ley (estaba en el Reglamento art. 12) | **art. 2 fr. IV**: "Manifestación de la voluntad **libre, específica e informada**" — elevada a rango de ley |
| Regla general del consentimiento tácito | estaba en el Reglamento art. 13 | **art. 7 párrafo cuarto**: "Por regla general será válido el consentimiento tácito, salvo que las disposiciones jurídicas aplicables exijan que la voluntad de la persona titular se manifieste expresamente" — elevada a rango de ley |
| Formas del consentimiento expreso | "verbalmente, por escrito, por medios electrónicos, ópticos o por cualquier otra tecnología, o por signos inequívocos" | **art. 7 párrafo segundo**: "verbalmente, por escrito, por medios electrónicos, ópticos, **signos inequívocos** o por cualquier otra tecnología" — igual en sustancia |

**Qué es un dato financiero o patrimonial.** La ley no lo define. El criterio consolidado del INAI (y el uso común) incluye: cuentas bancarias, tarjetas, ingresos, egresos, deudas, bienes, historial de gastos. **Un comprobante de diésel, caseta o viático de un operador identificado es un dato patrimonial de esa persona física.** No es opinable: revela cuánto gastó, dónde, cuándo y con qué medio de pago.

**Qué NO es.** Los datos financieros y patrimoniales **no son datos sensibles**. El art. 2 fr. VI define sensibles como los que afectan la esfera más íntima o cuyo uso indebido pueda dar origen a discriminación o riesgo grave: origen racial o étnico, salud, información genética, creencias religiosas, filosóficas y morales, opiniones políticas y preferencia sexual. Dato financiero ≠ dato sensible. La diferencia es enorme: los sensibles requieren consentimiento **expreso y por escrito con firma o mecanismo de autenticación** (art. 8) y sus sanciones se duplican (art. 59 fr. IV y art. 64).

> **Nota de campo:** el aviso de privacidad publicado de TeleVía afirma que los datos de tarjeta de crédito "serán tratados como sensibles". Es una decisión voluntaria de esa empresa, no una obligación legal. No copies ese criterio: si declaras algo como sensible te autoimpones el régimen de firma escrita del art. 8.

### 4.2 El fin de las "finalidades análogas o compatibles" — esto sí es nuevo, y es lo que más te pega

Ley abrogada, **art. 12** (texto literal del DOF 05-jul-2010):

> "El tratamiento de datos personales deberá limitarse al cumplimiento de las finalidades previstas en el aviso de privacidad. Si el responsable pretende tratar los datos para un fin distinto **que no resulte compatible o análogo** a los fines establecidos en aviso de privacidad, se requerirá obtener nuevamente el consentimiento del titular."

Ley vigente, **art. 11** (texto literal del DOF 20-mar-2025):

> "El tratamiento de datos personales deberá limitarse al cumplimiento de las finalidades previstas en el aviso de privacidad, sin embargo, si el responsable pretende tratar los datos para **una finalidad distinta a las establecidas en el aviso de privacidad**, se requerirá obtener nuevamente el consentimiento de la persona titular."

**Verificado por búsqueda de texto:** las palabras "análog" y "compatible" **no aparecen ni una sola vez** en el articulado de la ley vigente.

**Qué se murió con esas dos palabras.** Bajo la ley vieja, el argumento estándar de cualquier SaaS era: "usar los datos para mejorar el servicio es una finalidad análoga a prestarlo". Ese argumento ya no existe. Hoy el test es binario: **o la finalidad está escrita en el aviso, o necesitas consentimiento nuevo.**

**Aplicado a Likida, sin adornos:**

| Uso | ¿Está en el aviso? | Veredicto |
|---|---|---|
| Validar el comprobante contra el SAT y cuadrarlo por viaje | sí, es la finalidad primaria | OK |
| Generar la liquidación y entregarla al contralor | sí | OK |
| Detectar duplicados y comprobantes apócrifos para ese cliente | sí, si lo escribes | OK |
| **Entrenar o afinar un modelo con los comprobantes** | no es finalidad análoga a nada | **requiere consentimiento EXPRESO del operador**, o disociación previa |
| **Benchmarks de industria ("el diésel promedio por km en México es X")** | finalidad estadística distinta | **requiere disociación previa** (art. 9 fr. III) |
| Mostrar el gasto de un operador a otro cliente | ninguna | prohibido |

**El camino limpio es la disociación.** El art. 9 fr. III exime del consentimiento cuando *"Los datos personales se sometan a un procedimiento previo de disociación"*, y el art. 2 fr. IX la define como el procedimiento mediante el cual los datos *"no pueden asociarse a la persona titular ni permitir, por su estructura, contenido o grado de desagregación, la identificación de la misma"*. La barra es alta: quitar el nombre no basta si la placa, la ruta y la hora reconstruyen al chofer. Si quieres entrenar o publicar benchmarks, necesitas un pipeline de disociación **documentado y auditable**, no un `DROP COLUMN nombre`.

### 4.3 La excepción que sostiene la operación diaria

El art. 9 fr. IV exime de recabar consentimiento cuando *"Los datos personales se requieran para ejercer un derecho o cumplir obligaciones derivadas de una relación jurídica entre la persona titular y el responsable"*. Y el art. 36 fr. VII permite transferir sin consentimiento cuando *"la transferencia sea precisa para el mantenimiento o cumplimiento de una relación jurídica entre el responsable y la persona titular"*.

**Cuidado con quién es quién.** La relación jurídica del operador es **con la flota** (contrato de trabajo o de prestación de servicios), no contigo. Entonces:

- La **flota** puede tratar los datos de liquidación de sus choferes sin pedirles consentimiento, apoyada en el art. 9 fr. IV. Es la relación laboral la que lo justifica.
- **Likida no puede invocar esa excepción para finalidades propias.** Tú actúas por cuenta de la flota. Todo lo que hagas fuera de sus instrucciones te convierte en responsable por derecho propio (Reglamento art. 53) y te deja sin base de licitud.

Esto no te exime del **deber de informar**: la excepción es al consentimiento, no al aviso de privacidad. El aviso se pone a disposición siempre.

---

## 5. El aviso de privacidad hoy: qué debe decir, literalmente

### 5.1 Contenido mínimo — art. 15 de la Ley

> "**Artículo 15.** El aviso de privacidad deberá contener, al menos, la siguiente información:
> I. La identidad y domicilio del responsable;
> II. Los datos personales que serán sometidos a tratamiento, identificando aquéllos que son sensibles;
> III. Las finalidades del tratamiento de datos personales, distinguiendo aquéllas que requieren el consentimiento de la persona titular;
> IV. Las opciones y medios que el responsable ofrezca a las personas titulares para limitar el uso o divulgación de los datos;
> V. Los mecanismos, medios y procedimientos para ejercer los derechos ARCO, de conformidad con lo dispuesto en esta Ley, y
> VI. El procedimiento y medio por el cual el responsable comunicará a las personas titulares de cambios al aviso de privacidad, de conformidad con lo previsto en esta Ley."

**Dos fracciones son nuevas respecto de 2010 y las dos te obligan a rehacer tu plantilla:**

- **Fr. II es nueva.** La ley vieja (art. 16) no exigía enumerar los datos tratados; solo pedía advertir, en un párrafo final, cuando hubiera sensibles. Hoy tienes que **listar el catálogo de datos**. Para Likida eso significa escribir, de verdad: nombre del operador, número de empleado, teléfono de WhatsApp, RFC si aplica, imágenes de comprobantes, importes, fecha y hora, plaza de cobro o estación de servicio, kilometraje declarado, número económico de la unidad, geolocalización si la capturas.
- **Fr. III es más exigente.** Ya no basta con listar finalidades: hay que **distinguir cuáles requieren consentimiento**. Es decir, tu aviso debe separar visualmente "finalidades necesarias para la liquidación" de "finalidades que puedes rechazar" y dar el mecanismo para rechazarlas.

**Una fracción desapareció, pero la obligación no.** La ley vieja pedía en el art. 16 fr. V informar *"En su caso, las transferencias de datos que se efectúen"*. La nueva no la lista en el art. 15 — pero el **art. 35** ordena que el aviso *"contendrá una cláusula en la que se indique si la persona titular acepta o no la transferencia de sus datos"*. Conclusión: **sí tienes que poner las transferencias en el aviso, y además con una casilla de aceptar/rechazar.** No lo saques por el atajo de que ya no está en el art. 15.

### 5.2 Cómo se pone a disposición — art. 16, y por qué WhatsApp importa

> "**Artículo 16.** El responsable debe poner a disposición de las personas titulares el aviso de privacidad, a través de formatos impresos, digitales, visuales, sonoros o cualquier otra tecnología de la siguiente manera:
> I. Cuando los datos personales sean obtenidos personalmente a través de formatos impresos, deberá ser dado a conocer en ese momento, salvo que se hubiera facilitado el aviso con anterioridad, y
> II. Cuando los datos personales sean obtenidos por cualquier medio electrónico, óptico, sonoro, visual, o a través de cualquier otra tecnología, deberá ser proporcionado **en su modalidad simplificada** la que deberá contener al menos la información a que se refieren las **fracciones I a IV del artículo anterior**, y señalar el sitio donde se podrá consultar el aviso de privacidad integral."

**Esto es una obligación de producto, no de legal.** El operador manda una foto por WhatsApp: eso es obtención por medio electrónico. Por lo tanto, **antes o al momento de la primera captura**, el bot debe entregar un aviso simplificado que contenga:

1. quién es el responsable y su domicilio (la **flota**, con Likida identificada como persona encargada);
2. los datos que se van a tratar;
3. las finalidades, separando las que requieren consentimiento;
4. cómo limitar el uso o divulgación;
5. la liga al aviso integral.

Y debes poder **probar** que lo entregaste. El Reglamento art. 31 es tajante: *"Para efectos de demostrar la puesta a disposición del aviso de privacidad en cumplimiento del principio de información, la carga de la prueba recaerá, en todos los casos, en el responsable."* Igual el art. 20 del Reglamento para el consentimiento. **Build requirement: log inmutable con timestamp del mensaje de aviso enviado a cada número, versión del aviso, y del acuse de lectura o respuesta.**

### 5.3 Otras características exigibles

- **Legibilidad (Reglamento art. 24):** *"sencillo, con información necesaria, expresado en lenguaje claro y comprensible, y con una estructura y diseño que facilite su entendimiento."* Un aviso de 4,000 palabras en un mensaje de WhatsApp incumple esto en la práctica aunque tenga todos los elementos.
- **Revocación (art. 7, último párrafo):** el aviso debe establecer los mecanismos y procedimientos para revocar el consentimiento. El Reglamento art. 21 añade que deben ser **sencillos y gratuitos** y permitir revocar **al menos por el mismo medio por el que se otorgó**. Si el consentimiento se dio por WhatsApp, tiene que poder revocarse por WhatsApp.
- **Datos obtenidos indirectamente (art. 17):** cuando los datos no vienen del titular —por ejemplo, la flota te carga el padrón de operadores por CSV— debes darle a conocer el aviso. El Reglamento art. 29 fr. I dice que se hace **en el primer contacto** que se tenga con el titular.
- **Designar responsable interno (art. 29):** *"Todo responsable fomentará la protección de datos personales al interior de la organización y designará a una persona, o departamento de datos personales, quien dará trámite a las solicitudes."* Nombra a alguien y publica su correo.

### 5.4 Checklist del aviso de privacidad de Likida

| # | Elemento | Fundamento | Dónde vive |
|---|---|---|---|
| 1 | Identidad y domicilio del responsable (la flota) y de la persona encargada (Likida) | art. 15 fr. I | Simplificado + Integral |
| 2 | Catálogo de datos tratados, marcando sensibles si los hay | art. 15 fr. II | Simplificado + Integral |
| 3 | Finalidades, separando necesarias de las que requieren consentimiento | art. 15 fr. III | Simplificado + Integral |
| 4 | Opciones y medios para limitar uso o divulgación | art. 15 fr. IV | Simplificado + Integral |
| 5 | Mecanismos y procedimiento ARCO | art. 15 fr. V | Integral |
| 6 | Cómo se comunicarán cambios al aviso | art. 15 fr. VI | Integral |
| 7 | Cláusula de aceptación o rechazo de transferencias | art. 35 | Integral |
| 8 | Mecanismo de revocación del consentimiento | art. 7 último párrafo; Regl. art. 21 | Integral |
| 9 | Liga al aviso integral desde el simplificado | art. 16 fr. II | Simplificado |
| 10 | Datos de contacto de la persona o departamento de datos personales | art. 29 | Integral |
| 11 | Advertencia sobre tratamiento automatizado y derecho de oposición | art. 26 fr. II | Integral (ver §6) |

---

## 6. El derecho nuevo que nadie está mirando: oposición al tratamiento automatizado

Éste es el cambio más relevante para un producto de IA y casi nadie lo está comentando.

Ley abrogada, art. 27: *"El titular tendrá derecho en todo momento y por causa legítima a oponerse al tratamiento de sus datos..."* — una sola causal, genérica.

Ley vigente, **art. 26**:

> "La persona titular tendrá derecho en todo momento y por causa legítima a oponerse al tratamiento de sus datos o exigir que se cese en el mismo cuando:
> I. Exista causa legítima y su situación específica así lo requiera [...], o
> **II. Sus datos personales sean objeto de un tratamiento automatizado, el cual le produzca efectos jurídicos no deseados o afecte de manera significativa sus intereses, derechos o libertades, y estén destinados a evaluar, sin intervención humana, determinados aspectos personales de la misma o analizar o predecir, en particular, su rendimiento profesional, situación económica, estado de salud, preferencias sexuales, fiabilidad o comportamiento.**
>
> No procederá el ejercicio del derecho de oposición en aquellos casos en los que el tratamiento sea necesario para el cumplimiento de una obligación legal impuesta al responsable."

**Léelo con Likida en la mano.** Un sistema que, sin intervención humana, decide que un comprobante de un operador es **inválido**, **duplicado** o **fuera de política** está:

- evaluando aspectos personales **sin intervención humana**: sí;
- produciendo un efecto que afecta significativamente sus intereses: sí, si de ahí se sigue que no le reembolsan o le descuentan;
- analizando su **"fiabilidad o comportamiento"** y su **"situación económica"**: literalmente, sí. Detectar comprobantes chuecos es un scoring de fiabilidad.

**Lo que hay que construir, no negociar:**

1. **Un humano en el loop para las decisiones adversas.** Que el sistema marque, priorice y explique — pero que el rechazo con consecuencia económica lo confirme una persona (el contralor). Si hay intervención humana real, la fracción II no se activa.
2. **Un mecanismo de oposición** documentado en el aviso y accesible desde WhatsApp.
3. **Trazabilidad de la decisión**: por qué se marcó ese comprobante, con qué regla o qué señal del modelo. Sin esto no puedes responder una solicitud de oposición ni defenderte en una verificación.
4. **No lo vendas como "el sistema decide".** Véndelo como "el sistema prepara y el contralor decide". Es mejor legalmente y además es mejor producto.

---

## 7. Quién es quién: responsable, persona encargada, transferencia y remisión

### Las figuras

| Figura | Definición | Fundamento |
|---|---|---|
| **Responsable / sujeto regulado** | Personas físicas o morales de carácter privado que llevan a cabo el tratamiento | art. 2 fr. XIV y XVI |
| **Persona encargada** | *"Persona física o jurídica que sola o conjuntamente con otras trate datos personales **por cuenta del responsable**"* | art. 2 fr. XII |
| **Tercero** | Persona distinta de la titular o del responsable | art. 2 fr. XVII |
| **Transferencia** | *"Toda comunicación de datos personales **dentro o fuera del territorio mexicano**, realizada a persona distinta de la titular, del responsable **o de la persona encargada** del tratamiento"* | art. 2 fr. XX |
| **Remisión** | No existe en la ley 2025. Solo en el **Reglamento art. 53**: *"Las remisiones nacionales e internacionales de datos personales entre un responsable y un encargado **no requerirán ser informadas al titular ni contar con su consentimiento**"* | Regl. art. 53 |

**Verificado:** la palabra "remisión" **no aparece ni una vez** en el texto vigente de la ley. La figura sobrevive solo por el Reglamento de 2011 y por el art. 35 de la ley, que excluye expresamente a la persona encargada del régimen de transferencia (*"a terceros nacionales o extranjeros, **distintos de la persona encargada**"*).

**Esto es la bisagra de todo el análisis del riesgo 1.** Si tu proveedor de IA es **encargado**, mandarle las fotos es una **remisión**: no requiere consentimiento ni cláusula de aceptación. Si es **tercero**, es una **transferencia internacional**: requiere consentimiento expreso (porque son datos patrimoniales) o caer en una excepción del art. 36, y además la cláusula del art. 35.

### El mapa de Likida

```
Operador (TITULAR)
   │  manda foto por WhatsApp
   ▼
Flota / transportista  ──────────── RESPONSABLE
   │  contrata a
   ▼
Likida  ─────────────────────────── PERSONA ENCARGADA (art. 2 fr. XII)
   │  subcontrata (con autorización de la flota, Regl. arts. 54-55)
   ├─► Meta (WhatsApp Cloud API) ─────────── subencargado
   ├─► Supabase (base de datos) ──────────── subencargado
   ├─► Vercel (hosting) ──────────────────── subencargado
   └─► OpenRouter (IA, OCR incluido) ─────── subencargado
         ├─► Google (Gemini)      ─────────── sub-subencargado
         ├─► Anthropic (Claude)   ─────────── sub-subencargado
         └─► OpenAI (solo fallback) ───────── sub-subencargado
```

> **CORREGIDO el 28-jul-2026 (B20).** Este mapa ponía a *"Proveedor de modelo
> (Anthropic / OpenAI)"* como subencargado DIRECTO. El código dice otra cosa:
> Likida contrata con **OpenRouter** y con nadie más para IA
> (`openrouter.ts:24`), y los proveedores de modelo cuelgan de él. Cambia qué se
> puede exigir y a quién: a OpenRouter sí, por contrato; a Google no, porque no
> hay contrato. Cadena completa y verificable en
> `52-anexo-subencargados.md`.

**Likida usa dos sombreros y hay que separarlos en el contrato y en los avisos:**

1. **Encargada** respecto de los datos de los **operadores** (la flota instruye, tú ejecutas).
2. **Responsable** respecto de los datos de sus **propios usuarios** (el contralor, el dueño, quien se registra en tu plataforma, tus leads). Ahí Likida necesita su **propio** aviso de privacidad, con su propio ARCO y su propio departamento de datos personales.

### Obligaciones de la persona encargada — Reglamento art. 50

> "I. Tratar únicamente los datos personales conforme a las instrucciones del responsable;
> II. Abstenerse de tratar los datos personales para finalidades distintas a las instruidas por el responsable;
> III. Implementar las medidas de seguridad conforme a la Ley, el Reglamento y las demás disposiciones aplicables;
> IV. Guardar confidencialidad respecto de los datos personales tratados;
> V. **Suprimir los datos personales objeto de tratamiento una vez cumplida la relación jurídica con el responsable** o por instrucciones del responsable, siempre y cuando no exista una previsión legal que exija la conservación de los datos personales, y
> VI. Abstenerse de transferir los datos personales salvo en el caso de que el responsable así lo determine, la comunicación derive de una subcontratación, o cuando así lo requiera la autoridad competente."

**Y el castigo por salirse del carril (Reglamento art. 53, segundo párrafo):**

> "El encargado, será considerado **responsable** con las obligaciones propias de éste, cuando:
> I. Destine o utilice los datos personales con una finalidad distinta a la autorizada por el responsable, o
> II. Efectúe una transferencia, incumpliendo las instrucciones del responsable."

Traducción: el día que uses los comprobantes de tus clientes para entrenar sin que te lo hayan instruido, **dejas de ser encargado y te conviertes en responsable frente a cada operador de cada flota**, con obligación de aviso, de ARCO y de sanción propia.

### Subcontratación — Reglamento arts. 54 y 55

Art. 54: *"Toda subcontratación de servicios por parte del encargado que implique el tratamiento de datos personales **deberá ser autorizada por el responsable**, y se realizará en nombre y por cuenta de este último."* La carga de acreditar que la subcontratación fue autorizada **corresponde al encargado** — o sea, a ti.

Art. 55: si el contrato con la flota **prevé** que puedes subcontratar, la autorización se entiende otorgada. Si no lo prevé, tienes que pedirla **antes** de cada subcontratación.

**Build requirement:** tu contrato marco con la flota debe traer un **anexo de subencargados** (proveedor de WhatsApp, nube, modelo, OCR, correo transaccional), con autorización expresa para esos y un mecanismo de notificación previa para agregar otros. Es la misma mecánica de un DPA europeo y es exactamente lo que un contralor con auditor externo te va a pedir.

---

## 8. Riesgo 1 — Mandar fotos de comprobantes a un proveedor de IA en el extranjero

### 8.1 Lo primero: ¿remisión o transferencia?

Es remisión (y por tanto no requiere consentimiento ni cláusula) **solo si el proveedor de IA califica como persona encargada**, es decir, si trata los datos **exclusivamente por cuenta tuya y bajo tus instrucciones** (art. 2 fr. XII). El momento en que el proveedor trata los datos para **finalidad propia** —entrenar sus modelos, mejorar su producto, analítica de negocio— deja de ser encargado y pasa a ser tercero, y todo se convierte en **transferencia internacional de datos patrimoniales sin consentimiento expreso**, que es infracción del art. 58 fr. XIII sancionada con **200 a 320,000 UMA** (art. 59 fr. III).

Por eso la cláusula de no-entrenamiento no es un extra de marketing: **es lo que sostiene toda tu base legal.**

### 8.2 El artículo 52 del Reglamento, inciso por inciso

Texto literal (Reglamento de la LFPDPPP, DOF 21-dic-2011, art. 52):

> "Para el tratamiento de datos personales en servicios, aplicaciones e infraestructura en el denominado cómputo en la nube, en los que el responsable **se adhiera a los mismos mediante condiciones o cláusulas generales de contratación**, sólo podrá utilizar aquellos servicios en los que el proveedor:
>
> **I. Cumpla, al menos, con lo siguiente:**
> a) Tener y aplicar políticas de protección de datos personales afines a los principios y deberes aplicables que establece la Ley y el presente Reglamento;
> b) **Transparentar las subcontrataciones** que involucren la información sobre la que se presta el servicio;
> c) **Abstenerse de incluir condiciones en la prestación del servicio que le autoricen o permitan asumir la titularidad o propiedad de la información** sobre la que presta el servicio, y
> d) Guardar confidencialidad respecto de los datos personales sobre los que se preste el servicio, y
>
> **II. Cuente con mecanismos, al menos, para:**
> a) Dar a conocer cambios en sus políticas de privacidad o condiciones del servicio que presta;
> b) **Permitir al responsable limitar el tipo de tratamiento** de los datos personales sobre los que se presta el servicio;
> c) Establecer y mantener medidas de seguridad adecuadas para la protección de los datos personales sobre los que se preste el servicio;
> d) **Garantizar la supresión de los datos personales una vez que haya concluido el servicio** prestado al responsable, y que este último haya podido recuperarlos, y
> e) **Impedir el acceso a los datos personales a personas que no cuenten con privilegios de acceso, o bien en caso de que sea a solicitud fundada y motivada de autoridad competente, informar de ese hecho al responsable.**
>
> **En cualquier caso, el responsable no podrá adherirse a servicios que no garanticen la debida protección de los datos personales.**"

Y define cómputo en la nube como *"el modelo de provisión externa de servicios de cómputo bajo demanda, que implica el suministro de infraestructura, plataforma o software, que se distribuyen de modo flexible, mediante procedimientos de virtualización, en recursos compartidos dinámicamente"* — una API de LLM cabe sin discusión.

**Tres cosas que casi nadie nota de este artículo:**

1. **Aplica precisamente cuando te adhieres a condiciones generales de contratación**, es decir, cuando firmas los Terms of Service de OpenAI o Anthropic con un clic. Ése es el caso normal de un startup. Si negocias un contrato a la medida, el art. 52 sigue siendo la vara pero tienes margen de redactado.
2. **El último párrafo es una prohibición dura, no una recomendación**: "no podrá adherirse a servicios que no garanticen la debida protección". No hay ponderación de costo-beneficio.
3. **El inciso II.e es el más difícil de cumplir con un proveedor estadounidense**, y lo veremos abajo.

### 8.3 Qué es "retención cero" y qué NO es

**"Retención cero" no es un término legal mexicano.** No aparece en la LFPDPPP, ni en el Reglamento, ni en los Lineamientos. Es un término **comercial y técnico** de los proveedores de IA (*Zero Data Retention*, ZDR) que significa: el proveedor no almacena tus prompts ni las respuestas del modelo en reposo después de devolver la respuesta.

Su relevancia legal en México es indirecta pero fuerte: **la retención cero es el mecanismo más limpio para acreditar el inciso II.d del art. 52** ("garantizar la supresión de los datos personales una vez que haya concluido el servicio"). Si no se guarda nada, no hay nada que suprimir.

**Lo que ZDR NO te da, y que la gente asume que sí:**

- **No es lo mismo que "no entrenan con mis datos".** Son dos compromisos separados. Puedes tener no-entrenamiento sin ZDR (es el default comercial de ambos grandes) y en teoría lo contrario.
- **No viene por default.** En los dos grandes proveedores es una configuración que requiere **aprobación previa** del proveedor y se habilita **por organización**.
- **No cubre todos los endpoints.** Los endpoints que por naturaleza guardan estado (archivos, lotes, almacenes vectoriales, asistentes, ejecución de código) **quedan fuera**. Esto es crítico para Likida: si subes la foto del comprobante por una **API de archivos**, estás fuera de ZDR aunque tengas ZDR activo.
- **No es absoluto.** Ambos proveedores se reservan retener datos cuando la ley lo exija o cuando sus sistemas de seguridad marquen el contenido.

#### Anthropic (Claude API) — lo que dice la documentación

- Por defecto: *"we automatically delete inputs and outputs on our backend within 30 days of receipt or generation"* (Privacy Center, retención comercial).
- Entrenamiento: *"By default, we will not use your inputs or outputs from our commercial products to train our models"*; y en los **Commercial Terms**, sección B: *"Anthropic may not train models on Customer Content from Services."*
- Propiedad: *"Anthropic agrees that Customer (a) retains all rights to its Inputs, and (b) owns its Outputs."*
- ZDR: *"Under a ZDR arrangement, Anthropic does not store customer prompts or responses at rest after the API response is returned."* Se habilita **por organización** y requiere gestión con el equipo comercial; no se activa solo.
- Límite explícito: *"Even with ZDR or HIPAA arrangements in place, Anthropic may retain data where required by law or where it has been flagged by Anthropic's automated trust and safety systems. As a result, if a chat or session is flagged, Anthropic may retain inputs and outputs for up to 2 years."*
- Fuera de ZDR: Batch API, Files API y ejecución de código — *"Features marked 'No' for ZDR are fundamentally stateful."*
- Divulgación a autoridad (Commercial Terms, E.3): el receptor puede divulgar información confidencial *"to the extent it is required by law, or court or administrative order, and will, **except where expressly prohibited**, notify Discloser of the required disclosure promptly."*

#### OpenAI (API) — lo que dice la documentación

- Entrenamiento: *"As of March 1, 2023, data sent to the OpenAI API is not used to train or improve OpenAI models (unless you explicitly opt in)."*
- Retención por defecto: **30 días** de logs de monitoreo de abuso para `/v1/chat/completions` y `/v1/responses`.
- ZDR: *"Eligible customers may have their customer content excluded from these abuse monitoring logs [...] by getting approved for the Zero Data Retention or Modified Abuse Monitoring controls. Currently, these controls are **subject to prior approval by OpenAI and acceptance of additional requirements**."*
- No elegibles para ZDR: `/v1/files`, `/v1/batches`, `/v1/vector_stores`, `/v1/assistants`, `/v1/threads`, `/v1/fine_tuning/jobs`, `/v1/videos`, `/v1/conversations` — todos guardan estado "hasta que se borre".

### 8.4 Los proveedores contra el art. 52, casilla por casilla

| Art. 52 | Anthropic (Claude API) | OpenAI (API) | Veredicto |
|---|---|---|---|
| I.a — políticas afines a la Ley | Privacy Center + Trust Center públicos | Enterprise Privacy + docs de datos | Cumple en forma; hay que archivar copia fechada |
| I.b — transparentar subcontrataciones | Publica lista de subprocesadores (**SIN VERIFICAR en esta investigación**) | Publica lista de subprocesadores (**SIN VERIFICAR**) | Verificar antes de firmar |
| I.c — no asumir titularidad | **Cumple explícitamente**: "Customer retains all rights to its Inputs and owns its Outputs" | Términos equivalentes (**SIN VERIFICAR literal**) | Anthropic verificado |
| I.d — confidencialidad | Sección E.2 de Commercial Terms, estándar de cuidado razonable | Compromisos de confidencialidad con proveedores | Cumple |
| II.a — avisar cambios | Sí, vía docs y notificación contractual | Sí | Cumple |
| II.b — permitir limitar el tipo de tratamiento | Sí: elección de endpoints, ZDR, no-training | Sí: controles por proyecto y organización | Cumple **si lo configuras**; no es automático |
| II.c — medidas de seguridad | Trust Center, cifrado en reposo AES-256 | Cifrado, EKM opcional | Cumple |
| II.d — garantizar supresión al concluir | **ZDR lo resuelve**. Sin ZDR: 30 días. Con contenido marcado: hasta **2 años** | **ZDR lo resuelve** en endpoints elegibles. Sin ZDR: 30 días | **Cumple solo con ZDR y solo en endpoints elegibles** |
| II.e — impedir acceso no autorizado **o informar al responsable de un requerimiento de autoridad** | *"except where expressly prohibited, notify Discloser"* | Equivalente (**SIN VERIFICAR literal**) | **Cumplimiento imperfecto** — ver abajo |

**El punto débil real es el II.e.** El Reglamento mexicano exige que el proveedor **informe al responsable** cuando una autoridad competente le pida los datos. Los proveedores estadounidenses comprometen notificar "salvo cuando esté expresamente prohibido" — y en Estados Unidos existen órdenes con mordaza (por ejemplo bajo 18 U.S.C. §2705(b)) que precisamente prohíben notificar. Es decir: **hay un escenario legalmente previsible en el que el proveedor no puede cumplir el inciso II.e.**

Esto no hace ilegal usar el proveedor. Lo que hace es que **el residual tiene que estar declarado**: en tu evaluación de riesgo, en tu contrato con la flota y —si el contralor te pregunta— en la conversación. Un hueco declarado se defiende; un hueco escondido en una verificación es negligencia.

### 8.5 ¿Se puede procesar en México? Lo que encontré

Sí y no, y el detalle importa:

- **AWS tiene región en México desde enero de 2025**: `mx-central-1` (AWS México Central), con tres zonas de disponibilidad, disponibilidad general anunciada el 14-ene-2025. AWS declara que *"los clientes que almacenan contenido en la Región AWS México (Central) tienen la garantía de que su contenido no saldrá de México, a menos que ellos decidan moverlo."*
- **Amazon Bedrock ofrece tres modos de inferencia**: *In-Region* (*"your requests never leave the AWS Region you specify"*), *Geographic/Geo* (dentro de una geografía: US, EU, JP, AU) y *Global Cross-Region* (*"data may be processed in any commercial Region"*).
- **Pero:** consultando la tabla de disponibilidad regional de Bedrock el **27-jul-2026**, en `mx-central-1` los modelos Claude aparecen **únicamente bajo la opción Global**. No hay In-Region ni Geo para México. Y no existe una geografía "LATAM" o "MX" entre las opciones de Geo (solo US, EU, JP, AU).

**Consecuencia arquitectónica:** hoy no puedes correr inferencia de un modelo frontera con residencia garantizada en México. Puedes **almacenar** en México (S3 en `mx-central-1`), pero el momento en que llamas al modelo, la inferencia sale del país por la ruta Global.

**Lo que sí puedes hacer, en orden de menos a más esfuerzo:**

1. **Almacenar en México, inferir afuera con ZDR.** Las imágenes y los XML viven en `mx-central-1`; el prompt sale con retención cero. Reduce mucho la superficie: lo que se transfiere es efímero.
2. **Redactar antes de enviar.** El comprobante fiscal casi nunca necesita el nombre del operador para ser validado. Manda el ticket recortado o con los campos personales enmascarados, y haz el enlace operador↔comprobante en tu base, en México. Esto no es solo higiene: es el principio de proporcionalidad del art. 12 ("necesario, adecuado y relevante").
3. **Extracción local para el 80% del volumen.** Los tickets de caseta y de gasolinera son formatos repetidos. Un OCR corriendo en tu infraestructura resuelve la mayoría y deja el LLM para los casos raros. Menos datos salen, menos costo, menos riesgo.
4. **Fijar geografía cuando la haya.** Si algún día hay In-Region o una geo LATAM para el modelo que uses, actívala aunque cueste más.

### 8.6 Lo que hay que construir para el riesgo 1

- [ ] Elegir proveedor y **negociar ZDR por escrito** antes de tener el primer cliente pagado. No después.
- [ ] **Prohibirse los endpoints no elegibles para ZDR** (archivos, lotes, almacenes vectoriales, asistentes). Que sea un lint en el código, no una nota en Notion.
- [ ] **Redacción/enmascarado antes de la llamada al modelo**, con prueba de que se aplicó.
- [ ] **Almacenamiento primario en `mx-central-1`** (o equivalente en México).
- [ ] **Anexo de subencargados** en el contrato marco con la flota, con autorización expresa (Regl. arts. 54-55).
- [ ] **Evaluación de impacto documentada**: qué datos salen, a dónde, con qué salvaguarda, y el residual del inciso II.e declarado.
- [ ] **Copia fechada** de los términos y políticas del proveedor en cada versión que uses (para acreditar el art. 52 el día de la verificación).
- [ ] **Filtro de datos sensibles colados**: un ticket de farmacia revela salud; uno de comida, posiblemente creencias. El art. 8, párrafo segundo, prohíbe crear bases con sensibles sin justificación. Detecta y excluye.

---

## 9. Riesgo 2 — Guardar credenciales de portales de terceros a nombre del cliente

### 9.1 No todas las credenciales pesan igual

| Credencial | Qué es | Valor jurídico | Riesgo de custodiarla |
|---|---|---|---|
| **e.firma (antes FIEL)** — archivos `.cer` + `.key` + contraseña de clave privada | Firma electrónica avanzada emitida por el SAT | *"sustituirá a la firma autógrafa del firmante, garantizará la integridad del documento y producirá los mismos efectos que las leyes otorgan a los documentos con firma autógrafa, teniendo el mismo valor probatorio"* — **CFF art. 17-D, párrafo tercero** | **Máximo.** Con ella se pueden presentar declaraciones, promociones, y firmar actos jurídicos |
| **Contraseña (antes CIEC)** | Mecanismo de acceso al Portal del SAT | Conforme a la **RMF regla 2.2.1** ("Valor probatorio de la Contraseña"), la Contraseña **sustituye la firma autógrafa** y produce los mismos efectos, con igual valor probatorio | **Muy alto** |
| **CSD (Certificado de Sello Digital)** | Certificado para sellar CFDI | Sello digital previsto en el CFF art. 29 fr. II | **Alto**: permite emitir facturas a nombre del contribuyente |
| **Usuario/contraseña de portal de autofacturación** (PASE, TeleVía, OXXO GAS, PAC) | Credencial contractual privada | Ninguno frente al SAT; sí frente al portal por contrato | **Medio**: riesgo contractual, reputacional y potencialmente penal (ver §10) |

### 9.2 El texto que hay que conocer de memoria

**CFF art. 17-D, párrafo tercero:**
> "En los documentos digitales, una firma electrónica avanzada amparada por un certificado vigente sustituirá a la firma autógrafa del firmante, garantizará la integridad del documento y producirá los mismos efectos que las leyes otorgan a los documentos con firma autógrafa, teniendo el mismo valor probatorio."

**CFF art. 17-J** — obligaciones del titular del certificado:
> "I. **Actuar con diligencia y establecer los medios razonables para evitar la utilización no autorizada de los datos de creación de la firma.**
> II. [...] actuar con diligencia razonable para cerciorarse de que todas las declaraciones que haya hecho en relación con el certificado [...] son exactas.
> III. Solicitar la revocación del certificado ante cualquier circunstancia que pueda poner en riesgo la privacidad de sus datos de creación de firma.
>
> **El titular del certificado será responsable de las consecuencias jurídicas que deriven por no cumplir oportunamente con las obligaciones previstas en el presente artículo.**"

**SAT, "Responsiva para Contraseña"** (Avisos de seguridad, portal del SAT):
> "La Contraseña es un mecanismo de acceso que garantiza la certeza técnica y jurídica de tu identidad cuando accedes a las diversas aplicaciones de tu Portal Personal. [...] **El uso que se haga de ellas es responsabilidad de quien en forma personal haya generado la Contraseña**, por lo que te recomendamos no compartirla o proporcionarla a terceros."

**Lee bien esa última línea.** El SAT **no prohíbe** compartir la Contraseña: recomienda no hacerlo y establece que la responsabilidad es del titular. La consecuencia es doble y hay que decírsela al cliente sin adornos:

1. **Todo lo que se haga con esa credencial se le atribuye legalmente al cliente**, no a Likida. Eso lo protege a él en tu marketing y lo expone a él en la realidad.
2. **Al compartírtela, el cliente incumple su propio deber de diligencia del art. 17-J.** Si algo sale mal, el argumento del SAT no será contra ti sino contra él, y él te va a demandar a ti. Estás construyendo un pasivo contingente en el balance de tu cliente y llamándolo "onboarding".

### 9.3 Los tipos penales que te aplican por custodiar

**LFPDPPP art. 62** (Capítulo XII, Delitos):
> "Se impondrán de **tres meses a tres años de prisión** al que, **estando autorizado para tratar datos personales, con ánimo de lucro, provoque una vulneración de seguridad a las bases de datos bajo su custodia**."

Este tipo penal está escrito exactamente para tu escenario: proveedor autorizado, con ánimo de lucro (cobras suscripción), que sufre una brecha en la bóveda de credenciales. No requiere dolo directo en la brecha: requiere que la "provoque", lo que abre la puerta a una imputación por negligencia grave. **Es la razón número uno para no ser un vault de e.firmas.**

**LFPDPPP art. 63:**
> "Se sancionará con prisión de **seis meses a cinco años** al que, con el fin de alcanzar un lucro indebido, trate datos personales mediante el engaño, aprovechándose del error en que se encuentre la persona titular o la persona autorizada para transmitirlos."

Aplica si tu flujo de onboarding hace creer al cliente que le estás pidiendo menos de lo que le pides. Un botón que dice "conecta tu SAT" y en realidad sube la `.key` es material para este artículo.

**LFPDPPP art. 64:** las penas se **duplican** tratándose de datos sensibles.

### 9.4 Cómo hacerlo defendible, si de verdad lo vas a hacer

Si el producto exige credenciales, éste es el mínimo que un abogado de la contraparte no va a poder romper:

1. **Mandato escrito, específico y limitado.** No "acceso a mi cuenta del SAT" sino: *"autorizo a Likida a utilizar mi e.firma exclusivamente para: (i) el servicio de descarga masiva de CFDI recibidos, y (ii) la consulta del Buzón Tributario. Likida no utilizará la e.firma para firmar declaraciones, promociones, contratos ni para emitir CFDI."* Éste es el patrón que ya usa al menos un competidor mexicano (iAudita, cuyos términos publican precisamente esa redacción: *"nunca utilizará su e.firma para firmar contratos, declaraciones anuales u otros actos jurídicos, ni para emitir CFDIs"*). Es replicable y es buena práctica.
2. **Bóveda con HSM o KMS gestionado, cifrado por cliente.** Llave por tenant. Nunca una llave maestra que abra todo.
3. **Descifrado solo en memoria, en el momento del uso, con TTL.** Ninguna credencial en claro en disco, en logs, en variables de entorno ni en un dump de base.
4. **Bitácora inmutable de cada uso**: qué credencial, para qué operación, a qué hora, qué devolvió. El cliente debe poder verla desde su panel. Es tu prueba y su tranquilidad.
5. **Revocación en un clic y borrado verificable.** Con acuse. El Reglamento art. 50 fr. V te obliga a suprimir al concluir la relación; que sea un botón, no un ticket.
6. **Segregación**: la bóveda no vive en la misma cuenta de nube ni bajo el mismo rol IAM que la aplicación.
7. **Notificación de vulneraciones** contratada de antemano (art. 19 de la Ley; arts. 63-66 del Reglamento).
8. **Rotación y caducidad**: la Contraseña del SAT tiene vigencia de cuatro años; obliga a re-consentimiento periódico.
9. **Seguro de ciberresponsabilidad**. No es cumplimiento, es supervivencia.
10. **Prohibición contractual de uso ajeno al mandato**, con penalización, en tu propio contrato. Firmar contra ti mismo es la señal más creíble que puedes darle a un contralor.

### 9.5 La ruta que evita casi todo el problema

**Para validar un CFDI no necesitas ninguna credencial del cliente.** Éste es el hallazgo más útil de toda esta investigación en términos de producto.

- El SAT expone un **servicio público de verificación de comprobantes** (`verificacfdi.facturaelectronica.sat.gob.mx`) y un **web service SOAP** (`ConsultaCFDIService`) que reciben **UUID + RFC emisor + RFC receptor + total** y devuelven el estatus del comprobante. Sin login, sin contraseña, sin e.firma. La validación es estricta: si cualquiera de los cuatro datos no coincide, el resultado es negativo.
- Las **listas del art. 69-B del CFF** (EFOS definitivos y presuntos) son publicaciones oficiales del SAT, de acceso libre.
- El **XML** puede llegarte por el canal del propio contribuyente: el correo donde el emisor se lo manda, un buzón dedicado, o una carga del cliente. No requiere tu acceso a su cuenta del SAT.

**Sólo la descarga masiva de CFDI requiere la e.firma del contribuyente** (autenticación firmando la petición con la llave privada). Es decir: la credencial de alto riesgo hace falta **para la conveniencia de la descarga masiva, no para la validación**.

**Decisión de producto recomendada:** arranca sin bóveda de credenciales. Valida contra los servicios públicos, cuadra por viaje, y ofrece la descarga masiva como una **integración opcional de nivel superior**, con su propio consentimiento, su propio precio y su propio contrato. Puedes vender "validamos contra el SAT" con total honestidad sin haber tocado una sola e.firma.

**SIN VERIFICAR:** si existe algún mecanismo formal del SAT de "tercero autorizado" para descarga masiva que no implique entregar la e.firma del contribuyente. Algunas fuentes secundarias lo insinúan; no lo confirmé en documentación del SAT ni en la RMF.

---

## 10. Riesgo 3 — ¿Los portales de autofacturación prohíben el acceso automatizado?

### Metodología

Leí los términos y condiciones **reales y publicados** de portales relevantes para una flota (casetas, combustible) y de plataformas de facturación, el 27-jul-2026. No me apoyé en resúmenes de terceros: transcribo lo que dice cada documento.

### Lo que encontré

**Grupo A — Portales de casetas y combustible: NO prohíben el acceso automatizado**

| Portal | Documento leído | Cláusula relevante | ¿Prohíbe automatización? |
|---|---|---|---|
| **PASE** (Pase, Servicios Electrónicos, S.A. de C.V.) — TAG de casetas | "Condiciones y Privacidad" (`pase.com.mx/legales/condiciones-y-privacidad/`) | *"Es propiedad de la empresa Pase [...] la totalidad del contenido de las páginas Web publicadas en el sitio, incluyendo el texto, los signos gráficos, logotipos, íconos, imágenes, fotografías, audio clips y software, por lo que se encuentra **estrictamente prohibida su reproducción o utilización parcial o total, para fines diversos de lo que fue creado**."* Los usuarios registrados obtienen *"una clave de usuario y una contraseña [...] únicos e irrepetibles"* | **No explícitamente.** Solo una prohibición de propiedad intelectual sobre el *contenido* del sitio. No menciona robots, bots, scraping, agentes ni acceso por medios distintos a la interfaz |
| **TeleVía** (Operadora Concesionaria Mexiquense, S.A. de C.V.) — TAG de casetas | "Términos y Condiciones del Servicio de Telepeaje TeleVía" (`televia.com.mx/terminos-y-condiciones-servicio-telepeaje`) | Regula adquisición, activación, recarga, tarifas, aclaraciones y facturación. Obligaciones de uso correcto del Tag (carriles, colocación, un Tag por vehículo) | **No.** Ni una palabra sobre acceso automatizado al portal |
| **OXXO GAS** (Servicios Gasolineros de México / Oxxo Express) — combustible | "Términos y Condiciones Portal Web Vales OXXO GAS" (`clientes.oxxogas.com/terminos-y-condiciones.php`) | *"El correo electrónico y contraseña ingresados como clave de acceso [...] **es a total discreción del usuario y Oxxo Gas se desliga de toda responsabilidad que derive de su manejo**."* La sección de propiedad industrial solo prohíbe *"modificar, alterar o suprimir [...] los avisos, marcas, nombres comerciales, señas, anuncios, logotipos"* | **No.** Y sobre credenciales, en vez de prohibir compartirlas, **se desliga de responsabilidad** por su manejo |

**Grupo B — Plataformas de facturación y PACs: SÍ prohíben, y algunos de forma quirúrgica**

| Plataforma | Cláusula literal | Alcance |
|---|---|---|
| **EdiFactMx** (PAC) | *"Quedas obligado en éste sitio a no utilizar o intentar utilizar cualquier máquina, software, herramienta, **agente** u otro dispositivo o mecanismo (**incluyendo sin limitación navegadores, spiders, robots, avatars o agentes inteligentes**) para navegar o buscar en este Sitio otro que no sea el motivo de búsqueda y agentes de búsqueda disponibles de EL PAC en este sitio y otros navegadores de terceros que generalmente están disponibles."* Además: *"La cuenta es personal, única e **intransferible**."* | Prohibición **expresa y anticipatoria de agentes de IA**. Redactada hace años y aun así cubre exactamente lo que hace un agente autónomo |
| **Facturama** | *"El Usuario acepta **no acceder a El Sitio por cualquier otro medio distinto de la interfaz provista por FACTURAMA**. Cualquier violación a lo aquí establecido será sancionada de conformidad con la legislación aplicable."* | La formulación más limpia posible de una prohibición de automatización |
| **Factura Digital** (Novatech Digital, S.A. de C.V.) | Queda expresamente prohibido: *"Realizar **scraping, extracción masiva de datos u obtención automatizada de información** a través de la Plataforma para fines ajenos a los servicios contratados"*; *"**Compartir credenciales de acceso o API keys con terceros no autorizados**"*; *"ceder, sublicenciar, revender o **transferir la cuenta o credenciales de acceso a terceros** sin autorización previa y por escrito"* | Triple candado: automatización, compartición de credenciales y cesión de cuenta |
| **ioFacturo / Gosocket** | Prohibido *"usar herramientas que le permitan **burlar, inhabilitar o evitar cualesquiera mecanismos de codificación, seguridad o autenticación** creados para la APLICACIÓN WEB"*. Licencia *"no exclusiva, revocable e **intransferible**"* | Alcanza directamente el **bypass de CAPTCHA** y la resolución automatizada de retos de autenticación |
| **PdP (Portal de Pagos)** | Está estrictamente prohibido: *"Utilizar software malicioso o **automatización no autorizada**"* | Prohibición general |
| **iAudita** (TsCancun) | *"Queda prohibido el **acceso automatizado masivo, el scraping** o la extracción sistemática de datos más allá de lo necesario para el servicio autorizado."* Además: *"Cesión prohibida: El Usuario no puede ceder, transferir o sublicenciar su cuenta, credenciales o los derechos bajo estos Términos a terceros"* | Notable porque es un competidor adyacente que **sí** recibe la e.firma del usuario, con mandato limitado y escrito |

### Cómo leer esto

**1. El riesgo no es uniforme, es por portal.** No existe "los portales mexicanos prohíben la automatización". Existe: los tres portales de casetas y combustible que revisé **no la prohíben**; las plataformas de facturación y los PACs **sí**, y algunos con una redacción que cubre expresamente agentes inteligentes. Antes de automatizar cualquier portal, hay que leer **ese** portal y guardar copia fechada del documento.

**2. La cláusula de "cuenta personal e intransferible" es más peligrosa que la de scraping.** Automatizar un portal que no menciona robots pero cuya cuenta es intransferible sigue siendo un incumplimiento contractual del **cliente** frente al portal, provocado por ti. Ese incumplimiento habilita al portal a cancelarle la cuenta. Un contralor cuyo TAG de casetas se bloquea a media semana no vuelve a contestarte el teléfono.

**3. El bypass de CAPTCHA es la línea que no conviene cruzar.** Cuando el portal prohíbe expresamente *"burlar, inhabilitar o evitar cualesquiera mecanismos de codificación, seguridad o autenticación"* (ioFacturo/Gosocket), resolver su CAPTCHA con un servicio automatizado no es zona gris: es incumplimiento expreso, y acerca peligrosamente el supuesto penal del párrafo siguiente.

**4. El escenario penal en México.** El Código Penal Federal, art. **211 bis 1**, segundo párrafo:

> "Al que **sin autorización** conozca o copie información contenida en sistemas o equipos de informática **protegidos por algún mecanismo de seguridad**, se le impondrán de **tres meses a un año de prisión** y de cincuenta a ciento cincuenta días multa."

Y el art. **211 bis 7**: *"Las penas previstas en este capítulo se aumentarán hasta en una mitad cuando la información obtenida se utilice en provecho propio o ajeno."* Un servicio comercial encaja en "provecho propio o ajeno".

Un portal con login está, por definición, "protegido por algún mecanismo de seguridad". La pregunta abierta es de quién debe venir la "autorización": del **titular de la cuenta** (tu cliente, que sí te autorizó) o del **operador del sistema** (el portal, que en algunos casos lo prohíbe expresamente). **No encontré jurisprudencia mexicana que resuelva ese punto** — ver SIN VERIFICAR. Mi lectura, que es razonamiento y no doctrina consolidada: cuando el titular de la cuenta autoriza el acceso a **sus propios** datos, el elemento "sin autorización" se debilita mucho; pero cuando además se **burla un mecanismo de autenticación** puesto por el operador, el argumento se voltea. Es la diferencia entre "entré con la llave que me dio el dueño" y "forcé la cerradura con permiso del inquilino".

Nota adicional: el art. **211 bis 4** eleva las penas cuando los sistemas son de **instituciones del sistema financiero** (definidas por remisión al art. 400 Bis del CPF). Si algún día Likida automatiza portales bancarios para conciliar pagos, ese artículo aplica y la exposición sube.

**5. El SAT es caso aparte y más benigno.** El SAT no prohíbe compartir la Contraseña; recomienda no hacerlo y atribuye la responsabilidad al titular. Y —lo más importante— **ofrece servicios públicos que no requieren credencial** para el caso de uso central de Likida (validación de CFDI). Automatizar contra un servicio público y documentado del SAT es una historia completamente distinta a raspar el portal de un privado que lo prohíbe.

### Regla operativa recomendada

Ordena los portales en tres cubetas y trátalos distinto:

- **Verde — API o servicio público documentado.** Verificación de CFDI del SAT, listas 69-B, descarga masiva con mandato escrito. Automatiza sin reservas.
- **Ámbar — Portal sin prohibición de automatización, cuenta del cliente, sin bypass de seguridad.** PASE, TeleVía, OXXO GAS a la fecha de esta revisión. Automatiza con: mandato escrito del cliente, identificación de tu agente en el `User-Agent`, respeto del `robots.txt`, límites de tasa conservadores, **cero bypass de CAPTCHA**, y una revisión trimestral de sus términos.
- **Rojo — Prohibición expresa de automatización, agentes, scraping o bypass de autenticación.** EdiFactMx, Facturama, Factura Digital, ioFacturo, PdP, iAudita. **No automatizar.** Si el cliente necesita esa fuente, pide integración o convenio; y si no hay, pídele el archivo al cliente.

---

## 11. Vulneraciones de seguridad: el reloj que empieza a correr

**Ley art. 19:**
> "Las vulneraciones de seguridad ocurridas en cualquier fase del tratamiento de datos personales que **afecten de forma significativa los derechos patrimoniales o morales** de las personas titulares le serán informadas de **forma inmediata** por el responsable, a fin de que pueda tomar las medidas correspondientes a la defensa de sus derechos."

**Reglamento art. 63** — qué cuenta como vulneración: pérdida o destrucción no autorizada; robo, extravío o copia no autorizada; uso, acceso o tratamiento no autorizado; daño, alteración o modificación no autorizada.

**Reglamento art. 65** — qué hay que informarle al titular, como mínimo: naturaleza del incidente; datos personales comprometidos; recomendaciones de medidas que el titular pueda adoptar; acciones correctivas realizadas de forma inmediata; y medios donde obtener más información.

**Tres cosas que hay que entender bien:**

1. **No hay obligación legal de notificar a la autoridad.** La ley solo obliga a informar **al titular**. (Sí hay obligación de informarle a la Secretaría si ésta lo requiere en una verificación.)
2. **El titular es el operador, no la flota.** Una brecha en Likida significa notificar a **cada chofer de cada flota**, no mandarle un correo al contralor. Con 50 flotas de 40 operadores son 2,000 notificaciones individuales. El contrato debe decir quién las manda, con qué texto, en qué plazo y quién paga.
3. **"Forma inmediata" no tiene número.** El Reglamento art. 64 lo matiza: *"en cuanto confirme que ocurrió la vulneración y haya tomado las acciones encaminadas a detonar un proceso de revisión exhaustiva de la magnitud de la afectación, y sin dilación alguna."* Es decir, primero confirmas y dimensionas, luego notificas sin dilación. No hay 72 horas como en el GDPR, pero tampoco hay licencia para tardarse.

**Y el deber previo (Reglamento art. 61)** — lo que un auditor te va a pedir el día uno:
1. inventario de datos personales y de los sistemas de tratamiento;
2. funciones y obligaciones de quienes tratan datos;
3. análisis de riesgos;
4. medidas de seguridad aplicables e identificación de las implementadas efectivamente;
5. **análisis de brecha** (diferencia entre lo que hay y lo que falta);
6. plan de trabajo para cerrar la brecha;
7. revisiones o auditorías;
8. capacitación del personal;
9. registro de los medios de almacenamiento.

Y remata: *"El responsable deberá contar con una **relación** de las medidas de seguridad derivadas de las fracciones anteriores."* Ese documento —un inventario vivo, no un PDF muerto— es lo que separa a un proveedor que pasa una due diligence de uno que no.

**Regla del art. 18, segundo párrafo, que muerde:** *"Los responsables **no adoptarán medidas de seguridad menores a aquellas que mantengan para el manejo de su información**."* Si tu código y tus secretos viven en un vault con MFA y rotación, y los comprobantes de tus clientes viven en un bucket con ACL pública, ya incumpliste este artículo por escrito.

---

## 12. Sanciones: los números

**Infracciones (art. 58)** — las que Likida puede cometer realistamente:

| Fr. | Conducta | Banda de multa |
|---|---|---|
| V | Omitir en el aviso de privacidad alguno o todos los elementos del art. 15 | 100 a **160,000 UMA** (art. 59 fr. II) |
| IV | Tratar datos en contravención a los principios de la Ley | 100 a **160,000 UMA** |
| VIII | Incumplir el deber de confidencialidad (art. 20) | 200 a **320,000 UMA** (art. 59 fr. III) |
| IX | **Cambiar sustancialmente la finalidad originaria sin observar el art. 11** | 200 a **320,000 UMA** |
| X | Transferir a terceros sin comunicarles el aviso de privacidad | 200 a **320,000 UMA** |
| XI | **Vulnerar la seguridad de bases de datos, locales, programas o equipos, cuando resulte imputable al responsable** | 200 a **320,000 UMA** |
| XII | Transferir o ceder datos fuera de los casos permitidos | 200 a **320,000 UMA** |
| XIII | **Recabar o transferir datos sin el consentimiento expreso cuando éste sea exigible** | 200 a **320,000 UMA** |
| XVIII | Crear bases con datos sensibles en contravención al art. 8, segundo párrafo | 200 a **320,000 UMA** |
| XIX | Cualquier otro incumplimiento a las obligaciones de la Ley | según encuadre |

**Agravantes (art. 59 fr. IV):** reincidencia añade una multa adicional de 100 a 320,000 UMA; y *"En tratándose de infracciones cometidas en el tratamiento de datos sensibles, las sanciones podrán incrementarse **hasta por dos veces**."*

**Criterios de individualización (art. 60):** naturaleza del dato; notoria improcedencia de la negativa; carácter intencional o no; **capacidad económica del responsable**; reincidencia. La capacidad económica juega a favor de un startup temprano — pero no de su cliente, que es una flota con facturación.

**Y el art. 61:** *"Las sanciones [...] se impondrán sin perjuicio de la responsabilidad civil o penal que resulte."* Suma administrativa + civil (art. 53: indemnización al titular) + penal (arts. 62-64).

**Nota de aritmética:** el valor diario de la UMA para 2026 **no lo verifiqué** en esta investigación. Como orden de magnitud, con una UMA diaria del orden de $113 (valor 2025, **SIN VERIFICAR para 2026**), 320,000 UMA rondan los **36 millones de pesos**. Confirma el valor vigente en INEGI antes de usar la cifra en cualquier material.

---

## Qué cambia esto en Likida

### Hay que construir

1. **Aviso de privacidad simplificado dentro del flujo de WhatsApp**, entregado en el primer contacto con cada operador, con los elementos de las fracciones I a IV del art. 15 y liga al integral (art. 16 fr. II). Con log inmutable de entrega y versión (la carga de la prueba es tuya: Regl. art. 31).
2. **Dos avisos, no uno.** Uno de la flota (donde Likida figura como persona encargada) para los datos de operadores. Otro propio de Likida (donde Likida es responsable) para los datos de sus usuarios y prospectos.
3. **Anexo de subencargados** en el contrato marco con la flota: proveedor de WhatsApp Business API, nube, modelo de IA, OCR, correo transaccional. Con autorización expresa (Regl. arts. 54-55) y mecanismo de notificación previa para añadir otros. La carga de acreditar la autorización es tuya.
4. **Acuerdo ZDR por escrito** con el proveedor de modelo antes del primer cliente pagado, más un lint que impida usar endpoints no elegibles para ZDR (archivos, lotes, almacenes vectoriales, asistentes).
5. **Redacción/enmascarado antes de la llamada al modelo** y almacenamiento primario en México (`mx-central-1` o equivalente).
6. **Humano en el loop para toda decisión adversa** sobre un comprobante, más trazabilidad de por qué se marcó — para no activar el art. 26 fr. II.
7. **Pipeline de disociación documentado** si algún día quieres entrenar, afinar o publicar benchmarks (art. 9 fr. III). Sin él, esos usos requieren consentimiento expreso de cada operador y son inviables.
8. **Intake ARCO** con SLA de 20 días para responder y 15 para ejecutar (art. 31), accesible desde WhatsApp, y **mecanismo de revocación por el mismo medio** en que se otorgó el consentimiento (Regl. art. 21).
9. **Persona o departamento de datos personales designado y publicado** (art. 29). Nómbralo hoy; la reforma en curso apunta a un DPO formal.
10. **La "relación de medidas de seguridad" del Reglamento art. 61** completa: inventario, análisis de riesgos, análisis de brecha, plan de trabajo, auditorías, capacitación y registro de medios de almacenamiento. Es tu carta de presentación ante el auditor del contralor.
11. **Runbook de vulneraciones** que contemple notificar a **cada operador afectado** con los cinco elementos del Reglamento art. 65, y cláusula contractual que defina quién notifica y quién paga.
12. **Política de retención**: XML/CFDI conforme a la obligación fiscal del cliente; **imágenes crudas con borrado programado** una vez cuadrado el viaje; bloqueo y supresión conforme a los arts. 10 y 24.

### Hay que validar

13. **El valor de la UMA 2026** antes de citar cualquier cifra de multa.
14. **La disponibilidad In-Region de modelos en `mx-central-1`** antes de comprometer una arquitectura de residencia en México (hoy solo aparece la ruta Global).
15. **La lista de subprocesadores** del proveedor de IA que elijas, y guardar copia fechada (art. 52 fr. I inciso b).
16. **Los términos de cada portal que vayas a automatizar**, uno por uno, con copia fechada, y revisión trimestral. Lo que hoy no prohíbe automatización mañana puede prohibirla.
17. **Si existe un mecanismo del SAT de tercero autorizado** para descarga masiva sin entregar la e.firma.

### Hay que dejar de prometer

18. **"Aprendemos de tus comprobantes para mejorar."** Con el art. 11 sin la válvula de "análoga o compatible", y con datos patrimoniales que exigen consentimiento expreso del **operador** (no de la flota), esa promesa no se sostiene sin disociación previa. Bórrala del pitch hasta que exista el pipeline.
19. **"El sistema aprueba o rechaza automáticamente."** Reescríbelo como "el sistema prepara, marca y explica; el contralor decide". Es mejor legalmente (art. 26 fr. II) y mejor producto.
20. **"Guardamos tus accesos de forma segura."** Si la arquitectura no tiene HSM/KMS por tenant, descifrado efímero, bitácora consultable por el cliente y revocación en un clic, esa frase es una promesa que te alcanza el art. 62 de la LFPDPPP.
21. **"Cumplimos con el INAI."** El INAI no existe. Decirlo en 2026 te descalifica frente a cualquier contralor que sepa leer.
22. **"Validamos con el SAT en tiempo real" sin decir cómo.** Dilo con precisión: la validación usa el servicio público de verificación de CFDI y no requiere credenciales del cliente. Es tu mejor argumento de venta y es verdad.

---

## SIN VERIFICAR

Lo que no pude comprobar en fuente primaria y por tanto no debe usarse como fundamento:

1. **La vigencia formal del Reglamento de 2011 bajo la nueva ley.** No encontré pronunciamiento de la Secretaría, criterio administrativo ni tesis jurisdiccional. Mi conclusión de que subsiste "en lo que no contradiga" es **razonamiento propio** apoyado en: (a) que el Transitorio Segundo no lo abroga, (b) que la ley lo invoca siete veces como instrumento existente, y (c) que la Cámara de Diputados lo publica como "TEXTO VIGENTE". Es una lectura sólida, no una certeza.
2. **La vigencia de los Lineamientos del Aviso de Privacidad (DOF 17-ene-2013).** No hallé abrogación expresa ni confirmación. Fueron emitidos por la Secretaría de Economía junto con el IFAI bajo la ley abrogada.
3. **Que no exista un Reglamento nuevo publicado en el DOF entre marzo de 2025 y julio de 2026.** Lo infiero de que la Cámara de Diputados sigue publicando el de 2011 como vigente y de fuentes secundarias; no hice una consulta exhaustiva del índice del DOF.
4. **Los criterios, guías o lineamientos que la Secretaría Anticorrupción y Buen Gobierno haya emitido para el sector privado.** Su sitio `anticorrupcionybg.gob.mx/datospersonales/` falló al cargar (error de certificado SSL) y `gob.mx/buengobierno/documentos/proteccion-de-datos-personales-nuevo` redirigió a la portada. **Es una laguna que conviene cerrar antes de escribir el aviso definitivo.**
5. **El comunicado oficial del proceso de reforma de enero de 2026.** Solo tengo la nota de Infobae del 29-ene-2026. Los detalles (privacidad por diseño, evaluaciones de impacto, DPO) vienen de ese medio, no de la Secretaría.
6. **El valor diario de la UMA para 2026.** Todas las cifras en pesos de este documento son estimaciones basadas en el valor 2025.
7. **Las listas de subprocesadores de Anthropic y OpenAI.** Sé que existen y que ambos las publican, pero no las leí en esta investigación. Es requisito del art. 52 fr. I inciso b.
8. **Los términos de OpenAI sobre propiedad de inputs/outputs y sobre notificación de requerimientos gubernamentales, en su redacción literal.** De Anthropic sí tengo el texto de los Commercial Terms; de OpenAI trabajé con la documentación de datos, no con el contrato.
9. **La disponibilidad In-Region de modelos Claude en `mx-central-1`.** La tabla de AWS consultada el 27-jul-2026 los muestra solo bajo "Global", pero la extracción de esa tabla vino con nombres de modelo que no pude contrastar. **Reconfirmar directamente en la consola de AWS antes de decidir arquitectura.**
10. **Los términos de uso de CAPUFE y de los portales de autofacturación de grandes cadenas** (Walmart, Home Depot). `facturacioncapufe.com.mx` devuelve una página vacía (literalmente ":D"), y los portales de retail no cargaron. Además, `facturacioncapufe.com.mx` es un dominio **.com.mx operado por un tercero**, no un dominio gob.mx de CAPUFE — conviene verificar cuál es el portal oficial antes de integrarlo.
11. **Los contratos de adhesión de PASE y TeleVía** (los registrados ante PROFECO). Leí sus condiciones de uso y términos de servicio publicados en web, no el contrato de adhesión, que puede contener cláusulas adicionales sobre uso de la cuenta.
12. **Jurisprudencia mexicana sobre si el acceso automatizado a un portal con credenciales del titular de la cuenta, pero contra los términos de uso del operador del sistema, actualiza el art. 211 bis 1 del Código Penal Federal.** No encontré ninguna. El análisis de §10.4 es razonamiento, no doctrina consolidada.
13. **Si el SAT ofrece un mecanismo formal de "tercero autorizado"** para descarga masiva de CFDI distinto de entregar la e.firma. Algunas fuentes secundarias lo mencionan de pasada; no lo confirmé en la RMF ni en documentación del SAT.
14. **El texto exacto de la regla 2.2.1 de la RMF 2026.** Tengo su contenido por fuentes secundarias coincidentes (sustituye la firma autógrafa, mismo valor probatorio, vigencia de cuatro años) y por la "Responsiva para Contraseña" del propio SAT, pero no leí la RMF 2026 publicada en el DOF.
15. **La definición oficial de "dato financiero o patrimonial".** Ninguna de las dos leyes la define. Los criterios que uso vienen de la práctica y de criterios del extinto INAI que no consulté en esta sesión.

---

## Fuentes

### Primarias — leyes y reglamentos

- **Ley Federal de Protección de Datos Personales en Posesión de los Particulares** (nueva, DOF 20-03-2025, última reforma DOF 14-11-2025) — https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPDPPP.pdf
- **LFPDPPP abrogada** (DOF 05-07-2010), texto original del Decreto — https://www.dof.gob.mx/nota_detalle.php?codigo=5150631&fecha=05/07/2010 y espejo https://sidof.segob.gob.mx/notas/docFuente/5150631
- **Reglamento de la LFPDPPP** (DOF 21-12-2011, texto vigente) — https://www.diputados.gob.mx/LeyesBiblio/regley/Reg_LFPDPPP.pdf
- **Código Fiscal de la Federación** (última reforma DOF 09-04-2026) — https://www.diputados.gob.mx/LeyesBiblio/pdf/CFF.pdf
- **Código Penal Federal** (última reforma DOF 13-03-2026) — https://www.diputados.gob.mx/LeyesBiblio/pdf/CPF.pdf
- **Lineamientos del Aviso de Privacidad** (DOF 17-01-2013) — https://www.dof.gob.mx/nota_detalle.php?codigo=5284966&fecha=17/01/2013

### Primarias — autoridad

- SAT, Avisos de seguridad / "Responsiva para Contraseña" — http://m.sat.gob.mx/fichas_tematicas/pago_referenciado/Paginas/avisos_seguridad.aspx
- SAT, Verificación de Comprobantes Fiscales Digitales por Internet — https://verificacfdi.facturaelectronica.sat.gob.mx/
- SAT, Buzón Tributario (ficha temática) — http://omawww.sat.gob.mx/fichas_tematicas/buzon_tributario/Paginas/default.aspx
- SAT, Aviso integral de privacidad — http://omawww.sat.gob.mx/documentossat/Paginas/AvisodePrivacidadSAT/aviso_de_privacidad_sat.htm
- Secretaría Anticorrupción y Buen Gobierno — https://www.gob.mx/buengobierno y https://anticorrupcionybg.gob.mx/datospersonales/ (no cargó: error de certificado)

### Primarias — proveedores de IA

- Anthropic, *API and data retention* — https://platform.claude.com/docs/en/manage-claude/api-and-data-retention
- Anthropic, *How long do you store my organization's data?* — https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data
- Anthropic, *Is my data used for model training?* — https://privacy.claude.com/en/articles/7996868-is-my-data-used-for-model-training
- Anthropic, *I have a zero data retention agreement...* — https://privacy.claude.com/en/articles/8956058-i-have-a-zero-data-retention-agreement-with-anthropic-what-products-does-it-apply-to
- Anthropic, *Commercial Terms of Service* — https://www.anthropic.com/legal/commercial-terms
- OpenAI, *Data controls in the OpenAI platform* — https://developers.openai.com/api/docs/guides/your-data
- OpenAI, *Enterprise privacy* — https://openai.com/enterprise-privacy/
- OpenAI, *Business data privacy, security, and compliance* — https://openai.com/business-data/

### Primarias — infraestructura

- AWS, *AWS expande su presencia en América Latina con nueva Región en México* (14-ene-2025) — https://aws.amazon.com/es/blogs/aws-spanish/aws-expande-su-presencia-en-america-latina-con-nueva-region-en-mexico/
- Amazon Bedrock, *Regional availability by models* — https://docs.aws.amazon.com/bedrock/latest/userguide/models-region-compatibility.html
- Anthropic, *Claude en Amazon Bedrock* — https://platform.claude.com/docs/es/build-with-claude/claude-on-amazon-bedrock

### Primarias — términos de uso de portales (leídos el 27-jul-2026)

- PASE, *Condiciones y Privacidad* — https://pase.com.mx/legales/condiciones-y-privacidad/
- PASE, *Términos y Condiciones* — https://www.pase.com.mx/noticias/terminos-y-condiciones/
- TeleVía, *Términos y Condiciones del Servicio de Telepeaje* — https://www.televia.com.mx/terminos-y-condiciones-servicio-telepeaje
- TeleVía, *Términos y condiciones / aviso de privacidad* — https://www.televia.com.mx/terminos-y-condiciones
- OXXO GAS, *Términos y Condiciones Portal Web Vales* — https://clientes.oxxogas.com/terminos-y-condiciones.php
- OXXO GAS, *Aviso de Privacidad Portal de Facturación* — https://facturacion.oxxogas.com/avisoprivacidad
- EdiFactMx, *Términos y Condiciones* — https://www.edifact.com.mx/terminos-y-condiciones
- Facturama, *Términos y Condiciones de Uso del Servicio* — https://cdnfacturama.azureedge.net/content/docs/Facturama-terminos-y-condiciones-del-servicio.pdf
- Factura Digital (Novatech Digital), *Términos y Condiciones* — https://www.facturadigital.com.mx/terminos-y-condiciones
- ioFacturo / Gosocket, *Términos y Condiciones* — https://ayuda.iofacturo.mx/support/solutions/articles/155000000545
- PdP Portal de Pagos, *Términos de Uso* — https://pdp.mx/terms
- iAudita, *Términos y Condiciones de Uso* — https://iaudita.com/Terminos
- Interfactura, *Términos y Condiciones portal gratuito* — https://portalgratuito.interfactura.com/Content/TerminosCondiciones.htm
- ProFact, *Términos y condiciones de uso* — https://profact.com.mx/terminos-y-condiciones-de-uso/

### Secundarias — usadas como pista, nunca como fundamento

- Infobae, *La Secretaría Anticorrupción arranca proceso para actualizar la ley de protección de datos personales en México* (29-ene-2026) — https://www.infobae.com/mexico/2026/01/29/la-secretaria-anticorrupcion-arranca-proceso-para-actualizar-la-ley-de-proteccion-de-datos-personales-en-mexico/
- Basham, *Nueva LFPDPPP publicada en el DOF* — https://basham.com.mx/en/nueva-ley-federal-de-proteccion-de-datos-personales-en-posesion-de-los-particulares-publicada-en-el-diario-oficial-de-la-federacion/
- Greenberg Traurig, *Alerta: Nueva LFPDPPP* — https://www.gtlaw.com/en/insights/2025/3/nueva-ley-general-proteccion-de-datos
- EY México, *Entrada en vigor de la nueva LFPDPPP* — https://www.ey.com/es_mx/technical/tax/boletines-fiscales/nueva-ley-federal-proteccion-datos-personal-posesion-particulares
- Littler, *México tiene nueva ley en materia de protección de datos personales* — https://www.littler.com/es/news-analysis/asap/mexico-tiene-nueva-ley-en-materia-de-proteccion-de-datos-personales
