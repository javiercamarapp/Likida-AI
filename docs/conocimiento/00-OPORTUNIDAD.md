# La oportunidad: todo lo que un agente experto de esta industria puede atacar

> Ola 2 — 27-jul-2026. Consolida `30-dolores-flota.md`, `31-cumplimiento-continuo.md`,
> `32-fraude.md`, `33-ingresos-adyacentes.md`, `34-proceso-liquidacion.md` y `11-huecos.md`.
> Orden de construcción y decisiones: `00-ROADMAP.md`. Cambios sobre el código: `00-MEJORAS.md`.

**La tesis:** Likida no compite en la capa de medio de pago (Mendel/Visa, Uvicuo/Mastercard: pelea de
balance y plástico, ya perdida) ni en la de "agentes de IA" (Handle, con 6 MDD de a16z). El terreno
libre es la **capa de deducibilidad y facilidades del sector**, y el comprador es **el contralor que
tiene que defender la deducción en una revisión**, no el dueño que quiere control del gasto.

Todo lo que sigue se ordena por **(valor para el contralor) × (cercanía a lo que Likida ya ve) ÷
(esfuerzo)**. "Cercanía" significa: ¿consume un dato que el sistema ya recibe, o exige una fuente
nueva? Es el filtro que separa una extensión de una distracción.

---

## Cómo se leen los puntajes

- **Valor (1-5):** cuánto le importa al contralor, medido en dinero defendible o en riesgo evitado.
- **Cercanía (1-5):** 5 = usa datos que Likida ya tiene hoy; 1 = exige una fuente de datos nueva.
- **Esfuerzo (1-5):** 5 = meses; 1 = horas.
- **Puntaje = V × C ÷ E.** No es ciencia: es para que el orden no dependa del entusiasmo del día.

---

## Tabla maestra

| # | Oportunidad | V | C | E | Puntaje | Fase |
|---|---|---|---|---|---|---|
| 1 | `totalDeducible` / `totalNoDeducible` en la liquidación | 5 | 5 | 1 | **25.0** | 0 |
| 2 | Reloj de 5 días de contabilización (RCFF 33) | 4 | 5 | 1 | **20.0** | 2 |
| 3 | Seis reglas de desviación con datos que ya existen | 4 | 5 | 1 | **20.0** | 2 |
| 4 | Topes laborales de descuento (LFT 110) | 3 | 5 | 1 | **15.0** | 1 |
| 5 | Export de cierre contable: pólizas + DIOT + UUID/forma de pago | 5 | 5 | 2 | **12.5** | 2 |
| 6 | Validación masiva de RFC del padrón de proveedores | 3 | 4 | 1 | **12.0** | 2 |
| 7 | Alerta del umbral de 300 MDP del estímulo de casetas | 4 | 3 | 1 | **12.0** | 1 |
| 8 | Gating del estímulo de peaje (TAG + elegibilidad + tope) | 4 | 5 | 2 | **10.0** | 1 |
| 9 | Monitor 69-B + reloj de 30 días del art. 49 Bis | 5 | 4 | 2 | **10.0** | 2 |
| 10 | Los cinco contadores fiscales del ejercicio | 5 | 5 | 3 | **8.3** | 1 |
| 11 | Carpeta de auditoría del sistema (RCFF 34) | 4 | 4 | 2 | **8.0** | 2 |
| 12 | Precio por litro contra el feed público de la CNE | 4 | 4 | 2 | **8.0** | 2 |
| 13 | CFDI mensual del proveedor de TAG | 4 | 4 | 2 | **8.0** | 2 |
| 14 | Comprar la capa ticket→CFDI en vez de construirla | 4 | 4 | 2 | **8.0** | 2 |
| 15 | Bitácora fiscal de peaje conciliada + inventario de marzo | 5 | 4 | 3 | **6.7** | 2 |
| 16 | Motor de cuotas semanales de IEPS (litros × cuota) | 5 | 4 | 3 | **6.7** | 1 |
| 17 | Estado de cuenta del emisor de monedero (ECC) | 5 | 4 | 3 | **6.7** | 2 |
| 18 | Reloj del buzón tributario (3 días, silencio = aceptación) | 4 | 3 | 2 | **6.0** | 2 |
| 19 | Veredicto `pagadero` separado de `deducible` (LFT 257, 263-I) | 3 | 4 | 2 | **6.0** | 1 |
| 20 | Chequeo mensual del 32-D de la propia flota | 3 | 2 | 1 | **6.0** | 2 |
| 21 | Convenios de referidos (factoraje, seguros, financiamiento) | 3 | 2 | 1 | **6.0** | 3 |
| 22 | Registro de vencimientos por unidad y operador (T-30/15/1) | 5 | 3 | 3 | **5.0** | 2 |
| 23 | Insumos de nómina 003/050/081 con las 5 condiciones verificadas | 4 | 3 | 3 | **4.0** | 2 |
| 24 | Tiempos de espera en carga y descarga (detention) | 4 | 3 | 3 | **4.0** | 3 |
| 25 | Registro electrónico de jornada (LFT 132-XXXIV, ene-2027) | 4 | 3 | 3 | **4.0** | 3 |
| 26 | API del motor de validación vendida a despachos | 4 | 3 | 3 | **4.0** | 3 |
| 27 | Vigilante de vigencia normativa (tres anillos) | 4 | 2 | 2 | **4.0** | 2 |
| 28 | Detección de ordeña por rendimiento real (km/L por unidad) | 5 | 3 | 4 | **3.75** | 3 |
| 29 | Clasificador de Carta Porte por radio de 30 km | 4 | 3 | 4 | **3.0** | 3 |
| 30 | Mantenimiento preventivo por unidad | 3 | 2 | 3 | **2.0** | 3 |
| 31 | Expediente de siniestro | 3 | 2 | 3 | **2.0** | 3 |
| 32 | Robo de mercancía y de unidades | 5 | 1 | 5 | **1.0** | No |
| 33 | Rotación y reclutamiento de operadores | 4 | 1 | 5 | **0.8** | No |
| 34 | Facturación al cliente y cobranza | 4 | 1 | 5 | **0.8** | No |
| 35 | Monedero propio / PAC propio / aseguradora / datos de precio | 3 | 1 | 5 | **0.6** | Nunca |

---

## Tier 1 — lo que se construye primero (puntaje ≥ 10)

### 1. `totalDeducible` / `totalNoDeducible` — puntaje 25.0

**Qué es.** La liquidación cierra hoy con `totalComprobado`, `diferencia` y tres acreditables, pero
**sin** total deducible ni total no deducible. El motor ya sabe qué gasto cayó en `NO_DEDUCIBLE`
(`engine.ts:218`) y **tira el dato**. El contralor recibe un PDF donde el "no deducible" está disperso
en renglones de texto.

**Dato que usa.** Ninguno nuevo. Un `reduce` y una columna.

**Por qué es la número uno.** Es literalmente la cifra que el comprador compra. Todo el argumento del
producto —"el motor que dicta el veredicto de deducibilidad"— se resume en un número que hoy no se
imprime. Es también la única mejora de esta lista que se puede hacer en una hora.

**Criterio de éxito.** Una liquidación de prueba imprime las dos cifras y suman `totalComprobado`.

---

### 2. Reloj de 5 días de contabilización — puntaje 20.0

**Qué es.** El RCFF art. 33 exige que los asientos contables se hagan **dentro de los 5 días** del
hecho, ligados al folio del CFDI y con la forma de pago identificada. Y el mismo reglamento declara
que **los estados de cuenta de monederos de combustible son contabilidad**.

**Dato que usa.** La fecha del gasto y la del CFDI, que ya existen.

**Por qué importa.** Es el mejor argumento de urgencia que tiene el producto y **nadie lo usa**. No es
"te ahorro trabajo": es "vas tarde desde el día 6, y este reloj lo prueba". Convierte una venta de
conveniencia en una venta de cumplimiento.

**Criterio de éxito.** Un gasto de hace 6 días sin asiento aparece en rojo en el panel del contralor,
con la cita de la ficha `RCFF-33` y la fecha en que venció.

---

### 3. Seis reglas de desviación con datos que ya existen — puntaje 20.0

**Qué son** (`32-fraude.md` §3, reglas 1 a 6). Ninguna necesita un campo nuevo, una integración ni una
migración de esquema:

1. `duplicado_entre_viajes` — ampliar el dedupe a alcance de **tenant**. Hoy `gastoExistePorHash`
   recibe `viajeId`: un ticket reciclado en otro viaje pasa invisible.
2. `folio_repetido_monto_distinto` — cambiar la clave de `concepto|folio|monto` a
   `concepto|estación|folio` y **marcar** cuando el monto difiera. Es la huella exacta del ticket
   alterado, y hoy es invisible justamente porque el monto distinto rompe la clave completa.
3. `dias_viatico_excede_viaje` — contra `Viaje.fechaInicio/fechaFin`.
4. `precio_litro_fuera_de_historico_propio` — promedio móvil de la propia flota.
5. `caseta_fuera_de_historico`.
6. `folio_no_facturado_prolongado` — señal parcial de carga fantasma.

**Por qué importan.** El 80% de los fraudes de flotilla en México viene de cargas irregulares de
combustible según la firma Pulpo (citada por Milenio) — *cifra autodeclarada de un proveedor,
SIN VERIFICAR, no usar en material comercial*. Pero Edenred, Geotab y Ubícalo describen de forma
independiente los mismos patrones, lo que confirma la **dirección**: primero combustible, después
casetas y viáticos.

**Regla de diseño no negociable.** Ninguna alerta descuenta, retiene pago ni concluye. Plantilla fija:
*medido / comparado contra / desviación sin adjetivos / lo que no se sabe / quién decide*, con al
menos una explicación no fraudulenta plausible. **Nunca** las palabras "fraude", "robo" o "robó".
No es buen gusto: el art. 26 fr. II de la LFPDPPP le da al operador derecho de oposición cuando un
sistema evalúa su fiabilidad sin intervención humana, y un despido sobre evidencia débil es una
demanda laboral para el cliente y un incidente para Likida.

**Además, evalúa sobre ventana, no sobre evento.** Un ticket caro un día es ruido; el mismo patrón
sostenido varias veces es señal. Las reglas 4 y 5 deben correr sobre varias cargas antes de mostrarse.

**Criterio de éxito.** Corren sobre el histórico de un cliente real y producen **menos de una alerta
por unidad por mes**. Si producen más, el umbral está mal y el contralor las apaga en la primera semana.

---

### 4. Topes laborales de descuento (LFT art. 110 fr. I) — puntaje 15.0

**Qué es.** Lo exigible al operador nunca puede exceder **un mes de su salario**, y el descuento por
periodo no puede pasar del **30% del excedente sobre el salario mínimo**.

**Dato que falta.** El salario del operador. Un campo en la tabla `operador`.

**Por qué importa.** `09-liquidacion.md` dice que multas y faltantes "sí entran como descuento si está
pactado". Sin el tope, el sistema le imprime al contralor un **neto a pagar ilegal**: una liquidación
que absorbe un anticipo grande contra un sueldo chico puede imprimir "a pagar: $0" fuera de la ley.

**SIN VERIFICAR.** Cómo se miden "un mes de salario" y "el excedente del mínimo" cuando el operador
cobra por viaje o por kilómetro. Ningún archivo encontró criterio. La lectura razonada es usar el
promedio del periodo relevante; el sistema debe decirlo, no fingir certeza.

---

### 5. Export de cierre contable: pólizas + DIOT + UUID/forma de pago — puntaje 12.5

**Qué es.** Lo que sale hoy hacia el ERP es un **CSV plano de una fila por viaje** (`export.ts`):
folio, operador, fecha, comprobado, anticipo, diferencia, estatus. No separa por concepto ni por grupo
fiscal, no trae UUID + forma de pago por renglón —**requisito literal del RCFF art. 33**—, no calcula
insumos de nómina y no genera la DIOT (LIVA art. 32 fr. VIII).

**Dato que usa.** Todo ya existe limpio en el modelo. Es una exportación, no una funcionalidad nueva.

**Por qué es el dolor más cercano de todos.** El cierre contable es **el destino final de cada
comprobante que Likida procesa**. Consume el dato que el producto ya produce sin capturar nada nuevo.
Cuesta 8-16 h/mes de conciliación manual (*PISTA, de proveedores de software; no verificado*).

**Criterio de éxito.** El export de DIOT cuadra contra el CFDI recibido de un mes real de un cliente,
verificado por su contador.

---

### 6. Validación masiva de RFC del padrón de proveedores — puntaje 12.0

**Qué es.** El SAT expone una validación masiva de RFC, **hasta 5,000 por corrida, sin autenticación**.
Detecta RFC inválidos o con nombre/CP inconsistente antes de que rechacen una deducción en la anual.

**Cadencia:** mensual. Es gratis y sin límite operativo real, pero el dato no cambia todos los días.

---

### 7. Alerta del umbral de 300 MDP del estímulo de casetas — puntaje 12.0

**Qué es.** El estímulo del 50% de peaje solo aplica a contribuyentes con ingresos anuales menores a
300 MDP, y **el umbral opera retroactivamente al inicio del ejercicio**. Una flota en crecimiento que
lo cruce en noviembre debe presentar complementarias de **todo el año**, con actualización y recargos.

**Por qué es barato y caro a la vez.** Es un contador contra un número que el cliente da en el
onboarding. Si Likida no alerta, **facilitó el pasivo**.

---

### 8. Gating del estímulo de peaje — puntaje 10.0

**Qué es.** Hoy `engine.ts:231` aplica un factor 0.5 sobre el SubTotal de cualquier caseta con XML.
La RMF 2026 regla 9.1.8 exige cinco cosas y el código cumple **una**:

| Requisito | ¿Lo verifica hoy? |
|---|---|
| I. Aviso en **marzo** por buzón tributario con inventario vehicular | No existe |
| II. **Bitácora de viaje** conciliada con el estado de cuenta del TAG | No existe (`grep -i "tag\|bitacora"` → 0 resultados) |
| III. Pago con **TAG o sistema electrónico** (efectivo en ventanilla no genera estímulo aunque haya CFDI) | No verifica `formaPago` |
| IV. Factor 0.5 sobre el importe **sin IVA** | **Sí** |
| Tope: ingresos anuales **< 300 MDP** | No existe el dato del tenant |

Y el número se imprime **en verde y en negritas** en el PDF (`pdf.ts:149`) y se acumula en el dashboard.

**Riesgo si no se hace.** Es una cifra inflada e indefendible en revisión, presentada además en bruto
cuando el estímulo es **ingreso acumulable** (el beneficio real es estímulo × (1 − tasa ISR); un ROI
sobre el bruto infla la propuesta ~30%). Si el cliente la acredita con nuestro número, el pasivo es
suyo y la culpa nuestra.

---

### 9. Monitor 69-B + reloj de 30 días del art. 49 Bis — puntaje 10.0

**Qué es.** Dos relojes que hoy nadie vigila:

- **Art. 49 Bis, 30 días naturales** (nuevo desde el 01-ene-2026). Si un proveedor recurrente sale
  publicado en el DOF por el procedimiento exprés de comprobantes falsos, el receptor tiene 30 días
  naturales para revertir el efecto fiscal o el SAT le restringe **su propio CSD** — o sea, la flota
  **no puede facturarle a sus clientes**. Es riesgo de continuidad de negocio, no solo fiscal.
- **Barrido semanal** de los CSV de datos abiertos del SAT (arts. 69, 69-B, 69-B Bis, CSD sin efectos)
  contra todos los RFC recurrentes de cada flota.

**Advertencia de diseño.** Esos CSV llevan **semanas o meses de retraso** (el 69-B decía "actualizado
al 31-may" consultado el 27-jul). Son **red de respaldo**, no fuente principal. La fuente principal es
el web service puntual por CFDI, que ya existe.

**A quién le llega.** Al **contralor**, nunca al operador. Es una decisión de negocio (¿se sigue
comprando con ese proveedor?) que cierra un humano.

**Por qué es el ROI más fácil de defender.** No pide ningún dato nuevo, corre solo, y la consecuencia
que evita es catastrófica y fácil de explicar en una frase.

---

### 10. Los cinco contadores fiscales del ejercicio — puntaje 8.3

**Qué son.** La capa de periodo completa. **Ningún competidor los lleva**, y hoy tampoco Likida: el
motor corre viaje por viaje, sin noción de mes ni de ejercicio.

1. **15% de combustible pagado por medios no bancarizados** (RFA 2026 regla 2.9). Rebasarlo tira el
   excedente **completo**, no proporcionalmente, y con él su IVA acreditable. *Periodicidad
   SIN VERIFICAR: la regla no dice si es mensual, acumulado o anual.*
2. **8% de ingresos propios / $1,000,000 / diferencia ingresos-deducciones** de deducción ciega
   (RFA 2026 regla 2.2), con el **16% de ISR definitivo** que se entera al día 17. *SIN VERIFICAR si
   el tope de $1M es por integrante o por coordinado.*
3. **20% de viáticos no comprobados "en cada ocasión" y $15,000 anuales por persona** (RLISR 152),
   *más* la verificación de que el 80% restante se erogó con **tarjeta del patrón**.
4. **Topes diarios por concepto**: $750 alimentación nacional, $1,500 extranjero, $850 renta de auto,
   $3,850 hospedaje extranjero. **No existe tope de hospedaje nacional.**
5. **Faja de 50 km** alrededor de la base de asignación del operador (LISR 28 fr. V, RLISR 57).
   *SIN VERIFICAR aplicada a un operador de largo recorrido: el RLISR 57 define "establecimiento" como
   donde la persona presta normalmente sus servicios, y para un operador eso es discutible.*

**Empezar por el 15%.** Es el de mayor retorno inmediato, el que ya está mal implementado hoy, y el
que se explica en una lámina: "llevas 12.3% de tu combustible en efectivo; a 15% pierdes el excedente
completo".

**El sexto contador, que no es fiscal:** los dos topes laborales del punto 4 de esta lista.

---

## Tier 2 — lo que sigue (puntaje 5 a 10)

### 11. Carpeta de auditoría del sistema (RCFF art. 34)

El contribuyente debe **conservar el diseño y los diagramas del sistema** que procesa sus datos
contables y dar acceso al SAT. Si Likida no le entrega esa carpeta al cliente en el onboarding, **el
cliente incumple sin saberlo**. Es un entregable de documentación, no de código, y es un argumento de
cierre: ningún competidor lo da.

### 12. Precio por litro contra el feed público de la CNE

La CNE publica **gratis y sin autenticación** un XML diario con el precio de gasolina y diésel por
estación de todo el país (Acuerdo A/041/2018); Profeco publica un comparativo semanal regional.
Sube la regla de precio por litro de "contra mi propio histórico" a "contra el mercado real", sin
ninguna credencial del cliente ni scraping de portal privado: califica **verde** en el semáforo de
automatización de `11-datos-personales.md`.

*Pendiente antes de comprometer la integración:* confirmar qué campo identifica la estación (RFC del
permisionario, número de permiso, o ambos).

### 13. CFDI mensual del proveedor de TAG (IAVE, PASE, TeleVía)

Dato timbrado del peaje real. Es el insumo de la bitácora conciliada (#15) y el que hace defendible el
estímulo del 50%.

### 14. Comprar la capa ticket→CFDI

FacturaGPT cobra **$4 MXN + IVA por CFDI exitoso**, con `external_id` y webhook, y trae +1,000
comercios. Construir solo los 10-15 conectores de carretera que importan. Recuperar facturas es un
commodity que ya se regala: Mendel publica 96% y Fotofacturas 92%. **Prometer más es un número
imposible de sostener.**

### 15. Bitácora fiscal de peaje conciliada + inventario vehicular de marzo

**El gancho comercial más fuerte de todo el paquete.** La regla 9.1.8 exige exactamente el output de
una liquidación de viajes: origen, destino y ruta que **coincidan** con el estado de cuenta del TAG,
más un aviso en marzo por buzón tributario con inventario vehicular detallado. Hoy se hacen a mano o
no se hacen, y sin ellos el estímulo es indefendible en revisión.

**Recordatorio de vocabulario:** siempre con apellido —"bitácora fiscal de peaje (RMF 9.1.8-II)"—
para no confundirla con la bitácora de horas de servicio del RTCPJF 83 / NOM-087, que Likida
pre-llena pero nunca sustituye.

### 16. Motor de cuotas semanales de IEPS

**Dejó de ser una mejora técnica y se volvió requisito de cumplimiento de Likida.** El criterio
**1/LIF/PI** (Anexo 3 RMF 2026, DOF 09-ene-2026) declara práctica fiscal indebida determinar el
estímulo con las cuotas actualizadas de la LIEPS en lugar de las disminuidas conforme a las que el
IEPS se causó — y su **fracción II alcanza a "quien asesore, aconseje, preste servicios o participe"**.
Un motor con $7.3634 constantes no comete un bug: implementa la práctica indebida.

La cuota fue de **$7.3634/L** (7-13 marzo, estímulo 0%) a **$2.0925/L** (25-31 julio, estímulo
71.58%). Para una flota de 200 mil litros/mes, la diferencia entre la cuota correcta y una constante
es del orden de **un millón de pesos al mes**.

**Bloqueo real:** la regla 11.7.3, adicionada el 09-jul-2026, disminuye el "precio base del diésel"
entre $0.28 y $1.04 por litro en 13 fechas concretas, retroactivo al 1-abr-2026 por su Transitorio
Sexto. Nadie ha conciliado esa capa con el acuerdo semanal de la SHCP. **Exponer las dos cifras por
separado, nunca fusionadas, hasta que un fiscalista lo firme.**

### 17. Estado de cuenta del emisor de monedero (ECC)

**Es la integración #1 del paquete, y cambia el pitch entero.** Si la flota usa monedero electrónico
autorizado, la gasolinera **tiene prohibido facturarle**: el comprobante deducible es el CFDI del
emisor del monedero con el Complemento de Estado de Cuenta de Combustibles, y la deducción está topada
a lo que ampare ese complemento (RMF 2026 reglas 3.3.1.7 y 3.3.1.10 fr. III).

O sea: **para una flota con monedero, la foto del ticket de diésel fiscalmente no sirve.** El ECC es
dato timbrado y granular, mejor que cualquier OCR.

**La primera pregunta de calificación de un prospecto es "¿ya traen monedero?"**, porque de la
respuesta depende si el pitch es "conectamos tu monedero" o "te salvamos el 15% de la regla 2.9".

*Riesgo de dependencia:* la autorización de los emisores se renueva anualmente (ficha 7/ISR,
agosto-octubre) y el SAT publica el padrón de no renovados. Si el emisor cae, el cliente se queda sin
comprobante deducible de combustible. Hay que vigilarlo.

### 18. Reloj del buzón tributario (3 días)

Cuando un emisor pide cancelar un CFDI, el receptor tiene **3 días para negarse y el silencio se
considera aceptación** (RMF 2026 regla 2.7.1.34). Una flota desatendida pierde deducciones por omisión
y ni se entera.

### 19. Veredicto `pagadero` separado de `deducible`

Cuando el viaje se alarga por causa **no imputable al operador**, la LFT art. 263 fr. I obliga a pagar
hospedaje y comida aunque el gasto rompa la política interna o el tope fiscal de $750/día; y el
art. 257 dice que el salario por viaje no se puede reducir si el viaje se acorta, y **sube** si se
alarga por causa ajena.

El motor de hoy produce **un solo veredicto por gasto**. Si se usa ese veredicto para decidir qué se
le paga al operador, se le puede negar un pago que la ley obliga a hacer.

### 20. Chequeo mensual del 32-D de la propia flota

Con las credenciales que el contralor ya usa. Responde una pregunta real: "¿podemos participar en esta
licitación / pedir este financiamiento hoy?".

**Lo que NO se puede:** el 32-D de un **proveedor** no se puede consultar sin que él autorice
expresamente a Likida como "tercero autorizado" en el Portal del SAT. No hay ruta pública. No prometerlo.

### 21. Convenios de referidos: factoraje, seguros, financiamiento

**Cero capital, cero licencia.** La LGOAAC art. 87-B dice que cualquier persona puede otorgar crédito,
arrendamiento financiero o factoraje **sin autorización del Gobierno Federal**. La barrera real es el
capital para fondear, no el trámite — así que Likida entra como **referido**, no como fondeador.

- Factoraje: Solvento (levantó $75M USD en deuda), Konfío, Klar, SOFOM regionales.
- Seguro de carga: Sumari, MAS Seguros, Sobera, Transcargo.
- Unidades: Serfimex, Credijal, Grupo IBC, TIP México, SOFOM Inbursa.

**A investigar aparte:** el art. 102 de la LISF (persona moral que coloca seguros de adhesión sin ser
agente completo) podría abrir un **seguro de carga embebido y cotizado por viaje** que ningún TMS ni
app de facturación ofrece hoy.

### 22. Registro de vencimientos por unidad y por operador

**El diferenciador más defendible de toda la ola 2.** Permiso SICT de empresa, verificación
físico-mecánica, verificación de emisiones, aptitud psicofísica y vigencia de pólizas de seguro **NO
tienen ninguna consulta pública verificada** —a pesar de que el art. 202 de la LISF obliga a registrar
las pólizas ante la CNSF.

Ese es el hueco real del mercado: **un registro de vencimientos con evidencia documental (OCR de la
fecha) vence a una promesa de API que no existe.** Alertas T-30 / T-15 / T-1, y estado `sin_evidencia`
distinto de `vencido` — nunca cerrar una alerta solo con un OCR de baja confianza.

**Hallazgo que matiza, no contradice:** sí existe un buscador público de la **Licencia Federal de
Conductor** en la SICT/DGAF (`app.sct.gob.mx/ConsultaInfracciones/detalleLicFederal.do`), protegido
con CAPTCHA. Es la **licencia de la persona**, objeto distinto del **permiso de la empresa** del que
hablan `07` y `10`. Uso manual puntual en el alta de un operador; **nunca automatizar el CAPTCHA**.

---

## Tier 3 — después, cuando haya clientes (puntaje 2 a 5)

### 23. Insumos de nómina 003/050/081

Calculados con **las cinco condiciones de exención del RLISR 152 verificadas**, no copiadas de la tabla
de ejemplo del portal del SAT. Evita timbrar como exento un monto que en realidad es gravado.
Likida **no timbra** el CFDI de nómina: entrega los números para que lo timbre otro sistema.

*SIN VERIFICAR:* si "erogar con tarjeta del patrón" admite el monedero de combustible cuando el gasto
no es de combustible. Se asumió que no (la regla 3.3.1.6 limita el monedero a comprar combustible).

### 24. Tiempos de espera en carga y descarga

Evento `llegada` / `salida` de zona, con hora y geolocalización. Likida ya tiene la mitad del dato en
los timestamps de WhatsApp. Convierte un costo difuso (*$30k-$96k MXN/día reportado por proveedores,
PISTA*) en una **obligación legal medible** (LFT 257 y 263-I). Ningún competidor del mapa lo tiene.

### 25. Registro electrónico de jornada (LFT art. 132 fr. XXXIV)

Reforma de jornada laboral, DOF 01-05-2026: 48 h semanales en 2026 bajando a 40 en 2030, **tope duro
de 12 horas diarias** (art. 68), y obligación de registrar electrónicamente la jornada de cada
trabajador **desde el 1-ene-2027**, con multa de 250 a 5,000 UMA (**$29,327 a $586,550** con la UMA
2026 de $117.31).

**Fecha fija, multa nombrada, cero competidores, y reutiliza timestamps que ya se capturan.** Es el
único pedazo accionable del dolor de rotación y déficit de operadores (déficit de 80,000-99,000
operadores, 90,000 camiones parados por falta de choferes — CANACAR/IRU).

**Choque de ordenamientos que hay que resolver en el producto:** la NOM-087 num. 4.6 a) contempla
rutas con conducción máxima de **14 horas**; la LFT reformada topa la jornada total en **12**. Manda la
ley. El umbral del detector baja a 12 h y el producto explica los dos límites.

*Las disposiciones de carácter general de la STPS aún no se emiten: no se sabe qué flotas quedan
exceptuadas ni qué formato pide la autoridad.*

### 26. API del motor de validación vendida a despachos contables

**La única línea adyacente 100% defendible.** Reusa el activo único de Likida (el viaje) en vez de
competir donde hay más capital o donde el gobierno regala el dato. No requiere ser PAC: se compra la
capa de certificación a un tercero.

### 27. Vigilante de vigencia normativa (tres anillos)

Valor indirecto pero alto: es lo que evita que las citas se pudran en producción.

- **Anillo 1, leyes — mensual.** Índice diario del DOF (responde 200 a peticiones automatizadas) +
  `pdftotext -layout`, ya instalado.
- **Anillo 2, RMF/RFA — semanal.** Minisitio HTML `normatividad_rmf_rgce{año}.html`, **no** la SPA que
  devuelve 403. *Hallazgo crítico:* la RMF se modifica en **versiones anticipadas que ya son legalmente
  vigentes desde su publicación en el portal del SAT**, no desde el DOF. La 1a Resolución de 2026 tuvo
  **16 versiones anticipadas** (23-feb a 2-jul), semanales desde mayo. Vigilar solo el DOF es vivir con
  semanas de retraso respecto a reglas ya vigentes.
- **Anillo 3, catálogos y XSD — diario.** `HEAD` + diff del `Last-Modified`. Es el mecanismo que
  atrapó al `catCartaPorte.xsd` cambiando el 13-ene-2026 mientras la página seguía diciendo 13-dic-2024.

### 28. Detección de ordeña por rendimiento real

Cruzar litros contra km ÷ rendimiento esperado, por unidad y por operador, detecta el robo del propio
tanque (**80-300 L por evento**) con aritmética simple, sin GPS ni telemetría.

**Bloqueo real que corrige una premisa del encargo:** el código verificado **no captura** los dos
campos que esta regla necesita. `hora` se descarta al normalizar la fecha (`fecha.ts` solo guarda
`YYYY-MM-DD`) y `rendimiento` no se puede calcular porque **no existe la entidad `Unidad`** con
capacidad de tanque ni km recorridos en ningún tipo del dominio. Por eso baja a Fase 3: primero el
modelo de datos.

Mientras tanto, la versión barata sí sirve: **pedir el odómetro junto a cada ticket de diésel** desde
ya, aunque el cálculo se haga a mano.

### 29. Clasificador de Carta Porte por radio de 30 km

Se implementa **con geometría, no con odómetro**: la regla 2.7.7.2.8 habla de un radio de 30 km entre
origen inicial y destino final incluyendo puntos intermedios, no de kilómetros recorridos. Un reparto
de 90 km de carretera federal puede quedar exento. Casi todos lo calculan mal.

**En 2026 no hay periodo de gracia.** El argumento de venta correcto no es la multa de $450 a $670 por
CFDI: es la **pérdida de la deducción del flete y del acreditamiento del IVA** (CFF 29-A antepenúltimo
párrafo) más la presunción de contrabando del CFF 103 fr. XXII con pena de 3 a 6 años (CFF 104 fr. IV),
que aplica **aunque la mercancía sea nacional y legítima**.

**Dos banderas independientes:** `necesita_carta_porte` (radio de 30 km + condición de vehículo C2
conforme a NOM-012) y `elegible_rfa_titulo_2` (90% de ingresos, servicio a terceros, régimen fiscal).
No son el mismo hecho.

*SIN VERIFICAR:* no hay metodología oficial para medir el radio (¿geodésica? ¿desde qué punto? ¿cómo se
prueba en revisión?). Es zona gris real. **Y recomendar "este viaje no necesita Carta Porte" hay que
registrarlo como recomendación, con la decisión del cliente encima.**

### 30-31. Mantenimiento preventivo y expediente de siniestro

Ambos reutilizan datos que ya existen (odómetro; fecha, hora, ubicación y fotos del viaje) pero exigen
un tipo de intake nuevo. El mantenimiento correctivo cuesta 3x-55x el preventivo por componente
(*cifras PISTA de un solo proveedor, Smart Fleet; no contrastadas contra IMT ni CANACAR*).

---

## Lo que parece oportunidad y no lo es

| Idea | Por qué se cae |
|---|---|
| **Monitoreo antirrobo de mercancía** | El dolor es enorme (>$7,000M MXN/año estimado por AMESIS) pero exige GPS en tiempo real y detección de jammer: otra categoría de producto, con competidores establecidos. Solo el **expediente posterior** es cercano |
| **Reclutamiento y retención de operadores** | Es RH, no comprobantes. El único pedazo accionable es el registro de jornada (#25) |
| **Facturación al cliente y cobranza** | Es el lado de ingreso, con otro documento y probablemente otro sistema. La respuesta del mercado ya es financiera (factoraje), no operativa |
| **Emitir monedero de combustible propio** | $10,000,000 MXN de capital social pagado **más** $10,000,000 MXN de fianza a favor de la TESOFE (RMF 3.3.1.8). Inviable |
| **Ser PAC propio** | Mismos $10M + $10M, verificación tecnológica y meses de trámite |
| **Ser aseguradora** | 5.1 a 8.5 millones de UDI de capital mínimo (CNSF Anexo 6.1.2) |
| **Vender datos de precio de diésel por zona** | Ya es dato público obligatorio (CRE A/041/2018) y ya lo revende PETROIntelligence. Competir contra un commodity gratuito. El ángulo correcto es el **precio real pagado** por la flota (dato propietario) como *feature* interno de benchmarking, no como producto |
| **ERP contable propio** | Mercado saturado (SIGA, ClickBalance, Advanpro, Logista, LISTMS+). El canal hacia despachos sí; el producto no |
| **"Validamos tu factura contra el SAT en tiempo real"** | El listado L_CNE lo descarga **solo el PAC**, autenticado con su e.firma y descifrado con su CSD. No hay endpoint público. Cualquier contador lo verifica |
| **"Te conseguimos la factura que te negaron"** | La conciliación de factura es voluntaria para ambas partes y "no constituye instancia, ni genera derechos u obligaciones distintas" (RMF 2.7.1.44) |
| **"Te generamos la liquidación fiscal del coordinado"** | El Complemento de Liquidación **nunca se ha publicado**. El Transitorio Segundo de la RFA 2026 sigue remitiendo a la Resolución de 2015 |
| **Benford y análisis de brechas de folios** | Necesitan cientos de registros por grupo. Antes de tener volumen, producen ruido |

---

## Qué falta saber antes de vender cualquiera de estas

1. **Cinco entrevistas con contralores de flota.** Ninguna de las 23 investigaciones habló con un
   comprador real. Es el pendiente que ambas olas señalaron, de forma independiente, como el más urgente.
2. **Qué porcentaje de las flotas objetivo ya usa monedero de combustible.** Cambia el pitch entero.
3. **Cifras del sector en fuente oficial** (Estadística Básica del Autotransporte Federal de la SICT,
   INEGI, CANACAR). Los dos datos que circulan ("95% con menos de 30 camiones" y "97% con menos de 20")
   son **aritméticamente incompatibles** y ninguno viene de fuente oficial. **Retirados del material
   comercial hasta confirmar.**
4. **La canasta básica CANACAR 2026**, antes de citar cualquier porcentaje de combustible sobre el
   costo operativo. El rango encontrado va de 30% a 82% según la metodología, que es demasiado amplio
   para usarse sin nota al pie.
5. **Comportamiento real de la conciliación de factura (ficha 46/CFF).** Declara 6 días de resolución;
   nadie midió cuánto tarda ni con qué tasa de éxito. Levantar 5 o 10 solicitudes reales antes de
   venderlo como feature.
6. **Todas las cifras autodeclaradas de competidores** (96% de recupero y 500+ flotillas de Mendel,
   92% de Fotofacturas, 99% de precisión y 6-8x ROI de Handle, "$7 millones ahorrados" de Zumma) están
   **publicadas**, no **auditadas**. Se citan como evidencia de cómo comunican, jamás como hechos.

**Ventana competitiva:** Handle AI (6 MDD de a16z, fundador ex-Nowports) declaró en prensa el
17-mar-2026 que su siguiente vertical es logística. La ventana para ocupar públicamente el término
"liquidación de viajes" se mide en meses.
