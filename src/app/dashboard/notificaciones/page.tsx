import { redirect } from 'next/navigation';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { getKpis, detectarAnomalias, contarEscalados } from '@/lib/likida/analytics';
import { contarHuerfanosPendientes } from '@/lib/likida/repo';
import { getConexiones } from '@/lib/likida/conexiones';
import { fuentes } from '@/lib/likida/orquestador/fuentes';
import '@/lib/likida/orquestador/fuentes_reales';
import { rolPuedeLeerTarea } from '@/lib/likida/orquestador/permisos';
import { armarTableroViajes } from '@/lib/likida/orquestador/tablero_viajes';
import { ahoraMs } from '@/lib/saludo';
import { calcularAlertasFlota } from '../calcular-alertas-flota';
import { sufijoTenant } from '../sufijo';
import { ListaAlertas } from './lista';

export const dynamic = 'force-dynamic';

/**
 * NOTIFICACIONES DE LA FLOTA — "alertas que necesitan tu atención" ANTES
 * del panorama, aquí con página propia como ya la tiene /admin.
 *
 * Antes de esto el panel del cliente tenía una campana que solo abría un
 * dropdown con dos textos sin liga, y solo existía en el Inicio: para
 * enterarte de que un viaje se escaló tenías que ir a buscarlo.
 *
 * CADA señal se lee por separado y CADA una puede fallar por su cuenta. Se
 * lee con `catch → null`, no con `catch → 0`: `calcularAlertasFlota` sabe
 * distinguirlos y confiesa lo que no pudo revisar. Un `Promise.all` que se
 * cae entero por una consulta rota dejaría la pantalla en blanco cuando
 * justamente hay algo que avisar.
 */
export default async function PaginaNotificaciones({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string; rol?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo('/dashboard/notificaciones', sp);
  if (!puedeVerRuta(rol, '/dashboard/notificaciones')) redirect('/dashboard');

  const sufijo = sufijoTenant(sp);

  // P6: las tareas del asistente y las excepciones del Conductor también son notificaciones (solo si el rol abre viajes en vivo; una tarea
  // de dinero solo la cuenta quien ve dinero). Se leen aparte y con `catch → null`, como el resto: una fuente caída se confiesa, no se calla.
  const veViajesEnVivo = puedeVerRuta(rol, '/dashboard/viajes-en-vivo');
  const [kpis, anomalias, escalados, huerfanos, conectores, tareas, tablero] = await Promise.all([
    getKpis(tenantId).catch(() => null),
    detectarAnomalias(tenantId).catch(() => null),
    contarEscalados(tenantId).catch(() => null),
    contarHuerfanosPendientes(tenantId).catch(() => null),
    getConexiones(tenantId).catch(() => null),
    veViajesEnVivo ? fuentes().escalacionesAbiertas(tenantId, 60).then((l) => (l === null ? null : l.filter((t) => rolPuedeLeerTarea(rol, t)).length)).catch(() => null) : Promise.resolve(undefined),
    veViajesEnVivo
      ? fuentes().entradaTablero(tenantId, new Date(ahoraMs())).then((e) => armarTableroViajes({ ...e, filtros: { terminalId: null, clienteId: null, soloExcepciones: false } }).conteos).catch(() => null)
      : Promise.resolve(undefined),
  ]);

  const alertas = calcularAlertasFlota(
    {
      porRevisar: kpis ? kpis.porRevisar : null,
      duplicados: anomalias ? anomalias.length : null,
      escalados,
      huerfanos,
      conectores,
      // `undefined` = este rol no ve esa pantalla (la señal no existe); `null` = no se pudo leer (se confiesa).
      tareasAsistente: tareas,
      excepcionesConductor: tablero === undefined ? undefined : tablero === null ? null : tablero.conExcepcion,
      sinSenalDeVida: tablero == null ? undefined : tablero.sinSenal,
    },
    sufijo,
    (href) => puedeVerRuta(rol, href),
  );

  return <ListaAlertas alertas={alertas} />;
}
