import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./repo', async () => (await import('./repo_falso.fixture')).api);
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
const bitacora = vi.hoisted(() => ({ anotarBitacora: vi.fn(async (_e: unknown, _o?: unknown) => true) }));
vi.mock('../bitacora_escritura', () => bitacora);
const borrador = vi.hoisted(() => ({ getBorradorViaje: vi.fn(async () => null as unknown) }));
vi.mock('../carta_porte_datos', async (orig) => ({ ...(await orig<typeof import('../carta_porte_datos')>()), getBorradorViaje: borrador.getBorradorViaje }));

import { api, estado, reset } from './repo_falso.fixture';
import { A, B, lecturaAtlas, llmBoreal, sembrarFlotas, subir, subirYProcesar } from './escenario.fixture';
import { excelAtlas, pdfBoreal } from './documentos_sinteticos.fixture';
import { llmFalso } from './llm_falso.fixture';
import { guardarConfigSalida } from './salida_config';
import { reabrirPorRechazoTms } from './bandeja';
import { asignarAlLlegarARevision, necesitaPersona, reasignarRevisor, soloMisCasos, telefonoDelRevisor } from './revisor';
import { DatoInvalido } from '../errores';
import type { Hallazgo } from './validacion';

const REVISORA = '00000000-0000-4000-8000-0000000000f1';
const OTRA = '00000000-0000-4000-8000-0000000000f2';
const AJENA = '00000000-0000-4000-8000-0000000000b1';
const BAJA = '00000000-0000-4000-8000-0000000000f3';
const OPERADOR = '00000000-0000-4000-8000-0000000000f4';
const ACTOR = { id: OTRA };
const CON_DUDA = { bloqueos: 1, porConfirmar: 0, listoParaAprobar: false };
const LIMPIO = { bloqueos: 0, porConfirmar: 0, listoParaAprobar: true };

function sembrarPersonas(): void {
  estado.usuarios.push(
    { tenantId: A, id: REVISORA, nombre: 'Persona Uno', email: 'uno@flota-a.test', rol: 'encargado', telefono: '5215500001111', activo: true },
    { tenantId: A, id: OTRA, nombre: 'Persona Dos', email: 'dos@flota-a.test', rol: 'flota_admin', telefono: null, activo: true },
    { tenantId: A, id: BAJA, nombre: 'Persona Baja', email: 'baja@flota-a.test', rol: 'encargado', telefono: null, activo: false },
    { tenantId: A, id: OPERADOR, nombre: 'Chofer', email: 'chofer@flota-a.test', rol: 'operador', telefono: null, activo: true },
    { tenantId: B, id: AJENA, nombre: 'Persona de B', email: 'b@flota-b.test', rol: 'encargado', telefono: null, activo: true },
  );
}
const tipos = (id: string) => estado.eventos.filter((e) => e.documentoId === id).map((e) => e.tipo);
async function documento(tenantId = A, nombre = 'doc.bin'): Promise<string> {
  return (await subir(tenantId, new TextEncoder().encode(`contenido ${estado.seq++} ${nombre}`), nombre)).documentoId;
}

beforeEach(() => { reset(); sembrarFlotas(); sembrarPersonas(); bitacora.anotarBitacora.mockClear(); borrador.getBorradorViaje.mockClear(); });

describe('necesitaPersona', () => {
  it('bloqueo, algo por confirmar o no listo = necesita a una persona; limpio no', () => {
    expect(necesitaPersona(CON_DUDA)).toBe(true);
    expect(necesitaPersona({ bloqueos: 0, porConfirmar: 2, listoParaAprobar: false })).toBe(true);
    expect(necesitaPersona({ bloqueos: 0, porConfirmar: 0, listoParaAprobar: false })).toBe(true);
    expect(necesitaPersona(LIMPIO)).toBe(false);
    expect(necesitaPersona(null)).toBe(false);
  });
});

describe('asignación automática al caer a revisión', () => {
  it('con destinatario configurado y un caso con duda: se asigna y deja el evento revisor_asignado', async () => {
    await guardarConfigSalida(A, { destinatarioRevisionUsuario: REVISORA }, 'sistema');
    const id = await documento();
    expect(await asignarAlLlegarARevision(A, id, CON_DUDA)).toEqual({ asignado: true, usuarioId: REVISORA });
    expect(estado.revisores.get(id)).toBe(REVISORA);
    expect(estado.eventos.filter((e) => e.tipo === 'revisor_asignado' && e.documentoId === id)).toEqual([
      expect.objectContaining({ actorId: null, detalle: { origen: 'automatica', hacia: REVISORA } }),
    ]);
  });

  it('sin configuración: comportamiento actual (nadie asignado, ningún evento)', async () => {
    const id = await documento();
    expect(await asignarAlLlegarARevision(A, id, CON_DUDA)).toEqual({ asignado: false, motivo: 'sin_configuracion' });
    expect(estado.revisores.size).toBe(0);
    expect(tipos(id)).not.toContain('revisor_asignado');
  });

  it('un caso limpio (sin bloqueo ni duda) no se asigna aunque haya configuración', async () => {
    await guardarConfigSalida(A, { destinatarioRevisionUsuario: REVISORA }, 'sistema');
    const id = await documento();
    expect(await asignarAlLlegarARevision(A, id, LIMPIO)).toEqual({ asignado: false, motivo: 'sin_duda' });
    expect(estado.revisores.size).toBe(0);
  });

  it('es idempotente y NO pisa lo que una persona reasignó a mano', async () => {
    await guardarConfigSalida(A, { destinatarioRevisionUsuario: REVISORA }, 'sistema');
    const id = await documento();
    await asignarAlLlegarARevision(A, id, CON_DUDA);
    expect(await asignarAlLlegarARevision(A, id, CON_DUDA)).toEqual({ asignado: false, motivo: 'ya_asignado' });
    await reasignarRevisor(A, id, OTRA, ACTOR);
    expect(await asignarAlLlegarARevision(A, id, CON_DUDA)).toEqual({ asignado: false, motivo: 'ya_asignado' });
    expect(estado.revisores.get(id)).toBe(OTRA);
    expect(estado.eventos.filter((e) => e.tipo === 'revisor_asignado')).toHaveLength(2);
  });

  it('un destinatario configurado que ya no es válido (desactivado, de otra flota o sin rol de oficina) no se asigna', async () => {
    const id = await documento();
    for (const malo of [BAJA, AJENA, OPERADOR]) {
      await guardarConfigSalida(A, { destinatarioRevisionUsuario: malo }, 'sistema');
      expect(await asignarAlLlegarARevision(A, id, CON_DUDA)).toEqual({ asignado: false, motivo: 'usuario_no_valido' });
    }
    expect(estado.revisores.size).toBe(0);
  });

  it('A37-S32-10: si una persona asigna entre la lectura y el update, la automática NO la pisa', async () => {
    await guardarConfigSalida(A, { destinatarioRevisionUsuario: REVISORA }, 'sistema');
    const id = await documento();
    estado.revisores.set(id, OTRA); // la asignó una persona justo después de que la automática la leyó vacía
    const espia = vi.spyOn(api, 'revisoresDeDocumentos').mockResolvedValueOnce(new Map());
    expect((await asignarAlLlegarARevision(A, id, CON_DUDA)).asignado).toBe(false);
    espia.mockRestore();
    expect(estado.revisores.get(id)).toBe(OTRA);
  });

  it('nunca lanza: un fallo de la base se vuelve «error» y el documento sigue', async () => {
    await guardarConfigSalida(A, { destinatarioRevisionUsuario: REVISORA }, 'sistema');
    const id = await documento();
    estado.fallar.set('asignarRevisorDoc', new Error('base caída'));
    expect(await asignarAlLlegarARevision(A, id, CON_DUDA)).toEqual({ asignado: false, motivo: 'error' });
    estado.fallar.clear();
    estado.sinColumnaRevisor = true; // base sin la 0790
    expect(await asignarAlLlegarARevision(A, id, CON_DUDA)).toEqual({ asignado: false, motivo: 'error' });
  });

  it('de punta a punta: al terminar de leer un documento con duda cae asignado; sin configuración, no', async () => {
    const pdf = await pdfBoreal();
    const sinConfig = await subirYProcesar(A, pdf, llmBoreal(), 'a.pdf');
    expect(sinConfig.proceso.ok && sinConfig.proceso.estado).toBe('por_revisar');
    expect(estado.revisores.size).toBe(0);

    await guardarConfigSalida(A, { destinatarioRevisionUsuario: REVISORA }, 'sistema');
    const r = await subirYProcesar(A, await excelAtlas(), llmFalso(() => lecturaAtlas(1)), 'b.xlsx');
    const doc = estado.docs.get(r.documentoId)!;
    expect(doc.estado).toBe('por_revisar');
    expect(doc.validacion?.porConfirmar).toBeGreaterThan(0);
    expect(estado.revisores.get(r.documentoId)).toBe(REVISORA);
  });

  it('un rechazo del sistema del cliente devuelve el caso a revisión y le llega al destinatario', async () => {
    await guardarConfigSalida(A, { destinatarioRevisionUsuario: REVISORA }, 'sistema');
    const r = await subirYProcesar(A, await pdfBoreal(), llmBoreal(), 'c.pdf');
    const antes = estado.docs.get(r.documentoId)!;
    estado.docs.set(antes.id, { ...antes, estado: 'aprobado' });
    estado.revisores.delete(antes.id);
    const hallazgo: Hallazgo = { campo: 'origen_cp', renglon: null, severidad: 'bloqueo', codigo: 'tms_rechazo', mensaje: 'El sistema del cliente rechazó el código postal.', origen: 'tms' };
    const d = await reabrirPorRechazoTms(A, antes.id, antes.version, [hallazgo]);
    expect(d.estado).toBe('por_revisar');
    expect(estado.revisores.get(antes.id)).toBe(REVISORA);
  });
});

describe('reasignar desde el visor', () => {
  it('cambia el revisor, deja el evento con quién lo hizo y NO sube la versión del documento', async () => {
    const id = await documento();
    const v = estado.docs.get(id)!.version;
    expect(await reasignarRevisor(A, id, REVISORA, ACTOR)).toEqual({ cambio: true, usuarioId: REVISORA });
    expect(estado.revisores.get(id)).toBe(REVISORA);
    expect(estado.docs.get(id)!.version).toBe(v);
    expect(estado.eventos.find((e) => e.tipo === 'revisor_asignado')).toMatchObject({ actorId: OTRA, detalle: { origen: 'manual', desde: null, hacia: REVISORA } });
    await reasignarRevisor(A, id, OTRA, ACTOR);
    expect(estado.eventos.filter((e) => e.tipo === 'revisor_asignado').at(-1)).toMatchObject({ detalle: { origen: 'manual', desde: REVISORA, hacia: OTRA } });
  });

  it('reasignar a quien ya lo tiene no hace nada ni deja evento', async () => {
    const id = await documento();
    await reasignarRevisor(A, id, REVISORA, ACTOR);
    expect(await reasignarRevisor(A, id, REVISORA, ACTOR)).toEqual({ cambio: false, usuarioId: REVISORA });
    expect(await reasignarRevisor(A, await documento(A, 'otro.bin'), null, ACTOR)).toEqual({ cambio: false, usuarioId: null });
    expect(estado.eventos.filter((e) => e.tipo === 'revisor_asignado')).toHaveLength(1);
  });

  it('quitar el revisor (null) devuelve el caso a «todos los revisores»', async () => {
    const id = await documento();
    await reasignarRevisor(A, id, REVISORA, ACTOR);
    expect(await reasignarRevisor(A, id, null, ACTOR)).toEqual({ cambio: true, usuarioId: null });
    expect(estado.revisores.has(id)).toBe(false);
  });

  it('una persona de OTRA flota, desactivada o con un rol que no revisa NO se puede asignar', async () => {
    const id = await documento();
    for (const mala of [AJENA, BAJA, OPERADOR, '00000000-0000-4000-8000-00000000ffff']) {
      await expect(reasignarRevisor(A, id, mala, ACTOR)).rejects.toThrow(DatoInvalido);
    }
    expect(estado.revisores.size).toBe(0);
    expect(tipos(id)).not.toContain('revisor_asignado');
  });

  it('un documento de otra flota no se reasigna', async () => {
    const ajeno = await documento(B, 'ajeno.bin');
    await expect(reasignarRevisor(A, ajeno, REVISORA, ACTOR)).rejects.toThrow('no está en tu flota');
    expect(estado.revisores.size).toBe(0);
  });

  it('sin la 0790 lanza una frase clara y no deja evento', async () => {
    const id = await documento();
    estado.sinColumnaRevisor = true;
    await expect(reasignarRevisor(A, id, REVISORA, ACTOR)).rejects.toThrow('falta la migración 0790');
    expect(tipos(id)).not.toContain('revisor_asignado');
  });
});

describe('«Mis casos»', () => {
  it('solo muestra los asignados a esa persona; los sin asignar y los de otra no', () => {
    const filas = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
    expect(soloMisCasos(filas, { a: REVISORA, b: OTRA, c: REVISORA }, REVISORA).map((d) => d.id)).toEqual(['a', 'c']);
    expect(soloMisCasos(filas, {}, REVISORA)).toEqual([]);
  });
});

describe('a quién se le avisa', () => {
  it('el teléfono del revisor asignado; null si no hay asignado o no tiene teléfono', async () => {
    const id = await documento();
    expect(await telefonoDelRevisor(A, id)).toBeNull();
    await reasignarRevisor(A, id, OTRA, ACTOR);
    expect(await telefonoDelRevisor(A, id)).toBeNull();
    await reasignarRevisor(A, id, REVISORA, ACTOR);
    expect(await telefonoDelRevisor(A, id)).toBe('5215500001111');
  });

  it('una persona desactivada después de asignarla ya no recibe el aviso (cae al jefe de tráfico)', async () => {
    const id = await documento();
    await reasignarRevisor(A, id, REVISORA, ACTOR);
    estado.usuarios.find((u) => u.id === REVISORA)!.activo = false;
    expect(await telefonoDelRevisor(A, id)).toBeNull();
  });
});
