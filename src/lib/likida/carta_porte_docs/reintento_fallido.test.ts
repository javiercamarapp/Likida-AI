// A37-A3-04: un documento `fallido` terminal tenía cero salidas. Datos sintéticos.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./repo', async () => (await import('./repo_falso.fixture')).api);
vi.mock('../bitacora_escritura', () => ({ anotarBitacora: vi.fn(async () => true) }));
vi.mock('../carta_porte_datos', async (orig) => ({ ...(await orig<typeof import('../carta_porte_datos')>()), getBorradorViaje: async () => null }));

import { estado, reset } from './repo_falso.fixture';
import { A, sembrarFlotas, subir } from './escenario.fixture';
import { pdfBoreal } from './documentos_sinteticos.fixture';
import { reintentarLectura } from './bandeja';
import { MAX_REINTENTOS_MANUALES } from './servicio';
import { armarAviso } from './worker';

beforeEach(() => { reset(); sembrarFlotas(); });

async function fallido() {
  const r = await subir(A, await pdfBoreal(), 'doc.pdf');
  const d = estado.docs.get(r.documentoId)!;
  Object.assign(d, { estado: 'fallido', intentos: 5, ultimoError: 'proveedor caído' });
  estado.avisos.set(d.id, { agotado: new Date().toISOString() });
  return { r, d };
}

describe('A37-A3-04: salida de un documento fallido terminal', () => {
  it('«Reintentar lectura» lo devuelve a la cola con intentos en cero, deja bitácora y suelta el candado del aviso', async () => {
    const { d } = await fallido();
    const n = await reintentarLectura(A, d.id, d.version, 'u-1');
    expect(n).toMatchObject({ estado: 'recibido', intentos: 0, ultimoError: null });
    expect(estado.eventos.some((e) => e.documentoId === d.id && e.tipo === 'reabierto' && e.detalle.reintento_manual === true)).toBe(true);
    expect(estado.avisos.get(d.id)?.agotado).toBeUndefined();
  });

  it('solo aplica a `fallido`, respeta la versión y tiene tope de reaperturas', async () => {
    const { d, r } = await fallido();
    await expect(reintentarLectura(A, d.id, d.version + 7, 'u-1')).rejects.toThrow(/Otra persona/);
    for (let i = 0; i < MAX_REINTENTOS_MANUALES; i++) {
      const cur = estado.docs.get(r.documentoId)!;
      Object.assign(cur, { estado: 'fallido', intentos: 5 });
      await reintentarLectura(A, cur.id, cur.version, 'u-1');
    }
    const cur = estado.docs.get(r.documentoId)!;
    Object.assign(cur, { estado: 'fallido', intentos: 5 });
    await expect(reintentarLectura(A, cur.id, cur.version, 'u-1')).rejects.toThrow(/ya se reintentó/);
    Object.assign(cur, { estado: 'por_revisar' });
    await expect(reintentarLectura(A, cur.id, cur.version, 'u-1')).rejects.toThrow(/no se reintenta/);
  });

  it('reenviar el MISMO archivo de un fallido lo reabre (antes: «ya estaba en la bandeja»)', async () => {
    const { d } = await fallido();
    const otra = await subir(A, await pdfBoreal(), 'reenvio.pdf');
    expect(otra.documentoId).toBe(d.id);
    expect(otra).toMatchObject({ duplicado: false, estado: 'recibido', reabierto: true });
    expect(estado.docs.get(d.id)).toMatchObject({ estado: 'recibido', intentos: 0 });
  });

  it('reenviar el archivo de un documento por revisar sigue siendo un duplicado normal', async () => {
    const r = await subir(A, await pdfBoreal(), 'a.pdf');
    Object.assign(estado.docs.get(r.documentoId)!, { estado: 'por_revisar' });
    const otra = await subir(A, await pdfBoreal(), 'b.pdf');
    expect(otra).toMatchObject({ duplicado: true });
    expect(otra).not.toHaveProperty('reabierto');
  });

  it('el aviso a la oficina ya no manda a «pide el archivo de nuevo» sin salida', async () => {
    const { d } = await fallido();
    const { texto } = armarAviso('agotado', estado.docs.get(d.id)!, 'https://x.example/doc');
    expect(texto).toMatch(/Reintentar lectura/);
    expect(texto).not.toMatch(/Pide el archivo de nuevo/);
  });
});
