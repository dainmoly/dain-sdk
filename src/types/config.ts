import { ConfirmOptions, PublicKey, SendOptions } from "@solana/web3.js";

export type DainConfig = {
    programId?: PublicKey;
    sendOpts?: SendOptions;
    confirmOpts?: ConfirmOptions;
    activeSubAccountId?: number;
};