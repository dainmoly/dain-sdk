import { DainClient } from "./dainClient";
import { PublicKey } from "@solana/web3.js";
import { DataAndSlot, UserStatsAccountSubscriber } from "./accounts/types";
import { UserStatsConfig } from "./userStatsConfig";
import { PollingUserStatsAccountSubscriber } from "./accounts/pollingUserStatsAccountSubscriber";
import { WebSocketUserStatsAccountSubscriber } from "./accounts/webSocketUserStatsAccountSubsriber";
import { ReferrerInfo, SpotMarketAccount, UserStatsAccount } from "./types";
import {
  getUserAccountPublicKeySync,
  getUserStatsAccountPublicKey,
} from "./addresses/pda";
import { FUEL_START_TS } from "./constants/numericConstants";
import { ZERO } from "./constants/numericConstants";
import {
  GOV_SPOT_MARKET_INDEX,
  QUOTE_SPOT_MARKET_INDEX,
} from "./constants/numericConstants";
import { BN } from "@coral-xyz/anchor";
import { calculateInsuranceFuelBonus } from "./math/fuel";

export class UserStats {
  dainClient: DainClient;
  userStatsAccountPublicKey: PublicKey;
  accountSubscriber: UserStatsAccountSubscriber;
  isSubscribed: boolean;

  public constructor(config: UserStatsConfig) {
    this.dainClient = config.dainClient;
    this.userStatsAccountPublicKey = config.userStatsAccountPublicKey;
    if (config.accountSubscription?.type === "polling") {
      this.accountSubscriber = new PollingUserStatsAccountSubscriber(
        config.dainClient.program,
        config.userStatsAccountPublicKey,
        config.accountSubscription.accountLoader
      );
    } else if (config.accountSubscription?.type === "websocket") {
      this.accountSubscriber = new WebSocketUserStatsAccountSubscriber(
        config.dainClient.program,
        config.userStatsAccountPublicKey,
        {
          resubTimeoutMs: config.accountSubscription?.resubTimeoutMs,
          logResubMessages: config.accountSubscription?.logResubMessages,
        },
        config.accountSubscription.commitment
      );
    } else {
      throw new Error(
        `Unknown user stats account subscription type: ${config.accountSubscription?.type}`
      );
    }
  }

  public async subscribe(
    userStatsAccount?: UserStatsAccount
  ): Promise<boolean> {
    this.isSubscribed = await this.accountSubscriber.subscribe(
      userStatsAccount
    );
    return this.isSubscribed;
  }

  public async fetchAccounts(): Promise<void> {
    await this.accountSubscriber.fetch();
  }

  public async unsubscribe(): Promise<void> {
    await this.accountSubscriber.unsubscribe();
    this.isSubscribed = false;
  }

  public getAccountAndSlot(): DataAndSlot<UserStatsAccount> {
    return this.accountSubscriber.getUserStatsAccountAndSlot();
  }

  public getAccount(): UserStatsAccount {
    return this.accountSubscriber.getUserStatsAccountAndSlot().data;
  }

  public getInsuranceFuelBonus(
    now: BN,
    includeSettled = true,
    includeUnsettled = true
  ): BN {
    const userStats: UserStatsAccount = this.getAccount();

    let insuranceFuel = ZERO;

    if (includeSettled) {
      insuranceFuel = insuranceFuel.add(new BN(userStats.fuelInsurance));
    }

    if (includeUnsettled) {
      // todo: get real time ifStakedGovTokenAmount using ifStakeAccount
      if (userStats.ifStakedGovTokenAmount.gt(ZERO)) {
        const spotMarketAccount: SpotMarketAccount =
          this.dainClient.getSpotMarketAccount(GOV_SPOT_MARKET_INDEX);

        const fuelBonusNumeratorUserStats = BN.max(
          now.sub(
            BN.max(new BN(userStats.lastFuelIfBonusUpdateTs), FUEL_START_TS)
          ),
          ZERO
        );

        insuranceFuel = insuranceFuel.add(
          calculateInsuranceFuelBonus(
            spotMarketAccount,
            userStats.ifStakedGovTokenAmount,
            fuelBonusNumeratorUserStats
          )
        );
      }

      if (userStats.ifStakedQuoteAssetAmount.gt(ZERO)) {
        const spotMarketAccount: SpotMarketAccount =
          this.dainClient.getSpotMarketAccount(QUOTE_SPOT_MARKET_INDEX);

        const fuelBonusNumeratorUserStats = BN.max(
          now.sub(
            BN.max(new BN(userStats.lastFuelIfBonusUpdateTs), FUEL_START_TS)
          ),
          ZERO
        );

        insuranceFuel = insuranceFuel.add(
          calculateInsuranceFuelBonus(
            spotMarketAccount,
            userStats.ifStakedQuoteAssetAmount,
            fuelBonusNumeratorUserStats
          )
        );
      }
    }

    return insuranceFuel;
  }

  public getReferrerInfo(): ReferrerInfo | undefined {
    if (this.getAccount().referrer.equals(PublicKey.default)) {
      return undefined;
    } else {
      return {
        referrer: getUserAccountPublicKeySync(
          this.dainClient.program.programId,
          this.getAccount().referrer,
          0
        ),
        referrerStats: getUserStatsAccountPublicKey(
          this.dainClient.program.programId,
          this.getAccount().referrer
        ),
      };
    }
  }

  public static getOldestActionTs(account: UserStatsAccount): number {
    return Math.min(
      account.lastFillerVolume30DTs.toNumber(),
      account.lastMakerVolume30DTs.toNumber(),
      account.lastTakerVolume30DTs.toNumber()
    );
  }
}
