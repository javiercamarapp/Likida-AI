import { describe, it, expect, vi } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 24 · WA-9 (MEDIO) — lo que se le contesta a un mensaje que no
// sabemos leer. La lista de formatos era la misma para todo, y por eso no
// servía: el chofer que manda un video de la llanta ponchada leía «solo
// proceso texto, fotos de comprobantes, el XML del CFDI y tu ubicación» sin
// una palabra sobre el video, y concluía que el bot no entiende.
//
// Las reacciones (👍) no llegan a este texto: `extractMessages` las descarta
// antes del inbox (`route_cableado.test.ts`).
// ═══════════════════════════════════════════════════════════════════════════

vi.mock('@/lib/likida/tools', () => ({}));

const { mensajeTipoNoSoportado, mensajeDocumentoNoEsXml, puedeSerXml } = await import('./processor');

describe('mensajeTipoNoSoportado — se nombra lo que mandó, no un catálogo', () => {
  it('el video: se dice que no se lee y qué hacer en su lugar', () => {
    const t = mensajeTipoNoSoportado('video');
    expect(t).toMatch(/video/i);
    expect(t).toMatch(/foto/i);
  });

  it('el sticker: se le pide que escriba, sin sermón de formatos', () => {
    const t = mensajeTipoNoSoportado('sticker');
    expect(t).toMatch(/sticker/i);
    expect(t).not.toMatch(/XML del CFDI y tu ubicación/);
  });

  it('el contacto compartido: se le ofrece la salida que sí existe (yo le aviso)', () => {
    const t = mensajeTipoNoSoportado('contacts');
    expect(t).toMatch(/contactos/i);
    expect(t).toMatch(/jefe/i);
  });

  it('sin subtipo (o uno que no conocemos) queda el texto de siempre', () => {
    expect(mensajeTipoNoSoportado()).toMatch(/solo proceso texto/i);
    expect(mensajeTipoNoSoportado('nfm_reply')).toMatch(/solo proceso texto/i);
  });

  it('todos terminan diciendo qué mandar: el chofer no se queda sin siguiente paso', () => {
    for (const s of [undefined, 'sticker', 'video', 'contacts', 'unsupported']) {
      expect(mensajeTipoNoSoportado(s)).toMatch(/Mándame la foto de tu ticket o el XML/);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 24 · WA-8 (MEDIO) — un `document` que no es XML se bajaba ENTERO
// (WhatsApp permite 100 MB) para descubrir después que no servía, y se
// contestaba siempre lo mismo: «necesito el XML del CFDI, no el PDF». El
// chofer con iPhone que usa «Documento» para no perder calidad manda un
// `image/heic` y lee que mandó un PDF — que no mandó.
// ═══════════════════════════════════════════════════════════════════════════
describe('puedeSerXml — se descarta lo que con certeza NO es, nunca por lista blanca', () => {
  it('los mimes con los que un XML reenviado llega de verdad pasan todos', () => {
    for (const m of ['text/xml', 'application/xml', 'application/octet-stream', 'text/plain']) {
      expect(puedeSerXml(m), m).toBe(true);
    }
  });

  it('si Meta no dijo el mime, se intenta igual (fail-open: rebotar un XML bueno es peor)', () => {
    expect(puedeSerXml(undefined)).toBe(true);
    expect(puedeSerXml('')).toBe(true);
  });

  it('imagen, PDF, video y audio NO son el XML', () => {
    for (const m of ['image/heic', 'image/jpeg', 'application/pdf', 'video/mp4', 'audio/ogg']) {
      expect(puedeSerXml(m), m).toBe(false);
    }
  });

  it('el mime en mayúsculas se entiende igual', () => {
    expect(puedeSerXml('APPLICATION/PDF')).toBe(false);
  });
});

describe('mensajeDocumentoNoEsXml — le dice lo que mandó, no lo que no mandó', () => {
  it('el HEIC del iPhone: mandado como archivo, y qué botón usar', () => {
    const t = mensajeDocumentoNoEsXml('image/heic');
    expect(t).toMatch(/archivo/i);
    expect(t).toMatch(/cámara|galería/i);
    expect(t, 'no mandó ningún PDF').not.toMatch(/PDF/);
  });

  it('el PDF del CFDI: se nombra, y se pide el .xml que viene con él', () => {
    const t = mensajeDocumentoNoEsXml('application/pdf');
    expect(t).toMatch(/PDF/);
    expect(t).toMatch(/XML/);
  });

  it('sin mime conocido queda el texto de siempre', () => {
    expect(mensajeDocumentoNoEsXml()).toMatch(/necesito el \*XML\* del CFDI/);
  });
});
