// Doble en memoria de `SalidaTms` para pruebas. Datos sintéticos, sin red.
import type { EntradaCarga, ResultadoCarga, SalidaTms } from './tms_puerto';

export type ModoTmsFalso = 'ok' | 'reque_inexistente' | 'validacion' | 'auth' | 'transitorio' | 'lento' | 'duplicado';

export interface TmsFalso extends SalidaTms {
  readonly llamadas: EntradaCarga[];
}

const fallo = (
  clase: Extract<ResultadoCarga, { ok: false }>['clase'],
  mensajeLlano: string,
  extra: Partial<Extract<ResultadoCarga, { ok: false }>> = {},
): ResultadoCarga => ({ ok: false, clase, mensajeLlano, errores: [], ...extra });

export function crearTmsFalso(modo: ModoTmsFalso = 'ok', opciones: { lentoMs?: number } = {}): TmsFalso {
  const llamadas: EntradaCarga[] = [];
  const vistas = new Map<string, string>();
  return {
    llamadas,
    async cargarPlantilla(e, signal) {
      llamadas.push(e);
      switch (modo) {
        case 'ok':
          return { ok: true, referencia: `REF-${llamadas.length}`, duplicado: false };
        case 'reque_inexistente':
          return fallo('reque_inexistente', 'El requerimiento no existe en el sistema del cliente.');
        case 'validacion':
          return fallo('validacion', 'El sistema rechazó filas de la plantilla.', {
            errores: [
              { hoja: 'Hoja1', fila: 3, campo: 'peso', detalle: 'valor no numérico' },
              { hoja: 'Hoja1', fila: 5, campo: 'claveProdServ', detalle: 'clave fuera del catálogo' },
            ],
          });
        case 'auth':
          return fallo('auth', 'Las credenciales del sistema del cliente no son válidas.');
        case 'transitorio':
          return fallo('transitorio', 'El sistema del cliente no respondió; se reintentará.', { reintentarEnMs: 30_000 });
        case 'lento': {
          const ms = opciones.lentoMs ?? 50;
          await new Promise<void>((resolve, reject) => {
            const t = setTimeout(resolve, ms);
            signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('abortado')); });
          });
          return { ok: true, referencia: `REF-${llamadas.length}`, duplicado: false };
        }
        case 'duplicado': {
          const huella = `${e.nombre}:${e.archivo.length}`;
          const previa = vistas.get(e.idempotencyKey);
          if (previa === undefined) {
            vistas.set(e.idempotencyKey, huella);
            return { ok: true, referencia: `REF-${vistas.size}`, duplicado: false };
          }
          if (previa === huella) return { ok: true, referencia: `REF-${vistas.size}`, duplicado: true };
          return fallo('duplicado_distinto', 'Ya se recibió otra carga con la misma llave y contenido distinto.');
        }
      }
    },
  };
}
