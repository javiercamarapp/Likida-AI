// ═══════════════════════════════════════════════════════════════════════════
// LECTOR F3 — correo/captura con el bloque de rótulos de bienes, unidad, embalaje y peso — T-A3-61.
//
// Forma real de la muestra: arriba el domicilio del destinatario en líneas sueltas (nombre, calle, colonia, «ciudad,estado»,
// «C.P. 00000», «Ant SR. …», «TEL …»), luego «Caja 00000» sin dos puntos, y el bloque de rótulos con el VALOR EN LA LÍNEA DE
// ABAJO: BIENES TRANSPORTADOS, DESCRIPCIÓN BIENES TRANSPORTADOS (con la clave de 8 dígitos pegada), CANTIDAD («1175 CAJAS DE …»),
// CLAVE UNIDAD SAT y EMBALAJE «CLABE» SAT con «(20) CAJA» (el paréntesis es la cantidad, no una clave), DESCRIPCIÓN DEL EMBALAJE,
// PESO EN KILOS («11385.75KILOS DE …») y FRACCIÓN ARANCELARIA, donde la captura suele llegar CORTADA sin valor.
// ═══════════════════════════════════════════════════════════════════════════

import type { Extraccion } from '../campos';
import type { ContenidoDoc } from '../contenido';
import type { ResultadoLector } from '../derivar';
import { leerRotulosCorreo, rotuloDeLinea, separarInterfaz } from '../rotulos';
import { CONF_CORREO, CONF_TEXTO_LIBRE, campoDeTexto, cerrarLectorCorreo, resolucionDe, sinTexto, textoDeCorreo, type OpcionesLectorCorreo } from './correo';

const CAJA = /^caja\s*(?:no\.?|#|n[uú]m(?:ero)?\.?)?\s*[:.]?\s*([A-Z0-9][A-Z0-9-]{2,13})$/i;
const TEL = /^(?:tel(?:[eé]fono)?|cel(?:ular)?)\.?\s*[:.]?\s*(\+?[\d\s().-]{7,})$/i;
const ATENCION = /^(?:ant|atn|attn|atenci[oó]n)\.?\s*[:.]?\s*(.+)$/i;
const CP = /\bC\.?\s?P\.?\s*:?\s*(\d{5})\b/i;
const CIUDAD_ESTADO = /^([^,\d]+?)\s*,\s*([^,\d]+)$/;

export function leerCorreoF3(c: ContenidoDoc, o: OpcionesLectorCorreo = {}): ResultadoLector {
  const { texto, transcrita } = textoDeCorreo(c, o);
  if (!texto) return sinTexto('F3', c);
  const lec = leerRotulosCorreo(texto, { resolucion: resolucionDe(c), origen: transcrita ? 'llm' : 'perfil' });
  const e: Extraccion = lec ? lec.extraccion : { campos: {}, mercancias: [] };
  const { lineas } = separarInterfaz(texto);

  // Lo de arriba del primer rótulo: domicilio del destinatario, contacto, teléfono y caja.
  const primerRotulo = lineas.findIndex((l) => l.trim() !== '' && rotuloDeLinea(l));
  const arriba = (primerRotulo < 0 ? lineas : lineas.slice(0, primerRotulo)).map((l) => l.trim()).filter((l) => l !== '');
  const direccion: string[] = [];
  let cp: string | null = null; let tel: string | null = null;
  for (const l of arriba) {
    let m: RegExpExecArray | null;
    if ((m = CAJA.exec(l))) { const k = campoDeTexto('caja_numero', false, m[1], l, CONF_CORREO, transcrita); if (k) e.campos.caja_numero = k; continue; }
    if ((m = TEL.exec(l))) { tel = m[1].replace(/[^\d+]/g, ''); const k = campoDeTexto('contacto_destino_telefono', false, tel, l, CONF_CORREO, transcrita); if (k) e.campos.contacto_destino_telefono = k; continue; }
    if ((m = ATENCION.exec(l))) { const k = campoDeTexto('contacto_destino_nombre', false, m[1].trim(), l, CONF_TEXTO_LIBRE, transcrita); if (k) e.campos.contacto_destino_nombre = k; continue; }
    if ((m = CP.exec(l))) { cp = m[1]; const k = campoDeTexto('destino_cp', false, cp, l, CONF_CORREO, transcrita); if (k) e.campos.destino_cp = k; continue; }
    if ((m = CIUDAD_ESTADO.exec(l))) { const k = campoDeTexto('destino_estado', false, m[2].trim(), l, CONF_TEXTO_LIBRE, transcrita); if (k && /^[A-Z]{2,3}$/.test(k.valor ?? '')) e.campos.destino_estado = k; }
    direccion.push(l);
  }
  // Solo si de verdad hay un domicilio (código postal o teléfono): sin eso, «Buen día, equipo» no es un destinatario.
  if ((cp || tel) && direccion.length > 0) {
    const [nombre, ...resto] = direccion;
    const n = campoDeTexto('destino_nombre', false, nombre, nombre, CONF_TEXTO_LIBRE, transcrita); if (n) e.campos.destino_nombre = n;
    if (resto.length > 0) { const d = campoDeTexto('destino_domicilio', false, resto.join(', '), resto.join(' / '), CONF_TEXTO_LIBRE, transcrita); if (d) e.campos.destino_domicilio = d; }
  }
  if (!lec?.firma && !(cp || tel)) return cerrarLectorCorreo('F3', e, null, { avisos: ['No se reconoció el bloque de rótulos «BIENES TRANSPORTADOS…» en el correo.'] });
  return cerrarLectorCorreo('F3', e, lec, { resolucion: resolucionDe(c) });
}
