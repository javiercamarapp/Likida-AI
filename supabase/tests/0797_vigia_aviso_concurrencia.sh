#!/usr/bin/env bash
# Vigía, bandeja de avisos (0797): sesiones reales de Postgres compiten por el MISMO aviso.
#   (1) 8 sesiones reclaman a la vez el mismo aviso aprobado: gana EXACTAMENTE una y nadie recibe error;
#   (2) con el arriendo vencido, 8 sesiones lo retoman a la vez: otra vez un solo dueño;
#   (3) 8 sesiones cierran a la vez con el token vigente: solo una lo cierra;
#   (4) ya enviado, 8 sesiones más no reclaman nada (ni con el reloj adelantado);
#   (5) 8 sesiones encolan a la vez el MISMO contenido de la misma fila: queda una sola fila y nadie recibe error
#       distinto de la violación de unicidad esperada (idempotencia por huella);
#   (6) con la función apagada (habilitado=false) 8 sesiones no reclaman nada.
# Exclusivo PostgreSQL desechable; UUIDs y objetos sintéticos propios.
set -euo pipefail
host="${1:?uso: $0 HOST PORT DB}"
port="${2:?uso: $0 HOST PORT DB}"
database="${3:?uso: $0 HOST PORT DB}"
t='07970000-0000-4000-8000-0000000c0001'
fila='07970000-0000-4000-8000-0000000c0002'
av='07970000-0000-4000-8000-0000000c0003'
psql_cmd=(psql -h "$host" -p "$port" -d "$database" -X -v ON_ERROR_STOP=1 -qAt)
work="$(mktemp -d)"
limpiar() {
  "${psql_cmd[@]}" -c "delete from public.tenant where id='$t';" >/dev/null 2>&1 || true
  rm -rf "$work"
}
[[ "$("${psql_cmd[@]}" -c "select count(*) from public.tenant where id='$t';")" = 0 ]] || { echo 'Fixture0797 ya existe; no tocar datos ajenos.'; exit 1; }
trap limpiar EXIT
"${psql_cmd[@]}" >/dev/null <<SQL
insert into public.tenant(id,nombre) values('$t','Vigia 0797 concurrencia');
insert into public.programa_despacho_fila(id,tenant_id,terminal,fecha,tipo,num,clave_natural,huella)
  values('$fila','$t','T1',date '2026-10-05','EXPORTACION',1,'T1|2026-10-05|EXPORTACION||1','huella-conc');
insert into public.vigia_aviso_config(tenant_id,habilitado) values('$t',true);
insert into public.vigia_aviso(id,tenant_id,fila_id,huella,texto,estado,aprobado_en)
  values('$av','$t','$fila','0797c0c0c0c0c0c0','Aviso sintético de concurrencia','aprobado',now());
SQL

reclamar() { # $1 = prefijo de archivo, $2 = sesión, $3 = reloj lógico (opcional)
  local reloj="${3:-clock_timestamp()}"
  "${psql_cmd[@]}" -c "select o_id || '|' || o_token from public.vigia_aviso_reclamar('$t','$av',300,$reloj);" > "$work/$1.$2" 2> "$work/e$1.$2"
}
correr() { # 8 sesiones simultáneas
  local pids=() n
  for n in $(seq 1 8); do reclamar "$1" "$n" "${2:-clock_timestamp()}" & pids+=($!); done
  for p in "${pids[@]}"; do wait "$p"; done
  cat "$work"/e"$1".* | grep -q . && { echo "0797 concurrencia ($1): una sesión lanzó error"; cat "$work"/e"$1".*; exit 1; }
  return 0
}

# ── (6) apagada: nadie reclama ──────────────────────────────────────────────
"${psql_cmd[@]}" -c "update public.vigia_aviso_config set habilitado=false where tenant_id='$t';" >/dev/null
correr z
[[ "$(cat "$work"/z.* | grep -c . || true)" = 0 ]] || { echo '0797: se reclamó un aviso con la función apagada'; exit 1; }
"${psql_cmd[@]}" -c "update public.vigia_aviso_config set habilitado=true where tenant_id='$t';" >/dev/null

# ── (1) 8 sesiones sobre el mismo aviso ─────────────────────────────────────
correr a
ganadas="$(cat "$work"/a.* | grep -c . || true)"
[[ "$ganadas" = 1 ]] || { echo "0797: entre 8 sesiones ganaron $ganadas reclamos (debía ser exactamente 1)"; exit 1; }
[[ "$("${psql_cmd[@]}" -c "select intentos from public.vigia_aviso where id='$av';")" = 1 ]] || { echo '0797: los intentos no son 1 tras un solo reclamo ganador'; exit 1; }

# ── (2) arriendo vencido: 8 sesiones lo retoman a la vez ────────────────────
correr b "now() + interval '10 minutes'"
[[ "$(cat "$work"/b.* | grep -c . || true)" = 1 ]] || { echo '0797: al retomar el arriendo vencido no ganó exactamente una sesión'; exit 1; }
token="$(cat "$work"/b.* | grep . | cut -d'|' -f2)"

# ── (3) 8 sesiones cierran a la vez con el token vigente ────────────────────
pids=()
for n in $(seq 1 8); do
  "${psql_cmd[@]}" -c "select public.vigia_aviso_cerrar('$t','$av','$token','enviado',null);" > "$work/c.$n" 2> "$work/ec.$n" & pids+=($!)
done
for p in "${pids[@]}"; do wait "$p"; done
cat "$work"/ec.* | grep -q . && { echo '0797: un cierre lanzó error'; cat "$work"/ec.*; exit 1; }
[[ "$(cat "$work"/c.* | grep -c '^t$' || true)" = 1 ]] || { echo "0797: no cerró exactamente una sesión ($(cat "$work"/c.* | paste -sd, -))"; exit 1; }
[[ "$("${psql_cmd[@]}" -c "select estado from public.vigia_aviso where id='$av';")" = enviado ]] || { echo '0797: no quedó enviado'; exit 1; }

# ── (4) ya enviado, nadie lo reclama (ni con el reloj adelantado) ───────────
correr d "now() + interval '1 day'"
[[ "$(cat "$work"/d.* | grep -c . || true)" = 0 ]] || { echo '0797: se reclamó un aviso ya enviado'; exit 1; }

# ── (5) idempotencia: 8 sesiones encolan el MISMO contenido de la misma fila ─
pids=()
for n in $(seq 1 8); do
  "${psql_cmd[@]}" -c "insert into public.vigia_aviso(tenant_id,fila_id,version,huella,texto) values('$t','$fila',2,'0797d1d1d1d1d1d1','Aviso repetido');" \
    > "$work/i.$n" 2> "$work/ei.$n" & pids+=($!)
done
for p in "${pids[@]}"; do wait "$p" || true; done
# cada sesión terminó bien o con la violación de unicidad esperada, jamás con otro error
if cat "$work"/ei.* | grep -E '^(ERROR|ERROR:|psql:.*ERROR)' | grep -v -E 'vigia_aviso_(idempotencia|version_uq)' | grep -q .; then
  echo '0797: una inserción simultánea falló con un error inesperado'; cat "$work"/ei.*; exit 1
fi
[[ "$("${psql_cmd[@]}" -c "select count(*) from public.vigia_aviso where tenant_id='$t' and huella='0797d1d1d1d1d1d1';")" = 1 ]] \
  || { echo '0797: el mismo contenido quedó encolado más de una vez (o ninguna)'; exit 1; }
echo '0797_vigia_aviso_concurrencia PASS: 8 sesiones simultáneas reclaman, retoman, cierran y encolan sin un aviso con dos dueños, sin duplicados ni errores inesperados.'
