import { describe, it, expect } from 'vitest';
import { armarAviso } from './avisar';
import { armar } from './pendientes';

// ═══════════════════════════════════════════════════════════════════════════
// EL AVISO POR WHATSAPP — cierra el camino que empieza en la foto del ticket.
//
// Se leyó la liga del ticket, se reconoció el portal, se calculó el plazo, y el
// aviso sale por el MISMO canal por el que entró la foto.
//
// LAS TRES REGLAS QUE ESTE ARCHIVO FIJA, y las tres existen porque el modo de
// falla es que el encargado deje de leer los avisos:
//
//   1. UNO por flota, no uno por ticket. Un viaje de 22 comprobantes generaría
//      21 mensajes; nadie lee 21, y WhatsApp cobra cada plantilla.
//   2. No se avisa de lo que la máquina hace sola. Avisar de algo que ya se
//      está haciendo entrena a ignorar el aviso.
//   3. No se avisa de lo vencido. Ya no se puede facturar: mandar a alguien a
//      intentar lo imposible quema el canal.
// ═══════════════════════════════════════════════════════════════════════════

const HOY = '2026-08-04';
const g = (o: Record<string, unknown>) => ({
  id: String(o.id), concepto: String(o.concepto ?? 'diesel'), monto: Number(o.monto ?? 400),
  fecha: (o.fecha as string) ?? null, folio: (o.folio as string) ?? '12345',
  rfc_emisor: null, cfdi_uuid: null, ocr_extra: (o.extra ?? {}) as Record<string, unknown>,
});

// OXXO Gas pide cuenta → va por mensaje. Enerser no → lo hace la máquina.
const CON_CUENTA = { urlFacturacion: 'https://facturacion.oxxogas.com/', webId: '650', estacion: 'E1' };
const SIN_CUENTA = { urlFacturacion: 'https://facturacion.enerser.com.mx/', webId: '650', estacion: 'E1' };

describe('armarAviso', () => {
  it('NO avisa de lo que la máquina puede hacer sola', () => {
    const t = [armar(g({ id: '1', fecha: '2026-08-04', extra: SIN_CUENTA }), HOY)];
    expect(armarAviso(t).cuantos).toBe(0);
  });

  it('avisa de los que piden cuenta, que son los que necesitan a la persona', () => {
    const t = [armar(g({ id: '1', fecha: '2026-08-04', extra: CON_CUENTA }), HOY)];
    const a = armarAviso(t);
    expect(a.cuantos).toBe(1);
    expect(a.texto).toContain('sin factura');
  });

  it('NO avisa de lo vencido — ya no se puede hacer nada', () => {
    const t = [armar(g({ id: '1', fecha: '2026-05-01', extra: CON_CUENTA }), HOY)];
    expect(armarAviso(t).cuantos).toBe(0);
  });

  it('pone lo que URGE primero y lo marca', () => {
    const t = [
      armar(g({ id: 'tranquilo', concepto: 'caseta', fecha: '2026-08-25', extra: CON_CUENTA }), '2026-08-05'),
      armar(g({ id: 'urgente', concepto: 'hospedaje', fecha: '2026-08-31', extra: CON_CUENTA }), '2026-08-30'),
    ];
    const a = armarAviso(t);
    // El urgente aparece antes que el tranquilo en el cuerpo del mensaje.
    expect(a.texto.indexOf('hospedaje')).toBeLessThan(a.texto.indexOf('caseta'));
    expect(a.texto).toMatch(/vence/i);
  });

  it('con más de 6 no los lista todos: dice cuántos faltan', () => {
    // Listar 20 hace que no se lea ninguno. Decir "y 14 más" es honesto y cabe
    // en la pantalla de un teléfono.
    const t = Array.from({ length: 9 }, (_, i) =>
      armar(g({ id: `t${i}`, fecha: '2026-08-20', extra: CON_CUENTA }), HOY));
    const a = armarAviso(t);
    expect(a.cuantos).toBe(9);
    expect(a.texto).toMatch(/y 3 más/);
  });

  it('sin nada que hacer NO arma mensaje — no se gasta una plantilla en vacío', () => {
    expect(armarAviso([]).texto).toBe('');
  });
});
