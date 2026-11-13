import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSuperadmin } from '@/lib/auth/guard';
import { getPersonas, ordenarPorJerarquia, type Persona } from '@/lib/admin/personas';
import { bajaPersonalLikidaHabilitada } from '@/lib/auth/baja_acceso';
import { nombreDeRol, ROTULOS_ROL } from '@/lib/auth/roles';
import { fechaHoraMx, numero } from '@/lib/formato';
import { BarraFiltros, BotonEnlace, EstadoError, FilaTarjetas, FiltroBusqueda, FiltroOpciones, MarcoPagina, StatusChip, Tarjeta } from '../../ui-v2/componentes';
import { getResumenNegocio } from '@/lib/admin/negocio';
import { FormaNuevoAcceso } from '../usuarios/nuevo/forma-nuevo-acceso';
import { CambiarRol } from './cambiar-rol';
import { Revocar } from './revocar';
import { TablaLista, hrefConParams, type ColumnaTabla } from '../../ui-v2/datos';
import {
  accionCambiarRolUsuario, accionDarDeBajaUsuario, accionReactivarUsuario, accionReenviarAccesoUsuario, accionCerrarSesionesUsuario,
  accionDarDeBajaPersonalLikida, accionReactivarPersonalLikida,
} from '../usuarios/acciones';
import { GestionPersona } from './gestion-persona';
import '../resumen.css';

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

  // Equipo (Rovaq CF «Equipo», 1500 px): sin eyebrow; «Invitar integrante» (8) junto a «Qué puede hacer cada rol» (4) y, debajo, «Integrantes y
  // accesos» a todo el ancho. Ya no es una columna de 780 px con media pantalla vacía a la derecha.
  const marco = (cuerpo: React.ReactNode, extra: { avisos?: React.ReactNode } = {}) => (
    <MarcoPagina className="rv-esq" titulo={t('equipo.equipo')} apoyo={t('equipo.quien_puede_entrar_con')}>
      {extra.avisos ? <div className="rv-esq__avisos">{extra.avisos}</div> : null}
      {cuerpo}
    </MarcoPagina>
  );

  let lectura: Awaited<ReturnType<typeof getPersonas>>;
  try {
    lectura = await getPersonas();
  } catch {
    return marco(<Tarjeta titulo={t('equipo.personas', { flotaId: '' })}><EstadoError reintentar>{t('equipo.no_se_pudo_leer')}</EstadoError></Tarjeta>);
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
      celda: (p) => (
        <span className="adm-persona">
          <span className="adm-persona__nombre">{p.nombre ?? '(sin nombre)'}</span>
          <span className="adm-persona__correo">{p.email}</span>
          <span className="adm-persona__meta">
            {p.tenantNombre ?? (p.esLikida ? 'Likida' : '—')}{' · '}
            {!lectura.accesoLegible ? t('equipo.sin_dato') : p.sinCuentaAuth ? '—' : p.nuncaEntro ? t('equipo.nunca_entro') : p.ultimoAcceso ? fechaHoraMx(p.ultimoAcceso) : '—'}
          </span>
        </span>
      ),
    },
    {
      id: 'rol', titulo: t('equipo.rol'), valor: (p) => p.rol,
      // Select de rol de 28 px en la fila: solo para quien tiene cuenta activa de una flota (el personal de Likida no cambia de rol aquí).
      celda: (p) => p.activa && !p.esLikida && p.estado !== 'sin_acceso'
        ? <CambiarRol id={p.id} rol={p.rol} accion={accionCambiarRolUsuario} etiqueta={`${t('equipo_gestion_persona.rol_nuevo')}: ${p.nombre ?? p.email}`} />
        : nombreDeRol(p.rol),
    },
    { id: 'estado', titulo: t('equipo.estado'), valor: (p) => p.estado, celda: (p) => <StatusChip tono={TONO_ESTADO[p.estado]}>{rotuloEstado(t)[p.estado]}</StatusChip> },
    {
      id: 'acciones', titulo: t('equipo.acciones'), tituloOculto: true, alinear: 'der',
      celda: (p) => (
        <span className="adm-acciones-fila">
          <BotonEnlace href={quitar({ abrir: p.id })} tamano="sm" variante="ghost">{t('equipo.gestionar')}</BotonEnlace>
          {p.activa && !p.esLikida && p.estado !== 'sin_acceso' && p.id !== sesion.userId ? (
            <Revocar id={p.id} nombre={p.nombre ?? p.email} accion={accionDarDeBajaUsuario} etiqueta={t('equipo.revocar')}
              titulo={t('equipo_gestion_persona.dar_de_baja_a', { nombre: p.nombre ?? p.email })} descripcion={t('equipo_gestion_persona.pierde_el_acceso_al')}
              confirmar={t('equipo_gestion_persona.si_dar_de_baja')} />
          ) : null}
        </span>
      ),
    },
  ];

  const resumenEquipo = [
    `${numero(todas.length)} ${t('equipo.personas_con_cuenta').toLowerCase()}`,
    `${numero(conteo('activa'))} ${t('equipo.activas').toLowerCase()}`,
    `${numero(conteo('baja'))} ${t('equipo.de_baja').toLowerCase()}`,
    lectura.accesoLegible ? `${numero(nuncaEntraron)} ${t('equipo.nunca_han_entrado').toLowerCase()}` : t('equipo.no_se_pudo_leer_2'),
  ].join(' · ');
  const nActivos = (q ? 1 : 0) + (estado !== 'todas' ? 1 : 0) + (flotaId ? 1 : 0);
  const { flotas }: { flotas: ReadonlyArray<{ id: string; nombre: string }> } = await getResumenNegocio().catch(() => ({ flotas: [] }));

  const gestion = seleccionada ? (
    <GestionPersona
      t={t}
      p={seleccionada} yo={sesion.userId} bajaLikidaHabilitada={bajaPersonalLikidaHabilitada()}
      acciones={{
        cambiarRol: accionCambiarRolUsuario, darDeBaja: accionDarDeBajaUsuario, reactivar: accionReactivarUsuario,
        reenviarAcceso: accionReenviarAccesoUsuario, cerrarSesiones: accionCerrarSesionesUsuario,
        darDeBajaLikida: accionDarDeBajaPersonalLikida, reactivarLikida: accionReactivarPersonalLikida,
      }}
    />
  ) : abrir ? <Tarjeta titulo={t('equipo.persona_no_encontrada')} estado="vacio" mensaje={t('equipo.esa_cuenta_ya_no')} detalle={t('equipo.vuelve_a_la_lista')} /> : null;

  const roles = Object.entries(ROTULOS_ROL).filter(([rol]) => rol !== 'operador');

  const cuerpoPersonas = todas.length === 0 ? (
    <Tarjeta titulo={t('equipo.sin_personas_con_cuenta')} estado="vacio" mensaje={t('equipo.sin_personas_con_cuenta')} detalle={t('equipo.da_de_alta_a')} />
  ) : (
    <>
      <BarraFiltros accion="/admin/equipo" enLinea buscar etiqueta={t('equipo.filtros_del_equipo')} nActivos={nActivos}
        limpiarHref="/admin/equipo" ocultos={[...(estado !== 'todas' ? [['estado', estado] as [string, string]] : []), ...(flotaId ? [['flota', flotaId] as [string, string]] : [])]}>
        <FiltroOpciones etiqueta={t('equipo.estado')} valor={estado} porDefecto="todas"
          opciones={estados(t).map((e) => ({ valor: e.valor, rotulo: e.rotulo, href: quitar({ estado: e.valor === 'todas' ? null : e.valor, abrir: null }) }))} />
        <FiltroBusqueda nombre="q" valor={q} placeholder={t('equipo.nombre_correo_rol_o')} etiqueta={t('equipo.buscar_persona')} />
      </BarraFiltros>
      <TablaLista
        etiqueta={t('equipo.personas_con_acceso')} columnas={columnas} filas={filas} idFila={(p) => p.id}
        base="/admin/equipo" params={sp} orden="local" paginacion={{ tamano: 25 }}
        vacio={{ titulo: t('equipo.ninguna_persona_coincide'), texto: t('equipo.cambia_o_quita_los') }}
      />
      {!lectura.accesoLegible && <p className="rv-esq__fila-ayuda">{t('equipo.no_se_pudo_leer_3')}</p>}
      <p className="rv-esq__fila-ayuda">{numero(filas.length)} de {numero(todas.length)} personas.</p>
    </>
  );

  return marco(
    <>
      {gestion ? <Tarjeta titulo={t('equipo_gestion_persona.gestionar_a', { nombre: seleccionada?.nombre ?? seleccionada?.email ?? '' })}>{gestion}</Tarjeta> : null}
      <FilaTarjetas variante="8-4" className="adm-fila-alto-contenido">
        <Tarjeta titulo={t('equipo.invitar_integrante')}>
          <p className="adm-tarjeta-desc">{t('equipo.invitar_ayuda')}</p>
          <FormaNuevoAcceso flotas={flotas} preseleccion={flotas.some((f) => f.id === flotaId) ? flotaId : ''} t={t} />
        </Tarjeta>
        <Tarjeta titulo={t('equipo.que_puede_hacer_cada')}>
          <ul className="adm-roles">
            {roles.map(([rol, r]) => <li key={rol}><strong>{r.nombre}</strong><span>{r.detalle}</span></li>)}
          </ul>
          <p className="rv-esq__fila-ayuda">{t('equipo.el_chofer_no_tiene')}</p>
        </Tarjeta>
      </FilaTarjetas>
      <Tarjeta titulo={t('equipo.personas', { flotaId: flotaId && nombreFlota ? `: ${nombreFlota}` : '' })}>
        <p className="adm-tarjeta-desc">{resumenEquipo}</p>
        {cuerpoPersonas}
      </Tarjeta>
    </>,
    {
    avisos: flotaId ? (
      <p>{t('equipo.solo_la_flota')} {nombreFlota ?? 'elegida'}. <Link href={quitar({ flota: null, abrir: null })}>{t('equipo.ver_todas')}</Link></p>
    ) : null,
    },
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('admin_flotas');
  return { title: t('equipo.equipo') };
}
