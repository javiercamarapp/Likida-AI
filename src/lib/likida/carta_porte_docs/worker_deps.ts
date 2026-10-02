// Los puertos REALES del worker de la bandeja (cron `carta-porte-docs`): Supabase por `repo.ts`, el modelo por
// `procesarDocumento` y WhatsApp por `avisarOficina` (texto → plantilla, con el outbox para lo reintentable).
// Aparte de `worker.ts` para que el motor se pruebe sin cargar nada de eso.

import { avisarOficina } from '@/lib/meta/aviso_oficina';
import { telefonoJefeDe } from '../contactos';
import * as repo from './repo';
import { procesarDocumento, type DepsServicio } from './servicio';
import type { DepsWorker } from './worker';

/** `servicio` solo lo usan las pruebas (un extractor de guion); en producción va vacío y se usa el modelo real. */
export function depsWorkerReales(servicio: DepsServicio = {}): DepsWorker {
  return {
    pendientes: (limite) => repo.documentosPendientes(limite),
    procesar: (tenantId, id, signal) => procesarDocumento(tenantId, id, { ...servicio, signal }),
    agotados: (limite) => repo.documentosAgotados(limite),
    porAvisar: (umbral, limite) => repo.documentosPorAvisar(umbral, limite),
    leer: (tenantId, id) => repo.leerDocumento(tenantId, id),
    reclamarAviso: repo.reclamarAvisoDoc,
    liberarAviso: repo.liberarAvisoDoc,
    telefonoOficina: telefonoJefeDe,
    avisar: (telefono, texto, parametros, contexto) => avisarOficina(telefono, texto, { parametros, contexto }),
    evento: (tenantId, id, tipo, detalle) => repo.registrarEvento(tenantId, id, tipo, null, detalle),
    ahora: () => Date.now(),
    senal: (ms) => AbortSignal.timeout(ms),
  };
}
