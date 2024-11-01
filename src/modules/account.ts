import { AccountMeta, PublicKey } from "@solana/web3.js";
import { getPerpMarketPublicKey, getSpotMarketPublicKey, getUserAccountPublicKey, getUserStatsAccountPublicKey } from "./pda";
import { isVariant, unifyArray } from "./utils";
import { PerpMarketAccount, SpotMarketAccount, UserAccount } from "@/types";

export const getRemainAccountsForPlaceOrder = (
  programId: PublicKey,
  orderer: UserAccount,
  market: PerpMarketAccount,
  users: UserAccount[],
  perpMarkets: PerpMarketAccount[],
  spotMarkets: SpotMarketAccount[],
) => {

  let remainingAccounts: AccountMeta[] = [];

  // Get open orders
  let spotIdxs: number[] = [
    market.quoteSpotMarketIndex,
  ];
  let perpIdxs: number[] = [
    market.marketIndex
  ];
  let makerPubkeys: string[] = [];

  // Add user collateral positions
  for (const position of orderer.spotPositions) {
    if (!position.scaledBalance.isZero()) {
      spotIdxs.push(position.marketIndex);
    }
  }
  for (const position of orderer.perpPositions) {
    if (!position.baseAssetAmount.isZero() || !position.quoteAssetAmount.isZero()) {
      perpIdxs.push(position.marketIndex);
    }
  }

  const orders = users.map(u => u.orders.
    filter(o => isVariant(o.marketType, "perp") && o.marketIndex == market.marketIndex && isVariant(o.status, "open"))
    .map(o => {
      return {
        ...o,
        authority: u.authority
      }
    })).flat();
  for (const order of orders) {
    const makerPubkey = order.authority ?? PublicKey.default;
    const maker = users.find(t => t.authority.equals(makerPubkey));
    if (maker) {
      makerPubkeys.push(makerPubkey.toBase58());

      for (const position of maker.spotPositions) {
        if (position.openOrders > 0) {
          spotIdxs.push(position.marketIndex);
        }
      }
      for (const position of maker.perpPositions) {
        if (position.openOrders > 0) {
          perpIdxs.push(position.marketIndex);
        }
      }
    }
  }

  perpIdxs = unifyArray(perpIdxs);
  spotIdxs = unifyArray(spotIdxs);
  makerPubkeys = unifyArray(makerPubkeys);

  // Oracle
  for (const idx of perpIdxs) {
    const market = perpMarkets.find(t => t.marketIndex == idx);
    if (market && !market.amm.oracle.equals(PublicKey.default)) {
      remainingAccounts.push({
        pubkey: market.amm.oracle,
        isSigner: false,
        isWritable: true,
      })
    }
  }
  for (const idx of spotIdxs) {
    const market = spotMarkets.find(t => t.marketIndex == idx);
    if (market && !market.oracle.equals(PublicKey.default)) {
      remainingAccounts.push({
        pubkey: market.oracle,
        isSigner: false,
        isWritable: true,
      })
    }
  }

  // Spot markets
  for (const idx of spotIdxs) {
    remainingAccounts.push({
      pubkey: getSpotMarketPublicKey(programId, idx),
      isSigner: false,
      isWritable: true,
    })
  }

  // Perp markets
  for (const idx of perpIdxs) {
    remainingAccounts.push({
      pubkey: getPerpMarketPublicKey(programId, idx),
      isSigner: false,
      isWritable: true,
    })
  }

  for (const maker of makerPubkeys) {
    remainingAccounts.push({
      pubkey: getUserAccountPublicKey(programId, new PublicKey(maker)),
      isWritable: true,
      isSigner: false,
    });
    remainingAccounts.push({
      pubkey: getUserStatsAccountPublicKey(programId, new PublicKey(maker)),
      isWritable: true,
      isSigner: false,
    });
  }

  return remainingAccounts;
}

export const getRemainAccounts = (
  programId: PublicKey,
  users: UserAccount[],
  perpMarkets: PerpMarketAccount[],
  spotMarkets: SpotMarketAccount[],
) => {

  let remainingAccounts: AccountMeta[] = [];

  // Get open orders
  let spotIdxs: number[] = spotMarkets.map(t => t.marketIndex);
  let perpIdxs: number[] = perpMarkets.map(t => t.marketIndex);
  let makerPubkeys: string[] = users.map(t => t.authority.toBase58());

  perpIdxs = unifyArray(perpIdxs);
  spotIdxs = unifyArray(spotIdxs);
  makerPubkeys = unifyArray(makerPubkeys);

  // Oracle
  for (const idx of perpIdxs) {
    const market = perpMarkets.find(t => t.marketIndex == idx);
    if (market && !market.amm.oracle.equals(PublicKey.default)) {
      remainingAccounts.push({
        pubkey: market.amm.oracle,
        isSigner: false,
        isWritable: true,
      })
    }
  }
  for (const idx of spotIdxs) {
    const market = spotMarkets.find(t => t.marketIndex == idx);
    if (market && !market.oracle.equals(PublicKey.default)) {
      remainingAccounts.push({
        pubkey: market.oracle,
        isSigner: false,
        isWritable: true,
      })
    }
  }

  // Spot markets
  for (const idx of spotIdxs) {
    remainingAccounts.push({
      pubkey: getSpotMarketPublicKey(programId, idx),
      isSigner: false,
      isWritable: true,
    })
  }

  // Perp markets
  for (const idx of perpIdxs) {
    remainingAccounts.push({
      pubkey: getPerpMarketPublicKey(programId, idx),
      isSigner: false,
      isWritable: true,
    })
  }

  for (const maker of makerPubkeys) {
    remainingAccounts.push({
      pubkey: getUserAccountPublicKey(programId, new PublicKey(maker)),
      isWritable: true,
      isSigner: false,
    });
    remainingAccounts.push({
      pubkey: getUserStatsAccountPublicKey(programId, new PublicKey(maker)),
      isWritable: true,
      isSigner: false,
    });
  }

  return remainingAccounts;
}