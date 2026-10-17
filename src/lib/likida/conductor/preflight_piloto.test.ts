import { describe, expect, it } from 'vitest';
import { CONFIG_CONDUCTOR_DEFAULT } from './config';
import { plantillasRequeridas } from './plantillas_requeridas';
import {
  PORCENTAJE_MINIMO_CON_SITIO, evaluarPreflight, mensajeBloqueoSenalVida, type DatosPreflight, type IdComprobacion, type ViajeDelPiloto,
} from './preflight_piloto';

// T-A5-25: cada comprobación del preflight en rojo POR SEPARADO, y todo en verde. Datos sintéticos.
const TODAS = plantillasRequeridas({ ...CONFIG_CONDUCTOR_DEFAULT, avisarSenalVida: true });
const viaje = (n: number, extra: Partial<ViajeDelPiloto> = {}): ViajeDelPiloto => ({ terminalId: 'p1', unidadId: `u${n}`, conSitio: true, ...extra });
const verde = (): DatosPreflight => ({
  config: { activo: true, perfilSeguimiento: 'esenciales', solicitudesMin: [0, 15, 30, 45], cohortePiloto: 'sin_tableta_ni_macros' },
  zonaDeclarada: 'America/Mexico_City',
  voluntarios: [{ telefono: '3312345678' }], // grep-limpio:ok
  viajes: [viaje(1), viaje(2), viaje(3)],
  posicionesPorUnidad: { u1: { ultimas2h: 12, ultimaHora: 6 }, u2: { ultimas2h: 12, ultimaHora: 6 }, u3: { ultimas2h: 12, ultimaHora: 6 } },
  contactos: [{ nombre: 'Patio', telefono: '523312345678', nivel: 1, terminalId: 'p1' }], // grep-limpio:ok
  aprobadas: TODAS,
});
const faltas = (d: DatosPreflight): IdComprobacion[] => evaluarPreflight(d).bloqueos.map((b) => b.id);

describe('preflight del piloto', () => {
  it('todo verde: nueve comprobaciones en orden, sin bloqueos y lista', () => {
    const r = evaluarPreflight(verde());
    expect(r.comprobaciones.map((c) => c.id)).toEqual(['activo', 'zona', 'cohorte', 'voluntarios', 'sitios', 'gps_unidades', 'calidad_gps', 'escalamiento', 'plantillas']);
    expect(r.bloqueos).toEqual([]);
    expect(r.lista).toBe(true);
    expect(r.comprobaciones.every((c) => c.queHacer === null)).toBe(true);
    expect(mensajeBloqueoSenalVida(r)).toBe('');
  });

  it('rojo 1: sin voluntarios con teléfono válido (ninguno, o solo inválidos/demo)', () => {
    for (const voluntarios of [[], [{ telefono: '123' }], [{ telefono: '2899912345' }, { telefono: '' }]]) {
      expect(faltas({ ...verde(), voluntarios })).toEqual(['voluntarios']);
    }
    expect(faltas({ ...verde(), voluntarios: [{ telefono: '523312345678' }] })).toEqual([]); // grep-limpio:ok
  });

  it('rojo 2: una unidad del piloto sin posición en las últimas 2 h, o ningún viaje con unidad', () => {
    const sinUna = { ...verde(), posicionesPorUnidad: { ...verde().posicionesPorUnidad, u3: { ultimas2h: 0, ultimaHora: 0 } } };
    const r = evaluarPreflight(sinUna);
    expect(r.bloqueos.map((b) => b.id)).toContain('gps_unidades');
    expect(r.bloqueos.find((b) => b.id === 'gps_unidades')).toMatchObject({ detalle: '2 de 3 unidades del piloto mandaron posición.' });
    expect(r.bloqueos.find((b) => b.id === 'gps_unidades')!.queHacer).toContain('Sin GPS conectado: las llegadas y salidas por geocerca no están activas. Se siguen pidiendo por WhatsApp.');
    expect(faltas({ ...verde(), viajes: [viaje(1, { unidadId: null }), viaje(2, { unidadId: null }), viaje(3, { unidadId: null })] })).toContain('gps_unidades');
  });

  it('rojo 3: viajes con sitio por debajo del umbral, o sin viajes', () => {
    const justo = Array.from({ length: 10 }, (_, i) => viaje(i, { conSitio: i < 8 }));
    const pos = Object.fromEntries(justo.map((v) => [v.unidadId as string, { ultimas2h: 5, ultimaHora: 3 }]));
    expect(PORCENTAJE_MINIMO_CON_SITIO).toBe(80);
    expect(faltas({ ...verde(), viajes: justo, posicionesPorUnidad: pos })).toEqual([]);   // 80 % exacto pasa
    const bajo = justo.map((v, i) => ({ ...v, conSitio: i < 7 }));
    expect(faltas({ ...verde(), viajes: bajo, posicionesPorUnidad: pos })).toEqual(['sitios']);
    expect(faltas({ ...verde(), viajes: [], posicionesPorUnidad: {} })).toContain('sitios');
  });

  it('rojo 4: patio con viajes sin contacto de nivel 1 (uno de toda la flota lo cubre; uno de nivel 2 no)', () => {
    expect(faltas({ ...verde(), contactos: [] })).toEqual(['escalamiento']);
    expect(faltas({ ...verde(), contactos: [{ nombre: 'Otro', telefono: '523312345678', nivel: 1, terminalId: 'p2' }] })).toEqual(['escalamiento']); // grep-limpio:ok
    expect(faltas({ ...verde(), contactos: [{ nombre: 'Jefe', telefono: '523312345678', nivel: 2, terminalId: 'p1' }] })).toEqual(['escalamiento']); // grep-limpio:ok
    expect(faltas({ ...verde(), contactos: [{ nombre: 'Flota', telefono: '523312345678', nivel: 1, terminalId: null }] })).toEqual([]); // grep-limpio:ok
    const sinPatio = { ...verde(), viajes: [viaje(1, { terminalId: null }), viaje(2), viaje(3)] };
    expect(faltas(sinPatio)).toEqual(['escalamiento']);   // el viaje sin patio necesita contacto de flota
  });

  it('rojo 5: plantillas sin aprobar (con la lista vacía de hoy) y con la señal de vida exigida aunque aún esté apagada', () => {
    expect(faltas({ ...verde(), aprobadas: [] })).toEqual(['plantillas']);
    const sinSenal = TODAS.filter((n) => !n.includes('senal_vida'));
    const r = evaluarPreflight({ ...verde(), aprobadas: sinSenal });
    expect(r.bloqueos).toHaveLength(1);
    expect(r.bloqueos[0].detalle).toContain('Faltan por aprobar 2 de');
  });

  it('rojo 9 (T-A5-64): sin cohorte definida no se enciende nada; con cualquier cohorte del catálogo, en verde', () => {
    for (const cohortePiloto of [undefined, null]) {
      const d = { ...verde(), config: { ...verde().config, cohortePiloto } };
      expect(faltas(d), String(cohortePiloto)).toEqual(['cohorte']);
      const c = evaluarPreflight(d).bloqueos[0];
      expect(c.queHacer).toContain('docs/operacion/cohorte-piloto.md');
    }
    for (const cohortePiloto of ['sin_tableta_ni_macros', 'voluntarios_abiertos'] as const) {
      expect(faltas({ ...verde(), config: { ...verde().config, cohortePiloto } })).toEqual([]);
    }
    const sin = evaluarPreflight({ ...verde(), config: { ...verde().config, cohortePiloto: undefined } });
    expect(mensajeBloqueoSenalVida(sin)).toContain('falta «cohorte del piloto definida»');
  });

  it('rojo 6: agente apagado', () => {
    expect(faltas({ ...verde(), config: { ...verde().config, activo: false } })).toEqual(['activo']);
  });

  it('rojo 7: zona horaria sin definir o inválida', () => {
    for (const zonaDeclarada of [null, '', '   ', 'Marte/Olimpo']) expect(faltas({ ...verde(), zonaDeclarada }), String(zonaDeclarada)).toEqual(['zona']);
  });

  it('rojo 8: GPS que trae eventos y no posiciones continuas, o muy pocas unidades para medirlo', () => {
    const eventos = { u1: { ultimas2h: 1, ultimaHora: 1 }, u2: { ultimas2h: 1, ultimaHora: 1 }, u3: { ultimas2h: 1, ultimaHora: 0 } };
    const r = evaluarPreflight({ ...verde(), posicionesPorUnidad: eventos });
    expect(r.bloqueos.map((b) => b.id)).toEqual(['calidad_gps']);
    expect(r.bloqueos[0].queHacer).toContain('solo eventos');
    expect(faltas({ ...verde(), viajes: [viaje(1), viaje(2)] })).toEqual(['calidad_gps']);
  });

  it('el mensaje de rechazo nombra lo primero que falta y cuántas más hay', () => {
    const uno = evaluarPreflight({ ...verde(), config: { ...verde().config, activo: false } });
    expect(mensajeBloqueoSenalVida(uno)).toBe('Aún no se puede encender: falta «agente encendido para la flota». Enciéndelo en «Estado del agente» antes de activar la señal de vida.');
    const varios = evaluarPreflight({ ...verde(), config: { ...verde().config, activo: false }, zonaDeclarada: null, contactos: [] });
    expect(mensajeBloqueoSenalVida(varios)).toContain('(y 2 cosas más');
    expect(mensajeBloqueoSenalVida(varios).startsWith('Aún no se puede encender: falta')).toBe(true);
  });

  it('no incluye teléfonos ni nombres en ninguna frase', () => {
    const r = evaluarPreflight({ ...verde(), contactos: [], voluntarios: [{ telefono: '5533334444' }] }); // grep-limpio:ok
    const texto = JSON.stringify(r);
    expect(texto).not.toMatch(/\d{10}/);
    expect(texto).not.toContain('Patio');
  });
});
