// Puerta del motor de recorrido animado (carril B). Los carriles A/C importan de aquí.
export { TourProvider, useTour, useTourOpcional, useProgresoTour } from './proveedor';
export { TourLanzador } from './lanzador';
export { anclaTour, validarRecorrido } from './validar';
export type { Recorrido, PasoTour, Avance } from './tipos';
