#!/usr/bin/env bash
# Restore drill de Storage. Seguro por defecto: solo verifica el backup.
#
# Dry-run (por defecto):
#   bash scripts/restore-storage-drill.sh /ruta/backup
#
# Copia local no destructiva (destino explícito y nunca producción):
#   bash scripts/restore-storage-drill.sh /ruta/backup \
#     --apply --destination /ruta/restauracion
#
# No implementa escritura contra Supabase. Esa operación requiere un runbook,
# aprobación humana y una herramienta específica del proyecto destino.
set -euo pipefail

BACKUP=""
DESTINO=""
APPLY=false
OVERWRITE=false

while [ "$#" -gt 0 ]; do
  case "$1" in
    --apply) APPLY=true; shift ;;
    --overwrite) OVERWRITE=true; shift ;;
    --destination)
      [ "$#" -ge 2 ] || { echo "ERROR: --destination necesita una ruta." >&2; exit 2; }
      DESTINO="$2"; shift 2 ;;
    --help|-h)
      sed -n '1,28p' "$0"; exit 0 ;;
    -*) echo "ERROR: opción desconocida: $1" >&2; exit 2 ;;
    *)
      [ -z "$BACKUP" ] || { echo "ERROR: solo se acepta un backup." >&2; exit 2; }
      BACKUP="$1"; shift ;;
  esac
done

[ -n "$BACKUP" ] || { echo "ERROR: especifica la ruta del backup." >&2; exit 2; }
$OVERWRITE && ! $APPLY && { echo "ERROR: --overwrite solo es válido junto con --apply." >&2; exit 2; }
[ -f "$BACKUP/MANIFIESTO.json" ] || {
  echo "ERROR: falta MANIFIESTO.json; genera un backup nuevo." >&2
  exit 3
}
command -v jq >/dev/null || { echo "ERROR: falta jq." >&2; exit 2; }

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'
  else echo "ERROR: se necesita sha256sum o shasum." >&2; exit 2
  fi
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
  ruta_dentro "$actual" "$raiz" || { echo "ERROR: directorio fuera del restore: $actual" >&2; return 1; }
  printf '%s' "$actual"
}

validar_bucket() {
  local bucket="$1"
  case "$bucket" in
    ''|.|..|*[!A-Za-z0-9._-]*)
      echo "ERROR: bucket inseguro en manifiesto: $bucket" >&2
      exit 3
      ;;
  esac
}

jq -e '
  .format == "likida-storage-manifest" and
  .version == 1 and
  (.object_count | type == "number" and . >= 0 and floor == .) and
  (.objects | type == "array") and
  .object_count == (.objects | length) and
  ([.objects[] | [.bucket, .path] | @tsv] | length == (unique | length)) and
  all(.objects[];
    (.bucket | type) == "string" and
    (.path | type) == "string" and
    (.bytes | type == "number" and . >= 0 and floor == .) and
    (.sha256 | type == "string" and test("^[0-9a-f]{64}$")))
' "$BACKUP/MANIFIESTO.json" >/dev/null || {
  echo "ERROR: formato o campos de manifiesto no soportados." >&2
  exit 3
}

if $APPLY; then
  [ -n "$DESTINO" ] || { echo "ERROR: --apply exige --destination explícito." >&2; exit 2; }
  [ "$DESTINO" != "/" ] || { echo "ERROR: destino raíz rechazado." >&2; exit 2; }
  mkdir -p "$DESTINO"
  BACKUP_ABS="$(cd "$BACKUP" && pwd -P)"
  DESTINO_ABS="$(cd "$DESTINO" && pwd -P)"
  [ "$DESTINO_ABS" != "/" ] || { echo "ERROR: destino raíz rechazado." >&2; exit 2; }
  if ruta_dentro "$DESTINO_ABS" "$BACKUP_ABS" || ruta_dentro "$BACKUP_ABS" "$DESTINO_ABS"; then
    echo "ERROR: backup y destino no pueden contenerse entre sí." >&2
    exit 2
  fi
  echo "APPLY no destructivo: $BACKUP_ABS -> $DESTINO_ABS"
else
  BACKUP_ABS="$(cd "$BACKUP" && pwd -P)"
  echo "DRY-RUN: no se escribirá nada. Backup: $BACKUP_ABS"
fi

TOTAL="$(jq -r '.object_count // -1' "$BACKUP/MANIFIESTO.json")"
COUNT=0
while IFS= read -r objeto; do
  bucket="$(jq -r '.bucket' <<<"$objeto")"
  ruta="$(jq -r '.path' <<<"$objeto")"
  bytes="$(jq -r '.bytes' <<<"$objeto")"
  esperado="$(jq -r '.sha256' <<<"$objeto")"
  validar_bucket "$bucket"
  case "/$ruta/" in
    *'//'*|*'/../'*|*'/./'*|*$'\t'*|*$'\n'*|*$'\r'*)
      echo "ERROR: ruta insegura en manifiesto: $bucket/$ruta" >&2; exit 3 ;;
  esac
  archivo="$BACKUP_ABS/$bucket/$ruta"
  [ -f "$archivo" ] || { echo "ERROR: falta objeto: $bucket/$ruta" >&2; exit 3; }
  [ ! -L "$archivo" ] || { echo "ERROR: objeto es symlink: $bucket/$ruta" >&2; exit 3; }
  archivo_padre="$(cd "$(dirname "$archivo")" && pwd -P)"
  ruta_dentro "$archivo_padre" "$BACKUP_ABS" || {
    echo "ERROR: un symlink saca el objeto del backup: $bucket/$ruta" >&2
    exit 3
  }
  archivo="$archivo_padre/$(basename "$archivo")"
  real_bytes="$(wc -c < "$archivo" | tr -d '[:space:]')"
  real_sha="$(sha256_file "$archivo")"
  [ "$real_bytes" = "$bytes" ] || { echo "ERROR: bytes no coinciden: $bucket/$ruta" >&2; exit 3; }
  [ "$real_sha" = "$esperado" ] || { echo "ERROR: SHA-256 no coincide: $bucket/$ruta" >&2; exit 3; }
  if $APPLY; then
    salida="$DESTINO_ABS/$bucket/$ruta"
    salida_padre="$(crear_directorio_confinado "$DESTINO_ABS" "$(dirname "$bucket/$ruta")")"
    salida="$salida_padre/$(basename "$salida")"
    [ ! -L "$salida" ] || { echo "ERROR: destino es symlink: $salida" >&2; exit 3; }
    if [ -e "$salida" ]; then
      [ -f "$salida" ] || { echo "ERROR: destino no es archivo: $salida" >&2; exit 3; }
      destino_sha="$(sha256_file "$salida")"
      [ "$destino_sha" = "$esperado" ] || {
        $OVERWRITE || { echo "ERROR: conflicto existente; usa --overwrite explícito." >&2; exit 4; }
      }
    fi
    if [ ! -e "$salida" ] || $OVERWRITE; then cp -p -- "$archivo" "$salida"; fi
  fi
  COUNT=$((COUNT + 1))
done < <(jq -c '.objects[]' "$BACKUP/MANIFIESTO.json")

[ "$COUNT" = "$TOTAL" ] || {
  echo "ERROR: manifiesto declara $TOTAL objetos y se verificaron $COUNT." >&2; exit 3;
}

if $APPLY; then
  marca="$DESTINO_ABS/RESTORE_DRILL_COMPLETADO_UTC"
  [ ! -L "$marca" ] || { echo "ERROR: la marca de restore es symlink." >&2; exit 3; }
  [ ! -e "$marca" ] || [ -f "$marca" ] || { echo "ERROR: la marca de restore no es archivo." >&2; exit 3; }
  marca_tmp="$(mktemp "$DESTINO_ABS/.restore-drill.XXXXXX")"
  printf '%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$marca_tmp"
  mv "$marca_tmp" "$marca"
  echo "OK: $COUNT objetos verificados y copiados sin borrar archivos existentes."
else
  echo "OK: $COUNT objetos verificados; dry-run completado sin escribir."
fi
