#!/usr/bin/env bash
# Vigía (0690): el tope de 200 respuestas rápidas aprobadas por flota aguanta aprobaciones SIMULTÁNEAS.
#   (1) con 199 aprobadas, una sesión aprueba la 200 y mantiene su transacción abierta; otra aprobación NUEVA que llega en ese plazo
#       espera, ve 200 y rebota con 54000 (con la 0647 sola entraba y la flota quedaba en 201); 8 sesiones más rebotan todas;
#   (2) con la flota en 200, 8 sesiones corrigen a la vez la MISMA pregunta ya aprobada: ninguna topa y el conteo sigue en 200;
#   (3) otra flota no espera ni se afecta por el tope de la primera.
# Exclusivo PostgreSQL desechable; UUIDs y objetos sintéticos propios.
set -euo pipefail
host="${1:?uso: $0 HOST PORT DB}"
port="${2:?uso: $0 HOST PORT DB}"
database="${3:?uso: $0 HOST PORT DB}"
ta='69000000-0000-4000-8000-0000000c0001'
tb='69000000-0000-4000-8000-0000000c0002'
psql_cmd=(psql -h "$host" -p "$port" -d "$database" -X -v ON_ERROR_STOP=1 -qAt)
work="$(mktemp -d)"
limpiar() {
  "${psql_cmd[@]}" -c "delete from public.tenant where id in ('$ta','$tb');" >/dev/null 2>&1 || true
  rm -rf "$work"
}
[[ "$("${psql_cmd[@]}" -c "select count(*) from public.tenant where id in ('$ta','$tb');")" = 0 ]] || { echo 'Fixture0690 ya existe; no tocar datos ajenos.'; exit 1; }
trap limpiar EXIT
"${psql_cmd[@]}" >/dev/null <<SQL
insert into public.tenant(id,nombre) values('$ta','Vigía 0690 A'),('$tb','Vigía 0690 B');
select public.vigia_respuesta_rapida_aprobar('$ta','otro','pregunta base '||i,'respuesta '||i,null) from generate_series(1,199) i;
SQL
[[ "$("${psql_cmd[@]}" -c "select count(*) from public.vigia_respuesta_rapida where tenant_id='$ta' and estado='aprobada';")" = 199 ]] || { echo '0690: no quedó la base de 199'; exit 1; }

aprobar() { # $1 = archivo, $2 = flota, $3 = pregunta
  "${psql_cmd[@]}" -c "select public.vigia_respuesta_rapida_aprobar('$2','otro','$3','texto',null);" > "$work/$1.ok" 2> "$work/$1.err" && echo ok > "$work/$1.res" || echo fallo > "$work/$1.res"
}

# ── (1) dos aprobaciones NUEVAS que se traslapan de verdad ───────────────────
# La sesión 1 aprueba la que sería la 200 y MANTIENE su transacción abierta 3 s (todavía sin confirmar). La sesión 2 llega a mitad de
# ese plazo con otra pregunta nueva: con la 0647 sola veía 199 (la fila de la 1 no estaba confirmada) y entraba la 201; con el candado
# por flota espera a la 1, ve 200 y rebota con 54000.
"${psql_cmd[@]}" -c "begin; select public.vigia_respuesta_rapida_aprobar('$ta','otro','pregunta nueva 1','texto',null); select pg_sleep(3); commit;" > "$work/s1.ok" 2> "$work/s1.err" &
p1=$!
sleep 1
aprobar s2 "$ta" 'pregunta nueva 2'
wait "$p1"
[[ -s "$work/s1.err" ]] && { echo '0690: la sesión 1 falló'; cat "$work/s1.err"; exit 1; }
[[ "$(cat "$work/s2.res")" = fallo ]] && grep -q '54000\|tope de 200' "$work/s2.err" || { echo '0690: la 2.ª aprobación nueva NO rebotó: el tope se rebasa con aprobaciones simultáneas'; cat "$work/s2.err"; exit 1; }
[[ "$("${psql_cmd[@]}" -c "select count(*) from public.vigia_respuesta_rapida where tenant_id='$ta' and estado='aprobada';")" = 200 ]] || { echo '0690: la flota rebasó o no llegó a 200'; exit 1; }

# 8 sesiones más sobre la flota ya topada: todas rebotan, ninguna entra
pids=()
for n in $(seq 1 8); do aprobar "a$n" "$ta" "pregunta nueva x$n" & pids+=($!); done
for p in "${pids[@]}"; do wait "$p"; done
[[ "$(cat "$work"/a?.res | grep -c '^ok$' || true)" = 0 ]] || { echo '0690: entró una aprobación nueva con la flota ya en 200'; exit 1; }

# ── (2) corregir la MISMA pregunta ya aprobada: nadie topa ──────────────────
pids=()
for n in $(seq 1 8); do aprobar "b$n" "$ta" "pregunta base 7" & pids+=($!); done
for p in "${pids[@]}"; do wait "$p"; done
[[ "$(cat "$work"/b?.res | grep -c '^ok$' || true)" = 8 ]] || { echo '0690: una corrección de pregunta existente topó'; cat "$work"/b?.err; exit 1; }
[[ "$("${psql_cmd[@]}" -c "select count(*) from public.vigia_respuesta_rapida where tenant_id='$ta' and estado='aprobada';")" = 200 ]] || { echo '0690: las correcciones cambiaron el conteo'; exit 1; }

# ── (3) otra flota no se afecta ─────────────────────────────────────────────
aprobar c1 "$tb" 'pregunta de la otra flota'
[[ "$(cat "$work"/c1.res)" = ok ]] || { echo '0690: la otra flota fue bloqueada por el tope de la primera'; cat "$work"/c1.err; exit 1; }
echo '0690_vigia_respuesta_rapida_tope_concurrencia PASS: con 199 aprobadas, aprobaciones traslapadas mantienen la flota exactamente en 200; corregir no topa; otra flota no se afecta.'
