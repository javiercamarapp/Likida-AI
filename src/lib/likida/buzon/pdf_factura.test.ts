import { describe, it, expect, vi } from 'vitest';
import {
  leerPdfFactura, extraerDeTexto, uuidsEnTexto, esPdf, requiereRevision, MAX_PDF_BYTES, UMBRAL_REVISION,
  type PuertosPdf, type LecturaVision,
} from './pdf_factura';

const UUID = 'AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE';
const OTRO = '11111111-2222-4333-8444-555555555555';
const PDF = Buffer.from('%PDF-1.4\n...');
const senal = () => AbortSignal.timeout(5000);

const TEXTO_CFDI = `FACTURA
Folio fiscal: ${UUID}
RFC Emisor: AAA010101AAA
RFC Receptor: BBB010101BBB
Fecha de emisión: 2026-09-30T10:00:00
Subtotal $1,000.00
IVA 16% $160.00
Total $1,160.00`;

function puertos(extra: Partial<PuertosPdf> = {}, texto = TEXTO_CFDI): PuertosPdf {
  return {
    leerTexto: async () => ({ ok: true, texto }),
    imagenes: async () => ['data:image/jpeg;base64,AAAA'],
    vision: async () => { throw new Error('la visión no debía llamarse'); },
    ...extra,
  };
}
const lectura = (extra: Partial<LecturaVision> = {}): LecturaVision => ({
  legible: true, uuid: UUID, monto: 1160, subTotal: 1000, rfcEmisor: 'AAA010101AAA', rfcReceptor: 'BBB010101BBB',
  fecha: '2026-09-30', confianza: 0.95, ...extra,
});

describe('extraerDeTexto', () => {
  it('saca UUID (en minúsculas), total, subtotal, RFC y fecha', () => {
    const t = extraerDeTexto(TEXTO_CFDI);
    expect(t).toEqual({
      uuids: [UUID.toLowerCase()], total: 1160, subTotal: 1000, rfcEmisor: 'AAA010101AAA', rfcReceptor: 'BBB010101BBB', fecha: '2026-09-30',
    });
  });
  it('el total es el ÚLTIMO «Total» (los anteriores son parciales) y no confunde Subtotal ni Totales', () => {
    const t = extraerDeTexto('Subtotal $10.00\nTotal concepto 1: $20.00\nTotales de la página\nTotal: $1,234.56');
    expect(t.total).toBe(1234.56);
    expect(t.subTotal).toBe(10);
  });
  it('varios UUID distintos se devuelven todos (la decisión es del llamador); el repetido cuenta una vez', () => {
    expect(uuidsEnTexto(`${UUID} ${UUID.toLowerCase()} ${OTRO}`)).toHaveLength(2);
  });
  it('sin nada reconocible devuelve vacíos, no inventa', () => {
    expect(extraerDeTexto('Hola, te mando la factura mañana')).toEqual({
      uuids: [], total: null, subTotal: null, rfcEmisor: null, rfcReceptor: null, fecha: null,
    });
  });
});

describe('leerPdfFactura — texto primero', () => {
  it('un PDF con capa de texto completa se lee SIN llamar a la visión, con confianza 0.9 (no revisión)', async () => {
    const r = await leerPdfFactura(PDF, puertos(), { signal: senal() });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.datos).toMatchObject({ uuid: UUID.toLowerCase(), total: 1160, fuente: 'pdf_texto', confianza: 0.9, rfcEmisor: 'AAA010101AAA' });
      expect(requiereRevision(r.datos.confianza)).toBe(false);
    }
  });

  it('con UUID y total pero sin los RFC la confianza baja a 0.7 y exige revisión', async () => {
    const r = await leerPdfFactura(PDF, puertos({}, `Folio ${UUID}\nTotal $50.00`), { signal: senal() });
    expect(r.ok && r.datos.confianza).toBe(0.7);
    expect(r.ok && requiereRevision(r.datos.confianza)).toBe(true);
    expect(UMBRAL_REVISION).toBe(0.8);
  });

  it('si el llamador ya leyó el texto, no se vuelve a abrir el PDF', async () => {
    const leerTexto = vi.fn();
    await leerPdfFactura(PDF, puertos({ leerTexto }), { textoYaLeido: TEXTO_CFDI, signal: senal() });
    expect(leerTexto).not.toHaveBeenCalled();
  });
});

describe('leerPdfFactura — visión cuando el texto no alcanza', () => {
  it('un PDF escaneado (sin texto) va a visión y toma la confianza del lector', async () => {
    const vision = vi.fn(async () => lectura({ confianza: 0.55 }));
    const r = await leerPdfFactura(PDF, puertos({ vision }, ''), { signal: senal() });
    expect(vision).toHaveBeenCalledTimes(1);
    expect(r.ok && r.datos).toMatchObject({ uuid: UUID.toLowerCase(), total: 1160, fuente: 'pdf_vision', confianza: 0.55 });
    expect(r.ok && requiereRevision(r.datos.confianza)).toBe(true);
  });

  it('un UUID ambiguo en el texto (dos folios) NO se adivina: va a visión', async () => {
    const vision = vi.fn(async () => lectura());
    await leerPdfFactura(PDF, puertos({ vision }, `${UUID} ${OTRO}\nTotal $1,160.00`), { signal: senal() });
    expect(vision).toHaveBeenCalled();
  });

  it('si la visión discrepa del texto en el folio o el total, la confianza se desploma y se dice por qué', async () => {
    const r = await leerPdfFactura(PDF, puertos({ vision: async () => lectura({ uuid: OTRO, confianza: 0.95 }) }, `${UUID}\nsin total aquí`), { signal: senal() });
    expect(r.ok && r.datos.confianza).toBe(0.5);
    expect(r.ok && r.datos.notas.join(' ')).toContain('no coincide');
    const r2 = await leerPdfFactura(PDF, puertos({ vision: async () => lectura({ monto: 999 }) }, `${UUID} ${OTRO}\nTotal $1,160.00`), { signal: senal() });
    expect(r2.ok && r2.datos.confianza).toBe(0.6);
  });

  it('un lector que no declara su confianza deja la lectura en 0 (lo más urgente de revisar) y lo anota', async () => {
    const r = await leerPdfFactura(PDF, puertos({ vision: async () => lectura({ confianza: null }) }, ''), { signal: senal() });
    expect(r.ok && r.datos.confianza).toBe(0);
    expect(r.ok && r.datos.notas.join(' ')).toContain('no declaró');
  });
});

describe('leerPdfFactura — lo que NO se puede leer', () => {
  it.each([
    ['ilegible', lectura({ legible: false })],
    ['sin_uuid', lectura({ uuid: null })],
    ['sin_total', lectura({ monto: 0 })],
  ] as const)('visión que dice %s', async (motivo, l) => {
    const r = await leerPdfFactura(PDF, puertos({ vision: async () => l }, ''), { signal: senal() });
    expect(r).toEqual({ ok: false, motivo });
  });

  it('el proveedor de visión caído es TRANSITORIO (el correo se reintenta), no un descarte', async () => {
    const r = await leerPdfFactura(PDF, puertos({ vision: async () => { throw new Error('503'); } }, ''), { signal: senal() });
    expect(r).toEqual({ ok: false, motivo: 'transitorio' });
  });

  it('PDF corrupto o protegido con contraseña', async () => {
    expect(await leerPdfFactura(PDF, puertos({ leerTexto: async () => ({ ok: false, motivo: 'corrupto' }) }), { signal: senal() }))
      .toEqual({ ok: false, motivo: 'corrupto' });
    expect(await leerPdfFactura(PDF, puertos({ leerTexto: async () => ({ ok: false, motivo: 'protegido' }) }), { signal: senal() }))
      .toEqual({ ok: false, motivo: 'protegido' });
  });

  it('no es PDF (por bytes, no por extensión) o pasa del tope: ni se abre', async () => {
    const leerTexto = vi.fn();
    expect(await leerPdfFactura(Buffer.from('MZ ejecutable'), puertos({ leerTexto }), { signal: senal() })).toEqual({ ok: false, motivo: 'no_es_pdf' });
    expect(await leerPdfFactura(Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(MAX_PDF_BYTES)]), puertos({ leerTexto }), { signal: senal() }))
      .toEqual({ ok: false, motivo: 'demasiado_grande' });
    expect(leerTexto).not.toHaveBeenCalled();
    expect(esPdf(PDF)).toBe(true);
  });

  it('sin imágenes que rendir y sin texto útil: ilegible', async () => {
    expect(await leerPdfFactura(PDF, puertos({ imagenes: async () => [] }, ''), { signal: senal() })).toEqual({ ok: false, motivo: 'ilegible' });
  });
});
