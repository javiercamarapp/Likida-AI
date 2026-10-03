import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CONFIG_CONDUCTOR_DEFAULT } from '@/lib/likida/conductor/config';
import { hitoVacio } from '@/lib/likida/conductor/memoria.fixture';
import type { DatosTablero, ViajeTablero } from '@/lib/likida/conductor/repo_validacion';
import { armarTablero, episodiosVista, indicadoresVista } from '@/lib/likida/conductor/tablero';
import type { HitoFila, TipoHito } from '@/lib/likida/conductor/tipos';
import { TableroHitos, type FiltrosVista } from './tablero-hitos';

const AHORA = new Date('2026-10-02T18:00:00.000Z');
const hace = (min: number) => new Date(AHORA.getTime() - min * 60_000).toISOString();
const cfg = { ...CONFIG_CONDUCTOR_DEFAULT, solicitudesMin: [...CONFIG_CONDUCTOR_DEFAULT.solicitudesMin], diasSemana: [...CONFIG_CONDUCTOR_DEFAULT.diasSemana] };
const accion = async () => null;

const V = (id: string, p: Partial<ViajeTablero> = {}): ViajeTablero => ({
  id, folio: `F-${id}`, origen: 'Zapopan', destino: 'Monterrey', estatus: 'abierto', operadorId: `o${id}`, operadorNombre: `Chofer ${id}`, terminalId: 'tm1',
  terminalNombre: 'Tlaquepaque', clienteId: 'c1', clienteNombre: 'Cliente A', unidadId: null, aceptadoEn: hace(600), citaOrigenEn: null, citaDestinoEn: null,
  etaOrigenEn: null, etaDestinoEn: null, origenSitioId: null, destinoSitioId: null, ...p,
});
function H(viajeId: string, e: Partial<Record<TipoHito, string | Partial<HitoFila>>>): HitoFila[] {
  return (['llegada_carga', 'salida_carga', 'llegada_descarga', 'salida_descarga', 'regreso'] as TipoHito[]).map((tipo) => {
    const x = e[tipo];
    const extra: Partial<HitoFila> = typeof x === 'string' ? { estado: 'recibido', fuente: 'texto', mensajeEn: x, recibidoEn: x } : (x ?? {});
    return hitoVacio({ id: `${viajeId}-${tipo}`, tipo, viajeId, ...extra });
  });
}
const FILTROS: FiltrosVista = { terminalId: '', clienteId: '', operadorId: '', semaforo: '', dias: 7 };
const IND = indicadoresVista({ recibidos: 40, sinInsistencia: 30, conRespuestaMedida: 25, minutosRespuestaPromedio: 12.4, escalados: 3, omitidos: 0, validadosUbicacion: 20, sinCoincidencia: 1, capturadosOficina: 0 });

function pintar(datos: DatosTablero, o: { puedeActuar?: boolean; ind?: ReturnType<typeof indicadoresVista> | null; filtros?: FiltrosVista; episodios?: ReturnType<typeof episodiosVista> | null } = {}) {
  return renderToStaticMarkup(
    <TableroHitos
      tablero={armarTablero(datos, cfg, AHORA)} indicadores={o.ind === undefined ? IND : o.ind} dias={7} filtros={o.filtros ?? FILTROS}
      catalogos={{ terminales: [{ id: 'tm1', nombre: 'Tlaquepaque' }], clientes: [{ id: 'c1', nombre: 'Cliente A' }], operadores: [{ id: 'o1', nombre: 'Chofer 1' }] }}
      ocultos={{ tenant: 't-9' }} accionUrl="/dashboard/agentes/conductores" puedeActuar={o.puedeActuar ?? true} accion={accion}
      accionSitios={accion} sitios={[{ id: 's1', nombre: 'Planta Zapopan', tipo: 'planta' }]} episodios={o.episodios}
    />,
  );
}
const datos = (viajes: ViajeTablero[], hitos: HitoFila[], extra: Partial<DatosTablero> = {}): DatosTablero => ({ viajes, hayMas: false, hitos, veredictos: [], evidencias: [], acciones: [], sitios: new Map(), ...extra });

describe('el tablero de hitos — los episodios de «sin señal de vida» se LISTAN en pantalla', () => {
  const ep = { id: 'e1', viajeId: 'v1', folio: 'F-77', operador: 'Juan Pérez', motivo: 'gps_obsoleto' as const, abiertoEn: hace(90), nivelEnviado: 3 as const, aviso1En: hace(89), aviso2En: hace(69), escaladoEn: hace(49), cerradoEn: null, cierreMotivo: null, respuesta: null };

  it('lista cada episodio con folio, chofer, motivo, la cadena de avisos y dónde va; uno cerrado dice cómo terminó', () => {
    const html = pintar(datos([], []), { episodios: episodiosVista([ep, { ...ep, id: 'e2', folio: 'F-78', nivelEnviado: 1, aviso2En: null, escaladoEn: null, cerradoEn: hace(10), cierreMotivo: 'respondio', respuesta: 'estoy' }]) });
    expect(html).toContain('Sin señal de vida');
    expect(html).toContain('F-77');
    expect(html).toContain('Juan Pérez');
    expect(html).toContain('GPS sin reportar');
    expect(html).toContain('Primer aviso al chofer');
    expect(html).toContain('Segundo aviso al chofer');
    expect(html).toContain('Aviso al jefe de tráfico');
    expect(html).toContain('Escalado al jefe de tráfico, sigue sin atenderse');
    expect(html).toContain('F-78');
    expect(html).toContain('El chofer respondió: «Sí, estoy»');
  });

  it('sin episodios lo dice (no pinta un hueco); sin poder leerlos lo dice; una vista que no los trae no pinta la sección', () => {
    expect(pintar(datos([], []), { episodios: [] })).toContain('Ningún tractor quedó sin señal de vida en los últimos 7 días');
    expect(pintar(datos([], []), { episodios: null })).toContain('No se pudieron leer los episodios');
    expect(pintar(datos([], []))).not.toContain('Sin señal de vida');
  });
});

describe('el tablero de hitos — por qué un hito está omitido (R10-8)', () => {
  it('omitido porque avisó el siguiente: «avisó el siguiente»; omitido porque el barrido cerró un viaje abierto 30+ días: lo dice y dice que se puede capturar', () => {
    const inferido = pintar(datos([V('1')], H('1', { llegada_carga: { estado: 'omitido', omitidoMotivo: 'inferido_por_salida_carga' }, salida_carga: hace(200) })));
    expect(inferido).toContain('omitido (avisó el siguiente)');
    expect(inferido).not.toContain('más de 30 días');
    const vencido = pintar(datos([V('2')], H('2', { llegada_carga: { estado: 'omitido', omitidoMotivo: 'viaje_abierto_vencido', escaladoEn: hace(5000) } })));
    expect(vencido).toContain('el viaje lleva más de 30 días abierto y ya se había escalado');
    expect(vencido).toContain('captúralo a mano');
    expect(vencido).not.toContain('omitido (avisó el siguiente)');
  });
});

describe('el tablero de hitos — lo que ve el jefe de tráfico', () => {
  it('pinta el semáforo con conteos, los 5 hitos de cada viaje y la hora del mensaje', () => {
    const html = pintar(datos([V('1')], H('1', { llegada_carga: hace(300), salida_carga: hace(240) })));
    expect(html).toContain('Viajes en curso');
    for (const etiqueta of ['llegada a carga', 'salida de carga', 'llegada a descarga', 'salida de descarga', 'regreso']) expect(html).toContain(etiqueta);
    expect(html).toContain('Hora del mensaje del chofer');
    expect(html).toContain('F-1');
    expect(html).toContain('Tlaquepaque');
  });

  it('los indicadores dicen su base: tasa sin insistencia, tiempo medio y escalados', () => {
    const html = pintar(datos([], []));
    expect(html).toContain('Hitos reportados sin insistencia');
    expect(html).toContain('75%');
    expect(html).toContain('de 40 hitos');
    expect(html).toContain('Tiempo medio de respuesta');
    expect(html).toContain('12 min');
    expect(html).toContain('Hitos escalados');
    expect(html).toContain('últimos 7 días');
  });

  it('un indicador SIN datos dice «sin datos», nunca 0', () => {
    const html = pintar(datos([], []), { ind: indicadoresVista({ recibidos: 0, sinInsistencia: 0, conRespuestaMedida: 0, minutosRespuestaPromedio: null, escalados: 0, omitidos: 0, validadosUbicacion: 0, sinCoincidencia: 0, capturadosOficina: 0 }) });
    expect(html).toContain('sin datos');
    expect(html).toContain('ningún hito recibido en el periodo');
    expect(html).not.toContain('0%');
  });

  it('si los indicadores no se pudieron leer lo dice (no pinta ceros)', () => {
    expect(pintar(datos([], []), { ind: null })).toContain('No se pudieron calcular los indicadores');
  });

  it('la cola de excepciones muestra el escalado urgente primero con sus acciones (atender y capturar)', () => {
    const html = pintar(datos([V('1')], H('1', { llegada_carga: { estado: 'escalado', escaladoEn: hace(10), escalacionNivel: 1 } })));
    expect(html).toContain('Cola de excepciones');
    expect(html).toContain('Urgente');
    expect(html).toContain('Escalado sin atender');
    expect(html).toContain('Marcar atendido');
    expect(html).toContain('Capturar a mano');
    expect(html).toContain('Hora del hito (hora de México)');
    expect(html).toContain('queda en la bitácora con tu nombre');
  });

  it('SIN permiso de actuar no se ofrece ninguna acción (y el servidor igual las rechaza)', () => {
    const html = pintar(datos([V('1')], H('1', { llegada_carga: { estado: 'escalado', escaladoEn: hace(10), escalacionNivel: 1 } })), { puedeActuar: false });
    expect(html).toContain('Escalado sin atender');
    expect(html).not.toContain('Marcar atendido');
    expect(html).not.toContain('Capturar a mano');
    expect(html).not.toContain('Validar</summary>');
  });

  it('un hito recibido ofrece VALIDAR; uno pendiente ofrece CAPTURAR', () => {
    const html = pintar(datos([V('1', { citaOrigenEn: new Date(AHORA.getTime() + 3_600_000).toISOString() })], H('1', { llegada_carga: hace(30) })));
    expect(html).toContain('Validar');
    expect(html).toContain('Capturar a mano');
  });

  it('sin coincidencia sale en la cola con la explicación que no acusa', () => {
    const veredictos = [{ hitoId: '1-llegada_carga', ciclo: 1, resultado: 'sin_coincidencia' as const, motivo: null, fuente: 'gps' as const, distanciaM: 900, radioM: 300, toleranciaM: 150, sitioId: 's1', medidaEn: hace(30) }];
    const html = pintar(datos([V('1', { origenSitioId: 's1' })], H('1', { llegada_carga: hace(30) }), { veredictos, sitios: new Map([['s1', 'Planta Zapopan']]) }));
    expect(html).toContain('Ubicación sin coincidencia');
    expect(html).toContain('revísalo antes de dar por mala la llegada');
    expect(html).toContain('fuera del sitio (900 m)');
    expect(html).toContain('Planta Zapopan');
  });

  it('la validación positiva y la evidencia fotográfica se ven en la línea de tiempo', () => {
    const veredictos = [{ hitoId: '1-llegada_carga', ciclo: 1, resultado: 'validado' as const, motivo: null, fuente: 'pin' as const, distanciaM: 40, radioM: 300, toleranciaM: 150, sitioId: null, medidaEn: hace(30) }];
    const evidencias = [{ id: 'e', hitoId: '1-llegada_carga', ciclo: 1, tipo: 'anden' as const, ruta: 'x', creadaEn: hace(29) }];
    const html = pintar(datos([V('1')], H('1', { llegada_carga: { estado: 'validado', fuente: 'texto', mensajeEn: hace(30), recibidoEn: hace(30), validadoEn: hace(29), validadoPor: 'gps' } }), { veredictos, evidencias }));
    expect(html).toContain('en el sitio (40 m)');
    expect(html).toContain('validado (ubicación)');
  });

  it('una captura de oficina muestra quién y por qué', () => {
    const acciones = [{ hitoId: '1-salida_carga', viajeId: '1', accion: 'captura_manual' as const, usuarioEmail: 'jefe@flota.mx', motivo: 'avisó por radio', horaDeclarada: hace(100), creadaEn: hace(90) }];
    const html = pintar(datos([V('1')], H('1', { llegada_carga: hace(200), salida_carga: { estado: 'recibido', fuente: 'oficina', mensajeEn: hace(100), recibidoEn: hace(90) } }), { acciones }));
    expect(html).toContain('jefe@flota.mx');
    expect(html).toContain('avisó por radio');
    expect(html).toContain('vía oficina');
  });

  it('sin sitios asignados lo dice (las llegadas no se pueden validar) y ofrece asignarlos con el catálogo', () => {
    const html = pintar(datos([V('1')], H('1', {})));
    expect(html).toContain('Sin sitios asignados');
    expect(html).toContain('Asignar sitios');
    expect(html).toContain('Sitio de carga');
    expect(html).toContain('Planta Zapopan');
    expect(html).toContain('Quitar el sitio');
  });

  it('SIN permiso de actuar tampoco se ofrece asignar sitios', () => {
    expect(pintar(datos([V('1')], H('1', {})), { puedeActuar: false })).not.toContain('Asignar sitios');
  });

  it('las fotos de evidencia se abren con GET /v1/evidencias/{id} (enlace de corta vida), una por papel', () => {
    const evidencias = [
      { id: '4f1f6e2e-95c1-4c52-9f9e-3f6f6bd8d0e1', hitoId: '1-salida_carga', ciclo: 1, tipo: 'sello' as const, ruta: 'x', creadaEn: hace(10) },
      { id: '4f1f6e2e-95c1-4c52-9f9e-3f6f6bd8d0e2', hitoId: '1-salida_carga', ciclo: 1, tipo: 'otra' as const, ruta: null, creadaEn: hace(9) },
    ];
    const html = pintar(datos([V('1')], H('1', { llegada_carga: hace(100), salida_carga: hace(50) }), { evidencias }));
    expect(html).toContain('href="/api/v1/evidencias/4f1f6e2e-95c1-4c52-9f9e-3f6f6bd8d0e1"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toContain('d0e2'); // la purgada (sin ruta) no se ofrece
  });

  it('los filtros: patio, cliente, chofer, semáforo y periodo; y conservan el tenant de la vista de superadmin', () => {
    const html = pintar(datos([V('1')], H('1', {})));
    for (const n of ['name="terminal"', 'name="cliente"', 'name="chofer"', 'name="semaforo"', 'name="dias"']) expect(html).toContain(n);
    expect(html).toContain('type="hidden" name="tenant" value="t-9"');
    expect(html).toContain('Chofer 1');
  });

  it('con filtros activos ofrece «Quitar filtros» y un vacío que dice que son los filtros', () => {
    const html = pintar(datos([], []), { filtros: { ...FILTROS, terminalId: 'tm1' } });
    expect(html).toContain('Quitar filtros');
    expect(html).toContain('Ningún viaje en curso cumple esos filtros');
  });

  it('sin viajes y sin filtros dice qué falta (no un tablero vacío mudo)', () => {
    expect(pintar(datos([], []))).toContain('No hay viajes aceptados en curso');
  });

  it('cuando hay más viajes que el tope lo declara', () => {
    expect(pintar(datos([V('1')], H('1', {}), { hayMas: true }))).toContain('Hay más viajes en curso de los que este tablero lista');
  });

  it('el motivo y los minutos del hito vencido salen en palabras', () => {
    const html = pintar(datos([V('1', { aceptadoEn: hace(120 + 100) })], H('1', {})));
    expect(html).toContain('Sin reporte');
    expect(html).toContain('sin reporte');
  });
});

// El código fuente de las pantallas, como texto (sin tocar el disco con rutas armadas a mano).
const FUENTES = {
  ...import.meta.glob('./*.tsx', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('./sitios/*.tsx', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('./estadias/*.tsx', { query: '?raw', import: 'default', eager: true }),
} as Record<string, string>;

describe('CERO pesos en la pantalla del jefe de tráfico (área operación)', () => {
  const pantallas = Object.entries(FUENTES).filter(([ruta]) => !ruta.includes('.test.'));

  it('se está escaneando el código de TODAS las pantallas nuevas (no una lista vacía)', () => {
    const nombres = pantallas.map(([ruta]) => ruta);
    for (const esperado of ['./tablero-hitos.tsx', './acciones-forma.tsx', './sitios/vista.tsx', './sitios/formas.tsx', './estadias/vista.tsx']) {
      expect(nombres, `falta ${esperado}`).toContain(esperado);
    }
  });

  it.each(pantallas.map(([ruta]) => ruta))('%s no formatea dinero', (ruta) => {
    expect(FUENTES[ruta]).not.toMatch(/\bmxn\(|\busd\(|formato="mxn"|formato="usd"/);
    // Las VISTAS tampoco reciben los campos de dinero (la página solo arma un resumen vacío para cumplir el tipo).
    if (!ruta.endsWith('page.tsx')) expect(FUENTES[ruta]).not.toMatch(/montoPropuesto|tarifaHora/);
  });
});
