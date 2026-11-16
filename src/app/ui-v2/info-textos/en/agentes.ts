import type { InfoTexto } from '../../info-catalogo';
import type { INFO_AGENTES } from '../agentes';
import { V } from './constructores';

// English help texts (ⓘ): watch, carta porte, driver and toll agents. Same keys, same order as ../agentes.ts.
export const INFO_AGENTES_EN: Record<keyof typeof INFO_AGENTES, InfoTexto> = {
  // ═══ Carta Porte · agent ═══
  'carta_porte_agente.cola': V(
    'Waiting for the manager', 'Trips in progress whose Carta Porte verdict is waiting for a declaration from you.',
    'Takes the open or in-reconciliation trips and keeps those the legal tree marks as “declaration missing”; each row shows what is missing. The cards above count over those same trips.',
    'Your fleet’s trips with open or in-reconciliation status. Up to 50 are evaluated: first those departing from today onward and then the earlier ones or those with no date; the total of trips in progress is counted separately. Read when the page opens.',
    'Open the Carta Porte screen with the “Declare and enter” link and answer what is missing.',
  ),
  'carta_porte_agente.alcance': V(
    'What it does and does not do', 'Fixed text about what the Carta Porte agent does and what it will never do.',
    'It calculates nothing: it is the screen’s text. It describes that it asks over WhatsApp for what is missing, builds and validates the draft, and that it does not stamp.',
    'Text written on the screen; it does not read your fleet’s data or change with your role.',
  ),
  'carta_porte_agente.como_mandar': V(
    'How to send documents', 'The three ways a document arrives and your fleet’s email address.',
    'Shows your mailbox address if it is already active, if it is off or if it could not be read. The other two ways (the office’s 1:1 WhatsApp and the panel) are fixed text.',
    'Your fleet’s mailbox, read when the page opens. If there is no address to give, the screen says so instead of making one up.',
    'Forward the shipment to the mailbox address or upload the file in the documents inbox.',
  ),
  'carta_porte_agente.resultados': V(
    'How the agent is doing', 'The agent’s results on Carta Porte documents from the last few days.',
    'Counts the approved documents and what percentage received no corrections from a person, the submissions to the customer’s system by status, the causes of rejection and the fields corrected most often. With no base, it shows “—”, not 0%.',
    'Your fleet’s documents from the last 30 days, up to 500 listed. If there are more, the screen warns that the figures are partial. Counts only: it does not store the documents’ values.',
    'Review the “What to do” cards when they appear and fix in the customer’s catalog what repeats most.',
  ),
  'carta_porte_agente.sin_ccp': V(
    'Trips departed without Carta Porte', 'Trips that already departed and have no approved complement linked.',
    'Groups by customer the trips with a recorded departure and no approved document linked. Each row shows the hours since departure: from 24 hours it is drawn amber and from 72 hours red. It only reads: it sends no messages and closes no trips.',
    'Your fleet’s trips with departure in the last 45 days. Departure is the cargo-departure milestone or, in fleets with the five-agent profile, the trip’s start date in the TMS; there the link with the document is by customer and folio. If no trips are imported, it shows “No TMS data”, not zero.',
    'Download the CSV report and review the red rows first.',
  ),

  // ═══ Carta Porte · customer catalog ═══
  'carta_porte_catalogo.cliente': V(
    'Catalog customer', 'Choose which customer’s catalog you view and edit.',
    'It calculates nothing: it lists your fleet’s customers and opens the catalog of the one you choose. With more than 8 customers a search by name appears.',
    'Your fleet’s customers, read when the page opens. A customer that is not from your fleet opens nothing.',
  ),
  'carta_porte_catalogo.importar': V(
    'Import a CSV', 'Batch upload of products, senders and recipients or the internal number.',
    'You choose the type, upload the CSV and first see the preview with new rows, rows that change and rows with errors. Nothing is saved until you confirm.',
    'The file you upload, up to 4 MB. It is saved in the catalog of the customer you have open.',
    'Download the template for the type you need, fill it in and review the preview before confirming.',
  ),
  'carta_porte_catalogo.numero_interno': V(
    'Customer internal number', 'The number by which the company’s system knows the paying customer.',
    'It calculates nothing: it shows the saved number and lets you enter or correct it. If it is missing, the document is not linked and the agent does not make it up.',
    'Your fleet’s catalog for the chosen customer. Roles with permission on this screen edit it.',
  ),
  'carta_porte_catalogo.productos': V(
    'Customer products', 'The customer’s products with their SAT code, unit, packaging and tariff fraction.',
    'Lists the saved rows of the chosen customer and sorts them by SKU. The filter searches SKU, description, code, unit and fraction; up to 200 rows are drawn at a time.',
    'Your fleet’s catalog for that customer. If it is so large that only a part was read, the screen warns you.',
    'Edit a row by opening it or add one with “Add a row”.',
  ),
  'carta_porte_catalogo.partes': V(
    'Senders and recipients', 'The customer’s senders and recipients with their RFC and address.',
    'Lists the saved rows of the chosen customer, sorted by role and alias. The filter searches role, alias, legal name, RFC, postal code, municipality and state; up to 200 rows are drawn at a time.',
    'Your fleet’s catalog for that customer. If it is so large that only a part was read, the screen warns you.',
    'Edit a row by opening it or add one with “Add a row”.',
  ),

  // ═══ Carta Porte · customer reference ═══
  'carta_porte_referencia.pendientes_cliente': V(
    'Pending by customer', 'Trips already loaded that lack the reference their customer requires.',
    'For each customer that requires a reference, counts the trips with cargo loaded and no reference, and shows the hours of the oldest one. It only informs: it does not hold the trip or the stamping, and the reference does not go into the Carta Porte.',
    'Loading is the received or validated cargo-departure milestone or, in fleets with the five-agent profile, the trip start in the TMS from the last 45 days. Up to 5,000 loads are read; if exceeded, the screen says so. Up to 50 trips per customer are listed.',
    'Type the reference on the trip’s row and press “Save”.',
  ),
  'carta_porte_referencia.exigen': V(
    'Customers that require a reference', 'Per-customer switch: require their commercial reference or not.',
    'It calculates nothing: each customer shows whether it requires it or not and a button to change it. Only customers that require it enter the pending list.',
    'Your fleet’s customers and their saved rule; by default no customer requires it.',
    'Turn on “Require” only for customers that need the reference in order to collect.',
  ),

  // ═══ Drivers · board (figures and panels) ═══
  'conductores.viajes_en_curso': V(
    'Trips in progress', 'Trips in your fleet that are still open or in reconciliation.',
    'Exact count in the database of trips with open or in-reconciliation status. If it could not be counted, it shows “—”, not 0.',
    'All of your fleet’s trips in progress, not a sample. Read when the page opens.',
  ),
  'conductores.aceptados': V(
    'Accepted', 'Trips in progress that the driver accepted by saying yes.',
    'Counts the open or in-reconciliation trips with an acceptance time, excluding those that came in through a file import. If it could not be counted, it shows “—”.',
    'Your fleet’s trips in progress, exact count when the page opens.',
  ),
  'conductores.importados': V(
    'Tracked by import', 'Trips in progress that came in by file, without the driver accepting them.',
    'Counts the open or in-reconciliation trips with an acceptance time whose origin is the import. They are not added to “Accepted”.',
    'Your fleet’s trips in progress, exact count when the page opens.',
  ),
  'conductores.tiempo_aceptar': V(
    'Time to accept', 'Average time between the trip being notified and the driver accepting it.',
    'Averages the time from notice to acceptance of the trips accepted by the driver. It does not count those that came in by import and the note says how many were excluded. With no measurable trips, it shows “—”.',
    'The 200 most recent trips of your fleet, not the whole history, as the figure’s own note says.',
  ),
  'conductores.esperan': V(
    'Awaiting acceptance', 'Trips in progress notified to the driver who has not yet replied and have not been escalated.',
    'Counts the open or in-reconciliation trips with a notice, no acceptance and no escalation. If it could not be counted, it shows “—”.',
    'Your fleet’s trips in progress, exact count when the page opens.',
    'Review the “Awaiting acceptance” list below.',
  ),
  'conductores.escalados': V(
    'Escalated', 'Escalated trips in progress that still have no driver acceptance.',
    'Counts the open or in-reconciliation trips with an escalation time and no acceptance; the note describes them as waiting for a driver change.',
    'Your fleet’s trips in progress, exact count when the page opens.',
  ),
  'conductores.cola': V(
    'Awaiting acceptance', 'List of notified trips with no reply, the most urgent first.',
    'Lists the trips with a notice, no acceptance and no escalation, sorted by the age of the notice, with the hours elapsed and how many notices were sent. At the deadline the screen indicates, the agent escalates on its own.',
    'Your fleet’s trips. Up to 20 are listed; the exact total is counted separately and the screen says how many remain to be listed.',
    'If there are trips with no notice, the Notify button is in Dispatch.',
  ),
  'conductores.bitacora': V(
    'Log', 'The latest stamps for notice, acceptance, escalation and arrival of recent trips.',
    'Flattens each trip’s stamps (notified, accepted, rejected, escalated, arrived, unloading, returning), distinguishes those that came in by import and shows the 15 most recent.',
    'The 60 most recent trips of your fleet, as the screen says; it is not a complete history.',
  ),
  'conductores.entiende': V(
    'What it understands over WhatsApp', 'Fixed text about what the agent understands from drivers and from the traffic manager.',
    'It calculates nothing: it is the screen’s text. It summarizes the driver’s notices, the manager’s WhatsApp dispatch and what the agent does on its own.',
    'Text written on the screen; it does not read your fleet’s data. The deadline to escalate is the one the card itself shows.',
  ),
  'conductores.insights': V(
    'Period insights', 'Summary of what happened, what it means and what to do about the period’s milestones.',
    'Counts recorded milestones and how many nobody entered, those corrected by the office, the measured delays from the GPS and from the driver, and the exceptions. Avoided calls are an estimate and are only calculated if you entered your baseline.',
    'Milestones of your fleet’s trips in the last days you choose in the indicators filter, with the same yard, customer and driver filters. If the read reaches its cap, the screen warns you.',
    'Act on the “What to do” items; enter your baseline in Settings if you want to see avoided calls.',
  ),
  'conductores.kpis_piloto': V(
    'Pilot KPIs', 'Pilot reference indicators, compared with the baseline you declared.',
    'Shows each KPI’s measured value and its comparison with the baseline. With no value or no declared baseline it says “no data”; it does not make up a percentage.',
    'Same period and filters as the insights above; each row states its source.',
  ),

  // ═══ Drivers · milestone board ═══
  'conductores_tablero.sin_insistencia': V(
    'Milestones reported without chasing', 'Percentage of milestones reported with at most one message from the agent.',
    'Of the milestones received or validated, counts those that had at most one reminder and were not escalated, out of the total received. With no milestones received, it shows “—”, not 0%.',
    'Your fleet’s milestones with activity in the period you choose (last day, 7 or 30 days), with the yard, customer and driver filters.',
  ),
  'conductores_tablero.tiempo_respuesta': V(
    'Average response time', 'Average minutes between the agent requesting the milestone and the driver answering.',
    'Averages only the milestones received or validated with a valid request time and response time. With no measurable requests, it shows “—”. It measures message delivery, not the time of the physical event.',
    'Your fleet’s milestones with activity in the chosen period and filters.',
  ),
  'conductores_tablero.escalados': V(
    'Escalated milestones', 'Milestones that exhausted the reminder ladder.',
    'Counts the milestones with an escalation time in the period.',
    'Your fleet’s milestones with activity in the chosen period and filters.',
    'Review the exceptions queue and handle the escalated ones.',
  ),
  'conductores_tablero.validados_ubicacion': V(
    'Validated with location', 'Arrival milestones whose location fell within the site.',
    'Counts the milestones with a “validated” location verdict. The note adds the “no match” ones that are awaiting review.',
    'Your fleet’s milestones with activity in the chosen period and filters, against the sites catalog.',
    'Review the “no match” ones in the exceptions queue.',
  ),
  'conductores_tablero.validacion_degradada': V(
    'Validation in degraded mode', 'Percentage of arrivals validated without real GPS or without a location to compare against.',
    'Among the loading and unloading arrivals received or validated, counts those left with no location data, no validation record or validated only with the pin the driver chose. With no validatable arrivals, it shows “—”, not 0%.',
    'Your fleet’s milestones with activity in the chosen period and filters.',
    'Assign sites to trips and connect the GPS so arrivals are validated with real location.',
  ),
  'conductores_tablero.viajes_en_curso': V(
    'Trips in progress', 'Board of open and accepted trips with their milestone traffic light.',
    'Lists the open trips with acceptance, with their milestones and each one’s traffic light; the counts next to the title add up each color. The traffic-light filter also moves the exceptions queue.',
    'Your fleet’s trips with the yard, customer and driver filters. There is a cap on trips per read: if exceeded, the screen warns that trips are missing and asks you to filter.',
    'Use the filters to see the rest when the cap warning appears.',
  ),
  'conductores_tablero.excepciones': V(
    'Exceptions queue', 'What calls for a decision from you, most urgent first.',
    'Gathers the exceptions of the listed trips (for example escalated and unhandled, no report, late, location with no match) and sorts them by severity. The 50 most urgent are shown.',
    'The board’s trips with their filters. The action buttons only appear if your role can assign.',
    'Open each exception and use its button to enter, handle or validate the milestone.',
  ),
  'conductores_tablero.sin_senal': V(
    'No sign of life', 'Episodes in which a tractor was left with no sign of life, with its chain of notices.',
    'Lists each episode with its folio, driver, reason, whether it is still open and the notice steps with their time. If there are none, it says so; if it could not be read, it does not draw a zero.',
    'Your fleet’s episodes from the last days of the chosen period and with the same filters. Episodes exist only if your fleet turned this notice on in the Driver settings. If there are more than are listed, the most recent are shown.',
  ),
  'conductores_tablero.reubicaciones': V(
    'Relocations by customer', 'Times and minutes each customer relocated the drivers.',
    'Per customer, adds up relocations and minutes, from the first to the last recorded change, and in how many trips with data they occurred. A customer with no driver responses shows “No data”, not 0.',
    'Arrivals with a driver report on the board’s trips. It only appears if your fleet turned on the arrival report. The CSV serves as evidence.',
    'Download the CSV when you need to dispute a “did not show up”.',
  ),

  // ═══ Drivers · dwell times ═══
  'conductores_estadias.paradas': V(
    'Period stops', 'Loading and unloading stops with a recorded arrival in the period.',
    'Counts each stop with an arrival time, of any status (closed, in progress, no departure, inconsistent hours). The note separates closed and in progress.',
    'Your fleet’s trips whose arrival notice falls in the period, in Mexico days and both inclusive, with your yard, customer and driver filters. The read has a cap and the screen warns if it is exceeded.',
  ),
  'conductores_estadias.medio_carga': V(
    'Average time at loading', 'Average minutes of loading stops already closed.',
    'Averages the minutes between arrival and departure of closed loadings with valid minutes. With none closed, it shows “—”, not 0.',
    'The stops you see in the table, with their filters. The note says how many it was calculated over.',
  ),
  'conductores_estadias.medio_descarga': V(
    'Average time at unloading', 'Average minutes of unloading stops already closed.',
    'Averages the minutes between arrival and departure of closed unloadings with valid minutes. With none closed, it shows “—”, not 0.',
    'The stops you see in the table, with their filters. The note says how many it was calculated over.',
  ),
  'conductores_estadias.en_anden': V(
    'At the dock now', 'Stops with a recorded arrival and no departure notice.',
    'Counts the stops in progress: they arrived and have not yet reported their departure. Their time runs up to this moment and does not count as closed.',
    'The stops of the chosen period and filters, calculated when the page opens.',
  ),

  // ═══ Drivers · sites catalog ═══
  'conductores_sitios.registrados': V(
    'Registered sites', 'Customers, plants, docks and yards with their center and radius.',
    'It calculates nothing: it lists the sites with type, code, coordinates, radius, customer and data origin (manual entry or CSV). The search filters by name or code.',
    'Your fleet’s sites catalog. If there are more than are listed, the screen asks you to refine the search. Each arrival is validated against these sites; Edit and Archive are only seen by the owner or the traffic manager.',
  ),
  'conductores_sitios.formulario': V(
    'New or edited site', 'Form to create a site or correct an existing one.',
    'Saves name, type, code, address, coordinates, radius, customer and parent site. No coordinate is calculated or made up: you enter it.',
    'Your fleet’s sites catalog. Only the fleet owner or the traffic manager sees and saves it.',
  ),
  'conductores_sitios.importar_csv': V(
    'Import sites from CSV', 'Batch upload of sites with the columns the screen indicates.',
    'It is all or nothing: if a row fails, none is imported and it tells you which to fix. Importing the same file again updates by code and does not duplicate.',
    'The file you upload, up to 1 MB. Only the fleet owner or the traffic manager sees and uses it.',
    'Download the sample format and fill in the real coordinates: the sample has them blank on purpose.',
  ),
  'conductores_sitios.catalogo_depurado': V(
    'Cleaned origins and destinations catalog', 'Analysis and batch import of a cleaned sites catalog.',
    'Analyzes your file with no row cap. It reports possible duplicates (same name or within 100 m) and never merges them on its own. Missing coordinates, (0, 0), out of range or outside Mexico with no declared country are left “to validate” and are not imported.',
    'The file you upload, up to 8 MB. It only reads your file: it does not write to the customer’s system. Only the owner or the traffic manager sees it.',
  ),
  'conductores_sitios.textos_sin_sitio': V(
    'Texts without a site', 'Frequent origin and destination texts that are not yet linked to any site.',
    'Counts, among the open trips of the last days the screen shows, the origin and destination texts that repeat most and are not linked to a site. When in doubt, nothing is assigned.',
    'Your fleet’s open trips. If there are more trips than were read, the screen warns that the count is from a sample. Assigning and uploading equivalences is only available to the owner or the traffic manager.',
    'Tell the system what each text is: a site in your catalog, an instruction or something to ignore.',
  ),
  'conductores_sitios.importar_equivalencias': V(
    'Import equivalences from CSV', 'Batch upload of which site, instruction or ignored text each text is.',
    'Each row is approved or rejected on its own and the screen says which and why; incomplete rows are skipped. The site code must already exist in the catalog. Importing the same file again changes nothing.',
    'The file you upload, up to 1 MB. Only the fleet owner or the traffic manager sees it.',
  ),

  // ═══ Drivers · settings ═══
  'conductores_config.rutas': V(
    'Authorized Google Maps routes', 'Base of pre-made routes, by corridor and optionally by site.',
    'You import a routes CSV. The agent never builds or fixes a link: only maps.app.goo.gl or google.com/maps links are accepted, and an expired route is treated as if it did not exist. Each row is approved or rejected on its own and uploading the same file again changes nothing.',
    'The file you upload. This panel only appears if your role can assign.',
  ),
  'conductores_config.rutas_por_revisar': V(
    'Routes to review', 'Authorized routes that have gone 90 days or more without review, the most neglected first.',
    'Lists the routes whose last review is more than 90 days old, or that were never reviewed, and flags the overdue ones. The “Reviewed” button only records the review: it sends no messages and schedules nothing.',
    'Your fleet’s authorized routes, as of today’s date in your fleet’s time zone. If they could not be read, the list is not drawn.',
    'Open the route in Google Maps, confirm it is still right and press “Reviewed”.',
  ),
  'conductores_config.documentos_cliente': V(
    'Documents each customer requests', 'Which papers each customer asks for when the trip closes and which are indispensable.',
    'You register documents per customer (for example signed carta porte, customs entry, phytosanitary certificate) and mark the indispensable ones. A customer with no documents of its own stays as it is today: only the proof of delivery is requested.',
    'Your fleet’s active customers and the documents you save. This panel only appears if your role can assign.',
  ),

  // ═══ Tolls · figures ═══
  'peajes.lineas_conciliadas': V(
    'Reconciled lines', 'Account statement lines linked to a trip’s toll expense.',
    'Counts the lines of the consolidated CFDIs with “reconciled” status. The note gives the percentage over all received lines. With no account statements, it shows “—”.',
    'All the lines of your fleet’s account statements, with no date cut, when the page opens. It does not include the provider breakdown below.',
  ),
  'peajes.por_conciliar': V(
    'To reconcile', 'Lines that the automatic matching could not link to an expense on its own.',
    'It is the total lines minus the reconciled ones and those with no matching expense.',
    'All the lines of your fleet’s account statements, when the page opens.',
    'Resolve them at the Fuel and tolls desk.',
  ),
  'peajes.sin_gasto': V(
    'No matching expense', 'Lines marked as no match: no toll expense corresponds to them.',
    'Counts the lines with “no match” status.',
    'All the lines of your fleet’s account statements, when the page opens.',
  ),
  'peajes.estados_cuenta': V(
    'Account statements', 'Consolidated CFDIs received for your fleet.',
    'Counts the distinct consolidated CFDIs that have at least one saved line.',
    'All of your fleet’s account statements, when the page opens.',
  ),
  'peajes.cuadran': V(
    'Match', 'Charges in the open breakdown that have a toll expense backing them.',
    'Counts the lines of the chosen breakdown whose charge has a toll expense with a matching amount and day and no other evidence against it. The note adds up their amount.',
    'The provider breakdown you have open, calculated when the page opens. It only appears if your fleet uses GPS evidence.',
  ),
  'peajes.por_verificar': V(
    'To verify', 'Charges in the open breakdown where the data falls short or there is a signal to look at.',
    'Counts the lines that, when in doubt, are left to verify, for example a different amount, two equally good expenses, a TAG from another unit or a GPS that does not match. The note adds up their amount.',
    'The provider breakdown you have open, calculated when the page opens.',
    'Review the reconciled log to see the reason for each line.',
  ),
  'peajes.sin_respaldo': V(
    'No backing', 'Charges where no toll expense or GPS evidence was found to back them.',
    'Counts the lines with a provider charge, with toll tickets loaded for the period, that none of them backs and that the GPS does not confirm either. It is a fact about your data, not an accusation of an improper charge.',
    'The provider breakdown you have open, calculated when the page opens.',
  ),

  // ═══ Tolls · panels ═══
  'peajes.subir_estado_cuenta': V(
    'Upload account statement', 'Manual upload of the consolidated CFDI XML of the TAG or wallet.',
    'When the XML is uploaded, the agent saves it and matches it instantly against the trips’ expenses. It only accepts the consolidated one; individual tickets come in over WhatsApp with their photo.',
    'The file you upload, up to 4 MB. Available to money-area roles and only if your fleet is not on the five-agent profile.',
  ),
  'peajes.esperan_humano': V(
    'Waiting for a human', 'Lines for which the automatic matching did not find a single expense.',
    'Lists the lines with “to reconcile” status with their date, description, amount and number of candidates. The sweep button matches them again against the expenses that arrived later.',
    'The most recent lines of your fleet, up to a cap; the total is counted separately and the screen says how many remain to be listed.',
    'Open “Resolve at the desk” or run the sweep.',
  ),
  'peajes.estados_recibidos': V(
    'Account statements received', 'Each consolidated statement received with its matching balance.',
    'Groups the lines by CFDI and shows their total amount and how many are reconciled, to reconcile and with no match. A consolidated statement marked “partial” exceeds the window that is read: its amount is a minimum, not the total.',
    'The most recent lines of your fleet; the 8 most recent consolidated statements are shown.',
  ),
  'peajes.desglose_proveedor': V(
    'Toll provider breakdown', 'Matching of the provider’s Excel, CSV or PDF against the trips’ toll expenses.',
    'Matches each line against the toll expenses by date (plus or minus one day) and amount, using each unit’s TAG to break ties. Each line ends up “matches”, “does not match” or “no counterpart”. What the data cannot support is not alleged.',
    'The file you upload. It shows the 8 most recent breakdowns that are not voided; you choose the one you open from the list.',
    'Upload the file, press “Reconcile” and review the buckets.',
  ),
  'peajes.desgloses_importados': V(
    'Imported breakdowns', 'List of the provider breakdowns already imported with their matching percentage.',
    'Shows per breakdown the provider or file, the period and the total lines. The percentage is the proportion of lines that match, rounded; with no lines it shows “—”.',
    'Your fleet’s breakdowns that are not voided, the 8 most recent.',
  ),
  'peajes.estimulo': V(
    'Toll incentive', 'What this screen produces versus what falls to your fleet.',
    'Each row says what its regulatory sheet supports: what this screen produces, what is a procedure or data from your fleet and what remains open. It does not assert that the incentive applies. The toll amount with the factor applied is gross and subject to those conditions.',
    'Toll with the factor already applied, your fleet’s history. It does not appear if your fleet is on the five-agent profile.',
    'Consult your accountant before using the amount: it is taxable income.',
  ),

  // ═══ Tolls · charge review ═══
  'peajes_cobros.por_vencer': V(
    'About to expire', 'Crossings that are claim candidates whose claim deadline is about to end.',
    'Adds up the crossings in the open file that no submitted claim covers and whose claim deadline expires soon, with their money. If the deadline’s base date is missing, it shows “no data” and not a zero.',
    'The open provider file, its submitted claims and the declared claim deadline, when the page opens.',
    'Prepare the claim for those crossings before the deadline expires.',
  ),
  'peajes_cobros.reclamado': V(
    'Claimed from the provider', 'Sum of the claims you registered for this file.',
    'Adds up the amount of this file’s claims in the tracking. With no registered claims it says so, it does not draw a measurement.',
    'Tracking of claims and credit notes for the open file.',
  ),
  'peajes_cobros.acreditado': V(
    'Credited by the provider', 'What the provider has already credited with credit notes for this file.',
    'Adds up the credit notes registered against this file’s claims.',
    'Tracking of claims and credit notes for the open file.',
  ),
  'peajes_cobros.pendiente': V(
    'Pending credit', 'What was claimed that the provider has not yet credited.',
    'Subtracts what was credited from what was claimed in this file. A zero balance means nothing is left to credit.',
    'Tracking of claims and credit notes for the open file.',
    'Follow up with the provider on what is missing.',
  ),
  'peajes_cobros.pct_revisado': V(
    'Candidates reviewed by a person', 'Share of the candidates that a person has already claimed, dismissed or justified.',
    'Divides the handled candidates by all of the file’s candidates. It is a different measure from what the system evaluates on its own and they are not added together.',
    'Charge review of the open provider file.',
  ),
  'peajes_cobros.cruces_evaluados': V(
    'Crossings evaluated automatically', 'Share of the crossings to which the system could apply at least one rule.',
    'Divides the crossings with some applicable rule by all of the file’s crossings. It does not say the charge is right or wrong.',
    'Charge review of the open provider file.',
  ),
  'peajes_cobros.atipicos_nuevos': V(
    'New atypical crossings', 'Crossings that the detector flags as atypical in this file and that you have not yet reviewed.',
    'Counts the findings of the atypical-crossings detector in this read. If the detector has not been run, it shows “no data”.',
    'Atypical-crossings detector over the open file.',
    'Review each finding; flagging it is not an accusation.',
  ),
  'peajes_cobros.sin_viaje': V(
    'Crossings without a trip', 'Crossings that could not be linked to any trip.',
    'Counts the file’s crossing-trip links in “no trip” status. If the matching with trips is not available, it shows “no data”.',
    'Matching of tolls with trips for the open file.',
    'Check whether the trip exists and the date of the charge.',
  ),

  // ═══ Tolls · settings ═══
  'peajes_config.buzon': V(
    'Provider automatic mailbox', 'Signed mailbox through which the provider or a script sends the file for each cutoff.',
    'Turns the mailbox on or off and shows its URL, the fleet header and the signing key. Submissions are validated with the signature; without the server secret the mailbox rejects every submission.',
    'Status of your fleet’s mailbox. The signing key, rotating and turning off are only seen by whoever manages the fleet.',
    'Rotate the key if you suspect it was exposed: the previous one stops working instantly.',
  ),
  'peajes_config.archivos_recibidos': V(
    'Files received', 'Files that arrived through the mailbox with their processing status.',
    'Lists each file with its status (queued, processing, processed or failed), provider, size, time in UTC and attempts. A file with an error shows the last error and, if possible, the Retry button.',
    'Files received through your fleet’s mailbox. Those that arrive with no provider ask you to enter it before retrying.',
  ),
  'peajes_config.mapeo': V(
    'Column mapping by provider', 'Which column in each provider’s file is date, toll booth, amount and so on.',
    'You declare per provider the columns by their exact header or by their letter. Date, toll booth and amount are required; time, TAG, unit and class are optional. With no mapping, the columns are detected by name. Saving the same provider replaces its mapping.',
    'Your fleet’s saved mappings.',
  ),
  'peajes_config.tags': V(
    'Toll TAGs by unit', 'Which TAG belongs to which unit.',
    'With the TAG registered, the matching knows which unit passed, breaks ties between two equal expenses and warns if the TAG belongs to a different unit than the trip’s. Removing a TAG flags for review the crossings after that date.',
    'Your fleet’s TAGs; the first 300 are shown. The bulk upload accepts a CSV with tag, unit and provider.',
  ),
  'peajes_config.casetas': V(
    'Toll booth catalog', 'Toll booths by name, with highway, whether they charge per pass and optional coordinates.',
    'Only the name is required. With coordinates, the GPS can be used to validate that the unit was there. It starts empty on purpose: Likida does not make up coordinates. Uploading the same name again updates its data.',
    'Your fleet’s toll booth catalog; the first 300 are shown. With no catalog, matching by toll booth stays “no data”, never an accusation.',
  ),
  'peajes_config.geocercas': V(
    'Geofences', 'Circles with a center and radius for yards, origins, destinations and points of interest.',
    'You save name, type, latitude, longitude and radius. The same name updates the geofence. Dwell times, the briefing and invoicing use them.',
    'Your fleet’s geofences. It is not shown if your fleet is on the five-agent profile.',
  ),
  'peajes_config.cursos': V(
    'Courses (authorized routes)', 'Toll booths that each unit or agreement may cross.',
    'A pass through a toll booth outside the course appears in the claim report as “Crossing outside course”. With no declared course, nothing is claimed for this reason. You upload CSV or Excel with code, name, unit, agreement and toll booths.',
    'Your fleet’s courses; the first 300 are shown. The polyline corridor is accepted, but the real format of your routes is still pending. It is not shown on the five-agent profile.',
  ),

  // ═══ Tolls · claim ═══
  'peajes_reclamacion.cruces': V(
    'Crossings to request review', 'Crossings in the breakdown with evidence to request a review from the provider.',
    'Only lines with evidence against the charge enter, each with a single reason (the strongest) and its confidence. “No data” does not count as evidence. The claimable amount is the sum of those crossings; it does not mean the charge is improper.',
    'The provider breakdown you opened, with your fleet’s GPS and courses. With the five-agent profile, the crossings are called candidates and there are no downloads.',
    'Review each crossing and decide yourself whether to request the review.',
  ),
  'peajes_reclamacion.leyendas': V(
    'What it means and what it does not assert', 'Report notices about its limits.',
    'It calculates nothing: it shows the notices that accompany the report so that it is read without overstating what it asserts.',
    'Text of the claim report itself.',
  ),

  // ═══ Vigía · board ═══
  'vigia.conversaciones_activas': V(
    'Active conversations', 'Customers with an open WhatsApp thread with Vigía.',
    'Counts the conversations with active status that are read for the board.',
    'The 100 most recent active conversations of your fleet. With more than 100 open, the figure does not go above 100.',
  ),
  'vigia.por_aprobar': V(
    'To approve', 'Replies Vigía drafted that are waiting for your touch.',
    'Counts the outgoing messages with pending-approval status.',
    'The 50 oldest of your fleet, read when the page opens.',
    'Approve or discard each draft in the approval queue.',
  ),
  'vigia.sin_respuesta': V(
    'No reply', 'Conversations waiting longer than the reply SLA in your settings.',
    'Counts the active conversations with an unanswered customer message whose wait equals or exceeds the SLA in minutes shown in the figure’s title.',
    'Active conversations read when the page opens; the wait is measured at that time.',
    'Take the thread with “I will handle it” in Exceptions.',
  ),
  'vigia.molestos_escalados': V(
    'Upset or escalated', 'Conversations with an upset customer or already escalated to a person.',
    'Counts the active conversations with an annoyance level of 2 or higher, or with an escalation level greater than 0.',
    'The active conversations read when the page opens (up to 100).',
    'Review the Exceptions panel.',
  ),

  // ═══ Vigía · board panels ═══
  'vigia.cola_aprobacion': V(
    'Approval queue', 'Replies drafted by Vigía that are waiting for you to approve them.',
    'Lists each draft with the customer’s message, the detected intent, the risk and the signals. The replies also reach you over WhatsApp with buttons.',
    'Your fleet’s outgoing messages pending approval, the 50 oldest. The owner or the manager decides; other roles only see the text.',
    'Edit the draft if needed and approve or discard it.',
  ),
  'vigia.excepciones': V(
    'Exceptions', 'Upset customers, no reply past the SLA or already escalated, and failed sends.',
    'Filters the active conversations that have at least one reason (annoyance, wait equal to or greater than the SLA, escalation) and sorts them by priority and wait time. It adds the sends that failed.',
    'Your fleet’s active conversations and failed sends from the last 24 hours, up to 20. “I will handle it” is only used by whoever can decide.',
    'Press “I will handle it” to reply yourself from the board.',
  ),
  'vigia.conversaciones': V(
    'Active conversations', 'List of open threads, with who is handling them and how long they have been waiting.',
    'Sorts the active threads by high priority and then by who has been waiting longest. Each one shows whether Vigía or a person is handling it, its wait and the customer’s last message.',
    'The 100 most recent active conversations of your fleet. The buttons to take, hand back, close and reply are seen by whoever can decide.',
    'When you take a thread Vigía stops drafting in it and you reply from here.',
  ),
  'vigia.configuracion': V(
    'Settings and SLA', 'Whether Vigía is on, its approval mode, its times and retention.',
    'It calculates nothing: it shows the saved values. The owner edits them in the form; everyone else sees them as a list.',
    'Your fleet’s Vigía settings. Only the fleet owner changes these values.',
  ),
  'vigia.bitacora': V(
    'Log', 'Vigía’s latest actions and who handles them, without customer text.',
    'Lists the most recent events with their plain-language name, the level if applicable and the time. It does not store customers’ text or their phone numbers.',
    'The 40 most recent events of your fleet.',
  ),
  'vigia.clientes_autorizados': V(
    'Authorized customers', 'Customer numbers Vigía may serve, with their consent.',
    'Lists your fleet’s contacts with customer, name, last 4 digits of the phone, status and consent date. Only these numbers receive service from Vigía.',
    'Your fleet’s contacts that have not been suppressed, up to 200. The owner authorizes, removes or suppresses; other roles only view.',
  ),
  'vigia.directores': V(
    'Who Vigía notifies', 'List of people it notifies when a customer waits too long or gets upset.',
    'Notifies level 1 and, if nobody responds, level 2, by WhatsApp, email or both. With no list, it notifies as usual: the customer’s owner or the fleet manager (level 1) and the owner (level 2). If someone has only email and the fallback is off, the screen flags it.',
    'Your fleet’s list of directors, up to 40. Only the owner edits it.',
  ),
  'vigia.servicio': V(
    'Who it notifies when there is no data', 'Customer service people Vigía notifies if it does not have the data.',
    'When a customer asks something the system does not have, Vigía notifies these people privately. With no list, it notifies as usual: the customer’s owner or the fleet manager. It allows up to 10 people.',
    'Your fleet’s customer service list. Only the owner edits it; whoever only views sees the phone masked and no email.',
  ),
  'vigia.correos': V(
    'Email notices', 'Latest notices attempted by email because WhatsApp did not go out.',
    'Lists each attempt with its status (in progress, sent, rejected, missing configuration or network failure), its level and the time.',
    'The 15 most recent notices of your fleet. If it says “missing configuration”, Likida’s email is not yet turned on for your fleet.',
  ),
  'vigia.limites': V(
    'Vigía’s limits', 'Fixed text about what Vigía never does.',
    'It calculates nothing: it is the screen’s text. It summarizes that it only replies to authorized customers, that each figure comes from real data of that customer’s trip, and what happens with WhatsApp’s 24-hour window.',
    'Text written on the screen; it does not read your fleet’s data.',
  ),
  'vigia.resultados': V(
    'Agent results', 'Cards with what happened, what it means and what to do, each with its source.',
    'Builds four cards from notices and messages: time saved, on-time notices, first reply and prioritized messages. The saving is an estimate with an assumption of minutes per notice, labeled as such, and never a percentage. With no data it says “—”.',
    'Your fleet’s notices and messages; each card indicates its source.',
    'Replace the minutes-per-notice assumption with the real time you measure with your team.',
  ),

  // ═══ Vigía · trip notices ═══
  'vigia_avisos.dia': V(
    'Notices by day', 'Trip notices Vigía builds, grouped by day and by customer.',
    'Groups the notices by the date of the dispatch schedule on their row (nearest day first and “no date” at the end) and, within each day, by customer. Each card is confirmed, edited or discarded.',
    'Your fleet’s notices from the last 14 days, plus the pending ones of any age, up to 300. With “Only pending” you see what remains to be resolved. The owner or the manager decides; the rest see without full phone numbers.',
    'Confirm, edit or discard each pending notice.',
  ),

  // ═══ Vigía · unattended conversations ═══
  'vigia_sin_atender.lista': V(
    'Unattended conversations', 'Customer messages in the exported chats that the team has not answered.',
    'With no AI model: it gathers the customer’s consecutive messages that no team message followed and compares them with the fleet’s deadline (shorter for critical customers and for urgent matters). It sets high priority if there is urgency, an important topic or a question past its deadline. Times are measured against the export’s time, not against today.',
    'Exported chats you uploaded to your fleet’s groups (the most recent messages of each). It is not real time: it arrives as late as you upload the chat.',
    'Answer the high-priority ones first and upload a new chat to refresh the list.',
  ),
  'vigia_sin_atender.config': V(
    'Your fleet’s settings', 'What you fix in place for the review of your fleet’s unattended conversations.',
    'Saves the service hours (waiting outside them does not count), the words that mark urgency or an important topic, your team’s names, how many consecutive messages count as chasing, the deadline for urgent matters and whether your fleet allows the email summary. With nothing saved, everything is off: waiting counts elapsed minutes and no email is sent.',
    'What whoever manages the fleet types; it does not read chats or store messages. The team’s names are saved exactly as you type them.',
    'Check that the team’s names are written the same as in the chat and review the list again.',
  ),
  'vigia_sin_atender.correo': V(
    'Email summary', 'Email with the unattended conversations for the people on the current shift.',
    'Builds an email with the group, the priority, the time without a reply and the reason; it does not carry the message text. It goes to customer service and to the current shift’s directors; to the owner only if there is a high alert in a critical group. Sending it twice in a row in the same shift normally does not duplicate it, but this is not guaranteed: press the button only once.',
    'Emails of customer service and of Vigía’s directors list, with their shift and your fleet’s holidays. It only goes out when whoever manages presses the button and sending is turned on on the platform and for your fleet.',
  ),

  // ═══ Vigía · groups and history ═══
  'vigia_historial.grupos': V(
    'Groups', 'Your customers’ WhatsApp groups, with their critical mark and their history.',
    'It calculates nothing: it lists each group with its customer, whether it is critical and how many messages it has uploaded. Vigía does not read the groups live.',
    'Groups you registered in your fleet. Marking as critical and deleting them is done only by the fleet owner.',
  ),
  'vigia_historial.alta': V(
    'Add a group', 'Registration of a customer’s WhatsApp group.',
    'Registers the group with its customer; afterwards you can mark it as critical and upload exported chats to it.',
    'Your fleet’s groups. Only the fleet owner sees and saves it.',
  ),
  'vigia_historial.importar': V(
    'Upload the exported chat', 'Upload of a group’s exported chat to analyze it.',
    'You upload the exported file of an already registered group. The report below is built from what you upload.',
    'The file you upload. Only the fleet owner sees and uses it; it appears once there is at least one group.',
  ),
  'vigia_historial.rapidas': V(
    'Approved quick replies', 'Replies you approved for questions similar to those your customers have already asked.',
    'When a customer writes something Vigía does not understand and it resembles one of these questions, the draft goes out with the reply you approved. It always reaches you for approval before it is sent.',
    'Your fleet’s quick replies. The owner or the manager approves and removes them. With the five-agent profile it is not shown.',
    'Approve them from the report’s frequently asked questions.',
  ),
  'vigia_historial.reporte': V(
    'History report', 'Analysis of the chats you uploaded: frequent questions, topics and times.',
    'Analyzes the imported messages with no AI model: topics come from keyword rules and what does not fit stays in “Others”. It can be downloaded as Excel or PDF.',
    'Chats you uploaded, from the chosen group or from all. It uses up to the 50,000 most recent messages and warns if there are more.',
  ),
  'vigia_historial.pendientes': V(
    'Pending in the uploaded chat', 'Customer messages that the team did not answer in the exported chat.',
    'Detects the customer’s messages with no team reply within one hour, with a high or normal level. It hides “thanks”, monitoring notices and what has already been answered. Age is measured against the file’s last message, not against today.',
    'It is a snapshot of the moment of the export, not a live board.',
  ),
  'vigia_historial.tiempos': V(
    'Team response time', 'Median and 90th percentile of how long your team takes to reply.',
    'For each customer message that asks for something, measures the minutes until the team’s next reply. It shows the median, the 90th percentile and how many waits went past the threshold, and includes the messages nobody answered.',
    'Chats uploaded for the chosen group or for all. Greetings and thanks do not count as waits.',
  ),
  'vigia_historial.faqs': V(
    'Frequently asked questions', 'Similar customer questions that repeat, with the answer your team usually gives.',
    'Groups questions with words in common and shows those that repeat at least 2 times, with how many times and over how many days. It leaves out complaints and requests to speak with a person. The typical answer is the one the team gave most often within the following hour.',
    'Chats uploaded for the chosen group or for all.',
    'If your role approves, turn it into a quick reply from here.',
  ),
  'vigia_historial.temas': V(
    'Topics and trend', 'How many customer messages there are per topic and whether they are rising or falling.',
    'Counts the customer messages per topic and compares the last 4 weeks against the previous 4. With less than 8 weeks of chat it says “Short history”, not a change.',
    'Chats uploaded for the chosen group or for all. Topics come from keywords.',
  ),

  // ═══ Vigía · import status ═══
  'vigia_importacion.subir': V(
    'Upload the day’s schedule', 'Upload of the schedule CSV to calculate the status of each container.',
    'You choose the terminal and upload the file; the status is derived from its TRANSITO and CCP columns. Only the file is read: nothing is saved or written to any other system.',
    'The file you upload, up to 12 MB. The Excel with colors (.xlsx) is not read yet: save it as CSV.',
  ),
  'vigia_importacion.estatus_dia': V(
    'Status by day', 'Import containers by day, with their status derived from the schedule.',
    'Counts distinct containers per day in the import section and splits them among in yard, pending crossing, en route, documents ready, pending requirement and no status. Rows with no section date are not counted.',
    'The file you just uploaded. It is derived from the schedule and not verified against Track & Trace.',
    'Download the CSV to paste it into your schedule.',
  ),
  'vigia_importacion.incoherencias': V(
    'Rows that do not match', 'Schedule rows where TRANSITO and CCP contradict each other.',
    'Flags two cases: documents at “LISTO” with an empty TRANSITO column, and a container “EN RUTA” with documents still pending a requirement.',
    'The file you just uploaded; the first ones are listed and the rest are in the CSV.',
    'Fix those rows in your schedule.',
  ),
  'vigia_importacion.track_trace': V(
    'Comparison with Track & Trace', 'Containers where the schedule and Track & Trace do not agree.',
    'If Track & Trace were connected, it would compare the schedule’s status with its own. Today it says it is not connected and there is nothing to compare against.',
    'Track & Trace is not connected on this screen, so no comparison is shown.',
  ),

  // ═══ Vigía · dispatch schedule ═══
  'vigia_programa.subir': V(
    'Upload the day’s schedule', 'Upload of the dispatch schedule CSV so Vigía notifies your customers.',
    'You choose the terminal and upload the day’s full file. If it was already loaded, nothing is duplicated; if it changed, what changed is saved.',
    'The file you upload, up to the cap the screen states, not counting empty columns. Only the owner or the fleet manager uploads; the rest see the screen without uploading. With Vigía off it is saved, but customers are not notified.',
  ),
  'vigia_programa.entendi': V(
    'What I understood', 'Summary of what was read and saved from the file.',
    'Says how many rows it read, over how many days and how many could not be read, and what it saved: new rows, rows with changes and unchanged rows. Rows that no longer come are left hidden, not deleted.',
    'The file you just uploaded.',
  ),
  'vigia_programa.descarte': V(
    'What I discarded', 'Rows of the file that could not be read, with their reason.',
    'Lists the first discarded rows with their line in the file and the reason, for example that it carried no container, unit or customer, and how many more there are.',
    'The file you just uploaded.',
  ),
  'vigia_programa.por_dia': V(
    'By day', 'Schedule rows by day, with how many have no container and how many carry a notice.',
    'Groups the rows read by their section date and counts, per day, rows, rows without a container and rows with a notice.',
    'The file you just uploaded.',
  ),
  'vigia_programa.revisar': V(
    'Rows worth reviewing', 'Schedule rows with notices that a person should look at.',
    'Lists the first rows that carry notices, with their line in the file, their date and the text of each notice, and how many more there are.',
    'The file you just uploaded.',
    'Fix those rows in your schedule and upload it again.',
  ),
};
