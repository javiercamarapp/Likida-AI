import { describe, it, expect } from 'vitest';
import { NORMAS } from './indice';
import { TEMAS, TEMAS_NORMATIVOS, normasPorTema } from './consulta';

// La sincronía en las DOS direcciones: el mapa de temas no puede citar una
// ficha que no existe, y una ficha del índice no puede quedar sin tema — si
// el chat no puede preguntarle al corpus por ella, la verificación fue en vano.
describe('el mapa de temas y el índice de normas no se separan', () => {
  it('cada id citado por un tema existe en NORMAS', () => {
    for (const tema of TEMAS_NORMATIVOS) {
      for (const id of TEMAS[tema]) {
        expect(NORMAS[id], `el tema "${tema}" cita "${id}" y no existe en el índice`).toBeDefined();
      }
    }
  });

  it('cada norma del índice vive en al menos un tema', () => {
    const cubiertas = new Set(TEMAS_NORMATIVOS.flatMap((t) => [...TEMAS[t]]));
    for (const id of Object.keys(NORMAS)) {
      expect(cubiertas.has(id), `la ficha "${id}" no está en ningún tema — el chat no puede llegar a ella`).toBe(true);
    }
  });

  it('ningún tema está vacío', () => {
    for (const tema of TEMAS_NORMATIVOS) {
      expect(TEMAS[tema].length, `el tema "${tema}" no tiene fichas`).toBeGreaterThan(0);
    }
  });
});

describe('normasPorTema', () => {
  it('ordena por jerarquía: la ley antes que el criterio y que la política', () => {
    const r = normasPorTema('cfdi_y_facturacion');
    for (let i = 1; i < r.length; i++) {
      expect(r[i].jerarquia).toBeGreaterThanOrEqual(r[i - 1].jerarquia);
    }
    // La política del portal (jerarquía 6) va al final y NO vinculante: es
    // exactamente la confusión que costó cara dos veces.
    const politica = r.find((n) => n.norma_id === 'politica-portales-plazos-facturacion');
    expect(politica).toBeDefined();
    expect(politica!.vinculante).toBe(false);
    expect(r[r.length - 1].jerarquia).toBe(politica!.jerarquia);
  });

  it('lo sin_verificar sale declarado como NO afirmable, no escondido', () => {
    for (const tema of TEMAS_NORMATIVOS) {
      for (const n of normasPorTema(tema)) {
        expect(n.afirmable).toBe(n.estado !== 'sin_verificar');
      }
    }
  });

  it('cada norma sale con su cita protegible (nunca vacía)', () => {
    for (const tema of TEMAS_NORMATIVOS) {
      for (const n of normasPorTema(tema)) {
        expect(n.cita.length).toBeGreaterThan(0);
      }
    }
  });

  // AUDITORÍA FABLE CICLO 3 (c3-6): `citas_en_codigo` de la ficha mezcla citas
  // de verdad con identificadores del repo ("plazoVerificado"); un token de
  // código servido como cita se leería como si fuera una norma.
  it('c3-6: ningún tema sirve un identificador de código como cita', () => {
    for (const tema of TEMAS_NORMATIVOS) {
      for (const n of normasPorTema(tema)) {
        expect(n.cita, `"${n.norma_id}" sirve "${n.cita}"`).not.toMatch(/^[a-z][a-zA-Z0-9]*$/);
      }
    }
  });

  it('c3-6: la ficha de portales cae a su instrumento legible', () => {
    const facturacion = normasPorTema('cfdi_y_facturacion');
    const portales = facturacion.find((n) => n.norma_id === 'politica-portales-plazos-facturacion');
    expect(portales).toBeDefined();
    expect(portales!.cita).toBe('Portales de autofacturación de comercios (varios)');
  });

  it('un tema desconocido LANZA — vacío se leería como "no hay norma"', () => {
    expect(() => normasPorTema('tema_inventado')).toThrow(/tema desconocido/);
  });
});
