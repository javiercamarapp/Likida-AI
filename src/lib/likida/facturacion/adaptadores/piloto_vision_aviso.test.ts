import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ═══════════════════════════════════════════════════════════════════════════
// EL PROMPT DEL PILOTO, ATADO AL AVISO — auditoría 21, CRÍTICO (legal C1).
//
// El piloto de visión manda a un modelo externo, en cada paso, los datos
// fiscales del receptor (RFC, razón social, CP, régimen, uso CFDI, correo) y
// una captura de pantalla del portal del comercio. Eso NO se puede quitar:
// el modelo es quien decide qué se escribe en cada campo —sin el RFC en el
// prompt no hay qué escribir en el campo RFC—, y en cuanto lo teclea, la
// captura del paso siguiente lo enseña de todos modos. Lo que SÍ se puede
// exigir es que el aviso de /privacidad declare esa salida (art. 35) y que
// nadie amplíe el prompt sin pasar por aquí.
//
// Es el mismo patrón de fondo que `seudonimo_puerta_unica.test.ts` vigila
// para prospectos: una protección pegada a UN llamador no protege al
// siguiente. Esta prueba fija DOS cosas:
//
//   1. El prompt del piloto interpola EXACTAMENTE los seis datos del receptor
//      declarados — un séptimo dato pone esto en rojo, y quien lo agregue
//      tiene que ampliar el aviso ANTES de ampliar la lista de abajo.
//   2. /privacidad enumera esos seis datos y la captura de pantalla en su
//      cláusula de encargados — si el aviso deja de decirlo, truena aquí,
//      no en una auditoría.
// ═══════════════════════════════════════════════════════════════════════════

const RAIZ = join(__dirname, '..', '..', '..', '..', '..');
const PILOTO = readFileSync(join(RAIZ, 'src/lib/likida/facturacion/adaptadores/piloto_vision.ts'), 'utf8');
const AVISO = readFileSync(join(RAIZ, 'src/app/privacidad/page.tsx'), 'utf8');

/** Los seis datos del receptor que el aviso declara. Cambiar esta lista exige
 *  cambiar TAMBIÉN la cláusula del art. 35 en /privacidad — en ese orden. */
const DECLARADOS = ['rfc', 'nombre', 'codigoPostal', 'regimenFiscal', 'usoCfdi', 'correo'];

describe('el piloto de visión no manda al modelo más datos del receptor que los que el aviso declara', () => {
  it('el prompt interpola exactamente los seis campos declarados, ni uno más', () => {
    // `const r = op.receptor` y luego `${r.campo}` — todo lo que salga del
    // receptor hacia el prompt pasa por esa forma. Un campo nuevo aparece aquí.
    const interpolados = [...PILOTO.matchAll(/\$\{r\.(\w+)\}/g)].map((m) => m[1]);
    expect([...new Set(interpolados)].sort()).toEqual([...DECLARADOS].sort());
  });

  it('ReceptorPiloto no creció en silencio: sus campos son los seis declarados', () => {
    // La otra puerta de entrada: si la interfaz gana un campo, alguien lo va a
    // interpolar tarde o temprano. Se exige revisar el aviso desde el tipo.
    const bloque = PILOTO.match(/export interface ReceptorPiloto \{([\s\S]*?)\}/);
    expect(bloque, 'ReceptorPiloto ya no está donde esta prueba lo lee').not.toBeNull();
    const campos = [...bloque![1].matchAll(/^\s*(\w+)\s*:/gm)].map((m) => m[1]);
    expect(campos.sort()).toEqual([...DECLARADOS].sort());
  });

  it('la captura de pantalla que se adjunta sigue siendo la del portal (images en generateStructured)', () => {
    // El autotest de la vigilancia: si el piloto deja de adjuntar la captura o
    // deja de llamar al modelo, esta prueba estaría vigilando un flujo que ya
    // no existe y hay que re-medir el aviso completo.
    expect(PILOTO).toMatch(/images:\s*captura/);
    expect(PILOTO).toMatch(/generateStructured/);
  });
});

describe('y /privacidad declara esa salida en su cláusula de encargados (art. 35)', () => {
  it('enumera los seis datos fiscales que viajan al modelo', () => {
    expect(AVISO).toMatch(/RFC, razón social, código postal, régimen fiscal, uso CFDI y el correo de recepción/);
  });
  it('declara las capturas de pantalla del portal del comercio', () => {
    expect(AVISO).toMatch(/capturas de pantalla del portal de facturación del comercio/);
  });
  it('y dice por qué: el modelo llena el formulario, no solo lee comprobantes', () => {
    expect(AVISO).toMatch(/llena ese formulario campo por campo/);
  });
});
