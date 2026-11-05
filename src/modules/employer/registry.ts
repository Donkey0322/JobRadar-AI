import type { Board } from "./employer";
import type { ATS } from "@/modules/ats/types";
import type { Company } from "@/types";

import { ashbyBoard } from "./listing/ashby";
import { bambooHRBoard } from "./listing/bamboohr";
import { customBoard } from "./listing/custom";
import { eightfoldBoard } from "./listing/eightfold";
import { greenhouseBoard } from "./listing/greenhouse";
import { icimsBoard } from "./listing/icims";
import { jazzHRBoard } from "./listing/jazzhr";
import { leverBoard } from "./listing/lever";
import { noneBoard } from "./listing/none";
import { oracleCloudBoard } from "./listing/oraclecloud";
import { phenomBoard } from "./listing/phenom";
import { pinpointBoard } from "./listing/pinpoint";
import { radancyBoard } from "./listing/radancy";
import { ripplingBoard } from "./listing/rippling";
import { smartRecruitersBoard } from "./listing/smart";
import { successFactorsBoard } from "./listing/successfactors";
import { workdayBoard } from "./listing/workday";

export const boards = {
  ashby: ashbyBoard,
  bamboohr: bambooHRBoard,
  eightfold: eightfoldBoard,
  greenhouse: greenhouseBoard,
  icims: icimsBoard,
  jazzhr: jazzHRBoard,
  lever: leverBoard,
  oraclecloud: oracleCloudBoard,
  phenom: phenomBoard,
  pinpoint: pinpointBoard,
  radancy: radancyBoard,
  rippling: ripplingBoard,
  smartrecruiters: smartRecruitersBoard,
  successfactors: successFactorsBoard,
  workday: workdayBoard,
  custom: customBoard,
  none: noneBoard,
} satisfies Record<ATS, Board<unknown>>;

export function asBoard(company: Company): Board {
  const Adapter = boards[company.ats].constructor as new (company?: Company) => Board;
  return new Adapter(company);
}
