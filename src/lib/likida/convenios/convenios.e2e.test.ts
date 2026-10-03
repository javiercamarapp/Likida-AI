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
// Lo que responde Meta al siguiente envío: por omisión sale bien; un caso lo cambia para simular rechazo.
let respuestaMeta: Record<string, unknown> | null = null;
vi.mock('../notificar', () => ({ notificarAsignacion: vi.fn(async () => ({ enviado: true })) }));
vi.mock('../carta_porte_wa', () => ({ evaluarYAvisarCcpDespacho: vi.fn(async () => {}) }));
vi.mock('../briefing_inicio_wa', () => ({ enviarBriefingInicio: vi.fn(async () => {}) }));
vi.mock('../bitacora_escritura', () => ({ anotarBitacora: vi.fn(async () => {}) }));
vi.mock('@/lib/meta/enviar_con_fallback', () => ({
  enviarConFallback: vi.fn(async (telefono: string, o: { texto: string; plantilla: { nombre: string } }) => {
    wa.push({ telefono, texto: o.texto, plantilla: o.plantilla.nombre });
    if (respuestaMeta) return respuestaMeta;
    return { ok: true, via: 'texto', id: 'w', motivo: 'ventana_abierta', ventana: 'abierta' };
  }),
}));
let mundo = new Mundo();
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => mundo.admin() }));

const { crearViaje } = await import('../operacion');
const { importarArchivoDelPanel, guardarConvenioDelPanel } = await import('./acciones');
const { despacharInstrucciones, instruccionesAlCambiarOperador } = await import('./envio');
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
  respuestaMeta = null;
  clienteId = String(mundo.poner('cliente', { tenant_id: T, nombre: 'Cliente Uno' }).id);
  operadorId = String(mundo.poner('operador', { tenant_id: T, nombre: 'Juan Pérez', telefono: '5213312345678', activo: true }).id);
  unidadId = String(mundo.poner('unidad', { tenant_id: T, numero_economico: 'T-12' }).id);
  mundo.poner('geocerca', { tenant_id: T, nombre: 'Planta Zapopan', codigo: 'ZAP', activa: true, ...ORIGEN, radio_m: 300 });
  mundo.poner('geocerca', { tenant_id: T, nombre: 'CEDIS Tlaquepaque', codigo: 'CED', activa: true, ...DESTINO, radio_m: 300 });
  mundo.tablas.terminal = [];
});

describe('el ciclo completo de un convenio', () => {
  it('FALLO: Meta rechaza (plantilla sin aprobar) → el viaje se crea igual, el reclamo se queda y no se repite; si es reintentable, la siguiente corrida lo manda', async () => {
    await importarArchivoDelPanel({ tenantId: T, rol: 'flota_admin' }, { bytes: null, texto: ARCHIVO });
    // Rechazo NO reintentable (plantilla sin aprobar): crearViaje no lanza y el despacho queda reclamado sin sellar.
    respuestaMeta = { ok: false, motivo: 'plantilla_rechazada', mensaje: 'plantilla sin aprobar', fueraDeVentana: true, reintentable: false, ventana: 'cerrada' };
    const viajeId = String(await crearViaje(T, { operadorId, unidadId, clienteId, origen: 'Planta Zapopan', destino: 'CEDIS Tlaquepaque', folio: 'F-2003' }));
    mundo.tablas.viaje.find((v) => v.id === viajeId)!.aceptado_en = AHORA.toISOString();
    expect(viajeId).toBeTruthy();
    expect(wa).toHaveLength(1); // se intentó una vez
    expect(mundo.tablas.viaje_convenio[0].despacho_enviado_en ?? null).toBeNull(); // no se selló como enviado
    // Aunque el cron corra otra vez no se repite el mismo fallo (el reclamo quedó puesto).
    expect(await despacharInstrucciones(T, viajeId)).toEqual({ estado: 'perdido' });
    expect(wa).toHaveLength(1);
    // El acercamiento también falla igual, sin tumbar el barrido ni mandar de más.
    posicion(ORIGEN);
    await expect(barridoAcercamiento(undefined, AHORA)).resolves.toMatchObject({ enviados: 0 });
    expect(wa).toHaveLength(2);
    expect(await atenderPreguntaConvenio({ tenantId: T, operadorId, viajeAbiertoId: viajeId, texto: '¿Por dónde entro?' })).toContain('Entra por la puerta 1 de carga'); // la pregunta sigue respondiendo
    // Rechazo REINTENTABLE (límite de tasa) en otro viaje: libera el reclamo y la corrida siguiente lo manda.
    const otroOp = String(mundo.poner('operador', { tenant_id: T, nombre: 'Ana López', telefono: '5213398765432', activo: true }).id);
    respuestaMeta = { ok: false, motivo: 'rechazo_no_ventana', mensaje: 'límite de tasa', fueraDeVentana: false, reintentable: true, ventana: 'abierta' };
    const v2 = String(await crearViaje(T, { operadorId: otroOp, unidadId, clienteId, origen: 'Planta Zapopan', destino: 'CEDIS Tlaquepaque', folio: 'F-2004' }));
    respuestaMeta = null;
    expect(await despacharInstrucciones(T, v2)).toMatchObject({ estado: 'enviado' });
    expect(wa.at(-1)!.telefono).toBe('5213398765432');
  });

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

// ═══════════════════════════════════════════════════════════════════════════
// P7 — EDICIÓN EN PANTALLA Y EL CICLO DEL CRON, fuera de orden y con otra flota. Se ejerce el camino real: la acción del panel
// (`guardarConvenioDelPanel`), el envío con claim, el barrido de acercamiento y el tablero de hitos, sobre la base en memoria
// (con las dos funciones de la 0656/0657 espejadas; su garantía real la prueba supabase/tests/0656_convenio_guardar.sql).
// ═══════════════════════════════════════════════════════════════════════════
describe('P7 — convenio editado en pantalla y ciclo del cron', () => {
  const T2 = 'flota-2';
  const cuerpo = (n: number) => wa[n].texto;
  const convenioDe = (t: string) => mundo.tablas.cliente_convenio.find((c) => c.tenant_id === t)!;
  const entradaEditada = (c: Record<string, unknown>, o: Partial<import('./edicion').EntradaConvenio> = {}): import('./edicion').EntradaConvenio => ({
    convenioId: String(c.id), clienteId: '', nombre: 'Ruta norte', origen: 'Planta Zapopan', destino: 'CEDIS Tlaquepaque', sitioOrigenId: '', sitioDestinoId: '',
    vigenteDesde: '', vigenteHasta: '', notas: '', version: String(c.version),
    instrucciones: [
      { categoria: 'puerta', texto: 'Entra por la puerta 7 de carga', momento: 'ambos', lugar: 'origen' },
      { categoria: 'reportarse', texto: 'Con el guardia de la caseta 1', momento: 'acercamiento', lugar: 'origen' },
      { categoria: 'puerta', texto: 'Puerta 5 lado oriente', momento: 'ambos', lugar: 'destino' },
      { categoria: 'reportarse', texto: 'Con el jefe de andén Sr. Ramírez', momento: 'acercamiento', lugar: 'destino' },
      { categoria: 'documentos', texto: 'Carta porte y orden de compra', momento: 'despacho', lugar: 'ambos' },
    ],
    llevarAViajes: true, reenviar: true, ...o,
  });

  it('acercamiento ANTES del despacho: el tractor ya está en la planta pero el viaje no tiene operador ni foto → no sale nada; al asignar, sale el despacho una vez y el acercamiento una sola vez, aunque el cron corra dos veces', async () => {
    await importarArchivoDelPanel({ tenantId: T, rol: 'flota_admin' }, { bytes: null, texto: ARCHIVO });
    // viaje SIN operador (no hay a quién escribirle): no despacha ni liga nada
    const viajeId = await crearViaje(T, { unidadId, clienteId, origen: 'Planta Zapopan', destino: 'CEDIS Tlaquepaque', folio: 'F-3001' });
    mundo.tablas.viaje.find((v) => v.id === viajeId)!.aceptado_en = AHORA.toISOString();
    posicion(ORIGEN);
    expect(wa).toHaveLength(0);
    expect(mundo.tablas.viaje_convenio).toHaveLength(0);
    for (let i = 0; i < 2; i++) expect(await barridoAcercamiento(undefined, AHORA)).toMatchObject({ candidatos: 0, enviados: 0 });

    // ahora se asigna el operador (primera asignación): se liga el convenio y sale el despacho
    mundo.tablas.viaje.find((v) => v.id === viajeId)!.operador_id = operadorId;
    expect(await instruccionesAlCambiarOperador(T, String(viajeId), { cambio: true, operadorAnteriorId: null })).toMatchObject({ estado: 'enviado' });
    expect(wa).toHaveLength(1);
    expect(cuerpo(0)).toContain('instrucciones de tu viaje F-3001');
    // dos corridas del cron (at-least-once): un solo aviso de acercamiento
    const r1 = await barridoAcercamiento(undefined, AHORA);
    const r2 = await barridoAcercamiento(undefined, AHORA);
    expect([r1.enviados, r2.enviados]).toEqual([1, 0]);
    expect(wa).toHaveLength(2);
    // y reintentar el despacho (misma entrega duplicada) no manda otro
    expect(await despacharInstrucciones(T, String(viajeId))).toEqual({ estado: 'ya_enviado' });
    expect(wa).toHaveLength(2);
  });

  it('convenio CAMBIADO tras despachar: la oficina lo edita, el viaje en curso recibe la versión nueva UNA vez, el acercamiento ya avisado no se repite y el de la otra planta sale con lo nuevo', async () => {
    await importarArchivoDelPanel({ tenantId: T, rol: 'flota_admin' }, { bytes: null, texto: ARCHIVO });
    const viajeId = String(await crearViaje(T, { operadorId, unidadId, clienteId, origen: 'Planta Zapopan', destino: 'CEDIS Tlaquepaque', folio: 'F-3002' }));
    mundo.tablas.viaje.find((v) => v.id === viajeId)!.aceptado_en = AHORA.toISOString();
    posicion(ORIGEN);
    expect((await barridoAcercamiento(undefined, AHORA)).enviados).toBe(1);
    expect(wa).toHaveLength(2); // despacho + acercamiento a la planta de carga

    // La oficina corrige las dos puertas desde la pantalla, llevándolo a los viajes en curso y reenviando.
    const conv = convenioDe(T);
    const r = await guardarConvenioDelPanel({ tenantId: T, rol: 'encargado' }, entradaEditada(conv));
    expect(r).toMatchObject({ ok: true, mensaje: expect.stringMatching(/actualizaron las instrucciones de 1 viaje en curso.*mandar a 1 operador/) });
    expect(wa).toHaveLength(3);
    expect(wa[2].telefono).toBe('5213312345678');
    expect(cuerpo(2)).toContain('actualizamos las instrucciones de tu viaje F-3002');
    expect(cuerpo(2)).toContain('Al cargar: Entra por la puerta 7 de carga');
    expect(cuerpo(2)).toContain('Al descargar: Puerta 5 lado oriente');
    expect(cuerpo(2)).not.toMatch(/puerta 1|Puerta 3/);
    expect(mundo.tablas.viaje_convenio[0]).toMatchObject({ despacho_canal: 'texto' }); // el despacho volvió a sellarse al reenviar

    // Cron fuera de orden: el aviso de la planta de carga ya salió y NO se repite con la versión nueva…
    expect((await barridoAcercamiento(undefined, AHORA)).enviados).toBe(0);
    expect(wa).toHaveLength(3);
    // …carga, sale, y al acercarse a la planta de descarga el aviso trae la puerta NUEVA, una sola vez, aunque el cron corra dos veces.
    mundo.poner('viaje_hito', { tenant_id: T, viaje_id: viajeId, tipo: 'llegada_carga', estado: 'validado' });
    mundo.poner('viaje_hito', { tenant_id: T, viaje_id: viajeId, tipo: 'salida_carga', estado: 'recibido' });
    posicion(DESTINO, 0);
    expect([(await barridoAcercamiento(undefined, AHORA)).enviados, (await barridoAcercamiento(undefined, AHORA)).enviados]).toEqual([1, 0]);
    expect(wa).toHaveLength(4);
    expect(cuerpo(3)).toContain('Puerta 5 lado oriente');
    expect(cuerpo(3)).not.toMatch(/Puerta 3|puerta 7/);
    // y la pregunta del operador responde con lo vigente
    expect(await atenderPreguntaConvenio({ tenantId: T, operadorId, viajeAbiertoId: viajeId, texto: 'por donde entro' })).toBe('• Por dónde entras: Puerta 5 lado oriente');
  });

  it('RONDA 10 (alta): viaje despachado cuando el convenio NO traía instrucciones de despacho: al editar con «volver a mandar» el operador SÍ las recibe, una vez', async () => {
    // convenio creado en pantalla SIN instrucciones: el despacho sale con 'sin_instrucciones' y no sella nada
    const alta = await guardarConvenioDelPanel({ tenantId: T, rol: 'flota_admin' }, entradaEditada({ id: '', version: '' }, { convenioId: '', clienteId, instrucciones: [], llevarAViajes: false, reenviar: false }));
    expect(alta).toMatchObject({ ok: true });
    const viajeId = String(await crearViaje(T, { operadorId, unidadId, clienteId, origen: 'Planta Zapopan', destino: 'CEDIS Tlaquepaque', folio: 'F-3005' }));
    expect(wa).toHaveLength(0);
    expect(mundo.tablas.viaje_convenio.find((v) => v.viaje_id === viajeId)!.despacho_enviado_en ?? null).toBeNull();

    const conv = convenioDe(T);
    const r = await guardarConvenioDelPanel({ tenantId: T, rol: 'encargado' }, entradaEditada(conv, { instrucciones: [{ categoria: 'puerta', texto: 'Puerta 9 de carga', momento: 'despacho', lugar: 'origen' }] }));
    expect(r).toMatchObject({ ok: true, mensaje: expect.stringMatching(/mandar a 1 operador/) });
    expect(r.ok && r.mensaje).not.toMatch(/lo recibirán con las instrucciones nuevas/);
    expect(wa).toHaveLength(1);
    expect(wa[0].texto).toContain('Puerta 9 de carga');
    // idempotente: guardar otra vez lo mismo no manda otro
    const v2 = convenioDe(T);
    await guardarConvenioDelPanel({ tenantId: T, rol: 'encargado' }, entradaEditada(v2, { instrucciones: [{ categoria: 'puerta', texto: 'Puerta 9 de carga', momento: 'despacho', lugar: 'origen' }] }));
    expect(wa).toHaveLength(1);
  });

  it('editar SIN marcar «llevar a los viajes»: el viaje en curso conserva lo que se le dijo, y la versión vieja de la forma ya no guarda', async () => {
    await importarArchivoDelPanel({ tenantId: T, rol: 'flota_admin' }, { bytes: null, texto: ARCHIVO });
    const viajeId = String(await crearViaje(T, { operadorId, unidadId, clienteId, origen: 'Planta Zapopan', destino: 'CEDIS Tlaquepaque', folio: 'F-3003' }));
    const conv = convenioDe(T);
    const versionQueLeyoLaForma = conv.version;
    const r = await guardarConvenioDelPanel({ tenantId: T, rol: 'flota_admin' }, entradaEditada(conv, { llevarAViajes: false, reenviar: false }));
    expect(r).toMatchObject({ ok: true, mensaje: expect.stringContaining('conservan las instrucciones que ya se les dijeron') });
    expect(wa).toHaveLength(1); // solo el despacho original
    expect(JSON.stringify(mundo.tablas.viaje_convenio[0].instrucciones)).toContain('puerta 1 de carga');
    expect(JSON.stringify(mundo.tablas.viaje_convenio[0].instrucciones)).not.toContain('puerta 7');
    // un viaje nuevo del mismo cliente SÍ toma la versión nueva
    const otro = String(mundo.poner('operador', { tenant_id: T, nombre: 'Ana López', telefono: '5213398765432', activo: true }).id);
    await crearViaje(T, { operadorId: otro, unidadId, clienteId, origen: 'Planta Zapopan', destino: 'CEDIS Tlaquepaque', folio: 'F-3004' });
    expect(cuerpo(1)).toContain('puerta 7 de carga');
    // la forma que se abrió antes (versión vieja) choca: no se guarda nada
    const viejo = await guardarConvenioDelPanel({ tenantId: T, rol: 'flota_admin' }, { ...entradaEditada(conv, { nombre: 'Pisado' }), version: String(versionQueLeyoLaForma) });
    expect(viejo).toMatchObject({ ok: false, error: expect.stringContaining('Alguien más cambió este convenio') });
    expect(convenioDe(T).nombre).toBe('Ruta norte');
    void viajeId;
  });

  it('OTRA flota: no puede editar el convenio ajeno, y editar el de una flota no toca los viajes de otra que se llame igual', async () => {
    // flota 2: mismo nombre de cliente, de convenio y de sitios, su propio viaje ya despachado
    const cliente2 = String(mundo.poner('cliente', { tenant_id: T2, nombre: 'Cliente Uno' }).id);
    const operador2 = String(mundo.poner('operador', { tenant_id: T2, nombre: 'Luis Ruiz', telefono: '5213300001111', activo: true }).id);
    const unidad2 = String(mundo.poner('unidad', { tenant_id: T2, numero_economico: 'T-90' }).id);
    mundo.poner('geocerca', { tenant_id: T2, nombre: 'Planta Zapopan', codigo: 'ZAP', activa: true, ...ORIGEN, radio_m: 300 });
    mundo.poner('geocerca', { tenant_id: T2, nombre: 'CEDIS Tlaquepaque', codigo: 'CED', activa: true, ...DESTINO, radio_m: 300 });
    await importarArchivoDelPanel({ tenantId: T, rol: 'flota_admin' }, { bytes: null, texto: ARCHIVO });
    await importarArchivoDelPanel({ tenantId: T2, rol: 'flota_admin' }, { bytes: null, texto: ARCHIVO });
    const v1 = String(await crearViaje(T, { operadorId, unidadId, clienteId, origen: 'Planta Zapopan', destino: 'CEDIS Tlaquepaque', folio: 'F-3005' }));
    const v2 = String(await crearViaje(T2, { operadorId: operador2, unidadId: unidad2, clienteId: cliente2, origen: 'Planta Zapopan', destino: 'CEDIS Tlaquepaque', folio: 'F-4005' }));
    expect(wa).toHaveLength(2);
    const c1 = convenioDe(T); const c2 = convenioDe(T2);
    expect(c1.id).not.toBe(c2.id);

    // la flota 2 intenta editar el convenio de la flota 1 (id adivinado): no existe para ella
    const ajeno = await guardarConvenioDelPanel({ tenantId: T2, rol: 'flota_admin' }, entradaEditada(c1, { nombre: 'Robado' }));
    expect(ajeno).toMatchObject({ ok: false, error: expect.stringContaining('ya no existe') });
    expect(convenioDe(T).nombre).toBe('Ruta norte');

    // la flota 1 edita el suyo y lo lleva a sus viajes: el viaje de la flota 2 no se entera
    const r = await guardarConvenioDelPanel({ tenantId: T, rol: 'flota_admin' }, entradaEditada(c1));
    expect(r).toMatchObject({ ok: true });
    expect(wa).toHaveLength(3);
    expect(wa[2].telefono).toBe('5213312345678');
    const foto = (v: string) => JSON.stringify(mundo.tablas.viaje_convenio.find((x) => x.viaje_id === v)!.instrucciones);
    expect(foto(v1)).toContain('puerta 7');
    expect(foto(v2)).toContain('puerta 1 de carga');
    expect(foto(v2)).not.toContain('puerta 7');
    // toda llamada a las funciones de edición llevó el tenant de la sesión que la hizo
    expect(mundo.rpcLlamadas.every((l) => l.args.p_tenant === T || l.args.p_tenant === T2)).toBe(true);
    expect(mundo.rpcLlamadas.filter((l) => l.nombre === 'refrescar_viajes_de_convenio').every((l) => l.args.p_tenant === T)).toBe(true);
  });
});
