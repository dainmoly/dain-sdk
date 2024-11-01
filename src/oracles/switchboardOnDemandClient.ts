import { Connection, PublicKey } from '@solana/web3.js';
import { OracleClient, OraclePriceData } from './types';
import { BN, Idl } from '@coral-xyz/anchor';
import * as IDL from '@/idls/switchboard_on_demand_30.json';
import { PRICE_PRECISION_EXP } from '@/constants';
import {
	BorshAccountsCoder as BorshAccountsCoder30,
	Idl as Idl30,
} from '@coral-xyz/anchor-30';

const SB_PRECISION_EXP = new BN(18);
const SB_PRECISION = new BN(10).pow(SB_PRECISION_EXP.sub(PRICE_PRECISION_EXP));

type PullFeedAccountData = {
	result: {
		value: BN;
		std_dev: BN;
		mean: BN;
		slot: BN;
		range: BN;
	};
	last_update_timestamp: BN;
	max_variance: BN;
	min_responses: BN;
};

export class SwitchboardOnDemandClient implements OracleClient {
	connection: Connection;
	coder: BorshAccountsCoder30;

	public constructor(connection: Connection) {
		this.connection = connection;
		this.coder = new BorshAccountsCoder30(IDL as Idl30);
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
		const pullFeedAccountData = this.coder.decodeUnchecked(
			'PullFeedAccountData',
			buffer
		) as PullFeedAccountData;
		console.log(pullFeedAccountData.result.value.div(SB_PRECISION).toNumber())

		return {
			price: pullFeedAccountData.result.value.div(SB_PRECISION),
			slot: pullFeedAccountData.result.slot,
			confidence: pullFeedAccountData.result.range.div(SB_PRECISION),
			hasSufficientNumberOfDataPoints: true,
		};
	}
}
