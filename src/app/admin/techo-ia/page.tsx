import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Aviso, Boton, CampoTexto, EstadoError, MarcoPagina, StatusChip, TablaBase, Tarjeta, type ColumnaBase, type TonoEstado } from '../../ui-v2/componentes';
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

export default async function TechoIaPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
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
  if (datos === null) return <PantallaTecho><EstadoError>{t('techo_ia.no_se_pudo_leer')}</EstadoError></PantallaTecho>;

  const columnas: ColumnaBase<FilaTechoIa>[] = [
    { id: 'flota', titulo: t('techo_ia.flota'), principal: true, celda: (f) => f.nombre },
    { id: 'techo', titulo: t('techo_ia.techo_que_aplica'), alinear: 'der', celda: (f) => <span className="tabular">{usd(f.topeUsd)}</span> },
    { id: 'origen', titulo: t('techo_ia.origen'), celda: (f) => <StatusChip tono={ORIGEN[f.origen].tono}>{ORIGEN[f.origen].rotulo}</StatusChip> },
    {
      id: 'hoy', titulo: t('techo_ia.hoy'), alinear: 'der',
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
      id: 'declarar', titulo: t('techo_ia.declarar_techo'),
      celda: (f) => (
        <form action={guardarTechoIa} className="rv-techo-forma">
          <input type="hidden" name="tenantId" value={f.tenantId} />
          <CampoTexto
            id={`techo-${f.tenantId}`} name="techoUsd" inputMode="decimal" autoComplete="off"
            etiqueta={`Techo diario en dólares para ${f.nombre}`} etiquetaOculta
            defaultValue={f.declaradoUsd === null ? '' : String(f.declaradoUsd)}
            placeholder="sin declarar"
            claseControl="tabular"
            title={f.declaradoUsd !== null ? t('techo_ia.dejalo_vacio_y_guarda') : undefined}
          />
          <Boton type="submit" variante="secondary" tamano="sm">{f.declaradoUsd === null ? 'Fijar' : 'Cambiar'}</Boton>
        </form>
      ),
    },
  ];

  return (
    <PantallaTecho>
      {sp.ok && MENSAJE_OK[sp.ok] && <Aviso tono="ok">{MENSAJE_OK[sp.ok]}</Aviso>}
      {sp.error && MENSAJE_ERROR[sp.error] && <Aviso tono="error">{MENSAJE_ERROR[sp.error]}</Aviso>}

      <Tarjeta titulo={t('techo_ia.como_se_decide_el')}>
        <p className="rv-techo-nota">
          1) el que declares aquí; 2) si no hay, el que le toca por el tamaño de su plan; 3) si tampoco, el piso global de{' '}
          <span className="tabular">{usd(datos.pisoUsd)}</span> al día. Pasado el techo, la IA de esa flota se frena hasta el día siguiente
          (el camino del chofer conserva una reserva). Rango declarable: {usd(TECHO_IA_MIN_USD)} a {usd(TECHO_IA_MAX_USD)} por día;
          para apagar la IA de una flota usa el interruptor, no un techo de cero.
        </p>
        {datos.gastoIlegible && (
          <Aviso tono="warn">{t('techo_ia.el_gasto_de_hoy')}</Aviso>
        )}
        {datos.truncado && (
          <p className="rv-techo-nota">{t('techo_ia.hay_mas_flotas_de')}</p>
        )}
      </Tarjeta>

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
      </Tarjeta>
    </PantallaTecho>
  );
}

function PantallaTecho({ children }: { children: ReactNode }) {
  return <MarcoPagina titulo="Techo diario de IA — por flota">{children}</MarcoPagina>;
}

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('admin_dinero');
  return { title: t('techo_ia.techo_de_ia') };
}
