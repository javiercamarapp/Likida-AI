import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { puedeAsignar } from '@/lib/auth/permisos';
import { logger } from '@/lib/logger';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import { crearRepoVigia } from '@/lib/likida/vigia/repo';
import { ErrorLectorPrograma, leerProgramaCsv } from '@/lib/likida/vigia/programa/lector';
import { normalizarPrograma } from '@/lib/likida/vigia/programa/normalizar';
import { crearRepoPrograma, ProgramaSinMigrar } from '@/lib/likida/vigia/programa/repo';
import { armarLectura, sha256Hex, sincronizarPrograma } from '@/lib/likida/vigia/programa/sincronizar';
import { sufijoTenant } from '../../../sufijo';
import { VistaProgramaVigia, TOPE_ARCHIVO_PROGRAMA_BYTES, type ResultadoPrograma, type ResumenPrograma } from './vista';

export const dynamic = 'force-dynamic';
// A37-S59-05: la subida (hasta 12 MB, escritura serial por lotes) puede pasar del tope por omisión; que no muera a medias.
export const maxDuration = 120;

const RUTA = '/dashboard/agentes/vigia/programa';

/** Cuántas filas con aviso / descartadas se enseñan; el total siempre va completo. */
const MAX_DETALLE = 20;
const MAX_AVISOS_ARCHIVO = 10;
const TERMINAL_VALIDA = /^[A-Z0-9][A-Z0-9 _-]{0,39}$/;

type Busqueda = { vista?: string; tenant?: string; rol?: string };

/**
 * Vuelve a resolver la sesión (cookie) y devuelve el actor si su rol puede subir el programa.
 * A NIVEL DE MÓDULO a propósito (ver el `actor` de ../page.tsx): una `'use server'` inline que cierra
 * sobre una función local no es serializable; aquí `sp` entra por parámetro y lo único que la acción
 * captura son strings. El tenant sale de la sesión, nunca del formulario.
 */
async function actor(sp: Busqueda) {
  const s = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(s.rol, RUTA) || !puedeAsignar(s.rol)) return null;
  return { tenantId: s.tenantId, userId: s.userId };
}

/** UTF-8; si el archivo no lo es (un Excel guardado como CSV en Windows), Windows-1252. */
function decodificar(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

const error = (texto: string): ResultadoPrograma => ({ ok: false, error: texto });

async function subir(a: { tenantId: string; userId: string }, fd: FormData): Promise<ResultadoPrograma> {
  const terminal = String(fd.get('terminal') ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
  if (!TERMINAL_VALIDA.test(terminal)) return error('Escribe la terminal con su código corto, por ejemplo GDL (letras y números, hasta 40).');

  const archivo = fd.get('archivo');
  if (!(archivo instanceof File) || archivo.size === 0) return error('Elige el archivo del programa (CSV).');
  if (archivo.size > TOPE_ARCHIVO_PROGRAMA_BYTES) {
    return error(`El archivo pesa más de ${TOPE_ARCHIVO_PROGRAMA_BYTES / (1024 * 1024)} MB. Sube solo el programa de los últimos días.`);
  }
  if (/\.(xlsx|xlsm|xls)$/i.test(archivo.name)) {
    return error('Los archivos de Excel (.xlsx) todavía no se pueden leer. En Excel usa «Guardar como» y elige CSV, y vuelve a subirlo.');
  }

  const texto = decodificar(new Uint8Array(await archivo.arrayBuffer()));

  let lector;
  try {
    lector = leerProgramaCsv(texto, { terminal });
  } catch (e) {
    if (e instanceof ErrorLectorPrograma) {
      return error(/encabezados/.test(e.message) ? `El archivo no parece un programa de despacho. ${e.message}` : e.message);
    }
    throw e;
  }
  const normalizado = normalizarPrograma(lector);
  if (normalizado.filas.length === 0) {
    return error('El archivo no parece un programa de despacho: no encontré ninguna fila con caja, unidad o cliente que pueda leer.');
  }

  const guardado = await sincronizarPrograma(
    a.tenantId, terminal,
    armarLectura(lector, normalizado, { sha256: sha256Hex(texto), origen: 'subida', creadoPor: a.userId }),
    { repo: crearRepoPrograma() },
  );

  const porDia = new Map<string, { filas: number; conAviso: number; sinCaja: number }>();
  const conAviso: ResumenPrograma['filasConAviso'] = [];
  let totalConAviso = 0;
  for (const f of normalizado.filas) {
    if (f.avisos.length > 0) {
      totalConAviso++;
      if (conAviso.length < MAX_DETALLE) conAviso.push({ lineaCsv: f.lineaCsv, fecha: f.fecha, avisos: f.avisos.map((x) => x.mensaje) });
    }
    if (f.fecha === null) continue;
    const d = porDia.get(f.fecha) ?? { filas: 0, conAviso: 0, sinCaja: 0 };
    d.filas++;
    if (f.avisos.length > 0) d.conAviso++;
    if (f.caja === null) d.sinCaja++;
    porDia.set(f.fecha, d);
  }
  const desc = normalizado.calidad.descartadas;

  return {
    ok: true,
    resumen: {
      terminal,
      leidas: normalizado.calidad.leidas,
      validas: normalizado.calidad.validas,
      dias: porDia.size,
      porDia: [...porDia.entries()].sort(([x], [y]) => (x < y ? -1 : 1)).map(([fecha, d]) => ({ fecha, ...d })),
      totalDescartadas: desc.length,
      descartadas: desc.slice(0, MAX_DETALLE).map((d) => ({ lineaCsv: d.lineaCsv, motivo: d.motivo })),
      totalConAviso,
      filasConAviso: conAviso,
      avisosArchivo: lector.avisos.slice(0, MAX_AVISOS_ARCHIVO).map((x) => x.mensaje),
      sinFecha: guardado.sinFecha,
      guardado: {
        yaCargado: guardado.yaCargado, nuevas: guardado.nuevas, cambiadas: guardado.cambiadas,
        sinCambio: guardado.sinCambio, desaparecidas: guardado.desaparecidas,
      },
    },
  };
}

/**
 * Carga del programa de despacho del Vigía (Agente 4, T-A4-07): el ejecutivo sube el archivo del
 * día (CSV) y la pantalla dice, en lenguaje llano, qué se entendió y qué se descartó. Cero pesos.
 * Lo ve quien ve el Vigía; solo el dueño y el encargado suben.
 */
export default async function PaginaProgramaVigia({ searchParams }: { searchParams: Promise<Busqueda> }) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(rol, RUTA)) redirect('/dashboard');

  const config = await crearRepoVigia().config(tenantId).catch((e) => {
    logger.warn('vigia.programa_config_no_leida', { err: e instanceof Error ? e.message : String(e) });
    return null;
  });

  async function cargar(_p: ResultadoPrograma, fd: FormData): Promise<ResultadoPrograma> {
    'use server';
    const a = await actor(sp);
    if (!a) return error('Solo el dueño o el encargado de la flota sube el programa de despacho.');
    try {
      const r = await subir(a, fd);
      if (r?.ok) revalidatePath(RUTA);
      return r;
    } catch (e) {
      if (e instanceof ProgramaSinMigrar) return error('La base de datos todavía no está lista para guardar el programa. Avísale a soporte.');
      // Nunca el contenido del archivo en el log: solo el mensaje técnico.
      logger.error('vigia.programa_carga_fallo', { tenant: a.tenantId, err: e instanceof Error ? e.message : String(e) });
      return error(mensajeParaPantalla(e, 'cargar el programa'));
    }
  }

  return (
    <VistaProgramaVigia
      sufijo={sufijoTenant(sp)}
      puedeEscribir={puedeAsignar(rol)}
      vigiaEncendido={config === null ? null : config.habilitado}
      accion={cargar}
    />
  );
}
