import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { puedeAdministrar } from '@/lib/auth/permisos';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import { getUnidades, validarUnidad, crearUnidad, editarUnidad, cambiarEstadoUnidad, ESTADOS_UNIDAD } from '@/lib/likida/operacion';
import { CONECTORES_GPS } from '@/lib/likida/conectores/gps';
import { sufijoTenant } from '../sufijo';
import { camposDeSufijo } from '../paginar-campos';
import { VistaUnidades } from './vista';
import { BloqueTaller } from './taller';
import type { ResultadoForma } from './forma';
import type { ResultadoEstado } from './estado';

export const dynamic = 'force-dynamic';

const RUTA = '/dashboard/unidades';

/**
 * El Registro de Unidades — el activo que produce el dinero, con las vigencias
 * que la ley le exige para poder producirlo. Desde el 14-ago-2026 también se
 * CAPTURA aquí: era la única entidad del panel sin alta (solo la API la
 * escribía), y una flota sin TMS no tenía cómo estrenar su parque.
 *
 * ── DOS PUERTAS DISTINTAS, el patrón de clientes ──────────────────────────
 *  · VER es área `operacion` (`puedeVerRuta`): el jefe de tráfico es
 *    exactamente quien debe enterarse de que una unidad no puede salir.
 *  · ESCRIBIR es `puedeAdministrar` (superadmin y flota_admin): una unidad es
 *    un activo de la empresa y su alta cambia el denominador de todo lo que
 *    se mide por unidad — misma puerta que `POST /v1/unidades`.
 *
 * LAS DOS SE RE-COMPRUEBAN DENTRO del server action: el `rol` del render es
 * el del momento en que se pintó, y una server action es un endpoint
 * alcanzable por POST directo. El `tenantId` va por sesión re-resuelta, nunca
 * del formulario.
 *
 * SIN CATCH en la lectura: una pantalla que existe para avisar de papeles
 * vencidos no puede pintar "todo en regla" porque la consulta falló. Si no se
 * puede leer, se cae y `error.tsx` lo dice.
 */
export default async function PaginaUnidades({
  searchParams,
}: {
  /** FE-12: `?q=` busca, `?p=` pagina y `?editar=<id>` abre UNA forma. Los
   *  sanea `paginarRegistro`; un link viejo se lee como primera página. */
  searchParams: Promise<{ vista?: string; tenant?: string; rol?: string; q?: string; p?: string; editar?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(rol, RUTA)) redirect('/dashboard');
  const sufijo = sufijoTenant(sp);
  // Un `<form method="get">` reemplaza el query string ENTERO, así que el
  // sufijo del superadmin tiene que viajar como campo oculto o la búsqueda lo
  // sacaría de la flota que estaba viendo.
  const camposOcultos = camposDeSufijo(sp);

  const unidades = await getUnidades(tenantId);

  async function guardarUnidad(_previo: ResultadoForma, fd: FormData): Promise<ResultadoForma> {
    'use server';
    const s = await resolverTenantEfectivo(RUTA, sp);
    if (!puedeVerRuta(s.rol, RUTA)) return { ok: false, error: 'Tu rol no puede ver las unidades.' };
    if (!puedeAdministrar(s.rol)) {
      return { ok: false, error: 'Solo el dueño de la flota da de alta y edita unidades.' };
    }

    const id = String(fd.get('id') ?? '').trim();
    const eco = String(fd.get('numeroEconomico') ?? '').trim();
    try {
      // La validación del navegador (required, max) avisa temprano; ÉSTA es
      // la que manda, y es la misma función que prueba `operacion.test.ts`.
      const valores = validarUnidad({
        numeroEconomico: eco,
        placas: String(fd.get('placas') ?? ''),
        marca: String(fd.get('marca') ?? ''),
        modelo: String(fd.get('modelo') ?? ''),
        anio: String(fd.get('anio') ?? ''),
        polizaVence: String(fd.get('polizaVence') ?? ''),
        permisoSictVence: String(fd.get('permisoSictVence') ?? ''),
        verificacionVence: String(fd.get('verificacionVence') ?? ''),
        // El amarre con el GPS (0176). `validarAmarreGps` comprueba que el
        // proveedor esté en el catálogo y que los dos campos vayan juntos:
        // uno solo de los dos produce una unidad que el poller nunca casa.
        gpsProveedor: String(fd.get('gpsProveedor') ?? ''),
        gpsDeviceId: String(fd.get('gpsDeviceId') ?? ''),
      });

      if (id) await editarUnidad(s.tenantId, id, valores);
      else await crearUnidad(s.tenantId, valores);

      revalidatePath(RUTA);
      const sinPapeles = !valores.polizaVence && !valores.permisoSictVence && !valores.verificacionVence;
      return {
        ok: true,
        mensaje: id
          ? `La unidad ${valores.numeroEconomico} quedó actualizada.`
          : `La unidad ${valores.numeroEconomico} ya está dada de alta.${sinPapeles
            ? ' Sin fechas de papeles sale como "sin papeles" — captúralas para que Likida avise antes de que venzan.'
            : ''}`,
      };
    } catch (e) {
      // El choque contra `unidad_economico_unico` llega como Error plano
      // (`crearUnidad` no lo traduce porque `POST /v1/unidades` reconoce el
      // nombre del índice en el mensaje). Aquí sí se dice en palabras de
      // quien capturó; el resto va por `mensajeParaPantalla`.
      if (e instanceof Error && e.message.includes('unidad_economico_unico')) {
        return { ok: false, error: `Ya tienes una unidad con el número económico "${eco}". Búscala en la lista en vez de darla de alta otra vez.` };
      }
      // El otro índice que un alta puede chocar desde la 0176: `uq_unidad_gps`
      // (un dispositivo = un camión por flota). `crearUnidad` tampoco lo
      // traduce, por el mismo motivo que el anterior.
      if (e instanceof Error && e.message.includes('uq_unidad_gps')) {
        return { ok: false, error: 'Ese número de dispositivo de GPS ya está ligado a otra unidad de tu flota con el mismo proveedor. Un dispositivo solo puede pertenecer a un camión.' };
      }
      return { ok: false, error: mensajeParaPantalla(e, id ? 'guardar la unidad' : 'dar de alta la unidad') };
    }
  }

  /**
   * ── EL ESTADO OPERATIVO DE LA UNIDAD (auditoría 20, H4) ──────────────────
   *
   * LAS MISMAS DOS PUERTAS que el alta y la edición, y por la misma razón: dar
   * de baja un camión es un acto sobre un activo de la empresa, no una nota
   * operativa. Se re-comprueban aquí adentro porque un server action es un
   * endpoint POST alcanzable sin haber pasado por el render — el `rol` de
   * arriba es el del momento en que se pintó la pantalla.
   *
   * El `tenantId` va por SESIÓN RE-RESUELTA, nunca del formulario: lo único
   * que el navegador decide es QUÉ unidad y A QUÉ estado, y las dos cosas las
   * vuelve a revisar `cambiarEstadoUnidad` (dominio del estado + `.eq(
   * 'tenant_id')` + filas afectadas). Con el UUID de una unidad de OTRA flota
   * el UPDATE toca cero filas y sale como error, no como "dada de baja".
   */
  async function cambiarEstado(_previo: ResultadoEstado, fd: FormData): Promise<ResultadoEstado> {
    'use server';
    const s = await resolverTenantEfectivo(RUTA, sp);
    if (!puedeVerRuta(s.rol, RUTA)) return { ok: false, error: 'Tu rol no puede ver las unidades.' };
    if (!puedeAdministrar(s.rol)) {
      return { ok: false, error: 'Solo el dueño de la flota cambia el estado de una unidad.' };
    }

    const unidadId = String(fd.get('unidadId') ?? '').trim();
    const estado = String(fd.get('estado') ?? '').trim();
    try {
      // El actor viaja para que la bitácora pueda contestar "quién dio de baja
      // este camión y cuándo" — la pregunta del seguro y la del contador que
      // lo deduce.
      await cambiarEstadoUnidad(s.tenantId, unidadId, estado, { id: s.userId });
      revalidatePath(RUTA);
      return {
        ok: true,
        mensaje: estado === 'baja'
          ? 'Unidad dada de baja. Deja de ofrecerse para viajes nuevos y sale del conteo de papeles; su historial queda completo.'
          : `Unidad en «${ESTADOS_UNIDAD[estado] ?? estado}».`,
      };
    } catch (e) {
      return { ok: false, error: mensajeParaPantalla(e, 'cambiar el estado de la unidad') };
    }
  }

  return (
    <>
      <VistaUnidades
        unidades={unidades}
        sp={sp}
        sufijo={sufijo}
        camposOcultos={camposOcultos}
        cambiarEstado={cambiarEstado}
        // El gateo de la UI solo decide si la forma SE PINTA; la puerta real se
        // re-comprueba adentro del action (alcanzable por POST directo).
        puedeEditar={puedeAdministrar(rol)}
        guardar={guardarUnidad}
        // Al cliente viaja SOLO id+nombre: el catálogo trae los `probar()` y
        // las fuentes de cada fabricante, y nada de eso va al navegador.
        proveedoresGps={CONECTORES_GPS.map((c) => ({ id: c.id, nombre: c.nombre }))}
      />
      {/* Fase 9 (0209): el taller — órdenes de mantenimiento y rutinas
          preventivas de las mismas unidades de arriba. */}
      <BloqueTaller sp={sp} />
    </>
  );
}
