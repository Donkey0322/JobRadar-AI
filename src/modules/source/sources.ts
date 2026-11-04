import { JobCategory } from "@/constants/job-category";

import type { Source } from "@/types";

export const SOURCES: Source[] = [
  {
    name: "vansh",
    url: "https://raw.githubusercontent.com/vanshb03/Summer2027-Internships/dev/README.md",
    format: "markdown",
    type: JobCategory.SUMMER_INTERN,
    disabled: false,
  },
  {
    name: "vansh-off-season",
    url: "https://raw.githubusercontent.com/vanshb03/Summer2027-Internships/refs/heads/dev/OFFSEASON_README.md",
    format: "markdown",
    type: JobCategory.OFF_SEASON_INTERN,
    disabled: false,
  },
  {
    name: "vansh-new-grad",
    url: "https://raw.githubusercontent.com/vanshb03/New-Grad-2027/refs/heads/dev/README.md",
    format: "markdown",
    type: JobCategory.ENTRY_LEVEL,
    disabled: false,
  },
  {
    name: "simplify",
    url: "https://raw.githubusercontent.com/SimplifyJobs/Summer2027-Internships/dev/README.md",
    format: "html",
    type: JobCategory.SUMMER_INTERN,
    disabled: false,
  },
  {
    name: "simplify-off-season",
    url: "https://raw.githubusercontent.com/SimplifyJobs/Summer2027-Internships/refs/heads/dev/README-Off-Season.md",
    format: "html",
    type: JobCategory.OFF_SEASON_INTERN,
    disabled: false,
  },
  {
    name: "simplify-new-grad",
    url: "https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/refs/heads/dev/README.md",
    format: "html",
    type: JobCategory.ENTRY_LEVEL,
    disabled: false,
  },
];
