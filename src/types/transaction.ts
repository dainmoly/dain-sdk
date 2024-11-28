import { Drift } from "../idls/drift";
import { Program } from "@coral-xyz/anchor";
import { SignerWalletAdapter } from "@solana/wallet-adapter-base";
import { PublicKey, TransactionSignature } from "@solana/web3.js";
import { UserAccount } from "./account";

export type DainProgram = Program<Drift>;


export type RemainingAccountParams = {
    userAccounts: UserAccount[];
    writablePerpMarketIndexes?: number[];
    writableSpotMarketIndexes?: number[];
    readablePerpMarketIndex?: number | number[];
    readableSpotMarketIndexes?: number[];
    useMarketLastSlotCache?: boolean;
};


export type TxSigAndSlot = {
    txSig: TransactionSignature;
    slot: number;
};


export type Wallet = Pick<SignerWalletAdapter, "signAllTransactions" | "signTransaction"> & {
    publicKey: PublicKey;
    signMessage?: (message: Uint8Array) => Promise<Uint8Array>;
};
