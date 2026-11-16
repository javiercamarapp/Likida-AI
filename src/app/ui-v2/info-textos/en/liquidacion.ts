import type { InfoTexto } from '../../info-catalogo';
import type { INFO_LIQUIDACION } from '../liquidacion';
import { V } from './constructores';

// English help texts (ⓘ): settlement, collections, invoices and suppliers agents. Same keys as ../liquidacion.ts.
export const INFO_LIQUIDACION_EN: Record<keyof typeof INFO_LIQUIDACION, InfoTexto> = {
  // ── Receipt collections: figures ────────────────────────────────────────────
  'cobranza.para_contactar': V(
    'To contact', 'Trips with a follow-up tier reached and a driver who has a phone number.',
    'Counts open or in-reconciliation trips that have a start date and a Likida notice sent to the driver. It calculates the days since the start date and takes the highest tier reached that has not yet been contacted. It counts trips, not drivers.',
    'Your fleet’s trips when the page opens; the tiers come from your saved strategy. A contact made at one tier also uses up the lower ones.',
    'Review the “Who it will contact” table or use Run now in that panel.',
  ),
  'cobranza.no_puede_contactar': V(
    'Cannot contact', 'Trips with a tier reached whose driver has no phone number on file.',
    'Same calculation as “To contact”, but the trip’s driver has no phone number. It does not count trips that have not reached any tier.',
    'Open or in-reconciliation trips of your fleet, when the page opens.',
    'Enter the driver’s phone number so the agent can write to them.',
  ),
  'cobranza.viajes_vigilados': V(
    'Trips being watched', 'Open or in-reconciliation trips that the agent is following.',
    'Counts open or in-reconciliation trips that have a start date and a Likida notice sent to the driver. It includes those that have not yet reached any tier.',
    'Your fleet’s trips when the page opens; trips without a Likida notice are not included.',
  ),
  'cobranza.estado': V(
    'Agent status', 'Whether the follow-up agent is active or paused, and its contact window.',
    'Shows the status of your saved configuration and the days and hours when it may write. The window declared in your fleet profile, if there is one, takes precedence over the one set here.',
    'Your fleet’s configuration. With no saved configuration, the agent uses the default values.',
    'Pause or reactivate the agent in the “Its strategy” panel.',
  ),
  // ── Receipt collections: panels ──────────────────────────────────────────────
  'cobranza.cola': V(
    'Who it will contact', 'The list of trips the agent will chase on its next run.',
    'It is the same queue as “To contact”: trips with a tier reached and a driver with a phone number, with the most overdue first. The Run now button runs the agent outside the window; a paused agent does not run even then.',
    'Open or in-reconciliation trips of your fleet when the page opens, with the strategy you saved. Operating it requires a role with access to the money area.',
    'Use Run now if you want to make contact outside business hours.',
  ),
  'cobranza.sin_telefono': V(
    'Who it cannot write to', 'Trips with a tier reached whose driver has no phone number on file.',
    'Lists the same trips counted by “Cannot contact”, with the days without a receipt. There is no extra calculation.',
    'Open or in-reconciliation trips of your fleet, when the page opens.',
    'Enter the driver’s phone number.',
  ),
  'cobranza.bitacora': V(
    'Contact log', 'The agent’s latest contact attempts, whether or not they were sent.',
    'Lists the 12 most recent collection contact records, ordered by date. It marks whether each one went out, and gives the detail when it did not. It does not summarize or group.',
    'Your fleet’s contact log, read when the page opens; if it could not be read, it says so instead of showing up empty.',
  ),
  'cobranza.estrategia': V(
    'Follow-up strategy', 'Form where you set when the agent chases, during which hours and in what words.',
    'It calculates nothing: it saves your day tiers, schedule, allowed days, a line of instructions and the signature. The preview builds the message with your data in the browser. On saving it validates: 1 to 5 distinct tiers of 1 to 60 days, an end time later than the start time, and at least one allowed day.',
    'Your fleet’s configuration. If the profile declares a contact window, that window takes precedence over the one saved here.',
    'Edit the fields and use Save strategy; use the pause button to stop the agent.',
  ),
  // ── Collections by expense ───────────────────────────────────────────────────
  'cobranza.gasto': V(
    'Collections by expense', 'Which receipt is missing for which expense and which driver is due a notice today.',
    'For each expense on an open or in-reconciliation trip with a Likida notice, it decides whether its receipt is missing (cancelled invoice, no photo or invoice, unreadable photo, or ticket without an invoice). It groups by driver: one message per driver, with a daily cap that you set.',
    'Expenses on your fleet’s open or in-reconciliation trips when the page opens. It starts switched off: until you turn it on, the agent collects by trip.',
    'Turn it on or adjust it in “Collections by expense settings”.',
  ),
  'cobranza.gasto_sin_comprobante': V(
    'Expenses without a receipt', 'Expenses on open or in-reconciliation trips that are missing their receipt.',
    'Counts all expenses with a missing receipt, whether or not they have reached a tier. A receipt is missing if the invoice is cancelled with the SAT, if there is neither a photo nor an invoice, if the photo reads below your threshold and there is no invoice, or if the expense type requires an invoice and none is attached.',
    'Expenses on open or in-reconciliation trips with a Likida notice, when the page opens. An expense with no measured photo reading is not accused of being unreadable.',
  ),
  'cobranza.gasto_les_toca_hoy': V(
    'Due today', 'Expenses with a missing receipt that have already reached a tier and whose driver has a phone number.',
    'Adds up the expenses grouped by drivers with a phone number whose tier of days since capture has been reached and who had not been contacted. The note counts the drivers: one message each.',
    'Your fleet’s expenses when the page opens, with the cadence you configured. It does not subtract the daily message cap: the figure is what is due, not what will go out.',
  ),
  'cobranza.gasto_sin_telefono': V(
    'No phone number', 'Expenses with a tier reached whose driver has no phone number on file.',
    'Adds up the expenses in a tier grouped by drivers with no phone number. They are shown, not lost.',
    'Your fleet’s expenses when the page opens.',
    'Enter the driver’s phone number.',
  ),
  'cobranza.gasto_avisos': V(
    'Notices in the last 30 days', 'Per-expense notices that did go out in the last 30 days.',
    'Counts the per-expense contact records with a successful send, created in the last 30 days. Those that did not go out are not counted. The note says how many are still open: neither resolved nor closed.',
    'Your fleet’s per-expense contact log. If it could not be read, the figure shows the error and not a zero.',
  ),
  'cobranza.gasto_efectividad': V(
    'Effectiveness', 'What share of notices ended with the receipt received.',
    'Divides the notices that ended with a receipt by the notices sent in the last 30 days. With fewer than 5 notices it does not publish a percentage and says there is little data. The median is the hours between the notice and the resolution.',
    'Your fleet’s per-expense notices in the last 30 days. A notice counts as resolved when the expense no longer has a missing receipt; that does not prove the notice was the cause.',
  ),
  'cobranza.gasto_faltantes': V(
    'What is missing, expense by expense', 'Table of each expense with a missing receipt, its reason and its next notice.',
    'Lists the same expenses counted by “Expenses without a receipt”, with the most overdue first and a maximum of 40 rows. “Due today” means it has reached a tier not yet contacted; “waiting for its tier” means it has not yet.',
    'Expenses on open or in-reconciliation trips of your fleet when the page opens.',
  ),
  'cobranza.gasto_efectividad_desglose': V(
    'Effectiveness by tier and by reason', 'How many notices produced the receipt, by day tier and by reason.',
    'Groups the notices sent in the last 30 days by tier and by reason, and counts in each group those that ended with a receipt. It adds how many notices ended with the trip closed and the receipt still missing.',
    'Your fleet’s per-expense notices. With no notices or no reading, it says so instead of showing zeros.',
  ),
  'cobranza.gasto_bitacora': V(
    'Latest per-expense notices', 'The most recent per-expense notices, whether or not they went out.',
    'Lists the 15 most recent per-expense contact records from the last 30 days, with driver, expense type, amount, reason, tier and whether it went out. It does not summarize or group.',
    'Your fleet’s per-expense contact log; if it could not be read, it says so.',
  ),
  'cobranza.gasto_config': V(
    'Collections by expense settings', 'Form to turn on collections by expense and set their cadence and caps.',
    'It calculates nothing: it saves whether it is on, the days of chasing since the expense was captured, the cap on messages per driver per day, the expense types that require an invoice and the photo reading threshold. On saving it validates that there are 1 to 5 distinct days, 1 to 3 daily messages and a threshold between 0.10 and 0.95.',
    'Your fleet’s configuration.',
    'Edit the fields and use Save collections by expense.',
  ),
  // ── Automatic invoices ───────────────────────────────────────────────────────
  'facturas.por_facturar': V(
    'To invoice', 'Expense tickets without a CFDI from the last 45 days, ready to be assigned.',
    'Counts your fleet’s expenses without a fiscal folio (CFDI), of a type other than “invoice”, dated within the last 45 days. Expenses without a date enter by their capture date. It includes overdue and incomplete ones.',
    'Your fleet’s expenses when the page opens. An expense dated earlier than that window does not appear here.',
  ),
  'facturas.monto_sin_factura': V(
    'Amount without an invoice', 'Sum in pesos of the tickets counted in “To invoice”.',
    'Adds up the amount of those same expenses, including overdue and incomplete ones. Without an invoice, the money has already left and the expense has no CFDI backing it.',
    'Your fleet’s expenses without a CFDI from the last 45 days, when the page opens.',
  ),
  'facturas.urgentes': V(
    'Urgent', 'Tickets whose deadline to invoice falls in 0 to 2 days.',
    'Counts tickets without a CFDI that have 0 to 2 days left. The deadline comes from the merchant identified on the ticket; with no merchant, the calendar month is used. Overdue ones are not counted here.',
    'Expenses without a CFDI from the last 45 days. For most merchants it is the deadline printed on the ticket, not a verified legal deadline.',
    'Review “Your turn” and enter first those that expire soonest.',
  ),
  'facturas.vencidos': V(
    'Overdue', 'Tickets whose deadline to invoice has already passed.',
    'Counts tickets without a CFDI whose deadline has passed, using the same per-merchant deadline as “Urgent”. An overdue ticket is reported as incomplete: neither the machine nor a person attempts it.',
    'Expenses without a CFDI from the last 45 days, when the page opens. A ticket without a legible date is not counted as overdue.',
  ),
  'facturas.te_toca': V(
    'Your turn', 'Tickets that need a person: the portal asks for your account or the machine hit a wall.',
    'Assigns each ticket using the agent’s routing rule. Included here are portal tickets that require an account, blocked ones (for example by a CAPTCHA) and those from portals the agent does not yet know how to operate. It shows up to 12 rows, with the nearest deadlines first, and states the total.',
    'Your fleet’s expenses without a CFDI. Entering the folio requires a role with access to the money area; the folio you type is validated for form, not against the SAT.',
    'Open the portal with the link on each row, invoice, and enter the folio on that row.',
  ),
  'facturas.hizo_solo': V(
    'What it did on its own', 'Expenses that already have an invoice attached, and the cases where the agent deliberately gave up.',
    'The number counts all of your fleet’s expenses with a fiscal folio, regardless of date: issued by the agent, taken from an XML that was sent, or entered by hand. Below it lists up to 5 blocked tickets with their reason.',
    'Your fleet’s expenses; if they could not be counted, it says so instead of showing zero. It is a historical total, not that of a period.',
  ),
  'facturas.maquina': V(
    'The machine handles it', 'Complete tickets, with no account involved, that go through the automatic queue.',
    'Counts and sums the tickets that routing sends to the agent: recognized portal, no account to ask for, required fields read, no block and a valid deadline. It lists the first 5.',
    'Your fleet’s expenses without a CFDI. The panel text says whether issuing is currently in rehearsal or issuing for real, according to your company’s mode and mandate.',
    'If issuing is in rehearsal, the owner grants the mandate in Terms and mandate.',
  ),
  'facturas.incompletos': V(
    'Incomplete', 'Tickets that cannot be invoiced with what is available, with what is missing.',
    'Counts and sums tickets with no recognized portal, with empty required fields, with an overdue deadline, or from merchants that invoice monthly against the account. It groups by each ticket’s first missing item and shows the 4 most frequent.',
    'Your fleet’s expenses without a CFDI from the last 45 days, when the page opens.',
    'Complete the missing data on the ticket; an overdue one can no longer be invoiced.',
  ),
  'facturas.por_comercio': V(
    'Without an invoice, by merchant', 'How the amount without an invoice is distributed among the identified merchants.',
    'Sums the amount of tickets without a CFDI by merchant. It shows the 4 largest and groups the rest under “Others”; tickets with no recognized merchant go under “Unidentified”.',
    'Your fleet’s expenses without a CFDI from the last 45 days, when the page opens.',
  ),
  // ── Automatic settlement (agent page) ────────────────────────────────────────
  'liquidacion.monto_comprobado': V(
    'Verified amount', 'Money from route expenses with a receipt, summed over your fleet’s entire history.',
    'Adds up the verified total of all your fleet’s settlements, with no date limit. It does not count rejected reviews. From one million up it is shown abbreviated.',
    'Your fleet’s settlements, read when the page opens. It is a historical total, not that of a period.',
  ),
  'liquidacion.tasa_cuadre': V(
    'Reconciliation rate', 'Percentage of settlements that the agent reconciled with no differences.',
    'Divides the settlements with “cuadrada” (reconciled) status by all settlements, rounded to a whole number. It does not count rejected reviews. With no settlements it shows 0%, which is not a measured rate.',
    'Your fleet’s settlements, over the entire history. The note below is the total number of settlements counted, not only the reconciled ones.',
  ),
  'liquidacion.por_revisar': V(
    'To review', 'Settlements that the agent could not reconcile.',
    'Counts the settlements in the entire history with “revisar” (review) status. It does not count rejected ones. It is an engine figure; the queue below counts what is awaiting signature and comes from its own query.',
    'Your fleet’s settlements, read when the page opens.',
    'Open the review queue on this same page.',
  ),
  'liquidacion.con_diferencias': V(
    'With differences', 'Settlements where the agent found differences.',
    'Counts the settlements in the entire history with “con diferencias” (with differences) status. It does not count rejected ones.',
    'Your fleet’s settlements, read when the page opens. It does not add up money: the amount is in “Money observed”.',
  ),
  'liquidacion.viajes_en_curso': V(
    'Trips in progress', 'A snapshot of right now of your trips by stage, and the total settled.',
    'Counts open trips and in-reconciliation trips. The “To review” bar is the figure for settlements to review shown above, not trips. Below, one line counts all settled trips, historical.',
    'Your fleet’s trips and settlements when the page opens. If they could not be counted, it says so instead of charting a zero.',
  ),
  'liquidacion.cierres_por_dia': V(
    'Closings per day', 'Calendar of the settlements created each day over the last 12 weeks.',
    'Counts settlements per Mexico City day in an 84-day window. It does not count rejected reviews. Each square is one day; the total appears below.',
    'Your fleet’s settlements, cut off by creation date. If it could not be read, it says so.',
  ),
  'liquidacion.hizo_solo': V(
    'What it did on its own', 'The agent’s recent reminders and escalations, plus historical totals of its work.',
    'Lists the 8 most recent stamps among verification reminders and escalated trips. It adds the receipts without a trip that it attached on its own and, at the bottom, the receipts read and the AI readings excluding chat, both historical.',
    'Stamps on your fleet’s trips, receipts with automatic reading, and the AI usage log. Each part that could not be read is omitted or reported.',
  ),
  'liquidacion.dinero_observado': V(
    'Money observed', 'Amount of all the differences the engine recorded, broken down by type.',
    'Adds up the absolute value of each difference recorded in the settlements, grouped by type, over the entire history. It does not count rejected ones. It includes all types, not only out-of-policy or duplicate expenses.',
    'Your fleet’s settlements, with no date filter. That is why it does not match other money-observed figures that count fewer types.',
  ),
  'liquidacion.por_operador': V(
    'Differences by driver', 'Drivers with the most settlements with a difference, with a label that does not reveal their name.',
    'Counts, per driver, the settlements with a difference. It shows up to 6 drivers with at least one, from highest to lowest. Rejected reviews do not count and drivers who objected to the automated decision do not appear.',
    'Your fleet’s settlements and drivers. The name is replaced by a stable pseudonym, not by the driver’s name.',
  ),
  'liquidacion.reglas': V(
    'Its rules', 'Expense policy the agent uses to judge each expense type.',
    'It calculates nothing: it lists each expense type with its cap in pesos, or “Requires CFDI”, or “No cap”, as it appears in the configuration.',
    'Your fleet’s expense policy. If your fleet has not saved one, the system’s default policy is shown. The View link only appears if your role can open Settings, which is currently read-only.',
  ),
  'liquidacion.ultimos_cierres': V(
    'Latest closings', 'The most recent settlements that are not up for review.',
    'Takes the 50 most recent settlements that are not rejected reviews, removes those with “revisar” status and shows the first 5 with verified amount, difference and status.',
    'Your fleet’s settlements, ordered by creation date.',
    'Use View on each row to open the detail.',
  ),
  // ── Payment breakdowns by email ──────────────────────────────────────────────
  'desgloses.lista': V(
    'Payment breakdowns', 'Email delivery status of each payment breakdown that arrives from your company’s system.',
    'The cards count the breakdowns received today and the emails from the last 30 days by status (sent, delivered, bounced), plus those on hold and the logs without a payroll entry. Bounced adds up bounced, complained and failed emails. The list shows each recipient’s status; if a role has several emails, the worst one prevails.',
    'Your fleet’s breakdowns and emails. A card that could not be measured shows “—”, not zero. On hold and without a payroll entry are only measured if they fit within a bounded read. The list is filtered by status and dates.',
    'Fix the email that bounced and resend from each breakdown’s detail.',
  ),
  'desgloses.detalle': V(
    'Breakdown detail', 'A payment breakdown with its line items, recipients, deliveries and actions.',
    'It calculates nothing: it shows the lines of earnings and deductions as they arrived, each recipient’s status, the delivery history and the open exceptions of that log.',
    'Your fleet’s breakdown. Resending, correcting an email and releasing a held delivery depend on your role and are only released when the breakdown allows it.',
    'Download the Excel, resend or, if it is on hold and releasable, release the delivery.',
  ),
  'desgloses.excepciones': V(
    'Exceptions', 'What needs a person before a breakdown arrives complete.',
    'Lists the fleet’s open, unresolved exceptions, with their type, log and since when. It shows the 50 most recent and warns if there are more.',
    'Your fleet’s exceptions, ordered by the last time they occurred. If they could not be read, it says so instead of showing “no exceptions”.',
    'Resolve the visible ones to see the rest; each one says what to fix.',
  ),
  // ── Email breakdown settings ─────────────────────────────────────────────────
  'liquidacion_config.entrega': V(
    'Breakdown delivery', 'Channel the breakdown goes out through, sender, and whether email sending is on.',
    'It calculates nothing: it saves the channel (email, email and WhatsApp, or WhatsApp), whether sending is active, the sender name, where replies go, the sending email and a minimum send hour from 0 to 23. Email sending only turns on if you tick the box.',
    'Your fleet’s delivery settings. With no saved settings, the agent delivers by WhatsApp and sends nothing by email. Only the fleet owner can change it.',
    'Tick Activate sending when everything is ready and use Save settings.',
  ),
  'liquidacion_config.destinatarios': V(
    'Who receives the breakdown', 'HR emails, archive mailbox, coordinator and driver types that receive their breakdown.',
    'It calculates nothing: it saves up to 3 HR emails, an archive mailbox, whether it is also sent to the coordinator, and which driver types (long-haul, local, owner-operators) receive it. An unticked type, or a driver with no type, is held and not sent.',
    'Your fleet’s delivery settings. Only the fleet owner can change it.',
  ),
  'liquidacion_config.fecha_corte': V(
    'Start cutoff date', 'Day from which breakdowns are sent; those from earlier periods are saved without being sent.',
    'Compares the end of each breakdown’s period with the date you set. If it ends earlier, the breakdown is saved and marked “omitted”, with no email to anyone. Empty means everything that arrives is sent.',
    'Your fleet’s delivery settings. Only the fleet owner can change it.',
    'Set the day sending starts so old payrolls are not sent when the history is uploaded.',
  ),
  'liquidacion_config.primer_mes': V(
    'First month: review', 'Temporary mode in which each reviewing department receives a copy of the breakdown.',
    'It calculates nothing: with the mode on, each breakdown, sent or held, also reaches the reviewer of each department by email, with the same Excel. It requires at least one reviewer, up to 5 and one per department, and an end date. After that date the mode turns itself off.',
    'Your fleet’s delivery settings. Only the fleet owner can change it.',
  ),
  'liquidacion_config.formato': V(
    'How the breakdown looks', 'Trip line and concept renames that change how the breakdown is labeled.',
    'It calculates nothing: the trip line merges into one the concepts you list, with the label you set, and the renames change the name under which a concept appears. The amount does not change. It allows up to 20 trip concepts and 50 renames.',
    'Your fleet’s delivery settings. Only the fleet owner can change it.',
  ),
  'liquidacion_config.retencion': V(
    'What holds the delivery', 'Concepts and negative net that hold a breakdown until someone reviews it.',
    'It calculates nothing: if a breakdown carries any of the concepts you list, up to 50, it does not go out and waits for review and release. With a negative net you choose between holding the delivery or sending it anyway.',
    'Your fleet’s delivery settings. Only the fleet owner can change it.',
    'Held ones are released from each breakdown’s detail on the breakdowns page.',
  ),
  // ── Settlement format ────────────────────────────────────────────────────────
  'liquidacion_formato.formato': V(
    'Your format', 'Sample Excel from which Likida takes columns, headers and the data at the top.',
    'Reads the sample file and extracts its columns, its headers and the data above the table (driver, period, folio). What it does not recognize is not invented and is flagged. It recalculates nothing: it prints the figures you send.',
    'File you upload and your fleet’s saved settings. Only the fleet owner uploads the sample or changes the format.',
    'Upload the Excel with Upload sample, or replace it if there is already one.',
  ),
  'liquidacion_formato.avisos': V(
    'Who gets notified', 'Phone numbers for the copy of each settlement and for “Does not match” notices, without Excel formatting.',
    'It calculates nothing: it saves up to 3 phone numbers for a copy to the fleet manager and up to 3 to notify when a driver replies “Does not match”. With no discrepancy numbers, the copy’s manager is notified and, with no copy, whoever sees the money.',
    'Your fleet’s settings; it appears only while no format is loaded. Only the fleet owner can save it.',
    'Enter the phone numbers and use Save phone numbers.',
  ),
  'liquidacion_formato.impresion': V(
    'How it is printed', 'Title, columns, dates and total used to generate each settlement’s PDF and Excel.',
    'It calculates nothing: it saves the title, the document sent over WhatsApp (PDF or Excel), the date format, the total row, and the label of each data point and column read from your sample. It also saves the copy and discrepancy phone numbers.',
    'Format saved from your sample; the current sample is indicated above. Only the fleet owner can change it.',
    'Edit the labels and use Save changes, or Remove format to delete the saved one.',
  ),
  // ── Supplier invoices ────────────────────────────────────────────────────────
  'proveedores.esperan_decision': V(
    'Awaiting your decision', 'Supplier invoices with pending status, neither approved nor rejected.',
    'Counts the invoices in the inbox with “pendiente” (pending) status. All pending ones are read, up to 500; if there are more, the page warns you.',
    'Your fleet’s supplier invoices when the page opens.',
    'Decide each one with the buttons in the Decide column in “The inbox”.',
  ),
  'proveedores.aprobadas': V(
    'Approved', 'Invoices that a person approved, with how many are still not exported.',
    'Counts the invoices with “aprobada” (approved) status among the 100 most recent in the mailbox and the pending ones read. The note separates those already exported in a CSV from those not.',
    'Your fleet’s supplier invoices. With 100 or more invoices, this figure only covers the most recent and there are more behind.',
    'Export the approved ones as CSV from “Upload supplier invoice”.',
  ),
  'proveedores.rechazadas': V(
    'Rejected', 'Invoices that a person rejected.',
    'Counts the invoices with “rechazada” (rejected) status among the 100 most recent in the mailbox and the pending ones read.',
    'Your fleet’s supplier invoices. With 100 or more invoices, this figure only covers the most recent and there are more behind.',
  ),
  'proveedores.receptor_ajeno': V(
    'With a foreign recipient', 'Pending invoices whose CFDI is not issued to your fleet’s RFC.',
    'Counts only the pending invoices where the XML’s recipient does not match your fleet’s RFC. If your fleet has no RFC on file, the validation stays pending and those invoices are not counted here.',
    'Your fleet’s pending invoices against your fleet’s saved RFC. It does not count those already approved or rejected.',
    'Review each one before approving: an invoice made out to another RFC is not yours.',
  ),
  'proveedores.subir': V(
    'Upload supplier invoice', 'Upload of an XML or an invoice photo to the inbox, and export of the approved ones.',
    'The XML is read as CFDI data; the photo is read with AI and is marked for review against the paper before approving. The recipient is validated against your fleet’s RFC. The CSVs use a standard import layout for SAP B1 and CONTPAQi, not certified compatibility, and what is exported is marked.',
    'Files you upload and your fleet’s approved invoices. Uploading or deciding requires a role with access to the money area.',
    'Upload the XML whenever you have it; validate the CSV with your accountant before the first import.',
  ),
  'proveedores.buzon': V(
    'Invoice mailbox by email', 'Your fleet’s email address so that attached XMLs enter the inbox on their own.',
    'It calculates nothing: it shows your fleet’s address, or lets you generate it once and rotate it. The XMLs attached to emails that arrive there enter the inbox. If the email domain is not configured in the system, it says so.',
    'Your fleet’s unique address. Only the fleet owner generates or rotates the address; if the mailbox could not be read, the section says so.',
    'Give the address to your suppliers or forward their invoices there.',
  ),
  'proveedores.bandeja': V(
    'The inbox', 'List of supplier invoices with their status, their SAT validation and who decided.',
    'Shows the 100 most recent invoices and all pending ones, up to 500, with the pending ones on top. Each row indicates the date and source, the issuer RFC, the concept, the total, the status and the SAT check made when the invoice was ingested. What was read by vision is marked for review.',
    'Your fleet’s invoices. The SAT status was checked when the invoice was ingested and may say not checked or no response.',
    'Approve or reject each pending one; do not approve one cancelled with the SAT.',
  ),
};
