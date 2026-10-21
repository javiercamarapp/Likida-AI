#!/usr/bin/env bash
# ejecutar_arco_cancelacion_cuenta (0849): el candado por flota ('equipo:' || tenant, el MISMO que usan
# equipo_cambiar_rol/equipo_desactivar_usuario de la 0846) aguanta DOS llamadas que de verdad se TRASLAPAN
# (no una detrás de otra) — y, a propósito, aguanta la COMBINACIÓN CRUZADA: una cancelación ARCO en paralelo
# con un cambio de rol/baja desde el panel, sobre la MISMA flota.
#
# El hallazgo original (auditoría adversarial, 21-oct-2026): el SELECT de "¿hay otro dueño activo?" y el
# UPDATE de la baja corrían dentro de la MISMA función pero SIN candado — bastaba contra dos llamadas
# secuenciales, no contra dos CONCURRENTES. Con exactamente dos dueños activos, cancelar/degradar/dar de
# baja a los dos A LA VEZ podía dejar que las dos vieran "sí hay otro" antes de que ninguna confirmara: las
# dos pasaban, la flota se quedaba sin ningún flota_admin activo.
#
# La sesión 1 actúa y MANTIENE su transacción abierta 3 s (sin confirmar). La sesión 2 llega a mitad de ese
# plazo e intenta la operación equivalente sobre el OTRO dueño de la MISMA flota. Con el candado, la sesión 2
# espera a que la 1 confirme y entonces recuenta sobre el estado YA actualizado: una de las dos pasa, la otra
# rebota — nunca las dos. Exclusivo PostgreSQL desechable; UUIDs y objetos sintéticos propios.
set -euo pipefail
host="${1:?uso: $0 HOST PORT DB}"
port="${2:?uso: $0 HOST PORT DB}"
database="${3:?uso: $0 HOST PORT DB}"
ta='08490000-0000-4000-8000-00000000a001'
tb='08490000-0000-4000-8000-00000000b001'
a1='08490000-0000-4000-8000-00000000a1a1'
a2='08490000-0000-4000-8000-00000000a1a2'
b1='08490000-0000-4000-8000-00000000b1b1'
b2='08490000-0000-4000-8000-00000000b1b2'
s1='08490000-0000-4000-8000-00000000c001'
s2='08490000-0000-4000-8000-00000000c002'
s3='08490000-0000-4000-8000-00000000c003'
psql_cmd=(psql -h "$host" -p "$port" -d "$database" -X -v ON_ERROR_STOP=1 -qAt)
work="$(mktemp -d)"
limpiar() {
  "${psql_cmd[@]}" -c "delete from public.tenant where id in ('$ta','$tb');" >/dev/null 2>&1 || true
  rm -rf "$work"
}
[[ "$("${psql_cmd[@]}" -c "select count(*) from public.tenant where id in ('$ta','$tb');")" = 0 ]] || { echo 'Fixture0849 ya existe; no tocar datos ajenos.'; exit 1; }
trap limpiar EXIT
"${psql_cmd[@]}" >/dev/null <<SQL
insert into public.tenant(id,nombre) values('$ta','ARCO candado 0849 A'),('$tb','ARCO candado 0849 B');
insert into public.app_user(id,tenant_id,email,rol,activo) values
  ('$a1','$ta','a1-0849@test.invalid','flota_admin',true),
  ('$a2','$ta','a2-0849@test.invalid','flota_admin',true),
  ('$b1','$tb','b1-0849@test.invalid','flota_admin',true),
  ('$b2','$tb','b2-0849@test.invalid','flota_admin',true);
insert into public.solicitud_arco(id,tenant_id,titular_user_id,titular_ref,tipo,vence_en) values
  ('$s1','$ta','$a1','a1-0849','cancelacion',current_date + 20),
  ('$s2','$ta','$a2','a2-0849','cancelacion',current_date + 20),
  ('$s3','$tb','$b1','b1-0849','cancelacion',current_date + 20);
SQL

# ── (1) ARCO vs ARCO: cancelar a los DOS dueños de la flota A a la vez ──────
"${psql_cmd[@]}" -c "begin; select (public.ejecutar_arco_cancelacion_cuenta('$ta','$s1')->>'ok'); select pg_sleep(3); commit;" > "$work/s1.out" 2> "$work/s1.err" &
p1=$!
sleep 1
"${psql_cmd[@]}" -c "select (public.ejecutar_arco_cancelacion_cuenta('$ta','$s2')->>'ok');" > "$work/s2.out" 2> "$work/s2.err"
wait "$p1"
[[ -s "$work/s1.err" ]] && { echo '0849(1): la sesión 1 (ARCO) falló'; cat "$work/s1.err"; exit 1; }
[[ -s "$work/s2.err" ]] && { echo '0849(1): la sesión 2 (ARCO) falló'; cat "$work/s2.err"; exit 1; }
r1="$(head -1 "$work/s1.out")"
r2="$(cat "$work/s2.out")"
{ [[ "$r1" = true && "$r2" = false ]] || [[ "$r1" = false && "$r2" = true ]]; } \
  || { echo "0849(1): se esperaba un ok=true y un ok=false, salió s1=$r1 s2=$r2"; exit 1; }
n="$("${psql_cmd[@]}" -c "select count(*) from public.app_user where tenant_id='$ta' and rol='flota_admin' and activo;")"
[[ "$n" = 1 ]] || { echo "0849(1): la flota A quedó con $n dueños activos (debía ser exactamente 1 — nunca 0, nunca 2)"; exit 1; }
echo '0849(1) PASS: ejecutar_arco_cancelacion_cuenta vs sí misma — dos cancelaciones traslapadas sobre los dos únicos dueños dejan exactamente uno activo, nunca cero.'

# ── (2) CRUZADO: ARCO cancela a b1 mientras equipo_desactivar_usuario da de baja a b2, misma flota ──
"${psql_cmd[@]}" -c "begin; select (public.ejecutar_arco_cancelacion_cuenta('$tb','$s3')->>'ok'); select pg_sleep(3); commit;" > "$work/s3.out" 2> "$work/s3.err" &
p2=$!
sleep 1
"${psql_cmd[@]}" -c "select public.equipo_desactivar_usuario('$tb','$b2','flota_admin','$b1');" > "$work/s4.out" 2> "$work/s4.err"
wait "$p2"
[[ -s "$work/s3.err" ]] && { echo '0849(2): la sesión 3 (ARCO) falló'; cat "$work/s3.err"; exit 1; }
[[ -s "$work/s4.err" ]] && { echo '0849(2): la sesión 4 (equipo_desactivar_usuario) falló'; cat "$work/s4.err"; exit 1; }
r3="$(head -1 "$work/s3.out")"
r4="$(cat "$work/s4.out")"
{ [[ "$r3" = true && "$r4" = ultimo_dueno ]] || [[ "$r3" = false && "$r4" = ok ]]; } \
  || { echo "0849(2): se esperaba exactamente un lado ganador y el otro rebotado, salió s3(arco.ok)=$r3 s4(equipo)=$r4"; exit 1; }
m="$("${psql_cmd[@]}" -c "select count(*) from public.app_user where tenant_id='$tb' and rol='flota_admin' and activo;")"
[[ "$m" = 1 ]] || { echo "0849(2): la flota B quedó con $m dueños activos (debía ser exactamente 1 — nunca 0, nunca 2)"; exit 1; }
echo '0849(2) PASS: ejecutar_arco_cancelacion_cuenta vs equipo_desactivar_usuario (candado compartido, rutas distintas) — nunca cero dueños activos.'
