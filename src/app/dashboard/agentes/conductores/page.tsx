import { redirect } from 'next/navigation';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { getViajes, contarEscalados, getEventosConductores } from '@/lib/likida/analytics';
import { ahoraMs } from '@/lib/saludo';
import { sufijoTenant } from '../../sufijo';
import { VistaAgenteConductores, type EsperaAceptar } from './vista';
import { SeccionNotificaciones } from '../seccion-notificaciones';
import { FichaCorridas } from '../ficha-corridas';
import { ultimasCorridas } from '@/lib/likida/agentes/corridas';
import { puedeAdministrar } from '@/lib/auth/permisos';
import { getConfig } from '@/lib/likida/config';
import { validarHorasEscalacion, guardarEstrategiaAgente } from '@/lib/likida/agentes/estrategia';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import { revalidatePath } from 'next/cache';
import { FormaEstrategiaConductores, type ResultadoEstrategia } from '../estrategia-forma';

export const dynamic = 'force-dynamic';

/** Sección secundaria que no se pudo leer → null → su leyenda honesta. */
function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  return fn().catch(() => null);
}

/**
 * Agente de Conductores (F4 del plan) — la ventana del agente que habla con
 * los choferes: avisa el viaje, persigue la aceptación (y escala a las 5 h),
 * sella los hitos "ya llegué / descargando / de regreso" (0090) y recibe al
 * jefe despachando por WhatsApp.
 *
 * Área `operacion` y no `dinero` como sus hermanos: este agente no toca un
 * peso, y su usuario diario ES el jefe de tráfico. CERO pesos en pantalla.
 */
export default async function PaginaAgenteConductores({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string; rol?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo('/dashboard/agentes/conductores', sp);
  if (!puedeVerRuta(rol, '/dashboard/agentes/conductores')) redirect('/dashboard');

  const [viajes, escalados, eventos, corridas, config] = await Promise.all([
    getViajes(tenantId),
    contarEscalados(tenantId),
    safe(() => getEventosConductores(tenantId)),
    // La ficha de corridas (B3): null = no se pudo leer, y la ficha lo dice.
    ultimasCorridas(tenantId, 'conductores').catch(() => null),
    // La estrategia (B4): sin config legible no se pinta la forma — editar
    // sobre un "valor actual" inventado guardaría a ciegas.
    safe(() => getConfig(tenantId)),
  ]);

  async function guardarEstrategia(_previo: ResultadoEstrategia, fd: FormData): Promise<ResultadoEstrategia> {
    'use server';
    const s = await resolverTenantEfectivo('/dashboard/agentes/conductores', sp);
    if (!puedeVerRuta(s.rol, '/dashboard/agentes/conductores') || !puedeAdministrar(s.rol)) {
      return { ok: false, error: 'Solo el dueño de la flota cambia la estrategia del agente.' };
    }
    try {
      const horas = validarHorasEscalacion(String(fd.get('horasEscalacion') ?? ''));
      await guardarEstrategiaAgente(s.tenantId, { conductores: { horasEscalacion: horas } }, { id: s.userId });
      revalidatePath('/dashboard/agentes/conductores');
      return { ok: true, mensaje: `Listo: se escala a las ${horas} horas sin confirmación, desde la siguiente corrida.` };
    } catch (e) {
      return { ok: false, error: mensajeParaPantalla(e, 'guardar la estrategia') };
    }
  }

  const ahora = ahoraMs();
  const vivos = viajes.filter((v) => v.estatus === 'abierto' || v.estatus === 'en_cuadre');

  // La cola honesta: avisados que no han dicho que sí (y aún no se escalan).
  const esperan: EsperaAceptar[] = vivos
    .filter((v) => v.avisadoEn !== null && v.aceptadoEn === null && v.escaladoEn === null)
    .map((v) => ({
      id: v.id,
      folio: v.folio,
      operadorNombre: v.operadorNombre,
      horasDesdeAviso: Math.floor((ahora - Date.parse(v.avisadoEn as string)) / 3_600_000),
      avisos: v.avisosEnviados,
    }))
    .sort((a, b) => b.horasDesdeAviso - a.horasDesdeAviso);

  const sinAvisar = vivos.filter((v) => v.avisadoEn === null && v.operadorNombre !== null).length;

  return (
    <VistaAgenteConductores
      kpis={{
        vivos: vivos.length,
        aceptados: vivos.filter((v) => v.aceptadoEn !== null).length,
        esperan: esperan.length,
        escalados,
      }}
      esperan={esperan}
      sinAvisar={sinAvisar}
      eventos={eventos}
      sufijo={sufijoTenant(sp)}
      notificaciones={
        <>
          {/* La estrategia (B4): solo el dueño la edita, y solo con la config
              actual legible — sin ella, la forma guardaría a ciegas. */}
          {puedeAdministrar(rol) && config !== null && (
            <FormaEstrategiaConductores accion={guardarEstrategia}
              horasActuales={config.agentes.conductores.horasEscalacion} />
          )}
          <FichaCorridas corridas={corridas} />
          <SeccionNotificaciones tenantId={tenantId} agenteId="conductores" />
        </>
      }
    />
  );
}
