import { describe, expect, it } from "vitest";
import { smokeFailureAnnotation } from "./smoke_report.mjs";

describe("smoke failure annotations", () => {
  it("keeps the failing seed and visible order state", () => {
    const state = { mapSeed: 12345, selectionDetail: "Gathering wood", wood: 25 };
    expect(smokeFailureAnnotation(new Error("delivery timeout"), state))
      .toBe(`::error title=Browser smoke failure::Error: delivery timeout%0ABrowser state: ${JSON.stringify(state)}`);
  });
  it("still reports errors when the browser cannot be inspected", () => {
    expect(smokeFailureAnnotation("browser closed", null))
      .toBe("::error title=Browser smoke failure::browser closed");
  });
  it("escapes workflow command delimiters and newlines", () => {
    expect(smokeFailureAnnotation("50%\r\n::warning::text", { notice: "20%" }))
      .toBe('::error title=Browser smoke failure::50%25%0D%0A::warning::text%0ABrowser state: {"notice":"20%25"}');
  });
});
