#!/usr/bin/env bash
# equipo_cambiar_rol / equipo_desactivar_usuario (0845): el candado por flota aguanta DOS llamadas que de verdad
# se TRASLAPAN (no una detrás de otra). El hallazgo original (auditoría adversarial, 21-oct-2026): el SELECT de
# "¿hay otro dueño activo?" y el UPDATE corrían en transacciones SEPARADAS desde supabase-js — con exactamente
# dos dueños activos, degradar/dar de baja a los dos A LA VEZ podía dejar que las dos leyeran "sí hay otro" antes
# de que ninguna confirmara, y las dos pasaran: la flota se quedaba sin ningún flota_admin activo.
#
# La sesión 1 actúa y MANTIENE su transacción abierta 3 s (sin confirmar). La sesión 2 llega a mitad de ese plazo
# e intenta la MISMA operación sobre el OTRO dueño. Con el candado (pg_advisory_xact_lock por tenant, dentro de la
# MISMA función SQL que hace el recuento y el UPDATE), la sesión 2 espera a que la 1 confirme y entonces recuenta
# sobre el estado YA actualizado: una de las dos pasa ('ok'), la otra rebota ('ultimo_dueno') — nunca las dos.
# Exclusivo PostgreSQL desechable; UUIDs y objetos sintéticos propios.
set -euo pipefail
host="${1:?uso: $0 HOST PORT DB}"
port="${2:?uso: $0 HOST PORT DB}"
database="${3:?uso: $0 HOST PORT DB}"
ta='08450000-0000-4000-8000-00000000a001'
tb='08450000-0000-4000-8000-00000000b001'
c1='08450000-0000-4000-8000-00000000a1c1'
c2='08450000-0000-4000-8000-00000000a1c2'
d1='08450000-0000-4000-8000-00000000b1d1'
d2='08450000-0000-4000-8000-00000000b1d2'
psql_cmd=(psql -h "$host" -p "$port" -d "$database" -X -v ON_ERROR_STOP=1 -qAt)
work="$(mktemp -d)"
limpiar() {
  "${psql_cmd[@]}" -c "delete from public.tenant where id in ('$ta','$tb');" >/dev/null 2>&1 || true
  rm -rf "$work"
}
[[ "$("${psql_cmd[@]}" -c "select count(*) from public.tenant where id in ('$ta','$tb');")" = 0 ]] || { echo 'Fixture0845 ya existe; no tocar datos ajenos.'; exit 1; }
trap limpiar EXIT
"${psql_cmd[@]}" >/dev/null <<SQL
insert into public.tenant(id,nombre) values('$ta','Equipo 0845 A'),('$tb','Equipo 0845 B');
insert into public.app_user(id,tenant_id,email,rol,activo) values
  ('$c1','$ta','c1-0845@test.invalid','flota_admin',true),
  ('$c2','$ta','c2-0845@test.invalid','flota_admin',true),
  ('$d1','$tb','d1-0845@test.invalid','flota_admin',true),
  ('$d2','$tb','d2-0845@test.invalid','flota_admin',true);
SQL

# ── (1) equipo_cambiar_rol: degradar a los DOS dueños de la flota A a la vez ─
"${psql_cmd[@]}" -c "begin; select public.equipo_cambiar_rol('$ta','$c1','flota_admin','contador'); select pg_sleep(3); commit;" > "$work/s1.out" 2> "$work/s1.err" &
p1=$!
sleep 1
"${psql_cmd[@]}" -c "select public.equipo_cambiar_rol('$ta','$c2','flota_admin','contador');" > "$work/s2.out" 2> "$work/s2.err"
wait "$p1"
[[ -s "$work/s1.err" ]] && { echo '0845: la sesión 1 (cambiar rol) falló'; cat "$work/s1.err"; exit 1; }
[[ -s "$work/s2.err" ]] && { echo '0845: la sesión 2 (cambiar rol) falló'; cat "$work/s2.err"; exit 1; }
r1="$(head -1 "$work/s1.out")"
r2="$(cat "$work/s2.out")"
{ [[ "$r1" = ok && "$r2" = ultimo_dueno ]] || [[ "$r1" = ultimo_dueno && "$r2" = ok ]]; } \
  || { echo "0845: se esperaba un 'ok' y un 'ultimo_dueno', salió s1=$r1 s2=$r2"; exit 1; }
n="$("${psql_cmd[@]}" -c "select count(*) from public.app_user where tenant_id='$ta' and rol='flota_admin' and activo;")"
[[ "$n" = 1 ]] || { echo "0845(1): la flota A quedó con $n dueños activos (debía ser exactamente 1 — nunca 0, nunca 2)"; exit 1; }
echo '0845(1) PASS: equipo_cambiar_rol — dos degradaciones traslapadas sobre los dos únicos dueños dejan exactamente uno activo, nunca cero.'

# ── (2) equipo_desactivar_usuario: mismo traslape, otra flota ──────────────
"${psql_cmd[@]}" -c "begin; select public.equipo_desactivar_usuario('$tb','$d1','flota_admin','$d2'); select pg_sleep(3); commit;" > "$work/s3.out" 2> "$work/s3.err" &
p2=$!
sleep 1
"${psql_cmd[@]}" -c "select public.equipo_desactivar_usuario('$tb','$d2','flota_admin','$d1');" > "$work/s4.out" 2> "$work/s4.err"
wait "$p2"
[[ -s "$work/s3.err" ]] && { echo '0845: la sesión 3 (desactivar) falló'; cat "$work/s3.err"; exit 1; }
[[ -s "$work/s4.err" ]] && { echo '0845: la sesión 4 (desactivar) falló'; cat "$work/s4.err"; exit 1; }
r3="$(head -1 "$work/s3.out")"
r4="$(cat "$work/s4.out")"
{ [[ "$r3" = ok && "$r4" = ultimo_dueno ]] || [[ "$r3" = ultimo_dueno && "$r4" = ok ]]; } \
  || { echo "0845: se esperaba un 'ok' y un 'ultimo_dueno', salió s3=$r3 s4=$r4"; exit 1; }
m="$("${psql_cmd[@]}" -c "select count(*) from public.app_user where tenant_id='$tb' and rol='flota_admin' and activo;")"
[[ "$m" = 1 ]] || { echo "0845(2): la flota B quedó con $m dueños activos (debía ser exactamente 1 — nunca 0, nunca 2)"; exit 1; }
echo '0845(2) PASS: equipo_desactivar_usuario — dos bajas traslapadas sobre los dos únicos dueños dejan exactamente uno activo, nunca cero.'
