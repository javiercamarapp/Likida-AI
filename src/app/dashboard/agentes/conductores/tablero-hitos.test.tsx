import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CONFIG_CONDUCTOR_DEFAULT } from '@/lib/likida/conductor/config';
import { hitoVacio } from '@/lib/likida/conductor/memoria.fixture';
import type { DatosTablero, ViajeTablero } from '@/lib/likida/conductor/repo_validacion';
import { armarTablero, episodiosVista, esFolioSimulado, indicadoresVista } from '@/lib/likida/conductor/tablero';
import type { HitoFila, TipoHito } from '@/lib/likida/conductor/tipos';
import { TableroHitos, TEXTO_SIN_GPS, TEXTO_SIN_TELEFONO, TEXTO_SIN_VIAJES, type FiltrosVista } from './tablero-hitos';

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
const IND = indicadoresVista({
  recibidos: 40, sinInsistencia: 30, conRespuestaMedida: 25, minutosRespuestaPromedio: 12.4, escalados: 3, omitidos: 0, validadosUbicacion: 20, sinCoincidencia: 1, capturadosOficina: 0,
  llegadasValidables: 22, validacionDegradada: 2,
});

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
    // T-A5 (0853): 2 de 22 llegadas validables en modo degradado = 9%.
    expect(html).toContain('Validación en modo degradado');
    expect(html).toContain('9%');
    expect(html).toContain('2 de 22 llegadas');
  });

  it('un indicador SIN datos dice «sin datos», nunca 0', () => {
    const html = pintar(datos([], []), {
      ind: indicadoresVista({
        recibidos: 0, sinInsistencia: 0, conRespuestaMedida: 0, minutosRespuestaPromedio: null, escalados: 0, omitidos: 0, validadosUbicacion: 0, sinCoincidencia: 0, capturadosOficina: 0,
        llegadasValidables: 0, validacionDegradada: 0,
      }),
    });
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
    const evidencias = [{ id: 'e', hitoId: '1-llegada_carga', ciclo: 1, tipo: 'anden' as const, ruta: 'x', creadaEn: hace(29), reusoTenant: false }];
    const html = pintar(datos([V('1')], H('1', { llegada_carga: { estado: 'validado', fuente: 'texto', mensajeEn: hace(30), recibidoEn: hace(30), validadoEn: hace(29), validadoPor: 'gps' } }), { veredictos, evidencias }));
    expect(html).toContain('en el sitio (40 m)');
    expect(html).toContain('validado (ubicación)');
  });

  it('T-A5 (0852): una foto marcada como reuso entre viajes se ve con alerta', () => {
    const evidencias = [{ id: 'e', hitoId: '1-llegada_carga', ciclo: 1, tipo: 'anden' as const, ruta: 'x', creadaEn: hace(29), reusoTenant: true }];
    const html = pintar(datos([V('1')], H('1', { llegada_carga: hace(30) }), { evidencias }));
    expect(html).toContain('OTRO viaje/hito de la flota');
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
      { id: '4f1f6e2e-95c1-4c52-9f9e-3f6f6bd8d0e1', hitoId: '1-salida_carga', ciclo: 1, tipo: 'sello' as const, ruta: 'x', creadaEn: hace(10), reusoTenant: false },
      { id: '4f1f6e2e-95c1-4c52-9f9e-3f6f6bd8d0e2', hitoId: '1-salida_carga', ciclo: 1, tipo: 'otra' as const, ruta: null, creadaEn: hace(9), reusoTenant: false },
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
    expect(pintar(datos([], []))).toContain(TEXTO_SIN_VIAJES);
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

describe('el tablero de hitos — «dónde está» en cada tarjeta (T-A5-11)', () => {
  const pos = new Map([['u1', { lat: 20.02878, lng: -103.0, medidaEn: hace(12), fuente: 'gps' as const }]]);
  const extra = { sitiosCoords: new Map([['s1', { nombre: 'Planta Norte', lat: 20.0, lng: -103.0 }]]), posiciones: pos };

  it('pinta la última posición con la antigüedad y el sitio', () => {
    const html = pintar(datos([V('1', { unidadId: 'u1', origenSitioId: 's1' })], H('1', {}), extra));
    expect(html).toContain('Última posición: hace 12 min · a 3.2 km de Planta Norte');
  });

  it('sin posición dice que el GPS no ha reportado', () => {
    const html = pintar(datos([V('1', { unidadId: 'u1' })], H('1', {}), { posiciones: new Map() }));
    expect(html).toContain('Sin posición reciente (el GPS de esta unidad no ha reportado)');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// T-A5-26: estados vacíos y errores en lenguaje llano.
// ═══════════════════════════════════════════════════════════════════════════
describe('el tablero de hitos — estados vacíos y avisos en lenguaje llano (T-A5-26)', () => {
  it('estado 1, sin viajes en seguimiento: la frase exacta que dice qué hacer', () => {
    expect(TEXTO_SIN_VIAJES).toBe('Todavía no hay viajes en seguimiento. Marca operadores en Configuración y sube sus viajes.');
    expect(pintar(datos([], []))).toContain('Todavía no hay viajes en seguimiento. Marca operadores en Configuración y sube sus viajes.');
  });

  it('estado 2, sin GPS: lo dice solo si se LEYERON las posiciones y no hay ninguna; si no se leyeron, no afirma nada', () => {
    const frase = 'Sin GPS conectado: las llegadas por geocerca no están activas (se siguen pidiendo por WhatsApp).';
    expect(TEXTO_SIN_GPS).toBe(frase);
    expect(pintar(datos([V('1', { unidadId: 'u1' })], H('1', {}), { posiciones: new Map() }))).toContain(frase);
    expect(pintar(datos([V('1', { unidadId: 'u1' })], H('1', {})))).not.toContain('Sin GPS conectado');
    const conPosicion = new Map([['u1', { lat: 20.6, lng: -103.3, medidaEn: hace(5), fuente: 'gps' as const }]]);
    expect(pintar(datos([V('1', { unidadId: 'u1' })], H('1', {}), { posiciones: conPosicion }))).not.toContain('Sin GPS conectado');
    // Sin viajes tampoco se acusa de «sin GPS»: ahí manda el estado 1.
    expect(pintar(datos([], [], { posiciones: new Map() }))).not.toContain('Sin GPS conectado');
  });

  it('estado 3, operador sin teléfono: se dice en su viaje; con teléfono o sin dato no se dice', () => {
    expect(TEXTO_SIN_TELEFONO).toBe('Este operador no tiene teléfono: no se le puede escribir; se avisará al jefe.');
    expect(pintar(datos([V('1', { operadorSinTelefono: true })], H('1', {})))).toContain('Este operador no tiene teléfono: no se le puede escribir; se avisará al jefe.');
    expect(pintar(datos([V('2', { operadorSinTelefono: false })], H('2', {})))).not.toContain('no tiene teléfono');
    expect(pintar(datos([V('3')], H('3', {})))).not.toContain('no tiene teléfono');
  });

  it('estado 4, datos de demostración (folio DEMO-): rotulados SIMULADO; los reales no', () => {
    const html = pintar(datos([V('1', { folio: 'DEMO-24001' }), V('2', { folio: 'F-2' })], [...H('1', {}), ...H('2', {})]));
    expect(html.match(/SIMULADO/g)?.length).toBe(1);
    expect(html).toMatch(/DEMO-24001<\/span><span[^>]*>SIMULADO/);
  });

  it('el prefijo anterior de los folios de demostración se sigue reconociendo como simulado', () => {
    expect(esFolioSimulado(['IN', 'N-24001'].join(''))).toBe(true);
    expect(esFolioSimulado('DEMO-24001')).toBe(true);
    expect(esFolioSimulado('F-2')).toBe(false);
  });

  it('ningún texto técnico llega a la pantalla: ni nombres de columna, ni códigos con guion bajo, ni uuid', () => {
    const uuid = '3f2b8c1e-5d4a-4b6f-9a7e-1c2d3e4f5a6b';
    const viajes = [V(uuid, { folio: null, operadorNombre: 'Chofer Uno', operadorSinTelefono: true, aceptadoEn: hace(300) }), V('2')];
    const hitos = [
      ...H(uuid, { llegada_carga: { estado: 'omitido', omitidoMotivo: 'viaje_abierto_vencido', escaladoEn: hace(5000) }, salida_carga: { estado: 'validado', fuente: 'sistema', validadoPor: 'gps', mensajeEn: hace(100), recibidoEn: hace(100) } }),
      ...H('2', { llegada_carga: hace(300), salida_carga: { estado: 'recibido', fuente: 'oficina', mensajeEn: hace(200), recibidoEn: hace(200) } }),
    ];
    const html = pintar(datos(viajes, hitos, { posiciones: new Map() }), {
      episodios: episodiosVista([{ id: 'e1', viajeId: 'v1', folio: 'F-77', operador: 'Juan Pérez', motivo: 'gps_detenido', abiertoEn: hace(90), nivelEnviado: 2, aviso1En: hace(89), aviso2En: hace(69), escaladoEn: null, cerradoEn: null, cierreMotivo: null, respuesta: null }]),
    });
    // Texto visible = fuera de etiquetas (los atributos name/value de formularios no se leen como texto).
    // Sin regexp de filtrado HTML: se recorre el marcado con indexOf; el contenido de <script> no es texto visible.
    const bajo = html.toLowerCase();
    let visible = '';
    let i = 0;
    while (i < html.length) {
      const abre = html.indexOf('<', i);
      if (abre < 0) { visible += html.slice(i); break; }
      visible += `${html.slice(i, abre)} `;
      if (bajo.startsWith('<script', abre)) {
        const cierre = bajo.indexOf('</script', abre);
        const finCierre = cierre < 0 ? -1 : html.indexOf('>', cierre);
        i = finCierre < 0 ? html.length : finCierre + 1;
      } else {
        const cierra = html.indexOf('>', abre);
        i = cierra < 0 ? html.length : cierra + 1;
      }
    }
    const internos = [/aceptado_en/, /aceptado_origen/, /[a-z]{2,}_[a-z_]{2,}/, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i, /\bundefined\b/, /\bnull\b/, /\bNaN\b/, /\[object/];
    for (const re of internos) expect(visible, String(re)).not.toMatch(re);
    // El uuid tampoco se cuela en la etiqueta accesible.
    expect(html).not.toContain(`Viaje ${uuid}`);
  });
});

describe('el tablero de hitos — estados de frontera (T-A5-21)', () => {
  const t7h = new Map([['1', { estado: 'en_patio' as const, textoOrigen: 'PATIO NLD', actualizadoEn: hace(7 * 60) }]]);
  const armar = (c: Partial<typeof cfg>, transito: DatosTablero['transito']) =>
    armarTablero(datos([V('1')], H('1', {}), { transito }), { ...cfg, ...c }, AHORA);
  const html = (t: ReturnType<typeof armarTablero>) => renderToStaticMarkup(
    <TableroHitos
      tablero={t} indicadores={IND} dias={7} filtros={FILTROS}
      catalogos={{ terminales: [], clientes: [], operadores: [] }}
      ocultos={{ tenant: 't-9' }} accionUrl="/dashboard/agentes/conductores" puedeActuar accion={accion}
      accionSitios={accion} sitios={[]}
    />,
  );

  it('casilla encendida: la fila muestra «En patio NLD desde hace 7 h»', () => {
    const h = html(armar({ mostrarEstadosFrontera: true }, t7h));
    expect(h).toContain('Tránsito:');
    expect(h).toContain('En patio NLD desde hace 7 h');
  });

  it('casilla apagada: la columna se oculta aunque el dato exista', () => {
    const h = html(armar({ mostrarEstadosFrontera: false }, t7h));
    expect(h).not.toContain('Tránsito:');
    expect(h).not.toContain('En patio NLD');
  });

  it('pendiente_cruce largo con umbral: aparece en la cola de excepciones con etiqueta propia', () => {
    const t = new Map([['1', { estado: 'pendiente_cruce' as const, textoOrigen: 'PEND CRUCE', actualizadoEn: hace(7 * 60) }]]);
    const h = html(armar({ mostrarEstadosFrontera: true, umbralPendienteCruceH: 6 }, t));
    expect(h).toContain('Pendiente de cruce por mucho tiempo');
    expect(h).toContain('Es solo lectura');
  });
});

describe('el tablero de hitos — reubicaciones por cliente (T-A5-63)', () => {
  const base = () => armarTablero({ viajes: [V('1')], hayMas: false, hitos: H('1', {}), veredictos: [], evidencias: [], acciones: [], sitios: new Map() }, cfg, AHORA);
  const html = (t: ReturnType<typeof armarTablero>) => renderToStaticMarkup(
    <TableroHitos tablero={t} indicadores={IND} dias={7} filtros={FILTROS} catalogos={null} ocultos={{}} accionUrl="/x" puedeActuar={false} accion={accion} accionSitios={accion} sitios={[]} />,
  );

  it('sin el cálculo compuesto (perilla apagada o bitácora ilegible) no se pinta la sección', () => {
    expect(html(base())).not.toContain('Reubicaciones por cliente');
  });

  it('con datos: reubicaciones y minutos por cliente y el enlace de descarga', () => {
    const t = { ...base(), reubicaciones: {
      porCliente: [{ clienteId: 'c1', clienteNombre: 'Cliente A', viajes: 2, viajesConDato: 2, viajesReubicados: 1, reubicaciones: 3, minutos: 95 }],
      csv: 'folio\nF-1\n',
    } };
    const h = html(t);
    expect(h).toContain('Reubicaciones por cliente');
    expect(h).toContain('Cliente A');
    expect(h).toContain('3');
    expect(h).toContain('95');
    expect(h).toContain('Descargar evidencia (CSV)');
  });

  it('un cliente sin ninguna respuesta dice «Sin dato», no cero, y no ofrece CSV', () => {
    const t = { ...base(), reubicaciones: {
      porCliente: [{ clienteId: 'c1', clienteNombre: 'Cliente A', viajes: 1, viajesConDato: 0, viajesReubicados: null, reubicaciones: null, minutos: null }],
      csv: '',
    } };
    const h = html(t);
    expect(h).toContain('Sin dato');
    expect(h).not.toContain('Descargar evidencia');
  });
});
