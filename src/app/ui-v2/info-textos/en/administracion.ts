import type { InfoTexto } from '../../info-catalogo';
import type { INFO_ADMIN } from '../administracion';
import { V } from './constructores';
import { resto } from '@/lib/i18n/en/resto';

// Textos de ⓘ en inglés (US): administración y cuenta. Mismas claves y mismo orden que `../administracion.ts`.
export const INFO_ADMIN_EN: Record<keyof typeof INFO_ADMIN, InfoTexto> = {
  // ── arco ──
  'arco.por_responder': V(
    'To answer', 'ARCO requests from your drivers that have not been answered yet.',
    'Counts your fleet’s requests with «received» or «in process» status. If the reading fails it shows «—», not 0.',
    'Table of your fleet’s ARCO requests, complete (no date cutoff), read when the page opens.',
    'Open the list below and answer each one.',
  ),
  'arco.vencen_pronto': V(
    'Due soon', 'Requests to answer whose deadline falls today or within the next 5 days.',
    'Of the requests to answer, counts those whose due date is between today and 5 days from now, both included. Those already overdue do not count here.',
    'Due date saved on each request; «today» is the Mexico date when the page opens. If the reading fails it shows «—».',
    'Answer the ones with the nearest date first.',
  ),
  'arco.vencidas': V(
    'Overdue, unanswered', 'Requests to answer whose due date has already passed.',
    'Of the requests to answer, counts those that were due before today. One that is due today does not count as overdue yet.',
    'Due date saved on each request, compared with today’s date in Mexico. If the reading fails it shows «—», not 0.',
    'Answer these first from the list.',
  ),
  'arco.solicitudes': V(
    'Requests from your drivers', 'List of the ARCO requests registered for your fleet.',
    'Not calculated: it is the list of requests with their received date, right, data subject, due date, status and answer, from newest to oldest.',
    'Table of your fleet’s ARCO requests. Only a role with permission to manage the account sees and can use the answer actions.',
    'Open each request and answer it with the button in the row.',
  ),
  // ── arranque ──
  'arranque.avance': V(
    'Setup progress', 'How many setup steps are already done.',
    'Counts the required steps in «done» status against the total of required ones. Optional steps do not count. A step that could not be verified does not count as done.',
    'Each step is evaluated with a real signal from your account (captured data, rows added) when the page opens.',
    'Open the «Next» link to do the first pending step.',
  ),
  'arranque.grupo_flota': V(
    'Your fleet and its account', 'Steps about your company’s data and its account.',
    'Not calculated as a group: each step shows whether it is done, pending or «I could not verify it» according to its own signal.',
    'Account signals read when the page opens. Some steps can only be done by the owner.',
    'Open the link of each pending step.',
  ),
  'arranque.grupo_gente': V(
    'Your people and your trucks', 'Steps about drivers, units, yards and traffic managers.',
    'Not calculated as a group: each step shows whether it is done, pending or «I could not verify it» according to its own signal. Yards and traffic managers are optional.',
    'Account signals read when the page opens.',
    'Open the link of each pending step.',
  ),
  'arranque.grupo_operacion': V(
    'Your first operation', 'Steps of the first cycle: trip, WhatsApp ticket and settlement.',
    'Not calculated as a group: each step is «done» when your fleet already has its first trip, first receipt or first settlement.',
    'Account signals read when the page opens.',
    'Open the link of each pending step.',
  ),
  'arranque.automatizaciones': V(
    'Automations', 'Links to the screens of the available automations.',
    'Not calculated: it is the list of automations. The ones your role cannot see appear without a link.',
    'Fixed list of the product’s automations; the link depends on your role’s permissions.',
  ),
  // ── carta_porte_docs ──
  'carta_porte_docs.recibidos': V(
    'Documents received', 'Customer documents that arrived in the last 90 days.',
    'Counts the documents of the last 90 days, without counting files that were split into several shipments; each shipment is counted.',
    'Your fleet’s documents with a 90-day cutoff. If there are more than 500, the most recent are read and the page says so.',
  ),
  'carta_porte_docs.aprobados': V(
    'Approved', 'Documents of the last 90 days that a person has already approved.',
    'Counts the documents in «approved» status within the same 90-day window. Rejected ones are shown separately in the note.',
    'Your fleet’s documents, last 90 days.',
  ),
  'carta_porte_docs.sin_correccion': V(
    'Approved without correction', 'Percentage of approved documents in which nobody changed a value.',
    'Approved without recorded corrections divided by total approved. Confirming a doubtful value does not count as correcting it. With no approved documents it shows «—», not 0 %.',
    'Your fleet’s approved documents in 90 days and the corrections recorded per document.',
  ),
  'carta_porte_docs.tiempo_ahorrado': V(
    'Time saved per shipment', 'Estimate of minutes saved compared with entering the shipment by hand.',
    'Average of max(0, 12 min of manual entry minus the measured review minutes) per measured approved document. The 12 min is a design assumption, not a measurement.',
    'Review time measured from when the document is opened until it is approved, only on approved documents that carry it. With none measured it shows «—».',
  ),
  'carta_porte_docs.subir': V(
    'Upload a document', 'Form to manually load a customer document.',
    'Not calculated: when you submit it, the agent reads the file and leaves it in the review inbox.',
    'The file you upload; naming the customer is optional and helps recognize its format. It only appears if your role can upload.',
    'Choose the file and click «Upload and read».',
  ),
  'carta_porte_docs.bandeja': V(
    'Review inbox', 'List of received documents, with those waiting for a person first.',
    'Not calculated: sorts by status priority and then by received date, most recent first. You can filter by TMS submission status.',
    'The 200 most recent documents of your fleet plus all those to review or unreadable, regardless of age.',
    'Open a document to review and approve or reject it.',
  ),
  'carta_porte_docs.correo': V(
    'Your fleet’s email', 'Own mailbox where your customers can send documents.',
    'Not calculated: shows the mailbox address and its status, and lets you save the list of your customers’ senders.',
    'Your fleet’s mailbox configuration. Without an activated mailbox, the address does not exist.',
    'Activate the mailbox and enter your customers’ senders.',
  ),
  'carta_porte_docs.whatsapp': V(
    'WhatsApp', 'Explains how to forward a customer’s document by WhatsApp.',
    'Not calculated: it is help text about which formats are accepted automatically and what caption a photo must carry.',
    'Fixed text on the screen; the channel works in fleets that activated the mailbox.',
  ),
  'carta_porte_docs.formatos': V(
    'Formats Likida already knows', 'Format profiles learned from the documents you have approved.',
    'Not calculated: lists each profile with its format, active version and number of recognized fields, and lets you go back to an earlier version.',
    'Your fleet’s saved profiles. With none, no document has been approved yet to create the first one.',
    'Open a profile and use «Go back to this one» if a new version reads worse.',
  ),
  'carta_porte_docs.exportar': V(
    'Export approved documents', 'Downloads of approved documents and custom output formats.',
    'Not calculated: generates the file when you download it, only with approved documents, in the standard format or in one you declare.',
    'Your fleet’s approved documents and the target formats you have saved.',
    'Download the standard one or declare a target format.',
  ),
  // ── carta_porte ──
  'carta_porte.datos_transportista': V(
    'Carrier data', 'The 18 data points of the Carta Porte complement answered by your fleet, one by one.',
    'Each data point shows whether it is already captured, missing, or Likida does not yet have a field for it. A data point with no field counts as missing from the carrier.',
    'Built when the page opens from what was captured on the trip, the unit and the driver. If missing, it says on which screen it is captured.',
    'Capture what is missing on the screen each row indicates.',
  ),
  'carta_porte.datos_cliente': V(
    'Customer data', 'The 19 data points of the Carta Porte complement contributed by your customer, one by one.',
    'Each data point shows whether it is already captured, missing, or Likida does not yet have a field for it. Its gap is reported, but it does not change the progress of the carrier’s data.',
    'Built when the page opens from what was captured on the trip and the customer.',
    'Ask your customer for what is missing before the trip.',
  ),
  // ── combustible_casetas ──
  'combustible_casetas.el_gasto': V(
    'Spending', 'Historical spending on fuel and tolls, eligible liters and receipts without CFDI.',
    'Groups your fleet’s expenses by concept (sum and number of records) and shows four figures: fuel, tolls, eligible liters and percentage without CFDI.',
    'Your fleet’s expenses. Fuel and tolls are historical with no window; the other two figures state their own window.',
  ),
  'combustible_casetas.gastado_combustible': V(
    'Spent on fuel', 'Historical sum of your fleet’s recorded diesel expenses.',
    'Adds up the expenses with the «diesel» concept and counts how many fill-ups they are. It has no date window: it grows with the whole history. With no fill-ups it shows 0 and the note says so.',
    'Your fleet’s expense table, grouped by concept when the page opens.',
  ),
  'combustible_casetas.gastado_casetas': V(
    'Spent on tolls', 'Historical sum of your fleet’s recorded toll expenses.',
    'Adds up the expenses with the «caseta» concept and counts how many toll booths they are. It has no date window. With no toll booths it shows 0 and the note says so.',
    'Your fleet’s expense table, grouped by concept when the page opens.',
  ),
  'combustible_casetas.litros_elegibles': V(
    'Liters eligible for the incentive', 'Diesel liters from the settlements of the current fiscal year.',
    'Adds up the eligible diesel liters from your fleet’s settlements from January 1 to today. It does not convert liters to pesos. If the reading fails it shows «—», not 0.',
    'Your fleet’s settlements; the window (current fiscal year, January to today in Mexico) is in the figure’s note.',
  ),
  'combustible_casetas.sin_cfdi': V(
    'Without CFDI', 'Percentage of fuel and toll receipts that do not carry a CFDI.',
    'Among your fleet’s last 100 receipts, takes the diesel and toll ones and calculates the percentage that has no CFDI fiscal folio. With no receipts or a failed reading it shows «—», not 0 %.',
    'The 100 most recent receipts, not the whole history; the note says how many out of how many.',
    'Ask for the invoice on the ones that do not have it: without a CFDI it is not deductible.',
  ),
  'combustible_casetas.carga_repetida': V(
    'Possible repeated fill-up', 'Fuel or toll receipts that appear on more than one trip.',
    'Looks for CFDI or folios that repeat in expenses of different trips and keeps those that mention diesel or tolls. It is a match, not a verdict.',
    'Your fleet’s expenses. If the check fails, the page says so and does not claim it is clean.',
    'Verify the case with the trips listed before talking to the driver.',
  ),
  'combustible_casetas.cfdi_consolidado': V(
    'Consolidated CFDI (wallet and TAG)', 'How much of a consolidated wallet or TAG CFDI was linked to expenses.',
    'Counts the lines of the consolidated CFDI linked automatically to an expense, those waiting for review and those a person reviewed without finding an expense. With no consolidated CFDI it shows a notice, not zeros.',
    'Your fleet’s consolidated CFDI lines; the list to resolve brings the 200 most recent and the count covers all of them.',
  ),
  'combustible_casetas.lineas_ligadas': V(
    'Lines linked automatically', 'Consolidated CFDI lines that were linked to an expense on their own.',
    'Counts the lines reconciled without intervention, against the number of consolidated CFDI received.',
    'Your fleet’s consolidated CFDI lines, with no date window.',
  ),
  'combustible_casetas.por_revisar': V(
    'To review by hand', 'Consolidated CFDI lines waiting for a person to decide.',
    'Total lines minus those linked automatically and minus those already reviewed without an expense. A line lands here when there is not exactly one ticket that matches by date and amount.',
    'Your fleet’s consolidated CFDI lines, with no date window.',
    'Choose the right candidate in the list below or mark «none of these».',
  ),
  'combustible_casetas.sin_gasto': V(
    'Reviewed, no matching expense', 'Lines a person reviewed that ended up with no linked expense.',
    'Counts the lines marked «no match» when resolved by hand. They are documented and no longer count as to review.',
    'Your fleet’s consolidated CFDI lines, with no date window.',
  ),
  // ── conexiones ──
  'conexiones.conector': V(
    'Connection status', 'Measured status of one of your fleet’s connections: ready, incomplete or not connected.',
    'Each connection shows one of five labels: ready, incomplete, not connected, could not be measured or in rehearsal. «Could not be measured» means the reading failed, not that the connection is missing.',
    'Your fleet’s configuration and credentials read when the page opens; the detail of each row says what was measured and what is missing.',
    'Review each connection’s list of missing items and capture what it asks for.',
  ),
  // ── configuracion ──
  'configuracion.empresa': V(
    'The company', 'Your fleet’s RFC, against which each expense CFDI is validated.',
    'Not calculated: shows the saved RFC. If it does not match the receiver on the receipt, the engine marks the CFDI as unverifiable.',
    'Your fleet’s configuration. The main RFC is not edited here.',
  ),
  'configuracion.rfcs_adicionales': V(
    'Other legal entities you invoice', 'Additional RFCs whose expense CFDI the engine accepts as yours.',
    'Not calculated: saves the list you enter after checking the RFC’s format and check digit. Saving an empty list deletes it.',
    'Your fleet’s configuration. The maximum and the validation are applied by the server when saving.',
    'Enter one RFC per line and click «Save additional RFCs».',
  ),
  'configuracion.ajustes': V(
    'Your operation settings', 'Parameters the engine uses to reconcile your trips.',
    'Not calculated: it is a form with fuel efficiency, load factor, diesel price, deviation threshold and chart of accounts. The server validates the values when saving.',
    'Your fleet’s configuration. The kilometers example comes from the most recent trip that has kilometers driven.',
    'Adjust the values and save.',
  ),
  'configuracion.unidades': V(
    'Calibrated units', 'Plates with their own efficiency and tank, which win over the default value.',
    'Not calculated: lists each plate with its base efficiency and tank capacity as saved.',
    'Your fleet’s configuration. With no calibrated plates, all use the default efficiency above.',
  ),
  // ── conocimiento ──
  'conocimiento.ficha': V(
    'Regulatory sheet', 'A regulation that one of your settlement’s figures depends on, with its verification status.',
    'Not calculated: each sheet shows its instrument, article or rule, its verification status and where it is applied in the calculation. With an unverified or contradicted sheet, Likida states nothing.',
    'Corpus of regulations included in the application; it is the same for all fleets. «Reviewed on» is the sheet’s verification date.',
    'Open «Read the source» and confirm with your accountant before deciding on a corroborated sheet.',
  ),
  // ── contador ──
  'contador.iva_liquidaciones': V(
    'Creditable VAT from your settlements', 'Creditable VAT the engine calculated when closing your settlements of the fiscal year.',
    'Adds up the creditable VAT saved on each settlement of your fleet, from January 1 to today. It is arithmetic on columns already calculated by the engine; it does not recalculate the tax.',
    'Your fleet’s settlements, current fiscal year up to today in Mexico. If the reading fails, the section says it could not be loaded.',
  ),
  'contador.estimulo_peaje': V(
    '50% toll incentive', 'Toll incentive from your settlements of the fiscal year, subject to eligibility.',
    'Adds up the toll incentive saved on each settlement of your fleet, from January 1 to today. The note states that the base is the subtotal without VAT of toll booths with CFDI.',
    'Your fleet’s settlements, current fiscal year. It is not an entitlement already earned: it depends on eligibility.',
  ),
  'contador.en_riesgo': V(
    resto['op.mf_info_titulo'], resto['op.mf_info_que_es'], resto['op.mf_info_como'], resto['op.mf_info_fuente'], resto['op.mf_info_hacer'],
  ),
  'contador.recuperable': V(
    'Recoverable by asking for the invoice', 'Expense whose invoice can still be requested.',
    'Adds up the amount of the fiscal year’s expenses whose dominant cause of loss is one that is fixed by asking for the invoice. It is not VAT: it is the expense amount.',
    'Your fleet’s tax expenses of the current fiscal year. If it could not be calculated, it shows an error with «Retry», not 0.',
    'Ask the suppliers the engine lists below for the invoice.',
  ),
  'contador.diesel_elegible': V(
    'Diesel eligible for the incentive', 'Diesel liters from your settlements of the fiscal year.',
    'Adds up the eligible diesel liters saved on each settlement, from January 1 to today. It is shown in liters, not pesos: the weekly DOF rate is not applied here.',
    'Your fleet’s settlements, current fiscal year. Your accountant applies the rate that corresponds to each date.',
  ),
  'contador.gasto_leido': V(
    'Verified expense read', 'Sum of the receipts read in the fiscal year, with how many carry a CFDI.',
    'Adds up the amount of the receipts read in the fiscal year. It is what left the cash box, not the taxable base. The note counts how many receipts there are, with and without CFDI.',
    'Your fleet’s tax expenses, current fiscal year. With no receipts, the section shows a notice instead of zeros.',
  ),
  'contador.iva_documentado': V(
    'Documented creditable VAT', 'VAT that can be documented as creditable with the CFDI read.',
    'Adds up the VAT charged on receipts with a CFDI whose validity, issuer and deductibility do not prevent it. With prorated fuel, it is an aggregate estimate that may differ from PDFs already signed.',
    'Your fleet’s tax expenses, current fiscal year. A CFDI without a VAT breakdown read is not stated.',
  ),
  'contador.iva_no_acreditable': V(
    'Itemized VAT that is not credited', 'Itemized VAT from receipts that do not support it.',
    'Adds up the VAT of receipts that do not support the credit, plus the non-deductible part of per diem over the cap. Together with the creditable VAT it adds up all the itemized VAT of the period.',
    'Your fleet’s tax expenses, current fiscal year.',
  ),
  // ── conversaciones ──
  'conversaciones.hilos': V(
    'Your fleet’s threads', 'Number of WhatsApp conversations between the bot and your fleet’s numbers.',
    'Counts your fleet’s saved conversations. If the count fails, a long dash (—) appears instead of the figure; that does not mean there are none.',
    'Your fleet’s WhatsApp conversations, with no date window. Only the owner and the superadmin see this screen.',
  ),
  'conversaciones.mensajes': V(
    'Messages in the listed threads', 'Messages saved in the threads listed below.',
    'Adds up the messages of the listed threads, which are at most the 30 most recent. If there are more threads, the figure does not include them.',
    'Recent window of each conversation: the latest turns are saved, not the full history.',
  ),
  // ── timbrado ──
  'timbrado.en_cola': V(
    'In the stamping queue', 'Trips in the list below: those that already have their Carta Porte draft worked or a stamp.',
    'Counts the rows in the list. It is not «all the trips that need a complement»: that is decided by the draft, trip by trip.',
    'Trips with a Carta Porte XML generated at some point and stamps in force or in progress, read when the screen opens; the list shows at most the 25 most recent.',
    'Open each trip to review its draft and issue the stamp.',
  ),
  'timbrado.sin_timbre': V(
    'Without a stamp', 'Trips in the list that have no stamping attempt yet.',
    'Counts the rows in the list with no stamp and no reservation.',
    'The same trips of the queue, read when the screen opens.',
    'Open the trip, review the draft and issue when it is ready.',
  ),
  'timbrado.timbrados': V(
    'Stamped', 'Trips in the list with a stamp in force.',
    'Counts the rows with a stamp in force. A test stamp counts here but says so on its row: it covers nothing.',
    'The same trips of the queue, read when the screen opens.',
  ),
  'timbrado.bloqueados': V(
    'Blocked', 'Trips with a stamping attempt in progress or without a PAC response, blocked on purpose.',
    'Counts the rows with a live reservation. While it lasts, that trip is not stamped again, to avoid duplicating a stamp.',
    'The same trips of the queue, read when the screen opens.',
    'If a row says the stamp was left half registered, notify support; do not stamp it again.',
  ),
  // ── cotizaciones ──
  'cotizaciones.costos': V(
    'Declared fleet costs', 'Costs you declare and that the quoting tool uses to suggest a price.',
    'Not calculated: saves diesel and fixed costs per kilometer, salary and per diem per day, return factor and target markup. An empty field is «not declared» and the quoting tool does not suggest a price.',
    'What you declare for your fleet; the quoting tool does not assume any value for you.',
    'Declare each cost and click «Save costs». If you do not pay per diem, enter 0.',
  ),
  'cotizaciones.nueva': V(
    'New quote', 'Form to quote a route with your declared costs.',
    'Not calculated here: when you quote, a breakdown with each assumption is built. If the route has settled trips, the tolls come measured from them and the manual entry is ignored.',
    'Your fleet’s declared costs, the route’s settled trips and the data you enter in the form.',
    'Fill in the route and the price and click «Quote».',
  ),
  'cotizaciones.lista': V(
    'Quotes', 'List of your fleet’s quotes, with cost, price and profit.',
    'Profit is the price minus the estimated cost, with its percentage of the price. If the price or a cost item is missing, it says what is missing and never shows 0.',
    'Your fleet’s quotes, from newest to oldest, with no date window. The citable breakdown shows each assumption.',
    'On live quotes, mark them as sent or lost, or turn them into a trip if your role can dispatch.',
  ),
  // ── descarga_sat ──
  'descarga_sat.intro': V(
    'SAT mailbox download', 'Explains what this screen downloads from the SAT mailbox and what is needed to use it.',
    'Not calculated: it is context text. It says the e.firma is not stored in Likida and shows whether a provider is connected or the reason why not.',
    'Status of the download provider’s configuration when the page opens.',
  ),
  'descarga_sat.bajados': V(
    'CFDI downloaded from the mailbox', 'Total of unique CFDI that have been downloaded from your fleet’s SAT mailbox.',
    'Counts all the downloaded-receipt rows of your fleet. The same fiscal folio does not enter twice. It is the total the other four figures are split from.',
    'Your fleet’s downloaded receipts, counted in the database, with no date window. If the reading fails it shows «could not be read», not 0.',
  ),
  'descarga_sat.casados': V(
    'Matched an expense on their own', 'Downloaded CFDI that ended up linked to an expense without intervention.',
    'Counts the downloaded receipts with «matched» status.',
    'Your fleet’s downloaded receipts, counted in the database, with no date window.',
    'Open «the ones that already matched» to see the list.',
  ),
  'descarga_sat.ambiguos': V(
    'Waiting for you to decide', 'Downloaded CFDI with several possible expenses and none chosen.',
    'Counts the downloaded receipts with «ambiguous» status. Likida does not guess which expense it belongs to.',
    'Your fleet’s downloaded receipts, counted in the database, with no date window.',
    'Open «the ones waiting for your decision» and choose the expense.',
  ),
  'descarga_sat.disponibles': V(
    'No expense that matches', 'Downloaded CFDI that no expense of your fleet claims.',
    'Counts the downloaded receipts with «available» status.',
    'Your fleet’s downloaded receipts, counted in the database, with no date window.',
    'Open «the ones no expense claims» and check whether an expense still needs to be captured.',
  ),
  'descarga_sat.ignorados': V(
    'Archived on purpose', 'Downloaded CFDI the engine archived because they already came in another way.',
    'Counts the downloaded receipts with «ignored» status. The five groups add up to the total downloaded.',
    'Your fleet’s downloaded receipts, counted in the database, with no date window.',
  ),
  // ── facturacion ──
  'facturacion.cartera': V(
    'What you invoiced and what you are owed', 'Receivables from the invoices your fleet issued, with what was collected and what remains to collect.',
    'Adds up only live invoices (issued or paid). Drafts and canceled ones do not count as collectible. The balance is split into aging buckets and by customer.',
    'Your fleet’s issued invoices, with no date window, dated against a single today in Mexico. The table lists the 100 most overdue; the figures cover all of them.',
    'Record an issued invoice with the button above if you have not captured it yet.',
  ),
  'facturacion.facturado': V(
    'Invoiced to customers', 'Total of your fleet’s live issued invoices.',
    'Adds up the total of issued or paid invoices. It does not include drafts or canceled ones.',
    'Your fleet’s issued invoices, with no date window.',
  ),
  'facturacion.cobrado': V(
    'Collected', 'Payments recorded against live issued invoices.',
    'Adds up what was paid on each issued or paid invoice. It depends on payments being recorded in Likida.',
    'Your fleet’s issued invoices and recorded payments, with no date window.',
  ),
  'facturacion.por_cobrar': V(
    'Receivable', 'Live balance of issued invoices with an outstanding balance.',
    'Adds up the balance of live invoices with a balance greater than one cent. It does not include drafts or canceled ones. It is the sum of the aging buckets.',
    'Your fleet’s issued invoices, with no date window.',
    'Review the balance aging and the customer breakdown to decide whom to collect from first.',
  ),
  'facturacion.vencido': V(
    'Overdue', 'Part of the receivable balance that has passed its agreed date.',
    'Adds up the balance of invoices whose due date has already passed. An invoice without the customer’s credit days has no date and does not enter here.',
    'Your fleet’s issued invoices and each customer’s credit days, against today in Mexico.',
    'Capture the customer’s credit days if the notice says they are missing.',
  ),
  'facturacion.en_la_mesa': V(
    'Settled trips nobody invoiced', 'Trips with a closed settlement that have no live invoice.',
    'A settled trip counts as invoiced if an issued or paid invoice covers it. A draft does not count; a canceled invoice returns the trip to this list.',
    'Your fleet’s settled trips and invoices, against today in Mexico. The list shows a portion and the figures count all of them.',
    'Record the invoice of each trip in the list.',
  ),
  'facturacion.sin_factura': V(
    'Settled trips without an invoice', 'Number of settled trips that have no live invoice.',
    'Counts the settled trips without an issued or paid invoice covering them. The note gives the total of settled trips.',
    'Your fleet’s settled trips and invoices, with no date window.',
  ),
  'facturacion.ingreso_sin_facturar': V(
    'Captured revenue not invoiced', 'Sum of the freight revenue of the trips without an invoice that do have it captured.',
    'Adds up the freight revenue of those trips. Those that carry no revenue are left out of the sum, so it is a minimum, not the total you failed to invoice.',
    'Revenue captured on your fleet’s settled trips without an invoice.',
    'Capture the revenue of the trips that lack it to complete the figure.',
  ),
  'facturacion.mas_viejo': V(
    'The oldest, not invoiced', 'Days the oldest settled trip has gone without being invoiced.',
    'Counts the days from the settlement closing until today and takes the maximum. If no trip has a closing date, it shows «—» and explains it: it is not zero days.',
    'Closing date of the settlements of the trips without an invoice, against today in Mexico.',
  ),
  'facturacion.auditor': V(
    'Collections auditor', 'Per-trip cross-check of what was agreed, delivered, invoiced and collected.',
    'For each trip started in the window, compares the agreed amount against proof of delivery, invoices and payments, and classifies each discrepancy in a bucket with its amount.',
    'Your fleet’s trips started in the last 30 days; the screen states the exact dates. The list shows the first 25 findings and the count covers all of them.',
    'Open each finding and fix the missing invoice, proof of delivery or collection.',
  ),
  'facturacion.dinero_dormido': V(
    'Dormant money', 'Amount of delivered trips that have no live invoice.',
    'Adds up the amount of the «delivered not invoiced» findings. Those with no resolvable amount do not add; the note says how many there are, so it is a minimum.',
    'Your fleet’s trips started in the auditor’s window (30 days).',
    'Invoice the delivered trips in the list.',
  ),
  'facturacion.facturado_de_menos': V(
    'Under-invoiced', 'Gap between what was agreed and what the invoices add up to, on trips invoiced below the agreed amount.',
    'Adds up the amount of the «invoiced less» findings that carry an amount.',
    'Your fleet’s trips started in the auditor’s window (30 days).',
    'Review those trips and issue the complement or correct the invoice.',
  ),
  'facturacion.margen_medido': V(
    'Measured actual margin', 'Agreed amount minus settled expenses, only on trips that have both data points.',
    'Adds up the agreed amount and the verified total of the trips that have both halves and subtracts; the percentage is the margin over the agreed amount. Trips missing one half are not measured.',
    'Trips started in the auditor’s window (30 days): agreed amount by rate or captured revenue and the settlement’s verified total.',
  ),
  // ── importador ──
  'importador.carga': V(
    'Upload from Excel or CSV', 'Bulk upload in three steps: template, file review and confirmation.',
    'Not calculated: reviewing the file writes nothing and counts the rows that would enter, those that already existed and those with a problem. It writes only if you confirm; the server validates everything again.',
    'The file you upload (CSV or Excel, with the maximum MB and rows the screen states) and your fleet’s existing data.',
    'Download the template, upload your file, review the problems and confirm.',
  ),
  'importador.nuevas': V(
    'Rows that would enter', 'File rows that would be added or linked on confirming.',
    'Before confirming it is a forecast: it counts the rows read that meet the rules. After confirming, the label changes and it is the number of rows that were written.',
    'The reviewed file, compared with your fleet’s data.',
    'Confirm only if the number and the sample match what you expected.',
  ),
  'importador.ya_estaban': V(
    'Already there', 'File rows that already exist in your fleet and are not touched.',
    'Counts the rows read that are already in your fleet. They are neither modified nor duplicated.',
    'The reviewed file, compared with your fleet’s data.',
  ),
  'importador.con_problema': V(
    'With a problem', 'File rows that do not enter, each with its reason.',
    'Counts the rows that fail validation (file, yard, another fleet or inactive). The list shows up to 300 problems; this figure is the total.',
    'The reviewed file, compared with your fleet’s data.',
    'Download the errors CSV, fix the file and review it again.',
  ),
  // ── legal ──
  'legal.responsable': V(
    'Your fleet’s privacy officer', 'Your company’s data that appears in the privacy notice your drivers receive.',
    'Not calculated: saves the legal name, address and privacy contact. If any is missing, the notice goes out anyway and says what is missing.',
    'Your fleet’s saved data. Only the owner can edit it; other roles see a text that says so.',
    'Complete the three data points and click «Save officer details».',
  ),
  'legal.documentos': V(
    'Current documents', 'Current version of the Terms and the Privacy notice, and whether you have already accepted them.',
    'Not calculated: compares the versions your user accepted against the current ones. If you already accepted both, it says so; if not, it offers the accept button.',
    'Your fleet’s acceptance record. Only the owner can accept. If the reading fails, the page says so and does not claim you did not accept.',
    'Open each document and, if you are the owner, accept the current versions.',
  ),
  'legal.mandato': V(
    'Self-invoicing mandate', 'Mandate text and its status: granted, withdrawn or not yet granted.',
    'Not calculated: shows the current text as published, its version and, if it exists, the date it was granted. Without the mandate, Likida prepares the invoices but does not issue them.',
    'Your fleet’s acceptance record. Granting or withdrawing it is done by the owner; in some accounts the mandate is not available and the page says so.',
    'If you are the owner and want Likida to issue on your behalf, grant it with the button.',
  ),
  // ── llaves_api ──
  'llaves_api.emitir': V(
    'Issue a key', 'Form to create an API key for your fleet.',
    'Not calculated: when issued, the key is shown only once and only a hash of it is saved. The validity you choose sets when it stops being valid; a key with no expiry is valid until revoked.',
    'Fleet owner’s session: only that role issues and revokes keys. The list of keys above comes from your fleet’s keys.',
    'Copy the key when you issue it; it cannot be viewed again afterwards. Revoke from the list the ones you no longer use.',
  ),
  // ── mi_perfil ──
  'mi_perfil.segundo_factor': V(
    'Second factor', 'Code from an authenticator app as a second security step for your account.',
    'Not calculated: shows whether you have a second factor active and lets you activate it, verify your session with the 6-digit code or remove it. Removing it requires the code.',
    'Your account’s authentication factors. Activating it makes sensitive actions require the code.',
    'Activate the second factor and verify your session with the code from your app.',
  ),
  'mi_perfil.sesiones': V(
    'Active sessions', 'Sign-out of all your sessions on all devices.',
    'Not calculated: the button signs you out on all devices, including this one, and sends you to sign in again.',
    'Your access account; it does not show a list of sessions, only the global sign-out.',
    'Use it if you lost a phone or laptop where you stayed signed in, or if you suspect someone got in.',
  ),
  'mi_perfil.clientes_mcp': V(
    'Connected MCP clients', 'External clients with read-only access to your fleet’s data on your behalf.',
    'Not calculated: lists the clients connected with your user. The name was declared by whoever registered the client. Cutting access cuts all the ones you have, not just one.',
    'Your user’s MCP connections in your fleet. If the reading fails, the page says so and does not claim you have none.',
    'Cut the access if you do not recognize one; there is no undo.',
  ),
  // ── politicas ──
  'politicas.topes': V(
    'Caps by concept', 'Per-receipt cap and CFDI requirement for each expense concept.',
    'Not calculated: they are the rules the engine uses when reconciling each trip. Empty means no cap; a 0 is a cap of zero and the concept is no longer allowed. The engine treats them differently.',
    'Your fleet’s policy. If it has not saved its own, it uses the base policy and the label says so. Only a role that can manage edits; the others see the table.',
    'Adjust the caps and click «Save policy»; the engine applies them from the next reconciliation.',
  ),
  'politicas.reglas_ruta': V(
    'Rules by route', 'Caps that apply to a specific route, read-only.',
    'Not calculated: lists the caps by concept and route as saved. When you save the policy by concept they are kept intact; they are not edited here.',
    'Your fleet’s policy, only the rules that carry a route. The section appears only if they exist.',
  ),
  'politicas.topes_fiscales': V(
    'Tax caps the engine applies', 'Tax values from the configuration the engine uses when reviewing expenses.',
    'Not calculated: shows the values from your fleet’s configuration (daily meal cap, cash cap, toll factor and fuel-consumption deviation threshold). They are not edited from here.',
    'Your fleet’s configuration read when the page opens.',
  ),
  // ── proximamente ──
  'proximamente.que_hara': V(
    'What it will do for your operation', 'Fixed list of what a module that is not yet active in your account will do.',
    'Not calculated: it is the module’s fixed text. This screen does not query your fleet’s data or send messages.',
    'Module description included in the application; it does not depend on your account or your role.',
  ),
  // ── reglas ──
  'reglas.vigilancia': V(
    'What I can watch today', 'Types of monitoring Likida can declare for your role, each with an example.',
    'Not calculated: lists the monitoring templates available for your role, with their title and an example phrase. What is not here, Likida does not monitor.',
    'Catalog of the product’s monitoring rules, filtered by your role.',
    'Write a monitoring rule with a phrase similar to the examples.',
  ),
  // ── soporte ──
  'soporte.abiertos': V(
    'Open', 'Your fleet’s support tickets that are neither resolved nor closed.',
    'Counts the tickets with a status other than «resolved» and «closed».',
    'All your fleet’s support tickets, with no date window, read when the page opens.',
    'Open a ticket’s subject to see the conversation with Likida.',
  ),
  'soporte.sla_vencido': V(
    'SLA overdue', 'Open tickets whose response deadline has already passed.',
    'Counts the open tickets with a due date earlier than the moment the page is opened.',
    'Your fleet’s support tickets. The deadline is the one agreed when each ticket was opened.',
    'Open the ticket and write in the conversation to follow up.',
  ),
  'soporte.sin_sla': V(
    'No SLA agreed', 'Open tickets that have no response deadline.',
    'Counts the open tickets with no due date. They are not overdue: nobody set a deadline for them.',
    'Your fleet’s support tickets, with no date window.',
  ),
  // ── suscripcion ──
  'suscripcion.como_pagar': V(
    'How to pay your monthly fee', 'Details to pay by transfer the invoice for your monthly fee that is pending.',
    'Not calculated: shows beneficiary, bank, CLABE, amount and reference of the pending invoice. If the bank details or the reference are not configured, it does not show partial data.',
    'Your fleet’s pending invoice and bank details configured by Likida. The invoice becomes paid when Likida sees the deposit on the account statement.',
    'Transfer using the exact reference shown.',
  ),
  'suscripcion.plan': V(
    'Your plan', 'Contracted plan, monthly fee, start date and next billing date.',
    'Not calculated: they are the saved details of your subscription. With no price configured or no billing date, it says so instead of showing 0.',
    'Your fleet’s subscription read when the page opens. If the reading fails, the page says so and does not claim you have none.',
  ),
  'suscripcion.uso': V(
    'What you have this month', 'Trips created in the month and active drivers, against your plan’s limits.',
    'Counts the trips created since the first day of the month in Mexico and your fleet’s active drivers. An empty limit means no limit, not zero.',
    'Your fleet’s trips and drivers when the page opens; the limits are those of your plan. Going over the limit does not shut anything off.',
  ),
  'suscripcion.datos_factura': V(
    'Details for your invoice', 'Tax details used to issue the CFDI for each monthly fee.',
    'Not calculated: saves RFC, legal name, postal code, tax regime, CFDI use, email and tax address. The RFC is validated when saving. «Complete» or «Missing» reflects whether invoicing is now possible.',
    'Your fleet’s tax details. Only the owner captures them; other roles see a notice.',
    'Copy them exactly from your Tax Status Certificate and save.',
  ),
  'suscripcion.planes': V(
    'Plans', 'Available plans with their limits and the button to subscribe or change.',
    'Not calculated: lists the plans and marks the current one. With no online payment connected there is no pay button and the page says so. Subscribing or changing plans requires being the owner and having the tax details complete.',
    'Plans configured by Likida and your fleet’s subscription.',
    'Capture your tax details and choose the plan.',
  ),
  'suscripcion.facturas': V(
    'Your Likida invoices', 'Invoices for your monthly fee with period, amount, payment status and CFDI.',
    'Not calculated: lists the invoices with their status. A paid invoice without a UUID is marked «Not stamped»: the money came in but there is no CFDI yet.',
    'Your fleet’s 12 most recent invoices; if there are more, the page says so.',
  ),
  // ── usuarios ──
  'usuarios.equipo': V(
    'Your team', 'The accounts with access to your fleet’s dashboard, with their role and WhatsApp.',
    'Not calculated: lists each account with its name, role, what that role can do and its phone. Deactivated accounts remain visible, struck through.',
    'Your fleet’s accounts read when the page opens. Only the owner can invite, change roles or deactivate; other roles see the list without actions.',
    'If you are the owner, invite someone or adjust their role from the row.',
  ),
};
