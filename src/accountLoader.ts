import { BorshCoder, ProgramAccount } from "@coral-xyz/anchor";
import { Commitment, Connection, PublicKey } from "@solana/web3.js";
import { DainProgram, PerpMarketAccount, SpotMarketAccount, StateAccount, UserAccount } from "./types";
import { IDL } from "./idls/drift";
import { getStateAccountPublicKey } from "./modules";

export class AccountLoader {
  connection: Connection;
  program: DainProgram;
  commitment?: Commitment;
  coder: BorshCoder;

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

  async loadPerpMarkets(): Promise<PerpMarketAccount[] | undefined> {
    const marketAccounts = (await this.program.account.perpMarket.all()) as ProgramAccount<PerpMarketAccount>[];

    const markets: PerpMarketAccount[] = [];
    for (const marketAccount of marketAccounts) {
      markets.push(marketAccount.account);
    }

    return markets;
  }

  async loadSpotMarkets(): Promise<SpotMarketAccount[] | undefined> {
    const marketAccounts = (await this.program.account.spotMarket.all()) as ProgramAccount<SpotMarketAccount>[];

    const markets: SpotMarketAccount[] = [];
    for (const marketAccount of marketAccounts) {
      markets.push(marketAccount.account);
    }

    return markets;
  }

  async loadUsers(): Promise<UserAccount[] | undefined> {
    const userAccounts = (await this.program.account.user.all()) as ProgramAccount<UserAccount>[];

    const users: UserAccount[] = [];
    for (const user of userAccounts) {
      users.push(user.account);
    }

    return users;
  }

  async fetchPerpMarket(pubkey: PublicKey): Promise<PerpMarketAccount | undefined> {
    const data = await this.fetchAccount(pubkey);
    if (data) {
      const perpMarket = this.coder.accounts.decode("perpMarket", data) as PerpMarketAccount;
      return perpMarket;
    }

    return undefined;
  }

  async fetchSpotMarket(pubkey: PublicKey): Promise<SpotMarketAccount | undefined> {
    const data = await this.fetchAccount(pubkey);
    if (data) {
      const spotMarket = this.coder.accounts.decode("spotMarket", data) as SpotMarketAccount;
      return spotMarket;
    }

    return undefined;
  }

  async fetchUser(pubkey: PublicKey): Promise<UserAccount | undefined> {
    const data = await this.fetchAccount(pubkey);
    if (data) {
      const user = this.coder.accounts.decode("user", data) as UserAccount;
      return user;
    }

    return undefined;
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

}