// The home mode grid must offer a "Live" door (renamed from "Arena") wired to onLive.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const hub = readFileSync(new URL("../public/hub.js", import.meta.url), "utf8");

describe("home Live door", () => {
  it("renders a #modeLive tile labelled Live", () => {
    expect(hub).toMatch(/id="modeLive"/);
    expect(hub).toMatch(/aria-label="Live"/);
    expect(hub).not.toMatch(/id="modeArena"/); // fully renamed, no stale id
  });
  it("wires the tile to the onLive callback", () => {
    expect(hub).toMatch(/getElementById\("modeLive"\)/);
    expect(hub).toMatch(/hubCallbacks\.onLive/);
  });
});
