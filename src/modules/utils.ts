import { PublicKey } from "@solana/web3.js";
import { BTC_MINT, MAX_NAME_LENGTH, PYUSD_MINT, USDC_MINT, ZERO } from "@/constants";
import { PerpPosition, SpotPosition } from "@/types";
import { NATIVE_MINT } from "@solana/spl-token";
import BN from "bn.js";

export function isSpotPositionAvailable(position: SpotPosition): boolean {
	return position.scaledBalance.eq(ZERO) && position.openOrders === 0;
}

export function positionIsAvailable(position: PerpPosition): boolean {
	return (
		position.baseAssetAmount.eq(ZERO) &&
		position.openOrders === 0 &&
		position.quoteAssetAmount.eq(ZERO) &&
		position.lpShares.eq(ZERO)
	);
}

export const validateAddress = (address: string): boolean => {
	try {
		const pubkey = new PublicKey(address);
		return PublicKey.isOnCurve(pubkey);
	}
	catch {
		return false;
	}
}

export function chunkArray<T>(arr: T[], chunkSize = 1, cache: T[][] = []): T[][] {
	const tmp = [...arr];
	if (chunkSize <= 0) return cache;
	while (tmp.length) cache.push(tmp.splice(0, chunkSize));
	return cache;
}

export function trimFeedId(feedId: string): string {
	if (feedId.startsWith('0x')) {
		return feedId.slice(2);
	}
	return feedId;
}

export function getFeedIdUint8Array(feedId: string): Uint8Array {
	const trimmedFeedId = trimFeedId(feedId);
	return Uint8Array.from(Buffer.from(trimmedFeedId, 'hex'));
}

export function encodeName(name: string): number[] {
	if (name.length > MAX_NAME_LENGTH) {
		throw Error(`Name (${name}) longer than 32 characters`);
	}

	const buffer = Buffer.alloc(32);
	buffer.fill(name);
	buffer.fill(' ', name.length);

	return Array(...buffer);
}

export function decodeName(bytes: number[]): string {
	const buffer = Buffer.from(bytes);
	return buffer.toString('utf8').trim();
}

export function getTokenMint(mint: PublicKey) {
	if (mint.equals(NATIVE_MINT)) {
		return "WSOL";
	}
	if (mint.equals(USDC_MINT)) {
		return "USDC";
	}
	if (mint.equals(BTC_MINT)) {
		return "BTC";
	}
	if (mint.equals(PYUSD_MINT)) {
		return "PYUSD";
	}

	return shortenPubkey(mint.toBase58());
}

export const shortenPubkey = (key: string, len: number = 3) => {
	if (key.length > len * 2) {
		return key.substring(0, len) + "..." + key.substring(key.length - 3);
	}

	return key;
}

export const unifyArray = (arr: any[]) => {
	return arr.filter((value, index, self) => self.indexOf(value) === index);
}

export const divSafeBN = (val: BN, base: BN): number => {
	return val.toNumber() / base.toNumber();
}

export function isVariant(object: any, type: string) {
	return object.hasOwnProperty(type);
}

export function isOneOfVariant(object: any, types: string[]) {
	return types.reduce((result, type) => {
		return result || object.hasOwnProperty(type);
	}, false);
}

export function getVariant(object: any): string {
	return Object.keys(object)[0];
}

export const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));