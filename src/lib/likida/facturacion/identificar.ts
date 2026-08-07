// ═══════════════════════════════════════════════════════════════════════════
// ¿DE QUÉ COMERCIO ES ESTE TICKET?
//
// Primer paso de todo el módulo: sin comercio no se sabe qué campos pedirle al
// extractor ni a qué portal ir.
//
// Mandar un ticket al comercio equivocado NO falla de forma visible: falla
// pidiéndole a la oficina un "Web ID" que ese ticket nunca tuvo, y nadie
// entiende por qué. Por eso, sin respuesta única, no se adivina.
// ═══════════════════════════════════════════════════════════════════════════

import { COMERCIOS, type Comercio } from './comercios';

export interface SeñalesTicket {
  /** Liga de facturación (del QR o leída del papel). La señal más fuerte. */
  urlFacturacion?: string;
  /** RFC del emisor, ya validado con dígito verificador. */
  rfcEmisor?: string;
  /** Texto crudo del ticket. La señal más débil: pasó por visión. */
  textoTicket?: string;
}

/**
 * Prioridad deliberada: dominio → RFC → texto.
 *
 * El dominio viene del QR y no pasó por OCR. El RFC pasó por OCR pero lo
 * respalda el dígito verificador. El texto es lo único que puede confundirse
 * con la publicidad impresa de otra marca en el mismo papel.
 */
export function identificarComercio(señales: SeñalesTicket): Comercio | null {
  const url = señales.urlFacturacion?.toLowerCase() ?? '';
  if (url) {
    const porDominio = COMERCIOS.find((c) => c.reconocer.dominios?.some((d) => url.includes(d.toLowerCase())));
    if (porDominio) return porDominio;
  }

  const rfc = señales.rfcEmisor?.trim().toUpperCase() ?? '';
  if (rfc) {
    const porRfc = COMERCIOS.find((c) => c.reconocer.rfc?.some((r) => r.toUpperCase() === rfc));
    if (porRfc) return porRfc;
  }

  const texto = señales.textoTicket?.toUpperCase() ?? '';
  if (texto) {
    // Palabra completa, no subcadena: "ADO" (autobuses) es substring literal de
    // "OPERADORA" — un ticket real de café con emisor "OPERADORA DE CAFE
    // PENINSULAR" se identificaba como la línea de camiones ADO y mandaba al
    // operador a un portal que le pedía "número de boleto" a un café. Cualquier
    // token corto (3-4 letras) puede colisionar así contra palabras comunes en
    // español que lo contienen.
    const esPalabraCompleta = (t: string) => {
      const escapado = t.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`\\b${escapado}\\b`).test(texto);
    };
    const coincidencias = COMERCIOS.filter((c) => c.reconocer.texto?.some(esPalabraCompleta));
    // Dos marcas impresas en el mismo papel = no hay respuesta única.
    if (coincidencias.length === 1) return coincidencias[0];
  }

  return null;
}
