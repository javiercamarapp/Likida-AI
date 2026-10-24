import { describe, it, expect, vi } from 'vitest';
import { avisarDiscrepanciasDesglose, TOPE_AVISOS_DISCREPANCIA, type DepsAvisoDiscrepancia } from './aviso_discrepancia';
import type { CandidatoCobro } from './reglas_cobro';
import type { ReporteRevision } from './repo';
import type { PosicionConocida } from './reporte_discrepancia';

// HALLAZGO ALTO (auditoría adversarial): el protocolo de discrepancia geográfica
// (T-A2-37, `reporte_discrepancia.ts`) nunca se invocaba desde ningún camino de
// producción — ni cron, ni API, ni botón del panel. Estas pruebas ejercen
// `avisarDiscrepanciasDesglose`, el punto que SÍ lo invoca (desde el cron de
// peajes, justo después de conciliar el desglose).

const T = 'tenant-1';
const DES = 'desglose-1';
const TEL = '5215500000000';

const critico = (over: Partial<CandidatoCobro> = {}): CandidatoCobro => ({
  indice: 0, categoria: 'unidad_inmovilizada', fecha: '2026-03-04', hora: '10:15:00', caseta: 'Caseta Ejemplo Norte',
  tag: 'TAGEJEMPLO01', unidad: 'U-01', clase: 3, monto: 400,
  quePaso: 'El TAG TAGEJEMPLO01 de la unidad U-01 aparece en Caseta Ejemplo Norte, pero la flota declaró esa unidad en taller del 2026-03-03 al 2026-03-05.',
  queSignifica: 'x', queHacer: 'y', referencia: 'taller del 2026-03-03 al 2026-03-05', severidad: 'critica',
  ...over,
});

/** Un `ReporteRevision` mínimo: `avisarDiscrepanciasDesglose` solo lee `.revision.candidatos`. */
const reporteCon = (candidatos: CandidatoCobro[]): ReporteRevision => ({ revision: { candidatos } } as unknown as ReporteRevision);

const POS: PosicionConocida = { lat: 19.4326, lng: -99.1332, t: Date.UTC(2026, 2, 4, 15, 30) };

function deps(over: Partial<DepsAvisoDiscrepancia> = {}): DepsAvisoDiscrepancia {
  return {
    revisionDeDesglose: vi.fn(async () => reporteCon([critico()])),
    destinatario: vi.fn(async () => TEL),
    ultimaPosicion: vi.fn(async () => POS),
    avisar: vi.fn(async () => ({ ok: true, via: 'texto', id: 'wamid-1' })) as unknown as DepsAvisoDiscrepancia['avisar'],
    ...over,
  };
}

describe('avisarDiscrepanciasDesglose', () => {
  it('candidato crítico de unidad_inmovilizada: SÍ invoca el protocolo y manda el reporte', async () => {
    const avisar = vi.fn(async (_tel: string, _texto: string) => ({ ok: true, via: 'texto' as const, id: 'wamid-1' }));
    const d = deps({ avisar: avisar as unknown as DepsAvisoDiscrepancia['avisar'] });
    const r = await avisarDiscrepanciasDesglose(T, DES, d);

    expect(r.evaluados).toBe(1);
    expect(r.enviados).toBe(1);
    expect(r.pendientes).toBe(0);
    expect(r.sinDestinatario).toBe(0);
    expect(avisar).toHaveBeenCalledOnce();
    const [telefono, texto] = avisar.mock.calls[0] as [string, string];
    expect(telefono).toBe(TEL);
    // El texto es el del protocolo (T-A2-37): qué pasó / evidencia / qué hacer, con la unidad y el TAG.
    expect(texto).toMatch(/Qué pasó:.*Evidencia:.*Qué hacer:/s);
    expect(texto).toContain('U-01');
    expect(texto).toContain('…LO01');
    expect(texto).toMatch(/seguridad/);
  });

  it('A37-S51-04: un envío no-ok pero ENCOLADO en el outbox cuenta como enviado (no pendiente)', async () => {
    const avisar = vi.fn(async (_tel: string, _texto: string) => ({ ok: false as const, motivo: 'token vencido', codigo: 190, fueraDeVentana: false, reintentable: false, encolado: true }));
    const r = await avisarDiscrepanciasDesglose(T, DES, deps({ avisar: avisar as unknown as DepsAvisoDiscrepancia['avisar'] }));
    expect(r.enviados).toBe(1);
    expect(r.pendientes).toBe(0);
  });

  it('usa el MISMO destinatario configurado para los avisos de atípicos (T-A2-14)', async () => {
    const destinatario = vi.fn(async () => TEL);
    const d = deps({ destinatario });
    await avisarDiscrepanciasDesglose(T, DES, d);
    expect(destinatario).toHaveBeenCalledWith(T);
  });

  it('sin destinatario configurado: arma el reporte pero NO envía, y no es un fallo del sistema', async () => {
    const avisar = vi.fn();
    const d = deps({ destinatario: vi.fn(async () => null), avisar: avisar as unknown as DepsAvisoDiscrepancia['avisar'] });
    const r = await avisarDiscrepanciasDesglose(T, DES, d);
    expect(r.evaluados).toBe(1);
    expect(r.enviados).toBe(0);
    expect(r.sinDestinatario).toBe(1);
    expect(r.pendientes).toBe(0);
    expect(avisar).not.toHaveBeenCalled();
  });

  it('Meta rechaza el envío: se cuenta como pendiente (sí es un fallo a notar)', async () => {
    const avisar = vi.fn(async () => ({ ok: false, motivo: 'rechazado', codigo: 131047, fueraDeVentana: true, reintentable: false }));
    const d = deps({ avisar: avisar as unknown as DepsAvisoDiscrepancia['avisar'] });
    const r = await avisarDiscrepanciasDesglose(T, DES, d);
    expect(r.enviados).toBe(0);
    expect(r.pendientes).toBe(1);
  });

  it('sin candidatos críticos no hace nada ni llama a avisar', async () => {
    const avisar = vi.fn();
    const d = deps({ revisionDeDesglose: vi.fn(async () => reporteCon([])), avisar: avisar as unknown as DepsAvisoDiscrepancia['avisar'] });
    const r = await avisarDiscrepanciasDesglose(T, DES, d);
    expect(r.evaluados).toBe(0);
    expect(avisar).not.toHaveBeenCalled();
  });

  it('ignora candidatos no críticos (otra categoría): no son el protocolo de discrepancia', async () => {
    const avisar = vi.fn();
    const noCritico = critico({ categoria: 'tag_dado_de_baja', severidad: undefined });
    const d = deps({ revisionDeDesglose: vi.fn(async () => reporteCon([noCritico])), avisar: avisar as unknown as DepsAvisoDiscrepancia['avisar'] });
    const r = await avisarDiscrepanciasDesglose(T, DES, d);
    expect(r.evaluados).toBe(0);
    expect(avisar).not.toHaveBeenCalled();
  });

  it('desglose inexistente (null): nunca lanza, no evalúa nada', async () => {
    const d = deps({ revisionDeDesglose: vi.fn(async () => null) });
    const r = await avisarDiscrepanciasDesglose(T, DES, d);
    expect(r).toEqual({ evaluados: 0, enviados: 0, sinDestinatario: 0, pendientes: 0 });
  });

  it('nunca lanza: un fallo de la revisión se atrapa y devuelve el resumen en ceros', async () => {
    const d = deps({ revisionDeDesglose: vi.fn(async () => { throw new Error('boom'); }) });
    await expect(avisarDiscrepanciasDesglose(T, DES, d)).resolves.toEqual({ evaluados: 0, enviados: 0, sinDestinatario: 0, pendientes: 0 });
  });

  it('un fallo al leer la posición GPS no tumba el aviso: se manda igual, sin posición', async () => {
    const avisar = vi.fn(async (_tel: string, _texto: string) => ({ ok: true, via: 'texto' as const, id: 'w' }));
    const d = deps({ ultimaPosicion: vi.fn(async () => { throw new Error('gps caído'); }), avisar: avisar as unknown as DepsAvisoDiscrepancia['avisar'] });
    const r = await avisarDiscrepanciasDesglose(T, DES, d);
    expect(r.enviados).toBe(1);
    const texto = (avisar.mock.calls[0] as [string, string])[1];
    expect(texto).toMatch(/sin posición GPS disponible/);
  });

  it('varios candidatos críticos: manda UN reporte por candidato (no los junta en uno genérico)', async () => {
    const avisar = vi.fn(async (_tel: string, _texto: string) => ({ ok: true, via: 'texto' as const, id: 'w' }));
    const dos = [critico({ indice: 0, unidad: 'U-01' }), critico({ indice: 1, unidad: 'U-02', tag: 'TAGEJEMPLO02' })];
    const d = deps({ revisionDeDesglose: vi.fn(async () => reporteCon(dos)), avisar: avisar as unknown as DepsAvisoDiscrepancia['avisar'] });
    const r = await avisarDiscrepanciasDesglose(T, DES, d);
    expect(r.evaluados).toBe(2);
    expect(r.enviados).toBe(2);
    expect(avisar).toHaveBeenCalledTimes(2);
  });

  it('A37-S51-05: bajo el tope no hay resumen extra', async () => {
    const avisar = vi.fn(async (_tel: string, _texto: string) => ({ ok: true, via: 'texto' as const, id: 'w' }));
    const d = deps({
      revisionDeDesglose: vi.fn(async () => reporteCon([critico({ indice: 0 }), critico({ indice: 1 })])),
      avisar: avisar as unknown as DepsAvisoDiscrepancia['avisar'],
    });
    await avisarDiscrepanciasDesglose(T, DES, d);
    expect(avisar).toHaveBeenCalledTimes(2);
  });
});

describe('A37-A2-14: tope de mensajes por desglose', () => {
  it('cientos de candidatos críticos: máximo TOPE individuales + UN resumen, nunca uno por candidato', async () => {
    const muchos = Array.from({ length: 300 }, (_, i) => critico({ indice: i }));
    const avisar = vi.fn(async (_tel: string, _texto: string) => ({ ok: true, via: 'texto' as const, id: 'wamid-1' }));
    const d = deps({ revisionDeDesglose: vi.fn(async () => reporteCon(muchos)), avisar: avisar as unknown as DepsAvisoDiscrepancia['avisar'] });
    const r = await avisarDiscrepanciasDesglose(T, DES, d);
    expect(r.evaluados).toBe(300);
    expect(avisar).toHaveBeenCalledTimes(TOPE_AVISOS_DISCREPANCIA + 1);
    expect(r.enviados).toBe(TOPE_AVISOS_DISCREPANCIA + 1);
    const resumen = avisar.mock.calls[TOPE_AVISOS_DISCREPANCIA][1];
    expect(resumen).toContain(String(300 - TOPE_AVISOS_DISCREPANCIA));
  });

  it('Meta rechaza: no sigue insistiendo candidato por candidato (corta al primer rechazo)', async () => {
    const muchos = Array.from({ length: 50 }, (_, i) => critico({ indice: i }));
    const avisar = vi.fn(async () => ({ ok: false, motivo: 'rechazado', codigo: 131047, fueraDeVentana: true, reintentable: false }));
    const d = deps({ revisionDeDesglose: vi.fn(async () => reporteCon(muchos)), avisar: avisar as unknown as DepsAvisoDiscrepancia['avisar'] });
    const r = await avisarDiscrepanciasDesglose(T, DES, d);
    expect(avisar).toHaveBeenCalledTimes(1);
    expect(r.enviados).toBe(0);
    expect(r.pendientes).toBe(50);
  });
});
