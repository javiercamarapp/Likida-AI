#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# Aplica el perfil `cinco_agentes` (mig. 0770) a UNA flota.
#
#   DATABASE_URL="postgres://..." scripts/perfil/aplicar-cinco-agentes.sh <UUID-del-tenant>
#   DATABASE_URL="postgres://..." scripts/perfil/aplicar-cinco-agentes.sh --verificar <UUID>   # solo lee, no escribe
#
# QUÉ HACE, en UNA transacción (todo o nada):
#   1. inserta (o actualiza) la fila de `tenant_perfil` con perfil = cinco_agentes;
#   2. apaga en `interruptor_tenant` los pipelines `ocr` y `cuadre` de esa flota, con motivo
#      (el código ya los trata como apagados bajo el perfil; la fila deja la palanca VISIBLE en /admin);
#   3. imprime el estado final.
#
# QUÉ NO HACE: no toca ninguna otra flota, no borra datos, no cambia usuarios ni llaves. Revertir:
# scripts/perfil/revertir-cinco-agentes.sh. Este script NO se ejecuta solo: lo corre quien opera la
# plataforma, contra la base que corresponda, DESPUÉS de aplicar la migración 0770 en esa base.
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail

SOLO_VERIFICAR=0
if [ "${1:-}" = "--verificar" ]; then SOLO_VERIFICAR=1; shift; fi

TENANT="${1:-}"
if [ -z "$TENANT" ]; then
  echo "Uso: DATABASE_URL=... $0 [--verificar] <UUID-del-tenant>" >&2
  exit 2
fi
# El UUID entra a SQL: solo se acepta con la forma exacta de un UUID (nada de comillas ni espacios).
if ! printf '%s' "$TENANT" | grep -Eq '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'; then
  echo "❌ '$TENANT' no es un UUID." >&2
  exit 2
fi
DB="${DATABASE_URL:-}"
if [ -z "$DB" ]; then
  echo "❌ Falta DATABASE_URL." >&2
  exit 2
fi
if ! command -v psql >/dev/null 2>&1; then
  echo "❌ Falta psql." >&2
  exit 2
fi

MOTIVO="Perfil cinco_agentes: la lectura de comprobantes y el cierre por WhatsApp no se usan en esta flota"

if [ "$SOLO_VERIFICAR" = "1" ]; then
  psql "$DB" -v ON_ERROR_STOP=1 -v tenant="$TENANT" <<'SQL'
select 'tenant' as que, id::text as valor, nombre from public.tenant where id = :'tenant';
select 'perfil' as que, perfil as valor, cambiado_en::text from public.tenant_perfil where tenant_id = :'tenant';
select 'pipeline' as que, pipeline as valor, case when apagado then 'APAGADO' else 'encendido' end as estado
  from public.interruptor_tenant where tenant_id = :'tenant' order by pipeline;
SQL
  exit 0
fi

# La flota tiene que existir (psql no interpola variables dentro de un bloque DO, así que se comprueba aquí).
EXISTE="$(psql "$DB" -v ON_ERROR_STOP=1 -v tenant="$TENANT" -tA <<'SQL'
select count(*) from public.tenant where id = :'tenant'::uuid;
SQL
)"
if [ "$EXISTE" != "1" ]; then
  echo "❌ La flota $TENANT no existe en esta base." >&2
  exit 3
fi

psql "$DB" -v ON_ERROR_STOP=1 -v tenant="$TENANT" -v motivo="$MOTIVO" <<'SQL'
begin;

insert into public.tenant_perfil (tenant_id, perfil, cambiado_por, cambiado_en)
values (:'tenant'::uuid, 'cinco_agentes', null, now())
on conflict (tenant_id) do update
  set perfil = excluded.perfil, cambiado_por = null, cambiado_en = now();

insert into public.interruptor_tenant (tenant_id, pipeline, apagado, motivo, cambiado_por, cambiado_en)
select :'tenant'::uuid, p, true, :'motivo', null, now()
  from unnest(array['ocr', 'cuadre']) as p
on conflict (tenant_id, pipeline) do update
  set apagado = true, motivo = excluded.motivo, cambiado_por = null, cambiado_en = now();

select 'perfil' as que, perfil as valor, cambiado_en::text from public.tenant_perfil where tenant_id = :'tenant'::uuid;
select 'pipeline' as que, pipeline as valor, case when apagado then 'APAGADO' else 'encendido' end as estado
  from public.interruptor_tenant where tenant_id = :'tenant'::uuid order by pipeline;

commit;
SQL
echo "✔ Perfil cinco_agentes aplicado. Se nota en la app en menos de un minuto (caché de 30 s)."
