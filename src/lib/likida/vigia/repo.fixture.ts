// Doble EN MEMORIA de RepoVigia para las pruebas del servicio. Respeta las mismas
// garantías que la base (0400): dedupe por (tenant, wamid), una conversación activa
// por contacto, una respuesta del agente por entrante, eventos con clave única por
// flota, reclamo condicional de estado y aislamiento por tenant en TODA lectura.
// SOLO para pruebas (`.fixture.ts`).
import type {
  CambioReclamo, Destinatario, FilaEnEspera, NuevoEvento, NuevoSaliente, RepoVigia, ResultadoRecibir,
} from './puertos';
import type { EstatusViaje, ResumenViaje, ServicioEstatusViaje } from './estatus_viaje';
import {
  configApagada, configParaCliente, type ConfigVigia, type Contacto, type Conversacion, type EstadoMensajeSaliente, type Intencion, type MensajeVigia, type TipoEvento,
} from './tipos';
import { CLIENTE_A, T1 } from './datos.fixture';
import { seleccionarEnEspera } from './escalamiento';
import { adjuntosDeRespaldo, type ArchivoParaEnviar } from './adjuntos';

export interface EventoGuardado extends NuevoEvento { tenantId: string; id: number }

export class EstatusDoble implements ServicioEstatusViaje {
  viajes = new Map<string, Array<{ resumen: ResumenViaje; estatus: EstatusViaje }>>(); // clave tenant|cliente
  llamadas: Array<{ metodo: string; tenantId: string; clienteId: string; viajeId?: string }> = [];
  falla = false;
  agregar(tenantId: string, clienteId: string, estatus: EstatusViaje): void {
    const k = `${tenantId}|${clienteId}`;
    const lista = this.viajes.get(k) ?? [];
    lista.push({ resumen: { viajeId: estatus.viajeId, folio: estatus.folio, origen: estatus.origen, destino: estatus.destino }, estatus });
    this.viajes.set(k, lista);
  }
  async viajesEnCurso(a: { tenantId: string; clienteId: string }): Promise<ResumenViaje[]> {
    this.llamadas.push({ metodo: 'viajesEnCurso', ...a });
    if (this.falla) throw new Error('base de viajes caída');
    return (this.viajes.get(`${a.tenantId}|${a.clienteId}`) ?? []).map((v) => v.resumen);
  }
  async estatus(a: { tenantId: string; clienteId: string; viajeId: string }): Promise<EstatusViaje | null> {
    this.llamadas.push({ metodo: 'estatus', ...a });
    if (this.falla) throw new Error('base de viajes caída');
    return (this.viajes.get(`${a.tenantId}|${a.clienteId}`) ?? []).find((v) => v.estatus.viajeId === a.viajeId)?.estatus ?? null;
  }
}

export class RepoEnMemoria implements RepoVigia {
  configs = new Map<string, ConfigVigia>();
  contactos = new Map<string, Contacto>();
  conversaciones = new Map<string, Conversacion>();
  mensajes = new Map<string, MensajeVigia & { datosRespaldo?: unknown }>();
  eventos: EventoGuardado[] = [];
  flotas = new Map<string, string>();
  clientes = new Map<string, string>();
  /** nivel → destinatario por tenant */
  destinatarios = new Map<string, Destinatario | null>();
  estatus = new EstatusDoble();
  /** Los archivos adjuntables por (flota|cliente|viaje|clave): la base real solo entrega los de ESE cliente en ESA flota. */
  archivos = new Map<string, ArchivoParaEnviar>();
  llamadasArchivo: Array<{ tenantId: string; clienteId: string; viajeId: string; clave: string }> = [];
  purgas = 0;
  fallaEn: Partial<Record<keyof RepoVigia, boolean>> = {};
  private seq = 0;
  private idEvento = 0;

  constructor(public reloj: () => Date = () => new Date('2026-10-01T18:00:00.000Z')) {}

  private id(): string { this.seq += 1; return `00000000-0000-4000-8000-${String(this.seq).padStart(12, '0')}`; }
  private verifica(metodo: keyof RepoVigia): void { if (this.fallaEn[metodo]) throw new Error(`${String(metodo)} falló`); }

  // ── armado de escenarios ──
  agregarContacto(c: Partial<Contacto> & { tenantId: string; clienteId: string; telefono: string }): Contacto {
    const contacto: Contacto = {
      id: this.id(), nombre: 'María Pérez', gerenteUserId: null, estado: 'activo',
      consentimientoEn: '2026-09-01T00:00:00Z', optoutEn: null, avisoPrivacidadEn: null, ...c,
    };
    this.contactos.set(contacto.id, contacto);
    return contacto;
  }
  habilitar(tenantId: string, parche: Partial<ConfigVigia> = {}): void {
    this.configs.set(tenantId, { ...configApagada(tenantId), habilitado: true, ...parche });
  }
  destinatario(tenantId: string, nivel: 1 | 2, d: Destinatario | null): void { this.destinatarios.set(`${tenantId}|${nivel}`, d); }
  eventosDe(tipo: TipoEvento): EventoGuardado[] { return this.eventos.filter((e) => e.tipo === tipo); }
  salientes(): MensajeVigia[] { return [...this.mensajes.values()].filter((m) => m.direccion === 'saliente'); }
  entrantes(): MensajeVigia[] { return [...this.mensajes.values()].filter((m) => m.direccion === 'entrante'); }

  // ── RepoVigia ──
  async archivoAdjunto(a: { tenantId: string; clienteId: string; viajeId: string; clave: 'pod' }): Promise<ArchivoParaEnviar | null> {
    this.llamadasArchivo.push(a);
    this.verifica('archivoAdjunto');
    return this.archivos.get(`${a.tenantId}|${a.clienteId}|${a.viajeId}|${a.clave}`) ?? null;
  }
  criticos = new Set<string>();
  async clienteCritico(tenantId: string, clienteId: string): Promise<boolean> { this.verifica('clienteCritico'); return this.criticos.has(`${tenantId}:${clienteId}`); }
  async config(tenantId: string): Promise<ConfigVigia> { this.verifica('config'); return this.configs.get(tenantId) ?? configApagada(tenantId); }
  async contactoPorTelefono(telefono: string): Promise<Contacto | null> {
    this.verifica('contactoPorTelefono');
    return [...this.contactos.values()].find((c) => c.telefono === telefono && (c.estado === 'activo' || c.estado === 'baja')) ?? null;
  }
  async nombreFlota(tenantId: string): Promise<string> { return this.flotas.get(tenantId) ?? 'Transportes del Norte'; }
  async nombreCliente(tenantId: string, clienteId: string): Promise<string | null> { return this.clientes.get(`${tenantId}|${clienteId}`) ?? 'Compras Acme'; }

  async recibir(a: { tenantId: string; contactoId: string; wamid: string | null; tipo: string; texto: string; ahora: Date }): Promise<ResultadoRecibir> {
    this.verifica('recibir');
    const contacto = this.contactos.get(a.contactoId);
    if (!contacto || contacto.tenantId !== a.tenantId || contacto.estado !== 'activo') throw new Error('contacto no autorizado para el vigía');
    let conv = [...this.conversaciones.values()].find((c) => c.contactoId === a.contactoId && c.estado === 'activa');
    if (!conv) {
      conv = {
        id: this.id(), tenantId: a.tenantId, contactoId: a.contactoId, clienteId: contacto.clienteId, viajeId: null, estado: 'activa',
        control: 'agente', tomadaPor: null, ultimaEntradaEn: null, ultimaSalidaEn: null, sinRespuestaDesde: null, entradasSinRespuesta: 0,
        molestiaNivel: 0, molestiaMotivos: [], molestiaEn: null, escalamientoNivel: 0, escaladoEn: null, atendidaEn: null,
      };
      this.conversaciones.set(conv.id, conv);
    }
    if (a.wamid) {
      const previo = [...this.mensajes.values()].find((m) => m.tenantId === a.tenantId && m.wamid === a.wamid);
      if (previo) return { mensajeId: previo.id, conversacionId: conv.id, duplicado: true };
    }
    const id = this.id();
    this.mensajes.set(id, {
      id, tenantId: a.tenantId, conversacionId: conv.id, direccion: 'entrante', autor: 'cliente', wamid: a.wamid, tipo: a.tipo, texto: a.texto,
      intencion: null, estado: 'recibido', respuestaA: null, riesgo: null, autoenviado: false, editado: false, aprobadoPor: null, enviadoEn: null,
      via: null, error: null, senales: [], adjuntos: [], createdAt: a.ahora.toISOString(),
    });
    conv.ultimaEntradaEn = a.ahora.toISOString();
    conv.sinRespuestaDesde = conv.sinRespuestaDesde ?? a.ahora.toISOString();
    conv.entradasSinRespuesta += 1;
    return { mensajeId: id, conversacionId: conv.id, duplicado: false };
  }

  async conversacion(tenantId: string, id: string): Promise<Conversacion | null> {
    this.verifica('conversacion');
    const c = this.conversaciones.get(id);
    return c && c.tenantId === tenantId ? { ...c } : null;
  }
  async mensaje(tenantId: string, id: string): Promise<MensajeVigia | null> {
    this.verifica('mensaje');
    const m = this.mensajes.get(id);
    return m && m.tenantId === tenantId ? { ...m } : null;
  }
  async contactoDe(tenantId: string, conversacionId: string): Promise<Contacto | null> {
    const c = this.conversaciones.get(conversacionId);
    if (!c || c.tenantId !== tenantId) return null;
    const ct = this.contactos.get(c.contactoId);
    return ct && ct.tenantId === tenantId ? { ...ct } : null;
  }
  async ultimoEntranteId(tenantId: string, conversacionId: string): Promise<string | null> {
    const l = this.entrantes().filter((m) => m.tenantId === tenantId && m.conversacionId === conversacionId);
    return l.length ? l[l.length - 1].id : null;
  }
  async entrantesRecientes(tenantId: string, conversacionId: string, desde: Date, limite: number) {
    return this.entrantes()
      .filter((m) => m.tenantId === tenantId && m.conversacionId === conversacionId && Date.parse(m.createdAt) >= desde.getTime())
      .slice(-limite).map((m) => ({ texto: m.texto, creadoEn: m.createdAt }));
  }

  async anotarClasificacion(tenantId: string, mensajeId: string, c: { intencion: Intencion; confianza: number; clasificador: string; senales: string[] }): Promise<void> {
    const m = this.mensajes.get(mensajeId);
    if (!m || m.tenantId !== tenantId) return;
    m.intencion = c.intencion; m.senales = [...c.senales];
  }
  async crearSaliente(tenantId: string, n: NuevoSaliente): Promise<{ id: string; creado: boolean }> {
    this.verifica('crearSaliente');
    const conv = this.conversaciones.get(n.conversacionId);
    if (!conv || conv.tenantId !== tenantId) throw new Error('FK compuesta: conversación de otra flota');
    if (n.autor === 'agente' && n.respuestaA) {
      const previo = this.salientes().find((m) => m.tenantId === tenantId && m.autor === 'agente' && m.respuestaA === n.respuestaA);
      if (previo) return { id: previo.id, creado: false };
    }
    const id = this.id();
    this.mensajes.set(id, {
      id, tenantId, conversacionId: n.conversacionId, direccion: 'saliente', autor: n.autor, wamid: null, tipo: 'texto', texto: n.texto,
      intencion: n.intencion, estado: n.estado, respuestaA: n.respuestaA, riesgo: n.riesgo, autoenviado: n.autoenviado, editado: false,
      aprobadoPor: n.aprobadoPor, enviadoEn: null, via: null, error: null, senales: n.senales, adjuntos: adjuntosDeRespaldo(n.datosRespaldo),
      createdAt: this.reloj().toISOString(), datosRespaldo: n.datosRespaldo,
    });
    return { id, creado: true };
  }
  async reclamarEstado(tenantId: string, mensajeId: string, de: EstadoMensajeSaliente[], a: EstadoMensajeSaliente, cambio: CambioReclamo = {}): Promise<MensajeVigia | null> {
    this.verifica('reclamarEstado');
    const m = this.mensajes.get(mensajeId);
    if (!m || m.tenantId !== tenantId || m.direccion !== 'saliente' || !de.includes(m.estado as EstadoMensajeSaliente)) return null;
    m.estado = a;
    if (cambio.aprobadoPor !== undefined) m.aprobadoPor = cambio.aprobadoPor;
    if (cambio.editado !== undefined) m.editado = cambio.editado;
    if (cambio.texto !== undefined) m.texto = cambio.texto;
    return { ...m };
  }
  async marcarEnviado(tenantId: string, mensajeId: string, a: { via: 'texto' | 'botones' | 'plantilla'; wamid: string | null; ahora: Date }): Promise<void> {
    const m = this.mensajes.get(mensajeId);
    if (!m || m.tenantId !== tenantId) return;
    m.estado = 'enviado'; m.via = a.via; m.wamid = a.wamid; m.enviadoEn = a.ahora.toISOString();
  }
  async marcarFallido(tenantId: string, mensajeId: string, error: string): Promise<void> {
    const m = this.mensajes.get(mensajeId);
    if (!m || m.tenantId !== tenantId) return;
    m.estado = 'fallido'; m.error = error;
  }
  async marcarAvisoGerente(): Promise<void> { /* sin efecto observable aquí */ }
  async aprobacionesSinEditar(tenantId: string, intencion: Intencion): Promise<number> {
    return this.salientes().filter((m) => m.tenantId === tenantId && m.intencion === intencion && m.autor === 'agente'
      && m.aprobadoPor !== null && !m.editado && !m.autoenviado && (m.estado === 'enviado' || m.estado === 'aprobado')).length;
  }
  async pendientesDeHilo(tenantId: string, conversacionId: string): Promise<string[]> {
    return this.salientes().filter((m) => m.tenantId === tenantId && m.conversacionId === conversacionId
      && (m.estado === 'pendiente_aprobacion' || m.estado === 'borrador')).map((m) => m.id);
  }

  async actualizarConversacion(tenantId: string, id: string, p: Parameters<RepoVigia['actualizarConversacion']>[2]): Promise<void> {
    this.verifica('actualizarConversacion');
    const c = this.conversaciones.get(id);
    if (!c || c.tenantId !== tenantId) return;
    Object.assign(c, p);
  }
  async marcarRespondida(tenantId: string, conversacionId: string, ahora: Date): Promise<void> {
    const c = this.conversaciones.get(conversacionId);
    if (!c || c.tenantId !== tenantId) return;
    c.sinRespuestaDesde = null; c.entradasSinRespuesta = 0; c.escalamientoNivel = 0; c.atendidaEn = null;
    c.molestiaNivel = 0; c.molestiaMotivos = []; c.molestiaEn = null; c.ultimaSalidaEn = ahora.toISOString();
  }
  async cerrarConversacion(tenantId: string, conversacionId: string): Promise<void> {
    const c = this.conversaciones.get(conversacionId);
    if (!c || c.tenantId !== tenantId) return;
    c.estado = 'cerrada'; c.sinRespuestaDesde = null;
  }

  async evento(tenantId: string, e: NuevoEvento): Promise<boolean> {
    if (e.clave && this.eventos.some((x) => x.tenantId === tenantId && x.clave === e.clave)) return false;
    this.idEvento += 1;
    this.eventos.push({ ...e, tenantId, id: this.idEvento });
    return true;
  }
  async registrarOptOut(tenantId: string, contactoId: string, ahora: Date): Promise<void> {
    const c = this.contactos.get(contactoId);
    if (!c || c.tenantId !== tenantId) return;
    c.estado = 'baja'; c.optoutEn = ahora.toISOString();
  }
  async marcarAvisoPrivacidad(tenantId: string, contactoId: string, ahora: Date): Promise<void> {
    const c = this.contactos.get(contactoId);
    if (!c || c.tenantId !== tenantId) return;
    if (!c.avisoPrivacidadEn) c.avisoPrivacidadEn = ahora.toISOString();
  }
  async destinatarioNivel(tenantId: string, _contacto: Contacto, nivel: 1 | 2): Promise<Destinatario | null> {
    return this.destinatarios.get(`${tenantId}|${nivel}`) ?? null;
  }

  async conversacionesEnEspera(limite: number, _ahora?: Date): Promise<FilaEnEspera[]> {
    this.verifica('conversacionesEnEspera');
    const filas: FilaEnEspera[] = [];
    for (const c of this.conversaciones.values()) {
      if (c.estado !== 'activa' || !c.sinRespuestaDesde) continue;
      const contacto = this.contactos.get(c.contactoId);
      const config = this.configs.get(c.tenantId);
      if (!contacto || !config?.habilitado) continue;
      filas.push({ conversacion: { ...c }, contacto: { ...contacto }, config: configParaCliente(config, this.criticos.has(`${c.tenantId}:${c.clienteId}`)) });
    }
    // Misma selección que la real: sin el nivel 2 y por próximo vencimiento (no por orden de inserción).
    return seleccionarEnEspera(filas, limite);
  }
  async expirarCiclosInactivos(antesDe: Date, limite: number, ahora: Date): Promise<Array<{ tenantId: string; id: string }>> {
    this.verifica('expirarCiclosInactivos');
    const cerradas: Array<{ tenantId: string; id: string }> = [];
    for (const c of this.conversaciones.values()) {
      if (cerradas.length >= limite) break;
      if (c.estado !== 'activa' || !c.sinRespuestaDesde || Date.parse(c.sinRespuestaDesde) >= antesDe.getTime()) continue;
      c.estado = 'cerrada'; c.sinRespuestaDesde = null;
      cerradas.push({ tenantId: c.tenantId, id: c.id });
    }
    void ahora;
    return cerradas;
  }
  async aprobadosAtorados(antesDe: Date, limite: number): Promise<Array<{ tenantId: string; id: string }>> {
    return this.salientes().filter((m) => m.estado === 'aprobado' && Date.parse(m.createdAt) < antesDe.getTime()).slice(0, limite).map((m) => ({ tenantId: m.tenantId, id: m.id }));
  }
  async purgar(): Promise<number> { this.purgas += 1; return 0; }
}

/** Un escenario base: flota T1 con el agente encendido, un contacto con un viaje en curso y un gerente. */
export function escenario(extra: Partial<ConfigVigia> = {}) {
  const repo = new RepoEnMemoria();
  repo.habilitar(T1, extra);
  const contacto = repo.agregarContacto({ tenantId: T1, clienteId: CLIENTE_A, telefono: '525511110001' });
  repo.destinatario(T1, 1, { userId: 'u-gerente', telefono: '525599999999' });
  repo.destinatario(T1, 2, { userId: 'u-dueno', telefono: '525588888888' });
  return { repo, contacto };
}
