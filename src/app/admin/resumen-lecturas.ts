import { cache } from 'react';
import { getResumenNegocio, getConteosPlataforma, getMrr, costoIaMesActual } from '@/lib/admin/negocio';
import { obtenerPanoramaAccion } from './requiere-accion';
import { clasificarBandeja, estadoDeDetalle } from '@/lib/admin/guardia';
import { alertasExtra, leerEntradaAlertasExtra } from '@/lib/admin/fuentes-alerta-extra';
import { getSLOs } from '@/lib/admin/slo';
import { getAgentesParados } from '@/lib/admin/agentes-parados';
import { getCalidadAgentes } from '@/lib/admin/calidad-agentes';
import { getAnotacionesDespliegue } from '@/lib/admin/anotaciones-despliegue';
import { bandejaPendiente } from '@/lib/likida/agentes/cola';
import { ahoraMs } from '@/lib/saludo';
import type { EntradaSemaforo, EntradaTuTurno } from '@/lib/admin/centro-mando';

// ═══════════════════════════════════════════════════════════════════════════
// LECTURAS DEL RESUMEN (Centro de Mando). Cada una cae POR SU LADO a `null` («no se pudo leer») y `cache()` la comparte entre los
// bloques de una misma petición: dos bloques que piden lo mismo no leen la base dos veces. Un `null` NUNCA se pinta como 0.
// La ventana de «Facturas por día» es fija (30 días) y su rótulo lo dice: la pantalla ya no tiene un filtro que mover.
// ═══════════════════════════════════════════════════════════════════════════

export const VENTANA_FACTURAS_DIAS = 30;

const sinLanzar = <T>(p: Promise<T>): Promise<T | null> => p.catch(() => null);

export const resumenNegocio = cache(() => sinLanzar(getResumenNegocio(undefined, VENTANA_FACTURAS_DIAS)));
export const conteosPlataforma = cache(() => sinLanzar(getConteosPlataforma()));
export const mrr = cache(() => sinLanzar(getMrr()));
export const costoIaMes = cache(() => sinLanzar(costoIaMesActual()));
/** La bandeja NUNCA lanza; `null` solo si la lectura entera falló (`bandeja: null` en el panorama). */
export const panorama = cache(() => obtenerPanoramaAccion(ahoraMs()));
export const slos = cache(() => sinLanzar(getSLOs()));
export const parados = cache(() => getAgentesParados(ahoraMs()));
export const calidadAgentes = cache(() => sinLanzar(getCalidadAgentes(30)));
export const despliegues = cache(() => getAnotacionesDespliegue({ dias: 30 }));
const entradaExtras = cache(() => leerEntradaAlertasExtra());

export const clasificacion = cache(async () => {
  const { bandeja } = await panorama();
  return bandeja ? clasificarBandeja(bandeja, ahoraMs()) : null;
});

export async function entradaSemaforo(): Promise<EntradaSemaforo> {
  const [cl, ex, s, p] = await Promise.all([clasificacion(), sinLanzar(entradaExtras()), slos(), parados()]);
  const guardia = ex?.latidos?.guardia ?? null;
  const estado = guardia ? estadoDeDetalle(guardia.detalle) : null;
  return {
    guardia: guardia && estado
      ? { juicio: guardia.estado, haceMin: guardia.haceMin, baseCaidaDesde: estado.baseCaidaDesde, appCaidaDesde: estado.appCaidaDesde }
      : null,
    bandeja: cl ? { s2: cl.porSeveridad.S2 - cl.fuentesCiegas.length, fuentesCiegas: cl.fuentesCiegas.length } : null,
    extras: ex ? alertasExtra(ex) : null,
    slos: s ? s.map((x) => ({ nombre: x.nombre, cumple: x.cumple })) : null,
    frenadosPorBandeja: p ? p.parados.filter((x) => x.causa === 'contrapresion_bandeja').length : null,
  };
}

export async function entradaTuTurno(): Promise<EntradaTuTurno> {
  const [cl, p, urg, nor] = await Promise.all([
    clasificacion(), parados(), sinLanzar(bandejaPendiente('urgente')), sinLanzar(bandejaPendiente('normal')),
  ]);
  return {
    items: cl ? cl.items : null,
    envios: urg && nor ? { urgentes: urg.length, normales: nor.length } : null,
    frenados: p ? p.parados.filter((x) => x.causa === 'contrapresion_bandeja').length : null,
  };
}
