#!/usr/bin/env bash
# «Mis reglas» (0660): sesiones reales de Postgres compiten por los MISMOS casos nuevos de una regla.
#   (1) 8 sesiones reclaman a la vez el mismo lote de 3 casos: entre todas ganan EXACTAMENTE 3 llaves (cada una una sola vez)
#       y nadie recibe error (dos corridas solapadas del cron no mandan el aviso doble);
#   (2) con el arriendo vencido, 8 sesiones lo retoman a la vez: otra vez cada llave tiene un solo dueño;
#   (3) 8 sesiones confirman el mismo token a la vez: las 3 llaves quedan `enviado` y la suma de confirmadas es 3;
#   (4) ya selladas, 8 sesiones más no reclaman nada.
# Exclusivo PostgreSQL desechable; UUIDs y objetos sintéticos propios.
set -euo pipefail
host="${1:?uso: $0 HOST PORT DB}"
port="${2:?uso: $0 HOST PORT DB}"
database="${3:?uso: $0 HOST PORT DB}"
t='66000000-0000-4000-8000-0000000c0001'
r='66000000-0000-4000-8000-0000000c0002'
psql_cmd=(psql -h "$host" -p "$port" -d "$database" -X -v ON_ERROR_STOP=1 -qAt)
work="$(mktemp -d)"
limpiar() {
  "${psql_cmd[@]}" -c "delete from public.tenant where id='$t';" >/dev/null 2>&1 || true
  rm -rf "$work"
}
[[ "$("${psql_cmd[@]}" -c "select count(*) from public.tenant where id='$t';")" = 0 ]] || { echo 'Fixture0660 ya existe; no tocar datos ajenos.'; exit 1; }
trap limpiar EXIT
"${psql_cmd[@]}" >/dev/null <<SQL
insert into public.tenant(id,nombre) values('$t','Reglas 0660 concurrencia');
insert into public.regla_vigilancia(id,tenant_id,plantilla,params,texto_original,frase)
  values('$r','$t','gasto_de_concepto_mayor_a','{"concepto":"caseta","monto":3000}','avisa','Voy a avisarte');
SQL
lote="[{\"objeto\":\"gasto\",\"objeto_id\":\"66000000-0000-4000-8000-0000000c0011\",\"clave\":\"\",\"evidencia\":\"uno\"},{\"objeto\":\"gasto\",\"objeto_id\":\"66000000-0000-4000-8000-0000000c0012\",\"clave\":\"\",\"evidencia\":\"dos\"},{\"objeto\":\"gasto\",\"objeto_id\":\"66000000-0000-4000-8000-0000000c0013\",\"clave\":\"\",\"evidencia\":\"tres\"}]"

reclamar() { # $1 = prefijo de archivo, $2 = sesión, $3 = reloj lógico (opcional)
  local reloj="${3:-clock_timestamp()}"
  "${psql_cmd[@]}" -c "select o_token || '|' || o_objeto_id from public.reclamar_disparos_regla('$t','$r','$lote'::jsonb, 300, $reloj);" > "$work/$1.$2" 2> "$work/e$1.$2"
}
correr() { # 8 sesiones simultáneas
  local pids=() n
  for n in $(seq 1 8); do reclamar "$1" "$n" "${2:-clock_timestamp()}" & pids+=($!); done
  for p in "${pids[@]}"; do wait "$p"; done
  cat "$work"/e"$1".* | grep -q . && { echo "0660 concurrencia ($1): una sesión lanzó error"; cat "$work"/e"$1".*; exit 1; }
  return 0
}

# ── (1) 8 sesiones sobre el mismo lote ──────────────────────────────────────
correr a
ganadas="$(cat "$work"/a.* | grep -c . || true)"
[[ "$ganadas" = 3 ]] || { echo "0660: entre 8 sesiones ganaron $ganadas llaves (debían ser exactamente 3)"; exit 1; }
distintas="$(cat "$work"/a.* | grep . | cut -d'|' -f2 | sort -u | wc -l | tr -d ' ')"
[[ "$distintas" = 3 ]] || { echo "0660: una llave tuvo más de un dueño ($distintas distintas de 3)"; exit 1; }
[[ "$("${psql_cmd[@]}" -c "select count(*) from public.regla_disparo where regla_id='$r' and estado='enviando';")" = 3 ]] || { echo '0660: no quedaron 3 llaves enviando'; exit 1; }

# ── (2) arriendo vencido: 8 sesiones lo retoman a la vez ────────────────────
correr b "now() + interval '10 minutes'"
ganadas="$(cat "$work"/b.* | grep -c . || true)"
[[ "$ganadas" = 3 ]] || { echo "0660: al retomar el arriendo vencido ganaron $ganadas llaves (debían ser 3)"; exit 1; }
[[ "$(cat "$work"/b.* | grep . | cut -d'|' -f2 | sort -u | wc -l | tr -d ' ')" = 3 ]] || { echo '0660: una llave retomada tuvo más de un dueño'; exit 1; }

# ── (3) 8 sesiones confirman a la vez el token que quedó vigente ────────────
pids=()
for n in $(seq 1 8); do
  "${psql_cmd[@]}" -c "select public.confirmar_disparos_regla('$t','$r',(select reclamo_token from public.regla_disparo where regla_id='$r' limit 1));" > "$work/c.$n" 2> "$work/ec.$n" & pids+=($!)
done
for p in "${pids[@]}"; do wait "$p"; done
cat "$work"/ec.* | grep -q . && { echo '0660: una confirmación lanzó error'; cat "$work"/ec.*; exit 1; }
[[ "$(cat "$work"/c.* | paste -sd+ - | bc)" = 3 ]] || { echo "0660: la suma de llaves confirmadas no es 3 ($(cat "$work"/c.* | paste -sd+ -))"; exit 1; }
[[ "$("${psql_cmd[@]}" -c "select count(*) from public.regla_disparo where regla_id='$r' and estado='enviado' and reclamo_token is null;")" = 3 ]] || { echo '0660: no quedaron 3 sellos enviado'; exit 1; }

# ── (4) ya selladas, nadie las reclama (ni con el reloj adelantado) ─────────
correr d "now() + interval '1 day'"
[[ "$(cat "$work"/d.* | grep -c . || true)" = 0 ]] || { echo '0660: se reclamó una llave ya enviada'; exit 1; }
echo '0660_reglas_reclamo_concurrencia PASS: 8 sesiones simultáneas reclaman, retoman, confirman y re-reclaman sin llaves con dos dueños ni errores.'
