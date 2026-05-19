import type { JobCategory } from "@/validation/config";

interface Source {
  name: string;
  url: string;
  format: "markdown" | "html";
  type: JobCategory;
  disabled?: boolean;
}

export default Source;
