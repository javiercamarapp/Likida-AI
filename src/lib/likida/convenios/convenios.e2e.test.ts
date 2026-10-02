import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Mundo } from './mundo.fixture';

// ═══════════════════════════════════════════════════════════════════════════
// E2E DE LOS CONVENIOS, de punta a punta contra la base en memoria: el archivo del cliente → el viaje se despacha → las
// instrucciones llegan al operador por WhatsApp → se acerca a la planta de carga y se le recuerdan las de ESA planta →
// pregunta «¿por dónde entro?» y el agente responde con el perfil → carga, se acerca a la de descarga y se le recuerdan
// las de la otra planta → la flota exporta la calle de instrucciones sin un peso. Con la tarifa del convenio presente todo
// el tiempo: no puede aparecer en ningún mensaje ni exportación de operación.
//
// Lo que NO prueba (lo prueba otro): RLS y llaves foráneas (supabase/tests/0580_convenios.sql contra Postgres real), Meta
// real (bloqueo externo: plantillas sin aprobar), la lectura real de GPS.
// ═══════════════════════════════════════════════════════════════════════════

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
const wa: Array<{ telefono: string; texto: string; plantilla: string }> = [];
vi.mock('../notificar', () => ({ notificarAsignacion: vi.fn(async () => ({ enviado: true })) }));
vi.mock('../carta_porte_wa', () => ({ evaluarYAvisarCcpDespacho: vi.fn(async () => {}) }));
vi.mock('../briefing_inicio_wa', () => ({ enviarBriefingInicio: vi.fn(async () => {}) }));
vi.mock('../bitacora_escritura', () => ({ anotarBitacora: vi.fn(async () => {}) }));
vi.mock('@/lib/meta/enviar_con_fallback', () => ({
  enviarConFallback: vi.fn(async (telefono: string, o: { texto: string; plantilla: { nombre: string } }) => {
    wa.push({ telefono, texto: o.texto, plantilla: o.plantilla.nombre });
    return { ok: true, via: 'texto', id: 'w', motivo: 'ventana_abierta', ventana: 'abierta' };
  }),
}));
let mundo = new Mundo();
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => mundo.admin() }));

const { crearViaje } = await import('../operacion');
const { importarArchivoDelPanel } = await import('./acciones');
const { barridoAcercamiento } = await import('./acercamiento');
const { atenderPreguntaConvenio } = await import('./pregunta');
const { GET } = await import('@/app/api/export/convenios/route');

vi.mock('@/lib/auth/tenant-api', () => ({ resolverTenantApi: async () => ({ ok: true, tenantId: 'flota-1', rol: 'encargado' }) }));
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => true, clientIp: () => '1.2.3.4' }));

const T = 'flota-1';
const ORIGEN = { lat: 20.7416, lng: -103.42 };
const DESTINO = { lat: 20.6402, lng: -103.3128 };
const ARCHIVO = [
  'cliente,convenio,origen,destino,sitio_origen,sitio_destino,categoria,instruccion,momento,lugar,tarifa_modo,tarifa_precio,requisitos_cobro',
  'Cliente Uno,Ruta norte,Planta Zapopan,CEDIS Tlaquepaque,ZAP,CED,puerta,Entra por la puerta 1 de carga,ambos,origen,por_viaje,18500,Factura | Carta porte',
  'Cliente Uno,Ruta norte,,,,,reportarse,Con el guardia de la caseta 1,acercamiento,origen,,,',
  'Cliente Uno,Ruta norte,,,,,puerta,Puerta 3 lado poniente,ambos,destino,,,',
  'Cliente Uno,Ruta norte,,,,,reportarse,Con el jefe de andén Sr. Ramírez,acercamiento,destino,,,',
  'Cliente Uno,Ruta norte,,,,,documentos,Carta porte y orden de compra,despacho,ambos,,,',
].join('\n');

let operadorId: string; let unidadId: string; let clienteId: string;
const AHORA = new Date();
const posicion = (p: { lat: number; lng: number }, minAtras = 1) => mundo.poner('posicion', { tenant_id: T, unidad_id: unidadId, lat: p.lat, lng: p.lng, medida_en: new Date(AHORA.getTime() - minAtras * 60_000).toISOString() });

beforeEach(() => {
  mundo = new Mundo();
  wa.length = 0;
  clienteId = String(mundo.poner('cliente', { tenant_id: T, nombre: 'Cliente Uno' }).id);
  operadorId = String(mundo.poner('operador', { tenant_id: T, nombre: 'Juan Pérez', telefono: '5213312345678', activo: true }).id);
  unidadId = String(mundo.poner('unidad', { tenant_id: T, numero_economico: 'T-12' }).id);
  mundo.poner('geocerca', { tenant_id: T, nombre: 'Planta Zapopan', codigo: 'ZAP', activa: true, ...ORIGEN, radio_m: 300 });
  mundo.poner('geocerca', { tenant_id: T, nombre: 'CEDIS Tlaquepaque', codigo: 'CED', activa: true, ...DESTINO, radio_m: 300 });
  mundo.tablas.terminal = [];
});

describe('el ciclo completo de un convenio', () => {
  it('archivo → despacho → acercamiento a carga → pregunta → carga → acercamiento a descarga → exportación sin dinero', async () => {
    // 1. El dueño sube el archivo (con tarifa: es finanzas).
    const imp = await importarArchivoDelPanel({ tenantId: T, rol: 'flota_admin' }, { bytes: null, texto: ARCHIVO });
    expect(imp).toEqual({ ok: true, mensaje: expect.stringContaining('1 convenio nuevo') });
    expect(mundo.tablas.convenio_comercial[0]).toMatchObject({ tarifa_precio: 18500 });

    // 2. Se despacha el viaje del cliente: las instrucciones de DESPACHO llegan al operador (las de acercamiento, no).
    const viajeId = await crearViaje(T, { operadorId, unidadId, clienteId, origen: 'Planta Zapopan', destino: 'CEDIS Tlaquepaque', folio: 'F-2001' });
    mundo.tablas.viaje.find((v) => v.id === viajeId)!.aceptado_en = AHORA.toISOString();
    expect(wa).toHaveLength(1);
    expect(wa[0]).toMatchObject({ telefono: '5213312345678', plantilla: 'convenio_instrucciones_despacho_v1' });
    expect(wa[0].texto).toContain('F-2001');
    expect(wa[0].texto).toContain('Al cargar: Entra por la puerta 1 de carga');
    expect(wa[0].texto).toContain('Al descargar: Puerta 3 lado poniente');
    expect(wa[0].texto).toContain('Carta porte y orden de compra');
    expect(wa[0].texto).not.toMatch(/caseta 1|Sr\. Ramírez/); // solo de acercamiento
    // y quedó ligado, con los sitios del convenio en el viaje
    const v = mundo.tablas.viaje.find((x) => x.id === viajeId)!;
    expect(mundo.tablas.viaje_convenio[0]).toMatchObject({ viaje_id: viajeId, despacho_canal: 'texto' });
    expect(v.origen_geocerca_id).toBe(mundo.tablas.geocerca[0].id);
    expect(v.destino_geocerca_id).toBe(mundo.tablas.geocerca[1].id);

    // 3. Lejos de todo: no pasa nada.
    posicion({ lat: 21.5, lng: -103.4 }, 8);
    expect((await barridoAcercamiento(undefined, AHORA)).enviados).toBe(0);

    // 4. Se acerca a la planta de CARGA: recibe lo de esa planta, una vez.
    posicion(ORIGEN);
    expect((await barridoAcercamiento(undefined, AHORA)).enviados).toBe(1);
    expect(wa[1].plantilla).toBe('convenio_instrucciones_acercamiento_v1');
    expect(wa[1].texto).toContain('ya vas llegando a Planta Zapopan');
    expect(wa[1].texto).toContain('puerta 1 de carga');
    expect(wa[1].texto).toContain('guardia de la caseta 1');
    expect(wa[1].texto).not.toMatch(/Puerta 3|Ramírez/);
    expect((await barridoAcercamiento(undefined, AHORA)).enviados).toBe(0);

    // Los hitos del viaje ya sembrados por el Conductor (el cron los siembra al aceptar el viaje).
    const salida = mundo.poner('viaje_hito', { tenant_id: T, viaje_id: viajeId, tipo: 'salida_carga', estado: 'esperado' });

    // 5. Pregunta «¿por dónde entro?»: responde con el perfil de la planta que atiende (la de carga).
    const r1 = await atenderPreguntaConvenio({ tenantId: T, operadorId, viajeAbiertoId: String(viajeId), texto: '¿Por dónde entro?' });
    expect(r1).toBe('• Por dónde entras: Entra por la puerta 1 de carga');
    // un operador ajeno a ese viaje no recibe nada
    expect(await atenderPreguntaConvenio({ tenantId: T, operadorId: 'otro-operador', viajeAbiertoId: String(viajeId), texto: '¿Por dónde entro?' })).toBeNull();

    // 6. Carga y sale: ahora la planta que toca es la de DESCARGA.
    mundo.poner('viaje_hito', { tenant_id: T, viaje_id: viajeId, tipo: 'llegada_carga', estado: 'validado' });
    salida.estado = 'recibido';
    expect(await atenderPreguntaConvenio({ tenantId: T, operadorId, viajeAbiertoId: String(viajeId), texto: 'por donde entro' })).toBe('• Por dónde entras: Puerta 3 lado poniente');
    expect(await atenderPreguntaConvenio({ tenantId: T, operadorId, viajeAbiertoId: String(viajeId), texto: '¿con quién me reporto?' })).toContain('Sr. Ramírez');

    // 7. Se acerca a la planta de DESCARGA: es OTRO aviso (cada planta tiene su sello) y trae lo de esa planta.
    posicion(DESTINO, 0);
    expect((await barridoAcercamiento(undefined, AHORA)).enviados).toBe(1);
    expect(wa).toHaveLength(3);
    expect(wa[2].texto).toContain('ya vas llegando a CEDIS Tlaquepaque');
    expect(wa[2].texto).toContain('Puerta 3 lado poniente');
    expect(wa[2].texto).toContain('Sr. Ramírez');
    expect(wa[2].texto).not.toMatch(/puerta 1|caseta 1/);
    // y ya no hay más que avisar
    expect((await barridoAcercamiento(undefined, AHORA)).enviados).toBe(0);
    expect(wa).toHaveLength(3);
  });

  it('nada de dinero en ningún mensaje al operador ni en la exportación para el sistema de la flota', async () => {
    await importarArchivoDelPanel({ tenantId: T, rol: 'flota_admin' }, { bytes: null, texto: ARCHIVO });
    const viajeId = await crearViaje(T, { operadorId, unidadId, clienteId, origen: 'Planta Zapopan', destino: 'CEDIS Tlaquepaque', folio: 'F-2002' });
    mundo.tablas.viaje.find((v) => v.id === viajeId)!.aceptado_en = AHORA.toISOString();
    posicion(ORIGEN);
    await barridoAcercamiento(undefined, AHORA);
    expect(wa.length).toBeGreaterThan(0);
    for (const m of wa) expect(m.texto).not.toMatch(/18500|18,500|Factura|tarifa/i);
    const csv = await (await GET(new Request('https://app.likida.ai/api/export/convenios?tipo=instrucciones'))).text();
    const txt = await (await GET(new Request('https://app.likida.ai/api/export/convenios?tipo=texto'))).text();
    for (const t of [csv, txt]) { expect(t).toContain('Puerta 3 lado poniente'); expect(t).not.toMatch(/18500|18,500|Factura|tarifa/i); }
    // el encargado (jefe de tráfico) no puede bajar el completo con dinero
    expect((await GET(new Request('https://app.likida.ai/api/export/convenios?tipo=completo'))).status).toBe(403);
  });

  it('un cliente SIN convenio: el viaje se despacha igual, nada llega y la pregunta lo dice sin inventar', async () => {
    const otro = String(mundo.poner('cliente', { tenant_id: T, nombre: 'Sin convenio' }).id);
    const viajeId = await crearViaje(T, { operadorId, unidadId, clienteId: otro, origen: 'A', destino: 'B' });
    expect(wa).toHaveLength(0);
    const r = await atenderPreguntaConvenio({ tenantId: T, operadorId, viajeAbiertoId: String(viajeId), texto: '¿qué documentos llevo?' });
    expect(r).toMatch(/No tengo indicaciones de «documentos que llevas» registradas.*jefe de tráfico/);
  });
});
