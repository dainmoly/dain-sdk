import { PublicKey } from "@solana/web3.js";
import { USDC_MINT } from "../constants";
import { client } from ".";

(async () => {
  // Initialize global state
  const tx = await client.initialize(new PublicKey(USDC_MINT), false);
  console.log(`Initialize:`, tx);
})();
