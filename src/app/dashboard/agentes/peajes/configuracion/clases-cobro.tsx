import type { ReglasFlota } from '@/lib/likida/peajes/reglas_cobro_config';

type Accion = (fd: FormData) => Promise<void>;

export interface ClasesCobroVista {
  /** `null` = no se pudo leer. */
  reglas: ReglasFlota | null;
  puedeEditar: boolean;
  acciones: { guardarReglasFlota: Accion };
}

const CSS_BOTON = 'inline-flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 rounded-lg transition-opacity hover:opacity-85';
const ESTILO_PRIMARIO = { background: 'var(--marca)', color: 'var(--marca-fg)' } as const;
const CSS_INPUT = 'hairline text-[12px] px-2.5 py-1.5 rounded-lg';
const ESTILO_INPUT = { background: 'var(--surface)', color: 'var(--ink)' } as const;

/**
 * CLASES DEL COBRO POR FLOTA: (1) qué clases son normales para una unidad UTILITARIO (camioneta) y (2) qué se hace con la clase 1.
 * Defaults seguros: sin clases de utilitario declaradas NO se les evalúa la clase (no se inventa una tarifa de coche); la clase 1 se toma
 * como tarifa por pasada en todas las casetas (lo que indicó el cliente), para no llenar el reporte de falsos candidatos.
 */
export function SeccionClasesCobro({ datos }: { datos: ClasesCobroVista }) {
  const { reglas, puedeEditar, acciones } = datos;
  return (
    <section className="card p-4" id="clases-cobro">
      <h2 className="font-display text-[15px] font-semibold mb-1">Clases del cobro: utilitarios y clase 1</h2>
      <p className="text-[11px] mb-3" style={{ color: 'var(--faint)' }}>
        La revisión espera clase 3 y 5 para un tracto. Aquí declaras lo que no puede adivinar: qué clases son normales para una <b>camioneta (utilitario)</b> y
        cómo tratar la <b>clase 1</b>, que según el cliente es la tarifa <b>por pasada</b> y no una clase de ejes.
      </p>
      {reglas === null ? (
        <p className="text-[12px]" style={{ color: 'var(--muted)' }}>No se pudo leer esta configuración ahora mismo.</p>
      ) : !puedeEditar ? (
        <p className="text-[12px]" style={{ color: 'var(--muted)' }}>
          Utilitarios: {reglas.clasesUtilitario.length > 0 ? `clases ${reglas.clasesUtilitario.join(', ')}` : 'sin clases declaradas (no se les evalúa la clase)'}. Clase 1:{' '}
          {reglas.clase1 === 'todas' ? 'tarifa por pasada en todas las casetas' : 'solo normal en las casetas declaradas por pasada'}.
        </p>
      ) : (
        <form action={acciones.guardarReglasFlota} className="space-y-3">
          <label className="block">
            <span className="etiqueta-mono text-[11px] uppercase block" style={{ color: 'var(--faint)' }}>Clases válidas del utilitario</span>
            <input name="clases_utilitario" defaultValue={reglas.clasesUtilitario.join(', ')} maxLength={60} placeholder="Vacío = no se evalúa"
              aria-label="Clases de cobro válidas para unidades utilitario, separadas por comas"
              className={`${CSS_INPUT} w-[220px] mt-0.5`} style={ESTILO_INPUT} />
            <span className="block text-[11px] mt-1" style={{ color: 'var(--faint)' }}>
              Por ejemplo <span className="cifra-mono">1, 2</span>. Vacío: a los utilitarios no se les evalúa la clase y la revisión lo dice. El tipo de cada unidad sale del
              catálogo de TAGs (tracto o utilitario); un TAG sin tipo sigue marcándose como candidato.
            </span>
          </label>
          <fieldset className="space-y-1.5">
            <legend className="etiqueta-mono text-[11px] uppercase" style={{ color: 'var(--faint)' }}>Clase 1</legend>
            <label className="flex items-start gap-2 text-[12px]">
              <input type="radio" name="clase_uno" value="todas" defaultChecked={reglas.clase1 === 'todas'} className="mt-0.5" />
              <span><span className="font-medium">Tarifa por pasada en todas las casetas</span> (recomendado): la clase 1 no se marca. Se cuenta aparte en la revisión.</span>
            </label>
            <label className="flex items-start gap-2 text-[12px]">
              <input type="radio" name="clase_uno" value="declaradas" defaultChecked={reglas.clase1 === 'declaradas'} className="mt-0.5" />
              <span><span className="font-medium">Solo en las casetas declaradas por pasada</span>: en las demás, la clase 1 se marca como candidato. Declara las casetas por pasada en el catálogo de casetas o en «Reglas de cobro».</span>
            </label>
          </fieldset>
          <button type="submit" className={`rv-btn rv-btn--primary ${CSS_BOTON}`} style={ESTILO_PRIMARIO}>Guardar clases</button>
        </form>
      )}
    </section>
  );
}
