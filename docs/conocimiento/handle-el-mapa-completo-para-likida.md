# Handle, destilado — el mapa completo para clonarlo en transporte

**Fuente:** video-demo oficial de 8:22 (visto COMPLETO fotograma por fotograma
— 100 cuadros — y transcrito con whisper; transcripción íntegra en
`fuentes-handle-demo-transcript.txt`), más el sitio usehandle.ai explorado en
vivo el 13-ago-2026. Handle: agentes de IA para back-office de seguros (MX),
$6M USD de a16z, ~1M ARR en su primer mes según Javier.

**La frase que organiza todo su producto (dicha textual en el video):**
*"Handle quiere hacer este sistema operativo de todo el backoffice"* — dos
bloques + un chasis. Ese es el molde a robar.

---

## 1. La arquitectura completa

```
BLOQUE 1 — SISTEMA DE REGISTRO ("la base de datos que no necesita actualizarse")
   Inicio (alertas + panorama)  ·  Chatea con tus Registros
   Clientes · Pólizas · Endosos · Recibos · Comisiones · Cotizaciones · Facturas

BLOQUE 2 — AGENTES (uno por proceso doloroso, TODOS con la misma anatomía)
   Cotización · Validador de Pagos · Conciliador · Cobranza
   Extractor de Pólizas · Siniestros · KYC · Feedback

SERVICIOS (categoría aparte, no demostrada)

CHASIS — Configuración de Organización
   General (idioma, logo, Identidad de Marca/BrandAgent)
   Miembros · Cuentas de Correo (Gmail/Outlook OAuth)
   Aseguradoras (credenciales como "conectores", 17 conectadas/31 credenciales)
   Integraciones (Drive, Sheets, Quattro CRM, SICAS, APRO, WhatsApp Cloud)
   Datos (verticales conmutables ✓Seguros · Intake por correo)
   Seguridad (/security como página-documento exportable a PDF)
```

## 2. Bloque 1 — el Sistema de Registro, pieza por pieza

**El patrón de TODA página de entidad** (Clientes, Pólizas, Endosos…):
KPIs arriba (conteo + monto: "12,502 pólizas · 5,528 activas · $17,029,291.47
prima activa") → buscador + filtros por dropdown (aseguradora/tipo/estado/
vence) + "Agrupar" + export + botón "+ Nuevo X" → tabla con pills de estado →
paginación con total honesto ("12502 registros · 1/251").

**El Inicio** ("Hola, David" + fecha): PRIMERO las alertas — un banner rojo
"10 credenciales de portal están fallando al iniciar sesión" con el desglose
por aseguradora — y luego el panorama: stat card NEGRA de Prima del periodo
con link "Metodología" (declaran cómo calculan la cifra), Comisión, Cobranza
como fracción ("3,831 de 11,488 recibos pagados"), donas y barras, tabla de
Recibos Vencidos con "Ver los 360 →", feed de Actividad con badge EN VIVO
("50 pólizas actualizadas · portal-sync"), y "Detalle por aseguradora" con
drill de tres niveles (aseguradora → cuenta → clave de agente). Al pie de TODO
el dashboard: la caja "Pregúntale lo que sea a tus registros…" con la nota
"las respuestas salen directo de tus pólizas, recibos y comisiones".

**El Chat** (primera pantalla de la app): nube de píxeles + chips sugeridos +
Consultar/Ingesta. Al preguntar: la secuencia de pasos REALES visible
("Counting sor_policy… ✓ Found 674 · sor_policy"), y la respuesta es un
REPORTE seccionado (Pólizas / Cobranza / ⚠ Puntos de atención) con negritas,
stat cards y gráficas al final, y chips de **SOURCES** (Pólizas · Recibos)
arriba. En el video presume la **personalización por prompt del cliente**:
"oye, en mis reportes quiero que inicie siempre con pólizas, luego cobranza,
puntos de atención". Historial en panel lateral (TODAY/OLDER + búsqueda) y
"Mis Preguntas" con badge en el sidebar.

## 3. Bloque 2 — la anatomía común de TODO agente (el oro del video)

Cada agente, sin excepción, tiene:

1. **KPIs propios arriba** (Cobranza: ACTIVOS 59 · HOY 0 · PROMESAS 0 ·
   ESCALADOS 7 · PAGADOS 12, cada uno con su monto).
2. **Colas con tabs** — y la parte honesta: Cobranza enseña "Activos 59 /
   **Sin datos de contacto 1,208** / **Excluidas por reglas 37**". El agente
   declara QUÉ NO va a tocar y por qué.
3. **"Ejecutar ahora"** manual + **"Ver ejecuciones"** — bitácora de corridas
   (Periodo · Estado Completado/Fallido · Tareas 2/2 · Duración · Fecha).
4. **Configuración del agente** (tabs General/Canales, menú Estrategia /
   Filtros / Horario / Información / Notificaciones / Pruebas / Demo):
   - **Estrategia** = prompt LIBRE del cliente ("Firmar correos con el nombre
     del ejecutivo. Para clientes corporativos usar tono formal…").
   - **Tiers de seguimiento** con prompt POR TIER (Por vencer en más de 15
     días / entre 0-15 / vencido 1-14 / 15-24 / +24) + "Agregar tier".
   - **Reglas de re-contacto**: máximo de intentos por recibo (5), días de
     gracia tras promesa de pago (1).
   - **Horario**: hora de ejecución (10:00 America/Mexico_City), días
     permitidos (L-V), ventana de contacto en horas hábiles (09–18).
   - **Información**: nombre y correo del EJECUTIVO con el que firma + idioma.
5. **Canales conmutables**: Teléfono ("llamadas automáticas vía IA", número de
   salida Twilio + "Verificar mi número"), Email, WhatsApp — cada uno con sus
   instrucciones y una sección **TEST** (nombre + número destino + "Probar":
   pruebas tu agente contigo mismo antes de soltarlo).
6. **El agente tiene IDENTIDAD**: correo propio (`cotizador.handle@…`), firma
   como un ejecutivo humano, y le puedes ESCRIBIR ("Escribe al agente…")
   dentro de cada caso. En el tab AGENTE del caso se ve su bitácora ("✓ Get
   Insurance Lines → ✓ Crear solicitud → ✓ Get Insurer Options") y el CORREO
   REAL que mandó a la aseguradora.
7. **API pública documentada POR AGENTE** ("Run collections on autopilot" —
   API keys, trigger runs, cron interno, activity log, CURL/JS/Python). El
   agente también es infraestructura.
8. **Onboarding checklist** por agente: "Termina de configurar tu agente de
   cotización: ✓ Agrega lo que vendes · ○ Agrega una aseguradora con contacto
   · ✓ Conecta los accesos de portal · ✓ Elige cómo suena tu agente".

**Detalle de los demostrados:**
- **Cotización** (el flagship): solicitudes con estados (INICIADO / REQUIERE
  ATENCIÓN con badge rojo / CERRADO—CONTRATADA), por cada solicitud tabs
  CONTACTOS (a qué aseguradoras fue, estado por cada una, próximos
  seguimientos, # de preguntas) / COTIZACIONES (comparador de coberturas
  lado a lado con badge "MEJOR PRECIO", Exportar CSV/Excel/PDF y **Generar
  Propuesta** con la marca del cliente) / VALIDACIÓN / AGENTE.
- **Validador de Pagos**: "se conecta todos los días a tus aseguradoras y
  valida si recibiste pagos nuevos". KPIs (3,321 monitoreados · 39 confirmados
  hoy · 1,600 pendientes · 1,707 vencidos), franja ESTA SEMANA / PRÓXIMOS /
  VENCIDOS en MXN + UDI + USD, vistas Cobranza/Calendario/Tabla, tabs
  Pendientes/Pagados/Cancelados/Renovaciones.
- **Conciliador**: contra TU base anterior (Salesforce/CRM propio): buckets
  Coincidencia exacta / parcial / **Falta en base de datos (14,983)** / Falta
  en aseguradora, diferencia de prima y de comisión lado a lado, y "este
  agente va y la corrige".
- **Siniestros**: casos (folio SIN-XXX, paciente, aseguradora, estado, última
  actividad) + **"Seguimiento de reportes médicos"**: cada reporte tiene
  VIGENCIA y "ancla la ventana de cobertura de los gastos; al vencer se
  requiere uno nuevo" — pills Vigente/Por vencer/Vencido/Reemplazado con
  contadores y días ("492d vencido" / "en 94d").

## 4. El chasis — lo que hace que los agentes puedan actuar

- **Credenciales de aseguradoras** como grid de conectores (logo + Conectado +
  n credenciales + "2 requieren atención"), con salud por credencial (activa,
  último uso) y la frase clave: *"Piensa en cada credencial como un conector —
  tus agentes las usan solo cuando la necesitan."* Cuando fallan → alerta roja
  en el Inicio.
- **Cuentas de Correo**: OAuth Gmail/Outlook por miembro con permisos
  granulares visibles (✓ Enviar ✓ Leer ✗ Seguimiento de respuestas → "vuelve a
  vincular"). Los agentes mandan desde los buzones REALES de la empresa.
- **Identidad de Marca / BrandAgent**: pones tu dominio y "rastrea tu sitio y
  extrae colores, fuentes y logo para que las propuestas generadas reflejen tu
  marca" (+ nombre comercial, razón social, eslogan, VOZ/TONO editables).
- **Datos**: verticales CONMUTABLES (✓ Seguros: "pólizas con lifecycle de
  renovación, endosos, recibos…") — la arquitectura está lista para otras
  industrias. Y el **Intake por correo**: `sor.handle@…` — "reenvía los
  reportes de tu aseguradora aquí y los recibos entran a tus registros
  automáticamente. Si vienen protegidos con contraseña, el sistema la toma del
  correo donde llega — no tienes que hacer nada."
- **Seguridad** como página-documento (/security): Aislamiento por
  organización / Cifrado / Control de acceso / Correo corporativo / IA y
  privacidad / Infraestructura / Auditoría / Cumplimiento + exportar PDF. La
  seguridad como material de VENTA.
- Dark/Light mode (lo presumen como feature).

## 5. Los 12 patrones-oro (por qué funciona)

1. **Vender empleados, no features**: cada dolor del back-office es "un
   Agente de X" con nombre de puesto. El cliente entiende al instante.
2. **Una sola anatomía de agente** → el agente #9 es barato de fabricar y el
   usuario ya sabe usarlo.
3. **El agente tiene identidad humana**: correo propio, firma de ejecutivo,
   "elige cómo suena", y le escribes como a un empleado.
4. **El cliente tunea su agente SIN código**: estrategia (prompt), tiers,
   horarios, canales, reglas de re-contacto, pruebas.
5. **El registro se alimenta solo**: portales (credenciales) + intake por
   correo. "Base de datos que no necesita actualizarse."
6. **Credenciales = conectores con salud visible** y alertas cuando fallan.
7. **El chat es la puerta de entrada** (primera pantalla), con pasos visibles
   y reportes seccionados CON FUENTES.
8. **Transparencia operativa en todo**: bitácoras de ejecución, actividad EN
   VIVO, "Metodología" en las cifras grandes.
9. **Los agentes declaran su frontera**: "sin datos de contacto: 1,208",
   "excluidas por reglas: 37". (Nuestra filosofía de honestidad, aplicada a
   colas.)
10. **Documentos con vigencia que anclan procesos** (reporte médico ↔ ventana
    de cobertura). Patrón reutilizable para cualquier documento que vence.
11. **API pública por agente** — el agente como producto para developers.
12. **Marca y seguridad como producto**: BrandAgent para que TODO salga con la
    marca del cliente; /security para cerrar ventas enterprise.

## 6. El diccionario Handle → Likida (transporte de carga MX)

| Handle (seguros)            | Likida (transporte)                                             |
|-----------------------------|-----------------------------------------------------------------|
| Aseguradoras + portales     | Comercios/portales de facturación (CAPUFE, Pemex, OXXO…)        |
| Pólizas                     | **Viajes** (ya)                                                 |
| Recibos                     | **Comprobantes/gastos** (ya)                                    |
| Facturas                    | **CFDIs** (ya: cfdi_uuid, verificación SAT, EFOS)               |
| Endosos                     | Ajustes/reaperturas de liquidación (ya: reabrir con sello)      |
| Comisiones                  | Pagos a operadores / tarifas por viaje (tablas listas, vacías)  |
| Cotizaciones                | Cotización de fletes (futuro — tabla `tarifa` existe)           |
| Clientes                    | Clientes de carga (tabla `cliente` existe, vacía)               |
| Siniestros                  | **Incidencias** (¡la tabla y las funciones YA existen!)         |
| Reportes médicos c/vigencia | **Licencias de operador** (`licencia_vence` ya existe), pólizas y verificaciones de unidades |
| Agente de Cotización        | (Futuro) Agente de Cotización de fletes                         |
| Agente Validador de Pagos   | (Futuro) Agente de Cobranza de facturas emitidas a clientes     |
| Agente Conciliador          | Conciliación de consolidado (getConciliacionConsolidado EXISTE) |
| Agente de Cobranza          | **Recordatorios de comprobación** (0087) — YA corre, falta productizarlo |
| Extractor de Pólizas        | **El OCR de tickets** — nuestro extractor YA es el corazón      |
| Agente KYC                  | Alta de operadores (licencias, teléfono verificado)             |
| Intake por correo (sor.handle@) | facturas@likida para XMLs/CFDIs (complementa WhatsApp)      |
| BrandAgent → propuestas     | Logo de la flota en el PDF de liquidación                       |

## 7. Dónde estamos vs Handle — honesto

**Donde YA estamos a la par (o mejor):** sidebar por categorías con agentes;
chat con secuencia de pasos REAL en streaming + nube de píxeles + historial
persistente + adjuntos con OCR real; dos agentes con páginas vivas y colas
accionables; Despacho operativo; y una cosa que Handle NO enseñó: la guardia
determinística de cifras (ellos no prometen que el modelo no invente números).
Nuestro candado legal de emisión también es más maduro que lo que se ve ahí.

**El roadmap robado, en orden de valor para Likida:**

1. **La anatomía común de agente** — la pieza más valiosa del video. Empezar
   productizando lo que YA corre solo: el recordatorio de comprobación (0087)
   se vuelve configurable como el Agente de Cobranza de Handle: estrategia en
   prompt, tiers por días sin comprobar, horario/ventana hábil, máximo de
   intentos, y bitácora de ejecuciones visible en la página del agente.
2. **Identidad del agente**: nombre, "cómo suena", con qué firma — y la
   sección Pruebas (mándate el WhatsApp a ti mismo).
3. **El Registro navegable completo** (bloque 1): Viajes, Operadores,
   Clientes, Comprobantes, CFDIs como páginas de entidad con el patrón
   KPIs+filtros+export. (Las páginas Viajes/Operadores del plan actual SON
   esto — construirlas con este patrón exacto.)
4. **Inicio con alertas primero**: credenciales/bloqueos de portales fallando
   (ya tenemos los bloqueos de CAPUFE sellados), viajes escalados, CFDIs por
   vencer — el banner rojo ANTES que las gráficas.
5. **Chat: reportes seccionados + SOURCES + personalización por flota** ("en
   mis resúmenes empieza por diésel") guardada como preferencia del tenant.
6. **Intake por correo** para CFDIs/XML (patrón contraseña-en-el-correo
   incluido) — muchas aseguradoras↔muchos emisores de carga mandan por mail.
7. **Vigencias que anclan**: licencias de operador y pólizas de unidad con
   pills Vigente/Por vencer/Vencido en Operadores/Despacho.
8. **Marca de la flota en el PDF** de liquidación (BrandAgent-lite).
9. **API por agente** y página /seguridad — cuando haya clientes enterprise.

**Qué NO copiar (juicio propio):**
- El Conciliador contra CRM ajeno: nuestras flotas objetivo no tienen CRM.
- Los 8 agentes de golpe: Handle llegó ahí con $6M y equipo; nosotros: dos
  agentes GORDOS y operables antes que ocho flacos.
- Llamadas telefónicas IA día uno: WhatsApp ES el canal del gremio; teléfono
  después, si un cliente lo pide.
