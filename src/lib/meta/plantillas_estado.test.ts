import { describe, it, expect, vi } from 'vitest';
import {
  compararConMeta, resumenEstado, consultarPlantillasMeta, crearPlantillaMeta, type PlantillaMeta, type FetchLike,
} from './plantillas_estado';
import { CATALOGO_PLANTILLAS, plantillaDeCatalogo, type PlantillaCatalogo } from './plantillas_catalogo';

// Contra FIXTURES con la forma documentada de la API de plantillas: ninguna prueba toca Meta.

const CRED = { wabaId: '1234567890', token: 'EAAsecreto-no-imprimir' };

/** Lo que Meta devolvería para una plantilla del catálogo, idéntica y aprobada. */
function remotaDe(p: PlantillaCatalogo, extra: Partial<PlantillaMeta> = {}): PlantillaMeta {
  const comps: PlantillaMeta['components'] = [{ type: 'BODY', text: p.cuerpo }];
  if (p.encabezado) comps.unshift({ type: 'HEADER', format: p.encabezado.tipo === 'TEXT' ? 'TEXT' : p.encabezado.tipo });
  if (p.botones.length) {
    comps.push({ type: 'BUTTONS', buttons: p.botones.map((b) => (b.tipo === 'QUICK_REPLY' ? { type: 'QUICK_REPLY', text: b.texto } : { type: 'URL', text: b.texto, url: b.url })) });
  }
  return { name: p.nombre, status: 'APPROVED', language: p.idioma, category: p.categoria, components: comps, ...extra };
}
const TODAS = CATALOGO_PLANTILLAS.map((p) => remotaDe(p));
const veredicto = (r: ReturnType<typeof compararConMeta>, n: string) => r.find((x) => x.nombre === n)!;

describe('compararConMeta', () => {
  it('todo aprobado e idéntico: todas usables', () => {
    const r = compararConMeta(TODAS);
    expect(r.every((x) => x.veredicto === 'aprobada' && x.usable)).toBe(true);
  });

  it('una que Meta no tiene es «faltante» y no usable', () => {
    const r = compararConMeta(TODAS.filter((m) => m.name !== 'plazo_factura'));
    expect(veredicto(r, 'plazo_factura')).toMatchObject({ veredicto: 'faltante', usable: false, estadoMeta: null });
  });

  it('el idioma importa: es_MX no cuenta para una plantilla aprobada en `es`', () => {
    const r = compararConMeta(TODAS.map((m) => (m.name === 'respuesta_arco_v2' ? { ...m, language: 'es_MX' } : m)));
    expect(veredicto(r, 'respuesta_arco_v2').veredicto).toBe('faltante');
  });

  it.each([
    ['PENDING', 'pendiente', false], ['IN_APPEAL', 'pendiente', false],
    ['REJECTED', 'rechazada', false], ['PAUSED', 'pausada_o_deshabilitada', false], ['DISABLED', 'pausada_o_deshabilitada', false],
  ])('estado %s → %s (usable=%s)', (estado, esperado, usable) => {
    const r = compararConMeta(TODAS.map((m) => (m.name === 'viaje_asignado' ? { ...m, status: estado, rejected_reason: 'INVALID_FORMAT' } : m)));
    expect(veredicto(r, 'viaje_asignado')).toMatchObject({ veredicto: esperado, usable });
  });

  it('el motivo de rechazo viaja al reporte', () => {
    const r = compararConMeta(TODAS.map((m) => (m.name === 'viaje_asignado' ? { ...m, status: 'REJECTED', rejected_reason: 'INVALID_FORMAT' } : m)));
    expect(veredicto(r, 'viaje_asignado').motivoRechazo).toBe('INVALID_FORMAT');
    expect(resumenEstado(r)).toMatch(/RECHAZADA.*viaje_asignado.*INVALID_FORMAT/);
  });

  it('aprobada pero con cuerpo distinto: usable, con desviación (el envío solo manda parámetros)', () => {
    const r = compararConMeta(TODAS.map((m) => (m.name === 'plazo_factura'
      ? { ...m, components: [{ type: 'BODY', text: 'Otro texto {{1}} aprobado' }] } : m)));
    expect(veredicto(r, 'plazo_factura')).toMatchObject({ veredicto: 'aprobada_con_desviaciones', usable: true });
    expect(veredicto(r, 'plazo_factura').desviaciones.join()).toMatch(/cuerpo distinto/);
  });

  it('el cuerpo se compara sin importar espacios/saltos de línea', () => {
    const p = plantillaDeCatalogo('viaje_asignado')!;
    const r = compararConMeta(TODAS.map((m) => (m.name === p.nombre ? { ...m, components: [{ type: 'BODY', text: p.cuerpo.replace(/\n/g, '  \n ') }] } : m)));
    expect(veredicto(r, p.nombre).veredicto).toBe('aprobada');
  });

  it('reclasificada a MARKETING: se marca como desviación y se explica por qué importa', () => {
    const r = compararConMeta(TODAS.map((m) => (m.name === 'plazo_factura' ? { ...m, category: 'MARKETING' } : m)));
    expect(veredicto(r, 'plazo_factura').desviaciones.join()).toMatch(/MARKETING.*más/);
  });

  it('botones distintos o ausentes en Meta', () => {
    const r = compararConMeta(TODAS.map((m) => (m.name === 'conductor_salida_carga_v1'
      ? { ...m, components: m.components!.filter((c) => c.type !== 'BUTTONS') } : m)));
    expect(veredicto(r, 'conductor_salida_carga_v1')).toMatchObject({ veredicto: 'aprobada_con_desviaciones' });
    expect(veredicto(r, 'conductor_salida_carga_v1').desviaciones.join()).toMatch(/botones distintos/);
  });

  it('un URL con {{1}} dinámico en Meta no se confunde con la URL fija del catálogo', () => {
    const p = plantillaDeCatalogo('aviso_jefe_trafico_v1')!;
    const m = remotaDe(p);
    const botones = m.components!.find((c) => c.type === 'BUTTONS')!.buttons!;
    botones[1] = { ...botones[1], url: `${botones[1].url}{{1}}` };
    expect(compararConMeta([m], [p])[0].veredicto).toBe('aprobada');
  });

  it('Meta sin BODY o respuesta vacía no truena', () => {
    expect(compararConMeta([{ name: 'plazo_factura', status: 'APPROVED', language: 'es_MX', category: 'UTILITY' }], [plantillaDeCatalogo('plazo_factura')!])[0].desviaciones.join()).toMatch(/BODY/);
    expect(compararConMeta([]).every((r) => r.veredicto === 'faltante')).toBe(true);
  });

  it('el resumen cuenta usables y faltantes', () => {
    const r = compararConMeta(TODAS.slice(0, 3));
    expect(resumenEstado(r)).toMatch(new RegExp(`3 de ${TODAS.length} usables hoy; ${TODAS.length - 3} por someter`));
  });
});

const respuesta = (cuerpo: unknown, status = 200) => new Response(typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo), { status });

describe('consultarPlantillasMeta', () => {
  it('sigue la paginación y manda el token solo en el encabezado', async () => {
    const f = vi.fn<FetchLike>()
      .mockResolvedValueOnce(respuesta({ data: [TODAS[0]], paging: { next: 'https://graph.facebook.com/v21.0/p2' } }))
      .mockResolvedValueOnce(respuesta({ data: [TODAS[1]] }));
    const r = await consultarPlantillasMeta(CRED, f);
    expect(r).toHaveLength(2);
    const [url0, init0] = f.mock.calls[0];
    expect(url0).toContain('/1234567890/message_templates?fields=name,status,language,category,components,rejected_reason');
    expect(url0).not.toContain(CRED.token);
    expect((init0!.headers as Record<string, string>).Authorization).toBe(`Bearer ${CRED.token}`);
  });

  it('un `next` hacia otro host se rechaza (no se le manda el token a un tercero)', async () => {
    const f = vi.fn<FetchLike>().mockResolvedValue(respuesta({ data: [], paging: { next: 'https://evil.test/steal' } }));
    await expect(consultarPlantillasMeta(CRED, f)).rejects.toThrow(/host inesperado/);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('error de Meta: el mensaje no filtra el token aunque Meta lo eco', async () => {
    const f = vi.fn<FetchLike>().mockResolvedValue(respuesta(`{"error":"Invalid OAuth ${CRED.token}"}`, 401));
    const e = await consultarPlantillasMeta(CRED, f).catch((x: Error) => x);
    expect((e as Error).message).toMatch(/401/);
    expect((e as Error).message).not.toContain(CRED.token);
  });

  it('respuesta no JSON o sin data', async () => {
    await expect(consultarPlantillasMeta(CRED, async () => respuesta('<html>'))).rejects.toThrow(/no es JSON/);
    await expect(consultarPlantillasMeta(CRED, async () => respuesta({ foo: 1 }))).rejects.toThrow(/sin `data`/);
  });

  it('credenciales inválidas: ni se llama a la red', async () => {
    const f = vi.fn<FetchLike>();
    await expect(consultarPlantillasMeta({ wabaId: '../../x', token: 't' }, f)).rejects.toThrow(/inválido/);
    await expect(consultarPlantillasMeta({ wabaId: '1234567890', token: ' ' }, f)).rejects.toThrow(/WHATSAPP_ACCESS_TOKEN/);
    expect(f).not.toHaveBeenCalled();
  });

  it('un servidor que repite `next` para siempre se corta en maxPaginas', async () => {
    const f = vi.fn<FetchLike>().mockImplementation(async () => respuesta({ data: [], paging: { next: 'https://graph.facebook.com/v21.0/loop' } }));
    await consultarPlantillasMeta(CRED, f, 3);
    expect(f).toHaveBeenCalledTimes(3);
  });
});

describe('crearPlantillaMeta', () => {
  it('POST con el cuerpo de creación del catálogo', async () => {
    const f = vi.fn<FetchLike>().mockResolvedValue(respuesta({ id: '555', status: 'PENDING' }));
    const p = plantillaDeCatalogo('conductor_recordatorio_1_v1')!;
    expect(await crearPlantillaMeta(CRED, p, f)).toEqual({ ok: true, id: '555' });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v21.0/1234567890/message_templates');
    expect(init!.method).toBe('POST');
    expect(JSON.parse(String(init!.body))).toMatchObject({ name: 'conductor_recordatorio_1_v1', category: 'UTILITY', language: 'es_MX' });
  });
  it('rechazo de Meta: devuelve el error sin el token', async () => {
    const f = vi.fn<FetchLike>().mockResolvedValue(respuesta(`{"error":{"message":"x ${CRED.token}"}}`, 400));
    const r = await crearPlantillaMeta(CRED, plantillaDeCatalogo('plazo_factura')!, f);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain(CRED.token);
  });
});
