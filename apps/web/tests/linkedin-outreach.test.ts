import { describe, expect, it } from "vitest";
import { hasLinkedInUrl, linkedInDraftsForTarget, renderLinkedInTemplate } from "../lib/linkedin/outreach";

describe("LinkedIn outreach helpers", () => {
  it("renders supported template variables", () => {
    expect(renderLinkedInTemplate("Hi {{name}} at {{company}}", {
      id: "target_1",
      displayName: "Ada",
      company: "Acme"
    })).toBe("Hi Ada at Acme");
  });

  it("creates deterministic connection and DM drafts with a safe connection-note length", () => {
    const drafts = linkedInDraftsForTarget(
      {
        mode: "connect_note_first",
        targetIds: ["target_1"],
        connectionTemplate: "Hi {{name}}, {{notes}}. Would be good to connect.",
        dmTemplate: "Hi {{name}},\n\n{{notes}}. Compare notes?",
      },
      {
        id: "target_1",
        displayName: "Ada",
        company: "Acme",
        role: "Founder"
      }
    );
    expect(drafts.connectionNote.length).toBeLessThanOrEqual(280);
    expect(drafts.connectionNote).toContain("Ada");
    expect(drafts.dm).toContain("Compare notes?");
  });

  it("detects LinkedIn URLs", () => {
    expect(hasLinkedInUrl("https://www.linkedin.com/in/ada/")).toBe(true);
    expect(hasLinkedInUrl("https://example.com/ada")).toBe(false);
  });
});
