import { describe, expect, it } from "vitest";
import type { Match, NetworkView, PublicProfile } from "../types";
import { contactHost, everyoneDescription, everyoneHeading, hasAnyMatch, hasDemo, LOGIN_HREF } from "./view";

const person = (isDemo: boolean): PublicProfile => ({
  publicId: String(Math.random()),
  displayName: "P",
  city: "",
  lookingFor: "",
  contactUrl: null,
  isDemo,
  provenSkills: [],
  joinedAt: "",
});

const plain = (profile: PublicProfile): Match => ({
  profile,
  score: 0,
  mentorFor: [],
  sharedLearning: [],
  sharedProven: [],
  reasons: [],
});

const view = (overrides: Partial<NetworkView>): NetworkView => ({
  me: null,
  inNetwork: true,
  friendRequests: [],
  pings: [],
  friends: [],
  mentors: [],
  peers: [],
  everyone: [],
  viewerHasMaps: false,
  signedIn: false,
  signInRequired: false,
  displayName: null,
  ...overrides,
});

describe("network view helpers", () => {
  it("shows only the host of an https contact link", () => {
    expect(contactHost("https://www.linkedin.com/in/ana")).toBe("linkedin.com");
    expect(contactHost("javascript:alert(1)")).toBeNull();
    expect(contactHost("http://example.com")).toBeNull();
    expect(contactHost(null)).toBeNull();
  });

  it("notices demo profiles in any section", () => {
    expect(hasDemo(view({ everyone: [plain(person(false))] }))).toBe(false);
    expect(hasDemo(view({ everyone: [plain(person(true))] }))).toBe(true);
    const match = { profile: person(true), score: 3, mentorFor: ["x"], sharedLearning: [], sharedProven: [], reasons: [] };
    expect(hasDemo(view({ mentors: [match] }))).toBe(true);
  });

  it("says 'else' only when people were shown above", () => {
    expect(everyoneHeading(view({}))).toBe("People in the network");
    const match = { profile: person(false), score: 2, mentorFor: [], sharedLearning: ["x"], sharedProven: [], reasons: [] };
    expect(everyoneHeading(view({ peers: [match] }))).toBe("Everyone else in the network");
  });

  it("counts someone who only proved the same skill as a match", () => {
    expect(hasAnyMatch(view({ everyone: [plain(person(false))] }))).toBe(false);
    const sameProven: Match = {
      ...plain(person(false)),
      score: 1,
      sharedProven: ["SQL"],
      reasons: ["Also proved SQL, like you."],
    };
    expect(hasAnyMatch(view({ everyone: [sameProven] }))).toBe(true);
  });

  it("never tells the last section it has no skills in common", () => {
    expect(everyoneDescription(view({ viewerHasMaps: true }))).toBe("Not learning the same skills as you right now.");
    expect(everyoneDescription(view({}))).toMatch(/^Build a map or join/);
  });

  it("signs in and comes back to /people", () => {
    expect(LOGIN_HREF).toBe("/api/auth/login?returnTo=%2Fpeople");
  });
});
