#!/usr/bin/env bash
# 05-concurrencia.sh — DOS PASADAS DEL MISMO CRON A LA VEZ sobre la base de 250 camiones.
# Sin dobles envíos (claims atómicos) y sin deadlocks. Lee PGHOST/PGPORT/PGUSER del entorno.
# Cada fase lanza N sesiones psql simultáneas que hacen lo mismo que el cron real (RPC / INSERT … ON CONFLICT
# DO NOTHING de los claims) y cuenta ganadores. Efectos: los claims se REVIERTEN al final (se restauran
# las columnas que tocan); no se tocan otras tablas.
# Además de lo de aquí, los .sh de supabase/tests/*_concurrencia.sh corren tal cual sobre esta misma base.
set -euo pipefail
T="${CARGA_TENANT:-aaaaaaaa-0000-4000-8000-000000000250}"
SES="${SESIONES:-2}"                      # 2 = «dos pasadas a la vez»; subir a 8 para estrés
q() { psql -X -v ON_ERROR_STOP=1 -qAt "$@"; }
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
fallos=0
chk() { if [[ "$2" == "$3" ]]; then echo "OK   $1 ($2)"; else echo "FALLA $1: esperado $3, salió $2"; fallos=$((fallos+1)); fi; }

# ── 1. Carta Porte: cp_documento_reclamar sobre los documentos 'recibido' ─────────────────────────
q -c "update cp_documento set estado='recibido', procesando_hasta=null, intentos=0 where tenant_id='$T' and estado in ('recibido','procesando')" >/dev/null
n_pend=$(q -c "select count(*) from cp_documento where tenant_id='$T' and estado='recibido'")
q -c "select id from cp_documento where tenant_id='$T' and estado='recibido' order by id" > "$work/ids"
for s in $(seq 1 "$SES"); do
  ( while read -r id; do q -c "select count(*) from cp_documento_reclamar('$T','$id',120)"; done < "$work/ids" | awk '{s+=$1} END{print s+0}' > "$work/cp.$s" ) &
done; wait
ganados=0; for s in $(seq 1 "$SES"); do ganados=$((ganados + $(cat "$work/cp.$s"))); done
chk "carta-porte: reclamos ganados == documentos pendientes (cada documento lo gana UNA sesión)" "$ganados" "$n_pend"
q -c "update cp_documento set estado='recibido', procesando_hasta=null, intentos=0 where tenant_id='$T' and estado='procesando'" >/dev/null

# ── 2. Conductor: claim de avisos (viaje_hito_aviso, unique hito/ciclo/clase/nivel) ───────────────
q -c "delete from viaje_hito_aviso where tenant_id='$T' and clase='recordatorio' and nivel=7" >/dev/null
n_hitos=$(q -c "select count(*) from viaje_hito where tenant_id='$T' and estado='esperado'")
for s in $(seq 1 "$SES"); do
  ( q -c "with i as (insert into viaje_hito_aviso (tenant_id, viaje_id, viaje_hito_id, ciclo, clase, nivel)
                     select tenant_id, viaje_id, id, 1, 'recordatorio', 7 from viaje_hito where tenant_id='$T' and estado='esperado'
                     on conflict (viaje_hito_id, ciclo, clase, nivel) do nothing returning 1) select count(*) from i" > "$work/av.$s" ) &
done; wait
gan=0; for s in $(seq 1 "$SES"); do gan=$((gan + $(cat "$work/av.$s"))); done
chk "conductor: avisos ganados entre $SES sesiones == hitos esperados" "$gan" "$n_hitos"
chk "conductor: filas en viaje_hito_aviso (una por hito)" "$(q -c "select count(*) from viaje_hito_aviso where tenant_id='$T' and clase='recordatorio' and nivel=7")" "$n_hitos"
q -c "delete from viaje_hito_aviso where tenant_id='$T' and clase='recordatorio' and nivel=7" >/dev/null

# ── 3. Dos pasadas simultáneas de RPC de cron con escritura (sin deadlock ni error) ───────────────
log="$work/rpc.log"
for s in $(seq 1 "$SES"); do
  ( q -c "select sembrar_hitos_conductor(500); select cerrar_hitos_viajes_vencidos(30,500,now()); select * from cp_documentos_pendientes(50,3,0);
          select * from peaje_archivo_reclamar(5,120)" >> "$log" 2>&1 || true ) &
done; wait
if grep -qi "deadlock" "$log"; then echo "FALLA rpc de cron: deadlock"; fallos=$((fallos+1)); else echo "OK   rpc de cron simultáneas sin deadlock"; fi

# ── 4. Purgas simultáneas (borrado por tandas) ───────────────────────────────────────────────────
for s in $(seq 1 "$SES"); do
  ( q -c "begin; select purgar_posicion(90, now(), now() + interval '30 seconds'); select mantener_ledgers(now(), now() + interval '30 seconds', 90,90,90,90); rollback" > "$work/pg.$s" 2>&1 || echo "ERR purga $s" >> "$work/pg.err" ) &
done; wait
[[ -f "$work/pg.err" ]] && { echo "FALLA purgas simultáneas"; cat "$work/pg.$((1))" | head -3; fallos=$((fallos+1)); } || echo "OK   purgas simultáneas sin error ni deadlock"
grep -il deadlock "$work"/pg.* >/dev/null 2>&1 && { echo "FALLA purgas: deadlock"; fallos=$((fallos+1)); } || true

[[ $fallos -eq 0 ]] && echo "05-concurrencia: PASS" || { echo "05-concurrencia: $fallos fallo(s)"; exit 1; }
