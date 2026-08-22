-- ═══════════════════════════════════════════════════════════════════════════
-- 0146 — `gasto` bajo ve_finanzas() + los dominios que le faltaban al dinero
--        de `liquidacion` y a `gasto.ocr_confianza`
--        (auditoría 18: A15 ALTO, M11 MEDIO, M12 MEDIO). IDEMPOTENTE.
--
-- 1) A15 · `gasto` era la ÚLTIMA tabla de dinero fuera de ve_finanzas(). La
--    0144 alineó `liquidacion`; `gasto` se quedó con la `tenant_data` genérica
--    que la 0086 recreó: cualquier rol de oficina —incluido el `encargado`,
--    a quien visibilidad.ts le da solo ['operacion']— la leía y la ESCRIBÍA
--    por PostgREST con su propia sesión. Un POST /rest/v1/gasto con $40,000
--    de diésel en un viaje abierto pasaba todos los CHECK y el trigger de
--    liquidación, llegaba al cuadre, al 15% de RFA 2.9 y al PDF, y
--    `bitacora_auditoria` no tenía una sola fila porque nunca pasó por la app.
--    Misma policy que cliente/pago_recibido/factura_emitida (0048) y
--    liquidacion (0144).
--
--    EL WEBHOOK NO SE ENTERA, a propósito: el intake de WhatsApp escribe
--    `gasto` con `supabaseAdmin()` (repo.ts:143, service role), que salta RLS.
--    Lo mismo el cron de facturación (api/cron/facturar) y TODAS las lecturas
--    del panel (analytics.ts, fiscal.ts, pendientes.ts — verificado con grep:
--    ninguna consulta a `gasto` usa el cliente de sesión). El chofer no tiene
--    login desde la 0086, así que ningún camino legítimo de escritura pasa
--    por una sesión de `authenticated`.
--
-- 2) M11 · `total_comprobado`, `total_anticipo` y `diferencia` solo tenían el
--    CHECK de NaN (0025). La 0070 cerró `gasto.monto >= 0` mirando las
--    ENTRADAS del cuadre y no su SALIDA. Un PATCH {total_comprobado: -5000,
--    diferencia: 0} entraba, el gráfico semanal restaba $5,000 y el PDF
--    archivado decía otra cosa: dos cifras fiscales distintas del mismo viaje.
--    Se cierran los dos totales a >= 0 y se AMARRA la diferencia a la resta
--    que el motor hace (engine.ts:683, `diferencia = round2(anticipo -
--    totalComprobado)`), con un centavo de tolerancia igual que
--    `factura_total_cuadra` (0049). `diferencia` SÍ puede ser negativa: es el
--    caso en que el operador comprobó más que el anticipo.
--    Comprobado contra producción el 22-ago-2026: 5,723 liquidaciones,
--    0 totales negativos, 0 descuadres — las dos restricciones validan de
--    inmediato sin tocar una fila.
--
-- 3) M12 · `gasto.ocr_confianza` es numeric(4,3): admite −9.999..9.999. El
--    zod del intake lo acota a [0,1] (ocr.ts:63) pero un UPDATE de consola o
--    de reproceso entra. Con 9.999, `engine.ts:463` (`< umbral`) deja de
--    emitir `ocr_baja_confianza` y el viaje sale `cuadrada` en vez de
--    `revisar`. Su gemela `factura_proveedor.ocr_confianza` sí tiene el rango
--    desde la 0108. Producción: 0 filas fuera de [0,1].
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. A15: gasto gatea por rol financiero ──────────────────────────────────
drop policy if exists tenant_data on public.gasto;
drop policy if exists tenant_finanzas on public.gasto;
create policy tenant_finanzas on public.gasto
  for all
  using ((((tenant_id = any (get_user_tenant_ids())) and ve_finanzas()) or is_superadmin()))
  with check ((((tenant_id = any (get_user_tenant_ids())) and ve_finanzas()) or is_superadmin()));

comment on policy tenant_finanzas on public.gasto is
  'Dinero: solo ve_finanzas() (superadmin, flota_admin, contador). El encargado despacha, no factura (visibilidad.ts). El intake de WhatsApp y el cron escriben con service role y no pasan por aquí (0146, A15).';

-- ── 2. M11 + M12: los dominios ──────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'liquidacion_totales_no_negativos') then
    alter table public.liquidacion add constraint liquidacion_totales_no_negativos
      check (total_comprobado >= 0 and total_anticipo >= 0);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'liquidacion_diferencia_cuadra') then
    alter table public.liquidacion add constraint liquidacion_diferencia_cuadra
      check (abs(diferencia - (total_anticipo - total_comprobado)) <= 0.01);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'gasto_ocr_confianza_rango') then
    alter table public.gasto add constraint gasto_ocr_confianza_rango
      check (ocr_confianza is null or (ocr_confianza >= 0 and ocr_confianza <= 1));
  end if;
end $$;

comment on constraint liquidacion_diferencia_cuadra on public.liquidacion is
  'diferencia = total_anticipo - total_comprobado, al centavo (0146, M11). Es la resta que hace el motor (engine.ts:683); una fila que no la cumpla es "dos cálculos" sobre el mismo viaje. Negativa = se comprobó más que el anticipo, y eso es válido.';

comment on constraint gasto_ocr_confianza_rango on public.gasto is
  'ocr_confianza en [0,1] o NULL (0146, M12). Fuera de rango, `< umbral` del motor deja de marcar el comprobante como "conviene revisarlo a mano".';
