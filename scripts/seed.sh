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
