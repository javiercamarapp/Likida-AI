// Utilidades de ESCENARIO para las pruebas de servicio/bandeja/salida: dos flotas, operadores,
// un LLM de guion y atajos para subir y procesar un documento.
import { estado } from './repo_falso.fixture';
import { recibirDocumento, procesarDocumento, type DepsServicio } from './servicio';
import type { LlmExtractor } from './extractor';
import { lecturaBoreal, llmFalso, salida, type LlmFalso } from './llm_falso.fixture';
import { RFC } from './documentos_sinteticos.fixture';

export const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export const USUARIO_A = 'uuuuuuuu-uuuu-4uuu-8uuu-aaaaaaaaaaaa';
export const USUARIO_B = 'uuuuuuuu-uuuu-4uuu-8uuu-bbbbbbbbbbbb';
export const ACTOR = { id: USUARIO_A, email: 'oficina@flota-a.test' };

export function sembrarFlotas(): void {
  estado.operadores.push(
    { tenantId: A, id: 'op-maria', nombre: 'María Hernández Soto', activo: true },
    { tenantId: A, id: 'op-juan', nombre: 'Juan Pérez López', activo: true },
    { tenantId: A, id: 'op-baja', nombre: 'Luis de Baja', activo: false },
    { tenantId: B, id: 'op-b1', nombre: 'Operador de la flota B', activo: true },
  );
  estado.unidades.push({ tenantId: A, id: 'un-xyz', placas: 'XYZ9876', activo: true }, { tenantId: A, id: 'un-abc', placas: 'ABC1234', activo: true });
  estado.clientes.push({ tenantId: A, id: 'cli-boreal', nombre: 'Grupo Boreal' }, { tenantId: B, id: 'cli-b', nombre: 'Cliente B' });
}

export const sinAgenteApagado: DepsServicio = { apagado: async () => false };

export async function subir(tenantId: string, bytes: Uint8Array, nombre = 'doc.bin', over: Partial<Parameters<typeof recibirDocumento>[1]> = {}) {
  const r = await recibirDocumento(tenantId, { canal: 'manual', nombre, bytes, ...over }, sinAgenteApagado);
  if (!r.ok) throw new Error(`no se recibió: ${r.mensaje}`);
  return r;
}

export async function subirYProcesar(tenantId: string, bytes: Uint8Array, llm: LlmExtractor, nombre = 'doc.bin', over: Partial<Parameters<typeof recibirDocumento>[1]> = {}) {
  const r = await subir(tenantId, bytes, nombre, over);
  const p = await procesarDocumento(tenantId, r.documentoId, { ...sinAgenteApagado, llm: () => llm });
  return { ...r, proceso: p };
}

/** El LLM que lee bien el PDF de Boreal. */
export const llmBoreal = (): LlmFalso => llmFalso((e) => lecturaBoreal(e.nivel));

/** Lo que un buen modelo leería del Excel de Atlas (el valor tal cual del documento). */
export function lecturaAtlas(nivel: 1 | 2 | 3 = 1, folio = 'ATL-20481') {
  const c = 0.97;
  const ev = (t: string): string => t;
  return salida(nivel, {
    folio_cliente: [folio, c, ev(folio)],
    fecha_salida: ['15/10/2026', c, '15/10/2026'],
    origen_nombre: ['Distribuidora Atlas SA de CV', c, 'Distribuidora Atlas SA de CV'],
    origen_rfc: [RFC.atlas, c, RFC.atlas], origen_cp: ['44100', c, '44100'], origen_estado: ['Jalisco', c, 'Jalisco'],
    destino_nombre: ['Comercializadora Monterrey SA de CV', c, 'Comercializadora Monterrey SA de CV'],
    destino_rfc: [RFC.destino1, c, RFC.destino1], destino_cp: ['64000', c, '64000'], destino_estado: ['Nuevo León', c, 'Nuevo León'],
    operador_nombre: ['Juan Pérez López', c, 'Juan Pérez López'], unidad_placas: ['ABC1234', c, 'ABC1234'],
  }, [{
    descripcion: ['Botellas de vidrio vacías', c, 'Botellas de vidrio vacías'], bienes_transp: ['24131500', c, '24131500'],
    cantidad: ['1,200', c, '1,200'], unidad_texto: ['Cajas', c, 'Cajas'], peso_kg: ['8,400', c, '8,400'],
  }]);
}
