import { describe, expect, it } from "vitest";
import { extractPublicIdentifier, InvalidProfileUrlError } from "../src/utils/urlParser";

describe("extractPublicIdentifier", () => {
  it.each([
    ["https://www.linkedin.com/in/jane-doe-1234ab567/", "jane-doe-1234ab567"],
    ["https://www.linkedin.com/in/jane-doe-1234ab567", "jane-doe-1234ab567"],
    ["http://linkedin.com/in/jane-doe", "jane-doe"],
    ["www.linkedin.com/in/jane-doe", "jane-doe"],
    ["linkedin.com/in/jane-doe", "jane-doe"],
    ["https://www.linkedin.com/in/jane-doe?trk=public_profile", "jane-doe"],
    ["https://m.linkedin.com/in/jane-doe/", "jane-doe"],
    ["https://www.linkedin.com/in/jane-doe/details/experience/", "jane-doe"],
  ])("extracts the public identifier from %s", (input, expected) => {
    expect(extractPublicIdentifier(input)).toBe(expected);
  });

  it("throws InvalidProfileUrlError for a non-LinkedIn URL", () => {
    expect(() => extractPublicIdentifier("https://example.com/in/jane-doe")).toThrow(InvalidProfileUrlError);
  });

  it("throws InvalidProfileUrlError for a LinkedIn URL without /in/", () => {
    expect(() => extractPublicIdentifier("https://www.linkedin.com/company/acme")).toThrow(
      InvalidProfileUrlError
    );
  });

  it("throws InvalidProfileUrlError for an empty string", () => {
    expect(() => extractPublicIdentifier("")).toThrow(InvalidProfileUrlError);
  });

  it("throws InvalidProfileUrlError for garbage input", () => {
    expect(() => extractPublicIdentifier("not a url at all")).toThrow(InvalidProfileUrlError);
  });
});
