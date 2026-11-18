import type { CasosGrupo } from './tipos';

// Casos por pantalla, grupo A: href -> caso (en español). El inglés vive en `./en/grupo_a.ts` con las mismas rutas.
export const CASOS_A: CasosGrupo = {
  '/dashboard/agentes/liquidacion': {
    titulo: 'Ejemplo: llega la liquidación de un operador',
    pasos: [
      { etapa: 'entra', ancla: 'pantalla.titulo', titulo: 'Llega el cálculo del operador',
        texto: 'Tu sistema lo manda por API o llega un Excel por correo. El agente lo recibe y lo deja en su cola.' },
      { etapa: 'procesa', titulo: 'Se compara con viajes, gastos y póliza',
        texto: 'El agente contrasta el cálculo con los viajes y gastos del operador y revisa que tenga póliza. Lo que no cuadra queda marcado.' },
      { etapa: 'decide', titulo: 'Si hay una excepción, se retiene',
        texto: 'Se retiene si el neto sale negativo, si falta la póliza o si el operador no tiene correo. Lo demás sigue solo.',
        persona: 'Una persona revisa lo retenido, resuelve la causa y libera el envío. El agente no decide por ella.' },
      { etapa: 'sale', titulo: 'Sale el Excel y el PDF por correo',
        texto: 'Lo que pasa la revisión se entrega por correo en Excel y PDF al operador, al coordinador y a RH. El agente no paga ni mueve dinero.' },
    ],
  },
  '/dashboard/agentes/peajes': {
    titulo: 'Ejemplo: llega el estado de cuenta de telepeaje',
    pasos: [
      { etapa: 'entra', ancla: 'pantalla.titulo', titulo: 'Subes el estado de cuenta del mes',
        texto: 'Es el archivo de IAVE o PASE. Sin él no hay nada que conciliar: el agente no estima casetas que no se cruzaron.' },
      { etapa: 'procesa', titulo: 'Se cruza cada cruce contra el GPS',
        texto: 'El agente compara cada cargo del estado de cuenta con el recorrido que registró el GPS y con lo que comprobaron los viajes.' },
      { etapa: 'decide', titulo: 'Se marcan los cargos que no cuadran',
        texto: 'Un cargo sin recorrido que lo respalde, o repetido, queda marcado con su cruce a la vista.',
        persona: 'Una persona decide cuáles cargos se reclaman. El agente propone; no reclama por su cuenta.' },
      { etapa: 'sale', titulo: 'Se arma el reclamo, con plazo',
        texto: 'Por cada cargo que decides reclamar, el agente arma el reclamo y te muestra el plazo para presentarlo ante la caseta.' },
    ],
  },
  '/dashboard/agentes/carta-porte': {
    titulo: 'Ejemplo: se despacha un viaje sin ruta declarada',
    pasos: [
      { etapa: 'entra', ancla: 'pantalla.titulo', titulo: 'Viaje y documentos del embarque',
        texto: 'El viaje llega de tu TMS al despacharlo. Los documentos del embarque (PDF, Excel, XML o foto) entran solos por el correo de la flota a la bandeja.' },
      { etapa: 'procesa', titulo: 'Se arma y se valida el borrador',
        texto: 'El agente corre el árbol legal, arma el borrador del complemento y lo revisa contra lo que el PAC rechazaría seguro. Una clave que no puede verificar se marca así.' },
      { etapa: 'decide', titulo: 'Si falta un dato, pregunta',
        texto: 'Si el viaje no dice si la ruta pisa carretera federal, el agente pregunta por WhatsApp. Sin esa respuesta queda en falta declarar; nunca afirma que no necesitas el complemento.',
        persona: 'Quien conoce la ruta responde por WhatsApp. La declaración queda firmada con quién y cuándo.' },
      { etapa: 'sale', titulo: 'Borrador validado, sin timbrar',
        texto: 'Con lo declarado, el viaje queda como necesita complemento o sin él, y el borrador se puede abrir e imprimir. Likida prepara y valida; tu PAC timbra. Likida nunca timbra.' },
    ],
  },
  '/dashboard/carta-porte': {
    titulo: 'Ejemplo: revisas los viajes antes de salir',
    pasos: [
      { etapa: 'entra', ancla: 'pantalla.titulo', titulo: 'Los viajes en curso, ya evaluados',
        texto: 'Cada viaje en curso entra a la lista con su ruta y lo que la flota y el cliente ya declararon. La lista dice si evalúa solo una parte de los viajes.' },
      { etapa: 'procesa', titulo: 'Se cuenta qué falta y de quién',
        texto: 'Por cada viaje se revisan los datos del complemento y se separan los del cliente de los del transportista, porque cada parte responde por lo que aportó.' },
      { etapa: 'decide', titulo: 'El semáforo dice qué sigue',
        texto: 'Cada viaje queda como necesita complemento, sin complemento o falta declarar. En falta declarar, el viaje espera una declaración, no una suposición.',
        persona: 'Quien conoce la ruta declara lo que falta; Likida no lo adivina. Lo del cliente se le pide al cliente.' },
      { etapa: 'sale', titulo: 'Abres el borrador del viaje',
        texto: 'El botón Abrir lleva al borrador imprimible de ese viaje, con lo declarado y lo que aún falta. Es un borrador: Likida no timbra el complemento.' },
    ],
  },
  '/dashboard': {
    titulo: 'Ejemplo: abres el Resumen por la mañana',
    pasos: [
      { etapa: 'entra', ancla: 'pantalla.titulo', titulo: 'Cada agente reporta su trabajo',
        texto: 'Liquidación, peajes, Carta Porte, servicio al cliente y operadores dejan su última corrida y sus pendientes. El Resumen lee eso, no lo captura nadie.' },
      { etapa: 'procesa', titulo: 'Se resume por agente',
        texto: 'Cada ficha dice qué hizo ese agente y en qué estado está. Cada dato lleva su periodo y su fuente; si algo no se pudo medir, lo dice en vez de poner un cero.' },
      { etapa: 'decide', titulo: 'Lo que espera a una persona va primero',
        texto: 'El bloque de atención junta lo pendiente y lo que falló. Lo que el agente hizo solo queda aparte, para que no se confunda con lo que pide decisión.',
        persona: 'Una persona abre la ficha del agente y resuelve lo pendiente en su pantalla. El Resumen no decide por ella.' },
      { etapa: 'sale', titulo: 'Entras a la pantalla que toca',
        texto: 'Cada ficha lleva a la pantalla de su agente. El periodo se cambia arriba y mueve las cifras que dependen de él.' },
    ],
  },
  '/dashboard/chat': {
    titulo: 'Ejemplo: le preguntas a tus datos',
    pasos: [
      { etapa: 'entra', ancla: 'pantalla.titulo', titulo: 'Escribes tu pregunta en español',
        texto: 'Escribes como le preguntarías a un compañero: por ejemplo, qué espera decisión hoy o qué clientes llevan esperando respuesta.' },
      { etapa: 'procesa', titulo: 'Se consultan los datos de tu flota',
        texto: 'El asistente consulta solo los datos de tu flota, paso por paso, y muestra en vivo qué está revisando.' },
      { etapa: 'decide', titulo: 'Si el dato no existe, lo dice',
        texto: 'Si no hay dato, la respuesta lo dice; no inventa una cifra ni la rellena. Una acción propuesta no se ejecuta sola.',
        persona: 'Una persona confirma cualquier acción que el asistente proponga antes de que se haga.' },
      { etapa: 'sale', titulo: 'Respuesta con su recorrido',
        texto: 'La respuesta trae el desplegable Cómo llegué a esto, con los pasos que dio. Úsalo para cruzar una cifra antes de firmarla.' },
    ],
  },
};
