// ═══════════════════════════════════════════════════════════════════════════
// LIBERAR EL ENVÍO DE UN DESGLOSE RETENIDO (T-A1-29).
//
// Una guarda previa al envío (neto negativo, tipo de operador sin regla) deja el desglose guardado SIN entregas y con una
// excepción abierta (`desglose_recibir.ts`). Aquí una persona que administra la flota decide mandarlo de todos modos:
//
//   · Solo `puedeAdministrar`; el actor queda en el evento de auditoría.
//   · Solo se liberan las retenciones que una persona puede decidir (`neto_negativo`, `tipo_sin_regla`). Un concepto
//     prohibido o la falta de póliza NO se liberan desde aquí: son datos que hay que corregir en el origen.
//   · Idempotente: sin retención vigente ⇒ rechazo llano y NO se crea nada (dos clics no duplican un pago; además el índice
//     único de las entregas absorbe la carrera). Si una liberación anterior cayó a medias (hay entregas pero sigue
//     retenido), se completa sin volver a insertar.
//   · El archivo es el que `recibirDesglose` ya subió (ruta direccionada por contenido: clave + huella).
//   · Orden de escritura: primero las entregas, luego se quita la retención y se resuelven sus excepciones.
// ═══════════════════════════════════════════════════════════════════════════

import { puedeAdministrar } from '@/lib/auth/permisos';
import { leerPorId, registrarEvento, type LiquidacionExterna, type TipoEvento } from './repo';
import {
  entregasDe, insertarEntregas, leerConfigCorreo, leerContactoOperador, leerDesglose, liberarRetencionDesglose,
  listarCoordinadores, listarExcepciones, resolverExcepcion, rutaXlsxDesglose,
  type ConfigCorreo, type ContactoOperador, type Coordinador, type Desglose, type EntregaCorreo, type Excepcion, type NuevaEntrega,
} from './repo_correo';
import { resolverDestinatarios } from './correo_destinatarios';

/** Las retenciones que una persona puede decidir enviar. */
export const TIPOS_LIBERABLES = ['neto_negativo', 'tipo_sin_regla'] as const;
const TIPOS_RETENCION = ['neto_negativo', 'tipo_sin_regla', 'concepto_prohibido'] as const;

export type MotivoRechazoLiberar =
  | 'sin_permiso' | 'no_encontrada' | 'no_retenida' | 'no_liberable' | 'sin_destinatarios' | 'no_disponible';

export type ResultadoLiberar =
  | { estado: 'liberado'; entregas: number; roles: string[] }
  | { estado: 'rechazado'; motivo: MotivoRechazoLiberar; mensaje: string };

export interface DependenciasLiberar {
  leerLiquidacion: (tenantId: string, id: string) => Promise<LiquidacionExterna | null>;
  /** `null` = no se pudo leer; `{ desglose: null }` = no hay encabezado. */
  leerDesglose: (tenantId: string, id: string) => Promise<{ desglose: Desglose | null } | null>;
  leerConfig: (tenantId: string) => Promise<ConfigCorreo | null>;
  leerContacto: (tenantId: string, operadorId: string) => Promise<ContactoOperador | null>;
  leerCoordinador: (tenantId: string, id: string) => Promise<Coordinador | null>;
  entregas: (tenantId: string, liquidacionId: string) => Promise<EntregaCorreo[] | null>;
  excepcionesAbiertas: (tenantId: string, claveExterna: string) => Promise<Excepcion[] | null>;
  insertarEntregas: (tenantId: string, filas: NuevaEntrega[]) => Promise<number>;
  liberarRetencion: (tenantId: string, liquidacionId: string) => Promise<boolean>;
  resolverExcepcion: (tenantId: string, id: number, ahora: Date) => Promise<boolean>;
  registrarEvento: (tenantId: string, liquidacionId: string, tipo: TipoEvento, detalle?: Record<string, unknown>) => Promise<void>;
  ahora: () => Date;
}

/** Función (no constante): las dependencias se arman al llamar, no al importar el módulo. */
export const dependenciasLiberarPorOmision = (): DependenciasLiberar => ({
  leerLiquidacion: leerPorId,
  leerDesglose: async (t, id) => { const l = await leerDesglose(t, id); return l.ok ? { desglose: l.valor } : null; },
  leerConfig: async (t) => { const l = await leerConfigCorreo(t); return l.ok ? l.valor : null; },
  leerContacto: async (t, id) => { const l = await leerContactoOperador(t, id); return l.ok ? l.valor : null; },
  leerCoordinador: async (t, id) => { const l = await listarCoordinadores(t); return l.ok ? (l.valor.find((c) => c.id === id) ?? null) : null; },
  entregas: async (t, id) => { const l = await entregasDe(t, id); return l.ok ? l.valor : null; },
  excepcionesAbiertas: async (t, clave) => { const l = await listarExcepciones(t, { clave, limite: 100 }); return l.ok ? l.valor : null; },
  insertarEntregas,
  liberarRetencion: liberarRetencionDesglose,
  resolverExcepcion,
  registrarEvento,
  ahora: () => new Date(),
});

const rechazo = (motivo: MotivoRechazoLiberar, mensaje: string): ResultadoLiberar => ({ estado: 'rechazado', motivo, mensaje });

export async function liberarEnvio(
  tenantId: string, liquidacionId: string, actor: { userId: string; rol: string },
  deps: DependenciasLiberar = dependenciasLiberarPorOmision(),
): Promise<ResultadoLiberar> {
  if (!puedeAdministrar(actor.rol)) return rechazo('sin_permiso', 'Solo quien administra la flota puede liberar un envío.');

  const liq = await deps.leerLiquidacion(tenantId, liquidacionId);
  if (!liq) return rechazo('no_encontrada', 'No encontré ese desglose en tu flota.');

  const [cab, config, entregas, excepciones] = await Promise.all([
    deps.leerDesglose(tenantId, liquidacionId), deps.leerConfig(tenantId), deps.entregas(tenantId, liquidacionId),
    deps.excepcionesAbiertas(tenantId, liq.claveExterna),
  ]);
  if (!cab || !config || !entregas || !excepciones) {
    return rechazo('no_disponible', 'No pude leer el estado de este desglose. Intenta de nuevo en unos minutos.');
  }
  if (!cab.desglose) return rechazo('no_encontrada', 'No encontré ese desglose en tu flota.');
  if (!cab.desglose.retenidaMotivo) return rechazo('no_retenida', 'Este desglose ya no está retenido: no hay nada que liberar.');

  const retenciones = excepciones.filter((x) => (TIPOS_RETENCION as readonly string[]).includes(x.tipo));
  if (retenciones.some((x) => !(TIPOS_LIBERABLES as readonly string[]).includes(x.tipo))) {
    return rechazo('no_liberable', 'Este desglose trae un concepto que la empresa prohibió enviar: corrígelo en su sistema; no se libera desde aquí.');
  }

  let creadas = 0;
  let roles: string[] = [];
  if (entregas.length === 0) {
    const contacto = await deps.leerContacto(tenantId, liq.operadorId);
    const coordinador = contacto?.coordinadorId ? await deps.leerCoordinador(tenantId, contacto.coordinadorId) : null;
    const { destinos } = resolverDestinatarios({
      operador: { correo: contacto?.correo ?? null, rebotadoEn: contacto?.correoRebotadoEn ?? null },
      coordinador: coordinador ? { correo: coordinador.correo, activo: coordinador.activo } : null,
      config: {
        rhCorreos: config.rhCorreos, archivoCorreo: config.archivoCorreo,
        enviaCoordinador: config.enviaCoordinador, enviaRh: config.enviaRh,
      },
    });
    if (destinos.length === 0) return rechazo('sin_destinatarios', 'No hay a quién enviarlo: faltan los correos del operador, su coordinador y RH.');
    const xlsxRuta = rutaXlsxDesglose(tenantId, liq.claveExterna, liq.huella);
    creadas = await deps.insertarEntregas(tenantId, destinos.map((d) => ({
      liquidacionExternaId: liquidacionId, generacion: 1, rol: d.rol, correo: d.correo, xlsxRuta, xlsxSha256: null,
      disparo: 'manual' as const, pedidoPor: actor.userId,
    })));
    roles = destinos.map((d) => d.rol);
  }

  const quitada = await deps.liberarRetencion(tenantId, liquidacionId);
  if (!quitada) return rechazo('no_retenida', 'Este desglose ya no está retenido: no hay nada que liberar.');
  const ahora = deps.ahora();
  for (const x of retenciones) await deps.resolverExcepcion(tenantId, x.id, ahora);

  await deps.registrarEvento(tenantId, liquidacionId, 'reintento_manual', {
    canal: 'correo', accion: 'liberar_envio', actor: actor.userId, motivos: retenciones.map((x) => x.tipo), roles, entregas: creadas,
  });
  return { estado: 'liberado', entregas: creadas, roles };
}
