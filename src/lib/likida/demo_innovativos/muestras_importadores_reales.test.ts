import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { detectarInyeccion } from '../carta_porte_docs/inyeccion';
import { leerGeocercasCsv, leerPosicionesCsv, partirCsv } from '../conectores/tabla_propia/csv';
import { geocercasASitios } from '../conectores/tabla_propia/importar_geocercas';
import { haversineM } from '../conectores/tabla_propia/validar';
import { parsearMatrizConvenios } from '../convenios/importador';
import { derivarFormatoDeMatriz } from '../liquidacion_externa/formato_flota';
import { cuerposDeLiquidacionesCsv } from '../liquidacion_externa/liquidacion_csv';
import { generarExcelFormato, generarPdfFormato } from '../liquidacion_externa/render_formato';
import { matrizDeArchivoCatalogo } from '../peajes/archivo';
import { parsearCasetasMatriz } from '../peajes/casetas';
import { interpretarDesglose } from '../peajes/desglose';
import { parsearTagsMatriz } from '../peajes/tags';
import { analizarHistorial } from '../vigia/historial/analisis';
import { leerExportWhatsapp } from '../vigia/historial/export_whatsapp';
import { textoDeZip } from '../vigia/historial/zip_lector';
import { bytesMuestra, textoMuestra } from './muestras.test.util';

// ═══════════════════════════════════════════════════════════════════════════
// CADA MUESTRA DEL KIT PASA POR SU IMPORTADOR REAL.
//
// El kit (docs/demo/innovativos.md) promete que «el archivo del cliente entra por el importador del producto». Antes esa
// promesa la cubría un inspector propio del demo; aquí cada muestra se lee con el MISMO código que usa la pantalla o el
// cron y se compara con lo que el generador de muestras escribió a propósito (resumen_esperado.json, anomalias_sembradas.csv,
// geocercas.csv…). Si un importador cambia y la muestra deja de entrar, o entra distinta, esto falla antes del demo.
// ═══════════════════════════════════════════════════════════════════════════

const ESPERADO = JSON.parse(textoMuestra('whatsapp/resumen_esperado.json')) as Record<string, {
  mensajes: number; preguntas: number; sin_respuesta_10min: number; quejas: number; por_tema: Record<string, number>;
}>;
const EQUIPO = ['Despacho Innovativos Demo', 'Servicio a Cliente Demo A', 'Servicio a Cliente Demo B', 'Servicio a Cliente Demo C'];
const GRUPOS = [['afb', 'whatsapp/grupo_afb_silao_ios.txt'], ['arr', 'whatsapp/grupo_arr_ramos_android.txt'], ['cfn', 'whatsapp/grupo_cfn_apodaca_ios.zip']] as const;

function leerGrupo(rel: string) {
  const texto = rel.endsWith('.zip') ? (() => { const z = textoDeZip(bytesMuestra(rel)); if (!z.ok) throw new Error(z.error); return z.texto; })() : textoMuestra(rel);
  const lectura = leerExportWhatsapp(texto, { equipo: EQUIPO, sal: 'prueba' });
  return { lectura, reporte: analizarHistorial(lectura.mensajes) };
}

describe('whatsapp: el lector del Vigía y el análisis del histórico leen los 3 chats como el generador los escribió', () => {
  it.each(GRUPOS)('%s: mensajes, quejas y temas coinciden con resumen_esperado.json', (id, rel) => {
    const e = ESPERADO[id];
    const { lectura, reporte } = leerGrupo(rel);
    // El generador cuenta TODAS las líneas con encabezado menos la de cifrado; el lector separa las de sistema y multimedia.
    expect(lectura.mensajes.length + lectura.descartados).toBe(e.mensajes + 1);
    expect(lectura.fechasInvalidas).toBe(0);
    const tema = (t: string) => reporte.porTema.find((x) => x.tema === t)?.mensajes ?? 0;
    // La taxonomía real del producto: «cita» es cita_anden; «documentos» del generador = documentos + factura_pod; «placas» no es un tema
    // del producto y cae en «otro».
    expect(tema('queja')).toBe(e.quejas);
    expect(tema('ubicacion')).toBe(e.por_tema.ubicacion);
    expect(tema('eta')).toBe(e.por_tema.eta);
    expect(tema('cita_anden')).toBe(e.por_tema.cita);
    expect(tema('documentos') + tema('factura_pod')).toBe(e.por_tema.documentos);
    expect(tema('otro')).toBeGreaterThanOrEqual(e.por_tema.placas);
    // Hay respuestas lentas (el caso que el Vigía alerta a los 10 min) y el equipo se distingue del cliente.
    expect(reporte.tiempos.sobreUmbral).toBeGreaterThan(5);
    expect(reporte.tiempos.sobreUmbral).toBeLessThanOrEqual(e.sin_respuesta_10min);
    expect(reporte.mensajesEquipo).toBeGreaterThan(0);
    expect(reporte.mensajesCliente).toBeGreaterThan(0);
  });
  it('de los tres chats sale al menos una FAQ con respuesta típica (de ahí se aprueban las respuestas rápidas)', () => {
    const faqs = GRUPOS.flatMap(([, rel]) => leerGrupo(rel).reporte.faqs).filter((f) => f.respuestaTipica);
    expect(faqs.length).toBeGreaterThan(0);
  });
  it('los teléfonos y correos dentro del texto se tapan (en los chats que los traen) y el autor no queda en claro', () => {
    let tapados = 0;
    for (const [, rel] of GRUPOS) {
      const { lectura } = leerGrupo(rel);
      const todo = lectura.mensajes.map((m) => m.texto).join('\n');
      expect(todo).not.toMatch(/[^\s@]+@[^\s@]+\.[^\s@]+/);
      expect(todo).not.toContain('00 0000 0101');
      tapados += (todo.match(/\[(tel|correo)\]/g) ?? []).length;
      for (const m of lectura.mensajes) expect(m.autorHash).toMatch(/^[0-9a-f]{12}$/);
    }
    expect(tapados, 'ningún chat de muestra trae un dato personal que tapar: la prueba no probaría nada').toBeGreaterThan(0);
  });
});

describe('liquidación: el Excel de muestra de la flota se convierte en plantilla y entrega el mismo formato en Excel y PDF', () => {
  const nombre = 'liquidacion/formato_liquidacion_muestra.xlsx';
  const matriz = matrizDeArchivoCatalogo('formato_liquidacion_muestra.xlsx', bytesMuestra(nombre));
  const derivado = matriz.ok ? derivarFormatoDeMatriz(matriz.matriz) : null;
  it('el derivador reconoce todos los encabezados (nada sin mapear)', () => {
    expect(matriz.ok).toBe(true);
    expect(derivado?.ok).toBe(true);
    if (!derivado?.ok) return;
    expect(derivado.sinMapear).toEqual([]);
    expect(derivado.formato.columnas.map((c) => c.campo)).toEqual(['clave', 'descripcion', 'tipo', 'monto']);
    expect(derivado.formato.total.mostrar).toBe(true);
  });
  it('una liquidación de «su sistema» se imprime con esas columnas, en Excel y en PDF', async () => {
    if (!derivado?.ok) throw new Error('sin formato derivado');
    const { cuerpos } = cuerposDeLiquidacionesCsv(textoMuestra('liquidacion/liquidaciones_sistema.csv'));
    const c = cuerpos[0];
    const datos = {
      claveExterna: c.claveExterna, sistemaOrigen: c.sistemaOrigen, operadorNombre: 'Operador de demo', razonSocial: null,
      viajes: c.viajes, desde: c.periodo.desde, hasta: c.periodo.hasta, conceptos: c.conceptos.map((x) => ({ ...x, clave: x.clave ?? null })), total: c.total, moneda: c.moneda,
    };
    const libro = XLSX.read(generarExcelFormato(derivado.formato, datos), { type: 'array' });
    const filas = XLSX.utils.sheet_to_json<unknown[]>(libro.Sheets[libro.SheetNames[0]], { header: 1, defval: '' });
    const encabezados = derivado.formato.columnas.map((x) => x.encabezado);
    expect(filas.some((f) => JSON.stringify(f.slice(0, encabezados.length)) === JSON.stringify(encabezados))).toBe(true);
    expect(JSON.stringify(filas)).toContain(derivado.formato.total.etiqueta);
    const pdf = await generarPdfFormato(derivado.formato, datos);
    expect(new TextDecoder('latin1').decode(pdf.slice(0, 5))).toBe('%PDF-');
  });
});

describe('gps: el lector de tabla propia lee las posiciones y las geocercas de muestra', () => {
  it.each(['gps/gps_posicion_muestra.csv', 'gps/gps_actual.csv'])('%s: ninguna fila se rechaza y trae velocidad e ignición', (rel) => {
    const r = leerPosicionesCsv(textoMuestra(rel));
    expect(r.rechazadas).toEqual([]);
    expect(r.filas.length).toBeGreaterThan(10);
    expect(r.filas.some((f) => f.velocidadKmh !== null)).toBe(true);
    expect(r.filas.some((f) => f.ignicion !== null)).toBe(true);
  });
  it('gps_actual.csv trae las 250 unidades de la vista «al momento»', () => {
    expect(new Set(leerPosicionesCsv(textoMuestra('gps/gps_actual.csv')).filas.map((f) => f.unidad)).size).toBe(250);
  });
  it('las 17 geocercas entran: los 5 polígonos se guardan NATIVOS y su círculo de respaldo los contiene', () => {
    const g = leerGeocercasCsv(textoMuestra('gps/geocercas.csv'));
    expect(g.rechazadas).toEqual([]);
    expect(g.filas).toHaveLength(17);
    const poligonos = g.filas.filter((x) => x.tipo === 'poligono');
    expect(poligonos).toHaveLength(5);
    const s = geocercasASitios(g.filas);
    expect(s.rechazadas).toEqual([]);
    expect(s.aproximadas).toEqual([]);
    expect(s.poligonos).toBe(5);
    for (const fila of s.filas.filter((x) => x.poligono)) {
      for (const v of fila.poligono ?? []) {
        expect(haversineM({ lat: fila.lat, lon: fila.lng }, { lat: v.lat, lon: v.lng }), `${fila.codigo}: un vértice quedó fuera de su círculo`).toBeLessThanOrEqual(fila.radio_m);
      }
    }
  });
});

describe('peajes: los lectores de pases, TAG y casetas leen las muestras y cuadran entre sí', () => {
  const leerMatriz = (rel: string) => { const m = matrizDeArchivoCatalogo(rel.split('/').pop() as string, bytesMuestra(rel)); if (!m.ok) throw new Error(m.motivo); return m.matriz; };
  it('381 cruces, 250 TAG y 12 casetas sin una sola fila descartada', () => {
    const l = interpretarDesglose(leerMatriz('peajes/pases_24h.csv'));
    expect(l.descartadas).toEqual([]);
    expect(l.lineas).toHaveLength(381);
    const t = parsearTagsMatriz(leerMatriz('peajes/tags_unidades.csv'));
    expect(t.rechazadas).toEqual([]);
    expect(t.tags).toHaveLength(250);
    const c = parsearCasetasMatriz(leerMatriz('peajes/casetas_catalogo.csv'));
    expect(c.rechazadas).toEqual([]);
    expect(c.casetas).toHaveLength(12);
  });
});

describe('convenios: el importador de convenios lee las 84 instrucciones de los 14 convenios', () => {
  it('sin errores y con tarifa y requisitos de cobro (la muestra los trae)', () => {
    const r = parsearMatrizConvenios(partirCsv(textoMuestra('convenios/convenios.csv')), { puedeVerFinanzas: true });
    expect(r.errores).toEqual([]);
    expect(r.convenios).toHaveLength(14);
    expect(r.convenios.reduce((s, c) => s + c.instrucciones.length, 0)).toBe(84);
    // Sin permiso de finanzas el MISMO archivo no entra (la tarifa es dinero).
    expect(parsearMatrizConvenios(partirCsv(textoMuestra('convenios/convenios.csv')), { puedeVerFinanzas: false }).errores[0].motivo).toContain('finanzas');
  });
});

describe('carta porte: el detector real de instrucciones escondidas', () => {
  it('marca el CSV de prueba de inyección y NO el documento normal', () => {
    expect(detectarInyeccion(textoMuestra('carta_porte/orden_c12_4_PRUEBA_INYECCION.csv')).riesgo).toBe(true);
    expect(detectarInyeccion(textoMuestra('carta_porte/orden_c12_1.csv')).riesgo).toBe(false);
  });
});
