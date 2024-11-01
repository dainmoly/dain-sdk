import { Program, Wallet } from "@coral-xyz/anchor";
import { ConfirmOptions, Connection, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, TransactionInstruction } from "@solana/web3.js";
import { DainConfig, DainProgram } from "./types";
import { CONFIRMATION_OPTS } from "./constants/config";
import { IDL, Drift } from "./idls/drift";
import { getSignerPublicKey, getStateAccountPublicKey } from "./modules";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { DAIN_PROGRAM_ID } from "./constants";

export class DainClient {
  connection: Connection;
  programId: PublicKey;
  program: DainProgram;
  wallet: Wallet | {};
  opts?: ConfirmOptions;

  public constructor(config: DainConfig, wallet: Wallet | {}, connection: Connection) {
    this.connection = connection;
    this.wallet = wallet;
    this.opts = config.opts ?? CONFIRMATION_OPTS;
    this.programId = config.programId ?? DAIN_PROGRAM_ID;
    this.program = new Program<Drift>(IDL, this.programId);
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

  /* Fetch functions */
  public async fetchState() {

  }

  /* Admin functions */
  public async initialize(quoteAssetMint: PublicKey): Promise<TransactionInstruction[]> {
    const initializeIx = await this.program.methods.initialize()
      .accounts({
        admin: this.getStatePublicKey(),
        state: this.getStatePublicKey(),
        quoteAssetMint,
        rent: SYSVAR_RENT_PUBKEY,
        driftSigner: this.getSignerPublicKey(),
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();

    return [
      initializeIx
    ];
  }

  /* User functions */

  // Keeper functions

  // Helpers

}