import { Drift } from "@/idls/drift";
import { Program } from "@coral-xyz/anchor";
import { SignerWalletAdapter } from "@solana/wallet-adapter-base";
import { PublicKey } from "@solana/web3.js";

export type DainProgram = Program<Drift>;

export type Wallet = Pick<SignerWalletAdapter, "signAllTransactions" | "signTransaction"> & {
    publicKey: PublicKey;
    signMessage?: (message: Uint8Array) => Promise<Uint8Array>;
};
