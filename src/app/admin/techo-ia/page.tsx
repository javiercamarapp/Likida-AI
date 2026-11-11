import type { Metadata } from 'next';
import type { ComponentProps, ReactNode } from 'react';
import { Info } from 'lucide-react';
import { Aviso, Boton, BotonEnlace, CampoTexto, EstadoError, StatusChip, TablaBase, Tarjeta, type ColumnaBase, type TonoEstado } from '../../ui-v2/componentes';
import { EsqueletoTablaMaestra } from '@/app/ui-v2/esqueletos';
import { CajonVistaRapida } from '../../ui-v2/esqueletos/cajon-vista-rapida';
import { uniformes } from '../cifras-uniformes';
import { observadas } from '../sello-observado';
import type { PropsCifra } from '@/app/ui-v2/graficas';
import { requireSuperadmin } from '@/lib/auth/guard';
import { getTechosIa, TECHO_IA_MAX_USD, TECHO_IA_MIN_USD, type FilaTechoIa, type TechosIa } from '@/lib/admin/techo_ia';
import { usd } from '@/lib/utils';
import { guardarTechoIa } from './acciones';
import './techo-ia.css';

import { getT } from '@/lib/i18n/servidor';
export const dynamic = 'force-dynamic';

// ═══════════════════════════════════════════════════════════════════════════
// /admin/techo-ia — EL TECHO DIARIO DE IA DE CADA FLOTA (Ola 9). La puerta es la del layout de /admin
// (`requireSuperadmin`) y otra vez la de la acción. Cada fila dice DE DÓNDE sale el techo que de verdad
// se aplica (declarado por el superadmin, derivado del plan o el piso global) y cuánto lleva hoy.
// ═══════════════════════════════════════════════════════════════════════════

const TITULO = 'Techo diario de IA — por flota';

const ORIGEN: Record<FilaTechoIa['origen'], { tono: TonoEstado; rotulo: string }> = {
  tenant: { tono: 'ok', rotulo: 'Declarado' },
  plan: { tono: 'neutral', rotulo: 'Del plan' },
  piso: { tono: 'warn', rotulo: 'Piso global' },
  explicito: { tono: 'neutral', rotulo: 'Explícito' },
};

const MENSAJE_OK: Record<string, string> = {
  fijado: 'Techo guardado. Esta instancia lo aplica ya; las demás en menos de un minuto.',
  quitado: 'Declaración quitada: la flota vuelve al techo de su plan (o al piso).',
};

// A37-S08-07: códigos cerrados (como `ok`); el texto de `?error=` ya no se pinta tal cual.
const MENSAJE_ERROR: Record<string, string> = {
  formato: 'Escribe un monto en dólares, por ejemplo 25 o 25.50.',
  rango: `El techo diario va de ${TECHO_IA_MIN_USD.toFixed(2)} a ${TECHO_IA_MAX_USD} USD. Para apagar la IA de una flota usa el interruptor, no un techo de cero.`,
  flota: 'Flota inválida.',
  inexistente: 'Esa flota ya no existe.',
  guardar: 'No se pudo guardar el techo. Recarga e inténtalo de nuevo; si persiste, avisa a soporte.',
};

export default async function TechoIaPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; ver?: string; como?: string }> }) {
  const { t } = await getT('admin_dinero');
  // A37-S05-01/S06-01: puerta propia; el layout puede no ejecutarse en una petición RSC parcial.
  await requireSuperadmin();
  const sp = await searchParams;
  let datos: TechosIa | null = null;
  try {
    datos = await getTechosIa();
  } catch {
    datos = null;
  }
  if (datos === null) return <PantallaTecho apoyo={t('a1r4.techo_apoyo')}><EstadoError>{t('techo_ia.no_se_pudo_leer')}</EstadoError></PantallaTecho>;

  const columnas: ColumnaBase<FilaTechoIa>[] = [
    { id: 'flota', titulo: t('techo_ia.flota'), principal: true, celda: (f) => f.nombre },
    { id: 'techo', titulo: t('techo_ia.techo_que_aplica'), alinear: 'der', celda: (f) => <span className="tabular">{usd(f.topeUsd)}</span> },
    { id: 'origen', titulo: t('techo_ia.origen'), celda: (f) => <StatusChip tono={ORIGEN[f.origen].tono}>{ORIGEN[f.origen].rotulo}</StatusChip> },
    {
      id: 'hoy', titulo: t('techo_ia.hoy'),
      celda: (f) => f.usadoHoyUsd === null ? (
        <span className="rv-techo-tenue">sin medir</span>
      ) : (
        <span className="rv-techo-uso">
          <progress className="rv-techo-barra" value={Math.min(f.pctUsado ?? 0, 100)} max={100} data-alto={(f.pctUsado ?? 0) >= 80 || undefined} aria-hidden="true" />
          <span className="tabular">{usd(f.usadoHoyUsd)} · {f.pctUsado ?? 0}%</span>
        </span>
      ),
    },
    {
      // La edición vive en el cajón (Rovaq P5: la tabla muestra el uso; editar es una Vista rápida), no en un campo por fila.
      id: 'declarar', titulo: t('techo_ia.declarar_techo'), tituloOculto: true, alinear: 'der',
      celda: (f) => (
        <BotonEnlace href={`/admin/techo-ia?ver=${f.tenantId}`} variante="ghost" tamano="sm" aria-label={`${f.declaradoUsd === null ? 'Fijar' : 'Cambiar'} · ${f.nombre}`}>
          {f.declaradoUsd === null ? 'Fijar' : 'Cambiar'}
        </BotonEnlace>
      ),
    },
  ];

  const cercaDelTecho = datos.filas.filter((f) => (f.pctUsado ?? 0) >= 80).length;
  const cifras: PropsCifra[] = [
    { etiqueta: t('techo_ia.flotas'), valor: datos.filas.length, formato: 'entero' as const },
    { etiqueta: t('techo_ia.k_declarado'), valor: datos.filas.filter((f) => f.origen === 'tenant').length, formato: 'entero' as const },
    // Sin la lectura del gasto de hoy no se afirma cuántas van cerca del techo: «—», nunca 0.
    datos.gastoIlegible
      ? { etiqueta: t('techo_ia.k_cerca'), valor: null, estado: 'vacio' as const, mensaje: t('techo_ia.el_gasto_de_hoy') }
      : { etiqueta: t('techo_ia.k_cerca'), valor: cercaDelTecho, formato: 'entero' as const, tono: cercaDelTecho > 0 ? 'warn' as const : undefined },
    { etiqueta: t('techo_ia.k_piso'), valor: usd(datos.pisoUsd), nota: t('techo_ia.k_piso_nota') },
  ];

  const elegida = sp.ver ? datos.filas.find((f) => f.tenantId === sp.ver) : undefined;
  const sinMedir = 'sin medir';
  const cajon = elegida ? (
    <CajonVistaRapida
      titulo={elegida.nombre}
      subtitulo={t('techo_ia.declarar_techo')}
      hrefCerrar="/admin/techo-ia"
      cifras={[
        { etiqueta: t('techo_ia.techo_que_aplica'), valor: usd(elegida.topeUsd) },
        { etiqueta: t('techo_ia.origen'), valor: ORIGEN[elegida.origen].rotulo },
        { etiqueta: t('techo_ia.hoy'), valor: elegida.usadoHoyUsd === null ? sinMedir : usd(elegida.usadoHoyUsd) },
        { etiqueta: '%', valor: elegida.pctUsado === null ? '—' : `${elegida.pctUsado}%` },
      ]}
      pie={<Boton type="submit" form="forma-techo" variante="primary" tamano="sm">{elegida.declaradoUsd === null ? 'Fijar' : 'Cambiar'}</Boton>}
    >
      <form id="forma-techo" action={guardarTechoIa} className="rv-techo-forma rv-techo-forma--cajon">
        <input type="hidden" name="tenantId" value={elegida.tenantId} />
        <CampoTexto
          id={`techo-${elegida.tenantId}`} name="techoUsd" inputMode="decimal" autoComplete="off"
          etiqueta={`Techo diario en dólares para ${elegida.nombre}`}
          defaultValue={elegida.declaradoUsd === null ? '' : String(elegida.declaradoUsd)}
          placeholder="sin declarar"
          claseControl="tabular"
          ayuda={t('techo_ia.dejalo_vacio_y_guarda')}
        />
      </form>
    </CajonVistaRapida>
  ) : null;

  const cajonComo = !elegida && sp.como === '1' ? (
    <CajonVistaRapida
      titulo={t('techo_ia.como_enlace')}
      subtitulo={t('techo_ia.techo_que_aplica')}
      hrefCerrar="/admin/techo-ia"
      cifras={[
        { etiqueta: t('techo_ia.como_piso'), valor: usd(datos.pisoUsd) },
        { etiqueta: t('techo_ia.como_min'), valor: usd(TECHO_IA_MIN_USD) },
        { etiqueta: t('techo_ia.como_max'), valor: usd(TECHO_IA_MAX_USD) },
        { etiqueta: t('techo_ia.k_declarado'), valor: String(datos.filas.filter((f) => f.origen === 'tenant').length) },
      ]}
    >
      <ol className="rv-techo-como">
        <li>{t('techo_ia.como_paso1')}</li>
        <li>{t('techo_ia.como_paso2')}</li>
        <li>{t('techo_ia.como_paso3', { piso: usd(datos.pisoUsd) })}</li>
      </ol>
      <p className="rv-techo-nota">{t('techo_ia.como_freno')}</p>
      <p className="rv-techo-nota">{t('techo_ia.como_rango', { min: usd(TECHO_IA_MIN_USD), max: usd(TECHO_IA_MAX_USD) })}</p>
    </CajonVistaRapida>
  ) : null;

  return (
    <PantallaTecho
      apoyo={t('a1r4.techo_apoyo')}
      etiquetaCifras={t('techo_ia.flotas')}
      cifras={observadas(uniformes(cifras), t('a1r4.observado'))}
      vistaRapida={cajon ?? cajonComo}
      avisos={(
        <>
          <Aviso tono="info">{t('techo_ia.aviso_admin')}</Aviso>
          {sp.ok && MENSAJE_OK[sp.ok] && <Aviso tono="ok">{MENSAJE_OK[sp.ok]}</Aviso>}
          {sp.error && MENSAJE_ERROR[sp.error] && <Aviso tono="error">{MENSAJE_ERROR[sp.error]}</Aviso>}
        </>
      )}
    >
      {datos.gastoIlegible && (
        <Aviso tono="warn">{t('techo_ia.el_gasto_de_hoy')}</Aviso>
      )}
      {datos.truncado && (
        <p className="rv-techo-nota">{t('techo_ia.hay_mas_flotas_de')}</p>
      )}

      <Tarjeta titulo={t('techo_ia.flotas')}>
        <TablaBase
          etiqueta={t('techo_ia.techo_de_gasto_de')}
          columnas={columnas}
          filas={datos.filas}
          idFila={(f) => f.tenantId}
          altoMaximo={false}
          tarjetaMovil
          vacio={{ titulo: t('techo_ia.sin_flotas'), texto: t('techo_ia.todavia_no_hay_flotas') }}
        />
        {/* Rovaq P5: «ⓘ Cómo se calcula…» bajo la tabla; abre un cajón, no una tarjeta de párrafo a todo el ancho. */}
        <BotonEnlace href="/admin/techo-ia?como=1" variante="ghost" tamano="sm" icono={<Info width={14} height={14} strokeWidth={1.75} aria-hidden="true" />}>
          {t('techo_ia.como_enlace')}
        </BotonEnlace>
      </Tarjeta>
    </PantallaTecho>
  );
}

function PantallaTecho({ children, ...resto }: { children: ReactNode } & Omit<ComponentProps<typeof EsqueletoTablaMaestra>, 'titulo' | 'children'>) {
  return <EsqueletoTablaMaestra titulo={TITULO} {...resto}>{children}</EsqueletoTablaMaestra>;
}

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('admin_dinero');
  return { title: t('techo_ia.techo_de_ia') };
}
