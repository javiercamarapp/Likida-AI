import { describe, it, expect, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));

import { responder, CATALOGO_CONSULTA } from './chat';
import type { DashboardKpis, Acreditables } from '@/lib/likida/analytics';

// A37-S16-09: el respondedor local de reserva (palabras clave) contestaba una pregunta del catálogo con la rama de OTRA métrica
// («Monto observado por el motor» caía en «monto» = lo comprobado) y `q.includes('iva')` empataba subcadenas («relativa»).
// El comentario del catálogo decía «verificadas contra sus ramas una por una»: aquí se verifican de verdad.

const KPIS = { montoComprobado: 12000, viajesLiquidados: 4, conDiferencias: 1, porRevisar: 1, diferenciaDetectada: 300, tasaCuadre: 50 } as DashboardKpis;
const ACRED = { iva: 1000, peaje: 200, litrosDiesel: 300 } as Acreditables;

/** Qué debe decir la respuesta a cada pregunta del catálogo (cada una cae en SU rama, con SU cifra). */
const ESPERADO: Record<string, RegExp> = {
  'Muéstrame el desglose de lo comprobado a la fecha': /comprobados/,
  'Estado de las liquidaciones con diferencia o por revisar': /diferencia o están por revisar/,
  '¿Cuántos viajes están por revisar?': /diferencia o están por revisar/,
  'Monto observado por el motor en las liquidaciones': /\$300\.00.*(observ|fuera de regla)/s,
  'Tasa de cuadre del periodo': /tasa de cuadre es 50%/,
  '¿Cuántas liquidaciones cerraron sin diferencias?': /2 de 4 liquidaciones cerraron sin diferencias/,
  '¿Cuánto llevo comprobado?': /comprobados/,
  'Desglose de acreditables del periodo': /acreditables este periodo/,
  'IVA acreditable del periodo': /de IVA acreditable/,
  'Peaje acreditable del periodo': /de peaje acreditable/,
  'Litros de diésel elegibles para el estímulo': /elegibles para el estímulo/,
};

describe('el catálogo de Consulta contra las ramas del respondedor local', () => {
  it('el catálogo y esta tabla cubren las mismas preguntas', () => {
    expect(CATALOGO_CONSULTA.flatMap((c) => c.preguntas).sort()).toEqual(Object.keys(ESPERADO).sort());
  });
  it.each(Object.entries(ESPERADO))('«%s» cae en su rama', (pregunta, patron) => {
    expect(responder(pregunta, KPIS, ACRED).texto).toMatch(patron);
  });
  it('«Monto observado» NO responde con lo comprobado', () => {
    expect(responder('Monto observado por el motor en las liquidaciones', KPIS, ACRED).texto).not.toMatch(/comprobados/);
  });
  it('«iva» solo cuenta como palabra completa: «relativa» no dispara el IVA', () => {
    expect(responder('¿Cuál es mi cifra relativa?', KPIS, ACRED).texto).not.toMatch(/de IVA acreditable/);
    expect(responder('¿Cuánto IVA llevo?', KPIS, ACRED).texto).toMatch(/de IVA acreditable/);
  });
});
