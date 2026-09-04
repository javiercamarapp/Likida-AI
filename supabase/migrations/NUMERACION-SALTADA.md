# Números de migración saltados a propósito

Auditoría 25, BAJO (reincidente de la 24): nada distinguía "número saltado"
de "migración perdida" — una rama futura que ocupiera uno de estos números
se aplicaría fuera de orden en producción (después de la última migración
ya aplicada, en vez de en su hueco numérico). Este archivo es la marca que
faltaba: **estos tres números no existieron nunca y no deben reutilizarse.**

| Número | Estado |
| --- | --- |
| `0277` | Nunca se escribió. Saltado en el trabajo en paralelo de la auditoría 24/25 (varios agentes reservando rangos de números a la vez); no quedó rastro de para qué era. |
| `0293` | Igual que 0277. |
| `0295` | Igual que 0277. |

No se rellenan con archivos `.sql` a propósito: producción ya aplicó
`0294`-`0308` (y las que sigan). Un archivo `0293_*.sql` agregado HOY se
aplicaría en producción DESPUÉS de la última migración ya aplicada — fuera
de su hueco numérico — que es exactamente el modo de falla que este hallazgo
señala, no algo que este documento deba reproducir para "cerrarlo".

La próxima migración usa el siguiente número libre por arriba de la más alta
existente (ver `ls supabase/migrations/ | tail -1`), nunca uno de estos tres.
