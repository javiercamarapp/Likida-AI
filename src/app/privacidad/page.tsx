import { PaginaLegal, FaltaDato, type SeccionLegal } from '../legal/marco';

// ═══════════════════════════════════════════════════════════════════════════
// LA POLÍTICA DE PRIVACIDAD DE LIKIDA. 1-ago-2026.
//
// NO ES LA MISMA que `/aviso/[tenant]`, y confundirlas sería el error entero:
//
//   /aviso/[tenant]  → el aviso de la FLOTA sobre los datos de SUS operadores.
//                      Ahí la responsable es la flota (LFPDPPP art. 14) y Likida
//                      es persona encargada (art. 2 fr. XII).
//   /privacidad      → esta página. Los datos de quien CONTRATA Likida —el
//                      contralor, el administrador de la flota— tratados por
//                      Likida por su propia cuenta. Aquí la responsable es
//                      Likida.
//
// Dos documentos, dos responsables, dos conjuntos de titulares. Servir uno como
// el otro dejaría a un grupo entero sin aviso.
//
// POR QUÉ EXISTE AHORA: la app de Meta está en `dev_mode` con
// `privacy_policy_url: null`, y Meta exige una para pasarla a vivo. Sin eso, si
// el modo desarrollo restringe la mensajería a quien tiene rol en la app, un
// operador de la flota no puede escribirle a Likida — y eso se descubre en la
// sala.
//
// ⚠️ REVISAR ANTES DE PUBLICARLA COMO LA OFICIAL. Este texto está escrito contra
// el checklist de `docs/conocimiento/11-datos-personales.md` §5.4 y contra lo que
// el producto de verdad hace, pero es una declaración que hace una empresa. Los
// datos entre 🔴 son los que faltan y solo Javier puede poner.
// ═══════════════════════════════════════════════════════════════════════════

export const metadata = {
  title: 'Política de privacidad — Likida',
  description: 'Cómo trata Likida los datos personales de quienes contratan el servicio.',
};

const RESPONSABLE = {
  // 🔴 PENDIENTE: razón social y domicilio fiscal reales de la empresa que
  // opera Likida. Hasta que estén, la página lo DICE en vez de inventarlos —
  // mismo criterio que el aviso integral con el contacto del art. 29.
  razonSocial: null as string | null,
  domicilio: null as string | null,
  contacto: 'likida.ai@gmail.com',
};

const SECCIONES: SeccionLegal[] = [
  {
    titulo: 'Quién es responsable, y de qué datos exactamente',
    fundamento: 'LFPDPPP art. 15 fr. I · art. 14',
    parrafos: [
      `**Likida** es responsable de los datos personales de quien **contrata y usa el servicio**: la persona que administra la flota, el contralor, quien entra al panel.`,
      `**Los datos de los operadores son otra cosa.** Cuando un chofer manda sus comprobantes por WhatsApp, la responsable de esos datos es **su empresa**, no Likida: Likida los trata por cuenta de ella y siguiendo sus instrucciones, como persona encargada (art. 2 fr. XII). El aviso que le corresponde a cada operador lo publica su propia flota, y Likida lo aloja por encargo.`,
      `Si eres operador y llegaste aquí buscando tus datos, el aviso que te toca es el de tu empresa: escribe **PRIVACIDAD** por el mismo chat y te llega la liga.`,
      // AUDITORÍA 18 (C2): el tercer grupo de titulares. Likida también es
      // responsable de los datos de las personas a las que contacta para
      // VENDER, que no son clientes ni operadores; su aviso es otro.
      `**Y si Likida te contactó para ofrecerte el servicio y no eres cliente**, el aviso que te corresponde es el de contactos comerciales, en **/aviso/prospectos**: ahí dice de dónde salieron tus datos y cómo pedir que se borren.`,
    ],
  },
  {
    titulo: 'Qué datos se tratan',
    fundamento: 'LFPDPPP art. 15 fr. II',
    parrafos: [
      `Tu **nombre**, tu **correo** y tu **teléfono**.`,
      `Los **datos fiscales de tu empresa** que captures para que el sistema pueda validar facturas a su nombre: RFC, razón social, domicilio fiscal, régimen.`,
      // AUDITORÍA 18 (M8): el enlace de acceso es un dato que se trata —y que
      // sale por el proveedor de correo—; la fr. II obliga a enumerarlo.
      `El **enlace de acceso de un solo uso** que te llega por correo cada vez que entras: se genera para tu dirección, caduca en minutos y se invalida al usarlo.`,
      `**Registros técnicos de uso**: cuándo entras al panel, qué liquidaciones consultas y los errores que produce el sistema mientras lo usas.`,
      `**No se tratan datos sensibles**, ni se piden datos bancarios o de tarjeta.`,
    ],
  },
  {
    titulo: 'Para qué se usan',
    fundamento: 'LFPDPPP art. 15 fr. III',
    parrafos: [
      `**Necesarias — sin ellas no hay servicio:** darte acceso al panel, prestar el servicio de liquidación a tu flota, facturarte, y darte soporte cuando escribes.`,
      `**No necesarias, y puedes oponerte sin perder el servicio:** medir cómo se usa el producto para mejorarlo, y contactarte para avisarte de cambios o novedades.`,
      `Cualquier uso que no esté escrito aquí requiere que te lo pidamos otra vez. La ley vigente ya no admite ampararse en fines "compatibles o análogos".`,
    ],
  },
  {
    titulo: 'Con quién se comparten',
    fundamento: 'LFPDPPP art. 35 · art. 2 fr. XX',
    parrafos: [
      `**No se venden, y no se comparten con nadie para que los use por su cuenta.**`,
      `Pasan por proveedores que trabajan por instrucción de Likida y no pueden usarlos para otra cosa —lo que la ley llama personas encargadas, y que **no es una transferencia**—: alojamiento de aplicación y base de datos, mensajería de WhatsApp, **envío de correo** —tanto los avisos del panel como **el correo con el que entras**: por ese proveedor pasa tu dirección y el enlace de un solo uso que abre tu sesión—, monitoreo de errores, y los modelos de lenguaje que leen los comprobantes, a los que en cada llamada se les pide explícitamente que no retengan lo que procesan.`,
      `El detalle de esos subencargados está en la documentación del producto y se actualiza cuando cambia.`,
      `**Si algún día quisiéramos transferir tus datos para algo distinto, te lo pediríamos antes.** No hacer nada al leer esto no cuenta como haber aceptado.`,
    ],
  },
  {
    titulo: 'Cuánto tiempo se conservan',
    fundamento: 'CFF art. 30 · LFPDPPP art. 11',
    // E5 (auditoría 4): esta sección prometía «un año» y «cinco años» planos y
    // ninguna función ejecutaba ninguno de los dos. La regla es la misma que
    // para una cifra: la página solo promete plazos que algo ejecuta.
    //   · Los plazos operativos son los de `mantenimiento_de_datos` (migs.
    //     0072/0098/0101/0102/0104) — si una purga cambia, esta lista cambia.
    //   · El borrado de cuenta no tiene plazo automático: es a solicitud
    //     (sección siguiente), y decirlo es más honesto que prometer un año
    //     que nadie cuenta.
    //   · Y «cinco años» a secas era justo lo que `normas/cff-30.yaml`
    //     (limite_importante) prohíbe prometer: el propio artículo trae tres
    //     supuestos que lo alargan.
    parrafos: [
      `Tus datos de cuenta, mientras tengas el servicio. Al darte de baja no corre un plazo automático: se borran cuando lo pides —la sección siguiente dice cómo— y se te confirma por escrito.`,
      `**Los registros operativos del sistema sí tienen plazos que corren solos:** los registros técnicos de mensajes de WhatsApp ya procesados se borran a los 30 días; los de peticiones a la API, a los 7; los del intake por correo, a los 90; el historial de corridas de los agentes, el estado de conversaciones de WhatsApp sin actividad y los códigos de facturación que nunca encontraron su comprobante, a los 180.`,
      `**Lo fiscal es distinto y no se puede borrar antes:** los comprobantes y las liquidaciones se conservan **al menos cinco años** porque el Código Fiscal de la Federación lo obliga (art. 30) — y más tiempo cuando el propio artículo lo alarga: actos cuyos efectos fiscales se prolongan en el tiempo, conceptos con un recurso o juicio pendiente, y la documentación societaria mientras la sociedad exista. Esa obligación no la puede levantar ni tu solicitud ni nuestra voluntad, y se te dice aquí para que no te sorprenda después.`,
    ],
  },
  {
    titulo: 'Cómo ejercer tus derechos ARCO y revocar tu consentimiento',
    fundamento: 'LFPDPPP art. 15 fr. V · art. 7 último párrafo',
    parrafos: [
      `Tienes derecho a **Acceder** a tus datos, **Rectificarlos**, **Cancelarlos** y **Oponerte** a un uso concreto; y a revocar tu consentimiento en cualquier momento.`,
      `**Cómo:** escribe a **${RESPONSABLE.contacto}** con tu nombre, un medio para contestarte, copia de una identificación oficial, y qué datos son y qué pides que se haga con ellos.`,
      `**Plazos de la ley:** 20 días hábiles para contestarte y 15 días hábiles más para hacerlo efectivo si procede. Es gratuito; solo puede haber costo de envío o copia.`,
      `Si no te contestamos o la respuesta no te satisface, puedes acudir a la autoridad garante en materia de protección de datos personales.`,
    ],
  },
  {
    titulo: 'Cómo pedir que se borre tu cuenta',
    fundamento: 'Requisito de Meta para apps en producción',
    parrafos: [
      `Escribe a **${RESPONSABLE.contacto}** con el asunto **"Borrar mi cuenta"** desde el correo con el que te registraste.`,
      `Se borran tus datos de cuenta y de acceso. **Lo que no se puede borrar** son los comprobantes fiscales y las liquidaciones ya emitidas, por la conservación de al menos cinco años del CFF art. 30 — quedan sin vincularse a tu persona.`,
      `Se te confirma por escrito cuando queda hecho.`,
    ],
  },
  {
    titulo: 'Cómo se avisan los cambios a esta política',
    fundamento: 'LFPDPPP art. 15 fr. VI',
    parrafos: [
      `Los cambios se publican en esta misma página, y los relevantes se avisan al correo de tu cuenta antes de que apliquen.`,
      `Aquí siempre está la versión vigente.`,
    ],
  },
];

export default function Privacidad() {
  const faltan = !RESPONSABLE.razonSocial || !RESPONSABLE.domicilio;

  return (
    <PaginaLegal
      etiqueta="Política de privacidad"
      bajada="Ley Federal de Protección de Datos Personales en Posesión de los Particulares"
      secciones={SECCIONES}
      aviso={faltan ? (
        <FaltaDato>
          Falta capturar la razón social y el domicilio fiscal de la empresa que opera Likida.
          Aparece señalado en vez de quedar en blanco.
        </FaltaDato>
      ) : undefined}
      pie={
        <p>
          ¿Eres operador de una flota? Esta página no es tu aviso: el tuyo lo publica tu
          empresa. Escribe <strong style={{ color: 'var(--ink)' }}>PRIVACIDAD</strong> por el
          mismo chat de WhatsApp y te llega la liga.
        </p>
      }
    />
  );
}
