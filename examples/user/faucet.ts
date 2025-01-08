import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { BTC_MINT, PYUSD_MINT, TOKEN_FAUCET_PROGRAM_ID, TokenFaucet, USDC_MINT, WSOL_MINT } from "dain-sdk";
import { createAssociatedTokenAccountInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { BN, Wallet } from "@coral-xyz/anchor";
import * as base58 from "bs58";

import { RPC_URL } from "../constants";
import * as keypair from "../../keypairs/user1.json";
import { input, number, select } from "@inquirer/prompts";
import { loadKeypair } from "../utils";

const payer = Keypair.fromSecretKey(Buffer.from(keypair));
const publicKey = payer.publicKey;

const connection = new Connection(RPC_URL);

(async () => {
    // Get airdrop from faucet
    const userIdx = await number({ message: 'Enter userIdx:' });
    const signer = loadKeypair(userIdx);
    console.log(`Wallet ${signer.publicKey.toBase58()} loaded`);

    const mint_ = await select({
        message: "Choose token",
        choices: [
            {
                name: "USDC",
                value: USDC_MINT.toBase58()
            },
            {
                name: "BTC",
                value: BTC_MINT.toBase58()
            },
            {
                name: "WSOL",
                value: WSOL_MINT.toBase58()
            },
        ]
    })
    const mint = new PublicKey(mint_);

    const amount_ = Number(await input({ message: "Enter faucet amount:" }));

    const faucet = new TokenFaucet(connection, new Wallet(payer), TOKEN_FAUCET_PROGRAM_ID, mint);

    const ata = getAssociatedTokenAddressSync(mint, publicKey);
    const ataInfo = await connection.getAccountInfo(ata, 'confirmed');

    var createIx;
    if (!ataInfo) {
        createIx = createAssociatedTokenAccountInstruction(publicKey, ata, publicKey, mint);
    }

    const amount = new BN(amount_ * 10 ** 6);
    const signature = await faucet.mintToUser(ata, amount, createIx);

    console.log(`faucet: ${signature}`);
})()