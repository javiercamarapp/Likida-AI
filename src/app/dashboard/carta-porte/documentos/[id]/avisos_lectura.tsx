import { TriangleAlert } from 'lucide-react';
import type { MetaExtraccion } from '@/lib/likida/carta_porte_docs/repo';
import { etiquetaCampo } from '@/lib/likida/carta_porte_docs/campos';

/**
 * A37-A3-03 · LO QUE LA LECTURA AVISÓ Y NADIE VEÍA.
 *
 * `meta.avisos` (se leyó solo el primer embarque, PDF de más de 20 páginas, hojas/filas/columnas recortadas…),
 * `meta.notasModelo` (lo que el modelo dijo que no pudo leer) y `meta.revisionHumana` (campos que los niveles no lograron
 * cuadrar) se GUARDABAN pero ninguna pantalla los mostraba. Aquí se pintan arriba de la revisión, antes de que alguien
 * apruebe pensando que el archivo se procesó completo.
 */
export function AvisosLectura({ meta }: { meta: MetaExtraccion | undefined | null }) {
  if (!meta) return null;
  const avisos = [...new Set((meta.avisos ?? []).filter((a) => a.trim() !== ''))];
  const notas = [...new Set((meta.notasModelo ?? []).filter((a) => a.trim() !== ''))];
  const revision = meta.revisionHumana ?? [];
  const perdidas = new Set((meta.lecturaIncompleta ?? []).map((p) => p.mensaje));
  // Las pérdidas que bloquean ya salen como hallazgo; aquí se listan igual para que el aviso original no se pierda.
  const otros = avisos.filter((a) => !perdidas.has(a));
  if (otros.length === 0 && notas.length === 0 && revision.length === 0 && perdidas.size === 0) return null;
  return (
    <section className="text-[12px] px-3 py-2 rounded-lg space-y-1.5" role="status" aria-label="Avisos de la lectura" style={{ background: 'var(--warnbg, var(--canvas))', color: 'var(--warn)' }}>
      <p className="font-semibold flex items-center gap-1.5">
        <TriangleAlert width={14} height={14} strokeWidth={1.75} className="shrink-0" />
        La lectura de este archivo avisó de lo siguiente: revísalo antes de aprobar
      </p>
      {perdidas.size > 0 && (
        <ul className="list-disc pl-5 space-y-0.5" aria-label="Lo que no se leyó">
          {[...perdidas].map((m) => <li key={m}><strong>No se leyó completo:</strong> {m}</li>)}
        </ul>
      )}
      {revision.length > 0 && (
        <ul className="list-disc pl-5 space-y-0.5" aria-label="Revisión humana">
          {revision.map((h) => (
            <li key={`${h.renglon ?? 'doc'}|${h.campo}|${h.codigo}`}>
              <strong>{h.campo === 'documento' ? 'Documento' : etiquetaCampo(h.campo, h.renglon)}:</strong> {h.motivo}
              {h.valores.length > 0 ? ` Valores en conflicto: ${h.valores.map((v) => `«${v}»`).join(', ')}.` : ''}
            </li>
          ))}
        </ul>
      )}
      {otros.length > 0 && (
        <ul className="list-disc pl-5 space-y-0.5" aria-label="Avisos">
          {otros.map((a) => <li key={a}>{a}</li>)}
        </ul>
      )}
      {notas.length > 0 && (
        <ul className="list-disc pl-5 space-y-0.5" aria-label="Notas del modelo">
          {notas.map((n) => <li key={n}><strong>El modelo anotó:</strong> {n}</li>)}
        </ul>
      )}
    </section>
  );
}
