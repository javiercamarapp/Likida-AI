# Seed — Cliente demo (demo)

Datos de arranque para el demo del 6-ago. **Todo lo marcado 🔴 INVENTADO es de
fantasía** — reemplázalo con el dato real de cliente_demo.

## Un comando
```bash
DATABASE_URL="postgres://…"  npm run seed   # URI: Supabase → Settings → Database
```
Aplica migraciones + crea el bucket `liquidaciones` + siembra los datos.

## Qué carga
| | Detalle | Estado |
|---|---|---|
| Terminales | Silao (GTO), Guadalajara (JAL), Nuevo Laredo (TAM) | ✅ **REAL** (corredor de cliente_demo) |
| Operadores | 5 con nombres y teléfonos | 🔴 **INVENTADO** — el teléfono debe ser el número de prueba de Meta |
| Política de gastos | Diésel ≤ $4,000 · Caseta ≤ $1,500 · Viáticos ≤ $800 · Factura requiere CFDI | 🔴 **INVENTADO** — parametrizable en `supabase/seed.sql` |
| Viaje demo | Silao→Laredo, anticipo $10,600, abierto | 🔴 **INVENTADO** (montos) |
| Diferencia visible | Diésel $4,200 = **$200 sobre política** (única diferencia, para lucir el cuadre) | 🔴 **INVENTADO** |
| Historial | 3 liquidaciones (cuadrada / con diferencias / revisar) para el dashboard | 🔴 **INVENTADO** |

## 🔴 Qué reemplazar con dato REAL de campo (antes del 6)
1. **Política de gastos** — los topes de diésel/caseta/viáticos y el set de casetas
   esperadas del corredor Silao→Laredo. *(bloque POLÍTICA en `seed.sql`)*
2. **RFC** de cliente_demo.
3. **Teléfonos** de los operadores (o el número de prueba de Meta para el demo).
4. **Anticipos y montos** reales de un viaje real.

> Diseño a propósito: cada valor de fantasía grita 🔴 INVENTADO en `seed.sql` para
> que no llegues al demo con una política de fantasía sin darte cuenta.

## Dos caminos de demo
- **WhatsApp real**: da de alta el número de prueba de Meta en `operador.telefono`,
  el operador manda fotos → cuadre real → PDF.
- **Simulador** (`/demo`): corre el mismo motor de cuadre, sin red — plan B robusto.
  Ya está tuneado al escenario Silao→Laredo con la diferencia de $200.
