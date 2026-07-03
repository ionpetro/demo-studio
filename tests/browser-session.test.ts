import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { BrowserSession, observationText, type OverlaySpec } from "../src/engine/browser-session.ts";
import type { Observation } from "../src/engine/types.ts";

// The 1x1 transparent PNG fallback used by renderOverlays() when a card
// fails to render. Not exported, so it's copied here verbatim from source.
const BLANK =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

// base64("fake") — the fixed "successful screenshot" payload our fakes return.
const FAKE_SHOT_B64 = "ZmFrZQ==";
assert.equal(Buffer.from(FAKE_SHOT_B64, "base64").toString("utf8"), "fake");

type ElBehavior = "ok" | "null" | "reject";

/**
 * Builds a fake Playwright Page good enough to drive renderOverlays(). Each
 * call to $() consumes the next entry from `behaviors` (defaulting to "ok"
 * once the list is exhausted), which lets a test fail the Nth shot() call
 * specifically (captions are shot in order, then brand last).
 */
function makeOverlayPage(behaviors: ElBehavior[] = []) {
  const calls = {
    setViewportSize: [] as unknown[],
    setContent: [] as string[],
    evaluate: [] as { arg: unknown; hasArg: boolean }[],
    $: [] as string[],
    close: 0,
  };
  const page = {
    setViewportSize: async (v: unknown) => {
      calls.setViewportSize.push(v);
    },
    setContent: async (html: string) => {
      calls.setContent.push(html);
    },
    evaluate: async (_fn: unknown, ...rest: unknown[]) => {
      calls.evaluate.push({ arg: rest[0], hasArg: rest.length > 0 });
      return undefined;
    },
    $: async (sel: string) => {
      const idx = calls.$.length;
      calls.$.push(sel);
      const behavior = behaviors[idx] ?? "ok";
      if (behavior === "null") return null;
      return {
        screenshot: async () => {
          if (behavior === "reject") throw new Error("boom: screenshot failed");
          return Buffer.from("fake");
        },
      };
    },
    close: async () => {
      calls.close++;
    },
    calls,
  };
  return page;
}

/** Fake for the outer "recorded" page whose .context().newPage() yields overlayPage. */
function makeRecordedPage(overlayPage: ReturnType<typeof makeOverlayPage>) {
  const newPageCalls: unknown[] = [];
  const evaluateCalls: unknown[] = [];
  return {
    context: () => ({
      newPage: async () => {
        newPageCalls.push(true);
        return overlayPage;
      },
    }),
    evaluate: async (...args: unknown[]) => {
      evaluateCalls.push(args);
      throw new Error("recorded page evaluate should never be called by renderOverlays");
    },
    newPageCalls,
    evaluateCalls,
  };
}

function makeSession(recordedPage: ReturnType<typeof makeRecordedPage>): BrowserSession {
  const session = Object.create((BrowserSession as any).prototype);
  (session as any).page = recordedPage;
  return session as BrowserSession;
}

const baseSpec = (overrides: Partial<OverlaySpec> = {}): OverlaySpec => ({
  W: 1280,
  H: 720,
  captions: [],
  brand: "",
  ...overrides,
});

describe("BrowserSession.renderOverlays", () => {
  test("uses a fresh page from page.context().newPage(), not the recorded page", async () => {
    const overlayPage = makeOverlayPage();
    const recordedPage = makeRecordedPage(overlayPage);
    const session = makeSession(recordedPage);

    await session.renderOverlays(baseSpec({ captions: ["hi"] }));

    assert.equal(recordedPage.newPageCalls.length, 1);
    // The recorded page's own evaluate must never be invoked.
    assert.equal(recordedPage.evaluateCalls.length, 0);
    // All the real work happened on the overlay page.
    assert.equal(overlayPage.calls.setContent.length, 1);
    assert.ok(overlayPage.calls.evaluate.length >= 1);
    assert.equal(overlayPage.calls.$.length, 1);
  });

  test("closes the fresh page exactly once on the happy path", async () => {
    const overlayPage = makeOverlayPage();
    const recordedPage = makeRecordedPage(overlayPage);
    const session = makeSession(recordedPage);

    await session.renderOverlays(baseSpec({ captions: ["a", "b"], brand: "Acme" }));

    assert.equal(overlayPage.calls.close, 1);
  });

  test("closes the fresh page exactly once even when a card render throws", async () => {
    const overlayPage = makeOverlayPage(["reject"]);
    const recordedPage = makeRecordedPage(overlayPage);
    const session = makeSession(recordedPage);

    const result = await session.renderOverlays(baseSpec({ captions: ["a"] }));

    assert.equal(overlayPage.calls.close, 1);
    assert.deepEqual(result.caps, [BLANK]);
  });

  test("blank PNG fallback keeps caption index alignment when only the middle one fails", async () => {
    const overlayPage = makeOverlayPage(["ok", "reject", "ok"]);
    const recordedPage = makeRecordedPage(overlayPage);
    const session = makeSession(recordedPage);

    const result = await session.renderOverlays(
      baseSpec({ captions: ["first", "second", "third"] }),
    );

    assert.equal(result.caps.length, 3);
    assert.equal(result.caps[0], FAKE_SHOT_B64);
    assert.equal(result.caps[1], BLANK);
    assert.equal(result.caps[2], FAKE_SHOT_B64);
  });

  test("blank PNG fallback also triggers when $() resolves null (el! throws)", async () => {
    const overlayPage = makeOverlayPage(["null"]);
    const recordedPage = makeRecordedPage(overlayPage);
    const session = makeSession(recordedPage);

    const result = await session.renderOverlays(baseSpec({ captions: ["only"] }));

    assert.deepEqual(result.caps, [BLANK]);
  });

  test("brand is null (not the blank constant) when the brand card fails", async () => {
    // One caption succeeds, then the brand card (2nd shot() call) fails.
    const overlayPage = makeOverlayPage(["ok", "reject"]);
    const recordedPage = makeRecordedPage(overlayPage);
    const session = makeSession(recordedPage);

    const result = await session.renderOverlays(
      baseSpec({ captions: ["cap"], brand: "Some Brand" }),
    );

    assert.equal(result.caps[0], FAKE_SHOT_B64);
    assert.equal(result.brand, null);
  });

  test("brand is null directly when spec.brand is empty, without invoking shot()", async () => {
    const overlayPage = makeOverlayPage();
    const recordedPage = makeRecordedPage(overlayPage);
    const session = makeSession(recordedPage);

    const result = await session.renderOverlays(baseSpec({ captions: [], brand: "" }));

    assert.equal(result.brand, null);
    assert.equal(overlayPage.calls.$.length, 0);
  });

  test("HTML-escapes captions (& < > escaped, quotes left literal)", async () => {
    const overlayPage = makeOverlayPage();
    const recordedPage = makeRecordedPage(overlayPage);
    const session = makeSession(recordedPage);

    await session.renderOverlays(
      baseSpec({ captions: [`Click <Submit> & "Confirm"`] }),
    );

    // Find the evaluate() call that carries the rendered HTML (the shot()
    // call passes (fn, html) - two args - unlike the font-load call which
    // passes just the function).
    const htmlCalls = overlayPage.calls.evaluate.filter((c) => c.hasArg);
    assert.equal(htmlCalls.length, 1);
    const html = htmlCalls[0].arg as string;

    assert.ok(html.includes("Click &lt;Submit&gt; &amp; \"Confirm\""));
    // Quotes are explicitly NOT escaped by hesc() in source.
    assert.ok(html.includes(`"Confirm"`));
    assert.ok(!html.includes("&quot;"));
  });

  test("successful end-to-end: 2 captions + brand all render", async () => {
    const overlayPage = makeOverlayPage(["ok", "ok", "ok"]);
    const recordedPage = makeRecordedPage(overlayPage);
    const session = makeSession(recordedPage);

    const result = await session.renderOverlays(
      baseSpec({ captions: ["one", "two"], brand: "Acme Inc" }),
    );

    assert.equal(result.caps.length, 2);
    assert.equal(result.caps[0], FAKE_SHOT_B64);
    assert.equal(result.caps[1], FAKE_SHOT_B64);
    assert.equal(result.brand, FAKE_SHOT_B64);
  });

  test("empty captions array produces caps: [] and never calls shot() for captions", async () => {
    const overlayPage = makeOverlayPage(["ok"]);
    const recordedPage = makeRecordedPage(overlayPage);
    const session = makeSession(recordedPage);

    const result = await session.renderOverlays(baseSpec({ captions: [], brand: "OnlyBrand" }));

    assert.deepEqual(result.caps, []);
    // Only the brand shot should have called $() - exactly once.
    assert.equal(overlayPage.calls.$.length, 1);
    assert.equal(result.brand, FAKE_SHOT_B64);
  });

  test("empty captions array and no brand: caps: [], $() never called at all", async () => {
    const overlayPage = makeOverlayPage();
    const recordedPage = makeRecordedPage(overlayPage);
    const session = makeSession(recordedPage);

    const result = await session.renderOverlays(baseSpec({ captions: [], brand: "" }));

    assert.deepEqual(result.caps, []);
    assert.equal(result.brand, null);
    assert.equal(overlayPage.calls.$.length, 0);
  });

  test("sets viewport size from spec.W/H on the overlay page", async () => {
    const overlayPage = makeOverlayPage();
    const recordedPage = makeRecordedPage(overlayPage);
    const session = makeSession(recordedPage);

    await session.renderOverlays(baseSpec({ W: 999, H: 555, captions: [] }));

    assert.deepEqual(overlayPage.calls.setViewportSize[0], { width: 999, height: 555 });
  });
});

describe("observationText", () => {
  test("bare element with no optional fields", () => {
    const o: Observation = {
      url: "https://example.com",
      title: "Example",
      dialogOpen: false,
      elements: [
        { i: 0, tag: "button", role: "", name: "", ph: "", href: "", dialog: false, sel: null, selText: null },
      ],
    };
    const text = observationText(o);
    assert.equal(
      text,
      "URL: https://example.com\nTITLE: Example\nDIALOG_OPEN: false\nELEMENTS:\n#0 button",
    );
  });

  test("element with all optional fields set", () => {
    const o: Observation = {
      url: "https://example.com/page",
      title: "Page",
      dialogOpen: true,
      elements: [
        {
          i: 1,
          tag: "a",
          role: "link",
          name: "Click me",
          ph: "search here",
          href: "/x",
          dialog: true,
          sel: null,
          selText: null,
        },
      ],
    };
    const text = observationText(o);
    assert.equal(
      text,
      'URL: https://example.com/page\nTITLE: Page\nDIALOG_OPEN: true\nELEMENTS:\n#1 link "Click me" placeholder="search here" href=/x [in-dialog]',
    );
  });

  test("role empty falls back to tag", () => {
    const o: Observation = {
      url: "u",
      title: "t",
      dialogOpen: false,
      elements: [
        { i: 3, tag: "input", role: "", name: "Email", ph: "", href: "", dialog: false, sel: null, selText: null },
      ],
    };
    const text = observationText(o);
    assert.equal(text, 'URL: u\nTITLE: t\nDIALOG_OPEN: false\nELEMENTS:\n#3 input "Email"');
  });

  test("role non-empty is preferred over tag", () => {
    const o: Observation = {
      url: "u",
      title: "t",
      dialogOpen: false,
      elements: [
        { i: 2, tag: "div", role: "button", name: "", ph: "", href: "", dialog: false, sel: null, selText: null },
      ],
    };
    const text = observationText(o);
    assert.equal(text, "URL: u\nTITLE: t\nDIALOG_OPEN: false\nELEMENTS:\n#2 button");
  });

  test("dialogOpen: false header case (distinct from per-element dialog flag)", () => {
    const o: Observation = {
      url: "u",
      title: "t",
      dialogOpen: false,
      elements: [
        { i: 0, tag: "button", role: "", name: "Ok", ph: "", href: "", dialog: false, sel: null, selText: null },
      ],
    };
    const text = observationText(o);
    assert.ok(text.includes("DIALOG_OPEN: false\n"));
    assert.ok(!text.includes("[in-dialog]"));
  });

  test("zero elements: ELEMENTS: header present with nothing after, no trailing content", () => {
    const o: Observation = {
      url: "https://empty.example",
      title: "Empty",
      dialogOpen: false,
      elements: [],
    };
    const text = observationText(o);
    assert.equal(
      text,
      "URL: https://empty.example\nTITLE: Empty\nDIALOG_OPEN: false\nELEMENTS:\n",
    );
    assert.ok(text.endsWith("ELEMENTS:\n"));
  });

  test("multiple elements are joined with newlines, one per line", () => {
    const o: Observation = {
      url: "u",
      title: "t",
      dialogOpen: false,
      elements: [
        { i: 0, tag: "button", role: "", name: "A", ph: "", href: "", dialog: false, sel: null, selText: null },
        { i: 1, tag: "a", role: "", name: "B", ph: "", href: "/b", dialog: false, sel: null, selText: null },
      ],
    };
    const text = observationText(o);
    assert.equal(
      text,
      'URL: u\nTITLE: t\nDIALOG_OPEN: false\nELEMENTS:\n#0 button "A"\n#1 a "B" href=/b',
    );
  });
});
