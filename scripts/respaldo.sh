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
# USO:  ./scripts/respaldo.sh            → guarda en ~/Desktop/likida-respaldos
#       ./scripts/respaldo.sh /otra/ruta
#
# Usa `npx supabase` a propósito: el CLI no está instalado global en esta
# máquina, y un script de respaldo que exige una instalación previa es un
# script que no se corre. Requiere estar enlazado (`npx supabase link`).
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

DESTINO="${1:-$HOME/Desktop/likida-respaldos}"
mkdir -p "$DESTINO"
SELLO=$(date +%Y-%m-%d_%H%M)
ARCHIVO="$DESTINO/likida-$SELLO.sql"

echo "→ Respaldando a $ARCHIVO"
npx --yes supabase db dump --file "$ARCHIVO" --data-only

# UN RESPALDO QUE NO SE COMPRUEBA NO ES UN RESPALDO. Un dump vacío pesa unos
# cientos de bytes y se ve igual de exitoso que uno bueno.
BYTES=$(wc -c < "$ARCHIVO" | tr -d ' ')
if [ "$BYTES" -lt 2000 ]; then
  echo "✗ El respaldo pesa $BYTES bytes: eso no es una base, es un archivo vacío." >&2
  exit 1
fi

# Se conservan 14 días. Más que eso en el disco de una laptop es acumular sin
# mirar; el respaldo largo va a otro lado (Drive, S3) y eso es decisión aparte.
find "$DESTINO" -name 'likida-*.sql' -mtime +14 -delete 2>/dev/null || true

echo "✓ $ARCHIVO ($(du -h "$ARCHIVO" | cut -f1))"
echo "  Respaldos vivos: $(ls -1 "$DESTINO"/likida-*.sql 2>/dev/null | wc -l | tr -d ' ')"
