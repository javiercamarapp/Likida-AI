# Obligaciones NO fiscales del autotransporte federal

> Investigado el 27-jul-2026 para Likida.ai. Fundamentos citados. Lo no verificado va marcado.

---

## Resumen para el fundador

Un camión de carga federal no se detiene por el SAT. Se detiene porque le falta un papel de la SICT
o porque un elemento de la Guardia Nacional lo pesa en una báscula y sale sobrado. Hay dos capas
distintas y Likida las confunde si no las separa:

1. **Obligaciones del permisionario y de la unidad** (permiso SICT, placas, tarjeta de circulación,
   dictamen físico-mecánico anual, verificación de emisiones semestral, póliza de seguro). No se
   pagan por viaje, se pagan por unidad y por año. Pero **si vencen, cada viaje que salga después
   es un pasivo contingente.**
2. **Obligaciones que se rompen dentro del viaje** (exceso de peso, exceso de horas de conducción,
   falta de bitácora, licencia vencida, falta de carta de porte). Estas sí generan un gasto que
   aparece en la liquidación: multa, grúa, corralón, transbordo de carga.

Los tres números que hay que tener en la cabeza: **la UMA 2026 vale $117.31** y casi todas las
multas se cuentan en múltiplos de ella; **el seguro de responsabilidad civil que la SICT exige para
un permiso de carga especializada es de 19,000 UMA por vehículo ($2.23 millones)**; y **el tope de
responsabilidad del transportista cuando el cliente no declara el valor de la mercancía es de 15
UMA por tonelada, o sea ~$1,760 por tonelada** (art. 66 fr. V LCPAF) — una carga de 20 toneladas
vale $35 mil pesos si el usuario no declaró valor.

Dos cambios recientes importan mucho: **desde el 26-may-2026 quien multa en carretera federal es la
Guardia Nacional, no la Policía Federal** (reforma al Reglamento de Tránsito, DOF 25-may-2026), y
los formatos de boleta de infracción se van a rehacer en los siguientes 180 días. Y **desde jul-oct
de 2025 la SICT fusionó, digitalizó y eliminó decenas de trámites** (incluido el canje de placas),
además de que hay una crisis de emplacamiento que obligó a autorizar un **permiso provisional para
circular sin placas** (DOF 07-oct-2025).

Lo que Likida debe construir: un registro de vencimientos por unidad y por operador, y un validador
de multas contra el tabulador en UMA. Lo que no debe prometer: que valida permisos contra la SICT
(no hay API pública verificada) ni que su bitácora derivada sustituye a la legal.

---

## 1. Quién manda sobre qué (mapa de autoridades, 2026)

| Autoridad | Qué controla | Fundamento |
|---|---|---|
| **SICT** (antes SCT) | Permisos, placas, tarjeta de circulación, licencia federal, NOMs de transporte, pesos y dimensiones en centros fijos | LCPAF art. 5o. fr. III, IV y VI; art. 70. El nombre "Secretaría de Infraestructura, Comunicaciones y Transportes" está en el art. 2o. fr. VI LCPAF, **reformado DOF 16-jul-2025** |
| **DGAF** (Dirección General de Autotransporte Federal) | Permisos, licencia federal, calendarios de verificación | Reglamento Interior SICT art. 23 |
| **DGPMPT** (Dirección General de Protección y Medicina Preventiva en el Transporte) | Constancia de aptitud psicofísica de los operadores | Reglamento del Servicio de Medicina Preventiva en el Transporte |
| **Guardia Nacional** (adscrita a SEDENA) | Tránsito, boletas de infracción, retiro de circulación, dictamen técnico de hechos de tránsito | RTCPJF art. 2o. fr. XXII Bis, **adicionada por DECRETO DOF 25-may-2026** (en vigor 26-may-2026) |
| **SEMARNAT** | Norma de emisiones (NOM-045 y NOM-167) | Aviso DOF 03-abr-2026, transitorio SEGUNDO |
| **Unidades de Inspección acreditadas y aprobadas** | Emiten el dictamen físico-mecánico y el certificado de emisiones | NOM-068-SCT-2-2014 num. 5.3.1 |

> **Verificado.** La reforma que traslada las funciones de tránsito de la Policía Federal a la
> Guardia Nacional se publicó en el DOF el **25 de mayo de 2026**, firmada por Claudia Sheinbaum
> Pardo el 19-may-2026, y entró en vigor al día siguiente de su publicación. El transitorio CUARTO
> da **180 días** a la SEDENA para emitir los formatos de boleta de infracción, amonestación
> escrita, Acta-Convenio y dictamen técnico. Es decir: **entre mayo y noviembre de 2026 conviven
> formatos viejos y nuevos**.

---

## 2. El permiso SICT: la licencia para existir

### 2.1 Cuándo se necesita

- **Se requiere permiso** de la SICT para "la operación y explotación de los servicios de
  autotransporte federal de carga, pasaje y turismo" (LCPAF **art. 8o. fr. I**) y para "el
  transporte privado de personas y de carga" (fr. XI).
- **No se requiere permiso** para transporte privado en "vehículos de menos de 4 toneladas de carga
  útil. Tratándose de personas morales, en vehículos hasta de 8 toneladas de carga útil"
  (LCPAF **art. 40 fr. II**). Ojo: la excepción es solo para transporte **privado** (bienes propios
  o conexos a la actividad, sin cobro), no para quien presta el servicio a terceros.
- El permiso de carga "autoriza a sus titulares para realizar el autotransporte de cualquier tipo
  de bienes en todos los caminos de jurisdicción federal" (LCPAF **art. 50**). No hay rutas
  asignadas en carga, a diferencia de pasaje.
- **Los permisos se otorgan por tiempo indefinido** (LCPAF **art. 8o., penúltimo párrafo**). No se
  renuevan. Lo que sí se mueve son las altas y bajas de vehículos y la tarjeta de circulación.
- Plazo de resolución: 30 días naturales, hasta 45 por complejidad; **afirmativa ficta** en los
  casos que señale el reglamento (LCPAF **art. 9o.**).

### 2.2 Carga general vs. carga especializada

- **Carga general**: "el traslado de todo tipo de mercancías por los caminos de jurisdicción
  federal, siempre que lo permitan las características y especificaciones de los vehículos"
  (RAFSA art. 40).
- **Carga especializada**: materiales, residuos, remanentes y desechos peligrosos; objetos
  voluminosos o de gran peso; fondos y valores; grúas industriales; y automóviles sin rodar en
  vehículo tipo góndola (RAFSA art. 41).

Esto no es cosmético: la carga especializada tiene **requisitos de seguro y de NOMs distintos** y
la licencia del operador cambia (categoría E).

### 2.3 Requisitos vigentes del permiso (actualizados en 2025)

El **ACUERDO por el que se establecen acciones de simplificación para trámites que se realizan ante
la SICT, DOF 02-jul-2025** (en vigor 09-jul-2025) reescribió los requisitos y renombró las
homoclaves de `SCT-` a `SICT-`. Requisitos verificados en el texto del DOF:

**SICT-03-008-A — Permiso de autotransporte federal de carga general:**
1. Pre-registro en línea.
2. Personalidad jurídica: identificación oficial vigente + **constancia que acredite el registro
   ante la SICT**.
3. Propiedad o legal posesión del vehículo (factura, carta factura vigente o contrato de
   arrendamiento vigente). Para vehículos **con más de dos años de antigüedad y antecedente de
   servicio público federal: dictamen de condiciones físico-mecánicas vigente**.
4. Póliza de seguro de responsabilidad civil por daños a terceros **o fondo de garantía** vigente.
   *(Este trámite no fija monto en el Acuerdo.)*
5. Comprobante de pago del trámite.
6. **Certificado de emisión de contaminantes vigente del último periodo** o constancia de exención.

**SICT-03-008-B — Permiso de carga especializada:** lo anterior más:
- Póliza de RC por daños a terceros **por el equivalente a 19,000 UMA**.
- **Póliza de seguro de daños ecológicos por 7,954 UMA**, con comprobante de pago, **por vehículo**.
- Constancia del fabricante/reconstructor sobre el material de los autotanques, memoria de cálculo,
  croquis de distribución de carga y pruebas de integridad estructural conforme a la
  **NOM-020-SCT2/1995**.
- Constancia de cumplimiento de la **NOM-035-SCT-2-2010** para remolques y semirremolques año
  modelo 2010 en adelante.

Otros trámites de carga con monto de seguro expreso en el mismo Acuerdo:
- **SICT-03-039** (carga general y especializada, franja fronteriza con EUA): RC mínimo **19,000
  UMA**; si es de materiales y residuos peligrosos, seguro de daños ecológicos por **7,954 UMA**.
- **SICT-03-040** (carga especializada de materiales y residuos peligrosos): RC mínimo **19,000
  UMA por vehículo** + daños ecológicos **7,954 UMA**.
- **SICT-03-012** (arrastre / arrastre y salvamento): RC **23,266 UMA**, con endoso de no
  cancelación o mención de ser seguro obligatorio y renovable anualmente 30 días antes del
  vencimiento; además constancia de cumplimiento de la **NOM-053-SCT-2023** para el equipo de grúa.
- **SICT-03-014** (depósito de vehículos / corralón): RC **100,000 UMA**.

**Traducción a pesos con la UMA 2026 ($117.31 diarios):**

| Requisito | UMA | Pesos 2026 |
|---|---:|---:|
| RC daños a terceros (carga especializada, fronteriza, peligrosos, arrendadoras) | 19,000 | **$2,228,890.00** |
| Seguro de daños ecológicos (peligrosos) | 7,954 | **$933,083.74** |
| RC arrastre y salvamento | 23,266 | **$2,729,334.46** |
| RC depósito de vehículos | 100,000 | **$11,731,000.00** |

> **Nota de precisión.** El Acuerdo dice "Unidades de Medida y Actualización (UMA)" sin especificar
> si es la diaria, mensual o anual. La lectura estándar del sector es la **diaria**, que es la que
> usé arriba. Si un asegurador o un Centro SICT interpretara la mensual, el monto se multiplica por
> ~30. **Verificar con el Centro SICT antes de poner esta cifra en cualquier material de venta.**

### 2.4 Costos oficiales 2026 (Ley Federal de Derechos)

LFD art. 148, texto vigente con última reforma **DOF 07-11-2025** y cantidades actualizadas por
**Resolución Miscelánea Fiscal DOF 28-12-2025** (es decir, cifras 2026):

| Concepto | Presencial | En línea |
|---|---:|---:|
| Permiso de autotransporte federal, por vehículo motriz — incluye permiso, alta vehicular, **dos placas**, calcomanía y tarjeta de circulación (art. 148 A.I.a).1) | **$5,271.29** | **$4,020.22** |
| Alta de vehículo motriz adicional al permiso (art. 148 D.I.a) | $4,359.10 | $3,724.15 |
| Alta de unidad de arrastre — incluye una placa, calcomanía y tarjeta (art. 148 D.I.b) | $3,111.43 | $2,476.49 |
| Alta de vehículo en arrendamiento o cambio de modalidad (art. 148 D.I.c) | $1,228.83 | $593.89 |
| Reposición de placa (art. 148 A.III.a) | $1,346.93 | — |
| Reposición de calcomanía (art. 148 A.III.b) | $217.96 | — |
| Revalidación de tarjeta de circulación (art. 148 A.III.c) | $781.23 | — |
| Modificación o reposición de tarjeta de circulación | $313.51 | — |
| **Licencia Federal Digital**: emisión, categoría adicional, cambio de categoría o renovación (art. 148 C) | **$212.63** | — |
| Autorización especial de conectividad (art. 148 A.II.d) | $963.23 | — |
| Cesión de derechos del permiso (art. 148 A.II.a) | $3,293.84 | — |
| Permiso de transporte privado (art. 149 fr. I) | $2,804.02 | — |
| Tarjeta de circulación de transporte privado (art. 149 fr. II) | $1,643.28 | — |
| Revalidación de tarjeta de transporte privado (art. 149 fr. IV) | $1,346.93 | — |

> **Trampa documentada.** La LFD **sigue conteniendo la cuota de "canje de placas metálicas"**
> ($2,747.76 automotores / $1,368.98 remolques, art. 148 B) aunque el trámite fue **eliminado** por
> el ACUERDO DOF 16-oct-2025. La ley fiscal no se limpió; el trámite ya no existe. Si un proveedor
> le cobra "canje de placas" a una flota en 2026, es señal de alarma.

### 2.5 Simplificación 2025: qué se fusionó, qué se eliminó

**ACUERDO DOF 02-jul-2025** (vigor 09-jul-2025):
- Actualización masiva de homoclaves de `SCT-` a `SICT-`.
- Reducción de requisitos en 11 permisos (turismo internacional, carga general y especializada,
  arrastre y salvamento, depósito de vehículos, materiales peligrosos, entre otros).
- Eliminación del trámite `SCT-05-008` (Aviso de informe de evaluación de capacitación).

**ACUERDO DOF 16-oct-2025** (vigor 23-oct-2025):
- **Se eliminan**: `SCT-03-003-A`, `-B` y `-C` (**canje de placas metálicas** de carga, pasaje y
  turismo, y de carga especializada de materiales peligrosos) y `SCT-03-033` (duplicado de Licencia
  Federal Digital).
- Se fusionan 17 trámites; nacen `SICT-03-010` (baja de vehículos) y `SICT-03-045` (alta de
  vehículos adicionales al permiso).
- La SICT se dio 120 días para ajustar formatos, sistemas y plataformas.

### 2.6 Placas, tarjeta de circulación y el permiso provisional (crisis 2025-2026)

- Para transitar, el vehículo, remolque o semirremolque necesita **placas, tarjeta de circulación y,
  en su caso, engomado vigentes**; el original de la tarjeta va en el vehículo y se entrega para
  revisión a la autoridad (RTCPJF **art. 85**, reformado 2026 para sustituir "Policía Federal" por
  "persona integrante de la Guardia Nacional").
- **Falta de placas/tarjeta/engomado**: multa de **15 a 20 cuotas diarias** en vehículos
  particulares y **30 a 40 cuotas diarias en vehículos de autotransporte federal, servicios
  auxiliares y transporte privado** (RTCPJF **art. 86 fr. II**) = **$3,519.30 a $4,692.40** con UMA
  2026.
- **Novedad 2026**: el nuevo **art. 86 Bis** RTCPJF (adicionado DOF 25-may-2026) dice que **no se
  sanciona** la falta de placas, tarjeta o engomado si se presenta (I) acta ministerial por robo o
  extravío con antigüedad no mayor a 15 días naturales, o (II) constancia original del trámite de
  reposición o refrendo con antigüedad no mayor a 30 días naturales.
- **AVISO DOF 07-oct-2025**: la SICT autorizó el uso de un **Permiso Provisional para Circular sin
  Placas ni Engomado**, con vigencia de **hasta 180 días naturales** desde su emisión, que "surtirá
  los mismos efectos que la portación de la placa metálica". Debe portarse visible, con el número de
  identificación vehicular y un **código QR** ligado a la tarjeta de circulación y al **SIAF**
  (Sistema Institucional de Autotransporte Federal). Se complementa con el **balizamiento** del
  Aviso DOF 07-feb-2025.

### 2.7 El registro ante la SICT

- LCPAF **art. 11**: "La Secretaría llevará internamente un registro de las sociedades que presten
  servicios de autotransporte o sus servicios auxiliares."
- LCPAF **art. 36, párrafo 4**: "La Secretaría llevará un registro de las licencias que otorgue"
  (desarrollado en RAFSA art. 91, con el objeto de evaluar la incidencia de infracciones y la
  participación en accidentes de cada conductor).
- Desde el ACUERDO DOF 02-jul-2025, **todos** los trámites de permiso exigen presentar una
  **"constancia que acredite el registro ante la SICT"**. Ese registro es hoy la puerta de entrada
  al sistema.

> **SIN VERIFICAR:** cuál es la homoclave, el costo y el procedimiento exacto para obtener esa
> "constancia de registro ante la SICT". No lo encontré en fuente primaria en esta investigación.

---

## 3. Licencia Federal de Conductor

### 3.1 La obligación y de quién es

- "Los conductores de vehículos de autotransporte federal deberán obtener y, en su caso, renovar,
  la licencia federal que expida la Secretaría" (LCPAF **art. 36**, primer párrafo).
- **"Los permisionarios están obligados a vigilar y constatar que los conductores de sus vehículos
  cuentan con la licencia federal vigente"** (LCPAF art. 36, párrafo tercero). Esta frase es la que
  convierte un problema del operador en un problema de la flota.
- "Los permisionarios de los vehículos son **solidariamente responsables** con sus conductores [...]
  de los daños que causen con motivo de la prestación del servicio" (LCPAF **art. 38**).
- "Los permisionarios tendrán la obligación [...] de proporcionar a sus conductores capacitación y
  adiestramiento" (LCPAF **art. 37**), en escuelas o centros con reconocimiento oficial de la
  Secretaría (RAFSA **art. 93-C**).
- Quedan exceptuados los conductores de los vehículos de los arts. 40 y 44 LCPAF (transporte privado
  bajo los umbrales de tonelaje y arrendadoras de automóviles particulares).

### 3.2 Categorías (ACUERDO DOF 25-feb-2016)

| Cat. | Autoriza a conducir |
|---|---|
| **A** | Autotransporte federal de pasajeros (salvo de/hacia puertos y aeropuertos) y de turismo (salvo chofer-guía); transporte privado de personas |
| **B** | **Autotransporte federal de carga y transporte privado de carga, en todas sus modalidades, EXCEPTO doblemente articulados y materiales/residuos peligrosos** |
| **C** | Vehículos de **dos o tres ejes (rabón o tortón)** de carga federal y privada, excepto peligrosos |
| **D** | Turismo en modalidad chofer-guía (requiere credencial de guía de turistas de SECTUR) |
| **E** | (a) **Tractocamiones doblemente articulados (TSR y TSS)** en todas sus variantes; y/o (b) carga especializada de **materiales, residuos, remanentes y desechos peligrosos** |
| **F** | Pasajeros de o hacia puertos marítimos y aeropuertos federales |

Para la categoría **E** la Secretaría constata en sus sistemas que el solicitante tenga **más de dos
años de experiencia en las categorías B o C**, y el certificado de capacitación debe señalar
expresamente para cuál de los dos supuestos (a o b) autoriza.

### 3.3 Vigencia — y una contradicción normativa que hay que conocer

- **ACUERDO DOF 25-feb-2016, ARTÍCULO TERCERO**: "La Licencia Federal de Conductor categorías A, B,
  C, D y F, una vez expedida, deberá renovarse **cada 4 años**. La Licencia Federal de Conductor
  categoría E [...] deberá renovarse **cada 2 años**."
- **RAFSA art. 90** (reformado DOF 08-08-2000) todavía dice: "La licencia federal de conductor
  tendrá una vigencia de **diez años** y deberá refrendarse **cada dos años**."
- La ficha del trámite **SICT-03-028-A** en el Catálogo Nacional (gob.mx) declara **vigencia de 4
  años**, costo $205 y respuesta en 1 día hábil.

**Cómo resolverlo en producto:** modelar **4 años (A, B, C, D, F) y 2 años (E)**, que es lo que
aplica la DGAF y lo que dice el acuerdo específico posterior. Pero no afirmar en un documento
comercial que "el reglamento dice 4 años", porque no lo dice. Y el costo autoritativo es el de la
**LFD art. 148 C: $212.63** en 2026, no los $205 de la ficha (que parece rezagada).

### 3.4 Licencia Federal Digital

**ACUERDO DOF 01-abr-2022** (SICT):
- La licencia se porta en la app **"Licencia Federal Digital"** o en versión impresa.
- **La impresión tiene los mismos efectos jurídicos que la digital, pero con vigencia de UN MES
  contado desde su impresión** (art. 3, inciso b). Es decir: una foto vieja del PDF impreso no
  prueba nada.
- La licencia contiene: número, foto, nombre, nacionalidad, CURP, **número de expediente médico**,
  lugar/fecha/hora de emisión, inicio y término de vigencia, **código QR**, antigüedad,
  categorías autorizadas, validez nacional o internacional y observaciones médicas (diabetes,
  hipertensión, uso de lentes) (arts. 6 y 11).
- La autoridad valida leyendo el QR. **"En ningún caso se requerirá la entrega del teléfono celular
  ni del documento impreso a la autoridad requirente"** (art. 14).
- El transitorio QUINTO eliminó el trámite `SCT-03-033` a partir del **01-abr-2025**, "al considerar
  que vence la vigencia de la última licencia federal física de conductor expedida".

### 3.5 Requisitos para obtener y renovar

Según ACUERDO DOF 25-feb-2016 y ficha SICT-03-028-A:
1. **Constancia de aptitud psicofísica vigente** (examen de la DGPMPT o médico tercero autorizado).
2. **Certificado de capacitación vigente**, de centro con reconocimiento SICT.
3. Comprobante de pago de derechos ($212.63).
4. CURP y pre-registro en Ventanilla Única con número médico.
5. Para A, B, C, D y F: documento que acredite mayoría de edad. Para la modalidad internacional:
   21 años y comprobante de conocimientos de inglés.

**La constancia de aptitud psicofísica** se obtiene con el **Examen Psicofísico Integral**, que
evalúa agudeza visual, auditiva, cardiología y toxicología, con **periodicidad de dos años**, "con
la excepción de aquellos casos en los que se señale una periodicidad diferente" (Requisitos médicos
relativos al personal del autotransporte público federal, DGPMPT, **Artículo Octavo**; texto
integrado 14-feb-2018). Hay causales que acortan la periodicidad (por ejemplo, porcentaje de grasa
corporal fuera de rango).

> Consecuencia práctica: **cada operador genera al menos dos gastos recurrentes** — el examen
> psicofísico cada 2 años y el curso de capacitación para el refrendo de licencia. Estos son gastos
> de nómina/administración, no de viaje, pero un contralor los quiere ver amarrados al expediente
> del operador.

### 3.6 Suspensión y cancelación (lo que apaga a un operador)

**Cancelación** (RAFSA art. 92) — inhabilita para conducir autotransporte federal **por diez años**:
1. Sentencia ejecutoriada por delitos cometidos como conductor de autotransporte federal.
2. Accidente en el que el conductor no avise de inmediato a la autoridad, no auxilie a lesionados o
   abandone el vehículo.
3. **La tercera infracción por rebasar límites de velocidad en un periodo de doce meses.**
4. Alterar datos de la licencia.

**Suspensión por seis meses** (RAFSA art. 93):
1. Permitir a una persona no autorizada conducir el vehículo a su cargo.
2. **La segunda infracción por exceso de velocidad en doce meses.**

**Prohibiciones al volante** (LCPAF art. 36, párrafo reformado DOF 01-12-2020): conducir en estado
de ebriedad o bajo drogas de abuso, hablar por celular salvo manos libres, leer o enviar mensajes
de texto, y rebasar los máximos de velocidad.

**Alcohol cero para carga**: la Ley General de Movilidad y Seguridad Vial, **art. 49 fr. XII inciso
b)**, prohíbe conducir "con **cualquier concentración de alcohol** por espiración o litro de sangre"
en vehículos destinados al transporte de pasajeros **y de carga**. El límite general (0.25 mg/L)
no aplica a un tráiler. Y el art. 51 ordena retirar la licencia por **no menos de seis meses** a
conductores de transporte de carga sorprendidos manejando bajo el influjo de alcohol o drogas.

---

## 4. Seguros obligatorios (hay tres, no uno)

### 4.1 Seguro de RC vehicular obligatorio (todos los vehículos)

- **LCPAF art. 63 Bis** (adicionado DOF 21-05-2013): "Todos los vehículos que transiten en vías,
  caminos y puentes federales deberán contar con un seguro que garantice a terceros los daños que
  pudieren ocasionarse en sus bienes y personas por la conducción del vehículo. **La contratación
  del seguro será responsabilidad del propietario del vehículo.**"
- **Montos mínimos** — ACUERDO 07/2014 de la SHCP, **DOF 27-mar-2014**, Regla TERCERA:

  | Cobertura | Mínimo |
  |---|---:|
  | Daños materiales | **$50,000.00** |
  | Daños a personas (lesiones y muerte) | **$100,000.00** |

  La SHCP "podrá revisar anualmente los montos mínimos de cobertura, de acuerdo a los datos de
  siniestralidad del año inmediato anterior". Desde **2019 y siguientes** el seguro es exigible a
  **todos los modelos, cualquier valor de facturación** (transitorio SEGUNDO del mismo Acuerdo).
- **Art. 63 Ter LCPAF**: si el propietario tiene una póliza del ramo de automóviles con **mayores
  coberturas**, no puede impedirse su circulación ni imponerse la multa. Las aseguradoras deben
  emitir un **endoso** que lo acredite (Regla CUARTA).
- **Multa por circular sin él**: **20 a 40 días** de cuota (LCPAF **art. 74 Bis fr. II**) =
  **$2,346.20 a $4,692.40** con UMA 2026. **Y hay una salida:** "El propietario del vehículo tendrá
  **45 días naturales** para la contratación de la póliza de seguro, misma que al presentarla ante
  la autoridad recaudatoria durante el término anterior, **le será cancelada la infracción**."

### 4.2 Seguro de RC del permisionario de carga (obligación distinta y mayor)

- **LCPAF art. 68**: "Es obligación de los permisionarios de autotransporte de carga garantizar
  [...] los daños que puedan ocasionarse a terceros en sus bienes y personas, **vías generales de
  comunicación** y cualquier otro daño que pudiera generarse **por el vehículo o por la carga** en
  caso de accidente."
- Tratándose de materiales, residuos, remanentes y desechos peligrosos, **el seguro debe amparar la
  carga desde que sale de las instalaciones del expedidor hasta que se recibe en el destino final,
  incluyendo los riesgos de carga y descarga dentro o fuera de sus instalaciones** (art. 68,
  segundo párrafo). Salvo pacto en contrario, la carga y descarga quedan a cargo de expedidores y
  consignatarios, **quienes también deben garantizar** esos daños y el derrame.
- **RAFSA art. 83**: los permisionarios de carga deben contratar ese seguro o constituir un fondo
  de garantía en la forma, términos y montos que determine la Secretaría.
- Los montos exigidos hoy son los del §2.3 (19,000 UMA / 7,954 UMA según el trámite).

### 4.3 Responsabilidad por la carga (esto no es seguro, es ley)

**LCPAF art. 66**: el permisionario de carga "es responsable de las pérdidas y daños que sufran los
bienes o productos que transporten, **desde el momento en que reciban la carga hasta que la
entreguen a su destinatario**", con estas excepciones:

| Fracción | Excepción |
|---|---|
| I | Vicios propios de los bienes o embalajes inadecuados |
| II | Deterioro o daño por la propia naturaleza de la carga |
| III | Transporte en vehículo descubierto **a petición escrita del remitente** cuando debía ir cerrado |
| IV | Falsas declaraciones o instrucciones del cargador, consignatario o titular de la carta de porte |
| V | **Si el usuario no declara el valor de la mercancía, la responsabilidad queda limitada a 15 días de salario mínimo por tonelada** (o la parte proporcional) |

Con UMA 2026: **15 × $117.31 = $1,759.65 por tonelada.** Un contenedor de 20 t sin valor declarado
tope en ~$35,193.

**Art. 67**: si el usuario quiere que el permisionario responda por el precio total —incluso por
caso fortuito o fuerza mayor— debe **declarar el valor** y pagar "un cargo adicional equivalente al
costo de la garantía respectiva que pacte con el permisionario". Ese cargo adicional es una **línea
de ingreso legítima que muchas flotas no cobran**, y aparece (o debería aparecer) en el
tarifario/liquidación.

**Art. 69**: en transporte multimodal internacional el permisionario solo responde por el segmento
terrestre en que participa, en los términos de la carta de porte.

**RAFSA arts. 84-86**: la indemnización es el valor declarado; si el daño es parcial, la parte
proporcional; si la mercancía queda inutilizable, el destinatario puede rechazarla y exigir el valor
declarado.

---

## 5. Verificación físico-mecánica (NOM-068-SCT-2-2014) — anual

### 5.1 La obligación

- **LCPAF art. 35**: todos los vehículos de carga, pasaje y turismo que transiten en caminos y
  puentes federales "deberán cumplir con la verificación técnica de sus condiciones físicas y
  mecánicas y **obtener la constancia de aprobación correspondiente** con la periodicidad y términos
  que la Secretaría establezca en la norma oficial mexicana respectiva". El segundo párrafo permite
  la **autorregulación**: las empresas con los elementos técnicos conforme a la NOM "podrán ellas
  mismas realizar la verificación técnica de sus vehículos".
- La NOM aplicable es la **NOM-068-SCT-2-2014**, publicada en el **DOF 19-ene-2015**, en vigor 120
  días naturales después. Canceló la NOM-068-SCT-2-2000.

### 5.2 Periodicidad exacta (num. 5.3.4 de la NOM)

| Caso | Regla |
|---|---|
| Regla general | **Una vez al año** |
| Vehículos nuevos | **Exentos 2 años** desde la fecha de fabricación, acreditable con tarjeta de circulación, factura o carta-factura |
| Extensión | Pueden exentar **2 años más** si verifican en el **primer bimestre del tercer año** y obtienen dictamen aprobatorio |
| Desde el 5º año de fabricación | **Anual obligatoria, sin excepción** |
| Excepción a la exención | Si la empresa quiere **incrementar el peso bruto vehicular máximo autorizado** (numerales 6.1.2.2 de la NOM-012), debe verificar **anualmente sin importar el año del vehículo, incluyendo el convertidor (dolly)** |

### 5.3 Qué se obtiene y dónde se pega

- Una **Unidad de Verificación / Unidad de Inspección acreditada y aprobada por la SICT** emite el
  **dictamen de aprobación o rechazo** y coloca una **calcomanía** (num. 5.3.1).
- Colocación (num. 5.3.2): camiones y tractocamiones, **costado izquierdo de la cabina**; remolques,
  semirremolques y dolly, **costado izquierdo lo más cerca posible del frente**; autobuses, esquina
  inferior derecha del parabrisas o costado derecho cerca del frente.
- **En combinaciones vehiculares se coloca una calcomanía por cada unidad** (num. 5.3.2.4). Un
  T3-S2-R4 son **cuatro** dictámenes y cuatro calcomanías, no uno.
- Si no pasa, **es obligatorio reparar antes** de que se coloque la calcomanía y se expida el
  dictamen aprobatorio (num. 5.3.3).

### 5.4 Calendario por dígito de placa — y por qué no se puede hardcodear

La SICT reparte la verificación anual a lo largo del año según el **dígito de la placa**, conforme
al AVISO DOF **29-jun-2012** y su modificación DOF **15-may-2015**. En 2025 el calendario se
prorrogó al menos tres veces:

- AVISO DOF **28-may-2025**: extiende al 30-jun-2025 para placas 5 o 6.
- Modificación DOF **25-jun-2025**.
- **MODIFICACIÓN DOF 02-dic-2025** (firmada 20-nov-2025): extiende **hasta el 31-dic-2025** para
  placas 5 o 6, 7 u 8, 3 o 4 y 1 o 2. Placas 9 o 0: "sin modificaciones" (septiembre a diciembre).
  El aviso aclara que **también aplica a los vehículos con el permiso provisional para circular sin
  placas** del AVISO DOF 07-oct-2025.

El propio aviso reconoce el motivo: "evitar saturaciones en las Unidades de Inspección al final de
cada periodo, lo que podría derivar en **sanciones por el incumplimiento oportuno de la
verificación, o sobrecostos de su verificación**".

> **SIN VERIFICAR:** el calendario 2026 de verificación físico-mecánica por dígito de placa. No
> encontré el aviso 2026 en fuente primaria (sí encontré el de emisiones, DOF 03-abr-2026).
> Asumir que el calendario 2026 replica el de 2025 sería una invención.

### 5.5 Sanción

- Tabulador del Reglamento sobre el Peso, Dimensiones y Capacidad, renglón **23** (art. 14
  infringido): "Por falta de documento que avale la verificación técnica de las condiciones
  físico-mecánicas de los vehículos" — **100 a 105 días** = **$11,731.00 a $12,317.55** (UMA 2026).
- Además, si en inspección se detecta una **condición crítica** de la cuarta columna de las tablas
  de la NOM-068, **el vehículo debe ser retirado de la circulación** (num. 4.2.3 y 5.2.1.1). Si
  transporta materiales peligrosos o perecederos, **no se detiene**: se conduce a la zona segura más
  cercana para transbordo de la carga (num. 5.2.1.2).
- LCPAF **art. 74 Ter fr. IV**: la autoridad puede retirar de circulación vehículos que "no cumplan
  con las condiciones mínimas de seguridad".

---

## 6. Verificación de emisiones — semestral

### 6.1 La obligación

- Base: **ACUERDO para la verificación de vehículos de autotransporte del servicio público federal
  y del transporte privado, DOF 18-abr-1997**, que establece la **verificación semestral obligatoria
  de emisiones contaminantes por opacidad del humo y concentración de gases**.
- Alcance: vehículos de autotransporte federal y transporte privado que usen **diésel o mezclas con
  diésel, gasolina, gas LP, gas natural u otros combustibles alternos**, incluidos los de
  materiales y residuos peligrosos, fondos y valores, mensajería y paquetería, **incluyendo
  vehículos con capacidad de carga útil menor a 4,000 kg**.

### 6.2 Calendario 2026 (verificado)

**AVISO DOF 03-abr-2026** (firmado 20-mar-2026 por el Director General de Autotransporte Federal):

| Periodo | Fechas |
|---|---|
| **Primera verificación** | 1 de enero al **30 de junio de 2026** |
| **Segunda verificación** | 1 de julio al **31 de diciembre de 2026** |

Normas aplicables según el aviso:
- **NOM-045-SEMARNAT-2017** (opacidad para vehículos a diésel), de aplicación federal, **o**
- **NOM-167-SEMARNAT-2017** en **CDMX, Hidalgo, Estado de México, Morelos, Puebla y Tlaxcala**,
  "toda vez que las dos regulaciones antes citadas establecen los mismos límites máximos permisibles
  de opacidad de humo y el mismo método de prueba".

El transitorio SEGUNDO reconoce a la **SEMARNAT** como autoridad normalizadora en materia ambiental.

Contexto de 2025 (para entender el patrón): la primera verificación de 2025 se prorrogó del
30-jun-2025 al 31-jul-2025 y luego **al 31-dic-2025** (MODIFICACIÓN DOF 02-dic-2025). O sea: en
2025 la primera y la segunda verificación terminaron traslapadas. **El calendario oficial y el
calendario real no son lo mismo.**

### 6.3 Documento que genera

- **Certificado / constancia de baja emisión de contaminantes** más su **juego de calcomanías**,
  emitido por un **centro de verificación autorizado por la SICT**.
- Es requisito documental del permiso: "Certificado de emisión de contaminantes vigente del último
  periodo o constancia de exención" (ACUERDO DOF 02-jul-2025, todos los trámites de permiso).
- También es requisito para el alta de vehículos: **RAFSA art. 54 fr. IV** exige "Constancia de baja
  emisión de contaminantes, expedida por el centro de verificación autorizado por la Secretaría".
- La LFD cobra **$24.46** por cada juego de calcomanías y certificado que la SICT entrega a los
  centros de verificación (art. 148 D fr. V). Eso es lo que la SICT cobra al centro; **lo que el
  centro cobra a la flota es precio de mercado, no una cuota oficial**.

> **SIN VERIFICAR:** el precio de mercado de una verificación de emisiones y de un dictamen
> físico-mecánico en 2026. Varía por estado y por unidad de inspección; no hay tarifa oficial.

---

## 7. NOM-012-SCT-2-2017: pesos y dimensiones

### 7.1 Estatus

- Publicada en el **DOF 26-dic-2017**, en vigor 60 días naturales después (**24-feb-2018**). Canceló
  la NOM-012-SCT-2-2014.
- **Sigue vigente y sin modificaciones**. La revisión sistemática del **21-mar-2023** resultó en
  "Confirmación" (registro de normalización de la Secretaría de Economía). Cualquier afirmación de
  que "cambió la NOM-012 en 2024/2025/2026" es falsa hasta que se publique otra cosa en el DOF.

### 7.2 Lo esencial de la norma

- El peso bruto vehicular máximo autorizado depende del **tipo de camino (ET, A, B, C, D)** y de la
  **configuración vehicular**, según las tablas B-1 y B-2, considerando la suma de pesos por eje y
  la **fórmula puente** (num. 6.1.2.1).
- La carga debe colocarse de modo que no se exceda el PBV autorizado ni la concentración por eje de
  las tablas A-1 y A-2 (num. 6.1.1.1.2).
- **Doblemente articulados (T-S-R y T-S-S)**: solo pueden circular en caminos **tipo ET y A**, con
  autorización expresa de la Secretaría; por excepción en caminos menores con **autorización especial
  de conectividad** (num. 6.1.2.1.1).

### 7.3 El "bono" de peso y lo que cuesta cumplirlo

Los doblemente articulados pueden **incrementar el PBV en 1.5 t por cada eje motriz y 1.0 t por cada
eje de carga** (num. 6.1.2.2) **si y solo si** cumplen (num. 6.1.2.2.1 y siguientes):

- **Dictamen de condiciones físico-mecánicas y de baja emisión de contaminantes VIGENTES** en el
  tractocamión, el semirremolque y el remolque (T, S y R).
- Motor electrónico con HP mínimo, torque mínimo y capacidad mínima de ejes de tracción según tabla
  por configuración (p. ej. T3-S2-R4: 430 HP, 1,650 lb-pie, 46,000 lb).
- Freno auxiliar de motor, retardador o freno libre de fricción.
- Convertidor con **doble cadena de seguridad**.
- **Sistema antibloqueo de frenos (ABS)** en T, S y R.
- **Suspensión de aire** (salvo eje direccional) en T, S y R.
- Cámaras de frenado de doble acción, dispositivo regulador de velocidad, cintas retrorreflejantes
  conforme a NOM-035-SCT-2 y NOM-068-SCT-2.
- **Sistema de ajuste automático de frenos** (num. 6.1.2.2.8).
- **GPS** que reporte al menos **posición y velocidad**, con respaldo de la información, **que el
  permisionario debe poner a disposición de la SICT y de la autoridad de tránsito** (num. 6.1.2.2.4).
- **Gobernado electrónicamente a 80 km/h máx.** por la computadora del motor (num. 6.1.2.2.7).
- Espejos auxiliares delanteros o elemento reductor de puntos ciegos (num. 6.1.2.2.3).

**Reglas de tránsito específicas** (num. 6.1.2.2.2 fr. I): velocidad máxima 80 km/h, circular
confinado al carril de la extrema derecha salvo rebase, **luces encendidas permanentemente** por
sistema electrónico, y **mínimo 100 m de separación** respecto de otros vehículos pesados.

**Del conductor** (fr. II): licencia específica (categoría E) obtenida aprobando examen específico,
y **uso de bitácora de horas de servicio con registros por viaje**.

**De control para la empresa** (fr. III): **contrato privado y/o carta de porte** entre usuario y
transportista en transportaciones de carro por entero, donde las partes acepten la
**responsabilidad solidaria**, dejando establecido en el contrato o en la carta de porte **la ruta
asignada, la carga y el peso bruto vehicular**.

Todo esto se verifica en centros de control de peso y dimensiones, instalaciones de la empresa o
unidades de verificación, y **debe asentarse en la tarjeta de circulación** (num. 6.1.2.3).

### 7.4 Autorización especial de conectividad

Para usar un camino de menor clasificación (num. 6.4):
- Requiere **dictamen de viabilidad técnica** que evalúe invasión de carril y afectación por peso a
  los puentes de la ruta.
- **La Secretaría resuelve en máximo 60 días naturales; si no resuelve, se entiende en sentido
  NEGATIVO** (negativa ficta).
- **Vigencia de tres años** desde su emisión.
- Solo se autorizan los tramos de **menor distancia hacia el camino de mayor especificación**; si
  existe carretera de mayor clasificación, invariablemente debe usarse.
- Condiciones de tránsito impuestas por la autorización: **llevar en el vehículo la Carta de Porte o
  Nota de Embarque** (esta última para transporte privado), circular confinado al carril derecho,
  **usar bitácora de horas de servicio con registros por viaje**, y respetar la tabla D de
  velocidades máximas por tipo de carretera y configuración.
- Costo: **$963.23** (LFD art. 148 A.II.d).
- La SICT publica en internet las autorizaciones otorgadas y mantiene una base de datos consultable.

### 7.5 Responsabilidad del usuario de la carga

- **NOM-012 num. 6.1.2.4**: en carro por entero, "el usuario del autotransporte de carga y el
  transportista **serán responsables** de que la carga y el vehículo que la transporta cumplan con
  el peso y dimensiones".
- **NOM-012 num. 6.4 fr. V**: "el usuario será **corresponsable** de los daños y perjuicios que se
  causen originados por exceso de peso de su carga, cuando se contrate carro por entero, **declarado
  en la Carta de Porte**. Para los embarques de menos de carro por entero, la responsabilidad
  recaerá en el transportista de carga consolidada."
- **Reglamento sobre el Peso, Dimensiones y Capacidad, art. 10**: "el usuario deberá declarar el
  peso de su carga en la carta de porte, y el autotransportista anexará a ésta una **constancia de
  peso y dimensiones** en la que se indique la capacidad de carga útil del vehículo."
- **Art. 11 del mismo Reglamento**: la constancia de capacidad/peso y dimensiones y la **placa o
  calcomanía indeleble de especificaciones técnicas** solo puede expedirlas el **fabricante o
  reconstructor**.

### 7.6 Cómo se verifica y qué cuesta romperla

**Verificación** (NOM-012 num. 9): en **centros fijos de verificación de peso y dimensiones** y en
**puntos automatizados de control** con **pesaje electrónico y medición automatizada de
dimensiones**. La norma dice expresamente que "La Secretaría **podrá sancionar con la multa
correspondiente** a los transportistas que sus vehículos hayan sido detectados en los puntos
automatizados". La autoridad de tránsito también puede verificar con básculas propias o públicas con
informe de calibración y dictamen de PROFECO o de unidades de verificación acreditadas, "o a través
de la **carta de porte o nota de embarque** correspondiente".

**Tabulador de multas del Reglamento sobre el Peso, Dimensiones y Capacidad** (extracto de los
renglones que más pesan en una liquidación), expresado en días y convertido con UMA 2026:

| # | Infracción | Días | Pesos 2026 |
|---:|---|---:|---:|
| 1 | Operar con configuración vehicular distinta a la de la norma | 495–500 | $58,068 – $58,655 |
| 14 | Exceso de peso de **50 a 500 kgf** | 25–28 | $2,933 – $3,285 |
| 15 | Exceso de peso de **501 a 2,000 kgf** | 100–105 | $11,731 – $12,318 |
| 16 | Exceso de peso de **2,001 a 3,000 kgf** | 150–155 | $17,597 – $18,183 |
| 17 | Exceso de más de 3,000 kgf, **por cada 1,000 kgf o fracción** | 75–78 | $8,798 – $9,150 **por tonelada extra** |
| 18 | Transitar en camino de menor clasificación con especificaciones de camino mayor | 100–105 | $11,731 – $12,318 |
| 20 | **Declaración falsa de peso en la carta de porte por el propietario de la carga** | 495–500 | $58,068 – $58,655 |
| 21 | Falta de constancia o placa de capacidad, dimensiones y peso del fabricante | 200–205 | $23,462 – $24,049 |
| 23 | Falta del documento de verificación físico-mecánica | 100–105 | $11,731 – $12,318 |
| 24 | Caída de carga o parte de ella, por causas distintas a un hecho de tránsito | 150–155 | $17,597 – $18,183 |
| 25/26 | Transitar sin permiso especial para objetos indivisibles de gran peso o volumen | 495–500 | $58,068 – $58,655 |
| 27 | No cumplir las disposiciones operativas y de seguridad del permiso especial | 495–500 | $58,068 – $58,655 |

Y las dos reglas que duelen más que la multa:

- **Art. 21**: "Cuando un vehículo **exceda del 10% del peso autorizado** [...] se impedirá su
  circulación **hasta que disminuya su carga** al peso autorizado, independientemente de las
  sanciones". Con materiales peligrosos o perecederos no se detiene: se conduce al origen o destino
  más cercano para transbordo.
- **Art. 22**: primera reincidencia en la misma infracción en un año → **multa al doble**; segunda
  reincidencia en el mismo periodo → **la Secretaría revoca el permiso de esa unidad**.

> **Nota crítica sobre la unidad de cuenta.** El tabulador dice "días de salario mínimo general
> vigente en el Distrito Federal", igual que el art. 74 LCPAF. Desde la reforma constitucional de
> desindexación (2016) y la Ley para Determinar el Valor de la UMA, las referencias a salario
> mínimo como unidad de cuenta se entienden hechas a la **UMA**. El Reglamento de Tránsito reformado
> en 2026 ya lo dice expresamente ("CUOTA DIARIA, la cantidad en dinero equivalente a una Unidad de
> Medida y Actualización", art. 2 fr. XIX). **Los textos del LCPAF y del Reglamento de Pesos no se
> actualizaron**; las conversiones de esta tabla son la lectura correcta pero no están escritas así
> en esos dos ordenamientos.

---

## 8. NOM-087-SCT-2-2017: tiempos de conducción y pausas

Publicada en el **DOF 28-jun-2018**, en vigor 60 días naturales después (**27-ago-2018**). Es de
observancia obligatoria para el autotransporte federal, sus servicios auxiliares en todas las
modalidades, y el transporte privado del art. 8 fr. XI LCPAF.

### 8.1 Las reglas (numeral 4)

| Regla | Texto |
|---|---|
| 4.1 | **Pausa de 30 minutos** cuando ha conducido **hasta cinco horas continuas**; puede distribuirse dentro de un lapso de **cinco horas y media** según las condiciones de la ruta |
| 4.2 | **Los periodos de pausa NO son acumulables** |
| 4.3 | Durante todo el tiempo de conducción el conductor **debe portar la Bitácora de Horas de Servicio** y exhibirla a la autoridad; es **personal e intransferible**; en formato impreso o electrónico |
| 4.4 | Los permisionarios **pueden usar tacógrafo u otras aplicaciones electrónicas** para cumplir |
| 4.6 a) | **En carga**: en rutas que impliquen conducción máxima de **14 horas**, el conductor debe tener una **pausa no menor a 8 horas continuas**, sin dejar de cumplir las pausas de 4.1 y 4.2 |
| 4.7 | **El tiempo máximo de conducción en 24 horas nunca podrá exceder las 14 horas** |

(Los numerales 4.5 sobre segundo conductor aplican a pasaje y turismo, no a carga.)

### 8.2 La bitácora: contenido obligatorio

Diez campos, definidos en el **RTCPJF art. 83** y replicados en el numeral 8.2.1 de la NOM:

1. Nombre o razón social del permisionario y su domicilio
2. Tipo de servicio y modalidad
3. Marca, modelo y **placas** del vehículo
4. Fecha de elaboración de la bitácora
5. Nombre del conductor
6. **Número de licencia del conductor y su vigencia**
7. **Origen y destino, especificando la ruta a seguir**
8. Horas: (a) de salida y de llegada; (b) de servicio conduciendo; (c) de servicio sin conducir por
   paradas no programadas; (d) fuera de servicio; (e) de descanso
9. Casos de excepción en los que el conductor pueda excederse de la jornada
10. **Firmas del conductor y del permisionario o de la persona que éste designe**

Además:
- "Los **permisionarios deberán dotar a sus conductores** de dicha bitácora" (RTCPJF art. 83).
- **La bitácora debe conservarse al menos durante DOS AÑOS** (NOM-087 num. 8.5).
- La SICT "podrá solicitar a los permisionarios las bitácoras de conducción de sus operadores"
  (num. 8.4).
- Las **excepciones temporales** (num. 3.4) por percance vial, avería, perturbación del servicio o
  interrupción del tráfico "deberán ser **evidenciadas documentalmente**".
- **"Otras actividades auxiliares"** (num. 3.5) —carga y descarga, limpieza, mantenimiento, trámites
  aduanales y administrativos, **carga de combustible**— **no son pausa**. Cargar diésel no cuenta
  como descanso.

### 8.3 Sanción

RTCPJF **art. 83, tercer párrafo** (reformado DOF 25-may-2026): "La falta de bitácora o la omisión
de algún dato será sancionada con multa de **20 a 30 veces la cuota diaria**" = **$2,346.20 a
$3,519.30** con UMA 2026. Nótese que **la omisión de un solo dato se sanciona igual que la falta
total del documento**.

---

## 9. Qué debe ir a bordo del camión (checklist verificado)

| Documento | Fundamento | Vigencia / nota |
|---|---|---|
| **Placas** legibles y **tarjeta de circulación en original** (y engomado, en su caso) | RTCPJF art. 85 | El conductor debe entregarla para revisión y le será devuelta |
| **Permiso provisional para circular sin placas** (si aplica) | AVISO DOF 07-oct-2025 | 180 días naturales; con QR ligado al SIAF |
| **Licencia Federal Digital** en la app o impresa | LCPAF art. 36; ACUERDO DOF 01-abr-2022 art. 14 | La **impresión vale un mes** desde que se imprimió |
| **Bitácora de horas de servicio** requisitada, impresa o electrónica | RTCPJF art. 83; NOM-087 num. 4.3 | Personal e intransferible; conservar 2 años |
| **Carta de porte** (o **nota de embarque** en transporte privado) | NOM-012 num. 6.4 fr. XIX; Reglamento de Pesos art. 10; RAFSA art. 44F | Debe declarar el peso de la carga |
| **Constancia de peso y dimensiones** del vehículo | Reglamento de Pesos arts. 10 y 11 | La expide el fabricante o reconstructor |
| **Calcomanía de verificación físico-mecánica** (una por unidad de la combinación) | NOM-068 num. 5.3.2 | Anual (ver §5.2) |
| **Certificado / calcomanía de baja emisión de contaminantes** | Acuerdo DOF 18-abr-1997; NOM-045 / NOM-167 | Semestral |
| **Póliza de seguro** vigente (RC obligatoria y la del permisionario) | LCPAF arts. 63 Bis y 68 | 45 días de gracia para la RC obligatoria (art. 74 Bis fr. II) |
| **Autorización expresa** para doblemente articulado / **autorización especial de conectividad** | NOM-012 num. 6.1.2.1.1 y 6.4 | Conectividad: 3 años |
| **Permiso especial** para objetos indivisibles de gran peso o volumen | LCPAF art. 50, tercer párrafo; Reglamento de Pesos art. 16 | Por viaje o simplificado (art. 18) |
| **Placa o calcomanía de especificaciones técnicas** del fabricante | NOM-068 num. 5.1.1; Reglamento de Pesos art. 11 | Indeleble e intransferible |

> Advertencia observada por transportistas ante la CONAMER (oct-2025): con el permiso provisional,
> **una unidad con autorización expresa y de materiales peligrosos puede terminar portando hasta
> tres códigos QR distintos** (permiso provisional, autorización expresa y el de la Secretaría de
> Energía), sin regla clara de cuál prevalece. Esto es ruido operativo real que Likida va a ver en
> las fotos.

---

## 10. Tránsito, infracciones y retiro de circulación (régimen 2026)

### 10.1 Quién multa y con qué unidad

- **DECRETO DOF 25-may-2026** (en vigor 26-may-2026): la **Guardia Nacional** sustituye a la Policía
  Federal en toda la operación de tránsito federal. Puede inspeccionar vehículos, dirigir el
  tránsito, emitir **dictamen técnico** de hechos de tránsito, levantar **Acta-Convenio**, imponer
  sanciones y **poner al conductor a disposición del Ministerio Público** cuando proceda.
- **Cuota diaria = 1 UMA** (RTCPJF art. 2 fr. XIX reformado). **UMA 2026: $117.31 diarios**, vigente
  desde el 1 de febrero de 2026 (INEGI, DOF 09-ene-2026; mensual $3,566.22, anual $42,794.64).
- La SEDENA tiene **180 días** desde el 26-may-2026 para emitir los formatos de boleta de
  infracción, amonestación escrita, Acta-Convenio y dictamen técnico (transitorio CUARTO).

### 10.2 Multas del Reglamento de Tránsito más frecuentes en carga

| Conducta | Cuotas diarias | Pesos 2026 | Artículo |
|---|---:|---:|---|
| No portar licencia vigente | 20–40 | $2,346 – $4,692 | RTCPJF 81 fr. II |
| No estar en pleno uso de facultades físicas y mentales | 10–15 | $1,173 – $1,760 | RTCPJF 81 fr. I |
| Circular en estado físico-mecánico no idóneo | 20–30 | $2,346 – $3,519 | RTCPJF 80 |
| Falla mecánica / sin combustible sin medidas de seguridad | 10–20 | $1,173 – $2,346 | RTCPJF 82 |
| **Falta de bitácora u omisión de algún dato** | 20–30 | $2,346 – $3,519 | RTCPJF 83 |
| Falta de placas/tarjeta/engomado (servicio federal) | 30–40 | $3,519 – $4,692 | RTCPJF 86 fr. II |
| Usar placas/tarjeta/engomado de otro vehículo | 40–60 | $4,692 – $7,039 | RTCPJF 87 |
| No usar cinturón de seguridad | 20–25 | $2,346 – $2,933 | RTCPJF 84 |

Multas de la Ley (impuestas por la SICT, no por tránsito):
- LCPAF **art. 74 fr. IV**: incumplir cualquier disposición en materia de autotransporte federal —
  **hasta 500 días** = hasta **$58,655**.
- LCPAF **art. 74 fr. V**: cualquier otra infracción a la Ley o a lo que de ella derive — **hasta
  1,000 días** = hasta **$117,310**.
- **Reincidencia**: la Secretaría puede imponer **hasta el doble** (art. 74, penúltimo párrafo).

### 10.3 Retiro de circulación: el evento caro

**LCPAF art. 74 Ter** — la autoridad puede retirar de circulación cuando:
I. Se presta el servicio **sin permiso**;
II. Con concesión o permiso estatal/municipal se opera **fuera de los tramos autorizados**;
III. Se excede el tiempo de importación temporal;
IV. **No se cumplen las condiciones mínimas de seguridad**;
V. Está vencido el plazo máximo de operación (pasaje y turismo).

**RTCPJF art. 218 apartado A fr. III inciso b)** — procedimiento específico para carga:
1. El vehículo se conduce al **depósito (corralón) permisionado por la SICT**, acompañado por la
   autoridad, que levanta inventario.
2. **La carga queda a disposición del conductor o de su propietario**, con facilidades para el
   transbordo; si es remolque o semirremolque, puede **acoplarse a otro tractocamión**.
3. Con materiales y residuos peligrosos aplica además el Reglamento para el Transporte Terrestre de
   Materiales y Residuos Peligrosos.

**Costos que esto detona en una liquidación**: grúa/arrastre, depósito por día, transbordo, un
segundo tractocamión, penalización por entrega tardía, y el tiempo del operador. Ninguno de estos
aparece en el tabulador, todos aparecen en la liquidación real del viaje.

### 10.4 Cómo se garantiza y se paga la multa

**LCPAF art. 76**: la sanción "podrá ser garantizada con el valor de los propios vehículos o mediante
el otorgamiento de garantía suficiente". Si la garantía es el vehículo, puede entregarse en depósito
al conductor o al propietario. **El propietario tiene 30 días hábiles desde que se fijó la multa
para cubrirla**; si no, se formula la liquidación y **se turna, junto con el vehículo, a la autoridad
fiscal competente para su cobro**.

> Esto es importante para el flujo de la liquidación: **una multa de carretera tiene un reloj de 30
> días hábiles**. Si la boleta se queda en la guantera y llega tres semanas después con el operador,
> la flota ya perdió la mitad del plazo.

**Art. 80 LCPAF**: contra las resoluciones procede el **recurso de revisión** de la Ley Federal de
Procedimiento Administrativo. Y **art. 77**: al imponer sanciones la Secretaría debe considerar la
gravedad de la infracción, los daños causados, la reincidencia y la condición económica del
infractor. Hay margen real de impugnación; el contralor necesita el expediente completo para
ejercerlo.

---

## 11. Peaje: no es una obligación normativa, pero se cobra por ejes

No es una obligación regulatoria, pero es el segundo gasto de viaje después del diésel y su monto
**está determinado por la configuración vehicular**, que a su vez está determinada por el permiso y
la tarjeta de circulación. Por eso pertenece a este documento.

- **Clasificación vehicular oficial** (RTCPJF **art. 24**): C2 (camión unitario de dos ejes), C3
  (unitario de tres ejes), C2-R2, C3-R2, C3-R3, T2-S1, T2-S2, T2-S3, T3-S1, T3-S2, T3-S3,
  T3-S1-R2, T3-S1-R3, T3-S2-R2, T3-S2-R3, **T3-S2-R4 (nueve ejes)**, T2-S2-S2, T3-S2-S2, T3-S3-S2.
- **CAPUFE** cobra por **categoría vehicular basada en el número de ejes y el tipo de vehículo**;
  las columnas de su tarifario son **M (motos), A (autos), B2–B4 (autobuses), C2–C9 (camiones), EEA
  y EEC (ejes excedentes)**. Las **tarifas vigentes 2026 con IVA** están publicadas por CAPUFE.

**Consecuencia para Likida**: un ticket de caseta de una unidad **C9** cobrado a un viaje que salió
con un **C3** es una inconsistencia detectable sin leer el ticket completo — basta la categoría, la
plaza y la unidad asignada. Es una de las validaciones automáticas más baratas y de mayor
rendimiento que Likida puede ofrecer.

> **SIN VERIFICAR:** el importe específico por plaza de cobro en 2026 y la equivalencia exacta entre
> la nomenclatura del RTCPJF (T3-S2-R4) y la categoría tarifaria de CAPUFE (C9). Hay una tabla de
> equivalencia; no la leí en fuente primaria en esta investigación.

---

## 12. Calendario y costos recurrentes por unidad y por operador

**Por unidad, cada año:**

| Obligación | Frecuencia | Documento resultante |
|---|---|---|
| Verificación físico-mecánica (NOM-068) | **Anual**, por dígito de placa (con exenciones para unidades nuevas) | Dictamen + calcomanía, **una por unidad de la combinación** |
| Verificación de emisiones (NOM-045 / NOM-167) | **Semestral**: ene–jun y jul–dic en 2026 | Certificado + juego de calcomanías |
| Póliza de RC (obligatoria y del permisionario) | Anual | Póliza y comprobante de pago |
| Revalidación de tarjeta de circulación | Según trámite | $781.23 (LFD art. 148 A.III.c) |

**Por operador:**

| Obligación | Frecuencia | Costo oficial |
|---|---|---|
| Renovación de licencia federal (A, B, C, D, F) | **4 años** | $212.63 (LFD art. 148 C) |
| Renovación de licencia federal (**E**) | **2 años** | $212.63 |
| Examen Psicofísico Integral | **2 años** (o menor si el dictamen lo indica) | Sin cuota oficial localizada |
| Certificado de capacitación | Cada renovación | Precio de mercado del centro |

**Por evento:**

| Evento | Costo oficial |
|---|---|
| Alta de vehículo motriz adicional | $4,359.10 / $3,724.15 en línea |
| Alta de unidad de arrastre | $3,111.43 / $2,476.49 en línea |
| Autorización especial de conectividad (3 años) | $963.23 |
| Cesión de derechos del permiso | $3,293.84 |
| Reposición de placa | $1,346.93 |

---

## 13. Novedades 2025–2026 (lo que cambió respecto a años previos)

| Fecha DOF | Cambio |
|---|---|
| **07-feb-2025** | Aviso que autoriza el **balizamiento** como identificación complementaria |
| **04-mar-2025** | Calendario 2025 de verificación semestral de emisiones (después prorrogado dos veces) |
| **28-may-2025** y **25-jun-2025** | Prórrogas del calendario 2025 de verificación físico-mecánica |
| **02-jul-2025** | **ACUERDO de simplificación**: homoclaves pasan de `SCT-` a `SICT-`, se reducen requisitos en 11 permisos, se elimina `SCT-05-008`. En vigor 09-jul-2025 |
| **16-jul-2025** | Reforma al art. 2o. fr. VI LCPAF: la "Secretaría" es formalmente la **SICT** |
| **07-oct-2025** | **Permiso provisional para circular sin placas ni engomado**, 180 días, con QR ligado al SIAF |
| **16-oct-2025** | **ACUERDO de simplificación II**: se **elimina el canje de placas** (`SCT-03-003-A/B/C`) y el duplicado de licencia digital (`SCT-03-033`); se fusionan 17 trámites; nacen `SICT-03-010` y `SICT-03-045`. En vigor 23-oct-2025 |
| **07-nov-2025** | Reforma a la **Ley Federal de Derechos** (cuotas 2026, actualizadas por RMF del 28-dic-2025) |
| **14-nov-2025** | Última reforma a la **LCPAF** (arts. 4o. fr. II, 5o. fr. XI) |
| **02-dic-2025** | Extensión del periodo de verificación físico-mecánica **hasta el 31-dic-2025** para placas 1–8, y de la primera verificación de emisiones 2025 **hasta el 31-dic-2025** |
| **09-ene-2026** | **UMA 2026: $117.31 diarios**, vigente desde el 1 de febrero de 2026 |
| **03-abr-2026** | **Calendario 2026 de verificación semestral de emisiones**: ene–jun y jul–dic |
| **25-may-2026** | **DECRETO que reforma el Reglamento de Tránsito**: la **Guardia Nacional** asume las funciones de tránsito federal. En vigor 26-may-2026 |
| **28-may-2026** | **Programa de sustitución y modernización de vehículos pesados** (garantías NAFIN): micro (1–5 unidades) y pequeños transportistas (6–30 unidades), permiso con antigüedad mínima de 3 años, financiamiento hasta **$15 millones**, 84 meses para nuevas (10% enganche) y 60 meses para seminuevas (15%). En vigor 29-may-2026 |

---

## Qué cambia esto en Likida

### Lo que hay que construir

1. **Un registro de vencimientos, no solo de gastos.** El modelo de datos de Likida necesita dos
   entidades de primera clase que hoy probablemente no existen: **Unidad** y **Operador**, cada una
   con su tabla de documentos y fechas de vencimiento:
   - Unidad: dictamen físico-mecánico (anual, con dígito de placa), certificado de emisiones
     (semestral), póliza de RC, tarjeta de circulación, permiso provisional (180 días),
     autorización expresa de doble articulado, autorización de conectividad (3 años), constancia de
     peso y dimensiones.
   - Operador: licencia federal (4 o 2 años según categoría), constancia de aptitud psicofísica
     (2 años), certificado de capacitación.

   El disparador comercial no es "te aviso que vence": es **"este viaje salió con el dictamen
   vencido, y aquí está la exposición"**. Eso es lo que un contralor firma.

2. **Validador de multas contra el tabulador en UMA.** Cuando el operador mande la foto de una
   boleta, Likida puede: (a) identificar el artículo infringido, (b) calcular el rango legal en UMA
   × 117.31, (c) marcar si el monto cobrado está **fuera del rango** —señal de boleta apócrifa o de
   error—, y (d) **arrancar el reloj de 30 días hábiles del art. 76 LCPAF**. Ese reloj es la función
   que evita que la multa se convierta en crédito fiscal con el vehículo de garantía.

3. **Validación cruzada caseta ↔ configuración.** La categoría de peaje se define por número de
   ejes. Si la unidad asignada al viaje es un C3 y hay tickets de categoría C9, o al revés, hay algo
   mal (unidad equivocada, viaje equivocado o ticket ajeno). Es una regla de una línea con alto
   rendimiento.

4. **Reconstrucción de horas de servicio a partir de lo que Likida ya ve.** Los timestamps de
   WhatsApp, los tickets de diésel con hora y las fotos con metadatos permiten reconstruir la
   secuencia real del viaje. Con eso Likida puede **detectar** patrones incompatibles con la
   NOM-087: más de 14 horas entre el primer y el último evento sin evidencia de pausa de 8 horas, o
   cinco horas de conducción sin ningún gasto ni evento intermedio. **Ojo:** cargar diésel **no es
   pausa** (NOM-087 num. 3.5); un ticket de gasolinera no acredita descanso.

5. **Amarrar el gasto de viáticos a la norma.** Una ruta que por su duración exige pausa de 8 horas
   continuas **justifica** hospedaje y comidas. Y al revés: un viaje de 16 horas sin ningún gasto de
   descanso es a la vez un ahorro sospechoso y un riesgo normativo. Likida puede convertir la
   política de viáticos de la empresa en una regla derivada de la NOM-087, que es mucho más
   defendible ante el operador que "porque así lo dice el patrón".

6. **Calendarios como datos, nunca como código.** La verificación físico-mecánica y la de emisiones
   se han prorrogado en el DOF varias veces por año. Los calendarios deben vivir en una tabla
   editable con la referencia del DOF que los soporta, no hardcodeados. En 2025 la primera
   verificación de emisiones terminó traslapada con la segunda.

7. **Separar el gasto de viaje del gasto de unidad y del gasto de operador.** El dictamen anual, la
   verificación semestral, la póliza y la licencia **no son gastos de viaje**. Si Likida los mezcla
   en la liquidación, el costo por viaje sale inflado y el contralor pierde la confianza en el
   número. Deben prorratearse o vivir en otra cuenta.

### Lo que hay que dejar de prometer

- **No prometer que Likida "valida el permiso ante la SICT".** No hay evidencia verificada de una
  API pública de consulta de permisos. Lo que sí existe es el **QR** del permiso provisional y de la
  licencia digital, que la propia SICT diseñó para lectura por autoridad; **el acceso de un tercero
  privado a esa validación no está verificado**.
- **No prometer que la bitácora derivada por Likida sustituye a la bitácora legal.** La bitácora
  requiere **diez campos específicos y las firmas del conductor y del permisionario** (RTCPJF art.
  83). Likida puede pre-llenarla y proponerla; el permisionario la firma. Vender otra cosa expone a
  la flota.
- **No prometer que una foto del dictamen prueba su vigencia.** El dictamen tiene fecha; la
  calcomanía va pegada por unidad. En una combinación de cuatro elementos hay cuatro documentos.
- **No usar el "seguro obligatorio de $50 mil / $100 mil" como si fuera el seguro de la flota.** Ese
  es el mínimo del art. 63 Bis para cualquier vehículo. El permisionario de carga especializada
  necesita **19,000 UMA (~$2.2 M)**. Confundirlos en material de venta es un error caro.
- **No decir "la NOM-012 cambió".** Está vigente sin modificaciones desde 2017, confirmada en la
  revisión sistemática de 2023.

### Lo que abre oportunidad comercial

- El **Programa de sustitución y modernización** (DOF 28-may-2026) está dirigido exactamente al
  segmento de Likida: permisionarios de **1 a 30 unidades** con permiso de al menos 3 años. Esas
  flotas van a necesitar orden documental para calificar ante NAFIN, y **el dictamen físico-mecánico
  de la unidad seminueva es requisito del programa**.
- El cambio de autoridad de tránsito (Guardia Nacional) y el rediseño de formatos de boleta en los
  próximos 180 días van a generar **confusión y boletas heterogéneas**. Un extractor que normalice
  boletas viejas y nuevas es una ventaja temporal real.
- El art. 67 LCPAF permite cobrar **un cargo adicional por declaración de valor**. Muchas flotas
  chicas no lo cobran y aun así responden. Likida puede detectar viajes con mercancía valiosa sin
  declaración de valor y convertir eso en una recomendación de tarifa.

---

## SIN VERIFICAR

Lo que no pude comprobar en fuente primaria durante esta investigación. **No usar como fundamento.**

1. **Calendario 2026 de verificación físico-mecánica por dígito de placa.** Encontré el de emisiones
   (DOF 03-abr-2026) pero no el aviso 2026 de físico-mecánicas. En 2025 se prorrogó tres veces.
   Asumir continuidad del calendario 2025 sería inventar.
2. **Homoclave, costo y procedimiento de la "constancia de registro ante la SICT"**, hoy requisito
   de todos los trámites de permiso.
3. **Si "19,000 UMA" se refiere a la UMA diaria, mensual o anual.** El Acuerdo DOF 02-jul-2025 no lo
   precisa. Usé la diaria (lectura de mercado); la mensual multiplicaría el monto por ~30.
4. **Monto de seguro de RC exigido específicamente para el permiso de carga general
   (SICT-03-008-A).** El Acuerdo solo dice "póliza de RC por daños a terceros o fondo de garantía
   vigente", sin monto. Es posible que el Centro SICT aplique en la práctica el mismo criterio de
   19,000 UMA; **no está escrito así**.
5. **Precios de mercado 2026** de la verificación físico-mecánica, la verificación de emisiones, el
   Examen Psicofísico Integral y los cursos de capacitación. No hay tarifa oficial y varían por
   estado y por unidad de inspección. Las cifras que circulan en blogs ($500–$800 el examen médico,
   $1,500–$3,500 el curso) **son de blog, no de fuente oficial**.
6. **Tabla de equivalencia exacta** entre la nomenclatura de configuración vehicular del RTCPJF art.
   24 (T3-S2-R4, etc.) y las categorías tarifarias de CAPUFE (C2 a C9).
7. **Existencia de una API o servicio público de consulta de permisos SICT** por un tercero. Verifiqué
   que hay QR en el permiso provisional y en la licencia digital, y que la SICT provee una app "para
   uso exclusivo" de autoridades (ACUERDO DOF 01-abr-2022 art. 13); **no verifiqué acceso para
   privados**.
8. **Actualización del régimen de datos personales.** La constancia de aptitud psicofísica contiene
   **datos de salud**, que son datos personales sensibles. Existe un cambio normativo de 2025 en
   materia de protección de datos tras la extinción del INAI que **no revisé en esta investigación**.
   Antes de que Likida almacene fotos de constancias psicofísicas o licencias, hay que revisar el
   régimen vigente de consentimiento expreso y por escrito.
9. **Fecha exacta y contenido del tercer acuerdo de simplificación de la SICT (dic-2025)**, referido
   por prensa sectorial (7 trámites eliminados, 14 fusionados). Solo verifiqué los de julio y octubre
   de 2025 en el DOF.
10. **Conversión de "días de salario mínimo" a UMA en el tabulador del Reglamento de Pesos y en el
    art. 74 LCPAF.** Es la lectura correcta por la desindexación de 2016, y el Reglamento de Tránsito
    reformado en 2026 ya lo dice expresamente; pero **no releí el decreto constitucional de
    desindexación ni la Ley de la UMA en esta investigación**, y esos dos ordenamientos siguen
    diciendo "salario mínimo" en su texto.

---

## Fuentes

**Leyes y reglamentos (texto vigente)**
- Ley de Caminos, Puentes y Autotransporte Federal — última reforma DOF 14-11-2025 —
  https://www.diputados.gob.mx/LeyesBiblio/pdf/LCPAF.pdf
- Ley Federal de Derechos — última reforma DOF 07-11-2025, cantidades actualizadas por RMF DOF
  28-12-2025 — https://www.diputados.gob.mx/LeyesBiblio/pdf/LFD.pdf
- Ley General de Movilidad y Seguridad Vial — última reforma DOF 29-12-2023 —
  https://www.diputados.gob.mx/LeyesBiblio/pdf/LGMSV.pdf
- Reglamento de Autotransporte Federal y Servicios Auxiliares (DOF 22-11-1994, texto vigente) —
  https://www.sct.gob.mx/JURE/doc/regl-autotransp-fed.pdf
- Reglamento de Tránsito en Carreteras y Puentes de Jurisdicción Federal (DOF 22-11-2012) —
  https://www.diputados.gob.mx/LeyesBiblio/regla/n354.pdf
- DECRETO que reforma, adiciona y deroga diversas disposiciones del Reglamento de Tránsito en
  Carreteras y Puentes de Jurisdicción Federal — DOF 25-05-2026 —
  https://www.dof.gob.mx/nota_detalle.php?codigo=5788377&fecha=25/05/2026 y
  https://sidof.segob.gob.mx/notas/docFuente/5788377
- Reglamento sobre el Peso, Dimensiones y Capacidad de los Vehículos de Autotransporte que Transitan
  en los Caminos y Puentes de Jurisdicción Federal (incluye Tabulador de Multas) —
  https://micrs.sct.gob.mx/images/DireccionesGrales/DGAF/DGA_Normas/Especificaciones_de_veh%C3%ADculos/Reglamento_Peso_y_Dimensiones.pdf

**Normas Oficiales Mexicanas**
- NOM-012-SCT-2-2017, peso y dimensiones máximas — DOF 26-12-2017 —
  https://www.dof.gob.mx/nota_detalle.php?codigo=5508944&fecha=26/12/2017
  (estatus vigente y revisión sistemática: https://platiica.economia.gob.mx/normalizacion/nom-012-sct-2-2017/)
- NOM-068-SCT-2-2014, condiciones físico-mecánicas y de seguridad — DOF 19-01-2015 —
  https://www.dof.gob.mx/nota_detalle.php?codigo=5378850&fecha=19/01/2015 (secciones 5 a 11 en
  https://www.dof.gob.mx/nota_detalle.php?codigo=5378852&fecha=19/01/2015)
- NOM-087-SCT-2-2017, tiempos de conducción y pausas — DOF 28-06-2018 —
  https://www.dof.gob.mx/nota_detalle.php?codigo=5529381&fecha=28/06/2018

**Acuerdos y avisos de la SICT / DGAF**
- ACUERDO que establece las categorías de la Licencia Federal de Conductor — DOF 25-02-2016 —
  https://www.dof.gob.mx/nota_detalle.php?codigo=5427046&fecha=25/02/2016
- ACUERDO de Reglas de Carácter General para la Licencia Federal Digital — DOF 01-04-2022 —
  https://www.dof.gob.mx/nota_detalle.php?codigo=5647819&fecha=01/04/2022
- ACUERDO de acciones de simplificación de trámites ante la SICT — DOF 02-07-2025 —
  https://www.dof.gob.mx/nota_detalle.php?codigo=5761774&fecha=02/07/2025
- ACUERDO de acciones de simplificación (elimina canje de placas) — DOF 16-10-2025 —
  https://www.dof.gob.mx/nota_detalle.php?codigo=5770086&fecha=16/10/2025
- AVISO que autoriza el permiso provisional para circular sin placas y sin engomado — DOF
  07-10-2025 — https://sidof.segob.gob.mx/notas/docFuente/5769395
- MODIFICACIÓN a los avisos de verificación físico-mecánica y de emisiones 2025 — DOF 02-12-2025 —
  http://www.apta.com.mx/apta2008/ce/dof/descargapdf/2025/12Diciembre/20251202/sict25120210-4.pdf
- AVISO de periodos de verificación semestral de emisiones 2026 — DOF 03-04-2026 —
  https://www.gazhal.com.mx/compilacion/navegador/dof/dof_2026/descargas/2026_04_03_sict01.php
- Acuerdos DOF de la Licencia Federal Digital (índice SICT) —
  https://micrs.sct.gob.mx/transporte-y-medicina-preventiva/autotransporte-federal/acuerdos-dof-licencia-federal-digital
- REQUISITOS médicos relativos al personal del autotransporte público federal (DGPMPT, texto
  integrado 14-02-2018) —
  https://micrs.sct.gob.mx/images/DireccionesGrales/DGPMPT/Documentos/Texto_integtrado_requistos_medicos_AUTOTRANSPORTE_14022018.pdf
- Ficha del trámite SICT-03-028-A, Expedición de la Licencia Federal Digital de Conductor —
  https://www.gob.mx/public/tramites/detalleTramite.xhtml?homoclave=SICT-03-028-A
- Ficha del trámite SCT-03-008-A, Permiso de autotransporte federal de carga general (CONAMER) —
  https://catalogonacional.gob.mx/FichaTramitePdf/Index?traHomoclave=SCT-03-008-A

**Seguros**
- ACUERDO 07/2014 de la SHCP, Reglas para la operación del seguro del art. 63 Bis LCPAF — DOF
  27-03-2014 — https://dof.gob.mx/nota_detalle.php?codigo=5338448&fecha=27/03/2014

**Unidad de cuenta y peaje**
- Valor de la UMA 2026 (INEGI) — DOF 09-01-2026 —
  https://www.dof.gob.mx/nota_detalle.php?codigo=5778072&fecha=09/01/2026
- CAPUFE, Tarifas vigentes 2026 (con IVA) —
  https://pot.capufe.mx/gobmx/transparencia/Doc/TransparenciaF/Tarifas/Vigentes/2026/Tarifas-vigentes-2026.pdf
- CAPUFE, Compendio normativo de plazas de cobro (clasificación por ejes) —
  https://normateca.capufe.gob.mx/Documentos/Derogados/Compendio_Plazas_Cobro-11-12-25/Normativo.pdf

**Programa de modernización 2026**
- AVISO por el que se dan a conocer los Lineamientos de Operación del Programa de sustitución y
  modernización de vehículos pesados — DOF 28-05-2026. Cobertura y extractos:
  https://t21.com.mx/estos-son-los-lineamientos-para-modernizar-flotas-de-autotransporte/ y
  https://www.jornada.com.mx/noticia/2026/05/28/economia/sict-otorgara-nafin-esquemas-de-financiamiento-para-adquirir-autotransporte-federal-de-pasaje-y-carga

**Prensa sectorial usada solo como pista (no como fundamento)**
- Revista TyT (tyt.com.mx), T21 (t21.com.mx), La Jornada, ANIQ (aniq.org.mx), APTA (apta.com.mx).
