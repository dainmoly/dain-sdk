import { AnchorProvider, BN, Program } from "@coral-xyz/anchor";
import { ConfirmOptions, Connection, Keypair, PublicKey, SendOptions, SystemProgram, SYSVAR_RENT_PUBKEY, TransactionInstruction, TransactionSignature } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

import { IDL, Drift } from "./idls/drift";
import { AccountLoader } from "./accountLoader";
import { buildTransaction, executeTransaction } from "./transaction";
import { DAIN_PROGRAM_ID, CONFIRMATION_OPTS, PEG_PRECISION, ZERO, BASE_PRECISION, ONE, PRICE_PRECISION, DEFAULT_MARKET_NAME, DEFAULT_USER_NAME } from "./constants";
import { AssetTier, ContractTier, DainConfig, DainProgram, MarketType, OraclePriceData, OracleSource, OrderParams, PerpMarketAccount, SpotMarketAccount, StateAccount, UserAccount, Wallet } from "./types";
import { castNumberToSpotPrecision, encodeName, getInsuranceFundVaultPublicKey, getPerpMarketPublicKey, getSignerPublicKey, getSpotMarketPublicKey, getSpotMarketVaultPublicKey, getStateAccountPublicKey, getUserAccountPublicKey, getUserStatsAccountPublicKey, isVariant } from "./modules";
import { NodeWallet } from "./modules/nodeWallet";
import { ORACLE_DEFAULT_KEY, QUOTE_ORACLE_PRICE_DATA } from "./oracles/quoteAssetOracleClient";
import { User } from "./user";


export class DainClient {
  connection: Connection;
  programId: PublicKey;
  program: DainProgram;
  wallet?: Wallet;
  sendOpts: SendOptions;
  confirmOpts: ConfirmOptions;
  accountLoader: AccountLoader;

  readonly authority: PublicKey;
  readonly payer: PublicKey;

  state?: StateAccount;
  perpMarkets: Map<number, PerpMarketAccount>;
  spotMarkets: Map<number, SpotMarketAccount>;
  oracles: Map<string, OraclePriceData>;
  users: Map<string, UserAccount>;

  public constructor(config: DainConfig, connection: Connection, wallet?: Wallet) {
    this.connection = connection;
    this.wallet = wallet;
    this.sendOpts = config.sendOpts ?? CONFIRMATION_OPTS;
    this.confirmOpts = config.confirmOpts ?? CONFIRMATION_OPTS;
    this.programId = config.programId ?? DAIN_PROGRAM_ID;

    const provider = new AnchorProvider(connection, wallet ?? new NodeWallet(Keypair.generate()), this.confirmOpts);
    this.program = new Program<Drift>(IDL, this.programId, provider);

    this.authority = wallet?.publicKey ?? PublicKey.default;
    this.payer = wallet?.publicKey ?? PublicKey.default;
    this.accountLoader = new AccountLoader(connection, this.program, this.confirmOpts.commitment);

    this.spotMarkets = new Map<number, SpotMarketAccount>();
    this.perpMarkets = new Map<number, PerpMarketAccount>();
    this.oracles = new Map<string, OraclePriceData>();
    this.users = new Map<string, UserAccount>();
  }

  /* Updaters */
  static async getFromWallet(
    config: DainConfig,
    connection: Connection,
    wallet?: Wallet
  ): Promise<DainClient> {
    const client = new DainClient(config, connection, wallet);
    await client.load();

    return client;
  }

  /* State accounts */
  signerPublicKey?: PublicKey;
  public getSignerPublicKey(): PublicKey {
    if (this.signerPublicKey) {
      return this.signerPublicKey;
    }
    this.signerPublicKey = getSignerPublicKey(this.program.programId);
    return this.signerPublicKey;
  }

  statePublicKey?: PublicKey;
  public getStatePublicKey(): PublicKey {
    if (this.statePublicKey) {
      return this.statePublicKey;
    }
    this.statePublicKey = getStateAccountPublicKey(this.program.programId);
    return this.statePublicKey;
  }

  public getStateAccount(): StateAccount {
    return this.state as StateAccount;
  }

  userStatsPublicKey?: PublicKey;
  public getUserStatsPublicKey(): PublicKey {
    if (this.userStatsPublicKey) {
      return this.userStatsPublicKey;
    }
    this.userStatsPublicKey = getUserStatsAccountPublicKey(this.program.programId, this.authority);
    return this.userStatsPublicKey;
  }

  /* Fetch functions */
  public async loadState() {
    this.state = await this.accountLoader.fetchState();
  }

  public async loadPerpMarkets() {
    const perpMarkets = await this.accountLoader.loadPerpMarkets();
    if (perpMarkets) {
      for (const market of perpMarkets) {
        this.perpMarkets.set(market.marketIndex, market);
      }
    }
  }

  public async loadSpotMarkets() {
    const spotMarkets = await this.accountLoader.loadSpotMarkets();
    if (spotMarkets) {
      for (const market of spotMarkets) {
        this.spotMarkets.set(market.marketIndex, market);
      }
    }
  }

  public async loadOracle(source: OracleSource, pubkey: PublicKey) {
    const oracle = await this.accountLoader.fetchOracle(source, pubkey);
    if (oracle) {
      this.oracles.set(pubkey.toBase58(), oracle);
    }
  }

  public async load() {
    await this.loadState();
    await this.loadPerpMarkets();
    await this.loadSpotMarkets();
  }

  /* Admin functions */
  public async initialize(quoteAssetMint: PublicKey,): Promise<TransactionSignature | null> {
    const initializeIx = await this.getInitializeIx(quoteAssetMint);

    const tx = await buildTransaction(
      this.connection,
      [initializeIx]
    );

    if (this.wallet && tx) {
      const signature = await executeTransaction(this.connection, tx, this.wallet, this.sendOpts);
      return signature;
    }
    else {
      return null;
    }
  }

  public async getInitializeIx(quoteAssetMint: PublicKey): Promise<TransactionInstruction> {
    const initializeIx = await this.program.methods.initialize()
      .accounts({
        admin: this.state?.admin,
        state: this.getStatePublicKey(),
        quoteAssetMint,
        rent: SYSVAR_RENT_PUBKEY,
        driftSigner: this.getSignerPublicKey(),
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();

    return initializeIx;
  }

  public async getInitializePerpMarketIx(
    marketIndex: number,
    oracle: PublicKey,
    baseAssetReserve: BN,
    quoteAssetReserve: BN,
    periodicity: BN,
    name = DEFAULT_MARKET_NAME,
    pegMultiplier: BN = PEG_PRECISION,
    oracleSource: OracleSource = OracleSource.PYTH,
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
  ): Promise<TransactionInstruction> {
    const nameBuffer = encodeName(name);
    const perpMarket = getPerpMarketPublicKey(this.programId, marketIndex);

    return await this.program.methods.initializePerpMarket(
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
      nameBuffer
    )
      .accounts({
        state: this.getStatePublicKey(),
        admin: this.state?.admin,
        oracle,
        perpMarket,
        rent: SYSVAR_RENT_PUBKEY,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  public async getInitializeSpotMarketIx(
    marketIndex: number,
    mint: PublicKey,
    optimalUtilization: number,
    optimalRate: number,
    maxRate: number,
    oracle: PublicKey,
    oracleSource: OracleSource,
    initialAssetWeight: number,
    maintenanceAssetWeight: number,
    initialLiabilityWeight: number,
    maintenanceLiabilityWeight: number,
    name = DEFAULT_MARKET_NAME,
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
  ): Promise<TransactionInstruction> {
    const nameBuffer = encodeName(name);
    const spotMarket = getSpotMarketPublicKey(this.programId, marketIndex);
    const spotMarketVault = getSpotMarketVaultPublicKey(this.programId, marketIndex);
    const insuranceFundVault = getInsuranceFundVaultPublicKey(this.programId, marketIndex);

    return await this.program.methods.initializeSpotMarket(
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
        state: this.getStatePublicKey(),
        admin: this.state?.admin,
        oracle,
        spotMarket,
        spotMarketMint: mint,
        spotMarketVault,
        insuranceFundVault,
        driftSigner: this.getSignerPublicKey(),
        rent: SYSVAR_RENT_PUBKEY,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
  }

  public async getSettleExpiredMarketIx(
    marketIndex: number
  ): Promise<TransactionInstruction> {
    // const remainingAccounts = this.getRemainingAccounts({
    //   userAccounts: [],
    //   writablePerpMarketIndexes: [marketIndex],
    //   writableSpotMarketIndexes: [QUOTE_SPOT_MARKET_INDEX],
    // });
    const perpMarketPublicKey = getPerpMarketPublicKey(this.programId, marketIndex);

    return await this.program.methods.settleExpiredMarket(marketIndex)
      .accounts({
        state: await this.getStatePublicKey(),
        admin: this.state?.admin,
        perpMarket: perpMarketPublicKey,
      })
      // .remainingAccounts(remainingAccounts)
      .instruction();
  }

  /* User functions */
  public async initializeUser(
    subAccountId = 0,
    name?: string,
  ): Promise<TransactionSignature | null> {
    const initializeIxs = [];

    const [_, initializeUserIx] = await this.getInitializeUserIx(subAccountId, name);
    if (subAccountId === 0) {
      const initializeUserStateIx = await this.getInitializeUserStateIx();
      initializeIxs.push(initializeUserStateIx);
    }

    initializeIxs.push(initializeUserIx);

    const tx = await buildTransaction(
      this.connection,
      initializeIxs
    );

    if (this.wallet && tx) {
      const signature = await executeTransaction(this.connection, tx, this.wallet, this.sendOpts);
      return signature;
    }
    else {
      return null;
    }
  }

  public async getInitializeUserStateIx(): Promise<TransactionInstruction> {
    return await this.program.methods.initializeUserStats()
      .accounts({
        userStats: this.getUserStatsPublicKey(),
        state: this.getStatePublicKey(),
        authority: this.authority,
        payer: this.payer,
        rent: SYSVAR_RENT_PUBKEY,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  public async getInitializeUserIx(subAccountId: number, name?: string): Promise<[PublicKey, TransactionInstruction]> {
    if (name === undefined) {
      if (subAccountId === 0) {
        name = DEFAULT_USER_NAME;
      } else {
        name = `Subaccount ${subAccountId + 1}`;
      }
    }

    const nameBuffer = encodeName(name);
    const userPda = getUserAccountPublicKey(this.programId, this.authority, subAccountId);

    const ix = await this.program.methods.initializeUser(
      subAccountId,
      nameBuffer
    )
      .accounts({
        state: this.getStatePublicKey(),
        user: userPda,
        userStats: this.getUserStatsPublicKey(),
        authority: this.authority,
        payer: this.payer,
        rent: SYSVAR_RENT_PUBKEY,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    return [userPda, ix];
  }

  public async getDepositIx(
    marketIndex: number,
    amount: BN,
    reduceOnly = false,
    subAccountId = 0,
    userTokenAccount?: PublicKey,
  ): Promise<TransactionInstruction> {
    const userPda = getUserAccountPublicKey(this.programId, this.authority, subAccountId);
    const spotMarketVault = getSpotMarketVaultPublicKey(this.programId, marketIndex);

    return await this.program.methods.deposit(
      marketIndex,
      amount,
      reduceOnly,
    )
      .accounts({
        state: this.getStatePublicKey(),
        spotMarketVault,
        user: userPda,
        userStats: this.getUserStatsPublicKey(),
        userTokenAccount,
        authority: this.authority,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
  }

  public async getWithdrawIx(
    marketIndex: number,
    amount: BN,
    reduceOnly = false,
    subAccountId = 0,
    userTokenAccount?: PublicKey,
  ): Promise<TransactionInstruction> {
    const userPda = getUserAccountPublicKey(this.programId, this.authority, subAccountId);
    const spotMarketVault = getSpotMarketVaultPublicKey(this.programId, marketIndex);

    return await this.program.methods.withdraw(
      marketIndex,
      amount,
      reduceOnly,
    )
      .accounts({
        state: this.getStatePublicKey(),
        spotMarketVault,
        user: userPda,
        userStats: this.getUserStatsPublicKey(),
        userTokenAccount,
        authority: this.authority,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
  }

  public async getPlaceAndTakePerpOrderIx(
    orderParams: OrderParams,
    subAccountId = 0,
  ): Promise<TransactionInstruction> {
    const userPda = getUserAccountPublicKey(this.programId, this.authority, subAccountId);

    return await this.program.methods.placeAndTakePerpOrder(
      orderParams as any,
      null
    )
      .accounts({
        state: this.getStatePublicKey(),
        user: userPda,
        userStats: this.getUserStatsPublicKey(),
        authority: this.authority,
      })
      .instruction();
  }

  public async getPlaceAndMakePerpOrderIx(
    orderParams: OrderParams,
    takerOrderId: number,
    subAccountId = 0,
  ): Promise<TransactionInstruction> {
    const userPda = getUserAccountPublicKey(this.programId, this.authority, subAccountId);

    return await this.program.methods.placeAndMakePerpOrder(
      orderParams as any,
      takerOrderId,
    )
      .accounts({
        state: this.getStatePublicKey(),
        user: userPda,
        userStats: this.getUserStatsPublicKey(),
        authority: this.authority,
      })
      .instruction();
  }

  public async getCancelOrderIx(
    orderId: number,
    subAccountId = 0,
  ): Promise<TransactionInstruction> {
    const userPda = getUserAccountPublicKey(this.programId, this.authority, subAccountId);

    return await this.program.methods.cancelOrder(orderId)
      .accounts({
        state: this.getStatePublicKey(),
        user: userPda,
        authority: this.authority,
      })
      .instruction();
  }

  public async getSettlePnlIx(
    marketIndex: number,
    subAccountId = 0,
  ): Promise<TransactionInstruction> {
    const userPda = getUserAccountPublicKey(this.programId, this.authority, subAccountId);
    const spotMarketVault = getSpotMarketVaultPublicKey(this.programId, marketIndex);

    return await this.program.methods.settlePnl(marketIndex)
      .accounts({
        state: this.getStatePublicKey(),
        user: userPda,
        spotMarketVault,
        authority: this.authority,
      })
      .instruction();
  }

  // Getter functions

  public getPerpMarketAccount(
    marketIndex: number
  ): PerpMarketAccount {
    const market = this.perpMarkets.get(marketIndex);
    if (!market) {
      throw new Error(`perpMarket #${marketIndex} not loaded`);
    }

    return market;
  }

  public getPerpMarketAccounts(): PerpMarketAccount[] {
    const accounts = Object.values(this.perpMarkets)
      .filter((value) => value !== undefined);

    return accounts;
  }

  public getSpotMarketAccount(
    marketIndex: number
  ): SpotMarketAccount {
    const market = this.spotMarkets.get(marketIndex);
    if (!market) {
      throw new Error(`spotMarket #${marketIndex} not loaded`);
    }

    return market;
  }

  public getSpotMarketAccounts(): SpotMarketAccount[] {
    const accounts = Object.values(this.spotMarkets)
      .filter((value) => value !== undefined);

    return accounts;
  }

  public getOraclePriceData(
    oracleString: string
  ): OraclePriceData {
    if (oracleString === ORACLE_DEFAULT_KEY) {
      return QUOTE_ORACLE_PRICE_DATA;
    }

    const oracle = this.oracles.get(oracleString);
    if (!oracle) {
      throw new Error(`oracle #${oracleString} not loaded`);
    }

    return oracle;
  }

  public getOracleDataForPerpMarket(marketIndex: number): OraclePriceData {
    const perpMarketAccount = this.getPerpMarketAccount(marketIndex);
    return this.getOraclePriceData(perpMarketAccount.amm.oracle.toBase58());
  }

  public getOracleDataForSpotMarket(marketIndex: number): OraclePriceData {
    const spotMarketAccount = this.getSpotMarketAccount(marketIndex);
    return this.getOraclePriceData(spotMarketAccount.oracle.toBase58());
  }

  // Helpers

  /**
   * Calculates taker / maker fee (as a percentage, e.g. .001 = 10 basis points) for particular marketType
   * @param marketType
   * @param positionMarketIndex
   * @returns : {takerFee: number, makerFee: number} Precision None
   */
  public getMarketFees(
    marketType: MarketType,
    marketIndex?: number,
    user?: User
  ) {
    let feeTier;
    if (user) {
      feeTier = user.getUserFeeTier(marketType);
    } else {
      const state = this.getStateAccount();
      feeTier = isVariant(marketType, 'perp')
        ? state.perpFeeStructure.feeTiers[0]
        : state.spotFeeStructure.feeTiers[0];
    }

    let takerFee = feeTier.feeNumerator / feeTier.feeDenominator;
    let makerFee =
      feeTier.makerRebateNumerator / feeTier.makerRebateDenominator;

    if (marketIndex !== undefined) {
      let marketAccount = null;
      if (isVariant(marketType, 'perp')) {
        marketAccount = this.getPerpMarketAccount(marketIndex);
      } else {
        marketAccount = this.getSpotMarketAccount(marketIndex);
      }

      if (!marketAccount) {
        throw new Error(`market #${marketIndex} not loaded`);
      }

      let feeAdjustment = 0;

      let takeFeeAdjustment = 0;
      if (user && user.isHighLeverageMode()) {
        takeFeeAdjustment = 100;
      }

      if (isVariant(marketType, 'perp')) {
        feeAdjustment = (marketAccount as PerpMarketAccount).feeAdjustment;
        takeFeeAdjustment = feeAdjustment;
      }

      takerFee += (takerFee * takeFeeAdjustment) / 100;
      makerFee += (makerFee * feeAdjustment) / 100;
    }

    return {
      takerFee,
      makerFee,
    };
  }

  public convertToSpotPrecision(marketIndex: number, amount: BN | number): BN {
    const spotMarket = this.getSpotMarketAccount(marketIndex);
    return castNumberToSpotPrecision(amount, spotMarket);
  }
}