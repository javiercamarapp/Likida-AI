'use client';

import { useState } from 'react';
import { useT } from '@/lib/i18n/proveedor';
import { admin_sistema as admin_sistemaEs } from '@/lib/i18n/es/admin_sistema';
import './mapa-actividad.css';

/**
 * El mapa de puntos INTERACTIVO (orden del 17-ago): clic en un día → fecha y
 * pushes de ESE día, dicho abajo con todas sus letras. Cliente solo por el
 * clic — los datos llegan del servidor ya resueltos.
 *
 * Cada cuadro es un radio nativo (grupo único): se elige con el puntero o con las flechas, sin botones sueltos ni estilos en línea;
 * la intensidad sale de `data-nivel` (0 = sin pushes, 1..4 = cuartiles del máximo) y el color solo acompaña a la cifra de abajo.
 */
/** A37-S06-08: los buckets de GitHub (`stats/commit_activity`) son días UTC que arrancan en domingo 00:00 UTC;
 *  formatear con la zona de CDMX (UTC-6) rotulaba cada cuadro con el día ANTERIOR. */
export function fechaDeDiaUtc(ms: number): string {
  return new Intl.DateTimeFormat('es-MX', {
    timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }).format(new Date(ms));
}

/** 0 = sin pushes; 1..4 = cuartiles del máximo de la ventana. */
function nivelDe(n: number, tope: number): 0 | 1 | 2 | 3 | 4 {
  if (n <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((n / tope) * 4))) as 1 | 2 | 3 | 4;
}

export function MapaActividad({ semanas, total }: {
  semanas: Array<{ inicio: number; dias: number[] }>;
  total: number;
}) {
  const { t, tp } = useT('admin_sistema', admin_sistemaEs);
  const [dia, setDia] = useState<{ fecha: string; n: number } | null>(null);
  const tope = Math.max(1, ...semanas.flatMap((s) => s.dias));
  const fechaDe = fechaDeDiaUtc;
  return (
    <div className="rv-act">
      <div className="rv-act__rejilla" role="radiogroup" aria-label={t('dev_mapa_actividad.commits_en_52_semanas_se_ensenan')}>
        {semanas.map((sem) => (
          <div key={sem.inicio} className="rv-act__semana">
            {sem.dias.map((n, di) => {
              const fecha = fechaDe(sem.inicio + di * 86_400_000);
              const activo = dia?.fecha === fecha;
              return (
                <label key={di} className="rv-act__dia" data-nivel={nivelDe(n, tope)} data-activo={activo || undefined} title={`${tp('dev_mapa_actividad.push', n)} · ${fecha}`}>
                  <input type="radio" name="dia-actividad" className="rv-sr" checked={activo} onChange={() => setDia({ fecha, n })} aria-label={`${tp('dev_mapa_actividad.push', n)} · ${fecha}`} />
                </label>
              );
            })}
          </div>
        ))}
      </div>
      <p className="rv-act__lectura">
        {dia
          ? <><b className="tabular">{tp('dev_mapa_actividad.push', dia.n)}</b> · {dia.fecha}</>
          : <>{total}{' '}{t('dev_mapa_actividad.commits_en_52_semanas_se_ensenan')}</>}
      </p>
    </div>
  );
}
