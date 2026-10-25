// ═══════════════════════════════════════════════════════════════════════════
// REENVÍO MANUAL DEL DESGLOSE POR CORREO («reclamo del operador») — T-A1-20.
//
// «A veces sí me han dicho: operador, no me da mi desglose» (c3cc57d3 30:38): la oficina necesita volver a mandar el
// desglose de UNA bitácora, a quien lo pidió, sin tocar la base a mano.
//
// Reglas (cada una tiene su prueba):
//   · Solo quien administra la flota (`puedeAdministrar`).
//   · JAMÁS se reenvía a un rol cuya entrega anterior sigue `pendiente`/`enviando`: la impaciencia no duplica un pago.
//   · Una generación nueva ⇒ `Idempotency-Key` nueva (`llaveIdempotencia`) y filas nuevas con `disparo` `reclamo|manual`
//     y `pedido_por`; la cola de `entrega_correo.ts` las envía. Aquí NO se envía nada.
//   · `correoNuevo` (solo para el operador): se valida ANTES de escribir, se guarda en `operador.correo` y se limpia el
//     rebote (lo hace `guardarContactoOperador`).
//   · Tope: 5 reenvíos por desglose y por día de México.
//   · Siempre queda un evento de auditoría (`actor`, `motivo`). Sin cifras ni correos completos en el evento.
// ═══════════════════════════════════════════════════════════════════════════

import { puedeAdministrar } from '@/lib/auth/permisos';
import { leerPorId, registrarEvento, type LiquidacionExterna, type TipoEvento } from './repo';
import {
  entregasDe, guardarContactoOperador, insertarEntregas, leerConfigCorreo, leerContactoOperador, leerDesglose, listarCoordinadores, rutaXlsxDesglose,
  type ConfigCorreo, type ContactoOperador, type Coordinador, type EntregaCorreo, type NuevaEntrega,
} from './repo_correo';
import { resolverDestinatarios, type RolDestinatario } from './correo_destinatarios';
import { inicioVentanaHoy } from './entrega_correo';

/** Máximo de reenvíos por desglose y por día (hora de México). */
export const MAX_REENVIOS_POR_DIA = 5;
const FORMA_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export type DestinoReenvio = 'operador' | 'coordinador' | 'rh' | 'todos';
export type MotivoReenvio = 'reclamo' | 'correccion_de_correo' | 'manual';

export interface ActorReenvio { userId: string; rol: string }
export interface OpcionesReenvio {
  a: DestinoReenvio;
  correoNuevo?: string;
  actor: ActorReenvio;
  motivo: MotivoReenvio;
}

export type MotivoRechazo =
  | 'sin_permiso' | 'no_encontrada' | 'correo_invalido' | 'correo_nuevo_no_aplica' | 'en_curso' | 'limite_diario'
  | 'sin_destinatarios' | 'sin_archivo' | 'no_disponible';

export type ResultadoReenvio =
  | { estado: 'reenviado'; generacion: number; entregas: number; roles: RolDestinatario[]; avisos: string[] }
  | { estado: 'rechazado'; motivo: MotivoRechazo; mensaje: string };

export interface DependenciasReenvio {
  ahora: () => Date;
  leerLiquidacion: (tenantId: string, id: string) => Promise<LiquidacionExterna | null>;
  leerConfig: (tenantId: string) => Promise<ConfigCorreo | null>;
  leerContacto: (tenantId: string, operadorId: string) => Promise<ContactoOperador | null>;
  leerCoordinador: (tenantId: string, id: string) => Promise<Coordinador | null>;
  /** `null` = no se pudo leer (jamás se interpreta como «no hay entregas»). */
  entregas: (tenantId: string, liquidacionId: string) => Promise<EntregaCorreo[] | null>;
  guardarCorreoOperador: (tenantId: string, operadorId: string, correo: string) => Promise<void>;
  insertarEntregas: (tenantId: string, filas: NuevaEntrega[]) => Promise<number>;
  registrarEvento: (tenantId: string, liquidacionId: string, tipo: TipoEvento, detalle?: Record<string, unknown>) => Promise<void>;
  /**
   * A37-A1-liquidaciones-08: solo para el caso «la recepción no creó ninguna entrega». Encabezado del desglose: `null` = no se
   * pudo leer (jamás se interpreta como «no retenido»). Opcional: sin él, ese caso sigue siendo `sin_archivo` (fail-closed).
   */
  leerDesglose?: (tenantId: string, liquidacionId: string) => Promise<{ existe: boolean; retenidaMotivo: string | null } | null>;
  /** Ruta del Excel que la recepción ya subió (direccionada por clave + huella). */
  rutaXlsx?: (tenantId: string, claveExterna: string, huella: string) => string;
}

export const dependenciasReenvioPorOmision: DependenciasReenvio = {
  ahora: () => new Date(),
  leerLiquidacion: leerPorId,
  leerConfig: async (t) => { const l = await leerConfigCorreo(t); return l.ok ? l.valor : null; },
  leerContacto: async (t, id) => { const l = await leerContactoOperador(t, id); return l.ok ? l.valor : null; },
  leerCoordinador: async (t, id) => { const l = await listarCoordinadores(t); return l.ok ? (l.valor.find((c) => c.id === id) ?? null) : null; },
  entregas: async (t, id) => { const l = await entregasDe(t, id); return l.ok ? l.valor : null; },
  guardarCorreoOperador: (t, op, correo) => guardarContactoOperador(t, op, { correo }),
  insertarEntregas,
  registrarEvento,
  leerDesglose: async (t, id) => { const l = await leerDesglose(t, id); return l.ok ? { existe: l.valor !== null, retenidaMotivo: l.valor?.retenidaMotivo ?? null } : null; },
  rutaXlsx: rutaXlsxDesglose,
};

const rechazo = (motivo: MotivoRechazo, mensaje: string): ResultadoReenvio => ({ estado: 'rechazado', motivo, mensaje });
const ROLES_EN_CURSO = new Set(['pendiente', 'enviando']);

function rolesDe(a: DestinoReenvio): readonly RolDestinatario[] | 'todos' {
  return a === 'todos' ? 'todos' : [a];
}

/**
 * Reenvía el desglose de UNA liquidación. Los rechazos esperados vuelven como valor (con un mensaje llano para la
 * pantalla); los errores de lectura/escritura se lanzan.
 */
export async function reenviarDesglose(
  tenantId: string, liquidacionId: string, op: OpcionesReenvio,
  deps: DependenciasReenvio = dependenciasReenvioPorOmision,
): Promise<ResultadoReenvio> {
  if (!puedeAdministrar(op.actor.rol)) return rechazo('sin_permiso', 'Solo quien administra la flota puede reenviar un desglose.');

  const liq = await deps.leerLiquidacion(tenantId, liquidacionId);
  if (!liq) return rechazo('no_encontrada', 'No encontré ese desglose en tu flota.');

  // Validar el correo nuevo ANTES de tocar nada.
  let correoNuevo: string | null = null;
  if (op.correoNuevo !== undefined && op.correoNuevo.trim() !== '') {
    if (op.a !== 'operador' && op.a !== 'todos') {
      return rechazo('correo_nuevo_no_aplica', 'El correo nuevo es del operador: elige «Operador» o «Todos».');
    }
    correoNuevo = op.correoNuevo.trim().toLowerCase();
    if (correoNuevo.length > 254 || !FORMA_CORREO.test(correoNuevo)) {
      return rechazo('correo_invalido', 'El correo nuevo no parece un correo. Revísalo (por ejemplo, que tenga @ y un dominio).');
    }
  }

  const entregas = await deps.entregas(tenantId, liquidacionId);
  const config = await deps.leerConfig(tenantId);
  if (entregas === null || config === null) {
    return rechazo('no_disponible', 'No pude leer las entregas por correo de este desglose. Intenta de nuevo en unos minutos.');
  }

  // Tope diario: cada reenvío es una generación con `disparo` distinto de `auto` creada hoy (día de México).
  const ahora = deps.ahora();
  const inicioDia = inicioVentanaHoy(ahora, 0);
  const hoy = new Set<number>();
  for (const e of entregas) {
    if (e.disparo !== 'auto' && (!inicioDia || new Date(e.creadaEn).getTime() >= inicioDia.getTime())) hoy.add(e.generacion);
  }
  if (hoy.size >= MAX_REENVIOS_POR_DIA) {
    return rechazo('limite_diario', `Ya se reenvió este desglose ${MAX_REENVIOS_POR_DIA} veces hoy. Intenta mañana o revisa por qué no llega.`);
  }

  const contacto = await deps.leerContacto(tenantId, liq.operadorId);
  const coordinador = contacto?.coordinadorId ? await deps.leerCoordinador(tenantId, contacto.coordinadorId) : null;
  const correoOperador = correoNuevo ?? contacto?.correo ?? null;
  const rebotadoEn = correoNuevo ? null : (contacto?.correoRebotadoEn ?? null);
  const { destinos, faltantes } = resolverDestinatarios({
    operador: { correo: correoOperador, rebotadoEn },
    coordinador: coordinador ? { correo: coordinador.correo, activo: coordinador.activo } : null,
    config: { rhCorreos: config.rhCorreos, archivoCorreo: config.archivoCorreo, enviaCoordinador: true, enviaRh: true },
  });

  const pedidos = rolesDe(op.a);
  const elegidos = pedidos === 'todos' ? destinos : destinos.filter((d) => pedidos.includes(d.rol));
  if (elegidos.length === 0) {
    const motivo = pedidos !== 'todos' && pedidos[0] === 'operador' && faltantes.some((f) => f.rol === 'operador' && f.motivo === 'correo_rebotado')
      ? 'El correo del operador rebotó. Escribe un correo nuevo para reenviarlo.'
      : 'No hay a quién reenviarlo: falta el correo de ese destinatario.';
    return rechazo('sin_destinatarios', motivo);
  }

  // Jamás se reenvía mientras la anterior de ese rol sigue en curso.
  const enCurso = elegidos.filter((d) => entregas.some((e) => e.rol === d.rol && ROLES_EN_CURSO.has(e.estado)));
  if (enCurso.length > 0) {
    return rechazo('en_curso', 'La entrega anterior todavía se está enviando. Espera a que termine antes de reenviar.');
  }

  // El archivo es el mismo de la entrega original (misma huella): se hereda de la generación más reciente que lo tenga.
  let conArchivo: { xlsxRuta: string | null; xlsxSha256: string | null } | undefined =
    [...entregas].filter((e) => e.xlsxRuta).sort((a, b) => b.generacion - a.generacion)[0];
  if (!conArchivo && entregas.length === 0 && deps.leerDesglose && deps.rutaXlsx) {
    // A37-A1-liquidaciones-08: la recepción no creó NINGUNA entrega (p. ej. primer día sin RH, archivo ni correos) y no hay de
    // dónde heredar el archivo. Es el mismo Excel que `recibirDesglose` ya subió: su ruta sale de la clave y la huella, como en
    // `liberar_envio.ts`. Un desglose RETENIDO no entra por aquí (lo decide `liberarEnvio`); si no se puede leer el encabezado
    // no se adivina que no esté retenido.
    const cab = await deps.leerDesglose(tenantId, liquidacionId);
    if (cab === null) return rechazo('no_disponible', 'No pude leer el estado de este desglose. Intenta de nuevo en unos minutos.');
    if (cab.existe && cab.retenidaMotivo) {
      return rechazo('no_disponible', 'Este desglose está retenido: decide enviarlo con «Liberar envío» en lugar de reenviarlo.');
    }
    if (cab.existe) conArchivo = { xlsxRuta: deps.rutaXlsx(tenantId, liq.claveExterna, liq.huella), xlsxSha256: null };
  }
  if (!conArchivo) return rechazo('sin_archivo', 'Este desglose no tiene archivo para reenviar.');

  // Desde aquí se escribe: primero el correo corregido, luego las entregas.
  if (correoNuevo) await deps.guardarCorreoOperador(tenantId, liq.operadorId, correoNuevo);
  const generacion = entregas.reduce((m, e) => Math.max(m, e.generacion), 0) + 1;
  const disparo = op.motivo === 'reclamo' ? 'reclamo' : 'manual';
  const creadas = await deps.insertarEntregas(tenantId, elegidos.map((d) => ({
    liquidacionExternaId: liquidacionId, generacion, rol: d.rol, correo: d.correo,
    xlsxRuta: conArchivo.xlsxRuta, xlsxSha256: conArchivo.xlsxSha256, disparo, pedidoPor: op.actor.userId,
  })));

  await deps.registrarEvento(tenantId, liquidacionId, 'reintento_manual', {
    canal: 'correo', actor: op.actor.userId, motivo: op.motivo, a: op.a, generacion,
    roles: elegidos.map((d) => d.rol), correo_actualizado: correoNuevo !== null,
  });

  const avisos: string[] = [];
  if (creadas < elegidos.length) avisos.push('Alguna entrega ya existía y no se duplicó.');
  return { estado: 'reenviado', generacion, entregas: creadas, roles: elegidos.map((d) => d.rol), avisos };
}
