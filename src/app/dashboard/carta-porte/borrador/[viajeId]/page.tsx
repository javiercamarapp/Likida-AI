import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta, puedeVerArea } from '@/lib/auth/visibilidad';
import { getBorradorViaje, type ViajeCcp } from '@/lib/likida/carta_porte_datos';
import { numero } from '@/lib/formato';
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
        <Link href={`${RUTA_PADRE}${sufijoTenant(sp)}`} className="text-[12.5px] font-medium hover:opacity-75" style={{ color: 'var(--marca)' }}>
          ← Volver a Carta Porte
        </Link>
        <p className="text-[11px] text-right" style={{ color: 'var(--faint)' }}>
          Para imprimir o guardar como PDF: Ctrl/Cmd + P.
        </p>
      </div>

      <header className="space-y-1">
        <h1 className="font-display text-[19px] font-semibold">
          Borrador de Complemento Carta Porte 3.1 — viaje {rotulo}
        </h1>
        <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>
          {v.origen && v.destino ? `${v.origen} → ${v.destino}` : 'Ruta sin capturar'}
          {v.unidadEconomico ? ` · Unidad ${v.unidadEconomico}` : ''}
          {v.operadorNombre ? ` · Operador ${v.operadorNombre}` : ''}
        </p>
        <p className="text-[12px] px-3 py-2 rounded-lg hairline" style={{ color: 'var(--warn)' }}>
          DOCUMENTO DE TRABAJO. No es un CFDI, no está timbrado y no ampara ningún traslado: es el
          paquete que se le entrega al PAC de la flota para emitir el complemento. La fecha estimada de
          llegada y el IdCCP son artefactos de la emisión y se declaran ahí.
        </p>
      </header>

      <section className="space-y-1">
        <h2 className="font-display text-[15px] font-semibold">Veredicto</h2>
        <p className="text-[12.5px]">
          {v.decision.necesita === 'si' ? 'NECESITA complemento.' : v.decision.necesita === 'no' ? 'Sin complemento, según lo declarado.' : 'Falta declarar para decidir.'}{' '}
          <span style={{ color: 'var(--muted)' }}>{v.decision.motivo}</span>{' '}
          <span style={{ color: 'var(--faint)' }}>({v.decision.fundamento})</span>
        </p>
        <p className="text-[12px]" style={{ color: 'var(--muted)' }}>
          Declarado en el viaje: pisa federal = {v.declarado.pisaFederal === null ? 'sin declarar' : v.declarado.pisaFederal ? 'sí' : 'no'}
          {' · '}radio federal = {v.declarado.radioKm === null ? 'sin declarar' : `${numero(v.declarado.radioKm)} km`}.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-display text-[15px] font-semibold">Mercancías ({numero(v.mercancias.length)})</h2>
        {v.mercancias.length === 0 ? (
          <p className="text-[12.5px]" style={{ color: 'var(--warn)' }}>
            Sin renglones capturados — el complemento exige al menos uno. Se capturan en la pantalla de
            Carta Porte, con los datos que da tu cliente.
          </p>
        ) : (
          // FE-34: sin overflow-x-auto, seis columnas desbordan en 390 px.
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left" style={{ color: 'var(--faint)' }}>
                  <th className="py-1 pr-3 font-medium">Descripción</th>
                  <th className="py-1 pr-3 font-medium">Clave SAT</th>
                  <th className="py-1 pr-3 font-medium">Cantidad</th>
                  <th className="py-1 pr-3 font-medium">Unidad</th>
                  <th className="py-1 pr-3 font-medium">Peso (kg)</th>
                  <th className="py-1 font-medium">Peligroso</th>
                </tr>
              </thead>
              <tbody>
                {v.mercancias.map((m) => (
                  <tr key={m.id} className="align-top">
                    <td className="py-1 pr-3">{m.descripcion}</td>
                    <td className="py-1 pr-3 cifra-mono">{m.bienesTransp ?? hueco('sin clave')}</td>
                    <td className="py-1 pr-3 cifra-mono">{numero(m.cantidad)}</td>
                    <td className="py-1 pr-3 cifra-mono">{m.claveUnidad ?? hueco('sin unidad')}</td>
                    <td className="py-1 pr-3 cifra-mono">{m.pesoKg !== null ? numero(m.pesoKg) : hueco('sin peso')}</td>
                    <td className="py-1">{m.materialPeligroso === true ? 'Sí' : m.materialPeligroso === false ? 'No' : hueco('sin declarar')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-display text-[15px] font-semibold">Los 37 datos del Apéndice 3, por responsable</h2>
        <p className="text-[11.5px]" style={{ color: 'var(--muted)' }}>
          La regla 2.7.7.1.1 limita la responsabilidad de cada parte ante el SAT a los datos que esa
          parte aportó — por eso cada dato dice de quién es.
        </p>
        <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2">
          <TablaCampos v={v} responsable="cliente" titulo="Del cliente (19)" />
          <TablaCampos v={v} responsable="transportista" titulo="Del transportista (18)" />
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="font-display text-[15px] font-semibold">Validación contra el rechazo del PAC</h2>
        {b.borrador === null ? (
          <>
            <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>
              El borrador aún no se puede armar. Falta:
            </p>
            <ul className="list-disc pl-5 text-[12.5px] space-y-1" style={{ color: 'var(--warn)' }}>
              {b.faltantes.map((f) => <li key={f}>{f}</li>)}
            </ul>
          </>
        ) : b.fallas.length === 0 ? (
          <div className="space-y-2">
            <p className="text-[12.5px]" style={{ color: 'var(--ok)' }}>
              El borrador pasa las validaciones aritméticas y estructurales del Estándar CCP 3.1
              (sección 8) que el PAC rechaza seguro. Peso bruto total: {numero(b.borrador.pesoBrutoTotal)} kg
              · {numero(b.borrador.numTotalMercancias)} mercancía(s) · distancia {numero(b.borrador.totalDistRec)} km.
            </p>
            {/* FASE D (export): el XML solo se ofrece con el borrador validado —
                la ruta vuelve a validar de todos modos (fail-closed doble). */}
            <p className="print:hidden">
              <a
                href={`/api/export/carta-porte-xml${sufijoTenant(sp) ? `${sufijoTenant(sp)}&` : '?'}viaje=${v.viajeId}`}
                className="inline-block text-[12.5px] font-medium px-3 py-1.5 rounded-lg hairline hover:opacity-80"
                style={{ color: 'var(--marca)' }}
              >
                Descargar XML para timbrar ↓
              </a>
              <span className="block text-[11px] mt-1" style={{ color: 'var(--faint)' }}>
                Este XML se timbra en tu facturador — Likida no timbra. Lo que el archivo no trae
                (sello, importes del flete, datos del emisor) lo completa tu facturador; el propio
                archivo lo lista en su encabezado.
              </span>
            </p>
          </div>
        ) : (
          <>
            <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>
              El borrador se armó, pero el PAC lo rechazaría por esto:
            </p>
            <ul className="list-disc pl-5 text-[12.5px] space-y-1" style={{ color: 'var(--bad)' }}>
              {b.fallas.map((f) => <li key={`${f.campo}:${f.detalle}`}><strong>{f.campo}</strong>: {f.detalle} <span style={{ color: 'var(--faint)' }}>({f.fundamento})</span></li>)}
            </ul>
          </>
        )}
        {b.advertencias.length > 0 && (
          <ul className="list-disc pl-5 text-[12px] space-y-1" style={{ color: 'var(--warn)' }}>
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
          <h2 className="font-display text-[15px] font-semibold">Timbre</h2>
          <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>
            El CFDI con este complemento se emite desde Timbrado, con los importes del flete y el
            perfil fiscal de la flota enfrente — el botón vive ahí porque timbrar es un acto fiscal,
            no un acto de despacho.
          </p>
          <p>
            <Link
              href={`${RUTA_TIMBRADO}/${v.viajeId}${sufijoTenant(sp)}`}
              className="text-[12.5px] font-medium hover:opacity-75"
              style={{ color: 'var(--marca)' }}
            >
              Ir a Timbrado de este viaje →
            </Link>
          </p>
        </section>
      )}
    </main>
  );
}

function hueco(texto: string) {
  return <em style={{ color: 'var(--warn)' }}>{texto}</em>;
}

function TablaCampos({ v, responsable, titulo }: { v: ViajeCcp; responsable: 'cliente' | 'transportista'; titulo: string }) {
  const campos = v.checklist.campos.filter((c) => c.responsable === responsable);
  return (
    <div>
      <h3 className="text-[11px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--muted)' }}>{titulo}</h3>
      <table className="w-full text-[11.5px]">
        <tbody>
          {campos.map((c) => (
            <tr key={c.clave} className="align-top">
              <td className="py-0.5 pr-3" style={{ color: 'var(--muted)' }}>{c.rotulo}</td>
              <td className="py-0.5 cifra-mono">
                {c.presente === true
                  ? (c.valor ?? 'capturado')
                  : c.presente === false
                    ? hueco('falta')
                    : hueco('sin casilla en Likida')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
