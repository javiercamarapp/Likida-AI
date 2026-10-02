import { aBuffer } from './bytes';
import { parseCfdiXml, type CfdiXmlData } from '../intake/cfdi_xml';

// ═══════════════════════════════════════════════════════════════════════════
// LECTURA SEGURA DEL XML QUE LLEGA POR CORREO (buzón de facturas, Agente 9).
//
// Un CFDI NUNCA lleva un DTD: el Anexo 20 del SAT define la estructura por XSD y
// no admite declaraciones `<!DOCTYPE>`/`<!ENTITY>`. Eso vuelve trivial la defensa
// contra los dos ataques clásicos del XML:
//
//   · XXE (entidad externa): `<!ENTITY x SYSTEM "file:///etc/passwd">` que el
//     parser resuelve y devuelve dentro de un campo (exfiltración) o dispara una
//     petición de red (SSRF).
//   · «Billion laughs» / expansión cuadrática: entidades internas anidadas que
//     explotan en gigabytes.
//
// En lugar de confiar en la configuración de entidades del parser, se RECHAZA
// cualquier documento que declare un DTD ANTES de parsearlo: sin DTD no hay
// entidades que resolver. (`fast-xml-parser` tampoco resuelve entidades externas,
// pero «no lo hace hoy» no es una garantía que este código deba heredar.)
//
// Además: tope de tamaño, codificación declarada y cuerpo realmente XML.
// Referencias: OWASP XML External Entity Prevention Cheat Sheet
// (https://cheatsheetseries.owasp.org/cheatsheets/XML_External_Entity_Prevention_Cheat_Sheet.html).
// ═══════════════════════════════════════════════════════════════════════════

/** Un CFDI pesa decenas de KB; 4 MB ya es un archivo equivocado (mismo tope que el panel). */
export const MAX_XML_BYTES = 4 * 1024 * 1024;

export type MotivoXmlRechazado =
  | 'vacio' | 'demasiado_grande' | 'codificacion' | 'dtd' | 'no_es_xml' | 'no_es_cfdi';

export type ResultadoXmlSeguro =
  | { ok: true; texto: string; cfdi: CfdiXmlData }
  | { ok: false; motivo: MotivoXmlRechazado };

/** ¿El texto declara un DTD, entidades o elementos? (case-insensitive, con espacios raros). */
export function declaraDtd(texto: string): boolean {
  return /<!\s*(doctype|entity|element|attlist|notation)\b/i.test(texto);
}

function decodificar(bytes: Uint8Array): string | null {
  const b = aBuffer(bytes);
  // UTF-16 (BOM FF FE / FE FF) o con bytes nulos: un CFDI del SAT es UTF-8. No se adivina.
  if ((b[0] === 0xff && b[1] === 0xfe) || (b[0] === 0xfe && b[1] === 0xff)) return null;
  if (b.subarray(0, Math.min(b.length, 200)).includes(0)) return null;
  const sinBom = b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf ? b.subarray(3) : b;
  const cabeza = sinBom.subarray(0, 200).toString('latin1');
  const declarada = /<\?xml[^>]*encoding\s*=\s*["']([^"']+)["']/i.exec(cabeza)?.[1]?.toLowerCase();
  if (declarada && !['utf-8', 'utf8', 'iso-8859-1', 'latin1', 'windows-1252'].includes(declarada)) return null;
  return declarada && declarada !== 'utf-8' && declarada !== 'utf8'
    ? sinBom.toString('latin1')
    : sinBom.toString('utf8');
}

/** Rechaza antes de parsear: tamaño, codificación y DTD. */
export function validarXmlEntrante(bytes: Uint8Array): { ok: true; texto: string } | { ok: false; motivo: MotivoXmlRechazado } {
  if (bytes.length === 0) return { ok: false, motivo: 'vacio' };
  if (bytes.length > MAX_XML_BYTES) return { ok: false, motivo: 'demasiado_grande' };
  const texto = decodificar(bytes);
  if (texto === null) return { ok: false, motivo: 'codificacion' };
  if (declaraDtd(texto)) return { ok: false, motivo: 'dtd' };
  if (!/^\s*(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*<[A-Za-z_]/.test(texto)) return { ok: false, motivo: 'no_es_xml' };
  return { ok: true, texto };
}

/** El camino completo para un adjunto XML: validar, parsear como CFDI. Nunca lanza. */
export function leerCfdiSeguro(bytes: Uint8Array): ResultadoXmlSeguro {
  const v = validarXmlEntrante(bytes);
  if (!v.ok) return v;
  const cfdi = parseCfdiXml(v.texto);
  if (!cfdi) return { ok: false, motivo: 'no_es_cfdi' };
  return { ok: true, texto: v.texto, cfdi };
}
