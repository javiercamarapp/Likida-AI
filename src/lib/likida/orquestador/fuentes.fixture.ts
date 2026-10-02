import { CONFIG_CONDUCTOR_DEFAULT as DEFAULT, type ConfigConductor } from '../conductor/config';
import type { DatosTablero } from '../conductor/repo_validacion';
import { configApagada } from '../vigia/tipos';
import type { EscalacionValida, TareaAbierta } from './escalamiento';
import { llaveDedupe } from './escalamiento';
import type { EntradaTableroConCatalogos, Fuentes, ResultadoCrearEscalacion } from './fuentes';
import type { PosicionUnidad } from './tablero_viajes';

// ═══════════════════════════════════════════════════════════════════════════
// UNA `Fuentes` EN MEMORIA, MULTI-FLOTA, PARA LAS PRUEBAS.
//
// Cada flota tiene SU mundo; pedirle a la fuente el tenant A solo puede devolver
// lo de A. Anota cada llamada (`llamadas`) para que las pruebas demuestren que
// ninguna herramienta preguntó por otra flota.
// ═══════════════════════════════════════════════════════════════════════════

export interface MundoFlota {
  datos: DatosTablero;
  posiciones?: Record<string, PosicionUnidad> | null;
  terminales?: Array<{ id: string; nombre: string }>;
  clientes?: Array<{ id: string; nombre: string }>;
  config?: Partial<ConfigConductor>;
  vigia?: Awaited<ReturnType<Fuentes['vigia']>>;
  buzon?: Awaited<ReturnType<Fuentes['buzon']>>;
  cobranza?: Awaited<ReturnType<Fuentes['cobranza']>>;
  autofactura?: Awaited<ReturnType<Fuentes['autofactura']>>;
  salud?: Awaited<ReturnType<Fuentes['salud']>>;
  /** Folios que existen (para escalar con folio). */
  folios?: string[];
  /** false = la tabla de escalaciones no existe (base sin migrar). */
  escalacionesDisponibles?: boolean;
}

export const datosVacios = (): DatosTablero => ({ viajes: [], hayMas: false, hitos: [], veredictos: [], evidencias: [], acciones: [], sitios: new Map() });

export function crearFuentesEnMemoria(mundos: Record<string, MundoFlota>) {
  const llamadas: Array<{ fuente: string; tenantId: string }> = [];
  const tareas = new Map<string, Array<TareaAbierta & { dedupe: string; tenantId: string; usuarioId: string | null }>>();
  const mundo = (fuente: string, t: string): MundoFlota => {
    llamadas.push({ fuente, tenantId: t });
    const m = mundos[t];
    if (!m) throw new Error(`flota desconocida: ${t}`);
    return m;
  };
  const falta = (f: string): never => { throw new Error(`el mundo de prueba no define ${f}`); };

  const fuentes: Fuentes = {
    async entradaTablero(t, ahora): Promise<EntradaTableroConCatalogos> {
      const m = mundo('entradaTablero', t);
      return {
        datos: m.datos,
        config: { ...DEFAULT, solicitudesMin: [...DEFAULT.solicitudesMin], diasSemana: [...DEFAULT.diasSemana], ...(m.config ?? {}) },
        posiciones: m.posiciones === null ? null : new Map(Object.entries(m.posiciones ?? {})),
        ahora, terminales: m.terminales ?? [], clientes: m.clientes ?? [],
      };
    },
    async vigia(t) { return mundo('vigia', t).vigia ?? { datos: { config: configApagada(t), conversaciones: [], pendientes: [], fallidos: [], contactos: [], eventos: [], respuesta: { muestra: 0, promedioMin: null, medianaMin: null }, clientes: [], gerentes: [] }, grupos: [] }; },
    async buzon(t) { return mundo('buzon', t).buzon ?? falta('buzon'); },
    async cobranza(t) { return mundo('cobranza', t).cobranza ?? falta('cobranza'); },
    async autofactura(t) { return mundo('autofactura', t).autofactura ?? falta('autofactura'); },
    async salud(t, ahora) { return mundo('salud', t).salud ?? { ahora, latidos: {}, corridas: {}, enviosSinSalir: { vigiaFallidos24h: 0, buzonEntregasConProblema: 0 } }; },
    async crearEscalacion(t, e: EscalacionValida, quien): Promise<ResultadoCrearEscalacion> {
      const m = mundo('crearEscalacion', t);
      if (m.escalacionesDisponibles === false) return { estado: 'no_disponible' };
      if (e.viajeFolio && !(m.folios ?? []).includes(e.viajeFolio)) return { estado: 'folio_no_encontrado' };
      const dedupe = llaveDedupe(e, e.viajeFolio);
      const lista = tareas.get(t) ?? [];
      const previa = lista.find((x) => x.dedupe === dedupe);
      if (previa) return { estado: 'ya_abierta', id: previa.id, creadaEn: previa.creadaEn };
      const id = `esc-${t}-${lista.length + 1}`;
      lista.push({ id, creadaEn: '2026-10-02T18:00:00.000Z', destino: e.destino, motivo: e.motivo, viajeFolio: e.viajeFolio, resumen: e.resumen, pedidaPorRol: quien.rol, dedupe, tenantId: t, usuarioId: quien.usuarioId });
      tareas.set(t, lista);
      return { estado: 'creada', id };
    },
    async escalacionesAbiertas(t) { return (tareas.get(t) ?? []).map(({ dedupe: _d, tenantId: _t, usuarioId: _u, ...x }) => x); },
  };
  return { fuentes, llamadas, tareas };
}

// ── Constructores de viajes e hitos para las pruebas ─────────────────────────
import { hitoVacio } from '../conductor/memoria.fixture';
import type { ViajeTablero } from '../conductor/repo_validacion';
import type { HitoFila, TipoHito } from '../conductor/tipos';

export function viajeTablero(id: string, p: Partial<ViajeTablero> = {}, ahora = new Date('2026-10-02T18:00:00.000Z')): ViajeTablero {
  return {
    id, folio: `F-${id}`, origen: 'Zapopan', destino: 'Monterrey', estatus: 'abierto', operadorId: `o-${id}`, operadorNombre: `Chofer ${id}`,
    terminalId: 'tm1', terminalNombre: 'Terminal Uno', clienteId: 'c1', clienteNombre: 'Cliente A', unidadId: `u-${id}`,
    aceptadoEn: new Date(ahora.getTime() - 60 * 60_000).toISOString(), citaOrigenEn: null, citaDestinoEn: null, etaOrigenEn: null, etaDestinoEn: null,
    origenSitioId: null, destinoSitioId: null, ...p,
  };
}

export function hitosDe(viajeId: string, estados: Partial<Record<TipoHito, Partial<HitoFila> | string>> = {}): HitoFila[] {
  return (['llegada_carga', 'salida_carga', 'llegada_descarga', 'salida_descarga', 'regreso'] as TipoHito[]).map((tipo) => {
    const e = estados[tipo];
    const extra: Partial<HitoFila> = typeof e === 'string' ? { estado: 'recibido', fuente: 'texto', mensajeEn: e, recibidoEn: e } : (e ?? {});
    return hitoVacio({ id: `${viajeId}-${tipo}`, tipo, viajeId, ...extra });
  });
}
