import { vi } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// EL DOBLE DE META (WhatsApp) para las pruebas de punta a punta. Vive APARTE del «mundo» a propósito: los
// `vi.mock` de la prueba lo cargan DENTRO de su fábrica, y si estuviera junto al mundo (que importa el motor, que
// importa el selector, que importa el cliente mockeado) la carga se esperaría a sí misma — un interbloqueo.
// ═══════════════════════════════════════════════════════════════════════════

export interface SalienteWa {
  tipo: 'texto' | 'botones' | 'plantilla';
  /** Teléfono tal como se mandó. */
  a: string;
  cuerpo: string;
  botones: string[];
  plantilla: string | null;
  parametros: string[];
  botonesPlantilla: string[];
}

/** El doble de Meta: ventana de 24 h, plantillas aprobadas y fallos inyectables. Se arma una vez por archivo de prueba. */
export function crearMeta() {
  const salientes: SalienteWa[] = [];
  /** Último mensaje ENTRANTE por teléfono (la ventana de 24 h de Meta). */
  const ultimoEntrante = new Map<string, Date>();
  const estado = {
    reloj: new Date('2026-10-02T13:00:00.000Z'),
    /** Plantillas que Meta tiene aprobadas; `null` = todas. */
    aprobadas: null as Set<string> | null,
    /** Teléfonos a los que Meta rechaza con un código reintentable (429). */
    bloqueados: new Set<string>(),
    /** Si `true`, Meta ignora lo que cree nuestro registro y aplica SU ventana real. */
    ventanaRealEstricta: true,
    /** Lo que NUESTRO registro (wa_ventana_contacto) cree de la ventana, sin importar la de Meta: simula un registro viejo. */
    registroForzado: null as 'abierta' | 'cerrada' | 'desconocida' | null,
  };
  const norm = (t: string) => { const d = t.replace(/\D/g, ''); const m = /^521(\d{10})$/.exec(d); return m ? `52${m[1]}` : d; };
  const ventanaAbierta = (tel: string): boolean => {
    const u = ultimoEntrante.get(norm(tel));
    return Boolean(u) && u!.getTime() > estado.reloj.getTime() - 24 * 3_600_000;
  };
  const api = {
    salientes, ultimoEntrante, estado, norm, ventanaAbierta,
    /** El chofer (o el patio) escribe: abre la ventana. */
    entrante(tel: string, cuando: Date) { ultimoEntrante.set(norm(tel), cuando); },
    enviarTexto: vi.fn(async (a: string, cuerpo: string) => {
      if (estado.bloqueados.has(norm(a))) return { ok: false as const, error: 'rate limit', codigo: 130429, status: 429 };
      if (estado.ventanaRealEstricta && !ventanaAbierta(a)) return { ok: false as const, error: 'Re-engagement message', codigo: 131047, status: 400 };
      salientes.push({ tipo: 'texto', a, cuerpo, botones: [], plantilla: null, parametros: [], botonesPlantilla: [] });
      return { ok: true as const, id: `wamid.${salientes.length}` };
    }),
    enviarBotones: vi.fn(async (a: string, cuerpo: string, botones: Array<{ id: string; titulo: string }>) => {
      if (estado.bloqueados.has(norm(a))) return { ok: false as const, error: 'rate limit', codigo: 130429, status: 429 };
      if (estado.ventanaRealEstricta && !ventanaAbierta(a)) return { ok: false as const, error: 'Re-engagement message', codigo: 131047, status: 400 };
      salientes.push({ tipo: 'botones', a, cuerpo, botones: botones.map((b) => b.id), plantilla: null, parametros: [], botonesPlantilla: [] });
      return { ok: true as const, id: `wamid.${salientes.length}` };
    }),
    sendTemplate: vi.fn(async (a: string, nombre: string, op: { parametros?: string[]; botones?: Array<{ payload?: string }> } = {}) => {
      if (estado.bloqueados.has(norm(a))) return { ok: false as const, error: 'rate limit', codigo: 130429 };
      if (estado.aprobadas && !estado.aprobadas.has(nombre)) return { ok: false as const, error: 'plantilla no aprobada', codigo: 132001 };
      salientes.push({
        tipo: 'plantilla', a, cuerpo: '', botones: [], plantilla: nombre, parametros: op.parametros ?? [],
        botonesPlantilla: (op.botones ?? []).map((b) => String(b.payload ?? '')),
      });
      return { ok: true as const, id: `wamid.${salientes.length}` };
    }),
    reiniciar() { api.enviarTexto.mockClear(); api.enviarBotones.mockClear(); api.sendTemplate.mockClear(); salientes.length = 0; ultimoEntrante.clear(); estado.aprobadas = null; estado.bloqueados.clear(); estado.registroForzado = null; estado.ventanaRealEstricta = true; },
  };
  return api;
}
export type Meta = ReturnType<typeof crearMeta>;

/** UNA instancia por archivo de prueba: los `vi.mock` de la prueba la usan sin importar el orden de carga. */
export const meta = crearMeta();
