export interface DatePoint {
  month: number | null;
  year: number | null;
}

export interface ExperienceEntry {
  title: string | null;
  companyName: string | null;
  companyLogoUrl: string | null;
  location: string | null;
  startDate: DatePoint | null;
  endDate: DatePoint | null;
  isCurrent: boolean;
  description: string | null;
}

export interface EducationEntry {
  schoolName: string | null;
  schoolLogoUrl: string | null;
  degreeName: string | null;
  fieldOfStudy: string | null;
  startDate: DatePoint | null;
  endDate: DatePoint | null;
  description: string | null;
}

export interface SkillEntry {
  name: string;
  endorsementCount: number | null;
}

export interface CertificationEntry {
  name: string | null;
  authority: string | null;
  licenseNumber: string | null;
  url: string | null;
  startDate: DatePoint | null;
  endDate: DatePoint | null;
}

export interface LanguageEntry {
  name: string;
  proficiency: string | null;
}

export interface LinkedInProfile {
  publicIdentifier: string;
  profileUrl: string;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  headline: string | null;
  location: string | null;
  about: string | null;
  profileImageUrl: string | null;
  backgroundImageUrl: string | null;
  connectionsCount: number | null;
  followersCount: number | null;
  experience: ExperienceEntry[];
  education: EducationEntry[];
  skills: SkillEntry[];
  certifications: CertificationEntry[];
  languages: LanguageEntry[];
  scrapedAt: string;
}
