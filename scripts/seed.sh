#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# Levanta la base de Cuadra con datos de cliente_demo en UN comando:
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

echo "▸ Aplicando migraciones…"
for f in supabase/migrations/*.sql; do
  echo "  → $(basename "$f")"
  psql "$DB" -v ON_ERROR_STOP=1 -q -f "$f"
done

echo "▸ Creando bucket privado 'liquidaciones'…"
psql "$DB" -q -c "insert into storage.buckets (id, name, public) values ('liquidaciones','liquidaciones', false) on conflict (id) do nothing;" \
  || echo "  ⚠ No se pudo crear el bucket por SQL — créalo a mano en Supabase → Storage (privado)."

echo "▸ Sembrando datos de cliente_demo (🔴 valores INVENTADOS marcados en seed.sql)…"
psql "$DB" -v ON_ERROR_STOP=1 -q -f supabase/seed.sql

echo ""
echo "✅ Listo. Datos de cliente_demo cargados."
echo "   • 3 terminales (Silao, Guadalajara, Nuevo Laredo)"
echo "   • 5 operadores (🔴 teléfonos INVENTADOS — pon el número de prueba de Meta)"
echo "   • Política de gastos (🔴 topes INVENTADOS — ajústalos en seed.sql)"
echo "   • 1 viaje demo abierto (Silao→Laredo) con UNA diferencia: diésel \$200 sobre política"
echo "   • 3 liquidaciones de historial para el dashboard"
echo ""
echo "   Siguiente: pon las llaves en .env.local (ver .env.example) y corre  npm run dev"
