import { MessageCircle } from 'lucide-react';

/**
 * "TU FLOTA SE OPERA POR WHATSAPP" (17-ago-2026) — la presentación del canal
 * dentro del panel: los MENSAJES LITERALES que el usuario puede escribir,
 * como burbujas de chat, filtrados a su rol. El principio de la casa: el
 * ciclo se cierra en WhatsApp; el panel es donde se ve todo junto. Solo se
 * enseñan mensajes que el canal YA atiende — prometer uno inexistente es la
 * misma mentira que un rótulo falso.
 */
type Burbuja = { de: 'tu' | 'likida'; texto: string };

const GUION_JEFE: Burbuja[] = [
  { de: 'tu', texto: 'nuevo viaje para Juan Pérez, Puebla a Monterrey, anticipo 8000' },
  { de: 'likida', texto: 'Te lo confirmo y le aviso a Juan. Sus fotos de tickets se cuelgan solas del viaje.' },
  { de: 'tu', texto: '¿cómo van?' },
  { de: 'likida', texto: 'El resumen de tu operación, al momento.' },
  { de: 'tu', texto: 'mándame el informe en pdf' },
  { de: 'likida', texto: 'El reporte formal, aquí mismo. 📊 Y cuando tu chofer escriba «listo», su liquidación llega cuadrada en PDF.' },
];

const GUION_CONTADOR: Burbuja[] = [
  { de: 'tu', texto: '¿cómo van?' },
  { de: 'likida', texto: 'Cifras del sistema: comprobado, anticipos, lo fiscal — solo lo que tu rol ve.' },
  { de: 'tu', texto: '¿cuánto llevamos de diésel este mes?' },
  { de: 'likida', texto: 'Te lo contesta el mismo analista del panel, con cifras respaldadas.' },
  { de: 'tu', texto: 'mándame el informe en pdf' },
  { de: 'likida', texto: 'El reporte formal con el canon de la casa, directo al chat. 📊' },
];

export function OperaWhatsApp({ rol }: { rol: 'jefe' | 'contador' }) {
  const guion = rol === 'contador' ? GUION_CONTADOR : GUION_JEFE;
  return (
    <section className="hairline rounded-2xl p-5" style={{ background: 'var(--surface)' }}>
      <div className="flex items-center gap-2 mb-1">
        <MessageCircle width={16} height={16} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />
        <h2 className="text-[15px] font-semibold" style={{ color: 'var(--ink)' }}>Tu flota se opera por WhatsApp</h2>
      </div>
      <p className="text-[12.5px] mb-4" style={{ color: 'var(--muted)' }}>
        El ciclo completo vive en el chat — este panel es donde lo ves todo junto. Escríbele así:
      </p>
      <div className="space-y-2">
        {guion.map((b, i) => (
          <div key={i} className={`flex ${b.de === 'tu' ? 'justify-end' : 'justify-start'}`}>
            <p className="max-w-[85%] px-3 py-1.5 rounded-2xl text-[12.5px] leading-snug"
              style={b.de === 'tu'
                ? { background: 'var(--marca)', color: 'var(--marca-fg)', borderBottomRightRadius: 6 }
                : { background: 'var(--canvas)', color: 'var(--ink2)', border: '1px solid var(--line)', borderBottomLeftRadius: 6 }}>
              {b.texto}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
