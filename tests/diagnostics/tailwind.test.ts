import { describe, it, expect } from "vitest";
import { detectTailwind, suggestTailwindFix } from "../../src/diagnostics/tailwind.js";
import { mockNode } from "../helpers.js";

describe("detectTailwind", () => {
  it("returns true when elements have Tailwind classes", () => {
    const nodes = [
      mockNode({ classes: ["flex", "items-center", "gap-4"] }),
      mockNode({ classes: ["bg-white", "p-4"] }),
    ];
    expect(detectTailwind(nodes)).toBe(true);
  });

  it("returns true for a single Tailwind utility class", () => {
    const nodes = [mockNode({ classes: ["overflow-hidden"] })];
    expect(detectTailwind(nodes)).toBe(true);
  });

  it("returns false when no Tailwind classes present", () => {
    const nodes = [
      mockNode({ classes: ["my-custom-class", "container-main"] }),
      mockNode({ classes: ["header", "nav-item"] }),
    ];
    expect(detectTailwind(nodes)).toBe(false);
  });

  it("returns false for empty class lists", () => {
    const nodes = [
      mockNode({ classes: [] }),
      mockNode({ classes: [] }),
    ];
    expect(detectTailwind(nodes)).toBe(false);
  });

  it("returns false for empty node array", () => {
    expect(detectTailwind([])).toBe(false);
  });
});

describe("suggestTailwindFix", () => {
  it("suggests overflow fix: hidden -> auto", () => {
    const result = suggestTailwindFix("overflow", "hidden", "auto");
    expect(result).toBe("overflow-hidden → overflow-auto");
  });

  it("suggests overflow-x fix: visible -> auto", () => {
    const result = suggestTailwindFix("overflow-x", "visible", "auto");
    expect(result).toBe("add overflow-x-auto");
  });

  it("suggests display fix: block -> flex", () => {
    const result = suggestTailwindFix("display", "block", "flex");
    expect(result).toBe("block → flex");
  });

  it("suggests visibility fix: hidden -> visible", () => {
    const result = suggestTailwindFix("visibility", "hidden", "visible");
    expect(result).toBe("invisible → visible");
  });

  it("suggests white-space fix: nowrap -> normal", () => {
    const result = suggestTailwindFix("white-space", "nowrap", "normal");
    expect(result).toBe("whitespace-nowrap → whitespace-normal");
  });

  it("returns null for unknown property", () => {
    const result = suggestTailwindFix("background-image", "none", "url(...)");
    expect(result).toBeNull();
  });

  it("returns null when both values are unknown for the property", () => {
    const result = suggestTailwindFix("overflow", "inherit", "initial");
    expect(result).toBeNull();
  });

  it("returns null when only current value has a mapping but suggested does not", () => {
    const result = suggestTailwindFix("overflow", "hidden", "inherit");
    expect(result).toBeNull();
  });
});
