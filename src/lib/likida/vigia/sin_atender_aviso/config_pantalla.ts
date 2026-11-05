// Configuración efectiva de «sin atender»: defaults del motor <- plazos de la flota (vigia_config) <- almacén opcional <- solicitud.
// El almacén por flota NO existe todavía (haría falta una tabla nueva): la implementación real devuelve null y todo lo que el
// usuario ajusta vale solo para esa revisión. Puro: no toca base.
import { CONFIG_SIN_ATENDER_POR_OMISION, validarConfigSinAtender, type ConfigSinAtender } from './motor';

export interface PuertoConfigSinAtender {
  leer(tenantId: string): Promise<Partial<ConfigSinAtender> | null>;
}
/** Sin almacén por flota: siempre null (los valores de arranque + los plazos de la flota mandan). */
export const puertoConfigSinAtenderReal: PuertoConfigSinAtender = { leer: async () => null };

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
  guardada: Partial<ConfigSinAtender> | null;
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
    ...(e.guardada ?? {}),
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
