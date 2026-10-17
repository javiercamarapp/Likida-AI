// T-A3-67 (cableado): los formatos C (remisión escaneada), D (BOL en inglés) y E (orden del agente aduanal) llegan a sus lectores
// por el flujo REAL (recibir → procesar → bandeja), no solo por la prueba de `lectores/`. Documentos 100 % sintéticos.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./repo', async () => (await import('./repo_falso.fixture')).api);
vi.mock('../bitacora_escritura', () => ({ anotarBitacora: vi.fn(async () => true) }));
vi.mock('../carta_porte_datos', async (orig) => ({ ...(await orig<typeof import('../carta_porte_datos')>()), getBorradorViaje: vi.fn(async () => null) }));

import { estado, reset } from './repo_falso.fixture';
import { A, ACTOR, llmBoreal, sembrarFlotas, sinAgenteApagado, subir } from './escenario.fixture';
import { pdfBoreal } from './documentos_sinteticos.fixture';
import { M6, M7, M8, pdfM6, pdfM7, pdfM8, visionFalsaM6 } from './evaluacion/dorado.fixture';
import { llmFalso } from './llm_falso.fixture';
import { procesarDocumento } from './servicio';
import { corregirCampos } from './bandeja';

beforeEach(() => { reset(); sembrarFlotas(); });

/** Un modelo genérico que NO debe llamarse: si el lector de formato lee el documento, nadie le paga al modelo. */
const llmProhibido = () => llmFalso(() => { throw new Error('el modelo genérico no debía llamarse'); });

/** Lo que un modelo de visión transcribiría del encabezado de la remisión sintética (para clasificarla). */
const TRANSCRIPCION_REMISION = `REMISION ${M6.remision}\nCANTIDAD | CLAVE | DESCRIPCION | PESO BRUTO | VOLUMEN`;

async function procesar(bytes: Uint8Array, nombre: string, deps: Parameters<typeof procesarDocumento>[2] = {}) {
  const r = await subir(A, bytes, nombre);
  const p = await procesarDocumento(A, r.documentoId, { ...sinAgenteApagado, llm: () => llmProhibido(), ...deps });
  return { id: r.documentoId, p, doc: () => estado.docs.get(r.documentoId)! };
}

const mercancia = (d: { extraccion: { mercancias: Array<Record<string, { valor: string | null }>> } | null }, i: number, k: string) => d.extraccion?.mercancias[i]?.[k]?.valor ?? null;

describe('T-A3-67 · D: BOL en inglés', () => {
  it('entra por el servicio, lo lee el lector D (sin modelo) y sale el borrador con lo inferido marcado', async () => {
    const { p, doc } = await procesar(await pdfM7(), 'bol.pdf');
    expect(p).toMatchObject({ ok: true, estado: 'por_revisar', origen: 'perfil', nivel: 0, costoUsd: 0 });
    const d = doc();
    expect(d.extraccion!.meta!.formatoEntrada).toBe('D');
    expect(d.extraccion!.campos.folio_cliente?.valor).toBe(M7.bol);
    expect(mercancia(d as never, 0, 'peso_kg')).toBe(M7.kilos); // 8 820 lb → kg, con nota
    expect(d.extraccion!.campos.fecha_salida?.valor).toBe('2026-10-13');
    // lo que el documento no trae no se inventa
    expect(d.extraccion!.campos.destino_rfc?.valor ?? null).toBeNull();
    expect(d.validacion!.listoParaAprobar).toBe(false);
  });

  it('una persona corrige un valor leído y el borrador sigue por_revisar (nada se aprueba ni se envía solo)', async () => {
    const { id, doc } = await procesar(await pdfM7(), 'bol.pdf');
    await corregirCampos(A, id, doc().version, [{ campo: 'folio_cliente', renglon: null, valor: '420002-9', confirmar: true }], ACTOR.id);
    expect(doc().estado).toBe('por_revisar');
    expect(doc().extraccion!.meta!.formatoEntrada).toBe('D'); // la clasificación sobrevive a la corrección
  });
});

describe('T-A3-67 · E: orden del agente aduanal', () => {
  it('entra por el servicio, lo lee el lector E (sin modelo), el sello va aparte y el pedimento incompleto queda por confirmar', async () => {
    const { p, doc } = await procesar(await pdfM8(), 'orden.pdf');
    expect(p).toMatchObject({ ok: true, estado: 'por_revisar', origen: 'perfil', nivel: 0 });
    const d = doc();
    expect(d.extraccion!.meta!.formatoEntrada).toBe('E');
    expect(d.extraccion!.campos.folio_cliente?.valor).toBe(M8.control);
    expect(d.extraccion!.campos.caja_numero?.valor).toBe(M8.caja);
    expect(mercancia(d as never, 0, 'pedimento')).toBe(M8.pedimento);
    expect(d.extraccion!.mercancias).toHaveLength(2);
    expect(JSON.stringify(d.extraccion)).not.toContain(M8.sello); // el CCP no tiene campo de sello: no se mete en otro
    expect(d.validacion!.listoParaAprobar).toBe(false);
  });
});

describe('T-A3-67 · C: remisión escaneada', () => {
  it('con visión inyectada: se clasifica por la transcripción del encabezado y la lee el lector C, con la celda cortada marcada', async () => {
    const vision = visionFalsaM6();
    const transcribir = vi.fn(async () => TRANSCRIPCION_REMISION);
    const { p, doc } = await procesar(await pdfM6(), 'remision.pdf', { vision, transcribir });
    expect(p).toMatchObject({ ok: true, estado: 'por_revisar' });
    const d = doc();
    expect(d.extraccion!.meta!.formatoEntrada).toBe('C');
    expect(d.extraccion!.meta!.requiereCapturaManual ?? null).toBeNull();
    expect(vision.llamadas).toBe(1);
    expect(d.extraccion!.campos.folio_cliente?.valor).toBe(M6.remision);
    expect(d.extraccion!.mercancias).toHaveLength(14);
    expect(transcribir).toHaveBeenCalledTimes(1); // una sola transcripción por documento
    expect(d.validacion!.listoParaAprobar).toBe(false);
  });

  it('SIN puerto de visión (bloqueo externo: sin llave): queda «requiere captura manual», no bloquea el flujo ni inventa datos', async () => {
    const transcribir = vi.fn(async () => TRANSCRIPCION_REMISION);
    const { p, doc } = await procesar(await pdfM6(), 'remision.pdf', { transcribir });
    expect(p).toMatchObject({ ok: true, estado: 'por_revisar', nivel: 0, costoUsd: 0, listoParaAprobar: false });
    const d = doc();
    expect(d.extraccion!.meta!.formatoEntrada).toBe('C');
    expect(d.extraccion!.meta!.requiereCapturaManual).toMatchObject({ formato: 'C', motivo: 'sin_vision' });
    expect(Object.keys(d.extraccion!.campos)).toHaveLength(0);
    expect(d.extraccion!.mercancias).toHaveLength(0);
    expect(d.validacion!.hallazgos.find((h) => h.codigo === 'requiere_captura_manual')).toMatchObject({ severidad: 'bloqueo' });
  });

  it('el aviso de captura manual sobrevive a una corrección (se revalida desde lo guardado)', async () => {
    const { id, doc } = await procesar(await pdfM6(), 'remision.pdf', { transcribir: async () => TRANSCRIPCION_REMISION });
    await corregirCampos(A, id, doc().version, [{ campo: 'folio_cliente', renglon: null, valor: M6.remision, confirmar: true }], ACTOR.id);
    expect(doc().validacion!.hallazgos.some((h) => h.codigo === 'requiere_captura_manual')).toBe(true);
  });
});

describe('T-A3-67 · lo que NO cambia', () => {
  it('un documento que no es C/D/E sigue el flujo de siempre (sin formatoEntrada)', async () => {
    const { p, doc } = await procesar(await pdfBoreal(), 'orden.pdf', { llm: () => llmBoreal() });
    expect(p).toMatchObject({ ok: true, estado: 'por_revisar' });
    expect(doc().extraccion?.meta?.formatoEntrada ?? null).toBeNull();
    expect(doc().extraccion?.meta?.requiereCapturaManual ?? null).toBeNull();
  });
});
