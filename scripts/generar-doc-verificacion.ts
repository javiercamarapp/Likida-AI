// Regenera docs/operacion/verificacion-portales.md desde el estado real (guiones, registro y fixtures).
//   npx tsx scripts/generar-doc-verificacion.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GUIONES } from '@/lib/likida/facturacion/adaptadores/portales';
import { REGISTRO_VERIFICACIONES } from '@/lib/likida/autofactura/registro_verificaciones';
import { renderizarDocVerificacion } from '@/lib/likida/autofactura/doc_verificacion';

const manifiesto = JSON.parse(readFileSync(join(process.cwd(), 'src/lib/likida/facturacion/adaptadores/fixtures/manifest.json'), 'utf8'));
const destino = join(process.cwd(), 'docs/operacion/verificacion-portales.md');
writeFileSync(destino, renderizarDocVerificacion(GUIONES, REGISTRO_VERIFICACIONES, manifiesto), 'utf8');
console.log(`escrito ${destino}`);
