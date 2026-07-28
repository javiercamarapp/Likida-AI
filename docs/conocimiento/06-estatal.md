# Obligaciones fiscales estatales y locales

> Investigado el 27-jul-2026 para Likida.ai. Fundamentos citados. Lo no verificado va marcado.

---

## Resumen para el fundador

1. **El impuesto estatal que importa para una flota es el ISN (Impuesto Sobre Nóminas).** Lo paga el patrón, no el operador, sobre lo que eroga por trabajo personal. Va de 2% a 4.25% según el estado. Nadie lo puede acreditar contra nada: es costo puro.
2. **El ISN es la razón fiscal más fuerte para que exista Likida, y casi nadie la usa como argumento de venta.** En la mayoría de los estados los viáticos están exentos *solo si* están "efectivamente erogados por cuenta del patrón y debidamente comprobados, en los mismos términos que para su deducibilidad requiere la Ley del ISR". Traducción: viático sin CFDI válido = base de ISN. Un peso mal comprobado no solo se pierde como deducción de ISR (30%) e IVA (16%): además paga ISN (3% típico) y probablemente integra el salario base de cotización del IMSS.
3. **Cada estado escribió la regla distinto y eso rompe cualquier validador genérico.** Querétaro exige que el comprobante esté "otorgado a favor de quien haga los pagos" (o sea, CFDI a nombre de la empresa, no del operador). Nuevo León mete los viáticos *dentro* del objeto del impuesto y luego los exenta, invirtiendo la carga de la prueba. Estado de México y Quintana Roo **no tienen exención expresa de viáticos**. CDMX los exenta sin condición de LISR pero exige registro contable.
4. **La autoridad estatal puede estimar la base cuando no hay papeles.** Nuevo León, Tamaulipas, Guanajuato y Quintana Roo tienen determinación presuntiva escrita en ley, con fórmulas concretas (por ejemplo, 4 veces la UMA por trabajador por mes). Ese es el miedo real del contralor.
5. **Operar en varios estados multiplica obligaciones, no las promedia.** Un patrón con patios en 4 estados tiene 4 padrones, 4 declaraciones, hasta 4 fechas de pago distintas (día 10 en Edomex, 12 en Jalisco, 15 en Tamaulipas, 17 en CDMX/NL/Coahuila/Puebla/Veracruz, 20 en Sonora, 22 en Guanajuato/Querétaro) y en Coahuila incluso una declaración por municipio.
6. **Si la flota subcontrata operadores u "hombres-camión", puede convertirse en retenedor del ISN.** Estado de México, Guanajuato, Querétaro, Coahuila, Nuevo León, Veracruz, Tamaulipas, Quintana Roo y Yucatán tienen obligación de retener cuando se contrata personal de un tercero, esté o no domiciliado en el estado. En Guanajuato, si el prestador no desglosa la retención, la base presunta es el 90% del CFDI antes de IVA.
7. **Guanajuato reconoce expresamente al "coordinado" del autotransporte** para calcular y enterar el ISN por sus integrantes. Es el único estado donde encontré esto escrito así. Si Likida modela flotas que operan como coordinado, ese detalle es oro.
8. **Los impuestos vehiculares estatales sí tocan a las flotas.** No todos los estados cobran tenencia, pero Estado de México grava expresamente a los domiciliados en el estado que traen **placas de transporte público federal**, y cobra por tonelada de capacidad de carga. Puebla también tiene tenencia y además cobra derechos anuales por tarjetón, verificación físico-mecánica y placas del transporte mercantil de carga.
9. **En el ticket de hotel del operador viene un impuesto estatal que no es IVA:** el Impuesto Sobre Hospedaje (2% a 5% según estado). Viaja en el CFDI dentro del complemento de "Impuestos Locales". Si el parser de Likida lo confunde con IVA, la liquidación queda mal.
10. **Las tasas cambian cada diciembre.** En 2026 subieron Chihuahua (3%→4%), Yucatán (3%→3.75%) y, según fuentes secundarias, Baja California Sur, Chiapas y Colima. Nuevo León propuso subir a 4% y el Congreso lo rechazó. Cualquier tabla que Likida hardcodee necesita un proceso de mantenimiento anual, no un commit.

---

## 1. Qué es el ISN y por qué es el punto de apoyo de Likida

El ISN (llamado también ISERTP, ISRTP o Impuesto Sobre Erogaciones por Remuneraciones al Trabajo Personal, según el estado) es un impuesto **estatal**, no federal. No está en la LISR ni en la Ley del IVA. Cada una de las 32 entidades lo regula en su propia Ley de Hacienda, Código Financiero o Código Fiscal local.

Características que importan para el producto:

- **Lo paga el patrón.** No se retiene al trabajador ni se traslada al cliente.
- **No es acreditable.** A diferencia del IVA, se va directo al costo.
- **La base es amplísima y por default incluye todo.** Casi todas las leyes dicen "independientemente de la denominación que se les otorgue" o "cualquier otra de naturaleza análoga". Es decir: la carga de probar que algo *no* es remuneración es del patrón.
- **Los viáticos entran o no entran según cómo estén documentados.** Este es el punto exacto donde Likida crea valor fiscal medible.

### La regla de viáticos, en el texto de las leyes

El patrón que se repite en la mayoría de las entidades es este (Nuevo León, Jalisco, Tamaulipas, Coahuila, Veracruz, Guanajuato):

> "Viáticos efectivamente erogados por cuenta del patrón y debidamente comprobados, **en los mismos términos que para su deducibilidad requiere la Ley del Impuesto Sobre la Renta**."
> — Art. 160, fracc. I, inciso f), Ley de Hacienda del Estado de Nuevo León (reformado, P.O. 26-dic-2003). **VERIFICADO** en el texto de la ley publicado por el H. Congreso de Nuevo León.

Es decir: la exención estatal está **atada por referencia** a los requisitos federales de deducibilidad de viáticos (art. 28, fracc. V de la LISR y sus reglas). Si el CFDI no existe, si está a nombre equivocado, si el gasto se hizo dentro de la faja de 50 km del establecimiento, o si no hay relación laboral acreditada, el viático deja de estar exento y entra a la base del ISN.

**Esto es el argumento de venta más limpio que tiene Likida y está escrito en ley, no en un blog.**

Nuevo León va un paso más allá y mete los viáticos **en el objeto** del impuesto:

> "Para los efectos de este gravamen se consideran remuneraciones al trabajo personal, todas las contraprestaciones, cualquiera que sea el nombre con el que se les designe, ya sea ordinarias o extraordinarias, **incluyendo viáticos, gastos de representación**, comisiones, premios, gratificaciones, fondo de ahorro, donativos, primas, aguinaldo, tiempo extra, despensas, alimentación y otros conceptos de naturaleza semejante, **aún cuando se eroguen en favor de personas que, teniendo su domicilio en Nuevo León, por motivo de su trabajo, presten trabajo personal subordinado fuera del Estado**."
> — Art. 154, segundo párrafo, Ley de Hacienda del Estado de Nuevo León (reformado, P.O. 29-dic-1995). **VERIFICADO**.

Ese último inciso es específicamente relevante para autotransporte: un operador con domicilio en Nuevo León que maneja de Monterrey a Guadalajara sigue causando ISN en Nuevo León.

---

## 2. Tasas del ISN 2026, entidad por entidad

**Cómo leer la columna "Verif.":**
- **P** = leí el texto de la ley/decreto en fuente primaria (congreso estatal, periódico oficial o consejería jurídica) y transcribí el artículo.
- **O** = confirmado en el portal oficial de la secretaría/agencia fiscal del estado, pero no en el texto consolidado de la ley.
- **S** = solo fuentes secundarias (despachos, agregadores). **SIN VERIFICAR en fuente primaria.**

| # | Entidad | Tasa 2026 | Fundamento | Pago | Verif. |
|---|---------|-----------|------------|------|--------|
| 1 | Aguascalientes | 2.5% | Ley de Hacienda del Estado | día 17 | **S** |
| 2 | Baja California | **4.25%** | Art. 151-16 Ley de Hacienda del Estado de BC (consolidó tasa base 1.8% + sobretasas 1.20% y 1.25% desde 1-ene-2024) | día 25 | **S** |
| 3 | Baja California Sur | 3.0% (subió de 2.5%) | Ley de Hacienda del Estado de BCS | día 15 | **S** |
| 4 | Campeche | 3.0% | Ley de Hacienda del Estado | — | **S** |
| 5 | Chiapas | 3.0% (subió de 2%) | Código de la Hacienda Pública | bimestral | **S** |
| 6 | Chihuahua | **4.0%** para 2026 y 2027; regresa a 3% en 2028 | Artículo Segundo del Decreto No. LXVIII/RFLYC/0462/2025 I P.O., P.O. del Estado 24-dic-2025, que suspende temporalmente el 3% del art. 75 de la Ley de Hacienda | — | **S** |
| 7 | **Ciudad de México** | **4.0%** | Art. 158 Código Fiscal de la CDMX, reformado por Decreto publicado en la Gaceta Oficial de la CDMX el **27-dic-2024** (vigor 1-ene-2025). No se modificó para 2026. | día 17 (art. 159) | **P** |
| 8 | **Coahuila** | **3.0%** | Art. 24 Ley de Hacienda para el Estado de Coahuila de Zaragoza (reformado P.O. 3-nov-2023). Texto consultado: última reforma P.O. 30-dic-2025 | primeros 17 días naturales (art. 25) | **P** |
| 9 | Colima | 3.0% (subió de 2%) | Ley de Hacienda del Estado | día 17 | **S** |
| 10 | Durango | **2.0% o 3.0% — fuentes en conflicto** | Ley de Hacienda del Estado | día 17 | **S** |
| 11 | **Estado de México** | **3.0%**. Nuevo: personas físicas con hasta 4 trabajadores pagan cuota de **$250 por trabajador** (hasta 1.5 salarios mínimos mensuales por trabajador) | Art. 57 Código Financiero del Estado de México y Municipios; párrafos 2° y 3° adicionados por **Decreto Número 240**, Gaceta del Gobierno 17-dic-2025 | día 10 (art. 58) | **P** |
| 12 | **Guanajuato** | **3.0%** | Art. 10 Ley de Hacienda para el Estado de Guanajuato (reformado P.O. 24-dic-2020). Texto consultado: reforma P.O. núm. 227, 13-nov-2025 | día 22 (art. 11) | **P** |
| 13 | Guerrero | 3.0% | Ley de Hacienda del Estado núm. 428 | día 17 | **S** |
| 14 | Hidalgo | 3.0% | Ley de Hacienda del Estado | día 12 | **S** |
| 15 | **Jalisco** | **3.0%** | Art. 13 Ley de Ingresos del Estado de Jalisco 2026 (Decreto 30121/LXIV/25), remitiendo a la base del art. 41 Ley de Hacienda | día 12 (art. 43 LH) | **P** |
| 16 | Michoacán | 3.0% | Ley de Hacienda del Estado | — | **S** |
| 17 | Morelos | **2.5% o 3.0% — fuentes en conflicto** | Ley General de Hacienda del Estado | primeros 10 días | **S** |
| 18 | Nayarit | 3.0% | Ley de Hacienda del Estado | primeros 10 días | **S** |
| 19 | **Nuevo León** | **3.0%** (la propuesta de subir a 4% en el Paquete Fiscal 2026 **no prosperó**) | Art. 157 Ley de Hacienda del Estado de Nuevo León (reformado P.O. 29-dic-2017) | día 17 (art. 158); trimestral si el impuesto anual del año anterior no excedió $36,000 | **P** |
| 20 | Oaxaca | 3.0% | Ley Estatal de Hacienda | — | **S** |
| 21 | **Puebla** | **3.0%** | Art. 16 Ley de Ingresos del Estado de Puebla para el Ejercicio Fiscal 2026, sobre la base de la Ley de Hacienda del Estado | día 17 | **P** |
| 22 | **Querétaro** | **3.0%**, con deducción a la base de **8 veces el salario mínimo mensual** | Art. 72 Ley de Hacienda del Estado de Querétaro (ref. P.O. núm. 109, 23-dic-2021) | día 22 (art. 73 fracc. IV) | **P** |
| 23 | **Quintana Roo** | **4.0%** | Art. 6 Ley del Impuesto Sobre Nóminas del Estado de Quintana Roo (párrafo reformado POE 23-dic-2022). Texto consultado: última reforma POE 16-dic-2025 | día 10 | **P** |
| 24 | San Luis Potosí | 3.0% | Ley de Hacienda del Estado | — | **S** |
| 25 | Sinaloa | **2.4% – 3.0%** (tarifa progresiva según monto de nómina) | Arts. 17-18 Ley de Hacienda del Estado | 20 días | **S** |
| 26 | **Sonora** | **3.0%**, **+ cuota adicional de 1%** para patrones con más de 100 trabajadores registrados en el estado (efectiva 4%) | Art. 216 Ley de Hacienda del Estado de Sonora, según el portal oficial de la Secretaría de Hacienda de Sonora. **Estímulo del 50%** para actividades agrícolas, silvícolas, ganaderas, acuícolas o de pesca sin transformación | día 20 | **O** |
| 27 | Tabasco | **En conflicto (2.5% – 4%)** | Art. 30 Ley de Hacienda del Estado | — | **S** |
| 28 | **Tamaulipas** | **3.0%** | Art. 49 Ley de Hacienda para el Estado de Tamaulipas (última reforma del artículo: POE núm. 152, 21-dic-2016). Texto consultado: última reforma POE Extr. núm. 37, 23-dic-2023 | día 15 (art. 50) | **P** |
| 29 | Tlaxcala | 3.0% | Código Financiero del Estado | día 17 | **S** |
| 30 | **Veracruz** | **3.0%** | Art. 101 Código Financiero para el Estado de Veracruz de Ignacio de la Llave. Texto consultado: versión del H. Congreso del Estado, actualización 1-jul-2022 | día 17 | **P** |
| 31 | **Yucatán** | **3.75%** (subió de 3%) | Art. 24 Ley General de Hacienda del Estado de Yucatán, reformado por **Decreto 138/2025**, Diario Oficial del Estado **26-dic-2025**, vigente desde 1-ene-2026 | día 17 | **P** |
| 32 | Zacatecas | 3.5% | Ley de Hacienda del Estado + Ley de Ingresos | — | **S** |

### Cambios 2026 respecto de 2025

| Estado | 2025 | 2026 | Nota |
|--------|------|------|------|
| Chihuahua | 3% | **4%** | Temporal: 2026 y 2027. Vuelve a 3% en 2028 (**S**) |
| Yucatán | 3% | **3.75%** | Decreto 138/2025. Destino declarado: subsidio al transporte público "Va y Ven". Hay un estímulo (Decreto 147/2025) que neutraliza el 0.75% adicional para micro y pequeñas empresas (**S** el estímulo, **P** la tasa) |
| Baja California Sur | 2.5% | **3%** | **S** |
| Chiapas | 2% | **3%** | **S** |
| Colima | 2% | **3%** | **S** |
| Nuevo León | 3% | **3%** | El Ejecutivo propuso 4% en el Paquete Fiscal 2026; el sector privado se opuso y no pasó (**S** el rechazo, **P** la tasa vigente) |
| Estado de México | 3% | **3%** + cuota fija para PF con hasta 4 trabajadores | Decreto 240, GG 17-dic-2025 (**P**) |
| CDMX | 4% | **4%** | Sin cambio; el 4% viene desde 1-ene-2025 (**P**) |

**Advertencia sobre tablas que circulan en internet:** varias listas publicadas por proveedores de nómina siguen mostrando Jalisco al 2%, Coahuila al 2% y Nuevo León al 4%. Las tres están mal. Jalisco está en 3% desde 2023, Coahuila en 3% desde 1-ene-2024 (reforma P.O. 3-nov-2023) y Nuevo León sigue en 3%.

---

## 3. Tratamiento de los viáticos por estado (lo verificado en fuente primaria)

Esta es la tabla que Likida debería tener cableada, porque cada renglón es una regla de validación distinta.

| Estado | ¿Viáticos exentos? | Texto exacto de la condición | Fundamento |
|--------|--------------------|------------------------------|------------|
| **Nuevo León** | Sí, pero están **dentro del objeto** y salen por exención | "Viáticos efectivamente erogados por cuenta del patrón y debidamente comprobados, en los mismos términos que para su deducibilidad requiere la Ley del Impuesto Sobre la Renta" | Art. 160, fracc. I, inciso f) LH NL |
| **Jalisco** | Sí | "Gastos de viáticos efectivamente erogados por cuenta del patrón y debidamente comprobados, en los mismos términos que para su deducibilidad requiere la Ley del Impuesto sobre la Renta" | Art. 44, fracc. I, inciso f) LH Jal |
| **Tamaulipas** | Sí, **con dos requisitos formales extra** | "Los viáticos efectivamente erogados en servicio y por cuenta del patrón y debidamente comprobados, en los mismos términos que para su deducibilidad requiere la Ley del Impuesto sobre la Renta" + "deberán estar debidamente comprobadas y registradas en la contabilidad del contribuyente **y manifestarse en la declaración anual informativa** del ejercicio que corresponda" | Art. 52, fracc. I, inciso g) y párrafo final, LH Tamps |
| **Coahuila** | Sí | "Viáticos efectivamente erogados por cuenta del patrón y debidamente comprobados, en los mismos términos que para su deducibilidad requiere la Ley del Impuesto Sobre la Renta" | Art. 21, fracc. I, numeral 10, LH Coah |
| **Veracruz** | Sí, incluye gastos de representación | "Viáticos y gastos de representación efectivamente erogados por cuenta del patrón y que hayan sido debidamente comprobados en los mismos términos que, para su deducibilidad, requiere la Ley del Impuesto sobre la Renta" + "deberán estar debidamente registrados en la contabilidad del patrón" | Art. 103, fracc. I, inciso e) y párrafo final, CF Ver |
| **Guanajuato** | Sí, incluye gastos de representación | "Gastos de representación y viáticos erogados por cuenta del patrón, comprobados en los mismos términos que para su deducibilidad exija la Ley del Impuesto Sobre la Renta" | Art. 9, fracc. V, LH Gto |
| **Querétaro** | Sí, **pero con la condición más estricta que encontré** | "Los viáticos, **cuando la documentación comprobatoria se encuentre otorgada a favor de quien haga los pagos**" | Art. 72, fracc. VII, LH Qro |
| **CDMX** | Sí, **sin referencia a LISR** | "Gastos de representación y viáticos" (fracc. VIII). Condición general: "Para que los conceptos mencionados en este precepto se excluyan como integrantes de la base del Impuesto sobre Nóminas, deberán estar registrados en la contabilidad del contribuyente, si fuera el caso" | Art. 157, fracc. VIII y párrafo final, CFCDMX |
| **Estado de México** | **NO hay exención expresa de viáticos** | El art. 59 lista becas, indemnizaciones, pensiones, gastos funerarios, pagos a personas con discapacidad y trabajo independiente con IVA. Viáticos no aparece. El art. 56 grava "cualquier otra de naturaleza análoga… independientemente de la denominación que se le otorgue" (fracc. XVII) | Arts. 56 y 59 CFEMyM |
| **Quintana Roo** | **NO hay exención expresa de viáticos** | El art. 17 lista 12 conceptos exentos. Viáticos no está. Lo más cercano es "Los instrumentos de trabajo, tales como herramientas, ropa y otros similares" (fracc. IV) | Art. 17 Ley del ISN QRoo |
| **Sonora** | **NO aparece en el catálogo de no causación** | El art. 218 lista 13 conceptos. Viáticos no está | Art. 218 LH Son (versión consultada; ver SIN VERIFICAR) |

### Lo que esto significa en la práctica

- **En Estado de México y Quintana Roo, un viático entregado en efectivo al operador es, por texto de ley, terreno resbaloso.** El argumento técnico de defensa es que un viático debidamente comprobado no es "remuneración" sino reembolso de un gasto del patrón, y por lo tanto nunca entró al objeto del impuesto. Ese argumento se sostiene **solo si hay comprobante**. Sin comprobante, no hay ni argumento.
- **En Querétaro el comprobante tiene que estar a nombre de la empresa.** El CFDI con RFC genérico `XAXX010101000` que el operador consigue en la gasolinera o en la caseta **no sirve** para sostener la exención. Esta es la regla de validación más dura y más fácil de codificar.
- **En Tamaulipas no basta con tener el papel: hay que declararlo** en la informativa anual. Likida puede generar exactamente ese anexo.

---

## 4. Operar en varios estados: qué cambia

Este es el punto donde una flota mediana se rompe, y donde Likida tiene que ser cuidadosa con lo que promete.

### 4.1. ¿Dónde se causa el ISN?

Las leyes usan tres criterios distintos y a veces los combinan:

| Criterio | Estados donde lo vi textual | Cita |
|----------|----------------------------|------|
| **Donde se presta el trabajo** | Estado de México, Guanajuato, Querétaro, Veracruz, Quintana Roo, Jalisco | "remuneraciones al trabajo personal, prestado dentro del territorio del Estado" (art. 56 CFEMyM) |
| **Domicilio del patrón, aunque el trabajo se preste fuera** | Nuevo León | "aún cuando se eroguen en favor de personas que, teniendo su domicilio en Nuevo León, por motivo de su trabajo, presten trabajo personal subordinado fuera del Estado" (art. 154 LH NL) |
| **Sin importar dónde esté domiciliado nadie** | Veracruz | "aun cuando cualesquiera de los sujetos mencionados en esta fracción, o todos ellos tengan su domicilio fuera de la Entidad" (art. 98, fracc. I, CF Ver) |

**Para un operador de carga federal que en un mes cruza seis estados, ninguna ley resuelve el reparto.** La práctica de mercado es atribuir la nómina al patio, sucursal o base de asignación desde donde opera el trabajador, y declararla ahí. Eso **no está escrito en ninguna de las leyes que leí**. Es criterio, no norma. Ver la sección SIN VERIFICAR.

### 4.2. Sucursales: cada estado lo pide diferente

| Estado | Regla | Fundamento |
|--------|-------|------------|
| **Coahuila** | "Cuando los contribuyentes cuenten con sucursales en diversos municipios del Estado, **deberán presentar declaración en cada municipio**". Los domiciliados fuera del estado deben señalar al Registro Estatal de Contribuyentes un domicilio en Coahuila que funja como domicilio fiscal para el ISN | Art. 26 LH Coah |
| **Guanajuato** | Declaración **concentrada**: "deberá presentar en una declaración el pago concentrado por todas sus sucursales" y "deberán tener un solo registro por la matriz y sus sucursales" | Art. 11 LH Gto |
| **Quintana Roo** | Declaración **concentrada**, pero consignando número de sucursales, ubicación, trabajadores y montos por cada una. Si la matriz está fuera del estado, hay que designar por oficio la oficina donde se declara | Art. 13 Ley ISN QRoo |
| **Querétaro** | Aviso de empadronamiento **por cada** local, establecimiento, agencia o sucursal; aviso de apertura/cierre en 10 días; **"llevar un registro pormenorizado, por cada local, establecimiento, agencia o sucursal, de las erogaciones… separando debidamente las que formen parte de la base de las que están excluidas"** | Art. 73, fraccs. I, II y III, LH Qro |
| **Nuevo León** | Aviso de apertura o cierre de sucursales, bodegas, agencias. Se paga en la declaración de la matriz. Si la matriz está fuera del estado, hay que inscribir una sucursal | Art. 159, fracc. IV, LH NL |

El art. 73 fracc. III de Querétaro es, literalmente, la descripción de un feature de Likida: separar por sucursal lo gravado de lo excluido.

### 4.3. Calendario de pago (el problema operativo real)

| Día del mes siguiente | Estados |
|---|---|
| 10 | Estado de México, Quintana Roo, Morelos (S), Nayarit (S) |
| 12 | Jalisco, Hidalgo (S) |
| 15 | Tamaulipas, Baja California Sur (S) |
| 17 | CDMX, Nuevo León, Coahuila, Puebla, Veracruz, Yucatán, y la mayoría de los estados (S) |
| 20 | Sonora, Sinaloa (S) |
| 22 | Guanajuato, Querétaro |
| 25 | Baja California (S) |

**Implicación para el producto:** una flota nacional necesita el cierre de nómina y la clasificación de viáticos **antes del día 8** del mes siguiente, no del 17. El SLA de Likida se define por el estado más agresivo, no por el promedio.

---

## 5. Subcontratación, hombres-camión y coordinados

Esta sección es la más específica del autotransporte y la más peligrosa.

### 5.1. Obligación de retener ISN al contratar servicios con personal

Nueve estados que verifiqué en fuente primaria imponen retención al **contratante**:

| Estado | Cuándo hay que retener | Tasa / base de la retención | Fundamento |
|--------|------------------------|-----------------------------|------------|
| **Estado de México** | Al contratar servicios de contribuyentes **domiciliados en otro estado** cuya realización genere trabajo personal en Edomex | Si se desconoce el monto de remuneraciones: **3.0% sobre el valor total de las contraprestaciones** pagadas en el mes, sin IVA | Art. 56, párrafos 2° y 3°, CFEMyM |
| **Nuevo León** | Al contratar servicios de contribuyentes domiciliados **dentro o fuera** del estado, cuando incluyan prestación de servicios de personal en NL | Si se desconoce el monto: **3% sobre el valor total de las contraprestaciones**, sin IVA. Constancia de retención en 15 días | Art. 158 Bis LH NL |
| **Guanajuato** | Al recibir servicios de quien "ponga a disposición del contratante personal que desempeñe sus funciones en las instalaciones del contratante **o fuera de estas**, estén o no bajo la dirección… del contratante" | El prestador determina y desglosa la retención en el CFDI. **Si no lo hace, el contratante puede tomar como base el monto del CFDI antes de IVA multiplicado por 90%** | Art. 7, párrafos 4° a 7°, LH Gto |
| **Querétaro** | Al contratar servicios de contribuyentes domiciliados dentro o fuera del estado "para que pongan a su disposición trabajadores", si el trabajo se presta en Querétaro | 3% sobre el monto de la contraprestación pagada | Art. 71 LH Qro |
| **Coahuila** | Al contratar cooperativas, personas físicas, sociedades o asociaciones que proporcionen servicios de personal | Con base en la información que entregue el prestador; si no la entrega, sobre **cada pago sin IVA** | Art. 21, fracc. VI, LH Coah |
| **Veracruz** | Al contratar servicios con personas domiciliadas dentro o fuera del estado cuando implique contratación de trabajadores y el servicio se preste en Veracruz | Conforme al capítulo; constancia de retención acreditable por el prestador | Art. 98, párrafos 3° y 4°, CF Ver |
| **Tamaulipas** | Es objeto del impuesto "el valor del importe que se le pague a las personas físicas o morales que contraten, subcontraten o reciban la prestación del trabajo personal subordinado". Responsables solidarios: quienes contraten o subcontraten | Arts. 45 fracc. XVI, 46 y 51 y ss. LH Tamps |
| **Quintana Roo** | Servicios especializados o ejecución de obras especializadas; además hay régimen específico para construcción con garantía en efectivo o carta de crédito | Arts. 3, 4 Bis, 6 Bis, 14-16 Sexies, Ley ISN QRoo |
| **Yucatán** | Retención específica de contratos de obra pública (2% sobre mano de obra presupuestada) | Arts. 22-Quater y 27-H Bis LGH Yuc |

**Lectura para Likida:** cuando una flota paga a un **hombre-camión** o a un permisionario tercero, la línea entre "pago a un proveedor de flete" y "pago por poner personal a disposición" es la que decide si hay retención de ISN. Guanajuato la escribió tan amplia ("estén o no bajo la dirección, supervisión, coordinación o dependencia del contratante", "en las instalaciones del contratante o fuera de estas") que un contrato de arrastre mal redactado cae dentro.

Además, **casi todas las leyes hacen responsable solidario a quien recibe el trabajo**, aunque pague un tercero:

> "Son responsables solidarios del pago de este impuesto, las personas físicas o morales… que contraten o reciban la prestación del trabajo personal, no obstante el pago se realice por conducto de un tercero."
> — Art. 158 Bis, último párrafo, LH NL. **VERIFICADO**.

### 5.2. Coordinados: el caso Guanajuato

Guanajuato es el único estado donde encontré reconocimiento expreso del régimen de coordinados del autotransporte para efectos del ISN:

> "Los contribuyentes que integren un coordinado conforme a lo dispuesto en el Título II, Capítulo VII de la Ley del Impuesto Sobre la Renta, podrán, a través del mismo, calcular y enterar el Impuesto Sobre Nóminas, así como cumplir con las obligaciones fiscales por cada uno de sus integrantes… Para los efectos de esta Ley, el coordinado se considerará como responsable del cumplimiento de las obligaciones fiscales a cargo de sus integrantes, respecto de las operaciones realizadas a través del coordinado, siendo los integrantes responsables solidarios respecto de dicho cumplimiento por la parte que les corresponda."
> — Art. 11, párrafos 7° y 8°, Ley de Hacienda para el Estado de Guanajuato. **VERIFICADO**.

Esto importa porque el coordinado es la estructura jurídica más común del autotransporte federal mexicano (arts. 72 y 73 LISR). Que un estado lo reconozca cambia quién presenta la declaración y quién responde.

### 5.3. Determinación presuntiva: lo que pasa si no hay papeles

| Estado | Qué puede hacer la autoridad | Fundamento |
|--------|------------------------------|------------|
| **Nuevo León** | Estimar erogaciones cuando no se presenten declaraciones o cuando la información obtenida muestre erogaciones gravadas que exceden en más de 3% las declaradas. Usa: erogaciones de los últimos 12 meses, la declaración anual de ISR en el rubro de sueldos y salarios, y datos de facultades de comprobación | Art. 160 Bis LH NL |
| **Tamaulipas** | Determinación presuntiva cuando se omita una declaración o cuando el importe declarado sea inferior en 5% al debido. Presume, entre otras: **4 veces el valor diario de la UMA por trabajador por cada día del mes revisado** | Art. 48 LH Tamps |
| **Guanajuato** | El SATEG puede estimar con base en, entre otros, "la base determinada para el pago del Impuesto Sobre Nóminas manifestada en…" y los CFDI de nómina emitidos por el contribuyente | Arts. 13 a 16 LH Gto |
| **Quintana Roo** | Para obra especializada sin aviso: **4% sobre 4 veces la UMA elevada al periodo, por cada trabajador**, o hasta el 100% de la contribución omitida actualizada, más recargos | Art. 3, fracc. VI, Ley ISN QRoo |
| **Estado de México** | Para edificación: metros cuadrados por costo de mano de obra por m² conforme a tabla del art. 56 Bis | Art. 56 Bis CFEMyM |

**El puente con Likida:** la determinación presuntiva de Nuevo León se dispara comparando el ISN declarado contra **el rubro de sueldos y salarios de la declaración anual de ISR**. Si una flota deduce viáticos que la autoridad estatal reclasifica como remuneración, la diferencia salta sola. La evidencia documental es lo único que cierra ese hueco.

---

## 6. Registro estatal, padrones y avisos

Toda flota que opere en un estado tiene que **inscribirse en el Registro Estatal de Contribuyentes** (o padrón equivalente) de ese estado. No basta el RFC federal.

Obligaciones verificadas:

- **Nuevo León** (art. 159 LH): aviso de inscripción dentro del mes siguiente al inicio de actividades; para personas morales residentes en el estado, dentro del mes siguiente a la firma del acta constitutiva. Avisos del art. 28 del Código Fiscal del Estado. Aviso de apertura o cierre de sucursales. Los retenedores del art. 158 Bis **deben inscribirse específicamente como retenedores**.
- **Querétaro** (art. 73 LH): empadronamiento dentro de los **10 días hábiles** siguientes al inicio de operaciones, **por cada** local, establecimiento, agencia o sucursal. Declaración informativa anual a más tardar **en febrero**, incluso si no hubo impuesto a pagar.
- **Guanajuato** (art. 11 LH): declaración mensual aun sin impuesto a pagar, hasta que se presenten los avisos del Registro Estatal de Contribuyentes. Aviso de apertura/cierre en 15 días.
- **Estado de México** (art. 58 Bis CFEMyM): **declaración anual informativa dentro de los dos primeros meses del año** para quienes (i) presten servicios proporcionando trabajadores a terceros dentro o fuera del estado, o (ii) contraten en el estado servicios mediante los cuales se les proporcione trabajadores.
- **Coahuila** (art. 26 LH): los domiciliados fuera del estado deben señalar al Registro Estatal de Contribuyentes un domicilio en Coahuila y registrar todas las sucursales por municipio.
- **CDMX** (art. 159 CFCDMX): declaraciones aun sin erogaciones, hasta presentar el aviso de baja al padrón o de suspensión temporal.
- **Sonora** (portal oficial de la Secretaría de Hacienda): la inscripción al padrón del ISRTP pide, entre otros, **evidencia del primer pago de remuneraciones realizadas en Sonora** (aviso de registro patronal, visor de nómina del SAT, constancia de cuotas IMSS o movimientos afiliatorios). Suspensión obligatoria si se deja de causar por más de 6 meses.

**Regla práctica:** la obligación de declarar **no cesa cuando cesa la operación**. Cesa cuando se presenta el aviso. Flotas que abren un patio temporal en un estado y lo cierran sin dar aviso acumulan declaraciones omitidas en cero durante años.

---

## 7. Dictamen del ISN

Algunos estados obligan a dictaminar el ISN con contador público registrado. **Toda esta subsección es SIN VERIFICAR en fuente primaria** (viene de boletines de despachos, no de las leyes estatales; solo confirmé en fuente primaria el caso de Nuevo León, que es **opcional**).

| Estado | Umbral reportado (S) |
|--------|----------------------|
| CDMX | promedio mensual mínimo de **150 trabajadores** |
| Estado de México | promedio mensual mínimo de **200 trabajadores** o remuneraciones ≥ **$400,000**; también en fusión, escisión o liquidación |
| Campeche | **100 trabajadores** o remuneraciones mensuales ≥ **$1,000,000** |
| Guerrero | **100 trabajadores** o ingresos > **$25 millones** |
| Oaxaca | **150 trabajadores** o remuneraciones mensuales ≥ **$400,000** |
| También reportados con dictamen | Veracruz, Yucatán, San Luis Potosí, Quintana Roo, Zacatecas |
| **Sin figura de dictamen** (ni obligatorio ni opcional) | Baja California, Colima, Durango, Guanajuato, Hidalgo, Michoacán, Morelos, Querétaro, Tamaulipas, Tlaxcala |

**Nuevo León, verificado (P):** el dictamen es **opcional** (arts. 160 Bis-1 a 160 Bis-4 LH NL). Tiene un incentivo fuerte: "Las revisiones o las visitas domiciliarias ordenadas para verificar el cumplimiento del Impuesto Sobre Nóminas **deberán concluirse anticipadamente**, cuando el contribuyente… antes del inicio de la auditoría hubiere presentado el aviso" de que opta por dictaminar (art. 160 Bis-2).

---

## 8. Impuestos y derechos vehiculares estatales

La tenencia federal se derogó en 2012, pero varios estados la conservan como impuesto local. Para una flota de carga, tres cosas importan: si el estado la cobra, cómo la calcula para camiones, y qué pasa con las placas federales.

### 8.1. Estado de México (verificado, texto de ley)

Es el caso más completo y el más relevante porque muchas flotas domicilian ahí.

- **Sujetos:** tenedores o usuarios de vehículos dentro de la circunscripción del estado, incluidos los que deben inscribirse en el padrón vehicular estatal **y "contribuyentes domiciliados dentro de la circunscripción del Estado de México, tenedores o usuarios de vehículos que circulen con placas de transporte público federal"** (art. 60 CFEMyM). **Esto alcanza a los tractocamiones con placas SICT de una flota domiciliada en Edomex.**
- **Pago:** anual, dentro de los tres primeros meses del año (art. 60 A).
- **Cálculo para carga (art. 60 E, fracc. II):** valor total del vehículo × factor de depreciación por antigüedad, actualizado, y al resultado se le aplica:
  - **0.245%** si la capacidad de carga es menor a 15 toneladas (también placas de servicio público de pasajeros y taxis);
  - **0.50%** por el factor fiscal (toneladas ÷ 30) si la capacidad es de 15 a 35 toneladas; arriba de 35 toneladas se topa en 35.
- **Vehículos de más de 10 años (art. 60 E, fracc. IV, inciso D):** **$331 por cada tonelada o fracción de capacidad de carga o de arrastre**, multiplicado por (1 + factor de antigüedad, de 0.05 a 0.25). Si la tarjeta de circulación acredita uso agropecuario, no paga.
- **Definición amplia:** "se entiende por vehículos destinados a transporte de más de 15 pasajeros o para el transporte de carga, los camiones, vehículos pick up **sin importar la capacidad de carga**, tractores no agrícolas tipo quinta rueda, así como minibuses, microbuses y autobuses integrales" (art. 60 E, párrafo final). Las camionetas de apoyo de la flota también entran.

### 8.2. Puebla (verificado, Ley de Ingresos 2026)

- Conserva el **Impuesto Sobre Tenencia o Uso de Vehículos** (art. 17 LI 2026, con tarifas propias).
- Además cobra **derechos** específicos al transporte mercantil de carga (Ley de Ingresos 2026):
  - Expedición o reposición del **tarjetón** que identifica a los vehículos del servicio mercantil de transporte de carga, vigencia un año: **$570**;
  - **Análisis físico-mecánico** para vehículos del servicio mercantil de transporte de carga, incluye constancia y calcomanía: **$630**;
  - Cambio de modalidad del vehículo con cambio de formato de placa: **$575**.

### 8.3. Nuevo León (SIN VERIFICAR en fuente primaria)

Nuevo León **no cobra tenencia**; cobra **refrendo / derechos de control vehicular** anual. Cifras reportadas para 2026 por fuentes secundarias: $3,368 (modelos 2016-2026), $1,657 (2011-2015), $1,030 (2010 o anterior), $753 (motocicletas y remolques), con 10% de descuento en enero. **No encontré la tarifa específica para camiones de carga con placa federal.**

### 8.4. Panorama general (SIN VERIFICAR)

- Alrededor de **16 entidades** conservan alguna forma de tenencia o impuesto vehicular anual en 2026; el resto cobra solo derechos de control vehicular (refrendo, placas, tarjeta de circulación).
- La mayoría de los estados que conservan tenencia aplican subsidios del 100% a vehículos particulares por debajo de cierto valor. **Esos subsidios normalmente no aplican a vehículos de carga**, que es justo el caso de una flota.
- Estado de México, Jalisco, Nuevo León y CDMX tienen programas de **verificación vehicular** aplicables a vehículos de carga; circular sin verificación vigente puede derivar en multa e inmovilización.

### 8.5. Frontera federal / estatal en permisos

- El **permiso de autotransporte federal de carga** lo otorga la SICT. Es requisito para transportar carga comercial en caminos y puentes de jurisdicción federal. **No es una obligación estatal.**
- Las **placas federales** las asigna la SICT; los estados no las emiten.
- Los estados sí regulan y cobran por el **transporte local o intraestatal** (concesiones, permisos, tarjetones, verificación físico-mecánica), como se ve en el caso de Puebla arriba.
- La consecuencia práctica: una flota federal puede estar en orden con SICT y aun así deber contribuciones estatales por ISN, tenencia (donde aplique) y derechos de control vehicular en el estado donde domicilia sus unidades.

---

## 9. Otros impuestos estatales que aparecen dentro de una liquidación de viaje

### 9.1. Impuesto Sobre Hospedaje (ISH)

Cuando el operador duerme en un hotel, el CFDI trae un impuesto estatal adicional al IVA. Rango general reportado: **2% a 5%**.

- **Jalisco: 5.0%** — Art. 12, Ley de Ingresos del Estado de Jalisco 2026 (**VERIFICADO**).
- **Tamaulipas: 3%** — Art. 52 Sexies, Ley de Hacienda para el Estado de Tamaulipas (**VERIFICADO**).
- Otras tasas reportadas (**SIN VERIFICAR**): CDMX 3%, Quintana Roo 4%, Nuevo León 3%, BCS 4%, Yucatán bajó de 5% a 4.5% en 2026.

**Implicación técnica directa para Likida:** el ISH se desglosa en el CFDI a través del **complemento de Impuestos Locales**, no en el nodo estándar de traslados de IVA. Un parser que solo lea `Impuestos/Traslados` va a cuadrar mal el total del ticket de hotel. Además el ISH **no es acreditable**: forma parte del costo deducible, no del IVA a favor.

### 9.2. Impuestos ecológicos estatales

Zacatecas, Estado de México y Querétaro tienen impuestos a la emisión de gases contaminantes a la atmósfera. La pregunta relevante para una flota es si alcanzan a los camiones.

**Estado de México: NO alcanza a los camiones (verificado).**

> "Están obligadas al pago de este impuesto, las personas físicas y jurídicas colectivas, **que cuenten con fuentes fijas**, dentro del territorio del Estado de México, que emitan gases contaminantes a la atmósfera, cuya suma de emisiones… sea igual o mayor a una tonelada de dióxido de carbono equivalente (t CO2e) al mes. **Se considera fuente fija, a toda instalación en un lugar determinado, en forma permanente**…"
> — Art. 69 S, Código Financiero del Estado de México y Municipios. Cuota: **$58 por tonelada de CO2e** (art. 69 S Ter). Declaraciones mensuales el día 10 (art. 69 S Quáter).

Los vehículos son fuentes móviles y quedan fuera. **Pero un patio, taller o planta de la flota sí puede ser fuente fija** si sus emisiones llegan a 1 t CO2e al mes.

Estado de México también tiene impuesto a la **emisión de contaminantes al suelo, subsuelo y agua** (arts. 69 U y ss.), con cuota de $100 por unidad de medida (art. 69 U Quáter) y declaraciones mensuales. Un taller de flota con manejo de aceites y residuos debería revisarlo.

**Zacatecas y Querétaro: SIN VERIFICAR.** La Segunda Sala de la SCJN reconoció la constitucionalidad de los arts. 14 a 27 de la Ley de Hacienda de Zacatecas en materia de impuestos ecológicos (reportado por fuentes secundarias). Querétaro aprobó reformas a su impuesto sobre emisión de gases a la atmósfera alrededor del 9-jul-2026, con estímulos para quienes sustituyan flotillas de combustibles fósiles. **No leí ninguno de los dos textos.**

### 9.3. Impuestos estatales sobre trabajo personal NO subordinado

**Jalisco** tiene un impuesto separado del ISN: el **Impuesto sobre Remuneraciones al Trabajo Personal no Subordinado** (arts. 30 a 38, Ley de Hacienda del Estado de Jalisco). Grava ingresos por libre ejercicio de profesión, arte, actividad deportiva o cultural, o prestación de un servicio mercantil, **más los honorarios asimilados a salarios** y los ingresos de administradores únicos y miembros de consejos. Quien paga esas remuneraciones **debe retener el impuesto y enterarlo** (art. 31). La tasa la fija la Ley de Ingresos.

**No pude localizar la tasa 2026 de este impuesto** en la Ley de Ingresos del Estado de Jalisco 2026 (ver SIN VERIFICAR). Es relevante porque muchas flotas pagan a operadores o auxiliares bajo esquema de asimilados.

Guanajuato, Querétaro, Coahuila y Nuevo León resuelven lo mismo metiendo los asimilados **dentro** del ISN:
- Nuevo León: "se deben considerar incluidas en el objeto de este impuesto todas las erogaciones que se realicen por los conceptos que se asimilan a los ingresos por salarios conforme a lo previsto en el artículo 94 de la Ley del Impuesto Sobre la Renta" (art. 154 Bis, adicionado P.O. 23-dic-2021). **VERIFICADO.**
- Guanajuato: art. 6, fracc. IV, LH Gto. **VERIFICADO.**
- Querétaro: art. 70 LH Qro. **VERIFICADO.**
- Coahuila: art. 21, fracc. V, LH Coah. **VERIFICADO.**
- Estado de México: art. 56, fracc. XVI, CFEMyM. **VERIFICADO.**

---

## 10. Cómo se cruza esto con la Resolución de Facilidades Administrativas 2026

Es federal, no estatal, pero determina si los papeles existen o no, y por lo tanto determina el riesgo estatal.

**Fuente primaria:** Resolución de facilidades administrativas para los contribuyentes de los sectores que en la misma se señalan para 2026, **DOF 17-feb-2026**. Título 2: Sector de Autotransporte Terrestre de Carga Federal. Vigente hasta el 31-dic-2026 y aplicable a todo el ejercicio 2026.

**Regla 2.2 (facilidades de comprobación) — texto verificado:**

> "…podrán deducir hasta el equivalente al **8 por ciento** de los ingresos propios de su actividad, sin exceder de **$1,000,000.00** durante el ejercicio fiscal, **sin la necesidad de contar con documentación que reúna requisitos fiscales**, siempre que:
> I. El gasto se haya realizado efectivamente en el ejercicio fiscal correspondiente y esté directamente vinculado con la actividad del contribuyente.
> II. La erogación por la cual se aplique la facilidad, **esté registrada en la contabilidad** del contribuyente por concepto y en forma acumulativa durante el ejercicio fiscal.
> III. El contribuyente realice el pago del ISR anual sobre el monto deducido en los términos de esta regla, aplicando la **tasa del 16 por ciento**. El impuesto anual pagado sobre dicho monto se considerará como definitivo y **no será acreditable ni deducible**…"

Otros puntos verificados:
- **No aplica a combustibles** (párrafo final de la regla 2.2).
- Pagos provisionales del 16% a más tardar el día 17 del mes siguiente (regla 2.2, fracc. IV).
- **Regla 2.3:** responsabilidad solidaria de los coordinados por ingresos, deducciones, impuestos y retenciones consignados en la liquidación al integrante.
- **Regla 2.4:** cuentas maestras dinámicas o empresariales a nombre de cualquiera de las personas físicas permisionarias integrantes.
- **Regla 2.5:** definición de coordinado para efectos de los arts. 72 y 73 de la LISR.

**El cruce que nadie está haciendo, y que es la mejor pieza de argumentación comercial de Likida:**

El 8% "ciego" resuelve el ISR de gastos sin comprobante, pero **cuesta 16% de ISR definitivo** y, sobre todo, **no resuelve el ISN**. Las exenciones estatales de viáticos piden que estén "debidamente comprobados **en los mismos términos que para su deducibilidad requiere la LISR**". Si la flota está usando la facilidad precisamente porque **no** tiene el comprobante, el argumento de que el viático está "debidamente comprobado" se debilita mucho frente a la autoridad estatal.

Dicho en números para un contralor: un peso de viático que hoy va por el 8% ciego cuesta 16 centavos de ISR definitivo **y sigue expuesto** a 3 centavos de ISN, más recargos y actualización. El mismo peso con CFDI válido cuesta cero de ISR adicional y cero de ISN.

**Esto es una hipótesis de riesgo bien fundada, no un criterio publicado.** No encontré un criterio normativo estatal ni una tesis que resuelva expresamente si el 8% de la RFA satisface el requisito de "debidamente comprobados" de las leyes de hacienda estatales. Ver SIN VERIFICAR.

---

## Qué cambia esto en Likida

### Lo que hay que construir

1. **Motor de reglas por entidad federativa, no una regla nacional.** El validador de viáticos necesita al menos cuatro perfiles distintos:
   - *Perfil LISR* (NL, Jalisco, Tamaulipas, Coahuila, Veracruz, Guanajuato): exige CFDI válido + requisitos de deducibilidad de LISR + registro contable.
   - *Perfil Querétaro*: además exige que el **RFC receptor del CFDI sea el de la empresa**. Rechazar `XAXX010101000` y rechazar CFDI a nombre del operador.
   - *Perfil CDMX*: exención sin condición de LISR, pero con registro contable obligatorio.
   - *Perfil sin exención expresa* (Estado de México, Quintana Roo, Sonora): tratamiento conservador; marcar el viático como "en riesgo de base gravable" y exigir el nivel de evidencia más alto.

2. **Un campo `estado_de_causacion` en cada partida de la liquidación**, distinto del estado donde se hizo el gasto. La lógica de atribución (patio/base de asignación del operador) debe ser configurable por cliente y quedar registrada, porque **no está resuelta en ley**.

3. **Reporte "registro pormenorizado por sucursal"**, separando lo que forma parte de la base del ISN de lo que está excluido. Está pedido literalmente por Querétaro (art. 73, fracc. III) y sirve como evidencia en todos los demás estados.

4. **Anexo para la declaración anual informativa.** Tamaulipas exige que los conceptos exentos se manifiesten en la informativa anual; Querétaro pide informativa en febrero; Estado de México pide informativa en los dos primeros meses para quien proporciona o contrata trabajadores. Likida ya tiene el dato; generar el anexo es incremental.

5. **Parser del complemento de Impuestos Locales del CFDI.** El ISH del hotel no está en el nodo de traslados de IVA. Sin esto, la conciliación del ticket de hospedaje no cuadra y el contralor pierde confianza en el número.

6. **Calendario de cierre por estado.** El cierre operativo tiene que estar listo antes del día 8 para clientes con operación en Estado de México o Quintana Roo (pago día 10), no el 17.

7. **Detector de "pago a tercero con personal".** Cuando la liquidación incluya un pago a un hombre-camión, permisionario o proveedor de personal, marcar posible obligación de retención de ISN según el estado, con la base presunta correspondiente (3% del total sin IVA en Edomex y NL; 90% del CFDI sin IVA en Guanajuato).

8. **Soporte del modelo de coordinado.** Guanajuato lo reconoce expresamente para el ISN. Si el cliente es un coordinado, la entidad que declara no es la misma que la que paga al operador.

9. **Calculadora de costo real del viático sin comprobar.** Por peso no comprobado: ISR no deducible (30%) + IVA no acreditable (16%) + ISN (2% a 4.25% según estado) + riesgo de integración al SBC del IMSS. Esa es la cifra que vende, y cada componente tiene fundamento citable.

10. **Comparador "8% ciego vs. comprobación".** Para clientes que hoy usan la regla 2.2 de la RFA 2026: mostrar el 16% de ISR definitivo que están pagando y la exposición residual al ISN. Es una conversación que ningún competidor está teniendo.

### Lo que hay que dejar de prometer

- **No prometer "cumplimiento del ISN" ni calcular la declaración de ISN.** Likida produce la evidencia que sostiene la exención de viáticos; el cálculo y la presentación son del despacho o del área fiscal del cliente. Cruzar esa línea convierte a Likida en asesor fiscal con la responsabilidad que eso implica.
- **No prometer atribución automática de nómina entre estados.** El criterio no está en ley y una atribución errónea genera contingencia real en dos estados a la vez (el que no cobró y el que cobró de más).
- **No hardcodear tasas sin fecha de vigencia y fuente.** Cada tasa debe llevar `estado`, `tasa`, `fundamento`, `fecha_publicacion`, `vigencia_desde`, `vigencia_hasta`, `nivel_verificacion`. Cinco estados cambiaron su tasa entre 2025 y 2026.
- **No presentar la tabla de 32 estados como verificada.** Solo 13 entidades están confirmadas en fuente primaria en este documento. Publicar las otras 19 como si fueran ciertas es exactamente el error que le cuesta dinero a una flota.

---

## SIN VERIFICAR

Lo que no pude comprobar en fuente primaria. Nada de esta lista debe usarse como fundamento sin confirmar antes en el periódico oficial del estado.

1. **19 de las 32 tasas del ISN.** Marcadas con **S** en la tabla de la sección 2: Aguascalientes, Baja California, Baja California Sur, Campeche, Chiapas, Chihuahua, Colima, Durango, Guerrero, Hidalgo, Michoacán, Morelos, Nayarit, Oaxaca, San Luis Potosí, Sinaloa, Tabasco, Tlaxcala y Zacatecas.
2. **Conflictos abiertos entre fuentes secundarias:**
   - **Durango:** unas fuentes dicen 2%, otras 3%.
   - **Morelos:** unas dicen 2.5%, otras 3%.
   - **Tabasco:** el rango reportado va de 2.5% a 4%. Ninguna fuente cita el decreto.
3. **Sonora.** El portal oficial de la Secretaría de Hacienda del Estado de Sonora dice **3% + cuota adicional de 1%** para patrones con más de 100 trabajadores, citando el art. 216 de la Ley de Hacienda. Sin embargo, **todas las copias del texto de la Ley de Hacienda del Estado de Sonora que pude descargar dicen 2%** en ese mismo artículo. Son copias desactualizadas. **Falta leer la reforma que subió la tasa a 3% y el fundamento exacto de la cuota adicional del 1%.** También: la ley que leí no lista viáticos entre los conceptos que no causan el impuesto (art. 218), pero como el texto está desactualizado, eso puede haber cambiado.
4. **Chihuahua 4%.** El Decreto No. LXVIII/RFLYC/0462/2025 I P.O. (P.O. 24-dic-2025) y la vigencia temporal 2026-2027 vienen de boletines de despachos. No leí el decreto.
5. **Baja California 4.25%.** La consolidación de la tasa base 1.8% con las sobretasas de 1.20% y 1.25% en el art. 151-16 viene de boletines. No leí la Ley de Hacienda de BC.
6. **Estímulo de Yucatán (Decreto 147/2025)** que neutraliza el 0.75% adicional para micro y pequeñas empresas: mencionado en prensa y despachos. **La tasa de 3.75% sí está verificada** (Decreto 138/2025, DOEY 26-dic-2025); el estímulo no.
7. **Umbrales y fechas del dictamen del ISN** en CDMX, Estado de México, Campeche, Guerrero y Oaxaca. Todo viene de un boletín de despacho. La lista de estados sin dictamen también.
8. **Tasa 2026 del Impuesto sobre Remuneraciones al Trabajo Personal no Subordinado de Jalisco.** El impuesto existe (arts. 30-38 Ley de Hacienda, verificado) y la Ley de Ingresos 2026 lo presupuesta en $406,191,323, pero **no localicé el artículo de la Ley de Ingresos 2026 que fija su tasa**. Un resultado de búsqueda mencionó 5% para asimilados; no lo pude confirmar en el documento.
9. **Impuestos ecológicos de Zacatecas y Querétaro.** No leí ningún texto. Solo verifiqué que el de Estado de México aplica exclusivamente a fuentes fijas.
10. **Tarifas de refrendo y control vehicular para camiones de carga con placa federal** en Nuevo León, Jalisco y demás estados. Solo tengo cifras de vehículos particulares, de fuentes secundarias.
11. **La lista de los "16 estados que cobran tenencia" en 2026.** Verifiqué Estado de México y Puebla en fuente primaria. Los demás, no.
12. **Criterio sobre la atribución territorial del ISN para operadores que trabajan en varios estados.** No encontré norma, criterio normativo estatal ni jurisprudencia que resuelva el reparto. La práctica de atribuir al patio o base de asignación es costumbre de mercado, no norma.
13. **Si el 8% de la regla 2.2 de la RFA 2026 satisface el requisito estatal de "viáticos debidamente comprobados".** No hay criterio publicado en ningún sentido. La conclusión de la sección 10 es una hipótesis de riesgo razonada, no un fundamento.
14. **Antigüedad de algunos textos consultados.** La Ley de Hacienda del Estado de Nuevo León que leí indica última reforma P.O. 25-ene-2023; el Código Financiero de Veracruz, actualización 1-jul-2022; la Ley de Hacienda de Tamaulipas, POE 23-dic-2023. Sus artículos de ISN no aparecen reformados después, pero **no revisé los periódicos oficiales de diciembre de 2024 y diciembre de 2025 de esos tres estados** para confirmar que no hubo cambios.
15. **Tasas del Impuesto Sobre Hospedaje** fuera de Jalisco (5%) y Tamaulipas (3%), que sí verifiqué.

---

## Fuentes

### Fuentes primarias leídas (texto de ley, decreto o periódico oficial)

**Ciudad de México**
- Código Fiscal de la Ciudad de México, texto vigente publicado por la Consejería Jurídica y de Servicios Legales — arts. 156, 156 Bis, 157, 158, 159: https://data.consejeria.cdmx.gob.mx/images/leyes/codigos/CODIGO_FISCAL_DE_LA_CDMX_6.2.pdf
- Gaceta Oficial de la Ciudad de México, 27-dic-2024, Decreto que reforma el Código Fiscal de la CDMX (art. 158, tasa 4%): https://www.tjacdmx.gob.mx/images/Normatividad/codigos/2025/CODIGO_FISCAL_CDMX_27_12_2024_.pdf
- Ley de Ingresos de la CDMX 2026, Gaceta Oficial 19-dic-2025: https://servidoresx3.finanzas.cdmx.gob.mx/documentos/LeyIngresos_2026.pdf

**Nuevo León**
- Ley de Hacienda del Estado de Nuevo León, H. Congreso del Estado, última reforma P.O. 25-ene-2023 — arts. 154, 154 Bis, 155-160 Bis-4: https://www.hcnl.gob.mx/trabajo_legislativo/leyes/pdf/LEY%20DE%20HACIENDA%20DEL%20ESTADO%20DE%20NUEVO%20LEON.pdf
- Página de leyes del H. Congreso de Nuevo León: https://www.hcnl.gob.mx/trabajo_legislativo/leyes/leyes/ley_de_hacienda_del_estado_de_nuevo_leon/

**Jalisco**
- Ley de Hacienda del Estado de Jalisco, Biblioteca Virtual del Congreso del Estado — arts. 30-38 y 39-44 bis: https://congresoweb.congresojal.gob.mx/bibliotecavirtual/legislacion/Leyes/Ley%20de%20Hacienda%20del%20Estado%20de%20Jalisco%20.doc
- Ley de Ingresos del Estado de Jalisco 2026, Decreto 30121/LXIV/25 — art. 12 (hospedaje 5%) y art. 13 (ISN 3.0%): https://congresoweb.congresojal.gob.mx/bibliotecavirtual/legislacion/Ingresos/Documentos_PDF-Ingresos/Ley%20de%20Ingresos%20del%20Estado%20de%20Jalisco-240226.pdf

**Estado de México**
- Código Financiero del Estado de México y Municipios, Secretaría de Asuntos Parlamentarios del Congreso — arts. 56-59, 60-60H, 69 S-69 U Septies: https://legislacion.congresoedomex.gob.mx/storage/documentos/legislacion/7-C%C3%93DIGO%20FINANCIERO.pdf
- Decreto Número 240, Gaceta del Gobierno del Estado de México, 17-dic-2025 (reforma arts. 56 y 57): https://legislacion.edomex.gob.mx/sites/legislacion.edomex.gob.mx/files/files/pdf/gct/2025/diciembre/dic172/dic172c.pdf

**Guanajuato**
- Ley de Hacienda para el Estado de Guanajuato, H. Congreso del Estado, reforma P.O. núm. 227, 13-nov-2025 — arts. 6, 6-A, 7-17-A: https://congreso-gto.s3.amazonaws.com/uploads/reforma/pdf/3663/LHEG_REF_13Noviembre2025.pdf
- Ley de Ingresos del Estado de Guanajuato 2026: https://congreso-gto.s3.amazonaws.com/uploads/reforma/pdf/3687/LIEG_2026.pdf

**Querétaro**
- Ley de Hacienda del Estado de Querétaro, Legislatura del Estado — arts. 70-73: https://site.legislaturaqueretaro.gob.mx/CloudPLQ/InvEst/Leyes/LEY-ID-028.pdf
- Fundamento legal del ISN, Secretaría de Finanzas del Estado de Querétaro: https://asistenciaspf.queretaro.gob.mx/sites/default/files/impuestos/pdf/1.1%20FUNDAMENTO%20LEGAL%20ISN.pdf

**Coahuila**
- Ley de Hacienda para el Estado de Coahuila de Zaragoza, Congreso del Estado, última reforma P.O. 30-dic-2025 — arts. 21-26: https://www.congresocoahuila.gob.mx/transparencia/03/Leyes_Coahuila/coa25.pdf
- Decreto de estímulos fiscales 2026, Periódico Oficial del Estado de Coahuila, 30-dic-2025: https://www.irycdecoahuila.gob.mx/Media/Descargas/DECRETO.pdf

**Tamaulipas**
- Ley de Hacienda para el Estado de Tamaulipas, Periódico Oficial del Estado, última reforma POE Extr. núm. 37, 23-dic-2023 — arts. 45-52: http://po.tamaulipas.gob.mx/wp-content/uploads/2024/02/Ley_Hacienda.pdf
- Ley de Ingresos del Estado de Tamaulipas 2026: https://transparencia.tamaulipas.gob.mx/wp-content/uploads/2026/02/Ley-de-Ingresos-del-Estado-2026.pdf

**Quintana Roo**
- Ley del Impuesto Sobre Nóminas del Estado de Quintana Roo, Congreso del Estado, última reforma POE 16-dic-2025: https://documentos.congresoqroo.gob.mx/leyes/L167-XVIII-20251216-L1820251216190-Ley-del-Impuesto-sobre-N%C3%B3minas.pdf

**Yucatán**
- Diario Oficial del Gobierno del Estado de Yucatán, 26-dic-2025, núm. 35,877 — Decreto 138/2025 (art. 24 LGH, tasa 3.75%), Decreto 139/2025 y Decreto 140/2025: https://www.yucatan.gob.mx/docs/diario_oficial/diarios/2025/2025-12-26_1.pdf

**Veracruz**
- Código Financiero para el Estado de Veracruz de Ignacio de la Llave, H. Congreso del Estado, actualización 1-jul-2022 — arts. 98-105: https://www.legisver.gob.mx/leyes/LeyesPDF/CF01072022.pdf

**Puebla**
- Ley de Ingresos del Estado de Puebla para el Ejercicio Fiscal 2026, Orden Jurídico Poblano — arts. 16, 17, 120, 121: https://ojp.puebla.gob.mx/media/k2/attachments/Ley_de_Ingresos_del_Estado_de_Puebla,_para_el_Ejercicio_Fiscal_2026_EV_27112025.pdf
- Ley de Hacienda para el Estado Libre y Soberano de Puebla: https://ojp.puebla.gob.mx/media/k2/attachments/Ley_de_Hacienda_para_el_Estado_Libre_y_Soberano_de_Puebla_T5_05082024.pdf

**Federal (contexto)**
- Resolución de facilidades administrativas para los contribuyentes de los sectores que en la misma se señalan para 2026, DOF 17-feb-2026 — Título 2, reglas 2.1 a 2.13: https://www.sat.gob.mx/minisitio/NormatividadRMFyRGCE/documentos2026/rfa/rfa/RFA2026_17022026.pdf
- Misma resolución en el DOF: https://www.dof.gob.mx/nota_detalle.php?codigo=5780249&fecha=17%2F02%2F2026
- Ley de Ingresos de la Federación 2026: http://www.diputados.gob.mx/LeyesBiblio/pdf/LIF_2026.pdf

### Fuentes oficiales estatales (portales de secretarías y agencias fiscales)

- Secretaría de Hacienda del Estado de Sonora — ISRTP, tasa 3% y cuota adicional del 1%: https://hacienda.sonora.gob.mx/inicio/acciones/material-fiscal/que-es-el-isrtp
- Secretaría de Hacienda del Estado de Sonora — requisitos de inscripción al padrón del ISRTP: https://hacienda.sonora.gob.mx/contribuyentes/impuesto-sobre-remuneracion-al-trabajo-personal-isrtp
- Secretaría de Finanzas de la CDMX — criterio del Impuesto sobre Nóminas: https://transparencia.finanzas.cdmx.gob.mx/repositorio/public/upload/repositorio/Tesoreria/123/b/Criterio_9/123_XV_Impuesto_sobre_nominas_2024.pdf
- Secretaría de Finanzas del Estado de México — Reglas para el impuesto sobre erogaciones por remuneraciones al trabajo personal: https://sfpya.edomexico.gob.mx/recaudacion/ReadFile.jsp?File=5.Reglas_Erogaciones_Remuneraciones_Trabajo_Personal.pdf
- Secretaría de Finanzas del Estado de México — Tenencia: https://finanzas.edomex.gob.mx/tenencia
- Congreso de la Ciudad de México — Código Fiscal 2026: https://www.congresocdmx.gob.mx/comsoc-codigo-fiscal-2026-busca-bienestar-y-equidad-ciudad-mexico-6957-1.html
- Congreso del Estado de Chihuahua: https://www.congresochihuahua.gob.mx/detalleNota.php?id=12847
- Gobierno del Estado de Nuevo León — Paquete Fiscal 2026: https://www.nl.gob.mx/es/boletines/propone-el-ejecutivo-paquete-fiscal-2026-solido-responsable-y-enfocado-en-inversion

### Fuentes secundarias (pistas, NO fundamento)

- Academia de Amparo — tabla ISN 2026 de las 32 entidades: https://www.academiadeamparo.com/p/impuesto-sobre-nominas-isn-2026-por.html
- El Contribuyente — ISN 2026 por estado: https://www.elcontribuyente.mx/impuesto-sobre-nominas/
- El Contribuyente — estados que suben el impuesto al empleo en 2026: https://www.elcontribuyente.mx/2026/02/nominas-mas-caras-en-2026-los-estados-que-suben-el-impuesto-al-empleo/
- EY México — Nuevas disposiciones a la Ley de Hacienda de Chihuahua: https://www.ey.com/es_mx/technical/tax/boletines-fiscales/nuevas-disposiciones-a-la-ley-de-hacienda-de-chihuahua
- EY México — Nueva sobretasa al impuesto sobre nóminas en BC: https://www.ey.com/es_mx/technical/tax/boletines-fiscales/nueva-sobretasa-al-impuesto-sobre-nominas-en-bc
- Galicia — Baja California, ISRTP: https://www.galicia.com.mx/links/publicacion?p=863
- Galicia — Impuesto sobre Nóminas, CDMX: https://www.galicia.com.mx/links/publicacion?p=836
- KPMG — Actualización de las obligaciones de dictaminar impuestos estatales: https://kpmg.com/mx/es/tendencias/2025/08/ao-actualizacion-de-las-obligaciones-de-dictaminar-impuestos-estatales.html
- KPMG — Criterios judiciales sobre el impuesto a la emisión de gases contaminantes en el Estado de México: https://kpmg.com/mx/es/home/tendencias/2025/07/flash-criterios-judiciales-relevantes-en-materia-del-impuesto-a-la-emision-de-gases-contaminantes-en-el-estado-de-mexico.html
- BHR México — Dictamen del ISN 2026: https://www.bhrmx.com/dictamen-del-isn-2026-obligaciones-y-fechas-que-no-puedes-pasar-por-alto/
- BHR México — Cambios fiscales estatales 2026, Estado de México: https://www.bhrmx.com/cambios-fiscales-estatales-para-2026-estado-de-mexico/
- BHR México — Impuestos sobre hospedaje 2026: https://www.bhrmx.com/impuestos-sobre-hospedaje-2026-nuevas-obligaciones-y-beneficios/
- Chevez Ruiz Zamarripa — Reformas y beneficios fiscales Edomex 2026: https://www.chevez.com/upload/files/DctoFL_CL_2025-16.pdf
- Garrigues — Reglas generales para acceder a los beneficios del ISN en CDMX: https://www.garrigues.com/es_ES/noticia/ciudad-mexico-emite-reglas-caracter-general-acceder-beneficios-impuesto-nominas
- Revista TyT — SAT publica facilidades administrativas 2026 para el autotransporte federal: https://www.tyt.com.mx/nota/sat-publica-facilidades-administrativas-2026-para-el-autotransporte-federal
- Consultorio Fiscal UNAM — Cambios relevantes en el Código Financiero del Estado de México: https://consultoriofiscal.unam.mx/articulo.php?id_articulo=3045
- Grant Thornton — Art. 56 Código Financiero del Estado de México: https://www.grantthornton.mx/alertas/alerta25-2024/
- IDC Online — Impuesto sobre nóminas por entidad: https://idconline.mx/herramientas/fiscal-contable/impuesto-sobre-nominas
