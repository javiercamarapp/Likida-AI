import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { folioDelViaje, operadorPorNombre, planDeViaje } from './salida';
import { cv, extraccionAtlasOk } from './fixtures.test.util';

describe('planDeViaje (pura)', () => {
  const doc = { id: 'd1', sha256: 'ab'.repeat(32) };

  it('convierte lo aprobado al formato del viaje con las MISMAS reglas que la captura manual', () => {
    const r = planDeViaje(doc, extraccionAtlasOk());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan).toMatchObject({
      folio: 'ATL-20481', fechaInicio: '2026-10-15', operadorNombre: 'Juan Pérez López', placas: 'ABC1234',
      ccp: { origenCp: '44100', destinoCp: '64000', origenEstado: 'JAL', destinoEstado: 'NLE', transpInternac: null },
    });
    expect(r.plan.origen).toBe('Distribuidora Atlas SA de CV · CP 44100 · JAL');
    expect(r.plan.mercancias).toEqual([{ descripcion: 'Botellas de vidrio vacías', bienesTransp: '24131500', cantidad: 1200, claveUnidad: 'XBX', pesoKg: 8400, materialPeligroso: null }]);
  });

  it('sin folio del cliente el folio sale de la huella del documento (estable)', () => {
    const e = extraccionAtlasOk(); delete e.campos.folio_cliente;
    expect(folioDelViaje(doc, e)).toBe(`CP-${'AB'.repeat(5)}`);
    expect(folioDelViaje(doc, e)).toBe(folioDelViaje(doc, e));
  });

  it('el folio se acota a 40 caracteres', () => {
    const e = extraccionAtlasOk(); e.campos.folio_cliente = cv('X'.repeat(80));
    expect(folioDelViaje(doc, e)).toHaveLength(40);
  });

  it('material peligroso: sí/no/sin declarar (nunca se supone que no)', () => {
    const e = extraccionAtlasOk();
    e.mercancias[0].material_peligroso = cv('true');
    const p1 = planDeViaje(doc, e); expect(p1.ok && p1.plan.mercancias[0].materialPeligroso).toBe(true);
    e.mercancias[0].material_peligroso = cv('false');
    const p2 = planDeViaje(doc, e); expect(p2.ok && p2.plan.mercancias[0].materialPeligroso).toBe(false);
    delete e.mercancias[0].material_peligroso;
    const p3 = planDeViaje(doc, e); expect(p3.ok && p3.plan.mercancias[0].materialPeligroso).toBeNull();
  });

  it('transporte internacional solo si el documento lo dice', () => {
    const e = extraccionAtlasOk(); e.campos.transp_internac = cv('false');
    const p = planDeViaje(doc, e); expect(p.ok && p.plan.ccp.transpInternac).toBe(false);
  });

  it('una mercancía que no pasa la validación manual detiene la salida y dice cuál', () => {
    const e = extraccionAtlasOk(); e.mercancias[0].bienes_transp = cv('123'); e.mercancias.push({ ...e.mercancias[0], cantidad: cv('0'), bienes_transp: cv('24131500') });
    const r = planDeViaje(doc, e);
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.errores).toHaveLength(2); expect(r.errores[0]).toMatch(/Mercancía 1.*8 dígitos/); expect(r.errores[1]).toMatch(/Mercancía 2.*mayor que cero/); }
  });

  it('sin mercancías no hay viaje', () => {
    const e = extraccionAtlasOk(); e.mercancias = [];
    const r = planDeViaje(doc, e);
    expect(r).toMatchObject({ ok: false, errores: ['El documento no trae ninguna mercancía.'] });
  });

  it('los km se redondean a entero y se descartan los absurdos', () => {
    const e = extraccionAtlasOk();
    e.campos.distancia_km = cv('920.6'); let p = planDeViaje(doc, e); expect(p.ok && p.plan.kmRecorridos).toBe(921);
    e.campos.distancia_km = cv('999999'); p = planDeViaje(doc, e); expect(p.ok && p.plan.kmRecorridos).toBeNull();
  });

  it('solo se llena el origen/destino que hay (sin «null» en el texto)', () => {
    const e = extraccionAtlasOk(); delete e.campos.origen_nombre; delete e.campos.origen_estado;
    const p = planDeViaje(doc, e); expect(p.ok && p.plan.origen).toBe('CP 44100');
    delete e.campos.origen_cp;
    const q = planDeViaje(doc, e); expect(q.ok && q.plan.origen).toBeNull();
  });
});

describe('operadorPorNombre: coincidencia EXACTA y única, nunca «el más parecido»', () => {
  const ops = [
    { id: '1', nombre: 'María Hernández Soto', activo: true },
    { id: '2', nombre: 'Juan Pérez', activo: true },
    { id: '3', nombre: 'Juan Pérez', activo: true },
    { id: '4', nombre: 'Luis Baja', activo: false },
  ];
  it('ignora acentos y mayúsculas', () => expect(operadorPorNombre(ops, 'maria hernandez soto')?.id).toBe('1'));
  it('dos con el mismo nombre = ninguno (ambiguo)', () => expect(operadorPorNombre(ops, 'Juan Pérez')).toBeNull());
  it('un dado de baja no cuenta', () => expect(operadorPorNombre(ops, 'Luis Baja')).toBeNull());
  it('un nombre parecido no basta', () => { expect(operadorPorNombre(ops, 'María Hernández')).toBeNull(); expect(operadorPorNombre(ops, null)).toBeNull(); });
});

describe('este módulo NO timbra', () => {
  it('ningún archivo de carta_porte_docs importa el camino del timbre, del PAC o del CFDI', () => {
    const dir = join(process.cwd(), 'src/lib/likida/carta_porte_docs');
    const prohibidos = /from ['"][^'"]*(carta_porte_timbre|carta_porte_cfdi|\/pac\/|pac\/index|carta_porte_xml)['"]/;
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.ts') && !x.endsWith('.test.ts') && !x.endsWith('.util.ts'))) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- ruta de readdirSync sobre un directorio fijo del repo
      const src = readFileSync(join(dir, f), 'utf8').split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
      expect(prohibidos.test(src), `${f} importa algo del timbre`).toBe(false);
      expect(/resolverPac|LIKIDA_PAC_|\.timbrar\(|timbrarCcp|timbrarCfdi/.test(src), `${f} llama al timbre`).toBe(false);
    }
  });
});
