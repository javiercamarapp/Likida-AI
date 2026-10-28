import type { Almacen, Anfitrion, ElementoTour, EventoAccion, Rect } from './tipos';

/** Anfitrión de pruebas: reloj manual, elementos en memoria y almacén en un Map.
 *  Se exporta también para que los carriles A/C recorran SUS recorridos en
 *  vitest sin navegador (ver `recorrerTour` en las pruebas del motor). */
export class ElementoFalso implements ElementoTour {
  oyentes = new Map<EventoAccion, Set<() => void>>();
  enVista = 0;
  enfocado = 0;
  constructor(public r: Rect = { x: 100, y: 100, w: 120, h: 32 }, public estaVisible = true) {}
  rect() { return this.r; }
  visible() { return this.estaVisible; }
  traerAVista() { this.enVista++; }
  enfocar() { this.enfocado++; }
  escuchar(e: EventoAccion, fn: () => void) {
    if (!this.oyentes.has(e)) this.oyentes.set(e, new Set());
    this.oyentes.get(e)!.add(fn);
    return () => { this.oyentes.get(e)?.delete(fn); };
  }
  disparar(e: EventoAccion) { for (const f of [...(this.oyentes.get(e) ?? [])]) f(); }
  oyentesActivos() { let n = 0; for (const s of this.oyentes.values()) n += s.size; return n; }
}

export class AnfitrionFalso implements Anfitrion {
  anclas = new Map<string, ElementoFalso>();
  ruta = '/dashboard';
  destinos: string[] = [];
  reducido = false;
  datos = new Map<string, string>();
  ahora = 0;
  private cola: Array<{ en: number; fn: () => void; vivo: boolean }> = [];
  almacen: Almacen | null = {
    getItem: (k) => this.datos.get(k) ?? null,
    setItem: (k, v) => { this.datos.set(k, v); },
    removeItem: (k) => { this.datos.delete(k); },
  };
  buscarAncla(n: string) { return this.anclas.get(n) ?? null; }
  rutaActual() { return this.ruta; }
  navegar(r: string) { this.destinos.push(r); }
  reducirMovimiento() { return this.reducido; }
  programar(fn: () => void, ms: number) {
    const t = { en: this.ahora + ms, fn, vivo: true };
    this.cola.push(t);
    return () => { t.vivo = false; };
  }
  /** Avanza el reloj `ms` ejecutando lo vencido. */
  tic(ms: number) {
    const meta = this.ahora + ms;
    for (;;) {
      const sig = this.cola.filter((t) => t.vivo && t.en <= meta).sort((a, b) => a.en - b.en)[0];
      if (!sig) break;
      sig.vivo = false;
      this.ahora = Math.max(this.ahora, sig.en);
      sig.fn();
    }
    this.ahora = meta;
  }
  /** La página termina de navegar: cambia la ruta y avisa al controlador. */
  llegarA(ruta: string) { this.ruta = ruta; }
}
