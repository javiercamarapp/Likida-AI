// ═══════════════════════════════════════════════════════════════════════════
// ESTADO DE APROBACIÓN DE LAS PLANTILLAS: catálogo (plantillas_catalogo.ts)
// contra lo que Meta tiene en la cuenta de WhatsApp Business (WABA).
//
// ── NO SE HA EJECUTADO CONTRA META REAL ────────────────────────────────────
// Este módulo se probó contra FIXTURES con la forma documentada de
// `GET /{WABA_ID}/message_templates` (campos name, status, language, category,
// components, rejected_reason; paginación `paging.next`) y de
// `POST /{WABA_ID}/message_templates`
// (https://developers.facebook.com/docs/graph-api/reference/whats-app-business-account/message_templates/).
// Falta la corrida real con credenciales (BLOQUEO EXTERNO). Las funciones de red
// reciben `fetch` inyectado: ni las pruebas ni CI llaman a graph.facebook.com.
//
// El token solo viaja en el encabezado Authorization; nunca se escribe en
// mensajes de error ni en la salida.
// ═══════════════════════════════════════════════════════════════════════════
import { CATALOGO_PLANTILLAS, cuerpoCreacionMeta, type PlantillaCatalogo } from './plantillas_catalogo';

export const GRAPH_VERSION_PLANTILLAS = 'v21.0';

export interface ComponenteMeta {
  type: string;
  format?: string;
  text?: string;
  buttons?: Array<{ type: string; text?: string; url?: string }>;
}
export interface PlantillaMeta {
  name: string;
  status: string;
  language: string;
  category?: string;
  components?: ComponenteMeta[];
  rejected_reason?: string;
}

export type VeredictoPlantilla =
  | 'aprobada'
  | 'aprobada_con_desviaciones'
  | 'pendiente'
  | 'rechazada'
  | 'pausada_o_deshabilitada'
  | 'faltante';

export interface ResultadoPlantilla {
  nombre: string;
  idioma: string;
  veredicto: VeredictoPlantilla;
  estadoMeta: string | null;
  /** Qué difiere entre el catálogo y Meta (solo con desviaciones). */
  desviaciones: string[];
  /** Si el envío funcionaría hoy. */
  usable: boolean;
  motivoRechazo?: string;
}

const norm = (t: string | undefined) => (t ?? '').replace(/\s+/g, ' ').trim();

function desviaciones(p: PlantillaCatalogo, m: PlantillaMeta): string[] {
  const d: string[] = [];
  if ((m.category ?? '').toUpperCase() !== p.categoria) {
    d.push(`categoría en Meta: ${m.category ?? 'desconocida'} (catálogo: ${p.categoria}) — una plantilla reclasificada a MARKETING cuesta más y tiene más límites`);
  }
  const cuerpo = m.components?.find((c) => c.type === 'BODY');
  if (!cuerpo) d.push('Meta no devolvió el componente BODY');
  else if (norm(cuerpo.text) !== norm(p.cuerpo)) d.push(`cuerpo distinto en Meta: «${norm(cuerpo.text)}»`);
  const botonesMeta = m.components?.find((c) => c.type === 'BUTTONS')?.buttons ?? [];
  const esperados = p.botones.map((b) => (b.tipo === 'QUICK_REPLY' ? `QUICK_REPLY|${b.texto}` : `URL|${b.texto}|${b.url}`));
  const reales = botonesMeta.map((b) => (b.type === 'QUICK_REPLY' ? `QUICK_REPLY|${b.text}` : `${b.type}|${b.text}|${(b.url ?? '').replace(/\{\{1\}\}$/, '')}`));
  if (JSON.stringify(esperados) !== JSON.stringify(reales)) {
    d.push(`botones distintos: catálogo [${esperados.join(', ')}] vs Meta [${reales.join(', ')}]`);
  }
  const header = m.components?.find((c) => c.type === 'HEADER');
  const headerCat = p.encabezado ? (p.encabezado.tipo === 'TEXT' ? 'TEXT' : p.encabezado.tipo) : null;
  if ((header?.format ?? null) !== headerCat) d.push(`encabezado distinto: catálogo ${headerCat ?? 'ninguno'} vs Meta ${header?.format ?? 'ninguno'}`);
  return d;
}

/** Compara el catálogo con las plantillas que Meta devolvió. Puro. */
export function compararConMeta(
  remotas: readonly PlantillaMeta[],
  catalogo: readonly PlantillaCatalogo[] = CATALOGO_PLANTILLAS,
): ResultadoPlantilla[] {
  return catalogo.map((p): ResultadoPlantilla => {
    const m = remotas.find((r) => r.name === p.nombre && r.language === p.idioma);
    const base = { nombre: p.nombre, idioma: p.idioma };
    if (!m) return { ...base, veredicto: 'faltante', estadoMeta: null, desviaciones: [], usable: false };
    const estado = String(m.status).toUpperCase();
    if (estado === 'APPROVED') {
      const d = desviaciones(p, m);
      return { ...base, veredicto: d.length ? 'aprobada_con_desviaciones' : 'aprobada', estadoMeta: estado, desviaciones: d, usable: true };
    }
    if (estado === 'PENDING' || estado === 'IN_APPEAL') return { ...base, veredicto: 'pendiente', estadoMeta: estado, desviaciones: [], usable: false };
    if (estado === 'REJECTED') {
      return { ...base, veredicto: 'rechazada', estadoMeta: estado, desviaciones: [], usable: false, motivoRechazo: m.rejected_reason };
    }
    return { ...base, veredicto: 'pausada_o_deshabilitada', estadoMeta: estado, desviaciones: [], usable: false };
  });
}

/** Resumen legible, una línea por plantilla. */
export function resumenEstado(res: readonly ResultadoPlantilla[]): string {
  const icono: Record<VeredictoPlantilla, string> = {
    aprobada: 'OK        ', aprobada_con_desviaciones: 'DESVIADA  ', pendiente: 'PENDIENTE ',
    rechazada: 'RECHAZADA ', pausada_o_deshabilitada: 'PAUSADA   ', faltante: 'FALTA     ',
  };
  const lineas = res.map((r) => {
    const extra = r.desviaciones.length ? `\n      · ${r.desviaciones.join('\n      · ')}` : (r.motivoRechazo ? ` (motivo: ${r.motivoRechazo})` : '');
    return `${icono[r.veredicto]} ${r.nombre} [${r.idioma}]${r.estadoMeta ? ` — ${r.estadoMeta}` : ''}${extra}`;
  });
  const usables = res.filter((r) => r.usable).length;
  lineas.push('', `${usables} de ${res.length} usables hoy; ${res.filter((r) => r.veredicto === 'faltante').length} por someter a Meta.`);
  return lineas.join('\n');
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface CredencialesMeta { wabaId: string; token: string }

function validarCredenciales(c: CredencialesMeta): void {
  if (!/^\d{5,25}$/.test(c.wabaId)) throw new Error('WHATSAPP_BUSINESS_ACCOUNT_ID inválido (se esperan solo dígitos)');
  if (!c.token.trim()) throw new Error('falta WHATSAPP_ACCESS_TOKEN');
}

const errorSeguro = (cuerpo: string, token: string) => cuerpo.slice(0, 300).split(token).join('[token]');

/** `GET /{WABA}/message_templates`, siguiendo la paginación. Lanza con motivo si Meta rechaza. */
export async function consultarPlantillasMeta(c: CredencialesMeta, fetchFn: FetchLike, maxPaginas = 20): Promise<PlantillaMeta[]> {
  validarCredenciales(c);
  const todas: PlantillaMeta[] = [];
  let url: string | null =
    `https://graph.facebook.com/${GRAPH_VERSION_PLANTILLAS}/${c.wabaId}/message_templates?fields=name,status,language,category,components,rejected_reason&limit=100`;
  for (let pagina = 0; url && pagina < maxPaginas; pagina++) {
    const res: Response = await fetchFn(url, { headers: { Authorization: `Bearer ${c.token}` } });
    const crudo = await res.text();
    if (!res.ok) throw new Error(`Meta respondió ${res.status}: ${errorSeguro(crudo, c.token)}`);
    let j: { data?: PlantillaMeta[]; paging?: { next?: string } };
    try { j = JSON.parse(crudo); } catch { throw new Error('Meta devolvió una respuesta que no es JSON'); }
    if (!Array.isArray(j.data)) throw new Error('Meta devolvió una respuesta sin `data`');
    todas.push(...j.data);
    url = j.paging?.next ?? null;
    // Solo se sigue un `next` que apunte a graph.facebook.com (no a un host arbitrario con el token).
    if (url && new URL(url).hostname !== 'graph.facebook.com') throw new Error('paginación hacia un host inesperado');
  }
  return todas;
}

/** `POST /{WABA}/message_templates` de UNA plantilla del catálogo. */
export async function crearPlantillaMeta(
  c: CredencialesMeta, p: PlantillaCatalogo, fetchFn: FetchLike,
): Promise<{ ok: true; id: string | null } | { ok: false; error: string }> {
  validarCredenciales(c);
  const res = await fetchFn(`https://graph.facebook.com/${GRAPH_VERSION_PLANTILLAS}/${c.wabaId}/message_templates`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpoCreacionMeta(p)),
  });
  const crudo = await res.text();
  if (!res.ok) return { ok: false, error: `Meta respondió ${res.status}: ${errorSeguro(crudo, c.token)}` };
  try { return { ok: true, id: (JSON.parse(crudo) as { id?: string }).id ?? null }; } catch { return { ok: true, id: null }; }
}
