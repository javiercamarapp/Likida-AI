import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import type { CampoValor, Extraccion } from './campos';
import { aXlsxPlantillaTms } from './exportacion';
import { leerPlantillaTms } from './lector_plantilla_tms';
import { construirPlantilla, type ContextoPlantilla } from './plantilla_tms';
import { aplicarPropuestaReferencia, validarExtraccion } from './validacion';
import { plantillaNormalRealEnBlanco } from './evaluacion/plantilla_normal_real.fixture';

const cv = (valor: string | null): CampoValor => ({ valor, confianza: 0.95, evidencia: null, origen: 'llm' });
const conv = (o: Record<string, string | null>): Record<string, CampoValor> => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, cv(v)]));

const BASE: Record<string, string | null> = {
  folio_cliente: 'REF-SINT-001', distancia_km: '874', numero_cliente_interno: '000123', caja_numero: 'CAJA-SINT-01', regimen_aduanero: 'EXD',
  origen_nombre: 'Embarcador Sintetico SA', origen_rfc: 'AAA010101AAA', origen_calle: 'Calle Uno', origen_cp: '44100', origen_estado: 'JAL', origen_pais: 'MEX', // grep-limpio:ok
  destino_nombre: 'Destino Sintetico LLC', destino_rfc: '58-7654321', destino_calle: 'Street Two', destino_cp: '78040', destino_estado: 'NLE', destino_pais: 'USA', // grep-limpio:ok
};
const DESTINO2: Record<string, string | null> = {
  destino_2_nombre: 'Destino Sintetico LLC', destino_2_rfc: '58-7654321', destino_2_calle: 'Street Two', destino_2_cp: '78040', destino_2_estado: 'NLE', destino_2_pais: 'USA', // grep-limpio:ok
};
const merc = (i: number, sobre: Record<string, string | null> = {}) => conv({
  bienes_transp: '43211500', descripcion: `Mercancia sintetica ${i + 1}`, cantidad: '10', clave_unidad: 'H87', peso_kg: '100', fraccion_arancelaria: '8471500100', // grep-limpio:ok
  tipo_materia: '05', regimen_aduanero: 'EXD', material_peligroso: 'false', ...sobre,
});
const codigos = (e: Extraccion) => validarExtraccion(e).hallazgos.filter((h) => h.codigo.endsWith('_huerfano'));

/** Libro «normal» como lo manda el cliente: 14 renglones y UN destino, con «Id Destino» numerado 1..14 (renglón, no destino). */
function libroConIdsDeRenglon(n: number): Uint8Array {
  const ext: Extraccion = { campos: conv(BASE), mercancias: Array.from({ length: n }, (_, i) => merc(i)) };
  const ctx: ContextoPlantilla = { clienteInterno: null, plantilla: 'normal', reglasGuia: false };
  const bytes = aXlsxPlantillaTms(construirPlantilla(ext, ctx), plantillaNormalRealEnBlanco());
  const libro = XLSX.read(bytes, { type: 'array' });
  const ws = libro.Sheets.Mercancias;
  for (let i = 0; i < n; i++) ws[`A${22 + i}`] = { t: 'n', v: i + 1 };
  return new Uint8Array(XLSX.write(libro, { type: 'array', bookType: 'xlsx' }));
}

describe('referencias huérfanas por mercancía (T-A3-55)', () => {
  it('14 renglones con ids 1..14 y un destino: el lector los conserva y la validación avisa con propuesta', () => {
    const lectura = leerPlantillaTms(libroConIdsDeRenglon(14))!;
    expect(lectura.extraccion.mercancias.map((m) => m.id_destino?.valor)).toEqual(Array.from({ length: 14 }, (_, i) => String(i + 1)));
    const h = codigos(lectura.extraccion);
    expect(h).toHaveLength(13); // el renglón 1 sí existe
    expect(h.every((x) => x.codigo === 'id_destino_huerfano' && x.severidad === 'confirmar')).toBe(true);
    expect(h[0].propuesta).toEqual({ campo: 'id_destino', renglon: 1, valor: '1' });
    expect(h[0].mensaje).toContain('número de renglón');
    expect(validarExtraccion(lectura.extraccion).listoParaAprobar).toBe(false);
  });

  it('la corrección nunca se aplica sola: validar no cambia la extracción; aplicarla la deja en origen humano y limpia el hallazgo', () => {
    const lectura = leerPlantillaTms(libroConIdsDeRenglon(3))!;
    const antes = JSON.stringify(lectura.extraccion);
    const h = codigos(lectura.extraccion);
    expect(JSON.stringify(lectura.extraccion)).toBe(antes);
    expect(lectura.extraccion.mercancias[1].id_destino.valor).toBe('2');
    let e = lectura.extraccion;
    for (const x of h) e = aplicarPropuestaReferencia(e, x);
    expect(e.mercancias.map((m) => [m.id_destino.valor, m.id_destino.origen])).toEqual([['1', 'perfil'], ['1', 'humano'], ['1', 'humano']]);
    expect(codigos(e)).toHaveLength(0);
  });

  it('con varios destinos no adivina: sin propuesta, y un id válido no avisa', () => {
    const e: Extraccion = {
      campos: conv({ ...BASE, ...DESTINO2 }),
      mercancias: [merc(0, { id_destino: '2' }), merc(1, { id_destino: '5' })],
    };
    const h = codigos(e);
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ codigo: 'id_destino_huerfano', renglon: 1 });
    expect(h[0].propuesta).toBeUndefined();
    expect(aplicarPropuestaReferencia(e, h[0])).toBe(e);
  });

  it('el origen se valida igual (id_origen_huerfano)', () => {
    const e: Extraccion = { campos: conv(BASE), mercancias: [merc(0, { id_origen: '1' }), merc(1, { id_origen: '3' })] };
    expect(codigos(e).map((x) => [x.codigo, x.renglon])).toEqual([['id_origen_huerfano', 1]]);
  });

  it('la exportación nunca emite una referencia inexistente: con varios destinos un id fuera de rango bloquea y la celda queda vacía', () => {
    const e: Extraccion = { campos: conv({ ...BASE, ...DESTINO2 }), mercancias: [merc(0, { id_destino: '1' }), merc(1, { id_destino: '9' })] };
    const r = construirPlantilla(e, { clienteInterno: null, plantilla: 'normal', reglasGuia: false });
    expect(r.hojas.Mercancias.A23.valor).toBeNull();
    expect(r.faltantes.some((f) => f.campo === 'mercancia.id_destino' && f.bloqueante === true)).toBe(true);
  });

  it('destinos repetidos con la misma dirección conservan sus referencias en la ida y vuelta (2 destinos idénticos)', () => {
    const e: Extraccion = { campos: conv({ ...BASE, ...DESTINO2 }), mercancias: [merc(0, { id_destino: '1' }), merc(1, { id_destino: '2' })] };
    const ctx: ContextoPlantilla = { clienteInterno: null, plantilla: 'normal', reglasGuia: false };
    const original = construirPlantilla(e, ctx);
    const lectura = leerPlantillaTms(aXlsxPlantillaTms(original, plantillaNormalRealEnBlanco()))!;
    expect(lectura.extraccion.mercancias.map((m) => m.id_destino.valor)).toEqual(['1', '2']);
    expect(construirPlantilla(lectura.extraccion, ctx).hojas).toEqual(original.hojas);
    expect(codigos(lectura.extraccion)).toHaveLength(0);
  });
});
