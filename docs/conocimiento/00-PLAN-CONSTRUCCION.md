# El Handle de transportes — plan de construcción por fases

**Fecha:** 14-ago-2026 · **Estado del repo al escribirlo:** commit `2ac16a0`

Este es el plan maestro que pediste: la construcción completa de Likida como
"el Handle de transportes". Sale de cruzar cinco insumos, todos leídos completos
antes de escribir una sola fase:

1. **El video de Handle** (8:22, visto cuadro a cuadro y transcrito) —
   destilado en `handle-el-mapa-completo-para-likida.md`.
2. **El código de Likida** — inventario total de motores vs pantallas
   (resumen en §2; el hallazgo central: hay MÁS motor que pantalla).
3. **El conocimiento de negocio** — los 23 docs de `docs/conocimiento/` +
   el censo de 5,022 vacantes en `~/javiercamarapp/censo-liquidacion`.
4. **La reunión con Transportes Innovativos** (transcripción Plaud, 3 PDFs) —
   los 3 agentes nuevos que el prospecto pidió con sus palabras.
5. **La imagen de referencia del mapa** (card "Viaje en curso
   Monterrey → Guadalajara") — la petición del mapa de México en vivo.

---

## 1. La tesis en un párrafo

Handle tiene dos bloques (el **Sistema de Registro** — la fuente de verdad
navegable — y los **Agentes** que trabajan sobre él) montados en un **chasis**
(conectores con salud, intake por correo, identidad por agente, seguridad como
página de venta). Likida ya construyó lo más difícil de clonar: el motor
conversacional por WhatsApp y el motor fiscal determinístico que Handle no
tiene ni necesita en seguros. Lo que falta es, en su mayoría, **pantalla sobre
motores que ya existen** — y tres agentes nuevos que un prospecto real acaba de
pedir en voz alta. La frase de la reunión que justifica todo el plan:

> "La verdad que este tipo de agentes para transportistas les va a hacer mucho
> dinero… hay una cantidad de procesos manuales en nuestra industria
> terribles." — José Alfredo, Transportes Innovativos

## 2. Lo que dijo el cliente (Transportes Innovativos, reunión del 12-ago)

Flota grande de GDL (750 camiones según lo que te dijeron en la reunión — el
número no aparece en los PDFs, así que va como dato tuyo, no citable), familia
Cárdenas, TMS propio en reescritura (1–1.5 años), SAP Business One, Tableau.
**El censo los tiene contratando el dolor**: su propia vacante de "Analista de
Liquidaciones" pide "procurar que los gastos de viaje no excedan los anticipos
otorgados… manejo y control de sistema SAP, Excel avanzado".

Los **tres agentes que pidieron**, en sus palabras:

| # | Agente | El dolor textual | Fase |
|---|--------|------------------|------|
| 1 | **Comunicación bidireccional con conductores** | Asignar tareas, recibir "ya llegué / estoy descargando", gastos autorizados con foto desde carretera ("se me ponchó una llanta"), y la carta porte sellada que hoy se digitaliza a mano al regreso | F4 |
| 2 | **Conciliación de peajes** | "Un martirio": el proveedor de peaje manda desglose + factura **cada 10 días** de todos los cruces, y alguien lo cruza a mano contra el GPS | F5 |
| 3 | **Facturas de proveedores → ERP** | Reciben facturas (talleres, refacciones, diésel) y las **capturan a mano en SAP Business One**; quieren lectura Y escritura | F6 |

Tu posicionamiento quedó grabado y es la línea comercial del plan: *"somos un
complemento al ERP, no un nuevo ERP — unimos los sistemas y ponemos una capa de
agentes encima; lo que mandes por WhatsApp va metiéndose a los sistemas."*
Contra su reescritura de TMS (1–1.5 años) el pitch es: la capa de agentes
funciona HOY encima de lo que tienen, y sobrevive a la migración.

## 3. El inventario: cuánto ya está construido

Del barrido completo del código (14-ago-2026), lo que ya existe **con** página:
Agente de Liquidación, Agente de Facturas, Despacho, Chat con historial y
pensamiento en vivo, detalle de liquidación, combustible-casetas, ARCO,
políticas, suscripción, y las ~29 páginas de `/admin`.

Lo que ya existe como **motor sin pantalla** (el orden es el del plan):

| Motor | Dónde | Lo usa la fase |
|-------|-------|----------------|
| Agente de Cobranza completo (config, tiers, ventana, cola honesta, bitácora, claim anti-doble-envío) | `lib/likida/agentes/cobranza.ts` + mig. 0089 | **F1** |
| Detalle por operador | `analytics.ts` `getOperadoresDetalle()` | F2 |
| Huérfanos (bandeja de oficina) | `repo.ts` `getHuerfanos()/resolverHuerfanos()` | F2 |
| Escalaciones (corre a ciegas por cron) | `escalar_viaje.ts` | F2 |
| Incidencias + POD + Unidades/mantenimiento | `operacion.ts` (tablas 0047, vacías) | F2/F4 |
| Despacho por WhatsApp — **motor muerto, 0 llamadores** | `crear_viaje_wa.ts` | F4 |
| Conciliación de consolidados (el JOIN diésel/TAG) | `intake/consolidado.ts` | F5 |
| Lector universal de archivos (PDF/Excel/CSV/XML) | `intake/archivo.ts` | F5/F6 |
| OCR + extracción de comprobantes | `intake/ocr.ts` | F6 |
| Cartera, rentabilidad, cobranza a clientes, cotizaciones, rastreo | `comercial.ts` (tablas 0048-0051, vacías) | F3/F7 |
| 37 portales + 60 comercios como catálogo | `facturacion/adaptadores/registro.ts`, `comercios.ts` | F7 |
| Fiscal suelto: retenciones, corte combustible/casetas, deducible≠pagadero, avance del ejercicio | `fiscal.ts`, `laboral/pagadero.ts`, `periodo/aviso.ts` | F7 |

**Código muerto confirmado para borrar en F1:** `recordatorio_comprobacion.ts`
(supersedido por el Agente de Cobranza, 0 llamadores).

## 4. La anatomía común de agente (el estándar de construcción)

Toda página de agente de las fases F1, F4, F5 y F6 se construye con la anatomía
que Handle repite en sus 8 agentes — ya probada aquí en Liquidación y Facturas:

1. **KPIs arriba** — medidos, nunca inventados; guiones donde no hay dato.
2. **Cola honesta** — qué va a hacer, qué NO puede hacer y por qué
   ("sin teléfono", "excluido por reglas"), con el porqué en pantalla.
3. **Bitácora de ejecuciones** — cada corrida, qué mandó, qué falló.
4. **Configuración = estrategia** — instrucciones en lenguaje del cliente,
   tiers, horario/ventana hábil, canales, firma/identidad.
5. **Ejecutar ahora** + **Pruebas** (modo ensayo sin mandar nada real).
6. **El agente monitorea y el humano decide** — por LFPDPPP art. 26-II el copy
   nunca dice "el sistema aprueba/rechaza"; dice "prepara y marca; tú decides".

---

## FASE 1 — La página del Agente de Cobranza (el motor ya está)

**Objetivo:** el tercer agente visible. Es la prioridad 1 del blueprint de
Handle y la fase más barata del plan: el motor completo quedó en `2ac16a0`
(mig. 0089 aplicada y verificada, 17 pruebas puras verdes) y solo falta pantalla.

**Ya existe:** `colaCobranza()` (cola honesta con `sinTelefono` y `vigilados`),
`bitacoraCobranza()`, `leer/guardarConfigCobranza()` (tiers, ventana, días,
instrucciones ≤300, firma ≤80), `ejecutarCobranza()` con `ignorarVentana` para
"Ejecutar ahora", y el sello 0087 que impide re-spamear al estrenar tiers.

**Falta:**
- `dashboard/agentes/cobranza/{page,vista}.tsx` con la anatomía §4 completa.
- Server actions: guardar config (validación en palabras de pantalla, ya la da
  `validarConfigCobranza`), Ejecutar ahora (re-verificando sesión/rol adentro),
  y pausar/activar.
- Modo Pruebas: correr `colaCobranza` y `armarMensajeCobranza` SIN mandar —
  enseñar el mensaje exacto que saldría, a quién y cuándo.
- Sidebar: entrada en AGENTES (se revirtió a propósito para no dejar link
  roto) + visibilidad por rol + prueba de visibilidad.
- Borrar `recordatorio_comprobacion.ts` y su test.

**Hecho cuando:** la página se ve en claro/oscuro con datos reales del tenant
de ensayo, los botones operan de verdad, y la suite pasa.

## FASE 2 — El Sistema de Registro + Inicio con alertas

**Objetivo:** el bloque 1 de Handle: la fuente de verdad **navegable**. Hoy los
datos existen pero solo se ven por liquidación; Handle enseña que cada entidad
(póliza→viaje, asegurado→operador) tiene su página y TODO se cruza con links.

**Entregables:**
- **Viajes** — lista filtrable (estatus, operador, fechas) → detalle ya
  existente (`/dashboard/[id]`). Registro, no acción: las acciones viven en
  Despacho.
- **Operadores** — sobre `getOperadoresDetalle()`: viajes, gastos, diferencias,
  teléfono, y sus vigencias cuando existan (licencia/apto médico — el patrón
  "vigencias que anclan" de Handle; campos nuevos, honestos: sin dato, guion).
- **Bandeja de huérfanos** — sobre `getHuerfanos()/resolverHuerfanos()`: los
  comprobantes en el limbo, con adjuntar-a-viaje desde la oficina.
- **Escalaciones visibles** — lo que `escalar_viaje.ts` hizo a ciegas, en el
  Inicio y en el detalle del viaje.
- **Inicio con alertas accionables** — el patrón Handle de "lo que requiere a
  un humano hoy": tickets por vencer (ya está), viajes escalados, huérfanos,
  duplicados detectados. Cada alerta lleva a SU pantalla.

**Dependencias:** ninguna. **Hecho cuando:** de cualquier cifra del panel se
puede llegar clicando hasta el comprobante que la explica.

## FASE 3 — El mapa de México en vivo (la petición del 12-ago)

**Objetivo:** la página "Operación en vivo": un mapa de México a pantalla
completa, interactivo y animado, nivel premium tipo Handle, con los viajes en
curso como la card de referencia (Monterrey → Guadalajara, línea de ruta,
camión, distancia).

**La verdad de los datos (no se negocia):** `posicion` y `geocerca` están
vacías — no hay GPS todavía. Un mapa que finja rastreo rompe la regla de nunca
inventar. Por eso son dos versiones **declaradas**:

- **v1 — Rutas en curso (sin GPS, honesto):** geocodificar origen/destino de
  los viajes abiertos contra una **tabla estática de ciudades mexicanas en el
  repo** (sin API externa, sin llave, determinístico). Mapa SVG/canvas propio
  de México, tema claro/oscuro con los tokens del design system, arcos
  animados origen→destino, card por viaje con folio, operador, días en ruta
  (medidos) y gasto observado (medido). La línea se rotula "trayecto
  ilustrativo" — NUNCA "posición actual" ni ETA, porque no hay dato que los
  sostenga. Ciudad no reconocida → el viaje se lista aparte ("sin ubicar en el
  mapa"), no se omite en silencio.
- **v2 — GPS real:** cuando un cliente conecte credenciales de rastreo
  (`rastreo_credencial` + `getEstadoRastreo()` ya existen), la misma página
  pinta posiciones reales y ahí SÍ aparecen "última posición" y ETA. La
  conexión de credenciales es un conector con salud (F7).

**Dependencias:** F2 ayuda (links viaje↔mapa) pero no bloquea. **Hecho
cuando:** el mapa se ve premium en claro y oscuro **mirándolo** en el
navegador, anima sin romper `prefers-reduced-motion`, y con cero viajes
muestra un estado vacío digno, no un mapa muerto.

## FASE 4 — Agente de Conductores (Plaud #1)

**Objetivo:** la comunicación bidireccional completa con el operador — el
agente que Transportes Innovativos describió de punta a punta y que convierte
a Likida de "liquidación al final del viaje" en "compañero de todo el viaje".

**Ya existe:** el canal entero (webhook, idempotencia, ráfagas, huérfanos,
consultas del chofer sin LLM, botones), `crear_viaje_wa.ts` **completo y
muerto** (el jefe despacha por WhatsApp: "nuevo viaje para Juan, Puebla a
Monterrey, anticipo 8000"), `pod` y `incidencia` con motores sin UI.

**Entregables:**
- **Revivir `crear_viaje_wa.ts`**: conectarlo al processor para el rol
  encargado/flota_admin. Confirmación antes de crear (ya trae
  `resumenParaConfirmar`).
- **Hitos de viaje por WhatsApp**: "ya llegué", "descargando", "de regreso" —
  botones/frases que sellan timestamps en el viaje (campos nuevos, medidos).
  Alimentan el mapa (F3) y los tiempos de espera (dolor #3 del mapa de
  dolores: $30k–$96k/día en un CEDIS de 30 unidades).
- **Carta porte / POD por foto**: la foto de la carta porte sellada viaja como
  evidencia del viaje (`getPods`/`marcarPodPedido`/`rechazarPod` ya existen);
  se acabó digitalizar al regreso. Pantalla de PODs en el Registro (F2).
- **Gasto autorizado con foto (talacha)**: el operador reporta "se me ponchó
  una llanta" + foto → se crea incidencia (`crearIncidencia` existe) → el jefe
  autoriza monto tope desde su panel o por WhatsApp → el gasto llega
  pre-autorizado a la liquidación. El agente NUNCA autoriza solo: prepara y
  marca (§4.6).
- **Página del agente** con la anatomía §4: qué avisó, qué hitos selló, qué
  incidencias abrió, config de frases/ventana.

**Dependencias:** F2 (pantallas de POD/incidencias donde aterriza lo que el
agente recopila). **Hecho cuando:** un viaje de ensayo corre el ciclo asignar →
avisar → hitos → talacha autorizada → POD → liquidación, todo por WhatsApp real.

## FASE 5 — Agente Conciliador de Peajes (Plaud #2)

**Objetivo:** matar "el martirio": el desglose que el proveedor de peaje manda
cada 10 días se concilia solo contra lo que Likida ya sabe de cada viaje. Es el
equivalente exacto del "Agente Conciliador" de Handle (el que cruza el reporte
del carrier contra el registro) — el patrón ya está clonable.

**Ya existe:** `conciliarLineas()` hace EXACTAMENTE este join para consolidados
de diésel/TAG (~54% del gasto), `leerArchivoUniversal()` lee Excel/CSV/PDF, y
la pantalla `combustible-casetas` enseña conciliación línea a línea.

**Entregables:**
- **Ingesta del desglose**: subir el archivo del proveedor (IAVE/PASE/TeleVía o
  el convenio directo) por la pantalla o por correo (F7); tabla nueva para las
  líneas del desglose con su periodo.
- **Cruce automático**: línea del desglose ↔ caseta esperada del corredor de la
  ruta ↔ comprobante/CFDI si lo hay. Tres cubetas honestas: cuadra / no cuadra
  (con la diferencia en pesos) / sin contraparte. v2: cruce contra GPS cuando
  exista (F3-v2).
- **La bitácora RMF 9.1.8**: el gancho comercial más fuerte del paquete
  fiscal — el estímulo del 50% de peaje exige bitácora de viaje conciliada con
  el estado de cuenta del TAG, y ese documento es EXACTAMENTE el output de esta
  conciliación. Generarla por periodo, con la leyenda de qué requisitos cumple
  y cuáles van por cuenta del contribuyente (aviso de marzo, pago electrónico).
- **Página del agente** con anatomía §4: desgloses recibidos, % conciliado
  (medido), discrepancias abiertas, bitácoras generadas.

**Dependencias:** ninguna dura; F7 (intake por correo) lo vuelve automático.
**Hecho cuando:** un desglose real de ensayo entra y sale conciliado con sus
tres cubetas y su bitácora, sin una cifra inventada.

## FASE 6 — Agente de Facturas de Proveedores → ERP (Plaud #3)

**Objetivo:** la factura del taller/refaccionaria/proveedor deja de capturarse
a mano en el ERP. Llega (correo o foto), se extrae, se aprueba, y sale al
sistema contable del cliente.

**Ya existe:** `extraerComprobante()` (OCR+extracción), `parseCfdiXml()` (nivel
2: conceptos, ClaveProdServ), `consultarCFDI()` (estatus SAT), y el export
CSV/ERP de liquidaciones como patrón (`aFilasExport`).

**Entregables por escalones (honestos sobre el acceso que se tenga):**
1. **Bandeja de facturas de proveedor**: intake por correo dedicado del tenant
   (chasis F7) + subida manual; extracción automática; cola de aprobación
   donde el humano decide (§4.6).
2. **Export universal**: layout CSV/Excel importable — SAP Business One tiene
   plantillas de importación estándar, y el censo manda: SAP aparece en 190
   empresas, CONTPAQi en 110, TMS en 21. Primero el archivo que TODOS pueden
   importar.
3. **Escritura directa a SAP B1** (Service Layer / DI API): SOLO con un
   cliente enterprise que dé acceso a su instancia (Transportes Innovativos lo
   pidió con lectura Y escritura). No se promete integración viva antes de
   tener credenciales de prueba; se vende el escalón 2 mientras.

**Dependencias:** F7 (correo). **Hecho cuando:** una factura real de proveedor
entra por correo y sale como asiento importable sin tecleo.

## FASE 7 — El chasis Handle

**Objetivo:** lo que hace que el conjunto se venda como plataforma y no como
suma de features. Todo clonado del chasis de Handle:

- **Conectores con salud**: una página "Conexiones" donde viven credenciales de
  portales de facturación (los 37 ya registrados + su última corrida buena),
  rastreo GPS (`rastreo_credencial`), monedero/TAG, y el correo del tenant.
  Cada conector: estado medido (verde/roto/sin configurar), nunca decorativo.
- **Intake por correo**: cada tenant recibe una dirección propia
  (facturas@…, desgloses@…); lo que llega entra por el mismo pipeline que
  WhatsApp. Es el multiplicador de F5 y F6.
- **Identidad por agente**: nombre y firma configurables (Cobranza ya lo
  tiene), correo propio por agente cuando exista el intake.
- **/seguridad como página de venta**: multi-tenant, RLS, ARCO ya operando,
  candado legal del timbrado — contado como Handle cuenta su SOC 2, **sin
  mencionar certificaciones que no se tienen** (la mentira chica que cuesta el
  cliente grande).
- **API por agente** (leer cola/bitácora/config) — lo que Handle enseña como
  "API access" por agente. Para el cliente enterprise con TMS propio.
- **Cobranza a clientes / rentabilidad** (`getCobranza`, `getRentabilidad`):
  pantalla cuando exista el primer tenant que registre `factura_emitida` —
  antes, EstadoVacio que explica qué se activa al llenarlo.

**Hecho cuando:** un tenant nuevo puede conectarse (correo, portales, rastreo)
sin tocar la base a mano, y la página de seguridad existe y es toda verdad.

## FASE 8 — Encendidos comerciales

- **Timbrado ON al primer cliente** — decisión ya tomada (encender
  `FACTURACION_MODO=emitir` bajo tu riesgo al cerrar el primer cliente;
  runbook en `docs/encender-emision.md`). Recordatorio ya armado en memoria.
- **Pricing por resultado** (decisión D6 del roadmap): por viaje liquidado,
  con "liquidado" definido por contrato. Anclar contra la nómina que
  sustituye — el censo da el ancla real: Analista de Liquidaciones mediana
  $17,368/mes, y los costos variables ya modelados (~$2,880/mes de facturación
  para 30 camiones + WhatsApp por mensaje desde oct-2026).
- **El piloto Transportes Innovativos**: entrar con F1+F4+F5 (cobranza,
  conductores, peajes — lo que pidieron), el mapa (F3) como el momento wow del
  demo, y SAP B1 (F6.3) como el escalón enterprise que justifica precio mayor.

---

## 9. Reglas transversales (aplican a TODAS las fases)

1. **Nunca inventar una cifra** — tablas vacías dan EstadoVacio con el porqué;
   ceros solo si son medición.
2. **Promesas prohibidas** (la tabla completa en `00-RESUMEN-EJECUTIVO.md`):
   nada de "recuperamos 100%", nada de SOC 2, nada de ahorro en pesos fijos
   por litro, el estímulo se presenta neto de ISR o en litros.
3. **El humano decide** — LFPDPPP 26-II: los agentes preparan y marcan; las
   palabras "fraude/robo" no aparecen en ninguna alerta.
4. **Seguridad multi-tenant primero** — el modo de falla #1 del código escrito
   por agentes es IDOR: toda server action re-verifica sesión/rol ADENTRO y
   ancla el tenant por closure. Cada fase se audita contra eso antes de cerrar.
5. **Migraciones**: archivo en el repo PRIMERO, luego `apply_migration`, luego
   bloque numerado en `verificaciones.sql` con corrida real.
6. **Verificar mirando** — ninguna página se declara lista sin verla renderizada
   en claro y oscuro.
7. **Deploy**: la bandera va en el ASUNTO del commit; antes de enseñar nada,
   confirmar que el deployment corresponde al último commit. (Pendiente tuyo:
   variables LIKIDA_* en Vercel.)

## 10. El orden, y por qué

```
F1 Cobranza (pantalla)  ──►  F2 Registro + Inicio  ──►  F3 Mapa v1
                                                          │
F4 Conductores  ◄─────────────────────────────────────────┘
   │
F5 Peajes  ──►  F7 Chasis (correo/conectores)  ──►  F6 Facturas→ERP
                                                          │
                                     F8 Encendidos  ◄─────┘
```

- **F1 primero** porque es un día de trabajo sobre un motor terminado: el
  tercer agente visible con el mínimo riesgo.
- **F2 antes que el mapa** porque el mapa premium sin registro navegable es
  demo sin producto; juntos son el demo Y el producto.
- **F3 antes de la próxima reunión** con Transportes Innovativos: es el
  momento wow y sale barato en v1 honesta.
- **F4 y F5 son lo que el prospecto pidió** — se construyen con el motor
  conversacional y el conciliador que ya existen.
- **F6 al final de los agentes** porque su escalón 3 (SAP B1 directo) depende
  de credenciales que solo un cliente firmado puede dar — y F8 convierte
  exactamente eso en el cierre.
