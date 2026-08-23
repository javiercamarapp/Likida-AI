# Gastos de viaje reales de una flota de tractocamiones en México (2025–2026)

Documento de calibración para la demo de Likida (liquidación de viajes). Fecha de corte: 22-ago-2026.
Regla del documento: todo número lleva fuente y fecha; lo que no tiene fuente pública está marcado como **[ESTIMACIÓN]** con su razonamiento.

Convenciones: precios en MXN con IVA. "T3-S2" = tractocamión 3 ejes + semirremolque 2 ejes (caja seca 48/53 pies) = **5 ejes** (clase C5/T5 en casetas). "Full" = T3-S2-R4 = 9 ejes (C9/T9).

---

## 0. Tabla de fuentes

| # | Fuente | Qué aporta | URL | Fecha del dato |
|---|---|---|---|---|
| F1 | Profeco / CNE vía Infobae | Promedio nacional diésel 27.031 $/L; Magna 23.694; Premium 28.522 | https://www.infobae.com/mexico/2026/08/18/precios-de-la-gasolina-hoy-en-mexico-litro-de-magna-premium-y-diesel-este-martes-18-de-agosto/ | 18-ago-2026 |
| F2 | Profeco "Quién es Quién" PDF | Promedio diésel 27.041 (3-ago) / 27.033 (11-ago) | https://combustibles.profeco.gob.mx/qqpgasolina/2026/QQPGASOLINA_080326.pdf | ago-2026 |
| F3 | SHCP/DOF vía El Imparcial | Estímulo IEPS diésel 69.09 %, cuota neta 2.2760 $/L, subsidio 5.0874 $/L (15–21 ago) | https://www.elimparcial.com/dinero/2026/08/15/hacienda-retira-el-estimulo-fiscal-a-la-gasolina-premium-y-reduce-el-de-la-magna-del-15-al-21-de-agosto-por-lo-que-automovilistas-pagaran-la-cuota-completa-de-ieps-por-litro/ | 15-ago-2026 |
| F4 | Global Energy / Diario.mx | Estímulo diésel 75.90 % (1–7 ago), 64.96 % (8–14 ago) | https://globalenergy.mx/noticias-especiales/articulos/hacienda-recorta-el-estimulo-fiscal-a-las-gasolinas-magna-y-premium-pero-lo-eleva-para-el-diesel/ | ago-2026 |
| F5 | Dossier Político (con datos CANACAR/Pemex) | Cuota IEPS diésel 2026 = 7.36 $/L; diésel 25–40 % del costo (hasta 66 % en larga distancia); carga fiscal 41 % del precio | https://dossierpolitico.com/2026/04/09/diesel-el-costo-de-mover-a-mexico/ | 09-abr-2026 |
| F6 | Transporte.mx "¿Cuál es el costo por kilómetro…?" | Desglose $/km: diésel 9, peajes 2, operador 15, mant+llantas 10, depreciación+fijos 10 = 46 $/km; umbral 45 $/km | https://transporte.mx/cual-es-el-costo-por-kilometro-en-el-autotransporte-de-carga-en-mexico/ | 30-jul-2025 (comentario 30-jul-2026: diésel ya en 28) |
| F7 | Transporte.mx "La mitad del autotransporte… sin utilidades" (Canacar, Amacarga) | Diésel pasó de 40–45 % a >50 % del costo; seguros +34 %; 50 % de empresas sin utilidad 2026 | https://transporte.mx/la-mitad-del-autotransporte-mexicano-cerrara-2026-sin-utilidades-anatomia-de-una-crisis-de-rentabilidad/ | 01-jul-2026 |
| F8 | IMT, Publicación Técnica 838 "Costos de operación base… 2024" | T3-S2: 483.92 L / 1,000 km (2.07 km/L modelo VOC), costo base 20.48 $/veh-km a diésel 20.93 $/L, desglose por insumo | https://imt.mx/archivos/Publicaciones/PublicacionTecnica/pt838.pdf | precios 2024 |
| F9 | Grupo Traxión, Reporte 1T26 (BMV) | Carga: ingreso 33.88 $/km, costo 29.07 $/km; rendimiento 3.50 km/L (flota mixta); combustible 9.2 % de ingresos consolidados, peajes 2.9 %, costo laboral 19.2 %; 2,287 unidades de carga, 54.9 M km/trim | https://miranda-newswire.com/wp-content/uploads/2026/04/TRAXION-1T26-Reporte-Trimestral-VF.pdf | 27-abr-2026 |
| F10 | Webfleet MX | Tractocamión 30 t: 2.6 km/L, 680 km/día, 261.5 L/día | https://www.webfleet.com/es_mx/webfleet/blog/cuanto-diesel-consume-un-camion-en-mexico-y-cuanto-puede-ahorrar/ | 2025 |
| F11 | Smart Fleet / Operadores.com | Rango 2.5–4 km/L cargado; 0.29–0.40 L/km | https://es.smartfleetapp.com/blog/rendimiento-combustible-camion-diesel-mexico/ ; https://operadores.com/2026/04/28/precio-del-diesel-en-mexico-como-calcularlo-en-tu-costo-por-kilometro/ | abr-2026 |
| F12 | CAPUFE, Tarifas vigentes 2026 (PDF oficial, red FONADIN) | Tarifa por plaza por clase (A, B2–B4, C2–C9) vigente 13-abr-2026 | https://pot.capufe.mx/gobmx/transparencia/Doc/TransparenciaF/Tarifas/Vigentes/2026/Tarifas-vigentes-2026.pdf | 13-abr-2026 |
| F13 | PASE, Tarifas 2025 (PDF) | Tarifa por plaza concesionada por clase T2–T9 (Autopista de Occidente, Tepic–Mazatlán, Kantunil–Cancún, SLP, etc.) | https://www.pase.com.mx/wp-content/uploads/2025/06/Tarifas_2025.pdf | jun-2025 |
| F14 | casetas.com.mx (plazas individuales) | Tarifas 2026 auto y "camión 5-6 ejes" por caseta (Sabinas 600, Mérida–Cancún 452, Acaponeta 1,160, Tijuana 442, etc.) | https://casetas.com.mx/casetas/sabinas ; https://casetas.com.mx/casetas/merida-cancun | 2026 |
| F15 | gastosconduccion.com | Km, número de casetas y costo auto por corredor (MTY–CDMX 901 km/9 casetas/$796; GDL–CDMX $1,231; etc.) | https://gastosconduccion.com/es/distancia/Monterrey/Ciudad-de-Mexico | ago-2026 |
| F16 | POSTA (Saltillo–Monterrey) | Ojo Caliente 2–Morones Prieto 2026: C2-4 $309, C5-6 $559, C7-9 $583 | https://www.posta.com.mx/coahuila/usas-la-autopista-saltillo-monterrey-aqui-te-contamos-como-quedo-el-nuevo-ajuste-a-las-tarifas/vl2190190 | abr-2026 |
| F17 | DUFREI (resumen CAPUFE 2026) | C5-6: México–Querétaro 999, México–Puebla 949, Durango–Mazatlán 2,505; "viaje MTY–CDMX tracto >7,200 en casetas"; costo viaje 48,000 (2024) → 52,500 (mid-2025) | https://www.dufrei.com/blog/noticias-2/capufe-2026-nuevas-tarifas-en-casetas-199 | abr-2026 |
| F18 | CAPUFE "Cero Efectivo" (Expansión, Proceso, ADN40) | ~90 % de carriles CAPUFE ya con telepeaje; meta 89 % 2025, 95 % 2026, 100 % 2027 | https://expansion.mx/tendencias/2026/07/27/capufe-moderniza-las-casetas-para-avanzar-a-un-esquema-de-cero-efectivo ; https://www.proceso.com.mx/nacional/2026/8/1/pago-de-casetas-esto-es-lo-que-cambia-en-capufe-si-viajas-por-carretera-377228.html | jul/ago-2026 |
| F19 | SAT, LISR art. 28 fr. V | Viáticos: deducibles solo fuera de 50 km; alimentos tope 750 $/día nacional (1,500 extranjero); hospedaje 3,850 extranjero; renta auto 850; requiere CFDI y relación laboral | https://www.sat.gob.mx/articulo/96585/articulo-28 | vigente 2026 |
| F20 | Contadigital / ContaClara (LISR 27 fr. III y RLISR 152) | Pagos > 2,000 solo por transferencia/cheque/tarjeta/monedero; combustible siempre por medio electrónico; hasta 20 % de viáticos sin comprobante (máx. 15,000/año) | https://www.contadigital.mx/posts/viaticos-tratamiento-fiscal ; https://contaclara.com/blog/viaticos-deducibles-en-mexico-guia-completa-de-requisitos-limites-y-comprobacion-ante-el-sat/ | 2025 |
| F21 | Indeed MX (vacantes operador tractocamión) | Sencillo 7,000–8,000 $/sem; full 9,000–11,000 $/sem foráneo; Culiacán 10,228–15,139 $/sem | https://mx.indeed.com/Empleos-de-Operador-de-tractocamion | ago-2026 |
| F22 | Computrabajo / Glassdoor / Transporte.mx | Salario promedio operador 19,221 $/mes (rango 2,000–34,000); 18,000–35,000 + viáticos; Castores 20,705 $/mes | https://mx.computrabajo.com/salarios/operador-de-tractocamion ; https://transporte.mx/cuanto-gana-promedio-un-operador-de-camion-de-carga-en-mexico/ | 2026 |
| F23 | Cotizadoraonline / Ventura Logistics | Tarifa referencia tráiler 53' 36–48 $/km (sin casetas); flete desde 6,800 MXN | https://www.cotizadoraonline.com/cotizacion-transporte-fletes ; https://venturacargaylogistica.com/s/precios-flete-con-cajas-seca-de-53-pies-monterrey | 2026 |
| F24 | Camiones.mx | Unidades 10,000–15,000 km/mes; ejemplo Kenworth T680 15,000 km/mes | https://camiones.mx/calcular-costo-por-kilometro-camion-mexico/ | nov-2025 |
| F25 | Dicex / Whyloyalty | Diésel ≈ 1/3 de costos operativos; hasta 40 % en rutas norte | https://www.dicex.com/en/post/los-costos-de-transporte-en-mexico-2025-carretera-vs-ferrocarril | 2025–2026 |

Fuentes consultadas sin dato útil (para no repetir el intento): ANTP (no publica estructura de costos abierta), A.T. Kearney/CANACAR (estudio no público), informe integrado Traxión 2025 (no publicado al corte), OCC/Computrabajo (páginas JS: no exponen montos de viáticos en texto), gorfhi.mx (tarifas de camión detrás de paywall), Edenred/Sí Vale/Toka (sin encuesta de comprobación publicada).

---

## 1. Diésel: precio, estímulo IEPS, rendimiento y $/km

| Concepto | Valor | Fuente |
|---|---|---|
| Precio promedio nacional diésel | **27.03 $/L** (27.041 el 3-ago; 27.033 el 11-ago; 27.031 el 18-ago) | F1, F2 |
| Rango regional | ~26 (frontera norte/estaciones baratas) a 30 $/L (Urique, Chih.) | F5 |
| Cuota IEPS diésel 2026 (completa) | 7.36 $/L | F5 (consistente con F3: 5.0874/0.6909 = 7.363) |
| Estímulo IEPS diésel vigente (15–21 ago 2026) | **69.09 %** → cuota neta **2.276 $/L**; subsidio 5.087 $/L | F3 |
| Estímulo semanas previas | 75.90 % (1–7 ago), 64.96 % (8–14 ago) | F4 |
| Precio sin estímulo (referencia) | >33 $/L | F5 |
| Rendimiento tractocamión cargado | 2.5–4.0 km/L (rango); **2.6 km/L** a 30 t (Webfleet); 2.8 km/L (Transporte.mx); 2.07 km/L modelo IMT VOC (T3-S2 25 t, terreno base); 3.50 km/L Traxión (flota mixta carga+pasaje, ciclo real) | F10, F6, F8, F9, F11 |
| Costo diésel por km | **10.40 $/km @2.6 km/L**; 9.01 @3.0; 11.75 @2.3; 9.65 @2.8 (todos a 27.03 $/L) | cálculo sobre F1 |
| Litros por 100 km | 38.5 L @2.6 km/L (0.385 L/km) | cálculo |

Nota de calibración: para una demo de flota nacional con caja seca 53' cargada, 2.6 km/L es el punto medio defendible (Webfleet usa exactamente ese valor; IMT es más pesimista porque modela terreno y sobrecarga; Traxión es optimista porque mezcla autobuses).

---

## 2. Estructura de costos del autotransporte

### 2.1 Desglose $/km (tractocamión articulado, ruta nacional)

| Concepto | Transporte.mx 2025 ($/km) | % | IMT PT-838 2024 T3-S2 ($/km, caso base) | % IMT | Traxión 1T26 (% de ingresos consolidados) |
|---|---|---|---|---|---|
| Diésel | 9.0 (a 25–27 $/L y 2.8 km/L) | 19.6 % | 10.13 | 49.5 % | 9.2 % (flota mixta, precio neto de estímulo) |
| Casetas / peajes | 2.0 | 4.3 % | no incluido | – | 2.9 % |
| Sueldo operador + viáticos | 15.0 | 32.6 % | 0.91 (solo hora-hombre) | 4.4 % | 19.2 % (costo laboral total) |
| Mantenimiento + llantas + refacciones | 10.0 | 21.7 % | 6.45 (llantas 0.96 + MO 1.94 + refacciones 3.55) | 31.5 % | 5.3 % (mantenimiento de flota) |
| Depreciación + seguros + admón. | 10.0 | 21.7 % | 2.73 (deprec. 0.69 + interés 0.18 + indirectos 1.86) | 13.3 % | 7.8 % (D&A) |
| Lubricantes | – | – | 0.26 | 1.3 % | – |
| **Total** | **46 $/km** (rango 44–50) | 100 % | **20.48 $/km** (sin peajes, sin salario completo, diésel 20.93) | 100 % | costos totales 83.2 % de ingresos |

Fuentes: F6, F8, F9. Interpretación: el IMT es costo "base" de ingeniería (para evaluación de carreteras), no costo de empresa; Transporte.mx/CANACAR reflejan costo empresarial completo.

### 2.2 Peso del diésel según fuente

| Fuente | % diésel en costo operativo | Fecha |
|---|---|---|
| CANACAR (vía Dossier Político) | 25–40 %; hasta 66 % en larga distancia | abr-2026 |
| CANACAR (Bortoni, vía Transporte.mx) | pasó de 40–45 % a **>50 %** tras subir a ~29 $/L | jul-2026 |
| FleetForce / Dicex | 30–40 % / ~1/3; hasta 40 % rutas norte | 2025–2026 |
| Traxión (real, flota mixta) | 9.2 % de ingresos ≈ 11 % de costos | 1T26 |

### 2.3 Costo total y tarifa por km

| Indicador | Valor | Fuente |
|---|---|---|
| Costo total operación | **44–50 $/km** (46 típico) | F6 |
| Costo por km Traxión carga (salarios+mant.+diésel neto+peajes+D&A) | **29.07 $/km** (26.42 en 1T25, +10 %) | F9 |
| Ingreso por km Traxión carga | **33.88 $/km** (35.04 en 1T25) | F9 |
| Tarifa referencia tráiler 53' al cliente | **36–48 $/km** sin casetas; 38–55 $/km proyección | F23, búsqueda "camiones.mx" |
| Umbral de rentabilidad citado | "abajo de 45 $/km te estás ahorcando" | F6 |
| Viaje MTY–CDMX costo total (tracto) | 48,000 (2024) → 52,500 (mid-2025) | F17 |

---

## 3. Casetas por corredor (tractocamión 5 ejes T3-S2 = clase C5/T5)

Método: suma plaza por plaza. Donde la plaza es CAPUFE/FONADIN se usa la tarifa 2026 oficial (F12). Donde es concesionada se usa PASE 2025 (F13) × 1.05 (ajuste tarifario anual típico; CAPUFE 2026 subió 4.7–24.4 %) o el valor 2026 de casetas.com.mx (F14) cuando existe. Los totales están redondeados a ±5 %. Para full (9 ejes) multiplicar por ~1.45 (relación C9/C5 de CAPUFE: México–Qro 1,446/999).

| Corredor | km (F15) | Casetas | Detalle de plazas (tarifa C5/T5 usada) | **Total C5 sencillo** | $/km | Auto (ref. F15) |
|---|---|---|---|---|---|---|
| MTY–CDMX | 901 | 8 | Saltillo–Mty 559 (F16) + Los Chorros/La Carbonera 306 (F12) + Lib. Matehuala 139 + Ventura–El Peyote 328 + Lib. Ote. SLP 300 (F13×1.05) + Chichimequillas 121 + Palmillas 482 + Tepotzotlán 517 (F12) | **≈ 2,750** | 3.1 | 796 |
| MTY–QRO | 704 | 6 | MTY–CDMX menos Palmillas y Tepotzotlán | **≈ 1,750** | 2.5 | 518 |
| GDL–CDMX (Aut. de Occidente + Toluca) | 540 | 8 | Ocotlán 700 + Ecuandureo 365 + Panindícuaro 690 + Zinapécuaro 495 + Contepec 226 + Atlacomulco 226 + El Dorado 257 + La Marquesa 347 (F13×1.05) | **≈ 3,300** | 6.1 | 1,231 |
| CDMX–VER vía Puebla–Córdoba (ruta de carga al puerto) | 400 | 6 | San Marcos 688 + San Martín 261 + Amozoc 360 + Esperanza 745 + Fortín 180 + Córdoba–Veracruz 566 (F12) | **≈ 2,800** | 7.0 | 863 (vía Xalapa) |
| CDMX–VER vía Amozoc–Perote–Xalapa | 400 | 7 | Peñón 192 + Cuapiaxtla 186 + Cantona 397 + Ramírez ~400 + Copexa ~400 [EST ×2 auto] + Plan del Río 230 + La Antigua 312 | ≈ 2,100 | 5.3 | 863 |
| VER–PUE | 280 | 4 | Córdoba–Ver 566 + Fortín 180 + Esperanza 745 + Amozoc 360 (F12) | **≈ 1,850** | 6.6 | 1,052 (vía Xalapa) |
| MID–CUN (Kantunil–Cancún, sistema cerrado) | 308 | 2 | Kantunil–Valladolid 985 + Valladolid–Cancún 1,682 (F13) ×1.05 | **≈ 2,800** | 9.1 | 645 |
| CDMX–MID | 1,330 | 14 | CDMX–Córdoba 2,234 + Cuitláhuac 278 + Cosamaloapan 561 + Acayucan 543 + Dovalí 73 + S. Magallanes 275 + Nacajuca 220 + Zacatal 390 + Pte. de la Unidad ~300 [EST] + Seybaplaya 277 | **≈ 5,150** | 3.9 | 1,738 |
| NLD–MTY | 219 | 2 | Ex-Garita 245 (F14) + Sabinas 600 (F14) | **≈ 845** | 3.9 | 470 |
| SLP–MTY | 511 | 4 | Ventura 328 + Matehuala 139 + Los Chorros 306 + Saltillo–Mty 559 | **≈ 1,330** | 2.6 | 413 |
| GDL–MZT | 470 | 8 | Arenal 394 + Plan de Barrancas 569 + Sta. Ma. del Oro 390 + Trapichillo 418 + Ruiz 575 + Acaponeta 1,212 + Rosario 617 + Lib. Mazatlán ~200 [EST] | **≈ 4,400** | 9.4 | 1,771 |
| TIJ–HMO | 867 | 7 | Tijuana–Tecate 442 + El Hongo 345 + La Rumorosa ~100 [EST] + Lib. Mexicali 300 + Río Colorado ~45 [EST] + Santa Ana 228 + Hermosillo 287 (F12) | **≈ 1,750** | 2.0 | 666 |
| MTY–Saltillo (local) | 89 | 1 | Ojo Caliente 2–Morones Prieto C5-6 559 (F16) | **559** | 6.3 | 143 |
| CDMX–PUE (regional) | 130 | 3 | México–Puebla C5 949 (F12) | **949** | 7.3 | 226 |

Observaciones:
- La relación tarifa C5 / auto varía de 1.8× (Gdl–Tepic) a 4.4× (México–Querétaro); no usar un factor único.
- El dato de prensa "MTY–CDMX >7,200 en casetas" (F17) corresponde a redondo o a full 9 ejes; el sencillo C5 de ida es ≈2,750 y el full ≈4,000.
- Promedio ponderado para la demo: **≈3.0 $/km en corredores del norte-centro, 6–9 $/km en Occidente/Golfo/Península**. El "2 $/km" de CANACAR (F6) es promedio nacional que incluye tramos libres.

### 3.1 TAG vs efectivo

| Dato | Valor | Fuente |
|---|---|---|
| Carriles CAPUFE con telepeaje (IAVE/PASE/TeleVía/ViaPass interoperables) | ~90 % (jun-2025); meta 89 % 2025 → 95 % 2026 → 100 % 2027 ("Cero Efectivo") | F18 |
| % de flotas de carga que pagan con TAG | **No existe cifra pública.** [ESTIMACIÓN] Flotas >100 unidades: 85–95 % del gasto en casetas vía TAG corporativo (IAVE/PASE flotilla, facturación mensual); hombre-camión y flotas <20: 40–60 %, resto efectivo del anticipo. Razonamiento: obligatoriedad progresiva CAPUFE + facturación CFDI automática del TAG vs. facturación manual en caseta (30 días). | – |

---

## 4. Viáticos y gastos de viaje en efectivo (anticipo)

### 4.1 Marco fiscal (con fuente)

| Regla | Valor | Fuente |
|---|---|---|
| Viáticos deducibles solo fuera de | 50 km del establecimiento | F19 (LISR 28-V) |
| Tope alimentos | 750 $/día/persona nacional; 1,500 extranjero | F19 |
| Hospedaje | sin tope nacional (con CFDI); 3,850 extranjero | F19, F20 |
| Comprobación | CFDI obligatorio en territorio nacional; beneficiario con relación laboral | F19 |
| Pagos > 2,000 $ | solo transferencia, cheque nominativo, tarjeta o monedero; **combustible siempre electrónico sin importar monto** | F20 (LISR 27-III) |
| Viáticos sin comprobante | hasta **20 %** del total, máx. 15,000 $/año por trabajador, si el resto se pagó con tarjeta a nombre del patrón (RLISR 152) | F20 |
| Exención ISR para el operador | viáticos comprobados no son ingreso (LISR 93-XVII); lo no comprobado se acumula como salario | F20 |

### 4.2 Montos que se entregan al operador

Hallazgo: ninguna bolsa de trabajo expone el monto de viáticos en texto indexable (OCC/Computrabajo/Indeed/Glassdoor solo muestran "viáticos" como prestación y sueldos de 7,000–11,000 $/semana en foráneo, F21). Por tanto los montos siguientes son **[ESTIMACIÓN]** triangulada con: tope fiscal de alimentos (750 $/día), salario semanal foráneo (F21), y la práctica de que el operador duerme en cabina (hospedaje excepcional).

| Concepto del anticipo | Monto típico por día | Qué incluye | Cómo se comprueba | Nota |
|---|---|---|---|---|
| Alimentos | 400–600 $/día (tope deducible 750) | 3 comidas en carretera | Tickets; CFDI raro en fondas → cae en el 20 % no comprobable | parte fija del anticipo |
| Hospedaje | 0 (cabina) / 500–800 cuando aplica | hotel en espera de carga o >2 noches | CFDI hotel | excepción |
| Pensión / estacionamiento seguro | 150–400 $/noche | patios, paradores | ticket/CFDI | frecuente en Edomex, Pue, SLP, Gto |
| Lavado de unidad | 300–600 $/viaje | lavado exterior/caja | ticket | 1 de cada 2–3 viajes |
| Básculas | 100–300 $/pesada | báscula pública | ticket | según cliente |
| Maniobras (carga/descarga) | 300–1,500 $/evento | estibadores, montacargas | rara vez CFDI | depende del cliente; a veces lo paga el embarcador |
| Propinas / "cooperaciones" | 100–500 $/viaje | vigilantes, patio, tránsito | sin comprobante | 100 % sin CFDI |
| Talachas / llanta ponchada / imprevistos | 500–2,500 $/evento | vulcanizadora en carretera | ticket, CFDI a veces | ~1 de cada 8–10 viajes |
| Casetas en efectivo (si no hay TAG) | ver §3 | – | recibo de caseta; CFDI vía portal CAPUFE en 30 días | solo flotas sin TAG |
| Diésel en efectivo | idealmente 0 | – | debe ser electrónico (LISR 27-III) | si la flota da efectivo para diésel, ese gasto es no deducible |

Parámetro para la demo: **viáticos 600 $/día-operador** (alimentos 450 + varios 150) + "otros gastos de viaje" ≈ **0.6 $/km** (pensión, lavado, básculas, propinas, talachas promediados).

### 4.3 % que queda sin comprobar

No hay encuesta pública. Referencias indirectas: el RLISR permite 20 % sin comprobante (F20), lo que implica que el legislador reconoce ese nivel como normal. [ESTIMACIÓN] En flotas con efectivo: 25–40 % del anticipo termina sin CFDI (tickets simples o nada); con tarjeta/monedero de viáticos: 8–15 %. Para la demo usar **30 % sin CFDI en efectivo, 12 % con tarjeta**.

---

## 5. Viaje tipo completo (T3-S2 cargado, 2.6 km/L, diésel 27.03, viáticos 600/día, otros 0.6 $/km)

| Concepto | MTY–QRO (704 km, 1.5 días) | MTY–CDMX (901 km, 2 días) | Local MTY–Saltillo (89 km, medio día) |
|---|---|---|---|
| Litros | 271 | 347 | 34 |
| Diésel $ | 7,319 | 9,367 | 925 |
| Casetas $ (C5) | 1,750 | 2,750 | 559 |
| Viáticos $ | 900 | 1,200 | 300 |
| Otros gastos de viaje $ | 422 | 541 | 53 |
| **Total gastos de viaje** | **10,391** | **13,858** | **1,837** |
| Diésel / total | 70 % | 68 % | 50 % |
| Por tarjeta de combustible (diésel) | 7,319 | 9,367 | 925 |
| Por TAG (casetas) | 1,750 | 2,750 | 559 |
| **Anticipo en efectivo** (viáticos + otros) | **≈ 1,300** | **≈ 1,750** | **≈ 350** |
| Anticipo efectivo si la flota NO tiene TAG | ≈ 3,050 | ≈ 4,500 | ≈ 910 |
| Costo total del viaje a 46 $/km (F6) | 32,384 | 41,446 | 4,094 |
| Ingreso a 40 $/km + casetas (F23) | 29,910 | 38,790 | 4,119 |

Consistencia con prensa: MTY–CDMX total 41,446 a 46 $/km vs "52,500 mid-2025" (F17) que incluye retorno parcial/vacío y margen; orden de magnitud coherente.

---

## 6. Volúmenes por tamaño de flota

Supuestos (con fuente): 10,000–15,000 km/mes por unidad (F24; Webfleet 13,600 km/mes a 680 km/día × 20 días, F10); viaje promedio 700 km (mezcla de corredores §3); → **viajes/mes/unidad 8–16, usar 10** para ruta nacional, 25–40 para regional/local <200 km.

Gasto de viaje mensual por unidad (nacional, 10 viajes × 700 km = 7,000 km): diésel 2,692 L × 27.03 = **72,800 $**; casetas ≈ **17,500 $** (2.5 $/km); viáticos + otros ≈ **13,200 $**; **total ≈ 103,500 $/mes/unidad** (≈ 14.8 $/km de gasto de viaje puro, sin salario ni fijos).

| Panel | 300 unidades | 1,000 unidades | 5,000 unidades |
|---|---|---|---|
| Viajes / mes | 3,000 | 10,000 | 50,000 |
| **Viajes / semana** | **≈ 690** | **≈ 2,300** | **≈ 11,500** |
| Km / mes | 2.1 M | 7.0 M | 35 M |
| Litros / mes | 808 mil | 2.69 M | 13.5 M |
| **Diésel $ / mes** | **21.8 M** | **72.8 M** | **364 M** |
| Casetas $ / mes (TAG) | 5.2 M | 17.5 M | 87.5 M |
| **Anticipos efectivo $ / semana** (≈1,300/viaje) | **≈ 0.9 M** | **≈ 3.0 M** | **≈ 15.0 M** |
| Anticipos efectivo $ / mes | 3.9 M | 13.0 M | 65 M |
| Liquidaciones pendientes en un momento dado (3 días promedio) | ~300 | ~1,000 | ~5,000 |
| Referencia real: Traxión carga 2,287 unidades → 54.9 M km/trimestre = 18.3 M km/mes = **8,000 km/mes/unidad** (F9) | | | |

---

## 7. Indicadores de contraloría

Sin benchmark público mexicano para liquidaciones; los valores "típico" son **[ESTIMACIÓN]** de práctica de TMS (LISTMS, TransportePRO, e-transporte describen los conceptos pero no publican estadísticas). Los con fuente se indican.

| Indicador | Definición | Valor típico (flota sin control) | Meta (flota con Likida) | Fuente / base |
|---|---|---|---|---|
| Costo por km (gasto de viaje) | (diésel+casetas+viáticos+otros)/km | 14–16 $/km | 13–14 | §5, §6 |
| Costo total por km | todo incluido | 44–50 $/km; Traxión 29.07 | – | F6, F9 |
| Litros por 100 km / km por L | telemetría o tanque lleno | 38–43 L/100 km (2.3–2.6 km/L) | 33–36 (2.8–3.0) | F10, F11, F9 |
| Desviación de diésel vs. teórico | L cargados – L esperados por km | 5–10 % (robo hormiga, fugas) | <3 % | Positrace: "ahorro >200,000 $/año tras corregir" (blog, 2025); Webfleet 2.6→3.1 km/L = 16 % |
| % viajes con faltante (operador gastó más que anticipo) | liquidaciones con saldo negativo | 15–25 % | <10 % | [EST]; Smart Fleet describe el caso |
| % viajes con sobrante no devuelto | saldo positivo no reintegrado | 5–10 % | <2 % | [EST] |
| % gasto sobre política (tope diario) | partidas > tope (alimentos 750, pensión, etc.) | 10–20 % de viajes | <5 % | tope: F19 |
| % de gasto sin CFDI | $ sin comprobante fiscal / $ anticipo | 25–40 % efectivo; 8–15 % tarjeta | <15 % | F20 (20 % legal) |
| % casetas pagadas en efectivo | vs TAG | 5–15 % flota grande; 40–60 % pequeña | <5 % | F18 |
| Días para liquidar | cierre de viaje → liquidación aprobada | 5–10 días (papel) | 1–2 días | [EST] |
| Liquidaciones pendientes > 7 días | backlog | 20–30 % | <5 % | [EST] |
| Diésel pagado en efectivo | no deducible | 0–10 % | 0 % | F20 |
| Anticipo promedio por viaje (efectivo) | $ | 1,300 nacional / 350 local | – | §5 |

---

## CALIBRACIÓN DE LA DEMO (parámetros exactos)

```
precio_diesel            = 27.03   # $/L, Profeco/CNE 18-ago-2026 (F1); rango de sensibilidad 26.0–29.0
ieps_diesel_cuota        = 7.36    # $/L 2026 (F5)
ieps_estimulo_pct        = 69.09   # % semana 15–21 ago 2026 (F3) -> cuota neta 2.276
rendimiento_km_l         = 2.6     # cargado 30 t (F10); vacío 3.2; rango 2.3–3.0
diesel_por_km            = 10.40   # $/km = 27.03 / 2.6
litros_por_100km         = 38.5

casetas_por_km (C5, sencillo):
  MTY–CDMX 3.05 | MTY–QRO 2.50 | SLP–MTY 2.60 | NLD–MTY 3.85 | TIJ–HMO 2.00
  GDL–CDMX 6.10 | CDMX–VER 7.00 | VER–PUE 6.60 | GDL–MZT 9.40 | MID–CUN 9.10 | CDMX–MID 3.90
  MTY–SAL 6.30 | CDMX–PUE 7.30
factor_full_9_ejes       = 1.45    # C9/C5 (F12)

viaticos_por_dia         = 600     # alimentos 450 + varios 150 [EST]; tope fiscal alimentos 750 (F19)
otros_gastos_por_km      = 0.60    # pensión, lavado, báscula, propinas, talachas [EST]
dias_por_viaje           = km/600 redondeado a 0.5 (ej. 704 km = 1.5; 901 km = 2)

anticipo_efectivo_tipico:
  local (<200 km)        = 350
  regional (200–500 km)  = 700–900
  nacional (500–1,000 km)= 1,300–1,750
  larga (>1,000 km)      = 2,600
  (si la flota no tiene TAG, sumar casetas del corredor al efectivo)

mezcla_de_pago_del_gasto_de_viaje (flota >300 unidades):
  tarjeta combustible 68 % | TAG casetas 19 % | efectivo 13 %

estructura_de_costo_total (46 $/km, F6):  diésel 20 % (sube a 40–50 % según CANACAR 2026 si se mide sobre costo variable) |
  operador+viáticos 33 % | mantenimiento+llantas 22 % | depreciación+seguros+admón 22 % | casetas 4 %
tarifa_cliente            = 40 $/km + casetas (rango 36–48, F23);  costo Traxión 29.07, ingreso 33.88 (F9)

indicadores_por_defecto:
  pct_viajes_con_faltante = 18 %   pct_sobre_tope = 12 %   pct_sin_cfdi_efectivo = 30 %   pct_sin_cfdi_tarjeta = 12 %
  pct_casetas_efectivo = 8 %       dias_para_liquidar = 6  (meta 1.5)    desviacion_diesel = 6 % (meta 3 %)
viajes_por_unidad_mes     = 10 nacional (rango 8–16) | 30 regional/local
km_por_unidad_mes         = 7,000 nacional (rango 7,000–15,000); Traxión real 8,000 (F9)
```

### Tabla de 12 corredores (T3-S2 cargado, 5 ejes, ida)

| # | Corredor | km | Litros | Diésel $ | Casetas $ (C5) | Viáticos $ | Otros $ | Total gasto de viaje $ | Anticipo efectivo sugerido $ |
|---|---|---|---|---|---|---|---|---|---|
| 1 | MTY–CDMX | 901 | 347 | 9,367 | 2,750 | 1,200 | 541 | 13,858 | 1,750 |
| 2 | MTY–QRO | 704 | 271 | 7,319 | 1,750 | 900 | 422 | 10,391 | 1,300 |
| 3 | GDL–CDMX | 540 | 208 | 5,614 | 3,300 | 600 | 324 | 9,838 | 900 |
| 4 | CDMX–VER | 400 | 154 | 4,158 | 2,800 | 600 | 240 | 7,798 | 850 |
| 5 | VER–PUE | 280 | 108 | 2,911 | 1,850 | 600 | 168 | 5,529 | 750 |
| 6 | MID–CUN | 308 | 118 | 3,202 | 2,800 | 600 | 185 | 6,787 | 800 |
| 7 | CDMX–MID | 1,330 | 512 | 13,827 | 5,150 | 1,800 | 798 | 21,575 | 2,600 |
| 8 | NLD–MTY | 219 | 84 | 2,277 | 845 | 300 | 131 | 3,553 | 450 |
| 9 | SLP–MTY | 511 | 197 | 5,312 | 1,330 | 600 | 307 | 7,549 | 900 |
| 10 | GDL–MZT | 470 | 181 | 4,886 | 4,400 | 600 | 282 | 10,168 | 900 |
| 11 | TIJ–HMO | 867 | 333 | 9,013 | 1,750 | 1,200 | 520 | 12,483 | 1,700 |
| 12 | MTY–Saltillo (local) | 89 | 34 | 925 | 559 | 300 | 53 | 1,837 | 350 |

Redondeo sugerido en la UI: anticipos a múltiplos de 50; casetas a múltiplos de 10; litros enteros.

### Advertencias para quien presente la demo
1. El diésel es el 65–70 % del gasto de viaje, pero solo el 20 % del costo total por km (salario, mantenimiento y depreciación son el resto). No confundir ambos porcentajes frente a un contralor.
2. Las casetas en Occidente/Golfo/Península (6–9 $/km) pesan 2–3× más que en el eje norte (2–3 $/km); un panel que use 2 $/km se verá irreal para Guadalajara, Veracruz o Cancún.
3. Los viáticos y el % sin CFDI no tienen cifra pública: presentarlos como "parámetro configurable por política" y no como dato de mercado.
4. El estímulo IEPS cambia cada semana (65–76 % en agosto 2026); si la demo muestra precio de diésel, que sea editable.
