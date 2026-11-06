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

const GENERICO = 'No se pudo redactar el mensaje con IA. Intenta de nuevo.';

export async function leerRespuestaMensaje(r: Response): Promise<ResultadoMensaje> {
  let cuerpo: Record<string, unknown> | null = null;
  try {
    const v: unknown = await r.json();
    if (v && typeof v === 'object' && !Array.isArray(v)) cuerpo = v as Record<string, unknown>;
  } catch { /* cuerpo vacio o no JSON: se cae al texto generico con el codigo HTTP */ }

  if (!r.ok) {
    const texto = typeof cuerpo?.error === 'string' && cuerpo.error.trim() ? cuerpo.error : null;
    return { ok: false, error: texto ?? `${GENERICO} (HTTP ${r.status})` };
  }
  if (!cuerpo || typeof cuerpo.mensajeWaIa !== 'string') return { ok: false, error: GENERICO };

  const aviso = typeof cuerpo.aviso === 'string' && cuerpo.aviso.trim()
    ? cuerpo.aviso
    : cuerpo.guardado === false ? 'Los textos se redactaron pero NO se guardaron en la ficha: copialos antes de salir.' : null;
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
