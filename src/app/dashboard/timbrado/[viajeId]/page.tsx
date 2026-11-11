import { getT } from '@/lib/i18n/servidor';
import type { Metadata } from 'next';
import { redirect, notFound } from 'next/navigation';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { getBorradorViaje } from '@/lib/likida/carta_porte_datos';
import { numero } from '@/lib/formato';
import { sufijoTenant } from '../../sufijo';
import { Aviso, BotonEnlace, Chip } from '@/app/ui-v2/componentes';
import '../timbrado.css';
import { EsqueletoFicha } from '@/app/ui-v2/esqueletos';
import { SeccionTimbrado } from './timbrar';

export const dynamic = 'force-dynamic';
// El PAC puede tardar hasta 20 s de autenticación + 20 s de timbrado (pac/sw.ts): las
// server actions de esta página (timbrar, liberar el bloqueo) corren bajo ESTE límite.
// Sin declararlo dependían del default de la plataforma (auditoría ola 1, #26).
export const maxDuration = 60;

// La ruta REAL es dinámica (/dashboard/timbrado/<uuid>); el gate usa la llave
// de su padre — misma área, mismos datos, mismo criterio que /dashboard/<uuid>
// gateando su área a mano (ver visibilidad.ts).
const RUTA = '/dashboard/timbrado';

/**
 * EL TIMBRE DE UN VIAJE (0227 — auditoría Fable c6-3).
 *
 * Vive en `dinero` y no en `operacion` por una razón sola: emitir el CFDI es
 * un acto fiscal irreversible con los importes del flete adentro. Antes el
 * botón colgaba del borrador de Carta Porte, que es del jefe de tráfico — y
 * eso le daba a ese puesto tanto el poder de timbrar como la vista del flete,
 * el IVA y el total.
 *
 * ESTA PANTALLA NO SUSTITUYE AL BORRADOR. El borrador sigue siendo del jefe
 * de tráfico: ahí se declara la ruta, se corrigen los 37 datos del Apéndice 3
 * y se lee el veredicto del validador. Aquí solo se emite, y lo que falte se
 * dice con el mismo texto que el borrador ya enseña (misma función).
 */
export default async function PaginaTimbradoViaje({
  params, searchParams,
}: {
  params: Promise<{ viajeId: string }>;
  searchParams: Promise<{ tenant?: string; rol?: string; vista?: string }>;
}) {
  const { t: tr } = await getT('dinero');
  const [{ viajeId }, sp] = await Promise.all([params, searchParams]);
  const { tenantId, rol } = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(rol, RUTA)) redirect('/dashboard');

  // Un error de lectura LANZA adentro (error boundary); null = no es de esta
  // flota o no existe — 404 honesto, jamás la ficha de otro tenant.
  const v = await getBorradorViaje(tenantId, viajeId);
  if (!v) notFound();

  const rotulo = v.folio ?? v.viajeId.slice(0, 8);
  // El paso 1 es un hecho leído del propio borrador, no una promesa: armado y sin fallas del validador.
  const borradorListo = v.borrador.borrador !== null && v.borrador.fallas.length === 0;

  return (
    <EsqueletoFicha
      area={tr('e26b.timb_ficha')}
      titulo={tr('timbrado.viajeId.page.tituloViaje', { rotulo })}
      apoyo={tr('e26b.timb_apoyo')}
      volver={{ href: `${RUTA}${sufijoTenant(sp)}`, etiqueta: tr('timbrado.viajeId.page.volverATimbrado') }}
      acciones={(
        <BotonEnlace href={`/dashboard/carta-porte/borrador/${v.viajeId}${sufijoTenant(sp)}`} variante="secondary" tamano="sm">
          {tr('timbrado.viajeId.page.verElBorradorCompleto')}
        </BotonEnlace>
      )}
      chips={(
        <>
          <li><Chip>{v.origen && v.destino ? `${v.origen} → ${v.destino}` : tr('timbrado.viajeId.page.rutaSinCapturar')}</Chip></li>
          <li><Chip>{tr('e26.timb_mercancias', { n: numero(v.mercancias.length) })}</Chip></li>
          {v.unidadEconomico ? <li><Chip>{tr('e26.timb_unidad', { u: v.unidadEconomico })}</Chip></li> : null}
          {v.operadorNombre ? <li><Chip>{tr('e26b.timb_operador', { n: v.operadorNombre })}</Chip></li> : null}
          {v.clienteNombre ? <li><Chip>{tr('e26b.timb_cliente', { n: v.clienteNombre })}</Chip></li> : null}
        </>
      )}
      avisos={(
        <Aviso tono="warn">
          {tr('timbrado.viajeId.page.timbrarEmiteUnCfdi')}
        </Aviso>
      )}
    >
      <section className="rv-esq__paso rv-timb__paso" aria-label={tr('e26b.timb_paso_borrador')}>
        <div className="rv-esq__paso-cab">
          <h2>{tr('e26b.timb_paso_borrador')}</h2>
          <Chip tono={borradorListo ? 'ok' : 'warn'} tamano="estado">{borradorListo ? tr('e26b.timb_paso_hecho') : tr('e26b.timb_paso_revisar')}</Chip>
        </div>
        <p className="rv-esq__paso-quien">{borradorListo ? tr('e26b.timb_borrador_ok') : tr('e26b.timb_borrador_falta', { n: numero(v.borrador.faltantes.length + v.borrador.fallas.length) })}</p>
      </section>
      <SeccionTimbrado v={v} searchParams={sp} />
    </EsqueletoFicha>
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const { t: tr } = await getT('dinero');
  return { title: tr('meta.timbrado.viajeId') };
}
