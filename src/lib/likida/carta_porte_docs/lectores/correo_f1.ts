// ═══════════════════════════════════════════════════════════════════════════
// LECTOR F1 — correo/captura con la tabla «DATOS DE LA MERCANCÍA» — T-A3-61.
//
// Forma real de la muestra: una tabla de dos columnas (rótulo | valor) que abre con una fila de título «DATOS DE LA MERCANCÍA»
// cuyo valor es la referencia de la caja, y siguen: peso total bruto, descripción del bien transportado, «clave unidad de
// producto SAT» (que es la clave del PRODUCTO), clave de embalaje, cantidad embalaje, «peso por embalaje» (el neto total),
// clave unidad de peso, fracción arancelaria y pedimento. También se lee la variante horizontal (cabecera + N filas).
// El asunto trae referencias internas (DN / TRL) y la caja. Régimen y tipo de materia no vienen: quedan vacíos.
// ═══════════════════════════════════════════════════════════════════════════

import type { CampoValor } from '../campos';
import type { ContenidoDoc } from '../contenido';
import type { ResultadoLector } from '../derivar';
import { leerRotulosCorreo } from '../rotulos';
import { cerrarLectorCorreo, resolucionDe, sinTexto, textoDeCorreo, type OpcionesLectorCorreo } from './correo';

const TRL = /\bTRL[\s#:.-]*([A-Z0-9]{3,14})\b/i;
const CAJA_FORMA = /^[A-Z0-9-]{3,14}$/i;

export function leerCorreoF1(c: ContenidoDoc, o: OpcionesLectorCorreo = {}): ResultadoLector {
  const { texto, transcrita } = textoDeCorreo(c, o);
  if (!texto) return sinTexto('F1', c);
  const lec = leerRotulosCorreo(texto, { resolucion: resolucionDe(c), origen: transcrita ? 'llm' : 'perfil' });
  if (!lec) return cerrarLectorCorreo('F1', { campos: {}, mercancias: [] }, null, { avisos: ['No se reconoció la tabla «DATOS DE LA MERCANCÍA» en el correo.'] });
  // Sin la firma de la tabla (título «DATOS DE LA MERCANCÍA» o un rótulo engañoso) y al menos 3 rótulos, unas líneas «Cantidad: 10» sueltas no son F1.
  if (!lec.firma || (lec.reconocidos < 3 && !lec.capturaIncompleta)) return cerrarLectorCorreo('F1', { campos: {}, mercancias: [] }, null, { avisos: ['El correo no trae la tabla «DATOS DE LA MERCANCÍA».'] });
  const e = lec.extraccion;
  // La caja: el asunto («TRL 20205») y el valor de la fila de título de la tabla; si coinciden, más seguro.
  if (!e.campos.caja_numero) {
    const trl = TRL.exec(lec.asunto ?? '')?.[1]?.toUpperCase() ?? null;
    const tit = lec.tituloTabla && CAJA_FORMA.test(lec.tituloTabla.trim()) && /\d/.test(lec.tituloTabla) ? lec.tituloTabla.trim().toUpperCase() : null;
    const cand = trl ?? tit;
    if (cand) {
      const coinciden = !!trl && !!tit && trl === tit;
      const cv: CampoValor = {
        valor: cand, confianza: coinciden ? 0.7 : 0.55, evidencia: `${trl ? `asunto: TRL ${trl}` : ''}${trl && tit ? ' · ' : ''}${tit ? `título de la tabla: ${tit}` : ''}`.slice(0, 200), origen: 'derivado',
        notas: [coinciden ? 'La caja coincide en el asunto (TRL) y en el título de la tabla: confírmala contra el documento.' : 'La caja salió del asunto o del título de la tabla: confírmala contra el documento.'],
      };
      e.campos.caja_numero = cv;
    }
  }
  return cerrarLectorCorreo('F1', e, lec, { resolucion: resolucionDe(c) });
}
