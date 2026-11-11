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
import { EsqueletoTablaMaestra } from '../../ui-v2/esqueletos';
import { FilaConversacion } from './hilo';

export const dynamic = 'force-dynamic';

interface SearchParams { q?: string; p?: string }

const TITULO_MENSAJES = 'Mensajes por conversación';

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
      <PantallaConversaciones filtros={<CajaBusqueda q={q} />}>
        <Tarjeta titulo={`"${q}" — ${resultado.total} conversación${resultado.total === 1 ? '' : 'es'}, página ${resultado.pagina} de ${resultado.paginas}`}>
          {resultado.filas.length === 0 ? (
            <EstadoVacio titulo="Sin coincidencias" icono={Search} contenido>
              Ningún teléfono contiene &quot;{q}&quot;.
            </EstadoVacio>
          ) : (
            <ListaConversaciones conversaciones={resultado.filas} />
          )}
          <PaginadorConversaciones q={q} pagina={resultado.pagina} paginas={resultado.paginas} />
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
  const recortado = total !== null && total > conversaciones.length;

  return (
    <PantallaConversaciones
      filtros={<CajaBusqueda q="" />}
      etiquetaCifras="Conversaciones de WhatsApp"
      cifras={[
        {
          etiqueta: 'Conversaciones activas', valor: total, formato: 'entero',
          estado: total === null ? 'vacio' : 'ok',
          mensaje: 'No se pudo contar — esto no significa que no haya ninguna.',
        },
        { etiqueta: `Mensajes en las ${conversaciones.length} que se listan`, valor: totalMensajes, formato: 'entero' },
      ]}
    >
      {/* Mensajes por conversación (c.turns.length) es un conteo real que ya se calcula para el resumen de arriba, así que un
          ranking con HBars entre conversaciones es genuino — no una serie inventada. Solo con 2+ conversaciones: con 1 sola, un
          "ranking" de una barra no compara nada. */}
      {conversaciones.length > 1 && (
        <Tarjeta titulo={TITULO_MENSAJES}>
          <BarList etiqueta={TITULO_MENSAJES} items={conversaciones.map((c, i) => ({ clave: `${i}-${c.telefono}`, etiqueta: destinatarioEnmascarado(c.telefono), valor: c.turns.length }))} formato={(v) => numero(v)} />
        </Tarjeta>
      )}

      <Tarjeta titulo={recortado ? `Las ${TOPE_CONVERSACIONES} más recientes de ${total}` : 'Todas las conversaciones'}>
        {conversaciones.length === 0 ? (
          <EstadoVacio titulo="Sin conversaciones activas" icono={MessageCircle} contenido>
            Sin conversaciones activas.
          </EstadoVacio>
        ) : (
          <ListaConversaciones conversaciones={conversaciones} />
        )}
      </Tarjeta>

      {/* Lo que NO se sabe va en su caja punteada, DENTRO de una tarjeta y a la izquierda (Rovaq «Qué no se sabe»), no como un párrafo centrado suelto. */}
      <Tarjeta titulo="Qué no se sabe" className="adm-nosabe">
        <p>
          Colas (activas/necesitan humano/escaladas/resueltas), búsqueda full-text, handoff a un humano — el bot de Likida es una máquina de estados determinística (foto→OCR→confirmar→liquidar), no un agente conversacional abierto que se pueda &quot;atorar&quot; y necesite ese patrón. Antes de construirlo hay que decidir si de verdad aplica.
        </p>
        <p>
          Volumen por canal, heatmap hora×día, histograma de mensajes por conversación — con 1 tenant y pocos días de historia no dicen nada real todavía.
        </p>
      </Tarjeta>
    </PantallaConversaciones>
  );
}

function PantallaConversaciones({ filtros, cifras, etiquetaCifras, children }: { filtros: ReactNode; cifras?: PropsCifra[]; etiquetaCifras?: string; children: ReactNode }) {
  return <EsqueletoTablaMaestra titulo="Conversaciones de WhatsApp" filtros={filtros} cifras={cifras} etiquetaCifras={etiquetaCifras}>{children}</EsqueletoTablaMaestra>;
}

/**
 * Formulario GET — sin JS, sin action de servidor. `?q=` se resuelve en
 * `ConversacionesPage` con `buscarConversaciones` (ADM-1). El detalle de
 * cada fila enlaza a `/admin/conversaciones/[tenant]/[telefono]`.
 */
function CajaBusqueda({ q }: { q: string }) {
  return (
    <BarraFiltros accion="/admin/conversaciones" enLinea buscar etiqueta="Buscar conversaciones" limpiarHref="/admin/conversaciones" nActivos={q ? 1 : 0}>
      <FiltroBusqueda nombre="q" valor={q} placeholder="Buscar por teléfono…" etiqueta="Buscar por teléfono" maxLength={40} />
    </BarraFiltros>
  );
}

/** La lista de conversaciones — cada fila enlaza al detalle cuando se conoce el tenant (siempre, salvo la fila rara sin `tenant_id`). */
function ListaConversaciones({ conversaciones }: { conversaciones: ConversacionActiva[] }) {
  return (
    <div className="space-y-1.5">
      {conversaciones.map((c) => <FilaConversacion key={`${c.tenantId ?? 'sin-flota'}-${c.telefono}`} c={c} completo textoEnlace="Abrir en su propia página →" />)}
    </div>
  );
}

/** Paginador de la búsqueda por teléfono — enlaces GET simples, `?q=&p=`. */
function PaginadorConversaciones({ q, pagina, paginas }: { q: string; pagina: number; paginas: number }) {
  if (paginas <= 1) return null;
  const href = (p: number) => `/admin/conversaciones?q=${encodeURIComponent(q)}&p=${p}`;
  return (
    <div className="mt-3 flex items-center justify-between text-xs text-muted">
      <span>Página {pagina} de {paginas}</span>
      <div className="flex gap-2">
        {pagina > 1 && <BotonEnlace href={href(pagina - 1)} variante="secondary" tamano="sm">Anterior</BotonEnlace>}
        {pagina < paginas && <BotonEnlace href={href(pagina + 1)} variante="secondary" tamano="sm">Siguiente</BotonEnlace>}
      </div>
    </div>
  );
}

export const metadata: Metadata = { title: 'Conversaciones' };
