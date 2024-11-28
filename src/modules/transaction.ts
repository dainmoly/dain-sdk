import { ComputeBudgetProgram, Connection, PublicKey, SendOptions, SystemProgram, Transaction, TransactionExpiredBlockheightExceededError, TransactionInstruction } from "@solana/web3.js";
import promiseRetry from "promise-retry";
import { createAssociatedTokenAccountInstruction, createCloseAccountInstruction, createSyncNativeInstruction, getAccount, NATIVE_MINT } from "@solana/spl-token";
import BN from "bn.js";

import { TxSigAndSlot, Wallet } from "../types";
import { delay } from ".";

export const getWrapSolIxs = async (
  connection: Connection,
  authority: PublicKey,
  userTokenAccount: PublicKey,
  amount: BN,
) => {
  const wrapIxs = [];

  // Check if WSOL ata exists
  let wsolAtaExists = false;
  try {
    const wsolAta = await getAccount(connection, userTokenAccount, 'confirmed');
    if (wsolAta.owner.toBase58() == authority.toBase58()
      && wsolAta.mint.toBase58() == NATIVE_MINT.toBase58()) {
      wsolAtaExists = true;
    }
  } catch (ex) {
    // console.log(ex);
  }
  if (!wsolAtaExists) {
    wrapIxs.push(
      createAssociatedTokenAccountInstruction(authority, userTokenAccount, authority, NATIVE_MINT),
    );
  }

  // Create Wrapped SOL account
  wrapIxs.push(
    SystemProgram.transfer({
      fromPubkey: authority,
      toPubkey: userTokenAccount,
      lamports: amount.toNumber(),
    }),
    createSyncNativeInstruction(userTokenAccount),
  );

  const closeIx = createCloseAccountInstruction(userTokenAccount, authority, authority);

  return [wrapIxs, closeIx];
}

export const buildTransaction = async (
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
): Promise<TxSigAndSlot | null> => {
  const blockhashInfo = await connection.getLatestBlockhash(sendOptions.preflightCommitment);

  tx.feePayer = wallet.publicKey;
  tx.recentBlockhash = blockhashInfo.blockhash;
  const txBytes = (await wallet.signTransaction(tx)).serialize();

  const txSig = await connection.sendRawTransaction(txBytes, sendOptions);

  const controller = new AbortController();
  const abortSignal = controller.signal;

  const abortableResender = async () => {
    while (true) {
      await delay(1_000);
      if (abortSignal.aborted) return;
      try {
        await connection.sendRawTransaction(txBytes, sendOptions);
      } catch (e) {
        // console.warn(`Failed to resend transaction: ${e}`);
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
          signature: txSig,
          abortSignal,
        },
        "confirmed"
      ),
      new Promise(async (resolve) => {
        // in case ws socket died
        while (!abortSignal.aborted) {
          await delay(2);
          const tx = await connection.getSignatureStatus(txSig, {
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
      const response = await connection.getTransaction(txSig, {
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

  const slot = txResult.slot;

  return {
    txSig,
    slot
  };
};
