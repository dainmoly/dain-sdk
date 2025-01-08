import { PublicKey } from "@solana/web3.js";

import { BN } from "@coral-xyz/anchor";
import { client } from ".";
import { BASE_PRECISION, OracleSource } from "../../src";

(async () => {
  const isSubscribed = await client.subscribe();
  if (!isSubscribed) {
    throw new Error("Subscribe client failed");
  }

  // Create perp market
  const marketIndex = client.getPerpMarketAccounts().length;
  const oracle = new PublicKey("BAtFj4kQttZRVep3UZS2aZRDixkGYgWsbqTBVDbnSsPF"); // SOL Pyth oracle
  const oracleSource = OracleSource.PYTH_PULL;
  const baseAssetReserve = new BN(1_000_000).mul(BASE_PRECISION);
  const quoteAssetReserve = new BN(1_000_000).mul(BASE_PRECISION);
  const periodicity = new BN(60 * 60); // 1 HOUR

  const tx = await client.initializePerpMarket(
    marketIndex,
    oracle,
    oracleSource,
    baseAssetReserve,
    quoteAssetReserve,
    periodicity
  );
  console.log(`Initialize market:`, tx);
})();
