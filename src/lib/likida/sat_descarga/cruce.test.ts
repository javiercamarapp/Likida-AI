import { describe, it, expect } from 'vitest';
import type { Gasto } from '@/types/likida';
import { decidirCruce } from './cruce';

// RFC real del padrón de monederos (Edenred / Ticket Car) — no un inventado:
// la prueba tiene que ejercer la lista de verdad, no un doble.
const RFC_MONEDERO = 'ASE930924SS7';
const RFC_ESTACION = 'GAS950101AB1';

function gasto(p: Partial<Gasto> & { id: string; monto: number }): Gasto {
  return {
    concepto: 'diesel', fecha: '2026-08-10', ...p,
  } as Gasto;
}

const CFDI_BASE = {
  uuid: 'aaaaaaaa-bbbb-4ccc-8ddd-000000000001',
  total: 1160,
  fecha: '2026-08-10T12:00:00',
  rfcEmisor: RFC_ESTACION,
  lineas: [],
};

describe('decidirCruce — el caso que da el valor', () => {
  it('un CFDI que coincide con UN ticket sin factura casa', () => {
    const r = decidirCruce(CFDI_BASE, [gasto({ id: 'g1', monto: 1160 })]);
    expect(r).toEqual({ destino: 'casado', gastoId: 'g1' });
  });

  it('sin ningún gasto que corresponda queda DISPONIBLE, que no es un error', () => {
    const r = decidirCruce(CFDI_BASE, [gasto({ id: 'g1', monto: 500 })]);
    expect(r.destino).toBe('disponible');
    if (r.destino !== 'disponible') return;
    // El motivo es la mitad del valor: un CFDI sin gasto puede ser un gasto
    // que nadie reportó.
    expect(r.motivo).toMatch(/nadie reportó/i);
  });

  it('sin gastos en absoluto no revienta', () => {
    expect(decidirCruce(CFDI_BASE, []).destino).toBe('disponible');
  });
});

describe('decidirCruce — ante la duda no se adivina', () => {
  it('dos gastos del mismo importe y día son AMBIGUOS: no se liga nada', () => {
    const r = decidirCruce(CFDI_BASE, [
      gasto({ id: 'g1', monto: 1160 }),
      gasto({ id: 'g2', monto: 1160 }),
    ]);
    expect(r.destino).toBe('ambiguo');
    if (r.destino !== 'ambiguo') return;
    expect(r.candidatos.map((c) => c.gastoId).sort()).toEqual(['g1', 'g2']);
  });

  it('dos del mismo importe en DÍAS distintos: la fecha desempata y casa', () => {
    const r = decidirCruce(CFDI_BASE, [
      gasto({ id: 'g1', monto: 1160, fecha: '2026-08-10' }),
      gasto({ id: 'g2', monto: 1160, fecha: '2026-08-03' }),
    ]);
    expect(r).toEqual({ destino: 'casado', gastoId: 'g1' });
  });

  it('un gasto que YA tiene folio fiscal no es candidato', () => {
    const r = decidirCruce(CFDI_BASE, [
      gasto({ id: 'g1', monto: 1160, cfdiUuid: 'aaaaaaaa-bbbb-4ccc-8ddd-999999999999' }),
    ]);
    expect(r.destino).toBe('disponible');
  });

  it('un CFDI sin total legible no cruza nada', () => {
    const r = decidirCruce({ ...CFDI_BASE, total: undefined }, [gasto({ id: 'g1', monto: 1160 })]);
    expect(r.destino).toBe('disponible');
    if (r.destino !== 'disponible') return;
    expect(r.motivo).toMatch(/sin monto/i);
  });
});

describe('decidirCruce — el RFC manda cuando el ticket lo trae', () => {
  it('un ticket con OTRO RFC no casa aunque el importe cuadre', () => {
    const r = decidirCruce(CFDI_BASE, [
      gasto({ id: 'g1', monto: 1160, rfcEmisor: 'XXX010101XX1' }),
    ]);
    expect(r.destino).toBe('disponible');
  });

  it('un ticket con el MISMO RFC casa', () => {
    const r = decidirCruce(CFDI_BASE, [
      gasto({ id: 'g1', monto: 1160, rfcEmisor: RFC_ESTACION.toLowerCase() }),
    ]);
    expect(r).toEqual({ destino: 'casado', gastoId: 'g1' });
  });

  it('el RFC desempata lo que sería ambiguo por monto', () => {
    const r = decidirCruce(CFDI_BASE, [
      gasto({ id: 'g1', monto: 1160, rfcEmisor: RFC_ESTACION }),
      gasto({ id: 'g2', monto: 1160, rfcEmisor: 'XXX010101XX1' }),
    ]);
    expect(r).toEqual({ destino: 'casado', gastoId: 'g1' });
  });

  it('un ticket SIN RFC leído sigue siendo candidato — el OCR no siempre lo saca', () => {
    const r = decidirCruce(CFDI_BASE, [gasto({ id: 'g1', monto: 1160, rfcEmisor: undefined })]);
    expect(r).toEqual({ destino: 'casado', gastoId: 'g1' });
  });
});

describe('decidirCruce — la regla del monedero (RMF 3.3.1.7)', () => {
  it('un CFDI de EMISOR DE MONEDERO no se cruza 1:1 NUNCA, aunque el importe cuadre exacto', () => {
    // El caso catastrófico: sin esta regla, el CFDI mensual del monedero se
    // pegaría a una sola carga y dejaría el resto del mes sin comprobante.
    const r = decidirCruce(
      { ...CFDI_BASE, rfcEmisor: RFC_MONEDERO },
      [gasto({ id: 'g1', monto: 1160 })],
    );
    expect(r.destino).toBe('consolidado');
    if (r.destino !== 'consolidado') return;
    expect(r.emisor).toMatch(/Edenred/i);
  });

  it('la decisión de consolidado se toma ANTES que el empate por monto', () => {
    const r = decidirCruce(
      { ...CFDI_BASE, rfcEmisor: RFC_MONEDERO },
      [gasto({ id: 'g1', monto: 1160 }), gasto({ id: 'g2', monto: 1160 })],
    );
    expect(r.destino).toBe('consolidado');
  });

  it('un CFDI con VARIAS líneas ECC es consolidado aunque su emisor no esté en la semilla del padrón', () => {
    // `estaEnPadronMonederos` da un sí afirmativo, nunca un no autoritativo:
    // la FORMA del comprobante tiene que poder mandar sobre la lista.
    const r = decidirCruce({
      ...CFDI_BASE,
      rfcEmisor: 'NUE010101XY9',
      lineas: [
        { indice: 1, fuente: 'ecc12', monto: 500 },
        { indice: 2, fuente: 'ecc12', monto: 660 },
      ],
    }, [gasto({ id: 'g1', monto: 1160 })]);
    expect(r.destino).toBe('consolidado');
  });

  it('UNA sola línea ECC no basta para llamarlo consolidado', () => {
    const r = decidirCruce({
      ...CFDI_BASE,
      lineas: [{ indice: 1, fuente: 'ecc12', monto: 1160 }],
    }, [gasto({ id: 'g1', monto: 1160 })]);
    expect(r).toEqual({ destino: 'casado', gastoId: 'g1' });
  });

  it('un gasto PAGADO CON MONEDERO no acepta un CFDI de estación, y se dice por qué', () => {
    // El ticket trae el RFC del emisor del monedero (así lo detecta
    // `evidenciaMonedero`): su comprobante es la línea ECC, no un CFDI de la
    // gasolinera — que por la regla 3.3.1.7 ni siquiera existe.
    const r = decidirCruce(
      { ...CFDI_BASE, rfcEmisor: undefined },
      [gasto({ id: 'g1', monto: 1160, rfcEmisor: RFC_MONEDERO })],
    );
    expect(r.destino).toBe('disponible');
    if (r.destino !== 'disponible') return;
    expect(r.motivo).toMatch(/monedero/i);
    expect(r.motivo).toMatch(/3\.3\.1\.7/);
  });
});
