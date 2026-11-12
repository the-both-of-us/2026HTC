import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PretestView } from "../types";
import { getPretest, submitPretestAnswers } from "./api";
import { PretestEnd, PretestOffer, UnitQuestions, UnitResults, type UnitDrafts } from "./parts";
import { PretestScreen } from "./PretestScreen";
import type { PretestSession } from "./usePretest";

const unit = {
  unitId: "u1",
  number: 1,
  title: "Foundations",
  questions: [
    { topicId: "t1", topicTitle: "Latency", question: "What does latency measure?", options: ["Delay of one request", "Requests per second", "Disk size", "Server count"] },
    { topicId: "t2", topicTitle: "Throughput", question: "What does throughput measure?", options: ["Work done per second", "Delay of one request", "Memory used", "Cable length"] },
  ],
};

const baseView: PretestView = {
  mapId: "m1",
  offer: "in-progress",
  state: "answering",
  current: unit,
  pendingUnitId: null,
  unitsTotal: 3,
  unitsDone: 0,
  results: [],
  ended: null,
  knownTopicIds: [],
  dismissed: false,
};

function session(view: PretestView | null, extra: Partial<PretestSession> = {}): PretestSession {
  const none = async () => null;
  return {
    view,
    pending: null,
    error: null,
    slow: false,
    stalledForGood: false,
    start: none,
    submit: none,
    stop: none,
    dismiss: none,
    clearError: () => {},
    ...extra,
  };
}

const noop = () => {};

describe("the offer", () => {
  it("offers the pre-test with a plain Not now", () => {
    const html = renderToStaticMarkup(<PretestOffer onStart={noop} onDismiss={noop} />);
    expect(html).toContain("Already know some of this?");
    expect(html).toContain("Take the pre-test and skip what you know");
    expect(html).toContain("Take the pre-test</button>");
    expect(html).toContain("Not now");
  });

  it("shows a failed Not now as an alert", () => {
    const html = renderToStaticMarkup(<PretestOffer onStart={noop} onDismiss={noop} error="Could not reach OryxLearn." />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("Could not reach OryxLearn.");
  });
});

describe("a unit of questions", () => {
  const render = (drafts: UnitDrafts = {}, pending: "answers" | "stop" | null = null) =>
    renderToStaticMarkup(
      <UnitQuestions
        unit={unit}
        unitsTotal={3}
        drafts={drafts}
        onChange={noop}
        onSubmit={noop}
        onStop={noop}
        pending={pending}
        error={null}
      />,
    );

  it("gives every question a labelled radio group of four options and a separate I don't know choice", () => {
    const html = render();
    expect(html).not.toContain("<textarea");
    expect(html.match(/<fieldset/g)).toHaveLength(2);
    expect(html.match(/<legend/g)).toHaveLength(2);
    expect(html.match(/type="radio"/g)).toHaveLength(10);
    expect(html.match(/I don(’|&#x27;|&rsquo;|')t know this/g)).toHaveLength(2);
    expect(html).toContain("Delay of one request");
    expect(html).toContain("What does latency measure?");
    // A radio group shares one name, and each option is a labelled real input.
    const names = [...html.matchAll(/type="radio"[^>]*name="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(names).size).toBe(2);
    expect(html).toMatch(/<label for="[^"]+-q0-o0"/);
    expect(html).toContain("Unit 1");
    expect(html).toContain("Foundations");
    expect(html).not.toMatch(/gradient|backdrop|glow/);
  });

  it("marks the chosen option, and I don't know when that is chosen", () => {
    const html = render({ t1: 2, t2: "dont-know" });
    expect(html.match(/checked=""/g)).toHaveLength(2);
    expect(html).toMatch(/checked="" value="2"/);
    expect(html).toMatch(/checked="" value="dont-know"/);
  });

  it("keeps Stop here visible, also while a unit is being checked", () => {
    expect(render()).toContain("Stop here");
    const checking = render({}, "answers");
    expect(checking).toContain("Stop here");
    expect(checking).toContain("Checking");
    expect(checking).toContain("disabled");
  });
});

describe("results", () => {
  const results = [
    { unitId: "u1", topicId: "t1", topicTitle: "Latency", outcome: "known" as const },
    { unitId: "u1", topicId: "t2", topicTitle: "Throughput", outcome: "missed" as const },
    { unitId: "u1", topicId: "t3", topicTitle: "Caching", outcome: "skipped" as const },
  ];

  it("lists each question's outcome in words", () => {
    const html = renderToStaticMarkup(
      <UnitResults unitNumber={1} unitTitle="Foundations" results={results} last={false} onContinue={noop} />,
    );
    expect(html).toContain("1 of 3 topics known");
    expect(html).toContain("Known (pre-test)");
    expect(html).toContain("Not yet. The lesson will teach it.");
    expect(html).toContain("Skipped");
    expect(html).toContain("Next unit");
    // Results from before multiple choice have no review and show the outcome only.
    expect(html).not.toContain("Correct answer");
    expect(html).toContain('tabindex="-1"');
  });

  it("leads to the summary after the last unit", () => {
    const html = renderToStaticMarkup(
      <UnitResults unitNumber={3} unitTitle="Scale" results={results} last onContinue={noop} />,
    );
    expect(html).toContain("See the summary");
  });
});

describe("the review of a submitted unit", () => {
  const review = (chosen: number | null) => ({
    unitId: "u1",
    topicId: "t1",
    topicTitle: "Latency",
    outcome: chosen === 0 ? ("known" as const) : chosen === null ? ("skipped" as const) : ("missed" as const),
    review: {
      question: "What does latency measure?",
      options: ["Delay of one request", "Requests per second", "Disk size", "Server count"],
      chosen,
      correctIndex: 0,
      explanation: "Latency is the delay of one request.",
    },
  });
  const render = (chosen: number | null) =>
    renderToStaticMarkup(<UnitResults unitNumber={1} unitTitle="Foundations" results={[review(chosen)]} last={false} onContinue={noop} />);

  it("shows the choice, the correct option and the explanation", () => {
    const html = render(1);
    expect(html).toContain("Your answer: </span>Requests per second");
    expect(html).toContain("Correct answer: </span>Delay of one request");
    expect(html).toContain("Latency is the delay of one request.");
  });

  it("does not repeat the correct option when the choice was right, and says I don't know when skipped", () => {
    expect(render(0)).not.toContain("Correct answer");
    expect(render(null)).toMatch(/Your answer: <\/span>I don(’|&#x27;|&rsquo;|')t know this/);
  });
});

describe("the end screen", () => {
  const ended: PretestView = {
    ...baseView,
    offer: "taken",
    state: "ended",
    current: null,
    unitsDone: 2,
    results: [
      { unitId: "u1", topicId: "t1", topicTitle: "Latency", outcome: "known" },
      { unitId: "u1", topicId: "t2", topicTitle: "Throughput", outcome: "missed" },
    ],
    ended: { reason: "stopped", at: "2026-11-11T10:00:00Z" },
    knownTopicIds: ["t1"],
  };

  it("names the known topics, keeps the tests ahead and shows the next step", () => {
    const html = renderToStaticMarkup(
      <PretestEnd view={ended} nextStep={<button>Next skill: Throughput</button>} onClose={noop} />,
    );
    expect(html).toContain("Pre-test stopped");
    expect(html).toContain("1 of 2 topics asked is now known");
    expect(html).toContain("Known from the pre-test");
    expect(html).toContain("Latency");
    expect(html).toContain("unit tests and the final test are still ahead");
    expect(html).toContain("Next skill: Throughput");
    expect(html).toContain("Back to the map");
  });

  it("says plainly when nothing was known", () => {
    const html = renderToStaticMarkup(
      <PretestEnd
        view={{ ...ended, results: [ended.results[1]], ended: { reason: "unit-missed", at: "x", unitId: "u1" } }}
        nextStep={null}
        onClose={noop}
      />,
    );
    expect(html).toContain("No topic was marked known");
    expect(html).toContain("Later units build on it");
  });
});

describe("the screen", () => {
  const screen = (s: PretestSession) =>
    renderToStaticMarkup(<PretestScreen session={s} nextStep={<span>NEXT</span>} onClose={noop} onProgress={noop} />);

  it("shows the questions with a live region", () => {
    const html = screen(session(baseView));
    expect(html).toContain('role="status"');
    expect(html).toContain("Unit 1 questions are ready.");
    expect(html).toContain("What does latency measure?");
  });

  it("shows a clear waiting state while questions are written, with Stop here", () => {
    const html = screen(session({ ...baseView, state: "writing", current: null, pendingUnitId: "u2", unitsDone: 1 }));
    expect(html).toContain("Writing the questions for");
    expect(html).toContain("Stop here");
    expect(html).toContain("This takes a few seconds");
  });

  it("offers to try again once a stalled writer cannot be restarted", () => {
    const html = screen(
      session({ ...baseView, state: "stalled", current: null, pendingUnitId: "u2" }, { stalledForGood: true }),
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("Try again");
  });

  it("shows the summary with the map's next step when it is over", () => {
    const html = screen(
      session({ ...baseView, offer: "taken", state: "ended", current: null, ended: { reason: "completed", at: "x" } }),
    );
    expect(html).toContain("Pre-test finished");
    expect(html).toContain("NEXT");
  });

  it("says why there is no pre-test", () => {
    const html = screen(session({ ...baseView, offer: "none", reason: "nothing-left", state: "not-started", current: null }));
    expect(html).toContain("nothing left to skip");
  });

  it("never puts an answer key in the page", () => {
    const html = [
      screen(session(baseView)),
      screen(session({ ...baseView, state: "writing", current: null })),
      screen(session({ ...baseView, offer: "taken", state: "ended", current: null, ended: { reason: "completed", at: "x" } })),
    ].join("");
    expect(html).not.toMatch(/keyPoints|answer key|ANSWERKEY|correctIndex/i);
    expect(html).not.toMatch(/interview|textarea|type your|write your/i);
  });
});

describe("the API client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("turns a failed check into a sentence that says nothing was recorded", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({}), { status: 503 }));
    const result = await submitPretestAnswers("m1", { unitId: "u1", answers: [] });
    expect(result).toMatchObject({ ok: false, status: 503 });
    expect(result.ok ? "" : result.message).toContain("Nothing was recorded");
  });

  it("shows the server's own sentence, and a network failure as one", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: "Not your map." }), { status: 409 }));
    expect(await getPretest("m1")).toEqual({ ok: false, status: 409, message: "Not your map." });
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("offline");
    });
    const offline = await getPretest("m1");
    expect(offline.ok ? "" : offline.message).toContain("could not be reached");
  });
});
