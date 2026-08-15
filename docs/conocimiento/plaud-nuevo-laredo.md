# La llamada con Transports de Nuevo Laredo — destilado de la sesión Plaud

> Fuente: transcripción Plaud de la consulta del 6-ago-2026, 20m06s, leída
> completa el 14-ago-2026 (web.plaud.ai, share público de Javier). Cliente:
> **Transports de Nuevo Laredo** (familia Cárdenas; habló José Alfredo
> Cárdenas, copropietario). Empresa de transporte **grande**, sede en
> **Guadalajara**.

## Lo que tienen (y por qué importa)

- **TMS propio + SAP Business One + Tableau.** No quieren un ERP nuevo —
  quieren que lo que ya tienen se alimente solo.
- Están **rediseñando su sistema principal con un consultor externo**, proceso
  de **hasta año y medio**. Ésa es la ventana de Likida: soluciones
  intermedias de agentes que den valor HOY sin esperar la reescritura.
- Identificaron internamente **25–30 casos de uso** rápidos para agentes de IA.
- José Alfredo entiende el potencial — no hay que evangelizar, hay que
  proponer casos concretos.

## El dolor, en sus palabras

- **Captura manual de datos y papeleo** — el central. El equipo de
  liquidaciones procesa a mano documentos en papel de los operadores.
- **Gastos de operadores**: talachas/reparaciones autorizadas en ruta llegan
  con factura en papel; se capturan a mano junto con datos como el
  **rendimiento de combustible de la computadora del tractor**.
- **Comunicación con el conductor**: llegadas y carga/descarga no están
  automatizadas — interacción manual constante.
- **El "martirio"**: el proveedor de peajes manda factura y desglose de
  cruces **cada diez días**, y conciliarlo contra sus **registros de GPS
  internos** es tedioso y propenso a error.

## ⚠️ La corrección al pitch estándar de Likida

**"A diferencia de otros transportistas, el manejo de efectivo por operadores
NO es su principal problema. El diésel se gestiona vía crédito y se factura
automáticamente."**

Con este cliente, el guion del demo de liquidación en efectivo NO es la
entrada. La entrada son los dos casos que ellos mismos pidieron.

## Los dos casos clave (para la presentación preliminar)

1. **Agente de comunicación y gestión de gastos para conductores** — asignar
   tareas, recibir actualizaciones de estado ("ya llegué", "descargando"),
   gestionar el envío de gastos autorizados con fotos; la IA extrae, valida
   contra reglas y manda al flujo de aprobación en SAP B1.
2. **Agente de conciliación de facturas (peajes y proveedores) integrado con
   SAP Business One** — toma el desglose del proveedor, OCR si hace falta,
   cruza contra GPS del TMS, marca discrepancias solo.

Más el posicionamiento: **"agentes como servicio"** — capa modular
complementaria a su proyecto de reescritura, micro-agentes predefinidos para
sus 25–30 casos.

## Pendientes comerciales de esa llamada

- [ ] Esperar el contacto de José Alfredo tras su reunión con el consultor
      (paso pasivo — el riesgo de perderlo contra el consultor sigue vivo).
- [ ] Preparar la **presentación preliminar** de los 2 casos clave.
- [ ] Investigar integraciones específicas con SAP Business One para una
      propuesta técnica sólida (el escalón honesto de hoy: export CSV/DTW;
      Service Layer solo con credenciales de su instancia).

## Qué construyó Likida a raíz de esto (14-ago-2026)

- PoC del conciliador de peajes (desgloses del proveedor → tres cubetas →
  bitácora RMF 9.1.8). El cruce contra GPS del TMS queda como v2: exige
  acceso a SU TMS.
- WhatsApp bidireccional: hitos del chofer, talacha con foto y autorización
  del jefe, jefe de flota creando/asignando viajes y pidiendo informes.
- Facturas de proveedor → bandeja de aprobación → export a SAP B1/CONTPAQi +
  diagrama de flujo para la propuesta (`diagrama-flujo-sap-b1.md`).
