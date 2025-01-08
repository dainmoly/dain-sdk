import { PublicKey } from "@solana/web3.js";
import { configDotenv } from "dotenv";
configDotenv();

export const RPC_URL =
  process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
export const DAIN_PROGRAM_ID = new PublicKey(process.env.DAIN_PROGRAM_ID ?? "");
export const ADMIN_KEYPAIR = process.env.ADMIN_KEYPAIR ?? "";

export const USDC_MINT = "8zGuJQqwhZafTah7Uc7Z4tXRnguqkn5KLFAP8oV6PHe2";
