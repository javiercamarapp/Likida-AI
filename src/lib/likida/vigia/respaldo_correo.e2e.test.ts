import { describe, it, expect, vi, beforeEach } from 'vitest';
import { atenderMensajeCliente, barridoVigia, hashTelefono } from './servicio';
import { respaldarPorCorreo, claveCorreo, TEXTO_SIN_CONFIGURAR } from './respaldo_correo';
import { escenario, RepoEnMemoria } from './repo.fixture';
import { AHORA, T1, T2, CLIENTE_A, CLIENTE_B, estatus } from './datos.fixture';
import type { DepsVigia } from './puertos';
import type { ResultadoEnvioConFallback } from '@/lib/meta/enviar_con_fallback';
import type { ResultadoEnvio } from '@/lib/correo/enviar';

// ═══════════════════════════════════════════════════════════════════════════
// E2E · RESPALDO POR CORREO DEL ESCALAMIENTO (P14, 0673/0674), con las piezas REALES del servicio (webhook → SLA → barrido →
// escalera → aviso → selector de canal → reclamo del correo → cierre → tablero) y los bordes simulados: el repo en memoria (con las
// garantías de la base: llave única, arriendo, FK compuesta) y los dos canales (WhatsApp y Resend).
//
// Criterio de cierre: feliz, fallo, duplicado, fuera de orden, otro tenant.
// ═══════════════════════════════════════════════════════════════════════════

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const FALLO_WA: ResultadoEnvioConFallback = {
  ok: false, motivo: 'ventana_cerrada_plantilla_no_aprobada_texto', mensaje: 'La plantilla no está aprobada', fueraDeVentana: true, reintentable: false, ventana: 'cerrada',
};
const WA_OK: ResultadoEnvioConFallback = { ok: true, via: 'botones', id: 'wamid.OK', motivo: 'ventana_abierta', ventana: 'abierta' };

const min = (n: number) => new Date(AHORA.getTime() + n * 60_000);
let n = 0;
const entrante = (from: string, texto: string) => { n += 1; return { from, type: 'text' as const, text: texto, waMessageId: `wamid.rc${n}`, timestampMs: AHORA.getTime() }; };

interface Armado {
  deps: DepsVigia;
  whatsapp: Array<{ telefono: string; contexto: string }>;
  correos: Array<{ para: string; asunto: string; llave?: string }>;
}

/** WhatsApp: la aprobación del borrador sale; el escalamiento sale solo para los teléfonos de `waOk`. Correo: `correo` decide el resultado. */
function armar(repo: RepoEnMemoria, o: { waOk?: string[]; correo?: () => ResultadoEnvio | Promise<ResultadoEnvio>; ahora?: Date } = {}): Armado {
  const whatsapp: Armado['whatsapp'] = [];
  const correos: Armado['correos'] = [];
  const deps: DepsVigia = {
    repo, ahora: () => o.ahora ?? AHORA,
    enviar: (async (telefono: string, op: { contexto: string }) => {
      whatsapp.push({ telefono, contexto: op.contexto });
      return op.contexto === 'vigia.escalamiento' && !(o.waOk ?? []).includes(telefono) ? FALLO_WA : WA_OK;
    }) as unknown as DepsVigia['enviar'],
    enviarCorreo: async (para, correo, op) => {
      correos.push({ para: String(para), asunto: correo.asunto, llave: op?.idempotencyKey });
      return o.correo ? o.correo() : { ok: true, id: `re_${correos.length}` };
    },
  };
  return { deps, whatsapp, correos };
}

/** Un cliente escribe y nadie le contesta: a los 35 min toca el nivel 1 (SLA 30), a los 95 el nivel 2. */
async function clienteEspera(repo: RepoEnMemoria, texto = '¿Dónde va mi viaje?') {
  repo.estatus.agregar(T1, CLIENTE_A, estatus());                              // con dato real no hay escalamiento inmediato: espera al reloj del SLA
  await atenderMensajeCliente(entrante('525511110001', texto), armar(repo).deps);
}

beforeEach(() => { n = 0; });

describe('feliz: el WhatsApp no sale y el aviso llega por correo a la lista del nivel', () => {
  it('manda a cada director por su canal, una sola vez, y lo deja a la vista', async () => {
    const { repo } = escenario({ respaldoCorreo: true });
    repo.agregarDirector(T1, 1, { nombre: 'Ana', telefono: '525577770001', correo: 'ana@flota.mx' });
    repo.agregarDirector(T1, 1, { nombre: 'Beto', correo: 'beto@flota.mx' });                       // solo correo
    repo.agregarDirector(T1, 1, { nombre: 'Carla', telefono: '525577770003', correo: 'carla@flota.mx' }); // su WhatsApp sí sale
    await clienteEspera(repo);
    const a = armar(repo, { ahora: min(35), waOk: ['525577770003'] });

    const r = await barridoVigia(a.deps);

    expect(r.escaladas).toBe(1);
    expect(a.correos.map((c) => c.para).sort()).toEqual(['ana@flota.mx', 'beto@flota.mx']);   // Carla ya recibió el WhatsApp: sin correo duplicado
    expect(a.whatsapp.filter((w) => w.contexto === 'vigia.escalamiento').map((w) => w.telefono).sort()).toEqual(['525577770001', '525577770003']);
    expect(a.correos[0].asunto).toContain('necesita atención');
    expect(a.correos.every((c) => !!c.llave)).toBe(true);                      // la llave de idempotencia viaja a Resend
    expect(repo.correos.map((c) => c.estado)).toEqual(['enviado', 'enviado']);
    expect(repo.eventosDe('correo_enviado')).toHaveLength(2);
    expect(repo.eventosDe('correo_fallo')).toHaveLength(0);
    // El mismo barrido otra vez no repite nada (sello por nivel + reclamo por persona).
    await barridoVigia(a.deps);
    expect(a.correos).toHaveLength(2);
  });

  it('un 429 de Meta (el aviso queda en la cola de reintento) NO se duplica por correo', async () => {
    const { repo } = escenario({ respaldoCorreo: true });
    repo.agregarDirector(T1, 1, { nombre: 'Ana', telefono: '525577770001', correo: 'ana@flota.mx' });
    await clienteEspera(repo);
    const a = armar(repo, { ahora: min(35) });
    a.deps.enviar = (async (_t: string, op: { contexto: string }) => (op.contexto === 'vigia.escalamiento'
      ? { ...FALLO_WA, motivo: 'rechazo_no_ventana', reintentable: true, encolado: true, fueraDeVentana: false } : WA_OK)) as unknown as DepsVigia['enviar'];
    await barridoVigia(a.deps);
    expect(a.correos).toHaveLength(0);
  });

  it('sin lista de directores se avisa como siempre (un teléfono) y el correo no entra', async () => {
    const { repo } = escenario({ respaldoCorreo: true });
    await clienteEspera(repo);
    const a = armar(repo, { ahora: min(35) });
    await barridoVigia(a.deps);
    expect(a.whatsapp.some((w) => w.telefono === '525599999999' && w.contexto === 'vigia.escalamiento')).toBe(true);
    expect(a.correos).toHaveLength(0);
  });
});

describe('fallo: nada falla en silencio', () => {
  it('sin llave de Resend queda «no se pudo mandar por correo: falta configuración», a la vista y sin repetirse', async () => {
    const { repo } = escenario({ respaldoCorreo: true });
    repo.agregarDirector(T1, 1, { nombre: 'Ana', correo: 'ana@flota.mx' });
    await clienteEspera(repo);
    const a = armar(repo, { ahora: min(35), correo: () => ({ ok: false, motivo: 'sin_configurar' }) });

    const r = await barridoVigia(a.deps);

    expect(r.fallosEnvio).toBe(1);
    expect(repo.correos[0]).toMatchObject({ estado: 'sin_configurar', detalle: TEXTO_SIN_CONFIGURAR });
    const ev = repo.eventosDe('correo_fallo');
    expect(ev).toHaveLength(1);
    expect(JSON.stringify(ev[0].detalle)).toContain('falta configuración');
    expect(JSON.stringify(repo.eventos)).not.toContain('ana@flota.mx');        // la bitácora no guarda el correo, solo su huella
    await barridoVigia(a.deps);
    expect(a.correos).toHaveLength(1);                                           // no se reintenta solo
  });

  it('con el respaldo APAGADO (por omisión) no se manda correo y el fallo de WhatsApp queda en la bitácora como siempre', async () => {
    const { repo } = escenario();                                                // respaldoCorreo = false
    repo.agregarDirector(T1, 1, { nombre: 'Ana', telefono: '525577770001', correo: 'ana@flota.mx' });
    repo.agregarDirector(T1, 1, { nombre: 'Beto', correo: 'beto@flota.mx' });
    await clienteEspera(repo);
    const a = armar(repo, { ahora: min(35) });
    const r = await barridoVigia(a.deps);
    expect(a.correos).toHaveLength(0);
    expect(repo.correos).toHaveLength(0);
    expect(r.fallosEnvio).toBe(1);
    const motivos = repo.eventosDe('fallo_envio').map((e) => (e.detalle as { motivo: string }).motivo);
    expect(motivos).toContain('ventana_cerrada_plantilla_no_aprobada_texto');
    expect(motivos).toContain('correo_apagado');                                 // el que solo tenía correo: dicho, no callado
  });

  it('Resend rechaza, o la red se cae, o el envío lanza: se cierra con su estado y el barrido sigue', async () => {
    for (const [resultado, estado] of [
      [() => ({ ok: false, motivo: 'rechazado', detalle: 'HTTP 403' }) as ResultadoEnvio, 'rechazado'],
      [() => ({ ok: false, motivo: 'red', detalle: 'timeout' }) as ResultadoEnvio, 'red'],
      [() => { throw new Error('boom'); }, 'red'],
    ] as const) {
      const { repo } = escenario({ respaldoCorreo: true });
      repo.agregarDirector(T1, 1, { nombre: 'Ana', correo: 'ana@flota.mx' });
      await clienteEspera(repo);
      const a = armar(repo, { ahora: min(35), correo: resultado as () => ResultadoEnvio });
      await expect(barridoVigia(a.deps)).resolves.toMatchObject({ fallosEnvio: 1 });
      expect(repo.correos[0].estado).toBe(estado);
      expect(repo.eventosDe('correo_fallo')).toHaveLength(1);
    }
  });

  it('si ni el reclamo se puede hacer, no se manda a ciegas (se registra y no se cae)', async () => {
    const { repo } = escenario({ respaldoCorreo: true });
    repo.agregarDirector(T1, 1, { nombre: 'Ana', correo: 'ana@flota.mx' });
    await clienteEspera(repo);
    repo.fallaEn.reclamarCorreo = true;
    const a = armar(repo, { ahora: min(35) });
    await expect(barridoVigia(a.deps)).resolves.toMatchObject({ fallosEnvio: 1 });
    expect(a.correos).toHaveLength(0);
    expect(JSON.stringify(repo.eventosDe('correo_fallo')[0].detalle)).toContain('sin_reclamo');
  });
});

describe('duplicado: dos corridas no mandan dos correos', () => {
  it('dos corridas solapadas del cron: un solo correo por persona', async () => {
    const { repo } = escenario({ respaldoCorreo: true });
    repo.agregarDirector(T1, 1, { nombre: 'Ana', correo: 'ana@flota.mx' });
    await clienteEspera(repo);
    const a = armar(repo, { ahora: min(35) });
    await Promise.all([barridoVigia(a.deps), barridoVigia(a.deps)]);
    expect(a.correos).toHaveLength(1);
  });

  it('el reclamo mismo: dos envíos simultáneos de la misma llave mandan uno; el perdedor no lo toca', async () => {
    const { repo } = escenario({ respaldoCorreo: true });
    await clienteEspera(repo);
    const conv = [...repo.conversaciones.values()][0];
    const a = armar(repo);
    const entrada = { tenantId: T1, conversacionId: conv.id, clave: claveCorreo('c:1:n1', 'ana@flota.mx'), nivel: 1 as const, directorId: null, correo: 'ana@flota.mx',
      datos: { cliente: 'Acme', motivo: 'sin_respuesta' as const, minutos: 40, nivel: 1 as const } };
    const [x, y] = await Promise.all([respaldarPorCorreo(entrada, a.deps), respaldarPorCorreo(entrada, a.deps)]);
    expect([x, y].sort()).toEqual(['duplicado', 'enviado']);
    expect(a.correos).toHaveLength(1);
  });

  it('la corrida que murió entre reclamar y cerrar: el cron retoma el arriendo vencido y manda UNA vez', async () => {
    const { repo } = escenario({ respaldoCorreo: true });
    await clienteEspera(repo);
    const conv = [...repo.conversaciones.values()][0];
    const clave = claveCorreo('c:1:n1', 'ana@flota.mx');
    // La corrida muerta: reclamó y no cerró.
    await repo.reclamarCorreo(T1, { conversacionId: conv.id, clave, nivel: 1, directorId: null, destino: 'ana@flota.mx', datos: { cliente: 'Acme', motivo: 'sin_respuesta', minutos: 40, nivel: 1 } });
    const durante = armar(repo, { ahora: min(1) });
    expect((await barridoVigia(durante.deps)).correosRetomados).toBe(0);         // el arriendo sigue vigente: no se toca
    expect(durante.correos).toHaveLength(0);
    // Pasan 10 min: el arriendo venció.
    const repoLuego = repo; repoLuego.reloj = () => min(10);
    const luego = armar(repoLuego, { ahora: min(10) });
    expect((await barridoVigia(luego.deps)).correosRetomados).toBe(1);
    expect(luego.correos).toEqual([expect.objectContaining({ para: 'ana@flota.mx', llave: clave })]);   // misma llave ante Resend
    expect(repo.correos[0]).toMatchObject({ estado: 'enviado', intentos: 2 });
    await barridoVigia(armar(repoLuego, { ahora: min(20) }).deps);
    expect(luego.correos).toHaveLength(1);
  });
});

describe('fuera de orden', () => {
  it('el barrido llega tarde y salta directo al nivel 2: avisa solo al nivel 2, y el nivel 1 no sale después', async () => {
    const { repo } = escenario({ respaldoCorreo: true });
    repo.agregarDirector(T1, 1, { nombre: 'Gerente', correo: 'gerente@flota.mx' });
    repo.agregarDirector(T1, 2, { nombre: 'Dueña', correo: 'duena@flota.mx' });
    await clienteEspera(repo);
    const tarde = armar(repo, { ahora: min(95) });
    await barridoVigia(tarde.deps);
    expect(tarde.correos.map((c) => c.para)).toEqual(['duena@flota.mx']);
    const despues = armar(repo, { ahora: min(100) });
    await barridoVigia(despues.deps);
    expect(despues.correos).toHaveLength(0);
  });

  it('un cierre con el token VIEJO (la corrida lenta que llega después de que otra retomó) no pisa el resultado', async () => {
    const { repo } = escenario({ respaldoCorreo: true });
    await clienteEspera(repo);
    const conv = [...repo.conversaciones.values()][0];
    const datos = { cliente: 'Acme', motivo: 'sin_respuesta' as const, minutos: 40, nivel: 1 as const };
    const lenta = await repo.reclamarCorreo(T1, { conversacionId: conv.id, clave: 'k', nivel: 1, directorId: null, destino: 'ana@flota.mx', datos });
    repo.reloj = () => min(10);
    const rapida = await repo.reclamarCorreo(T1, { conversacionId: conv.id, clave: 'k', nivel: 1, directorId: null, destino: 'ana@flota.mx', datos });
    expect(lenta && rapida && rapida.token !== lenta.token).toBe(true);
    expect(await repo.cerrarCorreo(T1, rapida!.id, rapida!.token, 'enviado', null)).toBe(true);
    expect(await repo.cerrarCorreo(T1, lenta!.id, lenta!.token, 'red', 'tarde')).toBe(false);
    expect(repo.correos[0]).toMatchObject({ estado: 'enviado', detalle: null });
  });
});

describe('otro tenant', () => {
  it('los directores de la flota B no reciben el aviso de la flota A, ni A los de B', async () => {
    const { repo } = escenario({ respaldoCorreo: true });
    repo.agregarDirector(T1, 1, { nombre: 'De A', correo: 'a@flota-a.mx' });
    repo.agregarDirector(T2, 1, { nombre: 'De B', correo: 'b@flota-b.mx' });
    await clienteEspera(repo);
    const a = armar(repo, { ahora: min(35) });
    await barridoVigia(a.deps);
    expect(a.correos.map((c) => c.para)).toEqual(['a@flota-a.mx']);
    expect(repo.correos.every((c) => c.tenantId === T1)).toBe(true);
  });

  it('un reclamo con la conversación de OTRA flota no entra (FK compuesta) y no se manda nada', async () => {
    const { repo } = escenario({ respaldoCorreo: true });
    repo.habilitar(T2, { respaldoCorreo: true });
    const ajeno = repo.agregarContacto({ tenantId: T2, clienteId: CLIENTE_B, telefono: '525511110002' });
    await atenderMensajeCliente(entrante('525511110002', '¿Y mi carga?'), armar(repo).deps);
    const convB = [...repo.conversaciones.values()].find((c) => c.contactoId === ajeno.id)!;
    const a = armar(repo);
    const r = await respaldarPorCorreo({
      tenantId: T1, conversacionId: convB.id, clave: 'k-ajena', nivel: 1, directorId: null, correo: 'x@flota-a.mx',
      datos: { cliente: 'X', motivo: 'sin_respuesta', minutos: 40, nivel: 1 },
    }, a.deps);
    expect(r).toBe('sin_reclamo');
    expect(a.correos).toHaveLength(0);
    expect(repo.correos).toHaveLength(0);
    expect(CLIENTE_A).not.toBe(CLIENTE_B);
  });
});

describe('ronda 17 · M1: el gerente solo con correo y el respaldo apagado no deja el nivel 1 sin aviso', () => {
  it('con el respaldo APAGADO el aviso cae al destino de siempre (jefe de flota) y el gerente sin teléfono queda a la vista', async () => {
    const { repo } = escenario();                                                // respaldoCorreo = false; el jefe de flota tiene teléfono
    repo.destinatariosNivel = async () => [{ userId: 'u-ger', directorId: null, nombre: null, telefono: null, correo: 'ger@flota.mx' }];
    await clienteEspera(repo);
    const a = armar(repo, { ahora: min(35), waOk: ['525599999999'] });
    const r = await barridoVigia(a.deps);
    expect(a.whatsapp.some((w) => w.telefono === '525599999999' && w.contexto === 'vigia.escalamiento')).toBe(true);
    expect(r.escaladas).toBe(1);
    expect(a.correos).toHaveLength(0);
    const motivos = repo.eventosDe('fallo_envio').map((e) => (e.detalle as { motivo: string }).motivo);
    expect(motivos).toContain('correo_apagado');
  });

  it('con el respaldo ENCENDIDO el gerente solo con correo sí cuenta y el jefe no se consulta', async () => {
    const { repo } = escenario({ respaldoCorreo: true });
    repo.destinatariosNivel = async () => [{ userId: 'u-ger', directorId: null, nombre: null, telefono: null, correo: 'ger@flota.mx' }];
    await clienteEspera(repo);
    const a = armar(repo, { ahora: min(35) });
    await barridoVigia(a.deps);
    expect(a.correos.map((c) => c.para)).toEqual(['ger@flota.mx']);
    expect(a.whatsapp.some((w) => w.telefono === '525599999999' && w.contexto === 'vigia.escalamiento')).toBe(false);
  });
});

describe('ronda 17 · el fallo de un destinatario no corta a los demás', () => {
  it('si la base falla al reclamar a Ana, Beto y Carla igual reciben su aviso', async () => {
    const { repo } = escenario({ respaldoCorreo: true });
    repo.agregarDirector(T1, 1, { nombre: 'Ana', telefono: '525577770001' });
    repo.agregarDirector(T1, 1, { nombre: 'Beto', telefono: '525577770002' });
    repo.agregarDirector(T1, 1, { nombre: 'Carla', telefono: '525577770003' });
    await clienteEspera(repo);
    const huellaAna = hashTelefono('525577770001').slice(0, 16);
    const evento = repo.evento.bind(repo);
    repo.evento = (async (t: string, e: Parameters<typeof evento>[1]) => {
      if (e.clave?.includes(`:d:${huellaAna}`)) throw new Error('base caída');
      return evento(t, e);
    }) as typeof repo.evento;
    const a = armar(repo, { ahora: min(35), waOk: ['525577770002', '525577770003'] });
    await barridoVigia(a.deps);
    const enviados = a.whatsapp.filter((w) => w.contexto === 'vigia.escalamiento').map((w) => w.telefono).sort();
    expect(enviados).toEqual(['525577770002', '525577770003']);
  });

  it('si la pasada murió entre el sello y la lista, la reentrada retoma a todos sin repetir a los ya reclamados', async () => {
    const { repo } = escenario({ respaldoCorreo: true });
    repo.agregarDirector(T1, 1, { nombre: 'Ana', telefono: '525577770001' });
    repo.agregarDirector(T1, 1, { nombre: 'Beto', telefono: '525577770002' });
    await clienteEspera(repo);
    const actualizar = repo.actualizarConversacion.bind(repo);
    repo.actualizarConversacion = (async (...args: Parameters<typeof actualizar>) => {
      if ('escalamientoNivel' in args[2]) throw new Error('murió tras el sello');   // solo la subida de nivel: el sello ya quedó escrito
      return actualizar(...args);
    }) as typeof repo.actualizarConversacion;
    const a = armar(repo, { ahora: min(35), waOk: ['525577770001', '525577770002'] });
    await barridoVigia(a.deps).catch(() => undefined);
    expect(a.whatsapp.filter((w) => w.contexto === 'vigia.escalamiento')).toHaveLength(0);
    expect(repo.eventosDe('escalada').filter((e) => e.clave && !e.clave.includes(':d:'))).toHaveLength(1);   // el sello sí quedó
    repo.actualizarConversacion = actualizar;
    await barridoVigia(a.deps);
    expect(a.whatsapp.filter((w) => w.contexto === 'vigia.escalamiento').map((w) => w.telefono).sort()).toEqual(['525577770001', '525577770002']);
    await barridoVigia(a.deps);
    expect(a.whatsapp.filter((w) => w.contexto === 'vigia.escalamiento')).toHaveLength(2);
  });
});
