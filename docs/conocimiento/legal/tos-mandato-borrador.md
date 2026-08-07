# DRAFT — Términos y Condiciones (corrección del punto de facturación + cláusula de mandato)

**Estado: BORRADOR para revisión del abogado.** NO se sube a `/terminos` hasta
el visto bueno legal. Este documento corrige la contradicción que las rondas
10-16 de auditoría señalaron: el ToS dice "Likida no timbra facturas" y el
software SÍ tiene dos circuitos que timbran (la mensualidad del SaaS y el
autofacturado de peajes/diésel), gated por `FACTURACION_MODO`. La cláusula de
mandato es lo que autoriza a Likida a actuar en nombre del cliente.

---

## 1. Qué cambia (el mínimo para dejar de mentir)

**Texto ACTUAL (contradice al producto):**
> "Likida no es un despacho contable, ni un PAC, ni un asesor fiscal. **No
> timbra facturas**, no presenta declaraciones, no dictamina estados
> financieros y no sustituye al contador de la empresa."

**Texto PROPUESTO:**
> "Likida no es un despacho contable, ni un PAC, ni un asesor fiscal. **No
> presenta declaraciones ni dictamina estados financieros y no sustituye al
> contador de la empresa.** Lo que entrega es un documento de trabajo, y así
> hay que tratarlo. **Cuando el cliente activa la facturación en el panel,
> Likida emite CFDI en su nombre y con su RFC, únicamente sobre los
> comprobantes que el propio cliente cargó y únicamente con el mandato
> expreso del artículo siguiente.**"

## 2. La cláusula de mandato (nueva)

> **Mandato para facturación.** El cliente otorga a Likida un mandato expreso,
> revocable en cualquier momento, para: (a) presentar su RFC y sus datos
> fiscales (razón social, régimen, código postal, uso de CFDI) ante los
> portales de facturación de los emisores que el cliente elija (incluidos,
> sin limitar, CAPUFE y los monederos de combustible); y (b) solicitar y
> obtener, en su nombre, los CFDI correspondientes a los comprobantes que el
> propio cliente cargó en la plataforma. Este mandato se limita a la emisión
> de CFDI de los gastos cargados: no faculta a Likida a representar al cliente
> ante el SAT, a firmar su declaración ni a tomar decisiones fiscales. El
> cliente declara que los datos fiscales registrados son exactos y que el RFC
> le pertenece. Likida no es responsable de la validez material de los
> comprobantes subyacentes, que son responsabilidad del emisor y del propio
> cliente.

## 3. Notas para el abogado

- **`FACTURACION_MODO`**: la emisión real está apagada por defecto (modo
  'ensayo'); la cláusula cubre el momento en que se encienda para un cliente.
- **Encargado vs mandatario**: el cliente es el RESPONSABLE del tratamiento de
  datos personales (LFPDPPP); Likida es encargado. El mandato de facturación
  es un poder de representación limitado, distinto — conviene confirmar si
  requiere algo más que el contrato (p. ej., una carta poder para portales
  específicos).
- **CAPUFE/portales**: algunos portales requieren alta previa del RFC con el
  proveedor; la cláusula asume que el cliente ya está dado de alta.
- **Responsabilidad del RFC**: si el cliente usa un RFC ajeno (el caso del
  demo: un RFC de tercero con permiso), la cláusula debe limitar la
  responsabilidad de Likida por el uso de ese RFC a la instrucción escrita del
  cliente.

## 4. Otros puntos del ToS que las auditorías dejaron pendientes

- **ARCO**: el aviso ya registra las solicitudes y la flota las responde; el
  ToS debe referir el mecanismo y el plazo (LFPDPPP art. 32: 15 días hábiles,
  la promesa del aviso es 20).
- **Retención**: CFF art. 30 (conservar comprobantes 5 años) — el ToS debe
  decir cuánto conserva Likida y cómo se borran los datos al terminar.
- **Versión del documento**: el ToS no tiene versión congelada ni registro de
  qué versión aceptó cada flota — pendiente de decisión de producto/legal.
