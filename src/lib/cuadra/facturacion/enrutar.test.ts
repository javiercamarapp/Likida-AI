import { describe, it, expect } from 'vitest';
import { enrutar, mensajeParaEncargado, repartir } from './enrutar';
import { armar } from './pendientes';

// ═══════════════════════════════════════════════════════════════════════════
// QUIÉN FACTURA CADA TICKET: la máquina o una persona.
//
// La regla salió de un dato verificado abriendo portales el 29-jul: G500 se
// factura con solo el RFC (CFDI emitido, UUID B0800A68…) y La Gas exige correo,
// teléfono y contraseña. La misma distinción que aquí decide el camino.
//
// EL TERCER CAMINO existe porque hay tickets que NADIE puede facturar con lo que
// se leyó: sin portal reconocido, sin un campo requerido, o ya vencidos.
// Mandarlos a la máquina sería llenar un formulario con huecos; mandarlos al
// encargado como "listo para capturar" sería mentirle.
// ═══════════════════════════════════════════════════════════════════════════

const HOY = '2026-08-04';
const g = (o: Record<string, unknown>) => ({
  id: String(o.id ?? '1'), concepto: String(o.concepto ?? 'diesel'), monto: Number(o.monto ?? 400),
  fecha: (o.fecha as string) ?? '2026-08-04', folio: 'folio' in o ? (o.folio as string) : '12345',
  rfc_emisor: null, cfdi_uuid: null, ocr_extra: (o.extra ?? {}) as Record<string, unknown>,
});
const CON_CUENTA = { urlFacturacion: 'https://facturacion.oxxogas.com/', webId: '650', estacion: 'E1' };
const SIN_CUENTA = { urlFacturacion: 'https://facturacion.enerser.com.mx/', webId: '650', estacion: 'E1' };

describe('enrutar', () => {
  it('sin cuenta → lo hace la máquina', () => {
    const r = enrutar(armar(g({ extra: SIN_CUENTA }), HOY));
    expect(r.via).toBe('automatico');
  });

  it('con cuenta → va con el encargado, que es quien tiene la sesión', () => {
    const r = enrutar(armar(g({ extra: CON_CUENTA }), HOY));
    expect(r.via).toBe('mensaje');
    if (r.via === 'mensaje') expect(r.motivo).toBe('requiere_cuenta');
  });

  it('portal no reconocido → incompleto, y dice cuál es el problema', () => {
    const r = enrutar(armar(g({ extra: {} }), HOY));
    expect(r.via).toBe('incompleto');
    if (r.via === 'incompleto') expect(r.falta.join(' ')).toMatch(/liga/);
  });

  it('vencido → no se manda a nadie a intentar lo imposible', () => {
    const r = enrutar(armar(g({ fecha: '2026-05-01', extra: SIN_CUENTA }), HOY));
    expect(r.via).toBe('incompleto');
    if (r.via === 'incompleto') expect(r.falta.join(' ')).toMatch(/venci/);
  });
});

describe('mensajeParaEncargado', () => {
  it('lleva la liga y los campos, y NO repite los datos del receptor', () => {
    const t = armar(g({ extra: CON_CUENTA }), HOY);
    const r = enrutar(t);
    if (r.via !== 'mensaje') throw new Error('esperaba mensaje');
    const m = mensajeParaEncargado(t, r);
    expect(m).toContain('oxxogas');
    // El RFC de la flota es el mismo en todos los portales y él ya lo tiene:
    // repetirlo en cada mensaje entierra lo que sí cambia.
    expect(m).not.toMatch(/RFC del receptor|razón social/i);
    expect(m).toMatch(/pide cuenta/);
  });

  it('marca cuando vence hoy, que es lo único que cambia la conducta', () => {
    const t = armar(g({ fecha: '2026-08-31', extra: CON_CUENTA }), '2026-08-31');
    const r = enrutar(t);
    if (r.via !== 'mensaje') throw new Error('esperaba mensaje');
    expect(mensajeParaEncargado(t, r)).toMatch(/VENCE HOY/);
  });
});

describe('repartir', () => {
  it('separa los tres caminos', () => {
    const lista = [
      armar(g({ id: 'a', extra: SIN_CUENTA }), HOY),
      armar(g({ id: 'b', extra: CON_CUENTA }), HOY),
      armar(g({ id: 'c', extra: {} }), HOY),
    ];
    const r = repartir(lista);
    expect(r.automaticos).toHaveLength(1);
    expect(r.mensajes).toHaveLength(1);
    expect(r.incompletos).toHaveLength(1);
  });
});
