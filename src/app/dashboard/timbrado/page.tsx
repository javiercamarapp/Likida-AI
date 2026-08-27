import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Stamp } from 'lucide-react';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { puedeTimbrar } from '@/lib/auth/permisos';
import { estadoPac } from '@/lib/likida/pac';
import { listarTimbrado, type RenglonTimbrado } from '@/lib/likida/carta_porte_timbre';
import { numero } from '@/lib/formato';
import { logger } from '@/lib/logger';
import { sufijoTenant } from '../sufijo';

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
    <main className="max-w-3xl mx-auto px-6 py-8 space-y-5">
      <header className="space-y-1">
        <div className="flex items-center gap-2">
          <Stamp size={16} style={{ color: 'var(--marca)' }} aria-hidden />
          <h1 className="font-display text-[19px] font-semibold">Timbrado</h1>
        </div>
        <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>
          {pac.configurado
            ? `PAC ${pac.proveedor?.toUpperCase()} conectado — ambiente ${pac.pareceSandbox ? 'de PRUEBAS (los timbres no amparan nada)' : 'de PRODUCCIÓN'}.`
            : 'Sin PAC configurado: el timbrado directo está apagado (variables LIKIDA_PAC_* del servidor). Likida jamás simula un timbre.'}
        </p>
        {!puedeTimbrar(rol) && (
          <p className="text-[12px]" style={{ color: 'var(--warn)' }}>
            Puedes ver esta cola, pero emitir el CFDI es del dueño de la flota o del contador.
          </p>
        )}
      </header>

      {filas === null ? (
        <p className="text-[12.5px]" style={{ color: 'var(--warn)' }}>
          No se pudo leer la cola de timbrado. No es «no hay nada»: es que no se pudo mirar —
          reintenta.
        </p>
      ) : filas.length === 0 ? (
        <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>
          Nada en la cola todavía. Aquí aparecen los viajes cuyo borrador de Carta Porte ya se
          trabajó (su XML se generó al menos una vez) y los que ya tienen timbre o un intento vivo.
          El borrador se arma en Carta Porte, con el jefe de tráfico.
        </p>
      ) : (
        <section className="space-y-2">
          <p className="text-[12px]" style={{ color: 'var(--faint)' }}>
            {numero(filas.length)} en la cola. Primero lo que pide acción.
          </p>
          <ul className="space-y-1.5">
            {filas.map((f) => (
              <li key={f.viajeId} className="rounded-lg hairline px-3 py-2">
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
                <p className="text-[11.5px]" style={{ color: 'var(--faint)' }}>
                  {f.timbre === null
                    ? 'Sin timbre.'
                    : f.timbre.estado === 'pendiente'
                      ? f.timbre.uuidFiscal !== null
                        ? `TIMBRE A MEDIO REGISTRAR — folio ${f.timbre.uuidFiscal}. No lo vuelvas a timbrar; avisa a soporte.`
                        : 'Intento de timbrado en curso o sin respuesta del PAC — bloqueado a propósito.'
                      : `Timbrado${f.timbre.modo === 'sandbox' ? ' DE PRUEBA (no ampara nada)' : ''} · folio ${f.timbre.uuidFiscal ?? '—'}`}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-[11.5px]" style={{ color: 'var(--faint)' }}>
        Esta cola lista los viajes cuyo XML de Carta Porte ya se generó alguna vez y los que ya
        tienen timbre o reserva. NO es «todos los viajes que necesitan complemento»: eso lo decide
        el borrador viaje por viaje, y afirmarlo aquí sería inventar una lista que nadie midió.
      </p>
    </main>
  );
}
