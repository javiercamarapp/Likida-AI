import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Mundo } from './mundo.fixture';

// `crearViaje` de punta a punta contra la base en memoria: al despachar, el convenio del cliente se liga al viaje y sus
// instrucciones salen al operador DESPUÉS del aviso del viaje; y un fallo de convenios jamás deshace el despacho.

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
const orden: string[] = [];
vi.mock('../notificar', () => ({ notificarAsignacion: vi.fn(async () => { orden.push('aviso_viaje'); return { enviado: true }; }) }));
vi.mock('../carta_porte_wa', () => ({ evaluarYAvisarCcpDespacho: vi.fn(async () => {}) }));
vi.mock('../briefing_inicio_wa', () => ({ enviarBriefingInicio: vi.fn(async () => {}) }));
vi.mock('../bitacora_escritura', () => ({ anotarBitacora: vi.fn(async () => {}) }));
vi.mock('@/lib/meta/enviar_con_fallback', () => ({
  enviarConFallback: vi.fn(async (_tel: string, o: { texto: string }) => { orden.push(`instrucciones:${o.texto.includes('Puerta 3')}`); return { ok: true, via: 'texto', id: 'w', motivo: 'ventana_abierta', ventana: 'abierta' }; }),
}));
let mundo = new Mundo();
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => mundo.admin() }));

const { crearViaje } = await import('../operacion');
const { importarConvenios } = await import('./repo');
const { parsearMatrizConvenios } = await import('./importador');

const A = 'tenant-a';
let clienteId: string; let operadorId: string;

beforeEach(async () => {
  mundo = new Mundo();
  orden.length = 0;
  clienteId = String(mundo.poner('cliente', { tenant_id: A, nombre: 'Cliente Uno' }).id);
  operadorId = String(mundo.poner('operador', { tenant_id: A, nombre: 'Juan Pérez', telefono: '5213312345678', activo: true }).id);
  const p = parsearMatrizConvenios([['Cliente', 'Convenio', 'Categoría', 'Instrucción'], ['Cliente Uno', 'Ruta', 'puerta', 'Puerta 3']], { puedeVerFinanzas: false });
  await importarConvenios(A, p.convenios, { conFinanzas: false });
  // `crearViaje` lee `unidad`/`terminal`: tablas que este mundo no usa
  mundo.tablas.unidad = []; mundo.tablas.terminal = [];
});

describe('crearViaje liga el convenio y manda la calle de instrucciones', () => {
  it('al despachar: primero el aviso del viaje, luego las instrucciones del convenio; el viaje queda ligado', async () => {
    const id = await crearViaje(A, { operadorId, clienteId, origen: 'Zapopan', destino: 'Tlaquepaque' });
    expect(orden).toEqual(['aviso_viaje', 'instrucciones:true']);
    expect(mundo.tablas.viaje_convenio).toHaveLength(1);
    expect(mundo.tablas.viaje_convenio[0]).toMatchObject({ viaje_id: id, tenant_id: A, despacho_canal: 'texto' });
  });

  it('un viaje sin cliente (o de un cliente sin convenio) se despacha igual, sin instrucciones', async () => {
    await crearViaje(A, { operadorId, origen: 'A', destino: 'B' });
    expect(orden).toEqual(['aviso_viaje']);
    expect(mundo.tablas.viaje).toHaveLength(1);
  });

  it('con la base sin migrar el viaje se crea y se avisa como siempre', async () => {
    mundo.ausentes.add('viaje_convenio');
    mundo.ausentes.add('cliente_convenio');
    const id = await crearViaje(A, { operadorId, clienteId, origen: 'Zapopan', destino: 'Tlaquepaque' });
    expect(id).toBeTruthy();
    expect(orden).toEqual(['aviso_viaje']);
  });

  it('sin operador no se manda nada (todavía no hay a quién)', async () => {
    await crearViaje(A, { clienteId, origen: 'Zapopan', destino: 'Tlaquepaque' });
    expect(orden).toEqual([]);
    expect(mundo.tablas.viaje_convenio).toHaveLength(0);
  });
});
