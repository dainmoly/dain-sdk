import { ConfirmOptions, SendOptions } from "@solana/web3.js";

export const CONFIRMATION_OPTS: ConfirmOptions = {
    preflightCommitment: 'confirmed',
    commitment: 'confirmed',
};

export const SEND_OPTS: SendOptions = {
    preflightCommitment: 'confirmed',
    maxRetries: 0,
    skipPreflight: false,
};