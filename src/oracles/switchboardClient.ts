import { Connection, PublicKey } from '@solana/web3.js';
import { BorshAccountsCoder, BN, Idl } from '@coral-xyz/anchor';

import { PRICE_PRECISION, TEN } from '../constants';
import { OracleClient, OraclePriceData } from '../types';
import * as IDL from '../idls/switchboard.json';

type SwitchboardDecimal = {
	scale: number;
	mantissa: BN;
};

type AggregatorAccountData = {
	latestConfirmedRound: {
		result: SwitchboardDecimal;
		stdDeviation: SwitchboardDecimal;
		numSuccess: number;
		roundOpenSlot: BN;
	};
	minOracleResults: number;
};

export class SwitchboardClient implements OracleClient {
	connection: Connection;
	coder: BorshAccountsCoder;

	public constructor(connection: Connection) {
		this.connection = connection;
		this.coder = new BorshAccountsCoder(IDL as Idl);
	}

	public async getOraclePriceData(
		pricePublicKey: PublicKey
	): Promise<OraclePriceData | undefined> {
		const accountInfo = await this.connection.getAccountInfo(pricePublicKey);
		if (accountInfo) {
			return this.getOraclePriceDataFromBuffer(accountInfo.data);
		}
	}

	public getOraclePriceDataFromBuffer(buffer: Buffer): OraclePriceData {
		const aggregatorAccountData = this.coder.decodeUnchecked(
			'AggregatorAccountData',
			buffer
		) as AggregatorAccountData;

		const price = convertSwitchboardDecimal(
			aggregatorAccountData.latestConfirmedRound.result
		);

		const confidence = BN.max(
			convertSwitchboardDecimal(
				aggregatorAccountData.latestConfirmedRound.stdDeviation
			),
			price.divn(1000)
		);

		const hasSufficientNumberOfDataPoints =
			aggregatorAccountData.latestConfirmedRound.numSuccess >=
			aggregatorAccountData.minOracleResults;

		const slot: BN = aggregatorAccountData.latestConfirmedRound.roundOpenSlot;
		return {
			price,
			slot,
			confidence,
			hasSufficientNumberOfDataPoints,
		};
	}
}

function convertSwitchboardDecimal(switchboardDecimal: {
	scale: number;
	mantissa: BN;
}): BN {
	const switchboardPrecision = TEN.pow(new BN(switchboardDecimal.scale));
	return switchboardDecimal.mantissa
		.mul(PRICE_PRECISION)
		.div(switchboardPrecision);
}
