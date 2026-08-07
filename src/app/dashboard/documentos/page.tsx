import { ScanText, FileCheck2, ShieldAlert, Image as IconoImagen, ReceiptText } from 'lucide-react';
import { getDocumentos, type DocumentoRow } from '@/lib/likida/analytics';
import { etiquetaConcepto } from '@/lib/likida/cuadre/engine';
import { mxn } from '@/lib/utils';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerArea } from '@/lib/auth/visibilidad';
import { fechaMx } from '../formato';
import { KpiTile, EstadoVacio, StatusPill, type Estado } from '../../admin/ui/kit';
import { getPorFacturar, resumen as resumirFacturas, type TicketPorFacturar } from '@/lib/likida/facturacion/pendientes';
import { avisarPorFacturar } from '@/lib/likida/facturacion/avisar';
import { requireSessionTenant } from '@/lib/auth/guard';
import { puedeAsignar } from '@/lib/auth/permisos';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { resolverTenantPedido } from '@/lib/auth/tenant-api';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import { FormaConAviso, Campo, type ResultadoAccion } from '../../admin/ui/forma';
import { PorFacturar } from './por-facturar';

export const dynamic = 'force-dynamic';

/** Umbral bajo el cual el OCR pide que un humano confirme lo que leyó
 *  (human-in-the-loop, PASO 17). Es el mismo criterio que usa el flujo de
 *  WhatsApp para preguntar en vez de asumir. */
const CONFIANZA_BAJA = 0.7;

async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch { return null; }
}

/** Qué dice el SAT del CFDI de ese comprobante. `null` = no hay CFDI que
 *  validar (un ticket de papel sin factura), que NO es lo mismo que "no
 *  válido" — pintarlos igual haría ver como problema lo que es normal. */
function estadoSat(d: DocumentoRow): { label: string; estado: Estado } {
  if (d.efos) return { label: 'Emisor en lista EFOS', estado: 'bad' };
  if (!d.cfdiUuid) return { label: 'Sin CFDI', estado: 'neutral' };
  if (d.estadoSat === 'vigente') return { label: 'Vigente', estado: 'ok' };
  if (d.estadoSat === 'cancelado') return { label: 'Cancelado', estado: 'bad' };
  if (d.estadoSat) return { label: d.estadoSat, estado: 'warn' };
  return { label: 'Sin verificar', estado: 'warn' };
}

/**
 * Documentos / Agente OCR (PASO 17) — la bandeja real de `gasto`: cada fila
 * es un comprobante que entró por WhatsApp y que el agente leyó.
 *
 * `ocr_confianza` es la prueba de que pasó por el agente, no `ocr_raw`: esa
 * columna existe en el esquema pero está MUERTA (`repo.ts` nunca la escribe),
 * así que contarla daría "0 documentos procesados" con la tabla llena.
 */
export default async function DocumentosPage({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo('/dashboard/documentos', sp);
  // Área `operacion`: el encargado entra. El importe del comprobante es dinero y
  // la matriz de roles (0044) no se lo da — puede ver QUÉ documentos llegaron y
  // si el SAT los valida, que es su trabajo, sin ver por cuánto son.
  const veDinero = puedeVerArea(rol, 'dinero');
  const docs = await safe<DocumentoRow[]>(() => getDocumentos(tenantId));
  // El módulo de facturación (60 comercios, plazos, reconocedor) llevaba
  // construido desde el 27-jul sin que ninguna pantalla lo usara. Aquí se conecta.
  const porFacturar = await safe<TicketPorFacturar[]>(() => getPorFacturar(tenantId));

  /**
   * Le avisa al encargado qué falta por facturar, por WhatsApp.
   *
   * Repite el permiso adentro como el resto del panel, y `requireSessionTenant`
   * va FUERA del try porque redirige lanzando.
   */
  async function accionAvisar(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const s = await requireSessionTenant('/dashboard/documentos');
    if (!puedeAsignar(s.rol)) return { error: 'Tu rol no puede mandar avisos de facturación.' };

    let t = s.tenantId;
    if (s.rol === 'superadmin' && sp?.tenant) {
      t = await resolverTenantPedido(supabaseAdmin(), t, sp.tenant);
    }

    try {
      const r = await avisarPorFacturar({ tenantId: t, telefono: String(fd.get('telefono') ?? '').trim() });
      if (r.enviado) return { ok: `Aviso enviado: ${r.tickets} comprobante(s) por facturar.` };
      // NO se finge que salió. Un aviso que falla callado deja al encargado sin
      // saber que tiene tickets venciéndose.
      return { error: `${r.motivo} El aviso decía: "${r.texto.slice(0, 140)}${r.texto.length > 140 ? '…' : ''}"` };
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'mandar el aviso') };
    }
  }

  const conCfdi = docs?.filter((d) => d.cfdiUuid).length ?? 0;
  const bajaConfianza = docs?.filter((d) => d.ocrConfianza !== null && d.ocrConfianza < CONFIANZA_BAJA).length ?? 0;
  const conFoto = docs?.filter((d) => d.tieneImagen).length ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <header className="glass-panel flex items-center gap-2.5 px-5 py-4">
        <ScanText width={16} height={16} strokeWidth={1.75} />
        <div>
          <span className="text-sm font-medium block">Documentos (Agente OCR)</span>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>
            Cada comprobante que entró por WhatsApp y lo que el agente leyó de él
          </span>
        </div>
      </header>

      <div className="glass-panel overflow-hidden">
        {docs === null ? (
          <div className="p-8 text-sm" style={{ color: 'var(--muted)' }}>No se pudo cargar la bandeja de documentos.</div>
        ) : (
          <>
            <section className="p-5">
              <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
                La bandeja
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
                <KpiTile icono={<ScanText width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
                  etiqueta="Comprobantes procesados" valor={docs.length} formato="entero" />
                <KpiTile icono={<FileCheck2 width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
                  etiqueta="Con CFDI amarrado" valor={conCfdi} formato="entero"
                  nota="El resto son tickets sin factura — normal, no un error" />
                <KpiTile icono={<ShieldAlert width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
                  etiqueta="Con lectura de baja confianza" valor={bajaConfianza} formato="entero"
                  nota={`Bajo ${Math.round(CONFIANZA_BAJA * 100)}% — el agente prefiere preguntar antes que asumir`} />
                <KpiTile icono={<IconoImagen width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
                  etiqueta="Con foto guardada" valor={conFoto} formato="entero" />
              </div>
            </section>

            <div className="pt-5 pb-2 px-5 border-t" style={{ borderColor: 'var(--line)' }}>
              <h2 className="text-xs font-semibold uppercase tracking-wide m-0" style={{ color: 'var(--muted)' }}>
                Comprobantes
              </h2>
            </div>
            {docs.length === 0 ? (
              <div className="px-5 pb-5">
                <EstadoVacio icono={<ScanText width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
                  Todavía no ha entrado ningún comprobante. En cuanto un operador mande la primera foto por
                  WhatsApp, aparece aquí con lo que el agente leyó.
                </EstadoVacio>
              </div>
            ) : (
              <div className="overflow-x-auto mt-1 pb-2">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ color: 'var(--muted)' }} className="text-left">
                      <th className="px-5 py-2.5 font-medium">Concepto</th>
                      <th className="px-5 py-2.5 font-medium">Fecha</th>
                      <th className="px-5 py-2.5 font-medium">Folio</th>
                      <th className="px-5 py-2.5 font-medium">RFC emisor</th>
                      {veDinero && <th className="px-5 py-2.5 font-medium text-right">Importe</th>}
                      <th className="px-5 py-2.5 font-medium text-right">Confianza</th>
                      <th className="px-5 py-2.5 font-medium">SAT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {docs.map((d) => {
                      const sat = estadoSat(d);
                      const baja = d.ocrConfianza !== null && d.ocrConfianza < CONFIANZA_BAJA;
                      return (
                        <tr key={d.id} className="border-t" style={{ borderColor: 'var(--line)' }}>
                          <td className="px-5 py-3 font-medium">{etiquetaConcepto(d.concepto)}</td>
                          <td className="px-5 py-3" style={{ color: 'var(--muted)' }}>{fechaMx(d.fecha)}</td>
                          <td className="px-5 py-3 font-mono text-xs" style={{ color: 'var(--muted)' }}>{d.folio ?? '—'}</td>
                          <td className="px-5 py-3 font-mono text-xs" style={{ color: 'var(--muted)' }}>{d.rfcEmisor ?? '—'}</td>
                          {veDinero && <td className="px-5 py-3 text-right tabular">{mxn(d.monto)}</td>}
                          <td className="px-5 py-3 text-right tabular" style={baja ? { color: 'var(--warn)' } : undefined}>
                            {d.ocrConfianza === null ? '—' : `${Math.round(d.ocrConfianza * 100)}%`}
                          </td>
                          <td className="px-5 py-3"><StatusPill estado={sat.estado}>{sat.label}</StatusPill></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {docs.length >= 100 && (
                  <p className="text-xs px-5 pt-2" style={{ color: 'var(--muted)' }}>
                    Se muestran los 100 más recientes.
                  </p>
                )}
              </div>
            )}

            <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
              <div className="flex items-center gap-2 mb-3">
                <ReceiptText width={15} height={15} strokeWidth={1.75} />
                <h2 className="text-xs font-semibold uppercase tracking-wide m-0" style={{ color: 'var(--muted)' }}>
                  Por facturar
                </h2>
              </div>
              {porFacturar === null ? (
                <div className="text-sm" style={{ color: 'var(--muted)' }}>No se pudo leer qué falta por facturar.</div>
              ) : (
                <>
                  <PorFacturar tickets={porFacturar} resumen={resumirFacturas(porFacturar)} veDinero={veDinero} />
                  {porFacturar.length > 0 && (
                    <div className="mt-4 pt-4 border-t" style={{ borderColor: 'var(--line)' }}>
                      <h3 className="text-xs font-medium mb-2" style={{ color: 'var(--muted)' }}>
                        Avisarle al encargado por WhatsApp
                      </h3>
                      <FormaConAviso accion={accionAvisar} boton="Mandar aviso">
                        <Campo nombre="telefono" etiqueta="WhatsApp del encargado" requerido
                          placeholder="999 370 0779"
                          ayuda="Va UN mensaje con lo que urge, no uno por ticket." />
                      </FormaConAviso>
                    </div>
                  )}
                </>
              )}
            </section>

            <div className="px-5 pt-4 pb-5 border-t" style={{ borderColor: 'var(--line)' }}>
              <EstadoVacio>
                Confirmar a mano una lectura de baja confianza desde esta pantalla (hoy el agente lo pregunta por
                WhatsApp, que es donde está el operador) y la autofacturación automática de casetas y combustible
                —recuperar el XML sin que nadie lo pida— siguen en el roadmap.
              </EstadoVacio>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
