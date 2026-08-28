-- ═══════════════════════════════════════════════════════════════════════════
-- 0242 — LOS LITROS DEL CONSOLIDADO: DOMINIO Y EL ÍNDICE DE LA REGLA 3.3.1.7
--
-- Aditiva sobre lo que la 0168 ya construyó (`cfdi_consolidado_linea.litros`
-- y `.clave_prod_serv`, Fase 1 del plan de cierre del ciclo). No crea tablas
-- ni columnas: pone un dominio donde no lo había y un índice donde el camino
-- caliente ya estaba haciendo un escaneo.
--
-- ── 1. `litros >= 0` — POR QUÉ UN CHECK Y NO UNA CONVENCIÓN ────────────────
--
-- `litros numeric(12,3)` admite hoy `-450.000`. Un litro negativo no existe:
-- no es "una devolución" (eso lo ampara una nota de crédito, que es OTRO
-- CFDI, con su propio UUID), es una lectura rota. Y el daño no se queda en la
-- fila: `ligarLineaAGasto` copia ese número a `gasto.ocr_extra.litros`, y de
-- ahí `engine.ts` lo suma a `litrosDieselAcreditables` — la cifra que el
-- contador multiplica por la cuota del DOF para acreditar el estímulo de la
-- LIF 2026 art. 20 ap. A. Un negativo entre las líneas del mes RESTA litros
-- que sí se cargaron, en silencio y sin diferencia que lo diga.
--
-- El motor tiene su propio guardia (`litros > 0` antes de acumular), pero eso
-- protege el cálculo de HOY, no la columna: cualquier reporte, export o
-- consulta futura que sume `cfdi_consolidado_linea.litros` heredaría el
-- negativo. La disciplina de la 0025 aplica igual aquí — el dominio va en la
-- base, no en el `if` que se acuerde de ponerlo.
--
-- `null` sigue permitido y SIGNIFICA ALGO: "esta línea no midió volumen"
-- (una caseta, un cargo administrativo). `null` ≠ 0 — ver `litrosDeLinea` en
-- `intake/consolidado.ts`, que es quien decide cuándo la `Cantidad` de una
-- línea son litros y cuándo es un cruce de caseta.
--
-- `not valid` NO se usa: la tabla tiene 0 filas fuera de dominio (no hay
-- clientes con consolidados en producción todavía) y validar de una vez deja
-- la restricción REALMENTE en vigor en lugar de solo para las filas nuevas.
-- Si alguna base tuviera un negativo, este ALTER truena ruidoso — que es lo
-- que se quiere: una cifra de estímulo negativa hay que verla, no heredarla.
--
-- ── 2. EL ÍNDICE DE `evidenciaMonedero`, CAMINO B (RMF 3.3.1.7) ───────────
--
-- La Fase 2 cableó la regla 3.3.1.7 al motor: un ticket de bomba cuyo cargo
-- aparece en una línea del estado de cuenta del monedero (mismo día, misma
-- estación, mismo monto) NO es un comprobante fiscal — la gasolinera tiene
-- PROHIBIDO facturar esa carga. Para saberlo, `desde_db.ts` consulta
-- `cfdi_consolidado_linea` EN CADA CUADRE, dentro del presupuesto de
-- `COSTO_AGENTE_MS` del webhook de WhatsApp.
--
-- Los índices que dejó la 0076 son `(tenant_id, created_at) where estatus =
-- 'por_conciliar'` y `(cfdi_xml_id)`. Ninguno sirve a ese WHERE: la consulta
-- filtra por `tenant_id` + rango de `fecha`, sin mirar `estatus` (una línea
-- ya conciliada sigue siendo evidencia de que la carga se pagó con monedero)
-- y sin `cfdi_xml_id`. Resultado hoy: escaneo de toda la cola de líneas del
-- tenant —incluidas las casetas de un consolidado de TAG, que son la mayoría
-- del volumen— para quedarse con las de un mes.
--
-- El índice es PARCIAL con el predicado exacto del camino B, el mismo que
-- `lineasEccParaCuadre` ahora escribe en el WHERE: solo `ecc12` trae
-- `estacion_rfc` y `fecha` por transacción (el estándar CFDI 4.0 no da fecha
-- por concepto base — ver `cfdi_xml.ts`), así que una línea sin RFC de
-- estación NUNCA puede ganar el camino B y no tiene por qué ocupar el índice.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Dominio de `litros` ────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.cfdi_consolidado_linea'::regclass
       and conname = 'cfdi_consolidado_linea_litros_no_negativos'
  ) then
    alter table public.cfdi_consolidado_linea
      add constraint cfdi_consolidado_linea_litros_no_negativos
      check (litros is null or litros >= 0);
  end if;
end $$;

comment on column public.cfdi_consolidado_linea.litros is
  'Litros de la linea CUANDO la Cantidad del comprobante es volumen: ecc12 siempre (Estado de Cuenta de COMBUSTIBLES), concepto_base solo con clave 15101xx. NULL = no se midio volumen (una caseta trae Cantidad=1 y eso es UN CRUCE, no un litro) — ver litrosDeLinea en intake/consolidado.ts. Nunca negativo (0242): un negativo restaria litros realmente cargados del estimulo de la LIF 2026 art. 20 ap. A.';

-- ── 2. El índice del camino B de evidenciaMonedero (RMF 3.3.1.7) ──────────
create index if not exists cfdi_consolidado_linea_ecc_por_fecha_idx
  on public.cfdi_consolidado_linea (tenant_id, fecha)
  where fuente = 'ecc12' and estacion_rfc is not null;

comment on index public.cfdi_consolidado_linea_ecc_por_fecha_idx is
  'Camino B de evidenciaMonedero (RMF 3.3.1.7): lineas ECC del tenant en la ventana de fechas de los gastos. Predicado identico al WHERE de lineasEccParaCuadre en cuadre/desde_db.ts — corre en cada cuadre, dentro del presupuesto del webhook.';
