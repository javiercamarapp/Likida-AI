#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# PRUEBA (con base): vaciar-sintetico.sh quita SOLO lo que sembró el demo.
#
# Mete en el tenant demo filas «reales» (las que llegarían del cliente: sitios y posiciones con los mismos
# proveedor/fuente que usa su importador, un contacto y una conversación de Vigía propios, una unidad propia con
# su GPS) y corre `vaciar-sintetico.sh todo`. Pasa si lo SEMBRADO desapareció y lo «real» sigue intacto.
# Al final deja la base como estaba (sembrada de nuevo).
#
#   DEMO_DATABASE_URL='postgresql:///likida_demo' bash scripts/demo/innovativos/probar-vaciar-solo-sembrado.sh
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")"
URL="${DEMO_DATABASE_URL:?define DEMO_DATABASE_URL}"
node ./guarda-host.mjs || exit $?
T=eeeeeeee-0620-4000-8000-000000000250
q() { psql "$URL" -Atq -v ON_ERROR_STOP=1 "$@"; }

bash ./sembrar.sh --reiniciar >/dev/null
sembradas_antes="$(q -c "select (select count(*) from posicion where tenant_id='$T') + (select count(*) from geocerca where tenant_id='$T') + (select count(*) from vigia_mensaje where tenant_id='$T')")"
[ "$sembradas_antes" -gt 0 ] || { echo "FALLA: no hay nada sembrado: la prueba no prueba nada" >&2; exit 1; }

# ── Lo «real» (no sembrado por el demo) ─────────────────────────────────────
R_UNI=ffffffff-0620-4000-8000-0000000000a1; R_GEO=ffffffff-0620-4000-8000-0000000000a2
R_CON=ffffffff-0620-4000-8000-0000000000a3; R_CV=ffffffff-0620-4000-8000-0000000000a4; R_MSG=ffffffff-0620-4000-8000-0000000000a5
CLI="$(q -c "select id from cliente where tenant_id='$T' order by id limit 1")"
q <<SQL
insert into unidad (id, tenant_id, numero_economico, gps_proveedor, gps_device_id, gps_visto_en)
  values ('$R_UNI', '$T', 'REAL-001', 'tabla_propia', 'REAL-GPS-001', '2026-10-20 08:00:00-06');
insert into geocerca (id, tenant_id, nombre, tipo, lat, lng, radio_m, activa, codigo, fuente)
  values ('$R_GEO', '$T', 'Sitio real importado del CSV del cliente', 'planta', 21.0, -101.0, 200, true, 'REAL-SITIO-1', 'csv');
-- misma «proveedor» que el lector real de su tabla; recibida 3 min después (el demo siembra +20 s exactos)
insert into posicion (tenant_id, unidad_id, lat, lng, medida_en, recibida_en, proveedor)
  values ('$T', '$R_UNI', 21.0, -101.0, '2026-10-20 07:50:00-06', '2026-10-20 07:53:00-06', 'tabla_propia');
insert into vigia_contacto (id, tenant_id, cliente_id, telefono, telefono_hash, estado, consentimiento_en)
  values ('$R_CON', '$T', '$CLI', '28999900000001', repeat('a', 64), 'activo', '2026-10-01 00:00:00-06');
insert into vigia_conversacion (id, tenant_id, contacto_id, cliente_id) values ('$R_CV', '$T', '$R_CON', '$CLI');
insert into vigia_mensaje (id, tenant_id, conversacion_id, direccion, autor, estado, texto)
  values ('$R_MSG', '$T', '$R_CV', 'entrante', 'cliente', 'recibido', 'mensaje real');
SQL

bash ./vaciar-sintetico.sh todo >/dev/null

ok=1
reviso() { # nombre, consulta que debe dar 1
  local n; n="$(q -c "$2")"
  [ "$n" = "1" ] && echo "ok: sobrevive $1" || { echo "FALLA: vaciar borró lo «real»: $1 (esperaba 1, hay $n)" >&2; ok=0; }
}
reviso "la unidad real y su gps_visto_en" "select count(*) from unidad where id='$R_UNI' and gps_visto_en is not null"
reviso "el sitio real importado (fuente csv)" "select count(*) from geocerca where id='$R_GEO'"
reviso "la posición real (proveedor tabla_propia)" "select count(*) from posicion where tenant_id='$T' and unidad_id='$R_UNI'"
reviso "el contacto de Vigía real" "select count(*) from vigia_contacto where id='$R_CON'"
reviso "la conversación de Vigía real" "select count(*) from vigia_conversacion where id='$R_CV'"
reviso "el mensaje de Vigía real" "select count(*) from vigia_mensaje where id='$R_MSG'"

# …y lo sembrado SÍ se fue.
resto="$(q -c "select (select count(*) from posicion where tenant_id='$T' and unidad_id <> '$R_UNI') + (select count(*) from geocerca where tenant_id='$T' and id <> '$R_GEO') + (select count(*) from vigia_mensaje where tenant_id='$T' and id <> '$R_MSG') + (select count(*) from vigia_contacto where tenant_id='$T' and id <> '$R_CON') + (select count(*) from desglose_peaje_linea where tenant_id='$T') + (select count(*) from liquidacion_externa where tenant_id='$T' and sistema_origen = 'SAP (demo)')")"
[ "$resto" = "0" ] && echo "ok: lo sembrado se fue" || { echo "FALLA: quedaron $resto filas sembradas tras vaciar todo" >&2; ok=0; }

# Limpieza: se quita lo «real» y se deja la base sembrada como estaba.
bash ./sembrar.sh --reiniciar >/dev/null
[ "$ok" = 1 ] && echo "VACIAR SOLO SEMBRADO OK" || { echo "VACIAR SOLO SEMBRADO FALLÓ" >&2; exit 1; }
