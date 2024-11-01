import { PublicKey, SendOptions } from "@solana/web3.js";

export type DainConfig = {
    programId?: PublicKey;
    opts?: SendOptions;
};
