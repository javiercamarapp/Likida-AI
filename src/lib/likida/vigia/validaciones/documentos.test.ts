import { describe, expect, it } from 'vitest';
import { resolverConfig } from './base';
import { validarDocumentosOtraCaja, validarEvidenciaSalida, validarPod, validarSello, validarVigenciasFlota } from './documentos';
import { clonar, contextoBase, fichaBase } from './validaciones.fixture';

const cfg = resolverConfig();

describe('V08 documento de otra caja', () => {
  it('documento que coincide: sin hallazgos', () => {
    expect(validarDocumentosOtraCaja(fichaBase(), contextoBase(), cfg)).toEqual([]);
  });
  it('caja distinta: bloqueo y rechazo del adjunto', () => {
    const c = clonar(contextoBase());
    c.documentos = [{ tipo: 'ccp', caja: 'XX-9000' }];
    const hs = validarDocumentosOtraCaja(fichaBase(), c, cfg);
    expect(hs[0].severidad).toBe('bloqueo');
    expect(hs[0].sugerencia).toContain('Rechazar');
  });
  it('caja con un dígito de diferencia lo menciona', () => {
    const c = clonar(contextoBase());
    c.documentos = [{ tipo: 'doda', caja: 'XX-2140' }];
    expect(validarDocumentosOtraCaja(fichaBase(), c, cfg)[0].mensaje).toContain('un carácter de diferencia');
  });
  it('ref o placas de otro servicio', () => {
    const c = clonar(contextoBase());
    c.documentos = [{ tipo: 'bol', ref: 'REF-0002' }, { tipo: 'ccp', placasCaja: 'ZZZ999' }];
    expect(validarDocumentosOtraCaja(fichaBase(), c, cfg)).toHaveLength(2);
  });
  it('documento sin nada verificable: aviso de dato ausente', () => {
    const c = clonar(contextoBase());
    c.documentos = [{ tipo: 'bol' }];
    const hs = validarDocumentosOtraCaja(fichaBase(), c, cfg);
    expect(hs[0].datoAusente).toBe(true);
  });
  it('sin documentos o sin caja ni ref del servicio: dato ausente', () => {
    const c = clonar(contextoBase());
    c.documentos = [];
    expect(validarDocumentosOtraCaja(fichaBase(), c, cfg)[0].datoAusente).toBe(true);
    const c2 = clonar(contextoBase());
    delete c2.cajaAsignada;
    const f = clonar(fichaBase());
    delete f.caja;
    delete f.ref;
    expect(validarDocumentosOtraCaja(f, c2, cfg)[0].datoAusente).toBe(true);
  });
});

describe('V09 sello distinto al declarado', () => {
  it('sello declarado y leído iguales: sin hallazgos', () => {
    expect(validarSello(fichaBase(), contextoBase(), cfg)).toEqual([]);
  });
  it('sello leído distinto al de la prealerta: bloqueo', () => {
    const f = clonar(fichaBase());
    f.selloFoto = '49806';
    expect(validarSello(f, contextoBase(), cfg)[0].severidad).toBe('bloqueo');
  });
  it('un carácter de diferencia: posible captura errónea', () => {
    const f = clonar(fichaBase());
    f.selloFoto = '49086';
    expect(validarSello(f, contextoBase(), cfg)[0].mensaje).toContain('captura errónea');
  });
  it('documento con sello viejo; tras rojo pide documento nuevo', () => {
    const c = clonar(contextoBase());
    c.documentos = [{ tipo: 'doda', sello: '11111' }];
    expect(validarSello(fichaBase(), c, cfg)[0].sugerencia).toContain('Retener');
    c.inspeccionRojo = true;
    expect(validarSello(fichaBase(), c, cfg)[0].sugerencia).toContain('documento nuevo');
  });
  it('tras rojo, un sello sin cambio es sospechoso', () => {
    const c = clonar(contextoBase());
    c.inspeccionRojo = true;
    expect(validarSello(fichaBase(), c, cfg)[0].severidad).toBe('aviso');
  });
  it('mismo sello en dos cajas', () => {
    const c = clonar(contextoBase());
    c.selloPorCaja = [{ caja: 'XX-2151', sello: '49085' }];
    expect(validarSello(fichaBase(), c, cfg)[0].mensaje).toContain('dos cajas');
  });
  it('sin sello: info; cerca de la cita: aviso (el agente no teclea sellos)', () => {
    const f = clonar(fichaBase());
    delete f.sello;
    const c = clonar(contextoBase());
    delete c.prealerta;
    c.documentos = [];
    expect(validarSello(f, c, cfg)[0].severidad).toBe('info');
    f.cita = '2026-11-23T11:00';
    expect(validarSello(f, c, cfg)[0].severidad).toBe('aviso');
  });
  it('compara sin espacios ni guiones', () => {
    const f = clonar(fichaBase());
    f.selloFoto = '49-085';
    expect(validarSello(f, contextoBase(), cfg)).toEqual([]);
  });
});

describe('V16 POD inválido', () => {
  const podOk = () => ({ clasificacion: 'doda_sellado', fecha: '2026-11-24', legible: true, recibidos: ['doda_sellado', 'remision'] });
  const conPod = (pod: ReturnType<typeof podOk> | Record<string, unknown>, extra = {}) => ({ ...clonar(contextoBase()), pod, entrega: { horaEntrega: '2026-11-24T12:00' }, ...extra });
  const cfgPod = resolverConfig({ requisitosPod: ['doda_sellado', 'remision'] });
  it('POD completo y legible: sin hallazgos', () => {
    expect(validarPod(fichaBase(), conPod(podOk()), cfgPod)).toEqual([]);
  });
  it('carta porte sellada no es POD', () => {
    const hs = validarPod(fichaBase(), conPod({ ...podOk(), clasificacion: 'cp_sellada' }), cfgPod);
    expect(hs[0].mensaje).toContain('no es POD');
  });
  it('ilegible por clasificación o por bandera', () => {
    expect(validarPod(fichaBase(), conPod({ ...podOk(), clasificacion: 'ilegible' }), cfgPod)[0].mensaje).toContain('ilegible');
    expect(validarPod(fichaBase(), conPod({ ...podOk(), legible: false }), cfgPod)[0].mensaje).toContain('ilegible');
  });
  it('fecha anterior a la entrega', () => {
    const hs = validarPod(fichaBase(), conPod({ ...podOk(), fecha: '2026-11-19' }), cfgPod);
    expect(hs[0].mensaje).toContain('anterior a la entrega');
  });
  it('falta un documento de la composición configurada', () => {
    const hs = validarPod(fichaBase(), conPod({ ...podOk(), recibidos: ['doda_sellado'] }), cfgPod);
    expect(hs[0].mensaje).toContain('remision');
  });
  it('sin requisitos configurados lo dice; sin POD es dato ausente', () => {
    expect(validarPod(fichaBase(), conPod(podOk()), cfg)[0].datoAusente).toBe(true);
    expect(validarPod(fichaBase(), contextoBase(), cfg)[0].datoAusente).toBe(true);
    expect(validarPod(fichaBase(), conPod({ fecha: '2026-11-24', recibidos: [] }), cfg).some((h) => h.camposInvolucrados.includes('pod.clasificacion'))).toBe(true);
  });
});

describe('V18 vigencias de flota', () => {
  const con = (v: Array<{ tipo: string; hasta?: string }>) => ({ ...clonar(contextoBase()), vigencias: v });
  it('vigente: sin hallazgos', () => {
    expect(validarVigenciasFlota(fichaBase(), contextoBase(), cfg)).toEqual([]);
  });
  it('vencida: bloqueo; próxima: aviso', () => {
    expect(validarVigenciasFlota(fichaBase(), con([{ tipo: 'doda', hasta: '2026-11-20' }]), cfg)[0].severidad).toBe('bloqueo');
    expect(validarVigenciasFlota(fichaBase(), con([{ tipo: 'coi', hasta: '2026-12-01' }]), cfg)[0].severidad).toBe('aviso');
  });
  it('vigencia que vence el mismo día de uso aún vale (aviso, no bloqueo)', () => {
    expect(validarVigenciasFlota(fichaBase(), con([{ tipo: 'doda', hasta: '2026-11-24' }]), resolverConfig({ diasAvisoVigencia: 0 }))[0].severidad).toBe('aviso');
    expect(validarVigenciasFlota(fichaBase(), con([{ tipo: 'doda', hasta: '2026-11-25' }]), resolverConfig({ diasAvisoVigencia: 0 }))).toEqual([]);
  });
  it('vigencia desconocida: no se afirma que esté vigente', () => {
    const hs = validarVigenciasFlota(fichaBase(), con([{ tipo: 'fianza' }]), cfg);
    expect(hs[0].datoAusente).toBe(true);
    expect(hs[0].mensaje).toContain('no se afirma');
  });
  it('sin vigencias en el contexto: dato ausente', () => {
    expect(validarVigenciasFlota(fichaBase(), con([]), cfg)[0].datoAusente).toBe(true);
  });
});

describe('V20 evidencia de salida', () => {
  it('checklist completo: sin hallazgos', () => {
    expect(validarEvidenciaSalida(fichaBase(), contextoBase(), cfg)).toEqual([]);
  });
  it('faltan fotos e ilegibles', () => {
    const c = clonar(contextoBase());
    c.evidenciaSalida!.fotos = c.evidenciaSalida!.fotos.filter((x) => x.tipo !== 'bol_firmado');
    c.evidenciaSalida!.fotos[0].legible = false;
    const hs = validarEvidenciaSalida(fichaBase(), c, cfg);
    expect(hs[0].mensaje).toContain('bol_firmado');
    expect(hs[0].mensaje).toContain('sello');
  });
  it('reefer exige display y combustible; blindado exige fotos de custodia', () => {
    const f = clonar(fichaBase());
    f.caja!.tipo = 'thermo';
    f.blindado = true;
    const hs = validarEvidenciaSalida(f, contextoBase(), cfg);
    expect(hs[0].mensaje).toMatch(/display.*combustible.*fotos_custodia/);
  });
  it('checklist configurable; sin evidencia es dato ausente', () => {
    expect(validarEvidenciaSalida(fichaBase(), contextoBase(), resolverConfig({ checklistSalida: ['sello', 'extra'] }))[0].mensaje).toContain('extra');
    const c = clonar(contextoBase());
    delete c.evidenciaSalida;
    expect(validarEvidenciaSalida(fichaBase(), c, cfg)[0].datoAusente).toBe(true);
  });
});
