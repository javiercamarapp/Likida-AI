// ═══════════════════════════════════════════════════════════════════════════
// BORRADOR FINAL DE LA FICHA DE UNIDAD — el texto que una persona del equipo revisa y envía.
//
// El agente NO escribe al cliente: esto es un BORRADOR. Reglas:
//   · Solo se escribe lo PRESENTE. Un campo ausente no sale en el texto (nada de «pendiente» ni de relleno); se lista en `faltantes`.
//   · Nunca se inventa placa, licencia, sello, ETA ni estatus. El ETA solo sale si trae punto (planta/patio) y hora de actualización.
//   · Licencia, vigencia y celular del operador: solo con `mostrarDatosOperador: true` (por omisión false); al omitirlos, el texto lo dice.
//   · Sin promesas de hora, sin autorización de salida, sin «reviso/validando»: todas las frases fijas están aquí y son declarativas.
//   · `advertencias` sale de las validaciones V01-V21/P01 (`validarFicha`); sus mensajes nunca repiten placas, licencias ni celulares.
//   · `listo` es true solo si `validarFicha` no devuelve bloqueos Y no falta ningún campo obligatorio Y el estatus (si viene) es del catálogo.
// PURO: sin base, sin red, sin reloj (la fecha de referencia entra por `entrada.ahora`).
// ═══════════════════════════════════════════════════════════════════════════
import { validarFicha } from '../validaciones';
import type { ConfigValidaciones, ContextoValidacion, FichaValidable } from '../validaciones';
import { hayDato } from './plantillas';
import { CAMPOS_FICHA_OBLIGATORIOS_POR_OMISION, ESTADOS_PLANTA_POR_OMISION } from './reglas_cliente';

export interface EtaBorrador {
  /** ISO `AAAA-MM-DDTHH:MM` del ETA vigente (el último publicado por una persona autorizada; el agente no lo calcula). */
  valor?: string | null;
  /** A qué punto aplica el ETA. Sin punto no se publica. */
  punto?: 'planta' | 'patio' | null;
  /** ISO `AAAA-MM-DDTHH:MM` de la hora en que se publicó o actualizó. Sin ella no se publica. */
  actualizadoEn?: string | null;
  zona?: string | null;
}

export interface EntradaFicha {
  /** Referencia del servicio. Es lo único indispensable: sin ella no hay ficha. */
  ref: string;
  planta?: string | null;
  cita?: string | null;
  linea?: string | null;
  numeroCaja?: string | null;
  placasCaja?: string | null;
  estadoCaja?: string | null;
  eco?: string | null;
  placaTracto?: string | null;
  operadorNombre?: string | null;
  licencia?: string | null;
  vigenciaLicencia?: string | null;
  celular?: string | null;
  teamNombre?: string | null;
  cuentaEspejo?: string | null;
  eta?: EtaBorrador | null;
  /** Uno de los 6 estados del catálogo de planta. */
  estatusPlanta?: string | null;
}

export interface OpcionesBorrador {
  /** Incluir licencia, vigencia y celular. Por omisión false. */
  mostrarDatosOperador?: boolean;
  /** Tracto blindado o con team: el nombre del team deja de ser opcional. */
  requiereTeam?: boolean;
  /** Fecha/hora de referencia ISO (`AAAA-MM-DDTHH:MM`) para las validaciones. Sin ella, las validaciones bloquean. */
  ahora?: string;
  /** Contexto extra para las validaciones (catálogos, destinatario, lista blanca…). `ahora` se toma de arriba. */
  contexto?: Omit<Partial<ContextoValidacion>, 'ahora'>;
  config?: Partial<ConfigValidaciones>;
  /** Catálogo de estados de planta aceptado (por omisión, los 6 estados). */
  estadosPlanta?: readonly string[];
}

export interface BorradorFicha {
  /** Texto del borrador con SOLO los datos presentes. Nunca vacío: siempre trae al menos el encabezado con la referencia. */
  texto: string;
  /** Datos que no se tienen (claves de `EntradaFicha`, más `eta_vigente` y similares). Nunca se rellenan. */
  faltantes: string[];
  /** Hallazgos de las validaciones y avisos propios, con id y severidad. */
  advertencias: string[];
  listo: boolean;
}

const ETIQUETA_FALTANTE: Readonly<Record<string, string>> = {
  planta: 'planta', cita: 'cita', linea: 'línea', numeroCaja: 'número de caja', placasCaja: 'placas de la caja', estadoCaja: 'estado de la caja',
  eco: 'económico', placaTracto: 'placa de la unidad', operadorNombre: 'operador', teamNombre: 'team', cuentaEspejo: 'cuenta espejo',
  eta_vigente: 'ETA vigente', eta_punto: 'punto del ETA (planta o patio)', eta_actualizado_en: 'hora de actualización del ETA', estatusPlanta: 'estatus de planta',
  licencia: 'licencia', vigenciaLicencia: 'vigencia de la licencia', celular: 'celular', ref: 'referencia',
};
export { ETIQUETA_FALTANTE as ETIQUETAS_FALTANTES_FICHA };

const limpia = (v: unknown): string => String(v).replace(/\s+/g, ' ').trim();
const dato = (v: unknown): string | null => (hayDato(v) ? limpia(v) : null);
const iso = (v: string): string => v.replace('T', ' ');

function aFichaValidable(e: EntradaFicha, eta: { valor: string; punto: 'planta' | 'patio'; actualizadoEn: string } | null, zona: string | null): FichaValidable {
  const f: FichaValidable = { ref: e.ref };
  const pon = <T extends object>(o: T): T | undefined => (Object.values(o).some((x) => x !== undefined) ? o : undefined);
  const s = (v: unknown): string | undefined => dato(v) ?? undefined;
  if (s(e.cita)) f.cita = s(e.cita);
  const caja = pon({ linea: s(e.linea), numero: s(e.numeroCaja), placas: s(e.placasCaja), estado: s(e.estadoCaja) });
  if (caja) f.caja = caja;
  const unidad = pon({ eco: s(e.eco), placa: s(e.placaTracto) });
  if (unidad) f.unidad = unidad;
  const operador = pon({ nombre: s(e.operadorNombre), licencia: s(e.licencia), vigenciaLicencia: s(e.vigenciaLicencia), celular: s(e.celular) });
  if (operador) f.operador = operador;
  if (s(e.teamNombre)) f.team = { nombre: s(e.teamNombre) };
  if (s(e.cuentaEspejo)) f.ce = { url: s(e.cuentaEspejo) };
  if (s(e.planta)) f.planta = s(e.planta);
  if (eta) f.eta = { valor: eta.valor, punto: eta.punto, actualizadoEn: eta.actualizadoEn, ...(zona ? { zona } : {}) };
  return f;
}

/** Arma el borrador de la ficha de unidad. Pura y total: no lanza; ante datos ausentes lo dice, no los inventa. */
export function armarBorradorFicha(entrada: EntradaFicha, opciones: OpcionesBorrador = {}): BorradorFicha {
  const e = (entrada ?? {}) as EntradaFicha;
  const mostrar = opciones.mostrarDatosOperador === true;
  const faltantes: string[] = [];
  const advertencias: string[] = [];
  const ref = dato(e.ref);
  const falta = (k: string): void => { if (!faltantes.includes(k)) faltantes.push(k); };
  if (ref === null) falta('ref');

  // ── ETA: solo se publica completo (valor + punto + hora de actualización) ──
  const etaIn = e.eta ?? null;
  const etaValor = dato(etaIn?.valor);
  const etaPunto = etaIn?.punto === 'planta' || etaIn?.punto === 'patio' ? etaIn.punto : null;
  const etaAct = dato(etaIn?.actualizadoEn);
  const zona = dato(etaIn?.zona);
  const etaCompleto = etaValor !== null && etaPunto !== null && etaAct !== null;
  if (etaValor === null) falta('eta_vigente');
  else {
    if (etaPunto === null) falta('eta_punto');
    if (etaAct === null) falta('eta_actualizado_en');
    if (!etaCompleto) advertencias.push('ETA: se omitió del borrador porque no trae punto y hora de actualización; sin ellos no es un ETA vigente.');
  }

  // ── Estatus de planta: solo uno del catálogo ──
  const estatus = dato(e.estatusPlanta);
  const catalogo = opciones.estadosPlanta ?? ESTADOS_PLANTA_POR_OMISION;
  const estatusValido = estatus !== null && catalogo.includes(estatus);
  if (estatus === null) falta('estatusPlanta');
  else if (!estatusValido) advertencias.push('Estatus de planta: el valor no está en el catálogo de estados; se omitió del borrador.');

  // ── Líneas del texto: solo lo presente ──
  const lineas: string[] = [];
  lineas.push(`Ficha de unidad${ref ? ` | Ref: ${ref}` : ''} (borrador para revisión; no enviar sin que lo revise una persona)`);
  const hay = (k: keyof EntradaFicha): string | null => dato(e[k]);
  const unir = (xs: ReadonlyArray<readonly [string, string | null]>): string => xs.filter((p): p is readonly [string, string] => p[1] !== null).map(([et, v]) => `${et}: ${v}`).join('  ');
  const par = (x: string): void => { if (x) lineas.push(x); };

  par(unir([['Planta', hay('planta')], ['Cita', (() => { const c = hay('cita'); return c ? iso(c) : null; })()]]));
  par(unir([['Línea', hay('linea')], ['Número', hay('numeroCaja')], ['Placas', hay('placasCaja')], ['Estado', hay('estadoCaja')]]));
  par(unir([['Unidad', hay('eco')], ['Placa', hay('placaTracto')]]));
  par(unir([['Operador', hay('operadorNombre')]]));
  if (mostrar) {
    par(unir([['Licencia', hay('licencia')], ['Vigencia', hay('vigenciaLicencia')], ['Celular', hay('celular')]]));
  } else {
    lineas.push('Datos del operador (licencia, vigencia y celular): omitidos por privacidad; no van en este borrador.');
  }
  par(unir([['Team driver', hay('teamNombre')]]));
  par(unir([['CE', hay('cuentaEspejo')]]));
  if (etaCompleto) {
    lineas.push(`ETA vigente a ${etaPunto}: ${iso(etaValor)}${zona ? ` (${zona})` : ''}, actualizado ${iso(etaAct)}.`);
  }
  if (estatusValido) lineas.push(`Estatus en planta: ${estatus}.`);

  // ── Faltantes (sin inventar). Los sensibles ocultos no se listan: se omiten a propósito. ──
  const opcionales: ReadonlyArray<keyof EntradaFicha> = ['planta', 'cuentaEspejo'];
  const obligatorios = CAMPOS_FICHA_OBLIGATORIOS_POR_OMISION.filter((k) => k !== 'ref') as ReadonlyArray<keyof EntradaFicha>;
  const obligFaltantes: string[] = ref === null ? ['ref'] : [];
  for (const k of obligatorios) if (hay(k) === null) { falta(k); obligFaltantes.push(k); }
  for (const k of opcionales) if (hay(k) === null) falta(k);
  if (opciones.requiereTeam === true && hay('teamNombre') === null) { falta('teamNombre'); obligFaltantes.push('teamNombre'); }
  if (mostrar) {
    for (const k of ['licencia', 'vigenciaLicencia', 'celular'] as const) if (hay(k) === null) falta(k);
  }
  if (faltantes.length > 0) {
    lineas.push(`Sin dato (no se rellena): ${faltantes.map((k) => ETIQUETA_FALTANTE[k] ?? k).join(', ')}.`);
  }

  // ── Validaciones existentes (V01-V21, P01) ──
  const ficha = aFichaValidable(e, etaCompleto ? { valor: etaValor, punto: etaPunto, actualizadoEn: etaAct } : null, zona);
  const ctx: ContextoValidacion = { ...(opciones.contexto ?? {}), ahora: opciones.ahora ?? '' };
  const hallazgos = validarFicha(ficha, ctx, opciones.config);
  let bloqueo = false;
  for (const h of hallazgos) {
    if (h.severidad === 'info') continue;
    if (h.severidad === 'bloqueo') bloqueo = true;
    advertencias.push(`${h.id} (${h.severidad}): ${h.mensaje}`);
  }

  const listo = !bloqueo && obligFaltantes.length === 0 && (estatus === null || estatusValido) && (etaValor === null || etaCompleto);
  return { texto: lineas.join('\n'), faltantes, advertencias, listo };
}
