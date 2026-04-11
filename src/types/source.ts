import type { Target } from "@/validation/config";

interface Source {
  name: string;
  url: string;
  format: "markdown" | "html";
  type: Target;
  disabled?: boolean;
}

export default Source;
