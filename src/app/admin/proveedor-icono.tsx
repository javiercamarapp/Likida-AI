/**
 * Ícono antes del nombre en "Costo por modelo" (Inicio, Model Ops,
 * Integraciones, Costos & Facturación, Analítica, Agente OCR) — el
 * proveedor se lee del prefijo real `proveedor/modelo` (google/gemini-…,
 * anthropic/claude-…, `src/lib/llm/models.ts`); WhatsApp no trae ese
 * prefijo (su fila en `llm_costo` guarda `modelo: 'whatsapp-utility'`,
 * `src/lib/likida/costos.ts`), se detecta por substring.
 *
 * Logos reales de marca, a color — pedido explícito del usuario
 * (reemplaza la insignia monocromo de letra que había antes para estos 3
 * proveedores conocidos). Un proveedor nuevo sin logo todavía cae al
 * mismo fallback de letra de siempre, no se rompe con un modelo nuevo.
 */
export function IconoProveedor({ modelo }: { modelo: string }) {
  const m = modelo.toLowerCase();

  if (m.includes('whatsapp')) {
    return (
      <div className="w-8 h-8 rounded-full overflow-hidden shrink-0" style={{ border: '1px solid var(--line)' }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- logo estático, no next/image en el resto del repo */}
        <img src="/images/logos/whatsapp.png" alt="WhatsApp" className="w-full h-full object-cover" />
      </div>
    );
  }
  if (m.startsWith('google/')) {
    return (
      <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 p-1.5" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- logo estático, no next/image en el resto del repo */}
        <img src="/images/logos/gemini.png" alt="Gemini" className="w-full h-full object-contain" />
      </div>
    );
  }
  if (m.startsWith('anthropic/')) {
    return (
      <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 p-1.5" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- logo estático, no next/image en el resto del repo */}
        <img src="/images/logos/anthropic.png" alt="Anthropic" className="w-full h-full object-contain" />
      </div>
    );
  }

  // Los demás proveedores del stack (16-ago-2026, pedido explícito con los
  // logos): el prefijo del slug de OpenRouter decide. SVGs estáticos en
  // public/images/logos/ — mismo camino que los 3 de arriba. Solo viven
  // aquí los proveedores que el stack puede rutear (regla del 16-ago:
  // proveedores USA).
  const SVGS: Array<[prefijo: string, archivo: string, alt: string]> = [
    ['openai/', 'openai.svg', 'OpenAI'],
    ['x-ai/', 'grok.svg', 'Grok'],
  ];
  for (const [prefijo, archivo, alt] of SVGS) {
    if (m.startsWith(prefijo)) {
      return (
        <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 p-1.5" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- logo estático, no next/image en el resto del repo */}
          <img src={`/images/logos/${archivo}`} alt={alt} className="w-full h-full object-contain" />
        </div>
      );
    }
  }

  const proveedor = modelo.includes('/') ? modelo.split('/')[0] : modelo;
  const letra = proveedor.charAt(0).toUpperCase();
  return (
    <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-bold" style={{ background: 'var(--marca)', color: 'white' }}>
      {letra}
    </div>
  );
}
