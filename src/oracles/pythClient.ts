import { parsePriceData } from '@pythnetwork/client';
import { Connection, PublicKey } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';

import { OracleClient, OraclePriceData } from '../types';
import { ONE, PRICE_PRECISION, QUOTE_PRECISION, TEN } from '../constants';

export class PythClient implements OracleClient {
	private connection: Connection;
	private multiple: BN;
	private stableCoin: boolean;

	public constructor(
		connection: Connection,
		multiple = ONE,
		stableCoin = false
	) {
		this.connection = connection;
		this.multiple = multiple;
		this.stableCoin = stableCoin;
	}

	public async getOraclePriceData(
		pricePublicKey: PublicKey
	): Promise<OraclePriceData | undefined> {
		const accountInfo = await this.connection.getAccountInfo(pricePublicKey);
		if (accountInfo) {
			return this.getOraclePriceDataFromBuffer(accountInfo.data);
		}

		return undefined;
	}

	public getOraclePriceDataFromBuffer(buffer: Buffer): OraclePriceData {
		const priceData = parsePriceData(buffer);
		console.log(priceData)
		const confidence = convertPythPrice(
			priceData.confidence ?? 0,
			priceData.exponent,
			this.multiple
		);
		const minPublishers = Math.min(priceData.numComponentPrices, 3);
		let price = convertPythPrice(
			priceData.aggregate.price,
			priceData.exponent,
			this.multiple
		);
		if (this.stableCoin) {
			price = getStableCoinPrice(price, confidence);
		}

		return {
			price,
			slot: new BN(priceData.lastSlot.toString()),
			confidence,
			twap: convertPythPrice(
				priceData.emaPrice.value,
				priceData.exponent,
				this.multiple
			),
			twapConfidence: convertPythPrice(
				priceData.emaConfidence.value,
				priceData.exponent,
				this.multiple
			),
			hasSufficientNumberOfDataPoints: priceData.numQuoters >= minPublishers,
		};
	}
}

export function convertPythPrice(
	price: number,
	exponent: number,
	multiple: BN
): BN {
	exponent = Math.abs(exponent);
	const pythPrecision = TEN.pow(new BN(exponent).abs()).div(multiple);
	return new BN(price * Math.pow(10, exponent))
		.mul(PRICE_PRECISION)
		.div(pythPrecision);
}

const fiveBPS = new BN(500);
function getStableCoinPrice(price: BN, confidence: BN): BN {
	if (price.sub(QUOTE_PRECISION).abs().lt(BN.min(confidence, fiveBPS))) {
		return QUOTE_PRECISION;
	} else {
		return price;
	}
}
