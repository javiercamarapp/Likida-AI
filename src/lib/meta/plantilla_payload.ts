// ═══════════════════════════════════════════════════════════════════════════
// ARMADO PURO del bloque `template` de la Cloud API de WhatsApp.
//
// Sin I/O: se prueba solo y lo usan `sendTemplate` (client.ts) y el catálogo
// de plantillas (plantillas_catalogo.ts) para validar ANTES de llamar a Meta.
//
// ── CONTRATO DE META (consultado 1-oct-2026) ───────────────────────────────
// Un mensaje de plantilla es `type: "template"` con `template.components`, un
// arreglo con, en este orden, (opcional) `header`, (opcional) `body` y los
// `button`. Estructura documentada en:
//   · https://developers.facebook.com/docs/whatsapp/api/messages/message-templates/interactive-message-templates/
//     (parámetros de header/body y botones `quick_reply` con `payload` y `url`
//     con el sufijo dinámico en `text`; `index` es el lugar del botón, desde 0)
//   · https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview
//     (plantillas: lo único que se puede enviar fuera de la ventana de 24 h)
// Header con imagen/documento: `{type:"image", image:{link|id}}` y
// `{type:"document", document:{link|id, filename}}` (ejemplo de la comunidad con
// imagen: https://stackoverflow.com/questions/76527999 — misma forma).
//
// ── LO QUE UNA PLANTILLA NO PUEDE HACER: PEDIR UBICACIÓN ───────────────────
// La Cloud API NO tiene un botón de «solicitud de ubicación» en plantillas. La
// solicitud de ubicación es un mensaje INTERACTIVO (`location_request_message`,
// ver `enviarSolicitudUbicacion` en client.ts), que solo se entrega dentro de la
// ventana de 24 h. El patrón correcto para pedirla fuera de ventana es: plantilla
// con botón de respuesta rápida «Compartir ubicación» → el chofer lo aprieta →
// eso ABRE la ventana → se responde con la solicitud interactiva. Por eso aquí no
// existe ningún `location_request` de plantilla: inventarlo mandaría un payload
// que Meta rechaza.
//
// ── PARÁMETROS DE TEXTO ────────────────────────────────────────────────────
// Meta rechaza (#132018) los parámetros con saltos de línea, tabuladores o más
// de cuatro espacios seguidos, y los vacíos. Se normalizan (espacios colapsados)
// y lo vacío se rechaza AQUÍ, con el motivo dicho, en vez de gastar una llamada.
// ═══════════════════════════════════════════════════════════════════════════

/** Tope del texto de un parámetro de cuerpo (el cuerpo entero de una plantilla
 *  admite 1,024 caracteres). */
export const MAX_PARAMETRO_CUERPO = 1024;
/** El texto de un encabezado admite 60 caracteres. */
export const MAX_ENCABEZADO_TEXTO = 60;
/** Una plantilla admite hasta 10 botones. */
export const MAX_BOTONES_PLANTILLA = 10;
/** Conservador: el payload de un botón de respuesta rápida es lo que nos
 *  devuelve el webhook al apretarlo; se limita a 128 para quedar por debajo de
 *  cualquiera de los topes documentados. */
export const MAX_PAYLOAD_BOTON = 128;
/** Sufijo dinámico de un botón URL. */
export const MAX_SUFIJO_URL = 2000;
export const MAX_NOMBRE_ARCHIVO = 240;

export type MedioPlantilla =
  | { link: string; id?: undefined }
  | { id: string; link?: undefined };

export type EncabezadoPlantilla =
  | { tipo: 'texto'; texto: string }
  | ({ tipo: 'documento'; nombreArchivo?: string } & MedioPlantilla)
  | ({ tipo: 'imagen' } & MedioPlantilla);

export type BotonPlantilla =
  | { tipo: 'respuesta_rapida'; indice: number; payload: string }
  | { tipo: 'url'; indice: number; sufijo: string };

export interface OpcionesPlantilla {
  /** Variables del cuerpo, en orden ({{1}}, {{2}}…). */
  parametros?: string[];
  encabezado?: EncabezadoPlantilla;
  botones?: BotonPlantilla[];
}

export type ComponentePlantilla = Record<string, unknown>;

export type ArmadoPlantilla =
  | { ok: true; componentes: ComponentePlantilla[] | undefined }
  | { ok: false; error: string };

/** Colapsa saltos de línea, tabuladores y espacios repetidos. */
export function normalizarParametro(valor: string): string {
  return String(valor ?? '').replace(/\s+/g, ' ').trim();
}

function medioValido(m: { link?: string; id?: string }, que: string): string | null {
  const tieneLink = typeof m.link === 'string' && m.link.trim() !== '';
  const tieneId = typeof m.id === 'string' && m.id.trim() !== '';
  if (tieneLink === tieneId) return `el encabezado ${que} necesita exactamente uno: link o id`;
  if (tieneLink) {
    let u: URL;
    try { u = new URL(m.link as string); } catch { return `el link del encabezado ${que} no es una URL válida`; }
    if (u.protocol !== 'https:') return `el link del encabezado ${que} debe ser https`;
  }
  return null;
}

function armarEncabezado(e: EncabezadoPlantilla): { ok: true; componente: ComponentePlantilla } | { ok: false; error: string } {
  if (e.tipo === 'texto') {
    const t = normalizarParametro(e.texto);
    if (!t) return { ok: false, error: 'el encabezado de texto está vacío' };
    if (t.length > MAX_ENCABEZADO_TEXTO) return { ok: false, error: `el encabezado de texto pasa de ${MAX_ENCABEZADO_TEXTO} caracteres` };
    return { ok: true, componente: { type: 'header', parameters: [{ type: 'text', text: t }] } };
  }
  if (e.tipo === 'imagen') {
    const malo = medioValido(e, 'de imagen');
    if (malo) return { ok: false, error: malo };
    return { ok: true, componente: { type: 'header', parameters: [{ type: 'image', image: e.link ? { link: e.link.trim() } : { id: (e.id as string).trim() } }] } };
  }
  if (e.tipo === 'documento') {
    const malo = medioValido(e, 'de documento');
    if (malo) return { ok: false, error: malo };
    const nombre = e.nombreArchivo === undefined ? undefined : normalizarParametro(e.nombreArchivo);
    if (nombre !== undefined && (nombre === '' || nombre.length > MAX_NOMBRE_ARCHIVO)) {
      return { ok: false, error: 'el nombre del archivo del encabezado está vacío o es demasiado largo' };
    }
    const documento: Record<string, unknown> = e.link ? { link: e.link.trim() } : { id: (e.id as string).trim() };
    if (nombre) documento.filename = nombre;
    return { ok: true, componente: { type: 'header', parameters: [{ type: 'document', document: documento }] } };
  }
  return { ok: false, error: 'tipo de encabezado no soportado' };
}

function armarBoton(b: BotonPlantilla): { ok: true; componente: ComponentePlantilla } | { ok: false; error: string } {
  if (b.tipo === 'respuesta_rapida') {
    const payload = typeof b.payload === 'string' ? b.payload.trim() : '';
    if (!payload) return { ok: false, error: `el botón ${b.indice} no tiene payload` };
    if (payload.length > MAX_PAYLOAD_BOTON) return { ok: false, error: `el payload del botón ${b.indice} pasa de ${MAX_PAYLOAD_BOTON} caracteres` };
    return { ok: true, componente: { type: 'button', sub_type: 'quick_reply', index: String(b.indice), parameters: [{ type: 'payload', payload }] } };
  }
  if (b.tipo === 'url') {
    const sufijo = typeof b.sufijo === 'string' ? b.sufijo.trim() : '';
    if (!sufijo) return { ok: false, error: `el botón URL ${b.indice} no tiene sufijo` };
    if (/\s/.test(sufijo)) return { ok: false, error: `el sufijo del botón URL ${b.indice} no puede llevar espacios` };
    if (sufijo.length > MAX_SUFIJO_URL) return { ok: false, error: `el sufijo del botón URL ${b.indice} es demasiado largo` };
    return { ok: true, componente: { type: 'button', sub_type: 'url', index: String(b.indice), parameters: [{ type: 'text', text: sufijo }] } };
  }
  return { ok: false, error: 'tipo de botón no soportado' };
}

/**
 * Arma `template.components`. `componentes` es `undefined` cuando la plantilla no
 * lleva variables (así el payload de siempre no cambia de forma).
 */
export function armarComponentesPlantilla(op: OpcionesPlantilla = {}): ArmadoPlantilla {
  const componentes: ComponentePlantilla[] = [];

  if (op.encabezado) {
    const h = armarEncabezado(op.encabezado);
    if (!h.ok) return h;
    componentes.push(h.componente);
  }

  const parametros = op.parametros ?? [];
  if (parametros.length > 0) {
    const params: ComponentePlantilla[] = [];
    for (let i = 0; i < parametros.length; i++) {
      const t = normalizarParametro(parametros[i]);
      if (!t) return { ok: false, error: `el parámetro {{${i + 1}}} del cuerpo está vacío` };
      if (t.length > MAX_PARAMETRO_CUERPO) return { ok: false, error: `el parámetro {{${i + 1}}} del cuerpo pasa de ${MAX_PARAMETRO_CUERPO} caracteres` };
      params.push({ type: 'text', text: t });
    }
    componentes.push({ type: 'body', parameters: params });
  }

  const botones = op.botones ?? [];
  if (botones.length > MAX_BOTONES_PLANTILLA) {
    return { ok: false, error: `una plantilla admite hasta ${MAX_BOTONES_PLANTILLA} botones` };
  }
  const indices = new Set<number>();
  for (const b of botones) {
    if (!Number.isInteger(b.indice) || b.indice < 0 || b.indice >= MAX_BOTONES_PLANTILLA) {
      return { ok: false, error: `índice de botón inválido: ${String(b.indice)}` };
    }
    if (indices.has(b.indice)) return { ok: false, error: `índice de botón repetido: ${b.indice}` };
    indices.add(b.indice);
  }
  for (const b of [...botones].sort((a, c) => a.indice - c.indice)) {
    const r = armarBoton(b);
    if (!r.ok) return r;
    componentes.push(r.componente);
  }

  return { ok: true, componentes: componentes.length > 0 ? componentes : undefined };
}
