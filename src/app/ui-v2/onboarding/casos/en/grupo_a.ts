import type { CasosGrupo } from '../tipos';

// English (US) copy of `../grupo_a.ts`: same routes, same number of steps, same stages.
export const CASOS_A_EN: CasosGrupo = {
  '/dashboard/agentes/liquidacion': {
    titulo: 'Example: an operator settlement arrives',
    pasos: [
      { etapa: 'entra', ancla: 'pantalla.titulo', titulo: 'The operator calculation arrives',
        texto: 'Your system sends it by API or an Excel file arrives by email. The agent receives it and puts it in its queue.' },
      { etapa: 'procesa', titulo: 'Checked against trips, expenses, policy',
        texto: 'The agent checks the calculation against the operator’s trips and expenses and confirms there is a policy. Anything that does not match is flagged.' },
      { etapa: 'decide', titulo: 'If there is an exception, it is held',
        texto: 'It is held if the net is negative, the policy is missing or the operator has no email. Everything else goes on by itself.',
        persona: 'A person reviews what is held, fixes the cause and releases the delivery. The agent does not decide for them.' },
      { etapa: 'sale', titulo: 'The Excel and PDF go out by email',
        texto: 'What passes the review is delivered by email as Excel and PDF to the operator, the coordinator and HR. The agent does not pay or move money.' },
    ],
  },
  '/dashboard/agentes/peajes': {
    titulo: 'Example: the toll account statement arrives',
    pasos: [
      { etapa: 'entra', ancla: 'pantalla.titulo', titulo: 'You upload the month’s account statement',
        texto: 'It is the IAVE or PASE file. Without it there is nothing to reconcile: the agent does not estimate tolls that were not crossed.' },
      { etapa: 'procesa', titulo: 'Crossings are matched against the GPS',
        texto: 'The agent compares each charge on the statement with the route the GPS recorded and with what the trips verified.' },
      { etapa: 'decide', titulo: 'Charges that do not match are flagged',
        texto: 'A charge with no route behind it, or a repeated one, is flagged with its match in plain view.',
        persona: 'A person decides which charges get claimed. The agent proposes; it does not claim on its own.' },
      { etapa: 'sale', titulo: 'The claim is built, with its deadline',
        texto: 'For each charge you decide to claim, the agent builds the claim and shows the deadline to file it with the toll operator.' },
    ],
  },
  '/dashboard/agentes/carta-porte': {
    titulo: 'Example: a trip is dispatched without a declared route',
    pasos: [
      { etapa: 'entra', ancla: 'pantalla.titulo', titulo: 'The trip and shipment documents',
        texto: 'The trip arrives from your TMS when it is dispatched. Shipment documents (PDF, Excel, XML or photo) reach the inbox on their own through the fleet email.' },
      { etapa: 'procesa', titulo: 'The draft is built and checked',
        texto: 'The agent runs the legal tree, builds the draft of the complement and checks it against what the PAC would surely reject. A key it cannot verify is marked that way.' },
      { etapa: 'decide', titulo: 'If data is missing, it asks',
        texto: 'If the trip does not say whether the route uses a federal highway, the agent asks on WhatsApp. Until answered it stays as missing declaration; it never says you do not need it.',
        persona: 'Whoever knows the route answers on WhatsApp. The declaration is signed with who and when.' },
      { etapa: 'sale', titulo: 'Checked draft, not stamped',
        texto: 'Once declared, the trip is marked as needing the complement or not, and the draft can be opened and printed. Likida prepares and checks; your PAC stamps. Likida never stamps.' },
    ],
  },
  '/dashboard/carta-porte': {
    titulo: 'Example: you review trips before they leave',
    pasos: [
      { etapa: 'entra', ancla: 'pantalla.titulo', titulo: 'Trips in progress, already assessed',
        texto: 'Each trip in progress enters the list with its route and what the fleet and the customer have already declared. The list says if it assesses only part of the trips.' },
      { etapa: 'procesa', titulo: 'What is missing, and whose',
        texto: 'For each trip the complement data is checked and split between customer and carrier, because each party answers for what it provided.' },
      { etapa: 'decide', titulo: 'The traffic light says what is next',
        texto: 'Each trip ends up as needs complement, no complement or missing declaration. When missing, the trip waits for a declaration, not a guess.',
        persona: 'Whoever knows the route declares what is missing; Likida does not guess it. What belongs to the customer is requested from the customer.' },
      { etapa: 'sale', titulo: 'You open the trip draft',
        texto: 'The Open button takes you to that trip’s printable draft, with what is declared and what is still missing. It is a draft: Likida does not stamp the complement.' },
    ],
  },
  '/dashboard': {
    titulo: 'Example: you open the Summary in the morning',
    pasos: [
      { etapa: 'entra', ancla: 'pantalla.titulo', titulo: 'Each agent reports its work',
        texto: 'Settlement, tolls, Cargo Waybill, customer service and operators leave their last run and their pending items. The Summary reads that; nobody types it in.' },
      { etapa: 'procesa', titulo: 'It is summarized by agent',
        texto: 'Each card says what that agent did and its state. Each figure carries its period and source; if something could not be measured, it says so instead of showing a zero.' },
      { etapa: 'decide', titulo: 'What waits for a person comes first',
        texto: 'The attention block gathers what is pending and what failed. What the agent did alone is kept apart, so it is not mistaken for what needs a decision.',
        persona: 'A person opens the agent card and resolves the pending item on its screen. The Summary does not decide for them.' },
      { etapa: 'sale', titulo: 'You go to the right screen',
        texto: 'Each card leads to its agent screen. The period is changed at the top and moves the figures that depend on it.' },
    ],
  },
  '/dashboard/chat': {
    titulo: 'Example: you ask your data a question',
    pasos: [
      { etapa: 'entra', ancla: 'pantalla.titulo', titulo: 'You type your question in Spanish',
        texto: 'You write as you would ask a colleague: for example, what is waiting for a decision today or which customers have been waiting for an answer.' },
      { etapa: 'procesa', titulo: 'Your fleet data is queried',
        texto: 'The assistant queries only your fleet data, step by step, and shows live what it is checking.' },
      { etapa: 'decide', titulo: 'If the data does not exist, it says so',
        texto: 'If there is no data, the answer says so; it does not invent a figure or fill it in. A proposed action does not run on its own.',
        persona: 'A person confirms any action the assistant proposes before it is carried out.' },
      { etapa: 'sale', titulo: 'An answer with its path',
        texto: 'The answer includes the How I got here drop-down, with the steps taken. Use it to cross-check a figure before signing it.' },
    ],
  },
};
