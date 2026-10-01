// Regenera docs/operacion/plantillas-meta.md desde el catálogo.
//   npx tsx scripts/generar-doc-plantillas.ts
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderizarDocPlantillas } from '@/lib/meta/plantillas_doc';

const destino = join(process.cwd(), 'docs/operacion/plantillas-meta.md');
writeFileSync(destino, `${renderizarDocPlantillas()}\n`, 'utf8');
console.log(`escrito ${destino}`);
