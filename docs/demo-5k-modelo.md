# Modelo de datos demo — flota de 5,000 camiones (22-ago-2026)

Transportista ficticia nacional **Transportes Peninsulares, S.A. de C.V. (TPS)**. Todo inventado pero
verosímil; se elimina en cuanto Javier tome las capturas.

## 1 · Flota (5,000 unidades)
- Tractocamiones: 60 % Kenworth (T680 / T880 / T660), 25 % Freightliner (Cascadia / M2), 15 % International LT / Volvo VNL.
  Años 2014–2026 (mediana 2020). Económico `T-0001…T-5000`, placa federal ficticia (3 letras + 4 dígitos + `-A`).
  Odómetro 80,000–1,400,000 km; rendimiento 2.0–2.6 km/L; tanque 900–1,200 L. Terminal base.
- Remolques ~6,000: caja seca 53' (70 %), refrigerada (15 %), plataforma (10 %), tanque (5 %).
- Estatus unidad: 92 % operando, 5 % en taller, 3 % en espera de asignación.

## 2 · Operadores (~7,500)
Nombre completo mexicano verosímil, licencia federal tipo E (vigencia 2026–2029), antigüedad 0–22 años, terminal base,
teléfono falso `5215559xxxxxx`, activo 96 % / baja 4 %. 1.5 por unidad (doble tripulación en ruta larga).

## 3 · Terminales (25)
MTY, GDL, CDMX, QRO, SLP, PUE, VER, MID, CUN, VSA, TIJ, CJS (Cd. Juárez), NLD (Nuevo Laredo), HMO, CUL, LEÓN, AGS,
TOL, TAM, SAL (Saltillo), MZT, OAX, TUX, CHI, DUR — cada una con contralor regional.

## 4 · Clientes y carga (ficticios, ~40)
Retail (Abarrotes del Norte, Súper Peninsular), consumo (Panificadora Central, Bebidas del Golfo), automotriz
(Autopartes Bajío, Ensambladora Saltillo), acero/industrial (Aceros Monterrey, Cementos del Pacífico), agro
(Frutas de Sinaloa, Granos del Bajío), e-commerce (Paquetería Express MX), farma (Farmacéutica Azteca). Cada viaje lleva
cliente, tipo de carga, peso (8–28 t) y carta porte (folio ficticio).

## 5 · Rutas (~120 corredores) con km, casetas y tiempo
Ej.: MTY–QRO 700 km / 6 casetas / ~$2,900 · GDL–CDMX 540 km / ~$2,300 · VER–PUE 280 km / ~$900 · MID–CUN 310 km /
~$1,100 · CDMX–MID 1,310 km / ~$4,800 · NLD–CDMX 1,170 km / ~$4,600 · TIJ–HMO 900 km / ~$1,900 · SLP–MTY 520 km /
~$2,200 · VSA–VER 480 km / ~$1,600 · CJS–CHI 370 km / ~$800. Locales (<150 km) 25 %, regionales 45 %, largas 30 %.

## 6 · Viajes (~70,000 en 30 días ≈ 2,300/día; domingos −40 %)
Folio `TPS-YYMM-NNNNNN`, unidad, operador, terminal origen/destino, cliente, carga, km, salida/llegada, **anticipo**
calculado: diésel estimado (km ÷ rendimiento × $23.60) + casetas del corredor + viáticos ($450/día en ruta) + maniobras
cuando aplica, redondeado a $100. Estatus: ~1,800 abiertos (en ruta, máx. uno por operador, `avisado_en` NULL), ~300
"con faltante", ~150 "sobre tope", resto liquidados (97 % con liquidación emitida, 3 % liquidados sin liquidación).

## 7 · Gastos por viaje (≈3.2 por viaje → ~220,000/mes). Conceptos y proporciones
| Concepto | % de viajes | Importe típico | Forma de pago | CFDI |
|---|---|---|---|---|
| Diésel (1–3 cargas) | 100 % | $2,800–$9,500 por carga | 75 % monedero/tarjeta de flota, 25 % efectivo | 95 % con CFDI (complemento hidrocarburos), 5 % sin |
| Casetas | 90 % | $300–$4,800 | 70 % TAG (IAVE/PASE/TeleVía), 30 % efectivo | 80 % CFDI mensual del TAG, efectivo: ticket |
| Viáticos/alimentos | 60 % | $150–$450 | efectivo | 30 % con CFDI |
| Hospedaje | 20 % (ruta larga) | $450–$900 | efectivo/tarjeta | 85 % |
| Maniobras carga/descarga | 25 % | $300–$1,500 | efectivo | 40 % |
| Pensión/estacionamiento | 30 % | $80–$250 | efectivo | 50 % |
| Báscula | 15 % | $60–$150 | efectivo | 60 % |
| Lavado/engrasado | 10 % | $250–$600 | efectivo | 70 % |
| Refacción/talacha/llanta en ruta | 4 % | $800–$6,500 | efectivo/tarjeta | 65 % |
| Grúa/auxilio vial | 0.5 % | $4,000–$18,000 | transferencia | 95 % |
| Multa/infracción | 1.5 % | $1,200–$9,000 | efectivo | no deducible |
| Custodia/escolta | 3 % (carga de valor) | $3,500–$12,000 | transferencia | 100 % |
| Permisos/sobrepeso/arrastre | 2 % | $500–$3,000 | efectivo | 50 % |
| Telefonía/otros | 5 % | $50–$300 | efectivo | 20 % |

Marcas de validación por gasto: `sobre_tope` (8 % de los diésel contra política por rendimiento), `sin_cfdi` (5 %),
`cfdi_validado_qr` (92 % de los que tienen CFDI), `duplicado_sospechoso` (0.3 %), `efectivo_fuera_15 %` (la regla
LISR 27 fr. III: efectivo > $2,000 sin deducción, ~2 %), `fuera_de_ruta` (0.8 %, gasolinera a >40 km del corredor).

## 8 · Política de gastos del tenant
Tope diésel por viaje = km ÷ 2.2 km/L × $24.00 (+6 % tolerancia); casetas = tabulador del corredor +10 %; viáticos
$450/día; efectivo máximo por gasto $2,000; obligatorio CFDI en diésel y hospedaje; alerta a contralor regional si
faltante > $500 o sobre tope > $300.

## 9 · Liquidaciones (~2,200/día)
Por viaje: anticipo, comprobado, **diferencia** (faltante a descontar / sobrante a reembolsar), gastos sobre tope,
sin CFDI, deducible vs no deducible, IEPS acreditable estimado (cuota vigente), PDF emitido, firmado por operador y
contralor, fecha. Cierre semanal por terminal y mensual por contralor.

## 10 · Lo que debe verse lleno en el dashboard
Inicio: viajes del periodo, anticipado vs comprobado, faltantes, sobre tope, sin CFDI, top rutas, gasto semanal
(diésel/casetas/otros) de 8 semanas, alertas de flota (unidades con rendimiento < 1.9 km/L, operadores con 3+ faltantes,
casetas en efectivo recurrentes), liquidaciones pendientes por terminal. Viajes: tabla con 1042/1039/1037/1035 visibles
arriba. Rentabilidad: margen por ruta y por cliente (tarifa $28–$42/km). Combustible y casetas: litros, $/L, km/L por
unidad, TAG vs efectivo. Operadores: ranking por faltantes y por cumplimiento de CFDI. Unidades: rendimiento y km.
Reportes por periodo: agosto 2026 vs julio, por terminal.
