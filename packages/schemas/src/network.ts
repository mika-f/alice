import { NETWORKS } from "@alice-hns-wallet/domain";
import { z } from "zod";

export const networkSchema = z.enum(NETWORKS);
