import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Aviso, Boton, MarcoPagina, StatusChip, TablaBase, Tarjeta, type ColumnaBase, type TonoEstado } from '../../ui-v2/componentes';
import { requireSuperadmin } from '@/lib/auth/guard';
import { getTechosIa, TECHO_IA_MAX_USD, TECHO_IA_MIN_USD, type FilaTechoIa, type TechosIa } from '@/lib/admin/techo_ia';
import { usd } from '@/lib/utils';
import { EstadoError } from '../ui/kit';
import { guardarTechoIa } from './acciones';

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
  // A37-S05-01/S06-01: puerta propia; el layout puede no ejecutarse en una petición RSC parcial.
  await requireSuperadmin();
  const sp = await searchParams;
  let datos: TechosIa | null = null;
  try {
    datos = await getTechosIa();
  } catch {
    datos = null;
  }
  if (datos === null) return <PantallaTecho><EstadoError mensaje="No se pudo leer la lista de flotas ni sus techos — la base no respondió. Esto NO significa que no haya techos: la IA sigue frenada por el techo que cada flota ya tiene." /></PantallaTecho>;

  const columnas: ColumnaBase<FilaTechoIa>[] = [
    { id: 'flota', titulo: 'Flota', principal: true, celda: (f) => f.nombre },
    { id: 'techo', titulo: 'Techo que aplica', alinear: 'der', celda: (f) => <span className="tabular">{usd(f.topeUsd)}</span> },
    { id: 'origen', titulo: 'Origen', celda: (f) => <StatusChip tono={ORIGEN[f.origen].tono}>{ORIGEN[f.origen].rotulo}</StatusChip> },
    {
      id: 'hoy', titulo: 'Hoy', alinear: 'der',
      celda: (f) => f.usadoHoyUsd === null ? (
        <span className="text-muted">sin medir</span>
      ) : (
        <span className="inline-flex items-center gap-2">
          <span className="inline-block h-1 w-16 overflow-hidden rounded-full bg-[var(--line2)]" aria-hidden="true">
            <span className={`block h-full rounded-full ${(f.pctUsado ?? 0) >= 80 ? 'bg-[var(--bad)]' : 'bg-[var(--marca)]'}`} style={{ width: `${f.pctUsado ?? 0}%` }} />
          </span>
          <span className="tabular">{usd(f.usadoHoyUsd)} · {f.pctUsado ?? 0}%</span>
        </span>
      ),
    },
    {
      id: 'declarar', titulo: 'Declarar techo',
      celda: (f) => (
        <form action={guardarTechoIa} className="flex items-center gap-1.5">
          <input type="hidden" name="tenantId" value={f.tenantId} />
          <label className="sr-only" htmlFor={`techo-${f.tenantId}`}>Techo diario en dólares para {f.nombre}</label>
          <input
            id={`techo-${f.tenantId}`} name="techoUsd" inputMode="decimal" autoComplete="off"
            defaultValue={f.declaradoUsd === null ? '' : String(f.declaradoUsd)}
            placeholder="sin declarar"
            className="rv-ctl tabular w-28"
            title={f.declaradoUsd !== null ? 'Déjalo vacío y guarda para quitar la declaración.' : undefined}
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

      <Tarjeta titulo="Cómo se decide el techo de una flota">
        <p className="m-0 text-[13px] text-muted">
          1) el que declares aquí; 2) si no hay, el que le toca por el tamaño de su plan; 3) si tampoco, el piso global de{' '}
          <span className="tabular">{usd(datos.pisoUsd)}</span> al día. Pasado el techo, la IA de esa flota se frena hasta el día siguiente
          (el camino del chofer conserva una reserva). Rango declarable: {usd(TECHO_IA_MIN_USD)} a {usd(TECHO_IA_MAX_USD)} por día;
          para apagar la IA de una flota usa el interruptor, no un techo de cero.
        </p>
        {datos.gastoIlegible && (
          <Aviso tono="warn">El gasto de hoy no se pudo leer ahora mismo: la columna «Hoy» queda en blanco, que NO significa cero.</Aviso>
        )}
        {datos.truncado && (
          <p className="m-0 text-[13px] text-muted">Hay más flotas de las que caben en esta pantalla; se muestran las primeras por nombre.</p>
        )}
      </Tarjeta>

      <Tarjeta titulo="Flotas">
        <TablaBase
          etiqueta="Techo de gasto de IA por flota"
          columnas={columnas}
          filas={datos.filas}
          idFila={(f) => f.tenantId}
          altoMaximo={false}
          tarjetaMovil
          vacio={{ titulo: 'Sin flotas', texto: 'Todavía no hay flotas dadas de alta.' }}
        />
      </Tarjeta>
    </PantallaTecho>
  );
}

function PantallaTecho({ children }: { children: ReactNode }) {
  return <MarcoPagina titulo="Techo diario de IA — por flota">{children}</MarcoPagina>;
}

export const metadata: Metadata = { title: 'Techo de IA' };
