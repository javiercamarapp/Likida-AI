#!/usr/bin/env bash
# 0860 — dos sesiones SIMULTÁNEAS registran la MISMA nota de crédito (doble clic / dos pestañas): solo una suma.
# (1) misma clave, traslapadas de verdad: la sesión 1 mantiene su transacción abierta 3 s sin confirmar; la 2 llega a
#     mitad de ese plazo. Sin candado la 2 leería el total viejo y duplicaría; con `for update` espera y ve la clave.
# (2) 8 sesiones en paralelo con la misma clave: una nota, un solo incremento.
# (3) dos notas DISTINTAS en paralelo (claves distintas) suman AMBAS (sin pisarse el total).
# Exclusivo PostgreSQL desechable; UUIDs sintéticos propios.
set -euo pipefail
host="${1:?uso: $0 HOST PORT DB}"
port="${2:?uso: $0 HOST PORT DB}"
database="${3:?uso: $0 HOST PORT DB}"
ta='86000000-0000-4000-8000-0000000000c1'
rec='86000000-0000-4000-8000-0000000000c2'
psql_cmd=(psql -h "$host" -p "$port" -d "$database" -X -v ON_ERROR_STOP=1 -qAt)
work="$(mktemp -d)"
limpiar() { "${psql_cmd[@]}" -c "delete from public.tenant where id = '$ta';" >/dev/null 2>&1 || true; rm -rf "$work"; }
[[ "$("${psql_cmd[@]}" -c "select count(*) from public.tenant where id = '$ta';")" = 0 ]] || { echo 'Fixture0860 ya existe; no tocar datos ajenos.'; exit 1; }
trap limpiar EXIT
"${psql_cmd[@]}" >/dev/null <<SQL
insert into public.tenant(id,nombre) values('$ta','Peajes 0860 concurrencia');
insert into public.peaje_reclamo(id,tenant_id,categoria,estado,monto_reclamado,enviado_en,fecha_cobro_mas_antiguo)
values('$rec','$ta','extemporaneo','enviado',10000,'2026-09-01','2026-08-01');
SQL
nota() { "${psql_cmd[@]}" -c "select public.peaje_nota_credito_registrar('$ta','$rec',$1,'2026-09-10','NC','$2');" >"$work/$3.out" 2>"$work/$3.err"; }
estado() { "${psql_cmd[@]}" -c "select (select count(*) from public.peaje_reclamo_nota where reclamo_id='$rec') || '|' || monto_acreditado from public.peaje_reclamo where id='$rec';"; }

# (1) traslape real
"${psql_cmd[@]}" -c "begin; select public.peaje_nota_credito_registrar('$ta','$rec',100,'2026-09-10','NC','dup'); select pg_sleep(3); commit;" >"$work/s1.out" 2>"$work/s1.err" &
p1=$!
sleep 1
nota 100 dup s2
wait "$p1"
[[ -s "$work/s1.err" || -s "$work/s2.err" ]] && { echo '0860: error en las sesiones'; cat "$work"/s*.err; exit 1; }
grep -q '"duplicada": true' "$work/s2.out" || { echo '0860: la 2.ª sesión NO vio la nota de la 1.ª (se perdió el candado)'; cat "$work/s2.out"; exit 1; }
[[ "$(estado)" = '1|100.00' ]] || { echo "0860: tras el traslape debía ser 1|100.00 y es $(estado)"; exit 1; }

# (2) 8 en paralelo, misma clave
pids=(); for i in $(seq 1 8); do nota 100 misma "m$i" & pids+=($!); done; for p in "${pids[@]}"; do wait "$p"; done
cat "$work"/m*.err | grep . && { echo '0860: error en el paralelo'; exit 1; }
[[ "$(estado)" = '2|200.00' ]] || { echo "0860: 8 simultáneas con la misma clave debían dejar 2|200.00 y dejan $(estado)"; exit 1; }

# (3) 6 notas distintas en paralelo: todas suman, ninguna se pisa
pids=(); for i in $(seq 1 6); do nota 10 "d$i" "d$i" & pids+=($!); done; for p in "${pids[@]}"; do wait "$p"; done
cat "$work"/d*.err | grep . && { echo '0860: error en las distintas'; exit 1; }
[[ "$(estado)" = '8|260.00' ]] || { echo "0860: 6 notas distintas debían dejar 8|260.00 y dejan $(estado)"; exit 1; }
echo 'OK 0860 concurrencia'
