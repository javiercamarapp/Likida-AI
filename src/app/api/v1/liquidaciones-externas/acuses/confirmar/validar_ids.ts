// Un route.ts de Next solo puede exportar manejadores y su configuración: la validación del cuerpo vive aparte (y se prueba suelta).
import { CampoInvalido } from '../../../_escritura';
import { MAX_IDS_CONFIRMACION } from '@/lib/likida/liquidacion_externa/servicio';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Un elemento de `ids`: el uuid solo (forma anterior: confirma lo que haya) o `{ id, respuestaEn }` (confirma SOLO ese acuse). */
export interface ConfirmacionPedida { id: string; respuestaEn: string | null }

const INSTANTE = /^\d{4}-\d{2}-\d{2}[T ][0-9:.]{8,15}(Z|[+-][0-9:]{2,5})$/;

/**
 * A37-S11-02: valida el cuerpo y devuelve cada confirmación con el instante del acuse que el integrador LEYÓ
 * (`respuestaEn` de `GET …/acuses`). Sin él (forma anterior, solo el uuid) no se puede saber qué acuse vio.
 */
export function validarConfirmaciones(crudo: unknown): ConfirmacionPedida[] {
  if (crudo === null || typeof crudo !== 'object' || Array.isArray(crudo)) {
    throw new CampoInvalido('cuerpo', 'El cuerpo tiene que ser un objeto `{ "ids": [...] }`.');
  }
  const extra = Object.keys(crudo as Record<string, unknown>).filter((k) => k !== 'ids');
  if (extra.length > 0) throw new CampoInvalido(extra[0], `Campo desconocido: \`${extra[0].slice(0, 40)}\`. Solo se acepta \`ids\`.`);
  const ids = (crudo as { ids?: unknown }).ids;
  if (!Array.isArray(ids) || ids.length === 0) throw new CampoInvalido('ids', '`ids` tiene que ser una lista con al menos un id.');
  if (ids.length > MAX_IDS_CONFIRMACION) throw new CampoInvalido('ids', `\`ids\` admite hasta ${MAX_IDS_CONFIRMACION} ids por llamada.`);
  return ids.map((el, i) => {
    if (typeof el === 'string') {
      if (!UUID.test(el)) throw new CampoInvalido(`ids[${i}]`, `\`ids[${i}]\` tiene que ser el uuid de una liquidación.`);
      return { id: el.toLowerCase(), respuestaEn: null };
    }
    if (el !== null && typeof el === 'object' && !Array.isArray(el)) {
      const o = el as Record<string, unknown>;
      const otro = Object.keys(o).find((k) => k !== 'id' && k !== 'respuestaEn');
      if (otro) throw new CampoInvalido(`ids[${i}].${otro.slice(0, 40)}`, `Campo desconocido en \`ids[${i}]\`. Solo \`id\` y \`respuestaEn\`.`);
      if (typeof o.id !== 'string' || !UUID.test(o.id)) throw new CampoInvalido(`ids[${i}].id`, `\`ids[${i}].id\` tiene que ser el uuid de una liquidación.`);
      if (typeof o.respuestaEn !== 'string' || !INSTANTE.test(o.respuestaEn) || Number.isNaN(Date.parse(o.respuestaEn))) {
        throw new CampoInvalido(`ids[${i}].respuestaEn`, `\`ids[${i}].respuestaEn\` tiene que ser el \`respuestaEn\` tal como lo devolvió \`GET …/acuses\`.`);
      }
      return { id: o.id.toLowerCase(), respuestaEn: o.respuestaEn };
    }
    throw new CampoInvalido(`ids[${i}]`, `\`ids[${i}]\` tiene que ser el uuid de una liquidación o \`{ "id", "respuestaEn" }\`.`);
  });
}

export function validarIds(crudo: unknown): string[] {
  if (crudo === null || typeof crudo !== 'object' || Array.isArray(crudo)) {
    throw new CampoInvalido('cuerpo', 'El cuerpo tiene que ser un objeto `{ "ids": [...] }`.');
  }
  const extra = Object.keys(crudo as Record<string, unknown>).filter((k) => k !== 'ids');
  if (extra.length > 0) throw new CampoInvalido(extra[0], `Campo desconocido: \`${extra[0].slice(0, 40)}\`. Solo se acepta \`ids\`.`);
  const ids = (crudo as { ids?: unknown }).ids;
  if (!Array.isArray(ids) || ids.length === 0) throw new CampoInvalido('ids', '`ids` tiene que ser una lista con al menos un id.');
  if (ids.length > MAX_IDS_CONFIRMACION) throw new CampoInvalido('ids', `\`ids\` admite hasta ${MAX_IDS_CONFIRMACION} ids por llamada.`);
  return ids.map((id, i) => {
    if (typeof id !== 'string' || !UUID.test(id)) throw new CampoInvalido(`ids[${i}]`, `\`ids[${i}]\` tiene que ser el uuid de una liquidación.`);
    return id.toLowerCase();
  });
}
