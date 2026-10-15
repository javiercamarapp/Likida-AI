import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('./repo', async () => (await import('./repo_falso.fixture')).api);
const bitacora = vi.hoisted(() => ({ anotarBitacora: vi.fn(async (_entrada: unknown, _opciones?: unknown) => true) }));
vi.mock('../bitacora_escritura', () => bitacora);
vi.mock('../carta_porte_datos', async (orig) => ({ ...(await orig<typeof import('../carta_porte_datos')>()), getBorradorViaje: vi.fn(async () => null) }));

import { estado, reset } from './repo_falso.fixture';
import { A, ACTOR, B, USUARIO_B, llmBoreal, sembrarFlotas, subirYProcesar } from './escenario.fixture';
import { aprobarDocumento, corregirCampos, crearViajeDeDocumento, reabrirDocumento } from './bandeja';
import { MENSAJE_FUNCION_NO_DISPONIBLE, fijarGuardiaPerfil, llaveDeEnvio, prepararEnvioTms } from './envio';
import { aplicarSalidaViaje } from './salida';
import { llmFalso, lecturaBoreal } from './llm_falso.fixture';
import { pdfBoreal } from './documentos_sinteticos.fixture';

const BAJO_PERFIL = async (t: string) => t === A;

beforeEach(() => { reset(); sembrarFlotas(); bitacora.anotarBitacora.mockClear(); fijarGuardiaPerfil(BAJO_PERFIL); });
afterEach(() => fijarGuardiaPerfil());

/** Un documento sintético cuyo operador NO se puede identificar: sin perfil, la salida de siempre no crearía viaje. */
async function documentoSinOperador() {
  const llm = llmFalso((e) => {
    const s = lecturaBoreal(e.nivel);
    const op = s.campos.find((c) => c.clave === 'operador_nombre')!;
    op.valor = 'Persona Desconocida'; op.evidencia = 'Operador: Maria Hernandez Soto';
    return s;
  });
  const r = await subirYProcesar(A, await pdfBoreal(), llm, 'orden.pdf', { clienteId: 'cli-boreal', remitente: 'logistica@boreal.example' });
  return { id: r.documentoId, doc: () => estado.docs.get(r.documentoId)! };
}
const tipos = (id: string) => estado.eventos.filter((e) => e.documentoId === id).map((e) => e.tipo);

describe('aprobar bajo el perfil = preparar el envío al TMS', () => {
  it('sin operador crea un envío pendiente_prechequeo y NO crea viaje ni renglones de mercancía', async () => {
    const { id, doc } = await documentoSinOperador();
    const r = await aprobarDocumento(A, id, doc().version, ACTOR);
    expect(r.documento.estado).toBe('aprobado');
    expect(r.salida).toBeNull();
    expect(r.envio).toMatchObject({ ok: true, creado: true });
    expect(estado.envios).toHaveLength(1);
    expect(estado.envios[0]).toMatchObject({ tenantId: A, documentoId: id, estado: 'pendiente_prechequeo', versionDoc: doc().version, plantilla: 'normal' });
    expect(estado.envios[0].idempotencyKey).toBe(llaveDeEnvio(A, id, doc().version, 'normal'));
    expect(estado.viajes.length).toBe(0);
    expect(estado.mercancias.length).toBe(0);
    expect(doc().viajeId).toBeNull();
    expect(tipos(id)).toContain('envio_preparado');
    expect(tipos(id)).not.toContain('salida_viaje');
    expect(estado.llamadas).not.toContain('insertarViaje');
  });

  it('aprobar dos veces la misma versión deja UN solo envío y un solo evento', async () => {
    const { id, doc } = await documentoSinOperador();
    await aprobarDocumento(A, id, doc().version, ACTOR);
    const dos = await prepararEnvioTms(A, doc(), ACTOR);
    expect(dos).toMatchObject({ ok: true, creado: false, descartados: 0 });
    expect(estado.envios).toHaveLength(1);
    expect(tipos(id).filter((t) => t === 'envio_preparado')).toHaveLength(1);
  });

  it('reabrir, corregir y aprobar: el envío viejo queda descartado y hay uno nuevo con otra llave', async () => {
    const { id, doc } = await documentoSinOperador();
    await aprobarDocumento(A, id, doc().version, ACTOR);
    const viejo = estado.envios[0];
    await reabrirDocumento(A, id, doc().version, ACTOR.id);
    await corregirCampos(A, id, doc().version, [{ campo: 'origen_cp', renglon: null, valor: '66601' }], ACTOR.id);
    const r = await aprobarDocumento(A, id, doc().version, ACTOR);
    expect(r.envio).toMatchObject({ ok: true, creado: true, descartados: 1 });
    expect(estado.envios).toHaveLength(2);
    expect(estado.envios.find((e) => e.id === viejo.id)!.estado).toBe('descartado');
    const nuevo = estado.envios.find((e) => e.id !== viejo.id)!;
    expect(nuevo.estado).toBe('pendiente_prechequeo');
    expect(nuevo.idempotencyKey).not.toBe(viejo.idempotencyKey);
    expect(nuevo.versionDoc).toBe(doc().version);
    expect(estado.viajes.length).toBe(0);
  });

  it('un documento que no está aprobado no prepara envío', async () => {
    const { id, doc } = await documentoSinOperador();
    const r = await prepararEnvioTms(A, doc(), ACTOR);
    expect(r).toMatchObject({ ok: false, motivo: 'no_aprobado' });
    expect(estado.envios).toHaveLength(0);
    expect(tipos(id)).not.toContain('envio_preparado');
  });

  it('la llave depende de la flota, el documento, la versión y la plantilla', () => {
    const base = llaveDeEnvio(A, 'd1', 3, 'normal');
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    expect(base).toBe(llaveDeEnvio(A, 'd1', 3, 'normal'));
    for (const otra of [llaveDeEnvio(B, 'd1', 3, 'normal'), llaveDeEnvio(A, 'd2', 3, 'normal'), llaveDeEnvio(A, 'd1', 4, 'normal'), llaveDeEnvio(A, 'd1', 3, 'nueva')]) expect(otra).not.toBe(base);
  });

  it('un fallo al preparar el envío NO deshace la aprobación', async () => {
    const { id, doc } = await documentoSinOperador();
    estado.fallar.set('insertarEnvioTms', new Error('base caída'));
    const r = await aprobarDocumento(A, id, doc().version, ACTOR);
    expect(r.documento.estado).toBe('aprobado');
    expect(r.envio).toMatchObject({ ok: false, motivo: 'error' });
    expect(estado.envios).toHaveLength(0);
  });
});

describe('«crear viaje» en stand-by bajo el perfil', () => {
  it('crearViajeDeDocumento devuelve el mensaje y no toca el repo', async () => {
    const { id, doc } = await documentoSinOperador();
    await aprobarDocumento(A, id, doc().version, ACTOR);
    estado.llamadas.length = 0;
    const r = await crearViajeDeDocumento(A, id, ACTOR, 'op-maria');
    expect(r).toEqual({ ok: false, motivo: 'datos_invalidos', mensaje: MENSAJE_FUNCION_NO_DISPONIBLE });
    expect(estado.llamadas).toEqual([]);
    expect(estado.viajes.length).toBe(0);
  });

  it('aplicarSalidaViaje directa también queda bloqueada bajo el perfil, sin tocar el repo', async () => {
    const { id, doc } = await documentoSinOperador();
    await aprobarDocumento(A, id, doc().version, ACTOR);
    estado.llamadas.length = 0;
    const r = await aplicarSalidaViaje(A, doc(), { operadorId: 'op-maria' });
    expect(r).toMatchObject({ ok: false, mensaje: MENSAJE_FUNCION_NO_DISPONIBLE });
    expect(estado.llamadas).toEqual([]);
    expect(estado.viajes.length).toBe(0);
  });

  it('una guardia que falla se trata como «bajo perfil» (lado seguro)', async () => {
    fijarGuardiaPerfil(async () => { throw new Error('sin respuesta'); });
    const r = await crearViajeDeDocumento(A, 'cualquiera', ACTOR, null);
    expect(r).toMatchObject({ ok: false, mensaje: MENSAJE_FUNCION_NO_DISPONIBLE });
  });
});

describe('las flotas sin perfil conservan el viaje de siempre', () => {
  it('aprobar en otra flota crea el viaje y NO prepara envío', async () => {
    fijarGuardiaPerfil(async () => false);
    const r = await subirYProcesar(A, await pdfBoreal(), llmBoreal(), 'orden.pdf', { clienteId: 'cli-boreal' });
    const ap = await aprobarDocumento(A, r.documentoId, estado.docs.get(r.documentoId)!.version, ACTOR);
    expect(ap.salida).toMatchObject({ ok: true, accion: 'creado' });
    expect(ap.envio).toBeNull();
    expect(estado.envios).toHaveLength(0);
    expect(estado.viajes).toHaveLength(1);
  });

  it('el perfil de la flota A no alcanza a la flota B', async () => {
    const r = await subirYProcesar(B, await pdfBoreal(), llmBoreal(), 'orden.pdf');
    const d = estado.docs.get(r.documentoId)!;
    const ap = await aprobarDocumento(B, r.documentoId, d.version, { id: USUARIO_B });
    expect(ap.envio).toBeNull();
    expect(ap.salida).not.toBeNull();
    expect(estado.envios).toHaveLength(0);
  });
});

describe('envio.ts no toca el camino del timbre', () => {
  it('no importa pac/, carta_porte_timbre ni carta_porte_cfdi', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/likida/carta_porte_docs/envio.ts'), 'utf8')
      .split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
    const imports = [...src.matchAll(/from ['"]([^'"]+)['"]/g)].map((m) => m[1]);
    expect(imports.length).toBeGreaterThan(0);
    for (const i of imports) expect(i, `envio.ts importa ${i}`).not.toMatch(/pac\/|carta_porte_timbre|carta_porte_cfdi|carta_porte_xml/);
    expect(/resolverPac|\.timbrar\(|timbrarCcp|timbrarCfdi/.test(src)).toBe(false);
  });
});
