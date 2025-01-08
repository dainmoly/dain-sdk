import { Connection, Keypair } from "@solana/web3.js";
import * as bs58 from "bs58";
import { ADMIN_KEYPAIR, DAIN_PROGRAM_ID, RPC_URL } from "./constants";
import NodeWallet from "@coral-xyz/anchor/dist/cjs/nodewallet";
import { AdminClient, DainClient, BulkAccountLoader } from "../src";

export const connection = new Connection(RPC_URL);
export const bulkAccountLoader = new BulkAccountLoader(
  connection,
  "confirmed",
  1000
);
