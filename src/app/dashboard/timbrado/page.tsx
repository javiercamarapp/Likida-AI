import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Aviso, MarcoPagina, StatusChip } from '@/app/ui-v2/componentes';
import { Cifra, TiraCifras } from '@/app/ui-v2/graficas';
import { selloHoy } from '@/app/dashboard/sello-hoy';
import { EstadoError, EstadoVacio } from '../estados';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { puedeTimbrar } from '@/lib/auth/permisos';
import { estadoPac } from '@/lib/likida/pac';
import { listarTimbrado, type RenglonTimbrado } from '@/lib/likida/carta_porte_timbre';
import { logger } from '@/lib/logger';
import { sufijoTenant } from '../sufijo';
import type { Metadata } from 'next';
export const metadata: Metadata = { title: 'Timbrado (Carta Porte)' };

export const dynamic = 'force-dynamic';

const RUTA = '/dashboard/timbrado';

/**
 * TIMBRADO — LA COLA (0227, auditoría Fable c6-3).
 *
 * Por aquí llega el CONTADOR al flujo de timbre desde su propia área. Hasta
 * hoy el único camino era el borrador de Carta Porte, que es `operacion`: el
 * contador —que declara el perfil fiscal en su panel y es quien firma— no
 * podía siquiera abrirlo, y el encargado sí podía timbrar.
 *
 * NO ENSEÑA PESOS aquí a propósito: los importes del CFDI viven un clic más
 * adentro, junto al botón que los emite. Esta pantalla es un índice.
 */
export default async function PaginaTimbrado({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string; rol?: string; vista?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(rol, RUTA)) redirect('/dashboard');

  const pac = estadoPac();
  const sufijo = sufijoTenant(sp);

  // Un fallo de lectura NO es "no hay nada que timbrar": se dice y se
  // distingue, que es el patrón de la casa para toda cola.
  let filas: RenglonTimbrado[] | null = null;
  try {
    filas = await listarTimbrado(tenantId);
  } catch (e) {
    logger.warn('timbrado.cola_no_leida', { tenantId, err: e instanceof Error ? e.message : String(e) });
  }

  return (
    <MarcoPagina
      titulo="Timbrado (Carta Porte)"
      ancho="lectura"
      apoyo={pac.configurado
        ? `PAC ${pac.proveedor?.toUpperCase()} conectado — ambiente ${pac.pareceSandbox ? 'de PRUEBAS (los timbres no amparan nada)' : 'de PRODUCCIÓN'}.`
        : 'Sin PAC configurado: el timbrado directo está apagado hasta que Likida lo configure. Likida jamás simula un timbre.'}
    >
      {!puedeTimbrar(rol) && (
        <Aviso tono="warn">Puedes ver esta cola, pero emitir el CFDI es del dueño de la flota o del contador.</Aviso>
      )}

      {filas === null ? (
        <EstadoError mensaje="No se pudo leer la cola de timbrado. No es «no hay nada»: es que no se pudo mirar." />
      ) : filas.length === 0 ? (
        <EstadoVacio
          titulo="Nada en la cola todavía"
          accion={puedeVerRuta(rol, '/dashboard/carta-porte') ? { href: `/dashboard/carta-porte${sufijo}`, texto: 'Ir a Carta Porte' } : undefined}
        >
          Aquí aparecen los viajes cuyo borrador de Carta Porte ya se trabajó y los que ya tienen timbre o un intento vivo.
          El borrador se arma en Carta Porte, con el jefe de tráfico.
        </EstadoVacio>
      ) : (
        <section className="space-y-3">
          <TiraCifras sello={selloHoy('Cola de timbrado')}>
            <Cifra etiqueta="En la cola" info="timbrado.en_cola" valor={filas.length} matiz={1} />
            <Cifra etiqueta="Sin timbre" info="timbrado.sin_timbre" valor={filas.filter((f) => f.timbre === null).length} matiz={2} />
            <Cifra etiqueta="Timbrados" info="timbrado.timbrados" valor={filas.filter((f) => f.timbre?.estado === 'vigente').length} matiz={3} />
            <Cifra etiqueta="Bloqueados" info="timbrado.bloqueados" valor={filas.filter((f) => f.timbre?.estado === 'pendiente').length} matiz={4} tono={filas.some((f) => f.timbre?.estado === 'pendiente') ? 'bad' : undefined} />
          </TiraCifras>
          <p className="text-[12px]" style={{ color: 'var(--faint)' }}>
            Primero lo que pide acción.
          </p>
          <ul className="space-y-1.5">
            {filas.map((f) => (
              <li key={f.viajeId} className="rounded-lg hairline px-3 py-2 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link
                    href={`${RUTA}/${f.viajeId}${sufijo}`}
                    className="text-[13px] font-medium hover:opacity-75"
                    style={{ color: 'var(--marca)' }}
                  >
                    {f.folio ?? f.viajeId.slice(0, 8)}
                  </Link>
                  <span className="text-[12px]" style={{ color: 'var(--muted)' }}>
                    {f.origen && f.destino ? ` · ${f.origen} → ${f.destino}` : ' · ruta sin capturar'}
                  </span>
                  <p className="text-[12px]" style={{ color: 'var(--faint)' }}>
                    {f.timbre === null
                      ? 'Sin timbre.'
                      : f.timbre.estado === 'pendiente'
                        ? f.timbre.uuidFiscal !== null
                          ? `TIMBRE A MEDIO REGISTRAR — folio ${f.timbre.uuidFiscal}. No lo vuelvas a timbrar; avisa a soporte.`
                          : 'Intento de timbrado en curso o sin respuesta del PAC — bloqueado a propósito.'
                        : `Timbrado${f.timbre.modo === 'sandbox' ? ' DE PRUEBA (no ampara nada)' : ''} · folio ${f.timbre.uuidFiscal ?? '—'}`}
                  </p>
                </div>
                <StatusChip tono={f.timbre === null ? 'muted' : f.timbre.estado === 'pendiente' ? 'bad' : f.timbre.modo === 'sandbox' ? 'warn' : 'ok'}>
                  {f.timbre === null ? 'Sin timbre' : f.timbre.estado === 'pendiente' ? 'Bloqueado' : 'Timbrado'}
                </StatusChip>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-[11px]" style={{ color: 'var(--faint)' }}>
        Esta cola lista los viajes cuyo XML de Carta Porte ya se generó alguna vez y los que ya
        tienen timbre o reserva. NO es «todos los viajes que necesitan complemento»: eso lo decide
        el borrador viaje por viaje, y afirmarlo aquí sería inventar una lista que nadie midió.
      </p>
    </MarcoPagina>
  );
}
