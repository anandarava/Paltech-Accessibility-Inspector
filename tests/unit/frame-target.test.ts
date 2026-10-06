import { describe, expect, it } from "vitest";
import { issueFrameTarget } from "@shared/messages";
import { makeIssue } from "./support/factories";

describe("issueFrameTarget", () => {
  it("targets the top frame when no frame is recorded", () => {
    expect(issueFrameTarget(makeIssue({ id: "i-1" }))).toEqual({ frameId: 0, issueId: "i-1" });
  });
  it("strips the cross-frame id suffix added by the service worker", () => {
    expect(issueFrameTarget(makeIssue({ id: "i-1@f7", frameId: 7 }))).toEqual({ frameId: 7, issueId: "i-1" });
  });
  it("keeps ids that were not suffixed", () => {
    expect(issueFrameTarget(makeIssue({ id: "i-2", frameId: 7 }))).toEqual({ frameId: 7, issueId: "i-2" });
  });
});
