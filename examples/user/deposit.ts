import { BN } from "@coral-xyz/anchor";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { input, number, select } from "@inquirer/prompts";

import { connection } from "..";
import { loadKeypair } from "../utils";
import { DAIN_PROGRAM_ID } from "../constants";
import { getClient } from ".";
import { decodeName, SpotMarketAccount, WRAPPED_SOL_MINT } from "../../src";

(async () => {
  // Deposit funds from user
  const userIdx = await number({ message: "Enter userIdx:" });
  const signer = loadKeypair(Number(userIdx));
  console.log(`Wallet ${signer.publicKey.toBase58()} loaded`);

  const client = await getClient(signer);

  // Get user input
  const markets = client.getSpotMarketAccounts();
  const marketIndex = await select({
    message: "Choose market",
    choices: markets.map((market) => {
      return {
        name: `${decodeName(market.name)} (${market.mint.toBase58()})`,
        value: market.marketIndex,
      };
    }),
  });

  const market = client.getSpotMarketAccount(marketIndex) as SpotMarketAccount;

  const mint = market.mint;
  const user = client.authority;
  const userTokenAccount = getAssociatedTokenAddressSync(mint, user);

  const amount = Number(await input({ message: "Enter deposit amount" }));
  const amountBN = new BN(amount * 10 ** market.decimals);

  const tx = await client.deposit(
    amountBN,
    marketIndex,
    mint.equals(WRAPPED_SOL_MINT) ? user : userTokenAccount
  );
  console.log(`Deposit funds:`, tx);
})();
