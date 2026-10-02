#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# PRUEBA: el seed corre DOS veces (una tercera tras --reiniciar y una cuarta tras vaciar) sin duplicar
# ni cambiar nada (y que vaciar + re-sembrar vuelve al mismo estado). Compara, tabla por tabla, conteo + huella md5 de la
# FILA COMPLETA (to_jsonb, sin created_at/updated_at). FALLA si alguna tabla tiene 0 filas: una huella de nada no prueba nada.
#
#   DEMO_DATABASE_URL='postgresql:///likida_demo' bash scripts/demo/innovativos/probar-idempotencia.sh
#
# Sale 0 si las huellas coinciden en las tres corridas; 1 si no. Además prueba
# que el rol de solo lectura NO puede escribir en la tabla propia simulada.
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")"
URL="${DEMO_DATABASE_URL:?define DEMO_DATABASE_URL}"
node ./guarda-host.mjs || exit $?   # sembrar.sh y vaciar-sintetico.sh la repiten; aquí también corre psql directo
T=eeeeeeee-0620-4000-8000-000000000250
# shellcheck source=lib_huella.sh
. ./lib_huella.sh
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# Huella de CADA tabla del demo: conteo + md5 de la FILA COMPLETA (to_jsonb), no de unas cuantas columnas.
# Solo se excluyen las marcas de reloj del servidor (created_at/updated_at/creado_en/creada_en/actualizado_en) y, en `posicion`, el
# id (bigserial: cambia cada vez que se borra y se vuelve a insertar). Así una columna que se pierde
# (p. ej. viaje.origen_geocerca_id tras borrar las geocercas) cambia la huella.
# Cada entrada: «nombre|tabla|filtro SQL sobre t|columnas extra a excluir (coma)».
TABLAS=(
  "tenant|tenant|t.id = '$T'"
  "terminal|terminal|t.tenant_id = '$T'"
  "cliente|cliente|t.tenant_id = '$T'"
  "geocerca|geocerca|t.tenant_id = '$T'"
  "unidad|unidad|t.tenant_id = '$T'"
  "operador|operador|t.tenant_id = '$T'"
  "viaje|viaje|t.tenant_id = '$T'"
  "viaje_hito|viaje_hito|t.tenant_id = '$T'"
  "viaje_hito_validacion|viaje_hito_validacion|t.tenant_id = '$T'"
  "posicion|posicion|t.tenant_id = '$T'|id"
  "sim.gps_posicion|innovativos_sim.gps_posicion|true"
  "peaje_caseta|peaje_caseta|t.tenant_id = '$T'"
  "peaje_tag|peaje_tag|t.tenant_id = '$T'"
  "desglose_peaje_linea|desglose_peaje_linea|t.tenant_id = '$T'"
  "peaje_curso|peaje_curso|t.tenant_id = '$T'"
  "peaje_curso_caseta|peaje_curso_caseta|t.tenant_id = '$T'"
  "liquidacion_externa|liquidacion_externa|t.tenant_id = '$T'"
  "cp_documento|cp_documento|t.tenant_id = '$T'"
  "cp_perfil|cp_perfil|t.tenant_id = '$T'"
  "vigia_config|vigia_config|t.tenant_id = '$T'"
  "vigia_contacto|vigia_contacto|t.tenant_id = '$T'"
  "vigia_conversacion|vigia_conversacion|t.tenant_id = '$T'"
  "vigia_mensaje|vigia_mensaje|t.tenant_id = '$T'"
  "agente_conductor_config|agente_conductor_config|t.tenant_id = '$T'"
  "conductor_contacto_trafico|conductor_contacto_trafico|t.tenant_id = '$T'"
  "sim.convenio_instruccion|innovativos_sim.convenio_instruccion|true"
  "desglose_peaje|desglose_peaje|t.tenant_id = '$T'"
  "geocerca_poligono|geocerca|t.tenant_id = '$T' and t.poligono is not null"
  "viaje_cruce_geocerca|viaje_cruce_geocerca|t.tenant_id = '$T'"
  "viaje_senal_vida|viaje_senal_vida|t.tenant_id = '$T'"
  "liquidacion_formato_flota|liquidacion_formato_flota|t.tenant_id = '$T'"
  "liquidacion_aviso_discrepancia|liquidacion_aviso_discrepancia|t.tenant_id = '$T'"
  "orquestador_escalacion|orquestador_escalacion|t.tenant_id = '$T'"
  "vigia_grupo|vigia_grupo|t.tenant_id = '$T'"
  "vigia_historial_import|vigia_historial_import|t.tenant_id = '$T'"
  "vigia_historial_mensaje|vigia_historial_mensaje|t.tenant_id = '$T'|id"
  "vigia_respuesta_rapida|vigia_respuesta_rapida|t.tenant_id = '$T'"
  "cliente_convenio|cliente_convenio|t.tenant_id = '$T'"
  "convenio_instruccion|convenio_instruccion|t.tenant_id = '$T'"
)

huella() {
  local def nombre tabla filtro extra excl
  for def in "${TABLAS[@]}"; do
    IFS='|' read -r nombre tabla filtro extra <<<"$def"
    excl="'created_at','updated_at','creado_en','creada_en','actualizado_en'"
    [ -z "${extra:-}" ] || excl="$excl,'${extra//,/\',\'}'"
    psql "$URL" -Atq -v ON_ERROR_STOP=1 -c "select '$nombre', count(*), coalesce(md5(string_agg(j::text, ',' order by j::text)), 'vacio') from (select to_jsonb(t) - array[$excl] as j from $tabla t where $filtro) q"
  done
}

echo "== corrida 1 =="; bash ./sembrar.sh --reiniciar >/dev/null; huella > "$TMP/h1.txt"
echo "== corrida 2 (sin reiniciar: no debe cambiar nada) =="; bash ./sembrar.sh >/dev/null; huella > "$TMP/h2.txt"
echo "== corrida 3 (tras --reiniciar: mismo resultado desde cero) =="; bash ./sembrar.sh --reiniciar >/dev/null; huella > "$TMP/h3.txt"

echo "== corrida 4 (vaciar TODO lo sintético y volver a sembrar: mismo resultado) =="
for q in gps geocercas pases liquidaciones cartaporte vigia convenios; do bash ./vaciar-sintetico.sh "$q" >/dev/null; done
bash ./sembrar.sh >/dev/null; huella > "$TMP/h4.txt"

cat "$TMP/h1.txt"
ok=1
comprobar_huellas "${#TABLAS[@]}" "$TMP/h1.txt" "$TMP/h2.txt" "$TMP/h3.txt" "$TMP/h4.txt" || ok=0

# Relaciones que el borrado de geocercas rompe (ON DELETE SET NULL): origen y destino de TODOS los viajes.
n=$(psql "$URL" -Atq -c "select count(*) from viaje where tenant_id = '$T' and (origen_geocerca_id is null or destino_geocerca_id is null)")
[ "$n" = "0" ] || { echo "FALLA: $n viajes sin origen_geocerca_id/destino_geocerca_id" >&2; ok=0; }

# Nadie real puede recibir un mensaje: todo teléfono del tenant demo lleva la marca 28999 y los agentes que escriben vienen apagados.
n=$(psql "$URL" -Atq -c "select count(*) from (select telefono from cliente where tenant_id = '$T' union all select telefono from operador where tenant_id = '$T' union all select telefono from vigia_contacto where tenant_id = '$T' union all select telefono from conductor_contacto_trafico where tenant_id = '$T' union all select unnest(copia_telefonos) from liquidacion_formato_flota where tenant_id = '$T' union all select unnest(discrepancia_telefonos) from liquidacion_formato_flota where tenant_id = '$T' union all select unnest(telefonos_aceptados) from liquidacion_aviso_discrepancia where tenant_id = '$T') x where telefono is null or telefono not like '28999%'")
[ "$n" = "0" ] || { echo "FALLA: $n teléfonos del tenant demo SIN la marca 28999 (podrían ser de alguien)" >&2; ok=0; }
# Copia al jefe y aviso de discrepancia SEMBRADOS (sin ellos el guion no tiene qué enseñar), y ningún aviso con salida pendiente.
n=$(psql "$URL" -Atq -c "select (select count(*) from liquidacion_formato_flota where tenant_id = '$T' and cardinality(copia_telefonos) > 0 and cardinality(discrepancia_telefonos) > 0)")
[ "$n" = "1" ] || { echo "FALLA: el formato de la flota no trae teléfonos de copia y de discrepancia sembrados" >&2; ok=0; }
n=$(psql "$URL" -Atq -c "select (select count(*) from liquidacion_aviso_discrepancia where tenant_id = '$T' and estado in ('pendiente', 'enviando')) + (select count(*) from orquestador_escalacion where tenant_id = '$T' and aviso_estado = 'pendiente') + (select count(*) from liquidacion_externa where tenant_id = '$T' and estado in ('pendiente', 'en_cola'))")
[ "$n" = "0" ] || { echo "FALLA: hay $n avisos o liquidaciones del tenant demo con salida pendiente (algún cron intentaría mandarlos)" >&2; ok=0; }
n=$(psql "$URL" -Atq -c "select (select count(*) from vigia_config where tenant_id = '$T' and habilitado) + (select count(*) from agente_conductor_config where tenant_id = '$T' and (activo or avisar_senal_vida))")
[ "$n" = "0" ] || { echo "FALLA: el Vigía o el Conductor del tenant demo están ENCENDIDOS tras sembrar (deben venir apagados)" >&2; ok=0; }

echo "== rol de solo lectura =="
err="$(psql "$URL" -q -v ON_ERROR_STOP=1 -c "set role innovativos_demo_lector; insert into innovativos_sim.gps_posicion values ('X', 1, 1, now(), 1, 1)" 2>&1 >/dev/null || true)"
case "$err" in
  *"permission denied"*) echo "ok: el rol de lectura no puede escribir (permission denied)" ;;
  *) echo "FALLA: el insert del rol de lectura no fue rechazado por permisos (salida: ${err:-<sin error: pudo ESCRIBIR>})" >&2; ok=0 ;;
esac
n=$(psql "$URL" -Atq -c "set role innovativos_demo_lector; select count(*) from innovativos_sim.v_gps_actual" | tail -1)
[ "$n" = "250" ] && echo "ok: el rol de lectura ve las 250 unidades en la vista «al momento»" || { echo "FALLA: el rol ve $n unidades" >&2; ok=0; }

[ "$ok" = 1 ] && echo "IDEMPOTENCIA OK" || { echo "IDEMPOTENCIA FALLÓ" >&2; exit 1; }
