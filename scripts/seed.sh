#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# Levanta la base de Cuadra con datos de Innovativos en UN comando:
#   DATABASE_URL="postgres://..." npm run seed
# El DATABASE_URL sale de Supabase → Project Settings → Database → Connection string.
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")/.."

DB="${DATABASE_URL:-${SUPABASE_DB_URL:-}}"
if [ -z "$DB" ]; then
  echo "❌ Falta DATABASE_URL. Cópialo de Supabase → Settings → Database → Connection string (URI)."
  echo "   Uso:  DATABASE_URL=\"postgres://...\" npm run seed"
  exit 1
fi

# ═══════════════════════════════════════════════════════════════════════════
# 🛑 DOS GUARDS ANTES DE ESCRIBIR NADA (auditoría 18, DAT-16)
#
# Este script aplica migraciones y siembra datos que SOBRESCRIBEN el tenant
# 11111111-…-111111111111: razón social, domicilio fiscal, liga del aviso de
# privacidad y RFC. En producción ese id es una flota real, y el único paso
# entre "sembrar el demo" y "cambiarle el RFC a un cliente" era acordarse de
# qué DATABASE_URL estaba exportado en esa terminal.
#
#   1. POR HOST — un host de Supabase gestionado (*.supabase.co, *.supabase.com,
#      el pooler) exige --produccion escrito a mano. No distingue prod de
#      staging (no hay forma desde aquí), así que pide la confirmación en los
#      dos: el que siembra en staging teclea seis palabras de más.
#   2. POR NOMBRE — si la flota de ese id ya existe y no se llama "Flota Demo",
#      esta base no es de demo y no se toca. El mismo guard vive en seed.sql
#      (que es lo que protege a quien corra el .sql a mano); aquí se adelanta
#      para no aplicar migraciones sobre una base ajena.
#
# Uso deliberado:  DATABASE_URL="postgres://…" npm run seed -- --produccion
# ═══════════════════════════════════════════════════════════════════════════
PRODUCCION=0
for arg in "$@"; do
  case "$arg" in
    --produccion) PRODUCCION=1 ;;
    *) echo "❌ Opción desconocida: $arg (la única es --produccion)"; exit 1 ;;
  esac
done

# host, sin esquema, sin credenciales, sin puerto ni ruta
HOST=$(printf '%s' "$DB" | sed -E 's#^[a-zA-Z+]+://##; s#^[^@/]*@##; s#[:/?].*$##')

case "$HOST" in
  *.supabase.co|*.supabase.com)
    if [ "$PRODUCCION" != "1" ]; then
      echo "❌ REHUSADO: «${HOST}» es una base de Supabase gestionada, y este seed SOBRESCRIBE"
      echo "   el tenant 11111111-…-111111111111 (razón social, domicilio, aviso de privacidad y RFC)."
      echo "   En una flota real eso apaga o desvía la validación de receptor de CFDI."
      echo ""
      echo "   Si de verdad es lo que quieres, dilo a mano:"
      echo "     DATABASE_URL=\"$DB\" npm run seed -- --produccion"
      exit 1
    fi
    echo "⚠️  Sembrando contra «${HOST}» con --produccion. Sobrescribe el tenant demo si existe."
    ;;
esac

# El guard por nombre solo se puede consultar si el esquema ya está.
if psql "$DB" -q -tAc "select 1 from information_schema.tables where table_schema='public' and table_name='tenant'" | grep -q 1; then
  # `-tA` ya viene sin relleno ni encabezados y `$( )` come el salto final, así
  # que el nombre llega tal cual: colapsar espacios aquí haría que "Flota Demo"
  # y "FlotaDemo" pasaran por lo mismo.
  NOMBRE=$(psql "$DB" -q -tAc "select nombre from tenant where id = '11111111-1111-1111-1111-111111111111'")
  if [ -n "$NOMBRE" ] && [ "$NOMBRE" != "Flota Demo" ]; then
    echo "❌ REHUSADO: el tenant 11111111-…-111111111111 de esta base se llama «${NOMBRE}», no «Flota Demo»."
    echo "   Esta no es una base de demo y el seed le sobrescribiría RFC, razón social, domicilio y aviso de privacidad."
    echo "   Si de verdad querías sembrar aquí, renombra esa flota a «Flota Demo» a mano — a sabiendas — o siembra con otro id."
    exit 1
  fi
fi

# AUDITORÍA 13, ALTO (operabilidad): correr TODAS las migraciones contra una
# base ya migrada reventaba (objetos que ya existen). Si la base ya tiene el
# esquema (migración 0001 aplicada), solo se siembran los DATOS; el esquema se
# aplica con el camino documentado (Supabase MCP / `supabase db push`).
if psql "$DB" -q -tAc "select 1 from information_schema.tables where table_schema='public' and table_name='viaje'" | grep -q 1; then
  echo "▸ Esquema ya aplicado — solo se siembran los DATOS (para el esquema usa el MCP o 'supabase db push')."
else
  echo "▸ Aplicando migraciones…"
  for f in supabase/migrations/*.sql; do
    echo "  → $(basename "$f")"
    psql "$DB" -v ON_ERROR_STOP=1 -q -f "$f"
  done
fi

echo "▸ Creando bucket privado 'liquidaciones'…"
psql "$DB" -q -c "insert into storage.buckets (id, name, public) values ('liquidaciones','liquidaciones', false) on conflict (id) do nothing;" \
  || echo "  ⚠ No se pudo crear el bucket por SQL — créalo a mano en Supabase → Storage (privado)."

echo "▸ Sembrando datos de Innovativos (🔴 valores INVENTADOS marcados en seed.sql)…"
psql "$DB" -v ON_ERROR_STOP=1 -q -f supabase/seed.sql

echo ""
echo "✅ Listo. Datos de Innovativos cargados."
echo "   • 3 terminales (Silao, Guadalajara, Nuevo Laredo)"
echo "   • 5 operadores (🔴 teléfonos INVENTADOS — pon el número de prueba de Meta)"
echo "   • Política de gastos (🔴 topes INVENTADOS — ajústalos en seed.sql)"
echo "   • 1 viaje demo abierto (Silao→Laredo) con UNA diferencia: diésel \$200 sobre política"
echo "   • 3 liquidaciones de historial para el dashboard"
echo ""
echo "   Siguiente: pon las llaves en .env.local (ver .env.example) y corre  npm run dev"
