`poliza361_rpc.json` contiene exclusivamente datos sintéticos. Se capturó del resultado real de `supabase/tests/0342_poliza_revision_y_desglose.sql` leído con el esquema **0361**: cierre por `guardar_liquidacion_tx`, revisión por `revisar_liquidacion`, lectura por `poliza_datos_tenant`. La transacción termina en rollback. La captura del 26-sep-2026 se hizo en PostgreSQL 16.13 local con las **338 migraciones aplicadas sobre base virgen** (antes se capturaba en PostgreSQL 17 con el esquema 0342, y el archivo se llamaba `poliza342_rpc.json`).

Por qué cambió de nombre: la 0361 agregó `rfcEmisor` al `jsonb` por comprobante y subió la `version` de la RPC a 361. Un archivo llamado `…342…` que contuviera filas de la 361 sería un rótulo falso, y `RPC_VERSION_MINIMA` (`route.ts`) rechaza la forma 0342 con 409 a propósito: sin el emisor, el asiento dedupa con la llave anterior a la 0357 y pierde base deducible real (FIS-C4 / ARQ32C4-C2).

`salida.test.ts` consume la captura mediante el doble de transporte y ejecuta la ruta, clasificación y serialización reales. Esta captura comprueba el contrato; no sustituye ejecutar la prueba SQL tras una migración.

Para regenerarla en una base efímera propia que ya tenga las migraciones aplicadas, define `PGHOST` (socket UNIX local), `PGPORT` y `PGDATABASE` de esa base y ejecuta desde la raíz del repositorio:

```sh
psql -X -qAt -v ON_ERROR_STOP=1 -f supabase/tests/0342_poliza_revision_y_desglose.sql > /tmp/poliza361-captura-local.log
python3 - <<'PY'
import json
from pathlib import Path
log = Path('/tmp/poliza361-captura-local.log').read_text()
rows = json.loads(next(line for line in log.splitlines() if line.startswith('[{')))
assert len(rows) == 6
assert all(row['version'] == 361 for row in rows)
assert all('rfcEmisor' in g for row in rows for g in row['gastos'])
Path('src/app/api/export/poliza/fixtures/poliza361_rpc.json').write_text(json.dumps(rows, indent=2) + '\n')
PY
npx vitest run src/app/api/export/poliza/salida.test.ts
```

Los `gastos` de esta captura traen `rfcEmisor: null` porque el generador sintético de la 0342 no puebla `rfc_emisor`: lo que fija es que **la clave exista** (sin ella la ruta responde 409). El caso con emisores poblados —dos estaciones distintas, la herencia de grupo de la 0358 y la cadena vacía— vive en `supabase/tests/0361_poliza_dedup_emisor.sql` y en `asiento_dedup_emisor.test.ts`.

No ejecutar la fixture en producción ni reutilizar datos reales. Cambian UUID y fecha de ejecución al regenerar; son sintéticos y no determinan el resultado contable.
