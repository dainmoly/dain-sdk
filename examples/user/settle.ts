import { OptionalOrderParams, OrderType, PositionDirection } from "dain-sdk";
import { BN } from "@coral-xyz/anchor";

import { connection } from "..";
import { loadKeypair } from "../utils";
import { DAIN_PROGRAM_ID } from "../constants";


(async () => {
    await client.load();

    // Settle funds for market
    const marketIndex = 1;

    const tx = await client.settlePnl(
        marketIndex,
    );
    console.log(`Settle pnl:`, tx);
})()