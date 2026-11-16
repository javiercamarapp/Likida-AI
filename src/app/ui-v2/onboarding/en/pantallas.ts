import type { ClaveVariante } from '../tipos';

// English (US) copy of `../pantallas.ts`. Same keys (route) and same shape of text; icons, anchors and permissions stay in the Spanish
// file, so only what the person reads is repeated here. Limits: title <= 48 and text <= 180 characters (`validarRecorrido`).
// Server-only, like the Spanish catalog: the browser never imports it (the tour arrives already built).

export interface PantallaEn {
  que: string;
  claveTitulo: string;
  claveTexto: string;
  accion?: { titulo: string; texto: string; verbo: string; objetivo: string };
  variantes?: Partial<Record<ClaveVariante, Partial<{ que: string; claveTitulo: string; claveTexto: string }>>>;
}

const p = (que: string, claveTitulo: string, claveTexto: string, extra: Pick<PantallaEn, 'accion' | 'variantes'> = {}): PantallaEn => ({ que, claveTitulo, claveTexto, ...extra });
const a = (verbo: string, objetivo: string, titulo: string, texto: string) => ({ verbo, objetivo, titulo, texto });

export const PANTALLAS_EN: Readonly<Record<string, PantallaEn>> = {
  '/dashboard': p(
    'Your fleet at a glance. Every figure states its period; if something could not be measured, it says so instead of showing a zero.',
    'Start with what needs your attention', 'Pending and failed items come first. Open the block that is yours and resolve it on its own screen.',
    { variantes: {
      cinco_agentes: { que: 'Your five agents at a glance: what each one did and what is waiting for a person.', claveTitulo: 'One card per agent', claveTexto: 'Each card leads to its agent’s screen. There you decide what the agent cannot decide alone.' },
      encargado: { que: 'What to dispatch and chase today. Your role sees operations, without money.', claveTitulo: 'Unassigned and load per driver', claveTexto: 'Below you see unassigned trips, load per driver and recent trips. The Dispatch button creates a trip.' },
    } }),
  '/dashboard/contador': p(
    'Verified money and the paperwork behind it, with its basis cited.',
    'Money and paperwork, side by side', 'Each figure comes with its receipt and its basis. If the paperwork is missing, the figure is not taken as good.'),
  '/dashboard/chat': p(
    'Ask about your trips and settlements in plain language. It answers with your fleet’s data.',
    'Write as you would ask a colleague', 'If the data does not exist, the answer says so. Use it to cross-check a figure before you sign it.'),

  '/dashboard/arranque': p(
    'The startup checklist for a new fleet, with the real status of each step.',
    'Every step comes from a real signal', 'A step that could not be verified says so. There are no invented checkmarks.'),
  '/dashboard/puesta-en-marcha': p(
    'Get your operation ready so your agents work with your real data. Here you see what is missing and whose it is.',
    'Your progress, no embellishment', 'Only what is truly ready counts. If something could not be verified, it tells you instead of checking it off.',
    { accion: a('Open', 'a step', 'Open the next step', 'Each step explains what is needed, who has it and how to ask for it.') }),
  '/dashboard/despacho': p(
    'This is where you act: create the trip with its driver, notify and nudge the driver, and add drivers.',
    'A new trip starts here', 'The driver is required. When the trip is created, the notice goes out by WhatsApp to the driver; if it fails, the trip stays and you can resend.',
    { accion: a('Create', 'a trip', 'Create the trip with its driver', 'Enter the trip and pick a driver: without one it is not created. Once created, the notice goes out by WhatsApp.') }),
  '/dashboard/convenios': p(
    'Each customer’s profile: gate, who to report to and documents. The driver’s instructions come from here.',
    'One agreement per customer', 'What you load here is what the driver receives before arriving. Check that it is current.'),
  '/dashboard/viajes': p(
    'Your fleet’s trip records, browsable and filterable. Creating, assigning and notifying happen in Dispatch.',
    'The record, not the operation', 'Filter and open a trip to see its reconciliation. If you need to change it, do it in Dispatch.'),
  '/dashboard/operadores': p(
    'Your roster of drivers with phone and license expiry. Without a phone on file, agents cannot message them.',
    'The phone number comes first', 'A driver without a phone gets no notices. Also check licenses about to expire.',
    { accion: a('Add', 'a driver', 'Add a driver', 'A name and phone are enough to start. You complete the license afterwards.') }),
  '/dashboard/jornada': p(
    'The duty-shift record required by labor law, per driver. It records and warns; it does not replace the hours logbook.',
    'Recording is not certifying', 'Likida notes and warns. Correcting a recorded hour has legal consequences, so it stays in plain view.'),
  '/dashboard/unidades': p(
    'Your units with the expiry dates the law requires. Anything expired or about to expire shows first.',
    'Expired items go on top', 'A unit with an expired document should not leave. Check these rows before dispatching.',
    { accion: a('Add', 'a unit', 'Add a unit', 'Enter plates and expiry dates. Expiry alerts come from those dates.') }),
  '/dashboard/patios': p(
    'A yard is the place your units leave from. With them, each dispatch manager sees and fixes their own.',
    'One yard per dispatch manager', 'Assign drivers and units to their yard. Whoever has a yard only fixes what is in their yard.'),
  '/dashboard/mapa': p(
    'Your trips in progress over Mexico. The route is illustrative; trips that could not be located go in the list.',
    'An illustrative route is not GPS', 'The line shows origin and destination, not where the truck is. The real position is in Live trips.'),
  '/dashboard/viajes-en-vivo': p(
    'Trips in progress with their latest milestone and the truck’s position, and how old it is.',
    'Watch the age of the position', 'An old position is labeled as old. Exceptions appear so a person can handle them.'),
  '/dashboard/carta-porte': p(
    'For each trip in progress: whether it needs the Carta Porte complement and what is missing, split by who is responsible.',
    'What is missing and whose it is', 'Each trip separates what your fleet declares from what the customer must give you. Ask the customer for theirs before the trip.',
    { accion: a('Declare', 'what is missing', 'Declare what is missing on the trip', 'Enter the trip declaration here, such as the route. Let whoever knows the route do it; Likida does not guess.') }),
  '/dashboard/carta-porte/documentos': p(
    'The documents your customers send: the agent reads them and a person reviews and approves them side by side.',
    'Review side by side', 'On the left the document; on the right what the agent read. Nothing is used until you approve it.'),
  '/dashboard/emergencias': p(
    'The tow truck, the policy and the contacts escalation uses when a driver reports and nobody answers.',
    'Load it before you need it', 'If the directory is empty, escalation has nobody to call. Check that the phone numbers work.'),
  '/dashboard/asistencia': p(
    'Live incidents with their timeline and the intervention buttons. A person can always take over.',
    'Take over when needed', 'The agent helps the driver on the road; you see every step and can step in.'),
  '/dashboard/whatsapp': p(
    'Which number each driver writes to and what happens next: trip notices, ticket photos and settlement.',
    'Give it to your drivers once', 'Share the link or the QR code. From then on everything happens in their WhatsApp.'),

  '/dashboard/huerfanos': p(
    'Photos and receipts that arrived without a trip are kept here until someone files them. Nothing is rejected.',
    'File them under their trip', 'While they have no trip they are kept here and nothing is rejected. File each receipt under the trip it belongs to.'),
  '/dashboard/combustible-casetas': p(
    'The two items that weigh most in a trip, and how much of them is invoiced.',
    'Reconciliation line by line', 'Each row is matched against the trip. Whatever does not match is flagged for you to resolve.'),
  '/dashboard/rentabilidad': p(
    'Real margin against what is verified, receivables and what is overdue per customer. If the data does not exist, it says so.',
    'Missing data is not zero', 'If the data does not exist, the screen says so instead of showing a zero. Check what is missing before reading a margin.'),
  '/dashboard/clientes': p(
    'Who pays the freight and how much they owe, with each customer’s rates. A half-complete receivables view is never shown.',
    'Customers, rates and trips with no revenue', 'Three blocks: the customer list, their rates and trips with no revenue entered. Missing data is stated, not filled in.'),
  '/dashboard/cotizaciones': p(
    'A trip’s real profit before accepting it: declared costs, measured tolls and every assumption in plain view.',
    'Every assumption is visible', 'The quote separates what is measured from what is declared. Change an assumption and you will see how the profit moves.'),
  '/dashboard/facturacion': p(
    'Issued invoices, their payments and settled trips awaiting invoicing. If data is missing, it says so; a zero is never shown.',
    'What you invoiced and what you are owed', 'On top, what you invoiced and what you are owed; below, the settled trips nobody invoiced.'),
  '/dashboard/timbrado': p(
    'This is where the CFDI with the Carta Porte complement is issued. It is a tax act: canceling has a window and a reason.',
    'Review before stamping', 'Confirm the tax data and the freight. Only the owner and the accountant can stamp.',
    { accion: a('Stamp', 'the CFDI', 'Stamp only when everything is reviewed', 'Stamping fixes the trip’s revenue. If you doubt any data, do not issue it.') }),
  '/dashboard/reglas': p(
    'Write what you want to be alerted about and it becomes a specific watch. It is checked every hour and each case alerts once.',
    'Write it in plain language', 'One rule per sentence. Likida shows how it understood it before you turn it on.'),
  '/dashboard/descarga-sat': p(
    'The CFDIs your suppliers already stamped to your RFC, downloaded from the SAT mailbox and matched against the ticket.',
    'Declare your RFC once', 'The download uses the SAT’s daily cap for that taxpayer. That is why it is declared and monitored.'),
  '/dashboard/descarga-sat/bandeja': p(
    'What came down from the SAT and did not match on its own: here the controller decides each case.',
    'Decide case by case', 'Each row says why it did not match. What you resolve leaves invoiced expenses.'),

  '/dashboard/agentes/liquidacion': p(
    'The agent builds each trip’s settlement: what awaits your signature, what it did on its own and the criteria it judges by.',
    'Indicators and review queue', 'On top, the agent’s indicators and the queue awaiting review. Below, what it did on its own and the rules it judges by.',
    { variantes: {
      nomina: { que: 'Here you see counts only: statements received, sent, held, bounced and without policy. No pesos or names with amounts.', claveTitulo: 'Counts only', claveTexto: 'Your role does not see amounts or net pay per person. The numbers count documents, not money.' },
    },
    accion: a('Open', 'a settlement', 'Open one from the queue and review it', 'Inside you see advance, verified and difference. Signing authorizes a payment to the driver and closes the trip’s tax file.') }),
  '/dashboard/agentes/facturas': p(
    'Tickets without a CFDI: what is yours to do, what the machine resolves on its own and what is incomplete or overdue.',
    'Three piles', 'Handle the incomplete or overdue first; what the machine resolves on its own is audited afterwards.'),
  '/dashboard/agentes/cobranza': p(
    'Whom the agent will chase for receipts and whom it cannot, with the reason. It collects receipts, not money.',
    'The reason behind each case', 'If the agent cannot chase someone, it says so and explains why.'),
  '/dashboard/agentes/conductores': p(
    'The WhatsApp acceptance queue, what the agent sealed and what it understands from what your drivers write.',
    'The acceptance queue', 'Each trip waits for the driver to accept it. If the driver does not answer, the agent follows up and escalates.'),
  '/dashboard/agentes/vigia': p(
    'It serves your fleet’s customers: classifies, answers with real data and escalates to a person whatever requires it.',
    'Approve with one tap', 'Anything upsetting or unanswered goes up to a person. You answer what the agent must not.'),
  '/dashboard/agentes/peajes': p(
    'The TAG or wallet statement against the expenses verified by trips, and the status of the toll incentive.',
    'Upload the statement', 'The agent matches it against the trips. What does not match stays in view, with its match.',
    { accion: a('Upload', 'the statement', 'Upload the month’s file', 'Once the file is loaded, the agent does the match. Until you upload it, there is nothing to reconcile.') }),
  '/dashboard/agentes/proveedores': p(
    'The inbox where the shop’s XML awaits your decision, and the output that avoids keying it into the ERP by hand.',
    'Decide on each XML', 'Review the shop’s XML and approve or reject it. The output avoids manual entry.'),
  '/dashboard/agentes/carta-porte': p(
    'On dispatch it runs the legal tree and asks by WhatsApp for what is missing. It prepares and validates; it never stamps.',
    'What is missing, asked of the driver', 'The agent builds the draft and asks for what is missing. A person reviews it before it goes out.'),

  '/dashboard/conocimiento': p(
    'The regulatory sheets a figure in your settlement depends on, with their verification status at the source.',
    'Where each tax figure comes from', 'Each sheet says whether it was already verified against the original source. An unverified one is marked as such.'),
  '/dashboard/conexiones': p(
    'What your fleet has connected and what it lacks; each status comes from a measurement, not a decorative traffic light.',
    'What is connected, measured', 'Each row comes from a check. Here you see what is missing, not a decorative traffic light.',
    { accion: a('Click', 'Test', 'The access is stored here', 'When your systems team gives you the access, you enter it once and it is stored encrypted. Then you click “Test”.') }),
  '/dashboard/llaves-api': p(
    'With a key, one of your systems uses the Likida API with no browser or session. Here you issue and revoke them.',
    'The key is shown only once', 'Copy it when you issue it. If it is lost, revoke it and issue another. Never send it by email.',
    { accion: a('Issue', 'a key', 'Issue one key per system', 'One key per system lets you revoke one without affecting the others.') }),
  '/dashboard/sesiones-mcp': p(
    'Who on your team has Claude or ChatGPT connected to Likida, with what role and since when. Read-only.',
    'Check who reads your data', 'It is the same question as API keys, with another credential. Here you only look.'),
  '/dashboard/usuarios': p(
    'Who signs in to this panel and what they can see.',
    'One role per person', 'Each role sees only its own. Give the minimum role the person needs.',
    { accion: a('Invite', 'a person', 'Invite your team', 'You enter their email and role. They sign in with a magic link sent to that email; there is no password. The role defines what they see.') }),
  '/dashboard/onboarding': p(
    'The fleet profile: what Likida needs to know about your operation to reconcile your trips.',
    'Answer with what you know', 'Leave blank what you do not know. Likida does not fill it in for you.'),
  '/dashboard/politicas': p(
    'The caps the engine reconciles each of your fleet’s trips against.',
    'Caps, route rules and tax caps', 'Three blocks: caps per item, route rules and the tax caps the engine applies. Review each one before saving.'),
  '/dashboard/arco': p(
    'Your drivers’ requests about their data and how to answer them on time. The law allows twenty business days.',
    'Every request has a deadline', 'Handle the one closest to its deadline first. Answering late is non-compliance.'),
  '/dashboard/legal': p(
    'Acceptance of the Terms, the Privacy Notice and the self-invoicing mandate, with their evidence.',
    'Accepting leaves evidence', 'Date, person and document version are recorded. Read before accepting.'),
  '/dashboard/conversaciones': p(
    'What your bot discussed with your drivers, exactly as it was stored. Use it to verify what a driver was told.',
    'The record, unedited', 'It is the original thread. Use it when a driver says nobody notified them.'),

  '/dashboard/notificaciones': p(
    'What needs a person today. Each row leads to the screen where it is resolved.',
    'One notice, one screen', 'Open the row and you land where it is resolved. You only see notices for screens your role can open.'),
  '/dashboard/mi-perfil': p(
    'Your photo, name and email, and your account’s security: second factor, active sessions and connected MCP clients.',
    'Turn on the second factor', 'It protects your account even if someone knows your email. Close any session you do not recognize here.'),
  '/dashboard/soporte': p(
    'Tickets with priority, a response clock and the conversation with Likida.',
    'Write with the full context', 'Say which screen, what you expected and what happened. A clear ticket is answered faster.'),
  '/dashboard/suscripcion': p(
    'Your Likida plan, what you have used and your invoices.',
    'Plan and usage', 'Here you see what you use and your Likida invoices. The owner changes the plan.'),
  '/dashboard/configuracion': p(
    'What the engine uses to reconcile your trips.',
    'The company, the settings and the units', 'Here live the company data, your operation’s settings and the calibrated units. What you change is used by the engine when reconciling.'),
};
