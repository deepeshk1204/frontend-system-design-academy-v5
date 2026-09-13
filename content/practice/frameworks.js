/* ===========================================================
   frameworks.js — the structure the mock interview enforces,
   plus the rubric you grade yourself against afterwards.
   =========================================================== */

/** 45-minute system design round, proportioned the way real loops run. */
export const PHASES = [
  {
    id: 'scope',
    name: 'Clarify & scope',
    minutes: 5,
    goal: 'Establish what you are actually being asked to build before you draw anything.',
    prompts: [
      'Who are the users, and how many of them are there?',
      'Which two or three capabilities are in scope? Say out loud what you are excluding.',
      'What is the one property that must not break -- correctness, latency, availability, or cost?',
      'Is this greenfield, or are you evolving something that already has users?'
    ],
    tell: 'Interviewers score this heavily and candidates rush it. Five minutes of scoping buys you thirty minutes of relevant design.'
  },
  {
    id: 'requirements',
    name: 'Requirements & scale',
    minutes: 5,
    goal: 'Turn the scope into numbers and explicit non-functional targets.',
    prompts: [
      'Functional requirements as a short numbered list you will design against.',
      'Non-functional targets with numbers: p99 latency, availability, durability, freshness.',
      'Back-of-envelope: DAU to requests per second, read/write ratio, payload size, storage per year.',
      'State your assumptions out loud and invite correction -- a wrong assumption you named is fine, an unnamed one is not.'
    ],
    tell: 'Any number is better than no number. "Roughly 50k rps peak, 10:1 read-heavy" changes every subsequent decision, and interviewers want to see you use it.'
  },
  {
    id: 'highlevel',
    name: 'High-level design',
    minutes: 10,
    goal: 'One diagram, the data model, and the happy-path request traced end to end.',
    prompts: [
      'Draw the boxes and the arrows. Name each component by responsibility, not by product.',
      'Define the core entities and the primary access patterns against them.',
      'Trace one concrete write and one concrete read all the way through.',
      'Name the API contract for the main operation, including its idempotency semantics.'
    ],
    tell: 'Keep it boring and complete. Introducing Kafka in minute three without saying why is a negative signal, not a positive one.'
  },
  {
    id: 'deepdive',
    name: 'Deep dive',
    minutes: 15,
    goal: 'Go three levels deep on the genuinely hard part.',
    prompts: [
      'Name the hardest component yourself and justify why it is the hardest.',
      'Give the mechanism: the data structure, the algorithm, the exact key, the specific policy.',
      'Give a real alternative you rejected, and say what would change your mind.',
      'Quantify it. Memory, latency, machine count -- show the arithmetic.'
    ],
    tell: 'This is where Staff separates from Senior. Breadth is table stakes; the offer is decided by whether you can go deep without being led there.'
  },
  {
    id: 'failure',
    name: 'Failure, scale & trade-offs',
    minutes: 7,
    goal: 'Show that you have operated systems, not just drawn them.',
    prompts: [
      'What breaks first at ten times the load, and what is the next bottleneck after you fix it?',
      'Walk a partial failure: one dependency is slow, not down. What does the user see?',
      'Where is consistency actually required, and where are you deliberately accepting staleness?',
      'What is the blast radius of your worst single-component failure, and what bounds it?'
    ],
    tell: 'Volunteering a failure mode before being asked is one of the strongest signals available to you in the whole interview.'
  },
  {
    id: 'wrap',
    name: 'Wrap & evolution',
    minutes: 3,
    goal: 'Land it like an owner rather than a candidate running out of time.',
    prompts: [
      'Summarise the design in four sentences.',
      'Name the biggest risk and what you would prototype first to de-risk it.',
      'What did you deliberately not build, and when would you revisit that?',
      'If this replaces something existing, what is the migration sequence and the rollback?'
    ],
    tell: 'Say what you would deliberately not build. Prioritisation under constraint is the core Staff competency and almost nobody demonstrates it unprompted.'
  }
];

export const TOTAL_MINUTES = PHASES.reduce((n, p) => n + p.minutes, 0);

/** Self-grade after the session. Deliberately harsh. */
export const RUBRIC = [
  { id: 'scoped', dim: 'Framing', text: 'I clarified scope and named explicit non-goals before designing anything.' },
  { id: 'quantified', dim: 'Framing', text: 'I produced real numbers for load, storage and latency, and then actually used them in a decision.' },
  { id: 'traced', dim: 'Breadth', text: 'I traced at least one read and one write end to end without hand-waving a component.' },
  { id: 'datamodel', dim: 'Breadth', text: 'I defined the data model and its access patterns, not just a box labelled "database".' },
  { id: 'deep', dim: 'Depth', text: 'I went three levels deep on the hardest component, with a named mechanism.' },
  { id: 'arithmetic', dim: 'Depth', text: 'I showed arithmetic somewhere -- memory, QPS per node, cost, or capacity.' },
  { id: 'alternatives', dim: 'Trade-offs', text: 'For each significant choice I named the alternative and the condition that would flip my decision.' },
  { id: 'cost', dim: 'Trade-offs', text: 'I said what each choice makes *worse*, not only what it makes better.' },
  { id: 'failure', dim: 'Operations', text: 'I volunteered failure modes before being asked, including a partial/slow-dependency case.' },
  { id: 'degrade', dim: 'Operations', text: 'I described what the user actually sees during degradation.' },
  { id: 'observability', dim: 'Operations', text: 'I named the specific signals I would alert on and the SLO they protect.' },
  { id: 'migration', dim: 'Ownership', text: 'I gave a migration or rollout sequence rather than assuming a greenfield deploy.' },
  { id: 'notbuild', dim: 'Ownership', text: 'I named something I would deliberately not build, and why.' },
  { id: 'ownership', dim: 'Ownership', text: 'I addressed who owns each boundary and how teams evolve it independently.' },
  { id: 'signposted', dim: 'Communication', text: 'I signposted my structure and managed the clock, rather than being redirected.' },
  { id: 'concise', dim: 'Communication', text: 'I answered the question that was asked before expanding, and I stopped talking when done.' }
];

export const RUBRIC_DIMS = [...new Set(RUBRIC.map(r => r.dim))];

/** Shown on the practice landing page. */
export const FRAMEWORKS = [
  {
    name: 'RADIO — frontend rounds',
    when: 'Product-surface questions: "design a news feed", "design a data grid".',
    steps: [
      '**R**equirements: functional, non-functional, scope boundaries.',
      '**A**rchitecture: components, data flow, module boundaries, server/client split.',
      '**D**ata model: entities, server state vs client state, normalisation.',
      '**I**nterface: the API contract and the component contract, both directions.',
      '**O**ptimisations: performance, accessibility, i18n, security, degradation.'
    ]
  },
  {
    name: 'Scope → Scale → Structure → Stress',
    when: 'Backend and distributed-systems questions.',
    steps: [
      '**Scope**: requirements, non-goals, the one property that must not break.',
      '**Scale**: rps, storage, read/write ratio, growth, and the implied machine count.',
      '**Structure**: components, data model, the traced happy path, the API contract.',
      '**Stress**: 10x load, partial failure, consistency boundaries, blast radius, migration.'
    ]
  },
  {
    name: 'Capability → Context → Control',
    when: 'Any question where an LLM is in the request path.',
    steps: [
      '**Capability**: what the model is genuinely being asked to do, and what a deterministic system should do instead.',
      '**Context**: where the context comes from, its permission boundary, its token budget, its freshness.',
      '**Control**: evaluation, guardrails, authorisation on tool calls, cost ceilings, and the fallback when AI is unavailable.'
    ]
  }
];

/** Shown as a persistent reminder in the mock interview sidebar. */
export const NINE_QUESTIONS = [
  'What is the hardest constraint here?',
  'Where is the bottleneck, and what is the bottleneck after that one?',
  'What happens during partial failure, not total failure?',
  'Where is strong consistency genuinely required?',
  'What is cached, for how long, and who invalidates it?',
  'Who owns each boundary, and can they deploy independently?',
  'What is the migration path from what exists today?',
  'What does 10x traffic or 10x teams do to this design?',
  'What would I deliberately not build?'
];
