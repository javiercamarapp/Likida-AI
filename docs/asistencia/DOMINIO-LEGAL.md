# Dominio legal del siniestro en México — verificado en fuente oficial (23-ago-2026)

UMA 2026 = **$117.31** diarios (DOF 09-ene-2026, vigente desde 1-feb-2026). Todo el tabulador
sigue redactado en "días de salario mínimo" pero se lee en UMA por la desindexación de 2016.

## 1. La bomba comercial: ValorMercancia
`ValorMercancia` es **opcional para el SAT pero define la indemnización**. Sin valor declarado y
sin `PrimaSeguro`, el tope legal de responsabilidad del transportista es **15 UMA/tonelada =
$1,759.65/t** (Ley de Caminos art. 66 fr. V + cláusula DÉCIMA del Acuerdo DOF 16-12-2021).
Con valor declarado y prima pagada, responde por el total **incluso ante caso fortuito**.
→ Likida puede decirle a una flota, ANTES del siniestro: *"tus cartas porte no declaran valor;
si pierdes esta caja cobras $1,759 por tonelada"*. Es un aviso preventivo que nadie da.

Y de los campos de seguro del CFDI, **solo `AseguraRespCivil`/`PolizaRespCivil` son required**:
el seguro de CARGA (`AseguraCarga`/`PolizaCarga`) es **opcional** — justo el que importa cuando
se pierde la mercancía. El ambiental es condicional-obligatorio con material peligroso.

## 2. Siniestro/robo: el SAT ordena SUSTITUIR, no cancelar
Nuevo CFDI con `TipoRelacion` **04**, y **LUEGO** cancelar el original con motivo **01**.
Ese orden es obligatorio. (No hay respuesta específica del SAT para robo total con viaje iniciado.)
→ Flujo de producto directo: el agente de siniestros dispara la tarea de sustitución.

## 3. Los relojes que el software puede llevar (y hoy nadie lleva)
- **Materiales peligrosos**: aviso INMEDIATO + reporte formal a **SICT y SEMARNAT en ≤3 días
  hábiles** (RTTMRP art. 57 Bis). Omitirlo: hasta 500 UMA. Radiactivos → CONASENUSA.
- **PROFEPA** (derrames): aviso de inmediato (Regl. LGPGIR art. 130 fr. II) + formalización en
  **3 días hábiles**, trámite PROFEPA-03-017 modalidad B, con los 5 contenidos del art. 131.
  Ojo: el art. 129 NO aplica a transporte — carretera va por el 130. Y los arts. 68/69 LGPGIR
  son reparación/remediación, NO el aviso.
- **ASEA** (hidrocarburos/petrolíferos): Aviso Inmediato → **Informe Inicial 6 h si Tipo 3 /
  12 h si Tipo 2** → seguimiento c/12 h o c/24 h → **Informe de Cierre ≤10 días naturales**.
  Canal SIIA o reportes@asea.gob.mx. Art. 14 Sexies: en transporte no-ducto hay que anexar
  **copia de la Carta Porte** con origen y destino — el dato ya vive en Likida.
  Tipo 3 = >12 h sin operar, muerte, hospitalización o evacuación de población.
- **Pago de multa SICT**: 30 días hábiles desde que se fijó (Ley de Caminos art. 76); vencido,
  el vehículo se turna a la autoridad fiscal.
- **Seguro obligatorio**: si lo multan por circular sin póliza, tiene **45 días naturales** para
  contratarla y **se cancela la infracción** (art. 74 Bis fr. II).

**NO hay obligación del permisionario de carga de reportar accidentes a la SICT** salvo materiales
peligrosos. El deber general recae en el CONDUCTOR ("de inmediato a la autoridad más próxima"),
bajo pena de cancelación de licencia + 10 años de inhabilitación.

## 4. Directorio semilla verificado
- **SETIQ 800 002 1400** / 55 5559 1588 — ✅ triple fuente (ANIQ + GRE2024 + NOM-005 en DOF).
  24/7 desde 1991. La NOM-005-SCT/2008 OBLIGA a llevar ese teléfono a bordo. **SETIQ no tiene
  WhatsApp** (revisado todo el sitio de ANIQ: no existe evidencia oficial).
- **CENACOM 55 5128 0000** ext. 36428/36422/36469/37807/37810 (GRE2024, 2024).
  Los números de CENACOM que trae la NOM-005 están **OBSOLETOS**.
- **911 primero**, y CENACOM adicionalmente. 911 es la puerta de entrada a PC estatal/municipal
  (no hay número nacional único de Protección Civil).
- ⚠️ Sin verificar (gob.mx devuelve 403): el **088** de Guardia Nacional, el **078** de Ángeles
  Verdes, el 800 776 3372 de PROFEPA. **Verificar por teléfono antes de meterlos al directorio.**

## 5. Báscula y sobrepeso — el renglón 17 es acumulativo
| Exceso | UMA | Pesos 2026 |
|---|---|---|
| 50–500 kgf | 25–28 | $2,933–$3,285 |
| 501–2,000 kgf | 100–105 | $11,731–$12,318 |
| 2,001–3,000 kgf | 150–155 | $17,597–$18,183 |
| **>3,000 kgf, POR CADA 1,000 kgf o fracción** | **75–78** | **$8,798–$9,150 por tonelada** |

Un sobrepeso de 8 t ≈ **$70,386–$73,201**. Declaración FALSA del peso en la carta porte:
495–500 UMA = **$58,068–$58,655**. Caída de carga: $17,597 — pero redactada *a contrario*,
solo aplica "en causas distintas a un hecho de tránsito": si la carga cae POR el accidente, no aplica.

**Reincidencia** (Regl. de Peso art. 22): 1ª vez en 2 años → hasta el doble; 2ª vez → la SICT
**puede revocar el permiso**. Esto convierte el historial de multas en dato crítico de flota.

**Descuentos 2026** (Regl. de Tránsito art. 200, solo infracciones de TRÁNSITO): −25% si reconoce
la falta en la boleta, −25% adicional si paga en 15 días hábiles. No aplica al Tabulador de báscula.

## 6. La unidad detenida: no hay plazo máximo legal
La liberación está condicionada a HECHOS, no a tiempo. Exceso >10%: detenida hasta que baje la
carga. Materiales peligrosos: **no se detiene**, se conduce al origen o destino más cercano.
Del depósito: solo tras cubrir arrastre, salvamento y depósito.
**Palanca práctica — Ley de Caminos art. 76**: se puede GARANTIZAR el monto y que el vehículo se
entregue *"en depósito a su conductor o a su legítimo propietario"*. Y la carga siempre queda
disponible para trasbordo (Regl. Tránsito art. 218-A-III-b-2).
Impugnar el pesaje: NOM-012 §10.3.9 exige verificación anual de la báscula "o antes cuando haya
sospechas", más dictamen PROFECO vigente e informe de calibración. Es la vía técnica.

## 7. Contexto que casi nadie tiene
- La reforma **DOF 25-05-2026** al Reglamento de Tránsito encuadra el sobrepeso como falta de
  "condiciones mínimas de seguridad", habilitando retiro de circulación y depósito.
- La SICT despliega **arcos dinámicos** (placas + pesaje en movimiento) en ~10-12 puntos;
  la NOM-012 §9 ya la faculta a multar por detección automatizada.
- Autorregulación (báscula propia): fianza de 32,000 UMA = **$3,753,920**; rebasar 3 veces en un
  año suspende la autorización y ejecuta la fianza.

## Errores comunes que NO hay que cometer
Sujeción de carga es **NOM-015-SCT-2-2022**, no la NOM-051 (esa es de substancias infecciosas).
La verificación físico-mecánica es **anual**, no semestral. **No existe NOM-012-SCT-2-2024**.
La "actualización de catálogos Carta Porte de enero 2026" no existe (el archivo del SAT sigue
con fecha 13-12-2024).

---

# Segunda ronda: lo que cambia el diseño del producto (23-ago, verificado)

## Los cinco hechos que gobiernan el diseño
1. **La ventana real no es de 5 días, es de 30 MINUTOS.** La ley da 5 días para avisar a la
   aseguradora (LCS 66), pero las pólizas de flotilla exigen aviso a autoridades **en ≤30 min**
   desde que se detecta desviación de ruta por robo o accidente, y transmisión GPS **cada 3 min**.
   Un agente que optimiza para "avisar en 5 días" está construido sobre la métrica equivocada.
2. **El chofer puede perder su licencia 10 años por no hacer una llamada.** RAFSA art. 92 fr. II:
   se **cancela** la licencia federal si no da aviso de inmediato, no auxilia o abandona el
   vehículo — con **inhabilitación de 10 años**. Es la sanción individual más severa del marco
   y casi nadie la conoce.
3. **El 33% de los robos ocurre a unidades DETENIDAS** (Overhaul 2025; la intercepción en
   movimiento bajó de 76% a 64%). Traducción: **una ponchadura es un evento de seguridad, no sólo
   de mantenimiento.** El agente que atiende una avería atiende a la vez un riesgo de robo.
4. **Si el chofer firma un Acta-Convenio, compromete a la empresa** (Regl. Tránsito art. 185).
   El operador tiene la firma; el patrón tiene la factura.
5. Sin valor declarado, un tráiler con 20 t de electrónicos de $3M tiene responsabilidad legal de
   **~$35,000**: el 98.8% del valor no está cubierto por la responsabilidad del porteador.

## Los primeros 5 minutos — texto normativo, no buena práctica
**Avería o parada forzosa (arts. 82 y 154):** orillarse al acotamiento (multa 10-20 cuotas si no);
abanderar **30 m atrás, 30 m adelante** si es doble sentido, **+1 dispositivo a ≥3 m atrás** si el
vehículo mide más de 2 m de ancho (todo tractocamión), **30-150 m** si hay curva o cima cerca.
De día banderolas, de noche lámparas. **Con matpel: prohibido cualquier dispositivo de flama.**
**No abanderar: 40-50 cuotas ≈ $4,692-$5,866.** Equipo obligatorio (art. 49): 2 banderolas rojas
de 0.30 m por lado, 3 linternas rojas, 3 reflectantes, visibles a 180 m.

🔴 **Reloj oculto: 24 HORAS.** *"Los vehículos que se encuentren por más de 24 horas en las
condiciones a que se refiere el párrafo primero… serán remolcados al depósito permisionado"*
(art. 82). Una unidad varada más de 24 h se va al corralón. **Ese contador debe estar en el producto.**

**Accidente (arts. 183-184):** detenerse y **permanecer hasta que la autoridad tome conocimiento**
(multa 50-60 cuotas); prestar ayuda; abanderar; y **sólo después de que la GN determine la posición
final**, retirar los vehículos de la superficie de rodamiento.
⚠️ Matiz importante: "no mover la unidad hasta el ajustador" es práctica de seguros, **no ley**.
La regla correcta: *no muevas hasta que la autoridad documente la posición; a partir de ahí sí,
y fotografía la posición original*.

## Los contadores que el agente debe correr solo
| Contador | Dispara | Fuente |
|---|---|---|
| **30 min** desde desviación o robo | aviso a autoridades | póliza |
| **8 horas** de unidad con carga sin vigilancia por falla súbita | alerta de EXCLUSIÓN de póliza | Chubb |
| **12 horas** en siniestro de refrigerados | aviso obligatorio | GNP |
| **24 horas** desde entrega | última ventana para reclamar avería | Cód. Com. 593 |
| **24 horas** varado en acotamiento | riesgo de corralón | Regl. Tránsito 82 |
| **5 días** desde el siniestro | aviso por escrito a la aseguradora | LCS 66 |
| **5 días naturales** | certificación de averías de carga | GNP |
| **3 días hábiles** en matpel | SICT + SEMARNAT + PROFEPA | RTTMRP 57 Bis |
| **15 días hábiles** desde la boleta | pago con 25%+25% de descuento | Regl. Tránsito 200 |
| **15 días hábiles** desde el cobro de grúa | impugnar tarifa ante el Centro SICT | RAFSA 66C |
| **60 días** | comprobación de reclamación de carga | GNP |
| **60/90 días** desde aseguramiento por el MP | **evitar que la unidad cause abandono a favor del Gobierno** | CNPP 231 |

## Avisar tarde NO es perder el seguro (los tres niveles de la LCS)
- **Art. 67 — aviso tarde sin dolo → REDUCCIÓN** hasta lo que habría importado avisando a tiempo.
  Si el retraso no encareció el daño, la reducción es **cero**.
- **Art. 68 — omitir el aviso CON INTENCIÓN de impedir la comprobación → pérdida total.**
- **Art. 70 — mentir o alterar con ánimo de engañar → EXTINCIÓN.**
**La carga de probar la intención es de la aseguradora.** Consecuencia de producto: el agente
**no debe amenazar** con "pierdes el seguro si no avisas hoy" — es falso y erosiona confianza.
Debe decir la verdad: *avisar tarde puede recortar la indemnización; ocultar los hechos la cancela*.

## La asistencia vial de la póliza NO cubre lo que el transportista cree
Para tractocamión, texto literal de las pólizas: **paso de corriente NO** (>3.5 t), **cambio de
llanta NO**, **envío de combustible NO**. Grúa: 2-3 eventos/año, y **excluida** si el camión no
puede circular por daños de siniestro, tiene ponchadura o falta de combustible, requiere maniobras
o volcadura, **o va con carga**. GNP **excluye expresamente** remolque y semirremolque.
Lo que sí paga la grúa del accidente es otro renglón: **"Gastos de Traslado"**, y sólo *"siempre y
cuando el daño exceda del deducible contratado"*; el **traspaleo de la mercancía lo paga el
asegurado**, y *"la Compañía no se hará cargo mientras el vehículo no esté completamente liberado
por la autoridad"*.

🔴 **CAPUFE 074**: SLA publicado **20-90 min**, tope duro 90. Pero el auxilio gratuito aplica
*"siempre y cuando dichos vehículos no se hayan visto involucrados en hechos de tránsito"*.
**Si tu tracto chocó, la grúa gratuita no aplica** — sólo abanderamiento. No incluye asistencia
mecánica y el peaje del remolcado lo paga el usuario.
**Ángeles Verdes 078**: 8:00-18:00, **200 pickups**, mandato turístico. No cuentes con ellos para
un tracto.

## Los recargos de deducible: el riesgo más subestimado de una flotilla
| Agravante | Quálitas | HDI | GNP |
|---|---|---|---|
| **Siniestro entre 23:00 y 05:00** | **doble** | **doble**, mín. 10% | +5 puntos |
| Licencia **vencida** (no ausente) | doble (>5 t) | doble, mín. 10% | +5 puntos |
| Conductor <23 años en colisión o vuelco | doble, mín. 10% | doble, mín. 10% | +5 puntos |

**Una flotilla con 8% contratado en HDI paga 16% en un vuelco a las 2 a.m.** Para una operación que
rueda de noche por diseño, esto pesa más que la prima.
**Pérdida total: no hay umbral único** — GNP a ≥65% automático; Quálitas y AXA a >75%; HDI a ≥75%
sin opción. En un tracto de $2M son $200,000 de diferencia según dónde cae el umbral.

## Costos de grúa y salvamento (tabulador SICT)
Grúa tipo D: banderazo **$885.84**, **$32.35/km**, **salvamento $2,101.65/hora**, depósito
$106.63/día. ⚠️ Los PDF publicados tienen **fecha de creación 2020**: son piso normativo, no
precio de mercado.
🔴 **La puerta por donde se sale el costo real — RAFSA 66B**: las maniobras **fuera de la carpeta
asfáltica** son *"convenidas entre el usuario y el prestador"*. **Una volcadura a un barranco no
tiene tarifa máxima: es precio libre.** El permisionario debe hacer memoria descriptiva con firma
de consentimiento, y hay **15 días hábiles para impugnar** ante el Centro SICT (art. 66C), que
resuelve en 55 y ordena restituir el excedente. Casi nadie usa ese mecanismo.
Tiempo muerto: CANACAR estima **$12,000-$18,000 por día** de unidad detenida.

## El fuero: la creencia más extendida y más falsa
**Un accidente en carretera federal NO es automáticamente delito federal.** Lo determina la
naturaleza del delito, no el lugar (LOPJF art. 48 fr. I — ojo, muchas guías viejas citan el 50).
Muertos o lesionados entre particulares → **fuero COMÚN, fiscalía del estado**. Sólo van a la FGR
los daños a infraestructura federal, servidor público federal, o robo con delitos federales conexos.

🔑 **CNPP art. 239, el artículo que todo transportista debería memorizar**:
*"Tratándose de delitos culposos ocasionados con motivo del tránsito de vehículos, **estos se
entregarán en depósito a quien se legitime como su propietario o poseedor**."*
**La regla general no es la retención: es la entrega.** Y ofrecer facilidades para el peritaje de
la contraparte elimina el pretexto de la fracción III.
**El acuerdo reparatorio es la salida real** (CNPP 187 fr. II): procede en delitos culposos
**incluso con fallecidos**, y cumplido **extingue la acción penal**.

## Perfil del robo 2025-2026 (Overhaul)
**Centro 45-51% + Bajío 30-31% = ~80% nacional.** Edomex 19-21%, Puebla 13-17%.
Carreteras: **45D México-Querétaro-León 16%**, Federal 57 10%. La **150D** concentra 30% de robos
en vías federales, y dos tramos (Texmelucan–Amozoc y Amozoc–Esperanza) son el 70% de esa autopista.
**61% entre 19:00 y 07:00**; **83% entre semana.** Alimentos y bebidas 26-31%.
**8,246 unidades pesadas robadas** jul-2025 a jun-2026 (−13.6%), recuperación 61%, **79% con
violencia**. **>$1.2M promedio por robo** (CESVI).

## Advertencia metodológica sobre las causas
En colisiones donde la carga fue responsable, el factor conductor aparece en **91%** de los casos
y el vehículo en 9.8%. Pero **quien clasifica la causa es el elemento de la Guardia Nacional en el
lugar, sin peritaje mecánico**. Es más fácil anotar "imprudencia" que diagnosticar una falla de
llanta. **Trata el 4% de neumáticos como piso, no como techo.**
Y el IMT advierte que la base 2024 **no incluyó SLP ni Matehuala**, que vigilan el corredor
México–Nuevo Laredo: el corredor más importante del país está subrepresentado.

## Dos trampas de redacción que pueden matar
1. **La GRE2024 en español traduce *upwind* como "con viento a favor"**, que en México se entiende
   al revés. En un mensaje de WhatsApp hay que escribir explícito: *"colócate de modo que el viento
   venga de tu espalda hacia el derrame"*.
2. **"Daños por la Carga"** en una póliza de camión **no cubre la mercancía**: cubre la
   responsabilidad civil por daños a terceros *causados con* la carga. Confunde a todo el gremio.

## Distancias GRE2024 verificadas
UN1203 gasolina: aislar 50 m; **incendio: 800 m a la redonda**. UN1075 gas LP: aislar 100 m;
**incendio 1,600 m — riesgo BLEVE**. UN1017 cloro en autotanque: **aislar 600 m**, proteger a
sotavento **5.8 km de día / 6.7 km de noche**. Derrame pequeño = ≤208 L. Si se libera todo de
golpe, **las distancias se duplican**. **El operador NO ordena evacuación pública**: aísla y alerta;
la orden la da Protección Civil municipal.

## El cadenamiento es el idioma de la autoridad
La GN y CAPUFE operan sobre cadenamiento, y el IMT georreferencia a **segmentos de 500 m**.
Un operador que reporta *"km 142+500, cuerpo A, sentido Querétaro–SLP"* reduce el tiempo de llegada
mucho más que uno que dice "por la curva grande". **El agente debe convertir GPS a cadenamiento
automáticamente.**

## Huecos que quedaron abiertos (no codificar sin confirmar)
SLA de llegada de ajustador por aseguradora (sólo existe el de CAPUFE) · precios de mercado 2025-26
de grúa para tracto · costo de custodia y umbral de valor que la exige · montos vigentes del seguro
ambiental de matpel · **si el art. 66 fr. V de la LCPAF se lee en UMA o en salario mínimo — la
diferencia es $1,759.65 vs $4,725.60 por tonelada, y hay litigio** · formato oficial del aviso del
57 Bis · teléfonos de PROFEPA y el 088.
