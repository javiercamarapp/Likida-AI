import { puedeAdministrar } from '@/lib/auth/permisos';
import { anotarBitacora } from '@/lib/likida/bitacora_escritura';
import { logger } from '@/lib/logger';
import { esTelefonoDemo } from '@/lib/meta/telefono_demo';
import { normalizarTelefonoWa } from '@/lib/likida/wa_ventana';
import { contarVoluntarios, leerOperadorPiloto, listarVoluntarios, leerTopeVoluntarios, marcarVoluntario, retirarVoluntario } from './repo';

// ═══════════════════════════════════════════════════════════════════════════
// ALTA Y BAJA DE LOS OPERADORES VOLUNTARIOS DEL PILOTO (Agente 5) — la lógica de las acciones de servidor, con puertos.
//
// El consentimiento de un chofer a ser contactado y seguido es un dato personal (LFPDPPP): solo entra al piloto quien
// la oficina marca a propósito, uno por uno, y quedan registrados quién lo hizo y cuándo (0800 + bitácora).
//
// · PERMISO: `puedeAdministrar` (el dueño), como `guardarConfigDelPanel`; se comprueba AQUÍ (una acción de servidor es
//   un endpoint). El `tenantId` sale de la sesión, nunca del formulario: un operador de OTRA flota es «no existe».
// · TOPE: `piloto_max_voluntarios` (6 por omisión). Se aplica en el servidor: antes de marcar y otra vez DESPUÉS, para que dos
//   altas simultáneas no pasen del tope (la que se pasa se deshace).
// · TELÉFONO: móvil mexicano de 10 dígitos (o 52 + 10), y nunca la marca de demo `28999` (misma regla que Meta).
// · BITÁCORA: quién, a qué operador (su id) y cuántos van; nunca nombres ni teléfonos.
// ═══════════════════════════════════════════════════════════════════════════

export type ResultadoVoluntario = { ok: true; mensaje: string } | { ok: false; error: string };

export interface DepsVoluntarios {
  operador: typeof leerOperadorPiloto;
  contar: typeof contarVoluntarios;
  listar: typeof listarVoluntarios;
  tope: typeof leerTopeVoluntarios;
  marcar: typeof marcarVoluntario;
  retirar: typeof retirarVoluntario;
  bitacora: typeof anotarBitacora;
}
export const depsVoluntariosReales: DepsVoluntarios = {
  operador: leerOperadorPiloto, contar: contarVoluntarios, listar: listarVoluntarios, tope: leerTopeVoluntarios, marcar: marcarVoluntario, retirar: retirarVoluntario, bitacora: anotarBitacora,
};

export interface ContextoVoluntarios { tenantId: string; rol: string; usuarioId: string | null; email: string | null }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SIN_PERMISO = 'Solo el dueño de la flota cambia quién está en el piloto.';
const FALLO = 'No pude guardarlo ahorita. Intenta de nuevo en un momento.';
const NO_EXISTE = 'Ese operador no existe en tu flota.';

/** El texto exacto del tope (lo pinta también la pantalla). */
export const errorTopeVoluntarios = (tope: number): string => `Ya hay ${tope} operadores en el piloto. Retira uno antes de agregar otro.`;

/** ¿Es un móvil que WhatsApp puede alcanzar? 10 dígitos mexicanos, con o sin 52 / 521. */
export function telefonoDePilotoValido(telefono: string): boolean {
  const d = normalizarTelefonoWa(telefono);
  return /^52\d{10}$/.test(/^\d{10}$/.test(d) ? `52${d}` : d);
}

function leerId(fd: { get(k: string): unknown }): string | null {
  const v = fd.get('operadorId');
  return typeof v === 'string' && UUID.test(v.trim()) ? v.trim().toLowerCase() : null;
}

export async function altaVoluntarioDelPanel(
  ctx: ContextoVoluntarios, fd: { get(k: string): unknown }, d: DepsVoluntarios = depsVoluntariosReales, ahora: Date = new Date(),
): Promise<ResultadoVoluntario> {
  if (!puedeAdministrar(ctx.rol)) return { ok: false, error: SIN_PERMISO };
  const id = leerId(fd);
  if (!id) return { ok: false, error: 'Elige un operador de la lista.' };
  try {
    const op = await d.operador(ctx.tenantId, id);
    if (!op) return { ok: false, error: NO_EXISTE };
    if (op.voluntario) return { ok: true, mensaje: 'Ese operador ya estaba en el piloto.' };
    if (!op.activo) return { ok: false, error: 'Ese operador está dado de baja: no puede entrar al piloto.' };
    if (esTelefonoDemo(op.telefono)) return { ok: false, error: 'Ese teléfono es de demostración (marca 28999) y no puede entrar al piloto.' };
    if (!telefonoDePilotoValido(op.telefono)) return { ok: false, error: 'Ese operador no tiene un teléfono de WhatsApp válido (10 dígitos mexicanos). Corrígelo antes de meterlo al piloto.' };
    const tope = await d.tope(ctx.tenantId);
    if ((await d.contar(ctx.tenantId)) >= tope) return { ok: false, error: errorTopeVoluntarios(tope) };
    if (!(await d.marcar(ctx.tenantId, id, ctx.usuarioId, ahora))) return { ok: false, error: NO_EXISTE };
    // Segunda barrera: si otra alta simultánea ya llenó el cupo, esta se deshace (no hay viajes que revertir: acaba de entrar).
    const total = await d.contar(ctx.tenantId);
    if (total > tope) {
      // A37-S34-08: con dos altas simultáneas AMBAS veían `total > tope` y se retiraban las dos. Ahora se decide por orden de
      // marca (desde, id): la que cae dentro de los primeros `tope` se queda; solo se retira la que sobra.
      const lista = await d.listar(ctx.tenantId);
      // Sin fecha de marca = el más antiguo (existía antes de que se guardara la fecha).
      const orden = [...lista].sort((a, b) => {
        const fa = a.voluntarioDesde ?? '';
        const fb = b.voluntarioDesde ?? '';
        if (fa !== fb) return fa < fb ? -1 : 1;
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      });
      const posicion = orden.findIndex((o) => o.id === id);
      if (posicion === -1 || posicion >= tope) {
        try {
          await d.retirar(ctx.tenantId, id);
        } catch (e) {
          // El retiro falló: el operador QUEDÓ marcado por encima del tope (consentimiento). No se disfraza de «no pude guardarlo».
          logger.error('conductor.voluntario_retiro_tope_fallo', { err: e instanceof Error ? e.message : String(e), operadorId: id });
          return { ok: false, error: 'Ese operador quedó en el piloto por encima del tope y no pude retirarlo. Retíralo a mano desde la lista.' };
        }
        return { ok: false, error: errorTopeVoluntarios(tope) };
      }
    }
    await d.bitacora({
      tenantId: ctx.tenantId, actor: { id: ctx.usuarioId, email: ctx.email }, accion: 'conductor.voluntario_alta', entidad: 'operador', entidadId: id,
      detalle: { voluntarios: total, tope },
    });
    return { ok: true, mensaje: `Operador agregado al piloto (${total} de ${tope}).` };
  } catch (e) {
    logger.error('conductor.voluntario_alta_fallo', { err: e instanceof Error ? e.message : String(e) });
    return { ok: false, error: FALLO };
  }
}

export async function bajaVoluntarioDelPanel(
  ctx: ContextoVoluntarios, fd: { get(k: string): unknown }, d: DepsVoluntarios = depsVoluntariosReales,
): Promise<ResultadoVoluntario> {
  if (!puedeAdministrar(ctx.rol)) return { ok: false, error: SIN_PERMISO };
  const id = leerId(fd);
  if (!id) return { ok: false, error: 'Elige un operador de la lista.' };
  try {
    const op = await d.operador(ctx.tenantId, id);
    if (!op) return { ok: false, error: NO_EXISTE };
    if (!op.voluntario) return { ok: true, mensaje: 'Ese operador ya no estaba en el piloto.' };
    const viajes = await d.retirar(ctx.tenantId, id);
    await d.bitacora({
      tenantId: ctx.tenantId, actor: { id: ctx.usuarioId, email: ctx.email }, accion: 'conductor.voluntario_baja', entidad: 'operador', entidadId: id,
      detalle: { viajesDejadosDeSeguir: viajes },
    });
    const cola = viajes === 0 ? 'Ningún viaje dejó de seguirse.' : viajes === 1 ? '1 viaje dejó de seguirse.' : `${viajes} viajes dejaron de seguirse.`;
    return { ok: true, mensaje: `Operador retirado del piloto. ${cola}` };
  } catch (e) {
    logger.error('conductor.voluntario_baja_fallo', { err: e instanceof Error ? e.message : String(e) });
    return { ok: false, error: FALLO };
  }
}
