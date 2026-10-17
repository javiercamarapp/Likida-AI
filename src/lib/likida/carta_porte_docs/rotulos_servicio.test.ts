// T-A3-53 (cableado): la captura cortada de un correo es alcanzable en el flujo REAL (recibir → procesar → bandeja → aprobar),
// no solo en la prueba pura de `rotulos.ts`. Texto 100 % sintético.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./repo', async () => (await import('./repo_falso.fixture')).api);
vi.mock('../bitacora_escritura', () => ({ anotarBitacora: vi.fn(async () => true) }));
vi.mock('../carta_porte_datos', async (orig) => ({ ...(await orig<typeof import('../carta_porte_datos')>()), getBorradorViaje: vi.fn(async () => null) }));

import { estado, reset } from './repo_falso.fixture';
import { A, ACTOR, llmBoreal, sembrarFlotas, sinAgenteApagado, subir } from './escenario.fixture';
import { emlConAsunto, fotoRemision } from './documentos_sinteticos.fixture';
import { procesarDocumento } from './servicio';
import { aprobarDocumento, corregirCampos } from './bandeja';

beforeEach(() => { reset(); sembrarFlotas(); });

const BLOQUE_COMPLETO = [
  'BIENES TRANSPORTADOS: 30111500 Cemento gris',
  'CLAVE UNIDAD SAT: TNE',
  'EMBALAJE: 4G',
  'PESO EN KILOS: 24000',
  'FRACCIÓN ARANCELARIA: 2523.29.01',
  'PEDIMENTO: 26 47 1234 5670001',
].join('\n');
const BLOQUE_CORTADO = BLOQUE_COMPLETO.split('\n').slice(0, 4).join('\n') + '\nFRACCIÓN ARANCELARIA:';

async function procesar(texto: string) {
  const r = await subir(A, Buffer.from(emlConAsunto(texto)), 'correo.eml');
  const p = await procesarDocumento(A, r.documentoId, { ...sinAgenteApagado, llm: () => llmBoreal() });
  return { id: r.documentoId, p, doc: () => estado.docs.get(r.documentoId)! };
}

describe('T-A3-53 cableado: captura_incompleta en el flujo real', () => {
  it('correo en texto cortado en un rótulo sin valor: bloquea, se guarda y NO se puede aprobar', async () => {
    const { id, p, doc } = await procesar(BLOQUE_CORTADO);
    expect(p).toMatchObject({ ok: true, estado: 'por_revisar', listoParaAprobar: false });
    expect(doc().validacion!.hallazgos.find((h) => h.codigo === 'captura_incompleta')).toMatchObject({ severidad: 'bloqueo' });
    expect(doc().extraccion!.meta!.capturaIncompleta).toEqual({ ultimoRotulo: 'FRACCIÓN ARANCELARIA' });
    await expect(aprobarDocumento(A, id, doc().version, ACTOR)).rejects.toThrow(/No se puede aprobar todavía/);
    expect(estado.docs.get(id)!.estado).toBe('por_revisar'); // nada se aprobó ni se envió
  });

  it('el bloqueo sobrevive a una corrección de la persona (se revalida desde lo guardado)', async () => {
    const { id, doc } = await procesar(BLOQUE_CORTADO);
    await corregirCampos(A, id, doc().version, [{ campo: 'origen_cp', renglon: null, valor: '91700', confirmar: true }], ACTOR.id);
    expect(doc().validacion!.hallazgos.some((h) => h.codigo === 'captura_incompleta')).toBe(true);
  });

  it('el mismo bloque COMPLETO no declara corte (control negativo)', async () => {
    const { doc, p } = await procesar(BLOQUE_COMPLETO);
    expect(p).toMatchObject({ ok: true });
    expect(doc().validacion!.hallazgos.some((h) => h.codigo === 'captura_incompleta')).toBe(false);
    expect(doc().extraccion!.meta!.capturaIncompleta ?? null).toBeNull();
  });

  it('una captura (imagen) se transcribe por el puerto y, si llega cortada, bloquea', async () => {
    const r = await subir(A, await fotoRemision(), 'captura.png');
    const transcribir = vi.fn(async () => BLOQUE_CORTADO);
    await procesarDocumento(A, r.documentoId, { ...sinAgenteApagado, llm: () => llmBoreal(), transcribir });
    const d = estado.docs.get(r.documentoId)!;
    expect(transcribir).toHaveBeenCalledTimes(1);
    expect(d.validacion!.hallazgos.some((h) => h.codigo === 'captura_incompleta' && h.severidad === 'bloqueo')).toBe(true);
  });

  it('sin puerto de transcripción la imagen sigue el camino de siempre (no se inventa un corte)', async () => {
    const r = await subir(A, await fotoRemision(), 'captura.png');
    await procesarDocumento(A, r.documentoId, { ...sinAgenteApagado, llm: () => llmBoreal() });
    expect(estado.docs.get(r.documentoId)!.validacion!.hallazgos.some((h) => h.codigo === 'captura_incompleta')).toBe(false);
  });
});
