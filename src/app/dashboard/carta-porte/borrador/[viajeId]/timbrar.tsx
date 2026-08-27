import { revalidatePath } from 'next/cache';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import type { ViajeCcp } from '@/lib/likida/carta_porte_datos';
import { armarCfdiTimbrable } from '@/lib/likida/carta_porte_cfdi';
import { generarIdCcp } from '@/lib/likida/carta_porte';
import { leerContextoTimbre, timbrarViaje, guardarReceptorFiscal } from '@/lib/likida/carta_porte_timbre';
import { mensajeParaPantalla } from '@/lib/likida/administracion';
import { sufijoTenant } from '../../../sufijo';
import { FormaConAviso, Campo, Selector, type ResultadoAccion } from '../../../../admin/ui/forma';

/**
 * LA SECCIÓN DE TIMBRE del borrador (0226) — el botón que convierte el
 * borrador validado en CFDI timbrado, con TODAS sus verdades a la vista:
 *
 *   · Sin PAC configurado la sección lo dice y no hay botón — jamás se
 *     simula un timbre.
 *   · Con faltantes, la lista dice QUÉ y DÓNDE se captura (el perfil del
 *     emisor vive con el contador; los datos del receptor se capturan aquí
 *     mismo porque el cliente es de este viaje).
 *   · El timbre sandbox se rotula como lo que es: una prueba que no ampara
 *     nada.
 *   · El botón lo aprieta un humano; la acción re-lee y re-valida todo — el
 *     estado de esta pantalla pudo envejecer.
 */

const t = (v: FormDataEntryValue | null): string | null => {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
};

export async function SeccionTimbrado({ v, searchParams }: {
  v: ViajeCcp;
  searchParams: { tenant?: string; rol?: string; vista?: string };
}) {
  const RUTA_PADRE = '/dashboard/carta-porte';
  const { tenantId } = await resolverTenantEfectivo(RUTA_PADRE, searchParams);

  // Un error de lectura aquí LANZA (error boundary de la página): operar el
  // timbre a ciegas es peor que no pintar la sección.
  const ctx = await leerContextoTimbre(tenantId, v.viajeId);
  if (ctx === null) return null;

  const rutaActual = `${RUTA_PADRE}/borrador/${v.viajeId}`;

  async function timbrar(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const s = await resolverTenantEfectivo(RUTA_PADRE, searchParams);
    if (!puedeVerRuta(s.rol, RUTA_PADRE)) return { error: 'Tu rol no puede timbrar.' };
    const metodo = String(fd.get('metodoPago')) === 'PUE' ? 'PUE' as const : 'PPD' as const;
    // Con PPD la forma ES 99 (Anexo 20) — el selector de forma solo aplica a PUE.
    const forma = metodo === 'PPD' ? '99' : (t(fd.get('formaPago')) ?? '');
    const r = await timbrarViaje(s.tenantId, v.viajeId, { metodoPago: metodo, formaPago: forma }, { id: s.userId });
    revalidatePath(rutaActual);
    if (!r.ok) {
      const detalle = r.faltantes && r.faltantes.length > 0 ? ` · ${r.faltantes.join(' · ')}` : '';
      return { error: `${r.motivo}${detalle}` };
    }
    return {
      ok: r.yaExistia
        ? `Este viaje ya tenía su timbre: ${r.uuid} (${r.modo}).`
        : `Timbrado ${r.modo === 'sandbox' ? 'DE PRUEBA (no ampara nada)' : ''} — folio fiscal ${r.uuid}.`,
    };
  }

  async function guardarReceptor(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const s = await resolverTenantEfectivo(RUTA_PADRE, searchParams);
    if (!puedeVerRuta(s.rol, RUTA_PADRE)) return { error: 'Tu rol no puede capturar los datos fiscales del cliente.' };
    const clienteId = t(fd.get('clienteId'));
    if (clienteId === null) return { error: 'El viaje no tiene cliente asignado — asígnalo antes de capturar sus datos fiscales.' };
    try {
      await guardarReceptorFiscal(s.tenantId, clienteId, {
        razonSocial: t(fd.get('razonSocial')),
        regimenFiscal: t(fd.get('regimenFiscal')),
        usoCfdi: t(fd.get('usoCfdi'))?.toUpperCase() ?? null,
        cpFiscal: t(fd.get('cpFiscal')),
      }, { id: s.userId });
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'guardar los datos fiscales del cliente') };
    }
    revalidatePath(rutaActual);
    return { ok: 'Datos fiscales del cliente guardados.' };
  }

  // ── Timbre ya emitido: el hecho, citable, con su descarga ────────────────
  if (ctx.timbreVigente !== null) {
    const tv = ctx.timbreVigente;
    return (
      <section className="space-y-2 print:hidden">
        <h2 className="font-display text-[15px] font-semibold">Timbre</h2>
        <p className="text-[12.5px]">
          {tv.modo === 'sandbox' ? 'Timbre DE PRUEBA (sandbox — no ampara ningún traslado). ' : 'Timbrado. '}
          Folio fiscal <span className="font-mono">{tv.uuidFiscal}</span> · {tv.fechaTimbrado} · PAC {tv.proveedor.toUpperCase()}.
        </p>
        <a
          className="inline-block text-[12.5px] font-medium hover:opacity-75"
          style={{ color: 'var(--marca)' }}
          href={`/api/export/carta-porte-xml${sufijoTenant(searchParams) ? `${sufijoTenant(searchParams)}&` : '?'}viaje=${v.viajeId}&timbrado=1`}
        >
          Descargar XML timbrado ↓
        </a>
      </section>
    );
  }

  // ── Sin PAC: la verdad y cero botones ────────────────────────────────────
  if (!ctx.pac.configurado) {
    return (
      <section className="space-y-2 print:hidden">
        <h2 className="font-display text-[15px] font-semibold">Timbre</h2>
        <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>
          Sin PAC configurado: el timbrado directo está apagado (se enciende con las variables
          LIKIDA_PAC_* del servidor). Mientras tanto, el XML de arriba se descarga y se timbra en tu
          facturador — Likida jamás simula un timbre.
        </p>
      </section>
    );
  }

  // ── El ensayo en seco: la MISMA función que arma el CFDI dice qué falta ──
  const ensayo = armarCfdiTimbrable(v, generarIdCcp(), ctx.emisor, ctx.receptor, ctx.ingresoFlete, { metodoPago: 'PPD', formaPago: '99' });

  return (
    <section className="space-y-3 print:hidden">
      <h2 className="font-display text-[15px] font-semibold">Timbre</h2>
      <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>
        PAC {ctx.pac.proveedor?.toUpperCase()} · ambiente {ctx.emisor.modo === 'sandbox' ? 'SANDBOX (timbres de prueba)' : 'PRODUCCIÓN'}.
        El CFDI sale del borrador validado + tu perfil fiscal (panel del contador) + los datos fiscales del cliente.
      </p>

      {!ensayo.ok && (
        <div className="space-y-1">
          <p className="text-[12.5px] font-medium" style={{ color: 'var(--warn)' }}>Para timbrar falta:</p>
          <ul className="text-[12px] list-disc pl-5 space-y-0.5" style={{ color: 'var(--muted)' }}>
            {ensayo.faltantes.map((f) => <li key={f}>{f}</li>)}
          </ul>
        </div>
      )}

      {ctx.clienteId !== null && (
        <details className="rounded-lg hairline px-3 py-2">
          <summary className="text-[12.5px] font-medium cursor-pointer">Datos fiscales del cliente (receptor)</summary>
          <div className="pt-2">
            <FormaConAviso accion={guardarReceptor} boton="Guardar datos del cliente" columnas="md:grid-cols-2">
              <input type="hidden" name="clienteId" value={ctx.clienteId} />
              <Campo nombre="razonSocial" etiqueta="Razón social (exacta a SU constancia)" valorInicial={ctx.receptor.razonSocial ?? ''} />
              <Campo nombre="regimenFiscal" etiqueta="Régimen fiscal (clave)" valorInicial={ctx.receptor.regimenFiscal ?? ''} placeholder="601" />
              <Campo nombre="usoCfdi" etiqueta="Uso CFDI" valorInicial={ctx.receptor.usoCfdi ?? ''} placeholder="S01 o G03" />
              <Campo nombre="cpFiscal" etiqueta="CP fiscal" valorInicial={ctx.receptor.cpFiscal ?? ''} placeholder="64000" />
            </FormaConAviso>
          </div>
        </details>
      )}

      {ensayo.ok && (
        <div className="space-y-1">
          <p className="text-[12px]" style={{ color: 'var(--muted)' }}>
            Flete {String(ensayo.subTotal)} + IVA 16% {String(ensayo.iva)}
            {ensayo.retencionIva !== null ? ` − retención IVA 4% ${String(ensayo.retencionIva)} (receptor persona moral, LIVA 1-A II c)` : ''}
            {' '}= <span className="font-medium">Total {String(ensayo.total)} MXN</span>.
          </p>
          <FormaConAviso accion={timbrar} boton={ctx.emisor.modo === 'sandbox' ? 'Timbrar (PRUEBA)' : 'Timbrar'} columnas="md:grid-cols-2">
            <Selector nombre="metodoPago" etiqueta="Método de pago" valorInicial="PPD" opciones={[
              { valor: 'PPD', texto: 'PPD — pago en parcialidades/diferido (forma 99)' },
              { valor: 'PUE', texto: 'PUE — pago en una exhibición' },
            ]} />
            <Campo nombre="formaPago" etiqueta="Forma de pago (solo con PUE)" placeholder="03 transferencia · 01 efectivo" ayuda="Con PPD se envía 99 «Por definir» (Anexo 20)." />
          </FormaConAviso>
        </div>
      )}
    </section>
  );
}
