import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { destinatarioEnmascarado } from '@/lib/meta/client';
import { requireSuperadmin } from '@/lib/auth/guard';
import { numero } from '@/lib/formato';
import {
  getConversacionesActivas, contarConversacionesActivas, buscarConversaciones, TOPE_CONVERSACIONES,
  type ConversacionActiva,
} from '@/lib/admin/negocio';
import { MessageCircle, Search } from 'lucide-react';
import { BarraFiltros, BotonEnlace, EstadoVacio, FiltroBusqueda, Tarjeta } from '../../ui-v2/componentes';
import { BarList, type PropsCifra } from '../../ui-v2/graficas';
import { observadas } from '../sello-observado';
import { uniformes } from '../cifras-uniformes';
import { EsqueletoTablaMaestra } from '../../ui-v2/esqueletos';
import { FilaConversacion, type TextosFilaConversacion } from './hilo';
import type { TrDe } from '@/lib/i18n/tr_tipos';
import { getT } from '@/lib/i18n/servidor';
import '../resumen.css';
import './conversaciones.css';
import '../compacto-lote-a.css';

export const dynamic = 'force-dynamic';

interface SearchParams { q?: string; p?: string }

type Tx = TrDe<'admin_agentes'>;

/**
 * Conversaciones de WhatsApp — versión dedicada y de ancho completo de la
 * sección de Inicio, mismos datos reales de `getConversacionesActivas()`
 * (telefono, tenantNombre, turns, actualizadaEn). Diferencia con Inicio:
 * aquí se enseñan TODOS los turns de cada conversación (Inicio recorta a
 * los últimos 6 por espacio) y hay dos cifras de cabecera — ambas sumas
 * reales sobre esos mismos datos, no una fuente nueva.
 *
 * Marco de página único (`MarcoPagina`); cada conversación es un desplegable
 * del sistema (`FilaConversacion`, ver ./hilo.tsx).
 */
export default async function ConversacionesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  // A37-S05-01/S06-01: puerta propia; el layout puede no ejecutarse en una petición RSC parcial.
  await requireSuperadmin();
  const { t: ts } = await getT('admin_sistema');
  const { t } = await getT('admin_agentes');
  const textos: TextosFilaConversacion = { nMensajes: t('conversaciones_pagina.n_mensajes'), sinMensajes: t('conversaciones_pagina.sin_mensajes') };
  const sp = await searchParams;
  // ADM-1: sin `?q=` se conserva la vista de siempre (las 20 más recientes,
  // con las tarjetas y el ranking). CON `?q=` se cambia a `buscarConversaciones`
  // — búsqueda por teléfono con paginación real (`count exact`), porque las 20
  // más recientes rotan en minutos con cientos de choferes y no sirven para
  // encontrar UN teléfono concreto.
  const q = (sp.q ?? '').trim();
  const pagina = Math.max(1, Number.parseInt(sp.p ?? '1', 10) || 1);

  if (q) {
    const resultado = await buscarConversaciones({ q, pagina });
    return (
      <PantallaConversaciones titulo={t('conversaciones_pagina.titulo')} filtros={<CajaBusqueda q={q} t={t} />} apoyo={ts('conversaciones.apoyo')}>
        <Tarjeta titulo={resultado.total === 1
          ? t('conversaciones_pagina.busqueda_una', { q, pagina: resultado.pagina, paginas: resultado.paginas })
          : t('conversaciones_pagina.busqueda_varias', { q, total: resultado.total, pagina: resultado.pagina, paginas: resultado.paginas })}>
          {resultado.filas.length === 0 ? (
            <EstadoVacio titulo={t('conversaciones_pagina.sin_coincidencias')} icono={Search} contenido>
              {t('conversaciones_pagina.ningun_telefono', { q })}
            </EstadoVacio>
          ) : (
            <ListaConversaciones conversaciones={resultado.filas} t={t} textos={textos} />
          )}
          <PaginadorConversaciones q={q} pagina={resultado.pagina} paginas={resultado.paginas} t={t} />
        </Tarjeta>
      </PantallaConversaciones>
    );
  }

  // FE-9: `getConversacionesActivas` devuelve 20 — un TOPE. El KPI de arriba
  // lo pintaba como "Conversaciones activas: 20" y con 4,000 vivas seguía
  // diciendo 20. El total sale de un `count exact` aparte; `null` = no se
  // pudo contar, y entonces no se afirma ninguna cifra.
  const [conversaciones, total] = await Promise.all([
    getConversacionesActivas(), contarConversacionesActivas(),
  ]);
  const totalMensajes = conversaciones.reduce((s, c) => s + c.turns.length, 0);
  // Quién escribe: lectura directa de los turnos de las conversaciones listadas (role user = chofer, el resto = bot).
  const delChofer = conversaciones.reduce((s, c) => s + c.turns.filter((x) => x.role === 'user').length, 0);
  const recortado = total !== null && total > conversaciones.length;

  return (
    <PantallaConversaciones
      titulo={t('conversaciones_pagina.titulo')}
      filtros={<CajaBusqueda q="" t={t} />}
      apoyo={ts('conversaciones.apoyo')}
      etiquetaCifras={t('conversaciones_pagina.titulo')}
      cifras={observadas(uniformes([
        {
          etiqueta: t('conversaciones_pagina.kpi_activas'), valor: total, formato: 'entero',
          estado: total === null ? 'vacio' : 'ok',
          mensaje: t('conversaciones_pagina.kpi_activas_error'),
        },
        { etiqueta: ts('conversaciones.mensajes_listados'), valor: totalMensajes, formato: 'entero', nota: conversaciones.length > 0 ? ts('conversaciones.listadas_n', { n: numero(conversaciones.length) }) : undefined },
        totalMensajes === 0
          ? { etiqueta: t('conversaciones_pagina.kpi_quien'), valor: null, estado: 'vacio' as const, mensaje: t('conversaciones_pagina.sin_activas') }
          : {
            etiqueta: t('conversaciones_pagina.kpi_quien'), valor: (delChofer / totalMensajes) * 100, formato: 'porcentaje' as const, nota: t('conversaciones_pagina.kpi_quien_nota'),
            segmentos: [{ etiqueta: t('conversaciones_pagina.seg_choferes'), valor: delChofer }, { etiqueta: t('conversaciones_pagina.seg_bot'), valor: totalMensajes - delChofer }],
          },
      ]), t('conversaciones_pagina.observado'))}
    >
      {/* Mensajes por conversación (c.turns.length) es un conteo real que ya se calcula para el resumen de arriba, así que un
          ranking con HBars entre conversaciones es genuino — no una serie inventada. Solo con 2+ conversaciones: con 1 sola, un
          "ranking" de una barra no compara nada. */}
      {conversaciones.length > 1 && (
        <Tarjeta titulo={t('conversaciones_pagina.tit_mensajes')}>
          <BarList etiqueta={t('conversaciones_pagina.tit_mensajes')} items={conversaciones.map((c, i) => ({ clave: `${i}-${c.telefono}`, etiqueta: destinatarioEnmascarado(c.telefono), valor: c.turns.length }))} formato={(v) => numero(v)} />
        </Tarjeta>
      )}

      <Tarjeta titulo={recortado ? t('conversaciones_pagina.recorte', { tope: TOPE_CONVERSACIONES, total: total ?? 0 }) : t('conversaciones_pagina.todas')}>
        {conversaciones.length === 0 ? (
          <EstadoVacio titulo={t('conversaciones_pagina.sin_activas')} icono={MessageCircle} contenido>
            {ts('conversaciones.vacio_detalle')}
          </EstadoVacio>
        ) : (
          <ListaConversaciones conversaciones={conversaciones} t={t} textos={textos} />
        )}
      </Tarjeta>

      {/* Lo que NO se sabe va en su caja punteada, DENTRO de una tarjeta y a la izquierda (Rovaq «Qué no se sabe»), no como un párrafo centrado suelto. */}
      <Tarjeta titulo={ts('conversaciones.que_no_se_sabe')} className="adm-nosabe">
        <p>{t('conversaciones_pagina.no_se_sabe_1')}</p>
        <p>{t('conversaciones_pagina.no_se_sabe_2')}</p>
      </Tarjeta>
    </PantallaConversaciones>
  );
}

function PantallaConversaciones({ titulo, filtros, cifras, etiquetaCifras, apoyo, children }: { titulo: string; filtros: ReactNode; cifras?: PropsCifra[]; etiquetaCifras?: string; apoyo?: string; children: ReactNode }) {
  return <EsqueletoTablaMaestra titulo={titulo} apoyo={apoyo} filtros={filtros} cifras={cifras} etiquetaCifras={etiquetaCifras}>{children}</EsqueletoTablaMaestra>;
}

/**
 * Formulario GET — sin JS, sin action de servidor. `?q=` se resuelve en
 * `ConversacionesPage` con `buscarConversaciones` (ADM-1). El detalle de
 * cada fila enlaza a `/admin/conversaciones/[tenant]/[telefono]`.
 */
function CajaBusqueda({ q, t }: { q: string; t: Tx }) {
  return (
    <BarraFiltros accion="/admin/conversaciones" enLinea buscar etiqueta={t('conversaciones_pagina.buscar_etq')} limpiarHref="/admin/conversaciones" nActivos={q ? 1 : 0}>
      <FiltroBusqueda nombre="q" valor={q} placeholder={t('conversaciones_pagina.buscar_ph')} etiqueta={t('conversaciones_pagina.buscar_campo')} maxLength={40} />
    </BarraFiltros>
  );
}

/** La lista de conversaciones — cada fila enlaza al detalle cuando se conoce el tenant (siempre, salvo la fila rara sin `tenant_id`). */
function ListaConversaciones({ conversaciones, t, textos }: { conversaciones: ConversacionActiva[]; t: Tx; textos: TextosFilaConversacion }) {
  return (
    <div className="rv-conv-lista">
      {conversaciones.map((c) => <FilaConversacion key={`${c.tenantId ?? 'sin-flota'}-${c.telefono}`} c={c} completo textoEnlace={t('conversaciones_pagina.abrir')} textos={textos} />)}
    </div>
  );
}

/** Paginador de la búsqueda por teléfono — enlaces GET simples, `?q=&p=`. */
function PaginadorConversaciones({ q, pagina, paginas, t }: { q: string; pagina: number; paginas: number; t: Tx }) {
  if (paginas <= 1) return null;
  const href = (p: number) => `/admin/conversaciones?q=${encodeURIComponent(q)}&p=${p}`;
  return (
    <div className="rv-conv-pag">
      <span>{t('conversaciones_pagina.pagina', { pagina, paginas })}</span>
      <div className="rv-conv-pag__acciones">
        {pagina > 1 && <BotonEnlace href={href(pagina - 1)} variante="secondary" tamano="sm">{t('conversaciones_pagina.anterior')}</BotonEnlace>}
        {pagina < paginas && <BotonEnlace href={href(pagina + 1)} variante="secondary" tamano="sm">{t('conversaciones_pagina.siguiente')}</BotonEnlace>}
      </div>
    </div>
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('admin_agentes');
  return { title: t('conversaciones_pagina.metadata') };
}
