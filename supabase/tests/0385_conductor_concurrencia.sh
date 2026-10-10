#!/usr/bin/env bash
# Sesiones reales de Postgres compiten por lo que el Agente 5 (0385) promete como atómico:
#   (1) 24 sesiones aplican veredictos MEZCLADOS sobre el mismo hito: queda UN veredicto (el mejor), el hito validado una
#       sola vez y ningún error;
#   (2) 12 sesiones capturan A MANO el mismo hito: EXACTAMENTE una gana, las demás dicen `hito_cambio`, y la bitácora
#       trae UN renglón (hito + bitácora en la misma transacción);
#   (3) 12 sesiones marcan atendida la misma escalación: se marca UNA vez, con UN renglón de bitácora;
#   (4) 8 sesiones importan EL MISMO catálogo a la vez: cero errores de unicidad y cero duplicados.
# Exclusivo PostgreSQL desechable; UUIDs y objetos sintéticos propios.
set -euo pipefail
host="${1:?uso: $0 HOST PORT DB}"
port="${2:?uso: $0 HOST PORT DB}"
database="${3:?uso: $0 HOST PORT DB}"
t='38500000-0000-4000-8000-0000000c0001'
op='38500000-0000-4000-8000-0000000c0002'
v='38500000-0000-4000-8000-0000000c0003'
psql_cmd=(psql -h "$host" -p "$port" -d "$database" -X -v ON_ERROR_STOP=1 -qAt)
work="$(mktemp -d)"
limpiar() {
  "${psql_cmd[@]}" -c "delete from public.tenant where id='$t';" >/dev/null 2>&1 || true
  rm -rf "$work"
}
[[ "$("${psql_cmd[@]}" -c "select count(*) from public.tenant where id='$t';")" = 0 ]] || { echo 'Fixture0385 ya existe; no tocar datos ajenos.'; exit 1; }
trap limpiar EXIT
"${psql_cmd[@]}" >/dev/null <<SQL
insert into public.tenant(id,nombre) values('$t','Conductor 0385 concurrencia');
insert into public.operador(id,tenant_id,nombre,telefono) values('$op','$t','Chofer','525500038599');
insert into public.geocerca(id,tenant_id,nombre,tipo,lat,lng,radio_m) values('38500000-0000-4000-8000-0000000c0010','$t','Planta','planta',20.72,-103.39,300);
insert into public.viaje(id,tenant_id,operador_id,folio,estatus,avisado_en,aceptado_en)
  values('$v','$t','$op','C-1','abierto', now() - interval '5 hours', now() - interval '5 hours');
select count(*) from (select public.sembrar_hitos_conductor(10)) _;
update public.viaje_hito set estado='recibido', fuente='texto', interpretacion='regla', mensaje_en=now()-interval '4 hours', recibido_en=now()-interval '4 hours'
 where viaje_id='$v' and tipo='llegada_carga';
SQL
hito_llegada="$("${psql_cmd[@]}" -c "select id from public.viaje_hito where viaje_id='$v' and tipo='llegada_carga';")"
hito_salida="$("${psql_cmd[@]}" -c "select id from public.viaje_hito where viaje_id='$v' and tipo='salida_carga';")"
hito_regreso="$("${psql_cmd[@]}" -c "select id from public.viaje_hito where viaje_id='$v' and tipo='regreso';")"
"${psql_cmd[@]}" -c "update public.viaje_hito set estado='escalado', escalado_en=now()-interval '1 hour', escalacion_nivel=1 where id='$hito_regreso';" >/dev/null

# ── (1) veredictos mezclados sobre el mismo hito ─────────────────────────────
pids=()
for n in $(seq 1 24); do
  case $((n % 3)) in
    0) args="'sin_dato', 'sin_ubicacion', null, null, 150, 300, '38500000-0000-4000-8000-0000000c0010'::uuid, null" ;;
    1) args="'sin_coincidencia', null, 'gps', 5000, 150, 300, '38500000-0000-4000-8000-0000000c0010'::uuid, now()" ;;
    2) args="'validado', null, 'pin', 30, 150, 300, '38500000-0000-4000-8000-0000000c0010'::uuid, now()" ;;
  esac
  ( "${psql_cmd[@]}" -c "select public.aplicar_validacion_hito('$t', '$hito_llegada', 1::smallint, $args)" > "$work/v$n" 2> "$work/ev$n" ) & pids+=($!)
done
for pid in "${pids[@]}"; do wait "$pid"; done
cat "$work"/ev* | grep -q . && { echo '0385 concurrencia: un veredicto lanzó error'; cat "$work"/ev*; exit 1; }
[[ "$("${psql_cmd[@]}" -c "select count(*) from public.viaje_hito_validacion where viaje_hito_id='$hito_llegada';")" = 1 ]] || { echo '0385: más de un veredicto para el mismo hito y ciclo'; exit 1; }
[[ "$("${psql_cmd[@]}" -c "select resultado from public.viaje_hito_validacion where viaje_hito_id='$hito_llegada';")" = validado ]] || { echo '0385: el veredicto final no es el mejor (validado)'; exit 1; }
[[ "$("${psql_cmd[@]}" -c "select estado || '/' || validado_por from public.viaje_hito where id='$hito_llegada';")" = 'validado/gps' ]] || { echo '0385: el hito no quedó validado por gps'; exit 1; }
[[ "$("${psql_cmd[@]}" -c "select count(*) from public.viaje_hito_evento where viaje_hito_id='$hito_llegada' and evento='validado';")" = 1 ]] || { echo '0385: el evento «validado» no es único'; exit 1; }

# ── (2) captura a mano del mismo hito ────────────────────────────────────────
pids=()
for n in $(seq 1 12); do
  ( "${psql_cmd[@]}" -c "select public.capturar_hito_oficina('$t', '$hito_salida', now() - interval '3 hours', null, 'jefe$n@test.invalid', 'captura concurrente $n', now())" > "$work/c$n" 2> "$work/ec$n" ) & pids+=($!)
done
for pid in "${pids[@]}"; do wait "$pid"; done
cat "$work"/ec* | grep -q . && { echo '0385 concurrencia: una captura lanzó error'; cat "$work"/ec*; exit 1; }
[[ "$(cat "$work"/c* | grep -c '^ok$')" = 1 ]] || { echo "0385: capturas ganadoras = $(cat "$work"/c* | grep -c '^ok$'), no 1"; exit 1; }
[[ "$(cat "$work"/c* | grep -c '^hito_cambio$')" = 11 ]] || { echo '0385: las 11 perdedoras no dijeron hito_cambio'; exit 1; }
[[ "$("${psql_cmd[@]}" -c "select count(*) from public.conductor_accion_oficina where viaje_hito_id='$hito_salida' and accion='captura_manual';")" = 1 ]] || { echo '0385: la bitácora de la captura no es de UN renglón'; exit 1; }

# ── (3) marcar atendida la misma escalación ──────────────────────────────────
pids=()
for n in $(seq 1 12); do
  ( "${psql_cmd[@]}" -c "select public.atender_escalacion_oficina('$t', '$v', null, 'jefe$n@test.invalid', 'ya lo atiendo $n', now())" > "$work/a$n" 2> "$work/ea$n" ) & pids+=($!)
done
for pid in "${pids[@]}"; do wait "$pid"; done
cat "$work"/ea* | grep -q . && { echo '0385 concurrencia: un «atender» lanzó error'; cat "$work"/ea*; exit 1; }
[[ "$(cat "$work"/a* | paste -sd+ - | bc)" = 1 ]] || { echo '0385: la escalación no se marcó atendida exactamente UNA vez'; exit 1; }
[[ "$("${psql_cmd[@]}" -c "select count(*) from public.conductor_accion_oficina where viaje_hito_id='$hito_regreso' and accion='atender';")" = 1 ]] || { echo '0385: la bitácora de atender no es de UN renglón'; exit 1; }

# ── (4) el mismo catálogo importado por 8 sesiones a la vez ──────────────────
catalogo='[{"linea":2,"codigo":"CC-1","nombre":"Concurrente uno","tipo":"planta","lat":20.1,"lng":-103.1,"radio_m":100,"direccion":null,"cliente":null,"padre":null},{"linea":3,"codigo":"CC-2","nombre":"Concurrente dos","tipo":"anden","lat":20.2,"lng":-103.2,"radio_m":50,"direccion":null,"cliente":null,"padre":"CC-1"}]'
pids=()
for n in $(seq 1 8); do
  ( "${psql_cmd[@]}" -c "select public.importar_sitios_conductor('$t', '$catalogo'::jsonb)" > "$work/i$n" 2> "$work/ei$n" ) & pids+=($!)
done
for pid in "${pids[@]}"; do wait "$pid"; done
cat "$work"/ei* | grep -q . && { echo '0385 concurrencia: una importación lanzó error (unicidad)'; cat "$work"/ei*; exit 1; }
[[ "$("${psql_cmd[@]}" -c "select count(*) from public.geocerca where tenant_id='$t' and codigo in ('CC-1','CC-2');")" = 2 ]] || { echo '0385: la importación concurrente duplicó o perdió sitios'; exit 1; }
[[ "$(cat "$work"/i* | grep -c '"creados": 2')" = 1 ]] || { echo '0385: exactamente UNA importación debía crear los 2 sitios'; exit 1; }
[[ "$("${psql_cmd[@]}" -c "select padre_id is not null from public.geocerca where tenant_id='$t' and codigo='CC-2';")" = t ]] || { echo '0385: el padre no quedó resuelto'; exit 1; }
echo "0385_conductor_concurrencia PASS: 24 veredictos mezclados, 12 capturas, 12 atenciones y 8 importaciones simultáneas sin duplicados ni errores."
