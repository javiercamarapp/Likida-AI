/* eslint-disable @typescript-eslint/no-explicit-any -- las respuestas de las herramientas son JSON libre que el modelo lee; la prueba las recorre por forma, no por tipo. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfigNotificaciones, UsuarioAvisable } from '../agentes/notificaciones';
import { calcularAlertasFlota, cuentaQuePide } from '@/app/dashboard/calcular-alertas-flota';

// ═══════════════════════════════════════════════════════════════════════════
// E2E DEL CICLO «ORQUESTADOR VIVO» (P6): la escalación AVISA, el barrido de salud abre y cierra su tarea solo y las notificaciones
// del panel lo reflejan. Compone los módulos REALES (la herramienta `escalar_a_persona`, el aviso, el barrido, el ciclo del cron y
// el cálculo de alertas) sobre una base en memoria que reproduce lo que importa de las migraciones 0650-0652: una tarea abierta
// por (flota, llave), el claim del aviso por tarea (UPDATE condicional) y el claim del barrido por flota y ventana.
// ═══════════════════════════════════════════════════════════════════════════

const AHORA = Date.parse('2026-10-02T18:00:00.000Z');
vi.mock('@/lib/saludo', () => ({ ahoraMs: () => AHORA }));
vi.mock('@/lib/correo/enviar', () => ({ correoConfigurado: () => true, enviarCorreo: async () => ({ ok: true }) }));

const { makeExecutor } = await import('@/lib/llm/tool-executor');
const { conPermisos } = await import('./herramientas');
const { ponerFuentes } = await import('./fuentes');
const { crearFuentesEnMemoria, datosVacios } = await import('./fuentes.fixture');
const { avisarEscalacion, MAX_INTENTOS_AVISO } = await import('./aviso_escalacion');
const { correrCicloVivo } = await import('./ciclo_cron');
const { llaveDedupe } = await import('./escalamiento');
const { AGENTES_VIGILADOS } = await import('./salud_agentes');

import type { EntradaSalud, LatidoVisto } from './salud_agentes';
import type { DepsAvisoEscalacion } from './aviso_escalacion';
import type { DepsBarrido } from './barrido_salud';
import type { PuertoCicloVivo } from './ciclo_cron';
import type { Fuentes } from './fuentes';

const A = 'flota-a';   // aviso ENCENDIDO por el dueño
const B = 'flota-b';   // aviso APAGADO (el default)

interface Tarea {
  id: string; tenantId: string; destino: any; motivo: any; viajeFolio: string | null; resumen: string; dedupe: string;
  estado: 'abierta' | 'atendida'; avisoEstado: 'pendiente' | 'enviado' | 'omitido' | 'agotado'; avisoIntentos: number; reclamada: boolean; detalle: string | null; rol: string; nota: string | null;
}

function mundo() {
  let reloj = AHORA;
  let n = 0;
  const tareas: Tarea[] = [];
  const correos: Array<{ para: string[]; asunto: string; tono?: string }> = [];
  const barridos = new Map<string, number>();
  const salud: Record<string, EntradaSalud> = {};
  const config: Record<string, ConfigNotificaciones> = {
    [A]: { eventos: ['escalado'], roles: ['flota_admin', 'encargado'] },
    [B]: { eventos: [], roles: ['flota_admin'] },
  };
  const usuarios: UsuarioAvisable[] = [
    { id: 'u1', nombre: 'Dueño', email: 'dueno@flota.test', rol: 'flota_admin' },
    { id: 'u2', nombre: 'Tráfico', email: 'trafico@flota.test', rol: 'encargado' },
  ];
  let falloCorreo = false;

  const sana = (): EntradaSalud => {
    const latidos: Record<string, LatidoVisto> = {};
    for (const a of AGENTES_VIGILADOS) if (a.cron) latidos[a.cron] = { estado: 'ok', haceMin: 3, ultimoEstado: 'ok' };
    return { ahora: new Date(reloj), latidos, corridas: {}, enviosSinSalir: { vigiaFallidos24h: 0, buzonEntregasConProblema: 0 } };
  };
  const caerVigia = (t: string) => { const s = sana(); s.latidos!.vigia = { estado: 'vencido', haceMin: 55, ultimoEstado: 'ok' }; salud[t] = s; };
  const sanar = (t: string) => { salud[t] = sana(); };
  salud[A] = sana(); salud[B] = sana();

  const insertar = (t: string, x: Pick<Tarea, 'destino' | 'motivo' | 'viajeFolio' | 'resumen' | 'dedupe' | 'rol'>): { estado: 'creada'; id: string } | { estado: 'ya_abierta'; id: string; creadaEn: string } => {
    const previa = tareas.find((y) => y.tenantId === t && y.dedupe === x.dedupe && y.estado === 'abierta');
    if (previa) return { estado: 'ya_abierta', id: previa.id, creadaEn: new Date(AHORA).toISOString() };
    const id = `t${++n}`;
    tareas.push({ id, tenantId: t, ...x, estado: 'abierta', avisoEstado: 'pendiente', avisoIntentos: 0, reclamada: false, detalle: null, nota: null });
    return { estado: 'creada', id };
  };

  const aviso: DepsAvisoEscalacion = {
    async leerTarea(t, id) { const f = tareas.find((x) => x.id === id && x.tenantId === t); return f ? { ...f } : null; },
    async reclamar(t, id) {
      const f = tareas.find((x) => x.id === id && x.tenantId === t);
      if (!f || f.estado !== 'abierta' || f.avisoEstado !== 'pendiente' || f.avisoIntentos >= MAX_INTENTOS_AVISO || f.reclamada) return false;
      f.avisoIntentos++; f.reclamada = true; return true;
    },
    async marcar(t, id, estado, detalle) {
      const f = tareas.find((x) => x.id === id && x.tenantId === t);
      if (!f || f.avisoEstado !== 'pendiente') return;
      f.avisoEstado = estado; f.detalle = detalle; f.reclamada = false;   // (el reclamo de 10 min de la base se simula soltándolo al cerrar el intento)
    },
    async config(t) { return { ok: config[t] }; },
    async usuarios() { return usuarios; },
    canalListo: () => true,
    async enviar(para, c) { if (falloCorreo) return { ok: false, motivo: 'Resend 429' }; correos.push({ para, asunto: c.asunto, tono: c.tono }); return { ok: true }; },
    async nombreFlota(t) { return t === A ? 'Flota A' : 'Flota B'; },
    ahora: () => new Date(reloj),
  };

  const barrido: DepsBarrido = {
    async salud(t) { return salud[t]; },
    async abrirTarea(t, x) { const r = insertar(t, { destino: x.destino, motivo: 'falla_de_agente', viajeFolio: null, resumen: x.resumen, dedupe: x.dedupe, rol: 'sistema' }); return r.estado; },
    async tareasAbiertas(t) { return tareas.filter((x) => x.tenantId === t && x.estado === 'abierta' && x.dedupe.startsWith('barrido:')).map((x) => x.dedupe); },
    async cerrarTarea(t, d, nota) { const f = tareas.find((x) => x.tenantId === t && x.dedupe === d && x.estado === 'abierta'); if (!f) return false; f.estado = 'atendida'; f.nota = nota; return true; },
  };

  const puerto: PuertoCicloVivo = {
    async reclamarFlotas(limite, ventanaMin) {
      const vence = (t: string) => (barridos.get(t) ?? -Infinity) < reloj - ventanaMin * 60_000;
      const flotas = [A, B].filter(vence).slice(0, limite);
      for (const t of flotas) barridos.set(t, reloj);
      return flotas;
    },
    async registrarBarrido() { /* el resultado del barrido no cambia lo que este escenario mide */ },
    async pendientesDeAviso(limite) { return tareas.filter((x) => x.estado === 'abierta' && x.avisoEstado === 'pendiente').slice(0, limite).map((x) => ({ tenantId: x.tenantId, id: x.id })); },
  };

  // La fuente del asistente: la fixture en memoria para el tablero + la escalación sobre ESTA base, con el aviso en caliente como en producción.
  const base = crearFuentesEnMemoria({ [A]: { datos: datosVacios(), folios: ['VJ-9'] }, [B]: { datos: datosVacios(), folios: [] } }).fuentes;
  const fuentes: Fuentes = {
    ...base,
    async crearEscalacion(t, e, quien) {
      const r = insertar(t, { destino: e.destino, motivo: e.motivo, viajeFolio: e.viajeFolio, resumen: e.resumen, dedupe: llaveDedupe(e, e.viajeFolio), rol: quien.rol });
      if (r.estado === 'ya_abierta') return r;
      return { ...r, aviso: await avisarEscalacion(t, r.id, aviso) };
    },
    async escalacionesAbiertas(t) { return tareas.filter((x) => x.tenantId === t && x.estado === 'abierta').map((x) => ({ id: x.id, creadaEn: new Date(AHORA).toISOString(), destino: x.destino, motivo: x.motivo, viajeFolio: x.viajeFolio, resumen: x.resumen, pedidaPorRol: x.rol })); },
  };

  return {
    tareas, correos, aviso, barrido, puerto, fuentes, caerVigia, sanar,
    avanzar: (min: number) => { reloj += min * 60_000; },
    romperCorreo: (v: boolean) => { falloCorreo = v; },
    ciclo: () => correrCicloVivo(puerto, barrido, aviso, { ahora: new Date(reloj) }),
    asistente: (tenantId: string, rol = 'encargado') => {
      ponerFuentes(fuentes);
      const exec = conPermisos(rol, makeExecutor({ tenantId, rol, usuarioId: 'u-1', runId: 'r', conversationId: 'r' }));
      return async (nombre: string, args: Record<string, unknown>) => (await exec(nombre, args)).result as Record<string, any>;
    },
  };
}

afterEach(() => ponerFuentes(null));

describe('E2E del orquestador vivo', () => {
  let w: ReturnType<typeof mundo>;
  beforeEach(() => { w = mundo(); });

  it('1) el asistente escala una emergencia y la persona SE ENTERA en caliente (un correo urgente); preguntar otra vez no duplica ni reenvía', async () => {
    const llamar = w.asistente(A);
    const args = { destino: 'mesa_de_control', motivo: 'posible_emergencia', viaje_folio: 'VJ-9', resumen: 'El chofer no contesta y el GPS lleva horas sin moverse' };
    const r1 = await llamar('escalar_a_persona', args);
    expect(r1).toMatchObject({ creada: true, avisoPorCorreo: true });
    expect(r1.mensajeParaLaPersona).toMatch(/ya le mandé el aviso por correo/);
    expect(w.correos).toHaveLength(1);
    expect(w.correos[0]).toMatchObject({ tono: 'urgente' });
    expect(w.correos[0].para.sort()).toEqual(['dueno@flota.test', 'trafico@flota.test']);
    expect(w.correos[0].asunto).toContain('Posible emergencia');

    const r2 = await llamar('escalar_a_persona', args);
    expect(r2).toMatchObject({ creada: false, yaAbierta: true });
    expect(w.correos).toHaveLength(1);
    expect(w.tareas.filter((t) => t.tenantId === A)).toHaveLength(1);
  });

  it('2) con el aviso APAGADO (el default) la tarea se crea y se ve, pero no sale ningún correo, y el asistente NO afirma que avisó', async () => {
    const llamar = w.asistente(B);
    const r = await llamar('escalar_a_persona', { destino: 'jefe_de_trafico', motivo: 'operador_sin_respuesta', resumen: 'El operador no responde desde hace 2 horas' });
    expect(r).toMatchObject({ creada: true, avisoPorCorreo: false });
    expect(r.mensajeParaLaPersona).not.toMatch(/mandé el aviso/);
    expect(r.mensajeParaLaPersona).toMatch(/avísale tú directamente/);
    expect(w.correos).toHaveLength(0);
    expect(w.tareas[0].avisoEstado).toBe('omitido');
  });

  it('3) el cron barre la salud: un agente caído abre UNA tarea por flota (y avisa solo a la que lo encendió); barrer de nuevo no duplica', async () => {
    w.caerVigia(A); w.caerVigia(B);
    const c1 = await w.ciclo();
    expect(c1.barrido).toMatchObject({ flotas: 2, abiertas: 2, cerradas: 0, fallos: 0 });
    expect(w.tareas.map((t) => `${t.tenantId}:${t.dedupe}:${t.destino}`).sort()).toEqual([`${A}:barrido:vigia:mesa_de_control`, `${B}:barrido:vigia:mesa_de_control`]);
    expect(w.tareas.every((t) => t.motivo === 'falla_de_agente' && t.rol === 'sistema')).toBe(true);
    // el correo: solo A (B lo tiene apagado y su tarea queda «omitida: apagado»)
    expect(w.correos).toHaveLength(1);
    expect(w.correos[0].asunto).toContain('Falla de un agente');
    expect(w.tareas.find((t) => t.tenantId === B)!.avisoEstado).toBe('omitido');
    expect(c1.fallos).toBe(0);

    // otra corrida inmediata: el claim por flota ya no entrega a nadie
    const c2 = await w.ciclo();
    expect(c2.barrido).toMatchObject({ flotas: 0, abiertas: 0 });
    // y 31 min después, con el agente aún caído: la tarea sigue siendo la misma y NO se reenvía
    w.avanzar(31);
    const c3 = await w.ciclo();
    expect(c3.barrido).toMatchObject({ flotas: 2, abiertas: 0 });
    expect(w.tareas).toHaveLength(2);
    expect(w.correos).toHaveLength(1);
  });

  it('4) cuando el agente se recupera, la tarea se cierra sola; la que dejó el asistente NO se toca', async () => {
    await w.asistente(A)('escalar_a_persona', { destino: 'mesa_de_control', motivo: 'cliente_molesto', resumen: 'El cliente está muy molesto' });
    w.caerVigia(A);
    await w.ciclo();
    expect(w.tareas.filter((t) => t.estado === 'abierta')).toHaveLength(2);
    w.sanar(A);
    w.avanzar(31);
    const c = await w.ciclo();
    expect(c.barrido).toMatchObject({ cerradas: 1 });
    const abiertas = w.tareas.filter((t) => t.tenantId === A && t.estado === 'abierta');
    expect(abiertas).toHaveLength(1);
    expect(abiertas[0].motivo).toBe('cliente_molesto');
    expect(w.tareas.find((t) => t.dedupe === 'barrido:vigia' && t.tenantId === A)!.nota).toMatch(/Se resolvió solo/);
  });

  it('5) un correo que falla se reintenta en las corridas siguientes y al tercer intento queda agotado, dicho en la tarea', async () => {
    w.romperCorreo(true);
    await w.asistente(A)('escalar_a_persona', { destino: 'jefe_de_trafico', motivo: 'otro', resumen: 'Algo que necesita a una persona' });
    const t = w.tareas[0];
    expect(t).toMatchObject({ avisoEstado: 'pendiente', avisoIntentos: 1 });
    await w.ciclo();
    expect(t).toMatchObject({ avisoEstado: 'pendiente', avisoIntentos: 2 });
    w.avanzar(31);
    await w.ciclo();
    expect(t.avisoEstado).toBe('agotado');
    expect(t.detalle).toMatch(/Resend 429/);
    // y no vuelve a intentarse
    w.romperCorreo(false);
    w.avanzar(31);
    await w.ciclo();
    expect(w.correos).toHaveLength(0);
  });

  it('6) las notificaciones del panel reflejan las tareas abiertas y dejan de hacerlo al atenderlas', async () => {
    await w.asistente(A)('escalar_a_persona', { destino: 'mesa_de_control', motivo: 'posible_emergencia', resumen: 'Sin señal de vida desde las 14:00' });
    const NADA = { porRevisar: 0, duplicados: 0, huerfanos: 0, escalados: 0, conectores: [] };
    const abiertas = (await w.fuentes.escalacionesAbiertas(A, 60))!.length;
    const alertas = calcularAlertasFlota({ ...NADA, tareasAsistente: abiertas, excepcionesConductor: 2, sinSenalDeVida: 1 });
    expect(alertas.map((a) => a.href)).toEqual(['/dashboard/viajes-en-vivo', '/dashboard/viajes-en-vivo']);
    expect(cuentaQuePide(alertas)).toBe(2);
    // se atiende: la alerta de tareas desaparece (la del Conductor es otra señal)
    w.tareas[0].estado = 'atendida';
    const despues = calcularAlertasFlota({ ...NADA, tareasAsistente: (await w.fuentes.escalacionesAbiertas(A, 60))!.length });
    expect(despues).toEqual([]);
  });

  it('7) los agentes que vigila el barrido incluyen carta-porte-docs (decisión P6) y su caída abre una tarea para el jefe de tráfico', async () => {
    const s = (await w.barrido.salud(A, new Date(AHORA)));
    s.latidos!['carta-porte-docs'] = { estado: 'vencido', haceMin: 45, ultimoEstado: 'ok' };
    await w.ciclo();
    const t = w.tareas.find((x) => x.tenantId === A && x.dedupe === 'barrido:carta_porte');
    expect(t).toMatchObject({ destino: 'jefe_de_trafico', motivo: 'falla_de_agente' });
    expect(t!.resumen).toContain('Carta Porte');
  });
  it('8) FUERA DE ORDEN: la tarea se atiende o el agente se recupera ANTES de que llegue el aviso → no se manda un correo de algo ya resuelto', async () => {
    // a) la persona atiende la tarea mientras el aviso sigue pendiente (el correo falló una vez): la corrida siguiente no escribe.
    w.romperCorreo(true);
    await w.asistente(A)('escalar_a_persona', { destino: 'jefe_de_trafico', motivo: 'operador_sin_respuesta', resumen: 'El operador no responde' });
    expect(w.tareas[0]).toMatchObject({ avisoEstado: 'pendiente', avisoIntentos: 1 });
    w.tareas[0].estado = 'atendida';
    w.romperCorreo(false);
    expect(await avisarEscalacion(A, w.tareas[0].id, w.aviso)).toBe('no_aplica');
    w.avanzar(31);
    await w.ciclo();
    expect(w.correos).toHaveLength(0);
    expect(w.tareas[0]).toMatchObject({ avisoEstado: 'pendiente', avisoIntentos: 1 });

    // b) el latido cae, el barrido abre la tarea con el correo caído, el agente se recupera y el barrido la cierra solo: el aviso
    //    que llega después (cuando el correo vuelve) ya no aplica y no sale nada.
    w.romperCorreo(true);
    w.caerVigia(A);
    w.avanzar(31);
    await w.ciclo();
    const barrida = w.tareas.find((t) => t.dedupe === 'barrido:vigia')!;
    expect(barrida).toMatchObject({ estado: 'abierta', avisoEstado: 'pendiente' });
    w.sanar(A);
    w.romperCorreo(false);
    w.avanzar(31);
    const c = await w.ciclo();
    expect(c.barrido).toMatchObject({ cerradas: 1 });
    expect(barrida.estado).toBe('atendida');
    expect(w.correos).toHaveLength(0);
    expect(await avisarEscalacion(A, barrida.id, w.aviso)).toBe('no_aplica');

    // c) un latido que se recupera ANTES del primer barrido no abre ninguna tarea
    const antes = w.tareas.length;
    w.caerVigia(B); w.sanar(B);
    w.avanzar(31);
    await w.ciclo();
    expect(w.tareas).toHaveLength(antes);
  });
});
