import { describe, expect, it } from "vitest";
import { browserPlatforms, contextStatuses, platforms, runKinds, runStatuses } from "@reacher/shared";

describe("shared Reacher contracts", () => {
  it("keeps the v1 browser platforms and run states explicit", () => {
    expect(browserPlatforms).toEqual(["linkedin", "x", "reddit", "discord"]);
    expect(platforms).toContain("github");
    expect(platforms).toContain("email");
    expect(runKinds).toContain("research");
    expect(runKinds).toContain("outreach_prepare");
    expect(runKinds).toContain("reddit_write");
    expect(runStatuses).toContain("waiting_for_operator");
    expect(contextStatuses).toContain("needs_login");
  });
});
