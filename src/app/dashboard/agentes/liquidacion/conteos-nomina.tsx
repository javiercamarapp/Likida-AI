import { Mail } from 'lucide-react';
import { hoyMx, inicioDiaMx } from '@/lib/formato';
import { contarParaNomina, type ConteosNomina } from '@/lib/likida/liquidacion_externa/repo';
import { Ficha, VistaDesgloses } from './desgloses';

// ═══════════════════════════════════════════════════════════════════════════
// LA VISTA DEL ROL `nomina` (0949) — Liquidaciones, SOLO CONTEOS.
//
// Nómina y RH ve cuántos desgloses llegaron, salieron, se retuvieron, rebotaron o esperan póliza. NADA más: ni un peso, ni un
// neto, ni el nombre de un operador, ni la lista de desgloses, ni el detalle, ni las cargas, ni el formato, ni la configuración.
// Por eso esta vista no usa `cargarDesgloses`/`fichasDesgloses` de la página del dueño (leen `total_origen` y el nombre del
// operador para armar las filas): lee SOLO `contarParaNomina` (seis `count` con `head: true`, ninguna columna de dinero) y pinta
// las fichas SIN enlace (la lista a la que llevarían tiene nombres y netos).
//
// Cero CSS nuevo: las mismas clases de la pantalla del dueño. La ficha se reutiliza de `desgloses.tsx` (sin `href` no es enlace).
// ═══════════════════════════════════════════════════════════════════════════

const DIA_MS = 24 * 3600 * 1000;

/** Las ventanas de las fichas: hoy y los últimos 30 días (hoy y los 29 anteriores), como las del dueño. */
export function ventanaNomina(ahora: Date = new Date()): { hoyDesde: Date; manana: Date; desde30: Date } {
  const hoy = hoyMx(ahora);
  const hoyDesde = new Date(inicioDiaMx(hoy));
  return { hoyDesde, manana: new Date(hoyDesde.getTime() + DIA_MS), desde30: new Date(hoyDesde.getTime() - 29 * DIA_MS) };
}

/** Trae los conteos de la flota de la sesión. Nunca lanza: un conteo que no se pudo leer es `null` (se pinta «—»). */
export async function leerConteosNomina(tenantId: string): Promise<ConteosNomina> {
  try {
    return await contarParaNomina(tenantId, ventanaNomina());
  } catch {
    return { recibidosHoy: null, enviados: null, entregados: null, rebotados: null, retenidos: null, sinPoliza: null };
  }
}

export function SeccionConteosNomina({ conteos }: { conteos: ConteosNomina }) {
  return (
    <section className="card p-4" id="desgloses">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-1">
        <h2 className="font-display text-[15px] font-semibold flex items-center gap-1.5">
          <Mail width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />
          Desgloses de pago
        </h2>
      </div>
      <p className="text-[12px] mb-3" style={{ color: 'var(--muted)' }}>
        Cuántos desgloses de pago hay en cada estado. Este resumen solo muestra conteos.
      </p>
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-2">
        <Ficha etiqueta="Recibidos hoy" valor={conteos.recibidosHoy} ayuda="Desgloses que llegaron hoy del sistema de tu empresa." />
        <Ficha etiqueta="Enviados · 30 días" valor={conteos.enviados} ayuda="Correos que salieron en los últimos 30 días y esperan confirmación de entrega. Se cuenta un correo por destinatario." />
        <Ficha etiqueta="Entregados · 30 días" valor={conteos.entregados} ayuda="Correos de los últimos 30 días que el buzón de destino ya recibió. Se cuenta un correo por destinatario." />
        <Ficha etiqueta="Rebotados · 30 días" valor={conteos.rebotados} tono="bad" ayuda="Correos de los últimos 30 días que no llegaron. Se cuenta un correo por destinatario." />
        <Ficha etiqueta="Retenidos" valor={conteos.retenidos} tono="bad" ayuda="Desgloses detenidos antes de enviarse." />
        <Ficha etiqueta="Sin póliza" valor={conteos.sinPoliza} tono="bad" ayuda="Bitácoras que esperan su póliza para poder enviarse." />
      </div>
    </section>
  );
}

/** La pantalla completa del rol `nomina`: el mismo marco que la del dueño, con una sola sección. */
export async function PaginaConteosNomina({ tenantId }: { tenantId: string }) {
  const conteos = await leerConteosNomina(tenantId);
  return <VistaDesgloses desgloses={<SeccionConteosNomina conteos={conteos} />} />;
}
