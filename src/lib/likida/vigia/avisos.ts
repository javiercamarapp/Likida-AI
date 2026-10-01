// ═══════════════════════════════════════════════════════════════════════════
// LOS AVISOS AL GERENTE: aprobar con un toque y escalar.
//
// Dos mensajes salen hacia la OFICINA (no hacia el cliente), siempre por el
// selector `enviarConFallback`: dentro de la ventana de 24 h del gerente salen
// como mensaje con BOTONES; fuera, como plantilla del catálogo con los mismos
// botones de respuesta rápida. El `payload` de cada botón es `vig_*:<id>`, y
// quien lo recibe (decisiones.ts) toma el tenant de la CUENTA que escribe, jamás
// del id.
//
//   vig_ok:<mensaje_id>    Enviar     — aprueba y manda la respuesta al cliente
//   vig_no:<mensaje_id>    No enviar  — descarta el borrador
//   vig_tomo:<mensaje_id>  Yo me encargo — el gerente toma el hilo (el agente se calla)
// ═══════════════════════════════════════════════════════════════════════════
import { opcionesDeEnvio, PLANTILLA } from '@/lib/meta/plantillas_catalogo';
import { enviarConFallback, type ResultadoEnvioConFallback } from '@/lib/meta/enviar_con_fallback';
import { appUrl } from '@/lib/env';
import { aLineaPlantilla } from './redactor';
import type { Enviador } from './enviar';
import type { MotivoEscalamiento } from './tipos';

export const PREFIJO_APROBAR = 'vig_ok';
export const PREFIJO_RECHAZAR = 'vig_no';
export const PREFIJO_TOMAR = 'vig_tomo';

const MAX_EXTRACTO = 160;
const MAX_BORRADOR_PLANTILLA = 280;
const MAX_BORRADOR_TEXTO = 500;

function recortar(t: string, tope: number): string {
  const l = t.replace(/\s+/g, ' ').trim();
  return l.length > tope ? `${l.slice(0, tope - 1)}…` : l;
}

export interface EntradaAvisoAprobacion {
  tenantId: string;
  telefonoGerente: string;
  mensajeId: string;
  nombreCliente: string;
  mensajeCliente: string;
  borrador: string;
  /** Lo que el gerente debe saber antes de apretar «Enviar» (faltantes, señales…). */
  advertencia?: string | null;
}

/** Pide al gerente que apruebe una respuesta. Nunca lanza. */
export async function avisarAprobacion(e: EntradaAvisoAprobacion, enviar: Enviador = enviarConFallback): Promise<ResultadoEnvioConFallback> {
  const cliente = recortar(e.nombreCliente, 60) || 'Un cliente';
  const extracto = recortar(e.mensajeCliente, MAX_EXTRACTO);
  const texto = [
    `Vigía de servicio — ${cliente} escribió: «${extracto}»`,
    '',
    `Respuesta propuesta: «${recortar(e.borrador, MAX_BORRADOR_TEXTO)}»`,
    ...(e.advertencia ? ['', `Ojo: ${recortar(e.advertencia, 160)}`] : []),
    '',
    '¿La envío?',
  ].join('\n');
  return enviar(e.telefonoGerente, {
    texto,
    botones: [
      { id: `${PREFIJO_APROBAR}:${e.mensajeId}`, titulo: 'Enviar' },
      { id: `${PREFIJO_RECHAZAR}:${e.mensajeId}`, titulo: 'No enviar' },
      { id: `${PREFIJO_TOMAR}:${e.mensajeId}`, titulo: 'Yo me encargo' },
    ],
    plantilla: {
      nombre: PLANTILLA.vigiaAprobacion,
      ...opcionesDeEnvio(PLANTILLA.vigiaAprobacion, {
        cuerpo: [aLineaPlantilla(cliente, 60), aLineaPlantilla(extracto, MAX_EXTRACTO), aLineaPlantilla(e.borrador, MAX_BORRADOR_PLANTILLA)],
        idsBotones: e.mensajeId,
      }),
    },
    contexto: 'vigia.aprobacion',
    tenantId: e.tenantId,
  });
}

export function textoDeMotivoEscalamiento(motivo: MotivoEscalamiento, minutos: number): string {
  switch (motivo) {
    case 'sin_respuesta': return `lleva ${minutos} minutos sin respuesta`;
    case 'molestia': return 'muestra molestia';
    case 'pide_humano': return 'pide hablar con una persona';
    case 'sin_dato': return 'preguntó algo que no tengo registrado';
    case 'folio_ajeno': return 'preguntó por un folio que no es suyo';
  }
}

export interface EntradaAvisoEscalamiento {
  tenantId: string;
  telefonoDestino: string;
  /** Un mensaje (entrante) de la conversación: el botón «Yo me encargo» se resuelve a su hilo. */
  mensajeId: string;
  nombreCliente: string;
  motivo: MotivoEscalamiento;
  minutosEsperando: number;
  nivel: 1 | 2;
}

export async function avisarEscalamiento(e: EntradaAvisoEscalamiento, enviar: Enviador = enviarConFallback): Promise<ResultadoEnvioConFallback> {
  const cliente = recortar(e.nombreCliente, 60) || 'Un cliente';
  const motivo = textoDeMotivoEscalamiento(e.motivo, e.minutosEsperando);
  const liga = `${appUrl()}/dashboard/agentes/vigia`;
  const texto = `Vigía de servicio: el cliente ${cliente} necesita atención (${motivo}). Nivel ${e.nivel} de escalamiento. Revísalo en ${liga} o toca «Yo me encargo».`;
  return enviar(e.telefonoDestino, {
    texto,
    botones: [{ id: `${PREFIJO_TOMAR}:${e.mensajeId}`, titulo: 'Yo me encargo' }],
    plantilla: {
      nombre: PLANTILLA.vigiaEscalamiento,
      ...opcionesDeEnvio(PLANTILLA.vigiaEscalamiento, {
        cuerpo: [aLineaPlantilla(cliente, 60), aLineaPlantilla(motivo, 80), String(e.nivel), liga],
        idsBotones: e.mensajeId,
      }),
    },
    contexto: 'vigia.escalamiento',
    tenantId: e.tenantId,
  });
}

/** Lo que llega cuando el gerente aprieta un botón: `vig_ok:<uuid>` / `vig_no:` / `vig_tomo:`. */
export type DecisionBoton = { accion: 'aprobar' | 'rechazar' | 'tomar'; id: string };

const FORMA_BOTON = /^vig_(ok|no|tomo):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export function interpretarBoton(texto: string): DecisionBoton | null {
  const m = FORMA_BOTON.exec(texto.trim());
  if (!m) return null;
  return { accion: m[1] === 'ok' ? 'aprobar' : m[1] === 'no' ? 'rechazar' : 'tomar', id: m[2].toLowerCase() };
}
