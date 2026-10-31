'use client';

// «Pregunta a tus datos» (L5): la interfaz del chat vive ahora en `chat/` — componentes (`chat-flota`, `composer`, `mensajes`,
// `bloques`, `traza`, `historial`, `sugerencias`), el estado y el transporte (`use-analista`) y la lógica pura (`respuestas`).
// Este archivo conserva las rutas de importación de siempre (`./chat`, `../chat`) para la página y las pruebas.
export { default } from './chat/chat-flota';
export { CATALOGO_CONSULTA, responder, respuestaLocal } from './chat/respuestas';
