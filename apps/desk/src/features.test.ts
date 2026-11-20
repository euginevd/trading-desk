import { describe, expect, it } from "vitest";
import { FEATURES, type FeatureInfo, featureOn, isNew } from "./features";

describe("feature flags", () => {
  it("starts today's pages on, and keeps Dashboard and Settings on whatever is saved", () => {
    expect(FEATURES.every((f) => featureOn({}, f.id))).toBe(true);
    expect(featureOn({ journal: false }, "journal")).toBe(false);
    expect(featureOn({ dashboard: false, settings: false }, "dashboard")).toBe(true);
    expect(featureOn({ settings: false }, "settings")).toBe(true);
  });

  it("tags a feature that starts off as New until the owner switches it", () => {
    const later: FeatureInfo = { id: "journal", name: "Later", what: "", startsOn: false };
    expect(isNew({}, later)).toBe(true);
    expect(isNew({ journal: false }, later)).toBe(false);
    expect(FEATURES.some((f) => isNew({}, f))).toBe(false);
  });
});
