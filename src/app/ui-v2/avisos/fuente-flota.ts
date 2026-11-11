// Avisos del panel del cliente, leídos. Es la lectura que antes vivía dentro de la página (`dashboard/notificaciones/page.tsx`), movida
// aquí para que el pie (layout) y la pantalla cuenten con la MISMA función. Cada señal falla por su lado (`catch → null`, jamás 0).
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { esRolNomina } from '@/lib/auth/roles';
import { perfilDeTenant } from '@/lib/auth/perfil_tenant';
import { getKpis, detectarAnomalias, contarEscalados } from '@/lib/likida/analytics';
import { contarHuerfanosPendientes } from '@/lib/likida/repo';
import { getConexiones } from '@/lib/likida/conexiones';
import { fuentes } from '@/lib/likida/orquestador/fuentes';
import '@/lib/likida/orquestador/fuentes_reales';
import { rolPuedeLeerTarea } from '@/lib/likida/orquestador/permisos';
import { armarTableroViajes } from '@/lib/likida/orquestador/tablero_viajes';
import { calcularAlertasFlota } from '@/app/dashboard/calcular-alertas-flota';
import { avisosDeFlota } from './generar-flota';
import type { FuenteAvisos } from './bandeja';

const TTL_MS = 45_000;
const cache = new Map<string, { valor: FuenteAvisos; vence: number }>();

/** Solo para pruebas. */
export function vaciarCacheAvisosFlota(): void { cache.clear(); }

/**
 * Los avisos de UNA flota para UN rol. Los enlaces salen SIN el sufijo `?tenant=`: la pantalla lo agrega al pintar (el pie no lo conoce).
 * `nomina` (0949) solo ve conteos de Liquidaciones: no se leen KPIs, anomalías ni tablero. Sin avisos.
 */
export async function leerAvisosFlota(tenantId: string, rol: string, ahoraMs: number = Date.now()): Promise<FuenteAvisos> {
  const llave = `${tenantId}|${rol}`;
  const hit = cache.get(llave);
  if (hit && ahoraMs < hit.vence) return hit.valor;
  if (esRolNomina(rol)) return { avisos: [], generadoEn: new Date(ahoraMs).toISOString() };

  const perfil = await perfilDeTenant(tenantId);
  const veViajesEnVivo = puedeVerRuta(rol, '/dashboard/viajes-en-vivo', perfil);
  const [kpis, anomalias, escalados, huerfanos, conectores, tareas, tablero] = await Promise.all([
    getKpis(tenantId).catch(() => null),
    detectarAnomalias(tenantId).catch(() => null),
    contarEscalados(tenantId).catch(() => null),
    contarHuerfanosPendientes(tenantId).catch(() => null),
    getConexiones(tenantId).catch(() => null),
    veViajesEnVivo ? fuentes().escalacionesAbiertas(tenantId, 60).then((l) => (l === null ? null : l.filter((t) => rolPuedeLeerTarea(rol, t)).length)).catch(() => null) : Promise.resolve(undefined),
    veViajesEnVivo
      ? fuentes().entradaTablero(tenantId, new Date(ahoraMs)).then((e) => armarTableroViajes({ ...e, filtros: { terminalId: null, clienteId: null, soloExcepciones: false } }).conteos).catch(() => null)
      : Promise.resolve(undefined),
  ]);

  const alertas = calcularAlertasFlota(
    {
      porRevisar: kpis ? kpis.porRevisar : null,
      duplicados: anomalias ? anomalias.length : null,
      escalados, huerfanos, conectores,
      tareasAsistente: tareas,
      excepcionesConductor: tablero === undefined ? undefined : tablero === null ? null : tablero.conExcepcion,
      sinSenalDeVida: tablero == null ? undefined : tablero.sinSenal,
    },
    '',
    (href) => puedeVerRuta(rol, href, perfil),
  );
  const valor: FuenteAvisos = { avisos: avisosDeFlota(alertas), generadoEn: new Date(ahoraMs).toISOString() };
  // Solo se cachea si TODAS las señales se leyeron: una lectura caída se reintenta en la siguiente navegación.
  const ciega = alertas.some((a) => a.id.startsWith('ilegibles:'));
  if (!ciega) cache.set(llave, { valor, vence: ahoraMs + TTL_MS });
  return valor;
}
