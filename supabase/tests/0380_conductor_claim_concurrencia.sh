#!/usr/bin/env bash
# El claim de avisos del Agente 5 (0380, `viaje_hito_aviso`: unique (hito, ciclo, clase, nivel)) con sesiones reales, el mismo
# INSERT ... ON CONFLICT DO NOTHING que ejecuta `reclamarAviso` (conductor/repo.ts) — Vercel entrega el cron at-least-once:
#   (1) 12 sesiones reclaman a la vez el MISMO aviso: EXACTAMENTE una gana, hay UNA fila y ningún error;
#   (2) 8 sesiones por cada uno de 3 niveles de la escalera a la vez: gana UNA por nivel (3 filas), no se pisan entre niveles;
#   (3) quien gana lo CIERRA (ok = true) y 12 sesiones intentan «liberarlo» como hace el camino de error: no se borra nada
#       (solo se suelta un claim sin resultado, `ok IS NULL`), y un reclamo posterior sigue perdiendo;
#   (4) un claim sin cerrar SÍ se libera y se puede reclamar otra vez, y de 12 sesiones solo una lo gana.
# Exclusivo PostgreSQL desechable; UUIDs y objetos sintéticos propios.
set -euo pipefail
host="${1:?uso: $0 HOST PORT DB}"
port="${2:?uso: $0 HOST PORT DB}"
database="${3:?uso: $0 HOST PORT DB}"
t='38000000-0000-4000-8000-0000000c0001'
op='38000000-0000-4000-8000-0000000c0002'
v='38000000-0000-4000-8000-0000000c0003'
psql_cmd=(psql -h "$host" -p "$port" -d "$database" -X -v ON_ERROR_STOP=1 -qAt)
work="$(mktemp -d)"
limpiar() {
  "${psql_cmd[@]}" -c "delete from public.tenant where id='$t';" >/dev/null 2>&1 || true
  rm -rf "$work"
}
[[ "$("${psql_cmd[@]}" -c "select count(*) from public.tenant where id='$t';")" = 0 ]] || { echo 'Fixture0380c ya existe; no tocar datos ajenos.'; exit 1; }
trap limpiar EXIT
"${psql_cmd[@]}" >/dev/null <<SQL
insert into public.tenant(id,nombre) values('$t','Conductor 0380 claim concurrente');
insert into public.operador(id,tenant_id,nombre,telefono) values('$op','$t','Chofer','525500038098');
insert into public.viaje(id,tenant_id,operador_id,folio,estatus,avisado_en,aceptado_en)
  values('$v','$t','$op','K-1','abierto', now() - interval '5 hours', now() - interval '5 hours');
select count(*) from (select public.sembrar_hitos_conductor(10)) _;
SQL
hito="$("${psql_cmd[@]}" -c "select id from public.viaje_hito where viaje_id='$v' and tipo='llegada_carga';")"

reclamar() { # $1 prefijo, $2 sesión, $3 nivel → imprime 1 si ganó, 0 si perdió
  "${psql_cmd[@]}" -c "with i as (insert into public.viaje_hito_aviso(tenant_id,viaje_id,viaje_hito_id,operador_id,ciclo,clase,nivel)
      values('$t','$v','$hito','$op',1,'recordatorio',$3) on conflict (viaje_hito_id,ciclo,clase,nivel) do nothing returning id)
    select count(*) from i;" > "$work/$1.$2" 2> "$work/e$1.$2"
}
rafaga() { # $1 prefijo, $2 sesiones, $3 nivel
  local pids=() n
  for n in $(seq 1 "$2"); do reclamar "$1" "$n" "$3" & pids+=($!); done
  for p in "${pids[@]}"; do wait "$p"; done
  cat "$work"/e"$1".* | grep -q . && { echo "0380 claim ($1): una sesión lanzó error"; cat "$work"/e"$1".*; exit 1; }
  return 0
}
ganadores() { cat "$work"/"$1".* | paste -sd+ - | bc; }

# ── (1) el mismo aviso, 12 sesiones ─────────────────────────────────────────
rafaga a 12 0
[[ "$(ganadores a)" = 1 ]] || { echo "0380: $(ganadores a) sesiones ganaron el mismo claim (debía ser 1)"; exit 1; }
[[ "$("${psql_cmd[@]}" -c "select count(*) from public.viaje_hito_aviso where viaje_hito_id='$hito' and nivel=0;")" = 1 ]] || { echo '0380: hay más de una fila del mismo aviso'; exit 1; }

# ── (2) tres niveles de la escalera a la vez ────────────────────────────────
pids=()
for nivel in 1 2 3; do ( rafaga "n$nivel" 8 "$nivel" ) & pids+=($!); done
for p in "${pids[@]}"; do wait "$p"; done
for nivel in 1 2 3; do
  [[ "$(ganadores "n$nivel")" = 1 ]] || { echo "0380: el nivel $nivel tuvo $(ganadores "n$nivel") ganadores (debía ser 1)"; exit 1; }
done
[[ "$("${psql_cmd[@]}" -c "select count(*) from public.viaje_hito_aviso where viaje_hito_id='$hito';")" = 4 ]] || { echo '0380: no hay 4 avisos (niveles 0..3)'; exit 1; }

# ── (3) cerrado (ok = true): «liberar» no borra nada y el reclamo sigue perdiendo ───
"${psql_cmd[@]}" -c "update public.viaje_hito_aviso set ok=true, canal='texto' where viaje_hito_id='$hito' and ciclo=1 and clase='recordatorio' and nivel=0;" >/dev/null
pids=()
for n in $(seq 1 12); do
  "${psql_cmd[@]}" -c "delete from public.viaje_hito_aviso where viaje_hito_id='$hito' and ciclo=1 and clase='recordatorio' and nivel=0 and tenant_id='$t' and ok is null;" > "$work/l.$n" 2> "$work/el.$n" & pids+=($!)
done
for p in "${pids[@]}"; do wait "$p"; done
cat "$work"/el.* | grep -q . && { echo '0380: una liberación lanzó error'; cat "$work"/el.*; exit 1; }
[[ "$("${psql_cmd[@]}" -c "select count(*) from public.viaje_hito_aviso where viaje_hito_id='$hito' and nivel=0 and ok is true;")" = 1 ]] || { echo '0380: «liberar» borró un aviso ya cerrado'; exit 1; }
rafaga b 12 0
[[ "$(ganadores b)" = 0 ]] || { echo '0380: se reclamó de nuevo un aviso ya cerrado'; exit 1; }

# ── (4) sin cerrar sí se libera, y de 12 sesiones solo una lo retoma ────────
"${psql_cmd[@]}" -c "delete from public.viaje_hito_aviso where viaje_hito_id='$hito' and nivel=3 and ok is null;" >/dev/null
rafaga c 12 3
[[ "$(ganadores c)" = 1 ]] || { echo "0380: tras liberar, $(ganadores c) sesiones retomaron el claim (debía ser 1)"; exit 1; }
echo '0380_conductor_claim_concurrencia PASS: un solo ganador por (hito, ciclo, clase, nivel) entre sesiones simultáneas; lo cerrado no se libera ni se reclama.'
