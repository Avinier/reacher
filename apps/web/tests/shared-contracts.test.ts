import { describe, expect, it } from "vitest";
import { browserPlatforms, contextStatuses, runKinds, runStatuses } from "@reacher/shared";

describe("shared Reacher contracts", () => {
  it("keeps the v1 browser platforms and run states explicit", () => {
    expect(browserPlatforms).toEqual(["linkedin", "x", "reddit", "discord"]);
    expect(runKinds).toContain("research");
    expect(runKinds).toContain("outreach_prepare");
    expect(runKinds).toContain("reddit_write");
    expect(runStatuses).toContain("waiting_for_operator");
    expect(contextStatuses).toContain("needs_login");
  });
});
