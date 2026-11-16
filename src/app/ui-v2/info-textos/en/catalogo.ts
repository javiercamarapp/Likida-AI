import type { InfoTexto, INFO_CATALOGO } from '../../info-catalogo';
import { PENDIENTE_EN, T, V } from './constructores';

// Textos de ⓘ en inglés (US) de `info-catalogo.ts` (Resumen e Inicio). Mismas claves y mismo orden que el español.
export const INFO_CATALOGO_EN: Record<keyof typeof INFO_CATALOGO, InfoTexto> = {
  'resumen.monto_comprobado': V(
    'Verified amount', 'Money from route expenses with a receipt, in the chosen period.',
    'Sum of the verified total of the settlements created in the period. Rejected reviews are not counted.',
    'Your fleet’s settlements, cut off by creation date and the period in the filter bar.',
  ),
  'resumen.por_firmar': V(
    'To review', 'Settlements the agent left waiting for a review.',
    'Counts the period’s settlements with «review» status. Rejected ones are not counted.',
    'Your fleet’s settlements, period from the filter bar.',
    'Open the Settlement agent and decide each one.',
  ),
  'resumen.peajes_periodo': V(
    'Tolls for the period', 'Toll booth spending in the chosen period.',
    'Sum, by ISO week (Monday to Sunday), of the expenses with the «caseta» concept. If the reading cannot state it, it shows «—».',
    'Your fleet’s expenses grouped by week; the current week may be incomplete.',
  ),
  'resumen.carta_porte_completas': V(
    'Complete Carta Porte', 'Open trips with their Carta Porte complete, next to the total of open trips.',
    'Counts the open or in-reconciliation trips whose carrier checklist is ready and has no missing customer items. If there are more trips than were read, it is not stated and shows «—».',
    'Your fleet’s open and in-reconciliation trips, at the moment the page is opened.',
  ),
  'resumen.a_tiempo': {
    titulo: 'On time',
    estado: 'por_confirmar',
    queEs: 'Deliveries within the service commitment.',
    comoSeCalcula: 'No verified reader yet: until there is one, the figure is shown as no data, not as zero.',
    fuente: PENDIENTE_EN.PENDIENTE_FUENTE,
  },
  'resumen.liquidaciones_cerradas': V(
    'Closed settlements', 'Settlements created in the chosen period.',
    'Counts the period’s settlements. Rejected reviews are not counted.',
    'Your fleet’s settlements, cut off by creation date.',
  ),
  'resumen.con_diferencias': V(
    'With differences', 'Period settlements where the agent found differences.',
    'Counts the period’s settlements with «with differences» status. Rejected ones are not counted.',
    'Your fleet’s settlements, period from the filter bar.',
  ),
  'resumen.requiere_atencion': V(
    'Needs your attention', 'What is waiting for a decision or a look from you.',
    'Gathers, in this order: the next setup step, the agents’ alerts, the settlements to review and the escalated trips. Whatever has nothing pending is marked as reviewed; whatever could not be read says so.',
    'The same readings as this page; setup uses what you declared in this browser.',
    'Open a row to see the detail and the link to the screen where it is resolved.',
  ),
  'resumen.cierres_semana': V(
    'Settlements closed per week', 'How many settlements are created each week.',
    'Counts the settlements of the last eight weeks per week (Monday to Sunday, Mexico day). Rejected ones are not counted. The last week is incomplete and is drawn with a hatch pattern.',
    'Your fleet’s settlements; it does not depend on the period in the filter bar.',
  ),
  'resumen.diferencias_recuperado': T('Differences vs recovered', 'What did not add up compared with what has already been recovered.'),
  'resumen.lo_que_hizo_solo': V(
    'What it did on its own', 'Reminders and escalations the agent made without anyone asking.',
    'Lists the five most recent among the verification reminders sent and the escalated trips.',
    'Reminder and escalation stamps saved on each trip of your fleet.',
  ),
  'resumen.siguiente_mejor_accion': V(
    'Next best action', 'The suggested action for today.',
    'Fixed rule, not a model: first the next setup step, then an urgent agent alert, then the escalated trips and finally the settlements to review.',
    'The same readings as «Needs your attention».',
  ),
  // Inicio de una flota con perfil `cinco_agentes` (L11).
  'inicio.agente_liquidacion': V(
    'Settlements', 'How the Settlement agent worked today and how many are waiting for review.',
    'The status comes from its last recorded run. The figure counts the settlements in «review» status for the period in the filter bar.',
    'Agent runs and your fleet’s settlements; the period is the one in the filter bar.',
    'Open the agent to decide the ones waiting for review.',
  ),
  'inicio.agente_peajes': V(
    'Tolls', 'How the Toll reconciliation agent worked and how many late charges are candidates.',
    'The status comes from its last run. For the owner and finance, the figure counts the crossings dated before the start of the period of their IAVE file (provisional definition); for other roles, the tasks of the last run.',
    'Agent runs and the IAVE report loaded; the period is stated on the card.',
    'They are candidates to validate with the provider, not improper charges.',
  ),
  'inicio.agente_carta_porte': V(
    'Carta Porte', 'How the Carta Porte agent worked and how many open trips have their checklist complete.',
    'Counts the open trips with the carrier checklist ready and no missing customer items, against the total of open trips.',
    'Agent runs and your fleet’s open trips, right now.',
  ),
  'inicio.agente_vigia': V(
    'Customer service', 'The agent that serves the fleet’s customers; a person approves each reply.',
    'This agent does not record runs and does not yet have a light count for the Home page, so no figure is shown.',
    'Its own dashboard.',
    'Open its dashboard to see and approve the replies.',
  ),
  'inicio.agente_conductor': V(
    'Drivers', 'How the Driver communication agent worked and how many trips it escalated.',
    'The status comes from its last run. The figure counts the open trips with an escalation stamp and no driver acceptance.',
    'Agent runs and your fleet’s trips, right now.',
    'Open the escalated trips and follow up.',
  ),
  'inicio.importe_iave': V(
    'IAVE amount per ten-day period', 'What was billed for toll booths in the most recent ten-day period with an IAVE file.',
    'Adds up the amount of the crossings dated within the ten-day period, without the late charges. The previous ten-day period loaded is shown separately: they are different periods, not a variation.',
    'IAVE report you loaded; the card states the period, missing ten-day periods and when it was read. Owner and finance only.',
    'If ten-day periods are missing, the month is not complete: load them to close it.',
  ),
  'inicio.extemporaneos': V(
    'Late charges', 'Crossings of the same month dated before the start of the period of their IAVE file.',
    'Adds up the quantity and amount of those crossings in the ten-day periods loaded. The definition of late is provisional, which is why the stamp is Estimated.',
    'IAVE report you loaded; the card states the period and when it was read. Owner and finance only.',
    'They are candidates to validate with the provider, not improper charges.',
  ),
  'inicio.hoy': V(
    'Today in your fleet', 'What needs your attention now, in at most three rows.',
    'Gathers the agents’ alerts, the settlements to review, the escalated trips and the trips in progress. Whatever has nothing pending is marked as reviewed. Carta Porte about to expire is not measured yet.',
    'The same readings as this page. A fleet with no activity shows the first steps.',
    'Open a row to see the detail and the link to the screen where it is resolved.',
  ),
  'inicio.puesta_en_marcha': V(
    'Setup', 'The six steps to get the agents operating and who must resolve each one.',
    'One segment per critical step; a step counts as ready only if the platform measured it or you declared it. Skipping a step does not count it as ready.',
    'Signals from your account and what you declared in this browser.',
    'Continue with the next step that is yours.',
  ),
  'inicio.hizo_solo': V(
    'What it did on its own', 'Escalations and reminders the agent made without anyone asking, in the last 24 hours.',
    'Lists the most recent events (up to five) that fall within the last 24 hours.',
    'Reminder and escalation stamps saved on each trip of your fleet.',
  ),
  'inicio.atajos': V(
    'Shortcuts', 'Direct links to what is used most to operate.',
    'Shows only the screens your role can open.',
    'Your role’s permissions.',
  ),
};
