import type { GmailDraftMode, GmailOutreachPayload, GmailRecipient } from "@reacher/shared";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ParsedGmailRecipient = GmailRecipient & {
  rowNumber: number;
  displayName: string;
};

function splitLine(line: string) {
  if (line.includes("\t")) return line.split("\t").map((item) => item.trim());
  return line.split(",").map((item) => item.trim());
}

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function looksLikeHeader(parts: string[]) {
  return parts.map(normalizeHeader).includes("email");
}

function fieldFromHeader(parts: string[], headers: string[], name: string) {
  const index = headers.indexOf(name);
  return index >= 0 ? parts[index]?.trim() : undefined;
}

export function parseGmailRecipients(raw: string) {
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return { recipients: [] as ParsedGmailRecipient[], errors: ["Add at least one recipient row."] };
  const first = splitLine(lines[0]);
  const hasHeader = looksLikeHeader(first);
  const headers = hasHeader ? first.map(normalizeHeader) : ["email", "name", "company", "role", "notes"];
  const bodyLines = hasHeader ? lines.slice(1) : lines;
  const recipients: ParsedGmailRecipient[] = [];
  const errors: string[] = [];

  bodyLines.forEach((line, index) => {
    const parts = splitLine(line);
    const rowNumber = index + (hasHeader ? 2 : 1);
    const email = fieldFromHeader(parts, headers, "email") || parts[0] || "";
    const name = fieldFromHeader(parts, headers, "name") || fieldFromHeader(parts, headers, "full_name") || parts[1] || "";
    const company = fieldFromHeader(parts, headers, "company") || fieldFromHeader(parts, headers, "organization") || parts[2] || "";
    const role = fieldFromHeader(parts, headers, "role") || fieldFromHeader(parts, headers, "title") || parts[3] || "";
    const notes = fieldFromHeader(parts, headers, "notes") || fieldFromHeader(parts, headers, "note") || parts.slice(4).join(", ");
    if (!emailPattern.test(email)) {
      errors.push(`Row ${rowNumber}: invalid email "${email || "(blank)"}".`);
      return;
    }
    recipients.push({
      rowNumber,
      email,
      name: name || undefined,
      company: company || undefined,
      role: role || undefined,
      notes: notes || undefined,
      displayName: name || company || email
    });
  });

  return { recipients, errors };
}

function renderTemplate(template: string, recipient: ParsedGmailRecipient) {
  const values: Record<string, string> = {
    email: recipient.email,
    name: recipient.name || recipient.displayName,
    company: recipient.company || "",
    role: recipient.role || "",
    notes: recipient.notes || ""
  };
  return template.replace(/\{\{\s*(email|name|company|role|notes)\s*\}\}/gi, (_match, key: string) => values[key.toLowerCase()] ?? "");
}

export function deterministicGmailDraft(payload: GmailOutreachPayload, recipient: ParsedGmailRecipient) {
  if (payload.draftMode === "template") {
    return {
      subject: renderTemplate(payload.subject || "Quick note for {{company}}", recipient).trim(),
      body: renderTemplate(payload.body || "Hi {{name}},\n\n", recipient).trim()
    };
  }

  const companyClause = recipient.company ? ` at ${recipient.company}` : "";
  const roleClause = recipient.role ? `, ${recipient.role}` : "";
  const notesClause = recipient.notes ? `\n\nContext I had: ${recipient.notes}` : "";
  return {
    subject: `Quick note${recipient.company ? ` for ${recipient.company}` : ""}`,
    body: [
      `Hi ${recipient.name || recipient.displayName},`,
      "",
      `I wanted to reach out${companyClause}${roleClause}. ${payload.body || payload.subject || "I think there may be a useful reason to compare notes."}`,
      notesClause,
      "",
      "Best,"
    ].join("\n").replace(/\n{3,}/g, "\n\n").trim()
  };
}

function jsonFromText(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return JSON.parse((fenced ? fenced[1] : text).trim()) as { subject?: string; body?: string };
}

export async function gmailDraftForRecipient(payload: GmailOutreachPayload, recipient: ParsedGmailRecipient, prompt: string) {
  if (payload.draftMode !== "ai" || !process.env.GOOGLE_GEMINI_API_KEY) {
    return deterministicGmailDraft(payload, recipient);
  }

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(process.env.GOOGLE_GEMINI_API_KEY)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        generationConfig: { responseMimeType: "application/json" },
        contents: [
          {
            parts: [
              {
                text: [
                  "Return JSON only with schema {\"subject\":\"\",\"body\":\"\"}.",
                  "Write a concise Gmail outreach draft. Do not invent facts beyond the recipient fields.",
                  `Operator instruction: ${prompt}`,
                  `Common angle/template context: ${payload.body || payload.subject || ""}`,
                  `Recipient: ${JSON.stringify(recipient)}`
                ].join("\n")
              }
            ]
          }
        ]
      })
    });
    const data = (await response.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("\n") || "";
    const parsed = jsonFromText(text);
    if (parsed.subject && parsed.body) return { subject: parsed.subject.trim(), body: parsed.body.trim() };
  } catch {
    // Fall through to deterministic copy so the operator can still review and edit.
  }

  return deterministicGmailDraft(payload, recipient);
}

export function assertGmailDraftMode(value: unknown): GmailDraftMode {
  return value === "template" ? "template" : "ai";
}
