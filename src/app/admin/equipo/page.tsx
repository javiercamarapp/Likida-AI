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

export const dynamic = 'force-dynamic';

type Params = Record<string, string | string[] | undefined>;
const uno = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
const ESTADOS = [
  { valor: 'todas', rotulo: 'Todas' }, { valor: 'activa', rotulo: 'Activas' }, { valor: 'baja', rotulo: 'De baja' }, { valor: 'sin_acceso', rotulo: 'Sin cuenta de acceso' },
] as const;
const ROTULO_ESTADO = { activa: 'Activa', baja: 'De baja', sin_acceso: 'Sin cuenta de acceso' } as const;
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
  // A37-S05-01/S06-01: puerta propia; el layout puede no ejecutarse en una petición RSC parcial.
  const sesion = await requireSuperadmin();
  const sp = (await searchParams) ?? {};
  const q = uno(sp.q).trim();
  const estado = ESTADOS.some((e) => e.valor === uno(sp.estado)) ? uno(sp.estado) : 'todas';
  const flotaId = uno(sp.flota);
  const abrir = uno(sp.abrir);

  const marco = (hijos: React.ReactNode) => (
    <MarcoPagina area="Control" titulo="Equipo" apoyo="Quién puede entrar, con qué rol, desde cuándo y cuándo fue su último acceso.">{hijos}</MarcoPagina>
  );

  let lectura: Awaited<ReturnType<typeof getPersonas>>;
  try {
    lectura = await getPersonas();
  } catch {
    return marco(<EstadoError reintentar>No se pudo leer el equipo.</EstadoError>);
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
      id: 'persona', titulo: 'Persona', principal: true, valor: (p) => (p.nombre ?? p.email).toLowerCase(),
      celda: (p) => <span>{p.nombre ?? '(sin nombre)'}<br /><small>{p.email}</small></span>,
    },
    { id: 'rol', titulo: 'Rol', valor: (p) => p.rol, celda: (p) => nombreDeRol(p.rol) },
    { id: 'flota', titulo: 'Flota', valor: (p) => p.tenantNombre ?? '', celda: (p) => p.tenantNombre ?? (p.esLikida ? 'Likida' : '—') },
    { id: 'estado', titulo: 'Estado', valor: (p) => p.estado, celda: (p) => <StatusChip tono={TONO_ESTADO[p.estado]}>{ROTULO_ESTADO[p.estado]}</StatusChip> },
    {
      id: 'acceso', titulo: 'Último acceso', corta: true, valor: (p) => p.ultimoAcceso ?? '',
      celda: (p) => !lectura.accesoLegible ? 'Sin dato' : p.sinCuentaAuth ? '—' : p.nuncaEntro ? 'Nunca entró' : p.ultimoAcceso ? fechaHoraMx(p.ultimoAcceso) : '—',
    },
    {
      id: 'acciones', titulo: 'Acciones', tituloOculto: true, alinear: 'der',
      celda: (p) => <BotonEnlace href={quitar({ abrir: p.id })} tamano="sm" variante="secondary">Gestionar</BotonEnlace>,
    },
  ];

  return marco(
    <>
      <TiraCifras etiqueta="Resumen del equipo">
        <Cifra etiqueta="Personas con cuenta" valor={todas.length} formato="entero" />
        <Cifra etiqueta="Activas" valor={conteo('activa')} formato="entero" />
        <Cifra etiqueta="De baja" valor={conteo('baja')} formato="entero" />
        <Cifra
          etiqueta="Nunca han entrado" valor={lectura.accesoLegible ? nuncaEntraron : null} formato="entero"
          estado={lectura.accesoLegible ? 'ok' : 'error'} mensaje="No se pudo leer el último acceso."
          nota={lectura.accesoLegible ? 'Se les dio de alta, pero no han iniciado sesión' : undefined} tono={lectura.accesoLegible && nuncaEntraron > 0 ? 'warn' : undefined}
        />
      </TiraCifras>

      {seleccionada && (
        <GestionPersona
          p={seleccionada} yo={sesion.userId} bajaLikidaHabilitada={bajaPersonalLikidaHabilitada()}
          acciones={{
            cambiarRol: accionCambiarRolUsuario, darDeBaja: accionDarDeBajaUsuario, reactivar: accionReactivarUsuario,
            reenviarAcceso: accionReenviarAccesoUsuario, cerrarSesiones: accionCerrarSesionesUsuario,
            darDeBajaLikida: accionDarDeBajaPersonalLikida, reactivarLikida: accionReactivarPersonalLikida,
          }}
        />
      )}
      {abrir && !seleccionada && <Tarjeta titulo="Persona no encontrada" estado="vacio" mensaje="Esa cuenta ya no existe" detalle="Vuelve a la lista y elige otra." />}

      <Tarjeta
        titulo={`Personas${flotaId && nombreFlota ? `: ${nombreFlota}` : ''}`}
        acciones={<BotonEnlace href="/admin/usuarios/nuevo" variante="primary" tamano="sm">Nuevo acceso</BotonEnlace>}
        estado={todas.length === 0 ? 'vacio' : 'ok'} mensaje="Sin personas con cuenta" detalle="Da de alta a la primera desde «Nuevo acceso»."
      >
        <BarraFiltros accion="/admin/equipo" enLinea buscar etiqueta="Filtros del equipo" nActivos={(q ? 1 : 0) + (estado !== 'todas' ? 1 : 0) + (flotaId ? 1 : 0)}
          limpiarHref="/admin/equipo" ocultos={[...(estado !== 'todas' ? [['estado', estado] as [string, string]] : []), ...(flotaId ? [['flota', flotaId] as [string, string]] : [])]}>
          <FiltroOpciones etiqueta="Estado" valor={estado} porDefecto="todas"
            opciones={ESTADOS.map((e) => ({ valor: e.valor, rotulo: e.rotulo, href: quitar({ estado: e.valor === 'todas' ? null : e.valor, abrir: null }) }))} />
          <FiltroBusqueda nombre="q" valor={q} placeholder="Nombre, correo, rol o flota" etiqueta="Buscar persona" />
        </BarraFiltros>
        {flotaId && (
          <p>Solo la flota {nombreFlota ?? 'elegida'}. <Link href={quitar({ flota: null, abrir: null })}>Ver todas</Link></p>
        )}
        <TablaLista
          etiqueta="Personas con acceso" columnas={columnas} filas={filas} idFila={(p) => p.id}
          base="/admin/equipo" params={sp} orden="local" paginacion={{ tamano: 25 }}
          vacio={{ titulo: 'Ninguna persona coincide', texto: 'Cambia o quita los filtros.' }}
        />
        {!lectura.accesoLegible && <p>No se pudo leer el último acceso de las cuentas: no se afirma quién nunca ha entrado.</p>}
        <p>{numero(filas.length)} de {numero(todas.length)} personas.</p>
      </Tarjeta>

      <Disclosure titulo="Qué puede hacer cada rol" resumen="Catálogo de roles">
        <ul>
          {Object.entries(ROTULOS_ROL).filter(([rol]) => rol !== 'operador').map(([rol, r]) => (
            <li key={rol}><strong>{r.nombre}.</strong> {r.detalle}</li>
          ))}
        </ul>
        <p>
          El chofer no tiene cuenta: habla con el bot por WhatsApp. Cada alta, cambio de rol, baja, reactivación, reenvío de acceso y cierre
          de sesiones queda asentado en la bitácora de auditoría con quién lo hizo.
        </p>
      </Disclosure>
    </>,
  );
}

export const metadata: Metadata = { title: 'Equipo' };
