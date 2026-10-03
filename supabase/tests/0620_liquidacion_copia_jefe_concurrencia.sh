#!/usr/bin/env bash
# Ocho sesiones reales reclaman a la vez la MISMA copia (liquidación, generación, teléfono) y a la vez otra
# del segundo teléfono: de cada una gana EXACTAMENTE una sesión (0620). Exclusivo PostgreSQL desechable.
set -euo pipefail
host="${1:?uso: $0 HOST PORT DB}"
port="${2:?uso: $0 HOST PORT DB}"
database="${3:?uso: $0 HOST PORT DB}"
tenant='62000000-0000-4000-8000-0000000c0001'
operador='62000000-0000-4000-8000-0000000c0002'
liq='62000000-0000-4000-8000-0000000c0003'
psql_cmd=(psql -h "$host" -p "$port" -d "$database" -X -v ON_ERROR_STOP=1 -qAt)
work="$(mktemp -d)"
limpiar() {
  "${psql_cmd[@]}" -c "delete from public.tenant where id='$tenant';" >/dev/null 2>&1 || true
  rm -rf "$work"
}
[[ "$("${psql_cmd[@]}" -c "select count(*) from public.tenant where id='$tenant';")" = 0 ]] || { echo 'Fixture0620 ya existe; no tocar datos ajenos.'; exit 1; }
trap limpiar EXIT
"${psql_cmd[@]}" <<SQL
insert into public.tenant(id,nombre) values('$tenant','Copia al jefe 0620 concurrente');
insert into public.operador(id,tenant_id,nombre,telefono) values('$operador','$tenant','Chofer 0620','525500000620');
insert into public.liquidacion_externa(id,tenant_id,clave_externa,huella,operador_id,periodo_desde,periodo_hasta,conceptos,total,moneda,pdf_origen,estado)
values('$liq','$tenant','CC1',repeat('c',64),'$operador','2026-09-01','2026-09-07','[{"descripcion":"x","tipo":"percepcion","monto":1}]'::jsonb,1,'MXN','generado','enviada');
SQL

sesion() {
  local n="$1" tel="$2"
  "${psql_cmd[@]}" -c "begin; select coalesce(public.reclamar_copia_jefe('$tenant','$liq',1,'$tel')::text,'-'); select pg_sleep(0.05); commit;" | grep -v '^$' | sed -n 1p > "$work/$tel.$n"
}
pids=()
for n in $(seq 1 8); do sesion "$n" 525511110001 & pids+=($!); sesion "$n" 525511110002 & pids+=($!); done
for p in "${pids[@]}"; do wait "$p"; done
for tel in 525511110001 525511110002; do
  ganadores="$(cat "$work"/$tel.* | grep -vc '^-$' || true)"
  [[ "$ganadores" = 1 ]] || { echo "0620: $ganadores sesiones ganaron el reclamo de $tel (debía ser 1)"; exit 1; }
done
filas="$("${psql_cmd[@]}" -c "select count(*) from public.liquidacion_copia_jefe where liquidacion_externa_id='$liq';")"
[[ "$filas" = 2 ]] || { echo "0620: $filas filas de reclamo (debían ser 2)"; exit 1; }
echo 'OK 0620: un solo ganador por teléfono entre 8 sesiones concurrentes.'
