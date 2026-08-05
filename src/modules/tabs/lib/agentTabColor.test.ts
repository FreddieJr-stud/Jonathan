import { describe, expect, it } from "vitest";
import type { AgentStatus } from "@/modules/agents/lib/types";
import { agentColorForTab } from "./agentTabColor";

type S = { tabId: number; status: AgentStatus };

describe("agentColorForTab", () => {
  it("returns undefined when no session targets the tab", () => {
    const sessions: Record<number, S> = { 1: { tabId: 9, status: "working" } };
    expect(agentColorForTab(sessions, 5)).toBeUndefined();
  });

  it("maps a working session to the working color", () => {
    const sessions: Record<number, S> = { 1: { tabId: 5, status: "working" } };
    expect(agentColorForTab(sessions, 5)).toBe("working");
  });

  it("maps a waiting session to the question color", () => {
    const sessions: Record<number, S> = { 1: { tabId: 5, status: "waiting" } };
    expect(agentColorForTab(sessions, 5)).toBe("question");
  });

  it("maps idle and done sessions", () => {
    expect(agentColorForTab({ 1: { tabId: 5, status: "idle" } }, 5)).toBe(
      "idle",
    );
    expect(agentColorForTab({ 1: { tabId: 5, status: "done" } }, 5)).toBe(
      "done",
    );
  });

  it("picks the highest-priority status across panes (waiting > working > done > idle)", () => {
    const sessions: Record<number, S> = {
      1: { tabId: 5, status: "idle" },
      2: { tabId: 5, status: "done" },
      3: { tabId: 5, status: "working" },
      4: { tabId: 5, status: "waiting" },
    };
    expect(agentColorForTab(sessions, 5)).toBe("question");

    const noWaiting: Record<number, S> = {
      1: { tabId: 5, status: "idle" },
      2: { tabId: 5, status: "done" },
      3: { tabId: 5, status: "working" },
    };
    expect(agentColorForTab(noWaiting, 5)).toBe("working");
  });
});
