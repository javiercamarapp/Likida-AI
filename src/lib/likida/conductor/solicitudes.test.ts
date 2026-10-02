import { describe, it, expect } from 'vitest';
import { armarEscalacion, armarEscalacionSenalVida, armarRecordatorio, armarSenalVida, armarSolicitud } from './solicitudes';
import { plantillaDeCatalogo, textoRenderizado, validarCatalogo, variablesDeTexto } from '@/lib/meta/plantillas_catalogo';
import { armarComponentesPlantilla } from '@/lib/meta/plantilla_payload';
import { hitoVacio, viajeBase } from './memoria.fixture';
import { TIPOS_HITO, type TipoHito } from './tipos';
import type { MensajeSaliente } from './solicitudes';

const AHORA = new Date('2026-10-02T20:00:00.000Z');
const V = '4f1f6e2e-95c1-4c52-9f9e-3f6f6bd8d001';
const viaje = viajeBase({ id: V, citaOrigenEn: '2026-10-02T14:00:00.000Z' }); // 08:00 en México
const hito = (tipo: TipoHito) => hitoVacio({ id: 'h', tipo, viajeId: V });

/** Texto y plantilla DICEN LO MISMO: el chofer no nota por cuál canal le llegó. */
function coinciden(m: MensajeSaliente, sufijoDeBoton = '') {
  const p = plantillaDeCatalogo(m.plantilla.nombre);
  expect(p, m.plantilla.nombre).toBeDefined();
  expect(textoRenderizado(m.plantilla.nombre, m.plantilla.parametros ?? [])).toBe(m.texto);
  // Las variables que da el llamador son exactamente las del catálogo.
  expect((m.plantilla.parametros ?? []).length).toBe(variablesDeTexto(p!.cuerpo).length);
  // Los botones del texto y los de la plantilla llevan el MISMO payload.
  const rapidos = p!.botones.filter((b) => b.tipo === 'QUICK_REPLY');
  expect(m.botones.map((b) => b.id)).toEqual(rapidos.map((b) => `${(b as { payloadPrefijo: string }).payloadPrefijo}:${V}${sufijoDeBoton}`));
  expect(m.botones.map((b) => b.titulo)).toEqual(rapidos.map((b) => b.texto));
  // Los payloads que viajan en la plantilla son los del texto.
  expect((m.plantilla.botones ?? []).map((b) => (b as { payload: string }).payload)).toEqual(m.botones.map((b) => b.id));
  // Meta rechaza parámetros con saltos de línea o vacíos: ninguno lo trae.
  for (const x of m.plantilla.parametros ?? []) { expect(x.trim()).not.toBe(''); expect(x).not.toMatch(/[\n\t]/); }
  // Y el bloque de componentes se arma sin lanzar.
  expect(() => armarComponentesPlantilla({ parametros: m.plantilla.parametros, botones: m.plantilla.botones })).not.toThrow();
}

describe('las solicitudes de cada hito', () => {
  it.each(TIPOS_HITO)('«%s»: texto y plantilla coinciden, con los mismos botones', (tipo) => {
    coinciden(armarSolicitud(hito(tipo), viaje, AHORA));
  });

  it('la llegada a carga con cita dice la hora en México; sin cita usa la plantilla sin cita', () => {
    const con = armarSolicitud(hito('llegada_carga'), viaje, AHORA);
    expect(con.plantilla.nombre).toBe('conductor_solicitud_llegada_carga_v1');
    expect(con.texto).toContain('cita de carga en Planta Zapopan a las 08:00');
    const sin = armarSolicitud(hito('llegada_carga'), viajeBase({ id: V }), AHORA);
    expect(sin.plantilla.nombre).toBe('conductor_llegada_carga_sin_cita_v1');
    expect(sin.texto).not.toContain('cita');
    coinciden(sin);
  });

  it('usa la ETA si no hay cita, y la cita sobre la ETA', () => {
    const eta = armarSolicitud(hito('llegada_carga'), viajeBase({ id: V, etaOrigenEn: '2026-10-02T15:30:00.000Z' }), AHORA);
    expect(eta.texto).toContain('a las 09:30');
    const ambas = armarSolicitud(hito('llegada_carga'), viajeBase({ id: V, citaOrigenEn: '2026-10-02T14:00:00.000Z', etaOrigenEn: '2026-10-02T15:30:00.000Z' }), AHORA);
    expect(ambas.texto).toContain('a las 08:00');
  });

  it('una cita de otro día dice el día', () => {
    const m = armarSolicitud(hito('llegada_carga'), viajeBase({ id: V, citaOrigenEn: '2026-10-03T14:00:00.000Z' }), AHORA);
    expect(m.texto).toContain('08:00 del 03/10');
  });

  it('sin folio usa los 8 primeros del id; sin nombre dice «chofer»', () => {
    const m = armarSolicitud(hito('salida_carga'), viajeBase({ id: V, folio: null, operadorNombre: null }), AHORA);
    expect(m.texto).toContain(`viaje ${V.slice(0, 8)}`);
    expect(m.texto.startsWith('Hola chofer')).toBe(true);
    coinciden(m);
  });

  it('el nombre es solo el primero y no admite saltos de línea', () => {
    const m = armarSolicitud(hito('salida_carga'), viajeBase({ id: V, operadorNombre: 'Juan\nCarlos Pérez' }), AHORA);
    expect(m.texto.startsWith('Hola Juan,')).toBe(true);
    coinciden(m);
  });

  it('lugares largos se recortan', () => {
    const m = armarSolicitud(hito('llegada_descarga'), viajeBase({ id: V, destino: 'x'.repeat(300) }), AHORA);
    expect(m.texto.length).toBeLessThan(400);
    coinciden(m);
  });
});

describe('los recordatorios 1, 2 y 3', () => {
  it.each([1, 2, 3])('nivel %i: texto y plantilla coinciden', (n) => {
    const m = armarRecordatorio(hito('salida_carga'), viaje, n, 35);
    expect(m.plantilla.nombre).toBe(`conductor_recordatorio_${n}_v1`);
    // Los botones del recordatorio nombran SU hito: `<prefijo>:<viaje>:<hito>`.
    coinciden(m, ':salida_carga');
    expect(m.botones.map((b) => b.id)).toEqual([`recordatorio_registrar:${V}:salida_carga`, `recordatorio_problema:${V}:salida_carga`]);
  });

  it('del cuarto en adelante se queda en el tercero (el último aviso)', () => {
    expect(armarRecordatorio(hito('regreso'), viaje, 7, 50).plantilla.nombre).toBe('conductor_recordatorio_3_v1');
    expect(armarRecordatorio(hito('regreso'), viaje, 7, 50).botones[0].id).toBe(`recordatorio_registrar:${V}:regreso`);
  });

  it('dicen CUÁNTO lleva pendiente y cuál hito', () => {
    const m = armarRecordatorio(hito('llegada_descarga'), viaje, 2, 75);
    expect(m.texto).toContain('«tu llegada a descargar»');
    expect(m.texto).toContain('desde hace 1 hora y 15 minutos');
  });
});

describe('el aviso al jefe de tráfico', () => {
  it('nivel 1: texto y plantilla coinciden; trae el botón «Ya lo atiendo» con el viaje', () => {
    const m = armarEscalacion(hito('llegada_descarga'), viaje, 1, 'sin_respuesta', 4, 'hace 5 min: https://maps.google.com/?q=20.1,-103.2');
    expect(m.plantilla.nombre).toBe('aviso_jefe_trafico_v1');
    expect(m.botones).toEqual([{ id: `jefe_atiendo:${V}`, titulo: 'Ya lo atiendo' }]);
    coinciden(m);
    expect(m.texto).toContain('su llegada a descarga');
    expect(m.texto).toContain('sin respuesta a 4 avisos');
  });

  it('nivel 2 lo dice (nadie del patio lo atendió)', () => {
    const m = armarEscalacion(hito('regreso'), viaje, 2, 'sin_respuesta', 1, 'sin ubicación reciente');
    expect(m.texto.startsWith('Segundo aviso, nadie del patio lo atendió.')).toBe(true);
  });

  it('los motivos se dicen en palabras', () => {
    expect(armarEscalacion(hito('regreso'), viaje, 1, 'problema_reportado', 0, 'x').texto).toContain('el chofer reportó un problema');
    expect(armarEscalacion(hito('regreso'), viaje, 1, 'sin_telefono', 0, 'x').texto).toContain('no tiene teléfono registrado');
    expect(armarEscalacion(hito('regreso'), viaje, 1, 'sin_respuesta', 1, 'x').texto).toContain('sin respuesta a 1 aviso)');
  });
});

describe('el catálogo sigue siendo válido con las plantillas nuevas del Agente 5', () => {
  it('validarCatalogo() sin errores y con llamador declarado', () => {
    expect(validarCatalogo()).toEqual([]);
    for (const n of ['conductor_llegada_carga_sin_cita_v1', 'conductor_solicitud_regreso_v1']) {
      expect(plantillaDeCatalogo(n)?.llamador).toBe('src/lib/likida/conductor/ejecutor.ts');
    }
  });
});

describe('sin señal de vida (P2): el «¿sigues bien?» y el aviso al jefe', () => {
  it('el aviso al chofer: texto y plantilla coinciden, con los TRES botones del viaje, en los dos niveles y los dos motivos', () => {
    for (const nivel of [1, 2] as const) for (const motivo of ['gps_obsoleto', 'gps_detenido'] as const) {
      const m = armarSenalVida(viaje, nivel, motivo, 75);
      coinciden(m);
      expect(m.botones.map((b) => b.titulo)).toEqual(['Sí, estoy', 'Voy a cargar', 'Estoy bien']);
      expect(m.plantilla.nombre).toBe('conductor_senal_vida_v1');
    }
  });

  it('dice QUÉ se ve sin culpar, con el tiempo en palabras; el segundo aviso lo dice', () => {
    expect(armarSenalVida(viaje, 1, 'gps_obsoleto', 75).texto).toContain('no recibimos la señal del GPS de tu unidad desde hace 1 hora y 15 minutos');
    expect(armarSenalVida(viaje, 1, 'gps_detenido', 60).texto).toContain('tu unidad lleva 1 hora detenida fuera de un sitio');
    expect(armarSenalVida(viaje, 2, 'gps_obsoleto', 75).texto).toContain('segundo aviso: no recibimos');
    expect(armarSenalVida(viaje, 1, 'gps_obsoleto', 75).texto).not.toContain('segundo aviso');
  });

  it('el aviso al jefe: texto y plantilla coinciden, con «Ya lo atiendo» (el mismo botón del jefe) y la ubicación', () => {
    const m = armarEscalacionSenalVida(viaje, 'gps_obsoleto', 80, 'hace 70 min: https://maps.google.com/?q=20.70000,-103.40000');
    coinciden(m);
    expect(m.botones.map((b) => b.id)).toEqual([`jefe_atiendo:${V}`]);
    expect(m.texto).toContain('se le avisó dos veces sin respuesta');
    expect(m.texto).toContain('maps.google.com');
    expect(armarEscalacionSenalVida(viaje, 'gps_detenido', 90, 'x').texto).toContain('detenida fuera de un sitio');
  });

  it('el aviso al jefe cuenta lo que pasó con los avisos al chofer (rechazados no son «se le avisó»)', () => {
    expect(armarEscalacionSenalVida(viaje, 'gps_obsoleto', 80, 'x', 1).texto).toContain('solo se le pudo avisar una vez, sin respuesta');
    const cero = armarEscalacionSenalVida(viaje, 'gps_obsoleto', 80, 'x', 0);
    expect(cero.texto).toContain('no se le pudo avisar por WhatsApp');
    expect(cero.texto).not.toContain('avisó dos veces');
    coinciden(cero);
  });

  it('las dos plantillas nuevas están en el catálogo, declaran su llamador y el catálogo sigue válido', () => {
    expect(validarCatalogo()).toEqual([]);
    for (const n of ['conductor_senal_vida_v1', 'aviso_jefe_senal_vida_v1']) {
      expect(plantillaDeCatalogo(n)?.llamador).toBe('src/lib/likida/conductor/senal_vida.ts');
      expect(plantillaDeCatalogo(n)?.estado).toBe('nueva_para_aprobacion');
    }
  });
});
