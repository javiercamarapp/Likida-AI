// ═══════════════════════════════════════════════════════════════════════════
// ¿EL AVISO DE VIAJE SE ARMA Y SE ENVÍA SOLO? (CT-A345-03)
//
// El generador (`generar.ts`), la bandeja y la entrega existen y están probados, pero la pasada que los corre
// (`pasadaAvisos` en `servicio.ts`) solo corre si `crearDepsVigia()` recibe un puerto real de avisos
// (`PuertoAvisosCron`), y hoy el cron `/api/cron/vigia` lo llama sin él: `avisos: null`. Mientras sea así, NINGÚN aviso
// se arma ni sale solo, y las pantallas no pueden decir «aparecerán aquí» ni «sale en la siguiente revisión».
//
// Esta bandera es lo que las pantallas leen. `conexion.test.ts` la ata a la realidad: si alguien cablea el puerto real,
// esa prueba se pone roja hasta que esta bandera pase a `true` (y con ella los textos se vuelven los de siempre).
// El cableado completo (alias de cliente, `DepsResolver`, frontera con el TMS) es de la fase F4 y está CONDICIONADO.
// ═══════════════════════════════════════════════════════════════════════════

export const AVISO_AUTOMATICO_CONECTADO = false;

export const TEXTO_AVISO_AUTOMATICO_POR_CONECTAR =
  'El armado y el envío automático de los avisos de viaje todavía están por conectar: hoy no se arma ni sale ningún aviso solo. '
  + 'Lo que se guarda aquí (configuración, datos manuales) queda listo para cuando se conecte.';

export const VACIO_BANDEJA_POR_CONECTAR =
  'Aún no hay avisos de viaje, y todavía no se arman solos: el armado automático está por conectar.';
