import { BorshCoder, ProgramAccount } from "@coral-xyz/anchor";
import { AccountMeta, Commitment, Connection, PublicKey } from "@solana/web3.js";
import { DainProgram, OraclePriceData, OracleSource, PerpMarketAccount, RemainingAccountParams, SpotMarketAccount, StateAccount, UserAccount, UserStatsAccount } from "./types";
import { IDL } from "./idls/drift";
import { getStateAccountPublicKey, getUserMapKey, isSpotPositionAvailable, isVariant, positionIsAvailable } from "./modules";
import { OracleClientCache } from "./oracles/oracleClientCache";
import { QUOTE_SPOT_MARKET_INDEX, ZERO } from "./constants";

export class AccountLoader {
  connection: Connection;
  program: DainProgram;
  commitment?: Commitment;
  coder: BorshCoder;

  perpMarkets: Map<number, PerpMarketAccount> = new Map();
  spotMarkets: Map<number, SpotMarketAccount> = new Map();
  oracles: Map<string, OraclePriceData> = new Map();
  users: Map<string, UserAccount> = new Map();

  oracleClientCache = new OracleClientCache();
  perpMarketLastSlotCache = new Map<number, number>();
  spotMarketLastSlotCache = new Map<number, number>();

  public constructor(
    connection: Connection,
    program: DainProgram,
    commitment?: Commitment,
  ) {
    this.program = program;
    this.connection = connection;
    this.commitment = commitment;
    this.coder = new BorshCoder(IDL);
  }

  async fetchState(): Promise<StateAccount | undefined> {
    const pubkey = getStateAccountPublicKey(this.program.programId);
    const data = await this.fetchAccount(pubkey);
    if (data) {
      const state = this.coder.accounts.decode("state", data) as StateAccount;
      return state;
    }

    return undefined;
  }

  async fetchUserState(pubkey: PublicKey): Promise<UserStatsAccount | undefined> {
    const data = await this.fetchAccount(pubkey);
    if (data) {
      const userStats = this.coder.accounts.decode("userStats", data) as UserStatsAccount;
      return userStats;
    }

    return undefined;
  }

  async loadPerpMarkets() {
    const marketAccounts = (await this.program.account.perpMarket.all()) as ProgramAccount<PerpMarketAccount>[];

    for (const marketAccount of marketAccounts) {
      const market = marketAccount.account;
      this.perpMarkets.set(market.marketIndex, market);
    }
  }

  async loadSpotMarkets() {
    const marketAccounts = (await this.program.account.spotMarket.all()) as ProgramAccount<SpotMarketAccount>[];

    for (const marketAccount of marketAccounts) {
      const market = marketAccount.account;
      this.spotMarkets.set(market.marketIndex, market);
    }
  }

  async loadUsers() {
    const userAccounts = (await this.program.account.user.all()) as ProgramAccount<UserAccount>[];

    for (const userAccount of userAccounts) {
      const user = userAccount.account;
      const userKey = getUserMapKey(user.subAccountId, user.authority);
      this.users.set(userKey, user);
    }
  }

  async loadPerpMarket(pubkey: PublicKey) {
    const data = await this.fetchAccount(pubkey);
    if (data) {
      const market = this.coder.accounts.decode("perpMarket", data) as PerpMarketAccount;
      this.perpMarkets.set(market.marketIndex, market);
    }
  }

  async loadSpotMarket(pubkey: PublicKey) {
    const data = await this.fetchAccount(pubkey);
    if (data) {
      const market = this.coder.accounts.decode("spotMarket", data) as SpotMarketAccount;
      this.spotMarkets.set(market.marketIndex, market);
    }
  }

  async loadUser(pubkey: PublicKey): Promise<UserAccount | null> {
    const data = await this.fetchAccount(pubkey);
    if (data) {
      const user = this.coder.accounts.decode("user", data) as UserAccount;
      const userKey = getUserMapKey(user.subAccountId, user.authority);
      this.users.set(userKey, user);

      return user;
    }

    return null;
  }

  async loadOracle(source: OracleSource, pubkey: PublicKey) {
    const data = await this.fetchAccount(pubkey);
    if (data) {
      const oracleClient = this.oracleClientCache.get(source, this.connection, this.program);
      if (oracleClient) {
        const oracle = oracleClient.getOraclePriceDataFromBuffer(data);
        this.oracles.set(pubkey.toBase58(), oracle);
      }
    }
  }

  async fetchAccount(account: PublicKey): Promise<Buffer | undefined> {
    try {
      const accountInfo = await this.connection.getAccountInfo(account, this.commitment);
      if (accountInfo) {
        return accountInfo.data;
      }
    }
    catch {
    }

    return undefined;
  }

  // Market cache
  getPerpSlotCache(marketIndex: number) {
    this.perpMarketLastSlotCache.get(marketIndex);
  }

  getSpotSlotCache(marketIndex: number) {
    this.spotMarketLastSlotCache.get(marketIndex);
  }

  setPerpSlotCache(marketIndex: number, slot: number) {
    this.perpMarketLastSlotCache.set(marketIndex, slot);
  }

  setSpotSlotCache(marketIndex: number, slot: number) {
    this.spotMarketLastSlotCache.set(marketIndex, slot);
  }

  // Remaining accounts helper
  addPerpMarketToRemainingAccountMaps(
    marketIndex: number,
    writable: boolean,
    oracleAccountMap: Map<string, AccountMeta>,
    spotMarketAccountMap: Map<number, AccountMeta>,
    perpMarketAccountMap: Map<number, AccountMeta>
  ): void {
    const perpMarketAccount = this.perpMarkets.get(marketIndex);
    if (!perpMarketAccount) {
      throw new Error(`perpMarket #${marketIndex} not loaded`);
    }

    perpMarketAccountMap.set(marketIndex, {
      pubkey: perpMarketAccount.pubkey,
      isSigner: false,
      isWritable: writable,
    });
    const oracleWritable =
      writable && isVariant(perpMarketAccount.amm.oracleSource, 'prelaunch');
    oracleAccountMap.set(perpMarketAccount.amm.oracle.toString(), {
      pubkey: perpMarketAccount.amm.oracle,
      isSigner: false,
      isWritable: oracleWritable,
    });
    this.addSpotMarketToRemainingAccountMaps(
      perpMarketAccount.quoteSpotMarketIndex,
      false,
      oracleAccountMap,
      spotMarketAccountMap
    );
  }

  addSpotMarketToRemainingAccountMaps(
    marketIndex: number,
    writable: boolean,
    oracleAccountMap: Map<string, AccountMeta>,
    spotMarketAccountMap: Map<number, AccountMeta>
  ): void {
    const spotMarketAccount = this.spotMarkets.get(marketIndex);
    if (!spotMarketAccount) {
      throw new Error(`spotMarket #${marketIndex} not loaded`);
    }

    spotMarketAccountMap.set(spotMarketAccount.marketIndex, {
      pubkey: spotMarketAccount.pubkey,
      isSigner: false,
      isWritable: writable,
    });
    if (!spotMarketAccount.oracle.equals(PublicKey.default)) {
      oracleAccountMap.set(spotMarketAccount.oracle.toString(), {
        pubkey: spotMarketAccount.oracle,
        isSigner: false,
        isWritable: false,
      });
    }
  }

  getRemainingAccountMapsForUsers(userAccounts: UserAccount[]): {
    oracleAccountMap: Map<string, AccountMeta>;
    spotMarketAccountMap: Map<number, AccountMeta>;
    perpMarketAccountMap: Map<number, AccountMeta>;
  } {
    const oracleAccountMap = new Map<string, AccountMeta>();
    const spotMarketAccountMap = new Map<number, AccountMeta>();
    const perpMarketAccountMap = new Map<number, AccountMeta>();

    for (const userAccount of userAccounts) {
      for (const spotPosition of userAccount.spotPositions) {
        if (!isSpotPositionAvailable(spotPosition)) {
          this.addSpotMarketToRemainingAccountMaps(
            spotPosition.marketIndex,
            false,
            oracleAccountMap,
            spotMarketAccountMap
          );

          if (
            !spotPosition.openAsks.eq(ZERO) ||
            !spotPosition.openBids.eq(ZERO)
          ) {
            this.addSpotMarketToRemainingAccountMaps(
              QUOTE_SPOT_MARKET_INDEX,
              false,
              oracleAccountMap,
              spotMarketAccountMap
            );
          }
        }
      }
      for (const position of userAccount.perpPositions) {
        if (!positionIsAvailable(position)) {
          this.addPerpMarketToRemainingAccountMaps(
            position.marketIndex,
            false,
            oracleAccountMap,
            spotMarketAccountMap,
            perpMarketAccountMap
          );
        }
      }
    }

    return {
      oracleAccountMap,
      spotMarketAccountMap,
      perpMarketAccountMap,
    };
  }

  getRemainingAccounts(params: RemainingAccountParams, lastUserSlot: number): AccountMeta[] {
    const { oracleAccountMap, spotMarketAccountMap, perpMarketAccountMap } =
      this.getRemainingAccountMapsForUsers(params.userAccounts);

    if (params.useMarketLastSlotCache) {
      for (const [
        marketIndex,
        slot,
      ] of this.perpMarketLastSlotCache.entries()) {
        // if cache has more recent slot than user positions account slot, add market to remaining accounts
        // otherwise remove from slot
        if (slot > lastUserSlot) {
          this.addPerpMarketToRemainingAccountMaps(
            marketIndex,
            false,
            oracleAccountMap,
            spotMarketAccountMap,
            perpMarketAccountMap
          );
        } else {
          this.perpMarketLastSlotCache.delete(marketIndex);
        }
      }

      for (const [
        marketIndex,
        slot,
      ] of this.spotMarketLastSlotCache.entries()) {
        // if cache has more recent slot than user positions account slot, add market to remaining accounts
        // otherwise remove from slot
        if (slot > lastUserSlot) {
          this.addSpotMarketToRemainingAccountMaps(
            marketIndex,
            false,
            oracleAccountMap,
            spotMarketAccountMap
          );
        } else {
          this.spotMarketLastSlotCache.delete(marketIndex);
        }
      }
    }

    if (params.readablePerpMarketIndex !== undefined) {
      const readablePerpMarketIndexes = Array.isArray(
        params.readablePerpMarketIndex
      )
        ? params.readablePerpMarketIndex
        : [params.readablePerpMarketIndex];
      for (const marketIndex of readablePerpMarketIndexes) {
        this.addPerpMarketToRemainingAccountMaps(
          marketIndex,
          false,
          oracleAccountMap,
          spotMarketAccountMap,
          perpMarketAccountMap
        );
      }
    }

    if (params.readableSpotMarketIndexes !== undefined) {
      for (const readableSpotMarketIndex of params.readableSpotMarketIndexes) {
        this.addSpotMarketToRemainingAccountMaps(
          readableSpotMarketIndex,
          false,
          oracleAccountMap,
          spotMarketAccountMap
        );
      }
    }

    if (params.writablePerpMarketIndexes !== undefined) {
      for (const writablePerpMarketIndex of params.writablePerpMarketIndexes) {
        this.addPerpMarketToRemainingAccountMaps(
          writablePerpMarketIndex,
          true,
          oracleAccountMap,
          spotMarketAccountMap,
          perpMarketAccountMap
        );
      }
    }

    if (params.writableSpotMarketIndexes !== undefined) {
      for (const writableSpotMarketIndex of params.writableSpotMarketIndexes) {
        this.addSpotMarketToRemainingAccountMaps(
          writableSpotMarketIndex,
          true,
          oracleAccountMap,
          spotMarketAccountMap
        );
      }
    }

    return [
      ...oracleAccountMap.values(),
      ...spotMarketAccountMap.values(),
      ...perpMarketAccountMap.values(),
    ];
  }
}