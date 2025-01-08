import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";

import {
  OracleSource,
  SPOT_MARKET_RATE_PRECISION,
  SPOT_MARKET_WEIGHT_PRECISION,
} from "../../src";
import { client } from ".";

(async () => {
  const isSubscribed = await client.subscribe();
  if (!isSubscribed) {
    throw new Error("Subscribe client failed");
  }

  // Create spot market
  const mint = new PublicKey("So11111111111111111111111111111111111111112");
  const oracle = new PublicKey("BAtFj4kQttZRVep3UZS2aZRDixkGYgWsbqTBVDbnSsPF");
  const oracleSource = OracleSource.PYTH_PULL;

  const optimalUtilization = SPOT_MARKET_RATE_PRECISION.muln(0.5).toNumber(); // 50% utilization
  const optimalRate = SPOT_MARKET_RATE_PRECISION.muln(5).toNumber(); // 500% APR
  const maxRate = SPOT_MARKET_RATE_PRECISION.muln(30).toNumber(); // 3000% APR
  const initialAssetWeight = SPOT_MARKET_WEIGHT_PRECISION.muln(0.8).toNumber();
  const maintenanceAssetWeight =
    SPOT_MARKET_WEIGHT_PRECISION.muln(0.9).toNumber();
  const initialLiabilityWeight =
    SPOT_MARKET_WEIGHT_PRECISION.muln(1.2).toNumber();
  const maintenanceLiabilityWeight =
    SPOT_MARKET_WEIGHT_PRECISION.muln(1.1).toNumber();

  const tx = await client.initializeSpotMarket(
    mint,
    oracle,
    oracleSource,
    optimalUtilization,
    optimalRate,
    maxRate,
    initialAssetWeight,
    maintenanceAssetWeight,
    initialLiabilityWeight,
    maintenanceLiabilityWeight
  );
  console.log(`Initialize market:`, tx);
})();
