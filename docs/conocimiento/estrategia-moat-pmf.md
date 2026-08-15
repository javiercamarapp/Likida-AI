# Moat, PMF y la máquina — el análisis estratégico de Likida

> Escrito el 14-ago-2026, el día que se declaró el rumbo a mercado. Sintetiza
> cuatro investigaciones del mismo día (consolas de operación SV, sistema
> híbrido de ventas, auditoría de responsabilidades del superadmin, y el
> análisis competitivo de Uvicuo) más la llamada real con Transports de Nuevo
> Laredo (`plaud-nuevo-laredo.md`). Todo lo afirmado del repo está verificado
> contra el código; todo lo de mercado trae fuente en los informes de origen.

---

## 1. El moat — qué es defendible de verdad

**Lo que SÍ es moat (hoy, verificable en demo):**

1. **La profundidad fiscal mexicana.** Validación de CFDI ante el SAT
   (vigencia, 69-B, receptor), deducibilidad clasificada con el artículo
   citado (LISR 28-V, LIF 20-A, RMF), bitácoras de estímulos (50% de peaje
   RMF 9.1.8, IEPS diésel EN LITROS con la honestidad de la cuota DOF),
   Carta Porte 3.1 con el clasificador que nunca adivina, y el corpus
   `normas/` con test que ata cada ficha al código que la usa. **Uvicuo no
   tiene nada de esto** (verificado: su "cumplimiento SAT" es recuperar
   facturas, no validarlas). Handle tampoco compite aquí: su chat es consulta
   estructurada del registro, no criterio fiscal. Este moat es lento de
   copiar porque no es un feature: es criterio legal codificado con pruebas
   (4,200+) y con la regla cultural de que un rótulo falso es un bug.
2. **El registro de dos lados.** Uvicuo es 100% gasto. Handle cubre el costo
   pero el ingreso lo tiene vacío (el hueco ya mapeado). Likida cierra el
   viaje completo: costo + cliente/tarifa/factura emitida/pago/cobranza =
   **margen por viaje**. El que tiene el registro completo tiene la
   conversación del dinero, y de ahí sale el paso fintech.
3. **No exigir cambiar el medio de pago.** Todo el valor de Uvicuo depende de
   que la flota adopte SU tarjeta y SU crédito (renegociar convenio de
   diésel, TAGs, tesorería — con una seed sin razón social publicada en sus
   términos). Likida se instala SOBRE los pagos que ya existen. En flotas
   grandes con convenios a crédito (Nuevo Laredo: "el diésel se gestiona vía
   crédito y se factura automáticamente"), la tarjeta de Uvicuo ni siquiera
   aplica al dolor — el nuestro sí.
4. **El costo de operación de un fundador orquestando IA.** La empresa se
   construyó en semanas-equivalente con agentes; el costo marginal de un
   feature es horas, no sprints. Contra una seed de 16 personas, la
   velocidad ES estructura de costos.
5. **El censo propietario.** 828 empresas contactables con la señal de dolor
   fechada (32–47 contratando HOY el puesto que Likida sustituye), con
   scraper incremental corriendo. Nadie más tiene esta lista con esta señal.

**Lo que NO es moat (no confundirse):** el kanban, el chat, los dashboards,
el simulador — todo eso se clona en semanas y Uvicuo saca versión nueva en
H2-2026. El MRR animado tampoco. El moat vive en el criterio fiscal, el
registro de dos lados y la distribución que se construya ANTES de que Uvicuo
cierre su hueco.

**La amenaza al moat, dicha sin suavizar:** si la nueva versión de Uvicuo
(H2-2026) agrega validación SAT seria, el diferencial se reduce a lado
ingreso + "sin cambiar de tarjeta". La ventana para convertir profundidad
fiscal en clientes firmados es AHORA.

---

## 2. PMF — dónde está y cómo se comprueba

**Evidencia a favor (real):**
- El mercado nombra el dolor con presupuesto: decenas de empresas pagando
  sueldos por "auxiliar/analista de liquidaciones" (censo, señal fechada).
- Dos cuentas calientes entrantes sin marketing: Transports de Nuevo Laredo
  (llamada de 20 min con copropietario que ya identificó 25–30 casos de uso)
  y Grupo GAL (interesado, candidato a primer pago).
- La categoría está validada por terceros con capital: Handle (US) y Uvicuo
  (MX, $4M, Mastercard) — ya nadie tiene que evangelizar que esto es un
  problema.

**Evidencia en contra (igual de real):** 0 clientes de pago, 0 corridas con
datos reales, y el canal del producto (WhatsApp) sigue en número de prueba de
Meta. **PMF no se declara: se cobra.**

**La hipótesis de PMF de Likida, en una frase:** *"la flota mediana/grande
mexicana paga por liquidación automatizada cuando el mismo sistema le
DEMUESTRA en pesos que se paga solo con lo fiscal que recupera."* El métrico
de PMF no es NPS ni usage: es **pesos recuperados certificados / cuota
cobrada ≥ 3×** en los primeros 60 días de cada cliente.

**Cómo se comprueba (los dos pilotos):**
- **Grupo GAL** → el camino estándar: liquidación por WhatsApp + motor
  fiscal. Meta: primer peso cobrado.
- **Nuevo Laredo** → el camino "agentes como servicio" (SIN el pitch de
  efectivo, que no es su dolor): PoC conciliador de peajes + agente de
  comunicación/gastos → SAP B1. Meta: propuesta preliminar de los 2 casos
  antes de que su consultor cierre la puerta.

Dos pitches distintos, un mismo registro debajo. Si NINGUNO de los dos paga
en 90 días, la hipótesis de precio/canal se revisa antes de escalar ventas.

---

## 3. La máquina — qué se automatiza desde el día cero

**Ventas (del informe híbrido — regla de oro: la IA prepara, el humano
aprueba; con 828 leads finitos, cada lead quemado no se repone):**
- Score de los 828 con columnas que ya existen (dolor directo, recencia,
  vacantes simultáneas, sueldo, penalizar agencia) → tiers A/B/C.
- Enriquecimiento por agentes propios: DENUE (SCIAN 484, gratis) → Google
  Maps (teléfonos, <$15 USD) → web de la empresa (agente extrae contacto).
  Total <$50 USD para todo el tier A. Nada de Clay/Apollo todavía.
- Asignación: round-robin con tope de 3 leads activos por vendedor + SLA de
  24–48h con reasignación automática + override por relación ("¿quién conoce
  a esta empresa?"). Ya construido como `asignarPendientes()`.
- El agente arma el DOSSIER (dolor, sueldo publicado, tamaño, guion de 5
  líneas) y el vendedor-amigo LLAMA. En transporte MX el teléfono cierra;
  el correo abre; WhatsApp comercial cuando esté verificado.
- Comisiones: 50% primer mes / 20% recurrente — validado como competitivo
  (mediana del mercado es 20%). Decisiones pendientes de Javier: acotar el
  20% a 24 meses (estándar), pagar sobre efectivo COBRADO (liberar el bounty
  cuando el cliente paga su mes 2), clawback como ajuste (nunca pedir dinero
  de vuelta a un amigo), y el acuerdo de UNA página firmado antes del primer
  lead.
- Correo frío: dominio de envío SEPARADO de likida.ai + SPF/DKIM/DMARC +
  warmup de 2–4 semanas — reloj muerto que conviene arrancar ya.

**Operación (del informe de consolas SV + auditoría — las 7 piezas, en
orden):** (1) bandeja de escalaciones estilo Agent Inbox — todo lo que hoy
muere en logs (config_ilegible, ARCO por vencer, cron caído, mensajes WA
fallidos) en UNA cola con aprobar/editar/rechazar; (2) kill switch por agente
y global; (3) traza unificada corrida→costo→conversación; (4) la métrica
norte operativa: **% de liquidaciones cerradas sin humano** (siempre con el
absoluto al lado); (5) audit trail + impersonación firmada; (6) ⌘K con
acciones; (7) checklist de onboarding por flota con estado real — donde se
rompería el cliente real mañana.

**Cliente (patrón Sierra/Decagon/Fin):** el agente resuelve, escala con
contexto completo, y el "bot que persigue el comprobante" (copiado de
Uvicuo): recordatorio → nota de voz → escalar al jefe. La alerta de silencio
(tenant sin corridas en N días) es el health-score honesto para 1–5 clientes.

**Cobro:** Stripe ya está; dunning/Smart Retries se activan con el primer
suscriptor. No merecen UI antes.

---

## 4. Ser mejores que Uvicuo — el plan de mesa

**El pitch (para vendedores, memorizable):** *"Uvicuo es una tarjeta con un
chat; nosotros somos el contador fiscal de cada viaje. Ellos te piden cambiar
cómo pagas; nosotros no movemos ni un peso de lugar: cada CFDI validado ante
el SAT, cada gasto con su artículo, las bitácoras del 50% de peaje y el IEPS
del diésel — dinero que ellos ni mencionan — y al cerrar el viaje también te
lo cobramos del lado del cliente. Ellos te ahorran comisiones; nosotros te
recuperamos impuestos. Y no tuviste que cambiar de tarjeta para averiguarlo."*

**Copiarles (por esfuerzo/impacto):** calculadora de recuperación fiscal en
la landing (con lo que ellos NO pueden calcular: IEPS en litros, 50% peaje,
69-B), un post-caso con números del motor sobre escenario MODELADO y
declarado como tal, persecución activa del comprobante, detección
"gasto fuera de ruta" (el registro ya tiene origen-destino), y su playbook
gremial completo (CANACAR socio cooperador, T21, Alianza Flotillera, ANPACT).

**El trámite que este informe vuelve urgente:** el número de WhatsApp
verificado. Es la landing de ellos ("CTA directo a un vendedor por WhatsApp"),
es el canal del chofer, y es el bloqueante número uno de TODO lo demás.

---

## 5. El paso fintech — desde el registro, no desde la tarjeta

En la cancha de tarjeta/crédito Uvicuo ya juega con Mastercard, $4M y un CEO
ex-Revolut: **ahí no se entra de frente.** Se entra desde lo que ellos no
tienen — el registro fiscal-operativo del viaje completo:

1. **Hoy (rieles, no licencias):** el registro ya sabe cuánto se le debe a
   cada chofer (liquidación cuadrada y firmada) y cuánto debe cada cliente
   (factura emitida + pago). Esos dos números son los rieles.
2. **Paso 1 — dispersión de liquidaciones:** pagar al chofer lo que la
   liquidación certificó (SPEI vía un BaaS mexicano regulado; Likida no toca
   la licencia). El gancho: "el chofer cobra el mismo día que cierra el viaje".
3. **Paso 2 — adelanto sobre liquidación:** factoraje de corto plazo sobre
   un documento que NADIE más puede suscribir mejor, porque el motor conoce
   el riesgo real del viaje (comprobado, validado ante SAT, historial del
   operador). El moat fiscal se vuelve moat de underwriting.
4. **Paso 3 — la tarjeta,** si acaso, al final — cuando el volumen de los
   pasos 1–2 la justifique y con socio regulado.

Regla de todo el tramo: **ningún paso fintech antes del primer cliente SaaS
pagando.** El fintech multiplica un negocio que existe; no lo sustituye.

---

## 6. La cuenta hacia $10M (y por qué el software "se paga solo")

- Ancla de precio del mercado: Uvicuo cobra ~$150–200 MXN/vehículo/mes y
  presume "6–7 pesos de valor fiscal por peso invertido". Likida puede
  anclar por valor recuperado, no por asiento — el PDF de cada liquidación
  ya trae los pesos que el motor rescató (deducciones salvadas, estímulos
  documentados). **La factura de Likida se justifica con el reporte de
  Likida.** Ésa es la definición operativa de "se paga solo".
- Un cliente de 15,000 viajes/mes a precio por viaje cuadrado (o su
  equivalente por unidad) es el tipo de cuenta que mueve el MRR de cero a
  seis cifras MXN de un plumazo — por eso la ola de escala (índices, colas,
  costo de OCR proyectado) va antes de la firma, no después.
- El camino: 2 pilotos (GAL + Nuevo Laredo) → 3–5 clientes del tier A del
  censo por vendedores-amigos → el playbook gremial → y el paso fintech
  sobre la base instalada. $10M de valuación no se argumenta con features:
  se argumenta con el múltiplo de una máquina que convierte censo en
  clientes y clientes en pesos fiscales certificados.

---

## Las 3 decisiones que solo Javier puede tomar esta semana

1. **Iniciar la verificación de Meta / número mexicano** (bloquea producto,
   ventas y el pitch contra Uvicuo — todo).
2. **Precio** (ancla sugerida por el mercado: por unidad/mes con piso, o por
   viaje liquidado; Uvicuo da el rango de referencia).
3. **El acuerdo de comisión de una página** (50% / 20%×24 meses / sobre
   cobrado / clawback como ajuste) firmado con los amigos ANTES del primer
   lead asignado.
