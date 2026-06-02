import { describe, expect, it } from "vitest";
import { deterministicGmailDraft, parseGmailRecipients } from "../lib/gmail/outreach";

describe("Gmail outreach helpers", () => {
  it("parses pasted recipient tables", () => {
    const parsed = parseGmailRecipients("email,name,company,role,notes\na@example.com,Ada,Acme,Founder,AI tools");
    expect(parsed.errors).toEqual([]);
    expect(parsed.recipients[0]).toMatchObject({
      email: "a@example.com",
      name: "Ada",
      company: "Acme",
      role: "Founder",
      notes: "AI tools"
    });
  });

  it("renders common templates with recipient variables", () => {
    const parsed = parseGmailRecipients("a@example.com,Ada,Acme,Founder,AI tools");
    const draft = deterministicGmailDraft(
      {
        draftMode: "template",
        recipientsRaw: "",
        subject: "Quick note for {{company}}",
        body: "Hi {{name}}, {{notes}}"
      },
      parsed.recipients[0]
    );
    expect(draft.subject).toBe("Quick note for Acme");
    expect(draft.body).toBe("Hi Ada, AI tools");
  });
});
