import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crearDbMemoria, type DbMemoria, type Fila } from './db_memoria.fixture';

// ═══════════════════════════════════════════════════════════════════════════
// E2E AGENTE 12 — JORNADA: la alerta saliente de tope (cinco casos del criterio g).
//
// Cadena REAL: guardarConfigAlerta (lo que llama la pantalla) → puertosAlertaReales (lecturas y escrituras a la base con su
// filtro de tenant) → correrAlertasTope → armado del aviso → selector de envío real (`enviarConFallback`: texto si la
// ventana de 24 h está abierta, plantilla del catálogo si no) → claim y cierre por (jornada, nivel) → alertasDeJornadas
// (lo que la pantalla enseña). DOBLES: la base en memoria (con las cuatro RPC de la 0502 replicadas a mano: lo que
// demuestra Postgres es `supabase/tests/0502_*.sql`), Meta, el correo y los contactos de escalamiento. Sintético.
// ═══════════════════════════════════════════════════════════════════════════

let db: DbMemoria;
const AHORA = new Date('2026-10-02T18:00:00.000Z'); // 12:00 en México
const hoyMx = (d: Date) => new Date(d.getTime() - 6 * 3_600_000).toISOString().slice(0, 10);

// ── Las RPC de la 0502 en memoria (misma semántica que el SQL) ──────────────
const rango = (n: string) => (n === 'aviso' ? 1 : n === 'critico' ? 2 : 3);
let seq = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
const vivos = (jornada: Fila, tipo: string) => (db.tablas.jornada_asiento ?? [])
  .filter((a) => a.jornada_id === jornada.id && a.tenant_id === jornada.tenant_id && a.tipo === tipo && a.anulado_en === null);

const rpcs = {
  jornadas_en_curso_para_alerta: (a: Record<string, unknown>): Fila[] => {
    const hoy = hoyMx(new Date(String(a.p_ahora)));
    const ayer = new Date(Date.parse(`${hoy}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    const filas: Fila[] = [];
    for (const c of db.tablas.jornada_alerta_config ?? []) {
      if (c.activa !== true) continue;
      for (const d of db.tablas.jornada_dia ?? []) {
        if (d.tenant_id !== c.tenant_id || d.estado !== 'abierto' || String(d.dia) < ayer) continue;
        if (vivos(d, 'inicio_jornada').length === 0 || vivos(d, 'fin_jornada').length > 0) continue;
        filas.push({
          tenant_id: c.tenant_id, jornada_id: d.id, operador_id: d.operador_id, dia: d.dia, tope_horas: c.tope_horas,
          umbral_aviso_pct: c.umbral_aviso_pct, umbral_critico_pct: c.umbral_critico_pct, canal_encargado: c.canal_encargado,
          canal_operador: c.canal_operador, correo_encargado: c.correo_encargado,
        });
      }
    }
    return filas.sort((x, y) => String(x.tenant_id).localeCompare(String(y.tenant_id)) || String(x.jornada_id).localeCompare(String(y.jornada_id))).slice(0, Number(a.p_limite ?? 500));
  },
  reclamar_jornada_alerta: (a: Record<string, unknown>): Fila[] => {
    const tabla = (db.tablas.jornada_alerta ??= []);
    const ahora = Date.parse(String(a.p_ahora));
    const nivel = String(a.p_nivel);
    const hay = tabla.some((x) => x.jornada_id === a.p_jornada && x.tenant_id === a.p_tenant && rango(String(x.nivel)) >= rango(nivel)
      && (x.estado !== 'reclamada' || Date.parse(String(x.claim_expira_en)) > ahora)
      && !(x.nivel === nivel && x.estado === 'reclamada' && Date.parse(String(x.claim_expira_en)) <= ahora));
    if (hay) return [];
    const expira = new Date(ahora + 300_000).toISOString();
    const previa = tabla.find((x) => x.jornada_id === a.p_jornada && x.nivel === nivel);
    const datos = { minutos_registrados: a.p_minutos, tope_minutos: a.p_tope, cota_inferior: a.p_cota, fuente: a.p_fuente, descanso_sin_cierre: a.p_descanso_abierto };
    if (previa) {
      if (!(previa.estado === 'reclamada' && Date.parse(String(previa.claim_expira_en)) <= ahora && previa.tenant_id === a.p_tenant)) return [];
      Object.assign(previa, datos, { claim_token: uuid(), claim_expira_en: expira });
      return [{ alerta_id: previa.id, claim_token: previa.claim_token }];
    }
    const fila: Fila = {
      id: uuid(), tenant_id: a.p_tenant, jornada_id: a.p_jornada, nivel, ...datos, estado: 'reclamada',
      encargado_estado: 'pendiente', operador_estado: 'pendiente', claim_token: uuid(), claim_expira_en: expira, creada_en: a.p_ahora, cerrada_en: null,
    };
    tabla.push(fila);
    return [{ alerta_id: fila.id, claim_token: fila.claim_token }];
  },
  cerrar_jornada_alerta: (a: Record<string, unknown>): boolean => {
    const f = (db.tablas.jornada_alerta ?? []).find((x) => x.id === a.p_id && x.tenant_id === a.p_tenant && x.claim_token === a.p_claim && x.estado === 'reclamada');
    if (!f) return false;
    Object.assign(f, {
      estado: a.p_estado, claim_token: null, claim_expira_en: null, cerrada_en: a.p_ahora,
      encargado_canal: a.p_enc_canal, encargado_estado: a.p_enc_estado, encargado_motivo: a.p_enc_motivo,
      operador_canal: a.p_op_canal, operador_estado: a.p_op_estado, operador_motivo: a.p_op_motivo,
    });
    return true;
  },
  liberar_jornada_alerta: (a: Record<string, unknown>): boolean => {
    const t = (db.tablas.jornada_alerta ??= []);
    const f = t.find((x) => x.id === a.p_id && x.tenant_id === a.p_tenant && x.claim_token === a.p_claim && x.estado === 'reclamada');
    if (!f) return false;
    db.tablas.jornada_alerta = t.filter((x) => x !== f);
    return true;
  },
};

const jefes: Record<string, Array<{ nombre: string; telefono: string }>> = {};
const correos: Array<{ para: string; asunto: string }> = [];
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => db.cliente }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../conductor/escalamiento', () => ({ destinatariosEscalacion: async (t: string) => jefes[t] ?? [] }));
vi.mock('@/lib/correo/enviar', () => ({
  enviarCorreo: async (para: string, c: { asunto: string }) => { correos.push({ para, asunto: c.asunto }); return { ok: true as const }; },
}));
vi.mock('@/lib/meta/client', async (original) => {
  const real = await original<Record<string, unknown>>();
  const { meta } = await import('../conductor/meta.fixture');
  return {
    ...real,
    enviarTexto: (...a: Parameters<typeof meta.enviarTexto>) => meta.enviarTexto(...a),
    enviarBotones: (...a: Parameters<typeof meta.enviarBotones>) => meta.enviarBotones(...a),
    sendTemplate: (...a: Parameters<typeof meta.sendTemplate>) => meta.sendTemplate(...a),
  };
});
vi.mock('../wa_ventana', async (original) => {
  const real = await original<typeof import('../wa_ventana')>();
  const { meta } = await import('../conductor/meta.fixture');
  return {
    ...real,
    ventanaDeContacto: async (tel: string, ahora: Date = new Date()) => real.estadoDeVentana(meta.ultimoEntrante.get(real.normalizarTelefonoWa(tel)) ?? null, ahora),
    registrarDecisionEnvio: async () => {},
  };
});

const { correrAlertasTope } = await import('../jornada/alerta_tope');
const { puertosAlertaReales, guardarConfigAlerta, alertasDeJornadas } = await import('../jornada/alerta_tope_datos');
const { meta } = await import('../conductor/meta.fixture');
const { PLANTILLA } = await import('@/lib/meta/plantillas_catalogo');

const A = 'tenant-a'; const B = 'tenant-b';
const TEL_OP_A = '5219990000001'; const TEL_JEFE_A = '5219990000002';
const TEL_OP_B = '5219990000011'; const TEL_JEFE_B = '5219990000012';
const ACTOR = { id: 'user-1', email: 'dueno@ejemplo.invalid' };
const CONFIG_ENCENDIDA = { activa: true, topeHoras: null, umbralAvisoPct: 80, umbralCriticoPct: 95, canalEncargado: 'whatsapp', canalOperador: 'whatsapp', correoEncargado: null };

const hace = (min: number) => new Date(AHORA.getTime() - min * 60_000).toISOString();
let nAsiento = 0;
function asiento(jornadaId: string, tenant: string, tipo: string, momento: string, procedencia = 'declarado_operador'): Fila {
  return {
    id: `as-${++nAsiento}`, tenant_id: tenant, jornada_id: jornadaId, tipo, momento, procedencia, origen_ref: null, wa_message_id: null, viaje_id: null,
    registrado_por_email: null, nota: null, corrige_a: null, anulado_en: null, anulado_por_email: null, anulado_motivo: null,
  };
}
/** Una jornada abierta de hoy con su inicio hace `minutos` min. */
function jornadaEnCurso(tenant: string, id: string, operadorId: string, minutos: number | null, procedencia = 'declarado_operador') {
  db.tablas.jornada_dia.push({ id, tenant_id: tenant, operador_id: operadorId, dia: hoyMx(AHORA), estado: 'abierto' });
  if (minutos !== null) db.tablas.jornada_asiento.push(asiento(id, tenant, 'inicio_jornada', hace(minutos), procedencia));
}
const corrida = () => correrAlertasTope(puertosAlertaReales, { ahora: AHORA });
const salientesA = () => meta.salientes.filter((s) => [TEL_OP_A, TEL_JEFE_A].includes(s.a));
const alertas = () => db.tablas.jornada_alerta;

beforeEach(() => {
  seq = 0; nAsiento = 0; correos.length = 0;
  for (const k of Object.keys(jefes)) delete jefes[k];
  jefes[A] = [{ nombre: 'Jefe A', telefono: TEL_JEFE_A }];
  jefes[B] = [{ nombre: 'Jefe B', telefono: TEL_JEFE_B }];
  db = crearDbMemoria({
    jornada_alerta_config: [], jornada_alerta: [], jornada_dia: [], jornada_asiento: [], jornada_politica: [],
    operador: [
      { id: 'op-a', tenant_id: A, nombre: 'Luis Norte', telefono: TEL_OP_A, terminal_id: null, activo: true },
      { id: 'op-b', tenant_id: B, nombre: 'Mario Sur', telefono: TEL_OP_B, terminal_id: null, activo: true },
    ],
  }, rpcs);
  meta.reiniciar(); meta.estado.reloj = AHORA;
  // La ventana de 24 h del jefe está abierta (escribió hace una hora); la del operador, no.
  meta.entrante(TEL_JEFE_A, new Date(AHORA.getTime() - 3_600_000));
  meta.entrante(TEL_JEFE_B, new Date(AHORA.getTime() - 3_600_000));
});

describe('Agente 12 — Jornada: alerta de tope — FELIZ', () => {
  it('apagada por omisión no avisa a nadie; el dueño la enciende (guardarConfigAlerta) y el cron avisa al jefe por texto y al operador por plantilla del catálogo', async () => {
    jornadaEnCurso(A, 'j-a', 'op-a', 660); // 11 h = 91.7 % del tope de 12 h
    // Sin fila de configuración: la flota no la ha encendido. Ni siquiera es candidata.
    const r0 = await corrida();
    expect(r0.revisadas).toBe(0);
    expect(meta.salientes).toHaveLength(0);

    expect(await guardarConfigAlerta(A, CONFIG_ENCENDIDA, ACTOR)).toBeNull();
    expect(db.tablas.jornada_alerta_config[0]).toMatchObject({ tenant_id: A, activa: true, declarada_por_email: ACTOR.email });

    const r = await corrida();
    expect(r).toMatchObject({ revisadas: 1, enCurso: 1, alertas: { aviso: 1, critico: 0, exceso: 0 }, fallos: [] });
    const jefe = meta.salientes.find((s) => s.a === TEL_JEFE_A)!;
    expect(jefe.tipo).toBe('texto');
    expect(jefe.cuerpo).toContain('Luis Norte');
    expect(jefe.cuerpo).toContain('11 h');
    expect(jefe.cuerpo).toContain('no un dictamen');
    // El operador no tiene ventana abierta: sale la plantilla aprobada del catálogo, no un texto que Meta rechazaría.
    const op = meta.salientes.find((s) => s.a === TEL_OP_A)!;
    expect(op.tipo).toBe('plantilla');
    expect(op.plantilla).toBe(PLANTILLA.jornadaAvisoOperador);
    expect(alertas()).toHaveLength(1);
    expect(alertas()[0]).toMatchObject({ nivel: 'aviso', estado: 'enviada', encargado_estado: 'enviado', operador_estado: 'enviado', cota_inferior: false, claim_token: null });

    // Lo que la pantalla de jornada lee es esa misma fila, con su estado por destinatario.
    expect(await alertasDeJornadas(A, ['j-a'])).toEqual([expect.objectContaining({
      jornadaId: 'j-a', nivel: 'aviso', minutos: 660, topeMin: 720, estado: 'enviada', encargadoEstado: 'enviado', operadorEstado: 'enviado',
    })]);
  });

  it('el canal «ambos» manda también el correo al encargado', async () => {
    jornadaEnCurso(A, 'j-a', 'op-a', 660);
    await guardarConfigAlerta(A, { ...CONFIG_ENCENDIDA, canalEncargado: 'ambos', correoEncargado: 'jefe@flota.invalid' }, ACTOR);
    await corrida();
    expect(correos).toEqual([expect.objectContaining({ para: 'jefe@flota.invalid', asunto: expect.stringContaining('Luis Norte') })]);
    expect(alertas()[0]).toMatchObject({ encargado_canal: 'ambos', encargado_estado: 'enviado' });
  });

  it('una jornada que ya rebasó el tope avisa EXCESO (y solo ese nivel, no los tres)', async () => {
    jornadaEnCurso(A, 'j-a', 'op-a', 730);
    await guardarConfigAlerta(A, CONFIG_ENCENDIDA, ACTOR);
    const r = await corrida();
    expect(r.alertas).toEqual({ aviso: 0, critico: 0, exceso: 1 });
    expect(alertas().map((a) => a.nivel)).toEqual(['exceso']);
    expect(meta.salientes.find((s) => s.a === TEL_JEFE_A)!.cuerpo).toContain('ya rebasó el tope');
  });
});

describe('Agente 12 — Jornada: alerta de tope — FALLO', () => {
  beforeEach(async () => { await guardarConfigAlerta(A, CONFIG_ENCENDIDA, ACTOR); });

  it('sin marcas ni GPS no se afirma nada: no hay aviso ni fila («nunca certifica que cumple»)', async () => {
    jornadaEnCurso(A, 'j-a', 'op-a', null); // jornada abierta sin un solo inicio
    const r = await corrida();
    // La consulta de «en curso» exige un inicio vivo: ni siquiera es candidata, y menos se estima cuándo empezó.
    expect(r).toMatchObject({ revisadas: 0, alertas: { aviso: 0, critico: 0, exceso: 0 } });
    expect(meta.salientes).toHaveLength(0);
    expect(alertas()).toHaveLength(0);
  });

  it('bajo el primer umbral no avisa ni reclama', async () => {
    jornadaEnCurso(A, 'j-a', 'op-a', 300);
    const r = await corrida();
    expect(r).toMatchObject({ bajoUmbral: 1 });
    expect(meta.salientes).toHaveLength(0);
    expect(alertas()).toHaveLength(0);
  });

  it('un inicio del GPS es cota inferior: el aviso dice «al menos» y nombra la fuente', async () => {
    jornadaEnCurso(A, 'j-a', 'op-a', 660, 'gps');
    await corrida();
    expect(meta.salientes.find((s) => s.a === TEL_JEFE_A)!.cuerpo).toContain('11 h (al menos)');
    expect(meta.salientes.find((s) => s.a === TEL_JEFE_A)!.cuerpo).toContain('esa o más larga');
    expect(alertas()[0]).toMatchObject({ cota_inferior: true, fuente: 'gps' });
  });

  it('una jornada abierta de más de 24 h es un cierre que nadie marcó, no un exceso: se cuenta aparte y no se avisa', async () => {
    jornadaEnCurso(A, 'j-a', 'op-a', 1700);
    const r = await corrida();
    expect(r.sinCierreProbable).toBe(1);
    expect(meta.salientes).toHaveLength(0);
  });

  it('plantilla sin aprobar con la ventana cerrada: el aviso al operador queda «fallido» con su motivo en el expediente, nunca «enviado»', async () => {
    jornadaEnCurso(A, 'j-a', 'op-a', 660);
    meta.estado.aprobadas = new Set(); // Meta no tiene aprobada ninguna plantilla
    const r = await corrida();
    expect(meta.salientes.some((s) => s.a === TEL_OP_A)).toBe(false);
    expect(meta.salientes.some((s) => s.a === TEL_JEFE_A && s.tipo === 'texto')).toBe(true); // el jefe sí (ventana abierta)
    expect(alertas()[0]).toMatchObject({ estado: 'parcial', encargado_estado: 'enviado', operador_estado: 'fallido' });
    expect(String(alertas()[0].operador_motivo).length).toBeGreaterThan(0);
    expect(r.alertas.aviso).toBe(1);
    // Y la pantalla lo ve con ese estado: no se pinta como entregado.
    expect((await alertasDeJornadas(A, ['j-a']))[0]).toMatchObject({ estado: 'parcial', operadorEstado: 'fallido' });
  });

  it('un rechazo REINTENTABLE (429) suelta el nivel: no se consume y la siguiente corrida lo avisa', async () => {
    jornadaEnCurso(A, 'j-a', 'op-a', 660);
    await guardarConfigAlerta(A, { ...CONFIG_ENCENDIDA, canalOperador: 'ninguno' }, ACTOR);
    meta.estado.bloqueados.add(meta.norm(TEL_JEFE_A));
    const r1 = await corrida();
    expect(r1.rechazosReintentables).toBe(1);
    expect(alertas()).toHaveLength(0); // el claim se soltó
    meta.estado.bloqueados.clear();
    const r2 = await corrida();
    expect(r2.alertas.aviso).toBe(1);
    expect(alertas()[0]).toMatchObject({ estado: 'enviada', encargado_estado: 'enviado' });
  });

  it('sin a quién avisar se asienta «sin_destinatario» y se dice en la corrida', async () => {
    jornadaEnCurso(A, 'j-a', 'op-a', 660);
    jefes[A] = [];
    db.tablas.operador[0].telefono = null;
    const r = await corrida();
    expect(r.sinDestinatario).toBe(1);
    expect(alertas()[0]).toMatchObject({ estado: 'sin_destinatario' });
  });

  it('si la base no contesta la lista de candidatas la corrida LANZA (el cron pinta fallo, no «nada que avisar»)', async () => {
    db.fallar('rpc:jornadas_en_curso_para_alerta', 'caída');
    await expect(corrida()).rejects.toThrow(/jornada\.alerta\.candidatas/);
  });
});

describe('Agente 12 — Jornada: alerta de tope — DUPLICADO', () => {
  beforeEach(async () => { await guardarConfigAlerta(A, CONFIG_ENCENDIDA, ACTOR); });

  it('el cron cada 15 min no repite la alerta del mismo nivel en la misma jornada', async () => {
    jornadaEnCurso(A, 'j-a', 'op-a', 660);
    await corrida();
    const enviados = meta.salientes.length;
    const r2 = await corrida();
    const r3 = await corrida();
    expect(r2.yaAvisadas).toBe(1);
    expect(r3.yaAvisadas).toBe(1);
    expect(meta.salientes).toHaveLength(enviados);
    expect(alertas()).toHaveLength(1);
  });

  it('dos corridas SOLAPADAS (dos instancias del cron) avisan una sola vez: gana quien reclama primero', async () => {
    jornadaEnCurso(A, 'j-a', 'op-a', 660);
    const [r1, r2] = await Promise.all([corrida(), corrida()]);
    expect(r1.alertas.aviso + r2.alertas.aviso).toBe(1);
    expect(salientesA().filter((s) => s.a === TEL_JEFE_A)).toHaveLength(1);
    expect(salientesA().filter((s) => s.a === TEL_OP_A)).toHaveLength(1);
    expect(alertas()).toHaveLength(1);
  });

  it('al subir de nivel avisa el nuevo una vez; volver a un nivel menor ya avisado no reenvía', async () => {
    jornadaEnCurso(A, 'j-a', 'op-a', 660); // aviso
    await corrida();
    // Pasan 30 min: 690 min = 95.8 % → crítico.
    db.tablas.jornada_asiento[0].momento = hace(690);
    const r = await corrida();
    expect(r.alertas).toEqual({ aviso: 0, critico: 1, exceso: 0 });
    expect(alertas().map((a) => a.nivel).sort()).toEqual(['aviso', 'critico']);
    const total = meta.salientes.length;
    await corrida();
    expect(meta.salientes).toHaveLength(total);
  });

  it('si la primera vez que se mira ya va al crítico, avisa ESE nivel y no manda el aviso atrasado', async () => {
    jornadaEnCurso(A, 'j-a', 'op-a', 690);
    await corrida();
    expect(alertas().map((a) => a.nivel)).toEqual(['critico']);
  });

  it('un claim con arriendo vencido (corrida que murió a medias) se retoma una sola vez', async () => {
    jornadaEnCurso(A, 'j-a', 'op-a', 660);
    alertas().push({
      id: 'zombie', tenant_id: A, jornada_id: 'j-a', nivel: 'aviso', minutos_registrados: 600, tope_minutos: 720, cota_inferior: false, fuente: 'declarado_operador',
      descanso_sin_cierre: false, estado: 'reclamada', encargado_estado: 'pendiente', operador_estado: 'pendiente', claim_token: 'viejo',
      claim_expira_en: new Date(AHORA.getTime() - 60_000).toISOString(), creada_en: hace(20), cerrada_en: null,
    });
    const r = await corrida();
    expect(r.alertas.aviso).toBe(1);
    expect(alertas()).toHaveLength(1);
    expect(alertas()[0]).toMatchObject({ id: 'zombie', estado: 'enviada', minutos_registrados: 660 });
  });
});

describe('Agente 12 — Jornada: alerta de tope — FUERA DE ORDEN', () => {
  beforeEach(async () => { await guardarConfigAlerta(A, CONFIG_ENCENDIDA, ACTOR); });

  it('un descanso CERRADO que llega tarde (antes de la corrida) baja las horas netas y NO avisa de más', async () => {
    jornadaEnCurso(A, 'j-a', 'op-a', 660); // 11 h brutas → aviso
    // Llega tarde la marca de un descanso de 2 h ocurrido hace 6 h: netas 9 h = 75 % (< 80 %).
    db.tablas.jornada_asiento.push(
      asiento('j-a', A, 'inicio_descanso', hace(360)),
      asiento('j-a', A, 'fin_descanso', hace(240)),
    );
    const r = await corrida();
    expect(r).toMatchObject({ enCurso: 1, bajoUmbral: 1, alertas: { aviso: 0, critico: 0, exceso: 0 } });
    expect(meta.salientes).toHaveLength(0);
    expect(alertas()).toHaveLength(0);
  });

  it('un descanso SIN CIERRE no se descuenta ni se estima: el aviso sale y lo dice', async () => {
    jornadaEnCurso(A, 'j-a', 'op-a', 660);
    db.tablas.jornada_asiento.push(asiento('j-a', A, 'inicio_descanso', hace(120)));
    await corrida();
    expect(alertas()[0]).toMatchObject({ nivel: 'aviso', minutos_registrados: 660, descanso_sin_cierre: true });
    expect(meta.salientes.find((s) => s.a === TEL_JEFE_A)!.cuerpo).toContain('descanso sin cierre');
  });

  it('una marca de descanso que llega DESPUÉS de avisar no reenvía ni borra lo ya avisado', async () => {
    jornadaEnCurso(A, 'j-a', 'op-a', 660);
    await corrida();
    const total = meta.salientes.length;
    db.tablas.jornada_asiento.push(asiento('j-a', A, 'inicio_descanso', hace(360)), asiento('j-a', A, 'fin_descanso', hace(240)));
    const r = await corrida();
    expect(meta.salientes).toHaveLength(total);
    expect(r.alertas.aviso).toBe(0);
    expect(alertas()).toHaveLength(1);
  });

  it('el fin de jornada que llega tarde saca a la jornada de las «en curso»: ya no se evalúa', async () => {
    jornadaEnCurso(A, 'j-a', 'op-a', 660);
    db.tablas.jornada_asiento.push(asiento('j-a', A, 'fin_jornada', hace(30)));
    const r = await corrida();
    expect(r.revisadas).toBe(0);
    expect(meta.salientes).toHaveLength(0);
  });

  it('una marca ANULADA no cuenta: si el inicio vivo se anula, no hay inicio y no hay aviso', async () => {
    jornadaEnCurso(A, 'j-a', 'op-a', 660);
    db.tablas.jornada_asiento[0].anulado_en = hace(5);
    const r = await corrida();
    expect(r.revisadas).toBe(0);
    expect(meta.salientes).toHaveLength(0);
  });
});

describe('Agente 12 — Jornada: alerta de tope — OTRO TENANT', () => {
  it('cada flota usa SU tope y SUS destinatarios; el aviso de A jamás llega al jefe ni al operador de B', async () => {
    await guardarConfigAlerta(A, CONFIG_ENCENDIDA, ACTOR);
    await guardarConfigAlerta(B, { ...CONFIG_ENCENDIDA, topeHoras: 8 }, ACTOR); // tope propio, más estricto
    jornadaEnCurso(A, 'j-a', 'op-a', 420); // 7 h: 58 % de 12 h → nada en A
    jornadaEnCurso(B, 'j-b', 'op-b', 420); // 7 h: 87.5 % de 8 h → aviso en B
    const r = await corrida();
    expect(r).toMatchObject({ revisadas: 2, bajoUmbral: 1, alertas: { aviso: 1, critico: 0, exceso: 0 } });
    expect(salientesA()).toHaveLength(0);
    expect(meta.salientes.map((s) => s.a).sort()).toEqual([TEL_JEFE_B, TEL_OP_B].sort());
    expect(alertas()).toHaveLength(1);
    expect(alertas()[0]).toMatchObject({ tenant_id: B, jornada_id: 'j-b', tope_minutos: 480 });
  });

  it('una flota con la alerta apagada no recibe nada aunque la otra esté encendida', async () => {
    await guardarConfigAlerta(A, CONFIG_ENCENDIDA, ACTOR);
    await guardarConfigAlerta(B, { ...CONFIG_ENCENDIDA, activa: false }, ACTOR);
    jornadaEnCurso(A, 'j-a', 'op-a', 660);
    jornadaEnCurso(B, 'j-b', 'op-b', 660);
    await corrida();
    expect(meta.salientes.some((s) => [TEL_JEFE_B, TEL_OP_B].includes(s.a))).toBe(false);
    expect(alertas().map((a) => a.tenant_id)).toEqual([A]);
  });

  it('el operador de otra flota con el mismo id no mezcla datos: se lee con el tenant de la jornada', async () => {
    await guardarConfigAlerta(A, CONFIG_ENCENDIDA, ACTOR);
    db.tablas.operador.push({ id: 'op-a', tenant_id: B, nombre: 'Intruso B', telefono: TEL_OP_B, terminal_id: null, activo: true });
    jornadaEnCurso(A, 'j-a', 'op-a', 660);
    await corrida();
    expect(meta.salientes.some((s) => s.a === TEL_OP_B)).toBe(false);
    expect(meta.salientes.find((s) => s.a === TEL_JEFE_A)!.cuerpo).toContain('Luis Norte');
  });

  it('las alertas que lee la pantalla de A no incluyen las de B aunque pida el id de una jornada de B', async () => {
    await guardarConfigAlerta(B, CONFIG_ENCENDIDA, ACTOR);
    jornadaEnCurso(B, 'j-b', 'op-b', 660);
    await corrida();
    expect(alertas()).toHaveLength(1);
    expect(await alertasDeJornadas(A, ['j-b'])).toEqual([]);
    expect(await alertasDeJornadas(B, ['j-b'])).toHaveLength(1);
  });

  it('cerrar un claim con el tenant equivocado no lo cierra', async () => {
    await guardarConfigAlerta(A, CONFIG_ENCENDIDA, ACTOR);
    const rec = await puertosAlertaReales.reclamar({ tenantId: A, jornadaId: 'j-a', nivel: 'aviso', minutos: 600, topeMin: 720, cota: false, fuente: 'declarado_operador', descansoSinCierre: false, ahora: AHORA });
    expect(rec).toMatchObject({ id: expect.any(String), token: expect.any(String) });
    if (rec === null || rec === 'fallo') throw new Error('no reclamó');
    const cerrada = await puertosAlertaReales.cerrar({
      tenantId: B, reclamo: rec, estado: 'enviada', encargado: { canal: 'whatsapp', estado: 'enviado', motivo: null }, operador: { canal: null, estado: 'no_aplica', motivo: null }, ahora: AHORA,
    });
    expect(cerrada).toBe(false);
    expect(alertas()[0].estado).toBe('reclamada');
  });
});
