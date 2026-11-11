import { catalogoConsulta, fasesPensando } from './respuestas';
import type { ModoAgente } from './motor';
import { type TResto, T_RESTO_ES } from '@/lib/i18n/resto_tr';

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

export const perfilCliente = (t: TResto = T_RESTO_ES): PerfilAgente => ({
  textos: {
    titulo: t('ch.pregunta_a_tus_datos'),
    subtitulo: t('ch.tu_operacion_con_la_cifra_que'),
    placeholder: t('op.pregunta_sobre_tu_operacion'),
    etiquetaFormulario: t('ch.preguntar_a_tus_datos'),
    etiquetaCampo: t('op.pregunta_sobre_tu_operacion_2'),
    chips: [
      { texto: t('ch.cifras_calculadas_por_el_motor'), ayuda: t('ch.las_cifras_salen_del_motor_de') },
      { texto: t('ch.sin_consultas_libres_a_la_base'), ayuda: t('ch.la_ia_lee_tus_cifras_con') },
    ],
    pie: t('ch.responde_con_cifras_ya_calculadas_en'),
  },
  temas: catalogoConsulta(t),
  endpoint: '/api/dashboard/chat',
  fases: fasesPensando(t),
  acciones: false,
  adjuntos: true,
});
export const PERFIL_CLIENTE = perfilCliente();

export const perfilSuperadmin = (t: TResto = T_RESTO_ES): PerfilAgente => ({
  textos: {
    titulo: t('ch.copiloto'),
    subtitulo: t('ch.la_compania_entera_con_la_cifra'),
    placeholder: t('ch.pregunta_sobre_la_compania_o_pide'),
    etiquetaFormulario: t('ch.preguntar_al_copiloto'),
    etiquetaCampo: t('ch.pregunta_al_copiloto'),
    chips: [
      { texto: t('ch.cada_cifra_trae_su_pantalla'), ayuda: t('ch.la_fuente_clicable_sale_de_las') },
      { texto: t('ch.tu_confirmas_cada_accion'), ayuda: t('ch.las_acciones_se_previsualizan_y_las') },
      { texto: t('ch.sin_consultas_libres_a_la_base'), ayuda: t('ch.el_copiloto_lee_con_herramientas_de') },
    ],
    pie: t('ch.toda_cifra_sale_de_una_consulta'),
  },
  temas: [
    { categoria: t('ch.negocio'), preguntas: [t('ch.como_va_el_negocio'), t('ch.por_que_subio_el_costo_de')] },
    { categoria: t('op.operacion'), preguntas: [t('ch.que_espera_decision_hoy'), t('ch.que_agentes_estan_apagados'), t('ch.que_debo_mirar_en_la_pantalla')] },
    { categoria: t('cfg.acciones'), preguntas: [t('ch.apaga_el_agente_de_cobranza'), t('ch.enciende_el_agente_de_cobranza')] },
  ],
  endpoint: '/api/admin/copiloto',
  fases: [
    [0, 'Pensando…'],
    [3000, t('ch.leyendo_la_operacion')],
    [9000, 'Cruzando cifras…'],
    [17000, 'Armando la respuesta…'],
    [30000, t('op.esto_esta_tardando_mas_de_lo')],
  ],
  acciones: true,
  adjuntos: false,
});
export const PERFIL_SUPERADMIN = perfilSuperadmin();

export const PERFILES: Record<ModoAgente, PerfilAgente> = { cliente: perfilCliente(), superadmin: perfilSuperadmin() };
/** Los perfiles en el idioma del traductor (los componentes leen este; `PERFILES` queda en español para quien no tiene `t`). */
export const perfiles = (t: TResto = T_RESTO_ES): Record<ModoAgente, PerfilAgente> => ({ cliente: perfilCliente(t), superadmin: perfilSuperadmin(t) });
