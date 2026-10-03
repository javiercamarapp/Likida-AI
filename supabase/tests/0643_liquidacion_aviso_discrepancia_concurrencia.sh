#!/usr/bin/env bash
# Ocho sesiones reales aprietan a la vez «No coincide» sobre la MISMA liquidación: gana EXACTAMENTE una, queda UN solo aviso
# pendiente y, de ocho reclamos simultáneos de ese aviso, gana exactamente uno (0644). Exclusivo PostgreSQL desechable.
set -euo pipefail
host="${1:?uso: $0 HOST PORT DB}"
port="${2:?uso: $0 HOST PORT DB}"
database="${3:?uso: $0 HOST PORT DB}"
tenant='64300000-0000-4000-8000-0000000c0001'
operador='64300000-0000-4000-8000-0000000c0002'
liq='64300000-0000-4000-8000-0000000c0003'
psql_cmd=(psql -h "$host" -p "$port" -d "$database" -X -v ON_ERROR_STOP=1 -qAt)
work="$(mktemp -d)"
limpiar() {
  "${psql_cmd[@]}" -c "delete from public.tenant where id='$tenant';" >/dev/null 2>&1 || true
  rm -rf "$work"
}
[[ "$("${psql_cmd[@]}" -c "select count(*) from public.tenant where id='$tenant';")" = 0 ]] || { echo 'Fixture0643 ya existe; no tocar datos ajenos.'; exit 1; }
trap limpiar EXIT
"${psql_cmd[@]}" <<SQL
insert into public.tenant(id,nombre) values('$tenant','Aviso discrepancia 0643 concurrente');
insert into public.operador(id,tenant_id,nombre,telefono) values('$operador','$tenant','Chofer 0643','525500000643');
insert into public.liquidacion_externa(id,tenant_id,clave_externa,huella,operador_id,periodo_desde,periodo_hasta,conceptos,total,moneda,pdf_origen,estado)
values('$liq','$tenant','CC1',repeat('c',64),'$operador','2026-09-01','2026-09-07','[{"descripcion":"x","tipo":"percepcion","monto":1}]'::jsonb,1,'MXN','generado','enviada');
SQL

acusar() {
  "${psql_cmd[@]}" -c "begin; select coalesce(public.registrar_acuse_no_coincide('$tenant','$liq','$operador')::text,'-'); select pg_sleep(0.05); commit;" | grep -v '^$' | sed -n 1p > "$work/acuse.$1"
}
pids=()
for n in $(seq 1 8); do acusar "$n" & pids+=($!); done
for p in "${pids[@]}"; do wait "$p"; done
ganadores="$(cat "$work"/acuse.* | grep -vc '^-$' || true)"
[[ "$ganadores" = 1 ]] || { echo "0643: $ganadores sesiones ganaron «No coincide» (debía ser 1)"; exit 1; }
filas="$("${psql_cmd[@]}" -c "select count(*) from public.liquidacion_aviso_discrepancia where liquidacion_externa_id='$liq';")"
[[ "$filas" = 1 ]] || { echo "0643: $filas avisos (debía ser 1)"; exit 1; }

reclamar() {
  "${psql_cmd[@]}" -c "begin; select coalesce(public.reclamar_aviso_discrepancia('$tenant','$liq',1)::text,'-'); select pg_sleep(0.05); commit;" | grep -v '^$' | sed -n 1p > "$work/reclamo.$1"
}
pids=()
for n in $(seq 1 8); do reclamar "$n" & pids+=($!); done
for p in "${pids[@]}"; do wait "$p"; done
ganadores="$(cat "$work"/reclamo.* | grep -vc '^-$' || true)"
[[ "$ganadores" = 1 ]] || { echo "0643: $ganadores sesiones ganaron el reclamo del aviso (debía ser 1)"; exit 1; }
echo 'OK 0643: un solo ganador del acuse y un solo reclamo del aviso entre 8 sesiones concurrentes.'
