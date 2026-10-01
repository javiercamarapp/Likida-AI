import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('./repo', async () => (await import('./repo_falso.test.util')).api);
import { estado, reset } from './repo_falso.test.util';
import { A, B, sembrarFlotas, sinAgenteApagado, subir } from './escenario.test.util';
import { purgarDocumentosVencidos } from './retencion';
import { pdfBoreal } from './fixtures.test.util';

beforeEach(() => { reset(); sembrarFlotas(); });

describe('purgarDocumentosVencidos', () => {
  it('borra el archivo y el texto de lo vencido y deja la fila como constancia; lo vigente no se toca', async () => {
    const a = await subir(A, await pdfBoreal({ folio: 'V-1' }));
    const b = await subir(B, await pdfBoreal({ folio: 'V-2' }));
    const c = await subir(A, await pdfBoreal({ folio: 'V-3' }));
    estado.docs.get(a.documentoId)!.retenerHasta = new Date(Date.now() - 86_400_000).toISOString();
    estado.docs.get(b.documentoId)!.retenerHasta = new Date(Date.now() - 86_400_000).toISOString();
    estado.docs.get(a.documentoId)!.textoExtracto = 'datos personales';
    const rutaA = estado.docs.get(a.documentoId)!.storageRuta!;
    const r = await purgarDocumentosVencidos();
    expect(r).toEqual({ revisados: 2, purgados: 2, fallidos: 0 });
    expect(estado.archivos.has(rutaA)).toBe(false);
    const da = estado.docs.get(a.documentoId)!;
    expect(da).toMatchObject({ storageRuta: null, textoExtracto: null });
    expect(da.purgadoEn).not.toBeNull();
    expect(estado.docs.has(a.documentoId)).toBe(true); // la constancia sobrevive
    expect(estado.docs.get(c.documentoId)!.storageRuta).not.toBeNull();
    expect(estado.eventos.filter((e) => e.tipo === 'purgado')).toHaveLength(2);
  });

  it('es idempotente: una segunda corrida no vuelve a tocar lo ya purgado', async () => {
    const a = await subir(A, await pdfBoreal());
    estado.docs.get(a.documentoId)!.retenerHasta = new Date(Date.now() - 1000).toISOString();
    await purgarDocumentosVencidos();
    expect(await purgarDocumentosVencidos()).toEqual({ revisados: 0, purgados: 0, fallidos: 0 });
    expect(estado.eventos.filter((e) => e.tipo === 'purgado')).toHaveLength(1);
  });

  it('si el archivo NO se pudo borrar, la fila NO se marca purgada (se reintenta mañana)', async () => {
    const a = await subir(A, await pdfBoreal());
    estado.docs.get(a.documentoId)!.retenerHasta = new Date(Date.now() - 1000).toISOString();
    estado.fallar.set('borrarArchivo', new Error('storage caído'));
    const r = await purgarDocumentosVencidos();
    expect(r).toEqual({ revisados: 1, purgados: 0, fallidos: 1 });
    expect(estado.docs.get(a.documentoId)!.purgadoEn).toBeNull();
    estado.fallar.delete('borrarArchivo');
    expect((await purgarDocumentosVencidos()).purgados).toBe(1);
  });

  it('respeta el límite por corrida', async () => {
    for (let i = 0; i < 5; i++) { const x = await subir(A, await pdfBoreal({ folio: `L-${i}` })); estado.docs.get(x.documentoId)!.retenerHasta = new Date(Date.now() - 1000).toISOString(); }
    expect((await purgarDocumentosVencidos(3)).purgados).toBe(3);
    expect((await purgarDocumentosVencidos(3)).purgados).toBe(2);
  });
  void sinAgenteApagado;
});
