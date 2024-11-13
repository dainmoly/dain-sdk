import { Keypair, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import { Wallet } from "../types";

/**
 * NodeWallet
 *
 * Anchor-compliant wallet implementation.
 */
export class NodeWallet implements Wallet {
  /**
   * @param payer Keypair of the associated payer
   */
  constructor(readonly payer: Keypair) { }

  async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
    if ("version" in tx) {
      tx.sign([this.payer]);
    } else {
      tx.partialSign(this.payer);
    }
    return tx;
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> {
    return txs.map((tx) => {
      if ("version" in tx) {
        tx.sign([this.payer]);
        return tx;
      } else {
        tx.partialSign(this.payer);
        return tx;
      }
    });
  }

  get publicKey(): PublicKey {
    return this.payer.publicKey;
  }
}