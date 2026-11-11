import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSuperadmin } from '@/lib/auth/guard';
import { getPersonas, ordenarPorJerarquia, type Persona } from '@/lib/admin/personas';
import { bajaPersonalLikidaHabilitada } from '@/lib/auth/baja_acceso';
import { nombreDeRol, ROTULOS_ROL } from '@/lib/auth/roles';
import { fechaHoraMx, numero } from '@/lib/formato';
import { BarraFiltros, BotonEnlace, Disclosure, EstadoError, FiltroBusqueda, FiltroOpciones, MarcoPagina, StatusChip, Tarjeta } from '../../ui-v2/componentes';
import { Cifra, TiraCifras } from '../../ui-v2/graficas';
import { TablaLista, hrefConParams, type ColumnaTabla } from '../../ui-v2/datos';
import {
  accionCambiarRolUsuario, accionDarDeBajaUsuario, accionReactivarUsuario, accionReenviarAccesoUsuario, accionCerrarSesionesUsuario,
  accionDarDeBajaPersonalLikida, accionReactivarPersonalLikida,
} from '../usuarios/acciones';
import { GestionPersona } from './gestion-persona';

import type { TrDe } from '@/lib/i18n/tr_tipos';
import { getT } from '@/lib/i18n/servidor';
export const dynamic = 'force-dynamic';

type Params = Record<string, string | string[] | undefined>;
const uno = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
const estados = (t: TrDe<'admin_flotas'>) => [
  { valor: 'todas', rotulo: t('equipo.todas') }, { valor: 'activa', rotulo: t('equipo.activas') }, { valor: 'baja', rotulo: t('equipo.de_baja') }, { valor: 'sin_acceso', rotulo: t('equipo.sin_cuenta_de_acceso') },
] as const;
const rotuloEstado = (t: TrDe<'admin_flotas'>) => ({ activa: t('equipo.activa'), baja: t('equipo.de_baja'), sin_acceso: t('equipo.sin_cuenta_de_acceso') } as const);
const TONO_ESTADO = { activa: 'ok', baja: 'muted', sin_acceso: 'bad' } as const;

/** Búsqueda por nombre, correo, rol o flota (sin acentos ni mayúsculas). */
function coincide(p: Persona, q: string): boolean {
  if (!q) return true;
  const plano = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return plano([p.nombre, p.email, p.rol, nombreDeRol(p.rol), p.tenantNombre].filter(Boolean).join(' ')).includes(plano(q));
}

/**
 * Equipo › Personas — TODAS las personas con acceso (personal de Likida y de cada flota): rol, flota, estado (activa, de baja o sin
 * cuenta de acceso), último acceso y las acciones de gestión con confirmación. Cruza flotas a propósito. Cada lectura cae por su lado:
 * si no se pudo leer el acceso, el último acceso dice «sin dato» y nunca «nunca entró».
 */
export default async function EquipoPage({ searchParams }: { searchParams?: Promise<Params> }) {
  const { t } = await getT('admin_flotas');
  // A37-S05-01/S06-01: puerta propia; el layout puede no ejecutarse en una petición RSC parcial.
  const sesion = await requireSuperadmin();
  const sp = (await searchParams) ?? {};
  const q = uno(sp.q).trim();
  const estado = estados(t).some((e) => e.valor === uno(sp.estado)) ? uno(sp.estado) : 'todas';
  const flotaId = uno(sp.flota);
  const abrir = uno(sp.abrir);

  const marco = (hijos: React.ReactNode) => (
    <MarcoPagina area="Control" titulo={t('equipo.equipo')} apoyo={t('equipo.quien_puede_entrar_con')}>{hijos}</MarcoPagina>
  );

  let lectura: Awaited<ReturnType<typeof getPersonas>>;
  try {
    lectura = await getPersonas();
  } catch {
    return marco(<EstadoError reintentar>{t('equipo.no_se_pudo_leer')}</EstadoError>);
  }
  const todas = ordenarPorJerarquia(lectura.personas);
  const nombreFlota = flotaId ? todas.find((p) => p.tenantId === flotaId)?.tenantNombre ?? null : null;
  const filas = todas.filter((p) => coincide(p, q)
    && (estado === 'todas' || p.estado === estado)
    && (!flotaId || p.tenantId === flotaId));
  const seleccionada = abrir ? todas.find((p) => p.id === abrir) : undefined;

  const quitar = (cambios: Record<string, string | null>) => hrefConParams('/admin/equipo', sp, cambios);
  const conteo = (e: Persona['estado']) => todas.filter((p) => p.estado === e).length;
  const nuncaEntraron = todas.filter((p) => p.nuncaEntro).length;

  const columnas: ColumnaTabla<Persona>[] = [
    {
      id: 'persona', titulo: t('equipo.persona'), principal: true, valor: (p) => (p.nombre ?? p.email).toLowerCase(),
      celda: (p) => <span>{p.nombre ?? '(sin nombre)'}<br /><small>{p.email}</small></span>,
    },
    { id: 'rol', titulo: t('equipo.rol'), valor: (p) => p.rol, celda: (p) => nombreDeRol(p.rol) },
    { id: 'flota', titulo: t('equipo.flota'), valor: (p) => p.tenantNombre ?? '', celda: (p) => p.tenantNombre ?? (p.esLikida ? 'Likida' : '—') },
    { id: 'estado', titulo: t('equipo.estado'), valor: (p) => p.estado, celda: (p) => <StatusChip tono={TONO_ESTADO[p.estado]}>{rotuloEstado(t)[p.estado]}</StatusChip> },
    {
      id: 'acceso', titulo: t('equipo.ultimo_acceso'), corta: true, valor: (p) => p.ultimoAcceso ?? '',
      celda: (p) => !lectura.accesoLegible ? t('equipo.sin_dato') : p.sinCuentaAuth ? '—' : p.nuncaEntro ? t('equipo.nunca_entro') : p.ultimoAcceso ? fechaHoraMx(p.ultimoAcceso) : '—',
    },
    {
      id: 'acciones', titulo: t('equipo.acciones'), tituloOculto: true, alinear: 'der',
      celda: (p) => <BotonEnlace href={quitar({ abrir: p.id })} tamano="sm" variante="secondary">Gestionar</BotonEnlace>,
    },
  ];

  return marco(
    <>
      <TiraCifras etiqueta={t('equipo.resumen_del_equipo')}>
        <Cifra etiqueta={t('equipo.personas_con_cuenta')} valor={todas.length} formato="entero" />
        <Cifra etiqueta={t('equipo.activas')} valor={conteo('activa')} formato="entero" />
        <Cifra etiqueta={t('equipo.de_baja')} valor={conteo('baja')} formato="entero" />
        <Cifra
          etiqueta={t('equipo.nunca_han_entrado')} valor={lectura.accesoLegible ? nuncaEntraron : null} formato="entero"
          estado={lectura.accesoLegible ? 'ok' : 'error'} mensaje={t('equipo.no_se_pudo_leer_2')}
          nota={lectura.accesoLegible ? t('equipo.se_les_dio_de') : undefined} tono={lectura.accesoLegible && nuncaEntraron > 0 ? 'warn' : undefined}
        />
      </TiraCifras>

      {seleccionada && (
        <GestionPersona
          t={t}
          p={seleccionada} yo={sesion.userId} bajaLikidaHabilitada={bajaPersonalLikidaHabilitada()}
          acciones={{
            cambiarRol: accionCambiarRolUsuario, darDeBaja: accionDarDeBajaUsuario, reactivar: accionReactivarUsuario,
            reenviarAcceso: accionReenviarAccesoUsuario, cerrarSesiones: accionCerrarSesionesUsuario,
            darDeBajaLikida: accionDarDeBajaPersonalLikida, reactivarLikida: accionReactivarPersonalLikida,
          }}
        />
      )}
      {abrir && !seleccionada && <Tarjeta titulo={t('equipo.persona_no_encontrada')} estado="vacio" mensaje={t('equipo.esa_cuenta_ya_no')} detalle={t('equipo.vuelve_a_la_lista')} />}

      <Tarjeta
        titulo={t('equipo.personas', { flotaId: flotaId && nombreFlota ? `: ${nombreFlota}` : '' })}
        acciones={<BotonEnlace href="/admin/usuarios/nuevo" variante="primary" tamano="sm">{t('equipo.nuevo_acceso')}</BotonEnlace>}
        estado={todas.length === 0 ? 'vacio' : 'ok'} mensaje={t('equipo.sin_personas_con_cuenta')} detalle={t('equipo.da_de_alta_a')}
      >
        <BarraFiltros accion="/admin/equipo" enLinea buscar etiqueta={t('equipo.filtros_del_equipo')} nActivos={(q ? 1 : 0) + (estado !== 'todas' ? 1 : 0) + (flotaId ? 1 : 0)}
          limpiarHref="/admin/equipo" ocultos={[...(estado !== 'todas' ? [['estado', estado] as [string, string]] : []), ...(flotaId ? [['flota', flotaId] as [string, string]] : [])]}>
          <FiltroOpciones etiqueta={t('equipo.estado')} valor={estado} porDefecto="todas"
            opciones={estados(t).map((e) => ({ valor: e.valor, rotulo: e.rotulo, href: quitar({ estado: e.valor === 'todas' ? null : e.valor, abrir: null }) }))} />
          <FiltroBusqueda nombre="q" valor={q} placeholder={t('equipo.nombre_correo_rol_o')} etiqueta={t('equipo.buscar_persona')} />
        </BarraFiltros>
        {flotaId && (
          <p>{t('equipo.solo_la_flota')} {nombreFlota ?? 'elegida'}. <Link href={quitar({ flota: null, abrir: null })}>{t('equipo.ver_todas')}</Link></p>
        )}
        <TablaLista
          etiqueta={t('equipo.personas_con_acceso')} columnas={columnas} filas={filas} idFila={(p) => p.id}
          base="/admin/equipo" params={sp} orden="local" paginacion={{ tamano: 25 }}
          vacio={{ titulo: t('equipo.ninguna_persona_coincide'), texto: t('equipo.cambia_o_quita_los') }}
        />
        {!lectura.accesoLegible && <p>{t('equipo.no_se_pudo_leer_3')}</p>}
        <p>{numero(filas.length)} de {numero(todas.length)} personas.</p>
      </Tarjeta>

      <Disclosure titulo={t('equipo.que_puede_hacer_cada')} resumen="Catálogo de roles">
        <ul>
          {Object.entries(ROTULOS_ROL).filter(([rol]) => rol !== 'operador').map(([rol, r]) => (
            <li key={rol}><strong>{r.nombre}.</strong> {r.detalle}</li>
          ))}
        </ul>
        <p>
          
          {t('equipo.el_chofer_no_tiene')}
        </p>
      </Disclosure>
    </>,
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('admin_flotas');
  return { title: t('equipo.equipo') };
}
