#!/usr/bin/env bash
# Respaldo verificable de Supabase Storage.
#
# Solo lee del origen, nunca borra origen ni destino remoto, verifica tamaño y
# SHA-256 de cada objeto y publica tres artefactos atómicos:
# MANIFIESTO.json (máquina), MANIFIESTO.tsv (humano) y MANIFIESTO.sha256.
# Falla ante errores de API, rutas inseguras o un respaldo vacío no declarado.
#
# Variables:
#   NEXT_PUBLIC_SUPABASE_URL       URL del proyecto (obligatoria)
#   SUPABASE_SERVICE_ROLE_KEY      llave de respaldo (obligatoria)
#   RESPALDO_BUCKETS               buckets separados por espacios
#   RESPALDO_S3_DESTINO             s3://.../prefijo
#   RESPALDO_ALLOW_EMPTY=true      permite explícitamente un respaldo vacío
#   RESPALDO_REQUIRE_REMOTE=true   exige destino remoto (CI)
#
# Uso: bash scripts/respaldo-storage.sh /ruta/backup
set -euo pipefail
# RESPALDO_BUCKETS es configuración, no un patrón de archivos local.
set -f
cd "$(dirname "$0")/.."

DESTINO="${1:-${RESPALDO_ROOT:-./.backups/storage}}"
BUCKETS="${RESPALDO_BUCKETS:-comprobantes liquidaciones avatares bus}"
REQUIRE_REMOTE="${RESPALDO_REQUIRE_REMOTE:-false}"
ALLOW_EMPTY="${RESPALDO_ALLOW_EMPTY:-false}"
URL="${NEXT_PUBLIC_SUPABASE_URL:-}"
LLAVE="${SUPABASE_SERVICE_ROLE_KEY:-}"

leer_env_local() {
  local clave="$1"
  if [ -n "${!clave:-}" ]; then printf '%s' "${!clave}"; return; fi
  [ -f .env.local ] || return
  sed -n "s/^${clave}=//p" .env.local | head -n1 | sed "s/^['\"]//;s/['\"]$//"
}

URL="${URL:-$(leer_env_local NEXT_PUBLIC_SUPABASE_URL)}"
LLAVE="${LLAVE:-$(leer_env_local SUPABASE_SERVICE_ROLE_KEY)}"
[ -n "$URL" ] || { echo "ERROR: falta NEXT_PUBLIC_SUPABASE_URL." >&2; exit 2; }
[ -n "$LLAVE" ] || { echo "ERROR: falta SUPABASE_SERVICE_ROLE_KEY." >&2; exit 2; }
command -v jq >/dev/null || { echo "ERROR: falta jq." >&2; exit 2; }
command -v curl >/dev/null || { echo "ERROR: falta curl." >&2; exit 2; }

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    echo "ERROR: se necesita sha256sum o shasum." >&2
    exit 2
  fi
}

validar_bucket() {
  local bucket="$1"
  case "$bucket" in
    ''|.|..|*[!A-Za-z0-9._-]*)
      echo "ERROR: nombre de bucket inseguro: $bucket" >&2
      exit 2
      ;;
  esac
}

codificar_ruta_url() {
  jq -rn --arg ruta "$1" '$ruta | split("/") | map(@uri) | join("/")'
}

ruta_dentro() {
  local candidata="$1" raiz="${2%/}"
  [[ "$candidata" == "$raiz" || "$candidata" == "$raiz/"* ]]
}

crear_directorio_confinado() {
  local raiz="$1" relativa="$2" actual="$1" parte
  local -a partes
  IFS='/' read -r -a partes <<< "$relativa"
  for parte in "${partes[@]}"; do
    [ -n "$parte" ] && [ "$parte" != "." ] && [ "$parte" != ".." ] || {
      echo "ERROR: componente de ruta inseguro: $relativa" >&2
      return 1
    }
    actual="$actual/$parte"
    [ ! -L "$actual" ] || { echo "ERROR: directorio destino es symlink: $actual" >&2; return 1; }
    if [ -e "$actual" ]; then
      [ -d "$actual" ] || { echo "ERROR: componente destino no es directorio: $actual" >&2; return 1; }
    else
      mkdir -- "$actual"
    fi
  done
  actual="$(cd "$actual" && pwd -P)"
  ruta_dentro "$actual" "$raiz" || { echo "ERROR: directorio fuera del backup: $actual" >&2; return 1; }
  printf '%s' "$actual"
}

URL="${URL%/}"
mkdir -p "$DESTINO"
DESTINO="$(cd "$DESTINO" && pwd -P)"
TMP_BASE="${TMPDIR:-/tmp}"
TMP_DIR="$(mktemp -d "${TMP_BASE%/}/likida-respaldo.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT
OBJETOS="$TMP_DIR/objetos.tsv"
: > "$OBJETOS"

listar_bucket() {
  local bucket="$1" prefijo respuesta offset n nombre id bytes ruta
  local -a pendientes=("")
  local cabeza=0
  while [ "$cabeza" -lt "${#pendientes[@]}" ]; do
    prefijo="${pendientes[$cabeza]}"
    cabeza=$((cabeza + 1))
    offset=0
    while :; do
      respuesta="$(curl -sS -f --retry 3 --retry-delay 1 -X POST \
        "$URL/storage/v1/object/list/$bucket" \
        -H "Authorization: Bearer $LLAVE" -H "apikey: $LLAVE" \
        -H 'Content-Type: application/json' \
        -d "$(jq -nc --arg p "$prefijo" --argjson o "$offset" \
          '{prefix:$p,limit:1000,offset:$o,sortBy:{column:"name",order:"asc"}}')")" \
        || { echo "ERROR: falló el listado de $bucket/$prefijo." >&2; exit 1; }
      [ "$(jq -r 'type' <<<"$respuesta")" = "array" ] || {
        echo "ERROR: Storage devolvió un error al listar $bucket: $(jq -c . <<<"$respuesta")" >&2
        exit 1
      }
      jq -e 'all(.[]; (.name | type) == "string" and (.name | length) > 0 and ((.name | test("[\\t\\n\\r]")) | not))' \
        <<<"$respuesta" >/dev/null || {
        echo "ERROR: Storage devolvió un nombre no representable en $bucket/$prefijo." >&2
        exit 1
      }
      n="$(jq 'length' <<<"$respuesta")"
      [ "$n" -eq 0 ] && break
      while IFS=$'\t' read -r nombre id bytes; do
        ruta="${prefijo:+$prefijo/}$nombre"
        case "/$ruta/" in
          *'//'*|*'/../'*|*'/./'*|*$'\t'*|*$'\n'*|*$'\r'*)
            echo "ERROR: ruta de Storage insegura o no representable: $bucket/$ruta" >&2
            exit 1
            ;;
        esac
        if [ "$id" = "null" ]; then
          pendientes+=("$ruta")
        else
          printf '%s\t%s\t%s\n' "$bucket" "$ruta" "$bytes" >> "$OBJETOS"
        fi
      done < <(jq -r '.[] | [.name, (.id // "null"), (.metadata.size // 0)] | @tsv' <<<"$respuesta")
      offset=$((offset + n))
      [ "$n" -lt 1000 ] && break
    done
  done
}

echo "Listando buckets: $BUCKETS"
for bucket in $BUCKETS; do
  validar_bucket "$bucket"
  listar_bucket "$bucket"
done
TOTAL="$(wc -l < "$OBJETOS" | tr -d '[:space:]')"
if [ "$TOTAL" -eq 0 ] && [ "$ALLOW_EMPTY" != "true" ]; then
  echo "ERROR: Storage devolvió cero objetos. Usa RESPALDO_ALLOW_EMPTY=true solo si es intencional." >&2
  exit 3
fi

TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
TSV_TMP="$TMP_DIR/MANIFIESTO.tsv"
JSON_TMP="$TMP_DIR/MANIFIESTO.json"
SHA_TMP="$TMP_DIR/MANIFIESTO.sha256"
: > "$TSV_TMP"; : > "$SHA_TMP"
BAJADOS=0
VERIFICADOS=0
while IFS=$'\t' read -r bucket ruta bytes; do
  validar_bucket "$bucket"
  case "$bytes" in ''|*[!0-9]*) echo "ERROR: tamaño inválido: $bucket/$ruta" >&2; exit 1 ;; esac
  destino="$DESTINO/$bucket/$ruta"
  destino_padre="$(crear_directorio_confinado "$DESTINO" "$(dirname "$bucket/$ruta")")"
  destino="$destino_padre/$(basename "$ruta")"
  [ ! -L "$destino" ] || { echo "ERROR: destino local es symlink: $bucket/$ruta" >&2; exit 1; }
  [ ! -e "$destino" ] || [ -f "$destino" ] || { echo "ERROR: destino local no es archivo: $bucket/$ruta" >&2; exit 1; }

  # Nunca se reutiliza un archivo solo porque tiene el mismo tamaño: dos
  # versiones distintas pueden medir lo mismo. Se descarga a temporal, se
  # verifica y recién entonces se reemplaza atómicamente la copia local.
  temporal="$(mktemp "$TMP_DIR/objeto.XXXXXX")"
  ruta_url="$(codificar_ruta_url "$ruta")"
  curl -sS -f --retry 3 --retry-delay 1 -o "$temporal" \
    -H "Authorization: Bearer $LLAVE" -H "apikey: $LLAVE" \
    "$URL/storage/v1/object/$bucket/$ruta_url" \
    || { echo "ERROR: no se pudo descargar $bucket/$ruta." >&2; exit 1; }
  actual_bytes="$(wc -c < "$temporal" | tr -d '[:space:]')"
  actual_sha="$(sha256_file "$temporal")"
  [ "$actual_bytes" = "$bytes" ] || { echo "ERROR: tamaño inconsistente: $bucket/$ruta" >&2; exit 1; }
  mv "$temporal" "$destino"
  BAJADOS=$((BAJADOS + 1))
  printf '%s\t%s\t%s\t%s\n' "$bucket" "$ruta" "$bytes" "$actual_sha" >> "$TSV_TMP"
  printf '%s  %s\n' "$actual_sha" "$bucket/$ruta" >> "$SHA_TMP"
  VERIFICADOS=$((VERIFICADOS + 1))
done < "$OBJETOS"

jq -Rn --arg created "$TS" --arg source "$URL" --argjson count "$VERIFICADOS" \
  '[inputs | select(length > 0) | split("\t") | {bucket:.[0],path:.[1],bytes:(.[2]|tonumber),sha256:.[3]}] |
   {format:"likida-storage-manifest",version:1,created_at:$created,source:$source,object_count:$count,objects:.}' \
  < "$TSV_TMP" > "$JSON_TMP"

mv "$TSV_TMP" "$DESTINO/MANIFIESTO.tsv"
mv "$JSON_TMP" "$DESTINO/MANIFIESTO.json"
mv "$SHA_TMP" "$DESTINO/MANIFIESTO.sha256"
printf '%s\n' "$TS" > "$DESTINO/RESPALDO_COMPLETADO_UTC"

if [ -n "${RESPALDO_S3_DESTINO:-}" ]; then
  command -v aws >/dev/null || { echo "ERROR: falta aws CLI para RESPALDO_S3_DESTINO." >&2; exit 2; }
  REMOTE_BASE="${RESPALDO_S3_DESTINO%/}"
  case "$REMOTE_BASE" in
    s3://?*) ;;
    *) echo "ERROR: RESPALDO_S3_DESTINO debe ser una URI s3:// explícita." >&2; exit 2 ;;
  esac
  echo "Sincronizando respaldo remoto sin --delete: $REMOTE_BASE"
  # Los controles se publican después de los objetos y la marca va AL FINAL:
  # nunca existe un respaldo remoto declarado completo con objetos a medias.
  aws s3 sync "$DESTINO/" "$REMOTE_BASE/" --no-progress \
    --exclude 'MANIFIESTO.*' --exclude 'RESPALDO_COMPLETADO_UTC'
  aws s3 cp "$DESTINO/MANIFIESTO.tsv" "$REMOTE_BASE/MANIFIESTO.tsv" --no-progress
  aws s3 cp "$DESTINO/MANIFIESTO.json" "$REMOTE_BASE/MANIFIESTO.json" --no-progress
  aws s3 cp "$DESTINO/MANIFIESTO.sha256" "$REMOTE_BASE/MANIFIESTO.sha256" --no-progress
  REMOTE_CHECK="$TMP_DIR/manifiesto-remoto.json"
  aws s3 cp "$REMOTE_BASE/MANIFIESTO.json" "$REMOTE_CHECK" --no-progress
  cmp -s "$DESTINO/MANIFIESTO.json" "$REMOTE_CHECK" || {
    echo "ERROR: el manifiesto remoto no coincide con el local." >&2
    exit 1
  }
  aws s3 cp "$DESTINO/RESPALDO_COMPLETADO_UTC" "$REMOTE_BASE/RESPALDO_COMPLETADO_UTC" --no-progress
elif [ "$REQUIRE_REMOTE" = "true" ]; then
  echo "ERROR: RESPALDO_REQUIRE_REMOTE=true exige RESPALDO_S3_DESTINO." >&2
  exit 2
else
  echo "ADVERTENCIA: no se configuró destino remoto; solo existe copia local." >&2
fi

echo "OK: $VERIFICADOS objeto(s), $BAJADOS descarga(s), manifiesto y hashes verificados en $DESTINO."
