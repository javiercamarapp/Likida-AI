'use client';

// Buscador real: navega por las secciones que YA existen en la página
// (mismos anchors que el sidebar), no un ⌘K decorativo que no hace nada.
const SECCIONES = [
  { id: 'agentes', label: 'Agentes — costo por fase' },
  { id: 'flotas', label: 'Flotas' },
  { id: 'conversaciones', label: 'Conversaciones de WhatsApp' },
];

export default function BuscadorSecciones() {
  return (
    <div className="relative flex-1 max-w-sm">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm pointer-events-none" style={{ color: 'var(--muted)' }}>⌕</span>
      <select
        defaultValue=""
        className="w-full pl-8 pr-3 py-2 rounded-lg text-sm hairline appearance-none cursor-pointer"
        style={{ background: 'var(--surface)' }}
        onChange={(e) => {
          if (!e.target.value) return;
          const el = document.getElementById(e.target.value);
          el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          e.target.value = '';
        }}
      >
        <option value="" disabled>Ir a sección…</option>
        {SECCIONES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select>
    </div>
  );
}
