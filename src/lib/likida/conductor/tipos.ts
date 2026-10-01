// ═══════════════════════════════════════════════════════════════════════════
// AGENTE 5 «CONDUCTOR» — los tipos y el vocabulario de los hitos (0380).
//
// Sin I/O. Lo comparten el intérprete, la máquina de estados, el planificador,
// el repositorio y la API: un solo sitio donde se dice qué es un hito.
// ═══════════════════════════════════════════════════════════════════════════

/** Los hitos, EN ORDEN de secuencia válida. `regreso` cierra el viaje. */
export const TIPOS_HITO = [
  'llegada_carga', 'salida_carga', 'llegada_descarga', 'salida_descarga', 'regreso',
] as const;
export type TipoHito = typeof TIPOS_HITO[number];

export const ESTADOS_HITO = ['esperado', 'recibido', 'validado', 'omitido', 'escalado'] as const;
export type EstadoHito = typeof ESTADOS_HITO[number];

export type FuenteHito = 'texto' | 'boton' | 'ubicacion' | 'foto' | 'sistema';
export type InterpretacionHito = 'regla' | 'boton' | 'llm' | 'ubicacion' | 'foto' | 'sistema';
export type ValidadoPor = 'oficina' | 'gps' | 'sistema';

/** Lugar del hito: se pregunta por él y se informa con él. */
export type Lugar = 'carga' | 'descarga';

export function indiceHito(tipo: TipoHito): number {
  return TIPOS_HITO.indexOf(tipo);
}

export function esTipoHito(valor: unknown): valor is TipoHito {
  return typeof valor === 'string' && (TIPOS_HITO as readonly string[]).includes(valor);
}

/** El lugar al que pertenece un hito (`regreso` no tiene). */
export function lugarDe(tipo: TipoHito): Lugar | null {
  if (tipo === 'llegada_carga' || tipo === 'salida_carga') return 'carga';
  if (tipo === 'llegada_descarga' || tipo === 'salida_descarga') return 'descarga';
  return null;
}

/** Una fila de `viaje_hito`, ya en camelCase. */
export interface HitoFila {
  id: string;
  tenantId: string;
  viajeId: string;
  tipo: TipoHito;
  estado: EstadoHito;
  ciclo: number;
  fuente: FuenteHito | null;
  interpretacion: InterpretacionHito | null;
  mensajeEn: string | null;
  recibidoEn: string | null;
  contactoNombre: string | null;
  contactoArea: string | null;
  sinContacto: boolean;
  lat: number | null;
  lng: number | null;
  evidenciaRuta: string | null;
  validadoEn: string | null;
  validadoPor: ValidadoPor | null;
  omitidoMotivo: string | null;
  pospuestoHasta: string | null;
  pospuestoVeces: number;
  correcciones: number;
  solicitadoEn: string | null;
  recordatoriosEnviados: number;
  ultimoAvisoEn: string | null;
  escaladoEn: string | null;
  escalacionNivel: number;
  escalacionAtendidaEn: string | null;
}

/** ¿El hito ya tiene un dato del chofer (o validado)? */
export function estaResuelto(h: Pick<HitoFila, 'estado'>): boolean {
  return h.estado === 'recibido' || h.estado === 'validado';
}

/** ¿Sigue esperando respuesta? (`escalado` también: se escaló pero no se recibió.) */
export function estaPendiente(h: Pick<HitoFila, 'estado'>): boolean {
  return h.estado === 'esperado' || h.estado === 'escalado';
}

export interface Contacto {
  nombre: string;
  area: string | null;
}

/** Cómo se le dice a un hito en cada voz. */
export const ETIQUETA: Readonly<Record<TipoHito, { chofer: string; oficina: string; corta: string }>> = {
  llegada_carga: { chofer: 'tu llegada a cargar', oficina: 'llegó a cargar', corta: 'llegada a carga' },
  salida_carga: { chofer: 'tu salida de la carga', oficina: 'salió de la carga', corta: 'salida de carga' },
  llegada_descarga: { chofer: 'tu llegada a descargar', oficina: 'llegó a descargar', corta: 'llegada a descarga' },
  salida_descarga: { chofer: 'tu salida de la descarga', oficina: 'salió de la descarga', corta: 'salida de descarga' },
  regreso: { chofer: 'tu regreso', oficina: 'va de regreso', corta: 'regreso' },
};

// ── Los botones: <prefijo>:<viaje_id> (convención del catálogo de plantillas) ──
export const PREFIJO_BOTON = {
  llegadaCarga: 'hito_llegada_carga',
  retrasoCarga: 'hito_retraso_carga',
  sinContactoAnden: 'hito_sin_contacto_anden',
  salidaCarga: 'hito_salida_carga',
  sigueCargando: 'hito_sigue_cargando',
  llegadaDescarga: 'hito_llegada_descarga',
  salidaDescarga: 'hito_salida_descarga',
  sigueDescargando: 'hito_sigue_descargando',
  regreso: 'hito_regreso',
  aunNoRegreso: 'hito_aun_no_regreso',
  /** «Es en descarga»: el chofer corrige una llegada que se anotó en la carga. */
  corrigeLlegada: 'hito_corrige_llegada',
  recordatorioRegistrar: 'recordatorio_registrar',
  recordatorioProblema: 'recordatorio_problema',
  pedirUbicacion: 'pedir_ubicacion',
  jefeAtiendo: 'jefe_atiendo',
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface BotonLeido {
  prefijo: string;
  viajeId: string;
  /** Solo los botones de recordatorio llevan el hito al que se refieren (`<prefijo>:<viaje>:<hito>`). */
  hito: TipoHito | null;
}

/** Los botones que, además del viaje, nombran EL HITO que se recordó: así un recordatorio viejo no registra otro hito. */
const PREFIJOS_CON_HITO: readonly string[] = [PREFIJO_BOTON.recordatorioRegistrar, PREFIJO_BOTON.recordatorioProblema];

/**
 * ¿El texto es el payload de uno de NUESTROS botones? Anclado y con el uuid
 * validado: el payload llega como texto y un chofer puede teclearlo a mano, así
 * que el llamador SIEMPRE comprueba que el viaje sea suyo.
 */
export function leerBotonConductor(texto: string | undefined): BotonLeido | null {
  if (typeof texto !== 'string') return null;
  const t = texto.trim();
  if (t.length > 128) return null;
  const partes = t.split(':');
  if (partes.length < 2 || partes.length > 3) return null;
  const [prefijo, viajeId, hito] = partes;
  if (!(Object.values(PREFIJO_BOTON) as string[]).includes(prefijo)) return null;
  if (!UUID.test(viajeId)) return null;
  if (partes.length === 3) {
    if (!PREFIJOS_CON_HITO.includes(prefijo) || !esTipoHito(hito)) return null;
    return { prefijo, viajeId: viajeId.toLowerCase(), hito };
  }
  return { prefijo, viajeId: viajeId.toLowerCase(), hito: null };
}
