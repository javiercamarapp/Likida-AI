import type { Metadata } from 'next';
import { requireSuperadmin } from '@/lib/auth/guard';
import { ShieldAlert } from 'lucide-react';
import { EstadoError } from '../ui/kit';
import { Disclosure, EstadoVacio, MarcoPagina, StatusChip, TablaBase, Tarjeta, type ColumnaBase, type TonoEstado } from '../../ui-v2/componentes';
import { Cifra, TiraCifras } from '../../ui-v2/graficas';
import {
  getEventosSeguridad, resumenEventosSeguridad,
  type FilaSeguridad, type ResumenSeguridad,
} from '@/lib/seguridad/eventos';
import { coberturaEventosSeguridad, type CoberturaFuente } from '@/lib/seguridad/cobertura';
import { fechaHoraMx, numero } from '@/lib/formato';

export const dynamic = 'force-dynamic';

// ═══════════════════════════════════════════════════════════════════════════
// Trust & Safety — el registro consultable de lo que los emisores de seguridad atrapan.
//
// CT-SEG-11 (4-nov-2026): esta pantalla decía «los detectores están cableados — así que el
// silencio aquí es bueno de verdad». Era falso en la dirección peligrosa: no había registro
// de login fallido, de llaves de API inválidas, de rutas negadas ni de exportes de dinero, y
// varios tipos (correo entrante, rate limits, inyección de prompt) nunca tuvieron un emisor.
// Un panel vacío no prueba que no pasó nada; prueba que nadie escribió.
//
// Ahora la pantalla MIDE su propia cobertura: `FUENTES_SEGURIDAD` (lib/seguridad/cobertura.ts)
// declara fuente por fuente qué emite y qué no — atado al código por una prueba — y aquí se
// pinta con el conteo real de 30 días. Una fuente que emite y marca 0 es silencio real O una
// fuente rota, y el panel dice que no las distingue.
//
// Contratos de la casa: los conteos se miden EN la base (count exacto, nunca contando una
// rebanada); la lista declara «mostrando N de M» con M exacta; una lectura fallida se dice
// («no se pudo leer» ≠ «no hay eventos»); lo que NO se detecta se dice con esas palabras.
// ═══════════════════════════════════════════════════════════════════════════

const LIMITE_LISTA = 50;

const PILL_SEVERIDAD: Record<string, { tono: TonoEstado; etiqueta: string }> = {
  alta: { tono: 'bad', etiqueta: 'Alta' },
  media: { tono: 'warn', etiqueta: 'Media' },
  info: { tono: 'neutral', etiqueta: 'Info' },
};

const COLUMNAS_EVENTOS: ColumnaBase<FilaSeguridad>[] = [
  { id: 'cuando', titulo: 'Cuándo', celda: (e) => <span className="whitespace-nowrap">{fechaHoraMx(e.creadoEn)}</span> },
  {
    id: 'que', titulo: 'Qué y de dónde', principal: true,
    celda: (e) => (
      <>
        <span className="block font-medium">
          {e.tipo.replace(/_/g, ' ')}
          {/* 0681: una ráfaga de la misma señal es UNA fila con su conteo — el número es lo medido, no una estimación. */}
          {(e.repeticiones ?? 1) > 1 && (
            <span className="ml-1.5 cifra-mono text-xs text-muted" title="Veces que se vio la misma señal en su ventana">×{e.repeticiones}</span>
          )}
        </span>
        <span className="block text-xs text-muted">{e.origen}</span>
      </>
    ),
  },
  {
    id: 'severidad', titulo: 'Severidad',
    celda: (e) => {
      const pill = PILL_SEVERIDAD[e.severidad] ?? { tono: 'neutral' as TonoEstado, etiqueta: e.severidad };
      return <StatusChip tono={pill.tono}>{pill.etiqueta}</StatusChip>;
    },
  },
  {
    // El actor viene ya truncado a 120 y JAMÁS trae un secreto completo (contrato de registrarEventoSeguridad). Sin actor no se inventa.
    id: 'actor', titulo: 'Actor', celda: (e) => <span className="text-xs text-muted">{e.actor ?? '—'}</span>,
  },
  { id: 'flota', titulo: 'Flota', celda: (e) => <span className="cifra-mono text-xs text-muted">{e.tenantId ? e.tenantId.slice(0, 8) : 'sin flota'}</span> },
];

const COLUMNAS_COBERTURA: ColumnaBase<CoberturaFuente>[] = [
  { id: 'fuente', titulo: 'Fuente', principal: true, celda: (f) => f.titulo },
  { id: 'estado', titulo: 'Estado', celda: (f) => <StatusChip tono={f.emite ? 'ok' : 'warn'}>{f.emite ? 'Emite' : 'Pendiente'}</StatusChip> },
  {
    id: 'filas', titulo: 'Filas · 30 días',
    celda: (f) => {
      const medida = f.filas30d === null ? 'sin evento' : f.emite && f.filas30d === 0 ? '0 en 30 días' : numero(f.filas30d);
      return <span className={`tabular whitespace-nowrap ${f.emite && f.filas30d === 0 ? 'text-muted' : ''}`}>{medida}</span>;
    },
  },
  {
    id: 'detalle', titulo: 'Detalle',
    celda: (f) => (
      <>
        {/* Las rutas de código no son para el superadmin: quedan plegadas. A la vista, solo lo accionable en español llano. */}
        <span className="text-xs text-muted">{f.emite ? 'Registra eventos aquí.' : 'Todavía no escribe aquí.'}</span>
        <Disclosure titulo="Detalle técnico" variante="linea">
          <p className="m-0 break-words text-xs text-muted">{f.donde}</p>
        </Disclosure>
      </>
    ),
  },
];

export default async function TrustSafetyPage() {
  // A37-S05-01/S06-01: puerta propia; el layout puede no ejecutarse en una petición RSC parcial.
  await requireSuperadmin();
  // Las dos lecturas caen POR SEPARADO: que los conteos fallen no debe
  // esconder la lista, ni al revés — y cada fallo se dice con su alcance.
  const [eventos, resumen, cobertura] = await Promise.all([
    getEventosSeguridad(LIMITE_LISTA).catch((): FilaSeguridad[] | null => null),
    resumenEventosSeguridad().catch((): ResumenSeguridad | null => null),
    coberturaEventosSeguridad().catch((): CoberturaFuente[] | null => null),
  ]);

  return (
    <MarcoPagina titulo="Trust & Safety">
      {/* ── Los conteos, medidos en la base ── */}
      {resumen === null ? (
        <EstadoError mensaje="No se pudieron leer los conteos de eventos de seguridad — la base no contestó. Esto NO significa que haya cero eventos: significa que ahora mismo no se sabe." />
      ) : (
        <TiraCifras etiqueta="Últimos 30 días, por severidad">
          <Cifra etiqueta="Severidad alta · 30 días" valor={resumen.d30.alta} tono={resumen.d30.alta > 0 ? 'bad' : undefined} />
          <Cifra etiqueta="Severidad media · 30 días" valor={resumen.d30.media} tono={resumen.d30.media > 0 ? 'warn' : undefined} />
          <Cifra etiqueta="Informativos · 30 días" valor={resumen.d30.info} />
          <Cifra etiqueta="Total histórico" valor={resumen.total} />
        </TiraCifras>
      )}

      {/* ── La cobertura REAL, medida ── */}
      <Tarjeta titulo="Cobertura: qué fuentes escriben aquí y cuáles están pendientes">
        {cobertura === null ? (
          <p className="m-0 text-sm text-muted">
            No se pudo medir la cobertura — la base no contestó. Eso no significa que haya cobertura completa ni vacía: significa que ahora mismo no se sabe.
          </p>
        ) : (
          <>
            <p className="m-0 mb-3 text-xs text-muted">
              {cobertura.filter((f) => f.emite).length} de {cobertura.length} fuentes emiten. Las demás están pendientes: hoy no escriben nada aquí.
              Las filas son señales ya agrupadas (una ráfaga de la misma señal es una fila con su conteo), no intentos. Los exportes de dinero se anotan al
              autorizar la descarga, no al terminar. Una fuente que emite y marca «0 en 30 días» es silencio real o una
              fuente rota: no se distingue.
            </p>
            <TablaBase etiqueta="Cobertura por fuente de seguridad" columnas={COLUMNAS_COBERTURA} filas={cobertura} idFila={(f) => f.id} altoMaximo={false} />
          </>
        )}
      </Tarjeta>

      {/* ── La lista ── */}
      <Tarjeta titulo="Eventos registrados">
        {eventos === null ? (
          <p className="m-0 text-sm text-muted">
            No se pudieron leer los eventos — que no es lo mismo que «no hay eventos».
          </p>
        ) : eventos.length === 0 ? (
          <EstadoVacio titulo="Sin eventos" icono={ShieldAlert} contenido>
            Ningún evento registrado. Eso NO prueba que no haya pasado nada: solo cubre lo que las
            fuentes de la sección de cobertura emiten; las pendientes no escriben nada. Una fuente que emite y marca
            cero puede ser silencio real o una fuente rota; este panel no las distingue.
          </EstadoVacio>
        ) : (
          <>
            <TablaBase etiqueta="Eventos de seguridad registrados" columnas={COLUMNAS_EVENTOS} filas={eventos} idFila={(e) => String(e.id)} altoMaximo={false} />
            <p className="m-0 mt-3 text-xs text-muted">
              {resumen === null
                ? `Mostrando los últimos ${numero(eventos.length)} — el total histórico no se pudo contar ahora mismo.`
                : `Mostrando ${numero(eventos.length)} de ${numero(resumen.total)} eventos históricos, del más reciente al más viejo.`}
            </p>
          </>
        )}
      </Tarjeta>

      {/* ── Lo que este panel NO afirma — la lista de pendientes sale de la MISMA cobertura medida, no de texto fijo ── */}
      <Tarjeta titulo="Qué se registra y qué está pendiente">
        <p className="m-0 text-xs text-muted">
          «Emite» significa solo que existe código que escribe esa señal en <code className="font-mono">evento_seguridad</code>
          (una prueba lo ata al árbol de código); no significa que la detección sea completa ni que haya sido probada
          contra un ataque real. Este panel no es un sistema de detección de intrusiones y no afirma seguridad que no se midió.
        </p>
        {cobertura === null ? (
          <p className="m-0 mt-2 text-xs text-muted">
            Sin la medición de cobertura no se puede listar qué está pendiente ahora mismo.
          </p>
        ) : cobertura.filter((f) => !f.emite).length === 0 ? (
          <p className="m-0 mt-2 text-xs text-muted">
            Todas las fuentes declaradas emiten. Eso no cubre lo que nadie ha declarado: lo no listado arriba no está medido.
          </p>
        ) : (
          <>
            <p className="m-0 mt-2 text-xs text-muted">Pendiente, hoy no se registra:</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-muted">
              {cobertura.filter((f) => !f.emite).map((f) => <li key={f.id}>{f.titulo}</li>)}
            </ul>
          </>
        )}
        <p className="m-0 mt-2 text-xs text-muted">
          Tampoco hay un pipeline dedicado de detección de jailbreaks ni de fugas de datos personales. La mitigación
          anti-inyección del Agente de Cuadre vive en su prompt (<code className="font-mono">src/lib/agents/prompts.ts</code>) y
          en la guardia determinista de cifras (<code className="font-mono">src/lib/likida/cuadre/guardia.ts</code>): eso es
          mitigación, no detección. Los avisos por correo de severidad alta se envían solo si está encendida la variable{' '}
          <code className="font-mono">SEGURIDAD_AVISOS</code>; viene apagada por omisión y este panel no mide si lo está en producción.
        </p>
      </Tarjeta>
    </MarcoPagina>
  );
}

export const metadata: Metadata = { title: 'Trust & Safety' };
