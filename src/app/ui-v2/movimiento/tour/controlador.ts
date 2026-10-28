import { borrarGuardado, guardar, leerGuardado } from './persistencia';
import type { Anfitrion, ElementoTour, Fase, Instantanea, PasoTour, Recorrido } from './tipos';

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
    if (this.indice >= this.pasos.length - 1) { this.terminar(); return; }
    this.ir(this.indice + 1);
  }
  atras(): void {
    if (this.fase !== 'activo' || this.indice === 0) return;
    this.ir(this.indice - 1);
  }
  saltar(): void {
    if (this.fase !== 'activo') return;
    this.cerrar('omitido');
    this.persistir('omitido');
  }
  masTarde(): void {
    if (this.fase !== 'activo') return;
    this.persistir('en_curso');
    this.cerrar('inactivo');
  }
  terminar(): void {
    if (this.fase !== 'activo') return;
    this.cerrar('terminado');
    this.persistir('terminado');
  }
  /** «Ver recorrido» otra vez: olvida lo guardado. */
  reiniciar(): void {
    if (!this.op.soloLectura) borrarGuardado(this.host.almacen, this.op.ambito, this.recorrido.id);
    this.iniciar(0);
  }
  destruir(): void {
    this.gen++;
    this.soltar();
    this.oyentes.clear();
  }

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
    this.persistir('en_curso');
    const paso = this.pasos[i];
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
    const limite = this.op.esperaAnclaMs ?? 4000;
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
    const av = paso.avance;
    if (!av || av.tipo !== 'accion') return;
    const objetivo = av.ancla ? this.host.buscarAncla(av.ancla) : el;
    if (!objetivo) return;
    const g = this.gen;
    this.limpiezas.push(objetivo.escuchar(av.evento, () => {
      // Se espera un instante para que la página procese su propia acción primero.
      this.host.programar(() => { if (g === this.gen) this.siguiente(); }, 0);
    }));
  }

  private soltar(): void {
    for (const l of this.limpiezas.splice(0)) l();
  }

  private cerrar(fase: Fase): void {
    this.gen++;
    this.soltar();
    this.elemento = null;
    this.navegando = false;
    this.fase = fase;
    this.notificar();
  }

  private persistir(estado: 'en_curso' | 'omitido' | 'terminado'): void {
    if (this.op.soloLectura) return;
    guardar(this.host.almacen, this.op.ambito, { ...this.recorrido, pasos: this.pasos }, estado, this.indice);
  }

  private calcular(): Instantanea {
    return {
      fase: this.fase,
      indice: this.indice,
      total: this.pasos.length,
      paso: this.fase === 'activo' ? this.pasos[this.indice] ?? null : null,
      anclaLista: this.anclaLista,
      navegando: this.navegando,
      reducirMovimiento: this.host.reducirMovimiento(),
      esPrimero: this.indice === 0,
      esUltimo: this.indice === this.pasos.length - 1,
    };
  }

  private notificar(): void {
    this.snap = this.calcular();
    for (const o of [...this.oyentes]) o();
  }
}
