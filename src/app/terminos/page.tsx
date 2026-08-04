// ═══════════════════════════════════════════════════════════════════════════
// TÉRMINOS DE SERVICIO DE LIKIDA. 4-ago-2026.
//
// `/terminos` daba 404 en los tres hosts y es uno de los cuatro huecos que
// impedían firmar un cliente. No es lo mismo que `/privacidad` (qué datos se
// tratan) ni que `/aviso/[tenant]` (el aviso que la flota le da a SUS choferes):
// esto es el CONTRATO de uso entre Likida y la empresa que la contrata.
//
// LA COBERTURA de secciones se modeló sobre usehandle.ai —mismo mercado, mismo
// canal (WhatsApp Business Platform), misma jurisdicción—, pero el TEXTO es
// propio y describe lo que Likida de verdad hace. Copiar sus términos habría
// puesto el nombre de Likida sobre las obligaciones, la entidad y la
// jurisdicción de otra empresa, y sobre un servicio que no es éste.
//
// LAS DOS CLÁUSULAS QUE MÁS IMPORTAN AQUÍ, y que no son de plantilla:
//
//   · §7 IA — el número lo calcula un motor determinístico, no el modelo. Es
//     la afirmación que sostiene el producto entero y tiene que estar por
//     escrito, no solo en el guion de venta.
//   · §16 Fiscal — Likida NO es contador ni despacho registrado, y el PDF no
//     es un dictamen del art. 52 CFF. Sin esto, un documento con artículos
//     citados al lado se lee como asesoría fiscal profesional.
//
// ⚠️ ES UN MODELO, NO ASESORÍA LEGAL. Los datos entre 🔴 solo los puede poner
// Javier, y hasta que estén la página lo DICE en vez de inventarlos.
// ═══════════════════════════════════════════════════════════════════════════

import { PaginaLegal, FaltaDato, type SeccionLegal } from '../legal/marco';

export const metadata = {
  title: 'Términos de servicio — Likida',
  description: 'Las condiciones bajo las que Likida presta el servicio de liquidación de viáticos.',
};

const PRESTADOR = {
  // 🔴 PENDIENTE: los mismos datos que faltan en /privacidad. Un contrato sin
  // la razón social de quien se obliga no obliga a nadie.
  razonSocial: null as string | null,
  domicilio: null as string | null,
  // 🔴 PENDIENTE: la plaza que decide la competencia (§19).
  jurisdiccion: null as string | null,
  contacto: 'likida.ai@gmail.com',
};

const SECCIONES: SeccionLegal[] = [
  {
    titulo: '1. Aceptación de los términos',
    parrafos: [
      `Al crear una cuenta, entrar al panel o mandar un comprobante por WhatsApp a un número de Likida, la empresa **acepta estos términos**. Si quien acepta lo hace a nombre de una persona moral, declara que tiene facultades para obligarla.`,
      `Si no está de acuerdo con alguna parte, la salida es no usar el servicio. No hay aceptación parcial: el servicio se presta completo o no se presta.`,
    ],
  },
  {
    titulo: '2. Qué es Likida y qué no es',
    parrafos: [
      `Likida recibe comprobantes de gasto de los operadores de una flota por WhatsApp, los lee, los **cuadra contra el anticipo entregado y contra la política de gastos de la propia empresa**, y entrega una liquidación en PDF con el fundamento fiscal de cada observación.`,
      `**Likida no es un despacho contable, ni un PAC, ni un asesor fiscal.** No timbra facturas, no presenta declaraciones, no dictamina estados financieros y no sustituye al contador de la empresa. Lo que entrega es un documento de trabajo, y así hay que tratarlo.`,
      `**Likida tampoco mueve dinero.** No dispersa anticipos, no paga a operadores y no cobra a los clientes de la flota. Los importes que calcula son informativos para quien sí hace esos pagos.`,
    ],
  },
  {
    titulo: '3. Cuentas, accesos y responsabilidad sobre ellos',
    parrafos: [
      `El acceso al panel es **por enlace mágico al correo** de cada persona autorizada. La empresa es responsable de mantener actualizada la lista de quién tiene acceso y de qué rol tiene cada quien, y de dar de baja a quien deja de trabajar ahí.`,
      `Los roles no son decorativos: el **encargado** no ve finanzas, el **contador** no despacha, y el **operador** solo ve sus propios viajes. Compartir una cuenta entre varias personas rompe esa separación y hace responsable a la empresa de lo que se haga desde ella.`,
      `Likida puede suspender un acceso concreto, sin aviso previo, si detecta que está siendo usado para algo distinto de lo que estos términos permiten.`,
    ],
  },
  {
    titulo: '4. Uso aceptable',
    parrafos: [
      `No se permite: mandar comprobantes de gastos que no correspondan a la operación de la flota; intentar leer datos de otra empresa; automatizar el envío de mensajes para saturar el canal; revender el servicio sin acuerdo por escrito; ni hacer ingeniería inversa del motor de cuadre.`,
      `Tampoco se permite usar Likida para **documentar operaciones simuladas** ni para respaldar deducciones que la empresa sabe improcedentes. Likida marca lo que detecta, pero no valida la realidad de una operación, y usarla como cobertura de una que no ocurrió es responsabilidad de quien la registra.`,
    ],
  },
  {
    titulo: '5. Suscripción, facturación y pagos',
    parrafos: [
      `El servicio se contrata por **suscripción**, con el plan y el precio que se pacten por escrito. Los planes tienen límites de viajes liquidados y de operadores; al rebasarlos, Likida lo avisa antes de cobrar cualquier diferencia.`,
      `🔴 **Precios, periodicidad y condiciones de pago: pendientes de definir.** Esta sección se completa cuando exista la lista de precios vigente. Hasta entonces, lo que rige es lo pactado por escrito en cada caso, y esta página no fija cifra alguna.`,
      `La falta de pago faculta a Likida a **suspender el servicio**, previo aviso. La suspensión no borra la información: la empresa conserva su derecho a exportarla conforme a la §6.`,
    ],
  },
  {
    titulo: '6. De quién son los datos',
    fundamento: 'LFPDPPP art. 2 fr. XX · CFF art. 30',
    parrafos: [
      `**La información es de la empresa.** Sus viajes, sus comprobantes, sus liquidaciones y sus PDF le pertenecen. Likida los trata para prestar el servicio y por instrucción suya, como **encargado del tratamiento**, no como dueño.`,
      `La empresa puede **exportar su información** en cualquier momento desde el panel. Al terminar la relación, Likida conserva lo que la ley obliga a conservar y elimina el resto; los plazos de conservación están en la política de privacidad.`,
      `**Likida no vende la información ni la comparte con terceros** para fines propios. Lo que sí hace es procesarla con los proveedores de infraestructura y modelos que la política de privacidad enumera.`,
    ],
  },
  {
    titulo: '7. Inteligencia artificial: qué decide el modelo y qué no',
    parrafos: [
      `Likida usa modelos de IA para **leer las fotos de los comprobantes y para conversar** con el operador. Esa es toda su función.`,
      `**Ningún importe lo calcula la IA.** Los totales, las diferencias contra el anticipo y las observaciones fiscales las produce un **motor determinístico** con reglas escritas y auditables. Existe además una verificación en el código que compara lo que el modelo va a decir contra lo que el motor calculó: **si no coinciden, gana el motor** y el mensaje no sale.`,
      `Aun así, la lectura de una foto puede equivocarse: un ticket borroso, una fecha mal impresa o un monto cortado producen datos incorrectos. Por eso cada liquidación marca lo que quedó **por confirmar** y por eso la revisión humana antes de usarla en contabilidad no es opcional.`,
    ],
  },
  {
    titulo: '8. Propiedad intelectual',
    parrafos: [
      `El software, el motor de reglas, las fichas normativas y la marca **Likida** son propiedad de quien presta el servicio. La suscripción concede un derecho de uso, no una cesión.`,
      `Lo que la empresa produce usando Likida —sus liquidaciones, sus PDF, sus reportes— es suyo y puede usarlo sin restricción.`,
    ],
  },
  {
    titulo: '9. Disponibilidad y soporte',
    parrafos: [
      `Likida hace un esfuerzo razonable por mantener el servicio disponible, pero **no ofrece un nivel de servicio garantizado** salvo que se pacte por escrito. El servicio depende de infraestructura de terceros que puede fallar.`,
      `El soporte se da por los canales que Likida publique. 🔴 **Tiempos de respuesta comprometidos: pendientes de definir.**`,
    ],
  },
  {
    titulo: '10. Servicios de terceros de los que Likida depende',
    parrafos: [
      `El servicio no funciona solo. Depende, al menos, de: **WhatsApp Business Platform** (Meta) como canal de mensajes, proveedores de **modelos de IA** para leer comprobantes, el **servicio de verificación de CFDI del SAT**, e infraestructura de nube para alojar y procesar.`,
      `Una caída, un cambio de política o una suspensión de cuenta en cualquiera de ellos **afecta a Likida y está fuera de su control**. En particular, Meta puede restringir o suspender el canal de WhatsApp conforme a sus propias políticas, y esa decisión no es de Likida.`,
      `Cuando el SAT no responde, la liquidación **no se detiene**: el comprobante queda marcado como pendiente de verificación y el proceso sigue. Es comportamiento diseñado, no una falla.`,
    ],
  },
  {
    titulo: '11. Confidencialidad',
    parrafos: [
      `Cada parte guarda como confidencial la información de la otra a la que tenga acceso, y la usa solo para lo necesario. La obligación sigue viva después de terminar la relación.`,
      `No es confidencial lo que ya era público, lo que se conocía antes sin obligación de reserva, o lo que una autoridad competente exija — en cuyo caso se avisa a la otra parte, salvo que la ley lo impida.`,
    ],
  },
  {
    titulo: '12. Garantías y su exclusión',
    parrafos: [
      `El servicio se presta **"tal como está"**. Likida no garantiza que el resultado sea exacto en todos los casos, ni que la lectura de un comprobante sea siempre correcta, ni que el criterio fiscal que aplica coincida con el que sostenga la autoridad.`,
      `Lo que sí sostiene Likida es lo que dice en el papel: cada observación cita la norma en la que se apoya, y esa cita se puede verificar.`,
    ],
  },
  {
    titulo: '13. Límite de responsabilidad',
    parrafos: [
      `La responsabilidad de Likida por cualquier reclamación relacionada con el servicio se limita, como máximo, a **lo que la empresa haya pagado por el servicio en los doce meses anteriores** al hecho que la origine.`,
      `Likida **no responde por daños indirectos**: lucro cesante, pérdida de oportunidad, multas, recargos o créditos fiscales determinados a la empresa, ni por decisiones que la empresa tome con base en la información del panel sin la revisión de su contador.`,
      `Nada de esta sección limita la responsabilidad que la ley no permita limitar.`,
    ],
  },
  {
    titulo: '14. Indemnización',
    parrafos: [
      `La empresa mantiene a Likida a salvo de reclamaciones de terceros derivadas de: información que la empresa haya cargado sin tener derecho a hacerlo; el uso del servicio en contra de la §4; o el incumplimiento de la empresa frente a sus propios operadores en materia de datos personales.`,
    ],
  },
  {
    titulo: '15. Vigencia y terminación',
    parrafos: [
      `La relación dura mientras la suscripción esté vigente. **Cualquiera de las dos partes puede terminarla** avisando por escrito con la anticipación que se haya pactado.`,
      `Likida puede terminarla de inmediato si hay uso en contra de la §4, o si la falta de pago se prolonga tras el aviso.`,
      `Al terminar, la empresa tiene un plazo razonable para **exportar su información** antes de que se elimine.`,
    ],
  },
  {
    titulo: '16. Naturaleza fiscal de lo que Likida entrega',
    fundamento: 'CFF art. 52 · LISR art. 27 y 28',
    parrafos: [
      `El PDF de liquidación es un **documento de trabajo generado automáticamente** a partir de reglas fiscales vigentes, citadas junto a cada partida. **No constituye un dictamen** en términos del artículo 52 del Código Fiscal de la Federación, ni la opinión de un contador público registrado.`,
      `Los criterios que Likida aplica **pueden diferir** de los que dé a conocer el SAT. La empresa debe validar cada partida con su contador antes de usarla en su contabilidad o en una declaración.`,
      `La obligación de conservar los comprobantes fiscales y de determinar correctamente sus contribuciones **sigue siendo de la empresa**, y no se traslada a Likida por usar el servicio.`,
    ],
  },
  {
    titulo: '17. Datos personales de los operadores',
    fundamento: 'LFPDPPP art. 14 y art. 2 fr. XX',
    parrafos: [
      `Los operadores mandan datos personales por WhatsApp. Frente a ellos, la **responsable es la empresa**; Likida es **encargado** y los trata siguiendo sus instrucciones.`,
      `Eso significa dos obligaciones concretas de la empresa: **publicar su propio aviso de privacidad** a sus operadores (Likida lo aloja en \`/aviso/<flota>\` y lo entrega por el chat cuando el operador escribe PRIVACIDAD), y **designar a quien atienda los derechos ARCO**.`,
      `El encargo se documenta por escrito, como pide la ley. 🔴 **El contrato de encargado del tratamiento está pendiente de firma.**`,
    ],
  },
  {
    titulo: '18. Cambios a estos términos',
    parrafos: [
      `Likida puede modificar estos términos. Los cambios relevantes se avisan por el panel o por correo con antelación razonable, y la fecha de vigencia de arriba se actualiza.`,
      `Seguir usando el servicio después de un cambio cuenta como aceptación. Quien no esté de acuerdo puede terminar conforme a la §15.`,
    ],
  },
  {
    titulo: '19. Ley aplicable y competencia',
    parrafos: [
      `Estos términos se rigen por las **leyes de los Estados Unidos Mexicanos**.`,
      `🔴 **Plaza y tribunales competentes: pendientes de definir.** Hasta que se fije, las partes se someten a la jurisdicción que corresponda conforme a la ley, renunciando a cualquier otra por razón de domicilio presente o futuro.`,
    ],
  },
  {
    titulo: '20. Disposiciones generales',
    parrafos: [
      `Si una cláusula resulta inválida, el resto sigue en vigor. La tolerancia ante un incumplimiento no implica renuncia a exigirlo después.`,
      `La empresa no puede ceder estos términos sin consentimiento de Likida; Likida sí puede cederlos a un sucesor de su negocio, avisando.`,
    ],
  },
  {
    titulo: '21. Contacto',
    parrafos: [
      `Para cualquier asunto relacionado con estos términos: **${PRESTADOR.contacto}**.`,
    ],
  },
];

export default function Terminos() {
  const faltan = !PRESTADOR.razonSocial || !PRESTADOR.domicilio || !PRESTADOR.jurisdiccion;

  return (
    <PaginaLegal
      etiqueta="Términos de servicio"
      bajada="Condiciones de uso del servicio de liquidación de viáticos"
      secciones={SECCIONES}
      aviso={faltan ? (
        <FaltaDato>
          Faltan por capturar la <strong>razón social</strong>, el <strong>domicilio fiscal</strong> y
          la <strong>plaza competente</strong> de la empresa que presta Likida, además de la lista de
          precios. Aparecen señalados con 🔴 dentro del texto en vez de quedar en blanco: un contrato
          sin la razón social de quien se obliga no obliga a nadie.
        </FaltaDato>
      ) : undefined}
      pie={
        <p>
          ¿Eres operador de una flota? Estos términos son entre Likida y tu empresa. El aviso de
          privacidad que te toca lo publica ella: escribe{' '}
          <strong style={{ color: 'var(--ink)' }}>PRIVACIDAD</strong> por el mismo chat de WhatsApp y
          te llega la liga.
        </p>
      }
    />
  );
}
