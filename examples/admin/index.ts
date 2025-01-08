import { Keypair, PublicKey } from "@solana/web3.js";
import { ADMIN_KEYPAIR, DAIN_PROGRAM_ID, USDC_MINT } from "../constants";
import { AdminClient } from "../../src";
import { bulkAccountLoader, connection } from "..";
import NodeWallet from "@coral-xyz/anchor/dist/cjs/nodewallet";
import { bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";

const signer = Keypair.fromSecretKey(bs58.decode(ADMIN_KEYPAIR));
const wallet = new NodeWallet(signer);

export const client = new AdminClient({
  programID: DAIN_PROGRAM_ID,
  connection,
  wallet: wallet,
  accountSubscription: {
    type: "polling",
    accountLoader: bulkAccountLoader,
  },
});
