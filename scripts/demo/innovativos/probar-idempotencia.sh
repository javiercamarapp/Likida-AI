#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# PRUEBA: el seed corre DOS veces (y una tercera tras --reiniciar) sin duplicar
# ni cambiar nada. Compara, tabla por tabla, conteo + huella md5 del contenido.
#
#   DEMO_DATABASE_URL='postgresql:///likida_demo' bash scripts/demo/innovativos/probar-idempotencia.sh
#
# Sale 0 si las huellas coinciden en las tres corridas; 1 si no. Además prueba
# que el rol de solo lectura NO puede escribir en la tabla propia simulada.
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")"
URL="${DEMO_DATABASE_URL:?define DEMO_DATABASE_URL}"
T=eeeeeeee-0620-4000-8000-000000000250

huella() {
  psql "$URL" -Atq -v ON_ERROR_STOP=1 <<SQL
select 'tenant', count(*), md5(string_agg(id::text, ',' order by id)) from tenant where id = '$T'
union all select 'terminal', count(*), md5(string_agg(id::text, ',' order by id)) from terminal where tenant_id = '$T'
union all select 'cliente', count(*), md5(string_agg(id::text, ',' order by id)) from cliente where tenant_id = '$T'
union all select 'geocerca', count(*), md5(string_agg(id::text, ',' order by id)) from geocerca where tenant_id = '$T'
union all select 'unidad', count(*), md5(string_agg(id::text || coalesce(gps_visto_en::text, ''), ',' order by id)) from unidad where tenant_id = '$T'
union all select 'operador', count(*), md5(string_agg(id::text, ',' order by id)) from operador where tenant_id = '$T'
union all select 'viaje', count(*), md5(string_agg(id::text || estatus || folio, ',' order by id)) from viaje where tenant_id = '$T'
union all select 'viaje_hito', count(*), md5(string_agg(id::text || estado, ',' order by id)) from viaje_hito where tenant_id = '$T'
union all select 'posicion', count(*), md5(string_agg(unidad_id::text || medida_en::text || lat::text, ',' order by unidad_id, medida_en)) from posicion where tenant_id = '$T'
union all select 'sim.gps_posicion', count(*), md5(string_agg(id_unidad || fecha_hora::text || latitud::text, ',' order by id_unidad, fecha_hora)) from innovativos_sim.gps_posicion
union all select 'peaje_caseta', count(*), md5(string_agg(id::text, ',' order by id)) from peaje_caseta where tenant_id = '$T'
union all select 'peaje_tag', count(*), md5(string_agg(id::text, ',' order by id)) from peaje_tag where tenant_id = '$T'
union all select 'desglose_peaje_linea', count(*), md5(string_agg(id::text || gps_veredicto, ',' order by id)) from desglose_peaje_linea where tenant_id = '$T'
union all select 'liquidacion_externa', count(*), md5(string_agg(id::text || total::text || estado, ',' order by id)) from liquidacion_externa where tenant_id = '$T'
union all select 'cp_documento', count(*), md5(string_agg(id::text || estado, ',' order by id)) from cp_documento where tenant_id = '$T'
union all select 'cp_perfil', count(*), md5(string_agg(id::text, ',' order by id)) from cp_perfil where tenant_id = '$T'
union all select 'vigia_mensaje', count(*), md5(string_agg(id::text, ',' order by id)) from vigia_mensaje where tenant_id = '$T'
union all select 'conductor_contacto_trafico', count(*), md5(string_agg(id::text, ',' order by id)) from conductor_contacto_trafico where tenant_id = '$T'
union all select 'sim.convenio_instruccion', count(*), md5(string_agg(clave || categoria || texto, ',' order by clave, categoria)) from innovativos_sim.convenio_instruccion
order by 1;
SQL
}

echo "== corrida 1 =="; bash ./sembrar.sh --reiniciar >/dev/null; huella > /tmp/inn_h1.txt
echo "== corrida 2 (sin reiniciar: no debe cambiar nada) =="; bash ./sembrar.sh >/dev/null; huella > /tmp/inn_h2.txt
echo "== corrida 3 (tras --reiniciar: mismo resultado desde cero) =="; bash ./sembrar.sh --reiniciar >/dev/null; huella > /tmp/inn_h3.txt

cat /tmp/inn_h1.txt
ok=1
diff -q /tmp/inn_h1.txt /tmp/inn_h2.txt >/dev/null || { echo "FALLA: la 2.ª corrida cambió filas" >&2; diff /tmp/inn_h1.txt /tmp/inn_h2.txt >&2 || true; ok=0; }
diff -q /tmp/inn_h1.txt /tmp/inn_h3.txt >/dev/null || { echo "FALLA: --reiniciar no reproduce lo mismo" >&2; diff /tmp/inn_h1.txt /tmp/inn_h3.txt >&2 || true; ok=0; }

echo "== rol de solo lectura =="
if psql "$URL" -q -v ON_ERROR_STOP=1 -c "set role innovativos_demo_lector; insert into innovativos_sim.gps_posicion values ('X', 1, 1, now(), 1, 1)" >/dev/null 2>&1; then
  echo "FALLA: el rol de lectura pudo ESCRIBIR" >&2; ok=0
else echo "ok: el rol de lectura no puede escribir"; fi
n=$(psql "$URL" -Atq -c "set role innovativos_demo_lector; select count(*) from innovativos_sim.v_gps_actual" | tail -1)
[ "$n" = "250" ] && echo "ok: el rol de lectura ve las 250 unidades en la vista «al momento»" || { echo "FALLA: el rol ve $n unidades" >&2; ok=0; }

[ "$ok" = 1 ] && echo "IDEMPOTENCIA OK" || { echo "IDEMPOTENCIA FALLÓ" >&2; exit 1; }
