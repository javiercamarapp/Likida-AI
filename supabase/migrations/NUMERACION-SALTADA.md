# Números de migración saltados a propósito

Auditoría 25, BAJO (reincidente de la 24): nada distinguía "número saltado"
de "migración perdida" — una rama futura que ocupiera uno de estos números
se aplicaría fuera de orden en producción (después de la última migración
ya aplicada, en vez de en su hueco numérico). Este archivo es la marca que
faltaba: **estos cuatro números no existieron nunca y no deben reutilizarse.**

| Número | Estado |
| --- | --- |
| `0277` | Nunca se escribió. Saltado en el trabajo en paralelo de la auditoría 24/25 (varios agentes reservando rangos de números a la vez); no quedó rastro de para qué era. |
| `0293` | Igual que 0277. |
| `0295` | Igual que 0277. |
| `0343` | Igual que 0277, pero de la auditoría 28: `0342_poliza_revision_y_desglose.sql` (`42f93f91`, fix(poliza)) y `0344_analytics_sin_rechazadas.sql` (`0c2133a8`, fix(analytics)) entraron el 5-sep-2026, trabajo en paralelo el mismo día — el mismo patrón que dejó 0277/0293/0295. Atenuante vigente (corregida 21-oct-2026, hallazgo con reproducción real): hasta esa fecha, `prefijosMigraciones()`/`prefijosDeFilas()` en `scripts/ci/compuerta-deploy.mjs` y `scripts/ci/verificar-migraciones-aplicadas.mjs` colapsaban dos archivos con el mismo prefijo en un `Set`, así que un futuro `0343_*.sql` NO bloqueaba el build — se colaba fuera de orden exactamente como el escenario que este documento señala. Ahora detectan la colisión como error explícito (ver `src/lib/likida/migraciones_verificadas.test.ts`, caso "ninguna migración comparte prefijo con otra migración DISTINTA") y la compuerta/el verificador fallan cerrado en vez de construir. |

No se rellenan con archivos `.sql` a propósito: producción ya aplicó
`0294`-`0308` (y las que sigan). Un archivo `0293_*.sql` agregado HOY se
aplicaría en producción DESPUÉS de la última migración ya aplicada — fuera
de su hueco numérico — que es exactamente el modo de falla que este hallazgo
señala, no algo que este documento deba reproducir para "cerrarlo".

La próxima migración usa el siguiente número libre por arriba de la más alta
existente (ver `ls supabase/migrations/ | tail -1`), nunca uno de estos cuatro.
