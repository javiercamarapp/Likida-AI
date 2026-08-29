# Preguntas al fiscalista — documento vivo

**Qué es.** La lista única de todo lo que Likida **no puede resolver sola** porque
depende de un criterio fiscal, laboral o normativo que un profesional con cédula
tiene que firmar. Cada renglón dice qué se pregunta, **por qué importa en dinero
o en riesgo**, qué bloquea hoy, y dónde vive el código o el documento que la
declaró.

**Por qué existe.** Estas dudas estaban repartidas en cinco documentos distintos
(`00-ROADMAP.md`, `00-RESUMEN-EJECUTIVO.md`, `04-iva-ieps-estimulos.md`,
`03-isr-facilidades.md`, `01-cfdi-cff.md`) y en comentarios de código. Repartidas
no se pueden llevar a una reunión, y una duda que nadie recuerda se convierte en
una cifra que alguien publicó sin querer.

**Cómo se mantiene al día.** Este archivo es la **única fuente**. El PDF que vive
en `~/Desktop/Documentos Likida/fiscalista preguntas/` se **genera** desde aquí:
nunca se edita por separado, porque dos copias del mismo dato acaban divergiendo
y nadie sabe cuál creer.

> **Regla para todo fork y toda auditoría:** si tu trabajo topa con una decisión
> que depende de un criterio fiscal, laboral o normativo no resuelto — **añade el
> renglón aquí en el mismo PR**. Y si tu trabajo *cierra* una de estas preguntas,
> muévela a «Resueltas» con la fecha, quién la firmó y qué cambió en el código.
> No la borres: saber que algo estuvo abierto y cómo se cerró es parte del
> expediente.

---

## Cómo leer la prioridad

| Marca | Significa |
|---|---|
| **DINERO** | Equivocarse cambia una cifra que el cliente ve o declara |
| **VENDER** | Bloquea publicar algo en material comercial o en una propuesta |
| **CÓDIGO** | Bloquea implementar o calibrar una pieza concreta |
| **LEGAL** | Riesgo regulatorio o de datos personales |

---

## A · Las que cuestan dinero real

### A1 · ¿Se acredita la cuota DISMINUIDA o la ÍNTEGRA del IEPS al diésel?
**DINERO · la más cara de todas.**

El estímulo de la LIF 2026 art. 20 se calcula sobre una cuota por litro. Hay dos
lecturas del texto y **entre ellas hay un factor de 3.5×**.

- La conclusión actual (cuota **disminuida**) se sostiene en el texto de la LIF
  («con los ajustes que, en su caso, correspondan… vigente en el momento de la
  adquisición») y en que el acuerdo semanal de la SHCP se titula literalmente
  «cuotas **disminuidas** del IEPS».
- **Pero no se localizó criterio del SAT ni regla de la RMF que lo diga con esas
  palabras.** Las afirmaciones categóricas que circulan vienen de blogs de
  despachos, no de fuente primaria.
- Si el criterio fuera el contrario, Likida estaría **subestimando el estímulo
  hasta 3.5 veces**.

**Qué bloquea hoy:** publicar **cualquier** cifra de estímulo de diésel en pesos.
Por eso el producto entrega **litros** y el contador multiplica a mano —
decisión D2 del roadmap. Es la decisión correcta mientras esto no se firme, pero
es justo el trabajo manual que Likida existe para quitar.

**Dónde vive:** `docs/conocimiento/04-iva-ieps-estimulos.md:469` ·
`docs/conocimiento/00-RESUMEN-EJECUTIVO.md:245` ·
`src/lib/likida/cuadre/cuota_diesel.ts:20` (el módulo está construido y
deliberadamente sin cablear, esperando esta firma).

**Cómo se cierra:** un fiscalista con cédula, una llamada.

---

### A2 · El tope de $1,000,000 de la regla 2.2: ¿por INTEGRANTE o por COORDINADO?
**DINERO · cambia el ahorro mostrado en un orden de magnitud.**

La regla habla de «los contribuyentes», y su fracción III dice que los
coordinados «deberán efectuar el entero de dicho impuesto **por cuenta de los
mismos**», lo que sugiere que el cálculo —y por tanto el tope— es **por
integrante**. Es la lectura razonable y la que usa el sector, **pero ningún texto
lo dice expresamente**.

**Qué bloquea:** programar el tope. Mal programado, la cifra de ahorro que se le
enseña al cliente cambia en un orden de magnitud.

**Dónde vive:** `docs/conocimiento/03-isr-facilidades.md:717`

---

### A3 · ¿El 8% de gasto ciego reduce la base de PTU?
**DINERO · decenas de miles de pesos por flota.**

No hay criterio ni regla en ningún sentido.

**Dónde vive:** `docs/conocimiento/00-RESUMEN-EJECUTIVO.md` §8

---

### A4 · Periodicidad del 15% de la regla 2.9 (RFA): ¿mensual, acumulado o anual?
**DINERO · CÓDIGO · calibra el contador y el semáforo.**

La regla no lo dice. Lo consistente con el Transitorio Primero es **acumulado del
ejercicio**, pero un auditor podría exigirlo mensual — y el contador del producto
tiene que decidir cuál cuenta.

**Dónde vive:** `docs/conocimiento/00-ROADMAP.md` (tabla, #5)

---

### A5 · ¿Qué entra en «ingresos propios de su actividad» para el cálculo del 8%?
**DINERO.** Ni la RFA ni la LISR lo definen para esa regla.

---

### A6 · ¿Cómo se mide en el tiempo el 90% de exclusividad del art. 72 LISR?
**DINERO · CÓDIGO.** La ley no lo precisa, y de ese porcentaje depende que la
flota pueda tributar como coordinado.

---

## B · Las que bloquean vender sin quedar mal

### B1 · Citas normativas muertas en el material comercial
**VENDER · destruye credibilidad en una frase.**

Se detectaron citas que ya no corresponden: «RMF 2.7.1.24» para factura global
(hoy es la **2.7.1.21**; la 2.7.1.24 en 2026 trata devolución de IVA a turistas),
«LIF artículo 16» (hoy es el **artículo 20**), «$113.90 de viáticos de
tripulación», «10% de deducción ciega» (es **8% con tope de $1M**), y cifras de
multa tomadas de blogs.

> Un error de cita frente al fiscalista de un contralor destruye la credibilidad
> de todo lo demás.

**Dónde vive:** `docs/conocimiento/00-RESUMEN-EJECUTIVO.md:174`

---

### B2 · 19 de las 32 tasas de ISN sin verificar en fuente primaria
**VENDER.** Solo 13 confirmadas leyendo ley o decreto. Hay **conflictos abiertos**
en Durango (2% vs 3%), Morelos (2.5% vs 3%), Tabasco (2.5%–4%) y Sonora (el
portal dice 3%+1%, la ley descargable dice 2%). Varias listas que circulan traen
mal Jalisco, Coahuila y Nuevo León.

**Regla vigente:** no publicar la tabla de 32 estados como verificada.

**Nota:** esto **no necesita fiscalista** — se cierra leyendo periódicos oficiales
estatales. Está aquí porque bloquea lo mismo.

---

### B3 · ¿Los «19,000 UMA» del seguro de carga especializada son UMA diaria, mensual o anual?
**VENDER · factor de ~30 entre lecturas.** Se usó la **diaria** (~$2.23 MDP); la
mensual multiplicaría por unos 30. Confirmar con un Centro SICT antes de usar la
cifra en cualquier material.

---

## C · Las que bloquean código concreto

### C1 · ¿Un CFDI con complemento ECC (monedero) debe llevar TAMBIÉN HidroYPetro?
**CÓDIGO · cambia el requisito de todas las flotas con tarjeta.**

La interpretación de que **no** la sostienen varios PAC citando preguntas
frecuentes del SAT que **no se leyeron en fuente primaria**.

---

### C2 · La forma de pago 99 en los estados de cuenta de combustible
**CÓDIGO.** Análisis escrito en `docs/asistencia/ECC-FORMAPAGO-99.md`. **Se cierra
con un XML real** de alguno de los 13 emisores de monedero — no con más lectura.

---

### C3 · ¿El nuevo plazo de cancelación aplica a CFDI expedidos en 2025?
**CÓDIGO.** El Transitorio Segundo del Decreto (DOF 07-11-2025) habla de
«procedimientos iniciados», no de comprobantes. La lectura literal del 29-A
vigente sugiere que el plazo se calcula respecto del ejercicio en que se expidió,
**pero no se localizó regla ni criterio que lo aclare**.

**Dónde vive:** `docs/conocimiento/01-cfdi-cff.md:667`

---

### C4 · Metodología oficial del radio de 30 km (RMF 2.7.7.2.8)
**CÓDIGO · zona gris real.** No define si la medición es geodésica, desde qué
punto se toma, ni cómo se prueba en una revisión. Afecta al clasificador de Carta
Porte.

---

### C5 · ¿El 8% de la RFA satisface el requisito estatal de «viáticos debidamente comprobados»?
**LEGAL.** No hay criterio publicado en ningún sentido. **Presentarlo siempre como
hipótesis de riesgo razonada, nunca como fundamento.**

---

### C6 · La faja de 50 km aplicada a un operador de largo recorrido
**LEGAL.** El RLISR 57 define «establecimiento» como donde la persona presta
normalmente sus servicios, y para un operador de largo recorrido eso es
discutible. Sin criterio del SAT ni tesis.

---

## D · Laboral — esto lo contesta un abogado, no un fiscalista

### D1 · ¿Cómo se miden «un mes de salario» y «el excedente del mínimo» (LFT 110) con pago por viaje o por kilómetro?
**DINERO · LEGAL.** De esto dependen los topes de descuento que el producto
aplica al operador. El código ya **impide** descontar lo que la LFT 110, 111 y
263 prohíben, y esa advertencia ya llega a la pantalla donde el contralor
decide — pero **cómo se calcula el tope con pago variable no está resuelto**.

**Dónde vive:** `docs/conocimiento/00-ROADMAP.md` (tabla, #9)

---

## E · Barridos normativos pendientes — no requieren fiscalista

Están aquí porque bloquean lo mismo, pero se cierran con lectura, no con firma.

| # | Qué falta | Cómo se cierra |
|---|---|---|
| E1 | Anexos 21 y 22 de la 1ª Modificación (DOF 17-jul-2026) | `curl` + `pdftotext`, ya probado |
| E2 | Segunda Resolución de Modificaciones a la RMF 2026 y versiones anticipadas de julio | Minisitio de normatividad del SAT |
| E3 | Fecha de publicación del Complemento HidroYPetro en el Portal del SAT | **Pedírsela al PAC del primer cliente** |
| E4 | Matriz de errores del complemento HidroYPetro (códigos CCHYP1xx) y de Carta Porte 3.1 | Conseguir los archivos e instalar el parser de XLS |
| E5 | Catálogos oficiales del Anexo 20 y del CCP 3.1, comparados contra la versión anterior | Validar contra un catálogo viejo genera falsos rechazos en producción |
| E6 | Formato exacto de la cadena `expresionImpresa` (Anexo 20, rubro I.D) | Bloquea el validador de CFDI |
| E7 | ¿El paquete económico 2026 tocó la LISR y la LIVA? | Los PDF de Diputados declaran reformas de 2024 y 2021 |
| E8 | Calendario 2026 de verificación físico-mecánica por dígito de placa | En 2025 se prorrogó tres veces; **asumir continuidad sería inventar** |
| E9 | Criterios de la Secretaría Anticorrupción para el sector privado | **La laguna más importante de datos personales**; cerrarla antes del aviso definitivo |
| E10 | Vigencia formal del Reglamento de la LFPDPPP de 2011 bajo la ley de 2025 | Que «subsiste en lo que no contradiga» es razonamiento propio, no certeza |

---

## F · Resueltas

_(Vacío. Cuando una pregunta se cierre, se mueve aquí con la fecha, quién la
firmó, y qué cambió en el código. No se borra.)_

---

## Lo que conviene llevar a la primera reunión

Si solo hay tiempo para unas cuantas, este es el orden por lo que cuesta
equivocarse:

1. **A1** — el factor 3.5× del estímulo de diésel. Es la única que bloquea una
   funcionalidad ya construida y esperando.
2. **A2** — el tope de $1,000,000: cambia el ahorro mostrado en un orden de
   magnitud.
3. **A3** — el 8% ciego y la PTU: decenas de miles de pesos por flota.
4. **D1** — los topes de descuento con pago variable (aquí hace falta abogado
   laboral, no fiscalista).
5. **B1** — las citas muertas, antes de que las vea el fiscalista de un cliente.

---

**Última actualización:** 29 de agosto de 2026
**Fuentes consolidadas:** `00-ROADMAP.md` · `00-RESUMEN-EJECUTIVO.md` ·
`04-iva-ieps-estimulos.md` · `03-isr-facilidades.md` · `01-cfdi-cff.md` ·
`06-estatal.md` · `10-contradicciones.md` · `DIESEL-MODALIDADES.md` ·
`ECC-FORMAPAGO-99.md` · `cuota_diesel.ts`
