import { describe, expect, it, vi } from "vitest";

import type { ATS } from "@/modules/employer/type";

import { fetchAshbyJD } from "../ashby";
import { fetchCustomJD } from "../custom";
import { fetchEightfoldJD } from "../eightfold";
import { JD_FETCH_OK } from "../fetch";
import { fetchGreenhouseJD } from "../greenhouse";
import { fetchIcimsJD } from "../icims";
import { fetchOracleJD } from "../oraclecloud";
import { fetchJDByATS, postingJDFetchers } from "../registry";
import { fetchSmartRecruitersJD } from "../smart";
import { fetchWorkdayJD } from "../workday";

describe("posting JD registry", () => {
  it("dispatches every ATS to its fetcher", () => {
    expect(postingJDFetchers).toEqual({
      ashby: fetchAshbyJD,
      eightfold: fetchEightfoldJD,
      greenhouse: fetchGreenhouseJD,
      icims: fetchIcimsJD,
      oraclecloud: fetchOracleJD,
      smartrecruiters: fetchSmartRecruitersJD,
      workday: fetchWorkdayJD,
      lever: fetchCustomJD,
      phenom: fetchCustomJD,
      radancy: fetchCustomJD,
      custom: fetchCustomJD,
    });
  });

  it("calls the mapped fetcher with the url and signal", async () => {
    const signal = AbortSignal.timeout(1000);
    const url = "https://jobs.ashbyhq.com/acme/1";
    const spy = vi.spyOn(postingJDFetchers, "ashby").mockResolvedValue({
      jd: "jd",
      error: JD_FETCH_OK,
    });

    await expect(fetchJDByATS("ashby" satisfies ATS, url, signal)).resolves.toEqual({
      jd: "jd",
      error: JD_FETCH_OK,
    });
    expect(spy).toHaveBeenCalledWith(url, signal);
    spy.mockRestore();
  });
});
