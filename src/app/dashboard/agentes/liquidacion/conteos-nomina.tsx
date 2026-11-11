import { hoyMx, inicioDiaMx } from '@/lib/formato';
import { contarParaNomina, type ConteosNomina } from '@/lib/likida/liquidacion_externa/repo';
import { Tarjeta } from '@/app/ui-v2/componentes';
import './liquidacion.css';
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
// Mismas piezas y clases (`liquidacion.css`) que la pantalla del dueño. Sin ⓘ a propósito: el ⓘ es un botón y esta vista no lleva ninguno. La ficha se reutiliza de `desgloses.tsx` (sin `href` no es enlace).
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
    <div id="desgloses">
      <Tarjeta titulo="Desgloses de pago">
        <p className="rv-liq-sub">
          Cuántos desgloses de pago hay en cada estado. Este resumen solo muestra conteos.
        </p>
        <div className="rv-liq-fichas">
          <Ficha etiqueta="Recibidos hoy" valor={conteos.recibidosHoy} ayuda="Desgloses que llegaron hoy del sistema de tu empresa." />
          <Ficha etiqueta="Enviados · 30 días" valor={conteos.enviados} ayuda="Correos que salieron en los últimos 30 días y esperan confirmación de entrega. Se cuenta un correo por destinatario." />
          <Ficha etiqueta="Entregados · 30 días" valor={conteos.entregados} ayuda="Correos de los últimos 30 días que el buzón de destino ya recibió. Se cuenta un correo por destinatario." />
          <Ficha etiqueta="Rebotados · 30 días" valor={conteos.rebotados} tono="bad" ayuda="Correos de los últimos 30 días que no llegaron. Se cuenta un correo por destinatario." />
          <Ficha etiqueta="Retenidos" valor={conteos.retenidos} tono="bad" ayuda="Desgloses detenidos antes de enviarse." />
          <Ficha etiqueta="Sin póliza" valor={conteos.sinPoliza} tono="bad" ayuda="Bitácoras que esperan su póliza para poder enviarse." />
        </div>
      </Tarjeta>
    </div>
  );
}

/** La pantalla completa del rol `nomina`: el mismo marco que la del dueño, con una sola sección. */
export async function PaginaConteosNomina({ tenantId }: { tenantId: string }) {
  const conteos = await leerConteosNomina(tenantId);
  return <VistaDesgloses desgloses={<SeccionConteosNomina conteos={conteos} />} />;
}
