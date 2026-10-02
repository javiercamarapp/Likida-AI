// ═══════════════════════════════════════════════════════════════════════════
// LIQUIDACIÓN EXTERNA — el DOBLE EN MEMORIA del aviso de discrepancia (0643/0644) y de la tarea del orquestador (0650).
//
// Lo usan las pruebas que simulan `./repo` entero. Reproduce la SEMÁNTICA de las RPC (lo que la prueba SQL
// `supabase/tests/0643_*.sql` demuestra contra Postgres real): la transición «No coincide» solo la gana una llamada, el
// aviso se reclama con arriendo y un token, se cierra solo con el token vigente, suma a quién ya le llegó y al agotar los
// intentos queda fallido hasta que se rearma. Con `sinMigrar` simula una base SIN las migraciones: el código debe caer al
// aviso de una sola vez.
// ═══════════════════════════════════════════════════════════════════════════

import type { AvisoDiscrepancia, LiquidacionExterna, CierreAviso, TareaDiferencia, EstadoAvisoDiscrepancia } from './repo';

const MAX_INTENTOS = 5;

export class AvisosEnMemoria {
  readonly filas = new Map<string, AvisoDiscrepancia>();
  private readonly claims = new Map<string, { token: string; expira: string }>();
  readonly tareas: Array<{ id: string; tenantId: string; dedupe: string; abierta: boolean; resumen: string; viajeFolio: string | null }> = [];
  sinMigrar = false;
  sinTareas = false;
  /** Si es una función, `crearTareaDiferencia` lanza con ese error (simula un fallo de la base). */
  falloTarea: Error | null = null;
  private n = 0;

  constructor(private readonly leer: (id: string) => LiquidacionExterna | undefined) {}

  reiniciar(): void {
    this.filas.clear(); this.claims.clear(); this.tareas.length = 0;
    this.sinMigrar = false; this.sinTareas = false; this.falloTarea = null; this.n = 0;
  }

  private llave = (id: string, ciclo: number) => `${id}|${ciclo}`;
  private ultimo(id: string): AvisoDiscrepancia | undefined {
    return [...this.filas.values()].filter((a) => a.liquidacionId === id).sort((a, b) => b.ciclo - a.ciclo)[0];
  }

  registrarNoCoincideAtomico = async (t: string, id: string, op: string, ahoraIso: string): Promise<{ ciclo: number | null } | 'sin_rpc'> => {
    if (this.sinMigrar) return 'sin_rpc';
    const f = this.leer(id);
    if (!f || f.tenantId !== t || f.operadorId !== op || f.acuseTipo === 'no_coincide') return { ciclo: null };
    f.estado = 'acusada'; f.acuseTipo = 'no_coincide'; f.acuseEn = ahoraIso; f.acuseConfirmadoEn = null;
    const ciclo = (this.ultimo(id)?.ciclo ?? 0) + 1;
    this.filas.set(this.llave(id, ciclo), {
      liquidacionId: id, tenantId: t, ciclo, estado: 'pendiente', intentos: 0, proximoIntentoEn: ahoraIso,
      ultimoError: null, telefonosAceptados: [], tareaId: null, enviadoEn: null,
    });
    return { ciclo };
  };

  reclamarAvisoDiscrepancia = async (t: string, id: string, ciclo: number, ahoraIso: string): Promise<{ token: string } | null> => {
    const a = this.filas.get(this.llave(id, ciclo));
    if (!a || a.tenantId !== t) return null;
    const c = this.claims.get(this.llave(id, ciclo));
    const toca = (a.estado === 'pendiente' && a.proximoIntentoEn <= ahoraIso) || (a.estado === 'enviando' && !!c && c.expira <= ahoraIso);
    if (!toca) return null;
    a.estado = 'enviando';
    const token = `tok-${++this.n}`;
    this.claims.set(this.llave(id, ciclo), { token, expira: new Date(new Date(ahoraIso).getTime() + 300_000).toISOString() });
    return { token };
  };

  cerrarAvisoDiscrepancia = async (t: string, id: string, ciclo: number, reclamo: { token: string }, c: CierreAviso, ahoraIso: string): Promise<EstadoAvisoDiscrepancia | null> => {
    const a = this.filas.get(this.llave(id, ciclo));
    const cl = this.claims.get(this.llave(id, ciclo));
    if (!a || a.tenantId !== t || a.estado !== 'enviando' || !cl || cl.token !== reclamo.token) return null;
    a.telefonosAceptados = [...new Set([...a.telefonosAceptados, ...c.aceptados])].sort();
    a.ultimoError = c.resultado === 'enviado' ? null : (c.error ?? null);
    if (c.resultado === 'reintentar') a.intentos += 1;
    if (c.resultado === 'enviado') { a.estado = 'enviado'; a.enviadoEn = ahoraIso; }
    else if (c.resultado === 'reintentar' && a.intentos < MAX_INTENTOS) { a.estado = 'pendiente'; a.proximoIntentoEn = c.proximoIso ?? ahoraIso; }
    else a.estado = 'fallido';
    this.claims.delete(this.llave(id, ciclo));
    return a.estado;
  };

  rearmarAvisoDiscrepancia = async (t: string, id: string, ahoraIso: string): Promise<{ ciclo: number | null } | 'sin_rpc'> => {
    if (this.sinMigrar) return 'sin_rpc';
    const f = this.leer(id);
    if (!f || f.tenantId !== t || f.acuseTipo !== 'no_coincide') return { ciclo: null };
    const u = this.ultimo(id);
    if (!u) {
      this.filas.set(this.llave(id, 1), { liquidacionId: id, tenantId: t, ciclo: 1, estado: 'pendiente', intentos: 0, proximoIntentoEn: ahoraIso, ultimoError: null, telefonosAceptados: [], tareaId: null, enviadoEn: null });
      return { ciclo: 1 };
    }
    if (u.estado !== 'pendiente' && u.estado !== 'fallido') return { ciclo: null };
    u.estado = 'pendiente'; u.intentos = 0; u.proximoIntentoEn = ahoraIso; u.ultimoError = null;
    return { ciclo: u.ciclo };
  };

  leerAvisoDiscrepancia = async (t: string, id: string, ciclo: number): Promise<AvisoDiscrepancia | null> => {
    const a = this.filas.get(this.llave(id, ciclo));
    return a && a.tenantId === t ? { ...a, telefonosAceptados: [...a.telefonosAceptados] } : null;
  };

  marcarTareaAviso = async (_t: string, id: string, ciclo: number, tareaId: string): Promise<void> => {
    const a = this.filas.get(this.llave(id, ciclo));
    if (a) a.tareaId = tareaId;
  };

  avisosPendientes = async (limite: number, ahoraIso: string): Promise<AvisoDiscrepancia[]> => {
    if (this.sinMigrar) return [];
    return [...this.filas.values()].filter((a) => {
      const c = this.claims.get(this.llave(a.liquidacionId, a.ciclo));
      return (a.estado === 'pendiente' && a.proximoIntentoEn <= ahoraIso) || (a.estado === 'enviando' && !!c && c.expira <= ahoraIso);
    }).slice(0, limite).map((a) => ({ ...a }));
  };

  avisosDiscrepanciaDe = async (_t: string, ids: string[]): Promise<Map<string, AvisoDiscrepancia> | null> => {
    if (this.sinMigrar) return null;
    const m = new Map<string, AvisoDiscrepancia>();
    for (const id of ids) { const u = this.ultimo(id); if (u) m.set(id, { ...u }); }
    return m;
  };

  /** La tarea durable en la cola del orquestador: UNA abierta por liquidación (índice único parcial de la 0650). */
  crearTareaDiferenciaLiquidacion = async (t: string, id: string, x: TareaDiferencia): Promise<{ estado: 'creada' | 'ya_abierta'; id: string } | { estado: 'no_disponible' }> => {
    if (this.falloTarea) throw this.falloTarea;
    if (this.sinTareas) return { estado: 'no_disponible' };
    const dedupe = `liquidacion|diferencia_liquidacion|liq:${id}`;
    const previa = this.tareas.find((x2) => x2.tenantId === t && x2.dedupe === dedupe && x2.abierta);
    if (previa) return { estado: 'ya_abierta', id: previa.id };
    const nueva = { id: `tarea-${this.tareas.length + 1}`, tenantId: t, dedupe, abierta: true, resumen: x.resumen, viajeFolio: x.viajeFolio };
    this.tareas.push(nueva);
    return { estado: 'creada', id: nueva.id };
  };
}

export const AVISO_MAX_INTENTOS = MAX_INTENTOS;
