import { redirect } from 'next/navigation';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { sufijoTenant } from '../sufijo';
import { numeroWhatsAppDeLikida, textoDeArranque, enlaceWaMe } from '@/lib/likida/arranque_whatsapp';
import { getTenantContext } from '@/lib/likida/conv';
import { qrSvg } from '@/lib/qr';
import { contarPendientes } from '@/lib/likida/invitacion_operador';
import { getOperadoresConteos } from '@/lib/likida/administracion';
import { DIAS_AVISO } from '@/lib/likida/vigencias';
import { hoyMx } from '@/lib/formato';
import { ahoraMs } from '@/lib/saludo';
import { VistaArranqueWhatsApp, type DatosArranque } from './vista';

export const dynamic = 'force-dynamic';

const RUTA = '/dashboard/whatsapp';

/**
 * LA GUÍA DE ARRANQUE DEL CHOFER (W2 «producto»): el número de WhatsApp de Likida,
 * el enlace con texto prellenado, el QR y el flujo. Área `operacion`: no enseña un
 * peso y su lector natural es el jefe de tráfico. El número NO es un secreto (es
 * el que se reparte a los choferes) y el QR se arma en el servidor sin dependencias.
 */
export default async function PaginaArranqueWhatsApp({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string; rol?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(rol, RUTA)) redirect('/dashboard');
  const sufijo = sufijoTenant(sp);

  const numero = numeroWhatsAppDeLikida();

  // El nombre de la flota: si no se pudo leer, el texto prellenado dice «mi flota»
  // (no se inventa un nombre ni se rompe la pantalla).
  let nombreFlota = 'tu flota';
  try { nombreFlota = (await getTenantContext(tenantId)).nombreFlota; } catch { /* texto neutro */ }

  let enlace: string | null = null;
  let qr: string | null = null;
  if (numero.estado === 'configurado') {
    enlace = enlaceWaMe(numero.digitos, textoDeArranque(nombreFlota));
    try {
      qr = qrSvg(enlace, { etiqueta: `Código QR para escribirle a Likida por WhatsApp al ${numero.visible}`, tamanoPx: 200 });
    } catch {
      qr = null; // un texto demasiado largo: queda el enlace, que es lo que importa
    }
  }

  let operadores: DatosArranque['operadores'] = null;
  try {
    const conteos = await getOperadoresConteos(tenantId, hoyMx(new Date(ahoraMs())), DIAS_AVISO);
    if (conteos) operadores = { activos: conteos.activos, pendientesDeInvitar: await contarPendientes(tenantId, { tipo: 'flota' }) };
  } catch { operadores = null; }

  return (
    <VistaArranqueWhatsApp
      datos={{ numero, nombreFlota, enlace, qrSvg: qr, operadores }}
      hrefOperadores={`/dashboard/operadores${sufijo}`}
      hrefAyuda={`/dashboard/soporte${sufijo}`}
    />
  );
}
