import { getT } from '@/lib/i18n/servidor';
import { trEs, type Tr } from '@/lib/i18n/dinero_tr';
import type { Metadata } from 'next';
import { ArrowLeft, Download } from 'lucide-react';
import { redirect, notFound } from 'next/navigation';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta, puedeVerArea } from '@/lib/auth/visibilidad';
import { getBorradorViaje, type ViajeCcp } from '@/lib/likida/carta_porte_datos';
import { numero } from '@/lib/formato';
import { BotonEnlace, Icono } from '@/app/ui-v2/componentes';
import { sufijoTenant } from '../../../sufijo';

export const dynamic = 'force-dynamic';

// La ruta REAL es dinámica (/dashboard/carta-porte/borrador/<uuid>); el gate
// usa la llave de su padre — misma área, mismos datos, mismo criterio que
// /dashboard/<uuid> gateando su área a mano (ver visibilidad.ts).
const RUTA_PADRE = '/dashboard/carta-porte';
/** El timbre se emite del otro lado, en `dinero` (0227 — auditoría Fable
 *  c6-3). Aquí solo se pinta el link, y solo para quien ve esa área. */
const RUTA_TIMBRADO = '/dashboard/timbrado';

/**
 * EXCEPCION DE MARCO (decision del orquestador, 11-nov-2026): esta ruta es una HOJA PARA IMPRIMIR, no una pantalla del panel. No lleva
 * el marco de pantalla (sin sidebar ni cabecera en el papel) y por eso conserva su `<main>` y su propio titulo h1. Sin `style=`; la impresion la
 * resuelven solo las variantes `print:` de Tailwind. La guarda `borrador_hoja_impresion.test.ts` fija la excepcion.
 *
 * EL ENTREGABLE DE LA FASE C: la vista imprimible del borrador — los 37 datos
 * del Apéndice 3 con su responsable y su valor (o su hueco), las mercancías
 * renglón por renglón, y el resultado del validador de rechazo seguro.
 *
 * LO QUE ESTE PAPEL NO ES (y lo dice en tinta): NO es un CFDI, NO es un
 * complemento timbrado y NO ampara ningún traslado. Es el paquete de trabajo
 * que la flota le lleva a su PAC para que el timbrado no rebote — Likida no
 * timbra (0049).
 */
export default async function PaginaBorradorCcp({
  params, searchParams,
}: {
  params: Promise<{ viajeId: string }>;
  searchParams: Promise<{ tenant?: string; rol?: string; vista?: string }>;
}) {
  const { t: tr } = await getT('dinero');
  const [{ viajeId }, sp] = await Promise.all([params, searchParams]);
  const { tenantId, rol } = await resolverTenantEfectivo(RUTA_PADRE, sp);
  if (!puedeVerRuta(rol, RUTA_PADRE)) redirect('/dashboard');

  // Un error de lectura LANZA adentro (error boundary); null = no es de esta
  // flota o no existe — 404 honesto, jamás la ficha de otro tenant.
  const v = await getBorradorViaje(tenantId, viajeId);
  if (!v) notFound();

  const b = v.borrador;
  const rotulo = v.folio ?? v.viajeId.slice(0, 8);

  return (
    <main className="max-w-3xl mx-auto px-6 py-8 space-y-5 print:px-0 print:py-0">
      <div className="flex items-start justify-between gap-4 print:hidden">
        <BotonEnlace href={`${RUTA_PADRE}${sufijoTenant(sp)}`} variante="ghost" tamano="sm" icono={<Icono icono={ArrowLeft} tam={14} />}>
          {tr('cartaPorte.borrador.viajeId.page.volverACartaPorte')}
        </BotonEnlace>
        <p className="text-[11px] text-right text-[var(--faint)]">
          {tr('cartaPorte.borrador.viajeId.page.paraImprimirOGuardar')}
        </p>
      </div>

      <header className="space-y-1">
        <h1 className="font-display text-[20px] font-semibold">
          {tr('cartaPorte.borrador.viajeId.page.borradorDeComplementoCarta', { rotulo })}
        </h1>
        <p className="text-[12px] text-[var(--muted)]">
          {v.origen && v.destino ? `${v.origen} → ${v.destino}` : tr('cartaPorte.borrador.viajeId.page.rutaSinCapturar')}
          {v.unidadEconomico ? ' ' + tr('cartaPorte.borrador.viajeId.page.unidad', { unidadEconomico: v.unidadEconomico }) : ''}
          {v.operadorNombre ? ' ' + tr('cartaPorte.borrador.viajeId.page.operador', { operadorNombre: v.operadorNombre }) : ''}
        </p>
        <p className="text-[12px] px-3 py-2 rounded-lg hairline text-[var(--warn)]">
          {tr('cartaPorte.borrador.viajeId.page.documentoDeTrabajoNo')}
        </p>
      </header>

      <section className="space-y-1">
        <h2 className="font-display text-[15px] font-semibold">{tr('cartaPorte.borrador.viajeId.page.veredicto')}</h2>
        <p className="text-[12px]">
          {v.decision.necesita === 'si' ? tr('cartaPorte.borrador.viajeId.page.necesitaComplemento') : v.decision.necesita === 'no' ? tr('cartaPorte.borrador.viajeId.page.sinComplementoSegunLo') : tr('cartaPorte.borrador.viajeId.page.faltaDeclararParaDecidir')}{' '}
          <span className="text-[var(--muted)]">{v.decision.motivo}</span>{' '}
          <span className="text-[var(--faint)]">({v.decision.fundamento})</span>
        </p>
        <p className="text-[12px] text-[var(--muted)]">
          {tr('cartaPorte.borrador.viajeId.page.declaradoEnElViaje', { v: v.declarado.pisaFederal === null ? tr('cartaPorte.borrador.viajeId.page.sinDeclarar') : v.declarado.pisaFederal ? tr('cartaPorte.borrador.viajeId.page.sinMin') : tr('cartaPorte.borrador.viajeId.page.noMin'), v2: ' · ', v3: v.declarado.radioKm === null ? tr('cartaPorte.borrador.viajeId.page.sinDeclarar') : tr('cartaPorte.borrador.viajeId.page.radioKm', { km: numero(v.declarado.radioKm) }) })}
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-display text-[15px] font-semibold">{tr('cartaPorte.borrador.viajeId.page.mercancias', { v: numero(v.mercancias.length) })}</h2>
        {v.mercancias.length === 0 ? (
          <p className="text-[12px] text-[var(--warn)]">
            {tr('cartaPorte.borrador.viajeId.page.sinRenglonesCapturadosEl')}
          </p>
        ) : (
          // FE-34: sin overflow-x-auto, seis columnas desbordan en 390 px.
          <div className="overflow-x-auto">
            <table aria-label={tr('cartaPorte.borrador.viajeId.page.mercanciasDelBorradorDe')} className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-[var(--faint)]">
                  <th scope="col" className="py-1 pr-3 font-medium">{tr('cartaPorte.borrador.viajeId.page.descripcion')}</th>
                  <th scope="col" className="py-1 pr-3 font-medium">{tr('cartaPorte.borrador.viajeId.page.claveSat')}</th>
                  <th scope="col" className="py-1 pr-3 font-medium">{tr('cartaPorte.borrador.viajeId.page.cantidad')}</th>
                  <th scope="col" className="py-1 pr-3 font-medium">{tr('cartaPorte.borrador.viajeId.page.unidad2')}</th>
                  <th scope="col" className="py-1 pr-3 font-medium">{tr('cartaPorte.borrador.viajeId.page.pesoKg')}</th>
                  <th scope="col" className="py-1 font-medium">{tr('cartaPorte.borrador.viajeId.page.peligroso')}</th>
                </tr>
              </thead>
              <tbody>
                {v.mercancias.map((m) => (
                  <tr key={m.id} className="align-top">
                    <td className="py-1 pr-3">{m.descripcion}</td>
                    <td className="py-1 pr-3 cifra-mono">{m.bienesTransp ?? hueco(tr('cartaPorte.borrador.viajeId.page.sinClave'))}</td>
                    <td className="py-1 pr-3 cifra-mono">{numero(m.cantidad)}</td>
                    <td className="py-1 pr-3 cifra-mono">{m.claveUnidad ?? hueco(tr('cartaPorte.borrador.viajeId.page.sinUnidad'))}</td>
                    <td className="py-1 pr-3 cifra-mono">{m.pesoKg !== null ? numero(m.pesoKg) : hueco(tr('cartaPorte.borrador.viajeId.page.sinPeso'))}</td>
                    <td className="py-1">{m.materialPeligroso === true ? tr('cartaPorte.borrador.viajeId.page.si') : m.materialPeligroso === false ? tr('cartaPorte.borrador.viajeId.page.no') : hueco(tr('cartaPorte.borrador.viajeId.page.sinDeclarar'))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-display text-[15px] font-semibold">{tr('cartaPorte.borrador.viajeId.page.los37DatosDel')}</h2>
        <p className="text-[11px] text-[var(--muted)]">
          {tr('cartaPorte.borrador.viajeId.page.laRegla27')}
        </p>
        <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2">
          <TablaCampos tr={tr} v={v} responsable="cliente" titulo={tr('cartaPorte.borrador.viajeId.page.delCliente19')} />
          <TablaCampos tr={tr} v={v} responsable="transportista" titulo={tr('cartaPorte.borrador.viajeId.page.delTransportista18')} />
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="font-display text-[15px] font-semibold">{tr('cartaPorte.borrador.viajeId.page.validacionContraElRechazo')}</h2>
        {b.borrador === null ? (
          <>
            <p className="text-[12px] text-[var(--muted)]">
              {tr('cartaPorte.borrador.viajeId.page.elBorradorAunNo')}
            </p>
            <ul className="list-disc pl-5 text-[12px] space-y-1 text-[var(--warn)]">
              {b.faltantes.map((f) => <li key={f}>{f}</li>)}
            </ul>
          </>
        ) : b.fallas.length === 0 ? (
          <div className="space-y-2">
            <p className="text-[12px] text-[var(--ok)]">
              {tr('cartaPorte.borrador.viajeId.page.elBorradorPasaLas', { v: numero(b.borrador.pesoBrutoTotal), v2: numero(b.borrador.numTotalMercancias), v3: numero(b.borrador.totalDistRec) })}
            </p>
            {/* FASE D (export): el XML solo se ofrece con el borrador validado —
                la ruta vuelve a validar de todos modos (fail-closed doble). */}
            <p className="print:hidden">
              <BotonEnlace
                href={`/api/export/carta-porte-xml${sufijoTenant(sp) ? `${sufijoTenant(sp)}&` : '?'}viaje=${v.viajeId}`}
                tamano="sm"
                icono={<Icono icono={Download} />}
              >
                {tr('cartaPorte.borrador.viajeId.page.descargarXmlParaTimbrar')}
              </BotonEnlace>
              <span className="block text-[11px] mt-1 text-[var(--faint)]">
                {tr('cartaPorte.borrador.viajeId.page.esteXmlSeTimbra')}
              </span>
            </p>
          </div>
        ) : (
          <>
            <p className="text-[12px] text-[var(--muted)]">
              {tr('cartaPorte.borrador.viajeId.page.elBorradorSeArmo')}
            </p>
            <ul className="list-disc pl-5 text-[12px] space-y-1 text-[var(--bad)]">
              {b.fallas.map((f) => <li key={`${f.campo}:${f.detalle}`}><strong>{f.campo}</strong>: {f.detalle} <span className="text-[var(--faint)]">({f.fundamento})</span></li>)}
            </ul>
          </>
        )}
        {b.advertencias.length > 0 && (
          <ul className="list-disc pl-5 text-[12px] space-y-1 text-[var(--warn)]">
            {b.advertencias.map((a) => <li key={a}>{a}</li>)}
          </ul>
        )}
      </section>

      {/* FASE D vía PAC (0226/0227): el timbre NO se emite desde aquí. Esta
          pantalla es del jefe de tráfico (área `operacion`) y el CFDI —con el
          flete, el IVA y la retención— es del contador (área `dinero`). Solo
          se pinta el camino, y solo para quien ve esa área: al encargado esta
          sección no le aparece, que es exactamente el punto. */}
      {puedeVerArea(rol, 'dinero') && (
        <section className="space-y-1 print:hidden">
          <h2 className="font-display text-[15px] font-semibold">{tr('cartaPorte.borrador.viajeId.page.timbre')}</h2>
          <p className="text-[12px] text-[var(--muted)]">
            {tr('cartaPorte.borrador.viajeId.page.elCfdiConEste')}
          </p>
          <p>
            <BotonEnlace href={`${RUTA_TIMBRADO}/${v.viajeId}${sufijoTenant(sp)}`} variante="ghost" tamano="sm">
              {tr('cartaPorte.borrador.viajeId.page.irATimbradoDe')}
            </BotonEnlace>
          </p>
        </section>
      )}
    </main>
  );
}

function hueco(texto: string) {
  return <em className="text-[var(--warn)]">{texto}</em>;
}

function TablaCampos({ v, responsable, titulo, tr = trEs }: { v: ViajeCcp; responsable: 'cliente' | 'transportista'; titulo: string; tr?: Tr }) {
  const campos = v.checklist.campos.filter((c) => c.responsable === responsable);
  return (
    <div>
      <h3 className="text-[11px] font-semibold uppercase tracking-wide mb-1.5 text-[var(--muted)]">{titulo}</h3>
      <table aria-label={titulo} className="w-full text-[11px]">
        <tbody>
          {campos.map((c) => (
            <tr key={c.clave} className="align-top">
              <td className="py-0.5 pr-3 text-[var(--muted)]">{c.rotulo}</td>
              <td className="py-0.5 cifra-mono">
                {c.presente === true
                  ? (c.valor ?? 'capturado')
                  : c.presente === false
                    ? hueco('falta')
                    : hueco(tr('cartaPorte.borrador.viajeId.page.sinCasillaEnLikida'))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const { t: tr } = await getT('dinero');
  return { title: tr('meta.cartaPorte.borrador.viajeId') };
}
