import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { puedeAdministrar } from '@/lib/auth/permisos';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import { fechaMx } from '@/lib/formato';
import {
  crearLlaveApi, revocarLlaveApi, listarLlavesApi, AREAS_DE_LLAVE, VIGENCIAS_DE_LLAVE,
  VIGENCIA_DEFAULT, type LlaveListada,
} from '@/lib/auth/llave-api-escritura';
import { EstadoError } from '../estados';
import { FormaEmision, type ResultadoForma } from './forma';
import { ListaLlaves } from './vista';
import { MarcoPagina, Aviso, TituloRecuadro } from '@/app/ui-v2/componentes';
import type { Metadata } from 'next';
export const metadata: Metadata = { title: 'Llaves de API' };

export const dynamic = 'force-dynamic';

const RUTA = '/dashboard/llaves-api';

/**
 * LLAVES DE API — la emisión y revocación que la 0093 dejó prometida.
 *
 * El openapi de /v1 dice textualmente que la llave "se emite desde el panel,
 * se enseña UNA vez y se guarda solo su hash". Hasta esta pantalla (hallazgo
 * A6, auditoría 4) esa frase era mentira: `tenant_api_key` no tenía un solo
 * INSERT en src/, y el POST de /v1 —que exige área `administracion`— era
 * inalcanzable para todo el mundo.
 *
 * ── LAS DOS PUERTAS COINCIDEN AQUÍ, Y NO ES CASUAL ────────────────────────
 * VER es área `administracion` (`puedeVerRuta`) y ESCRIBIR es
 * `puedeAdministrar`: hoy los dos conjuntos son {superadmin, flota_admin},
 * el mismo criterio que la RLS `administra_flota()` de la 0093 — una llave
 * es CONTROL, no dato, y ni el contador ni el encargado la ven. Se comprueban
 * LAS DOS dentro de cada server action de todas formas: el `rol` del render
 * es el del momento en que se pintó, y una server action es un endpoint
 * alcanzable por POST directo. El `tenantId` va por CLOSURE desde la sesión
 * re-resuelta: nada del formulario decide de quién es la llave.
 */
export default async function PaginaLlavesApi({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string; rol?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(rol, RUTA)) redirect('/dashboard');

  // El catch NO finge que no hay llaves: una base caída pintada como "no
  // tienes llaves" invitaría a emitir duplicados de todas. Se pinta el error.
  let llaves: LlaveListada[] | null;
  try {
    llaves = await listarLlavesApi(tenantId);
  } catch {
    llaves = null;
  }

  async function emitirLlave(_previo: ResultadoForma, fd: FormData): Promise<ResultadoForma> {
    'use server';
    const s = await resolverTenantEfectivo(RUTA, sp);
    if (!puedeVerRuta(s.rol, RUTA) || !puedeAdministrar(s.rol)) {
      return { ok: false, error: 'Solo el dueño de la flota emite llaves de API.' };
    }

    try {
      const llave = await crearLlaveApi(s.tenantId, {
        nombre: String(fd.get('nombre') ?? ''),
        area: String(fd.get('area') ?? ''),
        // SEG-8: si el POST no la trae, `crearLlaveApi` aplica el default de
        // un año — no «sin caducidad».
        vigencia: String(fd.get('vigencia') ?? ''),
      }, s.userId);

      revalidatePath(RUTA);
      return {
        ok: true,
        mensaje: llave.expiraEn
          ? `Llave emitida. Deja de valer el ${fechaMx(llave.expiraEn)}: apunta la fecha para renovarla antes.`
          : 'Llave emitida SIN caducidad: va a valer hasta que alguien la revoque a mano.',
        // El ÚNICO viaje del secreto: del motor a esta respuesta y a la
        // pantalla. No se guarda en ningún lado — ver `SecretoUnaVez`.
        secreto: { enClaro: llave.enClaro, prefijo: llave.prefijo },
      };
    } catch (e) {
      return { ok: false, error: mensajeParaPantalla(e, 'emitir la llave') };
    }
  }

  async function revocarLlave(_previo: ResultadoForma, fd: FormData): Promise<ResultadoForma> {
    'use server';
    const s = await resolverTenantEfectivo(RUTA, sp);
    if (!puedeVerRuta(s.rol, RUTA) || !puedeAdministrar(s.rol)) {
      return { ok: false, error: 'Solo el dueño de la flota revoca llaves de API.' };
    }

    try {
      await revocarLlaveApi(s.tenantId, String(fd.get('id') ?? '').trim(), s.userId);
      revalidatePath(RUTA);
      return { ok: true, mensaje: 'Llave revocada.' };
    } catch (e) {
      return { ok: false, error: mensajeParaPantalla(e, 'revocar la llave') };
    }
  }

  return (
    <MarcoPagina titulo="Llaves de API" apoyo="Con una llave, un sistema tuyo consume la API de Likida sin navegador ni sesión. Aquí las emites y las revocas.">
      <Aviso tono="info">
        Con una llave, un sistema tuyo —un TMS, un tablero— consume la API de Likida sin
        navegador ni sesión: se manda como <code className="cifra-mono">Authorization: Bearer</code> en
        cada petición. La referencia completa vive en <code className="cifra-mono">/api/v1/openapi</code>.
      </Aviso>

      {llaves === null ? (
        <EstadoError mensaje="No pude leer las llaves de la flota. No se enseña una lista a medias: media lista se vería igual que la lista entera, y sobre llaves eso invita a emitir duplicados." />
      ) : (
        <>
          <ListaLlaves llaves={llaves} revocarLlave={revocarLlave} />

          <section className="space-y-3">
            <TituloRecuadro info="llaves_api.emitir">Emitir una llave</TituloRecuadro>
            <div className="card p-4">
              <FormaEmision accion={emitirLlave} areas={AREAS_DE_LLAVE}
                vigencias={VIGENCIAS_DE_LLAVE} vigenciaDefault={VIGENCIA_DEFAULT} />
            </div>
          </section>
        </>
      )}
    </MarcoPagina>
  );
}
