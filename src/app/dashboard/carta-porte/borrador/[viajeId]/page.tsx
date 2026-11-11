import { getT } from '@/lib/i18n/servidor';
import { trEs, type Tr } from '@/lib/i18n/dinero_tr';
import type { Metadata } from 'next';
import { Download } from 'lucide-react';
import { redirect, notFound } from 'next/navigation';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta, puedeVerArea } from '@/lib/auth/visibilidad';
import { getBorradorViaje, type ViajeCcp } from '@/lib/likida/carta_porte_datos';
import { numero } from '@/lib/formato';
import { Aviso, AvisoCompacto, BotonEnlace, EstadoVacio, FilaTarjetas, Icono, StatusChip, TablaBase, Tarjeta } from '@/app/ui-v2/componentes';
import { EsqueletoFicha } from '@/app/ui-v2/esqueletos';
import '../../carta-porte.css';
import type { PropsCifra } from '@/app/ui-v2/graficas';
import { cifrasUniformes } from '../../../formato';
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
 * FICHA (F26, ronda 2): el borrador sigue el esqueleto de Ficha de Rovaq (eyebrow, h1 con «Volver», tarjeta de chips, tira de cifras, bloques
 * en dos columnas y tablas relacionadas). Ya no es una hoja angosta: la impresión la resuelven las variantes `print:` de Tailwind para lo que
 * no va en papel (XML, timbre) y el marco del panel. La guarda `borrador_hoja_impresion.test.ts` fija el esqueleto.
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

  const campos = v.checklist.campos;
  const delResp = (r: 'cliente' | 'transportista') => campos.filter((c) => c.responsable === r);
  const capturados = (r: 'cliente' | 'transportista') => delResp(r).filter((c) => c.presente === true).length;
  const validacion = b.borrador === null ? tr('cartaPorte.borrador.viajeId.page.cifraSinArmar') : b.fallas.length === 0 ? tr('cartaPorte.borrador.viajeId.page.cifraPasa') : tr('cartaPorte.borrador.viajeId.page.cifraFallas', { n: numero(b.fallas.length) });
  const cifras: PropsCifra[] = [
    { etiqueta: tr('cartaPorte.borrador.viajeId.page.cifraMercancias'), valor: v.mercancias.length, matiz: 8 },
    { etiqueta: tr('cartaPorte.borrador.viajeId.page.cifraCliente'), valor: `${numero(capturados('cliente'))} / ${numero(delResp('cliente').length)}`, matiz: 3 },
    { etiqueta: tr('cartaPorte.borrador.viajeId.page.cifraTransportista'), valor: `${numero(capturados('transportista'))} / ${numero(delResp('transportista').length)}`, matiz: 3 },
    { etiqueta: tr('cartaPorte.borrador.viajeId.page.cifraValidacion'), valor: validacion, matiz: b.borrador !== null && b.fallas.length > 0 ? 6 : 5, tono: b.borrador !== null && b.fallas.length > 0 ? 'bad' : undefined },
  ];
  const veredicto = v.decision.necesita === 'si' ? tr('cartaPorte.borrador.viajeId.page.necesitaComplemento') : v.decision.necesita === 'no' ? tr('cartaPorte.borrador.viajeId.page.sinComplementoSegunLo') : tr('cartaPorte.borrador.viajeId.page.faltaDeclararParaDecidir');

  return (
    <EsqueletoFicha
      area={tr('cartaPorte.borrador.viajeId.page.area')}
      titulo={tr('cartaPorte.borrador.viajeId.page.borradorDeComplementoCarta', { rotulo })}
      volver={{ href: `${RUTA_PADRE}${sufijoTenant(sp)}`, etiqueta: tr('cartaPorte.borrador.viajeId.page.volverACartaPorte') }}
      chips={(
        <>
          <li><StatusChip tono={v.decision.necesita === 'si' ? 'warn' : v.decision.necesita === 'no' ? 'ok' : 'neutral'}>{veredicto}</StatusChip></li>
          {b.borrador !== null ? <li><StatusChip tono={b.fallas.length === 0 ? 'ok' : 'bad'}>{validacion}</StatusChip></li> : null}
        </>
      )}
      descripcion={`${v.origen && v.destino ? `${v.origen} → ${v.destino}` : tr('cartaPorte.borrador.viajeId.page.rutaSinCapturar')}${v.unidadEconomico ? ' ' + tr('cartaPorte.borrador.viajeId.page.unidad', { unidadEconomico: v.unidadEconomico }) : ''}${v.operadorNombre ? ' ' + tr('cartaPorte.borrador.viajeId.page.operador', { operadorNombre: v.operadorNombre }) : ''}`}
      avisos={<AvisoCompacto tono="warn" resumen={tr('cartaPorte.borrador.viajeId.page.documentoDeTrabajoNo')} />}
      cifras={cifrasUniformes(cifras)}
      etiquetaCifras={tr('cartaPorte.borrador.viajeId.page.los37DatosDel')}
      variante="6-6"
      bloques={[
        <Tarjeta key="veredicto" titulo={tr('cartaPorte.borrador.viajeId.page.veredicto')}>
          <p className="text-[13px]">
            {veredicto}{' '}
            <span className="text-[var(--muted)]">{v.decision.motivo}</span>{' '}
            <span className="text-[var(--faint)]">({v.decision.fundamento})</span>
          </p>
          <p className="text-[12px] text-[var(--muted)]">
            {tr('cartaPorte.borrador.viajeId.page.declaradoEnElViaje', { v: v.declarado.pisaFederal === null ? tr('cartaPorte.borrador.viajeId.page.sinDeclarar') : v.declarado.pisaFederal ? tr('cartaPorte.borrador.viajeId.page.sinMin') : tr('cartaPorte.borrador.viajeId.page.noMin'), v2: ' · ', v3: v.declarado.radioKm === null ? tr('cartaPorte.borrador.viajeId.page.sinDeclarar') : tr('cartaPorte.borrador.viajeId.page.radioKm', { km: numero(v.declarado.radioKm) }) })}
          </p>
        </Tarjeta>,
        <Tarjeta key="validacion" titulo={tr('cartaPorte.borrador.viajeId.page.validacionContraElRechazo')}>
          {b.borrador === null ? (
            <>
              <p className="text-[12px] text-[var(--muted)]">{tr('cartaPorte.borrador.viajeId.page.elBorradorAunNo')}</p>
              <Aviso tono="warn">
                <ul className="list-disc pl-5 text-[12px] space-y-1">
                  {b.faltantes.map((f) => <li key={f}>{f}</li>)}
                </ul>
              </Aviso>
            </>
          ) : b.fallas.length === 0 ? (
            <div className="space-y-2">
              <p className="text-[12px] text-[var(--ok)]">
                {tr('cartaPorte.borrador.viajeId.page.elBorradorPasaLas', { v: numero(b.borrador.pesoBrutoTotal), v2: numero(b.borrador.numTotalMercancias), v3: numero(b.borrador.totalDistRec) })}
              </p>
              {/* FASE D (export): el XML solo se ofrece con el borrador validado — la ruta vuelve a validar de todos modos (fail-closed doble). */}
              <p className="print:hidden">
                <BotonEnlace
                  href={`/api/export/carta-porte-xml${sufijoTenant(sp) ? `${sufijoTenant(sp)}&` : '?'}viaje=${v.viajeId}`}
                  tamano="sm"
                  icono={<Icono icono={Download} />}
                >
                  {tr('cartaPorte.borrador.viajeId.page.descargarXmlParaTimbrar')}
                </BotonEnlace>
                <span className="block text-[11px] mt-1 text-[var(--faint)]">{tr('cartaPorte.borrador.viajeId.page.esteXmlSeTimbra')}</span>
              </p>
            </div>
          ) : (
            <>
              <p className="text-[12px] text-[var(--muted)]">{tr('cartaPorte.borrador.viajeId.page.elBorradorSeArmo')}</p>
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
        </Tarjeta>,
      ]}
    >
      <Tarjeta titulo={tr('cartaPorte.borrador.viajeId.page.mercancias', { v: numero(v.mercancias.length) })} className="rv-tarjeta--tabla">
        {v.mercancias.length === 0 ? (
          <EstadoVacio contenido titulo={tr('cartaPorte.borrador.viajeId.page.sinRenglonesCapturadosEl')} />
        ) : (
          <TablaBase
            etiqueta={tr('cartaPorte.borrador.viajeId.page.mercanciasDelBorradorDe')} altoMaximo={false}
            filas={v.mercancias} idFila={(m) => m.id}
            columnas={[
              { id: 'descripcion', titulo: tr('cartaPorte.borrador.viajeId.page.descripcion'), principal: true, celda: (m) => m.descripcion },
              { id: 'clave', titulo: tr('cartaPorte.borrador.viajeId.page.claveSat'), celda: (m) => <span>{m.bienesTransp ?? hueco(tr('cartaPorte.borrador.viajeId.page.sinClave'))}</span> },
              { id: 'cantidad', titulo: tr('cartaPorte.borrador.viajeId.page.cantidad'), celda: (m) => <span>{numero(m.cantidad)}</span> },
              { id: 'unidad', titulo: tr('cartaPorte.borrador.viajeId.page.unidad2'), celda: (m) => <span>{m.claveUnidad ?? hueco(tr('cartaPorte.borrador.viajeId.page.sinUnidad'))}</span> },
              { id: 'peso', titulo: tr('cartaPorte.borrador.viajeId.page.pesoKg'), celda: (m) => <span>{m.pesoKg !== null ? numero(m.pesoKg) : hueco(tr('cartaPorte.borrador.viajeId.page.sinPeso'))}</span> },
              { id: 'peligroso', titulo: tr('cartaPorte.borrador.viajeId.page.peligroso'), celda: (m) => m.materialPeligroso === true ? tr('cartaPorte.borrador.viajeId.page.si') : m.materialPeligroso === false ? tr('cartaPorte.borrador.viajeId.page.no') : hueco(tr('cartaPorte.borrador.viajeId.page.sinDeclarar')) },
            ]}
          />
        )}
      </Tarjeta>

      <FilaTarjetas variante="6-6">
        <Tarjeta titulo={tr('cartaPorte.borrador.viajeId.page.delCliente19')} className="rv-tarjeta--tabla">
          <p className="text-[11px] text-[var(--muted)]">{tr('cartaPorte.borrador.viajeId.page.laRegla27')}</p>
          <TablaCampos tr={tr} v={v} responsable="cliente" />
        </Tarjeta>
        <Tarjeta titulo={tr('cartaPorte.borrador.viajeId.page.delTransportista18')} className="rv-tarjeta--tabla">
          <TablaCampos tr={tr} v={v} responsable="transportista" />
        </Tarjeta>
      </FilaTarjetas>

      {/* FASE D vía PAC (0226/0227): el timbre NO se emite desde aquí. Esta pantalla es del jefe de tráfico (área `operacion`) y el CFDI —con el
          flete, el IVA y la retención— es del contador (área `dinero`). Solo se pinta el camino, y solo para quien ve esa área: al encargado esta
          sección no le aparece, que es exactamente el punto. */}
      {puedeVerArea(rol, 'dinero') && (
        <Tarjeta titulo={tr('cartaPorte.borrador.viajeId.page.timbre')} className="print:hidden"
          acciones={(
            <BotonEnlace href={`${RUTA_TIMBRADO}/${v.viajeId}${sufijoTenant(sp)}`} variante="secondary" tamano="sm">
              {tr('cartaPorte.borrador.viajeId.page.irATimbradoDe')}
            </BotonEnlace>
          )}>
          <p className="text-[12px] text-[var(--muted)]">{tr('cartaPorte.borrador.viajeId.page.elCfdiConEste')}</p>
        </Tarjeta>
      )}
    </EsqueletoFicha>
  );
}

/** Un dato que falta se marca con un chip de advertencia (mismo lenguaje que el resto del producto), no con texto ocre suelto. */
function hueco(texto: string) {
  return <StatusChip tono="warn">{texto}</StatusChip>;
}

function TablaCampos({ v, responsable, tr = trEs }: { v: ViajeCcp; responsable: 'cliente' | 'transportista'; tr?: Tr }) {
  const campos = v.checklist.campos.filter((c) => c.responsable === responsable);
  return (
    <div>
      <TablaBase
        etiqueta={responsable} altoMaximo={false} filas={campos} idFila={(c) => c.clave}
        columnas={[
          { id: 'dato', titulo: tr('cartaPorte.borrador.viajeId.page.dato'), principal: true, celda: (c) => c.rotulo },
          {
            id: 'valor', titulo: tr('cartaPorte.borrador.viajeId.page.valor'),
            celda: (c) => (
              <span>
                {c.presente === true
                  ? (c.valor ?? 'capturado')
                  : c.presente === false
                    ? hueco('falta')
                    : hueco(tr('cartaPorte.borrador.viajeId.page.sinCasillaEnLikida'))}
              </span>
            ),
          },
        ]}
      />
    </div>
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const { t: tr } = await getT('dinero');
  return { title: tr('meta.cartaPorte.borrador.viajeId') };
}
