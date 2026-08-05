// ═══════════════════════════════════════════════════════════════════════════
// LO QUE SE DIBUJA EN /mis-viajes, SEPARADO DE LO QUE SE CONSULTA.
//
// Está en su propio archivo —y no dentro de `page.tsx`— por la regla de
// verificación de CLAUDE.md: la pantalla vive detrás de sesión, así que para
// MIRARLA hay que montarla en un preview temporal, y un preview que importe
// una copia del marcado verifica la copia. Aquí se importa el componente REAL.
//
// Es el mismo reparto que ya usa /chofer (`chofer/vista.tsx`).
// ═══════════════════════════════════════════════════════════════════════════

/**
 * El encabezado y el ancho de la página, una sola vez.
 *
 * El aviso de "alta incompleta" sale DENTRO de la pantalla y no como una
 * página pelona: un chofer que ya inició sesión y de pronto ve un texto suelto
 * sin el rótulo de Likida arriba no sabe si entró a su cuenta o si algo se
 * rompió, y ese es justo el momento en que hay que decirle con claridad qué le
 * falta.
 */
export function Marco({ nombre, children }: { nombre: string | null; children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="glass sticky top-0 z-10 border-b" style={{ borderColor: 'var(--line)' }}>
        <div className="max-w-3xl mx-auto px-8 h-16 flex items-center justify-between">
          <span className="font-semibold tracking-tight text-xl">Likida</span>
          <span className="text-sm" style={{ color: 'var(--muted)' }}>{nombre ?? 'Mis viajes'}</span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-8 py-10 space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">Mis viajes</h1>
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          Solo lectura — para mandar comprobantes, sigue usando WhatsApp.
        </p>

        {children}
      </main>
    </div>
  );
}

/** Una tarjeta de texto: los dos estados en los que no hay tabla que pintar. */
function Aviso({ children }: { children: React.ReactNode }) {
  return (
    <div className="card p-8 text-base leading-relaxed" style={{ color: 'var(--muted)' }}>
      {children}
    </div>
  );
}

/**
 * "Tu alta está incompleta" — NO "todavía no tienes viajes".
 *
 * `app_user.tenant_id` es nullable y `requireOperador` no lo exige: solo exige
 * `operador_id`. Un chofer al que le crearon la cuenta y le ligaron su fila de
 * `operador`, pero nunca le pusieron la flota, entra con `tenantId` en null y
 * su consulta sale vacía SIEMPRE. Decirle "todavía no tienes viajes cerrados"
 * es afirmar algo falso y, peor, mandarlo a esperar: lo que le falta no llega
 * solo, se lo tiene que arreglar su oficina. Es la misma frase que ya dice
 * /chofer, para que las dos superficies no cuenten historias distintas.
 */
export function AltaIncompleta() {
  return (
    <Aviso>
      Tu cuenta todavía no está ligada a una flota, así que no se pueden
      mostrar tus viajes. Pídele a tu oficina que complete tu alta.
    </Aviso>
  );
}

/** El otro vacío, el que sí se resuelve solo: aún no cierra ningún viaje. */
export function SinViajesCerrados() {
  return <Aviso>Todavía no tienes viajes cerrados.</Aviso>;
}
