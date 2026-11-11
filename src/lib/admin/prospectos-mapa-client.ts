// Contrato compartido por componentes cliente. Este módulo debe permanecer
// libre de Supabase, Node y cualquier otra dependencia server-only.

export const COLOR_EMBUDO: Record<string, { color: string; nombre: string }> = {
  nuevo: { color: 'var(--muted)', nombre: 'Sin contactar' },
  contactado: { color: 'var(--chart-4)', nombre: 'Contactado' },
  demo: { color: 'var(--chart-7)', nombre: 'Demo dado' },
  negociacion: { color: 'var(--chart-2)', nombre: 'En negociación' },
  cerrado: { color: 'var(--chart-3)', nombre: 'Cliente' },
  perdido: { color: 'var(--faint)', nombre: 'Perdido' },
  appointment: { color: 'var(--chart-1)', nombre: 'Cita agendada' },
  rescheduled: { color: 'var(--chart-5)', nombre: 'Cita reprogramada' },
  cancelled: { color: 'var(--chart-6)', nombre: 'Cita cancelada' },
  'no-show': { color: 'var(--chart-6)', nombre: 'No se presentó' },
  proposal: { color: 'var(--chart-7)', nombre: 'Propuesta' },
  pilot: { color: 'var(--chart-5)', nombre: 'Piloto' },
  won: { color: 'var(--chart-3)', nombre: 'Ganado' },
  lost: { color: 'var(--faint)', nombre: 'Perdido' },
};

/** Incluye aliases históricos para que la UI no ofrezca redacción en filas
 * previas a la migración del embudo. */
export function esProspectoTerminal(estado: string): boolean {
  return estado === 'won' || estado === 'cerrado'
    || estado === 'lost' || estado === 'perdido';
}

export type Giro =
  | 'transportista' | 'embotelladora' | 'abarrotes_mayoreo'
  | 'flota_propia' | 'logistica' | 'otro';

export const NOMBRE_GIRO: Record<Giro, string> = {
  transportista: 'Transportista',
  embotelladora: 'Embotelladora',
  abarrotes_mayoreo: 'Abarrotes / Mayoreo',
  flota_propia: 'Flota propia',
  logistica: 'Logística',
  otro: 'Otro giro',
};

export const TAMANOS = ['11-30', '31-50', '51-100', '101-250', '250+'] as const;
export type Tamano = (typeof TAMANOS)[number];

export const CRITERIO_SCORES = {
  urgencia: 'Urgencia = lo que él DECLARA manda sobre lo que inferimos: si contestó «ya, este mes nos está costando» en /getdemo vale 100, y si contestó «estoy explorando» queda con techo aunque su vacante grite. Sin declaración se infiere: la vacante que nombra la liquidación (+45), cuántos anuncios (+4 c/u, tope 20), qué tan reciente el último (+20 si es de hoy) y la ficha trabajada (+15). Estimación determinista, no medición.',
  cierre: 'Cierre = alcanzabilidad (tel +20, correo +15, decisor +20, +10 por decisor con contacto VERIFICADO —el inferido no cuenta—), quién llegó a quién (landing/campaña +20, anuncio pagado +25), fit del giro (transportista +15), tamaño de flota (+4 a +12 sin mezclarlo con urgencia), etapa del embudo (cita +18 … piloto +40; cliente ganado=100, perdido=0) y ficha a mano (+10). Estimación determinista, no medición: esto ORDENA la cola, no predice el cierre.',
  datos: 'Datos = qué tan completo está el expediente para salir a venderle: teléfono +30, correo +25, decisor +20, ubicación +15, sitio web VERIFICADO +10. El tamaño (11-30 … 250+) es el personal ocupado que reporta la DENUE.',
  similitud: 'Similitud con el ICP (0140, GENERADA — nadie la escribe a mano) = SCIAN de transporte objetivo (prefijo 484/485/488, aunque llegue en 6 dígitos) +40, vacante publicada +25, flota investigada ≥10 unidades +20, sitio web verificado +15.',
  necesidad: 'Necesidad (0140, GENERADA) = vacante de liquidación/cuadre/auxiliar administrativo +50 (cualquier otra vacante +25), flota investigada ≥20 unidades +25.',
} as const;

export interface ProspectoMapa {
  id: string;
  empresa: string;
  ciudad: string | null;
  entidad: string | null;
  lat: number | null;
  lng: number | null;
  telefono: string | null;
  correo: string | null;
  contacto: string | null;
  vacante: string | null;
  estado: string;
  fuente: string;
  giro: Giro;
  urgencia: number;
  cierre: number;
  tamano: Tamano | null;
  completitud: number;
  ultimoToque: string | null;
  mensajesGeneradosEn: string | null;
  numUnidades: number | null;
  similitudIcpPct: number;
  necesidadPct: number;
}

export interface TextosProspecto {
  id: string;
  notas: string | null;
  mensajeWaIa: string | null;
  correoAsuntoIa: string | null;
  correoCuerpoIa: string | null;
}

export type FilaCompacta = [
  id: string, empresa: string, ciudad: string | null, entidad: string | null,
  lat: number | null, lng: number | null, telefono: string | null,
  correo: string | null, contacto: string | null, vacante: string | null,
  estado: string, fuente: string, giro: Giro, urgencia: number, cierre: number,
  tamano: Tamano | null, completitud: number, ultimoToque: string | null,
  mensajesGeneradosEn: string | null, numUnidades: number | null,
  similitudIcpPct: number, necesidadPct: number,
];

export function desempacar(f: FilaCompacta): ProspectoMapa {
  const [
    id, empresa, ciudad, entidad, lat, lng, telefono, correo, contacto, vacante,
    estado, fuente, giro, urgencia, cierre, tamano, completitud, ultimoToque,
    mensajesGeneradosEn, numUnidades, similitudIcpPct, necesidadPct,
  ] = f;
  return {
    id, empresa, ciudad, entidad, lat, lng, telefono, correo, contacto, vacante,
    estado, fuente, giro, urgencia, cierre, tamano, completitud, ultimoToque,
    mensajesGeneradosEn, numUnidades, similitudIcpPct, necesidadPct,
  };
}

export interface DatosMapa {
  filas: FilaCompacta[];
  generadoEn: string;
  fallo: boolean;
  marca: string | null;
  delta: boolean;
  total: number | null;
}

export interface PersonaProspecto {
  id: string;
  nombre: string;
  puesto: string | null;
  correo: string | null;
  telefono: string | null;
  linkedin: string | null;
  origen: string;
  confianza: 'alta' | 'media' | 'baja';
  evidencia: string | null;
}

export interface DetalleProspecto extends ProspectoMapa, TextosProspecto {
  sitio: string | null;
  sitioVerificado: boolean;
  historia: string | null;
  viajesMesEstimado: number | null;
  fuenteCruda: string;
  creadoEn: string;
  personas: PersonaProspecto[];
}

// ── EL RESUMEN DEL SERVIDOR (w15/perf, punto 4) ─────────────────────────────
// Lo único que viaja en el HTML de /admin/mapa-prospectos: conteos agregados, no 33 mil filas. UNA sola lectura
// (`getResumenProspectos`) alimenta la pantalla de Ventas, el embudo de Crecimiento y la fuente de Adquisición, así que la cifra de
// prospectos no puede leerse distinto entre pantallas.

export interface ResumenEntidad {
  n: number;
  conTelefono: number;
  conDecisor: number;
  /** Conteo por valor persistido de `estado` (las llaves de COLOR_EMBUDO). */
  porEtapa: Record<string, number>;
}

export interface ResumenProspectos {
  generadoEn: string;
  /** Prospectos vivos (sin duplicados): LA cifra de la cartera. */
  total: number;
  porEtapa: Record<string, number>;
  conTelefono: number;
  conDecisor: number;
  /** Vivos cuya plaza no se sabe: se dicen, no se les inventa estado. */
  sinPlaza: number;
  porEntidad: Record<string, ResumenEntidad>;
}

/** Pasos de la rampa secuencial del choropleth (Rovaq usa 5). 0 = sin prospectos. */
export const PASOS_RAMPA = 5;

/**
 * Paso 0..5 de un estado. La escala es de RAÍZ CUADRADA, no lineal: con 30 mil prospectos repartidos como están (dos o tres estados
 * con miles y el resto con cientos) una escala lineal pinta 28 estados del mismo paso más claro y el mapa no distingue nada.
 */
export function pasoDeRampa(n: number, max: number): number {
  if (!(n > 0) || !(max > 0)) return 0;
  // Se decide contra los MISMOS límites que enseña la leyenda: dos cálculos del mismo corte se desfasan en el redondeo.
  const limites = limitesRampa(max);
  return limites.find((l) => n <= l.hasta)?.paso ?? PASOS_RAMPA;
}

/** Los límites REALES de cada paso (para la leyenda): un rótulo de leyenda tiene que ser verdad. */
export function limitesRampa(max: number): Array<{ paso: number; desde: number; hasta: number }> {
  if (!(max > 0)) return [];
  const out: Array<{ paso: number; desde: number; hasta: number }> = [];
  let previo = 0;
  for (let paso = 1; paso <= PASOS_RAMPA; paso++) {
    const hasta = paso === PASOS_RAMPA ? max : Math.floor((max * paso * paso) / (PASOS_RAMPA * PASOS_RAMPA));
    if (hasta > previo) out.push({ paso, desde: previo + 1, hasta });
    previo = Math.max(previo, hasta);
  }
  return out;
}
