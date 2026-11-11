import { describe, expect, it } from 'vitest';
import { conteosVacios } from '@/lib/likida/vendedores';
import { embudoDeVentas } from './embudo-ventas';

describe('embudoDeVentas: cada etapa cuenta a quien está en ella o más adelante', () => {
  it('la serie nunca sube y deja fuera lo que se cayó sin repartirlo', () => {
    const t = { ...conteosVacios(), nuevo: 10, contactado: 6, appointment: 2, rescheduled: 1, demo: 3, proposal: 2, pilot: 1, won: 1, cancelled: 4, 'no-show': 2, lost: 5 };
    const { etapas, fuera, enRuta } = embudoDeVentas(t);
    expect(etapas.map((e) => e.valor)).toEqual([26, 16, 10, 7, 4, 2, 1]);
    expect(etapas.map((e) => e.etiqueta)).toEqual(['Nuevo', 'Contactado', 'Cita', 'Demo', 'Propuesta', 'Piloto', 'Ganado']);
    expect(fuera).toBe(11);
    expect(enRuta).toBe(26);
    for (let i = 1; i < etapas.length; i++) expect(etapas[i].valor!).toBeLessThanOrEqual(etapas[i - 1].valor!);
  });
  it('sin prospectos en la ruta: enRuta 0 (la pantalla lo dice, no pinta un embudo de ceros)', () => {
    const r = embudoDeVentas({ ...conteosVacios(), lost: 3 });
    expect(r.enRuta).toBe(0);
    expect(r.fuera).toBe(3);
  });
});
