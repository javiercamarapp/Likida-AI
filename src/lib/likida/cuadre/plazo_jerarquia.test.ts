import { describe, it, expect } from 'vitest';
import { cuadrarViaje } from './engine';
import { comercio } from '../facturacion/comercios';
import type { Gasto } from '@/types/likida';

// ═══════════════════════════════════════════════════════════════════════════
// UN PLAZO DE NIVEL 6 NO PUEDE SONAR A OBLIGACIÓN FISCAL.
//
// `normas/politica-portales-plazos.yaml` (`jerarquia: 6`, `sin_verificar`) lo
// dice con todas sus letras:
//
//   "ESTO NO ES UNA NORMA FISCAL… El plazo LEGAL para pedir factura es todo el
//    ejercicio (el SAT lo dice expresamente), y negarla porque 'ya pasó el mes'
//    es una práctica indebida listada por el propio SAT… El producto NUNCA debe
//    presentar estos plazos como una obligación fiscal."
//
// La rama VENCIDA ya lo decía ("legalmente puedes exigirlo dentro del
// ejercicio"). Las otras dos no. Sobre el ticket real de Office Depot del
// 25-jul-2026 —la única entrada del catálogo con `plazoVerificado: true`, leída
// del papel— el aviso salía así:
//
//   "…sigue sin factura: puedes timbrarlo hasta el 2026-08-31 (34 días)."
//
// Un contralor que lee eso concluye que el 1-sep perdió el CFDI, y no es
// cierto. Es el error de confundir niveles que `normas/README.md` llama el más
// caro del dominio, cometido por el papel que vendemos.
// ═══════════════════════════════════════════════════════════════════════════

const ticketOfficeDepot = (over: Partial<Gasto> = {}): Gasto => ({
  id: 'g1', concepto: 'otro', monto: 1450.5, fecha: '2026-07-25',
  folio: 'ITU-000123', ocrConfianza: 0.97,
  rfcEmisor: 'ODM950324V2A',   // Office Depot de México
  ...over,
});

const avisos = (g: Gasto, hoy: string) =>
  cuadrarViaje({ viajeId: 'v1', anticipo: 5000, gastos: [g], politica: [], hoy })
    .diferencias.filter((d) => d.tipo === 'factura_por_vencer');

describe('el plazo del comercio se dice como política, no como ley', () => {
  it('Office Depot sigue siendo la única entrada con plazo VERIFICADO', () => {
    // Si alguien marca otra como verificada sin leer su portal, esto lo saca a
    // la luz junto con la ficha, que es la que tiene que enterarse.
    expect(comercio('office_depot')?.plazoVerificado).toBe(true);
    expect(comercio('office_depot')?.plazo).toBe('mes_siguiente');
    expect(comercio('oxxo')?.plazoVerificado).toBe(false);
  });

  it('el cálculo del ticket real sigue siendo el correcto (31-ago, no 31-jul)', () => {
    const a = avisos(ticketOfficeDepot(), '2026-07-28');
    expect(a).toHaveLength(1);
    expect(a[0].nota).toContain('2026-08-31');
    expect(a[0].nota).toContain('34 días');
  });

  it('con plazo VERIFICADO dice de quién es el plazo y que la ley da el ejercicio', () => {
    const nota = avisos(ticketOfficeDepot(), '2026-07-28')[0].nota;
    expect(nota).toContain('plazo del portal de Office Depot, no de la ley');
    expect(nota).toContain('dentro del ejercicio');
  });

  it('también en la rama URGENTE, que es la que más presiona a actuar', () => {
    // Un día antes del 31-ago: el tono cambia, el matiz de jerarquía no.
    const nota = avisos(ticketOfficeDepot(), '2026-08-30')[0].nota;
    expect(nota).toContain('día(s) para timbrarlo');
    expect(nota).toContain('no de la ley');
  });

  it('sin plazo verificado se conserva el matiz de siempre: la ventana puede ser menor', () => {
    const nota = avisos(ticketOfficeDepot({ rfcEmisor: 'CCO8605231N4', monto: 41.5 }), '2026-07-28')[0].nota;
    expect(nota).toContain('la ventana del comercio no está verificada y puede ser menor');
    expect(nota).not.toContain('no de la ley'); // esa frase solo aplica cuando SÍ hay un portal verificado que citar
  });

  // AUDITORÍA 10, MEDIO REINCIDENTE — el matiz legal se apagaba precisamente en
  // la rama minoritaria de comercios VERIFICADOS (33 de 37 caen sin verificar).
  // El dato de que el plazo real es el ejercicio completo no depende de si YA
  // se verificó el plazo del comercio: aplica igual en los dos casos.
  it('sin plazo verificado TAMBIÉN se dice que la ley da el ejercicio completo', () => {
    const nota = avisos(ticketOfficeDepot({ rfcEmisor: 'CCO8605231N4', monto: 41.5 }), '2026-07-28')[0].nota;
    expect(nota).toContain('legalmente puedes exigir la factura dentro del ejercicio');
  });

  it('la rama VENCIDA sigue diciendo lo que ya decía', () => {
    const nota = avisos(ticketOfficeDepot(), '2026-09-05')[0].nota;
    expect(nota).toContain('se pasó el plazo');
    expect(nota).toContain('dentro del ejercicio');
    expect(nota).toContain('Conciliación de Factura');
  });
});
