#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# RESPALDO DE STORAGE (RES-8).
#
# `scripts/respaldo.sh` respalda la BASE. Los ARCHIVOS —las fotos de los
# comprobantes y los PDF de las liquidaciones— no los respaldaba nada, y son
# justo la parte que la ley obliga a conservar CINCO AÑOS (CFF art. 30). Un
# `pg_dump` sin ellos deja las filas apuntando a rutas de un bucket vacío: la
# liquidación existe, el papel que el contralor tiene que cruzar no.
#
# El plan de Supabase de este proyecto NO trae respaldo automático ni PITR
# (verificado contra la Management API el 4-ago-2026; ver la cabecera de
# `respaldo.sh`), y **el PITR de Supabase, cuando existe, es de la BASE, no de
# Storage** — o sea que este script sigue haciendo falta aunque se contrate.
#
# ── LO QUE HACE ─────────────────────────────────────────────────────────────
#   1. Lista, bucket por bucket y carpeta por carpeta, TODOS los objetos, con
#      la API de Storage y la service role.
#   2. Descarga a `$DESTINO/<bucket>/<ruta>` lo que no esté ya ahí con el
#      mismo tamaño — IDEMPOTENTE: correrlo dos veces no vuelve a bajar nada,
#      y una corrida cortada se retoma donde se quedó.
#   3. Compara CONTEO listado vs CONTEO en disco y falla si no cuadra. Un
#      respaldo que no se comprueba no es un respaldo (misma regla que el de
#      la base: un dump vacío se ve igual de exitoso que uno bueno).
#   4. Deja `MANIFIESTO.tsv` (bucket, ruta, bytes, sha256) para poder probar
#      la restauración sin adivinar.
#
# ── LO QUE **NO** HACE, DICHO ───────────────────────────────────────────────
#   · NO borra nada, ni del origen ni del destino. Un script de respaldo que
#     borra es un script de pérdida de datos esperando su turno.
#   · NO sube a ningún lado por su cuenta: si `RESPALDO_S3_DESTINO` está
#     puesto, hace el `aws s3 sync` AL FINAL y solo entonces; si no, se queda
#     en disco y lo dice. Sincronizar a ciegas contra un bucket mal escrito es
#     el modo de fallo caro.
#   · NO restaura. La restauración es una decisión humana y va en el runbook
#     (docs/conocimiento/DEPLOY.md).
#
# ── USO ─────────────────────────────────────────────────────────────────────
#   bash scripts/respaldo-storage.sh                 # → ~/Desktop/likida-storage
#   bash scripts/respaldo-storage.sh /ruta/destino
#
#   Variables (de `.env.local` si existe, o del entorno):
#     NEXT_PUBLIC_SUPABASE_URL     obligatoria
#     SUPABASE_SERVICE_ROLE_KEY    obligatoria — es la llave que salta RLS.
#     RESPALDO_BUCKETS             opcional, separados por espacio.
#                                  Default: comprobantes liquidaciones bus
#     RESPALDO_S3_DESTINO          opcional, p. ej. s3://likida-respaldos/storage
#                                  (funciona igual con R2 vía AWS_ENDPOINT_URL)
#
# NUNCA se ejecuta solo. No hay cron que lo llame: se corre a mano o desde una
# máquina de respaldo. Contra producción, con la service role, y eso se decide
# a conciencia.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")/.."

DESTINO="${1:-$HOME/Desktop/likida-storage}"

# `.env.local` solo si existe y SIN volcar el archivo entero al entorno: se
# leen las dos llaves que hacen falta, nada más.
leer_env() {
  local clave="$1"
  if [ -n "${!clave:-}" ]; then printf '%s' "${!clave}"; return; fi
  [ -f .env.local ] || return
  grep -m1 "^${clave}=" .env.local | cut -d= -f2- | tr -d '"' | tr -d "'"
}

URL="$(leer_env NEXT_PUBLIC_SUPABASE_URL)"
LLAVE="$(leer_env SUPABASE_SERVICE_ROLE_KEY)"
BUCKETS="${RESPALDO_BUCKETS:-comprobantes liquidaciones bus}"

if [ -z "$URL" ] || [ -z "$LLAVE" ]; then
  echo "✗ Faltan NEXT_PUBLIC_SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY (entorno o .env.local)." >&2
  exit 2
fi
command -v jq >/dev/null || { echo "✗ Falta jq (brew install jq)." >&2; exit 2; }

URL="${URL%/}"
MANIFIESTO="$DESTINO/MANIFIESTO.tsv"
mkdir -p "$DESTINO"
: > "$MANIFIESTO.tmp"

# `list` de Storage devuelve UNA carpeta por llamada y pagina de a 100 por
# default. Se recorre en anchura con una pila explícita: recursión en bash con
# miles de carpetas es una forma cara de descubrir el límite de la pila.
# Un objeto se distingue de una carpeta por `id != null` (una "carpeta" en
# Storage es un prefijo sintético: viene con `id: null`).
listar_bucket() {
  local bucket="$1"
  # Cola con ÍNDICE, no `${cola[@]:1}`: esa forma revienta con `set -u` en el
  # bash 3.2 que trae macOS cuando la cola queda con un solo elemento, y este
  # script tiene que correr también desde una máquina de respaldo cualquiera.
  local pendientes=("")
  local cabeza=0
  local prefijo respuesta offset n
  while [ "$cabeza" -lt "${#pendientes[@]}" ]; do
    prefijo="${pendientes[$cabeza]}"
    cabeza=$((cabeza + 1))
    offset=0
    while :; do
      respuesta="$(curl -sS -X POST "$URL/storage/v1/object/list/$bucket" \
        -H "Authorization: Bearer $LLAVE" -H "apikey: $LLAVE" \
        -H 'Content-Type: application/json' \
        -d "$(jq -nc --arg p "$prefijo" --argjson o "$offset" \
              '{prefix:$p, limit:1000, offset:$o, sortBy:{column:"name",order:"asc"}}')")"
      # Un error de la API llega como objeto con `error`/`message`, no como
      # arreglo: sin esta comprobación, `jq` devolvería vacío y el respaldo
      # se declararía completo con cero archivos.
      if [ "$(jq -r 'type' <<<"$respuesta")" != "array" ]; then
        echo "✗ $bucket: la API no devolvió una lista: $(jq -c . <<<"$respuesta")" >&2
        exit 1
      fi
      n="$(jq 'length' <<<"$respuesta")"
      [ "$n" -eq 0 ] && break
      while IFS=$'\t' read -r nombre id bytes; do
        local ruta="${prefijo:+$prefijo/}$nombre"
        if [ "$id" = "null" ]; then
          pendientes+=("$ruta")
        else
          printf '%s\t%s\t%s\n' "$bucket" "$ruta" "$bytes" >> "$MANIFIESTO.tmp"
        fi
      done < <(jq -r '.[] | [.name, (.id // "null"), (.metadata.size // 0)] | @tsv' <<<"$respuesta")
      offset=$((offset + n))
      [ "$n" -lt 1000 ] && break
    done
  done
}

echo "→ Listando buckets: $BUCKETS"
for b in $BUCKETS; do listar_bucket "$b"; done
TOTAL="$(wc -l < "$MANIFIESTO.tmp" | tr -d ' ')"
echo "  $TOTAL objeto(s) en el origen."

if [ "$TOTAL" -eq 0 ]; then
  # Cero puede ser la verdad (la base está en cero hasta que haya clientes),
  # pero también es exactamente lo que se ve cuando la llave no sirve. Se dice
  # y se sale con 0: no se escribe un manifiesto vacío encima del bueno.
  echo "⚠ Cero objetos. Si esperabas archivos, revisa la service role y RESPALDO_BUCKETS."
  rm -f "$MANIFIESTO.tmp"
  exit 0
fi

BAJADOS=0; SALTADOS=0
: > "$MANIFIESTO.nuevo"
while IFS=$'\t' read -r bucket ruta bytes; do
  destino="$DESTINO/$bucket/$ruta"
  mkdir -p "$(dirname "$destino")"
  # IDEMPOTENTE: si ya está con el mismo tamaño, no se vuelve a bajar. El
  # tamaño basta porque el nombre de un comprobante ES el hash de su
  # contenido (intake/almacen.ts) y un PDF se reescribe entero o no cambia.
  if [ -f "$destino" ] && [ "$(wc -c < "$destino" | tr -d ' ')" = "$bytes" ]; then
    SALTADOS=$((SALTADOS + 1))
  else
    curl -sS -f -o "$destino" \
      -H "Authorization: Bearer $LLAVE" -H "apikey: $LLAVE" \
      "$URL/storage/v1/object/$bucket/$ruta" \
      || { echo "✗ No pude bajar $bucket/$ruta" >&2; exit 1; }
    BAJADOS=$((BAJADOS + 1))
  fi
  printf '%s\t%s\t%s\t%s\n' "$bucket" "$ruta" "$bytes" "$(shasum -a 256 "$destino" | cut -d' ' -f1)" >> "$MANIFIESTO.nuevo"
done < "$MANIFIESTO.tmp"

# LA COMPROBACIÓN, que es la parte que convierte esto en un respaldo: tantos
# archivos en disco como objetos listó el origen.
EN_DISCO="$(wc -l < "$MANIFIESTO.nuevo" | tr -d ' ')"
if [ "$EN_DISCO" != "$TOTAL" ]; then
  echo "✗ El origen listó $TOTAL objeto(s) y en disco quedaron $EN_DISCO. NO es un respaldo completo." >&2
  exit 1
fi
mv "$MANIFIESTO.nuevo" "$MANIFIESTO"
rm -f "$MANIFIESTO.tmp"
echo "✓ $TOTAL objeto(s) verificados en $DESTINO ($BAJADOS nuevo(s), $SALTADOS ya estaban)."
echo "  Manifiesto: $MANIFIESTO"

if [ -n "${RESPALDO_S3_DESTINO:-}" ]; then
  command -v aws >/dev/null || { echo "✗ RESPALDO_S3_DESTINO está puesto y no hay aws CLI." >&2; exit 2; }
  echo "→ Sincronizando a $RESPALDO_S3_DESTINO (sin --delete: esto no borra nada allá)"
  aws s3 sync "$DESTINO" "$RESPALDO_S3_DESTINO"
  echo "✓ Sincronizado."
else
  echo "  (Sin RESPALDO_S3_DESTINO: el respaldo se queda en disco. Súbelo tú, o pon la variable.)"
fi
