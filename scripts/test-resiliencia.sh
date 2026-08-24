#!/usr/bin/env bash
# Pruebas offline de los guardas del restore drill. No usa Supabase, AWS ni
# credenciales y no toca el repositorio.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/backup/comprobantes"
printf 'contenido de prueba\n' > "$TMP/backup/comprobantes/a.txt"
sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  else shasum -a 256 "$1" | awk '{print $1}'
  fi
}
SHA="$(sha256_file "$TMP/backup/comprobantes/a.txt")"
BYTES="$(wc -c < "$TMP/backup/comprobantes/a.txt" | tr -d '[:space:]')"
jq -n --arg sha "$SHA" --argjson bytes "$BYTES" '{format:"likida-storage-manifest",version:1,object_count:1,objects:[{bucket:"comprobantes",path:"a.txt",bytes:$bytes,sha256:$sha}]}' > "$TMP/backup/MANIFIESTO.json"
cp "$TMP/backup/MANIFIESTO.json" "$TMP/MANIFIESTO.valido.json"

# Dry-run no crea destino.
bash "$ROOT/scripts/restore-storage-drill.sh" "$TMP/backup" >/dev/null
[ ! -e "$TMP/dry-run" ]

# Un cambio en el backup debe fallar por SHA-256 aunque el manifiesto exista.
printf 'tampered\n' > "$TMP/backup/comprobantes/a.txt"
if bash "$ROOT/scripts/restore-storage-drill.sh" "$TMP/backup" >/dev/null 2>&1; then
  echo "ERROR: un objeto alterado no falló la verificación." >&2
  exit 1
fi
printf 'contenido de prueba\n' > "$TMP/backup/comprobantes/a.txt"

# Apply exige destino explícito y copia sin destruir.
bash "$ROOT/scripts/restore-storage-drill.sh" "$TMP/backup" --apply --destination "$TMP/restore" >/dev/null
cmp "$TMP/backup/comprobantes/a.txt" "$TMP/restore/comprobantes/a.txt"

# Un conflicto distinto debe fallar sin --overwrite.
printf 'otro contenido\n' > "$TMP/restore/comprobantes/a.txt"
if bash "$ROOT/scripts/restore-storage-drill.sh" "$TMP/backup" --apply --destination "$TMP/restore" >/dev/null 2>&1; then
  echo "ERROR: un conflicto de restore no falló." >&2
  exit 1
fi

# El bucket también es parte de la ruta: `..` jamás puede escapar del backup.
printf 'contenido de prueba\n' > "$TMP/fuera.txt"
jq '.objects[0].bucket = ".." | .objects[0].path = "fuera.txt"' \
  "$TMP/MANIFIESTO.valido.json" > "$TMP/backup/MANIFIESTO.json"
if bash "$ROOT/scripts/restore-storage-drill.sh" "$TMP/backup" >/dev/null 2>&1; then
  echo "ERROR: un bucket traversal no fue rechazado." >&2
  exit 1
fi
cp "$TMP/MANIFIESTO.valido.json" "$TMP/backup/MANIFIESTO.json"

# Un padre symlink del origen no puede hacer que el manifiesto lea fuera.
mkdir -p "$TMP/origen-externo"
printf 'contenido de prueba\n' > "$TMP/origen-externo/a.txt"
ln -s "$TMP/origen-externo" "$TMP/backup/externo"
jq '.objects[0].bucket = "externo"' "$TMP/MANIFIESTO.valido.json" > "$TMP/backup/MANIFIESTO.json"
if bash "$ROOT/scripts/restore-storage-drill.sh" "$TMP/backup" >/dev/null 2>&1; then
  echo "ERROR: un symlink padre del backup no fue rechazado." >&2
  exit 1
fi
rm "$TMP/backup/externo"
cp "$TMP/MANIFIESTO.valido.json" "$TMP/backup/MANIFIESTO.json"

# Tampoco un padre symlink del destino puede desviar la copia.
mkdir -p "$TMP/restore-symlink" "$TMP/destino-externo"
ln -s "$TMP/destino-externo" "$TMP/restore-symlink/comprobantes"
if bash "$ROOT/scripts/restore-storage-drill.sh" "$TMP/backup" --apply --destination "$TMP/restore-symlink" >/dev/null 2>&1; then
  echo "ERROR: un symlink padre del destino no fue rechazado." >&2
  exit 1
fi
[ ! -e "$TMP/destino-externo/a.txt" ]

# Un symlink en el archivo final tampoco se sigue, incluso con --overwrite.
mkdir -p "$TMP/restore-final/comprobantes"
printf 'no tocar\n' > "$TMP/destino-final.txt"
ln -s "$TMP/destino-final.txt" "$TMP/restore-final/comprobantes/a.txt"
if bash "$ROOT/scripts/restore-storage-drill.sh" "$TMP/backup" --apply --overwrite --destination "$TMP/restore-final" >/dev/null 2>&1; then
  echo "ERROR: un symlink final del destino no fue rechazado." >&2
  exit 1
fi
grep -qx 'no tocar' "$TMP/destino-final.txt"

echo "OK: pruebas offline de resiliencia (dry-run, copia, conflicto y confinamiento de rutas)."
