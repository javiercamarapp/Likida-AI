#!/usr/bin/env bash
# Migraciones 0770–0809 (cinco agentes): contrato de reaplicación y de orden, contra un PostgreSQL desechable que YA tiene
# todas las migraciones aplicadas (corre después del paso «Migraciones (todas, sobre base virgen)»).
#   (1) IDEMPOTENCIA: cada migración del rango se vuelve a aplicar tal cual (psql -f, ON_ERROR_STOP) sin error;
#   (2) SIN EFECTOS: la huella del catálogo `public` (columnas, índices, restricciones, políticas, triggers, funciones)
#       es idéntica antes y después de reaplicar TODO el rango — reaplicar no duplica políticas, ni restricciones, ni
#       cambia una función; si una migración redefine algo distinto en la segunda corrida, la huella lo delata;
#   (3) ORDEN DE FUNCIONES: ninguna función creada en el rango 0770–0809 la vuelve a crear (CREATE FUNCTION) una
#       migración con prefijo MAYOR (hacerlo borraría en producción las guardas de la versión más nueva si la
#       migración vieja se aplicara después). Estático, sobre los archivos.
# Exclusivo PostgreSQL desechable. No crea datos.
set -euo pipefail
host="${1:?uso: $0 HOST PORT DB}"
port="${2:?uso: $0 HOST PORT DB}"
database="${3:?uso: $0 HOST PORT DB}"
raiz="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
psql_cmd=(psql -h "$host" -p "$port" -d "$database" -X -v ON_ERROR_STOP=1 -qAt)

# (sin mapfile: bash 3.2 de macOS no lo trae; los nombres de migración no llevan espacios)
rango=($(cd "$raiz/supabase/migrations" && ls -1 [0-9][0-9][0-9][0-9]_*.sql | awk '{ p = substr($0, 1, 4); if (p >= "0770" && p <= "0809") print }'))
[[ "${#rango[@]}" -ge 1 ]] || { echo '0809: no hay migraciones en el rango 0770–0809'; exit 1; }

huella() {
  "${psql_cmd[@]}" <<'SQL'
select md5(string_agg(x, E'\n' order by x)) from (
  select 'col ' || table_name || '.' || column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '') as x
    from information_schema.columns where table_schema = 'public'
  union all select 'idx ' || indexdef from pg_indexes where schemaname = 'public'
  union all select 'con ' || conrelid::regclass::text || ' ' || conname || ' ' || pg_get_constraintdef(oid)
    from pg_constraint where connamespace = 'public'::regnamespace
  union all select 'pol ' || tablename || ' ' || policyname || ' ' || cmd || ' ' || coalesce(qual, '') || ' ' || coalesce(with_check, '')
    from pg_policies where schemaname = 'public'
  union all select 'trg ' || tgrelid::regclass::text || ' ' || tgname || ' ' || pg_get_triggerdef(oid)
    from pg_trigger where not tgisinternal and tgrelid in (select oid from pg_class where relnamespace = 'public'::regnamespace)
  union all select 'fn ' || p.oid::regprocedure::text || ' ' || md5(pg_get_functiondef(p.oid))
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p')
) t;
SQL
}

antes="$(huella)"
for f in "${rango[@]}"; do
  if ! "${psql_cmd[@]}" -f "$raiz/supabase/migrations/$f" >/dev/null 2>"${TMPDIR:-/tmp}/0809_reaplicar.err"; then
    echo "0809: la migración $f NO se puede reaplicar:"; cat "${TMPDIR:-/tmp}/0809_reaplicar.err"; exit 1
  fi
done
despues="$(huella)"
[[ "$antes" = "$despues" ]] || { echo "0809: reaplicar el rango cambió el catálogo (antes $antes, después $despues)"; exit 1; }

# (3) orden de funciones
fallo=0
for f in "${rango[@]}"; do
  pf="${f:0:4}"
  while read -r fn; do
    [[ -n "$fn" ]] || continue
    for g in $(cd "$raiz/supabase/migrations" && ls -1 [0-9][0-9][0-9][0-9]_*.sql); do
      pg="${g:0:4}"
      [[ "$pg" > "$pf" ]] || continue
      if grep -Eiq "create[[:space:]]+(or[[:space:]]+replace[[:space:]]+)?function[[:space:]]+(public\.)?\"?${fn}\"?[[:space:]]*\(" "$raiz/supabase/migrations/$g"; then
        echo "0809: la función $fn (de $f) la redefine la migración $g, de prefijo mayor"; fallo=1
      fi
    done
  done < <(grep -Eio "create[[:space:]]+(or[[:space:]]+replace[[:space:]]+)?function[[:space:]]+(public\.)?\"?[a-z_0-9]+" "$raiz/supabase/migrations/$f" | sed -E 's/.*[[:space:]."]([a-z_0-9]+)$/\1/' | sort -u)
done
[[ "$fallo" = 0 ]] || exit 1
echo "0809_REAPLICABLES_OK (${#rango[@]} migraciones)"
