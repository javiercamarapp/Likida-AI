// Configuración efectiva de «sin atender»: defaults del motor <- plazos de la flota (vigia_config) <- lo que la flota dejó guardado (0999) <- solicitud.
// Lo guardado por flota vive en una tabla de una fila (SIN FILA = todo apagado). Este archivo es PURO: no toca base; el puerto real se arma en acciones.ts.
import { CONFIG_SIN_ATENDER_POR_OMISION, aParcialDelMotor, validarConfigGuardada, validarConfigSinAtender, type ConfigGuardadaSinAtender, type ConfigSinAtender } from './motor';

export interface PuertoConfigSinAtender {
  /** La configuración guardada de ESA flota. null / sin fila = todo apagado. Lanza si la base no responde (no se confunde con «apagado»). */
  leer(tenantId: string): Promise<ConfigGuardadaSinAtender | null>;
  /** Guarda lo ya validado. El tenant sale de la sesión. */
  guardar(tenantId: string, userId: string | null, valor: ConfigGuardadaSinAtender): Promise<{ ok: true } | { ok: false; error: string }>;
}

export interface PlazosFlota { slaRespuestaMin: number; slaCriticoMin: number }

export interface SolicitudSinAtender {
  umbralMin?: number; umbralCriticoMin?: number; umbralUrgenteMin?: number; insistenciaMin?: number; insistenciaVentanaMin?: number;
  palabrasUrgentes?: string[]; palabrasClave?: string[];
  /** Nombres del equipo tal como salen en el chat; se convierten a huellas fuera de aquí. */
  equipoNombres?: string[];
  fechaCorte?: string | null;
}

const entero = (v: string): number | undefined => {
  const t = v.trim();
  return /^\d{1,5}$/.test(t) ? Number(t) : undefined;
};
const lista = (v: string, max: number, largo: number): string[] =>
  [...new Set(v.split(/[,\n;]/).map((x) => x.replace(/\s+/g, ' ').trim().toLowerCase()).filter((x) => x !== '' && x.length <= largo))].slice(0, max);

/** Lee el formulario. Campo vacío = no se toca (queda el valor de la flota o de arranque). Un número ilegible se rechaza, no se corrige. */
export function solicitudDeFormulario(fd: FormData): { ok: true; valor: SolicitudSinAtender } | { ok: false; error: string } {
  const v: SolicitudSinAtender = {};
  for (const [campo, nombre] of [['umbralMin', 'El plazo normal'], ['umbralCriticoMin', 'El plazo de clientes críticos'], ['umbralUrgenteMin', 'El plazo de lo urgente'], ['insistenciaMin', 'Las veces que insiste el cliente'], ['insistenciaVentanaMin', 'La ventana de insistencia']] as const) {
    const crudo = String(fd.get(campo) ?? '').trim();
    if (crudo === '') continue;
    const n = entero(crudo);
    if (n === undefined) return { ok: false, error: `${nombre} debe ser un número entero.` };
    v[campo] = n;
  }
  const urg = lista(String(fd.get('palabrasUrgentes') ?? ''), 30, 40);
  if (urg.length) v.palabrasUrgentes = urg;
  const clave = lista(String(fd.get('palabrasClave') ?? ''), 30, 40);
  if (clave.length) v.palabrasClave = clave;
  const equipo = String(fd.get('equipo') ?? '').split(/[,\n;]/).map((n) => n.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 100);
  if (equipo.length) v.equipoNombres = equipo;
  const corte = String(fd.get('fechaCorte') ?? '').trim();
  if (corte !== '') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(corte) || Number.isNaN(Date.parse(`${corte}T00:00:00Z`))) return { ok: false, error: 'La fecha de corte debe ser AAAA-MM-DD.' };
    v.fechaCorte = corte;
  }
  return { ok: true, valor: v };
}

export interface EntradaConfigEfectiva {
  plazos: PlazosFlota | null;
  guardada: ConfigGuardadaSinAtender | null;
  solicitud: SolicitudSinAtender;
  equipoHashes: readonly string[];
  zona: string;
  festivos: readonly string[];
  vistaPreviaMax: number;
}

export function configEfectiva(e: EntradaConfigEfectiva): { ok: true; config: ConfigSinAtender } | { ok: false; error: string } {
  const s = e.solicitud;
  const base: Record<string, unknown> = {
    ...CONFIG_SIN_ATENDER_POR_OMISION,
    ...(e.plazos ? { umbralMin: e.plazos.slaRespuestaMin, umbralCriticoMin: e.plazos.slaCriticoMin } : {}),
    ...(e.guardada ? aParcialDelMotor(e.guardada) : {}),
  };
  for (const k of ['umbralMin', 'umbralCriticoMin', 'umbralUrgenteMin', 'insistenciaMin', 'insistenciaVentanaMin', 'palabrasUrgentes', 'palabrasClave'] as const) {
    if (s[k] !== undefined) base[k] = s[k];
  }
  base.equipoHashes = [...e.equipoHashes];
  base.zona = e.zona;
  base.festivos = [...e.festivos];
  base.vistaPreviaMax = e.vistaPreviaMax;
  const r = validarConfigSinAtender(base);
  return r.ok ? { ok: true, config: r.valor } : { ok: false, error: r.error };
}

/** Une los nombres guardados con los escritos para esta revisión (sin repetir, sin importar mayúsculas). */
export function equipoDeLaRevision(guardados: readonly string[], escritos: readonly string[]): string[] {
  const vistos = new Set<string>();
  const salida: string[] = [];
  for (const n of [...guardados, ...escritos]) {
    const k = n.trim().toLowerCase();
    if (k === '' || vistos.has(k)) continue;
    vistos.add(k);
    salida.push(n.trim());
  }
  return salida;
}

/** Lee el formulario de «Configuración de tu flota». Se manda el estado COMPLETO: una casilla sin marcar es «apagado». Campo vacío = valor de arranque. */
export function configGuardadaDeFormulario(fd: FormData): { ok: true; valor: ConfigGuardadaSinAtender } | { ok: false; error: string } {
  const numero = (campo: string, nombre: string, defecto: number): number | { error: string } => {
    const t = String(fd.get(campo) ?? '').trim();
    if (t === '') return defecto;
    return /^\d{1,5}$/.test(t) ? Number(t) : { error: `${nombre} debe ser un número entero.` };
  };
  const insistenciaMin = numero('insistenciaMin', 'Las veces que insiste el cliente', 2);
  if (typeof insistenciaMin !== 'number') return { ok: false, error: insistenciaMin.error };
  const umbralUrgenteMin = numero('umbralUrgenteMin', 'El plazo de lo urgente', 10);
  if (typeof umbralUrgenteMin !== 'number') return { ok: false, error: umbralUrgenteMin.error };
  let horarioAtencion: ConfigGuardadaSinAtender['horarioAtencion'] = null;
  if (fd.get('horarioActivo') === 'on') {
    const desde = numero('desdeHora', 'La hora de apertura', Number.NaN);
    const hasta = numero('hastaHora', 'La hora de cierre', Number.NaN);
    if (typeof desde !== 'number') return { ok: false, error: desde.error };
    if (typeof hasta !== 'number') return { ok: false, error: hasta.error };
    if (Number.isNaN(desde) || Number.isNaN(hasta)) return { ok: false, error: 'Escribe la hora de apertura y la de cierre del horario de atención.' };
    const dias = fd.getAll('diaHabil').map((d) => String(d)).filter((d) => /^[0-6]$/.test(d)).map(Number);
    horarioAtencion = dias.length > 0 && dias.length < 7 ? { desdeHora: desde, hastaHora: hasta, diasHabiles: dias } : { desdeHora: desde, hastaHora: hasta };
    if (fd.getAll('diaHabil').length > 0 && dias.length === 0) return { ok: false, error: 'Elige al menos un día hábil del horario de atención.' };
  }
  const lista = (campo: string): string[] => String(fd.get(campo) ?? '').split(/[,\n;]/).map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
  return validarConfigGuardada({
    horarioAtencion, palabrasClave: lista('palabrasClave'), palabrasUrgentes: lista('palabrasUrgentes'), equipoNombres: lista('equipo'),
    insistenciaMin, umbralUrgenteMin, resumenCorreoHabilitado: fd.get('resumenCorreo') === 'on',
  });
}
