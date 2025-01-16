import { loadKeypair } from "../utils";
import { number } from "@inquirer/prompts";
import { getClient } from ".";
import {
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { connection } from "..";
import { getWallet, initialize } from "../lending";
import { ADMIN_KEYPAIR } from "../constants";
import { bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";

(async () => {
  // Initialize user state
  // const userIdx = await number({ message: "Enter userIdx:" });
  // const signer = loadKeypair(Number(userIdx));
  const signer = Keypair.fromSecretKey(bs58.decode(ADMIN_KEYPAIR));
  // const authority = signer.publicKey;
  const authority = new PublicKey("6TwwYmTkC9ruzGMq4Q7Ex4r2z14JoUyhwgnFSBt5uWPy");
  console.log(`Wallet ${authority.toBase58()} loaded`);

  const client = await getClient(Keypair.generate());
  await client.updateWallet(getWallet(authority));
  const ixs = await initialize(client, 0, "test");

  const message = new TransactionMessage({
    payerKey: authority,
    recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
    instructions: ixs,
  }).compileToV0Message();

  const transaction = new VersionedTransaction(message);
  // transaction.sign([signer]);
  const serializedTx = Buffer.from(transaction.serialize());

  const simulateRes = await connection.simulateTransaction(transaction, {
    sigVerify: false,
  });
  console.log(simulateRes);

  // const signature = await connection.sendRawTransaction(serializedTx, {
  //   preflightCommitment: "confirmed",
  //   maxRetries: 10,
  // });
  // console.log(signature);
  // const confirmRes = await connection.confirmTransaction(
  //   signature,
  //   "confirmed"
  // );
  // console.log(confirmRes);
})();
