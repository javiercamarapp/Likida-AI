// ═══════════════════════════════════════════════════════════════════════════
// EL PATIO DE CADA FILA DE UN ARCHIVO (W2 «producto»).
//
// Las plantillas de operadores y unidades traen la columna «patio». Un archivo
// de 250 camiones dice «Patio Norte» en 80 renglones y «patio norte » en otros
// 10 — con las mismas reglas que la base (`uq_terminal_tenant_nombre`: minúsculas
// y sin espacios sobrantes, 0298) esos 90 son UN patio.
//
// LO QUE ESTO NO HACE: no crea patios. Un nombre que no existe en la flota NO se
// inventa: se descarta esa fila diciendo cuál es el patio y dónde se crea —un
// error de dedo («Patio Nrte») no se convierte en un patio nuevo con 12 camiones.
//
// ALCANCE DE PATIO. Un jefe con patio asignado solo carga lo de su patio: sus
// filas SIN patio caen en el suyo, las que nombran el suyo pasan, y las que
// nombran OTRO patio se descartan. Con la flota entera, sin patio = sin patio.
//
// PURA: la lista de patios la trae quien llama (`getTerminales`).
// ═══════════════════════════════════════════════════════════════════════════

import type { AlcancePatio } from '@/lib/auth/patio';
import type { Terminal } from '../terminales';
import type { Descartada } from './archivo';

/** La llave que compara la base: minúsculas, sin acentos de más ni espacios
 *  repetidos. La base compara `lower(btrim(nombre))`; aquí además se colapsan los
 *  espacios internos (que el alta ya colapsa al guardar). */
export function llavePatio(nombre: string): string {
  return nombre.replace(/\s+/g, ' ').trim().toLowerCase();
}

export interface FilaConPatio { fila: number; patio?: string | null }

export interface ResultadoPatios<T extends FilaConPatio> {
  /** Las filas con `terminalId` ya puesto (uuid del patio o null). */
  filas: Array<T & { terminalId: string | null }>;
  descartadas: Descartada[];
  /** Los nombres de patio que el archivo trae y la flota no tiene (sin repetir),
   *  para decir «créalos en Patios» una vez y no 90 veces. */
  patiosDesconocidos: string[];
}

export function asignarPatios<T extends FilaConPatio>(
  filas: readonly T[],
  patios: readonly Terminal[],
  alcance: AlcancePatio,
): ResultadoPatios<T> {
  const porLlave = new Map(patios.map((p) => [llavePatio(p.nombre), p] as const));
  const salida: Array<T & { terminalId: string | null }> = [];
  const descartadas: Descartada[] = [];
  const desconocidos = new Map<string, string>();

  for (const f of filas) {
    const crudo = (f.patio ?? '').trim();

    if (alcance.tipo === 'patio') {
      const suyo = patios.find((p) => p.id === alcance.terminalId);
      if (crudo === '') { salida.push({ ...f, terminalId: alcance.terminalId }); continue; }
      const nombrado = porLlave.get(llavePatio(crudo));
      if (nombrado && nombrado.id === alcance.terminalId) { salida.push({ ...f, terminalId: alcance.terminalId }); continue; }
      descartadas.push({
        fila: f.fila,
        motivo: nombrado
          ? `el patio «${nombrado.nombre}» no es el tuyo${suyo ? ` («${suyo.nombre}»)` : ''}: tu carga solo puede ser de tu patio`
          : `el patio «${crudo}» no existe en tu flota y tu carga solo puede ser de tu patio`,
      });
      continue;
    }

    if (crudo === '') { salida.push({ ...f, terminalId: null }); continue; }
    const p = porLlave.get(llavePatio(crudo));
    if (p) { salida.push({ ...f, terminalId: p.id }); continue; }
    const llave = llavePatio(crudo);
    if (!desconocidos.has(llave)) desconocidos.set(llave, crudo);
    descartadas.push({
      fila: f.fila,
      motivo: `el patio «${crudo}» no existe en tu flota. Créalo en Patios o corrige el nombre del archivo`,
    });
  }
  return { filas: salida, descartadas, patiosDesconocidos: [...desconocidos.values()] };
}
