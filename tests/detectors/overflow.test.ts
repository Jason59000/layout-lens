import { describe, it, expect } from "vitest";
import { OverflowDetector } from "../../src/detectors/overflow.js";
import { mockNode, mockTree, mockScroll, mockStyles, mockBoxModel, mockRect } from "../helpers.js";

const detector = new OverflowDetector();

describe("OverflowDetector", () => {
  describe("horizontal overflow", () => {
    it("detects scrollWidth > clientWidth as bleeding overflow", () => {
      const node = mockNode({
        scroll: mockScroll({ scrollWidth: 500, clientWidth: 300 }),
        computed: mockStyles({ overflowX: "visible" }),
      });
      const tree = mockTree(node);

      const issues = detector.detect(tree);

      const hOverflow = issues.find((i) => i.summary.includes("Horizontal overflow"));
      expect(hOverflow).toBeDefined();
      expect(hOverflow!.severity).toBe("error");
      expect(hOverflow!.summary).toContain("bleeds");
    });

    it("detects clipped overflow (overflow-x: hidden)", () => {
      const node = mockNode({
        scroll: mockScroll({ scrollWidth: 500, clientWidth: 300 }),
        computed: mockStyles({ overflowX: "hidden" }),
      });
      const tree = mockTree(node);

      const issues = detector.detect(tree);

      const hOverflow = issues.find((i) => i.summary.includes("Horizontal overflow"));
      expect(hOverflow).toBeDefined();
      expect(hOverflow!.severity).toBe("warning");
      expect(hOverflow!.summary).toContain("clipped");
    });

    it("detects scrollable overflow (overflow-x: auto)", () => {
      const node = mockNode({
        scroll: mockScroll({ scrollWidth: 500, clientWidth: 300 }),
        computed: mockStyles({ overflowX: "auto" }),
      });
      const tree = mockTree(node);

      const issues = detector.detect(tree);

      const hOverflow = issues.find((i) => i.summary.includes("Horizontal overflow"));
      expect(hOverflow).toBeDefined();
      expect(hOverflow!.severity).toBe("info");
      expect(hOverflow!.summary).toContain("scrollable");
    });

    it("does not flag when scrollWidth equals clientWidth", () => {
      const node = mockNode({
        scroll: mockScroll({ scrollWidth: 300, clientWidth: 300 }),
      });
      const tree = mockTree(node);

      const issues = detector.detect(tree);

      const hOverflow = issues.find((i) => i.summary.includes("Horizontal overflow"));
      expect(hOverflow).toBeUndefined();
    });

    it("does not flag when clientWidth is 0", () => {
      const node = mockNode({
        scroll: mockScroll({ scrollWidth: 500, clientWidth: 0 }),
      });
      const tree = mockTree(node);

      const issues = detector.detect(tree);

      const hOverflow = issues.find((i) => i.summary.includes("Horizontal overflow"));
      expect(hOverflow).toBeUndefined();
    });
  });

  describe("vertical overflow", () => {
    it("detects bleeding vertical overflow", () => {
      const node = mockNode({
        scroll: mockScroll({ scrollHeight: 800, clientHeight: 400 }),
        computed: mockStyles({ overflowY: "visible" }),
      });
      const tree = mockTree(node);

      const issues = detector.detect(tree);

      const vOverflow = issues.find((i) => i.summary.includes("Vertical overflow"));
      expect(vOverflow).toBeDefined();
      expect(vOverflow!.severity).toBe("warning");
      expect(vOverflow!.summary).toContain("bleeds");
    });

    it("skips vertical scroll on body element", () => {
      const node = mockNode({
        tag: "body",
        selector: "body",
        scroll: mockScroll({ scrollHeight: 2000, clientHeight: 800 }),
        computed: mockStyles({ overflowY: "auto" }),
      });
      const tree = mockTree(node);

      const issues = detector.detect(tree);

      const vOverflow = issues.find((i) => i.summary.includes("Vertical overflow"));
      expect(vOverflow).toBeUndefined();
    });
  });

  describe("viewport protrusion", () => {
    it("detects element wider than viewport", () => {
      const node = mockNode({
        boxModel: mockBoxModel({
          total: mockRect({ x: 0, y: 0, width: 1500, height: 100 }),
        }),
      });
      const tree = mockTree(node, { width: 1280, height: 720 });

      const issues = detector.detect(tree);

      const protrusion = issues.find((i) => i.summary.includes("protrudes beyond viewport"));
      expect(protrusion).toBeDefined();
      expect(protrusion!.severity).toBe("error");
    });

    it("detects element offset past viewport right edge", () => {
      const node = mockNode({
        boxModel: mockBoxModel({
          total: mockRect({ x: 1000, y: 0, width: 400, height: 100 }),
        }),
      });
      const tree = mockTree(node, { width: 1280, height: 720 });

      const issues = detector.detect(tree);

      const protrusion = issues.find((i) => i.summary.includes("protrudes beyond viewport"));
      expect(protrusion).toBeDefined();
      expect(protrusion!.summary).toContain("120px past right edge");
    });

    it("does not flag element within viewport", () => {
      const node = mockNode({
        boxModel: mockBoxModel({
          total: mockRect({ x: 0, y: 0, width: 800, height: 100 }),
        }),
      });
      const tree = mockTree(node, { width: 1280, height: 720 });

      const issues = detector.detect(tree);

      const protrusion = issues.find((i) => i.summary.includes("protrudes beyond viewport"));
      expect(protrusion).toBeUndefined();
    });
  });

  describe("cause chain", () => {
    it("identifies white-space: nowrap as cause of horizontal overflow", () => {
      const node = mockNode({
        scroll: mockScroll({ scrollWidth: 500, clientWidth: 300 }),
        computed: mockStyles({ overflowX: "visible", whiteSpace: "nowrap" }),
      });
      const tree = mockTree(node);

      const issues = detector.detect(tree);
      const hOverflow = issues.find((i) => i.summary.includes("Horizontal overflow"));
      expect(hOverflow).toBeDefined();
      expect(hOverflow!.causeChain.some((c) => c.property === "white-space")).toBe(true);
    });
  });
});
