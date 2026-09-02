-- ═══════════════════════════════════════════════════════════════════════════
-- 0278 · EL TECHO DIARIO DE IA ES POR FLOTA: `tenant.config.presupuestoLlmUsdDia`
--
-- AUDITORÍA 24, TC-N1 / WA-1 / OP-P7 (CRÍTICO). Hasta hoy el techo diario de
-- gasto de IA era UNA variable de entorno (`LIKIDA_LLM_TENANT_DAILY_BUDGET_USD`,
-- $5.00) para TODAS las flotas. Con el tráfico del piloto (500 viajes y 1,500
-- fotos al día en una sola flota, ~$27/día medidos con `COSTO_ESTIMADO_USD`)
-- el tope caía a media mañana y cada «listo» y cada foto rebotaban el resto
-- del día; y subir la env a $60 para salvar el piloto subía el techo de todas
-- las flotas: el freno de dinero dejaba de ser freno.
--
-- `llm/budget.ts` (`topeDiarioDelTenant`) lee ahora, en este orden, el techo
-- de la flota: (1) esta llave, (2) el derivado de `plan.limite_viajes_mes`,
-- (3) el piso global. Esta migración hace UNA sola cosa: que la llave QUEPA en
-- `tenant.config` y que, si está, sea un número mayor que cero.
--
-- El CHECK `tenant_config_valida` rechaza cualquier llave que
-- `config_tenant_valida` (0026, redefinida hasta la 0085) no conozca — es la
-- regla 2 de esa función, y es correcta: una llave mal escrita se guarda, no
-- la lee nadie, y la flota corre con los topes de demo creyendo que corre con
-- los suyos. Se resuelve EXACTAMENTE como la 0159 resolvió `agentes`: no se
-- reescriben las 200 líneas de reglas de dinero de `config_tenant_valida`
-- para tocar un array; se recrea el CHECK validando la config SIN esta llave
-- (y sin `agentes`, que sigue con su validador propio) y se agrega un CHECK
-- propio para la llave nueva. Si alguna migración futura recrea
-- `tenant_config_valida` sin el `- 'presupuestoLlmUsdDia'`, la llave vuelve a
-- rebotar y el bloque 225 de verificaciones.sql lo grita — el mismo trato que
-- el bloque 131 le da a `agentes`.
--
-- Idempotente: `create or replace` para la función; el DO recrea el CHECK
-- solo si su definición todavía no excluye la llave, y agrega el CHECK nuevo
-- solo si no existe.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.config_presupuesto_llm_valida(p_valor jsonb)
returns boolean
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v numeric;
begin
  if p_valor is null or p_valor = 'null'::jsonb then
    return true;   -- sin llave: el techo sale del plan o del piso (budget.ts)
  end if;

  if jsonb_typeof(p_valor) <> 'number' then
    raise exception
      'tenant.config->presupuestoLlmUsdDia tiene que ser un número (USD por día) y llegó %. budget.ts ignora cualquier otra cosa y la flota corre con el techo del plan o el piso creyendo que corre con el suyo.',
      jsonb_typeof(p_valor);
  end if;

  v := (p_valor #>> '{}')::numeric;
  if v <= 0 then
    raise exception
      'tenant.config->presupuestoLlmUsdDia vale % y tiene que ser mayor que cero. Un techo de cero apaga la IA de la flota entera (cada «listo» y cada foto rebotan); si eso es lo que quieres, usa el kill switch, que lo dice por su nombre.',
      v;
  end if;

  return true;
end $$;

comment on function public.config_presupuesto_llm_valida(jsonb) is
  'Valida tenant.config->presupuestoLlmUsdDia (techo diario de IA de la flota, USD; auditoría 24 TC-N1/WA-1). Existe porque config_tenant_valida no conoce esa llave y la rechazaría entera — mismo patrón que config_agentes_valida (0159).';

do $$
begin
  -- El CHECK de siempre, apuntando a la config SIN `agentes` (0159) y SIN
  -- `presupuestoLlmUsdDia` (esta). Se recrea solo si todavía no excluye la
  -- llave nueva.
  if exists (
    select 1 from pg_constraint
     where conname = 'tenant_config_valida' and conrelid = 'public.tenant'::regclass
       and pg_get_constraintdef(oid) not like '%presupuestoLlmUsdDia%'
  ) then
    alter table public.tenant drop constraint tenant_config_valida;
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'tenant_config_valida' and conrelid = 'public.tenant'::regclass
  ) then
    alter table public.tenant
      add constraint tenant_config_valida
      check (config is null or public.config_tenant_valida(config - 'agentes' - 'presupuestoLlmUsdDia'));
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'tenant_config_presupuesto_llm_valida' and conrelid = 'public.tenant'::regclass
  ) then
    alter table public.tenant
      add constraint tenant_config_presupuesto_llm_valida
      check (config is null or public.config_presupuesto_llm_valida(config -> 'presupuestoLlmUsdDia'));
  end if;
end $$;

comment on constraint tenant_config_presupuesto_llm_valida on public.tenant is
  'presupuestoLlmUsdDia, si está, es un número > 0 (USD/día). Lo lee llm/budget.ts con prioridad sobre el plan y la env global (auditoría 24, TC-N1/WA-1, mig. 0278).';
