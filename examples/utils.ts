import { Keypair } from "@solana/web3.js";
import * as fs from "fs";

export function loadKeypair(idx: number) {
  const keypairPath = `./keypairs/user${idx}.json`;
  const contents = fs.readFileSync(keypairPath, "utf-8");
  const keypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(contents)));
  return keypair;
}
