import { describe, it, expect } from "vitest";
import { VisibilityDetector } from "../../src/detectors/visibility.js";
import { mockNode, mockTree, mockStyles, mockBoxModel, mockRect, mockEdges } from "../helpers.js";

const detector = new VisibilityDetector();

describe("VisibilityDetector", () => {
  describe("visibility: hidden", () => {
    it("detects visibility: hidden", () => {
      const node = mockNode({
        computed: mockStyles({ visibility: "hidden" }),
      });
      const tree = mockTree(node);

      const issues = detector.detect(tree);

      expect(issues).toHaveLength(1);
      expect(issues[0].summary).toContain("visibility: hidden");
      expect(issues[0].severity).toBe("info");
      expect(issues[0].category).toBe("visibility");
    });

    it("does not flag visibility: visible", () => {
      const node = mockNode({
        computed: mockStyles({ visibility: "visible" }),
      });
      const tree = mockTree(node);

      const issues = detector.detect(tree);

      const visIssue = issues.find((i) => i.summary.includes("visibility: hidden"));
      expect(visIssue).toBeUndefined();
    });
  });

  describe("opacity: 0", () => {
    it("detects opacity: 0", () => {
      const node = mockNode({
        computed: mockStyles({ opacity: "0" }),
      });
      const tree = mockTree(node);

      const issues = detector.detect(tree);

      const opacityIssue = issues.find((i) => i.summary.includes("opacity: 0"));
      expect(opacityIssue).toBeDefined();
      expect(opacityIssue!.severity).toBe("info");
    });

    it("does not flag opacity: 1", () => {
      const node = mockNode({
        computed: mockStyles({ opacity: "1" }),
      });
      const tree = mockTree(node);

      const issues = detector.detect(tree);

      const opacityIssue = issues.find((i) => i.summary.includes("opacity"));
      expect(opacityIssue).toBeUndefined();
    });

    it("does not flag opacity: 0.5", () => {
      const node = mockNode({
        computed: mockStyles({ opacity: "0.5" }),
      });
      const tree = mockTree(node);

      const issues = detector.detect(tree);

      const opacityIssue = issues.find((i) => i.summary.includes("opacity: 0"));
      expect(opacityIssue).toBeUndefined();
    });
  });

  describe("off-viewport positioning", () => {
    it("detects element positioned far off-screen (x: -9999)", () => {
      const node = mockNode({
        computed: mockStyles({ position: "absolute" }),
        boxModel: mockBoxModel({
          total: mockRect({ x: -10000, y: 0, width: 100, height: 20 }),
        }),
      });
      const tree = mockTree(node);

      const issues = detector.detect(tree);

      const offscreen = issues.find((i) => i.summary.includes("off-viewport"));
      expect(offscreen).toBeDefined();
      expect(offscreen!.severity).toBe("info");
    });

    it("detects element completely off the right edge", () => {
      const node = mockNode({
        computed: mockStyles({ position: "fixed" }),
        boxModel: mockBoxModel({
          total: mockRect({ x: 2000, y: 0, width: 100, height: 20 }),
        }),
      });
      const tree = mockTree(node, { width: 1280, height: 720 });

      const issues = detector.detect(tree);

      const offscreen = issues.find((i) => i.summary.includes("off-viewport"));
      expect(offscreen).toBeDefined();
    });

    it("does not flag statically positioned elements even if off-screen coords", () => {
      const node = mockNode({
        computed: mockStyles({ position: "static" }),
        boxModel: mockBoxModel({
          total: mockRect({ x: -10000, y: 0, width: 100, height: 20 }),
        }),
      });
      const tree = mockTree(node);

      const issues = detector.detect(tree);

      const offscreen = issues.find((i) => i.summary.includes("off-viewport"));
      expect(offscreen).toBeUndefined();
    });
  });

  describe("zero-size elements", () => {
    it("detects zero-width element with border", () => {
      const node = mockNode({
        boxModel: mockBoxModel({
          content: mockRect({ x: 0, y: 0, width: 0, height: 100 }),
          border: mockEdges({ top: 1, right: 1, bottom: 1, left: 1 }),
        }),
        children: [],
      });
      const tree = mockTree(node);

      const issues = detector.detect(tree);

      const zeroSize = issues.find((i) => i.summary.includes("zero size"));
      expect(zeroSize).toBeDefined();
      expect(zeroSize!.severity).toBe("warning");
    });

    it("does not flag normal-sized element", () => {
      const node = mockNode({
        boxModel: mockBoxModel({
          content: mockRect({ x: 0, y: 0, width: 200, height: 100 }),
        }),
      });
      const tree = mockTree(node);

      const issues = detector.detect(tree);

      const zeroSize = issues.find((i) => i.summary.includes("zero size"));
      expect(zeroSize).toBeUndefined();
    });
  });

  describe("clip-path hiding", () => {
    it("detects clip-path: inset(50%)", () => {
      const node = mockNode({
        computed: mockStyles({ clipPath: "inset(50%)" }),
      });
      const tree = mockTree(node);

      const issues = detector.detect(tree);

      const clipIssue = issues.find((i) => i.summary.includes("clip-path"));
      expect(clipIssue).toBeDefined();
      expect(clipIssue!.severity).toBe("warning");
    });

    it("does not flag clip-path: none", () => {
      const node = mockNode({
        computed: mockStyles({ clipPath: "none" }),
      });
      const tree = mockTree(node);

      const issues = detector.detect(tree);

      const clipIssue = issues.find((i) => i.summary.includes("clip-path"));
      expect(clipIssue).toBeUndefined();
    });
  });

  describe("visible element", () => {
    it("produces no issues for a fully visible element", () => {
      const node = mockNode({
        computed: mockStyles({
          visibility: "visible",
          opacity: "1",
          position: "static",
          clipPath: "none",
        }),
        boxModel: mockBoxModel({
          content: mockRect({ x: 10, y: 10, width: 200, height: 100 }),
          total: mockRect({ x: 10, y: 10, width: 200, height: 100 }),
        }),
      });
      const tree = mockTree(node);

      const issues = detector.detect(tree);

      expect(issues).toHaveLength(0);
    });
  });
});
