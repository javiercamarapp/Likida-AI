import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crearDbMemoria, type DbMemoria } from '../e2e/db_memoria.fixture';

// ═══════════════════════════════════════════════════════════════════════════
// HALLAZGO 3 (Orquestador) — el 6º barrido de `/api/cron/escalar`
// (`avisarHuerfanosPendientes`) solo tenía cobertura e2e CON MOCK:
// `route.test.ts` mockea `avisarHuerfanosPendientes` entero, y su propio test
// unitario (`avisar_huerfanos.test.ts`) mockea `avisar()` entero. Ninguno de
// los dos deja correr JUNTOS los módulos reales que de verdad componen el
// barrido — lo que SÍ existe para el orquestador vivo
// (`orquestador_vivo.e2e.test.ts`): módulos reales compuestos sobre una base
// en memoria.
//
// Este archivo hace lo mismo para el 6º barrido: `avisarHuerfanosPendientes`
// (lectura de `comprobante_huerfano` + unión con los incidentes de
// `agente_notificacion_estado` todavía abiertos) y `avisar()`
// (`agentes/notificaciones.ts`: anti-ruido, reparto por rol, el claim con
// `is('aceptado_en', null)`-análogo de `reclamarAviso`) corren REALES, de
// principio a fin, sobre `db_memoria.fixture` — la MISMA base en memoria que
// usan los e2e de agentes (`src/lib/likida/e2e/`). Solo se mockea la
// frontera de transporte (`enviarCorreo`) y el logger, igual que
// `orquestador_vivo.e2e.test.ts` mockea `@/lib/correo/enviar`.
//
// `db_memoria.fixture` no soportaba `.or()` (PostgREST) — lo usan
// `usuariosAvisables` y `reclamarAviso`, ambos dentro de `avisar()` — y se le
// agregó aquí (ver el método `or()` en el fixture): es la pieza que faltaba
// para poder correr `avisar()` REAL sobre esa base compartida, en vez de
// reinventar otra base falsa de un solo uso.
// ═══════════════════════════════════════════════════════════════════════════

vi.mock('@/lib/correo/enviar', () => ({
  correoConfigurado: () => true,
  enviarCorreo: (...a: unknown[]) => enviarCorreo(...a),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const enviarCorreo = vi.fn(async (..._a: unknown[]) => ({ ok: true as const, id: 'env-1' }));

let db: DbMemoria;
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => db.cliente }));

const { avisarHuerfanosPendientes } = await import('../avisar_huerfanos');

const T0 = new Date('2026-10-21T12:00:00Z');
const min = (n: number) => new Date(T0.getTime() + n * 60_000);
const diasAntes = (n: number) => new Date(T0.getTime() - n * 86_400_000).toISOString();

const A = 'flota-a';   // con aviso ENCENDIDO (`cola_atorada` en su config)
const B = 'flota-b';   // sin fila de config → default (apagado para este evento)

function nuevoMundo(huerfanos: Array<{ tenant_id: string; creado_en: string }> = []): DbMemoria {
  return crearDbMemoria({
    comprobante_huerfano: huerfanos.map((h, i) => ({
      id: `h${i}`, tenant_id: h.tenant_id, creado_en: h.creado_en, resuelto_en: null,
    })),
    agente_notificacion_config: [
      { tenant_id: A, agente: 'liquidacion', eventos: ['cola_atorada'], roles: ['flota_admin'] },
    ],
    app_user: [
      { id: 'u1', tenant_id: A, nombre: 'Dueña A', email: 'duena-a@flota.test', rol: 'flota_admin', activo: true },
      { id: 'u2', tenant_id: B, nombre: 'Dueño B', email: 'dueno-b@flota.test', rol: 'flota_admin', activo: true },
    ],
    tenant: [
      { id: A, nombre: 'Transportes A' },
      { id: B, nombre: 'Transportes B' },
    ],
    agente_notificacion_estado: [],
  });
}

beforeEach(() => {
  db = nuevoMundo();
  enviarCorreo.mockClear();
});

describe('6º barrido de cron/escalar (huérfanos): módulos reales, sin mockear avisarHuerfanosPendientes ni avisar()', () => {
  it('de principio a fin: lee comprobante_huerfano, no hay incidente previo, avisa y persiste la huella real', async () => {
    db = nuevoMundo([
      { tenant_id: A, creado_en: diasAntes(1) },
      { tenant_id: A, creado_en: diasAntes(3) },
    ]);

    const r = await avisarHuerfanosPendientes(T0);

    expect(r).toMatchObject({ conPendientes: 1, avisados: 1, fallos: 0, cortadasPorReloj: 0 });
    expect(enviarCorreo).toHaveBeenCalledTimes(1);
    expect(enviarCorreo.mock.calls[0][0]).toEqual(['duena-a@flota.test']);

    // La huella quedó REALMENTE escrita en `agente_notificacion_estado` (el
    // UPDATE condicional de `reclamarAviso`, no un doble que la simule).
    const estado = db.tablas.agente_notificacion_estado.find(
      (f) => f.tenant_id === A && f.agente === 'liquidacion' && f.evento === 'cola_atorada',
    );
    expect(estado).toMatchObject({ magnitud: 2, magnitud_avisada: 2 });
    expect(estado!.avisado_en).not.toBeNull();
  });

  it('flota sin ese evento encendido (default): se MIDE (conPendientes) pero no sale correo', async () => {
    db = nuevoMundo([{ tenant_id: B, creado_en: diasAntes(1) }]);

    const r = await avisarHuerfanosPendientes(T0);

    expect(r.conPendientes).toBe(1);
    expect(r.avisados).toBe(0);
    expect(enviarCorreo).not.toHaveBeenCalled();
  });

  it('LA UNIÓN: una flota con cero huérfanos AHORA pero con el incidente todavía abierto SÍ se evalúa y lo cierra', async () => {
    // Deja un incidente abierto de una corrida anterior (magnitud > 0) sin
    // que esta corrida traiga NINGÚN huérfano pendiente de esa flota — el
    // caso que `avisarHuerfanosPendientes` describe como "la unión de
    // 'tiene pendientes ahora' y 'tenía un incidente abierto'".
    db = nuevoMundo([]);
    db.tablas.agente_notificacion_estado.push({
      tenant_id: A, agente: 'liquidacion', evento: 'cola_atorada',
      magnitud: 3, avisado_en: diasAntes(2), magnitud_avisada: 3, actualizado_en: diasAntes(2),
    });

    const r = await avisarHuerfanosPendientes(T0);

    // La UNIÓN la trajo a evaluación aunque `porFlota` esté vacío.
    expect(r.conPendientes).toBe(0);
    expect(enviarCorreo).not.toHaveBeenCalled();  // `hayProblema: false` nunca avisa
    const estado = db.tablas.agente_notificacion_estado.find((f) => f.tenant_id === A)!;
    // `cerrarIncidente` (real, dentro de `avisar()`) re-armó el filo: la
    // magnitud vuelve a 0 y la huella del aviso anterior se conserva.
    expect(estado.magnitud).toBe(0);
    expect(estado.avisado_en).toBe(diasAntes(2));
  });

  it('el PISO real de una hora (vía `avisar()` real, no un simulacro): dos corridas con el mismo huérfano no duplican el correo', async () => {
    db = nuevoMundo([{ tenant_id: A, creado_en: T0.toISOString() }]);

    await avisarHuerfanosPendientes(T0);
    expect(enviarCorreo).toHaveBeenCalledTimes(1);

    const r2 = await avisarHuerfanosPendientes(min(15));
    expect(r2.avisados).toBe(0);
    expect(enviarCorreo).toHaveBeenCalledTimes(1);

    // Pasada la hora, sin nada nuevo que decir (misma magnitud, sin marca
    // cruzada), `avisar()` real sigue sin reenviar — mismo contrato que
    // documenta `PISO_ENTRE_AVISOS_MS`.
    const r3 = await avisarHuerfanosPendientes(min(65));
    expect(r3.avisados).toBe(0);
    expect(enviarCorreo).toHaveBeenCalledTimes(1);
  });

  it('dos flotas en la MISMA corrida: cada una recibe su propio veredicto sin contaminarse (el bucle de aviso es real)', async () => {
    db = nuevoMundo([
      { tenant_id: A, creado_en: diasAntes(1) },
      { tenant_id: B, creado_en: diasAntes(1) },
    ]);

    const r = await avisarHuerfanosPendientes(T0);

    expect(r.conPendientes).toBe(2);
    // Solo A tiene el evento encendido en su config; B se mide y se calla.
    expect(enviarCorreo).toHaveBeenCalledTimes(1);
    expect(enviarCorreo.mock.calls[0][0]).toEqual(['duena-a@flota.test']);
    const estadoB = db.tablas.agente_notificacion_estado.find((f) => f.tenant_id === B);
    // B SÍ se evaluó (su magnitud quedó escrita por `guardarMagnitud` real),
    // aunque no se le haya avisado por correo.
    expect(estadoB?.magnitud).toBe(1);
  });

  it('un fallo real de la base al evaluar una flota (`leerEstado` real que truena) no tumba a las demás ni la corrida', async () => {
    db = nuevoMundo([
      { tenant_id: A, creado_en: diasAntes(1) },
      { tenant_id: B, creado_en: diasAntes(1) },
    ]);
    // B también con el evento encendido, para que su éxito sea comparable al
    // de A (si no, B se callaría por config apagada y no por el fallo de A).
    db.tablas.agente_notificacion_config.push({ tenant_id: B, agente: 'liquidacion', eventos: ['cola_atorada'], roles: ['flota_admin'] });
    db.fallar('agente_notificacion_estado.select', 'PostgREST 503', (f) => f.some(([c, , v]) => c === 'tenant_id' && v === A));

    const r = await avisarHuerfanosPendientes(T0);

    // `avisar()` real NUNCA LANZA (es su propio contrato, ver su comentario
    // en `agentes/notificaciones.ts`): un `leerEstado` roto se atrapa DENTRO
    // de `avisar()` y vuelve como `avisado: false` — por eso `r.fallos`
    // (reservado al caso en que `avisar()` lanzara de verdad) se queda en 0.
    // Lo que SÍ prueba el aislamiento real es que A, pese al percance, no
    // bloqueó a B: B se evaluó y avisó con su propio motor, sin arrastrar el
    // error de A.
    expect(r.fallos).toBe(0);
    expect(r.avisados).toBe(1);
    expect(enviarCorreo).toHaveBeenCalledTimes(1);
    expect(enviarCorreo.mock.calls[0][0]).toEqual(['dueno-b@flota.test']);
    // Y A se quedó sin huella nueva: el intento no se contó como si hubiera
    // avisado ni dejó la base en un estado a medias.
    const estadoA = db.tablas.agente_notificacion_estado.find((f) => f.tenant_id === A);
    expect(estadoA).toBeUndefined();
  });
});
