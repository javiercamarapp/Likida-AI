# ¿Está cerrado el back office? — mapa de cobertura (23-ago-2026)

Base: 84 tablas en 163 migraciones, ~33 pantallas de /dashboard, 47 de /admin, 58 agentes
definidos (10 vivos), corpus docs/conocimiento.

## VEREDICTO
**No está cerrado. Está cerrado el CICLO DEL GASTO DEL VIAJE — aproximadamente la mitad — y
ahí está mejor que cualquier competidor.** Falta la otra mitad: el ACTIVO (mantenimiento,
llantas, rendimiento), el RIESGO (seguros y siniestros), la GENTE (nómina, jornada) y el
CIERRE (contabilidad, tesorería, cobranza al cliente).

## Completo hoy
Liquidación y comprobación · deducibilidad ISR/IVA/IEPS · tope 15% combustible (RFA 2.9) ·
estímulo de peaje e IEPS diésel · conciliación TAG/monedero por archivo · cuentas por pagar
(agente proveedores por correo) · cobranza de comprobantes al chofer · vigencias de unidad y
licencias · talacha autorizada por WhatsApp · ARCO · **deducible ≠ pagadero (LFT 263), único
en el mercado**.

## Parcial
Facturación a clientes (captura sí, timbrado no — decisión correcta, el PAC es de la flota) ·
Carta Porte 3.1 (valida, no emite) · cobranza a clientes (hay cartera, nadie persigue) ·
despacho · incidencias · rentabilidad (es CONTRIBUCIÓN, no utilidad: no resta sueldo,
mantenimiento, llantas, seguro ni depreciación) · cotización · rastreo · tickets · export contable.

## Nada
Mantenimiento preventivo · llantas · refacciones · **nómina del operador** · exámenes médicos ·
**seguros y siniestros** · **rendimiento km/l y ordeña de diésel** · tesorería y conciliación
bancaria · contabilidad electrónica, póliza, DIOT · custodia · registro de jornada (obligatorio
1-ene-2027) · sindicato.

## DOS CORRECCIONES a lo que creíamos
1. **`posicion` SÍ tiene escritor**: `processor.ts:132` inserta el pin de WhatsApp. CLAUDE.md
   está desactualizado. Siguen sin escritor: geocerca, terminal, mantenimiento, cotizacion,
   portal_credencial, invitacion. (`ticket_mensaje` dejó de estar en esta lista el
   29-ago-2026: la 0268 + `lib/likida/soporte.ts` cierran el ciclo del ticket.)
2. **La asistencia en carretera NO falta entera**: `talacha_wa.ts` (mig. 0107) ya cierra el
   circuito de avería mecánica. Lo que falta es el SINIESTRO: accidente, robo, aseguradora,
   ajustador. `incidencia.tipo` ni siquiera admite el valor.

## LOS 48 "DISEÑADOS" SON EL ORGANIGRAMA DE LIKIDA, NO DEL PRODUCTO
Cazador de censo, SDR, propuestas, contenido, video, tesorería *de Likida*, fundraising…
**Ninguno cierra un hueco del back office de la transportista.** El único de departamento
`producto` es `experto_fiscal` (vigilancia DOF) y ese sí vale encender.
Y "encender" no es cambiar una fila: **el runner tiene UNA sola rama cableada**
(`if (a.id === 'redactor')`, agentes/runner.ts:178). El catálogo declara 58; el ejecutor sabe 1.

## LOS 5 AGENTES QUE CIERRAN EL BACK OFFICE
Ninguno requiere integración externa dura en su v1. Todos viven sobre datos que ya entran por WhatsApp.

1. **Siniestros y Seguros** — el que el dueño siente más caro. Deducible ~20% sobre unidad de
   ~$7M; la aseguradora paga a 30 días DESDE documentación completa, y armarla es lo que tarda.
   Likida ya tiene fecha, hora, geolocalización y fotos: **es el expediente que el asegurador pide.**
   Reusa talacha_wa.ts entero. Necesita tablas `poliza` y `siniestro` + ampliar incidencia_tipo.
2. **Rendimiento de Combustible** — el dolor #1 del sector y la extensión más barata.
   Combustible = 30-50% del costo; una ordeña de 300 L son ~$8,000 de una unidad. El ticket YA
   trae litros en ocr_extra, y ya existen unidad.km_actual y viaje.km_recorridos. Falta el cruce
   km/l y la anomalía. Nadie en el mapa de competencia lo hace completo.
3. **Mantenimiento y Llantas** — el correctivo cuesta 3x a 55x el preventivo. La tabla
   `mantenimiento` ya está aplicada (tipo, km de servicio, coherencia de cierre): **solo le falta
   escritor y motor de plan por kilometraje.** Llantas necesita tabla nueva.
4. **Cierre Contable** (póliza, DIOT, conciliación) — es el destino de cada comprobante que
   Likida ya procesa. RCFF 33-B-I exige asentar **en 5 días**: convierte la velocidad en argumento
   legal. Requiere el layout real de una flota (uno adivinado no falla ruidosamente, ensucia).
5. **Cobranza a Clientes** — 53 a 90 días de plazo; el factoraje cuesta 1-30%. Es el gemelo del
   agente de cobranza que ya funciona, apuntado al cliente. **El más barato de los cinco.**

Después: nómina del operador (alto valor, alto riesgo legal), registro de jornada (1-ene-2027,
hitos_viaje ya sella horas), tiempos de espera en carga/descarga, y costo por kilómetro — el día
que exista, libro_viaje.ts podrá decir "utilidad" en vez de "contribución".

## LO QUE NO SE DEBE CONSTRUIR
Timbrado de CFDI (es otro negocio con otra licencia) · GPS en tiempo real y custodia (la flota ya
paga proveedor; integrar por credencial) · ERP contable completo (integrar por layout, nunca
replicar) · TMS de rutas y torre de control · reclutamiento de operadores (vive en RH).
