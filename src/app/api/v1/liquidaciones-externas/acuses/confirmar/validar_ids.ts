// Un route.ts de Next solo puede exportar manejadores y su configuración: la validación del cuerpo vive aparte (y se prueba suelta).
import { CampoInvalido } from '../../../_escritura';
import { MAX_IDS_CONFIRMACION } from '@/lib/likida/liquidacion_externa/servicio';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
