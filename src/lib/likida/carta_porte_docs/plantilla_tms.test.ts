import { describe, expect, it } from 'vitest';
import type { CampoValor, Extraccion } from './campos';
import { construirPlantilla, contarDestinos } from './plantilla_tms';
import { AVISO_PLANTILLA_POR_CONFIG, contextoPlantillaDeConfig, elegirPlantilla } from './salida_config';
import { LAYOUT_NORMAL, LAYOUT_NUEVA, coordenadasLayout, layoutPuedeEnviarse } from './plantilla_tms.layout';
import { aXlsxPlantillaTms } from './exportacion';
import * as XLSX from 'xlsx';
import {
  CELDAS_LLENABLES, CELDAS_NO_TOCAR, ENCABEZADOS_DESTINOS, ENCABEZADOS_MERCANCIAS, HOJAS_REAL, VALORES_LLENA,
  plantillaNormalRealEnBlanco, plantillaNormalRealLlena,
} from './evaluacion/plantilla_normal_real.fixture';

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
    numero_cliente_interno: '000123', caja_numero: 'CAJA-0001', regimen_aduanero: null,
    ...sobre,
  };
  const m: Record<string, string | null> = {
    bienes_transp: '43211500', descripcion: 'Equipo de computo', cantidad: '20', clave_unidad: 'H87', unidad_descripcion: 'Pieza',
    embalaje: '4G', embalaje_descripcion: 'Caja de carton', peso_kg: '14130', fraccion_arancelaria: '8471500100', tipo_materia: '05', // grep-limpio:ok
    regimen_aduanero: 'EXD', pedimento: '24 16 3456 4000123', material_peligroso: null, clave_material_peligroso: null, // grep-limpio:ok
    ...merc,
  };
  const conv = (o: Record<string, string | null>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, cv(v)]));
  return { campos: conv(campos), mercancias: [conv(m)] };
}

// Las pruebas de mapeo celda a celda miden DÓNDE cae cada dato, no las reglas de la Guía (T-A3-45, más abajo): sin reglas.
const ctx = { clienteInterno: null, plantilla: 'normal' as const, reglasGuia: false as const };
const hoja = (r: ReturnType<typeof construirPlantilla>, n: string) => r.hojas[n];

describe('construirPlantilla', () => {
  it('extracción completa: cada valor cae en su coordenada', () => {
    const r = construirPlantilla(extraccion(), ctx);
    const rd = hoja(r, 'RemintenteDestinatario');
    const esperado: Record<string, string> = {
      B5: 'EXD', B6: 'LP-0001', B7: '000123', B8: 'CAJA-0001', C11: 'Origen Sintetico SA', C12: 'AAA010101AAA', C14: 'Calle Uno', C15: '10', C17: '0001', C18: 'Colonia Uno', // grep-limpio:ok
      C19: '44100', C20: '01', C21: 'Localidad Uno', C22: '039', C23: 'Municipio Uno', C24: 'JAL', C25: 'Jalisco', C26: 'MEX',
    };
    for (const [k, v] of Object.entries(esperado)) expect(rd[k]?.valor, k).toBe(v);
    expect(rd.C16.valor).toBeNull();
    // el bloque «destinatario» (filas 29..47) dice «NO LLENAR»: no se escribe nada ahí
    for (const k of Object.keys(rd)) expect(/^[A-Z]+(29|3\d|4[0-7])$/.test(k), k).toBe(false);
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
    expect(me.K22.valor).toBe('24 16 3456 4000123'); // pedimento
    expect(me.N22.valor).toBe('05'); // tipo de materia
    // O = «RFC Importador»: la extracción aún no trae ese dato (no es el RFC del agente aduanal): la celda queda vacía y NO es faltante.
    expect(me.O21.valor).toBe('RFC Importador');
    expect(me.O22).toBeUndefined();
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
    expect(hoja(r, 'Mercancias').L22.valor).toBe('NO');
    expect(hoja(r, 'Mercancias').M22.valor).toBe('N/A');
    const p = construirPlantilla(extraccion({}, { material_peligroso: 'true' }), ctx);
    expect(hoja(p, 'Mercancias').L22.valor).toBe('SI');
    expect(p.faltantes).toContainEqual({ campo: 'mercancia.clave_material_peligroso', celda: 'M22' });
    const q = construirPlantilla(extraccion({}, { material_peligroso: 'true', clave_material_peligroso: '1203' }), ctx);
    expect(hoja(q, 'Mercancias').M22.valor).toBe('1203');
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
    // al enviar sale la «normal», que ya está verificada: no hay aviso de layout provisional
    expect(r.avisos.some((a) => a.includes('provisional'))).toBe(false);
    // al descargar sale la «nueva», que sigue provisional
    expect(construirPlantilla(e, { clienteInterno: '777', plantilla: 'nueva', uso: 'descarga' }).avisos.some((a) => a.includes('provisional'))).toBe(true);
    expect(hoja(r, 'RemintenteDestinatario').B7.valor).toBe('777');
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

  it('el conjunto de coordenadas coincide con la lista congelada de la estructura de la plantilla real', () => {
    const col = (a: string, b: string) => Array.from({ length: b.charCodeAt(0) - a.charCodeAt(0) + 1 }, (_, i) => String.fromCharCode(a.charCodeAt(0) + i));
    const rd = 'RemintenteDestinatario';
    const filasC = [11, 12, ...Array.from({ length: 13 }, (_, i) => 14 + i)];
    const congelada = [
      ...[5, 6, 7, 8].map((n) => `${rd}!B${n}`),
      ...filasC.map((n) => `${rd}!C${n}`),
      ...col('A', 'T').flatMap((c) => [`${rd}!${c}49`, `${rd}!${c}50`]),
      ...col('A', 'O').flatMap((c) => [`Mercancias!${c}21`, `Mercancias!${c}22`]),
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

// ═══════════════════════════════════════════════════════════════════════════
// T-A3-43 · LAYOUT «normal» contrastado con la FORMA real de la plantilla del TMS (fixture sintético hecho a mano, que NO
// importa el layout: si el layout se equivoca de celda, estas pruebas lo ven).
//
// TABLA CAMPO → CELDA (hoja RemintenteDestinatario; los valores de B van en la columna B, el remitente en la C):
//   B5 régimen aduanero (regimen_aduanero, o el de la primera mercancía) · B6 referencia (folio_cliente)
//   B7 cliente interno (ctx.clienteInterno) · B8 número de caja (caja_numero)
//   C11 razón social · C12 RFC/Tax ID · C14 calle · C15 núm. ext. · C16 núm. int. · C17 clave colonia · C18 colonia · C19 CP
//   C20 clave localidad · C21 localidad · C22 clave municipio · C23 municipio · C24 clave estado · C25 estado · C26 país
//   Filas 29..47 («destinatario», «NO LLENAR»), C1:C8, C36 y C37: NO se escriben. Destinos: tabla A49:T53 (4 filas).
// Hoja Mercancias (encabezado fila 21, datos desde la 22):
//   A Id destino · B clave producto · C descripción · D cantidad · E clave unidad · F unidad · G embalaje · H desc. embalaje
//   I peso kg · J fracción · K pedimento · L material peligroso (SI/NO) · M clave mat. peligroso · N tipo de materia · O RFC importador
// ═══════════════════════════════════════════════════════════════════════════
describe('LAYOUT_NORMAL contra la forma real de la plantilla (T-A3-43)', () => {
  const rd = 'RemintenteDestinatario';
  const celdasDelLayout = (): Array<{ hoja: string; celda: string }> =>
    LAYOUT_NORMAL.hojas.flatMap((h) => h.celdas.map((e) => ({ hoja: h.hoja, celda: e.celda })));

  it('las celdas fijas del layout son EXACTAMENTE las que la plantilla real deja llenar (B5..B8 y C11..C26 sin la fila 13)', () => {
    const del = celdasDelLayout().filter((x) => x.hoja === rd).map((x) => x.celda).sort();
    expect(del).toEqual([...CELDAS_LLENABLES].sort());
    for (const x of del) expect(CELDAS_NO_TOCAR, x).not.toContain(x);
  });

  it('encabezados: mismas letras que la plantilla real (A..T en la fila 49, A..O en la 21)', () => {
    const tabla = (hoja: string) => LAYOUT_NORMAL.hojas.find((h) => h.hoja === hoja)!.tablas[0];
    expect(tabla(rd).filaEncabezado).toBe(49);
    expect(tabla(rd).primeraFila).toBe(50);
    expect(tabla(rd).maxFilas).toBe(4);
    expect(tabla(rd).columnas.map((c) => c.columna).join('')).toBe('ABCDEFGHIJKLMNOPQRST');
    expect(tabla(rd).columnas).toHaveLength(ENCABEZADOS_DESTINOS.length);
    expect(tabla('Mercancias').filaEncabezado).toBe(21);
    expect(tabla('Mercancias').primeraFila).toBe(22);
    expect(tabla('Mercancias').columnas.map((c) => c.columna).join('')).toBe('ABCDEFGHIJKLMNO');
    expect(tabla('Mercancias').columnas).toHaveLength(ENCABEZADOS_MERCANCIAS.length);
  });

  it('1, 2 y 14 mercancías: cada valor en su coordenada y NADA en C1:C8, C36, C37 ni en el bloque destinatario', () => {
    for (const n of [1, 2, 14]) {
      const e = extraccion();
      for (let i = 1; i < n; i++) e.mercancias.push({ ...e.mercancias[0], descripcion: cv(`Mercancia ${i + 1}`), peso_kg: cv(String(100 + i)) });
      const r = construirPlantilla(e, ctx);
      expect(r.faltantes, `n=${n}`).toEqual([]);
      const sal = r.hojas[rd];
      for (const k of Object.keys(sal)) expect(CELDAS_NO_TOCAR, `n=${n} ${k}`).not.toContain(k);
      const me = r.hojas.Mercancias;
      for (let i = 0; i < n; i++) {
        const f = 22 + i;
        expect(me[`A${f}`].valor, `A${f}`).toBe(1);
        expect(me[`B${f}`].valor).toBe('43211500');
        expect(me[`C${f}`].valor).toBe(i === 0 ? 'Equipo de computo' : `Mercancia ${i + 1}`);
        expect(me[`D${f}`].valor).toBe(20);
        expect(me[`I${f}`].valor).toBe(i === 0 ? 14130 : 100 + i);
        expect(me[`K${f}`].valor).toBe('24 16 3456 4000123');
        expect(me[`L${f}`].valor).toBe('NO');
        expect(me[`M${f}`].valor).toBe('N/A');
        expect(me[`N${f}`].valor).toBe('05');
      }
      expect(me[`A${22 + n}`]).toBeUndefined();
    }
  });

  it('relectura celda a celda: el libro generado sobre la plantilla en blanco da lo esperado y conserva notas y comentarios', () => {
    const p = construirPlantilla(extraccion(), ctx);
    const base = XLSX.read(plantillaNormalRealEnBlanco(), { type: 'array', cellStyles: true });
    const salida = XLSX.read(aXlsxPlantillaTms(p, plantillaNormalRealEnBlanco()), { type: 'array', cellStyles: true });
    expect(salida.SheetNames).toEqual([...HOJAS_REAL]);
    // lo que construimos está, celda a celda, en el libro releído (números como números, texto como texto)
    for (const [h, celdas] of Object.entries(p.hojas)) {
      for (const [coord, c] of Object.entries(celdas)) {
        if (c.valor === null) continue;
        const leida = salida.Sheets[h][coord];
        expect(leida?.v, `${h}!${coord}`).toBe(c.valor);
        expect(leida.t, `${h}!${coord}`).toBe(typeof c.valor === 'number' ? 'n' : 's');
      }
    }
    // lo que la plantilla reserva a notas queda intacto
    for (const k of CELDAS_NO_TOCAR) expect(salida.Sheets[rd][k]?.v, k).toBe(base.Sheets[rd][k]?.v);
    // hojas que no se tocan
    expect(salida.Sheets.Error.A1.v).toBe(base.Sheets.Error.A1.v);
    expect(salida.Sheets['Informacion Agente Aduanal'].B3.v).toBe(base.Sheets['Informacion Agente Aduanal'].B3.v);
    // los comentarios de celda (instrucciones) sobreviven al reescribir
    expect(base.Sheets[rd].A5.c?.[0]?.t).toBeTruthy();
    expect(salida.Sheets[rd].A5.c?.[0]?.t).toBe(base.Sheets[rd].A5.c?.[0]?.t);
    expect(salida.Sheets[rd].A8.c?.[0]?.t).toBe(base.Sheets[rd].A8.c?.[0]?.t);
  });

  it('equivalencia con el libro «llenado»: la misma información sale en las mismas celdas de datos que la variante de entrada A', () => {
    const v = VALORES_LLENA;
    const e = extraccion({
      folio_cliente: String(v.remitente.B6), numero_cliente_interno: String(v.remitente.B7), caja_numero: String(v.remitente.B8),
      origen_nombre: String(v.remitente.C11), origen_rfc: String(v.remitente.C12), origen_calle: String(v.remitente.C14),
      origen_num_ext: String(v.remitente.C15), origen_num_int: String(v.remitente.C16), origen_colonia_clave: String(v.remitente.C17),
      origen_colonia: String(v.remitente.C18), origen_cp: String(v.remitente.C19), origen_localidad_clave: String(v.remitente.C20),
      origen_localidad: String(v.remitente.C21), origen_municipio_clave: String(v.remitente.C22), origen_municipio: String(v.remitente.C23),
      origen_estado: String(v.remitente.C24), origen_pais: String(v.remitente.C26),
      destino_nombre: String(v.destino.C50), destino_rfc: String(v.destino.D50), destino_calle: String(v.destino.E50), destino_num_ext: String(v.destino.F50),
      destino_cp: String(v.destino.J50), destino_localidad: String(v.destino.L50), destino_estado: String(v.destino.O50), destino_pais: String(v.destino.Q50),
      contacto_destino_nombre: String(v.destino.R50), contacto_destino_telefono: String(v.destino.S50), contacto_destino_correo: String(v.destino.T50),
      distancia_km: String(v.destino.B50), destino_colonia_clave: null, destino_colonia: null, destino_municipio_clave: null, destino_municipio: null,
    });
    e.campos.regimen_aduanero = cv(String(v.remitente.B5));
    const ap = (m: Record<string, string | number>): Record<string, CampoValor> => ({
      bienes_transp: cv(String(m.B)), descripcion: cv(String(m.C)), cantidad: cv(String(m.D)), clave_unidad: cv(String(m.E)),
      unidad_descripcion: cv(m.F === undefined ? null : String(m.F)), embalaje: cv(m.G === undefined ? null : String(m.G)),
      embalaje_descripcion: cv(m.H === undefined ? null : String(m.H)), peso_kg: cv(String(m.I)),
      fraccion_arancelaria: cv(m.J === undefined ? null : String(m.J)), pedimento: cv(m.K === undefined ? null : String(m.K)),
      material_peligroso: cv(m.L === 'SI' ? 'true' : null), clave_material_peligroso: cv(m.M === 'N/A' ? null : String(m.M)),
      tipo_materia: cv(String(m.N)),
    });
    e.mercancias = v.mercancias.map(ap);
    const p = construirPlantilla(e, { ...ctx, distanciaFormato: 'numero' });
    const generado = XLSX.read(aXlsxPlantillaTms(p, plantillaNormalRealEnBlanco()), { type: 'array' });
    const llena = XLSX.read(plantillaNormalRealLlena(), { type: 'array' });
    const datos = (h: string): string[] => Object.keys(llena.Sheets[h]).filter((k) => !k.startsWith('!'))
      .filter((k) => { const f = Number(k.replace(/^[A-Z]+/, '')); return h === rd ? (f >= 50 || (f >= 5 && f <= 26 && /^[BC]/.test(k) && CELDAS_LLENABLES.includes(k))) : f >= 22; });
    for (const h of [rd, 'Mercancias']) {
      const esperadas = datos(h);
      expect(esperadas.length, h).toBeGreaterThan(10);
      for (const k of esperadas) {
        const a = generado.Sheets[h][k]?.v; const b = llena.Sheets[h][k]?.v;
        // las claves de colonia/municipio de la variante llena vienen en columna C del remitente; en destino quedan vacías (no se inventan)
        expect(String(a), `${h}!${k}`).toBe(String(b));
      }
    }
  });

  it('el layout es verificado y no provisional; NUEVA conserva su estado', () => {
    expect(LAYOUT_NORMAL.verificada).toBe(true);
    expect(LAYOUT_NORMAL.provisional).toBe(false);
    expect(layoutPuedeEnviarse(LAYOUT_NORMAL)).toBe(true);
    expect(LAYOUT_NUEVA.provisional).toBe(true);
    expect(layoutPuedeEnviarse(LAYOUT_NUEVA)).toBe(false);
  });
});

// ── T-A3-45 · reglas de dependencia de la Guía de llenado en el libro exportado ─────────────────────────────────────
describe('plantilla del TMS con las reglas de la Guía de llenado (T-A3-45)', () => {
  const ctxGuia = { clienteInterno: null, plantilla: 'normal' as const }; // sin `reglasGuia`: rigen las de la Guía
  const merc = (r: ReturnType<typeof construirPlantilla>) => hoja(r, 'Mercancias');
  const leer = (r: ReturnType<typeof construirPlantilla>) => XLSX.read(aXlsxPlantillaTms(r), { type: 'array' });

  it('NO peligroso: el libro no trae embalaje ni su descripción; peligroso: sí', () => {
    const no = construirPlantilla(extraccion(), ctxGuia);
    expect(merc(no).G22.valor).toBeNull();
    expect(merc(no).H22.valor).toBeNull();
    const l = leer(no);
    expect(l.Sheets.Mercancias.G22).toBeUndefined();
    expect(l.Sheets.Mercancias.H22).toBeUndefined();
    expect(no.avisos.join(' ')).toMatch(/embalaje.*no es material peligroso.*mercancía 1/);
    const si = construirPlantilla(extraccion({}, { material_peligroso: 'true', clave_material_peligroso: '1203' }), ctxGuia);
    expect(merc(si).G22.valor).toBe('4G');
    expect(merc(si).H22.valor).toBe('Caja de carton');
    expect(merc(si).L22.valor).toBe('SI');
  });

  it('exportación: pedimento vacío; importación: se conserva', () => {
    const expo = construirPlantilla(extraccion(), ctxGuia);
    expect(merc(expo).K22.valor).toBeNull();
    expect(leer(expo).Sheets.Mercancias.K22).toBeUndefined();
    expect(expo.avisos.join(' ')).toMatch(/pedimento.*exportación/);
    const impo = construirPlantilla(extraccion({}, { regimen_aduanero: 'IMD' }), ctxGuia);
    expect(merc(impo).K22.valor).toBe('24 16 3456 4000123');
    expect(impo.avisos.join(' ')).not.toMatch(/pedimento/);
  });

  it('descripción y razón social salen limpias, con aviso de lo cambiado', () => {
    const r = construirPlantilla(extraccion({ origen_nombre: 'Origen, S.A. de C.V.' }, { descripcion: 'Equipo "X" #5' }), ctxGuia);
    expect(merc(r).C22.valor).toBe('Equipo X 5');
    expect(hoja(r, 'RemintenteDestinatario').C11.valor).toBe('Origen SA de CV');
    expect(r.avisos.join(' ')).toMatch(/caracteres especiales de la descripción/);
    expect(r.avisos.join(' ')).toMatch(/puntos y comas de la razón social/);
  });

  it('país ≠ MEX: sin claves de colonia, localidad ni municipio del destino; MEX conserva las del origen', () => {
    const r = construirPlantilla(extraccion({ destino_colonia_clave: '0009', destino_localidad_clave: '05', destino_municipio_clave: '012' }), ctxGuia);
    const rd = hoja(r, 'RemintenteDestinatario');
    expect(rd.H50.valor).toBeNull(); expect(rd.K50.valor).toBeNull(); expect(rd.M50.valor).toBeNull();
    expect(rd.I50.valor).toBe('Zona Dos'); // los nombres sí
    expect(rd.C17.valor).toBe('0001'); expect(rd.C20.valor).toBe('01'); expect(rd.C22.valor).toBe('039'); // origen MEX intacto
  });

  it('con `reglasGuia: false` el libro sale como antes, y la extracción original no se modifica', () => {
    const e = extraccion();
    const antes = JSON.stringify(e);
    construirPlantilla(e, ctxGuia);
    expect(JSON.stringify(e)).toBe(antes);
    expect(merc(construirPlantilla(e, { ...ctxGuia, reglasGuia: false })).K22.valor).toBe('24 16 3456 4000123');
    expect(merc(construirPlantilla(e, { ...ctxGuia, reglasGuia: { pedimentoSoloImportacion: false } })).K22.valor).toBe('24 16 3456 4000123');
  });
});
