# Guardarraíles y responsabilidad de opinar en materia fiscal

> Ola 2 — 27-jul-2026. Construido sobre la ola 1.

---

## Resumen para el fundador

1. **No existe una "reserva de actividad" general sobre dar opinión fiscal informal en México.** Lo que sí está reservado son tres cosas puntuales, y Likida no toca ninguna hoy: (a) el **dictamen fiscal formal** (CFF art. 52, solo lo puede firmar un Contador Público Registrado ante el SAT); (b) **representar a alguien en juicio** ante el Tribunal Federal de Justicia Administrativa (LFPCA art. 5, exige licenciado en derecho); (c) **usar el título o el "carácter" de contador/abogado** sin tenerlo (Código Penal Federal art. 250 — usurpación de profesión, 1 a 6 años de prisión). Mientras Likida no llame "dictamen" a su salida, no represente a nadie ante el SAT ni ante tribunales, y no se presente como despacho contable, no pisa ninguna de las tres reservas.
2. **El riesgo real y ya identificado en la ola 1 no es de reserva de profesión: es el CFF art. 89/90.** Ese artículo sanciona a "quien asesore, aconseje, preste servicios o participe" en una práctica fiscal indebida de las publicadas en el Anexo 3 de la RMF, con multa de $79,130 a $124,380 (cifra 2026, corroborada en esta ola pero **todavía sin leer en el Anexo 5 original**) más un agravante del 10%–20% de la contribución omitida. **La propia ley trae la salida:** si Likida manifiesta **por escrito** que su criterio puede ser distinto al del SAT, no incurre en el agravante. Esa frase tiene texto legal exacto (§1.1) y hay que ponerla, literal, en cada salida del producto que sugiera trato fiscal.
3. **Hay un cuarto régimen que la ola 1 no cubrió: los "esquemas reportables" (CFF arts. 197–199).** Un "asesor fiscal" que diseña y comercializa de forma masiva una manera de obtener un beneficio fiscal está obligado a revelarlo al SAT. Se investigó a fondo y **no aplica al motor de reglas de Likida hoy**: las 14 características que hacen reportable un esquema (art. 199) apuntan todas a planeación internacional, partes relacionadas, pérdidas fiscales y precios de transferencia — nada de eso es lo que hace un motor que clasifica gastos de una flota y aplica facilidades ya publicadas de la RFA. **Bandera a futuro:** si Likida alguna vez ofrece diseñar la estructura societaria de un coordinado y sus integrantes (reestructuras, prorrateo entre partes relacionadas), hay que revisar esto otra vez.
4. **Las cuatro plataformas de software fiscal que se leyeron (Zumma, Clara, Facturama/Factorum, CONTPAQi) coinciden en una fórmula, y CONTPAQi la hace mejor que nadie.** Ninguna se presenta como quien decide; todas dicen "somos una herramienta, el resultado lo valida y lo asume el usuario". CONTPAQi además ya tiene una cláusula específica para agentes de IA: literalmente libera a la empresa de las acciones que ejecuten "agentes y asistentes de inteligencia artificial" bajo control y consentimiento del usuario. Esa cláusula es el estándar a igualar, no a inventar desde cero.
5. **El agente de Likida necesita un tercer verbo, no solo dos.** No basta con "afirmar" o "condicionar": tiene que poder **rechazar** activamente ciertas preguntas (planeación agresiva, litigio, "cómo hago para que esto pase aunque no cumpla") y decir que no responde, en vez de improvisar una respuesta condicionada. Esta ola entrega la matriz de qué verbo usa el agente en cada situación, con ejemplos tomados directo del motor de reglas de la ola 1 (Grupo A/B, faja de 50 km, régimen del operador, contadores acumulativos).
6. **Este documento cierra la acción #2 de la Fase 0 del resumen ejecutivo** ("redactar la leyenda de los arts. 89 y 90 del CFF para términos de servicio y salidas del producto"): la leyenda está redactada en §5, en tres versiones (contrato, salida del producto, pie del reporte).
7. **El riesgo más caro no es legal, es de producto: que el agente hable con la confianza de un contador sin la incertidumbre de un contador.** Un contador humano dice "depende" cuando falta información. Un LLM, si no se le prohíbe explícitamente, rellena el hueco con la respuesta más probable y la dice con el mismo tono seguro que usa para un hecho verificado. La mitigación no es solo legal — es de diseño de prompt y de UI, y se detalla en §3 y §4.

---

## 1. Los cuatro (más uno) regímenes de responsabilidad que le aplican a Likida

### 1.1 CFF art. 89/90 — "quien asesore, aconseje, preste servicios o participe" (ya identificado en la ola 1, aquí se completa)

Ya está en `01-cfdi-cff.md` §6, `10-contradicciones.md` §1 y `00-RESUMEN-EJECUTIVO.md`: los criterios del Anexo 3 de la RMF sancionan expresamente a "quien asesore, aconseje, preste servicios o participe" en una práctica fiscal indebida (ejemplo verificado: criterio **1/LIF/PI**, fracción II, sobre el estímulo del diésel — "Quien asesore, aconseje, preste servicios o participe en la realización o la implementación de la práctica anterior"). Likida, como prestador de servicios que calcula y presenta veredictos de deducibilidad, cae dentro de ese "quien".

**Texto literal de la mitigación, verificado en esta ola** (CFF art. 90, párrafo de la agravante):

> "En los supuestos señalados en la fracción I del artículo citado [CFF 89], se considerará como agravante que la asesoría, el consejo o la prestación de servicios sea diversa a los criterios dados a conocer por las autoridades fiscales en los términos del inciso h) de la fracción I del artículo 33 de este Código. En este caso, la multa se aumentará de un 10% a un 20% del monto de la contribución omitida […] **No se incurrirá en la agravante a que se refiere el párrafo anterior, cuando se manifieste en la opinión que se otorgue por escrito que el criterio contenido en ella es diverso a los criterios dados a conocer por las autoridades fiscales** en los términos del inciso h) de la fracción I del artículo 33 de este Código."

Tres consecuencias de diseño que no estaban en la ola 1:

- La leyenda **quita el agravante del 10%–20%**, no la infracción base. La infracción base (multa de $79,130 a $124,380) se evita **no participando en la práctica indebida**, es decir, con el motor de reglas bien construido (Grupo A vs. Grupo B, faja de 50 km, forma de pago del combustible). La leyenda es la segunda línea de defensa, no la primera.
- Tiene que ser **"por escrito", en la opinión misma** — no basta con que esté en un ToS que el usuario aceptó una vez al registrarse. Tiene que aparecer en la salida concreta que sugiere trato fiscal (el mensaje de WhatsApp, el reporte de liquidación).
- El monto de la multa **($79,130 a $124,380, "Actualizada DOF 28-12-2025")** se encontró corroborado en un segundo compilador independiente (mley.mx) con la misma cifra y la misma fecha de actualización que ya traía la ola 1. Sigue sin leerse en el PDF original del Anexo 5 de la RMF 2026 — ver SIN VERIFICAR.

### 1.2 Ejercicio ilegal de la profesión — la pregunta central del encargo

**¿Existe una reserva de actividad para "dar asesoría fiscal" en México?** Respuesta corta: **no, en general no.** Lo que existe son tres reservas puntuales.

**a) El dictamen fiscal formal (CFF art. 52) — reservado al Contador Público Registrado.**

> "Se presumirán ciertos, salvo prueba en contrario, los hechos afirmados: en los dictámenes formulados por contadores públicos sobre los estados financieros de los contribuyentes […] o en cualquier otro dictamen que tenga repercusión fiscal formulado por contador público […] siempre que se reúnan los siguientes requisitos: I. Que el contador público que dictamine obtenga su inscripción ante las autoridades fiscales […] Este registro lo podrán obtener únicamente [personas con] título de contador público registrado ante la Secretaría de Educación Pública y que sean miembros de un colegio profesional […] cuando menos en los tres años previos […]"

El Reglamento del CFF (art. 52) añade cédula profesional, certificación vigente, constancia de socio activo, tres años de experiencia elaborando dictámenes y opinión positiva de cumplimiento (32-D). Es una barrera de entrada alta y deliberada, y el efecto legal del dictamen es fuerte: **presume ciertos los hechos que afirma**, salvo prueba en contrario.

**Consecuencia para Likida: nunca llamar "dictamen" a la salida del producto.** El veredicto de deducibilidad que arma el motor de reglas (§3) es un cálculo operativo interno de la empresa, no un dictamen con efectos ante el SAT. Usar la palabra "dictamen" en el copy, aunque sea coloquialmente ("te dictamino el gasto"), invita a la confusión con esta figura reservada.

**b) La representación en juicio contencioso administrativo (LFPCA art. 5) — reservado al licenciado en derecho, con un matiz.**

> "Ante el Tribunal no procederá la gestión de negocios. Quien promueva a nombre de otra deberá acreditar que la representación le fue otorgada […] Los particulares o sus representantes podrán autorizar por escrito a licenciado en derecho que a su nombre reciba notificaciones. **La persona así autorizada podrá hacer promociones de trámite, rendir pruebas, presentar alegatos e interponer recursos.**"

Esto aplica al **juicio de nulidad** ante el Tribunal Federal de Justicia Administrativa, no a un trámite administrativo directo ante el SAT. Para trámites administrativos ante el SAT (recursos de revocación, avisos, promociones), el **CFF art. 19** solo exige acreditar representación con escritura pública o carta poder ante dos testigos — no exige abogado. Likida no hace ni lo uno ni lo otro: no representa al cliente ante el SAT ni ante ningún tribunal. Esta reserva es relevante solo como límite: **si algún día Likida quisiera "interponer el recurso por ti" o "hablar con el SAT en tu nombre", ahí sí entraría a un terreno reservado a abogados.**

**c) Usurpación de profesión (Código Penal Federal art. 250) — el riesgo de marca y de copy, no del software.**

> "Se sancionará con prisión de uno a seis años y multa de cien a trescientos días a quien: […] II. Al que sin tener título profesional o autorización para ejercer alguna profesión reglamentada […] a).- Se atribuya el carácter del profesionista[;] b).- Realice actos propios de una actividad profesional […] c).- Ofrezca públicamente sus servicios como profesionista[;] d).- Use un título o autorización para ejercer alguna actividad profesional sin tener derecho a ello."

Y qué profesiones "necesitan título para su ejercicio" lo dice el transitorio de la **Ley Reglamentaria del art. 5º Constitucional** (Decreto DOF 31-dic-1973, vigente "en tanto se expidan las leyes" a que se refiere el art. 2º reformado — no se han expedido): la lista incluye textualmente **"Contador"** y **"Licenciado en Derecho"**. El mismo ordenamiento (art. 24) define ejercicio profesional de forma amplia: *"la realización habitual a título oneroso o gratuito de todo acto o la prestación de cualquier servicio propio de cada profesión, **aunque sólo se trate de simple consulta** o la ostentación del carácter del profesionista por medio de tarjetas, anuncios, placas, insignias **o de cualquier otro modo**."*

**Lectura para Likida, con matices importantes:**

- El art. 250 del CPF está redactado para **personas físicas** ("al que…"), no para personas morales. Una sociedad no puede "tener cédula" ni cometer usurpación en sentido estricto. El riesgo se traslada a **cómo se presentan los fundadores y el marketing**: si la landing dice "somos tu despacho contable" o "Likida dictamina tu deducibilidad" sin matiz, eso sí puede leerse como "ofrecer públicamente servicios de contador" y "usar el carácter del profesionista", aunque quien lo diga sea el sitio web y no una persona con nombre.
- El elemento más peligroso de la lista es el inciso (b): **"realice actos propios de una actividad profesional"**. Aquí es donde el diseño del producto importa más que el texto legal: un output que se presenta como juicio profesional definitivo ("esto es deducible", sin condicionar, sin fundamento, sin invitar a validación) se parece más a un "acto propio" de la contaduría que un output que cita la regla, marca los supuestos que no pudo verificar y dice "valídalo con tu contador antes de usarlo en tu declaración". La diferencia no está en la ley, está en el copy — y por eso la matriz de §3 es la pieza operativa real de este documento.
- Ningún caso publicado de usurpación de profesión contra un software fiscal en México se localizó en esta investigación (ver SIN VERIFICAR). El riesgo es preventivo, no hay jurisprudencia que lo confirme aplicado a SaaS.

### 1.3 Publicidad engañosa (LFPC art. 32) — el hook que nadie había puesto sobre la mesa

La Ley Federal de Protección al Consumidor, art. 32, exige que toda publicidad sea "veraz, comprobable, clara" y prohíbe "textos […] que induzcan o puedan inducir a error o confusión". Los Lineamientos de PROFECO para verificar publicidad (Acuerdo DOF, vigente) instruyen específicamente:

> "Se evite utilizar **términos categóricos o superlativos** que induzcan al error o confusión a los consumidores respecto al desempeño, características o condiciones del bien, servicio o producto anunciado."

Esto es relevante en dos frentes distintos:

- **Marketing:** promesas como "deducimos el 100% de tus gastos" o "nunca vas a tener un problema fiscal" son publicidad engañosa comprobable per se, independientemente de si son fiscalmente correctas o no ese día (ver también `00-RESUMEN-EJECUTIVO.md`, tabla "Lo que NO podemos prometerle a un cliente").
- **El producto mismo:** un veredicto del motor de reglas que se presenta como "SÍ, deducible" sin matiz, cuando la regla real tiene condiciones (topes, faja de 50 km, forma de pago), es información que **"pudiendo o no ser verdadera, induce a error"** en el sentido del art. 32 — no porque sea falsa siempre, sino porque omite la condición que la hace falsa a veces. PROFECO puede exigir insertar una leyenda de alerta si detecta esto en un procedimiento (facultad del art. 35: puede ordenar la leyenda "la veracidad de la información contenida en este mensaje no ha sido comprobada ante PROFECO").

### 1.4 Responsabilidad civil (Código Civil Federal, arts. 1910, 1913–1914) — quién paga si el motor se equivoca

Fuera del terreno fiscal hay un cuarto piso: si el motor de reglas le da a un contralor un veredicto equivocado y el contralor lo usa, y el SAT rechaza la deducción o multa a la empresa, esa empresa puede reclamarle el daño a Likida por la vía civil, con dos fundamentos posibles:

> **Art. 1910 CCF:** "El que obrando ilícitamente o contra las buenas costumbres cause daño a otro, está obligado a repararlo, a menos que demuestre que el daño se produjo como consecuencia de culpa o negligencia inexcusable de la víctima."

> **Art. 1913 CCF (responsabilidad objetiva / riesgo creado):** "Cuando una persona hace uso de mecanismos, instrumentos, aparatos o sustancias peligrosas por sí mismos […] o por otras causas análogas, está obligada a responder del daño que causen, aunque no obre ilícitamente, a no ser que demuestre que ese daño se produjo por culpa o negligencia inexcusable de la víctima."

México no tiene todavía una ley específica de responsabilidad por IA (verificado — no se localizó proyecto vigente en 2026 con fuerza de ley). La doctrina y los análisis especializados leídos en esta ola coinciden en que, a falta de esa ley, los tribunales aplicarían **1910 (culpa) o 1913–1914 (riesgo creado, sin necesidad de probar culpa)** a un sistema de IA que cause un daño patrimonial. El dato operativo que más importa: **el art. 1913 no exige probar negligencia — basta el daño y el nexo causal.** Eso hace que el descargo contractual (limitar la responsabilidad, definir que la decisión final es del cliente) sea más importante que en un régimen de culpa, porque es la única defensa disponible aparte de probar "negligencia inexcusable de la víctima" (que el propio contralor ignoró una advertencia clara del sistema, por ejemplo).

**Consecuencia de diseño directa:** cada vez que el sistema marca un supuesto como "sin verificar" y el contralor decide ignorarlo y proceder de todos modos, esa decisión debe quedar **registrada con quién la tomó y cuándo** (ya está recomendado en `00-RESUMEN-EJECUTIVO.md`, riesgo "Automatizar el timbrado…"). Ese registro es exactamente el material con el que Likida probaría, en un eventual reclamo civil, que el daño vino de que el cliente ignoró la advertencia — no de que el sistema fallara en silencio.

### 1.5 Esquemas reportables (CFF arts. 197–199) — un régimen nuevo para el paquete, y por qué no aplica hoy

Ninguno de los documentos de la ola 1 (`00`, `08`, `09`, `10`) menciona el Título Sexto del CFF. Es relevante porque encaja, en apariencia, con lo que hace un SaaS fiscal: define **"asesor fiscal"** como

> "cualquier persona física o moral que, en el curso ordinario de su actividad realice actividades de asesoría fiscal, y sea responsable o esté involucrada en el diseño, comercialización, organización, implementación o administración de la totalidad de un esquema reportable […]"

y un **"esquema reportable generalizado"** como aquel que "buscan comercializarse de manera masiva a todo tipo de contribuyentes o a un grupo específico de ellos, y aunque requieran mínima o nula adaptación […] la forma de obtener el beneficio fiscal sea la misma" (CFF art. 199, penúltimos párrafos) — que es, literalmente, la descripción de un producto SaaS que aplica la misma lógica a cientos de flotas.

**Por qué no aplica hoy:** el art. 199 no hace reportable cualquier beneficio fiscal — solo los que tienen alguna de **14 características** específicas. Se leyeron las 14 en el texto íntegro del artículo (verificado en tres compiladores independientes que coinciden en el texto). Todas apuntan a: evitar el intercambio internacional de información, evitar el art. 4-B (entidades extranjeras transparentes) o el régimen de REFIPRES, transmitir pérdidas fiscales a un tercero, operaciones circulares de retorno de pago, tratados para evitar doble tributación, intangibles difíciles de valorar entre partes relacionadas, reestructuras empresariales sin contraprestación, mecanismos híbridos, ocultar al beneficiario efectivo, transferir activos depreciados entre partes relacionadas, evitar la tasa adicional del 10% a dividendos, arrendamientos circulares, y diferencias contable-fiscales mayores al 20%. **Ninguna describe lo que hace el motor de reglas de Likida** (clasificar gastos de un viaje, aplicar el 8% ciego o la válvula del 15% de combustible en efectivo — facilidades ya publicadas por el propio SAT en la RFA, no estructuras diseñadas para evadir su vigilancia).

**Bandera a futuro, no acción hoy:** la fracción VI(b) del art. 199 sí toca "reestructuraciones empresariales […] sin contraprestación" entre partes relacionadas. La ola 1 (`09-liquidacion.md` §3.9, regla RFA 2.5) ya identificó que un coordinado necesita "un manual de políticas para la aplicación de los gastos comunes y su prorrateo" entre sus integrantes — integrantes que, dependiendo de la estructura societaria, pueden ser partes relacionadas entre sí. **Si Likida algún día construye la herramienta que diseña ese prorrateo** (no solo que lo registra), hay que revisar el art. 199 otra vez con un fiscalista. Mientras el producto se limite a aplicar reglas ya publicadas a hechos ya ocurridos, esta capa no aplica.

---

## 2. Cómo se protegen las plataformas reales — lectura de Zumma, Clara, Facturama/Factorum y CONTPAQi

Se leyeron los términos y condiciones publicados de las cuatro. Resumen de qué cláusula usa cada una y qué se le puede robar:

| Plataforma | Qué es, según su propio ToS | Cláusula clave leída, literal | Qué robarle |
|---|---|---|---|
| **Facturama** | "Herramienta que le facilita la gestión de su facturación", no un asesor | *"El Usuario reconoce expresamente que FACTURAMA es una herramienta que le facilita la gestión de su facturación y su actividad empresarial, y acepta expresamente que La Empresa no tiene control en ningún momento sobre dicha actividad y facturación […] En consecuencia, El Usuario exime expresamente a La Empresa de cualquier responsabilidad: (i) en caso de incumplimiento de cualquier disposición legal actual o futura […]"* | El framing "somos herramienta, tú tienes el control y la responsabilidad" — y el dato de negocio: Facturama **vende asesoría fiscal como servicio humano aparte**, con contadores reales detrás, separado del software de timbrado. No mezcla el output automático con la opinión profesional: son dos productos distintos con dos responsables distintos. |
| **Factorum** (mismo giro que Facturama) | "Proveedor tecnológico", no garante de validez fiscal | *"El Usuario y/o Cliente es el único responsable del contenido, exactitud, legalidad y cumplimiento fiscal de la información incorporada en los CFDI […] Factorum actúa exclusivamente como proveedor tecnológico, por lo que no asume responsabilidad alguna respecto de la validez fiscal de los comprobantes emitidos."* + tope de responsabilidad: *"En ningún caso la responsabilidad total de Factorum frente al Cliente […] excederá el monto efectivamente pagado por el Cliente por los servicios contratados en el periodo inmediato anterior al evento que dio origen a la reclamación."* | La frase exacta "proveedor tecnológico, no garante de validez fiscal" — es la más limpia y corta de las cuatro, y el **tope de responsabilidad atado a lo pagado en el periodo anterior** (defensa práctica: limita la exposición económica sin necesidad de negar el servicio). |
| **CONTPAQi** | "Herramienta de trabajo" que el usuario debe validar siempre, incluso si el usuario cree que la norma aplicable es otra | *"El USUARIO acepta en todo momento, que el PROGRAMA sirve únicamente como herramienta de trabajo […] debiendo el USUARIO validar en todo momento la información […] teniendo también la obligación de verificar cualquier resultado […] incluso cuando considere que la aplicación de la norma deba ser otra, en cuyo caso, la responsabilidad del resultado cualquiera que sea el obtenido y el cumplimiento de las normas legales será exclusiva responsabilidad del USUARIO."* Y, sobre IA específicamente: *"[…] los productos y servicios de CONTPAQi® pueden utilizar tecnologías de Inteligencia Artificial, incluyendo agentes automatizados, sistemas conversacionales y modelos de lenguaje (LLMs) […] el USUARIO libera de toda responsabilidad a CONTPAQi® respecto a las acciones que el mismo USUARIO autorice, automatice y/o realicen los agentes y asistentes de inteligencia artificial bajo las reglas, controles y consentimiento autorizados por el USUARIO."* | **Es el estándar de oro y ya viene resuelto: es la única de las cuatro con una cláusula de IA explícita.** Dos ideas para copiar literal: (1) la responsabilidad es del usuario **incluso si él cree que la norma aplicable es otra** — cubre exactamente el caso de un veredicto de zona gris; (2) la liberación de responsabilidad por acciones de "agentes y asistentes de inteligencia artificial" está condicionada a que operen "bajo reglas, controles y consentimiento autorizados por el USUARIO" — esto obliga a que el producto le dé al contralor un control real (aprobar/editar reglas), no solo un botón de aceptar el ToS una vez. |
| **Clara** | Comisionista mercantil para pagos, no evaluador de deducibilidad | *"Clara no adquiere, bajo ninguna circunstancia, obligaciones de ninguna naturaleza a cargo de Cliente y, sólo será responsable de ejecutar la transferencia de recursos […] Clara no se constituye de ninguna manera en garante de las obligaciones derivadas del negocio y/o relación jurídica entre el Cliente y el Tercero beneficiario."* | Contraste útil, no cláusula a copiar: Clara **no necesita** una cláusula de "no somos asesoría fiscal" porque su producto no decide deducibilidad — mueve dinero. Confirma que el riesgo de "opinar en materia fiscal" es específico de quien clasifica y verdicta (Facturama, Factorum, CONTPAQi, y Likida), no de quien solo paga o solo tramita facturas. |
| **Zumma** | App de gestión de gastos con IA ("Zummi") que solicita facturas por WhatsApp | No se localizó, en la sección de Términos y Condiciones ni en el Aviso de Privacidad, una cláusula equivalente de "no es asesoría fiscal" o "usted debe validar con su contador" — sólo se encontró el descargo operativo de que "no puede garantizar que cada factura […] sea generada". **Su landing pública sí anuncia "IA de deducibilidad de gastos, impulsado por IA".** | Nada que copiar — es la advertencia contraria: un competidor que ofrece explícitamente un veredicto de deducibilidad por IA sin, hasta donde se pudo leer, un descargo específico sobre esa función, es exactamente el hueco que Likida no debe repetir. (Marcado SIN VERIFICAR: no se leyó el documento completo de Zumma, solo lo que expuso la búsqueda; puede existir la cláusula en una sección no indexada.) |

**Patrón que las cuatro comparten y que Likida debe seguir:** ninguna se presenta como quien decide. Todas usan variaciones de "somos herramienta"/"proveedor tecnológico", ponen la responsabilidad del resultado en el usuario, y condicionan la liberación de responsabilidad a que el usuario mantenga control sobre lo que el sistema hace. Facturama va un paso más allá y **separa el producto que opina (contadores humanos, de pago aparte) del producto que solo timbra (automático, sin opinión)** — es el mismo patrón que la arquitectura de Likida necesita: el motor de reglas prepara y cita fundamento, el contralor humano decide (ya mandatado, además, por LFPDPPP art. 26 fr. II — ver `00-RESUMEN-EJECUTIVO.md` punto 10).

---

## 3. Los guardarraíles del agente de Likida: qué puede afirmar, qué debe condicionar, qué debe rechazar

Esta es la pieza operativa del encargo. Se construye directamente sobre el motor de reglas ya diseñado en la ola 1 (`09-liquidacion.md` y `00-RESUMEN-EJECUTIVO.md`, punto 3: "un comprobante no tiene un veredicto, tiene cuatro").

### 3.1 Los tres verbos

| Verbo | Cuándo se usa | Regla de diseño |
|---|---|---|
| **AFIRMA** | El hecho es verificable mecánicamente contra una fuente autoritativa (SAT, DOF, catálogo) o es aritmética sobre datos que el sistema ya tiene con certeza. | Sin condicional, sin "puede ser", con la fuente citada. Es el único caso donde el sistema habla con la misma seguridad que un humano. |
| **CONDICIONA** | El veredicto depende de un hecho, una calificación jurídica o un umbral que el sistema **no puede verificar solo** (requiere un dato que falta, una calificación subjetiva, o la norma misma no define el criterio). | Nunca se calla el supuesto. Estructura fija: hecho conocido + regla citada + lo que falta verificar + quién decide. Plantilla completa en §4. |
| **RECHAZA** | La pregunta no es sobre clasificar un hecho ya ocurrido contra una regla ya publicada, sino sobre **planear, litigar, representar o garantizar** — cualquiera de las tres reservas de §1.2, o una petición de manipular el registro de un hecho. | No improvisa una respuesta condicionada como sustituto. Dice explícitamente que no responde eso y por qué, y ofrece la alternativa correcta (ver plantillas §5.4). |

### 3.2 La matriz aplicada al motor de reglas de la ola 1

| Situación (tomada del motor de `09-liquidacion.md`) | Verbo | Por qué |
|---|---|---|
| "Este CFDI tiene folio fiscal vigente ante el SAT, RFC emisor y receptor coinciden" | **AFIRMA** | Resultado directo del webservice público del SAT. Hecho verificado, no opinión. |
| "Este mes llevas 12.3% de tu combustible pagado en efectivo, dentro del 15% de la válvula RFA 2.9" | **AFIRMA** | Es aritmética sobre datos propios acumulados por el sistema (contador acumulativo, ya diseñado en ola 1). |
| "Este gasto de $2,500 en hospedaje nacional, con CFDI válido, es Grupo B (viático), no tiene tope específico en LISR 28-V" | **AFIRMA con cita** | Dato de catálogo cerrado — la ola 1 verificó literalmente que no hay tope de hospedaje nacional en la fracción V. |
| "Este viático se erogó dentro de una faja de 50 km de la base de asignación del operador" | **CONDICIONA** | La ola 1 (`09-liquidacion.md` §3.1) ya marcó esto como "genuinamente ambiguo": depende de si "establecimiento" es el patio o la carretera, y de un dato — la base de asignación — que hay que capturar y que puede estar mal capturado. |
| "¿Este operador puede recibir viáticos o son precio de flete?" (régimen del operador: subordinado / servicios profesionales / permisionario integrante) | **CONDICIONA**, casi siempre hacia **RECHAZA la respuesta automática** | Es una calificación laboral y contractual, no un hecho de catálogo. El sistema puede mostrar la consecuencia de cada supuesto ("si es empleado, aplica X; si es permisionario, aplica Y") pero no debe decidir cuál es el régimen real — eso es un juicio jurídico sobre la relación entre las partes, exactamente el tipo de "acto propio de la profesión" de §1.2. |
| "¿El 15% de combustible en efectivo es mensual, acumulado del ejercicio o anual?" | **CONDICIONA, con la incertidumbre explícita** | La ola 1 lo dejó en "Pendientes de verificar" (00-RESUMEN, punto 9): la RFA no lo dice. El sistema debe mostrar el cálculo bajo el supuesto más conservador y decir, literal, que la periodicidad no está definida en la norma. |
| "¿Puedo deducir el 8% ciego este año? Perdí el 90% de exclusividad en agosto" | **CONDICIONA hacia RECHAZA** | Umbral de borde con consecuencia grave (doble pago, ola 1 "Riesgos abiertos": el 16% ya pagado no se recupera si se pierde la exclusividad). Alto costo de un error, dato de terceros involucrado (a quién más le presta servicio la flota). Corresponder a validación humana con fundamento, no a un "sí" o "no" automático. |
| "¿Cómo le hago para que este gasto de diésel en efectivo sí cuente, aunque ya me pasé del 15%?" | **RECHAZA** | Esto ya no es clasificar un hecho: es pedir ayuda para estructurar el hecho de forma que evada la regla. Coincide con la fracción I del CFF 89 ("asesorar […] para omitir total o parcialmente el pago de alguna contribución en contravención a las disposiciones fiscales"). |
| "El SAT me está auditando este viaje, ¿qué le contesto?" / "¿me conviene meter un recurso de revocación?" | **RECHAZA** | Litigio y representación — reserva de §1.2(b). Fuera del terreno del producto por diseño. |
| "¿Nunca me va a auditar el SAT si uso Likida?" | **RECHAZA** | Garantía de resultado — exactamente lo que `00-RESUMEN-EJECUTIVO.md` ya prohibió prometer en su tabla de promesas imposibles, y lo que dispara publicidad engañosa (§1.3). |
| "Este comprobante parece de un emisor en la lista 69-B / EFOS" | **AFIRMA el dato (está en la lista)**, **CONDICIONA la consecuencia** ("esto no prueba que la operación sea simulada, pero sí que debes revisarla antes de deducir") | Distingue el hecho verificable (aparece en una lista pública) de la conclusión jurídica (la operación es o no es real) — la segunda no la puede afirmar el sistema. |

---

## 4. Cómo expresar incertidumbre — la plantilla

El riesgo de producto identificado en el punto 7 del resumen (un LLM rellena huecos con el tono de un hecho) se controla con una estructura fija, no con instrucciones sueltas al modelo. Toda salida en modo **CONDICIONA** sigue este orden, sin excepción, y sin que el "SIN VERIFICAR" quede escondido en una pantalla distinta a la del veredicto:

```
[HECHO VERIFICADO]   → lo que el sistema sí comprobó, con la fuente.
[REGLA APLICABLE]    → artículo, fracción, fecha de la norma citada.
[SUPUESTO ABIERTO]   → el dato o la calificación que falta y que cambia el resultado.
[QUIÉN DECIDE]        → "esto lo confirma [tu contador / tú como contralor]", nunca "Likida decide".
[LEYENDA]             → la leyenda del art. 89/90 (ver §5.2), cuando el mensaje sugiere trato fiscal.
```

Ejemplo real, con el caso de la faja de 50 km:

> Este viático de $850 (hospedaje, CFDI válido a nombre del operador) se erogó en Saltillo. Según la base de asignación registrada para este operador (Monterrey), está a 220 km — fuera de la faja de 50 km del art. 28-V LISR / RLISR 57, así que **sí sería deducible por este criterio**.
> **Lo que no pudimos verificar:** si Monterrey es realmente donde el operador "presta normalmente sus servicios" en términos del RLISR 57, o si su base real es otra. Ese dato lo confirma el contralor o el expediente laboral del operador.
> *Este análisis no sustituye la opinión de tu contador y puede diferir de los criterios que dé a conocer el SAT.*

---

## 5. Redacción sugerida

Tres capas: la cláusula de contrato (Términos de Servicio), el aviso corto que va pegado a cada salida del producto, y las respuestas tipo del agente cuando debe rechazar. Es un modelo de redacción para que lo revise un abogado antes de publicarlo — no es asesoría legal formal, igual que el resto del material de esta serie.

### 5.1 Cláusula para Términos de Servicio (versión larga, combina Factorum + CONTPAQi + la leyenda del CFF 89/90)

> **Naturaleza del Servicio.** Likida es una herramienta tecnológica que automatiza la captura, validación y clasificación de comprobantes fiscales y la conciliación operativa de los gastos de un viaje, con apoyo de sistemas de inteligencia artificial, incluyendo agentes automatizados y modelos de lenguaje. Likida **no es un despacho contable, no es un contador público registrado ante el SAT, no emite dictámenes fiscales en los términos del artículo 52 del Código Fiscal de la Federación, ni representa al Cliente ante el Servicio de Administración Tributaria o ante cualquier tribunal.**
>
> El Cliente reconoce y acepta que los veredictos, clasificaciones, cálculos de contadores acumulativos y demás resultados que arroje la Plataforma constituyen información de apoyo, preparada a partir de las reglas fiscales vigentes al momento de su generación y citadas en cada caso, y que **el Cliente conserva en todo momento la responsabilidad exclusiva de validar dicha información**, incluso cuando el Cliente considere que la norma aplicable es otra o que las circunstancias del caso concreto ameritan un criterio distinto, antes de utilizarla para efectos de sus declaraciones, su contabilidad o cualquier otro efecto fiscal.
>
> Cuando la Plataforma utilice agentes o asistentes de inteligencia artificial para generar dichos resultados, el Cliente libera a Likida de responsabilidad respecto de las acciones que dichos agentes ejecuten conforme a las reglas, controles y consentimiento que el propio Cliente haya autorizado dentro de la Plataforma.
>
> **Manifestación conforme a los artículos 89 y 90 del Código Fiscal de la Federación.** Cuando la Plataforma presente información que sugiera un tratamiento fiscal determinado, se deja constancia por escrito de que dicho criterio **puede ser diverso al que, en su caso, den a conocer las autoridades fiscales** en términos del artículo 33, fracción I, inciso h) del Código Fiscal de la Federación, y de que el Cliente debe validarlo con un profesional autorizado antes de aplicarlo.
>
> En ningún caso la responsabilidad total de Likida frente al Cliente derivada del uso de la Plataforma excederá el monto efectivamente pagado por el Cliente en el periodo de facturación inmediato anterior al hecho que dio origen al reclamo.

### 5.2 Leyenda corta, para pegar en cada salida del producto (WhatsApp, dashboard, PDF de liquidación)

> *Esto es información preparada por el motor de reglas de Likida con fundamento citado, no es un dictamen ni una opinión de un contador público. Puede diferir de los criterios que dé a conocer el SAT. Valídalo con tu contador antes de usarlo en una declaración.*

Versión de una línea, para cuando el espacio es mínimo (badge inline junto a cada veredicto):

> *Preparado por el motor de reglas — no sustituye la opinión de tu contador.*

### 5.3 Pie de página del reporte de liquidación (PDF/Excel entregable)

> Este reporte fue generado automáticamente a partir de las reglas fiscales vigentes al {fecha de generación}, citadas junto a cada partida. Likida no es un contador público registrado ni un despacho fiscal, y este documento no constituye un dictamen en términos del artículo 52 del Código Fiscal de la Federación. Los criterios aquí aplicados pueden diferir de los que en su caso dé a conocer el Servicio de Administración Tributaria. La responsabilidad de validar cada partida antes de su uso en la contabilidad o las declaraciones del contribuyente corresponde a {razón social del cliente}.

### 5.4 Respuestas tipo cuando el agente debe rechazar

**Petición de planeación fiscal agresiva** ("¿cómo le hago para que esto sí pase como deducible?", "¿cómo evito el tope del 15%?"):

> No puedo ayudarte a estructurar un gasto para evadir un tope o un requisito — eso es justo lo que la ley castiga como práctica indebida, y me incluiría a mí como quien "asesora o presta servicios" para lograrlo (CFF art. 89). Lo que sí puedo hacer es mostrarte exactamente qué te falta para que el gasto cumpla la regla tal como está, o decirte cuánto margen te queda este mes en tus contadores acumulativos.

**Petición sobre litigio, auditoría en curso o defensa ante el SAT:**

> Esto ya no es clasificar un comprobante, es una decisión de defensa fiscal — y esa la tiene que tomar un abogado o contador con cédula, con el expediente completo. Puedo darte el histórico y los fundamentos de cada partida involucrada para que se los lleves a quien te represente, pero no puedo decirte qué contestarle al SAT.

**Zona gris sin dato suficiente** (falta base de asignación, falta régimen del operador, calificación laboral incierta):

> Con lo que tengo no puedo darte un sí o un no seguro — me falta [dato específico], y de eso depende el resultado. Te muestro las dos lecturas posibles y lo que cambia en cada una; la decisión de cuál aplica a este operador le corresponde a [tu contador / ti como contralor], porque es una calificación jurídica, no un dato del comprobante.

**Confirmación de garantía de resultado** ("¿me garantizas que no me van a auditar?", "¿esto seguro pasa?"):

> No puedo garantizarte eso — ninguna herramienta puede, y prometerlo sería publicidad engañosa de mi parte. Lo que sí te puedo garantizar es que cada veredicto que te doy trae el fundamento legal exacto y las condiciones bajo las que aplica, para que tu revisión (o la del SAT) tenga menos sorpresas.

**Petición de que el agente reemplace, no asista, al contador de la empresa** ("ya no necesito contador, ¿verdad?"):

> Te ahorro el trabajo repetitivo de clasificar y cuadrar cada comprobante, con la regla citada en cada uno — pero no reemplazo a tu contador. Hay decisiones (el régimen del operador, cómo declarar un caso de borde, cómo responder a una revisión) que legalmente le tocan a alguien con cédula, no a un sistema.

**Comprobante que podría ser apócrifo o de un emisor en el 69-B:**

> Este emisor aparece en la lista pública de contribuyentes con operaciones simuladas del SAT (69-B). Eso no prueba por sí solo que esta operación en particular sea falsa, pero sí es una alerta que debes revisar antes de deducir este gasto — te recomiendo que lo confirmes con tu contador antes de incluirlo en la liquidación.

---

## Acciones concretas

| Acción | Por qué importa | Esfuerzo | Cuándo |
|---|---|---|---|
| Insertar la leyenda del art. 89/90 (§5.2, versión corta) en **cada** salida del motor que sugiera trato fiscal — WhatsApp, dashboard, PDF | Es la mitigación que la propia ley ofrece para el agravante del 10%–20%, y solo funciona si está "por escrito" en la opinión misma, no en un ToS aparte | Bajo | Antes de la demo del 6-ago, cierra la acción #2 de la Fase 0 del resumen ejecutivo |
| Prohibir por diseño (guardrail de prompt + validación de UI) que cualquier salida use las palabras "dictamen", "garantizo", "seguro" o equivalentes sin condicional | Evita pisar la reserva del CFF 52 (dictamen) y la publicidad engañosa del LFPC 32 en el mismo movimiento | Bajo | Antes de la demo |
| Implementar el tercer verbo (RECHAZA) como categoría explícita del agente, con las seis plantillas de §5.4 cableadas a los patrones de pregunta que las disparan | Sin esto, un LLM sin instrucción explícita tiende a "condicionar" una respuesta a preguntas que en realidad debería rechazar (planeación, litigio) | Medio | Fase 1 (núcleo del producto, junto con el motor de reglas) |
| Adoptar la cláusula de IA de CONTPAQi (§2, columna 3) como base de la cláusula de Términos de Servicio de Likida, condicionando la liberación de responsabilidad a que el contralor tenga control real (aprobar/editar reglas, no solo aceptar el ToS una vez) | Es el estándar ya probado en el mercado mexicano de software fiscal, y liga la protección legal a una obligación de producto (dar control real al usuario) que de todas formas hay que construir | Medio | Fase 0–1, junto con el contrato de servicio |
| Registrar con timestamp y usuario cada vez que un contralor decide seguir adelante después de que el sistema marcó un "SIN VERIFICAR" o "CONDICIONA" | Es la evidencia que sostiene la defensa de "negligencia inexcusable de la víctima" en un eventual reclamo bajo CCF 1910/1913 | Medio | Fase 1, mismo entregable que la máquina de estados "EN EXCEPCIÓN" ya diseñada en `09-liquidacion.md` |
| Verificar en el PDF original del Anexo 5 de la RMF 2026 el monto exacto de la multa del CFF art. 90 antes de citarlo en cualquier material comercial o legal | Dos fuentes secundarias coinciden en $79,130–$124,380, pero ninguna investigación de esta serie leyó el Anexo 5 directamente | Bajo | Antes de publicar el contrato o la cláusula de §5.1 con el monto citado |
| Si Likida en algún momento construye una herramienta de diseño de prorrateo de gastos comunes entre integrantes de un coordinado, volver a evaluar el Título Sexto del CFF (esquemas reportables) con un fiscalista | La fracción VI(b) del art. 199 toca reestructuras entre partes relacionadas sin contraprestación — hoy no aplica, pero ese feature específico lo acercaría | Bajo (solo repetir la consulta) | Solo si ese feature entra al roadmap |

---

## CONFLICTOS

No se encontró contradicción directa con otro documento de la ola 1. Un punto de reconciliación, no de conflicto:

- `00-RESUMEN-EJECUTIVO.md` y `01-cfdi-cff.md` marcan el monto de la multa del CFF art. 90 ($79,130–$124,380) como **SIN VERIFICAR**, con la nota "no los uses en material comercial hasta leerlos en el Anexo 5". Esta ola encontró el mismo monto y la misma fecha de actualización (DOF 28-12-2025) en un segundo compilador independiente (mley.mx), pero **tampoco leyó el PDF original del Anexo 5**. No se resuelve el pendiente — se corrobora con una segunda fuente secundaria y se mantiene la misma advertencia. Ver acción correspondiente arriba.

---

## SIN VERIFICAR

1. **Monto exacto de la multa del CFF art. 90 en el texto original del Anexo 5 de la RMF 2026.** Corroborado en dos compiladores legislativos (mley.mx y el hallazgo previo de la ola 1) con la misma cifra, pero ninguno es el PDF oficial del DOF/SAT. No usar en contratos ni en material comercial sin leerlo en fuente primaria.
2. **Si algún tribunal o precedente mexicano ha aplicado el art. 250 del CPF (usurpación de profesión) a un software, SaaS o sistema de IA.** No se localizó ningún caso publicado en esta investigación. El riesgo descrito en §1.2(c) es preventivo, construido sobre el texto de la ley y no sobre jurisprudencia aplicada al sector.
3. **Contenido completo de los Términos y Condiciones de Zumma más allá de lo indexado por la búsqueda.** Se leyó la introducción y las condiciones generales; no se confirmó si existe, en una sección no localizada, una cláusula equivalente a la de CONTPAQi sobre IA o sobre validación del resultado por el usuario. No afirmar en material comparativo que "Zumma no tiene descargo" sin leer el documento completo.
4. **Si existe en México un proyecto de ley de responsabilidad civil específico para sistemas de IA con probabilidad real de aprobarse en el corto plazo.** Los análisis leídos (marzo y febrero de 2026) coinciden en que hoy no existe ley específica y que se aplica el régimen general (CCF 1910/1913-1914), pero son artículos de doctrina/despacho, no fuente oficial. Revisar iniciativas en el Senado o la Cámara de Diputados antes de asumir que el marco actual seguirá siendo el único aplicable durante todo 2026-2027.
5. **Si "Contador Público" (la denominación exacta usada hoy por la SEP y el CFF) es jurídicamente la misma profesión que "Contador"** (la palabra que usa el transitorio de 1973 de la Ley Reglamentaria del art. 5º). Se asume que sí por continuidad histórica y porque el CFF 52 usa "contador público" con cédula de la SEP como requisito del dictamen, pero no se localizó un texto que haga esa equivalencia de forma expresa.
6. **Textos completos de los Términos y Condiciones de Clara México ajenos al Contrato de Comisión Mercantil** (por ejemplo, si existe una sección separada de "Términos y Condiciones" generales, no solo el contrato de pagos, con cláusulas de IA o de responsabilidad sobre categorización de gastos). Solo se leyó el contrato de comisión para pagos a terceros.

---

## Fuentes

**Primarias — legislación y reglamentos:**
- [Código Fiscal de la Federación, art. 19](https://leyes-mx.com/codigo_fiscal_de_la_federacion/19.htm) — representación ante autoridades fiscales
- [Código Fiscal de la Federación, art. 52](https://leyesmx.com/cff/articulo/52/) — dictamen fiscal, Contador Público Registrado
- [Reglamento del CFF, art. 52](https://www.gob.mx/cms/uploads/attachment/file/431968/34_rcff.pdf) — requisitos de inscripción del contador público
- [Código Fiscal de la Federación, art. 90](https://mley.mx/CFF/articulo/90/) — multa por infracciones del art. 89, agravante y mitigación por escrito
- [Código Fiscal de la Federación, art. 197](https://mley.mx/CFF/articulo/197/) — definición de asesor fiscal, obligación de revelar esquemas reportables
- [Código Fiscal de la Federación, art. 198](http://www.apta.com.mx/aptace/leyes/articulo.php?actua=1728&art=198&inc=&ley=CFF) — obligación del contribuyente de revelar
- [Código Fiscal de la Federación, art. 199](https://leyes-mx.com/codigo_fiscal_de_la_federacion/199.htm) — 14 características de un esquema reportable, definición de esquema generalizado/personalizado
- [Ley Federal de Procedimiento Contencioso Administrativo, art. 5](https://leyes-mx.com/ley_federal_de_procedimiento_contencioso_administrativo/5o.htm) — representación en juicio, licenciado en derecho
- [Ley Reglamentaria del Artículo 5º Constitucional relativo al ejercicio de las profesiones en la Ciudad de México](https://www.diputados.gob.mx/LeyesBiblio/pdf/208_190118.pdf) — arts. 1, 2, 24; y [texto con el Transitorio Segundo del Decreto de 1973 (lista de profesiones)](https://mexico.justia.com/federales/leyes/ley-reglamentaria-del-articulo-o-constitucional-relativo-al-ejercicio-de-las-profesiones-en-la-ciudad-de-mexico/)
- [Código Penal Federal, art. 250](https://leyes-mx.com/codigo_penal_federal/250.htm) — usurpación de profesión
- [Código Civil Federal, art. 1910](https://leyes-mx.com/codigo_civil_federal/1910.htm) — responsabilidad civil por culpa
- [Ley Federal de Protección al Consumidor, art. 32](https://leyes-mx.com/ley_federal_de_proteccion_al_consumidor/32.htm) — publicidad engañosa
- [PROFECO — Lineamientos y guía de publicidad engañosa](https://www.profeco.gob.mx/juridico/Documentos/SSC/Normatividad_TomoIV/Publicidad%20enga%C3%B1osa.pdf)

**Términos y condiciones reales, leídos para esta ola:**
- [Zumma — Términos y condiciones](https://www.zummafinancial.com/terms-and-conditions-1) y [Aviso de Privacidad](https://www.zummafinancial.com/privacy-policy)
- [Clara — Contrato de Comisión Mercantil para pagos a terceros (PDF)](https://8117504.fs1.hubspotusercontent-na1.net/hubfs/8117504/Clara/Website/legal/ToS-V.5.pdf) y [portal de documentación legal](https://www.clara.com/legal-documentation/mx-terms-and-conditions)
- [Facturama — Términos y Condiciones de Uso del Servicio (PDF)](https://cdnfacturama.azureedge.net/content/docs/Facturama-terminos-y-condiciones-del-servicio.pdf)
- [Factorum — Términos y Condiciones Generales](https://www.factorum.com.mx/terminosycondiciones)
- [CONTPAQi — Licencia de Uso Nube](https://www.contpaqi.com/licenciasdeuso/aplicativos-y-programas-de-nube) y [Términos y Condiciones Portal de Aplicaciones](https://sitioinstitucional.blob.core.windows.net/contenido-sitio/CONTPAQi_Nube/t%C3%A9rminos-condiciones-portal-aplicaciones.html)

**Secundarias, usadas solo como pista o para corroborar (no como fundamento normativo):**
- [Responsabilidad civil por inteligencia artificial en México — Abogados en Guadalajara, mar-2026](https://www.juridico-integral.com/responsabilidad-civil-por-inteligencia-artificial-en-mexico-quien-responde-cuando-un-algoritmo-causa-danos/)
- [La responsabilidad civil en el uso de sistemas de IA — Revista Inteligencia Artificial, feb-2026](https://www.revistainteligenciaartificial.com/2026/02/la-responsabilidad-civil-en-el-uso-de-sistemas-de-inteligencia-artificial-criterios-de-analisis-en-el-derecho-mexicano/)
- [Facturama — servicios contables y asesoría fiscal humana como producto aparte](https://facturama.mx/blog/servicios-contables-en-mexico/)
- [Facturama — qué es un Contador Público Registrado](https://facturama.mx/blog/que-significa/cpr-contador-publico-registrado/)

**Documentos internos de la ola 1 citados:**
- `00-RESUMEN-EJECUTIVO.md` — tabla de promesas prohibidas, riesgos legales de Likida, acción pendiente "redactar la leyenda de los arts. 89 y 90"
- `01-cfdi-cff.md` §6 — CFF 89/90 aplicado a Likida como tercero, canales de denuncia
- `09-liquidacion.md` §3.1, §3.9 — faja de 50 km, régimen del operador, RFA regla 2.5 (prorrateo entre integrantes de un coordinado)
- `10-contradicciones.md` §1 — criterio 1/LIF/PI, fracción II, verificado vigente
