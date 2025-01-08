import { BN } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import { DainClient, decodeName, NodeWallet, shortenPubkey, USDC_MINT, WSOL_MINT } from "dain-sdk";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { input, number, select } from '@inquirer/prompts';

import { connection } from "..";
import { loadKeypair } from "../utils";
import { DAIN_PROGRAM_ID } from "../constants";


(async () => {
    // Withdraw/Borrow funds for user
    const userIdx = await number({ message: 'Enter userIdx:' });
    const signer = loadKeypair(userIdx);
    console.log(`Wallet ${signer.publicKey.toBase58()} loaded`);

    const wallet = new NodeWallet(signer);
    const client = new DainClient({
        programId: DAIN_PROGRAM_ID,
        confirmOpts: {
            commitment: 'confirmed'
        }
    }, connection, wallet);
    await client.load();

    // Get user input
    const markets = client.getSpotMarketAccounts();
    const marketIndex = await select({
        message: 'Choose market',
        choices: markets.map((market) => {
            return {
                name: `${decodeName(market.name)} (${shortenPubkey(market.mint.toBase58())})`,
                value: market.marketIndex
            }
        })
    });

    const market = client.getSpotMarketAccount(marketIndex);
    const mint = market.mint;
    const user = client.authority;
    const userTokenAccount = getAssociatedTokenAddressSync(mint, user);

    const amount = Number(await input({ message: "Enter withdraw amount" }));
    const amountBN = new BN(amount * (10 ** market.decimals));

    const tx = await client.withdraw(
        marketIndex,
        amountBN,
        mint.equals(WSOL_MINT) ? user : userTokenAccount,
    );
    console.log(`Withdraw funds:`, tx);
})()