import { type TSistema, T_SISTEMA_ES } from '@/lib/i18n/sistema_tr';
// MX-004: lo que el servidor dice al pedir «Mensaje IA» (POST /api/admin/mapa-prospectos/mensaje).
// Antes las dos pantallas hacian `if (!r.ok) return;` y no leian `aviso`/`guardado:false`: un 503 o un
// «los textos NO se guardaron» no se le decia a nadie. Aqui se lee SIEMPRE y se devuelve texto para pintar.

export interface TextosIaRespuesta {
  mensajeWaIa: string;
  correoAsuntoIa: string;
  correoCuerpoIa: string;
  mensajesGeneradosEn: string;
}

export type ResultadoMensaje =
  | { ok: true; datos: TextosIaRespuesta; aviso: string | null }
  | { ok: false; error: string };

const genericoTr = (t: TSistema = T_SISTEMA_ES) => (t('mapa_prospectos_respuesta_mensaje.no_se_pudo_redactar_el_mensaje'));

/** `t` lo pone quien llama (los dos son componentes de cliente con `useT`): este archivo se importa desde el navegador y no puede tocar `next/headers`. */
export async function leerRespuestaMensaje(r: Response, t: TSistema = T_SISTEMA_ES): Promise<ResultadoMensaje> {
  let cuerpo: Record<string, unknown> | null = null;
  try {
    const v: unknown = await r.json();
    if (v && typeof v === 'object' && !Array.isArray(v)) cuerpo = v as Record<string, unknown>;
  } catch { /* cuerpo vacio o no JSON: se cae al texto generico con el codigo HTTP */ }

  if (!r.ok) {
    const texto = typeof cuerpo?.error === 'string' && cuerpo.error.trim() ? cuerpo.error : null;
    return { ok: false, error: texto ?? `${genericoTr(t)} (HTTP ${r.status})` };
  }
  if (!cuerpo || typeof cuerpo.mensajeWaIa !== 'string') return { ok: false, error: genericoTr(t) };

  const aviso = typeof cuerpo.aviso === 'string' && cuerpo.aviso.trim()
    ? cuerpo.aviso
    : cuerpo.guardado === false ? t('mapa_prospectos_respuesta_mensaje.los_textos_se_redactaron_pero_no') : null;
  return {
    ok: true,
    aviso,
    datos: {
      mensajeWaIa: cuerpo.mensajeWaIa,
      correoAsuntoIa: String(cuerpo.correoAsuntoIa ?? ''),
      correoCuerpoIa: String(cuerpo.correoCuerpoIa ?? ''),
      mensajesGeneradosEn: String(cuerpo.mensajesGeneradosEn ?? ''),
    },
  };
}
