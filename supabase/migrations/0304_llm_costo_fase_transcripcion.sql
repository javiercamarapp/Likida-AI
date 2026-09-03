-- ═══════════════════════════════════════════════════════════════════════════
-- AUDITORÍA 25 · DATOS-A1 (ALTO) — `transcripcion` entra al dominio de fases.
--
-- `llm_costo_fase_dominio` se creó en 0025:146-147 con SEIS fases y ninguna
-- migración posterior lo recreó (`grep -rn llm_costo_fase_dominio
-- supabase/migrations` → solo esas dos líneas). El tipo de TS tiene SIETE desde
-- el 29-ago-2026: `FaseCosto` (costos.ts:41) agregó `'transcripcion'` con la
-- función de nota de voz, y nadie tocó la base.
--
-- Lo que pasaba, medido: el chofer manda una nota de voz → `processor.ts:1563`
-- → `transcribirNotaDeVoz` transcribe y liquida ~$0.0021 USD →
-- `voz_transcrita.ts:117-120` llama `registrarCosto({fase:'transcripcion'})` →
-- el INSERT rebota con 23514 `llm_costo_fase_dominio`. `registrarCosto` es
-- best-effort a propósito: no lanza, escribe `costo.no_registrado` y sigue. La
-- liquidación cierra normal porque el viaje sí tiene filas de `ocr` y `cuadre`,
-- así que **nada visible falla** y el costo simplemente no existe.
--
-- Por qué importa más de lo que parece: Likida cobra por liquidación y el costo
-- unitario es la cifra con la que se fija el precio (`BANDA_COSTO_VIAJE_USD =
-- 0.037`, `finanzas.ts:181`). Cada nota de voz gasta modelo y ninguna entra a
-- la medición: `/admin/consumo` y el parte de control de costos salen
-- sistemáticamente bajos. Es exactamente el modo de falla que la cabecera de
-- `costos.ts:6-14` dice existir para impedir — «un costo no registrado tiene
-- que verse distinto de un costo bajo». Y `ROL_POR_FASE` (`finanzas.ts:170-176`)
-- mapea `transcripcion` para el chequeo U1 del agente de costos, un chequeo
-- **insatisfacible por construcción** mientras no pueda existir la fila.
--
-- La ironía que vale dejar escrita: el comentario de la propia 0025 advierte de
-- este error («son SEIS, no las cinco del comentario de 0003 — tomar el dominio
-- del comentario viejo habría roto el registro de costos») y aun así volvió a
-- pasar, porque nada CRUZA el tipo de TS contra el CHECK. Esta migración cierra
-- el hueco de hoy; la prueba que entra con ella (`costos_dominio.test.ts`) es la
-- que impide que vuelva a abrirse: falla en rojo en cuanto `FaseCosto` y este
-- constraint dejen de decir lo mismo.
--
-- Mismo mecanismo que 0044/0086/0105 sobre `app_user_rol_dominio`: soltar el
-- constraint si existe y recrearlo con la lista COMPLETA. Idempotente.
--
-- Las filas ya perdidas no se recuperan: rebotaron en el INSERT y no quedó
-- rastro más que la línea `costo.no_registrado` del log. La medición del costo
-- de voz empieza a existir a partir de aquí, no hacia atrás.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'llm_costo_fase_dominio' and conrelid = 'public.llm_costo'::regclass
  ) then
    alter table public.llm_costo drop constraint llm_costo_fase_dominio;
  end if;

  alter table public.llm_costo
    add constraint llm_costo_fase_dominio
    check (fase in ('ocr', 'cuadre', 'escalacion', 'chat', 'router', 'whatsapp', 'transcripcion'));
end $$;

comment on constraint llm_costo_fase_dominio on llm_costo is
  'Espeja FaseCosto (src/lib/likida/costos.ts). Seis fases en 0025; transcripcion agregada en 0304 (auditoria 25, DATOS-A1): estaba en TS desde el 29-ago-2026 y el CHECK la rechazaba, asi que el costo de cada nota de voz se descartaba en silencio. costos_dominio.test.ts cruza las dos listas y falla si divergen.';
