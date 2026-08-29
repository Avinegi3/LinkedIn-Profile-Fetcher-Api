import { describe, expect, it } from "vitest";
import fixture from "./fixtures/profileView.sample.json";
import { parseProfileView } from "../src/linkedin/parser";
import { VoyagerProfileViewResponse } from "../src/linkedin/client";
import { LinkedInProfileNotFoundError } from "../src/linkedin/errors";

const context = { publicIdentifier: "jane-doe", profileUrl: "https://www.linkedin.com/in/jane-doe/" };

describe("parseProfileView", () => {
  it("extracts core profile fields", () => {
    const profile = parseProfileView(fixture as VoyagerProfileViewResponse, context);

    expect(profile.name).toBe("Jane Doe");
    expect(profile.firstName).toBe("Jane");
    expect(profile.lastName).toBe("Doe");
    expect(profile.headline).toBe("Senior Software Engineer at Acme Corp");
    expect(profile.about).toBe("I build things.");
    expect(profile.location).toBe("San Francisco Bay Area");
    expect(profile.publicIdentifier).toBe("jane-doe");
    expect(profile.profileUrl).toBe("https://www.linkedin.com/in/jane-doe/");
  });

  it("picks the highest-resolution profile and background images", () => {
    const profile = parseProfileView(fixture as VoyagerProfileViewResponse, context);

    expect(profile.profileImageUrl).toBe("https://media.licdn.com/dms/image/profile-pic/400x400.jpg");
    expect(profile.backgroundImageUrl).toBe("https://media.licdn.com/dms/image/background/1128x191.jpg");
  });

  it("extracts experience in order with resolved company logos and current-role detection", () => {
    const profile = parseProfileView(fixture as VoyagerProfileViewResponse, context);

    expect(profile.experience).toHaveLength(2);

    const [current, past] = profile.experience;
    expect(current.title).toBe("Senior Software Engineer");
    expect(current.companyName).toBe("Acme Corp");
    expect(current.isCurrent).toBe(true);
    expect(current.endDate).toBeNull();
    expect(current.companyLogoUrl).toBe("https://media.licdn.com/dms/image/company-logo/200x200.jpg");

    expect(past.title).toBe("Software Engineer");
    expect(past.isCurrent).toBe(false);
    expect(past.startDate).toEqual({ month: 6, year: 2019 });
    expect(past.endDate).toEqual({ month: 2, year: 2022 });
    expect(past.companyLogoUrl).toBeNull();
  });

  it("extracts education", () => {
    const profile = parseProfileView(fixture as VoyagerProfileViewResponse, context);

    expect(profile.education).toHaveLength(1);
    expect(profile.education[0]).toMatchObject({
      schoolName: "State University",
      degreeName: "Bachelor of Science",
      fieldOfStudy: "Computer Science",
      startDate: { month: null, year: 2015 },
      endDate: { month: null, year: 2019 },
    });
  });

  it("extracts skills, deduplicated, with endorsement counts when present", () => {
    const profile = parseProfileView(fixture as VoyagerProfileViewResponse, context);

    expect(profile.skills).toEqual([
      { name: "TypeScript", endorsementCount: 42 },
      { name: "Node.js", endorsementCount: null },
    ]);
  });

  it("extracts certifications", () => {
    const profile = parseProfileView(fixture as VoyagerProfileViewResponse, context);

    expect(profile.certifications).toHaveLength(1);
    expect(profile.certifications[0]).toMatchObject({
      name: "AWS Certified Solutions Architect",
      authority: "Amazon Web Services",
      licenseNumber: "ABC123",
      url: "https://aws.amazon.com/verification/ABC123",
    });
  });

  it("extracts languages", () => {
    const profile = parseProfileView(fixture as VoyagerProfileViewResponse, context);

    expect(profile.languages).toEqual([
      { name: "English", proficiency: "NATIVE_OR_BILINGUAL" },
      { name: "Spanish", proficiency: "PROFESSIONAL_WORKING" },
    ]);
  });

  it("throws LinkedInProfileNotFoundError when no Profile entity is present", () => {
    expect(() => parseProfileView({ included: [] }, context)).toThrow(LinkedInProfileNotFoundError);
  });

  it("falls back to dash-style multiLocale* fields when the plain field is absent", () => {
    const dashStyleResponse: VoyagerProfileViewResponse = {
      included: [
        {
          entityUrn: "urn:li:fs_profile:PROFILE1",
          $type: "com.linkedin.voyager.dash.identity.profile.Profile",
          firstName: "Jane",
          lastName: "Doe",
          multiLocaleHeadline: { en_US: "Senior Software Engineer at Acme Corp" },
        },
        {
          entityUrn: "urn:li:fs_position:POSITION1",
          $type: "com.linkedin.voyager.dash.identity.profile.Position",
          multiLocaleCompanyName: { en_US: "Acme Corp" },
          timePeriod: { startDate: { month: 3, year: 2022 } },
        },
      ],
    };

    const profile = parseProfileView(dashStyleResponse, context);

    expect(profile.headline).toBe("Senior Software Engineer at Acme Corp");
    expect(profile.experience[0].companyName).toBe("Acme Corp");
  });

  it("falls back to a dateRange { start, end } shape and a flat startDate/endDate shape", () => {
    const response: VoyagerProfileViewResponse = {
      included: [
        {
          entityUrn: "urn:li:fs_profile:PROFILE1",
          $type: "com.linkedin.voyager.dash.identity.profile.Profile",
          firstName: "Jane",
          lastName: "Doe",
        },
        {
          entityUrn: "urn:li:fs_position:POSITION1",
          $type: "com.linkedin.voyager.dash.identity.profile.Position",
          companyName: "Acme Corp",
          dateRange: { start: { month: 3, year: 2022 } },
        },
        {
          entityUrn: "urn:li:fs_education:EDU1",
          $type: "com.linkedin.voyager.dash.identity.profile.Education",
          schoolName: "State University",
          startDate: { year: 2015 },
          endDate: { year: 2019 },
        },
      ],
    };

    const profile = parseProfileView(response, context);

    expect(profile.experience[0].startDate).toEqual({ month: 3, year: 2022 });
    expect(profile.experience[0].endDate).toBeNull();
    expect(profile.experience[0].isCurrent).toBe(true);
    expect(profile.education[0].startDate).toEqual({ month: null, year: 2015 });
    expect(profile.education[0].endDate).toEqual({ month: null, year: 2019 });
  });
});
