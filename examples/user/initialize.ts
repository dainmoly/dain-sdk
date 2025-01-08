import { loadKeypair } from "../utils";
import { number } from "@inquirer/prompts";
import { getClient } from ".";

(async () => {
  // Initialize user state
  const userIdx = await number({ message: "Enter userIdx:" });
  const signer = loadKeypair(Number(userIdx));
  console.log(`Wallet ${signer.publicKey.toBase58()} loaded`);

  const client = await getClient(signer);
  const tx = await client.initializeUserAccount();
  console.log(`Initialize user:`, tx);
})();
