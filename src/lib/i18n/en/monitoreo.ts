import type { monitoreo as es } from '../es/monitoreo';

export const monitoreo: Record<keyof typeof es, string> = {
  'quema.titulo': 'Error budget and burn',
  'quema.nota': 'Initial thresholds, to be calibrated with real data. "Not measured" is not green: events are missing.',
  'quema.estado.pagina': 'Fast burn',
  'quema.estado.ticket': 'Slow burn',
  'quema.estado.ninguna': 'No burn',
  'quema.estado.sin_medir': 'Not measured',
  'quema.presupuesto': 'Budget remaining: {pct} %',
  'quema.agotado': 'Budget exhausted: no autonomy promotions and no prompt or model changes until the golden exam passes.',
  'quema.objetivo': 'Target {pct} %',
  'quema.error': 'Not available now. This is not zero.',
  'caso.boton': 'Turn into an exam case',
  'quema.runbook': 'Runbook',
};
