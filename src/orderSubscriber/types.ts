import { Commitment, PublicKey } from "@solana/web3.js";
import { Order, UserAccount } from "../types";
import { DainClient } from "../dainClient";

export type OrderSubscriberConfig = {
  dainClient: DainClient;
  subscriptionConfig:
    | {
        type: "polling";
        frequency: number;
        commitment?: Commitment;
      }
    | {
        type: "websocket";
        skipInitialLoad?: boolean;
        resubTimeoutMs?: number;
        logResubMessages?: boolean;
        resyncIntervalMs?: number;
        commitment?: Commitment;
      };
  fastDecode?: boolean;
  decodeData?: boolean;
};

export interface OrderSubscriberEvents {
  orderCreated: (
    account: UserAccount,
    updatedOrders: Order[],
    pubkey: PublicKey,
    slot: number,
    dataType: "raw" | "decoded" | "buffer"
  ) => void;
  userUpdated: (
    account: UserAccount,
    pubkey: PublicKey,
    slot: number,
    dataType: "raw" | "decoded" | "buffer"
  ) => void;
  updateReceived: (
    pubkey: PublicKey,
    slot: number,
    dataType: "raw" | "decoded" | "buffer"
  ) => void;
}
