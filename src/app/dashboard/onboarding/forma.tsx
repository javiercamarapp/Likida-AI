'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Save } from 'lucide-react';
import { AvisoResultado, Boton, CampoArchivo, CampoSelect, CampoTexto, Fieldset, Icono, type AccionDeForma, type ResultadoAccion } from '@/app/ui-v2/componentes';
import './entrevista.css';

export type Opcion = { valor: string; texto: string };

function BotonGuardar() {
  const { pending } = useFormStatus();
  return (
    <Boton type="submit" variante="primary" loading={pending} icono={<Icono icono={Save} />}>
      {pending ? 'Guardando…' : 'Guardar perfil de la flota'}
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

const SI_NO: Opcion[] = [
  { valor: '', texto: 'Elige una' },
  { valor: 'si', texto: 'Sí' },
  { valor: 'no', texto: 'No' },
];

// AUDITORÍA 28 (FIS-C1, mitad quirúrgica): antes esto era un selector sí/no
// que el dueño podía marcar "sí" de buena fe sin saber si su régimen
// realmente califica — la misma puerta que la entrevista conversacional ya
// cerró en entrevista.ts (parseRegimenSat + el cálculo de elegible ahí
// mismo). Aquí se pide la clave SAT real y `regimenElegible` se deriva de
// ella, nunca de lo que el dueño crea que aplica.
const REGIMEN_SAT: Opcion[] = [
  { valor: '', texto: 'Elige una' },
  { valor: '601', texto: '601 — General de Ley Personas Morales' },
  { valor: '603', texto: '603 — Personas Morales con Fines no Lucrativos' },
  { valor: '612', texto: '612 — Personas Físicas con Actividades Empresariales y Profesionales' },
  { valor: '621', texto: '621 — Incorporación Fiscal' },
  { valor: '624', texto: '624 — Coordinados' },
  { valor: '626', texto: '626 — RESICO' },
];

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
  const [estado, enviar] = useActionState(accion, null as ResultadoAccion);

  return (
    <form action={enviar} encType="multipart/form-data" className="rv-ob__forma">
      <Fieldset leyenda="Fiscal — lo que ningún comprobante revela"
        ayuda="Estas dos son las únicas obligatorias. Sin ellas el estímulo de peaje queda en $0 hasta que las contestes — el motor nunca lo acredita sin esta declaración. El resto se puede dejar en blanco y completarlo después.">
        <div className="rv-forma__rejilla">
          <Selector nombre="ingresos" etiqueta="Ingresos anuales del último ejercicio" requerido
            valorInicial={inicial.ingresos}
            opciones={[
              { valor: '', texto: 'Elige una' },
              { valor: 'menor', texto: 'Menores a $300 millones' },
              { valor: 'mayor', texto: '$300 millones o más' },
            ]}
            ayuda="LIF 2026 art. 20-A. $300 millones exactos ya no califican." />
          <Selector nombre="parte" etiqueta="¿Es parte relacionada de otra empresa? (LISR art. 179)" requerido
            valorInicial={inicial.parte} opciones={SI_NO} />
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
          <Selector nombre="dedicacion" etiqueta="¿Dedicación exclusiva al autotransporte terrestre de carga federal?"
            valorInicial={inicial.dedicacion} opciones={SI_NO} ayuda="RFA 2026 regla 2.9: exige carga FEDERAL específicamente — la carga local/municipal no califica. Válvula del 15% de combustible en efectivo y del estímulo de peaje." />
          <Selector nombre="regimenSat" etiqueta="Régimen fiscal (clave SAT c_RegimenFiscal)"
            valorInicial={inicial.regimenSat} opciones={REGIMEN_SAT} ayuda="La facilidad del 15% en efectivo solo abre con 612 o 624 — se calcula de la clave, no de si crees que calificas. Si no estás seguro, déjalo en blanco." />
          <Selector nombre="dedicado" etiqueta="¿Hacen transporte dedicado?"
            valorInicial={inicial.dedicado} opciones={SI_NO} ayuda="La RMF 2.7.7.1.3 invierte los roles del complemento Carta Porte." />
          <Selector nombre="hombreCamion" etiqueta="¿Hay hombre-camión (el dueño maneja)?"
            valorInicial={inicial.hombreCamion} opciones={SI_NO} ayuda="Con hombre-camión los viáticos son práctica fiscal indebida. Nos protege a los dos." />
        </div>
      </Fieldset>

      <Fieldset leyenda="Stack — con qué trabajan hoy"
        ayuda="Solo lo que el catálogo de Likida sabe conectar. No se inventa un sistema que no esté aquí: si usas otro, márcalo como «Otro» y escríbelo.">
        <div className="rv-forma__rejilla">
          <Selector nombre="gps" etiqueta="GPS / rastreo" valorInicial={inicial.gps} opciones={gps} />
          <Selector nombre="erp" etiqueta="ERP / contabilidad" valorInicial={inicial.erp} opciones={erp} />
          <Selector nombre="tag" etiqueta="TAG de peaje" valorInicial={inicial.tag} opciones={tag} />
          <Selector nombre="monedero" etiqueta="Monedero de diésel" valorInicial={inicial.monedero} opciones={monedero} />
          <CampoTexto etiqueta="Si marcaste «Otro», ¿cuál?" id="stackOtro" name="stackOtro" placeholder="Nombre del sistema" />
        </div>
      </Fieldset>

      <Fieldset leyenda="Operación">
        <div className="rv-forma__rejilla">
          <Selector nombre="pagoOperador" etiqueta="¿Cómo le pagan al operador?"
            valorInicial={inicial.pagoOperador}
            opciones={[
              { valor: '', texto: 'Elige una' },
              { valor: 'viaje', texto: 'Por viaje' },
              { valor: 'km', texto: 'Por kilómetro' },
              { valor: 'sueldo', texto: 'Sueldo' },
            ]} />
          <Selector nombre="tanquePropio" valorInicial={inicial.tanquePropio} etiqueta="¿Tienen tanque propio?" opciones={SI_NO} />
        </div>
      </Fieldset>

      <Fieldset leyenda="Políticas de gasto"
        ayuda="Los topes que el motor aplica se capturan en Políticas (montos por concepto). Aquí puedes subir además el papel que ya usan (PDF o foto), para que quede en la memoria de la flota.">
        <CampoArchivo etiqueta="Documento (PDF, JPEG o PNG, máximo 8 MB)" id="politica" name="politica"
          accept="application/pdf,image/jpeg,image/png,image/webp" />
      </Fieldset>

      <AvisoResultado estado={estado} />
      <div><BotonGuardar /></div>
    </form>
  );
}
