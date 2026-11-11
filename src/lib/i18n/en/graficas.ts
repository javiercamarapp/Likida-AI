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
  // /admin screens that mount the charts (visual round 4).
  'ventas.embudo.titulo': 'Sales funnel',
  'ventas.embudo.etiqueta': 'Prospects that reached each stage of the main path',
  'ventas.embudo.nota': 'Each stage counts the prospects that are in it or in a later one ({enRuta} on the path). Off the path there are {fuera} (appointment cancelled, no-show or lost): they are not spread across stages because we do not know where they dropped out.',
  'ventas.embudo.vacio': 'No prospects on the path',
  'consumo.propositos.titulo': 'Today\'s spend by fleet and purpose',
  'consumo.propositos.etiqueta': 'Spend settled today by fleet, split by purpose',
  'consumo.propositos.nota': 'Only what is already settled today (Mexico day), without live reservations. Spend by phase and by day is not measured yet: the daily series carries no phase.',
  'consumo.propositos.interactivo': 'Interactive (driver and chats)',
  'consumo.propositos.ocr_lote': 'Batch reading',
  'consumo.propositos.fondo': 'Agents and background',
  'corridas.calor.titulo': 'When the agents run',
  'corridas.calor.etiqueta': 'Runs on this page by weekday and 3-hour block (Mexico time)',
  'corridas.calor.nota': 'Counts the {n} runs on the page you see (with the filter applied) by start time; it is not the full history.',
  'corridas.calor.dias': 'Mon,Tue,Wed,Thu,Fri,Sat,Sun',
  'crecimiento.activacion.ceros': 'No fleet has been signed up yet: all three stages are zero, and that is a real count.',
  'ventas.embudo.error': 'The pipeline could not be read right now. This does NOT mean there are no prospects.',
};
