import {
  DainClient,
  OptionalOrderParams,
  OrderType,
  PositionDirection,
} from "../../src";
import { BN } from "@coral-xyz/anchor";
import { input, number } from "@inquirer/prompts";

import { connection } from "..";
import { loadKeypair } from "../utils";
import { DAIN_PROGRAM_ID } from "../constants";

(async () => {
  // Cancel placed order
  const userIdx = await number({ message: "Enter userIdx:" });
  const signer = loadKeypair(userIdx);
  console.log(`Wallet ${signer.publicKey.toBase58()} loaded`);

  const wallet = new NodeWallet(signer);
  const client = new DainClient(
    {
      programId: DAIN_PROGRAM_ID,
      confirmOpts: {
        commitment: "confirmed",
      },
    },
    connection,
    wallet
  );
  await client.load();

  // Get user input
  const orderId = await number({ message: "Enter orderId" });

  const tx = await client.cancelOrder(orderId);
  console.log(`Cancel order:`, tx);
})();
