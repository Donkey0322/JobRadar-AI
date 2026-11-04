import type { JobCategory } from "@/constants/job-category";

interface Source {
  name: string;
  url: string;
  format: "markdown" | "html";
  type: JobCategory;
  disabled?: boolean;
}

export default Source;
