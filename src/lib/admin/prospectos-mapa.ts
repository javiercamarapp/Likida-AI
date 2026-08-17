// ═══════════════════════════════════════════════════════════════════════════
// EL MAPA DE PROSPECTOS (Fase D, orden del 17-ago) — datos y criterio.
//
// Dos porcentajes viven aquí y los dos son ESTIMACIONES DETERMINISTAS con el
// criterio a la vista (regla de la casa: una estimación se puede mostrar,
// declarada y con su supuesto — jamás una cifra que parezca medición):
//
//  · URGENCIA — qué tanto les duele HOY, leído de su propia conducta: la
//    vacante que publicaron (nombrar la liquidación es confesión directa),
//    cuántos anuncios y qué tan recientes.
//  · CIERRE — qué tan alcanzable es el trato: si hay teléfono/correo/decisor
//    (no se puede cerrar a quien no se puede llamar), el fit del giro y qué
//    tan avanzado va el embudo.
//
// Las funciones de score son puras y exportadas: la prueba las fija y el
// pie del mapa enseña el criterio con las mismas palabras de este archivo.
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { conteo, traerTodo } from '@/lib/likida/pg';
import { logger } from '@/lib/logger';

// ── El embudo → color. UNA fuente para pines SVG, marcadores de calle,
// leyenda y tarjetas — dos paletas del mismo estado se desincronizan. ──────
export const COLOR_EMBUDO: Record<string, { color: string; nombre: string }> = {
  nuevo: { color: '#64748b', nombre: 'Sin contactar' },
  contactado: { color: '#d97706', nombre: 'Contactado' },
  demo: { color: '#7c3aed', nombre: 'Demo dado' },
  negociacion: { color: '#ea580c', nombre: 'En negociación' },
  cerrado: { color: '#16a34a', nombre: 'Cliente' },
  perdido: { color: '#94a3b8', nombre: 'Perdido' },
};

export type Giro = 'transportista' | 'flota_propia' | 'logistica' | 'otro';

export const NOMBRE_GIRO: Record<Giro, string> = {
  transportista: 'Transportista',
  flota_propia: 'Flota propia',
  logistica: 'Logística',
  otro: 'Otro giro',
};

// ── Normalización y plaza ───────────────────────────────────────────────────

function normalizar(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Alias → nombre EXACTO de ESTADOS_GEO (mexico-estados-geo.ts). */
const ALIAS_ENTIDAD: Record<string, string> = {
  'cdmx': 'Ciudad de México', 'ciudad de mexico': 'Ciudad de México', 'df': 'Ciudad de México',
  'distrito federal': 'Ciudad de México',
  'estado de mexico': 'México', 'edomex': 'México', 'mexico': 'México', 'edo de mexico': 'México',
  'nuevo leon': 'Nuevo León', 'michoacan': 'Michoacán', 'queretaro': 'Querétaro',
  'san luis potosi': 'San Luis Potosí', 'yucatan': 'Yucatán', 'baja california': 'Baja California',
  'baja california sur': 'Baja California Sur', 'aguascalientes': 'Aguascalientes',
  'campeche': 'Campeche', 'chiapas': 'Chiapas', 'chihuahua': 'Chihuahua', 'coahuila': 'Coahuila',
  'colima': 'Colima', 'durango': 'Durango', 'guanajuato': 'Guanajuato', 'guerrero': 'Guerrero',
  'hidalgo': 'Hidalgo', 'jalisco': 'Jalisco', 'morelos': 'Morelos', 'nayarit': 'Nayarit',
  'oaxaca': 'Oaxaca', 'puebla': 'Puebla', 'quintana roo': 'Quintana Roo', 'sinaloa': 'Sinaloa',
  'sonora': 'Sonora', 'tabasco': 'Tabasco', 'tamaulipas': 'Tamaulipas', 'tlaxcala': 'Tlaxcala',
  'veracruz': 'Veracruz', 'zacatecas': 'Zacatecas',
};

/** Ciudades frecuentes del censo → su estado, para los prospectos cuya
 *  `ciudad` viene sin entidad ("Guadalajara" a secas). Cobertura parcial a
 *  propósito: lo que no se sabe cae a "sin plaza", no se adivina. */
const CIUDAD_A_ENTIDAD: Record<string, string> = {
  'guadalajara': 'Jalisco', 'zapopan': 'Jalisco', 'tlaquepaque': 'Jalisco', 'san pedro tlaquepaque': 'Jalisco', 'tonala': 'Jalisco', 'tlajomulco': 'Jalisco',
  'monterrey': 'Nuevo León', 'escobedo': 'Nuevo León', 'apodaca': 'Nuevo León', 'guadalupe': 'Nuevo León', 'san nicolas': 'Nuevo León', 'santa catarina': 'Nuevo León', 'garcia': 'Nuevo León', 'san pedro garza garcia': 'Nuevo León',
  'merida': 'Yucatán', 'kanasin': 'Yucatán', 'progreso': 'Yucatán', 'uman': 'Yucatán',
  'celaya': 'Guanajuato', 'leon': 'Guanajuato', 'irapuato': 'Guanajuato', 'silao': 'Guanajuato', 'salamanca': 'Guanajuato',
  'tijuana': 'Baja California', 'mexicali': 'Baja California', 'ensenada': 'Baja California',
  'queretaro': 'Querétaro', 'el marques': 'Querétaro', 'san juan del rio': 'Querétaro',
  'toluca': 'México', 'tultitlan': 'México', 'naucalpan': 'México', 'tlalnepantla': 'México', 'ecatepec': 'México', 'cuautitlan': 'México', 'cuautitlan izcalli': 'México', 'tepotzotlan': 'México', 'lerma': 'México',
  'azcapotzalco': 'Ciudad de México', 'iztapalapa': 'Ciudad de México', 'gustavo a madero': 'Ciudad de México', 'cuauhtemoc': 'Ciudad de México', 'miguel hidalgo': 'Ciudad de México', 'vallejo': 'Ciudad de México', 'iztacalco': 'Ciudad de México',
  'puebla': 'Puebla', 'veracruz': 'Veracruz', 'cordoba': 'Veracruz', 'coatzacoalcos': 'Veracruz',
  'culiacan': 'Sinaloa', 'mazatlan': 'Sinaloa', 'hermosillo': 'Sonora', 'chihuahua': 'Chihuahua',
  'ciudad juarez': 'Chihuahua', 'juarez': 'Chihuahua', 'torreon': 'Coahuila', 'saltillo': 'Coahuila',
  'ramos arizpe': 'Coahuila', 'nuevo laredo': 'Tamaulipas', 'reynosa': 'Tamaulipas',
  'matamoros': 'Tamaulipas', 'altamira': 'Tamaulipas', 'tampico': 'Tamaulipas',
  'aguascalientes': 'Aguascalientes', 'san luis potosi': 'San Luis Potosí', 'villahermosa': 'Tabasco',
  'cancun': 'Quintana Roo', 'playa del carmen': 'Quintana Roo', 'chetumal': 'Quintana Roo',
  'oaxaca': 'Oaxaca', 'tuxtla': 'Chiapas', 'tuxtla gutierrez': 'Chiapas', 'tapachula': 'Chiapas',
  'morelia': 'Michoacán', 'uruapan': 'Michoacán', 'lazaro cardenas': 'Michoacán',
  'pachuca': 'Hidalgo', 'tizayuca': 'Hidalgo', 'cuernavaca': 'Morelos', 'durango': 'Durango',
  'zacatecas': 'Zacatecas', 'tepic': 'Nayarit', 'colima': 'Colima', 'manzanillo': 'Colima',
  'acapulco': 'Guerrero', 'campeche': 'Campeche', 'ciudad del carmen': 'Campeche', 'la paz': 'Baja California Sur',
};

/** "Escobedo, Nuevo León" → { ciudad: 'Escobedo', entidad: 'Nuevo León' }.
 *  Devuelve entidad null cuando de verdad no se sabe — "sin plaza" es un
 *  dato, no un hueco a rellenar. */
export function plazaDe(ciudadCruda: string | null): { ciudad: string | null; entidad: string | null } {
  if (!ciudadCruda) return { ciudad: null, entidad: null };
  const crudo = ciudadCruda.trim();
  if (!crudo || /nacional|remoto|computrabajo|indeed|occ/i.test(crudo)) return { ciudad: null, entidad: null };
  const partes = crudo.split(',').map((p) => p.trim()).filter(Boolean);
  const ultima = normalizar(partes[partes.length - 1]);
  if (partes.length > 1 && ALIAS_ENTIDAD[ultima]) {
    return { ciudad: partes.slice(0, -1).join(', '), entidad: ALIAS_ENTIDAD[ultima] };
  }
  // Una sola parte: puede ser una entidad a secas o una ciudad conocida.
  const unica = normalizar(partes[0]);
  if (partes.length === 1 && ALIAS_ENTIDAD[unica] && !CIUDAD_A_ENTIDAD[unica]) {
    return { ciudad: null, entidad: ALIAS_ENTIDAD[unica] };
  }
  const porCiudad = CIUDAD_A_ENTIDAD[normalizar(partes[0])];
  return { ciudad: partes[0], entidad: porCiudad ?? null };
}

// ── Giro ────────────────────────────────────────────────────────────────────

export function giroDe(empresa: string, vacante: string | null, notas: string | null): Giro {
  const nombre = normalizar(empresa);
  const todo = normalizar(`${empresa} ${vacante ?? ''} ${notas ?? ''}`);
  if (/\b(transportes|transporte|autotransportes|autotransporte|fletes|trucking|carga|tractocamion|freight)\b/.test(nombre)
    || /autotransporte (foraneo|de carga|local)/.test(todo)) return 'transportista';
  if (/\b(logistica|logistics|forwarding|almacenadora|freight forward|3pl)\b/.test(todo)) return 'logistica';
  if (/\b(reparto|cedis|distribucion|distribuidora|comercializadora|ruta de venta|autoventa|embotellador|panificad)\b/.test(todo)
    || /comercio al por mayor/.test(todo)) return 'flota_propia';
  return 'otro';
}

// ── Los dos porcentajes (0-100, deterministas, criterio a la vista) ────────

/** Cuántos anuncios dice la nota del censo ("· 3 anuncios en el censo"). */
function anunciosDe(notas: string): number {
  const m = notas.match(/(\d+)\s+anuncios?\s+en el censo/);
  return m ? Number(m[1]) : 0;
}

export function scoreUrgencia(p: { vacante: string | null; notas: string | null }): number {
  const notas = p.notas ?? '';
  let s = 0;
  // La confesión directa: su propia vacante nombra la liquidación.
  if (/DOLOR DIRECTO/i.test(notas) || /liquida/i.test(p.vacante ?? '')) s += 45;
  else if (notas) s += 15; // señal del giro: duele, pero lo dijo de lado
  // Insistencia: más anuncios = el puesto no se llena (o rota).
  s += Math.min(20, anunciosDe(notas) * 4);
  // Recencia del último anuncio (formato del censo: "Hace 8 hor", "Hace 3
  // día"). OJO: `normalizar` ya quitó los dos puntos — el patrón va sin ':'.
  const plano = normalizar(notas);
  if (/ultimo anuncio hace \d+ (hor|min)/.test(plano)) s += 20;
  else if (/ultimo anuncio hace [1-7] dia/.test(plano)) s += 15;
  else if (/ultimo anuncio/.test(plano)) s += 5;
  // La ficha trabajada a mano (cuentas nombradas) documenta el dolor textual.
  if (/FICHA 1\d-ago|martirio/i.test(notas)) s += 15;
  return Math.min(100, s);
}

export function scoreCierre(p: {
  telefono: string | null; correo: string | null; contacto_nombre: string | null;
  estado: string; fuente: string; empresa: string; vacante: string | null; notas: string | null;
}): number {
  let s = 0;
  // Alcanzabilidad: no se cierra a quien no se puede llamar.
  if (p.telefono) s += 20;
  if (p.correo) s += 15;
  if (p.contacto_nombre) s += 20;
  // Fit del giro: el transportista vive el ciclo completo (RFA/IEPS/peaje);
  // la flota propia solo una parte.
  const g = giroDe(p.empresa, p.vacante, p.notas);
  if (g === 'transportista') s += 15;
  else if (g === 'logistica') s += 10;
  else if (g === 'flota_propia') s += 8;
  // El embudo manda: lo avanzado pesa más que cualquier señal.
  if (p.estado === 'contactado') s += 15;
  else if (p.estado === 'demo') s += 25;
  else if (p.estado === 'negociacion') s += 35;
  else if (p.estado === 'cerrado') return 100;
  else if (p.estado === 'perdido') return 0;
  // Cuenta trabajada a mano (ficha) — ya hay contexto para personalizar.
  if (p.fuente === 'manual') s += 10;
  return Math.min(100, s);
}

/** El criterio, en una línea por score — el pie del mapa lo enseña TAL CUAL
 *  (misma fuente que el cálculo, no una copia que se desincronice). */
export const CRITERIO_SCORES = {
  urgencia: 'Urgencia = su propia conducta: la vacante que nombra la liquidación (+45), cuántos anuncios (+4 c/u, tope 20), qué tan reciente el último (+20 si es de hoy) y la ficha trabajada (+15). Estimación determinista, no medición.',
  cierre: 'Cierre = alcanzabilidad (tel +20, correo +15, decisor +20), fit del giro (transportista +15), etapa del embudo (contactado +15 … negociación +35; cliente=100, perdido=0) y ficha a mano (+10). Estimación determinista, no medición.',
} as const;

// ── La lectura completa para el mapa ────────────────────────────────────────

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
  giro: Giro;
  urgencia: number;
  cierre: number;
}

export interface DatosMapa {
  prospectos: ProspectoMapa[];
  generadoEn: string;
  /** true = la lectura falló y la lista viene vacía POR ESO (no hay cero). */
  fallo: boolean;
}

interface FilaProspecto {
  id: string; empresa: string; ciudad: string | null; lat: number | null; lng: number | null;
  telefono: string | null; correo: string | null; contacto_nombre: string | null;
  vacante: string | null; estado: string; fuente: string; notas: string | null;
}

export async function getDatosMapa(): Promise<DatosMapa> {
  const generadoEn = new Date().toISOString();
  // traerTodo, no .limit(): PostgREST recorta a 1,000 filas EN SILENCIO
  // (trampa documentada en CLAUDE.md) y el universo DENUE ya pasa de 3,000 —
  // un mapa con la primera página se leería como "el país entero" sin serlo.
  let filas: FilaProspecto[];
  try {
    filas = await traerTodo<FilaProspecto>(
      (d, h) => supabaseAdmin()
        .from('prospecto')
        .select('id, empresa, ciudad, lat, lng, telefono, correo, contacto_nombre, vacante, estado, fuente, notas', conteo(d))
        .order('created_at', { ascending: false })
        .range(d, h),
      'prospecto (mapa)',
    );
  } catch (e) {
    logger.error('mapa_prospectos.leer', { err: e instanceof Error ? e.message : String(e) });
    return { prospectos: [], generadoEn, fallo: true };
  }
  const prospectos = filas
    .filter((p) => !/DUPLICADO:/.test(p.notas ?? ''))
    .map((p) => {
      const { ciudad, entidad } = plazaDe(p.ciudad);
      return {
        id: p.id,
        empresa: p.empresa,
        ciudad,
        entidad,
        lat: p.lat,
        lng: p.lng,
        telefono: p.telefono,
        correo: p.correo,
        contacto: p.contacto_nombre,
        vacante: p.vacante,
        estado: p.estado,
        giro: giroDe(p.empresa, p.vacante, p.notas),
        urgencia: scoreUrgencia({ vacante: p.vacante, notas: p.notas }),
        cierre: scoreCierre({
          telefono: p.telefono, correo: p.correo, contacto_nombre: p.contacto_nombre,
          estado: p.estado, fuente: p.fuente, empresa: p.empresa, vacante: p.vacante, notas: p.notas,
        }),
      };
    });
  return { prospectos, generadoEn, fallo: false };
}
