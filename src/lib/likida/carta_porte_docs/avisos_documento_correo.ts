// ═══════════════════════════════════════════════════════════════════════════
// AVISOS DE DOCUMENTO POR CORREO (OLA1-A3) — el segundo canal del worker de la bandeja.
//
// Hasta hoy el aviso de «documento dudoso» (`hallazgos`) y de «no se pudo leer» (`agotado`) salía SOLO por WhatsApp/Meta, y con
// la verificación de negocio de Meta rechazada el aviso no salía: el documento quedaba visible solo en la bandeja. Ahora el
// mismo aviso sale también por correo (`avisos_correo`), a quien corresponda:
//
//   · `hallazgos`: la persona asignada al documento (T-A3-31), el correo de REVISIÓN de la configuración de salida y, si no hay,
//     el de alerta;
//   · `agotado`:   el correo de alerta y, si no hay, el de revisión;
//   · en el primer mes de la flota, además, los revisores por departamento (`primer_mes.ts`).
//
// Sin ningún destinatario no se manda nada (y el worker lo sabe: ver `correosAviso`). El texto es el mismo que el de WhatsApp
// (`armarAviso`): solo conteos y un código del documento, nunca campos leídos ni el nombre del archivo.
// ═══════════════════════════════════════════════════════════════════════════

import { enviarAvisoCorreo, limpiarDestinatarios, type ResultadoAvisoCorreo } from '../avisos_correo';
import * as repo from './repo';
import type { DocumentoFila, TipoAvisoDoc } from './repo';
import { revisoresPrimerMes } from './primer_mes';
import { leerConfigSalida } from './salida_config';
import { armarAviso } from './worker';

/** A quién le llega por correo el aviso de ESTE documento. Nunca lanza: un fallo de lectura es «sin destinatarios». */
export async function correosAvisoDoc(tenantId: string, documentoId: string, tipo: TipoAvisoDoc): Promise<string[]> {
  const lista: Array<string | null> = [];
  try {
    const config = await leerConfigSalida(tenantId);
    if (tipo === 'hallazgos') {
      const asignado = (await repo.revisoresDeDocumentos(tenantId, [documentoId])).get(documentoId);
      lista.push(asignado ? ((await repo.usuarioRevisor(tenantId, asignado))?.email ?? null) : null);
      lista.push(config.destinatarioRevisionCorreo ?? config.destinatarioAlertaCorreo);
    } else {
      lista.push(config.destinatarioAlertaCorreo ?? config.destinatarioRevisionCorreo);
    }
  } catch { /* sin configuración legible: solo los revisores del primer mes, si los hay */ }
  lista.push(...(await revisoresPrimerMes(tenantId)));
  return limpiarDestinatarios(lista);
}

const ASUNTO: Record<TipoAvisoDoc, { asunto: string; titulo: string }> = {
  hallazgos: { asunto: 'Carta Porte: documento por revisar', titulo: 'Un documento necesita tu revisión' },
  agotado: { asunto: 'Carta Porte: no se pudo leer un documento', titulo: 'Un documento no se pudo leer' },
};

export async function enviarAvisoDocPorCorreo(a: { tenantId: string; tipo: TipoAvisoDoc; doc: DocumentoFila; liga: string; para: string[] }): Promise<ResultadoAvisoCorreo> {
  const { texto } = armarAviso(a.tipo, a.doc, a.liga);
  const t = ASUNTO[a.tipo];
  return enviarAvisoCorreo({
    tenantId: a.tenantId, agente: 'carta_porte', tipo: `documento_${a.tipo}`, asunto: t.asunto, titulo: t.titulo,
    parrafos: [texto.replace(/⚠️|📄/g, '').replace(a.liga, '').replace(/\s+/g, ' ').trim()],
    referencia: a.doc.id.replace(/[^0-9a-f]/gi, '').slice(0, 8), liga: a.liga, para: a.para, clave: `${a.doc.id}:${a.tipo}`,
  });
}
