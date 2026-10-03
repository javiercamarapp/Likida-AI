import { describe, it, expect } from 'vitest';
import { horaMx, horaYDiaMx, mensajeParaChofer, resumenParaPlantilla, textoAvisoOficina } from './mensajes';
import type { Decision } from './maquina';

const AHORA = new Date('2026-10-02T20:00:00.000Z'); // 14:00 México
const ctx = { viajeId: '4f1f6e2e-95c1-4c52-9f9e-3f6f6bd8d001', folio: 'F-1', origen: 'Planta Zapopan', destino: 'CEDIS Monterrey' };

const registrar = (extra: Partial<Extract<Decision, { accion: 'registrar' }>> = {}): Decision => ({
  accion: 'registrar', objetivo: 'llegada_carga', omitir: [], reabre: false, contacto: null, ambigua: false, legado: [],
  mensajeEn: new Date('2026-10-02T20:32:00.000Z'), ajustadaPorFuturo: false, ...extra,
});

describe('la hora de México', () => {
  it('horaMx y horaYDiaMx', () => {
    expect(horaMx(new Date('2026-10-02T20:32:00Z'))).toBe('14:32');
    expect(horaYDiaMx(new Date('2026-10-02T20:32:00Z'), AHORA)).toBe('14:32');
    expect(horaYDiaMx(new Date('2026-10-01T20:32:00Z'), AHORA)).toBe('14:32 del 01/10');
    // Cerca de medianoche UTC sigue siendo el mismo día de México.
    expect(horaYDiaMx(new Date('2026-10-03T03:30:00Z'), new Date('2026-10-03T04:00:00Z'))).toBe('21:30');
  });
});

describe('el acuse al chofer', () => {
  it('cada hito dice qué se anotó, con la hora del MENSAJE, y qué sigue', () => {
    expect(mensajeParaChofer(registrar(), ctx, AHORA).texto).toMatch(/^Anotado ✅ llegaste a CARGAR \(Planta Zapopan\) a las 14:32\./);
    const salida = mensajeParaChofer(registrar({ objetivo: 'salida_carga' }), ctx, AHORA).texto;
    expect(salida).toContain('saliste de la carga a las 14:32');
    expect(salida).toContain('CEDIS Monterrey');
    expect(mensajeParaChofer(registrar({ objetivo: 'llegada_descarga' }), ctx, AHORA).texto).toContain('llegaste a DESCARGAR (CEDIS Monterrey)');
    expect(mensajeParaChofer(registrar({ objetivo: 'salida_descarga' }), ctx, AHORA).texto).toContain('comprobante de entrega');
    expect(mensajeParaChofer(registrar({ objetivo: 'regreso' }), ctx, AHORA).texto).toContain('vas de regreso desde las 14:32');
  });

  it('con contacto no vuelve a preguntarlo', () => {
    const t = mensajeParaChofer(registrar({ contacto: { nombre: 'Juan', area: 'recibo' } }), ctx, AHORA).texto;
    expect(t).toContain('Te atiende Juan (recibo)');
    expect(t).not.toContain('¿Quién te atiende');
  });

  it('sin lugar capturado no inventa uno', () => {
    expect(mensajeParaChofer(registrar(), { ...ctx, origen: null }, AHORA).texto).toContain('llegaste a CARGAR a las 14:32');
  });

  it('la llegada ambigua ofrece el botón «Es en descarga»', () => {
    const s = mensajeParaChofer(registrar({ ambigua: true }), ctx, AHORA);
    expect(s.botones).toEqual([{ id: `hito_corrige_llegada:${ctx.viajeId}`, titulo: 'Es en descarga' }]);
    expect(mensajeParaChofer(registrar({ ambigua: false }), ctx, AHORA).botones).toBeUndefined();
  });

  it('un hito omitido por inferencia se dice', () => {
    expect(mensajeParaChofer(registrar({ objetivo: 'salida_carga', omitir: ['llegada_carga'] }), ctx, AHORA).texto)
      .toContain('No tenía anotado tu llegada a cargar; lo dejé sin hora.');
  });

  it('carrera y fallo no fingen una anotación', () => {
    expect(mensajeParaChofer(registrar(), ctx, AHORA, 'carrera').texto).toBe('Ya lo tenía anotado. 👍');
    expect(mensajeParaChofer(registrar(), ctx, AHORA, 'fallo').texto).toContain('No pude anotarlo');
  });

  it('el rechazo de cada motivo habla en cristiano', () => {
    for (const motivo of ['nada_que_corregir', 'validado', 'fuera_de_ventana', 'sin_llegada', 'sin_hito_pendiente'] as const) {
      expect(mensajeParaChofer({ accion: 'rechazar', motivo }, ctx, AHORA).texto.length).toBeGreaterThan(10);
    }
  });

  it('aclarar trae los dos botones con payload del viaje', () => {
    const s = mensajeParaChofer({ accion: 'aclarar', pregunta: 'llegada' }, ctx, AHORA);
    expect(s.botones?.map((b) => b.id)).toEqual([`hito_llegada_descarga:${ctx.viajeId}`, `hito_sigue_cargando:${ctx.viajeId}`]);
    for (const b of s.botones ?? []) expect(b.titulo.length).toBeLessThanOrEqual(20);
  });

  it('todos los títulos de botón caben en los 20 caracteres de WhatsApp', () => {
    const todos = [
      mensajeParaChofer(registrar({ ambigua: true }), ctx, AHORA),
      mensajeParaChofer({ accion: 'aclarar', pregunta: 'llegada' }, ctx, AHORA),
    ].flatMap((s) => s.botones ?? []);
    for (const b of todos) expect(b.titulo.length).toBeLessThanOrEqual(20);
  });
});

describe('el aviso a la oficina con la hora EXACTA', () => {
  const datos = {
    chofer: 'Juan Pérez', folio: 'F-1042', tipo: 'llegada_carga' as const, mensajeEn: new Date('2026-10-02T20:32:00Z'), ahora: AHORA,
    lugar: 'Planta Zapopan', contacto: { nombre: 'Pedro', area: 'embarques' },
  };

  it('dice quién, qué, dónde, la hora del mensaje y el contacto', () => {
    expect(textoAvisoOficina(datos)).toBe('Juan Pérez (viaje F-1042) llegó a cargar en Planta Zapopan a las 14:32 (hora de su mensaje). Lo atiende Pedro (embarques).');
  });

  it('sin datos opcionales no inventa nada', () => {
    const t = textoAvisoOficina({ ...datos, chofer: null, folio: null, lugar: null, contacto: null });
    expect(t).toBe('Un chofer llegó a cargar a las 14:32 (hora de su mensaje).');
  });

  it('el resumen de la plantilla cabe en 60 caracteres y no lleva saltos', () => {
    const r = resumenParaPlantilla({ ...datos, folio: 'F-'.padEnd(80, 'X') });
    expect(r.length).toBeLessThanOrEqual(60);
    expect(r).not.toMatch(/\n/);
    expect(resumenParaPlantilla(datos)).toBe('llegó a cargar F-1042 a las 14:32');
  });

  it('cada hito tiene su verbo', () => {
    for (const tipo of ['llegada_carga', 'salida_carga', 'llegada_descarga', 'salida_descarga', 'regreso'] as const) {
      expect(textoAvisoOficina({ ...datos, tipo }).length).toBeGreaterThan(20);
    }
  });
});
