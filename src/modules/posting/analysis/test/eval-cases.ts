import { getSeasonYears, SEASONS } from "@/constants/season";

import type { JD } from "@/types";

import { JobCategory } from "@/validation/config";

export interface JdEvalCase {
  name: string;
  jd: string;
  expected: Pick<JD, "citizenship" | "sponsorship" | "country" | "category" | "season"> & {
    locationIncludes?: string;
  };
}

const seasonYears = getSeasonYears();

export const JD_EVAL_CASES: JdEvalCase[] = [
  {
    name: "work authorization is not citizenship",
    jd: `Software Engineer
Location: New York, NY, United States

Candidates must have legal authorization to work in the United States. We are unable to provide visa sponsorship.

Requirements:
- Bachelor's degree in Computer Science
- 3+ years of professional software engineering experience
- Experience with TypeScript and Node.js`,
    expected: {
      citizenship: null,
      sponsorship: false,
      country: "USA",
      category: JobCategory.MID_LEVEL,
      season: SEASONS.none,
      locationIncludes: "New York",
    },
  },
  {
    name: "explicitly not a citizenship requirement",
    jd: `Backend Engineer
Location: Seattle, WA, USA

US citizenship is not required. Applicants must be authorized to work in the United States.

Requirements:
- 3+ years of backend development experience
- Python`,
    expected: {
      citizenship: false,
      sponsorship: null,
      country: "USA",
      category: JobCategory.MID_LEVEL,
      season: SEASONS.none,
      locationIncludes: "Seattle",
    },
  },
  {
    name: "EEO text is not sponsorship",
    jd: `Platform Engineer
Location: Austin, TX, USA

We are an equal opportunity employer and do not discriminate on the basis of race, color, religion, sex, national origin, or veteran status.

Requirements:
- 3+ years of infrastructure experience
- Kubernetes`,
    expected: {
      citizenship: null,
      sponsorship: null,
      country: "USA",
      category: JobCategory.MID_LEVEL,
      season: SEASONS.none,
      locationIncludes: "Austin",
    },
  },
  {
    name: "CPT/OPT is not visa sponsorship",
    jd: `Software Engineer
Location: Boston, MA, USA

CPT and OPT candidates are welcome. This role does not offer visa sponsorship.

Requirements:
- 3+ years of professional software engineering experience
- Experience with Java`,
    expected: {
      citizenship: null,
      sponsorship: false,
      country: "USA",
      category: JobCategory.MID_LEVEL,
      season: SEASONS.none,
      locationIncludes: "Boston",
    },
  },
  {
    name: "citizenship and no sponsorship are explicit",
    jd: `Software Engineer
Location: Arlington, VA, USA

This position requires US citizenship and the ability to obtain a security clearance. Visa sponsorship is not available.

Requirements:
- 3+ years of software development experience
- C++`,
    expected: {
      citizenship: true,
      sponsorship: false,
      country: "USA",
      category: JobCategory.MID_LEVEL,
      season: SEASONS.none,
      locationIncludes: "Arlington",
    },
  },
  {
    name: "H-1B sponsorship is explicit",
    jd: `Machine Learning Engineer
Location: San Francisco, CA, United States

We offer H-1B visa sponsorship for this role.

Requirements:
- 3+ years of machine learning experience
- Python and PyTorch`,
    expected: {
      citizenship: null,
      sponsorship: true,
      country: "USA",
      category: JobCategory.MID_LEVEL,
      season: SEASONS.none,
      locationIncludes: "San Francisco",
    },
  },
  {
    name: "intern signals override senior wording in the company description",
    jd: `Software Engineering Intern - Summer ${seasonYears.summer}
Location: San Jose, CA, USA

Join our Senior leadership team's intern program for Summer ${seasonYears.summer}. You will work with Principal engineers on production systems.

This is a summer internship for university students.

Requirements:
- Currently pursuing a Bachelor's degree in Computer Science
- Graduation date in ${seasonYears.summer} or later`,
    expected: {
      citizenship: null,
      sponsorship: null,
      country: "USA",
      category: JobCategory.SUMMER_INTERN,
      season: SEASONS.summer,
      locationIncludes: "San Jose",
    },
  },
  {
    name: "senior title wins even with 3 years of experience",
    jd: `Senior Software Engineer
Location: Chicago, IL, USA

Requirements:
- 3+ years of professional software engineering experience
- Go and distributed systems`,
    expected: {
      citizenship: null,
      sponsorship: null,
      country: "USA",
      category: JobCategory.SENIOR_LEVEL,
      season: SEASONS.none,
      locationIncludes: "Chicago",
    },
  },
  {
    name: "4 years of experience is not senior",
    jd: `Software Engineer
Location: Denver, CO, USA

Requirements:
- 4+ years of professional software engineering experience
- React and TypeScript`,
    expected: {
      citizenship: null,
      sponsorship: null,
      country: "USA",
      category: JobCategory.MID_LEVEL,
      season: SEASONS.none,
      locationIncludes: "Denver",
    },
  },
  {
    name: "5+ years of experience is senior",
    jd: `Software Engineer
Location: Atlanta, GA, USA

Requirements:
- 5+ years of professional software engineering experience
- Java and Kafka`,
    expected: {
      citizenship: null,
      sponsorship: null,
      country: "USA",
      category: JobCategory.SENIOR_LEVEL,
      season: SEASONS.none,
      locationIncludes: "Atlanta",
    },
  },
  {
    name: "new grad with GPA is entry level",
    jd: `New Grad Software Engineer
Location: New York, NY, USA

This role is for recent university graduates and campus hires.

Requirements:
- Bachelor's degree in Computer Science
- GPA of 3.0 or higher
- Graduation date in ${seasonYears.summer}
- Internship, coursework, or project experience accepted`,
    expected: {
      citizenship: null,
      sponsorship: null,
      country: "USA",
      category: JobCategory.ENTRY_LEVEL,
      season: SEASONS.none,
      locationIncludes: "New York",
    },
  },
  {
    name: "fall co-op is an off-season intern",
    jd: `Software Engineering Co-op - Fall ${seasonYears.fall}
Location: Pittsburgh, PA, USA

This is a Fall ${seasonYears.fall} co-op for university students.

Requirements:
- Currently enrolled in a Computer Science degree
- Availability for Fall ${seasonYears.fall}`,
    expected: {
      citizenship: null,
      sponsorship: null,
      country: "USA",
      category: JobCategory.OFF_SEASON_INTERN,
      season: SEASONS.fall,
      locationIncludes: "Pittsburgh",
    },
  },
  {
    name: "USA-only remote stays USA",
    jd: `Software Engineer
Location: Remote - United States

This role is remote and restricted to residents of the United States.

Requirements:
- 3+ years of software engineering experience
- TypeScript`,
    expected: {
      citizenship: null,
      sponsorship: null,
      country: "USA",
      category: JobCategory.MID_LEVEL,
      season: SEASONS.none,
    },
  },
  {
    name: "unrestricted remote is Remote",
    jd: `Software Engineer
Location: Remote

This role is fully remote and is not tied to a specific country.

Requirements:
- 3+ years of software engineering experience
- TypeScript`,
    expected: {
      citizenship: null,
      sponsorship: null,
      country: "Remote",
      category: JobCategory.MID_LEVEL,
      season: SEASONS.none,
    },
  },
];
