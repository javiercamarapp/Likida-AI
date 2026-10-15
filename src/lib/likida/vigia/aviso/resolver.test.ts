import { describe, it, expect, vi } from 'vitest';
import {
  resolverFila, type DepsResolver, type FilaParaResolver, type UnidadCatalogo, type CajaDelCatalogo,
  type OperadorDato, type DatoViajeManual,
} from './resolver';
import { normalizarAlias, type AliasCliente } from './equivalencias';
import type { Contacto } from '../tipos';

const T1 = '00000000-0000-4000-8000-000000000001';
const T2 = '00000000-0000-4000-8000-000000000002';
const C1 = '10000000-0000-4000-8000-000000000001';
const C2 = '10000000-0000-4000-8000-000000000002';
const FILA_ID = '30000000-0000-4000-8000-000000000001';

const alias = (tenantId: string, texto: string, clienteId: string, campo: 'cliente' | 'consignatario' = 'cliente'): AliasCliente =>
  ({ tenantId, textoNormalizado: normalizarAlias(texto), clienteId, campo });

const contacto = (o: Partial<Contacto> = {}): Contacto => ({
  id: 'ct-1', tenantId: T1, clienteId: C1, telefono: '5252899900001', nombre: 'Contacto Uno', gerenteUserId: null,
  estado: 'activo', consentimientoEn: '2026-09-01T00:00:00Z', optoutEn: null, avisoPrivacidadEn: null, ...o,
});

const unidad = (o: Partial<UnidadCatalogo> = {}): UnidadCatalogo => ({ tenantId: T1, id: 'u-1', numero: 'U-101', placas: 'AAA-111', ...o });

interface Datos {
  alias?: AliasCliente[]; contactos?: Contacto[]; unidades?: UnidadCatalogo[]; cajas?: CajaDelCatalogo[];
  operadores?: Record<string, OperadorDato>; manual?: DatoViajeManual[]; catalogoOperadores?: Record<string, OperadorDato>;
}

function deps(d: Datos = {}, extra: Partial<DepsResolver> = {}): DepsResolver {
  return {
    tenantId: T1,
    aliasDe: async () => d.alias ?? [],
    contactosDeCliente: async (id) => (d.contactos ?? []).filter((c) => c.clienteId === id),
    unidadesPorNumero: async (n) => (d.unidades ?? []).filter((u) => u.numero.toUpperCase() === n.toUpperCase()),
    cajaPorNumero: async (n) => (d.cajas ?? []).find((c) => c.numero.toUpperCase() === n.toUpperCase()) ?? null,
    operadorDeUnidad: async (id) => d.operadores?.[id] ?? null,
    datoManual: async (id) => (d.manual ?? []).find((m) => m.filaId === id) ?? null,
    operadorPorId: async (id) => d.catalogoOperadores?.[id] ?? null,
    ...extra,
  };
}

const fila = (o: Partial<FilaParaResolver> = {}): FilaParaResolver =>
  ({ cliente: 'Cliente Uno', consignatario: 'Planta Norte', caja: 'CJ-500', unidad: 'U-101', filaId: FILA_ID, ...o });

const opSistema: OperadorDato = { tenantId: T1, nombre: 'Operador Sintético', licencia: 'LIC-0001', licenciaVence: '2027-03-01', telefono: '5252899900009' };
const manual = (o: Partial<DatoViajeManual> = {}): DatoViajeManual => ({
  tenantId: T1, filaId: FILA_ID, operadorId: null, operadorNombre: null, licencia: null, licenciaVence: null, telefono: null,
  placasUnidad: null, placasCaja: null, estadoCaja: null, ...o,
});

describe('resolverFila — caso completo', () => {
  it('cliente, contacto, unidad, caja y operador salen de su fuente', async () => {
    const r = await resolverFila(fila(), deps({
      alias: [alias(T1, 'cliente uno', C1)],
      contactos: [contacto()],
      unidades: [unidad()],
      cajas: [{ tenantId: T1, numero: 'CJ-500', placas: 'BBB-222', estado: 'cargada' }],
      operadores: { 'u-1': opSistema },
    }));
    expect(r).toEqual({
      clienteId: C1, estadoCliente: 'resuelto',
      contacto: { id: 'ct-1', telefono: '5252899900001', nombre: 'Contacto Uno' },
      unidad: { id: 'u-1', numero: 'U-101', placas: 'AAA-111', fuentePlacas: 'sistema' },
      caja: { numero: 'CJ-500', placas: 'BBB-222', estado: 'cargada', fuentePlacas: 'catalogo', fuenteEstado: 'catalogo' },
      operador: { nombre: 'Operador Sintético', licencia: 'LIC-0001', vence: '2027-03-01', telefono: '5252899900009', fuente: 'sistema' },
      faltantes: [],
    });
  });
});

describe('resolverFila — cliente', () => {
  it('alias con acentos y espacios distintos resuelve', async () => {
    const r = await resolverFila(fila({ cliente: '  CLÍENTE   uno ' }), deps({ alias: [alias(T1, 'Cliente Uno', C1)] }));
    expect(r.clienteId).toBe(C1);
  });
  it('sin alias: no adivina, queda sin_cliente y no busca contacto', async () => {
    const contactosDeCliente = vi.fn(async () => [contacto()]);
    const r = await resolverFila(fila(), deps({}, { contactosDeCliente }));
    expect(r.clienteId).toBeNull();
    expect(r.estadoCliente).toBe('sin_cliente');
    expect(r.contacto).toBeNull();
    expect(r.faltantes).toContain('sin_cliente');
    expect(contactosDeCliente).not.toHaveBeenCalled();
  });
  it('texto de cliente vacío o nulo: sin_cliente y ni consulta alias', async () => {
    const aliasDe = vi.fn(async () => [alias(T1, '', C1)]);
    const r = await resolverFila(fila({ cliente: null }), deps({}, { aliasDe }));
    expect(r.estadoCliente).toBe('sin_cliente');
    expect(aliasDe).not.toHaveBeenCalled();
  });
  it('dos clientes con el mismo alias → ambiguo, sin clienteId ni contacto (no se envía)', async () => {
    const r = await resolverFila(fila(), deps({
      alias: [alias(T1, 'Cliente Uno', C1), alias(T1, 'CLIENTE UNO', C2)],
      contactos: [contacto(), contacto({ id: 'ct-2', clienteId: C2 })],
    }));
    expect(r.estadoCliente).toBe('ambiguo');
    expect(r.clienteId).toBeNull();
    expect(r.contacto).toBeNull();
    expect(r.faltantes).toContain('cliente_ambiguo');
  });
  it('por defecto resuelve por CLIENTE; configurable a CONSIGNATARIO (B3 sin responder)', async () => {
    const d = deps({ alias: [alias(T1, 'Cliente Uno', C1, 'cliente'), alias(T1, 'Planta Norte', C2, 'consignatario')] });
    expect((await resolverFila(fila(), d)).clienteId).toBe(C1);
    expect((await resolverFila(fila(), { ...d, campoCliente: 'consignatario' })).clienteId).toBe(C2);
  });
  it('aislamiento: un alias de otra flota nunca resuelve, aunque la consulta lo devuelva', async () => {
    const r = await resolverFila(fila(), deps({ alias: [alias(T2, 'Cliente Uno', C1)], contactos: [contacto()] }));
    expect(r.clienteId).toBeNull();
    expect(r.estadoCliente).toBe('sin_cliente');
  });
});

describe('resolverFila — contacto', () => {
  const base = { alias: [alias(T1, 'Cliente Uno', C1)] };
  it('ignora contactos dados de baja, suprimidos o con opt-out', async () => {
    const r = await resolverFila(fila(), deps({
      ...base,
      contactos: [contacto({ id: 'a', estado: 'baja' }), contacto({ id: 'b', estado: 'suprimido' }), contacto({ id: 'c', optoutEn: '2026-09-02T00:00:00Z' })],
    }));
    expect(r.contacto).toBeNull();
    expect(r.faltantes).toContain('sin_contacto');
  });
  it('prefiere el que tiene consentimiento; a igualdad, el de menor id (determinista)', async () => {
    const r = await resolverFila(fila(), deps({
      ...base,
      contactos: [contacto({ id: 'z', consentimientoEn: null }), contacto({ id: 'y' }), contacto({ id: 'x' })],
    }));
    expect(r.contacto?.id).toBe('x');
  });
  it('aislamiento: un contacto de otra flota o de otro cliente nunca sale', async () => {
    const r = await resolverFila(fila(), deps({
      ...base,
      contactos: [contacto({ id: 'otra-flota', tenantId: T2 })],
    }, { contactosDeCliente: async () => [contacto({ id: 'otra-flota', tenantId: T2 }), contacto({ id: 'otro-cliente', clienteId: C2 })] }));
    expect(r.contacto).toBeNull();
    expect(r.faltantes).toContain('sin_contacto');
  });
});

describe('resolverFila — unidad', () => {
  it('unidad inexistente → unidad_no_registrada (y sin operador del sistema)', async () => {
    const r = await resolverFila(fila({ unidad: 'U-999' }), deps({ unidades: [unidad()] }));
    expect(r.unidad).toBeNull();
    expect(r.faltantes).toContain('unidad_no_registrada');
    expect(r.faltantes).toContain('sin_operador');
  });
  it('fila sin unidad → sin_unidad', async () => {
    const r = await resolverFila(fila({ unidad: null }), deps({}));
    expect(r.faltantes).toContain('sin_unidad');
    expect(r.faltantes).not.toContain('unidad_no_registrada');
  });
  it('número exacto sin importar mayúsculas; «U-10» no encuentra «U-101»', async () => {
    const d = deps({ unidades: [unidad()] }, { unidadesPorNumero: async () => [unidad()] });
    expect((await resolverFila(fila({ unidad: 'u-101' }), d)).unidad?.id).toBe('u-1');
    expect((await resolverFila(fila({ unidad: 'U-10' }), d)).faltantes).toContain('unidad_no_registrada');
  });
  it('dos unidades con el mismo número → unidad_ambigua, no elige', async () => {
    const r = await resolverFila(fila(), deps({ unidades: [unidad(), unidad({ id: 'u-2' })] }));
    expect(r.unidad).toBeNull();
    expect(r.faltantes).toContain('unidad_ambigua');
  });
  it('aislamiento: una unidad de otra flota «no existe»', async () => {
    const r = await resolverFila(fila(), deps({ unidades: [unidad({ tenantId: T2 })] }, { unidadesPorNumero: async () => [unidad({ tenantId: T2 })] }));
    expect(r.unidad).toBeNull();
    expect(r.faltantes).toContain('unidad_no_registrada');
  });
  it('placas de la unidad: lo capturado a mano gana; si el catálogo no las tiene, las completa lo manual', async () => {
    const r1 = await resolverFila(fila(), deps({ unidades: [unidad({ placas: null })], manual: [manual({ placasUnidad: 'MMM-333' })] }));
    expect(r1.unidad).toMatchObject({ placas: 'MMM-333', fuentePlacas: 'manual' });
    const r2 = await resolverFila(fila(), deps({ unidades: [unidad({ placas: null })] }));
    expect(r2.unidad).toMatchObject({ placas: null, fuentePlacas: null });
  });
});

describe('resolverFila — caja', () => {
  it('sin caja en la fila → sin_caja', async () => {
    const r = await resolverFila(fila({ caja: '  ' }), deps({}));
    expect(r.caja).toBeNull();
    expect(r.faltantes).toContain('sin_caja');
  });
  it('caja fuera del catálogo: conserva el número de la fila con placas y estado en null (nada inventado)', async () => {
    const r = await resolverFila(fila(), deps({}));
    expect(r.caja).toEqual({ numero: 'CJ-500', placas: null, estado: null, fuentePlacas: null, fuenteEstado: null });
  });
  it('lo capturado a mano para la fila manda sobre el catálogo, campo por campo', async () => {
    const r = await resolverFila(fila(), deps({
      cajas: [{ tenantId: T1, numero: 'CJ-500', placas: 'BBB-222', estado: 'cargada' }],
      manual: [manual({ estadoCaja: 'en_patio' })],
    }));
    expect(r.caja).toEqual({ numero: 'CJ-500', placas: 'BBB-222', estado: 'en_patio', fuentePlacas: 'catalogo', fuenteEstado: 'manual' });
  });
  it('aislamiento: una caja del catálogo de otra flota no aporta placas ni estado', async () => {
    const r = await resolverFila(fila(), deps({}, { cajaPorNumero: async () => ({ tenantId: T2, numero: 'CJ-500', placas: 'ZZZ-999', estado: 'vacia' }) }));
    expect(r.caja).toMatchObject({ placas: null, estado: null });
  });
  it('no copia datos de otra caja aunque el catálogo regrese una distinta', async () => {
    const r = await resolverFila(fila(), deps({}, { cajaPorNumero: async () => ({ tenantId: T1, numero: 'CJ-777', placas: 'ZZZ-999', estado: 'vacia' }) }));
    expect(r.caja).toMatchObject({ placas: null, estado: null });
  });
});

describe('resolverFila — operador', () => {
  it('el del viaje abierto de la unidad gana sobre lo manual (fuente sistema)', async () => {
    const r = await resolverFila(fila(), deps({
      unidades: [unidad()], operadores: { 'u-1': opSistema }, manual: [manual({ operadorNombre: 'Otro Operador' })],
    }));
    expect(r.operador).toMatchObject({ nombre: 'Operador Sintético', fuente: 'sistema' });
  });
  it('sin viaje en el sistema: lo manual (fuente manual)', async () => {
    const r = await resolverFila(fila(), deps({
      unidades: [unidad()],
      manual: [manual({ operadorNombre: 'Operador Manual', licencia: 'LIC-7', licenciaVence: '2028-01-01', telefono: '5252899900003' })],
    }));
    expect(r.operador).toEqual({ nombre: 'Operador Manual', licencia: 'LIC-7', vence: '2028-01-01', telefono: '5252899900003', fuente: 'manual' });
  });
  it('captura manual con solo operadorId: se completa del catálogo (fuente catalogo)', async () => {
    const r = await resolverFila(fila(), deps({
      unidades: [unidad()], manual: [manual({ operadorId: 'op-1' })], catalogoOperadores: { 'op-1': opSistema },
    }));
    expect(r.operador).toMatchObject({ nombre: 'Operador Sintético', licencia: 'LIC-0001', fuente: 'catalogo' });
  });
  it('nada en ningún lado → null y sin_operador (no se inventa)', async () => {
    const r = await resolverFila(fila(), deps({ unidades: [unidad()] }));
    expect(r.operador).toBeNull();
    expect(r.faltantes).toContain('sin_operador');
  });
  it('aislamiento: operador de otra flota (sistema, manual o catálogo) nunca sale', async () => {
    const ajeno = { ...opSistema, tenantId: T2 };
    const r = await resolverFila(fila(), deps({
      unidades: [unidad()], operadores: { 'u-1': ajeno },
      manual: [manual({ operadorId: 'op-1' })], catalogoOperadores: { 'op-1': ajeno },
    }));
    expect(r.operador).toBeNull();
    const r2 = await resolverFila(fila(), deps({ unidades: [unidad()], manual: [manual({ tenantId: T2, operadorNombre: 'Ajeno' })] }));
    expect(r2.operador).toBeNull();
  });
  it('un dato manual de otra fila no se usa', async () => {
    const r = await resolverFila(fila(), deps({ unidades: [unidad()] }, { datoManual: async () => manual({ filaId: 'otra-fila', operadorNombre: 'Ajeno' }) }));
    expect(r.operador).toBeNull();
  });
  it('sin filaId no consulta lo manual', async () => {
    const datoManual = vi.fn(async () => manual());
    await resolverFila(fila({ filaId: null }), deps({}, { datoManual }));
    expect(datoManual).not.toHaveBeenCalled();
  });
});
