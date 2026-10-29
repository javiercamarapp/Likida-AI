import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A3-14 (cierre100, ola 10): un documento SIN cliente no completa el viaje de un cliente con el mismo folio.
vi.mock('./repo', async () => (await import('./repo_falso.fixture')).api);
vi.mock('../bitacora_escritura', () => ({ anotarBitacora: vi.fn(async () => true) }));
vi.mock('../carta_porte_datos', async (orig) => ({ ...(await orig<typeof import('../carta_porte_datos')>()), getBorradorViaje: vi.fn(async () => null) }));

import { estado, reset } from './repo_falso.fixture';
import { A, ACTOR, llmBoreal, sembrarFlotas, subirYProcesar } from './escenario.fixture';
import { aprobarDocumento } from './bandeja';
import { fijarGuardiaPerfil } from './envio';
import { pdfBoreal } from './documentos_sinteticos.fixture';

beforeEach(() => { reset(); sembrarFlotas(); fijarGuardiaPerfil(async () => false); });
afterEach(() => fijarGuardiaPerfil());

describe('A3-14: folio de un viaje con cliente y documento sin cliente', () => {
  it('NO completa el viaje del cliente: pide asignar el cliente y no le cuelga mercancías', async () => {
    const r = await subirYProcesar(A, await pdfBoreal(), llmBoreal(), 'o.pdf');   // sin clienteId (como WhatsApp)
    expect(estado.docs.get(r.documentoId)!.clienteId ?? null).toBeNull();
    estado.viajes.push({ tenantId: A, id: 'v-con-cliente', folio: 'BOR-77120', origen: null, operadorId: null, clienteId: 'cli-otro', estatus: 'abierto' } as never);
    const ap = await aprobarDocumento(A, r.documentoId, estado.docs.get(r.documentoId)!.version, ACTOR);
    expect(ap.salida).toMatchObject({ ok: false, motivo: 'falta_cliente' });
    expect(estado.viajes).toHaveLength(1);
    expect(estado.viajes[0].origen ?? null).toBeNull();
    expect(estado.mercancias.filter((m) => m.viajeId === 'v-con-cliente')).toHaveLength(0);
  });

  it('un viaje SIN cliente sí se completa con un documento sin cliente (nada que contaminar)', async () => {
    const r = await subirYProcesar(A, await pdfBoreal(), llmBoreal(), 'o.pdf');
    estado.viajes.push({ tenantId: A, id: 'v-sin-cliente', folio: 'BOR-77120', origen: null, operadorId: null, estatus: 'abierto' } as never);
    const ap = await aprobarDocumento(A, r.documentoId, estado.docs.get(r.documentoId)!.version, ACTOR);
    expect(ap.salida).toMatchObject({ ok: true, accion: 'actualizado', viajeId: 'v-sin-cliente' });
  });
});
