import { describe, expect, test } from "bun:test";
import { bumpVersion, determineVersionBump, shouldCreateExperimentalBranch } from "../../src/services/vcs";

describe("version bump", () => {
  test("bumps correctly", () => {
    expect(bumpVersion("v0.1.0", "PATCH")).toBe("v0.1.1");
    expect(bumpVersion("v0.1.0", "MINOR")).toBe("v0.2.0");
    expect(bumpVersion("v0.1.0", "MAJOR")).toBe("v1.0.0");
  });

  test("determines bump type", () => {
    expect(
      determineVersionBump({
        added: ["a.ts"],
        modified: [],
        deleted: [],
        stats: {},
      }),
    ).toBe("MINOR");

    expect(
      determineVersionBump({
        added: [],
        modified: ["a.ts"],
        deleted: [],
        stats: {
          "a.ts": {
            path: "a.ts",
            oldHash: "a",
            newHash: "b",
            linesAdded: 1,
            linesRemoved: 0,
            isBreaking: false,
          },
        },
      }),
    ).toBe("PATCH");

    expect(
      determineVersionBump({
        added: [],
        modified: ["api.py"],
        deleted: [],
        stats: {
          "api.py": {
            path: "api.py",
            oldHash: "a",
            newHash: "b",
            linesAdded: 1,
            linesRemoved: 1,
            isBreaking: true,
          },
        },
      }),
    ).toBe("MAJOR");
  });

  test("experimental branch decision", () => {
    const decision = shouldCreateExperimentalBranch({
      added: [],
      modified: ["api.py"],
      deleted: [],
      stats: {
        "api.py": {
          path: "api.py",
          oldHash: "a",
          newHash: "b",
          linesAdded: 2,
          linesRemoved: 2,
          isBreaking: true,
        },
      },
    });

    expect(decision.shouldBranch).toBeTrue();
    expect(decision.riskScore).toBeGreaterThanOrEqual(0.5);
  });
});
