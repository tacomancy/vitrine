// PROTOTYPE — throwaway. See global-command.html for the question.

/* ------------------------------------------------------------------ data */

const SURFACES = [
  // Only what has an Address when beat 2b lands (#262; ADR 0021): the live
  // surfaces and dashboards, Questions, and Research Questions. Reader,
  // Hypothesis, Experiment, Scout Queue, Vault and Home join as their beats
  // add pages — the reach grows one route at a time.
  { kind: "surface", name: "Question Inbox", hash: "#/inbox" },
  { kind: "dashboard", name: "Loose Ends", hash: "#/loose-ends" },
];

const RQ_TITLES = [
  "Is replay necessary for consolidation?",
  "Does slow-wave density predict recall gain?",
  "Do targeted memory reactivation cues work outside the lab?",
  "Is the overnight retention benefit attributable to consolidation, or to encoding strength?",
  "Does sleep deprivation damage recall or retrieval?",
  "Are probing classifiers measuring the model or the probe?",
  "Does interpretability transfer across model scale?",
  "Is spindle count a usable proxy for consolidation?",
  "Do sparse autoencoders recover features or impose them?",
  "Does schema congruency change what consolidates?",
];

const Q_STEMS = [
  "does this hold for sparse inputs",
  "is replay necessary for consolidation",
  "what counts as a reactivation event here",
  "why is the spindle window 0.5 s and not 1 s",
  "has anyone replicated this outside the lab",
  "is there a principled reason to prefer overnight over nap designs",
  "would this survive a within-subject design",
  "what is the base rate for this effect",
  "does the probe see the feature or invent it",
  "is this a ceiling effect",
  "how is recall gain normalised here",
  "did they preregister the exclusion rule",
  "what happens at the tail of the distribution",
  "is the control condition doing any work",
  "does the dose-response curve actually bend",
  "are these two measures the same measure",
  "why report d and not the raw difference",
  "is retrieval practice confounded with exposure",
  "does this generalise past word pairs",
  "what would falsify the consolidation account",
  "is the effect carried by the slow oscillation or the spindle",
  "are author keywords doing any work in this field",
  "does model scale change which features are found",
  "what does unplaced mean for a tag with three papers",
  "is corroboration a ranking signal or a bias",
];

// Qualifiers, so a stem appears as a run of near-misses rather than as the
// same row seven times — which is what a real vault looks like and what the
// ordering has to survive.
const QUALIFIERS = [
  "once you control for exposure",
  "outside the lab",
  "at this sample size",
  "for nap designs",
  "in the 2021 replication",
  "for word pairs only",
  "when the cue is auditory",
  "past the first night",
  "at larger model scale",
  "under a within-subject design",
  "if the exclusion rule is preregistered",
  "on the held-out set",
  "before the spindle window closes",
];

const SOURCES = [
  "Rasch & Born 2013",
  "Klinzing 2019",
  "Schreiner 2021",
  "Cordi & Rasch 2021",
  "Diekelmann 2010",
  "Staresina 2015",
  "Antony 2018",
  "Lewis & Durrant 2011",
];
const CONTEXTS = ["reading", "writing", "ingest", "resolving", "pursuing"];
const STATUSES = [
  { key: "open", glyph: "◆", label: "open" },
  { key: "promoted", glyph: "■", label: "promoted" },
  { key: "answered", glyph: "●", label: "answered" },
  { key: "abandoned", glyph: "×", label: "dropped" },
];

// A deterministic shuffle, so the page looks the same on every reload.
let seed = 20260927;
const rnd = () =>
  (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];

function buildObjects() {
  const out = SURFACES.map((s) => ({
    ...s,
    glyph: s.kind === "surface" ? "▪" : "▦",
    kindLabel: s.kind,
    meta: s.hash,
    days: -1,
  }));

  RQ_TITLES.forEach((title, i) => {
    out.push({
      kind: "research-question",
      glyph: "■",
      kindLabel: "research question",
      name: title,
      hash: "#/questions/" + slug(title) + ".md",
      meta: `${2 + ((i * 3) % 9)} supporting · ${(i * 2) % 5} opposing · ${5 + i * 11} d`,
      days: 5 + i * 11,
      serif: true,
    });
  });

  // A few hundred Questions, so the list is judged at the scale it will live at.
  // Every stem appears bare once, then qualified — so `consolidation` returns
  // a spread of kinds and `is replay necessary for consolidation` returns one
  // exact hit above a run of near-misses.
  for (let i = 0; i < 308; i++) {
    const which = i % Q_STEMS.length;
    const stem = Q_STEMS[which];
    const round = Math.floor(i / Q_STEMS.length);
    // 5 and 13 are coprime, so a stem picks up a different qualifier on each
    // round rather than the same one every time.
    const text =
      round === 0
        ? stem
        : `${stem} ${QUALIFIERS[(round * 5 + which) % QUALIFIERS.length]}`;
    const status =
      i % 9 === 3
        ? STATUSES[1]
        : i % 13 === 5
          ? STATUSES[2]
          : i % 29 === 7
            ? STATUSES[3]
            : STATUSES[0];
    const context = pick(CONTEXTS);
    const from = pick(SOURCES);
    const days = 1 + Math.floor(rnd() * 430);
    out.push({
      kind: "question",
      glyph: status.glyph,
      kindLabel: "question",
      status,
      name: capitalise(text) + "?",
      hash: "#/questions/" + slug(text) + ".md",
      meta:
        context === "reading" || context === "ingest"
          ? `${from} · p. ${2 + Math.floor(rnd() * 18)} · ${days} d`
          : `${context} · ${days} d`,
      days,
      serif: true,
    });
  }
  return out;
}

const capitalise = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);

const OBJECTS = buildObjects();

/* -------------------------------------------------------------- matching */

const norm = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
const KIND_ORDER = {
  surface: 0,
  dashboard: 1,
  "research-question": 2,
  question: 3,
};

/**
 * How well an object answers the query. The whole ordering question lives
 * here: strength first, then kind, then recency — so an exact hit outranks
 * a surface, and a surface outranks a Question that merely contains the word.
 *   3 exact · 2 prefix · 1 word start · 0 contains · -1 no
 */
function strength(query, obj) {
  const q = norm(query);
  if (q === "") return 0;
  const n = norm(obj.name);
  if (n === q) return 3;
  if (n.startsWith(q)) return 2;
  if (new RegExp("\\b" + q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(n))
    return 1;
  return n.includes(q) ? 0 : -1;
}

function matches(query) {
  const scored = [];
  for (const obj of OBJECTS) {
    const s = strength(query, obj);
    if (s >= 0) scored.push({ obj, s });
  }
  scored.sort(
    (a, b) =>
      b.s - a.s ||
      KIND_ORDER[a.obj.kind] - KIND_ORDER[b.obj.kind] ||
      a.obj.days - b.obj.days
  );
  return scored;
}

/* ---------------------------------------------------------------- states */

const STATES = {
  opened: { label: "1 · just opened, empty", query: "" },
  capturing: {
    label: "2 · mid-capture, provenance already there",
    query: "why is the spindle window half a second and not one",
  },
  searching: {
    label: "3 · mid-search across mixed kinds",
    query: "consolidation",
  },
  deciding: {
    label:
      "4 · the fork — it already exists, and you were about to write it down",
    query: "is replay necessary for consolidation",
  },
  nothing: {
    label: "5 · nothing matched — normal for a capture, not a failure",
    query: "do dendritic spikes gate this at all",
  },
};

const VARIANTS = {
  A: "A · capture holds the floor",
  B: "B · one list, the verb moves",
  C: "C · both outcomes at once",
};

const params = new URLSearchParams(location.search);
let variant = VARIANTS[params.get("variant")] ? params.get("variant") : "A";
let stateKey = STATES[params.get("state")] ? params.get("state") : "opened";
let query = STATES[stateKey].query;
let arrowedTo = 0; // index into the destination list
let onCapture = null; // variants B and C: is the capture side holding ↵?
let outcome = null; // what the last ↵ did — the prototype's state readout

const NOW = "27 Sep 14:32";
// Standing on the Inbox with no document open is `context: other` — an
// Unattached Provenance (CONTEXT.md). From a Research Question's page the
// same chip would read `Pursuing · <stem>`.
const PROVENANCE = `Unattached · ${NOW}`;

/* ---------------------------------------------------------------- render */

const el = (tag, attrs = {}, kids = []) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k === "html") node.innerHTML = v;
    else node.setAttribute(k, v);
  }
  for (const kid of [].concat(kids)) if (kid) node.append(kid);
  return node;
};

/** The matched run picked out of a row's name — how a match is shown. */
function nameHtml(obj) {
  const escaped = obj.name.replace(
    /[&<>]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]
  );
  const q = query.trim();
  if (q === "") return escaped;
  const at = escaped.toLowerCase().indexOf(q.toLowerCase());
  if (at < 0) return escaped;
  return (
    escaped.slice(0, at) +
    "<mark>" +
    escaped.slice(at, at + q.length) +
    "</mark>" +
    escaped.slice(at + q.length)
  );
}

function destinationRow(entry, index, selected) {
  const { obj } = entry;
  const row = el("li", {
    class: "row",
    role: "option",
    "aria-selected": String(selected),
  });
  row.append(
    el("span", { class: "glyph", text: obj.glyph, title: obj.kindLabel })
  );
  row.append(
    el("span", {
      class: "rowname" + (obj.serif ? " serif" : ""),
      html: nameHtml(obj),
    })
  );
  row.append(el("span", { class: "rowkind", text: obj.kindLabel }));
  row.append(el("span", { class: "rowmeta", text: obj.meta }));
  row.addEventListener("mousedown", (e) => {
    e.preventDefault();
    arrowedTo = index;
    onCapture = false;
    act();
  });
  return row;
}

function captureRow({ selected, tag }) {
  const row = el("div", {
    class: "captureRow",
    role: "option",
    "aria-selected": String(selected),
  });
  row.append(el("span", { class: "glyph open", text: "◆", title: "question" }));
  const text = query.trim();
  row.append(
    el("span", {
      class: "captureText" + (text === "" ? " empty" : ""),
      text:
        text === ""
          ? "Write a question — it costs nothing and keeps where you were"
          : text + "?",
    })
  );
  row.append(el("span", { class: "chip", text: PROVENANCE }));
  if (tag) row.append(el("span", { class: "rowmeta", text: tag }));
  row.addEventListener("mousedown", (e) => {
    e.preventDefault();
    onCapture = true;
    act();
  });
  return row;
}

/**
 * What ↵ will do, said loudly: the key drawn as a key, the mode in brass,
 * and the thing it will act on in full — the typed Question in the serif it
 * will be written in, or the destination's own name. The alternative key and
 * the count sit beside it in mono, so nothing competes with the verb.
 */
function footer({ mode, target, serif, pending, alt, count }) {
  const verb = el("span", { class: "verb" }, [
    el("span", { class: "key", text: "↵" }),
    el("span", { class: "mode", text: mode }),
    el("span", {
      class: "target" + (serif ? " serif" : "") + (pending ? " pending" : ""),
      text: target,
    }),
  ]);
  // One muted run on the right, so the alternative and the count do not read
  // as a single sentence when both are there.
  const aside = [alt, count].filter(Boolean).join("   ·   ");
  return el("div", { class: "footer" }, [
    verb,
    aside ? el("span", { class: "alt", text: aside }) : null,
  ]);
}

/** What ↵ will capture, or the note that it will not yet. */
function captureVerb() {
  const text = query.trim();
  return text === ""
    ? {
        mode: "Capture",
        target: "type a question",
        pending: true,
      }
    : { mode: "Capture", target: text + "?", serif: true };
}

/** What ↵ will go to. */
function goVerb(list) {
  const obj = list[arrowedTo]?.obj;
  return obj
    ? { mode: "Go to", target: obj.name, serif: Boolean(obj.serif) }
    : {
        mode: "Go to",
        target: "nothing here goes by that name",
        pending: true,
      };
}

function countLine(list) {
  const shown = Math.min(list.length, 50);
  if (query.trim() === "") return "recent · type to narrow";
  if (list.length === 0) return "no destination matches";
  return list.length > shown
    ? `${shown} of ${list.length} — keep typing`
    : `${list.length} matching`;
}

function buildOverlay() {
  const all = matches(query);
  const list = all.slice(0, 50);
  const best = all[0];
  const strong = best !== undefined && best.s >= 2;

  // Variant B decides the default side from match strength; A always starts
  // on capture; C remembers whichever side the user last crossed to.
  if (onCapture === null)
    onCapture = variant === "A" ? true : variant === "B" ? !strong : true;
  if (arrowedTo >= list.length) arrowedTo = Math.max(list.length - 1, 0);

  const cmd = el("div", {
    class: "cmd",
    role: "dialog",
    "aria-label": "Global command",
  });

  // Neutral: the one brass statement is the verb in the footer, at the point
  // where the decision is actually made (BRAND.md law 3 — keep brass scarce).
  const label = "⌘K";
  const input = el("input", {
    class: "query",
    type: "text",
    role: "combobox",
    "aria-expanded": "true",
    "aria-label": "Capture a question, or go to something",
    autocomplete: "off",
    placeholder: "Write a question, or go somewhere",
  });
  input.value = query;
  input.addEventListener("input", () => {
    query = input.value;
    arrowedTo = 0;
    onCapture = null;
    outcome = null;
    render(true);
  });
  cmd.append(
    el("div", { class: "queryrow" }, [
      el("span", { class: "cmdlabel caps", text: label }),
      input,
      el("span", { class: "hint mono", text: "esc leaves" }),
    ])
  );

  if (variant === "A") {
    // Capture is the floor: the typed text is always a Question in waiting,
    // pinned above everything, and the selection starts on it. Going
    // somewhere costs one ↓ — the cheap thing is the common thing.
    cmd.append(captureRow({ selected: onCapture }));
    cmd.append(
      el("span", {
        class: "groupLabel caps",
        text: query.trim() === "" ? "Recent" : "Destinations",
      })
    );
    const ul = el("ul", {
      class: "rows",
      role: "listbox",
      "aria-label": "Destinations",
    });
    list.forEach((entry, i) =>
      ul.append(destinationRow(entry, i, !onCapture && i === arrowedTo))
    );
    if (list.length === 0)
      ul.append(
        el("li", {
          class: "empty",
          text: "Nothing here goes by that name — ↵ writes it down instead.",
        })
      );
    cmd.append(ul);
    cmd.append(
      footer({
        ...(onCapture ? captureVerb() : goVerb(list)),
        alt: onCapture ? "↓ to go somewhere" : "↑ back to the capture",
        count: countLine(all),
      })
    );
  }

  if (variant === "B") {
    // One list. The capture is the last row, and the default selection moves
    // to a destination only when the query is an exact or prefix hit — so ↵
    // means different things at different times, which is the risk worth
    // seeing drawn.
    const ul = el("ul", {
      class: "rows",
      role: "listbox",
      "aria-label": "Destinations and capture",
    });
    list.forEach((entry, i) =>
      ul.append(destinationRow(entry, i, !onCapture && i === arrowedTo))
    );
    cmd.append(ul);
    cmd.append(captureRow({ selected: onCapture }));
    cmd.append(
      footer({
        ...(onCapture ? captureVerb() : goVerb(list)),
        alt: onCapture
          ? list.length
            ? "⇥ goes to the top match"
            : ""
          : "⇥ writes it down instead",
        count: countLine(all),
      })
    );
  }

  if (variant === "C") {
    // Both outcomes on screen at once, so there is nothing to infer: one
    // query feeds a destination list on the left and the capture on the
    // right, and ⇥ says which side ↵ belongs to.
    const left = el("div", { class: "col", "data-owns": String(!onCapture) });
    left.append(
      el("div", { class: "colhead" }, [
        el("span", { class: "caps", text: "Go to" }),
        el("span", { class: "mono", text: countLine(all) }),
      ])
    );
    const ul = el("ul", {
      class: "rows",
      role: "listbox",
      "aria-label": "Destinations",
    });
    list.forEach((entry, i) =>
      ul.append(destinationRow(entry, i, !onCapture && i === arrowedTo))
    );
    if (list.length === 0)
      ul.append(
        el("li", { class: "empty", text: "Nothing goes by that name." })
      );
    left.append(ul);

    const right = el("div", { class: "col", "data-owns": String(onCapture) });
    right.append(
      el("div", { class: "colhead" }, [
        el("span", { class: "caps", text: "Capture" }),
        el("span", { class: "mono", text: "new question" }),
      ])
    );
    const text = query.trim();
    right.append(
      el("div", { class: "captureCard" }, [
        el("p", {
          class: "body" + (text === "" ? " empty" : ""),
          text:
            text === ""
              ? "Whatever you type lands here as a Question."
              : text + "?",
        }),
        el("div", { class: "provline" }, [
          el("span", { text: PROVENANCE }),
          el("span", { text: "status: open · no form, no fields" }),
        ]),
      ])
    );
    cmd.append(el("div", { class: "columns" }, [left, right]));
    cmd.append(
      footer({
        ...(onCapture ? captureVerb() : goVerb(list)),
        alt: onCapture ? "⇥ or ↓ crosses to the list" : "⇥ crosses back",
      })
    );
  }

  if (outcome) {
    cmd.append(el("div", { class: "outcome", html: outcome }));
  }

  const scrim = el("div", { class: "scrim" }, [cmd]);
  scrim.addEventListener("mousedown", (e) => {
    if (e.target === scrim) input.focus();
  });
  return { scrim, input, list };
}

/** What ↵ just did — the prototype prints it rather than pretending to navigate. */
function act() {
  const all = matches(query);
  const list = all.slice(0, 50);
  if (onCapture) {
    const text = query.trim();
    if (text === "") return;
    outcome = `<b>captured</b> “${text}?” · provenance ${PROVENANCE} · status open — focus returns to the Inbox (ADR 0010)`;
  } else {
    const obj = list[arrowedTo]?.obj;
    if (!obj) return;
    outcome = `<b>pushRoute</b>(<code>${obj.hash}</code>) — one push, so back returns to <code>#/inbox</code> (ADR 0021)`;
  }
  render(true);
}

function onKey(event) {
  if (event.key === "Escape") {
    event.preventDefault();
    query = "";
    arrowedTo = 0;
    onCapture = null;
    outcome = null;
    render(true);
    return;
  }
  const list = matches(query).slice(0, 50);
  if (event.key === "ArrowDown") {
    event.preventDefault();
    if (onCapture) {
      // A: down leaves the capture for the list. C: down crosses columns.
      if (variant === "A" || variant === "C")
        ((onCapture = false), (arrowedTo = 0));
      else ((arrowedTo = 0), (onCapture = false));
    } else if (arrowedTo < list.length - 1) arrowedTo += 1;
    else if (variant === "B") onCapture = true;
    render(true);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    if (onCapture && variant === "B") {
      onCapture = false;
      arrowedTo = Math.max(list.length - 1, 0);
    } else if (!onCapture && arrowedTo === 0) onCapture = true;
    else if (!onCapture) arrowedTo -= 1;
    render(true);
  } else if (event.key === "Tab") {
    event.preventDefault();
    onCapture = !onCapture;
    if (!onCapture) arrowedTo = 0;
    render(true);
  } else if (event.key === "Enter") {
    event.preventDefault();
    act();
  }
}

/* -------------------------------------------------------------- backdrop */

function backdrop() {
  const sidebar = el("nav", { class: "sidebar", "aria-label": "Surfaces" });
  sidebar.append(el("span", { class: "caps", text: "Surfaces" }));
  const surfaces = el("ul");
  [
    ["Home", false],
    ["Question Inbox", "current"],
    ["Reader", false],
    ["Research Question view", false],
    ["Hypothesis view", false],
    ["Experiment view", false],
    ["Scout Queue", false],
    ["Vault", false],
  ].forEach(([name, mark]) => {
    surfaces.append(
      el("li", { class: mark === "current" ? "current" : mark ? "live" : "" }, [
        el("span", { class: "dot" }),
        el("span", { text: name }),
      ])
    );
  });
  sidebar.append(surfaces);
  sidebar.append(el("span", { class: "caps", text: "Dashboards" }));
  const dashboards = el("ul");
  ["Question Map", "Scout Activity", "Loose Ends"].forEach((name, i) =>
    dashboards.append(
      el("li", { class: i === 2 ? "live" : "" }, [
        el("span", { class: "dot" }),
        el("span", { text: name }),
      ])
    )
  );
  sidebar.append(dashboards);

  const inbox = el("div", { class: "inbox" });
  inbox.append(
    el("header", {}, [
      el("h1", { text: "Question Inbox" }),
      el("span", {
        class: "mono",
        text: "318 questions · 11 research questions · 4 today",
      }),
    ])
  );
  const ol = el("ol");
  OBJECTS.filter((o) => o.kind === "question")
    .slice(0, 22)
    .forEach((q) => {
      ol.append(
        el("li", {}, [
          el("span", {
            class: "glyph" + (q.status.key === "open" ? " open" : ""),
            text: q.glyph,
            title: q.status.label,
          }),
          el("span", { class: "qtext", text: q.name }),
          el("span", { class: "mono", text: q.meta }),
          el("span", { class: "mono age", text: q.days + " d" }),
        ])
      );
    });
  inbox.append(ol);

  const detail = el("div", { class: "detail" });
  detail.append(el("span", { class: "caps", text: "Provenance" }));
  detail.append(
    el("p", {
      class: "mono",
      text: "Klinzing 2019 · p. 4 · captured 12 Sep, 09:41 while reading",
    })
  );
  detail.append(el("span", { class: "caps", text: "Sitting" }));
  detail.append(
    el("p", { class: "mono", text: "3 others captured within 90 minutes" })
  );

  return el("div", { class: "window" }, [
    el("div", { class: "titlebar", text: "consolidation-vault" }),
    el("div", { class: "panes" }, [sidebar, inbox, detail]),
  ]);
}

/* -------------------------------------------------------------- switcher */

function switcher() {
  const bar = document.getElementById("switcher");
  bar.textContent = "";
  const keys = Object.keys(VARIANTS);
  const step = (by) => {
    variant = keys[(keys.indexOf(variant) + by + keys.length) % keys.length];
    onCapture = null;
    outcome = null;
    render(true);
  };
  bar.append(
    el("button", {
      type: "button",
      text: "←",
      "aria-label": "Previous variant",
    })
  );
  bar.lastChild.addEventListener("click", () => step(-1));
  bar.append(el("span", { class: "name", text: VARIANTS[variant] }));
  bar.append(
    el("button", { type: "button", text: "→", "aria-label": "Next variant" })
  );
  bar.lastChild.addEventListener("click", () => step(1));
  bar.append(el("span", { class: "sep" }));
  Object.entries(STATES).forEach(([key, def], i) => {
    const b = el("button", {
      type: "button",
      text: String(i + 1),
      title: def.label,
      "aria-pressed": String(key === stateKey),
    });
    b.addEventListener("click", () => {
      stateKey = key;
      query = def.query;
      arrowedTo = 0;
      onCapture = null;
      outcome = null;
      render(true);
    });
    bar.append(b);
  });
  bar.append(el("span", { class: "sep" }));
  bar.append(
    el("span", {
      class: "state",
      text: STATES[stateKey].label.split(" · ")[1] ?? "",
    })
  );
}

/* ----------------------------------------------------------------- notes */

const NOTES = [
  [
    "What all three agree on",
    "Every row either goes somewhere or writes something down — no <code>&gt;</code> mode, no actions on the thing behind it, no file search (that is the Picker, and the Vault's). The reach is what has an Address when this lands: the live surfaces, the dashboards, Questions and Research Questions. Sources, Notes and Scouts join as their beats give them pages (ADR 0021).",
  ],
  [
    "Ordering, when a query matches several",
    "Match strength first — exact, then prefix, then word start, then contains — and only then kind (surface, dashboard, research question, question) and recency. So an exact hit outranks a surface, and a surface outranks a Question that merely contains the word. The matched run is marked in the row; the count line never cuts silently.",
  ],
  [
    "A · capture holds the floor",
    "The typed text is always a Question in waiting, pinned above the list, selected from the first keystroke. ↵ captures without a thought; ↓ leaves for a destination. <b>Cost:</b> every jump pays one arrow, forever. <b>Bet:</b> capture is the thing done most, so it should be the thing that costs least.",
  ],
  [
    "B · one list, the verb moves — chosen",
    "One ranked list with the capture as its last row. The default side moves with the query: an exact or prefix hit selects the destination, anything else selects the capture, and ⇥ swaps. ↵ therefore means different things at different moments, so <b>the verb is the safety</b> and is drawn that way — its own surface step, the key drawn as a key, the mode in brass, and the thing it will act on named in full rather than implied. The alternative key and the count stay mono and muted beside it, so nothing competes. The louder footer is applied to all three, since it is presentation: what A, B and C were compared on is their structure, and that is untouched.",
  ],
  [
    "C · both outcomes at once",
    "The overlay splits: destinations left, the capture composed right, one query feeding both. Nothing is inferred because both outcomes are on screen. <b>Cost:</b> it is wide and busy, and pushes against calm and keyboard-first. <b>Bet:</b> seeing beats guessing.",
  ],
  [
    "Still open — not this prototype's to settle",
    "Which key survives (⌘K, ⌘' or both), whether the Picker and this list are one component, and what happens on ↵ when the capture duplicates an object that already exists (state 4). The prototype draws the fork; the grill decides it.",
  ],
];

function notes() {
  const host = document.getElementById("notes");
  host.textContent = "";
  host.append(
    el("h2", { text: "Assumptions, and what each variant is betting" })
  );
  const grid = el("div", { class: "grid" });
  NOTES.forEach(([title, body]) =>
    grid.append(
      el("div", { class: "card" }, [
        el("h3", { text: title }),
        el("p", { html: body }),
      ])
    )
  );
  host.append(grid);
}

/* ---------------------------------------------------------------- driver */

let input = null;

function render(keepFocus) {
  const app = document.getElementById("app");
  app.textContent = "";
  app.append(backdrop());
  const built = buildOverlay();
  app.querySelector(".window").append(built.scrim);
  input = built.input;
  input.addEventListener("keydown", onKey);
  if (keepFocus !== false) {
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }
  switcher();
  const url = new URL(location.href);
  url.searchParams.set("variant", variant);
  url.searchParams.set("state", stateKey);
  history.replaceState(null, "", url);
}

notes();
render();
