import {
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  TransactionInstruction,
  TransactionSignature,
} from "@solana/web3.js";
import {
  FeeStructure,
  OracleGuardRails,
  OracleSource,
  ExchangeStatus,
  MarketStatus,
  ContractTier,
  AssetTier,
  SpotFulfillmentConfigStatus,
} from "./types";
import { DEFAULT_MARKET_NAME, encodeName } from "./userName";
import { BN } from "@coral-xyz/anchor";
import * as anchor from "@coral-xyz/anchor";
import {
  getDriftStateAccountPublicKeyAndNonce,
  getSpotMarketPublicKey,
  getSpotMarketVaultPublicKey,
  getPerpMarketPublicKey,
  getInsuranceFundVaultPublicKey,
  getSerumOpenOrdersPublicKey,
  getSerumFulfillmentConfigPublicKey,
  getPhoenixFulfillmentConfigPublicKey,
  getProtocolIfSharesTransferConfigPublicKey,
  getPrelaunchOraclePublicKey,
  getOpenbookV2FulfillmentConfigPublicKey,
  getPythPullOraclePublicKey,
  getUserStatsAccountPublicKey,
  getHighLeverageModeConfigPublicKey,
} from "./addresses/pda";
import { squareRootBN } from "./math/utils";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { DainClient } from "./dainClient";
import {
  PEG_PRECISION,
  QUOTE_SPOT_MARKET_INDEX,
  ZERO,
  ONE,
  BASE_PRECISION,
  PRICE_PRECISION,
  SPOT_MARKET_RATE_PRECISION,
  SPOT_MARKET_WEIGHT_PRECISION,
} from "./constants/numericConstants";
import { calculateTargetPriceTrade } from "./math/trade";
import { calculateAmmReservesAfterSwap, getSwapDirection } from "./math/amm";
import { PROGRAM_ID as PHOENIX_PROGRAM_ID } from "@ellipsis-labs/phoenix-sdk";
import { DRIFT_ORACLE_RECEIVER_ID } from "./config";
import { getFeedIdUint8Array } from "./util/pythPullOracleUtils";

const OPENBOOK_PROGRAM_ID = new PublicKey(
  "opnb2LAfJYbRMAHHvqjCwQxanZn7ReEHp1k81EohpZb"
);

export class AdminClient extends DainClient {
  public async initialize(
    usdcMint: PublicKey,
    _adminControlsPrices: boolean
  ): Promise<[TransactionSignature]> {
    const stateAccountRPCResponse = await this.connection.getParsedAccountInfo(
      await this.getStatePublicKey()
    );
    if (stateAccountRPCResponse.value !== null) {
      throw new Error("Clearing house already initialized");
    }

    const [driftStatePublicKey] = await getDriftStateAccountPublicKeyAndNonce(
      this.program.programId
    );

    const initializeIx = await this.program.methods
      .initialize({
        accounts: {
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          state: driftStatePublicKey,
          quoteAssetMint: usdcMint,
          rent: SYSVAR_RENT_PUBKEY,
          driftSigner: this.getSignerPublicKey(),
          systemProgram: anchor.web3.SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        },
      })
      .instruction();

    const tx = await this.buildTransaction(initializeIx);

    const { txSig } = await super.sendTransaction(tx, [], this.opts);

    return [txSig];
  }

  public async initializeSpotMarket(
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
    marketIndex?: number
  ): Promise<TransactionSignature> {
    const spotMarketIndex =
      marketIndex ?? this.getStateAccount().numberOfSpotMarkets;

    const initializeIx = await this.getInitializeSpotMarketIx(
      mint,
      oracle,
      oracleSource,
      optimalUtilization,
      optimalRate,
      maxRate,
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
      name,
      marketIndex
    );

    const tx = await this.buildTransaction(initializeIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    await this.accountSubscriber.addSpotMarket(spotMarketIndex);
    await this.accountSubscriber.addOracle({
      source: oracleSource,
      publicKey: oracle,
    });
    await this.accountSubscriber.setSpotOracleMap();

    return txSig;
  }

  public async getInitializeSpotMarketIx(
    mint: PublicKey,
    oracle: PublicKey,
    oracleSource: OracleSource,
    optimalUtilization: number,
    optimalRate: number,
    maxRate: number,
    initialAssetWeight: number,
    maintenanceAssetWeight: number,
    initialLiabilityWeight: number,
    maintenanceLiabilityWeight: number,
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
    marketIndex?: number
  ): Promise<TransactionInstruction> {
    const spotMarketIndex =
      marketIndex ?? this.getStateAccount().numberOfSpotMarkets;
    const spotMarket = await getSpotMarketPublicKey(
      this.program.programId,
      spotMarketIndex
    );

    const spotMarketVault = await getSpotMarketVaultPublicKey(
      this.program.programId,
      spotMarketIndex
    );

    const insuranceFundVault = await getInsuranceFundVaultPublicKey(
      this.program.programId,
      spotMarketIndex
    );

    const tokenProgram = (await this.connection.getAccountInfo(mint)).owner;

    const nameBuffer = encodeName(name);
    const initializeIx = await this.program.methods
      .initializeSpotMarket(
        optimalUtilization,
        optimalRate,
        maxRate,
        oracleSource,
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
        nameBuffer
      )
      .accounts({
        admin: this.isSubscribed
          ? this.getStateAccount().admin
          : this.wallet.publicKey,
        state: await this.getStatePublicKey(),
        spotMarket,
        spotMarketVault,
        insuranceFundVault,
        driftSigner: this.getSignerPublicKey(),
        spotMarketMint: mint,
        oracle,
        rent: SYSVAR_RENT_PUBKEY,
        systemProgram: anchor.web3.SystemProgram.programId,
        tokenProgram,
      })
      .instruction();

    return initializeIx;
  }

  public async deleteInitializedSpotMarket(
    marketIndex: number
  ): Promise<TransactionSignature> {
    const deleteInitializeMarketIx =
      await this.getDeleteInitializedSpotMarketIx(marketIndex);

    const tx = await this.buildTransaction(deleteInitializeMarketIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getDeleteInitializedSpotMarketIx(
    marketIndex: number
  ): Promise<TransactionInstruction> {
    const spotMarketPublicKey = await getSpotMarketPublicKey(
      this.program.programId,
      marketIndex
    );

    const spotMarketVaultPublicKey = await getSpotMarketVaultPublicKey(
      this.program.programId,
      marketIndex
    );

    const insuranceFundVaultPublicKey = await getInsuranceFundVaultPublicKey(
      this.program.programId,
      marketIndex
    );

    return await this.program.methods
      .deleteInitializedSpotMarket(marketIndex, {
        accounts: {
          state: await this.getStatePublicKey(),
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          spotMarket: spotMarketPublicKey,
          spotMarketVault: spotMarketVaultPublicKey,
          insuranceFundVault: insuranceFundVaultPublicKey,
          driftSigner: this.getSignerPublicKey(),
          tokenProgram: TOKEN_PROGRAM_ID,
        },
      })
      .instruction();
  }

  public async initializeSerumFulfillmentConfig(
    marketIndex: number,
    serumMarket: PublicKey,
    serumProgram: PublicKey
  ): Promise<TransactionSignature> {
    const initializeIx = await this.getInitializeSerumFulfillmentConfigIx(
      marketIndex,
      serumMarket,
      serumProgram
    );

    const tx = await this.buildTransaction(initializeIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getInitializeSerumFulfillmentConfigIx(
    marketIndex: number,
    serumMarket: PublicKey,
    serumProgram: PublicKey
  ): Promise<TransactionInstruction> {
    const serumOpenOrders = getSerumOpenOrdersPublicKey(
      this.program.programId,
      serumMarket
    );

    const serumFulfillmentConfig = getSerumFulfillmentConfigPublicKey(
      this.program.programId,
      serumMarket
    );

    return await this.program.methods
      .initializeSerumFulfillmentConfig(marketIndex)
      .accounts({
        admin: this.isSubscribed
          ? this.getStateAccount().admin
          : this.wallet.publicKey,
        state: await this.getStatePublicKey(),
        baseSpotMarket: this.getSpotMarketAccount(marketIndex).pubkey,
        quoteSpotMarket: this.getQuoteSpotMarketAccount().pubkey,
        driftSigner: this.getSignerPublicKey(),
        serumProgram,
        serumMarket,
        serumOpenOrders,
        rent: SYSVAR_RENT_PUBKEY,
        systemProgram: anchor.web3.SystemProgram.programId,
        serumFulfillmentConfig,
      })
      .instruction();
  }

  public async initializePhoenixFulfillmentConfig(
    marketIndex: number,
    phoenixMarket: PublicKey
  ): Promise<TransactionSignature> {
    const initializeIx = await this.getInitializePhoenixFulfillmentConfigIx(
      marketIndex,
      phoenixMarket
    );

    const tx = await this.buildTransaction(initializeIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getInitializePhoenixFulfillmentConfigIx(
    marketIndex: number,
    phoenixMarket: PublicKey
  ): Promise<TransactionInstruction> {
    const phoenixFulfillmentConfig = getPhoenixFulfillmentConfigPublicKey(
      this.program.programId,
      phoenixMarket
    );

    return await this.program.methods
      .initializePhoenixFulfillmentConfig(marketIndex, {
        accounts: {
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          state: await this.getStatePublicKey(),
          baseSpotMarket: this.getSpotMarketAccount(marketIndex).pubkey,
          quoteSpotMarket: this.getQuoteSpotMarketAccount().pubkey,
          driftSigner: this.getSignerPublicKey(),
          phoenixMarket: phoenixMarket,
          phoenixProgram: PHOENIX_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
          systemProgram: anchor.web3.SystemProgram.programId,
          phoenixFulfillmentConfig,
        },
      })
      .instruction();
  }

  public async initializeOpenbookV2FulfillmentConfig(
    marketIndex: number,
    openbookMarket: PublicKey
  ): Promise<TransactionSignature> {
    const initializeIx = await this.getInitializeOpenbookV2FulfillmentConfigIx(
      marketIndex,
      openbookMarket
    );

    const tx = await this.buildTransaction(initializeIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getInitializeOpenbookV2FulfillmentConfigIx(
    marketIndex: number,
    openbookMarket: PublicKey
  ): Promise<TransactionInstruction> {
    const openbookFulfillmentConfig = getOpenbookV2FulfillmentConfigPublicKey(
      this.program.programId,
      openbookMarket
    );

    return this.program.methods
      .initializeOpenbookV2FulfillmentConfig(marketIndex, {
        accounts: {
          baseSpotMarket: this.getSpotMarketAccount(marketIndex).pubkey,
          quoteSpotMarket: this.getQuoteSpotMarketAccount().pubkey,
          state: await this.getStatePublicKey(),
          openbookV2Program: OPENBOOK_PROGRAM_ID,
          openbookV2Market: openbookMarket,
          driftSigner: this.getSignerPublicKey(),
          openbookV2FulfillmentConfig: openbookFulfillmentConfig,
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          rent: SYSVAR_RENT_PUBKEY,
          systemProgram: anchor.web3.SystemProgram.programId,
        },
      })
      .instruction();
  }

  public async initializePerpMarket(
    marketIndex: number,
    priceOracle: PublicKey,
    oracleSource: OracleSource,
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
  ): Promise<TransactionSignature> {
    const currentPerpMarketIndex = this.getStateAccount().numberOfMarkets;

    const initializeMarketIx = await this.getInitializePerpMarketIx(
      marketIndex,
      priceOracle,
      oracleSource,
      baseAssetReserve,
      quoteAssetReserve,
      periodicity,
      pegMultiplier,
      contractTier,
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
      name
    );
    const tx = await this.buildTransaction(initializeMarketIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    while (this.getStateAccount().numberOfMarkets <= currentPerpMarketIndex) {
      await this.fetchAccounts();
    }

    await this.accountSubscriber.addPerpMarket(marketIndex);
    await this.accountSubscriber.addOracle({
      source: oracleSource,
      publicKey: priceOracle,
    });
    await this.accountSubscriber.setPerpOracleMap();

    return txSig;
  }

  public async getInitializePerpMarketIx(
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
    const perpMarketPublicKey = await getPerpMarketPublicKey(
      this.program.programId,
      marketIndex
    );

    const nameBuffer = encodeName(name);
    return await this.program.methods
      .initializePerpMarket(
        marketIndex,
        baseAssetReserve,
        quoteAssetReserve,
        periodicity,
        pegMultiplier,
        oracleSource,
        contractTier,
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
        {
          accounts: {
            state: await this.getStatePublicKey(),
            admin: this.isSubscribed
              ? this.getStateAccount().admin
              : this.wallet.publicKey,
            oracle: priceOracle,
            perpMarket: perpMarketPublicKey,
            rent: SYSVAR_RENT_PUBKEY,
            systemProgram: anchor.web3.SystemProgram.programId,
          },
        }
      )
      .instruction();
  }

  public async initializePredictionMarket(
    perpMarketIndex: number
  ): Promise<TransactionSignature> {
    const updatePerpMarketConcentrationCoefIx =
      await this.getInitializePredictionMarketIx(perpMarketIndex);

    const tx = await this.buildTransaction(updatePerpMarketConcentrationCoefIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getInitializePredictionMarketIx(
    perpMarketIndex: number
  ): Promise<TransactionInstruction> {
    return await this.program.methods
      .initializePredictionMarket({
        accounts: {
          state: await this.getStatePublicKey(),
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          perpMarket: await getPerpMarketPublicKey(
            this.program.programId,
            perpMarketIndex
          ),
        },
      })
      .instruction();
  }

  public async deleteInitializedPerpMarket(
    marketIndex: number
  ): Promise<TransactionSignature> {
    const deleteInitializeMarketIx =
      await this.getDeleteInitializedPerpMarketIx(marketIndex);

    const tx = await this.buildTransaction(deleteInitializeMarketIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getDeleteInitializedPerpMarketIx(
    marketIndex: number
  ): Promise<TransactionInstruction> {
    const perpMarketPublicKey = await getPerpMarketPublicKey(
      this.program.programId,
      marketIndex
    );

    return await this.program.methods
      .deleteInitializedPerpMarket(marketIndex, {
        accounts: {
          state: await this.getStatePublicKey(),
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          perpMarket: perpMarketPublicKey,
        },
      })
      .instruction();
  }

  public async moveAmmPrice(
    perpMarketIndex: number,
    baseAssetReserve: BN,
    quoteAssetReserve: BN,
    sqrtK?: BN
  ): Promise<TransactionSignature> {
    const moveAmmPriceIx = await this.getMoveAmmPriceIx(
      perpMarketIndex,
      baseAssetReserve,
      quoteAssetReserve,
      sqrtK
    );

    const tx = await this.buildTransaction(moveAmmPriceIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getMoveAmmPriceIx(
    perpMarketIndex: number,
    baseAssetReserve: BN,
    quoteAssetReserve: BN,
    sqrtK?: BN
  ): Promise<TransactionInstruction> {
    const marketPublicKey = await getPerpMarketPublicKey(
      this.program.programId,
      perpMarketIndex
    );

    if (sqrtK == undefined) {
      sqrtK = squareRootBN(baseAssetReserve.mul(quoteAssetReserve));
    }

    return await this.program.methods
      .moveAmmPrice(baseAssetReserve, quoteAssetReserve, sqrtK, {
        accounts: {
          state: await this.getStatePublicKey(),
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          perpMarket: marketPublicKey,
        },
      })
      .instruction();
  }

  public async updateK(
    perpMarketIndex: number,
    sqrtK: BN
  ): Promise<TransactionSignature> {
    const updateKIx = await this.getUpdateKIx(perpMarketIndex, sqrtK);

    const tx = await this.buildTransaction(updateKIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getUpdateKIx(
    perpMarketIndex: number,
    sqrtK: BN
  ): Promise<TransactionInstruction> {
    return await this.program.methods
      .updateK(sqrtK, {
        accounts: {
          state: await this.getStatePublicKey(),
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          perpMarket: await getPerpMarketPublicKey(
            this.program.programId,
            perpMarketIndex
          ),
          oracle: this.getPerpMarketAccount(perpMarketIndex).amm.oracle,
        },
      })
      .instruction();
  }

  public async recenterPerpMarketAmm(
    perpMarketIndex: number,
    pegMultiplier: BN,
    sqrtK: BN
  ): Promise<TransactionSignature> {
    const recenterPerpMarketAmmIx = await this.getRecenterPerpMarketAmmIx(
      perpMarketIndex,
      pegMultiplier,
      sqrtK
    );

    const tx = await this.buildTransaction(recenterPerpMarketAmmIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getRecenterPerpMarketAmmIx(
    perpMarketIndex: number,
    pegMultiplier: BN,
    sqrtK: BN
  ): Promise<TransactionInstruction> {
    const marketPublicKey = await getPerpMarketPublicKey(
      this.program.programId,
      perpMarketIndex
    );

    return await this.program.methods
      .recenterPerpMarketAmm(pegMultiplier, sqrtK, {
        accounts: {
          state: await this.getStatePublicKey(),
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          perpMarket: marketPublicKey,
        },
      })
      .instruction();
  }

  public async updatePerpMarketConcentrationScale(
    perpMarketIndex: number,
    concentrationScale: BN
  ): Promise<TransactionSignature> {
    const updatePerpMarketConcentrationCoefIx =
      await this.getUpdatePerpMarketConcentrationScaleIx(
        perpMarketIndex,
        concentrationScale
      );

    const tx = await this.buildTransaction(updatePerpMarketConcentrationCoefIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getUpdatePerpMarketConcentrationScaleIx(
    perpMarketIndex: number,
    concentrationScale: BN
  ): Promise<TransactionInstruction> {
    return await this.program.methods
      .updatePerpMarketConcentrationCoef(concentrationScale, {
        accounts: {
          state: await this.getStatePublicKey(),
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          perpMarket: await getPerpMarketPublicKey(
            this.program.programId,
            perpMarketIndex
          ),
        },
      })
      .instruction();
  }

  public async moveAmmToPrice(
    perpMarketIndex: number,
    targetPrice: BN
  ): Promise<TransactionSignature> {
    const moveAmmPriceIx = await this.getMoveAmmToPriceIx(
      perpMarketIndex,
      targetPrice
    );

    const tx = await this.buildTransaction(moveAmmPriceIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getMoveAmmToPriceIx(
    perpMarketIndex: number,
    targetPrice: BN
  ): Promise<TransactionInstruction> {
    const perpMarket = this.getPerpMarketAccount(perpMarketIndex);

    const [direction, tradeSize, _] = calculateTargetPriceTrade(
      perpMarket,
      targetPrice,
      new BN(1000),
      "quote",
      undefined //todo
    );

    const [newQuoteAssetAmount, newBaseAssetAmount] =
      calculateAmmReservesAfterSwap(
        perpMarket.amm,
        "quote",
        tradeSize,
        getSwapDirection("quote", direction)
      );

    const perpMarketPublicKey = await getPerpMarketPublicKey(
      this.program.programId,
      perpMarketIndex
    );

    return await this.program.methods
      .moveAmmPrice(
        newBaseAssetAmount,
        newQuoteAssetAmount,
        perpMarket.amm.sqrtK,
        {
          accounts: {
            state: await this.getStatePublicKey(),
            admin: this.isSubscribed
              ? this.getStateAccount().admin
              : this.wallet.publicKey,
            perpMarket: perpMarketPublicKey,
          },
        }
      )
      .instruction();
  }

  public async repegAmmCurve(
    newPeg: BN,
    perpMarketIndex: number
  ): Promise<TransactionSignature> {
    const repegAmmCurveIx = await this.getRepegAmmCurveIx(
      newPeg,
      perpMarketIndex
    );

    const tx = await this.buildTransaction(repegAmmCurveIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getRepegAmmCurveIx(
    newPeg: BN,
    perpMarketIndex: number
  ): Promise<TransactionInstruction> {
    const perpMarketPublicKey = await getPerpMarketPublicKey(
      this.program.programId,
      perpMarketIndex
    );
    const ammData = this.getPerpMarketAccount(perpMarketIndex).amm;

    return await this.program.methods
      .repegAmmCurve(newPeg, {
        accounts: {
          state: await this.getStatePublicKey(),
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          oracle: ammData.oracle,
          perpMarket: perpMarketPublicKey,
        },
      })
      .instruction();
  }

  public async updatePerpMarketAmmOracleTwap(
    perpMarketIndex: number
  ): Promise<TransactionSignature> {
    const updatePerpMarketAmmOracleTwapIx =
      await this.getUpdatePerpMarketAmmOracleTwapIx(perpMarketIndex);

    const tx = await this.buildTransaction(updatePerpMarketAmmOracleTwapIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getUpdatePerpMarketAmmOracleTwapIx(
    perpMarketIndex: number
  ): Promise<TransactionInstruction> {
    const ammData = this.getPerpMarketAccount(perpMarketIndex).amm;
    const perpMarketPublicKey = await getPerpMarketPublicKey(
      this.program.programId,
      perpMarketIndex
    );

    return await this.program.methods
      .updatePerpMarketAmmOracleTwap({
        accounts: {
          state: await this.getStatePublicKey(),
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          oracle: ammData.oracle,
          perpMarket: perpMarketPublicKey,
        },
      })
      .instruction();
  }

  public async resetPerpMarketAmmOracleTwap(
    perpMarketIndex: number
  ): Promise<TransactionSignature> {
    const resetPerpMarketAmmOracleTwapIx =
      await this.getResetPerpMarketAmmOracleTwapIx(perpMarketIndex);

    const tx = await this.buildTransaction(resetPerpMarketAmmOracleTwapIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getResetPerpMarketAmmOracleTwapIx(
    perpMarketIndex: number
  ): Promise<TransactionInstruction> {
    const ammData = this.getPerpMarketAccount(perpMarketIndex).amm;
    const perpMarketPublicKey = await getPerpMarketPublicKey(
      this.program.programId,
      perpMarketIndex
    );

    return await this.program.methods
      .resetPerpMarketAmmOracleTwap({
        accounts: {
          state: await this.getStatePublicKey(),
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          oracle: ammData.oracle,
          perpMarket: perpMarketPublicKey,
        },
      })
      .instruction();
  }

  public async depositIntoPerpMarketFeePool(
    perpMarketIndex: number,
    amount: BN,
    sourceVault: PublicKey
  ): Promise<TransactionSignature> {
    const depositIntoPerpMarketFeePoolIx =
      await this.getDepositIntoPerpMarketFeePoolIx(
        perpMarketIndex,
        amount,
        sourceVault
      );

    const tx = await this.buildTransaction(depositIntoPerpMarketFeePoolIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getDepositIntoPerpMarketFeePoolIx(
    perpMarketIndex: number,
    amount: BN,
    sourceVault: PublicKey
  ): Promise<TransactionInstruction> {
    const spotMarket = this.getQuoteSpotMarketAccount();

    return await this.program.methods
      .depositIntoPerpMarketFeePool(amount, {
        accounts: {
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          state: await this.getStatePublicKey(),
          perpMarket: await getPerpMarketPublicKey(
            this.program.programId,
            perpMarketIndex
          ),
          sourceVault,
          driftSigner: this.getSignerPublicKey(),
          quoteSpotMarket: spotMarket.pubkey,
          spotMarketVault: spotMarket.vault,
          tokenProgram: TOKEN_PROGRAM_ID,
        },
      })
      .instruction();
  }

  public async depositIntoSpotMarketVault(
    spotMarketIndex: number,
    amount: BN,
    sourceVault: PublicKey
  ): Promise<TransactionSignature> {
    const depositIntoPerpMarketFeePoolIx =
      await this.getDepositIntoSpotMarketVaultIx(
        spotMarketIndex,
        amount,
        sourceVault
      );

    const tx = await this.buildTransaction(depositIntoPerpMarketFeePoolIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getDepositIntoSpotMarketVaultIx(
    spotMarketIndex: number,
    amount: BN,
    sourceVault: PublicKey
  ): Promise<TransactionInstruction> {
    const spotMarket = this.getSpotMarketAccount(spotMarketIndex);

    const remainingAccounts = [];
    this.addTokenMintToRemainingAccounts(spotMarket, remainingAccounts);
    const tokenProgram = this.getTokenProgramForSpotMarket(spotMarket);
    return await this.program.methods
      .depositIntoSpotMarketVault(amount, {
        accounts: {
          admin: this.wallet.publicKey,
          state: await this.getStatePublicKey(),
          sourceVault,
          spotMarket: spotMarket.pubkey,
          spotMarketVault: spotMarket.vault,
          tokenProgram,
        },
        remainingAccounts,
      })
      .instruction();
  }

  public async updateAdmin(admin: PublicKey): Promise<TransactionSignature> {
    const updateAdminIx = await this.getUpdateAdminIx(admin);

    const tx = await this.buildTransaction(updateAdminIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getUpdateAdminIx(
    admin: PublicKey
  ): Promise<TransactionInstruction> {
    return await this.program.methods
      .updateAdmin(admin, {
        accounts: {
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          state: await this.getStatePublicKey(),
        },
      })
      .instruction();
  }

  public async updatePerpMarketCurveUpdateIntensity(
    perpMarketIndex: number,
    curveUpdateIntensity: number
  ): Promise<TransactionSignature> {
    const updatePerpMarketCurveUpdateIntensityIx =
      await this.getUpdatePerpMarketCurveUpdateIntensityIx(
        perpMarketIndex,
        curveUpdateIntensity
      );

    const tx = await this.buildTransaction(
      updatePerpMarketCurveUpdateIntensityIx
    );

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getUpdatePerpMarketCurveUpdateIntensityIx(
    perpMarketIndex: number,
    curveUpdateIntensity: number
  ): Promise<TransactionInstruction> {
    return await this.program.methods
      .updatePerpMarketCurveUpdateIntensity(curveUpdateIntensity, {
        accounts: {
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          state: await this.getStatePublicKey(),
          perpMarket: await getPerpMarketPublicKey(
            this.program.programId,
            perpMarketIndex
          ),
        },
      })
      .instruction();
  }

  public async updatePerpMarketTargetBaseAssetAmountPerLp(
    perpMarketIndex: number,
    targetBaseAssetAmountPerLP: number
  ): Promise<TransactionSignature> {
    const updatePerpMarketTargetBaseAssetAmountPerLpIx =
      await this.getUpdatePerpMarketTargetBaseAssetAmountPerLpIx(
        perpMarketIndex,
        targetBaseAssetAmountPerLP
      );

    const tx = await this.buildTransaction(
      updatePerpMarketTargetBaseAssetAmountPerLpIx
    );

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async updatePerpMarketAmmSummaryStats(
    perpMarketIndex: number,
    updateAmmSummaryStats?: boolean,
    quoteAssetAmountWithUnsettledLp?: BN,
    netUnsettledFundingPnl?: BN
  ): Promise<TransactionSignature> {
    const updatePerpMarketMarginRatioIx =
      await this.getUpdatePerpMarketAmmSummaryStatsIx(
        perpMarketIndex,
        updateAmmSummaryStats,
        quoteAssetAmountWithUnsettledLp,
        netUnsettledFundingPnl
      );

    const tx = await this.buildTransaction(updatePerpMarketMarginRatioIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getUpdatePerpMarketAmmSummaryStatsIx(
    perpMarketIndex: number,
    updateAmmSummaryStats?: boolean,
    quoteAssetAmountWithUnsettledLp?: BN,
    netUnsettledFundingPnl?: BN
  ): Promise<TransactionInstruction> {
    return await this.program.methods
      .updatePerpMarketAmmSummaryStats(
        {
          updateAmmSummaryStats: updateAmmSummaryStats ?? null,
          quoteAssetAmountWithUnsettledLp:
            quoteAssetAmountWithUnsettledLp ?? null,
          netUnsettledFundingPnl: netUnsettledFundingPnl ?? null,
        },
        {
          accounts: {
            admin: this.wallet.publicKey,
            state: await this.getStatePublicKey(),
            perpMarket: await getPerpMarketPublicKey(
              this.program.programId,
              perpMarketIndex
            ),
            spotMarket: await getSpotMarketPublicKey(
              this.program.programId,
              QUOTE_SPOT_MARKET_INDEX
            ),
            oracle: this.getPerpMarketAccount(perpMarketIndex).amm.oracle,
          },
        }
      )
      .instruction();
  }

  public async getUpdatePerpMarketTargetBaseAssetAmountPerLpIx(
    perpMarketIndex: number,
    targetBaseAssetAmountPerLP: number
  ): Promise<TransactionInstruction> {
    return await this.program.methods
      .updatePerpMarketTargetBaseAssetAmountPerLp(targetBaseAssetAmountPerLP, {
        accounts: {
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          state: await this.getStatePublicKey(),
          perpMarket: await getPerpMarketPublicKey(
            this.program.programId,
            perpMarketIndex
          ),
        },
      })
      .instruction();
  }

  public async updatePerpMarketMarginRatio(
    perpMarketIndex: number,
    marginRatioInitial: number,
    marginRatioMaintenance: number
  ): Promise<TransactionSignature> {
    const updatePerpMarketMarginRatioIx =
      await this.getUpdatePerpMarketMarginRatioIx(
        perpMarketIndex,
        marginRatioInitial,
        marginRatioMaintenance
      );

    const tx = await this.buildTransaction(updatePerpMarketMarginRatioIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getUpdatePerpMarketMarginRatioIx(
    perpMarketIndex: number,
    marginRatioInitial: number,
    marginRatioMaintenance: number
  ): Promise<TransactionInstruction> {
    return await this.program.methods
      .updatePerpMarketMarginRatio(marginRatioInitial, marginRatioMaintenance, {
        accounts: {
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          state: await this.getStatePublicKey(),
          perpMarket: await getPerpMarketPublicKey(
            this.program.programId,
            perpMarketIndex
          ),
        },
      })
      .instruction();
  }

  public async updatePerpMarketHighLeverageMarginRatio(
    perpMarketIndex: number,
    marginRatioInitial: number,
    marginRatioMaintenance: number
  ): Promise<TransactionSignature> {
    const updatePerpMarketHighLeverageMarginRatioIx =
      await this.getUpdatePerpMarketHighLeverageMarginRatioIx(
        perpMarketIndex,
        marginRatioInitial,
        marginRatioMaintenance
      );

    const tx = await this.buildTransaction(
      updatePerpMarketHighLeverageMarginRatioIx
    );

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getUpdatePerpMarketHighLeverageMarginRatioIx(
    perpMarketIndex: number,
    marginRatioInitial: number,
    marginRatioMaintenance: number
  ): Promise<TransactionInstruction> {
    return await this.program.methods
      .updatePerpMarketHighLeverageMarginRatio(
        marginRatioInitial,
        marginRatioMaintenance,
        {
          accounts: {
            admin: this.isSubscribed
              ? this.getStateAccount().admin
              : this.wallet.publicKey,
            state: await this.getStatePublicKey(),
            perpMarket: await getPerpMarketPublicKey(
              this.program.programId,
              perpMarketIndex
            ),
          },
        }
      )
      .instruction();
  }

  public async updatePerpMarketImfFactor(
    perpMarketIndex: number,
    imfFactor: number,
    unrealizedPnlImfFactor: number
  ): Promise<TransactionSignature> {
    const updatePerpMarketImfFactorIx =
      await this.getUpdatePerpMarketImfFactorIx(
        perpMarketIndex,
        imfFactor,
        unrealizedPnlImfFactor
      );

    const tx = await this.buildTransaction(updatePerpMarketImfFactorIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getUpdatePerpMarketImfFactorIx(
    perpMarketIndex: number,
    imfFactor: number,
    unrealizedPnlImfFactor: number
  ): Promise<TransactionInstruction> {
    return await this.program.methods
      .updatePerpMarketImfFactor(imfFactor, unrealizedPnlImfFactor, {
        accounts: {
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          state: await this.getStatePublicKey(),
          perpMarket: await getPerpMarketPublicKey(
            this.program.programId,
            perpMarketIndex
          ),
        },
      })
      .instruction();
  }

  public async updatePerpMarketBaseSpread(
    perpMarketIndex: number,
    baseSpread: number
  ): Promise<TransactionSignature> {
    const updatePerpMarketBaseSpreadIx =
      await this.getUpdatePerpMarketBaseSpreadIx(perpMarketIndex, baseSpread);

    const tx = await this.buildTransaction(updatePerpMarketBaseSpreadIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getUpdatePerpMarketBaseSpreadIx(
    perpMarketIndex: number,
    baseSpread: number
  ): Promise<TransactionInstruction> {
    return await this.program.methods
      .updatePerpMarketBaseSpread(baseSpread, {
        accounts: {
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          state: await this.getStatePublicKey(),
          perpMarket: await getPerpMarketPublicKey(
            this.program.programId,
            perpMarketIndex
          ),
        },
      })
      .instruction();
  }

  public async updateAmmJitIntensity(
    perpMarketIndex: number,
    ammJitIntensity: number
  ): Promise<TransactionSignature> {
    const updateAmmJitIntensityIx = await this.getUpdateAmmJitIntensityIx(
      perpMarketIndex,
      ammJitIntensity
    );

    const tx = await this.buildTransaction(updateAmmJitIntensityIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getUpdateAmmJitIntensityIx(
    perpMarketIndex: number,
    ammJitIntensity: number
  ): Promise<TransactionInstruction> {
    return await this.program.methods
      .updateAmmJitIntensity(ammJitIntensity, {
        accounts: {
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          state: await this.getStatePublicKey(),
          perpMarket: await getPerpMarketPublicKey(
            this.program.programId,
            perpMarketIndex
          ),
        },
      })
      .instruction();
  }

  public async updatePerpMarketName(
    perpMarketIndex: number,
    name: string
  ): Promise<TransactionSignature> {
    const updatePerpMarketNameIx = await this.getUpdatePerpMarketNameIx(
      perpMarketIndex,
      name
    );

    const tx = await this.buildTransaction(updatePerpMarketNameIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getUpdatePerpMarketNameIx(
    perpMarketIndex: number,
    name: string
  ): Promise<TransactionInstruction> {
    const nameBuffer = encodeName(name);
    return await this.program.methods
      .updatePerpMarketName(nameBuffer, {
        accounts: {
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          state: await this.getStatePublicKey(),
          perpMarket: await getPerpMarketPublicKey(
            this.program.programId,
            perpMarketIndex
          ),
        },
      })
      .instruction();
  }

  public async updateSpotMarketName(
    spotMarketIndex: number,
    name: string
  ): Promise<TransactionSignature> {
    const updateSpotMarketNameIx = await this.getUpdateSpotMarketNameIx(
      spotMarketIndex,
      name
    );

    const tx = await this.buildTransaction(updateSpotMarketNameIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getUpdateSpotMarketNameIx(
    spotMarketIndex: number,
    name: string
  ): Promise<TransactionInstruction> {
    const nameBuffer = encodeName(name);
    return await this.program.methods
      .updateSpotMarketName(nameBuffer, {
        accounts: {
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          state: await this.getStatePublicKey(),
          spotMarket: await getSpotMarketPublicKey(
            this.program.programId,
            spotMarketIndex
          ),
        },
      })
      .instruction();
  }

  public async updateSpotMarketPoolId(
    spotMarketIndex: number,
    poolId: number
  ): Promise<TransactionSignature> {
    const updateSpotMarketPoolIdIx = await this.getUpdateSpotMarketPoolIdIx(
      spotMarketIndex,
      poolId
    );

    const tx = await this.buildTransaction(updateSpotMarketPoolIdIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getUpdateSpotMarketPoolIdIx(
    spotMarketIndex: number,
    poolId: number
  ): Promise<TransactionInstruction> {
    return await this.program.methods
      .updateSpotMarketPoolId(poolId, {
        accounts: {
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          state: await this.getStatePublicKey(),
          spotMarket: await getSpotMarketPublicKey(
            this.program.programId,
            spotMarketIndex
          ),
        },
      })
      .instruction();
  }

  public async updatePerpMarketPerLpBase(
    perpMarketIndex: number,
    perLpBase: number
  ): Promise<TransactionSignature> {
    const updatePerpMarketPerLpBaseIx =
      await this.getUpdatePerpMarketPerLpBaseIx(perpMarketIndex, perLpBase);

    const tx = await this.buildTransaction(updatePerpMarketPerLpBaseIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getUpdatePerpMarketPerLpBaseIx(
    perpMarketIndex: number,
    perLpBase: number
  ): Promise<TransactionInstruction> {
    const perpMarketPublicKey = await getPerpMarketPublicKey(
      this.program.programId,
      perpMarketIndex
    );

    return await this.program.methods
      .updatePerpMarketPerLpBase(perLpBase, {
        accounts: {
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          state: await this.getStatePublicKey(),
          perpMarket: perpMarketPublicKey,
        },
      })
      .instruction();
  }

  public async updatePerpMarketMaxSpread(
    perpMarketIndex: number,
    maxSpread: number
  ): Promise<TransactionSignature> {
    const updatePerpMarketMaxSpreadIx =
      await this.getUpdatePerpMarketMaxSpreadIx(perpMarketIndex, maxSpread);

    const tx = await this.buildTransaction(updatePerpMarketMaxSpreadIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getUpdatePerpMarketMaxSpreadIx(
    perpMarketIndex: number,
    maxSpread: number
  ): Promise<TransactionInstruction> {
    const perpMarketPublicKey = await getPerpMarketPublicKey(
      this.program.programId,
      perpMarketIndex
    );

    return await this.program.methods
      .updatePerpMarketMaxSpread(maxSpread, {
        accounts: {
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          state: await this.getStatePublicKey(),
          perpMarket: perpMarketPublicKey,
        },
      })
      .instruction();
  }

  public async updatePerpFeeStructure(
    feeStructure: FeeStructure
  ): Promise<TransactionSignature> {
    const updatePerpFeeStructureIx = await this.getUpdatePerpFeeStructureIx(
      feeStructure
    );

    const tx = await this.buildTransaction(updatePerpFeeStructureIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getUpdatePerpFeeStructureIx(
    feeStructure: FeeStructure
  ): Promise<TransactionInstruction> {
    return this.program.methods
      .updatePerpFeeStructure(feeStructure, {
        accounts: {
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          state: await this.getStatePublicKey(),
        },
      })
      .instruction();
  }

  public async updateSpotFeeStructure(
    feeStructure: FeeStructure
  ): Promise<TransactionSignature> {
    const updateSpotFeeStructureIx = await this.getUpdateSpotFeeStructureIx(
      feeStructure
    );

    const tx = await this.buildTransaction(updateSpotFeeStructureIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getUpdateSpotFeeStructureIx(
    feeStructure: FeeStructure
  ): Promise<TransactionInstruction> {
    return await this.program.methods
      .updateSpotFeeStructure(feeStructure, {
        accounts: {
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          state: await this.getStatePublicKey(),
        },
      })
      .instruction();
  }

  public async updateInitialPctToLiquidate(
    initialPctToLiquidate: number
  ): Promise<TransactionSignature> {
    const updateInitialPctToLiquidateIx =
      await this.getUpdateInitialPctToLiquidateIx(initialPctToLiquidate);

    const tx = await this.buildTransaction(updateInitialPctToLiquidateIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getUpdateInitialPctToLiquidateIx(
    initialPctToLiquidate: number
  ): Promise<TransactionInstruction> {
    return await this.program.methods
      .updateInitialPctToLiquidate(initialPctToLiquidate, {
        accounts: {
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          state: await this.getStatePublicKey(),
        },
      })
      .instruction();
  }

  public async updateLiquidationDuration(
    liquidationDuration: number
  ): Promise<TransactionSignature> {
    const updateLiquidationDurationIx =
      await this.getUpdateLiquidationDurationIx(liquidationDuration);

    const tx = await this.buildTransaction(updateLiquidationDurationIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getUpdateLiquidationDurationIx(
    liquidationDuration: number
  ): Promise<TransactionInstruction> {
    return await this.program.methods
      .updateLiquidationDuration(liquidationDuration, {
        accounts: {
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          state: await this.getStatePublicKey(),
        },
      })
      .instruction();
  }

  public async updateLiquidationMarginBufferRatio(
    updateLiquidationMarginBufferRatio: number
  ): Promise<TransactionSignature> {
    const updateLiquidationMarginBufferRatioIx =
      await this.getUpdateLiquidationMarginBufferRatioIx(
        updateLiquidationMarginBufferRatio
      );

    const tx = await this.buildTransaction(
      updateLiquidationMarginBufferRatioIx
    );

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getUpdateLiquidationMarginBufferRatioIx(
    updateLiquidationMarginBufferRatio: number
  ): Promise<TransactionInstruction> {
    return await this.program.methods
      .updateLiquidationMarginBufferRatio(updateLiquidationMarginBufferRatio, {
        accounts: {
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          state: await this.getStatePublicKey(),
        },
      })
      .instruction();
  }

  public async updateOracleGuardRails(
    oracleGuardRails: OracleGuardRails
  ): Promise<TransactionSignature> {
    const updateOracleGuardRailsIx = await this.getUpdateOracleGuardRailsIx(
      oracleGuardRails
    );

    const tx = await this.buildTransaction(updateOracleGuardRailsIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getUpdateOracleGuardRailsIx(
    oracleGuardRails: OracleGuardRails
  ): Promise<TransactionInstruction> {
    return await this.program.methods
      .updateOracleGuardRails(oracleGuardRails, {
        accounts: {
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          state: await this.getStatePublicKey(),
        },
      })
      .instruction();
  }

  public async updateStateSettlementDuration(
    settlementDuration: number
  ): Promise<TransactionSignature> {
    const updateStateSettlementDurationIx =
      await this.getUpdateStateSettlementDurationIx(settlementDuration);

    const tx = await this.buildTransaction(updateStateSettlementDurationIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getUpdateStateSettlementDurationIx(
    settlementDuration: number
  ): Promise<TransactionInstruction> {
    return await this.program.methods
      .updateStateSettlementDuration(settlementDuration, {
        accounts: {
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          state: await this.getStatePublicKey(),
        },
      })
      .instruction();
  }

  public async updateStateMaxNumberOfSubAccounts(
    maxNumberOfSubAccounts: number
  ): Promise<TransactionSignature> {
    const updateStateMaxNumberOfSubAccountsIx =
      await this.getUpdateStateMaxNumberOfSubAccountsIx(maxNumberOfSubAccounts);

    const tx = await this.buildTransaction(updateStateMaxNumberOfSubAccountsIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getUpdateStateMaxNumberOfSubAccountsIx(
    maxNumberOfSubAccounts: number
  ): Promise<TransactionInstruction> {
    return await this.program.methods
      .updateStateMaxNumberOfSubAccounts(maxNumberOfSubAccounts, {
        accounts: {
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          state: await this.getStatePublicKey(),
        },
      })
      .instruction();
  }

  public async updateStateMaxInitializeUserFee(
    maxInitializeUserFee: number
  ): Promise<TransactionSignature> {
    const updateStateMaxInitializeUserFeeIx =
      await this.getUpdateStateMaxInitializeUserFeeIx(maxInitializeUserFee);

    const tx = await this.buildTransaction(updateStateMaxInitializeUserFeeIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getUpdateStateMaxInitializeUserFeeIx(
    maxInitializeUserFee: number
  ): Promise<TransactionInstruction> {
    return await this.program.methods
      .updateStateMaxInitializeUserFee(maxInitializeUserFee, {
        accounts: {
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          state: await this.getStatePublicKey(),
        },
      })
      .instruction();
  }

  public async updateWithdrawGuardThreshold(
    spotMarketIndex: number,
    withdrawGuardThreshold: BN
  ): Promise<TransactionSignature> {
    const updateWithdrawGuardThresholdIx =
      await this.getUpdateWithdrawGuardThresholdIx(
        spotMarketIndex,
        withdrawGuardThreshold
      );

    const tx = await this.buildTransaction(updateWithdrawGuardThresholdIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getUpdateWithdrawGuardThresholdIx(
    spotMarketIndex: number,
    withdrawGuardThreshold: BN
  ): Promise<TransactionInstruction> {
    return await this.program.methods
      .updateWithdrawGuardThreshold(withdrawGuardThreshold, {
        accounts: {
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          state: await this.getStatePublicKey(),
          spotMarket: await getSpotMarketPublicKey(
            this.program.programId,
            spotMarketIndex
          ),
        },
      })
      .instruction();
  }

  public async updateSpotMarketIfFactor(
    spotMarketIndex: number,
    userIfFactor: BN,
    totalIfFactor: BN
  ): Promise<TransactionSignature> {
    const updateSpotMarketIfFactorIx = await this.getUpdateSpotMarketIfFactorIx(
      spotMarketIndex,
      userIfFactor,
      totalIfFactor
    );

    const tx = await this.buildTransaction(updateSpotMarketIfFactorIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getUpdateSpotMarketIfFactorIx(
    spotMarketIndex: number,
    userIfFactor: BN,
    totalIfFactor: BN
  ): Promise<TransactionInstruction> {
    return await this.program.methods
      .updateSpotMarketIfFactor(spotMarketIndex, userIfFactor, totalIfFactor, {
        accounts: {
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          state: await this.getStatePublicKey(),
          spotMarket: await getSpotMarketPublicKey(
            this.program.programId,
            spotMarketIndex
          ),
        },
      })
      .instruction();
  }

  public async updateSpotMarketRevenueSettlePeriod(
    spotMarketIndex: number,
    revenueSettlePeriod: BN
  ): Promise<TransactionSignature> {
    const updateSpotMarketRevenueSettlePeriodIx =
      await this.getUpdateSpotMarketRevenueSettlePeriodIx(
        spotMarketIndex,
        revenueSettlePeriod
      );

    const tx = await this.buildTransaction(
      updateSpotMarketRevenueSettlePeriodIx
    );

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getUpdateSpotMarketRevenueSettlePeriodIx(
    spotMarketIndex: number,
    revenueSettlePeriod: BN
  ): Promise<TransactionInstruction> {
    return await this.program.methods
      .updateSpotMarketRevenueSettlePeriod(revenueSettlePeriod, {
        accounts: {
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          state: await this.getStatePublicKey(),
          spotMarket: await getSpotMarketPublicKey(
            this.program.programId,
            spotMarketIndex
          ),
        },
      })
      .instruction();
  }

  public async updateSpotMarketMaxTokenDeposits(
    spotMarketIndex: number,
    maxTokenDeposits: BN
  ): Promise<TransactionSignature> {
    const updateSpotMarketMaxTokenDepositsIx =
      await this.getUpdateSpotMarketMaxTokenDepositsIx(
        spotMarketIndex,
        maxTokenDeposits
      );

    const tx = await this.buildTransaction(updateSpotMarketMaxTokenDepositsIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getUpdateSpotMarketMaxTokenDepositsIx(
    spotMarketIndex: number,
    maxTokenDeposits: BN
  ): Promise<TransactionInstruction> {
    return this.program.methods
      .updateSpotMarketMaxTokenDeposits(maxTokenDeposits, {
        accounts: {
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          state: await this.getStatePublicKey(),
          spotMarket: await getSpotMarketPublicKey(
            this.program.programId,
            spotMarketIndex
          ),
        },
      })
      .instruction();
  }

  public async updateSpotMarketMaxTokenBorrows(
    spotMarketIndex: number,
    maxTokenBorrowsFraction: number
  ): Promise<TransactionSignature> {
    const updateSpotMarketMaxTokenBorrowsIx =
      await this.getUpdateSpotMarketMaxTokenBorrowsIx(
        spotMarketIndex,
        maxTokenBorrowsFraction
      );

    const tx = await this.buildTransaction(updateSpotMarketMaxTokenBorrowsIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getUpdateSpotMarketMaxTokenBorrowsIx(
    spotMarketIndex: number,
    maxTokenBorrowsFraction: number
  ): Promise<TransactionInstruction> {
    return this.program.methods
      .updateSpotMarketMaxTokenBorrows(maxTokenBorrowsFraction, {
        accounts: {
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          state: await this.getStatePublicKey(),
          spotMarket: await getSpotMarketPublicKey(
            this.program.programId,
            spotMarketIndex
          ),
        },
      })
      .instruction();
  }

  public async updateSpotMarketScaleInitialAssetWeightStart(
    spotMarketIndex: number,
    scaleInitialAssetWeightStart: BN
  ): Promise<TransactionSignature> {
    const updateSpotMarketScaleInitialAssetWeightStartIx =
      await this.getUpdateSpotMarketScaleInitialAssetWeightStartIx(
        spotMarketIndex,
        scaleInitialAssetWeightStart
      );

    const tx = await this.buildTransaction(
      updateSpotMarketScaleInitialAssetWeightStartIx
    );

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getUpdateSpotMarketScaleInitialAssetWeightStartIx(
    spotMarketIndex: number,
    scaleInitialAssetWeightStart: BN
  ): Promise<TransactionInstruction> {
    return this.program.methods
      .updateSpotMarketScaleInitialAssetWeightStart(
        scaleInitialAssetWeightStart,
        {
          accounts: {
            admin: this.isSubscribed
              ? this.getStateAccount().admin
              : this.wallet.publicKey,
            state: await this.getStatePublicKey(),
            spotMarket: await getSpotMarketPublicKey(
              this.program.programId,
              spotMarketIndex
            ),
          },
        }
      )
      .instruction();
  }

  public async updateInsuranceFundUnstakingPeriod(
    spotMarketIndex: number,
    insuranceWithdrawEscrowPeriod: BN
  ): Promise<TransactionSignature> {
    const updateInsuranceFundUnstakingPeriodIx =
      await this.getUpdateInsuranceFundUnstakingPeriodIx(
        spotMarketIndex,
        insuranceWithdrawEscrowPeriod
      );

    const tx = await this.buildTransaction(
      updateInsuranceFundUnstakingPeriodIx
    );

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getUpdateInsuranceFundUnstakingPeriodIx(
    spotMarketIndex: number,
    insuranceWithdrawEscrowPeriod: BN
  ): Promise<TransactionInstruction> {
    return await this.program.methods
      .updateInsuranceFundUnstakingPeriod(insuranceWithdrawEscrowPeriod, {
        accounts: {
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          state: await this.getStatePublicKey(),
          spotMarket: await getSpotMarketPublicKey(
            this.program.programId,
            spotMarketIndex
          ),
        },
      })
      .instruction();
  }

  public async updateLpCooldownTime(
    cooldownTime: BN
  ): Promise<TransactionSignature> {
    const updateLpCooldownTimeIx = await this.getUpdateLpCooldownTimeIx(
      cooldownTime
    );

    const tx = await this.buildTransaction(updateLpCooldownTimeIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getUpdateLpCooldownTimeIx(
    cooldownTime: BN
  ): Promise<TransactionInstruction> {
    return await this.program.methods
      .updateLpCooldownTime(cooldownTime, {
        accounts: {
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          state: await this.getStatePublicKey(),
        },
      })
      .instruction();
  }

  public async updatePerpMarketOracle(
    perpMarketIndex: number,
    oracle: PublicKey,
    oracleSource: OracleSource
  ): Promise<TransactionSignature> {
    const updatePerpMarketOracleIx = await this.getUpdatePerpMarketOracleIx(
      perpMarketIndex,
      oracle,
      oracleSource
    );

    const tx = await this.buildTransaction(updatePerpMarketOracleIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getUpdatePerpMarketOracleIx(
    perpMarketIndex: number,
    oracle: PublicKey,
    oracleSource: OracleSource
  ): Promise<TransactionInstruction> {
    return await this.program.methods
      .updatePerpMarketOracle(oracle, oracleSource, {
        accounts: {
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          state: await this.getStatePublicKey(),
          perpMarket: await getPerpMarketPublicKey(
            this.program.programId,
            perpMarketIndex
          ),
          oracle: oracle,
        },
      })
      .instruction();
  }

  public async updatePerpMarketStepSizeAndTickSize(
    perpMarketIndex: number,
    stepSize: BN,
    tickSize: BN
  ): Promise<TransactionSignature> {
    const updatePerpMarketStepSizeAndTickSizeIx =
      await this.getUpdatePerpMarketStepSizeAndTickSizeIx(
        perpMarketIndex,
        stepSize,
        tickSize
      );

    const tx = await this.buildTransaction(
      updatePerpMarketStepSizeAndTickSizeIx
    );

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getUpdatePerpMarketStepSizeAndTickSizeIx(
    perpMarketIndex: number,
    stepSize: BN,
    tickSize: BN
  ): Promise<TransactionInstruction> {
    return await this.program.methods
      .updatePerpMarketStepSizeAndTickSize(stepSize, tickSize, {
        accounts: {
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          state: await this.getStatePublicKey(),
          perpMarket: await getPerpMarketPublicKey(
            this.program.programId,
            perpMarketIndex
          ),
        },
      })
      .instruction();
  }

  public async updatePerpMarketMinOrderSize(
    perpMarketIndex: number,
    orderSize: BN
  ): Promise<TransactionSignature> {
    const updatePerpMarketMinOrderSizeIx =
      await this.getUpdatePerpMarketMinOrderSizeIx(perpMarketIndex, orderSize);

    const tx = await this.buildTransaction(updatePerpMarketMinOrderSizeIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getUpdatePerpMarketMinOrderSizeIx(
    perpMarketIndex: number,
    orderSize: BN
  ): Promise<TransactionInstruction> {
    return await this.program.methods
      .updatePerpMarketMinOrderSize(orderSize, {
        accounts: {
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          state: await this.getStatePublicKey(),
          perpMarket: await getPerpMarketPublicKey(
            this.program.programId,
            perpMarketIndex
          ),
        },
      })
      .instruction();
  }

  public async updateSpotMarketStepSizeAndTickSize(
    spotMarketIndex: number,
    stepSize: BN,
    tickSize: BN
  ): Promise<TransactionSignature> {
    const updateSpotMarketStepSizeAndTickSizeIx =
      await this.getUpdateSpotMarketStepSizeAndTickSizeIx(
        spotMarketIndex,
        stepSize,
        tickSize
      );

    const tx = await this.buildTransaction(
      updateSpotMarketStepSizeAndTickSizeIx
    );

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getUpdateSpotMarketStepSizeAndTickSizeIx(
    spotMarketIndex: number,
    stepSize: BN,
    tickSize: BN
  ): Promise<TransactionInstruction> {
    return await this.program.methods
      .updateSpotMarketStepSizeAndTickSize(stepSize, tickSize, {
        accounts: {
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          state: await this.getStatePublicKey(),
          spotMarket: await getSpotMarketPublicKey(
            this.program.programId,
            spotMarketIndex
          ),
        },
      })
      .instruction();
  }

  public async updateSpotMarketMinOrderSize(
    spotMarketIndex: number,
    orderSize: BN
  ): Promise<TransactionSignature> {
    const updateSpotMarketMinOrderSizeIx = await this.program.methods
      .updateSpotMarketMinOrderSize(orderSize, {
        accounts: {
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          state: await this.getStatePublicKey(),
          spotMarket: await getSpotMarketPublicKey(
            this.program.programId,
            spotMarketIndex
          ),
        },
      })
      .instruction();

    const tx = await this.buildTransaction(updateSpotMarketMinOrderSizeIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getUpdateSpotMarketMinOrderSizeIx(
    spotMarketIndex: number,
    orderSize: BN
  ): Promise<TransactionInstruction> {
    return await this.program.methods
      .updateSpotMarketMinOrderSize(orderSize, {
        accounts: {
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          state: await this.getStatePublicKey(),
          spotMarket: await getSpotMarketPublicKey(
            this.program.programId,
            spotMarketIndex
          ),
        },
      })
      .instruction();
  }

  public async updatePerpMarketExpiry(
    perpMarketIndex: number,
    expiryTs: BN
  ): Promise<TransactionSignature> {
    const updatePerpMarketExpiryIx = await this.getUpdatePerpMarketExpiryIx(
      perpMarketIndex,
      expiryTs
    );
    const tx = await this.buildTransaction(updatePerpMarketExpiryIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getUpdatePerpMarketExpiryIx(
    perpMarketIndex: number,
    expiryTs: BN
  ): Promise<TransactionInstruction> {
    return await this.program.methods
      .updatePerpMarketExpiry(expiryTs, {
        accounts: {
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          state: await this.getStatePublicKey(),
          perpMarket: await getPerpMarketPublicKey(
            this.program.programId,
            perpMarketIndex
          ),
        },
      })
      .instruction();
  }

  public async updateSpotMarketOracle(
    spotMarketIndex: number,
    oracle: PublicKey,
    oracleSource: OracleSource
  ): Promise<TransactionSignature> {
    const updateSpotMarketOracleIx = await this.getUpdateSpotMarketOracleIx(
      spotMarketIndex,
      oracle,
      oracleSource
    );

    const tx = await this.buildTransaction(updateSpotMarketOracleIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getUpdateSpotMarketOracleIx(
    spotMarketIndex: number,
    oracle: PublicKey,
    oracleSource: OracleSource
  ): Promise<TransactionInstruction> {
    return await this.program.methods
      .updateSpotMarketOracle(oracle, oracleSource, {
        accounts: {
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          state: await this.getStatePublicKey(),
          spotMarket: await getSpotMarketPublicKey(
            this.program.programId,
            spotMarketIndex
          ),
          oracle: oracle,
        },
      })
      .instruction();
  }

  public async updateSpotMarketOrdersEnabled(
    spotMarketIndex: number,
    ordersEnabled: boolean
  ): Promise<TransactionSignature> {
    const updateSpotMarketOrdersEnabledIx =
      await this.getUpdateSpotMarketOrdersEnabledIx(
        spotMarketIndex,
        ordersEnabled
      );

    const tx = await this.buildTransaction(updateSpotMarketOrdersEnabledIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getUpdateSpotMarketOrdersEnabledIx(
    spotMarketIndex: number,
    ordersEnabled: boolean
  ): Promise<TransactionInstruction> {
    return await this.program.methods
      .updateSpotMarketOrdersEnabled(ordersEnabled, {
        accounts: {
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          state: await this.getStatePublicKey(),
          spotMarket: await getSpotMarketPublicKey(
            this.program.programId,
            spotMarketIndex
          ),
        },
      })
      .instruction();
  }

  public async updateSpotMarketIfPausedOperations(
    spotMarketIndex: number,
    pausedOperations: number
  ): Promise<TransactionSignature> {
    const updateSpotMarketIfStakingDisabledIx =
      await this.getUpdateSpotMarketIfPausedOperationsIx(
        spotMarketIndex,
        pausedOperations
      );

    const tx = await this.buildTransaction(updateSpotMarketIfStakingDisabledIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getUpdateSpotMarketIfPausedOperationsIx(
    spotMarketIndex: number,
    pausedOperations: number
  ): Promise<TransactionInstruction> {
    return await this.program.methods
      .updateSpotMarketIfPausedOperations(pausedOperations, {
        accounts: {
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          state: await this.getStatePublicKey(),
          spotMarket: await getSpotMarketPublicKey(
            this.program.programId,
            spotMarketIndex
          ),
        },
      })
      .instruction();
  }

  public async updateSerumFulfillmentConfigStatus(
    serumFulfillmentConfig: PublicKey,
    status: SpotFulfillmentConfigStatus
  ): Promise<TransactionSignature> {
    const updateSerumFulfillmentConfigStatusIx =
      await this.getUpdateSerumFulfillmentConfigStatusIx(
        serumFulfillmentConfig,
        status
      );

    const tx = await this.buildTransaction(
      updateSerumFulfillmentConfigStatusIx
    );

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getUpdateSerumFulfillmentConfigStatusIx(
    serumFulfillmentConfig: PublicKey,
    status: SpotFulfillmentConfigStatus
  ): Promise<TransactionInstruction> {
    return await this.program.methods
      .updateSerumFulfillmentConfigStatus(status, {
        accounts: {
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          state: await this.getStatePublicKey(),
          serumFulfillmentConfig,
        },
      })
      .instruction();
  }

  public async updatePhoenixFulfillmentConfigStatus(
    phoenixFulfillmentConfig: PublicKey,
    status: SpotFulfillmentConfigStatus
  ): Promise<TransactionSignature> {
    const updatePhoenixFulfillmentConfigStatusIx = await this.program.methods
      .phoenixFulfillmentConfigStatus(status, {
        accounts: {
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          state: await this.getStatePublicKey(),
          phoenixFulfillmentConfig,
        },
      })
      .instruction();

    const tx = await this.buildTransaction(
      updatePhoenixFulfillmentConfigStatusIx
    );

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getUpdatePhoenixFulfillmentConfigStatusIx(
    phoenixFulfillmentConfig: PublicKey,
    status: SpotFulfillmentConfigStatus
  ): Promise<TransactionInstruction> {
    return await this.program.methods
      .phoenixFulfillmentConfigStatus(status, {
        accounts: {
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          state: await this.getStatePublicKey(),
          phoenixFulfillmentConfig,
        },
      })
      .instruction();
  }

  public async updateSpotMarketExpiry(
    spotMarketIndex: number,
    expiryTs: BN
  ): Promise<TransactionSignature> {
    const updateSpotMarketExpiryIx = await this.getUpdateSpotMarketExpiryIx(
      spotMarketIndex,
      expiryTs
    );

    const tx = await this.buildTransaction(updateSpotMarketExpiryIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getUpdateSpotMarketExpiryIx(
    spotMarketIndex: number,
    expiryTs: BN
  ): Promise<TransactionInstruction> {
    return await this.program.methods
      .updateSpotMarketExpiry(expiryTs, {
        accounts: {
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          state: await this.getStatePublicKey(),
          spotMarket: await getSpotMarketPublicKey(
            this.program.programId,
            spotMarketIndex
          ),
        },
      })
      .instruction();
  }

  public async updateWhitelistMint(
    whitelistMint?: PublicKey
  ): Promise<TransactionSignature> {
    const updateWhitelistMintIx = await this.getUpdateWhitelistMintIx(
      whitelistMint
    );

    const tx = await this.buildTransaction(updateWhitelistMintIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getUpdateWhitelistMintIx(
    whitelistMint?: PublicKey
  ): Promise<TransactionInstruction> {
    return await this.program.methods
      .updateWhitelistMint(whitelistMint, {
        accounts: {
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          state: await this.getStatePublicKey(),
        },
      })
      .instruction();
  }

  public async updateDiscountMint(
    discountMint: PublicKey
  ): Promise<TransactionSignature> {
    const updateDiscountMintIx = await this.getUpdateDiscountMintIx(
      discountMint
    );

    const tx = await this.buildTransaction(updateDiscountMintIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getUpdateDiscountMintIx(
    discountMint: PublicKey
  ): Promise<TransactionInstruction> {
    return await this.program.methods
      .updateDiscountMint(discountMint, {
        accounts: {
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          state: await this.getStatePublicKey(),
        },
      })
      .instruction();
  }

  public async updateSpotMarketMarginWeights(
    spotMarketIndex: number,
    initialAssetWeight: number,
    maintenanceAssetWeight: number,
    initialLiabilityWeight: number,
    maintenanceLiabilityWeight: number,
    imfFactor = 0
  ): Promise<TransactionSignature> {
    const updateSpotMarketMarginWeightsIx =
      await this.getUpdateSpotMarketMarginWeightsIx(
        spotMarketIndex,
        initialAssetWeight,
        maintenanceAssetWeight,
        initialLiabilityWeight,
        maintenanceLiabilityWeight,
        imfFactor
      );

    const tx = await this.buildTransaction(updateSpotMarketMarginWeightsIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getUpdateSpotMarketMarginWeightsIx(
    spotMarketIndex: number,
    initialAssetWeight: number,
    maintenanceAssetWeight: number,
    initialLiabilityWeight: number,
    maintenanceLiabilityWeight: number,
    imfFactor = 0
  ): Promise<TransactionInstruction> {
    return await this.program.methods
      .updateSpotMarketMarginWeights(
        initialAssetWeight,
        maintenanceAssetWeight,
        initialLiabilityWeight,
        maintenanceLiabilityWeight,
        imfFactor,
        {
          accounts: {
            admin: this.isSubscribed
              ? this.getStateAccount().admin
              : this.wallet.publicKey,
            state: await this.getStatePublicKey(),
            spotMarket: await getSpotMarketPublicKey(
              this.program.programId,
              spotMarketIndex
            ),
          },
        }
      )
      .instruction();
  }

  public async updateSpotMarketBorrowRate(
    spotMarketIndex: number,
    optimalUtilization: number,
    optimalBorrowRate: number,
    optimalMaxRate: number,
    minBorrowRate?: number | undefined
  ): Promise<TransactionSignature> {
    const updateSpotMarketBorrowRateIx =
      await this.getUpdateSpotMarketBorrowRateIx(
        spotMarketIndex,
        optimalUtilization,
        optimalBorrowRate,
        optimalMaxRate,
        minBorrowRate
      );

    const tx = await this.buildTransaction(updateSpotMarketBorrowRateIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getUpdateSpotMarketBorrowRateIx(
    spotMarketIndex: number,
    optimalUtilization: number,
    optimalBorrowRate: number,
    optimalMaxRate: number,
    minBorrowRate?: number | undefined
  ): Promise<TransactionInstruction> {
    return await this.program.methods
      .updateSpotMarketBorrowRate(
        optimalUtilization,
        optimalBorrowRate,
        optimalMaxRate,
        minBorrowRate,
        {
          accounts: {
            admin: this.isSubscribed
              ? this.getStateAccount().admin
              : this.wallet.publicKey,
            state: await this.getStatePublicKey(),
            spotMarket: await getSpotMarketPublicKey(
              this.program.programId,
              spotMarketIndex
            ),
          },
        }
      )
      .instruction();
  }

  public async updateSpotMarketAssetTier(
    spotMarketIndex: number,
    assetTier: AssetTier
  ): Promise<TransactionSignature> {
    const updateSpotMarketAssetTierIx =
      await this.getUpdateSpotMarketAssetTierIx(spotMarketIndex, assetTier);

    const tx = await this.buildTransaction(updateSpotMarketAssetTierIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getUpdateSpotMarketAssetTierIx(
    spotMarketIndex: number,
    assetTier: AssetTier
  ): Promise<TransactionInstruction> {
    return await this.program.methods
      .updateSpotMarketAssetTier(assetTier, {
        accounts: {
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          state: await this.getStatePublicKey(),
          spotMarket: await getSpotMarketPublicKey(
            this.program.programId,
            spotMarketIndex
          ),
        },
      })
      .instruction();
  }

  public async updateSpotMarketStatus(
    spotMarketIndex: number,
    marketStatus: MarketStatus
  ): Promise<TransactionSignature> {
    const updateSpotMarketStatusIx = await this.getUpdateSpotMarketStatusIx(
      spotMarketIndex,
      marketStatus
    );

    const tx = await this.buildTransaction(updateSpotMarketStatusIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getUpdateSpotMarketStatusIx(
    spotMarketIndex: number,
    marketStatus: MarketStatus
  ): Promise<TransactionInstruction> {
    return await this.program.methods
      .updateSpotMarketStatus(marketStatus, {
        accounts: {
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          state: await this.getStatePublicKey(),
          spotMarket: await getSpotMarketPublicKey(
            this.program.programId,
            spotMarketIndex
          ),
        },
      })
      .instruction();
  }

  public async updateSpotMarketPausedOperations(
    spotMarketIndex: number,
    pausedOperations: number
  ): Promise<TransactionSignature> {
    const updateSpotMarketPausedOperationsIx =
      await this.getUpdateSpotMarketPausedOperationsIx(
        spotMarketIndex,
        pausedOperations
      );

    const tx = await this.buildTransaction(updateSpotMarketPausedOperationsIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getUpdateSpotMarketPausedOperationsIx(
    spotMarketIndex: number,
    pausedOperations: number
  ): Promise<TransactionInstruction> {
    return await this.program.methods
      .updateSpotMarketPausedOperations(pausedOperations, {
        accounts: {
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          state: await this.getStatePublicKey(),
          spotMarket: await getSpotMarketPublicKey(
            this.program.programId,
            spotMarketIndex
          ),
        },
      })
      .instruction();
  }

  public async updatePerpMarketStatus(
    perpMarketIndex: number,
    marketStatus: MarketStatus
  ): Promise<TransactionSignature> {
    const updatePerpMarketStatusIx = await this.getUpdatePerpMarketStatusIx(
      perpMarketIndex,
      marketStatus
    );

    const tx = await this.buildTransaction(updatePerpMarketStatusIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getUpdatePerpMarketStatusIx(
    perpMarketIndex: number,
    marketStatus: MarketStatus
  ): Promise<TransactionInstruction> {
    return await this.program.methods
      .updatePerpMarketStatus(marketStatus, {
        accounts: {
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          state: await this.getStatePublicKey(),
          perpMarket: await getPerpMarketPublicKey(
            this.program.programId,
            perpMarketIndex
          ),
        },
      })
      .instruction();
  }

  public async updatePerpMarketPausedOperations(
    perpMarketIndex: number,
    pausedOperations: number
  ): Promise<TransactionSignature> {
    const updatePerpMarketPausedOperationsIx =
      await this.getUpdatePerpMarketPausedOperationsIx(
        perpMarketIndex,
        pausedOperations
      );

    const tx = await this.buildTransaction(updatePerpMarketPausedOperationsIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getUpdatePerpMarketPausedOperationsIx(
    perpMarketIndex: number,
    pausedOperations: number
  ): Promise<TransactionInstruction> {
    return await this.program.methods
      .updatePerpMarketPausedOperations(pausedOperations, {
        accounts: {
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          state: await this.getStatePublicKey(),
          perpMarket: await getPerpMarketPublicKey(
            this.program.programId,
            perpMarketIndex
          ),
        },
      })
      .instruction();
  }

  public async updatePerpMarketContractTier(
    perpMarketIndex: number,
    contractTier: ContractTier
  ): Promise<TransactionSignature> {
    const updatePerpMarketContractTierIx =
      await this.getUpdatePerpMarketContractTierIx(
        perpMarketIndex,
        contractTier
      );

    const tx = await this.buildTransaction(updatePerpMarketContractTierIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getUpdatePerpMarketContractTierIx(
    perpMarketIndex: number,
    contractTier: ContractTier
  ): Promise<TransactionInstruction> {
    return await this.program.methods
      .updatePerpMarketContractTier(contractTier, {
        accounts: {
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          state: await this.getStatePublicKey(),
          perpMarket: await getPerpMarketPublicKey(
            this.program.programId,
            perpMarketIndex
          ),
        },
      })
      .instruction();
  }

  public async updateExchangeStatus(
    exchangeStatus: ExchangeStatus
  ): Promise<TransactionSignature> {
    const updateExchangeStatusIx = await this.getUpdateExchangeStatusIx(
      exchangeStatus
    );

    const tx = await this.buildTransaction(updateExchangeStatusIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getUpdateExchangeStatusIx(
    exchangeStatus: ExchangeStatus
  ): Promise<TransactionInstruction> {
    return await this.program.methods
      .updateExchangeStatus(exchangeStatus, {
        accounts: {
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          state: await this.getStatePublicKey(),
        },
      })
      .instruction();
  }

  public async updatePerpAuctionDuration(
    minDuration: BN | number
  ): Promise<TransactionSignature> {
    const updatePerpAuctionDurationIx =
      await this.getUpdatePerpAuctionDurationIx(minDuration);

    const tx = await this.buildTransaction(updatePerpAuctionDurationIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getUpdatePerpAuctionDurationIx(
    minDuration: BN | number
  ): Promise<TransactionInstruction> {
    return await this.program.methods
      .updatePerpAuctionDuration(
        typeof minDuration === "number" ? minDuration : minDuration.toNumber(),
        {
          accounts: {
            admin: this.isSubscribed
              ? this.getStateAccount().admin
              : this.wallet.publicKey,
            state: await this.getStatePublicKey(),
          },
        }
      )
      .instruction();
  }

  public async updateSpotAuctionDuration(
    defaultAuctionDuration: number
  ): Promise<TransactionSignature> {
    const updateSpotAuctionDurationIx =
      await this.getUpdateSpotAuctionDurationIx(defaultAuctionDuration);

    const tx = await this.buildTransaction(updateSpotAuctionDurationIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getUpdateSpotAuctionDurationIx(
    defaultAuctionDuration: number
  ): Promise<TransactionInstruction> {
    return await this.program.methods
      .updateSpotAuctionDuration(defaultAuctionDuration, {
        accounts: {
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          state: await this.getStatePublicKey(),
        },
      })
      .instruction();
  }

  public async updatePerpMarketMaxFillReserveFraction(
    perpMarketIndex: number,
    maxBaseAssetAmountRatio: number
  ): Promise<TransactionSignature> {
    const updatePerpMarketMaxFillReserveFractionIx =
      await this.getUpdatePerpMarketMaxFillReserveFractionIx(
        perpMarketIndex,
        maxBaseAssetAmountRatio
      );

    const tx = await this.buildTransaction(
      updatePerpMarketMaxFillReserveFractionIx
    );

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getUpdatePerpMarketMaxFillReserveFractionIx(
    perpMarketIndex: number,
    maxBaseAssetAmountRatio: number
  ): Promise<TransactionInstruction> {
    return await this.program.methods
      .updatePerpMarketMaxFillReserveFraction(maxBaseAssetAmountRatio, {
        accounts: {
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          state: await this.getStatePublicKey(),
          perpMarket: await getPerpMarketPublicKey(
            this.program.programId,
            perpMarketIndex
          ),
        },
      })
      .instruction();
  }

  public async updateMaxSlippageRatio(
    perpMarketIndex: number,
    maxSlippageRatio: number
  ): Promise<TransactionSignature> {
    const updateMaxSlippageRatioIx = await this.getUpdateMaxSlippageRatioIx(
      perpMarketIndex,
      maxSlippageRatio
    );

    const tx = await this.buildTransaction(updateMaxSlippageRatioIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getUpdateMaxSlippageRatioIx(
    perpMarketIndex: number,
    maxSlippageRatio: number
  ): Promise<TransactionInstruction> {
    return await this.program.methods
      .updateMaxSlippageRatio(maxSlippageRatio, {
        accounts: {
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          state: await this.getStatePublicKey(),
          perpMarket: this.getPerpMarketAccount(perpMarketIndex).pubkey,
        },
      })
      .instruction();
  }

  public async updatePerpMarketUnrealizedAssetWeight(
    perpMarketIndex: number,
    unrealizedInitialAssetWeight: number,
    unrealizedMaintenanceAssetWeight: number
  ): Promise<TransactionSignature> {
    const updatePerpMarketUnrealizedAssetWeightIx =
      await this.getUpdatePerpMarketUnrealizedAssetWeightIx(
        perpMarketIndex,
        unrealizedInitialAssetWeight,
        unrealizedMaintenanceAssetWeight
      );

    const tx = await this.buildTransaction(
      updatePerpMarketUnrealizedAssetWeightIx
    );

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getUpdatePerpMarketUnrealizedAssetWeightIx(
    perpMarketIndex: number,
    unrealizedInitialAssetWeight: number,
    unrealizedMaintenanceAssetWeight: number
  ): Promise<TransactionInstruction> {
    return await this.program.methods
      .updatePerpMarketUnrealizedAssetWeight(
        unrealizedInitialAssetWeight,
        unrealizedMaintenanceAssetWeight,
        {
          accounts: {
            admin: this.isSubscribed
              ? this.getStateAccount().admin
              : this.wallet.publicKey,
            state: await this.getStatePublicKey(),
            perpMarket: await getPerpMarketPublicKey(
              this.program.programId,
              perpMarketIndex
            ),
          },
        }
      )
      .instruction();
  }

  public async updatePerpMarketMaxImbalances(
    perpMarketIndex: number,
    unrealizedMaxImbalance: BN,
    maxRevenueWithdrawPerPeriod: BN,
    quoteMaxInsurance: BN
  ): Promise<TransactionSignature> {
    const updatePerpMarketMaxImabalancesIx =
      await this.getUpdatePerpMarketMaxImbalancesIx(
        perpMarketIndex,
        unrealizedMaxImbalance,
        maxRevenueWithdrawPerPeriod,
        quoteMaxInsurance
      );

    const tx = await this.buildTransaction(updatePerpMarketMaxImabalancesIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getUpdatePerpMarketMaxImbalancesIx(
    perpMarketIndex: number,
    unrealizedMaxImbalance: BN,
    maxRevenueWithdrawPerPeriod: BN,
    quoteMaxInsurance: BN
  ): Promise<TransactionInstruction> {
    return await this.program.methods
      .updatePerpMarketMaxImbalances(
        unrealizedMaxImbalance,
        maxRevenueWithdrawPerPeriod,
        quoteMaxInsurance,
        {
          accounts: {
            admin: this.isSubscribed
              ? this.getStateAccount().admin
              : this.wallet.publicKey,
            state: await this.getStatePublicKey(),
            perpMarket: await getPerpMarketPublicKey(
              this.program.programId,
              perpMarketIndex
            ),
          },
        }
      )
      .instruction();
  }

  public async updatePerpMarketMaxOpenInterest(
    perpMarketIndex: number,
    maxOpenInterest: BN
  ): Promise<TransactionSignature> {
    const updatePerpMarketMaxOpenInterestIx =
      await this.getUpdatePerpMarketMaxOpenInterestIx(
        perpMarketIndex,
        maxOpenInterest
      );

    const tx = await this.buildTransaction(updatePerpMarketMaxOpenInterestIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getUpdatePerpMarketMaxOpenInterestIx(
    perpMarketIndex: number,
    maxOpenInterest: BN
  ): Promise<TransactionInstruction> {
    return await this.program.methods
      .updatePerpMarketMaxOpenInterest(maxOpenInterest, {
        accounts: {
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          state: await this.getStatePublicKey(),
          perpMarket: await getPerpMarketPublicKey(
            this.program.programId,
            perpMarketIndex
          ),
        },
      })
      .instruction();
  }

  public async updatePerpMarketNumberOfUser(
    perpMarketIndex: number,
    numberOfUsers?: number,
    numberOfUsersWithBase?: number
  ): Promise<TransactionSignature> {
    const updatepPerpMarketFeeAdjustmentIx =
      await this.getUpdatePerpMarketNumberOfUsersIx(
        perpMarketIndex,
        numberOfUsers,
        numberOfUsersWithBase
      );

    const tx = await this.buildTransaction(updatepPerpMarketFeeAdjustmentIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getUpdatePerpMarketNumberOfUsersIx(
    perpMarketIndex: number,
    numberOfUsers?: number,
    numberOfUsersWithBase?: number
  ): Promise<TransactionInstruction> {
    return await this.program.methods
      .updatePerpMarketNumberOfUsers(numberOfUsers, numberOfUsersWithBase, {
        accounts: {
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          state: await this.getStatePublicKey(),
          perpMarket: await getPerpMarketPublicKey(
            this.program.programId,
            perpMarketIndex
          ),
        },
      })
      .instruction();
  }

  public async updatePerpMarketFeeAdjustment(
    perpMarketIndex: number,
    feeAdjustment: number
  ): Promise<TransactionSignature> {
    const updatepPerpMarketFeeAdjustmentIx =
      await this.getUpdatePerpMarketFeeAdjustmentIx(
        perpMarketIndex,
        feeAdjustment
      );

    const tx = await this.buildTransaction(updatepPerpMarketFeeAdjustmentIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getUpdatePerpMarketFeeAdjustmentIx(
    perpMarketIndex: number,
    feeAdjustment: number
  ): Promise<TransactionInstruction> {
    return await this.program.methods
      .updatePerpMarketFeeAdjustment(feeAdjustment, {
        accounts: {
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          state: await this.getStatePublicKey(),
          perpMarket: await getPerpMarketPublicKey(
            this.program.programId,
            perpMarketIndex
          ),
        },
      })
      .instruction();
  }

  public async updateSpotMarketFeeAdjustment(
    perpMarketIndex: number,
    feeAdjustment: number
  ): Promise<TransactionSignature> {
    const updateSpotMarketFeeAdjustmentIx =
      await this.getUpdateSpotMarketFeeAdjustmentIx(
        perpMarketIndex,
        feeAdjustment
      );

    const tx = await this.buildTransaction(updateSpotMarketFeeAdjustmentIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getUpdateSpotMarketFeeAdjustmentIx(
    spotMarketIndex: number,
    feeAdjustment: number
  ): Promise<TransactionInstruction> {
    return await this.program.methods
      .updateSpotMarketFeeAdjustment(feeAdjustment, {
        accounts: {
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          state: await this.getStatePublicKey(),
          spotMarket: await getSpotMarketPublicKey(
            this.program.programId,
            spotMarketIndex
          ),
        },
      })
      .instruction();
  }

  public async updateSerumVault(
    srmVault: PublicKey
  ): Promise<TransactionSignature> {
    const updateSerumVaultIx = await this.getUpdateSerumVaultIx(srmVault);

    const tx = await this.buildTransaction(updateSerumVaultIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getUpdateSerumVaultIx(
    srmVault: PublicKey
  ): Promise<TransactionInstruction> {
    return await this.program.methods
      .updateSerumVault(srmVault, {
        accounts: {
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          state: await this.getStatePublicKey(),
          srmVault: srmVault,
        },
      })
      .instruction();
  }

  public async updatePerpMarketLiquidationFee(
    perpMarketIndex: number,
    liquidatorFee: number,
    ifLiquidationFee: number
  ): Promise<TransactionSignature> {
    const updatePerpMarketLiquidationFeeIx =
      await this.getUpdatePerpMarketLiquidationFeeIx(
        perpMarketIndex,
        liquidatorFee,
        ifLiquidationFee
      );

    const tx = await this.buildTransaction(updatePerpMarketLiquidationFeeIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getUpdatePerpMarketLiquidationFeeIx(
    perpMarketIndex: number,
    liquidatorFee: number,
    ifLiquidationFee: number
  ): Promise<TransactionInstruction> {
    return await this.program.methods
      .updatePerpMarketLiquidationFee(liquidatorFee, ifLiquidationFee, {
        accounts: {
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          state: await this.getStatePublicKey(),
          perpMarket: await getPerpMarketPublicKey(
            this.program.programId,
            perpMarketIndex
          ),
        },
      })
      .instruction();
  }

  public async updateSpotMarketLiquidationFee(
    spotMarketIndex: number,
    liquidatorFee: number,
    ifLiquidationFee: number
  ): Promise<TransactionSignature> {
    const updateSpotMarketLiquidationFeeIx =
      await this.getUpdateSpotMarketLiquidationFeeIx(
        spotMarketIndex,
        liquidatorFee,
        ifLiquidationFee
      );

    const tx = await this.buildTransaction(updateSpotMarketLiquidationFeeIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getUpdateSpotMarketLiquidationFeeIx(
    spotMarketIndex: number,
    liquidatorFee: number,
    ifLiquidationFee: number
  ): Promise<TransactionInstruction> {
    return await this.program.methods
      .updateSpotMarketLiquidationFee(liquidatorFee, ifLiquidationFee, {
        accounts: {
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          state: await this.getStatePublicKey(),
          spotMarket: await getSpotMarketPublicKey(
            this.program.programId,
            spotMarketIndex
          ),
        },
      })
      .instruction();
  }

  public async initializeProtocolIfSharesTransferConfig(): Promise<TransactionSignature> {
    const initializeProtocolIfSharesTransferConfigIx =
      await this.getInitializeProtocolIfSharesTransferConfigIx();

    const tx = await this.buildTransaction(
      initializeProtocolIfSharesTransferConfigIx
    );

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getInitializeProtocolIfSharesTransferConfigIx(): Promise<TransactionInstruction> {
    return await this.program.methods
      .initializeProtocolIfSharesTransferConfig({
        accounts: {
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          state: await this.getStatePublicKey(),
          rent: SYSVAR_RENT_PUBKEY,
          systemProgram: anchor.web3.SystemProgram.programId,
          protocolIfSharesTransferConfig:
            getProtocolIfSharesTransferConfigPublicKey(this.program.programId),
        },
      })
      .instruction();
  }

  public async updateProtocolIfSharesTransferConfig(
    whitelistedSigners?: PublicKey[],
    maxTransferPerEpoch?: BN
  ): Promise<TransactionSignature> {
    const updateProtocolIfSharesTransferConfigIx =
      await this.getUpdateProtocolIfSharesTransferConfigIx(
        whitelistedSigners,
        maxTransferPerEpoch
      );

    const tx = await this.buildTransaction(
      updateProtocolIfSharesTransferConfigIx
    );

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getUpdateProtocolIfSharesTransferConfigIx(
    whitelistedSigners?: PublicKey[],
    maxTransferPerEpoch?: BN
  ): Promise<TransactionInstruction> {
    return await this.program.methods
      .updateProtocolIfSharesTransferConfig(
        whitelistedSigners || null,
        maxTransferPerEpoch,
        {
          accounts: {
            admin: this.isSubscribed
              ? this.getStateAccount().admin
              : this.wallet.publicKey,
            state: await this.getStatePublicKey(),
            protocolIfSharesTransferConfig:
              getProtocolIfSharesTransferConfigPublicKey(
                this.program.programId
              ),
          },
        }
      )
      .instruction();
  }

  public async initializePrelaunchOracle(
    perpMarketIndex: number,
    price?: BN,
    maxPrice?: BN
  ): Promise<TransactionSignature> {
    const initializePrelaunchOracleIx =
      await this.getInitializePrelaunchOracleIx(
        perpMarketIndex,
        price,
        maxPrice
      );

    const tx = await this.buildTransaction(initializePrelaunchOracleIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getInitializePrelaunchOracleIx(
    perpMarketIndex: number,
    price?: BN,
    maxPrice?: BN
  ): Promise<TransactionInstruction> {
    const params = {
      perpMarketIndex,
      price: price || null,
      maxPrice: maxPrice || null,
    };

    return await this.program.methods
      .initializePrelaunchOracle(params, {
        accounts: {
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          state: await this.getStatePublicKey(),
          prelaunchOracle: await getPrelaunchOraclePublicKey(
            this.program.programId,
            perpMarketIndex
          ),
          rent: SYSVAR_RENT_PUBKEY,
          systemProgram: anchor.web3.SystemProgram.programId,
        },
      })
      .instruction();
  }

  public async updatePrelaunchOracleParams(
    perpMarketIndex: number,
    price?: BN,
    maxPrice?: BN
  ): Promise<TransactionSignature> {
    const updatePrelaunchOracleParamsIx =
      await this.getUpdatePrelaunchOracleParamsIx(
        perpMarketIndex,
        price,
        maxPrice
      );

    const tx = await this.buildTransaction(updatePrelaunchOracleParamsIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getUpdatePrelaunchOracleParamsIx(
    perpMarketIndex: number,
    price?: BN,
    maxPrice?: BN
  ): Promise<TransactionInstruction> {
    const params = {
      perpMarketIndex,
      price: price || null,
      maxPrice: maxPrice || null,
    };

    const perpMarketPublicKey = await getPerpMarketPublicKey(
      this.program.programId,
      perpMarketIndex
    );

    return await this.program.methods
      .updatePrelaunchOracleParams(params, {
        accounts: {
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          state: await this.getStatePublicKey(),
          perpMarket: perpMarketPublicKey,
          prelaunchOracle: await getPrelaunchOraclePublicKey(
            this.program.programId,
            perpMarketIndex
          ),
        },
      })
      .instruction();
  }

  public async deletePrelaunchOracle(
    perpMarketIndex: number
  ): Promise<TransactionSignature> {
    const deletePrelaunchOracleIx = await this.getDeletePrelaunchOracleIx(
      perpMarketIndex
    );

    const tx = await this.buildTransaction(deletePrelaunchOracleIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getDeletePrelaunchOracleIx(
    perpMarketIndex: number,
    price?: BN,
    maxPrice?: BN
  ): Promise<TransactionInstruction> {
    const params = {
      perpMarketIndex,
      price: price || null,
      maxPrice: maxPrice || null,
    };

    const perpMarketPublicKey = await getPerpMarketPublicKey(
      this.program.programId,
      perpMarketIndex
    );

    return await this.program.methods
      .deletePrelaunchOracle(params, {
        accounts: {
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          state: await this.getStatePublicKey(),
          perpMarket: perpMarketPublicKey,
          prelaunchOracle: await getPrelaunchOraclePublicKey(
            this.program.programId,
            perpMarketIndex
          ),
        },
      })
      .instruction();
  }

  public async updateSpotMarketFuel(
    spotMarketIndex: number,
    fuelBoostDeposits?: number,
    fuelBoostBorrows?: number,
    fuelBoostTaker?: number,
    fuelBoostMaker?: number,
    fuelBoostInsurance?: number
  ): Promise<TransactionSignature> {
    const updateSpotMarketFuelIx = await this.getUpdateSpotMarketFuelIx(
      spotMarketIndex,
      fuelBoostDeposits || null,
      fuelBoostBorrows || null,
      fuelBoostTaker || null,
      fuelBoostMaker || null,
      fuelBoostInsurance || null
    );

    const tx = await this.buildTransaction(updateSpotMarketFuelIx);
    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getUpdateSpotMarketFuelIx(
    spotMarketIndex: number,
    fuelBoostDeposits?: number,
    fuelBoostBorrows?: number,
    fuelBoostTaker?: number,
    fuelBoostMaker?: number,
    fuelBoostInsurance?: number
  ): Promise<TransactionInstruction> {
    const spotMarketPublicKey = await getSpotMarketPublicKey(
      this.program.programId,
      spotMarketIndex
    );

    return await this.program.methods
      .updateSpotMarketFuel(
        fuelBoostDeposits || null,
        fuelBoostBorrows || null,
        fuelBoostTaker || null,
        fuelBoostMaker || null,
        fuelBoostInsurance || null,
        {
          accounts: {
            admin: this.isSubscribed
              ? this.getStateAccount().admin
              : this.wallet.publicKey,
            state: await this.getStatePublicKey(),
            spotMarket: spotMarketPublicKey,
          },
        }
      )
      .instruction();
  }

  public async updatePerpMarketFuel(
    perpMarketIndex: number,
    fuelBoostTaker?: number,
    fuelBoostMaker?: number,
    fuelBoostPosition?: number
  ): Promise<TransactionSignature> {
    const updatePerpMarketFuelIx = await this.getUpdatePerpMarketFuelIx(
      perpMarketIndex,
      fuelBoostTaker || null,
      fuelBoostMaker || null,
      fuelBoostPosition || null
    );

    const tx = await this.buildTransaction(updatePerpMarketFuelIx);
    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getUpdatePerpMarketFuelIx(
    perpMarketIndex: number,
    fuelBoostTaker?: number,
    fuelBoostMaker?: number,
    fuelBoostPosition?: number
  ): Promise<TransactionInstruction> {
    const perpMarketPublicKey = await getPerpMarketPublicKey(
      this.program.programId,
      perpMarketIndex
    );

    return await this.program.methods
      .updatePerpMarketFuel(
        fuelBoostTaker || null,
        fuelBoostMaker || null,
        fuelBoostPosition || null,
        {
          accounts: {
            admin: this.isSubscribed
              ? this.getStateAccount().admin
              : this.wallet.publicKey,
            state: await this.getStatePublicKey(),
            perpMarket: perpMarketPublicKey,
          },
        }
      )
      .instruction();
  }

  public async initUserFuel(
    user: PublicKey,
    authority: PublicKey,
    fuelBonusDeposits?: number,
    fuelBonusBorrows?: number,
    fuelBonusTaker?: number,
    fuelBonusMaker?: number,
    fuelBonusInsurance?: number
  ): Promise<TransactionSignature> {
    const updatePerpMarketFuelIx = await this.getInitUserFuelIx(
      user,
      authority,
      fuelBonusDeposits,
      fuelBonusBorrows,
      fuelBonusTaker,
      fuelBonusMaker,
      fuelBonusInsurance
    );

    const tx = await this.buildTransaction(updatePerpMarketFuelIx);
    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getInitUserFuelIx(
    user: PublicKey,
    authority: PublicKey,
    fuelBonusDeposits?: number,
    fuelBonusBorrows?: number,
    fuelBonusTaker?: number,
    fuelBonusMaker?: number,
    fuelBonusInsurance?: number
  ): Promise<TransactionInstruction> {
    const userStats = await getUserStatsAccountPublicKey(
      this.program.programId,
      authority
    );

    return await this.program.methods
      .initUserFuel(
        fuelBonusDeposits || null,
        fuelBonusBorrows || null,
        fuelBonusTaker || null,
        fuelBonusMaker || null,
        fuelBonusInsurance || null,
        {
          accounts: {
            admin: this.wallet.publicKey,
            state: await this.getStatePublicKey(),
            user,
            userStats,
          },
        }
      )
      .instruction();
  }

  public async initializePythPullOracle(
    feedId: string,
    isAdmin = false
  ): Promise<TransactionSignature> {
    const initializePythPullOracleIx = await this.getInitializePythPullOracleIx(
      feedId,
      isAdmin
    );
    const tx = await this.buildTransaction(initializePythPullOracleIx);
    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getInitializePythPullOracleIx(
    feedId: string,
    isAdmin = false
  ): Promise<TransactionInstruction> {
    const feedIdBuffer = getFeedIdUint8Array(feedId);
    return await this.program.methods
      .initializePythPullOracle(feedIdBuffer, {
        accounts: {
          admin: isAdmin ? this.getStateAccount().admin : this.wallet.publicKey,
          state: await this.getStatePublicKey(),
          systemProgram: SystemProgram.programId,
          priceFeed: getPythPullOraclePublicKey(
            this.program.programId,
            feedIdBuffer
          ),
          pythSolanaReceiver: DRIFT_ORACLE_RECEIVER_ID,
        },
      })
      .instruction();
  }

  public async initializeHighLeverageModeConfig(
    maxUsers: number
  ): Promise<TransactionSignature> {
    const initializeHighLeverageModeConfigIx =
      await this.getInitializeHighLeverageModeConfigIx(maxUsers);

    const tx = await this.buildTransaction(initializeHighLeverageModeConfigIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getInitializeHighLeverageModeConfigIx(
    maxUsers: number
  ): Promise<TransactionInstruction> {
    return await this.program.methods
      .initializeHighLeverageModeConfig(maxUsers, {
        accounts: {
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          state: await this.getStatePublicKey(),
          rent: SYSVAR_RENT_PUBKEY,
          systemProgram: anchor.web3.SystemProgram.programId,
          highLeverageModeConfig: getHighLeverageModeConfigPublicKey(
            this.program.programId
          ),
        },
      })
      .instruction();
  }

  public async updateUpdateHighLeverageModeConfig(
    maxUsers: number,
    reduceOnly: boolean
  ): Promise<TransactionSignature> {
    const updateHighLeverageModeConfigIx =
      await this.getUpdateHighLeverageModeConfigIx(maxUsers, reduceOnly);

    const tx = await this.buildTransaction(updateHighLeverageModeConfigIx);

    const { txSig } = await this.sendTransaction(tx, [], this.opts);

    return txSig;
  }

  public async getUpdateHighLeverageModeConfigIx(
    maxUsers: number,
    reduceOnly: boolean
  ): Promise<TransactionInstruction> {
    return await this.program.methods
      .updateHighLeverageModeConfig(maxUsers, reduceOnly, {
        accounts: {
          admin: this.isSubscribed
            ? this.getStateAccount().admin
            : this.wallet.publicKey,
          state: await this.getStatePublicKey(),
          highLeverageModeConfig: getHighLeverageModeConfigPublicKey(
            this.program.programId
          ),
        },
      })
      .instruction();
  }
}
