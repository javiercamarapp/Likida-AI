#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# RESPALDO DE LA BASE DE PRODUCCIÓN.
#
# Existe porque el proyecto está en plan FREE de Supabase: **no hay respaldo
# automático ni PITR**. Verificado contra la Management API el 4-ago-2026. La
# documentación de Supabase es explícita: los proyectos free tienen que
# exportar sus datos por su cuenta.
#
# Ese mismo día se borró la base entera y lo único que la salvó fue un dump
# hecho a mano. Este archivo convierte esa suerte en procedimiento.
#
# CON CFF ART. 30 DE POR MEDIO, esto no es solo pérdida de producto: son los
# comprobantes de las flotas clientes, que la ley obliga a conservar 5 años.
#
# USO:  ./scripts/respaldo.sh            → guarda en ~/likida-respaldos/base (chmod 700, fuera de iCloud)
#       ./scripts/respaldo.sh /otra/ruta
#
# Usa `npx supabase` a propósito: el CLI no está instalado global en esta
# máquina, y un script de respaldo que exige una instalación previa es un
# script que no se corre. Requiere estar enlazado (`npx supabase link`).
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

# A37-S04-02: el dump trae datos de TODAS las flotas (teléfonos, correos, datos
# fiscales). Nada de carpetas sincronizadas con iCloud (Escritorio, Documentos)
# ni permisos por omisión: umask 077 y carpeta 700. Si defines
# RESPALDO_AGE_RECIPIENT (clave pública de `age`), el dump se cifra y el .sql
# en claro se borra. CLI fijado a la misma versión que usa el despliegue.
umask 077
SUPABASE_CLI_VERSION="${SUPABASE_CLI_VERSION:-2.115.0}"
DESTINO="${1:-$HOME/likida-respaldos/base}"
case "$DESTINO" in /*) ;; *) DESTINO="$PWD/$DESTINO" ;; esac
case "$DESTINO" in
  "$HOME/Desktop"|"$HOME/Desktop/"*|"$HOME/Documents"|"$HOME/Documents/"*|*"/Library/Mobile Documents/"*)
    echo "✗ $DESTINO está en una carpeta sincronizada con iCloud; usa una ruta local (p. ej. ~/likida-respaldos/base)." >&2
    exit 2 ;;
esac
mkdir -p "$DESTINO"
chmod 700 "$DESTINO"
SELLO=$(date +%Y-%m-%d_%H%M)
ARCHIVO="$DESTINO/likida-$SELLO.sql"

echo "→ Respaldando a $ARCHIVO"
npx --yes "supabase@${SUPABASE_CLI_VERSION}" db dump --file "$ARCHIVO" --data-only

# UN RESPALDO QUE NO SE COMPRUEBA NO ES UN RESPALDO. Un dump vacío pesa unos
# cientos de bytes y se ve igual de exitoso que uno bueno.
BYTES=$(wc -c < "$ARCHIVO" | tr -d ' ')
if [ "$BYTES" -lt 2000 ]; then
  echo "✗ El respaldo pesa $BYTES bytes: eso no es una base, es un archivo vacío." >&2
  exit 1
fi

chmod 600 "$ARCHIVO"
if [ -n "${RESPALDO_AGE_RECIPIENT:-}" ]; then
  command -v age >/dev/null || { echo "✗ RESPALDO_AGE_RECIPIENT definido pero falta age." >&2; exit 1; }
  age -r "$RESPALDO_AGE_RECIPIENT" -o "$ARCHIVO.age" "$ARCHIVO" && rm -f "$ARCHIVO"
  ARCHIVO="$ARCHIVO.age"
  echo "  (cifrado con age)"
else
  echo "  AVISO: sin cifrar (define RESPALDO_AGE_RECIPIENT para cifrar con age)." >&2
fi

# Se conservan 14 días. Más que eso en el disco de una laptop es acumular sin
# mirar; el respaldo largo va a otro lado (Drive, S3) y eso es decisión aparte.
find "$DESTINO" \( -name 'likida-*.sql' -o -name 'likida-*.sql.age' \) -mtime +14 -delete 2>/dev/null || true

echo "✓ $ARCHIVO ($(du -h "$ARCHIVO" | cut -f1))"
echo "  Respaldos vivos: $(ls -1 "$DESTINO"/likida-*.sql "$DESTINO"/likida-*.sql.age 2>/dev/null | wc -l | tr -d ' ')"
