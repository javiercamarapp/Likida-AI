import { CATALOGO_CONSULTA, FASES_PENSANDO } from './respuestas';
import type { ModoAgente } from './motor';

/** Un tema de la portada con sus preguntas: serializable, así que un componente de servidor puede pasarlo como prop. */
export interface TemaAgente { categoria: string; preguntas: string[] }

/** Un chip de la portada: solo se declara lo que es VERDAD para ese modo (la portada no afirma nada que el servidor no haga). */
export interface ChipAgente { texto: string; ayuda: string }

export interface TextosAgente {
  titulo: string;
  subtitulo: string;
  placeholder: string;
  etiquetaFormulario: string;
  etiquetaCampo: string;
  chips: ChipAgente[];
  pie: string;
}

/** Lo que cambia entre modos y NO viaja como prop: textos y temas por omisión, endpoints, fases del «pensando». Vive en el cliente. */
export interface PerfilAgente {
  textos: TextosAgente;
  temas: TemaAgente[];
  /** POST del chat. Las rutas de historial cuelgan de la ruta propia de cada adaptador. */
  endpoint: string;
  fases: Array<[number, string]>;
  /** El modo superadmin previsualiza acciones y las confirma el humano; el cliente no tiene acciones. */
  acciones: boolean;
  adjuntos: boolean;
}

export const PERFIL_CLIENTE: PerfilAgente = {
  textos: {
    titulo: 'Pregunta a tus datos',
    subtitulo: 'Tu operación, con la cifra que ya calculó el motor — y adjunta un PDF, un Excel o la foto de un comprobante para analizarlo aquí mismo.',
    placeholder: 'Pregunta sobre tu operación…',
    etiquetaFormulario: 'Preguntar a tus datos',
    etiquetaCampo: 'Pregunta sobre tu operación',
    chips: [
      { texto: 'Cifras calculadas por el motor', ayuda: 'Las cifras salen del motor de Likida, ya calculadas en el servidor.' },
      { texto: 'Sin consultas libres a la base', ayuda: 'La IA lee tus cifras con herramientas de consulta; no escribe consultas libres a la base de datos.' },
    ],
    pie: 'Responde con cifras ya calculadas en el servidor — en texto, tabla o gráfica según la pregunta. No traduce preguntas libres a consultas de base de datos, a propósito.',
  },
  temas: CATALOGO_CONSULTA,
  endpoint: '/api/dashboard/chat',
  fases: FASES_PENSANDO,
  acciones: false,
  adjuntos: true,
};

export const PERFIL_SUPERADMIN: PerfilAgente = {
  textos: {
    titulo: 'Copiloto',
    subtitulo: 'La compañía entera, con la cifra que ya calculó el motor — y las acciones gateadas que hoy exigen recorrer pantallas.',
    placeholder: 'Pregunta sobre la compañía, o pide una acción…',
    etiquetaFormulario: 'Preguntar al copiloto',
    etiquetaCampo: 'Pregunta al copiloto',
    chips: [
      { texto: 'Cada cifra trae su pantalla', ayuda: 'La fuente clicable sale de las consultas que de verdad corrieron, no de lo que diga el modelo.' },
      { texto: 'Tú confirmas cada acción', ayuda: 'Las acciones se previsualizan y las confirma el humano; el modelo nunca ejecuta.' },
      { texto: 'Sin consultas libres a la base', ayuda: 'El copiloto lee con herramientas de consulta; no escribe consultas libres a la base de datos.' },
    ],
    pie: 'Toda cifra sale de una consulta real y trae su pantalla fuente. Las acciones se previsualizan y TÚ confirmas — el modelo nunca ejecuta. No traduce preguntas libres a consultas de base de datos, a propósito.',
  },
  temas: [
    { categoria: 'Negocio', preguntas: ['¿Cómo va el negocio?', '¿Por qué subió el costo de IA?'] },
    { categoria: 'Operación', preguntas: ['¿Qué espera decisión hoy?', '¿Qué agentes están apagados?', '¿Qué debo mirar en la pantalla que tengo abierta?'] },
    { categoria: 'Acciones', preguntas: ['Apaga el agente de cobranza', 'Enciende el agente de cobranza'] },
  ],
  endpoint: '/api/admin/copiloto',
  fases: [
    [0, 'Pensando…'],
    [3000, 'Leyendo la operación…'],
    [9000, 'Cruzando cifras…'],
    [17000, 'Armando la respuesta…'],
    [30000, 'Esto está tardando más de lo normal…'],
  ],
  acciones: true,
  adjuntos: false,
};

export const PERFILES: Record<ModoAgente, PerfilAgente> = { cliente: PERFIL_CLIENTE, superadmin: PERFIL_SUPERADMIN };
