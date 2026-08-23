# El perfil operativo del cliente — que cada agente sepa cómo se maneja esta flota

## Punto de partida: el perfil YA existe, y está roto por dispersión
No hay que inventarlo. Hay que **consolidarlo**. Hoy vive repartido en cinco lugares que no se
hablan entre sí:

1. `tenant.config` — política, estímulos, la facilidad del 15%
2. columnas de `tenant` — régimen fiscal, RFC, CP
3. `agente_cobranza_config` (mig. 0089) — horario y días hábiles
4. `agente_notificacion_config` (mig. 0097)
5. `conector_credencial` (mig. 0094)

Y el plano de siniestros proponía un **sexto** (`tenant.config.siniestros`). Ese es exactamente el
patrón de bug, y ya estaba en curso.

**Dato que mide el tamaño del problema: de los 10 agentes vivos, sólo 2 leen algo del cliente** —
liquidación (todo) y conductores (`horasEscalacion`). Las únicas dos perillas editables de todo el
producto son un umbral de OCR y un número de horas.

## Por qué el perfil NO puede ser otra llave de `config`
`getConfig()` **fusiona los defaults de demo**. Estructuralmente no puede contestar
*"¿esto lo declaró el cliente o es nuestro relleno?"* — y esa es justo la pregunta del perfil.
No es descuido: por eso ya hay dos lectores que se saltan `getConfig()`
(`dashboard/politicas/page.tsx:67`, `lib/admin/negocio.ts:417`).

Además la 0159 ya tuvo que partir el CHECK con `config - 'agentes'`; una cuarta llave repite la
resta. Y semánticamente **`config` son parámetros; el perfil son hechos**.

## La decisión: `tenant.perfil jsonb`, columna propia en la misma fila
No dentro de `config` (por lo anterior). No en tabla aparte: `getConfig` es **una sola consulta** y
corre bajo `COSTO_AGENTE_MS = 15_000` en el camino caliente de WhatsApp — una tabla más es un viaje
más en el peor momento.

- **Historial en `tenant_perfil_version` con trigger, no por convención**, porque
  `actualizarFacilidad15` ya escribe sin bitácora y nadie lo notó.
- Sello `perfil_version` en `liquidacion` y en `liquidacion_historico`: una liquidación tiene que
  poder decir con qué perfil se calculó.
- Excepción justificada: lo que es **una lista con vida propia** sí es tabla —
  `proveedor_emergencia`, `flota_poliza`, `contacto_emergencia`. Un teléfono al que se va a llamar
  en una emergencia necesita saber quién lo verificó y cuándo.

## El candado vive en el TIPO, no en una regla
Cada campo lleva procedencia: `declarado` | `detectado` | `inferido` | `default` | `ausente`.
Y el punto único es `perfil/preguntas.ts`, que **expone decisiones, no campos**:

- `decidir()` **no acepta `inferido`**.
- `sugerir()` sí lo acepta, y devuelve **la pregunta que habría que hacer**.

Un agente que quiera actuar sobre una inferencia tiene que llamar una función que no existe.
Eso es mecanismo, no disciplina. Ningún agente importa el tipo `Perfil`; una prueba estructural
falla si se lee fuera de `perfil/` — la casa ya tiene dos guardias así.

---

## El error que hay que no cometer
Un cuestionario de 40 preguntas en el alta. **Nadie lo llena**, y el que lo llena miente por
comodidad: marca "sí, tarjeta empresarial" porque suena bien, y seis meses después el sistema le
acredita un estímulo improcedente apoyado en esa declaración.

El principio correcto sale del propio motor de diésel: **la clasificación es por comprobante, no
por flota**. Un cliente con monedero en carretera, efectivo en ruta corta y crédito con la estación
de casa **ya funciona hoy sin configuración**. El perfil no existe para clasificar comprobantes —
existe para saber **lo que ningún comprobante revela**.

## Mitad A — lo que el sistema INFIERE solo (nunca pregunta)
Modalidad(es) de compra de diésel (¿hay `ecc12`? ¿RFC en padrón de monederos o CRE?) · qué monedero
y de quién (por RFC, no por la marca escrita a mano) · si compra a crédito (`PPD` + `99` sin REP) ·
proporción efectivo/bancarizado · **el denominador real del 15%** (todo el combustible del ejercicio,
monedero incluido) · corredores y estados · volumen mensual · portales que le sirven · si mueve
materiales peligrosos (`ClaveProdServ` + Carta Porte) · si hay doble captura (fotos de cargas que
ya vienen en el ECC).

Se recalcula cada mes y **se le muestra al cliente para que lo corrija**, no para que lo capture.

## Mitad B — lo que hay que PREGUNTAR, cuando hace falta
Cada pregunta se dispara por un hecho, no por el alta.

| Pregunta | Qué desbloquea | Cuándo |
|---|---|---|
| ¿Dedicación exclusiva a carga federal? ¿Régimen? | la válvula del 15% (RFA 2.9) | alta (ya existe) |
| **¿Ingresos bajo o sobre $300M? ¿Parte relacionada?** | **el estímulo de peaje que hoy se aplica sin condición** | antes del primer cierre |
| ¿Las tarjetas están a nombre de la empresa? | requisito literal de LIF 20-A-IV | al ver el primer pago con `04`/`28` |
| Cuando el chofer paga en la bomba, ¿con qué paga? | "con la suya y le reembolsamos" tumba el IEPS, y ningún ticket lo revela | al ver tickets de tarjeta sin XML |
| ¿Tanque propio? ¿litros al mes? | el umbral de 75,714 L/mes | alta — pregunta de exposición |
| **¿Es transporte dedicado?** | RMF 2.7.7.1.3 **invierte los roles** del complemento | alta |
| **¿Hay hombre-camión?** | con hombre-camión los viáticos son práctica fiscal indebida | alta |
| Jefe de flota, a quién se escala, horario | toda la cadena de escalamiento | antes de encender asistencia |
| Aseguradora, póliza y su **800 de siniestros** | hoy sólo hay una fecha de vencimiento suelta | idem |
| ¿Qué GPS / ERP / contabilidad usan? | qué conector encender y qué **no volver a pedir** | alta |
| ¿Pagan al operador por viaje, por km o sueldo? | el agente de conductores completo | alta |

**Regla:** cada pregunta debe poder responderse en un mensaje de WhatsApp. Si necesita que alguien
busque un papel, se pide con plazo y se recuerda — no se bloquea el alta.

---

## Tres huecos fiscales que están abiertos HOY y que el perfil cierra
1. **`estimulos.peajeFactor = 0.5` se aplica sin condición** (`config.ts:127`), pero el estímulo de
   peaje (LIF 2026 art. 20-A) es sólo para ingresos **menores a $300M**.
   **Una flota grande está recibiendo hoy un estímulo que no le toca.**
2. **Ni `carta_porte.ts` ni `fiscal.ts` mencionan "dedicado"** — la RMF 2.7.7.1.3 invierte los roles
   del complemento en transporte dedicado, y el propio corpus ya lo advierte
   (`00-RESUMEN-EJECUTIVO.md:227`).
3. **`normas/rfa-2026-2.2.yaml` está verificada contra fuente primaria y ningún archivo de `src/`
   la lee** — es la deducción del 8% sin documentación, sin aplicar.

Y uno que protege a Likida, no al cliente: con **hombre-camión** los viáticos son práctica fiscal
indebida, y **la fracción II del Criterio 6/ISR/PI alcanza al proveedor de software**
(`03-isr-facilidades.md:632`). Ese campo del perfil es blindaje propio.

## Cómo lo consume cada agente
No como texto en el prompt — **como capacidades habilitadas y preguntas que ya no se hacen**.
Un perfil inyectado en el prompt es una sugerencia que el modelo puede ignorar; un perfil que decide
qué tools existen es un mecanismo.

| Agente | Qué cambia |
|---|---|
| `facturas` | con monedero, el ticket de gasolinera es evidencia operativa, **no gasto** |
| `liquidacion` | el denominador del 15% incluye el monedero → **más margen de efectivo del que cree** |
| `peajes` | con conector de TAG, deja de pedir fotos; y el factor 0.5 se condiciona a los ingresos |
| `proveedores` | con crédito, **espera el REP** en vez de dar el IVA por perdido |
| `conductores` | por viaje / por km / sueldo cambia el cálculo completo |
| `cobranza` | ventana horaria y tono |
| **asistencia** (nuevo) | con hazmat cambia el protocolo entero: SETIQ y los relojes de 6 h y 3 días |
| `experto_fiscal` | qué estímulos aplican y cuáles ni se mencionan |

## Orden de construcción
El valor llega en el **paso 3** (≈1 semana): columna + lector con **una sola** pregunta + cuestionario.

Y el **paso 6 — migrar la facilidad del 15%, la ventana de cobranza y `ORDEN_AVISO` al perfil — va
ANTES que cualquier agente nuevo.** Si no, los agentes nuevos se construyen encima de la deriva que
se está tratando de arreglar.

Plano detallado: https://claude.ai/code/artifact/fa69a88f-ed2d-4780-90ae-726c89cfad64
