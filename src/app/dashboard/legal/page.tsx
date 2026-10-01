import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import Link from 'next/link';
import { Scale3d } from 'lucide-react';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { puedeAdministrar } from '@/lib/auth/permisos';
import { EstadoError } from '@/app/admin/ui/kit';
import { FormaConAviso, type ResultadoAccion } from '@/app/admin/ui/forma';
import { fechaHoraMx } from '@/lib/formato';
import {
  aceptacionesDeFlota, registrarAceptacion, revocarMandato, pendientesDeUsuario, mandatoDe,
  type AceptacionFila,
} from '@/lib/legal/aceptacion';
import {
  ETIQUETA_DOCUMENTO, MANDATO_AUTOFACTURACION, VERSION_TERMINOS, VERSION_AVISO_PRIVACIDAD,
} from '@/lib/legal/documentos';
import { BarraPagina } from '../resumen-visual';

export const dynamic = 'force-dynamic';

const RUTA = '/dashboard/legal';
const SOLO_DUENO = 'Solo el dueño de la flota acepta los documentos y otorga el mandato en nombre de la empresa.';

/**
 * TÉRMINOS, AVISO Y MANDATO DE LA FLOTA (auditoría ola 1, #48).
 *
 * Aquí el dueño acepta la versión VIGENTE de los Términos y del Aviso de
 * privacidad —con quién y cuándo— y, aparte, otorga (o retira) el MANDATO para
 * que Likida opere portales de facturación en nombre de la empresa. Sin el
 * mandato vigente de ESTA flota la emisión de CFDI se queda en ensayo, aunque el
 * interruptor global esté puesto (`modoDeFlota`, al_vuelo.ts).
 *
 * Las server actions repiten el chequeo (un action es un POST directo) y el
 * `tenantId` sale de la sesión, no del formulario. La base vuelve a validar
 * pertenencia y rol (0443).
 */
async function sesionDeDueno(sp: { vista?: string; tenant?: string; rol?: string }) {
  const s = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(s.rol, RUTA) || !puedeAdministrar(s.rol) || s.rol === 'superadmin') return null;
  return s;
}

export default async function PaginaLegal({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string; rol?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol, userId } = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(rol, RUTA)) redirect('/dashboard');

  async function accionAceptarVigentes(_previo: ResultadoAccion, _fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const s = await sesionDeDueno(sp);
    if (!s) return { error: SOLO_DUENO };
    const r1 = await registrarAceptacion(s.tenantId, s.userId, 'terminos');
    if (!r1.ok) return { error: r1.motivo ?? 'No se pudo registrar la aceptación.' };
    const r2 = await registrarAceptacion(s.tenantId, s.userId, 'aviso_privacidad');
    if (!r2.ok) return { error: r2.motivo ?? 'No se pudo registrar la aceptación.' };
    revalidatePath(RUTA);
    return { ok: 'Quedó registrada tu aceptación de la versión vigente de los Términos y del Aviso de privacidad.' };
  }

  async function accionOtorgarMandato(_previo: ResultadoAccion, _fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const s = await sesionDeDueno(sp);
    if (!s) return { error: SOLO_DUENO };
    const r = await registrarAceptacion(s.tenantId, s.userId, 'mandato_autofacturacion');
    if (!r.ok) return { error: r.motivo ?? 'No se pudo registrar el mandato.' };
    revalidatePath(RUTA);
    return { ok: r.registrada ? 'Mandato otorgado: quedó registrado quién, cuándo y con qué texto.' : 'El mandato ya estaba otorgado.' };
  }

  async function accionRetirarMandato(_previo: ResultadoAccion, _fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const s = await sesionDeDueno(sp);
    if (!s) return { error: SOLO_DUENO };
    const r = await revocarMandato(s.tenantId, s.userId);
    if (!r.ok) return { error: r.motivo ?? 'No se pudo retirar el mandato.' };
    revalidatePath(RUTA);
    return { ok: 'Mandato retirado. Likida vuelve a preparar las facturas sin emitirlas.' };
  }

  // Error DICHO: una base caída no se pinta como «no has aceptado nada».
  let filas: AceptacionFila[] | null = null;
  try {
    filas = await aceptacionesDeFlota(tenantId);
  } catch {
    filas = null;
  }
  const pendientes = filas ? pendientesDeUsuario(filas, userId) : null;
  const mandato = filas ? mandatoDe(filas) : null;
  const esDueno = puedeAdministrar(rol) && rol !== 'superadmin';

  return (
    <main className="h-full">
      <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<Scale3d width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          titulo="Términos, aviso y mandato"
        />
        <div className="px-5 py-5 flex-1 space-y-6 max-w-3xl">
          {filas === null ? (
            <EstadoError mensaje="No pude leer el registro de aceptaciones. No significa que no hayas aceptado nada: la consulta falló." />
          ) : (
            <>
              <section className="space-y-2" aria-labelledby="h-docs">
                <h2 id="h-docs" className="text-sm font-semibold">Documentos vigentes</h2>
                <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>
                  <Link href="/terminos" className="underline">{ETIQUETA_DOCUMENTO.terminos}</Link> (versión {VERSION_TERMINOS}) y{' '}
                  <Link href="/privacidad" className="underline">{ETIQUETA_DOCUMENTO.aviso_privacidad}</Link> (versión {VERSION_AVISO_PRIVACIDAD}).
                </p>
                {pendientes && pendientes.length === 0 ? (
                  <p className="text-[12.5px]" style={{ color: 'var(--ok)' }}>Ya aceptaste la versión vigente de ambos.</p>
                ) : esDueno ? (
                  <FormaConAviso accion={accionAceptarVigentes} boton="Acepto los Términos y el Aviso de privacidad vigentes" columnas="md:grid-cols-1">
                    <span />
                  </FormaConAviso>
                ) : (
                  <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>{SOLO_DUENO}</p>
                )}
              </section>

              <section className="space-y-2" aria-labelledby="h-mandato">
                <h2 id="h-mandato" className="text-sm font-semibold">Mandato de autofacturación</h2>
                <blockquote className="text-[12.5px] border-l-2 pl-3" style={{ borderColor: 'var(--line)', color: 'var(--muted)' }}>
                  {MANDATO_AUTOFACTURACION.texto}
                </blockquote>
                <p className="text-[11px]" style={{ color: 'var(--faint)' }}>
                  Versión {MANDATO_AUTOFACTURACION.version}. Sin este mandato Likida prepara las facturas pero no las emite.
                  El texto no ha pasado por revisión legal definitiva.
                </p>
                {mandato ? (
                  <>
                    <p className="text-[12.5px]" style={{ color: 'var(--ok)' }}>
                      Mandato vigente: otorgado el {fechaHoraMx(mandato.aceptadoEn)}
                      {mandato.userId === null ? ' (la cuenta que lo otorgó ya fue cancelada)' : ''}.
                    </p>
                    {esDueno && (
                      <FormaConAviso accion={accionRetirarMandato} boton="Retirar el mandato" columnas="md:grid-cols-1">
                        <span />
                      </FormaConAviso>
                    )}
                  </>
                ) : esDueno ? (
                  <FormaConAviso accion={accionOtorgarMandato} boton="Otorgo el mandato en nombre de mi empresa" columnas="md:grid-cols-1">
                    <span />
                  </FormaConAviso>
                ) : (
                  <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>Aún no está otorgado. {SOLO_DUENO}</p>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
