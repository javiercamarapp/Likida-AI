'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Save } from 'lucide-react';
import { AvisoResultado, Boton, CampoArchivo, CampoSelect, CampoTexto, Fieldset, Icono, type AccionDeForma, type ResultadoAccion } from '@/app/ui-v2/componentes';
import './entrevista.css';
import { useT } from '@/lib/i18n/proveedor';
import { resto as restoEs } from '@/lib/i18n/es/resto';
import { type TResto, T_RESTO_ES } from '@/lib/i18n/resto_tr';

export type Opcion = { valor: string; texto: string };

function BotonGuardar() {
  const { t } = useT('resto', restoEs);
  const { pending } = useFormStatus();
  return (
    <Boton type="submit" variante="primary" loading={pending} icono={<Icono icono={Save} />}>
      {pending ? 'Guardando…' : t('op.guardar_perfil_de_la_flota')}
    </Boton>
  );
}

/** Un selector del formulario: etiqueta, opciones y valor inicial (el nombre del campo es también su id). */
function Selector({ nombre, etiqueta, opciones, valorInicial, requerido, ayuda }: {
  nombre: string; etiqueta: string; opciones: Opcion[]; valorInicial?: string; requerido?: boolean; ayuda?: string;
}) {
  return (
    <CampoSelect etiqueta={etiqueta} id={nombre} name={nombre} obligatorio={requerido} defaultValue={valorInicial ?? ''} ayuda={ayuda}>
      {opciones.map((o) => <option key={o.valor} value={o.valor}>{o.texto}</option>)}
    </CampoSelect>
  );
}

const siNo = (t: TResto = T_RESTO_ES): Opcion[] => ([
  { valor: '', texto: t('op.elige_una') },
  { valor: 'si', texto: t('op.si') },
  { valor: 'no', texto: 'No' },
]);

// AUDITORÍA 28 (FIS-C1, mitad quirúrgica): antes esto era un selector sí/no
// que el dueño podía marcar "sí" de buena fe sin saber si su régimen
// realmente califica — la misma puerta que la entrevista conversacional ya
// cerró en entrevista.ts (parseRegimenSat + el cálculo de elegible ahí
// mismo). Aquí se pide la clave SAT real y `regimenElegible` se deriva de
// ella, nunca de lo que el dueño crea que aplica.
const regimenSatTr = (t: TResto = T_RESTO_ES): Opcion[] => ([
  { valor: '', texto: t('op.elige_una') },
  { valor: '601', texto: t('op.601_general_de_ley_personas_morales') },
  { valor: '603', texto: t('op.603_personas_morales_con_fines_no') },
  { valor: '612', texto: t('op.612_personas_fisicas_con_actividades_empresariales') },
  { valor: '621', texto: t('op.621_incorporacion_fiscal') },
  { valor: '624', texto: t('op.624_coordinados') },
  { valor: '626', texto: t('op.626_resico') },
]);

export function FormaOnboarding({
  accion, gps, erp, tag, monedero, inicial,
}: {
  accion: AccionDeForma;
  gps: Opcion[];
  erp: Opcion[];
  tag: Opcion[];
  monedero: Opcion[];
  inicial: {
    ingresos: string;
    parte: string;
    gps: string;
    erp: string;
    tag: string;
    monedero: string;
    pagoOperador: string;
    dedicacion: string;
    regimenSat: string;
    dedicado: string;
    hombreCamion: string;
    tanquePropio: string;
  };
}) {
  const { t } = useT('resto', restoEs);
  const [estado, enviar] = useActionState(accion, null as ResultadoAccion);

  return (
    <form action={enviar} encType="multipart/form-data" className="rv-ob__forma">
      <Fieldset leyenda={t('op.fiscal_lo_que_ningun_comprobante_revela')}
        ayuda={t('op.estas_dos_son_las_unicas_obligatorias')}>
        <div className="rv-forma__rejilla">
          <Selector nombre="ingresos" etiqueta={t('op.ingresos_anuales_del_ultimo_ejercicio')} requerido
            valorInicial={inicial.ingresos}
            opciones={[
              { valor: '', texto: t('op.elige_una') },
              { valor: 'menor', texto: t('op.menores_a_300_millones') },
              { valor: 'mayor', texto: t('op.300_millones_o_mas') },
            ]}
            ayuda={t('op.lif_2026_art_20_a_300')} />
          <Selector nombre="parte" etiqueta={t('op.es_parte_relacionada_de_otra_empresa')} requerido
            valorInicial={inicial.parte} opciones={siNo(t)} />
          {/* AUDITORÍA 19 (fiscal F3): la RFA 2026 regla 2.9 exige carga
              FEDERAL específicamente — no cualquier carga (local/municipal
              no califica). Este formulario decía solo "carga", mientras la
              entrevista conversacional (perfil/entrevista.ts) ya decía
              "carga federal" — dos onboardings, dos preguntas distintas
              para la misma facilidad. Una flota de carga local podía
              contestar "sí" de buena fe y quedar declarada elegible al 15%
              sin serlo.
              AUDITORÍA 28 (FIS-M1, MEDIO): esta etiqueta agregó "/ pasaje /
              turismo" en esa misma corrección, y era falso: el texto
              VERIFICADO de la regla 2.9 (normas/rfa-2026-2.9.yaml,
              verificado_fuente_primaria) dice SOLO "carga federal" — igual
              que 2.1 y 2.2. Pasaje y turismo foráneo son materia de la RFA
              3.12, que NO tiene ficha en este repo. Se quita "pasaje /
              turismo" fail-closed: una flota de pasaje/turismo deja de abrir
              la 2.9 hasta que exista ficha 3.12. */}
          <Selector nombre="dedicacion" etiqueta={t('op.dedicacion_exclusiva_al_autotransporte_terrestre_de')}
            valorInicial={inicial.dedicacion} opciones={siNo(t)} ayuda={t('op.rfa_2026_regla_2_9_exige')} />
          <Selector nombre="regimenSat" etiqueta={t('op.regimen_fiscal_clave_sat_c_regimenfiscal')}
            valorInicial={inicial.regimenSat} opciones={regimenSatTr(t)} ayuda={t('op.la_facilidad_del_15_en_efectivo')} />
          <Selector nombre="dedicado" etiqueta={t('op.hacen_transporte_dedicado')}
            valorInicial={inicial.dedicado} opciones={siNo(t)} ayuda={t('op.la_rmf_2_7_7_1')} />
          <Selector nombre="hombreCamion" etiqueta={t('op.hay_hombre_camion_el_dueno_maneja')}
            valorInicial={inicial.hombreCamion} opciones={siNo(t)} ayuda={t('op.con_hombre_camion_los_viaticos_son')} />
        </div>
      </Fieldset>

      <Fieldset leyenda={t('op.stack_con_que_trabajan_hoy')}
        ayuda={t('op.solo_lo_que_el_catalogo_de')}>
        <div className="rv-forma__rejilla">
          <Selector nombre="gps" etiqueta={t('op.gps_rastreo')} valorInicial={inicial.gps} opciones={gps} />
          <Selector nombre="erp" etiqueta={t('op.erp_contabilidad')} valorInicial={inicial.erp} opciones={erp} />
          <Selector nombre="tag" etiqueta={t('op.tag_de_peaje')} valorInicial={inicial.tag} opciones={tag} />
          <Selector nombre="monedero" etiqueta={t('op.monedero_de_diesel')} valorInicial={inicial.monedero} opciones={monedero} />
          <CampoTexto etiqueta={t('op.si_marcaste_otro_cual')} id="stackOtro" name="stackOtro" placeholder={t('op.nombre_del_sistema')} />
        </div>
      </Fieldset>

      <Fieldset leyenda={t('op.operacion')}>
        <div className="rv-forma__rejilla">
          <Selector nombre="pagoOperador" etiqueta={t('op.como_le_pagan_al_operador')}
            valorInicial={inicial.pagoOperador}
            opciones={[
              { valor: '', texto: t('op.elige_una') },
              { valor: 'viaje', texto: t('op.por_viaje') },
              { valor: 'km', texto: t('op.por_kilometro') },
              { valor: 'sueldo', texto: t('op.sueldo') },
            ]} />
          <Selector nombre="tanquePropio" valorInicial={inicial.tanquePropio} etiqueta={t('op.tienen_tanque_propio')} opciones={siNo(t)} />
        </div>
      </Fieldset>

      <Fieldset leyenda={t('op.politicas_de_gasto')}
        ayuda={t('op.los_topes_que_el_motor_aplica')}>
        <CampoArchivo etiqueta={t('op.documento_pdf_jpeg_o_png_maximo')} id="politica" name="politica"
          accept="application/pdf,image/jpeg,image/png,image/webp" />
      </Fieldset>

      <AvisoResultado estado={estado} />
      <div><BotonGuardar /></div>
    </form>
  );
}
