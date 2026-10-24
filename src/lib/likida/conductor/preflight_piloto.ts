import { normalizarTelefonoWa } from '../wa_ventana';
import { esTelefonoDemo } from '@/lib/meta/telefono_demo';
import { zonaValida } from '../conectores/tabla_propia/tiempo';
import { AVISO_SOLO_EVENTOS, UMBRALES_CALIDAD_POR_OMISION } from '../conectores/tabla_propia/calidad';
import type { ConfigConductor } from './config';
import type { ContactoTrafico } from './escalamiento';
import { APROBADAS, compararConAprobadas, plantillasDelCicloPorPerfil, plantillasRequeridas, type PerfilPlantillas } from './plantillas_requeridas';

// ═══════════════════════════════════════════════════════════════════════════
// PREFLIGHT DEL PILOTO (T-A5-25) — «¿está lista la flota?». Puro: sin I/O y sin mandar nada. Los datos los lee
// `leerDatosPreflight` (repo.ts); aquí solo se juzgan.
//
// `avisarSenalVida` nace APAGADO a propósito: manda mensajes a personas. Encenderlo sin GPS, sin sitios o sin plantillas
// aprobadas es pedirle al chofer «¿sigues bien?» sin poder verificarlo, o que el agente calle fuera de la ventana de 24 h.
// Por eso encenderlo pasa por esta compuerta (`guardarConfigDelPanel`). Y no se promete geocerca real sin tablas GPS:
// cada comprobación dice en palabras llanas qué falta y qué hacer.
//
// Los umbrales de abajo son SUPUESTOS (no mediciones del cliente); la continuidad del GPS reutiliza los de T-A5-15.
// ═══════════════════════════════════════════════════════════════════════════

/** % mínimo de viajes en seguimiento con sitio (origen y destino) para dar por buena la geocerca. SUPUESTO. */
export const PORCENTAJE_MINIMO_CON_SITIO = 80;
/** Horas hacia atrás en que una unidad del piloto debe haber mandado al menos una posición. */
export const HORAS_GPS_RECIENTE = 2;

export type IdComprobacion =
  | 'voluntarios' | 'cohorte' | 'gps_unidades' | 'sitios' | 'escalamiento' | 'plantillas' | 'activo' | 'zona' | 'calidad_gps';

export interface Comprobacion {
  id: IdComprobacion;
  titulo: string;
  estado: 'ok' | 'falta';
  /** Lo que se midió, en una frase. */
  detalle: string;
  /** Qué hacer, en palabras llanas; `null` si está en orden. */
  queHacer: string | null;
}

export interface ResultadoPreflight {
  comprobaciones: Comprobacion[];
  /** Las que están en rojo: con una sola, no se enciende la señal de vida. */
  bloqueos: Comprobacion[];
  lista: boolean;
}

/** Un viaje abierto y aceptado de un voluntario (el piloto solo sigue a voluntarios). */
export interface ViajeDelPiloto {
  terminalId: string | null;
  unidadId: string | null;
  /** Origen Y destino con sitio asignado. */
  conSitio: boolean;
}

export interface DatosPreflight {
  config: Pick<ConfigConductor, 'activo' | 'perfilSeguimiento' | 'solicitudesMin' | 'cohortePiloto'>;
  /** `tenant.zona_horaria` tal como está guardada (sin sustituir por la de México). */
  zonaDeclarada: string | null;
  voluntarios: ReadonlyArray<{ telefono: string }>;
  viajes: readonly ViajeDelPiloto[];
  /** Posiciones de cada unidad del piloto: en las últimas 2 h y en la última hora. Unidad sin entrada = ninguna. */
  posicionesPorUnidad: Readonly<Record<string, { ultimas2h: number; ultimaHora: number }>>;
  contactos: readonly ContactoTrafico[];
  /** A37-S36-07: perfil de la flota para exigir también las plantillas del ciclo N01-N12 (P0; con `cinco_agentes`, también P1). Sin él, solo las de config. */
  perfilPlantillas?: PerfilPlantillas;
  /** Por omisión, `APROBADAS` (la lista que Javier actualiza cuando Meta aprueba). */
  aprobadas?: readonly string[];
}

/** Móvil mexicano de 10 dígitos (con o sin 52) y nunca la marca de demo: la misma regla del alta de voluntarios. */
export function telefonoAlcanzable(telefono: string): boolean {
  if (esTelefonoDemo(telefono)) return false;
  const d = normalizarTelefonoWa(telefono);
  return /^52\d{10}$/.test(/^\d{10}$/.test(d) ? `52${d}` : d);
}

const ok = (id: IdComprobacion, titulo: string, detalle: string): Comprobacion => ({ id, titulo, estado: 'ok', detalle, queHacer: null });
const falta = (id: IdComprobacion, titulo: string, detalle: string, queHacer: string): Comprobacion => ({ id, titulo, estado: 'falta', detalle, queHacer });

const plural = (n: number, uno: string, varios: string): string => `${n} ${n === 1 ? uno : varios}`;

function comprobarVoluntarios(d: DatosPreflight): Comprobacion {
  const t = 'Operadores voluntarios con teléfono válido';
  const validos = d.voluntarios.filter((v) => telefonoAlcanzable(v.telefono)).length;
  if (validos >= 1) return ok('voluntarios', t, `${plural(validos, 'operador', 'operadores')} en el piloto con teléfono que WhatsApp puede alcanzar.`);
  return falta('voluntarios', t,
    d.voluntarios.length === 0 ? 'Todavía no hay operadores en el piloto.' : 'Ningún operador del piloto tiene un teléfono que WhatsApp pueda alcanzar.',
    'Agrega al menos un operador voluntario con su celular de 10 dígitos en «Operadores del piloto».');
}

function comprobarCohorte(d: DatosPreflight): Comprobacion {
  const t = 'Cohorte del piloto definida';
  const c = d.config.cohortePiloto;
  if (c === 'sin_tableta_ni_macros' || c === 'voluntarios_abiertos') {
    return ok('cohorte', t, c === 'sin_tableta_ni_macros' ? 'Cohorte: unidades sin tableta ni macros.' : 'Cohorte: voluntarios de cualquier unidad.');
  }
  return falta('cohorte', t, 'Todavía no se definió con quién arranca el piloto.',
    'Define la cohorte del piloto (criterio y preguntas pendientes en docs/operacion/cohorte-piloto.md); sin cohorte no se enciende nada.');
}

function comprobarGpsUnidades(d: DatosPreflight): Comprobacion {
  const t = `Unidades del piloto con GPS en las últimas ${HORAS_GPS_RECIENTE} h`;
  const unidades = [...new Set(d.viajes.map((v) => v.unidadId).filter((u): u is string => u !== null))];
  const conGps = unidades.filter((u) => (d.posicionesPorUnidad[u]?.ultimas2h ?? 0) >= 1).length;
  if (unidades.length > 0 && conGps === unidades.length) return ok('gps_unidades', t, `Las ${plural(unidades.length, 'unidad', 'unidades')} del piloto mandaron posición.`);
  return falta('gps_unidades', t,
    unidades.length === 0 ? 'Ningún viaje en seguimiento trae unidad asignada.' : `${conGps} de ${unidades.length} unidades del piloto mandaron posición.`,
    'Sin GPS conectado: las llegadas y salidas por geocerca no están activas. Se siguen pidiendo por WhatsApp. Conecta la tabla de GPS y asigna la unidad a los viajes del piloto.');
}

function comprobarSitios(d: DatosPreflight): Comprobacion {
  const t = 'Viajes en seguimiento con sitio asignado';
  if (d.viajes.length === 0) {
    return falta('sitios', t, 'No hay viajes de operadores del piloto en seguimiento.', 'Carga o acepta viajes de los operadores voluntarios para poder medir si traen sitio.');
  }
  const con = d.viajes.filter((v) => v.conSitio).length;
  const pct = Math.round((con / d.viajes.length) * 100);
  if (pct >= PORCENTAJE_MINIMO_CON_SITIO) return ok('sitios', t, `${pct} % de los viajes en seguimiento tienen origen y destino con sitio.`);
  return falta('sitios', t, `Solo ${pct} % de los viajes en seguimiento tienen origen y destino con sitio (se pide ${PORCENTAJE_MINIMO_CON_SITIO} %).`,
    'Asigna sitio a los viajes que no lo traen, desde el tablero o con la pantalla de equivalencias de sitios.');
}

function comprobarEscalamiento(d: DatosPreflight): Comprobacion {
  const t = 'Contacto de escalamiento por terminal';
  const nivel1 = d.contactos.filter((c) => c.nivel === 1);
  const delaFlota = nivel1.some((c) => c.terminalId === null);
  const terminales = [...new Set(d.viajes.map((v) => v.terminalId))];
  const sinContacto = terminales.filter((tid) => !delaFlota && (tid === null || !nivel1.some((c) => c.terminalId === tid))).length;
  if (nivel1.length > 0 && (terminales.length === 0 || sinContacto === 0)) return ok('escalamiento', t, 'Cada patio con viajes en seguimiento tiene a quién avisar.');
  return falta('escalamiento', t,
    nivel1.length === 0 ? 'No hay ningún contacto de nivel 1 configurado.' : `${plural(sinContacto, 'patio con viajes', 'patios con viajes')} sin contacto de nivel 1.`,
    'Agrega, en «Contactos de escalamiento», un contacto de nivel 1 para cada patio (o uno para toda la flota).');
}

function comprobarPlantillas(d: DatosPreflight): Comprobacion {
  const t = 'Plantillas de Meta aprobadas';
  // La compuerta es para ENCENDER la señal de vida: se exigen también sus dos plantillas.
  // A37-S36-07: además, las del ciclo con botones que exige el perfil (estadía, caja cargada, evidencia...): sin ellas el agente calla fuera de las 24 h.
  const requeridas = [...new Set([...plantillasRequeridas({ ...d.config, avisarSenalVida: true }), ...(d.perfilPlantillas ? plantillasDelCicloPorPerfil(d.perfilPlantillas) : [])])];
  const c = compararConAprobadas(requeridas, d.aprobadas ?? APROBADAS);
  if (c.lista) return ok('plantillas', t, `Las ${c.requeridas.length} plantillas necesarias están aprobadas.`);
  return falta('plantillas', t, `Faltan por aprobar ${c.faltantes.length} de ${c.requeridas.length} plantillas (${c.faltantes.join(', ')}): fuera de la ventana de 24 h el agente calla.`,
    'Pide a Likida que someta a Meta las plantillas faltantes (la lista está en docs/operacion/plantillas-meta.md) y espera su aprobación.');
}

function comprobarActivo(d: DatosPreflight): Comprobacion {
  const t = 'Agente encendido para la flota';
  if (d.config.activo) return ok('activo', t, 'El agente está encendido.');
  return falta('activo', t, 'El agente está apagado para esta flota.', 'Enciéndelo en «Estado del agente» antes de activar la señal de vida.');
}

function comprobarZona(d: DatosPreflight): Comprobacion {
  const t = 'Zona horaria de la flota';
  const z = d.zonaDeclarada;
  if (z !== null && z.trim() !== '' && zonaValida(z)) return ok('zona', t, `Zona definida: ${z}.`);
  return falta('zona', t, z === null || z.trim() === '' ? 'La flota no tiene zona horaria definida.' : 'La zona horaria de la flota no es válida.',
    'Define la zona horaria de la flota (por ejemplo America/Mexico_City): de ella dependen la ventana de insistencia y las horas que se le leen al chofer.');
}

function comprobarCalidadGps(d: DatosPreflight): Comprobacion {
  const t = 'Calidad de la fuente GPS';
  const u = UMBRALES_CALIDAD_POR_OMISION;
  const unidades = [...new Set(d.viajes.map((v) => v.unidadId).filter((x): x is string => x !== null))];
  if (unidades.length < u.unidadesMinimas) {
    return falta('calidad_gps', t, `Hay ${plural(unidades.length, 'unidad', 'unidades')} con viaje en seguimiento; se necesitan al menos ${u.unidadesMinimas} para medir si el GPS es continuo.`,
      'Suma unidades al piloto o espera a tener más viajes en seguimiento; mientras tanto no se puede asegurar que el GPS traiga posiciones continuas.');
  }
  const buenas = unidades.filter((x) => (d.posicionesPorUnidad[x]?.ultimaHora ?? 0) >= u.posicionesMinimas).length;
  const pct = Math.round((buenas / unidades.length) * 1_000) / 10;
  if (pct >= u.porcentajeMinimo) return ok('calidad_gps', t, `${pct} % de las unidades manda posiciones continuas.`);
  return falta('calidad_gps', t, `Solo ${pct} % de las unidades manda posiciones continuas en la última hora.`, `${AVISO_SOLO_EVENTOS} Pide a la fuente de GPS posiciones continuas, no solo eventos.`);
}

/** Las 9 comprobaciones, en el orden en que se le explican al dueño. */
export function evaluarPreflight(d: DatosPreflight): ResultadoPreflight {
  const comprobaciones = [
    comprobarActivo(d), comprobarZona(d), comprobarCohorte(d), comprobarVoluntarios(d), comprobarSitios(d),
    comprobarGpsUnidades(d), comprobarCalidadGps(d), comprobarEscalamiento(d), comprobarPlantillas(d),
  ];
  const bloqueos = comprobaciones.filter((c) => c.estado === 'falta');
  return { comprobaciones, bloqueos, lista: bloqueos.length === 0 };
}

/** El rechazo al encender la señal de vida con bloqueos: dice la primera que falta y cuántas más hay. */
export function mensajeBloqueoSenalVida(r: ResultadoPreflight): string {
  const [primero, ...resto] = r.bloqueos;
  if (!primero) return '';
  const mas = resto.length === 0 ? '' : ` (y ${plural(resto.length, 'cosa más', 'cosas más')}; míralas en «¿Está lista la flota?»)`;
  return `Aún no se puede encender: falta «${primero.titulo.toLowerCase()}». ${primero.queHacer ?? ''}${mas}`.trim();
}
