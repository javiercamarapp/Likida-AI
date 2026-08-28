import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { ScanEye } from 'lucide-react';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta, puedeVerArea } from '@/lib/auth/visibilidad';
import { EstadoError } from '@/app/admin/ui/kit';
import { logger } from '@/lib/logger';
import { interpretar, interpretarAMano } from '@/lib/likida/reglas/traductor';
import {
  crearReglaPendiente, confirmarRegla, alternarPausa, borrarRegla, listarReglas,
  type ReglaEnPantalla,
} from '@/lib/likida/reglas/repo';
import { plantillasPara, loQueSiSeVigila } from '@/lib/likida/reglas/catalogo';
import { BarraPagina } from '../resumen-visual';
import {
  FormaEscribirRegla, FormaElegirAMano, type ResultadoForma, type PlantillaEnPantalla,
} from './forma';
import { ListaReglas } from './vista';

export const dynamic = 'force-dynamic';

const RUTA = '/dashboard/reglas';

/**
 * MIS REGLAS (A19) — el dueño escribe, el sistema vigila.
 *
 * ── LO QUE ESTA PANTALLA PROMETE, Y POR QUÉ SE PUEDE CUMPLIR ──────────────
 *
 * "Escribe una regla en español y Likida la vigila" es una promesa que se
 * rompe sola si el modelo es quien vigila: interpretaría distinto cada hora y
 * nadie podría auditar un aviso. Aquí el modelo traduce UNA vez, a una
 * plantilla de un catálogo CERRADO (`reglas/catalogo.ts`), y lo que queda
 * guardado es la estructura. Si la frase no calza con nada, la pantalla dice
 * "no puedo vigilar eso todavía" y ENSEÑA la lista de lo que sí — prometer
 * una vigilancia imposible sería la peor versión de esta feature.
 *
 * ── DOS PASOS, SIEMPRE ────────────────────────────────────────────────────
 *
 * Interpretar NO enciende. La regla nace 'pendiente' y solo la confirmación
 * humana la activa; el CHECK `regla_vigilancia_activa_confirmada` (0229) lo
 * impone en la base, así que un POST directo a la server action tampoco
 * puede saltárselo.
 *
 * ── LAS DOS PUERTAS ───────────────────────────────────────────────────────
 *
 * VER es el área `dinero` (dueño y contador; el encargado no) y ESCRIBIR es
 * la misma — quien recibe los avisos de dinero es quien los declara. Se
 * comprueban las DOS dentro de cada server action: el `rol` del render es el
 * del momento en que se pintó, y una server action es un endpoint alcanzable
 * por POST directo. El `tenantId` sale de la sesión re-resuelta, jamás del
 * formulario.
 */

/** El gateo que TODA action repite adentro. Helper de MÓDULO y no closure:
 *  una server action solo puede capturar valores serializables, y
 *  `server_actions_sin_closures.test.ts` falla si se cierra sobre una función
 *  local (bug real de producción: 204 errores en Sentry). */
async function sesionConPermiso(sp: { vista?: string; tenant?: string; rol?: string } | undefined) {
  const s = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(s.rol, RUTA) || !puedeVerArea(s.rol, 'dinero')) return null;
  return s;
}

const NEGADO: ResultadoForma = {
  ok: false,
  error: 'Tu rol no puede declarar reglas de vigilancia — las declara quien recibe los avisos de dinero.',
};

/** Los parámetros del formulario "a mano": `p_<campo>` → valor tipado. */
function paramsDelFormulario(fd: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [llave, valor] of fd.entries()) {
    if (!llave.startsWith('p_') || typeof valor !== 'string') continue;
    const nombre = llave.slice(2);
    const numero = Number(valor);
    // Un campo de opción llega como texto de dominio cerrado; uno numérico,
    // como número. `validarParams` rechaza lo que no calce — aquí solo se
    // decide en qué forma viaja.
    out[nombre] = valor.trim() !== '' && Number.isFinite(numero) ? numero : valor;
  }
  return out;
}

export default async function PaginaReglas({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string; rol?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(rol, RUTA)) redirect('/dashboard');

  // El catch NO finge que no hay reglas: "no tienes ninguna" sobre una base
  // caída invitaría a declarar duplicados de todas las que ya existen.
  let reglas: ReglaEnPantalla[] | null;
  try {
    reglas = await listarReglas(tenantId);
  } catch {
    reglas = null;
  }

  const plantillas: PlantillaEnPantalla[] = plantillasPara(rol).map((p) => ({
    id: p.id, titulo: p.titulo, queVigila: p.queVigila,
    ejemplos: p.ejemplos, campos: p.campos,
  }));
  const ejemplos = plantillas.slice(0, 4).map((p) => p.ejemplos[0]);

  async function accionInterpretar(_previo: ResultadoForma, fd: FormData): Promise<ResultadoForma> {
    'use server';
    const s = await sesionConPermiso(sp);
    if (!s) return NEGADO;

    const texto = String(fd.get('texto') ?? '');
    const lectura = await interpretar(texto, { tenantId: s.tenantId, rol: s.rol });
    if (!lectura.ok) return { ok: false, error: lectura.motivo, puedoVigilar: lectura.puedoVigilar };

    const guardada = await crearReglaPendiente(s.tenantId, {
      plantilla: lectura.plantilla, params: lectura.params,
      textoOriginal: texto, frase: lectura.frase,
      modelo: lectura.modelo, costoUsd: lectura.costoUsd,
    }, s.userId);
    if (!guardada.ok) return { ok: false, error: guardada.error };

    logger.info('reglas.interpretada', {
      tenant: s.tenantId, regla: guardada.valor.id, plantilla: lectura.plantilla,
      modelo: lectura.modelo, costoUsd: lectura.costoUsd,
    });
    revalidatePath(RUTA);
    return { ok: true, mensaje: 'Así lo entendí. Léelo abajo y confírmalo para que empiece a vigilar.' };
  }

  async function accionAMano(_previo: ResultadoForma, fd: FormData): Promise<ResultadoForma> {
    'use server';
    const s = await sesionConPermiso(sp);
    if (!s) return NEGADO;

    const plantilla = String(fd.get('plantilla') ?? '');
    const lectura = interpretarAMano(plantilla, paramsDelFormulario(fd), s.rol);
    if (!lectura.ok) return { ok: false, error: lectura.motivo, puedoVigilar: lectura.puedoVigilar };

    const guardada = await crearReglaPendiente(s.tenantId, {
      plantilla: lectura.plantilla, params: lectura.params,
      // Sin frase escrita por nadie, la cita es la interpretación misma: el
      // campo es NOT NULL y decir "(elegida de la lista)" sería inventarle a
      // la persona una frase que no dijo.
      textoOriginal: lectura.frase, frase: lectura.frase,
      modelo: null, costoUsd: 0,
    }, s.userId);
    if (!guardada.ok) return { ok: false, error: guardada.error };

    revalidatePath(RUTA);
    return { ok: true, mensaje: 'Lista para confirmar. Revísala abajo y enciéndela.' };
  }

  async function accionConfirmar(_previo: ResultadoForma, fd: FormData): Promise<ResultadoForma> {
    'use server';
    const s = await sesionConPermiso(sp);
    if (!s) return NEGADO;
    const r = await confirmarRegla(s.tenantId, String(fd.get('id') ?? ''), { id: s.userId });
    if (!r.ok) return { ok: false, error: r.error };
    revalidatePath(RUTA);
    return { ok: true, mensaje: 'Encendida.' };
  }

  async function accionPausar(_previo: ResultadoForma, fd: FormData): Promise<ResultadoForma> {
    'use server';
    const s = await sesionConPermiso(sp);
    if (!s) return NEGADO;
    const r = await alternarPausa(s.tenantId, String(fd.get('id') ?? ''), true, { id: s.userId });
    if (!r.ok) return { ok: false, error: r.error };
    revalidatePath(RUTA);
    return { ok: true, mensaje: 'Pausada.' };
  }

  async function accionReanudar(_previo: ResultadoForma, fd: FormData): Promise<ResultadoForma> {
    'use server';
    const s = await sesionConPermiso(sp);
    if (!s) return NEGADO;
    const r = await alternarPausa(s.tenantId, String(fd.get('id') ?? ''), false, { id: s.userId });
    if (!r.ok) return { ok: false, error: r.error };
    revalidatePath(RUTA);
    return { ok: true, mensaje: 'Vigilando otra vez.' };
  }

  async function accionBorrar(_previo: ResultadoForma, fd: FormData): Promise<ResultadoForma> {
    'use server';
    const s = await sesionConPermiso(sp);
    if (!s) return NEGADO;
    const r = await borrarRegla(s.tenantId, String(fd.get('id') ?? ''), { id: s.userId });
    if (!r.ok) return { ok: false, error: r.error };
    revalidatePath(RUTA);
    return { ok: true, mensaje: 'Borrada.' };
  }

  return (
    <main className="h-full">
      <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<ScanEye width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          titulo="Mis reglas"
        />

        <div className="px-5 py-5 flex-1 space-y-5">
          <p className="text-[12.5px] max-w-2xl" style={{ color: 'var(--muted)' }}>
            Escribe de qué quieres que te avise y lo traduzco a una vigilancia concreta.
            Te la enseño antes de encenderla: lo que queda guardado es la vigilancia, no
            la frase. Reviso cada hora, y cada caso te suena UNA vez.
          </p>

          <section className="space-y-3">
            <div className="card p-4">
              <FormaEscribirRegla accion={accionInterpretar} ejemplos={ejemplos} />
            </div>
            <details className="card p-4">
              <summary className="cursor-pointer text-[12.5px] font-medium select-none list-none"
                style={{ color: 'var(--ink2)' }}>
                …o elígela de la lista, sin pasar por el intérprete
              </summary>
              <div className="pt-3">
                <FormaElegirAMano accion={accionAMano} plantillas={plantillas} />
              </div>
            </details>
          </section>

          {reglas === null ? (
            <EstadoError mensaje="No pude leer tus reglas. No se enseña una lista a medias: media lista se ve igual que la lista entera, y sobre vigilancias eso invita a declarar duplicados." />
          ) : (
            <ListaReglas
              reglas={reglas}
              acciones={{
                confirmar: accionConfirmar, pausar: accionPausar,
                reanudar: accionReanudar, borrar: accionBorrar,
              }}
            />
          )}

          <section className="space-y-2">
            <h2 className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
              Lo que sé vigilar hoy
            </h2>
            {/* La lista completa, siempre a la vista y no solo cuando algo
                falla: es la frontera honesta del producto. Lo que no está
                aquí, Likida no lo puede prometer. */}
            <div className="card p-4">
              <ul className="space-y-1.5">
                {loQueSiSeVigila(rol).map((linea) => (
                  <li key={linea} className="text-[12px] flex gap-2" style={{ color: 'var(--ink2)' }}>
                    <span style={{ color: 'var(--faint)' }}>·</span>
                    <span>{linea}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
