import { getT } from '@/lib/i18n/servidor';
import { type Tr } from '@/lib/i18n/dinero_tr';
import { datosParaProveedor } from '@/lib/i18n/servidor';
import { IdiomaProvider } from '@/lib/i18n/proveedor';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { resolverTenantAtadoOLanza } from '@/lib/auth/tenant-atado';
import { puedeVerRuta, puedeVerArea } from '@/lib/auth/visibilidad';
import { logger } from '@/lib/logger';
import { interpretar, interpretarAMano } from '@/lib/likida/reglas/traductor';
import {
  crearReglaPendiente, confirmarRegla, alternarPausa, borrarRegla, listarReglas, actualizarFrecuencia,
  type ReglaEnPantalla,
} from '@/lib/likida/reglas/repo';
import { plantillasPara, loQueSiSeVigila } from '@/lib/likida/reglas/catalogo';
import {
  FormaEscribirRegla, FormaElegirAMano, type ResultadoForma, type PlantillaEnPantalla,
} from './forma';
import { seccionesDeReglas } from './vista';
import { Disclosure, EstadoError } from '@/app/ui-v2/componentes';
import { EsqueletoConfiguracion } from '@/app/ui-v2/esqueletos';
import './reglas.css';
import type { Metadata } from 'next';
export async function generateMetadata(): Promise<Metadata> {
  const { t: tr } = await getT('dinero');
  return { title: tr('meta.reglas') };
}

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
async function sesionConPermiso(sp: { vista?: string; tenant?: string; rol?: string } | undefined, tenantId: string) {
  const s = await resolverTenantAtadoOLanza(RUTA, sp, tenantId);
  if (!puedeVerRuta(s.rol, RUTA) || !puedeVerArea(s.rol, 'dinero')) return null;
  return s;
}

const negado = (tr: Tr): ResultadoForma => ({
  ok: false,
  error: tr('reglas.page.tuRolNoPuede'),
});

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
  const { t: tr } = await getT('dinero');
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
    const { t: tr } = await getT('dinero');
    const s = await sesionConPermiso(sp, tenantId);
    if (!s) return negado(tr);

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
    return { ok: true, mensaje: tr('reglas.page.asiLoEntendiLeelo') };
  }

  async function accionAMano(_previo: ResultadoForma, fd: FormData): Promise<ResultadoForma> {
    'use server';
    const { t: tr } = await getT('dinero');
    const s = await sesionConPermiso(sp, tenantId);
    if (!s) return negado(tr);

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
    return { ok: true, mensaje: tr('reglas.page.listaParaConfirmarRevisala') };
  }

  async function accionConfirmar(_previo: ResultadoForma, fd: FormData): Promise<ResultadoForma> {
    'use server';
    const { t: tr } = await getT('dinero');
    const s = await sesionConPermiso(sp, tenantId);
    if (!s) return negado(tr);
    const r = await confirmarRegla(s.tenantId, String(fd.get('id') ?? ''), { id: s.userId });
    if (!r.ok) return { ok: false, error: r.error };
    revalidatePath(RUTA);
    return { ok: true, mensaje: 'Encendida.' };
  }

  async function accionPausar(_previo: ResultadoForma, fd: FormData): Promise<ResultadoForma> {
    'use server';
    const { t: tr } = await getT('dinero');
    const s = await sesionConPermiso(sp, tenantId);
    if (!s) return negado(tr);
    const r = await alternarPausa(s.tenantId, String(fd.get('id') ?? ''), true, { id: s.userId });
    if (!r.ok) return { ok: false, error: r.error };
    revalidatePath(RUTA);
    return { ok: true, mensaje: tr('reglas.page.pausada') };
  }

  async function accionReanudar(_previo: ResultadoForma, fd: FormData): Promise<ResultadoForma> {
    'use server';
    const { t: tr } = await getT('dinero');
    const s = await sesionConPermiso(sp, tenantId);
    if (!s) return negado(tr);
    const r = await alternarPausa(s.tenantId, String(fd.get('id') ?? ''), false, { id: s.userId });
    if (!r.ok) return { ok: false, error: r.error };
    revalidatePath(RUTA);
    return { ok: true, mensaje: tr('reglas.page.vigilandoOtraVez') };
  }

  async function accionBorrar(_previo: ResultadoForma, fd: FormData): Promise<ResultadoForma> {
    'use server';
    const { t: tr } = await getT('dinero');
    const s = await sesionConPermiso(sp, tenantId);
    if (!s) return negado(tr);
    const r = await borrarRegla(s.tenantId, String(fd.get('id') ?? ''), { id: s.userId });
    if (!r.ok) return { ok: false, error: r.error };
    revalidatePath(RUTA);
    return { ok: true, mensaje: 'Borrada.' };
  }

  async function accionFrecuencia(_previo: ResultadoForma, fd: FormData): Promise<ResultadoForma> {
    'use server';
    const { t: tr } = await getT('dinero');
    const s = await sesionConPermiso(sp, tenantId);
    if (!s) return negado(tr);
    const r = await actualizarFrecuencia(s.tenantId, String(fd.get('id') ?? ''), {
      maxAvisosDia: fd.get('maxAvisosDia'), minHorasEntreAvisos: fd.get('minHorasEntreAvisos'),
    }, { id: s.userId });
    if (!r.ok) return { ok: false, error: r.error };
    revalidatePath(RUTA);
    return { ok: true, mensaje: tr('reglas.page.limiteGuardado') };
  }

  const idiomaDatos = await datosParaProveedor(['shell', 'dinero']);
  return (
    <IdiomaProvider idioma={idiomaDatos.idioma} diccionarios={idiomaDatos.diccionarios}>
    <EsqueletoConfiguracion
      titulo={tr('reglas.page.notificaciones')}
      // Configuración sin eyebrow (Rovaq /setup): `area=""` apaga la etiqueta del menú. La línea de apoyo ya dice lo que decía el aviso repetido.
      area=""
      apoyo={tr('reglas.page.escribeDeQueQuieres2')}
      secciones={[
        {
          id: 'escribir', titulo: tr('reglas.page.escribeUnaRegla'),
          contenido: (
            <>
              <FormaEscribirRegla accion={accionInterpretar} ejemplos={ejemplos} />
              <Disclosure titulo={tr('reglas.page.oEligelaDeLa')}>
                <FormaElegirAMano accion={accionAMano} plantillas={plantillas} />
              </Disclosure>
            </>
          ),
        },
        ...(reglas === null
          ? [{ id: 'reglas-error', titulo: tr('reglas.vista.tusReglas'), contenido: <EstadoError reintentar>{tr('reglas.page.noPudeLeerTus')}</EstadoError> }]
          : seccionesDeReglas(reglas, {
            confirmar: accionConfirmar, pausar: accionPausar,
            reanudar: accionReanudar, borrar: accionBorrar, frecuencia: accionFrecuencia,
          }, tr)),
        // La lista completa, siempre a la vista y no solo cuando algo falla: es la frontera honesta del producto.
        {
          id: 'vigila', titulo: tr('reglas.page.loQueSeVigilar'),
          contenido: (
            <ul className="rv-reglas__lista">
              {loQueSiSeVigila(rol).map((linea) => (<li key={linea}>{linea}</li>))}
            </ul>
          ),
        },
      ]}
    />
    </IdiomaProvider>
  );
}
