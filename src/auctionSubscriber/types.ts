import { DainClient } from "../dainClient";
import { UserAccount } from "../types";
import { ConfirmOptions, PublicKey } from "@solana/web3.js";

export type AuctionSubscriberConfig = {
  dainClient: DainClient;
  opts?: ConfirmOptions;
  resubTimeoutMs?: number;
  logResubMessages?: boolean;
};

export interface AuctionSubscriberEvents {
  onAccountUpdate: (
    account: UserAccount,
    pubkey: PublicKey,
    slot: number
  ) => void;
}
