import { requireSessionTenant } from '@/lib/auth/guard';
import Link from 'next/link';
import { LEYENDA_CORTA } from '@/lib/cuadra/cuadre/leyendas';
import { notFound, redirect } from 'next/navigation';
import { getLiquidacionDetalle } from '@/lib/cuadra/analytics';
import { etiquetaConcepto } from '@/lib/cuadra/cuadre/engine';
import { filasDeducibilidad } from '@/lib/cuadra/liquidacion/deducibilidad';
import { mxn } from '@/lib/utils';
import { litros, fechaMx } from '../formato';
import { puedeExportar, puedeAsignar } from '@/lib/auth/permisos';
import { listOperadores, reasignarOperador } from '@/lib/cuadra/repo';

export const dynamic = 'force-dynamic';

// Este mapa YA NO pinta el renglón: lo pinta `etiquetaGasto` (abajo), que
// delega en el motor. Se queda como traducción de respaldo y como el mapa que
// `etiquetas_sincronizadas.test.ts` mantiene a la par de `label()` del motor.
// Se desincronizó una vez al partir 'viaticos' en tres: el contralor veía
// "hospedaje" en minúscula cruda en su tabla.
const CONCEPTO: Record<string, string> = {
  diesel: 'Diésel', caseta: 'Caseta', factura: 'Factura',
  alimentacion: 'Alimentación', hospedaje: 'Hospedaje', transporte: 'Transporte', flete: 'Flete',
  viaticos: 'Viáticos', otro: 'Otro',
};
const ESTATUS: Record<string, { label: string; color: string }> = {
  cuadrada: { label: 'Cuadrada', color: 'var(--color-ok)' },
  con_diferencias: { label: 'Con diferencias', color: 'var(--color-warn)' },
  revisar: { label: 'Por revisar', color: 'var(--color-bad)' },
};

export default async function Detalle({ params }: { params: Promise<{ id: string }> }) {
  // Segunda capa (ver dashboard/page.tsx). El id va en la ruta de vuelta para
  // que tras el passcode aterrice en la liquidación que pidió.
  const { id: idParaVolver } = await params;
  const { tenantId, rol } = await requireSessionTenant(`/dashboard/${idParaVolver}`);
  const { id } = await params;
  const d = await getLiquidacionDetalle(id, tenantId);
  if (!d) notFound();
  const e = ESTATUS[d.estatus] ?? { label: d.estatus, color: 'var(--muted)' };
  const puedeReasignar = puedeAsignar(rol);
  const operadores = puedeReasignar ? await listOperadores(tenantId) : [];

  async function reasignar(formData: FormData) {
    'use server';
    // Repite la comprobación de permiso EN el server action: el `puedeAsignar`
    // de arriba solo decide si el <form> se pinta. Sin este segundo chequeo,
    // un contador que arme la petición a mano (misma sesión válida, sin el
    // botón) podría reasignar igual — el mismo criterio que ya usa
    // `requireSessionTenant` para no confiar solo en lo que el proxy filtra.
    const { tenantId: t, rol: r } = await requireSessionTenant(`/dashboard/${id}`);
    if (!puedeAsignar(r)) redirect(`/dashboard/${id}`);
    const operadorId = String(formData.get('operadorId') ?? '');
    if (!operadorId) redirect(`/dashboard/${id}`);
    await reasignarOperador(t, d!.viajeId, operadorId);
    redirect(`/dashboard/${id}`);
  }
  // LA FOTO DEL TICKET SE GUARDA (CFF art. 30, conservación 5 años) PERO NO SE
  // ENSEÑA AQUÍ. El aviso de privacidad (privacidad.ts:498) le promete al
  // operador que un dato sensible que aparezca por accidente en su ticket "no
  // se usa para nada" — pero ni `subirComprobante` ni nada en este flujo filtra
  // contenido sensible de la IMAGEN (solo del texto que el OCR extrae de ella,
  // ver sanitizar.ts). Enseñarla en un clic desde el panel del contralor sí es
  // "usarla": convertía la promesa en falsa. AUDITORÍA 9, CRÍTICO legal.
  const hayAcred = d.litrosDiesel > 0 || d.ieps > 0 || d.iva > 0 || d.peaje > 0;
  // Las tres cubetas SIEMPRE suman totalComprobado (types/cuadra.ts). Se le
  // pasa el total PERSISTIDO junto a las cubetas RECONSTRUIDAS a propósito: si
  // los dos no cuadran, `filasDeducibilidad` devuelve null y no se pinta nada.
  // Un desglose que contradice al total que tiene tres centímetros arriba es
  // peor que no tener desglose.
  const deducibilidad = d.deducibilidad
    ? filasDeducibilidad({ ...d.deducibilidad, totalComprobado: d.totalComprobado, diferencias: d.diferencias })
    : null;

  return (
    <div className="min-h-screen">
      <header className="glass sticky top-0 z-10 border-b" style={{ borderColor: 'var(--line)' }}>
        <div className="max-w-4xl mx-auto px-8 h-16 flex items-center justify-between">
          <Link href="/dashboard" className="text-base hover:opacity-70" style={{ color: 'var(--muted)' }}>← Panel</Link>
          <span className="text-xs px-2.5 py-1 rounded-full" style={{ color: 'var(--muted)', background: 'color-mix(in srgb, var(--muted) 10%, transparent)' }}>datos de demostración</span>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-8 py-10 space-y-9">
        <div className="flex items-end justify-between flex-wrap gap-3">
          <div>
            {/* Hora de México, no UTC: `.slice(0,10)` fechaba en agosto una
                liquidación cerrada el 31 de julio a las 20:00 (ver formato.ts). */}
            <div className="text-sm" style={{ color: 'var(--muted)' }}>Liquidación · {fechaMx(d.creadoEn)}</div>
            <h1 className="text-3xl font-semibold tracking-tight mt-1">{d.folio}</h1>
          </div>
          <div className="flex items-center gap-4">
            {/* El PDF existía, estaba autenticado y no había forma de llegar a
                él: `pdf_url` ni se seleccionaba (auditoría 5, frontend, MEDIO 5).
                En el demo, "¿me da el PDF?" se contestaba tecleando una URL. */}
            {d.pdfPath && puedeExportar(rol) && (
              <a href={`/api/export/pdf/${d.id}`} className="text-sm px-3.5 py-2 rounded-lg hairline hover:opacity-70">
                Descargar PDF
              </a>
            )}
            <span className="text-base flex items-center gap-2">
              <span className="inline-block w-3 h-3 rounded-full" style={{ background: e.color }} />{e.label}
            </span>
          </div>
        </div>

        {/* ── Chofer asignado / reasignar ──
            Solo dueño/encargado (permisos.ts: puedeAsignar) — un contador o un
            superadmin de paso por el tenant demo no mueve viajes de chofer.
            docs/superpowers/plans/2026-08-02-roles-flota.md, Task 3. */}
        <div className="flex items-center justify-between flex-wrap gap-3 -mt-4">
          <div className="text-sm" style={{ color: 'var(--muted)' }}>
            Chofer: <span style={{ color: 'var(--ink)' }} className="font-medium">{d.operadorNombre}</span>
          </div>
          {puedeReasignar && operadores.length > 0 && (
            <form action={reasignar} className="flex items-center gap-2">
              <select name="operadorId" defaultValue={d.operadorId}
                className="text-sm px-3 py-1.5 rounded-lg hairline" style={{ background: 'var(--surface)' }}>
                {operadores.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
              </select>
              <button type="submit" className="text-sm px-3 py-1.5 rounded-lg hairline hover:opacity-70">
                Reasignar chofer
              </button>
            </form>
          )}
        </div>

        {/* Totales grandes */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <Tot label="Comprobado" value={mxn(d.totalComprobado)} />
          <Tot label="Anticipo" value={mxn(d.totalAnticipo)} />
          <Tot
            label={d.diferencia > 0 ? 'A favor de la empresa' : d.diferencia < 0 ? 'A favor del operador' : 'Diferencia'}
            value={d.diferencia === 0 ? 'Cuadra exacto' : mxn(Math.abs(d.diferencia))}
            accent={d.diferencia !== 0}
          />
        </div>

        {/* ── De lo comprobado, cuánto sobrevive al SAT ──
            Este reparto es la razón por la que el contralor compra, y hasta hoy
            solo existía en el PDF: quien revisaba desde el navegador veía
            "Comprobado $47,300" y ahí terminaba (auditoría 5, frontend, ALTO 2).
            Los montos van en tinta normal salvo lo no deducible: `--color-ok`
            mide 2.22:1 sobre blanco y es la cifra que se proyecta en una sala
            iluminada. */}
        {deducibilidad && (
          <section>
            <h2 className="text-sm font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--muted)' }}>
              De lo comprobado, cuánto es deducible
            </h2>
            <div className="card divide-y" style={{ borderColor: 'var(--line)' }}>
              {deducibilidad.map((f) => (
                <div key={f.label} className="px-6 py-4 flex items-start justify-between gap-4">
                  <div>
                    <div className="text-base font-medium">{f.label}</div>
                    {f.pie && <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{f.pie}</div>}
                  </div>
                  <span className="tabular font-semibold whitespace-nowrap"
                    style={{ color: f.tono === 'malo' ? 'var(--color-bad)' : 'var(--ink)' }}>{mxn(f.monto)}</span>
                </div>
              ))}
            </div>
            <p className="text-xs mt-2" style={{ color: 'var(--muted)' }}>
              Estimación con la información capturada; la determinación final es de su contador.
            </p>
          </section>
        )}

        {/* Acreditables */}
        {hayAcred && (
          <section>
            <h2 className="text-sm font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--muted)' }}>Acreditable / recuperable</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {/* Litros, no pesos: el estímulo del LIF 20-A es cuota semanal del DOF
                  × litros y esa cuota no la tenemos. `ieps` solo puede venir de filas
                  viejas escritas antes del cambio; se conserva para no ocultarlas. */}
              {d.litrosDiesel > 0 && <Tot label="Diésel elegible para el estímulo" value={litros(d.litrosDiesel)} ok />}
              {d.ieps > 0 && <Tot label="IEPS de diésel (vs ISR)" value={mxn(d.ieps)} ok />}
              {d.iva > 0 && <Tot label="IVA acreditable" value={mxn(d.iva)} ok />}
              {d.peaje > 0 && <Tot label="Peaje 50%" value={mxn(d.peaje)} ok />}
            </div>
          </section>
        )}

        {/* Diferencias en lenguaje humano */}
        {d.diferencias.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--muted)' }}>Diferencias detectadas</h2>
            <div className="card divide-y" style={{ borderColor: 'var(--line)' }}>
              {d.diferencias.map((df, i) => (
                <div key={i} className="px-6 py-4 flex items-start justify-between gap-4" style={{ borderColor: 'var(--line)' }}>
                  <span className="text-base">{df.nota}</span>
                  {df.monto > 0 && <span className="tabular font-medium whitespace-nowrap">{mxn(df.monto)}</span>}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── Comprobantes ──
            La tabla arrancaba directo en <tbody>: tres celdas sueltas por fila
            para un lector de pantalla, y la columna del folio —que a veces es
            "—"— no se anunciaba como nada (auditoría 5, frontend, BAJO 2).
            Y sumaba $10,800 debajo de una tarjeta que decía $9,400: pintaba los
            duplicados que el motor excluye del total. Ahora los renglones son
            los mismos que imprime el PDF y el total va al pie, para que el
            contralor no tenga que sumar la columna con el dedo. */}
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--muted)' }}>Comprobantes</h2>
          {d.gastos.length === 0 ? (
            // Pasa de verdad: en el tenant del demo hay liquidaciones con total
            // guardado y cero filas en `gasto`. Una tabla con encabezados y nada
            // debajo se lee como "se perdieron los comprobantes"; esto dice qué
            // se sabe y qué no, sin afirmar ninguna de las dos cosas.
            <div className="card p-8 text-base" style={{ color: 'var(--muted)' }}>
              No hay comprobantes capturados en este viaje. El total de arriba es el que quedó
              guardado al cerrar la liquidación.
            </div>
          ) : (
          <div className="card overflow-x-auto">
            <table className="w-full text-base">
              <thead>
                <tr style={{ color: 'var(--muted)' }} className="text-left text-sm">
                  <th scope="col" className="px-6 py-3 font-medium">Concepto</th>
                  <th scope="col" className="px-6 py-3 font-medium">Folio</th>
                  <th scope="col" className="px-6 py-3 font-medium text-right">Monto</th>
                </tr>
              </thead>
              <tbody>
                {d.gastos.map((g, i) => (
                  <tr key={i} className="border-t" style={{ borderColor: 'var(--line)' }}>
                    <td className="px-6 py-3.5 font-medium">{etiquetaGasto(g)}</td>
                    <td className="px-6 py-3.5" style={{ color: 'var(--muted)' }}>{g.folio ?? '—'}</td>
                    <td className="px-6 py-3.5 text-right tabular">{mxn(g.monto)}</td>
                  </tr>
                ))}
              </tbody>
              {d.comprobantesCuadran && (
                <tfoot>
                  <tr className="border-t" style={{ borderColor: 'var(--line)' }}>
                    <th scope="row" colSpan={2} className="px-6 py-3.5 text-left font-semibold">Total comprobado</th>
                    <td className="px-6 py-3.5 text-right tabular font-semibold">{mxn(d.totalComprobado)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          )}
          {d.comprobantesExcluidos > 0 && (
            <p className="text-xs mt-2" style={{ color: 'var(--muted)' }}>
              {d.comprobantesExcluidos === 1
                ? 'Se excluyó 1 comprobante del total (duplicado o monto inválido); está explicado arriba, en las diferencias detectadas.'
                : `Se excluyeron ${d.comprobantesExcluidos} comprobantes del total (duplicados o montos inválidos); están explicados arriba, en las diferencias detectadas.`}
            </p>
          )}
          {!d.comprobantesCuadran && d.gastos.length > 0 && (
            <p className="text-xs mt-2" style={{ color: 'var(--muted)' }}>
              Renglones tal como se capturaron: no se pudo reconstruir la liquidación, así que
              esta columna puede no sumar el total de arriba.
            </p>
          )}
        </section>
        <p className="text-xs mt-10 pt-6 border-t" style={{ color: 'var(--muted)', borderColor: 'var(--line)' }}>
          {LEYENDA_CORTA}
        </p>
      </main>
    </div>
  );
}

/**
 * La etiqueta del renglón tiene que decir lo MISMO que el renglón del PDF.
 *
 * El PDF imprime `etiquetaConcepto`, que para combustible se salta el mapa y
 * respeta el producto impreso en el ticket: "Combustible Magna". El panel usaba
 * su copia literal y del mismo comprobante decía "Diésel" (auditoría 5,
 * arquitectura, ALTO 1). No es cosmética: el estímulo de IEPS es SOLO diésel
 * (LIF 20-A fr. IV), así que etiquetar gasolina como diésel invita a acreditar
 * algo que no aplica — exactamente lo que el motor documenta querer evitar.
 *
 * `etiquetaConcepto` devuelve la clave cruda cuando su mapa no conoce el
 * concepto; ahí —y solo ahí— entra el mapa local como red.
 */
function etiquetaGasto(g: { concepto: string; ocrExtra?: Record<string, unknown> }): string {
  const delMotor = etiquetaConcepto(g.concepto, g.ocrExtra);
  return delMotor === g.concepto ? (CONCEPTO[g.concepto] ?? g.concepto) : delMotor;
}

function Tot({ label, value, accent, ok }: { label: string; value: string; accent?: boolean; ok?: boolean }) {
  const color = ok ? 'var(--color-ok)' : accent ? 'var(--accent)' : 'var(--ink)';
  return (
    <div className="card p-6">
      <div className="text-3xl font-semibold tracking-tight tabular" style={{ color }}>{value}</div>
      <div className="text-sm mt-1.5" style={{ color: 'var(--muted)' }}>{label}</div>
    </div>
  );
}
