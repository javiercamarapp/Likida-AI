'use client';

import { useId, useRef, useState, type ComponentType, type ReactNode } from 'react';
import Link from 'next/link';
import { Bell, Building2, ChevronDown, LogOut, SunMoon } from 'lucide-react';
import { OPCIONES_TEMA, useTema } from '../../selector-tema';
import { TRAZO_ICONO } from './icono';
import { Popover, MenuList } from './overlay';
import { shell as shellEs } from '@/lib/i18n/es/shell';
import { crearTraductor, type Traductor } from '@/lib/i18n/traducir';
import type { DiccionarioDe } from '@/lib/i18n/catalogo';
import { useIdioma, useT } from '@/lib/i18n/proveedor';
import { solicitarCambioIdioma } from '@/lib/i18n/cambiar';
import { IDIOMAS, idiomaElegible, type Idioma } from '@/lib/i18n/idioma';

type TraductorShell = Traductor<DiccionarioDe<'shell'>>;
/** El traductor en español: lo que dice el pie sin proveedor de idioma (y lo que usan las pruebas y `etiquetaAvisos` por omisión). */
const TRADUCTOR_ES: TraductorShell = crearTraductor<DiccionarioDe<'shell'>>('es', shellEs, shellEs);

// ═══════════════════════════════════════════════════════════════════════════
// EL PIE DEL SIDEBAR — UNA sola pieza para el dashboard del cliente y el admin (ronda W4, igualar a Rovaq).
// De arriba abajo, como Rovaq: rótulo «Organización» · selector + «Ir ↗» · «Avisos» · acceso cruzado · tema + idioma ·
// tarjeta de usuario. Estilos en `ui-v2/pie-sidebar.css`. Plegado (riel de 72) y la hoja «Más» salen de las mismas clases.
// ═══════════════════════════════════════════════════════════════════════════

export interface OpcionOrganizacion { valor: string; nombre: string }

/**
 * `opciones === null` = la lista no se pudo leer: se DICE («Sin dato»), no se enseña vacía.
 * Con una sola opción el selector es un campo fijo (sin chevron); con varias es un `<select>` real.
 */
export interface OrganizacionPie {
  opciones: OpcionOrganizacion[] | null;
  actual: string | null;
  /** A dónde lleva «Ir» para la organización elegida. */
  hrefIr: (valor: string) => string;
  textoIr?: string;
  /** Destino cuando no hay organización elegible (p. ej. el selector de flota del admin). */
  hrefSinOpcion?: string;
}

/** `pendientes`: número = real; `null` = lectura caída («sin dato», nunca 0); `undefined` = la fuente no se pidió (sin cifra). */
export interface AvisosPie { href: string; pendientes?: number | null; urgente?: boolean }

export interface AccesoPie { href: string; texto: string; Icono: ComponentType<{ width?: number; height?: number; strokeWidth?: number; 'aria-hidden'?: boolean }> }

const TOPE_VISIBLE = 99;

/** El texto de «Avisos» para lectores de pantalla y tooltip. `null` = «sin dato», nunca «0». Sin traductor, en español. */
export function etiquetaAvisos(a: Pick<AvisosPie, 'pendientes' | 'urgente'>, tr: TraductorShell = TRADUCTOR_ES): string {
  if (a.pendientes === undefined) return tr.t('pie.avisos.titulo');
  if (a.pendientes === null) return tr.t('pie.avisos.sinDato');
  if (a.pendientes === 0) return tr.t('pie.avisos.nadaPendiente');
  return tr.tp(a.urgente ? 'pie.avisos.pendientesUrgente' : 'pie.avisos.pendientes', a.pendientes);
}

/** Iniciales de un nombre: dos palabras → 1.ª letra de cada una; una → sus dos primeras. */
export function inicialesDe(nombre: string | null): string {
  const pal = (nombre ?? '').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  if (pal.length === 0) return '?';
  const r = pal.length >= 2 ? pal[0].slice(0, 1) + pal[1].slice(0, 1) : pal[0].slice(0, 2);
  return r.toLocaleUpperCase('es');
}

function Organizacion({ org, alNavegar }: { org: OrganizacionPie; alNavegar?: () => void }) {
  const { t } = useT('shell', shellEs);
  const id = useId();
  const opciones = org.opciones ?? [];
  const [elegida, setElegida] = useState<string | null>(org.actual);
  const valor = opciones.some((o) => o.valor === elegida) ? elegida : (opciones[0]?.valor ?? null);
  const nombre = opciones.find((o) => o.valor === valor)?.nombre ?? null;
  const destino = valor ? org.hrefIr(valor) : org.hrefSinOpcion ?? null;
  const textoIr = org.textoIr ?? t('pie.org.ir');
  return (
    <section className="rv-ps-org" aria-labelledby={`${id}-t`}>
      <p id={`${id}-t`} className="rv-ps-cap">{t('pie.org.titulo')}</p>
      <div className="rv-ps-org__fila">
        {org.opciones === null ? (
          <span className="rv-ps-campo" data-sin-dato>{t('pie.org.sinDato')}</span>
        ) : opciones.length > 1 ? (
          <span className="rv-ps-select">
            <select aria-label={t('pie.org.titulo')} value={valor ?? ''} onChange={(e) => setElegida(e.target.value)}>
              {opciones.map((o) => <option key={o.valor} value={o.valor}>{o.nombre}</option>)}
            </select>
            <ChevronDown className="rv-ps-select__chev" width={16} height={16} strokeWidth={TRAZO_ICONO} aria-hidden />
          </span>
        ) : (
          <span className="rv-ps-campo" title={nombre ?? undefined}>{nombre ?? t('pie.org.sinOrganizacion')}</span>
        )}
        {destino && (
          <Link href={destino} className="rv-ps-ir" aria-label={nombre ? t('pie.org.irA', { ir: textoIr, nombre }) : textoIr} title={textoIr} onClick={alNavegar}>
            {textoIr} <span aria-hidden>↗</span>
          </Link>
        )}
      </div>
      {/* Solo en el riel (72 px): la organización se reduce a un icono con su nombre en el tooltip. */}
      {destino && (
        <Link href={destino} className="rv-item rv-ps-org__riel" aria-label={t('pie.org.irA', { ir: textoIr, nombre: nombre ?? t('pie.org.sinNombre') })} title={nombre ?? t('pie.org.titulo')} onClick={alNavegar}>
          <Building2 className="rv-item__ico" width={16} height={16} strokeWidth={TRAZO_ICONO} aria-hidden />
        </Link>
      )}
    </section>
  );
}

/** Tres celdas (sol, monitor, luna) con radios nativos: las flechas del teclado recorren el grupo. Aplica y persiste con `useTema`. */
export function ConmutadorTema() {
  const { t } = useT('shell', shellEs);
  const { tema, elegir } = useTema();
  const nombre = `pie-tema-${useId()}`;
  return (
    <fieldset className="rv-ps-seg" data-conmutador="tema">
      <legend className="rv-ps-sr">{t('pie.tema.titulo')}</legend>
      {OPCIONES_TEMA.map(({ valor, Icono }) => (
        <label key={valor} title={t(`pie.tema.${valor}`)}>
          <input type="radio" className="rv-ps-sr" name={nombre} value={valor} checked={tema === valor} onChange={() => elegir(valor)} aria-label={t(`pie.tema.${valor}`)} />
          <Icono width={16} height={16} strokeWidth={TRAZO_ICONO} aria-hidden />
        </label>
      ))}
    </fieldset>
  );
}

/** En el riel no caben tres celdas: un solo botón que pasa al siguiente tema (claro, sistema, oscuro) y dice cuál sigue. */
function CicloTema() {
  const { t } = useT('shell', shellEs);
  const { tema, elegir } = useTema();
  const i = OPCIONES_TEMA.findIndex((o) => o.valor === tema);
  const actual = t(`pie.tema.${OPCIONES_TEMA[i < 0 ? 0 : i].valor}`);
  const sigue = OPCIONES_TEMA[(i + 1) % OPCIONES_TEMA.length];
  const siguiente = t(`pie.tema.${sigue.valor}`);
  return (
    <button type="button" className="rv-item rv-ps-tema__riel" aria-label={t('pie.tema.ciclo', { actual, siguiente })} title={t('pie.tema.cicloTitulo', { actual, siguiente })}
      onClick={() => elegir(sigue.valor)}>
      <SunMoon className="rv-item__ico" width={16} height={16} strokeWidth={TRAZO_ICONO} aria-hidden />
    </button>
  );
}

function Bandera({ pais }: { pais: 'mx' | 'us' }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg className="rv-ps-bandera" viewBox="0 0 16 16" width="16" height="16" aria-hidden focusable="false">
      <defs><clipPath id={`b-${id}`}><circle cx="8" cy="8" r="8" /></clipPath></defs>
      <g clipPath={`url(#b-${id})`}>
        {pais === 'mx' ? (
          <>
            <rect width="5.34" height="16" fill="#006847" />
            <rect width="5.34" height="16" x="5.33" fill="#ffffff" />
            <rect width="5.34" height="16" x="10.66" fill="#ce1126" />
            <circle cx="8" cy="8" r="1.9" fill="none" stroke="#8a6a2f" strokeWidth="0.8" />
          </>
        ) : (
          <>
            <rect width="16" height="16" fill="#ffffff" />
            {[0, 1, 2, 3, 4, 5, 6].map((n) => <rect key={n} y={n * 2.3} width="16" height="1.15" fill="#b22234" />)}
            <rect width="8" height="9.2" fill="#3d3d3d" />
          </>
        )}
      </g>
    </svg>
  );
}

/**
 * Idioma MX / US. Cambia el idioma DE VERDAD: pide al servidor la cookie `likida_lang` + la preferencia del usuario
 * (`POST /api/preferencias/idioma`) y, solo si el servidor confirma, recarga para que los Server Components lean el idioma
 * nuevo. Si el servidor no confirma, NO finge el cambio: lo dice y deja marcado el idioma que sigue vigente.
 */
export function ConmutadorIdioma() {
  const { t } = useT('shell', shellEs);
  const activo = useIdioma();
  const nombre = `pie-idioma-${useId()}`;
  const [pendiente, setPendiente] = useState(false);
  const [fallo, setFallo] = useState(false);
  async function elegir(nuevo: Idioma) {
    if (nuevo === activo || pendiente || !idiomaElegible(nuevo)) return;
    setPendiente(true);
    setFallo(false);
    if (await solicitarCambioIdioma(nuevo)) {
      // Recarga completa: es la forma que no depende de ningún router y relee layout, cookies y diccionarios del servidor.
      window.location.reload();
      return;
    }
    setPendiente(false);
    setFallo(true);
  }
  return (
    <fieldset className="rv-ps-seg" data-conmutador="idioma" disabled={pendiente} aria-busy={pendiente || undefined} title={t('pie.idioma.titulo')}>
      <legend className="rv-ps-sr">{t('pie.idioma.titulo')}</legend>
      {IDIOMAS.map((idioma) => {
        const bloqueado = !idiomaElegible(idioma);
        const nombreIdioma = bloqueado ? t('pie.idioma.proximamente') : t(`pie.idioma.${idioma}`);
        return (
          <label key={idioma} title={nombreIdioma} data-no-disponible={bloqueado || undefined}>
            <input type="radio" className="rv-ps-sr" name={nombre} value={idioma} checked={activo === idioma} disabled={bloqueado}
              onChange={() => { void elegir(idioma); }} aria-label={nombreIdioma} />
            <Bandera pais={idioma === 'es' ? 'mx' : 'us'} />
          </label>
        );
      })}
      <span className="rv-ps-sr" role="status">{fallo ? t('pie.idioma.error') : ''}</span>
    </fieldset>
  );
}

/**
 * La tarjeta de usuario: iniciales en cuadro, nombre, rol legible y «Salir». El cuerpo es un enlace (`href`) o abre un menú
 * (`menu`: las filas ya armadas; Popover y MenuList del sistema de overlays: posición, foco, Esc, flechas).
 */
export function TarjetaUsuario({ nombre, rolEtiqueta, iniciales, avatarUrl, href, menu, cerrarSesion, salir, alElegir, abiertoInicial = false }: {
  nombre: string | null; rolEtiqueta: string; iniciales: string; avatarUrl?: string | null;
  href?: string; menu?: ReactNode; cerrarSesion?: () => Promise<void>;
  /** Alternativa a `cerrarSesion` para un servidor que no pasa funciones al cliente: el `<form>` de salir ya armado (clase `rv-cuenta__salir`). */
  salir?: ReactNode; alElegir?: () => void;
  /** Solo para pruebas de render estático. */
  abiertoInicial?: boolean;
}) {
  const { t } = useT('shell', shellEs);
  const [abierto, setAbierto] = useState(abiertoInicial);
  const gatillo = useRef<HTMLButtonElement>(null);
  const idMenu = useId();
  const mostrar = (nombre ?? '').trim() || t('pie.cuenta.fallback');
  const cuerpo = (
    <>
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- avatar chico de Storage
        <img src={avatarUrl} alt="" className="rv-avatar rv-avatar--img" />
      ) : <span className="rv-avatar" aria-hidden>{iniciales}</span>}
      <span className="rv-cuenta__txt">
        <span className="rv-cuenta__nombre">{mostrar}</span>
        <span className="rv-cuenta__rol">{rolEtiqueta}</span>
      </span>
    </>
  );
  return (
    <div className="rv-cuenta">
      {menu ? (
        <button ref={gatillo} type="button" className="rv-cuenta__btn" aria-haspopup="menu" aria-expanded={abierto} aria-controls={abierto ? idMenu : undefined}
          title={t('pie.cuenta.menu')} onClick={() => setAbierto((a) => !a)}>{cuerpo}</button>
      ) : (
        <Link href={href ?? '#'} className="rv-cuenta__btn" aria-label={t('pie.cuenta.fallback')} title={t('pie.cuenta.fallback')} onClick={alElegir}>{cuerpo}</Link>
      )}
      {salir}
      {!salir && cerrarSesion && (
        <form action={cerrarSesion} className="rv-cuenta__salir">
          <button type="submit" title={t('pie.cuenta.salir')} aria-label={t('pie.cuenta.salir')} className="rv-icono-boton">
            <LogOut width={16} height={16} strokeWidth={TRAZO_ICONO} aria-hidden />
          </button>
        </form>
      )}
      {menu && (
        <Popover abierto={abierto} onCerrar={() => setAbierto(false)} ancla={gatillo} etiqueta={t('pie.cuenta.etiqueta')} alineacion="inicio">
          {/* En CAPTURA, antes que el MenuList: Tab sale del menú y lo cierra; Esc no cierra además la hoja «Más». */}
          <div id={idMenu} onKeyDownCapture={(e) => {
            if (e.key === 'Tab') { setAbierto(false); return; }
            if (e.key === 'Escape') { e.preventDefault(); return; }
            const lista = [...e.currentTarget.querySelectorAll<HTMLElement>('[role^="menuitem"]')].filter((x) => x.getClientRects().length > 0);
            const dir = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
            const ahora = lista.indexOf(document.activeElement as HTMLElement);
            const n = e.key === 'Home' ? 0 : e.key === 'End' ? lista.length - 1 : dir ? (ahora + dir + lista.length) % lista.length : -1;
            if (n >= 0 && lista.length > 0) { e.preventDefault(); e.stopPropagation(); lista[n]?.focus(); }
          }}>
            <MenuList etiqueta={t('pie.cuenta.etiqueta')}>{menu}</MenuList>
          </div>
        </Popover>
      )}
    </div>
  );
}

/** El pie completo. `extra` va arriba de todo (p. ej. «Puesta en marcha» del dashboard). */
export default function PieSidebar({ organizacion, avisos, acceso, tarjeta, extra, alNavegar }: {
  organizacion: OrganizacionPie;
  /** `null` = el rol no tiene pantalla de avisos: la fila no existe. */
  avisos: AvisosPie | null;
  /** Acceso cruzado (admin ↔ dashboard o «Administración»): solo se pasa si el rol lo permite. */
  acceso?: AccesoPie | null;
  tarjeta: ReactNode;
  extra?: ReactNode;
  alNavegar?: () => void;
}) {
  const tr = useT('shell', shellEs);
  const etiqueta = avisos ? etiquetaAvisos(avisos, tr) : '';
  const p = avisos?.pendientes;
  return (
    <div className="rv-pie rv-ps" data-pie="sidebar">
      {extra}
      <Organizacion org={organizacion} alNavegar={alNavegar} />
      {avisos && <Link href={avisos.href} className="rv-item rv-ps-avisos" aria-label={etiqueta} title={etiqueta} data-tour="nav-notificaciones" onClick={alNavegar}>
        <Bell className="rv-item__ico" width={16} height={16} strokeWidth={TRAZO_ICONO} aria-hidden />
        <span className="rv-item__txt">{tr.t('pie.avisos.titulo')}</span>
        {p === null && <span className="rv-ps-sindato" data-estado="sin-dato" aria-hidden>?</span>}
        {typeof p === 'number' && p > 0 && (
          <span className="rv-contador" data-urgente={avisos.urgente ? 'si' : 'no'} aria-hidden>{p > TOPE_VISIBLE ? `${TOPE_VISIBLE}+` : p}</span>
        )}
      </Link>}
      {acceso && (
        <Link href={acceso.href} className="rv-ps-acceso" aria-label={acceso.texto} title={acceso.texto} onClick={alNavegar}>
          <acceso.Icono width={16} height={16} strokeWidth={TRAZO_ICONO} aria-hidden />
          <span className="rv-ps-acceso__txt">{acceso.texto}</span>
        </Link>
      )}
      <div className="rv-ps-toggles">
        <ConmutadorTema />
        <ConmutadorIdioma />
      </div>
      <CicloTema />
      {tarjeta}
    </div>
  );
}
