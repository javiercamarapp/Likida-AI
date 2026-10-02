#!/usr/bin/env bash
# Comparación de huellas de probar-idempotencia.sh (separada para poder probarla sin base).
# Cada archivo de huella tiene una línea por tabla: «nombre|filas|md5».
#   comprobar_huellas <n_tablas_esperadas> h1 h2 h3 h4   → imprime los FALLA en stderr; devuelve 0 si todo coincide, 1 si no.
comprobar_huellas() {
  local esperadas="$1" h1="$2" h2="$3" h3="$4" h4="$5" ok=0 nombre n _
  # Una prueba de huellas con 0 filas «pasa» sin probar nada: cada tabla debe traer filas.
  while IFS='|' read -r nombre n _; do
    [ "${n:-0}" -gt 0 ] 2>/dev/null || { echo "FALLA: la tabla $nombre tiene 0 filas tras sembrar (la huella no prueba nada)" >&2; ok=1; }
  done < "$h1"
  [ "$(wc -l < "$h1" | tr -d ' ')" = "$esperadas" ] || { echo "FALLA: la huella no cubre todas las tablas" >&2; ok=1; }
  diff -q "$h1" "$h2" >/dev/null || { echo "FALLA: la 2.ª corrida cambió filas" >&2; diff "$h1" "$h2" >&2 || true; ok=1; }
  diff -q "$h1" "$h3" >/dev/null || { echo "FALLA: --reiniciar no reproduce lo mismo" >&2; diff "$h1" "$h3" >&2 || true; ok=1; }
  diff -q "$h1" "$h4" >/dev/null || { echo "FALLA: vaciar + sembrar no reproduce lo mismo" >&2; diff "$h1" "$h4" >&2 || true; ok=1; }
  return $ok
}
