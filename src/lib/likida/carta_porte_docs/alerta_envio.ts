// ═══════════════════════════════════════════════════════════════════════════
// LA ALERTA ÚNICA DEL ENVÍO (T-A3-30): quién recibe el aviso cuando un envío al TMS se agota o lo rechazan.
//
// Qué resuelve (33c4d51b 32:46 «que esté mandando alertas», 35:12 «el encargado… casos que necesitan revisión manual»):
// si el requerimiento no aparece (o el TMS no responde, o rechaza el archivo), el agente no puede quedarse callado. La
// máquina (`envio_estados.ts`) decide CUÁNDO y el candado de la base (`cp_envio_marcar_alerta`) garantiza UNA sola vez;
// este módulo decide A QUIÉN y POR QUÉ CANAL, y arma un texto que no lleva datos del documento (solo folio y liga).
//
// ── DESTINATARIOS (configurables en `cp_salida_config`; ninguno está definido por el cliente, B-6) ──────────────
//   · reque_agotado / transitorio_agotado / listo_manual → `destinatarioAlertaCorreo` + `destinatarioAlertaUsuario`
//     (su correo y su WhatsApp). `listo_manual` es el aviso de ÉXITO en modo manual (sin conector del TMS): el envío
//     llegó a `listo` sin problemas y alguien tiene que subirlo a mano; lo decide el WORKER (`worker_envios.ts`), no
//     esta máquina, y por eso NO pasa por el candado de alerta única (ver `envio_estados.ts`).
//   · rechazado_tms → el destinatario de REVISIÓN (`destinatarioRevisionCorreo` / `…Usuario`, T-A3-31); sin él, el de alerta.
//   · Sin nada configurado → el jefe de tráfico por WhatsApp, como hoy hace `avisarOficina`. Sin ni siquiera él, el aviso
//     NO se pierde: sube al operador del sistema.
//
// ── LA REGLA DEL OUTBOX (la de `worker.ts`) ─────────────────────────────────────────────────────────────────
// Un rechazo REINTENTABLE de WhatsApp YA quedó en `wa_outbox`, que lo entrega solo: cuenta como avisado y el candado se
// queda cerrado (reenviar lo duplicaría). Un rechazo DEFINITIVO de TODOS los canales no mandó nada: se LANZA, y quien
// llama (`alertaDeLaMaquina`) suelta el candado para que se pueda volver a avisar.
//
// Todo entra por `DepsAlertaEnvio`: se prueba entero con dobles, sin red ni base.
// ═══════════════════════════════════════════════════════════════════════════

import { parametrosAvisoOficina, type ResultadoAvisoOficina } from '@/lib/meta/aviso_oficina';
import type { Correo } from '@/lib/correo/plantilla';
import type { ResultadoEnvio } from '@/lib/correo/enviar';
import type { MotivoAlerta } from './envio_estados';
import type { ConfigSalida } from './salida_config';

/** Avisos que una pasada puede mandar (el mismo tope que el worker de la bandeja). */
export const TOPE_AVISOS_POR_PASADA = 10;

export interface DepsAlertaEnvio {
  leerConfig(tenantId: string): Promise<ConfigSalida>;
  /** El folio del documento (lo único del documento que viaja en el aviso); `null` si no se pudo leer. */
  leerFolio(tenantId: string, documentoId: string): Promise<string | null>;
  correoDeUsuario(userId: string, tenantId: string): Promise<string | null>;
  telefonoDeUsuario(userId: string, tenantId: string): Promise<string | null>;
  /** El jefe de tráfico de la flota (el destino de siempre del aviso a la oficina). */
  telefonoJefe(tenantId: string): Promise<string | null>;
  enviarCorreo(para: string, correo: Correo): Promise<ResultadoEnvio>;
  avisar(telefono: string, texto: string, parametros: [string, string, string], contexto: Record<string, unknown>): Promise<ResultadoAvisoOficina>;
  alertarOperador(evento: string, detalle: Record<string, unknown>): Promise<unknown>;
  /** La liga base de la bandeja de Carta Porte (sin diagonal final); el visor es `<base>/<documentoId>`. */
  urlBandeja: string;
}

export interface EntradaAlerta { tenantId: string; envioId: string; documentoId: string; motivo: MotivoAlerta; destinatario: string; mensaje: string }

export type CanalesAlerta = { correo: 'enviado' | 'fallo' | 'sin_destino'; whatsapp: 'enviado' | 'en_cola' | 'fallo' | 'sin_destino'; operador: boolean };

/** El folio va tal cual en el aviso, pero acotado y sin saltos: es dato del cliente y no debe arrastrar texto libre. */
const folioSeguro = (f: string | null): string => {
  const limpio = (f ?? '').replace(/[^\p{L}\p{N}._\-/ ]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 40);
  return limpio || 'sin folio';
};

/** El texto del aviso: SOLO folio y liga (cero RFC, nombres ni importes). */
export function textoAlerta(motivo: MotivoAlerta, folio: string, reintentosMax: number, liga: string): { asunto: string; resumen: string; cuerpo: string } {
  const f = folioSeguro(folio);
  switch (motivo) {
    case 'reque_agotado':
      return {
        asunto: `Carta Porte: el documento ${f} sigue sin requerimiento`,
        resumen: `${f}: sin requerimiento`,
        cuerpo: `Documento ${f}: sigue sin requerimiento tras ${reintentosMax} reintentos. Crea el requerimiento o márcalo como subido a mano. ${liga}`,
      };
    case 'rechazado_tms':
      return {
        asunto: `Carta Porte: el sistema del cliente rechazó el documento ${f}`,
        resumen: `${f}: rechazado`,
        cuerpo: `Documento ${f}: el sistema del cliente lo rechazó. Ya está en tu bandeja por revisar, con lo que hay que corregir; corrígelo y vuelve a aprobarlo. ${liga}`,
      };
    case 'transitorio_agotado':
      return {
        asunto: `Carta Porte: el sistema del cliente no responde (documento ${f})`,
        resumen: `${f}: sin respuesta del sistema`,
        cuerpo: `Documento ${f}: el sistema del cliente no respondió tras varios intentos. Revisa la conexión o súbelo a mano y márcalo como subido a mano. ${liga}`,
      };
    case 'listo_manual':
      return {
        asunto: `Carta Porte: el documento ${f} ya está listo para subir`,
        resumen: `${f}: listo para subir`,
        cuerpo: `Documento ${f}: la Carta Porte está lista para subir al sistema del cliente. ${liga}`,
      };
  }
}

/**
 * La función que `DepsEnvios.alertarEnvio` espera. NO lanza si el aviso salió por algún canal (o quedó en la cola de WhatsApp);
 * LANZA si no salió por ninguno, para que el candado se suelte. Cuenta los avisos por pasada (`TOPE_AVISOS_POR_PASADA`).
 */
export function crearAlertarEnvio(deps: DepsAlertaEnvio): (a: EntradaAlerta) => Promise<CanalesAlerta> {
  let avisos = 0;
  return async (a) => {
    if (avisos >= TOPE_AVISOS_POR_PASADA) throw new Error('tope de avisos por pasada alcanzado');
    avisos++;
    const { tenantId } = a;
    const config = await deps.leerConfig(tenantId);
    const folio = await deps.leerFolio(tenantId, a.documentoId).catch(() => null);
    const liga = `${deps.urlBandeja}/${a.documentoId}`;
    const t = textoAlerta(a.motivo, folio ?? '', config.reintentosMax, liga);

    // El rechazo va a quien REVISA; lo demás, al destinatario de la alerta. Cada uno cae al otro si le falta.
    const revision = a.motivo === 'rechazado_tms';
    const usuario = revision ? (config.destinatarioRevisionUsuario ?? config.destinatarioAlertaUsuario) : (config.destinatarioAlertaUsuario ?? config.destinatarioRevisionUsuario);
    const correoCfg = revision ? (config.destinatarioRevisionCorreo ?? config.destinatarioAlertaCorreo) : (config.destinatarioAlertaCorreo ?? config.destinatarioRevisionCorreo);
    const correoUsuario = usuario ? await deps.correoDeUsuario(usuario, tenantId).catch(() => null) : null;
    const para = correoCfg ?? correoUsuario;
    const telefono = (usuario ? await deps.telefonoDeUsuario(usuario, tenantId).catch(() => null) : null) ?? (await deps.telefonoJefe(tenantId).catch(() => null));

    const r: CanalesAlerta = { correo: 'sin_destino', whatsapp: 'sin_destino', operador: false };
    const razones: string[] = [];

    if (para) {
      const res = await deps.enviarCorreo(para, { asunto: t.asunto, avance: t.resumen, titulo: t.asunto, parrafos: [t.cuerpo.replace(` ${liga}`, '')], boton: { texto: 'Abrir el documento', href: liga }, tono: 'atencion', porQueLoRecibes: 'Eres el destinatario de los avisos de Carta Porte de tu flota (se configura en la salida al sistema del cliente).' })
        .catch((): ResultadoEnvio => ({ ok: false, motivo: 'red', detalle: 'excepción' }));
      if (res.ok) r.correo = 'enviado'; else { r.correo = 'fallo'; razones.push(`correo ${res.motivo}`); }
    }
    if (telefono) {
      const res = await deps.avisar(telefono, t.cuerpo, parametrosAvisoOficina('Carta Porte', t.resumen, liga), { agente: 'carta_porte', tenantId, documentoId: a.documentoId, tipo: `envio_${a.motivo}` })
        .catch((): ResultadoAvisoOficina => ({ ok: false, motivo: 'excepción', fueraDeVentana: false, reintentable: false }));
      if (res.ok) r.whatsapp = 'enviado';
      else if (res.reintentable || res.encolado) r.whatsapp = 'en_cola'; // YA está en `wa_outbox`: no se reenvía
      else { r.whatsapp = 'fallo'; razones.push(`whatsapp ${res.motivo.slice(0, 80)}`); }
    }

    if (r.correo === 'enviado' || r.whatsapp === 'enviado' || r.whatsapp === 'en_cola') return r;
    if (r.correo === 'sin_destino' && r.whatsapp === 'sin_destino') {
      // Nadie configurado y sin jefe con teléfono: el aviso no se pierde, sube al operador del sistema.
      await deps.alertarOperador(`cron.carta_porte_envio.${a.motivo}`, { error: t.cuerpo, codigo: `cp_envio_${a.motivo}`, tenantId, envioId: a.envioId, documentoId: a.documentoId });
      r.operador = true;
      return r;
    }
    throw new Error(`el aviso no salió por ningún canal (${razones.join('; ')})`);
  };
}
