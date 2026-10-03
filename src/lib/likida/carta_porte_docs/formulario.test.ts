import { describe, expect, it } from 'vitest';
import { cambiosDeFormulario } from './formulario';
import { aplicarCambiosAExtraccion } from './bandeja';
import { extraccionAtlasOk } from './documentos_sinteticos.fixture';

const forma = (campos: Record<string, string>): FormData => { const f = new FormData(); for (const [k, v] of Object.entries(campos)) f.set(k, v); return f; };

describe('cambiosDeFormulario', () => {
  it('lee campos del documento y de mercancías, y las casillas de confirmación', () => {
    const r = cambiosDeFormulario(forma({ 'c:origen_cp': '44200', 'm:0:peso_kg': '9000', 'k:c:origen_cp': 'on', 'k:m:0:peso_kg': 'on', 'm:1:descripcion': 'Tapas' }), extraccionAtlasOk());
    expect(r.cambios).toEqual([
      { campo: 'origen_cp', renglon: null, valor: '44200', confirmar: true },
      { campo: 'peso_kg', renglon: 0, valor: '9000', confirmar: true },
      { campo: 'descripcion', renglon: 1, valor: 'Tapas', confirmar: false },
    ]);
    expect(r.ignorados).toEqual([]);
  });

  it('ignora claves inventadas, renglones lejanos, archivos y nombres que no son de la forma', () => {
    const f = forma({ 'c:__proto__': 'x', 'c:inventado': 'x', 'm:9:descripcion': 'x', 'm:0:inventado': 'x', 'version': '3', 'x:y': 'z', 'c:origen_cp': '1' });
    f.set('c:origen_rfc', new File(['x'], 'x.txt'));
    const r = cambiosDeFormulario(f, extraccionAtlasOk());
    expect(r.cambios.map((c) => c.campo)).toEqual(['origen_cp']);
    expect(r.ignorados.sort()).toEqual(['c:__proto__', 'c:inventado', 'c:origen_rfc', 'm:0:inventado', 'm:9:descripcion'].sort());
  });

  it('un valor kilométrico se recorta antes de llegar al servicio', () => {
    const r = cambiosDeFormulario(forma({ 'c:origen_nombre': 'x'.repeat(10_000) }), extraccionAtlasOk());
    expect(r.cambios[0].valor!.length).toBe(600);
  });

  it('una casilla huérfana (sin su campo) no crea nada; «off» tampoco confirma', () => {
    const r = cambiosDeFormulario(forma({ 'k:c:origen_cp': 'on', 'c:destino_cp': '64000', 'k:c:destino_cp': 'off' }), extraccionAtlasOk());
    expect(r.cambios).toEqual([{ campo: 'destino_cp', renglon: null, valor: '64000', confirmar: false }]);
  });

  it('de punta a punta con el servicio: la forma entera sin tocar no cambia ni confirma nada', () => {
    const e = extraccionAtlasOk();
    const campos: Record<string, string> = {};
    for (const [k, c] of Object.entries(e.campos)) campos[`c:${k}`] = c.valor ?? '';
    for (const [k, c] of Object.entries(e.mercancias[0])) campos[`m:0:${k}`] = c.valor ?? '';
    campos['m:1:descripcion'] = ''; // la fila vacía de «agregar mercancía»
    const r = aplicarCambiosAExtraccion(e, cambiosDeFormulario(forma(campos), e).cambios);
    expect(r.correcciones).toEqual([]);
    expect(r.confirmados).toBe(0);
    expect(r.extraccion.mercancias).toHaveLength(1);
  });

  it('un renglón NUEVO desde la forma se agrega con el primer campo escrito', () => {
    const e = extraccionAtlasOk();
    const r = aplicarCambiosAExtraccion(e, cambiosDeFormulario(forma({ 'm:1:descripcion': 'Tapas', 'm:1:cantidad': '10', 'm:1:peso_kg': '100' }), e).cambios);
    expect(r.extraccion.mercancias).toHaveLength(2);
    expect(r.extraccion.mercancias[1].descripcion.valor).toBe('Tapas');
  });
});
