#!/usr/bin/env bash
# 0850 — el tope de 50 archivos pendientes/procesando por flota aguanta envíos SIMULTÁNEOS de verdad
# (hallazgo CRÍTICO de la auditoría adversarial, 21-oct-2026 — `_race_toctou.test.ts` lo reproducía
# con un fake de supabase-js; este script lo prueba contra Postgres REAL con dos conexiones separadas):
#   (1) con 49 pendientes, dos envíos NUEVOS (huella distinta) que se traslapan de verdad: uno mantiene
#       su transacción abierta 3s sin confirmar; el otro llega a mitad de ese plazo — sin candado los dos
#       verían 49 y entrarían los dos (51); con el candado por flota el segundo espera, ve 50 y rebota 54000;
#   (2) 8 envíos nuevos más sobre la flota ya en 50: todos rebotan, ninguno entra;
#   (3) en la OTRA flota (con lugar — probar el dedup contra una flota llena probaría el tope, no el
#       dedup), dos envíos simultáneos del MISMO archivo (misma huella): solo UNO inserta, el otro ve
#       duplicado — sin candado el 23505 del unique sería la única red, aquí ni siquiera se llega a
#       chocar — y esa misma flota B no se vio afectada por el tope de la flota A.
# Exclusivo PostgreSQL desechable; UUIDs y objetos sintéticos propios.
set -euo pipefail
host="${1:?uso: $0 HOST PORT DB}"
port="${2:?uso: $0 HOST PORT DB}"
database="${3:?uso: $0 HOST PORT DB}"
ta='85000000-0000-4000-8000-0000000000b1'
tb='85000000-0000-4000-8000-0000000000b2'
psql_cmd=(psql -h "$host" -p "$port" -d "$database" -X -v ON_ERROR_STOP=1 -qAt)
md5_de() { if command -v md5sum >/dev/null 2>&1; then printf '%s' "$1" | md5sum | cut -d' ' -f1; else printf '%s' "$1" | md5 -q; fi; }
# `huella` exige forma `^[0-9a-f]{64}$` (sha256 real en producción): aquí se simula con dos md5
# concatenados (32 + 32 = 64 hex) de la MISMA etiqueta en mayúsculas/minúsculas, para que cada caso
# de la prueba tenga una huella distinta pero reproducible.
huella_de() { printf '%s%s' "$(md5_de "$1")" "$(md5_de "$(printf '%s' "$1" | tr 'a-z' 'A-Z')")"; }
work="$(mktemp -d)"
limpiar() {
  "${psql_cmd[@]}" -c "delete from public.tenant where id in ('$ta','$tb');" >/dev/null 2>&1 || true
  rm -rf "$work"
}
[[ "$("${psql_cmd[@]}" -c "select count(*) from public.tenant where id in ('$ta','$tb');")" = 0 ]] || { echo 'Fixture0850 ya existe; no tocar datos ajenos.'; exit 1; }
trap limpiar EXIT
"${psql_cmd[@]}" >/dev/null <<SQL
insert into public.tenant(id,nombre) values('$ta','Peajes 0850 A'),('$tb','Peajes 0850 B');
select public.peaje_archivo_encolar('$ta', md5('base'||i) || md5('BASE'||i), 'base'||i||'.csv','PASE','api',10,'\x01'::bytea) from generate_series(1,49) i;
SQL
[[ "$("${psql_cmd[@]}" -c "select count(*) from public.peaje_ingesta_archivo where tenant_id='$ta';")" = 49 ]] || { echo '0850: no quedó la base de 49'; exit 1; }

encolar() { # $1 = archivo de salida, $2 = flota, $3 = huella, $4 = nombre
  "${psql_cmd[@]}" -c "select public.peaje_archivo_encolar('$2','$3','$4','PASE','api',10,'\x01'::bytea);" > "$work/$1.ok" 2> "$work/$1.err" && echo ok > "$work/$1.res" || echo fallo > "$work/$1.res"
}

# ── (1) dos envíos NUEVOS que se traslapan de verdad ─────────────────────────
# La sesión 1 encola el que sería el 50.º y MANTIENE su transacción abierta 3s (todavía sin confirmar).
# La sesión 2 llega a mitad de ese plazo con otra huella nueva: con el SELECT+INSERT sin candado vería 49
# (la fila de la 1 no está confirmada) y entraría como el 51.º; con el candado por flota espera a la 1, ve 50
# y rebota con 54000.
"${psql_cmd[@]}" -c "begin; select public.peaje_archivo_encolar('$ta','$(huella_de nueva-1)','nueva-1.csv','PASE','api',10,'\x01'::bytea); select pg_sleep(3); commit;" > "$work/s1.ok" 2> "$work/s1.err" &
p1=$!
sleep 1
encolar s2 "$ta" "$(huella_de nueva-2)" 'nueva-2.csv'
wait "$p1"
[[ -s "$work/s1.err" ]] && { echo '0850: la sesión 1 falló'; cat "$work/s1.err"; exit 1; }
[[ "$(cat "$work/s2.res")" = fallo ]] && grep -q '54000\|tope de 50' "$work/s2.err" || { echo '0850: el 2.º envío nuevo NO rebotó: el tope se rebasa con envíos simultáneos'; cat "$work/s2.err"; exit 1; }
[[ "$("${psql_cmd[@]}" -c "select count(*) from public.peaje_ingesta_archivo where tenant_id='$ta' and estado in ('pendiente','procesando');")" = 50 ]] || { echo '0850: la flota A rebasó o no llegó a 50'; exit 1; }

# ── (2) 8 envíos nuevos más sobre la flota ya en 50: todos rebotan ─────────
pids=()
for n in $(seq 1 8); do encolar "a$n" "$ta" "$(huella_de "extra-$n")" "extra-$n.csv" & pids+=($!); done
for p in "${pids[@]}"; do wait "$p"; done
[[ "$(cat "$work"/a?.res | grep -c '^ok$' || true)" = 0 ]] || { echo '0850: entró un envío nuevo con la flota ya en 50'; exit 1; }

# ── (3) en la flota B (con lugar): dos envíos simultáneos del MISMO archivo, solo uno inserta ─────
# (y de paso: la flota B no espera ni se afecta por el tope de la flota A, ya llena)
hmisma="$(huella_de misma-huella)"
pids=()
for n in 1 2; do encolar "d$n" "$tb" "$hmisma" "misma-huella-copia-$n.csv" & pids+=($!); done
for p in "${pids[@]}"; do wait "$p"; done
[[ "$(cat "$work"/d?.res | grep -c '^ok$' || true)" = 2 ]] || { echo '0850: un envío duplicado concurrente terminó en error en vez de «duplicado=true»'; cat "$work"/d?.err; exit 1; }
[[ "$("${psql_cmd[@]}" -c "select count(*) from public.peaje_ingesta_archivo where tenant_id='$tb' and huella='$hmisma';")" = 1 ]] || { echo '0850: el mismo archivo concurrente insertó más de una fila'; exit 1; }
echo '0850_peaje_ingesta_tope_candado_concurrencia PASS: con 49 pendientes, envíos nuevos traslapados mantienen la flota exactamente en 50; el mismo archivo concurrente en otra flota no duplica y esa flota no se afecta por el tope de la primera.'
