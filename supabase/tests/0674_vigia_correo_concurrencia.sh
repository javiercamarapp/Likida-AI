#!/usr/bin/env bash
# Vigía, respaldo por correo (0674): sesiones reales de Postgres compiten por el MISMO correo de respaldo.
#   (1) 8 sesiones reclaman a la vez la misma llave: gana EXACTAMENTE una (un solo correo) y nadie recibe error;
#   (2) con el arriendo vencido, 8 sesiones lo retoman a la vez: otra vez un solo dueño;
#   (3) 8 sesiones cierran a la vez con el token vigente: solo una lo cierra;
#   (4) ya cerrado, 8 sesiones más no reclaman nada (ni con el reloj adelantado).
# Exclusivo PostgreSQL desechable; UUIDs y objetos sintéticos propios.
set -euo pipefail
host="${1:?uso: $0 HOST PORT DB}"
port="${2:?uso: $0 HOST PORT DB}"
database="${3:?uso: $0 HOST PORT DB}"
t='67400000-0000-4000-8000-0000000c0001'
cli='67400000-0000-4000-8000-0000000c0002'
con='67400000-0000-4000-8000-0000000c0003'
conv='67400000-0000-4000-8000-0000000c0004'
psql_cmd=(psql -h "$host" -p "$port" -d "$database" -X -v ON_ERROR_STOP=1 -qAt)
work="$(mktemp -d)"
limpiar() {
  "${psql_cmd[@]}" -c "delete from public.tenant where id='$t';" >/dev/null 2>&1 || true
  rm -rf "$work"
}
[[ "$("${psql_cmd[@]}" -c "select count(*) from public.tenant where id='$t';")" = 0 ]] || { echo 'Fixture0674 ya existe; no tocar datos ajenos.'; exit 1; }
trap limpiar EXIT
"${psql_cmd[@]}" >/dev/null <<SQL
insert into public.tenant(id,nombre) values('$t','Vigia 0674 concurrencia');
insert into public.cliente(id,tenant_id,nombre) values('$cli','$t','Cliente');
insert into public.vigia_contacto(id,tenant_id,cliente_id,telefono,telefono_hash,nombre,consentimiento_en,consentimiento_origen)
  values('$con','$t','$cli','525574000001',repeat('d',64),'Compras',now(),'alta_flota');
insert into public.vigia_conversacion(id,tenant_id,contacto_id,cliente_id) values('$conv','$t','$con','$cli');
SQL
datos='{"cliente":"Cliente","motivo":"sin_respuesta","minutos":45,"nivel":1}'

reclamar() { # $1 = prefijo de archivo, $2 = sesión, $3 = reloj lógico (opcional)
  local reloj="${3:-clock_timestamp()}"
  "${psql_cmd[@]}" -c "select o_id || '|' || o_token from public.vigia_correo_reclamar('$t','$conv','ciclo:n1:abc',1,null,'dir@empresa.mx','$datos'::jsonb,300,$reloj);" > "$work/$1.$2" 2> "$work/e$1.$2"
}
correr() { # 8 sesiones simultáneas
  local pids=() n
  for n in $(seq 1 8); do reclamar "$1" "$n" "${2:-clock_timestamp()}" & pids+=($!); done
  for p in "${pids[@]}"; do wait "$p"; done
  cat "$work"/e"$1".* | grep -q . && { echo "0674 concurrencia ($1): una sesión lanzó error"; cat "$work"/e"$1".*; exit 1; }
  return 0
}

# ── (1) 8 sesiones sobre la misma llave ─────────────────────────────────────
correr a
ganadas="$(cat "$work"/a.* | grep -c . || true)"
[[ "$ganadas" = 1 ]] || { echo "0674: entre 8 sesiones ganaron $ganadas reclamos (debía ser exactamente 1)"; exit 1; }
[[ "$("${psql_cmd[@]}" -c "select count(*) from public.vigia_aviso_correo where tenant_id='$t';")" = 1 ]] || { echo '0674: no quedó exactamente una fila'; exit 1; }

# ── (2) arriendo vencido: 8 sesiones lo retoman a la vez ────────────────────
correr b "now() + interval '10 minutes'"
[[ "$(cat "$work"/b.* | grep -c . || true)" = 1 ]] || { echo '0674: al retomar el arriendo vencido no ganó exactamente una sesión'; exit 1; }
token="$(cat "$work"/b.* | grep . | cut -d'|' -f2)"
id="$(cat "$work"/b.* | grep . | cut -d'|' -f1)"

# ── (3) 8 sesiones cierran a la vez con el token vigente ────────────────────
pids=()
for n in $(seq 1 8); do
  "${psql_cmd[@]}" -c "select public.vigia_correo_cerrar('$t','$id','$token','enviado',null);" > "$work/c.$n" 2> "$work/ec.$n" & pids+=($!)
done
for p in "${pids[@]}"; do wait "$p"; done
cat "$work"/ec.* | grep -q . && { echo '0674: un cierre lanzó error'; cat "$work"/ec.*; exit 1; }
[[ "$(cat "$work"/c.* | grep -c '^t$' || true)" = 1 ]] || { echo "0674: no cerró exactamente una sesión ($(cat "$work"/c.* | paste -sd, -))"; exit 1; }
[[ "$("${psql_cmd[@]}" -c "select estado from public.vigia_aviso_correo where tenant_id='$t';")" = enviado ]] || { echo '0674: no quedó enviado'; exit 1; }

# ── (4) ya cerrado, nadie lo reclama (ni con el reloj adelantado) ───────────
correr d "now() + interval '1 day'"
[[ "$(cat "$work"/d.* | grep -c . || true)" = 0 ]] || { echo '0674: se reclamó un correo ya enviado'; exit 1; }
echo '0674_vigia_correo_concurrencia PASS: 8 sesiones simultáneas reclaman, retoman, cierran y re-reclaman sin un correo con dos dueños ni errores.'
