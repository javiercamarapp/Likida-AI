import Link from 'next/link';
import { MapPinned } from 'lucide-react';
import { BarraPagina } from '../../../resumen-visual';
import { numero } from '@/lib/formato';
import { PLANTILLA_CSV_SITIOS } from '@/lib/likida/conductor/sitios';
import type { SitioFila } from '@/lib/likida/conductor/repo_validacion';
import { FormaImportar, FormaSitio, SITIO_VACIO, type AccionSitio, type SitioEditable } from './formas';

// SOLO tipos: la vista no debe arrastrar al bundle el acceso a datos.

const TIPO_TEXTO: Record<string, string> = { cliente: 'Cliente', planta: 'Planta', anden: 'Andén', patio: 'Patio', punto_interes: 'Punto de interés' };

export interface PropsVistaSitios {
  sufijo: string;
  sitios: SitioFila[] | null;
  hayMas: boolean;
  clientes: Array<{ id: string; nombre: string }>;
  puedeEditar: boolean;
  editando: SitioFila | null;
  busqueda: string;
  accionGuardar: AccionSitio;
  accionImportar: AccionSitio;
  /** Archivar/reactivar: un `<form action>` simple por fila. */
  accionEstado: (fd: FormData) => Promise<void>;
}

const aEditable = (s: SitioFila): SitioEditable => ({
  id: s.id, nombre: s.nombre, tipo: s.tipo, codigo: s.codigo ?? '', direccion: s.direccion ?? '', lat: String(s.lat), lng: String(s.lng),
  radio_m: String(s.radioM), cliente_id: s.clienteId ?? '', padre_id: s.padreId ?? '',
});

export function VistaSitios(p: PropsVistaSitios) {
  const padres = (p.sitios ?? []).filter((s) => s.activa).map((s) => ({ id: s.id, nombre: s.nombre }));
  return (
    <main className="h-full">
      <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
        <BarraPagina icono={<MapPinned width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />} titulo="Catálogo de sitios" />
        <div className="px-5 py-5 flex-1 space-y-4">
          <p className="text-[12.5px] max-w-[80ch]" style={{ color: 'var(--muted)' }}>
            Los clientes, plantas y andenes con su centro y su radio. El agente compara cada «ya llegué» contra el sitio del viaje
            (pin de WhatsApp o GPS). <strong>Ninguna coordenada se calcula ni se inventa</strong>: la capturas tú o viene en tu archivo.
            Un viaje sin sitio asignado queda «sin dato», nunca «no coincide».{' '}
            <Link href={`/dashboard/agentes/conductores${p.sufijo}`} className="underline">Volver al tablero</Link>
          </p>

          <section className="card p-4 space-y-3" aria-label="Sitios registrados">
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="font-display text-[15px] font-semibold">Sitios registrados</h2>
              <form method="get" className="ml-auto flex items-center gap-2">
                {p.sufijo.startsWith('?') && [...new URLSearchParams(p.sufijo.slice(1))].map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
                <input type="search" name="q" defaultValue={p.busqueda} placeholder="Buscar por nombre o código" className="hairline rounded-lg px-2.5 h-8 text-[12.5px]" aria-label="Buscar sitios" />
                <button type="submit" className="h-8 px-3 rounded-lg text-[12.5px] hairline">Buscar</button>
              </form>
            </div>
            {p.sitios === null ? (
              <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>No se pudo leer el catálogo ahora mismo.</p>
            ) : p.sitios.length === 0 ? (
              <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>
                {p.busqueda ? 'Ningún sitio coincide con esa búsqueda.' : 'Todavía no hay sitios. Crea uno abajo o importa tu archivo: hasta entonces las llegadas se quedan «sin dato».'}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="text-left etiqueta-mono text-[10px] uppercase" style={{ color: 'var(--faint)' }}>
                      <th className="py-1.5 pr-3">Nombre</th><th className="pr-3">Tipo</th><th className="pr-3">Código</th>
                      <th className="pr-3">Centro (lat, lng)</th><th className="pr-3 text-right">Radio</th><th className="pr-3">Cliente</th><th className="pr-3">Origen del dato</th><th />
                    </tr>
                  </thead>
                  <tbody>
                    {p.sitios.map((s) => (
                      <tr key={s.id} className="border-t" style={{ borderColor: 'var(--line2)', opacity: s.activa ? 1 : 0.55 }}>
                        <td className="py-1.5 pr-3 font-medium">{s.nombre}{!s.activa && <span className="ml-1.5 text-[10.5px]" style={{ color: 'var(--faint)' }}>(archivado)</span>}</td>
                        <td className="pr-3">{TIPO_TEXTO[s.tipo] ?? s.tipo}</td>
                        <td className="pr-3 cifra-mono">{s.codigo ?? '—'}</td>
                        <td className="pr-3 cifra-mono">{s.lat.toFixed(5)}, {s.lng.toFixed(5)}</td>
                        <td className="pr-3 text-right cifra-mono">{numero(s.radioM)} m</td>
                        <td className="pr-3">{s.clienteNombre ?? '—'}</td>
                        <td className="pr-3">{s.fuente === 'csv' ? 'importado de CSV' : 'captura manual'}</td>
                        <td className="whitespace-nowrap">
                          {p.puedeEditar && (
                            <span className="flex items-center gap-3">
                              <Link href={`/dashboard/agentes/conductores/sitios?editar=${s.id}${p.sufijo.startsWith('?') ? `&${p.sufijo.slice(1)}` : ''}`} className="underline" style={{ color: 'var(--muted)' }}>Editar</Link>
                              <form action={p.accionEstado}>
                                <input type="hidden" name="id" value={s.id} />
                                <input type="hidden" name="activa" value={s.activa ? 'no' : 'si'} />
                                <button type="submit" className="underline" style={{ color: 'var(--muted)' }}>{s.activa ? 'Archivar' : 'Reactivar'}</button>
                              </form>
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {p.hayMas && <p className="text-[11px]" style={{ color: 'var(--warn)' }}>Hay más sitios de los que se listan: afina la búsqueda.</p>}
          </section>

          {p.puedeEditar ? (
            <>
              <section className="card p-4 space-y-3" aria-label={p.editando ? 'Editar sitio' : 'Nuevo sitio'}>
                <h2 className="font-display text-[15px] font-semibold">{p.editando ? `Editar «${p.editando.nombre}»` : 'Nuevo sitio'}</h2>
                <FormaSitio key={p.editando?.id ?? 'nuevo'} accion={p.accionGuardar} inicial={p.editando ? aEditable(p.editando) : SITIO_VACIO} clientes={p.clientes} padres={padres} />
                {p.editando && <Link href={`/dashboard/agentes/conductores/sitios${p.sufijo}`} className="text-[12px] underline" style={{ color: 'var(--muted)' }}>Cancelar la edición</Link>}
              </section>
              <section className="card p-4 space-y-3" aria-label="Importar CSV">
                <h2 className="font-display text-[15px] font-semibold">Importar desde CSV</h2>
                <p className="text-[12px]" style={{ color: 'var(--muted)' }}>
                  Columnas: <code>codigo, nombre, tipo, lat, lng, radio_m, direccion, cliente, padre</code>. Todo o nada: si una fila falla, no se importa ninguna y te
                  decimos cuál corregir. Re-importar el mismo archivo actualiza por <code>codigo</code>; no duplica.
                </p>
                <details className="text-[12px]">
                  <summary className="cursor-pointer underline" style={{ color: 'var(--muted)' }}>Ver el formato de ejemplo</summary>
                  <pre className="mt-2 p-3 rounded-lg overflow-x-auto font-mono text-[11.5px]" style={{ background: 'var(--canvas)' }}>{PLANTILLA_CSV_SITIOS}</pre>
                  <p className="mt-1" style={{ color: 'var(--faint)' }}>El ejemplo trae las coordenadas en blanco a propósito: hay que llenarlas con las reales.</p>
                </details>
                <FormaImportar accion={p.accionImportar} />
              </section>
            </>
          ) : (
            <p className="text-[12px]" style={{ color: 'var(--faint)' }}>Solo el dueño de la flota o el jefe de tráfico editan el catálogo.</p>
          )}
        </div>
      </div>
    </main>
  );
}
