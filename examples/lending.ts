import {
  BN,
  DainClient,
  IWallet,
  PublicKey,
  SpotMarketAccount,
  WRAPPED_SOL_MINT,
} from "../src";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Transaction, TransactionInstruction } from "@solana/web3.js";

export const getWallet = (authority: PublicKey): IWallet => {
  return {
    publicKey: authority,
    signAllTransactions: async (txs: Transaction[]) => {
      return txs;
    },
    signTransaction: async (tx: Transaction) => {
      return tx;
    },
  };
};

export const initialize = async (
  client: DainClient,
  subIdx: number = 0,
  name?: string
) => {
  const ixs: TransactionInstruction[] = [];
  const [userAccount, initUserIx] = await client.getInitializeUserInstructions(
    subIdx
    // name
  );

  if (subIdx == 0) {
    const initUserStatsIx = await client.getInitializeUserStatsIx();
    ixs.push(initUserStatsIx);
  }

  ixs.push(initUserIx);

  return ixs;
};

export const deposit = async (
  client: DainClient,
  user: PublicKey,
  marketIndex: number,
  amount: number
) => {
  const market = client.getSpotMarketAccount(marketIndex) as SpotMarketAccount;

  const mint = market.mint;
  const userTokenAccount = getAssociatedTokenAddressSync(mint, user);

  const amountBN = new BN(amount * 10 ** market.decimals);

  const ix = await client.getDepositInstruction(
    amountBN,
    marketIndex,
    mint.equals(WRAPPED_SOL_MINT) ? user : userTokenAccount
  );
  return ix;
};

export const withdraw = async (
  client: DainClient,
  user: PublicKey,
  marketIndex: number,
  amount: number
) => {
  const market = client.getSpotMarketAccount(marketIndex) as SpotMarketAccount;

  const mint = market.mint;
  const userTokenAccount = getAssociatedTokenAddressSync(mint, user);

  const amountBN = new BN(amount * 10 ** market.decimals);

  const ixs = await client.getWithdrawalIxs(
    amountBN,
    marketIndex,
    mint.equals(WRAPPED_SOL_MINT) ? user : userTokenAccount
  );
  return ixs;
};
