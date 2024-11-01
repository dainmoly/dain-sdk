import { IDL } from "@/idls/drift";
import { PerpMarketAccount, SpotMarketAccount, StateAccount, UserAccount, UserStatsAccount } from "@/types";
import { BorshCoder } from "@coral-xyz/anchor";

export function decodeStateData(data: Buffer): StateAccount {
    const coder = new BorshCoder(IDL);
    const stateData = coder.accounts.decode("state", data);
    return stateData;
}

export function decodeUserData(data: Buffer): UserAccount {
    const coder = new BorshCoder(IDL);
    const user = coder.accounts.decode("user", data);
    return user;
}

export function decodeUserStatsData(data: Buffer): UserStatsAccount {
    const coder = new BorshCoder(IDL);
    const userStats = coder.accounts.decode("userStats", data);
    return userStats;
}

export function decodePerpMarketData(data: Buffer): PerpMarketAccount {
    const coder = new BorshCoder(IDL);
    const perpMarket = coder.accounts.decode("perpMarket", data);
    return perpMarket;
}

export function decodeSpotMarketData(data: Buffer): SpotMarketAccount {
    const coder = new BorshCoder(IDL);
    const spotMarket = coder.accounts.decode("spotMarket", data);
    return spotMarket;
}
