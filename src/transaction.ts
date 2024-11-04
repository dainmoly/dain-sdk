import { BlockhashWithExpiryBlockHeight, ComputeBudgetProgram, Connection, SendOptions, Transaction, TransactionExpiredBlockheightExceededError, TransactionInstruction } from "@solana/web3.js";
import promiseRetry from "promise-retry";
import { delay } from "./modules";
import { Wallet } from "./types";

export const buildTransaction = async (
  connection: Connection,
  ixs: TransactionInstruction[],
): Promise<Transaction | null> => {
  const tx = new Transaction();
  tx.instructions = [
    ComputeBudgetProgram.setComputeUnitLimit({
      units: 1_000_000
    }),
    ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: 1_000
    }),
    ...ixs
  ];

  return tx;
}

export const executeTransaction = async (
  connection: Connection,
  tx: Transaction,
  wallet: Wallet,
  sendOptions: SendOptions,
): Promise<string | null> => {
  const blockhashInfo = await connection.getLatestBlockhash(sendOptions.preflightCommitment);

  tx.feePayer = wallet.publicKey;
  tx.recentBlockhash = blockhashInfo.blockhash;
  const txBytes = (await wallet.signTransaction(tx)).serialize();

  const txid = await connection.sendRawTransaction(txBytes, sendOptions);

  const controller = new AbortController();
  const abortSignal = controller.signal;

  const abortableResender = async () => {
    while (true) {
      await delay(1_000);
      if (abortSignal.aborted) return;
      try {
        await connection.sendRawTransaction(txBytes, sendOptions);
      } catch (e) {
        console.warn(`Failed to resend transaction: ${e}`);
      }
    }
  };

  try {
    abortableResender();
    const lastValidBlockHeight = blockhashInfo.lastValidBlockHeight - 100;

    // this would throw TransactionExpiredBlockheightExceededError
    await Promise.race([
      connection.confirmTransaction(
        {
          ...blockhashInfo,
          lastValidBlockHeight,
          signature: txid,
          abortSignal,
        },
        "confirmed"
      ),
      new Promise(async (resolve) => {
        // in case ws socket died
        while (!abortSignal.aborted) {
          await delay(2);
          const tx = await connection.getSignatureStatus(txid, {
            searchTransactionHistory: false,
          });
          if (tx?.value?.confirmationStatus === "confirmed") {
            resolve(tx);
          }
        }
      }),
    ]);
  } catch (e) {
    if (e instanceof TransactionExpiredBlockheightExceededError) {
      // we consume this error and getTransaction would return null
      return null;
    } else {
      // invalid state from web3.js
      throw e;
    }
  } finally {
    controller.abort();
  }

  // in case rpc is not synced yet, we add some retries
  const txResult = await promiseRetry(
    async (retry) => {
      const response = await connection.getTransaction(txid, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
      if (!response) {
        retry(response);
      }
      return response;
    },
    {
      retries: 5,
      minTimeout: 1e3,
    }
  );

  if (!txResult || txResult.meta?.err) {
    return null;
  }

  return txid;
};
