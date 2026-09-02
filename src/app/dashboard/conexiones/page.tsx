import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { puedeAdministrar } from '@/lib/auth/permisos';
import { getConexiones, contarCredencialesGps } from '@/lib/likida/conexiones';
import { catalogoIntegraciones } from '@/lib/likida/integraciones';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import { conectorPorId } from '@/lib/likida/conectores/registro';
import { cofreConfigurado } from '@/lib/likida/conectores/cofre';
import {
  guardarCredencial, listarCredenciales, desactivarCredencial, probarCredencial,
} from '@/lib/likida/conectores/credenciales';
import type { ResultadoCredencial } from './credenciales-controles';
import {
  SeccionCredenciales, catalogoParaCaptura, pistasConRotulo, type CredencialPantalla,
} from './seccion-credenciales';
import { SeccionIntegraciones } from './seccion-integraciones';
import { VistaConexiones } from './vista';

export const dynamic = 'force-dynamic';

const RUTA = '/dashboard/conexiones';

/**
 * Conexiones (F7 del plan — el chasis de agentes): qué tiene conectado la
 * flota y qué le falta, con estado MEDIDO. Área `administracion`: es
 * configuración de la cuenta, del dueño.
 *
 * Desde C2 (auditoría 4) también CAPTURA: la sección de credenciales es quien
 * llena `conector_credencial` (0094). VER la página es área `administracion`
 * y ESCRIBIR es `puedeAdministrar` — se comprueban las dos DENTRO de cada
 * server action, porque una action es un endpoint alcanzable por POST
 * directo, no un botón (patrón llaves-api).
 */
export default async function PaginaConexiones({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string; rol?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(rol, RUTA)) redirect('/dashboard');

  // Primario sin catch: una pantalla de salud que no puede leer la salud
  // debe caerse, no pintar verdes de adorno.
  const conectores = await getConexiones(tenantId);

  // El catálogo de sistemas, que hasta agosto-2026 vivía en la pantalla gemela
  // `/dashboard/integraciones`. Su único estado medido por flota es el rastreo,
  // y ahora se mide contra la MISMA tabla que el renglón de arriba — antes cada
  // pantalla hacía su propia consulta y podían contradecirse.
  const credencialesRastreo = await contarCredencialesGps(tenantId);

  // Las credenciales son SECUNDARIAS de esta página: si su lectura falla, los
  // renglones de arriba siguen sirviendo y la sección dice "no se pudo leer"
  // — nunca una lista vacía, que invitaría a recapturar lo que sí existe.
  const guardadasCrudas = await listarCredenciales(tenantId).catch(() => null);
  const guardadas: CredencialPantalla[] | null = guardadasCrudas === null ? null
    : guardadasCrudas.map((c) => ({
      conectorId: c.conectorId,
      nombre: conectorPorId(c.conectorId)?.nombre ?? c.conectorId,
      pistas: pistasConRotulo(c.conectorId, c.pistas),
      activo: c.activo,
      probadaEn: c.probadaEn,
      ultimoError: c.ultimoError,
      creadaEn: c.creadaEn,
    }));

  async function guardar(_previo: ResultadoCredencial, fd: FormData): Promise<ResultadoCredencial> {
    'use server';
    const s = await resolverTenantEfectivo(RUTA, sp);
    if (!puedeVerRuta(s.rol, RUTA) || !puedeAdministrar(s.rol)) {
      return { ok: false, error: 'Solo el dueño de la flota guarda credenciales.' };
    }

    const conectorId = typeof fd.get('conector') === 'string' ? (fd.get('conector') as string).trim().slice(0, 64) : '';
    // Los valores se reconstruyen contra los campos DECLARADOS del conector:
    // lo que el formulario mande de más ni siquiera se lee (y el motor
    // vuelve a filtrar de todos modos).
    const valores: Record<string, string> = {};
    for (const campo of conectorPorId(conectorId)?.credenciales ?? []) {
      const v = fd.get(`campo_${campo.clave}`);
      if (typeof v === 'string') valores[campo.clave] = v;
    }

    try {
      await guardarCredencial(s.tenantId, conectorId, valores, { id: s.userId });
      revalidatePath(RUTA);
      // "Guardada" y no "conectada": nadie la ha probado contra el sistema
      // real — decir otra cosa sería fingir una conexión viva.
      return { ok: true, mensaje: 'Guardada y cifrada en el cofre — SIN PROBAR contra el sistema real todavía. La prueba de conexión se hace contigo en el arranque.' };
    } catch (e) {
      return { ok: false, error: mensajeParaPantalla(e, 'guardar la credencial') };
    }
  }

  /**
   * PROBAR: la action que hacía falta para que `probar()` dejara de ser código
   * muerto. Llama al sistema del cliente DE VERDAD con la credencial guardada
   * y sella el veredicto en la fila.
   *
   * Es `puedeAdministrar` y no solo `puedeVerRuta` por dos razones: la prueba
   * DESCIFRA un secreto de la flota, y ESCRIBE (`probada_en`/`ultimo_error`).
   * Mismo criterio que guardar y desactivar, y la RLS `administra_flota` de la
   * 0094 dice lo mismo.
   *
   * El detalle del adaptador se devuelve TAL CUAL: es lo que distingue «te
   * rechazaron el token» de «su servidor está caído», que mandan a hacer cosas
   * distintas. `mensajeParaPantalla` solo cubre lo que se ROMPE antes de llegar
   * al proveedor (cofre sin llave, base caída).
   */
  async function probar(_previo: ResultadoCredencial, fd: FormData): Promise<ResultadoCredencial> {
    'use server';
    const s = await resolverTenantEfectivo(RUTA, sp);
    if (!puedeVerRuta(s.rol, RUTA) || !puedeAdministrar(s.rol)) {
      return { ok: false, error: 'Solo el dueño de la flota prueba las conexiones.' };
    }

    const conectorId = typeof fd.get('conector') === 'string' ? (fd.get('conector') as string).trim().slice(0, 64) : '';
    try {
      const r = await probarCredencial(s.tenantId, conectorId, { id: s.userId });
      // El sello ya quedó en la fila: se revalida para que el renglón de arriba
      // enseñe «probada el …» (o el error) sin que nadie recargue a mano.
      revalidatePath(RUTA);
      if (!r.ok) return { ok: false, error: r.detalle };
      return {
        ok: true,
        // Se dice CONTRA QUÉ se habló: sin el endpoint, «conectado» es una
        // palabra sin evidencia. `verificadoContra` en null con `ok: true` no
        // puede pasar — hay una prueba del registro que lo impide.
        mensaje: r.verificadoContra
          ? `${r.detalle} (verificado contra ${r.verificadoContra})`
          : r.detalle,
      };
    } catch (e) {
      return { ok: false, error: mensajeParaPantalla(e, 'probar la conexión') };
    }
  }

  async function desactivar(_previo: ResultadoCredencial, fd: FormData): Promise<ResultadoCredencial> {
    'use server';
    const s = await resolverTenantEfectivo(RUTA, sp);
    if (!puedeVerRuta(s.rol, RUTA) || !puedeAdministrar(s.rol)) {
      return { ok: false, error: 'Solo el dueño de la flota desactiva credenciales.' };
    }

    const conectorId = typeof fd.get('conector') === 'string' ? (fd.get('conector') as string).trim().slice(0, 64) : '';
    try {
      await desactivarCredencial(s.tenantId, conectorId, { id: s.userId });
      revalidatePath(RUTA);
      return { ok: true, mensaje: 'Credencial desactivada.' };
    } catch (e) {
      return { ok: false, error: mensajeParaPantalla(e, 'desactivar la credencial') };
    }
  }

  return (
    <VistaConexiones
      conectores={conectores}
      integraciones={<SeccionIntegraciones integraciones={catalogoIntegraciones({ credencialesRastreo })} />}
      credenciales={(
        <SeccionCredenciales
          cofreListo={cofreConfigurado()}
          puedeAdministrarCofre={puedeAdministrar(rol)}
          guardadas={guardadas}
          grupos={catalogoParaCaptura()}
          acciones={{ guardar, desactivar, probar }}
        />
      )}
    />
  );
}
