import { SEASONS } from "@/constants";
import { LOCATIONS } from "@/constants/location";
import { RED_CROSS } from "@/constants/log";

import type { AIResponse } from "@/utils/ai";

import callGemini from "@/utils/ai";
import { logger } from "@/utils/logger";

const JD_SCHEMA = {
  type: "object",

  properties: {
    citizenship_required: {
      type: "boolean",
      nullable: true,
    },

    visa_sponsorship_available: {
      type: "boolean",
      nullable: true,
    },

    location: {
      type: "string",
      enum: LOCATIONS,
    },

    qualifications: {
      type: "array",
      items: {
        type: "string",
      },
    },

    term: {
      type: "string",
      enum: SEASONS,
    },
  },

  required: [
    "citizenship_required",
    "visa_sponsorship_available",
    "location",
    "qualifications",
    "term",
  ],
};
export default async function analyzeJD(context: string): Promise<AIResponse> {
  const prompt = `
You are a recruiting analyst.

Extract structured information from the job description.

Fields:

1. citizenship_required
- true if citizenship, permanent residency, nationality, security clearance, or country-specific citizenship status is explicitly required
- false if the job explicitly says citizenship is not required
- null if unclear or not mentioned
- Do not treat general work authorization as citizenship requirement

2. visa_sponsorship_available
- true if the job explicitly says visa sponsorship, work permit sponsorship, immigration sponsorship, or visa transfer is available
- false if the job explicitly says sponsorship is unavailable
- null if unclear or not mentioned
- Do not infer sponsorship availability from equal opportunity statements

3. location
- classify into one supported location
- Use the job's primary work location
- If multiple locations are listed, choose the most representative supported location
- If remote is explicitly allowed, classify as the supported remote location if available

4. qualifications
- extract ALL candidate qualifications
- combine required and preferred qualifications
- include degree, skills, technologies, experience, language, authorization, onsite, and domain requirements
- exclude company benefits, compensation, equal opportunity statements, privacy policy, and application form fields

5. term
- classify the role into exactly one supported term
- determine internship season or seniority level
- if unclear, return "unsure"

Term classification rules:

Internship:
- Use an internship season only if the title or job description explicitly says intern, internship, co-op, student, summer, fall, spring, winter, or equivalent wording.
- If internship is mentioned but no season is clear, use "Off-season Intern".
- Internship signals override seniority signals.

Entry Level:
- Use "Entry Level" if the role explicitly targets new graduates, university graduates, early career candidates, or campus hiring.
- Use "Entry Level" if the application asks for graduation date, GPA, transcript, or student status.
- Use "Entry Level" if only a bachelor's degree and general skills are required, with no clear years of experience.

Mid Level:
- Use "Mid Level" for title-neutral software engineering roles that require independent engineering work or specialized skills.
- Use "Mid Level" if the role has production, backend, frontend, cloud, data, ML, or infrastructure responsibilities but no strong senior requirement.

Senior Level:
- Use "Senior Level" only if there are strong senior signals.
- Strong senior signals include explicit Senior, Sr., Staff, Principal, Lead, Architect, Tech Lead, Manager, Director, or 5+ years of experience.
- Do not classify as Senior Level from generic words in company descriptions, benefits, equal opportunity text, privacy policy, or application forms.
- Do not classify as Senior Level only because the role says high-impact, fast-moving, ownership, cross-functional, or ambiguous.

If conflicting signals exist:
- Internship signals override seniority.
- New graduate, GPA, transcript, or graduation date signals override generic senior-sounding language.
- If no clear evidence exists, return "unsure".

Rules:
- Return ONLY valid JSON
- Do not include explanations
- Follow the schema exactly
- Use only enum values supported by the schema
- Do not invent fields

Qualification formatting:
- Short clean bullet phrases
- Start with a capital letter
- Under 20 words
- Preserve original meaning

---BEGIN JD TEXT---
${context}
---END JD TEXT---
`;

  try {
    const response = await callGemini(prompt, JD_SCHEMA);
    return response ?? null;
  } catch (e) {
    logger.error({ err: e }, `${RED_CROSS} Error calling Gemini`);
    return { result: null, cost: 0 };
  }
}
