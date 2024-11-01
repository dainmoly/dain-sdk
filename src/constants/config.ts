import { ConfirmOptions } from "@solana/web3.js";

export const CONFIRMATION_OPTS: ConfirmOptions = {
    preflightCommitment: 'confirmed',
    commitment: 'confirmed',
};