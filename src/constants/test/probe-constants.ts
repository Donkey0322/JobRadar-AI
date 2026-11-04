import { COUNTRIES, JOB_CATEGORIES, SEASONS } from "@/constants";

if (!COUNTRIES.includes("USA") || JOB_CATEGORIES.length !== 5 || SEASONS.none !== "None") {
  throw new Error("constants barrel changed");
}

console.log("constants-ok");
