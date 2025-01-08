import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";

import { OracleSource } from "../../src";
import { USDC_MINT } from "../constants";
import { client } from ".";

(async () => {
  const isSubscribed = await client.subscribe();
  if (!isSubscribed) {
    throw new Error("Subscribe client failed");
  }

  // Create spot market
  const mint = new PublicKey(USDC_MINT);
  const oracle = PublicKey.default;
  const oracleSource = OracleSource.QUOTE_ASSET;
  const tx = await client.initializeSpotMarket(mint, oracle, oracleSource);
  console.log(`Initialize market:`, tx);
})();
