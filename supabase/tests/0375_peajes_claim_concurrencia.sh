#!/usr/bin/env bash
# Seis workers reales compiten por la cola de archivos de peajes (0376). Cada
# archivo lo toma EXACTAMENTE uno: sin duplicados, sin huecos, con un intento.
# Exclusivo PostgreSQL desechable; UUIDs y objetos sintéticos propios.
set -euo pipefail
host="${1:?uso: $0 HOST PORT DB}"
port="${2:?uso: $0 HOST PORT DB}"
database="${3:?uso: $0 HOST PORT DB}"
tenant='37500000-0000-4000-8000-0000000c0001'
total=60
workers=6
psql_cmd=(psql -h "$host" -p "$port" -d "$database" -X -v ON_ERROR_STOP=1 -qAt)
work="$(mktemp -d)"
limpiar() {
  "${psql_cmd[@]}" -c "delete from public.tenant where id='$tenant';" >/dev/null 2>&1 || true
  rm -rf "$work"
}
[[ "$("${psql_cmd[@]}" -c "select count(*) from public.tenant where id='$tenant';")" = 0 ]] || { echo 'Fixture0375 ya existe; no tocar datos ajenos.'; exit 1; }
trap limpiar EXIT
"${psql_cmd[@]}" <<SQL
insert into public.tenant(id,nombre) values('$tenant','Peajes 0375 claim concurrente');
insert into public.peaje_ingesta_archivo(tenant_id, huella, nombre, bytes, contenido)
select '$tenant', md5(n::text) || md5((n+1000)::text), 'archivo-' || n || '.csv', 10, '\x01'
from generate_series(1, $total) n;
SQL

# Cada worker reclama en lotes de 5 DENTRO de una transacción que se queda un
# momento con los candidatos bloqueados (así los demás tienen que SALTARLOS).
worker() {
  local n="$1"
  : > "$work/w$n"
  for _ in $(seq 1 40); do
    local salida
    salida="$("${psql_cmd[@]}" -c "begin; select id from public.peaje_archivo_reclamar(5, 300); select pg_sleep(0.03); commit;" | grep -E '^[0-9a-f-]{36}$' || true)"
    [[ -z "$salida" ]] && break
    echo "$salida" >> "$work/w$n"
  done
}
pids=()
for n in $(seq 1 "$workers"); do worker "$n" & pids+=($!); done
for pid in "${pids[@]}"; do wait "$pid"; done

cat "$work"/w* | sort > "$work/todos"
[[ "$(wc -l < "$work/todos" | tr -d ' ')" = "$total" ]] || { echo "0375 claim: se reclamaron $(wc -l < "$work/todos") filas, no $total"; exit 1; }
[[ "$(sort -u "$work/todos" | wc -l | tr -d ' ')" = "$total" ]] || { echo '0375 claim: un archivo lo reclamó MÁS DE UN worker'; exit 1; }
[[ "$("${psql_cmd[@]}" -c "select count(*) from public.peaje_ingesta_archivo where tenant_id='$tenant' and estado='procesando' and intentos=1 and reclamo is not null;")" = "$total" ]]
# Y repartido: más de un worker trabajó (si uno solo hizo todo, la carrera no ocurrió).
trabajaron=0; for n in $(seq 1 "$workers"); do [[ -s "$work/w$n" ]] && trabajaron=$((trabajaron + 1)); done
[[ "$trabajaron" -ge 2 ]] || { echo "0375 claim: solo $trabajaron worker trabajó; la prueba no ejerció la carrera"; exit 1; }
echo "0375_peajes_claim_concurrencia PASS: $total archivos, $workers workers ($trabajaron trabajaron), cero duplicados."
