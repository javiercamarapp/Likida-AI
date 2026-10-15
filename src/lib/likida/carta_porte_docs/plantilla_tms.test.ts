import { describe, expect, it } from 'vitest';
import type { CampoValor, Extraccion } from './campos';
import { construirPlantilla, contarDestinos } from './plantilla_tms';
import { AVISO_PLANTILLA_POR_CONFIG, contextoPlantillaDeConfig, elegirPlantilla } from './salida_config';
import { LAYOUT_NORMAL, LAYOUT_NUEVA, coordenadasLayout, layoutPuedeEnviarse } from './plantilla_tms.layout';

const cv = (valor: string | null): CampoValor => ({ valor, confianza: 0.95, evidencia: null, origen: 'llm' });

/** Extracción sintética con la FORMA de M2 (nada real). */
function extraccion(sobre: Record<string, string | null> = {}, merc: Record<string, string | null> = {}): Extraccion {
  const campos: Record<string, string | null> = {
    folio_cliente: 'LP-0001', distancia_km: '874,11 km',
    origen_nombre: 'Origen Sintetico SA', origen_rfc: 'AAA010101AAA', origen_calle: 'Calle Uno', origen_num_ext: '10', origen_num_int: null, // grep-limpio:ok
    origen_colonia_clave: '0001', origen_colonia: 'Colonia Uno', origen_cp: '44100', origen_localidad_clave: '01', origen_localidad: 'Localidad Uno',
    origen_municipio_clave: '039', origen_municipio: 'Municipio Uno', origen_estado: 'JAL', origen_pais: 'MEX',
    destino_nombre: 'Destino Sintetico LLC', destino_rfc: 'XEXX010101000', destino_calle: 'Street Two', destino_num_ext: '20', destino_num_int: null, // grep-limpio:ok
    destino_colonia_clave: null, destino_colonia: 'Zona Dos', destino_cp: '78040', destino_localidad_clave: null, destino_localidad: 'Ciudad Dos',
    destino_municipio_clave: null, destino_municipio: 'Condado Dos', destino_estado: 'NLE', destino_pais: 'USA',
    contacto_destino_nombre: 'Contacto Prueba', contacto_destino_telefono: '5550000000', contacto_destino_correo: 'contacto@example.test', // grep-limpio:ok
    numero_cliente_interno: '000123',
    ...sobre,
  };
  const m: Record<string, string | null> = {
    bienes_transp: '43211500', descripcion: 'Equipo de computo', cantidad: '20', clave_unidad: 'H87', unidad_descripcion: 'Pieza',
    embalaje: '4G', embalaje_descripcion: 'Caja de carton', peso_kg: '14130', fraccion_arancelaria: '8471500100', tipo_materia: '05', // grep-limpio:ok
    regimen_aduanero: 'EXD', rfc_agente_aduanal: 'BBB020202BBB', pedimento: '24 16 3456 4000123', material_peligroso: null, clave_material_peligroso: null, // grep-limpio:ok
    ...merc,
  };
  const conv = (o: Record<string, string | null>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, cv(v)]));
  return { campos: conv(campos), mercancias: [conv(m)] };
}

const ctx = { clienteInterno: null, plantilla: 'normal' as const };
const hoja = (r: ReturnType<typeof construirPlantilla>, n: string) => r.hojas[n];

describe('construirPlantilla', () => {
  it('extracción completa: cada valor cae en su coordenada', () => {
    const r = construirPlantilla(extraccion(), ctx);
    const rd = hoja(r, 'RemintenteDestinatario');
    const esperado: Record<string, string> = {
      C7: '000123', C8: 'LP-0001', C11: 'Origen Sintetico SA', C12: 'AAA010101AAA', C14: 'Calle Uno', C15: '10', C17: '0001', C18: 'Colonia Uno', // grep-limpio:ok
      C19: '44100', C20: '01', C21: 'Localidad Uno', C22: '039', C23: 'Municipio Uno', C24: 'JAL', C25: 'Jalisco', C26: 'MEX',
      C29: 'Destino Sintetico LLC', C30: 'XEXX010101000', C32: 'Street Two', C36: 'Zona Dos', C37: '78040', C44: 'USA', // grep-limpio:ok
      C45: 'Contacto Prueba', C47: 'contacto@example.test',
    };
    for (const [k, v] of Object.entries(esperado)) expect(rd[k]?.valor, k).toBe(v);
    expect(rd.C16.valor).toBeNull();
    expect(rd.C43.valor).toBe('Nuevo León');
    // tabla de destinos
    expect(rd.A50.valor).toBe(1);
    expect(rd.B50.valor).toBe('874,11 km'); // por defecto la distancia sale como la trae la plantilla
    expect(rd.C50.valor).toBe('Destino Sintetico LLC');
    expect(rd.J50.valor).toBe('78040');
    expect(rd.P50.valor).toBe('Nuevo León');
    expect(rd.T50.valor).toBe('contacto@example.test');
    expect(rd.A51).toBeUndefined();
    expect(rd.A49.valor).toBe('IdDestino');
    expect(rd.T49.valor).toBe('Correo');
    const me = hoja(r, 'Mercancias');
    expect(me.A21.valor).toBe('Id Destino');
    expect(me.A22.valor).toBe(1);
    expect(me.B22.valor).toBe('43211500');
    expect(me.D22.valor).toBe(20);
    expect(me.I22.valor).toBe(14130);
    expect(me.N22.valor).toBe('24 16 3456 4000123');
    expect(r.faltantes).toEqual([]);
    expect(hoja(r, 'Error')).toEqual({});
  });

  it('falta el RFC del embarcador: faltantes lo lista en C12', () => {
    const r = construirPlantilla(extraccion({ origen_rfc: null }), ctx);
    expect(r.faltantes).toContainEqual({ campo: 'origen_rfc', celda: 'C12' });
    expect(hoja(r, 'RemintenteDestinatario').C12.valor).toBeNull();
  });

  it('peligroso vacío → NO y clave N/A; peligroso sí sin clave → faltante', () => {
    const r = construirPlantilla(extraccion(), ctx);
    expect(hoja(r, 'Mercancias').O22.valor).toBe('NO');
    expect(hoja(r, 'Mercancias').P22.valor).toBe('N/A');
    const p = construirPlantilla(extraccion({}, { material_peligroso: 'true' }), ctx);
    expect(hoja(p, 'Mercancias').O22.valor).toBe('SI');
    expect(p.faltantes).toContainEqual({ campo: 'mercancia.clave_material_peligroso', celda: 'P22' });
    const q = construirPlantilla(extraccion({}, { material_peligroso: 'true', clave_material_peligroso: '1203' }), ctx);
    expect(hoja(q, 'Mercancias').P22.valor).toBe('1203');
  });

  it('marca como texto lo que viene de un tercero y no altera el valor (neutralizar es de T-A3-08)', () => {
    const r = construirPlantilla(extraccion({ origen_nombre: '=HYPERLINK("x")' }), ctx);
    const c = hoja(r, 'RemintenteDestinatario').C11;
    expect(c.valor).toBe('=HYPERLINK("x")');
    expect(c.texto).toBe(true);
    expect(hoja(r, 'Mercancias').I22.texto).toBe(false);
    expect(hoja(r, 'RemintenteDestinatario').B50.texto).toBe(true);
  });

  it('varias mercancías ocupan filas consecutivas desde la 22', () => {
    const e = extraccion();
    e.mercancias.push({ ...e.mercancias[0], descripcion: cv('Segunda') });
    const r = construirPlantilla(e, ctx);
    expect(hoja(r, 'Mercancias').C23.valor).toBe('Segunda');
    expect(hoja(r, 'Mercancias').A23.valor).toBe(1);
  });

  it('sin mercancías: fila 22 vacía con faltantes y aviso; plantilla nueva avisa; el contexto manda sobre la extracción', () => {
    const e = extraccion();
    e.mercancias = [];
    const r = construirPlantilla(e, { clienteInterno: '777', plantilla: 'nueva' });
    expect(r.faltantes).toContainEqual({ campo: 'mercancia.peso_kg', celda: 'I22' });
    expect(r.avisos.some((a) => a.includes('no trae mercancías'))).toBe(true);
    expect(r.avisos.some((a) => a.includes('«nueva»'))).toBe(true);
    expect(r.avisos.some((a) => a.includes('provisional'))).toBe(true);
    expect(hoja(r, 'RemintenteDestinatario').C7.valor).toBe('777');
  });
});

describe('LAYOUT_NORMAL', () => {
  it('es serializable a JSON sin pérdida (cp_salida_config.layout)', () => {
    expect(JSON.parse(JSON.stringify(LAYOUT_NORMAL))).toEqual(LAYOUT_NORMAL);
  });

  it('no lleva datos: ningún valor de ejemplo, solo estructura', () => {
    const planos = JSON.stringify(LAYOUT_NORMAL);
    expect(planos).not.toMatch(/[A-Z]{3,4}\d{6}[A-Z0-9]{3}/);
  });

  it('el conjunto de coordenadas coincide con la lista congelada de la estructura de M2', () => {
    const col = (a: string, b: string) => Array.from({ length: b.charCodeAt(0) - a.charCodeAt(0) + 1 }, (_, i) => String.fromCharCode(a.charCodeAt(0) + i));
    const rd = 'RemintenteDestinatario';
    const filasC = [7, 8, 11, 12, ...Array.from({ length: 13 }, (_, i) => 14 + i), 29, 30, ...Array.from({ length: 16 }, (_, i) => 32 + i)];
    const congelada = [
      ...filasC.map((n) => `${rd}!C${n}`),
      ...col('A', 'T').flatMap((c) => [`${rd}!${c}49`, `${rd}!${c}50`]),
      ...col('A', 'P').flatMap((c) => [`Mercancias!${c}21`, `Mercancias!${c}22`]),
    ];
    expect([...coordenadasLayout(LAYOUT_NORMAL)].sort()).toEqual([...congelada].sort());
    expect(new Set(coordenadasLayout(LAYOUT_NORMAL)).size).toBe(coordenadasLayout(LAYOUT_NORMAL).length);
  });
});

/** Agrega el destino N (≥ 2) con datos sintéticos a la extracción. */
function conDestino(e: Extraccion, n: number): void {
  const d: Record<string, string> = {
    nombre: `Destino ${n} Sintetico`, rfc: 'XEXX010101000', calle: `Street ${n}`, cp: `7804${n}`, estado: 'NLE', pais: 'USA', distancia_km: `${100 * n},50 km`, // grep-limpio:ok
  };
  for (const [k, v] of Object.entries(d)) e.campos[`destino_${n}_${k}`] = cv(v);
}

describe('distancia_formato', () => {
  it('texto_km (por defecto) deja «874,11 km» como texto; numero la vuelve número', () => {
    const t = construirPlantilla(extraccion(), { ...ctx, distanciaFormato: 'texto_km' });
    expect(hoja(t, 'RemintenteDestinatario').B50).toEqual({ valor: '874,11 km', texto: true });
    const n = construirPlantilla(extraccion(), { ...ctx, distanciaFormato: 'numero' });
    expect(hoja(n, 'RemintenteDestinatario').B50).toEqual({ valor: 874.11, texto: false });
  });

  it('una distancia dada solo como número sale con el formato pedido; ilegible se deja tal cual', () => {
    expect(hoja(construirPlantilla(extraccion({ distancia_km: '874.1' }), ctx), 'RemintenteDestinatario').B50.valor).toBe('874,10 km');
    expect(hoja(construirPlantilla(extraccion({ distancia_km: 'no se sabe' }), ctx), 'RemintenteDestinatario').B50.valor).toBe('no se sabe');
    expect(hoja(construirPlantilla(extraccion({ distancia_km: null }), ctx), 'RemintenteDestinatario').B50.valor).toBeNull();
  });
});

describe('multi-destino', () => {
  it('un destino: sin cambios, Id Destino 1 en la mercancía y sin fila 51', () => {
    const e = extraccion();
    expect(contarDestinos(e)).toBe(1);
    const r = construirPlantilla(e, ctx);
    expect(hoja(r, 'Mercancias').A22.valor).toBe(1);
    expect(hoja(r, 'RemintenteDestinatario').A51).toBeUndefined();
  });

  it('2 destinos: filas 50–51, mercancías con Id Destino 1 y 2', () => {
    const e = extraccion();
    conDestino(e, 2);
    e.mercancias.push({ ...e.mercancias[0], id_destino: cv('2'), descripcion: cv('Segunda') });
    e.mercancias[0].id_destino = cv('1');
    const r = construirPlantilla(e, ctx);
    const rd = hoja(r, 'RemintenteDestinatario');
    expect([rd.A50.valor, rd.A51.valor]).toEqual([1, 2]);
    expect(rd.C50.valor).toBe('Destino Sintetico LLC');
    expect(rd.C51.valor).toBe('Destino 2 Sintetico');
    expect(rd.J51.valor).toBe('78042');
    expect(rd.B51.valor).toBe('200,50 km');
    expect(rd.P51.valor).toBe('Nuevo León');
    expect(rd.A52).toBeUndefined();
    const me = hoja(r, 'Mercancias');
    expect([me.A22.valor, me.A23.valor]).toEqual([1, 2]);
    expect(r.faltantes.filter((f) => f.bloqueante)).toEqual([]);
  });

  it('con varios destinos, la mercancía sin Id Destino es faltante (no se adivina) y uno inexistente bloquea', () => {
    const e = extraccion();
    conDestino(e, 2);
    const r = construirPlantilla(e, ctx);
    expect(r.faltantes).toContainEqual({ campo: 'mercancia.id_destino', celda: 'A22' });
    expect(hoja(r, 'Mercancias').A22.valor).toBeNull();
    e.mercancias[0].id_destino = cv('3');
    const q = construirPlantilla(e, ctx);
    expect(q.faltantes.find((f) => f.celda === 'A22')?.bloqueante).toBe(true);
  });

  it('4 destinos caben; 5 destinos: faltante bloqueante «divide el embarque» y solo se llenan 4 filas', () => {
    const e4 = extraccion();
    for (const n of [2, 3, 4]) conDestino(e4, n);
    e4.mercancias[0].id_destino = cv('4');
    const r4 = construirPlantilla(e4, ctx);
    expect(hoja(r4, 'RemintenteDestinatario').A53.valor).toBe(4);
    expect(r4.faltantes.filter((f) => f.bloqueante)).toEqual([]);

    const e5 = extraccion();
    for (const n of [2, 3, 4, 5]) conDestino(e5, n);
    e5.mercancias[0].id_destino = cv('1');
    const r5 = construirPlantilla(e5, ctx);
    const bloqueo = r5.faltantes.filter((f) => f.bloqueante);
    expect(bloqueo).toHaveLength(1);
    expect(bloqueo[0].mensaje).toContain('divide el embarque');
    expect(hoja(r5, 'RemintenteDestinatario').A54).toBeUndefined();
    expect(hoja(r5, 'RemintenteDestinatario').A53.valor).toBe(4);
  });
});

describe('LAYOUT_NUEVA', () => {
  it('es provisional, no verificada, serializable y agrega Origenes/Destinos vacías', () => {
    expect(LAYOUT_NUEVA.verificada).toBe(false);
    expect(layoutPuedeEnviarse(LAYOUT_NUEVA)).toBe(false);
    expect(layoutPuedeEnviarse(LAYOUT_NORMAL)).toBe(true);
    expect(LAYOUT_NUEVA.hojas.map((h) => h.hoja)).toEqual(['RemintenteDestinatario', 'Mercancias', 'Error', 'Origenes', 'Destinos']);
    expect(LAYOUT_NUEVA.nota).toContain('pendiente de especificación');
    expect(JSON.parse(JSON.stringify(LAYOUT_NUEVA))).toEqual(LAYOUT_NUEVA);
    expect(LAYOUT_NORMAL.nombre).toBe('normal'); // la normal no se tocó
  });

  it('para ENVIAR se genera la normal con aviso; para DESCARGAR sale la nueva con aviso', () => {
    const env = construirPlantilla(extraccion(), { ...ctx, plantilla: 'nueva' });
    expect(Object.keys(env.hojas)).toEqual(['RemintenteDestinatario', 'Mercancias', 'Error']);
    const des = construirPlantilla(extraccion(), { ...ctx, plantilla: 'nueva', uso: 'descarga' });
    expect(Object.keys(des.hojas)).toEqual(['RemintenteDestinatario', 'Mercancias', 'Error', 'Origenes', 'Destinos']);
    expect(des.hojas.Origenes).toEqual({});
    expect(des.avisos.some((a) => a.includes('solo para revisar'))).toBe(true);
  });
});

describe('elección normal / nueva (nunca por el contenido)', () => {
  const PERFIL = '11111111-1111-4111-8111-111111111111';
  it('sin override: la de la flota y el aviso de que salió de la configuración', () => {
    const e = elegirPlantilla({ plantillaPorDefecto: 'normal' }, null, PERFIL);
    expect(e).toEqual({ plantilla: 'normal', origen: 'defecto', avisos: [AVISO_PLANTILLA_POR_CONFIG] });
    expect(elegirPlantilla({ plantillaPorDefecto: 'nueva' }, { porPerfil: {} }, null).plantilla).toBe('nueva');
  });

  it('override por perfil: gana al defecto, sin el aviso; otro perfil sigue con el defecto', () => {
    const layout = { porPerfil: { [PERFIL]: 'nueva' } };
    const e = elegirPlantilla({ plantillaPorDefecto: 'normal' }, layout, PERFIL);
    expect(e).toEqual({ plantilla: 'nueva', origen: 'perfil', avisos: [] });
    expect(elegirPlantilla({ plantillaPorDefecto: 'normal' }, layout, '22222222-2222-4222-8222-222222222222').plantilla).toBe('normal');
    expect(elegirPlantilla({ plantillaPorDefecto: 'normal' }, layout, '__proto__').plantilla).toBe('normal');
  });

  it('una configuración ilegible no se interpreta: defecto + dos avisos', () => {
    const e = elegirPlantilla({ plantillaPorDefecto: 'normal' }, { porPerfil: { [PERFIL]: 'otra' } }, PERFIL);
    expect(e.plantilla).toBe('normal');
    expect(e.avisos).toHaveLength(2);
  });

  it('el contexto arrastra formato de distancia y avisos hasta el armado', () => {
    const c = contextoPlantillaDeConfig({ plantillaPorDefecto: 'normal', distanciaFormato: 'numero' }, null);
    const r = construirPlantilla(extraccion(), c);
    expect(hoja(r, 'RemintenteDestinatario').B50.valor).toBe(874.11);
    expect(r.avisos).toContain(AVISO_PLANTILLA_POR_CONFIG);
  });
});
