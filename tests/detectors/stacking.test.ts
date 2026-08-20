import { describe, it, expect } from "vitest";
import { StackingDetector } from "../../src/detectors/stacking.js";
import { mockNode, mockTree, mockStyles, mockStacking } from "../helpers.js";

const detector = new StackingDetector();

describe("StackingDetector", () => {
  describe("trapped z-index", () => {
    it("detects high z-index trapped inside a parent stacking context", () => {
      const parent = mockNode({
        nodeId: 1,
        selector: "div.modal-backdrop",
        stacking: mockStacking({
          zIndex: 5,
          createsContext: true,
          contextReason: "z-index:5 + position:relative",
        }),
        computed: mockStyles({ position: "relative", zIndex: "5" }),
      });

      const child = mockNode({
        nodeId: 2,
        selector: "div.tooltip",
        parentId: 1,
        stacking: mockStacking({
          zIndex: 9999,
          createsContext: true,
        }),
        computed: mockStyles({ position: "absolute", zIndex: "9999" }),
      });

      parent.children = [child];
      const tree = mockTree(parent);

      const issues = detector.detect(tree);

      const trapped = issues.find((i) => i.summary.includes("trapped"));
      expect(trapped).toBeDefined();
      expect(trapped!.severity).toBe("warning");
      expect(trapped!.summary).toContain("9999");
      expect(trapped!.summary).toContain("5");
    });

    it("does not flag low z-index (< 10)", () => {
      const parent = mockNode({
        nodeId: 1,
        selector: "div.parent",
        stacking: mockStacking({
          zIndex: 1,
          createsContext: true,
        }),
        computed: mockStyles({ position: "relative", zIndex: "1" }),
      });

      const child = mockNode({
        nodeId: 2,
        selector: "div.child",
        parentId: 1,
        stacking: mockStacking({ zIndex: 5, createsContext: false }),
        computed: mockStyles({ position: "relative", zIndex: "5" }),
      });

      parent.children = [child];
      const tree = mockTree(parent);

      const issues = detector.detect(tree);

      const trapped = issues.find((i) => i.summary.includes("trapped"));
      expect(trapped).toBeUndefined();
    });

    it("does not flag z-index without parent stacking context", () => {
      const root = mockNode({
        nodeId: 1,
        selector: "div.root",
        stacking: mockStacking({ zIndex: "auto", createsContext: false }),
      });

      const child = mockNode({
        nodeId: 2,
        selector: "div.child",
        parentId: 1,
        stacking: mockStacking({ zIndex: 100, createsContext: true }),
        computed: mockStyles({ position: "relative", zIndex: "100" }),
      });

      root.children = [child];
      const tree = mockTree(root);

      const issues = detector.detect(tree);

      const trapped = issues.find((i) => i.summary.includes("trapped"));
      expect(trapped).toBeUndefined();
    });
  });

  describe("accidental stacking context", () => {
    it("detects near-1 opacity creating accidental stacking context", () => {
      const child = mockNode({
        nodeId: 2,
        selector: "div.inner",
        parentId: 1,
        stacking: mockStacking({ zIndex: 10, createsContext: false }),
        computed: mockStyles({ position: "relative", zIndex: "10" }),
      });

      const parent = mockNode({
        nodeId: 1,
        selector: "div.card",
        stacking: mockStacking({
          zIndex: "auto",
          createsContext: true,
          contextReason: "opacity: 0.99",
        }),
        computed: mockStyles({ opacity: "0.99" }),
        children: [child],
      });

      child.parentId = 1;
      const tree = mockTree(parent);

      const issues = detector.detect(tree);

      const accidental = issues.find((i) => i.summary.includes("accidental stacking context"));
      expect(accidental).toBeDefined();
      expect(accidental!.severity).toBe("warning");
    });

    it("detects no-op transform creating accidental stacking context", () => {
      const child = mockNode({
        nodeId: 2,
        selector: "div.inner",
        parentId: 1,
        stacking: mockStacking({ zIndex: 10, createsContext: false }),
        computed: mockStyles({ position: "relative", zIndex: "10" }),
      });

      const parent = mockNode({
        nodeId: 1,
        selector: "div.wrapper",
        stacking: mockStacking({
          zIndex: "auto",
          createsContext: true,
          contextReason: "transform: translateX(0px)",
        }),
        computed: mockStyles({ transform: "translateX(0px)" }),
        children: [child],
      });

      child.parentId = 1;
      const tree = mockTree(parent);

      const issues = detector.detect(tree);

      const accidental = issues.find((i) => i.summary.includes("accidental stacking context"));
      expect(accidental).toBeDefined();
    });

    it("does not flag intentional opacity (0.5) as accidental", () => {
      const child = mockNode({
        nodeId: 2,
        selector: "div.inner",
        parentId: 1,
        stacking: mockStacking({ zIndex: 10, createsContext: false }),
        computed: mockStyles({ position: "relative", zIndex: "10" }),
      });

      const parent = mockNode({
        nodeId: 1,
        selector: "div.overlay",
        stacking: mockStacking({
          zIndex: "auto",
          createsContext: true,
          contextReason: "opacity: 0.5",
        }),
        computed: mockStyles({ opacity: "0.5" }),
        children: [child],
      });

      child.parentId = 1;
      const tree = mockTree(parent);

      const issues = detector.detect(tree);

      const accidental = issues.find((i) => i.summary.includes("accidental stacking context"));
      expect(accidental).toBeUndefined();
    });

    it("does not flag context without z-index children", () => {
      const child = mockNode({
        nodeId: 2,
        selector: "div.inner",
        parentId: 1,
        stacking: mockStacking({ zIndex: "auto", createsContext: false }),
      });

      const parent = mockNode({
        nodeId: 1,
        selector: "div.card",
        stacking: mockStacking({
          zIndex: "auto",
          createsContext: true,
          contextReason: "opacity: 0.99",
        }),
        computed: mockStyles({ opacity: "0.99" }),
        children: [child],
      });

      child.parentId = 1;
      const tree = mockTree(parent);

      const issues = detector.detect(tree);

      const accidental = issues.find((i) => i.summary.includes("accidental stacking context"));
      expect(accidental).toBeUndefined();
    });
  });
});
