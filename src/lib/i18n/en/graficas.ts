import type { graficas as graficasEs } from '../es/graficas';

// «graficas» en inglés (US). El tipo exige EXACTAMENTE las claves de es.
export const graficas: Record<keyof typeof graficasEs, string> = {
  'vacio': 'No data for the period',
  'embudo.etapa': 'Stage',
  'embudo.valor': 'Value',
  'embudo.anterior': 'From the previous',
  'embudo.parteDe': '{pct} of "{etapa}"',
  'embudo.convAnterior': '{pct} of the previous stage',
  'embudo.sinDato': 'no data',
  'calor.fila': 'Row',
  'calor.menos': 'less',
  'calor.mas': 'more',
  'apiladas.periodo': 'Period',
  'apiladas.total': 'Total',
};
