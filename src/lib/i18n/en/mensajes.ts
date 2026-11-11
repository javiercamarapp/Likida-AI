import type { mensajes as mensajesEs } from '../es/mensajes';
import { datosEn } from '../datos/en';

// «mensajes» in English (US). Keys must match es exactly.
export const mensajes: Record<keyof typeof mensajesEs, string> = {
  'err.sistema': 'Could not {operacion}, and it is not because of what you entered: it is a system failure and it has been logged. Try again; if it repeats, let Likida know.',
  'err.sistema.generico': 'The operation could not be completed, and it is not because of what you entered: it is a system failure and it has been logged. Try again; if it repeats, let Likida know.',

  'pp.escribe': 'Enter {queEs}.',
  'pp.escribe_monto': 'Enter the amount you paid.',
  'pp.monto_no_se_entiende': 'That amount is not understood. Write it with a period for cents and no thousands separators, like this: 1234.50',
  'pp.sin_saldo': 'We cannot show this invoice\'s balance right now, so we cannot record your payment either. Please try again in a few minutes.',
  'pp.fecha_no_se_entiende': 'The payment date is not understood. Use the calendar.',
  'pp.fecha_futura': 'The payment date cannot be later than today.',
  'pp.fecha_anterior': 'The payment date cannot be earlier than the invoice date ({fecha}). Check your bank receipt.',
  'pp.monto_cero': 'The amount must be greater than zero.',
  'pp.monto_excede': 'The outstanding balance of this invoice is {saldo}. If you overpaid, or if that deposit covers several invoices, write directly to whoever issued it: only the payment for THIS invoice can be recorded here.',
  'pp.referencia_falta': 'Enter your payment\'s bank reference (the tracking key, transaction number or deposit folio). Without it no one can find the transaction.',
  'pp.referencia_larga': 'The reference cannot be longer than {max} characters.',
  'pp.metodo_falta': 'Choose how you paid.',

  'pago.api.grande': 'Submission too large.',
  'pago.api.intentos': 'Too many attempts. Wait a few minutes and try again.',
  'pago.api.cuerpo_grande': 'The request body is too large.',
  'pago.api.no_se_entendio': 'The submission was not understood. Reload the page.',
  'pago.api.listo_carnada': 'Done. Your payment has been recorded.',
  'pago.api.no_consulta': 'We cannot look up your invoice right now. Please try again in a few minutes.',
  'pago.api.cancelada': 'That invoice was canceled, so a payment can no longer be recorded here. If you already paid it, write directly to whoever issued it.',
  'pago.api.sin_emitir': 'That invoice has not been issued yet, so a payment cannot be recorded here.',
  'pago.api.falla': 'We could not record your payment. Please try again.',
  'pago.api.repetida': 'That payment was already recorded with the same date, amount and reference, and is still pending confirmation. Nothing else is needed.',
  'pago.api.listo': 'Done. Your payment was recorded and we notified whoever issued the invoice. They still have to confirm it against their bank statement — when they do, you will see it right here.',

  'mk.intentos': 'Too many attempts. Wait a few minutes.',
  'mk.cuerpo_grande': 'The request body is too large.',
  'mk.cuerpo_invalido': 'Invalid request body.',
  'mk.sin_contacto': 'Leave us your email or your WhatsApp: without one of the two we have nowhere to send your copy.',
  'mk.falla': 'We could not record your details. Please try again in a moment.',

  'dash.otro_sitio': 'Request from another site.',
  'dash.cuerpo_grande': 'request body too large',
  'dash.cuerpo_invalido': 'invalid request body',
  'dash.mensajes_invalidos': 'invalid messages',
  'dash.chat.sin_presupuesto': 'I could not verify today\'s budget — the AI analysis is resting for a moment. Quick answers still work.',
  'dash.chat.tope': 'Today\'s AI analysis reached its daily cap (it exists to protect your cost). It renews on its own tomorrow; meanwhile, the catalog\'s quick answers still work.',
  'dash.archivo.tamano': 'The file is too large (max ~3 MB). Send me the part that matters —one sheet, a date range— and I will read it in full.',
  'dash.archivo.imagenes': 'images go to the receipt OCR (/api/dashboard/ingesta)',
  'dash.archivo.libro_grande': 'That workbook is too large to read safely. Turn it into a smaller file (fewer rows or sheets).',
  'dash.archivo.extension': 'I do not read {extension} files yet. I do read: PDF, Excel (xlsx/xls), CSV, CFDI XML, text — and receipt photos through the paperclip.',
  'dash.archivo.ilegible': 'the file could not be read — is it damaged or password-protected?',
  'dash.ingesta.tamano': 'The image is too large (max ~3 MB per photo). Retake it at normal quality or crop it to the receipt.',
  'dash.ingesta.sin_presupuesto': 'I could not verify today\'s budget; try again in a moment',
  'dash.ingesta.tope': 'the test reading reached its daily cap (it exists to protect your cost); it renews tomorrow',
  'dash.onb.ya_guardada': 'Your previous answer was already saved, so this question is a different one. I did not apply what you just wrote; check your profile if in doubt.\n\n{pregunta}',
  'dash.onb.nada_pendiente': 'That statement was already saved and nothing is pending. I did not apply what you just wrote.',
  'dash.onb.no_guardo': 'I could not save that statement',

  ...datosEn,
};
