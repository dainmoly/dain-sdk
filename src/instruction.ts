import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, TransactionInstruction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import BN from "bn.js";

import { DainClient } from "./client";
import { encodeName, getInsuranceFundVaultPublicKey, getOrderParams, getPerpMarketPublicKey, getSpotMarketPublicKey, getSpotMarketVaultPublicKey, getUserAccountPublicKey } from "./modules";
import { BASE_PRECISION, DEFAULT_MARKET_NAME, DEFAULT_USER_NAME, ONE, PEG_PRECISION, PRICE_PRECISION, QUOTE_SPOT_MARKET_INDEX, SPOT_MARKET_RATE_PRECISION, SPOT_MARKET_WEIGHT_PRECISION, ZERO } from "./constants";
import { AssetTier, ContractTier, MakerInfo, MarketType, OptionalOrderParams, OracleSource, OrderParams, PlaceAndTakeOrderSuccessCondition, TakerInfo } from "./types";

export async function getInitializeIx(
  client: DainClient,
  quoteAssetMint: PublicKey
): Promise<TransactionInstruction> {
  const initializeIx = await client.program.methods.initialize()
    .accounts({
      admin: client.state?.admin,
      state: client.getStatePublicKey(),
      quoteAssetMint,
      rent: SYSVAR_RENT_PUBKEY,
      driftSigner: client.getSignerPublicKey(),
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();

  return initializeIx;
}


export async function getInitializePerpMarketIx(
  client: DainClient,
  marketIndex: number,
  priceOracle: PublicKey,
  oracleSource: OracleSource = OracleSource.PYTH,
  baseAssetReserve: BN,
  quoteAssetReserve: BN,
  periodicity: BN,
  pegMultiplier: BN = PEG_PRECISION,
  contractTier: ContractTier = ContractTier.SPECULATIVE,
  marginRatioInitial = 2000,
  marginRatioMaintenance = 500,
  liquidatorFee = 0,
  ifLiquidatorFee = 10000,
  imfFactor = 0,
  activeStatus = true,
  baseSpread = 0,
  maxSpread = 142500,
  maxOpenInterest = ZERO,
  maxRevenueWithdrawPerPeriod = ZERO,
  quoteMaxInsurance = ZERO,
  orderStepSize = BASE_PRECISION.divn(10000),
  orderTickSize = PRICE_PRECISION.divn(100000),
  minOrderSize = BASE_PRECISION.divn(10000),
  concentrationCoefScale = ONE,
  curveUpdateIntensity = 0,
  ammJitIntensity = 0,
  name = DEFAULT_MARKET_NAME
): Promise<TransactionInstruction> {
  const nameBuffer = encodeName(name);
  const perpMarket = getPerpMarketPublicKey(client.programId, marketIndex);

  return await client.program.methods.initializePerpMarket(
    marketIndex,
    baseAssetReserve,
    quoteAssetReserve,
    periodicity,
    pegMultiplier,
    oracleSource as any,
    contractTier as any,
    marginRatioInitial,
    marginRatioMaintenance,
    liquidatorFee,
    ifLiquidatorFee,
    imfFactor,
    activeStatus,
    baseSpread,
    maxSpread,
    maxOpenInterest,
    maxRevenueWithdrawPerPeriod,
    quoteMaxInsurance,
    orderStepSize,
    orderTickSize,
    minOrderSize,
    concentrationCoefScale,
    curveUpdateIntensity,
    ammJitIntensity,
    nameBuffer,
  )
    .accounts({
      state: client.getStatePublicKey(),
      admin: client.state?.admin,
      oracle: priceOracle,
      perpMarket,
      rent: SYSVAR_RENT_PUBKEY,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
}


export async function getInitializeSpotMarketIx(
  client: DainClient,
  marketIndex: number,
  mint: PublicKey,
  oracle: PublicKey,
  oracleSource: OracleSource,
  optimalUtilization: number = Number(SPOT_MARKET_RATE_PRECISION.divn(2)),
  optimalRate: number = Number(SPOT_MARKET_RATE_PRECISION),
  maxRate: number = Number(SPOT_MARKET_RATE_PRECISION),
  initialAssetWeight: number = Number(SPOT_MARKET_WEIGHT_PRECISION),
  maintenanceAssetWeight: number = Number(SPOT_MARKET_WEIGHT_PRECISION),
  initialLiabilityWeight: number = Number(SPOT_MARKET_WEIGHT_PRECISION),
  maintenanceLiabilityWeight: number = Number(SPOT_MARKET_WEIGHT_PRECISION),
  imfFactor = 0,
  liquidatorFee = 0,
  ifLiquidationFee = 0,
  activeStatus = true,
  assetTier = AssetTier.COLLATERAL,
  scaleInitialAssetWeightStart = ZERO,
  withdrawGuardThreshold = ZERO,
  orderTickSize = ONE,
  orderStepSize = ONE,
  ifTotalFactor = 0,
  name = DEFAULT_MARKET_NAME,
): Promise<TransactionInstruction> {
  const nameBuffer = encodeName(name);
  const spotMarket = getSpotMarketPublicKey(client.programId, marketIndex);
  const spotMarketVault = getSpotMarketVaultPublicKey(client.programId, marketIndex);
  const insuranceFundVault = getInsuranceFundVaultPublicKey(client.programId, marketIndex);

  const tokenProgramAccount = await client.connection.getAccountInfo(mint);
  if (!tokenProgramAccount) {
    throw new Error("Invalid mint");
  }
  const tokenProgram = tokenProgramAccount.owner;

  return await client.program.methods.initializeSpotMarket(
    optimalUtilization,
    optimalRate,
    maxRate,
    oracleSource as any,
    initialAssetWeight,
    maintenanceAssetWeight,
    initialLiabilityWeight,
    maintenanceLiabilityWeight,
    imfFactor,
    liquidatorFee,
    ifLiquidationFee,
    activeStatus,
    assetTier,
    scaleInitialAssetWeightStart,
    withdrawGuardThreshold,
    orderTickSize,
    orderStepSize,
    ifTotalFactor,
    nameBuffer,
  )
    .accounts({
      state: client.getStatePublicKey(),
      admin: client.state?.admin,
      oracle,
      spotMarket,
      spotMarketMint: mint,
      spotMarketVault,
      insuranceFundVault,
      driftSigner: client.getSignerPublicKey(),
      rent: SYSVAR_RENT_PUBKEY,
      systemProgram: SystemProgram.programId,
      tokenProgram,
    })
    .instruction();
}

export async function getSettleExpiredMarketIx(
  client: DainClient,
  marketIndex: number
): Promise<TransactionInstruction> {
  // const remainingAccounts = client.getRemainingAccounts({
  //   userAccounts: [],
  //   writablePerpMarketIndexes: [marketIndex],
  //   writableSpotMarketIndexes: [QUOTE_SPOT_MARKET_INDEX],
  // });
  const perpMarketPublicKey = getPerpMarketPublicKey(client.programId, marketIndex);

  return await client.program.methods.settleExpiredMarket(marketIndex)
    .accounts({
      state: await client.getStatePublicKey(),
      admin: client.state?.admin,
      perpMarket: perpMarketPublicKey,
    })
    // .remainingAccounts(remainingAccounts)
    .instruction();
}

export async function getInitializeUserStateIx(
  client: DainClient,
): Promise<TransactionInstruction> {
  return await client.program.methods.initializeUserStats()
    .accounts({
      userStats: client.getUserStatsPublicKey(),
      state: client.getStatePublicKey(),
      authority: client.authority,
      payer: client.payer,
      rent: SYSVAR_RENT_PUBKEY,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
}

export async function getInitializeUserIx(
  client: DainClient,
  subAccountId: number,
  name?: string
): Promise<[PublicKey, TransactionInstruction]> {
  if (name === undefined) {
    if (subAccountId === 0) {
      name = DEFAULT_USER_NAME;
    } else {
      name = `Subaccount ${subAccountId + 1}`;
    }
  }

  const nameBuffer = encodeName(name);
  const userPda = getUserAccountPublicKey(client.programId, client.authority, subAccountId);

  const ix = await client.program.methods.initializeUser(
    subAccountId,
    nameBuffer
  )
    .accounts({
      state: client.getStatePublicKey(),
      user: userPda,
      userStats: client.getUserStatsPublicKey(),
      authority: client.authority,
      payer: client.payer,
      rent: SYSVAR_RENT_PUBKEY,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  return [userPda, ix];
}

export async function getDepositIx(
  client: DainClient,
  marketIndex: number,
  amount: BN,
  reduceOnly = false,
  subAccountId = 0,
  userTokenAccount?: PublicKey,
): Promise<TransactionInstruction> {
  const userPda = getUserAccountPublicKey(client.programId, client.authority, subAccountId);
  const spotMarketVault = getSpotMarketVaultPublicKey(client.programId, marketIndex);

  let remainingAccounts = [];
  const userAccounts = [client.getUser(subAccountId).userAccount];
  remainingAccounts = client.getRemainingAccounts({
    userAccounts,
    useMarketLastSlotCache: true,
    writableSpotMarketIndexes: [marketIndex],
  });

  return await client.program.methods.deposit(
    marketIndex,
    amount,
    reduceOnly,
  )
    .accounts({
      state: client.getStatePublicKey(),
      spotMarketVault,
      user: userPda,
      userStats: client.getUserStatsPublicKey(),
      userTokenAccount,
      authority: client.authority,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .remainingAccounts(remainingAccounts)
    .instruction();
}

export async function getWithdrawIx(
  client: DainClient,
  marketIndex: number,
  amount: BN,
  reduceOnly = false,
  subAccountId = 0,
  userTokenAccount?: PublicKey,
): Promise<TransactionInstruction> {
  const userPda = getUserAccountPublicKey(client.programId, client.authority, subAccountId);
  const spotMarketVault = getSpotMarketVaultPublicKey(client.programId, marketIndex);

  let remainingAccounts = [];
  const userAccounts = [client.getUser(subAccountId).userAccount];
  remainingAccounts = client.getRemainingAccounts({
    userAccounts,
    useMarketLastSlotCache: true,
    writableSpotMarketIndexes: [marketIndex],
  });

  return await client.program.methods.withdraw(
    marketIndex,
    amount,
    reduceOnly,
  )
    .accounts({
      state: client.getStatePublicKey(),
      spotMarketVault,
      driftSigner: client.getSignerPublicKey(),
      user: userPda,
      userStats: client.getUserStatsPublicKey(),
      userTokenAccount,
      authority: client.authority,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .remainingAccounts(remainingAccounts)
    .instruction();
}

export async function getPlaceAndTakePerpOrderIx(
  client: DainClient,
  orderParams: OptionalOrderParams,
  makerInfo?: MakerInfo | MakerInfo[],
  successCondition?: PlaceAndTakeOrderSuccessCondition,
  subAccountId = 0,
): Promise<TransactionInstruction> {
  orderParams = getOrderParams(orderParams, { marketType: MarketType.PERP });
  const userPda = getUserAccountPublicKey(client.programId, client.authority, subAccountId);

  makerInfo = Array.isArray(makerInfo)
    ? makerInfo
    : makerInfo
      ? [makerInfo]
      : [];

  const userAccounts = [client.getUser(subAccountId).userAccount];
  for (const maker of makerInfo) {
    userAccounts.push(maker.makerUserAccount);
  }

  const remainingAccounts = client.getRemainingAccounts({
    userAccounts,
    useMarketLastSlotCache: true,
    writablePerpMarketIndexes: [orderParams.marketIndex],
  });

  for (const maker of makerInfo) {
    remainingAccounts.push({
      pubkey: maker.maker,
      isWritable: true,
      isSigner: false,
    });
    remainingAccounts.push({
      pubkey: maker.makerStats,
      isWritable: true,
      isSigner: false,
    });
  }

  return await client.program.methods.placeAndTakePerpOrder(
    orderParams as any,
    successCondition ?? null,
  )
    .accounts({
      state: client.getStatePublicKey(),
      user: userPda,
      userStats: client.getUserStatsPublicKey(),
      authority: client.authority,
    })
    .remainingAccounts(remainingAccounts)
    .instruction();
}


export async function getPlaceAndTakeSpotOrderIx(
  client: DainClient,
  orderParams: OptionalOrderParams,
  makerInfo?: MakerInfo,
  subAccountId = 0,
): Promise<TransactionInstruction> {
  orderParams = getOrderParams(orderParams, { marketType: MarketType.PERP });
  const userPda = getUserAccountPublicKey(client.programId, client.authority, subAccountId);

  const userAccounts = [client.getUser(subAccountId).userAccount];
  if (makerInfo !== undefined) {
    userAccounts.push(makerInfo.makerUserAccount);
  }

  const remainingAccounts = client.getRemainingAccounts({
    userAccounts,
    useMarketLastSlotCache: true,
    writableSpotMarketIndexes: [
      orderParams.marketIndex,
      QUOTE_SPOT_MARKET_INDEX,
    ],
  });

  let makerOrderId = null;
  if (makerInfo && makerInfo.order) {
    makerOrderId = makerInfo.order.orderId;
    remainingAccounts.push({
      pubkey: makerInfo.maker,
      isSigner: false,
      isWritable: true,
    });
    remainingAccounts.push({
      pubkey: makerInfo.makerStats,
      isSigner: false,
      isWritable: true,
    });
  }

  return await client.program.methods.placeAndTakeSpotOrder(
    orderParams as any,
    null,
    makerOrderId,
  )
    .accounts({
      state: client.getStatePublicKey(),
      user: userPda,
      userStats: client.getUserStatsPublicKey(),
      authority: client.authority,
    })
    .remainingAccounts(remainingAccounts)
    .instruction();
}

export async function getPlaceAndMakePerpOrderIx(
  client: DainClient,
  orderParams: OrderParams,
  takerInfo: TakerInfo,
  subAccountId = 0,
): Promise<TransactionInstruction> {
  const userPda = getUserAccountPublicKey(client.programId, client.authority, subAccountId);

  const userAccounts = [client.getUser(subAccountId).userAccount];
  if (takerInfo !== undefined) {
    userAccounts.push(takerInfo.takerUserAccount);
  }

  const remainingAccounts = client.getRemainingAccounts({
    userAccounts,
    useMarketLastSlotCache: true,
    writablePerpMarketIndexes: [orderParams.marketIndex],
  });

  const takerOrderId = takerInfo.order.orderId;
  return await client.program.methods.placeAndMakePerpOrder(
    orderParams as any,
    takerOrderId,
  )
    .accounts({
      state: client.getStatePublicKey(),
      user: userPda,
      userStats: client.getUserStatsPublicKey(),
      taker: takerInfo.taker,
      takerStats: takerInfo.takerStats,
      authority: client.authority,
    })
    .remainingAccounts(remainingAccounts)
    .instruction();
}

export async function getPlaceAndMakeSpotOrderIx(
  client: DainClient,
  orderParams: OptionalOrderParams,
  takerInfo: TakerInfo,
  subAccountId = 0,
): Promise<TransactionInstruction> {
  orderParams = getOrderParams(orderParams, { marketType: MarketType.SPOT });
  const userPda = getUserAccountPublicKey(client.programId, client.authority, subAccountId);

  const userAccounts = [client.getUser(subAccountId).userAccount];
  userAccounts.push(takerInfo.takerUserAccount);

  const remainingAccounts = client.getRemainingAccounts({
    userAccounts,
    useMarketLastSlotCache: true,
    writableSpotMarketIndexes: [
      orderParams.marketIndex,
      QUOTE_SPOT_MARKET_INDEX,
    ],
  });

  const takerOrderId = takerInfo.order.orderId;
  return await client.program.methods.placeAndMakeSpotOrder(
    orderParams as any,
    takerOrderId,
    null,
  )
    .accounts({
      state: client.getStatePublicKey(),
      user: userPda,
      userStats: client.getUserStatsPublicKey(),
      taker: takerInfo.taker,
      takerStats: takerInfo.takerStats,
      authority: client.authority,
    })
    .remainingAccounts(remainingAccounts)
    .instruction();
}

export async function getCancelOrderIx(
  client: DainClient,
  orderId?: number,
  subAccountId = 0,
): Promise<TransactionInstruction> {
  const userPda = getUserAccountPublicKey(client.programId, client.authority, subAccountId);

  const userAccounts = [client.getUser(subAccountId).userAccount];
  const remainingAccounts = client.getRemainingAccounts({
    userAccounts,
    useMarketLastSlotCache: true,
  });

  return await client.program.methods.cancelOrder(
    orderId ?? null
  )
    .accounts({
      state: client.getStatePublicKey(),
      user: userPda,
      authority: client.authority,
    })
    .remainingAccounts(remainingAccounts)
    .instruction();
}

export async function getSettlePnlIx(
  client: DainClient,
  marketIndex: number,
  subAccountId = 0,
): Promise<TransactionInstruction> {
  const userPda = getUserAccountPublicKey(client.programId, client.authority, subAccountId);
  const spotMarketVault = getSpotMarketVaultPublicKey(client.programId, marketIndex);

  const userAccounts = [client.getUser(subAccountId).userAccount];
  const remainingAccounts = client.getRemainingAccounts({
    userAccounts,
    writablePerpMarketIndexes: [marketIndex],
    writableSpotMarketIndexes: [QUOTE_SPOT_MARKET_INDEX],
  });

  return await client.program.methods.settlePnl(marketIndex)
    .accounts({
      state: client.getStatePublicKey(),
      user: userPda,
      spotMarketVault,
      authority: client.authority,
    })
    .remainingAccounts(remainingAccounts)
    .instruction();
}