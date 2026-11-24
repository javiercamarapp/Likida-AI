// ═══════════════════════════════════════════════════════════════════════════
// PLANTILLAS — los mensajes estructurados que el equipo de servicio al cliente manda siempre igual.
//
// Reglas de todas: una por servicio o caja; mismo orden siempre; ref y caja en la primera línea; SOLO datos confirmados que se pasan
// al `render` (nunca los inventa ni los completa); todo campo faltante sale como «pendiente de confirmar» (jamás vacío) y se devuelve
// en `camposFaltantes`. Los datos del operador (licencia, vigencia, celular) están ocultos por omisión: se muestran solo con
// `mostrarDatosOperador: true` (decisión de privacidad de la flota). Sin valores reales: aquí solo hay formas.
// `falta_dato` NUNCA se emite sin qué falta, a quién se avisó y el plazo en que se volverá a escribir.
// PURO: sin base, sin red, sin modelo.
// ═══════════════════════════════════════════════════════════════════════════
import { normalizar } from '../entrada';
import { CAMPOS_FICHA_OBLIGATORIOS_POR_OMISION, CAMPOS_QR_POR_OMISION, ESTADOS_PLANTA_POR_OMISION, FOTOS_SALIDA_POR_OMISION } from './reglas_cliente';

export const PLANTILLAS = [
  'ficha_unidad', 'eta_vigente', 'estatus_planta', 'colocacion_remolque', 'paquete_salida', 'confirmacion_programa', 'actualizacion_retraso',
  'falta_dato', 'prealerta', 'qr_acceso', 'aviso_repregunta', 'cuenta_espejo', 'estatus_cruce', 'detencion',
] as const;
export type IdPlantilla = (typeof PLANTILLAS)[number];

export const PENDIENTE = 'pendiente de confirmar';

export type DatosConfirmados = Readonly<Record<string, string | number | null | undefined>>;

export interface OpcionesRender {
  /** Mostrar licencia, vigencia y celular del operador. Por omisión false: ocultos (y ni se listan como faltantes). */
  mostrarDatosOperador?: boolean;
  /** La ficha lleva datos de segundo operador (tracto blindado o team). */
  requiereTeam?: boolean;
  /** La ficha lleva la caja quitapón (drops con quitapón). */
  requiereQuitapon?: boolean;
  /** Encabezado de actualización de una ficha ya enviada. */
  actualizacion?: { campo: string; de: string; a: string; motivo: string } | null;
  /** Campos que cuentan como obligatorios (por omisión, los de la ficha general). */
  camposObligatorios?: readonly string[];
  /** Catálogo de estados de planta aceptado (por omisión, los 6 estados). */
  estadosPlanta?: readonly string[];
  /** Campos del QR (por omisión, los 8 del formato general). */
  camposQr?: readonly string[];
  /** Fotos del paquete de salida (por omisión, la lista general). */
  fotosSalida?: readonly string[];
}

export interface ResultadoRender {
  plantilla: IdPlantilla;
  /** Texto listo para revisión humana, o null si la plantilla se bloquea (ver `bloqueo`). */
  texto: string | null;
  /** Todo campo que salió como «pendiente de confirmar». */
  camposFaltantes: string[];
  /** Subconjunto de `camposFaltantes` que bloquea la prealerta o el acceso. */
  obligatoriosFaltantes: string[];
  /** Campos sensibles que se omitieron por privacidad. */
  camposOcultos: string[];
  bloqueo: string | null;
}

export const CAMPOS_SENSIBLES: ReadonlySet<string> = new Set(['licencia', 'vigenciaLicencia', 'celular', 'teamLicencia', 'teamCelular']);

const FALTANTE = /^(pendiente|pendiente de confirmar|por confirmar|n\/?a|s\/?d|sin dato|-+|—+|\?+|x{2,}|null|undefined|tbd)$/i;

/** Un valor «presente» es un texto o número no vacío y que no sea un marcador de faltante. */
export function hayDato(v: unknown): boolean {
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v !== 'string') return false;
  const t = v.replace(/\s+/g, ' ').trim();
  return t.length > 0 && !FALTANTE.test(t);
}

class Contexto {
  readonly faltantes: string[] = [];
  readonly obligatorios: string[] = [];
  readonly ocultos: string[] = [];
  constructor(readonly d: DatosConfirmados, readonly o: OpcionesRender) {}
  private get oblig(): readonly string[] { return this.o.camposObligatorios ?? CAMPOS_FICHA_OBLIGATORIOS_POR_OMISION; }
  /** Valor del campo o «pendiente de confirmar». Los sensibles ocultos devuelven null (la línea se omite). */
  v(clave: string, opts: { sensible?: boolean } = {}): string | null {
    if ((opts.sensible || CAMPOS_SENSIBLES.has(clave)) && this.o.mostrarDatosOperador !== true) { if (!this.ocultos.includes(clave)) this.ocultos.push(clave); return null; }
    const x = this.d[clave];
    if (hayDato(x)) return String(x).replace(/\s+/g, ' ').trim();
    if (!this.faltantes.includes(clave)) this.faltantes.push(clave);
    if (this.oblig.includes(clave) && !this.obligatorios.includes(clave)) this.obligatorios.push(clave);
    return PENDIENTE;
  }
  /** Línea «Etiqueta: valor», o null si el campo es sensible y está oculto. */
  l(etiqueta: string, clave: string): string | null {
    const x = this.v(clave);
    return x === null ? null : `${etiqueta}: ${x}`;
  }
  tiene(clave: string): boolean { return hayDato(this.d[clave]); }
}

const unir = (xs: ReadonlyArray<string | null>): string => xs.filter((x): x is string => x !== null).join('\n');
const cab = (c: Contexto): string => `Ref: ${c.v('ref')} | Caja: ${c.v('linea')} ${c.v('numeroCaja')}`;

type Constructor = (c: Contexto) => string | { bloqueo: string };

const T: Record<IdPlantilla, Constructor> = {
  ficha_unidad: (c) => {
    const act = c.o.actualizacion;
    const lineas: Array<string | null> = [];
    if (act) lineas.push(`Actualización: ${act.campo}: de ${act.de} a ${act.a}; motivo ${act.motivo}.`);
    lineas.push(cab(c));
    lineas.push(`Línea: ${c.v('linea')}  Número: ${c.v('numeroCaja')}  Placas: ${c.v('placasCaja')}  Estado: ${c.v('estadoCaja')}`);
    lineas.push(`Unidad: ${c.v('eco')}  Placa: ${c.v('placaTracto')}`);
    lineas.push(`Operador: ${c.v('operadorNombre')}`);
    lineas.push(c.l('Licencia', 'licencia'), c.l('Vigencia', 'vigenciaLicencia'), c.l('Celular', 'celular'));
    if (c.o.requiereTeam) {
      lineas.push(`Team driver: ${c.v('teamNombre')}`, c.l('Licencia team', 'teamLicencia'), c.l('Celular team', 'teamCelular'));
    }
    if (c.o.requiereQuitapon) lineas.push(`Quitapón: ${c.v('quitapon')}`);
    lineas.push(`Sello: ${c.v('sello')}  Tracto: ${c.v('tipoTracto')}  Accesorios: ${c.v('accesorios')}`);
    lineas.push(`CE: ${c.v('cuentaEspejo')}`);
    lineas.push(`Cita: ${c.v('cita')}   ETA vigente a ${c.tiene('etaPunto') ? String(c.d.etaPunto) : 'planta o patio'}: ${c.v('eta')} (actualizado ${c.v('etaActualizado')})`);
    return unir(lineas);
  },
  eta_vigente: (c) => unir([
    `${c.v('ref')}/${c.v('numeroCaja')}: ETA a ${c.v('etaPunto')} ${c.v('eta')} (${c.v('zona')}), actualizado ${c.v('etaActualizado')}.`,
    `Última posición: ${c.v('posicion')} (${c.v('posicionHora')}).${c.tiene('causaCambio') ? ` Cambio vs ETA anterior ${c.v('etaAnterior')}: ${c.v('causaCambio')}.` : ''}`,
    `Próxima actualización a más tardar ${c.v('proximaActualizacion')}.`,
  ]),
  estatus_planta: (c) => {
    const cat = c.o.estadosPlanta ?? ESTADOS_PLANTA_POR_OMISION;
    const estado = c.tiene('estatus') ? String(c.d.estatus).trim() : null;
    if (estado !== null && !cat.includes(estado)) return { bloqueo: 'estado_fuera_de_catalogo' };
    return unir([
      `${c.v('planta')} | ${c.v('linea')} | ${c.v('numeroCaja')} | ${c.v('cita')} | ${c.v('eco')} | ${c.v('estatus')}`,
      `Ref: ${c.v('ref')}. Estado registrado a las ${c.v('estatusHora')} (fuente: ${c.v('estatusFuente')}).`,
    ]);
  },
  colocacion_remolque: (c) => unir([
    `Ref ${c.v('ref')}  Datos de la caja ${c.v('ordinal')}:`,
    `Línea: ${c.v('linea')} / Número: ${c.v('numeroCaja')} / Placas: ${c.v('placasCaja')} / Estado: ${c.v('estadoCaja')}`,
    c.tiene('colocadaHora') ? `Colocada a las ${c.v('colocadaHora')}.` : `Colocación estimada ${c.v('colocacionEstimada')} (${c.v('zona')}); confirmo cuando quede colocada.`,
  ]),
  paquete_salida: (c) => {
    const fotos = c.o.fotosSalida ?? FOTOS_SALIDA_POR_OMISION;
    const regs = String(c.d.fotosRegistradas ?? '').split(';').map((x) => normalizar(x)).filter(Boolean);
    const faltan = fotos.filter((f) => !regs.some((r) => r === normalizar(f)));
    for (const f of faltan) c.faltantes.push(`foto: ${f}`);
    return unir([
      cab(c),
      `Fotos registradas: ${fotos.length - faltan.length}/${fotos.length}.`,
      faltan.length ? `Falta: ${faltan.join('; ')}. Sin ellas el cliente rechaza (borrosa o sin número de caja).` : 'Checklist de fotos completo. La autorización de salida la da el cliente.',
    ]);
  },
  confirmacion_programa: (c) => unir([
    `Recibido programa ${c.v('fecha')}: ${c.v('totalServicios')} servicios:`,
    String(c.d.detalle ?? '').trim() || `${PENDIENTE}`,
    c.tiene('cambios') ? `Cambios vs versión anterior: ${c.v('cambios')}.` : null,
    `Disponibilidad y asignación: pendiente de confirmación de ${c.v('rol')}; te escribo a más tardar ${c.v('plazo')}.`,
  ]),
  actualizacion_retraso: (c) => unir([
    `${c.v('ref')}/${c.v('numeroCaja')}: se prevé llegada posterior a la cita de ${c.v('cita')}.`,
    `Causa confirmada: ${c.v('causa')} (fuente ${c.v('causaFuente')}, ${c.v('causaHora')}).`,
    `ETA a ${c.v('etaPunto')} vigente: ${c.v('eta')} (${c.v('zona')}).`,
    `Próxima actualización a más tardar ${c.v('proximaActualizacion')}. Contacto: ${c.v('rol')}.`,
  ]),
  falta_dato: (c) => {
    if (!c.tiene('dato')) return { bloqueo: 'sin_dato_que_nombrar' };
    if (!c.tiene('rol')) return { bloqueo: 'sin_rol_avisado' };
    if (!c.tiene('plazo')) return { bloqueo: 'sin_plazo' };
    return unir([
      `${c.v('dato')} de ${c.v('ref')}/${c.v('numeroCaja')} aún no está registrado.`,
      `Ya avisé a ${c.v('rol')}. Te escribo a más tardar ${c.v('plazo')} (antes si llega).`,
      c.tiene('confirmados') ? `Lo que sí está confirmado: ${c.v('confirmados')}.` : null,
    ]);
  },
  prealerta: (c) => unir([
    `Datos para prealerta ${c.v('ref')}/${c.v('numeroCaja')}: enviados ${c.v('enviadoHora')}.`,
    `Pendiente: ${c.tiene('pendiente') ? c.v('pendiente') : 'ninguno registrado'}. El sello se informa tras la línea de inspección; mantener estos datos sin cambios.`,
  ]),
  qr_acceso: (c) => {
    const campos = c.o.camposQr ?? CAMPOS_QR_POR_OMISION;
    const presentes: string[] = [];
    const pendientes: string[] = [];
    for (const k of campos) (c.tiene(k) ? presentes : pendientes).push(k);
    for (const k of pendientes) { c.faltantes.push(k); c.obligatorios.push(k); }
    return unir([
      `Datos para QR de ${c.v('ref')}: ${presentes.length}/${campos.length} campos.`,
      ...presentes.map((k) => `${k}: ${String(c.d[k]).replace(/\s+/g, ' ').trim()}`),
      pendientes.length ? `Pendientes: ${pendientes.join(', ')}; los envío apenas los tenga (a más tardar ${c.v('plazo')}).` : 'Datos completos; el QR lo genera el cliente.',
    ]);
  },
  aviso_repregunta: (c) => unir([
    `${c.v('cliente')}/${c.v('ref')}: ${c.v('cantidad')} solicitudes de ${c.v('tipo')} sin respuesta con dato desde ${c.v('desde')}.`,
    `Falta: ${c.v('dato')}. Nivel: ${c.v('nivel')}.`,
  ]),
  cuenta_espejo: (c) => `CE ${c.v('ref')}/${c.v('numeroCaja')}: ${c.v('enlace')}. Vigente hasta ${c.v('vigenteHasta')}. Última posición: ${c.v('posicion')} a las ${c.v('posicionHora')}.`,
  estatus_cruce: (c) => c.tiene('hito')
    ? `${c.v('numeroCaja')}/${c.v('ref')}: ${c.v('hito')} a las ${c.v('hitoHora')} (${c.v('fuente')}).`
    : `${c.v('numeroCaja')}/${c.v('ref')}: sin confirmación de cruce aún; consulté con ${c.v('rol')}; te escribo a más tardar ${c.v('plazo')}.`,
  detencion: (c) => `${c.v('numeroCaja')}: detenida ${c.v('minutos')} min en ${c.v('tramo')} (GPS ${c.v('gpsHora')}). Causa: ${c.tiene('causa') ? c.v('causa') : 'pendiente de confirmar por monitoreo'}. Avisé a ${c.v('rol')}; actualizo a las ${c.v('plazo')}.`,
};

/** Arma una plantilla SOLO con datos confirmados. Nunca inventa: lo que falta sale «pendiente de confirmar» y se lista. */
export function render(plantilla: IdPlantilla, datos: DatosConfirmados, opciones: OpcionesRender = {}): ResultadoRender {
  const c = new Contexto(datos ?? {}, opciones);
  const r = T[plantilla](c);
  const base = { plantilla, camposOcultos: [...c.ocultos] };
  if (typeof r !== 'string') return { ...base, texto: null, camposFaltantes: [], obligatoriosFaltantes: [], bloqueo: r.bloqueo };
  return { ...base, texto: r, camposFaltantes: [...c.faltantes], obligatoriosFaltantes: [...new Set(c.obligatorios)], bloqueo: null };
}

const FRASES_VACIAS = /\b(reviso|revisando|revisamos|valido|validamos|en breve|ya casi|lo estoy trabajando|lo estamos trabajando|dame oportunidad|disculpa la tardanza|en un momento|ahorita te digo)\b/;

export interface RevisionAcuse { ok: boolean; motivos: Array<'frase_vacia' | 'sin_plazo' | 'sin_rol'> }

/**
 * Política anti-«reviso»: un acuse al cliente debe decir qué falta, a quién se avisó y un plazo (hora). Sin hora, o con una frase vacía
 * y sin hora, no sale. Es una prueba de forma sobre un borrador, no un juicio de contenido.
 */
export function revisarAcuse(texto: string): RevisionAcuse {
  const n = normalizar(texto ?? '');
  const motivos: RevisionAcuse['motivos'] = [];
  const hayHora = /\b\d{1,2}[:.]\d{2}\b/.test(texto ?? '');
  if (FRASES_VACIAS.test(n) && !hayHora) motivos.push('frase_vacia');
  if (!hayHora) motivos.push('sin_plazo');
  if (!/\b(avis[eé]|aviso a|avisado a|ya avise|paso a|consult[eé] con)\b/.test(n.replace(/é/g, 'e'))) motivos.push('sin_rol');
  return { ok: motivos.length === 0, motivos };
}
