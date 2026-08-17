// ═══════════════════════════════════════════════════════════════════════════
// EL BUS DE MANDO (0127) — la lectura y las mutaciones de la bandeja
// "Tu turno": el espejo de las 21 rutinas launchd de la Mac.
//
// Tres verbos y nada más:
//  · LEER el estado del bus (catálogo, últimas corridas, piezas pendientes,
//    órdenes recientes) — errores POR VALOR por fuente, como escalaciones.ts:
//    si una tabla no se pudo leer, ESA sección lo dice y las demás siguen.
//  · CREAR una orden (correr ahora, kill switch, nota) — la Mac la ejecuta
//    y firma su resultado; aquí solo se encola.
//  · RESOLVER una pieza (aprobar/descartar) — el estado vive en la base; la
//    publicación sigue siendo el tap de Javier sobre la pieza aprobada.
//
// Vive en lib/admin: el barrio con permiso de cruzar tenants (negocio.ts).
// Las tablas bus_* no tienen tenant — son de la plataforma, no de una flota.
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';

// ── Tipos ───────────────────────────────────────────────────────────────────

export interface RutinaBus {
  nombre: string;
  horario: string;
  descripcion: string;
  /** El encargo completo (bus_rutina.encargo_md) — el texto que el editor
   *  pre-llena. Vacío si el sembrado aún no corre para esa rutina. */
  encargoMd: string;
  ultimaCorrida: {
    inicio: string;
    fin: string | null;
    veredicto: string | null;
    prUrl: string | null;
    exitCode: number | null;
  } | null;
}

export interface PiezaBus {
  id: string;
  rutina: string;
  carpeta: string;
  titulo: string;
  tipo: string;
  copyMd: string | null;
  /** URL firmada (1 h) del preview en el bucket 'bus'; null si no subió media. */
  mediaUrl: string | null;
  creadoEn: string;
}

export interface OrdenBus {
  id: string;
  tipo: string;
  rutina: string | null;
  estado: string;
  creadoEn: string;
  resultado: string | null;
}

export interface EstadoBus {
  rutinas: RutinaBus[];
  piezasPendientes: PiezaBus[];
  ordenesRecientes: OrdenBus[];
  /** true si hay una orden de kill switch global sin resolver. */
  killSwitchPendiente: boolean;
  /** Por fuente que no se pudo leer: el nombre y el porqué (no es un 0). */
  errores: string[];
}

/** Los tipos de orden que la UI puede encolar. El dominio completo vive en el
 *  CHECK de la 0127. `editar_encargo` (17-ago-2026) cierra el ciclo del
 *  editor de rutinas: la orden lleva el contenido nuevo y la Mac abre un
 *  PR CHICO — jamás escritura directa (diseño de la Fase D). */
export const ORDENES_UI = ['correr_ahora', 'kill_switch_on', 'kill_switch_off', 'nota', 'editar_encargo'] as const;
export type TipoOrdenUi = (typeof ORDENES_UI)[number];

export function esOrdenUi(tipo: string): tipo is TipoOrdenUi {
  return (ORDENES_UI as readonly string[]).includes(tipo);
}

/** correr_ahora exige rutina (mismo criterio que el CHECK de la base — se
 *  valida aquí para que el error sea una frase, no un 23514 de Postgres).
 *  editar_encargo exige rutina Y contenido: un encargo vacío borraría la
 *  rutina por accidente. */
export function validarOrden(tipo: TipoOrdenUi, rutina: string | null, payload: Record<string, unknown> = {}): string | null {
  if (tipo === 'correr_ahora' && !rutina) return 'Correr ahora necesita saber qué rutina.';
  if (tipo === 'editar_encargo') {
    if (!rutina) return 'Editar encargo necesita saber qué rutina.';
    const contenido = typeof payload.contenido === 'string' ? payload.contenido.trim() : '';
    if (!contenido) return 'El encargo no puede quedar vacío — escribe el contenido nuevo completo.';
    if (contenido.length > 20000) return 'El encargo pasa de 20,000 caracteres.';
  }
  if (rutina && !/^[a-z0-9-]{2,40}$/.test(rutina)) return 'Ese nombre de rutina no tiene la forma esperada.';
  return null;
}

// ── Lectura ─────────────────────────────────────────────────────────────────

const HORA_FIRMA_S = 3600;

export async function getEstadoBus(): Promise<EstadoBus> {
  const admin = supabaseAdmin();
  const errores: string[] = [];

  // Catálogo + últimas corridas. Dos consultas chicas y un join en memoria:
  // 21 rutinas y ~1 corrida/día no ameritan una vista.
  let rutinas: RutinaBus[] = [];
  try {
    const [cat, corridas] = await Promise.all([
      admin.from('bus_rutina').select('nombre, horario, descripcion, encargo_md').order('nombre'),
      admin
        .from('bus_corrida')
        .select('rutina, inicio, fin, veredicto, pr_url, exit_code')
        .order('inicio', { ascending: false })
        .limit(200),
    ]);
    if (cat.error) throw cat.error;
    if (corridas.error) throw corridas.error;
    const ultimaDe = new Map<string, NonNullable<RutinaBus['ultimaCorrida']>>();
    for (const c of corridas.data ?? []) {
      if (!ultimaDe.has(c.rutina)) {
        ultimaDe.set(c.rutina, {
          inicio: c.inicio,
          fin: c.fin,
          veredicto: c.veredicto,
          prUrl: c.pr_url,
          exitCode: c.exit_code,
        });
      }
    }
    // Rutinas que reportaron corrida pero aún no están en el catálogo también
    // se enseñan: el bus dice lo que sabe, no solo lo que se sembró.
    const catalogo = cat.data ?? [];
    const enCatalogo = new Set(catalogo.map((r) => r.nombre));
    rutinas = [
      ...catalogo.map((r) => ({
        nombre: r.nombre,
        horario: r.horario,
        descripcion: r.descripcion,
        encargoMd: (r as { encargo_md?: string | null }).encargo_md ?? '',
        ultimaCorrida: ultimaDe.get(r.nombre) ?? null,
      })),
      ...[...ultimaDe.keys()]
        .filter((n) => !enCatalogo.has(n))
        .map((n) => ({ nombre: n, horario: '', descripcion: '', encargoMd: '', ultimaCorrida: ultimaDe.get(n)! })),
    ];
  } catch (e) {
    errores.push('rutinas: no se pudieron leer (bus_rutina/bus_corrida)');
    logger.error('bus.leer_rutinas', { err: e instanceof Error ? e.message : String(e) });
  }

  let piezasPendientes: PiezaBus[] = [];
  try {
    const r = await admin
      .from('bus_pieza')
      .select('id, rutina, carpeta, titulo, tipo, copy_md, media_path, creado_en')
      .eq('estado', 'pendiente')
      .order('creado_en', { ascending: false })
      .limit(50);
    if (r.error) throw r.error;
    piezasPendientes = await Promise.all(
      (r.data ?? []).map(async (p) => {
        let mediaUrl: string | null = null;
        if (p.media_path) {
          const firma = await admin.storage.from('bus').createSignedUrl(p.media_path, HORA_FIRMA_S);
          mediaUrl = firma.data?.signedUrl ?? null; // sin firma ⇒ tarjeta sin preview, no tarjeta rota
        }
        return {
          id: p.id,
          rutina: p.rutina,
          carpeta: p.carpeta,
          titulo: p.titulo,
          tipo: p.tipo,
          copyMd: p.copy_md,
          mediaUrl,
          creadoEn: p.creado_en,
        };
      }),
    );
  } catch (e) {
    errores.push('piezas: no se pudieron leer (bus_pieza)');
    logger.error('bus.leer_piezas', { err: e instanceof Error ? e.message : String(e) });
  }

  let ordenesRecientes: OrdenBus[] = [];
  let killSwitchPendiente = false;
  try {
    const r = await admin
      .from('bus_orden')
      .select('id, tipo, rutina, estado, creado_en, resultado')
      .order('creado_en', { ascending: false })
      .limit(10);
    if (r.error) throw r.error;
    ordenesRecientes = (r.data ?? []).map((o) => ({
      id: o.id,
      tipo: o.tipo,
      rutina: o.rutina,
      estado: o.estado,
      creadoEn: o.creado_en,
      resultado: o.resultado,
    }));
    killSwitchPendiente = ordenesRecientes.some(
      (o) => o.estado === 'pendiente' && (o.tipo === 'kill_switch_on' || o.tipo === 'kill_switch_off'),
    );
  } catch (e) {
    errores.push('órdenes: no se pudieron leer (bus_orden)');
    logger.error('bus.leer_ordenes', { err: e instanceof Error ? e.message : String(e) });
  }

  return { rutinas, piezasPendientes, ordenesRecientes, killSwitchPendiente, errores };
}

// ── Mutaciones (siempre tras requireSuperadmin — lo garantiza la página) ────

export async function crearOrden(
  tipo: TipoOrdenUi,
  rutina: string | null,
  actorEmail: string,
  payload: Record<string, unknown> = {},
): Promise<void> {
  const invalida = validarOrden(tipo, rutina, payload);
  if (invalida) throw new Error(invalida);
  const { error } = await supabaseAdmin()
    .from('bus_orden')
    .insert({ tipo, rutina, payload, creado_por: actorEmail });
  if (error) throw new Error(`No se pudo encolar la orden: ${error.message}`);
}

export async function resolverPieza(
  id: string,
  accion: 'aprobada' | 'descartada',
  actorEmail: string,
): Promise<void> {
  // Anclado a `pendiente` (patrón de la cola 0117): dos taps del teléfono no
  // deben resolver dos veces. Sin fila afectada ⇒ ya la resolvió otro tap.
  const { data, error } = await supabaseAdmin()
    .from('bus_pieza')
    .update({ estado: accion, resuelto_en: new Date().toISOString(), resuelto_por: actorEmail })
    .eq('id', id)
    .eq('estado', 'pendiente')
    .select('id');
  if (error) throw new Error(`No se pudo resolver la pieza: ${error.message}`);
  if (!data?.length) throw new Error('Esa pieza ya estaba resuelta.');
}

// ── PRs abiertos (GitHub) — la fuente que depende de una llave de Javier ────

export interface PrAbierto {
  numero: number;
  titulo: string;
  url: string;
  rama: string;
  creadoEn: string;
}

/** Tres estados DISTINTOS a propósito (regla de la casa: una fuente caída no
 *  se disfraza de 0): `sin_token` — la llave GITHUB_TOKEN sigue pendiente en
 *  Vercel; `error` — hay token pero GitHub no contestó; `ok` — la lista real,
 *  aunque venga vacía. */
export type ResultadoPrs =
  | { estado: 'sin_token' }
  | { estado: 'error' }
  | { estado: 'ok'; prs: PrAbierto[] };

export async function getPrsAbiertos(): Promise<ResultadoPrs> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return { estado: 'sin_token' };
  const repo = process.env.GITHUB_REPO || 'javiercamarapp/likida.ai';
  try {
    const r = await fetch(`https://api.github.com/repos/${repo}/pulls?state=open&per_page=20`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(4000),
      cache: 'no-store',
    });
    if (!r.ok) throw new Error(`GitHub ${r.status}`);
    const prs = (await r.json()) as Array<{
      number: number;
      title: string;
      html_url: string;
      head: { ref: string };
      created_at: string;
    }>;
    return {
      estado: 'ok',
      prs: prs.map((p) => ({
        numero: p.number,
        titulo: p.title,
        url: p.html_url,
        rama: p.head.ref,
        creadoEn: p.created_at,
      })),
    };
  } catch (e) {
    logger.error('bus.github_prs', { err: e instanceof Error ? e.message : String(e) });
    return { estado: 'error' };
  }
}
