#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# Quita el perfil `cinco_agentes` (mig. 0770) de UNA flota y vuelve a encender los pipelines `ocr` y `cuadre`
# que `aplicar-cinco-agentes.sh` apagó.
#
#   DATABASE_URL="postgres://..." scripts/perfil/revertir-cinco-agentes.sh <UUID-del-tenant>
#
# SOLO borra las filas que puso el perfil: la de `tenant_perfil` y las de `interruptor_tenant` (ocr, cuadre) cuyo motivo
# empieza con «Perfil cinco_agentes». Si alguien apagó `ocr` o `cuadre` por otra razón, esa palanca NO se toca.
# La flota recupera el comportamiento de siempre. No borra datos de la flota. Este script NO se ejecuta solo.
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail

TENANT="${1:-}"
if [ -z "$TENANT" ]; then
  echo "Uso: DATABASE_URL=... $0 <UUID-del-tenant>" >&2
  exit 2
fi
if ! printf '%s' "$TENANT" | grep -Eq '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'; then
  echo "❌ '$TENANT' no es un UUID." >&2
  exit 2
fi
DB="${DATABASE_URL:-}"
if [ -z "$DB" ]; then echo "❌ Falta DATABASE_URL." >&2; exit 2; fi
if ! command -v psql >/dev/null 2>&1; then echo "❌ Falta psql." >&2; exit 2; fi

psql "$DB" -v ON_ERROR_STOP=1 -v tenant="$TENANT" <<'SQL'
begin;

delete from public.interruptor_tenant
 where tenant_id = :'tenant'::uuid
   and pipeline in ('ocr', 'cuadre')
   and motivo like 'Perfil cinco_agentes%';

delete from public.tenant_perfil where tenant_id = :'tenant'::uuid;

select 'perfil' as que, count(*)::text as valor from public.tenant_perfil where tenant_id = :'tenant'::uuid;
select 'pipeline' as que, pipeline as valor, case when apagado then 'APAGADO' else 'encendido' end as estado
  from public.interruptor_tenant where tenant_id = :'tenant'::uuid order by pipeline;

commit;
SQL
echo "✔ Perfil cinco_agentes revertido. La flota vuelve al comportamiento de siempre en menos de un minuto."
