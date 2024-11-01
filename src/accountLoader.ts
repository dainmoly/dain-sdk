import { BorshCoder, Program } from "@coral-xyz/anchor";
import { Commitment, Connection, PublicKey } from "@solana/web3.js";
import { PerpMarketAccount, SpotMarketAccount, StateAccount, UserAccount } from "./types";
import { IDL, Drift } from "./idls/drift";
import { getStateAccountPublicKey } from "./modules";

export class DainAccountLoader {
  connection: Connection;
  program: Program<Drift>;
  commitment?: Commitment;
  coder: BorshCoder;

  state?: StateAccount;
  // perpMarketIndexes: number[];
  // spotMarketIndexes: number[];
  // oracleInfos: OracleInfo[];

  public constructor(
    program: Program<Drift>,
    commitment?: Commitment,
  ) {
    this.program = program;
    this.connection = program.provider.connection;
    this.commitment = commitment;
    this.coder = new BorshCoder(IDL);
  }

  public async load(): Promise<void> {
  }

  async fetchState() {
    const pubkey = getStateAccountPublicKey(this.program.programId);
    const data = await this.fetchAccount(pubkey);
    if (data) {
      this.state = this.coder.accounts.decode("state", data) as StateAccount;
    }
  }

  async fetchUser(pubkey: PublicKey): Promise<UserAccount | null> {
    const data = await this.fetchAccount(pubkey);
    if (data) {
      const user = this.coder.accounts.decode("user", data) as UserAccount;
      return user;
    }

    return null;
  }

  async fetchPerpMarket(pubkey: PublicKey): Promise<PerpMarketAccount | null> {
    const data = await this.fetchAccount(pubkey);
    if (data) {
      const perpMarket = this.coder.accounts.decode("perpMarket", data) as PerpMarketAccount;
      return perpMarket;
    }

    return null;
  }

  async fetchSpotMarket(pubkey: PublicKey): Promise<SpotMarketAccount | null> {
    const data = await this.fetchAccount(pubkey);
    if (data) {
      const spotMarket = this.coder.accounts.decode("spotMarket", data) as SpotMarketAccount;
      return spotMarket;
    }

    return null;
  }

  async fetchAccount(account: PublicKey): Promise<Buffer | null> {
    try {
      const accountInfo = await this.connection.getAccountInfo(account, this.commitment);
      if (accountInfo) {
        return accountInfo.data;
      }
    }
    catch {
    }

    return null;
  }

}