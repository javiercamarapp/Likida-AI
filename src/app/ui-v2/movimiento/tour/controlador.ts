import { borrarGuardado, guardar, leerGuardado } from './persistencia';
import { AVANCE_TRAS_HECHO_MS, resolverBase, resolverSondeo, retardoDeSondeo, TIEMPO_LIMITE_POR_OMISION_MS } from './espera';
import type { Anfitrion, Avance, ElementoTour, EstadoEspera, EventoControlador, Fase, Instantanea, LecturaSenal, PasoTour, Recorrido } from './tipos';

// ═══════════════════════════════════════════════════════════════════════════
// CONTROLADOR DEL RECORRIDO. Máquina de estados sin React ni DOM.
//
//  · NUNCA se inicia solo: `iniciar()`/`reanudar()` los llama una persona.
//  · NAVEGA por la persona solo DESPUÉS de que ella avanza (Siguiente o la
//    acción pedida) y solo a la ruta del paso; nunca al abrir ni de fondo.
//  · «Saltar» siempre disponible; guarda `omitido`. «Más tarde» guarda
//    `en_curso` para reanudar donde se quedó.
//  · Los pasos con `ruta` que la persona no puede ver (puedeVerRuta) se quitan
//    al construir: un encargado no recibe paradas de dinero.
//  · soloLectura (superadmin «viendo como») no escribe progreso.
// ═══════════════════════════════════════════════════════════════════════════

export interface OpcionesControlador {
  /** Aísla el progreso por usuario/tenant en el mismo navegador. */
  ambito: string;
  soloLectura?: boolean;
  puedeVerRuta?: (ruta: string) => boolean;
  /** Cuánto esperar a que aparezca el ancla tras llegar (ms). */
  esperaAnclaMs?: number;
  /** Aviso de cada hecho de aprendizaje (visto, hecho por señal, confirmado, ya hecho, omitido, sin dato). Sin PII: solo el id del paso. */
  alEvento?: (e: EventoControlador) => void;
}

export const rutaCoincide = (actual: string, objetivo: string): boolean => {
  const n = (s: string) => (s.length > 1 ? s.replace(/\/+$/, '') : s);
  const a = n(actual.split('?')[0]);
  if (objetivo.endsWith('*')) return a.startsWith(n(objetivo.slice(0, -1)));
  return a === n(objetivo);
};

export class ControladorTour {
  readonly recorrido: Recorrido;
  private readonly pasos: PasoTour[];
  private fase: Fase = 'inactivo';
  private indice = 0;
  private elemento: ElementoTour | null = null;
  private anclaLista: boolean | null = null;
  private navegando = false;
  private oyentes = new Set<() => void>();
  private limpiezas: Array<() => void> = [];
  private snap: Instantanea;
  /** Se invalida en cada cambio de paso: las esperas viejas no hacen nada. */
  private gen = 0;
  // ── pasos `hacer`/`practicar` ──
  private espera: EstadoEspera | null = null;
  private base: LecturaSenal | null = null;
  private intento = 0;
  private readonly hechos = new Set<string>();
  private readonly confirmados = new Set<string>();
  private readonly omitidos = new Set<string>();

  constructor(
    recorrido: Recorrido,
    private readonly host: Anfitrion,
    private readonly op: OpcionesControlador,
  ) {
    this.recorrido = recorrido;
    this.pasos = recorrido.pasos.filter((p) => !p.ruta || !op.puedeVerRuta || op.puedeVerRuta(p.ruta));
    this.snap = this.calcular();
  }

  // ── lectura ───────────────────────────────────────────────────────────
  get total() { return this.pasos.length; }
  get elementoActual() { return this.elemento; }
  instantanea(): Instantanea { return this.snap; }
  suscribir(fn: () => void): () => void {
    this.oyentes.add(fn);
    return () => { this.oyentes.delete(fn); };
  }
  /** Progreso guardado para ofrecer «Reanudar» (null si no hay o está al día). */
  progreso() {
    const g = leerGuardado(this.host.almacen, this.op.ambito, { ...this.recorrido, pasos: this.pasos });
    return g;
  }

  // ── acciones de la persona ────────────────────────────────────────────
  iniciar(desde = 0): void {
    if (this.pasos.length === 0) return;
    this.fase = 'activo';
    this.ir(Math.min(Math.max(desde, 0), this.pasos.length - 1));
  }
  reanudar(): void {
    const g = this.progreso();
    this.iniciar(g && g.estado === 'en_curso' ? g.indice : 0);
  }
  siguiente(): void {
    if (this.fase !== 'activo') return;
    this.cerrarPasoActual();
    if (this.indice >= this.pasos.length - 1) { this.terminar(); return; }
    this.ir(this.indice + 1);
  }
  atras(): void {
    if (this.fase !== 'activo' || this.indice === 0) return;
    this.ir(this.indice - 1);
  }
  saltar(): void {
    if (this.fase !== 'activo') return;
    // Se guarda ANTES de cerrar: `cerrar` avisa a los lanzadores y estos releen lo guardado; al revés se quedaban
    // con «en curso» (un recorrido terminado ofrecía «Reanudar (paso 12 de 12)»).
    this.persistir('omitido');
    this.cerrar('omitido');
  }
  masTarde(): void {
    if (this.fase !== 'activo') return;
    this.persistir('en_curso');
    this.cerrar('inactivo');
  }
  terminar(): void {
    if (this.fase !== 'activo') return;
    this.cerrarPasoActual();
    this.persistir('terminado'); // antes de cerrar: ver el comentario en saltar()
    this.cerrar('terminado');
  }
  /** «Ver recorrido» otra vez: olvida lo guardado. */
  reiniciar(): void {
    if (!this.op.soloLectura) borrarGuardado(this.host.almacen, this.op.ambito, this.recorrido.id);
    this.iniciar(0);
  }
  /** «Ya lo hice»: solo cuando el paso lo permite (tiempo agotado, señal ilegible o acción que no se puede medir). Queda `confirmado por ti`, nunca medido. */
  declarar(): void {
    if (this.fase !== 'activo' || !this.espera || !this.espera.declarable) return;
    if (this.espera.estado === 'hecho' || this.espera.estado === 'ya_hecho') return;
    this.marcarHecho('confirmado');
  }
  /** Relee la señal una vez (al volver el foco a la pestaña o tras una acción de la persona sobre el ancla). No crea otro temporizador. */
  sondear(): void {
    const paso = this.pasos[this.indice];
    if (this.fase !== 'activo' || !this.espera || !paso?.deteccion || paso.deteccion.via !== 'senal') return;
    if (this.espera.estado !== 'esperando' && !(this.espera.estado === 'sin_dato' && this.base)) return;
    const g = this.gen;
    this.armarLimite(g, paso);
    void this.leerYResolver(g, paso.deteccion.senal, paso.deteccion.modo);
  }
  /** Lo que la persona logró en este recorrido (para guardar el avance en servidor). */
  resultados() {
    return { hechos: [...this.hechos], confirmados: [...this.confirmados], omitidos: [...this.omitidos] };
  }
  destruir(): void {
    this.gen++;
    this.soltar();
    this.oyentes.clear();
  }

  /** Salta al primer paso de una pantalla (menú «Saltar a una pantalla»). Abre el recorrido si estaba cerrado. */
  irAPantalla(href: string): void {
    const i = this.pasos.findIndex((p) => p.pantalla === href);
    if (i < 0) return;
    if (this.fase !== 'activo') { this.fase = 'activo'; }
    this.ir(i);
  }
  /** Pantallas del recorrido (para el menú «Saltar a una pantalla»). */
  pantallas(): Array<{ href: string; nombre: string }> {
    const sal: Array<{ href: string; nombre: string }> = [];
    for (const p of this.pasos) if (p.pantalla && !sal.some((s) => s.href === p.pantalla)) sal.push({ href: p.pantalla, nombre: p.nombrePantalla ?? p.pantalla });
    return sal;
  }
  /** Id del paso en que quedó (para «Retomar donde lo dejé»). */
  get indiceActual() { return this.indice; }

  /** La página avisa que cambió la ruta (usePathname). */
  alCambiarRuta(): void {
    if (this.fase !== 'activo' || !this.navegando) return;
    const paso = this.pasos[this.indice];
    if (paso.ruta && rutaCoincide(this.host.rutaActual(), paso.ruta)) {
      this.navegando = false;
      this.buscar(this.gen);
    }
  }

  // ── internos ──────────────────────────────────────────────────────────
  private ir(i: number): void {
    this.gen++;
    this.soltar();
    this.indice = i;
    this.elemento = null;
    this.anclaLista = null;
    this.navegando = false;
    this.espera = null;
    this.base = null;
    this.intento = 0;
    this.persistir('en_curso');
    const paso = this.pasos[i];
    this.emitir('paso_visto', paso.id);
    if (paso.ruta && !rutaCoincide(this.host.rutaActual(), paso.ruta)) {
      this.navegando = true;
      this.notificar();
      const g = this.gen;
      this.host.navegar(paso.ruta);
      // Seguro: si la ruta nunca confirma, se busca igual (paso centrado si no hay ancla).
      this.limpiezas.push(this.host.programar(() => {
        if (g === this.gen && this.navegando) { this.navegando = false; this.buscar(g); }
      }, (this.op.esperaAnclaMs ?? 4000)));
      return;
    }
    this.buscar(this.gen);
  }

  private buscar(g: number): void {
    const paso = this.pasos[this.indice];
    if (!paso.ancla) {
      this.anclaLista = true; // paso centrado: nada que resaltar
      this.armarAvance(paso, null);
      this.notificar();
      return;
    }
    // Un salto de menú que no se ve (celular: el menú está plegado) no espera 4 s: la tarjeta ya explica cómo ir.
    const limite = paso.tipo === 'ir' ? Math.min(900, this.op.esperaAnclaMs ?? 4000) : (this.op.esperaAnclaMs ?? 4000);
    let esperado = 0;
    const intentar = () => {
      if (g !== this.gen) return;
      const el = this.host.buscarAncla(paso.ancla!);
      if (el && el.visible()) {
        this.elemento = el;
        this.anclaLista = true;
        el.traerAVista(this.host.reducirMovimiento());
        this.armarAvance(paso, el);
        this.notificar();
        return;
      }
      if (esperado >= limite) {
        this.anclaLista = false; // degradado: globo centrado, sigue guiado por texto
        this.armarAvance(paso, null);
        this.notificar();
        return;
      }
      esperado += 150;
      this.limpiezas.push(this.host.programar(intentar, 150));
    };
    this.notificar();
    intentar();
  }

  private armarAvance(paso: PasoTour, el: ElementoTour | null): void {
    this.armarEspera(paso);
    const dom = paso.deteccion?.via === 'dom' ? paso.deteccion : null;
    const av: Avance | undefined = paso.avance ?? (dom ? { tipo: 'accion', evento: dom.evento, ancla: dom.ancla } : undefined);
    if (!av || av.tipo !== 'accion') return;
    const objetivo = av.ancla ? this.host.buscarAncla(av.ancla) : el;
    if (!objetivo) return;
    const g = this.gen;
    this.limpiezas.push(objetivo.escuchar(av.evento, () => {
      // Se espera un instante para que la página procese su propia acción primero.
      this.host.programar(() => { if (g === this.gen) this.siguiente(); }, 0);
    }));
  }

  // ── espera de una acción real (pasos `hacer`/`practicar`) ─────────────────
  private armarEspera(paso: PasoTour): void {
    if ((paso.tipo !== 'hacer' && paso.tipo !== 'practicar') || !paso.deteccion || this.espera) return;
    const d = paso.deteccion;
    if (d.via === 'declarada') { this.espera = { estado: 'esperando', evidencia: null, declarable: true }; return; }
    if (d.via !== 'senal') return;
    if (!this.host.leerSenal) {
      this.espera = { estado: 'sin_dato', evidencia: null, declarable: true };
      this.emitir('paso_sin_dato', paso.id);
      return;
    }
    this.espera = { estado: 'leyendo', evidencia: null, declarable: false };
    const g = this.gen;
    void this.leer(d.senal).then((base) => {
      if (g !== this.gen || this.espera?.estado !== 'leyendo') return;
      this.base = base;
      const r = resolverBase(base);
      if (r === 'ya_hecho') {
        this.espera = { estado: 'ya_hecho', evidencia: 'medido', declarable: false };
        this.hechos.add(paso.id);
        this.emitir('paso_ya_hecho', paso.id);
      } else if (r === 'sin_dato') {
        this.espera = { estado: 'sin_dato', evidencia: null, declarable: true };
        this.emitir('paso_sin_dato', paso.id);
      } else {
        this.espera = { estado: 'esperando', evidencia: null, declarable: false };
        this.armarLimite(g, paso);
        this.programarSondeo(g, d.senal, d.modo);
      }
      this.notificar();
    });
  }

  private async leer(id: string): Promise<LecturaSenal> {
    try { return (await this.host.leerSenal?.(id)) ?? { estado: 'sin_dato' }; } catch { return { estado: 'sin_dato' }; }
  }

  /** Una lectura y su resolución. Devuelve true si el paso quedó hecho. */
  private async leerYResolver(g: number, senal: string, modo: 'cambia' | 'existe'): Promise<boolean> {
    const ahora = await this.leer(senal);
    if (g !== this.gen || !this.base || !this.espera) return false;
    if (this.espera.estado !== 'esperando' && this.espera.estado !== 'sin_dato') return false;
    if (resolverSondeo(this.base, ahora, modo) !== 'hecho') return false;
    this.marcarHecho('medido');
    return true;
  }

  /** Sondeo a 3, 6 y 10 s y luego cada 15 s; termina solo cuando el paso deja de esperar (nunca un intervalo perpetuo). */
  private programarSondeo(g: number, senal: string, modo: 'cambia' | 'existe'): void {
    this.limpiezas.push(this.host.programar(() => {
      if (g !== this.gen || this.espera?.estado !== 'esperando') return;
      void this.leerYResolver(g, senal, modo).then((hecho) => {
        if (!hecho && g === this.gen && this.espera?.estado === 'esperando') this.programarSondeo(g, senal, modo);
      });
    }, retardoDeSondeo(this.intento++)));
  }

  private cancelarLimite: (() => void) | null = null;
  private armarLimite(g: number, paso: PasoTour): void {
    this.cancelarLimite?.();
    const cancelar = this.host.programar(() => {
      if (g !== this.gen || this.espera?.estado !== 'esperando') return;
      this.espera = { estado: 'sin_dato', evidencia: null, declarable: true };
      this.emitir('paso_sin_dato', paso.id);
      this.notificar();
    }, paso.tiempoLimiteMs ?? TIEMPO_LIMITE_POR_OMISION_MS);
    this.cancelarLimite = cancelar;
    this.limpiezas.push(cancelar);
  }

  private marcarHecho(evidencia: 'medido' | 'confirmado'): void {
    const paso = this.pasos[this.indice];
    if (!paso) return;
    this.espera = { estado: 'hecho', evidencia, declarable: false };
    (evidencia === 'medido' ? this.hechos : this.confirmados).add(paso.id);
    this.emitir(evidencia === 'medido' ? 'paso_hecho_senal' : 'paso_hecho_confirmado', paso.id);
    this.notificar();
    const g = this.gen;
    // La etiqueta pasa a «Hecho» y el paso avanza solo tras un instante.
    this.limpiezas.push(this.host.programar(() => { if (g === this.gen) this.siguiente(); }, AVANCE_TRAS_HECHO_MS));
  }

  /** Quien avanza antes de que se cumpla un paso `hacer` lo deja `omitido`: no cuenta como aprendido. */
  private cerrarPasoActual(): void {
    const paso = this.pasos[this.indice];
    if (!paso || (paso.tipo !== 'hacer' && paso.tipo !== 'practicar') || !this.espera) return;
    if (this.espera.estado === 'hecho' || this.espera.estado === 'ya_hecho') return;
    this.omitidos.add(paso.id);
    this.emitir('paso_omitido', paso.id);
  }

  private emitir(tipo: EventoControlador['tipo'], pasoId: string): void {
    if (this.op.soloLectura) return;
    try { this.op.alEvento?.({ tipo, pasoId, ms: null }); } catch { /* la medición nunca rompe el recorrido */ }
  }

  private soltar(): void {
    this.cancelarLimite = null;
    for (const l of this.limpiezas.splice(0)) l();
  }

  private cerrar(fase: Fase): void {
    this.gen++;
    this.soltar();
    this.elemento = null;
    this.navegando = false;
    this.espera = null;
    this.fase = fase;
    this.notificar();
  }

  private persistir(estado: 'en_curso' | 'omitido' | 'terminado'): void {
    if (this.op.soloLectura) return;
    guardar(this.host.almacen, this.op.ambito, { ...this.recorrido, pasos: this.pasos }, estado, this.indice);
  }

  private calcular(): Instantanea {
    const pant = this.pantallas();
    const actual = this.pasos[this.indice];
    const contados = this.pasos.filter((p) => p.tipo !== 'ir');
    const antes = this.pasos.slice(0, this.indice + 1).filter((p) => p.tipo !== 'ir').length;
    return {
      pasoTotal: Math.max(1, contados.length),
      // En un salto de menú se muestra el número del paso al que se va (no se cuenta, pero tampoco retrocede).
      pasoN: Math.max(1, antes + (actual?.tipo === 'ir' ? 1 : 0)),
      grupo: actual?.pantalla ? Math.max(0, pant.findIndex((x) => x.href === actual.pantalla)) : pant.length,
      grupoTotal: pant.length,
      pantallas: pant,
      fase: this.fase,
      indice: this.indice,
      total: this.pasos.length,
      paso: this.fase === 'activo' ? this.pasos[this.indice] ?? null : null,
      anclaLista: this.anclaLista,
      navegando: this.navegando,
      reducirMovimiento: this.host.reducirMovimiento(),
      esPrimero: this.indice === 0,
      esUltimo: this.indice === this.pasos.length - 1,
      ...(this.fase === 'activo' && this.espera ? { espera: this.espera } : {}),
    };
  }

  private notificar(): void {
    this.snap = this.calcular();
    for (const o of [...this.oyentes]) o();
  }
}
