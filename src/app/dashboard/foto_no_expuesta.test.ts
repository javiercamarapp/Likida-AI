import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 9, CRÍTICO legal — la foto del ticket se guarda pero no se enseña.
//
// El aviso de privacidad (privacidad.ts:498) le promete al operador que un
// dato sensible que aparezca por accidente en su ticket "no se usa para nada".
// Nada en el intake filtra contenido sensible de la IMAGEN (`sanitizar.ts`
// solo cubre el texto que el OCR extrae de ella). Un botón "Ver foto" en el
// panel del contralor —que sí existió, commit 87ad2ee— convertía esa promesa
// en falsa: la foto se enseñaba, sin filtro, a quien la pidiera.
//
// `subirComprobante`/`ligaComprobante` (intake/almacen.ts) se quedan: guardar
// la foto tiene una base legal propia y distinta (CFF art. 30, conservación
// de comprobantes 5 años, prometida en privacidad.ts:507). Lo que no puede
// volver es la EXPOSICIÓN sin filtro. Esta prueba lee el código fuente del
// panel de detalle y falla si alguien reintroduce ese enlace.
// ═══════════════════════════════════════════════════════════════════════════

const PAGINA = readFileSync(
  fileURLToPath(new URL('./[id]/page.tsx', import.meta.url)),
  'utf8',
);

describe('el panel de detalle no vuelve a enseñar la foto del ticket', () => {
  it('no importa ligaComprobante', () => {
    expect(PAGINA).not.toMatch(/ligaComprobante/);
  });

  it('no trae el enlace "Ver foto"', () => {
    expect(PAGINA).not.toMatch(/Ver foto/);
  });
});
