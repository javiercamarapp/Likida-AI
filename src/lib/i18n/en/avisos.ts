import type { avisos as avisosEs } from '../es/avisos';

// «avisos» en inglés (US). El tipo exige EXACTAMENTE las claves de es.
export const avisos: Record<keyof typeof avisosEs, string> = {
  'planPausa.ilegible': 'Data and receipts keep coming in; outgoing messages resume once the plan is confirmed.',
  'planPausa.frena': 'Data and receipts keep coming in; no automatic message or email goes out until the plan is reactivated.',
};
