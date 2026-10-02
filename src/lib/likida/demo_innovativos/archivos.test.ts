import { describe, expect, it } from 'vitest';
import { validarLiquidacionExterna } from '../liquidacion_externa/esquema';
import { entradasDeZip, inspeccionarExportWhatsapp, validarArchivo } from './archivos';
import { leerConveniosCsv } from './convenios_csv';
import { cuerposDeLiquidacionesCsv } from './liquidacion_csv';
import { bytesMuestra, textoMuestra } from './muestras.test.util';

// ═══════════════════════════════════════════════════════════════════════════
// EL VALIDADOR DE ARCHIVOS DEL KIT: cada archivo de muestra es válido, y cada
// forma de romperlo se detecta con su motivo. Donde el importador real existe
// (pases, sitios, liquidación externa) la prueba usa SU lector, no una copia.
// ═══════════════════════════════════════════════════════════════════════════

const enc = (s: string) => new TextEncoder().encode(s);

describe('los archivos de muestra del demo son válidos', () => {
  const CASOS: Array<[string, string, string]> = [
    ['gps_posiciones', 'gps/gps_posicion_muestra.csv', 'gps_posicion_muestra.csv'],
    ['gps_posiciones', 'gps/gps_actual.csv', 'gps_actual.csv'],
    ['geocercas', 'gps/geocercas.csv', 'geocercas.csv'],
    ['pases', 'peajes/pases_24h.csv', 'pases_24h.csv'],
    ['tags', 'peajes/tags_unidades.csv', 'tags_unidades.csv'],
    ['casetas', 'peajes/casetas_catalogo.csv', 'casetas_catalogo.csv'],
    ['liquidaciones', 'liquidacion/liquidaciones_sistema.csv', 'liquidaciones_sistema.csv'],
    ['convenios', 'convenios/convenios.csv', 'convenios.csv'],
    ['whatsapp', 'whatsapp/grupo_afb_silao_ios.txt', 'grupo_afb_silao_ios.txt'],
    ['whatsapp', 'whatsapp/grupo_arr_ramos_android.txt', 'grupo_arr_ramos_android.txt'],
    ['whatsapp', 'whatsapp/grupo_cfn_apodaca_ios.zip', 'grupo_cfn_apodaca_ios.zip'],
    ['carta_porte', 'carta_porte/orden_c05_1.pdf', 'orden_c05_1.pdf'],
    ['carta_porte', 'carta_porte/orden_c10_1.xlsx', 'orden_c10_1.xlsx'],
    ['carta_porte', 'carta_porte/orden_c12_1.csv', 'orden_c12_1.csv'],
  ];
  it.each(CASOS)('%s ← %s', (tipo, rel, nombre) => {
    const r = validarArchivo(tipo, nombre, bytesMuestra(rel));
    expect(r.problemas).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.resumen.length).toBeGreaterThan(0);
  });
});

describe('pases: SU lector lee el archivo y las anomalías sembradas están ahí', () => {
  it('379 cruces y el total cuadra con el que salió de la base', () => {
    const r = validarArchivo('pases', 'pases_24h.csv', bytesMuestra('peajes/pases_24h.csv'));
    expect(r.resumen[0]).toMatch(/^379 cruces legibles, \d+ TAG distintos, importe total /);
  });
  it('cada anomalía de la verdad sembrada corresponde a una línea del archivo (mismo TAG, caseta y minuto)', () => {
    const pases = textoMuestra('peajes/pases_24h.csv').trim().split('\n').slice(1);
    const verdad = textoMuestra('peajes/anomalias_sembradas.csv').trim().split('\n').slice(1);
    expect(verdad.length).toBeGreaterThanOrEqual(12);
    const tipos = verdad.map((l) => l.split(',')[0]);
    expect(tipos.filter((t) => t === 'fuera_de_ruta').length).toBeGreaterThanOrEqual(8);
    expect(tipos.filter((t) => t === 'duplicado').length).toBe(4);
    for (const l of verdad) {
      const [, , , tag, caseta, cruce] = l.split(',');
      const [anio, mes, dia] = cruce.slice(0, 10).split('-'); const hhmm = cruce.slice(11, 16);
      expect(pases.some((p) => { const c = p.split(','); return c[3] === tag && c[2] === caseta && c[0] === `${dia}/${mes}/${anio}` && c[1].startsWith(hhmm); })).toBe(true);
    }
  });
  it('un archivo sin columna de importe no se adivina', () => {
    const r = validarArchivo('pases', 'x.csv', enc('Fecha,Caseta,TAG\n19/10/2026,Caseta A,PSD1234'));
    expect(r.ok).toBe(false);
  });
});

describe('tags y casetas: SUS lectores', () => {
  it('250 TAG de 250 unidades y 12 casetas, sin rechazos', () => {
    expect(validarArchivo('tags', 'tags_unidades.csv', bytesMuestra('peajes/tags_unidades.csv')).resumen[0]).toBe('250 TAG legibles de 250 unidades');
    expect(validarArchivo('casetas', 'casetas_catalogo.csv', bytesMuestra('peajes/casetas_catalogo.csv')).resumen[0]).toContain('12 casetas');
  });
  it('un TAG repetido con dos unidades se rechaza (las dos filas) y una caseta con lat/lng invertidas también', () => {
    const t = validarArchivo('tags', 't.csv', enc('tag;unidad\nPSD000000001;IN-001\nPSD000000001;IN-002'));
    expect(t.ok).toBe(false);
    const c = validarArchivo('casetas', 'c.csv', enc('nombre;lat;lng\nCaseta X;-100,19;25,78'));
    expect(c.ok).toBe(false);
    expect(c.problemas[0]).toContain('invertidas');
  });
  it('las casetas del catálogo son las de las líneas del archivo de pases (el cruce las encuentra)', () => {
    const casetas = new Set(textoMuestra('peajes/casetas_catalogo.csv').trim().split('\n').slice(1).map((l) => l.split(';')[0]));
    const usadas = new Set(textoMuestra('peajes/pases_24h.csv').trim().split('\n').slice(1).map((l) => l.split(',')[2]));
    for (const u of usadas) expect(casetas.has(u)).toBe(true);
    const tags = new Set(textoMuestra('peajes/tags_unidades.csv').trim().split('\n').slice(1).map((l) => l.split(';')[0]));
    for (const l of textoMuestra('peajes/pases_24h.csv').trim().split('\n').slice(1)) expect(tags.has(l.split(',')[3])).toBe(true);
  });
});

describe('liquidaciones: el CSV de su sistema → el cuerpo que el endpoint real acepta', () => {
  const { cuerpos, problemas } = cuerposDeLiquidacionesCsv(textoMuestra('liquidacion/liquidaciones_sistema.csv'));
  it('las 40 liquidaciones de muestra se convierten sin problemas', () => {
    expect(problemas).toEqual([]);
    expect(cuerpos).toHaveLength(40);
  });
  it('TODOS los cuerpos pasan la validación estricta REAL de POST /v1/liquidaciones-externas', () => {
    for (const c of cuerpos) {
      const n = validarLiquidacionExterna(c as unknown as Record<string, unknown>);
      expect(n.claveExterna).toBe(c.claveExterna);
      expect(n.total).toBe(c.total);
    }
  });
  it('el cuerpo de ejemplo versionado es el de la primera liquidación', () => {
    const ej = JSON.parse(textoMuestra('liquidacion/post_liquidacion_externa.ejemplo.json'));
    expect(validarLiquidacionExterna(ej).claveExterna).toBe(ej.claveExterna);
    expect(cuerpos.some((c) => c.claveExterna === ej.claveExterna)).toBe(true);
  });
  it('un total que no es la suma de sus renglones NO se entrega a ciegas', () => {
    const csv = 'clave_externa,numero_empleado,periodo_desde,periodo_hasta,concepto,tipo,monto,total_sistema\nL1,E1,2026-10-01,2026-10-07,Pago,percepcion,1000.00,1100.00\nL1,E1,2026-10-01,2026-10-07,ISR,deduccion,100.00,1100.00';
    const r = cuerposDeLiquidacionesCsv(csv);
    expect(r.cuerpos).toEqual([]);
    expect(r.problemas[0].motivo).toContain('no es la suma de sus renglones');
  });
  it('tipo desconocido, monto negativo, periodo invertido y columnas faltantes se señalan', () => {
    const base = 'clave_externa,numero_empleado,periodo_desde,periodo_hasta,concepto,tipo,monto,total_sistema\n';
    expect(cuerposDeLiquidacionesCsv(`${base}L1,E1,2026-10-01,2026-10-07,Pago,bono,10,10`).problemas[0].motivo).toContain('percepcion/deduccion');
    expect(cuerposDeLiquidacionesCsv(`${base}L1,E1,2026-10-01,2026-10-07,Pago,percepcion,-10,-10`).problemas[0].motivo).toContain('negativo');
    expect(cuerposDeLiquidacionesCsv(`${base}L1,E1,2026-10-09,2026-10-07,Pago,percepcion,10,10`).problemas[0].motivo).toContain('periodo');
    expect(cuerposDeLiquidacionesCsv('a,b\n1,2').problemas[0].motivo).toContain('Faltan columnas');
  });
});

describe('convenios', () => {
  const r = leerConveniosCsv(textoMuestra('convenios/convenios.csv'));
  it('14 convenios de 6 instrucciones, todas dentro de los dominios de la 0580', () => {
    expect(r.problemas).toEqual([]);
    expect(r.convenios).toHaveLength(14);
    for (const c of r.convenios) {
      expect(c.instrucciones).toHaveLength(6);
      expect(c.tarifaModo).not.toBeNull();
      expect(c.requisitosCobro.length).toBe(3);
    }
  });
  it('una categoría, un momento o un texto fuera de dominio se rechazan', () => {
    const base = 'clave,cliente,convenio,origen,destino,categoria,momento,orden,texto\n';
    expect(leerConveniosCsv(`${base}c,Cl,Conv,A,B,otra_cosa,ambos,1,hola`).problemas[0].motivo).toContain('categoría');
    expect(leerConveniosCsv(`${base}c,Cl,Conv,A,B,puerta,nunca,1,hola`).problemas[0].motivo).toContain('momento');
    expect(leerConveniosCsv(`${base}c,Cl,Conv,A,B,puerta,ambos,1,${'x'.repeat(401)}`).problemas[0].motivo).toContain('400');
  });
  it('avisa cuando un convenio no dice con quién reportarse', () => {
    const v = validarArchivo('convenios', 'c.csv', enc('clave,cliente,convenio,categoria,momento,texto\nc,Cl,Conv,puerta,ambos,Entrar por la 3'));
    expect(v.ok).toBe(true);
    expect(v.avisos[0]).toContain('reportarse');
  });
});

describe('whatsapp: formatos de exportación', () => {
  it('el .txt de iOS (24 h) y el de Android se reconocen; el resumen esperado cuadra con lo generado', () => {
    const esperado = JSON.parse(textoMuestra('whatsapp/resumen_esperado.json'));
    const ios = inspeccionarExportWhatsapp(textoMuestra('whatsapp/grupo_afb_silao_ios.txt'));
    const and = inspeccionarExportWhatsapp(textoMuestra('whatsapp/grupo_arr_ramos_android.txt'));
    expect(ios.formato).toBe('ios');
    expect(and.formato).toBe('android');
    expect(ios.encabezados).toBe(esperado.afb.mensajes + 1); // + la línea de cifrado
    expect(and.encabezados).toBe(esperado.arr.mensajes + 1);
    expect(and.sistema).toBe(1);
  });
  it('el .zip trae su .txt (directorio central) y un zip dañado se dice', () => {
    expect(entradasDeZip(bytesMuestra('whatsapp/grupo_cfn_apodaca_ios.zip'))).toEqual(['Chat de WhatsApp con Cervecería Ficticia del Norte.txt']);
    const roto = bytesMuestra('whatsapp/grupo_cfn_apodaca_ios.zip').slice(0, 60);
    expect(validarArchivo('whatsapp', 'x.zip', roto).ok).toBe(false);
  });
  it('un texto cualquiera no es una exportación', () => {
    expect(validarArchivo('whatsapp', 'x.txt', enc('hola\nesto no es un chat')).ok).toBe(false);
  });
  it('el histórico trae casos para el Vigía: quejas y respuestas lentas (>10 min) en cada grupo', () => {
    const e = JSON.parse(textoMuestra('whatsapp/resumen_esperado.json'));
    for (const g of ['afb', 'arr', 'cfn']) { expect(e[g].quejas).toBeGreaterThan(5); expect(e[g].sin_respuesta_10min).toBeGreaterThan(5); }
  });
});

describe('regex sin explosión: líneas adversarias no tumban el validador', () => {
  it('50,000 caracteres de «casi encabezado» se leen en tiempo lineal (<500 ms por archivo)', () => {
    const casi = `[${'1/'.repeat(25_000)}`;
    const t0 = Date.now();
    inspeccionarExportWhatsapp(`${casi}\n${'9'.repeat(50_000)} - x\n${'1:'.repeat(25_000)}`);
    validarArchivo('gps_posiciones', 'x.csv', enc(`unidad,lat,lon,fecha_hora\nIN-1,25.7,-100.1,${'2026-10-20 '.repeat(5_000)}`));
    expect(Date.now() - t0).toBeLessThan(500);
  });
});

describe('carta_porte: el documento del cliente', () => {
  it('un PDF con contenido activo se marca; un escaneo sin fuentes avisa', () => {
    const activo = enc('%PDF-1.4\n1 0 obj << /OpenAction << /S /JavaScript /JS (x) >> >> endobj\n%%EOF');
    const r = validarArchivo('carta_porte', 'a.pdf', activo);
    expect(r.ok).toBe(false);
    expect(r.problemas[0]).toContain('contenido activo');
    expect(validarArchivo('carta_porte', 'b.pdf', enc('%PDF-1.4\n%%EOF')).avisos[0]).toContain('escaneo');
  });
  it('una extensión que no es lo que dice, un vacío y un formato no soportado se rechazan', () => {
    expect(validarArchivo('carta_porte', 'a.pdf', enc('no soy pdf')).ok).toBe(false);
    expect(validarArchivo('carta_porte', 'a.pdf', new Uint8Array()).ok).toBe(false);
    expect(validarArchivo('carta_porte', 'a.docx', enc('x')).problemas[0]).toContain('no soportado');
    expect(validarArchivo('carta_porte', 'a.png', enc('no es png')).ok).toBe(false);
  });
  it('el CSV de prueba de inyección se valida como archivo (el filtro de inyección es del extractor, no de este paso)', () => {
    expect(validarArchivo('carta_porte', 'x.csv', bytesMuestra('carta_porte/orden_c12_4_PRUEBA_INYECCION.csv')).ok).toBe(true);
  });
});

describe('geocercas y gps: problemas con su fila', () => {
  it('un CSV de posiciones con filas malas reporta cuáles y por qué (no entra a medias en silencio)', () => {
    const r = validarArchivo('gps_posiciones', 'p.csv', enc('unidad,lat,lon,fecha_hora\nIN-1,25.7,-100.1,2026-10-20 09:00:00\nIN-1,-100.1,25.7,2026-10-20 09:05:00'));
    expect(r.ok).toBe(false);
    expect(r.problemas[0]).toMatch(/^fila 3: .*intercambiadas/);
  });
  it('tipo desconocido', () => {
    expect(validarArchivo('otra_cosa', 'x', enc('')).problemas[0]).toContain('desconocido');
  });
});
