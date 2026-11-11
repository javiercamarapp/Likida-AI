import { getT } from '@/lib/i18n/servidor';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Aviso, BotonEnlace, EstadoError, StatusChip, TablaBase, type ColumnaBase } from '@/app/ui-v2/componentes';
import { EsqueletoTablaMaestra } from '@/app/ui-v2/esqueletos';
import './timbrado.css';
import { selloHoy } from '@/app/dashboard/sello-hoy';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { puedeTimbrar } from '@/lib/auth/permisos';
import { estadoPac } from '@/lib/likida/pac';
import { listarTimbrado, type RenglonTimbrado } from '@/lib/likida/carta_porte_timbre';
import { logger } from '@/lib/logger';
import { sufijoTenant } from '../sufijo';
import type { Metadata } from 'next';
export async function generateMetadata(): Promise<Metadata> {
  const { t: tr } = await getT('dinero');
  return { title: tr('meta.timbrado') };
}

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
  const { t: tr } = await getT('dinero');
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

  const detalleTimbre = (f: RenglonTimbrado): string => (f.timbre === null
    ? tr('timbrado.page.sinTimbre2')
    : f.timbre.estado === 'pendiente'
      ? f.timbre.uuidFiscal !== null
        ? tr('timbrado.page.timbreAMedioRegistrar', { uuidFiscal: f.timbre.uuidFiscal })
        : tr('timbrado.page.intentoDeTimbradoEn')
      : tr('timbrado.page.timbradoFolio', { v: f.timbre.modo === 'sandbox' ? ' ' + tr('timbrado.page.dePruebaNoAmpara') : '', v2: f.timbre.uuidFiscal ?? '—' }));

  const columnas: ColumnaBase<RenglonTimbrado>[] = [
    { id: 'viaje', titulo: tr('e26.timb_viaje'), principal: true, celda: (f) => <Link href={`${RUTA}/${f.viajeId}${sufijo}`} className="rv-timb__enlace">{f.folio ?? f.viajeId.slice(0, 8)}</Link> },
    { id: 'ruta', titulo: tr('e26.timb_ruta'), celda: (f) => <span className="rv-timb__texto">{f.origen && f.destino ? `${f.origen} → ${f.destino}` : tr('timbrado.page.rutaSinCapturar')}</span> },
    { id: 'timbre', titulo: tr('e26.timb_timbre'), celda: (f) => <span className="rv-timb__tenue">{detalleTimbre(f)}</span> },
    {
      id: 'estado', titulo: tr('e26.timb_estado'),
      celda: (f) => (
        <StatusChip tono={f.timbre === null ? 'muted' : f.timbre.estado === 'pendiente' ? 'bad' : f.timbre.modo === 'sandbox' ? 'warn' : 'ok'}>
          {f.timbre === null ? tr('timbrado.page.sinTimbre') : f.timbre.estado === 'pendiente' ? tr('timbrado.page.bloqueado') : tr('timbrado.page.timbrado')}
        </StatusChip>
      ),
    },
  ];

  return (
    <EsqueletoTablaMaestra
      titulo={tr('timbrado.page.cartaPorte')}
      apoyo={pac.configurado
        ? `PAC ${pac.proveedor?.toUpperCase()} conectado — ambiente ${pac.pareceSandbox ? tr('timbrado.page.dePruebasLosTimbres') : tr('timbrado.page.deProduccion')}.`
        : tr('timbrado.page.sinPacConfiguradoEl')}
      avisos={!puedeTimbrar(rol) ? <Aviso tono="warn">{tr('timbrado.page.puedesVerEstaCola')}</Aviso> : undefined}
      cifras={filas && filas.length > 0 ? [
        { etiqueta: tr('timbrado.page.enLaCola'), info: 'timbrado.en_cola', valor: filas.length },
        { etiqueta: tr('timbrado.page.sinTimbre'), info: 'timbrado.sin_timbre', valor: filas.filter((f) => f.timbre === null).length },
        { etiqueta: tr('timbrado.page.timbrados'), info: 'timbrado.timbrados', valor: filas.filter((f) => f.timbre?.estado === 'vigente').length },
        { etiqueta: tr('timbrado.page.bloqueados'), info: 'timbrado.bloqueados', valor: filas.filter((f) => f.timbre?.estado === 'pendiente').length, tono: filas.some((f) => f.timbre?.estado === 'pendiente') ? 'bad' : undefined },
      ] : undefined}
      etiquetaCifras={tr('timbrado.page.viajesEnLaCola')} selloCifras={selloHoy(tr('timbrado.page.selloCola'))}
      pie={<>{filas && filas.length > 0 ? <>{tr('timbrado.page.primeroLoQuePide')}<br /></> : null}{tr('timbrado.page.estaColaListaLos')}</>}
    >
      {filas === null ? (
        <EstadoError>{tr('timbrado.page.noSePudoLeer')}</EstadoError>
      ) : (
        <TablaBase
          etiqueta={tr('timbrado.page.viajesEnLaCola')} columnas={columnas} filas={filas} idFila={(f) => f.viajeId} densa altoMaximo={false} tarjetaMovil
          vacio={{
            titulo: tr('timbrado.page.nadaEnLaCola'), texto: tr('timbrado.page.aquiAparecenLosViajes'),
            accion: puedeVerRuta(rol, '/dashboard/carta-porte')
              ? <BotonEnlace href={`/dashboard/carta-porte${sufijo}`} variante="secondary" tamano="sm">{tr('timbrado.page.irACartaPorte')}</BotonEnlace>
              : undefined,
          }}
        />
      )}
    </EsqueletoTablaMaestra>
  );
}
