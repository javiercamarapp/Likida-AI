#!/usr/bin/env bash
# Seis sesiones reales compiten por reclamar EL MISMO documento de Carta Porte (0420), para 30 documentos.
# Cada documento lo reclama EXACTAMENTE una sesión (intentos = 1, versión = 2): ni dos extracciones ni dos pagos al modelo.
# Exclusivo PostgreSQL desechable; UUIDs y objetos sintéticos propios.
set -euo pipefail
host="${1:?uso: $0 HOST PORT DB}"
port="${2:?uso: $0 HOST PORT DB}"
database="${3:?uso: $0 HOST PORT DB}"
tenant='42000000-0000-4000-8000-0000000c0001'
documentos=30
sesiones=6
psql_cmd=(psql -h "$host" -p "$port" -d "$database" -X -v ON_ERROR_STOP=1 -qAt)
work="$(mktemp -d)"
limpiar() {
  "${psql_cmd[@]}" -c "delete from public.tenant where id='$tenant';" >/dev/null 2>&1 || true
  rm -rf "$work"
}
[[ "$("${psql_cmd[@]}" -c "select count(*) from public.tenant where id='$tenant';")" = 0 ]] || { echo 'Fixture0420 ya existe; no tocar datos ajenos.'; exit 1; }
trap limpiar EXIT
"${psql_cmd[@]}" <<SQL
insert into public.tenant(id,nombre) values('$tenant','Carta Porte 0420 claim concurrente');
insert into public.cp_documento(id, tenant_id, canal, formato, nombre_archivo, bytes, sha256)
select ('42000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, '$tenant', 'manual', 'pdf_texto', 'doc-' || n || '.pdf', 10,
       md5(n::text) || md5((n + 1000)::text)
from generate_series(1, $documentos) n;
SQL

# Una sesión se queda un momento con el documento tomado (dentro de su transacción) para que las demás lo encuentren ocupado.
sesion() {
  local doc="$1" n="$2"
  "${psql_cmd[@]}" -c "begin; select count(*) from public.cp_documento_reclamar('$tenant', '$doc', 120); select pg_sleep(0.05); commit;" | head -1 > "$work/${doc}.$n"
}
# Seis sesiones a la vez POR documento; los documentos van en serie (180 conexiones simultáneas saturan el socket).
for d in $(seq 1 "$documentos"); do
  doc="42000000-0000-4000-8000-$(printf '%012d' "$d")"
  pids=()
  for n in $(seq 1 "$sesiones"); do sesion "$doc" "$n" & pids+=($!); done
  for pid in "${pids[@]}"; do wait "$pid"; done
done

for d in $(seq 1 "$documentos"); do
  doc="42000000-0000-4000-8000-$(printf '%012d' "$d")"
  ganadoras="$(cat "$work/${doc}".* | awk '{s += $1} END {print s}')"
  [[ "$ganadoras" = 1 ]] || { echo "0420 claim: el documento $d lo reclamaron $ganadoras sesiones (debía ser 1)"; exit 1; }
done
[[ "$("${psql_cmd[@]}" -c "select count(*) from public.cp_documento where tenant_id='$tenant' and estado='procesando' and intentos=1 and version=2;")" = "$documentos" ]] \
  || { echo '0420 claim: algún documento no quedó con intentos=1 y versión=2'; exit 1; }
echo "0420_carta_porte_claim_concurrencia PASS: $documentos documentos × $sesiones sesiones, exactamente un ganador por documento."
