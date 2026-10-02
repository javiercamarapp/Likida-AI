import { describe, it, expect } from 'vitest';
import {
  parsearDestinatarios, validarConfigEntrega, tocaLoteAutomatico, decidirTamanoLote, trasFallo, horaMx, nombreArchivoFactura,
  textoCorreoEntrega, CONFIG_ENTREGA_DEFAULT, MAX_FACTURAS_POR_LOTE, MAX_INTENTOS, type ConfigEntrega,
} from './entrega_pura';

const CFG: ConfigEntrega = { ...CONFIG_ENTREGA_DEFAULT, activo: true, automatica: true, destinatarios: ['conta@x.mx'], horaEnvio: 8 };
// 14:00 UTC = 08:00 en Ciudad de México (UTC-6, sin horario de verano desde 2022).
const OCHO_MX = new Date('2026-10-02T14:00:00Z');

describe('destinatarios y configuración', () => {
  it('separa por coma, espacio, punto y coma o renglón; normaliza y quita repetidos', () => {
    expect(parsearDestinatarios('A@x.mx; b@x.mx\n a@x.mx, c@x.mx')).toEqual({ ok: true, destinatarios: ['a@x.mx', 'b@x.mx', 'c@x.mx'] });
  });
  it('rechaza lo que no es un correo y más de cinco', () => {
    expect(parsearDestinatarios('hola')).toMatchObject({ ok: false });
    expect(parsearDestinatarios('a@x.mx b@x.mx c@x.mx d@x.mx e@x.mx f@x.mx')).toMatchObject({ ok: false });
  });
  it('activar sin destinatario no es una configuración (igual que el CHECK de la 0531)', () => {
    expect(validarConfigEntrega({ ...CONFIG_ENTREGA_DEFAULT, activo: true })).toMatch(/correo del contador/);
    expect(validarConfigEntrega(CFG)).toBeNull();
    expect(validarConfigEntrega({ ...CFG, horaEnvio: 24 })).toMatch(/0 a 23/);
    expect(validarConfigEntrega({ ...CFG, minFacturas: 0 })).toMatch(/1 a 100/);
  });
});

describe('cuándo toca el lote automático', () => {
  it('la hora se lee en México, no en UTC', () => {
    expect(horaMx(OCHO_MX)).toBe(8);
    expect(horaMx(new Date('2026-10-02T13:59:00Z'))).toBe(7);
  });
  it('antes de la hora no; a la hora sí; y solo UNO por día de México aunque el cron corra cada 15 minutos', () => {
    expect(tocaLoteAutomatico(CFG, new Date('2026-10-02T13:45:00Z'), null)).toBe(false);
    expect(tocaLoteAutomatico(CFG, OCHO_MX, null)).toBe(true);
    expect(tocaLoteAutomatico(CFG, new Date('2026-10-02T15:00:00Z'), '2026-10-02T14:00:05Z')).toBe(false);
    // el lote de AYER (día México distinto) no cuenta
    expect(tocaLoteAutomatico(CFG, OCHO_MX, '2026-10-01T14:00:05Z')).toBe(true);
  });
  it('apagada, no automática o sin destinatarios: nunca', () => {
    expect(tocaLoteAutomatico({ ...CFG, activo: false }, OCHO_MX, null)).toBe(false);
    expect(tocaLoteAutomatico({ ...CFG, automatica: false }, OCHO_MX, null)).toBe(false);
    expect(tocaLoteAutomatico({ ...CFG, destinatarios: [] }, OCHO_MX, null)).toBe(false);
  });
});

describe('tamaño del lote y reintentos', () => {
  it('el automático respeta el mínimo; el manual no; el tope es el del correo', () => {
    expect(decidirTamanoLote(2, 'automatica', 3)).toBe(0);
    expect(decidirTamanoLote(2, 'manual', 3)).toBe(2);
    expect(decidirTamanoLote(0, 'manual', 1)).toBe(0);
    expect(decidirTamanoLote(MAX_FACTURAS_POR_LOTE + 50, 'manual', 1)).toBe(MAX_FACTURAS_POR_LOTE);
  });
  it('backoff 15 min, 1 h, 4 h, 12 h y al quinto intento queda fallida (visible, no reintento ciego)', () => {
    const t0 = new Date('2026-10-02T14:00:00Z');
    const min = (n: number) => (trasFallo(n, t0).proximoIntentoEn!.getTime() - t0.getTime()) / 60_000;
    expect([1, 2, 3, 4].map(min)).toEqual([15, 60, 240, 720]);
    expect(trasFallo(MAX_INTENTOS, t0)).toEqual({ estado: 'fallida', proximoIntentoEn: null });
  });
});

describe('archivos y texto', () => {
  it('el nombre dentro del zip no admite rutas ni caracteres raros', () => {
    expect(nombreArchivoFactura('AAA010101AAA', 'aaaaaaaa-bbbb', 'xml')).toBe('AAA010101AAA_aaaaaaaa-bbbb.xml');
    expect(nombreArchivoFactura('../../etc', 'x/../y', 'pdf')).not.toMatch(/[/\\]/);
    expect(nombreArchivoFactura(null, 'u1', 'pdf')).toBe('SIN-RFC_u1.pdf');
  });
  it('el correo avisa cuando una factura del lote no tiene XML (cifras de lectura, no del CFDI)', () => {
    const t = textoCorreoEntrega({ nFacturas: 3, total: 100, formato: 'sap_b1', incluyeZip: true, faltanXml: 1, nombreFlota: 'Cliente demo' });
    expect(t.asunto).toContain('3');
    expect(t.parrafos.join(' ')).toMatch(/SAP Business One/);
    expect(t.parrafos.join(' ')).toMatch(/no tiene XML/);
    expect(textoCorreoEntrega({ nFacturas: 1, total: 1, formato: 'generico', incluyeZip: false, faltanXml: 0, nombreFlota: null }).parrafos.join(' ')).not.toMatch(/no tiene XML/);
  });
});
