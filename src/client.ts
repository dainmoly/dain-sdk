import { AnchorProvider, BN, Program } from "@coral-xyz/anchor";
import { ConfirmOptions, Connection, Keypair, PublicKey, SendOptions, SystemProgram, TransactionSignature } from "@solana/web3.js";

import { IDL, Drift } from "./idls/drift";
import { AccountLoader } from "./accountLoader";
import { buildTransaction, executeTransaction } from "./modules/transaction";
import { DAIN_PROGRAM_ID, CONFIRMATION_OPTS, PEG_PRECISION, ZERO, BASE_PRECISION, ONE, PRICE_PRECISION, DEFAULT_MARKET_NAME, SPOT_MARKET_RATE_PRECISION, SPOT_MARKET_WEIGHT_PRECISION, QUOTE_SPOT_MARKET_INDEX, WSOL_MINT } from "./constants";
import { AssetTier, ContractTier, DainConfig, DainProgram, MakerInfo, MarketType, OptionalOrderParams, OraclePriceData, OracleSource, PerpMarketAccount, RemainingAccountParams, SpotMarketAccount, StateAccount, TakerInfo, UserStatsAccount, Wallet } from "./types";
import { castNumberToSpotPrecision, getPerpMarketPublicKey, getSignerPublicKey, getSpotMarketPublicKey, getStateAccountPublicKey, getUserAccountPublicKey, getUserMapKey, getUserStatsAccountPublicKey, isVariant } from "./modules";
import { NodeWallet } from "./modules/nodeWallet";
import { ORACLE_DEFAULT_KEY, QUOTE_ORACLE_PRICE_DATA } from "./oracles/quoteAssetOracleClient";
import { User } from "./user";
import { getCancelOrderIx, getDepositIx, getInitializeIx, getInitializePerpMarketIx, getInitializeSpotMarketIx, getInitializeUserIx, getInitializeUserStateIx, getPlaceAndMakeSpotOrderIx, getPlaceAndTakePerpOrderIx, getPlaceAndTakeSpotOrderIx, getSettlePnlIx, getWithdrawIx } from "./instruction";
import { createAssociatedTokenAccountInstruction, createCloseAccountInstruction, createSyncNativeInstruction, getAccount, getAssociatedTokenAddressSync, NATIVE_MINT } from "@solana/spl-token";


export class DainClient {
  public connection: Connection;
  programId: PublicKey;
  program: DainProgram;
  wallet?: Wallet;
  sendOpts: SendOptions;
  confirmOpts: ConfirmOptions;
  accountLoader: AccountLoader;

  state?: StateAccount;
  users = new Map<string, User>();
  userStats?: UserStatsAccount;
  activeSubAccountId: number;

  readonly authority: PublicKey;
  readonly payer: PublicKey;

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
    this.activeSubAccountId = config.activeSubAccountId ?? 0;
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
    await this.accountLoader.loadPerpMarkets();
  }

  public async loadSpotMarkets() {
    await this.accountLoader.loadSpotMarkets();
  }

  public async loadOracle(source: OracleSource, pubkey: PublicKey) {
    await this.accountLoader.loadOracle(source, pubkey);
  }

  public async loadPerpMarket(marketIndex: number) {
    const pubkey = getPerpMarketPublicKey(this.programId, marketIndex);
    await this.accountLoader.loadPerpMarket(pubkey);
  }

  public async loadSpotMarket(marketIndex: number) {
    const pubkey = getSpotMarketPublicKey(this.programId, marketIndex);
    await this.accountLoader.loadSpotMarket(pubkey);
  }

  public async load() {
    await this.loadState();
    await this.loadPerpMarkets();
    await this.loadSpotMarkets();
    await this.addUser(this.activeSubAccountId);
  }

  public async addUser(
    subAccountId: number,
    authority?: PublicKey,
  ): Promise<boolean> {
    authority = authority ?? this.authority;
    const userKey = getUserMapKey(subAccountId, authority);

    if (this.users.has(userKey)) {
      return true;
    }

    const userAccountPublicKey = getUserAccountPublicKey(this.program.programId, authority, subAccountId);
    const userAccount = await this.accountLoader.loadUser(userAccountPublicKey);
    if (!userAccount) {
      return false;
    }

    const userStatsPublicKey = getUserStatsAccountPublicKey(this.program.programId, authority);
    const userStatsAccount = await this.accountLoader.loadUserStats(userStatsPublicKey);
    if (!userStatsAccount) {
      return false;
    }

    const user = new User(this, userAccountPublicKey, userAccount, userStatsPublicKey, userStatsAccount);
    this.users.set(userKey, user);

    return true;
  }

  public getUser(subAccountId: number, authority?: PublicKey): User {
    subAccountId = subAccountId ?? this.activeSubAccountId;
    authority = authority ?? this.authority;
    const userMapKey = getUserMapKey(subAccountId, authority);

    const user = this.users.get(userMapKey);
    if (!user) {
      throw new Error(`Client has no user for user id ${userMapKey}`);
    }

    return user;
  }

  public hasUser(subAccountId?: number, authority?: PublicKey): boolean {
    subAccountId = subAccountId ?? this.activeSubAccountId;
    authority = authority ?? this.authority;
    const userMapKey = getUserMapKey(subAccountId, authority);

    return this.users.has(userMapKey);
  }

  public getUsers(): User[] {
    return [...this.users.values()];
  }

  /* Admin functions */
  public async initialize(quoteAssetMint: PublicKey,): Promise<TransactionSignature | null> {
    const initializeIx = await getInitializeIx(this, quoteAssetMint);

    const tx = await buildTransaction(
      [initializeIx]
    );

    if (this.wallet && tx) {
      const ret = await executeTransaction(this.connection, tx, this.wallet, this.sendOpts);
      if (ret) {
        await Promise.all([
          this.loadState(),
        ]);

        return ret.txSig;
      }
    }

    return null;
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
  ): Promise<TransactionSignature | null> {
    const marketIndex = this.getStateAccount().numberOfSpotMarkets;
    const initializeMarketIx = await getInitializeSpotMarketIx(
      this,
      marketIndex,
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
    );

    const tx = await buildTransaction(
      [initializeMarketIx]
    );

    if (this.wallet && tx) {
      const ret = await executeTransaction(this.connection, tx, this.wallet, this.sendOpts);
      if (ret) {
        this.accountLoader.setSpotSlotCache(marketIndex, ret.slot);

        await Promise.all([
          this.loadState(),
          this.loadSpotMarket(marketIndex),
        ]);
        return ret.txSig;
      }
    }

    return null;
  }

  public async initializePerpMarket(
    oracle: PublicKey,
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
  ): Promise<TransactionSignature | null> {
    const marketIndex = this.getStateAccount().numberOfMarkets;
    const initializeMarketIx = await getInitializePerpMarketIx(
      this,
      marketIndex,
      oracle,
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

    const tx = await buildTransaction(
      [initializeMarketIx]
    );

    if (this.wallet && tx) {
      const ret = await executeTransaction(this.connection, tx, this.wallet, this.sendOpts);
      if (ret) {
        this.accountLoader.setPerpSlotCache(marketIndex, ret.slot);

        await Promise.all([
          this.loadState(),
          this.loadPerpMarket(marketIndex),
        ]);
        return ret.txSig;
      }
    }

    return null;
  }

  /* User functions */
  public async initializeUser(
    subAccountId = 0,
    name?: string,
  ): Promise<TransactionSignature | null> {
    const initializeIxs = [];

    const [_, initializeUserIx] = await getInitializeUserIx(this, subAccountId, name);
    if (subAccountId === 0) {
      const initializeUserStateIx = await getInitializeUserStateIx(this);
      initializeIxs.push(initializeUserStateIx);
    }

    initializeIxs.push(initializeUserIx);

    const tx = await buildTransaction(
      initializeIxs
    );

    if (this.wallet && tx) {
      const ret = await executeTransaction(this.connection, tx, this.wallet, this.sendOpts);
      if (ret) {
        return ret.txSig;
      }
    }

    return null;
  }

  public async placeAndMakePerpOrder(
    orderParams: OptionalOrderParams,
    takerInfo: TakerInfo,
    subAccountId?: number
  ): Promise<TransactionSignature | null> {
    const ix = await getPlaceAndMakeSpotOrderIx(
      this,
      orderParams,
      takerInfo,
      subAccountId
    );

    const tx = await buildTransaction([ix]);

    if (this.wallet && tx) {
      const ret = await executeTransaction(this.connection, tx, this.wallet, this.sendOpts);
      if (ret) {
        const { txSig, slot } = ret;
        this.accountLoader.setPerpSlotCache(orderParams.marketIndex, slot);

        return txSig;
      }
    }

    return null;
  }

  public async placeAndTakePerpOrder(
    orderParams: OptionalOrderParams,
    makerInfo?: MakerInfo,
    subAccountId?: number
  ): Promise<TransactionSignature | null> {
    const ix = await getPlaceAndTakePerpOrderIx(
      this,
      orderParams,
      makerInfo,
      subAccountId
    );

    const tx = await buildTransaction([ix]);

    if (this.wallet && tx) {
      const ret = await executeTransaction(this.connection, tx, this.wallet, this.sendOpts);
      if (ret) {
        const { txSig, slot } = ret;
        this.accountLoader.setPerpSlotCache(orderParams.marketIndex, slot);

        return txSig;
      }
    }

    return null;
  }

  public async placeAndMakeSpotOrder(
    orderParams: OptionalOrderParams,
    takerInfo: TakerInfo,
    subAccountId?: number
  ): Promise<TransactionSignature | null> {
    const ix = await getPlaceAndMakeSpotOrderIx(
      this,
      orderParams,
      takerInfo,
      subAccountId
    );

    const tx = await buildTransaction([ix]);

    if (this.wallet && tx) {
      const ret = await executeTransaction(this.connection, tx, this.wallet, this.sendOpts);
      if (ret) {
        const { txSig, slot } = ret;
        this.accountLoader.setSpotSlotCache(orderParams.marketIndex, slot);
        this.accountLoader.setSpotSlotCache(QUOTE_SPOT_MARKET_INDEX, slot);

        return txSig;
      }
    }

    return null;
  }

  public async placeAndTakeSpotOrder(
    orderParams: OptionalOrderParams,
    makerInfo?: MakerInfo,
    subAccountId?: number
  ): Promise<TransactionSignature | null> {
    const ix = await getPlaceAndTakeSpotOrderIx(
      this,
      orderParams,
      makerInfo,
      subAccountId
    );

    const tx = await buildTransaction([ix]);

    if (this.wallet && tx) {
      const ret = await executeTransaction(this.connection, tx, this.wallet, this.sendOpts);
      if (ret) {
        const { txSig, slot } = ret;
        this.accountLoader.setSpotSlotCache(orderParams.marketIndex, slot);
        this.accountLoader.setSpotSlotCache(QUOTE_SPOT_MARKET_INDEX, slot);

        return txSig;
      }
    }

    return null;
  }


  public async settlePnl(
    marketIndex: number,
    subAccountId?: number
  ): Promise<TransactionSignature | null> {
    const ix = await getSettlePnlIx(
      this,
      marketIndex,
      subAccountId
    );

    const tx = await buildTransaction([ix]);

    if (this.wallet && tx) {
      const ret = await executeTransaction(this.connection, tx, this.wallet, this.sendOpts);
      if (ret) {
        const { txSig } = ret;
        return txSig;
      }
    }

    return null;
  }

  public async cancelOrder(
    orderId?: number,
    subAccountId?: number
  ): Promise<TransactionSignature | null> {
    const ix = await getCancelOrderIx(
      this,
      orderId,
      subAccountId
    );

    const tx = await buildTransaction([ix]);

    if (this.wallet && tx) {
      const ret = await executeTransaction(this.connection, tx, this.wallet, this.sendOpts);
      if (ret) {
        const { txSig } = ret;
        return txSig;
      }
    }

    return null;
  }

  /**
   * Deposit funds into the given spot market
   * @param marketIndex 
   * @param amount 
   * @param userTokenAccount 
   * @param reduceOnly 
   * @param subAccountId 
   * @returns 
   */
  public async deposit(
    marketIndex: number,
    amount: BN,
    userTokenAccount: PublicKey,
    reduceOnly: boolean = false,
    subAccountId = 0,
  ): Promise<TransactionSignature | null> {
    if (!this.wallet) {
      return null;
    }

    const spotMarketAccount = this.getSpotMarketAccount(marketIndex);
    const isSolMarket = spotMarketAccount.mint.equals(WSOL_MINT);

    const signerAuthority = this.wallet.publicKey;

    const createWSOLTokenAccount = isSolMarket && userTokenAccount.equals(signerAuthority);

    const instructions = [];

    if (createWSOLTokenAccount) {
      // Check if WSOL ata exists
      let wsolAtaExists = false;
      userTokenAccount = getAssociatedTokenAddressSync(WSOL_MINT, signerAuthority);

      try {
        const wsolAta = await getAccount(this.connection, userTokenAccount, 'confirmed');
        if (wsolAta.owner.toBase58() == signerAuthority.toBase58()
          && wsolAta.mint.toBase58() == NATIVE_MINT.toBase58()) {
          wsolAtaExists = true;
        }
      } catch (ex) {
        // console.log(ex);
      }
      if (!wsolAtaExists) {
        instructions.push(
          createAssociatedTokenAccountInstruction(signerAuthority, userTokenAccount, signerAuthority, NATIVE_MINT),
        );
      }

      // Create Wrapped SOL account
      instructions.push(
        SystemProgram.transfer({
          fromPubkey: signerAuthority,
          toPubkey: userTokenAccount,
          lamports: amount.toNumber(),
        }),
        createSyncNativeInstruction(userTokenAccount),
      );
    }

    const depositIx = await getDepositIx(
      this,
      marketIndex,
      amount,
      reduceOnly,
      subAccountId,
      userTokenAccount,
    );
    instructions.push(depositIx);

    if (createWSOLTokenAccount) {
      instructions.push(
        createCloseAccountInstruction(userTokenAccount, signerAuthority, signerAuthority)
      );
    }

    const tx = await buildTransaction(instructions);
    if (this.wallet && tx) {
      const ret = await executeTransaction(this.connection, tx, this.wallet, this.sendOpts);
      if (ret) {
        const { txSig, slot } = ret;
        this.accountLoader.setSpotSlotCache(marketIndex, slot);
        return txSig;
      }
    }

    return null;
  }


  /**
   * Withdraws from a user account. If deposit doesn't already exist, creates a borrow
   * @param marketIndex 
   * @param amount 
   * @param userTokenAccount 
   * @param reduceOnly 
   * @param subAccountId 
   * @returns 
   */
  public async withdraw(
    marketIndex: number,
    amount: BN,
    userTokenAccount: PublicKey,
    reduceOnly: boolean = false,
    subAccountId = 0,
  ): Promise<TransactionSignature | null> {
    if (!this.wallet) {
      return null;
    }

    const spotMarketAccount = this.getSpotMarketAccount(marketIndex);
    const isSolMarket = spotMarketAccount.mint.equals(WSOL_MINT);

    const signerAuthority = this.wallet.publicKey;

    const createWSOLTokenAccount = isSolMarket && userTokenAccount.equals(signerAuthority);

    const instructions = [];

    if (createWSOLTokenAccount) {
      // Check if WSOL ata exists
      let wsolAtaExists = false;
      userTokenAccount = getAssociatedTokenAddressSync(WSOL_MINT, signerAuthority);

      try {
        const wsolAta = await getAccount(this.connection, userTokenAccount, 'confirmed');
        if (wsolAta.owner.toBase58() == signerAuthority.toBase58()
          && wsolAta.mint.toBase58() == NATIVE_MINT.toBase58()) {
          wsolAtaExists = true;
        }
      } catch (ex) {
        // console.log(ex);
      }
      if (!wsolAtaExists) {
        instructions.push(
          createAssociatedTokenAccountInstruction(signerAuthority, userTokenAccount, signerAuthority, NATIVE_MINT),
        );
      }
    }

    const withdrawIx = await getWithdrawIx(
      this,
      marketIndex,
      amount,
      reduceOnly,
      subAccountId,
      userTokenAccount,
    );
    instructions.push(withdrawIx);

    if (createWSOLTokenAccount) {
      instructions.push(
        createCloseAccountInstruction(userTokenAccount, signerAuthority, signerAuthority)
      );
    }

    const tx = await buildTransaction(instructions);
    if (this.wallet && tx) {
      const ret = await executeTransaction(this.connection, tx, this.wallet, this.sendOpts);
      if (ret) {
        const { txSig, slot } = ret;
        this.accountLoader.setSpotSlotCache(marketIndex, slot);
        return txSig;
      }
    }

    return null;
  }
  // Getter functions

  public getPerpMarketAccount(
    marketIndex: number
  ): PerpMarketAccount {
    const market = this.accountLoader.perpMarkets.get(marketIndex);
    if (!market) {
      throw new Error(`perpMarket #${marketIndex} not loaded`);
    }

    return market;
  }

  public getPerpMarketAccounts(): PerpMarketAccount[] {
    const accounts = [...this.accountLoader.perpMarkets.values()];
    return accounts;
  }

  public getSpotMarketAccount(
    marketIndex: number
  ): SpotMarketAccount {
    const market = this.accountLoader.spotMarkets.get(marketIndex);
    if (!market) {
      throw new Error(`spotMarket #${marketIndex} not loaded`);
    }

    return market;
  }

  public getSpotMarketAccounts(): SpotMarketAccount[] {
    const accounts = [...this.accountLoader.spotMarkets.values()];
    return accounts;
  }

  public getOraclePriceData(
    oracleString: string
  ): OraclePriceData {
    if (oracleString === ORACLE_DEFAULT_KEY) {
      return QUOTE_ORACLE_PRICE_DATA;
    }

    const oracle = this.accountLoader.oracles.get(oracleString);
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

  public getRemainingAccounts(params: RemainingAccountParams) {
    return this.accountLoader.getRemainingAccounts(params, 0);
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