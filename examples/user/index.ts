import { Keypair, PublicKey } from "@solana/web3.js";
import { ADMIN_KEYPAIR, DAIN_PROGRAM_ID, USDC_MINT } from "../constants";
import { DainClient } from "../../src";
import { bulkAccountLoader, connection } from "..";
import NodeWallet from "@coral-xyz/anchor/dist/cjs/nodewallet";
import { bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";

export const getClient = async (signer: Keypair) => {
  const wallet = new NodeWallet(signer);
  const client = new DainClient({
    programID: DAIN_PROGRAM_ID,
    connection,
    wallet: wallet,
    accountSubscription: {
      type: "polling",
      accountLoader: bulkAccountLoader,
    },
  });
  const isSubscribed = await client.subscribe();
  if (!isSubscribed) {
    throw new Error("Subscribe client failed");
  }

  return client;
};
