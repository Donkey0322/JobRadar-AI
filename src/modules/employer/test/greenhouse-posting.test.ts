import { describe, expect, it } from "vitest";

import { canonicalGreenhouseJobUrl, greenhousePostingFromHtml } from "../shared/greenhouse";

const PAGE =
  "https://www.example.com/careers/software-engineer---new-grad-distributed-data-systems-2027-start-6865704002";

describe("greenhousePostingFromHtml", () => {
  it("pairs an embedded board with the requisition id on the career slug", () => {
    const html = `<script src="https://job-boards.greenhouse.io/embed/job_board/js?for=databricks"></script>`;

    expect(greenhousePostingFromHtml(PAGE, html)).toEqual({
      board: "databricks",
      jobId: "6865704002",
    });
    expect(canonicalGreenhouseJobUrl(PAGE, { board: "databricks", jobId: "6865704002" })).toBe(
      "https://job-boards.greenhouse.io/databricks/jobs/6865704002"
    );
  });

  it("reads a board and job id from an embedded Greenhouse job url", () => {
    const html = `<a href="https://job-boards.greenhouse.io/acme/jobs/1234567">Apply</a>`;

    expect(greenhousePostingFromHtml("https://www.example.com/careers/role", html)).toEqual({
      board: "acme",
      jobId: "1234567",
    });
  });

  it("keeps gh_jid when the page does not name a board", () => {
    const html = `<a href="https://www.example.com/apply?gh_jid=6865704002">Apply</a>`;
    const posting = greenhousePostingFromHtml(PAGE, html);

    expect(posting).toEqual({ board: null, jobId: "6865704002" });
    expect(canonicalGreenhouseJobUrl(PAGE, posting!)).toBe(`${PAGE}?gh_jid=6865704002`);
  });

  it("resolves a board assigned to a JavaScript template variable", () => {
    const html = `<script>
      const BOARD = 'jumptrading';
      const API = \`https://boards-api.greenhouse.io/v1/boards/\${BOARD}/jobs\`;
      const link = "https://www.jumptrading.com/hr/job?gh_jid=4982814";
    </script>`;

    expect(
      greenhousePostingFromHtml("https://www.jumptrading.com/hr/job?gh_jid=4982814", html)
    ).toEqual({
      board: "jumptrading",
      jobId: "4982814",
    });
  });

  it("reads a board from a JavaScript string with escaped slashes", () => {
    const html = String.raw`<script>window.__RETRIEVE_A_JOB_ENDPOINT__ = 'https:\/\/boards-api.greenhouse.io\/v1\/boards\/ixllearning\/jobs\/8862043002';</script>`;

    expect(
      greenhousePostingFromHtml("https://www.ixl.com/company/jobs?gh_jid=8862043002", html)
    ).toEqual({
      board: "ixllearning",
      jobId: "8862043002",
    });
  });

  it("reads a Greenhouse board token from the apply form", () => {
    const html = `<input type="hidden" name="job_id" value="8784053002"/><input type="hidden" name="board_token" value="x9"/><a href="https://x.company/careers/8784053002?gh_jid=8784053002">Apply</a>`;

    expect(
      greenhousePostingFromHtml("https://x.company/careers/8784053002?gh_jid=8784053002", html)
    ).toEqual({
      board: "x9",
      jobId: "8784053002",
    });
  });

  it("ignores an unsubstituted Greenhouse template variable", () => {
    const html = "https://boards-api.greenhouse.io/v1/boards/${BOARD}/jobs?gh_jid=4982814";

    expect(greenhousePostingFromHtml("https://www.jumptrading.com/hr/job", html)).toEqual({
      board: null,
      jobId: "4982814",
    });
  });

  it("ignores a trailing slug number when the page is not Greenhouse", () => {
    expect(greenhousePostingFromHtml(PAGE, "<html><body>Software Engineer</body></html>")).toBe(
      null
    );
  });
});
