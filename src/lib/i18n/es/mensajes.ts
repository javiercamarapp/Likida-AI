// Namespace «mensajes»: los textos de error y de respuesta que llegan a pantalla desde la lógica (lib) y desde las rutas de API
// que consume la interfaz: `DatoInvalido` por clave, el mensaje genérico de falla del sistema, el portal de pago, el formulario de
// la calculadora y los endpoints del chat/archivo/OCR del panel. La baja de correo es de la prospección en frío (español).
// Fuente de verdad en español; `en/mensajes.ts` lo espeja. NO entran: errores/códigos para integradores (API v1, OpenAPI, cron,
// webhooks), mensajes del SAT/PAC y datos del cliente.
export const mensajes = {
  // ── falla del sistema (mensajeParaPantalla) ────────────────────────────────
  'err.sistema': 'No se pudo {operacion}, y no es por lo que capturaste: es una falla del sistema y quedó registrada. Vuelve a intentarlo; si se repite, avísale a Likida.',
  'err.sistema.generico': 'No se pudo completar la operación, y no es por lo que capturaste: es una falla del sistema y quedó registrada. Vuelve a intentarlo; si se repite, avísale a Likida.',

  // ── portal de pago: validación de lo que tecleó el cliente de la flota ─────
  'pp.escribe': 'Escribe {queEs}.',
  'pp.escribe_monto': 'Escribe el monto que pagaste.',
  'pp.monto_no_se_entiende': 'Ese monto no se entiende. Escríbelo con punto para los centavos y sin puntos de millares, así: 1234.50',
  'pp.sin_saldo': 'Ahora mismo no podemos mostrar el saldo de esta factura, así que tampoco podemos registrar tu pago. Vuelve a intentarlo en unos minutos.',
  'pp.fecha_no_se_entiende': 'La fecha del pago no se entiende. Usa el calendario.',
  'pp.fecha_futura': 'La fecha del pago no puede ser posterior a hoy.',
  'pp.fecha_anterior': 'La fecha del pago no puede ser anterior a la de la factura ({fecha}). Revisa el comprobante de tu banco.',
  'pp.monto_cero': 'El monto tiene que ser mayor que cero.',
  'pp.monto_excede': 'El saldo pendiente de esta factura es {saldo}. Si pagaste de más, o si ese depósito cubre varias facturas, escríbele directamente a quien te la emitió: aquí solo se puede registrar el pago de ESTA factura.',
  'pp.referencia_falta': 'Escribe la referencia bancaria de tu pago (la clave de rastreo, el número de operación o el folio del depósito). Sin ella nadie puede encontrar el movimiento.',
  'pp.referencia_larga': 'La referencia no puede pasar de {max} caracteres.',
  'pp.metodo_falta': 'Elige cómo pagaste.',

  // ── /api/pago/registrar ────────────────────────────────────────────────────
  'pago.api.grande': 'Envío demasiado grande.',
  'pago.api.intentos': 'Demasiados intentos. Espera unos minutos y vuelve a intentarlo.',
  'pago.api.cuerpo_grande': 'El cuerpo es demasiado grande.',
  'pago.api.no_se_entendio': 'No se entendió el envío. Recarga la página.',
  'pago.api.listo_carnada': 'Listo. Ya quedó registrado tu pago.',
  'pago.api.no_consulta': 'Ahora mismo no podemos consultar tu factura. Vuelve a intentarlo en unos minutos.',
  'pago.api.cancelada': 'Esa factura fue cancelada, así que aquí ya no se puede registrar un pago. Si ya la pagaste, escríbele directamente a quien te la emitió.',
  'pago.api.sin_emitir': 'Esa factura todavía no está emitida, así que aquí no se puede registrar un pago.',
  'pago.api.falla': 'No pudimos registrar tu pago. Vuelve a intentarlo.',
  'pago.api.repetida': 'Ese pago ya estaba registrado con la misma fecha, monto y referencia, y sigue por confirmar. No hace falta hacer nada más.',
  'pago.api.listo': 'Listo. Tu pago quedó registrado y le avisamos a quien te emitió la factura. Todavía tiene que confirmarlo contra su estado de cuenta — cuando lo haga, lo verás aquí mismo.',

  // ── /api/marketing/prospecto (formulario de la calculadora) ────────────────
  'mk.intentos': 'Demasiados intentos. Espera unos minutos.',
  'mk.cuerpo_grande': 'El cuerpo es demasiado grande.',
  'mk.cuerpo_invalido': 'Cuerpo inválido.',
  'mk.sin_contacto': 'Déjanos tu correo o tu WhatsApp: sin uno de los dos no hay a dónde mandarte tu copia.',
  'mk.falla': 'No pudimos registrar tus datos. Inténtalo de nuevo en un momento.',

  // ── /api/dashboard/{chat,archivo,ingesta,onboarding-chat} ──────────────────
  'dash.otro_sitio': 'Petición de otro sitio.',
  'dash.cuerpo_grande': 'cuerpo demasiado grande',
  'dash.cuerpo_invalido': 'cuerpo inválido',
  'dash.mensajes_invalidos': 'mensajes inválidos',
  'dash.chat.sin_presupuesto': 'No pude verificar el presupuesto del día — el análisis con IA descansa un momento. Las respuestas rápidas siguen funcionando.',
  'dash.chat.tope': 'El análisis con IA de hoy llegó a su tope diario (existe para cuidar tu costo). Mañana se renueva solo; mientras, las respuestas rápidas del catálogo siguen funcionando.',
  'dash.archivo.tamano': 'El archivo pesa demasiado (máx ~3 MB). Mándame la parte que importa —una hoja, un rango de fechas— y la leo completa.',
  'dash.archivo.imagenes': 'las imágenes van al OCR de comprobantes (/api/dashboard/ingesta)',
  'dash.archivo.libro_grande': 'Ese libro es demasiado grande para leerlo con seguridad. Pásalo a un archivo más chico (menos filas o hojas).',
  'dash.archivo.extension': 'Todavía no leo archivos {extension}. Sí leo: PDF, Excel (xlsx/xls), CSV, XML de CFDI, texto — y fotos de comprobantes por el clip.',
  'dash.archivo.ilegible': 'no se pudo leer el archivo — ¿está dañado o protegido con contraseña?',
  'dash.ingesta.tamano': 'La imagen pesa demasiado (máx ~3 MB de foto). Vuelve a tomarla en calidad normal o recórtala al ticket.',
  'dash.ingesta.sin_presupuesto': 'no pude verificar el presupuesto del día; inténtalo en un momento',
  'dash.ingesta.tope': 'la lectura de prueba llegó a su tope diario (existe para cuidar tu costo); mañana se renueva',
  'dash.onb.ya_guardada': 'Tu respuesta anterior ya se guardó, así que esta pregunta es otra. No apliqué lo que acabas de escribir; revisa tu perfil si dudas.\n\n{pregunta}',
  'dash.onb.nada_pendiente': 'Esa declaración ya se guardó y no queda nada pendiente. No apliqué lo que acabas de escribir.',
  'dash.onb.no_guardo': 'no pude guardar esa declaración',

} as const;
