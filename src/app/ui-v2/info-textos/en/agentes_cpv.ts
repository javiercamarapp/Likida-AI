import type { InfoTexto } from '../../info-catalogo';
import type { INFO_AGENTES_CPV } from '../agentes_cpv';
import { V } from './constructores';

// English help texts (ⓘ) for the Carta Porte panels. Same keys, same order as ../agentes_cpv.ts.
export const INFO_AGENTES_CPV_EN: Record<keyof typeof INFO_AGENTES_CPV, InfoTexto> = {
  'carta_porte_agente.en_curso': V(
    'Trips in progress', 'Trips in your fleet that are still open or in reconciliation.',
    'Counts the trips with an open or in-reconciliation status. The Carta Porte verdict is only evaluated on the nearest trips; this total counts all of them.',
    'Your fleet’s trips, read when the page opens.',
  ),
  'carta_porte_agente.esperan': V(
    'Awaiting declaration', 'Trips in progress where the agent is waiting for an answer from you about the Carta Porte.',
    'Counts, among the evaluated trips, those the legal tree marks as “declaration missing”.',
    'The nearest trips in your fleet with an open or in-reconciliation status, read when the page opens.',
    'Answer what is missing on the Carta Porte screen.',
  ),
  'carta_porte_agente.necesitan': V(
    'Need the complement', 'Trips in progress whose verdict is that they require the Carta Porte complement.',
    'Counts, among the evaluated trips, those the legal tree marks as “yes, it needs it”.',
    'The nearest trips in your fleet with an open or in-reconciliation status, read when the page opens.',
  ),
  'carta_porte_agente.borradores': V(
    'Drafts with no failures', 'Evaluated trips whose complement draft is already built and has no validation failures.',
    'Counts, among the evaluated trips, those that have a draft and zero failures in the validations the PAC would certainly reject. It does not mean the codes were verified against the SAT.',
    'The nearest trips in your fleet with an open or in-reconciliation status, read when the page opens.',
  ),
  'carta_porte_agente.sin_tocar': V(
    'Approved untouched', 'Percentage of approved documents that no person corrected.',
    'Among the approved documents in the window, the percentage that received no corrections from a person. With no approved documents it shows “—”, not 0%.',
    'Carta Porte documents of your fleet from the last few days; if there are more than are read at once, the screen warns that the figures are partial.',
  ),
  'carta_porte_agente.enviados': V(
    'Sent to the customer’s system', 'Documents whose template has already been sent to the customer’s system.',
    'Counts the submissions in the window with “sent” status. It does not include those uploaded by hand.',
    'Carta Porte document submissions of your fleet from the last few days.',
  ),
  'carta_porte_agente.esperan_requerimiento': V(
    'Awaiting requirement', 'Submissions on hold because the requirement does not yet exist in the customer’s system.',
    'Counts the submissions in the window that are still pending a requirement; the note below gives the time of the one that has waited longest.',
    'Carta Porte document submissions of your fleet from the last few days.',
    'Check with the customer that the requirement has been registered.',
  ),
  'carta_porte_agente.rechazados_tms': V(
    'Rejected by the customer’s system', 'Submissions that the customer’s system rejected.',
    'Counts the submissions in the window with “rechazado_tms” status. The known causes are broken down in “Why they are rejected”.',
    'Carta Porte document submissions of your fleet from the last few days.',
    'Fix the cause and send again.',
  ),
};
