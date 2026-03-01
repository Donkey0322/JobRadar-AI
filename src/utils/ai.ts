import { GoogleGenAI } from "@google/genai";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? "";
const DEFAULT_MODEL = "gemini-2.5-flash";
const JD_SCHEMA = {
  type: "object",
  properties: {
    requires_usa_citizenship: {
      type: "string",
      enum: ["yes", "no", "unsure"],
    },
    offers_visa_sponsorship: {
      type: "string",
      enum: ["yes", "no", "unsure"],
    },
    qualifications: {
      type: "array",
      items: { type: "string" },
    },
    term: {
      type: "string",
      enum: [
        "2026 Winter",
        "2026 Spring",
        "2026 Summer",
        "2026 Fall",
        "2027 Spring",
        "2027 Winter",
        "New Grad",
        "unsure",
      ],
    },
  },
  required: ["requires_usa_citizenship", "offers_visa_sponsorship", "qualifications", "term"],
};

export default async function callGemini(
  contextText: string,
  model: string = DEFAULT_MODEL
): Promise<string | null> {
  if (!GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY is not set");
    return null;
  }
  const prompt = `
    You are a recruiting analyst.

    Extract from the job description:
    1. Whether USA citizenship is required.
    2. Whether the employer offers visa sponsorship.
    3. ALL qualifications (basic and preferred combined).
    4. The job term. If the term is not clear, return "unsure". If it is a full-time new grad position, return "New Grad".

    Rules:
    - If unclear or missing, return "unsure".
    - Return ONLY valid JSON.
    - Do NOT include explanations.
    - Follow the schema exactly.
    - For the qualifications.
  
    Formatting rules for qualifications:
    - Return each qualification as a short, clean bullet phrase.
    - Start with a capital letter.
    - Prefer starting with a verb (e.g., "Develop", "Design", "Build") 
      or an adjective (e.g., "Strong", "Proficient", "Excellent").
    - Do not rewrite meaning.
    - Do not add new information.
    - Keep each qualification concise (under 20 words).

    ---BEGIN JD TEXT---
    ${contextText}
    ---END JD TEXT---
  `;

  const client = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  const response = await client.models.generateContent({
    model,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: JD_SCHEMA,
    },
  });

  // ---- Token usage & cost ----
  const usage = response.usageMetadata;

  if (usage) {
    const inputTokens = usage.promptTokenCount ?? 0;
    const outputTokens = usage.candidatesTokenCount ?? 0;

    const priceIn = 0.3 / 1_000_000;
    const priceOut = 2.5 / 1_000_000;

    const cost = inputTokens * priceIn + outputTokens * priceOut;

    console.log(`💲 Actual estimated cost: $${cost.toFixed(6)} USD`);
  }

  return response.text ?? null;
}
